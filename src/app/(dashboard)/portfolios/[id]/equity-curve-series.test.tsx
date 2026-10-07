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
      "Equity curves shown for 2 of 3 strategies — 1 without a usable return series is omitted.",
    );
    expect(caption).toBeTruthy();
    // Exactly ONE caption — a second disclosure line would be a second claim.
    expect(
      screen.getAllByText(/Equity curves shown for/),
    ).toHaveLength(1);
  });

  /**
   * IN-03 (162-REVIEW) — the counters are computed, so the sentence around them
   * has to agree with whatever they come out as. The caption read "… — 1
   * without a usable return series ARE omitted." at every one-omitted
   * portfolio, and "0 of 1 STRATEGIES" for a single-strategy portfolio whose
   * only curve is missing.
   *
   * ⭐ Pins the CLAIM, not a word: the expectation is derived from the numbers
   * the sentence itself reports, so it holds for shapes no fixture here
   * enumerates. Neuter to redden: hardcode either ternary back to its plural
   * branch.
   */
  it("Test 5b: the caption agrees in number with the counters it reports", async () => {
    const { EquityCurveCoverage } = await import(PAGE);
    const AGREEMENT =
      /^Equity curves shown for (\d+) of (\d+) (strategy|strategies) — (\d+) without a usable return series (is|are) omitted\.$/;

    // Every reachable shape: total===1 (only possible with shown===0, because
    // shown===total returns null), one omitted of several, all omitted, and
    // several omitted.
    const shapes = [
      [withoutCurve("a")],
      [withCurve("a"), withCurve("b"), withoutCurve("c")],
      [withoutCurve("a"), withoutCurve("b"), withoutCurve("c")],
      [withCurve("a"), withoutCurve("b"), withoutCurve("c")],
    ];

    for (const series of shapes) {
      const { container, unmount } = render(
        <EquityCurveCoverage series={series} />,
      );
      const text = container.textContent ?? "";
      const m = AGREEMENT.exec(text);
      expect(
        m,
        `the caption no longer matches the C-3 shape, so nothing below is being checked: ${text}`,
      ).toBeTruthy();
      const total = Number(m![2]);
      const noun = m![3];
      const omitted = Number(m![4]);
      const verb = m![5];
      expect(
        noun,
        `"${total} ${noun}" disagrees in number: ${text}`,
      ).toBe(total === 1 ? "strategy" : "strategies");
      expect(
        verb,
        `"${omitted} … ${verb} omitted" disagrees in number: ${text}`,
      ).toBe(omitted === 1 ? "is" : "are");
      unmount();
    }
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
        "Equity curves shown for 1 of 2 strategies — 1 without a usable return series is omitted.",
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
        "Equity curves shown for 1 of 2 strategies — 1 without a usable return series is omitted.",
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
      "Equity curves shown for 1 of 2 strategies — 1 without a usable return series is omitted.",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 164.6.6.2 plan 09 (D-18, D-22) — a BTC constituent is drawn in USD.
//
// WHY: the portfolio chart's axis is USD wealth. A BTC account's own wealth
// curve is in BTC, so plotting it beside USD strategies puts two units on one
// axis and no label says so. The constituent's curve is rebuilt from its daily
// returns converted at the daily BTC close. Expected values are hand-computed
// literals: NAV 1.0 -> 1.1 in BTC with closes 60000 -> 66000 is
// (1.1 * 66000) / (1.0 * 60000) - 1 = 0.21, so the cumprod curve ends at 1.21.
// ---------------------------------------------------------------------------
describe("164.6.6.2 — a BTC constituent's equity curve is its USD curve", () => {
  const CLOSES = {
    prices: [
      { date: "2026-01-01", close: 60000 },
      { date: "2026-01-02", close: 66000 },
    ],
    dropped: [] as string[],
  };
  const nativeAnalytics = {
    computation_status: "complete",
    computed_at: "2026-01-02T00:00:00Z",
    cagr: 0.2,
    sharpe: 1.1,
    returns_series: null,
    daily_returns: [
      { date: "2026-01-01", value: 0.03 },
      { date: "2026-01-02", value: 0.1 },
    ],
    data_quality_flags: { native_unit: "BTC" },
  };

  it("cumprods the CONVERTED daily series: [{d1, 1.21}], day 0 dropped", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries([row("btc", "BTC book", nativeAnalytics)], CLOSES);
    expect(out[0].equityCurve).toHaveLength(1);
    expect(out[0].equityCurve![0].date).toBe("2026-01-02");
    expect(out[0].equityCurve![0].value).toBeCloseTo(1.21, 12);
  });

  it("parity: the curve is the cumprod of convertNativeReturnsToUsd on the same inputs", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const { convertNativeReturnsToUsd } = await import("@/lib/factsheet/native-to-usd");
    const converted = convertNativeReturnsToUsd(nativeAnalytics.daily_returns, "BTC", CLOSES);
    let c = 1;
    const expected = converted.map((p: { date: string; value: number }) => {
      c *= 1 + p.value;
      return { date: p.date, value: c };
    });
    const out = buildEquityCurveSeries([row("btc", "BTC book", nativeAnalytics)], CLOSES);
    expect(out[0].equityCurve).toEqual(expected);
  });

  it("a persisted BTC wealth curve is converted from the resolved daily series, never plotted as-is", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const btcWealth = [
      { date: "2026-01-01", value: 1.0 },
      { date: "2026-01-02", value: 1.1 },
      { date: "2026-01-03", value: 1.21 },
    ];
    const closes = {
      prices: [
        { date: "2026-01-01", close: 55000 },
        { date: "2026-01-02", close: 60000 },
        { date: "2026-01-03", close: 66000 },
      ],
      dropped: [] as string[],
    };
    const out = buildEquityCurveSeries(
      [
        row("btc", "BTC book", {
          ...nativeAnalytics,
          returns_series: btcWealth,
          daily_returns: null,
        }),
      ],
      closes,
    );
    // Resolved daily = [{01-02, 0.1}, {01-03, 0.1}]; day 0 (01-02) is dropped by
    // the conversion; 01-03 is (1.1 * 66000) / (1.0 * 60000) - 1 = 0.21.
    expect(out[0].equityCurve).not.toEqual(btcWealth);
    expect(out[0].equityCurve).toHaveLength(1);
    expect(out[0].equityCurve![0].date).toBe("2026-01-03");
    expect(out[0].equityCurve![0].value).toBeCloseTo(1.21, 12);
  });

  it("a USD constituent beside it is unchanged", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries(
      [row("usd", "Live", liveAnalytics), row("btc", "BTC book", nativeAnalytics)],
      CLOSES,
    );
    expect(out[0].equityCurve).toEqual([
      { date: "2026-02-01", value: 1 },
      { date: "2026-02-02", value: 1.02 },
      { date: "2026-02-03", value: 1.06 },
    ]);
  });

  it("closes unavailable: the BTC constituent has NO line (null), never its raw BTC curve", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    expect(
      buildEquityCurveSeries([row("btc", "BTC book", nativeAnalytics)], null)[0].equityCurve,
    ).toBeNull();
    // ...and the default (no closes argument at all) is the same honest answer.
    expect(
      buildEquityCurveSeries([row("btc", "BTC book", nativeAnalytics)])[0].equityCurve,
    ).toBeNull();
  });

  it("a malformed native_unit reads as USD: the series is drawn as it is", async () => {
    const { buildEquityCurveSeries } = await import(PAGE);
    const out = buildEquityCurveSeries(
      [row("x", "Odd", { ...nativeAnalytics, data_quality_flags: { native_unit: "btc" } })],
      CLOSES,
    );
    expect(out[0].equityCurve).toHaveLength(2);
    expect(out[0].equityCurve![1].value).toBeCloseTo(1.03 * 1.1, 12);
  });

  it("stripConstituentSeries never lets the raw data_quality_flags blob cross to the client", async () => {
    const { stripConstituentSeries } = await import(PAGE);
    const out = stripConstituentSeries([
      row("btc", "BTC book", {
        ...nativeAnalytics,
        data_quality_flags: { native_unit: "BTC", degraded_members: ["okx:BTC"] },
      }),
    ]);
    const analytics = out[0].strategies!.strategy_analytics as Record<string, unknown>;
    expect("data_quality_flags" in analytics).toBe(false);
    expect(JSON.stringify(out)).not.toContain("degraded_members");
    expect(JSON.stringify(out)).not.toContain("native_unit");
  });

  it("hasNativeUnitConstituent: true only for a well-formed unit (the page reads closes only then)", async () => {
    const { hasNativeUnitConstituent } = await import(PAGE);
    expect(hasNativeUnitConstituent([row("u", "USD", liveAnalytics)])).toBe(false);
    expect(
      hasNativeUnitConstituent([
        row("x", "Odd", { ...nativeAnalytics, data_quality_flags: { native_unit: "btc" } }),
      ]),
    ).toBe(false);
    expect(hasNativeUnitConstituent([row("b", "BTC", nativeAnalytics)])).toBe(true);
  });
});
