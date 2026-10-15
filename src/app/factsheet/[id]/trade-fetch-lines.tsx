import { resolveTradeFetch } from "@/lib/freshness";
import { inclusiveDayCount } from "@/lib/factsheet/build-payload";
import type {
  ReconstructedRange,
  UnrecoveredGap,
} from "@/lib/factsheet/trade-fetch-provenance";

/**
 * Phase 167.1.2.2.2 (TRADESYNC) - the two header statements about the record's
 * trade data, shared by the factsheet header (`v2/FactsheetView.tsx`) and the
 * printed tear sheet (`tearsheet/page.tsx`) so the page and the one-pager can
 * never word the same fact two ways (D-06, D-10; plan 11).
 *
 * They live here, and not in `FactsheetView.tsx`, because the tear sheet is a
 * server component and `FactsheetView` is the whole interactive factsheet: the
 * printable page must not pull that client bundle in to render two sentences.
 * This module is deliberately directive-free and hook-free, so a server
 * component and a client component can both import it. The one thing that needs
 * a hook, the pinned "now" the factsheet reads once per mount, therefore stays in
 * `FactsheetView.tsx` (`TradeFetchLine`) and hands `nowMs` down; the tear sheet,
 * which is rendered fresh per request, passes its own request time.
 *
 * `formatIsoDate` is exported for the same reason and is the factsheet's ONE
 * date formatter (the header chip, the series line and these lines all call it),
 * so adjacent lines can never format one day two ways.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The type size of a line. The factsheet header uses the fluid `text-caption`
 * token; the printed tear sheet is a fixed 10 px layout (`text-fixed-10`). Both
 * strings are written out in full so Tailwind sees them.
 */
export type TradeLineSize = "caption" | "fixed-10";

const SIZE_CLASS: Record<TradeLineSize, string> = {
  caption: "text-caption",
  "fixed-10": "text-fixed-10",
};

/**
 * Trade-fetch line - Phase 167.1.2.2.2 (TRADESYNC), D-06 / D-07 / D-10, with
 * the F2 and F3 amendments over the UI-SPEC.
 *
 * WHY this line exists. `Computed` (the chip) and `Track record through` (the
 * series line) are both silent about the one fact an allocator needs to judge a
 * LIVE strategy key: when did we last actually read the exchange? Both advance
 * for an account that has not been fetched, so a key whose daily fetch broke, or
 * was disconnected on a published strategy (D-10), looked healthy. This reads
 * `strategy_analytics.trades_fetched_at` and nothing else (D-07).
 *
 * THE VERDICT IS NOT DECIDED HERE. `resolveTradeFetch` owns current / stale /
 * never / future / not_applicable and the 2-day threshold; the whole-day count
 * below is display only and never a second threshold. `not_applicable` (a CSV,
 * composite or blend payload, a venue the cron never fetches, or an unparseable
 * stamp) renders ZERO nodes: absence is the honest render, no "—" placeholder.
 * F2: a key-backed strategy with no stamp says "No trade fetch recorded yet",
 * never "Trades not yet fetched" (a strategy with historical trades has been
 * fetched; the stamp is simply absent). F3: `tradeFetchVenue` is the api key's
 * exchange, set by the payload builder, never `supported_exchanges`.
 *
 * `nowMs` is a REQUIRED prop: the caller owns the clock so render here stays
 * pure. The factsheet reads it once per mount in a `useState` initialiser (the
 * `FreshnessChip` precedent, so the line cannot flicker between server and
 * client by a clock read during render); the tear sheet passes its request time.
 */
export function TradeFetchLineView({
  tradesFetchedAt,
  tradeFetchVenue,
  nowMs,
  size = "caption",
}: {
  tradesFetchedAt: string | null;
  tradeFetchVenue: string | null;
  nowMs: number;
  size?: TradeLineSize;
}) {
  const verdict = resolveTradeFetch(tradesFetchedAt, tradeFetchVenue, new Date(nowMs));
  const sizeClass = SIZE_CLASS[size];
  if (verdict.state === "not_applicable") return null;
  if (verdict.state === "never") {
    return <p className={`mt-1 ${sizeClass} text-text-muted`}>No trade fetch recorded yet</p>;
  }
  if (verdict.state === "future") {
    return (
      <p className={`mt-1 ${sizeClass} text-text-muted`}>
        Trade fetch time is in the future — check data
      </p>
    );
  }
  // current | stale: both carry a parsed instant.
  const fetchedAt = verdict.fetchedAt as Date;
  const days = Math.max(0, Math.floor((nowMs - fetchedAt.getTime()) / 86_400_000));
  const age = days === 0 ? "less than a day" : days === 1 ? "1 day" : `${days} days`;
  // current | stale imply a parsed stamp, so `tradesFetchedAt` is a non-null string here.
  const date = formatIsoDate(tradesFetchedAt as string);
  if (verdict.state === "stale") {
    return (
      <p className={`mt-1 ${sizeClass} text-negative`}>
        Stale: last trades fetched {age} ago · {date}
      </p>
    );
  }
  return (
    <p className={`mt-1 ${sizeClass} text-text-muted`}>
      Last trades fetched {age} ago · {date}
    </p>
  );
}

/**
 * SFH-M2 (Phase 167.1.2.2.2 PR-B review round 1) - the line for a trade-fetch
 * state that could not be read or was malformed.
 *
 * It is NOT "No trade fetch recorded yet": that sentence asserts the read
 * succeeded and found no stamp, and printing it for an unreadable row would be a
 * false statement on a public, printable page. Neutral muted text, never the
 * stale / warning colour: this is the page admitting it does not know, not a
 * finding about the strategy. Used by the tear sheet; the factsheet payload path
 * has its own failure channel.
 */
export function TradeFetchUnavailableLine({ size = "caption" }: { size?: TradeLineSize }) {
  return <p className={`mt-1 ${SIZE_CLASS[size]} text-text-muted`}>Trade fetch status unavailable</p>;
}

/** At most this many gaps are named; the rest collapse into one count line. */
const MAX_NAMED_GAPS = 3;

/**
 * Named unrecovered gap - Phase 167.1.2.2.2 (TRADESYNC), D-02, with the F1
 * amendment over the UI-SPEC.
 *
 * WHAT IT STATES. A span of days that neither the daily tick nor the venue has
 * supplied. It stays MISSING: it is left out of the record, never counted as
 * zero (D-02), and the header says so. The persisted series, grid and chart
 * lists carry no point inside it (plan 07 `TestNamedGapIsNeverZeroFilled`, D-16),
 * which is the only reason the second clause is true and may be printed.
 *
 * F1 - THE COPY STATES ONLY WHAT IS TRUE AT SHIP TIME. The UI-SPEC's draft said
 * "the exchange no longer serves these days". That is false: OKX's quarterly
 * archive serves them and Phase 167.1.2.2.2.1 OKXHISTORY recovers them.
 * (History, dated 2026-10-15: that phase now recovers them and records each
 * rebuilt range in `reconstructed_ranges`; `ReconstructedRangeLines` below
 * states it. This gap line's copy is unchanged and the F1 rule stands.) Do not
 * reintroduce a claim about what the exchange can or cannot supply; this line
 * says only that the days are not recovered and are not counted as zero.
 * `FactsheetView.unrecovered-gap.test.tsx` pins the absence of that phrase.
 *
 * `gaps` is `parseUnrecoveredGaps` output: validated `{from, to}` spans, newest
 * `to` first. The component renders them in the order given and takes the first
 * three; it does not re-sort, so the parser stays the one place order is decided.
 * `{days}` is `inclusiveDayCount`, the SAME function the chart seam's
 * `{days}d - no data` label uses, so the two cannot disagree for one span.
 *
 * Muted-secondary, never red or amber: a gap is absence, not failure (DESIGN.md).
 * No dot, no glyph. Plain wrapping text: nothing here is `whitespace-nowrap` or
 * `truncate`, so a long sentence wraps in a narrow header instead of overflowing
 * (reflow floor 390 px, the founder's 2026-09-27 decision in
 * `e2e/reflow-sweep.spec.ts`, which supersedes the UI-SPEC's 320 px).
 */
export function UnrecoveredGapLines({
  gaps,
  size = "caption",
}: {
  gaps: UnrecoveredGap[] | undefined;
  size?: TradeLineSize;
}) {
  // `undefined` is a payload cached before this field existed (plan 10 records
  // that a cache-key collision with main's shape is possible until the release
  // bumps the key). The type says required; a public page must still render
  // nothing rather than throw on `.length`.
  if (!gaps || gaps.length === 0) return null;
  const className = `mt-1 ${SIZE_CLASS[size]} text-text-secondary`;
  const named = gaps.slice(0, MAX_NAMED_GAPS);
  const more = gaps.length - named.length;
  return (
    <>
      {named.map((gap) => {
        const days = inclusiveDayCount(gap.from, gap.to);
        return days === 1 ? (
          <p key={`${gap.from}:${gap.to}`} className={className}>
            No trade data {formatIsoDate(gap.from)} (1 day). This day is not recovered; it is left
            out of the record, not counted as zero.
          </p>
        ) : (
          <p key={`${gap.from}:${gap.to}`} className={className}>
            No trade data {formatIsoDate(gap.from)} – {formatIsoDate(gap.to)} ({days} days). These
            days are not recovered; they are left out of the record, not counted as zero.
          </p>
        );
      })}
      {more > 0 && (
        <p className={className}>
          {more} more {more === 1 ? "gap" : "gaps"} without trade data.
        </p>
      )}
    </>
  );
}

/** The founder's D-06 sentence after the `{from} – {to}: ` prefix, character for character. */
const RECONSTRUCTED_SENTENCE = "rebuilt from OKX's quarterly account statement, not the live feed.";

/**
 * Review round 1, F5 / IN-01: the line for a `reconstructed_ranges` record that
 * was present but malformed. NOT the D-06 sentence (that names a range we could
 * not read) and NOT silence: the rebuild RPC already removed the rebuilt days
 * from `unrecovered_gaps`, so printing nothing would present them as live days.
 * It states the limit, in DESIGN.md's declarative sentence-case voice, and
 * deliberately avoids the D-06 wording ("quarterly account statement") so no
 * reader or test can mistake it for a stored range. Muted-secondary like its
 * sibling lines: the page admits it does not know, it makes no finding.
 */
const RECONSTRUCTED_UNAVAILABLE_SENTENCE =
  "Record of rebuilt days unavailable. Some days may come from a quarterly statement, not the live feed.";

/**
 * Reconstructed range - Phase 167.1.2.2.2.1 (OKXHISTORY), D-06 and D-07.
 *
 * WHY THIS LINE EXISTS. Rebuilt days COUNT in the headline metrics (D-07), so
 * every reader is told which days were rebuilt and from what (D-06). One
 * sentence per stored range, the founder's wording and nothing added:
 * `{from} – {to}: rebuilt from OKX's quarterly account statement, not the live
 * feed.` A one-day range renders the same sentence with both dates equal; there
 * is no one-day variant, the founder fixed one sentence. The chart is not marked
 * or shaded and no per-row marker exists: this caption is how a rebuilt day is
 * told from a live one (SC-2). Shown to every viewer.
 *
 * `ranges` is `parseReconstructedRanges` output: validated `{from, to, source}`
 * spans, newest `to` first. Rendered in the order given, at most three named
 * and then one count line, like `UnrecoveredGapLines`, with which it sits: a
 * partly rebuilt gap shows both lines, so the days still missing stay named
 * (SC-4). Dates go through the same `formatIsoDate` as the gap lines.
 *
 * Muted-secondary caption, plain wrapping text, no glyph (DESIGN.md: declarative
 * sentence-case captions). `undefined` is a payload cached before the field
 * existed: render nothing rather than throw on `.length`.
 *
 * `unavailable` (review round 1, F5 / IN-01) is the parser's verdict that the
 * stored record was malformed: `ranges` is then `[]` and this prints the
 * unavailable sentence instead of nothing. Absent on a payload cached before the
 * flag existed, which reads as false (the prior behaviour, no new claim).
 */
export function ReconstructedRangeLines({
  ranges,
  unavailable = false,
  size = "caption",
}: {
  ranges: ReconstructedRange[] | undefined;
  unavailable?: boolean;
  size?: TradeLineSize;
}) {
  const className = `mt-1 ${SIZE_CLASS[size]} text-text-secondary`;
  if (unavailable) return <p className={className}>{RECONSTRUCTED_UNAVAILABLE_SENTENCE}</p>;
  if (!ranges || ranges.length === 0) return null;
  const named = ranges.slice(0, MAX_NAMED_GAPS);
  const more = ranges.length - named.length;
  return (
    <>
      {named.map((range) => (
        <p key={`${range.from}:${range.to}`} className={className}>
          {formatIsoDate(range.from)} – {formatIsoDate(range.to)}: {RECONSTRUCTED_SENTENCE}
        </p>
      ))}
      {more > 0 && (
        <p className={className}>
          {`${more} more ${more === 1 ? "range" : "ranges"} rebuilt from OKX's quarterly account statement.`}
        </p>
      )}
    </>
  );
}
