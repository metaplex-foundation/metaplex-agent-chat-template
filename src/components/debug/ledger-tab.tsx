'use client';

import { useMemo, useState } from 'react';
import type { LedgerEntry } from '@/hooks/use-debug-panel';

interface LedgerTabProps {
  entries: LedgerEntry[];
  onClear: () => void;
}

const KIND_LABELS: Record<string, string> = {
  'x402-paid': 'x402 paid',
  'x402-received': 'x402 received',
  'delegate-charge': 'delegate-pay',
  'delegate-onboard': 'delegated',
  'user-tx-signed': 'user-signed',
  fund: 'fund',
  balance: 'balance',
  note: 'note',
};

const KIND_BADGE_CLASS: Record<string, string> = {
  'x402-paid': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'x402-received': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'delegate-charge': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'delegate-onboard': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'user-tx-signed': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  fund: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  balance: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  note: 'bg-zinc-700/40 text-zinc-400 border-zinc-700',
};

const PURPOSE_LABELS: Record<string, string> = {
  inference: 'inference',
  rpc: 'RPC',
  tool: 'tool',
  storage: 'storage',
  compute: 'compute',
  onboarding: 'onboarding',
  other: 'other',
};

const PURPOSE_BADGE_CLASS: Record<string, string> = {
  inference: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  rpc: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  tool: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  storage: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  compute: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  onboarding: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  other: 'bg-zinc-700/40 text-zinc-400 border-zinc-700',
};

const DEFAULT_PURPOSE_BADGE = 'bg-zinc-700/40 text-zinc-400 border-zinc-700';

function explorerUrl(signature: string, cluster: LedgerEntry['cluster']): string {
  const q =
    cluster === 'mainnet-beta' || cluster == null
      ? ''
      : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${signature}${q}`;
}

function shortPk(pk: string | null | undefined): string {
  if (!pk) return '\u2014';
  return pk.length > 12 ? `${pk.slice(0, 4)}\u2026${pk.slice(-4)}` : pk;
}

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return ts;
  }
}

export function LedgerTab({ entries, onClear }: LedgerTabProps) {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.kind);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.kind === filter)),
    [entries, filter],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/30 px-2 py-1.5">
        <FilterChip
          active={filter === 'all'}
          label={`All (${entries.length})`}
          onClick={() => setFilter('all')}
        />
        {kinds.map((k) => (
          <FilterChip
            key={k}
            active={filter === k}
            label={KIND_LABELS[k] ?? k}
            onClick={() => setFilter(k)}
          />
        ))}
        <button
          onClick={onClear}
          className="ml-auto rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[11px] text-zinc-500">
          {entries.length === 0
            ? 'No ledger entries yet. Payments, charges, and signed txs will appear here as they happen.'
            : `No entries match "${filter}".`}
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-zinc-900 overflow-y-auto">
          {filtered.map((entry) => (
            <LedgerCard
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === entry.id ? null : entry.id))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
          : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
}

function LedgerCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: LedgerEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badgeClass = KIND_BADGE_CLASS[entry.kind] ?? KIND_BADGE_CLASS.note!;
  const amount = entry.amountDisplay
    ? entry.amountDisplay
    : entry.amount && entry.unit
      ? `${entry.amount} ${entry.unit}`
      : null;
  const hasMeta = entry.from || entry.to || entry.signature;
  const hasDetail =
    expanded &&
    (entry.from ||
      entry.to ||
      entry.amount ||
      entry.cluster ||
      entry.signature ||
      (entry.detail && Object.keys(entry.detail).length > 0));

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="block w-full cursor-pointer px-2 py-2 text-left hover:bg-zinc-900/40"
      >
        <div className="flex items-center gap-2">
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${badgeClass}`}
          >
            {KIND_LABELS[entry.kind] ?? entry.kind}
          </span>
          {entry.purpose && (
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                PURPOSE_BADGE_CLASS[entry.purpose] ?? DEFAULT_PURPOSE_BADGE
              }`}
            >
              {PURPOSE_LABELS[entry.purpose] ?? entry.purpose}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">
            {entry.label}
          </span>
          {amount && (
            <span className="shrink-0 font-mono text-[11px] text-zinc-300">
              {amount}
            </span>
          )}
          <span
            className={`shrink-0 text-[10px] text-zinc-600 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ›
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
          <span className="font-mono">{fmtTime(entry.ts)}</span>
          {hasMeta && <span className="text-zinc-700">·</span>}
          {(entry.from || entry.to) && (
            <span className="font-mono text-zinc-400">
              {shortPk(entry.from)}
              <span className="px-1 text-zinc-600">→</span>
              {shortPk(entry.to)}
            </span>
          )}
          {entry.signature && (
            <a
              href={explorerUrl(entry.signature, entry.cluster ?? null)}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-indigo-400 hover:underline"
            >
              tx:{shortPk(entry.signature)}↗
            </a>
          )}
        </div>
      </button>
      {hasDetail && (
        <div className="bg-zinc-900/40 px-3 py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
            {entry.from && <Detail label="From" value={entry.from} mono />}
            {entry.to && <Detail label="To" value={entry.to} mono />}
            {entry.amount && (
              <Detail
                label="Amount"
                value={`${entry.amount}${entry.unit ? ' ' + entry.unit : ''}`}
                mono
              />
            )}
            {entry.cluster && <Detail label="Cluster" value={entry.cluster} />}
            {entry.signature && (
              <Detail label="Signature" value={entry.signature} mono />
            )}
          </dl>
          {entry.detail && Object.keys(entry.detail).length > 0 && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-2 text-[10px] text-zinc-400">
              {JSON.stringify(entry.detail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} break-all text-zinc-300`}>
        {value}
      </dd>
    </>
  );
}
