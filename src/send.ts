// The only network call. CI fails if a second site appears.

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
