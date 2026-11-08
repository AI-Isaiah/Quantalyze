/**
 * Phase 198 D-03 — the header "+ Allocation" opens the allocator's own flow on
 * EVERY tab (AllocationsTabs.tsx).
 *
 * WHY this file exists: Phase 116 gave the header button three jobs (open the
 * manager's wizard on Overview and Holdings, open the composer's picker on
 * Scenario, open the wizard again on the rollback path). D-03 replaced all of
 * them with one: an allocator picks a strategy and enters an amount in
 * AddAllocationFlow, and never lands in the manager's strategy wizard from
 * their own header. This pins that wiring:
 *   - the label and accessible name are the same on every tab, Scenario and the
 *     rollback (isUiV2 === false) surface included;
 *   - the click mounts the flow (open, no deep link) and never WizardClient,
 *     which this file mocks to a sentinel so ANY path into it is caught;
 *   - the flow gets the held set (Holdings plus allocated outcomes), Book
 *     equity and the stale flag from the payload;
 *   - close and success return focus to the header button, and success is
 *     announced through the page's polite live region and refreshes the
 *     payload exactly once;
 *   - the flow's callbacks keep one identity across a parent re-render (the 30s
 *     Overview poll), or the flow's open effect would steal focus from a typing
 *     allocator;
 *   - the composer on Scenario gets no host Browse seam, so its own
 *     "Browse strategies" stays the way to add a strategy to a model.
 *
 * The flow, the composer and the WizardClient are mocked: this asserts the
 * WIRING without pulling the real surfaces into jsdom. Harness idiom copied from
 * AllocationsTabs.scenario-composer.test.tsx.
 *
 * Local runs: touched allocations tests flake under parallelism, so run with
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
// Phase 140.5-01 / SEAMPROSE-04 — installed PER TEST, not at module scope.
// `vitest.config.ts` sets `unstubGlobals: true`, which restores stubbed globals
// before every test, so a stub applied once at import time is gone by the time
// the first test runs. Re-applying it here also removes a real leak: a stub set
// at module scope is never undone, so it reaches every later file in the same
// worker (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});

// --- Shared capture state for the stubs ------------------------------------
// vi.hoisted so the hoisted vi.mock factories can reference it safely.
const harness = vi.hoisted(() => ({
  // The last props the flow stub received.
  flowProps: null as null | {
    open: boolean;
    deepLink: { raw: string } | null;
    heldStrategyIds: ReadonlySet<string>;
    bookEquityUsd: number | null;
    allKeysStale: boolean;
  },
  // Every onClose / onRecorded identity the flow receives, in render order. The
  // memoization test reads the last two to prove the references are stable.
  onClose: [] as Array<() => void>,
  onRecorded: [] as Array<(announcement: string) => void>,
  // The seam props the composer was rendered with (D-03 removed the seam).
  composerSeamProps: [] as string[],
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

vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => (
    <div data-testid="scenario-stub-body">SCENARIO_STUB_BODY</div>
  ),
}));

// The manager's strategy wizard. A sentinel: if any header path mounts it, this
// text appears and the test that expects its absence goes red.
vi.mock("@/app/(dashboard)/strategies/new/wizard/WizardClient", () => ({
  WizardClient: () => <div data-testid="wizard-client-sentinel">WIZARD</div>,
}));

// The allocator flow. A marker stub: a dialog named "Add allocation" only while
// open, with buttons that drive the received callbacks, and the received props
// captured for assertion.
vi.mock("./components/AddAllocationFlow", () => ({
  AddAllocationFlow: (props: {
    open: boolean;
    onClose: () => void;
    onRecorded: (announcement: string) => void;
    deepLink: { raw: string } | null;
    heldStrategyIds: ReadonlySet<string>;
    bookEquityUsd: number | null;
    allKeysStale: boolean;
  }) => {
    harness.flowProps = props;
    // Recorded on EVERY render (open or not) so the memoization test can
    // compare identities across a forced parent re-render.
    harness.onClose.push(props.onClose);
    harness.onRecorded.push(props.onRecorded);
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="Add allocation">
        <button
          type="button"
          data-testid="flow-invoke-close"
          onClick={() => props.onClose()}
        >
          close
        </button>
        <button
          type="button"
          data-testid="flow-invoke-recorded"
          onClick={() => {
            // The real flow calls onRecorded, then onClose.
            props.onRecorded("Allocation recorded: Test Strategy");
            props.onClose();
          }}
        >
          recorded
        </button>
      </div>
    );
  },
}));

vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: (props: Record<string, unknown>) => {
    harness.composerSeamProps = [
      "onRegisterOpenBrowse",
      "onBrowseClosed",
      "onBrowseHandoff",
    ].filter((k) => props[k] !== undefined);
    return (
      <div data-testid="scenario-composer-body">SCENARIO_COMPOSER_BODY</div>
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
  snapshotCount: null,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  equityCurveSource: "legacy",
  // Phase 167.1.2 / D-02: the producer emits "rebuilding" for every allocator.
  equityHistoryState: "rebuilding",
  equityDailyReturns: [],
  equityHistoryRebuildReason: null,
  derivedCurveComputedAt: null,
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
  // Phase 151 / AUM-04 — the split book-entry gate. No eligible keys here, so
  // no key can be allocator-side and none can contribute.
  allocatorEligibleApiKeyIds: [],
  contributingApiKeyIds: [],
  bookEntryGateSatisfied: false,
  apiKeysCount: 1,
  mandateIsSet: false,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

const ADD_NAME = /Add allocation — pick a strategy and enter an amount/i;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AllocationsTabs — header '+ Allocation' opens the allocator flow on every tab (Phase 198 D-03)", () => {
  beforeEach(() => {
    lsStore.clear();
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    harness.flowProps = null;
    harness.onClose.length = 0;
    harness.onRecorded.length = 0;
    harness.composerSeamProps = [];
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
  });

  // Each surface the button lives on, as [name, query, body to wait for, flag].
  const SURFACES: ReadonlyArray<{
    name: string;
    query: string;
    body: string;
    rollback: boolean;
  }> = [
    { name: "Overview", query: "", body: "overview-v2", rollback: false },
    {
      name: "Holdings",
      query: "tab=holdings",
      body: "holdings-body",
      rollback: false,
    },
    {
      name: "Scenario",
      query: "tab=scenario",
      body: "scenario-composer-body",
      rollback: false,
    },
    {
      name: "Scenario rollback (isUiV2 false)",
      query: "tab=scenario",
      body: "scenario-stub-body",
      rollback: true,
    },
  ];

  for (const surface of SURFACES) {
    it(`T_ADDALLOC_1 ${surface.name}: label '+ Allocation', allocator accessible name, click opens the flow, never the manager wizard, no navigation`, async () => {
      // WHY (D-03): an allocator must never be dropped into the manager's
      // strategy wizard from their own header, on any tab or on the rollback
      // path. The WizardClient sentinel is the proof of absence.
      if (surface.rollback) lsStore.set("allocations.ui_v2", "false");
      setSearchParams(surface.query);
      render(<AllocationsTabs {...STUB_PROPS} />);
      await screen.findByTestId(surface.body);

      const btn = screen.getByRole("button", { name: ADD_NAME });
      expect(btn).toHaveTextContent("+ Allocation");
      // The retired per-tab labels are gone, so Scenario reads the same.
      expect(screen.queryByRole("button", { name: /Add strategy/i })).toBeNull();
      expect(screen.queryByRole("dialog", { name: "Add allocation" })).toBeNull();

      fireEvent.click(btn);

      expect(
        screen.getByRole("dialog", { name: "Add allocation" }),
      ).toBeInTheDocument();
      expect(harness.flowProps?.open).toBe(true);
      expect(harness.flowProps?.deepLink).toBeNull();
      expect(screen.queryByTestId("wizard-client-sentinel")).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  }

  it("T_ADDALLOC_2 the accessible name never mentions the Scenario tab", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const btn = screen.getByRole("button", { name: ADD_NAME });
    expect(btn.getAttribute("aria-label")).not.toContain("Scenario tab");
  });

  it("T_ADDALLOC_3 the flow gets the held set (Holdings plus allocated outcomes), Book equity and the stale flag from the payload", () => {
    // WHY: the commit route has no per-strategy uniqueness, so the held set is
    // what stops a strategy already in the book being added a second time. A
    // rejected outcome is a decision NOT to allocate and holds nothing.
    setSearchParams("");
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        allKeysStale
        strategies={
          [
            { strategy_id: "s-held" },
          ] as unknown as MyAllocationDashboardPayload["strategies"]
        }
        outcomes={
          [
            { kind: "allocated", replacement_strategy: { id: "s-outcome" } },
            { kind: "rejected", replacement_strategy: { id: "s-rejected" } },
          ] as unknown as MyAllocationDashboardPayload["outcomes"]
        }
        // The capped `outcomes` list can lose a held strategy (past 200 rows, or a
        // null join); the uncapped id read is what still holds it.
        heldOutcomeStrategyIds={["s-beyond-the-cap"]}
      />,
    );

    const flow = harness.flowProps!;
    expect(Array.from(flow.heldStrategyIds).sort()).toEqual([
      "s-beyond-the-cap",
      "s-held",
      "s-outcome",
    ]);
    // 1 BTC at 60k, the one reported contribution.
    expect(flow.bookEquityUsd).toBe(60_000);
    expect(flow.allKeysStale).toBe(true);
  });

  it("T_ADDALLOC_4 focus return: closing the header-opened flow returns focus to the header button", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const btn = screen.getByRole("button", { name: ADD_NAME });
    fireEvent.click(btn);
    fireEvent.click(screen.getByTestId("flow-invoke-close"));

    expect(screen.queryByRole("dialog", { name: "Add allocation" })).toBeNull();
    expect(document.activeElement).toBe(btn);
    // A plain close records nothing, so it neither refreshes nor announces.
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("T_ADDALLOC_5 recorded: the success line is announced in the live region, the payload refreshes exactly once, focus returns once the flow closes", async () => {
    // WHY: the flow's own success line says where the allocation landed, and the
    // host owns the page's one polite live region and the refresh that makes the
    // new row appear without waiting for the 30s poll.
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const btn = screen.getByRole("button", { name: ADD_NAME });
    fireEvent.click(btn);
    fireEvent.click(screen.getByTestId("flow-invoke-recorded"));
    // The microtask-clear idiom commits "" first, then the message.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("allocations-tabs-live-region").textContent).toBe(
      "Allocation recorded: Test Strategy",
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Add allocation" })).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("T_ADDALLOC_5b a throwing router.refresh is caught and breadcrumbed, and the announcement still lands", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRefresh.mockImplementation(() => {
      throw new Error("simulated route-handler 5xx");
    });
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: ADD_NAME }));
    expect(() =>
      fireEvent.click(screen.getByTestId("flow-invoke-recorded")),
    ).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      warnSpy.mock.calls.some(
        (c) => typeof c[0] === "string" && c[0].includes("router_refresh_failed"),
      ),
    ).toBe(true);
    expect(screen.getByTestId("allocations-tabs-live-region").textContent).toBe(
      "Allocation recorded: Test Strategy",
    );
    warnSpy.mockRestore();
  });

  it("T_ADDALLOC_6 memoization: onClose/onRecorded identities are referentially STABLE across a parent re-render (no 30s-poll focus theft)", () => {
    // WHY (Rule 9): the Overview tab runs a 30s router.refresh() poll that
    // re-renders AllocationsTabs. The flow's open effect has onClose in its deps
    // and pulls focus into the panel, so a NEW onClose identity on each poll
    // would yank focus from the amount the allocator is typing. useCallback pins
    // the identities; this fails (identities differ) if either is unwrapped.
    setSearchParams("");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: ADD_NAME }));
    const closeBefore = harness.onClose.at(-1);
    const recordedBefore = harness.onRecorded.at(-1);
    expect(closeBefore).toBeTypeOf("function");
    expect(recordedBefore).toBeTypeOf("function");

    // Force a parent re-render, the same mechanism the 30s poll drives.
    rerender(<AllocationsTabs {...STUB_PROPS} />);

    // A fresh render happened (a new identity was recorded to compare).
    expect(harness.onClose.length).toBeGreaterThan(1);
    expect(harness.onClose.at(-1)).toBe(closeBefore);
    expect(harness.onRecorded.at(-1)).toBe(recordedBefore);
  });

  it("T_ADDALLOC_7 Scenario: the composer receives NO host Browse seam props (its own 'Browse strategies' is the way to add to a model)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("scenario-composer-body");
    expect(harness.composerSeamProps).toEqual([]);
  });

  it("T_ADDALLOC_8 the Export chip still announces its redirect through the same live region", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await act(async () => {
      await Promise.resolve();
    });
    const region = screen.getByTestId("allocations-tabs-live-region");
    expect(region.textContent).toContain("Export");
    expect(region.textContent).toContain("Holdings");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });
});
