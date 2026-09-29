/** @vitest-environment jsdom */
/**
 * Phase 169 review round 1 (SFH H-1, T5): on a chain-broken single-key row the
 * STORED headline covers only the record after its last break.
 *
 * WHY. Python compounds `cumulative_return` and annualizes CAGR over
 * `nav_twr._last_interior_break_suffix`, and Calmar is that CAGR over the max
 * drawdown. Since Phase 169 (SC4, D-25) the factsheet shows those stored
 * values, while the equity chart, the return windows and Years Observed cover
 * the whole series. Without a caveat, "Cum. Return +18%" sits beside a curve
 * that ends at +61% and nothing on the page says why. MEASURED on PROD
 * 2026-09-29 by the orchestrator: 4 chain-broken complete rows, 2 whose break
 * the stored cash series can date (`broker_nan`) and 2 it cannot (`zero_fill`),
 * so both branches below are live.
 *
 * The caveat renders beside the headline (the KPI strip) and in the two
 * MetricsColumn panels that state those figures (Main Metrics, Cumulative
 * Return Metrics). With a date it names the date; with `null` it says the same
 * without one, and never invents one. It renders only when the stored headline
 * is the one shown: on the cash basis, and only when the payload carries
 * `headlineCoversFrom` (present, date or null, exactly when the persisted cash
 * headline was overlaid on a chain-broken row). A chain-broken row whose
 * headline was computed in TypeScript over the whole series makes no such
 * claim, and neither does the MTM basis, whose figures come from the MTM series.
 *
 * The sentences are HAND-TYPED, never imported.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render } from "@testing-library/react";
import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { MetricsColumn } from "./MetricsColumn";
import { FactsheetBody } from "./FactsheetView";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
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
  });
});

/** Hand-typed: the dated branch, for a span starting 2024-06-15. */
const DATED =
  "⚠ Cumulative return, CAGR and Calmar cover the record from Jun 15, 2024, after its last break in the return chain. The chart shows the whole record.";
/** Hand-typed: the undatable branch. */
const UNDATED =
  "⚠ Cumulative return, CAGR and Calmar cover only the record after its last break in the return chain. The chart shows the whole record.";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function dense(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}

function payloadWith(dataQuality: FactsheetPayload["dataQuality"]): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "headline-coverage-test",
      name: "Headline Coverage Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "csv",
    },
    dense(400),
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, periodsPerYear: 365, dataQuality } as FactsheetPayload;
}

const CHAIN_BROKEN_DATED = { composite: false, twrChainBroken: true, headlineCoversFrom: "2024-06-15" };
const CHAIN_BROKEN_UNDATED = { composite: false, twrChainBroken: true, headlineCoversFrom: null };
const CLEAN = { composite: false, insufficientWindow: false };

/** Every element whose own text is exactly one of the two caveats. */
function caveats(container: HTMLElement): string[] {
  return [...container.querySelectorAll("p")]
    .map((p) => (p.textContent ?? "").trim())
    .filter((t) => t === DATED || t === UNDATED);
}

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function panelOf(container: HTMLElement, text: string): string | null {
  const p = [...container.querySelectorAll("p")].find((el) => (el.textContent ?? "").trim() === text);
  const h = p?.closest("section")?.querySelector("h3");
  return h?.textContent ?? null;
}

describe("the chain-break caveat in MetricsColumn (169 SFH H-1)", () => {
  it("with a date: Main Metrics and Cumulative Return Metrics each name the date the headline covers from", () => {
    const { container } = renderColumn(payloadWith(CHAIN_BROKEN_DATED));
    expect(caveats(container)).toEqual([DATED, DATED]);
    const panels = [...container.querySelectorAll("p")]
      .filter((el) => (el.textContent ?? "").trim() === DATED)
      .map((el) => el.closest("section")?.querySelector("h3")?.textContent);
    expect(panels).toEqual(["Main Metrics", "Cumulative Return Metrics"]);
  });

  it("with no date the stored data can name: the same sentence without a date, never an invented one", () => {
    const { container } = renderColumn(payloadWith(CHAIN_BROKEN_UNDATED));
    expect(caveats(container)).toEqual([UNDATED, UNDATED]);
    expect(panelOf(container, UNDATED)).toBe("Main Metrics");
  });

  it("CONTROL: a clean row shows no caveat", () => {
    const { container } = renderColumn(payloadWith(CLEAN));
    expect(caveats(container)).toEqual([]);
    expect(container.textContent).not.toContain("break in the return chain");
  });

  it("a chain-broken row whose headline was NOT the stored one (no headlineCoversFrom) makes no claim", () => {
    const { container } = renderColumn(payloadWith({ composite: false, twrChainBroken: true }));
    expect(container.textContent).not.toContain("break in the return chain");
  });

  it("under mark_to_market the figures come from the MTM series, so no caveat", () => {
    const cash = payloadWith(CHAIN_BROKEN_DATED);
    const mtm = deriveSeriesBundle(dense(400).slice(200), {
      periodsPerYear: 365,
      isArithmetic: false,
      markets: [],
      strategyName: "Headline Coverage Test",
    });
    const payload = {
      ...cash,
      seriesByBasis: { mark_to_market: mtm },
      metricsByBasis: {
        mark_to_market: {
          cumulative_return: 0.05,
          cagr: 0.1,
          volatility: 0.2,
          sharpe: 0.5,
          sortino: 0.7,
          max_drawdown: -0.1,
          calmar: 1,
        },
      },
      mtmGate: { available: true },
    } as unknown as FactsheetPayload;
    function SetBasis({ basis }: { basis: Basis }) {
      const { setBasis } = useBasis();
      useEffect(() => {
        setBasis(basis);
      }, [basis, setBasis]);
      return null;
    }
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <BasisProvider>
          <SetBasis basis="mark_to_market" />
          <MetricsColumn />
        </BasisProvider>
      </FactsheetProvider>,
    );
    expect(container.textContent).not.toContain("break in the return chain");
  });
});

describe("the chain-break caveat beside the headline, the KPI strip (169 SFH H-1)", () => {
  function renderBody(payload: FactsheetPayload) {
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
  }

  /** The caveat paragraphs that sit in the same section as the "Cum. Return" KPI. */
  function stripCaveats(container: HTMLElement): string[] {
    return [...container.querySelectorAll("section")]
      .filter((s) => [...s.querySelectorAll("p")].some((p) => (p.textContent ?? "").trim() === "Cum. Return"))
      .flatMap((s) => [...s.querySelectorAll(":scope > p")].map((p) => (p.textContent ?? "").trim()))
      .filter((t) => t === DATED || t === UNDATED);
  }

  it("with a date", () => {
    const { container } = renderBody(payloadWith(CHAIN_BROKEN_DATED));
    expect(stripCaveats(container)).toEqual([DATED]);
  });

  it("with no date", () => {
    const { container } = renderBody(payloadWith(CHAIN_BROKEN_UNDATED));
    expect(stripCaveats(container)).toEqual([UNDATED]);
  });

  it("CONTROL: a clean row shows no caveat anywhere on the page", () => {
    const { container } = renderBody(payloadWith(CLEAN));
    expect(container.textContent).not.toContain("break in the return chain");
  });
});
