import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseSessionFile } from "../detect-codex.js";
import { applyTier } from "../tiers.js";

const FIXTURE = join(process.cwd(), "test", "fixtures", "codex-session.jsonl");

test("codex: maps a real rollout file to SessionMeta", () => {
  const s = parseSessionFile(FIXTURE);
  assert.ok(s);
  assert.equal(s.tool, "codex");
  assert.equal(s.model, "gpt-5.2-codex");
  assert.deepEqual(s.modelsUsed, ["gpt-5.2-codex"]);
  assert.equal(s.cliVersion, "0.115.0");
  assert.match(s.cwdHash, /^[0-9a-f]{12}$/);
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 2);
  assert.equal(s.userCharsIn, "run the tests in src/app.ts".length);
  assert.equal(s.thinkingBlocks, 1);
  assert.ok(s.thinkingChars > 0);
});

test("codex: token usage comes from event_msg/token_count", () => {
  const s = parseSessionFile(FIXTURE)!;
  assert.equal(s.tokensIn, 1700);
  assert.equal(s.tokensOut, 1000); // output 700 + reasoning 300
  assert.equal(s.cacheReadTokens, 500);
});

test("codex: function_call/output are paired by call_id", () => {
  const s = parseSessionFile(FIXTURE)!;
  assert.deepEqual(s.toolsUsed, ["shell", "apply_patch"]);
  assert.equal(s.toolCallCount, 2);
  assert.equal(s.toolErrorCount, 1);
  assert.equal(s.toolEvents.length, 2);
  assert.equal(s.toolEvents[0].name, "shell");
  assert.equal(s.toolEvents[0].exitCode, 1);
  assert.equal(s.toolEvents[0].error, true);
  assert.match(s.toolEvents[0].inputPreview, /npm test/);
  assert.match(s.toolEvents[0].resultPreview, /42 passed/);
  assert.equal(s.toolEvents[1].name, "apply_patch");
  assert.equal(s.toolEvents[1].exitCode, null);
  assert.equal(s.toolEvents[1].error, false);
  assert.ok(s.langHints.includes("ts"));
});

test("codex: missing file returns null", () => {
  assert.equal(parseSessionFile("/nonexistent.jsonl"), null);
});

test("codex: pulse strips tool events and prompts", () => {
  const s = applyTier(parseSessionFile(FIXTURE)!, "pulse");
  assert.equal(s.toolEvents.length, 0);
  assert.equal(s.userPromptPreview, "");
});

test("codex: raw keeps prompt, still no home paths", () => {
  const s = applyTier(parseSessionFile(FIXTURE)!, "raw");
  assert.match(s.userPromptPreview, /run the tests/);
  assert.equal(JSON.stringify(s).includes("/home/"), false);
});
