"use client";

import { useMemo } from "react";
import type { ComputedMetrics, DailyPoint, StrategyForBuilder } from "@/lib/scenario";
import {
  computeMetricsForDraft,
  buildLiveBookDraft,
  type ScenarioCompareInputs,
} from "../lib/scenario-compare";
import {
  defaultDraftFromHoldings,
  scenarioDraftCodec,
  type ScenarioDraft,
} from "../lib/scenario-state";
import { buildHoldingRef } from "../lib/holding-outcome-adapter";
import {
  ScenarioCompareTable,
  type ScenarioColumn,
} from "./ScenarioCompareTable";
import type { SavedScenarioListRow } from "./SavedScenariosList";

/**
 * Plan 23-05 (PERSIST-04) — the in-tab compare panel.
 *
 * Given the selected saved rows (each carrying its persisted draft) + an
 * includeLiveBook flag + the live payload, it:
 *   1. derives a `ScenarioCompareInputs` from the SSR-lifted payload — the SAME
 *      derivation the composer does (no second fetch path);
 *   2. decodes each row's draft through the codec trichotomy (M-0153: never a
 *      bare cast) — an `ok`/`readonly` draft computes via `computeMetricsForDraft`;
 *      a `reset` (older incompatible format) draft cannot be honestly compared,
 *      so its column carries NULL metrics (em-dash), not a fabricated 0;
 *   3. computes the live-book column via the synthetic all-on
 *      `buildLiveBookDraft` through the SAME engine path so all six metrics
 *      populate honestly;
 *   4. mounts `ScenarioCompareTable` with the per-column { name, metrics }.
 *
 * Honesty invariants:
 *   - Degenerate / older-format columns flow through as NULL metrics → "—".
 *     There is NO `?? 0` anywhere in this panel.
 *   - < 2 columns → the under-selection hint (rendered by ScenarioCompareTable),
 *     never a fabricated table.
 *   - The live payload is reused — no second fetch; leverage is never read.
 */

export interface ScenarioComparePanelProps {
  /** The selected SAVED rows (each with its persisted draft JSONB). */
  selectedRows: SavedScenarioListRow[];
  /** Whether the "Live book" pseudo-row is part of the comparison. */
  includeLiveBook: boolean;
  /**
   * The SSR-lifted live payload slice the compare engine needs — the SAME
   * fields the composer receives. Derived into ScenarioCompareInputs here.
   */
  payload: {
    holdingsSummary: Array<{
      symbol: string;
      venue: string;
      holding_type: "spot" | "derivative";
      value_usd: number;
    }>;
    strategies: ComparePayloadStrategy[];
    holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  };
}

/** The slice of `payload.strategies[i]` the added-strategy lookups read. */
interface ComparePayloadStrategy {
  strategy: {
    id: string;
    disclosure_tier: StrategyForBuilder["disclosure_tier"];
    strategy_analytics: {
      daily_returns?: unknown;
      cagr?: number | null;
      sharpe?: number | null;
    } | null;
  };
}

/**
 * Non-blocking breadcrumb for a per-column compute failure. Mirrors
 * AllocationsTabs.warnAudit (a console.warn breadcrumb, no new telemetry
 * surface) — the panel is its own module, so it carries its own small helper
 * rather than importing the tab-level one.
 */
function warnAudit(tag: string, detail: Record<string, unknown> = {}): void {
  if (typeof console === "undefined") return;
  console.warn(`[ScenarioComparePanel] ${tag}`, detail);
}

/** A NULL-metrics column — honest absence for a draft that can't be compared. */
const NULL_METRICS: ComputedMetrics = {
  n: 0,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: null,
  effective_end: null,
};

/**
 * Build the `ScenarioCompareInputs` from the live payload — mirrors the
 * composer's derivation (ScenarioComposer.tsx:686-790):
 *   - addedStrategy{Returns,Metadata}Lookup keyed by strategy id (over the union
 *     of every decoded draft's added strategies);
 *   - symbolByHoldingId via buildHoldingRef over the live holdings.
 * No leverage, no fetch.
 */
function deriveCompareInputs(
  payload: ScenarioComparePanelProps["payload"],
): ScenarioCompareInputs {
  const strategyById = new Map(
    payload.strategies.map((s) => [s.strategy.id, s]),
  );

  // Lookups over ALL catalog strategies — computeMetricsForDraft only reads the
  // ids referenced by a draft's addedStrategies, so a superset is correct and
  // cheap (the composer builds the same maps scoped to the open draft).
  const addedStrategyReturnsLookup: Record<string, DailyPoint[]> = {};
  const addedStrategyMetadataLookup: Record<
    string,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  > = {};
  for (const [id, s] of strategyById) {
    const raw = s.strategy.strategy_analytics?.daily_returns;
    addedStrategyReturnsLookup[id] = Array.isArray(raw)
      ? (raw as unknown as DailyPoint[])
      : [];
    addedStrategyMetadataLookup[id] = {
      disclosure_tier: s.strategy.disclosure_tier,
      cagr: s.strategy.strategy_analytics?.cagr ?? null,
      sharpe: s.strategy.strategy_analytics?.sharpe ?? null,
    };
  }

  const symbolByHoldingId = new Map<string, string>();
  for (const h of payload.holdingsSummary) {
    symbolByHoldingId.set(buildHoldingRef(h), h.symbol);
  }

  return {
    holdingsSummary: payload.holdingsSummary,
    holdingReturnsByScopeRef: payload.holdingReturnsByScopeRef,
    addedStrategyReturnsLookup,
    addedStrategyMetadataLookup,
    symbolByHoldingId,
  };
}

/**
 * Decode a saved row's raw draft JSONB through the codec trichotomy and return
 * the decodable draft (ok/readonly) or null (reset — older incompatible format,
 * cannot be compared honestly). Never a bare `row.draft as ScenarioDraft`.
 */
function decodeDraft(
  rawDraft: unknown,
  defaultDraft: ScenarioDraft,
): ScenarioDraft | null {
  const decoded = scenarioDraftCodec(defaultDraft).decode(
    JSON.stringify(rawDraft),
  );
  // ok / readonly → the persisted draft is usable for compute.
  // reset → an older/corrupt format; the column is honest absence (null).
  if (decoded.outcome === "reset") return null;
  return decoded.value;
}

export function ScenarioComparePanel({
  selectedRows,
  includeLiveBook,
  payload,
}: ScenarioComparePanelProps) {
  const liveInputs = useMemo(() => deriveCompareInputs(payload), [payload]);

  // The default draft (current holdings) is the codec's absent/corrupt fallback
  // and the schema source of truth for the decode.
  const defaultDraft = useMemo(
    () =>
      defaultDraftFromHoldings(
        payload.holdingsSummary as Parameters<
          typeof defaultDraftFromHoldings
        >[0],
      ),
    [payload.holdingsSummary],
  );

  // Per-selection columns: decode → compute (ok/readonly) or null (reset).
  // The compute runs SYNCHRONOUSLY in render and the panel is mounted outside
  // any error boundary, so a single throwing draft would crash the whole
  // Scenario tab. Guard each column: a throw falls back to the honest-absence
  // NULL_METRICS column (one "—" column) and logs a breadcrumb — one bad column
  // never blanks the tab.
  const columns: ScenarioColumn[] = useMemo(
    () =>
      selectedRows.map((row) => {
        const draft = decodeDraft(row.draft, defaultDraft);
        if (draft === null) return { name: row.name, metrics: NULL_METRICS };
        try {
          return { name: row.name, metrics: computeMetricsForDraft(draft, liveInputs) };
        } catch (err) {
          warnAudit("scenario_compare_compute_failed", {
            id: row.id,
            error: String(err),
          });
          return { name: row.name, metrics: NULL_METRICS };
        }
      }),
    [selectedRows, defaultDraft, liveInputs],
  );

  // The live-book column — synthetic all-on draft through the SAME engine path.
  // Same crash exposure as the per-selection columns above → same guard.
  const liveBook: ScenarioColumn | null = useMemo(() => {
    if (!includeLiveBook) return null;
    try {
      const metrics = computeMetricsForDraft(
        buildLiveBookDraft(liveInputs),
        liveInputs,
      );
      return { name: "Live book", metrics };
    } catch (err) {
      warnAudit("scenario_compare_compute_failed", {
        id: "__live_book__",
        error: String(err),
      });
      return { name: "Live book", metrics: NULL_METRICS };
    }
  }, [includeLiveBook, liveInputs]);

  return (
    <section className="space-y-3" aria-labelledby="scenario-compare-heading">
      <h2
        id="scenario-compare-heading"
        className="text-base font-semibold text-text-primary"
      >
        Compare scenarios
      </h2>
      <ScenarioCompareTable columns={columns} liveBook={liveBook} />
    </section>
  );
}
