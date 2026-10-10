import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, FactsheetUsdView } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetView } from "./FactsheetView";

/**
 * Phase 164.6.6.2.1 round 1, CR-02 — the Terms panel describes the STRATEGY, not
 * the unit on screen. The live/backtest framing and the Data source tier must read
 * the same in the BTC view and the USD view.
 *
 * The defect: the USD payload is built with `trustTier: null` (the pages overlay the
 * real tier on the outer payload only), and its series starts at least one native
 * date later. `TermsPanel` read both off the SELECTED payload, so toggling to USD
 * turned "API-verified" into "—" and could print a backtest clause about a live
 * record. The fixture reproduces exactly the shape the pages hand `FactsheetView`
 * before the fix: the outer payload carries the tier, `usdView.payload` carries null.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, startDay = 1, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, startDay));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// The declared live date equals the native record's first day, so the native view is
// "all live". The USD record starts two days later (a leading price hole, D-22, or an
// MT5 weekend gap), which is more than the panel's one-day tolerance.
const LIVE_SINCE = "2023-01-01";
const NATIVE_BASE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});
const USD_BASE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(297, 3),
  benchmark: null,
});

function pageShapedPayload(tier: FactsheetPayload["trustTier"]): FactsheetPayload {
  const usdView: FactsheetUsdView = {
    payload: {
      ...USD_BASE,
      returnsUnit: "USD",
      convertedFrom: "BTC",
      // As built: `strategyArg.trustTier` is null, the tier is never part of the cache.
      trustTier: null,
      startDate: LIVE_SINCE,
    } as FactsheetPayload,
    convertedFrom: "BTC",
    usdStart: "2023-01-03",
    usdEnd: "2023-10-26",
    leadingHole: true,
    unpricedDays: [],
    removedReturns: 0,
  };
  return {
    ...NATIVE_BASE,
    returnsUnit: "BTC",
    // As the pages overlay it: on the OUTER payload, not on `usdView.payload`.
    trustTier: tier,
    startDate: LIVE_SINCE,
    usdView,
  } as FactsheetPayload;
}

function termsPanel(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll("h3")).find((h) => h.textContent === "Terms");
  expect(heading, "the Terms panel did not render").toBeDefined();
  return heading!.closest("section") as HTMLElement;
}
function termValue(panel: HTMLElement, label: string): string {
  const dt = Array.from(panel.querySelectorAll("dt")).find((el) => el.textContent === label);
  expect(dt, `Terms row "${label}" did not render`).toBeDefined();
  return (dt!.nextElementSibling as HTMLElement).textContent ?? "";
}
function toggleUsd(container: HTMLElement) {
  const t = container.querySelector('[data-testid="factsheet-unit-toggle"]') as HTMLElement;
  fireEvent.click(within(t).getByRole("button", { name: "USD" }));
}

describe("CR-02 — the Terms panel describes the strategy, not the unit", () => {
  it("the USD series really starts later than the native one (the fixture bites)", () => {
    const p = pageShapedPayload("api_verified");
    expect(p.usdView!.payload.strategyMetrics.start > p.strategyMetrics.start).toBe(true);
    expect(p.usdView!.payload.trustTier).toBeNull();
  });

  it("an API-verified strategy reads 'API-verified' in both views", () => {
    const { container } = render(<FactsheetView payload={pageShapedPayload("api_verified")} />);
    expect(termValue(termsPanel(container), "Data source")).toBe("API-verified");
    toggleUsd(container);
    expect(termValue(termsPanel(container), "Data source")).toBe("API-verified");
  });

  it("every tier survives the switch unchanged (CSV, self-reported, unverified)", () => {
    for (const [tier, text] of [
      ["csv_uploaded", "CSV-uploaded (verification pending)"],
      ["self_reported", "Self-reported"],
      [null, "—"],
    ] as const) {
      const { container, unmount } = render(<FactsheetView payload={pageShapedPayload(tier)} />);
      expect(termValue(termsPanel(container), "Data source")).toBe(text);
      toggleUsd(container);
      expect(termValue(termsPanel(container), "Data source")).toBe(text);
      unmount();
    }
  });

  it("a live record never gains a backtest clause by switching to USD", () => {
    const { container } = render(<FactsheetView payload={pageShapedPayload("api_verified")} />);
    const live = termValue(termsPanel(container), "Live since");
    expect(live).not.toContain("backtest");
    toggleUsd(container);
    const usdLive = termValue(termsPanel(container), "Live since");
    expect(usdLive).not.toContain("backtest");
    expect(usdLive).toBe(live);
  });

  it("the Live since row still reports a real backtest gap in BOTH views (the clause is not removed)", () => {
    // Declared live date two days BEFORE the native record starts: genuinely backtest.
    const base = pageShapedPayload("api_verified");
    const p = { ...base, startDate: "2022-12-25" } as FactsheetPayload;
    const { container } = render(<FactsheetView payload={p} />);
    expect(termValue(termsPanel(container), "Live since")).toContain("portion before live date is backtest");
    toggleUsd(container);
    const usd = termValue(termsPanel(container), "Live since");
    expect(usd).toContain("portion before live date is backtest");
    // ...and it names the NATIVE record's start, not the USD series' later one.
    expect(usd).toContain("observation window starts 2023-01-01");
  });
});
