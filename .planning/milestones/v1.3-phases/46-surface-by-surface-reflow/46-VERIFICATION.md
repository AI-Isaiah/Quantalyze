---
phase: 46-surface-by-surface-reflow
verified: 2026-06-27T18:30:00Z
status: human_needed
score: 5/5 must-haves verified (code evidence)
overrides_applied: 0
human_verification:
  - test: "Confirm reflow-sweep-authed.spec.ts ran PASSED (not skipped) in the seeded MA-8 CI job after the phase-46 commits landed"
    expected: "10 tests PASSED in the seeded Playwright job (not 10 skipped) — `vars.E2E_TEST_DB_CONFIGURED == 'true'` must be set for the job to run the spec rather than skip it"
    why_human: "The authed sweep uses `test.skip(!HAS_SEED_ENV, ...)` — it self-skips locally without seed creds. Only a CI run in the seeded MA-8 job (gated on vars.E2E_TEST_DB_CONFIGURED) proves the 10 authed+degenerate route assertions actually executed and passed. Cannot verify programmatically without seed env. Recorded as the CI-execution directive in 46-04-SUMMARY."
---

# Phase 46: Surface-by-Surface Reflow Verification Report

**Phase Goal:** Make every authed + public route reflow correctly at 320px / 400% zoom using CSS-first work — reshaping tables honestly (never dropping columns), de-blocking the wizard, and keeping degenerate empty states honest across breakpoints.
**Verified:** 2026-06-27T18:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every authed + public route passes the reflow gate (scrollWidth ≤ clientWidth at 320px; no horizontal page scroll WCAG 1.4.10; usable at 400% zoom WCAG 1.4.4) | ✓ VERIFIED (code) / ? AUTHED CI residual | `e2e/reflow-sweep.spec.ts` asserts 5 public routes via `assertNoReflow` (scrollWidth–clientWidth ≤ 1px). `e2e/reflow-sweep-authed.spec.ts` covers /allocations + 6 tabs + wizard + /security + degenerate empty route. Both specs wired into ci.yml lines 1059 / 1263. assertNoReflow in `e2e/helpers/reflow.ts` confirmed to use `doc.scrollWidth - doc.clientWidth`. CI-execution proof for the authed spec = human check item. |
| 2 | Every data table usable at 320px with NO dropped material columns; all-columns guards on highest-stakes tables fail loudly on future column drop | ✓ VERIFIED | All 5 tables wrapped: HoldingsTable (3 inner tables, lines 261/402/625), OpenPositionsTable (line 128), ScenarioCompareTable (line 186), CorrelationMatrix (line 174), ComputeJobsTable (line 196). Guards: `HoldingsTable.all-columns.test.tsx` pins legacy TOTAL_COLUMNS=7 + design DESIGN_TOTAL_COLUMNS=9 by code constant (substantive, not placeholder). `ScenarioCompareTable.all-columns.test.tsx` anchors on `scenario-col-{name}` testids + all 6 METRICS labels. `CorrelationMatrix.all-columns.test.tsx` asserts N×N header/row parity. All 3 guard files confirmed existing. Falsifiability proven by implementer (documented in SUMMARYs). |
| 3 | Onboarding/API-key wizard usable on phone — DesktopGate hard-block below 640px removed; Suspense boundary + server auth gate preserved; isNarrow===null two-pass pattern removed cleanly | ✓ VERIFIED | `DesktopGate.tsx` confirmed DELETED (file-not-found check). `page.tsx` line 1: `import { Suspense }`. Lines 70/72: `supabase.auth.getUser()` + `redirect("/login?next=/strategies/new/wizard")` preserved. Line 119: `<Suspense key={source} fallback={null}>` rendered directly. `WizardChrome.tsx` line 88: `grid-cols-1 sm:grid-cols-3` / `grid-cols-1 sm:grid-cols-4` — stepper stacks single-column below 640px. Zero new matchMedia/useMediaQuery added (grep returned empty). |
| 4 | Loading/empty/error/partial states render honestly across breakpoints — degenerate inputs keep honest empty states, no broken layout at any viewport | ✓ VERIFIED | Authed sweep includes a degenerate honest-empty route (`/allocations` with 0-position allocator → EmptyStateCard "No positions to analyze yet." h2 anchor). Task 1 of 46-04 confirmed all four honest-state components (EmptyStateCard, Skeleton family, allocations EmptyState, SampleFloorEmptyState) fluid by construction — no fixed-px widths, no `max-w-none` — verified by grep returning empty on fixed-px classes. No code change needed for SC#4. |
| 5 | No new hydration warning on any retrofitted route; coverage ratchet holds (lines 82 / stmts 80 / fns 74 / branches 72) | ✓ VERIFIED | No matchMedia / window.innerWidth / useMediaQuery in any retrofitted file (grep empty). DesktopGate removal REMOVES the matchMedia viewport branch; remaining wizard code has zero new JS viewport branches. vitest.config.ts thresholds confirmed unchanged: lines 82, functions 74, branches 72, statements 80. 46-03-SUMMARY records measured post-deletion actuals: 84.27 / 82.15 / 77.92 / 74.73 — all above thresholds with positive margin. tsc --noEmit: exit 0 (empty output). |

**Score:** 5/5 truths verified in code

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` | 3 inner tables wrapped in ResponsiveTable | ✓ VERIFIED | Lines 261, 402, 625 — 3 `<ResponsiveTable>` open tags confirmed |
| `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` | Wrapped in ResponsiveTable (tfoot inside) | ✓ VERIFIED | Line 128 wrap confirmed |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | Wrapped in ResponsiveTable | ✓ VERIFIED | Line 186 wrap confirmed |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx` | Inner overflow-auto div replaced with ResponsiveTable | ✓ VERIFIED | Line 174 wrap confirmed; outer `data-testid="correlation-matrix"` wrapper preserved |
| `src/components/admin/ComputeJobsTable.tsx` | Scroll-wrapped in ResponsiveTable | ✓ VERIFIED | Line 196 wrap confirmed |
| `src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx` | Fail-loud guard: legacy 7-col + design 9-col | ✓ VERIFIED | EXISTS; pins TOTAL_COLUMNS=7 and DESIGN_TOTAL_COLUMNS=9 by code constant; 6 assertions per mode |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.all-columns.test.tsx` | Fail-loud guard: scenario columns + 6 METRICS rows | ✓ VERIFIED | EXISTS; anchors on `scenario-col-{name}` testids + all 6 METRICS labels |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.all-columns.test.tsx` | Fail-loud guard: N×N header/row parity | ✓ VERIFIED | EXISTS; asserts header count === row-label count === N, N×N corr-cell count |
| `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` | DELETED | ✓ VERIFIED | File confirmed absent |
| `src/app/(dashboard)/strategies/new/wizard/page.tsx` | Suspense + auth gate preserved; no DesktopGate | ✓ VERIFIED | `grep DesktopGate` = 0; Suspense + supabase.auth.getUser + redirect intact |
| `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` | CSS-first stepper: `grid-cols-1 sm:grid-cols-N` | ✓ VERIFIED | Line 88 confirmed |
| `e2e/reflow-sweep.spec.ts` | Public route reflow sweep; no env guard | ✓ VERIFIED | EXISTS; imports assertNoReflow; 5 routes at 320px; no HAS_SEED_ENV in file |
| `e2e/reflow-sweep-authed.spec.ts` | Seeded authed sweep + degenerate empty route; HAS_SEED_ENV guard | ✓ VERIFIED | EXISTS; HAS_SEED_ENV const + test.skip confirmed; 10 routes including wizard + degenerate |
| `.github/workflows/ci.yml` FLOW-01 wiring | Public sweep in unseeded list; authed sweep in seeded MA-8 list | ✓ VERIFIED | Line 1059: `e2e/reflow-sweep.spec.ts` in unseeded job; line 1263: `e2e/reflow-sweep-authed.spec.ts` in seeded MA-8 list |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `e2e/reflow-sweep.spec.ts` | `e2e/helpers/reflow.ts assertNoReflow` | import line 2 | ✓ WIRED | Import confirmed; assertNoReflow measures `doc.scrollWidth - doc.clientWidth` ≤ 1px |
| `e2e/reflow-sweep.spec.ts` | ci.yml unseeded Playwright job | ci.yml:1059 | ✓ WIRED | Filename present on that line |
| `e2e/reflow-sweep-authed.spec.ts` | ci.yml seeded MA-8 job | ci.yml:1263 | ✓ WIRED | Filename present on that line |
| `HoldingsTable.tsx` | `ResponsiveTable` | import + JSX wrap | ✓ WIRED | Import line 38; 3 wrap sites |
| `ScenarioCompareTable.tsx` | `ResponsiveTable` | import + JSX wrap | ✓ WIRED | Import line 3; wrap at line 186 |
| `CorrelationMatrix.tsx` | `ResponsiveTable` | import + JSX wrap | ✓ WIRED | Import line 4; wrap at line 174 |
| `wizard/page.tsx` | `<Suspense>` subtree (direct, no DesktopGate) | JSX render | ✓ WIRED | `<Suspense key={source}>` at line 119 rendered directly |
| `wizard/page.tsx` | server auth gate | `supabase.auth.getUser()` + `redirect` | ✓ WIRED | Lines 70+72 confirmed |

---

### Data-Flow Trace (Level 4)

Not applicable. All phase-46 artifacts are pure presentation-layer wrappers (scroll containers, CSS class changes, test guards). No new data sources or state variables introduced. No dynamic data rendering added. Frozen math boundary (`scenario.ts`/`compute.ts`) untouched.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsc --noEmit clean | `npx tsc --noEmit` | exit 0 (empty output) | ✓ PASS |
| FLOW-01 dual-wiring provable by grep | `grep -q "reflow-sweep.spec.ts" ci.yml && grep -q "reflow-sweep-authed.spec.ts" ci.yml && ! grep -q "HAS_SEED_ENV" e2e/reflow-sweep.spec.ts && grep -q "HAS_SEED_ENV" e2e/reflow-sweep-authed.spec.ts` | All conditions met | ✓ PASS |
| All 9 phase-46 commits in git log | `git log --oneline a0b0390c de631910 c2bf8cb8 e7fb8d94 9510810d 339811d7 71b2653a 2f43e4c5 64be734e` | All 9 commits present with correct messages | ✓ PASS |
| DesktopGate.tsx absent | `ls DesktopGate.tsx` | File not found | ✓ PASS |
| Coverage ratchet thresholds unchanged | `grep thresholds vitest.config.ts` | lines 82 / stmts 80 / fns 74 / branches 72 (unchanged) | ✓ PASS |
| ResponsiveTable has overflow-x-auto + role=region | grep on `src/components/ResponsiveTable.tsx` | `overflow-x-auto`, `role="region"`, `tabIndex={0}` confirmed | ✓ PASS |
| Authed sweep self-skips locally (no crash without seed) | Inferred from spec structure (HAS_SEED_ENV + test.skip) | 10 tests would skip | ? SKIP (needs CI) |

---

### Probe Execution

No probes declared in PLAN frontmatter for Phase 46. The FLOW-01 dual-wiring proof was executed as a grep compound command in 46-04-SUMMARY (Task 4, documented exit 0) — not a shell probe script.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TABLE-01 | 46-01, 46-02 | Every data table usable at 320px, no dropped material columns | ✓ SATISFIED | 5 tables wrapped in ResponsiveTable; 3 all-columns guards with code-constant anchors and proven falsifiability |
| WIZARD-01 | 46-03 | Wizard usable on phone; DesktopGate removed; two-pass pattern preserved | ✓ SATISFIED | DesktopGate deleted; Suspense + auth gate confirmed in page.tsx; stepper CSS-first grid-cols-1 sm:grid-cols-N |
| REFLOW-01 | 46-04 | Every authed + public route reflows at 320px (WCAG 1.4.10) | ✓ SATISFIED (code) / ? authed CI residual | reflow-sweep.spec.ts (5 public) + reflow-sweep-authed.spec.ts (10 authed) both FLOW-01 wired; public spec verified locally; authed spec CI-only |
| REFLOW-02 | 46-04 | Every surface usable at 400% zoom; zoom never disabled | ✓ SATISFIED | 320px = 1280/4 (WCAG equivalence); no maximum-scale/user-scalable in retrofitted files |
| REFLOW-03 | 46-04 | Degenerate states honest across breakpoints | ✓ SATISFIED | Degenerate honest-empty route in authed sweep; honest-state components verified fluid with no fixed-px widths |

All 5 requirements mapped to Phase 46 in REQUIREMENTS.md show `[x]` complete. Zero orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No TBD/FIXME/XXX debt markers found in any phase-46 modified file. No stub patterns (return null / empty arrays / placeholder text). No hardcoded empty data. |

---

### Human Verification Required

#### 1. Authed Reflow Sweep CI Execution

**Test:** After phase-46 commits land (PR merges), inspect the seeded MA-8 Playwright job in CI and confirm `e2e/reflow-sweep-authed.spec.ts` shows `10 passed` (not `10 skipped`).

**Expected:** 10 tests PASSED — /allocations (default + 6 tabs), /strategies/new/wizard, /security (authed), and the degenerate 0-position EmptyState route — each asserting `scrollWidth - clientWidth ≤ 1px` at 320px.

**Why human:** The authed spec uses `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && ...` + `test.skip(!HAS_SEED_ENV, ...)`. Without seed credentials the spec self-skips locally (10 skipped, no crash). Only the CI seeded MA-8 job (gated on `vars.E2E_TEST_DB_CONFIGURED == 'true'`) runs this spec for real. A `skipped` status in CI would mean the FLOW-01 seed-guard wiring is broken and SC#1 (REFLOW-01) is unproven for authed routes. The spec's existence + ci.yml wiring is code-verified; the execution proof is CI-only.

---

### Gaps Summary

No code gaps found. All 5 success criteria are demonstrably TRUE in the shipped code:

- **SC#1 (REFLOW-01/02/03):** Two reflow sweep specs exist, use `assertNoReflow` (scrollWidth ≤ clientWidth), anchor on visible route-specific elements (not generic chrome), cover 5 public + 10 authed routes including degenerate state, and are FLOW-01 dual-wired (unseeded list line 1059 + seeded MA-8 list line 1263). The 320px width IS the WCAG 400%-zoom-on-1280 equivalent per the phase-44 harness convention.
- **SC#2 (TABLE-01):** All 5 tables wrapped in ResponsiveTable (confirmed by grep on all 5 source files). Three all-columns guards exist, are substantive (code-constant anchors, multiple assertions, falsifiability documented), and cover the highest-stakes tables. No column drops — `ResponsiveTable` adds scroll, not visibility toggling.
- **SC#3 (WIZARD-01):** DesktopGate deleted (file absent). Wizard page renders `<Suspense key={source}>` directly. Auth gate (`supabase.auth.getUser` + `redirect`) preserved. Stepper CSS-first collapse (`grid-cols-1 sm:grid-cols-N`) confirmed. Zero new matchMedia sites.
- **SC#4 (REFLOW-03):** Honest-state components have no fixed-px widths. Degenerate route covered in authed sweep. No fabricated data introduced.
- **SC#5 (no hydration warnings; coverage ratchet):** Zero new matchMedia/JS viewport branches in retrofitted files. Coverage thresholds unchanged (82/80/74/72). Post-deletion actuals (84.27/82.15/77.92/74.73) all above threshold. tsc --noEmit clean.

The sole `human_needed` item is the CI execution proof for the authed sweep — a standard FLOW-01 observation that cannot be made locally (per the established project pattern from phases 44-45 and the MEMORY.md FLOW-01 wiring note).

---

_Verified: 2026-06-27T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
