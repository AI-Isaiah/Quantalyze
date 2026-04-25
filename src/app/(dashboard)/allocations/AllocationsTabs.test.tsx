import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 09.1 Plan 02 Task 3 — 6-tab routing tests for AllocationsTabs.
 * Supersedes the Phase 07 2-tab suite. Verifies tab-shell routing only;
 * each panel body is mocked to a marker div so this file doesn't depend
 * on widget grids, holdings tables, or any downstream Plan 04/05/08/10
 * implementation.
 *
 * Cases (per 09.1-02-PLAN.md Task 3):
 *   1. No tab param → Overview active.
 *   2. ?tab=holdings → Holdings active.
 *   3. ?tab=outcomes → Outcomes active.
 *   4. ?tab=mandate  → Mandate active.
 *   5. ?tab=risk     → Risk active.
 *   6. ?tab=scenario → Scenario active.
 *   7. ?tab=performance (legacy Phase 07 alias) → Overview + router.replace
 *      strips the param.
 *   8. ?tab=xyz (unknown) → Overview silent fallback (D-04). No URL cleanup
 *      because unknown is not in {overview, performance}.
 *   9. ArrowRight wraps focus across all 6 tabs in D-05 order.
 */

// --- next/navigation mocks --------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", async () => {
  return {
    useSearchParams: vi.fn(),
    useRouter: vi.fn(),
    usePathname: vi.fn(() => "/allocations"),
  };
});

import { useSearchParams, useRouter } from "next/navigation";

// --- Panel/body stubs -------------------------------------------------------
//
// Each panel/body component renders a unique marker so the tests can assert
// which surface is active without mounting the real implementation. Plans
// 05/08/10 fill these bodies later — the tab-shell contract should be
// independent of body content.

vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => (
    <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>
  ),
}));

vi.mock("./HoldingsTabPanel", () => ({
  HoldingsTabPanel: () => (
    <div data-testid="holdings-body">HOLDINGS_BODY</div>
  ),
}));

vi.mock("./OutcomesTabPanel", () => ({
  OutcomesTabPanel: () => (
    <div data-testid="outcomes-body">OUTCOMES_BODY</div>
  ),
}));

vi.mock("./MandateTabPanel", () => ({
  MandateTabPanel: () => (
    <div data-testid="mandate-body">MANDATE_BODY</div>
  ),
}));

vi.mock("./RiskTabPanel", () => ({
  RiskTabPanel: () => <div data-testid="risk-body">RISK_BODY</div>,
}));

vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => (
    <div data-testid="scenario-body">SCENARIO_BODY</div>
  ),
}));

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// --- Stub props -------------------------------------------------------------

const STUB_PROPS: MyAllocationDashboardPayload = {
  portfolio: null,
  analytics: null,
  strategies: [],
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [],
  snapshotCount: 0,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: null,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

const ACTIVE_BODIES = [
  "overview-v2",
  "holdings-body",
  "outcomes-body",
  "mandate-body",
  "risk-body",
  "scenario-body",
] as const;

function expectOnlyVisibleBody(testid: (typeof ACTIVE_BODIES)[number]): void {
  expect(screen.getByTestId(testid)).toBeInTheDocument();
  for (const other of ACTIVE_BODIES) {
    if (other === testid) continue;
    expect(screen.queryByTestId(other)).not.toBeInTheDocument();
  }
}

// Phase A6 — Holdings / Outcomes / Mandate / Risk tab bodies are now
// loaded via next/dynamic({ ssr: false }), so they only appear after the
// lazy chunk resolves. findByTestId polls until the body appears or the
// jest timeout elapses, which is the right abstraction for lazy modules.
async function expectOnlyVisibleBodyAsync(
  testid: (typeof ACTIVE_BODIES)[number],
): Promise<void> {
  await screen.findByTestId(testid);
  for (const other of ACTIVE_BODIES) {
    if (other === testid) continue;
    expect(screen.queryByTestId(other)).not.toBeInTheDocument();
  }
}

describe("AllocationsTabs — Phase 09.1 D-04 / D-05 / D-06", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("no tab param → Overview tab active, only overview body rendered", () => {
    setSearchParams("");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector("#panel-overview")?.getAttribute("hidden"),
    ).toBeNull();
    expect(
      container.querySelector("#panel-holdings")?.getAttribute("hidden"),
    ).not.toBeNull();
  });

  it("?tab=holdings → Holdings tab active", async () => {
    setSearchParams("tab=holdings");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("holdings-body");
    expect(
      screen.getByRole("tab", { name: "Holdings" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=outcomes → Outcomes tab active", async () => {
    setSearchParams("tab=outcomes");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("outcomes-body");
    expect(
      screen.getByRole("tab", { name: "Outcomes" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=mandate → Mandate tab active", async () => {
    setSearchParams("tab=mandate");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("mandate-body");
    expect(
      screen.getByRole("tab", { name: "Mandate" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=risk → Risk tab active", async () => {
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("risk-body");
    expect(
      screen.getByRole("tab", { name: "Risk" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=scenario → Scenario tab active", () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("scenario-body");
    expect(
      screen.getByRole("tab", { name: "Scenario" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=performance (legacy alias) → Overview + router.replace strips the param", () => {
    setSearchParams("tab=performance");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    // The cleanup effect must call router.replace with the tab param removed.
    expect(mockReplace).toHaveBeenCalled();
    const cleanupCall = mockReplace.mock.calls.find(
      (c) => typeof c[0] === "string" && !c[0].includes("tab="),
    );
    expect(
      cleanupCall,
      "router.replace called with tab param stripped",
    ).toBeDefined();
    expect(cleanupCall![1]).toEqual({ scroll: false });
  });

  it("?tab=xyz (unknown) → Overview silent fallback, no URL cleanup", () => {
    setSearchParams("tab=xyz");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    // Unknown values are NOT cleaned up — only "overview" and "performance"
    // trigger the strip effect. router.replace must not have been called.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("ArrowRight wraps focus across all 6 tabs in D-05 order", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const order = ["Overview", "Holdings", "Outcomes", "Mandate", "Risk", "Scenario"];
    // Walk the cycle: pressing ArrowRight on each tab calls changeTab(next),
    // which calls router.replace with the next tab in the URL.
    for (let i = 0; i < order.length; i++) {
      mockReplace.mockClear();
      const current = screen.getByRole("tab", { name: order[i] });
      fireEvent.keyDown(current, { key: "ArrowRight" });
      const expectedNext = order[(i + 1) % order.length];
      expect(mockReplace).toHaveBeenCalled();
      const call = mockReplace.mock.calls[0];
      const url = String(call[0]);
      if (expectedNext === "Overview") {
        // Overview is the default — no tab param in URL.
        expect(url.includes("tab=")).toBe(false);
      } else {
        expect(url).toContain(`tab=${expectedNext.toLowerCase()}`);
      }
    }
  });
});
