/**
 * H-0058 — INTEGRATION test for the scenario-mode → leave-mode → re-enter
 * draft-preservation path.
 *
 * The existing AllocationsTabs.scenario-composer.test.tsx mocks ScenarioComposer
 * to an inert marker, so T_AT7 (Overview → Scenario → Overview) only proves the
 * tab CONTENT swaps — it cannot detect whether the REAL composer's draft state
 * (useScenarioState's toggleByScopeRef / weightOverrides / addedStrategies)
 * survives the tab switch.
 *
 * Production behavior: AllocationsTabs conditionally renders the scenario panel
 * (`{activeTab === "scenario" && <ScenarioComposer/>}`), so switching tabs
 * UNMOUNTS the composer, which destroys useScenarioState's React state. The
 * ONLY thing that brings a user's draft back on re-entry is localStorage
 * hydration inside useScenarioState's lazy initializers. If hydration drifts
 * (e.g. fingerprint recompute mismatch across mounts), the user silently loses
 * their draft on every tab switch.
 *
 * This test mounts the REAL ScenarioComposer + REAL useScenarioState inside the
 * REAL AllocationsTabs (only the composer's heavy chart/drawer children and the
 * pure scenario-adapter are mocked), toggles a holding off in Scenario, switches
 * to Overview (unmount), switches back (remount → hydrate), and asserts the
 * toggle survived. It is the integration coverage the finding says is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

// --- next/navigation mocks --------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(() => "/allocations"),
}));

import { useSearchParams, useRouter } from "next/navigation";

// --- usage-events client (AllocationsTabs imports it) -----------------------

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
}));

// --- Non-scenario tab panel stubs (same idiom as AllocationsTabs.test.tsx) --
// These are NOT the unit under test; stub them to inert markers.

vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>,
}));
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
  ScenarioStub: () => <div data-testid="scenario-stub-body">SCENARIO_STUB_BODY</div>,
}));

// --- Composer's heavy children mocked; ScenarioComposer itself is REAL ------
// We deliberately do NOT mock ./components/ScenarioComposer or
// ../hooks/useScenarioState — those are the integration units under test.

vi.mock("./widgets/performance/EquityChart", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./widgets/performance/EquityChart")
  >();
  return {
    ...actual,
    EquityChart: () => <div data-testid="equity-chart-mock" />,
  };
});
vi.mock("./widgets/performance/DrawdownChart", () => ({
  default: () => <div data-testid="drawdown-chart-mock" />,
  deriveSnapshotDrawdowns: vi.fn(() => []),
}));
vi.mock("./components/KpiStrip", () => ({
  KpiStrip: () => <div data-testid="kpi-strip-mock" />,
}));
vi.mock("./components/StrategyBrowseDrawer", () => ({
  StrategyBrowseDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="browse-drawer-mock" /> : null,
}));
vi.mock("./components/BridgeDrawer", () => ({
  BridgeDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="bridge-drawer-mock" /> : null,
}));
vi.mock("./components/ScenarioCommitDrawer", () => ({
  ScenarioCommitDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="commit-drawer-mock" /> : null,
}));
vi.mock("./ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: () => <div data-testid="flagged-list-mock" />,
}));

// Pure scenario-adapter mocked to a deterministic empty projection so
// computeScenario short-circuits — the composer's chart math is irrelevant to
// the draft-preservation contract under test.
vi.mock("./lib/scenario-adapter", () => ({
  buildStrategyForBuilderSet: vi.fn(() => ({
    strategies: [],
    state: { selected: {}, weights: {}, startDates: {} },
  })),
}));

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// --- localStorage shim — useScenarioState persists drafts here --------------

const ORIGINAL_LOCALSTORAGE_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

const ALLOCATOR_ID = "00000000-1111-2222-3333-444444444444";

const STUB_PROPS: MyAllocationDashboardPayload = {
  portfolio: null,
  analytics: null,
  strategies: [],
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1,
      mark_price_usd: 60_000,
      value_usd: 60_000,
      venue: "binance",
      holding_type: "spot",
      api_key_id: "key-binance",
    },
    {
      symbol: "ETH",
      quantity: 10,
      mark_price_usd: 4_000,
      value_usd: 40_000,
      venue: "binance",
      holding_type: "spot",
      api_key_id: "key-binance",
    },
  ] as unknown as MyAllocationDashboardPayload["holdingsSummary"],
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  equityBaselineUnknown: false,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: null,
  holdingReturnsByScopeRef: {},
  allocator_id: ALLOCATOR_ID,
  liveBaselineMetrics: {
    aum: 100_000,
    ytdTwr: null,
    sharpe: null,
    maxDd: null,
    avgRho: null,
    equity: [],
    drawdown: [],
  },
  apiKeysCount: 1,
  mandateIsSet: false,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

describe("AllocationsTabs — H-0058 scenario draft survives tab-switch (real composer + real useScenarioState)", () => {
  let storageShim: {
    map: Map<string, string>;
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
    key: (i: number) => string | null;
    readonly length: number;
  };

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
      getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k, v) => {
        map.set(k, String(v));
      },
      removeItem: (k) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: (i) => Array.from(map.keys())[i] ?? null,
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
    if (ORIGINAL_LOCALSTORAGE_DESCRIPTOR) {
      Object.defineProperty(window, "localStorage", ORIGINAL_LOCALSTORAGE_DESCRIPTOR);
    }
  });

  it("toggling a holding off in Scenario, leaving to Overview, and re-entering preserves the toggle (draft survives unmount/remount via localStorage)", async () => {
    // Start on the Scenario tab so the REAL composer mounts.
    setSearchParams("tab=scenario");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);

    // The real composer renders its composition list with a switch per holding.
    const btcSwitch = await screen.findByRole("switch", {
      name: /Toggle BTC on\/off in scenario/i,
    });
    // Default: BTC is ON.
    expect(btcSwitch.getAttribute("aria-checked")).toBe("true");

    // Toggle BTC OFF — useScenarioState updates the in-memory draft. As of
    // B7a-2 the localStorage write is DEBOUNCED (no synchronous setItem per
    // toggle, H-0125); the pending write flushes on the composer unmount below.
    await act(async () => {
      fireEvent.click(btcSwitch);
    });
    expect(
      screen
        .getByRole("switch", { name: /Toggle BTC on\/off in scenario/i })
        .getAttribute("aria-checked"),
    ).toBe("false");

    // LEAVE the scenario tab → Overview. This UNMOUNTS the composer (and with
    // it the useScenarioState React state) — the unmount flush writes the
    // pending debounced draft to the allocator-scoped key.
    setSearchParams("");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Toggle BTC on\/off in scenario/i }),
    ).toBeNull();

    // The draft was persisted under the allocator-scoped scenario key (flushed
    // on unmount), so it can be rehydrated on re-entry.
    const persistedKeys = Array.from(storageShim.map.keys()).filter((k) =>
      k.startsWith("allocations.scenario_v0_15."),
    );
    expect(persistedKeys.length).toBeGreaterThan(0);

    // RE-ENTER scenario → composer remounts → useScenarioState hydrates from
    // localStorage. The BTC toggle-off MUST survive the round trip.
    setSearchParams("tab=scenario");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    const btcSwitchAfter = await screen.findByRole("switch", {
      name: /Toggle BTC on\/off in scenario/i,
    });
    expect(btcSwitchAfter.getAttribute("aria-checked")).toBe("false");

    // ETH was never toggled — it stays ON across the round trip (proves we
    // restored the actual draft, not a blanket all-off / all-on default).
    expect(
      screen
        .getByRole("switch", { name: /Toggle ETH on\/off in scenario/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a fresh draft (no persisted state, no prior edit) re-enters Scenario with all holdings ON (default-init, no spurious mismatch across mounts)", async () => {
    // No prior edit. Mount scenario, leave, re-enter — both holdings stay ON.
    // This pins that the unmount/remount cycle does NOT recompute a fingerprint
    // that spuriously differs from the just-written draft (the failure mode the
    // finding calls out: "fingerprint recomputation differs across mounts").
    setSearchParams("tab=scenario");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    const list = await screen.findByRole("switch", {
      name: /Toggle BTC on\/off in scenario/i,
    });
    expect(list.getAttribute("aria-checked")).toBe("true");

    // Leave and re-enter without any edit.
    setSearchParams("");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    setSearchParams("tab=scenario");
    rerender(<AllocationsTabs {...STUB_PROPS} />);

    const btcAfter = await screen.findByRole("switch", {
      name: /Toggle BTC on\/off in scenario/i,
    });
    const ethAfter = screen.getByRole("switch", {
      name: /Toggle ETH on\/off in scenario/i,
    });
    expect(btcAfter.getAttribute("aria-checked")).toBe("true");
    expect(ethAfter.getAttribute("aria-checked")).toBe("true");
    // No fingerprint-mismatch banner should be showing on a clean re-entry.
    expect(screen.queryByText(/Keep my draft/i)).toBeNull();
  });
});
