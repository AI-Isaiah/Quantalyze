"use client";

import { useCallback, useMemo } from "react";
import { z } from "zod";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { versionedObjectCodec } from "@/lib/storage/codecs";

/**
 * Per-allocator, per-API-key include/exclude state for the Overview tab.
 * When a key id is in the set, its contribution is filtered OUT of Overview
 * aggregates (holdings totals, derived charts). The raw row stays — this is a
 * display-time filter, not a deletion.
 *
 * Storage: `localStorage["allocations.excludedKeyIds.{allocator_id}"]`.
 * Routed through the B7 `useCrossTabStorage` primitive, which bakes in
 * zod-validated parse, version gating, prototype-poison stripping, and — the
 * fix for NEW-C26-01 — **cross-tab sync**: a second tab toggling the excluded
 * set no longer silently clobbers this tab's set on its next persist. The
 * pre-B7 hook had no `storage` listener, so two tabs on the same allocator
 * would race and the last writer would soft-lock the other's exclusions.
 *
 * Per-allocator scoping keeps two sessions on one device from cross-polluting
 * and lets us drop one allocator's blob without touching the others. Stale
 * entries pointing at deleted api_keys are KEPT (the caller filters against
 * the live apiKeys list) so a transient server-payload race never loses the
 * preference.
 */

const STORAGE_KEY_PREFIX = "allocations.excludedKeyIds.";
const EXCLUDED_VERSION = 1;

/** Persisted shape. Pre-B7 blobs were a bare `string[]` (unversioned) — those
 *  are read-old-write-new migrated to this shape on first load. */
interface ExcludedState {
  ids: string[];
}

// Per-element validation: drop non-string / empty entries INDIVIDUALLY and
// keep the valid ones — exactly the pre-B7 parseStored tolerance. A whole-array
// `.catch([])` would silently wipe the ENTIRE excluded set on a single bad
// element (outcome:ok, no breadcrumb) — the silent reset B7 exists to prevent
// (B7A1-01).
const excludedSchema = z.object({
  ids: z.preprocess(
    (v) =>
      Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.length > 0) : [],
    z.array(z.string()),
  ),
});

const EMPTY: ExcludedState = { ids: [] };

const excludedCodec = versionedObjectCodec<ExcludedState>({
  versionField: "version",
  version: EXCLUDED_VERSION,
  schema: excludedSchema,
  defaults: EMPTY,
  // Legacy: a bare `string[]` with no version field. Adopt it (filtering
  // non-strings / empties exactly as the old parseStored did) and let the
  // next write persist it in the versioned shape.
  migrateLegacy: (parsed) =>
    Array.isArray(parsed)
      ? { ids: parsed.filter((s): s is string => typeof s === "string" && s.length > 0) }
      : null,
});

export type UseExcludedKeyIdsResult = {
  excluded: ReadonlySet<string>;
  isExcluded: (apiKeyId: string) => boolean;
  toggle: (apiKeyId: string) => void;
  setExcluded: (apiKeyId: string, excluded: boolean) => void;
  clear: () => void;
};

/**
 * Read/write the per-allocator excluded-key set. Hydrates from localStorage
 * post-mount (SSR returns the empty set; the filter only kicks in after
 * hydration, by design). An empty/falsy `allocatorId` runs the hook in pure
 * in-memory mode (no read/write) so a misconfigured SSR payload never writes
 * to the prefix-only key `allocations.excludedKeyIds.`.
 */
export function useExcludedKeyIds(allocatorId: string): UseExcludedKeyIdsResult {
  const { value, setValue } = useCrossTabStorage<ExcludedState>({
    key: `${STORAGE_KEY_PREFIX}${allocatorId}`,
    initial: EMPTY,
    codec: excludedCodec,
    enabled: Boolean(allocatorId),
    // Toggles are click-driven (not high-frequency like dashboard resize
    // drags), so persist synchronously — matches the pre-B7 write-on-change.
    debounceMs: 0,
    sentryArea: "excluded-key-ids",
  });

  const excluded = useMemo(() => new Set(value.ids), [value.ids]);

  const isExcluded = useCallback(
    (apiKeyId: string) => excluded.has(apiKeyId),
    [excluded],
  );

  const toggle = useCallback(
    (apiKeyId: string) => {
      setValue((prev) =>
        prev.ids.includes(apiKeyId)
          ? { ids: prev.ids.filter((x) => x !== apiKeyId) }
          : { ids: [...prev.ids, apiKeyId].sort() },
      );
    },
    [setValue],
  );

  const setExcluded = useCallback(
    (apiKeyId: string, excludedFlag: boolean) => {
      setValue((prev) => {
        const has = prev.ids.includes(apiKeyId);
        // No-op returns the SAME object so the derived Set identity is stable
        // and memoized consumers don't re-render.
        if (has === excludedFlag) return prev;
        return {
          ids: excludedFlag
            ? [...prev.ids, apiKeyId].sort()
            : prev.ids.filter((x) => x !== apiKeyId),
        };
      });
    },
    [setValue],
  );

  const clear = useCallback(() => {
    setValue((prev) => (prev.ids.length === 0 ? prev : EMPTY));
  }, [setValue]);

  return useMemo(
    () => ({ excluded, isExcluded, toggle, setExcluded, clear }),
    [excluded, isExcluded, toggle, setExcluded, clear],
  );
}
