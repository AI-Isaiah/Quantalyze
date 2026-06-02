/**
 * Phase 10 Plan 06b / Task 2 — RED tests for the AllocationsTabs scenario
 * panel branching.
 *
 * Pins the contract for the v2-flag branching of the scenario tab body:
 *   - Default (no localStorage flag) → ScenarioComposer renders (V2 default
 *     path; the v1 retirement in v0.15.7.0 made V2 the user-facing default)
 *   - localStorage["allocations.ui_v2"]==="false" → legacy ScenarioStub path
 *     (rollback safety; the explicit opt-out keeps the legacy stub
 *     reachable in case a regression ships post-PR77)
 *   - ScenarioComposer receives the FULL payload (incl. holdingReturnsByScopeRef)
 *   - ScenarioComposer receives allocatorId = props.allocator_id (H3)
 *   - ScenarioComposer receives allocatorMandate = props.mandate
 *   - Performance / overview tab unchanged across the v2 branch
 *   - Tab switching Performance ↔ Scenario ↔ Performance preserves the
 *     correct content each time (no v2 flag flicker)
 *
 * Composer is mocked to a minimal stub so this test asserts the wiring
 * (props handed down + which path renders) without exercising the full
 * scenario-state hook + adapter pipeline (covered by ScenarioComposer.test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

// --- localStorage mock — gates the v2-default vs explicit-opt-out branch ---

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

// --- Panel/body stubs (shared with AllocationsTabs.test.tsx idiom) --------

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
    <div data-testid="scenario-stub-body">SCENARIO_STUB_BODY</div>
  ),
}));

// Mock the dynamic-imported ScenarioComposer to a marker stub. The
// `loading` fallback inside the dynamic() wrapper is bypassed because
// next/dynamic resolves synchronously when the module export is already
// available in the test bundle.
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: vi.fn(
    (props: {
      payload: { holdingReturnsByScopeRef?: Record<string, unknown> };
      allocatorId: string;
      allocatorMandate: unknown;
    }) => (
      <div
        data-testid="scenario-composer-body"
        data-allocator-id={props.allocatorId}
        data-has-returns={
          props.payload.holdingReturnsByScopeRef ? "true" : "false"
        }
        data-has-mandate={props.allocatorMandate ? "true" : "false"}
      >
        SCENARIO_COMPOSER_BODY
      </div>
    ),
  ),
}));

// --- Imports after mocks ---------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import { ScenarioComposer } from "./components/ScenarioComposer";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// --- Stub props ------------------------------------------------------------

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
      // NEW-C03-10: required-but-nullable fields
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
  minHistoryDepthMonths: null,
  equityBaselineUnknown: false,
  activeVenues: [],
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
  holdingReturnsByScopeRef: {
    "holding:binance:BTC:spot": [{ date: "2026-01-01", value: 0.001 }],
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
  // Phase 11 / 11-05 — onboarding visibility predicate inputs.
  // ALLOCATOR_ID has at least one connected key in this fixture (the
  // composer assumes synced holdings), so the banner+card never render.
  apiKeysCount: 1,
  mandateIsSet: false,
};

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AllocationsTabs — scenario panel v2 branching (Plan 06b Task 2)", () => {
  beforeEach(() => {
    lsStore.clear();
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
    vi.mocked(ScenarioComposer).mockClear();
  });

  // -------------------------------------------------------------------------
  // T_AT1 — Default (no flag) → ScenarioComposer (V2 default since v0.15.7.0)
  // -------------------------------------------------------------------------
  it("T_AT1 default (no localStorage flag) → scenario panel renders ScenarioComposer (V2 default)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(
      await screen.findByTestId("scenario-composer-body"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-stub-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT2 — Explicit opt-out → ScenarioStub legacy path
  // -------------------------------------------------------------------------
  it("T_AT2 localStorage['allocations.ui_v2']=='false' → scenario panel renders legacy ScenarioStub", () => {
    lsStore.set("allocations.ui_v2", "false");
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("scenario-stub-body")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT3 — Composer receives the FULL payload (incl. holdingReturnsByScopeRef)
  // -------------------------------------------------------------------------
  it("T_AT3 ScenarioComposer receives full payload including holdingReturnsByScopeRef", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const body = await screen.findByTestId("scenario-composer-body");
    expect(body.getAttribute("data-has-returns")).toBe("true");
    expect(ScenarioComposer).toHaveBeenCalled();
    const props = vi.mocked(ScenarioComposer).mock.calls[0][0];
    expect(props.payload).toBeDefined();
    expect(
      (props.payload as { holdingReturnsByScopeRef: unknown })
        .holdingReturnsByScopeRef,
    ).toEqual(STUB_PROPS.holdingReturnsByScopeRef);
  });

  // -------------------------------------------------------------------------
  // T_AT4 — Composer receives allocatorId = props.allocator_id (H3 fix)
  // -------------------------------------------------------------------------
  it("T_AT4 ScenarioComposer receives allocatorId from payload.allocator_id (H3)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const body = await screen.findByTestId("scenario-composer-body");
    expect(body.getAttribute("data-allocator-id")).toBe(ALLOCATOR_ID);
    const props = vi.mocked(ScenarioComposer).mock.calls[0][0];
    expect(props.allocatorId).toBe(ALLOCATOR_ID);
  });

  // -------------------------------------------------------------------------
  // T_AT5 — Composer receives allocatorMandate = props.mandate
  // -------------------------------------------------------------------------
  it("T_AT5 ScenarioComposer receives allocatorMandate from payload.mandate", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const body = await screen.findByTestId("scenario-composer-body");
    expect(body.getAttribute("data-has-mandate")).toBe("true");
    const props = vi.mocked(ScenarioComposer).mock.calls[0][0];
    expect(props.allocatorMandate).toBe(STUB_PROPS.mandate);
  });

  // -------------------------------------------------------------------------
  // T_AT6 — Performance (overview) tab still renders with V2 active
  // -------------------------------------------------------------------------
  it("T_AT6 Performance/overview tab still renders correctly with V2 active (no regression)", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT7 — Tab switching Performance → Scenario → Performance
  // -------------------------------------------------------------------------
  it("T_AT7 Switching tabs Overview → Scenario → Overview shows correct content (V2 flag persists)", () => {
    setSearchParams("");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();

    setSearchParams("tab=scenario");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("scenario-composer-body")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-v2")).toBeNull();

    setSearchParams("");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT8 — Other tabs (Holdings/Outcomes/Mandate/Risk) unchanged
  // -------------------------------------------------------------------------
  it("T_AT8 Other tabs (holdings/outcomes/mandate/risk) unchanged by the v2 scenario branch", async () => {
    setSearchParams("tab=holdings");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("holdings-body");
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();

    setSearchParams("tab=outcomes");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("outcomes-body");
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();

    setSearchParams("tab=mandate");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("mandate-body");
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();

    setSearchParams("tab=risk");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("risk-body");
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT9 — Sentinel: + Allocation chip routes to scenario tab; activates
  //                   composer not stub.
  // -------------------------------------------------------------------------
  it("T_AT9 '+ Allocation' chip routes to scenario tab → ScenarioComposer renders", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const addChip = screen.getByRole("button", {
      name: /Add allocation — open Scenario tab/i,
    });
    fireEvent.click(addChip);
    expect(mockReplace).toHaveBeenCalled();
    const url = String(mockReplace.mock.calls[0][0]);
    expect(url).toContain("tab=scenario");
  });

  // -------------------------------------------------------------------------
  // T_AT10 — SSR-stable initial render (review-pass P1 fix). The scenario
  //          panel must initialize with `isUiV2 = true` (matches SSR's
  //          loadUiV2Flag default) regardless of what's in localStorage,
  //          and only flip to false in a post-mount useEffect when the
  //          allocator has explicitly opted out. This eliminates the
  //          hydration-mismatch class where SSR rendered V2 but the inline
  //          localStorage read on the client would have returned `false`.
  // -------------------------------------------------------------------------
  it("T_AT10 hydration-stable: SSR-equivalent initial render → ScenarioComposer; post-mount localStorage='false' → ScenarioStub", async () => {
    // First render: localStorage is empty (SSR-equivalent — server never
    // sees localStorage). Initial render renders the composer.
    lsStore.clear();
    setSearchParams("tab=scenario");
    const { unmount } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(
      await screen.findByTestId("scenario-composer-body"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-stub-body")).toBeNull();
    unmount();

    // Second render: opt-out flag is set in localStorage BEFORE render.
    // The `useState(true)` initial value still matches SSR (composer first
    // tick), then the post-mount useEffect reads the flag and flips to
    // ScenarioStub. We assert the stub renders after effects settle.
    lsStore.set("allocations.ui_v2", "false");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // After useEffect runs, the flag flips and the stub takes over.
    expect(
      await screen.findByTestId("scenario-stub-body"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // M-0041 (pr-test-analyzer) — true SSR-pass equivalence. T_AT10 above
  // mounts in jsdom (a client render) twice and asserts the useEffect-driven
  // flag flip settles. That does NOT exercise the actual hydration-mismatch
  // bug class: server renders with `isUiV2 = useState(true)` (the SSR-stable
  // default) and React requires the client's FIRST synchronous render to
  // match byte-for-byte. The synchronous render is what `renderToString`
  // captures — it runs render() but NOT effects. The contract being pinned:
  //
  //   `renderToString(<AllocationsTabs … />)` must render the V2 (composer)
  //   branch EVEN WHEN localStorage["allocations.ui_v2"] === "false",
  //   because the initial useState value never reads localStorage. A
  //   regression that re-introduces an inline read in initial state — e.g.
  //   `useState(() => readUiV2Flag() === "explicit-false" ? false : true)`
  //   — would, in jsdom (where window IS defined), render the legacy stub on
  //   the server pass while the SSR-equivalent default-true client first
  //   render renders V2, producing the React #418 mismatch. T_AT10 cannot
  //   catch that because it never runs a synchronous-only (no-effect) render
  //   with the opt-out flag pre-seeded.
  it("M-0041 SSR pass renders the V2 (composer) branch even with localStorage opt-out flag set", () => {
    // Pre-seed the explicit opt-out flag. In jsdom, window is defined, so a
    // buggy inline-read initial state WOULD return the stub on the
    // synchronous render. The correct `useState(true)` ignores it.
    lsStore.set("allocations.ui_v2", "false");
    setSearchParams("tab=scenario");

    const html = renderToString(<AllocationsTabs {...STUB_PROPS} />);

    // The synchronous render must NOT have flipped to the legacy stub —
    // the effect that reads localStorage has not run during renderToString.
    expect(html).not.toContain("SCENARIO_STUB_BODY");
    expect(html).not.toContain("scenario-stub-body");
    // The scenario tabpanel container is always rendered (hidden toggles via
    // `activeTab`); on the scenario tab it is the visible panel. The V2
    // branch is what the initial-state default-true must select.
    expect(html).toContain('id="panel-scenario"');
  });

  it("M-0041 SSR pass with clean localStorage also renders the V2 branch (parity baseline)", () => {
    // The inverse control: with NO opt-out flag, the SSR pass must equally
    // select V2 — so the assertion above is not vacuously true (i.e. the V2
    // branch is reachable at all in renderToString, not suppressed by the
    // dynamic ssr:false wrapper for an unrelated reason).
    lsStore.clear();
    setSearchParams("tab=scenario");

    const html = renderToString(<AllocationsTabs {...STUB_PROPS} />);

    expect(html).not.toContain("SCENARIO_STUB_BODY");
    expect(html).not.toContain("scenario-stub-body");
    expect(html).toContain('id="panel-scenario"');
  });
});
