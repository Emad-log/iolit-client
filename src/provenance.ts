// Provenance: bind a session to the git commits made during its window.
// Only commit SHAs leave the machine. No paths, remotes, branch names,
// or commit messages are ever collected. Uses a local `git` subprocess,
// so this adds no network calls (the single-send CI guard stays green).

import { execFile } from "node:child_process";
import type { Provenance } from "./types.js";

export const MAX_COMMITS = 20;
const GIT_TIMEOUT_MS = 5000;

export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

/**
 * Collect commit SHAs from the repo at `cwd` whose author date falls
 * inside [startedAt, endedAt]. Returns at most MAX_COMMITS SHAs,
 * newest first. Returns [] on any failure (no git, not a repo, timeout).
 */
export function collectCommits(cwd: string, startedAt: string, endedAt: string): Promise<string[]> {
  return new Promise((resolve) => {
    if (!cwd || !isCommitShaValid_window(startedAt, endedAt)) {
      resolve([]);
      return;
    }
    execFile(
      "git",
      ["-C", cwd, "log", "--format=%H", `--since=${startedAt}`, `--until=${endedAt}`],
      { timeout: GIT_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const shas = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(isCommitSha)
          .slice(0, MAX_COMMITS);
        resolve(shas);
      },
    );
  });
}

function isCommitShaValid_window(startedAt: string, endedAt: string): boolean {
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  return !Number.isNaN(a) && !Number.isNaN(b) && b >= a;
}

export function emptyProvenance(): Provenance {
  return { commits: [] };
}
