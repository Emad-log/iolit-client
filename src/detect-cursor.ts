// Cursor session detection.
// Cursor is a VS Code fork: conversations live in SQLite files named
// state.vscdb under each workspace's storage dir. We open them read-only,
// pull the conversation keys from ItemTable, and map them to SessionMeta.

import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionMeta } from "./types.js";

const CONVERSATION_KEYS = ["cursor-composer.conversations", "cursor-conversations", "conversations"];

export function findCursorSessions(limit = 20): SessionMeta[] {
  const dirs = [
    join(homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage"), // macOS
    join(homedir(), ".config", "Cursor", "User", "workspaceStorage"), // linux
  ];

  const sessions: SessionMeta[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const workspace of readdirSync(dir)) {
      if (sessions.length >= limit) break;
      const dbPath = join(dir, workspace, "state.vscdb");
      if (!existsSync(dbPath)) continue;
      sessions.push(...readConversations(dbPath, limit - sessions.length));
    }
  }
  return sessions;
}

export function readConversations(dbPath: string, limit: number): SessionMeta[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT key, value FROM ItemTable WHERE key IN (?, ?, ?)")
      .all(...CONVERSATION_KEYS) as { key: string; value: string }[];

    const out: SessionMeta[] = [];
    for (const row of rows) {
      for (const conv of parseConversations(row.value)) {
        if (out.length >= limit) break;
        out.push(conv);
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function parseConversations(raw: string): SessionMeta[] {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const list: unknown[] = Array.isArray(data)
      ? data
      : (data.conversations as unknown[]) ?? (data.composerThreads as unknown[]) ?? [];
    return list
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .slice(0, 20)
      .map((c) => ({
        tool: "cursor" as const,
        model: typeof c.model === "string" ? c.model : "unknown",
        startedAt: typeof c.timestamp === "string" ? c.timestamp : new Date().toISOString(),
        durationSec: 0,
        tokensIn: 0,
        tokensOut: 0,
        taskType: "unknown",
        success: true,
        toolsUsed: [],
        hourOfDay: new Date().getHours(),
      }));
  } catch {
    return [];
  }
}
