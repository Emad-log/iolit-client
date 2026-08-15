// Public payload schema. If a field isn't here, the client never sends it.

export type ToolName = "claude" | "cursor" | "codex" | "copilot";
export type ShareTier = "pulse" | "trace" | "raw";

export interface ToolCallStat {
  name: string;
  count: number;
  errors: number;
}

export interface StopReasonStat {
  reason: string;
  count: number;
}

export interface ToolEvent {
  name: string;
  error: boolean;
  exitCode: number | null;
  argKeys: string[];
  inputPreview: string;
  resultPreview: string;
}

export interface SessionMeta {
  tool: ToolName;
  model: string;
  modelsUsed: string[];
  startedAt: string;
  endedAt: string;
  durationSec: number;
  hourOfDay: number;
  dayOfWeek: number;
  cliVersion: string;
  userTurns: number;
  assistantTurns: number;
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHitRatio: number;
  webSearchRequests: number;
  webFetchRequests: number;
  serviceTier: string;
  speed: string;
  taskType: string;
  success: boolean;
  lastStopReason: string;
  apiErrorCount: number;
  toolErrorCount: number;
  toolCallCount: number;
  toolsUsed: string[];
  toolCalls: ToolCallStat[];
  toolSequence: string[];
  thinkingBlocks: number;
  thinkingChars: number;
  textCharsOut: number;
  userCharsIn: number;
  isSubagent: boolean;
  cwdHash: string;
  hasGit: boolean;
  branchClass: string;
  langHints: string[];
  permissionMode: string;
  stopReasons: StopReasonStat[];
  shareTier: ShareTier;
  toolEvents: ToolEvent[];
  userPromptPreview: string;
  assistantPreview: string;
  thinkingPreview: string;
}

export interface BatchPayload {
  version: 1;
  app: "iolit";
  batchId: string;
  createdAt: string;
  shareTier: ShareTier;
  sessions: SessionMeta[];
}

export const SESSION_KEYS = [
  "tool", "model", "modelsUsed", "startedAt", "endedAt", "durationSec",
  "hourOfDay", "dayOfWeek", "cliVersion",
  "userTurns", "assistantTurns",
  "tokensIn", "tokensOut", "cacheCreationTokens", "cacheReadTokens", "cacheHitRatio",
  "webSearchRequests", "webFetchRequests", "serviceTier", "speed",
  "taskType", "success", "lastStopReason", "apiErrorCount",
  "toolErrorCount", "toolCallCount", "toolsUsed", "toolCalls", "toolSequence",
  "thinkingBlocks", "thinkingChars", "textCharsOut", "userCharsIn",
  "isSubagent", "cwdHash", "hasGit", "branchClass", "langHints",
  "permissionMode", "stopReasons",
  "shareTier", "toolEvents", "userPromptPreview", "assistantPreview", "thinkingPreview",
] as const;

export const BATCH_KEYS = ["version", "app", "batchId", "createdAt", "shareTier", "sessions"] as const;
