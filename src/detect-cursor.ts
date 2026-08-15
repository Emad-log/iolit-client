// Cursor sessions: SQLite state.vscdb. Structured fields only.

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

const CONVERSATION_KEYS = [
  "cursor-composer.conversations",
  "cursor-conversations",
  "conversations",
  "aiService.prompts",
];

export function findCursorSessions(limit = 20): SessionMeta[] {
  const dirs = [
    join(homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
    join(homedir(), ".config", "Cursor", "User", "workspaceStorage"),
    join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage"),
    join(homedir(), ".config", "Cursor", "User", "globalStorage"),
  ];

  const sessions: SessionMeta[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const dbPath = join(dir, "state.vscdb");
    if (existsSync(dbPath)) {
      sessions.push(...readConversations(dbPath, limit - sessions.length));
    }
    try {
      for (const workspace of readdirSync(dir)) {
        if (sessions.length >= limit) break;
        const nested = join(dir, workspace, "state.vscdb");
        if (existsSync(nested)) {
          sessions.push(...readConversations(nested, limit - sessions.length));
        }
      }
    } catch {
      // not a directory listing we can walk
    }
  }
  return sessions.slice(0, limit);
}

export function readConversations(dbPath: string, limit: number): SessionMeta[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const out: SessionMeta[] = [];
    const cwdHint = workspaceCwd(dbPath);

    const named = db
      .prepare(`SELECT key, value FROM ItemTable WHERE key IN (${CONVERSATION_KEYS.map(() => "?").join(",")})`)
      .all(...CONVERSATION_KEYS) as { key: string; value: string }[];
    for (const row of named) {
      for (const conv of parseConversations(row.value, cwdHint)) {
        if (out.length >= limit) return out;
        out.push(conv);
      }
    }

    if (out.length < limit) {
      try {
        const kv = db
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT 40")
          .all() as { key: string; value: string }[];
        for (const row of kv) {
          if (out.length >= limit) break;
          const parsed = parseComposerDoc(row.value, cwdHint);
          if (parsed) out.push(parsed);
        }
      } catch {
        // older dbs have no cursorDiskKV
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function workspaceCwd(dbPath: string): string {
  try {
    const raw = readFileSync(join(dirname(dbPath), "workspace.json"), "utf8");
    const data = JSON.parse(raw) as { folder?: string };
    return typeof data.folder === "string" ? data.folder : "";
  } catch {
    return "";
  }
}

function parseConversations(raw: string, cwdHint: string): SessionMeta[] {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const list: unknown[] = Array.isArray(data)
      ? data
      : (data.conversations as unknown[]) ?? (data.composerThreads as unknown[]) ?? [];
    return list
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .slice(0, 20)
      .map((c) => mapConversation(c, cwdHint));
  } catch {
    return [];
  }
}

function parseComposerDoc(raw: string, cwdHint: string): SessionMeta | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return mapConversation(data, cwdHint);
  } catch {
    return null;
  }
}

function mapConversation(c: Record<string, unknown>, cwdHint: string): SessionMeta {
  const s = emptySession("cursor");
  const models = new Set<string>();
  const langs = new Set<string>();
  const calls = new Map<string, ToolCallStat>();
  const seq: string[] = [];
  const events: ToolEvent[] = [];
  const userParts: string[] = [];
  const asstParts: string[] = [];

  const model =
    pickString(c, ["model", "modelName"]) ||
    pickString(asRecord(c.modelConfig), ["modelName", "model"]) ||
    pickString(asRecord(c.modelInfo), ["modelName", "model"]);
  if (model) {
    s.model = model;
    models.add(model);
  }

  const started = pickString(c, ["timestamp", "createdAt", "created_at"]);
  const ended = pickString(c, ["lastUpdatedAt", "updatedAt", "endedAt"]);
  if (started) s.startedAt = started;
  if (ended) s.endedAt = ended;

  const git = asRecord(c.gitWorktree);
  if (git) {
    s.hasGit = true;
    const branch = pickString(git, ["branchName", "branch"]);
    if (branch) s.branchClass = classifyBranch(branch);
    const path = pickString(git, ["worktreePath", "path"]);
    if (path) s.cwdHash = shortHash(path);
  }
  if (!s.cwdHash && cwdHint) s.cwdHash = shortHash(cwdHint);
  if (c.isSubagent === true) s.isSubagent = true;

  const bubbles = firstArray(c, ["bubbles", "messages", "conversation", "fullConversationHeadersOnly"]);
  for (const item of bubbles) {
    const b = asRecord(item);
    if (!b) continue;
    const role = (pickString(b, ["type", "role", "bubbleType"]) || "").toLowerCase();
    if (role.includes("user") || role === "human") s.userTurns += 1;
    if (role.includes("assistant") || role.includes("ai") || role === "bot") s.assistantTurns += 1;
    const bubbleModel =
      pickString(b, ["model", "modelName"]) ||
      pickString(asRecord(b.modelInfo), ["modelName", "model"]);
    if (bubbleModel) models.add(bubbleModel);
    const text = pickString(b, ["text", "content", "richText"]);
    if (text && (role.includes("user") || role === "human")) {
      s.userCharsIn += text.length;
      userParts.push(text);
    }
    if (text && (role.includes("assistant") || role.includes("ai"))) {
      s.textCharsOut += text.length;
      asstParts.push(text);
    }
    collectTools(b, langs, calls, seq, events);
    noteUsage(s, b);
  }

  collectTools(c, langs, calls, seq, events);
  noteUsage(s, c);
  if (models.size > 0) {
    s.modelsUsed = Array.from(models);
    if (s.model === "unknown") s.model = s.modelsUsed[0] ?? "unknown";
  }
  if (s.userTurns === 0 && s.assistantTurns === 0 && bubbles.length === 0) {
    s.userTurns = 1;
    s.assistantTurns = 1;
  }
  applyToolMap(s, calls);
  s.toolEvents = events.slice(0, EVENT_CAP);
  s.userPromptPreview = preview(userParts.join("\n"));
  s.assistantPreview = preview(asstParts.join("\n"));
  s.success = s.assistantTurns > 0 || s.toolCallCount > 0 || s.model !== "unknown";
  return finishSession(s, seq, langs);
}

function collectTools(
  rec: Record<string, unknown>,
  langs: Set<string>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
  events: ToolEvent[],
): void {
  const lists = [
    rec.toolCalls,
    rec.tool_calls,
    rec.tools,
    rec.actions,
    asRecord(rec.capabilityType) ? [rec] : null,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const t = asRecord(item);
      if (!t) continue;
      const name = pickString(t, ["name", "toolName", "tool", "type", "capabilityType"]);
      if (!name) continue;
      const errored = Boolean(t.isError || t.error);
      bumpTool(calls, name, errored);
      seq.push(name);
      const input = asRecord(t.params) ?? asRecord(t.input) ?? asRecord(t.args);
      if (input) {
        for (const v of Object.values(input)) {
          if (typeof v === "string") {
            const ext = extHint(v);
            if (ext) langs.add(ext);
          }
        }
      }
      const result = t.result ?? t.output ?? t.error;
      events.push({
        name,
        error: errored,
        exitCode: parseExitCode(result),
        argKeys: input ? Object.keys(input) : [],
        inputPreview: preview(summarizeInput(input)),
        resultPreview: preview(resultText(result)),
      });
    }
  }
}

function noteUsage(s: SessionMeta, rec: Record<string, unknown>): void {
  const usage = asRecord(rec.usage) ?? asRecord(rec.tokenUsage) ?? rec;
  s.tokensIn += num(usage?.input_tokens ?? usage?.promptTokens ?? usage?.prompt_tokens);
  s.tokensOut += num(usage?.output_tokens ?? usage?.completionTokens ?? usage?.completion_tokens);
}

function firstArray(rec: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = rec[k];
    if (Array.isArray(v)) return v;
  }
  return [];
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
