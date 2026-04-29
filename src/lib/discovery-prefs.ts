"use client";

import { useCallback, useEffect, useState } from "react";

import type { ViewMode, SortKey, SortDir } from "@/components/strategy/StrategyFilters";

export interface DiscoveryViewPreferences {
  view: ViewMode;
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

export const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,
};

export function keyFor(uid: string, slug: string): string {
  return `discovery_view_preferences:${uid}:${slug}`;
}

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

export function useDiscoveryPrefs(uid: string | undefined, slug: string) {
  const [prefs, setPrefsRaw] = useState<DiscoveryViewPreferences>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHydrated(true);
      return;
    }
    setPrefsRaw(safeRead(uid, slug));
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
