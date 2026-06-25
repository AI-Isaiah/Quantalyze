/**
 * Phase 10 Plan 01 / Task 2 — RED tests for scenario-adapter.ts
 *
 * Pins the contract for `buildStrategyForBuilderSet` (B4 lookup-map signature):
 *   - Holdings → StrategyForBuilder via flatMap; warm-up gate excludes < 30 days
 *   - id = buildHoldingRef(h) for holdings; UUID strategy.id for added strategies
 *   - No UUID/scope_ref collision (Pitfall 2)
 *   - state.selected from disabledHoldingRefs Set (B4 input)
 *   - state.weights default = h.value_usd / total; 0 for added strategies
 *   - state.startDates from strategy.start_date (fallback "2022-01-01")
 *   - addedStrategies are AddedStrategy[] (lightweight) — adapter consults
 *     addedStrategyReturnsLookup + addedStrategyMetadataLookup to project them
 *     into StrategyForBuilder
 *   - H5 brand: lookup-map keys use StrategyForBuilderId; hand-rolled strings
 *     and pre-cast StrategyForBuilder literals are rejected at compile time
 */
import { describe, it, expect } from "vitest";
import {
  buildStrategyForBuilderSet,
  buildPerKeyStrategyForBuilderSet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import { buildHoldingRef } from "./holding-outcome-adapter";
import type { DailyPoint } from "@/lib/scenario";
import type { AddedStrategy, HoldingForDefault } from "./scenario-state";

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

function makeReturns(n: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000)
      .toISOString()
      .slice(0, 10);
    out.push({ date: d, value: 0.001 });
  }
  return out;
}

const RETURNS_60D = makeReturns(60);

describe("buildStrategyForBuilderSet — happy paths", () => {
  it("T1 empty holdings + empty addedStrategies → empty result", () => {
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      [],
      {},
      {},
      {},
    );
    expect(result.strategies).toEqual([]);
    expect(result.state).toEqual({ selected: {}, weights: {}, startDates: {} });
  });

  it("T2 two holdings with full return series → 2 strategies, weights sum 1.0, both selected true", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.strategies.length).toBe(2);
    for (const s of result.strategies) {
      expect(s.id).toMatch(/^holding:binance:(BTC|ETH):spot$/);
      expect(s.daily_returns.length).toBe(60);
    }
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(true);
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
    const sum =
      result.state.weights["holding:binance:BTC:spot"] +
      result.state.weights["holding:binance:ETH:spot"];
    expect(sum).toBeCloseTo(1.0, 9);
  });

  it("T3 holding with < 30 days warm-up is excluded entirely", () => {
    const shortReturns = makeReturns(15);
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": shortReturns, // < 30 days → excluded
      },
      {},
      {},
    );
    expect(result.strategies.length).toBe(1);
    expect(result.strategies[0].id).toBe("holding:binance:BTC:spot");
  });

  it("T4 holdings + added strategy → 3 entries; UUID id is not a scope_ref", () => {
    const added: AddedStrategy[] = [
      {
        id: "00000000-0000-0000-0000-000000000001" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      added,
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: {
          disclosure_tier: "public",
          cagr: 0.12,
          sharpe: 1.4,
        },
      },
    );
    expect(result.strategies.length).toBe(3);
    const uuidEntry = result.strategies.find((s) =>
      /^[0-9a-f]{8}-/.test(s.id),
    );
    expect(uuidEntry).toBeDefined();
    expect(uuidEntry!.id).not.toMatch(/^holding:/);
  });

  it("T5 disabledHoldingRefs Set marks holdings as not selected", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set(["holding:binance:BTC:spot"]),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(false);
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
  });

  it("T6 weightOverrides applied when supplied (composer applies these post-adapter; but the adapter still defaults to value_usd/total when none supplied)", () => {
    // Under B4, weightOverrides is NOT an adapter input — the composer applies them
    // after the adapter. We verify that the default weight derivation is correct
    // (value_usd / total).
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.weights["holding:binance:BTC:spot"]).toBeCloseTo(0.6, 9);
    expect(result.state.weights["holding:binance:ETH:spot"]).toBeCloseTo(0.4, 9);
  });

  it("T7 minReturnDays override allows shorter series through", () => {
    const shortReturns = makeReturns(15);
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": shortReturns,
      },
      {},
      {},
      10, // minReturnDays = 10
    );
    expect(result.strategies.length).toBe(2);
  });

  it("T8 ID uniqueness invariant — no id is BOTH UUID and scope_ref (Pitfall 2)", () => {
    const added: AddedStrategy[] = [
      {
        id: "00000000-0000-0000-0000-000000000001" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      added,
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: RETURNS_60D,
      },
      {},
    );
    const uuidRe = /^[0-9a-f]{8}-/;
    for (const s of result.strategies) {
      const isUuid = uuidRe.test(s.id);
      const isScopeRef = s.id.startsWith("holding:");
      expect(isUuid && isScopeRef).toBe(false);
    }
  });

  it("T9 startDates assignment — strategy.start_date or fallback '2022-01-01'", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    for (const s of result.strategies) {
      const expected = s.start_date ?? "2022-01-01";
      expect(result.state.startDates[s.id]).toBe(expected);
    }
  });

  it("T10 totalValue=0 edge case → all default weights = 0 (no division-by-zero crash)", () => {
    const zeros: HoldingForDefault[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 0 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 0 },
    ];
    const result = buildStrategyForBuilderSet(
      zeros,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.weights["holding:binance:BTC:spot"]).toBe(0);
    expect(result.state.weights["holding:binance:ETH:spot"]).toBe(0);
  });
});

describe("buildStrategyForBuilderSet — B4 lookup-map signature", () => {
  it("T11 added strategy with lookup hits → daily_returns from lookup; metadata fields propagate", () => {
    const added: AddedStrategy[] = [
      {
        id: "uuid-1" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      added,
      {},
      { ["uuid-1" as StrategyForBuilderId]: RETURNS_60D },
      {
        ["uuid-1" as StrategyForBuilderId]: {
          disclosure_tier: "public",
          cagr: 0.12,
          sharpe: 1.4,
        },
      },
    );
    expect(result.strategies.length).toBe(1);
    const s = result.strategies[0];
    expect(s.daily_returns).toBe(RETURNS_60D);
    expect(s.disclosure_tier).toBe("public");
    expect(s.cagr).toBe(0.12);
    expect(s.sharpe).toBe(1.4);
    expect(s.codename).toBeNull();
    expect(s.volatility).toBeNull();
    expect(s.max_drawdown).toBeNull();
  });

  it("T12 added strategy missing both lookups → daily_returns=[]; defaults applied", () => {
    const added: AddedStrategy[] = [
      {
        id: "uuid-2" as StrategyForBuilderId,
        name: "Strat B",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      added,
      {},
      {},
      {},
    );
    expect(result.strategies.length).toBe(1);
    const s = result.strategies[0];
    expect(s.daily_returns).toEqual([]);
    expect(s.disclosure_tier).toBe("public");
    expect(s.cagr).toBeNull();
    expect(s.sharpe).toBeNull();
  });

  it("T13 disabledHoldingRefs Set marks the holding state.selected = false", () => {
    const result = buildStrategyForBuilderSet(
      [HOLDINGS_2[0]],
      new Set(["holding:binance:BTC:spot"]),
      [],
      { "holding:binance:BTC:spot": RETURNS_60D },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(false);
  });

  it("T14 holdings NOT in disabledHoldingRefs default to selected = true", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set(["holding:binance:BTC:spot"]),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
  });

  it("T15 (B4 signature regression) old object-literal signature is a TypeScript error", () => {
    // The @ts-expect-error directive is the assertion. We never actually invoke
    // this code path — it lives inside a function reference that is never called.
    const _compileOnly = () => {
      // @ts-expect-error — B4 pinned signature uses positional args; an object
      // literal with the OLD shape is rejected at compile time.
      buildStrategyForBuilderSet({
        holdingsSummary: HOLDINGS_2,
        holdingReturnsByScopeRef: {
          "holding:binance:BTC:spot": RETURNS_60D,
          "holding:binance:ETH:spot": RETURNS_60D,
        },
        addedStrategies: [],
        toggleByScopeRef: {},
        weightOverrides: {},
      });
    };
    expect(typeof _compileOnly).toBe("function");
  });
});

// H-0132 — the adapter only projects server→client (holdings + lookups →
// StrategyForBuilder[] + ScenarioState). There is NO inverse adapter for the
// post-edit ScenarioState → commit payload (ScenarioCommitDiff[]); the
// composer builds that payload inline in handleCommit (ScenarioComposer.tsx
// ~576-642) with `size_at_decision_usd = weight * scenarioAum`. The full
// server→client→commit round-trip therefore cannot be pinned at the adapter
// layer (there is no function to call). What CAN be pinned losslessly here is
// the forward derivation the commit math depends on: the adapter's default
// weight is `value_usd / totalValue`, so multiplying that weight back by the
// AUM (= totalValue) must reproduce the original per-holding value_usd. If the
// adapter's weight derivation drifts, every downstream `weight * aum`
// size_at_decision_usd lands wrong — this test is the pin for that contract.
// FLAGGED: a true lossless State→CommitDiff[] round-trip needs a production
// inverse adapter (handleCommit's inline construction extracted into
// scenario-adapter.ts); that is a production change, out of scope for a test.
// --- Commit-payload derivation oracle ------------------------------------
// handleCommit (ScenarioComposer.tsx ~644-739) builds the wire diffs inline,
// without an adapter call. Its size_at_decision_usd math is the *consumer* of
// the adapter's weight/key derivation. Because there is no production inverse
// adapter to call, we replicate the EXACT inline derivations here as an oracle
// and feed them the adapter's REAL output (state.weights keyed on the adapter's
// real keys). This is NOT a single-source parity tautology: the oracle encodes
// the THREE distinct size formulas handleCommit uses, and the adapter output it
// consumes is produced by the real adapter — so an adapter change to the weight
// derivation or the key scheme makes these reconstructions diverge from the
// committed dollar amounts and the assertions go red.
type DiffSize =
  | { kind: "voluntary_remove"; holding_ref: string; size: number }
  | { kind: "voluntary_modify"; holding_ref: string; size: number }
  | { kind: "voluntary_add"; strategy_id: string; size: number };

/** Mirror of handleCommit's scenarioAum: Σ value_usd over ENABLED holdings only
 *  (NOT the adapter's totalValue, which spans ALL holdings). */
function commitScenarioAum(
  holdings: HoldingForDefault[],
  disabled: Set<string>,
): number {
  let sum = 0;
  for (const h of holdings) {
    const ref = buildHoldingRef({
      venue: h.venue,
      symbol: h.symbol,
      holding_type: h.holding_type as "spot" | "derivative",
    });
    if (disabled.has(ref)) continue;
    sum += Number.isFinite(h.value_usd) ? h.value_usd : 0;
  }
  return sum;
}

describe("H-0132 — server→client→commit-payload round-trip (size_at_decision_usd derivation)", () => {
  it("the adapter keys state.weights on buildHoldingRef(h) — the SAME key handleCommit uses for holding_ref / weight lookup", () => {
    // Contract-drift guard: the commit path keys defaultWeightsForCommit,
    // weightOverrides and holding_ref on buildHoldingRef(h). If the adapter ever
    // keyed its weight/selected maps on a different string (e.g. the bare symbol,
    // or a `${venue}/${symbol}` slug), the commit path's `weightOverrides[ref] ?? 0`
    // lookup would silently miss and emit a value_usd-correct-but-weight-WRONG
    // voluntary_modify diff — undetectable by either suite. Pin the exact keys.
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    const expectedKeys = HOLDINGS_2.map((h) =>
      buildHoldingRef({
        venue: h.venue,
        symbol: h.symbol,
        holding_type: h.holding_type as "spot" | "derivative",
      }),
    ).sort();
    expect(Object.keys(result.state.weights).sort()).toEqual(expectedKeys);
    expect(Object.keys(result.state.selected).sort()).toEqual(expectedKeys);
    // And the derived key really is the canonical "holding:{venue}:{symbol}:{type}"
    // shape the commit wire schema expects (not, say, an upper/lower-cased drift).
    expect(expectedKeys).toEqual([
      "holding:binance:BTC:spot",
      "holding:binance:ETH:spot",
    ]);
  });

  it("all-enabled: handleCommit's voluntary_modify size (= value_usd) equals the adapter weight × adapter totalValue", () => {
    // The full forward chain the finding asks to pin: adapter default weight
    // = value_usd/totalValue, and handleCommit records the rebalanced row with
    // size_at_decision_usd = h.value_usd. Reconstructing value_usd from the
    // adapter's weight × the adapter's totalValue (all-holdings denominator) must
    // reproduce the committed dollar figure to the cent. A drift to
    // `value_usd / holdings.length` (equal-weight) or a renormalize-on-build
    // would break this reconstruction.
    const adapterTotalValue = HOLDINGS_2.reduce((s, h) => s + h.value_usd, 0);
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );

    const diffs: Extract<DiffSize, { kind: "voluntary_modify" }>[] = HOLDINGS_2.map((h) => {
      const ref = buildHoldingRef({
        venue: h.venue,
        symbol: h.symbol,
        holding_type: h.holding_type as "spot" | "derivative",
      });
      // handleCommit voluntary_modify: size_at_decision_usd = h.value_usd.
      return {
        kind: "voluntary_modify" as const,
        holding_ref: ref,
        size: Number.isFinite(h.value_usd) ? h.value_usd : 0,
      };
    });

    for (const d of diffs) {
      const weight = result.state.weights[d.holding_ref];
      // size committed by handleCommit == adapter weight × adapter totalValue.
      expect(weight * adapterTotalValue).toBeCloseTo(d.size, 6);
    }
    // And the sizes sum to the AUM (no value is dropped or double-counted).
    const sumSizes = diffs.reduce((s, d) => s + d.size, 0);
    expect(sumSizes).toBeCloseTo(adapterTotalValue, 6);
  });

  it("partial-disable: voluntary_add size uses ENABLED-only scenarioAum, which DIVERGES from the adapter's all-holdings totalValue (pins the deliberate two-AUM split)", () => {
    // The crux the finding flags: handleCommit derives a voluntary_add row as
    // `weight * scenarioAum` where scenarioAum = Σ value_usd over ENABLED
    // holdings only — but the adapter's default holding weight uses
    // totalValue = Σ over ALL holdings (enabled + disabled). The two denominators
    // are INTENTIONALLY different. If a refactor "unified" them (e.g. made the
    // adapter divide by the enabled-only sum, or made handleCommit use the
    // all-holdings total), this divergence would vanish and an add committed
    // while a holding is disabled would land with the wrong dollar size.
    // We pin the divergence explicitly so that unification is caught.
    const disabled = new Set(["holding:binance:BTC:spot"]); // 60k disabled
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      disabled,
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );

    const adapterTotalValue = HOLDINGS_2.reduce((s, h) => s + h.value_usd, 0);
    const commitAum = commitScenarioAum(HOLDINGS_2, disabled);

    // The two AUMs are NOT equal — BTC (60k) is excluded from commitAum but
    // included in the adapter's totalValue. This is the contract.
    expect(commitAum).toBeCloseTo(40000, 6); // ETH only
    expect(adapterTotalValue).toBeCloseTo(100000, 6); // BTC + ETH
    expect(commitAum).not.toBeCloseTo(adapterTotalValue, 1);

    // The adapter does NOT renormalize on disable: BTC keeps its raw value share
    // (0.6) even though selected=false. The disabled row's weight is preserved,
    // not folded into ETH — otherwise the composer's post-adapter renormalize
    // would double-apply.
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(false);
    expect(result.state.weights["holding:binance:BTC:spot"]).toBeCloseTo(
      HOLDINGS_2[0].value_usd / adapterTotalValue,
      9,
    );
    expect(result.state.weights["holding:binance:ETH:spot"]).toBeCloseTo(
      HOLDINGS_2[1].value_usd / adapterTotalValue,
      9,
    );

    // A voluntary_add at weight 0.5 commits 0.5 × commitAum (enabled-only) =
    // 20000, NOT 0.5 × adapterTotalValue (= 50000). Pin the enabled-only basis.
    const addWeight = 0.5;
    const addSize = addWeight * commitAum;
    expect(addSize).toBeCloseTo(20000, 6);
    expect(addSize).not.toBeCloseTo(addWeight * adapterTotalValue, 1);
  });

  it("added strategy default weight is 0 from the adapter → handleCommit's per-row size gate rejects it unless the composer supplies an override", () => {
    // The round-trip's other half: the adapter assigns every added strategy
    // weight 0 (composer is expected to apply an override post-adapter). The
    // commit math is `size = weight * scenarioAum`; with the adapter default of
    // 0 the size is 0, which handleCommit's per-row gate REFUSES
    // (`if (!Number.isFinite(size) || size <= 0)`). Pin that the adapter hands
    // off weight 0 for adds — a drift to a non-zero default (e.g. 1/(n+1))
    // would silently let a never-overridden add through the commit gate with a
    // fabricated dollar size.
    const added: AddedStrategy[] = [
      {
        id: "00000000-0000-0000-0000-000000000001" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      added,
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]:
          RETURNS_60D,
      },
      {},
    );
    const addId = "00000000-0000-0000-0000-000000000001";
    expect(result.state.weights[addId]).toBe(0);
    // handleCommit: size = weight(0) * scenarioAum → 0 → gate rejects.
    const commitAum = commitScenarioAum(HOLDINGS_2, new Set<string>());
    const gatedSize = result.state.weights[addId] * commitAum;
    const wouldBeRejected = !Number.isFinite(gatedSize) || gatedSize <= 0;
    expect(wouldBeRejected).toBe(true);
  });
});

describe("H5 brand — compile-time guards", () => {
  it("T16 hand-rolled StrategyForBuilder literal CANNOT be passed where AddedStrategy is expected", () => {
    // The @ts-expect-error directive is the assertion. We never actually invoke
    // this code path — it lives inside a function reference that is never called.
    const _compileOnly = () => {
      const handRolled = {
        id: "abc",
        name: "Strat A",
        codename: null,
        disclosure_tier: "public",
        strategy_types: [],
        markets: [],
        start_date: null,
        daily_returns: [],
        cagr: null,
        sharpe: null,
        volatility: null,
        max_drawdown: null,
      };
      // @ts-expect-error — H5 brand prevents pre-cast StrategyForBuilder from passing as an AddedStrategy
      buildStrategyForBuilderSet(HOLDINGS_2, new Set(), [handRolled], {}, {}, {});
    };
    expect(typeof _compileOnly).toBe("function");
  });

  it("T17 unbranded string CANNOT be used as a key in addedStrategyReturnsLookup", () => {
    const lookup: Record<StrategyForBuilderId, DailyPoint[]> = {};
    // Branded keys: this is the only legal write path.
    lookup["uuid-1" as StrategyForBuilderId] = [];
    // @ts-expect-error — H5 brand: unbranded string cannot index Record<StrategyForBuilderId, ...>
    lookup["unbranded-string"] = [];
    expect(Object.keys(lookup).length).toBeGreaterThan(0);
  });

  // M-0149 (pr-test-analyzer) — T15/T16/T17 are compile-time guards: their
  // real assertion is the `@ts-expect-error` directive (enforced by
  // `tsc --noEmit`, NOT by vitest), and the `expect(typeof _compileOnly).
  // toBe("function")` line is a tautology that runs but cannot catch a type
  // regression. (The protection is genuine — removing the brand makes the
  // `@ts-expect-error` "unused", a tsc error — but it lives in the type
  // checker, not here.) This adds the missing RUNTIME-behavioral counterpart
  // vitest CAN catch: the H5 brand must be a zero-cost phantom type —
  // `string & { __brand }` — that is fully erased at runtime, so a branded id
  // is `===` its underlying string and indexes a plain-object lookup
  // identically. If the brand were ever reified into a runtime wrapper
  // (boxing the string), every `Record<StrategyForBuilderId, ...>` lookup the
  // adapter performs would silently miss. This pins that invariant.
  it("M-0149: StrategyForBuilderId brand is runtime-erased — branded id indexes a plain lookup identically to its raw string", () => {
    const RAW = "00000000-0000-0000-0000-000000000001";
    const branded = RAW as StrategyForBuilderId;
    // Brand is compile-only: at runtime the value is the unchanged string.
    expect(branded).toBe(RAW);
    expect(typeof branded).toBe("string");

    // A branded write is readable via the raw string key (and vice-versa),
    // proving the brand adds no runtime key transformation.
    const lookup: Record<StrategyForBuilderId, DailyPoint[]> = {};
    const sentinel: DailyPoint[] = [{ date: "2026-01-01", value: 1 }];
    lookup[branded] = sentinel;
    expect((lookup as Record<string, DailyPoint[]>)[RAW]).toBe(sentinel);
    expect(Object.keys(lookup)).toEqual([RAW]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 37 Plan 02 (DSRC-01) — the SIBLING per-key builder. One
// StrategyForBuilder per api_key_id (id === api_key_id), weight = each key's
// RAW clamped equity share, default selected=true, empty-series keys skipped.
// This is the data-source-keyed projection (per api_key, not per blended book).
//
// CRITICAL (Pitfall 1): weights are RAW equity-share USD — NOT renormalized to
// sum-to-1. The frozen computeScenario engine renormalizes per-day over the
// selected set (r / activeWeightSum, scenario.ts). The raw-weight assertion
// below is the falsifiability guard: adding any sum-to-1 normalize to the
// builder turns it red.
//
// The B4 buildStrategyForBuilderSet suite + the H-0132 oracle above run in the
// SAME invocation — green there proves the sibling is isolated and did not
// disturb the B4 positional signature.
// ─────────────────────────────────────────────────────────────────────────
describe("buildPerKeyStrategyForBuilderSet — per-key keying (DSRC-01)", () => {
  it("PK1 empty inputs → empty strategies + empty state", () => {
    const result = buildPerKeyStrategyForBuilderSet({}, {});
    expect(result.strategies).toEqual([]);
    expect(result.state).toEqual({ selected: {}, weights: {}, startDates: {} });
  });

  it("PK2 two keys with full series → id === api_key_id, both selected true, weights = clamped equity-share", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D, "key-B": RETURNS_60D },
      { "key-A": 70, "key-B": 30 },
    );
    expect(result.strategies.length).toBe(2);
    // id keying: the strategy ids ARE the api_key_ids.
    expect(result.strategies.map((s) => s.id).sort()).toEqual([
      "key-A",
      "key-B",
    ]);
    for (const s of result.strategies) {
      expect(s.daily_returns.length).toBe(60);
      expect(s.disclosure_tier).toBe("exploratory");
    }
    // default included
    expect(result.state.selected["key-A"]).toBe(true);
    expect(result.state.selected["key-B"]).toBe(true);
    // weight = clamped equity-share for that key
    expect(result.state.weights["key-A"]).toBe(70);
    expect(result.state.weights["key-B"]).toBe(30);
  });

  it("PK3 RAW equity-share weights — NOT renormalized to sum-to-1 (Pitfall 1 guard)", () => {
    // With equity { A: 70, B: 30 } the raw weights MUST be 70 and 30, NOT the
    // 0.7 / 0.3 fractions a sum-to-1 normalize would produce. The frozen engine
    // owns renormalization (r / activeWeightSum) — the builder must not.
    const result = buildPerKeyStrategyForBuilderSet(
      { A: RETURNS_60D, B: RETURNS_60D },
      { A: 70, B: 30 },
    );
    expect(result.state.weights.A).toBe(70);
    expect(result.state.weights.B).toBe(30);
    // Mutation guard: a normalized builder would make these sum to 1.
    expect(result.state.weights.A + result.state.weights.B).toBe(100);
  });

  it("PK4 a key whose series is [] is skipped entirely (not in strategies, not in state)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D, "key-empty": [] },
      { "key-A": 70, "key-empty": 30 },
    );
    expect(result.strategies.map((s) => s.id)).toEqual(["key-A"]);
    expect(result.state.selected["key-empty"]).toBeUndefined();
    expect(result.state.weights["key-empty"]).toBeUndefined();
    expect(result.state.startDates["key-empty"]).toBeUndefined();
  });

  it("PK5 a key with negative equity share → weight clamped to 0 (never negative)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-neg": RETURNS_60D },
      { "key-neg": -500 },
    );
    expect(result.state.weights["key-neg"]).toBe(0);
  });

  it("PK6 a key absent from equityByApiKeyId → weight 0 (?? 0 default)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D },
      {}, // no equity entry for key-A
    );
    expect(result.state.weights["key-A"]).toBe(0);
    expect(result.state.selected["key-A"]).toBe(true);
  });

  it("PK7 startDates = returns[0].date when present", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D },
      { "key-A": 100 },
    );
    expect(result.state.startDates["key-A"]).toBe(RETURNS_60D[0].date);
    expect(result.strategies[0].start_date).toBe(RETURNS_60D[0].date);
  });

  it("PK8 startDates falls back to '2022-01-01' when returns[0].date is absent", () => {
    // A non-empty series whose first point carries no date (defensive) → the
    // builder must fall back to the engine's "2022-01-01" sentinel, not undefined.
    const noDateSeries = [{ value: 0.001 } as unknown as DailyPoint];
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": noDateSeries },
      { "key-A": 100 },
    );
    expect(result.state.startDates["key-A"]).toBe("2022-01-01");
  });

  it("PK9 does not touch the B4 buildStrategyForBuilderSet output (sibling isolation, sanity)", () => {
    // The per-key builder takes a different signature entirely; a B4 call in the
    // same test is byte-identical to T2 above.
    const b4 = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(b4.strategies.length).toBe(2);
    // B4 holding ids are scope_refs, NEVER api_key_id-shaped here.
    for (const s of b4.strategies) {
      expect(s.id.startsWith("holding:")).toBe(true);
    }
  });
});
