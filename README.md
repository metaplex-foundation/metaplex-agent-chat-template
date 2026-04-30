# PlexChat Test UI

Next.js client for any PlexChat WebSocket agent.

> **In flight:** configuration is moving from build-time env vars to a runtime
> profile UI. This commit removes the env-var helpers; the management UI lands
> in follow-up commits on the `feature/runtime-profile-config` branch. See
> `docs/plans/2026-04-30-runtime-profile-config.md` for the full plan.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

Until the profile UI lands, the app starts disconnected and shows a
"No profile configured" banner.

## Features

- Real Solana wallet connection (Phantom, Solflare) via wallet adapter
- WebSocket chat with auto-reconnect
- Typing indicator
- Transaction approval flow (sign + send in browser)
- Connection status indicator
