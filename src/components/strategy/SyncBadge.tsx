import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";
import {
  resolveEffectiveRecency,
  resolveTradeFetch,
  FRESHNESS_COLORS,
  FUTURE_SERIES_DOT,
  CLOCK_SKEW_TOLERANCE_MINUTES,
  TRADE_FETCH_STALE_DAYS,
} from "@/lib/freshness";

interface SyncBadgeProps {
  /**
   * Phase 167.1.2.2.2 / D-07 — when the analytics job last RAN. It no longer
   * drives the dot, the sentence or the render gate: it survives only inside
   * the tooltip, labelled "Analytics last computed …". Since Phase 166.5 the
   * analytics runner stamps `computed_at` on its success write only (the status
   * bridge writes no date), so it dates the last real compute. It still says
   * nothing about whether the venue's records are in.
   */
  computedAt: string | null;
  /**
   * Phase 163 / HONEST-08 — the date of the LAST point of the strategy's
   * return series, or `null` when this surface cannot resolve one.
   *
   * REQUIRED, deliberately. Every mount is compile-forced into an explicit
   * decision about whether it can answer "where does the track record end",
   * because the defect this prop closes was precisely a surface answering a
   * question it had no data for. An optional prop would let a future mount
   * silently reopen the class by omission.
   */
  seriesEnd: string | null;
  /**
   * Phase 167.1.2.2.2 / SC-4 — `strategy_analytics.trades_fetched_at`: the last
   * SUCCESSFUL trade fetch, written only by the daily `/cron-sync` tick.
   * REQUIRED for the same reason `seriesEnd` is: a mount that cannot name its
   * source must say `null` out loud rather than inherit a compute-time claim by
   * omission.
   */
  tradesFetchedAt: string | null;
  /**
   * Phase 167.1.2.2.2 / F3 — the venue as the strategy's API KEY knows it, or
   * `null` when the mount cannot resolve one. NEVER `supported_exchanges`: a CSV
   * strategy that declares okx has no key and no cron fetch, so it must resolve
   * to "no claim". It only separates the two null cases of `tradesFetchedAt`
   * (never fetched vs. not a fetched venue); a recorded fetch time is
   * authoritative whatever this says.
   *
   * Separate from `exchange` on purpose: `exchange` also renders the visible
   * venue LABEL, and making it required would add an "OKX" label to mounts that
   * show none today.
   */
  tradeFetchVenue: string | null;
  /**
   * The strategy's LISTED exchange (`supported_exchanges[0]`), rendered as the
   * visible venue label when no key venue is known. Display only; it never
   * feeds `resolveTradeFetch`.
   */
  exchange?: string | null;
  /**
   * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-05, D-07) — the exchange(s) the
   * strategy's trades actually come from (its API key's venue, from
   * `get_published_trade_venues`), or null/absent when it has no key (CSV or
   * demo) or the read failed. When present it REPLACES the listed exchange as
   * the visible label and names the venue in the "Trades fetched" tooltip.
   *
   * ⛔ LABEL AND TOOLTIP ONLY. It is separate from `tradeFetchVenue` exactly as
   * `exchange` is, and it never reaches `resolveTradeFetch`: feeding the
   * state's venue is a TRADESYNC decision (D-07), and doing it here would turn
   * a null-stamp row into "No trade fetch recorded yet" on a surface that never
   * claimed it. Dot, sentence and render gate are identical with and without it.
   */
  tradeVenues?: readonly string[] | null;
  /**
   * Phase 170.6.1 / O-3 — the strategy's WHOLE listed set
   * (`supported_exchanges`). The mismatch sentence fires only when some key
   * venue is NOT in this set (case-insensitive); comparing against
   * `exchange` alone would flag a strategy that lists both venues. Absent or
   * empty means there is no listing to disagree with, so no cue.
   */
  listedExchanges?: readonly string[] | null;
  /**
   * Phase 170.6.1 / D-05, D-10 (review WR-01) — true when the venue read
   * FAILED or came back malformed, so the venue is UNKNOWN (distinct from
   * `tradeVenues` being absent because the strategy has no key). The label slot
   * then renders a muted "Venue unavailable" placeholder (D-10), never the
   * listed exchange, which is the wrong label SC-2 removes. The tooltip still
   * names no venue (no "from the exchange" wording, no mismatch cue). Ignored
   * when `tradeVenues` is non-empty. Display only: it never reaches
   * `resolveTradeFetch`, so the dot, the sentence and the render gate are
   * identical with and without it (D-07).
   */
  tradeVenuesUnavailable?: boolean;
  className?: string;
}

/**
 * ⚠️ THE FUTURE ARM IS LOAD-BEARING (163-REVIEW / WR-06). Without it a
 * negative age falls straight through `seconds < 60` and this function calls a
 * date that HAS NOT HAPPENED "just now" — so the badge rendered a red dot
 * beside "Track record ends just now", stating a catastrophe and a triviality
 * about one date in one span. The colour was fixed in `bucketSeriesAge`; the
 * SENTENCE has to stop lying too, or the contradiction merely moves.
 *
 * ⛔ THE THRESHOLD IS NOT ZERO, DELIBERATELY. `computeFreshness` has always
 * tolerated up to `CLOCK_SKEW_TOLERANCE_MINUTES` of writer/reader drift as
 * `fresh`, and a browser clock trailing the server's by a second or two is
 * ordinary rather than corrupt. Announcing "in the future" on that drift would
 * fire on real users AND would contradict the green dot rendered from the same
 * instant — trading WR-06's self-contradiction for a fresh one. The copy and
 * the colour read ONE tolerance, imported rather than re-typed.
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < -CLOCK_SKEW_TOLERANCE_MINUTES * 60) return "in the future";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Phase 170.6.1 / O-2 — `EXCHANGE_DISPLAY` is the ONE label source (it carries
 * every `SupportedExchange` and makes a missing label a compile error). This
 * badge used to keep a private three-entry map, so a listed `deribit`, `sfox`
 * or `mt5` rendered raw; it now renders `Deribit`, `sFOX`, `MT5`. An unknown
 * code falls back to itself, never to a blank. `hasOwnProperty` keeps a code
 * like `constructor` from resolving to an inherited member.
 */
function exchangeLabelOf(code: string): string {
  const key = code.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXCHANGE_DISPLAY, key)
    ? EXCHANGE_DISPLAY[key as keyof typeof EXCHANGE_DISPLAY]
    : code;
}

/**
 * Distinct venue LABELS ordered case-insensitively by label (orchestrator
 * O-1), so OKX plus Bybit reads `Bybit, OKX`. No locale: a locale-aware
 * compare would order differently per viewer.
 */
function venueLabelsOf(venues: readonly string[] | null | undefined): string[] {
  const labels = Array.from(new Set((venues ?? []).filter(Boolean).map(exchangeLabelOf)));
  return labels.sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

/**
 * How bad each verdict is, so the two facts are directly comparable (UI-SPEC
 * "Badge states"): trade `current` 0, trade `never` 1 (the existing
 * `TONE_RANK` "unknown" slot); series fresh 0, warm 2, stale 3, future 4. Ties
 * go to the trade sentence. `stale` and `future` trade verdicts never reach the
 * comparison: they always bind.
 */
const TRADE_RANK = { current: 0, never: 1 } as const;
const SERIES_RANK = { fresh: 0, warm: 2, stale: 3, future: 4 } as const;
type SeriesVerdict = keyof typeof SERIES_RANK;

/**
 * Per-row data-recency badge for the ranked lists and the portfolio tables.
 *
 * Phase 167.1.2.2.2 / TRADESYNC (SC-4, D-05..D-07, D-14, F2, F3) — THE BADGE
 * NAMES WHAT IT MEASURES: the last successful TRADE FETCH
 * (`strategy_analytics.trades_fetched_at`, written only by the daily
 * `/cron-sync` tick), never `computed_at`. Measured on PROD, five strategies
 * whose newest trade was 15-156 days old read as freshly synced within the day, because
 * the status bridge then re-stamped `computed_at` on every job transition.
 * (Since Phase 166.5 only the analytics runner moves it, on its success write,
 * so it now dates a real compute; it still dates a JOB, not the venue's records.)
 * That word was a claim about the JOB that every reader took as a claim about
 * the STRATEGY, so it is retired here (D-14).
 *
 * TWO FACTS ARE JUDGED, EACH ON ITS OWN LADDER: the trade fetch through
 * `resolveTradeFetch` (the one classifier; 2 days, D-05) and the series end
 * through the shared 3d/7d series ladder (HONEST-08). One sentence renders and
 * it NAMES ITS SUBJECT. Precedence (UI-SPEC):
 *   1. trade `stale`  — always binds: it is the D-06 claim every viewer must
 *      see, and it is the cause when the series is old too.
 *   2. trade `future` — binds, muted: a data defect, neither claim.
 *   3. otherwise the series sentence binds only when its verdict is STRICTLY
 *      worse than the trade verdict (ties go to the trade sentence).
 *   4. trade `not_applicable` — only the series half exists; no series end
 *      renders nothing (no claim, no placeholder).
 *
 * ⛔ F2: the `never` state reads "No trade fetch recorded yet", never the
 * phrase that claims the platform has not yet fetched. A strategy can hold
 * years of historical trades (CSV, an earlier sync) and still carry a null
 * timestamp until the first tick.
 *
 * ⛔ D-07: NOTHING VISIBLE IS DERIVED FROM `computedAt`. See the series half
 * below: it is judged against `now` as its stand-in job instant, so the dot,
 * the sentence and the render gate are identical whatever `computedAt` is,
 * including null.
 */
export function SyncBadge({
  computedAt,
  seriesEnd,
  tradesFetchedAt,
  tradeFetchVenue,
  exchange,
  tradeVenues,
  listedExchanges,
  tradeVenuesUnavailable,
  className,
}: SyncBadgeProps) {
  const now = new Date();
  const trade = resolveTradeFetch(tradesFetchedAt, tradeFetchVenue, now);

  // The series half. `resolveEffectiveRecency` is the shared staler-of-two
  // resolver (HONEST-08) and takes a job instant as its first fact. Handing it
  // `now` makes that fact exactly fresh, so the resolver reports the SERIES
  // verdict alone: `warm` / `stale` / future (flagged) bind, a live series does
  // not. Deliberate, not a stub: the trade fetch has replaced the job as the
  // other fact (D-07), and no second copy of the series ladder is re-derived.
  const recency = resolveEffectiveRecency(now, seriesEnd, now);
  const seriesEndDate = recency.seriesEndDate;
  let seriesVerdict: SeriesVerdict | null = null;
  if (seriesEndDate) {
    seriesVerdict = recency.seriesEndIsFuture
      ? "future"
      : recency.subject === "series"
        ? recency.freshness
        : "fresh";
  }

  // ⛔ THE FUTURE ARM IS NOT AMBER (163-REVIEW, finding 2). A series end ahead
  // of now lands on `warm` for LADDER purposes, but amber means "getting old"
  // and a date that has not happened is not an age claim. `FUTURE_SERIES_DOT`
  // is the muted token the factsheet chip uses for that same input.
  const seriesDot = recency.seriesEndIsFuture
    ? FUTURE_SERIES_DOT
    : FRESHNESS_COLORS[recency.freshness].dot;

  let bound: "trade" | "series" | "none";
  if (trade.state === "stale" || trade.state === "future") {
    bound = "trade";
  } else if (trade.state === "not_applicable") {
    bound = seriesVerdict ? "series" : "none";
  } else {
    bound =
      seriesVerdict && SERIES_RANK[seriesVerdict] > TRADE_RANK[trade.state]
        ? "series"
        : "trade";
  }
  if (bound === "none") return null;

  const computedDate = computedAt ? new Date(computedAt) : null;
  const computedSuffix =
    computedDate && Number.isFinite(computedDate.getTime())
      ? ` Analytics last computed ${timeAgo(computedDate)}.`
      : "";

  // Phase 170.6.1 / D-05 — the label names the venue the trades come from when
  // the strategy has a key, else the listed exchange. Everything here is
  // display: `trade` above was resolved from the stamp and `tradeFetchVenue`
  // alone, so none of it can move a state (D-07).
  const venueLabels = venueLabelsOf(tradeVenues);
  const venueNames = venueLabels.length > 0 ? venueLabels.join(", ") : null;
  // A failed or malformed venue read (WR-01) is an UNKNOWN venue: the tooltip
  // names nothing (not the listed exchange, not the generic "the exchange") and
  // the label slot shows a muted "Venue unavailable" placeholder (D-10).
  const venueUnknown = !venueNames && tradeVenuesUnavailable === true;
  const exchangeLabel = venueUnknown
    ? null
    : (venueNames ?? (exchange ? exchangeLabelOf(exchange) : null));
  const fromVenue = venueUnknown ? null : (venueNames ?? "the exchange");
  const fromClause = fromVenue ? ` from ${fromVenue}` : "";

  // The mismatch cue (O-3): some key venue is outside the strategy's WHOLE
  // listed set. {Listed} is the label of `listedExchanges[0]`, falling back to
  // `exchange` only when no listed set was handed over.
  const listedSet = new Set(
    (listedExchanges ?? []).filter(Boolean).map((e) => e.trim().toLowerCase()),
  );
  const venueOutsideListing =
    listedSet.size > 0 &&
    (tradeVenues ?? []).some((v) => v && !listedSet.has(v.trim().toLowerCase()));
  const listedFirst = listedExchanges?.find(Boolean) ?? exchange ?? null;
  const mismatchSuffix =
    venueNames && venueOutsideListing && listedFirst
      ? ` Listed as ${exchangeLabelOf(listedFirst)}; trades come from ${venueNames}.`
      : "";

  // A series bar dated ahead but inside the day allowance is a CURRENT bar
  // (WR-06-UTC): `timeAgo` would call it "in the future" beside a positive
  // dot, so clamp it to now. A genuinely future bar keeps its date and the
  // muted "in the future" sentence.
  const seriesAge = (): string =>
    timeAgo(
      seriesEndDate!.getTime() > now.getTime() && !recency.seriesEndIsFuture
        ? now
        : seriesEndDate!,
    );

  let dot: string;
  let sentence: ReactNode;
  let title: string;

  if (bound === "series") {
    dot = seriesDot;
    sentence = <span>Track record ends {seriesAge()}</span>;
    if (trade.state === "not_applicable") {
      title = `Track record ends ${seriesAge()}.${mismatchSuffix}${computedSuffix}`;
    } else {
      const tradeSentence =
        trade.state === "never"
          ? "No trade fetch recorded yet."
          : `Trades last fetched ${timeAgo(trade.fetchedAt!)}.`;
      title = `Track record ends ${seriesAge()}. ${tradeSentence}${mismatchSuffix}${computedSuffix}`;
    }
  } else if (trade.state === "stale") {
    const age = timeAgo(trade.fetchedAt!);
    dot = FRESHNESS_COLORS.stale.dot;
    sentence = (
      <span>
        Trades fetched {age}
        <Separator />
        <span className="text-negative">stale</span>
      </span>
    );
    title = `No trades fetched${fromClause} in more than ${TRADE_FETCH_STALE_DAYS} days. Last fetch ${age}.${mismatchSuffix}${computedSuffix}`;
  } else if (trade.state === "future") {
    dot = FUTURE_SERIES_DOT;
    sentence = (
      <span>
        Trades fetched
        <Separator />
        future — check data
      </span>
    );
    title = `The recorded trade fetch time is in the future, so no fetch age is shown.${mismatchSuffix}${computedSuffix}`;
  } else if (trade.state === "never") {
    dot = FUTURE_SERIES_DOT;
    sentence = <span>No trade fetch recorded yet</span>;
    title = `No trade fetch is recorded for this strategy yet. Trades are fetched daily.${mismatchSuffix}${computedSuffix}`;
  } else {
    const age = timeAgo(trade.fetchedAt!);
    dot = FRESHNESS_COLORS.fresh.dot;
    sentence = <span>Trades fetched {age}</span>;
    title = `Trades last fetched${fromClause} ${age}. Fetched daily; marked stale after ${TRADE_FETCH_STALE_DAYS} days without a fetch.${mismatchSuffix}${computedSuffix}`;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-fixed-10 text-text-muted",
        className,
      )}
      // Supplemental only: every claim is already in the visible text, so
      // nothing depends on hover. The compute time lives here and nowhere else.
      title={title}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)}
      />
      {exchangeLabel ? (
        <span className="font-medium text-text-secondary">{exchangeLabel}</span>
      ) : venueUnknown ? (
        // D-10: muted = honest-empty (DESIGN.md). Not red (permanent failure),
        // not amber (recoverable), and not the real label's font-medium.
        // Review WR-01 (round 2): it is two words in the sentence's own colour,
        // so it carries the badge's `Separator` (visible " · ", sr-only comma).
        // Without it the badge read "Venue unavailable Trades fetched ..." and a
        // screen reader heard one noun phrase. A real label is a one-word proper
        // noun in `font-medium` and needs no boundary, so it is left untouched.
        // Review WR-02 (round 2): `whitespace-nowrap`, because it is the one label
        // that is two words. In the ~106 px badge column of the pinned name cell it
        // broke inside itself ("Venue" over "unavailable"; measured at V360, V375
        // and V390). It breaks only as a unit now. ⛔ Not `flex-wrap` on the root:
        // that drops the badge's min-content to its widest item, and the table's
        // auto layout then shrinks the whole name column (measured 138 -> 120 px)
        // and leaves the dot stranded on its own line.
        <span data-venue-unavailable="" className="whitespace-nowrap text-text-muted">
          Venue unavailable
          <Separator />
        </span>
      ) : null}
      {sentence}
    </span>
  );
}

/**
 * The visible ` · ` is decoration (`aria-hidden`); the `sr-only` comma is what
 * a screen reader hears, so "Trades fetched 9d ago · stale" is announced as
 * "Trades fetched 9d ago, stale".
 */
function Separator() {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
    </>
  );
}
