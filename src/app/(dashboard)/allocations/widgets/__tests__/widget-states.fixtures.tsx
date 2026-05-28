/**
 * Phase 11 / Plan 04 / D-09 / D-12 / W-01 — Per-widget × per-state fixtures
 * for the 7 DEFAULT_LAYOUT widgets (the surfaces a new LP sees in their
 * first 10 minutes per the phase goal).
 *
 * Each entry is TYPED against the widget's actual data contract (the
 * universal `WidgetProps.data` slot carries `MyAllocationDashboardPayload`-
 * shaped payloads in production, so success fixtures are typed as
 * `Partial<MyAllocationDashboardPayload>`). D-12 LOCKED — no `any` in
 * this file.
 *
 * W-01: this file ships with 5 representative entries pre-filled
 * (one per widget category — KPI, chart, table, sparkline, generic
 * card) plus the 2 final entries (bridge, outcomes) for full
 * DEFAULT_LAYOUT coverage. Every entry gets a `successFixture` that
 * is the smallest VALID payload the widget renders without throwing.
 *
 * Long-tail WIDGET_REGISTRY widgets (39 - 7 = 32) get coverage via
 * the universal <WidgetState> wrapper only; per-state fixtures for
 * those are deferred to Phase 11+1 per CONTEXT <deferred>. RISK-1
 * gates universal-rollout consumption behind the widget_state_v2
 * feature flag (see src/lib/widget-state-flag.ts).
 */
import type { ReactElement } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { WidgetStateProps } from "../../components/WidgetState";

// === Widget imports ===
// All seven DEFAULT_LAYOUT widgets share the universal `WidgetProps`
// contract from `lib/types.ts` (`{ data, timeframe, width, height }`),
// so the fixture surface is the `data` payload only.
import BridgeHeroWidget from "../bridge/BridgeHeroWidget";
import KpiStripWidget from "../meta/KpiStripWidget";
import EquityChartWidget from "../performance/EquityChart";
import HoldingsTableWidget from "../positions/HoldingsTableWidget";
import AllocationByStyleWidget from "../allocation/AllocationByStyleWidget";
import { MandateSnapshotWidget } from "../risk/MandateSnapshotWidget";
import OutcomesWidget from "../outcomes/OutcomesWidget";

/**
 * Common non-success state props the primitive consumes directly.
 * The matrix test mounts these verbatim (no widget body) so each test
 * exercises the primitive's branch dispatch, not the widget body.
 */
export const commonStateProps = {
  loading: { mode: "loading" } satisfies WidgetStateProps,
  empty: {
    mode: "empty",
    empty: {
      title: "Nothing to show yet",
      description: "Connect a key to populate this widget.",
      ctaHref: "/profile?tab=exchanges",
      ctaLabel: "Add data",
    },
  } satisfies WidgetStateProps,
  partial: {
    mode: "partial",
    partial: { pill: "Syncing 2 of 3 venues", children: null },
  } satisfies WidgetStateProps,
  error: {
    mode: "error",
    error: { message: "Could not load this widget." },
  } satisfies WidgetStateProps,
} as const;

/**
 * Each MATRIX entry binds a widget to a typed payload + a render
 * thunk. The thunk renders the widget with its smallest valid
 * fixture so the matrix test's success branch can mount a real
 * widget body inside <WidgetState mode='success'>.
 */
export interface WidgetMatrixEntry {
  id: string;
  label: string;
  /** W-01: one of the 5 visual categories (KPI strip, chart, table, sparkline, generic card). */
  category: "kpi" | "chart" | "table" | "sparkline" | "card";
  /** Smallest valid `data` payload the widget accepts without throwing. */
  successFixture: Partial<MyAllocationDashboardPayload>;
  /** Render thunk so the test doesn't have to know per-widget shape. */
  renderSuccess: () => ReactElement;
}

// ----------------------------------------------------------------------
// Smallest-valid `data` fixtures — typed against MyAllocationDashboardPayload.
//
// Every widget reads a defensive subset of the payload (`?? null`,
// `?? []`), so the smallest valid fixture is "all known optional
// fields populated to sane empty values." Success here means "renders
// without throwing." Behavior assertions for individual widgets live
// in their dedicated test files (e.g. KpiStripWidget.test.tsx).
// ----------------------------------------------------------------------

const bridgeSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  outcomes: [],
};

const kpiSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  analytics: null,
  strategies: [],
  holdingsSummary: [],
};

const equitySuccessFixture: Partial<MyAllocationDashboardPayload> = {
  // EquityChartWidget reads equityDailyPoints / btcBenchmark / equityOverlays /
  // allKeysStale from the data bag; an empty equity series renders the
  // "Equity data warming up" empty branch which is the smallest valid
  // success state. Cast through Partial<MyAllocationDashboardPayload> for
  // the strict matrix-fixture typing — these scratch fields aren't in
  // the canonical payload type but the widget reads them defensively.
  equitySnapshots: [],
  allKeysStale: false,
};

const holdingsSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  holdingsSummary: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  apiKeys: [],
  strategies: [],
};

const allocationSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  strategies: [],
};

const mandateSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  mandate: null,
  analytics: null,
  holdingsSummary: [],
  strategies: [],
};

const outcomesSuccessFixture: Partial<MyAllocationDashboardPayload> = {
  outcomes: [],
};

/**
 * Per-widget × per-state matrix. Order matches DEFAULT_LAYOUT
 * (bridge, kpi, equity, holdings, allocation, mandate, outcomes).
 *
 * W-01: every entry carries a category tag so the matrix test can
 * assert per-category coverage (kpi / chart / table / sparkline /
 * card). The 5 W-01 pre-filled patterns are: kpi=kpi, equity=chart,
 * holdings=table, allocation=sparkline, mandate=card. The 2 added
 * entries (bridge=card, outcomes=chart) follow the same template.
 */
export const WIDGET_MATRIX: ReadonlyArray<WidgetMatrixEntry> = [
  {
    id: "bridge",
    label: "BridgeHeroWidget",
    category: "card",
    successFixture: bridgeSuccessFixture,
    renderSuccess: () => (
      <BridgeHeroWidget
        data={bridgeSuccessFixture}
        timeframe="1YTD"
        width={4}
        height={3}
      />
    ),
  },
  {
    id: "kpi",
    label: "KpiStripWidget",
    category: "kpi",
    successFixture: kpiSuccessFixture,
    renderSuccess: () => (
      <KpiStripWidget
        data={kpiSuccessFixture}
        timeframe="1YTD"
        width={4}
        height={2}
      />
    ),
  },
  {
    id: "equity",
    label: "EquityChartWidget",
    category: "chart",
    successFixture: equitySuccessFixture,
    renderSuccess: () => (
      <EquityChartWidget
        data={equitySuccessFixture}
        timeframe="1YTD"
        width={4}
        height={4}
      />
    ),
  },
  {
    id: "holdings",
    label: "HoldingsTableWidget",
    category: "table",
    successFixture: holdingsSuccessFixture,
    renderSuccess: () => (
      <HoldingsTableWidget
        data={holdingsSuccessFixture}
        timeframe="1YTD"
        width={3}
        height={4}
      />
    ),
  },
  {
    id: "allocation",
    label: "AllocationByStyleWidget",
    category: "sparkline",
    successFixture: allocationSuccessFixture,
    renderSuccess: () => (
      <AllocationByStyleWidget
        data={allocationSuccessFixture}
        timeframe="1YTD"
        width={1}
        height={3}
      />
    ),
  },
  {
    id: "mandate",
    label: "MandateSnapshotWidget",
    category: "card",
    successFixture: mandateSuccessFixture,
    renderSuccess: () => (
      <MandateSnapshotWidget
        data={mandateSuccessFixture}
        timeframe="1YTD"
        width={2}
        height={3}
      />
    ),
  },
  {
    id: "outcomes",
    label: "OutcomesWidget",
    category: "chart",
    successFixture: outcomesSuccessFixture,
    renderSuccess: () => (
      <OutcomesWidget
        data={outcomesSuccessFixture}
        timeframe="1YTD"
        width={2}
        height={5}
      />
    ),
  },
] as const;
