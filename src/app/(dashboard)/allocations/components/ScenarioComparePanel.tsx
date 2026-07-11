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
  deriveMembershipFromGate,
  scenarioDraftCodec,
  setMemberKeyIds,
  type ScenarioDraft,
} from "../lib/scenario-state";
import { sanitizeLeverageMap } from "@/lib/leverage";
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
      /** P61-BUG-2 — per-key equity grouping (nullable on older shapes). */
      api_key_id?: string | null;
      unrealized_pnl_usd?: number | null;
    }>;
    strategies: ComparePayloadStrategy[];
    /**
     * P61-BUG-2 — the per-key channel (the same fields the composer's
     * book-mode engine selection reads). The AllocationsTabs call site passes
     * the WHOLE dashboard payload, so these exist at runtime; typed optional
     * so a narrow test payload still type-checks. An absent per-key channel
     * yields empty lookups → an honest em-dash column, NOT a holdings fallback
     * (the legacy holdings path is deleted, Phase 63 ENGINE-02).
     */
    perKeyReturnsByApiKeyId?: Record<string, DailyPoint[]>;
    eligibleApiKeyIds?: string[];
    perKeyDailiesGateSatisfied?: boolean;
  };
}

/** The slice of `payload.strategies[i]` the added-strategy lookups read. */
interface ComparePayloadStrategy {
  strategy: {
    id: string;
    disclosure_tier: StrategyForBuilder["disclosure_tier"];
    // Phase 84 (BLEND-01): the added leg's asset_class, arriving via the 84-03
    // SSR select. Optional + `?? null` downstream so this stays compile- and
    // runtime-safe independently of the SSR shape (an unknown leg → the 252 leg).
    asset_class?: string | null;
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

/**
 * LEV-02 (round-2 H-2) — does this saved draft carry a per-strategy leverage
 * multiplier ≠ 1 on a leg that is NOT toggled off? Drives the column's
 * "Modeled · leverage" label. A conservative toggled-on proxy for the composer's
 * `leverageApplied` (selected && weight>0 && L≠1): the panel has no resolved
 * post-adapter weights, so it gates on the persisted toggle only — an over-label
 * for the rare weight-0 leg is acceptable for a caption (it never fabricates a
 * NUMBER; the metrics themselves are the engine's honest output).
 */
function draftHasEffectiveLeverage(draft: ScenarioDraft): boolean {
  const lev = sanitizeLeverageMap(draft.leverageOverrides);
  return Object.entries(lev).some(
    ([id, L]) => L !== 1 && draft.toggleByScopeRef[id] !== false,
  );
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
 * composer's series-space derivation (ScenarioComposer.tsx:1588-1608 lookups,
 * :1710-1718 equityByApiKeyId):
 *   - addedStrategy{Returns,Metadata}Lookup keyed by strategy id (over the union
 *     of every decoded draft's added strategies);
 *   - equityByApiKeyId — per-key equity shares grouped from the live holdings
 *     (the per-key WEIGHT basis; series-space, not a holdings-snapshot engine
 *     input).
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
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe" | "asset_class">
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
      // Phase 84 (BLEND-01): carry asset_class so the added leg contributes to the
      // blend basis (blendPeriodsPerYear). `?? null` keeps an absent SSR field safe.
      asset_class: s.strategy.asset_class ?? null,
    };
  }

  // P61-BUG-2 — per-key equity shares, grouped by api_key_id. Mirrors the
  // composer's `equityByApiKeyId` memo (and the SSR holdingEquityContribution,
  // queries.ts): derivative → unrealized_pnl_usd (value_usd is leveraged
  // NOTIONAL), spot → value_usd; non-finite → 0. Local copy per the
  // established duplication precedent (queries.ts is server-only).
  const equityByApiKeyId: Record<string, number> = {};
  for (const h of payload.holdingsSummary) {
    if (!h.api_key_id) continue;
    const contribution =
      h.holding_type === "derivative"
        ? Number.isFinite(h.unrealized_pnl_usd ?? 0)
          ? (h.unrealized_pnl_usd ?? 0)
          : 0
        : Number.isFinite(h.value_usd)
          ? h.value_usd
          : 0;
    equityByApiKeyId[h.api_key_id] =
      (equityByApiKeyId[h.api_key_id] ?? 0) + contribution;
  }

  return {
    addedStrategyReturnsLookup,
    addedStrategyMetadataLookup,
    perKeyReturnsByApiKeyId: payload.perKeyReturnsByApiKeyId,
    eligibleApiKeyIds: payload.eligibleApiKeyIds,
    equityByApiKeyId,
    perKeyDailiesGateSatisfied: payload.perKeyDailiesGateSatisfied,
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
        // A reset (older/incompatible format) draft can't be compared — mark
        // the column `undecodable` so the table renders the "older format"
        // footer stamp, NOT the sample-floor "0 overlapping days" copy (which
        // would conflate older-format with insufficient-history, the #509 class).
        if (draft === null)
          return { name: row.name, metrics: NULL_METRICS, undecodable: true };
        // v1.6 MEMBER-02 — normalize UNDERIVED membership at the single
        // per-column compute seam. A codec-decoded upgraded v2/v3 draft (or a
        // round-tripped underived-v4 blob) arrives with `memberKeyIds ===
        // undefined`; derive it here from the live gate + eligible ids and stamp
        // it, so old/underived columns compute IDENTICALLY to today (the Atlas
        // golden is preserved) and the membership selector never sees undefined.
        // A column that already carries explicit membership (genuine v4) passes
        // through unchanged — its since-removed members are intersected out at
        // compute (scenario-compare.ts MEMBER-04 drop).
        const normalized =
          draft.memberKeyIds === undefined
            ? setMemberKeyIds(
                draft,
                deriveMembershipFromGate(
                  payload.perKeyDailiesGateSatisfied ?? false,
                  payload.eligibleApiKeyIds ?? [],
                ),
              )
            : draft;
        try {
          return {
            name: row.name,
            metrics: computeMetricsForDraft(normalized, liveInputs),
            leveraged: draftHasEffectiveLeverage(normalized),
          };
        } catch (err) {
          warnAudit("scenario_compare_compute_failed", {
            id: row.id,
            error: String(err),
          });
          return { name: row.name, metrics: NULL_METRICS };
        }
      }),
    [selectedRows, defaultDraft, liveInputs, payload],
  );

  // The live-book column — synthetic all-on draft through the SAME engine path.
  // Same crash exposure as the per-selection columns above → same guard.
  // `liveBook: true` (ship-review RT-1) declares the STRUCTURAL Phase-55
  // own-book exception: the allocator's own book stays on the union path,
  // while windowless SAVED columns get the intersection default.
  const liveBook: ScenarioColumn | null = useMemo(() => {
    if (!includeLiveBook) return null;
    try {
      const metrics = computeMetricsForDraft(
        buildLiveBookDraft(
          payload.perKeyDailiesGateSatisfied ?? false,
          payload.eligibleApiKeyIds ?? [],
        ),
        liveInputs,
        { liveBook: true },
      );
      return { name: "Live book", metrics };
    } catch (err) {
      warnAudit("scenario_compare_compute_failed", {
        id: "__live_book__",
        error: String(err),
      });
      return { name: "Live book", metrics: NULL_METRICS };
    }
  }, [includeLiveBook, liveInputs, payload]);

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
