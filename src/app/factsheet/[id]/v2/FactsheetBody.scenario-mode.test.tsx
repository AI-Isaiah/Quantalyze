import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * BODY-02 (Phase 40) — the additive `scenarioMode?: boolean` prop on
 * FactsheetBody is provably zero-behavior-change at the default.
 *
 * Two load-bearing proofs:
 *   1. Prop equivalence: FactsheetBody with DEFAULT props renders byte-identical
 *      innerHTML to FactsheetBody with scenarioMode={false} — the entire reason
 *      page.tsx / Discovery / the Overview EquityChartWidget (all of which pass
 *      no scenarioMode) stay byte-identical after this change.
 *   2. Suppression: scenarioMode={true} drops EXACTLY the ControlBar Share-link
 *      ("Copy share link") and Compare-strategies ("Compare strategies") actions
 *      (a hypothetical blend is not a shareable/comparable real strategy), while
 *      Display / Reset view stay. scenarioMode={false} keeps both — exercising
 *      both new branches so branch coverage doesn't drop.
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}, the hook still
 * registers). Stub block copied verbatim from scenario-shared-window.test.tsx.
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

// Healthy full-resolution returns series (~300 points → the body is fully
// populated: every panel has real data, the ControlBar renders all actions).
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

const populatedPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});

// Mount shape mirrors the composer mount (Plan 40-02 consumes this contract):
// hideHeader, hideAllocatorSection (api-gated anyway), hideFooter={false}.
function renderBody(scenarioMode: boolean | undefined, omitProp = false) {
  return render(
    <FactsheetProvider payload={populatedPayload} persist={false}>
      <FactsheetBody
        payload={populatedPayload}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
        {...(omitProp ? {} : { scenarioMode })}
      />
    </FactsheetProvider>,
  );
}

describe("FactsheetBody — scenarioMode prop (BODY-02)", () => {
  it("renders byte-identically with default props vs scenarioMode={false}", () => {
    const def = renderBody(undefined, /* omitProp */ true);
    const explicitFalse = renderBody(false);
    // The entire byte-identity guarantee for page.tsx / Discovery / Overview:
    // an absent scenarioMode must produce exactly the same DOM as an explicit
    // false, on a fully-populated payload.
    expect(def.container.innerHTML).toBe(explicitFalse.container.innerHTML);
  });

  it("scenarioMode={true} suppresses Share + Compare; scenarioMode={false} keeps both", () => {
    const composer = renderBody(true);
    expect(composer.queryByText(/Copy share link/i)).toBeNull();
    expect(composer.queryByText(/Compare strategies/i)).toBeNull();

    const real = renderBody(false);
    expect(real.queryByText(/Copy share link/i)).not.toBeNull();
    expect(real.queryByText(/Compare strategies/i)).not.toBeNull();
  });

  it("scenarioMode={true} retains Display + Reset view ControlBar controls", () => {
    const composer = renderBody(true);
    // The two non-applicable actions are suppressed; the rest of the ControlBar
    // is untouched — Display menu + Reset view still render.
    expect(composer.getByText(/Reset view/i)).toBeTruthy();
    expect(composer.getByText(/^Display$/)).toBeTruthy();
  });

  // GUARD-01 (43-01) — the footer "Page 1 / 1" print-stamp is a print-only
  // artifact that leaks onto the on-screen composer mount. scenarioMode gates
  // ONLY that stamp <p>; the disclaimer <p> stays unconditional in both modes.
  // The byte-identity test above (default ≡ scenarioMode={false}) already
  // proves the stamp is PRESENT at the default/false — GUARD-02 (43-02) pins
  // the real route. Here we prove the additive suppression at scenarioMode={true}.
  it("scenarioMode={true} hides the 'Page 1 / 1' footer stamp; the disclaimer stays", () => {
    const composer = renderBody(true);
    expect(composer.queryByText(/Page 1 \/ 1/i)).toBeNull();
    // The legal disclaimer survives in both modes.
    expect(
      composer.queryByText(/Past performance is not indicative of future results/i),
    ).not.toBeNull();
  });

  it("scenarioMode={false} keeps the 'Page 1 / 1' footer stamp (real-route byte-identity)", () => {
    const real = renderBody(false);
    expect(real.queryByText(/Page 1 \/ 1/i)).not.toBeNull();
    expect(
      real.queryByText(/Past performance is not indicative of future results/i),
    ).not.toBeNull();
  });
});
