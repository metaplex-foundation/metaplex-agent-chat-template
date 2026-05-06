'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { HistoryEntry, TransactionEntry, TransactionStatus } from '@/types/history';
import { IN_FLIGHT_TX_STATUSES } from '@/types/history';

const TERMINAL_TX_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'confirmed',
  'rejected',
  'failed',
  'abandoned',
]);

const STORAGE_KEY = 'plexchat-history';
const MAX_ENTRIES_PER_PROFILE = 200;
const WRITE_DEBOUNCE_MS = 50;

type HistoryByProfile = Record<string, HistoryEntry[]>;

const EMPTY_ENTRIES: HistoryEntry[] = [];

let memoryState: HistoryByProfile = {};
let hydrated = false;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const bootstrappedProfiles = new Set<string>();

function safeRead(): HistoryByProfile {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: HistoryByProfile = {};
    for (const [id, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter(isValidEntry);
      if (valid.length > 0) out[id] = valid;
    }
    return out;
  } catch (err) {
    console.warn('[history-store] read failed', err);
    return {};
  }
}

function safeWrite(state: HistoryByProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[history-store] write failed', err);
  }
}

function isValidEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== 'string' || typeof e.timestamp !== 'number') return false;
  if (e.kind === 'message') {
    return (
      typeof e.content === 'string' &&
      (e.sender === 'user' || e.sender === 'agent')
    );
  }
  if (e.kind === 'transaction') {
    return (
      typeof e.correlationId === 'string' &&
      typeof e.status === 'string' &&
      typeof e.cluster === 'string' &&
      e.preview != null && typeof e.preview === 'object'
    );
  }
  return false;
}

function ensureHydrated(): void {
  if (hydrated) return;
  memoryState = safeRead();
  hydrated = true;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    safeWrite(serialize(memoryState));
  }, WRITE_DEBOUNCE_MS);
}

// Strip volatile fields (streaming entries) before persisting. We never want
// a partial agent reply on disk; if the tab dies mid-stream the user just
// loses that one in-flight delta, which matches existing in-memory behaviour.
function serialize(state: HistoryByProfile): HistoryByProfile {
  const out: HistoryByProfile = {};
  for (const [id, entries] of Object.entries(state)) {
    const filtered = entries.filter(
      (e) => !(e.kind === 'message' && e.isStreaming === true),
    );
    if (filtered.length > 0) out[id] = filtered;
  }
  return out;
}

function commit(next: HistoryByProfile): void {
  memoryState = next;
  scheduleWrite();
  emit();
}

function bootstrapProfile(profileId: string): void {
  if (bootstrappedProfiles.has(profileId)) return;
  bootstrappedProfiles.add(profileId);
  const entries = memoryState[profileId];
  if (!entries || entries.length === 0) return;
  let mutated = false;
  const rewritten = entries.map((e) => {
    if (e.kind === 'transaction' && IN_FLIGHT_TX_STATUSES.has(e.status)) {
      mutated = true;
      const patched: TransactionEntry = {
        ...e,
        status: 'abandoned',
        error: e.error ?? 'Modal closed before completion',
      };
      return patched;
    }
    return e;
  });
  if (mutated) {
    commit({ ...memoryState, [profileId]: rewritten });
  }
}

function subscribe(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): HistoryByProfile {
  ensureHydrated();
  return memoryState;
}

function getServerSnapshot(): HistoryByProfile {
  return {};
}

function applyToProfile(
  profileId: string,
  updater: (entries: HistoryEntry[]) => HistoryEntry[],
): void {
  ensureHydrated();
  const current = memoryState[profileId] ?? [];
  let next = updater(current);
  if (next === current) return;
  // Cap: drop oldest entries when over the limit. The slice is cheap for
  // a 200-entry array.
  if (next.length > MAX_ENTRIES_PER_PROFILE) {
    next = next.slice(next.length - MAX_ENTRIES_PER_PROFILE);
  }
  commit({ ...memoryState, [profileId]: next });
}

export function addEntry(profileId: string, entry: HistoryEntry): void {
  applyToProfile(profileId, (entries) => [...entries, entry]);
}

export function updateEntry(
  profileId: string,
  id: string,
  patch: Partial<ChatEntryPatch & TransactionEntryPatch>,
): void {
  applyToProfile(profileId, (entries) => {
    let changed = false;
    const next = entries.map((e) => {
      if (e.id !== id) return e;
      changed = true;
      return mergeEntry(e, patch);
    });
    return changed ? next : entries;
  });
}

export function updateByCorrelationId(
  profileId: string,
  correlationId: string,
  patch: Partial<TransactionEntryPatch>,
): void {
  applyToProfile(profileId, (entries) => {
    let changed = false;
    const next = entries.map((e) => {
      if (e.kind !== 'transaction' || e.correlationId !== correlationId) return e;
      // Once a transaction has resolved (confirmed/rejected/failed/abandoned),
      // late-arriving status patches must NOT downgrade it. The eager
      // `sendTxResult` path can race with the modal's own lifecycle ticks,
      // and a stray `confirming` arriving after `confirmed` would otherwise
      // pin the bubble back into a spinning state forever.
      if (
        TERMINAL_TX_STATUSES.has(e.status) &&
        typeof patch.status === 'string' &&
        !TERMINAL_TX_STATUSES.has(patch.status)
      ) {
        return e;
      }
      changed = true;
      return mergeEntry(e, patch);
    });
    return changed ? next : entries;
  });
}

export function clearProfileHistory(profileId: string): void {
  ensureHydrated();
  if (!memoryState[profileId]) return;
  const next = { ...memoryState };
  delete next[profileId];
  commit(next);
}

// Type-safe patch applier. We don't allow `kind` to change.
type ChatEntryPatch = Omit<Partial<HistoryEntry & { kind: 'message' }>, 'kind' | 'id'>;
type TransactionEntryPatch = Omit<Partial<TransactionEntry>, 'kind' | 'id' | 'correlationId'>;

function mergeEntry(entry: HistoryEntry, patch: Record<string, unknown>): HistoryEntry {
  if (entry.kind === 'message') {
    return { ...entry, ...patch } as HistoryEntry;
  }
  return { ...entry, ...patch } as HistoryEntry;
}

export interface UseHistoryStoreReturn {
  entries: HistoryEntry[];
  addEntry: (entry: HistoryEntry) => void;
  updateEntry: (id: string, patch: Partial<ChatEntryPatch & TransactionEntryPatch>) => void;
  updateByCorrelationId: (correlationId: string, patch: Partial<TransactionEntryPatch>) => void;
  clear: () => void;
}

export function useHistoryStore(profileId: string | null): UseHistoryStoreReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // First render for a given profile: rewrite any in-flight transaction
  // entries to `abandoned`. Mounted as an effect so commit() doesn't fire
  // during render.
  useEffect(() => {
    if (!profileId) return;
    bootstrapProfile(profileId);
  }, [profileId]);

  const entries = profileId ? state[profileId] ?? EMPTY_ENTRIES : EMPTY_ENTRIES;

  return useMemo<UseHistoryStoreReturn>(() => {
    return {
      entries,
      addEntry: (entry) => {
        if (!profileId) return;
        addEntry(profileId, entry);
      },
      updateEntry: (id, patch) => {
        if (!profileId) return;
        updateEntry(profileId, id, patch);
      },
      updateByCorrelationId: (correlationId, patch) => {
        if (!profileId) return;
        updateByCorrelationId(profileId, correlationId, patch);
      },
      clear: () => {
        if (!profileId) return;
        clearProfileHistory(profileId);
      },
    };
  }, [entries, profileId]);
}
