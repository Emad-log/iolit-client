import { test } from "node:test";
import assert from "node:assert/strict";
import { preview, redactSecrets } from "../redact.js";

test("redactSecrets strips common key prefixes", () => {
  const out = redactSecrets("token sk-ant-abc123 and ghp_zzzzzzzzzz end");
  assert.equal(out.includes("sk-ant-abc123"), false);
  assert.equal(out.includes("ghp_zzzzzzzzzz"), false);
  assert.match(out, /\[redacted\]/);
});

test("preview scrubs unix paths", () => {
  const out = preview("read /home/ubuntu/koa-app/src/app.ts please");
  assert.equal(out.includes("/home/ubuntu"), false);
  assert.match(out, /app\.ts/);
});

test("redactSecrets catches unknown high-entropy tokens", () => {
  const key = "sk-proj-Ab3xYz9QwErTy8UiOp7AsDf6GhJk5LzXc4VbNm";
  const out = redactSecrets(`my key is ${key} ok`);
  assert.equal(out.includes(key), false);
  assert.match(out, /\[redacted\]/);
});

test("redactSecrets leaves git SHAs, UUIDs, and words alone", () => {
  const sha = "f9f0748a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7";
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const out = redactSecrets(`commit ${sha} id ${uuid} internationalization`);
  assert.ok(out.includes(sha));
  assert.ok(out.includes(uuid));
  assert.ok(out.includes("internationalization"));
  assert.equal(out.includes("[redacted]"), false);
});
