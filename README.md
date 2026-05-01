# PlexChat Test UI

Generic Next.js client for any PlexChat WebSocket agent. Multiple connection profiles are managed in-app and persisted to `localStorage`.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The first run prompts you to create a connection profile.

## Profile fields

| Field | Description |
| --- | --- |
| Name | Friendly label for the profile |
| WebSocket URL | Full URL: `ws://localhost:3002` or `wss://agent.example.com:3002` |
| Token | Shared secret matching the server's `WEB_CHANNEL_TOKEN` (≥32 chars) |
| Network | `Mainnet` / `Devnet` / `Localnet` (presets) or `Custom` |
| Custom RPC URL | Only when Network is Custom — your own RPC endpoint |
| Explorer cluster | Only when Network is Custom — drives Solana Explorer links |

## Network presets

| Preset | RPC routing |
| --- | --- |
| Mainnet | Browser → `/api/rpc/mainnet` → server → `MAINNET_RPC_URL` (defaults to public RPC) |
| Devnet | Browser → `/api/rpc/devnet` → server → `DEVNET_RPC_URL` (defaults to public RPC) |
| Localnet | Browser → `http://localhost:8899` directly (no proxy; you run the validator) |
| Custom | Browser → your URL directly |

The mainnet and devnet presets route through this app's API so the upstream RPC URL stays on the server. To use a paid RPC, set `MAINNET_RPC_URL` / `DEVNET_RPC_URL` in `.env.local` (server-only — no `NEXT_PUBLIC_` prefix). See `.env.local.example`.

Note: Solana's `confirmTransaction` uses a WebSocket subscription on direct connections. The proxy is HTTP-only, so preset confirmations fall back to polling and take ~5–10s longer than direct RPCs. Custom and Localnet aren't affected.

## Sharing a profile

In the profile editor, click **Copy share link**. The URL contains the profile in its hash fragment (e.g. `#ws=…&token=…&preset=devnet&name=…`). Opening it on another machine pre-fills the form in transient mode — nothing is saved until you click **Save** or **Save & Connect**.

Hash fragments are not sent to servers (no Referer/proxy leakage), but they appear in browser history and are visible to anyone with screen access. Treat tokens accordingly.

## Features

- Mainnet / Devnet / Localnet presets plus Custom RPC override
- Multiple named connection profiles, switchable from the header
- Hash-fragment share links for transient connections
- Real Solana wallet (Phantom, Solflare) via wallet-adapter
- WebSocket auto-reconnect with exponential backoff
- Streaming agent responses, typing indicator
- Transaction approval flow (sign + send in browser)
- Debug panel with per-step traces and token totals (Cmd/Ctrl+D)
