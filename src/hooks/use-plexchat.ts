'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import {
  buildSiwsMessage,
  type ClientMessage,
  type ServerAllowlistState,
  type ServerAllowlistError,
  type ServerAuthChallenge,
  type ServerMessage,
  type ServerTransaction,
  type DebugMessage,
} from '@metaplex-foundation/plexchat';
import type { HistoryEntry, TransactionStatus } from '@/types/history';
import type { SolanaCluster } from '@/lib/profile-store';
import { decodeTxPreview } from '@/lib/tx-preview';

export interface WsLogEntry {
  id: string;
  timestamp: Date;
  direction: 'in' | 'out';
  data: ServerMessage | ClientMessage;
}

export type AuthState =
  | 'connecting'
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'failed';

export interface AuthError {
  code: string;
  message: string;
}

// Minimal surface the hook needs from useHistoryStore. Narrower than the
// store's full return type so tests / alternate consumers can pass a stub.
export interface HistoryHandle {
  addEntry: (entry: HistoryEntry) => void;
  updateEntry: (
    id: string,
    patch: Record<string, unknown>,
  ) => void;
  updateByCorrelationId: (
    correlationId: string,
    patch: Record<string, unknown>,
  ) => void;
}

interface UsePlexChatOptions {
  url: string;
  // Stable identity of the active profile. Two profiles can legally share
  // the same wsUrl (same agent, different RPC preset), so url alone is not
  // a sufficient connection key — without this, switching between such
  // profiles would silently keep the prior auth session.
  profileId: string | null;
  history: HistoryHandle;
  // Cluster captured into transaction entries at creation time so the
  // explorer link survives a profile edit later.
  cluster: SolanaCluster;
  // Optional managed-auth JWT. When present, the hook appends `?auth=<jwt>`
  // to the WS URL on connect and skips the SIWS challenge/response flow —
  // the server is expected to accept the bearer during the WebSocket
  // handshake and proceed directly to `authenticated`. When null/undefined,
  // the existing SIWS handshake is used unchanged.
  managedToken?: string | null;
  onTransaction?: (tx: ServerTransaction) => void;
  onDebugEvent?: (event: DebugMessage) => void;
}

interface UsePlexChatReturn {
  // Socket-level connectivity (post-`connected` greeting, pre-close).
  isConnected: boolean;
  isReconnecting: boolean;
  isAgentTyping: boolean;
  error: string | null;
  // True when a managed-auth JWT was supplied and the SIWS handshake was
  // bypassed for this connection. Drives the header badge and suppresses
  // the SIWS sign-in banner.
  isManagedMode: boolean;
  // SIWS auth-plane state.
  authState: AuthState;
  authChallenge: ServerAuthChallenge | null;
  authError: AuthError | null;
  walletAddress: string | null;
  isOwner: boolean;
  signIn: () => Promise<void>;
  retryAuth: () => void;
  sendMessage: (content: string) => void;
  sendTxResult: (correlationId: string, signature: string) => void;
  sendTxError: (correlationId: string, reason: string) => void;
  reportTxStatus: (correlationId: string, status: TransactionStatus) => void;
  // Owner-only allowlist admin (Sprint 2 #20). All three calls are no-ops
  // when the connected wallet isn't the on-chain owner — the server returns
  // an `allowlist_error: not_authorized` which surfaces via `allowlistError`.
  allowlistState: ServerAllowlistState | null;
  allowlistError: ServerAllowlistError | null;
  fetchAllowlist: () => void;
  addToAllowlist: (pubkey: string) => void;
  removeFromAllowlist: (pubkey: string) => void;
  wsLog: WsLogEntry[];
  clearWsLog: () => void;
}

let messageId = 0;
function nextId(): string {
  return `msg-${++messageId}-${Date.now()}`;
}

export function usePlexChat({
  url,
  profileId,
  history,
  cluster,
  managedToken,
  onTransaction,
  onDebugEvent,
}: UsePlexChatOptions): UsePlexChatReturn {
  const wallet = useWallet();
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>('connecting');
  const [authChallenge, setAuthChallenge] = useState<ServerAuthChallenge | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [allowlistState, setAllowlistState] = useState<ServerAllowlistState | null>(null);
  const [allowlistError, setAllowlistError] = useState<ServerAllowlistError | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);
  const onTransactionRef = useRef(onTransaction);
  onTransactionRef.current = onTransaction;
  const onDebugEventRef = useRef(onDebugEvent);
  onDebugEventRef.current = onDebugEvent;
  // Mirror history + cluster into refs so the WebSocket onmessage closure
  // (captured at effect mount time) sees the *current* values after profile
  // switches without forcing the whole socket to tear down on every change.
  const historyRef = useRef(history);
  historyRef.current = history;
  const clusterRef = useRef(cluster);
  clusterRef.current = cluster;

  const [wsLog, setWsLog] = useState<WsLogEntry[]>([]);
  const streamingTextRef = useRef('');
  const streamingMsgIdRef = useRef<string | null>(null);

  // v2 streaming demux: server may interleave multiple in-flight assistant
  // messages on the wire, each tagged with its own `id`. We keep a per-`id`
  // buffer holding the local history entry id and the accumulated content,
  // then reconcile against the terminal v1 `message` frame (still emitted on
  // completion for backwards compat). `finish` clears the buffer for an id.
  const v2StreamsRef = useRef<Map<string, { entryId: string; content: string }>>(
    new Map(),
  );
  // Most-recently finished v2 stream's history entry id. The terminal v1
  // `message` frame carries no id, so we reconcile by recency: if `finish`
  // just cleared a v2 buffer and `message` arrives next, treat the `message`
  // content as the canonical final body for that entry instead of creating a
  // duplicate row.
  const v2LastFinishedEntryIdRef = useRef<string | null>(null);

  // Mirror authState into a ref so the WebSocket onmessage closure (captured
  // when the effect mounts) sees the *current* auth state, not the stale value
  // from closure-creation time. Without this, post-auth chat-plane messages
  // would be evaluated against a stale `authState` and silently dropped.
  const authStateRef = useRef<AuthState>('connecting');
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  // Cached challenge for the in-flight handshake. Single-use — cleared once
  // signIn() consumes it (whether success, failure, or user-cancel).
  const challengeRef = useRef<ServerAuthChallenge | null>(null);

  // Track which wallet address authenticated on the current socket. If the
  // connected wallet's publicKey diverges, the bound identity is stale —
  // reconnect to acquire a fresh challenge that the new wallet can sign.
  const authedAddressRef = useRef<string | null>(null);

  // Buffer outgoing messages while the socket is closed/reconnecting so they
  // aren't silently dropped mid-reconnect. Only chat-plane messages should be
  // queued — auth-plane sends always run synchronously inside signIn().
  const outgoingQueueRef = useRef<ClientMessage[]>([]);

  const clearWsLog = useCallback(() => setWsLog([]), []);

  const logIncoming = useCallback((data: ServerMessage) => {
    setWsLog((prev) => {
      const next = [...prev, { id: nextId(), timestamp: new Date(), direction: 'in' as const, data }];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const logOutgoing = useCallback((data: ClientMessage) => {
    setWsLog((prev) => {
      const next = [...prev, { id: nextId(), timestamp: new Date(), direction: 'out' as const, data }];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const flushOutgoingQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (authStateRef.current !== 'authenticated') return;
    while (outgoingQueueRef.current.length > 0) {
      const msg = outgoingQueueRef.current.shift()!;
      ws.send(JSON.stringify(msg));
      logOutgoing(msg);
    }
  }, [logOutgoing]);

  const connect = useCallback(() => {
    if (!url) return;

    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      intentionalCloseRef.current = false;
      // Reset auth-plane state at the start of each connection attempt.
      setAuthState('connecting');
      setAuthChallenge(null);
      setAuthError(null);
      setWalletAddress(null);
      setIsOwner(false);
      // Drop the previous profile/session's allowlist snapshot and any
      // targeted error. Without this, switching profiles leaves stale admin
      // data visible, and the allowlist tab's `state === null` auto-fetch
      // guard would not re-trigger on the new connection.
      setAllowlistState(null);
      setAllowlistError(null);
      challengeRef.current = null;
      authedAddressRef.current = null;
      // Streaming entry ids belong to the previous profile's history slice;
      // they're not valid against whatever slice we're now talking to.
      streamingMsgIdRef.current = null;
      streamingTextRef.current = '';
      v2StreamsRef.current.clear();
      v2LastFinishedEntryIdRef.current = null;

      // Managed-auth path: append the JWT as `?auth=<jwt>` so the server can
      // validate during the WebSocket handshake (browser WS API has no way
      // to attach headers, so query-string is the standard escape hatch).
      // Preserves any pre-existing query the profile URL already carries.
      let connectUrl = url;
      if (managedToken) {
        const sep = url.includes('?') ? '&' : '?';
        connectUrl = `${url}${sep}auth=${encodeURIComponent(managedToken)}`;
      }
      const ws = new WebSocket(connectUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = 1000;
        setIsReconnecting(false);
      };

      ws.onmessage = (event) => {
        if (ws !== wsRef.current) return;

        try {
          const data: ServerMessage = JSON.parse(event.data as string);
          logIncoming(data);

          if (data.type.startsWith('debug:')) {
            onDebugEventRef.current?.(data as DebugMessage);
          }

          switch (data.type) {
            case 'connected':
              setIsConnected(true);
              // Wait for `auth_challenge`. Don't flush the outgoing queue yet —
              // sends are gated on `authenticated`.
              break;

            case 'auth_challenge':
              challengeRef.current = data;
              setAuthChallenge(data);
              setAuthError(null);
              setAuthState('unauthenticated');
              break;

            case 'authenticated':
              setWalletAddress(data.walletAddress);
              setIsOwner(data.isOwner);
              authedAddressRef.current = data.walletAddress;
              // Sync the ref synchronously: the useEffect mirror only runs
              // after this render commits, but flushOutgoingQueue() needs to
              // see the new value *now* or it will short-circuit on the
              // `authStateRef.current !== 'authenticated'` guard.
              authStateRef.current = 'authenticated';
              setAuthState('authenticated');
              setError(null);
              setAuthError(null);
              flushOutgoingQueue();
              break;

            case 'auth_error':
              setAuthError({ code: data.code, message: data.message });
              setAuthState('failed');
              challengeRef.current = null;
              break;

            case 'debug:text_delta': {
              setIsAgentTyping(false);
              if (!streamingMsgIdRef.current) {
                const id = nextId();
                streamingMsgIdRef.current = id;
                streamingTextRef.current = data.delta;
                historyRef.current.addEntry({
                  kind: 'message',
                  id,
                  content: data.delta,
                  sender: 'agent',
                  timestamp: Date.now(),
                  isStreaming: true,
                });
              } else {
                streamingTextRef.current += data.delta;
                historyRef.current.updateEntry(streamingMsgIdRef.current, {
                  content: streamingTextRef.current,
                });
              }
              break;
            }

            case 'text_delta': {
              // v2 streaming. Demux by message `id`; the existing v1
              // `debug:text_delta` reducer remains untouched for v1 servers.
              setIsAgentTyping(false);
              const existing = v2StreamsRef.current.get(data.id);
              if (!existing) {
                const entryId = nextId();
                v2StreamsRef.current.set(data.id, { entryId, content: data.delta });
                historyRef.current.addEntry({
                  kind: 'message',
                  id: entryId,
                  content: data.delta,
                  sender: 'agent',
                  timestamp: Date.now(),
                  isStreaming: true,
                });
              } else {
                existing.content += data.delta;
                historyRef.current.updateEntry(existing.entryId, {
                  content: existing.content,
                });
              }
              break;
            }

            case 'tool_call':
            case 'tool_result':
              // Pushed into the wsLog ring buffer (see logIncoming above) so
              // the Messages tab renders them via the existing collapsible
              // JSON pattern. No state mutation is needed here — the debug
              // panel reads off the ring buffer.
              break;

            case 'finish': {
              // Mark the v2 in-progress message complete and clear its
              // buffer. The terminal v1 `message` frame may still arrive for
              // backwards compat; if it does, the `case 'message'` arm below
              // tolerates "already finalized" by treating a missing buffer
              // as a fresh entry. Servers SHOULD emit identical content in
              // both frames so reconciliation is a no-op.
              const buf = v2StreamsRef.current.get(data.id);
              if (buf) {
                historyRef.current.updateEntry(buf.entryId, {
                  isStreaming: false,
                });
                v2StreamsRef.current.delete(data.id);
                v2LastFinishedEntryIdRef.current = buf.entryId;
              }
              break;
            }

            case 'message':
              setIsAgentTyping(false);
              if (streamingMsgIdRef.current) {
                historyRef.current.updateEntry(streamingMsgIdRef.current, {
                  content: data.content,
                  isStreaming: false,
                });
                streamingMsgIdRef.current = null;
                streamingTextRef.current = '';
              } else if (v2LastFinishedEntryIdRef.current) {
                // Reconcile with the just-finished v2 stream (v1 backwards-
                // compat terminal frame): overwrite content so any divergence
                // between accumulated deltas and the server's canonical body
                // resolves in favor of the latter.
                historyRef.current.updateEntry(v2LastFinishedEntryIdRef.current, {
                  content: data.content,
                  isStreaming: false,
                });
                v2LastFinishedEntryIdRef.current = null;
              } else {
                historyRef.current.addEntry({
                  kind: 'message',
                  id: nextId(),
                  content: data.content,
                  sender: 'agent',
                  timestamp: Date.now(),
                });
              }
              break;

            case 'typing':
              setIsAgentTyping(data.isTyping);
              break;

            case 'transaction': {
              // Add the inline bubble *before* forwarding, so the timeline
              // reflects the request the moment the modal pops.
              historyRef.current.addEntry({
                kind: 'transaction',
                id: nextId(),
                correlationId: data.correlationId,
                timestamp: Date.now(),
                status: 'pending',
                agentMessage: data.message,
                preview: decodeTxPreview(data.transaction),
                feeSol: data.feeSol,
                index: data.index,
                total: data.total,
                cluster: clusterRef.current,
              });
              onTransactionRef.current?.(data);
              break;
            }

            case 'error':
              historyRef.current.addEntry({
                kind: 'message',
                id: nextId(),
                content: data.error,
                sender: 'agent',
                timestamp: Date.now(),
                isError: true,
              });
              break;

            case 'allowlist_state':
              // Successful list/add/remove — clear any previous targeted
              // error, since the server has now confirmed a fresh snapshot.
              setAllowlistState(data);
              setAllowlistError(null);
              break;

            case 'allowlist_error':
              // Targeted error — does NOT clobber the last good snapshot,
              // so the UI can show "couldn't add X" inline next to the
              // existing list rather than blanking it.
              setAllowlistError(data);
              break;
          }
        } catch (err) {
          console.warn('PlexChat: malformed server message', err);
        }
      };

      ws.onclose = (event) => {
        if (ws === wsRef.current) {
          setIsConnected(false);
          wsRef.current = null;
        }
        setIsAgentTyping(false);
        challengeRef.current = null;
        authedAddressRef.current = null;

        // 4001 — auth-plane terminal close (bad signature, expired challenge,
        // unauthorized wallet, rate limit, etc.). Stop reconnecting; the user
        // must manually retry to get a fresh challenge.
        if (event.code === 4001) {
          intentionalCloseRef.current = true;
          setIsReconnecting(false);
          setAuthState('failed');
          // If the server didn't send an auth_error message before closing,
          // synthesize one so the UI has something to display.
          setAuthError((prev) => prev ?? { code: 'unauthorized', message: 'Authentication failed' });
          return;
        }

        if (intentionalCloseRef.current) return;

        setIsReconnecting(true);
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 10000);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (event) => {
        console.error('PlexChat: WebSocket error', event);
      };
    } catch (err) {
      console.error('PlexChat: connect failed', err);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 10000);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    }
    // profileId in the dep list: two distinct profiles can share a wsUrl
    // (same agent, different RPC presets), and url alone would silently
    // reuse the old socket and its bound auth session across the swap.
    // managedToken: rotating the token requires re-handshaking on the
    // server side, so a change tears down the socket here.
  }, [url, profileId, managedToken, logIncoming, flushOutgoingQueue]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      intentionalCloseRef.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  // If the connected wallet diverges from the wallet that authenticated this
  // session, the server's bound identity is stale — drop the socket so the
  // next connection picks up a fresh challenge for the new wallet.
  const currentWalletAddress = wallet.publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (authState !== 'authenticated') return;
    if (!authedAddressRef.current) return;
    if (currentWalletAddress === authedAddressRef.current) return;
    // Wallet swap (or disconnect): tear down and let the reconnect flow run.
    intentionalCloseRef.current = false;
    wsRef.current?.close();
  }, [authState, currentWalletAddress]);

  const signIn = useCallback(async () => {
    const challenge = challengeRef.current;
    const ws = wsRef.current;
    if (!challenge || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (authStateRef.current !== 'unauthenticated') return;

    if (!wallet.publicKey || !wallet.signMessage) {
      setAuthError({
        code: 'wallet_unsupported',
        message: 'This wallet cannot sign messages. Use Phantom or Solflare.',
      });
      setAuthState('failed');
      return;
    }

    setAuthState('authenticating');

    try {
      const canonical = buildSiwsMessage({
        agentName: challenge.agentName,
        agentAsset: challenge.agentAsset,
        network: challenge.network,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      });
      const messageBytes = new TextEncoder().encode(canonical);
      const signatureBytes = await wallet.signMessage(messageBytes);
      const encodedSignature = bs58.encode(signatureBytes);
      const authResponse: ClientMessage = {
        type: 'auth_response',
        publicKey: wallet.publicKey.toBase58(),
        signature: encodedSignature,
        message: canonical,
      };

      ws.send(JSON.stringify(authResponse));
      logOutgoing(authResponse);
      // Stay in 'authenticating' until the server replies with `authenticated`
      // or `auth_error`.
    } catch (err) {
      // User rejected the prompt or the wallet threw. Free the server's
      // connection slot immediately and drop the cached challenge so a retry
      // requires a brand-new connection (fresh nonce, no stale state).
      setAuthError({
        code: 'user_rejected',
        message: err instanceof Error ? err.message : 'Signing was cancelled.',
      });
      setAuthState('failed');
      challengeRef.current = null;
      intentionalCloseRef.current = true;
      wsRef.current?.close(1000, 'user cancelled signing');
    }
  }, [wallet, logOutgoing]);

  const retryAuth = useCallback(() => {
    // Tear down the (likely terminal) socket and start a fresh connection,
    // which re-runs the SIWS handshake from the top with a new nonce.
    clearTimeout(reconnectTimeoutRef.current);
    intentionalCloseRef.current = true;
    wsRef.current?.close();
    wsRef.current = null;
    reconnectDelayRef.current = 1000;
    setIsReconnecting(false);
    setAuthError(null);
    // Defer connect to next tick so React commits the state reset first.
    reconnectTimeoutRef.current = setTimeout(connect, 0);
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    const authed = authStateRef.current === 'authenticated';
    if (authed && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      logOutgoing(msg);
    } else {
      // Queue for delivery once authenticated. Cap to bound offline buffering.
      if (outgoingQueueRef.current.length < 50) {
        outgoingQueueRef.current.push(msg);
      } else {
        console.warn('PlexChat: outgoing queue full, dropping message', msg);
      }
    }
  }, [logOutgoing]);

  const sendMessage = useCallback(
    (content: string) => {
      historyRef.current.addEntry({
        kind: 'message',
        id: nextId(),
        content,
        sender: 'user',
        timestamp: Date.now(),
      });
      send({ type: 'message', content });
    },
    [send],
  );

  const sendTxResult = useCallback(
    (correlationId: string, signature: string) => {
      historyRef.current.updateByCorrelationId(correlationId, {
        status: 'confirmed',
        signature,
      });
      send({ type: 'tx_result', correlationId, signature });
    },
    [send],
  );

  const sendTxError = useCallback(
    (correlationId: string, reason: string) => {
      const status: TransactionStatus =
        reason === 'User rejected transaction' ? 'rejected' : 'failed';
      historyRef.current.updateByCorrelationId(correlationId, { status, error: reason });
      send({ type: 'tx_error', correlationId, reason });
    },
    [send],
  );

  const reportTxStatus = useCallback(
    (correlationId: string, status: TransactionStatus) => {
      historyRef.current.updateByCorrelationId(correlationId, { status });
    },
    [],
  );

  const fetchAllowlist = useCallback(() => {
    // Reset the targeted error optimistically so the UI doesn't show a
    // stale "couldn't add X" while the new request is in flight.
    setAllowlistError(null);
    send({ type: 'allowlist_list' });
  }, [send]);

  // Guard for write actions. The generic `send()` queues messages while
  // offline, which is fine for chat and for the read-only `allowlist_list`,
  // but for mutations it would silently buffer admin changes — and the
  // outgoing queue persists across profile switches, so a queued add/remove
  // could land on the wrong agent. Fail fast and surface a visible error.
  const guardAllowlistWrite = useCallback((): ServerAllowlistError | null => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return {
        type: 'allowlist_error',
        code: 'not_connected',
        message: 'Not connected to the agent. Reconnect and try again.',
      };
    }
    if (authStateRef.current !== 'authenticated') {
      return {
        type: 'allowlist_error',
        code: 'not_connected',
        message: 'Sign in before managing the allowlist.',
      };
    }
    return null;
  }, []);

  const addToAllowlist = useCallback(
    (pubkey: string) => {
      const guard = guardAllowlistWrite();
      if (guard) {
        setAllowlistError(guard);
        return;
      }
      setAllowlistError(null);
      send({ type: 'allowlist_add', pubkey });
    },
    [send, guardAllowlistWrite],
  );

  const removeFromAllowlist = useCallback(
    (pubkey: string) => {
      const guard = guardAllowlistWrite();
      if (guard) {
        setAllowlistError(guard);
        return;
      }
      setAllowlistError(null);
      send({ type: 'allowlist_remove', pubkey });
    },
    [send, guardAllowlistWrite],
  );

  return {
    isConnected,
    isReconnecting,
    isAgentTyping,
    error,
    isManagedMode: !!managedToken,
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
  };
}
