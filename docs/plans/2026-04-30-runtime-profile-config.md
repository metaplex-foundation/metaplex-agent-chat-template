# Runtime Profile Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace build-time `NEXT_PUBLIC_*` env vars with a runtime profile system: a localStorage-backed list of named connection profiles (WS URL + token + RPC + cluster) editable from a header pill + modal, plus URL-hash share-links for transient connections.

**Architecture:** A single `profile-store` module owns the list and the active profile id, exposing a React hook backed by `useSyncExternalStore`. The `<Providers>` tree consumes the active profile to drive `<ConnectionProvider>` (Solana RPC) dynamically. `page.tsx` feeds the active profile's `wsUrl` + `token` into `usePlexChat`. UI surfaces are a header pill (active profile + dropdown), a management modal (list + form), and a URL-hash bootstrap for transient connections.

**Tech Stack:** Next.js 15, React 19 (`useSyncExternalStore`), TypeScript 5.8, Tailwind v4, Solana wallet-adapter, browser `crypto.randomUUID()`. No new deps.

**Verification gate:** `pnpm typecheck` after every task. UI tasks also start the dev server and exercise the feature manually.

**Reference:** Design doc at `docs/plans/2026-04-30-runtime-profile-config-design.md`.

---

## Task 0: Confirm clean baseline

**Step 1: Verify worktree state**

Run: `pnpm typecheck`
Expected: exits 0, no output.

Run: `git status`
Expected: clean working tree on branch `feature/runtime-profile-config`.

No commit.

---

## Task 1: Add the profile-store module

**Files:**
- Create: `src/lib/profile-store.ts`

**Step 1: Write `src/lib/profile-store.ts`**

```ts
'use client';

import { useSyncExternalStore } from 'react';

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet';

export const VALID_CLUSTERS: SolanaCluster[] = ['mainnet-beta', 'devnet', 'testnet'];

export interface AgentProfile {
  id: string;
  name: string;
  wsUrl: string;
  token: string;
  rpcUrl: string;
  cluster: SolanaCluster;
  createdAt: number;
}

interface StoreState {
  profiles: AgentProfile[];
  activeProfileId: string | null;
}

const STORAGE_KEY = 'plexchat-profiles';

const EMPTY_STATE: StoreState = { profiles: [], activeProfileId: null };

function safeRead(): StoreState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles.filter(isValidProfile) : [];
    const activeId = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : null;
    const activeProfileId = profiles.some((p) => p.id === activeId) ? activeId : null;
    return { profiles, activeProfileId };
  } catch (err) {
    console.warn('[profile-store] read failed', err);
    return EMPTY_STATE;
  }
}

function safeWrite(state: StoreState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[profile-store] write failed', err);
  }
}

function isValidProfile(p: unknown): p is AgentProfile {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.wsUrl === 'string' &&
    typeof obj.token === 'string' &&
    typeof obj.rpcUrl === 'string' &&
    typeof obj.cluster === 'string' &&
    (VALID_CLUSTERS as string[]).includes(obj.cluster) &&
    typeof obj.createdAt === 'number'
  );
}

let memoryState: StoreState = EMPTY_STATE;
let hydrated = false;
const listeners = new Set<() => void>();

function ensureHydrated(): void {
  if (hydrated) return;
  memoryState = safeRead();
  hydrated = true;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: StoreState): void {
  memoryState = next;
  safeWrite(next);
  emit();
}

function subscribe(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): StoreState {
  ensureHydrated();
  return memoryState;
}

function getServerSnapshot(): StoreState {
  return EMPTY_STATE;
}

export interface ProfileInput {
  name: string;
  wsUrl: string;
  token: string;
  rpcUrl: string;
  cluster: SolanaCluster;
}

export interface ValidationError {
  field: keyof ProfileInput;
  message: string;
}

export function validateProfileInput(input: ProfileInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.name.trim()) {
    errors.push({ field: 'name', message: 'Name is required' });
  }
  errors.push(...validateWsUrl(input.wsUrl));
  errors.push(...validateRpcUrl(input.rpcUrl));
  if (!(VALID_CLUSTERS as string[]).includes(input.cluster)) {
    errors.push({ field: 'cluster', message: 'Invalid cluster' });
  }
  return errors;
}

function validateWsUrl(value: string): ValidationError[] {
  if (!value.trim()) return [{ field: 'wsUrl', message: 'WS URL is required' }];
  try {
    const url = new URL(value);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return [{ field: 'wsUrl', message: 'WS URL must use ws:// or wss://' }];
    }
  } catch {
    return [{ field: 'wsUrl', message: 'WS URL is not a valid URL' }];
  }
  return [];
}

function validateRpcUrl(value: string): ValidationError[] {
  if (!value.trim()) return [{ field: 'rpcUrl', message: 'RPC URL is required' }];
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [{ field: 'rpcUrl', message: 'RPC URL must use http:// or https://' }];
    }
  } catch {
    return [{ field: 'rpcUrl', message: 'RPC URL is not a valid URL' }];
  }
  return [];
}

export function createProfile(input: ProfileInput): AgentProfile {
  ensureHydrated();
  const profile: AgentProfile = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    wsUrl: input.wsUrl.trim(),
    token: input.token,
    rpcUrl: input.rpcUrl.trim(),
    cluster: input.cluster,
    createdAt: Date.now(),
  };
  const profiles = [...memoryState.profiles, profile];
  const activeProfileId = memoryState.activeProfileId ?? profile.id;
  setState({ profiles, activeProfileId });
  return profile;
}

export function updateProfile(id: string, patch: Partial<ProfileInput>): void {
  ensureHydrated();
  const profiles = memoryState.profiles.map((p) =>
    p.id === id
      ? {
          ...p,
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.wsUrl !== undefined ? { wsUrl: patch.wsUrl.trim() } : {}),
          ...(patch.token !== undefined ? { token: patch.token } : {}),
          ...(patch.rpcUrl !== undefined ? { rpcUrl: patch.rpcUrl.trim() } : {}),
          ...(patch.cluster !== undefined ? { cluster: patch.cluster } : {}),
        }
      : p,
  );
  setState({ ...memoryState, profiles });
}

export function deleteProfile(id: string): void {
  ensureHydrated();
  const profiles = memoryState.profiles.filter((p) => p.id !== id);
  const activeProfileId =
    memoryState.activeProfileId === id ? null : memoryState.activeProfileId;
  setState({ profiles, activeProfileId });
}

export function setActiveProfile(id: string | null): void {
  ensureHydrated();
  if (id !== null && !memoryState.profiles.some((p) => p.id === id)) return;
  setState({ ...memoryState, activeProfileId: id });
}

export interface UseProfileStoreReturn {
  profiles: AgentProfile[];
  activeProfile: AgentProfile | null;
  createProfile: typeof createProfile;
  updateProfile: typeof updateProfile;
  deleteProfile: typeof deleteProfile;
  setActiveProfile: typeof setActiveProfile;
}

export function useProfileStore(): UseProfileStoreReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activeProfile =
    state.activeProfileId
      ? state.profiles.find((p) => p.id === state.activeProfileId) ?? null
      : null;
  return {
    profiles: state.profiles,
    activeProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
  };
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0, no output.

**Step 3: Commit**

```bash
git add src/lib/profile-store.ts
git commit -m "Add profile-store module for runtime connection config"
```

---

## Task 2: Add the share-link encode/decode module

**Files:**
- Create: `src/lib/share-link.ts`

**Step 1: Write `src/lib/share-link.ts`**

```ts
import type { AgentProfile, ProfileInput, SolanaCluster } from './profile-store';
import { VALID_CLUSTERS } from './profile-store';

const HASH_KEYS = ['ws', 'token', 'rpc', 'cluster', 'name'] as const;

export function encodeProfileToHash(
  input: Pick<AgentProfile, 'wsUrl' | 'token' | 'rpcUrl' | 'cluster' | 'name'>,
): string {
  const params = new URLSearchParams();
  params.set('ws', input.wsUrl);
  if (input.token) params.set('token', input.token);
  params.set('rpc', input.rpcUrl);
  params.set('cluster', input.cluster);
  if (input.name) params.set('name', input.name);
  return `#${params.toString()}`;
}

export function tryDecodeHashToProfile(hash: string): ProfileInput | null {
  if (!hash) return null;
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!stripped) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(stripped);
  } catch {
    return null;
  }
  const ws = params.get('ws');
  if (!ws) return null;
  const rpc = params.get('rpc') ?? '';
  const clusterRaw = params.get('cluster') ?? 'devnet';
  const cluster: SolanaCluster = (VALID_CLUSTERS as string[]).includes(clusterRaw)
    ? (clusterRaw as SolanaCluster)
    : 'devnet';
  const token = params.get('token') ?? '';
  const name = params.get('name') ?? defaultNameFromWsUrl(ws);
  return { name, wsUrl: ws, token, rpcUrl: rpc, cluster };
}

export function hashContainsProfile(hash: string): boolean {
  if (!hash) return false;
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!stripped) return false;
  try {
    return new URLSearchParams(stripped).has('ws');
  } catch {
    return false;
  }
}

function defaultNameFromWsUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return url.hostname || 'Imported';
  } catch {
    return 'Imported';
  }
}

export const SHARE_HASH_KEYS = HASH_KEYS;
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/lib/share-link.ts
git commit -m "Add share-link encoder/decoder for hash-fragment profile URLs"
```

---

## Task 3: Wire Providers + page.tsx to active profile, delete env.ts

**Files:**
- Modify: `src/app/providers.tsx` (full rewrite)
- Modify: `src/app/page.tsx` (replace env imports)
- Modify: `src/components/transaction-approval.tsx` (remove `solanaCluster` import; read from active profile)
- Delete: `src/app/env.ts`
- Delete: `.env.local.example`

This task makes the app run on profile state with **no UI to manage profiles yet**. With no saved profile, the app stays disconnected and shows a banner. UI for managing profiles arrives in subsequent tasks.

**Step 1: Rewrite `src/app/providers.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useProfileStore } from '@/lib/profile-store';

import '@solana/wallet-adapter-react-ui/styles.css';

const FALLBACK_RPC = 'https://api.devnet.solana.com';

export function Providers({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useProfileStore();
  const endpoint = activeProfile?.rpcUrl || FALLBACK_RPC;
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

**Step 2: Modify `src/app/page.tsx`**

Replace the import line `import { wsUrl, wsToken } from './env';` with:

```tsx
import { useProfileStore } from '@/lib/profile-store';
```

Inside `Home()`, **above** the `usePlexChat` call, add:

```tsx
const { activeProfile } = useProfileStore();
```

Change the `usePlexChat` call to:

```tsx
const { messages, isConnected, isReconnecting, isAgentTyping, error, sendMessage, sendWalletConnect, sendWalletDisconnect, sendTxResult, sendTxError, wsLog, clearWsLog } =
  usePlexChat({
    url: activeProfile?.wsUrl ?? '',
    token: activeProfile?.token ?? '',
    onTransaction: (tx) => setTxQueue((prev) => [...prev, tx]),
    onDebugEvent: debug.handleDebugEvent,
  });
```

Below the auth/connection error banner (`{error && ...}` block), add a "no profile" banner:

```tsx
{!activeProfile && (
  <div
    role="status"
    className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300"
  >
    No profile configured — open settings to add one.
  </div>
)}
```

**Step 3: Modify `src/components/transaction-approval.tsx`**

Replace the import `import { solanaCluster } from '@/app/env';` with:

```tsx
import { useProfileStore } from '@/lib/profile-store';
```

Replace the line `const cluster = solanaCluster();` (near the bottom of the component, before `clusterQuery`) with:

```tsx
const { activeProfile } = useProfileStore();
const cluster = activeProfile?.cluster ?? 'devnet';
```

**Step 4: Delete `src/app/env.ts` and `.env.local.example`**

```bash
rm src/app/env.ts .env.local.example
```

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 6: Manual smoke test**

Run: `pnpm dev`
Open http://localhost:3000
Expected:
- Page renders.
- Connection-status pill shows "Disconnected".
- An amber banner reads "No profile configured — open settings to add one."
- No console errors related to env vars or profile-store.

Stop the dev server (Ctrl+C).

**Step 7: Commit**

```bash
git add -A
git commit -m "Replace env-var config with profile-store-driven providers"
```

---

## Task 4: Build the profile form component

**Files:**
- Create: `src/components/profile/profile-form.tsx`

**Step 1: Write `src/components/profile/profile-form.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  validateProfileInput,
  VALID_CLUSTERS,
  type ProfileInput,
  type SolanaCluster,
  type ValidationError,
} from '@/lib/profile-store';

interface ProfileFormProps {
  initialValue?: ProfileInput;
  submitLabel?: string;
  secondaryLabel?: string;
  onSubmit: (input: ProfileInput) => void;
  onSecondary?: (input: ProfileInput) => void;
  onShareLink?: (input: ProfileInput) => void;
}

const EMPTY: ProfileInput = {
  name: '',
  wsUrl: '',
  token: '',
  rpcUrl: 'https://api.devnet.solana.com',
  cluster: 'devnet',
};

export function ProfileForm({
  initialValue,
  submitLabel = 'Save',
  secondaryLabel,
  onSubmit,
  onSecondary,
  onShareLink,
}: ProfileFormProps) {
  const [value, setValue] = useState<ProfileInput>(initialValue ?? EMPTY);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? EMPTY);
    setErrors([]);
  }, [initialValue]);

  function set<K extends keyof ProfileInput>(key: K, next: ProfileInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function errorFor(field: keyof ProfileInput): string | null {
    return errors.find((e) => e.field === field)?.message ?? null;
  }

  function handleSubmit(handler: (input: ProfileInput) => void) {
    return (event: React.FormEvent) => {
      event.preventDefault();
      const found = validateProfileInput(value);
      setErrors(found);
      if (found.length === 0) handler(value);
    };
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <Field label="Name" error={errorFor('name')}>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Local devnet"
          className={inputClass(errorFor('name'))}
        />
      </Field>

      <Field label="WebSocket URL" error={errorFor('wsUrl')}>
        <input
          type="text"
          value={value.wsUrl}
          onChange={(e) => set('wsUrl', e.target.value)}
          placeholder="wss://agent.example.com:3002"
          className={`${inputClass(errorFor('wsUrl'))} font-mono`}
          spellCheck={false}
        />
      </Field>

      <Field label="Token" error={errorFor('token')}>
        <div className="flex gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            value={value.token}
            onChange={(e) => set('token', e.target.value)}
            placeholder="Bearer token (32+ chars)"
            className={`${inputClass(errorFor('token'))} flex-1 font-mono`}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowToken((s) => !s)}
            className="rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Field label="Solana RPC URL" error={errorFor('rpcUrl')}>
        <input
          type="text"
          value={value.rpcUrl}
          onChange={(e) => set('rpcUrl', e.target.value)}
          placeholder="https://api.devnet.solana.com"
          className={`${inputClass(errorFor('rpcUrl'))} font-mono`}
          spellCheck={false}
        />
      </Field>

      <Field label="Cluster" error={errorFor('cluster')}>
        <div className="flex gap-2">
          {VALID_CLUSTERS.map((c) => (
            <label
              key={c}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                value.cluster === c
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              <input
                type="radio"
                name="cluster"
                value={c}
                checked={value.cluster === c}
                onChange={() => set('cluster', c as SolanaCluster)}
                className="sr-only"
              />
              {c}
            </label>
          ))}
        </div>
      </Field>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {submitLabel}
        </button>
        {onSecondary && secondaryLabel && (
          <button
            type="button"
            onClick={handleSubmit(onSecondary) as unknown as () => void}
            className="rounded-xl border border-indigo-500/40 bg-indigo-600/10 px-4 py-2 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-600/20"
          >
            {secondaryLabel}
          </button>
        )}
        {onShareLink && (
          <button
            type="button"
            onClick={() => onShareLink(value)}
            className="ml-auto rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Copy share link
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-400">{label}</span>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  );
}

function inputClass(error: string | null): string {
  return `rounded-lg border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-indigo-500 ${
    error ? 'border-red-500/60' : 'border-zinc-700'
  }`;
}
```

The `handleSubmit(onSecondary)` cast is intentional — the `onClick` signature differs from `onSubmit`, but the produced handler ignores the event arg.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/components/profile/profile-form.tsx
git commit -m "Add ProfileForm component for create/edit/transient flows"
```

---

## Task 5: Build the profile management modal

**Files:**
- Create: `src/components/profile/profile-modal.tsx`

**Step 1: Write `src/components/profile/profile-modal.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useProfileStore,
  type AgentProfile,
  type ProfileInput,
} from '@/lib/profile-store';
import { encodeProfileToHash } from '@/lib/share-link';
import { ProfileForm } from './profile-form';

export type ModalMode =
  | { kind: 'closed' }
  | { kind: 'manage'; selectedId: string | null }
  | { kind: 'create' }
  | { kind: 'transient'; draft: ProfileInput };

interface ProfileModalProps {
  mode: ModalMode;
  onClose: () => void;
  onConnectAfterSave?: (profileId: string) => void;
}

export function ProfileModal({ mode, onClose, onConnectAfterSave }: ProfileModalProps) {
  const { profiles, activeProfile, createProfile, updateProfile, deleteProfile, setActiveProfile } = useProfileStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);

  const isOpen = mode.kind !== 'closed';

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  const selectedProfile: AgentProfile | null = useMemo(() => {
    if (mode.kind === 'manage') {
      return profiles.find((p) => p.id === mode.selectedId) ?? null;
    }
    return null;
  }, [mode, profiles]);

  const formInitial: ProfileInput | undefined = useMemo(() => {
    if (mode.kind === 'manage' && selectedProfile) {
      const { name, wsUrl, token, rpcUrl, cluster } = selectedProfile;
      return { name, wsUrl, token, rpcUrl, cluster };
    }
    if (mode.kind === 'transient') return mode.draft;
    return undefined;
  }, [mode, selectedProfile]);

  if (!isOpen) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  function handleSave(input: ProfileInput): AgentProfile {
    if (mode.kind === 'manage' && selectedProfile) {
      updateProfile(selectedProfile.id, input);
      return { ...selectedProfile, ...input };
    }
    return createProfile(input);
  }

  function handleConnect(input: ProfileInput) {
    const profile = handleSave(input);
    setActiveProfile(profile.id);
    onConnectAfterSave?.(profile.id);
    onClose();
  }

  function handleShareLink(input: ProfileInput) {
    const hash = encodeProfileToHash({
      name: input.name,
      wsUrl: input.wsUrl,
      token: input.token,
      rpcUrl: input.rpcUrl,
      cluster: input.cluster,
    });
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      },
      (err) => console.warn('clipboard write failed', err),
    );
  }

  const headerLabel =
    mode.kind === 'transient'
      ? 'Imported from link'
      : mode.kind === 'create' || (mode.kind === 'manage' && !selectedProfile)
      ? profiles.length === 0
        ? 'Create your first connection'
        : 'New connection'
      : 'Edit connection';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="mx-4 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 outline-none md:flex-row"
      >
        {mode.kind !== 'transient' && (
          <aside className="flex w-full flex-col border-b border-zinc-800 md:w-64 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Profiles</h3>
              <button
                type="button"
                onClick={() => onClose()}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {profiles.length === 0 && (
                <li className="px-3 py-2 text-xs text-zinc-500">No profiles yet.</li>
              )}
              {profiles.map((p) => {
                const isActive = activeProfile?.id === p.id;
                const isSelected = mode.kind === 'manage' && mode.selectedId === p.id;
                return (
                  <li key={p.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (mode.kind === 'manage') {
                          (window as unknown as { __setProfileModalMode?: (m: ModalMode) => void }).__setProfileModalMode?.({
                            kind: 'manage',
                            selectedId: p.id,
                          });
                        }
                      }}
                      className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                      }`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="flex-1 truncate text-zinc-100">{p.name}</span>
                        {isActive && (
                          <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                            active
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate font-mono text-xs text-zinc-500">{tryHost(p.wsUrl)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDelete(p.id);
                      }}
                      aria-label={`Delete ${p.name}`}
                      className="absolute right-2 top-2 hidden rounded-md p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 group-hover:block"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 5h10M6 5V3.5h4V5M5 5l.5 8h5L11 5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {confirmingDelete === p.id && (
                      <div className="absolute inset-x-2 top-full z-10 mt-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 shadow-lg">
                        <p className="text-xs text-zinc-300">Delete &ldquo;{p.name}&rdquo;?</p>
                        <div className="mt-2 flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(null)}
                            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteProfile(p.id);
                              setConfirmingDelete(null);
                            }}
                            className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                (window as unknown as { __setProfileModalMode?: (m: ModalMode) => void }).__setProfileModalMode?.({
                  kind: 'create',
                });
              }}
              className="m-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60"
            >
              + New profile
            </button>
          </aside>
        )}

        <section className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h2 id="profile-modal-title" className="text-sm font-semibold text-zinc-100">
              {headerLabel}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {mode.kind === 'transient' && (
            <div className="border-b border-zinc-800 bg-amber-950/30 px-5 py-2 text-xs text-amber-300">
              Imported from link &mdash; nothing is saved until you click <strong>Save & Connect</strong>.
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5">
            <ProfileForm
              initialValue={formInitial}
              submitLabel={mode.kind === 'transient' || !selectedProfile ? 'Save' : 'Save'}
              secondaryLabel="Save & Connect"
              onSubmit={(input) => {
                handleSave(input);
              }}
              onSecondary={(input) => {
                handleConnect(input);
              }}
              onShareLink={handleShareLink}
            />
            {shareToast && (
              <p className="mt-2 text-right text-xs text-green-400">Link copied to clipboard.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function tryHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
```

The `(window as ...).__setProfileModalMode` shim is a placeholder for parent-controlled mode changes. It will be replaced by a real prop callback in the next task once we wire the modal up. For now this lets the file compile in isolation.

> **NOTE:** This deliberate hack is removed in Task 6.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/components/profile/profile-modal.tsx
git commit -m "Add ProfileModal scaffold (mode plumbing comes next)"
```

---

## Task 6: Replace the global-window hack with a proper mode prop

**Files:**
- Modify: `src/components/profile/profile-modal.tsx`

**Step 1: Add `onModeChange` prop and remove window hack**

Update the props interface:

```tsx
interface ProfileModalProps {
  mode: ModalMode;
  onModeChange: (mode: ModalMode) => void;
  onClose: () => void;
  onConnectAfterSave?: (profileId: string) => void;
}
```

Update the component signature to destructure `onModeChange`.

Replace the two `(window as unknown as ...).__setProfileModalMode?.(...)` call sites with:

- Profile list row click: `onClick={() => onModeChange({ kind: 'manage', selectedId: p.id })}`
- "+ New profile" button: `onClick={() => onModeChange({ kind: 'create' })}`

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/components/profile/profile-modal.tsx
git commit -m "Replace ProfileModal window hack with onModeChange prop"
```

---

## Task 7: Build the header profile pill + dropdown

**Files:**
- Create: `src/components/profile/profile-pill.tsx`

**Step 1: Write `src/components/profile/profile-pill.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useProfileStore, type AgentProfile } from '@/lib/profile-store';

interface ProfilePillProps {
  onManageClick: () => void;
  onSwitchProfile: (id: string) => void;
  onDisconnect: () => void;
}

export function ProfilePill({ onManageClick, onSwitchProfile, onDisconnect }: ProfilePillProps) {
  const { profiles, activeProfile } = useProfileStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const label = activeProfile?.name ?? 'No profile';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          activeProfile
            ? 'bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {profiles.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-500">No profiles configured.</li>
            )}
            {profiles.map((p) => (
              <ProfileMenuItem
                key={p.id}
                profile={p}
                isActive={activeProfile?.id === p.id}
                onClick={() => {
                  setOpen(false);
                  if (activeProfile?.id !== p.id) onSwitchProfile(p.id);
                }}
              />
            ))}
          </ul>
          <div className="border-t border-zinc-800 py-1">
            <MenuButton
              onClick={() => {
                setOpen(false);
                onManageClick();
              }}
            >
              Manage profiles…
            </MenuButton>
            {activeProfile && (
              <MenuButton
                onClick={() => {
                  setOpen(false);
                  onDisconnect();
                }}
              >
                Disconnect
              </MenuButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenuItem({
  profile,
  isActive,
  onClick,
}: {
  profile: AgentProfile;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        onClick={onClick}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
          isActive ? 'text-indigo-300' : 'text-zinc-200'
        }`}
      >
        <span className="flex-1 truncate">{profile.name}</span>
        {isActive && (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </li>
  );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3: Commit**

```bash
git add src/components/profile/profile-pill.tsx
git commit -m "Add ProfilePill header component"
```

---

## Task 8: Wire the pill + modal into page.tsx

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add imports**

Add at top of `page.tsx`:

```tsx
import { ProfilePill } from '@/components/profile/profile-pill';
import { ProfileModal, type ModalMode } from '@/components/profile/profile-modal';
import { useProfileStore } from '@/lib/profile-store';
```

(`useProfileStore` is already imported from Task 3 — keep one import.)

**Step 2: Add state and handlers**

Inside `Home()`, near the other `useState` declarations:

```tsx
const { activeProfile, setActiveProfile } = useProfileStore();
const [modalMode, setModalMode] = useState<ModalMode>({ kind: 'closed' });
```

(Replace the existing `const { activeProfile } = useProfileStore();` from Task 3.)

Add a busy guard helper and switch handler:

```tsx
const isBusy = txQueue.length > 0 || isAgentTyping;

const handleSwitchProfile = (id: string) => {
  if (id === activeProfile?.id) return;
  if (isBusy) {
    const ok = window.confirm('There is a transaction or response in progress. Switch profiles anyway?');
    if (!ok) return;
  }
  setActiveProfile(id);
};

const handleDisconnect = () => {
  if (isBusy) {
    const ok = window.confirm('There is a transaction or response in progress. Disconnect anyway?');
    if (!ok) return;
  }
  setActiveProfile(null);
};
```

**Step 3: Render the pill in the header**

Inside the header `<div>` that currently holds the debug toggle and `<WalletMultiButton />`, insert the pill **before** the debug toggle:

```tsx
<ProfilePill
  onManageClick={() => setModalMode({ kind: 'manage', selectedId: activeProfile?.id ?? null })}
  onSwitchProfile={handleSwitchProfile}
  onDisconnect={handleDisconnect}
/>
```

**Step 4: Render the modal**

Add at the bottom of the JSX, after the transaction overlay:

```tsx
<ProfileModal
  mode={modalMode}
  onModeChange={setModalMode}
  onClose={() => setModalMode({ kind: 'closed' })}
  onConnectAfterSave={() => setModalMode({ kind: 'closed' })}
/>
```

**Step 5: Update the "no profile" banner**

Make it clickable to open the modal. Replace the existing banner from Task 3 with:

```tsx
{!activeProfile && (
  <button
    type="button"
    onClick={() => setModalMode({ kind: 'create' })}
    className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300 hover:bg-amber-950/60"
  >
    No profile configured — click to add one.
  </button>
)}
```

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 7: Manual smoke test**

Run: `pnpm dev`

Open http://localhost:3000 and verify in this order:

1. Banner says "No profile configured — click to add one." Click it; modal opens with empty form.
2. Fill in: Name = `Local devnet`, WS URL = `ws://localhost:3002`, Token = any 32-char string, RPC URL stays at default, Cluster = devnet. Click **Save & Connect**.
3. Modal closes. Header pill shows "Local devnet". Connection-status pill shows "Reconnecting..." or "Disconnected" since no agent is running locally — that's expected.
4. Click the pill. Dropdown shows "Local devnet ✓", "Manage profiles…", "Disconnect".
5. Click "Manage profiles…". Modal reopens with the profile selected. Click "+ New profile". Form clears.
6. Click outside the modal. Modal closes.
7. Click pill → "Disconnect". Pill goes back to "No profile" and the amber banner returns.

Stop dev server.

**Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "Wire ProfilePill and ProfileModal into page.tsx"
```

---

## Task 9: URL-hash bootstrap for transient connections

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add hash-bootstrap effect**

Add this `useEffect` inside `Home()`, **after** the existing wallet-sync effect. It must be the first effect that touches `modalMode` so it wins over any first-run prompt added later.

```tsx
const hashBootstrappedRef = useRef(false);

useEffect(() => {
  if (hashBootstrappedRef.current) return;
  hashBootstrappedRef.current = true;
  if (typeof window === 'undefined') return;
  if (!hashContainsProfile(window.location.hash)) return;
  const draft = tryDecodeHashToProfile(window.location.hash);
  if (!draft) return;
  setModalMode({ kind: 'transient', draft });
  history.replaceState(null, '', window.location.pathname + window.location.search);
}, []);
```

**Step 2: Add imports**

```tsx
import { useRef } from 'react';
import { hashContainsProfile, tryDecodeHashToProfile } from '@/lib/share-link';
```

(Merge `useRef` into the existing react import.)

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 4: Manual smoke test**

Run: `pnpm dev`

Test 1 — share link round-trip:
1. Create a profile (any values), click **Copy share link**.
2. Open a new private/incognito window, paste the URL with hash.
3. Modal auto-opens in transient mode with the values pre-filled and the amber "Imported from link" notice. URL hash is gone (check the address bar).
4. Click **Save** → profile is saved but not active (header pill stays "No profile" if it was empty before). Click **Save & Connect** → profile becomes active.

Test 2 — invalid hash:
1. Open `http://localhost:3000/#wsabc=garbage`. App loads normally; no transient modal.

Stop dev server.

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "Open transient profile modal from URL hash on first paint"
```

---

## Task 10: First-run modal auto-open

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add first-run effect**

After the hash-bootstrap effect, add:

```tsx
const firstRunHandledRef = useRef(false);

useEffect(() => {
  if (firstRunHandledRef.current) return;
  if (modalMode.kind !== 'closed') {
    firstRunHandledRef.current = true;
    return;
  }
  if (profiles.length === 0) {
    firstRunHandledRef.current = true;
    setModalMode({ kind: 'create' });
  }
}, [modalMode.kind, profiles.length]);
```

**Step 2: Pull `profiles` from the store**

Update the destructure at the top of `Home()`:

```tsx
const { activeProfile, setActiveProfile, profiles } = useProfileStore();
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 4: Manual smoke test**

Run: `pnpm dev`

1. Clear localStorage in DevTools (Application → Local Storage → delete `plexchat-profiles`).
2. Reload http://localhost:3000.
3. Modal auto-opens to "Create your first connection".
4. Close it without saving. Banner is visible. Reload — modal auto-opens again (because `profiles.length === 0`).
5. Save a profile. Reload — modal does NOT auto-open. Pill shows the saved profile.

Stop dev server.

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "Auto-open profile modal on first run when no profiles exist"
```

---

## Task 11: Update README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: Rewrite `README.md`**

Replace entire file with:

```markdown
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
```

**Step 2: Update `CLAUDE.md`**

Replace the **Required environment** section with:

```markdown
## Connection profiles

There are no env vars. All runtime configuration (WS URL, token, Solana RPC, cluster) lives in `localStorage` under `plexchat-profiles`, managed by `src/lib/profile-store.ts`. The active profile drives both the WebSocket connection (`use-plexchat`) and the Solana `<ConnectionProvider endpoint>`. With no active profile, the app sits disconnected and renders a banner; the wallet adapter falls back to `https://api.devnet.solana.com` so the providers tree still mounts.

Profiles can be shared via URL hash fragments (`#ws=...&token=...&rpc=...&cluster=...&name=...`). On first paint, `page.tsx` decodes the hash, opens the modal in transient mode, and clears the hash so refreshes don't re-prompt.

`src/lib/share-link.ts` owns the encode/decode logic. Tokens go in the hash by design — this is a dev tool and we explicitly accept the shoulder-surfing risk.
```

In **Architecture** → list the new files:

```markdown
### `src/lib/profile-store.ts` — connection config

Owns the list of profiles and the active id. `useProfileStore()` is a `useSyncExternalStore`-backed hook so the header pill, modal, and providers tree all see the same state without prop-drilling. Persisted to one `localStorage` key as a single JSON blob.
```

In **Things that look wrong but aren't**, replace the README port-mismatch bullet (now fixed) with:

```markdown
- **Tokens stored in plaintext localStorage and embedded in share-link hashes.** Intentional — this is a dev tool, and the user explicitly accepted the risk during design.
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Update README and CLAUDE.md for runtime profile config"
```

---

## Task 12: Final verification pass

**Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 2: Build**

Run: `pnpm build`
Expected: succeeds with no type or lint errors.

**Step 3: Full manual smoke test**

Run: `pnpm dev`

Walk through the full feature:
1. Clear localStorage. Reload. First-run modal opens.
2. Create profile A (devnet). Save & Connect.
3. Open modal, create profile B (different WS URL). Save (don't connect).
4. Use header pill to switch to B. Connection state changes.
5. From profile A, click Copy share link, open in incognito → transient modal opens.
6. Reject a transaction (only possible with a real running agent — skip if N/A).
7. Disconnect from header. Pill shows "No profile". Banner shows.
8. Delete a profile from the modal. Confirm flow works.

**Step 4: Final review and finishing**

REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` to choose how to integrate the work (PR vs. direct merge).
