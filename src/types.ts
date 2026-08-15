// Public payload schema. If a field isn't here, the client never sends it.

export interface SessionMeta {
  tool: "claude" | "cursor" | "codex";
  model: string;
  startedAt: string; // ISO
  durationSec: number;
  tokensIn: number;
  tokensOut: number;
  taskType: string; // inferred locally: "code" | "refactor" | "debug" | "explain" | ...
  success: boolean;
  toolsUsed: string[];
  hourOfDay: number; // 0-23 local
}

export interface BatchPayload {
  version: 1;
  app: "iolit";
  batchId: string;
  createdAt: string;
  sessions: SessionMeta[];
}
