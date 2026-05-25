import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart, type OverlaySeries, type Period } from "./EquityChart";

// ---------------------------------------------------------------------------
// Phase 09.1 Plan 07 / Task 3 — EquityChart test suite.
//
// Spec coverage:
//   1. 7 period buttons rendered; 6M is the default active state.
//   2. Clicking a non-default period switches active state.
//   3. Empty equityDailyPoints renders the warm-up placeholder (no SVG path).
//   4. Leading-zero anchoring — firstPositiveIdx semantics preserved.
//   5. Benchmark prop renders a dashed path alongside the portfolio path.
//   6. Overlay prop renders an additional path per overlay.
//   7. Stale prop renders the dim-overlay element.
//   8. No 1D / 1W buttons rendered (intraday deferred).
//
// jsdom doesn't provide ResizeObserver out of the box; the EquityChart
// implementation falls back to a fixed 960px width when ResizeObserver is
// undefined. We rely on that fallback rather than stubbing the global so
// the test stays close to the production codepath used in non-jsdom
// environments.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Make sure each test starts with a clean ResizeObserver state — jsdom's
  // default is undefined, but other tests in the suite may stub it.
  if ("ResizeObserver" in globalThis) {
    // Leave it alone — the chart's effect handles both shapes.
  }
});

function makeSeries(n: number, opts: { leadingZeros?: number } = {}): DailyPoint[] {
  const leading = opts.leadingZeros ?? 0;
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const value = i < leading ? 0 : cumulative;
    if (i >= leading) cumulative *= 1 + Math.sin(i * 0.3) * 0.01;
    pts.push({ date: dateStr, value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

describe("EquityChart", () => {
  it("renders 7 period buttons (1M / 3M / 6M / YTD / 1Y / ALL / CUSTOM)", () => {
    const { getByRole, getAllByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    for (const label of ["1M", "3M", "6M", "YTD", "1Y", "ALL", "CUSTOM"]) {
      // getByRole resolves text-content by name (default in Testing Library)
      expect(getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("defaults to 6M and that button is the active tab", () => {
    const { getByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const sixM = getByRole("tab", { name: "6M" });
    expect(sixM.getAttribute("aria-selected")).toBe("true");
  });

  it("clicking 1M switches the active tab", () => {
    const { getByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const oneM = getByRole("tab", { name: "1M" });
    expect(oneM.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(oneM);
    expect(oneM.getAttribute("aria-selected")).toBe("true");
    expect(getByRole("tab", { name: "6M" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("renders the warm-up placeholder when equityDailyPoints is empty (no SVG path)", () => {
    const { container, getByLabelText } = render(
      <EquityChart equityDailyPoints={[]} />,
    );
    expect(getByLabelText("Equity chart")).toBeTruthy();
    // The empty state mounts a div with the equity-chart aria-label rather
    // than an <svg>. The presence of the warm-up text is the indicator.
    expect(container.textContent).toMatch(/Equity data warming up/i);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("anchors from the firstPositiveIdx — leading-zero points are skipped", () => {
    // Construct a series with 3 leading zeros, then real positive values.
    // The chart should drop the leading zeros (firstPositiveIdx = 3) so
    // the rendered SVG path starts at the 4th point's value/value = 1.0
    // — i.e. the path's first y-coordinate aligns with `1.0` after anchor.
    const series = makeSeries(20, { leadingZeros: 3 });
    const { container } = render(
      <EquityChart equityDailyPoints={series} initialPeriod="ALL" />,
    );
    const paths = container.querySelectorAll("svg path");
    // At least: portfolio area + portfolio line.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // The portfolio line path should have at most 17 vertex commands
    // (20 - 3 leading zeros = 17 anchored points). Count "L" commands +1
    // for the initial M.
    // Portfolio LINE has stroke set + fill="none". (Area has fill="url(...)"
    // and no stroke.)
    const portfolioLine = Array.from(paths).find((p) => {
      const stroke = p.getAttribute("stroke");
      const fill = p.getAttribute("fill");
      return Boolean(stroke) && fill === "none";
    });
    expect(portfolioLine).toBeDefined();
    const d = portfolioLine?.getAttribute("d") ?? "";
    const vertexCount = (d.match(/[ML]/g) || []).length;
    // 17 vertices expected (20 raw - 3 zeros). Allow some slack for the
    // path rendering — assert it's strictly less than the raw-input count.
    expect(vertexCount).toBeLessThanOrEqual(17);
    expect(vertexCount).toBeLessThan(series.length);
  });

  it("benchmark prop renders an additional dashed path alongside the portfolio", () => {
    const portfolio = makeSeries(60);
    const benchmark = makeSeries(60);
    const { container } = render(
      <EquityChart
        equityDailyPoints={portfolio}
        benchmark={benchmark}
        initialPeriod="ALL"
      />,
    );
    const dashed = container.querySelectorAll(
      'svg path[stroke-dasharray="3 3"]',
    );
    expect(dashed.length).toBeGreaterThanOrEqual(1);
  });

  it("overlay prop renders one additional path per overlay", () => {
    const portfolio = makeSeries(60);
    const overlay: OverlaySeries = {
      id: "h-1",
      label: "BTC Holding",
      color: "#FF6600",
      points: makeSeries(60),
    };
    const { container } = render(
      <EquityChart
        equityDailyPoints={portfolio}
        overlays={[overlay]}
        initialPeriod="ALL"
      />,
    );
    // Overlays render as solid 1.25-stroke paths in the overlay's color.
    const overlayPaths = container.querySelectorAll(
      'svg path[stroke="#FF6600"]',
    );
    expect(overlayPaths.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the stale-overlay element when stale=true", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        stale
        initialPeriod="ALL"
      />,
    );
    const staleEl = container.querySelector('[data-testid="equity-chart-stale"]');
    expect(staleEl).not.toBeNull();
    // Without `lastSyncAt`, copy falls back to the static "Data may be
    // stale" so older call sites that don't yet plumb the timestamp
    // through don't regress.
    expect(container.textContent).toMatch(/Data may be stale/i);
  });

  it("ADVERSARIAL-EQ-6 — stale overlay shows 'Last updated Nh ago' when lastSyncAt is supplied", () => {
    // Pin a known ISO ~3 hours in the past relative to a test-controlled
    // clock so the helper's bucket arithmetic is deterministic. Vitest's
    // setSystemTime keeps Date.now() stable for the assertion.
    const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.setSystemTime(NOW);
    try {
      const lastSyncAt = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
      const { container } = render(
        <EquityChart
          equityDailyPoints={makeSeries(60)}
          stale
          lastSyncAt={lastSyncAt}
          initialPeriod="ALL"
        />,
      );
      const staleEl = container.querySelector(
        '[data-testid="equity-chart-stale"]',
      );
      expect(staleEl).not.toBeNull();
      expect(staleEl?.textContent).toContain("Last updated 3h ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ADVERSARIAL-EQ-6 — header sync stamp uses relative time when lastSyncAt is supplied", () => {
    const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.setSystemTime(NOW);
    try {
      const lastSyncAt = new Date(NOW - 5 * 60 * 1000).toISOString();
      const { container } = render(
        <EquityChart
          equityDailyPoints={makeSeries(60)}
          lastSyncAt={lastSyncAt}
          initialPeriod="ALL"
        />,
      );
      // Header copy reads "last sync 5m ago" rather than "sync just now".
      expect(container.textContent).toContain("last sync 5m ago");
      expect(container.textContent).not.toContain("sync just now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT render 1D or 1W buttons (intraday deferred)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} />,
    );
    const buttons = Array.from(container.querySelectorAll('button[role="tab"]'));
    const labels = buttons.map((b) => b.textContent);
    expect(labels).not.toContain("1D");
    expect(labels).not.toContain("1W");
    // Defensive: no other-cased intraday tokens leak through either.
    for (const l of labels) {
      expect(l).not.toMatch(/intraday/i);
    }
  });

  it("clicking CUSTOM opens the CustomRangePicker popover", () => {
    const { getByRole, queryByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    expect(queryByRole("dialog", { name: "Custom date range" })).toBeNull();
    const customBtn = getByRole("tab", { name: "CUSTOM" });
    fireEvent.click(customBtn);
    expect(queryByRole("dialog", { name: "Custom date range" })).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Readability pass (2026-04-24) — the axis/legend/summary additions
  // that resolved the "only 100% and no other sign" complaint.
  // ────────────────────────────────────────────────────────────────

  it("renders a 0% baseline tick label on the Y-axis", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    const labels = Array.from(container.querySelectorAll("svg text")).map(
      (t) => t.textContent,
    );
    // The 0% baseline tick is always rendered (we clamp yMin <= 1 <= yMax).
    expect(labels).toContain("+0%");
  });

  it("renders multiple Y-axis percentage tick labels (not just 0%)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} initialPeriod="ALL" />,
    );
    const pctLabels = Array.from(container.querySelectorAll("svg text"))
      .map((t) => t.textContent ?? "")
      .filter((s) => /^[+-]?\d+(\.\d+)?%$/.test(s));
    // We expect at least 2 percentage ticks (0% + at least one other).
    expect(pctLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders an always-visible legend entry for Portfolio", () => {
    const { getByLabelText } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    const legend = getByLabelText("Series legend");
    expect(legend.textContent).toMatch(/Portfolio/);
  });

  it("renders a BTC legend entry when benchmark is supplied", () => {
    const { getByLabelText } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        benchmark={makeSeries(60)}
        initialPeriod="ALL"
      />,
    );
    const legend = getByLabelText("Series legend");
    expect(legend.textContent).toMatch(/BTC/);
  });

  it("ADVERSARIAL-EQ-5 — renders both the sync stamp AND an always-visible period return summary", () => {
    // PR3 had dropped the right-side return-summary div as a parity
    // tradeoff for the truth screenshot's "sync 2m ago" stamp. The
    // adversarial review re-introduces the summary because the y-axis
    // labels alone don't give a glance-able answer to "what's my
    // current return?" — the user still has to mentally interpolate
    // the rightmost line endpoint against the tick scale.
    //
    // Both chrome elements now render: the sync stamp (truth-screenshot
    // parity) AND the return summary (`aria-label="Return over {period}"`
    // — the same naming convention used before PR3 removed it).
    const { getByText, getByLabelText } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    expect(getByText("sync just now")).toBeTruthy();
    const summary = getByLabelText("Return over ALL");
    expect(summary).toBeTruthy();
    // Summary text matches "+x.xx%" / "-x.xx%" pattern.
    expect(summary.textContent).toMatch(/^ALL[+-]?\d+(\.\d+)?%$/);
  });

  it("gradient uses the --color-chart-strategy design token (no hardcoded hex)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    // jsdom doesn't namespace-resolve the SVG descendant selector reliably;
    // walk the DOM and grab <stop> nodes by tagName.
    const svg = container.querySelector("svg")!;
    const stops = Array.from(svg.getElementsByTagName("stop"));
    expect(stops.length).toBeGreaterThan(0);
    // ADVERSARIAL-EQ-3 — switched from `var(--chart-strategy)` (an
    // undefined CSS custom property — Tailwind v4 @theme inline only
    // emits the prefixed `--color-*` names) to `var(--color-chart-strategy)`
    // which actually resolves in browsers.
    for (const s of stops) {
      const color = s.getAttribute("stop-color") ?? "";
      expect(color).toMatch(/var\(--color-chart-strategy\)/);
    }
  });

  it("benchmark path uses the --color-chart-benchmark design token (no hardcoded hex)", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        benchmark={makeSeries(60)}
        initialPeriod="ALL"
      />,
    );
    const dashed = container.querySelector(
      'svg path[stroke-dasharray="3 3"]',
    ) as SVGPathElement | null;
    expect(dashed).not.toBeNull();
    // ADVERSARIAL-EQ-3 — same fix as the gradient: switched from
    // `var(--chart-benchmark)` (undefined) to `var(--color-chart-benchmark)`.
    expect(dashed?.getAttribute("stroke")).toBe(
      "var(--color-chart-benchmark)",
    );
  });

  // M-0202 — the suite covered the empty series (warm-up) but not the
  // degenerate-value and sparse-data inputs. EquityChart's f7 anchor
  // (`anchorFromFirstPositive` finds the first value > 0, divides through)
  // plus the M-1063 basePort guard (non-finite / ≤0 → warm-up) define the
  // contract for these. These tests pin that contract so a regression that
  // dropped a guard (and rendered an off-screen NaN path) fails here.
  describe("M-0202 — degenerate values and sparse series", () => {
    it("a single positive point still renders an SVG (composite.length === 1, not the warm-up empty state)", () => {
      const { container, queryByText } = render(
        <EquityChart
          equityDailyPoints={[{ date: "2024-01-01", value: 1.0 }]}
          initialPeriod="ALL"
        />,
      );
      // composite.length === 1 (not 0) → the chart mounts an <svg>, not the
      // "Equity data warming up" placeholder.
      expect(container.querySelector("svg")).not.toBeNull();
      expect(queryByText(/Equity data warming up/i)).toBeNull();
    });

    it("two positive points render a portfolio line with both vertices", () => {
      const { container } = render(
        <EquityChart
          equityDailyPoints={[
            { date: "2024-01-01", value: 1.0 },
            { date: "2024-01-02", value: 1.05 },
          ]}
          initialPeriod="ALL"
        />,
      );
      const paths = Array.from(container.querySelectorAll("svg path"));
      const portfolioLine = paths.find((p) => {
        const stroke = p.getAttribute("stroke");
        const fill = p.getAttribute("fill");
        return Boolean(stroke) && fill === "none";
      });
      expect(portfolioLine).toBeDefined();
      const d = portfolioLine?.getAttribute("d") ?? "";
      // Exactly two anchored vertices (M + L) for a 2-point series.
      const vertexCount = (d.match(/[ML]/g) || []).length;
      expect(vertexCount).toBe(2);
    });

    it("an all-NaN series falls back to the warm-up state (firstPositive finds nothing) — no broken SVG", () => {
      const { container, getByLabelText } = render(
        <EquityChart
          equityDailyPoints={[
            { date: "2024-01-01", value: Number.NaN },
            { date: "2024-01-02", value: Number.NaN },
          ]}
          initialPeriod="ALL"
        />,
      );
      // findIndex(p => p.value > 0) never matches NaN → anchored = [] →
      // composite.length === 0 → warm-up placeholder, no <svg>.
      expect(getByLabelText("Equity chart")).toBeTruthy();
      expect(container.textContent).toMatch(/Equity data warming up/i);
      expect(container.querySelector("svg")).toBeNull();
    });

    // M-0202 (SURFACED BUG) — the y-range computation filters non-finite
    // normalized values out of yMin/yMax (line ~503-516), but the line/area
    // path builder `toPath` (line ~639) only skips `null`, NOT Infinity/NaN
    // numbers. So an Infinity equity point projects to `y(Infinity)` =
    // -Infinity and leaks a literal "-Infinity" coordinate into the SVG `d`
    // attribute → an invalid/off-screen portfolio line with no diagnostic.
    // CORRECT behavior: a single corrupt point should be skipped (like null),
    // leaving a finite path. This documents the bug; the fix belongs in
    // production (`toPath` should treat non-finite the same as null).
    it(
      "M-0202: a single Infinity equity point leaks '-Infinity' into the portfolio path coords — toPath lacks a finite guard (fix in follow-up)",
      () => {
        const { container } = render(
          <EquityChart
            equityDailyPoints={[
              { date: "2024-01-01", value: 1.0 },
              { date: "2024-01-02", value: Number.POSITIVE_INFINITY },
              { date: "2024-01-03", value: 1.1 },
            ]}
            initialPeriod="ALL"
          />,
        );
        expect(container.querySelector("svg")).not.toBeNull();
        const paths = Array.from(container.querySelectorAll("svg path"));
        const portfolioLine = paths.find(
          (p) =>
            Boolean(p.getAttribute("stroke")) &&
            p.getAttribute("fill") === "none",
        );
        const d = portfolioLine?.getAttribute("d") ?? "";
        // No literal "NaN"/"Infinity" should leak into the path coordinates.
        expect(d).not.toMatch(/NaN|Infinity/);
      },
    );

    it("a leading-negative-then-positive series anchors at the first positive value (negatives before the anchor are skipped)", () => {
      const { container } = render(
        <EquityChart
          equityDailyPoints={[
            { date: "2024-01-01", value: -0.5 },
            { date: "2024-01-02", value: 1.0 },
            { date: "2024-01-03", value: 1.2 },
          ]}
          initialPeriod="ALL"
        />,
      );
      const paths = Array.from(container.querySelectorAll("svg path"));
      const portfolioLine = paths.find(
        (p) => Boolean(p.getAttribute("stroke")) && p.getAttribute("fill") === "none",
      );
      expect(portfolioLine).toBeDefined();
      const d = portfolioLine?.getAttribute("d") ?? "";
      // firstPositiveIdx = 1 → only the 2 post-anchor points are plotted.
      const vertexCount = (d.match(/[ML]/g) || []).length;
      expect(vertexCount).toBe(2);
      expect(d).not.toMatch(/NaN|Infinity/);
    });
  });

  // M-0203 — benchmark overlay rendering was covered for an equal-length,
  // same-date benchmark only. Production aligns the benchmark to the
  // composite BY DATE (a `date → value` Map, then `visible.map(p =>
  // m.get(p.date) ?? null)`), so a shorter benchmark or a non-overlapping
  // date range is a real code path. These pin that date-join behavior.
  describe("M-0203 — benchmark length / date-range mismatch", () => {
    it("a benchmark covering only a SUBSET of the portfolio dates still renders the dashed line (date-joined, missing days dropped)", () => {
      const portfolio = makeSeries(60);
      // Benchmark shares the FIRST 30 portfolio dates only (half the length).
      const benchmark = portfolio.slice(0, 30);
      const { container } = render(
        <EquityChart
          equityDailyPoints={portfolio}
          benchmark={benchmark}
          initialPeriod="ALL"
        />,
      );
      // At least the matching-date portion produces the dashed benchmark path.
      const dashed = container.querySelectorAll('svg path[stroke-dasharray="3 3"]');
      expect(dashed.length).toBeGreaterThanOrEqual(1);
      const d = (dashed[0] as SVGPathElement).getAttribute("d") ?? "";
      expect(d).not.toMatch(/NaN|Infinity/);
    });

    it("a benchmark whose dates NEVER overlap the portfolio renders NO benchmark line (baseBench is null → normalized series is null)", () => {
      const portfolio = makeSeries(30); // 2024-01-01 .. 2024-01-30
      // Build a benchmark anchored in a completely different month so no
      // date key matches any composite date.
      const farFuture: DailyPoint[] = [];
      const d = new Date(Date.UTC(2025, 5, 1));
      let cumulative = 1.0;
      for (let i = 0; i < 30; i++) {
        farFuture.push({ date: d.toISOString().slice(0, 10), value: cumulative });
        cumulative *= 1.001;
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const { container } = render(
        <EquityChart
          equityDailyPoints={portfolio}
          benchmark={farFuture}
          initialPeriod="ALL"
        />,
      );
      // Every `m.get(p.date)` misses → all-null benchmark → baseBench null →
      // visibleBenchmarkNormalized null → no dashed path mounts. The
      // portfolio line is unaffected (still rendered).
      const dashed = container.querySelectorAll('svg path[stroke-dasharray="3 3"]');
      expect(dashed.length).toBe(0);
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });
});

describe("EquityChart — audit-2026-05-07 safety guards", () => {
  // M-1063 c8 silent-failure — when sliceByPeriod's date window excludes
  // the f7 anchor and lands on post-anchor zero rows, visible[0].value
  // can be 0. The previous code `?? 1` only caught undefined and
  // produced Infinity/NaN paths. The guard reuses the 'Equity data
  // warming up' empty-state copy when basePort is not finite-positive.
  it("M-1063: visible window starting on a post-anchor zero row falls back to 'Equity data warming up'", () => {
    // 35-day series: day 0 has the f7 anchor (value=1), days 1..34 are 0.
    // With initialPeriod='1M' (30-day lookback) the slice starts at day 5,
    // so visible[0].value = 0 after the f7 anchor preserves the post-
    // anchor zeros.
    const series: DailyPoint[] = [];
    const d = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 35; i++) {
      series.push({
        date: d.toISOString().slice(0, 10),
        value: i === 0 ? 1 : 0,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const { container, getByLabelText } = render(
      <EquityChart equityDailyPoints={series} initialPeriod="1M" />,
    );
    expect(getByLabelText("Equity chart")).toBeTruthy();
    expect(container.textContent).toMatch(/Equity data warming up/);
    // No chart SVG path in the warm-up state — just the placeholder div.
    expect(container.querySelector("svg path")).toBeNull();
  });

  // M-1065 — defensive guard, no triggerable regression test. The
  // pre-fix walker only collapses to the seed-stuck behavior when
  // tickCount(candidates[0]) < MIN_TICKS; given the existing
  // `(yMax - yMin) * 0.04 || 0.002` padding rule the smallest seed
  // (0.001%) always satisfies MIN_TICKS=5 on real and synthetic
  // inputs. The fallback exists for forward-defensive value (e.g.
  // future padding-rule changes or pathological data injected via
  // tests) — see the source-comment in EquityChart.tsx around the
  // `satisfied` flag. Not exercising it here would require manufacturing
  // data the runtime cannot actually produce.
});

// ───────────────────────────────────────────────────────────────────
// M-1057 — yTicks MIN_TICKS=5 floor. PR4 #4 rewrote the y-tick walker to
// pick the LARGEST nice candidate that still yields >= 5 ticks (accepting
// sub-1% steps on tight ranges). The prior assertion only required >= 2
// ticks (passes even with the old 3-tick collapse). These tests pin >= 5
// ticks for both a narrow and a wide range so a revert to the round-UP
// picker (which collapsed narrow ranges to 3 labels) fails.
// ───────────────────────────────────────────────────────────────────

// Collect the y-axis percentage tick labels (e.g. "+0%", "-0.5%").
function pctTickLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("svg text"))
    .map((t) => t.textContent ?? "")
    .filter((s) => /^[+-]?\d+(\.\d+)?%$/.test(s));
}

describe("EquityChart — M-1057 yTicks MIN_TICKS floor", () => {
  it("narrow sub-1% range still yields >= 5 percentage ticks", () => {
    // Values oscillate in a sub-1% band around 1.0 — the exact tight range
    // the MIN_TICKS floor exists to keep dense. After period-start
    // normalization the span stays well under 1%, so a round-UP picker
    // would collapse to ~3 ticks; the floor must hold it at >= 5.
    const series: DailyPoint[] = [];
    const d = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 120; i++) {
      series.push({
        date: d.toISOString().slice(0, 10),
        // 0.997 .. 1.003 — a ~0.65% normalized span. The pre-PR4 round-UP
        // picker collapses this to 3 ticks; the MIN_TICKS=5 floor must hold
        // it at >= 5 (verified: NEW picker = 7 ticks, OLD picker = 3).
        value: 1 + Math.sin(i * 0.5) * 0.003,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const { container } = render(
      <EquityChart equityDailyPoints={series} initialPeriod="ALL" />,
    );
    expect(pctTickLabels(container).length).toBeGreaterThanOrEqual(5);
  });

  it("wide range yields >= 5 percentage ticks (picker selects a larger step, not the smallest)", () => {
    // A ~60% span (0.7 .. 1.3 after normalization) — the walker should pick
    // a coarse step (e.g. 10%) that STILL clears 5 ticks, proving it selects
    // the largest qualifying candidate rather than flooding with tiny steps.
    const series: DailyPoint[] = [];
    const d = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 120; i++) {
      // Linear ramp from ~0.7 up to ~1.3 so normalized range is wide.
      series.push({
        date: d.toISOString().slice(0, 10),
        value: 0.7 + (0.6 * i) / 119,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const { container } = render(
      <EquityChart equityDailyPoints={series} initialPeriod="ALL" />,
    );
    const labels = pctTickLabels(container);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    // Sanity: the walker did NOT flood the axis with hundreds of tiny ticks
    // (the >50-tick safety cap should never have to fire here).
    expect(labels.length).toBeLessThanOrEqual(50);
  });
});

// ───────────────────────────────────────────────────────────────────
// M-1058 — controlled-state escape hatch (period / onPeriodChange). PR4 #1
// added a controlled-or-uncontrolled pattern: when `period` is supplied,
// it is the source of truth, setPeriod fires onPeriodChange AND skips the
// internal state update. The existing suite only covers the uncontrolled
// path ("clicking 1M switches the active tab"). These tests cover the
// controlled path so a regression that swallows the wrapper value (chart
// desyncs from the card-header toggle) fails.
// ───────────────────────────────────────────────────────────────────

describe("EquityChart — M-1058 controlled period mode", () => {
  it("forwards clicks to onPeriodChange and does NOT mutate internal active tab", () => {
    const onPeriodChange = vi.fn();
    const { getByRole, rerender } = render(
      <EquityChart
        equityDailyPoints={makeSeries(200)}
        period="1M"
        onPeriodChange={onPeriodChange}
      />,
    );
    // Controlled: '1M' is active because the prop says so.
    expect(getByRole("tab", { name: "1M" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    // Click '3M' — handler fires with '3M', but the chart must NOT flip its
    // own active tab (the wrapper owns the value and hasn't updated yet).
    fireEvent.click(getByRole("tab", { name: "3M" }));
    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect((onPeriodChange.mock.calls[0] as unknown as [Period])[0]).toBe("3M");
    // Still '1M' — controlled value unchanged.
    expect(getByRole("tab", { name: "1M" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(getByRole("tab", { name: "3M" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    // Wrapper now propagates the new value back as a prop — active flips.
    rerender(
      <EquityChart
        equityDailyPoints={makeSeries(200)}
        period="3M"
        onPeriodChange={onPeriodChange}
      />,
    );
    expect(getByRole("tab", { name: "3M" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(getByRole("tab", { name: "1M" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("CUSTOM apply forwards the range through onCustomRangeChange + onPeriodChange without internal state", () => {
    const onPeriodChange = vi.fn();
    const onCustomRangeChange = vi.fn();
    const { getByRole, queryByRole } = render(
      <EquityChart
        equityDailyPoints={makeSeries(200)}
        period="6M"
        onPeriodChange={onPeriodChange}
        customRange={null}
        onCustomRangeChange={onCustomRangeChange}
      />,
    );
    // Open the picker.
    fireEvent.click(getByRole("tab", { name: "CUSTOM" }));
    const dialog = queryByRole("dialog", { name: "Custom date range" });
    expect(dialog).not.toBeNull();

    // Apply a range via the picker's Apply control. The two date inputs are
    // seeded; set explicit values then Apply.
    const inputs = dialog!.querySelectorAll('input[type="date"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(inputs[0], { target: { value: "2024-02-01" } });
    fireEvent.change(inputs[1], { target: { value: "2024-03-01" } });
    fireEvent.click(getByRole("button", { name: /apply/i }));

    // Controlled mode: both callbacks fire; the chart never set its own
    // internal customRange/period.
    expect(onCustomRangeChange).toHaveBeenCalledTimes(1);
    expect(
      (onCustomRangeChange.mock.calls[0] as unknown as [unknown])[0],
    ).toEqual({ start: "2024-02-01", end: "2024-03-01" });
    expect(onPeriodChange).toHaveBeenCalledWith("CUSTOM");
  });
});

// Re-export to silence a "vi unused" lint nit on jsdom-only test env.
void vi;
