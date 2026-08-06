import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseSessionFile } from "../detect-codex.js";

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
});

test("codex: missing file returns null", () => {
  assert.equal(parseSessionFile("/nonexistent.jsonl"), null);
});
