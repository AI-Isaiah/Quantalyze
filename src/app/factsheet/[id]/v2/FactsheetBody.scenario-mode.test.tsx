import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * PERMANENT (GUARD-02) — pins the real /factsheet/[id]/v2 route byte-identical
 * at scenarioMode default; do NOT delete at milestone close.
 *
 * This is the milestone-closing byte-identity gate. The per-phase byte-identity
 * tests (Phase 40 BODY-02, Phase 43-01 footer-stamp) were disposable scaffolding;
 * THIS file is promoted to the permanent gate and stays through v1.2.2 close and
 * beyond. Any future regression on the real route's default render — or on the
 * Overview EquityChartWidget's separation from the factsheet body — fails CI here.
 *
 * Three load-bearing proofs:
 *   1. Byte-identity (the GUARD-02 core): FactsheetBody with DEFAULT props renders
 *      byte-identical innerHTML to FactsheetBody with scenarioMode={false} on a
 *      populated payload — the entire reason page.tsx / Discovery / the Overview
 *      EquityChartWidget (all of which pass no scenarioMode) stay byte-identical.
 *      Every additive scenarioMode-gated branch (Phase 40 ControlBar suppression,
 *      Phase 43-01 footer-stamp gate) defaults false, so this equality holds both
 *      before AND after 43-01's additive footer change (no ordering dependency).
 *   2. Overview untouched: the Overview EquityChartWidget module
 *      (widgets/performance/EquityChart.tsx — the default export AllocationDashboardV2
 *      mounts) does NOT reference the FactsheetBody component nor the factsheet
 *      article id (#factsheet-main); it stays on the legacy EquityChart render
 *      (STATE.md 38-03). A static import-shape scan (readFileSync + literal absence,
 *      mirroring composer-width.test.tsx) is the lowest-coupling, render-engine-
 *      independent, permanent guard against the Overview ever mounting the body.
 *   3. Suppression: scenarioMode={true} drops EXACTLY the ControlBar Share-link
 *      ("Copy share link") and Compare-strategies ("Compare strategies") actions
 *      (a hypothetical blend is not a shareable/comparable real strategy) and the
 *      footer "Page 1 / 1" print-stamp, while Display / Reset view / the disclaimer
 *      stay. scenarioMode={false} keeps them all — exercising both new branches so
 *      branch coverage doesn't drop.
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

describe("FactsheetBody — PERMANENT byte-identity gate (GUARD-02)", () => {
  it("renders byte-identically with default props vs scenarioMode={false}", () => {
    const def = renderBody(undefined, /* omitProp */ true);
    const explicitFalse = renderBody(false);
    // The entire byte-identity guarantee for page.tsx / Discovery / Overview:
    // an absent scenarioMode must produce exactly the same DOM as an explicit
    // false, on a fully-populated payload.
    expect(def.container.innerHTML).toBe(explicitFalse.container.innerHTML);
  });

  // GUARD-02 second assertion (Overview untouched) — the Overview equity widget
  // stays on the LEGACY EquityChart and must NEVER mount the factsheet body.
  // The Overview EquityChartWidget IS the default export of
  // widgets/performance/EquityChart.tsx (AllocationDashboardV2.tsx:8 imports it
  // as `EquityChartWidget`). A static import-shape scan is the lowest-coupling
  // permanent guard: render-engine-independent, and falsifiable by construction —
  // if a future change ever imports/mounts FactsheetBody (or stamps the factsheet
  // article id #factsheet-main) into the Overview widget module, the literal
  // appears in the source and this test goes RED. Mirrors the static-source-scan
  // pattern composer-width.test.tsx uses for the composer scope boundary.
  const OVERVIEW_EQUITY_WIDGET = join(
    process.cwd(),
    "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
  );
  const overviewWidgetSrc = readFileSync(OVERVIEW_EQUITY_WIDGET, "utf8");

  it("Overview EquityChartWidget module does NOT reference FactsheetBody / #factsheet-main (stays on the legacy render)", () => {
    expect(overviewWidgetSrc).not.toContain("FactsheetBody");
    expect(overviewWidgetSrc).not.toContain("factsheet-main");
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
