# PlexChat Test UI

Generic Next.js client for any PlexChat WebSocket agent. Multiple connection profiles are managed in-app and persisted to `localStorage` — no env vars required.

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
| Solana RPC URL | RPC endpoint used by the wallet adapter |
| Cluster | `mainnet-beta` / `devnet` / `testnet` — drives Explorer links |

## Sharing a profile

In the profile editor, click **Copy share link**. The URL contains the profile in its hash fragment (`#ws=...&token=...&rpc=...&cluster=...&name=...`). Opening it on another machine pre-fills the form in transient mode — nothing is saved until you click **Save** or **Save & Connect**.

Hash fragments are not sent to servers (no Referer/proxy leakage), but they appear in browser history and are visible to anyone with screen access. Treat tokens accordingly.

## Features

- Multiple named connection profiles, switchable from the header
- Hash-fragment share links for transient connections
- Real Solana wallet (Phantom, Solflare) via wallet-adapter
- WebSocket auto-reconnect with exponential backoff
- Streaming agent responses, typing indicator
- Transaction approval flow (sign + send in browser)
- Debug panel with per-step traces and token totals (Cmd/Ctrl+D)
