// The only network call. CI fails if a second site appears.

const DEFAULT_ENDPOINT = "https://iolit.dev/api/v1/batches";
const SEND_TIMEOUT_MS = 20_000;

export async function send(payload: unknown): Promise<boolean> {
  const endpoint = process.env.IOLIT_API ?? DEFAULT_ENDPOINT;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Never hang the CLI forever on a dead network.
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // DNS failure, refused connection, timeout: report as a failed send,
    // not an uncaught exception.
    return false;
  }
}
