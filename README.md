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
| Network | `Mainnet` / `Devnet` / `Localnet` (presets) or `Custom` |
| Custom RPC URL | Only when Network is Custom — your own RPC endpoint |
| Explorer cluster | Only when Network is Custom — drives Solana Explorer links |

There is no auth-token field. Authentication happens via Sign-In-With-Solana (SIWS): on connect the agent sends a nonce, the connected wallet signs it, and the wallet that signed becomes this session's identity. Authorization (whether that wallet is admitted past the handshake) is the agent's `AGENT_AUTH_MODE` policy — `owner`, `allowlist`, or `open`. See the agent-template's [`WEBSOCKET_PROTOCOL.md`](https://github.com/metaplex-foundation/metaplex-mastra-agent-template/blob/main/WEBSOCKET_PROTOCOL.md) § Authentication for the wire-level handshake.

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

In the profile editor, click **Copy share link**. The URL contains the profile in its hash fragment (e.g. `#ws=…&preset=devnet&name=…`). Opening it on another machine pre-fills the form in transient mode — nothing is saved until you click **Save** or **Save & Connect**.

Share links carry no secrets — authentication still happens via SIWS, so the recipient must connect their own wallet and sign the handshake before they can chat. Hash fragments are not sent to servers (no Referer/proxy leakage); they do appear in browser history.

## Features

- Mainnet / Devnet / Localnet presets plus Custom RPC override
- Multiple named connection profiles, switchable from the header
- Hash-fragment share links for transient connections
- Real Solana wallet (Phantom, Solflare) via wallet-adapter
- WebSocket auto-reconnect with exponential backoff
- Streaming agent responses, typing indicator
- Transaction approval flow (sign + send in browser)
- Debug panel with per-step traces and token totals (Cmd/Ctrl+D)
