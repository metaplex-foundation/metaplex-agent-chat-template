# Chat history with transactions — design

## Problem

Today the chat UI has two parallel surfaces that never cross:

- `messages: ChatMessage[]` in `use-plexchat` — the visible thread of user/agent turns. Cleared on reload.
- `txQueue: ServerTransaction[]` in `page.tsx` — modal queue. Once the user signs or rejects, the transaction is sent back to the agent and dropped from the UI. The user sees no record of the action.

Users want a single timeline that **persists across reloads** and includes both messages and transactions, with each transaction's outcome (signed / rejected / failed) visible in context.

## Goals

1. Inline transaction bubbles in the chat thread, alongside agent/user messages, in chronological order.
2. Local persistence per profile (the existing scoping unit).
3. Live status updates on the transaction bubble as the user moves through the approval flow.
4. A way to clear the active profile's history.

## Non-goals

- Server-side history sync. The agent server is stateless w.r.t. the chat UI.
- Cross-profile aggregation.
- Persisting the raw signable payload — once the modal closes, it can't be re-acted on, so storing it is a footgun.

## Data model

New file `src/types/history.ts`. The chat surface stops dealing in `ChatMessage[]` and starts dealing in `HistoryEntry[]`, a discriminated union:

```ts
export type HistoryEntry = ChatEntry | TransactionEntry;

export interface ChatEntry {
  kind: 'message';
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: number;        // epoch ms — JSON-roundtrips cleanly (was Date)
  isStreaming?: boolean;
  isError?: boolean;
}

export interface TransactionEntry {
  kind: 'transaction';
  id: string;               // local id distinct from correlationId
  correlationId: string;    // links to the agent's tx, used for status patches
  timestamp: number;
  status: 'pending' | 'signing' | 'sending' | 'confirming'
        | 'confirmed' | 'rejected' | 'failed' | 'abandoned';
  agentMessage?: string;    // ServerTransaction.message
  preview: TxPreview;       // decoded summary (instructions, transfers, programs)
  feeSol?: number;
  index?: number;           // for multi-tx batches
  total?: number;
  signature?: string;
  error?: string;
  cluster: 'mainnet-beta' | 'devnet' | 'localnet';
}
```

`TxPreview` and `decodeTxPreview` move from `transaction-approval.tsx` into `src/lib/tx-preview.ts` so the hook can produce a preview at entry-creation time and the modal can keep using its existing logic.

The `cluster` field is captured when the entry is created so the explorer link survives a profile edit later.

## Storage

New file `src/lib/history-store.ts`, structured exactly like `profile-store.ts`:

- A single localStorage key, `plexchat-history`, holding `Record<profileId, HistoryEntry[]>`.
- A module-level `Set<listener>` for fan-out, exposed through a `useHistoryStore(profileId)` hook backed by `useSyncExternalStore`.
- Debounced (50ms) write of the active profile's slice. All localStorage access wrapped in try/catch (Safari private mode parity).

Public API:

```ts
useHistoryStore(profileId: string | null) → {
  entries: HistoryEntry[];                                // [] when null
  addEntry(entry: HistoryEntry): void;
  updateEntry(id: string, patch: Partial<HistoryEntry>): void;
  updateByCorrelationId(cid: string, patch: Partial<TransactionEntry>): void;
  clear(): void;                                          // active profile only
}
```

Persistence rules:

- **Cap of 200 entries per profile.** On overflow, drop the oldest.
- **Streaming chat entries are excluded from disk writes** while `isStreaming === true`. We persist once the final `message` event arrives. Avoids hammering localStorage on every text delta.
- **The base64 transaction blob is never persisted.** It only matters while the modal is live.
- **Transient profiles (share-link `kind: 'transient'`) get no persistence.** Their lack of an id is a feature here.

### Bootstrap: in-flight → abandoned

If a previous tab closed mid-flight, the disk slice still has entries with `status` in `{pending, signing, sending, confirming}`. On `useHistoryStore` initialisation for a profile, those are rewritten to `abandoned` with `error: 'Modal closed before completion'`. The user sees them as a clear "you walked away from this one" record, distinct from `failed` (which means an actual on-chain or wallet error).

## Hook integration

`use-plexchat` becomes the timeline's source of truth — it already is for messages; transactions just join the same path.

The hook's signature changes:

```ts
usePlexChat({
  url, onTransaction, onDebugEvent,
  history,                  // ← new: the result of useHistoryStore(activeProfile?.id ?? null)
}) → {
  // … unchanged auth/connection state …
  // messages: ChatMessage[]   ← removed
  entries: HistoryEntry[],     // ← new, sourced from history.entries
  // sendMessage / sendTxResult / sendTxError unchanged
}
```

Internal changes:

- Wherever `setMessages([..., {sender:'user'/'agent', ...}])` was called, we now call `history.addEntry({kind:'message', ...})`.
- The streaming-text-delta path uses `history.addEntry` to create the streaming entry and `history.updateEntry(id, {content})` to extend it. The final `message` event flips `isStreaming` to `false`, which is what triggers the disk write.
- The `transaction` server event creates a `TransactionEntry` with `status: 'pending'` *before* forwarding to `onTransaction(tx)` — so the bubble appears in lock-step with the modal.
- `sendTxResult` calls `history.updateByCorrelationId(cid, {status: 'confirmed', signature})` *and* sends the wire message.
- `sendTxError` calls `history.updateByCorrelationId(cid, {status: 'rejected' | 'failed', error})` *and* sends the wire message. The caller picks `rejected` vs `failed` based on the reason — `'User rejected transaction'` → `rejected`, otherwise → `failed`.

`page.tsx` keeps owning the txQueue (modal control flow), but the act of enqueuing/dequeuing no longer affects the timeline directly — the timeline is updated by the hook in response to wire events.

When the multi-tx queue is dropped on error (existing behaviour in `page.tsx`), the entries that never made it to the modal are flipped to `abandoned` with `error: 'Cancelled by prior tx error'` so the trail is complete.

## UI

### TransactionApproval

Add an `onStatusChange?: (correlationId: string, status: TransactionEntry['status']) => void` prop. Emit when the internal `status` transitions through `signing` / `sending` / `confirming` / `success` / `error`. The page wires this through to `history.updateByCorrelationId`.

### chat-message.tsx

`ChatMessageBubble` becomes a switch on `entry.kind`:

- `kind: 'message'` → existing user/agent/error rendering, just sourced from a `ChatEntry`.
- `kind: 'transaction'` → new `TransactionMessageBubble` component:
  - Status icon + label (in-flight statuses use a spinner; resolved statuses use a coloured glyph).
  - `agentMessage` rendered as the bubble title.
  - Decoded preview lines (transfers, instruction count, programs) — same structure as the modal.
  - Fee line when present.
  - On `confirmed`: signature row with copy button + explorer link (suppressed for `localnet`, matching existing modal behaviour).
  - On `rejected` / `failed` / `abandoned`: error reason in red.
  - Multi-tx batches display `Tx N of M` chip.
  - Status palette: indigo for in-flight, green for confirmed, zinc for rejected, red for failed/abandoned.

### chat-panel.tsx

Prop renamed `messages` → `entries`. Internal map switches on `entry.kind` to pick the renderer. Auto-scroll behaviour is unchanged.

### page.tsx header

A new icon button between the debug toggle and `WalletMultiButton`:

- Tooltip: "Clear chat history".
- Disabled when there's no active profile, or when entries.length === 0.
- On click: `window.confirm('Clear chat history for this profile?')` then `history.clear()`.

## Edge cases

- **Profile switch during chat:** the history store re-keys on `profileId`. The previous profile's entries stay on disk untouched.
- **Wallet swap forces reconnect:** existing entries persist; new auth produces no entries until the user acts.
- **Multi-tx error drops the rest of the queue:** any not-yet-modal'd entries get flipped to `abandoned` (see hook section).
- **Storage quota exceeded:** try/catch falls back to in-memory only, same as the debug panel.
- **Transient profile from share-link:** in-memory only, no disk write.
- **Reload mid-stream agent reply:** the streaming entry was never persisted (because `isStreaming === true` excluded it). Nothing to clean up — the partial reply just disappears, which is the existing behaviour for all chat content today.

## Out of scope (for now)

- A separate "transactions only" tab/filter view.
- Search across history.
- Export.
- Any server-side persistence.
