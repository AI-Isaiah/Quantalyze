/**
 * Phase 10 Plan 06b / Task 1 — RED tests for ScenarioComposer.
 *
 * Pins the contract for the full Scenario tab body assembly:
 *   - empty-state branch (zero holdings + zero added) → EmptyState with dual CTA
 *   - dynamic transition (M3): empty → Browse → add → composer body renders
 *   - normal path: KpiStrip mode=scenario + Equity/Drawdown overlays + composition
 *     list + Browse strategies CTA row + ScenarioFooter
 *   - composition row toggle (role=switch + aria-label)
 *   - toggle-off row visual treatment (opacity + strikethrough + disabled weight)
 *   - Bridge inline card section visible iff flaggedHoldings.length > 0
 *   - Compare → deep-link routes to /compare?ids={scopeRef},{candidateUuid}
 *   - Remove × on added strategies
 *   - Footer Commit disabled when diff_count = 0 (no diff)
 *   - Reset → confirmation modal (Discard your scenario draft?)
 *   - Confirm Reset clears draft; Cancel keeps draft
 *   - Fingerprint-mismatch banner with default-focused "Keep my draft" button
 *   - Equity_curve +1 wealth conversion applied (Pitfall 1)
 *   - data-widget-id="scenario-composer" attribute for PostHog analytics hook
 *   - B4-pinned adapter call: addedStrategies as AddedStrategy[] (lightweight),
 *     addedStrategyReturnsLookup + addedStrategyMetadataLookup built from
 *     payload.strategies, NO pre-casting in composer source
 *   - M5 multi-venue tooltip on rows with shared symbol across venues
 *   - M4 live baseline read from payload.liveBaselineMetrics (NOT re-derived)
 *
 * Mocks (N4-pinned vi.mock + vi.mocked technique):
 *   - EquityChart / DrawdownChart / KpiStrip / StrategyBrowseDrawer / BridgeDrawer
 *     are mocked to inert spies so the composer's prop wiring is asserted via
 *     mock.calls without exercising the chart / drawer internals.
 *   - scenario-adapter is module-mocked so the composer's adapter-arg shape is
 *     observable via vi.mocked(buildStrategyForBuilderSet).mock.calls.
 *
 * The full vitest suite (1973 baseline) must continue green; downstream
 * ScenarioStub / ScenarioFlaggedHoldingsList / AllocationDashboardV2 tests
 * are untouched by Plan 06b.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// --- next/navigation mock -------------------------------------------------

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// --- Component / module mocks ---------------------------------------------
// N4-pinned vi.mock + vi.mocked technique. Each mock keeps shape-compat with
// the real component so the composer's prop wiring is the unit-under-test.

vi.mock("../widgets/performance/EquityChart", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../widgets/performance/EquityChart")
  >();
  return {
    ...actual,
    EquityChart: vi.fn(() => <div data-testid="equity-chart-mock" />),
  };
});

vi.mock("../widgets/performance/DrawdownChart", () => {
  // DrawdownChart has a default export AND named export; the composer
  // imports the default per the existing widget contract.
  const Mock = vi.fn(() => <div data-testid="drawdown-chart-mock" />);
  return { default: Mock, deriveSnapshotDrawdowns: vi.fn(() => []) };
});

vi.mock("./KpiStrip", () => ({
  KpiStrip: vi.fn(() => <div data-testid="kpi-strip-mock" />),
}));

vi.mock("./StrategyBrowseDrawer", () => ({
  StrategyBrowseDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="browse-drawer-mock" /> : null,
  ),
}));

vi.mock("./BridgeDrawer", () => ({
  BridgeDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="bridge-drawer-mock" /> : null,
  ),
}));

// Plan 07 — composer imports ScenarioCommitDrawer to wire onCommitRequested
// to its open handler. Mocked here so the composer's wire-in is the
// unit-under-test rather than the drawer internals.
vi.mock("./ScenarioCommitDrawer", () => ({
  ScenarioCommitDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="commit-drawer-mock" /> : null,
  ),
}));

// Mock ScenarioFlaggedHoldingsList — it's embedded in the Bridge inline card
// section; we don't want the table internals running in this test.
vi.mock("../ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: vi.fn(() => (
    <div data-testid="flagged-list-mock" />
  )),
}));

// Mock the scenario-adapter so the composer's call-site shape is observable.
// The mock returns a deterministic { strategies: [], state } so computeScenario
// short-circuits to the n=0 branch (returns empty equity_curve) — that's
// fine for prop-spy assertions.
vi.mock("../lib/scenario-adapter", () => ({
  buildStrategyForBuilderSet: vi.fn(() => ({
    strategies: [],
    state: { selected: {}, weights: {}, startDates: {} },
  })),
}));

// Phase 30 — mock the five blend-graph LEAF charts to inert spies (same :70-127
// precedent as EquityChart/DrawdownChart/KpiStrip). This keeps the unit-under-
// test the composer's PANEL CHROME (Card / heading / disclosure / empty branch /
// the prop wiring) rather than the recharts internals, and lets the histogram
// prop be asserted via vi.mocked(ReturnHistogram).mock.calls[0][0]. The leaves
// render a testid div so a present-panel assert can also read their mount.
vi.mock("@/components/charts/ReturnHistogram", () => ({
  ReturnHistogram: vi.fn(() => <div data-testid="return-histogram-mock" />),
}));
vi.mock("@/components/charts/ReturnQuantiles", () => ({
  ReturnQuantiles: vi.fn(() => <div data-testid="return-quantiles-mock" />),
}));
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: vi.fn(() => <div data-testid="rolling-metrics-mock" />),
}));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: vi.fn(() => <div data-testid="rolling-vol-mock" />),
}));
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: vi.fn(() => <div data-testid="rolling-sortino-mock" />),
}));

// --- Imports after mocks --------------------------------------------------

import { ScenarioComposer } from "./ScenarioComposer";
import { EquityChart } from "../widgets/performance/EquityChart";
import DrawdownChart from "../widgets/performance/DrawdownChart";
import { KpiStrip } from "./KpiStrip";
import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";
import { buildStrategyForBuilderSet } from "../lib/scenario-adapter";
import type { FlaggedHolding } from "../lib/holding-outcome-adapter";
// IMPACT-02 — imported REAL (never mocked) so the R3 guard's positive control
// renders a genuine PercentileRankBadge in isolation, proving the testid query
// that asserts ABSENCE on the projection is non-vacuous.
import { PercentileRankBadge } from "@/components/strategy/PercentileRankBadge";
// Phase 30 — imported (mocked above) so the histogram's CUMULATIVE-wealth input
// contract is asserted via vi.mocked(ReturnHistogram).mock.calls[0][0].
import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- localStorage mock (vi.stubGlobal — Phase 08 / 06a precedent) --------

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

// --- Fixtures -------------------------------------------------------------

const ALLOCATOR_A = "allocator-a-uuid";

const HOLDING_BTC = {
  symbol: "BTC",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 60_000,
  quantity: 1,
  mark_price_usd: 60_000,
  api_key_id: "key-binance",
  // NEW-C03-10: required-but-nullable fields
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};
const HOLDING_ETH = {
  symbol: "ETH",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 30_000,
  quantity: 10,
  mark_price_usd: 3_000,
  api_key_id: "key-binance",
  // NEW-C03-10: required-but-nullable fields
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};
const HOLDING_SOL = {
  symbol: "SOL",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 10_000,
  quantity: 100,
  mark_price_usd: 100,
  api_key_id: "key-binance",
  // NEW-C03-10: required-but-nullable fields
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};
const HOLDING_BTC_OKX = {
  symbol: "BTC",
  venue: "okx",
  holding_type: "spot" as const,
  value_usd: 20_000,
  quantity: 0.33,
  mark_price_usd: 60_000,
  api_key_id: "key-okx",
  // NEW-C03-10: required-but-nullable fields
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};

const FLAGGED_BTC: FlaggedHolding = {
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  value_usd: 60_000,
  top_candidate_strategy_id: "uuid-candidate-1",
  top_candidate_name: "Momentum Alpha",
  top_candidate_composite: 78,
  breach_reasons: ["max_weight"],
};

const REF_BTC = "holding:binance:BTC:spot";
const REF_ETH = "holding:binance:ETH:spot";
const REF_SOL = "holding:binance:SOL:spot";
const REF_BTC_OKX = "holding:okx:BTC:spot";

// Read-only-tokens model: live holdings are fixed context with NO per-holding
// toggle / weight / leverage controls. Every interactive gesture (toggle,
// reweight, lever, remove) now lives on the ADDED-STRATEGY rows. The browse
// drawer is module-mocked to capture its onAdd so any test can inject an added
// strategy without driving the (mocked) drawer internals; `addStrategy` is the
// shared "make an interactive row / make a diff" helper that replaces the old
// "toggle a holding" gesture.
let browseOnAdd: ((s: unknown) => void) | null = null;

interface AddStrategyInput {
  id: string;
  name: string;
  markets: string[];
  strategy_types: string[];
}

/** Inject an added strategy via the (mocked) browse drawer's captured onAdd.
 *  The capturing mock records onAdd on first render even while the drawer is
 *  closed, so no Browse click is needed. Works in both the empty-state branch
 *  and the main body. */
function addStrategy(s: AddStrategyInput): void {
  expect(browseOnAdd).not.toBeNull();
  act(() => {
    browseOnAdd!(s);
  });
}

// Build a baseline payload — every test extends/overrides specific fields.
function makePayload(
  overrides: Partial<MyAllocationDashboardPayload> = {},
): MyAllocationDashboardPayload {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: [],
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary: [HOLDING_BTC, HOLDING_ETH, HOLDING_SOL],
    snapshotCount: 60,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [
      { date: "2026-01-01", value: 100_000 },
      { date: "2026-01-02", value: 101_000 },
    ],
    minHistoryDepthMonths: 12,
    equityBaselineUnknown: false,
    activeVenues: ["Binance"],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    mandate: null,
    holdingReturnsByScopeRef: {
      [REF_BTC]: [
        { date: "2026-01-01", value: 0.001 },
        { date: "2026-01-02", value: 0.002 },
      ],
      [REF_ETH]: [
        { date: "2026-01-01", value: 0.0015 },
        { date: "2026-01-02", value: 0.001 },
      ],
      [REF_SOL]: [
        { date: "2026-01-01", value: 0.005 },
        { date: "2026-01-02", value: -0.001 },
      ],
    },
    allocator_id: ALLOCATOR_A,
    liveBaselineMetrics: {
      aum: 100_000,
      ytdTwr: 0.05,
      sharpe: 1.2,
      maxDd: -0.08,
      avgRho: 0.4,
      equity: [
        { date: "2026-01-01", value: 1.0 },
        { date: "2026-01-02", value: 1.01 },
      ],
      drawdown: [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 0 },
      ],
    },
    // Phase 11 / 11-05 — onboarding visibility predicate inputs. The
    // composer fixture assumes a connected allocator (synced holdings),
    // so apiKeysCount is non-zero (banner+card never render here).
    apiKeysCount: 1,
    mandateIsSet: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ScenarioComposer — Phase 10 Plan 06b", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    // Reset adapter mock to default deterministic return
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    // Capturing browse-drawer mock — records onAdd so `addStrategy` can inject
    // an added strategy. Same render output as the factory default (isOpen ? div
    // : null); tests that need a custom drawer still override it inline.
    browseOnAdd = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      browseOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    cleanup();
  });

  // -------------------------------------------------------------------------
  // T_C1 — Empty state (zero holdings)
  // -------------------------------------------------------------------------
  it("T_C1 holdingsSummary=[] → renders EmptyState with dual CTA; clicking Browse opens StrategyBrowseDrawer", () => {
    const payload = makePayload({
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText("Start a portfolio"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Connect Exchange/i }),
    ).toBeInTheDocument();
    const browseBtn = screen.getByRole("button", { name: /Browse strategies/i });
    expect(browseBtn).toBeInTheDocument();
    // FLOW-02 (landmine #2) — the blank slate must NOT link back to the retired
    // /scenarios Sandbox: after retirement that link 307-loops the user from the
    // composer's front door straight back into the composer. Non-vacuous: this
    // FAILED before the ScenarioComposer.tsx L1619-1624 self-loop <p> deletion.
    expect(
      document.querySelector('a[href="/scenarios"]'),
    ).toBeNull();
    expect(screen.queryByText(/Strategy Sandbox/i)).toBeNull();
    fireEvent.click(browseBtn);
    expect(screen.getByTestId("browse-drawer-mock")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C2 — Normal path renders KpiStrip / charts / composition / footer
  // -------------------------------------------------------------------------
  it("T_C2 holdingsSummary present → KpiStrip + EquityChart + DrawdownChart + composition list + Browse CTA + ScenarioFooter", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument();
    expect(screen.getByTestId("equity-chart-mock")).toBeInTheDocument();
    expect(screen.getByTestId("drawdown-chart-mock")).toBeInTheDocument();
    // Read-only-tokens model: composition list renders BTC / ETH / SOL as
    // read-only rows (symbol text), NOT interactive toggle switches.
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getByText("SOL")).toBeInTheDocument();
    // ScenarioFooter — Commit + Reset buttons
    expect(screen.getByTestId("scenario-footer-commit")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-footer-reset")).toBeInTheDocument();
    // Browse strategies CTA row exists outside the empty-state branch
    expect(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C3 — KpiStrip receives mode=scenario + scenarioMetrics + liveMetrics
  // -------------------------------------------------------------------------
  it("T_C3 KpiStrip receives mode='scenario' + scenarioMetrics + liveMetrics props", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(KpiStrip).toHaveBeenCalled();
    const props = vi.mocked(KpiStrip).mock.calls[0][0];
    expect(props.mode).toBe("scenario");
    expect(props.scenarioMetrics).toBeDefined();
    expect(props.liveMetrics).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // T_C3b — Blank-slate live-data leak regression. `equityDailyPoints` is the
  // live book's server-blended equity baseline, a payload field separate from
  // holdingsSummary. In "Blank slate" mode the allocator started from nothing,
  // so the live curve + its sync stamp must NOT render — only the (empty)
  // scenario overlay. Non-vacuous: book mode still passes the real baseline +
  // stamps; switching to blank must zero them. Without the gate this asserts
  // RED (EquityChart would still receive the 2-point live baseline + stamps).
  // -------------------------------------------------------------------------
  it("T_C3b Blank slate gates the live equity baseline + sync stamps out of EquityChart", () => {
    const payload = makePayload({
      lastSyncAt: "2026-06-24T00:00:00.000Z",
      allKeysStale: true,
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Book mode (default for an allocator with a live book): real baseline + stamps flow through.
    const bookProps = vi.mocked(EquityChart).mock.calls[0][0];
    expect(bookProps.equityDailyPoints).toHaveLength(2);
    expect(bookProps.lastSyncAt).toBe("2026-06-24T00:00:00.000Z");
    expect(bookProps.stale).toBe(true);

    // Switch to Blank slate — the live baseline + stamps must be gated out.
    fireEvent.click(screen.getByRole("radio", { name: /blank slate/i }));

    const calls = vi.mocked(EquityChart).mock.calls;
    const blankProps = calls[calls.length - 1][0];
    expect(blankProps.equityDailyPoints).toEqual([]);
    expect(blankProps.lastSyncAt).toBeNull();
    expect(blankProps.stale).toBe(false);
  });

  // -------------------------------------------------------------------------
  // H-0487/H-0493 — guards the CLIENT call site of collapseAliasedHoldingStrategies.
  // Two same-symbol multi-venue BTC holdings (identical symbol-keyed series)
  // must be merged into ONE exposure BEFORE the (real) computeScenario, so it
  // sees 2 distinct strategies (correlation_matrix has 2 keys, not 3) and avgRho
  // is the genuine BTC↔ETH value, not a fabricated 1.0. Reverting the composer's
  // collapse wiring leaves 3 strategies → this fails (the silent re-inert mode).
  // -------------------------------------------------------------------------
  it("H-0487 multi-venue BTC collapses before computeScenario (scenario avgRho not fabricated 1.0)", () => {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const btcSeries = dates.map((date, i) => ({
      date,
      value: [0.02, -0.01, 0.03, -0.02, 0.01][i % 5],
    }));
    const ethSeries = dates.map((date, i) => ({
      date,
      value: [-0.01, 0.02, -0.015][i % 3],
    }));
    const mkStrat = (id: string, returns: typeof btcSeries) => ({
      id,
      name: id,
      codename: null,
      disclosure_tier: "public",
      strategy_types: [] as string[],
      markets: [] as string[],
      start_date: dates[0],
      daily_returns: returns,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    });
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkStrat(REF_BTC, btcSeries),
        mkStrat(REF_BTC_OKX, btcSeries), // identical series (symbol-keyed alias)
        mkStrat(REF_ETH, ethSeries),
      ],
      state: {
        selected: { [REF_BTC]: true, [REF_BTC_OKX]: true, [REF_ETH]: true },
        weights: { [REF_BTC]: 0.4, [REF_BTC_OKX]: 0.3, [REF_ETH]: 0.3 },
        startDates: {},
      },
    });

    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_BTC_OKX, HOLDING_ETH],
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const props = vi.mocked(KpiStrip).mock.calls[0][0];
    const sm = props.scenarioMetrics;
    expect(Object.keys(sm?.correlation_matrix ?? {})).toHaveLength(2);
    expect(sm?.avg_pairwise_correlation).not.toBeNull();
    expect(sm?.avg_pairwise_correlation).not.toBe(1);
  });

  // -------------------------------------------------------------------------
  // T_C4 — EquityChart receives scenarioSeries
  // -------------------------------------------------------------------------
  it("T_C4 EquityChart receives scenarioSeries (DailyPoint[])", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(EquityChart).toHaveBeenCalled();
    const props = vi.mocked(EquityChart).mock.calls[0][0];
    expect(Array.isArray(props.scenarioSeries)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B14 / NEW-C09-04 (H-1226) — the Scenario-tab EquityChart renders the inner
  // header (no hideHeader), so the composer MUST plumb the live sync state.
  // Before the fix it passed neither prop, so the header stamp showed
  // "sync just now" / "no sync yet" to a synced allocator — a lie. This pins
  // the wiring so a future refactor can't silently drop it and regress.
  // -------------------------------------------------------------------------
  it("EquityChart receives stale + lastSyncAt so the Scenario-tab sync stamp is honest (B14/H-1226)", () => {
    const lastSync = "2026-02-01T00:00:00.000Z";
    const payload = makePayload({ allKeysStale: true, lastSyncAt: lastSync });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(EquityChart).toHaveBeenCalled();
    const props = vi.mocked(EquityChart).mock.calls[0][0];
    expect(props.stale).toBe(true);
    expect(props.lastSyncAt).toBe(lastSync);
  });

  // -------------------------------------------------------------------------
  // T_C5 — DrawdownChart receives scenarioDailyPoints
  // -------------------------------------------------------------------------
  it("T_C5 DrawdownChart receives scenarioDailyPoints", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(DrawdownChart).toHaveBeenCalled();
    const props = vi.mocked(DrawdownChart).mock.calls[0][0];
    expect(Array.isArray(props.scenarioDailyPoints)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T_C6 — Read-only-tokens model: holdings render read-only (no toggle switch);
  // each row shows its USD value. The only switches in the list are added
  // strategies (none here).
  // -------------------------------------------------------------------------
  it("T_C6 Composition list renders holdings read-only (no toggle switch); each row shows its USD value", () => {
    const payload = makePayload();
    const { container } = render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // No per-holding toggle: holdings are fixed context.
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    // BTC's read-only row shows its USD value ($60,000 from the fixture).
    const btcRow = container.querySelector(`[data-scope-ref="${REF_BTC}"]`);
    expect(btcRow).not.toBeNull();
    expect((btcRow as HTMLElement).textContent ?? "").toMatch(/\$60,000/);
    // …and no editable weight / leverage inputs on the holding row.
    expect(btcRow?.querySelector("input")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // formatUsd0 non-finite branch — a sold-down / coingecko_fallback row can
  // surface a non-finite value_usd; the read-only row must render "—", never
  // "$NaN". (value_usd is typed number, so NaN is the runtime-only case.)
  // -------------------------------------------------------------------------
  it("read-only holding row renders '—' for a non-finite value_usd (not '$NaN')", () => {
    const payload = makePayload({
      holdingsSummary: [{ ...HOLDING_BTC, value_usd: Number.NaN }],
    });
    const { container } = render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const btcRow = container.querySelector(`[data-scope-ref="${REF_BTC}"]`);
    expect(btcRow).not.toBeNull();
    expect((btcRow as HTMLElement).textContent ?? "").toContain("—");
    expect((btcRow as HTMLElement).textContent ?? "").not.toMatch(/NaN/);
  });

  // -------------------------------------------------------------------------
  // Schema v2 (read-only-tokens) — a LEGACY v1 draft that disabled a holding
  // under the OLD per-token UI must be DROPPED on load (version mismatch →
  // reset), so the holding is never silently excluded from the projection /
  // scenarioAum with no affordance to re-enable it. Pins the
  // SCENARIO_SCHEMA_VERSION 1→2 bump as the fix for the stale-draft silent-drop
  // bug (caught by adversarial review). Discriminator: with the bump, scenarioAum
  // is the full portfolio (100k, BTC included) → KpiStrip.aum=100000; WITHOUT it
  // the adopted v1 draft would exclude the toggled-off BTC (aum 40k).
  // -------------------------------------------------------------------------
  it("legacy v1 draft with a holding toggled off is dropped on load (holding not stuck-excluded)", () => {
    lsStore.set(
      `allocations.scenario_v0_15.${ALLOCATOR_A}`,
      JSON.stringify({
        schema_version: 1, // legacy version → MUST reset under the v2 bump
        init_holdings_fingerprint:
          "BTC:binance:spot|ETH:binance:spot|SOL:binance:spot",
        toggleByScopeRef: {
          [REF_BTC]: false,
          [REF_ETH]: true,
          [REF_SOL]: true,
        },
        addedStrategies: [],
        weightOverrides: { [REF_BTC]: 0, [REF_ETH]: 0.75, [REF_SOL]: 0.25 },
        lastEditedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Legacy draft dropped (schema mismatch) → fresh default with ALL holdings
    // included; scenarioAum flows to KpiStrip.aum = full portfolio (60+30+10k).
    const kpiProps = vi.mocked(KpiStrip).mock.calls.at(-1)?.[0];
    expect(kpiProps?.aum).toBe(100_000);
  });

  // -------------------------------------------------------------------------
  // T_C7 — Toggle off an ADDED STRATEGY → row dims, weight input disabled,
  // KpiStrip re-renders. (Holdings are read-only; the toggle gesture now lives
  // only on added-strategy rows.)
  // -------------------------------------------------------------------------
  it("T_C7 Toggle off an added strategy → row strikethrough+opacity-50; weight input disabled; KpiStrip re-renders", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: "strat-toggle",
      name: "Toggle Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    const callsBefore = vi.mocked(KpiStrip).mock.calls.length;
    const stratSwitch = screen.getByRole("switch", {
      name: /Toggle Toggle Strat on\/off in scenario/i,
    });
    fireEvent.click(stratSwitch);
    // Row visual treatment — weight input disabled
    const weightInput = screen.getByLabelText(/Toggle Strat weight/i);
    expect((weightInput as HTMLInputElement).disabled).toBe(true);
    // Strikethrough is signaled via line-through style or class
    const row = weightInput.closest("[data-scope-ref]");
    expect(row).not.toBeNull();
    expect(row?.className).toMatch(/opacity-50|line-through/);
    // KpiStrip re-rendered with updated props
    expect(vi.mocked(KpiStrip).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // -------------------------------------------------------------------------
  // T_C8 — Bridge inline card visible when flaggedHoldings.length>0
  // -------------------------------------------------------------------------
  it("T_C8 flaggedHoldings.length>0 → Bridge inline card visible with Open Bridge CTA", () => {
    const payload = makePayload({ flaggedHoldings: [FLAGGED_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(screen.getByText(/Bridge flagged 1 holding/i)).toBeInTheDocument();
    const openBridgeBtn = screen.getByRole("button", { name: /Open Bridge/i });
    fireEvent.click(openBridgeBtn);
    expect(screen.getByTestId("bridge-drawer-mock")).toBeInTheDocument();
    // ScenarioFlaggedHoldingsList embedded as the inline section body
    expect(screen.getByTestId("flagged-list-mock")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C9 — Bridge inline card hidden when no flagged holdings
  // -------------------------------------------------------------------------
  it("T_C9 flaggedHoldings.length=0 → Bridge inline card section hidden", () => {
    const payload = makePayload({ flaggedHoldings: [] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(screen.queryByText(/Bridge flagged/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("flagged-list-mock")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C10 — Browse drawer Add → row appears + footer count increments
  //   (T_C_empty_to_composer covers the empty→composer transition path)
  // -------------------------------------------------------------------------
  it("T_C10 Browse strategies CTA opens drawer; clicking Add adds the strategy to composition list", () => {
    const payload = makePayload();
    // Capture the onAdd callback the StrategyBrowseDrawer receives so we can
    // simulate a row-Add from inside the (mocked) drawer.
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    expect(screen.getByTestId("browse-drawer-mock")).toBeInTheDocument();
    // Simulate a row-Add inside the drawer
    act(() => {
      capturedOnAdd!({
        id: "strat-uuid-1",
        name: "Browse Strategy 1",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    // Composition list now shows the added strategy (the visible name +
    // the toggle aria-label both carry the strategy name; getAllByText is
    // the accurate matcher).
    expect(screen.getAllByText(/Browse Strategy 1/i).length).toBeGreaterThan(
      0,
    );
    // Footer diff count chip moved off "No changes yet"
    expect(screen.queryByText("No changes yet")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_C_LAZY1 — UNIFY-04 (TDD): adding a catalog strategy NOT in the book
  //   lazy-fetches /api/strategies/<id>/returns; once resolved, the series
  //   passed to buildStrategyForBuilderSet's returns-lookup (arg index 4)
  //   carries the non-empty daily_returns for the added id, so the projection
  //   recomputes through the frozen engine. NON-VACUOUS: BEFORE the fetch
  //   resolves the lookup is [] (warm-up-gated — no fabricated series); a
  //   rejected fetch leaves it [] and degrades honestly.
  // -------------------------------------------------------------------------
  const LAZY_ID = "aaaaaaaa-1111-2222-3333-444444444444";
  const LAZY_SERIES = [
    { date: "2026-02-01", value: 0.01 },
    { date: "2026-02-02", value: -0.005 },
    { date: "2026-02-03", value: 0.02 },
  ];

  /** Latest returns-lookup (4th positional arg) the adapter was called with. */
  function latestReturnsLookup(): Record<string, unknown[]> {
    const calls = vi.mocked(buildStrategyForBuilderSet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][4] as Record<string, unknown[]>;
  }

  it("T_C_LAZY1 add a catalog strategy → lazy GET /api/strategies/<id>/returns; once resolved the adapter's returns-lookup carries the non-empty series (and was [] before resolve)", async () => {
    // A deferred fetch so we can observe the in-flight [] state, then resolve.
    let resolveReturns: (v: unknown) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (String(url).startsWith("/api/benchmark/btc")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (String(url).includes(`/api/strategies/${LAZY_ID}/returns`)) {
        return new Promise((resolve) => {
          resolveReturns = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ daily_returns: LAZY_SERIES }),
            });
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Add a catalog strategy that is NOT in the book (payload.strategies is []).
    addStrategy({
      id: LAZY_ID,
      name: "Lazy Catalog Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    // The lazy fetch fired for this id.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes(`/api/strategies/${LAZY_ID}/returns`),
        ),
      ).toBe(true);
    });

    // BEFORE resolve — the lookup for the added id is [] (warm-up-gated, NOT a
    // fabricated flat series). This is the non-vacuous half of the assertion.
    expect(latestReturnsLookup()[LAZY_ID]).toEqual([]);

    // Resolve the lazy fetch.
    await act(async () => {
      resolveReturns(undefined);
      await Promise.resolve();
    });

    // AFTER resolve — the lookup now carries the real series for the added id,
    // so the adapter (and the frozen engine downstream) sees a non-empty series.
    await waitFor(() => {
      expect(latestReturnsLookup()[LAZY_ID]).toEqual(LAZY_SERIES);
    });
  });

  it("T_C_LAZY2 a rejected lazy fetch leaves the added strategy's lookup [] and degrades honestly (no fabricated series, no crash)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).startsWith("/api/benchmark/btc")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (String(url).includes(`/api/strategies/${LAZY_ID}/returns`)) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    addStrategy({
      id: LAZY_ID,
      name: "Doomed Catalog Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes(`/api/strategies/${LAZY_ID}/returns`),
        ),
      ).toBe(true);
    });

    // The failed fetch settles; the lookup stays [] (honest degrade — the
    // strategy is added but contributes nothing until a real series exists).
    await waitFor(() => {
      expect(latestReturnsLookup()[LAZY_ID]).toEqual([]);
    });
    // The component did not crash — the composition list still shows the row.
    expect(screen.getAllByText(/Doomed Catalog Strat/i).length).toBeGreaterThan(
      0,
    );
  });

  // -------------------------------------------------------------------------
  // WR-01 (Phase 29 review) — a FAILED lazy fetch must NOT poison the strategy's
  //   series for the session. Pre-fix, the error path called `settle([])`, which
  //   wrote `addedReturnsById[id] = []` (an array, not undefined). The add seam
  //   guards re-fetch with `addedReturnsById[s.id] === undefined`, so a remove +
  //   re-add of the SAME id never re-fetched — it reused the poisoned [] and the
  //   strategy was warm-up-gated out of the projection forever. NON-VACUOUS:
  //   asserts a SECOND fetch fires on re-add (fails on pre-fix code where the
  //   re-add is a silent no-op), and that the retried (now-succeeding) fetch
  //   lands the real series into the adapter's returns-lookup.
  // -------------------------------------------------------------------------
  it("WR-01 a failed lazy fetch leaves the id retryable: remove + re-add re-fetches and the retry's series reaches the projection", async () => {
    let attempt = 0;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).startsWith("/api/benchmark/btc")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (String(url).includes(`/api/strategies/${LAZY_ID}/returns`)) {
        attempt += 1;
        // First add → fail (network down). Second add (the retry) → succeed.
        if (attempt === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ daily_returns: LAZY_SERIES }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const returnsCalls = () =>
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes(`/api/strategies/${LAZY_ID}/returns`),
      ).length;

    render(
      <ScenarioComposer
        payload={makePayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // First add → the fetch fires and FAILS.
    addStrategy({
      id: LAZY_ID,
      name: "Retryable Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    await waitFor(() => expect(returnsCalls()).toBe(1));
    // The failed fetch settled to an honest [] in the lookup.
    await waitFor(() => expect(latestReturnsLookup()[LAZY_ID]).toEqual([]));

    // Remove the added strategy (the real CompositionList Remove button).
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Remove from scenario/i }),
      );
    });

    // Re-add the SAME id. WR-01: because the failed fetch left the entry
    // undefined (and WR-02 purged it on remove), the add seam MUST re-fetch.
    addStrategy({
      id: LAZY_ID,
      name: "Retryable Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    // The non-vacuous assertion: a SECOND fetch fired (pre-fix this stays 1).
    await waitFor(() => expect(returnsCalls()).toBe(2));

    // The retry succeeded, so the real series now reaches the adapter lookup —
    // the projection is no longer permanently gated out by the transient fail.
    await waitFor(() =>
      expect(latestReturnsLookup()[LAZY_ID]).toEqual(LAZY_SERIES),
    );
  });

  // -------------------------------------------------------------------------
  // WR-02 (Phase 29 review) — removing an added strategy mid-flight must ABORT
  //   the in-flight fetch and PURGE the loading affordance. Pre-fix,
  //   onRemoveAdded={scenario.removeAddedStrategy} only mutated the draft; the
  //   AbortController was never aborted (only unmount aborted) and
  //   loadingReturnsIds/addedReturnsById kept the removed id. NON-VACUOUS:
  //   asserts the fetch's AbortSignal fired `abort` (fails on pre-fix code) and
  //   the "Loading returns…" affordance disappears.
  // -------------------------------------------------------------------------
  it("WR-02 removing an added strategy mid-flight aborts the in-flight fetch and clears the loading affordance", async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      if (String(url).startsWith("/api/benchmark/btc")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (String(url).includes(`/api/strategies/${LAZY_ID}/returns`)) {
        capturedSignal = init?.signal ?? null;
        // Never resolves — the fetch stays in flight so the remove must abort it.
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioComposer
        payload={makePayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    addStrategy({
      id: LAZY_ID,
      name: "In-flight Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    // The in-flight fetch fired and handed an un-aborted signal to the request.
    await waitFor(() => expect(capturedSignal).not.toBeNull());
    expect(capturedSignal!.aborted).toBe(false);
    // The honest in-flight affordance is showing while the fetch is pending.
    await waitFor(() =>
      expect(screen.getByTestId("scenario-loading-returns")).toBeInTheDocument(),
    );

    // Remove the strategy mid-flight.
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Remove from scenario/i }),
      );
    });

    // WR-02: the in-flight request's signal was aborted (pre-fix: stays false).
    await waitFor(() => expect(capturedSignal!.aborted).toBe(true));
    // And the loading affordance is purged (the removed id dropped from state).
    await waitFor(() =>
      expect(screen.queryByTestId("scenario-loading-returns")).toBeNull(),
    );
  });

  // -------------------------------------------------------------------------
  // WR-05 (Phase 29 review) — the book-returns boundary must NOT silently drop a
  //   correctly-shaped series, and must honestly normalize the year-keyed-record
  //   shape rather than the pre-fix `raw as unknown as DailyPoint[]` cast (which
  //   relied on Array.isArray and dropped the typed nested-record shape to []).
  //   NON-VACUOUS: a year-keyed-record book series is FLATTENED into the
  //   projection lookup (pre-fix it was dropped to []), and a DailyPoint[] book
  //   series survives intact.
  // -------------------------------------------------------------------------
  const BOOK_ID = "bbbbbbbb-1111-2222-3333-444444444444";

  function makePayloadWithBookStrategy(
    dailyReturns: unknown,
  ): MyAllocationDashboardPayload {
    // A book strategy is one already in payload.strategies — no lazy fetch fires.
    return makePayload({
      strategies: [
        {
          // Minimal StrategyWithAnalytics-shaped row; only the fields the
          // composer's returns/metadata lookups read are populated.
          strategy: {
            id: BOOK_ID,
            disclosure_tier: "verified",
            strategy_analytics: {
              cagr: 0.1,
              sharpe: 1.0,
              daily_returns: dailyReturns,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
  }

  it("WR-05 a correctly-shaped DailyPoint[] book series survives into the adapter returns-lookup (not silently dropped)", () => {
    const series = [
      { date: "2026-03-01", value: 0.01 },
      { date: "2026-03-02", value: -0.004 },
    ];
    render(
      <ScenarioComposer
        payload={makePayloadWithBookStrategy(series)}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: BOOK_ID,
      name: "Book Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    expect(latestReturnsLookup()[BOOK_ID]).toEqual(series);
  });

  it("WR-05 a year-keyed-record book series is FLATTENED into a date-sorted DailyPoint[] (pre-fix it was silently dropped to [])", () => {
    // The TYPED shape of StrategyAnalytics.daily_returns: a year-keyed nested
    // record. Pre-fix Array.isArray(raw) was false → null → [] (real returns
    // silently dropped). The normalizer flattens it.
    const nested = {
      "2026": {
        "2026-04-02": 0.02,
        "2026-04-01": 0.01,
      },
    };
    render(
      <ScenarioComposer
        payload={makePayloadWithBookStrategy(nested)}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: BOOK_ID,
      name: "Nested Book Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    // Flattened + date-sorted — and crucially NON-EMPTY (the regression the cast
    // masked). Pre-fix this would be [].
    expect(latestReturnsLookup()[BOOK_ID]).toEqual([
      { date: "2026-04-01", value: 0.01 },
      { date: "2026-04-02", value: 0.02 },
    ]);
  });

  it("WR-05 a genuinely unexpected book shape warns (fail-loud) and degrades to [] (no crash)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ScenarioComposer
        payload={makePayloadWithBookStrategy("totally-wrong-shape")}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: BOOK_ID,
      name: "Bad Shape Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    expect(latestReturnsLookup()[BOOK_ID]).toEqual([]);
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("unexpected shape"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // WR-04 (Phase 29 review) — opening a saved portfolio whose draft is not
  //   JSON-safe (a BigInt throws in JSON.stringify) must route to the honest
  //   "older format" reset notice rather than letting the TypeError escape (or
  //   silently hydrating the default draft). NON-VACUOUS: asserts the notice
  //   renders and the open did NOT throw.
  // -------------------------------------------------------------------------
  it("WR-04 opening a saved portfolio with a non-JSON-safe draft (BigInt) shows the honest reset notice, no throw", () => {
    let registeredOpen: ((row: {
      id: string;
      name: string;
      draft: unknown;
    }) => void) | null = null;
    render(
      <ScenarioComposer
        payload={makePayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          registeredOpen = open as typeof registeredOpen;
        }}
      />,
    );
    expect(registeredOpen).not.toBeNull();
    // A BigInt in the draft makes JSON.stringify throw a TypeError. The open
    // must catch it and show the honest reset notice (never let it escape).
    expect(() => {
      act(() => {
        registeredOpen!({
          id: "saved-bigint-row",
          name: "BigInt Portfolio",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          draft: { schema_version: 2, bad: BigInt(1) } as any,
        });
      });
    }).not.toThrow();
    expect(
      screen.getByText(
        /This saved portfolio uses an older format and can't be reopened\./i,
      ),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C11 — Footer Commit disabled when diff_count = 0
  // -------------------------------------------------------------------------
  it("T_C11 Sticky footer Commit disabled when diff_count=0; enabled after adding one strategy", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const commit = screen.getByTestId(
      "scenario-footer-commit",
    ) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    // Read-only-tokens model: a diff is produced by ADDING a strategy, not by
    // toggling a holding.
    addStrategy({
      id: "strat-c11",
      name: "C11 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    expect(commit.disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T_C12 — Reset opens destructive confirmation modal
  // -------------------------------------------------------------------------
  it("T_C12 Click Reset → destructive confirmation modal with title/buttons per UI-SPEC", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByTestId("scenario-footer-reset"));
    expect(
      screen.getByText(/Discard your scenario draft\?/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Discard draft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Cancel$/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C13 — Confirm Reset clears draft + footer back to "No changes yet"
  // -------------------------------------------------------------------------
  it("T_C13 Confirm Reset → draft reset; footer back to No changes yet", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: "strat-c13",
      name: "C13 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    expect(
      (screen.getByTestId("scenario-footer-commit") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByTestId("scenario-footer-reset"));
    fireEvent.click(screen.getByRole("button", { name: /Discard draft/i }));
    // The destructive modal closed; commit goes back to disabled
    expect(
      (screen.getByTestId("scenario-footer-commit") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T_C14 — Cancel Reset keeps draft
  // -------------------------------------------------------------------------
  it("T_C14 Cancel Reset → modal closes; draft unchanged", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: "strat-c14",
      name: "C14 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-reset"));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(
      screen.queryByText(/Discard your scenario draft\?/i),
    ).not.toBeInTheDocument();
    // Diff still present
    expect(
      (screen.getByTestId("scenario-footer-commit") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T_C_MODE1 — entry-mode segmented control renders two accessible segments
  //   (UNIFY-01/02). radiogroup + two radios; the live book defaults to
  //   "From my book". Active segment carries the accent OUTLINE, never a fill
  //   (accent = action/verified, a mode toggle is neither — 29-UI-SPEC §1).
  // -------------------------------------------------------------------------
  it("T_C_MODE1 entry-mode control renders an accessible radiogroup with 'From my book' (default) + 'Blank slate'; active = accent outline, NOT a fill", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const group = screen.getByRole("radiogroup", {
      name: /Composition entry mode/i,
    });
    expect(group).toBeInTheDocument();
    const book = screen.getByRole("radio", { name: /From my book/i });
    const blank = screen.getByRole("radio", { name: /Blank slate/i });
    // Live book present → "From my book" is the default selected segment.
    expect(book).toHaveAttribute("aria-checked", "true");
    expect(blank).toHaveAttribute("aria-checked", "false");
    // Active segment uses the accent OUTLINE recipe, never a fill.
    expect(book.className).toMatch(/border-accent/);
    expect(book.className).toMatch(/text-accent/);
    expect(book.className).not.toMatch(/bg-accent/);
    expect(blank.className).not.toMatch(/bg-accent/);
  });

  // -------------------------------------------------------------------------
  // T_C_MODE2 — no live book → "From my book" is NOT rendered as a dead
  //   default; the composer defaults to Blank slate (29-UI-SPEC §1).
  //   With nothing added, the no-book allocator sees the empty-state front
  //   door; once a strategy is added the main body renders with the control.
  // -------------------------------------------------------------------------
  it("T_C_MODE2 no live book → defaults to Blank slate, never a dead 'From my book' segment", () => {
    const payload = makePayload({
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // No-book + nothing added → empty-state front door (the blank-slate door).
    expect(
      screen.getByRole("link", { name: /Connect Exchange/i }),
    ).toBeInTheDocument();
    // Add a strategy → main body renders; the control shows Blank-slate-only
    // (no dead "From my book" default for a no-book allocator).
    addStrategy({
      id: "strat-mode2",
      name: "Mode2 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    const blank = screen.getByRole("radio", { name: /Blank slate/i });
    expect(blank).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("radio", { name: /From my book/i }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C_MODE3 — NON-VACUOUS (acceptance criterion): a mode switch with a DIRTY
  //   draft (diffCount > 0) MUST open the existing ResetConfirmationModal and
  //   must NOT change the active segment until the user confirms. On confirm
  //   the mode applies and the draft is discarded. This test FAILS if the
  //   onClick re-seeds / flips the mode directly (the silent-wipe regression,
  //   Pitfall 5).
  // -------------------------------------------------------------------------
  it("T_C_MODE3 dirty-draft mode switch opens the reset confirmation and does NOT flip the mode until confirm (no silent wipe)", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Dirty the draft (an add is a diff) so the switch must route through the
    // reset confirmation rather than apply silently.
    addStrategy({
      id: "strat-mode3",
      name: "Mode3 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    const blank = screen.getByRole("radio", { name: /Blank slate/i });
    const book = screen.getByRole("radio", { name: /From my book/i });
    expect(book).toHaveAttribute("aria-checked", "true");

    // Click the inactive "Blank slate" segment with a dirty draft.
    fireEvent.click(blank);

    // The reset confirmation modal opens (the SAME modal the footer Reset uses).
    expect(
      screen.getByText(/Discard your scenario draft\?/i),
    ).toBeInTheDocument();
    // CRITICAL non-vacuous assertion: the mode did NOT flip — "From my book" is
    // still the active segment, and the added strategy is still present (the
    // draft was NOT silently wiped). A naive onClick that calls setEntryMode /
    // reset directly would already have flipped aria-checked here and this would
    // fail.
    expect(
      screen.getByRole("radio", { name: /From my book/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: /Blank slate/i }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByText(/Mode3 Strat/i).length).toBeGreaterThan(0);

    // Confirm → the discard happens AND the parked mode applies.
    fireEvent.click(screen.getByRole("button", { name: /Discard draft/i }));
    expect(
      screen.queryByText(/Discard your scenario draft\?/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Blank slate/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // T_C_MODE4 — a CLEAN draft (diffCount === 0) switches immediately (nothing
  //   to lose) — no confirmation modal.
  // -------------------------------------------------------------------------
  it("T_C_MODE4 clean-draft mode switch applies immediately without a confirmation modal", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // No edits → clean draft. Switching is lossless.
    fireEvent.click(screen.getByRole("radio", { name: /Blank slate/i }));
    expect(
      screen.queryByText(/Discard your scenario draft\?/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Blank slate/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // T_C15 — Fingerprint mismatch banner
  // -------------------------------------------------------------------------
  it("T_C15 fingerprintMismatch=true → banner visible with copy + 2 buttons; default-focus on Keep my draft", () => {
    // Pre-seed localStorage with a draft whose fingerprint does NOT match
    // the current holdings. Hook detects this on mount and surfaces the banner.
    lsStore.set(
      `allocations.scenario_v0_15.${ALLOCATOR_A}`,
      JSON.stringify({
        schema_version: 2,
        init_holdings_fingerprint: "STALE_FINGERPRINT_NOT_MATCHING",
        toggleByScopeRef: { [REF_BTC]: true },
        addedStrategies: [],
        weightOverrides: { [REF_BTC]: 1 },
        lastEditedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText(
        /Your live holdings have changed since you last edited the scenario/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reset and start over/i }),
    ).toBeInTheDocument();
    const keepBtn = screen.getByRole("button", { name: /Keep my draft/i });
    expect(keepBtn).toBeInTheDocument();
    // The "Keep my draft" button carries the autoFocus attribute (or document
    // activeElement matches it) so the alert defaults to the non-destructive
    // option per UI-SPEC.
    expect(
      keepBtn.hasAttribute("autoFocus") || document.activeElement === keepBtn,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // M-0097 — T_C15's focus assertion is OR'd with hasAttribute("autoFocus"),
  // which React compiles AWAY (the JSX `autoFocus` prop never lands as a DOM
  // attribute — React calls .focus() on mount instead). So the OR weakens the
  // check: the hasAttribute side is always false, and a regression dropping
  // the prop could still pass if focus happened to land on the button. This
  // case pins the strict invariant: on mount, focus IS on "Keep my draft" —
  // the non-destructive default per UI-SPEC — and NOT on "Reset and start
  // over". Dropping `autoFocus` makes this fail.
  // -------------------------------------------------------------------------
  it("M-0097 fingerprint banner — mount focus lands strictly on 'Keep my draft' (autoFocus), not Reset", () => {
    lsStore.set(
      `allocations.scenario_v0_15.${ALLOCATOR_A}`,
      JSON.stringify({
        schema_version: 2,
        init_holdings_fingerprint: "STALE_FINGERPRINT_NOT_MATCHING",
        toggleByScopeRef: { [REF_BTC]: true },
        addedStrategies: [],
        weightOverrides: { [REF_BTC]: 1 },
        lastEditedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const keepBtn = screen.getByRole("button", { name: /Keep my draft/i });
    const resetBtn = screen.getByRole("button", {
      name: /Reset and start over/i,
    });
    // Strict: focus is on the non-destructive default, not the destructive one.
    expect(document.activeElement).toBe(keepBtn);
    expect(document.activeElement).not.toBe(resetBtn);
  });

  // -------------------------------------------------------------------------
  // T_C16 — Compare → for flagged-holding rows
  // -------------------------------------------------------------------------
  it("T_C16 Composition row for a flagged holding renders a Compare → button routing to /compare?ids=...", () => {
    const payload = makePayload({ flaggedHoldings: [FLAGGED_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const compareBtn = screen.getByRole("button", { name: /^Compare →$/i });
    fireEvent.click(compareBtn);
    expect(mockPush).toHaveBeenCalled();
    const url = String(mockPush.mock.calls[0][0]);
    expect(url).toContain("/compare?ids=");
    // URL encodes the colons in the scope_ref (encodeURIComponent gives %3A)
    expect(url).toMatch(/holding(?:%3A|:)binance(?:%3A|:)BTC(?:%3A|:)spot/);
    expect(url).toContain("uuid-candidate-1");
  });

  // -------------------------------------------------------------------------
  // T_C17 — Remove × on added strategies
  // -------------------------------------------------------------------------
  it("T_C17 Composition row for an added strategy renders Remove × with aria-label='Remove from scenario'", () => {
    const payload = makePayload();
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: "strat-uuid-removable",
        name: "Removable Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    expect(
      screen.getByRole("button", { name: /Remove from scenario/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C18 — Click Commit fires onCommitRequested callback
  // -------------------------------------------------------------------------
  it("T_C18 Click Commit (with diff_count>0, useInternalCommitDrawer=false) → onCommitRequested callback fires", () => {
    // Review-pass P2 fix: when useInternalCommitDrawer is left at its
    // default (true), the composer opens its own ScenarioCommitDrawer and
    // SUPPRESSES the legacy onCommitRequested callback so two
    // confirmation surfaces cannot stack. T_C18 exercises the legacy
    // host-owned-UI path — opt out of the internal drawer to verify the
    // callback still fires for callers that prefer to own the commit UI.
    const payload = makePayload();
    const onCommitRequested = vi.fn();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        onCommitRequested={onCommitRequested}
        useInternalCommitDrawer={false}
      />,
    );
    // Read-only-tokens model: the only committable decision is adding a strategy.
    addStrategy({
      id: "strat-c18",
      name: "C18 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    expect(onCommitRequested).toHaveBeenCalled();
    const diffs = onCommitRequested.mock.calls[0][0];
    expect(Array.isArray(diffs)).toBe(true);
    // Adding a strategy should produce a voluntary_add diff for it.
    expect(
      diffs.some(
        (d: { kind: string; strategy_id?: string }) =>
          d.kind === "voluntary_add" && d.strategy_id === "strat-c18",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T_C_P1933 — P1933 CRITICAL: empty-state add flow + commit must refuse
  //   when scenarioAum=0 (every voluntary_add row would land with
  //   size_at_decision_usd:0 → division-by-zero downstream).
  // -------------------------------------------------------------------------
  it("T_C_P1933 (audit-2026-05-07/Block-C/C.1) — refuses commit + surfaces alert when scenarioAum=0 with voluntary_add", () => {
    // Empty holdings + added-strategy via the empty-state Browse drawer
    // transitions the composer out of the empty-state branch and into the
    // main body with scenarioAum === 0 (no live holdings contribute).
    const payload = makePayload({
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
    });
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const onCommitRequested = vi.fn();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        onCommitRequested={onCommitRequested}
        useInternalCommitDrawer={false}
      />,
    );
    // Empty-state branch → click Browse → simulate Add. The browse drawer
    // in the empty-state branch is rendered (and mocked) so onAdd is wired.
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: "strat-uuid-zero-aum",
        name: "Zero AUM Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });

    // Composer now in main-body render. Click Commit — the handler should
    // refuse and surface an inline role="alert" referencing zero AUM.
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((a) => /portfolio AUM is zero/i.test(a.textContent ?? "")),
    ).toBe(true);
    // The drawer must NOT have opened (no internal drawer per the
    // useInternalCommitDrawer={false} prop) and the legacy callback must
    // NOT have fired either — the commit is refused outright.
    expect(onCommitRequested).not.toHaveBeenCalled();
    expect(screen.queryByTestId("commit-drawer-mock")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_C19 — Equity_curve +1 wealth conversion (Pitfall 1)
  // -------------------------------------------------------------------------
  it("T_C19 EquityChart scenarioSeries values are wealth-form (>=0.95 — i.e. +1 conversion applied)", () => {
    // The mocked adapter returns empty strategies so computeScenario yields
    // n=0 + equity_curve=[]. To exercise the +1 conversion path we feed a
    // synthetic equity_curve via override of the adapter return AND mock
    // computeScenario through the scenario-state path is not reachable here;
    // instead, override the adapter to return a STATE that drives the
    // scenarioMetrics.equity_curve we want. Simplest: spy on the props the
    // composer passes and assert: every passed scenarioSeries point has
    // value >= 0.95 (no negative cumulative-RETURN form leaked through —
    // wealth form starts at ~1.0).
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(EquityChart).toHaveBeenCalled();
    const props = vi.mocked(EquityChart).mock.calls[0][0];
    const series = (props.scenarioSeries ?? []) as Array<{
      date: string;
      value: number;
    }>;
    for (const p of series) {
      // Wealth-form values for a fresh scenario start at ~1.0, can dip to
      // ~0.95 in a brutal drawdown. The +1 conversion is what keeps them
      // from being centered around 0.
      expect(p.value).toBeGreaterThanOrEqual(0.95);
    }
  });

  // -------------------------------------------------------------------------
  // M-0096 — T_C19's for-loop runs over an EMPTY series (the global adapter
  // mock returns no strategies → computeScenario yields equity_curve=[]), so
  // every `expect(p.value >= 0.95)` is skipped and the +1 wealth conversion is
  // never actually exercised. This case overrides the adapter to return a real
  // selected strategy with >= 10 daily returns so computeScenario produces a
  // NON-EMPTY equity_curve, then fails loud if the precondition is unmet AND
  // pins that every scenarioSeries point is wealth-form (>= 0.95).
  // -------------------------------------------------------------------------
  it("M-0096 EquityChart scenarioSeries is NON-EMPTY and wealth-form (+1 conversion genuinely exercised)", () => {
    // 12 business days of small positive returns → cumulative wealth ~1.0, so
    // each equity_curve value (cumulative-1) is tiny and +1 → ~1.0 >= 0.95.
    const dates = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
    ];
    const strat = {
      id: "strat-real-1",
      name: "Real Strategy",
      codename: null,
      disclosure_tier: "verified",
      strategy_types: ["momentum"],
      markets: ["binance"],
      start_date: "2026-01-01",
      daily_returns: dates.map((date) => ({ date, value: 0.001 })),
      cagr: 0.1,
      sharpe: 1.0,
      volatility: 0.1,
      max_drawdown: -0.02,
    };
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [strat],
      state: {
        selected: { "strat-real-1": true },
        weights: { "strat-real-1": 1 },
        startDates: {},
      },
    });

    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(EquityChart).toHaveBeenCalled();
    const props = vi.mocked(EquityChart).mock.calls[0][0];
    const series = (props.scenarioSeries ?? []) as Array<{
      date: string;
      value: number;
    }>;
    // Fail loud: the +1 conversion check is meaningless without points.
    expect(series.length).toBeGreaterThan(0);
    for (const p of series) {
      expect(p.value).toBeGreaterThanOrEqual(0.95);
      // Wealth-form (not raw cumulative-return form, which would be ~0.0).
      expect(p.value).toBeGreaterThan(0.5);
    }
  });

  // -------------------------------------------------------------------------
  // T_C20 — data-widget-id="scenario-composer" attribute
  // -------------------------------------------------------------------------
  it("T_C20 outer container has data-widget-id='scenario-composer' for PostHog widget_viewed hook", () => {
    const payload = makePayload();
    const { container } = render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      container.querySelector('[data-widget-id="scenario-composer"]'),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_C_empty_to_composer (M3) — empty → browse-add → composer body renders
  // -------------------------------------------------------------------------
  it("T_C_empty_to_composer (M3) holdingsSummary=[] → empty state → Browse → Add → composer body renders (no crash)", () => {
    const payload = makePayload({
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
    });
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Initial: empty-state branch
    expect(
      screen.getByText("Start a portfolio"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Browse strategies/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: "strat-uuid-from-empty",
        name: "Hypothetical Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    // Composer body now renders — KpiStrip + footer visible
    expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-footer-commit")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_C_M5_multi_venue_tooltip (M5) — multi-venue caveat
  //   Aliases the RESEARCH-spec'd `T03_multi_venue_correlation` test name.
  // -------------------------------------------------------------------------
  it("T_C_M5_multi_venue_tooltip / T03_multi_venue_correlation: multi-venue rows surface 'Returns merged with' tooltip; non-shared rows don't", () => {
    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_BTC_OKX, HOLDING_ETH],
      holdingReturnsByScopeRef: {
        [REF_BTC]: [{ date: "2026-01-01", value: 0.001 }],
        [REF_BTC_OKX]: [{ date: "2026-01-01", value: 0.001 }],
        [REF_ETH]: [{ date: "2026-01-01", value: 0.0015 }],
      },
    });
    const { container } = render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Both BTC rows render the multi-venue caveat (read-only rows keep it).
    const tooltips = screen.getAllByText(/Returns merged with/i);
    expect(tooltips.length).toBeGreaterThanOrEqual(2);
    // ETH row has no shared symbol — no caveat. Located by data-scope-ref since
    // holdings no longer render a toggle switch.
    const ethRow = container.querySelector(`[data-scope-ref="${REF_ETH}"]`);
    expect(ethRow).not.toBeNull();
    expect(
      (ethRow as HTMLElement).textContent ?? "",
    ).not.toMatch(/Returns merged with/i);
  });

  // -------------------------------------------------------------------------
  // T_C_M4_live_ssr_lifted (M4) — live baseline read from payload
  // -------------------------------------------------------------------------
  it("T_C_M4_live_ssr_lifted KpiStrip's liveMetrics carries fields from payload.liveBaselineMetrics; adapter called once per render", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(KpiStrip).toHaveBeenCalled();
    const kpiProps = vi.mocked(KpiStrip).mock.calls[0][0];
    // Composer adapts liveBaselineMetrics → ComputedMetrics-shaped fields
    // KpiStrip indexes by twr / sharpe / max_drawdown / avg_pairwise_correlation;
    // assert the adapted shape preserves the source values.
    expect(
      (kpiProps.liveMetrics as unknown as { twr?: number | null })?.twr,
    ).toBe(payload.liveBaselineMetrics.ytdTwr);
    expect(
      (kpiProps.liveMetrics as unknown as { sharpe?: number | null })?.sharpe,
    ).toBe(payload.liveBaselineMetrics.sharpe);
    expect(
      (kpiProps.liveMetrics as unknown as { max_drawdown?: number | null })
        ?.max_drawdown,
    ).toBe(payload.liveBaselineMetrics.maxDd);
    // Adapter call count: M4 — only the scenario-side call. The composer must
    // NOT re-derive the live baseline by calling buildStrategyForBuilderSet
    // a second time per render.
    expect(vi.mocked(buildStrategyForBuilderSet).mock.calls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // B4 — adapter signature pin tests
  // -------------------------------------------------------------------------
  it("T_C_ADAPT1 buildStrategyForBuilderSet receives addedStrategies of AddedStrategy[] shape (lightweight, no daily_returns at call site)", () => {
    const payload = makePayload();
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: "strat-uuid-ADAPT1",
        name: "ADAPT1 Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    const calls = vi.mocked(buildStrategyForBuilderSet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    // Positional args: (holdings, disabledRefs, addedStrategies, holdingReturnsByScopeRef, returnsLookup, metadataLookup)
    const addedStrategiesArg = lastCall[2];
    expect(Array.isArray(addedStrategiesArg)).toBe(true);
    if (addedStrategiesArg.length > 0) {
      const a = addedStrategiesArg[0];
      // Lightweight shape — only id/name/markets/strategy_types
      expect(Object.keys(a).sort()).toEqual(
        ["id", "markets", "name", "strategy_types"].sort(),
      );
      // No daily_returns / disclosure_tier on the added-strategy at the call site
      expect("daily_returns" in a).toBe(false);
      expect("disclosure_tier" in a).toBe(false);
    }
  });

  it("T_C_ADAPT2 buildStrategyForBuilderSet receives addedStrategyReturnsLookup constructed from payload.strategies", () => {
    const ADDED_ID = "strat-with-returns";
    const payload = makePayload({
      strategies: [
        {
          strategy_id: ADDED_ID,
          current_weight: null,
          allocated_amount: null,
          alias: "Added Strategy A",
          added_at: "2025-06-01T00:00:00Z",
          eligible_for_outcome: false,
          existing_outcome: null,
          strategy: {
            id: ADDED_ID,
            name: "Added Strategy A",
            codename: null,
            disclosure_tier: "institutional",
            strategy_types: ["momentum"],
            markets: ["binance"],
            start_date: "2025-01-01",
            organization_name: null,
            strategy_analytics: {
              // The runtime payload from queries.ts surfaces daily_returns as a
              // DailyPoint[] for the scenario sandbox path even though the
              // upstream StrategyAnalytics TS type declares it as a year-keyed
              // nested record. Cast keeps the test fixture honest about what
              // the composer's adapter call site actually consumes.
              daily_returns: [
                { date: "2026-01-01", value: 0.002 },
              ] as unknown as Record<string, Record<string, number>>,
              cagr: 0.18,
              sharpe: 1.4,
              volatility: 0.12,
              max_drawdown: -0.06,
            },
          },
        },
      ],
    });
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: ADDED_ID,
        name: "Added Strategy A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    const calls = vi.mocked(buildStrategyForBuilderSet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    // The adapter signature uses a phantom-branded `StrategyForBuilderId`
    // key on the lookup map. Cast to `Record<string, DailyPoint[]>` so the
    // raw string ADDED_ID indexes the runtime object cleanly.
    const returnsLookup = lastCall[4] as unknown as Record<
      string,
      Array<{ date: string; value: number }>
    >;
    expect(returnsLookup[ADDED_ID]).toBeDefined();
    expect(Array.isArray(returnsLookup[ADDED_ID])).toBe(true);
    expect(returnsLookup[ADDED_ID][0].date).toBe("2026-01-01");
    expect(returnsLookup[ADDED_ID][0].value).toBe(0.002);
  });

  it("T_C_ADAPT3 buildStrategyForBuilderSet receives addedStrategyMetadataLookup with disclosure_tier/cagr/sharpe", () => {
    const ADDED_ID = "strat-with-meta";
    const payload = makePayload({
      strategies: [
        {
          strategy_id: ADDED_ID,
          current_weight: null,
          allocated_amount: null,
          alias: "Meta Strategy",
          added_at: "2025-06-01T00:00:00Z",
          eligible_for_outcome: false,
          existing_outcome: null,
          strategy: {
            id: ADDED_ID,
            name: "Meta Strategy",
            codename: null,
            disclosure_tier: "institutional",
            strategy_types: ["momentum"],
            markets: ["binance"],
            start_date: "2025-01-01",
            organization_name: null,
            strategy_analytics: {
              daily_returns: {} as Record<string, Record<string, number>>,
              cagr: 0.22,
              sharpe: 1.55,
              volatility: 0.15,
              max_drawdown: -0.07,
            },
          },
        },
      ],
    });
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Browse strategies$/i }),
    );
    act(() => {
      capturedOnAdd!({
        id: ADDED_ID,
        name: "Meta Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });
    const calls = vi.mocked(buildStrategyForBuilderSet).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    // Cast through `unknown` for the same brand-key reason as T_C_ADAPT2.
    const metadataLookup = lastCall[5] as unknown as Record<
      string,
      { disclosure_tier: string; cagr: number | null; sharpe: number | null }
    >;
    expect(metadataLookup[ADDED_ID]).toBeDefined();
    expect(metadataLookup[ADDED_ID].disclosure_tier).toBe("institutional");
    expect(metadataLookup[ADDED_ID].cagr).toBe(0.22);
    expect(metadataLookup[ADDED_ID].sharpe).toBe(1.55);
  });

  // -------------------------------------------------------------------------
  // Weight input fail-loud — typing Infinity in the weight input must surface
  // a visible inline error instead of silently dropping the change (the
  // controlled input would otherwise display a value that doesn't match
  // underlying state).
  // -------------------------------------------------------------------------
  it("non-finite weight input surfaces an inline role='alert' (fail-loud, no silent drop)", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Read-only-tokens model: weight inputs live on added-strategy rows.
    addStrategy({
      id: "strat-nf",
      name: "NF Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    const btcInput = screen.getByLabelText(/NF Strat weight/i) as HTMLInputElement;
    // Force a non-finite synthetic event through React's controlled-input
    // bridge. We can't just write `target: { value: "Infinity" }` because
    // jsdom's `<input type="number">` sanitizes the value to "" before
    // React reads it — Number("") is 0, which would take the happy path.
    // Patching the input's `valueAsNumber` getter to return NaN delivers a
    // non-finite Number(e.target.value) to the composer's wrapper without
    // depending on string-parsing semantics.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    Object.defineProperty(btcInput, "value", {
      configurable: true,
      get: () => "Infinity",
    });
    fireEvent.change(btcInput);
    const errEl = screen.getByTestId("scenario-commit-error");
    expect(errEl.textContent).toMatch(/Invalid weight/i);

    // Restore so the next assertion exercises the cleared-error path.
    if (originalDescriptor) {
      Object.defineProperty(btcInput, "value", originalDescriptor);
    }
    fireEvent.change(btcInput, { target: { value: "0.5" } });
    expect(screen.queryByTestId("scenario-commit-error")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_C21 — Plan 07 wire-in: Click Commit footer button → ScenarioCommitDrawer
  //         opens with the diffs prop.
  // -------------------------------------------------------------------------
  it("T_C21 (Plan 07) Click Commit → ScenarioCommitDrawer opens with diffs prop", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Add a strategy → at least one diff exists
    addStrategy({
      id: "strat-c21",
      name: "C21 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    // Drawer not yet open
    expect(screen.queryByTestId("commit-drawer-mock")).toBeNull();
    // Click commit
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    // Drawer opens with isOpen=true
    expect(screen.getByTestId("commit-drawer-mock")).toBeInTheDocument();
    // The diffs prop carries the voluntary_add for the strategy
    const drawerProps = vi.mocked(ScenarioCommitDrawer).mock.calls.at(-1)?.[0];
    expect(drawerProps).toBeDefined();
    expect(drawerProps?.isOpen).toBe(true);
    expect(Array.isArray(drawerProps?.diffs)).toBe(true);
    expect(
      drawerProps?.diffs.some(
        (d) =>
          d.kind === "voluntary_add" &&
          d.strategy_id === "strat-c21",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B11 / NEW-C18-10 — Click Commit freezes the draft's holdings fingerprint
  //   and passes it to the drawer (so the RPC can reject a stale-draft commit).
  // -------------------------------------------------------------------------
  it("B11/NEW-C18-10: Click Commit → drawer receives the frozen holdings fingerprint (current holdings set)", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Produce at least one diff so the commit pipeline opens.
    addStrategy({
      id: "strat-b11a",
      name: "B11a Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));

    const drawerProps = vi.mocked(ScenarioCommitDrawer).mock.calls.at(-1)?.[0];
    const fp = drawerProps?.initHoldingsFingerprint;
    // A fresh draft's fingerprint is computeHoldingsFingerprint over the live
    // holdings; asserting the SET (order-robust) proves the composer froze the
    // correct shape rather than null / a stale value.
    expect(typeof fp).toBe("string");
    expect(new Set((fp as string).split("|"))).toEqual(
      new Set([
        "BTC:binance:spot",
        "ETH:binance:spot",
        "SOL:binance:spot",
      ]),
    );
  });

  // B11 / NEW-C18-10 — the fingerprint must be FROZEN at handleCommit, not read
  // live. If holdings change while the drawer is open (position cron / another
  // tab), the drawer must keep sending the at-build-time fingerprint so the
  // server rejects the now-stale commit. A live read would send the CURRENT
  // (rebased) fingerprint, the server would accept, and the stale diffs would
  // commit as a lost-update — the exact hole this closes. This test fails if the
  // drawer prop is sourced from scenario.draft.init_holdings_fingerprint live.
  it("B11/NEW-C18-10: a holdings change after Commit does NOT update the frozen fingerprint sent to the drawer", () => {
    const { rerender } = render(
      <ScenarioComposer
        payload={makePayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: "strat-b11b",
      name: "B11b Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    const frozen = vi
      .mocked(ScenarioCommitDrawer)
      .mock.calls.at(-1)?.[0]?.initHoldingsFingerprint;
    expect(new Set((frozen as string).split("|"))).toEqual(
      new Set(["BTC:binance:spot", "ETH:binance:spot", "SOL:binance:spot"]),
    );

    // Holdings change mid-dwell: SOL is divested. The LIVE current fingerprint
    // is now {BTC,ETH}; the FROZEN one must stay {BTC,ETH,SOL}.
    rerender(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const afterChange = vi
      .mocked(ScenarioCommitDrawer)
      .mock.calls.at(-1)?.[0]?.initHoldingsFingerprint;
    expect(new Set((afterChange as string).split("|"))).toEqual(
      new Set(["BTC:binance:spot", "ETH:binance:spot", "SOL:binance:spot"]),
    );
    // And explicitly NOT the new live set (which is what a live read would send).
    expect(new Set((afterChange as string).split("|"))).not.toEqual(
      new Set(["BTC:binance:spot", "ETH:binance:spot"]),
    );
  });

  // -------------------------------------------------------------------------
  // Read-only-tokens model — live holdings are FIXED context: they cannot be
  // toggled off or reweighted, so a commit emits ONLY voluntary_add (for added
  // strategies) and NEVER a voluntary_remove / voluntary_modify for a holding.
  // (Replaces the prior NEW-C18-01 voluntary_modify-on-holding-reweight test,
  // whose behavior was removed with the per-token controls.) Adding a strategy
  // renormalizes holding weights for the blend, but that dilution is a
  // mechanical consequence of the add, not a recorded holding decision.
  // -------------------------------------------------------------------------
  it("Read-only tokens: commit emits ONLY voluntary_add (no voluntary_modify/remove for fixed holdings)", () => {
    const payload = makePayload();
    const onCommitRequested = vi.fn();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        useInternalCommitDrawer={false}
        onCommitRequested={onCommitRequested}
      />,
    );

    addStrategy({
      id: "strat-only-add",
      name: "OnlyAdd Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    expect(onCommitRequested).toHaveBeenCalled();

    const diffs = onCommitRequested.mock.calls[0][0] as Array<{
      kind: string;
      strategy_id?: string;
    }>;
    // The added strategy is committed as voluntary_add…
    expect(
      diffs.some(
        (d) => d.kind === "voluntary_add" && d.strategy_id === "strat-only-add",
      ),
    ).toBe(true);
    // …and NOTHING is a holding modify/remove (those paths no longer exist).
    expect(
      diffs.some(
        (d) => d.kind === "voluntary_modify" || d.kind === "voluntary_remove",
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // NEW-C18-10 — fingerprint mismatch blocks commit button
  // Before this fix, a user could commit against a stale snapshot even after
  // seeing the "holdings have changed" banner. The commit button must be
  // disabled while fingerprintMismatch is true, regardless of diffCount.
  // After the user resolves the mismatch (Reset or Keep), the block lifts.
  // -------------------------------------------------------------------------
  it("NEW-C18-10 fingerprint mismatch → Commit button disabled while banner visible; unblocked after Keep or Reset", () => {
    // Pre-seed a stale draft so the hook detects a mismatch on mount.
    // Note: when a fingerprint mismatch is detected, the hook re-initializes
    // from current holdings (defaultDraftFromHoldings), so diffCount starts
    // at 0. The commit button is disabled for BOTH reasons initially.
    // After "Keep my draft", fingerprintMismatch clears; then toggling a holding
    // produces a diff and the button enables. This pins the commitBlocked path.
    lsStore.set(
      `allocations.scenario_v0_15.${ALLOCATOR_A}`,
      JSON.stringify({
        schema_version: 2,
        init_holdings_fingerprint: "STALE_FINGERPRINT_NOT_MATCHING",
        toggleByScopeRef: { [REF_BTC]: true, [REF_ETH]: true, [REF_SOL]: true },
        addedStrategies: [],
        weightOverrides: { [REF_BTC]: 0.6, [REF_ETH]: 0.3, [REF_SOL]: 0.1 },
        lastEditedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    const commit = screen.getByTestId(
      "scenario-footer-commit",
    ) as HTMLButtonElement;
    // Banner visible, commit blocked (fingerprintMismatch=true).
    expect(
      screen.getByText(/Your live holdings have changed since you last edited the scenario/i),
    ).toBeInTheDocument();
    expect(commit.disabled).toBe(true);

    // Dismiss: "Keep my draft" clears the mismatch flag.
    fireEvent.click(screen.getByRole("button", { name: /Keep my draft/i }));
    // Banner gone, fingerprintMismatch=false. Now add a strategy to produce a diff.
    expect(
      screen.queryByText(/Your live holdings have changed since you last edited the scenario/i),
    ).not.toBeInTheDocument();
    // Add a strategy to produce a diff → button enables.
    addStrategy({
      id: "strat-c18-10",
      name: "C18-10 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    expect(commit.disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // NEW-C18-13 — commitDiffs cleared on success
  // After a successful commit, reopening the drawer must not re-submit.
  // -------------------------------------------------------------------------
  it("NEW-C18-13 onSubmitSuccess clears commitDiffs so a second drawer-open starts empty", () => {
    const payload = makePayload();
    let capturedOnSubmitSuccess: (() => void) | null = null;
    vi.mocked(ScenarioCommitDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onSubmitSuccess: () => void;
    }) => {
      capturedOnSubmitSuccess = props.onSubmitSuccess;
      return props.isOpen ? <div data-testid="commit-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Add a strategy to produce a diff.
    addStrategy({
      id: "strat-c18-13",
      name: "C18-13 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    expect(screen.getByTestId("commit-drawer-mock")).toBeInTheDocument();
    // Simulate a successful commit.
    act(() => {
      capturedOnSubmitSuccess?.();
    });
    // After success, the draft is reset (added strategy cleared, diff=0).
    const commit = screen.getByTestId(
      "scenario-footer-commit",
    ) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    // Now add another strategy — the ScenarioCommitDrawer should receive a
    // fresh (non-stale) diffs array when opened again.
    addStrategy({
      id: "strat-c18-13b",
      name: "C18-13b Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));
    const drawerCalls = vi.mocked(ScenarioCommitDrawer).mock.calls;
    const lastCall = drawerCalls.at(-1)?.[0];
    // Read-only-tokens model: the fresh diff array is a single voluntary_add for
    // the newly-added strategy (no stale rows from the prior commit).
    expect(lastCall?.diffs).toBeDefined();
    expect(
      lastCall?.diffs.some(
        (d: { kind: string; strategy_id?: string }) =>
          d.kind === "voluntary_add" && d.strategy_id === "strat-c18-13b",
      ),
    ).toBe(true);
    // No stale row from the first (already-committed) strategy.
    expect(
      lastCall?.diffs.some(
        (d: { kind: string; strategy_id?: string }) =>
          d.strategy_id === "strat-c18-13",
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // NEW-C18-07 — weight >1 surfaces a commit error with the value forwarded
  // (state-layer clamping is still applied; the error is just made visible).
  // Before this fix, entering 1.5 in the weight input silently clamped to 1.0
  // with no user-visible feedback, making the discrepancy invisible.
  // -------------------------------------------------------------------------
  it("NEW-C18-07: entering a weight >1 surfaces an inline error alert", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        useInternalCommitDrawer={false}
        onCommitRequested={vi.fn()}
      />,
    );

    // Read-only-tokens model: weight inputs live on added-strategy rows.
    addStrategy({
      id: "strat-w1",
      name: "W1 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    // Enter a weight exceeding 1 for the strategy.
    const wInput = screen.getByLabelText(/W1 Strat weight/i) as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: "1.5" } });

    // An inline error must appear explaining the clamping.
    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(alert.textContent).toMatch(/clamped to 1/i);
  });

  // -------------------------------------------------------------------------
  // NEW-C18-05 regression — per-row size gate: a voluntary_add with weight=0
  // (positive AUM, non-zero scenarioAum) must be refused with a named error.
  // Before this fix, a weight-0 add passed the global AUM>0 guard and committed
  // size_at_decision_usd:0, causing a division-by-zero in the daily-delta cron.
  // -------------------------------------------------------------------------
  it("NEW-C18-05: voluntary_add with weight=0 and positive AUM → named error, no commit", () => {
    // Payload with live holdings so scenarioAum > 0.
    const payload = makePayload();

    // Capture the StrategyBrowseDrawer onAdd callback to simulate adding a strategy.
    let capturedOnAdd: ((s: unknown) => void) | null = null;
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      capturedOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const onCommitRequested = vi.fn();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        useInternalCommitDrawer={false}
        onCommitRequested={onCommitRequested}
      />,
    );

    // Open Browse and add a strategy — default weight starts at 0.
    fireEvent.click(screen.getByRole("button", { name: /^Browse strategies$/i }));
    act(() => {
      capturedOnAdd!({
        id: "strat-zero-weight",
        name: "Zero Weight Strategy",
        markets: ["binance"],
        strategy_types: ["momentum"],
      });
    });

    // Explicitly set the added strategy weight to 0. The initial add via
    // the browse drawer distributes weights equally (non-zero), so we must
    // explicitly zero-out the strategy's weight to trigger the per-row gate.
    // The weight input's label is "{strategy.name} weight" (ScenarioComposer.tsx:1203-1204).
    const addedInput = screen.getByLabelText(/Zero Weight Strategy weight/i) as HTMLInputElement;
    fireEvent.change(addedInput, { target: { value: "0" } });

    // Now attempt commit — with weight=0 the per-row size gate should fire.
    fireEvent.click(screen.getByTestId("scenario-footer-commit"));

    // The commit must be refused with a named error referencing the strategy.
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((a) =>
        /zero allocation size|zero weight/i.test(a.textContent ?? ""),
      ),
    ).toBe(true);
    expect(onCommitRequested).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // NEW-C18-14 regression — synthetic-baseline disclosure label
  // When scenarioAum <= 0 the drawdown chart is scaled against a synthetic
  // $1 baseline. Before this fix, there was no visible marker so the allocator
  // could mistake an illustrative curve for one backed by real capital.
  // -------------------------------------------------------------------------
  it("NEW-C18-14: scenarioAum=0 renders synthetic-baseline disclosure text", () => {
    // Read-only-tokens model: holdings can't be toggled off, so scenarioAum=0 is
    // reached the only way left — no live holdings at all, plus an added strategy
    // (which moves the composer out of the empty-state branch into the body).
    const payload = makePayload({
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    addStrategy({
      id: "strat-zero-aum",
      name: "Zero AUM Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    // Disclosure must now be visible (no live capital → synthetic $1 baseline).
    expect(
      screen.getByText(/Illustrative shape only — no live capital connected/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // F-01 regression — empty diff guard is NOT silent
  //
  // Scenario: seed a draft whose fingerprint MATCHES the current holdings
  // (so the draft is loaded as-is, no fingerprint mismatch banner), but
  // includes an extra toggle-off entry for a holding NOT in holdingsSummary.
  // diffCount counts the stale toggle as 1 diff → button enabled.
  // handleCommit's holdingsSummary.find() skips the stale holding →
  // diffs.length===0 → F-01 guard fires.
  //
  // Before this fix: handleCommit returned silently with no user feedback.
  // After: it calls setCommitError so an alert appears.
  // -------------------------------------------------------------------------
  it("F-01: handleCommit with stale toggle (holding no longer in holdingsSummary) shows 'Nothing to commit' error", () => {
    const payload = makePayload();
    const STALE_REF = "holding:kraken:DOT:spot"; // NOT in holdingsSummary

    // Fingerprint for makePayload()'s holdingsSummary [BTC, ETH, SOL]:
    // sorted("BTC:binance:spot", "ETH:binance:spot", "SOL:binance:spot")
    const MATCHING_FP = "BTC:binance:spot|ETH:binance:spot|SOL:binance:spot";

    lsStore.set(
      `allocations.scenario_v0_15.${ALLOCATOR_A}`,
      JSON.stringify({
        schema_version: 2,
        // Correct fingerprint → draft is loaded, no mismatch banner.
        init_holdings_fingerprint: MATCHING_FP,
        toggleByScopeRef: {
          [REF_BTC]: true,
          [REF_ETH]: true,
          [REF_SOL]: true,
          // Extra stale entry toggled off — not in holdingsSummary.
          // diffCount will count this as 1 diff, enabling the button.
          [STALE_REF]: false,
        },
        addedStrategies: [],
        // Value-proportional defaults for makePayload() holdings (total=100k):
        //   BTC=60k→0.6, ETH=30k→0.3, SOL=10k→0.1
        // handleCommit's voluntary_modify loop computes the same defaults and
        // compares per-row; matching weights → no voluntary_modify diffs.
        weightOverrides: {
          [REF_BTC]: 0.6,
          [REF_ETH]: 0.3,
          [REF_SOL]: 0.1,
        },
        lastEditedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const onCommitRequested = vi.fn();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        useInternalCommitDrawer={false}
        onCommitRequested={onCommitRequested}
      />,
    );

    // No fingerprint mismatch banner (fingerprint matches).
    expect(
      screen.queryByText(/Your live holdings have changed/i),
    ).toBeNull();

    // Footer Commit must be enabled (diffCount=1 from the stale toggle).
    const commitBtn = screen.getByTestId("scenario-footer-commit") as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(false);

    act(() => {
      fireEvent.click(commitBtn);
    });

    // F-01: error banner must appear (not a silent return).
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((a) => /Nothing to commit/i.test(a.textContent ?? "")),
    ).toBe(true);
    // onCommitRequested must NOT be called (no diffs to hand off).
    expect(onCommitRequested).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (Removed) F-02 — voluntary_modify zero-size gate. The read-only-tokens
  // model dropped the holding voluntary_modify path entirely (live holdings are
  // fixed context and can't be reweighted), so the zero-value-holding modify
  // hazard it guarded against no longer exists. The remaining zero-size gate on
  // voluntary_add is still covered by NEW-C18-05.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // IMP-3 regression — commitError clears unconditionally on weight <= 1
  // Before this fix: after a >1 paste the state layer clamped to 1.0 and
  // fired handleWeightChange(ref, 1.0). With `else if (commitError)`, the
  // stale "clamped" error stuck until another input event.
  // -------------------------------------------------------------------------
  it("IMP-3: clamped-error is cleared when a valid (<=1) weight is subsequently entered", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Read-only-tokens model: weight inputs live on added-strategy rows.
    addStrategy({
      id: "strat-imp3",
      name: "IMP3 Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    const wInput = screen.getByLabelText(/IMP3 Strat weight/i) as HTMLInputElement;

    // Trigger the >1 error.
    fireEvent.change(wInput, { target: { value: "1.5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/clamped to 1/i);

    // Enter a valid weight — error must disappear.
    fireEvent.change(wInput, { target: { value: "0.5" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // H-0133 (P1 blocker) + R4 leverage — the projection must reflect the draft's
  // weight AND leverage edits, not just the commit diff. These drive the REAL
  // computeScenario (adapter mocked to real series, like H-0487 above) so a
  // regression that re-severs the call-site wiring fails here, not silently.
  // -------------------------------------------------------------------------
  function mkRealStrat(
    id: string,
    returns: Array<{ date: string; value: number }>,
  ) {
    return {
      id,
      name: id,
      codename: null,
      disclosure_tier: "public",
      strategy_types: [] as string[],
      markets: [] as string[],
      start_date: returns[0].date,
      daily_returns: returns,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    };
  }
  // Read-only-tokens model: weight + leverage + toggle live ONLY on added
  // strategies. To drive the projection from the UI we mock the adapter to
  // return one fixed live holding (REF_BTC) plus one added strategy (STRAT_A);
  // the test adds STRAT_A so its weight/leverage/toggle inputs render and feed
  // projectionState. Two distinct series → a real pairwise correlation exists
  // (so the toggle-off-collapses-to-null isolator works).
  const STRAT_A = "strat-proj-a";
  function mockHoldingPlusStrategy() {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const btc = dates.map((date, i) => ({
      date,
      value: [0.02, -0.01, 0.03, -0.02, 0.01][i % 5],
    }));
    const strat = dates.map((date, i) => ({
      date,
      value: [-0.01, 0.005, -0.02][i % 3],
    }));
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [mkRealStrat(REF_BTC, btc), mkRealStrat(STRAT_A, strat)],
      state: {
        selected: { [REF_BTC]: true, [STRAT_A]: true },
        weights: { [REF_BTC]: 0.5, [STRAT_A]: 0.5 },
        startDates: {},
      },
    });
  }
  /** Add STRAT_A so its row (weight + leverage + toggle inputs) renders. */
  function addStratA() {
    addStrategy({
      id: STRAT_A,
      name: "Strat A",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
  }
  const lastScenarioMetrics = () => {
    const calls = vi.mocked(KpiStrip).mock.calls;
    return calls[calls.length - 1][0].scenarioMetrics;
  };

  // Phase 21 CORR-01/02/03 + IMPACT helper — mock the scenario-adapter to return
  // TWO active de-aliased strategies sharing 12 overlapping days (above the
  // <10-day correlation gate, below the 60-day distributional floor). Re-added
  // after the #507 merge dropped it (the merge took #507's top-of-file region).
  function mockTwoStrategies() {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const btc = dates.map((date, i) => ({
      date,
      value: [0.02, -0.01, 0.03, -0.02, 0.01][i % 5],
    }));
    const eth = dates.map((date, i) => ({
      date,
      value: [-0.01, 0.005, -0.02][i % 3],
    }));
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [mkRealStrat(REF_BTC, btc), mkRealStrat(REF_ETH, eth)],
      state: {
        selected: { [REF_BTC]: true, [REF_ETH]: true },
        weights: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
        startDates: {},
      },
    });
  }

  it("H-0133 — moving a weight slider MOVES the projection (reweighting changes scenarioMetrics, not just the commit diff)", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    const beforeTwr = lastScenarioMetrics()?.twr;
    // Re-weight the strategy to 90% — the blend must shift toward its profile.
    const input = document.getElementById(
      `weight-${STRAT_A}`,
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.change(input, { target: { value: "0.9" } });
    });
    const afterTwr = lastScenarioMetrics()?.twr;
    expect(afterTwr).not.toBe(beforeTwr);
  });

  it("R4 — a per-strategy leverage edit reaches the projection (2× changes vol) and surfaces the caveat", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    const beforeVol = lastScenarioMetrics()?.volatility;
    // Caveat hidden until a non-default multiplier is applied.
    expect(screen.queryByTestId("scenario-leverage-caveat")).toBeNull();
    const lev = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    expect(lev).not.toBeNull();
    act(() => {
      fireEvent.change(lev, { target: { value: "2" } });
    });
    expect(lastScenarioMetrics()?.volatility).not.toBe(beforeVol);
    expect(
      screen.getByTestId("scenario-leverage-caveat"),
    ).toBeInTheDocument();
  });

  it("R4 — leverage clamps LOUDLY: a >MAX paste surfaces an error (never silently swallowed)", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    const lev = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(lev, { target: { value: "999" } });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/clamped to 10/i);
  });

  it("R3 guard — the projection renders NO peer/allocator/comparator factsheet panels (no false precision on a hypothetical blend)", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Positive control: the projection DID render its KPI surface.
    expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument();
    // Phase 30 — the guard must run WITH the new blend-graph panels mounted, so
    // a future regression that wires a peer/percentile panel ALONGSIDE them is
    // still caught (not a vacuous pass on an unmounted surface). Assert both new
    // Cards ARE present on the projection here.
    expect(
      document.querySelector('[data-panel="blend-returns-distribution"]'),
      "the Returns-distribution Card must be mounted so the R3 guard runs with the new surface present",
    ).not.toBeNull();
    expect(
      document.querySelector('[data-panel="blend-rolling"]'),
      "the Rolling-metrics Card must be mounted so the R3 guard runs with the new surface present",
    ).not.toBeNull();
    // The hazard: FactsheetBody's api-only panels (peer percentile, allocator
    // blends, returns signatures) peer-rank a blend that doesn't exist — a
    // no-invented-data violation. The composer builds from scenarioMetrics +
    // KpiStrip, NEVER FactsheetBody / buildAllocatorPortfolioFactsheetPayload
    // (which hardcodes ingestSource:"api"), so these are structurally absent.
    // A future Impact view that wires FactsheetBody into the projection trips
    // this guard. (The payload/type-level ingestSource gate — api shows / csv
    // suppresses — is pinned in src/lib/factsheet/audit-c20.test.ts.)
    expect(document.getElementById("factsheet-allocator")).toBeNull();
    expect(document.getElementById("factsheet-signatures")).toBeNull();
    // IMPACT-02 — after FLOW-02 (Phase 32) retired the ScenarioBuilder Sandbox
    // and its honesty test, THIS is the SOLE peer-rank-suppression coverage in
    // the codebase. It is a verified superset of the deleted
    // ScenarioBuilder.honesty.test.tsx guard (it runs with the Phase-30 blend
    // panels mounted). Do not weaken it.
    // The ABSENT assertion for the peer badge keys on a UNIQUE
    // render-only data-testid, NOT queryByText(/percentile/i) (which matched
    // NOTHING because "percentile" lives only in PercentileRankBadge's title=
    // attribute — a vacuous pass) and NOT a visible label like "Sharpe" (which
    // collides with the honest KPI strip / MetricCards on this surface). If a
    // PercentileRankBadge is ever wired into the projection, this FAILS.
    expect(screen.queryByTestId("percentile-rank-badge")).toBeNull();
    expect(screen.queryByText(/ranked against peers/i)).toBeNull();

    // Positive control — prove the testid query is NON-VACUOUS. Render a real
    // PercentileRankBadge in isolation and assert the SAME query FINDS it. If
    // the testid were ever renamed/removed (silently breaking the ABSENT guard
    // above into a vacuous pass), this control fails loudly.
    cleanup();
    render(<PercentileRankBadge metric="sharpe" percentile={95} />);
    expect(screen.getByTestId("percentile-rank-badge")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Phase 30 (GRAPH-02/03/04) — blend-graph panel chrome on the composer.
  // Drives the REAL computeScenario via the adapter mock (like H-0133 above)
  // so the panels read genuine `portfolio_daily_returns`. The five leaf charts
  // are inert-mocked at module scope, so these assert the host's PANEL CHROME
  // (Card / heading / disclosure / honest empty branch / histogram prop), not
  // recharts internals.
  // -------------------------------------------------------------------------

  /**
   * Mock the adapter to return a single blended strategy with `nDays`
   * overlapping daily returns, so the engine emits a `portfolio_daily_returns`
   * of length `nDays`. Deterministic (no Math.random) — a sign-varying series
   * so the histogram + rolling-Sortino downside arms are non-degenerate.
   */
  function mockBlendSeries(nDays: number) {
    const start = new Date(2024, 0, 1).getTime();
    const series = Array.from({ length: nDays }, (_, i) => ({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      value: Math.sin(i / 7) * 0.01 + 0.0002,
    }));
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [mkRealStrat(REF_BTC, series)],
      state: {
        selected: { [REF_BTC]: true },
        weights: { [REF_BTC]: 1 },
        startDates: {},
      },
    });
  }

  it("blend panel empty branch — below the sample floor both panels render a role=status PartialDataBanner and NEVER role=alert", () => {
    // Default adapter mock returns zero strategies → portfolio_daily_returns is
    // empty (length 0 < 10), so BOTH panels hit their honest empty branch.
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The Card chrome + headings stay (heading-matches-body, #509): each panel
    // is present, and inside each the body is a role="status" banner.
    const distCard = document.querySelector(
      '[data-panel="blend-returns-distribution"]',
    );
    const rollCard = document.querySelector('[data-panel="blend-rolling"]');
    expect(distCard).not.toBeNull();
    expect(rollCard).not.toBeNull();
    expect(
      distCard!.querySelector('[role="status"]'),
      "below floor, the distribution panel body must be a role=status PartialDataBanner",
    ).not.toBeNull();
    expect(
      rollCard!.querySelector('[role="status"]'),
      "below floor, the rolling panel body must be a role=status PartialDataBanner",
    ).not.toBeNull();
    // Heading stays present even on the empty branch.
    expect(screen.getByText("Returns distribution")).toBeInTheDocument();
    expect(screen.getByText("Rolling metrics")).toBeInTheDocument();
    // The prescribed empty copy (UI-SPEC §Copywriting) is rendered.
    expect(
      screen.getByText(
        /at least 10 overlapping daily returns to chart its distribution/i,
      ),
    ).toBeInTheDocument();
    // CRITICAL honesty invariant: a derived-client panel has no fetch to fail,
    // so absence below the floor is NEVER an error. No role=alert anywhere in
    // either panel region. (Falsifiable: switching PartialDataBanner→a red
    // role=alert error state fails this assert.)
    expect(distCard!.querySelector('[role="alert"]')).toBeNull();
    expect(rollCard!.querySelector('[role="alert"]')).toBeNull();
  });

  it("blend panel disclosure — above floor each panel renders its own overlap-N + 'not a forecast' line, and the histogram is fed the CUMULATIVE-wealth series", () => {
    // 252 overlapping days clears every window floor (63/126/252) AND the
    // 10-point distribution floor, so both panels render their populated body.
    mockBlendSeries(252);
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // GRAPH-04 — each panel owns its disclosure. The page-level PROJECTED badge
    // is NOT sufficient. Both lines carry "overlapping" + "not a forecast".
    const overlapDisclosures = screen.getAllByText(/overlapping/i);
    expect(overlapDisclosures.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/not a forecast/i).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      screen.getByText(/historical realized · not a forecast/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/252-day annualized/i),
    ).toBeInTheDocument();
    // The leaf charts mounted (populated body, not the empty banner).
    expect(screen.getByTestId("return-histogram-mock")).toBeInTheDocument();
    expect(screen.getByTestId("return-quantiles-mock")).toBeInTheDocument();
    expect(screen.getByTestId("rolling-metrics-mock")).toBeInTheDocument();
    expect(screen.getByTestId("rolling-vol-mock")).toBeInTheDocument();
    expect(screen.getByTestId("rolling-sortino-mock")).toBeInTheDocument();
    // Pitfall 1 — ReturnHistogram derives daily returns internally from a
    // CUMULATIVE series. Assert it received the cumprod-wealth series (first
    // point ≈ 1 + r[0]), NOT the raw daily returns (which start near 0). If a
    // future edit feeds raw daily returns, value[0] would be ~0.0002 and this
    // fails loudly.
    const histProps = vi.mocked(ReturnHistogram).mock.calls[0][0];
    expect(histProps.returns.length).toBe(252);
    const firstWealth = histProps.returns[0].value;
    expect(firstWealth).toBeGreaterThan(0.9);
    expect(firstWealth).toBeLessThan(1.1);
    // bins contract held verbatim.
    expect(histProps.bins).toBe(20);
  });

  it("blend rolling panel — selecting 12M when history is below 252 swaps the body to the role=status per-window empty banner (never role=alert)", () => {
    // 126 days: the 6M (126) default renders, but 12M (252) is below floor.
    // The 12M toggle option is disabled; the panel body for the default window
    // renders. Assert the panel mounts with no role=alert regardless of window.
    mockBlendSeries(126);
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const rollCard = document.querySelector('[data-panel="blend-rolling"]');
    expect(rollCard).not.toBeNull();
    // 6M (126) clears the floor → populated body, real disclosure.
    expect(screen.getByTestId("rolling-metrics-mock")).toBeInTheDocument();
    expect(screen.getByText(/126-day rolling window/i)).toBeInTheDocument();
    // 12M is below the 252 floor → its toggle option is disabled (aria-disabled).
    const twelveM = screen.getByText("12M").closest("button");
    expect(twelveM).not.toBeNull();
    expect(twelveM!.getAttribute("aria-disabled")).toBe("true");
    // Honest-neutral: never role=alert in the rolling panel.
    expect(rollCard!.querySelector('[role="alert"]')).toBeNull();
  });

  it("WR-02 — distribution panel gates on the adapter's degenerate verdict, not a re-derived length<10: a ≥10-length series the adapter collapses shows the honest role=status banner, NOT a headed-but-empty body", () => {
    // The composer's distribution gate USED to read `portfolioDaily.length < 10`,
    // a heuristic that DIVERGES from the adapter's actual emptiness signal. The
    // adapter (buildBlendPanels) collapses EVERY series — including
    // histogramSeries/quantiles — on the STRICTER `hasNonFinite || length <
    // MIN_USABLE || length < window`. So a series with length in [10, window)
    // makes the adapter return histogramSeries=[] / quantiles={} while the old
    // gate (10 ≤ length) took the POPULATED branch: two empty sub-headings + a
    // "{n} overlapping daily returns" disclosure with NO "Awaiting more data"
    // banner — the opposite of the honest-empty contract.
    //
    // 50 days clears the 10-point distribution floor but is BELOW the default
    // 126-day (6M) rolling window, so buildBlendPanels collapses to []/{}. The
    // distribution panel must still show the role=status banner (it keys off the
    // adapter), not a broken populated body. Falsifiable: revert the gate back to
    // `portfolioDaily.length < 10` and the populated branch renders (the
    // sub-headings + leaf mocks appear, the banner does not) — this fails.
    mockBlendSeries(50);
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const distCard = document.querySelector(
      '[data-panel="blend-returns-distribution"]',
    );
    expect(distCard).not.toBeNull();
    // Heading stays (heading-matches-body), but the BODY must be the honest banner.
    expect(screen.getByText("Returns distribution")).toBeInTheDocument();
    expect(
      distCard!.querySelector('[role="status"]'),
      "a ≥10-length series the adapter collapsed must render the role=status banner, not a populated body",
    ).not.toBeNull();
    expect(
      screen.getByText(
        /at least 10 overlapping daily returns to chart its distribution/i,
      ),
    ).toBeInTheDocument();
    // The populated body MUST NOT render: no histogram/quantile leaf mounts and
    // no "Return histogram" / "Return quantiles" sub-headings inside the card.
    expect(distCard!.querySelector('[data-testid="return-histogram-mock"]')).toBeNull();
    expect(distCard!.querySelector('[data-testid="return-quantiles-mock"]')).toBeNull();
    expect(within(distCard as HTMLElement).queryByText("Return histogram")).toBeNull();
    expect(within(distCard as HTMLElement).queryByText("Return quantiles")).toBeNull();
    // Honest-neutral: a derived-client panel never errors on absence.
    expect(distCard!.querySelector('[role="alert"]')).toBeNull();
  });

  it("no factsheet import on the blend path — ScenarioComposer source imports no FactsheetBody/MetricsColumn/payload-builder and contains no api-ingest literal (static guard, T-30-05)", () => {
    // Non-vacuous: reads the REAL .tsx source off disk (not the bundled/mocked
    // module). The forbidden api-only peer path would land structurally here, so
    // the guard FAILS LOUD if any of these strings are reintroduced — even in a
    // comment. (This is why the source comments avoid the literal token spelling.)
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "ScenarioComposer.tsx"), "utf8");
    // Positive control — prove the read is real (the file IS the composer).
    expect(source).toMatch(/buildBlendPanels/);
    expect(source).not.toMatch(
      /FactsheetBody|MetricsColumn|buildAllocatorPortfolioFactsheetPayload/,
    );
    expect(source).not.toMatch(/ingestSource:\s*["']api["']/);
    // Belt-and-suspenders: no per-strategy *Panel.tsx wrapper or PercentileRankBadge.
    expect(source).not.toMatch(/PercentileRankBadge/);
    expect(source).not.toMatch(/from\s+["']@\/components\/strategy-v2\/\w+Panel["']/);
  });

  it("H-0133 regression — toggling a REAL strategy OFF removes it from the active set (the explicit-toggle arm, isolated from weight rescaling)", () => {
    // Pre-H-0133 the projection read adapterOutput.state directly, so a toggle
    // only ever moved the COMMIT diff — the live metrics ignored it. The fix
    // routes `selected` through the toggle map, so dropping a leg must actually
    // EXCLUDE it from computeScenario's activeStrategies. A plain "twr changed"
    // assertion is NOT a valid discriminator: toggleHolding PRESERVES the off-
    // row's weight and rescales the OTHER rows, so the curve moves even if the
    // toggled leg stays selected. The clean isolator is the correlation: with
    // both legs active there is one off-diagonal pair (avg_pairwise_correlation
    // is a number); once ETH is genuinely excluded only BTC is active, there are
    // no pairs, so avg_pairwise_correlation collapses to null. If the memo's
    // `toggle === undefined ? … : toggle` FALSE arm were re-severed, ETH would
    // stay in the active set and this would remain a number.
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    // Positive control: two active legs (BTC holding + Strat A) → a real
    // pairwise correlation exists.
    expect(typeof lastScenarioMetrics()?.avg_pairwise_correlation).toBe("number");
    act(() => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: /Toggle Strat A on\/off in scenario/i,
        }),
      );
    });
    // Strat A dropped from the active set → only BTC remains → no pairs → null.
    expect(lastScenarioMetrics()?.avg_pairwise_correlation).toBeNull();
  });

  it("R4 — a NEGATIVE leverage clamps LOUDLY to 0 (shorting isn't modeled — never silently swallowed)", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    const lev = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(lev, { target: { value: "-3" } });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/negative/i);
  });

  it("R4 — a non-finite leverage paste surfaces an inline error and KEEPS the prior value (fail-loud, no silent drop)", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();
    const lev = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    // jsdom sanitizes a non-numeric `<input type=number>` value to "" before
    // React reads it (Number("") = 0 → happy path), so force a non-finite
    // value through the controlled-input bridge by patching the value getter —
    // mirrors the non-finite WEIGHT test above.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    Object.defineProperty(lev, "value", {
      configurable: true,
      get: () => "Infinity",
    });
    act(() => {
      fireEvent.change(lev);
    });
    expect(screen.getByTestId("scenario-commit-error").textContent).toMatch(
      /invalid leverage/i,
    );
    // Restore the native getter so the read-back reflects React's controlled
    // value (not the patched "Infinity"): the rejected paste left the displayed
    // multiplier untouched at the 1× default.
    if (originalDescriptor) {
      Object.defineProperty(lev, "value", originalDescriptor);
    }
    expect(lev.value).toBe("1");
  });

  // -------------------------------------------------------------------------
  // CORR-01 / CORR-03 — own-book composer mounts the CorrelationHeatmap with
  // de-aliased labels and a single-sourced Avg |ρ| value. The real
  // CorrelationHeatmap is NOT mocked here, so these assertions exercise the
  // genuine presentational component fed by the composer's scenarioMetrics.
  // -------------------------------------------------------------------------
  it("CORR-01 — with ≥2 active de-aliased strategies (≥10 overlapping days) the composer renders the heatmap with de-aliased axis labels", () => {
    mockTwoStrategies();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The de-aliased strategy names (REF_BTC / REF_ETH = the holding scopeRefs,
    // which mkRealStrat sets as both id AND name) appear as heatmap axis labels.
    // Each name renders twice (column header + row header), so use getAllByText.
    expect(screen.getAllByText(REF_BTC).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(REF_ETH).length).toBeGreaterThanOrEqual(2);
    // The heatmap figure is present (the real component's role="figure" wrapper).
    expect(
      screen.getByRole("figure", { name: /Pairwise correlation heatmap/i }),
    ).toBeInTheDocument();
    // Sanity: two active legs → a real pairwise correlation exists (not the
    // empty-state branch).
    expect(typeof lastScenarioMetrics()?.avg_pairwise_correlation).toBe("number");
  });

  it("CORR-02 — with <2 active strategies the composer heatmap renders the honest empty state, never a 1×1 grid", () => {
    // Default adapter mock returns ZERO strategies → scenarioMetrics.correlation_matrix
    // is null → the heatmap delegates to its reason-routed empty state. With <2
    // strategies the honest heading names the STRATEGY-COUNT reason, not overlap
    // (v0.24.15.139 fix: the heading must match its body, not contradict it).
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText("Not enough strategies to correlate"),
    ).toBeInTheDocument();
    // No degenerate grid: the figure (which only renders for ≥2 strategies) is absent.
    expect(screen.queryByRole("figure", { name: /Pairwise correlation heatmap/i }))
      .toBeNull();
  });

  it("CORR-03 — the heatmap caption Avg |ρ| value is single-sourced: it equals scenarioMetrics.avg_pairwise_correlation passed to KpiStrip (no second average)", () => {
    mockTwoStrategies();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The exact value the composer fed to KpiStrip (the single source of truth).
    const stripValue = lastScenarioMetrics()?.avg_pairwise_correlation;
    expect(typeof stripValue).toBe("number");
    const expected = (stripValue as number).toFixed(2);
    // The heatmap caption renders that SAME value (2dp), not a self-computed one.
    // "Avg |ρ|" text only exists in the heatmap caption here (KpiStrip is mocked).
    const caption = screen.getByText("Avg |ρ|").closest("div");
    expect(caption?.textContent?.replace(/\s+/g, " ")).toContain(
      `Avg |ρ| ${expected}`,
    );
  });

  // -------------------------------------------------------------------------
  // IMPACT-01 — persistent PROJECTED honesty badge + coverage caveat. The
  // badge is always visible (not a tooltip) and uses the neutral-outline token,
  // NOT bg-accent / warning / role="alert" / <Badge>. The caveat names the live
  // N + the shortest-history strategy via shortestHistoryName.
  // -------------------------------------------------------------------------
  it("IMPACT-01 — the composer renders the PROJECTED badge unconditionally (even with no leverage applied)", () => {
    // No mockTwoStrategies → default adapter (no strategies, no leverage).
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Leverage caveat is absent (nothing levered) — proves the PROJECTED badge
    // is NOT gated on leverage.
    expect(screen.queryByTestId("scenario-leverage-caveat")).toBeNull();
    const badge = screen.getByTestId("scenario-projected-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe(
      "PROJECTED — hypothetical, not your live book",
    );
  });

  it("IMPACT-01 — the PROJECTED badge is a neutral-outline pill (border-text-muted/text-text-muted), NOT bg-accent / warning / role=alert / <Badge>", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const badge = screen.getByTestId("scenario-projected-badge");
    // Neutral outline tokens present.
    expect(badge.className).toContain("border-text-muted");
    expect(badge.className).toContain("text-text-muted");
    // Wrong signals absent: no accent fill, no warning amber, no alert role.
    expect(badge.className).not.toContain("bg-accent");
    expect(badge.className).not.toMatch(/warning|amber/);
    expect(badge.getAttribute("role")).not.toBe("alert");
    // It is a plain <span> pill, not the filled <Badge> primitive (which
    // carries a fill + a distinct class signature).
    expect(badge.tagName.toLowerCase()).toBe("span");
  });

  it("IMPACT-01 — the coverage caveat names the live N overlapping days AND the shortest-history strategy name", () => {
    mockTwoStrategies();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const caveat = screen.getByTestId("scenario-coverage-caveat");
    const n = lastScenarioMetrics()?.n;
    expect(typeof n).toBe("number");
    const text = caveat.textContent?.replace(/\s+/g, " ").trim() ?? "";
    // HONEST-01 — the canonical methodology line names the ACTUAL method
    // ("Historical realized"), the live N overlapping days, and the honest
    // horizon ("not a forecast"), middot-separated, folded into the one caveat.
    expect(text).toContain("Historical realized");
    expect(text).toContain("not a forecast");
    // Live N (not a hardcoded number) from scenarioMetrics.n, in the canonical
    // middot-separated form.
    expect(text).toContain(`Historical realized · ${n} overlapping days · not a forecast`);
    // The shortest-history strategy name (REF_BTC/REF_ETH share window length
    // 12, so first-by-input-order REF_BTC wins the deterministic tiebreak).
    expect(text).toContain(`Shortest history: ${REF_BTC}.`);
  });

  // -------------------------------------------------------------------------
  // BENCH-01 overlay wiring — RUNTIME pin (not a static grep).
  //
  // The overlay (`EquityChart.benchmark={btcWealth}`) was previously pinned
  // ONLY by static grep: a bad rewire (wrong prop, or raw daily returns
  // instead of cumulative-WEALTH form) would pass the whole vitest suite.
  // This drives the real mount-effect fetch to resolve with a BTC daily-
  // returns series and asserts EquityChart actually RECEIVES the benchmark
  // prop, in cumulative-WEALTH form (~1.0 base), via mock.calls — mirroring
  // the wealth-form assertion pattern in T_C19 / M-0096 above.
  // -------------------------------------------------------------------------
  it("BENCH-01 EquityChart.benchmark is wired in cumulative-WEALTH form (~1.0 base) once the fetch resolves", async () => {
    // Raw BTC daily returns the /api/benchmark/btc route would return. The
    // composer derives btcWealth = computeStrategyCurve(these) → ~1.0-base
    // wealth curve, and passes it as EquityChart.benchmark (showBenchmark
    // defaults to true, so the toggle is on).
    const btcDailyReturns = [
      { date: "2024-01-02", value: 0.01 },
      { date: "2024-01-03", value: -0.008 },
      { date: "2024-01-04", value: 0.012 },
    ];
    const fetchStub = vi.fn(async () => ({
      ok: true,
      json: async () => btcDailyReturns,
    }));
    vi.stubGlobal("fetch", fetchStub);

    try {
      const payload = makePayload();
      render(
        <ScenarioComposer
          payload={payload}
          allocatorId={ALLOCATOR_A}
          allocatorMandate={null}
        />,
      );

      // The benchmark fetch fires on mount; wait until EquityChart has been
      // re-rendered with a defined `benchmark` prop (the post-resolve render).
      await waitFor(() => {
        expect(fetchStub).toHaveBeenCalledWith("/api/benchmark/btc");
        const calls = vi.mocked(EquityChart).mock.calls;
        const withBenchmark = calls.find(
          (c) => (c[0] as { benchmark?: unknown }).benchmark !== undefined,
        );
        expect(withBenchmark).toBeTruthy();
      });

      const calls = vi.mocked(EquityChart).mock.calls;
      const last = calls[calls.length - 1][0] as {
        benchmark?: Array<{ date: string; value: number }>;
      };
      // Defined (toggle on + series available) — NOT undefined/raw returns.
      expect(last.benchmark).toBeDefined();
      const benchmark = last.benchmark ?? [];
      expect(benchmark.length).toBe(btcDailyReturns.length);

      // Cumulative-WEALTH form (~1.0 base), NOT raw daily returns (~0.0). A
      // rewire passing the raw returns would fail this (values ≈ 0.01).
      // First point = 1·(1+0.01) = 1.01.
      expect(benchmark[0].value).toBeCloseTo(1.01, 6);
      for (const pt of benchmark) {
        expect(pt.value).toBeGreaterThan(0.5);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // -------------------------------------------------------------------------
  // LAYOUT-02 (Phase 31 / Pitfall 5) — collapsing the composition controls
  // PRESERVES in-progress weight + leverage edits, and the projection behind
  // the collapsed panel STILL reflects them. This is the load-bearing
  // hide-don't-unmount gate: CompositionList is wrapped in the lifted
  // CollapsibleSection (native <details id="composer-composition-controls">),
  // so collapse HIDES it but never unmounts it, and the edit state lives in the
  // parent ScenarioComposer (leverageByRef + scenario.draft.weightOverrides),
  // ABOVE the collapsible boundary. A naive `{open && <CompositionList />}`
  // would wipe the edits on collapse — this test fails on that regression.
  //
  // NON-VACUITY: a default-state collapse proves nothing (the inputs already
  // hold their defaults). So we type a NON-DEFAULT weight (0.250 ≠ the 0.000
  // default) AND a NON-DEFAULT leverage (2 ≠ the 1× default) FIRST, assert the
  // projection MOVED off its pre-edit baseline (the edit is real), THEN collapse
  // + expand and assert (a) both inputs still show the edited values and (b) the
  // projection still reflects the edited composition (unchanged from the
  // post-edit capture — never reverted to the default-weight projection).
  // -------------------------------------------------------------------------
  it("LAYOUT-02 collapsing the composition controls preserves in-progress weight + leverage edits and the projection still reflects them", () => {
    mockHoldingPlusStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStratA();

    // --- Baseline (default composition: weight 0.000, leverage 1×) -----------
    const baselineMetrics = lastScenarioMetrics();
    const baselineTwr = baselineMetrics?.twr;
    const baselineVol = baselineMetrics?.volatility;

    const weightInput = document.getElementById(
      `weight-${STRAT_A}`,
    ) as HTMLInputElement;
    const leverageInput = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    expect(weightInput).not.toBeNull();
    expect(leverageInput).not.toBeNull();
    // Capture the pre-edit input values so the edits below are provably
    // NON-DEFAULT (the seeded adapter weight is 0.500 and leverage defaults to
    // 1×; we edit to values distinct from both). Leverage starts at the 1×
    // default (ephemeral leverageByRef has no entry for the added row yet).
    const weightBefore = weightInput.value;
    expect(leverageInput.value).toBe("1");

    // --- Edit: a NON-DEFAULT weight AND a NON-DEFAULT leverage ---------------
    act(() => {
      fireEvent.change(weightInput, { target: { value: "0.25" } });
    });
    act(() => {
      fireEvent.change(leverageInput, { target: { value: "2" } });
    });
    // The controlled inputs reflect the edits (weight rounds to 3dp), and both
    // are genuinely NON-DEFAULT (distinct from the pre-edit values).
    expect(weightInput.value).toBe("0.250");
    expect(weightInput.value).not.toBe(weightBefore);
    expect(leverageInput.value).toBe("2");

    // Capture the post-edit projection signal and prove it MOVED off baseline
    // (non-vacuity — the edits actually reached the blend, so "survives" means
    // something). The weight reweight shifts the blend's TWR; the 2× leverage
    // shifts its volatility.
    const editedMetrics = lastScenarioMetrics();
    const editedTwr = editedMetrics?.twr;
    const editedVol = editedMetrics?.volatility;
    expect(editedTwr).not.toBe(baselineTwr);
    expect(editedVol).not.toBe(baselineVol);

    // --- Collapse the controls (toggle the <details> closed) -----------------
    const detailsEl = () =>
      document.getElementById(
        "composer-composition-controls",
      ) as HTMLDetailsElement;
    expect(detailsEl()).not.toBeNull();
    // The wrapper is a native <details> (not a `{open && ...}` conditional), so
    // the controls are still in the DOM while collapsed — the load-bearing
    // hide-don't-unmount fact.
    expect(detailsEl().tagName).toBe("DETAILS");
    act(() => {
      detailsEl().open = false;
      fireEvent(detailsEl(), new Event("toggle"));
    });
    // CompositionList stays MOUNTED while collapsed — its inputs are still
    // queryable (a conditional unmount would make these null).
    expect(document.getElementById(`weight-${STRAT_A}`)).not.toBeNull();
    expect(document.getElementById(`leverage-${STRAT_A}`)).not.toBeNull();

    // While collapsed, the projection behind the hidden panel STILL reflects the
    // edited composition (it never reverted to the default-weight projection).
    const collapsedMetrics = lastScenarioMetrics();
    expect(collapsedMetrics?.twr).toBe(editedTwr);
    expect(collapsedMetrics?.volatility).toBe(editedVol);

    // --- Re-expand the controls ----------------------------------------------
    act(() => {
      detailsEl().open = true;
      fireEvent(detailsEl(), new Event("toggle"));
    });

    // SURVIVAL: after expand, the SAME inputs still show the non-default edits —
    // no reset to defaults (the parent-held state survived collapse→expand).
    const weightAfter = document.getElementById(
      `weight-${STRAT_A}`,
    ) as HTMLInputElement;
    const leverageAfter = document.getElementById(
      `leverage-${STRAT_A}`,
    ) as HTMLInputElement;
    expect(weightAfter.value).toBe("0.250");
    expect(leverageAfter.value).toBe("2");

    // And the projection STILL reflects the edited composition after expand
    // (LAYOUT-02 — the blend behind the panel never lost the edits).
    const afterMetrics = lastScenarioMetrics();
    expect(afterMetrics?.twr).toBe(editedTwr);
    expect(afterMetrics?.volatility).toBe(editedVol);
  });
});
