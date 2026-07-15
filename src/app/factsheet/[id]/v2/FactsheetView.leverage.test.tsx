import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { pct, pctSigned } from "./format";

/**
 * Phase 107 (LEV-BB, D1/D2 + UI-SPEC) — the factsheet leverage control surface,
 * REWIRED onto the leverage-composed `useBasisSeriesView` (plan 01).
 *
 * At L≠1 the WHOLE factsheet re-derives levered (the strip's seven headline scalars,
 * the comparator α/β/IR, the charts, and the right rail all follow), and the dishonesty
 * apparatus that plan 90.5 needed — the amber MODELED eyebrow, the "everything else
 * stays on the base 1× track" caveat, the α/IR leverage-blanking, and the BASE·1× rail
 * eyebrow — is DELETED. What remains is a MUTED, honest what-if caption inserted only at
 * L≠1 (SC-4: L=1 is byte-identical) and the (reworded) clamp messages.
 *
 * The eligibility gate is FAIL-CLOSED and now widened to the ACTIVE RESOLVED basis:
 * the control renders IFF `composite !== true` AND `periodsPerYear != null` AND the
 * basis is NOT an UNRESOLVED mark_to_market (MTM displayed without a series bundle).
 *
 * Perf note (plan Task 1): at L≠1 these component tests execute the full
 * `deriveSeriesBundle` (incl. bootstrapCI) per consumer, so the fixtures that DIAL
 * leverage are kept ~50 days and start inside the BTC benchmark window (2023-04-26+)
 * so the comparator joint is non-degenerate.
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

// Long series (300d) for the NON-dialing gate/identity tests — no re-derive runs.
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

// Short series (~50d) for the tests that DIAL leverage (each dial re-derives the whole
// bundle per consumer). Starts 2023-05-01 so it overlaps BTC_DAILY (from 2023-04-26)
// and the comparator joint is real, not degenerate.
function smallSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 4, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.006,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const SMALL_STRAT = smallSeries(50, 0.0018);
const SMALL_BENCH = smallSeries(50, 0.0009);

// A single-key cash fixture whose strategyMetrics AND injected comparator joint are the
// REAL `deriveSeriesBundle(@365)` values — so at L=1 the strip shows the derived base and
// at L=2 the levered re-derive is provably 2× it (vol homogeneous deg-1; α → L·α).
function buildSmall(): { payload: FactsheetPayload; base: ReturnType<typeof deriveSeriesBundle> } {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: SMALL_STRAT,
    benchmark: SMALL_BENCH,
    periodsPerYear: 365,
  });
  const clipped = p.strategyReturns.map((r, i) => ({ date: p.dates[i], value: r }));
  const base = deriveSeriesBundle(clipped, {
    periodsPerYear: 365,
    isArithmetic: false,
    markets: p.markets,
    strategyName: p.strategyName,
  });
  const payload = {
    ...p,
    periodsPerYear: 365,
    comparators: {
      ...p.comparators,
      btc: { ...p.comparators.btc, joint: base.comparators.btc.joint },
    },
  } as FactsheetPayload;
  return { payload, base };
}
const SMALL = buildSmall();

// v5 single-key (300d) — the ONLY non-dialing shape that renders the control on cash
// (composite !== true AND periodsPerYear present).
function v5SingleKey(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  return { ...p, periodsPerYear: 365 } as FactsheetPayload;
}

// v4-shaped single-key (no periodsPerYear) — fail-closed: control hidden.
function v4SingleKey(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
}

const MTM_SCALARS = {
  cumulative_return: 0.5,
  volatility: 0.11,
  max_drawdown: -0.038,
  cagr: 0.26,
  sharpe: 1.2,
  sortino: 1.9,
  calmar: 2.7,
};

// Single-key options, MTM AVAILABLE, WITH a real series bundle + periodsPerYear — the
// leverage input renders on the RESOLVED MTM basis (eligibility widen).
function fixtureMtmWithBundle(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: smallSeries(50, 0.0012),
    benchmark: null,
    periodsPerYear: 365,
  });
  const clipped = p.strategyReturns.map((r, i) => ({ date: p.dates[i], value: r }));
  return {
    ...p,
    periodsPerYear: 365,
    mtmGate: { available: true },
    metricsByBasis: { mark_to_market: MTM_SCALARS },
    seriesByBasis: {
      mark_to_market: deriveSeriesBundle(clipped, {
        periodsPerYear: 365,
        isArithmetic: false,
        markets: p.markets,
        strategyName: p.strategyName,
      }),
    },
  } as unknown as FactsheetPayload;
}

// Single-key options, MTM available but UNRESOLVED (no series bundle) — the leverage
// input hides under MTM (mirrors the view's no-fabrication guard).
function fixtureMtmNoBundle(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: smallSeries(50, 0.0012),
    benchmark: null,
    periodsPerYear: 365,
  });
  return {
    ...p,
    periodsPerYear: 365,
    mtmGate: { available: true },
    metricsByBasis: { mark_to_market: MTM_SCALARS },
  } as unknown as FactsheetPayload;
}

const KP_CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

function v5Composite(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
  return {
    ...p,
    periodsPerYear: 365,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: KP_CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function v4Composite(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
  return {
    ...p,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: KP_CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

// The reworded what-if disclosure (UI-SPEC Copywriting Contract, verbatim). {L}=2.
const CAPTION_PREFIX = "What-if projection at";
const CAPTION_L2 =
  "What-if projection at 2× leverage: daily returns are scaled r → L·r and the whole factsheet re-derives. Excludes borrow, funding, and liquidation cost — not the strategy's realized track record.";
// Clamp messages (UI-SPEC error copy, verbatim — MAX_LEVERAGE interpolated to 10).
const CLAMP_MAX_MSG =
  "Leverage clamped to 10× — the maximum in this what-if projection.";
const CLAMP_NEG_MSG =
  "Leverage can't be negative — shorting isn't included in this what-if. Clamped to 0.";
const NON_FINITE_MSG =
  "Invalid leverage — enter a number between 0 and 10. The previous value was kept.";

const levInput = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>("#leverage-factsheet");

function kpiGrid(c: HTMLElement): HTMLElement {
  return Array.from(c.querySelectorAll<HTMLElement>("div.grid")).find((el) =>
    /@[\w[\]-]*:grid-cols-\d/.test(el.className),
  )!;
}

function readCell(c: HTMLElement, label: string): string | null {
  const grid = kpiGrid(c);
  if (!grid) return null;
  for (const tile of Array.from(grid.children) as HTMLElement[]) {
    const ps = Array.from(tile.querySelectorAll("p"));
    if (ps.length === 2 && ps[0].textContent?.trim() === label) {
      return ps[1].textContent?.trim() ?? null;
    }
  }
  return null;
}

describe("FactsheetView — LEV-BB leverage control eligibility gate (fail-closed, widened)", () => {
  it("renders a labeled LEVERAGE input on a single-key v5 payload (composite !== true AND periodsPerYear present)", () => {
    const { container } = renderBody(v5SingleKey());
    const input = levInput(container);
    expect(input).not.toBeNull();
    const label = container.querySelector<HTMLLabelElement>(
      'label[for="leverage-factsheet"]',
    );
    expect(label?.textContent?.trim()).toBe("LEVERAGE");
    expect(input!.getAttribute("type")).toBe("number");
    expect(input!.getAttribute("max")).toBe("10");
  });

  it("renders NO leverage input on a composite payload (composites hide it)", () => {
    const { container } = renderBody(v4Composite());
    expect(levInput(container)).toBeNull();
  });

  it("renders NO leverage input on a single-key payload WITHOUT periodsPerYear (fail-closed)", () => {
    const { container } = renderBody(v4SingleKey());
    expect(levInput(container)).toBeNull();
  });

  it("WIDEN — renders the leverage input under basis=mark_to_market WITH a series bundle", () => {
    const { container, getByText } = renderBody(fixtureMtmWithBundle());
    // Cash by default → input visible; toggle to the RESOLVED MTM basis.
    expect(levInput(container)).not.toBeNull();
    act(() => {
      fireEvent.click(getByText("Mark-to-market"));
    });
    // Leverage now levers the ACTIVE resolved (MTM) basis → input still visible.
    expect(levInput(container)).not.toBeNull();
  });

  it("WIDEN — hides the leverage input under basis=mark_to_market WITHOUT a bundle (no-fabrication)", () => {
    const { container, getByText } = renderBody(fixtureMtmNoBundle());
    expect(levInput(container)).not.toBeNull();
    act(() => {
      fireEvent.click(getByText("Mark-to-market"));
    });
    // MTM displayed UNRESOLVED (cash fallback) → the input hides, mirroring the view's
    // no-fabrication guard (levering cash under an MTM label is forbidden).
    expect(levInput(container)).toBeNull();
  });
});

describe("FactsheetView — LEV-BB WI-1: a composite with periodsPerYear can never reach a re-derive", () => {
  it("composite v5 (composite===true AND periodsPerYear present) renders NO control AND a KpiStrip byte-identical to the no-leverage composite render", () => {
    const withPPY = renderBody(v5Composite());
    const withoutPPY = renderBody(v4Composite());
    expect(levInput(withPPY.container)).toBeNull();
    expect(kpiGrid(withPPY.container).outerHTML).toBe(
      kpiGrid(withoutPPY.container).outerHTML,
    );
  });
});

describe("FactsheetView — LEV-BB L=1 baseline byte-identity (no caption/eyebrow/reset)", () => {
  it("at L=1 the view contains NO 'MODELED', NO what-if caption, NO 'Reset 1×'; the KPI grid is deterministic", () => {
    const { container } = renderBody(SMALL.payload);
    const html = container.innerHTML;
    expect(html).not.toContain("MODELED");
    expect(html).not.toContain(CAPTION_PREFIX);
    expect(html).not.toContain("Reset 1×");
    // SC-4 component pin: a second untouched render produces the byte-identical grid.
    const second = renderBody(SMALL.payload);
    expect(kpiGrid(container).outerHTML).toBe(kpiGrid(second.container).outerHTML);
  });
});

describe("FactsheetView — LEV-BB follow-L: the whole strip + caption re-derive levered", () => {
  it("at L=2 the Ann. Vol cell is exactly 2× the derived base, the muted what-if caption renders (role=status), NO amber MODELED eyebrow, and Reset restores L=1 byte-identically", () => {
    const { container, getByText, queryByText } = renderBody(SMALL.payload);
    const before = readCell(container, "Ann. Vol");
    const baselineGrid = kpiGrid(container).outerHTML;

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });

    // The strip's seven scalars followed L: Ann. Vol is homogeneous deg-1 → exactly 2×
    // the derived base (the levered re-derive, not a fabricated rescale).
    const after = readCell(container, "Ann. Vol");
    expect(after).not.toBe(before);
    expect(after).toBe(pct(2 * SMALL.base.strategyMetrics.ann_vol, 1));

    // The muted, honest what-if caption (verbatim UI-SPEC copy), announced politely.
    const caption = getByText(CAPTION_L2);
    expect(caption.getAttribute("role")).toBe("status");
    expect(caption.getAttribute("aria-live")).toBe("polite");
    // MUTED neutral, NOT amber — no MODELED eyebrow survives.
    expect(container.innerHTML).not.toContain("MODELED");

    // Reset restores the byte-identical L=1 grid and drops the caption.
    act(() => {
      fireEvent.click(getByText("Reset 1×"));
    });
    expect(queryByText(CAPTION_L2)).toBeNull();
    expect(queryByText("Reset 1×")).toBeNull();
    expect(kpiGrid(container).outerHTML).toBe(baselineGrid);
    expect(readCell(container, "Ann. Vol")).toBe(before);
    expect(levInput(container)!.value).toBe("1");
  });
});

describe("FactsheetView — LEV-BB honest α/IR: benchmark-relative stats follow L (no blanking)", () => {
  it("at L=2 with a comparator active the α cell shows a REAL value ≈ 2× the L=1 α (α → L·α), and IR is real — never '—' for a leverage reason", () => {
    const { container } = renderBody(SMALL.payload);
    const baseAlpha = SMALL.base.comparators.btc.joint!.alpha;

    // Baseline (L=1): the α cell shows the injected/derived base value.
    expect(readCell(container, "α vs BTC")).toBe(pctSigned(baseAlpha, 1));
    expect(readCell(container, "α vs BTC")).not.toBe("—");
    expect(readCell(container, "IR vs BTC")).not.toBe("—");

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });

    // Honest re-derive: α → L·α, so the cell is exactly 2× the base (at display
    // precision) — falsifiable against ANY re-blanking (would render "—").
    expect(readCell(container, "α vs BTC")).toBe(pctSigned(2 * baseAlpha, 1));
    expect(readCell(container, "α vs BTC")).not.toBe("—");
    expect(readCell(container, "IR vs BTC")).not.toBe("—");
  });

  it("'—' still renders for the SURVIVING MTM-bundle-absent reason (orthogonal basis concern, not leverage)", () => {
    // A comparator-active fixture with an MTM gate but NO series bundle: toggling to
    // MTM falls back to cash data, so α/IR are suppressed to avoid mislabeling cash.
    const payload = { ...SMALL.payload, mtmGate: { available: true } } as FactsheetPayload;
    const { container, getByText } = renderBody(payload);
    expect(readCell(container, "α vs BTC")).not.toBe("—");
    act(() => {
      fireEvent.click(getByText("Mark-to-market"));
    });
    expect(readCell(container, "α vs BTC")).toBe("—");
    expect(readCell(container, "IR vs BTC")).toBe("—");
  });
});

describe("FactsheetView — L-1: clearing the leverage input keeps the previous value", () => {
  it("emptying the field mid-edit does NOT snap to a flat 0× — the previous multiplier is kept", () => {
    const { container } = renderBody(SMALL.payload);
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "3" } });
    });
    expect(levInput(container)!.value).toBe("3");

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "" } });
    });
    // The controlled input keeps the prior multiplier — nothing snapped to 0.
    expect(levInput(container)!.value).toBe("3");
  });
});

describe("FactsheetView — LEV-BB fail-loud clamp messaging (UI-SPEC error copy verbatim)", () => {
  it("input 11 → value clamped to 10 + over-max message (MAX_LEVERAGE interpolated)", () => {
    const { container, getByText } = renderBody(SMALL.payload);
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "11" } });
    });
    expect(levInput(container)!.value).toBe("10");
    expect(getByText(CLAMP_MAX_MSG)).toBeTruthy();
  });

  it("input -1 → value clamped to 0 + negative message", () => {
    const { container, getByText } = renderBody(SMALL.payload);
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "-1" } });
    });
    expect(levInput(container)!.value).toBe("0");
    expect(getByText(CLAMP_NEG_MSG)).toBeTruthy();
  });

  it("non-numeric (non-finite) → previous value kept + non-finite message", () => {
    const { container, getByText } = renderBody(SMALL.payload);
    const input = levInput(container)!;
    const original = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "Infinity",
    });
    act(() => {
      fireEvent.change(input);
    });
    expect(getByText(NON_FINITE_MSG)).toBeTruthy();
    if (original) Object.defineProperty(input, "value", original);
    expect(input.value).toBe("1");
  });

  it("entering a valid value clears a prior clamp message", () => {
    const { container, getByText, queryByText } = renderBody(SMALL.payload);
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "11" } });
    });
    expect(getByText(CLAMP_MAX_MSG)).toBeTruthy();
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });
    expect(queryByText(CLAMP_MAX_MSG)).toBeNull();
  });
});
