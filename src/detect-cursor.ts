// Cursor chats live in globalStorage/state.vscdb, table cursorDiskKV:
//   composerData:<id>          one chat, with fullConversationHeadersOnly
//   bubbleId:<id>:<bubbleId>   one message: text, thinking, toolFormerData, tokenCount
// Header type 1 is the user, type 2 is the assistant. Workspace folders come
// from workspaceStorage/<hash>/workspace.json, keyed by composer id.

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyToolMap,
  bumpTool,
  classifyBranch,
  emptySession,
  extHint,
  finishSession,
  shortHash,
} from "./meta.js";
import { EVENT_CAP, parseExitCode, preview, resultText, summarizeInput } from "./redact.js";
import type { SessionMeta, ToolCallStat, ToolEvent } from "./types.js";

const USER = 1;
const ASSISTANT = 2;

// Bubbles read per chat. Turns are counted from every header, so this caps
// only how much text and how many tool events we collect.
const BUBBLE_CAP = 200;

interface Header {
  bubbleId: string;
  type: number;
}

interface Composer {
  id: string;
  doc: Record<string, unknown>;
  headers: Header[];
  updatedAt: number;
}

// Text and tools gathered while walking one chat.
interface Collected {
  models: Set<string>;
  langs: Set<string>;
  calls: Map<string, ToolCallStat>;
  seq: string[];
  events: ToolEvent[];
  user: string[];
  assistant: string[];
  thinking: string[];
}

function cursorDirs(name: string): string[] {
  return [
    join(homedir(), "Library", "Application Support", "Cursor", "User", name),
    join(homedir(), ".config", "Cursor", "User", name),
    join(homedir(), "AppData", "Roaming", "Cursor", "User", name),
  ];
}

export function findCursorSessions(limit = 20): SessionMeta[] {
  const folders = readWorkspaceFolders();
  const sessions: SessionMeta[] = [];
  for (const dir of cursorDirs("globalStorage")) {
    if (sessions.length >= limit) break;
    const dbPath = join(dir, "state.vscdb");
    if (existsSync(dbPath)) {
      sessions.push(...readConversations(dbPath, limit - sessions.length, folders));
    }
  }
  return sessions.slice(0, limit);
}

export function readConversations(
  dbPath: string,
  limit: number,
  folders = new Map<string, string>(),
): SessionMeta[] {
  let db: DatabaseSync | undefined;
  try {
    const conn = new DatabaseSync(dbPath, { readOnly: true });
    db = conn;
    return listComposers(conn)
      .slice(0, limit)
      .map((c) => mapComposer(conn, c, folders.get(c.id) ?? ""));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

// Newest first, skipping drafts that hold no messages.
function listComposers(db: DatabaseSync): Composer[] {
  const prefix = "composerData:";
  let rows: { key: string; value: string }[];
  try {
    rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?").all(prefix + "%") as {
      key: string;
      value: string;
    }[];
  } catch {
    return [];
  }

  const out: Composer[] = [];
  for (const row of rows) {
    const doc = parseRecord(row.value);
    if (!doc) continue;
    const headers = readHeaders(doc.fullConversationHeadersOnly);
    if (headers.length === 0) continue;
    out.push({
      id: row.key.slice(prefix.length),
      doc,
      headers,
      updatedAt: num(doc.lastUpdatedAt) || num(doc.createdAt),
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function readHeaders(raw: unknown): Header[] {
  if (!Array.isArray(raw)) return [];
  const out: Header[] = [];
  for (const item of raw) {
    const h = asRecord(item);
    if (!h) continue;
    const bubbleId = pickString(h, ["bubbleId"]);
    if (bubbleId) out.push({ bubbleId, type: num(h.type) });
  }
  return out;
}

function mapComposer(db: DatabaseSync, c: Composer, folder: string): SessionMeta {
  const s = emptySession("cursor");
  const got: Collected = {
    models: new Set(),
    langs: new Set(),
    calls: new Map(),
    seq: [],
    events: [],
    user: [],
    assistant: [],
    thinking: [],
  };

  const model =
    pickString(asRecord(c.doc.modelConfig), ["modelName", "model"]) || pickString(c.doc, ["model"]);
  if (model) got.models.add(model);

  s.startedAt = isoTime(c.doc.createdAt);
  s.endedAt = isoTime(c.doc.lastUpdatedAt) || s.startedAt;

  const git = asRecord(c.doc.gitWorktree);
  if (git) {
    s.hasGit = true;
    const branch = pickString(git, ["branchName", "branch"]);
    if (branch) s.branchClass = classifyBranch(branch);
    const path = pickString(git, ["worktreePath", "path"]);
    if (path) s.cwdHash = shortHash(path);
  }
  if (!s.cwdHash && folder) s.cwdHash = shortHash(folder);
  if (c.doc.isBestOfNSubcomposer === true) s.isSubagent = true;

  for (const h of c.headers) {
    if (h.type === USER) s.userTurns += 1;
    else if (h.type === ASSISTANT) s.assistantTurns += 1;
  }

  const stmt = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
  for (const h of c.headers.slice(-BUBBLE_CAP)) {
    const row = stmt.get(`bubbleId:${c.id}:${h.bubbleId}`) as { value: string } | undefined;
    const bubble = row ? parseRecord(row.value) : null;
    if (bubble) ingestBubble(s, got, bubble, h.type);
  }

  if (got.models.size > 0) {
    s.modelsUsed = Array.from(got.models);
    s.model = s.modelsUsed[0] ?? "unknown";
  }
  applyToolMap(s, got.calls);
  s.toolEvents = got.events.slice(0, EVENT_CAP);
  s.userPromptPreview = preview(got.user.join("\n"));
  s.assistantPreview = preview(got.assistant.join("\n"));
  s.thinkingPreview = preview(got.thinking.join("\n"));
  s.success = s.assistantTurns > 0;
  return finishSession(s, got.seq, got.langs);
}

function ingestBubble(
  s: SessionMeta,
  got: Collected,
  b: Record<string, unknown>,
  role: number,
): void {
  const model = pickString(asRecord(b.modelInfo), ["modelName", "model"]);
  if (model) got.models.add(model);

  const text = pickString(b, ["text"]);
  if (text && role === USER) {
    s.userCharsIn += text.length;
    got.user.push(text);
  } else if (text && role === ASSISTANT) {
    s.textCharsOut += text.length;
    got.assistant.push(text);
  }

  const thinking = pickString(asRecord(b.thinking), ["text"]);
  if (thinking) {
    s.thinkingBlocks += 1;
    s.thinkingChars += thinking.length;
    got.thinking.push(thinking);
  }

  const tokens = asRecord(b.tokenCount);
  if (tokens) {
    s.tokensIn += num(tokens.inputTokens);
    s.tokensOut += num(tokens.outputTokens);
  }

  const tool = asRecord(b.toolFormerData);
  if (tool) ingestTool(got, tool);
}

function ingestTool(got: Collected, t: Record<string, unknown>): void {
  const name = pickString(t, ["name"]) || "unknown";
  const errored = pickString(t, ["status"]) === "error" || Boolean(t.error);
  bumpTool(got.calls, name, errored);
  got.seq.push(name);

  const input = asRecord(t.params) ?? parseRecord(t.rawArgs);
  if (input) {
    for (const v of Object.values(input)) {
      if (typeof v === "string") {
        const ext = extHint(v);
        if (ext) got.langs.add(ext);
      }
    }
  }

  const result = t.result ?? t.error;
  got.events.push({
    name,
    error: errored,
    exitCode: parseExitCode(result),
    argKeys: input ? Object.keys(input) : [],
    inputPreview: preview(summarizeInput(input)),
    resultPreview: preview(resultText(result)),
  });
}

// composer.composerData in each workspace db lists the chats opened there.
function readWorkspaceFolders(): Map<string, string> {
  const folders = new Map<string, string>();
  for (const dir of cursorDirs("workspaceStorage")) {
    if (!existsSync(dir)) continue;
    let workspaces: string[] = [];
    try {
      workspaces = readdirSync(dir);
    } catch {
      continue;
    }
    for (const ws of workspaces) {
      const folder = readFolder(join(dir, ws, "workspace.json"));
      if (!folder) continue;
      for (const id of composerIds(join(dir, ws, "state.vscdb"))) folders.set(id, folder);
    }
  }
  return folders;
}

function readFolder(path: string): string {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { folder?: string };
    return typeof data.folder === "string" ? data.folder : "";
  } catch {
    return "";
  }
}

function composerIds(dbPath: string): string[] {
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("composer.composerData") as
      | { value: string }
      | undefined;
    const doc = row ? parseRecord(row.value) : null;
    if (!doc || !Array.isArray(doc.allComposers)) return [];
    return doc.allComposers
      .map((c) => pickString(asRecord(c), ["composerId"]))
      .filter((id) => id !== "");
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function isoTime(v: unknown): string {
  if (typeof v === "string") return v;
  const ms = num(v);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

// The value column is declared BLOB, so some rows come back as bytes.
function parseRecord(raw: unknown): Record<string, unknown> | null {
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Uint8Array) text = new TextDecoder().decode(raw);
  if (!text) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function pickString(rec: Record<string, unknown> | null, keys: string[]): string {
  if (!rec) return "";
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
