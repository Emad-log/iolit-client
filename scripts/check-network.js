// CI guard: the client must have EXACTLY one network call site.
// Fails the build if a second fetch/axios/http.request ever appears.
// This is the "audit the one call" promise, enforced by machine.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const files = readdirSync(src, { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".ts"))
  .map((f) => join(src, f));

let hits = 0;
const details = [];
const re = /\b(fetch|axios|http\.request|https\.request)\s*\(/g;

for (const file of files) {
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(re)) {
    hits += 1;
    details.push(`${file}: ${m[0].trim()}`);
  }
}

if (hits !== 1) {
  console.error(`FAIL: expected exactly 1 network call site, found ${hits}`);
  for (const d of details) console.error("  " + d);
  process.exit(1);
}
console.log("OK: exactly 1 network call site (src/send.ts)");
