"use client";

/**
 * Phase 13 / Plan 13-02 / DISCO-02 — Per-user-keyed Customize prefs.
 *
 * Persists the allocator's Default view / Default sort / Hide examples
 * choices in localStorage, keyed by both the authenticated user uid AND
 * the category slug:
 *
 *   localStorage["discovery_view_preferences:{auth.uid}:{slug}"]
 *
 * Cross-account isolation is structural — the key is constructed from the
 * caller's uid only, so a session signed in as B cannot read entries
 * stored under A's uid. The Playwright spec
 * `e2e/discovery-prefs-isolation.spec.ts` proves this end-to-end.
 *
 * Hydration follows the `TweaksContext.tsx:55-99` pattern verbatim:
 * mount-effect reads localStorage and flips a `hydrated` flag; the
 * persistence-effect is gated on `hydrated` so the initial DEFAULTS
 * never overwrite the stored value on first paint. SSR-safe — every
 * `window` access is guarded.
 */

import { useCallback, useEffect, useState } from "react";

import type { ViewMode, SortKey, SortDir } from "@/components/strategy/StrategyFilters";

export interface DiscoveryViewPreferences {
  view: ViewMode;
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

/**
 * DISCO-05 lock — `hide_examples` defaults to `true`. A fresh allocator's
 * first Discovery visit shows zero example strategies (paired with the
 * Plan 13-04 `is_example=true` data backfill).
 */
export const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,
};

/** Exact `discovery_view_preferences:{uid}:{slug}` key shape. */
export function keyFor(uid: string, slug: string): string {
  return `discovery_view_preferences:${uid}:${slug}`;
}

/**
 * SSR-safe synchronous read. Returns DEFAULTS when:
 *   - typeof window === "undefined" (SSR / RSC)
 *   - no entry under the key
 *   - JSON.parse error (corrupted entry — non-fatal)
 *
 * Partial-merge tolerance: `{ ...DEFAULTS, ...parsed, sort: {...} }` so
 * stored entries from older minor versions still load. Tampering at the
 * DevTools layer (T-13-02-02) is mitigated here — extra fields are
 * ignored by the type contract.
 */
export function safeRead(uid: string, slug: string): DiscoveryViewPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(keyFor(uid, slug));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DiscoveryViewPreferences>;
    return {
      ...DEFAULTS,
      ...parsed,
      sort: { ...DEFAULTS.sort, ...(parsed.sort ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * useDiscoveryPrefs — hook that hydrates from localStorage on mount and
 * persists every subsequent change AFTER hydration.
 *
 * `uid` is `string | undefined` to accommodate the page-level edge case
 * where the component renders before auth resolves. When `uid` is
 * undefined, the hook still settles into `hydrated=true` (so consumers
 * stop showing skeletons), but BOTH effects no-op on the persistence
 * path — no key is written, no key is read. This is the contract Plan
 * 13-02 Task 1 test case 12 locks.
 */
export function useDiscoveryPrefs(uid: string | undefined, slug: string) {
  const [prefs, setPrefsRaw] = useState<DiscoveryViewPreferences>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!uid) {
      // Settle into DEFAULTS so consumers can stop showing skeletons,
      // but never read a per-uid key (there is none yet).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHydrated(true);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefsRaw(safeRead(uid, slug));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, [uid, slug]);

  useEffect(() => {
    if (!hydrated) return;
    if (!uid) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(keyFor(uid, slug), JSON.stringify(prefs));
    } catch {
      // Safari private mode / quota — non-fatal.
    }
  }, [prefs, hydrated, uid, slug]);

  const setPrefs = useCallback(
    (
      next:
        | DiscoveryViewPreferences
        | ((prev: DiscoveryViewPreferences) => DiscoveryViewPreferences),
    ) => {
      setPrefsRaw((prev) =>
        typeof next === "function"
          ? (next as (p: DiscoveryViewPreferences) => DiscoveryViewPreferences)(
              prev,
            )
          : next,
      );
    },
    [],
  );

  return { prefs, setPrefs, hydrated };
}
