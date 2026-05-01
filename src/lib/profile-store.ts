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

function migrateProfile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.preset === 'string') return obj;
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
