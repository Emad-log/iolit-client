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
