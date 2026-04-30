'use client';

import { useEffect, useRef, useState } from 'react';
import { useProfileStore, type AgentProfile } from '@/lib/profile-store';

interface ProfilePillProps {
  onManageClick: () => void;
  onSwitchProfile: (id: string) => void;
  onDisconnect: () => void;
}

export function ProfilePill({ onManageClick, onSwitchProfile, onDisconnect }: ProfilePillProps) {
  const { profiles, activeProfile } = useProfileStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const label = activeProfile?.name ?? 'No profile';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          activeProfile
            ? 'bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {profiles.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-500">No profiles configured.</li>
            )}
            {profiles.map((p) => (
              <ProfileMenuItem
                key={p.id}
                profile={p}
                isActive={activeProfile?.id === p.id}
                onClick={() => {
                  setOpen(false);
                  if (activeProfile?.id !== p.id) onSwitchProfile(p.id);
                }}
              />
            ))}
          </ul>
          <div className="border-t border-zinc-800 py-1">
            <MenuButton
              onClick={() => {
                setOpen(false);
                onManageClick();
              }}
            >
              Manage profiles…
            </MenuButton>
            {activeProfile && (
              <MenuButton
                onClick={() => {
                  setOpen(false);
                  onDisconnect();
                }}
              >
                Disconnect
              </MenuButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenuItem({
  profile,
  isActive,
  onClick,
}: {
  profile: AgentProfile;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        onClick={onClick}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
          isActive ? 'text-indigo-300' : 'text-zinc-200'
        }`}
      >
        <span className="flex-1 truncate">{profile.name}</span>
        {isActive && (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </li>
  );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
