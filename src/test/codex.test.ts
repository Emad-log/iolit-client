import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseSessionFile } from "../detect-codex.js";
import { applyTier } from "../tiers.js";

const FIXTURE = join(process.cwd(), "test", "fixtures", "codex-session.jsonl");

test("codex: maps a real rollout file to SessionMeta", async () => {
  const s = await parseSessionFile(FIXTURE);
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
  assert.equal(s.webSearchRequests, 1);
});

test("codex: event_msg copies of the same messages are not counted twice", async () => {
  const s = (await parseSessionFile(FIXTURE))!;
  // The fixture writes every message to both streams, as a real rollout does.
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 2);
  assert.equal(s.thinkingBlocks, 1);
  // Assistant replies stay out of the thinking preview.
  assert.match(s.assistantPreview, /tests failed/);
  assert.equal(s.thinkingPreview.includes("tests failed"), false);
});

test("codex: token usage comes from event_msg/token_count", async () => {
  const s = (await parseSessionFile(FIXTURE))!;
  assert.equal(s.tokensIn, 1700);
  assert.equal(s.tokensOut, 1000); // output 700 + reasoning 300
  assert.equal(s.cacheReadTokens, 500);
});

test("codex: function_call/output are paired by call_id", async () => {
  const s = (await parseSessionFile(FIXTURE))!;
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

test("codex: missing file returns null", async () => {
  assert.equal(await parseSessionFile("/nonexistent.jsonl"), null);
});

test("codex: pulse strips tool events and prompts", async () => {
  const s = applyTier((await parseSessionFile(FIXTURE))!, "pulse");
  assert.equal(s.toolEvents.length, 0);
  assert.equal(s.userPromptPreview, "");
});

test("codex: raw keeps prompt, still no home paths", async () => {
  const s = applyTier((await parseSessionFile(FIXTURE))!, "raw");
  assert.match(s.userPromptPreview, /run the tests/);
  assert.equal(JSON.stringify(s).includes("/home/"), false);
});

test("codex: attaches commit provenance from the session cwd", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iolit-codex-prov-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "one");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "work"], { cwd: dir });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date().toISOString();
    const lines = [
      { timestamp: start, type: "session_meta", payload: { id: "s1", cwd: dir, cli_version: "0.115.0" } },
      { timestamp: start, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } },
      { timestamp: end, type: "turn_context", payload: { model: "gpt-5.2-codex" } },
    ];
    const file = join(dir, "rollout.jsonl");
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const s = await parseSessionFile(file);
    assert.ok(s);
    assert.equal(s.hasGit, true);
    assert.deepEqual(s.provenance.commits, [sha]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
