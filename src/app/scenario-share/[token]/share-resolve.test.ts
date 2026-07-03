/**
 * Plan 25-04 / SHARE-02 — the DI-23-01 honest-absence unit test.
 *
 * `resolveSharedScenario` is the PURE decision layer between the leak-scoped
 * `get_shared_scenario` RPC row and the recipient page render. The single
 * load-bearing invariant it encodes is the **DI-23-01 landmine**:
 *
 *   The dashboard codec (`scenarioDraftCodec`) returns `value = defaultDraft`
 *   on its `"readonly"` (version_ahead) and `"reset"` (parse_failed /
 *   schema_invalid / version_mismatch) outcomes. On the dashboard that default
 *   is the VIEWER'S live holdings. On a PUBLIC share page there is no viewer
 *   book, but rendering `.value` on a non-"ok" outcome would still surface a
 *   live-book-SHAPED object to an anonymous recipient. So the helper MUST
 *   branch on `outcome` and NEVER read `.value` unless `outcome === "ok"`.
 *
 * These tests mutation-prove that a version-ahead / garbage draft yields
 * `kind:"honest-absence"` and NEVER a computed curve / metrics object — i.e.
 * the helper cannot regress into reading the codec default and rendering it.
 *
 * They also pin the compute path: a valid v2 draft with a published series
 * resolves to `kind:"ok"` with non-null `computeScenario` metrics, and an
 * empty-`addedStrategies` draft resolves to `kind:"ok"` carrying the engine's
 * degenerate all-null shape (series=[] is expected, not a bug).
 */
import { describe, it, expect } from "vitest";

import { resolveSharedScenario } from "./share-resolve";
import {
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";
import {
  computeMetricsForDraft,
  type ScenarioCompareInputs,
} from "@/app/(dashboard)/allocations/lib/scenario-compare";
import type { StrategyForBuilderId } from "@/app/(dashboard)/allocations/lib/scenario-adapter";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
import type { DailyPoint } from "@/lib/scenario";

// --- Fixtures --------------------------------------------------------------

const STRAT_A = "11111111-1111-4111-8111-111111111111";
const STRAT_B = "22222222-2222-4222-8222-222222222222";

/** A long, drifting daily-return series so computeScenario clears its n>=10
 *  floor and produces non-null metrics. 40 points, small positive drift. */
function makeSeries(seedOffset: number): DailyPoint[] {
  return makeSeriesFrom("2023-01-01", 40, seedOffset);
}

/** `makeSeries` with an arbitrary start date + length — for RAGGED-span
 *  fixtures where the intersection default must differ from the union. */
function makeSeriesFrom(
  startDate: string,
  days: number,
  seedOffset: number,
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    // Deterministic, non-constant series (avoids zero-variance degeneracy).
    const value = 0.001 + 0.002 * Math.sin((i + seedOffset) / 3);
    out.push({ date, value });
  }
  return out;
}

/** A valid current-version draft with two added strategies at equal weight. */
function okDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION, // the live constant (4 as of v1.6)
    init_holdings_fingerprint: "BTC:binance:spot",
    toggleByScopeRef: { [STRAT_A]: true, [STRAT_B]: true },
    addedStrategies: [
      { id: STRAT_A as never, name: "Alpha", markets: ["BTC"], strategy_types: ["trend"] },
      { id: STRAT_B as never, name: "Beta", markets: ["ETH"], strategy_types: ["mr"] },
    ],
    weightOverrides: { [STRAT_A]: 0.5, [STRAT_B]: 0.5 },
    // v1.6 MEMBER-01 — a current-version draft carries explicit membership.
    memberKeyIds: [],
    lastEditedAt: "2026-06-22T00:00:00.000Z",
  };
}

/** The RPC series rows for the two added strategies. */
function okSeriesRows() {
  return [
    { strategy_id: STRAT_A, daily_returns: makeSeries(0) },
    { strategy_id: STRAT_B, daily_returns: makeSeries(7) },
  ];
}

// --- Tests -----------------------------------------------------------------

describe("resolveSharedScenario — DI-23-01 honest-absence (SHARE-02)", () => {
  it("version-ahead draft (schema_version > live SCENARIO_SCHEMA_VERSION) → honest-absence, NEVER a curve", () => {
    // SCENARIO_SCHEMA_VERSION + 1 is strictly ahead of the live constant. The
    // codec returns outcome:"readonly" with value=defaultDraft — reading that
    // here would leak a live-book-shaped object. The helper must honest-absence
    // it. (v1.5: the constant bumped 2→3; v1.6 MEMBER-01: 3→4. This fixture uses
    // SCENARIO_SCHEMA_VERSION + 1 so it self-adjusts to 5 and keeps exercising
    // the forward-compat readonly path — Pitfall 2.)
    expect(SCENARIO_SCHEMA_VERSION).toBe(4); // pin against the live constant
    const aheadDraft = { ...okDraft(), schema_version: SCENARIO_SCHEMA_VERSION + 1 };

    const result = resolveSharedScenario(
      {
        name: "Future scenario",
        draft: aheadDraft,
        schema_version: SCENARIO_SCHEMA_VERSION + 1,
        series: okSeriesRows(),
      },
    );

    expect(result.kind).toBe("honest-absence");
    // Mutation-proof: the result carries NO computed/curve fields. A regression
    // that read `.value` on the readonly outcome would produce a kind:"ok".
    expect(result).not.toHaveProperty("metrics");
    expect(result).not.toHaveProperty("portfolioDaily");
  });

  it("unparseable / garbage draft → honest-absence (reset outcome), NEVER a curve", () => {
    // A non-object / shape-invalid draft fails the codec's whole-shape parse →
    // outcome:"reset", value=defaultDraft. Must honest-absence, never render.
    const garbage = { not: "a draft", schema_version: 2 } as unknown as ScenarioDraft;

    const result = resolveSharedScenario(
      { name: "Broken", draft: garbage, schema_version: 2, series: [] },
    );

    expect(result.kind).toBe("honest-absence");
    expect(result).not.toHaveProperty("metrics");
  });

  it("valid ok draft with a published series → kind:'ok' with non-null computeScenario metrics", () => {
    const result = resolveSharedScenario(
      { name: "Two-strategy blend", draft: okDraft(), schema_version: 2, series: okSeriesRows() },
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.name).toBe("Two-strategy blend");
    // Non-degenerate: 40 overlapping days, 2 strategies → real metrics + curve.
    expect(result.metrics.n).toBeGreaterThanOrEqual(10);
    expect(result.metrics.twr).not.toBeNull();
    expect(result.metrics.correlation_matrix).not.toBeNull();
    expect(result.metrics.equity_curve.length).toBeGreaterThan(0);
    expect(result.portfolioDaily.length).toBeGreaterThan(0);
  });

  it("ok draft with EMPTY addedStrategies (series=[]) → honest-absence with reason 'book-only' (RE-BASELINED, P61-BUG-2)", () => {
    // RE-BASELINED 2026-07-02 (reviewed act, P61-BUG-2): this test previously
    // pinned kind:"ok" with the degenerate all-null metrics shape ("the
    // components render their honest empty states"). The Phase-61 authed prod
    // canary proved that shape renders as a DEAD share page — "0 overlapping
    // days", every metric an em-dash — indistinguishable from a broken link.
    // A holdings/book-only draft has nothing this page is ALLOWED to compute
    // (the live-book boundary never resolves the owner's private series here),
    // so the honest state is the designed honest-absence card with the
    // book-only reason, not a computed-looking shell of nulls.
    const emptyDraft: ScenarioDraft = {
      ...okDraft(),
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
    };

    const result = resolveSharedScenario(
      { name: "Holdings reweight only", draft: emptyDraft, schema_version: 2, series: [] },
    );

    expect(result.kind).toBe("honest-absence");
    expect(
      result.kind === "honest-absence" ? result.reason : undefined,
    ).toBe("book-only");
  });

  it("returns the strategy name map for the resolved series (de-aliased labels for the heatmap)", () => {
    const result = resolveSharedScenario(
      { name: "Blend", draft: okDraft(), schema_version: 2, series: okSeriesRows() },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.strategyNames[STRAT_A]).toBe("Alpha");
    expect(result.strategyNames[STRAT_B]).toBe("Beta");
  });
});

// ===========================================================================
// WR-05 — the SHARED projection must equal the OWNER's saved projection.
//
// The whole value of the public share page is an HONEST projection. The
// recipient path (resolveSharedScenario) must derive per-strategy effective
// weights EXACTLY as the owner's compare engine (computeMetricsForDraft) does,
// so a recipient never sees a different blend than the owner saved. The bug:
// `weightOverrides[id] ?? 0` (a) silently passed a NaN/Infinity override through
// to computeScenario (the owner rejects non-finite → 0) and (b) the `??`-only
// guard implied "missing → 0" without matching the owner's finite-guard. These
// tests pin owner==recipient for a MIXED explicit/implicit-weight draft and for
// a NON-FINITE override — both would fail under the old `?? 0`.
// ===========================================================================

describe("resolveSharedScenario — owner-projection parity (WR-05)", () => {
  /** Build the owner-side ScenarioCompareInputs for a pure ADDED-strategies
   *  draft (no live holdings) — the recipient page only ever resolves added
   *  strategies (holdings refs are the allocator's live book and never in the
   *  RPC series). Phase 63 ENGINE-02: the holdings-snapshot inputs are deleted;
   *  an empty-membership draft computes series-space added-only via
   *  buildAddedOnlySet, so the owner's adapter still produces the same
   *  StrategyForBuilder set the recipient builds directly. */
  function ownerInputsFor(seriesById: Record<string, DailyPoint[]>): ScenarioCompareInputs {
    return {
      addedStrategyReturnsLookup: seriesById as Record<StrategyForBuilderId, DailyPoint[]>,
      addedStrategyMetadataLookup: {},
    };
  }

  it("a MIXED explicit/implicit-weight draft: shared projection == owner projection (un-weighted add stays 0, matching the engine default)", () => {
    // STRAT_A has an explicit weight; STRAT_B is selected (toggle absent → on)
    // but carries NO weightOverrides entry — the legitimate "override map is not
    // a complete map" state WR-05 describes. The engine default for an
    // un-overridden added strategy is 0 (scenario-adapter invariant), so B
    // contributes nothing — BUT the OWNER sees exactly that too. Parity, not a
    // fabricated equal-weight.
    const mixedDraft: ScenarioDraft = {
      schema_version: SCENARIO_SCHEMA_VERSION,
      init_holdings_fingerprint: "",
      toggleByScopeRef: {}, // both added strategies default to selected
      addedStrategies: [
        { id: STRAT_A as never, name: "Alpha", markets: ["BTC"], strategy_types: ["trend"] },
        { id: STRAT_B as never, name: "Beta", markets: ["ETH"], strategy_types: ["mr"] },
      ],
      weightOverrides: { [STRAT_A]: 0.7 }, // B intentionally absent
      memberKeyIds: [],
      lastEditedAt: "2026-06-22T00:00:00.000Z",
    };
    const seriesA = makeSeries(0);
    const seriesB = makeSeries(7);

    const recipient = resolveSharedScenario(
      {
        name: "Mixed",
        draft: mixedDraft,
        schema_version: 2,
        series: [
          { strategy_id: STRAT_A, daily_returns: seriesA },
          { strategy_id: STRAT_B, daily_returns: seriesB },
        ],
      },
    );
    expect(recipient.kind).toBe("ok");
    if (recipient.kind !== "ok") throw new Error("expected ok");

    const owner = computeMetricsForDraft(
      mixedDraft,
      ownerInputsFor({ [STRAT_A]: seriesA, [STRAT_B]: seriesB }),
    );

    // The metrics the recipient renders are the SAME the owner computes for the
    // same draft + series — proving no divergent weighting.
    expect(recipient.metrics).toEqual(owner);
  });

  it("a partial override map (one weighted, one un-weighted): the recipient never silently equal-weights the un-weighted add", () => {
    // Guard the specific WR-05 honesty defect: a 2-strategy blend where only one
    // strategy is explicitly weighted must render the SAME way the owner saved
    // it — the un-weighted add stays at the engine default (0), NOT a fabricated
    // equal-weight that would misrepresent the saved scenario. Cross-check the
    // recipient against a manual single-strategy projection (A at full weight),
    // which is what the owner's renormalization produces when B's weight is 0.
    const partialDraft: ScenarioDraft = {
      schema_version: SCENARIO_SCHEMA_VERSION,
      init_holdings_fingerprint: "",
      toggleByScopeRef: { [STRAT_A]: true, [STRAT_B]: true },
      addedStrategies: [
        { id: STRAT_A as never, name: "Alpha", markets: ["BTC"], strategy_types: ["trend"] },
        { id: STRAT_B as never, name: "Beta", markets: ["ETH"], strategy_types: ["mr"] },
      ],
      weightOverrides: { [STRAT_A]: 1 }, // B intentionally has no entry
      memberKeyIds: [],
      lastEditedAt: "2026-06-22T00:00:00.000Z",
    };
    const seriesA = makeSeries(2);
    const seriesB = makeSeries(13);

    const recipient = resolveSharedScenario(
      {
        name: "Partial weights",
        draft: partialDraft,
        schema_version: 2,
        series: [
          { strategy_id: STRAT_A, daily_returns: seriesA },
          { strategy_id: STRAT_B, daily_returns: seriesB },
        ],
      },
    );
    expect(recipient.kind).toBe("ok");
    if (recipient.kind !== "ok") throw new Error("expected ok");

    // Owner projection for the SAME draft.
    const owner = computeMetricsForDraft(
      partialDraft,
      ownerInputsFor({ [STRAT_A]: seriesA, [STRAT_B]: seriesB }),
    );
    expect(recipient.metrics).toEqual(owner);

    // And concretely: an A-only draft (B genuinely removed) yields the SAME
    // projection — proving B's un-weighted (weight-0) inclusion is invisible
    // exactly as the engine intends, NOT silently blended at equal weight.
    const aOnlyDraft: ScenarioDraft = {
      ...partialDraft,
      toggleByScopeRef: { [STRAT_A]: true },
      addedStrategies: [
        { id: STRAT_A as never, name: "Alpha", markets: ["BTC"], strategy_types: ["trend"] },
      ],
    };
    const aOnly = resolveSharedScenario(
      {
        name: "A only",
        draft: aOnlyDraft,
        schema_version: 2,
        series: [{ strategy_id: STRAT_A, daily_returns: seriesA }],
      },
    );
    expect(aOnly.kind).toBe("ok");
    if (aOnly.kind !== "ok") throw new Error("expected ok");
    // twr is identical: B at weight 0 contributes nothing, so the partial-weight
    // blend == the A-only blend. If the recipient had equal-weighted B, twr would
    // differ.
    expect(recipient.metrics.twr).toEqual(aOnly.metrics.twr);
  });
});

// ===========================================================================
// PERSIST-02 — the recipient recomputes at the OWNER's saved coverage window,
// VERBATIM. The window rides in the returned `draft` JSONB (get_shared_scenario
// returns it whole — no RPC/SQL change) and share-resolve threads draft.window
// onto the engine state before computeScenario. A SAVED window is never
// re-derived from the recipient's series (which could differ from the owner's
// snapshot → divergent membership; Phase-59 Pitfall 5).
//
// Ship-review RT-1 (DELIBERATE contract correction): a WINDOWLESS draft — a
// pre-v1.5 upgraded-v2 share OR a v3 saved before a window was chosen — now
// defaults to the INTERSECTION of its strategies' coverage spans via the ONE
// shared helper chain (coverageSpanOf → defaultWindowFor), matching the locked
// 59-CONTEXT Area 2 Q4 decision: "Pre-v1.5 shared draft (v2, no window) →
// recipient defaults to intersection (same rule as owner reopen)". The prior
// pins here asserted the legacy UNION path, which made the SAME saved scenario
// compute under a DIFFERENT divisor rule on the share page than in the owner's
// composer (WINDOW-01 intersection auto-default) — re-baselined below.
// ===========================================================================
describe("resolveSharedScenario — owner coverage window verbatim (PERSIST-02)", () => {
  it("a v3 shared draft carrying a window resolves ok with effective bounds == the owner's saved window (recipient == owner, no re-derivation)", () => {
    // Both series span 2023-01-01 … 2023-02-09 (40 days). A window strictly
    // inside that span is covered by both strategies → member_count 2, and the
    // engine sets effective_start/effective_end to the WINDOW bounds verbatim.
    const savedWindow = { start: "2023-01-05", end: "2023-02-05" };
    const windowedDraft: ScenarioDraft = {
      ...okDraft(),
      schema_version: SCENARIO_SCHEMA_VERSION, // 3 — a v3 save carrying a window
      window: savedWindow,
    };

    const result = resolveSharedScenario({
      name: "Windowed blend",
      draft: windowedDraft,
      schema_version: SCENARIO_SCHEMA_VERSION,
      series: okSeriesRows(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    // The recipient's effective bounds ARE the owner's saved window — proving the
    // window threaded through verbatim (not the union/full-series bounds, which
    // would be 2023-01-01 … 2023-02-09).
    expect(result.metrics.effective_start).toBe(savedWindow.start);
    expect(result.metrics.effective_end).toBe(savedWindow.end);
    // Both strategies cover the window → the windowed blend is a real 2-member
    // projection (the honest recompute-at-owner's-window observable).
    expect(result.metrics.member_count).toBe(2);
  });

  it("a v3 windowless shared draft defaults to the INTERSECTION of its strategies' spans — same rule as owner reopen (RT-1 contract correction)", () => {
    // RE-BASELINED (ship-review RT-1, deliberate contract correction — locked
    // 59-CONTEXT Area 2 Q4): this pin previously asserted the legacy UNION path
    // (effective_start = the earliest series date). RAGGED spans make the two
    // rules observably different:
    //   A — 2023-01-01 … 2023-02-09 (40 days)
    //   B — 2023-01-15 … 2023-02-23 (40 days, ragged head AND tail)
    // Intersection = [2023-01-15, 2023-02-09]; union = [2023-01-01, 2023-02-23].
    const seriesA = makeSeries(0);
    const seriesB = makeSeriesFrom("2023-01-15", 40, 7);
    const windowlessV3: ScenarioDraft = {
      ...okDraft(),
      schema_version: SCENARIO_SCHEMA_VERSION,
    };
    const result = resolveSharedScenario({
      name: "Windowless v3",
      draft: windowlessV3,
      schema_version: SCENARIO_SCHEMA_VERSION,
      series: [
        { strategy_id: STRAT_A, daily_returns: seriesA },
        { strategy_id: STRAT_B, daily_returns: seriesB },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    // Intersection default — NOT the union's 2023-01-01 … 2023-02-23 bounds.
    expect(result.metrics.effective_start).toBe("2023-01-15");
    expect(result.metrics.effective_end).toBe("2023-02-09");
    // Both strategies cover the intersection by construction → a real 2-member
    // blend under the SAME divisor rule the owner's composer defaults to.
    expect(result.metrics.member_count).toBe(2);
  });

  it("a pre-v1.5 v2 (windowless) shared draft resolves ok (NOT honest-absence) after the non-destructive upgrade, at the intersection default", () => {
    // Wave 1 added the non-destructive v2→v3 codec branch; v1.6 MEMBER-01's
    // double bump moved v2 handling to the literal-2 chain branch: a valid v2
    // draft now decodes outcome:"ok" (reason "upgraded_v2_chain"), so
    // share-resolve reaches the compute path instead of honest-absencing every
    // pre-v1.5 share.
    // RE-BASELINED (ship-review RT-1, deliberate contract correction — locked
    // 59-CONTEXT Area 2 Q4: "recipient defaults to intersection, same rule as
    // owner reopen"): the ragged fixture proves the intersection rule, where
    // the prior union pin only held for equal spans.
    const seriesA = makeSeries(0); // 2023-01-01 … 2023-02-09
    const seriesB = makeSeriesFrom("2023-01-15", 40, 7); // 2023-01-15 … 2023-02-23
    const v2Draft: ScenarioDraft = {
      ...okDraft(),
      schema_version: 2, // pre-v1.5, windowless
    };

    const result = resolveSharedScenario({
      name: "Legacy v2 share",
      draft: v2Draft,
      schema_version: 2,
      series: [
        { strategy_id: STRAT_A, daily_returns: seriesA },
        { strategy_id: STRAT_B, daily_returns: seriesB },
      ],
    });

    // MUST be ok — resetting/honest-absencing here would silently 404 every
    // pre-window shared scenario (Phase-59 Pitfall 1 in the share path).
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.metrics.n).toBeGreaterThanOrEqual(10);
    // Windowless v2 → the intersection default, same rule as owner reopen.
    expect(result.metrics.effective_start).toBe("2023-01-15");
    expect(result.metrics.effective_end).toBe("2023-02-09");
  });

  it("determinism: the recipient's derived default == the composer's default for the same series (same shared helper → lexicographically identical window)", () => {
    // RT-1's honesty core: the windowless default is derived through the ONE
    // shared helper chain (coverageSpanOf → defaultWindowFor) that the
    // composer's WINDOW-01 auto-default uses — same helper, same inputs →
    // the lexicographically identical window on every surface. The oracle
    // computes the composer-side default DIRECTLY from the fixture series via
    // those helpers and requires the share page's effective bounds to equal it.
    const seriesA = makeSeriesFrom("2023-01-05", 60, 3);
    const seriesB = makeSeriesFrom("2023-01-20", 60, 11);
    const composerDefault = defaultWindowFor([
      coverageSpanOf(seriesA)!,
      coverageSpanOf(seriesB)!,
    ]);
    expect(composerDefault).not.toBeNull();

    const result = resolveSharedScenario({
      name: "Determinism",
      draft: { ...okDraft(), schema_version: SCENARIO_SCHEMA_VERSION },
      schema_version: SCENARIO_SCHEMA_VERSION,
      series: [
        { strategy_id: STRAT_A, daily_returns: seriesA },
        { strategy_id: STRAT_B, daily_returns: seriesB },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.metrics.effective_start).toBe(composerDefault!.start);
    expect(result.metrics.effective_end).toBe(composerDefault!.end);
  });

  // Pre-landing review I5 pin (b), share path — an INVERTED (start > end)
  // owner window is well-formed for the codec (deliberately NO start<=end
  // refine: a refine failure would honest-absence/404 a live share over a
  // cosmetic field). The share path must NEVER throw and NEVER fabricate
  // bounds — the engine degrades honestly: zero days fall inside an inverted
  // window, so the blend is the n=0 all-null degenerate shape.
  it("an INVERTED (start > end) owner window resolves ok without throwing, all-null degenerate metrics, no fabricated bounds", () => {
    const invertedDraft: ScenarioDraft = {
      ...okDraft(),
      schema_version: SCENARIO_SCHEMA_VERSION,
      window: { start: "2023-02-05", end: "2023-01-05" }, // inverted, in-range days
    };
    const result = resolveSharedScenario({
      name: "Inverted window",
      draft: invertedDraft,
      schema_version: SCENARIO_SCHEMA_VERSION,
      series: okSeriesRows(),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    // Honest degrade: no overlapping day satisfies start<=d<=end → n=0,
    // null metrics, empty curve — never a fabricated curve.
    expect(result.metrics.n).toBe(0);
    expect(result.metrics.twr).toBeNull();
    expect(result.metrics.equity_curve).toEqual([]);
    // The (frozen) engine echoes the APPLIED window verbatim as the effective
    // bounds — the owner's own saved value, per the PERSIST-02 verbatim
    // contract — it never invents bounds derived from data it didn't blend.
    expect(result.metrics.effective_start).toBe("2023-02-05");
    expect(result.metrics.effective_end).toBe("2023-01-05");
  });
});

// P61-BUG-2 (prod canary 2026-07-02) — a BOOK-ONLY draft (zero added
// strategies; its projection units are the owner's private per-key book
// series, which the live-book boundary never resolves here) must surface the
// designed honest-absence state with the "book-only" reason — not compute an
// empty set into a dead em-dash shell ("0 overlapping days", all metrics "—").
describe("resolveSharedScenario — book-only draft honest-absence (P61-BUG-2)", () => {
  it("a valid draft with ZERO added strategies → honest-absence with reason 'book-only', never a metrics shell", () => {
    const bookOnly: ScenarioDraft = {
      ...okDraft(),
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
    };
    const result = resolveSharedScenario({
      name: "Book-only scenario",
      draft: bookOnly,
      schema_version: 2,
      series: [], // the RPC resolves no series for book refs (live-book boundary)
    });
    expect(result.kind).toBe("honest-absence");
    expect(
      result.kind === "honest-absence" ? result.reason : undefined,
    ).toBe("book-only");
    // Structurally NOT a computed shell: no metrics/portfolioDaily leak out.
    expect("metrics" in result).toBe(false);
  });

  it("a draft WITH added strategies still resolves ok (the new branch never over-fires)", () => {
    const result = resolveSharedScenario({
      name: "Real share",
      draft: okDraft(),
      schema_version: 2,
      series: okSeriesRows(),
    });
    expect(result.kind).toBe("ok");
  });

  // MEMBER-03 (null-safe unification) — a PRE-v4 / v2 / v3 share arrives with
  // membership UNDERIVED (memberKeyIds ABSENT, not []). Book-only detection here
  // stays on the RESOLVED `strategies.length` (never `draft.memberKeyIds.length`)
  // precisely so this common path is surfaced honestly and the code never reads
  // .length off undefined. This fixture OMITS memberKeyIds entirely to exercise
  // the undefined-membership path — it must honest-absence "book-only", not throw.
  it("a v2 share with UNDEFINED membership (pre-v4) + zero added → honest-absence 'book-only', never throws", () => {
    const preV4BookOnly = {
      schema_version: 2, // pre-v4 — membership underived (undefined)
      init_holdings_fingerprint: "BTC:binance:spot",
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
      // memberKeyIds intentionally OMITTED — the null-safe path under test.
      // `as unknown as ScenarioDraft`: a pre-v4 blob genuinely lacks the
      // required-at-v4 field, which is exactly the underived-membership case.
      lastEditedAt: "2026-06-22T00:00:00.000Z",
    } as unknown as ScenarioDraft;

    const result = resolveSharedScenario({
      name: "Pre-v4 book-only",
      draft: preV4BookOnly,
      schema_version: 2,
      series: [],
    });
    expect(result.kind).toBe("honest-absence");
    expect(
      result.kind === "honest-absence" ? result.reason : undefined,
    ).toBe("book-only");
  });
});
