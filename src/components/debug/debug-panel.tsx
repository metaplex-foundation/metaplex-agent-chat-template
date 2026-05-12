'use client';

import type { DebugTab, MessageTrace, SessionTotals } from '@/hooks/use-debug-panel';
import type {
  DebugContext,
  ServerAllowlistError,
  ServerAllowlistState,
} from '@/types/plexchat-protocol';
import type { WsLogEntry } from '@/hooks/use-plexchat';
import type { HistoryEntry } from '@/types/history';
import { StepsTab } from './steps-tab';
import { ContextTab } from './context-tab';
import { MessagesTab } from './messages-tab';
import { TotalsTab } from './totals-tab';
import { AllowlistTab } from './allowlist-tab';

interface DebugPanelProps {
  activeTab: DebugTab;
  onTabChange: (tab: DebugTab) => void;
  traces: MessageTrace[];
  context: DebugContext | null;
  entries: HistoryEntry[];
  wsLog: WsLogEntry[];
  onClearWsLog: () => void;
  sessionTotals: SessionTotals;
  isConnected: boolean;
  // Owner-only allowlist admin (Sprint 2 #20). The tab itself renders an
  // owner-only placeholder when isOwner=false; we still pass through so
  // owners can switch tabs without re-mounting.
  isOwner: boolean;
  allowlistState: ServerAllowlistState | null;
  allowlistError: ServerAllowlistError | null;
  onFetchAllowlist: () => void;
  onAddToAllowlist: (pubkey: string) => void;
  onRemoveFromAllowlist: (pubkey: string) => void;
}

const TABS: { id: DebugTab; label: string }[] = [
  { id: 'steps', label: 'Steps' },
  { id: 'context', label: 'Context' },
  { id: 'messages', label: 'Messages' },
  { id: 'totals', label: 'Totals' },
  { id: 'allowlist', label: 'Allowlist' },
];

export function DebugPanel({
  activeTab,
  onTabChange,
  traces,
  context,
  entries,
  wsLog,
  onClearWsLog,
  sessionTotals,
  isConnected,
  isOwner,
  allowlistState,
  allowlistError,
  onFetchAllowlist,
  onAddToAllowlist,
  onRemoveFromAllowlist,
}: DebugPanelProps) {
  return (
    <div className="flex h-full flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'steps' && <StepsTab traces={traces} />}
        {activeTab === 'context' && <ContextTab context={context} entries={entries} isConnected={isConnected} />}
        {activeTab === 'messages' && <MessagesTab wsLog={wsLog} onClear={onClearWsLog} />}
        {activeTab === 'totals' && <TotalsTab totals={sessionTotals} />}
        {activeTab === 'allowlist' && (
          <AllowlistTab
            isOwner={isOwner}
            state={allowlistState}
            error={allowlistError}
            onFetch={onFetchAllowlist}
            onAdd={onAddToAllowlist}
            onRemove={onRemoveFromAllowlist}
          />
        )}
      </div>
    </div>
  );
}
