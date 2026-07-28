---
phase: 63-holdings-snapshot-fallback-engine-removal
plan: 03
subsystem: allocations/scenario-compare
status: complete
completed: 2026-07-03
tags: [ENGINE-02, GUARD-02, GUARD-03, series-space, deletion]
requirements: [ENGINE-02]
dependency_graph:
  requires: [63-02 (composer series-space only; buildAddedOnlySet exported)]
  provides:
    - "scenario-compare.ts computes on the series-space selection only (per-key branch OR buildAddedOnlySet); the legacy holdings else-branch, the alias collapse, and the three holdings-snapshot ScenarioCompareInputs fields are deleted"
    - "ScenarioComparePanel derives series-space inputs only (equityByApiKeyId kept; symbolByHoldingId loop + shrunk fields gone); payload.holdingsSummary plumbing intact (deferred)"
    - "the gate=false liveBook compare column is an honest null-metric em-dash (empty added-only set), test-pinned to assert NULL never ?? 0"
  affects: [63-04 (adapter buildStrategyForBuilderSet + scenario-dealias retirement — now only queries.ts SSR baseline + the adapter builder itself still reference holdings-engine machinery)]
tech-stack:
  patterns:
    - "identity-pair engine set: { strategies: adapterOutput.strategies, state: projectionState } — collapse removed (per-key ids and added ids are disjoint UUIDs, so the collapse was already a passthrough here)"
    - "series-space added-only compute via the ONE shared buildAddedOnlySet wrapper — never an inline StrategyForBuilder loop"
    - "honest em-dash: computeScenario null-metric passthrough (no ?? 0) kept verbatim; the gate=false liveBook column now rides it"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/scenario-compare.ts
    - src/app/(dashboard)/allocations/lib/scenario-compare.test.ts
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
    - src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx
    - src/app/scenario-share/[token]/share-resolve.test.ts
decisions:
  - "Retired the WR-01 'blank draft over a NON-EMPTY holdings book computes added-only' F5 pin (H-0487 precedent): its masked-bug premise is structurally impossible once holdingsSummary leaves ScenarioCompareInputs; the series-space F5 closure is fully covered by the preceding blank-draft/gate-true test (no coverage lost)"
  - "Comment references to the deleted identifiers were also stripped from scenario-compare.ts so the ENGINE-05 grep gate (grep -q exits 1) is satisfied against the source, not just the code"
  - "buildLiveBookDraft byte-identical (zero hunks in its body) — the WR-02 / Atlas-golden per-key basis is unchanged; only the compute path behind it (holdings else-branch) was deleted"
metrics:
  duration: ~50m (18:31–19:21 local)
  commits: 2
  tasks_completed: 2
  files_modified: 6
  touched_suites: 48/48
  wave_gate: 7454 passed / 0 failed / 288 skipped
---

# Phase 63 Plan 03: Delete the Compare Legacy Holdings Path (ENGINE-02) Summary

Deleted the legacy holdings-snapshot path from `scenario-compare.ts` — the second
holdings-engine consumer after the composer — so the compare engine now computes on
the **series-space selection only**: the surviving per-key `if`-branch
(membership-intersected, P61-pinned) or `buildAddedOnlySet` for empty membership. The
alias collapse retired to the identity pair, the three holdings-snapshot
`ScenarioCompareInputs` fields and the panel's `symbolByHoldingId` plumbing are gone,
and the gate=false liveBook column is now an honest null-metric em-dash. This was
machinery deletion, **not** re-gating — Phase 62 WR-01 had already narrowed the
else-branch to `opts.liveBook` only.

## Tasks

**Task 1 — compare deletion + panel inputs shrink (`3c89e6f2`):** in
`scenario-compare.ts` deleted the `collapseAliasedHoldingStrategies` +
`buildStrategyForBuilderSet` imports (→ `buildAddedOnlySet`), the three holdings
`ScenarioCompareInputs` fields, `disabledHoldingRefs`, and the holdings else-branch;
wired the else to `buildAddedOnlySet(draft.addedStrategies, …)`; collapsed the
`deAliased` pair to the identity (`adapterOutput.strategies` / `projectionState`,
repointing the `:301` selected reads and the window-injection); rewrote every stale
holdings/collapse/thin-baseline doc comment (including stripping the deleted
identifiers from comments so the grep gate holds). In `ScenarioComparePanel.tsx`
deleted the `buildHoldingRef` import, the `symbolByHoldingId` build loop, and the
three shrunk inputs fields; kept `equityByApiKeyId`, `defaultDraftFromHoldings`, the
MEMBER-02 normalization, and all `payload.holdingsSummary` plumbing (deferred).
`buildLiveBookDraft` stayed **byte-identical** (zero hunks in its body); the
null-metric passthrough was untouched (GUARD-03).

**Task 2 — GUARD-02 reviewed repoints (`5d43259f`):** each repoint carries an inline
Phase-63/ENGINE-02 rationale, and the commit message enumerates each individually:

- **(1) fixture rebase** — dropped the three deleted fields from every
  `ScenarioCompareInputs` literal (`perKeyLiveInputs`, both `perKeyInputs` helpers,
  share `ownerInputsFor`); deleted the now-unused holdings `liveInputs` /
  `holdingRef` / `HoldingFixture` machinery. Compile-forced; oracle bodies unchanged.
- **(2) `:620`** "EMPTY membership → legacy holdings/added path" → "series-space
  added-only" (same oracle axis — which builder ran; `member_count 0` unchanged).
- **(3) buildLiveBookDraft "all six metrics populate"** → per-key gate=true union
  blend (the healthy live-book basis is per-key now, not a holdings snapshot).
- **(4) WR-02 `:810` + buildLiveBookDraft degenerate** → gate OFF → empty membership
  → added-only EMPTY set → **NULL-metric** live-book column; asserts `toBeNull`
  (never `?? 0`) — the honest em-dash, D1-consistent (0 real users after GUARD-01).
- **(5) panel T_CP6** `symbolByHoldingId` Map assertion → shrunk-shape assertion
  (derived series-space inputs; deleted fields asserted absent).
- **(6) bridge-seam JOURNEY-01** baseline → per-key-membership book (`{ ...draft,
  memberKeyIds: BOOK_KEYS }`); the non-vacuous "projection MOVES" (d) oracle kept
  (the bridged STRAT_B sleeve still moves `twr`/`volatility`).
- **(7) share `ownerInputsFor`** fixture rebase (compile-driven); the added-only
  compute behavior is unchanged (empty membership already computed added units).

## Deviations from Plan

### Reviewed Repoints (documented, not strict byte-unchanged)

- **WR-01 F5 "prod shape" pin RETIRED (`:700`):** the plan listed F5 as do-not-touch,
  but this specific test built an inline **holdings** `ScenarioCompareInputs` literal
  (`holdingsSummary` + `holdingReturnsByScopeRef` + `symbolByHoldingId`) that no longer
  type-checks after the interface shrink, and its masked-bug premise (the else-branch
  feeding `liveInputs.holdingsSummary` unconditionally) is **structurally impossible**
  once holdings leave the engine input. Retired it with a full inline rationale (Wave-2
  H-0487 precedent). The series-space F5 closure — a blank draft over a live book whose
  per-key data is present + gate satisfied computes added-only, never the book — is
  fully pinned by the immediately preceding `perKeyInputs()`/`memberKeyIds=[]`/gate=true
  test. No coverage lost. (The orchestrator's critical note confirmed the enclosing
  MEMBER-02 block is not blanket-protected; only `:793` is the named survivor.)

- **P61-BUG-2 / MEMBER-02 shared fixtures field-dropped:** the plan's "ZERO hunks
  inside the P61-BUG-2 describe block" is satisfied at the **oracle** level — every
  `it()` assertion body is byte-unchanged. The compile-forced removal of the three dead
  fields from the block's `perKeyInputs()` helper is the "removed dead plumbing" class
  the Wave-2 GUARD-02 note already established as acceptable.

### Auto-fixed Issues

- **[Rule 3 - Blocking] `as Record<>` cast surfaced a TS2352:** the panel test's
  "deleted fields absent" assertion cast `ScenarioCompareInputs` directly to
  `Record<string, unknown>`; TS requires routing through `unknown`. Fixed to
  `inputs as unknown as Record<string, unknown>` (vitest passed on esbuild, tsc caught
  it). Fixed before the Task-2 commit.

## Verification

- **Four touched suites:** 48/48 green (compare + panel + bridge-seam + share-resolve).
- **Wave gate (`npx vitest run --no-file-parallelism`):** 624 files / 7454 tests
  passed, 0 failed, 288 skipped.
- **Grep gates (`scenario-compare.ts`):** `buildStrategyForBuilderSet` /
  `collapseAliasedHoldingStrategies` / `symbolByHoldingId` / `holdingReturnsByScopeRef`
  / `scenario-dealias` all absent (0); `buildAddedOnlySet` present (4 refs).
- **Grep gate (`ScenarioComparePanel.tsx`):** `buildHoldingRef` / `symbolByHoldingId`
  absent; `equityByApiKeyId` present (6 refs, kept).
- **buildLiveBookDraft:** zero diff hunks in the function body (byte-identical).
- **Verbatim survivors (zero-hunk oracle bodies):** P61-BUG-2 positive oracles, the
  Atlas golden (`0.04074` / `10.45` numerics unchanged), the `:793` union-lock
  survivor, T_CP8, share-resolve `:524`.
- **GUARD-03:** `git diff origin/main..HEAD -- src/lib/scenario.ts
  src/lib/scenario-window.ts` empty.
- **tsc + eslint:** clean (0 errors, 0 warnings) on all six touched files.

## Requirements

ENGINE-02 satisfied: the compare engine computes on the series-space selection only;
`ScenarioCompareInputs` is shrunk; `buildLiveBookDraft` is byte-identical; the
gate=false liveBook column is an honest, test-pinned null-metric em-dash.

## Commits

- `3c89e6f2` feat(63-03): delete the compare legacy holdings path; wire buildAddedOnlySet (ENGINE-02)
- `5d43259f` test(63-03): repoint compare/panel/bridge-seam/share fixtures to series-space (ENGINE-02, GUARD-02)
</content>
</invoke>

## Self-Check: PASSED

- SUMMARY.md exists: VERIFIED
- Commit 3c89e6f2 (Task 1) reachable: VERIFIED
- Commit 5d43259f (Task 2) reachable: VERIFIED
- Compare grep gates (5 banned identifiers absent, buildAddedOnlySet present): VERIFIED
- Panel grep gates (buildHoldingRef/symbolByHoldingId absent, equityByApiKeyId present): VERIFIED
- buildLiveBookDraft zero-hunk: VERIFIED
- GUARD-03 zero-diff: VERIFIED empty
- Wave gate 7454/0: VERIFIED
