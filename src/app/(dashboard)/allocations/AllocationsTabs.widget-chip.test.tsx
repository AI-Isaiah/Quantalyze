import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 09.1 REVIEW WR-01 regression — "Widget" chip in AllocationsTabs
 * dispatches `allocations:open-widget-picker` on click. When the user is on
 * a non-Overview tab, AllocationDashboardV2 is unmounted (lazy
 * `activeTab === "overview" && <AllocationDashboardV2 />`), so its
 * open-picker listener does not exist at the moment of click. The fix
 * defers the dispatch to the next microtask so the new tab's mount-time
 * effect can register the listener first.
 *
 * Test setup: stub AllocationDashboardV2 with a component that registers a
 * listener for `allocations:open-widget-picker` in a mount-time useEffect
 * and increments a counter when the event fires (mirrors the real
 * AllocationDashboardV2 effect at lines 86-92).
 *
 * The pre-fix behavior (synchronous dispatch) would drop the event when
 * the chip is clicked from a non-Overview tab → handler count stays 0.
 * The fix (queueMicrotask) flushes after the listener registers → handler
 * count is 1.
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

// --- Listener-counting AllocationDashboardV2 stub --------------------------
//
// Counts how many times the mount-time effect handler is invoked. Wires up
// the listener in useEffect to mirror the real component's pattern.

let pickerOpenCount = 0;

vi.mock("./AllocationDashboardV2", () => {
  function AllocationDashboardV2Stub() {
    const [, setOpen] = useState(false);
    useEffect(() => {
      const handler = () => {
        pickerOpenCount += 1;
        setOpen(true);
      };
      window.addEventListener("allocations:open-widget-picker", handler);
      return () => {
        window.removeEventListener(
          "allocations:open-widget-picker",
          handler,
        );
      };
    }, []);
    return <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>;
  }
  return { AllocationDashboardV2: AllocationDashboardV2Stub };
});

vi.mock("./HoldingsTabPanel", () => ({
  HoldingsTabPanel: () => <div data-testid="holdings-body">HOLDINGS_BODY</div>,
}));
vi.mock("./OutcomesTabPanel", () => ({
  OutcomesTabPanel: () => <div data-testid="outcomes-body">OUTCOMES_BODY</div>,
}));
vi.mock("./MandateTabPanel", () => ({
  MandateTabPanel: () => <div data-testid="mandate-body">MANDATE_BODY</div>,
}));
vi.mock("./RiskTabPanel", () => ({
  RiskTabPanel: () => <div data-testid="risk-body">RISK_BODY</div>,
}));
vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => <div data-testid="scenario-body">SCENARIO_BODY</div>,
}));
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: () => (
    <div data-testid="scenario-body">SCENARIO_COMPOSER_BODY</div>
  ),
}));

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

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
  holdingReturnsByScopeRef: {},
  allocator_id: "00000000-0000-0000-0000-000000000000",
  liveBaselineMetrics: {
    aum: 0,
    ytdTwr: null,
    sharpe: null,
    maxDd: null,
    avgRho: null,
    equity: [],
    drawdown: [],
  },
  apiKeysCount: 0,
  mandateIsSet: false,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

/**
 * Simulate the URL change after `router.replace` was called by changeTab.
 * The real Next.js app re-renders with new searchParams when the URL
 * changes; in the test we look at the most recent call to mockReplace
 * and rebind useSearchParams to mirror that URL, then re-render.
 */

describe("AllocationsTabs — WR-01 widget chip dispatches picker event after tab mount", () => {
  beforeEach(() => {
    pickerOpenCount = 0;
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

  it("clicking Widget while on Overview opens picker immediately (listener already mounted)", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(pickerOpenCount).toBe(0);

    const widgetChip = screen.getByRole("button", { name: "Add widget" });
    fireEvent.click(widgetChip);

    // Flush microtasks so the queueMicrotask handler runs.
    await Promise.resolve();

    expect(pickerOpenCount).toBe(1);
  });

  it("clicking Widget from a non-Overview tab dispatches AFTER tab mount (regression for WR-01)", async () => {
    // Start on Holdings — AllocationDashboardV2 is NOT mounted, so its
    // listener is not yet registered.
    setSearchParams("tab=holdings");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.queryByTestId("overview-v2")).not.toBeInTheDocument();
    expect(pickerOpenCount).toBe(0);

    const widgetChip = screen.getByRole("button", { name: "Add widget" });
    fireEvent.click(widgetChip);

    // changeTab calls router.replace; pre-fix code dispatches synchronously
    // here while AllocationDashboardV2 is still unmounted → event dropped.
    expect(mockReplace).toHaveBeenCalled();

    // Simulate the URL change → searchParams now has no tab → re-render.
    setSearchParams("");
    rerender(<AllocationsTabs {...STUB_PROPS} />);

    // After the rerender, AllocationDashboardV2 is mounted and its
    // useEffect (which adds the listener) runs synchronously after commit.
    // Then queueMicrotask flushes -- the listener is in place, the event
    // fires, count == 1.
    await Promise.resolve();

    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(pickerOpenCount).toBe(1);
  });
});
