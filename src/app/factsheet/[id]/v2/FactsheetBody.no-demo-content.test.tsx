import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload, PeerPercentilePayload } from "@/lib/factsheet/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { LazyMount } from "./LazyMount";

/**
 * Phase 193 (QUIETVIEW) D-07, TRUST-03 / SC-3 — a factsheet never shows a
 * developer note, placeholder copy, or another strategy's or portfolio's demo
 * content.
 *
 * The guard mounts the REAL `FactsheetBody` for an api-ingested strategy that is
 * not named MultiMarket, and fails if any string in `FORBIDDEN` is in its text.
 *
 * Two choices keep it from passing vacuously (RESEARCH Pitfalls 3 and 4):
 *   - `src/test-setup.ts` replaces IntersectionObserver with a no-op, and
 *     `LazyMount` mounts its children only on an intersecting entry. Without a
 *     firing observer every lazily-mounted section stays empty in jsdom and the
 *     guard would pass against code that renders demo content. The test-local
 *     `FiringIntersectionObserver` reports every observed element as
 *     intersecting, so lazy sections mount. `unstubGlobals: true` in
 *     `vitest.config.ts` restores the global after each test.
 *   - The body is rendered with no option that suppresses a section or the
 *     footer, because a guard that switches the suspect sections off cannot see
 *     them. Callers that did switch them off were hiding the problem, not
 *     fixing it.
 *
 * The premise cases pin that the payload still carries the demo fields and that
 * lazy children mount, so a green run means the render is clean, not that the
 * fixture went empty.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// The lazily-mounted signature panels branch on the breakpoint; pin it so the
// render is deterministic and jsdom never touches matchMedia.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

class FiringIntersectionObserver {
  private readonly cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    const rect = el.getBoundingClientRect();
    const entry = {
      isIntersecting: true,
      intersectionRatio: 1,
      target: el,
      time: 0,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
    } as IntersectionObserverEntry;
    this.cb([entry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
}

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
  vi.stubGlobal("IntersectionObserver", FiringIntersectionObserver);
});

/** Every string D-07 forbids on a factsheet (the three removed strings, the demo
 *  portfolio names, and the word MultiMarket on a strategy that is not it). */
const FORBIDDEN = [
  "Synthesized peer cohort",
  "deterministic seed",
  "Production: replace",
  "Demo cohort",
  "Demo portfolios",
  "Allocator Portfolio Analysis",
  "Suggested MultiMarket sleeve",
  "Commercial terms not yet wired through",
  "Demo cohorts and demo portfolios",
  "MultiMarket",
  "60/40 Stocks/Bonds",
  "Multi-Asset Risk Parity",
  "Diversified Crypto Blend",
] as const;

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-193-04-no-demo",
  name: "Quiet View Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-11-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const START = "2024-01-01";
const stratValue = (i: number) => 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004;

function buildApiPayload(n = 400): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: stratValue(i) }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: drift + Math.sin(i * 0.27) * 0.005 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const SCENARIO_PEER: PeerPercentilePayload = { cohortSize: 42, sharpe: 71, sortino: 64, max_dd: 58 };
const DISCLOSURE = "hypothetical blend · ranked vs verified strategies · sample/252 basis";

function renderApiBody() {
  const p = buildApiPayload();
  return render(
    <FactsheetProvider payload={p} persist={false}>
      <FactsheetBody payload={p} />
    </FactsheetProvider>,
  );
}

function renderScenarioBody() {
  const base = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    scenarioPeer: SCENARIO_PEER,
  });
  return render(
    <FactsheetProvider payload={base} persist={false}>
      <FactsheetBody payload={base} scenarioMode />
    </FactsheetProvider>,
  );
}

describe("D-07 guard: a factsheet shows no demo, placeholder or foreign content", () => {
  it("premise: the fixture still carries the demo payload fields", () => {
    const p = buildApiPayload();
    expect(p.ingestSource).toBe("api");
    expect(p.strategyName).not.toMatch(/MultiMarket/i);
    if (p.ingestSource !== "api") throw new Error("unreachable: asserted above");
    expect(p.peerPercentile).not.toBeNull();
    expect((p.allocatorPortfolios ?? []).length).toBeGreaterThan(0);
  });

  it("premise: LazyMount mounts its children under the firing observer", () => {
    render(
      <LazyMount>
        <span data-testid="lazy-probe" />
      </LazyMount>,
    );
    expect(screen.getByTestId("lazy-probe")).toBeTruthy();
  });

  it.each(FORBIDDEN)("an api factsheet renders no %s (D-07)", (needle) => {
    const text = renderApiBody().container.textContent ?? "";
    expect(text).not.toContain(needle);
  });

  it("the api factsheet has no allocator anchor and no Allocator nav link (D-05)", () => {
    const { container } = renderApiBody();
    expect(document.getElementById("factsheet-allocator")).toBeNull();
    expect(container.querySelector('a[href="#factsheet-allocator"]')).toBeNull();
  });

  it("the Fees block keeps its closing sentence (D-06)", () => {
    const text = (renderApiBody().container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(
      "Allocators should request the full fund offering memorandum directly from the manager before subscribing.",
    );
  });

  it("the footer disclaimer ends at past performance (A-3)", () => {
    const { container } = renderApiBody();
    const para = container.querySelector("footer p");
    expect(para).not.toBeNull();
    const text = (para!.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(text.endsWith("Past performance is not indicative of future results.")).toBe(true);
  });

  it("the scenario-blend peer panel still renders, with real data only", () => {
    const text = renderScenarioBody().container.textContent ?? "";
    expect(text).toContain("Peer Percentile");
    expect(text).toContain(DISCLOSURE);
    for (const needle of FORBIDDEN) {
      expect(text, `scenario body must not render ${needle}`).not.toContain(needle);
    }
  });
});
