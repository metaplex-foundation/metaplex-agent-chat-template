'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import type { ServerAuthChallenge, ServerTransaction } from '@metaplex-foundation/plexchat';
import { usePlexChat, type AuthError, type AuthState } from '@/hooks/use-plexchat';
import { useDebugPanel } from '@/hooks/use-debug-panel';
import { ChatPanel } from '@/components/chat-panel';
import { TransactionApproval } from '@/components/transaction-approval';
import { DebugPanel } from '@/components/debug/debug-panel';
import { ProfilePill } from '@/components/profile/profile-pill';
import { ProfileModal, type ModalMode } from '@/components/profile/profile-modal';
import { useProfileStore, effectiveCluster } from '@/lib/profile-store';
import { useHistoryStore } from '@/lib/history-store';
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
  const history = useHistoryStore(activeProfile?.id ?? null);
  const [modalMode, setModalMode] = useState<ModalMode>({ kind: 'closed' });
  const hashBootstrappedRef = useRef(false);
  const firstRunHandledRef = useRef(false);

  // Cluster is captured into each transaction entry at creation time so the
  // explorer link survives a profile edit later. Falls back to devnet so the
  // type stays narrow when no profile is active.
  const cluster = activeProfile ? effectiveCluster(activeProfile) : 'devnet';

  const {
    isConnected,
    isReconnecting,
    isAgentTyping,
    error,
    authState,
    authChallenge,
    authError,
    walletAddress,
    isOwner,
    signIn,
    retryAuth,
    sendMessage,
    sendTxResult,
    sendTxError,
    reportTxStatus,
    allowlistState,
    allowlistError,
    fetchAllowlist,
    addToAllowlist,
    removeFromAllowlist,
    wsLog,
    clearWsLog,
  } = usePlexChat({
    url: activeProfile?.wsUrl ?? '',
    profileId: activeProfile?.id ?? null,
    history,
    cluster,
    onTransaction: (tx) => setTxQueue((prev) => [...prev, tx]),
    onDebugEvent: debug.handleDebugEvent,
  });

  const isAuthenticated = authState === 'authenticated';
  const isBusy = txQueue.length > 0 || isAgentTyping;
  const canClearHistory = !!activeProfile && history.entries.length > 0;

  const handleClearHistory = () => {
    if (!canClearHistory) return;
    const ok = window.confirm('Clear chat history for this profile? This cannot be undone.');
    if (!ok) return;
    history.clear();
  };

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

  // Bootstrap a transient profile from a share link's URL hash on first paint.
  // Runs once; the hash is cleared so a refresh doesn't re-prompt.
  useEffect(() => {
    if (hashBootstrappedRef.current) return;
    hashBootstrappedRef.current = true;
    if (typeof window === 'undefined') return;
    if (!hashContainsProfile(window.location.hash)) return;
    const draft = tryDecodeHashToProfile(window.location.hash);
    if (!draft) return;
    firstRunHandledRef.current = true;
    setModalMode({ kind: 'transient', draft });
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
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
            type="button"
            onClick={handleClearHistory}
            disabled={!canClearHistory}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
            title={canClearHistory ? 'Clear chat history' : 'No history to clear'}
            aria-label="Clear chat history"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
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

      {activeProfile && (
        <AuthBanner
          authState={authState}
          authChallenge={authChallenge}
          authError={authError}
          walletAddress={walletAddress}
          isOwner={isOwner}
          walletConnected={!!wallet.publicKey}
          canSign={!!wallet.signMessage}
          signIn={signIn}
          retryAuth={retryAuth}
        />
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel
            entries={history.entries}
            isAgentTyping={isAgentTyping}
            isConnected={isConnected}
            isAuthenticated={isAuthenticated}
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
                entries={history.entries}
                wsLog={wsLog}
                onClearWsLog={clearWsLog}
                sessionTotals={debug.sessionTotals}
                isConnected={isConnected}
                isOwner={isOwner}
                allowlistState={allowlistState}
                allowlistError={allowlistError}
                onFetchAllowlist={fetchAllowlist}
                onAddToAllowlist={addToAllowlist}
                onRemoveFromAllowlist={removeFromAllowlist}
              />
            </div>
          </>
        )}
      </div>

      {/* Transaction overlay */}
      {txQueue.length > 0 && (
        <TransactionApproval
          transaction={txQueue[0]}
          onStatusChange={reportTxStatus}
          // Eager hand-off: send tx_result the moment sendRawTransaction
          // returns. Decouples the agent server from the chat UI's local
          // confirmation polling, which can fail spuriously when the
          // Solana RPC websocket is flaky.
          onSubmitted={(correlationId, signature) => {
            sendTxResult(correlationId, signature);
          }}
          onComplete={(result) => {
            if (result.signature) {
              // tx_result was already sent via onSubmitted — just advance
              // the queue. (Sending tx_result again would be harmless but
              // redundant given the server's late-arrival handling.)
              setTxQueue((prev) => prev.slice(1));
            } else {
              sendTxError(result.correlationId, result.error ?? 'Transaction failed');
              // Mark every queued tx after the failed one as abandoned so
              // the history reflects that the user never got a chance to
              // act on them. The first item (index 0) is the one we just
              // rejected/failed and is already updated by sendTxError.
              setTxQueue((prev) => {
                for (let i = 1; i < prev.length; i++) {
                  history.updateByCorrelationId(prev[i].correlationId, {
                    status: 'abandoned',
                    error: 'Cancelled by prior tx error',
                  });
                }
                return [];
              });
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

interface AuthBannerProps {
  authState: AuthState;
  authChallenge: ServerAuthChallenge | null;
  authError: AuthError | null;
  walletAddress: string | null;
  isOwner: boolean;
  walletConnected: boolean;
  canSign: boolean;
  signIn: () => Promise<void>;
  retryAuth: () => void;
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function AuthBanner({
  authState,
  authChallenge,
  authError,
  walletAddress,
  isOwner,
  walletConnected,
  canSign,
  signIn,
  retryAuth,
}: AuthBannerProps) {
  if (authState === 'connecting') {
    return (
      <div className="border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-center text-xs text-zinc-400">
        Connecting to agent…
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    if (!walletConnected) {
      return (
        <div className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-center text-sm text-amber-300">
          Connect a Solana wallet to sign in.
        </div>
      );
    }
    if (!canSign) {
      return (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-950/40 px-4 py-2 text-center text-sm text-red-300"
        >
          This wallet does not support message signing — please use Phantom or Solflare.
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 border-b border-indigo-500/30 bg-indigo-950/30 px-4 py-2 text-sm text-indigo-200">
        <span>
          Sign in to <strong>{authChallenge?.agentName ?? 'this agent'}</strong> with your Solana wallet to chat.
        </span>
        <button
          type="button"
          onClick={() => {
            void signIn();
          }}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (authState === 'authenticating') {
    return (
      <div className="border-b border-indigo-500/30 bg-indigo-950/30 px-4 py-2 text-center text-sm text-indigo-200">
        Awaiting wallet signature…
      </div>
    );
  }

  if (authState === 'failed') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-center gap-3 border-b border-red-500/30 bg-red-950/40 px-4 py-2 text-sm text-red-300"
      >
        <span>{authError?.message ?? 'Authentication failed.'}</span>
        <button
          type="button"
          onClick={retryAuth}
          className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-900/40"
        >
          Try again
        </button>
      </div>
    );
  }

  // authenticated
  if (!walletAddress) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-emerald-500/30 bg-emerald-950/20 px-4 py-1 text-xs text-emerald-300">
      <span>
        Signed in as <span className="font-mono">{shortAddr(walletAddress)}</span>
      </span>
      {isOwner && (
        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200">
          owner
        </span>
      )}
    </div>
  );
}
