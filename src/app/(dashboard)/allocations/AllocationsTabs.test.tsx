import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { within } from "@testing-library/react";

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
});

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
  let originalLocalStorage: Storage | undefined;

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

    originalLocalStorage = window.localStorage;
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
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
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
