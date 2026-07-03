/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 *
 * Plan 23-03 (PERSIST-04) — the compare engine. Extracts the composer's
 * adapter → projectionState → computeScenario chain (the composer's
 * `projectionState` memo) into a testable pure helper so a SAVED
 * draft re-resolves its return series from the live payload and runs the
 * FROZEN `computeScenario` (SCENARIO-05) — yielding the SAME `ComputedMetrics`
 * the composer would show for that draft over the same live inputs. No new
 * compute algorithm is invented here; this module only re-applies the existing
 * chain to a draft + live-input pair off the React render path.
 *
 * Honesty invariants this helper preserves (test-pinned in scenario-compare.test.ts):
 *
 *   - NO leverage. Leverage is ephemeral `useState` in the composer
 *     (the composer's `leverageByRef` state), NEVER persisted — a saved `ScenarioDraft`
 *     carries no leverage field. The projection state built here OMITS the
 *     optional `leverage` map entirely, so `computeScenario`'s `lev()` defaults
 *     every leg to 1 and the byte-identical pre-R4 path runs. We never read a
 *     `leverage` field off the draft even if one is smuggled on.
 *
 *   - Degenerate → null. `computeScenario` returns null-metric `ComputedMetrics`
 *     for degenerate sets (empty active set, n < 10, NaN-poisoned curve). We let
 *     that null flow straight through — NO `?? 0` — so the render layer shows an
 *     honest em-dash, never a fabricated 0.
 *
 *   - Heterogeneous windows (v1.5 PERSIST-03). Each draft is computed at its OWN
 *     persisted `draft.window` (injected onto `projectionState`). Two drafts
 *     with DIFFERENT windows compute independently; the
 *     helper never force-aligns a shared window across drafts. A SAVED draft
 *     with NO `window` (a pre-v1.5 v2 draft, or a v3 saved before a window was
 *     chosen) defaults to the INTERSECTION of its selected spans via the shared
 *     scenario-window helpers — the same rule the composer's WINDOW-01
 *     auto-default and share-resolve apply (ship-review RT-1; 59-CONTEXT Area 3
 *     Q4: "A windowless v2 draft in a compare set → intersection default (same
 *     rule everywhere)"). The ONE structural exception is the live-book column
 *     (`opts.liveBook`): the allocator's own book is NOT a saved scenario and
 *     stays on the engine's UNION-when-absent path — the Phase-55 own-book
 *     union lock. The window is threaded as an engine COMPUTE input, never as
 *     a factsheet view-clamp.
 *
 *   - Live-book column computed through the SAME engine path over a synthetic
 *     "all live holdings, equity-weight" draft (`buildLiveBookDraft`) — NOT the
 *     thin `payload.liveBaselineMetrics` shape, which leaves cagr/sortino/
 *     volatility null and would surface 3 unintended em-dashes on a healthy book.
 *     An em-dash on a genuinely-degenerate live book is then honest, not an
 *     artifact of a thin baseline shape (RESOLVED decision, RESEARCH Q4/A4).
 */

import {
  buildDateMapCache,
  computeScenario,
  type ComputedMetrics,
  type DailyPoint,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
import {
  buildAddedOnlySet,
  buildPerKeyStrategyForBuilderSet,
  mergeAddedIntoPerKeySet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import {
  SCENARIO_SCHEMA_VERSION,
  deriveMembershipFromGate,
  type ScenarioDraft,
} from "./scenario-state";

/**
 * The slice of the composer's live payload the compare engine needs. Mirrors
 * the series-space inputs the composer assembles before its per-key / added-only
 * adapter call (Phase 63 ENGINE-02 — the three legacy holdings-snapshot input
 * fields are deleted; compute is series-space only):
 *   - addedStrategyReturnsLookup — payload.strategies → daily_returns, by id
 *   - addedStrategyMetadataLookup— payload.strategies → tier/cagr/sharpe, by id
 */
export interface ScenarioCompareInputs {
  addedStrategyReturnsLookup: Record<string, DailyPoint[]>;
  addedStrategyMetadataLookup: Record<
    string,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  >;
  /**
   * P61-BUG-2 — the per-key channel. When a SAVED draft's persisted membership
   * selects the per-key path (`(draft.memberKeyIds ?? []).length > 0`, the
   * MEMBER-02 selector), the draft computes on PER-KEY units merged with its
   * added strategies (the same set the composer projects). Empty membership →
   * the added-only path (series-space; no holdings snapshot). Two fields come
   * verbatim from the live payload; `equityByApiKeyId` is derived by the panel
   * from the payload's holdings rows (mirroring the composer's memo).
   */
  perKeyReturnsByApiKeyId?: Record<string, DailyPoint[]>;
  eligibleApiKeyIds?: string[];
  equityByApiKeyId?: Record<string, number>;
  /**
   * WR-03 — carried for PARITY with the live payload only. `computeMetricsForDraft`
   * does NOT read this field: after MEMBER-02 the per-key-vs-holdings SELECTOR is
   * the draft's persisted `memberKeyIds` (see `usePerKeySources`), never the gate.
   * The gate is consulted ONLY at the panel boundary (ScenarioComparePanel), which
   * reads `payload.perKeyDailiesGateSatisfied` to (a) DERIVE membership for an
   * underived/upgraded column via `deriveMembershipFromGate` + `setMemberKeyIds`,
   * and (b) stamp the live-book own-book column via `buildLiveBookDraft(gate, …)`
   * (WR-02). Do NOT wire compute off this flag — membership is the selector.
   */
  perKeyDailiesGateSatisfied?: boolean;
}

/**
 * Options for `computeMetricsForDraft`. Ship-review RT-1 — the live-book
 * exception is STRUCTURAL (an explicit compute input the caller declares),
 * never inferred from draft contents / name matching.
 */
export interface ComputeMetricsForDraftOptions {
  /**
   * Phase-55 own-book union lock: the live-book column is the allocator's own
   * book, NOT a saved scenario, so a windowless live-book draft must NOT get
   * the saved-scenario intersection default — it stays on the engine's
   * UNION-when-absent path. Set by ScenarioComparePanel for the
   * `buildLiveBookDraft()` column ONLY.
   */
  liveBook?: boolean;
}

/**
 * Re-resolve a saved `draft`'s series from `liveInputs` and run the frozen
 * `computeScenario`, returning the SAME `ComputedMetrics` the composer shows
 * for that draft over the same live inputs.
 *
 * The chain is the composer's verbatim (no new math). Which builder runs
 * mirrors the composer's series-space engine-set selection (P61-BUG-2):
 *   - persisted membership present → buildPerKeyStrategyForBuilderSet →
 *     mergeAddedIntoPerKeySet (per-key units + the draft's added strategies)
 *   - otherwise → buildAddedOnlySet (added strategies only; no holdings snapshot)
 * then in both cases: overlay draft toggle/weight into projectionState
 * (NO leverage) → buildDateMapCache → computeScenario.
 */
export function computeMetricsForDraft(
  draft: ScenarioDraft,
  liveInputs: ScenarioCompareInputs,
  opts: ComputeMetricsForDraftOptions = {},
): ComputedMetrics {
  // v1.6 MEMBER-02 — the SAVED draft's PERSISTED membership drives per-key
  // selection, NOT the live gate (F5 closure). A blank-authored draft
  // (memberKeyIds=[]) computes the series-space added-only path even when the
  // live gate is satisfied, so it never inherits the live book; a book draft selects
  // the per-key engine set from its persisted members. `entryMode` is no longer
  // load-bearing for saved drafts. The `?? []` is DEFENSIVE only — the panel
  // derives membership for any UNDERIVED column (upgraded v2/v3, or a
  // round-tripped underived-v4) BEFORE this call, so this default never
  // silently flips a book column to added-only. (P61-BUG-2 per-key units +
  // added strategies still run through the same composer engine-set path.)
  const usePerKeySources = (draft.memberKeyIds ?? []).length > 0;
  let adapterOutput: {
    strategies: StrategyForBuilder[];
    state: ScenarioState;
  };
  if (usePerKeySources) {
    const all = liveInputs.perKeyReturnsByApiKeyId ?? {};
    // MEMBER-02 / MEMBER-04 compute-time drop: intersect the persisted
    // membership with the SSR-computed live-eligible set. Only persisted members
    // that are STILL eligible pass — a fabricated or since-removed member id
    // simply drops (T-62-04/-05), never pulling in a per-key series the
    // allocator is not eligible for.
    const eligibleIds = new Set(liveInputs.eligibleApiKeyIds ?? []);
    const eligible = new Set(
      (draft.memberKeyIds ?? []).filter((id) => eligibleIds.has(id)),
    );
    const eligibleOnly = Object.fromEntries(
      Object.entries(all).filter(([id]) => eligible.has(id)),
    );
    adapterOutput = mergeAddedIntoPerKeySet(
      buildPerKeyStrategyForBuilderSet(
        eligibleOnly,
        liveInputs.equityByApiKeyId ?? {},
      ),
      draft.addedStrategies,
      liveInputs.addedStrategyReturnsLookup as Record<
        StrategyForBuilderId,
        DailyPoint[]
      >,
      liveInputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
      >,
    );
  } else {
    // Phase 63 ENGINE-02 — the legacy holdings-snapshot path is deleted. A SAVED
    // draft with EMPTY membership computes SERIES-SPACE ADDED-ONLY via the ONE
    // shared `buildAddedOnlySet` wrapper (no holdings snapshot, no inline unit
    // loop). A blank-authored draft (memberKeyIds=[]) therefore renders exactly
    // as the composer does in blank mode (ScenarioComposer.tsx:702-704) — its
    // added strategies only, never the live book's holdings. The former
    // `opts.liveBook` structural exception now degenerates: the gate=false
    // live-book column resolves to an EMPTY added-only set → computeScenario
    // null metrics → an honest em-dash column (D1-consistent; affects only
    // gate=false books, 0 real users after GUARD-01). Membership stays the
    // selector; `opts.liveBook` is still declared at the call site but no longer
    // reaches a holdings source (there is none).
    adapterOutput = buildAddedOnlySet(
      draft.addedStrategies,
      liveInputs.addedStrategyReturnsLookup as Record<
        StrategyForBuilderId,
        DailyPoint[]
      >,
      liveInputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
      >,
    );
  }

  // Overlay the draft's toggle + weight state onto the adapter defaults BEFORE
  // the collapse, so computeScenario reflects exactly what the saved draft
  // encodes — the same wiring the composer does in its `projectionState` memo.
  //
  // Deliberately NO `leverage` key: leverage is never persisted (a saved draft
  // has no leverage field), so omitting it makes computeScenario's `lev()`
  // default every leg to 1 and runs the byte-identical pre-R4 path. We read
  // ONLY draft.toggleByScopeRef / draft.weightOverrides — never any leverage.
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  for (const s of adapterOutput.strategies) {
    const toggle = draft.toggleByScopeRef[s.id];
    selected[s.id] =
      toggle === undefined
        ? (adapterOutput.state.selected[s.id] ?? true)
        : toggle;
    const ov = draft.weightOverrides[s.id];
    weights[s.id] =
      typeof ov === "number" && Number.isFinite(ov)
        ? ov
        : (adapterOutput.state.weights[s.id] ?? 0);
  }
  const projectionState: ScenarioState = {
    selected,
    weights,
    startDates: adapterOutput.state.startDates,
  };

  // Phase 63 ENGINE-02 — the alias collapse is retired with the holdings path.
  // Per-key ids (`api_keys.id`) and added ids (`strategies.id`) are disjoint
  // UUIDs with no symbol aliasing, so the collapse was already a passthrough
  // here; the engine set IS the identity pair
  // `{ strategies: adapterOutput.strategies, state: projectionState }`.
  const dateMapCache = buildDateMapCache(adapterOutput.strategies);

  // v1.5 PERSIST-03 — inject the engine window onto `projectionState` (the
  // canonical engineState idiom, mirroring ScenarioComposer's `engineState`
  // memo). With the collapse gone the window is spread directly onto the
  // projection state — no post-collapse re-application is needed. Precedence:
  //
  //   1. `draft.window` — the persisted window, verbatim.
  //   2. Windowless SAVED draft (ship-review RT-1) — the INTERSECTION default,
  //      derived from the post-collapse selected strategies via the ONE shared
  //      helper chain (coverageSpanOf → defaultWindowFor), the same rule the
  //      composer's WINDOW-01 auto-default and share-resolve apply (locked
  //      59-CONTEXT Area 3 Q4: "A windowless v2 draft in a compare set →
  //      intersection default (same rule everywhere)"). No spans / empty
  //      intersection → null → no window key (engine union guard, matching the
  //      composer's WINDOW-06 behavior).
  //   3. `opts.liveBook` — the live-book column stays WINDOWLESS (Phase-55
  //      own-book union lock): the allocator's own book is not a saved
  //      scenario, so no intersection default is derived for it.
  const engineWindow =
    draft.window ??
    (opts.liveBook
      ? null
      : defaultWindowFor(
          adapterOutput.strategies.flatMap((s) => {
            // Spans of SELECTED strategies only — the composer's
            // `selectedSpanById` rule (`selected === false` is skipped;
            // absent counts as selected).
            if (projectionState.selected[s.id] === false) return [];
            const span = coverageSpanOf(s.daily_returns);
            return span ? [span] : [];
          }),
        ));
  const engineState = engineWindow
    ? { ...projectionState, window: engineWindow }
    : projectionState;

  // Degenerate sets (empty active set, n < 10, NaN-poisoned) return null-metric
  // ComputedMetrics — flow it straight through, NO `?? 0`. The caller renders
  // an honest em-dash via formatPercent/formatNumber.
  return computeScenario(adapterOutput.strategies, engineState, dateMapCache);
}

/**
 * Build the synthetic "live book" draft: the WHOLE live book enabled at its
 * natural weights, no added strategies, no toggle/weight overrides, no
 * leverage. With the per-key gate satisfied that is the per-key blend at
 * equity shares (P61-BUG-2 — the same Phase-36 per-key basis as
 * liveBaselineMetrics); otherwise all live holdings at the adapter's
 * value-proportional default. Fed through
 * `computeMetricsForDraft` it computes all six metrics through the SAME engine
 * path so the live-book compare column populates honestly — rather than the
 * thin `payload.liveBaselineMetrics` shape (RESOLVED decision).
 *
 * An empty `toggleByScopeRef` + `weightOverrides` makes `computeMetricsForDraft`
 * fall back to the adapter defaults (every holding selected, value-proportional
 * weights), which IS the live book.
 *
 * Ship-review RT-1: callers computing THIS draft must pass
 * `{ liveBook: true }` to `computeMetricsForDraft` so the own-book column stays
 * on the union path (Phase-55 lock) instead of the saved-scenario intersection
 * default — the exception is declared at the call site, never name-matched.
 *
 * WR-02: the live-book column respects the REAL per-key-dailies gate, exactly
 * like the composer's own baseline (ScenarioComposer.tsx:1765 —
 * `usePerKeySources = book && gate`) and the panel's underived-column
 * normalization (deriveMembershipFromGate(payload.perKeyDailiesGateSatisfied,
 * …)). The gate is threaded in as a parameter (never hardcoded true): with the
 * gate SATISFIED the derived membership is the eligible key set → the per-key
 * union own-book blend; with the gate OFF membership is empty → the holdings
 * union path (opts.liveBook) — the same basis every sibling column runs on, so
 * the "Live book" column can never diverge to the per-key basis (or an
 * empty-per-key em-dash, P61-BUG-2) while the rest of the table is on holdings.
 */
export function buildLiveBookDraft(
  perKeyDailiesGateSatisfied: boolean,
  eligibleApiKeyIds: string[],
): ScenarioDraft {
  return {
    // The synthetic draft never round-trips the codec (computeMetricsForDraft
    // consumes it directly), but pin the CURRENT version constant so a future
    // bump can never leave this literal behind as a stale-looking v2.
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "live-book",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    // v1.6 MEMBER-02 / WR-02 — the live-book column is the allocator's OWN book:
    // stamp membership = the gate-derived eligible set
    // (deriveMembershipFromGate(gate, eligible)) so it selects the per-key
    // engine set (the union own-book blend) ONLY when the gate is satisfied,
    // matching every other surface. `{ liveBook: true }` at the call site holds
    // it on the union path (Phase-55 own-book lock). Gate OFF or an empty
    // eligible set → empty membership → the holdings union path (a holdings-only
    // book), matching the sibling columns' gate-off basis.
    memberKeyIds: deriveMembershipFromGate(
      perKeyDailiesGateSatisfied,
      eligibleApiKeyIds,
    ),
    lastEditedAt: new Date(0).toISOString(),
  };
}
