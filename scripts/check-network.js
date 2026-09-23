// CI guard: the client must have EXACTLY one network call site (src/send.ts),
// and production code must not import any other network-capable module.
// Fails the build if a second way to reach the internet ever appears.
// This is the "audit the one call" promise, enforced by machine.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const files = readdirSync(src, { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".ts"))
  .map((f) => join(src, f));

// Direct call sites. Exactly one must exist: the fetch in src/send.ts.
// (Word-boundary matching also catches globalThis.fetch and friends,
// while stmt.get / byCallId.get do not match the https?.get pattern.)
const CALL_RES = [
  /\bfetch\s*\(/g,
  /\baxios\s*\(/g,
  /\bhttps?\.request\s*\(/g,
  /\bhttps?\.get\s*\(/g,
  /\bnew\s+WebSocket\s*\(/g,
  /\bnew\s+EventSource\s*\(/g,
  /\bsendBeacon\s*\(/g,
];

// Network-capable Node modules. Production code must not import any of
// them: the single call site uses the fetch global only, so there is no
// legitimate reason to. Test files are exempt: prompt.test.ts runs a
// localhost stub server to test the CLI end to end.
const BANNED_IMPORT_RE = /["']node:(https?|net|dgram|dns|tls)["']/;

let callHits = 0;
const callDetails = [];
const bannedImports = [];

for (const file of files) {
  const code = readFileSync(file, "utf8");
  for (const re of CALL_RES) {
    for (const m of code.matchAll(re)) {
      callHits += 1;
      callDetails.push(`${file}: ${m[0].trim()}`);
    }
  }
  if (!file.includes("/test/") && !file.includes("\\test\\") && BANNED_IMPORT_RE.test(code)) {
    bannedImports.push(file);
  }
}

let failed = false;

if (callHits !== 1) {
  console.error(`FAIL: expected exactly 1 network call site, found ${callHits}`);
  for (const d of callDetails) console.error("  " + d);
  failed = true;
}

if (bannedImports.length > 0) {
  console.error("FAIL: network-capable module imported outside tests:");
  for (const f of bannedImports) console.error("  " + f);
  failed = true;
}

if (failed) process.exit(1);
console.log("OK: exactly 1 network call site (src/send.ts), no other network imports");
