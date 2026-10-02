---
phase: 43-edge-states-toggle-fold-guards
plan: 03
subsystem: ui
tags: [playwright, axe, wcag-aa, vitest, static-guard, degenerate-matrix, factsheet, scenario-composer, permanent-guard]

# Dependency graph
requires:
  - phase: 43-edge-states-toggle-fold-guards
    plan: 01
    provides: the folded factsheet body (#factsheet-main mount via ScenarioFactsheetChart) + the Data-sources CollapsibleSection + Diversification section (#factsheet-diversification) this axe spec + cross-check assert against
  - phase: 41-diversification
    provides: the Diversification CollapsibleSection + its 0/1-constituent honest-empty ("Add a second strategy to see diversification") body
  - phase: 42-mandate-peer
    provides: the scenarioPeer / scenarioMandate / scenarioOwnBookDelta props the composer threads into the body mount (the honest-degradation seam)
  - phase: 33-journey-polish
    provides: the already-CI-wired e2e/composer-axe.spec.ts (ci.yml:1261, HAS_SEED_ENV-gated) this plan EXTENDS
provides:
  - "GUARD-03: the composer WCAG-AA axe gate (composer-axe.spec.ts Scan 2) now gates on the folded surface (#factsheet-main + #factsheet-diversification + the real-OR-honest-empty section idiom) before analyze() — anti-false-green over the assembled body + sections; coverage ratchet stays green"
  - "GUARD-01 (static guard): a PERMANENT automated test asserts ScenarioComposer.tsx contains the literal FactsheetBody EXACTLY zero times (the mount stays in ScenarioFactsheetChart.tsx) — readFileSync source-scan, mutation-verified falsifiable"
  - "GUARD-01 (closing cross-check): the assembled folded surface renders honest empty/safe states SIMULTANEOUSLY across the degenerate matrix (0/1 constituent, n<10, n<252, no own-book, no mandate) — the one genuine new edge-state gap, proven on the FOLDED surface not per-panel-in-isolation"
affects: [milestone-v1.2.2-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anti-false-green axe gating: assert visible anchors for the folded surface (#factsheet-main + section heading) BEFORE analyze() so a body that failed to mount fails LOUDLY rather than reporting a hollow zero"
    - "Real-OR-honest-empty idiom for axe section anchors: gate on the section being PRESENT (real body OR honest-empty copy), never require a non-degenerate body in the single-strategy CI seed"
    - "PERMANENT static-source guard via readFileSync + literal-count == 0 (render-engine-independent; mirrors composer-width.test.tsx) as the milestone-closing separation gate"
    - "Assembled-surface degenerate cross-check: assert DOM honest-empty bodies (Diversification, blend panels) AND the chart-bound Peer/Mandate/OwnBookDelta props degrade null/undefined on ONE render — co-existence, not per-panel-in-isolation"

key-files:
  created: []
  modified:
    - "e2e/composer-axe.spec.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Scan 2 extension EXTENDS the existing already-CI-wired spec (ci.yml:1261) — NO new spec, NO new HAS_SEED_ENV const, NO ci.yml entry (FLOW-01 does NOT apply, verify-only). The single analyze() over the whole composed <main> is preserved (it already scans the newly-mounted DOM); the additive work is the anti-false-green visible-anchor gates only."
  - "#factsheet-main + #factsheet-diversification are HARD anchors (always present on the composed surface). Mandate/Peer/OwnBookDelta honestly empty out at the single-strategy CI seed, so they are gated via the real-OR-honest-empty idiom — Diversification's own honest-empty copy ('Add a second strategy to see diversification') doubles as the visible proof the folded surface rendered its degenerate state, not a blank gap."
  - "The degenerate-matrix cross-check lives in ScenarioComposer.test.tsx where ScenarioFactsheetChart is MOCKED — so Peer/Mandate/OwnBookDelta honesty is asserted via the props the composer THREADS into that mount (honest null/undefined), while Diversification + blend-panel honest-empty bodies are asserted directly in the composed DOM. Two renders cover the full matrix: (1) own-book degenerate 0-constituent (0/1-constituent + n<10 + n<252 + no-mandate + Data-sources-fold-absent), (2) blank-mode + single constituent (no-own-book co-existing with single-constituent honest-empty)."
  - "Added a DEDICATED PERMANENT GUARD-01 static guard (literal count == 0) distinct from the pre-existing broader Phase-30 T-30-05 'no factsheet import' guard — this one is the explicit milestone-closing separation gate, pins the EXACT count, and is marked do-NOT-delete-at-close. Mutation-verified falsifiable (injecting a FactsheetBody literal into the composer turns it RED)."
  - "New self-contained describe block at end-of-file; reuses module-level makePayload/addStrategy/fixtures (ALLOCATOR_A, HOLDING_*) and defines local lastChartProps/lastScenarioMetrics readers (the first describe's same-named helpers are out of scope). Did NOT clobber 43-01's existing 100 tests in the file."

requirements-completed: [GUARD-03, GUARD-01]

# Metrics
duration: 20min
completed: 2026-06-26
---

# Phase 43 Plan 03: Edge states, toggle fold & guards (GUARD-03 + GUARD-01 close) Summary

**Closed milestone v1.2.2's last two guards: extended the already-CI-wired composer-axe WCAG-AA e2e (Scan 2) with anti-false-green visible-anchor gates over the folded factsheet body (#factsheet-main) + the Diversification/Peer/Mandate sections (real-OR-honest-empty idiom), and added two PERMANENT vitest gates in ScenarioComposer.test.tsx — a mutation-verified static-source guard (FactsheetBody literal count == 0, mount stays in ScenarioFactsheetChart.tsx) and an assembled-surface degenerate-matrix cross-check proving the folded surface renders honest empty/safe states SIMULTANEOUSLY across 0/1-constituent, n<10, n<252, no-own-book, and no-mandate — with the coverage ratchet green and FLOW-01 not triggered (verify-only CI wiring).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-26T17:28:00Z
- **Completed:** 2026-06-26T17:48:00Z
- **Tasks:** 2
- **Files modified:** 2 (both test files — 1 e2e spec, 1 vitest component test)

## Accomplishments

- **GUARD-03 axe extension (Task 1):** Extended `e2e/composer-axe.spec.ts` Scan 2 with visible-anchor gates BEFORE the existing single `analyze()`/`expect(violations).toEqual([])`: (a) the real factsheet body article `[id="factsheet-main"]` (proves the real FactsheetBody mounted via ScenarioFactsheetChart), (b) the Diversification CollapsibleSection `#factsheet-diversification` (always present), (c) the Mandate/Peer/OwnBookDelta sections via the spec's existing real-OR-honest-empty idiom — gated on Diversification's honest-empty copy ("Add a second strategy to see diversification"), the visible proof the folded surface rendered its single-seed degenerate state rather than a blank gap. The single `analyze()` over the whole composed `<main>` is preserved (no second axe call — it already scans the newly-mounted DOM). The `HAS_SEED_ENV` gate + `buildAxe` harness are untouched; ci.yml still lists the spec at line 1261 (verify-only, no FLOW-01 re-add). The spec header documents the GUARD-03 extension and the FLOW-01-does-not-apply rationale.
- **GUARD-01 static guard (Task 2a):** Added a PERMANENT automated test that readFileSync-reads `ScenarioComposer.tsx` and asserts it contains the literal `FactsheetBody` EXACTLY zero times (mirrors the `composer-width.test.tsx` static-source-scan; render-engine-independent and permanent — the body mount stays EXCLUSIVELY in `ScenarioFactsheetChart.tsx`). A positive control (`/ScenarioFactsheetChart/` matches) proves the read is real. Mutation-verified falsifiable: injecting a `FactsheetBody` literal into the composer source turned the guard RED; reverted (composer source byte-identical, count back to 0).
- **GUARD-01 degenerate-matrix cross-check (Task 2b):** Added the assembled-surface integration cross-check — the ONE genuine new edge-state gap research identified (per-panel honesty was already proven per-phase; this proves the FOLDED surface). Two renders cover the full matrix simultaneously: (1) **own-book degenerate (0 constituents)** — Diversification honest-empty (no 1×1 grid), BOTH blend panels render their honest `role=status` banner (never `role=alert`, never a populated-but-empty body), the Data-sources fold honestly DISAPPEARS (showDataSources false), the chart-bound `scenarioPeer`/`scenarioMandate`/`scenarioOwnBookDelta` props all degrade to null/undefined (honest absence, not fabricated zeros), and every threaded numeric is finite (no NaN/Inf); (2) **no own-book (blank mode) + single constituent** — `scenarioOwnBookDelta` degrades to undefined co-existing with the single-constituent Diversification honest-empty, again no NaN/Inf and no `role=alert`.
- **Invariants held:** `composer-axe.spec.ts` tsc-clean + eslint-clean + Playwright-parseable (1 test listed); `ScenarioComposer.test.tsx` 103 tests green (100 from 43-01 + 3 new), tsc 0 errors, eslint 0 errors. Touched dirs (`src/app/(dashboard)/allocations/` + `src/app/factsheet/[id]/v2/`) = 102 files / 1222 tests green. **Full suite: 558 files / 6768 tests green (0 failures), and the coverage ratchet (GUARD-03's blocking CI gate) is GREEN — Statements 82.36 (≥80), Branches 74.91 (≥72), Functions 78.13 (≥74), Lines 84.49 (≥82).** `scenario.ts` ZERO-DIFF (FROZEN); composer `FactsheetBody` literal count == 0; project-wide tsc 0 errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend composer-axe.spec.ts Scan 2 with folded-surface visible-anchor gates (GUARD-03)** — `17cbc8d1` (test)
2. **Task 2: GUARD-01 static guard + assembled degenerate-matrix cross-check** — `d8304815` (test)

## Files Created/Modified

- `e2e/composer-axe.spec.ts` (modified) — Scan 2 extended with `[id="factsheet-main"]` + `#factsheet-diversification` visible-anchor gates + the real-OR-honest-empty section idiom (Diversification honest-empty copy) before the preserved single `analyze()`. Header documents the GUARD-03 extension + FLOW-01-does-not-apply (verify-only). `HAS_SEED_ENV`/`buildAxe`/ci.yml untouched.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (modified) — new dedicated describe block ("Phase 43 GUARD-01 static guard + assembled degenerate matrix") appended: the PERMANENT `FactsheetBody`-count-==-0 static guard + the two-render assembled-surface degenerate-matrix cross-check. Reuses module-level `makePayload`/`addStrategy`/fixtures; local `lastChartProps`/`lastScenarioMetrics` readers. 43-01's existing 100 tests in the file are untouched.

## Decisions Made

- **Scan 2 EXTENDS, never replaces.** The single `analyze()` over the composed `<main>` already covers any newly-mounted DOM; the additive work is anti-false-green visible-anchor gates only (no second axe call). This is a verify-only CI extension of an already-listed, already-`HAS_SEED_ENV`-gated spec — FLOW-01 (must-add-to-HAS_SEED_ENV + ci.yml) does NOT apply.
- **Real-OR-honest-empty for degenerate sections.** A single seeded strategy honestly empties Diversification/Mandate/Peer in the CI seed env; gating on a non-degenerate body would false-fail. The Diversification honest-empty copy is the stable single-seed anchor and doubles as the visible proof the folded surface rendered its degenerate state.
- **Cross-check asserts props for the mocked chart.** `ScenarioFactsheetChart` is mocked in `ScenarioComposer.test.tsx`, so Peer/Mandate/OwnBookDelta honesty is asserted via the props the composer threads into that mount (honest null/undefined), while Diversification + blend-panel honest-empty bodies are asserted directly in the composed DOM. Two renders cover the full matrix without un-mocking the chart island.
- **Dedicated PERMANENT static guard, distinct from T-30-05.** A focused milestone-closing separation gate (literal count == 0, do-NOT-delete-at-close) sits alongside the pre-existing broader Phase-30 "no factsheet import" guard. Mutation-verified falsifiable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `lastScenarioMetrics` was out of scope in the new describe block**
- **Found during:** Task 2 (first cross-check test run)
- **Issue:** The new describe block referenced `lastScenarioMetrics()` (to assert the degenerate blend's `avg_pairwise_correlation` is honest null), but that helper is defined INSIDE the first describe block (line ~3022), not module-level → `ReferenceError: lastScenarioMetrics is not defined`.
- **Fix:** Added a local `lastScenarioMetrics` reader in the new block (reads `vi.mocked(KpiStrip).mock.calls.at(-1)?.[0].scenarioMetrics` — `KpiStrip` IS imported module-level). Self-contained, no change to the first block's helper.
- **Files modified:** src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
- **Verification:** all 103 tests green.
- **Committed in:** d8304815 (Task 2 commit)

**2. [Rule 3 - Blocking] `liveBaselineMetrics: null` tripped tsc (field is required, not nullable)**
- **Found during:** Task 2 (tsc on the no-own-book test)
- **Issue:** For the no-own-book case I initially set `liveBaselineMetrics: null`, but the `MyAllocationDashboardPayload.liveBaselineMetrics` type is a REQUIRED object (not `| null`) → `TS2322: Type 'null' is not assignable`. The actual no-own-book signal is `equityDailyPoints: []` (→ `baselineEquityDailyPoints`), not `liveBaselineMetrics`.
- **Fix:** Provided the honest empty form of the object (`aum:0`, null scalars, empty `equity`/`drawdown`) instead of `null`; the no-own-book degradation is correctly driven by `equityDailyPoints: []`. Added a code comment explaining the field is a separate, required axis.
- **Files modified:** src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
- **Verification:** tsc 0 errors in the test file; the test still proves `scenarioOwnBookDelta` degrades to undefined.
- **Committed in:** d8304815 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking, both self-inflicted test-authoring issues in the same Task-2 commit — a helper-scope ReferenceError and a type-shape mismatch). No scope creep; no source files touched (test-only plan). The frozen `scenario.ts` and the composer source are byte-identical to pre-plan.

## Issues Encountered

- **Playwright axe spec is `test.skip` locally (no seed env).** `e2e/composer-axe.spec.ts` is `HAS_SEED_ENV`-gated (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` absent locally), so the live WCAG-AA scan does not run on this machine. The edits are tsc-clean, eslint-clean, and Playwright-parseable (`--list` shows 1 coherent test), and the spec IS in CI's seeded-playwright list (ci.yml:1261). CI exercises the live axe scan over the folded surface; this is the authored-but-skipped pattern the spec already uses (a false-green guard, not a gap).
- **Benign JSDOM canvas noise + an `/api/benchmark/btc` URL-parse warning** appear when mounting the composer (the chart island / a benchmark-fetch effect under jsdom). Pre-existing across the composer suite; not test failures — all 103 tests pass regardless.

## Known Stubs

None — both artifacts are real regression gates with live assertions. The axe spec gates on real DOM anchors before a real axe scan; the static guard reads the real composer source off disk; the degenerate cross-check renders the real composer and asserts real honest-empty bodies + real threaded props. No placeholder values, no trivially-passing assertions (the static guard is mutation-verified RED on a literal injection; the cross-check asserts honest null/undefined props that a non-degenerate blend would populate).

## Threat Flags

None — this is a test-only plan with no new network endpoint, auth path, file-access pattern, or schema change. The plan's `<threat_model>` (T-43-06 static-guard separation, T-43-07 WCAG-AA on the folded surface, T-43-08 dishonest empty) is fully mitigated by the three artifacts (the permanent static guard, the axe Scan-2 extension, the degenerate-matrix cross-check) — no new surface introduced.

## User Setup Required

None — pure test files (1 Playwright e2e + 1 vitest component test). No env vars, no migrations, no endpoints, no external service config. The axe spec's seed env (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`) is already wired in CI for the existing spec.

## Next Phase Readiness

- GUARD-03 + the GUARD-01 closing edge-state work complete — Phase 43 (and milestone v1.2.2 scenario-tab-factsheet-parity) is fully built: all four guards (GUARD-01 fold + polish in 43-01, GUARD-02 byte-identity + GUARD-04 no-bleed in 43-02, GUARD-03 axe + the GUARD-01 static-guard/degenerate cross-check in 43-03) are in place and green.
- The composer WCAG-AA axe gate now covers the assembled folded surface (anti-false-green); the coverage ratchet stays green; the static guard is a permanent automated test (not an ad-hoc grep); the folded surface is proven honest across the full degenerate matrix.
- No blockers. `scenario.ts` FROZEN (zero-diff); composer `FactsheetBody` literal count == 0; CI wiring intact (no FLOW-01 re-add). Milestone lifecycle (audit-milestone → complete-milestone → git tag v1.2.2 → cleanup) is the next operator step, after /ship lands the code on main.

## Self-Check: PASSED

- SUMMARY file: created at .planning/phases/43-edge-states-toggle-fold-guards/43-03-SUMMARY.md
- Modified file `e2e/composer-axe.spec.ts`: FOUND (contains "factsheet-main")
- Modified file `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`: FOUND (contains "FactsheetBody" + "add a second strategy")
- Commit 17cbc8d1 (Task 1 axe extension): FOUND
- Commit d8304815 (Task 2 static guard + cross-check): FOUND
- Static guard: composer FactsheetBody count == 0 (PASS); scenario.ts zero-diff (PASS)
- CI wiring: composer-axe.spec.ts still in ci.yml:1261 (PASS, verify-only)
- Suites: 103 composer tests green; 1222 touched-dir tests green; full suite 6768 green; coverage ratchet GREEN (82.36/74.91/78.13/84.49 ≥ 80/72/74/82); tsc 0 errors; eslint 0 errors

---
*Phase: 43-edge-states-toggle-fold-guards*
*Completed: 2026-06-26*
