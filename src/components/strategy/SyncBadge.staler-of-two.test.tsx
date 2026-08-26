/**
 * HONEST-08 (Phase 163 / 163-04) — the discovery badge must bucket on the
 * STALER of sync-recency and series-recency.
 *
 * THE DEFECT, measured on PRODUCTION 2026-08-26. `/browse/crypto-sma` row #2
 * rendered "Synced 7h ago" over a return series whose last point was
 * 2026-05-06 — 112 days earlier — while THAT SAME STRATEGY's factsheet chip
 * read `Track record · old`. Row #1 was the same shape at 7 days. Two public,
 * unauthenticated surfaces contradicting each other about one strategy, and
 * the one a buyer sees FIRST was the one making the false claim.
 *
 * Both statements were literally true and the pair was a lie: "Synced" is a
 * claim about the JOB, and every reader takes it as a claim about the
 * STRATEGY. The fix does not delete the badge — sync recency is real
 * information — it stops presenting it as the ONLY clock.
 *
 * ⛔ THIS SPEC DELIBERATELY DOES NOT ROUTE THROUGH `is_example`. HONEST-03
 * scoped its stale-badge fix to example rows; all 15 examples were deleted
 * from production on 2026-08-26, so that gate now guards ZERO rows on this
 * surface. Every fixture below is `status: "published", is_example: false` —
 * a test written against the example gate would be vacuous by construction.
 */

import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { SyncBadge } from "./SyncBadge";
import { StrategyTable } from "./StrategyTable";
import { StrategyGrid } from "./StrategyGrid";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** The freshness dot is the only element carrying the `rounded-full` token. */
function dotClass(container: HTMLElement): string {
  const dot = container.querySelector("span.rounded-full");
  expect(dot).toBeTruthy();
  return dot!.className;
}

describe("SyncBadge — buckets on the staler of sync- and series-recency", () => {
  it("Test 1: a fresh job over a 112-day-dead series reads the SERIES, not the sync", () => {
    // The exact production shape: computed 7h ago, series ended 112d ago.
    const { container } = render(
      <SyncBadge computedAt={agoIso(7 * HOUR)} seriesEnd={agoIso(112 * DAY)} />,
    );

    // The dot buckets on the 112-day fact, not the 7-hour one.
    expect(dotClass(container)).toContain("bg-negative");
    // And the copy NAMES the subject that carried it there, mirroring
    // FreshnessChip's "Track record · old" — a stale dot beside "Synced 7h ago"
    // would merely relocate the contradiction into the same badge.
    expect(container.textContent).toMatch(/Track record/i);
    // The false claim is GONE, not merely recoloured.
    expect(container.textContent).not.toMatch(/Synced/);
  });

  it("Test 2: when the SYNC is the staler fact, the sync-keyed form is unchanged", () => {
    // computedAt 3d ago (stale on the 12h/48h ladder), series 1d ago.
    const { container } = render(
      <SyncBadge computedAt={agoIso(3 * DAY)} seriesEnd={agoIso(1 * DAY)} />,
    );

    expect(container.textContent).toMatch(/Synced 3d ago/);
    expect(container.textContent).not.toMatch(/Track record/i);
    expect(dotClass(container)).toContain("bg-negative");
  });

  it("Test 2b: a healthy row keeps its fresh dot and its sync-keyed copy", () => {
    // No regression on the rows that are actually fine — without this, a fix
    // that simply capped everything below fresh would pass Tests 1 and 3.
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={agoIso(1 * DAY)} />,
    );

    expect(container.textContent).toMatch(/Synced 2h ago/);
    expect(dotClass(container)).toContain("bg-positive");
  });

  it("Test 3: an UNKNOWN series end caps 'fresh' — it cannot support a freshness claim", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={null} />,
    );

    // Mirrors FreshnessChip's TONE_RANK, where `unknown` sits ABOVE `fresh`.
    expect(dotClass(container)).not.toContain("bg-positive");
    // …but it is not a stale CLAIM either — the job really did run 2h ago.
    expect(dotClass(container)).toContain("bg-amber-400");
    expect(container.textContent).toMatch(/Synced 2h ago/);
  });

  it("Test 3b: an UNKNOWN series end never ERASES a known-bad sync age", () => {
    // TONE_RANK's other half: `unknown` sits BELOW `stale`/`old`. Letting a
    // mere absence of series data soften a definite 5-day-old job would trade
    // a fact for a shrug.
    const { container } = render(
      <SyncBadge computedAt={agoIso(5 * DAY)} seriesEnd={null} />,
    );

    expect(dotClass(container)).toContain("bg-negative");
    expect(container.textContent).toMatch(/Synced 5d ago/);
  });

  it("Test 3c: an unparseable series end is treated as unknown, never as fine", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd="not-a-date" />,
    );

    expect(dotClass(container)).not.toContain("bg-positive");
  });

  it("Test 4: a null computedAt still renders nothing — the early return survives", () => {
    const { container } = render(
      <SyncBadge computedAt={null} seriesEnd={agoIso(112 * DAY)} />,
    );
    expect(container.textContent).toBe("");
  });
});

/**
 * ── WR-06 (163-REVIEW) — the FUTURE series end ──────────────────────────────
 *
 * THE DEFECT this block pins is a badge that CONTRADICTS ITSELF and then
 * contradicts the other public surface showing the same strategy:
 *
 *   - `bucketSeriesAge` mapped `days < 0` to `"stale"`, the WORST bucket, so a
 *     future point always bound and always painted the dot RED.
 *   - `timeAgo` computed `Math.floor((Date.now() - date) / 1000)`, which for a
 *     future date is NEGATIVE and therefore `< 60`, so the copy read
 *     "just now".
 *
 * The rendered pair was a red dot beside "Track record ends just now" — a
 * badge stating a catastrophe and a triviality about one date, in one span.
 *
 * AND IT DISAGREED WITH THE FACTSHEET. `bucketByAge` (the chip, at
 * app/factsheet/[id]/v2/FactsheetView.tsx:900-904) maps the SAME `days < 0` to
 * `"future"`, whose `toneColor` falls through to `var(--color-text-muted)` and
 * whose label is `"future — check data"` (:1004-1010). So the chip said
 * "neutral, check the data" while the list badge said "dead". Two public
 * surfaces disagreeing about one strategy's freshness is the exact class
 * HONEST-08 exists to close — and this was a new instance of it sitting on the
 * one boundary the "shared ladder" did not actually share.
 *
 * REALISTIC TRIGGER, not a contrived one: an MT5 broker on UTC+3 stamps a
 * daily bar with tomorrow's calendar date near 22:00 UTC.
 *
 * ⚠️ THESE ASSERTIONS ARE DELIBERATELY NOT ABOUT `bucketSeriesAge`'s RETURN
 * VALUE. Asserting the helper against itself would survive the bug — the whole
 * defect is that the helper's verdict and the rendered COPY described the same
 * date two incompatible ways. So every expectation below reads the rendered
 * dot class and the rendered sentence TOGETHER, which is the pairing a user
 * actually sees and the only place the contradiction is observable.
 *
 * ⭐ RED DEMONSTRATION (performed 2026-08-26, before the fix landed). Run
 * against the unfixed `freshness.ts` + `SyncBadge.tsx`, verbatim:
 *
 *     × WR-06: a future series end is never painted as the worst case
 *       → expected 'h-1.5 w-1.5 rounded-full shrink-0 bg-negative' not to
 *         contain 'bg-negative'
 *     × WR-06: the dot and the sentence never describe one date two ways
 *       → expected 'Track record ends just now' not to match /just now/i
 *     × WR-06: the badge agrees with the factsheet chip — no freshness claim,
 *       no staleness claim
 *       → expected 'h-1.5 w-1.5 rounded-full shrink-0 bg-negative' to contain
 *         'bg-amber-400'
 *     × WR-06: the real discovery TABLE row carries the same repaired pair
 *       → expected '#1Phoenix Protocol Fixture…just now…' not to match
 *         /just now/i
 *
 * The CONTROL below (`a sync timestamp seconds in the future is CLOCK SKEW`)
 * stayed GREEN under the unfixed code and must stay green under the fix: it is
 * what stops the repair from degenerating into "any negative delta is a
 * corruption", which would fire on every client whose clock trails the
 * server's by a second.
 *
 * ⚠️ THE TWO COLOUR EXPECTATIONS TRANSCRIBED ABOVE READ `bg-amber-400`, AND
 * THEY NO LONGER DO. That is a frozen record of the 2026-08-26 run and is left
 * unedited on purpose. 163-REVIEW finding 2 then established that WR-06's
 * repair had bought the RANK and not the COLOUR — `future` mapped onto `warm`
 * paints amber, the age colour, while the chip paints the same input muted —
 * and that the arm still split on a bare `days < 0` with no clock-skew grace.
 * Both are addressed below, and the RED for THAT round is transcribed on the
 * `WR-06 GRACE` spec.
 */
describe("WR-06 — a FUTURE series end is suspicious, never 'stale just now'", () => {
  /** A date `days` in the FUTURE (negative age). */
  function futureIso(days: number): string {
    return new Date(Date.now() + days * DAY).toISOString();
  }

  it("WR-06: a future series end is never painted as the worst case", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={futureIso(2)} />,
    );

    // A date we cannot have observed yet is not evidence of a DEAD strategy.
    expect(dotClass(container)).not.toContain("bg-negative");
    // Nor is it evidence of a live one.
    expect(dotClass(container)).not.toContain("bg-positive");
  });

  it("WR-06: the dot and the sentence never describe one date two ways", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={futureIso(2)} />,
    );

    // THE SELF-CONTRADICTION, pinned: "just now" is a claim of recency and it
    // may not appear for a date that has not happened.
    expect(container.textContent).not.toMatch(/just now/i);
    expect(container.textContent).toMatch(/in the future/i);
    // The subject is still NAMED, so the badge says WHICH fact it is unsure
    // about rather than silently recolouring the sync copy.
    expect(container.textContent).toMatch(/Track record ends/i);
  });

  it("WR-06: the badge agrees with the factsheet chip — no freshness claim, no staleness claim", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={futureIso(2)} />,
    );

    // ⛔ MUTED, NOT AMBER (163-REVIEW, finding 2). WR-06's first repair mapped
    // `future` onto `warm` and stopped there, which bought the RANK but painted
    // the dot amber — the colour this product uses everywhere else to mean
    // "getting old". The chip renders the identical input in
    // `--color-text-muted` under "future — check data", making NEITHER claim.
    // So the badge saying "going stale" while the factsheet said "check the
    // data" was the same two-surface disagreement WR-06 was opened to close,
    // one shade further in. `bg-text-muted` resolves to that same custom
    // property, so the two now answer one input with one colour.
    expect(dotClass(container)).toContain("bg-text-muted");
    // And explicitly not the age colour it used to borrow.
    expect(dotClass(container)).not.toContain("bg-amber-400");
  });

  /**
   * ⭐ THE GRACE CONTROL, and it is the assertion that actually fails without
   * the fix. WR-06's repair split on `days < 0` EXACTLY, so a series end one
   * second ahead of this server's clock took the future arm and BOUND over a
   * job that had just succeeded — an amber dot over a strategy that
   * `computeFreshness` and `timeAgo`, reading the same instant through
   * `CLOCK_SKEW_TOLERANCE_MINUTES`, both called fresh. Three readers of one
   * instant, one of them still using a bare zero.
   */
  it("WR-06 GRACE: a series end seconds ahead is CLOCK SKEW, not a future date", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(2 * HOUR)}
        seriesEnd={new Date(Date.now() + 30_000).toISOString()}
      />,
    );

    // Within tolerance the series is a CURRENT bar, so it neither binds nor
    // recolours: the honest render is the sync-keyed one, in green.
    expect(dotClass(container)).toContain("bg-positive");
    expect(dotClass(container)).not.toContain("bg-text-muted");
    expect(container.textContent).toMatch(/Synced 2h ago/);
    expect(container.textContent).not.toMatch(/Track record/i);
  });

  /**
   * The grace's other edge. Without this, "tolerate skew" could degenerate into
   * "tolerate any future date", which would launder a corrupt write into a
   * freshness claim — the failure mode WR-06 itself warned about.
   */
  it("WR-06 GRACE CONTROL: beyond the tolerance it is still a future date", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(2 * HOUR)}
        // An hour ahead is an order of magnitude past the tolerated drift.
        seriesEnd={new Date(Date.now() + HOUR).toISOString()}
      />,
    );

    expect(dotClass(container)).toContain("bg-text-muted");
    expect(container.textContent).toMatch(/Track record ends in the future/i);
  });

  /**
   * The OTHER control the grace must not break: a genuinely dead track record
   * is still dead. A repair that softened the whole series arm would pass every
   * assertion above and quietly delete the requirement.
   */
  it("WR-06 STALE CONTROL: a genuinely old series end still buckets stale", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={agoIso(112 * DAY)} />,
    );

    expect(dotClass(container)).toContain("bg-negative");
    expect(dotClass(container)).not.toContain("bg-text-muted");
    expect(container.textContent).toMatch(/Track record ends 112d ago/);
  });

  /**
   * The one place a series verdict is allowed to override a DEFINITE bad sync
   * age, and the reason it is allowed: `TONE_RANK` puts the chip's `future`
   * above its `old`, because a date that has not happened impeaches the INPUT
   * rather than merely aging it. Ranking it as a mere middle bucket would have
   * left the badge saying "Synced 5d ago" in red where the factsheet said
   * "Track record · future — check data" in grey — the two surfaces naming
   * different subjects for one row.
   */
  it("WR-06: a future series end binds even over a known-bad sync age", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(5 * DAY)} seriesEnd={futureIso(2)} />,
    );

    expect(dotClass(container)).toContain("bg-text-muted");
    expect(container.textContent).toMatch(/Track record ends in the future/i);
    // The sync fact is NOT discarded — it moves into the tooltip, exactly as
    // on the ordinary series arm.
    expect(container.querySelector("span")?.getAttribute("title")).toMatch(
      /Analytics last computed 5d ago/,
    );
  });

  it("WR-06 CONTROL: a sync timestamp seconds in the future is CLOCK SKEW, not corruption", () => {
    // `computeFreshness` has tolerated <5min of writer/reader drift as `fresh`
    // since it was written, because a browser clock trailing the server's by a
    // second or two is ordinary. The copy must not contradict that verdict by
    // announcing "in the future" on the same render — that would trade one
    // self-contradiction for another, and would fire on real users.
    const { container } = render(
      <SyncBadge
        computedAt={new Date(Date.now() + 3_000).toISOString()}
        seriesEnd={agoIso(1 * DAY)}
      />,
    );

    expect(dotClass(container)).toContain("bg-positive");
    expect(container.textContent).toMatch(/Synced just now/);
    expect(container.textContent).not.toMatch(/in the future/i);
  });

  it("WR-06: the real discovery TABLE row carries the same repaired pair", () => {
    // Through the mount a visitor actually travels, not the bare component.
    const row = publishedRow("11111111-0000-4000-8000-000000000003", PHOENIX, {
      computed_at: agoIso(7 * HOUR),
      // Tomorrow's calendar date — the UTC+3 broker case.
      series_end: new Date(Date.now() + DAY).toISOString().slice(0, 10),
    });

    const { container } = render(
      <StrategyTable strategies={[row]} categorySlug="crypto-sma" />,
    );

    expect(container.textContent).not.toMatch(/just now/i);
    expect(container.querySelector(".bg-negative")).toBeNull();
    expect(container.querySelector(".bg-positive")).toBeNull();
    // The chip's muted grey, through the real table mount — see the colour
    // note on "the badge agrees with the factsheet chip" above.
    expect(container.querySelector(".bg-text-muted")).toBeTruthy();
    expect(container.querySelector(".bg-amber-400")).toBeNull();
  });
});

// ── The regression proper: the REAL mount paths, a REAL published row ───────

const PHOENIX = "Phoenix Protocol Fixture";
const HEALTHY = "Healthy Control Fixture";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

function makeAnalytics(over: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: agoIso(7 * HOUR),
    computing_started_at: null,
    // TERMINAL SUCCESS, deliberately. A `failed` row is already blanked
    // upstream by STALE-01's `shapeRowAnalytics`, so testing this on one would
    // prove the OTHER fix. The production subject was a healthy, still-polling
    // job — which is exactly why nothing caught it.
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    series_end: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...over,
  };
}

type Row = Strategy & { analytics: StrategyAnalytics };

function publishedRow(
  id: string,
  name: string,
  analytics: Partial<StrategyAnalytics>,
): Row {
  return {
    id,
    name,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    // ⛔ THE TWO FIELDS THIS SPEC LIVES OR DIES ON. HONEST-03's stale-badge
    // fix was scoped to `is_example` rows and all 15 examples were deleted
    // from production on 2026-08-26, so that gate guards ZERO rows on this
    // surface. A fixture that opted into it would pass through a code path no
    // real row can reach — vacuous by construction (163-CONTEXT lock).
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    trust_tier: null,
    analytics: makeAnalytics({ ...analytics, strategy_id: id }),
  } as Row;
}

/** The measured production shape: computed 7h ago, series ended 112d ago. */
function deadTrackRow(): Row {
  return publishedRow("11111111-0000-4000-8000-000000000001", PHOENIX, {
    computed_at: agoIso(7 * HOUR),
    series_end: isoDaysAgo(112),
  });
}

/** The control: same fresh job, but a track record that is actually alive. */
function healthyRow(): Row {
  return publishedRow("11111111-0000-4000-8000-000000000002", HEALTHY, {
    computed_at: agoIso(2 * HOUR),
    series_end: isoDaysAgo(1),
  });
}

/**
 * HONEST-08 regression — the production defect, through the paths a visitor
 * actually travels.
 *
 * ⭐ RED DEMONSTRATION (performed 2026-08-26, then restored). The mutation:
 * in `src/components/strategy/SyncBadge.tsx`, bypass the shared resolver so
 * the badge classifies on `computedAt` alone —
 *
 *     -  const recency = resolveEffectiveRecency(computedAt, seriesEnd);
 *     -  const dotColor = FRESHNESS_COLORS[recency.freshness].dot;
 *     +  const recency = { freshness: computeFreshness(date),
 *     +                    subject: "sync" as const, seriesEndDate: null };
 *     +  const dotColor = FRESHNESS_COLORS[recency.freshness].dot;
 *
 * — i.e. exactly the code that shipped to production. Observed, verbatim,
 * `Tests  5 failed | 4 passed (9)`:
 *
 *     × the discovery TABLE makes no fresh sync claim over a 112-day-dead series
 *       → expected '#1Phoenix Protocol FixtureLong-OnlyBi…' not to match /Synced/
 *     × the discovery GRID card is guarded identically (both render paths)
 *       → expected [ 'Synced', 'Synced' ] to have a length of 1 but got 2
 *     × Test 1: a fresh job over a 112-day-dead series reads the SERIES
 *       → expected 'h-1.5 w-1.5 rounded-full shrink-0 bg-…' to contain 'bg-negative'
 *     × Test 3 / Test 3c: an unknown series end caps 'fresh'
 *       → expected '…rounded-full shrink-0 bg-…' not to contain 'bg-positive'
 *
 * The four CONTROL assertions (Tests 2, 2b, 3b, 4 — the healthy row keeps its
 * green dot and its "Synced 2h ago", a known-bad sync age still binds, the
 * null-computedAt early return holds) stayed GREEN under the mutation. That is
 * what proves this spec DISCRIMINATES between the two rows rather than merely
 * asserting the badge is globally broken.
 *
 * Restore verified two ways: `shasum` of SyncBadge.tsx back to its pre-neuter
 * digest, and `grep -c resolveEffectiveRecency` back to 3.
 */
describe("HONEST-08 — the production row, through StrategyTable and StrategyGrid", () => {
  function tableRowFor(container: HTMLElement, name: string): HTMLElement {
    const cell = within(container).getByText(name);
    const row = cell.closest("tr");
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  it("the discovery TABLE makes no fresh sync claim over a 112-day-dead series", () => {
    const { container } = render(
      <StrategyTable
        strategies={[deadTrackRow(), healthyRow()]}
        categorySlug="crypto-sma"
      />,
    );

    const dead = tableRowFor(container, PHOENIX);
    // The production render — "Synced 7h ago" — is gone.
    expect(dead.textContent).not.toMatch(/Synced/);
    // Replaced by a claim about the fact that actually binds, mirroring the
    // factsheet chip's `Track record · old`. The two public surfaces now agree.
    expect(dead.textContent).toMatch(/Track record ends/i);
    expect(dead.querySelector(".bg-positive")).toBeNull();
    expect(dead.querySelector(".bg-negative")).toBeTruthy();

    // THE CONTROL, and it is what stops this passing on a globally dead badge:
    // a row with the same terminal-success analytics and a LIVE series keeps
    // its sync-keyed copy and its green dot, in the same render.
    const healthy = tableRowFor(container, HEALTHY);
    expect(healthy.textContent).toMatch(/Synced 2h ago/);
    expect(healthy.querySelector(".bg-positive")).toBeTruthy();
  });

  it("the discovery GRID card is guarded identically (both render paths)", () => {
    // HONEST-03 precedent: cover both paths so the class cannot re-open
    // through whichever one a future page happens to mount.
    const { container } = render(
      <StrategyGrid
        strategies={[deadTrackRow(), healthyRow()]}
        categorySlug="crypto-sma"
      />,
    );

    // Exactly ONE "Synced" claim across the grid, and it belongs to the row
    // whose track record is alive.
    expect(container.textContent?.match(/Synced/g) ?? []).toHaveLength(1);
    expect(container.textContent).toMatch(/Synced 2h ago/);
    expect(container.textContent).toMatch(/Track record ends/i);
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
  });
});
