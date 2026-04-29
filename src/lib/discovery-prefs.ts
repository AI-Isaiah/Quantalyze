"use client";

import { useCallback, useEffect, useState } from "react";

import type { ViewMode, SortKey, SortDir } from "@/components/strategy/StrategyFilters";

export interface DiscoveryViewPreferences {
  view: ViewMode;
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

// Versioned localStorage shape. Bumping CURRENT_VERSION rejects all stored
// data with a higher version (forward compat) and migrates older versions
// through explicit branches in safeRead.
const CURRENT_VERSION = 1;

interface StoredPrefs extends DiscoveryViewPreferences {
  version: number;
}

export const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,
};

const VALID_VIEWS: ReadonlySet<ViewMode> = new Set(["table", "grid"]);
const VALID_SORT_KEYS: ReadonlySet<SortKey> = new Set([
  "computed_at",
  "cumulative_return",
  "cagr",
  "sharpe",
  "max_drawdown",
  "volatility",
  "aum",
]);
const VALID_SORT_DIRS: ReadonlySet<SortDir> = new Set(["asc", "desc"]);

export function keyFor(uid: string, slug: string): string {
  return `discovery_view_preferences:${uid}:${slug}`;
}

export function safeRead(uid: string, slug: string): DiscoveryViewPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(keyFor(uid, slug));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    // Reject stored data we don't understand (newer schema). Legacy
    // unversioned shapes (version === undefined) are accepted as v1.
    if (typeof parsed.version === "number" && parsed.version > CURRENT_VERSION) {
      return DEFAULTS;
    }
    // Per-field enum validation. A renamed/removed enum value in legacy or
    // v1 data must not flow through to setViewMode/setSortKey/etc., where
    // it would silently take a wrong branch (e.g., a non-"table" view falls
    // through to grid in the consumer).
    const view =
      parsed.view && VALID_VIEWS.has(parsed.view) ? parsed.view : DEFAULTS.view;
    const sortKey =
      parsed.sort?.key && VALID_SORT_KEYS.has(parsed.sort.key)
        ? parsed.sort.key
        : DEFAULTS.sort.key;
    const sortDir =
      parsed.sort?.dir && VALID_SORT_DIRS.has(parsed.sort.dir)
        ? parsed.sort.dir
        : DEFAULTS.sort.dir;
    const hideExamples =
      typeof parsed.hide_examples === "boolean"
        ? parsed.hide_examples
        : DEFAULTS.hide_examples;
    return {
      view,
      sort: { key: sortKey, dir: sortDir },
      hide_examples: hideExamples,
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
      const payload: StoredPrefs = { ...prefs, version: CURRENT_VERSION };
      window.localStorage.setItem(keyFor(uid, slug), JSON.stringify(payload));
    } catch (err) {
      // Safari private mode / quota — non-fatal, but log for observability so
      // a flood of failures surfaces in the browser console (Sentry-deferral
      // pattern: console-only telemetry until a structured sink lands).
      console.error(
        "[discovery-prefs] localStorage write failed:",
        (err as Error)?.message ?? err,
      );
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
