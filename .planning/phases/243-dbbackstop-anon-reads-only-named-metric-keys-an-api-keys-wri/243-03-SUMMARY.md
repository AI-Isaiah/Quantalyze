---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 03
subsystem: factsheet payload builder (anon-reachable read path)
tags: [postgrest, jsonb-alias, privacy, factsheet, DBACC-01]
requires: []
provides:
  - "BY_BASIS_ALIASES: the one select fragment (21 named -> aliases) for strategy_analytics.metrics_json_by_basis"
  - "rebuildMetricsJsonByBasis: the one rule that rebuilds the writer-shaped per-basis object from the aliases"
  - "PINNED_BY_BASIS_ALIAS_NAMES (hand-typed) and byBasisAliasRow (alias-shape seeder) for test fakes"
affects: [243-04 OG route (imports the same fragment), 243-09 column revoke (PR-B)]
actuals:
  tokens: 6400
  tasks: 3
  commits: 3
plan_head_before: be3c2d1a458d6a433b7af70481031f6f05276cc8
plan_head_after: 56fa44de93120ef46adbc888efbb6c368434c0d5
tech-stack:
  added: []
  patterns: ["named jsonb -> aliases instead of a whole-column read", "hand-typed pin list independent of the production constant"]
key-files:
  created:
    - src/lib/factsheet/by-basis-projection.ts
    - src/lib/factsheet/by-basis-projection.test.ts
    - src/lib/test-helpers/by-basis-alias-row.ts
  modified:
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/lib/factsheet/fetch-and-build-payload.single-key-conventions.test.ts
    - src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx
    - src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx
key-decisions:
  - "Alias form by_basis_<basis>_<serverKey>:metrics_json_by_basis-><basis>-><serverKey>, 3 bases x 7 BASIS_KPI_MAP keys = 21, jsonb arrows only"
  - "Bare-column ban regex is /metrics_json(?!->|_by_basis->)/ (not the RESEARCH/PATTERNS form, which also rejects every correct alias)"
  - "BY_BASIS_ALIASES is an UNANNOTATED string literal: postgrest-js types the builder's row correctly, no cast needed"
requirements-completed: [DBACC-01]
coverage:
  - id: D1
    description: "The factsheet builder reads metrics_json_by_basis only as 21 pinned -> aliases and a test fails on an extra or missing alias"
    requirement: DBACC-01
    verification:
      - kind: unit
        ref: "src/lib/factsheet/by-basis-projection.test.ts#BY_BASIS_ALIASES: the exact-set pin"
        status: pass
      - kind: unit
        ref: "src/lib/factsheet/fetch-and-build-payload.test.ts#the strategies select carries exactly the 21 pinned by-basis aliases"
        status: pass
    human_judgment: false
  - id: D2
    description: "The rebuilt per-basis object feeds the unchanged readers identically for writer-shaped rows (parity table, round trip, storedCashHeadlineGate)"
    requirement: DBACC-01
    verification:
      - kind: unit
        ref: "src/lib/factsheet/by-basis-projection.test.ts#rebuildMetricsJsonByBasis"
        status: pass
    human_judgment: false
  - id: D3
    description: "The aliases resolve against a real PostgREST (live end-to-end check is CI's frontend-live-db-lane factsheet-buildable-live-db test; not run locally)"
    requirement: DBACC-01
    verification: []
    human_judgment: true
    rationale: "No local PostgREST was run; the postgrest-js select parser accepted the literal at type level (tsc clean) but the real-database proof is the CI lane."
duration: 55min
completed: 2026-11-27
status: complete
---

# Phase 243 Plan 03: DBACC-01 builder half Summary

**The factsheet payload builder now projects `strategy_analytics.metrics_json_by_basis` as exactly 21 named `->` aliases (3 bases x the 7 `BASIS_KPI_MAP` keys), rebuilds the writer-shaped object from them for the unchanged readers, and an exact-set pin against a hand-typed list fails on any extra or missing alias.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files:** 3 created, 5 modified (8 in `src/`)

## Accomplishments

- `src/lib/factsheet/by-basis-projection.ts`: `BY_BASIS_BASES`, `BY_BASIS_ALIASES` (one hand-written literal, 21 entries) and `rebuildMetricsJsonByBasis` (non-finite or non-number becomes null; a basis whose seven values are all null is omitted; undefined when no basis survives). Docblock states the why, the jsonb-arrow rule, the one divergence, the column-grant consequence of plan 09, and the three-place edit rule for a new key.
- `src/lib/test-helpers/by-basis-alias-row.ts`: `PINNED_BY_BASIS_ALIAS_NAMES` hand-typed (not derived from the production constant or `BASIS_KPI_MAP`) and `byBasisAliasRow`.
- `src/lib/factsheet/by-basis-projection.test.ts` (15 tests): exact-set pin, path/name agreement, no text arrow and no bare column, the RESEARCH edge-table parity rows, round trip (one and three bases, and a series array never surviving), `storedCashHeadlineGate` over the rebuilt object.
- Builder (`resolveFactsheetInputs`): the embed interpolates `BY_BASIS_ALIASES`; `const metricsJsonByBasis = rebuildMetricsJsonByBasis(analytics)` is computed once and passed to `readCompositeFactsheet` (`metricsJsonByBasis:`) and as the fourth argument of `readSingleKeyBasisOpts`. No signature changed. The sixth argument (`analytics`, the persisted-scalar row) is untouched.
- `fetch-and-build-payload.test.ts`: both lookaheads tightened to `/metrics_json(?!->|_by_basis->)/`; a new exact-set test over the parsed select; `analyticsRow` translates an `over.metrics_json_by_basis` seed into `byBasisAliasRow(...)` and drops the key, so every existing readable seed keeps its form and the builder is never handed the whole column.

## Typing outcome (plan asked for this)

The literal was left WITHOUT a `: string` annotation. `npx tsc --noEmit` is clean: postgrest-js parsed the interpolated select (the `->` alias paths) and the builder's row needed no `ParserError` cast. No annotation, no cast.

## Task 1 full-suite run: failing files (the Task 2 and 3 work list)

First full `npx vitest run` after Task 1 (before any seed fix): `9 failed | 1284 passed | 20 skipped` files, `14 failed` tests. Of those, the ones caused by this plan (fake still seeds the whole column) were exactly three files; the other six were not individually recorded (the run's output was tail-truncated); the final run's five failures are listed under Deferred Issues:

| File | Why | Fixed in |
|---|---|---|
| `src/lib/factsheet/fetch-and-build-payload.single-key-conventions.test.ts` | seeds `metrics_json_by_basis` directly (composite arm: the headline went missing, "a conventions blip blanked the factsheet") | Task 2, `7b3383ec5` |
| `src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx` | two whole-column seeds | Task 3, `56fa44de9` |
| `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` | one whole-column seed (`metricsJsonByBasis` param) | Task 3, `56fa44de9` |

Seeds moved to `...byBasisAliasRow(X)`. No `expect(` line changed (`git diff -U0 | grep expect(` over the seed commits is empty).

## Per-file seed list (every file in the plan's `<files>`)

| File | Result |
|---|---|
| `src/lib/factsheet/fetch-and-build-payload.benchmark.test.ts` | passes UNTOUCHED (only `metrics_json_by_basis: null`, builder reads absent aliases as no basis) |
| `src/lib/factsheet/fetch-and-build-payload.single-key-conventions.test.ts` | EDITED (null default and the composite seed via `byBasisAliasRow`) |
| `src/lib/factsheet/build-payload.headline-source.test.ts` | passes UNTOUCHED (calls the pure readers directly with `row.metrics_json_by_basis`, never the builder fake) |
| `src/__tests__/figure-parity-pages.test.tsx` | passes UNTOUCHED (null seeds only) |
| `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` | passes UNTOUCHED (null seed only) |
| `src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx` | EDITED (2 seeds) |
| `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx` | passes UNTOUCHED |
| `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` | passes UNTOUCHED |
| `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` | passes UNTOUCHED |
| `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` | EDITED (1 seed) |
| `src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx` | passes UNTOUCHED |
| `src/app/factsheet/[id]/v2/basis-context.benchmark-prices.test.tsx` | passes UNTOUCHED |
| `src/__tests__/factsheet-buildable-live-db.test.ts` | NOT edited by design (real column through the admin client; the live end-to-end check in `frontend-live-db-lane`) |

Remaining `metrics_json_by_basis` hits under `src/app/factsheet/[id]/v2/*.test.tsx`: `git grep -n "metrics_json_by_basis:"` lists none.

## PROOF-01 (verbatim, byte backup, no git checkout/restore/stash)

Neuter: `cp src/lib/factsheet/by-basis-projection.ts <scratchpad>/by-basis-projection.ts.bak`, then append one extra alias `by_basis_cash_settlement_returns_series:metrics_json_by_basis->cash_settlement->returns_series` to the literal.

RED run (`npx vitest run src/lib/factsheet/by-basis-projection.test.ts src/lib/factsheet/fetch-and-build-payload.test.ts`):

```
=== RED run ===
 FAIL  |jsdom| src/lib/factsheet/by-basis-projection.test.ts > BY_BASIS_ALIASES: the exact-set pin > names exactly the 21 hand-typed aliases, in order: it fails on an extra or a missing key
AssertionError: expected [ …(22) ] to deeply equal [ …(21) ]
+   "by_basis_cash_settlement_returns_series",
 FAIL  |jsdom| src/lib/factsheet/fetch-and-build-payload.test.ts > 194 plan 04 - stored figures and the figure record through fetchAndBuildPayload > the strategies select carries exactly the 21 pinned by-basis aliases: it fails on an extra or a missing key
AssertionError: expected [ …(22) ] to deeply equal [ …(21) ]
+   "by_basis_cash_settlement_returns_series",
 Test Files  2 failed (2)
      Tests  2 failed | 151 passed (153)
```

Restore and byte check:

```
cp <scratchpad>/by-basis-projection.ts.bak src/lib/factsheet/by-basis-projection.ts
=== cmp ===
cmp silent: identical
```

GREEN run:

```
=== GREEN run ===
 Test Files  2 passed (2)
      Tests  153 passed (153)
```

`git status --short src` was clean of the module afterwards (the file equals its committed state). The pin names the extra alias in both the projection test and the builder's select test.

## Verification

- `npx vitest run src/lib/factsheet/by-basis-projection.test.ts src/lib/factsheet/fetch-and-build-payload.test.ts`: 2 files, 153 tests, green.
- `npx vitest run src/lib/factsheet/ src/__tests__/figure-parity-pages.test.tsx src/app/factsheet-share src/app/factsheet`: 3957 passed, 2 failed (`compute.conventions` snapshot, pre-existing, see below), 213 of 214 files green.
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors, 4 pre-existing warnings (none in files this plan touched).
- Task 1 acceptance greps: non-comment `metrics_json_by_basis` in the builder = 0; `rebuildMetricsJsonByBasis` in the builder = 2; old lookahead in the test = 0, new lookahead = 2; alias count in the module = 21; `->>` in the module = 0.
- Final full `npx vitest run` (after all three task commits): `Test Files 5 failed | 1288 passed | 20 skipped (1313)`, `Tests 12 failed | 28226 passed | 306 skipped (28544)`. NONE of the five failing files is caused by this plan; see below. Totals are pasted as measured, not rounded to green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Docblock contained the literal text-arrow token**
- **Found during:** Task 1 acceptance run (`grep -ac -- "->>" by-basis-projection.ts` was 1, expected 0)
- **Issue:** the docblock explained the jsonb-versus-text rule by quoting the token
- **Fix:** reworded to "the text-returning double-arrow operator"
- **Files modified:** `src/lib/factsheet/by-basis-projection.ts`
- **Commit:** `daf52b615` (before the first commit)

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** none on behaviour.

The plan-recorded deviation from RESEARCH and PATTERNS (regex `/metrics_json(?!->|_by_basis->)/` instead of the one that rejects correct aliases) was implemented as written.

## Deferred Issues (out of scope, not fixed)

Five files fail in the final full run; none touches or imports a file this plan changed:

1. `src/lib/factsheet/compute.conventions.test.ts` (2 tests, fixtures B and C): FROZEN snapshot differs in the last digit of `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` versus `0.036844507138638946`). `compute.ts` is untouched by this plan (`git diff be3c2d1a4 HEAD --stat` lists no `compute*` file) and imports nothing from it. A last-ulp floating-point difference on this host, deterministic, reproduced in isolation. Not caused by this plan.
2. `src/lib/return-stats.single-source.test.ts` (whole-tree retirement scan): hit the 5000 ms test timeout under full-suite load; passes (34 of 34) in isolation with `--testTimeout=60000`. Load flake.
3. `src/__tests__/mutation-annotation-parser.test.ts`, `src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx`, `src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx`: failed only in the loaded full runs; all three pass in isolation (5-file isolation run: only items 1 and 2 above fail). Load flakes.

This means the plan's Task 3 criterion "0 failed test files in the full run" is NOT met as measured, for the reasons above (pre-existing ulp snapshot plus load flakes); the plan-caused failures are all fixed. A re-run on an idle CI shard is the arbiter for items 2 and 3; item 1 needs a decision by whoever owns the FROZEN snapshot (it is red regardless of this plan).

## Behaviour notes for the reviewer

- A basis object that the writer wrote with a mapped key ABSENT (not null) would now rebuild with that key present as null, so `hasBasisHeadline`'s `serverKey in rec` check passes where the raw object failed it. The writer always emits all seven (RESEARCH `### Basis object structure (writer)`), so no writer-shaped row differs; this is the same class as the documented all-null divergence and is not separately pinned.
- `metrics_json_by_basis: {}` and `null` both become `undefined`; both previously meant "no basis" to every reader.
- The live check that a real PostgREST accepts the 21 alias paths is the `frontend-live-db-lane` `factsheet-buildable-live-db.test.ts`; it was not run locally.

## Known Stubs

None.

## Threat Flags

None. T-243-08 and T-243-09 are mitigated as planned (exact-set pin, `->` only, parity table, round trip); no new network, auth or schema surface.

## Self-Check: PASSED

- Created files exist: `src/lib/factsheet/by-basis-projection.ts`, `src/lib/factsheet/by-basis-projection.test.ts`, `src/lib/test-helpers/by-basis-alias-row.ts` (verified below).
- Commits `daf52b615`, `7b3383ec5`, `56fa44de9` are ancestors of HEAD; `commits: 3` is measured from the ledger (`rev-list --count be3c2d1a4..HEAD`).
