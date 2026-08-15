// The only network call in the client. CI enforces single call site (scripts/check-network.js).

const DEFAULT_ENDPOINT = "https://iolit.dev/api/v1/batches";

export async function send(payload: unknown): Promise<boolean> {
  const endpoint = process.env.IOLIT_API ?? DEFAULT_ENDPOINT;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
