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

| Preset | RPC endpoint |
| --- | --- |
| Mainnet | `https://api.mainnet-beta.solana.com` |
| Devnet | `https://api.devnet.solana.com` |
| Localnet | `http://localhost:8899` |
| Custom | Whatever URL you configure |

All connections go directly from the browser to the RPC. To use a paid endpoint, choose **Custom** and paste in your URL.

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
