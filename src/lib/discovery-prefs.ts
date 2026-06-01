"use client";

import type { ViewMode, SortKey, SortDir } from "@/components/strategy/StrategyFilters";
import { useCrossTabStorage, type StorageCodec, type DecodeResult } from "@/lib/storage/cross-tab";
import { stripPoisonKeys } from "@/lib/storage/codecs";

export interface DiscoveryViewPreferences {
  view: ViewMode;
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

// Versioned localStorage shape. Bumping CURRENT_VERSION rejects stored data
// with a higher version (now handled forward-compat read-only by the codec)
// and migrates older/unversioned blobs through the per-field merge below.
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

/**
 * Per-field enum validation + default-merge. A renamed/removed enum value (or
 * a partial blob) folds each field independently to DEFAULTS rather than
 * flowing a wrong branch into setViewMode/setSortKey. Identical semantics to
 * the pre-B7 `safeRead` body — preserved here so reads stay byte-compatible.
 */
function mergeWithDefaults(p: Partial<StoredPrefs> | null | undefined): DiscoveryViewPreferences {
  const view = p?.view && VALID_VIEWS.has(p.view) ? p.view : DEFAULTS.view;
  const sortKey =
    p?.sort?.key && VALID_SORT_KEYS.has(p.sort.key) ? p.sort.key : DEFAULTS.sort.key;
  const sortDir =
    p?.sort?.dir && VALID_SORT_DIRS.has(p.sort.dir) ? p.sort.dir : DEFAULTS.sort.dir;
  const hideExamples =
    typeof p?.hide_examples === "boolean" ? p.hide_examples : DEFAULTS.hide_examples;
  return { view, sort: { key: sortKey, dir: sortDir }, hide_examples: hideExamples };
}

/**
 * Discovery codec — domain-specific per-field merge (not a whole-object zod
 * parse, which would reject a partial blob wholesale). Adds, vs the pre-B7
 * `safeRead`: prototype-poison stripping, and forward-compat **read-only** for
 * a higher-version blob (the pre-B7 path returned DEFAULTS and then the next
 * setPrefs DOWN-CONVERTED the newer blob to v1 — a silent forward-compat data
 * loss; read-only suppresses that write). A corrupt parse is surfaced as a
 * `reset` so the primitive emits a Sentry breadcrumb instead of silently
 * swallowing it (M-1151 / L-0090).
 */
const discoveryCodec: StorageCodec<DiscoveryViewPreferences> = {
  decode(raw: string | null): DecodeResult<DiscoveryViewPreferences> {
    if (raw == null) return { value: DEFAULTS, outcome: "ok", reason: null };
    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(raw);
    } catch {
      return { value: DEFAULTS, outcome: "reset", reason: "parse_failed" };
    }
    const p = stripPoisonKeys(parsedUnknown) as Partial<StoredPrefs> | null;
    if (p && typeof p.version === "number" && p.version > CURRENT_VERSION) {
      return { value: mergeWithDefaults(p), outcome: "readonly", reason: "version_ahead" };
    }
    // Unversioned (legacy → adopted as v1) or exact v1 → per-field merge.
    return { value: mergeWithDefaults(p), outcome: "ok", reason: null };
  },
  encode(value: DiscoveryViewPreferences): string {
    // Version field last → byte-compatible with the pre-B7 `{ ...prefs, version }`.
    return JSON.stringify({ ...value, version: CURRENT_VERSION });
  },
};

/**
 * SSR-safe one-shot read of the persisted prefs (server returns DEFAULTS).
 * Retained for back-compat; the hook reads via the cross-tab primitive.
 *
 * B7 sanctioned-exception: the hot path is the `useCrossTabStorage`-backed hook
 * below; this bare one-shot read is the retained non-React back-compat accessor
 * (it reuses `discoveryCodec`, so it shares the same parse/version/poison-strip
 * logic — only the storage mechanics are bare). Exempts the file from the B25
 * `no-raw-localstorage` rule.
 */
export function safeRead(uid: string, slug: string): DiscoveryViewPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return discoveryCodec.decode(window.localStorage.getItem(keyFor(uid, slug))).value;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Per-uid, per-slug discovery view preferences. Routed through the B7
 * cross-tab primitive: hydrates post-mount (SSR returns DEFAULTS), version
 * gates, strips poison keys, and now syncs across tabs. `uid === undefined`
 * (public / pre-auth) runs the hook in pure in-memory mode — no read/write —
 * so it never writes a `discovery_view_preferences:undefined:*` key.
 */
export function useDiscoveryPrefs(uid: string | undefined, slug: string) {
  const {
    value: prefs,
    setValue: setPrefs,
    isHydrated: hydrated,
  } = useCrossTabStorage<DiscoveryViewPreferences>({
    key: keyFor(uid ?? "", slug),
    initial: DEFAULTS,
    codec: discoveryCodec,
    enabled: Boolean(uid),
    // Click-driven preference toggles — persist synchronously (matches pre-B7).
    debounceMs: 0,
    sentryArea: "discovery-prefs",
  });

  return { prefs, setPrefs, hydrated };
}
