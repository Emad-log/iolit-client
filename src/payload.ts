// Pure function: session metadata in, JSON payload out. The entire trust surface.

import type { BatchPayload, SessionMeta } from "./types.js";

export function buildPayload(sessions: SessionMeta[]): BatchPayload {
  return {
    version: 1,
    app: "iolit",
    batchId: randomId(),
    createdAt: new Date().toISOString(),
    sessions: sessions.map(cloneSession),
  };
}

export function hasSessions(p: BatchPayload): boolean {
  return p.sessions.length > 0;
}

function cloneSession(s: SessionMeta): SessionMeta {
  return {
    ...s,
    modelsUsed: [...s.modelsUsed],
    toolsUsed: [...s.toolsUsed],
    toolCalls: s.toolCalls.map((t) => ({ ...t })),
    toolSequence: [...s.toolSequence],
    langHints: [...s.langHints],
    stopReasons: s.stopReasons.map((r) => ({ ...r })),
  };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
