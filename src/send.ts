// THE ONLY NETWORK CALL IN THE CLIENT.
// Grep the repo for fetch/axios/http — this is the single hit.
// The CI check (scripts/check-network.js) fails the build if another appears.

const ENDPOINT = "https://api.iolit.dev/v1/batches";

export async function send(payload: unknown): Promise<boolean> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
