import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { ComputedMetrics } from "@/lib/scenario";
import { captureToSentry } from "@/lib/sentry-capture";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

/**
 * Phase 09.1 / Plan 06 (D-09) — KpiStrip shape tests.
 * Phase 64 / PRESENT-01 — re-pointed from the 5-cell (AUM-led) shape to the
 * 4-cell return-form shape (AUM removed from presentation).
 *
 * Sister suite to `KpiStrip.warmup.test.tsx` (Phase 07 invariants), which
 * is preserved verbatim and must continue passing in parallel. This file
 * locks the designer shape:
 *   1. 4 cells in order: YTD TWR / Sharpe / Max DD 12m / Avg |ρ|
 *   2. Numeric formatting via formatPercent / formatNumber / formatCurrency
 *   3. R4 honest Avg |ρ| null-path: "Requires per-holding correlation data
 *      (pending)" when analytics.avg_correlation is null
 *   4. Stale path beats pending-copy on every cell
 *   5. Warmup precedence beats pending-copy on Avg |ρ|
 *
 * Fixture builder mirrors the warmup test for consistency.
 */

// Empty ComputedMetrics skeleton — all numerics null so cells default to
// the analytics-derived path or fall through to em-dash.
const EMPTY_METRICS: ComputedMetrics = {
  n: 0,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: null,
  effective_end: null,
};

describe("KpiStrip — designer 4-cell return-form shape (D-09 · Phase 64/PRESENT-01)", () => {
  // Phase 64 / PRESENT-01: the AUM cell left the strip (a position-space dollar
  // figure removed from presentation — the scenario-tab analog of the share
  // page's existing "No USD, no AUM" contract). The strip is now return-form
  // only: YTD TWR / Sharpe / Max DD 12m / Avg |ρ|, in that order.
  it("renders exactly 4 cells with the labels in canonical order (no AUM)", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );

    const labels = ["YTD TWR", "Sharpe", "Max DD 12m", "Avg |ρ|"];
    const group = screen.getByRole("group", { name: "Portfolio KPIs" });
    // The grid maps exactly one wrapper <div> per cell; count them directly so
    // the 4-cell contract fails loud against a 5-cell strip (the RED anchor).
    const cells = Array.from(group.children);
    expect(cells.length).toBe(4);
    // Order is asserted off each cell's first descendant div (the label div).
    const renderedLabels = cells.map(
      (c) => c.querySelector("div")?.textContent ?? null,
    );
    expect(renderedLabels).toEqual(labels);
  });

  // Phase 64 / PRESENT-01 negative pin: no cell is labeled "AUM" and no
  // dollar-formatted value renders in live mode. Red pre-implementation —
  // the AUM cell and its "$1.0M" value currently render.
  it("renders no AUM cell and no dollar-formatted value (live mode)", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(screen.queryByText("AUM")).toBeNull();
    const group = screen.getByRole("group", { name: "Portfolio KPIs" });
    const valueDivs = Array.from(
      group.querySelectorAll<HTMLDivElement>("div.font-mono"),
    );
    for (const v of valueDivs) {
      expect(v.textContent ?? "").not.toMatch(/\$/);
    }
  });

  it("formats YTD TWR via formatPercent (0.12 → '+12.00%')", () => {
    render(
      <KpiStrip
        analytics={{ ytd_twr: 0.12 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("+12.00%")).toBeTruthy();
  });

  it("formats Sharpe via formatNumber (1.73 → '1.73')", () => {
    render(
      <KpiStrip
        analytics={{ sharpe: 1.73 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("1.73")).toBeTruthy();
  });

  // M-0086 label-truth — the Sharpe value is computeScenario's annualized
  // Sharpe over the SELECTED timeframe / full holdings history, NOT a fixed
  // trailing 12 months. The sub-copy must say so; the prior "12-month
  // risk-adjusted return" string was a lie an allocator would trust.
  it("M-0086: Sharpe sub-copy is window-honest, not the false '12-month' label", () => {
    render(
      <KpiStrip
        analytics={{ sharpe: 1.5 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(
      screen.getByText("risk-adjusted return (selected period)"),
    ).toBeTruthy();
    // The discredited fixed-window claim must be gone.
    expect(screen.queryByText("12-month risk-adjusted return")).toBeNull();
  });

  it("R4 honest copy — Avg |ρ| null path: renders '—' AND 'Requires per-holding correlation data (pending)'", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: null,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    // Em-dash present somewhere (the Avg |ρ| value cell).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // The honest pending-copy is the user-visible signal that the field
    // is not yet wired; assert it explicitly.
    expect(
      screen.getByText("Requires per-holding correlation data (pending)"),
    ).toBeTruthy();
    // And the loaded-data copy must NOT appear when null.
    expect(
      screen.queryByText("average pairwise correlation across holdings"),
    ).toBeNull();
  });

  it("Avg |ρ| loaded path: 0.42 renders the loaded-data sub-copy, NOT the pending copy", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("0.42")).toBeTruthy();
    expect(
      screen.getByText("average pairwise correlation across holdings"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  it("Stale path: allKeysStale=true → every cell renders '—' AND every cell shows stale sub-copy (precedence over pending)", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={45}
        allKeysStale={true}
      />,
    );
    // Phase 64 / PRESENT-01: 4 return-form cells (AUM removed), each showing
    // em-dash via the formatter null-input branch.
    expect(screen.getAllByText("—").length).toBe(4);
    // Stale sub-copy appears on every cell (4 instances after the AUM removal).
    expect(
      screen.getAllByText("Last sync stale — awaiting next update").length,
    ).toBe(4);
    // Stale precedence beats the Avg |ρ| pending copy.
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  it("Generic warmup precedence: default copy beats Avg |ρ| pending copy", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={10}
        allKeysStale={false}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // M-0085 — non-finite (NaN / Infinity) inputs to the per-cell formatters.
  // The Sharpe + Avg |ρ| cells route through formatNumber, which guards with
  // `!Number.isFinite` → renders "—" (safe). The YTD TWR + Max DD cells route
  // through formatPercent, and AUM through formatCurrency — NEITHER guards
  // non-finite, so a NaN leaks as "NaN%" / "$NaN" into the allocator's KPI
  // strip. The correct behaviour is the em-dash degrade used everywhere else;
  // the leak is a production bug in the shared formatters (src/lib/utils.ts),
  // surfaced here for a follow-up fix.
  // ---------------------------------------------------------------------------
  it("M-0085: Sharpe + Avg |ρ| degrade to em-dash for NaN/Infinity (formatNumber is finite-guarded)", () => {
    const { rerender } = render(
      <KpiStrip
        analytics={{ sharpe: NaN, avg_correlation: NaN }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    // Both NaN-fed numeric cells collapse to em-dash; "NaN" never renders.
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);

    rerender(
      <KpiStrip
        analytics={{ sharpe: Infinity, avg_correlation: Infinity }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />,
    );
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  it(
    "M-0085: YTD TWR / Max DD with NaN SHOULD degrade to em-dash but formatPercent leaks 'NaN%' — fix in follow-up (guard formatPercent for non-finite in src/lib/utils.ts)",
    () => {
      render(
        <KpiStrip
          analytics={{ ytd_twr: NaN, max_drawdown_12m: NaN }}
          metrics={EMPTY_METRICS}
          timeframe="ALL"
          snapshotCount={30}
        />,
      );
      // CORRECT behaviour: no "NaN%" anywhere — the percent cells degrade to
      // em-dash like every other null/invalid path.
      expect(screen.queryByText(/NaN/)).toBeNull();
    },
  );

  // Phase 64 / PRESENT-01 — RETIRED "M-0085: AUM with NaN … formatCurrency
  // leaks '$NaN'". Its premise (an AUM cell rendered through formatCurrency)
  // dies with PRESENT-01: no cell renders a dollar figure any more. The
  // formatCurrency non-finite guard follow-up moves to utils-level if ever
  // needed. The Sharpe/Avg |ρ| (formatNumber) + YTD/Max DD (formatPercent)
  // NaN tests above are kept byte-unchanged — those cells survive.

  // Phase 64 / PRESENT-01 — RETIRED "AUM is exempt from warmup helper (f9)".
  // The exemption's ONLY subject was the AUM cell (a dollar figure, almost
  // always present during warm-up). With the cell gone, all four surviving
  // cells are non-exempt return-form metrics — the warm-up count for a
  // null-metric strip is now 4/4, pinned by the warm-up precedence tests
  // above (which use ≥1 assertions) and KpiStrip.warmup.test.tsx.

  // ---------------------------------------------------------------------------
  // Phase 52-02 / TYPE-04 — @container migration. The strip must respond to ITS
  // OWN width (the ~380px metrics rail) via CSS `@container`, not the viewport,
  // and EVERY numeric value cell must keep `font-mono tabular-nums` so the
  // fluid --text-* tier (Phase 49) never raggeds a KPI column. Mirrors the
  // StrategyTable @container precedent the 52-01 tabular-nums contract anchors on.
  // ---------------------------------------------------------------------------
  describe("Phase 52-02 — @container migration (TYPE-04)", () => {
    it("the grid steps columns by @-prefixed variants, with the @container host on a SEPARATE ancestor (not the grid itself — an element can't query its own container)", () => {
      render(
        <KpiStrip
          analytics={{ ytd_twr: 0.12 }}
          metrics={EMPTY_METRICS}
          timeframe="ALL"
          snapshotCount={30}
        />,
      );
      const group = screen.getByRole("group", { name: "Portfolio KPIs" });
      // The column count must vary by CONTAINER width (`@`-prefixed variants),
      // never by viewport (`sm:`/`lg:`) — that is the whole point of TYPE-04.
      expect(group.className).toMatch(/@\S*grid-cols-/);
      // …but the grid must NOT be its OWN container. An element never queries
      // its own container size (CSS containment spec), so `@container` and the
      // `@sm:`/`@lg:` variants on the SAME element are inert — the grid would
      // freeze at its base column count at every width (the bug this guards).
      // The host must be a SEPARATE ancestor that wraps the grid.
      expect(group.className).not.toContain("@container");
      const host = group.closest(".\\@container");
      expect(
        host,
        "the @container host must be an ANCESTOR of the grid, not the grid itself",
      ).not.toBeNull();
      expect(host).not.toBe(group);
      // Forbid a VIEWPORT `sm:`/`lg:` grid variant — but NOT the container
      // `@sm:`/`@lg:` ones (the `@`-prefixed forms are exactly what we want). A
      // bare viewport variant is one NOT immediately preceded by `@`.
      expect(group.className).not.toMatch(/(?<!@)\bsm:grid-cols-/);
      expect(group.className).not.toMatch(/(?<!@)\blg:grid-cols-/);
      // Inline-size container only — `@container-size` (size containment) would
      // collapse the strip's block size to 0 (Pitfall 1).
      expect(host!.className).not.toContain("@container-size");
    });

    it("every numeric value cell keeps font-mono AND tabular-nums after the migration (alignment preserved)", () => {
      render(
        <KpiStrip
          analytics={{
            ytd_twr: 0.12,
            sharpe: 1.73,
            max_drawdown_12m: -0.08,
            avg_correlation: 0.42,
          }}
          metrics={EMPTY_METRICS}
          timeframe="ALL"
          snapshotCount={30}
        />,
      );
      const group = screen.getByRole("group", { name: "Portfolio KPIs" });
      // Each cell's primary value div is `font-mono … tabular-nums`. Query the
      // value divs directly (font-mono is the value-cell marker) and assert
      // EVERY one keeps both classes so a future refactor can't silently drop
      // the fixed-glyph advance that keeps the 4 columns aligned.
      const valueCells = Array.from(
        group.querySelectorAll<HTMLDivElement>("div.font-mono"),
      );
      // Phase 64 / PRESENT-01: non-vacuity — the 4-cell return-form strip
      // renders 4 value divs (AUM removed).
      expect(valueCells.length).toBeGreaterThanOrEqual(4);
      for (const cell of valueCells) {
        expect(cell.className).toContain("font-mono");
        expect(cell.className).toContain("tabular-nums");
      }
      // And the real formatted KPI values are the ones carrying the classes —
      // prove the cells we asserted on are the actual numeric values, not chrome.
      const rendered = valueCells.map((c) => c.textContent?.trim());
      // Phase 64 / PRESENT-01: the "$1.0M" AUM value is gone; the four
      // return-form values are the exact formatPercent / formatNumber outputs.
      for (const v of ["+12.00%", "1.73", "-8.00%", "0.42"]) {
        expect(rendered).toContain(v);
      }
    });
  });
});

// Phase 170.6 SFH-3 (D-04) + R2-SFH-2: the Max DD 12m cell is never green, and a drawdown
// above zero (impossible data: the sign convention flipped upstream) prints the dash it
// prints for a missing value, and is reported once.
describe("KpiStrip — Max DD 12m is never green (170.6 D-04)", () => {
  beforeEach(() => {
    vi.mocked(captureToSentry).mockClear();
  });

  function strip(maxDd: number) {
    return (
      <KpiStrip
        analytics={{ ytd_twr: 0.12, sharpe: 1.5, max_drawdown_12m: maxDd, avg_correlation: 0.42 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={30}
      />
    );
  }

  /** The value element of the "Max DD 12m" cell, found by its label. */
  function maxDdCell(maxDd: number): HTMLElement {
    const view = render(strip(maxDd));
    return ddValueIn(view.container);
  }

  function ddValueIn(container: HTMLElement): HTMLElement {
    const group = screen.getAllByRole("group", { name: "Portfolio KPIs" }).find((g) => container.contains(g))!;
    const cell = Array.from(group.children).find(
      (c) => c.querySelector("div")?.textContent === "Max DD 12m",
    )!;
    return cell.querySelector<HTMLElement>("div.font-mono")!;
  }

  it("a positive 0.04 is impossible data: it prints the dash, not +4.00%, and carries no tone", () => {
    const cell = maxDdCell(0.04);
    // Typed by hand. Before R2-SFH-2 this cell read "+4.00%" in neutral grey with no signal.
    expect(cell.textContent?.trim()).toBe("—");
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });

  it("reports a positive max drawdown once, and stays silent on a re-render with the same value", () => {
    const view = render(strip(0.04));
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [err, opts] = vi.mocked(captureToSentry).mock.calls[0];
    expect((err as Error).message).toContain("positive max drawdown");
    expect(opts.tags).toEqual({ component: "KpiStrip", check: "max-drawdown-sign" });
    expect(opts.extra).toMatchObject({ max_drawdown: 0.04 });
    view.rerender(strip(0.04));
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("does not report a real drawdown, a rounded zero or a missing value", () => {
    for (const v of [-0.08, -0.00004, 0.000004]) {
      render(strip(v));
    }
    render(
      <KpiStrip analytics={null} metrics={EMPTY_METRICS} timeframe="ALL" snapshotCount={30} />,
    );
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("a real drawdown of -0.08 (-8.00%) is still red", () => {
    const cell = maxDdCell(-0.08);
    expect(cell.textContent?.trim()).toBe("-8.00%");
    expect(cell.className).toContain("text-negative");
  });

  it("a drawdown that rounds to zero (-0.00004) prints 0.00% with no tone", () => {
    const cell = maxDdCell(-0.00004);
    expect(cell.textContent?.trim()).toBe("0.00%");
    expect(cell.className).not.toMatch(/text-(positive|negative)/);
  });

  it("a positive drawdown that rounds to zero (0.000004) is a zero, not a violation: 0.00%, no report", () => {
    const cell = maxDdCell(0.000004);
    expect(cell.textContent?.trim()).toBe("0.00%");
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

// R3-SFH-1 (170.6 round 3): the impossible-drawdown gate covers BOTH operands of the scenario
// delta, not only the figure the cell prints. A scenario value or a live baseline that prints
// above zero must not feed a delta pill or the "Current book: ..." tooltip, and either side is reported.
describe("KpiStrip — an impossible drawdown on either scenario operand (170.6 R3-SFH-1)", () => {
  beforeEach(() => {
    vi.mocked(captureToSentry).mockClear();
  });

  const GOOD: ComputedMetrics = { ...EMPTY_METRICS, n: 252, twr: 0.15, max_drawdown: -0.08 };

  function scenarioStrip(scenarioMaxDd: number, liveMaxDd: number) {
    return (
      <KpiStrip
        analytics={{ ytd_twr: 0.15, sharpe: 1.2, max_drawdown_12m: -0.08, avg_correlation: 0.42 }}
        metrics={GOOD}
        timeframe="ALL"
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={{ ...GOOD, max_drawdown: scenarioMaxDd }}
        liveMetrics={{ ...GOOD, max_drawdown: liveMaxDd }}
      />
    );
  }

  /** The Max DD cell's primary value and its delta pill, found by the pill's aria-label. */
  function ddPartsIn(container: HTMLElement) {
    const pill = container.querySelector<HTMLElement>('[aria-label^="Max DD 12m delta vs current book:"]')!;
    const cell = pill.parentElement!;
    // 170.1 (D-11): the pill holds the toned figure, then the untoned "vs current book" suffix.
    return { primary: cell.querySelector<HTMLElement>("div.font-mono")!, pill, figure: pill.children[0] as HTMLElement };
  }

  it("scenario value impossible (+0.04), live valid: the pill prints the dash, not a delta from 0.04", () => {
    const { container } = render(scenarioStrip(0.04, -0.08));
    const { primary, pill, figure } = ddPartsIn(container);
    expect(primary.textContent?.trim()).toBe("—");
    // Typed by hand. Before R3-SFH-1 this pill read "+12.0%" (0.04 - -0.08), improved, green.
    expect(figure.textContent?.trim()).toBe("—");
    expect(pill.children[1].textContent).toBe("vs current book");
    expect(pill.getAttribute("aria-label")).toBe("Max DD 12m delta vs current book: — (no change)");
    expect(figure.className).not.toMatch(/text-(positive|negative)/);
    expect(pill.getAttribute("title")).toBe("Current book: -8.00%");
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("live value impossible (+0.04), scenario valid: no delta, no '+4.00%' tooltip, and it is reported", () => {
    const { container } = render(scenarioStrip(-0.04, 0.04));
    const { primary, pill, figure } = ddPartsIn(container);
    expect(primary.textContent?.trim()).toBe("-4.00%");
    expect(primary.className).toContain("text-negative");
    // Before R3-SFH-1: pill "−4.0%" computed against the garbage baseline, tooltip "Current book: +4.00%", no report.
    expect(figure.textContent?.trim()).toBe("—");
    expect(figure.className).not.toMatch(/text-(positive|negative)/);
    expect(pill.getAttribute("title")).toBe("Current book: —");
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [, opts] = vi.mocked(captureToSentry).mock.calls[0];
    expect(opts.extra).toMatchObject({ max_drawdown: 0.04, impossible: "live:0.04" });
  });

  it("both sides valid: the pill still prints its real delta and the tooltip its real baseline", () => {
    const { container } = render(scenarioStrip(-0.04, -0.08));
    const { pill, figure } = ddPartsIn(container);
    expect(figure.textContent?.trim()).toBe("+4.0%");
    expect(pill.getAttribute("title")).toBe("Current book: -8.00%");
    expect(figure.className).toContain("text-positive");
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("a live baseline that only rounds to zero (+0.000004) is a zero, not a violation", () => {
    const { container } = render(scenarioStrip(-0.04, 0.000004));
    const { pill } = ddPartsIn(container);
    expect(pill.getAttribute("title")).toBe("Current book: 0.00%");
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});
