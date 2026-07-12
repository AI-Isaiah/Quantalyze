import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { mtmDisabledReasonCopy } from "./basis-context";

/**
 * Phase 90 Wave-0 (90-02 Task 2) — TDD RED scaffold for the FS-03 cash/MTM
 * basis toggle: the composite discriminator (BOTH directions), the
 * server-truth MTM gate, the closed-set disabled-reason copy, and the
 * no-persistence-on-toggle invariant (GUARD-04 companion). Lands in 90-05.
 *
 * DOM-level only, mirroring GUARD-02 (FactsheetBody.scenario-mode.test.tsx):
 * it renders the REAL FactsheetBody tree and imports NO not-yet-existing module
 * (no basis-context / basis-metrics). The not-yet-existing optional payload
 * fields are supplied via casts (per 90-02 <interfaces>) so `tsc --noEmit`
 * stays clean.
 *
 * Discriminator note (CONTEXT D2): FactsheetPayload has NO `apiKeyId` field, so
 * compositeness CANNOT be (and must never be) derived from `apiKeyId === null`.
 * These fixtures discriminate purely on `dataQuality.composite === true` — the
 * server-authoritative marker. A composite fixture sets it true; the single-key
 * fixture omits the field entirely.
 *
 * RED (assertions 1–3) fail today because the toggle does not exist yet.
 * GREEN-by-construction (assertions 4–5) pass today AND after: a single-key
 * payload emits none of the Phase-90 composite strings (byte-identity scope).
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount. Stub block mirrors GUARD-02 verbatim.
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

// Sentinel per-basis scalar sets — MTM values are deliberately distinguishable
// from cash so a later relabel test can prove the swap. Server key names
// (cumulative_return / volatility / max_drawdown) per 90-02 <interfaces>.
const CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};
const MTM = {
  cumulative_return: 0.5,
  volatility: 0.11,
  max_drawdown: -0.038,
  cagr: 0.26,
  sharpe: 1.2,
  sortino: 1.9,
  calmar: 2.7,
};

function base(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  }) as unknown as FactsheetPayload;
}

// (a) single-key: NONE of the new fields (byte-identical to today).
function fixtureSingleKey(): FactsheetPayload {
  return base();
}
// (b) composite, MTM GATED with the un-smoothed-options reason.
function fixtureCompositeGated(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH },
    mtmGate: { available: false, reason: "unsmoothed_options_book" },
  } as unknown as FactsheetPayload;
}
// (c) composite, MTM AVAILABLE (both bases present).
function fixtureCompositeAvailable(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH, mark_to_market: MTM },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}
// (d) composite, MTM gated with NO reason → generic fallback copy.
function fixtureCompositeNoReason(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

beforeEach(() => {
  lsStore.clear();
  localStorageMock.setItem.mockClear();
});

describe("FactsheetBody — Phase 90 FS-03 basis toggle (RED until 90-05)", () => {
  it("discriminator dir 1 (RED): composite fixtures render the 'Metrics basis' toggle with Cash settlement active by default", () => {
    for (const payload of [
      fixtureCompositeGated(),
      fixtureCompositeAvailable(),
    ]) {
      const { container } = renderBody(payload);
      const group = container.querySelector(
        '[role="group"][aria-label="Metrics basis"]',
      );
      expect(group, "the composite basis toggle group").not.toBeNull();
      const cash = within(group as HTMLElement).getByText("Cash settlement");
      const mtm = within(group as HTMLElement).getByText("Mark-to-market");
      expect(cash).toBeTruthy();
      expect(mtm).toBeTruthy();
      // Cash settlement is the active default.
      expect(cash.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("MTM gate = server truth (RED): available → enabled; gated → aria-disabled with EXACT reason copy", () => {
    // Scope each fixture's query to its OWN container: the three renders below
    // accumulate in document.body within this single test (RTL cleanup only runs
    // afterEach), so a body-scoped `getByText("Mark-to-market")` would match every
    // prior render. `within(x.container)` isolates each render's toggle.
    // (c) available: MTM segment is NOT disabled.
    const c = renderBody(fixtureCompositeAvailable());
    const cMtm = within(c.container).getByText("Mark-to-market");
    expect(cMtm.getAttribute("aria-disabled")).not.toBe("true");

    // (b) gated on un-smoothed options: disabled + verbatim D1 copy.
    const b = renderBody(fixtureCompositeGated());
    const bMtm = within(b.container).getByText("Mark-to-market");
    expect(bMtm.getAttribute("aria-disabled")).toBe("true");
    expect(bMtm.getAttribute("title")).toBe(
      "Mark-to-market disabled: un-smoothed options book (Phase-83 daily-mark smoothing not applied)",
    );

    // (d) gated with no reason: generic composite fallback copy.
    const d = renderBody(fixtureCompositeNoReason());
    const dMtm = within(d.container).getByText("Mark-to-market");
    expect(dMtm.getAttribute("aria-disabled")).toBe("true");
    expect(dMtm.getAttribute("title")).toBe(
      "Mark-to-market unavailable for this composite.",
    );
  });

  it("no persistence (RED): clicking Mark-to-market writes NOTHING to localStorage or the URL", () => {
    const searchBefore = window.location.search;
    const { getByText } = renderBody(fixtureCompositeAvailable());
    fireEvent.click(getByText("Mark-to-market"));

    const factsheetWrites = localStorageMock.setItem.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && /^factsheet/.test(call[0] as string),
    );
    expect(factsheetWrites).toEqual([]);
    expect(window.location.search).toBe(searchBefore);
  });
});

describe("FactsheetBody — Phase 90 single-key parity (GREEN today AND after)", () => {
  it("discriminator dir 2 (GREEN): single-key renders NO 'Metrics basis' toggle and NO 'Mark-to-market' text", () => {
    const { container, queryByText } = renderBody(fixtureSingleKey());
    expect(
      container.querySelector('[aria-label="Metrics basis"]'),
    ).toBeNull();
    expect(queryByText("Mark-to-market")).toBeNull();
  });

  it("byte-identity spot-check (GREEN): single-key static markup emits none of the Phase-90 composite strings", () => {
    const payload = fixtureSingleKey();
    const html = renderToStaticMarkup(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody
          payload={payload}
          hideHeader
          hideAllocatorSection
          hideFooter={false}
        />
      </FactsheetProvider>,
    );
    expect(html).not.toContain("BASIS ·");
    expect(html).not.toContain("Metrics basis");
    // The Phase-90 gap label uses the em-dash phrasing "— no data". The
    // HeatmapPanels month-cell title ": no data" (colon form) is a DIFFERENT,
    // pre-existing string and is intentionally OUT of scope for this pin.
    expect(html).not.toContain("— no data");
  });
});

/**
 * Phase 102 (MTM-01 / MTM-03) — the SINGLE-KEY options MTM toggle. These fixtures
 * discriminate purely on the server-truth `payload.mtmGate` (NEVER an api-key
 * heuristic — Pitfall 1): a single-key options strategy carries an `mtmGate`; a
 * non-options single-key strategy does not. All additive — every pre-existing
 * assertion above stays byte-untouched.
 */
const LEVERAGE_INPUT_LABEL =
  "Leverage multiplier (1× = unlevered; excludes borrow / funding cost)";

// (e) single-key options, MTM AVAILABLE — carries ONLY mark_to_market (never a
//     cash_settlement key — the SC-4 keystone). No dataQuality.composite.
function fixtureSingleKeyMtmAvailable(): FactsheetPayload {
  return {
    ...base(),
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}
// (f) single-key options, MTM gated with an honest single-key reason.
function fixtureSingleKeyMtmGated(): FactsheetPayload {
  return {
    ...base(),
    mtmGate: { available: false, reason: "mtm_summary_coverage_incomplete" },
  } as unknown as FactsheetPayload;
}
// (g) single-key options, MTM available AND leverageable (periodsPerYear present
//     so the leverage input renders on the cash basis). Drives LEV-MTM-1.
function fixtureSingleKeyMtmLeverage(): FactsheetPayload {
  return {
    ...base(),
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
    periodsPerYear: 365,
  } as unknown as FactsheetPayload;
}

// Read the numeric value cell for a KPI label within a rendered container.
function kpiValue(container: HTMLElement, label: string): string {
  const labelEl = within(container).getAllByText(label)[0]!;
  const cell = labelEl.parentElement as HTMLElement;
  // The value <p> is the label's sibling inside the cell div.
  const value = cell.querySelector("p:last-child");
  return value?.textContent ?? "";
}

describe("FactsheetBody — Phase 102 single-key options MTM toggle", () => {
  it("SK-TOGGLE-1: single-key options with an available mtmGate renders the toggle; activating MTM relabels the KPI scalars", () => {
    const { container } = renderBody(fixtureSingleKeyMtmAvailable());
    const group = container.querySelector(
      '[role="group"][aria-label="Metrics basis"]',
    );
    expect(group, "the single-key options basis toggle group").not.toBeNull();
    // Default cash active; activate mark_to_market.
    fireEvent.click(within(container).getByText("Mark-to-market"));
    // The seven mapped scalars relabel from the PERSISTED mark_to_market object
    // (MTM.cumulative_return 0.5 → +50.0%; MTM.sharpe 1.2 → 1.20), never cash.
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
    expect(kpiValue(container, "Sharpe")).toBe("1.20");
  });

  it("SK-TOGGLE-2: single-key options gated → mark_to_market aria-disabled with the mapped reason copy inline", () => {
    const { container } = renderBody(fixtureSingleKeyMtmGated());
    const mtm = within(container).getByText("Mark-to-market");
    expect(mtm.getAttribute("aria-disabled")).toBe("true");
    // Copy-agnostic: assert the WIRING (the server reason flows to the mapped
    // copy) — the exact string is pinned in Task 3's basis-context tests.
    const expected = mtmDisabledReasonCopy("mtm_summary_coverage_incomplete");
    expect(mtm.getAttribute("title")).toBe(expected);
    // The inline disabled-reason paragraph mirrors the same mapped copy.
    expect(within(container).getAllByText(expected).length).toBeGreaterThan(0);
  });

  it("SK-BYTE-1: a single-key payload with NO mtmGate renders NO SegmentedControl (byte-identity scope)", () => {
    const { container, queryByText } = renderBody(fixtureSingleKey());
    expect(
      container.querySelector('[role="group"][aria-label="Metrics basis"]'),
    ).toBeNull();
    expect(queryByText("Mark-to-market")).toBeNull();
  });

  it("LEV-MTM-1 (no-fabrication guard): leverage=2 under MTM shows PERSISTED MTM scalars and NO MODELED eyebrow", () => {
    const { container } = renderBody(fixtureSingleKeyMtmLeverage());
    // On the cash basis the leverage input is visible — dial it to 2×.
    const input = within(container).getByLabelText(LEVERAGE_INPUT_LABEL);
    fireEvent.change(input, { target: { value: "2" } });
    // Switch to mark_to_market: leverage models the CASH return path, so under an
    // MTM label the hook MUST short-circuit to the persisted overlay (no recompute).
    fireEvent.click(within(container).getByText("Mark-to-market"));
    // KPI cells show the persisted MTM scalars (MTM.cum 0.5 → +50.0%), NOT a
    // leverage-scaled cash number. Neuter check: remove the basis guard in
    // useLeveragedMetrics → leveraged cash renders here + a MODELED eyebrow → RED.
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
    // No fabricated MODELED line under MTM.
    expect(within(container).queryByText(/MODELED/)).toBeNull();
  });
});
