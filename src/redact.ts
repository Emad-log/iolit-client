// Strip secrets and full paths from anything a higher tier may send.

// Well-known prefixes worth catching explicitly: the entropy backstop
// below can miss short or low-entropy-shaped live credentials (e.g. AWS
// temporary keys are only 20 chars and score ~3.6 bits/char).
const SECRET_RE =
  /(?:sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|gho_[A-Za-z0-9]+|ghu_[A-Za-z0-9]+|ghs_[A-Za-z0-9]+|ghr_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+|AIza[0-9A-Za-z_-]{35}|cfut_[A-Za-z0-9]+|cfk_[A-Za-z0-9]+|cfat_[A-Za-z0-9]+|dsk_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._\-]+|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})/g;

// Backstop for key formats the denylist doesn't know: a long run of
// token-like characters with high Shannon entropy per character.
// Random base62/base64 tokens sit at ~5.0+; git SHAs and UUIDs top out
// near 4.0, English words and identifiers lower. Errs toward redacting:
// a false positive costs a scrubbed hash in training data, a false
// negative leaks a live credential. The run alphabet includes "/"
// because standard base64 tokens contain it; without it a single slash
// splits a token into sub-20-char runs that evade the length floor.
const TOKEN_RUN_RE = /[A-Za-z0-9_\-+~=.\\/]{20,}/g;
const ENTROPY_THRESHOLD = 4.3;

function shannonPerChar(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_RE, "[redacted]")
    .replace(TOKEN_RUN_RE, (m) => (shannonPerChar(m) >= ENTROPY_THRESHOLD ? "[redacted]" : m));
}

const UNIX_PATH_RE = /(?:\/[\w.+@-]+){2,}/g;
const WIN_PATH_RE = /[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s\\]+/g;

export const PREVIEW_CAP = 240;
export const EVENT_CAP = 80;

export function scrubPaths(text: string): string {
  return text
    .replace(UNIX_PATH_RE, (m) => "*/" + (m.split("/").pop() || "path"))
    .replace(WIN_PATH_RE, (m) => "*/" + (m.split("\\").pop() || "path"));
}

export function preview(text: string, cap = PREVIEW_CAP): string {
  const clean = scrubPaths(redactSecrets(text)).replace(/\s+/g, " ").trim();
  if (clean.length <= cap) return clean;
  return clean.slice(0, cap);
}

export function parseExitCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const m = value.match(/exit code[:\s]+(-?\d+)/i);
  return m ? Number(m[1]) : null;
}

export function summarizeInput(input: Record<string, unknown> | null): string {
  if (!input) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") parts.push(`${k}=${v}`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${v}`);
  }
  return parts.join(" ");
}

export function resultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}
