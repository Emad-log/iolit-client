import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseSessionFile } from "../detect-codex.js";
import { applyTier } from "../tiers.js";

const FIXTURE = join(process.cwd(), "test", "fixtures", "codex-session.jsonl");

test("codex: maps session file to SessionMeta", () => {
  const s = parseSessionFile(FIXTURE);
  assert.ok(s);
  assert.equal(s.tool, "codex");
  assert.equal(s.model, "gpt-5.2-codex");
  assert.equal(s.tokensIn, 1500);
  assert.equal(s.tokensOut, 700);
  assert.deepEqual(s.toolsUsed, ["shell"]);
  assert.ok(s.startedAt.startsWith("2026-08-06"));
  assert.equal(s.toolEvents.length, 1);
  assert.equal(s.toolEvents[0].name, "shell");
  assert.match(s.toolEvents[0].inputPreview, /npm test/);
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
