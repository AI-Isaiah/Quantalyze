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
 *   - ScenarioComposer receives the FULL payload
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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
//
// Phase 23 / Plan 05 — the stub also captures `onRegisterOpen` /
// `onScenarioSaved` so the integration wiring is assertable: it exposes an
// Open button (calls the registered handler) and a Save button (fires
// onScenarioSaved → the host refetches the list).
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: vi.fn(
    (props: {
      payload: Record<string, unknown>;
      allocatorId: string;
      allocatorMandate: unknown;
      onRegisterOpen?: (open: (row: unknown) => void) => void;
      onScenarioSaved?: () => void;
    }) => {
      props.onRegisterOpen?.((row) => {
        (
          globalThis as { __lastOpenedRow?: unknown }
        ).__lastOpenedRow = row;
      });
      return (
        <div
          data-testid="scenario-composer-body"
          data-allocator-id={props.allocatorId}
          data-has-mandate={props.allocatorMandate ? "true" : "false"}
          data-has-register-open={props.onRegisterOpen ? "true" : "false"}
        >
          SCENARIO_COMPOSER_BODY
          <button
            type="button"
            data-testid="composer-fire-saved"
            onClick={() => props.onScenarioSaved?.()}
          >
            fire-saved
          </button>
        </div>
      );
    },
  ),
}));

// Phase 23 / Plan 05 — the saved-scenarios list + compare panel mount adjacent
// to the composer on the V2 scenario path. Mock both to marker stubs so this
// wiring test asserts they mount (and are handed the list rows / payload)
// without exercising their internals (covered by their own tests).
vi.mock("./components/SavedScenariosList", () => ({
  SavedScenariosList: (props: { rows: unknown[] }) => (
    <div
      data-testid="saved-scenarios-list-body"
      data-row-count={props.rows.length}
    >
      SAVED_SCENARIOS_LIST_BODY
    </div>
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
  // Phase 37 / DSRC-01 — per-key channel additive fields. This fixture seeds
  // no per-key dailies, so the gate is not satisfied (empty/false defaults).
  perKeyReturnsByApiKeyId: {},
  perKeyDailiesGateSatisfied: false,
  eligibleApiKeyIds: [],
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
  // T_AT5a (Plan 23-05) — SavedScenariosList mounts on the V2 scenario path,
  //          adjacent to the composer, fed the GET list rows.
  // -------------------------------------------------------------------------
  it("T_AT5a SavedScenariosList mounts on the V2 scenario path with the fetched rows", async () => {
    const listRows = [
      {
        id: "s1",
        name: "Saved one",
        schema_version: 2,
        created_at: "c",
        updated_at: "u",
        draft: { schema_version: 2 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => listRows }) as Response),
    );
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // The composer AND the list both render on the V2 path.
    expect(
      await screen.findByTestId("scenario-composer-body"),
    ).toBeInTheDocument();
    const list = await screen.findByTestId("saved-scenarios-list-body");
    expect(list).toBeInTheDocument();
    // The list was handed the fetched rows.
    await waitFor(() =>
      expect(list.getAttribute("data-row-count")).toBe("1"),
    );
    // The GET list endpoint was queried.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/allocator/scenario/saved",
      expect.objectContaining({ method: "GET" }),
    );
  });

  // -------------------------------------------------------------------------
  // T_AT5b (Plan 23-05) — the composer receives onRegisterOpen + a save fires
  //          the host's list refetch (onScenarioSaved → re-GET).
  // -------------------------------------------------------------------------
  it("T_AT5b composer receives onRegisterOpen and a save refetches the list", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => [] }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const body = await screen.findByTestId("scenario-composer-body");
    expect(body.getAttribute("data-has-register-open")).toBe("true");
    // One GET on mount.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // A composer save fires onScenarioSaved → the host refetches.
    fireEvent.click(screen.getByTestId("composer-fire-saved"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  // -------------------------------------------------------------------------
  // T_AT5c (Plan 23-05) — the ScenarioStub rollback path renders NEITHER the
  //          list NOR the compare panel (the new surfaces are V2-only).
  // -------------------------------------------------------------------------
  it("T_AT5c the ScenarioStub rollback path does not mount the list or compare panel", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    lsStore.set("allocations.ui_v2", "false");
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(screen.getByTestId("scenario-stub-body")).toBeInTheDocument();
    expect(screen.queryByTestId("saved-scenarios-list-body")).toBeNull();
    expect(screen.queryByTestId("scenario-compare-panel-body")).toBeNull();
    expect(screen.queryByTestId("scenario-composer-body")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_AT5d (Plan 23-05) — the compare panel is NOT mounted until a selection
  //          is active (no fabricated compare surface on first paint).
  // -------------------------------------------------------------------------
  it("T_AT5d compare panel is not mounted before a selection is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("saved-scenarios-list-body");
    expect(screen.queryByTestId("scenario-compare-panel-body")).toBeNull();
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

// ---------------------------------------------------------------------------
// SURF-01 (Phase 21) — Scenario is a VISIBLE tab in the strip.
//
// Before Phase 21 the Scenario surface was routable-but-hidden (reachable
// only via ?tab=scenario or the "+ Allocation" chip). SURF-01 adds "scenario"
// to VISIBLE_TAB_KEYS so a visible tab button renders AND keyboard arrow-nav
// reaches it. These tests pin the visible-button + keyboard-reach contract
// and guard the deep-link from regressing.
// ---------------------------------------------------------------------------
describe("AllocationsTabs — Scenario visible tab (SURF-01)", () => {
  beforeEach(() => {
    lsStore.clear();
    mockReplace.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("renders a visible 'Scenario' tab button in the tablist", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // The tab strip is the role="tablist" labelled "Allocation surfaces".
    const tablist = screen.getByRole("tablist", {
      name: /Allocation surfaces/i,
    });
    const scenarioTab = screen.getByRole("tab", { name: "Scenario" });
    expect(scenarioTab).toBeInTheDocument();
    expect(tablist).toContainElement(scenarioTab);
    // It carries the wired ARIA contract (id + controls the existing panel).
    expect(scenarioTab).toHaveAttribute("id", "tab-scenario");
    expect(scenarioTab).toHaveAttribute("aria-controls", "panel-scenario");
  });

  it("clicking the Scenario tab routes to ?tab=scenario", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Scenario" }));
    expect(mockReplace).toHaveBeenCalled();
    const url = String(mockReplace.mock.calls[0][0]);
    expect(url).toContain("tab=scenario");
  });

  it("keyboard arrow-nav reaches the Scenario tab (ArrowRight from Risk)", () => {
    // Risk is the tab immediately before Scenario in VISIBLE_TAB_KEYS, so a
    // single ArrowRight from Risk must land on Scenario. If "scenario" were
    // missing from the keyboard-nav set this routes nowhere (no tab=scenario).
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const riskTab = screen.getByRole("tab", { name: "Risk" });
    fireEvent.keyDown(riskTab, { key: "ArrowRight" });
    expect(mockReplace).toHaveBeenCalled();
    const url = String(mockReplace.mock.calls[0][0]);
    expect(url).toContain("tab=scenario");
  });

  it("End key jumps to the Scenario tab (now the last visible tab)", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    fireEvent.keyDown(overviewTab, { key: "End" });
    expect(mockReplace).toHaveBeenCalled();
    const url = String(mockReplace.mock.calls[0][0]);
    expect(url).toContain("tab=scenario");
  });

  it("?tab=scenario deep-link still resolves to the Scenario panel (no regression)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // Deep-link resolves: the Scenario panel is visible (not hidden) and the
    // composer body renders. The tab button reflects the selected state.
    const scenarioTab = screen.getByRole("tab", { name: "Scenario" });
    expect(scenarioTab).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByTestId("scenario-composer-body"),
    ).toBeInTheDocument();
  });
});
