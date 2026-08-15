#!/usr/bin/env node
// Iolit CLI: detect -> preview tiers -> approve -> send, plus `iolit history`.

import { findClaudeSessions } from "./detect.js";
import { findCursorSessions } from "./detect-cursor.js";
import { findCodexSessions } from "./detect-codex.js";
import { buildPayload, hasSessions } from "./payload.js";
import { send } from "./send.js";
import { recordSent, readHistory } from "./history.js";
import { estimateUsd, isShareTier } from "./tiers.js";
import type { ShareTier } from "./types.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function collectSessions() {
  return [
    ...(await findClaudeSessions()),
    ...findCursorSessions(),
    ...findCodexSessions(),
  ];
}

async function submit() {
  const sessions = await collectSessions();
  if (sessions.length === 0) {
    console.log("No sessions found. Nothing to send.");
    return;
  }

  const tools = [...new Set(sessions.map((s) => s.tool))].join(", ");
  const types = [...new Set(sessions.map((s) => s.taskType))].join(", ");
  const events = sessions.reduce((a, s) => a + s.toolEvents.length, 0);
  const pulse = estimateUsd(sessions, "pulse");
  const trace = estimateUsd(sessions, "trace");
  const raw = estimateUsd(sessions, "raw");

  console.log("");
  console.log("  Iolit, ready to submit a batch");
  console.log("  " + "-".repeat(36));
  console.log(`  Sessions:   ${sessions.length}  (${tools})`);
  console.log(`  Models:     ${[...new Set(sessions.map((s) => s.model))].join(", ")}`);
  console.log(`  Task types: ${types}`);
  console.log(`  Tool events captured: ${events}`);
  console.log("");
  console.log("  Share more, get paid more. Pick a tier.");
  console.log(`  pulse  stats only                         est $${pulse.toFixed(2)}`);
  console.log(`  trace  tool args + results, paths scrubbed est $${trace.toFixed(2)}`);
  console.log(`  raw    also prompts + replies + thinking   est $${raw.toFixed(2)}`);
  console.log("  Estimates unverified. Buyers set the real price.");
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });
  const pick = (await rl.question("  Tier? (pulse/trace/raw, default pulse) ")).trim().toLowerCase();
  const tier: ShareTier = isShareTier(pick) ? pick : "pulse";

  if (tier === "raw") {
    const confirm = (await rl.question("  RAW includes prompts and code. Type YES to continue: ")).trim();
    if (confirm !== "YES") {
      rl.close();
      console.log("  Cancelled. Nothing was sent.");
      return;
    }
  }

  const payload = buildPayload(sessions, tier);
  if (!hasSessions(payload)) {
    rl.close();
    console.log("No sessions found. Nothing to send.");
    return;
  }

  const kb = Math.max(1, Math.round(JSON.stringify(payload).length / 1024));
  const est = estimateUsd(sessions, tier);
  console.log(`  Selected: ${tier}  ~${kb} KB  est $${est.toFixed(2)}`);
  const answer = await rl.question("  Submit this batch? (y/N) ");
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.log("  Cancelled. Nothing was sent.");
    return;
  }

  const ok = await send(payload);
  if (ok) {
    recordSent({
      batchId: payload.batchId,
      sentAt: new Date().toISOString(),
      sessions: sessions.length,
      sizeKb: kb,
      estUsd: est,
      shareTier: tier,
    });
    console.log("  Sent.");
  } else {
    console.log("  Failed to send.");
  }
}

function history() {
  const entries = readHistory();
  if (entries.length === 0) {
    console.log("No batches sent yet.");
    return;
  }
  console.log("");
  console.log(`  Batches sent: ${entries.length}`);
  console.log("  " + "-".repeat(36));
  let totalUsd = 0;
  for (const e of entries) {
    totalUsd += e.estUsd;
    const tier = e.shareTier ? `  ${e.shareTier}` : "";
    console.log(
      `  ${e.sentAt.slice(0, 16).replace("T", " ")}  ${e.batchId}  ${e.sessions} sessions  ~${e.sizeKb} KB  est $${e.estUsd.toFixed(2)}${tier}`
    );
  }
  console.log("  " + "-".repeat(36));
  console.log(`  Total est: $${totalUsd.toFixed(2)} (unverified)`);
}

const cmd = process.argv[2];
if (cmd === "history") {
  history();
} else {
  submit().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
