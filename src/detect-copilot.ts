// Copilot sessions: VS Code workspaceStorage chat JSON. Structured fields only.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyToolMap,
  bumpTool,
  emptySession,
  extHint,
  finishSession,
  shortHash,
} from "./meta.js";
import type { SessionMeta, ToolCallStat } from "./types.js";

const ROOTS = [
  join(homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage"),
  join(homedir(), ".config", "Code", "User", "workspaceStorage"),
  join(homedir(), "Library", "Application Support", "Code - Insiders", "User", "workspaceStorage"),
  join(homedir(), ".config", "Code - Insiders", "User", "workspaceStorage"),
];

export function findCopilotSessions(limit = 20): SessionMeta[] {
  const sessions: SessionMeta[] = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    let workspaces: string[] = [];
    try {
      workspaces = readdirSync(root);
    } catch {
      continue;
    }
    for (const ws of workspaces) {
      if (sessions.length >= limit) return sessions;
      const base = join(root, ws, "GitHub.copilot-chat");
      if (!existsSync(base)) continue;
      const cwdHint = workspaceCwd(join(root, ws));
      sessions.push(...readTranscriptDir(join(base, "transcripts"), cwdHint, limit - sessions.length));
      sessions.push(...readTranscriptDir(join(base, "chatSessions"), cwdHint, limit - sessions.length));
    }
  }
  return sessions;
}

export function parseCopilotTranscript(raw: string, cwdHint = ""): SessionMeta | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const rec = asRecord(data);
  if (!rec) return null;
  const s = emptySession("copilot");
  const models = new Set<string>();
  const langs = new Set<string>();
  const calls = new Map<string, ToolCallStat>();
  const seq: string[] = [];

  const selected = asRecord(asRecord(rec.inputState)?.selectedModel);
  const model =
    pickString(rec, ["model", "modelId", "modelName"]) ||
    pickString(selected, ["identifier"]) ||
    pickString(asRecord(selected?.metadata), ["id", "name"]);
  if (model) {
    s.model = model;
    models.add(model);
  }
  const started = isoFrom(rec.createdAt ?? rec.creationDate ?? rec.timestamp ?? rec.startedAt);
  const ended = isoFrom(rec.lastMessageDate ?? rec.updatedAt ?? rec.endedAt);
  if (started) s.startedAt = started;
  if (ended) s.endedAt = ended;
  if (cwdHint) s.cwdHash = shortHash(cwdHint);

  const requests = firstArray(rec, ["requests", "messages", "turns", "items"]);
  for (const item of requests) {
    const r = asRecord(item);
    if (!r) continue;
    const role = (pickString(r, ["role", "kind", "type"]) || "").toLowerCase();
    const message = asRecord(r.message);
    const text = pickString(message ?? r, ["text", "content", "value"]);
    if (Array.isArray(r.response)) {
      s.userTurns += 1;
      if (text) s.userCharsIn += text.length;
      s.assistantTurns += 1;
    } else if (role.includes("user") || (message && !role.includes("assistant"))) {
      s.userTurns += 1;
      if (text) s.userCharsIn += text.length;
    } else {
      s.assistantTurns += 1;
      if (text) s.textCharsOut += text.length;
    }
    const m = pickString(r, ["model", "modelId"]) || pickString(asRecord(r.model), ["id", "name"]);
    if (m) models.add(m);
    const usage = asRecord(r.usage);
    if (usage) {
      s.tokensIn += num(usage.input_tokens ?? usage.promptTokens);
      s.tokensOut += num(usage.output_tokens ?? usage.completionTokens);
    }
    const meta = asRecord(asRecord(r.result)?.metadata);
    const cacheKey = typeof meta?.cacheKey === "string" ? meta.cacheKey : "";
    if (cacheKey && !s.cwdHash) s.cwdHash = shortHash(cacheKey);
    walkResponseParts(r.response, langs, calls, seq, s);
    walkTools(r, langs, calls, seq);
    if (meta) walkTools(meta, langs, calls, seq);
  }

  if (s.userTurns === 0 && s.assistantTurns === 0 && models.size === 0) return null;
  if (models.size > 0) {
    s.modelsUsed = Array.from(models);
    if (s.model === "unknown") s.model = s.modelsUsed[0] ?? "unknown";
  }
  applyToolMap(s, calls);
  s.success = s.assistantTurns > 0;
  return finishSession(s, seq, langs);
}

function readTranscriptDir(dir: string, cwdHint: string, limit: number): SessionMeta[] {
  if (!existsSync(dir) || limit <= 0) return [];
  const out: SessionMeta[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  const files = names
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      const path = join(dir, n);
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return { path, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    if (out.length >= limit) break;
    try {
      const parsed = parseCopilotTranscript(readFileSync(f.path, "utf8"), cwdHint);
      if (parsed) out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

function workspaceCwd(wsDir: string): string {
  try {
    const raw = readFileSync(join(wsDir, "workspace.json"), "utf8");
    const data = JSON.parse(raw) as { folder?: string };
    return typeof data.folder === "string" ? data.folder : "";
  } catch {
    return "";
  }
}

function walkResponseParts(
  parts: unknown,
  langs: Set<string>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
  s: SessionMeta,
): void {
  if (!Array.isArray(parts)) return;
  for (const part of parts) {
    const p = asRecord(part);
    if (!p) continue;
    const kind = pickString(p, ["kind", "type"]);
    if (kind === "thinking") {
      s.thinkingBlocks += 1;
      s.thinkingChars += pickString(p, ["value", "text", "thinking"]).length;
    } else if (kind === "toolInvocationSerialized") {
      const name = pickString(p, ["toolName", "toolId", "name"]);
      if (name) {
        bumpTool(calls, name, p.isComplete === false);
        seq.push(name);
      }
    } else if (!kind && typeof p.value === "string") {
      s.textCharsOut += p.value.length;
    }
    const specific = asRecord(p.toolSpecificData);
    if (specific) {
      const cmd = pickString(asRecord(specific.commandLine), ["original", "text"]);
      const ext = cmd ? extHint(cmd) : null;
      if (ext) langs.add(ext);
    }
  }
}

function isoFrom(v: unknown): string {
  if (typeof v === "string" && v) {
    if (/^\d+$/.test(v)) return isoFrom(Number(v));
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return "";
}

function walkTools(
  rec: Record<string, unknown>,
  langs: Set<string>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
): void {
  const lists = [rec.toolCalls, rec.tool_calls, rec.tools, rec.usedTools];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const t = asRecord(item);
      if (!t) continue;
      const name = pickString(t, ["name", "toolName", "id"]);
      if (!name) continue;
      bumpTool(calls, name, Boolean(t.isError || t.error));
      seq.push(name);
      for (const v of Object.values(t)) {
        if (typeof v === "string") {
          const ext = extHint(v);
          if (ext) langs.add(ext);
        }
      }
    }
  }
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
