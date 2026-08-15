// Claude sessions: JSONL under ~/.claude/projects/<project>/. Structured fields only.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyToolMap,
  bumpTool,
  classifyBranch,
  emptySession,
  extHint,
  finishSession,
  shortHash,
} from "./meta.js";
import type { SessionMeta, StopReasonStat, ToolCallStat } from "./types.js";

export async function findClaudeSessions(limit = 20): Promise<SessionMeta[]> {
  const dir = join(homedir(), ".claude", "projects");
  const projects = await readdir(dir).catch(() => [] as string[]);

  const files: { path: string; mtime: number }[] = [];
  for (const project of projects) {
    await walkJsonl(join(dir, project), files);
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const sessions: SessionMeta[] = [];
  for (const file of files) {
    if (sessions.length >= limit) break;
    const meta = await readSessionFile(file.path);
    if (meta && isUseful(meta)) sessions.push(meta);
  }
  return sessions;
}

async function walkJsonl(dir: string, out: { path: string; mtime: number }[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(path, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const st = await stat(path).catch(() => null);
      if (st) out.push({ path, mtime: st.mtimeMs });
    }
  }
}

export async function readSessionFile(path: string): Promise<SessionMeta | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return null;
  return parseClaudeSession(raw, path);
}

export function parseClaudeSession(raw: string, path = ""): SessionMeta | null {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  const s = emptySession("claude");
  const models = new Set<string>();
  const langs = new Set<string>();
  const calls = new Map<string, ToolCallStat>();
  const seq: string[] = [];
  const stops = new Map<string, number>();
  let sawEvent = false;

  if (path.includes("/subagents/") || /\/agent-[a-z0-9]+\.jsonl$/i.test(path)) {
    s.isSubagent = true;
  }

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    sawEvent = true;
    ingestClaudeEntry(s, entry, models, langs, calls, seq, stops);
  }

  if (!sawEvent) return null;
  if (models.size > 0) {
    s.modelsUsed = Array.from(models);
    s.model = s.modelsUsed[s.modelsUsed.length - 1] ?? "unknown";
  }
  s.stopReasons = Array.from(stops.entries())
    .map(([reason, count]): StopReasonStat => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  applyToolMap(s, calls);
  s.success = s.lastStopReason === "end_turn" && s.apiErrorCount === 0;
  return finishSession(s, seq, langs);
}

function ingestClaudeEntry(
  s: SessionMeta,
  entry: Record<string, unknown>,
  models: Set<string>,
  langs: Set<string>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
  stops: Map<string, number>,
): void {
  const type = typeof entry.type === "string" ? entry.type : "";
  noteTime(s, entry.timestamp);
  if (typeof entry.version === "string" && entry.version) s.cliVersion = entry.version;
  if (typeof entry.permissionMode === "string" && entry.permissionMode) {
    s.permissionMode = entry.permissionMode;
  }
  if (entry.isSidechain === true) s.isSubagent = true;
  if (typeof entry.cwd === "string" && entry.cwd && !s.cwdHash) {
    s.cwdHash = shortHash(entry.cwd);
  }
  if (typeof entry.gitBranch === "string" && entry.gitBranch) {
    s.hasGit = true;
    s.branchClass = classifyBranch(entry.gitBranch);
  }
  if (entry.isApiErrorMessage === true || entry.error) s.apiErrorCount += 1;

  if (type === "assistant") s.assistantTurns += 1;
  if (type === "user" && !isToolResultUser(entry)) s.userTurns += 1;

  const msg = asRecord(entry.message);
  if (msg) {
    if (typeof msg.model === "string" && msg.model && msg.model !== "<synthetic>") {
      models.add(msg.model);
    }
    if (typeof msg.stop_reason === "string" && msg.stop_reason) {
      s.lastStopReason = msg.stop_reason;
      stops.set(msg.stop_reason, (stops.get(msg.stop_reason) ?? 0) + 1);
    }
    addUsage(s, asRecord(msg.usage));
    walkContent(s, msg.content, langs, calls, seq);
  }

  walkContent(s, entry.content, langs, calls, seq);
  if (!hasToolResultInMessage(entry) && isToolError(entry.toolUseResult)) {
    markLastToolError(calls, seq);
  }
}

function isToolResultUser(entry: Record<string, unknown>): boolean {
  return entry.toolUseResult != null || hasToolResultInMessage(entry);
}

function hasToolResultInMessage(entry: Record<string, unknown>): boolean {
  const msg = asRecord(entry.message);
  if (!msg || !Array.isArray(msg.content)) return false;
  return msg.content.some((part) => asRecord(part)?.type === "tool_result");
}

function markLastToolError(calls: Map<string, ToolCallStat>, seq: string[]): void {
  const name = seq[seq.length - 1];
  if (!name) return;
  const cur = calls.get(name);
  if (cur) cur.errors += 1;
}

function walkContent(
  s: SessionMeta,
  content: unknown,
  langs: Set<string>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
): void {
  if (typeof content === "string") {
    s.userCharsIn += content.length;
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    const c = asRecord(part);
    if (!c) continue;
    const kind = typeof c.type === "string" ? c.type : "";
    if (kind === "text" && typeof c.text === "string") {
      s.textCharsOut += c.text.length;
    } else if (kind === "thinking") {
      s.thinkingBlocks += 1;
      const think = typeof c.thinking === "string" ? c.thinking : typeof c.text === "string" ? c.text : "";
      s.thinkingChars += think.length;
    } else if (kind === "tool_use") {
      const name = typeof c.name === "string" ? c.name : "unknown";
      const input = asRecord(c.input);
      bumpTool(calls, name);
      seq.push(name);
      collectLangs(langs, input);
    } else if (kind === "tool_result") {
      if (c.is_error === true) markLastToolError(calls, seq);
    }
  }
}

function addUsage(s: SessionMeta, usage: Record<string, unknown> | null): void {
  if (!usage) return;
  s.tokensIn += num(usage.input_tokens);
  s.tokensOut += num(usage.output_tokens);
  s.cacheCreationTokens += num(usage.cache_creation_input_tokens);
  s.cacheReadTokens += num(usage.cache_read_input_tokens);
  if (typeof usage.service_tier === "string" && usage.service_tier) s.serviceTier = usage.service_tier;
  if (typeof usage.speed === "string" && usage.speed) s.speed = usage.speed;
  const server = asRecord(usage.server_tool_use);
  if (server) {
    s.webSearchRequests += num(server.web_search_requests);
    s.webFetchRequests += num(server.web_fetch_requests);
  }
}

function collectLangs(langs: Set<string>, input: Record<string, unknown> | null): void {
  if (!input) return;
  for (const key of ["file_path", "path", "pattern", "command", "glob"]) {
    const v = input[key];
    if (typeof v === "string") {
      const ext = extHint(v);
      if (ext) langs.add(ext);
    }
  }
}

function noteTime(s: SessionMeta, ts: unknown): void {
  if (typeof ts !== "string" || !ts) return;
  if (!s.startedAt) s.startedAt = ts;
  s.endedAt = ts;
}

function isToolError(tur: unknown): boolean {
  if (typeof tur === "string") return /^error/i.test(tur);
  const rec = asRecord(tur);
  if (!rec) return false;
  return rec.isError === true || rec.is_error === true || Boolean(rec.error);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isUseful(s: SessionMeta): boolean {
  const tokens = s.tokensIn + s.tokensOut + s.cacheCreationTokens + s.cacheReadTokens;
  return s.model !== "unknown" || tokens > 0 || s.toolCallCount > 0;
}
