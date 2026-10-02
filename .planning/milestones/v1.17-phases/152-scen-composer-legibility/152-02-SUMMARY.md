---
phase: 152-scen-composer-legibility
plan: 02
subsystem: ui
tags: [typescript, zod, vitest, scenario-composer, draft-codec, ownership]

# Dependency graph
requires:
  - phase: 151-06
    provides: "manualAumUsd — the optional/additive/nullish/no-refine draft-field precedent this plan mirrors one level deeper (nested schema)"
  - phase: 90.5-03
    provides: "leverageOverrides — the original ⚠️ LOAD-BEARING strip-point comment discipline"
provides:
  - "AddedStrategy.isOwn?: boolean | null — the persisted ownership bit on an added strategy"
  - "isOwn: z.boolean().nullish() on the NESTED addedStrategySchema — the declaration that keeps the bit alive through every codec decode and both save-route POSTs"
  - "describe(\"SCEN-02 isOwn (Phase 152)\") — the populated-fixture strip guard, backward decode, null tolerance, version discipline"
affects: [152-04 browse-drawer handleAdd passes isOwn, 152-05 composer twin seams map isOwn onto added rows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A NESTED-field strip guard is only non-vacuous over a POPULATED array — the sibling top-level fixture (addedStrategies: []) parses green whether or not the nested field is declared, so a copy-paste can never go RED"
    - "A null-tolerance test must assert the VALUE survives (`toBeNull()`), not just `outcome === \"ok\"` — an undeclared key is silently stripped and still decodes ok, so an outcome-only assertion is green before AND after the fix"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/scenario-state.ts
    - src/app/(dashboard)/allocations/lib/scenario-state.test.ts
    - .planning/phases/152-scen-composer-legibility/152-VALIDATION.md

key-decisions:
  - "The zod entry is `z.boolean().nullish()`, not `.optional()`, and carries NO refine. `scenarioDraftSchema` is safeParsed on EVERY codec decode branch, so a rejection is not a validation error — it routes to the schema_invalid RESET that hands back defaultDraft and deletes the user's whole saved scenario. `JSON.stringify` writes `null` for values it cannot represent, so a bare `z.boolean()` would turn one persisted null into total draft loss."
  - "The field is declared on the NESTED `addedStrategySchema`, not on `scenarioDraftSchema`'s own key list. The strip point for a per-strategy bit is the inner `z.object`; declaring it at the top level would leave the inner object still stripping it."
  - "Test 2 (null tolerance) asserts `r.value.addedStrategies[0].isOwn` is null rather than only `outcome === \"ok\"`. With the field undeclared, zod strips the key and the blob STILL decodes ok — an outcome-only assertion would have been green before the fix and proven nothing. Measured: the value assertion is what made it RED."
  - "No mutator change. `addStrategyBrowse` / `addStrategyBridge` push the whole strategy object, so the field rides along once the type and schema admit it."

metrics:
  duration: ~9 minutes
  completed: 2026-08-07
  tasks: 2
  files-changed: 3
---

# Phase 152 Plan 02: SCEN-02 Draft-Side Ownership Wire Summary

`isOwn` is now declared on both `interface AddedStrategy` and the nested
`addedStrategySchema` as `z.boolean().nullish()`, so the browse-computed
ownership bit survives every localStorage codec round-trip and both save-route
POSTs instead of being silently stripped by `z.object` — proven by a strip guard
built on a POPULATED `addedStrategies` fixture.

## What Was Built

**Task 1 (RED) — `test(152-02)` `cc906971`**

New `describe("SCEN-02 isOwn (Phase 152)")` in `scenario-state.test.ts`, placed
after the 151-06 AUM-01 block and mirroring its structure, with a local
`v4DraftWithAdded()` fixture whose `addedStrategies` holds one real entry
(`STRAT_A`) and whose `memberKeyIds: []` satisfies `scenarioDraftSaveSchema`'s
`schema_version >= 4` superRefine. The fixture carries a comment naming exactly
why it differs from `v4Draft()` at :1059 — an assertion about
`addedStrategies[0]` over an empty array is vacuous and can never go RED.

Four tests:
1. **Backward decode** — a v4 blob whose `addedStrategies[0]` has no `isOwn` key
   decodes `"ok"`; the added strategy and `weightOverrides` are preserved.
2. **Null tolerance** — `isOwn: null` decodes `"ok"` AND survives as `null`.
3. **Strip guard** — a full literal `{ id, name, markets, strategy_types, isOwn: true }`
   safeParses through `scenarioDraftSchema` AND `scenarioDraftSaveSchema` with
   `parsed.data.addedStrategies[0].isOwn === true` in both.
4. **Version discipline** — `SCENARIO_SCHEMA_VERSION` is still 4.

Observed RED for the right reason: tests 2 and 3 failed with `undefined`
(the undeclared nested key stripped by `z.object`), 89 pre-existing tests green.

**Task 2 (GREEN) — `feat(152-02)` `bfacc483`**

- `interface AddedStrategy` gains `isOwn?: boolean | null` with a TSDoc naming
  Phase 152 SCEN-02, the `GET /api/strategies/browse` provenance, and the
  CONTEXT lock: absent/null means UNKNOWN → NO chip, never fabricated ownership.
- `addedStrategySchema` gains `isOwn: z.boolean().nullish()` with a comment
  mirroring the `leverageOverrides` / `manualAumUsd` discipline: `z.object`
  STRIPS unknown keys and `saved/route.ts` persists `parsed.data.draft`, so
  without the declaration the bit is dropped on every round-trip and every save
  POST; `.nullish()` because a bare `z.boolean()` rejects the `null` that
  `JSON.stringify` writes, and rejection on this shared schema means the
  draft-deleting reset; deliberately no refine.
- Nothing else touched: no mutator change, no `SCENARIO_SCHEMA_VERSION` bump
  (still exactly one `= 4`), no new codec branch, and the diff adds no
  `.refine` / `.min(` / `.max(` anywhere.

**Ledger — `docs(152-02)` `354525b3`**

SC1 falsifier observed and recorded in `152-VALIDATION.md`.

## Verification

| Check | Result |
|-------|--------|
| `vitest run scenario-state.test.ts --no-file-parallelism` | 91/91 pass |
| `vitest run scenario-state.localStorage.test.ts --no-file-parallelism` | 15/15 pass (untouched, still green) |
| Both suites together | 106/106 pass |
| `tsc --noEmit` (whole project) | clean |
| `eslint` on both touched files | clean |
| `grep -c "SCENARIO_SCHEMA_VERSION = 4"` | 1 (unchanged — no bump) |
| `isOwn: z.boolean().nullish()` line | :875, inside the `addedStrategySchema` object literal |

**SC1 falsifier (production-source mutation):** deleted the
`isOwn: z.boolean().nullish()` line from `addedStrategySchema` with the TS
interface left intact →
`vitest run scenario-state.test.ts -t "isOwn"` reported **2 failed | 2 passed**
(strip guard and null tolerance RED, both with `undefined`); restored the line
from a scratchpad snapshot → **4 passed**, working tree byte-identical to HEAD.
Recorded as "Observed ✅ RED then GREEN (2026-08-07)" in the 152-VALIDATION.md
Falsifiability Ledger SC1 row.

## Deviations from Plan

None — plan executed exactly as written. The one judgement call inside the
plan's latitude is documented above as a key decision: Test 2 asserts the null
VALUE survives rather than only the decode outcome, because an outcome-only
null-tolerance test is green both before and after the implementation (an
undeclared key is stripped, not rejected) and would have been a second vacuity
trap alongside the empty-array one the plan already names.

## Authentication Gates

None.

## Known Stubs

None. `isOwn` is declared and persisted end-to-end on the draft side; the
producers (152-04 browse drawer `handleAdd`) and the consumers (152-05 composer
twin seams, the chip) are the explicit scope of later plans in this phase, per
the plan's `affects` graph — not stubs left behind by this one.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — FOUND
- `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` — FOUND
- `.planning/phases/152-scen-composer-legibility/152-VALIDATION.md` — FOUND
- commit `cc906971` — FOUND
- commit `bfacc483` — FOUND
- commit `354525b3` — FOUND
