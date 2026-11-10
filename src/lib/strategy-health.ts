/**
 * Phase 199 / MANAGERHOME (D-03, CD-04, R-05) — the Health word of the merged
 * strategies list, as ONE pure function.
 *
 * It reads only signals the page already reads and only existing predicates:
 * `isUntrustedKeySyncStatus`, `isComputedAnalytics`, `deriveEmptySeriesState`
 * and the Phase 197 LIST verdict `listSeriesVerdict`. No threshold is typed
 * here and no age is compared here: `listSeriesVerdict` owns both (7 whole UTC
 * days for a crypto strategy, 10 for every other asset class, null included),
 * so this word and the Discovery list can never disagree about one strategy.
 *
 * ⚠️ ACCEPTED RESIDUAL (R-05): the factsheet freshness chip and `SyncBadge` still
 * use the private 3d/7d ladder (`bucketSeriesAge`), which ignores asset class. A
 * non-crypto strategy whose newest bar is 8 to 10 days old reads Healthy here
 * and on the Discovery list but stale on its factsheet chip. Not unified here.
 *
 * Copy-module conventions follow `status-surface-copy.ts`: a named em dash,
 * `satisfies Record<Union, …>` tables so a missing kind fails to compile, and
 * no client directive (server pages and client cells both import this).
 */

import { isComputedAnalytics, isUntrustedKeySyncStatus, deriveEmptySeriesState } from "./closed-sets";
import { formatCloseDay } from "./factsheet/returns-unit";
import { listSeriesVerdict } from "./freshness";

const EM_DASH = "—"; // U+2014 — NOT a hyphen-minus.

/**
 * The chip-state status of a row: the analytics `computation_status`, coerced to
 * null when NO `strategy_analytics` row exists (`analyticsPresent === false`,
 * the absent-row signal `shapeRankingRows` preserves; the shaper's substituted
 * EMPTY_ANALYTICS carries a hardcoded "pending" that would otherwise spin
 * forever). `=== false`, never truthiness: an OMITTED field means "no signal —
 * trust the raw status".
 *
 * Hoisted from StrategyTable.tsx with an identical body; plan 199-07 deletes the
 * table's private copy and imports this one. The parameter is structural so the
 * table's `StrategyWithAnalytics` satisfies it unchanged.
 */
export function rowChipStatus(s: {
  analyticsPresent?: boolean;
  analytics: { computation_status?: string | null };
}): string | null {
  return s.analyticsPresent === false
    ? null
    : s.analytics.computation_status ?? null;
}

export const STRATEGY_HEALTH_KINDS = [
  "healthy",
  "key_problem",
  "analytics_failed",
  "updating",
  "stale",
  "stale_no_data",
  "not_judged",
] as const;

export type StrategyHealthKind = (typeof STRATEGY_HEALTH_KINDS)[number];

export interface StrategyHealth {
  kind: StrategyHealthKind;
  /** The series end day (`YYYY-MM-DD`) when `kind` is "stale", else null. */
  staleSince: string | null;
}

export interface StrategyHealthInput {
  /** `strategies.status`. */
  status: string | null | undefined;
  /** `strategies.created_at`, for the missing-row computing window. */
  createdAt: string | null | undefined;
  /** `rowChipStatus(row)`. */
  chipStatus: string | null;
  /** The shaped row's `analytics_updating`. */
  analyticsUpdating: boolean;
  /** `analytics.series_end`, the newest stored return day. */
  seriesEnd: string | null | undefined;
  /** `strategies.asset_class`, which picks the list verdict's threshold. */
  assetClass: string | null | undefined;
  /** `sync_status` of every feeding key (`api_key_id` plus `strategy_keys` members). */
  feedingKeySyncStatuses: ReadonlyArray<string | null | undefined>;
  /** The key-status read failed: Key problem cannot be ruled out. */
  keyStatusUnreadable: boolean;
  /** Injected clock (ms). */
  nowMs: number;
}

const NOT_STALE = null;

/** First match wins, in the UI-SPEC derivation order (rows 0-7). */
export function strategyHealthOf(i: StrategyHealthInput): StrategyHealth {
  const is = (kind: StrategyHealthKind): StrategyHealth => ({ kind, staleSince: NOT_STALE });

  if (i.status === "archived") return is("not_judged");
  if (i.feedingKeySyncStatuses.some((s) => isUntrustedKeySyncStatus(s))) {
    return is("key_problem");
  }
  if (i.chipStatus === "failed") return is("analytics_failed");

  const emptyState = deriveEmptySeriesState(i.chipStatus, i.createdAt ?? null, i.nowMs);
  if (emptyState === "computing" || i.analyticsUpdating) return is("updating");

  if (!isComputedAnalytics(i.chipStatus)) return is("stale_no_data");

  const { verdict } = listSeriesVerdict(i.seriesEnd, i.assetClass, i.nowMs);
  if (verdict === "stale") {
    return { kind: "stale", staleSince: (i.seriesEnd as string).slice(0, 10) };
  }
  if (verdict === "unknown") return is("not_judged");
  // Healthy, unless a key we could not read might be the reason it is not.
  return i.keyStatusUnreadable ? is("not_judged") : is("healthy");
}

/** The word the cell and the legend render. */
export function healthWord(h: StrategyHealth): string {
  switch (h.kind) {
    case "healthy":
      return "Healthy";
    case "key_problem":
      return "Key problem";
    case "analytics_failed":
      return "Analytics failed";
    case "updating":
      return "Updating";
    case "stale":
      return `Stale (no data since ${formatCloseDay(h.staleSince ?? "")})`;
    case "stale_no_data":
      return "Stale (no data yet)";
    case "not_judged":
      return EM_DASH;
  }
}

/** Tone classes: no red, no green. The word carries the meaning, the colour repeats it. */
export const HEALTH_TONE = {
  healthy: "text-text-secondary",
  updating: "text-text-secondary",
  stale: "text-warning",
  stale_no_data: "text-warning",
  analytics_failed: "text-warning",
  key_problem: "text-warning",
  not_judged: "text-text-muted",
} as const satisfies Record<StrategyHealthKind, string>;
