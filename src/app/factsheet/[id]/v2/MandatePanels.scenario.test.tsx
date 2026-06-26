import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, ScenarioMandatePayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { ConstituentMandatePanel } from "./MandatePanels";

/**
 * Phase 42 Plan 05 (PEER-04) — the ConstituentMandatePanel per-constituent chip
 * render contract.
 *
 * Load-bearing proofs:
 *   1. SCENARIO + mixed constituents: one with strategy_types + markets renders
 *      its chips + a leverage chip; an empty constituent renders the
 *      per-constituent honest-empty "no mandate metadata"; NO fabricated aggregate.
 *   2. ALL-EMPTY constituents: the whole-panel honest-empty copy renders AND the
 *      "Mandate" title still renders (the absence is informative).
 *   3. NON-SCENARIO (no scenarioMandate): the panel returns null — the real route
 *      is byte-identical (no <section> in the DOM).
 *
 * The chips are static read-only spans — NOT the interactive MandateChipGroup
 * (role=checkbox is wrong a11y for display).
 *
 * Stub block mirrors BatchDPanels.peer-scenario.test.tsx (FactsheetProvider's
 * persistence primitive touches localStorage + sentry on mount).
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

/** Healthy full-resolution returns series so the csv payload is fully valid. */
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

/** A valid csv payload carrying the scenario mandate carve-out. */
function csvPayload(scenarioMandate: ScenarioMandatePayload | undefined): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    ...(scenarioMandate ? { scenarioMandate } : {}),
  });
}

function renderPanel(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <ConstituentMandatePanel />
    </FactsheetProvider>,
  );
}

describe("ConstituentMandatePanel — per-constituent chips (PEER-04)", () => {
  it("mixed constituents: chips + leverage for the populated one, per-constituent honest-empty for the empty one", () => {
    const mandate: ScenarioMandatePayload = {
      constituents: [
        { name: "Trend Alpha", strategy_types: ["trend-following"], markets: ["BTC", "ETH"], leverage: 2 },
        { name: "Empty Strat", strategy_types: [], markets: [], leverage: 1 },
      ],
    };
    const { getByText, getAllByText, queryByText } = renderPanel(csvPayload(mandate));

    // The "Mandate" title renders.
    expect(getByText("Mandate")).toBeTruthy();

    // Populated constituent: name + type chip + market chips + leverage chip.
    expect(getByText("Trend Alpha")).toBeTruthy();
    expect(getByText("trend-following")).toBeTruthy();
    expect(getByText("BTC")).toBeTruthy();
    expect(getByText("ETH")).toBeTruthy();
    expect(getByText("2×")).toBeTruthy();

    // The chips use the verbatim UI-SPEC neutral-outline classes (read-only span).
    const typeChip = getByText("trend-following");
    expect(typeChip.tagName).toBe("SPAN");
    expect(typeChip.className).toContain("rounded-sm");
    expect(typeChip.className).toContain("border-border");
    expect(typeChip.className).toContain("text-[10px]");
    expect(typeChip.className).toContain("uppercase");
    expect(typeChip.className).toContain("text-text-secondary");
    // Read-only: no interactive role on the chip.
    expect(typeChip.getAttribute("role")).toBeNull();

    // Empty constituent: name + per-constituent honest-empty copy (NO leverage chip).
    expect(getByText("Empty Strat")).toBeTruthy();
    expect(getByText("no mandate metadata")).toBeTruthy();
    // The empty constituent does NOT render a 1× leverage chip (it is treated as
    // empty when types+markets are both absent).
    expect(queryByText("1×")).toBeNull();

    // NO fabricated aggregate — only the two named constituents appear.
    // (Exactly one honest-empty sub-block for the single empty constituent.)
    expect(getAllByText("no mandate metadata").length).toBe(1);
  });

  it("all-empty constituents: whole-panel honest-empty copy renders AND the 'Mandate' title still renders", () => {
    const mandate: ScenarioMandatePayload = {
      constituents: [
        { name: "A", strategy_types: [], markets: [], leverage: 1 },
        { name: "B", strategy_types: [], markets: [], leverage: 1.5 },
      ],
    };
    const { getByText, queryByText } = renderPanel(csvPayload(mandate));

    // Title still present — the absence is informative.
    expect(getByText("Mandate")).toBeTruthy();
    // Whole-panel honest-empty copy.
    expect(
      getByText("No mandate metadata available for this blend's constituents."),
    ).toBeTruthy();
    // The per-constituent sub-blocks do NOT render in the whole-panel-empty path.
    expect(queryByText("A")).toBeNull();
    expect(queryByText("no mandate metadata")).toBeNull();
  });

  it("non-scenario (no scenarioMandate): the panel returns null (real route byte-identical)", () => {
    const { container, queryByText } = renderPanel(csvPayload(undefined));
    expect(container.querySelector("section")).toBeNull();
    expect(queryByText("Mandate")).toBeNull();
  });
});
