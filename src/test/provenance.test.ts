import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { collectCommits, isCommitSha, MAX_COMMITS } from "../provenance.js";

const SHA = "a".repeat(40);

test("isCommitSha accepts 40 lowercase hex", () => {
  assert.equal(isCommitSha(SHA), true);
  assert.equal(isCommitSha("A".repeat(40)), false);
  assert.equal(isCommitSha("abc"), false);
  assert.equal(isCommitSha("g".repeat(40)), false);
  assert.equal(isCommitSha(""), false);
});

test("collectCommits returns [] when git is missing or cwd is not a repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iolit-nogit-"));
  try {
    const out = await collectCommits(dir, "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
    assert.deepEqual(out, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectCommits returns [] for an invalid window", async () => {
  const out = await collectCommits("/tmp", "not-a-date", "2026-12-31T00:00:00Z");
  assert.deepEqual(out, []);
});

test("collectCommits binds SHAs inside the session window", async () => {
  let git: string;
  try {
    git = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    console.log("skip: git not available");
    return;
  }
  assert.ok(git.startsWith("git version"));

  const dir = mkdtempSync(join(tmpdir(), "iolit-git-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "one");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "first", "--date=2026-03-01T12:00:00Z"], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-03-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-03-01T12:00:00Z" },
    });
    const sha1 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "b.txt"), "two");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "second", "--date=2026-06-01T12:00:00Z"], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-06-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-06-01T12:00:00Z" },
    });
    const sha2 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    // Window covering only the first commit.
    const narrow = await collectCommits(dir, "2026-02-01T00:00:00Z", "2026-04-01T00:00:00Z");
    assert.deepEqual(narrow, [sha1]);

    // Window covering both.
    const wide = await collectCommits(dir, "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
    assert.deepEqual(wide, [sha2, sha1]); // newest first

    // Window covering neither.
    const empty = await collectCommits(dir, "2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z");
    assert.deepEqual(empty, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectCommits caps at MAX_COMMITS", async () => {
  try {
    execFileSync("git", ["--version"]);
  } catch {
    console.log("skip: git not available");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "iolit-cap-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    for (let i = 0; i < MAX_COMMITS + 5; i++) {
      writeFileSync(join(dir, `f${i}.txt`), String(i));
      execFileSync("git", ["add", "."], { cwd: dir });
      execFileSync("git", ["commit", "-qm", `c${i}`], { cwd: dir });
    }
    const out = await collectCommits(dir, "2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z");
    assert.equal(out.length, MAX_COMMITS);
    assert.ok(out.every(isCommitSha));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
