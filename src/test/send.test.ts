import { test } from "node:test";
import assert from "node:assert/strict";
import { send } from "../send.js";

test("send returns false instead of throwing when the network fails", async () => {
  const prev = process.env.IOLIT_API;
  // Nothing listens on port 1: connection refused, fast.
  process.env.IOLIT_API = "http://127.0.0.1:1/v1/batches";
  try {
    const ok = await send({ ping: true });
    assert.equal(ok, false);
  } finally {
    if (prev === undefined) delete process.env.IOLIT_API;
    else process.env.IOLIT_API = prev;
  }
});
