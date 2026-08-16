// Shared defaults and coarse inference. No free text or paths.

import { createHash } from "node:crypto";
import type { SessionMeta, ToolCallStat, ToolName } from "./types.js";

const SEQ_CAP = 80;

export function emptySession(tool: ToolName): SessionMeta {
  return {
    tool,
    model: "unknown",
    modelsUsed: [],
    startedAt: "",
    endedAt: "",
    durationSec: 0,
    hourOfDay: 0,
    dayOfWeek: 0,
    cliVersion: "",
    userTurns: 0,
    assistantTurns: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    serviceTier: "",
    speed: "",
    taskType: "unknown",
    success: false,
    lastStopReason: "",
    apiErrorCount: 0,
    toolErrorCount: 0,
    toolCallCount: 0,
    toolsUsed: [],
    toolCalls: [],
    toolSequence: [],
    thinkingBlocks: 0,
    thinkingChars: 0,
    textCharsOut: 0,
    userCharsIn: 0,
    isSubagent: false,
    cwdHash: "",
    hasGit: false,
    branchClass: "unknown",
    langHints: [],
    permissionMode: "",
    stopReasons: [],
    shareTier: "pulse",
    toolEvents: [],
    userPromptPreview: "",
    assistantPreview: "",
    thinkingPreview: "",
  };
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function classifyBranch(branch: string): string {
  if (!branch) return "unknown";
  if (branch === "HEAD") return "detached";
  if (branch === "main" || branch === "master") return "main";
  return "other";
}

export function extHint(value: string): string | null {
  const m = value.match(/\.([a-zA-Z0-9]{1,8})(?:$|[/?#])/);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (/^\d+$/.test(ext)) return null;
  return ext;
}

export function finishSession(s: SessionMeta, toolSeq: string[], langs: Set<string>): SessionMeta {
  s.toolSequence = toolSeq.slice(0, SEQ_CAP);
  s.langHints = Array.from(langs).sort();
  s.toolsUsed = s.toolCalls.map((t) => t.name);
  s.toolCallCount = s.toolCalls.reduce((a, t) => a + t.count, 0);
  s.toolErrorCount = s.toolCalls.reduce((a, t) => a + t.errors, 0);
  const cacheTotal = s.cacheCreationTokens + s.cacheReadTokens;
  s.cacheHitRatio = cacheTotal > 0 ? round3(s.cacheReadTokens / cacheTotal) : 0;
  if (s.startedAt) {
    const start = new Date(s.startedAt);
    if (!Number.isNaN(start.getTime())) {
      s.hourOfDay = start.getHours();
      s.dayOfWeek = start.getDay();
    }
  }
  if (s.startedAt && s.endedAt) {
    const a = Date.parse(s.startedAt);
    const b = Date.parse(s.endedAt);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
      s.durationSec = Math.round((b - a) / 1000);
    }
  }
  if (!s.startedAt) s.startedAt = new Date().toISOString();
  if (!s.endedAt) s.endedAt = s.startedAt;
  s.taskType = inferTaskType(s);
  return s;
}

export function bumpTool(calls: Map<string, ToolCallStat>, name: string, errored = false): void {
  const cur = calls.get(name) ?? { name, count: 0, errors: 0 };
  cur.count += 1;
  if (errored) cur.errors += 1;
  calls.set(name, cur);
}

export function applyToolMap(s: SessionMeta, calls: Map<string, ToolCallStat>): void {
  s.toolCalls = Array.from(calls.values()).sort((a, b) => b.count - a.count);
}

export function inferTaskType(s: SessionMeta): string {
  if (s.isSubagent) return "agent";
  if (s.toolErrorCount >= 3 && s.toolCallCount > 0 && s.toolErrorCount >= s.toolCallCount) return "debug";
  const writes = countNames(s, ["edit", "write", "applypatch", "strreplace", "create_file"]);
  const reads = countNames(s, ["read", "grep", "glob", "search", "semanticsearch"]);
  const bash = countNames(s, ["bash", "shell", "run_terminal_cmd"]);
  const agents = countNames(s, ["agent", "task"]);
  if (agents > 0 && agents >= writes + reads + bash) return "agent";
  if (writes > 0) return "code";
  if (bash > 0 && reads > 0) return "code";
  if (bash > 0 && writes === 0 && reads === 0) return "ops";
  if (reads > 0 && writes === 0) return "explore";
  if (s.userTurns > 0 && s.toolCallCount === 0) return "chat";
  return "unknown";
}

function countNames(s: SessionMeta, names: string[]): number {
  return s.toolCalls
    .filter((t) => names.includes(t.name.toLowerCase()))
    .reduce((a, t) => a + t.count, 0);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
