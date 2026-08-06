import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, hasSessions } from "../payload.js";
import type { SessionMeta } from "../types.js";

const session: SessionMeta = {
  tool: "claude",
  model: "claude-sonnet-4",
  startedAt: "2026-08-05T00:00:00Z",
  durationSec: 120,
  tokensIn: 1000,
  tokensOut: 500,
  taskType: "code",
  success: true,
  toolsUsed: ["Read"],
  hourOfDay: 14,
};

test("buildPayload produces the exact schema", () => {
  const p = buildPayload([session]);
  assert.equal(p.version, 1);
  assert.equal(p.app, "iolit");
  assert.ok(p.batchId.length > 0);
  assert.ok(p.createdAt);
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(p.sessions[0], session);
});

test("buildPayload copies sessions, never references them", () => {
  const p = buildPayload([session]);
  p.sessions[0].model = "mutated";
  assert.equal(session.model, "claude-sonnet-4");
});

test("hasSessions false for empty batch", () => {
  assert.equal(hasSessions(buildPayload([])), false);
});

test("no field outside the schema can exist in the payload", () => {
  const p = buildPayload([session]) as unknown as Record<string, unknown>;
  const allowed = ["version", "app", "batchId", "createdAt", "sessions"];
  assert.deepEqual(Object.keys(p).sort(), [...allowed].sort());
  const sessionsArr = p.sessions as unknown as Record<string, unknown>[];
  const s = sessionsArr[0];
  const sAllowed = [
    "tool", "model", "startedAt", "durationSec", "tokensIn", "tokensOut",
    "taskType", "success", "toolsUsed", "hourOfDay",
  ];
  assert.deepEqual(Object.keys(s).sort(), [...sAllowed].sort());
});
