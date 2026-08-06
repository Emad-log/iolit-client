import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSent, readHistory } from "../history.js";

test("history: round-trips entries in temp dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "iolit-hist-"));
  recordSent(
    { batchId: "b1", sentAt: "2026-08-06T12:00:00Z", sessions: 10, sizeKb: 3, estUsd: 0.01 },
    dir
  );
  const entries = readHistory(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].batchId, "b1");
  assert.equal(entries[0].sessions, 10);
  rmSync(dir, { recursive: true, force: true });
});

test("history: empty dir returns empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "iolit-hist-"));
  assert.deepEqual(readHistory(dir), []);
  rmSync(dir, { recursive: true, force: true });
});
