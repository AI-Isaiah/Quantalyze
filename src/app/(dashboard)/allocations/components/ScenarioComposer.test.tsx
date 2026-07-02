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
import { isoDayFromDate } from "@/lib/dateday";

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

// Phase 38-03 (PARITY-01): the composer's two chart call sites now render the
// factsheet-backed ScenarioFactsheetChart (equity + drawdown stacked under ONE
// provider) instead of the legacy EquityChart + DrawdownChart. Mocked here so
// the composer's prop wiring (equityDailyPoints / scenarioSeries / benchmark /
// scenarioDailyPoints) is the unit-under-test. The mock keeps the equity +
// drawdown sub-testids so present-panel assertions still read the mount.
vi.mock("../widgets/performance/ScenarioFactsheetChart", () => ({
  ScenarioFactsheetChart: vi.fn(() => (
    <div data-testid="scenario-factsheet-chart-mock">
      <div data-testid="equity-chart-mock" />
      <div data-testid="drawdown-chart-mock" />
    </div>
  )),
}));

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
//
// Phase 37 / DSRC-03: ONLY `buildStrategyForBuilderSet` (the holdings path) is
// spied. The sibling `buildPerKeyStrategyForBuilderSet` is kept REAL via
// importOriginal so the per-source honesty tests drive the genuine per-key unit
// construction → frozen `computeScenario` recompute (computeScenario itself is
// never mocked). A spied per-key builder would defeat the load-bearing DSRC-03
// assertion that the KPI/curve NUMBERS move on exclusion.
vi.mock("../lib/scenario-adapter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/scenario-adapter")>();
  return {
    ...actual,
    buildStrategyForBuilderSet: vi.fn(() => ({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    })),
  };
});

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

// Phase 57 (WINDOW-*) — capturing CustomRangePicker mock. The composer mounts
// the REAL picker for the coverage-window control; here it is replaced by an
// inert spy that captures `onApply` (mirrors the browse-drawer capture pattern
// at :318) so a window test can drive an apply without piloting the real
// two-month calendar grid. It renders a testid div when open and records its
// min/max/initialRange props so the mount-bounds assertions can read them.
let pickerOnApply: ((r: { start: string; end: string }) => void) | null = null;
let lastPickerProps: {
  isOpen: boolean;
  min: Date;
  max: Date;
  initialRange?: { start: string; end: string } | null;
} | null = null;
// Phase 57 — engine-arg recorder. `@/lib/scenario` stays REAL (computeScenario
// still computes genuine metrics — the member_count oracle depends on it), but
// `computeScenario` is wrapped so each invocation's `state` arg is captured. The
// composed-branch call is the one whose strategies include the window fixtures;
// the "no window key when empty-intersection" assertion reads its state arg.
const computeScenarioStateArgs: Array<{
  strategyIds: string[];
  state: Record<string, unknown>;
}> = [];
vi.mock("@/lib/scenario", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scenario")>();
  return {
    ...actual,
    computeScenario: vi.fn(
      (
        strategies: Parameters<typeof actual.computeScenario>[0],
        state: Parameters<typeof actual.computeScenario>[1],
        cache: Parameters<typeof actual.computeScenario>[2],
      ) => {
        computeScenarioStateArgs.push({
          strategyIds: strategies.map((s) => s.id),
          state: state as unknown as Record<string, unknown>,
        });
        return actual.computeScenario(strategies, state, cache);
      },
    ),
  };
});

vi.mock("./CustomRangePicker", () => ({
  CustomRangePicker: vi.fn(
    (props: {
      isOpen: boolean;
      onClose: () => void;
      onApply: (r: { start: string; end: string }) => void;
      min: Date;
      max: Date;
      initialRange?: { start: string; end: string } | null;
    }) => {
      pickerOnApply = props.onApply;
      lastPickerProps = {
        isOpen: props.isOpen,
        min: props.min,
        max: props.max,
        initialRange: props.initialRange,
      };
      return props.isOpen ? (
        <div data-testid="custom-range-picker-mock" />
      ) : null;
    },
  ),
}));

// --- Imports after mocks --------------------------------------------------

import { ScenarioComposer } from "./ScenarioComposer";
// Real (un-mocked) — used to build a valid current-schema draft so the
// onRegisterOpen handler decodes "ok" in the WR-02 regression test below.
import { defaultDraftFromHoldings } from "../lib/scenario-state";
import { ScenarioFactsheetChart } from "../widgets/performance/ScenarioFactsheetChart";
import { KpiStrip } from "./KpiStrip";
import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";
import { buildStrategyForBuilderSet } from "../lib/scenario-adapter";
// Phase 37 / DSRC-03 — the REAL per-key builder + REAL engine for the independent
// two→one recompute oracle. The adapter mock keeps buildPerKeyStrategyForBuilderSet
// real via importOriginal, and @/lib/scenario + @/lib/scenario-dealias are never
// mocked, so these are the genuine functions (the same ones the composer runs).
import { buildPerKeyStrategyForBuilderSet } from "../lib/scenario-adapter";
import {
  computeScenario as realComputeScenario,
  buildDateMapCache as realBuildDateMapCache,
} from "@/lib/scenario";
import { collapseAliasedHoldingStrategies as realCollapse } from "@/lib/scenario-dealias";
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
    // Phase 37 / DSRC-01 — per-key channel additive fields. Default to no
    // per-key coverage (empty/false); per-key tests override these.
    perKeyReturnsByApiKeyId: {},
    perKeyDailiesGateSatisfied: false,
    eligibleApiKeyIds: [],
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
    pickerOnApply = null;
    lastPickerProps = null;
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
  // so the live curve must NOT render — only the (empty) scenario overlay.
  // Non-vacuous: book mode still passes the real baseline; switching to blank
  // must zero it. Without the gate this asserts RED (the chart would still
  // receive the 2-point live baseline).
  //
  // 38-03 (PARITY-01): the composer now feeds ScenarioFactsheetChart. The
  // `equityDailyPoints` blank-mode gate is preserved as a real prop on the new
  // component. The old `stale`/`lastSyncAt` sync-stamp props no longer flow to
  // the chart — the factsheet-backed mount renders NO sync stamp (the synth
  // csv-arm payload has no `computedAt`), so the H-1226 "stamp lies in blank
  // mode" failure mode is structurally impossible now (see the honesty test
  // below). This test pins the surviving baseline-leak gate.
  // -------------------------------------------------------------------------
  it("T_C3b Blank slate gates the live equity baseline out of the scenario chart", () => {
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

    // Book mode (default for an allocator with a live book): real baseline flows through.
    const bookProps = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0];
    expect(bookProps.equityDailyPoints).toHaveLength(2);

    // Switch to Blank slate — the live baseline must be gated out.
    fireEvent.click(screen.getByRole("radio", { name: /blank slate/i }));

    const calls = vi.mocked(ScenarioFactsheetChart).mock.calls;
    const blankProps = calls[calls.length - 1][0];
    expect(blankProps.equityDailyPoints).toEqual([]);
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
  // T_C4 — ScenarioFactsheetChart receives scenarioSeries
  // -------------------------------------------------------------------------
  it("T_C4 ScenarioFactsheetChart receives scenarioSeries (DailyPoint[])", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0];
    expect(Array.isArray(props.scenarioSeries)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B14 / NEW-C09-04 (H-1226) — the original lie: the legacy Scenario-tab
  // EquityChart rendered an inner sync-stamp header, so a synced allocator saw
  // "sync just now" / "no sync yet" unless the composer plumbed stale/lastSyncAt.
  //
  // 38-03 (PARITY-01) closes that failure mode STRUCTURALLY: the composer now
  // renders ScenarioFactsheetChart, which mounts the factsheet TimeSeriesChart +
  // MasterBrush off a synthesized csv-arm payload that carries NO sync stamp
  // (`computedAt: ""`) and renders NO header. There is no sync-stamp surface to
  // lie, so the composer no longer passes — and the chart no longer accepts —
  // stale/lastSyncAt. This pins that honest contract: the scenario chart receives
  // NEITHER sync prop, so a future refactor can't reintroduce a stamp lie.
  // -------------------------------------------------------------------------
  it("ScenarioFactsheetChart receives NO sync-stamp props — the Scenario-tab stamp lie is structurally gone (B14/H-1226)", () => {
    const lastSync = "2026-02-01T00:00:00.000Z";
    const payload = makePayload({ allKeysStale: true, lastSyncAt: lastSync });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    // No sync-stamp surface ⇒ no sync-stamp props. The chart renders the brush +
    // factsheet panels only; there is no header that could show a false stamp.
    expect(props.stale).toBeUndefined();
    expect(props.lastSyncAt).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T_C5 — ScenarioFactsheetChart receives the scenario wealth series. The
  // factsheet-backed mount renders equity + drawdown (stacked under one
  // provider) from the single scenario series — drawdowns are derived inside
  // the adapter, so the scenario wealth IS the chart's source of truth.
  // -------------------------------------------------------------------------
  it("T_C5 ScenarioFactsheetChart receives the scenario wealth series", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0];
    expect(Array.isArray(props.scenarioSeries)).toBe(true);
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

  // T_C14b — Escape dismisses the reset modal (keyboard parity with Cancel).
  // Regression guard for the CR-03 a11y fix (WCAG 2.1.2): the destructive
  // confirmation must be Escape-dismissable, and Escape must behave like
  // Cancel (keep the draft), never like Confirm (wipe it).
  it("T_C14b Escape on the reset modal closes it (keyboard dismissal) and KEEPS the draft", () => {
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    addStrategy({
      id: "strat-c14b",
      name: "C14b Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });
    fireEvent.click(screen.getByTestId("scenario-footer-reset"));
    // The destructive confirmation is open…
    const dialog = screen.getByRole("dialog");
    expect(
      screen.getByText(/Discard your scenario draft\?/i),
    ).toBeInTheDocument();
    // …and Escape dismisses it (the onKeyDown handler on the dialog).
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByText(/Discard your scenario draft\?/i),
    ).not.toBeInTheDocument();
    // Escape == Cancel: the draft is preserved (commit still enabled), NOT
    // wiped — an Escape that silently confirmed would be a data-loss
    // regression.
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
  it("T_C19 ScenarioFactsheetChart scenarioSeries values are wealth-form (>=0.95 — i.e. +1 conversion applied)", () => {
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
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0];
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
  it("M-0096 ScenarioFactsheetChart scenarioSeries is NON-EMPTY and wealth-form (+1 conversion genuinely exercised)", () => {
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
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0];
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
  // Phase 39 (PAYLOAD-01) — ScenarioFactsheetChart receives portfolioDaily in
  // daily-RETURN form (the engine's portfolio_daily_returns), the input the
  // adapter feeds to compute(). This is DISTINCT from scenarioSeries (wealth,
  // ~1.0). A rewire that accidentally passed the wealth series instead would
  // make the metrics garbage (~+100%/day) — pin it: portfolioDaily values are
  // returns-form (near 0, both signs), NOT wealth-form (>= 0.5).
  // -------------------------------------------------------------------------
  it("ScenarioFactsheetChart receives portfolioDaily = the engine's portfolio_daily_returns (daily-RETURN form, not wealth)", () => {
    // A sign-varying return series → the engine emits portfolio_daily_returns
    // with both positive and negative decimals (≈0), unambiguously distinct
    // from the cumulative-wealth scenarioSeries (≈1.0).
    const dates = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    );
    const strat = {
      id: "strat-real-rets",
      name: "Real Strategy",
      codename: null,
      disclosure_tier: "verified",
      strategy_types: ["momentum"],
      markets: ["binance"],
      start_date: "2026-01-01",
      daily_returns: dates.map((date, i) => ({
        date,
        value: i % 2 === 0 ? 0.01 : -0.006,
      })),
      cagr: 0.1,
      sharpe: 1.0,
      volatility: 0.1,
      max_drawdown: -0.02,
    };
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [strat],
      state: {
        selected: { "strat-real-rets": true },
        weights: { "strat-real-rets": 1 },
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
    expect(ScenarioFactsheetChart).toHaveBeenCalled();
    const props = vi.mocked(ScenarioFactsheetChart).mock.calls[0][0] as {
      portfolioDaily?: Array<{ date: string; value: number }>;
      scenarioSeries?: Array<{ date: string; value: number }>;
    };
    const daily = props.portfolioDaily ?? [];
    // Fail loud: a vacuous pass (empty array) would hide a broken wiring.
    expect(daily.length).toBeGreaterThan(0);
    // Returns-form: values are decimals near 0 with BOTH signs (the engine
    // blended a sign-varying series). NOT wealth-form (every value >= 0.5).
    for (const p of daily) {
      expect(Math.abs(p.value)).toBeLessThan(0.5);
    }
    expect(daily.some((p) => p.value > 0)).toBe(true);
    expect(daily.some((p) => p.value < 0)).toBe(true);
    // Cross-check the sibling wealth series IS wealth-form (~1.0), proving the
    // two props carry genuinely different data models (no wealth/returns mixup).
    const wealth = props.scenarioSeries ?? [];
    expect(wealth.length).toBeGreaterThan(0);
    for (const p of wealth) expect(p.value).toBeGreaterThan(0.5);
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

  it("CORR-02/03 — with <2 active strategies the Diversification section renders the honest 'add a second strategy' empty state, never a 1×1 grid", () => {
    // Default adapter mock returns ZERO strategies → diversification.clusterOrderIds
    // .length < 2 → the new CollapsibleSection body collapses to the EmptyStateCard
    // (Phase 41 CORR-03: the 0/1-constituent case is routed to "add a second
    // strategy" at the SECTION level, BEFORE the heatmap's own reason-routing —
    // this is the wrapped-in-place behavior, supersedes the prior heatmap-empty
    // assertion). The heatmap's strategy-count empty is now reachable only via the
    // n<10 path (covered by the CORR-03 short-overlap test below).
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText("Add a second strategy to see diversification"),
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
  // Phase 41 CORR-01..06 — the "Diversification" CollapsibleSection enhances the
  // own-book heatmap IN PLACE: a ρ≥0.85 too-similar badge, the cluster-reordered
  // matrix (de-aliased labels), the DR + ENB headline (formula disclosed), and the
  // descending per-constituent PCR list, with honest empties for 0/1-constituent
  // and n<10. The real diversification lib + CorrelationHeatmap are NOT mocked, so
  // these exercise the genuine end-to-end math (mirroring the un-mocked CORR-01
  // test above).
  // -------------------------------------------------------------------------

  // Three active de-aliased strategies sharing 12 overlapping days: BTC and ETH
  // move together (ρ≥0.85 → too-similar pair + adjacent in the cluster order),
  // SOL is near-orthogonal (the cluster outlier). Drives the REAL engine matrix.
  function mockThreeStrategies() {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    // BTC and ETH: ETH = BTC scaled + tiny jitter → strongly correlated (ρ≈1).
    const base = [0.02, -0.01, 0.03, -0.02, 0.015, -0.025, 0.01, -0.005, 0.02, -0.018, 0.012, -0.022];
    const btc = dates.map((date, i) => ({ date, value: base[i] }));
    const eth = dates.map((date, i) => ({ date, value: base[i] * 0.9 + 0.0005 }));
    // SOL: an independent zig-zag uncorrelated with `base`.
    const solSeries = [-0.01, 0.02, 0.005, -0.015, -0.02, 0.018, 0.022, -0.008, -0.012, 0.025, -0.004, 0.016];
    const sol = dates.map((date, i) => ({ date, value: solSeries[i] }));
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkRealStrat(REF_BTC, btc),
        mkRealStrat(REF_ETH, eth),
        mkRealStrat(REF_SOL, sol),
      ],
      state: {
        selected: { [REF_BTC]: true, [REF_ETH]: true, [REF_SOL]: true },
        weights: { [REF_BTC]: 0.4, [REF_ETH]: 0.3, [REF_SOL]: 0.3 },
        startDates: {},
      },
    });
  }

  it("CORR-02 — the DR + Effective-Bets headline renders real values (not 0.00) with the ENB formula disclosed", () => {
    mockTwoStrategies();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The headline labels + the disclosed formula are present.
    expect(screen.getByText("Diversification Ratio")).toBeInTheDocument();
    expect(screen.getByText("Effective Bets")).toBeInTheDocument();
    expect(screen.getByText("ENB = 1 / Σ PCRᵢ²")).toBeInTheDocument();
    // The interpretation line names the live constituent count (2) — proving the
    // values are computed from the real blend, not a placeholder.
    expect(
      screen.getByText(/effective bets? across 2 constituents/i),
    ).toBeInTheDocument();
  });

  it("CORR-02 — the ρ≥0.85 'too similar' badge renders when a pair crosses the threshold", () => {
    mockThreeStrategies();
    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_ETH, HOLDING_SOL],
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // BTC≈ETH → exactly one pair ≥0.85 → the aggregate amber badge appears.
    const badge = screen.getByText(/above the 0.85 similarity threshold/i);
    expect(badge).toBeInTheDocument();
    // Singular/plural is correct for one pair.
    expect(badge.textContent).toMatch(/^\s*1 pair above the 0.85 similarity threshold\s*$/);
    // Amber chip, NOT red (DESIGN.md: high-ρ is concentration-risk, not an error).
    expect(badge.className).toContain("text-warning");
    expect(badge.className).not.toMatch(/text-negative|bg-negative/);
  });

  it("CORR-02 — no too-similar badge when no pair reaches ρ≥0.85 (absence is the signal)", () => {
    // mockTwoStrategies: BTC vs ETH series are weakly/negatively correlated, far
    // below 0.85 → the badge must be ABSENT (no 'all clear' affirmative).
    mockTwoStrategies();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.queryByText(/above the 0.85 similarity threshold/i),
    ).toBeNull();
  });

  it("CORR-05 — the PCR list renders one role=listitem per constituent, de-aliased, sorted descending", () => {
    mockThreeStrategies();
    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_ETH, HOLDING_SOL],
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText("Risk contribution per constituent (% of total)"),
    ).toBeInTheDocument();
    const list = screen
      .getByText("Risk contribution per constituent (% of total)")
      .closest("div")
      ?.querySelector('ul[role="list"]') as HTMLElement;
    expect(list).not.toBeNull();
    const items = within(list).getAllByRole("listitem");
    // One row per active constituent (de-aliased names, not UUIDs).
    expect(items.length).toBe(3);
    for (const ref of [REF_BTC, REF_ETH, REF_SOL]) {
      expect(within(list).getAllByText(ref).length).toBeGreaterThanOrEqual(1);
    }
    // Descending sort: each row's signed % is ≥ the next row's %.
    const pcts = items.map((li) => {
      const m = li.textContent?.match(/(-?\d+\.\d)%/);
      return m ? parseFloat(m[1]) : NaN;
    });
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i - 1]).toBeGreaterThanOrEqual(pcts[i]);
    }
  });

  // WR-02/WR-03/IN-01 — a HEDGE blend: ETH is strongly NEGATIVELY correlated to
  // BTC (ρ≈−1) and lightly weighted, so signed PCRs put BTC > 100% and ETH < 0
  // (the lib's own hedge test pins exactly this shape), and Σ PCRᵢ² > 1 → ENB < 1.
  // This is the reachable case the three findings are about (a negatively-
  // correlated leg is precisely what this panel exists to surface).
  function mockHedgeBlend() {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const base = [0.02, -0.01, 0.03, -0.02, 0.015, -0.025, 0.01, -0.005, 0.02, -0.018, 0.012, -0.022];
    const btc = dates.map((date, i) => ({ date, value: base[i] }));
    // ETH = −1.1 × BTC → ρ ≈ −1 (a hedge).
    const eth = dates.map((date, i) => ({ date, value: -1.1 * base[i] }));
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [mkRealStrat(REF_BTC, btc), mkRealStrat(REF_ETH, eth)],
      state: {
        selected: { [REF_BTC]: true, [REF_ETH]: true },
        weights: { [REF_BTC]: 0.7, [REF_ETH]: 0.3 }, // BTC heavy, ETH light
        startDates: {},
      },
    });
  }

  it("WR-02 — the PCR bar track is overflow-hidden and the >100% fill is clamped to 100%", () => {
    mockHedgeBlend();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const list = screen
      .getByText("Risk contribution per constituent (% of total)")
      .closest("div")
      ?.querySelector('ul[role="list"]') as HTMLElement;
    const items = within(list).getAllByRole("listitem");
    // BTC's signed PCR exceeds 100% (the hedge forces it past 1.0).
    const btcRow = items.find((li) => (li.textContent ?? "").includes(REF_BTC))!;
    const btcPct = parseFloat(btcRow.textContent!.match(/(-?\d+\.\d)%/)![1]);
    expect(btcPct).toBeGreaterThan(100);
    // Every bar track clamps overflow so a >100% fill can never bleed out.
    for (const li of items) {
      const track = li.querySelector("div[aria-hidden]") as HTMLElement;
      expect(track.className).toContain("overflow-hidden");
      const fill = track.firstElementChild as HTMLElement;
      const w = parseFloat((fill.style.width || "0").replace("%", ""));
      // Decorative bar magnitude is clamped to [0,100]% regardless of sign/size.
      expect(w).toBeLessThanOrEqual(100);
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it("WR-03 — a negative-PCR (hedge) leg renders a 'risk-reducing' affordance, not a broken empty bar", () => {
    mockHedgeBlend();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const list = screen
      .getByText("Risk contribution per constituent (% of total)")
      .closest("div")
      ?.querySelector('ul[role="list"]') as HTMLElement;
    // The hedge leg (ETH) carries a negative % AND the risk-reducing tag.
    const ethRow = within(list)
      .getAllByRole("listitem")
      .find((li) => (li.textContent ?? "").includes(REF_ETH))!;
    expect(ethRow.textContent).toMatch(/-\d+\.\d%/); // signed % preserved
    const tag = within(ethRow).getByTestId("pcr-risk-reducing-tag");
    expect(tag).toBeInTheDocument();
    expect(tag.textContent).toMatch(/risk-reducing/i);
    // GUARD-01 (43-01) — the tag uses the NEUTRAL accent (muted teal) token,
    // NOT the P&L-positive green: "risk-reducing" is a structural attribute of
    // the leg, not a good/bad P&L outcome. Never an error/negative red either.
    expect(tag.className).toContain("text-accent");
    expect(tag.className).not.toMatch(/text-positive|text-negative|text-warning/);
    // The hedge bar is the positive token and has NON-zero width (|PCR| scaled),
    // i.e. it is no longer a 0-width "broken" bar.
    const fill = ethRow.querySelector(
      "div[aria-hidden] > div",
    ) as HTMLElement;
    expect(fill.className).toContain("bg-positive");
    expect(parseFloat((fill.style.width || "0").replace("%", ""))).toBeGreaterThan(0);
  });

  it("IN-01 — ENB < 1 surfaces the 'below 1 — a hedge offsets risk' disclosure", () => {
    mockHedgeBlend();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The hedge pushes Σ PCRᵢ² > 1 → ENB < 1; the disclosure caption appears.
    const disclosure = screen.getByTestId("enb-below-one-disclosure");
    expect(disclosure).toBeInTheDocument();
    expect(disclosure.textContent).toMatch(/below 1/i);
    expect(disclosure.textContent).toMatch(/hedge offsets risk/i);
  });

  it("IN-01 — a non-hedged blend (ENB ≥ 1) does NOT render the sub-1 disclosure", () => {
    // Two mildly-positively-correlated legs (ρ≈0.2) → both PCR ≥ 0, ENB ≈ 1.68.
    mockTwoStrategies();
    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(screen.queryByTestId("enb-below-one-disclosure")).toBeNull();
    // And no row carries the risk-reducing tag (no negative PCR).
    expect(screen.queryByTestId("pcr-risk-reducing-tag")).toBeNull();
  });

  it("CORR-06 — the heatmap axis labels follow the cluster order (correlated legs adjacent, outlier separated)", () => {
    mockThreeStrategies();
    const payload = makePayload({
      holdingsSummary: [HOLDING_BTC, HOLDING_ETH, HOLDING_SOL],
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Read the heatmap COLUMN-HEADER order (keys `ch-${id}` render in matrix order,
    // which the composer reordered to the cluster order before passing the matrix).
    const figure = screen.getByRole("figure", {
      name: /Pairwise correlation heatmap/i,
    });
    const order = Array.from(
      figure.querySelectorAll<HTMLElement>('[class*="text-center"]'),
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t === REF_BTC || t === REF_ETH || t === REF_SOL);
    expect(order.length).toBe(3);
    // The two correlated legs (BTC, ETH) must be ADJACENT; SOL is the outlier
    // (either end), never wedged between them.
    const btcIdx = order.indexOf(REF_BTC);
    const ethIdx = order.indexOf(REF_ETH);
    expect(Math.abs(btcIdx - ethIdx)).toBe(1);
  });

  it("CORR-03 — a single-constituent blend renders the 'add a second strategy' empty state and NO DR/ENB headline", () => {
    // One active strategy → diversification.clusterOrderIds.length < 2 → the
    // CollapsibleSection body collapses to the honest EmptyStateCard.
    function mockOneStrategy() {
      const dates = Array.from({ length: 12 }, (_, i) =>
        `2026-01-${String(i + 1).padStart(2, "0")}`,
      );
      const btc = dates.map((date, i) => ({
        date,
        value: [0.02, -0.01, 0.03][i % 3],
      }));
      vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
        strategies: [mkRealStrat(REF_BTC, btc)],
        state: {
          selected: { [REF_BTC]: true },
          weights: { [REF_BTC]: 1 },
          startDates: {},
        },
      });
    }
    mockOneStrategy();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByText("Add a second strategy to see diversification"),
    ).toBeInTheDocument();
    // The DR/ENB headline and PCR list are absent (the single-constituent guard).
    expect(screen.queryByText("Diversification Ratio")).toBeNull();
    expect(screen.queryByText("ENB = 1 / Σ PCRᵢ²")).toBeNull();
    expect(
      screen.queryByText("Risk contribution per constituent (% of total)"),
    ).toBeNull();
  });

  it("CORR-03 — an n<10 blend routes to the heatmap's own empty (NO DR/ENB headline, no 'add a second strategy')", () => {
    // Two active strategies but only 6 shared days → the engine nulls the matrix
    // (n<10) → computeDiversification returns all-null → the section shows the
    // heatmap's reason-routed empty, and the DR/ENB headline + PCR are hidden.
    function mockShortOverlap() {
      const dates = Array.from({ length: 6 }, (_, i) =>
        `2026-01-${String(i + 1).padStart(2, "0")}`,
      );
      const btc = dates.map((date, i) => ({
        date,
        value: [0.02, -0.01, 0.03][i % 3],
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
    mockShortOverlap();
    const payload = makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The heatmap's reason-routed "few overlapping days" empty state shows.
    expect(
      screen.getByText("Not enough overlap to correlate"),
    ).toBeInTheDocument();
    // The 0/1-constituent EmptyStateCard is NOT used (≥2 constituents exist).
    expect(
      screen.queryByText("Add a second strategy to see diversification"),
    ).toBeNull();
    // The DR/ENB headline + PCR list are hidden (the lib returned all-null).
    expect(screen.queryByText("Diversification Ratio")).toBeNull();
    expect(screen.queryByText("ENB = 1 / Σ PCRᵢ²")).toBeNull();
    expect(
      screen.queryByText("Risk contribution per constituent (% of total)"),
    ).toBeNull();
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
  it("BENCH-01 ScenarioFactsheetChart.benchmark is wired in cumulative-WEALTH form (~1.0 base) once the fetch resolves", async () => {
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

      // The benchmark fetch fires on mount; wait until the scenario chart has
      // been re-rendered with a defined `benchmark` prop (the post-resolve render).
      await waitFor(() => {
        expect(fetchStub).toHaveBeenCalledWith("/api/benchmark/btc");
        const calls = vi.mocked(ScenarioFactsheetChart).mock.calls;
        const withBenchmark = calls.find(
          (c) => (c[0] as { benchmark?: unknown }).benchmark !== undefined,
        );
        expect(withBenchmark).toBeTruthy();
      });

      const calls = vi.mocked(ScenarioFactsheetChart).mock.calls;
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

// ===========================================================================
// Phase 37 / DSRC-02 + DSRC-03 — honest per-data-source toggle
// ===========================================================================
//
// The load-bearing suite. The "Data sources" control lets a book allocator
// include/exclude each connected exchange api_key from the projection; toggling
// a source off must HONESTLY recompute the curve + every KPI from the remaining
// per-key series (DSRC-03), never a cosmetic hide. These tests drive the REAL
// per-key builder + REAL frozen computeScenario (only buildStrategyForBuilderSet
// and the leaf charts are mocked), so a cosmetic-hide regression — wiring the
// toggle to only dim a row without threading projectionState.selected — turns
// the honesty oracle RED.
describe("ScenarioComposer — Phase 37 data sources honest per-source toggle", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
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

  // --- Per-key fixtures ----------------------------------------------------
  // Two connected exchange keys with MATERIALLY different series over a shared
  // window (≥10 points so the engine clears its n<10 floor):
  //   key-A — steady small-positive (low vol, positive drift)
  //   key-B — volatile, net-negative (high vol, negative drift)
  // Their equity shares come from the holdings grouped by api_key_id, so the
  // blend is genuinely weighted; excluding B must move the blend toward A.
  const PK_DATES = Array.from({ length: 14 }, (_, i) =>
    `2026-02-${String(i + 1).padStart(2, "0")}`,
  );
  const KEY_A_SERIES = PK_DATES.map((date, i) => ({
    date,
    value: [0.002, 0.0015, 0.0025, 0.001][i % 4],
  }));
  const KEY_B_SERIES = PK_DATES.map((date, i) => ({
    date,
    value: [-0.03, 0.04, -0.05, 0.02, -0.01][i % 5],
  }));

  const PK_KEY_A = {
    id: "key-A",
    exchange: "binance",
    label: "Main desk",
    is_active: true,
    sync_status: null,
    last_sync_at: null,
    account_balance_usdt: null,
    created_at: "2026-01-01T00:00:00Z",
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
  };
  const PK_KEY_B = {
    id: "key-B",
    exchange: "okx",
    label: "", // no nickname → masked-tail fallback exercises the mask path
    is_active: true,
    sync_status: null,
    last_sync_at: null,
    account_balance_usdt: null,
    created_at: "2026-01-01T00:00:00Z",
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
  };

  // Holdings grouped by api_key_id supply the per-key equity weights (D2). Key A
  // holds $70k spot, key B holds $30k spot → raw equity-share weights 70k / 30k
  // (the engine renormalizes per-day over the selected set — Pitfall 1).
  const PK_HOLDING_A = {
    ...HOLDING_BTC,
    symbol: "BTC",
    venue: "binance",
    value_usd: 70_000,
    api_key_id: "key-A",
  };
  const PK_HOLDING_B = {
    ...HOLDING_ETH,
    symbol: "ETH",
    venue: "okx",
    value_usd: 30_000,
    api_key_id: "key-B",
  };

  /** A book-mode payload with the D3 gate satisfied and two eligible per-key
   *  sources (key-A, key-B). Per-key tests extend this. */
  function makePerKeyPayload(
    overrides: Partial<MyAllocationDashboardPayload> = {},
  ): MyAllocationDashboardPayload {
    return makePayload({
      apiKeys: [PK_KEY_A, PK_KEY_B],
      holdingsSummary: [PK_HOLDING_A, PK_HOLDING_B],
      perKeyReturnsByApiKeyId: {
        "key-A": KEY_A_SERIES,
        "key-B": KEY_B_SERIES,
      },
      perKeyDailiesGateSatisfied: true,
      eligibleApiKeyIds: ["key-A", "key-B"],
      ...overrides,
    });
  }

  function renderPerKey(payload: MyAllocationDashboardPayload) {
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
  }

  /** The scenarioMetrics last handed to the (mocked) KpiStrip. */
  function lastKpiScenarioMetrics() {
    return vi.mocked(KpiStrip).mock.calls.at(-1)?.[0]?.scenarioMetrics;
  }

  /** Independent two→one recompute oracle: run the REAL per-key builder + REAL
   *  collapse + REAL engine with the given set of INCLUDED keys, returning the
   *  ComputedMetrics the composer should produce. Mirrors the composer's
   *  pipeline exactly (raw equity-share weights, selected map, no symbol map for
   *  per-key UUIDs). This is what makes the honesty assertion an oracle, not a
   *  "something changed" check. */
  function independentRecompute(includedKeyIds: string[]) {
    const equityByApiKeyId: Record<string, number> = {
      "key-A": 70_000,
      "key-B": 30_000,
    };
    const built = buildPerKeyStrategyForBuilderSet(
      { "key-A": KEY_A_SERIES, "key-B": KEY_B_SERIES },
      equityByApiKeyId,
    );
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const leverage: Record<string, number> = {};
    for (const s of built.strategies) {
      selected[s.id] = includedKeyIds.includes(s.id);
      weights[s.id] = built.state.weights[s.id] ?? 0;
      leverage[s.id] = 1;
    }
    const state = {
      selected,
      weights,
      startDates: built.state.startDates,
      leverage,
    };
    // Per-key UUID units are NOT in any symbol map → pass through collapse.
    const deAliased = realCollapse(built.strategies, state, new Map());
    const cache = realBuildDateMapCache(deAliased.strategies);
    return realComputeScenario(deAliased.strategies, deAliased.state, cache);
  }

  // -------------------------------------------------------------------------
  // DSRC-02 — gating: present in book mode + gate satisfied
  // -------------------------------------------------------------------------
  it("DSRC-02 book mode + D3 gate satisfied → Data sources control renders one row per eligible key with the group accessible name", () => {
    renderPerKey(makePerKeyPayload());
    const group = screen.getByRole("group", { name: "Data sources" });
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute("data-testid", "scenario-data-sources");
    // One switch per eligible key, each with its per-row aria-label.
    const switches = within(group).getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(
      screen.getByRole("switch", {
        name: "Include Binance — Main desk in projection",
      }),
    ).toBeInTheDocument();
    // key-B has no nickname → masked tail (last 4 of the id).
    expect(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    ).toBeInTheDocument();
    // No InfoBanner fallback when the control IS shown.
    expect(
      screen.queryByTestId("scenario-data-sources-fallback"),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // DSRC-02 — gating: absent in blank mode
  // -------------------------------------------------------------------------
  it("DSRC-02 blank mode → no Data sources control, no InfoBanner, no EmptyStateCard for this control", () => {
    // No live book → blank mode is forced (entry-mode book segment absent).
    renderPerKey(
      makePerKeyPayload({ holdingsSummary: [] }),
    );
    expect(
      screen.queryByTestId("scenario-data-sources"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("scenario-data-sources-fallback"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("scenario-data-sources-empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Data sources" }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // DSRC-02 — gating: gate NOT satisfied → control hidden, calm InfoBanner note
  // -------------------------------------------------------------------------
  it("DSRC-02 book mode + D3 gate NOT satisfied → control hidden, InfoBanner fallback note (NOT role=alert)", () => {
    renderPerKey(
      makePerKeyPayload({ perKeyDailiesGateSatisfied: false }),
    );
    expect(
      screen.queryByTestId("scenario-data-sources"),
    ).not.toBeInTheDocument();
    const fallback = screen.getByTestId("scenario-data-sources-fallback");
    expect(fallback).toBeInTheDocument();
    expect(
      screen.getByText(/Per-source modeling needs per-key history\./i),
    ).toBeInTheDocument();
    // Honest absence — NOT an error. No role="alert" inside the fallback.
    expect(fallback.querySelector('[role="alert"]')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // DSRC-03 — THE LOAD-BEARING HONESTY TEST. Toggling key B off must move the
  // KPI/curve NUMBERS and match an independent two→one recompute. A cosmetic
  // hide (dim the row, leave projectionState.selected intact) FAILS this.
  // -------------------------------------------------------------------------
  it("DSRC-03 toggling a source off honestly recomputes Sharpe/maxDD/return + curve endpoint, matching an independent two→one recompute", () => {
    renderPerKey(makePerKeyPayload());

    // Baseline (both included) — must equal the independent two-key blend.
    const before = lastKpiScenarioMetrics();
    const bothRecompute = independentRecompute(["key-A", "key-B"]);
    expect(before?.sharpe).toBeCloseTo(bothRecompute.sharpe as number, 10);
    expect(before?.max_drawdown).toBeCloseTo(
      bothRecompute.max_drawdown as number,
      10,
    );
    expect(before?.twr).toBeCloseTo(bothRecompute.twr as number, 10);

    // Toggle key B OFF.
    const switchB = screen.getByRole("switch", {
      name: "Include OKX — ••••ey-B in projection",
    });
    fireEvent.click(switchB);

    // After: the recomputed numbers must (a) DIFFER from the two-key blend and
    // (b) MATCH the independent key-A-only recompute. This is the honesty core:
    // a cosmetic hide would leave `after` equal to `before`.
    const after = lastKpiScenarioMetrics();
    const aOnlyRecompute = independentRecompute(["key-A"]);

    // (a) numbers MOVED (mutation-falsifiable: a cosmetic hide leaves them equal)
    expect(after?.sharpe).not.toBeCloseTo(before?.sharpe as number, 6);
    expect(after?.twr).not.toBeCloseTo(before?.twr as number, 6);

    // (b) numbers MATCH the honest single-key recompute (oracle, not "changed")
    expect(after?.sharpe).toBeCloseTo(aOnlyRecompute.sharpe as number, 10);
    expect(after?.max_drawdown).toBeCloseTo(
      aOnlyRecompute.max_drawdown as number,
      10,
    );
    expect(after?.twr).toBeCloseTo(aOnlyRecompute.twr as number, 10);

    // Curve endpoint also moves and matches the key-A-only curve endpoint.
    const afterCurve = after?.equity_curve ?? [];
    const aOnlyCurve = aOnlyRecompute.equity_curve ?? [];
    expect(afterCurve.length).toBeGreaterThan(0);
    expect(afterCurve.at(-1)?.value).toBeCloseTo(
      aOnlyCurve.at(-1)?.value as number,
      10,
    );
    expect(afterCurve.at(-1)?.value).not.toBeCloseTo(
      (before?.equity_curve ?? []).at(-1)?.value as number,
      6,
    );

    // aria-checked reflects the exclusion (state visible, not silent).
    expect(switchB).toHaveAttribute("aria-checked", "false");
  });

  // -------------------------------------------------------------------------
  // Review WR-02 — the ephemeral per-source include map must NOT survive a
  // draft replacement. Excluding a source then opening a saved scenario must
  // start the opened scenario with every source included again (the toggle is
  // not persisted; a stale exclusion would silently omit a source the user
  // never excluded for THIS scenario — a cosmetic-hide-by-leak regression).
  // -------------------------------------------------------------------------
  it("review WR-02 opening a saved scenario clears the ephemeral per-source exclusion (toggle resets to all-included)", () => {
    let openSaved:
      | ((row: { id: string; name: string; draft: unknown }) => void)
      | null = null;
    render(
      <ScenarioComposer
        payload={makePerKeyPayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          openSaved = open;
        }}
      />,
    );

    // Exclude key-B.
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    );
    expect(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    ).toHaveAttribute("aria-checked", "false");

    // Open a saved scenario — a valid current-schema draft decodes "ok".
    const validDraft = defaultDraftFromHoldings([
      PK_HOLDING_A,
      PK_HOLDING_B,
    ] as Parameters<typeof defaultDraftFromHoldings>[0]);
    act(() => {
      openSaved?.({ id: "saved-1", name: "Saved scenario", draft: validDraft });
    });

    // The exclusion must NOT carry over — every source included again. Without
    // the WR-02 fix (setIncludeByApiKeyId({}) on open) this stays aria-checked
    // "false" and the opened scenario silently omits key-B.
    expect(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    ).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // DSRC-03 — all-excluded honest empty + re-include restores
  // -------------------------------------------------------------------------
  it("DSRC-03 excluding every source → EmptyStateCard + null KPIs (never stale); re-including restores the live projection", () => {
    renderPerKey(makePerKeyPayload());

    const liveBefore = lastKpiScenarioMetrics();
    expect(liveBefore?.sharpe).not.toBeNull();

    // Exclude BOTH sources.
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include Binance — Main desk in projection",
      }),
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    );

    // Honest empty card renders with the exact copy.
    const emptyCard = screen.getByTestId("scenario-data-sources-empty");
    expect(emptyCard).toBeInTheDocument();
    expect(
      screen.getByText("Select at least one data source"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Every data source is excluded — there's nothing to project\./i,
      ),
    ).toBeInTheDocument();
    // Honest absence — not an error.
    expect(emptyCard.querySelector('[role="alert"]')).toBeNull();

    // Engine returned the all-null / empty-curve degenerate result — KpiStrip
    // gets null KPIs (its degenerate "—" path), NEVER the stale prior number.
    const allOff = lastKpiScenarioMetrics();
    expect(allOff?.sharpe).toBeNull();
    expect(allOff?.twr).toBeNull();
    expect(allOff?.max_drawdown).toBeNull();
    expect(allOff?.equity_curve ?? []).toHaveLength(0);

    // Re-include key A → empty card gone, live projection restored to A-only.
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include Binance — Main desk in projection",
      }),
    );
    expect(
      screen.queryByTestId("scenario-data-sources-empty"),
    ).not.toBeInTheDocument();
    const restored = lastKpiScenarioMetrics();
    const aOnly = independentRecompute(["key-A"]);
    expect(restored?.sharpe).toBeCloseTo(aOnly.sharpe as number, 10);
  });

  // -------------------------------------------------------------------------
  // RT1 (review) — an INELIGIBLE key (soft-disconnected: disconnected_at set,
  // is_active still true) keeps its holdings + csv_daily_returns residue, so the
  // allocator-scoped SSR read still carries its series. It is NOT in
  // eligibleApiKeyIds, so it gets no toggle row. The composer must NOT blend it
  // (perKeyAdapterOutput is filtered to eligibleApiKeyIds): otherwise excluding
  // every TOGGLEABLE source would leave an undisclosed, untoggleable key driving
  // the projection — falsely breaking the "exclude all → honest empty" contract.
  // -------------------------------------------------------------------------
  it("RT1 a soft-disconnected ineligible key with holdings + csv residue gets no toggle row and never rides the blend (exclude-all stays honestly empty)", () => {
    // key-C: disconnected_at set (soft-disconnected) → INELIGIBLE, but is_active
    // still true and it retains a $50k holding + a csv-residue series.
    const PK_KEY_C = {
      ...PK_KEY_A,
      id: "key-C",
      exchange: "bybit",
      label: "Disconnected desk",
      disconnected_at: "2026-02-10T00:00:00Z",
    };
    const PK_HOLDING_C = {
      ...PK_HOLDING_A,
      symbol: "SOL",
      venue: "bybit",
      value_usd: 50_000,
      api_key_id: "key-C",
    };
    renderPerKey(
      makePerKeyPayload({
        apiKeys: [PK_KEY_A, PK_KEY_B, PK_KEY_C],
        holdingsSummary: [PK_HOLDING_A, PK_HOLDING_B, PK_HOLDING_C],
        perKeyReturnsByApiKeyId: {
          "key-A": KEY_A_SERIES,
          "key-B": KEY_B_SERIES,
          // Residual series for the soft-disconnected key — present in the
          // allocator-scoped read, but key-C is NOT in eligibleApiKeyIds.
          "key-C": KEY_A_SERIES,
        },
        perKeyDailiesGateSatisfied: true,
        eligibleApiKeyIds: ["key-A", "key-B"],
      }),
    );

    // Only the two ELIGIBLE keys get a toggle row — no row for key-C (Bybit).
    const group = screen.getByRole("group", { name: "Data sources" });
    expect(within(group).getAllByRole("switch")).toHaveLength(2);
    expect(
      within(group).queryByRole("switch", { name: /Bybit/i }),
    ).toBeNull();

    // Exclude BOTH toggleable (eligible) sources.
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include Binance — Main desk in projection",
      }),
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    );

    // RT1: with key-C filtered out of the blend, excluding every toggleable
    // source yields the honest-empty card + null KPIs. WITHOUT the
    // eligibleApiKeyIds filter on perKeyAdapterOutput, key-C (weight $50k + csv
    // residue) would keep driving a non-empty projection here — a silent honesty
    // violation. This assertion fails loudly if that filter is ever removed.
    expect(
      screen.getByTestId("scenario-data-sources-empty"),
    ).toBeInTheDocument();
    const allOff = lastKpiScenarioMetrics();
    expect(allOff?.sharpe).toBeNull();
    expect(allOff?.twr).toBeNull();
    expect(allOff?.equity_curve ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // DSRC-03 / Pitfall 5 — ephemeral: a toggle never changes diffCount / commit
  // -------------------------------------------------------------------------
  it("Pitfall 5 toggling a data source off does NOT change diffCount (ephemeral — never in the commit diff)", () => {
    renderPerKey(makePerKeyPayload());

    // Fresh draft seeded from the live book → no diff yet. The Commit button is
    // disabled (diffCount === 0) and the footer reads "No changes yet" (the
    // ScenarioFooter renders that copy in BOTH the count chip and the summary
    // slot at rest, hence getAllByText).
    const commit = screen.getByTestId(
      "scenario-footer-commit",
    ) as HTMLButtonElement;
    expect(screen.getAllByText("No changes yet").length).toBeGreaterThan(0);
    expect(commit.disabled).toBe(true);

    // Toggle a source off — exclusion recomputes the projection but must NOT
    // enter the draft / commit diff.
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include OKX — ••••ey-B in projection",
      }),
    );

    // diffCount unchanged — still "No changes yet", Commit still disabled. If the
    // toggle leaked into scenario.draft (e.g. via toggleByScopeRef) diffCount
    // would increment and the button would enable — this asserts it does not.
    expect(screen.getAllByText("No changes yet").length).toBeGreaterThan(0);
    expect(commit.disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // DSRC-03 / Pitfall 3 — two per-key units with the same underlying symbol are
  // NOT collapsed (per-key UUIDs are not symbol-keyed); the unit count holds.
  // -------------------------------------------------------------------------
  it("Pitfall 3 two per-key units sharing an underlying symbol are NOT collapsed (count preserved; avg-ρ honest)", () => {
    // Both keys' series are byte-identical AND both holdings are the same symbol
    // (BTC) — a symbol-keyed collapse WOULD merge them. Per-key UUID ids are not
    // in symbolByHoldingId, so they pass through: the engine sees 2 strategies.
    const sharedSeries = PK_DATES.map((date, i) => ({
      date,
      value: [0.01, -0.02, 0.015][i % 3],
    }));
    renderPerKey(
      makePerKeyPayload({
        holdingsSummary: [
          { ...PK_HOLDING_A, symbol: "BTC", venue: "binance" },
          { ...PK_HOLDING_B, symbol: "BTC", venue: "okx" },
        ],
        perKeyReturnsByApiKeyId: {
          "key-A": sharedSeries,
          "key-B": sharedSeries,
        },
      }),
    );
    const sm = lastKpiScenarioMetrics();
    // Two distinct per-key units survived the collapse → 2×2 correlation matrix.
    expect(Object.keys(sm?.correlation_matrix ?? {})).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // DSRC-02 (a11y) — per-row aria-label + aria-checked state + group name
  // -------------------------------------------------------------------------
  it("DSRC-02 a11y each toggle carries aria-label + aria-checked, the group is named, and excluded flips aria-checked", () => {
    renderPerKey(makePerKeyPayload());

    const group = screen.getByRole("group", { name: "Data sources" });
    const switchA = within(group).getByRole("switch", {
      name: "Include Binance — Main desk in projection",
    });
    const switchB = within(group).getByRole("switch", {
      name: "Include OKX — ••••ey-B in projection",
    });
    // Default included.
    expect(switchA).toHaveAttribute("aria-checked", "true");
    expect(switchB).toHaveAttribute("aria-checked", "true");

    // Exclude A → its aria-checked flips, B stays included.
    fireEvent.click(switchA);
    expect(switchA).toHaveAttribute("aria-checked", "false");
    expect(switchB).toHaveAttribute("aria-checked", "true");
  });
});

// ===========================================================================
// Phase 43 / GUARD-01 (milestone v1.2.2 close) — PERMANENT static guard +
// assembled-surface degenerate-matrix cross-check.
// ===========================================================================
//
// Two closing gates. (1) A PERMANENT static-source guard that the composer
// source contains the literal "FactsheetBody" ZERO times — the body mount must
// stay EXCLUSIVELY in ScenarioFactsheetChart.tsx (the only file allowed the
// literal). This mirrors the composer-width.test.tsx static-source-scan pattern
// (readFileSync + literal-count; render-engine-independent and permanent). It
// is intentionally distinct from the broader Phase-30 T-30-05 "no factsheet
// import" guard above: this one is the explicit milestone-closing GUARD-01
// separation gate (do NOT delete at milestone close) and pins the EXACT count.
//
// (2) An assembled-surface degenerate-matrix cross-check. The per-phase panel
// tests already prove each panel HONEST in isolation (Diversification 0/1
// constituent, blend-panel n<10/n<252 banners, MandatePanels no-metadata,
// OwnBookDelta no-book). The one genuine GUARD-01 gap research identified is
// proving they ALL render their honest empty/safe states SIMULTANEOUSLY on the
// ONE folded surface — that no degenerate axis fabricates a value, leaks a
// NaN/Inf, or shows a stale/dishonest body while a sibling section is empty.
// ScenarioFactsheetChart is mocked here, so the Peer / Mandate / OwnBookDelta
// payloads are asserted via the props the composer threads INTO that mount
// (the honest null/undefined degradation), while the Diversification +
// blend-panel honest-empty bodies are asserted directly in the composed DOM.
describe("ScenarioComposer — Phase 43 GUARD-01 static guard + assembled degenerate matrix", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    // Default adapter mock → ZERO strategies → 0-constituent degenerate blend
    // (computeScenario short-circuits to its n=0 branch: empty equity_curve,
    // null scalars). This IS the most degenerate axis of the matrix.
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
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

  // The props the composer threads into the (mocked) ScenarioFactsheetChart on
  // the FIRST render — the seam where Peer / Mandate / OwnBookDelta honesty
  // degrades. A non-degenerate matrix would carry a fabricated peer rank, a
  // phantom mandate panel, or a NaN-laden own-book delta here.
  type ChartProps = {
    portfolioDaily?: Array<{ date: string; value: number }>;
    scenarioSeries?: Array<{ date: string; value: number }>;
    scenarioPeer?: unknown;
    scenarioMandate?: unknown;
    scenarioOwnBookDelta?: unknown;
  };
  const lastChartProps = (): ChartProps =>
    vi.mocked(ScenarioFactsheetChart).mock.calls.at(-1)![0] as ChartProps;

  // The scenarioMetrics the composer fed the (mocked) KpiStrip on the latest
  // render — the single source of truth for the blend's KPIs. Local to this
  // block (the first describe's same-named helper is out of scope here).
  const lastScenarioMetrics = () => {
    const calls = vi.mocked(KpiStrip).mock.calls;
    return calls.at(-1)?.[0].scenarioMetrics;
  };

  it("GUARD-01 static guard — ScenarioComposer.tsx contains the literal 'FactsheetBody' EXACTLY zero times (the body mount stays in ScenarioFactsheetChart.tsx) [PERMANENT]", () => {
    // PERMANENT milestone-closing separation gate — do NOT delete at close.
    // Reads the REAL .tsx source off disk (not the bundled/mocked module) so a
    // re-introduced `FactsheetBody` import OR even a code-comment literal fails
    // LOUD. The mount must live EXCLUSIVELY in ScenarioFactsheetChart.tsx; the
    // composer threads scenario state to that island, never imports the body.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "ScenarioComposer.tsx"), "utf8");
    // Positive control — prove the read is real (this IS the composer source).
    expect(source).toMatch(/ScenarioFactsheetChart/);
    // The load-bearing assertion: the count is EXACTLY zero (a literal anywhere
    // — import, JSX, or comment — flips this RED).
    expect(source.match(/FactsheetBody/g)?.length ?? 0).toBe(0);
  });

  it("assembled folded surface — own-book degenerate blend (0 constituents): Diversification honest-empty, blend panels honest banners, Data-sources fold absent, and the chart-bound Peer/Mandate/OwnBookDelta props degrade honestly — ALL co-exist, no NaN/Inf, no fabricated values", () => {
    // The default payload: a connected book allocator (hasLiveBook → composed
    // branch, NOT the empty-state) but ZERO blend constituents (default adapter
    // returns strategies:[]). perKeyDailiesGateSatisfied=false +
    // eligibleApiKeyIds=[] → the Data-sources fold honestly DISAPPEARS. This
    // single render exercises the degenerate axes 0-constituent / n<10 / n<252 /
    // no-mandate simultaneously on the assembled folded surface.
    const payload = makePayload();
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // (A) Diversification section: the honest 0/1-constituent empty state, never
    // a 1×1 grid (CORR-03). This is the visible proof the folded surface
    // rendered its degenerate state, not a blank gap.
    expect(
      screen.getByText("Add a second strategy to see diversification"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("figure", { name: /Pairwise correlation heatmap/i }),
    ).toBeNull();

    // (B) Blend panels: BOTH render their honest role=status banner (below the
    // sample floor) and NEVER a role=alert (a derived-client panel has no fetch
    // to fail) — and NEVER a populated-but-empty body.
    const distCard = document.querySelector(
      '[data-panel="blend-returns-distribution"]',
    );
    const rollCard = document.querySelector('[data-panel="blend-rolling"]');
    expect(distCard).not.toBeNull();
    expect(rollCard).not.toBeNull();
    expect(distCard!.querySelector('[role="status"]')).not.toBeNull();
    expect(rollCard!.querySelector('[role="status"]')).not.toBeNull();
    expect(distCard!.querySelector('[role="alert"]')).toBeNull();
    expect(rollCard!.querySelector('[role="alert"]')).toBeNull();
    // No fabricated leaf charts on the degenerate blend.
    expect(distCard!.querySelector('[data-testid="return-histogram-mock"]')).toBeNull();
    expect(rollCard!.querySelector('[data-testid="rolling-metrics-mock"]')).toBeNull();

    // (C) Data-sources fold honestly DISAPPEARS (showDataSources false: book
    // mode but the D3 per-key gate is unsatisfied AND there are zero eligible
    // keys, so neither the control nor the fallback InfoBanner renders).
    expect(
      screen.queryByRole("group", { name: "Data sources" }),
    ).toBeNull();

    // (D) The chart-bound Peer / Mandate / OwnBookDelta props degrade HONESTLY:
    // a 0-constituent degenerate blend yields no peer rank (below floor → null),
    // no mandate panel (no constituents → undefined), and the own-book delta is
    // undefined because the default book equity (2 points) gives <2 derivable
    // returns. None is a fabricated zero/NaN — they are the honest absence.
    const props = lastChartProps();
    expect(props.scenarioPeer ?? null).toBeNull();
    expect(props.scenarioMandate ?? null).toBeNull();
    expect(props.scenarioOwnBookDelta ?? null).toBeNull();

    // (E) HONESTY across the whole surface: every numeric the composer threaded
    // to the chart is finite — no NaN/Inf leaked onto the degenerate blend. The
    // portfolioDaily/scenarioSeries are honest-empty (length 0), never a
    // fabricated curve.
    for (const p of props.portfolioDaily ?? []) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
    for (const p of props.scenarioSeries ?? []) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
    // The degenerate blend's KPIs are honest null (engine n=0 path), never a
    // fabricated zero presented as a real metric.
    const sm = lastScenarioMetrics();
    expect(sm?.avg_pairwise_correlation ?? null).toBeNull();
  });

  it("assembled folded surface — NO own-book (blank mode) + single added constituent: own-book delta degrades to undefined, Diversification still honest-empty (n<2), no NaN/Inf — the no-own-book and single-constituent honest states co-exist", () => {
    // Blank mode (zero holdings → baselineEquityDailyPoints=[] → no own book) +
    // ONE added strategy. This drives the composed branch WITHOUT a live book,
    // so the OwnBookDelta axis degrades (undefined) on the SAME render where the
    // single-constituent Diversification axis is honest-empty (n<2). The
    // assembled surface must present BOTH honest states at once.
    const single = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      value: [-0.01, 0.005, -0.02][i % 3],
    }));
    // The adapter returns the single added strategy as the only constituent.
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        {
          id: "strat-solo",
          name: "strat-solo",
          codename: null,
          disclosure_tier: "public",
          strategy_types: [] as string[],
          markets: [] as string[],
          start_date: single[0].date,
          daily_returns: single,
          cagr: null,
          sharpe: null,
          volatility: null,
          max_drawdown: null,
        },
      ],
      state: {
        selected: { "strat-solo": true },
        weights: { "strat-solo": 1 },
        startDates: {},
      },
    });
    const payload = makePayload({
      // No live book: zero holdings + empty baseline equity. The own-book delta
      // keys off `equityDailyPoints` (→ baselineEquityDailyPoints) being empty;
      // liveBaselineMetrics is a separate field, set to its honest empty form
      // (zero AUM, no equity) rather than removed (the field is required).
      holdingsSummary: [],
      holdingReturnsByScopeRef: {},
      equityDailyPoints: [],
      liveBaselineMetrics: {
        aum: 0,
        ytdTwr: null,
        sharpe: null,
        maxDd: null,
        avgRho: null,
        equity: [],
        drawdown: [],
      },
    });
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Reach the composed branch (no live book → must add a strategy).
    addStrategy({
      id: "strat-solo",
      name: "strat-solo",
      markets: ["binance"],
      strategy_types: ["momentum"],
    });

    // (A) Single-constituent Diversification: still the honest "add a second
    // strategy" empty state (n<2), never a 1×1 grid.
    expect(
      screen.getByText("Add a second strategy to see diversification"),
    ).toBeInTheDocument();

    // (B) NO own-book → the own-book delta prop degrades to undefined (honest
    // silent absence, NOT a zero/NaN delta). This is the co-existing axis.
    const props = lastChartProps();
    expect(props.scenarioOwnBookDelta ?? null).toBeNull();

    // (C) HONESTY: any threaded numeric is finite — no NaN/Inf on the no-book +
    // single-constituent assembled surface.
    for (const p of props.portfolioDaily ?? []) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
    for (const p of props.scenarioSeries ?? []) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
    // No role=alert anywhere on the folded surface (derived-client honesty).
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

// ===========================================================================
// Phase 57 Plan 02 — Coverage-window control (WINDOW-01/04/05, POLISH-01)
//
// The adapter is mocked but `@/lib/scenario` (computeScenario) and
// `@/lib/scenario-dealias` (the collapse) are REAL, so `member_count` on the
// scenarioMetrics the composer feeds KpiStrip is the genuine engine membership.
// That is the load-bearing oracle here: the window is proven to reach the engine
// (post-collapse) ONLY if member_count moves when the window moves.
// ===========================================================================

// Two strategies with UNEQUAL spans, both added as toggle-able rows so they ride
// the passthrough (non-collapsed) path and align 1:1 with the engine members.
//   A: 2026-01-01 … 2026-01-12  (full span)
//   B: 2026-01-01 … 2026-01-06  (ends early — dropped when the window widens past d6)
const WIN_DATES = Array.from({ length: 12 }, (_, i) =>
  `2026-01-${String(i + 1).padStart(2, "0")}`,
);
const REF_WIN_A = "strat-window-A";
const REF_WIN_B = "strat-window-B";

function mkWinStrat(
  id: string,
  dates: string[],
): {
  id: string;
  name: string;
  codename: null;
  disclosure_tier: string;
  strategy_types: string[];
  markets: string[];
  start_date: string;
  daily_returns: { date: string; value: number }[];
  cagr: null;
  sharpe: null;
  volatility: null;
  max_drawdown: null;
} {
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "public",
    strategy_types: [],
    markets: [],
    start_date: dates[0],
    daily_returns: dates.map((date, i) => ({
      date,
      value: [0.01, -0.008, 0.012, -0.005, 0.006][i % 5],
    })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

/** Mount the adapter with A (full span) + B (short span), both selected. */
function mountUnequalSpanBook(): void {
  vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
    strategies: [
      mkWinStrat(REF_WIN_A, WIN_DATES), // 2026-01-01 … 2026-01-12
      mkWinStrat(REF_WIN_B, WIN_DATES.slice(0, 6)), // 2026-01-01 … 2026-01-06
    ],
    state: {
      selected: { [REF_WIN_A]: true, [REF_WIN_B]: true },
      weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
      startDates: {},
    },
  });
}

/** The latest scenarioMetrics the composer passed to KpiStrip this render. */
function lastScenarioMetrics(): {
  member_count?: number;
  member_ids?: string[];
} | null {
  const calls = vi.mocked(KpiStrip).mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][0].scenarioMetrics ?? null;
}

describe("ScenarioComposer — Phase 57 coverage window (WINDOW-01, hazard fix)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  it("window: default seeds the intersection so both unequal-span strategies are members", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Default window = defaultWindowFor(spans) = [2026-01-01, 2026-01-06]
    // (max firsts / min lasts). BOTH A and B cover it → member_count === 2.
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(2);
    expect(sm?.member_ids).toEqual(
      expect.arrayContaining([REF_WIN_A, REF_WIN_B]),
    );
  });

  it("window: MANDATORY member_count changes when the window moves — widening past B's last day drops it (2 → 1), narrowing restores it (1 → 2)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Baseline: intersection default → both members.
    expect(lastScenarioMetrics()?.member_count).toBe(2);

    // Open the window control so the (mocked) picker mounts and captures onApply.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));

    // The picker receives the union span as bounds (min = earliest first) and
    // the current window as initialRange — the mount contract for the control.
    expect(lastPickerProps).not.toBeNull();
    expect(lastPickerProps!.initialRange).toEqual({
      start: "2026-01-01",
      end: "2026-01-06",
    });

    // Widen winEnd PAST B's last data day (2026-01-06 → 2026-01-12). The picker
    // bubbles the applied window; the composer injects it POST-collapse onto
    // deAliased.state, so the engine drops B (its span no longer covers the
    // window) → member_count === 1. This is the hazard-fix proof: if the window
    // never reached the engine, member_count would stay 2.
    expect(pickerOnApply).not.toBeNull();
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    const widened = lastScenarioMetrics();
    expect(widened?.member_count).toBe(1);
    expect(widened?.member_ids).toEqual([REF_WIN_A]);

    // Narrow winEnd back within B's coverage (→ 2026-01-06). B is a member again
    // → member_count === 2. Proves the toggle is driven by the live window, not a
    // one-way latch.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-06" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(2);
  });

  // Phase 58 (COVERAGE-03) — the BlendHeader N is not an independent count; it
  // IS the engine's member_count. Prove the header text and the divisor move
  // together as the window drops a member. The header reads the SAME axis the
  // :1813 desync guard reconciles, so this is the single-source guarantee under
  // test — if BlendHeader ever recomputed membership, N would diverge here.
  it("COVERAGE-03: BlendHeader N === engine member_count, and the header degrades in lockstep when the window drops a member", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Baseline: intersection default → both A and B are members (member_count 2).
    // The header must read the REAL engine divisor, not a local recount.
    const baseN = lastScenarioMetrics()?.member_count;
    expect(baseN).toBe(2);
    const header = screen.getByTestId("scenario-blend-header");
    expect(header).toHaveTextContent(`Mean of ${baseN} strategies ·`);
    // Non-blocking live region — announced politely, never assertively.
    expect(header).toHaveAttribute("role", "status");

    // Widen the window PAST B's last day → the engine drops B (member_count 1) and
    // the header must degrade IN LOCKSTEP to the "not a blend" copy. Same axis.
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);
    expect(screen.getByTestId("scenario-blend-header")).toHaveTextContent(
      "1 strategy — not a blend",
    );
  });

  // Phase 58 (COVERAGE-04) — the include-cost affordance. Widening past B's last
  // day auto-excludes B; its row must carry the amber "Outside window" chip AND a
  // cost-disclosing include button. The load-bearing oracle is the REAL engine
  // member_count: clicking Include must RAISE it (B becomes a member again) and B
  // must leave the auto-excluded group. The button reuses the same applyWindow
  // path as the presets, so this proves the disclosed cost reaches the engine.
  it("COVERAGE-04: an auto-excluded row shows the amber chip + a cost-disclosing include button, and clicking it raises the engine member_count (B re-admitted)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Widen the window PAST B's last day → the engine drops B (member_count 2→1)
    // and B relocates to the auto-excluded group.
    expect(lastScenarioMetrics()?.member_count).toBe(2);
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);

    // B's auto-excluded row carries BOTH the amber chip ("Outside window") and the
    // cost-disclosing include button. The button label discloses the moved bound
    // date (the intersection end = B's last day, 2026-01-06) + a whole-month cost
    // ("−…mo") BEFORE applying — no modal.
    const bRow = screen.getByTestId(`auto-excluded-row-${REF_WIN_B}`);
    expect(within(bRow).getByText("Outside window")).toBeInTheDocument();
    const includeBtn = within(bRow).getByTestId(
      `auto-excluded-include-${REF_WIN_B}`,
    );
    expect(includeBtn).toHaveTextContent("Include → shortens window to");
    // The disclosed bound (2026-01-06) + a "−N mo" delta are both in the label.
    expect(includeBtn).toHaveTextContent("2026-01-06");
    expect(includeBtn.textContent).toMatch(/−\d+ mo/);

    // Click Include → narrows the window to the intersection that re-admits B.
    // The REAL engine member_count RISES back to 2 (B is a member again) — the
    // load-bearing oracle that the disclosed cost genuinely reached the engine.
    act(() => {
      fireEvent.click(includeBtn);
    });
    expect(lastScenarioMetrics()?.member_count).toBe(2);
    expect(lastScenarioMetrics()?.member_ids).toEqual(
      expect.arrayContaining([REF_WIN_A, REF_WIN_B]),
    );
    // B has left the auto-excluded group (it is a member again).
    expect(
      screen.queryByTestId(`auto-excluded-row-${REF_WIN_B}`),
    ).not.toBeInTheDocument();
    // The applied window is exactly the intersection [2026-01-01, 2026-01-06].
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");
  });

  // WR-01 — the HEAD-ragged branch. The tail case above only moves the END
  // bound, so `movedBound === "end"` and the label reads "shortens window to
  // {end}". A strategy that STARTS after the window start (span.first >
  // window.start) moves only the START bound instead; disclosing that start
  // date with end-bound phrasing ("shortens window to {start}") would tell the
  // allocator they are trading away RECENT history when they are actually
  // trading away EARLY history. The label must read "moves window start to
  // {start}" and the disclosed date must be the moved START (the intersection
  // start = LATE's first day), with a reconcilable month cost.
  it("COVERAGE-04: a ragged-HEAD auto-excluded row discloses the moved START bound ('moves window start to {start}'), not end-bound phrasing (WR-01)", () => {
    const REF_WIN_LATE = "strat-window-late";
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES), // 2026-01-01 … 2026-01-12
        mkWinStrat(REF_WIN_LATE, WIN_DATES.slice(3)), // 2026-01-04 … 2026-01-12 (ragged HEAD)
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_LATE]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_LATE]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Default window = defaultWindowFor(spans) = [2026-01-04, 2026-01-12]
    // (max firsts / min lasts) → both A and LATE are members.
    expect(lastScenarioMetrics()?.member_count).toBe(2);

    // Widen the window START back to 2026-01-01 (BEFORE LATE's first day). LATE's
    // span [01-04, 01-12] no longer covers [01-01, 01-12] → LATE is dropped for a
    // HEAD reason (starts too late). A is the sole member.
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);

    // The include button discloses the moved START bound with start-bound
    // phrasing — NOT "shortens window to" (which reads as an end move). The
    // disclosed date is the intersection start (LATE's first day, 2026-01-04).
    const lateRow = screen.getByTestId(`auto-excluded-row-${REF_WIN_LATE}`);
    const includeBtn = within(lateRow).getByTestId(
      `auto-excluded-include-${REF_WIN_LATE}`,
    );
    expect(includeBtn).toHaveTextContent("Include → moves window start to");
    expect(includeBtn).not.toHaveTextContent("shortens window");
    expect(includeBtn).toHaveTextContent("2026-01-04");
    // The month cost is reconcilable with the shown (start) bound: the head
    // pulls forward 3 days (01-01 → 01-04), which floors to a "−1 mo" delta.
    expect(includeBtn.textContent).toMatch(/−1 mo/);

    // Clicking Include narrows the window to the intersection that re-admits LATE
    // (the START moves to 2026-01-04); the REAL engine member_count rises to 2.
    act(() => {
      fireEvent.click(includeBtn);
    });
    expect(lastScenarioMetrics()?.member_count).toBe(2);
    expect(lastScenarioMetrics()?.member_ids).toEqual(
      expect.arrayContaining([REF_WIN_A, REF_WIN_LATE]),
    );
    expect(
      screen.queryByTestId(`auto-excluded-row-${REF_WIN_LATE}`),
    ).not.toBeInTheDocument();
    // The applied window is exactly the intersection [2026-01-04, 2026-01-12] —
    // the disclosed start bound is the one that actually moved.
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-04 → 2026-01-12");
  });

  // WR-02 — the BOTH-ends-ragged branch. When a strategy begins after the window
  // start AND ends before the window end, both bounds move; a single-date label
  // ("shortens window to {end}") with a two-ended month cost cannot be
  // reconciled (the head shift is silent). The label must name BOTH moved dates
  // so the shown span and the "−{N} mo" cost agree.
  it("COVERAGE-04: a BOTH-ends-ragged auto-excluded row discloses both moved bounds ('shortens window to {start}–{end}') so the month cost reconciles (WR-02)", () => {
    const REF_WIN_MID = "strat-window-mid";
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES), // 2026-01-01 … 2026-01-12
        mkWinStrat(REF_WIN_MID, WIN_DATES.slice(3, 9)), // 2026-01-04 … 2026-01-09 (ragged BOTH ends)
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_MID]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_MID]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Default window = [2026-01-04, 2026-01-09] (max firsts / min lasts) → both
    // A and MID are members.
    expect(lastScenarioMetrics()?.member_count).toBe(2);

    // Widen the window to the full range [2026-01-01, 2026-01-12]. MID's span
    // [01-04, 01-09] falls INSIDE on both ends → MID is dropped (ragged both
    // ends). A is the sole member.
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);

    // The include button names BOTH moved bounds (start–end) — not a single date
    // — so the "−{N} mo" cost (head + tail shift) reconciles against what is
    // shown. The intersection that re-admits MID is [2026-01-04, 2026-01-09].
    const midRow = screen.getByTestId(`auto-excluded-row-${REF_WIN_MID}`);
    const includeBtn = within(midRow).getByTestId(
      `auto-excluded-include-${REF_WIN_MID}`,
    );
    expect(includeBtn).toHaveTextContent("Include → shortens window to");
    expect(includeBtn).toHaveTextContent("2026-01-04–2026-01-09");
    // Head +3 days (01-01 → 01-04) and tail −3 days (01-12 → 01-09) = 6 days →
    // floors to "−1 mo". The single number now names a span, not one bound.
    expect(includeBtn.textContent).toMatch(/−1 mo/);

    // Clicking Include narrows to the both-ends intersection; member_count rises.
    act(() => {
      fireEvent.click(includeBtn);
    });
    expect(lastScenarioMetrics()?.member_count).toBe(2);
    expect(lastScenarioMetrics()?.member_ids).toEqual(
      expect.arrayContaining([REF_WIN_A, REF_WIN_MID]),
    );
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-04 → 2026-01-09");
  });

  it("COVERAGE-04: applying a window (the include path) NEVER reselects a manually-off strategy — manual-off stays sticky (T-58-05)", () => {
    // Mount B as MANUALLY-OFF (selected: false). A stays selected. Because B is
    // not selected it never appears in the auto-excluded group (that group is
    // coverage-drops of SELECTED strategies only) — so it carries no include
    // button. The invariant under test: the applyWindow path the include button
    // uses NEVER flips `selected`, so no window move can silently re-admit B.
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES), // 2026-01-01 … 2026-01-12
        mkWinStrat(REF_WIN_B, WIN_DATES.slice(0, 6)), // 2026-01-01 … 2026-01-06
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: false }, // B manually OFF
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Only A is a member (B is manually off — never in the blend, never
    // auto-excluded). B has no include button.
    expect(lastScenarioMetrics()?.member_count).toBe(1);
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);
    expect(
      screen.queryByTestId(`auto-excluded-row-${REF_WIN_B}`),
    ).not.toBeInTheDocument();

    // Apply a window (the same setter the include button uses) whose bounds B
    // WOULD cover if it were selected ([2026-01-01, 2026-01-06] = B's own span).
    // The window-move MUST NOT flip B back on — applyWindow only moves the window,
    // it never touches `selected` (WINDOW-03 subset-only / T-58-05). B stays off.
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-06" });
    });
    // Divisor stays 1 (A only) — B was NOT silently re-admitted by the window
    // move; the manually-off strategy is sticky.
    expect(lastScenarioMetrics()?.member_count).toBe(1);
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);
  });

  it("window: when the intersection is empty, the engine receives a state WITHOUT a window key (union path preserved)", () => {
    // Two DISJOINT spans → defaultWindowFor(spans) === null → nothing to seed →
    // engineState === deAliased.state (no `window` key added; union-when-absent).
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES.slice(0, 4)), // 01-01 … 01-04
        mkWinStrat(REF_WIN_B, WIN_DATES.slice(8, 12)), // 01-09 … 01-12
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({
          holdingsSummary: [HOLDING_BTC, HOLDING_ETH],
        })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The composed-branch computeScenario call (its strategies carry the window
    // fixtures) receives a state with NO window key.
    const composedArgs = computeScenarioStateArgs.filter(
      (a) =>
        a.strategyIds.includes(REF_WIN_A) && a.strategyIds.includes(REF_WIN_B),
    );
    expect(composedArgs.length).toBeGreaterThan(0);
    for (const a of composedArgs) {
      expect("window" in a.state).toBe(false);
    }
  });
});

// ===========================================================================
// Phase 57 Plan 02 Task 2 — the two coverage presets (WINDOW-04, WINDOW-05)
// ===========================================================================
describe("ScenarioComposer — Phase 57 coverage-window presets (WINDOW-04/05)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  it("preset: both preset buttons and the picker trigger have accessible names", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Common period \(all in\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Full range \(some drop out\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set coverage window/i }),
    ).toBeInTheDocument();
  });

  it("preset: 'Common period (all in)' snaps the window to the intersection — all selected strategies are members", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // First widen so the state is off the default, then snap back via the preset.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: /Common period \(all in\)/i }),
    );
    // Intersection = [2026-01-01, 2026-01-06] → BOTH A and B cover it.
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(2);
    // The applied window is exactly the intersection.
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");
  });

  it("preset: 'Full range (some drop out)' widens to the union — the short-span strategy drops (member_count < selected count)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Default = intersection → both in.
    expect(lastScenarioMetrics()?.member_count).toBe(2);

    fireEvent.click(
      screen.getByRole("button", { name: /Full range \(some drop out\)/i }),
    );
    // Union = [2026-01-01, 2026-01-12] → only A (full span) covers it; B drops.
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(1);
    expect(sm?.member_ids).toEqual([REF_WIN_A]);
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-12");
  });

  it("preset: 'Common period' is disabled on an empty intersection; 'Full range' stays enabled", () => {
    // Two DISJOINT spans → defaultWindowFor === null (empty intersection).
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES.slice(0, 4)), // 01-01 … 01-04
        mkWinStrat(REF_WIN_B, WIN_DATES.slice(8, 12)), // 01-09 … 01-12
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const common = screen.getByRole("button", {
      name: /Common period \(all in\)/i,
    });
    const full = screen.getByRole("button", {
      name: /Full range \(some drop out\)/i,
    });
    expect(common).toBeDisabled();
    expect(common).toHaveAttribute("aria-disabled", "true");
    expect(full).toBeEnabled();
  });

  it("preset: no separate picker component is forked — the reused CustomRangePicker carries min = union earliest first", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    expect(lastPickerProps).not.toBeNull();
    // min = union earliest first = 2026-01-01 (local midnight).
    expect(isoDayFromDate(lastPickerProps!.min)).toBe("2026-01-01");
    // max = union latest last or today (whichever is later); today > Jan 2026 in
    // this fixture era only if the machine clock is future — assert it is at
    // least the union end.
    expect(isoDayFromDate(lastPickerProps!.max) >= "2026-01-12").toBe(true);
  });
});

// ===========================================================================
// Phase 57 Plan 02 Task 3 — POLISH-01 separation guard (LOCKED)
//
// The coverage window [winStart,winEnd] (analytical membership) is a DISTINCT
// axis from every VIEW axis. This guard proves none of them can leak into
// another:
//   (a) rollingWindow (63/126/252) — the rolling-metrics view of the blend series
//   (b) the ScenarioFactsheetChart MasterBrush brush-zoom (persist=false view pan)
//   (c) per-strategy startDates — the legacy include-from axis
// ===========================================================================
describe("ScenarioComposer — Phase 57 POLISH-01 separation guard", () => {
  // A 130-trading-day fixture so BOTH the 63-day ("3M") AND 126-day ("6M")
  // rolling windows are enabled and clickable (the 12-day fixtures above leave
  // every rolling option disabled; the default active window is 6M=126). Dates
  // are consecutive calendar days from 2026-01-01, sufficient for the rolling
  // usableN gate (which counts overlapping daily-return rows, not trading days).
  const LONG_DATES = Array.from({ length: 130 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  it("POLISH-01: changing the rolling window (3M/6M/12M) does NOT change the state.window passed to computeScenario", () => {
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, LONG_DATES),
        mkWinStrat(REF_WIN_B, LONG_DATES),
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The window value the engine currently sees (both spans equal → full
    // intersection window covering everything).
    const windowBefore = computeScenarioStateArgs
      .filter(
        (a) =>
          a.strategyIds.includes(REF_WIN_A) &&
          a.strategyIds.includes(REF_WIN_B),
      )
      .at(-1)?.state.window;
    expect(windowBefore).toBeDefined();

    computeScenarioStateArgs.length = 0;

    // Change the ROLLING window (a separate VIEW axis). Click "3M" (63) in the
    // "Rolling window" group.
    const rollingGroup = screen.getByRole("group", { name: /rolling window/i });
    fireEvent.click(within(rollingGroup).getByRole("button", { name: "3M" }));

    // The coverage window the engine sees is UNCHANGED — rolling is a view of the
    // blend series, never the analytical membership window.
    const windowAfter = computeScenarioStateArgs
      .filter(
        (a) =>
          a.strategyIds.includes(REF_WIN_A) &&
          a.strategyIds.includes(REF_WIN_B),
      )
      .at(-1)?.state.window;
    // If the rolling click triggered no recompute (window is state-only), the
    // last-known window is still the pre-click one; either way it must equal it.
    expect(windowAfter ?? windowBefore).toEqual(windowBefore);
    // The coverage-window READOUT is unchanged by a rolling-window click.
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain(
      `${(windowBefore as { start: string }).start} → ${(windowBefore as { end: string }).end}`,
    );
  });

  it("POLISH-01: ScenarioFactsheetChart's brush stays a VIEW axis — the mount receives NO coverage-window prop and no persist prop", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Move the coverage window (widen to union) so a leak, if any, would surface.
    fireEvent.click(
      screen.getByRole("button", { name: /Full range \(some drop out\)/i }),
    );

    const props = vi.mocked(ScenarioFactsheetChart).mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(props).toBeDefined();
    // The coverage window is NEVER threaded to the factsheet chart — the brush is
    // a self-contained persist=false view control (POLISH-01). None of these
    // coverage-window prop names appear on the mount.
    for (const forbidden of [
      "window",
      "coverageWindow",
      "winStart",
      "winEnd",
      "winRange",
      "persist",
    ]) {
      expect(forbidden in props!).toBe(false);
    }
  });

  it("POLISH-01: source guard — the composer never passes persist / a coverage-window prop to ScenarioFactsheetChart, and the brush stays persist=false", () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "ScenarioComposer.tsx",
      ),
      "utf8",
    );
    // The composer mount block for ScenarioFactsheetChart must not pass persist
    // nor thread the coverage window into it.
    const mountIdx = src.indexOf("<ScenarioFactsheetChart");
    expect(mountIdx).toBeGreaterThan(-1);
    const mountBlock = src.slice(mountIdx, src.indexOf("/>", mountIdx));
    expect(mountBlock).not.toMatch(/persist=/);
    expect(mountBlock).not.toMatch(/winStart|winEnd|coverageWindow/);
    // The brush-zoom stays persist=false inside ScenarioFactsheetChart itself.
    const chartSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "widgets",
        "performance",
        "ScenarioFactsheetChart.tsx",
      ),
      "utf8",
    );
    expect(chartSrc).toMatch(/persist=\{false\}/);
  });

  it("POLISH-01: changing the coverage window leaves rollingWindow and per-strategy startDates untouched", () => {
    // Both strategies full 130-day spans so the default 6M (126) rolling window
    // is ENABLED (usableN = 130 >= 126). A carries a legacy include-from
    // startDate — the third distinct axis.
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, LONG_DATES),
        mkWinStrat(REF_WIN_B, LONG_DATES),
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_B]: 0.5 },
        // A per-strategy startDate on A — the legacy include-from axis.
        startDates: { [REF_WIN_A]: LONG_DATES[5] },
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );

    // Record the active rolling-window button before touching the coverage window.
    const rollingGroup = screen.getByRole("group", { name: /rolling window/i });
    const activeBefore = within(rollingGroup)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;
    expect(activeBefore).toBe("6M"); // default 126

    // Record startDates flowing into the engine before the coverage change.
    const startDatesBefore = computeScenarioStateArgs
      .filter((a) => a.strategyIds.includes(REF_WIN_A))
      .at(-1)?.state.startDates;
    expect(startDatesBefore).toEqual({ [REF_WIN_A]: LONG_DATES[5] });

    // Change the COVERAGE window via the picker (narrow it slightly, keeping
    // >=126 overlapping days so the 6M rolling option's ENABLED state is not a
    // confound). This must NOT touch the rolling window nor per-strategy
    // startDates — the coverage window is a distinct axis.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: LONG_DATES[1], end: LONG_DATES[129] });
    });

    const activeAfter = within(rollingGroup)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;
    expect(activeAfter).toBe("6M"); // rolling window unchanged

    const startDatesAfter = computeScenarioStateArgs
      .filter((a) => a.strategyIds.includes(REF_WIN_A))
      .at(-1)?.state.startDates;
    // The legacy include-from axis is byte-identical across a coverage-window edit.
    expect(startDatesAfter).toEqual(startDatesBefore);
  });
});

// ===========================================================================
// Phase 57 Plan 03 Task 1 — coverageEligible auto-toggle state machine
// (WINDOW-02 widen→auto-off, WINDOW-03 narrow→auto-on, subset-only guard)
//
// The auto-excluded GROUP (Task 2) is the UI proof of coverage-off; here the
// oracle is the ENGINE membership (`member_count`/`member_ids` on the real
// computeScenario — @/lib/scenario + @/lib/scenario-dealias are un-mocked). The
// composer's coverageEligible memo uses the SAME `covers(coverageSpanOf(...))`
// predicate the engine applies, so the UI group and the engine divisor can
// never disagree — and `selected` (the manual subset axis) is never mutated by
// a coverage change.
// ===========================================================================
describe("ScenarioComposer — Phase 57 Plan 03 auto-toggle (WINDOW-02/03)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  it("WINDOW-02: widening the window past B's last day auto-excludes B (member_count 2 → 1)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Default intersection window → both members.
    expect(lastScenarioMetrics()?.member_count).toBe(2);

    // Widen winEnd past B's last data day (01-06 → 01-12): coverageEligible[B]
    // flips false (its span no longer covers the window) → B drops from the blend
    // AND the divisor. member_count === 1, member_ids === [A].
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(1);
    expect(sm?.member_ids).toEqual([REF_WIN_A]);
  });

  it("WINDOW-03: narrowing back within B's coverage auto-restores it (member_count 1 → 2)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Widen → B auto-excluded.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    expect(lastScenarioMetrics()?.member_count).toBe(1);

    // Narrow winEnd back within B's coverage (→ 01-06): coverageEligible[B] flips
    // true → B returns to the blend. Not a one-way latch.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-06" });
    });
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(2);
    expect(sm?.member_ids).toEqual(
      expect.arrayContaining([REF_WIN_A, REF_WIN_B]),
    );
  });

  it("WINDOW-03 subset-only: an UNSELECTED strategy is NEVER auto-added even when the window covers it", () => {
    // B is FULL-span (01-01…01-12) but manually OFF (selected=false). A is short
    // (01-01…01-06). The default window is A's span; a narrow to A's span "covers"
    // B (B's span ⊇ [01-01,01-06]) — but B must stay OUT because it is not in the
    // selected subset. coverageEligible is consulted for SELECTED strategies only;
    // in-blend = selected && coverageEligible.
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES.slice(0, 6)), // 01-01 … 01-06 (selected)
        mkWinStrat(REF_WIN_B, WIN_DATES), // 01-01 … 01-12 (UNSELECTED)
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: false },
        weights: { [REF_WIN_A]: 1, [REF_WIN_B]: 0 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Only A is selected → only A is a member, even though B's span covers the
    // window. The engine's activeStrategies filter (selected truthy) already
    // excludes B; the UI never fabricates its inclusion.
    const sm = lastScenarioMetrics();
    expect(sm?.member_count).toBe(1);
    expect(sm?.member_ids).toEqual([REF_WIN_A]);

    // Snap to A's intersection window (which fully covers B's span too) and
    // re-assert: B is STILL excluded (subset-only, not coverage).
    fireEvent.click(
      screen.getByRole("button", { name: /Common period \(all in\)/i }),
    );
    const after = lastScenarioMetrics();
    expect(after?.member_count).toBe(1);
    expect(after?.member_ids).toEqual([REF_WIN_A]);
  });

  it("dev-invariant: { selected && coverageEligible } === member_ids on a passthrough set (UI group never desyncs from the divisor)", () => {
    // Both selected, unequal spans, widen so exactly one drops for coverage. The
    // engine's member_ids is the ground truth; the composer derives the same set
    // from selected && coverageEligible on the SAME deAliased strategies. On a
    // passthrough (non-aliased) book they align 1:1 — assert it directly.
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    // member_ids = the coverage-eligible selected set. A covers [01-01,01-12], B
    // does not → member_ids === [A]. This is exactly { selected && eligible }.
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);
  });

  it("selected is NOT mutated by a window change — the toggle map is coverage-independent", () => {
    // Widening past B for coverage must not flip B's `selected` (manual axis). The
    // engine state arg carries `selected`; assert B stays selected=true across the
    // widen (only coverageEligible, an ephemeral derivation, changes).
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    const composedArg = computeScenarioStateArgs
      .filter(
        (a) =>
          a.strategyIds.includes(REF_WIN_A) &&
          a.strategyIds.includes(REF_WIN_B),
      )
      .at(-1);
    expect(composedArg).toBeDefined();
    // B is coverage-excluded from the blend but STILL selected (its span is not a
    // member of the widened window, yet `selected[B]` is untouched).
    expect(
      (composedArg!.state.selected as Record<string, boolean>)[REF_WIN_B],
    ).toBe(true);
  });
});

// ===========================================================================
// Phase 57 Plan 03 Task 2 — auto-excluded group + inline reason + animation
// (POLISH-02)
//
// A coverage-dropped row (selected && !coverageEligible) renders in a distinct
// "Auto-excluded (outside window)" group with a minimal honest inline reason,
// animates (fade+slide) into place respecting prefers-reduced-motion, and stays
// separate from manual-off. The group is absent when nothing is dropped.
// ===========================================================================
describe("ScenarioComposer — Phase 57 Plan 03 auto-excluded group (POLISH-02)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  it("auto-excluded: a coverage-dropped strategy renders in the group with an inline reason", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Widen past B's last day → B is coverage-auto-excluded.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });

    // The group renders with an accessible label naming it.
    const group = screen.getByTestId("scenario-auto-excluded-group");
    expect(group).toBeInTheDocument();
    expect(
      within(group).getByText(/Auto-excluded \(outside window\)/i),
    ).toBeInTheDocument();

    // B's row is inside it, with a minimal honest reason (real text).
    const row = within(group).getByTestId(`auto-excluded-row-${REF_WIN_B}`);
    expect(row).toBeInTheDocument();
    const reason = within(row).getByTestId("auto-excluded-reason");
    // B ends 2026-01-06 (< window end 2026-01-12) → "ends Jan 2026 — outside window".
    expect(reason).toHaveTextContent(/outside window/i);
    expect(reason).toHaveTextContent(/ends Jan 2026/i);
    // Real text, not color-only.
    expect(reason.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("auto-excluded: a ragged-head strategy (starts after the window start) reads 'starts {Mon}'", () => {
    // Distinct from the "ends {Mon}" tail branch above: this exercises the OTHER
    // coverageDropReason branch (span.first > window.start). A: full 01-01…01-12.
    // LATE: starts 01-03. A window opening on 01-01 covers A but NOT LATE (its
    // first day 01-03 falls after winStart) → LATE is coverage-excluded and its
    // row must read "starts Jan 2026 — outside window", not the tail phrasing.
    const REF_WIN_LATE = "strat-window-late";
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES), // 01-01 … 01-12
        mkWinStrat(REF_WIN_LATE, WIN_DATES.slice(2)), // 01-03 … 01-12 (ragged head)
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_LATE]: true },
        weights: { [REF_WIN_A]: 0.5, [REF_WIN_LATE]: 0.5 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Open the window on 01-01 (before LATE's first day) through 01-12.
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    // A is the sole member; LATE is auto-excluded for STARTING after winStart.
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_WIN_A]);
    const row = screen.getByTestId(`auto-excluded-row-${REF_WIN_LATE}`);
    const reason = within(row).getByTestId("auto-excluded-reason");
    expect(reason).toHaveTextContent(/starts Jan 2026/i);
    expect(reason).toHaveTextContent(/outside window/i);
  });

  it("auto-excluded: the animated row uses duration-300 + ease-out + motion-reduce:transition-none on every transition-carrying element", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    const row = screen.getByTestId(`auto-excluded-row-${REF_WIN_B}`);
    const cls = row.className;
    // DESIGN.md Motion: medium 250ms → Tailwind duration-300 (duration-250 is not
    // a valid v4 token and silently drops).
    expect(cls).toContain("duration-300");
    expect(cls).not.toContain("duration-250");
    expect(cls).toContain("ease-out");
    // Pitfall 5 — reduced-motion honoured on EVERY element carrying a transition.
    expect(cls).toContain("motion-reduce:transition-none");
    // No transition-* utility may exist without the reduced-motion guard.
    const transitionCarriers = Array.from(
      row.querySelectorAll<HTMLElement>('[class*="transition"]'),
    ).concat(cls.includes("transition") ? [row] : []);
    for (const el of transitionCarriers) {
      expect(el.className).toContain("motion-reduce:transition-none");
    }
  });

  it("auto-excluded: the group is ABSENT when no strategy is coverage-dropped", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // Default intersection window → both members, nothing dropped.
    expect(lastScenarioMetrics()?.member_count).toBe(2);
    expect(
      screen.queryByTestId("scenario-auto-excluded-group"),
    ).not.toBeInTheDocument();
  });

  it("auto-excluded: manual-off rows are NOT in the auto-excluded group (the two states stay distinct)", () => {
    // A selected + short-span; B UNSELECTED (manual-off) + full-span. Narrow to
    // A's span so B WOULD be coverage-eligible — but B is manual-off, so it must
    // NOT appear in the coverage-auto-excluded group (and there is nothing
    // coverage-dropped, so the group is absent entirely).
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_WIN_A, WIN_DATES.slice(0, 6)), // selected, 01-01…01-06
        mkWinStrat(REF_WIN_B, WIN_DATES), // UNSELECTED, 01-01…01-12
      ],
      state: {
        selected: { [REF_WIN_A]: true, [REF_WIN_B]: false },
        weights: { [REF_WIN_A]: 1, [REF_WIN_B]: 0 },
        startDates: {},
      },
    });
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The manual-off B is never in the auto-excluded group.
    expect(
      screen.queryByTestId(`auto-excluded-row-${REF_WIN_B}`),
    ).not.toBeInTheDocument();
    // Nothing is coverage-dropped → group absent.
    expect(
      screen.queryByTestId("scenario-auto-excluded-group"),
    ).not.toBeInTheDocument();
  });

  it("auto-excluded: the group uses DESIGN.md warning tokens (no raw hex / px)", () => {
    mountUnequalSpanBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set coverage window/i }));
    act(() => {
      pickerOnApply!({ start: "2026-01-01", end: "2026-01-12" });
    });
    const group = screen.getByTestId("scenario-auto-excluded-group");
    const cls = group.className;
    // DESIGN.md warning-token utility classes (bg / border / text), no raw hex.
    expect(cls).toMatch(/warning/);
    expect(cls).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(cls).not.toMatch(/\[\d+px\]/);
  });
});

// ===========================================================================
// Phase 57 Plan 03 Task 3 — empty-intersection warning banner + deselect
// (WINDOW-06)
//
// When the SELECTED set shares no common window (defaultWindowFor === null), an
// inline warning banner names the outlier(s) via outlierIdsFor and offers a
// one-click "Deselect {name}" that removes the outlier from the subset —
// restoring a non-null intersection (guided fix, not a dead-end). Absent when
// the set has a common window.
// ===========================================================================
describe("ScenarioComposer — Phase 57 Plan 03 empty-intersection banner (WINDOW-06)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
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

  // Two DISJOINT-span HOLDINGS keyed on the REAL holding scopeRefs (REF_BTC /
  // REF_ETH) so the deselect handler's `scenario.toggleHolding(scopeRef)` path is
  // exercised faithfully — the draft (seeded by defaultDraftFromHoldings) carries
  // these refs as toggle=true, so toggling flips them genuinely to false. ETH is
  // the outlier (latest start: 01-09…01-12 pushes the overlap empty).
  const BTC_EARLY = WIN_DATES.slice(0, 4); // 01-01 … 01-04
  const ETH_LATE = WIN_DATES.slice(8, 12); // 01-09 … 01-12
  /** Two DISJOINT-span holdings → empty intersection → outlier = REF_ETH. */
  function mountDisjointBook(): void {
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [
        mkWinStrat(REF_BTC, BTC_EARLY),
        mkWinStrat(REF_ETH, ETH_LATE),
      ],
      state: {
        selected: { [REF_BTC]: true, [REF_ETH]: true },
        weights: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
        startDates: {},
      },
    });
  }

  it("WINDOW-06: an empty-intersection selected set renders a warning banner naming the outlier + a Deselect button", () => {
    mountDisjointBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    const banner = screen.getByTestId("scenario-empty-intersection-banner");
    expect(banner).toBeInTheDocument();
    // role/aria for a NON-blocking guided fix: role=status + aria-live=polite per
    // DESIGN-05 (role=alert is reserved for blocking errors; this banner is an
    // explicitly non-blocking, recoverable guided fix, so it announces politely).
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    // The outlier is named (ETH is the latest-start holding breaking the overlap).
    expect(
      within(banner).getAllByText(new RegExp(REF_ETH)).length,
    ).toBeGreaterThan(0);
    // A "Deselect {name}" button with an accessible name naming the strategy.
    expect(
      within(banner).getByRole("button", {
        name: new RegExp(`Deselect ${REF_ETH}`, "i"),
      }),
    ).toBeInTheDocument();
  });

  it("WINDOW-06: clicking Deselect removes the outlier, the banner disappears, and a valid intersection is restored", () => {
    mountDisjointBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        // Own allocatorId: this test MUTATES (Deselect → toggleHolding) and the
        // draft hook persists on a 150ms debounce (H-0125) that is not cancelled
        // on unmount. Under slower CI the leaked write lands after teardown and
        // pollutes a later test that shares the key (ETH-deselected draft →
        // BTC-only → no empty intersection → banner absent). A per-test key
        // isolates the write. (Deterministic in CI, green locally — this branch's
        // first CI run surfaced it.)
        allocatorId={`${ALLOCATOR_A}-w06-deselect`}
        allocatorMandate={null}
      />,
    );
    const banner = screen.getByTestId("scenario-empty-intersection-banner");
    fireEvent.click(
      within(banner).getByRole("button", {
        name: new RegExp(`Deselect ${REF_ETH}`, "i"),
      }),
    );
    // Banner gone (only BTC remains selected → single-span intersection non-null).
    expect(
      screen.queryByTestId("scenario-empty-intersection-banner"),
    ).not.toBeInTheDocument();
    // A common window exists again → the window control is present and the engine
    // blends the remaining member (BTC) over a valid window.
    expect(
      screen.getByTestId("scenario-coverage-window"),
    ).toBeInTheDocument();
    expect(lastScenarioMetrics()?.member_ids).toEqual([REF_BTC]);
  });

  it("WINDOW-06: the banner is ABSENT when the selected set has a common window", () => {
    mountUnequalSpanBook(); // A + B overlap on 01-01…01-06
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    expect(
      screen.queryByTestId("scenario-empty-intersection-banner"),
    ).not.toBeInTheDocument();
  });

  it("WINDOW-06: the banner uses DESIGN.md warning tokens (no raw hex / px)", () => {
    mountDisjointBook();
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        // Own allocatorId so a debounced draft write leaked from the mutating
        // Deselect test above (150ms, not cancelled on unmount) can never
        // hydrate here on slower CI and turn this disjoint book BTC-only.
        allocatorId={`${ALLOCATOR_A}-w06-tokens`}
        allocatorMandate={null}
      />,
    );
    const cls = screen.getByTestId("scenario-empty-intersection-banner")
      .className;
    expect(cls).toMatch(/warning/);
    expect(cls).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(cls).not.toMatch(/\[\d+px\]/);
  });
});

// ===========================================================================
// Phase 59 Plan 02 (PERSIST-01) — reopen seeds the coverage window from the
// saved draft, and the provenance note is shown ONLY for an upgraded-v2 draft.
//
// The window is Phase-57 composer-LOCAL state (winStart/winEnd → coverageWindow),
// seeded on mount from the intersection of the selected spans. On reopen:
//   • a v3 draft WITH a window applies it VERBATIM (windowTouchedRef stays true →
//     the auto-default effect never overrides it) — recompute at the saved
//     window, no stored series replayed;
//   • an upgraded-v2 (windowless) draft releases the window gate so the effect
//     re-seeds the intersection ("common period") AND raises the provenance note
//     (decode reason "upgraded_v2_windowless");
//   • a fresh v3 draft with no window defaults to the intersection but NEVER
//     shows the note.
// The unequal-span book (A: 01-01…01-12, B: 01-01…01-06) gives a non-null
// windowBounds (so the control + note slot mount) and a known intersection
// [2026-01-01, 2026-01-06].
// ===========================================================================
describe("ScenarioComposer — Phase 59 reopen window + provenance (PERSIST-01)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    computeScenarioStateArgs.length = 0;
    vi.mocked(buildStrategyForBuilderSet).mockReturnValue({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    browseOnAdd = null;
    pickerOnApply = null;
    lastPickerProps = null;
    cleanup();
  });

  /** A v3 draft carrying an explicit coverage window (owner's saved window). */
  function v3DraftWithWindow(window: { start: string; end: string }) {
    return {
      ...defaultDraftFromHoldings([
        HOLDING_BTC,
        HOLDING_ETH,
      ] as Parameters<typeof defaultDraftFromHoldings>[0]),
      window,
    };
  }

  /** A pre-v1.5 v2 draft (no window). The codec upgrades it on read to outcome
   *  "ok" + reason "upgraded_v2_windowless". Built by taking a valid current
   *  draft and stamping schema_version back to the prior version. */
  function upgradedV2Draft() {
    return {
      ...defaultDraftFromHoldings([
        HOLDING_BTC,
        HOLDING_ETH,
      ] as Parameters<typeof defaultDraftFromHoldings>[0]),
      schema_version: 2,
    };
  }

  /** A fresh v3 draft with no window (a v3 saved before a window was chosen). */
  function freshV3Windowless() {
    return defaultDraftFromHoldings([
      HOLDING_BTC,
      HOLDING_ETH,
    ] as Parameters<typeof defaultDraftFromHoldings>[0]);
  }

  it("PERSIST-01: reopening a v3 draft WITH a window seeds the composer window VERBATIM (readout shows the saved window, not the intersection default), no provenance note", () => {
    mountUnequalSpanBook();
    let openSaved:
      | ((row: { id: string; name: string; draft: unknown }) => void)
      | null = null;
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={`${ALLOCATOR_A}-p59-v3win`}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          openSaved = open;
        }}
      />,
    );

    // Baseline: the mount auto-default seeded the intersection [01-01, 01-06].
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");

    // Reopen a v3 draft whose SAVED window is a NARROWER [01-02, 01-05] — a value
    // the intersection default would never produce, so it can only be the applied
    // saved window (proving reopen seeds from draft.window, not a re-derivation).
    act(() => {
      openSaved?.({
        id: "saved-v3-win",
        name: "V3 with window",
        draft: v3DraftWithWindow({ start: "2026-01-02", end: "2026-01-05" }),
      });
    });

    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-02 → 2026-01-05");
    // No provenance note for a fresh v3-with-window open.
    expect(
      screen.queryByTestId("scenario-provenance-note"),
    ).not.toBeInTheDocument();
  });

  it("PERSIST-01: reopening an upgraded-v2 (windowless) draft defaults the window to the intersection AND shows the provenance note", () => {
    mountUnequalSpanBook();
    let openSaved:
      | ((row: { id: string; name: string; draft: unknown }) => void)
      | null = null;
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={`${ALLOCATOR_A}-p59-v2up`}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          openSaved = open;
        }}
      />,
    );

    // First narrow the window to prove the reopen RESETS it to the intersection
    // default (not merely inherits the mount seed).
    fireEvent.click(
      screen.getByRole("button", { name: /set coverage window/i }),
    );
    act(() => {
      pickerOnApply?.({ start: "2026-01-03", end: "2026-01-04" });
    });
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-03 → 2026-01-04");
    // No note yet — this is a live edit, not an upgraded-v2 reopen.
    expect(
      screen.queryByTestId("scenario-provenance-note"),
    ).not.toBeInTheDocument();

    // Reopen a pre-v1.5 v2 draft — the codec upgrades it (ok + provenance) and
    // the composer defaults the window to the intersection [01-01, 01-06].
    act(() => {
      openSaved?.({
        id: "saved-v2",
        name: "Pre-window scenario",
        draft: upgradedV2Draft(),
      });
    });

    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");
    // The provenance note appears with the locked copy + the escape hatch.
    const note = screen.getByTestId("scenario-provenance-note");
    expect(note.textContent).toMatch(/predates coverage windows/);
    expect(
      within(note).getByRole("button", { name: /Show full range/i }),
    ).toBeInTheDocument();
  });

  it("PERSIST-01: reopening a fresh v3 draft with no window defaults to the intersection but NEVER shows the provenance note", () => {
    mountUnequalSpanBook();
    let openSaved:
      | ((row: { id: string; name: string; draft: unknown }) => void)
      | null = null;
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={`${ALLOCATOR_A}-p59-v3fresh`}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          openSaved = open;
        }}
      />,
    );

    act(() => {
      openSaved?.({
        id: "saved-v3-fresh",
        name: "Fresh v3 windowless",
        draft: freshV3Windowless(),
      });
    });

    // Intersection default applies (windowless v3 → same rule) …
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");
    // … but a fresh v3 is NOT a pre-window upgrade, so no provenance note.
    expect(
      screen.queryByTestId("scenario-provenance-note"),
    ).not.toBeInTheDocument();
  });

  it("PERSIST-01: the provenance note is EPHEMERAL — opening a fresh v3 after an upgraded-v2 open clears it", () => {
    mountUnequalSpanBook();
    let openSaved:
      | ((row: { id: string; name: string; draft: unknown }) => void)
      | null = null;
    render(
      <ScenarioComposer
        payload={makePayload({ holdingsSummary: [HOLDING_BTC, HOLDING_ETH] })}
        allocatorId={`${ALLOCATOR_A}-p59-ephemeral`}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          openSaved = open;
        }}
      />,
    );

    // Upgraded-v2 open → note shows.
    act(() => {
      openSaved?.({
        id: "saved-v2-a",
        name: "Old A",
        draft: upgradedV2Draft(),
      });
    });
    expect(
      screen.getByTestId("scenario-provenance-note"),
    ).toBeInTheDocument();

    // Now open a fresh v3-with-window scenario → the note must clear (it does not
    // persist across opens — a per-scenario provenance signal, Pitfall 3).
    act(() => {
      openSaved?.({
        id: "saved-v3-b",
        name: "Fresh B",
        draft: v3DraftWithWindow({ start: "2026-01-02", end: "2026-01-05" }),
      });
    });
    expect(
      screen.queryByTestId("scenario-provenance-note"),
    ).not.toBeInTheDocument();
  });
});
