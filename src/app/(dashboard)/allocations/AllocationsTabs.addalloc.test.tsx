/**
 * Phase 116 / ADDALLOC-01/02/03 — context-aware "+ Allocation" header button.
 *
 * Pins the per-tab dispatch of the single header button (AllocationsTabs.tsx):
 *   - Holdings / Overview → label "+ Allocation", opens ContributionWizardOverlay
 *     inline (no navigation), aria-label states the real connect/CSV action.
 *   - Scenario → label "+ Strategy", opens the composer's StrategyBrowseDrawer
 *     (Task 2 seam), aria-label states the picker action; the wizard overlay
 *     does NOT open here.
 *   - Closing a header-triggered overlay returns focus to the header button.
 *   - onSuccess closes the overlay, returns focus, and refreshes the SSR payload.
 *
 * Both overlays are mocked to lightweight marker stubs so this asserts the
 * WIRING (which overlay opens + focus return + no navigation) without pulling
 * WizardClient / the real composer into jsdom. Harness idiom copied from
 * AllocationsTabs.scenario-composer.test.tsx.
 *
 * Local runs: touched allocations tests flake under parallelism — run with
 * `--no-file-parallelism`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

// --- next/navigation mocks -------------------------------------------------

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

// --- localStorage mock (gates the v2-default vs explicit-opt-out branch) ----

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  get length() {
    return lsStore.size;
  },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);

// --- Shared capture state for the ScenarioComposer stub (Task 2 host wiring) -
// vi.hoisted so the hoisted vi.mock factory can reference it safely.
const composerHarness = vi.hoisted(() => ({
  // Whether the composer stub auto-registers its Browse-open handler on render.
  // Task 2's pending-drain test flips this false to simulate the dynamic-import
  // loading window (registration arrives late).
  registerImmediately: true,
  // The host's onRegisterOpenBrowse prop (composer calls it to hand the host an
  // imperative open-Browse function). Captured so tests can register late.
  captureRegister: null as null | ((open: () => void) => void),
  // The host's onBrowseClosed prop (fired when the drawer closes so the host can
  // restore focus). Captured so tests can drive a close.
  captureBrowseClosed: null as null | (() => void),
  // Spy standing in for the composer's imperative "open Browse" function.
  browseOpenSpy: vi.fn(),
}));

// --- Panel / body stubs (shared with AllocationsTabs.test.tsx idiom) --------

vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => (
    <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>
  ),
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
  ScenarioStub: () => (
    <div data-testid="scenario-stub-body">SCENARIO_STUB_BODY</div>
  ),
}));

// The tab-level onboarding overlay host. Marker stub: renders only when open,
// with buttons that invoke the received onClose / onSuccess so the wiring
// (focus return, refresh) is assertable without mounting WizardClient.
vi.mock("./components/ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: (props: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (strategyId: string) => void;
  }) =>
    props.isOpen ? (
      <div data-testid="contribution-overlay-stub">
        <button
          type="button"
          data-testid="overlay-invoke-close"
          onClick={() => props.onClose()}
        >
          close
        </button>
        <button
          type="button"
          data-testid="overlay-invoke-success"
          onClick={() => props.onSuccess?.("test-id")}
        >
          success
        </button>
      </div>
    ) : null,
}));

// Minimal ScenarioComposer stub. Captures the Task-2 Browse seam props so the
// host-side "+ Strategy" tests can drive registration + close. Registration is
// done during render (ref-only host side effects, no setState) mirroring the
// onRegisterOpen capture idiom of the sibling test.
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: (props: {
    onRegisterOpen?: (open: (row: unknown) => void) => void;
    onScenarioSaved?: () => void;
    onRegisterOpenBrowse?: (open: () => void) => void;
    onBrowseClosed?: () => void;
  }) => {
    composerHarness.captureRegister = props.onRegisterOpenBrowse ?? null;
    composerHarness.captureBrowseClosed = props.onBrowseClosed ?? null;
    if (composerHarness.registerImmediately && props.onRegisterOpenBrowse) {
      props.onRegisterOpenBrowse(composerHarness.browseOpenSpy);
    }
    return (
      <div
        data-testid="scenario-composer-body"
        data-has-register-browse={props.onRegisterOpenBrowse ? "true" : "false"}
        data-has-browse-closed={props.onBrowseClosed ? "true" : "false"}
      >
        SCENARIO_COMPOSER_BODY
      </div>
    );
  },
}));

vi.mock("./components/SavedScenariosList", () => ({
  SavedScenariosList: () => (
    <div data-testid="saved-scenarios-list-body">SAVED_SCENARIOS_LIST_BODY</div>
  ),
}));

vi.mock("./components/ScenarioComparePanel", () => ({
  ScenarioComparePanel: () => (
    <div data-testid="scenario-compare-panel-body">
      SCENARIO_COMPARE_PANEL_BODY
    </div>
  ),
}));

// --- Imports after mocks ---------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";

// --- Stub props ------------------------------------------------------------

const ALLOCATOR_ID = "00000000-1111-2222-3333-444444444444";

const STUB_PROPS: MyAllocationDashboardPayload & {
  exposure: ExposureSectionData;
} = {
  exposure: EMPTY_EXPOSURE,
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
      side: null,
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ],
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  equityCurveSource: "legacy",
  derivedCurveComputedAt: null,
  minHistoryDepthMonths: null,
  equityBaselineUnknown: false,
  activeVenues: [],
  hasConnectedKeys: false,
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: {
    user_id: ALLOCATOR_ID,
    mandate_archetype: null,
    target_ticket_size_usd: null,
    excluded_exchanges: null,
    max_drawdown_tolerance: null,
    min_track_record_days: null,
    min_sharpe: null,
    max_aum_concentration: null,
    preferred_strategy_types: null,
    preferred_markets: ["binance"],
    updated_at: "2026-01-01T00:00:00Z",
    max_weight: null,
    correlation_ceiling: null,
    liquidity_preference: null,
    style_exclusions: null,
    mandate_edited_at: null,
    scoring_weight_overrides: null,
  },
  allocator_id: ALLOCATOR_ID,
  liveBaselineMetrics: {
    aum: 60_000,
    ytdTwr: 0.05,
    sharpe: 1.2,
    maxDd: -0.08,
    avgRho: 0.4,
    equity: [{ date: "2026-01-01", value: 1.0 }],
    drawdown: [{ date: "2026-01-01", value: 0 }],
  },
  perKeyReturnsByApiKeyId: {},
  perKeyDailiesGateSatisfied: false,
  eligibleApiKeyIds: [],
  apiKeysCount: 1,
  mandateIsSet: false,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

const ADD_ALLOCATION_NAME =
  /Add allocation — connect an exchange or upload a CSV/i;
const ADD_STRATEGY_NAME = /Add strategy — open the strategy picker/i;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AllocationsTabs — context-aware '+ Allocation' header button (Phase 116)", () => {
  beforeEach(() => {
    lsStore.clear();
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    composerHarness.registerImmediately = true;
    composerHarness.captureRegister = null;
    composerHarness.captureBrowseClosed = null;
    composerHarness.browseOpenSpy.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
  });

  // -------------------------------------------------------------------------
  // Task 1 — Holdings / Overview branch (ContributionWizardOverlay)
  // -------------------------------------------------------------------------

  it("T_ADDALLOC_1 overview (default tab): label '+ Allocation', opens the wizard overlay inline, no navigation", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const btn = screen.getByRole("button", { name: ADD_ALLOCATION_NAME });
    expect(btn).toHaveTextContent("+ Allocation");
    expect(screen.queryByTestId("contribution-overlay-stub")).toBeNull();

    fireEvent.click(btn);

    expect(screen.getByTestId("contribution-overlay-stub")).toBeInTheDocument();
    // No navigation to the scenario tab (the retired bug).
    for (const call of mockReplace.mock.calls) {
      expect(String(call[0])).not.toContain("tab=scenario");
    }
  });

  it("T_ADDALLOC_2 ?tab=holdings: label '+ Allocation', click opens the wizard overlay", async () => {
    setSearchParams("tab=holdings");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("holdings-body");

    const btn = screen.getByRole("button", { name: ADD_ALLOCATION_NAME });
    expect(btn).toHaveTextContent("+ Allocation");
    fireEvent.click(btn);
    expect(screen.getByTestId("contribution-overlay-stub")).toBeInTheDocument();
  });

  it("T_ADDALLOC_3 ?tab=scenario: label '+ Strategy' + picker aria; the wizard overlay does NOT open", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");

    const btn = screen.getByRole("button", { name: ADD_STRATEGY_NAME });
    expect(btn).toHaveTextContent("+ Strategy");
    // The Holdings/Overview aria-label must NOT be present on the scenario tab.
    expect(
      screen.queryByRole("button", { name: ADD_ALLOCATION_NAME }),
    ).toBeNull();

    fireEvent.click(btn);
    // Scenario dispatches to Browse (Task 2), never the wizard overlay.
    expect(screen.queryByTestId("contribution-overlay-stub")).toBeNull();
  });

  it("T_ADDALLOC_4 focus return: closing the header-opened overlay returns focus to the header button", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const btn = screen.getByRole("button", { name: ADD_ALLOCATION_NAME });
    fireEvent.click(btn);
    expect(screen.getByTestId("contribution-overlay-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-invoke-close"));

    expect(screen.queryByTestId("contribution-overlay-stub")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("T_ADDALLOC_5 onSuccess: closes the overlay, returns focus, refreshes exactly once", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const btn = screen.getByRole("button", { name: ADD_ALLOCATION_NAME });
    fireEvent.click(btn);
    expect(screen.getByTestId("contribution-overlay-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-invoke-success"));

    expect(screen.queryByTestId("contribution-overlay-stub")).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Task 2 — Scenario "+ Strategy" → composer Browse signal (host side)
  // -------------------------------------------------------------------------

  it("T_ADDALLOC_S1 scenario: clicking '+ Strategy' invokes the registered Browse-open once, no navigation", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");

    const btn = screen.getByRole("button", { name: ADD_STRATEGY_NAME });
    fireEvent.click(btn);

    expect(composerHarness.browseOpenSpy).toHaveBeenCalledTimes(1);
    for (const call of mockReplace.mock.calls) {
      expect(String(call[0])).not.toContain("tab=scenario");
    }
  });

  it("T_ADDALLOC_S2 scenario: composer receives the onRegisterOpenBrowse + onBrowseClosed seam props", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const body = await screen.findByTestId("scenario-composer-body");
    expect(body.getAttribute("data-has-register-browse")).toBe("true");
    expect(body.getAttribute("data-has-browse-closed")).toBe("true");
  });

  it("T_ADDALLOC_S3 pending drain: a click during the loading window opens Browse once registration arrives", async () => {
    // Simulate the dynamic-import loading window: the composer mounts but does
    // not register its Browse-open handler yet.
    composerHarness.registerImmediately = false;
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");

    const btn = screen.getByRole("button", { name: ADD_STRATEGY_NAME });
    fireEvent.click(btn);
    // Nothing registered yet → no open call, but the click is NOT lost.
    expect(composerHarness.browseOpenSpy).not.toHaveBeenCalled();

    // Registration arrives (composer chunk resolved) → the pending click drains.
    act(() => {
      composerHarness.captureRegister?.(composerHarness.browseOpenSpy);
    });
    expect(composerHarness.browseOpenSpy).toHaveBeenCalledTimes(1);
  });

  it("T_ADDALLOC_S6 scenario round-trip: a '+ Strategy' click before re-registration on remount drains via pending, not the stale unmounted setter (WR-02)", async () => {
    // First visit: the composer registers its imperative Browse-open setter, so
    // composerBrowseOpenRef points at THIS composer instance's setter.
    setSearchParams("tab=scenario");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");
    expect(composerHarness.captureRegister).not.toBeNull();

    // Leave the scenario tab → the composer unmounts. Simulate the remount's
    // dynamic-import loading window on the return trip: the next mount will NOT
    // re-register immediately.
    composerHarness.registerImmediately = false;
    setSearchParams("tab=holdings");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("holdings-body");

    // Return to scenario. The composer remounts but has not yet re-registered
    // its Browse-open setter (pre-registration window). Clear the shared spy's
    // call history so the next assertion reads only clicks from THIS window.
    composerHarness.browseOpenSpy.mockReset();
    setSearchParams("tab=scenario");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");

    // Click "+ Strategy" in the pre-registration window. Without the WR-02 fix,
    // composerBrowseOpenRef still holds the UNMOUNTED instance's setter, so the
    // click takes the truthy-ref branch, calls the dead spy, and never sets the
    // pending flag — the click is swallowed. With the fix the ref was nulled on
    // leave, so the click falls through to the pending-drain path.
    const btn = screen.getByRole("button", { name: ADD_STRATEGY_NAME });
    fireEvent.click(btn);
    expect(composerHarness.browseOpenSpy).not.toHaveBeenCalled();

    // Registration arrives (composer chunk finishes) → the pending click drains.
    act(() => {
      composerHarness.captureRegister?.(composerHarness.browseOpenSpy);
    });
    expect(composerHarness.browseOpenSpy).toHaveBeenCalledTimes(1);
  });

  it("T_ADDALLOC_S4 focus return: a header-initiated Browse close returns focus; a non-header close does not steal it", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");

    // Header-initiated open, then a close → focus returns to the header button.
    const btn = screen.getByRole("button", { name: ADD_STRATEGY_NAME });
    fireEvent.click(btn);
    act(() => {
      composerHarness.captureBrowseClosed?.();
    });
    expect(document.activeElement).toBe(btn);

    // A subsequent in-composer close (no prior header click) must NOT steal focus.
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      composerHarness.captureBrowseClosed?.();
    });
    expect(document.activeElement).not.toBe(btn);
  });
});
