'use client';

import { useEffect, useState } from 'react';
import {
  validateProfileInput,
  VALID_CLUSTERS,
  VALID_PRESETS,
  type ProfileInput,
  type RpcPreset,
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
  preset: 'devnet',
  customRpcUrl: 'https://api.devnet.solana.com',
  customCluster: 'devnet',
};

const PRESET_LABELS: Record<RpcPreset, string> = {
  mainnet: 'Mainnet',
  devnet: 'Devnet',
  localnet: 'Localnet',
  custom: 'Custom',
};

const PRESET_HELPERS: Partial<Record<RpcPreset, string>> = {
  mainnet: "Routed through this app's API to keep the RPC URL private.",
  devnet: "Routed through this app's API to keep the RPC URL private.",
  localnet: 'Connects directly to http://localhost:8899 — start a local validator.',
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

      <Field label="Network" error={errorFor('preset')}>
        <div className="flex flex-wrap gap-2">
          {VALID_PRESETS.map((p) => (
            <label
              key={p}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                value.preset === p
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              <input
                type="radio"
                name="preset"
                value={p}
                checked={value.preset === p}
                onChange={() => set('preset', p)}
                className="sr-only"
              />
              {PRESET_LABELS[p]}
            </label>
          ))}
        </div>
        {PRESET_HELPERS[value.preset] && (
          <p className="mt-1 text-xs text-zinc-500">{PRESET_HELPERS[value.preset]}</p>
        )}
      </Field>

      {value.preset === 'custom' && (
        <>
          <Field label="Custom RPC URL" error={errorFor('customRpcUrl')}>
            <input
              type="text"
              value={value.customRpcUrl ?? ''}
              onChange={(e) => set('customRpcUrl', e.target.value)}
              placeholder="https://api.devnet.solana.com"
              className={`${inputClass(errorFor('customRpcUrl'))} font-mono`}
              spellCheck={false}
            />
          </Field>

          <Field label="Explorer cluster" error={errorFor('customCluster')}>
            <div className="flex gap-2">
              {VALID_CLUSTERS.map((c) => (
                <label
                  key={c}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    value.customCluster === c
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                      : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="customCluster"
                    value={c}
                    checked={value.customCluster === c}
                    onChange={() => set('customCluster', c as SolanaCluster)}
                    className="sr-only"
                  />
                  {c}
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

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
