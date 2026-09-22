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

test("redactSecrets catches AWS temporary keys (low entropy, short)", () => {
  // ASIA keys are 20 chars and score ~3.6 bits/char, so the entropy
  // backstop alone would let them through.
  const key = "ASIAIOSFODNN7EXAMPLE";
  const out = redactSecrets(`export AWS_ACCESS_KEY_ID=${key}`);
  assert.equal(out.includes(key), false);
  assert.match(out, /\[redacted\]/);
});

test("redactSecrets catches GitHub oauth/app tokens and Slack tokens", () => {
  const gho = "gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd";
  // Built by concatenation so the literal never appears in the file:
  // GitHub secret scanning would otherwise block the push.
  const xoxb = "xoxb-" + "123456789012-abcdefghijklmnopqrstuvwx";
  const out = redactSecrets(`token ${gho} and ${xoxb} end`);
  assert.equal(out.includes(gho), false);
  assert.equal(out.includes("123456789012"), false);
  assert.match(out, /\[redacted\]/);
});

test("redactSecrets catches base64 tokens containing slashes", () => {
  // A "/" used to split the token into sub-20-char runs that evaded the
  // length floor entirely.
  const key = "aB3xYz9QwErTy8UiO/p7AsDf6GhJk5LzX";
  const out = redactSecrets(`secret=${key} ok`);
  assert.equal(out.includes(key), false);
  assert.match(out, /\[redacted\]/);
});

test("preview still scrubs unix paths after the token-run change", () => {
  const out = preview("read /home/ubuntu/koa-app/src/app.ts please");
  assert.equal(out.includes("/home/ubuntu"), false);
  assert.match(out, /app\.ts/);
});
