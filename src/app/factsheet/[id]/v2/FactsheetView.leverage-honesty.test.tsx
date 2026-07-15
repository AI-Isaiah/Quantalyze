import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import {
  leverageApplies,
  leverageEligibleFor,
} from "./basis-context";
import { pct } from "./format";

/**
 * Phase 107 code-review WR-01 + IN-02 — the what-if caption HONESTY invariant under the
 * 107-03 `useDeferredValue` re-derive window.
 *
 * `useBasisSeriesView` reads a DEFERRED leverage (basis-context.tsx). Before this fix the
 * KpiStrip computed its gate + disclosure caption from the IMMEDIATE `useLeverage()` value,
 * so during the ~235ms deferred re-derive the caption could claim a levered what-if while
 * the displayed numbers were still the unlevered base — violating the code's own invariant
 * ("the caption can never claim a what-if the view did not apply"). Ordinary act()-flushed
 * tests collapse the urgent + deferred renders and never expose it, so this file MOCKS
 * `useDeferredValue` to hold the view's leverage at a controllable "still-deferred" value,
 * reproducing the window deterministically. The fix routes the gate/caption through the SAME
 * deferred applied-leverage (`useAppliedLeverage`) + the single shared `leverageApplies`
 * predicate, so caption/gate/numbers cannot diverge.
 */

// Hold the leverage value the DEFERRED read (useBasisSeriesView + useAppliedLeverage) sees,
// independent of the immediate slider state. `null` → real pass-through (identity in sync
// tests). Type-guarded to numbers so the ONLY other useDeferredValue consumer in the tree
// (TimeSeriesChart's `crossIdx`, which stays `null` with no mouse interaction) is untouched.
const hoisted = vi.hoisted(() => ({ deferredLeverage: null as number | null }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useDeferredValue: (value: unknown, ...rest: unknown[]): unknown =>
      hoisted.deferredLeverage !== null && typeof value === "number"
        ? hoisted.deferredLeverage
        : (actual.useDeferredValue as (v: unknown, ...r: unknown[]) => unknown)(
            value,
            ...rest,
          ),
  };
});

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

// FactsheetProvider / FactsheetBody must be imported AFTER the react mock is registered.
// (vi.mock is hoisted, so a static import is fine, but keep the import here for clarity.)
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

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

function buildSmall(): {
  payload: FactsheetPayload;
  base: ReturnType<typeof deriveSeriesBundle>;
} {
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

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

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

const CAPTION_RE = /What-if projection at/;

afterEach(() => {
  hoisted.deferredLeverage = null;
});

describe("FactsheetView — WR-01 what-if caption honesty across the deferred re-derive window", () => {
  it("REGRESSION: while the DEFERRED view is still unlevered, the caption must NOT claim a levered what-if", () => {
    // Simulate the deferred window: the slider state moves to 2× immediately, but the
    // view's DEFERRED leverage read is still pinned at 1× (React has not yet committed
    // the low-priority re-derive).
    hoisted.deferredLeverage = 1;
    const { container, queryByText } = renderBody(SMALL.payload);
    const baseAnnVol = readCell(container, "Ann. Vol");

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });

    // The numbers read the deferred leverage (still 1) → they stay the unlevered base.
    expect(readCell(container, "Ann. Vol")).toBe(baseAnnVol);

    // HONESTY INVARIANT: with unlevered numbers on screen, no "What-if projection at 2×"
    // caption may render. The un-fixed KpiStrip drives the caption from the IMMEDIATE
    // leverage (=2), so it renders the caption over unlevered numbers → this fails.
    expect(queryByText(CAPTION_RE)).toBeNull();
  });

  it("REGRESSION (reset direction): while the DEFERRED numbers are still levered, the caption must STILL be shown", () => {
    // Reverse of the above: the deferred view lags at 2× while the slider is reset to 1×.
    // The numbers are still levered, so the caption must remain — it must not vanish ahead
    // of the numbers (the un-fixed KpiStrip drops it immediately on the reset → dishonest
    // levered-numbers-without-a-caption state).
    hoisted.deferredLeverage = 2;
    const { container, getByText, queryByText } = renderBody(SMALL.payload);

    // Commit a change so the deferred view settles levered (the mock holds it at 2×).
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });
    const leveredAnnVol = pct(2 * SMALL.base.strategyMetrics.ann_vol, 1);
    expect(readCell(container, "Ann. Vol")).toBe(leveredAnnVol);
    expect(queryByText(CAPTION_RE)).not.toBeNull();

    // Reset the slider to 1× (immediate); the deferred view is STILL 2×.
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "1" } });
    });
    // Numbers still levered → the caption (keyed to the deferred applied leverage) stays.
    expect(readCell(container, "Ann. Vol")).toBe(leveredAnnVol);
    expect(getByText(CAPTION_RE)).toBeTruthy();
  });
});

describe("leverage predicate helpers — IN-02 single source of truth", () => {
  const cashPayload = {
    periodsPerYear: 365,
    dataQuality: {},
    seriesByBasis: undefined,
  } as unknown as FactsheetPayload;

  it("leverageEligibleFor: true for single-key cash with periodsPerYear present", () => {
    expect(leverageEligibleFor(cashPayload, "cash_settlement")).toBe(true);
  });

  it("leverageEligibleFor: false for composite, missing periodsPerYear, or unresolved MTM", () => {
    expect(
      leverageEligibleFor(
        { ...cashPayload, dataQuality: { composite: true } } as FactsheetPayload,
        "cash_settlement",
      ),
    ).toBe(false);
    expect(
      leverageEligibleFor(
        { ...cashPayload, periodsPerYear: null } as unknown as FactsheetPayload,
        "cash_settlement",
      ),
    ).toBe(false);
    // MTM basis with no series bundle → unresolved → not eligible.
    expect(leverageEligibleFor(cashPayload, "mark_to_market")).toBe(false);
  });

  it("leverageApplies: eligibility AND a non-unity applied leverage", () => {
    expect(leverageApplies(cashPayload, "cash_settlement", 1)).toBe(false);
    expect(leverageApplies(cashPayload, "cash_settlement", 2)).toBe(true);
    expect(
      leverageApplies(
        { ...cashPayload, dataQuality: { composite: true } } as FactsheetPayload,
        "cash_settlement",
        2,
      ),
    ).toBe(false);
  });
});
