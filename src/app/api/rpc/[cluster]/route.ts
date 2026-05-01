export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64_000;

const UPSTREAM: Record<string, () => string> = {
  mainnet: () => process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  devnet:  () => process.env.DEVNET_RPC_URL  ?? 'https://api.devnet.solana.com',
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ cluster: string }> },
) {
  const { cluster } = await ctx.params;
  const resolve = UPSTREAM[cluster];
  if (!resolve) return new Response('Unknown cluster', { status: 404 });
  const upstream = resolve();
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response('Body too large', { status: 413 });
  }
  const r = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
