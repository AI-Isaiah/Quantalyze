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

/**
 * Tolerated clock drift between Postgres and the Next.js server, in minutes.
 *
 * EXPORTED since 163-REVIEW / WR-06 because the COPY has to honour the same
 * tolerance as the COLOUR. `SyncBadge`'s `timeAgo` renders the sentence beside
 * the dot this module buckets; if it called anything ahead of "now" a future
 * date while `computeFreshness` was still calling the same instant `fresh`,
 * the badge would contradict itself on ordinary browser-clock drift — the very
 * shape of defect WR-06 reported, merely relocated.
 */
export const CLOCK_SKEW_TOLERANCE_MINUTES = 5;

/**
 * How far ahead of the reader's clock a `series_end` may sit and still be a
 * CURRENT bar rather than a corrupt write, in DAYS.
 *
 * ⛔ THE UNIT IS THE POINT (WR-06-UTC). `series_end` is a UTC **DATE**, not an
 * instant: it names the calendar day of the last daily bar. A venue that
 * stamps today's bar therefore writes a date that is legitimately "ahead" of
 * any browser west of UTC — an MT5 broker on UTC+3 near 22:00 UTC does exactly
 * this, and so does every reader in the Americas for several hours of every
 * day. `CLOCK_SKEW_TOLERANCE_MINUTES` above is calibrated for two SERVER
 * CLOCKS drifting apart and is the wrong ORDER OF MAGNITUDE for a date, so
 * under it an ordinary same-day bar rendered a muted "Track record ends in the
 * future" over a live strategy. One calendar day is the largest gap a
 * correctly-written date can open, and it is bounded: two days ahead is still
 * `future`, because that is a write nobody can have observed.
 *
 * EXPORTED, and imported rather than re-typed, for the reason
 * `CLOCK_SKEW_TOLERANCE_MINUTES` states above: there are TWO bucketers for this
 * one fact — `bucketSeriesAge` below (the discovery badge) and `bucketByAge` in
 * `app/factsheet/[id]/v2/FactsheetView.tsx` (the factsheet chip). Fixing one
 * and transcribing the number into the other is precisely how those two public
 * surfaces came to contradict each other about one strategy in the first place.
 *
 * ⛔ THE SERIES ARM ONLY. `computedAt` is an INSTANT written by our own
 * pipeline, so the sync arm (`computeFreshness`, and `SyncBadge`'s `timeAgo`)
 * keeps `CLOCK_SKEW_TOLERANCE_MINUTES`. A day of grace there would launder a
 * corrupt compute timestamp into a freshness claim; chip-honesty C-10 is the
 * wrong-scope tripwire that catches it.
 */
export const SERIES_END_FUTURE_ALLOWANCE_DAYS = 1;

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
  /**
   * The series end is AHEAD of now by more than the shared clock-skew
   * tolerance, and is therefore the binding fact.
   *
   * ⛔ THIS EXISTS BECAUSE `Freshness` CANNOT SAY "NEITHER" (163-REVIEW,
   * finding 2). `FreshnessChip`'s `bucketByAge` answers a future date with its
   * own `future` tone, which `toneColor` renders MUTED and labels
   * "future — check data": explicitly not its green and explicitly not its red.
   * This module's three buckets are green / amber / red, so mapping `future`
   * onto `warm` alone bought the RANK but painted AMBER — a colour every other
   * row uses to mean "getting old". The chip said "check the data", the badge
   * said "going stale", about one strategy. Callers read this flag for the
   * DOT COLOUR (`FUTURE_SERIES_DOT`) while `freshness` keeps the ladder
   * position, so the two surfaces answer the same input the same way.
   */
  seriesEndIsFuture: boolean;
}

/**
 * How pessimistic each bucket is. Mirrors `TONE_RANK` in `FreshnessChip`'s
 * module.
 */
const FRESHNESS_RANK: Record<Freshness, number> = {
  fresh: 0,
  warm: 1,
  stale: 2,
};

/**
 * The series verdicts. `future` is NOT a fourth threshold — it is the chip's
 * `future` tone, carried through so the badge can render the same non-claim.
 */
type SeriesVerdict = Freshness | "future";

/**
 * Rank of each series verdict, on the SAME scale as `FRESHNESS_RANK` so the
 * two are directly comparable.
 *
 * `future` sits at the TOP, which is `TONE_RANK`'s ordering (`future` above
 * `old`, the chip's red) rather than a new opinion. A date that has not
 * happened means the input itself is untrustworthy, and "the data is wrong" is
 * a louder fact than "the job is old" — so it binds over ANY sync verdict, as
 * it does on the factsheet. The sync age is not discarded when it does: it
 * moves into the badge's tooltip, exactly as on the `series` arm.
 */
const SERIES_RANK: Record<SeriesVerdict, number> = {
  fresh: 0,
  warm: 1,
  stale: 2,
  future: 3,
};

/**
 * The dot colour for a future series end.
 *
 * Deliberately the token behind `--color-text-muted` — the SAME custom
 * property `FreshnessChip`'s `toneColor` falls through to for its `future`
 * tone. One value, two surfaces, agreement by construction rather than by two
 * people picking a grey.
 */
export const FUTURE_SERIES_DOT = "bg-text-muted";

/**
 * Classify a series end on the shared 3d/7d series ladder.
 *
 * ⚠️ THE FUTURE ARM IS THE CHIP'S, NOT A SECOND RULE (163-REVIEW / WR-06).
 * This originally mapped `days < 0` to `"stale"` — the WORST bucket, so a
 * future point always bound and always painted the dot red. `bucketByAge` in
 * `FreshnessChip`'s module maps the SAME input to its `future` tone, which
 * `toneColor` renders MUTED and labels "future — check data". So one strategy
 * with a bar stamped tomorrow — an MT5 broker on UTC+3 near 22:00 UTC does
 * exactly this — read DEAD on the discovery list and NEUTRAL on its own
 * factsheet. Two public surfaces contradicting each other about one strategy
 * is precisely the class HONEST-08 was created to close, reopened on the one
 * boundary the "shared ladder" had not actually shared.
 *
 * ⛔ NO ZERO BOUNDARY — THE TOLERANCE IS THE SHARED ONE (163-REVIEW, finding
 * 2). WR-06's repair still split on `days < 0` exactly, so a series end a
 * SECOND ahead of this server's clock fell into the future arm and BOUND over
 * a job that had just succeeded. That is not a hypothetical: `computeFreshness`
 * has tolerated up to `CLOCK_SKEW_TOLERANCE_MINUTES` of writer/reader drift as
 * `fresh` since it was written, and `SyncBadge`'s `timeAgo` was taught the same
 * number so the COPY could not contradict the COLOUR. This arm was the third
 * reader of that instant and the only one still using a bare zero — so on
 * ordinary drift the badge rendered an amber dot over a strategy every other
 * reader in the module called fresh. Within tolerance is `fresh`, and it is the
 * same constant, imported rather than re-typed.
 *
 * ⚠️ THE TOLERANCE ON THIS ARM IS NO LONGER THAT CONSTANT (WR-06-UTC, Phase
 * 164.2), and the paragraph above is kept as the reason the boundary stopped
 * being zero rather than as a current reading. 163-REVIEW moved this arm from a
 * bare zero to the SYNC constant, which was the right direction in the wrong
 * UNIT: `series_end` is a UTC DATE, and a same-day bar is up to a calendar day
 * ahead of a browser west of UTC — so five minutes still called an ordinary
 * MT5-on-UTC+3 row `future`. The arm now reads
 * `SERIES_END_FUTURE_ALLOWANCE_DAYS`, which subsumes the five minutes. The
 * SYNC arm is untouched and still reads `CLOCK_SKEW_TOLERANCE_MINUTES`: the two
 * facts are different kinds of clock, which is the whole reason the constants
 * are two.
 *
 * Beyond tolerance the answer is `future`: NOT a claim of staleness and NOT a
 * claim of freshness, which is the same non-committal position an unresolvable
 * series end already occupies in `resolveEffectiveRecency` below. A date we
 * cannot have observed yet is not evidence of a live strategy, and it is not
 * evidence of a dead one either. No new threshold, no fourth ladder.
 */
function bucketSeriesAge(seriesEndMs: number, now: Date): SeriesVerdict {
  // 169 review WR-04: `series_end` is a UTC DATE, so its age is whole elapsed
  // days (floor), the number the factsheet chip prints and buckets on
  // (`FreshnessChip` in FactsheetView.tsx). Bucketing the fractional age here
  // put a 3.6-day-old series on the series arm while the chip kept the job's
  // verdict, and made 7.6 days red here and amber there. The future allowance
  // holds: a bar dated tomorrow west of UTC is floor(-0.4) = -1, within
  // SERIES_END_FUTURE_ALLOWANCE_DAYS; two days ahead is -2, still `future`.
  const days = Math.floor((now.getTime() - seriesEndMs) / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(days)) return "stale";
  if (days < 0) {
    // ⛔ DAYS, NOT MINUTES (WR-06-UTC). See SERIES_END_FUTURE_ALLOWANCE_DAYS:
    // `series_end` is a UTC DATE, so a same-day bar is up to a calendar day
    // ahead of a browser west of UTC. A day subsumes the five minutes on this
    // arm, so there is no second comparison — one allowance, one unit.
    const daysAhead = -days;
    return daysAhead <= SERIES_END_FUTURE_ALLOWANCE_DAYS ? "fresh" : "future";
  }
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
 * THE `future` ARM MIRRORS `TONE_RANK` TOO, at its other end: `future` is the
 * chip's MOST pessimistic tone (above its `old`), because a date that has not
 * happened impeaches the INPUT rather than merely aging it. So it binds over
 * every sync verdict, including a known-bad one — the one place this module
 * deliberately does let a series verdict override a definite sync age, and it
 * does so because the fact it reports is "this row's data is wrong", not "we
 * don't know". The sync age is preserved in the badge tooltip, as on the
 * ordinary `series` arm. The rendered COLOUR is not amber: see
 * `seriesEndIsFuture`.
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
      seriesEndIsFuture: false,
    };
  }

  const seriesVerdict = bucketSeriesAge(seriesEndMs, now);
  const seriesBinds =
    SERIES_RANK[seriesVerdict] > FRESHNESS_RANK[syncFreshness];
  // `future` outranks every sync verdict, so this is always the binding arm —
  // written as a conjunction anyway so the flag can never claim a subject the
  // copy did not select.
  const futureBinds = seriesBinds && seriesVerdict === "future";

  return {
    // `future` has no bucket on a green/amber/red ladder, and the honest
    // ladder POSITION for "neither claim" is the middle one — the same slot
    // `unknown` takes above. The COLOUR does not follow from it: callers read
    // `seriesEndIsFuture` and render `FUTURE_SERIES_DOT` instead, which is the
    // chip's muted grey.
    freshness: futureBinds
      ? "warm"
      : seriesBinds
        ? (seriesVerdict as Freshness)
        : syncFreshness,
    subject: seriesBinds ? "series" : "sync",
    seriesEndDate: new Date(seriesEndMs),
    seriesEndIsFuture: futureBinds,
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

/**
 * ── Phase 167.1.2.2.2 / TRADESYNC: the TRADE-FETCH arm ──────────────────────
 *
 * THE SUBJECT (D-07). The last SUCCESSFUL TRADE FETCH
 * (`strategy_analytics.trades_fetched_at`), never `computed_at`. The analytics
 * recompute can run on trades that were fetched weeks ago, so `computed_at`
 * answers "when did we last do arithmetic" and says nothing about whether the
 * venue's records are in. Only the daily `/cron-sync` tick writes this
 * timestamp.
 *
 * THE THRESHOLD (D-05). "Stale when the last successful trade fetch is MORE
 * THAN 2 days old." The tick runs daily, so two days is one missed tick plus
 * slack. "More than" is a strict greater-than on elapsed milliseconds: a fetch
 * exactly 48 h old is `current`, 48 h plus 1 ms is `stale`. The 2 is used only
 * through this constant.
 */
export const TRADE_FETCH_STALE_DAYS = 2;

/**
 * The venues `/cron-sync` actually fetches trades for, i.e. the venues
 * `fetch_daily_pnl` (analytics-service/services/exchange.py) has a branch for.
 *
 * Only a venue in this list can honestly be called "never fetched": for every
 * other venue (deribit has a class in `EXCHANGE_CLASSES` but no
 * `fetch_daily_pnl` branch; MT5, sFOX, CSV and composite are not ccxt trade
 * fetches at all) a null timestamp is the NORMAL state, not a gap.
 * `freshness.trade-fetch-venues.test.ts` reads the Python file and fails when
 * the two lists drift, so adding or removing a venue branch there forces a
 * decision here (T-167.1.2.2.2-28).
 */
export const TRADE_FETCH_VENUES = ["okx", "bybit", "binance"] as const;

/**
 * What a trade-fetch timestamp says, as the ONE verdict every surface renders.
 *
 *   `current`        — fetched, and not more than TRADE_FETCH_STALE_DAYS ago.
 *   `stale`          — fetched, and more than TRADE_FETCH_STALE_DAYS ago. This
 *                      is the existing red stale token on the same ladder
 *                      (`FRESHNESS_COLORS.stale`), and it means two or more
 *                      daily ticks have failed to record a fetch (F4).
 *   `never`          — no fetch recorded for a venue the cron does fetch.
 *   `future`         — the timestamp is ahead of now beyond clock skew: a
 *                      corrupt write, neither a freshness nor a staleness claim.
 *   `not_applicable` — no claim can be made (unparseable input, or a null
 *                      timestamp for a venue the cron never fetches).
 */
export type TradeFetchState =
  | "current"
  | "stale"
  | "never"
  | "future"
  | "not_applicable";

export interface TradeFetchVerdict {
  state: TradeFetchState;
  /** The parsed instant; `null` when the input was null or unparseable. */
  fetchedAt: Date | null;
}

/**
 * Unparseable values already reported, so one corrupt row warns once rather
 * than once per render (the `deriveSegmentMarkers` malformed-shape idiom, with
 * the once-only added because this runs per row of a list).
 */
const warnedUnparseableTradeFetch = new Set<string>();

/**
 * Classify a trade-fetch timestamp. THE one classifier: the SyncBadge, the
 * factsheet trade-fetch line and the tearsheet all import this, and nothing
 * else compares the timestamp itself.
 *
 * ⛔ WHY ONE EXPORTED FUNCTION AND NOT A LINT. The
 * `quantalyze/no-raw-staleness-derivation` rule only matches `last_sync_at`
 * text, so it cannot see a comparison against `trades_fetched_at`. The
 * compensating control is this single resolver plus a pin (plan 11) that no
 * other file does that comparison.
 *
 * ⛔ NOT `computeFreshness`. That ladder is 12 h / 48 h for a job that should
 * run many times a day. This tick is daily, so a healthy fetch is routinely
 * 20+ hours old and would read amber for half of every day.
 *
 * ⛔ THE SKEW TOLERANCE IS MINUTES, NOT THE SERIES ARM'S DAY. `trades_fetched_at`
 * is an INSTANT written by our own pipeline (like `computed_at`), not a UTC
 * DATE like `series_end`, so the allowance for two server clocks drifting is
 * `CLOCK_SKEW_TOLERANCE_MINUTES`. A day of grace here would launder a corrupt
 * write into a "current" claim (T-167.1.2.2.2-27).
 *
 * Rules, in order:
 *   1. non-null and unparseable            -> `not_applicable` (warn once).
 *   2. ahead of now by more than the skew  -> `future`.
 *   3. older than TRADE_FETCH_STALE_DAYS   -> `stale`.
 *   4. non-null otherwise                  -> `current`.
 *   5. null, venue in TRADE_FETCH_VENUES   -> `never`.
 *   6. null otherwise                      -> `not_applicable`.
 *
 * A non-null `tradesFetchedAt` is authoritative whatever the venue says (only
 * the cron writes it); the venue only separates the two null cases.
 *
 * ⚠️ F2 — the state is NAMED `never` but the COPY for it must be "No trade
 * fetch recorded yet", never "Trades not yet fetched". A strategy can hold
 * years of historical trades (CSV upload, earlier sync) and still carry a null
 * timestamp until the first tick, so "not yet fetched" would be a false claim
 * on a public factsheet.
 *
 * ⚠️ F3 — `venue` comes ONLY from the strategy's api-key exchange, never from
 * `supported_exchanges`. A CSV strategy that declares okx there has no api key
 * and no cron fetch, so it must resolve `not_applicable`; passing the declared
 * list would stamp it "no trade fetch recorded".
 */
export function resolveTradeFetch(
  tradesFetchedAt: Date | string | number | null | undefined,
  venue: string | null | undefined,
  now: Date = new Date(),
): TradeFetchVerdict {
  if (tradesFetchedAt == null) {
    const isFetchedVenue =
      typeof venue === "string" &&
      (TRADE_FETCH_VENUES as readonly string[]).includes(venue.toLowerCase());
    return { state: isFetchedVenue ? "never" : "not_applicable", fetchedAt: null };
  }

  const ms = toFiniteMs(tradesFetchedAt);
  if (ms === null) {
    const key = String(tradesFetchedAt);
    if (!warnedUnparseableTradeFetch.has(key)) {
      warnedUnparseableTradeFetch.add(key);
      console.warn(
        "[freshness] resolveTradeFetch — trades_fetched_at is not a parseable instant; making no claim",
        { value: key },
      );
    }
    return { state: "not_applicable", fetchedAt: null };
  }

  const fetchedAt = new Date(ms);
  const elapsedMs = now.getTime() - ms;
  if (-elapsedMs > CLOCK_SKEW_TOLERANCE_MINUTES * 60 * 1000) {
    return { state: "future", fetchedAt };
  }
  if (elapsedMs > TRADE_FETCH_STALE_DAYS * 24 * 60 * 60 * 1000) {
    return { state: "stale", fetchedAt };
  }
  return { state: "current", fetchedAt };
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
