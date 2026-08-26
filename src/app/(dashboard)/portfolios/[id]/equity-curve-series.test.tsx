/**
 * Phase 162 / HONEST-04 — per-strategy equity curves on the portfolio dashboard.
 *
 * The class this spec exists to keep closed (STALE-01, hotfixed on PROD in
 * #712): a `failed` analytics row still holds the numbers AND the series of an
 * earlier attempt. 159-CENSUS measured 17 of 18 published strategies carrying
 * exactly that corpse, which is why every fixture below that must NOT render
 * carries a FULL, best-in-class stale payload — a plausible sharpe, a plausible
 * cagr, and a complete returns_series sitting right there. A null/empty check
 * passes all of them. Only the status gate refuses them, so if the gate is ever
 * removed or bypassed these tests fail loudly instead of quietly drawing a dead
 * run's line beside live ones.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// page.tsx is an RSC module: `server-only` throws on import outside an RSC
// render, and the supabase server client must not be constructed for real.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

const PAGE = "@/app/(dashboard)/portfolios/[id]/page";

/** A complete, plausible wealth curve — the thing a dead run leaves behind. */
const STALE_SERIES = [
  { date: "2026-01-01", value: 1 },
  { date: "2026-01-02", value: 1.4 },
  { date: "2026-01-03", value: 2.1 },
];

const LIVE_SERIES = [
  { date: "2026-02-03", value: 1.06 },
  { date: "2026-02-01", value: 1 },
  { date: "2026-02-02", value: 1.02 },
];

function row(
  id: string,
  name: string,
  analytics: Record<string, unknown> | null,
) {
  return {
    strategy_id: id,
    current_weight: 0.5,
    allocated_amount: 1000,
    strategies: { id, name, strategy_analytics: analytics },
  };
}

/** Terminal-success analytics carrying the persisted wealth curve. */
const liveAnalytics = {
  computation_status: "complete",
  computed_at: "2026-02-03T00:00:00Z",
  cagr: 0.12,
  sharpe: 1.1,
  returns_series: LIVE_SERIES,
  daily_returns: null,
};

/**
 * The corpse. Terminal FAILURE — but every value a null-check would look at is
 * present and attractive.
 */
const failedButRichAnalytics = {
  computation_status: "failed",
  computed_at: "2026-01-03T00:00:00Z",
  cagr: 3.4,
  sharpe: 4.2,
  max_drawdown: -0.01,
  returns_series: STALE_SERIES,
  daily_returns: { "2026": { "01-02": 0.4, "01-03": 0.5 } },
};

describe("HONEST-04 — buildEquityCurveSeries", () => {
  it("Test 1: renders a sorted wealth curve for a terminal-success constituent", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([row("s1", "Live", liveAnalytics)]);
    expect(out).toHaveLength(1);
    expect(out[0].equityCurve).toEqual([
      { date: "2026-02-01", value: 1 },
      { date: "2026-02-02", value: 1.02 },
      { date: "2026-02-03", value: 1.06 },
    ]);
  });

  it("Test 2: a FAILED constituent holding a full stale series renders NO curve", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([
      row("dead", "Dead run", failedButRichAnalytics),
    ]);
    expect(out).toHaveLength(1);
    // Not [] — null. The chart skips null; an empty array would still be a
    // claim that we looked and found nothing, and the values below prove we
    // DID find something and refused it on status alone.
    expect(out[0].equityCurve).toBeNull();
    // Pin the premise: the corpse really was sitting there. If a future fixture
    // edit strips these, Test 2 would pass vacuously.
    expect(failedButRichAnalytics.returns_series).toHaveLength(3);
    expect(failedButRichAnalytics.sharpe).toBeGreaterThan(0);
  });

  it("Test 2b: non-terminal (computing/pending) constituents render NO curve either", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    for (const status of ["computing", "pending"]) {
      const out = buildEquityCurveSeries([
        row(status, status, { ...failedButRichAnalytics, computation_status: status }),
      ]);
      expect(out[0].equityCurve).toBeNull();
    }
  });

  it("Test 2c: complete_with_warnings is a terminal SUCCESS and still renders", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([
      row("warn", "Warned", {
        ...liveAnalytics,
        computation_status: "complete_with_warnings",
      }),
    ]);
    expect(out[0].equityCurve).toHaveLength(3);
  });

  it("Test 3: a CSV constituent (daily_returns only) renders the cumprod wealth curve", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([
      row("csv", "CSV strategy", {
        computation_status: "complete",
        computed_at: "2026-03-03T00:00:00Z",
        returns_series: null,
        daily_returns: [
          { date: "2026-03-01", value: 0.1 },
          { date: "2026-03-02", value: 0.1 },
        ],
      }),
    ]);
    const curve = out[0].equityCurve!;
    expect(curve).toHaveLength(2);
    expect(curve[0]).toEqual({ date: "2026-03-01", value: 1.1 });
    expect(curve[1].date).toBe("2026-03-02");
    // Wealth, not returns: 1.1 * 1.1 — the fold compounds rather than summing.
    expect(curve[1].value).toBeCloseTo(1.21, 10);
  });

  it("Test 3b: a rankable row with NO series at all renders null, not a flat line", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([
      row("bare", "No series", {
        computation_status: "complete",
        computed_at: "2026-03-03T00:00:00Z",
        cagr: 0.2,
        sharpe: 1.5,
        returns_series: null,
        daily_returns: null,
      }),
    ]);
    expect(out[0].equityCurve).toBeNull();
  });

  it("Test 4: no raw returns_series / daily_returns crosses the RSC boundary", async () => {
    const { stripConstituentSeries } = await import(PAGE);
    const input = [
      row("s1", "Live", liveAnalytics),
      row("dead", "Dead run", failedButRichAnalytics),
      row("embedArray", "Array embed", null),
    ];
    // PostgREST hands a one-to-many embed back as an array — cover both shapes.
    input[2].strategies.strategy_analytics = [
      liveAnalytics,
    ] as unknown as Record<string, unknown>;

    const out = stripConstituentSeries(input);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("returns_series");
    expect(serialized).not.toContain("daily_returns");
    // The strip is a narrowing, not a wipe: scalars survive.
    expect(serialized).toContain("sharpe");
    // Non-destructive — the server-side source the curves were built from is
    // untouched, so the strip cannot retroactively blank the chart.
    expect(JSON.stringify(input)).toContain("returns_series");
  });
});

/**
 * UI-SPEC C-3 disclosure row. The chart's absence-of-a-line is NOT allowed to
 * be the only signal — a missing curve that says nothing about itself is the
 * silent half of the same dishonesty. The caption is the accessible disclosure,
 * and it is colorless: absence is a neutral fact, not an error and not a
 * warning (DESIGN.md semantic-color gates).
 */
describe("HONEST-04 / C-3 — EquityCurveCoverage caption", () => {
  const withCurve = (id: string) => ({
    id,
    name: id,
    equityCurve: [{ date: "2026-01-01", value: 1 }],
  });
  const withoutCurve = (id: string) => ({ id, name: id, equityCurve: null });

  it("Test 5: m=3 / n=2 renders the exact C-3 copy with the numbers attached", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    render(
      <EquityCurveCoverage
        series={[withCurve("a"), withCurve("b"), withoutCurve("c")]}
      />,
    );
    const caption = screen.getByText(
      "Equity curves shown for 2 of 3 strategies — 1 without a usable return series are omitted.",
    );
    expect(caption).toBeTruthy();
    // Exactly ONE caption — a second disclosure line would be a second claim.
    expect(
      screen.getAllByText(/Equity curves shown for/),
    ).toHaveLength(1);
  });

  it("Test 6a: n === m renders NO caption (nothing to disclose)", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    const { container } = render(
      <EquityCurveCoverage series={[withCurve("a"), withCurve("b")]} />,
    );
    expect(container.textContent).toBe("");
  });

  it("Test 6b: n === 0 STILL renders the caption (composite line only)", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    render(
      <EquityCurveCoverage
        series={[withoutCurve("a"), withoutCurve("b"), withoutCurve("c")]}
      />,
    );
    expect(
      screen.getByText(
        "Equity curves shown for 0 of 3 strategies — 3 without a usable return series are omitted.",
      ),
    ).toBeTruthy();
  });

  it("Test 6c: an EMPTY curve array counts as omitted, not as shown", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    render(
      <EquityCurveCoverage
        series={[withCurve("a"), { id: "b", name: "b", equityCurve: [] }]}
      />,
    );
    // The chart skips empty arrays exactly as it skips null, so the count the
    // caption reports has to agree with what the chart actually drew.
    expect(
      screen.getByText(
        "Equity curves shown for 1 of 2 strategies — 1 without a usable return series are omitted.",
      ),
    ).toBeTruthy();
  });

  it("Test 7: the caption is text-caption text-text-muted and colorless", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    const { container } = render(
      <EquityCurveCoverage series={[withCurve("a"), withoutCurve("b")]} />,
    );
    const p = container.querySelector("p");
    expect(p).toBeTruthy();
    const cls = p!.className;
    expect(cls).toContain("text-caption");
    expect(cls).toContain("text-text-muted");
    // No semantic tone may attach to absence.
    for (const banned of [
      "text-negative",
      "text-accent",
      "text-amber",
      "text-red",
      "bg-negative",
      "text-positive",
    ]) {
      expect(cls).not.toContain(banned);
    }
  });

  it("Test 7b: the caption counts the SAME array the curve builder produced", async () => {
    const { buildEquityCurveSeries, EquityCurveCoverage } = await import(PAGE);
    // One live constituent, one corpse — the caption must report 1 of 2 without
    // re-deriving the count from the raw rows (one source of truth).
    const series = buildEquityCurveSeries([
      row("s1", "Live", liveAnalytics),
      row("dead", "Dead run", failedButRichAnalytics),
    ]);
    render(<EquityCurveCoverage series={series} />);
    expect(
      screen.getByText(
        "Equity curves shown for 1 of 2 strategies — 1 without a usable return series are omitted.",
      ),
    ).toBeTruthy();
  });

  /**
   * Phase 162 silent-failure audit (A-1) — the caption may not name a cause the
   * code never tested.
   *
   * There are TWO ways into the omitted set, and the old copy ("without
   * computed analytics") described only the first:
   *
   *   1. `isRankableAnalyticsRow(a)` false — the STALE-01 status gate. Covered
   *      by Tests 2 / 2b above.
   *   2. `isRankableAnalyticsRow(a)` TRUE, but `buildWealthPoints` still
   *      returns null because neither `returns_series` nor `daily_returns` was
   *      usable — a terminal-success row whose series write was skipped.
   *
   * A bucket-2 row HAS computed analytics: its CAGR and Sharpe are rendering in
   * the Strategy Breakdown table on the same page. The old caption therefore
   * stood next to its own counter-example. The fixture below is exactly that
   * row, and the assertions pin BOTH halves — that it is genuinely rankable
   * (otherwise this test would be a duplicate of Test 2, passing for the wrong
   * reason), and that the sentence claims only the predicate that was
   * evaluated.
   */
  it("Test 7c: a RANKABLE row with no usable series is omitted — and the caption does not blame its analytics", async () => {
    const { buildEquityCurveSeries, EquityCurveCoverage } = await import(PAGE);
    const { isRankableAnalyticsRow } = await import("@/lib/closed-sets");

    /** Terminal SUCCESS, real headline metrics, and no series to draw. */
    const rankableButSeriesless = {
      computation_status: "complete_with_warnings",
      computed_at: "2026-02-03T00:00:00Z",
      cagr: 0.12,
      sharpe: 1.1,
      returns_series: null,
      daily_returns: null,
    };

    // Premise, pinned: this row is on the ALLOWED side of the status gate. If a
    // future edit made it non-rankable, the test below would still pass while
    // proving nothing about bucket 2.
    expect(isRankableAnalyticsRow(rankableButSeriesless)).toBe(true);
    // ...and it carries the very metrics the breakdown table renders, which is
    // what made "without computed analytics" false about it.
    expect(rankableButSeriesless.sharpe).toBeGreaterThan(0);

    const series = buildEquityCurveSeries([
      row("s1", "Live", liveAnalytics),
      row("seriesless", "No series", rankableButSeriesless),
    ]);
    // It really is in the omitted set — via bucket 2, not the status gate.
    expect(series[1].equityCurve).toBeNull();

    const { container } = render(<EquityCurveCoverage series={series} />);
    // FIRST, and on its own: the retired claim has no render path. This is the
    // assertion the fix owns — the omitted row's analytics ARE computed, so
    // naming them as the cause is a statement the code did not test and this
    // row disproves. Ordered ahead of the exact-copy pin deliberately, so a
    // revert of the copy fails on the LIE rather than on the wording.
    expect(
      container.textContent,
      "the caption blamed 'computed analytics' for a row whose analytics are computed and rendering in the breakdown table",
    ).not.toContain("without computed analytics");
    expect(container.textContent).toBe(
      "Equity curves shown for 1 of 2 strategies — 1 without a usable return series are omitted.",
    );
  });
});
