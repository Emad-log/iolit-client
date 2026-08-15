// Strip secrets and full paths from anything a higher tier may send.

const SECRET_RE =
  /(?:sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|cfut_[A-Za-z0-9]+|cfk_[A-Za-z0-9]+|cfat_[A-Za-z0-9]+|dsk_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._\-]+|AKIA[0-9A-Z]{16})/g;

const UNIX_PATH_RE = /(?:\/[\w.+@-]+){2,}/g;
const WIN_PATH_RE = /[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s\\]+/g;

export const PREVIEW_CAP = 240;
export const RAW_TEXT_CAP = 4000;
export const EVENT_CAP = 80;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, "[redacted]");
}

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

export function joinPreview(parts: string[], cap = RAW_TEXT_CAP): string {
  return preview(parts.join("\n"), cap);
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
