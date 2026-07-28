---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 09
subsystem: ui
tags: [design-review, DESIGN.md, BP-03, frozen-spine, RT-W2, WCAG-AA, VERIFY-05, audit, human_needed]

# Dependency graph
requires:
  - phase: 54-03
    provides: RT-W2 admin prose/form max-w caps + admin-width.test.tsx (confirmed in the audit)
  - phase: 54-05
    provides: no-raw-font-px error repo-wide + the frozen-chart off-glob (documented in the exemption note)
  - phase: 54-08
    provides: re-enabled authed + mobile + 2560 axe rows (the WCAG-AA evidence the audit cites, not asserts blind)
provides:
  - "App-wide design-review audit vs the locked DESIGN.md — verdict PASS (54-DESIGN-AUDIT.md)"
  - "BP-03 frozen-chart off-glob exemption note for the milestone auditor (54-BP-03-EXEMPTION-NOTE.md)"
  - "Real-device authed sign-off recorded as a human_needed VERIFICATION item (54-VERIFICATION.md)"
affects: [milestone-v1.4-audit, VERIFY-05, BP-03, RT-W2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static (code-as-spec) design-review audit when no browser/network is available — review touched + high-traffic surfaces against DESIGN.md, cite green guard/axe CI as evidence rather than asserting the WCAG-AA floor blind."
    - "BP-03 'error repo-wide incl. the frozen EquityChart' is honestly satisfied as 'error EXCEPT documented frozen-chart islands (off-glob)', because editing a FROZEN_ISLANDS file reds the frozen-spine guard (higher-priority LOCK)."

key-files:
  created:
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-DESIGN-AUDIT.md
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-BP-03-EXEMPTION-NOTE.md
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-VERIFICATION.md
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-09-SUMMARY.md
  modified: []

key-decisions:
  - "Ran VERIFY-05's design-review portion as a STATIC conformance review (no browser/network in this sandbox) — reviewed the Phase-54-touched + high-traffic surfaces as code against the locked DESIGN.md."
  - "Verdict PASS: 0 fix-now folds (no in-scope conformance violation found), 2 logged-as-debt (pre-existing 'coming soon' v1 stubs; raw font-size:Npx in plain CSS — out of the JSX no-raw-font-px lint scope), 6 accepted-conformant."
  - "Did NOT touch any source code — every locked guard + eslint was already green and stays green; no per-task code commit (the artifacts are .planning/ docs, gitignored, local-only by design)."
  - "Recorded the real-device authed sign-off as human_needed (NOT auto-approved) despite auto_advance=true: it cannot be automated (no device/network) and auto-approving would be a false 'verified' claim (CLAUDE.md Rule 12 fail-loud)."

patterns-established:
  - "Honest-status checkpoint handling: a blocking human-verify that is physically un-automatable in the sandbox is recorded as human_needed in VERIFICATION.md, not auto-approved, even under auto_advance."

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-06-30
---

# Phase 54 Plan 09: App-wide Design-Review Audit + BP-03 Exemption Note + Real-Device Sign-off (VERIFY-05) Summary

**Ran the app-wide design-review audit as a STATIC conformance review against the locked DESIGN.md (verdict PASS — 0 fix-now, 2 logged-debt, 6 accept; RT-W2 + token spine + WCAG-AA all confirmed with green-CI evidence), documented the BP-03 frozen-chart off-glob exemption for the milestone auditor, and recorded the real-device authed sign-off as a `human_needed` VERIFICATION item — no source changed, all locked guards + eslint stay green.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-30T02:14Z
- **Completed:** 2026-06-30T02:34Z
- **Tasks:** 2 auto + 1 checkpoint (recorded as human_needed)
- **Files modified:** 0 source; 4 `.planning/` docs created (gitignored, local-only by design)

## Accomplishments

- **Task 1 — App-wide design-review audit (`54-DESIGN-AUDIT.md`), verdict PASS.** Reviewed the
  allocator journey, factsheet, admin (incl. the RT-W2 caps), wizard, public/marketing, and
  portfolios as code against the locked `DESIGN.md`. Findings: **0 fix-now** (no in-scope
  conformance violation), **2 logged-as-debt** (pre-existing intentional "coming soon" v1 stubs;
  raw `font-size:Npx` in plain CSS — out of the JSX `no-raw-font-px` lint scope, on-scale, zero
  visual drift), **6 accepted-conformant** (type spine byte-identical, fonts, anti-decoration,
  color tokens, RT-W2 caps, WCAG-AA floor, `@container` guard). Confirmed the RT-W2 admin caps
  render correctly (cross-checked `admin-width.test.tsx`, green).
- **Task 2 — BP-03 exemption note (`54-BP-03-EXEMPTION-NOTE.md`).** Documents that
  `no-raw-font-px` is `error` everywhere EXCEPT the 4 documented frozen-chart islands
  (EquityChart + TimeSeriesChart/HistogramChart/MasterBrush), exempted via the `eslint.config.mjs`
  off-glob because editing a `FROZEN_ISLANDS` file reds the frozen-spine guard (a higher-priority
  LOCK). Names the 4 files, the off-glob location, the `[id]` bracket-escape gotcha, WorstDrawdowns
  + test fixtures coverage, and the green `npx eslint` proof — so the milestone audit reads BP-03
  as MET, not as an unmet gap.
- **Task 3 — Real-device authed sign-off recorded as `human_needed`** in `54-VERIFICATION.md`
  (NOT attempted; no device/network in this sandbox). Carries full human instructions + the
  resume signal, consistent with prior milestones' deferred authed UATs.
- **WCAG-AA floor cited with evidence, not asserted blind:** the audit cites 54-08's re-enabled
  authed + mobile + 2560 axe rows (30 rows in the seeded MA-8 CI job) as the proof.
- **All locked invariants confirmed green** (57 guard tests: frozen-spine, admin-width,
  design-token-drift, fluid-type-tokens, @container); `npx eslint "src/**/*.{ts,tsx}"` exit 0.

## Task Commits

1. **Task 1: App-wide design-review audit** — no code commit (artifact is `54-DESIGN-AUDIT.md`,
   under gitignored `.planning/`; no source changed). Verified via the plan's automated check
   (`test -f … && grep DESIGN.md && grep RT-W2/width` → PASS).
2. **Task 2: BP-03 exemption note** — no code commit (artifact is `54-BP-03-EXEMPTION-NOTE.md`,
   gitignored). Verified via the plan's automated check (`grep EquityChart && grep FROZEN` → PASS).
3. **Task 3: Real-device sign-off** — recorded as `human_needed` in `54-VERIFICATION.md`; not a
   code task.

**No per-task code commits:** this plan is an audit + documentation plan. The three artifacts live
under `.planning/` (gitignored — local-only by design, matching the 54-03 / 54-05 SUMMARY
precedent). No `src/**` byte changed, so there is nothing to stage, and every locked guard +
eslint was already green and stays green.

## Files Created/Modified

- **Created** `.../54-DESIGN-AUDIT.md` — app-wide static design-review audit; verdict PASS; per-finding severity + disposition.
- **Created** `.../54-BP-03-EXEMPTION-NOTE.md` — frozen-chart off-glob exemption rationale for the milestone auditor.
- **Created** `.../54-VERIFICATION.md` — VERIFY-05 verification trail; carries the real-device sign-off as `human_needed`.
- **Created** `.../54-09-SUMMARY.md` — this summary.
- **Modified:** none (no source code touched).

## Audit Verdict (headline)

**PASS.** The v1.4 UI conforms to the locked `DESIGN.md` on every code-reviewable dimension —
type spine (byte-identical fixed tokens + the fluid `--text-*` spine), fonts, color tokens,
spacing ladder, anti-decoration rules, RT-W2 admin width caps, and the WCAG-AA floor. No fix-now
conformance violation on the Phase-54-touched surfaces. Two pre-existing larger items logged as
debt (not silently dropped). The real-device authed sign-off remains a documented `human_needed`
checkpoint.

| Finding count | |
|---|---|
| Fix-now (folded) | 0 |
| Logged as debt | 2 (F8 intentional "coming soon" v1 stubs; F9 raw `font-size:Npx` in plain CSS, out of lint scope) |
| Accepted-conformant | 6 (type spine, fonts, anti-decoration, color tokens, RT-W2, WCAG-AA, @container) |
| Blocking | 0 |

## Decisions Made

- See `key-decisions` frontmatter. Headline: ran the design-review portion of VERIFY-05 NOW as a
  static code-as-spec review (no browser/network), cited green CI as the WCAG-AA evidence, found 0
  in-scope conformance violations (so 0 folds — no manufactured changes), and honestly recorded the
  real-device sign-off as `human_needed` rather than auto-approving a blocking checkpoint that
  physically cannot run here (CLAUDE.md Rule 12).

## Deviations from Plan

None — plan executed as written. (No fix-now folds were needed because the static audit found no
in-scope conformance violation; the 2 logged-debt items are pre-existing and out of Phase-54
scope. This is the planned "fold actionable findings or log them" path, with the actionable count
landing at 0.)

## Known Stubs

Two pre-existing, intentional, documented v1 stubs were observed during the audit and logged as
debt (audit finding F8) — **NOT introduced or altered by this plan or by the Phase-54 px→token
migration** (last touched in Phase 09/09.1 per `git log`):

| Stub | File:line | Reason / future resolution |
|------|-----------|----------------------------|
| "Scenario builder coming soon" | `src/app/(dashboard)/allocations/ScenarioStub.tsx:56` | v1-fallback for the V2-flag-gated scenario tab; the real builder ships behind `strategy.ui_v2`. Intentional, not a Phase-54 gap. |
| "Modified (coming soon)" | `src/app/(dashboard)/allocations/components/OutcomeForm.tsx:43` | Deliberately `disabled` + `aria-disabled` segmented-control option with explanatory `title` — the documented "intended capability without a silent gap" pattern (T-09.1-08-06). |

Neither prevents Phase 54's goal; both are intentional product states tracked for the future V2
scenario-tab rollout, documented here for the verifier.

## Issues Encountered

None. (The `auto_advance=true` flag would auto-approve a normal `human-verify` checkpoint, but the
real-device sign-off is physically un-automatable here — recorded as `human_needed` instead of a
false "verified", per CLAUDE.md Rule 12.)

## User Setup Required

None for the audit/docs. The real-device authed sign-off (Task 3) is a `human_needed` action —
full instructions in `54-VERIFICATION.md` (load the authed surfaces on a real phone/tablet,
confirm no clip/reflow/over-stretch/a11y regressions vs the matrix, record device + findings).

## Next Phase Readiness

- ROADMAP success criterion 4 (app-wide design-review audit passes; WCAG-AA + LOCKED invariants
  intact) and criterion 5 (RT-W2 confirmed) are met by the audit + RT-W2 confirmation.
- BP-03's frozen-chart exemption is documented so the milestone auditor reads BP-03 as MET.
- The single deferred item — real-device authed sign-off — is encoded as `human_needed`, not
  silently dropped.
- No source changed; all locked guards + eslint green.

## Self-Check: PASSED
- FOUND: 54-DESIGN-AUDIT.md (DESIGN.md + RT-W2 coverage verified)
- FOUND: 54-BP-03-EXEMPTION-NOTE.md (EquityChart + FROZEN coverage verified)
- FOUND: 54-VERIFICATION.md (real-device sign-off recorded as human_needed)
- VERIFIED: 57 locked-guard tests pass; `npx eslint "src/**/*.{ts,tsx}"` exit 0 (0 errors)
- VERIFIED: no source code changed (0 files modified under src/)

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
