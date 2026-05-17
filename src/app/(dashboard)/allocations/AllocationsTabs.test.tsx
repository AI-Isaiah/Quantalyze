import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

// audit-2026-05-07 testing HIGH (conf 9) — `trackUsageEventClient` is hoisted
// to a `vi.fn` so dispatchWidgetPicker tests can assert the documented
// payload shape (widget_picker_dispatch + source + wasAlreadyOnOverview).
// `vi.hoisted` lets the mock factory below capture this fn by reference
// without TDZ issues across vi.mock hoisting.
const { mockTrackUsageEventClient } = vi.hoisted(() => ({
  mockTrackUsageEventClient: vi.fn(),
}));
vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: mockTrackUsageEventClient,
}));

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

// Phase 10 / 10-06b — `?tab=scenario` now routes to ScenarioComposer when
// the v2 cohort flag is on (default in v0.15.7.0+). The composer is mocked
// to the SAME `scenario-body` testid as the legacy ScenarioStub so the
// existing 6-tab routing tests below continue to assert "scenario panel
// visible" without caring which branch rendered. Plan 06b's dedicated
// scenario-composer test file (AllocationsTabs.scenario-composer.test.tsx)
// asserts the v1/v2 branch contract directly.
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: () => (
    <div data-testid="scenario-body">SCENARIO_COMPOSER_BODY</div>
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
  // Phase 10 / Plan 10-03 — additive payload fields. Empty defaults match
  // the !portfolio + no-snapshots branch so the V1 / Stub paths render
  // their empty states unchanged.
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
  // Phase 11 / 11-05 — onboarding visibility predicate inputs.
  apiKeysCount: 0,
  mandateIsSet: false,
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

  it("?tab=scenario → Scenario panel visible (PR3: hidden from tablist, still routable via URL + + Allocation chip)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // Phase 10 / 10-06b — ScenarioComposer is dynamic-imported (next/dynamic
    // ssr:false), so the body resolves on the next microtask. The sync
    // helper would race with the loading-skeleton fallback; the async
    // helper polls until the testid appears.
    await expectOnlyVisibleBodyAsync("scenario-body");
    // PR3 (HANDOFF dashboard parity) — Scenario is no longer rendered as
    // a button in the tablist (truth screenshot is 5 tabs). It remains
    // routable via ?tab=scenario and via the green "+ Allocation" chip,
    // so the panel is mounted but no tab role exists for it.
    expect(screen.queryByRole("tab", { name: "Scenario" })).toBeNull();
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

  it("ArrowRight wraps focus across the 5 visible tabs in D-05 order (PR3: Scenario excluded)", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // PR3 — visible tablist is 5 tabs (no Scenario). Wrap from Risk → Overview.
    const order = ["Overview", "Holdings", "Outcomes", "Mandate", "Risk"];
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

// --- audit-2026-05-07 cluster P regression tests ----------------------------

describe("AllocationsTabs — audit-2026-05-07 cluster P count badges (H-1189 / M-1042)", () => {
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

  it("renders count badges on Holdings (8) and Outcomes (4) tabs when arrays are populated", () => {
    setSearchParams("");
    const holdings = Array.from({ length: 8 }).map((_, i) => ({ id: `h-${i}` }));
    const outcomes = Array.from({ length: 4 }).map((_, i) => ({ id: `o-${i}` }));
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        holdingsSummary={holdings as unknown as MyAllocationDashboardPayload["holdingsSummary"]}
        outcomes={outcomes as unknown as MyAllocationDashboardPayload["outcomes"]}
      />,
    );

    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).getByText("8")).toBeInTheDocument();

    const outcomesTab = screen.getByRole("tab", { name: /Outcomes/ });
    expect(within(outcomesTab).getByText("4")).toBeInTheDocument();
  });

  it("hides the badge when count is 0 — no '0' chip", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).queryByText("0")).toBeNull();
    const outcomesTab = screen.getByRole("tab", { name: /Outcomes/ });
    expect(within(outcomesTab).queryByText("0")).toBeNull();
  });

  it("renders '1' badge correctly (pins the >0 gate, not >=2)", () => {
    setSearchParams("");
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        holdingsSummary={[{ id: "h-only" }] as unknown as MyAllocationDashboardPayload["holdingsSummary"]}
      />,
    );
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).getByText("1")).toBeInTheDocument();
  });

  it("undefined holdingsSummary does not crash and no badge renders", () => {
    setSearchParams("");
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        holdingsSummary={
          undefined as unknown as MyAllocationDashboardPayload["holdingsSummary"]
        }
      />,
    );
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).queryByText(/\d/)).toBeNull();
  });
});

describe("AllocationsTabs — audit-2026-05-07 cluster P Export chip (M-1041 / M-1044)", () => {
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

  it("Export chip from Risk tab navigates to Holdings (M-1041 regression)", async () => {
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    expect(mockReplace).toHaveBeenCalled();
    const url = String(mockReplace.mock.calls[0][0]);
    expect(url).toContain("tab=holdings");
  });

  it("Export chip announces redirect via aria-live region (M-1044 silent-failure fix)", () => {
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    expect(liveRegion.textContent).toBe("");
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    expect(liveRegion.textContent).toContain("Export");
    expect(liveRegion.textContent).toContain("Holdings");
    // aria-live wiring keeps the message a polite announcement.
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.getAttribute("role")).toBe("status");
  });

  it("Export chip clicked from Holdings does NOT re-announce (no surface change)", () => {
    setSearchParams("tab=holdings");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    expect(liveRegion.textContent).toBe("");
  });
});

describe("AllocationsTabs — audit-2026-05-07 cluster P silent-failure breadcrumbs (M-1045 / M-1046)", () => {
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

  it("?tab=outcoms (typo) emits warnAudit invalid_tab_fallback breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=outcoms");
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(warnSpy).toHaveBeenCalled();
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("[AllocationsTabs]") &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    expect(matching![1]).toEqual({ raw: "outcoms" });
    warnSpy.mockRestore();
  });

  it("?tab=performance (known legacy alias) does NOT emit invalid_tab breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=performance");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("no tab param does NOT emit invalid_tab breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("router.refresh throw is caught and breadcrumbed (M-1046)", () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRefresh.mockImplementation(() => {
      throw new Error("simulated route-handler 5xx");
    });
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    // Polling interval is 30s — advance past one tick.
    vi.advanceTimersByTime(31_000);

    expect(mockRefresh).toHaveBeenCalled();
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("router_refresh_failed"),
    );
    expect(matching).toBeDefined();
    expect(
      (matching![1] as { reason: string }).reason,
    ).toContain("simulated route-handler 5xx");
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  // audit-2026-05-07 testing HIGH (conf 8) — the previous M-1046 test only
  // advances one 31s tick. A regression that lets the throw escape the
  // interval callback (e.g. removing the try/catch) would STILL pass that
  // test because setInterval keeps firing the SAME callback even after
  // a throw escapes it — but the breadcrumb assertion would also pass on
  // the FIRST tick. The whole point of the M-1046 fix is "we don't want
  // the interval to silently die" — this test pins that by advancing TWO
  // ticks and asserting mockRefresh fires twice AND the breadcrumb fires
  // twice. Cleanup: unmount and advance a third tick — mockRefresh must
  // NOT be called a third time.
  it("router.refresh throw — interval keeps polling across multiple ticks and cleans up on unmount (M-1046)", () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRefresh.mockImplementation(() => {
      throw new Error("simulated route-handler 5xx");
    });
    setSearchParams("");
    const { unmount } = render(<AllocationsTabs {...STUB_PROPS} />);

    // Two ticks (60s + slop). Each must call refresh + emit a breadcrumb;
    // the interval MUST keep polling after the first throw is swallowed.
    vi.advanceTimersByTime(62_000);

    expect(mockRefresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    const breadcrumbCount = warnSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("router_refresh_failed"),
    ).length;
    expect(breadcrumbCount).toBeGreaterThanOrEqual(2);

    // Cleanup contract — unmount must clearInterval. Advance a 3rd tick
    // worth and assert mockRefresh stays at its current call count.
    const beforeUnmount = mockRefresh.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(31_000);
    expect(mockRefresh.mock.calls.length).toBe(beforeUnmount);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});

// audit-2026-05-07 testing MED — capture the ORIGINAL window.localStorage
// descriptor exactly once at module load, before any describe block has had
// a chance to install a shim. Restoring via descriptor avoids the
// "originalLocalStorage captured a partial-failure shim" leak that a
// per-describe beforeEach would have if a prior test crashed mid-setup.
// Also more robust against test reordering: regardless of which test runs
// first, the restore always points back to the real jsdom Storage.
const ORIGINAL_LOCALSTORAGE_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

describe("AllocationsTabs — audit-2026-05-07 cluster P loadUiV2Flag (C-0336 / H-0060)", () => {
  // Vitest's jsdom environment here exposes a localStorage backend that
  // doesn't permit direct setItem/spyOn (see `--localstorage-file` warning).
  // Override `window.localStorage` with a vanilla in-memory shim so the
  // C-0336 / H-1188 paths are exercisable. `Object.defineProperty` is the
  // only setter that works on the read-only window.localStorage descriptor.
  type StorageShim = {
    map: Map<string, string>;
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
    key: (i: number) => string | null;
    readonly length: number;
  };
  let storageShim: StorageShim;

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

    const map = new Map<string, string>();
    storageShim = {
      map,
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      get length() {
        return map.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storageShim,
    });
  });

  afterEach(() => {
    // Restore from the module-load descriptor so partial-failure shims
    // installed by a prior test can never leak into subsequent describes.
    if (ORIGINAL_LOCALSTORAGE_DESCRIPTOR) {
      Object.defineProperty(
        window,
        "localStorage",
        ORIGINAL_LOCALSTORAGE_DESCRIPTOR,
      );
    }
  });

  it("localStorage getItem throw emits loadUiV2Flag_failed breadcrumb (C-0336)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    storageShim.getItem = () => {
      throw new Error("SecurityError: storage blocked");
    };

    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("loadUiV2Flag_failed"),
    );
    expect(matching).toBeDefined();
    expect(
      (matching![1] as { reason: string }).reason,
    ).toContain("SecurityError");
    warnSpy.mockRestore();
  });

  it("explicit allocations.ui_v2=false emits ui_v2_rollback_scope_scenario_only breadcrumb (H-1188)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    storageShim.setItem("allocations.ui_v2", "false");
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only"),
    );
    expect(matching).toBeDefined();
    expect(
      (matching![1] as { affected_surface: string }).affected_surface,
    ).toBe("scenario");
    warnSpy.mockRestore();
  });

  it("no allocations.ui_v2 (default branch) does NOT emit rollback breadcrumb (H-1188)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });
});

// --- audit-2026-05-07 Phase-2 testing-specialist additions ------------------
//
// Each describe below resets the router mocks in beforeEach via the shared
// resetRouterMocks helper to avoid duplicating the four-line setup the
// maintainability specialist flagged. New coverage:
//   - dispatchWidgetPicker (sync / deferred / failed paths + telemetry)
//   - parseTab boundary cases (empty / whitespace / uppercase / canonical
//     parameterized) — pins the KNOWN_TAB_RAW contract as a test instead of
//     a comment.
//   - Export chip scroll:false + single-shot routing pin (M-1041 hardening)
//   - Export chip same-tab repeat click re-announce (M-1044 silent-failure
//     fix is itself uncovered against the React Object.is bail-out path).

function resetRouterMocks(): void {
  mockReplace.mockReset();
  mockRefresh.mockReset();
  mockPush.mockReset();
  mockTrackUsageEventClient.mockReset();
  vi.mocked(useRouter).mockReturnValue({
    replace: mockReplace,
    refresh: mockRefresh,
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
}

describe("AllocationsTabs — audit-2026-05-07 Phase-2 dispatchWidgetPicker (HIGH conf 9)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  it("Widget chip from Overview dispatches synchronously + telemetry 'sync'", () => {
    setSearchParams("");
    const evtSpy = vi.fn();
    window.addEventListener("allocations:open-widget-picker", evtSpy);

    try {
      render(<AllocationsTabs {...STUB_PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Add widget" }));

      // Synchronous fire — no microtask / timer flush needed on Overview.
      expect(evtSpy).toHaveBeenCalledTimes(1);
      expect(mockTrackUsageEventClient).toHaveBeenCalledTimes(1);
      const [eventName, payload] = mockTrackUsageEventClient.mock.calls[0];
      expect(eventName).toBe("widget_viewed");
      expect(payload).toMatchObject({
        widget_picker_dispatch: "sync",
        source: "tab_row_chip",
        wasAlreadyOnOverview: true,
      });
    } finally {
      window.removeEventListener("allocations:open-widget-picker", evtSpy);
    }
  });

  it("Widget chip from non-Overview defers via microtask + 100ms safety-net (telemetry 'deferred')", async () => {
    vi.useFakeTimers();
    setSearchParams("tab=risk");
    const evtSpy = vi.fn();
    window.addEventListener("allocations:open-widget-picker", evtSpy);

    try {
      render(<AllocationsTabs {...STUB_PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Add widget" }));

      // Microtask queue flush — queueMicrotask resolves on the next
      // microtask checkpoint, which vi.advanceTimersByTime(0) reaches via
      // the queued Promise chain.
      await vi.advanceTimersByTimeAsync(0);
      expect(evtSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      // 100ms setTimeout safety net — second dispatch (listener is
      // idempotent so this is intentional).
      await vi.advanceTimersByTimeAsync(100);
      expect(evtSpy).toHaveBeenCalledTimes(2);

      // Telemetry: exactly one event per click with status 'deferred'.
      expect(mockTrackUsageEventClient).toHaveBeenCalledTimes(1);
      const [, payload] = mockTrackUsageEventClient.mock.calls[0];
      expect(payload).toMatchObject({
        widget_picker_dispatch: "deferred",
        source: "tab_row_chip",
        wasAlreadyOnOverview: false,
      });
    } finally {
      window.removeEventListener("allocations:open-widget-picker", evtSpy);
      vi.useRealTimers();
    }
  });

  it("Widget chip on Overview — dispatchEvent throws → 'failed' telemetry + warnAudit breadcrumb", () => {
    setSearchParams("");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const originalDispatch = window.dispatchEvent.bind(window);
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((evt: Event) => {
        if (evt.type === "allocations:open-widget-picker") {
          throw new Error("simulated CustomEvent throw");
        }
        return originalDispatch(evt);
      });

    try {
      render(<AllocationsTabs {...STUB_PROPS} />);
      fireEvent.click(screen.getByRole("button", { name: "Add widget" }));

      // Telemetry status reflects the failed dispatch.
      expect(mockTrackUsageEventClient).toHaveBeenCalledTimes(1);
      const [, payload] = mockTrackUsageEventClient.mock.calls[0];
      expect(payload).toMatchObject({
        widget_picker_dispatch: "failed",
        source: "tab_row_chip",
        wasAlreadyOnOverview: true,
      });

      // warnAudit breadcrumb fires with reason string.
      const matching = warnSpy.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("widget_picker_dispatch_failed"),
      );
      expect(matching).toBeDefined();
      expect(
        (matching![1] as { reason: string }).reason,
      ).toContain("simulated CustomEvent throw");
    } finally {
      dispatchSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe("AllocationsTabs — audit-2026-05-07 Phase-2 parseTab boundary cases (MED conf 8)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // Pin the KNOWN_TAB_RAW contract — none of these canonical keys should
  // emit invalid_tab_fallback. Locks the constant set as part of the
  // tested contract instead of leaving it as documentation.
  for (const raw of [
    "overview",
    "holdings",
    "outcomes",
    "mandate",
    "risk",
    "scenario",
    "performance",
  ] as const) {
    it(`?tab=${raw} (canonical) does NOT emit invalid_tab_fallback breadcrumb`, () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      setSearchParams(`tab=${raw}`);
      render(<AllocationsTabs {...STUB_PROPS} />);
      const matching = warnSpy.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("invalid_tab_fallback"),
      );
      expect(matching).toBeUndefined();
      warnSpy.mockRestore();
    });
  }

  it("?tab= (empty string) does NOT warn (length>0 guard pins this)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("?tab=%20 (whitespace) DOES warn — case-sensitive, no .trim() in parseTab", () => {
    // Documents the current contract: whitespace is non-empty and not in
    // KNOWN_TAB_RAW → it warns. If a future fix adds .trim(), this test
    // is the canonical place to flip the assertion to .toBeUndefined().
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=%20");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    warnSpy.mockRestore();
  });

  it("?tab=HOLDINGS (uppercase canonical) DOES warn — case-sensitive contract", () => {
    // Documents the current contract: canonical keys are lowercase-only.
    // If a future fix adds toLowerCase(), this test is the canonical
    // place to flip the assertion to .toBeUndefined().
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=HOLDINGS");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    warnSpy.mockRestore();
  });
});

describe("AllocationsTabs — audit-2026-05-07 Phase-2 Export chip hardening (MED conf 8)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  it("Export chip from Risk: router.replace called exactly ONCE with { scroll: false }", () => {
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // Pre-render setup may call replace zero times (no cleanup needed for
    // tab=risk since risk is canonical and stays). Clear to isolate the
    // click's effect.
    mockReplace.mockClear();

    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);

    // Single-shot: exactly one replace call from the click path.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [, opts] = mockReplace.mock.calls[0];
    expect(opts).toEqual({ scroll: false });
  });

  it("Export chip clicked twice from Risk → re-announces (Object.is bail-out pinned)", () => {
    // The maintainability specialist flagged that setExportAnnouncement
    // with the SAME string skips React's re-render → aria-live=polite
    // does not re-announce identical content. The seq-suffix fix
    // guarantees each click produces a non-equal string. This test pins
    // the new contract so a regression that drops the suffix breaks here.
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    const exportChip = screen.getByRole("button", { name: "Export" });

    fireEvent.click(exportChip);
    const firstText = liveRegion.textContent ?? "";
    expect(firstText).toContain("Export");
    expect(firstText).toContain("Holdings");

    // Simulate user navigating back to Risk and clicking Export again
    // from the same tab. The URL change is mocked, so re-set the params.
    setSearchParams("tab=risk");
    fireEvent.click(exportChip);
    const secondText = liveRegion.textContent ?? "";

    // String identities must differ so aria-live=polite re-announces.
    // The visible portion ("Export lives in the Holdings tab…") is the
    // same; the zero-width-space suffix makes the strings non-equal.
    expect(secondText).not.toBe(firstText);
    expect(secondText).toContain("Export");
    expect(secondText).toContain("Holdings");
  });
});
