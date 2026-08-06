#!/usr/bin/env node
// Iolit CLI v1: detect -> preview -> approve -> send.
// The preview screen is the product: nothing leaves without a yes.

import { findClaudeSessions } from "./detect.js";
import { findCursorSessions } from "./detect-cursor.js";
import { buildPayload, hasSessions } from "./payload.js";
import { send } from "./send.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const RATE_PER_MILLION_TOKENS = 3;

async function main() {
  const sessions = [...(await findClaudeSessions()), ...findCursorSessions()];
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
  console.log("  Content:   metadata only, no prompts, no code, no paths");
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question("  Submit this batch? (y/N) ");
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.log("  Cancelled. Nothing was sent.");
    return;
  }

  const ok = await send(payload);
  console.log(ok ? "  Sent." : "  Failed to send.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
