// Minimal line prompt that behaves the same on a TTY and with piped stdin.
//
// node:readline/promises hangs on the *second* question when stdin is a pipe:
// once the pipe delivers EOF the interface closes and the pending question
// never settles, killing the process silently. Reading lines ourselves avoids
// that: piped lines are consumed in order, and EOF resolves to "" (which the
// CLI already treats as default / cancel).

import { stdin, stdout } from "node:process";

let pending = "";
let ended = false;
let wake: (() => void) | null = null;
let attached = false;

function onData(chunk: string): void {
  pending += chunk;
  const w = wake;
  if (w && pending.includes("\n")) {
    wake = null;
    w();
  }
}

function onEnd(): void {
  ended = true;
  const w = wake;
  if (w) {
    wake = null;
    w();
  }
}

function attach(): void {
  if (attached) return;
  attached = true;
  stdin.setEncoding("utf8");
  stdin.on("data", onData);
  stdin.on("end", onEnd);
}

function takeLine(): string {
  const nl = pending.indexOf("\n");
  const line = nl >= 0 ? pending.slice(0, nl) : pending;
  pending = nl >= 0 ? pending.slice(nl + 1) : "";
  return line.replace(/\r$/, "");
}

/**
 * Print the query and resolve with one line of input (no trailing newline).
 * At EOF resolves with whatever is left, or "".
 */
export function ask(query: string): Promise<string> {
  attach();
  stdout.write(query);
  if (stdin.readableEnded) ended = true;
  if (pending.includes("\n") || ended) return Promise.resolve(takeLine());
  return new Promise((resolve) => {
    wake = () => resolve(takeLine());
    stdin.resume();
  });
}

/** Stop listening on stdin so the process can exit cleanly. */
export function closePrompts(): void {
  if (attached) {
    stdin.off("data", onData);
    stdin.off("end", onEnd);
    stdin.pause();
  }
  const w = wake;
  wake = null;
  if (w) w();
}
