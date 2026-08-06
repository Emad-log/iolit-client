// Local ledger of sent batches. Append-only JSONL under ~/.iolit/.
// Powers `iolit history`; also the receipts a seller can check against the API.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_DIR = join(homedir(), ".iolit");

export interface HistoryEntry {
  batchId: string;
  sentAt: string;
  sessions: number;
  sizeKb: number;
  estUsd: number;
}

export function recordSent(entry: HistoryEntry, dir = DEFAULT_DIR) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "history.jsonl"), JSON.stringify(entry) + "\n");
}

export function readHistory(dir = DEFAULT_DIR): HistoryEntry[] {
  const file = join(dir, "history.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as HistoryEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is HistoryEntry => e !== null);
}
