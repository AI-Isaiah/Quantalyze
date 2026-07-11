import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 52-06 / TYPE-04 / TYPE-02 / APPLY-01 — the FactsheetView KPI strip is
 * migrated from VIEWPORT breakpoints (`lg:grid-cols-9`) to CSS `@container`
 * queries so its column count reflows on ITS OWN width, not the window's, and
 * its raw `text-[Npx]` sizes are migrated onto the fluid `--text-*` tier spine.
 *
 * The three behaviors (52-06-PLAN Task 1 <behavior>):
 *   1. The KPI-strip grid's column count responds to CONTAINER width via
 *      `@`-prefixed variants (NOT `lg:grid-cols-9`), with the `@container` HOST
 *      on a SEPARATE ancestor (the enclosing `<section>`) — an element never
 *      queries its OWN container size, so a same-element host+variant would
 *      never reflow — and the `grid-cols-3` mobile fallback kept as the
 *      container-narrow base.
 *   2. Every KPI metric VALUE cell keeps `font-mono tabular-nums` (alignment
 *      preserved under the fluid tier); the KPI LABEL keeps its
 *      `text-ellipsis whitespace-nowrap` bounded-label affordance (the
 *      AUDIT-classified legitimate clip on the KPI label `<p>` — not removed).
 *   3. The factsheet shell stays `max-w-[1440px]` (measure NOT raised to 1920),
 *      and no fabricated zero appears for a degenerate metric (the body mounts
 *      honestly — the existing FactsheetBody.degenerate matrix stays green).
 *
 * Renders the REAL KpiStrip via the REAL FactsheetBody (mirrors the
 * FactsheetBody.degenerate.test.tsx render idiom + its localStorage/sentry stubs)
 * so the assertions gate the live DOM the route ships, not a copy.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

function renderBody() {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

describe("FactsheetView KPI strip — @container + fluid-type migration (52-06 / TYPE-04)", () => {
  it("Test 1 — the KPI strip's @container host is a SEPARATE ancestor of the grid, and the grid steps columns by @-prefixed variants, NOT lg:grid-cols-9 (and NOT a same-element host)", () => {
    const { container } = renderBody();

    // At least one `@container` host exists (the enclosing section).
    const hosts = Array.from(
      container.querySelectorAll<HTMLElement>(".\\@container"),
    );
    expect(hosts.length).toBeGreaterThan(0);

    // The KPI-strip grid: a grid element whose column variants are @-prefixed.
    const kpiGrid = Array.from(
      container.querySelectorAll<HTMLElement>("div.grid"),
    ).find((el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className));
    expect(
      kpiGrid,
      "the KPI strip must be a grid with @-prefixed grid-cols variants",
    ).toBeDefined();

    // The grid must NOT be its OWN container. An element never queries its own
    // container size (CSS containment spec), so `@container` + `@5xl:grid-cols-*`
    // on the SAME element is inert — the strip would freeze at grid-cols-3 at
    // every width (the bug this guards). The host must be a SEPARATE ancestor.
    expect(kpiGrid!.className).not.toContain("@container");
    const host = kpiGrid!.closest(".\\@container");
    expect(
      host,
      "the @container host must be an ANCESTOR of the KPI grid, not the grid itself",
    ).not.toBeNull();
    expect(host).not.toBe(kpiGrid);

    // The viewport breakpoint must be gone — column count now keys off the
    // CONTAINER width (the StrategyTable @container idiom), not the window.
    expect(kpiGrid!.className).not.toMatch(/\blg:grid-cols-9\b/);
    // The narrow mobile fallback is preserved as a container-narrow base.
    expect(kpiGrid!.className).toMatch(/\bgrid-cols-3\b/);
    // Size containment would collapse the strip's block size to 0 (Pitfall 1) —
    // the bare inline-size `@container` is deliberate.
    expect(host!.className).not.toContain("@container-size");
  });

  it("Test 2 — every KPI VALUE cell keeps font-mono tabular-nums; the KPI LABEL keeps its text-ellipsis whitespace-nowrap bounded-label clip", () => {
    const { container } = renderBody();
    const kpiGrid = Array.from(
      container.querySelectorAll<HTMLElement>("div.grid"),
    ).find((el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className))!;
    expect(kpiGrid).toBeDefined();

    // The KPI tiles are the direct children of the grid.
    const tiles = Array.from(kpiGrid.children) as HTMLElement[];
    expect(tiles.length).toBeGreaterThan(0);

    for (const tile of tiles) {
      const ps = Array.from(tile.querySelectorAll("p"));
      expect(ps.length).toBe(2); // label + value
      const [labelEl, valueEl] = ps;
      // VALUE cell: fixed glyph advance so the column aligns under the fluid tier.
      expect(valueEl.className).toContain("font-mono");
      expect(valueEl.className).toContain("tabular-nums");
      // VALUE cell keeps whitespace-nowrap (no wrap mid-number).
      expect(valueEl.className).toContain("whitespace-nowrap");
      // LABEL cell: the legitimate bounded-label clip is preserved (AUDIT :647).
      expect(labelEl.className).toContain("text-ellipsis");
      expect(labelEl.className).toContain("whitespace-nowrap");
    }
  });

  it("Test 3 — the factsheet shell stays max-w-[1440px] (measure NOT raised to 1920) and the body mounts with no fabricated NaN/Infinity", () => {
    const { container } = renderBody();
    const shell = container.querySelector(".factsheet-v2-shell");
    expect(shell).not.toBeNull();
    expect((shell as HTMLElement).className).toContain("max-w-[1440px]");
    expect((shell as HTMLElement).className).not.toContain("max-w-[1920px]");
    // Honesty floor: a degenerate metric formats to "—", never a fabricated 0.
    const html = container.innerHTML;
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

/**
 * Phase 90 Wave-0 (90-02 Task 3) — TDD RED scaffold for the FS-03 KpiStrip-ONLY
 * basis relabel (CONTEXT D5, 2026-07-11 refinement): toggling cash↔MTM swaps
 * ONLY the KpiStrip scalar values + the "BASIS · …" eyebrow, while MetricsColumn
 * stays pinned to cash and the charts keep the cash series behind a caption.
 * Lands in 90-05.
 *
 * DOM-level only — imports NO not-yet-existing module. The composite optional
 * fields are supplied via casts (per 90-02 <interfaces>). The RED tests fail
 * today because the toggle + eyebrow + basis hook do not exist yet; the GREEN
 * pin proves single-key emits no "BASIS ·" eyebrow (byte-identity scope). Does
 * NOT modify any existing test above.
 */

// Sentinel per-basis scalars — MTM cum. return 0.5000 is distinguishable from
// the cash 0.6266 so the relabel swap is observable. Server key names per D3.
const KP_CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};
const KP_MTM = {
  cumulative_return: 0.5,
  volatility: 0.11,
  max_drawdown: -0.038,
  cagr: 0.26,
  sharpe: 1.2,
  sortino: 1.9,
  calmar: 2.7,
};

function compositeKpiPayload(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  // Pin the cash Cum. Return the current (cash-only) KpiStrip shows to the
  // sentinel, so the post-90-05 relabel swap is a visible 0.6266 → 0.5000.
  p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
  return {
    ...p,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: KP_CASH, mark_to_market: KP_MTM },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}

function renderComposite(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

describe("FactsheetView KPI strip — Phase 90 basis relabel (composite) (RED until 90-05)", () => {
  it("RED: toggling to Mark-to-market swaps Cum. Return to the MTM sentinel + 'BASIS · MARK-TO-MARKET' eyebrow; toggling back restores cash", () => {
    const { getByText, container } = renderComposite(compositeKpiPayload());

    // Scope the VALUE assertions to the KPI strip grid: the equity chart's Y-axis
    // also renders a round "+50.0%" tick, so a body-scoped getByText("+50.0%")
    // would match the axis label too. The eyebrow strings are unique in the body
    // (the MetricsColumn eyebrow, when shown, reads CASH), so they stay body-scoped.
    const kpiGrid = () =>
      within(
        Array.from(container.querySelectorAll<HTMLElement>("div.grid")).find(
          (el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className),
        )!,
      );

    // No basis toggle exists yet → getByText throws (RED). After 90-05 this
    // drives the KpiStrip relabel.
    fireEvent.click(getByText("Mark-to-market"));
    expect(getByText("BASIS · MARK-TO-MARKET")).toBeTruthy();
    expect(kpiGrid().getByText("+50.0%")).toBeTruthy(); // MTM cumulative_return sentinel

    fireEvent.click(getByText("Cash settlement"));
    expect(getByText("BASIS · CASH SETTLEMENT")).toBeTruthy();
    expect(kpiGrid().getByText("+62.7%")).toBeTruthy(); // cash cumulative_return sentinel
  });

  it("RED: under MTM, MetricsColumn stays cash-pinned (D5) and the cash-series chart caption is a role=status region", () => {
    const { getByText, container } = renderComposite(compositeKpiPayload());

    // RED today (no toggle). After 90-05: only the KpiStrip relabels; the
    // MetricsColumn distributional stats keep their CASH values, and the charts
    // keep the cash series behind an announced caption.
    fireEvent.click(getByText("Mark-to-market"));

    const caption = container.querySelector('[role="status"]');
    expect(caption?.textContent).toContain(
      "Charts show the cash-settlement series. Mark-to-market applies to summary metrics only.",
    );
    // A MetricsColumn distributional stat (no MTM counterpart) still renders its
    // cash value — MetricsColumn is NOT relabeled (KpiStrip-only, D5).
    // "Skew" appears in BOTH the Main-Metrics and Extended-Metrics panels
    // (pre-existing), so assert presence rather than uniqueness.
    expect(within(container).getAllByText(/Skew/i).length).toBeGreaterThan(0);
  });

  it("GREEN: a single-key payload's KpiStrip emits no 'BASIS ·' eyebrow", () => {
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
      </FactsheetProvider>,
    );
    expect(container.innerHTML).not.toContain("BASIS ·");
  });
});

/**
 * Phase 90 review-fix (F2, HIGH) — the MTM toggle must NEVER fail open: a
 * PARTIAL persisted `mark_to_market` object (present but missing some of the
 * seven mapped scalars) must render "—" for the missing cells under the
 * "BASIS · MARK-TO-MARKET" eyebrow, NEVER the cash value. The pre-fix overlay
 * (`overlayBasisScalars(..., mark_to_market ?? {})`) left the cash number in
 * place — a mislabeled cash-as-MTM leak (no-invented-data violation D5).
 *
 * This fixture forces the display path with `mtmGate.available:true` while the
 * MTM object carries ONLY `cumulative_return`; a correct implementation shows
 * the MTM cumulative and "—" for the six absent scalars.
 */
function readKpiCell(container: HTMLElement, label: string): string | null {
  const kpiGrid = Array.from(
    container.querySelectorAll<HTMLElement>("div.grid"),
  ).find((el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className));
  if (!kpiGrid) return null;
  for (const tile of Array.from(kpiGrid.children) as HTMLElement[]) {
    const ps = Array.from(tile.querySelectorAll("p"));
    if (ps.length === 2 && ps[0].textContent?.trim() === label) {
      return ps[1].textContent?.trim() ?? null;
    }
  }
  return null;
}

describe("FactsheetView KPI strip — Phase 90 F2: MTM never fails open", () => {
  function partialMtmPayload(): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    // Pin cash sentinels so the pre-fix (leaked-cash) values are deterministic
    // and unmistakably NOT "—".
    p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
    p.strategyMetrics.sharpe = KP_CASH.sharpe;
    p.strategyMetrics.sortino = KP_CASH.sortino;
    p.strategyMetrics.calmar = KP_CASH.calmar;
    p.strategyMetrics.ann_vol = KP_CASH.volatility;
    p.strategyMetrics.max_dd = KP_CASH.max_drawdown;
    p.strategyMetrics.cagr = KP_CASH.cagr;
    return {
      ...p,
      dataQuality: { composite: true },
      // MTM present but PARTIAL — only cumulative_return; the other six absent.
      metricsByBasis: {
        cash_settlement: KP_CASH,
        mark_to_market: { cumulative_return: 0.5 },
      },
      mtmGate: { available: true },
    } as unknown as FactsheetPayload;
  }

  it("under MTM, the six ABSENT mapped scalars render '—', not the cash value", () => {
    const { getByText, container } = renderComposite(partialMtmPayload());
    fireEvent.click(getByText("Mark-to-market"));

    // The one present MTM scalar shows its MTM value.
    expect(readKpiCell(container, "Cum. Return")).toBe("+50.0%");
    // The six absent scalars must be "—" (NaN), NEVER the cash sentinel.
    expect(readKpiCell(container, "Sharpe")).toBe("—");
    expect(readKpiCell(container, "Sortino")).toBe("—");
    expect(readKpiCell(container, "Calmar")).toBe("—");
    expect(readKpiCell(container, "Ann. Vol")).toBe("—");
    expect(readKpiCell(container, "Max DD")).toBe("—");
    expect(readKpiCell(container, "CAGR")).toBe("—");
    // Explicit anti-regression: pre-fix these showed the leaked cash numbers.
    expect(readKpiCell(container, "Sharpe")).not.toBe("1.40");
  });

  it("toggling back to cash restores every cash value", () => {
    const { getByText, container } = renderComposite(partialMtmPayload());
    fireEvent.click(getByText("Mark-to-market"));
    fireEvent.click(getByText("Cash settlement"));
    expect(readKpiCell(container, "Sharpe")).toBe("1.40");
    expect(readKpiCell(container, "Cum. Return")).toBe("+62.7%");
  });
});

/**
 * Phase 90 review-fix (F6, IN-05) — the sr-only stitched-track summary must not
 * read "1 keys" / claim "handoffs" for a single-member composite (0 boundaries).
 */
describe("FactsheetView — Phase 90 F6: sr-only stitched summary grammar", () => {
  function singleMemberComposite(): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    // Composite with NO segmentBoundaries (seq 1 only) ⇒ 1 key, 0 handoffs.
    return {
      ...p,
      dataQuality: { composite: true },
      metricsByBasis: { cash_settlement: KP_CASH },
      mtmGate: { available: false },
    } as unknown as FactsheetPayload;
  }

  it("reads 'Stitched from 1 key.' (singular) and omits the handoff clause", () => {
    const { container } = renderComposite(singleMemberComposite());
    const summary = Array.from(container.querySelectorAll(".sr-only")).find((el) =>
      el.textContent?.includes("Stitched from"),
    );
    const text = (summary?.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(text).toContain("Stitched from 1 key.");
    expect(text).not.toMatch(/\b1 keys\b/);
    expect(text).not.toContain("handoff");
  });
});

describe("FactsheetView hero strip — HARD-04 insufficient_window server-truth caveat", () => {
  // n=300 (>=252) so the client-count n<252 heuristic caveat does NOT fire —
  // isolating the SERVER-truth insufficient_window signal.
  function insufficientWindowPayload(insufficientWindow: boolean): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    return {
      ...p,
      dataQuality: { composite: true, insufficientWindow },
    } as unknown as FactsheetPayload;
  }

  it("renders the server-truth caveat when dataQuality.insufficientWindow is true", () => {
    const { getByText } = renderComposite(insufficientWindowPayload(true));
    expect(
      getByText(/annualized metrics are flagged as computed on an insufficient window/),
    ).toBeInTheDocument();
  });

  it("does NOT render the caveat when insufficientWindow is absent/false", () => {
    const { queryByText } = renderComposite(insufficientWindowPayload(false));
    expect(
      queryByText(/annualized metrics are flagged as computed on an insufficient window/),
    ).not.toBeInTheDocument();
  });
});
