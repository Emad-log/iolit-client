import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHermesSessions } from "../detect-hermes.js";
import { applyTier } from "../tiers.js";

function makeFixtureDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "hermes-test-"));
  const path = join(dir, "state.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT, model TEXT,
      started_at REAL NOT NULL, ended_at REAL,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
      cwd TEXT, git_branch TEXT, git_repo_root TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, tool_name TEXT,
      timestamp REAL NOT NULL, finish_reason TEXT, reasoning TEXT
    );
  `);
  const now = Date.now() / 1000;
  db.prepare(
    `INSERT INTO sessions (id, source, model, started_at, ended_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cwd, git_branch, git_repo_root)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "20260922_120000_abc123", "cli", "test-model",
    now - 600, now - 60, 1500, 800, 200, 100,
    "/tmp/fake-repo", "main", "/tmp/fake-repo"
  );
  const ins = db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_name, timestamp, finish_reason, reasoning)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  ins.run("20260922_120000_abc123", "user", "write a hello world", null, now - 590, null, null);
  ins.run("20260922_120000_abc123", "assistant", "Sure, here it is", null, now - 580, "stop", "thinking about hello");
  ins.run("20260922_120000_abc123", "tool", "created file", "write_file", now - 570, null, null);
  ins.run("20260922_120000_abc123", "assistant", "Done", null, now - 560, "stop", null);
  db.close();
  return path;
}

test("hermes: maps a state.db session to SessionMeta", async () => {
  const dbPath = makeFixtureDb();
  const sessions = await findHermesSessions(20, dbPath);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.tool, "hermes");
  assert.equal(s.model, "test-model");
  assert.deepEqual(s.modelsUsed, ["test-model"]);
  assert.equal(s.cliVersion, "hermes");
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 2);
  assert.equal(s.tokensIn, 1500);
  assert.equal(s.tokensOut, 800);
  assert.equal(s.cacheReadTokens, 200);
  assert.equal(s.cacheCreationTokens, 100);
  assert.equal(s.toolCallCount, 1);
  assert.deepEqual(s.toolsUsed, ["write_file"]);
  assert.equal(s.toolSequence[0], "write_file");
  assert.equal(s.thinkingBlocks, 1);
  assert.ok(s.thinkingChars > 0);
  assert.equal(s.hasGit, true);
  assert.equal(s.branchClass, "main");
  assert.match(s.cwdHash, /^[0-9a-f]{12}$/);
  assert.equal(s.success, true);
  assert.equal(s.isSubagent, false);
});

test("hermes: raw tier keeps prompts and thinking", async () => {
  const dbPath = makeFixtureDb();
  const sessions = await findHermesSessions(20, dbPath);
  const raw = applyTier(sessions[0], "raw");
  assert.match(raw.userPromptPreview, /hello world/);
  assert.match(raw.assistantPreview, /Sure, here it is/);
  assert.match(raw.thinkingPreview, /thinking about hello/);
  assert.equal(raw.toolEvents.length, 1);
  assert.equal(raw.toolEvents[0].name, "write_file");
});

test("hermes: pulse tier strips content", async () => {
  const dbPath = makeFixtureDb();
  const sessions = await findHermesSessions(20, dbPath);
  const pulse = applyTier(sessions[0], "pulse");
  assert.equal(pulse.userPromptPreview, "");
  assert.equal(pulse.assistantPreview, "");
  assert.equal(pulse.thinkingPreview, "");
  assert.equal(pulse.toolEvents.length, 0);
  assert.equal(pulse.toolCallCount, 1);
});

test("hermes: missing db returns no sessions", async () => {
  const sessions = await findHermesSessions(20, "/tmp/does-not-exist-xyz/state.db");
  assert.deepEqual(sessions, []);
});
