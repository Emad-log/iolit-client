import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, hasSessions } from "../payload.js";
import { applyTier } from "../tiers.js";
import { SESSION_KEYS, type SessionMeta } from "../types.js";

export const session: SessionMeta = {
  tool: "claude",
  model: "claude-sonnet-4",
  modelsUsed: ["claude-sonnet-4"],
  startedAt: "2026-08-05T00:00:00Z",
  endedAt: "2026-08-05T00:02:00Z",
  durationSec: 120,
  hourOfDay: 0,
  dayOfWeek: 3,
  cliVersion: "2.1.77",
  userTurns: 2,
  assistantTurns: 3,
  tokensIn: 1000,
  tokensOut: 500,
  cacheCreationTokens: 200,
  cacheReadTokens: 800,
  cacheHitRatio: 0.8,
  webSearchRequests: 0,
  webFetchRequests: 0,
  serviceTier: "standard",
  speed: "standard",
  taskType: "code",
  success: true,
  lastStopReason: "end_turn",
  apiErrorCount: 0,
  toolErrorCount: 0,
  toolCallCount: 1,
  toolsUsed: ["Read"],
  toolCalls: [{ name: "Read", count: 1, errors: 0 }],
  toolSequence: ["Read"],
  thinkingBlocks: 1,
  thinkingChars: 40,
  textCharsOut: 80,
  userCharsIn: 20,
  isSubagent: false,
  cwdHash: "abc123abc123",
  hasGit: true,
  branchClass: "main",
  langHints: ["ts"],
  permissionMode: "",
  stopReasons: [{ reason: "end_turn", count: 1 }],
  shareTier: "pulse",
  toolEvents: [
    {
      name: "Read",
      error: false,
      exitCode: null,
      argKeys: ["file_path"],
      inputPreview: "file_path=*/app.ts",
      resultPreview: "export const x = 1",
    },
  ],
  userPromptPreview: "fix the tests",
  assistantPreview: "done",
  thinkingPreview: "need to patch",
};

test("buildPayload produces the exact schema", () => {
  const p = buildPayload([session]);
  assert.equal(p.version, 1);
  assert.equal(p.app, "iolit");
  assert.equal(p.shareTier, "pulse");
  assert.ok(p.batchId.length > 0);
  assert.ok(p.createdAt);
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(p.sessions[0], applyTier(session, "pulse"));
});

test("buildPayload copies sessions, never references them", () => {
  const p = buildPayload([session]);
  p.sessions[0].model = "mutated";
  p.sessions[0].toolsUsed.push("Write");
  assert.equal(session.model, "claude-sonnet-4");
  assert.deepEqual(session.toolsUsed, ["Read"]);
});

test("hasSessions false for empty batch", () => {
  assert.equal(hasSessions(buildPayload([])), false);
});

test("no field outside the schema can exist in the payload", () => {
  const p = buildPayload([session]) as unknown as Record<string, unknown>;
  const allowed = ["version", "app", "batchId", "createdAt", "shareTier", "sessions"];
  assert.deepEqual(Object.keys(p).sort(), [...allowed].sort());
  const sessionsArr = p.sessions as unknown as Record<string, unknown>[];
  const s = sessionsArr[0];
  assert.deepEqual(Object.keys(s).sort(), [...SESSION_KEYS].sort());
});

test("pulse strips tool events and previews", () => {
  const p = buildPayload([session], "pulse");
  assert.equal(p.sessions[0].toolEvents.length, 0);
  assert.equal(p.sessions[0].userPromptPreview, "");
  assert.equal(p.sessions[0].assistantPreview, "");
});

test("trace keeps tool events, strips prompts", () => {
  const p = buildPayload([session], "trace");
  assert.equal(p.shareTier, "trace");
  assert.equal(p.sessions[0].toolEvents.length, 1);
  assert.equal(p.sessions[0].toolEvents[0].inputPreview, "file_path=*/app.ts");
  assert.equal(p.sessions[0].userPromptPreview, "");
  assert.equal(p.sessions[0].thinkingPreview, "");
});

test("raw keeps prompts and thinking", () => {
  const p = buildPayload([session], "raw");
  assert.equal(p.sessions[0].userPromptPreview, "fix the tests");
  assert.equal(p.sessions[0].thinkingPreview, "need to patch");
});
