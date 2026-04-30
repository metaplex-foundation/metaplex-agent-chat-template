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
