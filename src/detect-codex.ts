// Codex sessions: JSONL under ~/.codex/sessions/. Structured fields only.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyToolMap,
  bumpTool,
  emptySession,
  extHint,
  finishSession,
} from "./meta.js";
import { EVENT_CAP, parseExitCode, preview, resultText, summarizeInput } from "./redact.js";
import type { SessionMeta, ToolCallStat, ToolEvent } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");

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
      else if (name.endsWith(".jsonl")) out.push({ path, mtime: st.mtimeMs });
    } catch {
      // skip
    }
  }
  return out;
}

export function parseSessionFile(path: string): SessionMeta | null {
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
  const userParts: string[] = [];
  const asstParts: string[] = [];
  let hasMessage = false;

  for (const line of raw.split("\n").filter(Boolean)) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry.timestamp === "string") {
      if (!s.startedAt) s.startedAt = entry.timestamp;
      s.endedAt = entry.timestamp;
    }
    const payload = asRecord(entry.payload) ?? entry;
    const msg = asRecord(payload.message) ?? asRecord(payload);
    if (entry.type === "response_item" || msg?.model || msg?.usage) hasMessage = true;
    if (msg) {
      if (typeof msg.model === "string" && msg.model) models.add(msg.model);
      const usage = asRecord(msg.usage);
      if (usage) {
        s.tokensIn += num(usage.input_tokens ?? usage.prompt_tokens);
        s.tokensOut += num(usage.output_tokens ?? usage.completion_tokens);
        s.cacheReadTokens += num(usage.cached_tokens ?? usage.cache_read_input_tokens);
      }
      if (typeof msg.role === "string") {
        if (msg.role === "user") {
          s.userTurns += 1;
          const text = typeof msg.content === "string" ? msg.content : "";
          if (text) {
            s.userCharsIn += text.length;
            userParts.push(text);
          }
        }
        if (msg.role === "assistant") {
          s.assistantTurns += 1;
          const text = typeof msg.content === "string" ? msg.content : "";
          if (text) {
            s.textCharsOut += text.length;
            asstParts.push(text);
          }
        }
      }
    }
    const tool = asRecord(payload.tool_call) ?? asRecord(payload.function_call);
    if (tool && typeof tool.name === "string") {
      const errored = Boolean(tool.error);
      bumpTool(calls, tool.name, errored);
      seq.push(tool.name);
      const args = asRecord(tool.arguments) ?? asRecord(tool.input);
      if (args) {
        for (const v of Object.values(args)) {
          if (typeof v === "string") {
            const ext = extHint(v);
            if (ext) langs.add(ext);
          }
        }
      }
      const result = tool.result ?? tool.output ?? tool.error ?? payload.function_call_output;
      events.push({
        name: tool.name,
        error: errored,
        exitCode: parseExitCode(result),
        argKeys: args ? Object.keys(args) : [],
        inputPreview: preview(summarizeInput(args)),
        resultPreview: preview(resultText(result)),
      });
    }
  }

  if (!hasMessage && calls.size === 0) return null;
  if (models.size > 0) {
    s.modelsUsed = Array.from(models);
    s.model = s.modelsUsed[s.modelsUsed.length - 1] ?? "unknown";
  }
  if (s.assistantTurns === 0 && hasMessage) s.assistantTurns = 1;
  applyToolMap(s, calls);
  s.toolEvents = events.slice(0, EVENT_CAP);
  s.userPromptPreview = preview(userParts.join("\n"));
  s.assistantPreview = preview(asstParts.join("\n"));
  s.success = s.assistantTurns > 0 || s.tokensOut > 0;
  return finishSession(s, seq, langs);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
