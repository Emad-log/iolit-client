// Hermes agent sessions in ~/.hermes/state.db (SQLite).
// Read-only access; the gateway keeps writing while we read (WAL mode).

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyToolMap,
  bumpTool,
  classifyBranch,
  emptySession,
  finishSession,
  shortHash,
} from "./meta.js";
import { collectCommits } from "./provenance.js";
import { EVENT_CAP, preview } from "./redact.js";
import type { SessionMeta, ToolCallStat, ToolEvent } from "./types.js";

const DEFAULT_LIMIT = 20;

// Bound the per-session read: the gateway's sessions can be long-lived,
// and every message is walked to build previews. Other detectors cap
// files at 2MB / bubbles at 200; this is the Hermes equivalent.
const MESSAGE_CAP = 2000;

interface HermesSessionRow {
  id: string;
  source: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cwd: string | null;
  git_branch: string | null;
  git_repo_root: string | null;
}

interface HermesMessageRow {
  role: string;
  content: string | null;
  tool_name: string | null;
  timestamp: number;
  finish_reason: string | null;
  reasoning: string | null;
}

export async function findHermesSessions(limit = DEFAULT_LIMIT, dbPath?: string): Promise<SessionMeta[]> {
  const path = dbPath ?? join(homedir(), ".hermes", "state.db");
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return [];
  }
  try {
    const rows = db
      .prepare(
        `SELECT id, source, model, started_at, ended_at,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                cwd, git_branch, git_repo_root
         FROM sessions ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as HermesSessionRow[];
    const sessions: SessionMeta[] = [];
    for (const row of rows) {
      const meta = await readHermesSession(db, row);
      if (meta && isUseful(meta)) sessions.push(meta);
    }
    return sessions;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function readHermesSession(db: DatabaseSync, row: HermesSessionRow): Promise<SessionMeta | null> {
  const s = emptySession("hermes");
  const calls = new Map<string, ToolCallStat>();
  const seq: string[] = [];
  const langs = new Set<string>();
  const events: ToolEvent[] = [];
  const userParts: string[] = [];
  const asstParts: string[] = [];
  const thinkParts: string[] = [];

  s.model = row.model || "unknown";
  s.modelsUsed = row.model ? [row.model] : [];
  s.startedAt = new Date(row.started_at * 1000).toISOString();
  s.endedAt = row.ended_at ? new Date(row.ended_at * 1000).toISOString() : new Date().toISOString();
  s.tokensIn = row.input_tokens || 0;
  s.tokensOut = row.output_tokens || 0;
  s.cacheReadTokens = row.cache_read_tokens || 0;
  s.cacheCreationTokens = row.cache_write_tokens || 0;
  s.cliVersion = "hermes";
  s.isSubagent = row.source === "subagent";
  if (row.cwd) s.cwdHash = shortHash(row.cwd);
  if (row.git_repo_root) s.hasGit = true;
  if (row.git_branch) s.branchClass = classifyBranch(row.git_branch);
  s.success = row.ended_at != null;

  let messages: HermesMessageRow[];
  try {
    messages = db
      .prepare(
        `SELECT role, content, tool_name, timestamp, finish_reason, reasoning
         FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?`,
      )
      .all(row.id, MESSAGE_CAP) as unknown as HermesMessageRow[];
  } catch {
    return null;
  }
  if (messages.length === 0) return null;

  for (const m of messages) {
    if (m.role === "user") {
      s.userTurns += 1;
      if (m.content) {
        s.userCharsIn += m.content.length;
        userParts.push(m.content);
      }
    } else if (m.role === "assistant") {
      s.assistantTurns += 1;
      if (m.content) {
        s.textCharsOut += m.content.length;
        asstParts.push(m.content);
      }
      if (m.reasoning) {
        s.thinkingBlocks += 1;
        s.thinkingChars += m.reasoning.length;
        thinkParts.push(m.reasoning);
      }
      if (m.finish_reason) s.lastStopReason = m.finish_reason;
    } else if (m.role === "tool") {
      const name = m.tool_name || "unknown";
      bumpTool(calls, name);
      seq.push(name);
      events.push({
        name,
        error: false,
        exitCode: null,
        argKeys: [],
        inputPreview: "",
        resultPreview: preview(m.content ?? ""),
      });
    }
  }

  applyToolMap(s, calls);
  s.toolEvents = events.slice(0, EVENT_CAP);
  s.userPromptPreview = preview(userParts.join("\n"));
  s.assistantPreview = preview(asstParts.join("\n"));
  s.thinkingPreview = preview(thinkParts.join("\n"));

  // Provenance: commits made in the session repo during its window.
  const repoDir = row.cwd || row.git_repo_root || "";
  s.provenance.commits = await collectCommits(repoDir, s.startedAt, s.endedAt);

  return finishSession(s, seq, langs);
}

function isUseful(s: SessionMeta): boolean {
  const tokens = s.tokensIn + s.tokensOut + s.cacheCreationTokens + s.cacheReadTokens;
  return s.model !== "unknown" || tokens > 0 || s.toolCallCount > 0;
}
