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
