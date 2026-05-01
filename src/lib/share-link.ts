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
