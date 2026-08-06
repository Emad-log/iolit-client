// Minimal session detection for Claude Code.
// Sessions live as JSONL under ~/.claude/projects/<project>/.
// We read only the metadata we need, never prompt or output text.

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionMeta } from "./types.js";

export async function findClaudeSessions(limit = 20): Promise<SessionMeta[]> {
  const dir = join(homedir(), ".claude", "projects");
  const projects = await readdir(dir).catch(() => [] as string[]);

  const sessions: SessionMeta[] = [];
  for (const project of projects) {
    if (sessions.length >= limit) break;
    const files = await readdir(join(dir, project)).catch(() => [] as string[]);
    // newest first
    files.sort().reverse();
    for (const file of files) {
      if (sessions.length >= limit) break;
      const meta = await readSessionFile(join(dir, project, file));
      if (meta) sessions.push(meta);
    }
  }
  return sessions;
}

async function readSessionFile(path: string): Promise<SessionMeta | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return null;
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  let tokensIn = 0;
  let tokensOut = 0;
  let success = false;
  const toolsUsed = new Set<string>();
  let model = "unknown";

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.message?.model) model = entry.message.model;
      if (entry.message?.usage) {
        tokensIn += entry.message.usage.input_tokens ?? 0;
        tokensOut += entry.message.usage.output_tokens ?? 0;
      }
      if (entry.type === "assistant" && entry.message) success = true;
      if (entry.tool_use?.name) toolsUsed.add(entry.tool_use.name);
    } catch {
      // skip malformed lines
    }
  }

  return {
    tool: "claude",
    model,
    startedAt: new Date().toISOString(),
    durationSec: 0,
    tokensIn,
    tokensOut,
    taskType: "unknown",
    success,
    toolsUsed: [...toolsUsed],
    hourOfDay: new Date().getHours(),
  };
}
