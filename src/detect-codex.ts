// Codex JSONL under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Real rollout shape (v0.115+ / v0.130): top-level events are session_meta,
// response_item, event_msg, turn_context. Token usage lives in
// event_msg/token_count (cumulative total_token_usage), the model is in
// turn_context, and reasoning text is in event_msg/agent_message (plus
// response_item/reasoning on some builds).

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
  let sawContent = false;

  for (const line of raw.split("\n").filter(Boolean)) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    noteTime(s, entry.timestamp);
    const payload = asRecord(entry.payload);
    if (!payload) continue;
    const kind = typeof payload.type === "string" ? payload.type : "";

    if (entry.type === "session_meta") {
      ingestSessionMeta(s, payload);
    } else if (entry.type === "turn_context") {
      if (typeof payload.model === "string" && payload.model) models.add(payload.model);
    } else if (entry.type === "event_msg") {
      if (kind === "token_count") {
        ingestTokenCount(s, payload);
      } else if (kind === "agent_message") {
        sawContent = true;
        ingestThinking(s, payload.message ?? payload.content, thinkParts);
      } else if (kind === "user_message") {
        sawContent = true;
        ingestUserMessage(s, payload, userParts);
      }
      // task_started / task_complete / turn_aborted: no structured fields
    } else if (entry.type === "response_item") {
      if (kind === "message") {
        sawContent = true;
        ingestMessage(s, payload, models, userParts, asstParts);
      } else if (kind === "function_call") {
        sawContent = true;
        ingestFunctionCall(payload, calls, seq, events, byCallId, langs);
      } else if (kind === "function_call_output") {
        sawContent = true;
        ingestFunctionOutput(payload, calls, byCallId);
      } else if (kind === "reasoning") {
        sawContent = true;
        ingestThinking(s, payload.summary ?? payload.content, thinkParts);
      }
      // custom_tool_call and others: ignored
    }
    // entry.type === "compacted": ignored
  }

  if (!sawContent) return null;
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
  // role "developer" (system prompt) is intentionally not counted
}

function ingestUserMessage(s: SessionMeta, payload: Record<string, unknown>, userParts: string[]): void {
  const text = typeof payload.message === "string" ? payload.message : contentText(payload.content);
  if (!text) return;
  s.userTurns += 1;
  s.userCharsIn += text.length;
  userParts.push(text);
}

function ingestThinking(s: SessionMeta, raw: unknown, thinkParts: string[]): void {
  const text = contentText(raw);
  if (!text) return;
  s.thinkingBlocks += 1;
  s.thinkingChars += text.length;
  thinkParts.push(text);
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

function ingestTokenCount(s: SessionMeta, payload: Record<string, unknown>): void {
  const info = asRecord(payload.info);
  const total =
    asRecord(info?.total_token_usage) ??
    asRecord(payload.total_token_usage) ??
    asRecord(payload.usage) ??
    asRecord(payload.token_usage);
  if (!total) return;
  const tokensIn = num(total.input_tokens ?? total.prompt_tokens);
  const tokensOut =
    num(total.output_tokens ?? total.completion_tokens) + num(total.reasoning_output_tokens);
  const cacheRead = num(
    total.cached_input_tokens ?? total.cache_read_input_tokens ?? total.cached_tokens,
  );
  // total_token_usage is cumulative: keep the largest seen per field.
  s.tokensIn = Math.max(s.tokensIn, tokensIn);
  s.tokensOut = Math.max(s.tokensOut, tokensOut);
  s.cacheReadTokens = Math.max(s.cacheReadTokens, cacheRead);
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

function noteTime(s: SessionMeta, ts: unknown): void {
  if (typeof ts !== "string" || !ts) return;
  if (!s.startedAt) s.startedAt = ts;
  s.endedAt = ts;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
