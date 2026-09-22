// Regression test: the CLI prompts must work with piped stdin.
// node:readline/promises used to hang on the second question when stdin was
// a pipe (the interface closed at EOF and the pending question never
// settled), killing the process silently. These tests spawn the real CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

function makeFixture(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "iolit-cli-"));
  const repoDir = join(home, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });

  const projDir = join(home, ".claude", "projects", "repo");
  mkdirSync(projDir, { recursive: true });
  const entries = [
    {
      type: "user",
      timestamp: "2026-09-20T09:00:00Z",
      cwd: repoDir,
      gitBranch: "main",
      version: "2.1.77",
      message: { role: "user", content: "hi" },
    },
    {
      type: "assistant",
      timestamp: "2026-09-20T09:01:00Z",
      cwd: repoDir,
      gitBranch: "main",
      stop_reason: "end_turn",
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    },
  ];
  writeFileSync(
    join(projDir, "s.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function startStub(): Promise<{ url: string; received: unknown[]; close: () => Promise<void> }> {
  const received: unknown[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        received.push(body);
      }
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ batchId: "x", status: "received" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/v1/batches`,
        received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function runCli(home: string, apiUrl: string, stdinText: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI], {
      env: { ...process.env, HOME: home, IOLIT_API: apiUrl },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI did not exit within 20s (piped stdin hung). Output so far:\n${stdout}`));
    }, 20000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

test("CLI sends the batch with piped stdin (tier default + y)", async () => {
  const { home, cleanup } = makeFixture();
  const stub = await startStub();
  try {
    const { code, stdout } = await runCli(home, stub.url, "\ny\n");
    assert.equal(code, 0);
    assert.match(stdout, /Sent\./);
    assert.equal(stub.received.length, 1);
    const batch = stub.received[0] as { version: number; sessions: unknown[] };
    assert.equal(batch.version, 1);
    assert.equal(batch.sessions.length, 1);
  } finally {
    await stub.close();
    cleanup();
  }
});

test("CLI cancels gracefully with piped stdin (n)", async () => {
  const { home, cleanup } = makeFixture();
  const stub = await startStub();
  try {
    const { code, stdout } = await runCli(home, stub.url, "\nn\n");
    assert.equal(code, 0);
    assert.match(stdout, /Cancelled\. Nothing was sent\./);
    assert.equal(stub.received.length, 0);
  } finally {
    await stub.close();
    cleanup();
  }
});

test("CLI exits gracefully on immediate EOF (no hang)", async () => {
  const { home, cleanup } = makeFixture();
  const stub = await startStub();
  try {
    // Old readline code hung forever here; the 20s guard in runCli fails the test.
    const { code, stdout } = await runCli(home, stub.url, "");
    assert.equal(code, 0);
    assert.match(stdout, /Cancelled\. Nothing was sent\./);
    assert.equal(stub.received.length, 0);
  } finally {
    await stub.close();
    cleanup();
  }
});

test("CLI raw tier requires YES with piped stdin", async () => {
  const { home, cleanup } = makeFixture();
  const stub = await startStub();
  try {
    const { code, stdout } = await runCli(home, stub.url, "raw\nno\n");
    assert.equal(code, 0);
    assert.match(stdout, /Cancelled\. Nothing was sent\./);
    assert.equal(stub.received.length, 0);
  } finally {
    await stub.close();
    cleanup();
  }
});
