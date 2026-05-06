'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import type {
  ClientMessage,
  ServerAuthChallenge,
  ServerMessage,
  ServerTransaction,
  DebugMessage,
} from '@/types/plexchat-protocol';
import type { HistoryEntry, TransactionStatus } from '@/types/history';
import type { SolanaCluster } from '@/lib/profile-store';
import { decodeTxPreview } from '@/lib/tx-preview';
import { buildSiwsMessage } from '@/lib/siws';

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
  history: HistoryHandle;
  // Cluster captured into transaction entries at creation time so the
  // explorer link survives a profile edit later.
  cluster: SolanaCluster;
  onTransaction?: (tx: ServerTransaction) => void;
  onDebugEvent?: (event: DebugMessage) => void;
}

interface UsePlexChatReturn {
  // Socket-level connectivity (post-`connected` greeting, pre-close).
  isConnected: boolean;
  isReconnecting: boolean;
  isAgentTyping: boolean;
  error: string | null;
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
  wsLog: WsLogEntry[];
  clearWsLog: () => void;
}

let messageId = 0;
function nextId(): string {
  return `msg-${++messageId}-${Date.now()}`;
}

export function usePlexChat({
  url,
  history,
  cluster,
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
      challengeRef.current = null;
      authedAddressRef.current = null;

      const ws = new WebSocket(url);
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

            case 'message':
              setIsAgentTyping(false);
              if (streamingMsgIdRef.current) {
                historyRef.current.updateEntry(streamingMsgIdRef.current, {
                  content: data.content,
                  isStreaming: false,
                });
                streamingMsgIdRef.current = null;
                streamingTextRef.current = '';
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
  }, [url, logIncoming, flushOutgoingQueue]);

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

  return {
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
    wsLog,
    clearWsLog,
  };
}
