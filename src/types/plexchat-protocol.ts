// ============================================================================
// PlexChat WebSocket Protocol Types (v2 — SIWS auth)
// ============================================================================

// --- Client -> Server Messages ---

export interface ClientAuthResponse {
  type: 'auth_response';
  publicKey: string;
  signature: string; // base58 of the raw 64-byte Ed25519 signature
  message: string; // exact canonical SIWS message that was signed
}

export interface ClientChatMessage {
  type: 'message';
  content: string;
  sender_name?: string;
}

export interface ClientTransactionResult {
  type: 'tx_result';
  correlationId: string;
  signature: string;
}

export interface ClientTransactionError {
  type: 'tx_error';
  correlationId: string;
  reason: string;
}

// --- Owner-only allowlist admin (Sprint 2 #20) ---
// All three messages require `isOwner=true` server-side; non-owners get an
// `allowlist_error: not_authorized` reply instead of a state update.

export interface ClientAllowlistList {
  type: 'allowlist_list';
}

export interface ClientAllowlistAdd {
  type: 'allowlist_add';
  pubkey: string;
}

export interface ClientAllowlistRemove {
  type: 'allowlist_remove';
  pubkey: string;
}

export type ClientMessage =
  | ClientAuthResponse
  | ClientChatMessage
  | ClientTransactionResult
  | ClientTransactionError
  | ClientAllowlistList
  | ClientAllowlistAdd
  | ClientAllowlistRemove;

// --- Server -> Client Messages ---

export interface ServerConnected {
  type: 'connected';
  jid: string;
}

export type SiwsNetwork = 'solana-mainnet' | 'solana-devnet';
export type AuthMode = 'owner' | 'allowlist' | 'open';

export interface ServerAuthChallenge {
  type: 'auth_challenge';
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  agentName: string;
  agentAsset: string | null;
  network: SiwsNetwork;
  authMode: AuthMode;
}

export interface ServerAuthenticated {
  type: 'authenticated';
  walletAddress: string;
  isOwner: boolean;
  sessionId: string;
}

export interface ServerAuthError {
  type: 'auth_error';
  code: string;
  message: string;
}

export interface ServerChatMessage {
  type: 'message';
  content: string;
  sender: string;
}

export interface ServerTyping {
  type: 'typing';
  isTyping: boolean;
}

export interface ServerTransaction {
  type: 'transaction';
  transaction: string; // base64-encoded serialized Solana transaction
  correlationId: string; // server-assigned, echoed in tx_result/tx_error
  message?: string;
  index?: number;
  total?: number;
  feeSol?: number; // pre-computed fee included in this tx (public mode)
}

export interface ServerError {
  type: 'error';
  error: string;
  code?: string;
}

export interface ServerAllowlistState {
  type: 'allowlist_state';
  /** File-managed wallets (the editable portion). */
  wallets: string[];
  /** Absolute path to the JSON file the server is mutating. */
  filePath: string;
  /** Wallets supplied via WALLET_ALLOWLIST env — read-only from the UI. */
  envWallets: string[];
}

export interface ServerAllowlistError {
  type: 'allowlist_error';
  code:
    | 'not_authorized'
    | 'bad_pubkey'
    | 'wrong_auth_mode'
    | 'file_write_failed'
    | 'env_only'
    | 'internal'
    // Client-synthesized only — the hook surfaces this when an add/remove
    // is attempted while the socket is closed or the session isn't
    // authenticated, so the action fails fast instead of silently queuing.
    // The server never emits this code.
    | 'not_connected';
  message: string;
}

// --- Debug Events (Server -> Client) ---

export interface DebugStepStart {
  type: 'debug:step_start';
  step: number;
  stepType: 'initial' | 'tool-result' | 'continue';
}

export interface DebugToolCall {
  type: 'debug:tool_call';
  step: number;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface DebugToolResult {
  type: 'debug:tool_result';
  step: number;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
  durationMs: number;
}

export interface DebugTextDelta {
  type: 'debug:text_delta';
  step: number;
  delta: string;
}

export interface DebugStepComplete {
  type: 'debug:step_complete';
  step: number;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  durationMs: number;
}

export interface DebugGenerationComplete {
  type: 'debug:generation_complete';
  totalSteps: number;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  totalDurationMs: number;
  traceId?: string;
  finishReason: string;
}

export interface DebugContext {
  type: 'debug:context';
  agentMode: string;
  model: string;
  assistantName: string;
  walletAddress: string | null;
  connectedClients: number;
  conversationLength: number;
  tools: string[];
}

export type DebugMessage =
  | DebugStepStart
  | DebugToolCall
  | DebugToolResult
  | DebugTextDelta
  | DebugStepComplete
  | DebugGenerationComplete
  | DebugContext;

export type ServerMessage =
  | ServerConnected
  | ServerAuthChallenge
  | ServerAuthenticated
  | ServerAuthError
  | ServerChatMessage
  | ServerTyping
  | ServerTransaction
  | ServerError
  | ServerAllowlistState
  | ServerAllowlistError
  | DebugMessage;
