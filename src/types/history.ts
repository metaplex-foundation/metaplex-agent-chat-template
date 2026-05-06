import type { TxPreview } from '@/lib/tx-preview';
import type { SolanaCluster } from '@/lib/profile-store';

export interface ChatEntry {
  kind: 'message';
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: number;
  isStreaming?: boolean;
  isError?: boolean;
}

export type TransactionStatus =
  | 'pending'
  | 'signing'
  | 'sending'
  | 'confirming'
  | 'confirmed'
  | 'rejected'
  | 'failed'
  | 'abandoned';

export interface TransactionEntry {
  kind: 'transaction';
  id: string;
  correlationId: string;
  timestamp: number;
  status: TransactionStatus;
  agentMessage?: string;
  preview: TxPreview;
  feeSol?: number;
  index?: number;
  total?: number;
  signature?: string;
  error?: string;
  cluster: SolanaCluster;
}

export type HistoryEntry = ChatEntry | TransactionEntry;

export const IN_FLIGHT_TX_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'pending',
  'signing',
  'sending',
  'confirming',
]);

export function isInFlightTx(entry: HistoryEntry): entry is TransactionEntry {
  return entry.kind === 'transaction' && IN_FLIGHT_TX_STATUSES.has(entry.status);
}
