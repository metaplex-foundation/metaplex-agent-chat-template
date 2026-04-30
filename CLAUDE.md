# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A standalone Next.js 15 / React 19 chat UI that talks to a **PlexChat WebSocket agent server** (a separate process, not in this repo). It was extracted from a monorepo — the README still references the old layout (`pnpm dev:all`, port 3001). The actual scripts live in `package.json` and the dev server runs on **port 3000**.

## Commands

```bash
pnpm dev         # next dev on :3000
pnpm build       # next build
pnpm start       # next start on :3000
pnpm typecheck   # tsc --noEmit (no test runner, no linter configured)
pnpm clean       # rm -rf .next
```

There is no test framework and no ESLint config — `typecheck` is the only programmatic check. Run it after non-trivial edits.

## Connection profiles

There are no env vars. All runtime configuration (WS URL, token, Solana RPC, cluster) lives in `localStorage` under `plexchat-profiles`, managed by `src/lib/profile-store.ts`. The active profile drives both the WebSocket connection (`use-plexchat`) and the Solana `<ConnectionProvider endpoint>`. With no active profile, the app sits disconnected and renders a banner; the wallet adapter falls back to `https://api.devnet.solana.com` so the providers tree still mounts.

Profiles can be shared via URL hash fragments (`#ws=...&token=...&rpc=...&cluster=...&name=...`). On first paint, `page.tsx` decodes the hash, opens the modal in transient mode, and clears the hash so refreshes don't re-prompt.

`src/lib/share-link.ts` owns the encode/decode logic. Tokens go in the hash by design — this is a dev tool and we explicitly accept the shoulder-surfing risk.

## Architecture

The whole app is one client-side page (`src/app/page.tsx`) wrapped in Solana wallet providers (`src/app/providers.tsx`, using Phantom + Solflare adapters). All real logic lives in two hooks:

### `src/hooks/use-plexchat.ts` — the WebSocket lifecycle

Single source of truth for the connection. Owns:

- **Auth via subprotocol, not query string.** The token is sent as the second value in `Sec-WebSocket-Protocol: bearer, <token>`. The server rejects bad tokens with close code **4001**, which the hook treats as terminal (stops reconnecting, surfaces `Unauthorized` to the UI). Other closes trigger exponential backoff (1s → 10s).
- **Outgoing message queue.** Messages sent while the socket is closed/reconnecting are buffered (cap 50) and flushed on the next `connected` event. Don't bypass `send()` and call `ws.send()` directly.
- **Streaming text reconciliation.** `debug:text_delta` events build a streaming agent message; the final `message` event replaces its content and clears the streaming flag. The current streaming id is held in `streamingMsgIdRef`.
- **`wsLog` ring buffer** (capped at 500) feeds the debug panel's Messages tab.

### `src/hooks/use-debug-panel.ts` — trace aggregation

Consumes the `debug:*` events from the same socket and reconstructs per-message traces (steps → tool calls → text deltas → step_complete → generation_complete) plus session token/cost totals. Open/close state and active tab persist via `localStorage` (with try/catch — Safari private mode etc.). Cmd/Ctrl+D toggles.

### `src/lib/profile-store.ts` — connection config

Owns the list of profiles and the active id. `useProfileStore()` is a `useSyncExternalStore`-backed hook so the header pill, modal, and providers tree all see the same state without prop-drilling. Persisted to one `localStorage` key as a single JSON blob.

### `src/types/plexchat-protocol.ts` — the contract

The full PlexChat wire protocol lives here as discriminated unions: `ClientMessage` (message / wallet_connect / wallet_disconnect / tx_result / tx_error) and `ServerMessage` (connected / message / typing / transaction / wallet_* / error / debug:\*). **Any change to the protocol must be made in lockstep with the agent server** — these types are not generated from a shared schema.

### Transaction approval flow

1. Server sends `{ type: 'transaction', transaction: <base64>, correlationId, ... }`.
2. `page.tsx` enqueues it; `TransactionApproval` (`src/components/transaction-approval.tsx`) renders one tx at a time.
3. The component decodes the base64 with `VersionedTransaction.deserialize` for a preview, asks the wallet to sign, sends via `connection.sendRawTransaction`, then `confirmTransaction` with a 60s timeout.
4. On success → `tx_result { correlationId, signature }`. On reject/error → `tx_error { correlationId, reason }` **and the rest of the multi-tx queue is dropped** (`page.tsx` clears the queue on error so the agent decides what to do next based on the error notification).
5. A `beforeunload` handler warns the user if they try to close the tab while a tx is pending — abandoning the correlationId would let the agent time out.

### Path aliases

`@/*` → `./src/*` (configured in `tsconfig.json`). Use it instead of relative paths that climb out of `src/`.

## Things that look wrong but aren't

- **Tokens stored in plaintext localStorage and embedded in share-link hashes.** Intentional — this is a dev tool, and the user explicitly accepted the risk during design.
- **`'use client'` everywhere.** This app has no server components by design — the entire surface is interactive (wallet, WebSocket, debug panel).
- **No reconnect on 4001.** Intentional. A bad token must not loop.
- **Outgoing queue cap of 50.** Intentional bound on offline buffering; messages past the cap are warned and dropped.
