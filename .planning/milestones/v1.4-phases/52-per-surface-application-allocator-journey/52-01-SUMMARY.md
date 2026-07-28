---
phase: 52-per-surface-application-allocator-journey
plan: 01
subsystem: testing
tags: [vitest, playwright, git-delta-guard, container-queries, tabular-nums, reflow, frozen-spine]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the fluid --text-* clamp tier whose proportional-digit hazard the tabular-nums contract guards against"
  - phase: 50-primitive-refresh
    provides: "StrategyTable @container precedent (50-06) the tabular-nums contract anchors on"
  - phase: 51-shell-ia
    provides: "the (marketing) route-group + the /compare route the 2560 sweep anchors"
provides:
  - "phase-52 frozen-spine git-delta guard (BP-01) — zero-diff over the 8 frozen-island paths vs baseline cd2fcb4c"
  - "2560px ultra-wide reflow row in the authed sweep (APPLY-01 / TYPE-03), additive, no new CI wiring"
  - "container-query tabular-nums alignment contract (TYPE-04) the 52-02/03/06 migrations keep green"
affects: [52-02, 52-03, 52-04, 52-05, 52-06, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "git-delta frozen-island exit-gate (per-island assertion; fail-loud baseline resolve; FALLBACK_BASE_SHA pinned to planning HEAD)"
    - "additive describe fold into an already-seeded already-dual-wired e2e spec (no new FLOW-01 wiring)"
    - "tracked-registry (CONTAINER_MIGRATED) contract that later surface plans append to, so the gate is non-vacuous"

key-files:
  created:
    - "src/__tests__/phase-52-frozen-spine-guards.test.ts"
    - "src/__tests__/phase-52-container-tabular-nums.test.tsx"
  modified:
    - "e2e/reflow-sweep-authed.spec.ts"

key-decisions:
  - "Guard ALL 8 island paths (the chart-interactivity trio EquityChart+TouchTooltip+useTapPin is one CONTEXT island = 3 files); one assertion per island so a CI failure names the exact offending file."
  - "The git-delta guard catches a COMMITTED island edit (the real CI scenario — a restyle commit between baseline and HEAD) and a brand-new untracked sibling; an unstaged working-tree mod is out of scope by design (matches the phase-29/30 sibling semantics)."
  - "Test 1 of the tabular-nums contract guards BOTH drift directions: a class-keyed pass (tabular-nums cell missing font-metric/font-mono) AND a right-aligned-numeric pass (a numeric column that DROPPED tabular-nums entirely) — the second is the Rule-9 'every columnar numeric cell' intent the first pass alone would miss."
  - "/compare anchored on the empty-selection PageHeader h1 'Compare Strategies' — a freshly-seeded allocator with no ?ids= reliably renders that branch (Pitfall 5 route-specific visible node, never bare chrome)."

patterns-established:
  - "Wave-0 executable contract precedes the surface implementation: the gate goes in BEFORE any surface is touched so an island RSC-ification / ultra-wide overflow / broken tabular-nums column fails LOUD in CI."
  - "Non-vacuity is PROVEN, not assumed: each new guard was probed (committed island edit → RED; stripped tabular-nums/font-metric → RED) and the probe reverted, before the commit."

requirements-completed: [BP-01, TYPE-03, TYPE-04]

# Metrics
duration: 7min
completed: 2026-06-29
---

# Phase 52 Plan 01: Wave-0 Executable Contracts Summary

**Three Wave-0 gates landed before any allocator surface is touched: a per-island git-delta frozen-spine guard, a 2560px ultra-wide row folded into the seeded authed reflow sweep, and a container-query tabular-nums alignment contract anchored on the StrategyTable precedent — each proven non-vacuous.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-29T11:04:01Z
- **Completed:** 2026-06-29T11:11:37Z
- **Tasks:** 3 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- **BP-01 frozen-spine guard** — `phase-52-frozen-spine-guards.test.ts` reads the real git delta vs baseline `cd2fcb4c` and asserts each of the 8 frozen-island paths is zero-diff, with one `it(...)` per island (a CI failure names the exact file) plus the Rule-12 fail-loud baseline resolve. Belt-and-suspenders STRUCTURAL gate over the existing svg-golden + scenario.test.ts MATH/RENDER gates: it catches an island edit (e.g. an RSC-ification during a restyle) even when the goldens happen not to diff.
- **TYPE-03 ultra-wide reflow** — an additive `reflow sweep @ 2560px ultra-wide — authed` describe at the end of `reflow-sweep-authed.spec.ts`, reusing the existing `HAS_SEED_ENV` + `test.skip` + `seedTestAllocator` + `loginViaForm` scaffolding. Covers `/allocations` + `?tab=scenario` + `?tab=risk` (the "My Allocation" h1) and `/compare` (the empty-selection "Compare Strategies" h1). No new CI wiring — the spec is already in the ci.yml seeded MA-8 list (the rotate-stability fold is the precedent).
- **TYPE-04 tabular-nums contract** — `phase-52-container-tabular-nums.test.tsx` renders the already-migrated StrategyTable `@container` precedent and asserts (1) every columnar numeric cell carries both `tabular-nums` and a fixed-width font, (2) `@max-3xl:hidden` collapse columns are rightmost-priority and their real value relocates into the per-row `<details>` (never a fabricated em-dash/0), (3) the `CONTAINER_MIGRATED` registry is non-empty. The 52-02/03/06 container migrations keep this green.

## Task Commits

Each task was committed atomically:

1. **Task 1: 52-scoped frozen-spine git-delta guard (BP-01)** — `bf7fb74b` (test)
2. **Task 2: 2560px ultra-wide reflow row in the authed sweep (APPLY-01 / TYPE-03)** — `9c0b8256` (test)
3. **Task 3: container-query tabular-nums alignment contract (TYPE-04)** — `153647e0` (test)

_Note: Task 3 is `tdd="true"` but verifies an ALREADY-shipped implementation (StrategyTable migrated in Phase 50-06), so it lands as a single GREEN-by-precedent `test(...)` commit — there is no new implementation code to RED-gate in this Wave-0 contract._

## Files Created/Modified

- `src/__tests__/phase-52-frozen-spine-guards.test.ts` — git-delta zero-diff guard over the 8 frozen-island paths; copies the phase-30 baseline-resolve + delta machinery near-verbatim, FALLBACK_BASE_SHA = `cd2fcb4c`.
- `e2e/reflow-sweep-authed.spec.ts` — additive 2560px ultra-wide describe block at the end (the 320px sweep + rotate-stability fold above are untouched).
- `src/__tests__/phase-52-container-tabular-nums.test.tsx` — container-query tabular-nums alignment contract + `CONTAINER_MIGRATED` registry.

## Verification

- `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts src/__tests__/phase-52-container-tabular-nums.test.tsx` → **Test Files 2 passed, Tests 14 passed**.
- `npx tsc --noEmit -p tsconfig.json` → **no errors originate in `reflow-sweep-authed.spec.ts`** (verify command exits clean).
- `git diff --name-only cd2fcb4c HEAD | grep <islands>` → **no frozen-island file in the phase delta** (the guard self-proves on the clean tree).
- Non-vacuity probes (each reverted before commit):
  - committed edit to `useTapPin.ts` → the `useTapPin` island assertion went **RED**, naming the file.
  - stripped `font-metric` from a `tabular-nums` cell → Test 1 **RED**.
  - dropped `tabular-nums` from the `cumulative_return` numeric cell → Test 1 **RED** (inverse-drift pass).
- `StrategyTable.test.tsx` (24 tests) re-run **green** after all probes — no residue.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, blocking issues, or architectural changes encountered. No package installs (CSS/test-only phase, as the threat register's T-52-SC notes). No auth gates.

## Acceptance Criteria

**Task 1 (BP-01):** file exists + green on clean tree (9 tests); island-path grep = 20 (≥ 8); `FALLBACK_BASE_SHA = "cd2fcb4c"`; Rule-12 fail-loud baseline throw preserved. ✓
**Task 2 (TYPE-03):** `2560` grep = 7 (≥ 1); reuses `HAS_SEED_ENV` + `test.skip` (single seed-env const, no duplicate); tsc clean for the spec; every anchor an `h1:has-text(...)` content node (no bare body/main); ci.yml unmodified. ✓
**Task 3 (TYPE-04):** file exists + green (5 tests); `tabular-nums` grep = 18 (≥ 1); the no-invented-data assertion present (`toBe("—")` + `not.toBe("0")`); `CONTAINER_MIGRATED` declared non-empty. ✓

## Known Stubs

None. The three files are complete executable contracts; the `CONTAINER_MIGRATED` registry is intentionally seeded with the three components this phase migrates (StrategyTable already shipped; KpiStrip + CompareTable land in 52-02/03/06) and is documented as the tracked, append-as-you-go coverage list — not a stub.

## Notes for Downstream Plans (52-02 … 52-06, 54)

- The frozen-spine guard is RED if any of the 8 island paths is committed-changed vs `cd2fcb4c`. The visual restyle is free everywhere ELSE; do not edit `scenario.ts`, `factsheet/compute.ts`, `factsheet-context.tsx`, `useBreakpoint.ts`, `montecarlo.worker.ts`, `EquityChart.tsx`, `TouchTooltip.tsx`, or `useTapPin.ts`.
- As each surface migrates a table/strip to `@container`, KEEP the tabular-nums contract green: numeric cells carry `tabular-nums` + `font-metric`/`font-mono`, collapse from the right edge, relocate real values into a `<details>`, and never fabricate an em-dash/0. Append the migrated component to `CONTAINER_MIGRATED` if you want the registry to track it (the assertions already gate the live StrategyTable render).
- The 2560 row is the cheap in-scope subset; the app-wide ultra-wide sweep formally lands in Phase 54 (VERIFY-*).

## Self-Check: PASSED

- Files: all 3 created/modified files + the SUMMARY exist on disk.
- Commits: `bf7fb74b`, `9c0b8256`, `153647e0` all present in git log.
- `.planning/` is gitignored (local-only, per PR #530) — the SUMMARY is written to disk but not committed; the three `test(...)` commits are the complete code deliverable.
