'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ServerAllowlistError, ServerAllowlistState } from '@/types/plexchat-protocol';

const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface AllowlistTabProps {
  isOwner: boolean;
  state: ServerAllowlistState | null;
  error: ServerAllowlistError | null;
  onFetch: () => void;
  onAdd: (pubkey: string) => void;
  onRemove: (pubkey: string) => void;
}

/**
 * Owner-only allowlist admin tab. Visible to all sessions but renders an
 * explanatory placeholder when the connected wallet isn't the on-chain owner —
 * non-owner add/remove calls are rejected by the server anyway, but the UI
 * shouldn't tease functionality you can't use.
 *
 * Pubkey validation is best-effort client-side (length + base58 alphabet).
 * The server re-validates and rejects malformed input — the client check
 * is purely a UX nicety to skip a round-trip on obvious typos.
 */
export function AllowlistTab({
  isOwner,
  state,
  error,
  onFetch,
  onAdd,
  onRemove,
}: AllowlistTabProps) {
  const [draft, setDraft] = useState('');
  const [submittedRecently, setSubmittedRecently] = useState(false);

  // Auto-fetch on first render once we know we're the owner. Owners landing
  // on this tab expect to see the current list, not an empty "press fetch"
  // placeholder.
  useEffect(() => {
    if (isOwner && state === null) {
      onFetch();
    }
  }, [isOwner, state, onFetch]);

  const trimmed = draft.trim();
  const isValidDraft = useMemo(
    () => BASE58_ADDRESS_RE.test(trimmed),
    [trimmed],
  );

  if (!isOwner) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        <p className="font-medium text-zinc-300">Owner-only.</p>
        <p className="mt-2">
          The allowlist admin is visible to the on-chain owner of this agent. Connect with the owner wallet to manage who can sign in.
        </p>
      </div>
    );
  }

  function handleAdd() {
    if (!isValidDraft) return;
    onAdd(trimmed);
    setDraft('');
    setSubmittedRecently(true);
    setTimeout(() => setSubmittedRecently(false), 1500);
  }

  return (
    <div className="flex h-full flex-col p-3 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Allowlist file</p>
          <code className="text-[11px] text-zinc-300 break-all">
            {state?.filePath ?? 'loading…'}
          </code>
        </div>
        <button
          onClick={onFetch}
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-700/50 bg-red-950/30 p-2 text-[12px] text-red-300">
          <span className="font-medium">{error.code}: </span>
          {error.message}
        </div>
      )}

      <div className="mb-3 rounded border border-zinc-800 bg-zinc-900/50 p-2">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Add wallet</p>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValidDraft) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Base58 wallet address"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={!isValidDraft}
            className="rounded bg-indigo-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {submittedRecently ? '…' : 'Add'}
          </button>
        </div>
        {trimmed.length > 0 && !isValidDraft && (
          <p className="mt-1 text-[11px] text-amber-400">Not a valid base58 address.</p>
        )}
      </div>

      <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
        File entries ({state?.wallets.length ?? 0})
      </p>
      <ul className="mb-4 divide-y divide-zinc-800 rounded border border-zinc-800">
        {state && state.wallets.length > 0 ? (
          state.wallets.map((w) => (
            <li key={w} className="flex items-center justify-between px-2 py-1.5">
              <code className="break-all text-[11px] text-zinc-300">{w}</code>
              <button
                onClick={() => onRemove(w)}
                className="ml-2 shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-red-600 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))
        ) : (
          <li className="px-2 py-3 text-[12px] italic text-zinc-500">
            {state ? 'No entries — add a wallet above.' : 'Loading…'}
          </li>
        )}
      </ul>

      {state && state.envWallets.length > 0 && (
        <>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Env-supplied entries ({state.envWallets.length}) · read-only
          </p>
          <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
            {state.envWallets.map((w) => (
              <li key={`env-${w}`} className="flex items-center justify-between px-2 py-1.5">
                <code className="break-all text-[11px] text-zinc-400">{w}</code>
                <span className="ml-2 shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase text-zinc-500">
                  WALLET_ALLOWLIST
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-500">
            Env entries can&apos;t be edited from the UI. Update <code>WALLET_ALLOWLIST</code> in <code>.env</code> and restart the server.
          </p>
        </>
      )}
    </div>
  );
}
