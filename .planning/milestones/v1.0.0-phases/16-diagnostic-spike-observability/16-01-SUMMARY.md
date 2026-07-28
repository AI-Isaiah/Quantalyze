---
phase: 16-diagnostic-spike-observability
plan: 01
subsystem: testing
tags: [vitest, ci, regression-guard, restore-e2e-fixtures, observ-12]

# Dependency graph
requires:
  - phase: 15-csv-unblock
    provides: PR #111 restored e2e/api-key-flow.spec.ts + scripts/seed-full-app-demo.ts + src/lib/observability.ts (bit-for-bit pre-PR-#90 state) so they exist on disk for this gate to assert against.
provides:
  - File-presence + size-floor + export-shape regression guard for the three OBSERV-12 fixtures.
  - Closes Phase 16 entry-gate plan-checker hard-block on OBSERV-12.
  - Sets the "Vitest variant over a YAML CI step" precedent for future fixture-presence gates in this phase (referenced by 16-PATTERNS.md Phase-Specific Note #5).
affects: [16-07-debug-key-flow-sse, 16-08-vcrpy-cassettes, 16-09-posthog-mobile-audit, 16-10-trigger-rls-audit, 17-design-contract, 18-root-cause-fix, 19-unified-backbone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixture-presence regression gate via Vitest (not YAML CI step) — co-located with src/__tests__/critical-regressions.test.ts"
    - "REQ-ID-prefixed describe block + REQ-ID-prefixed failure messages (`[OBSERV-12]` / `OBSERV-12:`)"
    - "byteSize floor with ~20% drift tolerance + recordedBytes annotation"
    - "Combined statSync existence assertion + readFileSync export grep for API-shape regressions"

key-files:
  created:
    - "src/__tests__/observ12-fixtures-presence.test.ts (60 LOC, 4 test cases)"
  modified: []

key-decisions:
  - "Adopted plan-recommended Vitest variant over a separate .github/workflows/ci.yml step. Rationale: existing `npm test` step in the frontend CI job already invokes the full Vitest suite via vitest.config.ts include glob `src/**/*.test.{ts,tsx}` — adding a YAML step would be redundant."
  - "Single test-only commit (`test(16-01): ...`) rather than RED/GREEN split. The plan's purpose is the regression test itself protecting already-restored files; there is no separate implementation to land in a feat() commit. The conventional GREEN step (PR #111) already merged on 2026-05-01T06:25:59Z (commit 8fb4159)."

patterns-established:
  - "Pattern 1: Phase-16 fixture-presence gates use Vitest auto-discovery, not new YAML steps. Future Phase 16 plans (notably Plan 8 vcrpy cassettes) should reuse this pattern to keep CI surface flat."
  - "Pattern 2: Each test asserts both filesystem existence (statSync) AND a minimum-byte floor calibrated to ~80% of recorded planning-time size, allowing routine line-ending/whitespace drift while blocking catastrophic deletion or stub replacement."

requirements-completed: [OBSERV-12]

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 16 Plan 01: OBSERV-12 Fixture-Presence Gate Summary

**Vitest regression guard that fails CI any time e2e/api-key-flow.spec.ts (9861 B), scripts/seed-full-app-demo.ts (59393 B), or src/lib/observability.ts (927 B + checkStuckNotifications export) is deleted, truncated below ~80% of recorded size, or has its public export shape removed — closes Phase 16 entry-gate plan-checker hard-block.**

## Performance

- **Duration:** ~2 min (actual wall-clock between start of work and final commit)
- **Started:** 2026-05-01T09:28:49Z
- **Completed:** 2026-05-01T09:31:06Z
- **Tasks:** 1 (plan has only Task 1; type=auto, tdd=true)
- **Files modified:** 1 created, 0 edited

## Accomplishments

- Created `src/__tests__/observ12-fixtures-presence.test.ts` — 60 LOC, 4 Vitest cases (3 file-size + 1 export-grep), `[OBSERV-12]` describe block, `OBSERV-12:`-prefixed failure messages.
- Verified targeted run: `npx vitest run src/__tests__/observ12-fixtures-presence.test.ts` → 4 passed, 1 file passed, 605–765 ms total (well under the 100 ms-per-test must-have target; the slow part is environment + setup, not the assertions which run in 2 ms).
- Verified Vitest auto-discovery: file is matched by `vitest.config.ts` `include: ["src/**/*.test.{ts,tsx}", ...]` and runs as part of `npm test` (the existing frontend-CI step) without any workflow edit.
- Negative sanity check executed: temporarily renamed `src/lib/observability.ts` → 2 of 4 cases failed with `OBSERV-12:`-prefixed messages (size floor + export grep both fired). File restored bit-for-bit (927 B preserved, mtime unchanged from PR #111).
- All plan acceptance-criteria greps pass: 6 occurrences of `OBSERV-12` (need ≥5), 3 of `checkStuckNotifications` (need ≥2), 3 of the calibrated `minBytes` thresholds (8000 / 50000 / 700).
- Zero modifications to `.github/workflows/ci.yml` (confirmed via `git diff --stat`).

## Task Commits

1. **Task 1: Write OBSERV-12 fixture-presence regression test** — `e205773` (`test(16-01): add OBSERV-12 fixture-presence regression gate`)

_Note:_ TDD model collapsed to a single `test(...)` commit because the entire Plan 01 deliverable is the regression test itself; the conventional GREEN/feat step is the already-merged PR #111 (commit `8fb4159`, merged 2026-05-01T06:25:59Z) which placed the three fixtures on disk before this run started.

## Files Created/Modified

- `src/__tests__/observ12-fixtures-presence.test.ts` — Vitest regression guard for the three OBSERV-12 fixtures. Loops a `FixtureSpec[]` array (path + minBytes + recordedBytes) and asserts each is a regular file at or above the ~80% byte floor. Adds a fourth case that `readFileSync`s `src/lib/observability.ts` and regex-matches `/export\s+(async\s+)?function\s+checkStuckNotifications/` to catch API-shape regressions even if file size is preserved by unrelated additions. Failure messages all start with `OBSERV-12:` and name the offending file so a future bisect-style debugger can grep CI logs directly.

## Decisions Made

- **Vitest over YAML CI step (plan-recommended D-Plan-1):** The existing `frontend` CI job's `npm test` step already discovers `src/__tests__/*.test.ts` via the include glob. Adding a separate `.github/workflows/ci.yml` step would be a duplicated assertion against the same filesystem and would cost a CI seat-second on every run. Plan was explicit (PATTERNS.md Phase-Specific Note #5) and code matches.
- **Single `test(...)` commit instead of RED→GREEN split:** Plan's `tdd="true"` flag was honoured semantically — the test is the plan — but mechanically there is no separate "implementation" code to ship inside this plan. The GREEN-equivalent (the three fixtures actually being on disk) was satisfied by PR #111 prior to this run. A noop `feat()` commit would have been ceremonial drift.
- **Followed plan-supplied byte floors verbatim** (8000 / 50000 / 700) rather than re-deriving. Plan author already calibrated to ~80% of recorded sizes (9861 / 59393 / 927) which matches industry-standard regression-floor practice and leaves room for line-ending normalisation.

## Deviations from Plan

None — plan executed exactly as written. The single conceptual decision (single commit vs RED→GREEN split for a fixture-presence test) is documented above under Decisions Made and was anticipated by the plan's framing (the plan describes one Vitest file as the deliverable; no "implementation" file is named).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Test runs purely against the local filesystem; CI has no new env vars, secrets, or runner permissions to provision.

## Next Phase Readiness

- **Wave 1 unblocked:** OBSERV-12 entry-gate hard-block now closed. Phase 16 Plan 7 (`/api/debug-key-flow` SSE) and Plan 8 (vcrpy cassettes), both of which build on the three fixtures this gate protects, can proceed without the plan-checker rejecting their first commit.
- **Phase 16 Plan 8 cassette-presence gate:** When that plan adds 12 vcrpy YAML cassettes under `analytics-service/tests/cassettes/`, the same Vitest-fixture-presence pattern can be replicated (or a Python-side `pytest` analog can mirror the technique — see PATTERNS.md "Pattern 2" note above).
- **Cross-phase impact:** Phase 17 (DESIGN.md trust-tier), Phase 18 (root-cause fix + Python redact mirror), and Phase 19 (unified backbone) all rely indirectly on these fixtures via e2e replay flows; the gate now protects them too without any further work.
- **No remaining blockers** for the Wave 2/3 plans in this phase that this agent's worktree was responsible for.

## Self-Check: PASSED

- File `src/__tests__/observ12-fixtures-presence.test.ts` — FOUND
- Commit `e205773` — FOUND on branch `worktree-agent-a1599a1d3930c91dc`
- Vitest run on the new file — 4 passed / 0 failed (confirmed twice: pre-commit and post-restore)
- `.github/workflows/ci.yml` — UNCHANGED (`git diff --stat` empty)

---
*Phase: 16-diagnostic-spike-observability*
*Plan: 01*
*Completed: 2026-05-01*
