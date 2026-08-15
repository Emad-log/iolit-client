#!/usr/bin/env node
// Iolit CLI: detect -> preview -> approve -> send, plus `iolit history`.

import { findClaudeSessions } from "./detect.js";
import { findCursorSessions } from "./detect-cursor.js";
import { findCodexSessions } from "./detect-codex.js";
import { findCopilotSessions } from "./detect-copilot.js";
import { buildPayload, hasSessions } from "./payload.js";
import { send } from "./send.js";
import { recordSent, readHistory } from "./history.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const RATE_PER_MILLION_TOKENS = 3;

async function collectSessions() {
  return [
    ...(await findClaudeSessions()),
    ...findCursorSessions(),
    ...findCodexSessions(),
    ...findCopilotSessions(),
  ];
}

async function submit() {
  const sessions = await collectSessions();
  const payload = buildPayload(sessions);

  if (!hasSessions(payload)) {
    console.log("No sessions found. Nothing to send.");
    return;
  }

  const tokens = sessions.reduce((a, s) => a + s.tokensIn + s.tokensOut, 0);
  const kb = Math.max(1, Math.round(tokens / 1000));
  const est = Math.round(((tokens / 1_000_000) * RATE_PER_MILLION_TOKENS) * 100) / 100;
  const tools = [...new Set(sessions.map((s) => s.tool))].join(", ");

  console.log("");
  console.log("  Iolit, ready to submit a batch");
  console.log("  " + "-".repeat(36));
  console.log(`  Sessions:  ${sessions.length}  (${tools})`);
  console.log(`  Models:    ${[...new Set(sessions.map((s) => s.model))].join(", ")}`);
  console.log(`  Size:      ~${kb} KB`);
  console.log(`  Estimate:  $${est.toFixed(2)} (unverified, buyers set real price)`);
  const types = [...new Set(sessions.map((s) => s.taskType))].join(", ");
  console.log(`  Task types: ${types}`);
  console.log("  Content:   structured metadata only, no prompts, no code, no paths");
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });
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
    console.log(
      `  ${e.sentAt.slice(0, 16).replace("T", " ")}  ${e.batchId}  ${e.sessions} sessions  ~${e.sizeKb} KB  est $${e.estUsd.toFixed(2)}`
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
