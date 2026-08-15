import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCopilotTranscript } from "../detect-copilot.js";
import { applyTier } from "../tiers.js";

const sample = JSON.stringify({
  model: "gpt-4.1",
  createdAt: "2026-08-06T09:00:00Z",
  updatedAt: "2026-08-06T09:03:00Z",
  requests: [
    { role: "user", message: { text: "fix the tests in /home/ubuntu/app/src/app.ts" } },
    {
      role: "assistant",
      model: "gpt-4.1",
      message: { text: "ok" },
      usage: { promptTokens: 100, completionTokens: 40 },
      toolCalls: [{ name: "read_file", path: "/home/ubuntu/app/src/app.ts" }],
    },
  ],
});

test("copilot: maps transcript json to SessionMeta", () => {
  const s = parseCopilotTranscript(sample, "file:///tmp/demo");
  assert.ok(s);
  assert.equal(s.tool, "copilot");
  assert.equal(s.model, "gpt-4.1");
  assert.equal(s.tokensIn, 100);
  assert.equal(s.tokensOut, 40);
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 1);
  assert.ok(s.toolsUsed.includes("read_file"));
  assert.ok(s.langHints.includes("ts"));
  assert.equal(s.durationSec, 180);
  assert.equal(s.toolEvents.length, 1);
  assert.equal(s.toolEvents[0].name, "read_file");
  assert.equal(s.toolEvents[0].inputPreview.includes("/home/ubuntu"), false);
});

test("copilot: empty object returns null", () => {
  assert.equal(parseCopilotTranscript("{}"), null);
});

test("copilot: pulse strips events and prompts", () => {
  const s = applyTier(parseCopilotTranscript(sample)!, "pulse");
  assert.equal(s.toolEvents.length, 0);
  assert.equal(s.userPromptPreview, "");
});

test("copilot: raw keeps prompt and scrubs paths", () => {
  const s = applyTier(parseCopilotTranscript(sample)!, "raw");
  assert.match(s.userPromptPreview, /fix the tests/);
  assert.equal(JSON.stringify(s).includes("/home/ubuntu"), false);
});
