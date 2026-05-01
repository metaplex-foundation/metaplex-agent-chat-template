# RPC Presets + Server Proxy — Design

**Date:** 2026-05-01
**Status:** Designed, not yet implemented
**Builds on:** `docs/plans/2026-04-30-runtime-profile-config-design.md`

## Goal

Replace the free-text RPC URL field in `ProfileForm` with three presets — **mainnet**, **devnet**, **localnet** — plus a **custom** override. The preset URLs are kept on the server and reached via a Next.js API proxy so they never appear in the client bundle, network traffic, or DevTools.

## Non-goals

- WebSocket subscription proxy. `confirmTransaction` will fall back to HTTP polling for preset routes; that's acceptable for a dev tool.
- Per-cluster auth or rate limiting on the proxy. Anyone with access to the deployed instance can use the configured RPCs — operator's responsibility at the deploy layer.
- A "test connection" button in the form.
- Caching of RPC responses on the server.

## Server config + proxy

Two **server-only** env vars (no `NEXT_PUBLIC_` prefix → never bundled into client JS):

| Var | Default if unset |
| --- | --- |
| `MAINNET_RPC_URL` | `https://api.mainnet-beta.solana.com` |
| `DEVNET_RPC_URL` | `https://api.devnet.solana.com` |

No env var for localnet — the localnet preset connects the browser directly to `http://localhost:8899` (server can't reach the user's localhost anyway).

Single API route `src/app/api/rpc/[cluster]/route.ts` (Node runtime, App Router):

```ts
const UPSTREAM: Record<string, () => string> = {
  mainnet: () => process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  devnet:  () => process.env.DEVNET_RPC_URL  ?? 'https://api.devnet.solana.com',
};

export async function POST(req: Request, ctx: { params: Promise<{ cluster: string }> }) {
  const { cluster } = await ctx.params;
  const upstream = UPSTREAM[cluster]?.();
  if (!upstream) return new Response('Unknown cluster', { status: 404 });
  const body = await req.text();
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
```

Streams the response body through. No request modification, no caching. `localnet` is intentionally absent from `UPSTREAM` so the proxy 404s anyone trying to abuse it as a way to reach the server's localhost.

## Profile schema

```ts
export type RpcPreset = 'mainnet' | 'devnet' | 'localnet' | 'custom';

export interface AgentProfile {
  id: string;
  name: string;
  wsUrl: string;
  token: string;
  preset: RpcPreset;
  customRpcUrl?: string;          // only used when preset === 'custom'
  customCluster?: SolanaCluster;  // only used when preset === 'custom'; drives Explorer
  createdAt: number;
}
```

The previous top-level `cluster` and `rpcUrl` fields are gone.

### Derived helpers in `src/lib/profile-store.ts`

```ts
export function effectiveRpcUrl(p: AgentProfile): string {
  const raw = (() => {
    switch (p.preset) {
      case 'mainnet':  return '/api/rpc/mainnet';
      case 'devnet':   return '/api/rpc/devnet';
      case 'localnet': return 'http://localhost:8899';
      case 'custom':   return p.customRpcUrl ?? '';
    }
  })();
  return raw.startsWith('/') && typeof window !== 'undefined'
    ? `${window.location.origin}${raw}`
    : raw;
}

export function effectiveCluster(p: AgentProfile): SolanaCluster {
  switch (p.preset) {
    case 'mainnet':  return 'mainnet-beta';
    case 'devnet':   return 'devnet';
    case 'localnet': return 'devnet'; // Explorer link suppressed in UI for localnet
    case 'custom':   return p.customCluster ?? 'devnet';
  }
}
```

### Migration on localStorage read

`safeRead` rewrites stored profiles missing `preset`:

```
{ rpcUrl, cluster, ... }  →  { preset: 'custom', customRpcUrl: rpcUrl, customCluster: cluster, ... }
```

Existing profiles continue working as `custom` with their old URL; users can re-pick a preset on next edit.

### Validation

`validateProfileInput` only checks `customRpcUrl` and `customCluster` when `preset === 'custom'`. For presets, those fields are ignored.

## UI

### `ProfileForm`

Replace the existing RPC URL + Cluster rows with one **Network** row:

```
Network: [ Mainnet ] [ Devnet ] [ Localnet ] [ Custom ]
```

Same pill style as the current cluster row. Selecting `Custom` reveals two fields below:

- **Custom RPC URL** — text input, validated `http://` / `https://`.
- **Explorer cluster** — small radio row: `mainnet-beta` / `devnet` / `testnet`.

Helper text below the Network row, conditional on the preset:

| Preset | Helper |
| --- | --- |
| mainnet / devnet | Routed through this app's API to keep the RPC URL private. |
| localnet | Connects directly to `http://localhost:8899` — start a local validator. |
| custom | (no helper) |

### Pill + sidebar

No changes — they show name + WS host as before.

### Share-link encoding

`encodeProfileToHash`:

- Preset profile → `#ws=…&token=…&preset=mainnet&name=…`
- Custom profile → `#ws=…&token=…&preset=custom&rpc=…&cluster=devnet&name=…`

`tryDecodeHashToProfile` accepts either:

- New shape (`preset=…`, optional `rpc`/`cluster` for custom).
- Legacy shape (`rpc=…&cluster=…`, no `preset`) → decoded as `preset='custom'`.

## Wiring

### `src/app/providers.tsx`

```tsx
const endpoint = activeProfile ? effectiveRpcUrl(activeProfile) : FALLBACK_RPC;
```

### `src/components/transaction-approval.tsx`

```tsx
const cluster = activeProfile ? effectiveCluster(activeProfile) : 'devnet';
```

Plus: when `activeProfile?.preset === 'localnet'`, hide the "View on Explorer" link entirely.

### `src/hooks/use-plexchat.ts`

No changes — WS URL and token come straight from the profile.

### `confirmTransaction` polling fallback

Solana's `Connection.confirmTransaction` opens a WebSocket to the RPC endpoint for fast-path confirmations. Our HTTP-only proxy means that WS upgrade fails and web3.js falls back to polling. Result: preset confirmations take ~5–10s longer than direct connections. Custom and localnet routes aren't affected. Acceptable for a dev tool; documented in CLAUDE.md.

## File plan

### New

- `src/app/api/rpc/[cluster]/route.ts`
- `.env.local.example` (re-introduced — server-only this time)

### Modified

- `src/lib/profile-store.ts` — schema, helpers, migration, validation.
- `src/lib/share-link.ts` — encode/decode `preset`; accept legacy `rpc`+`cluster`.
- `src/components/profile/profile-form.tsx` — Network row + conditional custom fields.
- `src/components/profile/profile-modal.tsx` — uses new share-link encoder (no API change).
- `src/app/providers.tsx` — `effectiveRpcUrl(activeProfile)`.
- `src/components/transaction-approval.tsx` — `effectiveCluster`, hide Explorer on localnet.
- `README.md` — document env vars and that they stay server-only.
- `CLAUDE.md` — note proxy + polling-fallback under Architecture; env vars under "Connection profiles".

### No dep changes

`fetch` is built into Next.js Node runtime; no new packages.

## Open questions / future work

- WebSocket-RPC proxy for instant confirmations. Doubles the proxy surface; revisit only if polling latency becomes a real problem.
- Per-cluster ACL or rate limiting on the proxy. Today: trust whoever can reach the deployed instance.
- "Test connection" affordance in the form (ping `getHealth` against the chosen preset).
