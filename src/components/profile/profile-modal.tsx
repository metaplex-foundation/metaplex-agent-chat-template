'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useProfileStore,
  type AgentProfile,
  type ProfileInput,
} from '@/lib/profile-store';
import { encodeProfileToHash } from '@/lib/share-link';
import { ProfileForm } from './profile-form';

export type ModalMode =
  | { kind: 'closed' }
  | { kind: 'manage'; selectedId: string | null }
  | { kind: 'create' }
  | { kind: 'transient'; draft: ProfileInput };

interface ProfileModalProps {
  mode: ModalMode;
  onModeChange: (mode: ModalMode) => void;
  onClose: () => void;
  onConnectAfterSave?: (profileId: string) => void;
}

export function ProfileModal({ mode, onModeChange, onClose, onConnectAfterSave }: ProfileModalProps) {
  const { profiles, activeProfile, createProfile, updateProfile, deleteProfile, setActiveProfile } = useProfileStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);

  const isOpen = mode.kind !== 'closed';

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  const selectedProfile: AgentProfile | null = useMemo(() => {
    if (mode.kind === 'manage') {
      return profiles.find((p) => p.id === mode.selectedId) ?? null;
    }
    return null;
  }, [mode, profiles]);

  const formInitial: ProfileInput | undefined = useMemo(() => {
    if (mode.kind === 'manage' && selectedProfile) {
      const { name, wsUrl, token, preset, customRpcUrl, customCluster } = selectedProfile;
      return { name, wsUrl, token, preset, customRpcUrl, customCluster };
    }
    if (mode.kind === 'transient') return mode.draft;
    return undefined;
  }, [mode, selectedProfile]);

  if (!isOpen) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  function handleSave(input: ProfileInput): AgentProfile {
    if (mode.kind === 'manage' && selectedProfile) {
      updateProfile(selectedProfile.id, input);
      return { ...selectedProfile, ...input };
    }
    return createProfile(input);
  }

  function handleConnect(input: ProfileInput) {
    const profile = handleSave(input);
    setActiveProfile(profile.id);
    onConnectAfterSave?.(profile.id);
    onClose();
  }

  function handleShareLink(input: ProfileInput) {
    const hash = encodeProfileToHash({
      name: input.name,
      wsUrl: input.wsUrl,
      token: input.token,
      preset: input.preset,
      customRpcUrl: input.customRpcUrl,
      customCluster: input.customCluster,
    });
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      },
      (err) => console.warn('clipboard write failed', err),
    );
  }

  const headerLabel =
    mode.kind === 'transient'
      ? 'Imported from link'
      : mode.kind === 'create' || (mode.kind === 'manage' && !selectedProfile)
      ? profiles.length === 0
        ? 'Create your first connection'
        : 'New connection'
      : 'Edit connection';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="mx-4 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 outline-none md:flex-row"
      >
        {mode.kind !== 'transient' && (
          <aside className="flex w-full flex-col border-b border-zinc-800 md:w-64 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Profiles</h3>
              <button
                type="button"
                onClick={() => onClose()}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {profiles.length === 0 && (
                <li className="px-3 py-2 text-xs text-zinc-500">No profiles yet.</li>
              )}
              {profiles.map((p) => {
                const isActive = activeProfile?.id === p.id;
                const isSelected = mode.kind === 'manage' && mode.selectedId === p.id;
                return (
                  <li key={p.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onModeChange({ kind: 'manage', selectedId: p.id })}
                      className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                      }`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="flex-1 truncate text-zinc-100">{p.name}</span>
                        {isActive && (
                          <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                            active
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate font-mono text-xs text-zinc-500">{tryHost(p.wsUrl)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDelete(p.id);
                      }}
                      aria-label={`Delete ${p.name}`}
                      className="absolute right-2 top-2 hidden rounded-md p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 group-hover:block"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 5h10M6 5V3.5h4V5M5 5l.5 8h5L11 5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {confirmingDelete === p.id && (
                      <div className="absolute inset-x-2 top-full z-10 mt-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 shadow-lg">
                        <p className="text-xs text-zinc-300">Delete &ldquo;{p.name}&rdquo;?</p>
                        <div className="mt-2 flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(null)}
                            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteProfile(p.id);
                              setConfirmingDelete(null);
                            }}
                            className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => onModeChange({ kind: 'create' })}
              className="m-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60"
            >
              + New profile
            </button>
          </aside>
        )}

        <section className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h2 id="profile-modal-title" className="text-sm font-semibold text-zinc-100">
              {headerLabel}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {mode.kind === 'transient' && (
            <div className="border-b border-zinc-800 bg-amber-950/30 px-5 py-2 text-xs text-amber-300">
              Imported from link &mdash; nothing is saved until you click <strong>Save & Connect</strong>.
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5">
            <ProfileForm
              initialValue={formInitial}
              submitLabel="Save"
              secondaryLabel="Save & Connect"
              onSubmit={(input) => {
                const profile = handleSave(input);
                onModeChange({ kind: 'manage', selectedId: profile.id });
              }}
              onSecondary={(input) => {
                handleConnect(input);
              }}
              onShareLink={handleShareLink}
            />
            {shareToast && (
              <p className="mt-2 text-right text-xs text-green-400">Link copied to clipboard.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function tryHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
