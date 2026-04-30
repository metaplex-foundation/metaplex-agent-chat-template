# Runtime Profile Configuration — Design

**Date:** 2026-04-30
**Status:** Designed, not yet implemented

## Goal

Convert this repo from a single-target chat UI (one agent, configured at build time via `NEXT_PUBLIC_*` env vars) into a generic dev/debug client that can connect to any PlexChat agent at runtime, with multiple saved connection profiles and shareable config URLs.

## Non-goals

- Multi-tenant production hosting with auth.
- Multiple simultaneous WS connections.
- Encrypted-at-rest token storage.
- Profile import/export as files.
- Test coverage beyond `pnpm typecheck` (matches current repo posture).

## Use case

Local dev/debug. The operator runs many agent processes (local, staging, teammates') and wants to flip between them quickly. Tokens are not treated as secrets in this design — they're shared with the deployer, sit in localStorage, and may appear in shared URLs.

## Data model

A profile is one object:

```ts
interface AgentProfile {
  id: string;                 // crypto.randomUUID(), generated on create
  name: string;               // user-given label, e.g. "Local devnet"
  wsUrl: string;              // full URL: "wss://agent.example.com:3002"
  token: string;              // bearer token (stored as-is)
  rpcUrl: string;             // Solana RPC endpoint
  cluster: SolanaCluster;     // 'mainnet-beta' | 'devnet' | 'testnet'
  createdAt: number;
}
```

Persisted under one localStorage key (`plexchat-profiles`) as a single JSON blob:

```ts
{ profiles: AgentProfile[]; activeProfileId: string | null }
```

Validation on save (form blocks until clean):
- `wsUrl` parses via `new URL()` and protocol is `ws:` or `wss:`.
- `rpcUrl` parses via `new URL()` and protocol is `http:` or `https:`.
- `name` non-empty after trim.
- `cluster` ∈ `{'mainnet-beta', 'devnet', 'testnet'}`.

The existing env-var helpers in `src/app/env.ts` are deleted; the `SolanaCluster` type moves to the profile store module.

## Storage layer

`src/lib/profile-store.ts` exposes:

- `loadProfiles()` / `saveProfiles(state)` with try/catch around `localStorage` (Safari private mode etc.) — same pattern as `use-debug-panel.ts`.
- `createProfile(input)`, `updateProfile(id, patch)`, `deleteProfile(id)`, `setActiveProfile(id | null)`.
- `useProfileStore()` React hook — returns `{ profiles, activeProfile, ...mutators }` and re-renders subscribers when the store changes (via `useSyncExternalStore` over a small in-module event emitter, so the header pill and modal stay in sync without prop-drilling).

## UI surfaces

### Header active-profile pill

Rendered next to the existing connection-status pill in `page.tsx`:

- Shows the active profile's name with a `▾` chevron.
- Click opens a small dropdown listing all profiles (active checkmarked) plus `Manage profiles…` and `Disconnect`.
- If no profiles exist, the pill shows `No profile` and clicking opens the modal.

### Profile modal

Two-column on desktop, stacked on mobile. Reuses focus-management / `role="dialog"` patterns from `transaction-approval.tsx`:

- **Left:** profile list. Each row: name + truncated WS host. Hover-reveal delete with confirm. `+ New profile` button at the bottom.
- **Right:** form for the selected profile — Name, WS URL, Token (password input + show/hide toggle), RPC URL, Cluster (radio group). Buttons: `Save`, `Save & Connect`, `Copy share link`.

### First-run state

No profiles in localStorage on mount → modal auto-opens, list pane shows empty state, form is in "create new" mode. Closing the modal without saving leaves the app in a disconnected state with a banner: "No profile configured — open settings to add one."

## URL share-link format

Encoded in `window.location.hash` (not query string — keeps tokens out of Referer headers and proxy logs). Format:

```
#ws=<wsUrl>&token=<token>&rpc=<rpcUrl>&cluster=<cluster>&name=<name>
```

All values URL-encoded. `name` is optional; if omitted, the form proposes one based on the WS host.

`src/lib/share-link.ts` exposes `encodeProfileToHash(profile)` and `tryDecodeHashToProfile(hash)`.

### Open-from-link UX

On mount, before the first-run modal logic kicks in:

1. If `window.location.hash` contains `ws=`, parse it.
2. If parse succeeds, open the modal in **transient mode**: form pre-filled with the decoded values, no profile saved yet, banner reads "Imported from link — Save to keep".
3. Clear the hash via `history.replaceState(null, '', window.location.pathname)` so a manual refresh doesn't reopen the prompt.
4. The user can either click `Save & Connect` (becomes a normal saved profile) or just `Connect` (transient — connection lives in memory only and is lost on reload).

## Lifecycle / state plumbing

The Solana `<ConnectionProvider endpoint={...}>` currently reads `process.env.NEXT_PUBLIC_SOLANA_RPC_URL` once at mount. Making the RPC endpoint dynamic requires lifting profile state above it.

New layering in `src/app/providers.tsx`:

```
<ProfileStoreProvider>             // exposes useProfileStore() to descendants
  <ActiveProfileSolanaProviders>   // reads activeProfile.rpcUrl from context
    <ConnectionProvider endpoint={rpcUrl ?? FALLBACK}>
      <WalletProvider wallets={...} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
```

When `activeProfile.rpcUrl` changes, `ConnectionProvider` re-mounts. The wallet's `publicKey` survives the swap; the existing `wallet_connect` useEffect in `page.tsx` re-pushes the address to the new agent automatically.

`FALLBACK` = `https://api.devnet.solana.com` so the tree mounts even with no active profile.

`use-plexchat.ts` is fed `activeProfile?.wsUrl ?? ''` and `activeProfile?.token ?? ''`. The existing `if (!url) return` guard in `connect()` handles the no-profile case. The hook's `connect` dep array already triggers reconnect on URL/token change — no internal changes needed.

### Switch-while-busy guard

In `page.tsx`, intercept profile-switch attempts. If `txQueue.length > 0` *or* `isAgentTyping`, show a confirm dialog: "There's a transaction pending — abandon and switch?" Cancelling keeps the current profile. This mirrors the existing `beforeunload` warning.

## File plan

### Delete

- `.env.local.example`
- `src/app/env.ts`

### New

- `src/lib/profile-store.ts` — types, load/save, mutators, `useProfileStore()` hook.
- `src/lib/share-link.ts` — hash encode/decode.
- `src/components/profile/profile-pill.tsx` — header pill + dropdown.
- `src/components/profile/profile-modal.tsx` — full management modal.
- `src/components/profile/profile-form.tsx` — extracted form, reused for transient mode.

### Modify

- `src/app/providers.tsx` — add `ProfileStoreProvider`, make `ConnectionProvider` endpoint dynamic.
- `src/app/page.tsx` — feed `usePlexChat` from active profile; render the new pill; mount the modal; URL-hash bootstrap; switch-while-busy guard.
- `README.md` — replace env-var quickstart with profile/share-link instructions.
- `CLAUDE.md` — drop env-var section, add a brief note on the profile store + share-link format.

### No dep changes

`crypto.randomUUID()` covers ID generation. No new packages needed.

## Open questions / future work

- Whether to add an "export all profiles" JSON dump for migrating between machines. Not in scope.
- Whether the share-link should grow a short-form (e.g., base64 of the JSON) once the URL gets long. Not in scope until it actually hurts.
- Whether to pin a per-profile assistant name / system prompt override. Out of scope — that's an agent-server concern.
