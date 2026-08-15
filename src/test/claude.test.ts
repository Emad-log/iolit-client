import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeSession } from "../detect.js";

const sample = [
  JSON.stringify({
    type: "user",
    timestamp: "2026-04-13T11:35:00.376Z",
    cwd: "/home/ubuntu/koa-app",
    gitBranch: "master",
    version: "2.1.77",
    message: { role: "user", content: "deploy the staging build" },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-04-13T11:35:03.572Z",
    cwd: "/home/ubuntu/koa-app",
    gitBranch: "master",
    version: "2.1.77",
    message: {
      model: "claude-opus-4-6",
      stop_reason: "tool_use",
      usage: {
        input_tokens: 1,
        output_tokens: 134,
        cache_creation_input_tokens: 857,
        cache_read_input_tokens: 79442,
        service_tier: "standard",
        speed: "standard",
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 },
      },
      content: [
        { type: "thinking", thinking: "need to copy the build" },
        { type: "tool_use", name: "Bash", input: { command: "ls package.json", description: "list" } },
        { type: "tool_use", name: "Read", input: { file_path: "/home/ubuntu/koa-app/src/app.ts" } },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-04-13T11:36:16.567Z",
    toolUseResult: "Error: Exit code 1",
    message: {
      role: "user",
      content: [{ type: "tool_result", is_error: true, content: "fail" }],
    },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-04-13T11:36:27.486Z",
    message: {
      model: "claude-opus-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 80 },
      content: [{ type: "text", text: "done" }],
    },
  }),
].join("\n");

test("claude: extracts loop shape, cache, tools, duration", () => {
  const s = parseClaudeSession(sample);
  assert.ok(s);
  assert.equal(s.tool, "claude");
  assert.equal(s.model, "claude-opus-4-6");
  assert.equal(s.tokensIn, 11);
  assert.equal(s.tokensOut, 214);
  assert.equal(s.cacheReadTokens, 79442);
  assert.equal(s.cacheCreationTokens, 857);
  assert.ok(s.cacheHitRatio > 0.9);
  assert.equal(s.webFetchRequests, 1);
  assert.equal(s.userTurns, 1);
  assert.equal(s.assistantTurns, 2);
  assert.equal(s.durationSec, 87);
  assert.equal(s.startedAt, "2026-04-13T11:35:00.376Z");
  assert.equal(s.endedAt, "2026-04-13T11:36:27.486Z");
  assert.ok(s.toolsUsed.includes("Bash"));
  assert.ok(s.toolsUsed.includes("Read"));
  assert.deepEqual(s.toolSequence, ["Bash", "Read"]);
  assert.ok(s.langHints.includes("ts"));
  assert.ok(s.langHints.includes("json"));
  assert.equal(s.hasGit, true);
  assert.equal(s.branchClass, "main");
  assert.equal(s.cwdHash.length, 12);
  assert.equal(s.thinkingBlocks, 1);
  assert.equal(s.lastStopReason, "end_turn");
  assert.ok(s.toolErrorCount >= 1);
  assert.equal(s.taskType, "code");
  assert.equal(s.cliVersion, "2.1.77");
});

test("claude: never copies free text or paths", () => {
  const s = parseClaudeSession(sample);
  const json = JSON.stringify(s);
  assert.equal(json.includes("deploy the staging"), false);
  assert.equal(json.includes("/home/ubuntu"), false);
  assert.equal(json.includes("need to copy"), false);
});
