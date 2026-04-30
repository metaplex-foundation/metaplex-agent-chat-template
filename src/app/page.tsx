'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import type { ServerTransaction } from '@/types/plexchat-protocol';
import { usePlexChat } from '@/hooks/use-plexchat';
import { useDebugPanel } from '@/hooks/use-debug-panel';
import { ChatPanel } from '@/components/chat-panel';
import { TransactionApproval } from '@/components/transaction-approval';
import { DebugPanel } from '@/components/debug/debug-panel';
import { ProfilePill } from '@/components/profile/profile-pill';
import { ProfileModal, type ModalMode } from '@/components/profile/profile-modal';
import { useProfileStore } from '@/lib/profile-store';
import { hashContainsProfile, tryDecodeHashToProfile } from '@/lib/share-link';

function ConnectionStatus({ isConnected, isReconnecting }: { isConnected: boolean; isReconnecting: boolean }) {
  if (isConnected) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        Connected
      </span>
    );
  }
  if (isReconnecting) {
    return (
      <span className="animate-status-pulse flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Reconnecting...
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      Disconnected
    </span>
  );
}

export default function Home() {
  const wallet = useWallet();
  const [txQueue, setTxQueue] = useState<ServerTransaction[]>([]);

  const debug = useDebugPanel();

  const { activeProfile, setActiveProfile, profiles } = useProfileStore();
  const [modalMode, setModalMode] = useState<ModalMode>({ kind: 'closed' });
  const hashBootstrappedRef = useRef(false);
  const firstRunHandledRef = useRef(false);

  const { messages, isConnected, isReconnecting, isAgentTyping, error, sendMessage, sendWalletConnect, sendWalletDisconnect, sendTxResult, sendTxError, wsLog, clearWsLog } =
    usePlexChat({
      url: activeProfile?.wsUrl ?? '',
      token: activeProfile?.token ?? '',
      onTransaction: (tx) => setTxQueue((prev) => [...prev, tx]),
      onDebugEvent: debug.handleDebugEvent,
    });

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

  // Sync wallet state with WebSocket server
  useEffect(() => {
    if (!isConnected) return;
    const address = wallet.publicKey?.toBase58() ?? null;
    if (address) {
      sendWalletConnect(address);
    } else {
      sendWalletDisconnect();
    }
  }, [wallet.publicKey, isConnected, sendWalletConnect, sendWalletDisconnect]);

  // Bootstrap a transient profile from a share link's URL hash on first paint.
  // Runs once; the hash is cleared so a refresh doesn't re-prompt.
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

  // First-run auto-open: if there are no saved profiles and nothing else has
  // opened the modal (e.g. a share-link hash), open the create modal.
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

  // Guard: warn the user if they try to close/refresh the tab while a
  // transaction approval is still pending. Losing the window abandons
  // the correlationId and the agent will time out.
  useEffect(() => {
    if (txQueue.length === 0) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Setting returnValue is required for legacy browsers.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [txQueue.length]);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/metaplex-logo-white.png"
              alt="Metaplex"
              className="h-6 w-auto"
            />
            <span className="h-7 w-px bg-zinc-700" aria-hidden="true" />
            <span className="text-base font-medium text-zinc-400">Agent</span>
          </div>
          <ConnectionStatus isConnected={isConnected} isReconnecting={isReconnecting} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProfilePill
            onManageClick={() => setModalMode({ kind: 'manage', selectedId: activeProfile?.id ?? null })}
            onSwitchProfile={handleSwitchProfile}
            onDisconnect={handleDisconnect}
          />
          <button
            onClick={debug.toggle}
            className={`rounded-lg p-2 transition-colors ${
              debug.isOpen
                ? 'bg-indigo-600/20 text-indigo-400'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
            title="Toggle debug panel (Cmd+D)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 8h2" />
              <path d="M7 12h4" />
            </svg>
          </button>
          <WalletMultiButton />
        </div>
      </header>

      {/* Auth / connection error banner (surfaced from use-plexchat) */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-950/40 px-4 py-2 text-center text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {!activeProfile && (
        <button
          type="button"
          onClick={() => setModalMode({ kind: 'create' })}
          className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300 hover:bg-amber-950/60"
        >
          No profile configured — click to add one.
        </button>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel
            messages={messages}
            isAgentTyping={isAgentTyping}
            isConnected={isConnected}
            isWalletConnected={!!wallet.publicKey}
            onSendMessage={sendMessage}
          />
        </div>

        {debug.isOpen && (
          <>
            {/* Desktop: side-by-side panel. Mobile: full-screen overlay with dismiss. */}
            <div
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              onClick={debug.toggle}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-shrink-0 flex-col bg-zinc-950 md:static md:z-auto md:w-[400px]">
              <DebugPanel
                activeTab={debug.activeTab}
                onTabChange={debug.setActiveTab}
                traces={debug.traces}
                context={debug.context}
                messages={messages}
                wsLog={wsLog}
                onClearWsLog={clearWsLog}
                sessionTotals={debug.sessionTotals}
                isConnected={isConnected}
              />
            </div>
          </>
        )}
      </div>

      {/* Transaction overlay */}
      {txQueue.length > 0 && (
        <TransactionApproval
          transaction={txQueue[0]}
          onComplete={(result) => {
            if (result.signature) {
              sendTxResult(result.correlationId, result.signature);
              setTxQueue((prev) => prev.slice(1));
            } else {
              // Reject or error — abort the whole multi-tx queue. The agent
              // decides what to do next based on the tx_error notification.
              sendTxError(result.correlationId, result.error ?? 'Transaction failed');
              setTxQueue([]);
            }
          }}
        />
      )}

      <ProfileModal
        mode={modalMode}
        onModeChange={setModalMode}
        onClose={() => setModalMode({ kind: 'closed' })}
        onConnectAfterSave={() => setModalMode({ kind: 'closed' })}
      />
    </div>
  );
}
