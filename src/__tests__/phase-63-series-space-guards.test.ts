import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DailyPoint,
  ScenarioState,
  StrategyForBuilder,
} from "@/lib/scenario";
import {
  buildPerKeyStrategyForBuilderSet,
  mergeAddedIntoPerKeySet,
  buildAddedOnlySet,
  type StrategyForBuilderId,
} from "@/app/(dashboard)/allocations/lib/scenario-adapter";
import type { AddedStrategy } from "@/app/(dashboard)/allocations/lib/scenario-state";

/**
 * Phase 63 (ENGINE-05) — series-space durability guard.
 *
 * Phase 63 DELETED the holdings-snapshot fallback engine: no production module
 * builds holdings→units, collapses symbol-keyed aliases, or reconstructs a
 * gate=false live baseline from a holdings snapshot. Every scenario engine unit
 * id is now a per-key `api_keys` UUID or an added `strategies` UUID (disjoint by
 * construction). This guard makes that deletion a STANDING invariant instead of
 * a one-time act — a reintroduction of any holdings-engine machinery fails CI
 * loud, on every developer's `npm run test`, pointing straight at the offending
 * file (the `admin-csrf-ratelimit-grep.test.ts` readFileSync class).
 *
 * TWO LAYERS, both falsified during authoring (Rule 9):
 *
 *   1. SOURCE-SCAN — for each scenario-surface production source, assert the
 *      ABSENCE of the deleted holdings-engine IDENTIFIERS. This is
 *      identifier-precise per file, NEVER a blanket `holding:` string ban:
 *      `scenarioAum` legitimately reads `scopeRef.startsWith("holding:")` on
 *      DRAFT toggle refs (ScenarioComposer.tsx, PRESENT-02 keeps it through
 *      Phase 64) and `buildHoldingRef` stays in Holdings-tab / bridge surfaces.
 *      A blanket string ban would be permanently, wrongly red. The scan is
 *      comment-inclusive by design — Plan 04 reworded every negative-doc mention
 *      so it stays green on legitimate prose, red only on a real reintroduction.
 *
 *   2. RUNTIME id-format — every surviving series-space builder output
 *      (buildPerKeyStrategyForBuilderSet, mergeAddedIntoPerKeySet,
 *      buildAddedOnlySet) has NO strategy whose id is a `holding:` scope_ref.
 *      This is the invariant "no `holding:` scopeRef as an ENGINE UNIT ID",
 *      enforced at the value layer where a blanket source ban cannot reach.
 *
 * Rule-9 non-vacuity (recorded in the commit message):
 *   - Source-scan: temporarily planted `collapseAliasedHoldingStrategies` into
 *     scenario-compare.ts — the per-file it() went red — then reverted.
 *   - Runtime: fed a fixture strategy with a `holding:`-prefixed id through
 *     assertNoHoldingEngineUnitId — the runtime it() went red — then reverted.
 */

// ─────────────────────────────────────────────────────────────────────────
// LAYER 1 — source-scan (readFileSync, identifier-precise, per-file)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The deleted holdings-engine identifiers. Their reappearance in ANY
 * scenario-surface source means the fallback engine (or a piece of it) has
 * crept back into the series-space path.
 */
const BANNED_ENGINE_IDENTIFIERS = [
  "buildStrategyForBuilderSet", // the holdings→units builder (ENGINE-01/04)
  "collapseAliasedHoldingStrategies", // symbol-keyed alias collapse (dealias)
  "mapDeAliasedWeightsToRawBasis", // optimizer apply-back over collapsed basis
  "symbolByHoldingId", // holdings-id → symbol memo (alias precursor)
  "scenario-dealias", // the deleted module's import specifier
] as const;

/**
 * queries.ts (the SSR live-baseline surface) never imported the builder /
 * optimizer / symbol-memo tokens — its holdings-engine surface was the third
 * `scenario-dealias` importer plus the `liveBaselineMetricsFromHoldings`
 * reconstruction. Scan exactly that 3-token subset there.
 */
const BANNED_QUERIES_TOKENS = [
  "scenario-dealias",
  "collapseAliasedHoldingStrategies",
  "liveBaselineMetricsFromHoldings",
] as const;

/**
 * The scan set. Paths are repo-root-relative; a missing file is a test
 * FAILURE, not a skip (Rule 12) — a rename that dodges the guard must break it.
 */
const SCENARIO_SURFACE_FILES = [
  "src/app/(dashboard)/allocations/lib/scenario-adapter.ts",
  "src/app/(dashboard)/allocations/lib/scenario-compare.ts",
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx",
  "src/app/scenario-share/[token]/share-resolve.ts",
] as const;

const QUERIES_FILE = "src/lib/queries.ts";

/** Read a scan-set source fail-loud (missing file → explicit test failure). */
function readSource(relPath: string): string {
  const abs = join(process.cwd(), relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `ENGINE-05 scan-set file is missing: ${relPath}. A rename or move must ` +
        `carry the guard with it — a missing scanned source is a FAILURE, not ` +
        `a skip (the deletion invariant would otherwise silently stop being ` +
        `enforced).`,
    );
  }
  return readFileSync(abs, "utf8");
}

describe("ENGINE-05 source-scan — the holdings fallback engine stays deleted", () => {
  it("all scan-set files exist (sanity — a missing source is a failure, not a skip)", () => {
    for (const rel of [...SCENARIO_SURFACE_FILES, QUERIES_FILE]) {
      expect(
        existsSync(join(process.cwd(), rel)),
        `ENGINE-05 scan-set file missing: ${rel}`,
      ).toBe(true);
    }
  });

  for (const rel of SCENARIO_SURFACE_FILES) {
    const source = readSource(rel);
    for (const token of BANNED_ENGINE_IDENTIFIERS) {
      it(`${rel} contains no '${token}' (series-space invariant)`, () => {
        expect(
          source.includes(token),
          `Holdings-engine identifier '${token}' reappeared in ${rel}. Phase 63 ` +
            `deleted the holdings-snapshot fallback engine — the scenario surfaces ` +
            `compute on series space only (per-key api_keys UUIDs + added ` +
            `strategies UUIDs, disjoint). Do NOT reintroduce the builder / ` +
            `alias-collapse / optimizer-remap / symbol-memo machinery; wire the ` +
            `series-space path (buildPerKeyStrategyForBuilderSet / ` +
            `mergeAddedIntoPerKeySet / buildAddedOnlySet) instead.`,
        ).toBe(false);
      });
    }
  }

  {
    const source = readSource(QUERIES_FILE);
    for (const token of BANNED_QUERIES_TOKENS) {
      it(`${QUERIES_FILE} contains no '${token}' (honest gate=false baseline)`, () => {
        expect(
          source.includes(token),
          `Holdings-engine token '${token}' reappeared in ${QUERIES_FILE}. The ` +
            `gate=false SSR live baseline is the honest emptyLiveBaselineMetrics ` +
            `(AUM preserved, all metrics null) — it must NOT reconstruct metrics ` +
            `from a holdings snapshot (no fabricated ρ=1.0). Keep the emptyDefault ` +
            `arm; do not re-import scenario-dealias or reintroduce ` +
            `liveBaselineMetricsFromHoldings.`,
        ).toBe(false);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// LAYER 2 — runtime id-format (no builder output is a `holding:` engine unit)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The falsifiable assertion point (Rule 9): every unit id in a series-space
 * builder output must be a real per-key / added UUID, never a `holding:`
 * scope_ref. Planting a `holding:`-prefixed fixture id and running it through
 * here turns the runtime layer red — that is the non-vacuity proof.
 */
function assertNoHoldingEngineUnitId(
  set: { strategies: StrategyForBuilder[] },
  label: string,
): void {
  for (const s of set.strategies) {
    expect(
      s.id.startsWith("holding:"),
      `${label} emitted an engine unit with a 'holding:' scope_ref id ('${s.id}'). ` +
        `Series-space units are api_keys UUIDs (per-key) or strategies UUIDs ` +
        `(added) — a 'holding:' id means the holdings engine leaked back in.`,
    ).toBe(false);
  }
}

describe("ENGINE-05 runtime id-format — no surviving builder emits a 'holding:' engine unit", () => {
  const makeReturns = (n: number): DailyPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      value: 1 + i * 0.001,
    }));
  const RETURNS = makeReturns(30);

  const A_ID = "aaaaaaaa-0000-0000-0000-000000000001" as StrategyForBuilderId;
  const B_ID = "bbbbbbbb-0000-0000-0000-000000000002" as StrategyForBuilderId;
  const ADDED: AddedStrategy[] = [
    { id: A_ID, name: "Added A", markets: ["binance"], strategy_types: ["momentum"] },
    { id: B_ID, name: "Added B", markets: ["okx"], strategy_types: ["trend"] },
  ];
  const ADDED_RETURNS: Record<StrategyForBuilderId, DailyPoint[]> = {
    [A_ID]: RETURNS, // A carries a real series; B is warm-up-gated out to []
  };
  const ADDED_META: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  > = {
    [A_ID]: { disclosure_tier: "public", cagr: 0.1, sharpe: 1.1 },
  };

  const EMPTY_PER_KEY: { strategies: StrategyForBuilder[]; state: ScenarioState } = {
    strategies: [],
    state: { selected: {}, weights: {}, startDates: {} },
  };

  it("buildPerKeyStrategyForBuilderSet — every unit id is an api_keys UUID (no 'holding:' ref)", () => {
    const perKey = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS, "key-B": RETURNS },
      { "key-A": 70, "key-B": 30 },
    );
    expect(perKey.strategies.length).toBe(2);
    assertNoHoldingEngineUnitId(perKey, "buildPerKeyStrategyForBuilderSet");
  });

  it("buildAddedOnlySet — every unit id is an added strategies UUID (no 'holding:' ref)", () => {
    const addedOnly = buildAddedOnlySet(ADDED, ADDED_RETURNS, ADDED_META);
    expect(addedOnly.strategies.length).toBe(2);
    assertNoHoldingEngineUnitId(addedOnly, "buildAddedOnlySet");
  });

  it("mergeAddedIntoPerKeySet — the mixed per-key + added blend emits no 'holding:' unit", () => {
    const perKey = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS, "key-B": RETURNS },
      { "key-A": 70, "key-B": 30 },
    );
    const merged = mergeAddedIntoPerKeySet(perKey, ADDED, ADDED_RETURNS, ADDED_META);
    // Non-vacuity: the blend actually carries units to inspect (2 keys + 2 added).
    expect(merged.strategies.length).toBe(4);
    assertNoHoldingEngineUnitId(merged, "mergeAddedIntoPerKeySet");
  });

  it("the empty-per-key reduction (blank mode) emits no 'holding:' unit either", () => {
    const merged = mergeAddedIntoPerKeySet(EMPTY_PER_KEY, ADDED, ADDED_RETURNS, ADDED_META);
    assertNoHoldingEngineUnitId(merged, "mergeAddedIntoPerKeySet (empty per-key)");
  });
});
