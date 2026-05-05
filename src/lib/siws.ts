// Canonical SIWS message builder. Must match the agent server's
// packages/shared/src/siws.ts byte-for-byte — the server compares the
// reconstructed canonical bytes against the `message` field of `auth_response`,
// so any whitespace or formatting drift breaks verification.

import type { SiwsNetwork } from '@/types/plexchat-protocol';

export interface SiwsParams {
  agentName: string;
  agentAsset: string | null;
  network: SiwsNetwork;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export function buildSiwsMessage(p: SiwsParams): string {
  return [
    `Sign in to ${p.agentName}`,
    '',
    `Agent: ${p.agentAsset ?? 'unregistered'}`,
    `Network: ${p.network}`,
    `Nonce: ${p.nonce}`,
    `Issued: ${p.issuedAt}`,
    `Expires: ${p.expiresAt}`,
  ].join('\n');
}
