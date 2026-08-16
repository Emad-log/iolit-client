// Codex JSONL under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Real format: session_meta, response_item (messages, reasoning), event_msg (tool calls).

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
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
import { EVENT_CAP, parseExitCode, preview, resultText, summarizeInput } from "./redact.js";
import type { SessionMeta, ToolCallStat, ToolEvent } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");
const MAX_FILE_BYTES = 2_000_000;

export function findCodexSessions(limit = 20): SessionMeta[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return listJsonl(SESSIONS_DIR)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => parseSessionFile(f.path))
    .filter((s): s is SessionMeta => s !== null);
}

function listJsonl(dir: string): { path: string; mtime: number }[] {
  const out: { path: string; mtime: number }[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isDirectory()) out.push(...listJsonl(path));
      else if (name.endsWith(".jsonl") && st.size <= MAX_FILE_BYTES) out.push({ path, mtime: st.mtimeMs });
    } catch {
      // skip
    }
  }
  return out;
}

export function parseSessionFile(path: string): SessionMeta | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (!raw) return null;

  const s = emptySession("codex");
  const models = new Set<string>();
  const langs = new Set<string>();
  const calls = new Map<string, ToolCallStat>();
  const seq: string[] = [];
  const events: ToolEvent[] = [];
  const byCallId = new Map<string, ToolEvent>();
  const userParts: string[] = [];
  const asstParts: string[] = [];
  const thinkParts: string[] = [];
  let sawMessage = false;

  for (const line of raw.split("\n").filter(Boolean)) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry.timestamp === "string" && entry.timestamp) {
      if (!s.startedAt) s.startedAt = entry.timestamp;
      s.endedAt = entry.timestamp;
    }
    const payload = asRecord(entry.payload);
    if (!payload) continue;
    const kind = typeof payload.type === "string" ? payload.type : "";

    if (entry.type === "session_meta") {
      ingestSessionMeta(s, payload);
    } else if (kind === "message") {
      sawMessage = true;
      ingestMessage(s, payload, models, userParts, asstParts);
    } else if (kind === "function_call") {
      ingestFunctionCall(payload, calls, seq, events, byCallId, langs);
    } else if (kind === "function_call_output") {
      ingestFunctionOutput(payload, calls, byCallId);
    } else if (kind === "reasoning") {
      ingestReasoning(s, payload, thinkParts);
    }
  }

  if (!sawMessage && calls.size === 0) return null;
  if (models.size > 0) {
    s.modelsUsed = Array.from(models);
    s.model = s.modelsUsed[s.modelsUsed.length - 1] ?? "unknown";
  }
  applyToolMap(s, calls);
  s.toolEvents = events.slice(0, EVENT_CAP);
  s.userPromptPreview = preview(userParts.join("\n"));
  s.assistantPreview = preview(asstParts.join("\n"));
  s.thinkingPreview = preview(thinkParts.join("\n"));
  s.success = s.assistantTurns > 0 || s.tokensOut > 0;
  return finishSession(s, seq, langs);
}

function ingestSessionMeta(s: SessionMeta, payload: Record<string, unknown>): void {
  if (typeof payload.cli_version === "string" && payload.cli_version) s.cliVersion = payload.cli_version;
  if (typeof payload.cwd === "string" && payload.cwd && !s.cwdHash) s.cwdHash = shortHash(payload.cwd);
  if (typeof payload.timestamp === "string" && payload.timestamp && !s.startedAt) s.startedAt = payload.timestamp;
}

function ingestMessage(
  s: SessionMeta,
  payload: Record<string, unknown>,
  models: Set<string>,
  userParts: string[],
  asstParts: string[],
): void {
  const role = typeof payload.role === "string" ? payload.role : "";
  if (typeof payload.model === "string" && payload.model) models.add(payload.model);
  addUsage(s, asRecord(payload.usage));
  const text = contentText(payload.content);
  if (role === "user") {
    s.userTurns += 1;
    if (text) {
      s.userCharsIn += text.length;
      userParts.push(text);
    }
  } else if (role === "assistant") {
    s.assistantTurns += 1;
    if (text) {
      s.textCharsOut += text.length;
      asstParts.push(text);
    }
  }
}

function ingestFunctionCall(
  payload: Record<string, unknown>,
  calls: Map<string, ToolCallStat>,
  seq: string[],
  events: ToolEvent[],
  byCallId: Map<string, ToolEvent>,
  langs: Set<string>,
): void {
  const name = typeof payload.name === "string" && payload.name ? payload.name : "unknown";
  const callId = typeof payload.call_id === "string" ? payload.call_id : "";
  const input = parseArgs(payload.arguments);
  bumpTool(calls, name);
  seq.push(name);
  if (input) {
    for (const v of Object.values(input)) {
      if (typeof v === "string") {
        const ext = extHint(v);
        if (ext) langs.add(ext);
      }
    }
  }
  const event: ToolEvent = {
    name,
    error: false,
    exitCode: null,
    argKeys: input ? Object.keys(input) : [],
    inputPreview: input ? preview(summarizeInput(input)) : "",
    resultPreview: "",
  };
  events.push(event);
  if (callId) byCallId.set(callId, event);
}

function ingestFunctionOutput(
  payload: Record<string, unknown>,
  calls: Map<string, ToolCallStat>,
  byCallId: Map<string, ToolEvent>,
): void {
  const callId = typeof payload.call_id === "string" ? payload.call_id : "";
  const output = payload.output ?? payload.result ?? payload.error;
  const event = callId ? byCallId.get(callId) : undefined;
  if (!event) return;
  const text = resultText(output);
  event.resultPreview = preview(text);
  event.exitCode = parseExitCode(text);
  const errored =
    Boolean(payload.error) ||
    (typeof output === "string" && /^error/i.test(output)) ||
    (event.exitCode != null && event.exitCode !== 0);
  if (errored) {
    event.error = true;
    const cur = calls.get(event.name);
    if (cur) cur.errors += 1;
  }
}

function ingestReasoning(s: SessionMeta, payload: Record<string, unknown>, thinkParts: string[]): void {
  s.thinkingBlocks += 1;
  const text = contentText(payload.summary ?? payload.content);
  s.thinkingChars += text.length;
  if (text) thinkParts.push(text);
}

function addUsage(s: SessionMeta, usage: Record<string, unknown> | null): void {
  if (!usage) return;
  s.tokensIn += num(usage.input_tokens ?? usage.prompt_tokens);
  s.tokensOut += num(usage.output_tokens ?? usage.completion_tokens);
  const details = asRecord(usage.input_tokens_details);
  s.cacheReadTokens +=
    num(usage.cached_tokens) + num(usage.cache_read_input_tokens) + (details ? num(details.cached_tokens) : 0);
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return { command: raw };
    }
  }
  return null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const c = asRecord(item);
    if (c && typeof c.text === "string" && c.text) parts.push(c.text);
  }
  return parts.join("\n");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
