"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Per-allocator, per-API-key include/exclude state for the Overview tab.
 * When a key id is in the set, its contribution should be filtered OUT of
 * Overview aggregates (holdings totals, derived charts). The raw row in
 * the source data stays — this is a display-time filter, not a deletion.
 *
 * Storage shape:
 *   localStorage["allocations.excludedKeyIds.{allocator_id}"] =
 *     JSON.stringify(string[])
 *
 * Scoping by allocator_id (a) keeps two distinct sessions on the same
 * device from cross-polluting, and (b) lets us drop the per-allocator
 * blob if a key gets deleted without touching every other allocator's
 * preferences.
 *
 * The parse path guards against:
 *   - corrupt JSON  → fall back to empty set, console.warn (matches
 *     useDashboardConfig + TweaksContext precedent)
 *   - non-array root → drop
 *   - non-string entries → drop entry-by-entry
 *   - stale entries pointing at api_keys that no longer exist → caller is
 *     responsible for filtering against the live apiKeys list before
 *     applying the exclusion; the hook keeps the raw set so a temporarily
 *     missing key (e.g. server payload race) doesn't lose the preference.
 */

const STORAGE_KEY_PREFIX = "allocations.excludedKeyIds.";

function storageKey(allocatorId: string): string {
  return `${STORAGE_KEY_PREFIX}${allocatorId}`;
}

function parseStored(raw: string | null): Set<string> {
  if (raw == null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry === "string" && entry.length > 0) out.add(entry);
    }
    return out;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(
        "[useExcludedKeyIds] parse failed; falling back to empty set",
        err,
      );
    }
    return new Set();
  }
}

function loadExcluded(allocatorId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseStored(window.localStorage.getItem(storageKey(allocatorId)));
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(
        "[useExcludedKeyIds] localStorage read failed; falling back to empty set",
        err,
      );
    }
    return new Set();
  }
}

export type UseExcludedKeyIdsResult = {
  excluded: ReadonlySet<string>;
  isExcluded: (apiKeyId: string) => boolean;
  toggle: (apiKeyId: string) => void;
  setExcluded: (apiKeyId: string, excluded: boolean) => void;
  clear: () => void;
};

/**
 * Read/write the per-allocator excluded-key set. Hydrates from localStorage
 * post-mount (no SSR mismatch — SSR returns the empty set; the actual
 * filter only kicks in after hydration, by design).
 *
 * `allocatorId` is required; passing an empty/falsy id silently no-ops the
 * persist effect so a misconfigured SSR payload doesn't write to
 * `allocations.excludedKeyIds.` (prefix-only key).
 */
export function useExcludedKeyIds(
  allocatorId: string,
): UseExcludedKeyIdsResult {
  const [excluded, setExcludedSet] = useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);
  const persistWarnedRef = useRef(false);

  // Hydrate after mount — keeps SSR HTML and first client render byte-
  // identical (both render the empty set).
  useEffect(() => {
    if (!allocatorId) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setExcludedSet(loadExcluded(allocatorId));
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [allocatorId]);

  // Persist after every change — but only post-hydration so we never write
  // the empty-set seed back over a real persisted blob on the initial
  // mount tick.
  useEffect(() => {
    if (!hydrated || !allocatorId || typeof window === "undefined") return;
    try {
      const arr = Array.from(excluded).sort();
      window.localStorage.setItem(storageKey(allocatorId), JSON.stringify(arr));
    } catch (err) {
      if (!persistWarnedRef.current && typeof console !== "undefined") {
        persistWarnedRef.current = true;
        console.warn(
          "[useExcludedKeyIds] localStorage write failed; exclusions will not persist",
          err,
        );
      }
    }
  }, [excluded, hydrated, allocatorId]);

  const isExcluded = useCallback(
    (apiKeyId: string) => excluded.has(apiKeyId),
    [excluded],
  );

  const toggle = useCallback((apiKeyId: string) => {
    setExcludedSet((prev) => {
      const next = new Set(prev);
      if (next.has(apiKeyId)) next.delete(apiKeyId);
      else next.add(apiKeyId);
      return next;
    });
  }, []);

  const setExcluded = useCallback((apiKeyId: string, excludedFlag: boolean) => {
    setExcludedSet((prev) => {
      const has = prev.has(apiKeyId);
      if (has === excludedFlag) return prev;
      const next = new Set(prev);
      if (excludedFlag) next.add(apiKeyId);
      else next.delete(apiKeyId);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setExcludedSet((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  return useMemo(
    () => ({ excluded, isExcluded, toggle, setExcluded, clear }),
    [excluded, isExcluded, toggle, setExcluded, clear],
  );
}
