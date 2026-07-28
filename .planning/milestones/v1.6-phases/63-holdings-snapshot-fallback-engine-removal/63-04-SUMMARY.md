---
phase: 63-holdings-snapshot-fallback-engine-removal
plan: 04
subsystem: allocations/scenario-engine + queries SSR baseline
status: complete
completed: 2026-07-03
tags: [ENGINE-04, GUARD-03, series-space, deletion, re-baseline]
requirements: [ENGINE-04]
dependency_graph:
  requires:
    - "63-03 (composer + compare series-space only; buildAddedOnlySet the added-only path everywhere)"
  provides:
    - "buildStrategyForBuilderSet deleted; the holdings→units builder no longer exists in production or any test"
    - "queries.ts gate=false SSR live-baseline is the honest emptyDefault (emptyLiveBaselineMetrics: AUM preserved from holdings, all metrics null → KpiStrip em-dash); liveBaselineMetricsFromHoldings + the scenario-dealias import retired"
    - "src/lib/scenario-dealias.ts + its whole test deleted via a reviewed re-baseline commit (ADR-001 class) after all three preconditions passed"
    - "no production module builds holdings-engine units or collapses aliases anywhere; every engine unit id is a per-key api_keys UUID or an added strategies UUID (disjoint by construction)"
  affects:
    - "63-05 (ENGINE-05 source-scan guard — the tree is now clean of every banned identifier incl. scenario-dealias, buildStrategyForBuilderSet, collapseAliasedHoldingStrategies)"
tech-stack:
  patterns:
    - "honest gate=false SSR baseline: emptyLiveBaselineMetrics preserves AUM (Σ holdingEquityContribution) and nulls every metric — no holdings-snapshot reconstruction, no fabricated ρ=1.0 (H-0487/H-0493 structurally impossible)"
    - "reviewed re-baseline commit (ADR-001 class): module deletion carries the full rationale + the three recorded precondition results in the message; never a silent deletion"
    - "kept-coverage oracle repoints, never retirements: the per-key blend + C1-regression difference-oracles repointed from a snapshot-reconstruction contrast to an emptyDefault contrast (per-key metrics non-null)"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
    - src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
    - src/app/scenario-share/[token]/share-resolve.ts
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts
    - src/lib/scenario-history.ts
    - src/lib/scenario-history.test.ts
    - src/app/(dashboard)/allocations/lib/drawdown.ts
  deleted:
    - src/lib/scenario-dealias.ts
    - src/lib/scenario-dealias.test.ts
decisions:
  - "emptyLiveBaselineMetrics is a new small exported helper (not an inline mini-collapse) — it holds the single emptyDefault construction (AUM preserved, metrics null) as the SoT and is directly test-pinnable; the ternary's gate=false arm calls it"
  - "ScenarioComposer.save.test.tsx required NO change — its scenario-adapter mock was already made genuine (importOriginal) in Plan 02, so the builder mock key was already gone; the grep-exit-1 acceptance was pre-satisfied"
  - "the AllocationsTabs mock file lives at src/app/(dashboard)/allocations/ (NOT components/__tests__/ as the plan's path hint suggested) — the dead builder mock key was there and was removed plumbing-only"
  - "the :1492 collapse-guard describe was RETIRED and replaced with a direct emptyLiveBaselineMetrics unit pin (belt); the gate=false → emptyDefault SSR-integration pin lives in the repointed fallback-branch test (suspenders) — both halves land"
metrics:
  duration: ~55m
  commits: 3
  tasks_completed: 3
  files_modified: 10
  files_deleted: 2
  wave_gate: 7411 passed / 0 failed / 288 skipped
---

# Phase 63 Plan 04: ENGINE-04 — Adapter Builder + Dealias Retirement + gate=false Baseline Repoint Summary

Completed the ENGINE deletion chain. After this plan **no production module builds
holdings-engine units or collapses aliases anywhere**: the holdings→units builder
(`buildStrategyForBuilderSet`) is gone, the queries.ts gate=false SSR baseline is the
honest `emptyDefault` (AUM preserved, all metrics null), and `scenario-dealias.ts` —
the alias-collapse machinery whose entire reason for existing was to suppress a
fabricated ρ=1.0 for symbol-keyed holdings duplicates — is deleted via a reviewed
re-baseline commit after all three preconditions passed green.

## Tasks

**Task 1 — delete `buildStrategyForBuilderSet` + retire its test blocks (`e6ff597d`):**
Deleted the builder (both call sites gone at Plans 02/03) plus its now-orphaned
`buildHoldingRef` / `HoldingType` / `HoldingRefInput` / `HoldingForDefault` imports and
the unconsumed `ScenarioAdapterInputs` interface (grep-confirmed no production
consumer). `buildAddedUnits` / `buildPerKeyStrategyForBuilderSet` /
`mergeAddedIntoPerKeySet` / `buildAddedOnlySet` survive verbatim. Retired the builder
happy-path + B4-signature suites, the H-0132 commit-oracle round-trip, T16, and PK9
(all invoked the deleted builder); kept H5 brand (T17/M-0149), PK1–PK8, and the Plan-01
`buildAddedOnlySet` / no-alias block byte-identical. Dropped the dead builder mock key
from AllocationsTabs (plumbing-only); doc-only repoints in share-resolve.ts
(weight-0 citation → `buildAddedUnits`; negative-doc de-identified for the ENGINE-05
scan). `scenario-dealias.test.ts` left untouched (tsc-red by design pending Task 3).

**Task 2 — queries.ts gate=false baseline repoint to emptyDefault (`4d08ae1a`):**
The inserted ENGINE-04 stage — retire the THIRD `scenario-dealias` importer. Repointed
the ternary's gate=false branch to a new honest `emptyLiveBaselineMetrics` (AUM from
holdings preserved via `holdingEquityContribution`, all metrics null); deleted
`liveBaselineMetricsFromHoldings` and the `collapseAliasedHoldingStrategies` import in
the same commit. The D3 doc block was **rewritten to the new truth** (gate=false →
emptyDefault, NO snapshot reconstruction). All six `queries.my-allocation.test.ts`
fallout sites dispositioned individually (collapse guard → direct emptyDefault pin;
per-key + C1 difference-oracles → emptyDefault contrast; fallback + partial-coverage →
gate=false emptyDefault SSR pins). `getMyAllocationDashboard.scenario.test.ts` shape-
identity tests repointed onto `emptyLiveBaselineMetrics`. Doc-only rewords in
drawdown.ts (SSR-caller citation → `liveBaselineMetricsFromPerKeyDailies`) and
scenario-history.ts (dropped `scenario-dealias` + `collapseAliasedHoldingStrategies`
comment mentions — unblocked Task 3's precondition-(c) broad grep). Locked stays
confirmed: `holdingsSummary`, `reconstructHoldingReturnsByScopeRef`, the payload field.

**Task 3 — reviewed re-baseline: retire the dealias module (`833a1c64`):**
GATE FIRST — recorded all three preconditions green **before** deleting:
(a) avg-ρ honesty — ScenarioComposer.test.tsx **162/162**; (b) no-alias assertion —
scenario-adapter.test.ts **15/15** (BAO4 count-preserved + unique ids); (c) 0
production importers — BOTH the import-specifier grep and the broad-token grep print
nothing. Then one reviewed re-baseline commit (ADR-001 class) deleting
`scenario-dealias.ts` + `scenario-dealias.test.ts` whole, plus the last doc citation in
`scenario-history.test.ts:10`. The commit message carries the full rationale (what the
collapse fixed, why it is now structurally impossible, the three precondition results).

## Deviations from Plan

### Reviewed dispositions (documented)

- **ScenarioComposer.save.test.tsx NOT modified (plan listed it in `files_modified`):**
  its `scenario-adapter` mock was already made genuine (`importOriginal`, no builder
  key) in Plan 02 (commits `8562be10` / `619cd5f9`). The plan's line references
  (`:100/:111/:703-713`) were stale — the mock plumbing was gone. The grep-exit-1
  acceptance was already satisfied; touching the file would have been a no-op.
- **AllocationsTabs path:** the file is at
  `src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx`,
  not the `components/__tests__/` path in the plan's `files` hint. The dead builder mock
  key was removed there (plumbing-only, oracle bodies untouched).
- **:1492 collapse-guard describe RETIRED and replaced with a direct
  `emptyLiveBaselineMetrics` unit pin** (rather than only retiring). This gives a
  strong direct pin of the new exported helper (aum preserved, four metrics null) AND
  the SSR-integration gate=false→emptyDefault pin lands in the repointed fallback-branch
  test — both halves of the plan's (ii)/(iv) disposition are covered, no coverage lost.

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues surfaced. tsc/lint clean
throughout (the Tasks-1/2 designed `scenario-dealias.test.ts` redness was intentional
and resolved on the Task-3 deletion).

## Verification

- **Touched suites (per task):** Task 1 adapter+save+AllocationsTabs 32/32; Task 2
  queries.my-allocation + getMyAllocationDashboard.scenario 89/89.
- **3-precondition gate (Task 3):** (a) composer 162/162, (b) adapter 15/15,
  (c) both importer greps empty — all recorded green before the delete.
- **Wave gate:** full `npx vitest run --no-file-parallelism` — **7411 passed / 0
  failed / 288 skipped** (623 files passed, 19 skipped).
- **FULL unscoped tsc:** 0 errors (the designed redness resolved with the deletion).
- **Lint:** 0 errors (1 pre-existing frozen-EquityChart hook-dep warning, documented).
- **Tree-wide grep gates:** `buildStrategyForBuilderSet` absent tree-wide (exit 1);
  `scenario-dealias` import-specifier + broad-token greps both empty; `liveBaselineMetricsFromHoldings`
  absent from queries.ts / its test / drawdown.ts / getMyAllocationDashboard.scenario.ts;
  `scenario-dealias` + `collapseAliasedHoldingStrategies` absent from scenario-history.ts.
- **Locked stays (queries.ts):** `holdingsSummary` + `reconstructHoldingReturnsByScopeRef` present.
- **GUARD-03:** `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` empty.
- **P61 verbatim survivors re-run green:** composer P61-BUG-1, compare P61-BUG-2 +
  Atlas golden + MEMBER-02, T_CP8, share route T_SH13/14 (21/21).

## Known Stubs

None. `emptyLiveBaselineMetrics` is not a stub — it is the intended honest gate=false
baseline (AUM preserved, null metrics → KpiStrip em-dash) for the 0-real-user gate=false
population (D1). The `holdingReturnsByScopeRef` payload field is deliberately LEFT
(Open Question 1 — payload contract untouched this phase; noted as future cleanup).

## Future Cleanup (noted, out of scope)

- `reconstructHoldingReturnsByScopeRef` + the `holdingReturnsByScopeRef` payload field
  stay in queries.ts (payload-contract untouched this phase — Open Question 1
  resolution: LEAVE IT). No consumer builds an engine from it anymore.

## Requirements

ENGINE-04 satisfied: the builder deleted, the third importer retired via the honest
emptyDefault repoint, the dealias module gone via a reviewed re-baseline commit with all
three preconditions recorded green. No behavior change for gate=true users; the gate=false
SSR baseline is honest (null metrics, AUM preserved).

## Commits

- `e6ff597d` feat(63-04): delete buildStrategyForBuilderSet; retire its test blocks (ENGINE-04 stage 3)
- `4d08ae1a` feat(63-04): repoint gate=false SSR baseline to emptyDefault; retire liveBaselineMetricsFromHoldings (ENGINE-04)
- `833a1c64` refactor(63-04): re-baseline — retire the scenario-dealias module (ENGINE-04, reviewed act)

## Self-Check: PASSED

- Commit `e6ff597d` (Task 1) reachable: VERIFIED
- Commit `4d08ae1a` (Task 2) reachable: VERIFIED
- Commit `833a1c64` (Task 3 re-baseline) reachable: VERIFIED
- `scenario-adapter.ts` + `queries.ts` exist: VERIFIED
- `scenario-dealias.ts` + `scenario-dealias.test.ts` ABSENT (as required): VERIFIED
- `emptyLiveBaselineMetrics` exported from queries.ts: VERIFIED
- Wave gate 7411 passed / 0 failed; full tsc 0 errors; lint 0 errors; GUARD-03 zero-diff: VERIFIED
