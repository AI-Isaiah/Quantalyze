/**
 * Single source of truth for "how stale is this data?" classification.
 *
 * Before this helper existed, SyncBadge used a 24h/48h split and the admin
 * match queue used a 48h cutoff — a user could see "Warm" on the factsheet and
 * "Stale" on the match queue for the same strategy. Eng review flagged this
 * as a freshness drift bug.
 *
 * Thresholds
 *   fresh — computed within the last 12 hours
 *   warm  — computed within the last 48 hours
 *   stale — computed 48+ hours ago, or never computed, or unknown
 */

export type Freshness = "fresh" | "warm" | "stale";

export const FRESH_HOURS = 12;
export const WARM_HOURS = 48;

/** Tolerated clock drift between Postgres and the Next.js server, in minutes. */
const CLOCK_SKEW_TOLERANCE_MINUTES = 5;

/**
 * Compute the freshness label for a given computation timestamp.
 * Accepts a Date, an ISO string, a unix-ms number, null, or undefined.
 * Returns `"stale"` for null/undefined/unparseable inputs so the fallback
 * is always the safest (most conservative) classification.
 *
 * Future timestamps are tolerated up to `CLOCK_SKEW_TOLERANCE_MINUTES` of
 * drift between the analytics writer and this server. Anything further in
 * the future is treated as "stale" — that almost always means a corrupt
 * write or a manual SQL with `now() + interval '...'` from staging, and we
 * want the badge to surface the problem instead of masking it as "fresh".
 */
export function computeFreshness(
  computedAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): Freshness {
  if (computedAt == null) return "stale";

  const ts =
    computedAt instanceof Date
      ? computedAt.getTime()
      : typeof computedAt === "number"
        ? computedAt
        : Date.parse(computedAt);

  if (!Number.isFinite(ts)) return "stale";

  const hoursAgo = (now.getTime() - ts) / (1000 * 60 * 60);
  if (hoursAgo < 0) {
    // Small skew (<5 min ahead) → tolerated as fresh.
    // Large skew → corrupt write, surface as stale.
    return Math.abs(hoursAgo) <= CLOCK_SKEW_TOLERANCE_MINUTES / 60
      ? "fresh"
      : "stale";
  }
  if (hoursAgo < FRESH_HOURS) return "fresh";
  if (hoursAgo < WARM_HOURS) return "warm";
  return "stale";
}

/** Short human-readable label for badges ("Fresh", "Warm", "Stale"). */
export function freshnessLabel(freshness: Freshness): string {
  switch (freshness) {
    case "fresh":
      return "Fresh";
    case "warm":
      return "Warm";
    case "stale":
      return "Stale";
  }
}

/**
 * Tailwind color tokens keyed by freshness state. Uses the project's
 * `positive` / `negative` custom tokens (per DESIGN.md) plus built-in
 * amber for the "warm" middle state. Kept as string constants so
 * `className={FRESHNESS_COLORS[freshness].badge}` works out of the box.
 */
export const FRESHNESS_COLORS: Record<
  Freshness,
  { dot: string; badge: string }
> = {
  fresh: {
    dot: "bg-positive",
    badge:
      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  warm: {
    dot: "bg-amber-400",
    badge:
      "bg-amber-50 text-amber-700 border border-amber-200",
  },
  stale: {
    dot: "bg-negative",
    badge:
      "bg-rose-50 text-rose-700 border border-rose-200",
  },
};

/**
 * Explanatory tooltip copy. Used by FreshnessBadge's title attribute + any
 * admin surface that wants a longer-form explanation.
 */
export function freshnessTooltip(freshness: Freshness): string {
  switch (freshness) {
    case "fresh":
      return `Analytics recomputed within the last ${FRESH_HOURS} hours.`;
    case "warm":
      return `Analytics recomputed between ${FRESH_HOURS} and ${WARM_HOURS} hours ago — a refresh is scheduled.`;
    case "stale":
      return `Analytics are more than ${WARM_HOURS} hours old. Data may not reflect current performance.`;
  }
}
