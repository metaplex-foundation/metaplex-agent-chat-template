# RPC Presets + Server Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the free-text RPC URL field with `mainnet` / `devnet` / `localnet` presets plus a `custom` override. Preset URLs live in server-only env vars and reach the browser through a Next.js API proxy at `/api/rpc/[cluster]`, so they never appear in client code.

**Architecture:** A new `route.ts` proxy forwards JSON-RPC POSTs to `MAINNET_RPC_URL` / `DEVNET_RPC_URL` (with public-RPC fallbacks). The profile schema gains a `preset` discriminator; `effectiveRpcUrl` / `effectiveCluster` helpers derive the actual endpoint and Explorer cluster. UI form swaps the two old fields for one Network row plus conditional custom inputs. Localnet is special: never proxied, always direct to `http://localhost:8899`.

**Tech Stack:** Next.js 15 App Router (Node runtime for the proxy), `fetch` for upstream forwarding, no new dependencies. TypeScript strict; verification gate is `pnpm typecheck` + `pnpm build` + manual dev-server smoke.

**Reference:** Design doc `docs/plans/2026-05-01-rpc-presets-design.md` (committed on `main`).

---

## Task 0: Confirm clean baseline

**Step 1: Verify worktree state**

Run: `pnpm typecheck`
Expected: exits 0, no errors.

Run: `git status`
Expected: clean tree on branch `feature/rpc-presets`.

No commit.

---

## Task 1: API proxy route + env example

**Files:**
- Create: `src/app/api/rpc/[cluster]/route.ts`
- Create: `.env.local.example`

**Step 1: Write the proxy route**

Create `src/app/api/rpc/[cluster]/route.ts`:

```ts
const UPSTREAM: Record<string, () => string> = {
  mainnet: () => process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  devnet:  () => process.env.DEVNET_RPC_URL  ?? 'https://api.devnet.solana.com',
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ cluster: string }> },
) {
  const { cluster } = await ctx.params;
  const resolve = UPSTREAM[cluster];
  if (!resolve) return new Response('Unknown cluster', { status: 404 });
  const upstream = resolve();
  const body = await req.text();
  const r = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
```

`localnet` is intentionally absent — anyone hitting `/api/rpc/localnet` gets a 404, which prevents abuse of the proxy as a way to reach the server's localhost.

**Step 2: Create `.env.local.example`**

```
# =============================================================================
# Test UI -- local environment (.env.local)
#
# Copy to .env.local and fill in the values. .env.local is gitignored by Next.js;
# never commit real secrets.
#
# These are SERVER-ONLY (no NEXT_PUBLIC_ prefix). They are read inside the
# /api/rpc/[cluster] proxy route and never reach the browser bundle.
# =============================================================================

# Optional. Falls back to https://api.mainnet-beta.solana.com when unset.
# Set this to a paid RPC endpoint to avoid the public RPC's rate limits.
MAINNET_RPC_URL=

# Optional. Falls back to https://api.devnet.solana.com when unset.
DEVNET_RPC_URL=
```

**Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 4: Smoke test the proxy**

Run: `pnpm dev` in background, wait ~5s.

Test the route exists:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:3000/api/rpc/devnet
```
Expected: `200` (the public devnet RPC responds; if devnet is down, also acceptable: `5xx` returned by the upstream).

Test 404:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/api/rpc/bogus
```
Expected: `404`.

Test localnet is NOT proxied (also 404):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/api/rpc/localnet
```
Expected: `404`.

Stop dev server.

**Step 5: Commit**

```bash
git add src/app/api/.env.local.example
# (note: actually two paths — adjust as needed)
git add src/app/api .env.local.example
git commit -m "Add /api/rpc/[cluster] proxy and server-only env example"
```

---

## Task 2: Profile schema, helpers, migration, and consumer updates

This is the biggest task — an atomic refactor. The schema change ripples into share-link, ProfileForm, ProfileModal, providers, and transaction-approval. Doing it in one commit keeps every commit typecheck-clean.

**Files modified:**
- `src/lib/profile-store.ts`
- `src/lib/share-link.ts`
- `src/components/profile/profile-form.tsx`
- `src/components/profile/profile-modal.tsx`
- `src/app/providers.tsx`
- `src/components/transaction-approval.tsx`

### Step 2a: Rewrite `src/lib/profile-store.ts`

Replace the schema, validation, mutators, and add helpers + migration. Full file:

```ts
'use client';

import { useSyncExternalStore } from 'react';

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet';

export const VALID_CLUSTERS: SolanaCluster[] = ['mainnet-beta', 'devnet', 'testnet'];

export type RpcPreset = 'mainnet' | 'devnet' | 'localnet' | 'custom';

export const VALID_PRESETS: RpcPreset[] = ['mainnet', 'devnet', 'localnet', 'custom'];

export interface AgentProfile {
  id: string;
  name: string;
  wsUrl: string;
  token: string;
  preset: RpcPreset;
  customRpcUrl?: string;
  customCluster?: SolanaCluster;
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
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map(migrateProfile).filter(isValidProfile)
      : [];
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

// Convert legacy { rpcUrl, cluster } shape into { preset: 'custom', ... }.
function migrateProfile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.preset === 'string') return obj; // already new shape
  if (typeof obj.rpcUrl === 'string' || typeof obj.cluster === 'string') {
    const cluster = (VALID_CLUSTERS as string[]).includes(obj.cluster as string)
      ? (obj.cluster as SolanaCluster)
      : 'devnet';
    return {
      id: obj.id,
      name: obj.name,
      wsUrl: obj.wsUrl,
      token: obj.token,
      preset: 'custom',
      customRpcUrl: typeof obj.rpcUrl === 'string' ? obj.rpcUrl : '',
      customCluster: cluster,
      createdAt: obj.createdAt,
    };
  }
  return obj;
}

function isValidProfile(p: unknown): p is AgentProfile {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.wsUrl !== 'string' ||
    typeof obj.token !== 'string' ||
    typeof obj.preset !== 'string' ||
    !(VALID_PRESETS as string[]).includes(obj.preset) ||
    typeof obj.createdAt !== 'number'
  ) {
    return false;
  }
  if (obj.preset === 'custom') {
    if (typeof obj.customRpcUrl !== 'string') return false;
    if (typeof obj.customCluster !== 'string' || !(VALID_CLUSTERS as string[]).includes(obj.customCluster)) {
      return false;
    }
  }
  return true;
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
  return () => {
    listeners.delete(listener);
  };
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
  preset: RpcPreset;
  customRpcUrl?: string;
  customCluster?: SolanaCluster;
}

export interface ValidationError {
  field: keyof ProfileInput;
  message: string;
}

export function validateProfileInput(input: ProfileInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.name.trim()) errors.push({ field: 'name', message: 'Name is required' });
  errors.push(...validateWsUrl(input.wsUrl));
  if (!(VALID_PRESETS as string[]).includes(input.preset)) {
    errors.push({ field: 'preset', message: 'Invalid network preset' });
  }
  if (input.preset === 'custom') {
    errors.push(...validateCustomRpcUrl(input.customRpcUrl ?? ''));
    if (input.customCluster && !(VALID_CLUSTERS as string[]).includes(input.customCluster)) {
      errors.push({ field: 'customCluster', message: 'Invalid Explorer cluster' });
    }
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

function validateCustomRpcUrl(value: string): ValidationError[] {
  if (!value.trim()) return [{ field: 'customRpcUrl', message: 'RPC URL is required for custom' }];
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [{ field: 'customRpcUrl', message: 'RPC URL must use http:// or https://' }];
    }
  } catch {
    return [{ field: 'customRpcUrl', message: 'RPC URL is not a valid URL' }];
  }
  return [];
}

export function effectiveRpcUrl(p: AgentProfile): string {
  const raw = (() => {
    switch (p.preset) {
      case 'mainnet':  return '/api/rpc/mainnet';
      case 'devnet':   return '/api/rpc/devnet';
      case 'localnet': return 'http://localhost:8899';
      case 'custom':   return p.customRpcUrl ?? '';
    }
  })();
  return raw.startsWith('/') && typeof window !== 'undefined'
    ? `${window.location.origin}${raw}`
    : raw;
}

export function effectiveCluster(p: AgentProfile): SolanaCluster {
  switch (p.preset) {
    case 'mainnet':  return 'mainnet-beta';
    case 'devnet':   return 'devnet';
    case 'localnet': return 'devnet';
    case 'custom':   return p.customCluster ?? 'devnet';
  }
}

export function createProfile(input: ProfileInput): AgentProfile {
  ensureHydrated();
  const profile: AgentProfile = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    wsUrl: input.wsUrl.trim(),
    token: input.token,
    preset: input.preset,
    ...(input.preset === 'custom' && {
      customRpcUrl: (input.customRpcUrl ?? '').trim(),
      customCluster: input.customCluster ?? 'devnet',
    }),
    createdAt: Date.now(),
  };
  const profiles = [...memoryState.profiles, profile];
  const activeProfileId = memoryState.activeProfileId ?? profile.id;
  setState({ profiles, activeProfileId });
  return profile;
}

export function updateProfile(id: string, patch: Partial<ProfileInput>): void {
  ensureHydrated();
  const profiles = memoryState.profiles.map((p) => {
    if (p.id !== id) return p;
    const next: AgentProfile = { ...p };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.wsUrl !== undefined) next.wsUrl = patch.wsUrl.trim();
    if (patch.token !== undefined) next.token = patch.token;
    if (patch.preset !== undefined) next.preset = patch.preset;
    if (next.preset === 'custom') {
      next.customRpcUrl = (patch.customRpcUrl ?? next.customRpcUrl ?? '').trim();
      next.customCluster = patch.customCluster ?? next.customCluster ?? 'devnet';
    } else {
      delete next.customRpcUrl;
      delete next.customCluster;
    }
    return next;
  });
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
  const activeProfile = state.activeProfileId
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

### Step 2b: Rewrite `src/lib/share-link.ts`

```ts
import {
  VALID_CLUSTERS,
  VALID_PRESETS,
  type AgentProfile,
  type ProfileInput,
  type RpcPreset,
  type SolanaCluster,
} from './profile-store';

export function encodeProfileToHash(
  input: Pick<AgentProfile, 'wsUrl' | 'token' | 'name' | 'preset' | 'customRpcUrl' | 'customCluster'>,
): string {
  const params = new URLSearchParams();
  params.set('ws', input.wsUrl);
  if (input.token) params.set('token', input.token);
  params.set('preset', input.preset);
  if (input.preset === 'custom') {
    if (input.customRpcUrl) params.set('rpc', input.customRpcUrl);
    if (input.customCluster) params.set('cluster', input.customCluster);
  }
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
  const token = params.get('token') ?? '';
  const name = params.get('name') ?? defaultNameFromWsUrl(ws);

  const presetRaw = params.get('preset');
  if (presetRaw && (VALID_PRESETS as string[]).includes(presetRaw)) {
    const preset = presetRaw as RpcPreset;
    if (preset === 'custom') {
      const customRpcUrl = params.get('rpc') ?? '';
      const clusterRaw = params.get('cluster') ?? 'devnet';
      const customCluster: SolanaCluster = (VALID_CLUSTERS as string[]).includes(clusterRaw)
        ? (clusterRaw as SolanaCluster)
        : 'devnet';
      return { name, wsUrl: ws, token, preset, customRpcUrl, customCluster };
    }
    return { name, wsUrl: ws, token, preset };
  }

  // Legacy decode: rpc + cluster but no preset → treat as custom.
  const legacyRpc = params.get('rpc');
  if (legacyRpc) {
    const clusterRaw = params.get('cluster') ?? 'devnet';
    const customCluster: SolanaCluster = (VALID_CLUSTERS as string[]).includes(clusterRaw)
      ? (clusterRaw as SolanaCluster)
      : 'devnet';
    return {
      name,
      wsUrl: ws,
      token,
      preset: 'custom',
      customRpcUrl: legacyRpc,
      customCluster,
    };
  }

  return null;
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
```

(The previously-exported `SHARE_HASH_KEYS` is dropped — it was unused.)

### Step 2c: Rewrite `src/components/profile/profile-form.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  validateProfileInput,
  VALID_CLUSTERS,
  VALID_PRESETS,
  type ProfileInput,
  type RpcPreset,
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
  preset: 'devnet',
  customRpcUrl: 'https://api.devnet.solana.com',
  customCluster: 'devnet',
};

const PRESET_LABELS: Record<RpcPreset, string> = {
  mainnet: 'Mainnet',
  devnet: 'Devnet',
  localnet: 'Localnet',
  custom: 'Custom',
};

const PRESET_HELPERS: Partial<Record<RpcPreset, string>> = {
  mainnet: "Routed through this app's API to keep the RPC URL private.",
  devnet: "Routed through this app's API to keep the RPC URL private.",
  localnet: 'Connects directly to http://localhost:8899 — start a local validator.',
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

      <Field label="Network" error={errorFor('preset')}>
        <div className="flex flex-wrap gap-2">
          {VALID_PRESETS.map((p) => (
            <label
              key={p}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                value.preset === p
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              <input
                type="radio"
                name="preset"
                value={p}
                checked={value.preset === p}
                onChange={() => set('preset', p)}
                className="sr-only"
              />
              {PRESET_LABELS[p]}
            </label>
          ))}
        </div>
        {PRESET_HELPERS[value.preset] && (
          <p className="mt-1 text-xs text-zinc-500">{PRESET_HELPERS[value.preset]}</p>
        )}
      </Field>

      {value.preset === 'custom' && (
        <>
          <Field label="Custom RPC URL" error={errorFor('customRpcUrl')}>
            <input
              type="text"
              value={value.customRpcUrl ?? ''}
              onChange={(e) => set('customRpcUrl', e.target.value)}
              placeholder="https://api.devnet.solana.com"
              className={`${inputClass(errorFor('customRpcUrl'))} font-mono`}
              spellCheck={false}
            />
          </Field>

          <Field label="Explorer cluster" error={errorFor('customCluster')}>
            <div className="flex gap-2">
              {VALID_CLUSTERS.map((c) => (
                <label
                  key={c}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    value.customCluster === c
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                      : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="customCluster"
                    value={c}
                    checked={value.customCluster === c}
                    onChange={() => set('customCluster', c as SolanaCluster)}
                    className="sr-only"
                  />
                  {c}
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

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

### Step 2d: Update `src/components/profile/profile-modal.tsx`

Find the `formInitial` `useMemo` (around line 53). The old shape destructured `{ name, wsUrl, token, rpcUrl, cluster }` from a profile. Update it:

```tsx
  const formInitial: ProfileInput | undefined = useMemo(() => {
    if (mode.kind === 'manage' && selectedProfile) {
      const { name, wsUrl, token, preset, customRpcUrl, customCluster } = selectedProfile;
      return { name, wsUrl, token, preset, customRpcUrl, customCluster };
    }
    if (mode.kind === 'transient') return mode.draft;
    return undefined;
  }, [mode, selectedProfile]);
```

Find the `handleShareLink` callback (around line 88). The encoder's input shape changed. Update it to forward all the new fields:

```tsx
  function handleShareLink(input: ProfileInput) {
    const hash = encodeProfileToHash({
      name: input.name,
      wsUrl: input.wsUrl,
      token: input.token,
      preset: input.preset,
      customRpcUrl: input.customRpcUrl,
      customCluster: input.customCluster,
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
```

No other modal changes needed.

### Step 2e: Update `src/app/providers.tsx`

Replace the import and the `endpoint` line:

```tsx
import { useProfileStore, effectiveRpcUrl } from '@/lib/profile-store';
```

```tsx
const { activeProfile } = useProfileStore();
const endpoint = activeProfile ? effectiveRpcUrl(activeProfile) : FALLBACK_RPC;
```

Everything else stays.

### Step 2f: Update `src/components/transaction-approval.tsx`

Replace the import:

```tsx
import { useProfileStore, effectiveCluster } from '@/lib/profile-store';
```

Replace `const cluster = activeProfile?.cluster ?? 'devnet';` with:

```tsx
const cluster = activeProfile ? effectiveCluster(activeProfile) : 'devnet';
```

Find the JSX that renders the "View on Explorer" link (the `{explorerUrl && (...)}` block, around line 415). Wrap or hide it when the active profile is on localnet:

```tsx
const isLocalnet = activeProfile?.preset === 'localnet';

// later, replace `{explorerUrl && (` with:
{!isLocalnet && explorerUrl && (
```

### Step 2g: Verify

Run: `pnpm typecheck`
Expected: exits 0, no errors.

### Step 2h: Smoke test

Run: `pnpm dev` in background, wait ~5s.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```
Expected: `200`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  http://localhost:3000/api/rpc/devnet
```
Expected: `200`.

Stop dev server.

### Step 2i: Commit

```bash
git add -A
git commit -m "Switch profiles to RPC presets with custom override"
```

---

## Task 3: Update README and CLAUDE.md

**Files:** `README.md`, `CLAUDE.md`

### Step 1: Replace `README.md`

```markdown
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
```

### Step 2: Update `CLAUDE.md`

Find the `## Connection profiles` section. Replace its body with:

```markdown
There are no public env vars — runtime configuration (WS URL, token, RPC preset) lives in `localStorage` under `plexchat-profiles`, managed by `src/lib/profile-store.ts`. The active profile drives both the WebSocket connection (`use-plexchat`) and the Solana `<ConnectionProvider endpoint>`. With no active profile, the app sits disconnected and renders a banner; the wallet adapter falls back to `https://api.devnet.solana.com` so the providers tree still mounts.

The RPC `preset` is one of `mainnet` / `devnet` / `localnet` / `custom`. Mainnet and devnet route the browser through `/api/rpc/[cluster]` (see `src/app/api/rpc/[cluster]/route.ts`), which forwards to the server-only `MAINNET_RPC_URL` / `DEVNET_RPC_URL` env vars (or public RPCs when unset). Localnet and custom connect directly. Localnet is intentionally unsupported in the proxy (returns 404) so the route can't be abused to reach the server's localhost.

Helpers `effectiveRpcUrl(profile)` and `effectiveCluster(profile)` derive the actual endpoint URL and Explorer cluster from the preset.

Profiles can be shared via URL hash fragments (`#ws=...&token=...&preset=...&name=...`; custom adds `rpc` and `cluster`). On first paint, `page.tsx` decodes the hash, opens the modal in transient mode, and clears the hash so refreshes don't re-prompt.

`src/lib/share-link.ts` owns the encode/decode logic and accepts both new (`preset=…`) and legacy (`rpc=…&cluster=…`) shapes for backward compat with already-shared links.

**Polling-fallback caveat:** `Connection.confirmTransaction` opens a WebSocket subscription to the RPC endpoint for fast-path confirmations. The proxy is HTTP-only, so preset routes (`mainnet`, `devnet`) fall back to polling and confirmations take ~5–10s longer. Custom and localnet aren't affected. Acceptable trade-off for keeping URLs server-side.
```

In the Architecture section, find the `### \`src/lib/profile-store.ts\` — connection config` subsection and update it:

```markdown
### `src/lib/profile-store.ts` — connection config

Owns the list of profiles and the active id. `useProfileStore()` is a `useSyncExternalStore`-backed hook so the header pill, modal, and providers tree all see the same state without prop-drilling. Persisted to one `localStorage` key as a single JSON blob; `safeRead` migrates old `{ rpcUrl, cluster }` records to `{ preset: 'custom', customRpcUrl, customCluster }` on load. Exposes `effectiveRpcUrl` / `effectiveCluster` helpers for consumers that need the resolved endpoint or Explorer cluster.
```

### Step 3: Verify

Run: `pnpm typecheck`
Expected: exits 0.

### Step 4: Commit

```bash
git add README.md CLAUDE.md
git commit -m "Update README and CLAUDE.md for RPC presets + proxy"
```

---

## Task 4: Final verification + finishing

**Step 1: Typecheck**
Run: `pnpm typecheck`. Expected: exit 0.

**Step 2: Build**
Run: `pnpm build`. Expected: success, no type or lint errors. Confirms the API route compiles correctly.

**Step 3: Manual smoke test**

Run: `pnpm dev`.

1. Clear localStorage. Reload `http://localhost:3000`. First-run modal opens.
2. Create a profile with Network = Mainnet. Check the form does NOT show RPC URL or Explorer cluster fields.
3. Create another profile with Network = Custom. Form shows both fields. Save.
4. Verify the share link for the Mainnet profile encodes `preset=mainnet` (not `rpc=` or `cluster=`).
5. Verify the share link for the Custom profile encodes `preset=custom&rpc=…&cluster=…`.
6. (Optional, requires real running agent) Verify mainnet preset reaches RPC via curl: `curl -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://localhost:3000/api/rpc/mainnet` — expect `200`.
7. Verify the localnet preset has `View on Explorer` hidden in the transaction approval flow (this is hard to verify without a local validator; type-check is the practical gate).

**Step 4: Final review and finishing**

REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` to merge / open PR / etc.
