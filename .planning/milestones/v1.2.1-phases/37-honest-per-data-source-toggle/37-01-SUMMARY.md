---
phase: 37-honest-per-data-source-toggle
plan: 01
subsystem: allocations / dashboard payload (SSR)
tags: [scenario, per-key-dailies, payload, allocations, dsrc-01]
requirements: [DSRC-01]
dependency_graph:
  requires:
    - "Phase 36 per-key helpers (buildPerKeyReturnsByApiKeyId, allActiveKeysHavePerKeyDailies, isPerKeyDailiesEligibleKey) — queries.ts:2362-2427"
    - "Phase 36 getMyAllocationDashboard per-key consts (perKeyReturnsByApiKeyId, eligibleKeyIds, the D3 gate) — queries.ts:3075-3098"
  provides:
    - "MyAllocationDashboardPayload.perKeyReturnsByApiKeyId (per-api_key DailyPoint[] series, allocator-scoped)"
    - "MyAllocationDashboardPayload.perKeyDailiesGateSatisfied (Phase-36 D3 all-or-nothing gate result)"
    - "MyAllocationDashboardPayload.eligibleApiKeyIds (eligible active-key id list)"
  affects:
    - "Plan 37-02 / 37-03 (the composer per-key toggle consumes these three fields to recompute the blend client-side)"
    - "Every existing payload-literal test fixture (5 files backfilled with empty/false defaults)"
tech_stack:
  added: []
  patterns:
    - "Additive payload field (mirror liveBaselineMetrics) — never repoint a Phase-36-pinned field"
    - "Hoist an inline gate call to a named const so the single call both selects AND rides the payload"
key_files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts
    - src/lib/queries.my-allocation.test.ts
    - "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
decisions:
  - "Hoisted the inline D3 gate (queries.ts:3090) to a named const perKeyDailiesGateSatisfied so the SAME single allActiveKeysHavePerKeyDailies call both selects the liveBaselineMetrics source AND rides both return objects — no second gate call, no behavior change."
  - "The !portfolio branch returns the SAME real values (perKeyReturnsByApiKeyId/eligibleKeyIds/gate) as the main branch, not synthetic empties — all three consts are computed BEFORE the if (!portfolio) split. Fresh allocators naturally get {}/false/[] because they have no per-key coverage."
  - "Backfilled empty/false defaults into 5 pre-existing payload-literal test fixtures (Rule 3 — the augmented required-field type otherwise fails tsc). Diff is additive only; no existing assertion weakened."
metrics:
  duration: "~10 min"
  completed: "2026-06-25"
  tasks: 2
  files_changed: 8
  commits: 2
---

# Phase 37 Plan 01: Expose the per-key channel on the dashboard payload Summary

Three additive fields (`perKeyReturnsByApiKeyId`, `perKeyDailiesGateSatisfied`,
`eligibleApiKeyIds`) now ride `MyAllocationDashboardPayload` on BOTH return
branches, exposing Phase 36's already-computed per-`api_key` daily-return series
to the client so Plans 02/03's composer can recompute the blend on a
data-source toggle — with `liveBaselineMetrics` / `holdingReturnsByScopeRef`
left byte-identical and the cross-tenant subset invariant pinned by test.

## What Was Built

**Task 1 — `src/lib/queries.ts` (feat, `6c643a7c`):**
- Added three fields to `MyAllocationDashboardPayload` (after `liveBaselineMetrics`,
  mirroring its additive-field JSDoc style):
  - `perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>`
  - `perKeyDailiesGateSatisfied: boolean`
  - `eligibleApiKeyIds: string[]`
- Hoisted the inline D3 gate (`allActiveKeysHavePerKeyDailies(...)` previously
  called inside the baseline-selection ternary at :3090) into a named const
  `perKeyDailiesGateSatisfied`, then used that const in the ternary. The
  `liveBaselineMetrics` source selection is unchanged — same single gate call.
- Added the three identical field lines to BOTH return objects (the `!portfolio`
  branch and the main branch): `perKeyReturnsByApiKeyId,`
  `perKeyDailiesGateSatisfied,` `eligibleApiKeyIds: eligibleKeyIds,`.
- Did NOT touch the `liveBaselineMetrics` / `holdingReturnsByScopeRef`
  derivation (Phase 36 byte-identity pin). No new fetch / query / eligibility
  re-derivation.

**Task 2 — payload-shape + invariant pins (test, `99430d8d`):**
- `getMyAllocationDashboard.scenario.test.ts`: a `T_M5` compile-time shape guard
  (a `Pick<MyAllocationDashboardPayload, ...>` literal must carry all three new
  fields — deleting any one fails `tsc`); a runtime pin that exposing the channel
  leaves the per-key `liveBaselineMetrics` derivation a pure, deterministic
  function of `(holdings, perKeyReturnsByApiKeyId)`.
- `queries.my-allocation.test.ts`: a populated per-key fixture (reusing
  `activeKeyA` / `seedHoldingsKeyA` / `seedSnapshotsBTC` / `seedPerKeyDailiesA`)
  asserting `perKeyDailiesGateSatisfied === true`, `eligibleApiKeyIds` contains
  `key-A`, and `perKeyReturnsByApiKeyId["key-A"]` is byte-identical to the seeded
  series; a byte-identity guard (`liveBaselineMetrics` equals the per-key blend +
  `holdingReturnsByScopeRef` unchanged + disjoint key spaces); a cross-tenant
  subset guard (keys ⊆ `apiKeys[].id`, a seeded foreign-tenant `key-FOREIGN`
  series never leaks through the allocator-scoped read — threat T-37-01-01); a
  `!portfolio`-branch empty/false-default pin.

## Verification

- `npx vitest run src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts src/lib/queries.my-allocation.test.ts` → **2 files, 85 tests passed** (up from 79).
- `npx tsc --noEmit` → **0 errors** (both return branches satisfy the augmented type; 5 fixtures backfilled).
- Acceptance greps: `grep -n perKeyDailiesGateSatisfied` shows the hoisted const + both returns; `grep -c "eligibleApiKeyIds: eligibleKeyIds"` returns **2**.
- The five touched `AllocationsTabs`/`ScenarioComposer` fixtures → **5 files, 147 tests passed**.
- **Mutation-verified falsifiable:** replacing the exercised (`!portfolio`) branch's real field values with empty/false defaults turns the populated test red (`expected false to be true`).
- `git diff` of `queries.ts` touches the pinned-derivation names ONLY via the gate-hoist reindent (same functions, same arguments) + comments — the `liveBaselineMetricsFrom*` calls and their arguments are byte-identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking compile] Backfilled the three new required fields into 5 pre-existing payload-literal test fixtures**
- **Found during:** Task 1 (`tsc --noEmit` after augmenting the payload type)
- **Issue:** Making the three fields required on `MyAllocationDashboardPayload`
  caused 5 test files that construct `MyAllocationDashboardPayload` literals /
  `makePayload`/`basePayload` builders to fail compilation (missing required
  properties — exactly Pitfall 2's "no branch leaves a required field unset",
  applied to fixtures).
- **Fix:** Added `perKeyReturnsByApiKeyId: {}`, `perKeyDailiesGateSatisfied: false`,
  `eligibleApiKeyIds: []` (the no-per-key-coverage defaults) to each fixture.
  Additive only; no existing assertion weakened.
- **Files modified:** `AllocationsTabs.test.tsx`,
  `AllocationsTabs.onboarding.test.tsx`,
  `AllocationsTabs.scenario-composer.test.tsx`,
  `AllocationsTabs.scenario-state-preservation.test.tsx`,
  `components/ScenarioComposer.test.tsx`
- **Commit:** `6c643a7c` (bundled with the Task-1 source change that caused them)

No other deviations — the plan executed as written. No authentication gates occurred.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`.
T-37-01-01 (Information Disclosure on the new fields) is **mitigated and pinned**:
the cross-tenant subset test asserts `perKeyReturnsByApiKeyId` keys ⊆
`apiKeys[].id` and that a seeded foreign-tenant key never appears on the wire
(the existing `.eq("allocator_id", userId)` read filters it out). The fields
carry only `api_key_id` + `(date, daily_return)` — no secret/cipher material.

## Known Stubs

None. The three new payload fields carry real, already-computed values on both
branches (the `!portfolio` branch's `{}`/`false`/`[]` is the correct
no-per-key-coverage state for a fresh allocator, not a stub). The composer-side
wiring that consumes these fields is the explicit scope of Plans 37-02 / 37-03.

## Self-Check: PASSED

- FOUND: `.planning/phases/37-honest-per-data-source-toggle/37-01-SUMMARY.md`
- FOUND: `src/lib/queries.ts`
- FOUND: `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts`
- FOUND: `src/lib/queries.my-allocation.test.ts`
- FOUND commit: `6c643a7c` (Task 1, feat)
- FOUND commit: `99430d8d` (Task 2, test)
