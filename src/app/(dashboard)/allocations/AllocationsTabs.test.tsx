import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 07 Plan 04 Task 1 — TDD Red gate tests for AllocationsTabs
 * (PURGE-07 / VOICES-ACCEPTED f3).
 *
 * Covered behaviours:
 *   1. Default tab — searchParams={} → Performance visible, Scenario absent.
 *   2. Explicit ?tab=performance → Performance visible.
 *   3. ?tab=scenario → Scenario stub "Scenario builder coming soon" visible;
 *      Performance content absent.
 *   4. ?tab=bogus → silent fallback to Performance (D-04).
 *   5. Click Scenario button → router.replace called with a URL containing
 *      tab=scenario and { scroll: false }.
 *   6. Scenario stub has no interactive controls (no button onClick handlers).
 *   7. (f3) Browser back/forward: initial render with tab=scenario → scenario
 *      visible; rerender with searchParams={} → Performance visible. This
 *      test MUST fail if activeTab is snapshotted via useState. The plan
 *      explicitly diverges from ProfileTabs.tsx — activeTab MUST be derived
 *      from searchParams on every render.
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

// --- AllocationDashboard stub -----------------------------------------------
//
// Mock AllocationDashboard with a simple marker so we can assert on tab
// visibility without mounting the full widget grid + WIDGET_COMPONENTS
// lazy-loaded tree. The marker string is unique and short so queries like
// getByText work reliably under RTL.
vi.mock("./AllocationDashboard", () => ({
  AllocationDashboard: () => (
    <div data-testid="allocation-dashboard-marker">
      PERFORMANCE_TAB_CONTENT
    </div>
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
  // Phase 09 / D-08 + D-11 + finding f5
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

describe("AllocationsTabs — PURGE-07 / D-04 / f3", () => {
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

  it("default tab: searchParams={} renders Performance content", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByText("PERFORMANCE_TAB_CONTENT")).toBeInTheDocument();
    expect(
      screen.queryByText("Scenario builder coming soon"),
    ).not.toBeInTheDocument();
  });

  it("explicit performance: ?tab=performance renders Performance content", () => {
    setSearchParams("tab=performance");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByText("PERFORMANCE_TAB_CONTENT")).toBeInTheDocument();
  });

  it("scenario: ?tab=scenario renders Scenario stub, hides Performance", () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(
      screen.getByText("Scenario builder coming soon"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("PERFORMANCE_TAB_CONTENT"),
    ).not.toBeInTheDocument();
  });

  it("invalid fallback: ?tab=bogus silently falls back to Performance (D-04)", () => {
    setSearchParams("tab=bogus");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByText("PERFORMANCE_TAB_CONTENT")).toBeInTheDocument();
    expect(
      screen.queryByText("Scenario builder coming soon"),
    ).not.toBeInTheDocument();
  });

  it("click Scenario tab → router.replace called with ?tab=scenario and { scroll: false }", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const scenarioButton = screen.getByRole("tab", { name: "Scenario" });
    fireEvent.click(scenarioButton);
    expect(mockReplace).toHaveBeenCalled();
    const call = mockReplace.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("tab=scenario"),
    );
    expect(call, "router.replace call with tab=scenario").toBeDefined();
    expect(call![1]).toEqual({ scroll: false });
  });

  it("Scenario stub contains only the heading + body strings (no interactive controls)", () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // The stub must have the heading text.
    expect(
      screen.getByText("Scenario builder coming soon"),
    ).toBeInTheDocument();
    // And the body text (verbatim from UI-SPEC.md).
    expect(
      screen.getByText(
        "Model what-if outcomes by adding or removing strategies and holdings from your live composition. Available in the next update.",
      ),
    ).toBeInTheDocument();
    // The only interactive controls under the rendered tree should be the
    // two tab buttons themselves (role="tab" in the tablist above). No
    // other interactive controls inside the stub body — role="button"
    // returns nothing, and role="tab" returns exactly Performance + Scenario.
    expect(screen.queryAllByRole("button")).toEqual([]);
    const tabs = screen.getAllByRole("tab");
    const tabLabels = tabs.map((b) => b.textContent?.trim());
    expect(tabLabels).toEqual(["Performance", "Scenario"]);
  });

  it("re-renders correct tab when searchParams change (browser back/forward re-render — f3)", () => {
    // Initial render: searchParams has tab=scenario → Scenario visible.
    setSearchParams("tab=scenario");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(
      screen.getByText("Scenario builder coming soon"),
    ).toBeInTheDocument();

    // Simulate browser-back navigation: searchParams cleared, rerender.
    // Per VOICES-ACCEPTED f3: activeTab MUST re-derive from searchParams
    // on every render. If AllocationsTabs uses useState(parseTab(...)),
    // the initial scenario snapshot sticks and this assertion fails.
    setSearchParams("");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(
      screen.queryByText("Scenario builder coming soon"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("PERFORMANCE_TAB_CONTENT")).toBeInTheDocument();
  });
});
