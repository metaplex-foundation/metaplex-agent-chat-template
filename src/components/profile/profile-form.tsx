'use client';

import { useEffect, useState } from 'react';
import {
  validateProfileInput,
  VALID_CLUSTERS,
  type ProfileInput,
  type SolanaCluster,
  type ValidationError,
} from '@/lib/profile-store';

interface ProfileFormProps {
  initialValue?: ProfileInput;
  submitLabel?: string;
  secondaryLabel?: string;
  onSubmit: (input: ProfileInput) => void;
  onSecondary?: (input: ProfileInput) => void;
  onShareLink?: (input: ProfileInput) => void;
}

const EMPTY: ProfileInput = {
  name: '',
  wsUrl: '',
  token: '',
  rpcUrl: 'https://api.devnet.solana.com',
  cluster: 'devnet',
};

export function ProfileForm({
  initialValue,
  submitLabel = 'Save',
  secondaryLabel,
  onSubmit,
  onSecondary,
  onShareLink,
}: ProfileFormProps) {
  const [value, setValue] = useState<ProfileInput>(initialValue ?? EMPTY);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? EMPTY);
    setErrors([]);
  }, [initialValue]);

  function set<K extends keyof ProfileInput>(key: K, next: ProfileInput[K]) {
    setValue((prev) => ({ ...prev, [key]: next }));
  }

  function errorFor(field: keyof ProfileInput): string | null {
    return errors.find((e) => e.field === field)?.message ?? null;
  }

  function handleSubmit(handler: (input: ProfileInput) => void) {
    return (event: React.FormEvent) => {
      event.preventDefault();
      const found = validateProfileInput(value);
      setErrors(found);
      if (found.length === 0) handler(value);
    };
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <Field label="Name" error={errorFor('name')}>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Local devnet"
          className={inputClass(errorFor('name'))}
        />
      </Field>

      <Field label="WebSocket URL" error={errorFor('wsUrl')}>
        <input
          type="text"
          value={value.wsUrl}
          onChange={(e) => set('wsUrl', e.target.value)}
          placeholder="wss://agent.example.com:3002"
          className={`${inputClass(errorFor('wsUrl'))} font-mono`}
          spellCheck={false}
        />
      </Field>

      <Field label="Token" error={errorFor('token')}>
        <div className="flex gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            value={value.token}
            onChange={(e) => set('token', e.target.value)}
            placeholder="Bearer token (32+ chars)"
            className={`${inputClass(errorFor('token'))} flex-1 font-mono`}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowToken((s) => !s)}
            className="rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Field label="Solana RPC URL" error={errorFor('rpcUrl')}>
        <input
          type="text"
          value={value.rpcUrl}
          onChange={(e) => set('rpcUrl', e.target.value)}
          placeholder="https://api.devnet.solana.com"
          className={`${inputClass(errorFor('rpcUrl'))} font-mono`}
          spellCheck={false}
        />
      </Field>

      <Field label="Cluster" error={errorFor('cluster')}>
        <div className="flex gap-2">
          {VALID_CLUSTERS.map((c) => (
            <label
              key={c}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                value.cluster === c
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              <input
                type="radio"
                name="cluster"
                value={c}
                checked={value.cluster === c}
                onChange={() => set('cluster', c as SolanaCluster)}
                className="sr-only"
              />
              {c}
            </label>
          ))}
        </div>
      </Field>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {submitLabel}
        </button>
        {onSecondary && secondaryLabel && (
          <button
            type="button"
            onClick={handleSubmit(onSecondary) as unknown as () => void}
            className="rounded-xl border border-indigo-500/40 bg-indigo-600/10 px-4 py-2 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-600/20"
          >
            {secondaryLabel}
          </button>
        )}
        {onShareLink && (
          <button
            type="button"
            onClick={() => onShareLink(value)}
            className="ml-auto rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Copy share link
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-400">{label}</span>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  );
}

function inputClass(error: string | null): string {
  return `rounded-lg border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-indigo-500 ${
    error ? 'border-red-500/60' : 'border-zinc-700'
  }`;
}
