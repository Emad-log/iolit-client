import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readConversations } from "../detect-cursor.js";
import { applyTier } from "../tiers.js";

// Rows in the shape Cursor actually writes to globalStorage/state.vscdb.
function makeDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), "iolit-cursor-")), "state.vscdb");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
  const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");

  put.run("composerData:old", JSON.stringify({
    composerId: "old",
    createdAt: 1764000000000,
    lastUpdatedAt: 1764000600000,
    modelConfig: { modelName: "gpt-5.4-medium" },
    fullConversationHeadersOnly: [{ bubbleId: "o1", type: 1 }],
  }));
  put.run("bubbleId:old:o1", JSON.stringify({ type: 1, text: "older chat" }));

  put.run("composerData:new", JSON.stringify({
    composerId: "new",
    createdAt: 1765000000000,
    lastUpdatedAt: 1765003600000,
    modelConfig: { modelName: "claude-4.6-opus-high-thinking" },
    gitWorktree: { branchName: "main", worktreePath: "/repo" },
    fullConversationHeadersOnly: [
      { bubbleId: "b1", type: 1 },
      { bubbleId: "b2", type: 2 },
      { bubbleId: "b3", type: 2 },
      { bubbleId: "b4", type: 2 },
    ],
  }));
  put.run("bubbleId:new:b1", JSON.stringify({
    type: 1,
    text: "fix the failing test in src/app.ts",
  }));
  put.run("bubbleId:new:b2", JSON.stringify({
    type: 2,
    thinking: { text: "checking the test first" },
    modelInfo: { modelName: "claude-4.6-opus-high-thinking" },
    toolFormerData: {
      name: "run_terminal_command_v2",
      status: "error",
      params: { command: "npm test" },
      result: "1 failed, exit code 1",
    },
  }));
  put.run("bubbleId:new:b3", JSON.stringify({
    type: 2,
    toolFormerData: {
      name: "edit_file_v2",
      status: "completed",
      rawArgs: JSON.stringify({ target_file: "src/app.ts" }),
      result: "applied",
    },
  }));
  put.run("bubbleId:new:b4", JSON.stringify({
    type: 2,
    text: "Fixed it.",
    tokenCount: { inputTokens: 1200, outputTokens: 340 },
  }));

  // A draft with no messages. It must not become a session.
  put.run("composerData:draft", JSON.stringify({
    composerId: "draft",
    createdAt: 1765500000000,
    fullConversationHeadersOnly: [],
  }));

  db.close();
  return path;
}

const FIXTURE = makeDb();

test("cursor: maps composers and bubbles to SessionMeta", () => {
  const sessions = readConversations(FIXTURE, 10);
  assert.equal(sessions.length, 2);
  const s = sessions[0];
  assert.equal(s.tool, "cursor");
  assert.equal(s.model, "claude-4.6-opus-high-thinking");
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 3);
  assert.equal(s.userCharsIn, "fix the failing test in src/app.ts".length);
  assert.equal(s.textCharsOut, "Fixed it.".length);
  assert.equal(s.thinkingBlocks, 1);
  assert.equal(s.tokensIn, 1200);
  assert.equal(s.tokensOut, 340);
  assert.equal(s.hasGit, true);
  assert.equal(s.branchClass, "main");
  assert.equal(s.taskType, "code");
  assert.ok(s.startedAt.startsWith("2025-12-06"));
});

test("cursor: newest composer first, empty drafts skipped", () => {
  const sessions = readConversations(FIXTURE, 10);
  assert.equal(sessions[1].model, "gpt-5.4-medium");
  assert.equal(sessions.every((s) => s.userTurns + s.assistantTurns > 0), true);
});

test("cursor: tool calls come from toolFormerData", () => {
  const s = readConversations(FIXTURE, 10)[0];
  assert.deepEqual(s.toolsUsed.sort(), ["edit_file_v2", "run_terminal_command_v2"]);
  assert.equal(s.toolCallCount, 2);
  assert.equal(s.toolErrorCount, 1);
  assert.equal(s.toolEvents.length, 2);
  assert.equal(s.toolEvents[0].name, "run_terminal_command_v2");
  assert.equal(s.toolEvents[0].error, true);
  assert.equal(s.toolEvents[0].exitCode, 1);
  assert.match(s.toolEvents[0].inputPreview, /npm test/);
  assert.equal(s.toolEvents[1].argKeys[0], "target_file");
  assert.ok(s.langHints.includes("ts"));
});

test("cursor: missing db returns empty", () => {
  assert.deepEqual(readConversations("/nonexistent.vscdb", 10), []);
});

test("cursor: pulse strips any collected events", () => {
  const sessions = readConversations(FIXTURE, 10).map((s) => applyTier(s, "pulse"));
  for (const s of sessions) {
    assert.equal(s.toolEvents.length, 0);
    assert.equal(s.userPromptPreview, "");
  }
});

test("cursor: raw keeps the prompt", () => {
  const s = applyTier(readConversations(FIXTURE, 10)[0], "raw");
  assert.match(s.userPromptPreview, /fix the failing test/);
});
