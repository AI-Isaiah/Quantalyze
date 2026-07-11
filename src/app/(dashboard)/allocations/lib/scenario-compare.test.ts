import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/scenario";
import { computeScenario, buildDateMapCache } from "@/lib/scenario";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
import type { ScenarioDraft, AddedStrategy } from "./scenario-state";
import {
  buildAddedOnlySet,
  buildPerKeyStrategyForBuilderSet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import {
  computeMetricsForDraft,
  buildLiveBookDraft,
  type ScenarioCompareInputs,
} from "./scenario-compare";

/**
 * TDD pins for the compare engine (Plan 23-03, Task 1).
 *
 * `computeMetricsForDraft(draft, liveInputs)` re-resolves a saved draft's
 * return series from the live payload and runs the FROZEN `computeScenario`
 * engine, returning the SAME `ComputedMetrics` the composer would show for
 * that draft over the same live inputs. The honesty invariants are encoded
 * as assertions, not prose:
 *
 *   1. A draft round-trips to real metrics over a healthy live book.
 *   2. A degenerate draft (overlap n below the engine's usable floor) yields
 *      NULL metric fields — the helper does NOT coerce to 0.
 *   3. Two drafts with heterogeneous overlap windows each report their OWN n.
 *   4. The synthetic live-book draft (all holdings enabled, equity-weight,
 *      no added strategies, no leverage) populates all six metrics non-null
 *      on a healthy live book.
 *   5. Every leg runs at leverage 1 (no leverage field consulted).
 *
 * v1.5 PERSIST-03 adds the per-persisted-window compare pins:
 *   6. A draft with a `window` computes at that window — effective bounds are
 *      clamped to the window and members that do not cover it are dropped
 *      (member_count reflects window membership, distinct from the union).
 *   7. Two drafts with DIFFERENT windows compute independently (heterogeneous,
 *      never force-aligned to a shared window).
 *   8. The live-book draft (window omitted, `{ liveBook: true }`) stays on the
 *      union path (Phase-55 own-book union lock), while a windowless SAVED
 *      draft defaults to the INTERSECTION of its selected spans — the RT-1
 *      "same rule everywhere" contract (59-CONTEXT Area 3 Q4).
 *
 * Fixtures mirror `scenario.test.ts` style: business-day windows + a
 * constant/alternating return generator, fed through the SAME series-space
 * live-input shape the composer builds (Phase 63 ENGINE-02 — the per-key
 * channel + the added-strategy lookups; the legacy holdings-snapshot inputs
 * are gone).
 */

// =========================================================================
// Fixture helpers (mirror scenario.test.ts)
// =========================================================================

/** N sequential business-day ISO dates starting at startDate (skips weekends). */
function buildDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  let i = 0;
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
    if (i > n * 3) break;
  }
  return out;
}

/** Alternating up/down daily-return window so vol/Sharpe/Sortino are non-zero. */
function altReturns(dates: string[], up: number, down: number): DailyPoint[] {
  return dates.map((date, i) => ({ date, value: i % 2 === 0 ? up : down }));
}

/**
 * Per-key live inputs — the prod SAVED-book path (MEMBER-02) and, after Phase 63
 * ENGINE-02, the ONLY real-book vehicle: `returnsByKey` keyed by api_key_id,
 * `equityByKey` the per-key equity shares, gate satisfied. There is no
 * holdings-snapshot input any more — a book column computes on PER-KEY units
 * (P61-BUG-2); a blank draft (memberKeyIds=[]) computes series-space added-only.
 * `eligible` defaults to every key present. A saved draft selects the per-key
 * set via `memberKeyIds` (non-empty).
 */
function perKeyLiveInputs(
  returnsByKey: Record<string, DailyPoint[]>,
  equityByKey: Record<string, number>,
  eligible?: string[],
): ScenarioCompareInputs {
  return {
    addedStrategyReturnsLookup: {},
    addedStrategyMetadataLookup: {},
    perKeyReturnsByApiKeyId: returnsByKey,
    eligibleApiKeyIds: eligible ?? Object.keys(returnsByKey),
    equityByApiKeyId: equityByKey,
    perKeyDailiesGateSatisfied: true,
  };
}

/** A minimal saved draft (current schema). Toggles/weights default empty so the
 *  adapter defaults (all holdings included, value-proportional) flow through. */
function draft(overrides: Partial<ScenarioDraft> = {}): ScenarioDraft {
  return {
    schema_version: 2,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: {},
    addedStrategies: [] as AddedStrategy[],
    weightOverrides: {},
    memberKeyIds: [],
    lastEditedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// =========================================================================
// Tests
// =========================================================================

describe("computeMetricsForDraft", () => {
  it("round-trips a saved book draft to real metrics over a healthy per-key book", () => {
    // MEMBER-02 rebase: a SAVED book draft computes over PER-KEY units selected
    // by its persisted membership (P61-BUG-2), not the holdings snapshot. A
    // blank draft (memberKeyIds=[]) would compute added-only and never inherit
    // the live book — so a real "book over live data" round-trip is a per-key
    // membership draft.
    const dates = buildDates("2024-01-02", 80);
    const inputs = perKeyLiveInputs(
      {
        "key-A": altReturns(dates, 0.01, -0.008),
        "key-B": altReturns(dates, 0.012, -0.009),
      },
      { "key-A": 6000, "key-B": 4000 },
    );

    const m = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A", "key-B"] }),
      inputs,
    );

    expect(m.n).toBe(80);
    expect(m.twr).not.toBeNull();
    expect(m.cagr).not.toBeNull();
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
    expect(m.max_drawdown).not.toBeNull();
    expect(m.volatility).not.toBeNull();
  });

  it("yields NULL metrics for a degenerate book draft — never coerces to 0", () => {
    // Only 6 overlapping days — below the engine's n<10 usable floor, so the
    // blend is degenerate and the engine returns null metrics. Honesty
    // invariant: null, never a fabricated 0. (Per-key vehicle — the SAVED book
    // path after MEMBER-02.)
    const shortDates = buildDates("2024-01-02", 6);
    const inputs = perKeyLiveInputs(
      { "key-A": altReturns(shortDates, 0.01, -0.01) },
      { "key-A": 1000 },
    );

    const m = computeMetricsForDraft(draft({ memberKeyIds: ["key-A"] }), inputs);

    // Honesty invariant: the metric fields are NULL, not a fabricated 0.
    expect(m.twr).toBeNull();
    expect(m.cagr).toBeNull();
    expect(m.sharpe).toBeNull();
    expect(m.sortino).toBeNull();
    expect(m.volatility).toBeNull();
    expect(m.twr).not.toBe(0);
    expect(m.volatility).not.toBe(0);
  });

  it("two book drafts with heterogeneous overlap windows each report their OWN n", () => {
    const longDates = buildDates("2024-01-02", 90);
    const shortDates = buildDates("2024-01-02", 60);

    const longInputs = perKeyLiveInputs(
      { "key-A": altReturns(longDates, 0.01, -0.008) },
      { "key-A": 5000 },
    );
    const shortInputs = perKeyLiveInputs(
      { "key-A": altReturns(shortDates, 0.01, -0.008) },
      { "key-A": 5000 },
    );

    const mLong = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A"] }),
      longInputs,
    );
    const mShort = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A"] }),
      shortInputs,
    );

    // The helper does NOT force a common window — each reports its own n.
    expect(mLong.n).toBe(90);
    expect(mShort.n).toBe(60);
    expect(mLong.n).not.toBe(mShort.n);
  });

  // =======================================================================
  // v1.5 PERSIST-03 — per-persisted-window compare (each draft at its OWN window)
  // WHY: compare must show 2+ scenarios each at its own SAVED coverage window.
  // Force-aligning them to a shared window would be dishonest — a member that
  // ended before another's window should not be silently stretched to it. The
  // engine already computes windowed metrics; these pin that computeMetricsForDraft
  // THREADS the persisted draft.window through to the engine (POST-collapse).
  // Ship-review RT-1 (deliberate contract correction, locked 59-CONTEXT Area 3
  // Q4: "A windowless v2 draft in a compare set → intersection default (same
  // rule everywhere)"): a windowless SAVED draft now defaults to the
  // INTERSECTION of its selected spans via the shared scenario-window helpers —
  // the same rule the composer's WINDOW-01 auto-default and share-resolve
  // apply. ONLY the live-book column (`{ liveBook: true }`, a structural
  // compute input) stays on the union path (Phase-55 own-book lock).
  //
  // MEMBER-02 rebase: the SAVED-draft vehicle is now a per-key membership draft
  // (the blank/holdings-snapshot path is added-only after F5 closure), so these
  // ragged-span pins use per-key series keyed by api_key_id.
  // =======================================================================

  it("a windowed draft narrows effective bounds to the window (distinct from the windowless default)", () => {
    // Two per-key members with DIFFERENT coverage spans:
    //   key-BTC — the full ~140-day span (2024-01-02 → ~2024-07-16)
    //   key-ETH — a LATE-starting span that begins ~2024-04-01.
    // A window pinned to a LATER sub-range strictly inside key-ETH's coverage is
    // covered by BOTH, so the windowed blend keeps both members but its
    // effective bounds are the explicit window — NOT the windowless
    // intersection default (which starts at key-ETH's first date).
    const btcDates = buildDates("2024-01-02", 140);
    const ethDates = buildDates("2024-04-01", 80);
    const inputs = perKeyLiveInputs(
      {
        "key-BTC": altReturns(btcDates, 0.01, -0.008),
        "key-ETH": altReturns(ethDates, 0.012, -0.009),
      },
      { "key-BTC": 5000, "key-ETH": 5000 },
    );
    const members = ["key-BTC", "key-ETH"];

    // A window inside key-ETH's coverage (both members cover it).
    const window = { start: ethDates[10], end: ethDates[60] };

    // RT-1 re-baseline: the windowless baseline is now the INTERSECTION default
    // (key-ETH's span here — the latest start), no longer the legacy union.
    const defaulted = computeMetricsForDraft(
      draft({ memberKeyIds: members }),
      inputs,
    );
    const windowed = computeMetricsForDraft(
      draft({ memberKeyIds: members, window }),
      inputs,
    );

    // The explicit window is honored verbatim — its bounds differ from the
    // intersection default's (which starts at ethDates[0], not ethDates[10]).
    expect(defaulted.effective_start).not.toBeNull();
    expect(windowed.effective_start).not.toBeNull();
    expect(windowed.effective_end).not.toBeNull();
    expect(windowed.effective_start).not.toBe(defaulted.effective_start);
    // The windowed bounds fall within the requested window (engine reads state.window).
    expect(windowed.effective_start! >= window.start).toBe(true);
    expect(windowed.effective_end! <= window.end).toBe(true);
    // A narrower explicit window means fewer trading days than the default.
    expect(windowed.n).toBeLessThan(defaulted.n);
  });

  it("a windowed draft drops members that do not cover the window (member_count reflects the window)", () => {
    // key-BTC covers the full range; key-ETH only covers a LATE sub-range. A
    // window over the EARLY range (before key-ETH exists) is covered by key-BTC
    // ONLY → key-ETH is dropped from the windowed blend, so member_count
    // reflects window membership (< the full selected set), while the union
    // path counts both.
    const btcDates = buildDates("2024-01-02", 200);
    const ethDates = buildDates("2024-06-03", 60);
    const inputs = perKeyLiveInputs(
      {
        "key-BTC": altReturns(btcDates, 0.01, -0.008),
        "key-ETH": altReturns(ethDates, 0.012, -0.009),
      },
      { "key-BTC": 5000, "key-ETH": 5000 },
    );

    // An EARLY window — inside key-BTC's span but BEFORE key-ETH starts.
    const earlyWindow = { start: btcDates[5], end: btcDates[70] };
    const windowed = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-BTC", "key-ETH"], window: earlyWindow }),
      inputs,
    );

    // key-ETH does not cover the early window → only 1 member survives.
    expect(windowed.member_count).toBe(1);
    expect(windowed.member_ids).toEqual(["key-BTC"]);
  });

  it("two drafts with DIFFERENT windows compute independently (heterogeneous, not force-aligned)", () => {
    // The compare invariant: each column is at its OWN window. Two windows over
    // NON-OVERLAPPING sub-ranges of the same book produce independent
    // effective bounds — neither is aligned to the other.
    const dates = buildDates("2024-01-02", 200);
    const inputs = perKeyLiveInputs(
      { "key-BTC": altReturns(dates, 0.01, -0.008) },
      { "key-BTC": 5000 },
    );

    const earlyWindow = { start: dates[5], end: dates[70] };
    const lateWindow = { start: dates[120], end: dates[190] };

    const early = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-BTC"], window: earlyWindow }),
      inputs,
    );
    const late = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-BTC"], window: lateWindow }),
      inputs,
    );

    // Each computes at its OWN window — the bounds are independent, NOT aligned.
    expect(early.effective_start).not.toBe(late.effective_start);
    expect(early.effective_end).not.toBe(late.effective_end);
    expect(early.effective_start! < late.effective_start!).toBe(true);
  });

  it("the live-book column ({ liveBook: true }) stays on the UNION path while a windowless SAVED draft gets the intersection default (Phase-55 lock, structural exception)", () => {
    // RT-1 re-baseline of the Phase-55 own-book union lock pin. Over a RAGGED
    // per-key book (key-BTC full 120 days, key-ETH starting ~30 trading days
    // later) the two rules are observably different:
    //   - the live-book column (buildLiveBookDraft(eligible) + { liveBook: true })
    //     is the allocator's OWN book, not a saved scenario → union-when-absent
    //     path (full key-BTC-driven bounds, all 120 trading days);
    //   - a windowless SAVED draft over the SAME book defaults to the
    //     intersection (key-ETH's late start clamps it).
    const btcDates = buildDates("2024-01-02", 120);
    const ethDates = btcDates.slice(30);
    const eligible = ["key-BTC", "key-ETH"];
    const inputs = perKeyLiveInputs(
      {
        "key-BTC": altReturns(btcDates, 0.01, -0.008),
        "key-ETH": altReturns(ethDates, 0.012, -0.009),
      },
      { "key-BTC": 6000, "key-ETH": 4000 },
      eligible,
    );

    // buildLiveBookDraft stamps membership = derived(gate, eligible) so the
    // own-book column keeps selecting the per-key set (gate satisfied here);
    // { liveBook: true } holds it on the union path (Phase-55 lock) with NO window.
    const liveDraft = buildLiveBookDraft(true, eligible);
    expect(liveDraft.window).toBeUndefined(); // never carries a window

    const live = computeMetricsForDraft(liveDraft, inputs, { liveBook: true });
    // Union path — the full blended span, from key-BTC's first day, all 120 days.
    expect(live.effective_start).toBe(btcDates[0]);
    expect(live.n).toBe(120);

    // The SAME book as a windowless SAVED column → intersection default:
    // clamped to key-ETH's late start, fewer days than the union.
    const saved = computeMetricsForDraft(
      draft({ memberKeyIds: eligible }),
      inputs,
    );
    expect(saved.effective_start).toBe(ethDates[0]);
    expect(saved.n).toBeLessThan(live.n);
  });

  it("a windowless SAVED draft defaults to the INTERSECTION of its selected spans — same rule as the composer + share (RT-1 contract correction)", () => {
    // RE-BASELINED (ship-review RT-1, DELIBERATE contract correction — locked
    // 59-CONTEXT Area 3 Q4: "A windowless v2 draft in a compare set →
    // intersection default (same rule everywhere)"): this pin proves the
    // intersection rule and the determinism of the shared helper chain
    // (coverageSpanOf → defaultWindowFor — the SAME helpers the composer's
    // WINDOW-01 default and share-resolve use), which is the oracle below. The
    // SAVED-draft vehicle is a per-key membership book (MEMBER-02).
    const btcDates = buildDates("2024-01-02", 90);
    const ethDates = buildDates("2024-03-01", 50); // ragged head, later tail
    const btcReturns = altReturns(btcDates, 0.01, -0.008);
    const ethReturns = altReturns(ethDates, 0.012, -0.009);
    const inputs = perKeyLiveInputs(
      { "key-BTC": btcReturns, "key-ETH": ethReturns },
      { "key-BTC": 5000, "key-ETH": 5000 },
    );

    const windowlessDraft = draft({ memberKeyIds: ["key-BTC", "key-ETH"] });
    expect(windowlessDraft.window).toBeUndefined();

    // The composer-side default for the same book, via the shared helpers.
    const composerDefault = defaultWindowFor([
      coverageSpanOf(btcReturns)!,
      coverageSpanOf(ethReturns)!,
    ]);
    expect(composerDefault).not.toBeNull();

    const m = computeMetricsForDraft(windowlessDraft, inputs);
    // Determinism: same helper, same inputs → the lexicographically identical
    // window on every surface (compare == composer == share).
    expect(m.effective_start).toBe(composerDefault!.start);
    expect(m.effective_end).toBe(composerDefault!.end);
    // Both members cover the intersection by construction → both are members.
    expect(m.member_count).toBe(2);
  });

  it("a windowless SAVED draft over a single-span book is numerically unchanged (intersection of one span == its full span)", () => {
    // Back-compat note for the RT-1 re-baseline: for a book whose selected
    // spans all coincide (here: ONE member), intersection == union — the
    // default-window change is observable only on ragged books.
    const dates = buildDates("2024-01-02", 90);
    const inputs = perKeyLiveInputs(
      { "key-BTC": altReturns(dates, 0.01, -0.008) },
      { "key-BTC": 5000 },
    );

    const m = computeMetricsForDraft(draft({ memberKeyIds: ["key-BTC"] }), inputs);
    // Full span, all trading days — nothing clamped.
    expect(m.n).toBe(90);
    expect(m.effective_start).not.toBeNull();
    expect(m.effective_end).not.toBeNull();
  });

  it("APPLIES persisted leverageOverrides — a 2× leg scales the curve (LEV-02 round-2 H-2, composer parity)", () => {
    // Post-LEV-02 the composer FOLDS leverageByRef into draft.leverageOverrides
    // at Save, so a saved scenario's compare row MUST run at those multipliers —
    // else the compare surface shows 1× metrics while the composer shows the
    // levered numbers for the SAME scenario (the v1.5 PERSIST-02 divergence
    // class). Non-vacuous: a per-key member yields REAL (non-null) metrics.
    const dates = buildDates("2024-01-02", 80);
    const inputs = perKeyLiveInputs(
      { "key-A": altReturns(dates, 0.01, -0.008) },
      { "key-A": 5000 },
    );

    const base = computeMetricsForDraft(draft({ memberKeyIds: ["key-A"] }), inputs);
    const levered = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A"], leverageOverrides: { "key-A": 2 } }),
      inputs,
    );

    expect(base.twr).not.toBeNull();
    expect(base.volatility).not.toBeNull();
    // The 2× multiplier moved the projection — it is NOT ignored. A single 2×
    // leg scales the daily return series ×2, so vol scales up and the compounded
    // TWR diverges from the un-levered curve.
    expect(levered.twr).not.toBe(base.twr);
    expect(levered.volatility! > base.volatility!).toBe(true);
  });

  it("a legacy top-level `leverage` field (NOT the schema's leverageOverrides) stays ignored — only the persisted schema field is read", () => {
    // Defense-in-depth: the engine reads draft.leverageOverrides (the schema
    // field the codec persists), never a stray top-level `.leverage` key, so a
    // smuggled non-schema field can't move the curve.
    const dates = buildDates("2024-01-02", 80);
    const inputs = perKeyLiveInputs(
      { "key-A": altReturns(dates, 0.01, -0.008) },
      { "key-A": 5000 },
    );

    const base = computeMetricsForDraft(draft({ memberKeyIds: ["key-A"] }), inputs);
    const smuggled = computeMetricsForDraft(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...draft({ memberKeyIds: ["key-A"] }), leverage: { "key-A": 2 } } as any,
      inputs,
    );

    expect(smuggled.twr).toBe(base.twr);
    expect(smuggled.volatility).toBe(base.volatility);
  });
});

describe("buildLiveBookDraft", () => {
  it("produces an all-on, equity-weight per-key draft so all six metrics populate (gate satisfied)", () => {
    // Phase 63 ENGINE-02 repoint (was: holdings-snapshot live book): with the
    // holdings path deleted the healthy live-book own-book column IS the per-key
    // union blend (gate satisfied), the same P61-BUG-2 per-key basis as
    // liveBaselineMetrics. buildLiveBookDraft(true, eligible) stamps membership =
    // the eligible key set; { liveBook: true } holds it on the union path
    // (Phase-55 own-book lock). All six metrics populate over a healthy book.
    const dates = buildDates("2024-01-02", 80);
    const eligible = ["key-A", "key-B"];
    const inputs = perKeyLiveInputs(
      {
        "key-A": altReturns(dates, 0.01, -0.008),
        "key-B": altReturns(dates, 0.012, -0.009),
      },
      { "key-A": 6000, "key-B": 4000 },
      eligible,
    );

    const liveDraft = buildLiveBookDraft(true, eligible);
    // No added strategies, no leverage on the synthetic draft.
    expect(liveDraft.addedStrategies).toHaveLength(0);

    const m = computeMetricsForDraft(liveDraft, inputs, { liveBook: true });
    expect(m.n).toBe(80);
    expect(m.twr).not.toBeNull();
    expect(m.cagr).not.toBeNull();
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
    expect(m.max_drawdown).not.toBeNull();
    expect(m.volatility).not.toBeNull();
  });

  it("the gate=false live-book column is an honest null-metric em-dash (empty added-only set), never a fabricated 0", () => {
    // Phase 63 ENGINE-02 repoint (was: a degenerate holdings book → null). With
    // the holdings path deleted, a gate=false live-book column
    // (buildLiveBookDraft(false, []) → empty derived membership) computes the
    // series-space ADDED-ONLY set. With no added strategies that set is EMPTY →
    // computeScenario returns null metrics → an honest em-dash. D1-consistent;
    // affects only gate=false books (0 real users after GUARD-01). NULL, never 0.
    const dates = buildDates("2024-01-02", 80);
    const eligible = ["key-A"];
    const inputs = perKeyLiveInputs(
      { "key-A": altReturns(dates, 0.01, -0.008) },
      { "key-A": 5000 },
      eligible,
    );

    // Gate OFF ⇒ derived membership empty ⇒ added-only over an empty set ⇒ null.
    const m = computeMetricsForDraft(buildLiveBookDraft(false, []), inputs, {
      liveBook: true,
    });
    expect(m.member_count).toBe(0);
    expect(m.sharpe).toBeNull();
    expect(m.twr).toBeNull();
    expect(m.sharpe).not.toBe(0);
  });
});

// =========================================================================
// P61-BUG-2 (prod canary 2026-07-02) — book drafts must compute on PER-KEY
// units when the D3 gate is satisfied. Before this, computeMetricsForDraft
// always rebuilt drafts on the holdings-snapshot path, whose series spans
// differ from the per-key series the draft was authored (and windowed) on —
// so every saved book draft computed EMPTY under its persisted window
// ("0 overlapping days") in both the compare table and the share view.
// =========================================================================
describe("computeMetricsForDraft — per-key channel (P61-BUG-2)", () => {
  const PK_DATES = buildDates("2026-02-02", 40);
  const KEY_A = altReturns(PK_DATES, 0.004, -0.002);
  const KEY_B = altReturns(PK_DATES, -0.001, 0.003);
  // MEMBER-02 intent-preserving rebase: under the persisted-membership selector
  // (plan 62-02) a book column selects the per-key engine set from its SAVED
  // `memberKeyIds`, not the live gate. These fixtures are BOOK columns whose two
  // eligible keys ARE their persisted membership — so they stay on the per-key
  // path (mirroring how the panel derives membership = eligible ids for an
  // upgraded/underived column). A book fixture that instead defaulted to `[]`
  // would silently flip to the added-only holdings path (F5) and break these
  // per-key oracles + the Atlas-class 40-day golden.
  const BOOK_MEMBERS = ["key-A", "key-B"];

  /** Per-key live inputs: gate satisfied, two eligible keys. Series-space only
   *  (Phase 63 ENGINE-02 — the holdings-snapshot inputs are deleted). */
  function perKeyInputs(): ScenarioCompareInputs {
    return {
      addedStrategyReturnsLookup: {},
      addedStrategyMetadataLookup: {},
      perKeyReturnsByApiKeyId: { "key-A": KEY_A, "key-B": KEY_B },
      eligibleApiKeyIds: ["key-A", "key-B"],
      equityByApiKeyId: { "key-A": 70_000, "key-B": 30_000 },
      perKeyDailiesGateSatisfied: true,
    };
  }

  it("a saved book draft (no added strategies) computes a NON-empty per-key blend at its persisted window", () => {
    const win = { start: PK_DATES[5], end: PK_DATES[30] };
    const m = computeMetricsForDraft(
      draft({ window: win, memberKeyIds: BOOK_MEMBERS }),
      perKeyInputs(),
    );
    // Pre-fix: the holdings path had zero units → member_count 0, all null.
    expect(m.member_count).toBe(2);
    expect(m.member_ids).toEqual(
      expect.arrayContaining(["key-A", "key-B"]),
    );
    expect(m.n).toBeGreaterThan(0);
    expect(m.twr).not.toBeNull();
    // The persisted window is honored (engine clamps to it).
    expect(m.effective_start).toBe(win.start);
    expect(m.effective_end).toBe(win.end);
  });

  it("a book draft WITH an added strategy blends per-key units + the added unit (weight override honored)", () => {
    const ADDED = altReturns(PK_DATES, 0.01, -0.006);
    const inputs: ScenarioCompareInputs = {
      ...perKeyInputs(),
      addedStrategyReturnsLookup: { "added-1": ADDED },
      addedStrategyMetadataLookup: {
        "added-1": { disclosure_tier: "public", cagr: null, sharpe: null },
      },
    };
    const withAdded = computeMetricsForDraft(
      draft({
        memberKeyIds: BOOK_MEMBERS,
        addedStrategies: [
          {
            id: "added-1" as AddedStrategy["id"],
            name: "Added CSV Strat",
            markets: [],
            strategy_types: [],
          },
        ],
        weightOverrides: { "added-1": 0.5 },
      }),
      inputs,
    );
    expect(withAdded.member_count).toBe(3);
    expect(withAdded.member_ids).toEqual(expect.arrayContaining(["added-1"]));

    // Non-vacuous: the added 0.5 sleeve MOVES the numbers vs keys-only.
    const keysOnly = computeMetricsForDraft(
      draft({ memberKeyIds: BOOK_MEMBERS }),
      perKeyInputs(),
    );
    expect(withAdded.twr).not.toBeNull();
    expect(keysOnly.twr).not.toBeNull();
    expect(withAdded.twr).not.toBe(keysOnly.twr);
  });

  it("EMPTY membership → the series-space added-only path runs (per-key fields ignored), even with the gate set", () => {
    // Phase 63 ENGINE-02 repoint (was: "legacy holdings/added path runs"). Same
    // oracle axis — WHICH builder path runs for an empty-membership draft — now
    // that the holdings path is deleted: an empty `memberKeyIds` computes the
    // added-only path REGARDLESS of the gate (the F5 mechanism at the compute
    // unit). Gate left true to prove it is not load-bearing.
    const inputs: ScenarioCompareInputs = {
      ...perKeyInputs(),
      perKeyDailiesGateSatisfied: true,
    };
    const m = computeMetricsForDraft(draft(), inputs); // memberKeyIds []
    // Empty added set + empty membership → honest empty (series-space added-only).
    expect(m.member_count).toBe(0);
  });

  it("only MEMBER keys still eligible blend (a leftover series for a non-member/ineligible key is filtered)", () => {
    const inputs = perKeyInputs();
    inputs.perKeyReturnsByApiKeyId = {
      ...inputs.perKeyReturnsByApiKeyId,
      "key-GHOST": altReturns(PK_DATES, 0.02, -0.02),
    };
    // Membership = the two real keys; key-GHOST is neither a member nor eligible.
    const m = computeMetricsForDraft(draft({ memberKeyIds: BOOK_MEMBERS }), inputs);
    expect(m.member_count).toBe(2);
    expect(m.member_ids).not.toEqual(expect.arrayContaining(["key-GHOST"]));
  });
});

// =========================================================================
// MEMBER-02 membership selector (F5 closure) — plan 62-02.
//
// compare must select its per-key engine set from the draft's PERSISTED
// `memberKeyIds`, NOT the live gate. This closes red-team F5 by construction:
// a blank-authored saved draft (memberKeyIds=[]) must NEVER inherit the live
// book in its compare column even when the live gate is satisfied. The eligible-
// set intersection is also the MEMBER-04 compute-time drop point: a persisted
// member id that is no longer eligible is dropped, never blended (T-62-04/-05).
//
// The Atlas-class book-only golden (a 40-day per-key blend) must compute
// IDENTICALLY for an upgraded/underived book column — which the panel models by
// deriving membership = all eligible ids before compute. Modelling that column
// with memberKeyIds=[] would flip it to the added-only path and break the golden.
// =========================================================================
describe("MEMBER-02 membership selector (F5 closure)", () => {
  const PK_DATES = buildDates("2026-02-02", 40);
  const KEY_A = altReturns(PK_DATES, 0.004, -0.002);
  const KEY_B = altReturns(PK_DATES, -0.001, 0.003);

  /** Per-key live inputs: gate satisfied, two eligible keys. Series-space only
   *  (Phase 63 ENGINE-02 — no holdings-snapshot inputs). `eligible` overrides
   *  the eligible-key set. */
  function perKeyInputs(
    eligible: string[] = ["key-A", "key-B"],
  ): ScenarioCompareInputs {
    return {
      addedStrategyReturnsLookup: {},
      addedStrategyMetadataLookup: {},
      perKeyReturnsByApiKeyId: { "key-A": KEY_A, "key-B": KEY_B },
      eligibleApiKeyIds: eligible,
      equityByApiKeyId: { "key-A": 70_000, "key-B": 30_000 },
      perKeyDailiesGateSatisfied: true,
    };
  }

  it("F5: a blank-membership draft (memberKeyIds=[], no added) computes added-only even when the live gate is TRUE — never the live book", () => {
    // The red-team F5 case: a saved blank draft with the per-key gate satisfied.
    // The gate-only selector would merge the WHOLE live book into this column
    // (member_count 2); the membership selector computes the added-only (here
    // empty) result — member_count 0. RED against the current gate-only code.
    const m = computeMetricsForDraft(
      draft({ memberKeyIds: [], addedStrategies: [] }),
      perKeyInputs(),
    );
    expect(m.member_count).toBe(0);
    // Honest absence, never a fabricated live-book blend.
    expect(m.member_ids).toEqual([]);
    expect(m.twr).toBeNull();
  });

  // Phase 63 ENGINE-02 — the WR-01 "prod shape: blank draft over a NON-EMPTY
  // holdings book must not blend the holdings" regression pin is RETIRED here.
  // Its masked-bug premise (the else-branch fed `liveInputs.holdingsSummary`
  // unconditionally) is now STRUCTURALLY IMPOSSIBLE: the holdings-snapshot
  // fields are deleted from ScenarioCompareInputs, so there is no live-holdings
  // channel a blank column could accidentally inherit. The series-space F5
  // closure — a blank draft (memberKeyIds=[]) over a live book whose per-key
  // data IS present + gate satisfied computes added-only, never the book — is
  // fully pinned by the "F5: a blank-membership draft ... computes added-only
  // even when the live gate is TRUE" test immediately above (perKeyInputs()
  // carries non-empty per-key series + gate=true; member_count 0). Retirement
  // mirrors the Wave-2 H-0487 precedent (a test whose holdings premise dies with
  // the deletion). No coverage lost.

  it("a saved book draft selects the per-key set from its PERSISTED members (gate true)", () => {
    const m = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A", "key-B"] }),
      perKeyInputs(),
    );
    expect(m.member_count).toBe(2);
    expect(m.member_ids).toEqual(expect.arrayContaining(["key-A", "key-B"]));
    expect(m.twr).not.toBeNull();
  });

  it("membership is a strict SUBSET of eligible → only the persisted members blend (not the whole eligible set)", () => {
    // Membership names ONE key while TWO are eligible + gate=true. The gate-only
    // selector blends BOTH eligible keys (member_count 2); the membership
    // selector blends ONLY the persisted member (member_count 1). RED against
    // the current gate-only code.
    const m = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A"] }),
      perKeyInputs(["key-A", "key-B"]),
    );
    expect(m.member_count).toBe(1);
    expect(m.member_ids).toEqual(["key-A"]);
  });

  it("MEMBER-04 drop: a persisted member that is no longer eligible is intersected out at compute (honest, no throw)", () => {
    // memberKeyIds names a key that has since become ineligible ("key-gone");
    // the intersection with the SSR-computed eligible set drops it — the column
    // computes on the remaining still-eligible member, never throwing (T-62-04/-05).
    const m = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A", "key-gone"] }),
      perKeyInputs(["key-A"]),
    );
    expect(m.member_count).toBe(1);
    expect(m.member_ids).toEqual(["key-A"]);
  });

  it("golden: the Atlas-class book-only 40-day blend is preserved for an upgraded/derived-membership column", () => {
    // The upgraded-book column the panel models by deriving membership = all
    // eligible ids. Its RETURN-space metrics (twr, member set, bounds) must equal
    // the pre-change per-key blend byte for byte — the regression the naive
    // `?? []` default would break. (Synthetic stand-in for the prod Atlas golden
    // Cum/Sharpe @ 40-day book-only window.)
    const m = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A", "key-B"] }),
      perKeyInputs(),
    );
    expect(m.n).toBe(40);
    expect(m.member_count).toBe(2);
    expect(m.effective_start).toBe(PK_DATES[0]);
    expect(m.effective_end).toBe(PK_DATES[39]);
    // twr is basis-invariant (return space) → unchanged by BLEND-01.
    expect(m.twr).toBeCloseTo(0.04074, 4);
    // Phase 84 (BLEND-01) RE-BASELINE: per-key units carry asset_class 'crypto'
    // (84-01), so this book blend now correctly annualizes on √365 — the whole
    // point of the phase. The Sharpe moves from its pre-84 √252 value (10.45) to
    // 10.45·√(365/252) = 12.576; the underlying daily series (and twr) are
    // unchanged, only the RISK-clock basis. Pinning the new √365 value keeps this
    // golden honest to the shipped blend rule.
    expect(m.sharpe).toBeCloseTo(12.576, 1);
  });

  it("live-book union lock: buildLiveBookDraft(eligibleApiKeyIds) with { liveBook: true } stays byte-identical on the union path", () => {
    // The live-book column is the allocator's own book (Phase-55 union lock).
    // buildLiveBookDraft stamps membership = derived(gate, eligible ids) so it
    // keeps selecting the per-key set, and { liveBook: true } holds it on the
    // union path — effective bounds + n + twr identical to the golden blend.
    const eligible = ["key-A", "key-B"];
    const live = computeMetricsForDraft(
      buildLiveBookDraft(true, eligible),
      perKeyInputs(eligible),
      { liveBook: true },
    );
    expect(live.n).toBe(40);
    expect(live.member_count).toBe(2);
    expect(live.effective_start).toBe(PK_DATES[0]);
    expect(live.twr).toBeCloseTo(0.04074, 4);
  });

  it("WR-02 (ENGINE-02 repoint): gate OFF → empty membership → series-space added-only EMPTY set → an honest NULL-metric live-book column (never ?? 0)", () => {
    // Phase 63 ENGINE-02 repoint (was: "gate OFF → holdings basis / union
    // path"). buildLiveBookDraft still threads the REAL gate, so gate OFF still
    // yields an empty derived membership even when eligible keys exist. But the
    // holdings union path is DELETED — the empty-membership own-book column now
    // computes the series-space ADDED-ONLY set. With no added strategies that
    // set is EMPTY → computeScenario returns NULL metrics → an honest em-dash
    // column (D1-consistent; 0 real users after GUARD-01). We assert the metrics
    // are NULL, never a fabricated 0. Gate ON still selects the per-key blend.
    const eligible = ["key-A", "key-B"];

    const gateOff = computeMetricsForDraft(
      buildLiveBookDraft(false, eligible),
      perKeyInputs(eligible),
      { liveBook: true },
    );
    // Gate off ⇒ empty membership ⇒ added-only over an empty set ⇒ no members,
    // NULL metrics (honest em-dash), never a fabricated 0.
    expect(gateOff.member_count).toBe(0);
    expect(gateOff.twr).toBeNull();
    expect(gateOff.sharpe).toBeNull();
    expect(gateOff.twr).not.toBe(0);

    const gateOn = computeMetricsForDraft(
      buildLiveBookDraft(true, eligible),
      perKeyInputs(eligible),
      { liveBook: true },
    );
    // Gate on ⇒ the per-key blend selects both eligible keys.
    expect(gateOn.member_count).toBe(2);
  });
});

// =========================================================================
// Phase 84 (BLEND-01) — blend-basis threading in computeMetricsForDraft.
//
// A saved/compare draft must annualize on the SAME rule as the live composer:
// √365 if ANY SELECTED leg is crypto, else √252 (blendPeriodsPerYear over the
// SELECTED units — the engine's activeStrategies gate). Risk metrics
// (vol/sharpe/sortino) ride √periodsPerYear; twr/max_drawdown are
// basis-invariant. CAGR is DELIBERATELY not asserted here: scenario.ts still
// computes CAGR on the count clock (years = n/periodsPerYear), so it shifts
// with the basis until 84-06 converts it to the calendar clock this same
// phase — a whole-object deep-equal including cagr would go RED once 84-06
// lands, so every deep-equal below DESTRUCTURES cagr out of BOTH sides.
// =========================================================================
describe("computeMetricsForDraft — blend-basis annualization (BLEND-01)", () => {
  const SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  // The engine ROUNDS its outputs (scenario.ts: volatility toFixed(5), sharpe
  // toFixed(3), …), so a ratio of two rounded metrics drifts from the exact
  // √(365/252) at the ~1e-5 level. The rounding-robust oracle is therefore a
  // BYTE-IDENTICAL reference computed straight through the engine at the exact
  // basis (365) — identical rounding on both sides — not an √-ratio tolerance.

  /** A branded AddedStrategy fixture. */
  function addedStrat(id: string, name: string): AddedStrategy {
    return {
      id: id as AddedStrategy["id"],
      name,
      markets: ["BTC"],
      strategy_types: ["trend"],
    };
  }

  /** Added-only live inputs: one metadata entry per series id, asset_class from
   *  `assetClassById` (absent → null, the conservative 252 leg). */
  function addedInputs(
    series: Record<string, DailyPoint[]>,
    assetClassById: Record<string, string | null> = {},
  ): ScenarioCompareInputs {
    const addedStrategyMetadataLookup: ScenarioCompareInputs["addedStrategyMetadataLookup"] =
      {};
    for (const id of Object.keys(series)) {
      addedStrategyMetadataLookup[id] = {
        disclosure_tier: "public",
        cagr: null,
        sharpe: null,
        asset_class: assetClassById[id] ?? null,
      };
    }
    return { addedStrategyReturnsLookup: series, addedStrategyMetadataLookup };
  }

  it("a per-key-membership draft (per-key units are crypto) annualizes on √365 — byte-identical to the engine at 365, distinct from 252", () => {
    // Per-key units carry asset_class 'crypto' (84-01 buildPerKeyStrategyForBuilderSet),
    // so a per-key blend rides √365. Oracle: the helper's metrics must be
    // BYTE-IDENTICAL (cagr stripped — the 84-06 clock carve-out) to a direct
    // computeScenario over the SAME per-key set at basis 365, and NOT equal to
    // the 252 reference. RED against the pre-change engine (per-key computed at
    // the inert 252 default → equals ref252, not ref365).
    const dates = buildDates("2024-01-02", 80);
    const S = altReturns(dates, 0.01, -0.008);
    const win = { start: dates[3], end: dates[75] }; // explicit → deterministic reference

    const perKey = computeMetricsForDraft(
      draft({ memberKeyIds: ["key-A"], window: win }),
      perKeyLiveInputs({ "key-A": S }, { "key-A": 5000 }),
    );

    // Reference: the SAME per-key engine set (raw equity weights, all selected)
    // at each basis. The helper's plain-draft per-key path reproduces exactly
    // this set + state (single eligible member, no toggle/weight overrides).
    const set = buildPerKeyStrategyForBuilderSet({ "key-A": S }, { "key-A": 5000 });
    const refState = { ...set.state, window: win };
    const cache = buildDateMapCache(set.strategies);
    const ref365 = computeScenario(set.strategies, refState, cache, 365);
    const ref252 = computeScenario(set.strategies, refState, cache, 252);

    expect(perKey.twr).not.toBeNull(); // non-vacuous
    const { cagr: _pC, ...pRest } = perKey;
    const { cagr: _rC, ...r365 } = ref365;
    expect(pRest).toEqual(r365); // rides √365
    // Non-vacuous: the √252 reference is genuinely different (basis is load-bearing).
    expect(perKey.volatility).not.toBe(ref252.volatility);
  });

  it("an added-only draft with one crypto-tagged lookup entry annualizes on √365 (byte-identical to the engine at 365, distinct from 252)", () => {
    const dates = buildDates("2024-01-02", 80);
    const S = altReturns(dates, 0.01, -0.008);
    const win = { start: dates[3], end: dates[75] };
    const d = draft({
      addedStrategies: [addedStrat(SA, "A")],
      toggleByScopeRef: { [SA]: true },
      weightOverrides: { [SA]: 1 },
      window: win,
    });
    const cryptoInputs = addedInputs({ [SA]: S }, { [SA]: "crypto" });
    const crypto = computeMetricsForDraft(d, cryptoInputs);

    // Reference: the SAME added-only engine set at each basis.
    const set = buildAddedOnlySet(
      d.addedStrategies,
      cryptoInputs.addedStrategyReturnsLookup as Record<StrategyForBuilderId, DailyPoint[]>,
      cryptoInputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        (typeof cryptoInputs.addedStrategyMetadataLookup)[string]
      >,
    );
    const refState = {
      selected: { [SA]: true },
      weights: { [SA]: 1 },
      startDates: set.state.startDates,
      window: win,
    };
    const cache = buildDateMapCache(set.strategies);
    const ref365 = computeScenario(set.strategies, refState, cache, 365);
    const ref252 = computeScenario(set.strategies, refState, cache, 252);

    expect(crypto.twr).not.toBeNull();
    const { cagr: _cC, ...cRest } = crypto;
    const { cagr: _rC, ...r365 } = ref365;
    expect(cRest).toEqual(r365); // one crypto leg → √365
    expect(crypto.volatility).not.toBe(ref252.volatility);
  });

  it("an added-only all-null draft is BYTE-IDENTICAL to the plain default-252 engine path (cagr destructured out)", () => {
    // The default pin: an all-unknown blend derives blendPeriodsPerYear → 252,
    // the engine's own default, so the helper's output must deep-equal a direct
    // computeScenario call with NO periodsPerYear arg over the SAME added-only
    // engine set. Explicit window + weights make the reference deterministic
    // (no default-window ambiguity). cagr is stripped from BOTH sides (84-06
    // will move it to the calendar clock; it is out of scope for this default
    // pin, which asserts the RISK fields are byte-identical).
    const dates = buildDates("2024-01-02", 80);
    const seriesA = altReturns(dates, 0.01, -0.008);
    const seriesB = altReturns(dates, 0.012, -0.009);
    const win = { start: dates[5], end: dates[70] };
    const d = draft({
      addedStrategies: [addedStrat(SA, "A"), addedStrat(SB, "B")],
      toggleByScopeRef: { [SA]: true, [SB]: true },
      weightOverrides: { [SA]: 0.5, [SB]: 0.5 },
      window: win,
    });
    const inputs = addedInputs({ [SA]: seriesA, [SB]: seriesB }); // both null → 252

    const m = computeMetricsForDraft(d, inputs);

    // Reference: the plain default-252 engine path over the SAME added-only set.
    const set = buildAddedOnlySet(
      d.addedStrategies,
      inputs.addedStrategyReturnsLookup as Record<StrategyForBuilderId, DailyPoint[]>,
      inputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        (typeof inputs.addedStrategyMetadataLookup)[string]
      >,
    );
    const ref = computeScenario(
      set.strategies,
      {
        selected: { [SA]: true, [SB]: true },
        weights: { [SA]: 0.5, [SB]: 0.5 },
        startDates: set.state.startDates,
        window: win,
      },
      buildDateMapCache(set.strategies),
    ); // NO 4th arg → default 252

    expect(m.n).toBeGreaterThanOrEqual(10); // non-vacuous
    const { cagr: _mCagr, ...mRest } = m;
    const { cagr: _rCagr, ...rRest } = ref;
    expect(mRest).toEqual(rRest);
  });

  it("a toggled-OFF crypto leg does NOT flip a tradfi selection to √365 (SELECTED-only basis)", () => {
    // Basis is derived over SELECTED legs only (the engine's activeStrategies
    // gate). A crypto leg toggled OFF must not pull a tradfi selection onto √365.
    // Proof: the same draft with the off leg tagged crypto vs tagged null must be
    // byte-identical (cagr stripped) — and since the null variant's SELECTED set
    // is all-null (definitionally √252), the crypto variant is √252 too. RED
    // against a naive basis over ALL adapter units (off crypto → √365 → divergent).
    const dates = buildDates("2024-01-02", 80);
    const cryptoSeries = altReturns(dates, 0.02, -0.015);
    const tradfiSeries = altReturns(dates, 0.01, -0.008);
    const base = {
      addedStrategies: [addedStrat(SA, "A-crypto"), addedStrat(SB, "B-tradfi")],
      toggleByScopeRef: { [SA]: false, [SB]: true }, // crypto leg OFF, tradfi leg ON
      weightOverrides: { [SB]: 1 },
    };

    const cryptoOff = computeMetricsForDraft(
      draft(base),
      addedInputs(
        { [SA]: cryptoSeries, [SB]: tradfiSeries },
        { [SA]: "crypto", [SB]: null },
      ),
    );
    const nullOff = computeMetricsForDraft(
      draft(base),
      addedInputs(
        { [SA]: cryptoSeries, [SB]: tradfiSeries },
        { [SA]: null, [SB]: null },
      ),
    );

    expect(cryptoOff.twr).not.toBeNull(); // non-vacuous — the tradfi leg computes
    const { cagr: _c1, ...cryptoRest } = cryptoOff;
    const { cagr: _c2, ...nullRest } = nullOff;
    // The excluded crypto leg's asset_class is irrelevant to the basis → identical.
    expect(cryptoRest).toEqual(nullRest);
  });
});
