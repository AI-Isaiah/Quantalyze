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

/**
 * ── Phase 163 / HONEST-08: the SERIES ladder ────────────────────────────────
 *
 * `FRESH_HOURS` / `WARM_HOURS` above are calibrated for a JOB — a pipeline
 * that should run many times a day, where 12 hours of silence is already a
 * question. A return SERIES is a different kind of clock: its points are DAILY
 * bars, so a perfectly current track record's last point is routinely
 * yesterday's. Judging a daily series on a 12-hour ladder would mark every
 * healthy strategy in the product "warm", which is not conservatism — it is
 * noise that trains readers to ignore the badge.
 *
 * These are NOT new thresholds. They are the SAME 3d/7d ladder `FreshnessChip`
 * (app/factsheet/[id]/v2/FactsheetView.tsx) has applied to the series since
 * Phase 162 / HONEST-02, hoisted here so the two surfaces read one pair of
 * numbers instead of two copies that can drift. HONEST-02 explicitly refused
 * to introduce a third ladder; so does this. What UI-SPEC C-1 records as a
 * deliberate disagreement is between the JOB ladders (12h/48h here, 3d/7d on
 * the chip) — the SERIES ladder is shared, because a dead track record is
 * equally dead on a list row and on a factsheet.
 */
export const SERIES_FRESH_DAYS = 3;
export const SERIES_STALE_DAYS = 7;

/**
 * Which fact a freshness verdict is actually ABOUT.
 *
 *   `"sync"`    — the analytics job's own age is the worst thing known.
 *   `"series"`  — the track record's age is STRICTLY worse than the job's, so
 *                 the series is the binding fact and the surface must SAY SO.
 *   `"unknown"` — the series end could not be resolved. Not a verdict: a
 *                 missing input. See `resolveEffectiveRecency`.
 */
export type RecencySubject = "sync" | "series" | "unknown";

export interface EffectiveRecency {
  /** The verdict to render: the WORSE of what is known. */
  freshness: Freshness;
  /** Which fact carried it there — what the copy must name. */
  subject: RecencySubject;
  /** The resolved series end, when there was one. Callers render the date. */
  seriesEndDate: Date | null;
}

/** How pessimistic each bucket is. Mirrors `TONE_RANK` in FactsheetView.tsx. */
const FRESHNESS_RANK: Record<Freshness, number> = {
  fresh: 0,
  warm: 1,
  stale: 2,
};

/** Classify a series end on the shared 3d/7d series ladder. */
function bucketSeriesAge(seriesEndMs: number, now: Date): Freshness {
  const days = (now.getTime() - seriesEndMs) / (1000 * 60 * 60 * 24);
  // A series point in the FUTURE is a corrupt write, not a fresh track record
  // — same reasoning as `computeFreshness`'s large-skew arm above.
  if (!Number.isFinite(days) || days < 0) return "stale";
  if (days <= SERIES_FRESH_DAYS) return "fresh";
  if (days <= SERIES_STALE_DAYS) return "warm";
  return "stale";
}

/**
 * Phase 163 / HONEST-08 — decide WHICH FACT a freshness claim is about, and
 * how bad it is. THE staler-of-two derivation, in one place.
 *
 * WHY THIS EXISTS, measured on production 2026-08-26: `/browse/crypto-sma`
 * row #2 rendered "Synced 7h ago" over a return series that ended 112 days
 * earlier, while that same strategy's FACTSHEET chip read `Track record ·
 * old`. Two public, unauthenticated surfaces contradicted each other about one
 * strategy, and the one a buyer sees first was the one making the false claim.
 * `FreshnessChip` had already been taught this rule by Phase 162 / HONEST-02;
 * the list badge had not. The fix is this shared resolver rather than a second
 * staler-of-two implementation inside the table, because a divergent second
 * copy is EXACTLY how the two surfaces came to disagree in the first place.
 *
 * ⚠️ THE COMPARISON IS BETWEEN VERDICTS, NOT BETWEEN RAW DATES — and that
 * distinction is load-bearing, not pedantry. A daily return series' last point
 * is routinely YESTERDAY's on a perfectly healthy strategy, so it is almost
 * always the older of the two dates. "Older date wins" would therefore flip
 * every row in the product onto the track-record arm and delete the sync copy
 * everywhere — closing the bug by removing the badge's information, which is
 * precisely the fix the founder ruled out. Each subject is judged by the
 * ladder appropriate to IT (the job by 12h/48h, the series by 3d/7d), and the
 * series binds only when its verdict is STRICTLY worse. That is the same rule
 * `FreshnessChip` applies via `TONE_RANK`.
 *
 * THE `unknown` ARM MIRRORS `TONE_RANK`, whose ordering matters in BOTH
 * directions:
 *   - `unknown` sits ABOVE `fresh` — an unresolvable series end cannot SUPPORT
 *     a freshness claim, so the verdict is capped at `warm`. A fresh job over
 *     an unknown track is not evidence of a live strategy.
 *   - `unknown` sits BELOW `stale` — a definite bad age is evidence we HAVE
 *     ("this job last ran five days ago"), and letting a mere absence of series
 *     data soften it would trade a fact for a shrug. So a known-bad sync age
 *     survives this arm untouched.
 *
 * An unresolvable `computedAt` keeps the behaviour it already had: it
 * classifies `stale` via `computeFreshness` and the subject stays `sync`. That
 * is already the most cautious render, and a series cannot make it worse.
 */
export function resolveEffectiveRecency(
  computedAt: Date | string | number | null | undefined,
  seriesEnd: Date | string | number | null | undefined,
  now: Date = new Date(),
): EffectiveRecency {
  const syncFreshness = computeFreshness(computedAt, now);
  const seriesEndMs = toFiniteMs(seriesEnd);

  if (seriesEndMs === null) {
    return {
      // `warm` is the middle bucket of this ladder and therefore the exact
      // position `unknown` occupies in TONE_RANK: below a freshness claim,
      // above a staleness one. No new threshold.
      freshness: syncFreshness === "fresh" ? "warm" : syncFreshness,
      subject: "unknown",
      seriesEndDate: null,
    };
  }

  const seriesFreshness = bucketSeriesAge(seriesEndMs, now);
  const seriesBinds =
    FRESHNESS_RANK[seriesFreshness] > FRESHNESS_RANK[syncFreshness];

  return {
    freshness: seriesBinds ? seriesFreshness : syncFreshness,
    subject: seriesBinds ? "series" : "sync",
    seriesEndDate: new Date(seriesEndMs),
  };
}

/** Parse the shapes `computeFreshness` accepts; `null` for anything unusable. */
function toFiniteMs(
  value: Date | string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
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
