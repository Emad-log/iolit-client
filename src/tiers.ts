// Project a full local extract down to the consented share tier.

import { EVENT_CAP } from "./redact.js";
import type { SessionMeta, ShareTier, ToolEvent } from "./types.js";

export const TIER_MULT: Record<ShareTier, number> = {
  pulse: 1,
  trace: 4,
  raw: 12,
};

export const RATE_PER_MILLION_TOKENS = 3;

export function isShareTier(v: string): v is ShareTier {
  return v === "pulse" || v === "trace" || v === "raw";
}

export function tokenVolume(s: SessionMeta): number {
  return s.tokensIn + s.tokensOut + s.cacheCreationTokens + s.cacheReadTokens;
}

export function estimateUsd(sessions: SessionMeta[], tier: ShareTier): number {
  const tokens = sessions.reduce((a, s) => a + tokenVolume(s), 0);
  return Math.round((tokens / 1_000_000) * RATE_PER_MILLION_TOKENS * TIER_MULT[tier] * 100) / 100;
}

export function applyTier(session: SessionMeta, tier: ShareTier): SessionMeta {
  const next: SessionMeta = {
    ...session,
    modelsUsed: [...session.modelsUsed],
    toolsUsed: [...session.toolsUsed],
    toolCalls: session.toolCalls.map((t) => ({ ...t })),
    toolSequence: [...session.toolSequence],
    langHints: [...session.langHints],
    stopReasons: session.stopReasons.map((r) => ({ ...r })),
    shareTier: tier,
    toolEvents: [],
    userPromptPreview: "",
    assistantPreview: "",
    thinkingPreview: "",
  };
  if (tier === "pulse") return next;
  next.toolEvents = session.toolEvents.slice(0, EVENT_CAP).map(cloneEvent);
  if (tier === "raw") {
    next.userPromptPreview = session.userPromptPreview;
    next.assistantPreview = session.assistantPreview;
    next.thinkingPreview = session.thinkingPreview;
  }
  return next;
}

function cloneEvent(e: ToolEvent): ToolEvent {
  return { ...e, argKeys: [...e.argKeys] };
}
