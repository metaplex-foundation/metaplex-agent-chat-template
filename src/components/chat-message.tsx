'use client';

import Markdown from 'react-markdown';
import { useState } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import type { ChatEntry, HistoryEntry, TransactionEntry } from '@/types/history';
import { truncatePubkey } from '@/lib/tx-preview';

// Schemes we refuse to render as live hyperlinks because they can execute
// script or embed untrusted payloads. If the LLM emits one of these we
// degrade gracefully to the raw text.
const BLOCKED_URL_SCHEMES = /^\s*(javascript|data|vbscript|file):/i;

interface SafeLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  children?: ReactNode;
}

function SafeLink({ href, children, ...rest }: SafeLinkProps) {
  if (!href || BLOCKED_URL_SCHEMES.test(href)) {
    return <span {...rest}>{children}</span>;
  }
  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatMessageBubble({ entry }: { entry: HistoryEntry }) {
  if (entry.kind === 'message') {
    return <ChatEntryBubble entry={entry} />;
  }
  return <TransactionEntryBubble entry={entry} />;
}

function ChatEntryBubble({ entry }: { entry: ChatEntry }) {
  const isUser = entry.sender === 'user';
  const isError = entry.isError === true;

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%] rounded-2xl border border-red-500/20 bg-red-950/40 px-4 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0 text-sm text-red-400">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M8 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8" cy="11" r="0.75" fill="currentColor"/>
              </svg>
            </span>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-red-300">
              {entry.content}
            </p>
          </div>
          <p className="mt-1 text-[10px] text-red-400/50">{formatTimestamp(entry.timestamp)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isUser ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.content}</p>
        ) : (
          <div className="markdown-content text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
            <Markdown components={{ a: SafeLink }}>{entry.content}</Markdown>
            {entry.isStreaming === true ? (
              <span
                aria-hidden="true"
                className="inline-block h-3.5 w-1.5 animate-pulse bg-zinc-400 align-text-bottom"
              />
            ) : null}
          </div>
        )}
        <p className={`mt-1 text-[10px] ${isUser ? 'text-indigo-200' : 'text-zinc-500'}`}>
          {formatTimestamp(entry.timestamp)}
        </p>
      </div>
    </div>
  );
}

interface StatusVisual {
  label: string;
  borderClass: string;
  bgClass: string;
  iconColor: string;
  inFlight: boolean;
  resolved: 'success' | 'rejected' | 'failed' | null;
}

function statusVisual(status: TransactionEntry['status']): StatusVisual {
  switch (status) {
    case 'pending':
      return {
        label: 'Awaiting approval',
        borderClass: 'border-indigo-500/30',
        bgClass: 'bg-indigo-950/30',
        iconColor: 'text-indigo-400',
        inFlight: true,
        resolved: null,
      };
    case 'signing':
      return {
        label: 'Signing in wallet…',
        borderClass: 'border-indigo-500/30',
        bgClass: 'bg-indigo-950/30',
        iconColor: 'text-indigo-400',
        inFlight: true,
        resolved: null,
      };
    case 'sending':
      return {
        label: 'Broadcasting…',
        borderClass: 'border-indigo-500/30',
        bgClass: 'bg-indigo-950/30',
        iconColor: 'text-indigo-400',
        inFlight: true,
        resolved: null,
      };
    case 'confirming':
      return {
        label: 'Confirming on-chain…',
        borderClass: 'border-indigo-500/30',
        bgClass: 'bg-indigo-950/30',
        iconColor: 'text-indigo-400',
        inFlight: true,
        resolved: null,
      };
    case 'confirmed':
      return {
        label: 'Confirmed',
        borderClass: 'border-emerald-500/30',
        bgClass: 'bg-emerald-950/20',
        iconColor: 'text-emerald-400',
        inFlight: false,
        resolved: 'success',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        borderClass: 'border-zinc-600/40',
        bgClass: 'bg-zinc-900/60',
        iconColor: 'text-zinc-400',
        inFlight: false,
        resolved: 'rejected',
      };
    case 'failed':
      return {
        label: 'Failed',
        borderClass: 'border-red-500/30',
        bgClass: 'bg-red-950/30',
        iconColor: 'text-red-400',
        inFlight: false,
        resolved: 'failed',
      };
    case 'abandoned':
      return {
        label: 'Abandoned',
        borderClass: 'border-amber-500/30',
        bgClass: 'bg-amber-950/20',
        iconColor: 'text-amber-400',
        inFlight: false,
        resolved: 'failed',
      };
  }
}

function StatusIcon({ visual }: { visual: StatusVisual }) {
  if (visual.inFlight) {
    return (
      <svg
        className={`h-4 w-4 animate-spin ${visual.iconColor}`}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="opacity-20" />
        <path d="M12 2C6.48 2 2 6.48 2 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (visual.resolved === 'success') {
    return (
      <svg className={`h-4 w-4 ${visual.iconColor}`} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
        <path d="M5.5 8L7.5 10L10.5 6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (visual.resolved === 'rejected') {
    return (
      <svg className={`h-4 w-4 ${visual.iconColor}`} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
        <path d="M5 8H11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  }
  // failed / abandoned
  return (
    <svg className={`h-4 w-4 ${visual.iconColor}`} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 6L6 10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M6 6L10 10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 flex-shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
      title="Copy signature"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-green-400">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M3.5 10.5H3C2.44772 10.5 2 10.0523 2 9.5V3C2 2.44772 2.44772 2 3 2H9.5C10.0523 2 10.5 2.44772 10.5 3V3.5" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      )}
    </button>
  );
}

function explorerUrlFor(signature: string, cluster: TransactionEntry['cluster']): string | null {
  if (cluster === 'mainnet-beta') return `https://explorer.solana.com/tx/${signature}`;
  if (cluster === 'devnet') return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  // localnet has no public explorer
  return null;
}

function TransactionEntryBubble({ entry }: { entry: TransactionEntry }) {
  const visual = statusVisual(entry.status);
  const explorer = entry.signature ? explorerUrlFor(entry.signature, entry.cluster) : null;

  return (
    <div className="flex justify-start">
      <div
        className={`w-full max-w-[80%] rounded-2xl border ${visual.borderClass} ${visual.bgClass} px-4 py-3`}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0">
            <StatusIcon visual={visual} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
                Transaction
              </span>
              <span className={`text-xs font-medium ${visual.iconColor}`}>{visual.label}</span>
              {entry.total && entry.total > 1 && (
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  {(entry.index ?? 0) + 1} of {entry.total}
                </span>
              )}
            </div>

            {entry.agentMessage && (
              <p className="mt-1 break-words text-sm text-zinc-200">{entry.agentMessage}</p>
            )}

            {!entry.preview.decodeFailed && entry.preview.instructionCount > 0 && (
              <div className="mt-2 space-y-0.5 text-xs text-zinc-400">
                <div>
                  <span className="text-zinc-500">Instructions:</span>{' '}
                  <span className="text-zinc-300">{entry.preview.instructionCount}</span>
                </div>
                {entry.preview.transfers.slice(0, 3).map((t, i) => (
                  <div key={`transfer-${i}`}>
                    <span className="text-zinc-500">Transfer:</span>{' '}
                    <span className="text-zinc-300">
                      {t.sol} SOL {String.fromCharCode(0x2192)}{' '}
                      <span className="font-mono">{truncatePubkey(t.destination)}</span>
                    </span>
                  </div>
                ))}
                {entry.preview.programIds.length > 0 && (
                  <div className="truncate">
                    <span className="text-zinc-500">Programs:</span>{' '}
                    <span className="font-mono text-zinc-300">
                      {entry.preview.programIds.map(truncatePubkey).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}
            {typeof entry.feeSol === 'number' && (
              <div className="mt-1 text-xs text-zinc-400">
                <span className="text-zinc-500">Fee:</span>{' '}
                <span className="text-zinc-300">{entry.feeSol} SOL</span>
              </div>
            )}

            {entry.signature && (
              <div className="mt-2 flex items-center rounded-lg bg-zinc-900/70 px-2.5 py-1.5">
                <p className="flex-1 truncate font-mono text-[11px] text-zinc-400">{entry.signature}</p>
                <CopyButton text={entry.signature} />
              </div>
            )}
            {explorer && (
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                View on Explorer
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 3H3V13H13V10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 2H14V7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                </svg>
              </a>
            )}

            {entry.error && (
              <p className="mt-2 break-words text-xs text-red-300">{entry.error}</p>
            )}

            <p className="mt-2 text-[10px] text-zinc-500">{formatTimestamp(entry.timestamp)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
