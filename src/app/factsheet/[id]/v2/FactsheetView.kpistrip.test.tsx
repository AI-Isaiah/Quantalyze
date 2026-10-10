import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within, screen } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { pctSigned } from "./format";

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
 *      never reflow — and a container-narrow base below it. Phase 170 (j)
 *      replaced the 52-06 `grid-cols-3` base with `grid-cols-2 @md:grid-cols-3`
 *      (see Test 1).
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
// Phase 140.5-01 / SEAMPROSE-04 — installed PER TEST, not at module scope.
// `vitest.config.ts` sets `unstubGlobals: true`, which restores stubbed globals
// before every test, so a stub applied once at import time is gone by the time
// the first test runs. Re-applying it here also removes a real leak: a stub set
// at module scope is never undone, so it reaches every later file in the same
// worker (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
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
    // Phase 170 (j), 2026-09-30 — supersedes the Phase 52-06 three-column
    // fallback. The 2026-09-27 PROD measurement found three columns too narrow
    // at 390 px and in the ~326 px composer mount: values broke mid-number and
    // labels ellipsised ("SOR…", "CAL…", "MAX…"). The container ladder is now
    // 2 columns, 3 from `@md` (28rem), and the full row from `@5xl`.
    expect(kpiGrid!.className).toMatch(/\bgrid-cols-2\b/);
    expect(kpiGrid!.className).toContain("@md:grid-cols-3");
    // No bare three-column base. `\b` would also match `@md:grid-cols-3`
    // (`:` is a non-word character), so the arm is whitespace-anchored.
    expect(kpiGrid!.className).not.toMatch(/(^|\s)grid-cols-3(\s|$)/);
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
      // UIFIX-03 (117-03) SUPERSEDES the old `no wrap mid-number` value pin: an
      // extreme high-leverage magnitude must render IN FULL, so the value cell
      // now carries a `break-words` wrap allowance and NONE of the truncation
      // trio (a truncated number reads as a different number — Numbers Contract).
      // Only the LABEL below keeps its bounded-label clip.
      expect(valueEl.className).toContain("break-words");
      expect(valueEl.className).not.toContain("whitespace-nowrap");
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
    const { getByText, getAllByText, container } = renderComposite(compositeKpiPayload());

    // Scope the VALUE assertions to the KPI strip grid: the equity chart's Y-axis
    // also renders a round "+50.0%" tick, so a body-scoped getByText("+50.0%")
    // would match the axis label too. Phase 103 (F4): this fixture carries NO series
    // bundle, so under MTM the KpiStrip headline eyebrow reads MTM while the rail
    // eyebrow stays blank (gated on bundle presence) — assert with getAllByText and a
    // `>= 1` count (the KpiStrip eyebrow alone), tolerant of either eyebrow policy.
    const kpiGrid = () =>
      within(
        Array.from(container.querySelectorAll<HTMLElement>("div.grid")).find(
          (el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className),
        )!,
      );

    // No basis toggle exists yet → getByText throws (RED). After 90-05 this
    // drives the KpiStrip relabel.
    fireEvent.click(getByText("Mark-to-market"));
    // The KpiStrip headline eyebrow reads "BASIS · MARK-TO-MARKET" under MTM (the rail
    // eyebrow stays blank here — no series bundle, F4).
    expect(getAllByText("BASIS · MARK-TO-MARKET").length).toBeGreaterThanOrEqual(1);
    expect(kpiGrid().getByText("+50.0%")).toBeTruthy(); // MTM cumulative_return sentinel

    fireEvent.click(getByText("Cash settlement"));
    // Under cash the KpiStrip eyebrow reads CASH SETTLEMENT (unique — the rail eyebrow
    // holds its blank reserved line under cash).
    expect(getByText("BASIS · CASH SETTLEMENT")).toBeTruthy();
    expect(kpiGrid().getByText("+62.7%")).toBeTruthy(); // cash cumulative_return sentinel
  });

  it("F4: with NO series bundle the rail eyebrow does NOT mislabel cash as MTM (only the KpiStrip headline reads MTM)", () => {
    // `compositeKpiPayload()` carries the persisted MTM SCALARS but NO seriesByBasis
    // BUNDLE — so under MTM the KpiStrip headline swaps (persisted overlay) while the
    // rail's dailies panels FALL BACK to cash (see the sibling caption test). F4: the
    // rail eyebrow is gated on bundle PRESENCE, so it must stay BLANK here — labelling
    // the cash rail "BASIS · MARK-TO-MARKET" would be the mislabel this fix removes.
    const { getByText, getAllByText, queryByText } = renderComposite(compositeKpiPayload());
    // Cash default: neither eyebrow reads MTM; the rail eyebrow holds its blank line.
    expect(queryByText("BASIS · MARK-TO-MARKET")).toBeNull();
    fireEvent.click(getByText("Mark-to-market"));
    // Under MTM only the KpiStrip headline eyebrow reads MTM (ONE match). The rail
    // eyebrow stays blank because the bundle is absent — neuter F4 (gate on basis
    // alone) → the rail eyebrow also flips → TWO matches → RED.
    expect(getAllByText("BASIS · MARK-TO-MARKET").length).toBe(1);
    // And it never emits the wrong "BASIS · CASH SETTLEMENT" warning under MTM.
    expect(queryByText("BASIS · CASH SETTLEMENT")).toBeNull();
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

  // Finding B (Phase 92 hardening): the caveat surface must NOT be gated on
  // `composite` — a SINGLE-KEY strategy (`dataQuality.composite === false`, the
  // shape `singleKeyDataQuality` now threads on both pages' non-composite arm)
  // with the server-truth flag must render the identical caveat. Pre-Finding-B the
  // single-key arm never set `dataQuality`, so this surface was dead single-key;
  // this pins that FactsheetView renders on the flag alone, composite or not.
  function singleKeyInsufficientWindowPayload(insufficientWindow: boolean): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    return {
      ...p,
      dataQuality: { composite: false, insufficientWindow },
    } as unknown as FactsheetPayload;
  }

  it("SINGLE-KEY (composite:false): renders the server-truth caveat when insufficientWindow is true", () => {
    const { getByText } = renderComposite(singleKeyInsufficientWindowPayload(true));
    expect(
      getByText(/annualized metrics are flagged as computed on an insufficient window/),
    ).toBeInTheDocument();
  });

  it("SINGLE-KEY (composite:false): does NOT render the caveat when insufficientWindow is false", () => {
    const { queryByText } = renderComposite(singleKeyInsufficientWindowPayload(false));
    expect(
      queryByText(/annualized metrics are flagged as computed on an insufficient window/),
    ).not.toBeInTheDocument();
  });
});

describe("FactsheetView hero strip — D-25 small_base_measured server-truth caveat", () => {
  // n=300 (>=252) so the client-count n<252 heuristic caveat does NOT fire, and a
  // single-key payload (composite:false) because a BTC MT5 account is single-key.
  const SMALL_BASE_COPY =
    "Some days were measured on a very small balance, so their returns can be extreme.";

  function smallBasePayload(smallBaseMeasured: boolean | undefined): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    return {
      ...p,
      dataQuality: {
        composite: false,
        ...(smallBaseMeasured === undefined ? {} : { smallBaseMeasured }),
      },
    } as unknown as FactsheetPayload;
  }

  it("renders the founder's copy when dataQuality.smallBaseMeasured is true", () => {
    const { getByText } = renderComposite(smallBasePayload(true));
    expect(getByText(new RegExp(SMALL_BASE_COPY))).toBeInTheDocument();
  });

  it("does NOT render it when the flag is false or absent", () => {
    for (const flag of [false, undefined]) {
      const { queryByText, unmount } = renderComposite(smallBasePayload(flag));
      expect(queryByText(/measured on a very small balance/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("uses the existing amber caveat styling, not a new component", () => {
    const { getByText } = renderComposite(smallBasePayload(true));
    const el = getByText(new RegExp(SMALL_BASE_COPY));
    expect(el.tagName).toBe("P");
    expect(el.className).toContain("text-micro");
    expect(el.getAttribute("style") ?? "").toContain("var(--color-warning");
  });
});

describe("FactsheetView hero strip — HARD-05 degraded_members server-truth caveat", () => {
  // n=300 (>=252) so the client-count n<252 heuristic caveat does NOT fire —
  // isolating the SERVER-truth degraded-member signal.
  function degradedPayload(
    degradedMembers: Array<{ seq: number; venue: string }>,
  ): FactsheetPayload {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    return {
      ...p,
      dataQuality: { composite: true, degradedMembers },
    } as unknown as FactsheetPayload;
  }

  it("renders the degraded-member caveat naming the excluded key + venue", () => {
    const { getByText } = renderComposite(
      degradedPayload([{ seq: 2, venue: "bybit" }]),
    );
    expect(getByText(/Key 2 \(bybit\)/)).toBeInTheDocument();
    expect(
      getByText(/excluded from this track record/),
    ).toBeInTheDocument();
  });

  it("names every excluded member for a multi-degrade composite", () => {
    const { getByText } = renderComposite(
      degradedPayload([
        { seq: 2, venue: "bybit" },
        { seq: 3, venue: "okx" },
      ]),
    );
    expect(getByText(/Key 2 \(bybit\), Key 3 \(okx\)/)).toBeInTheDocument();
    // Plural pronoun for >1 excluded member.
    expect(getByText(/their data is excluded/)).toBeInTheDocument();
  });

  it("does NOT render the caveat when degradedMembers is empty/absent", () => {
    const { queryByText } = renderComposite(degradedPayload([]));
    expect(queryByText(/excluded from this track record/)).not.toBeInTheDocument();
    const { queryByText: q2 } = renderComposite(
      {
        ...buildScenarioFactsheetPayload({
          portfolioDaily: makeReturnsSeries(300),
          benchmark: null,
        }),
        dataQuality: { composite: true },
      } as unknown as FactsheetPayload,
    );
    expect(q2(/excluded from this track record/)).not.toBeInTheDocument();
  });
});

/**
 * Phase 117 (UIFIX-03) — the CUM RETURN KPI VALUE cell must render extreme,
 * high-leverage magnitudes IN FULL: no truncation, no `…` ellipsis. A truncated
 * number reads as a DIFFERENT number (Numbers-Contract integrity defect). The
 * culprit is the value `<p>`'s truncation trio (`whitespace-nowrap
 * overflow-hidden text-ellipsis`, FactsheetView.tsx:884). The fix is layout
 * (allow the value to wrap/fit) — the type is NEVER shrunk below the DESIGN.md
 * `text-h2` minimum. The LABEL `<p>` KEEPS its pinned bounded-label clip.
 *
 * jsdom renders full textContent regardless of CSS, so the load-bearing,
 * checkable no-ellipsis contract is the ABSENCE of the truncation trio on the
 * value `<p>` (the trio IS the clip mechanism).
 */
describe("FactsheetView KPI strip — UIFIX-03 (117-03): CUM RETURN extreme value renders untruncated", () => {
  // Extreme magnitude (e.g. under high leverage). Derived through the REAL
  // `pctSigned` formatter — no hand-fabricated rendered string (oracle
  // discipline). 12345.678 → pctSigned(.,1) === "+1234567.8%" (a long string
  // the pre-fix trio ellipsis-truncated inside the KPI cell).
  const EXTREME_CUM_RET = 12345.678;

  function renderExtreme() {
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    // Under cash the view returns the payload by reference, so overriding the
    // persisted scalar drives the rendered KPI (mirrors the Phase-90 fixtures).
    payload.strategyMetrics.cum_ret = EXTREME_CUM_RET;
    // A non-finite metric exercises the colorless "—" tone gate (Test 3).
    payload.strategyMetrics.sharpe = NaN;
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
      </FactsheetProvider>,
    );
  }

  function kpiTiles(container: HTMLElement): HTMLElement[] {
    const kpiGrid = Array.from(
      container.querySelectorAll<HTMLElement>("div.grid"),
    ).find((el) => /@[\w[\]-]*:grid-cols-\d/.test(el.className))!;
    expect(kpiGrid, "KPI strip grid must exist").toBeDefined();
    return Array.from(kpiGrid.children) as HTMLElement[];
  }

  function cell(
    container: HTMLElement,
    label: string,
  ): { labelEl: HTMLElement; valueEl: HTMLElement } {
    for (const tile of kpiTiles(container)) {
      const ps = Array.from(tile.querySelectorAll("p")) as HTMLElement[];
      if (ps.length === 2 && ps[0].textContent?.trim() === label) {
        return { labelEl: ps[0], valueEl: ps[1] };
      }
    }
    throw new Error(`KPI cell "${label}" not found`);
  }

  it("Test 1 (RED until 117-03 fix) — the CUM RETURN value renders in FULL with NONE of the truncation trio; type stays at text-h2 (never shrunk)", () => {
    const { container } = renderExtreme();
    const expected = pctSigned(EXTREME_CUM_RET, 1); // real formatter path
    const { valueEl } = cell(container, "Cum. Return");

    // (a) Full text present — jsdom renders full textContent regardless of CSS.
    expect(valueEl.textContent?.trim()).toBe(expected);
    expect(expected.length).toBeGreaterThan("+62.7%".length); // it IS long/extreme

    // (b) The checkable no-ellipsis contract: the truncation trio (the clip
    //     mechanism) is ABSENT on the VALUE <p>. This is the assertion that is
    //     RED on the current tree and GREEN after the layout fix.
    expect(valueEl.className).not.toContain("whitespace-nowrap");
    expect(valueEl.className).not.toContain("overflow-hidden");
    expect(valueEl.className).not.toContain("text-ellipsis");

    // (c) Type never shrunk below the DESIGN.md text-h2 minimum — the value keeps
    //     its mono tabular text-h2 and gains NO smaller type token. Phase-117
    //     IN-03: leading-tight (not leading-none) so a value wrapped by break-words
    //     gets readable inter-line spacing without changing the text-h2 size token.
    expect(valueEl.className).toContain("font-mono");
    expect(valueEl.className).toContain("tabular-nums");
    expect(valueEl.className).toContain("text-h2");
    expect(valueEl.className).toContain("leading-tight");
    expect(valueEl.className).not.toContain("leading-none");
    expect(valueEl.className).not.toMatch(
      /\btext-(h3|base|sm|xs|caption|micro|fixed-13)\b/,
    );
  });

  it("Test 2 (guard, green before+after) — the CUM RETURN LABEL keeps its pinned bounded-label clip (whitespace-nowrap/overflow-hidden/text-ellipsis)", () => {
    const { container } = renderExtreme();
    const { labelEl } = cell(container, "Cum. Return");
    // The AUDIT-classified legitimate clip on the KPI label <p> — NOT removed.
    expect(labelEl.className).toContain("whitespace-nowrap");
    expect(labelEl.className).toContain("overflow-hidden");
    expect(labelEl.className).toContain("text-ellipsis");
  });

  it("Test 3 (guard, green before+after) — every value cell shares ONE className (sibling uniformity), and the signTone gate is unchanged (positive→--color-positive, — colorless)", () => {
    const { container } = renderExtreme();
    const tiles = kpiTiles(container);

    // Uniform by items.map construction — all value <p>s share one className, so
    // the single-class change can never visually diverge CAGR/Sharpe/Sortino.
    const valueClassNames = tiles.map((t) => {
      const ps = Array.from(t.querySelectorAll("p"));
      return ps[1].className;
    });
    expect(new Set(valueClassNames).size).toBe(1);

    // signTone: a finite positive cum_ret is colored var(--color-positive) ...
    const { valueEl: cumEl } = cell(container, "Cum. Return");
    expect(cumEl.style.color).toBe("var(--color-positive)");
    // ... and a non-finite metric renders "—" with NO tone (text-primary), never
    // a red/green tint on a dash (Numbers Contract unchanged).
    const { valueEl: sharpeEl } = cell(container, "Sharpe");
    expect(sharpeEl.textContent?.trim()).toBe("—");
    expect(sharpeEl.style.color).toBe("var(--color-text-primary)");
  });
});

/**
 * Phase 164.6.6.3.1 plan 04, item 6d (D-09). The alpha cell's eyebrow is CSS
 * uppercase, and uppercase turns the real alpha glyph into a capital alpha
 * ("A VS BTC", a different-looking symbol that reads as a misspelt "A"). The
 * glyph must survive: the label `<p>` carries `first-letter:normal-case`, but
 * ONLY when the label starts with alpha, because the same pseudo-element on
 * "Sharpe" would render "sHARPE". The DOM text stays "α vs BTC" (a wrapping
 * span would change the element's own text nodes and break the six
 * `getByText("α vs ...")` locators in FactsheetBody.joint-floor / .basis).
 *
 * Fixture: a record that pairs with BTC (30 days, benchmark prices from the day
 * before), so a real "α vs BTC" cell mounts. The scenario payload used above is
 * built with `benchmark: null` and so has no alpha cell.
 */
describe("FactsheetView KPI strip — 164.6.6.3.1 D-09: the alpha eyebrow keeps its glyph under the uppercase", () => {
  const DAY = 86_400_000;
  const addDays = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

  function mountWithAlpha() {
    const start = "2026-04-27";
    const n = 30;
    const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
      date: addDays(start, i),
      value: ((i % 7) - 3) / 1000,
    }));
    const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
      date: addDays(start, i - 1),
      close: 90000 + ((i * 37) % 11) * 250,
    }));
    const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
    const payload = buildFactsheetPayload(
      {
        id: "s-164-6-6-3-1-d09",
        name: "Alpha Eyebrow Strategy",
        types: ["quant"],
        markets: ["crypto"],
        computedAt: "2026-09-30T00:00:00Z",
        trustTier: null,
        assetClass: "crypto",
        ingestSource: "api" as const,
      },
      rows,
      { benchmarkPrices: opt },
    );
    if (!payload) throw new Error("fixture must build a payload");
    const active = { ...payload, activeComparator: "btc" as const };
    return render(
      <FactsheetProvider payload={active} persist={false}>
        <FactsheetBody payload={active} hideHeader hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
  }

  const tokens = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

  it("D-09: the α label is exempt from the uppercase on its first letter, keeps uppercase + the bounded clip, and its text stays \"α vs BTC\"", () => {
    mountWithAlpha();
    const label = screen.getByText("α vs BTC");
    expect(label.getAttribute("data-testid")).toBe("factsheet-kpi-label");
    const t = tokens(label);
    expect(t).toContain("first-letter:normal-case");
    expect(t).toContain("uppercase");
    expect(t).toContain("whitespace-nowrap");
    expect(t).toContain("text-ellipsis");
    expect(label.textContent).toBe("α vs BTC");
  });

  it("D-09: a non-α label carries no first-letter exemption (it would render \"sHARPE\")", () => {
    mountWithAlpha();
    const sharpe = screen
      .getAllByTestId("factsheet-kpi-label")
      .find((el) => el.textContent?.trim() === "Sharpe");
    expect(sharpe, "the Sharpe KPI cell must mount").toBeDefined();
    expect(tokens(sharpe!)).not.toContain("first-letter:normal-case");
    expect(tokens(sharpe!)).toContain("uppercase");
  });
});

/**
 * Phase 164.6.6.3.3 plan 09 (B1-B6, D-07, UI-SPEC 3.4). The strip's five toned
 * cells (Cum. Return, CAGR, Max DD, α, IR) take their printed sign and their tone
 * from the value ROUNDED to the cell's precision: 1dp of a percent for the three
 * returns and Max DD, 2dp for IR. A value that rounds to zero is neutral and
 * unsigned, so -0.0004 prints "0.0%" in the primary colour instead of a red
 * "-0.0%", and an exact 0 is no longer a green "+0.0%". Every other value keeps
 * today's tone (the Test 3 gate above stays true).
 *
 * Expected strings are hand-typed, never produced by the formatter under test.
 */
describe("FactsheetView KPI strip — 164.6.6.3.3 plan 09: tone and sign from the rounded value", () => {
  const DAY = 86_400_000;
  const addDays = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  const POS = "var(--color-positive)";
  const NEG = "var(--color-negative)";
  const PRIMARY = "var(--color-text-primary)";

  type Over = {
    cum_ret?: number;
    cagr?: number;
    max_dd?: number;
    alpha?: number;
    info_ratio?: number;
  };

  /** A real 30-day payload paired with BTC, then the five cells overridden (cash view returns it by reference). */
  function mountWith(over: Over) {
    const start = "2026-04-27";
    const n = 30;
    const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
      date: addDays(start, i),
      value: ((i % 7) - 3) / 1000,
    }));
    const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
      date: addDays(start, i - 1),
      close: 90000 + ((i * 37) % 11) * 250,
    }));
    const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
    const base = buildFactsheetPayload(
      {
        id: "s-164-6-6-3-3-09-tone",
        name: "Tone Strategy",
        types: ["quant"],
        markets: ["crypto"],
        computedAt: "2026-10-09T00:00:00Z",
        trustTier: null,
        assetClass: "crypto",
        ingestSource: "api" as const,
      },
      rows,
      { benchmarkPrices: opt },
    );
    if (!base) throw new Error("fixture must build a payload");
    const { alpha, info_ratio, ...metrics } = over;
    const btcBlock = base.comparators.btc;
    const payload: FactsheetPayload = {
      ...base,
      activeComparator: "btc",
      strategyMetrics: { ...base.strategyMetrics, ...metrics },
      comparators: {
        ...base.comparators,
        btc: {
          ...btcBlock,
          joint: {
            ...btcBlock.joint!,
            ...(alpha !== undefined ? { alpha } : {}),
            ...(info_ratio !== undefined ? { info_ratio } : {}),
          },
        },
      },
    };
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
  }

  function strip(label: string): { text: string; color: string } {
    const lab = screen.getAllByTestId("factsheet-kpi-label").find((l) => l.textContent === label);
    if (!lab) throw new Error(`no strip cell ${label}`);
    const val = lab.parentElement!.querySelector('[data-testid="factsheet-kpi-value"]') as HTMLElement;
    return { text: val.textContent ?? "", color: val.style.color };
  }

  it.each([
    ["Cum. Return", "cum_ret"],
    ["CAGR", "cagr"],
  ] as const)("%s: exactly 0 and a value that rounds to 0 print 0.0% in the primary colour", (label, key) => {
    for (const v of [0, -0, -0.0004, 0.0004]) {
      const { unmount } = mountWith({ [key]: v });
      expect(strip(label), `${key}=${v}`).toEqual({ text: "0.0%", color: PRIMARY });
      unmount();
    }
  });

  it.each([
    ["Cum. Return", "cum_ret"],
    ["CAGR", "cagr"],
  ] as const)("%s: a real gain is signed green, a real loss red (today's tone, unchanged)", (label, key) => {
    const up = mountWith({ [key]: 0.0512 });
    expect(strip(label)).toEqual({ text: "+5.1%", color: POS });
    up.unmount();
    const down = mountWith({ [key]: -0.0512 });
    expect(strip(label)).toEqual({ text: "-5.1%", color: NEG });
    down.unmount();
  });

  it("Max DD: -0.0004 and exactly 0 print 0.0% uncoloured; a real drawdown is red; a dash stays uncoloured", () => {
    for (const v of [-0.0004, 0, -0]) {
      const { unmount } = mountWith({ max_dd: v });
      expect(strip("Max DD"), `max_dd=${v}`).toEqual({ text: "0.0%", color: PRIMARY });
      unmount();
    }
    const real = mountWith({ max_dd: -0.0368 });
    expect(strip("Max DD")).toEqual({ text: "-3.7%", color: NEG });
    real.unmount();
    mountWith({ max_dd: NaN });
    expect(strip("Max DD")).toEqual({ text: "—", color: PRIMARY });
  });

  it("α vs BTC: +/-0.0004 prints 0.0% uncoloured; a real alpha keeps its sign and tone", () => {
    for (const v of [-0.0004, 0.0004, 0]) {
      const { unmount } = mountWith({ alpha: v });
      expect(strip("α vs BTC"), `alpha=${v}`).toEqual({ text: "0.0%", color: PRIMARY });
      unmount();
    }
    const up = mountWith({ alpha: 0.1234 });
    expect(strip("α vs BTC")).toEqual({ text: "+12.3%", color: POS });
    up.unmount();
    mountWith({ alpha: -0.1234 });
    expect(strip("α vs BTC")).toEqual({ text: "-12.3%", color: NEG });
  });

  it("IR vs BTC (2dp): -0.004 and 0.004 print 0.00 uncoloured; -0.006 prints -0.01 red; 0.5 prints 0.50 green", () => {
    for (const v of [-0.004, 0.004, 0]) {
      const { unmount } = mountWith({ info_ratio: v });
      expect(strip("IR vs BTC"), `ir=${v}`).toEqual({ text: "0.00", color: PRIMARY });
      unmount();
    }
    const down = mountWith({ info_ratio: -0.006 });
    expect(strip("IR vs BTC")).toEqual({ text: "-0.01", color: NEG });
    down.unmount();
    mountWith({ info_ratio: 0.5 });
    expect(strip("IR vs BTC")).toEqual({ text: "0.50", color: POS });
  });

  it("Sharpe, Sortino, Calmar and Ann. Vol are unchanged: no tone, ratios at toFixed(2)", () => {
    mountWith({});
    for (const label of ["Sharpe", "Sortino", "Calmar", "Ann. Vol"]) {
      expect(strip(label).color, label).toBe(PRIMARY);
    }
  });
});
