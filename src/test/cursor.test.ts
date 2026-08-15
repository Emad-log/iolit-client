import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readConversations } from "../detect-cursor.js";
import { applyTier } from "../tiers.js";

const FIXTURE = join(process.cwd(), "test", "fixtures", "cursor-state.vscdb");

test("cursor: maps conversations to SessionMeta", () => {
  const sessions = readConversations(FIXTURE, 10);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].tool, "cursor");
  assert.equal(sessions[0].model, "cursor-small");
  assert.equal(sessions[1].model, "gpt-4o");
  assert.ok(sessions[0].startedAt.startsWith("2026-08-06"));
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
