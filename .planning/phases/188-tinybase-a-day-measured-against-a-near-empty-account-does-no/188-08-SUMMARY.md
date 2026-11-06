---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 08
subsystem: frontend-dashboard
tags: [tiny-base, my-allocation, key-inputs, fail-closed, muted-note, d-02, d-06, sc-2, sc-5]
requires: ["188-06", "188-07"]
provides:
  - "readMarksStart returns tinyBaseDays: the distinct ascending union of the drawn keys' stored tiny_base_days"
  - "MyAllocationDashboardPayload.tinyBaseDays?: string[] (present only when non-empty, on both return branches)"
  - "AllocationDashboardV2 prop tinyBaseDays (default []) passed to the allocator payload builder"
  - "buildAllocatorPortfolioFactsheetPayload meta tinyBaseDays -> payload.dataQuality.tinyBaseDays"
affects: ["188-09", "188-10"]
tech-stack:
  added: []
  patterns: ["the 185 optionsCashBasis plumbing path (same read, payload field, prop, builder spread)", "per-key-id collection before the union", "strict readTinyBaseDays at the reader and again in the builder"]
key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tiny-base.test.tsx
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/factsheet/allocator-portfolio-payload.ts
    - src/lib/factsheet/allocator-portfolio-payload.test.ts
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
key-decisions:
  - "D-06 built as decided: the book gets plan 07's muted note naming the days, not a chart gap. This plan only carries the validated day list; no FactsheetView.tsx or types.ts change."
  - "Fail CLOSED (SC-5), the reverse of optionsCashBasis: a failed read, a malformed list, and a departed key outside the known-drawn curve name no day."
  - "The day lists are collected in a Map keyed by key id inside readMarksStart before the union, so plan 09 can return them per key without reworking the read."
requirements-completed: [SC-2, SC-5]
status: complete
commits: 4
plan_head_before: d807f22d31bbd0339e48123b807d3d232e60c66a
plan_head_after: fc299486e915a549174d6d36f30ce73b5a691291
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-04
---

# Phase 188 Plan 08: My Allocation names the days a drawn key was left out as a nearly empty account

**`readMarksStart` now reads `tiny_base_days` off the same owner-RLS `key_inputs` read, and the distinct ascending union rides the existing `optionsCashBasis` path (payload field, prop, builder spread) to `dataQuality.tinyBaseDays`, so plan 07's muted note appears on the founder's book naming key C's days; it names nothing when it cannot be sure.**

## What was built

- `src/lib/queries.ts`: one import line after `./options-cash-basis-flag`; `readMarksStart` returns a fourth field `tinyBaseDays: string[]`. Inside the existing row loop it keeps `readTinyBaseDays(payload?.[TINY_BASE_DAYS_FLAG])` in a `Map` keyed by key id when non-empty; after the loop the days of every key that passes the same `failsClosed` departed rule `marks_since` uses are unioned, de-duplicated and sorted ascending. The error branch and the empty-key branch return `[]`. Doc comment extended in its voice (188 D-02, D-06, why fail closed differs from `optionsCashBasis`). `MyAllocationDashboardPayload.tinyBaseDays?: string[]` with a one-line doc comment; destructured at the call site; `...(tinyBaseDays.length > 0 ? { tinyBaseDays } : {})` on BOTH return branches beside `optionsCashBasis`.
- `src/lib/factsheet/allocator-portfolio-payload.ts`: meta `tinyBaseDays?: unknown` (doc comment in `optionsCashBasis`'s voice), parsed by `readTinyBaseDays`, accepted only when non-empty, part of the early-return condition, spread into `dataQuality` beside `optionsCashBasis` (a book with only days gets `{ composite: false, tinyBaseDays }`; one with both keeps both).
- `AllocationDashboardV2.tsx`: prop default `tinyBaseDays = []` after `optionsCashBasis = false,`, passed in the builder meta and added to the `useMemo` dependency list. The prop reaches the component because `AllocationsTabs` spreads the whole dashboard payload (`<AllocationDashboardV2 {...props} />`).

## TDD record

### Task 1 (the reader)

- RED (commit ea49c5fd8), `/tmp/tinybase-08/red1.log`: 8 failed, 3 passed, 198 skipped by the `-t tinyBaseDays` filter. All 8 failed on `expected undefined to deeply equal [...]` (the missing payload field). The 3 that pass before the change are the absent-by-construction arms (another owner's row, no row carries the field, the empty list). Semantic assessment: the target arms executed and failed on the planned assertion.
- GREEN (commit 0a2f672c5): `src/lib/queries.my-allocation.test.ts` 209 passed.
- Neuter drills against byte backup `/tmp/tinybase-08/queries.bak`, each restored with `cp` and `cmp` clean:
  - list taken raw when it is an array instead of through `readTinyBaseDays` (`neuter1.log`): 2 failed (the impossible-date arm and the good-plus-impossible-date arm), 207 passed.
  - the departed-key `failsClosed` skip removed (`neuter1b.log`): 1 failed (the departed arm), 208 passed.
- Counts of `from("allocator_equity_derived")` in `queries.ts`: before 2, after 2 (equal: no new query). `keyInputsReads()` in the new arm asserts exactly one `key_inputs` read.
- Acceptance: `grep -ac 'readTinyBaseDays(payload?.\[TINY_BASE_DAYS_FLAG\])' src/lib/queries.ts` prints 1 (baseline 0).

### Task 2 (builder and prop)

- RED (commit e7cd7809f), `/tmp/tinybase-08/red2.log`: 5 failed, 41 passed across the two files (three builder arms: valid list, all-three-at-once, days alone; two dashboard arms: the list reaching the meta, absent reading `[]`). The malformed-list, absent and rebuilding arms pass before the change by construction.
- GREEN (commit fc299486e): the five listed vitest files, 274 passed. One builder arm was corrected in the same commit: the base build carries `dataQuality: undefined` as an own key, so the "days alone" arm now compares both sides with that key destructured away (a test bug of mine, not a behaviour change).
- Neuter drills (restored with `cp` and `cmp` clean each time):
  - spread dropped from the builder, `/tmp/tinybase-08/neuter2.log`: 4 failed, 42 passed.
  - validation removed (raw array accepted), `neuter2b.log`: 3 failed, 40 passed (the malformed arms).
  - dashboard stops passing `tinyBaseDays` to the builder, `neuter2c.log`: 2 failed, 1 passed.
- Acceptance: `grep -ac 'tinyBaseDays' allocator-portfolio-payload.ts` prints 6, `grep -ac 'tinyBaseDays = \[\]' AllocationDashboardV2.tsx` prints 1 (baselines 0 each). `git diff --stat <plan base> HEAD -- FactsheetView.tsx types.ts` prints nothing.

## Fail-closed rules as built (SC-5)

1. A failed `key_inputs` read: `tinyBaseDays` is `[]`, so the payload has no key; the existing warn and Sentry capture fire exactly once (asserted), and `optionsCashBasis` keeps its own fail-open value (asserted with a drawn Deribit key).
2. A key whose list is not a wholly valid list of real days (bare string, impossible date, good day plus impossible date, number, null) contributes no day; the other key's days still appear.
3. A departed key's days count only when the curve is not known to have left departed accounts out: with `departedHistoryUnavailable` true, a departed key in `marksKeys.departedIncluded` contributes none (live keys still do).
4. Another owner's row never contributes (the existing `.eq("allocator_id", userId)` filter, T-188-14, asserted with a `user-2` row).
5. The payload and the book carry the field only when non-empty, so a book without tiny days keeps the payload (and absent `dataQuality`) it had.

## Gates

- `npx tsc --noEmit`: exit 0, no `error TS`.
- `npx eslint` on the six changed src files: exit 0, no output.
- `npm run lint`: exit 0 (2 warnings, both pre-existing: `isRankableAnalyticsRow` unused import in `composite-read-path.ts:12` and `nativeUnitReason` in `MetricsColumn.tsx`), then the admin-route, route-contract, planning-hygiene and canonical-domain checks OK.
- Targeted vitest (`allocator-portfolio-payload`, `AllocationDashboardV2.tiny-base`, `AllocationDashboardV2.options-caveat`, `AllocationDashboardV2.unpriced-account`, `queries.my-allocation`): 5 files, 274 tests passed.
- Full `npx vitest run`: 1208 files, 1186 passed, 2 failed, 20 skipped; 23738 tests, 23426 passed, 3 failed, 309 skipped. Failures:
  - `src/lib/factsheet/compute.conventions.test.ts` fixtures B ("zero-return days") and C ("interior calendar gaps"): KNOWN PRE-EXISTING frozen inline snapshots (fail identically at earlier fork points and in the main checkout); file not touched.
  - `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` R4 ("scripts/ci-apt.sh --self-test exits 0"): hit its 55 s spawn timeout (SIGKILL, status null) while the whole suite ran in parallel. It is unrelated to this plan (a shell self-test; no file of this plan is read by it) and PASSES when run alone (1 file, 68 tests passed). Recorded as load-induced flake, not fixed.

## DESIGN.md

This plan adds no UI element and no copy: the note, its classes, its wording and its day format are plan 07's (`FactsheetView.tsx`, untouched here; 188-07-SUMMARY holds the agreement record). This plan only supplies the day list that note reads on the book. No DESIGN.md conflict.

## Mergeability with Phase 186

Edits stay in the hunks the plan names: `readMarksStart`, its destructuring and both return branches, the payload field next to `optionsCashBasis?`, one import line after the `./options-cash-basis-flag` import; nothing inside `derivePhase07Fields` and no `unpricedNativeAccounts` line. `AllocationDashboardV2.tsx`: `tinyBaseDays = []` after `optionsCashBasis = false,` and two entries inside the `factsheetPayload` `useMemo`. Test files differ from 186's. Files changed, all in the plan's list: `queries.ts`, `queries.my-allocation.test.ts`, `allocator-portfolio-payload.ts`, `allocator-portfolio-payload.test.ts`, `AllocationDashboardV2.tsx`, `AllocationDashboardV2.tiny-base.test.tsx`.

## Deviations from Plan

None - plan executed exactly as written. No existing test newly failed from this change; the STOP rule did not fire. (One new test arm of this plan was corrected inside its GREEN commit, noted above; it is not an existing test.)

## Recorded consequences and carried limits

- D-06 as built: note only. The My Allocation book gets plan 07's muted note naming the days; the chart line is unchanged.
- D-06 consequence (T-188-13, accepted in plan 07): the note carries dates and the fixed threshold only, never a balance or an amount; this plan carries ISO days only.
- Carried to plan 09: the per-key lists are held in a `Map` keyed by key id in `readMarksStart` before the union, as that plan needs; this plan's list, note and payload field do not change for it. The live-book scenario readers (D-07) remain plans 09 and 10.
- No migration, no Python, no PROD/TEST access, no service-role client, no new query.

## Known Stubs

None.

## Threat Flags

None. The existing owner-RLS read and its explicit allocator filter are unchanged (T-188-14); strict parsing at the reader and again in the builder covers T-188-15.

## Self-Check: PASSED

- Files present: `AllocationDashboardV2.tiny-base.test.tsx`, `queries.ts`, `allocator-portfolio-payload.ts`, `AllocationDashboardV2.tsx` and the three other changed files.
- Commits ea49c5fd8, 0a2f672c5, e7cd7809f, fc299486e are ancestors of HEAD on `wt/188-p08`; `git rev-list --count d807f22d3..HEAD` is 4.
- `from("allocator_equity_derived")` count in `queries.ts` equal before and after (2 and 2); `PLAN_BASE`-to-HEAD diff of `FactsheetView.tsx` and `types.ts` is empty.
- STATE.md and ROADMAP.md untouched.
