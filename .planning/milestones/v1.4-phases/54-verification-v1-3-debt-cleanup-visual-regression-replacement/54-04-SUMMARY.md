---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 04
subsystem: testing
tags: [lighthouse, lhci, ci, performance-budget, github-actions, ratchet]

# Dependency graph
requires:
  - phase: 48-mobile-adaptive-ui
    provides: "lighthouse-mobile job + lighthouserc.json (mobile formFactor, 5 public URLs, npm run start prod build, minScore 0.60 seeded baseline)"
provides:
  - "lhci report uploaded unconditionally (if: always()) so the measured per-route 3-run-median floor is readable from a GREEN CI run"
  - "lhci categories:performance minScore ratcheted 0.60 -> 0.65 (data-driven: lowest measured route /demo 0.67 minus 0.02)"
  - "_ratchet comment documenting the measured floor, date, and the deferred-to-CI confirm/adjust step"
affects: [verify-03, lighthouse, performance-budget, ci-tuning]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data-driven 'under-actual' performance budget: minScore = lowest measured 3-run-median - 0.02 (mirrors the coverage-ratchet philosophy)"
    - "Re-measure mechanism: upload the lhci artifact unconditionally so the measured floor is observable from green runs, not only failures"

key-files:
  created:
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-04-SUMMARY.md
  modified:
    - .github/workflows/ci.yml
    - lighthouserc.json

key-decisions:
  - "minScore set to 0.65 = documented lowest measured route /demo (0.67, 2026-06-28 single-run baseline) minus 0.02 — pre-resolved checkpoint decision (METHOD locked by user in discuss; conservative fallback option chosen since no fresh CI 3-run median exists in-sandbox)"
  - "lhci artifact upload flipped if: failure() -> if: always() as the 're-measure' mechanism; CI-confirm/adjust deferred to the next CI run (consistent with the phase's build-now/measure-in-CI scope decision)"
  - "Did NOT run lhci in-sandbox (no built app / no network); acceptance is config-only (json/yaml parse + minScore > 0.60 assertion), not an in-sandbox lhci run"

patterns-established:
  - "Performance-budget ratchet records the measured floor + date in an adjacent _ratchet comment, mirroring the coverage-ratchet comment style"

requirements-completed: [VERIFY-03]

# Metrics
duration: 6min
completed: 2026-06-30
---

# Phase 54 Plan 04: lhci Ratchet (VERIFY-03) Summary

**lhci mobile performance budget ratcheted 0.60 -> 0.65 (data-driven floor /demo 0.67 - 0.02), with the lhci report now uploading unconditionally so the next CI run reports the true 3-run-median per-route floor.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-29T23:15Z
- **Completed:** 2026-06-29T23:21Z
- **Tasks:** 2 (the embedded checkpoint:decision was pre-resolved in the execution prompt)
- **Files modified:** 2

## Accomplishments
- Made the lhci `.lighthouseci/` report artifact upload **unconditionally** (`if: failure()` -> `if: always()`) in the `lighthouse-mobile` job, so the per-URL 3-run-median `categories.performance.score` (manifest.json + *.report.json) is readable from a GREEN run — the VERIFY-03 "re-measure" mechanism.
- Ratcheted `categories:performance` `minScore` **0.60 -> 0.65** in `lighthouserc.json` — the data-driven "under-actual" floor (= lowest measured route `/demo` 0.67 minus 0.02).
- Recorded the measured floor, the date, and an explicit **CI-CONFIRM (deferred-to-CI)** step in an adjacent `_ratchet` comment.

## Task Commits

Each task was committed atomically:

1. **Task 1: Make the lhci measured floor readable** - `f52add4f` (ci)
2. **Checkpoint (decision): lowest measured floor** - PRE-RESOLVED in the execution prompt (method locked in discuss; chose the conservative 0.67-baseline fallback since no fresh CI 3-run median is available in-sandbox). No code change for the checkpoint itself.
3. **Task 2: Ratchet minScore to (floor - 0.02)** - `2ca69b35` (perf)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP) committed separately as `docs(54-04)`.

## Files Created/Modified
- `.github/workflows/ci.yml` - `lighthouse-mobile` job: "Upload Lighthouse reports" step changed from `if: failure()` to `if: always()`, with a comment explaining it is the readable-floor / re-measure mechanism. No URL, formFactor, env, or `npm run start` change.
- `lighthouserc.json` - `categories:performance` `minScore` 0.60 -> 0.65; added an `_ratchet` comment recording the measured floor (/demo 0.67), the date (2026-06-30), and the deferred-to-CI confirm step. Diff is minScore + comment only; assertions structure, the 5 PUBLIC-only URLs, `formFactor:"mobile"`, `screenEmulation`, and `startServerCommand:"npm run start"` are untouched.

## Decisions Made
- **minScore = 0.65 (pre-resolved checkpoint).** METHOD was locked by the user in discuss: re-measure the floor, then set `minScore = measured floor - 0.02`. The documented baseline floor is `/demo` at 0.67 (lighthouserc.json `_baseline`), so 0.67 - 0.02 = 0.65 — a real ratchet up from 0.60. This is the checkpoint's "conservative fallback" option (option `conservative-067`), chosen because no fresh CI 3-run median is obtainable in-sandbox.
- **Did NOT run lhci in-sandbox.** No built app and no network in this environment; per the critical constraints, acceptance is config-only (JSON/YAML parse validity + `minScore > 0.60`). The live re-measure happens in CI via the now-unconditional artifact upload.
- **Upload `if: always()`** chosen over adding a separate node-parse "Print measured scores" step (Task 1 offered both options (a) and (b)) — option (a) is simpler and uploads the full report for every run, which is the most robust readable-floor mechanism and preserves the `.lighthouseci/manifest.json` + `*.report.json` shape the research relies on.

## CI-Confirm Note (deferred-to-CI)

The 0.65 floor is derived from the documented **single-run** baseline (/demo 0.67), not the CI **3-run median** this gate actually uses. The next CI run now uploads `.lighthouseci/` unconditionally, so the true per-route 3-run-median floor is readable from the green `lighthouse-mobile` job's `lighthouse-mobile-report` artifact (manifest.json -> `summary.performance` per URL).

**Action for the next CI run:** read the measured per-route medians. If any of the 5 public routes (`/`, `/security`, `/for-quants`, `/browse`, `/demo`) measures **below 0.65**, lower `minScore` to **(that route's measured median - 0.02)** and update the `_ratchet` comment with the measured value + date. If all routes are at/above 0.65, the floor is confirmed (and may be ratcheted higher in a future pass once a durable median lands). This is deferred-to-CI and consistent with the phase's build-now / measure-in-CI scope decision.

## Deviations from Plan

None - plan executed exactly as written (the embedded `checkpoint:decision` was pre-resolved in the execution prompt per the locked discuss method; no auto-fix deviations were needed).

## Issues Encountered
- A `Skill(workflow)` injection (Vercel Workflow SDK best-practices) fired on reading `.github/workflows/ci.yml`. It was a false positive — this is GitHub Actions CI YAML, not the Vercel Workflow SDK, and no SDK code was written. Skill not invoked.
- A GitHub Actions command-injection security warning fired on the ci.yml edit. Reviewed and dismissed: the edit only changed an `if:` condition and added a comment; no untrusted input was introduced into any `run:` command.

## Threat Surface
No new threat surface introduced. The plan's threat register (T-54-04-01 information-disclosure to temporary-public-storage) is mitigated by the unchanged PUBLIC-only URL set and placeholder-only env — the unconditional upload does not add any authed route or `TEST_SUPABASE_*` env to the `lighthouse-mobile` job, so no authed-route report leaks to temporary-public-storage. T-54-04-02 (guessed-not-measured floor) is mitigated by the readable-floor mechanism + the `minScore > 0.60` assertion + the documented CI-confirm step.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- VERIFY-03 lhci ratchet half complete: the budget is raised and the re-measure mechanism is in place. The no-clip CI guard (the other half of VERIFY-03) is a separate Wave-0 plan.
- One deferred-to-CI follow-up: confirm/adjust the 0.65 floor against the first CI 3-run median (see CI-Confirm Note above).

## Self-Check: PASSED

- FOUND: `.github/workflows/ci.yml` (committed `f52add4f`, unconditional `if: always()` upload step present)
- FOUND: `lighthouserc.json` (committed `2ca69b35`, `minScore = 0.65`)
- FOUND: `54-04-SUMMARY.md`
- Commit `f52add4f` (ci) verified in git log
- Commit `2ca69b35` (perf) verified in git log

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
