// THE ONLY NETWORK CALL IN THE CLIENT.
// Grep the repo for fetch/axios/http, this is the single hit.
// The CI check (scripts/check-network.js) fails the build if another appears.

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
