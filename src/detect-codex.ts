// Codex sessions: JSONL under ~/.codex/sessions/. Reads metadata only.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionMeta } from "./types.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");

export function findCodexSessions(limit = 20): SessionMeta[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => parseSessionFile(join(SESSIONS_DIR, f)))
    .filter((s): s is SessionMeta => s !== null);
}

export function parseSessionFile(path: string): SessionMeta | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  if (!raw) return null;

  let model = "unknown";
  let tokensIn = 0;
  let tokensOut = 0;
  let startedAt = "";
  const toolsUsed = new Set<string>();
  let hasMessage = false;

  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "response_item" && entry.payload?.message) {
        hasMessage = true;
        const m = entry.payload.message;
        if (typeof m.model === "string") model = m.model;
        if (m.usage) {
          tokensIn += m.usage.input_tokens ?? m.usage.prompt_tokens ?? 0;
          tokensOut += m.usage.output_tokens ?? m.usage.completion_tokens ?? 0;
        }
      }
      if (entry.timestamp && !startedAt) startedAt = entry.timestamp;
      if (entry.payload?.tool_call?.name) toolsUsed.add(entry.payload.tool_call.name);
    } catch {
      // skip malformed line
    }
  }

  if (!hasMessage) return null;

  return {
    tool: "codex",
    model,
    startedAt: startedAt || new Date().toISOString(),
    durationSec: 0,
    tokensIn,
    tokensOut,
    taskType: "unknown",
    success: true,
    toolsUsed: Array.from(toolsUsed),
    hourOfDay: new Date().getHours(),
  };
}
