---
phase: 66-carry-forward-burn-down
plan: 03
subsystem: allocation-dashboard-ssr
tags: [scenario, ssr-payload, dead-code-burndown, coverage-neutral, carry-forward]
requires:
  - "plan 66-01 (ScenarioComposer.save.test.tsx over-cap test — rebased on)"
provides:
  - "MyAllocationDashboardPayload with no holdingReturnsByScopeRef field — the dead per-request SSR reconstruction is gone"
  - "queries.ts SSR producer no longer computes reconstructHoldingReturnsByScopeRef"
affects:
  - src/lib/queries.ts
tech-stack:
  added: []
  patterns:
    - "remove dead code AND its dedicated tests together (coverage-neutral deletion)"
key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/queries.audit-2026-05-07.test.ts
    - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
decisions:
  - "CF-04: DELETE the dead holdingReturnsByScopeRef pipeline end-to-end (no deprecation flag, per D)"
  - "CF-04: the holdingsSummary half of the ROADMAP criterion is a MISCLASSIFICATION — already-satisfied by v1.6 phase 63 (RISK-1, resolution option (a)); holdingsSummary is LIVE and untouched"
  - "Deviation: also swept queries.audit-2026-05-07.test.ts (outside the plan's 10-file list) — it imported+called the deleted fn; leaving it would break tsc and fail the case-insensitive acceptance grep"
metrics:
  duration: ~22m
  tasks: 2
  files: 11
  completed: 2026-07-04
requirements: [CF-04]
---

# Phase 66 Plan 03: Carry-Forward Burn-Down (CF-04) Summary

Removed the dead `holdingReturnsByScopeRef` SSR pipeline end-to-end in one atomic
change — the producer function, its input types, the payload TYPE field, the call
site, both payload-construction lines, and every prose comment that named it — with
the full vitest suite + coverage ratchet as the gate. The live `holdingsSummary`
surface was left byte-untouched per the RISK-1 scope correction, and the
`holdingsSummary` half of the ROADMAP criterion is recorded as a misclassification
already satisfied by the v1.6 phase-63 engine-input removal.

## What Was Built

### Task 1 — CF-04: delete `holdingReturnsByScopeRef` + sweep every test reference (commit b9b69c7b)

**Production (`src/lib/queries.ts`), dead-field only:**
- Deleted the `reconstructHoldingReturnsByScopeRef` function (the per-request
  breakdown→daily-return reconstruction) plus its `ReconstructEquitySnapshot` /
  `ReconstructHoldingRow` input types and the shared JSDoc — those types existed
  solely to type this one function's inputs (grep-confirmed no other consumer).
- Deleted the payload TYPE field `holdingReturnsByScopeRef: Record<string, DailyPoint[]>`
  and its "NO PRODUCTION CONSUMER (as of v1.6 phase 63)" doc block.
- Deleted the call site (`const holdingReturnsByScopeRef = reconstruct...(...)`) and
  both payload-construction lines (the `!portfolio` branch and the main return).
- Reworded three prose comments that named the removed symbol
  (`buildHoldingRef`-list at the dedup map, the equity-snapshot filter downstream
  note, and the Phase-36 liveBaselineMetrics block) so no comment references it.
- `holdingScopeKey` stays alive (still used by the live `holdingsMap` dedup at
  `derivePhase07Fields`) — import untouched.

**Tests (one atomic sweep — typed stubs make any partial deletion fail tsc):**
- Mechanical fixture-stub removals: `AllocationsTabs.test.tsx`,
  `AllocationsTabs.onboarding.test.tsx`,
  `AllocationsTabs.scenario-state-preservation.test.tsx`,
  `ScenarioComposer.test.tsx` (7 single-line `{}` stubs via replace-all + 2
  multi-line fixture blocks), `ScenarioComposer.save.test.tsx`,
  `ScenarioComparePanel.test.tsx` (fixture stub + one prose-comment reword).
- **RETIRED** `AllocationsTabs.scenario-composer.test.tsx` T_AT3 (it asserted the
  composer received the dead field via a `data-has-returns` mock attribute — a pin
  on removed code, not a regression), and dropped that mock attribute + the
  `holdingReturnsByScopeRef` type on the mock's `payload` and the `STUB_PROPS`
  fixture field. Cleaned up the now-orphaned `REF_BTC_OKX` const in
  `ScenarioComposer.test.tsx` (my own mess from removing the block that used it).
- **REPOINTED** `queries.my-allocation.test.ts:2117` (the Phase-37 byte-identity
  test): dropped the `holdingReturnsByScopeRef` key-space / disjoint-channel
  assertions, **KEPT** the `liveBaselineMetrics` byte-identity assertion (the axis
  that still matters).
- **RETIRED** the `:301` scope_ref type-smoke in
  `getMyAllocationDashboard.scenario.test.ts` and the whole
  `describe("reconstructHoldingReturnsByScopeRef")` block + the `NEW-C03-02`
  describe block (both exercised the deleted fn directly). **PRESERVED** the
  T_H3 / T_M4 / T_M5 payload-type smokes (they guard surviving fields —
  `allocator_id`, `liveBaselineMetrics`, the per-key channel — not the deleted fn)
  by relocating them into a dedicated `MyAllocationDashboardPayload — type smokes`
  describe. Removed the now-unused `Holding` / `Snapshot` local types and reworded
  the file header docstring.

### Task 2 — CF-04 closure: full-suite + coverage gate, RISK-1 verdict (this SUMMARY)

Full suite + coverage ran green (see Verification). No code change beyond Task 1 —
the removal is coverage-neutral because tested code and its dedicated tests were
removed together.

## RISK-1 Verdict — the `holdingsSummary` half is already-satisfied (v1.6 phase 63)

The ROADMAP CF-04 criterion nominally paired two SSR removals: `holdingReturnsByScopeRef`
AND `holdingsSummary`. Per research RISK-1, the second pairing is a **misclassification**:

- `holdingsSummary` is **LIVE display data**, not dead weight. It feeds the Holdings
  tab, the mandate AUM gates, composer seeding, and the drift reference; its producer
  (`derivePhase07Fields` / the `holdingsMap` dedup), `holdingEquityContribution`,
  and `emptyLiveBaselineMetrics(holdingsSummary)` are all active. TODOS.md even
  tracks a live P2 symbol-dedup bug in it. Removing it would break the dashboard.
- The removal that was actually *intended* — dropping `holdingsSummary` as a
  scenario-**ENGINE input** (the holdings-snapshot baseline reconstruction that
  re-poisoned avgRho with fabricated ρ=1.0 from symbol-alias duplicates) — **already
  shipped in v1.6 phase 63** (ENGINE-04: the honest `emptyLiveBaselineMetrics`
  gate=false baseline replaced the retired holdings-snapshot reconstruction).
- **Resolution: option (a) already-satisfied.** Scope corrected per RISK-1;
  `holdingsSummary` is deliberately NOT touched. The plan's "no consumer breaks /
  full suite green" success gate passes *precisely because* holdingsSummary was left
  intact — a green suite with holdingsSummary untouched is the proof.

## Verification

- **Acceptance grep (case-insensitive):** `grep -rni "holdingReturnsByScopeRef" src/`
  → **nothing** (exit 1). Catches the capital-H `reconstructHoldingReturnsByScopeRef`
  fn + all prose refs; production AND test references all gone.
- **holdingsSummary safety:** `git diff src/lib/queries.ts | grep "^[-+].*holdingsSummary"`
  shows only **5 deletion** lines, ALL inside the deleted dead pipeline (the
  reconstruct fn's `holdingsSummary` parameter, the `ReconstructHoldingRow` Pick,
  the loop var, the JSDoc discriminator note, and the `phase07.holdingsSummary`
  call argument). **Zero additions**, and no live `holdingsSummary`
  producer/consumer line changed — the grep's hits are the expected artifact of
  deleting a dead function that *accepted* holdingsSummary as an input. RISK-1
  honored.
- **tsc:** `npx tsc --noEmit` → exit 0 (proves no surviving consumer read the field).
- **Targeted vitest** (`--no-file-parallelism`): the 4 plan-named suites + the swept
  audit file → 130 passed; the other 6 touched files → 239 passed.
- **Full suite + coverage** (`npm run test:coverage`): exit 0 —
  **624 test files passed | 19 skipped; 7442 tests passed | 288 skipped**. All four
  ratchet thresholds hold: **Lines 85.48% (≥82), Statements 83.34% (≥80),
  Functions 79.91% (≥74), Branches 76.32% (≥72)**. Functions/branches (the
  closest-to-floor ratchets) held — the deletion was coverage-neutral.
- **Lint:** `npm run lint` → exit 0 (0 errors; 1 pre-existing EquityChart
  react-hooks warning, unrelated; the `REF_BTC_OKX` warning I introduced was
  cleaned up and is gone).

## Deviations from Plan

### [Rule 3 - blocking issue] Swept a test file outside the plan's 10-file list

**Found during:** Task 1, on the initial repo-wide grep.
- **Issue:** `src/lib/queries.audit-2026-05-07.test.ts` (NOT in the plan's
  `files_modified`) contained a `describe("reconstructHoldingReturnsByScopeRef —
  audit-2026-05-07 M-0553")` block that imported and called the deleted function.
  Leaving it would (a) break `tsc` / vitest at the dynamic `import("./queries")`
  and (b) fail the case-insensitive acceptance grep.
- **Fix:** Deleted that describe block (2 tests: the aliased-series invariant and
  the sort-once invariant) with its lead comment. Both tests exercised only the
  deleted function — removing code + its tests together is coverage-neutral. The
  M-0553 sort-once optimization they pinned no longer exists (the function is gone).
- **Files modified:** `src/lib/queries.audit-2026-05-07.test.ts`
- **Commit:** b9b69c7b

### [Scope discovery] getMyAllocationDashboard.scenario.test.ts was far larger than the touch-list

**Found during:** Task 1.
- **Issue:** The plan's `<interfaces>` only named `:301` (RETIRE) for this file, but
  the entire `describe("reconstructHoldingReturnsByScopeRef")` block (T1–T11 + the
  multi-venue smokes) and the `NEW-C03-02` describe block also import and call the
  deleted function. Deleting only `:301` would leave the import + ~15 calls broken.
- **Fix:** Retired both describe blocks (they test only the deleted fn), removed the
  import item and the now-unused `Holding`/`Snapshot` local types, and **preserved**
  the T_H3/T_M4/T_M5 payload-type smokes (which guard surviving fields) by moving
  them into their own describe — so the plan's "only retire :301 of the *type*
  guards" intent is honored while the fn-exercising tests go with the fn.
- **Files modified:** `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts`
- **Commit:** b9b69c7b

No other deviations — the queries.ts production deletion followed the touch-list exactly.

## Known Stubs

None. This plan is a pure deletion — it introduces no placeholder/empty-value stubs.
The removed `holdingReturnsByScopeRef: {}` occurrences were dead fixture stubs, not
new ones.

## Threat Flags

None. Per the plan's threat register: T-66-06 (over-broad deletion breaking live
holdingsSummary) is mitigated — the diff-level assertion confirms no live
holdingsSummary line changed and the full suite is green. T-66-07 (info disclosure)
is a positive: removing the field strictly SHRINKS the RSC payload (per-scope daily
returns are no longer shipped to the client). No new endpoints, auth paths, or
trust-boundary schema changes.

## Self-Check: PASSED

Files verified present and commits verified in git log (see self-check block below).
