'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DebugMessage,
  DebugContext,
  DebugLedgerEntry,
} from '@metaplex-foundation/plexchat';

// --- Types ---

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ToolCallTrace {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export interface StepTrace {
  step: number;
  stepType: 'initial' | 'tool-result' | 'continue';
  toolCalls: ToolCallTrace[];
  text: string;
  usage?: TokenUsage;
  durationMs?: number;
  finishReason?: string;
}

export interface MessageTrace {
  messageId: string;
  startTime: number;
  steps: StepTrace[];
  totalUsage?: TokenUsage;
  totalDurationMs?: number;
  traceId?: string;
  finishReason?: string;
  isComplete: boolean;
}

export interface SessionTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  toolCallCounts: Record<string, number>;
  messageCount: number;
  sessionStartTime: number;
  totalResponseTimeMs: number;
}

export type DebugTab = 'steps' | 'context' | 'messages' | 'totals' | 'ledger' | 'allowlist';

/**
 * One row in the Ledger tab. Mirrors the wire-format `DebugLedgerEntry`
 * minus the `type` discriminator (rows are only stored after we've already
 * branched on type), plus a stable client-side id so React reconciliation
 * behaves even when the server doesn't supply one.
 */
export interface LedgerEntry extends Omit<DebugLedgerEntry, 'type'> {
  id: string;
}

export interface UseDebugPanelReturn {
  isOpen: boolean;
  toggle: () => void;
  activeTab: DebugTab;
  setActiveTab: (tab: DebugTab) => void;
  traces: MessageTrace[];
  context: DebugContext | null;
  sessionTotals: SessionTotals;
  ledger: LedgerEntry[];
  appendLedger: (entry: Omit<LedgerEntry, 'id'>) => void;
  clearLedger: () => void;
  handleDebugEvent: (event: DebugMessage) => void;
}

// --- Hook ---

const STORAGE_KEY = 'debug-panel-open';
const ACTIVE_TAB_STORAGE_KEY = 'plexchat-debug-active-tab';

const VALID_TABS: DebugTab[] = ['steps', 'context', 'messages', 'totals', 'ledger', 'allowlist'];

/** Cap so the in-memory ledger doesn't grow unbounded on long sessions. */
const LEDGER_MAX_ENTRIES = 500;

function isValidTab(value: string | null): value is DebugTab {
  return value !== null && (VALID_TABS as string[]).includes(value);
}

// localStorage can throw in Safari private mode, when the store is full,
// or when cookies are blocked. We treat failures as "no preference" and
// keep the UI functional rather than crashing the app on mount.
function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn(`[debug-panel] localStorage.getItem(${key}) failed`, err);
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`[debug-panel] localStorage.setItem(${key}) failed`, err);
  }
}

export function useDebugPanel(): UseDebugPanelReturn {
  const [isOpen, setIsOpen] = useState(() => safeGetItem(STORAGE_KEY) === 'true');
  const [activeTab, setActiveTabState] = useState<DebugTab>(() => {
    const stored = safeGetItem(ACTIVE_TAB_STORAGE_KEY);
    return isValidTab(stored) ? stored : 'steps';
  });
  const setActiveTab = useCallback((tab: DebugTab) => {
    setActiveTabState(tab);
    safeSetItem(ACTIVE_TAB_STORAGE_KEY, tab);
  }, []);
  const [traces, setTraces] = useState<MessageTrace[]>([]);
  const [context, setContext] = useState<DebugContext | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const ledgerCounterRef = useRef(0);

  const appendLedger = useCallback((entry: Omit<LedgerEntry, 'id'>) => {
    setLedger((prev) => {
      ledgerCounterRef.current += 1;
      const id = `ledger-${ledgerCounterRef.current}`;
      const next = [{ id, ...entry }, ...prev];
      // Cap newest-first; drop the tail when we exceed LEDGER_MAX_ENTRIES so
      // memory stays bounded on long-lived sessions.
      return next.length > LEDGER_MAX_ENTRIES
        ? next.slice(0, LEDGER_MAX_ENTRIES)
        : next;
    });
  }, []);

  const clearLedger = useCallback(() => setLedger([]), []);
  const [sessionTotals, setSessionTotals] = useState<SessionTotals>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalReasoningTokens: 0,
    toolCallCounts: {},
    messageCount: 0,
    sessionStartTime: Date.now(),
    totalResponseTimeMs: 0,
  });

  const activeTraceRef = useRef<string | null>(null);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      safeSetItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Keyboard shortcut: Cmd+D / Ctrl+D
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  const handleDebugEvent = useCallback((event: DebugMessage) => {
    switch (event.type) {
      case 'debug:context':
        setContext(event);
        break;

      case 'debug:step_start': {
        if (event.step === 1) {
          const traceId = `trace-${Date.now()}`;
          activeTraceRef.current = traceId;
          const newTrace: MessageTrace = {
            messageId: traceId,
            startTime: Date.now(),
            steps: [{ step: event.step, stepType: event.stepType, toolCalls: [], text: '' }],
            isComplete: false,
          };
          setTraces((prev) => [newTrace, ...prev]);
          setSessionTotals((prev) => ({ ...prev, messageCount: prev.messageCount + 1 }));
        } else {
          setTraces((prev) => {
            const id = activeTraceRef.current;
            return prev.map((t) =>
              t.messageId === id
                ? { ...t, steps: [...t.steps, { step: event.step, stepType: event.stepType, toolCalls: [], text: '' }] }
                : t
            );
          });
        }
        break;
      }

      case 'debug:tool_call': {
        setTraces((prev) => {
          const id = activeTraceRef.current;
          return prev.map((t) => {
            if (t.messageId !== id) return t;
            const steps = t.steps.map((s) =>
              s.step === event.step
                ? {
                    ...s,
                    toolCalls: [
                      ...s.toolCalls,
                      { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
                    ],
                  }
                : s
            );
            return { ...t, steps };
          });
        });
        setSessionTotals((prev) => ({
          ...prev,
          toolCallCounts: {
            ...prev.toolCallCounts,
            [event.toolName]: (prev.toolCallCounts[event.toolName] ?? 0) + 1,
          },
        }));
        break;
      }

      case 'debug:tool_result': {
        setTraces((prev) => {
          const id = activeTraceRef.current;
          return prev.map((t) => {
            if (t.messageId !== id) return t;
            const steps = t.steps.map((s) =>
              s.step === event.step
                ? {
                    ...s,
                    toolCalls: s.toolCalls.map((tc) =>
                      tc.toolCallId === event.toolCallId
                        ? { ...tc, result: event.result, isError: event.isError, durationMs: event.durationMs }
                        : tc
                    ),
                  }
                : s
            );
            return { ...t, steps };
          });
        });
        break;
      }

      case 'debug:text_delta': {
        setTraces((prev) => {
          const id = activeTraceRef.current;
          return prev.map((t) => {
            if (t.messageId !== id) return t;
            const steps = t.steps.map((s) =>
              s.step === event.step ? { ...s, text: s.text + event.delta } : s
            );
            return { ...t, steps };
          });
        });
        break;
      }

      case 'debug:step_complete': {
        setTraces((prev) => {
          const id = activeTraceRef.current;
          return prev.map((t) => {
            if (t.messageId !== id) return t;
            const steps = t.steps.map((s) =>
              s.step === event.step
                ? { ...s, usage: event.usage, durationMs: event.durationMs, finishReason: event.finishReason }
                : s
            );
            return { ...t, steps };
          });
        });
        setSessionTotals((prev) => ({
          ...prev,
          totalInputTokens: prev.totalInputTokens + event.usage.inputTokens,
          totalOutputTokens: prev.totalOutputTokens + event.usage.outputTokens,
          totalCachedTokens: prev.totalCachedTokens + (event.usage.cachedInputTokens ?? 0),
          totalReasoningTokens: prev.totalReasoningTokens + (event.usage.reasoningTokens ?? 0),
        }));
        break;
      }

      case 'debug:ledger': {
        // Strip the discriminator so it doesn't clutter the row detail —
        // we already know it's a ledger entry from being in this branch.
        const { type: _type, ...payload } = event;
        void _type;
        appendLedger(payload);
        break;
      }

      case 'debug:generation_complete': {
        setTraces((prev) => {
          const id = activeTraceRef.current;
          return prev.map((t) =>
            t.messageId === id
              ? {
                  ...t,
                  totalUsage: event.totalUsage,
                  totalDurationMs: event.totalDurationMs,
                  traceId: event.traceId,
                  finishReason: event.finishReason,
                  isComplete: true,
                }
              : t
          );
        });
        setSessionTotals((prev) => ({
          ...prev,
          totalResponseTimeMs: prev.totalResponseTimeMs + event.totalDurationMs,
        }));
        activeTraceRef.current = null;
        break;
      }
    }
  }, [appendLedger]);

  return {
    isOpen,
    toggle,
    activeTab,
    setActiveTab,
    traces,
    context,
    sessionTotals,
    ledger,
    appendLedger,
    clearLedger,
    handleDebugEvent,
  };
}
