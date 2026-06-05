// Resolve a managed-auth JWT for the current page load. Source preference:
//   1. URL query param `?token=...`. If present, decode it and strip from
//      the visible URL via `history.replaceState` so it doesn't leak via
//      bookmark/share or sit in browser history.
//   2. Build-time env var `NEXT_PUBLIC_MANAGED_TOKEN` (so an operator can
//      bake a token into a private deploy without the URL hop).
//   3. None — caller falls back to the SIWS handshake.
//
// The token is intentionally NOT persisted to localStorage: JWTs are
// short-lived and a refresh should re-acquire from whichever source minted
// the original (URL = managed-auth runtime redirect, env = the deploy).

'use client';

import { useEffect, useState } from 'react';

const QUERY_PARAM = 'token';

function readFromUrlOnce(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(QUERY_PARAM);
  if (!raw) return null;
  // Strip from the visible URL. `URLSearchParams.delete` re-serializes
  // without the param; we preserve hash so share-link bootstrap still runs.
  params.delete(QUERY_PARAM);
  const search = params.toString();
  const next =
    window.location.pathname +
    (search ? `?${search}` : '') +
    window.location.hash;
  window.history.replaceState(null, '', next);
  // URLSearchParams already URL-decodes; nothing more to do.
  return raw;
}

function readFromEnv(): string | null {
  const v = process.env.NEXT_PUBLIC_MANAGED_TOKEN;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Resolves the managed-auth JWT exactly once per page load. URL query param
 * takes precedence over the env var; absent both, returns null and the
 * caller's SIWS path runs unchanged.
 */
export function useManagedToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = readFromUrlOnce();
    if (fromUrl) {
      setToken(fromUrl);
      return;
    }
    const fromEnv = readFromEnv();
    if (fromEnv) setToken(fromEnv);
  }, []);
  return token;
}
