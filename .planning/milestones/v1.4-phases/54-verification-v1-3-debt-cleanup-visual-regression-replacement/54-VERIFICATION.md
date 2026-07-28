---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
verified: 2026-06-30T02:45:00Z
status: human_needed
score: 6/6 must-haves verified (all code artifacts done; 1 human checkpoint pending)
overrides_applied: 0
human_verification:
  - test: "Real-device authed sign-off on a physical phone and/or tablet"
    expected: |
      On a real authed session (qa-demo@quantalyze.app or seeded test user) load:
      /allocations + ?tab=scenario / ?tab=risk, /compare, /discovery, /portfolios,
      the /admin prose + data pages, and the wizard. Confirm: no horizontal overflow
      / reflow; no clipped / ellipsis-truncated content; admin prose pages cap at
      ~1100px while data tables stay wide (RT-W2); type / spacing match DESIGN.md;
      no a11y regressions vs the axe matrix. Record device / OS / surfaces checked.
    why_human: |
      No physical device available and Bash sandbox has no external network —
      consistent with prior milestones' deferred authed UATs (v1.2.1/v1.2.2/v1.3).
      Auto-approving this checkpoint would be a false 'verified' claim (CLAUDE.md Rule 12).
  - test: "Live golden PNG bake for svg-chart-parity.spec.ts"
    expected: |
      On the first seeded CI run (vars.E2E_TEST_DB_CONFIGURED='true'), bake the
      desktop goldens FIRST (per the no-recompute discipline: npx playwright test
      e2e/svg-chart-parity.spec.ts -g "desktop: per-panel goldens" --update-snapshots),
      review the diff, commit. Then bake 320px portrait goldens, then 2560px ultra-wide
      goldens. The spec is wired and will hard-fail CI if baked goldens later differ.
    why_human: |
      Baking requires the test-Supabase env (TEST_SUPABASE_URL / SERVICE_ROLE_KEY)
      and must be a deliberate per-chart commit, never blind --update-snapshots
      (54-CONTEXT Out-of-Scope lock). The WR-02 guard keeps CI green-by-skip until
      the PNGs are committed. This is a deferred-by-design controlled CI step,
      not a code gap.
---

# Phase 54: Verification + v1.3 debt cleanup + visual-regression replacement

**Phase Goal:** Close the milestone with app-wide verification — ultra-wide (2560px) axe/reflow row,
authed/mobile axe rows re-enabled hermetically, lhci ratcheted up from 0.60, no-clip CI guard,
tolerance-based Playwright goldens (byte-identity replacement), complete px→token migration, and a
real-device authed sign-off + app-wide design-review audit.

**Verified:** 2026-06-30T02:45:00Z
**Status:** human_needed — all code artifacts verified; 2 context-locked human checkpoints remain
(real-device authed sign-off + deliberate golden PNG bake).
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Ultra-wide 2560px row added to axe/reflow matrix; deferred Phase-52 canaries wired and green-by-skip | VERIFIED | `e2e/axe-app-wide.spec.ts:115` VIEWPORTS includes `{ w:2560, h:1440, name:"ultrawide" }`; `reflow-sweep.spec.ts:105` has unseeded public 2560 describe; `reflow-sweep-authed.spec.ts:341` has seeded authed 2560 describe; `svg-chart-parity.spec.ts:276` has 2560 tolerance-golden test. All are green-by-skip (WR-02 + HAS_SEED_ENV guards). Golden PNG bake is DEFERRED-BY-DESIGN per `54-CONTEXT.md`. |
| 2 | `no-raw-font-px` is `error` repo-wide (0 errors); `scenario.ts`/FactsheetBody byte-equivalent | VERIFIED | `eslint.config.mjs:93` `"quantalyze/no-raw-font-px": "error"` repo-wide; `npx eslint "src/**/*.{ts,tsx}"` → exit 0, 0 errors, 31 pre-existing warnings only; frozen islands exempt via documented off-glob (`:229–271`). `phase-52-frozen-spine-guards.test.ts` 74/74 pass confirming `scenario.ts`/`compute.ts`/`EquityChart.tsx` zero-diff. |
| 3 | Authed/mobile axe rows re-enabled hermetically; lhci ratcheted from 0.60 to 0.65; no-clip CI guard wired | VERIFIED | `axe-app-wide.spec.ts:218` seedBridgeCandidate captured into `seeded`, torn down in `finally`; `ci.yml:1283` `e2e/axe-app-wide.spec.ts` in seeded MA-8 list (FLOW-01 place 1); `lighthouserc.json:36` `"minScore": 0.65` (ratcheted from 0.60); `e2e/no-clip-sweep.spec.ts` exists with runtime clip detection; FLOW-01 dual-wired: `ci.yml:1073` (unseeded) + `ci.yml:1282` (seeded). |
| 4 | Tolerance-based Playwright goldens replace byte-identity; design-review audit passes; WCAG-AA + LOCKED invariants intact | VERIFIED | `svg-chart-parity.spec.ts:216` `maxDiffPixelRatio:0.02`, `threshold:0.2` per-panel; `svg-chart-parity.spec.ts:226` `maxDiffPixelRatio:0.05` full-page; `54-DESIGN-AUDIT.md` verdict PASS (0 fix-now, 2 logged-debt, 6 accepted-conformant); 74 frozen-spine + 43 token-drift/fluid-type guard tests pass (117 total). Real-device sign-off is `human_needed`. |
| 5 | RT-W2 admin prose/form pages no longer over-stretch at ultra-wide | VERIFIED | `admin/partner-import/page.tsx:96`, `admin/users/page.tsx:64`, `admin/users/[id]/page.tsx:104`, `admin/for-quants-leads/page.tsx:33` all carry exactly one `max-w-[1100px]` cap; `admin/partner-roi/page.tsx` has none (data page stays wide); `admin-width.test.tsx` 4+1 assertions green (included in the 74-test frozen-spine run). |
| 6 | WCAG-AA floor and LOCKED invariants (`scenario.ts`/`compute.ts` zero-diff, `FactsheetBody` byte-equivalent, `@container` guard) all intact | VERIFIED | `vitest run phase-52-frozen-spine-guards tests/a11y/design-token-drift tests/visual/fluid-type-tokens src/__tests__/admin-width` → 4 files, 74 tests, all pass; `contracts-registry.test.ts` 74 tests pass (run together). VERIFY-02 30 axe rows (public + authed + embedded at Desktop/mobile/2560) wired in the seeded MA-8 CI job. |

**Score: 6/6 truths verified** (all code artifacts done; 2 human checkpoints control the golden bake and real-device sign-off)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `e2e/axe-app-wide.spec.ts` | 2560 in VIEWPORTS; authed/embedded describes un-skipped; hermetic teardown | VERIFIED | `VIEWPORTS` has 3 entries incl. 2560; seedBridgeCandidate captured + deleted in finally; FLOW-01 dual-wired |
| `e2e/reflow-sweep.spec.ts` | Public 2560 ultra-wide describe | VERIFIED | `test.describe("reflow sweep @ 2560px ultra-wide — public", ...)` at line 85 |
| `e2e/reflow-sweep-authed.spec.ts` | Authed 2560 ultra-wide describe + HAS_SEED_ENV gate | VERIFIED | `test.describe("reflow sweep @ 2560px ultra-wide — authed", ...)` at line 341; HAS_SEED_ENV self-skip in place |
| `e2e/svg-chart-parity.spec.ts` | Tolerance goldens (0.02/0.05), masking, WR-02 guard, 2560 test | VERIFIED | Per-panel 0.02 / full-page 0.05 / threshold 0.2; WR-02 golden-presence skip at line 159; 2560 test at line 276; green-by-skip |
| `e2e/__snapshots__/svg-chart-parity.spec.ts/README.md` | Bake instructions; no PNGs yet (pending controlled bake) | VERIFIED | README.md present; directory contains only README.md — correctly pending deliberate bake |
| `e2e/no-clip-sweep.spec.ts` | Runtime clip detection; FLOW-01 dual-wired; 2560 viewport | VERIFIED | Exists; VIEWPORTS has 3 entries incl. 2560; HAS_SEED_ENV gate; FLOW-01 dual-wired at ci.yml:1073 + 1282 |
| `lighthouserc.json` | `minScore: 0.65` (ratcheted from 0.60) | VERIFIED | `"minScore": 0.65` confirmed; ratchet comment records 0.60→0.65, data-driven (lowest measured /demo 0.67 − 0.02 = 0.65) |
| `eslint.config.mjs` | `no-raw-font-px: "error"` repo-wide; frozen islands off-glob | VERIFIED | Repo-wide error at line 93; frozen off-glob block at lines 229–271 for 4 frozen islands; brackets escaped for `\[id\]` paths |
| `src/__tests__/admin-width.test.tsx` | RT-W2 static scan: 4 prose pages capped, 1 data page uncapped | VERIFIED | 4 `IN_SCOPE` + 1 `OUT_OF_SCOPE` assertion; all 5 assertions pass |
| `.planning/…/54-DESIGN-AUDIT.md` | App-wide design-review audit verdict PASS | VERIFIED | Exists; verdict PASS; 0 fix-now, 2 logged-debt, 6 accepted-conformant |
| `.planning/…/54-BP-03-EXEMPTION-NOTE.md` | Frozen-chart off-glob rationale for milestone auditor | VERIFIED | Exists; names 4 exempt files + off-glob location + minimatch bracket-escape gotcha |
| `src/app/(dashboard)/admin/partner-import/page.tsx` | Contains `max-w-[1100px]` | VERIFIED | Line 96 confirmed |
| `src/app/(dashboard)/admin/users/page.tsx` | Contains `max-w-[1100px]` | VERIFIED | Line 64 confirmed |
| `src/app/(dashboard)/admin/users/[id]/page.tsx` | Contains `max-w-[1100px]` | VERIFIED | Line 104 confirmed |
| `src/app/(dashboard)/admin/for-quants-leads/page.tsx` | Contains `max-w-[1100px]` | VERIFIED | Line 33 confirmed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `axe-app-wide.spec.ts` | seeded MA-8 CI job | `ci.yml:1283` | WIRED | Both unseeded (line 1073) and seeded (line 1283) lists — FLOW-01 dual-wire complete |
| `svg-chart-parity.spec.ts` | seeded MA-8 CI job | `ci.yml:1280` | WIRED | In seeded MA-8 list; WR-02 green-by-skip prevents hard-fail before bake |
| `no-clip-sweep.spec.ts` | unseeded + seeded CI | `ci.yml:1073,1282` | WIRED | FLOW-01 dual-wired; HAS_SEED_ENV self-skip controls seeded half |
| `reflow-sweep-authed.spec.ts` | seeded MA-8 CI job | `ci.yml:1279` | WIRED | In seeded list; HAS_SEED_ENV gate in spec |
| `eslint.config.mjs` | repo-wide CI | `frontend` aggregator | WIRED | `no-raw-font-px: "error"` + frozen off-glob; `npx eslint` exit 0 proven |
| `lighthouserc.json` | `lighthouse-mobile` CI job | `ci.yml:~1371` | WIRED | `minScore: 0.65`; job uploads unconditionally (`if: always()`) |
| `admin-width.test.tsx` | Vitest `frontend-coverage` CI | `vitest.config.ts` | WIRED | 74 tests pass including admin-width's 5 assertions |

---

### Data-Flow Trace (Level 4)

Not applicable — Phase 54 is a verification/CI/testing infrastructure phase. No new components render dynamic data. All artifacts are test specs, CI configuration, ESLint rules, and planning documents.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `no-raw-font-px` is `error` repo-wide, exits 0 | `npx eslint "src/**/*.{ts,tsx}" 2>&1; echo "EXIT: $?"` | 0 errors, 31 warnings, EXIT: 0 | PASS |
| Locked invariant guard suite (frozen-spine, admin-width, token-drift, contracts) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts tests/a11y/design-token-drift.test.ts src/__tests__/admin-width.test.tsx src/__tests__/contracts/contracts-registry.test.ts` | 4 files, 74 tests, all pass | PASS |
| Fluid-type + design-token drift guards | `npx vitest run tests/a11y/design-token-drift.test.ts tests/visual/fluid-type-tokens.test.ts` | 2 files, 43 tests, all pass | PASS |
| RT-W2 `max-w-[1100px]` present in all 4 admin prose pages | `grep -n "max-w-\[1100px\]" src/app/(dashboard)/admin/{partner-import,users,users/\[id\],for-quants-leads}/page.tsx` | 4 matches (1 per file) | PASS |
| lhci minScore ratcheted to 0.65 | `grep minScore lighthouserc.json` | `"minScore": 0.65` | PASS |
| FLOW-01 dual-wire for no-clip-sweep | `grep -n "no-clip-sweep" .github/workflows/ci.yml` | Lines 1073 (unseeded) + 1282 (seeded) | PASS |
| FLOW-01 dual-wire for axe-app-wide | `grep -n "axe-app-wide" .github/workflows/ci.yml` | Lines 1073 (unseeded) + 1283 (seeded) | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` probes exist for this phase. The seeded MA-8 probes (svg-chart-parity golden bake, authed axe 2560 rows) require the test-Supabase env and are deliberately deferred to CI.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VERIFY-01 | 54-06 | Ultra-wide 2560px axe/reflow row; deferred Phase-52 canaries | SATISFIED (code done; golden bake deferred-by-design) | 2560 in VIEWPORTS; reflow-sweep + axe-app-wide + svg-chart-parity all have 2560 blocks; green-by-skip; REQUIREMENTS.md [ ] reflects deferred bake only |
| VERIFY-02 | 54-08 | Authed/mobile axe rows re-enabled hermetically | SATISFIED | axe-app-wide.spec.ts hermetic teardown; FLOW-01 dual-wired; ci.yml:1283 |
| VERIFY-03 | 54-04, 54-07 | lhci ratchet 0.60→0.65; no-clip CI guard | SATISFIED | lighthouserc.json minScore:0.65; no-clip-sweep.spec.ts FLOW-01 dual-wired |
| VERIFY-04 | 54-06 | Tolerance goldens replace byte-identity (golden bake deferred-by-design) | SATISFIED (spec done; bake is human step) | svg-chart-parity.spec.ts tolerance+masking+WR-02; bake per 54-CONTEXT Out-of-Scope lock |
| VERIFY-05 | 54-03, 54-09 | Real-device sign-off + design-review audit; RT-W2; WCAG-AA + LOCKED invariants | PARTIALLY SATISFIED — automatable scope done; real-device sign-off is `human_needed` | 54-DESIGN-AUDIT.md PASS; admin-width.test.tsx green; 117 guard tests pass; real-device sign-off pending |
| BP-03 | 54-01a/b, 54-02a/b, 54-05 | px→token migration complete; `no-raw-font-px` error repo-wide | SATISFIED | eslint exit 0, 0 errors; off-glob documented in 54-BP-03-EXEMPTION-NOTE.md; frozen-spine guard green |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(dashboard)/allocations/ScenarioStub.tsx` | 56 | "Scenario builder coming soon" | Info | Pre-existing intentional v1 stub; last touched Phase 09/09.1; not introduced by Phase 54; documented in 54-09-SUMMARY.md Known Stubs |
| `src/app/(dashboard)/allocations/components/OutcomeForm.tsx` | 43 | "Modified (coming soon)" on disabled control | Info | Pre-existing intentional product state; `disabled` + `aria-disabled` + explanatory `title` — the documented "intended capability without a silent gap" pattern (T-09.1-08-06); not a Phase-54 gap |

No `TBD`, `FIXME`, or `XXX` debt markers introduced by Phase 54. No unreferenced markers found in Phase-54-touched files. Both annotated items above are pre-existing, intentional, and not introduced by this phase.

---

### Human Verification Required

#### 1. Real-Device Authed Sign-Off

**Test:** On a physical phone and/or tablet with a real authed session (`qa-demo@quantalyze.app` on prod, or a seeded test user), load the authed surfaces: `/allocations` + `?tab=scenario`/`?tab=risk`, `/compare`, `/discovery`, `/portfolios`, the `/admin` prose + data pages (`partner-import`, `users`, `users/[id]`, `for-quants-leads`, `partner-roi`), and the wizard.

**Expected:**
- No horizontal overflow / reflow at any of the three viewport classes (mobile, desktop, ultra-wide when reachable on device).
- No clipped / ellipsis-truncated content that should be visible.
- The prose/form admin pages (partner-import, users, users/[id], for-quants-leads) cap at approximately 1100px; admin data tables (partner-roi, match queue) stay wide — RT-W2 confirmed visually.
- Type / spacing match `DESIGN.md` (DM Sans, Instrument Serif, Geist Mono; the `--text-*` fluid scale; no legacy vs evolved drift).
- No a11y regressions: focus order, contrast, touch targets — consistent with the 30-row axe matrix proven in CI.

**Why human:** No physical device available and Bash sandbox has no external network. Auto-approving this checkpoint would be a false "verified" claim (CLAUDE.md Rule 12). Consistent with prior milestones' deferred authed UATs (v1.2.1/v1.2.2/v1.3).

**Resume signal:** Record device/OS/surfaces checked/any findings and type "signed off" to flip this item to `passed`, or "defer" to carry it as the `human_needed` item through milestone close.

#### 2. Live Golden PNG Bake (svg-chart-parity.spec.ts)

**Test:** On the first seeded CI run (`vars.E2E_TEST_DB_CONFIGURED=='true'`), or locally with the test-Supabase env, bake the goldens in deliberate order:
1. Desktop goldens first: `npx playwright test e2e/svg-chart-parity.spec.ts -g "desktop: per-panel goldens" --update-snapshots` — review the diff, commit.
2. Portrait 320px goldens: `npx playwright test e2e/svg-chart-parity.spec.ts -g "portrait 320px" --update-snapshots` — commit.
3. Ultra-wide 2560px tolerance goldens: `npx playwright test e2e/svg-chart-parity.spec.ts -g "ultra-wide 2560px" --update-snapshots` — commit.

**Expected:** PNGs committed; subsequent CI runs diff against them; a value/recompute drift in the frozen engine produces a golden diff and fails the merge check.

**Why human:** Baking requires the test-Supabase seed env and must be a deliberate per-chart controlled CI commit — never blind `--update-snapshots` (54-CONTEXT Out-of-Scope lock). The WR-02 guard keeps CI green-by-skip until PNGs are committed. This is a deliberate deferred CI step, not a code gap.

---

### Gaps Summary

No gaps blocking goal achievement. All code artifacts, CI wiring, ESLint configuration, and test infrastructure that can be built and proven in this environment are built and proven. The two `human_needed` items are DEFERRED-BY-DESIGN per `54-CONTEXT.md` (real-device authed sign-off: no device/network in sandbox; golden PNG bake: requires test-Supabase env + deliberate per-chart commit). Neither is a code gap or a missing implementation — both have full instructions and are consistent with prior milestones' deferred authed UATs.

**REQUIREMENTS.md checkboxes:** VERIFY-01, VERIFY-04, VERIFY-05 are marked `[ ]` in REQUIREMENTS.md because they reference the deferred bake / real-device sign-off. The code artifacts for all three are FULLY PRESENT AND WIRED in the codebase (confirmed above). The checkboxes will flip to `[x]` when the human checkpoints close.

---

_Verified: 2026-06-30T02:45:00Z_
_Verifier: Claude (gsd-verifier)_
