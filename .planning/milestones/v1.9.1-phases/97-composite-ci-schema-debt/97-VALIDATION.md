---
phase: 97
slug: composite-ci-schema-debt
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-12
---

# Phase 97 — Validation Strategy

> LAST phase. For this phase the CI GATES ARE the tests. The research VERIFIED
> every CI-02 sub-item against `main` — half are already closed and are DROPPED
> with evidence, so the planner only plans real work. This phase MUST make the
> milestone→main PR's `python` (#610) and `sql-function-snapshot` checks green
> (the Phase-95/96 migration drift only exists on the branch → the hermetic
> snapshot gate WILL fail on the ship PR without the regen).

## Locked decisions (autonomous, 2026-07-12)
1. **CI-01 fix = per-run-`job_id` claim scoping** (root cause), NOT a bigger
   serial lane. PR #610 already parallelizes + ships an `xdist_group("shared_test_db")`
   serial lane, but is HELD because the lane serializes without ISOLATING — the
   live fence tests do a GLOBAL claim (`_claim_one` → `res.data[0]`) and assert
   `== own job_id`, which breaks on foreign rows from interleaved grouped DB
   tests. Scope the claim/assert to the test's own `job_id`.
2. **Adopt #610 as a REFERENCE, re-apply its parallelization changes as fresh
   commits on the milestone branch** (`gsd/v1.9.1-composite-onboarding-hardening`)
   + layer the isolation fix on top — do NOT cherry-pick (avoids conflict
   mechanics) and do NOT land #610 separately to main (the milestone ships via
   ONE PR; #610 gets closed as absorbed at ship time). NO git branch ops in the
   executor — re-apply via edits.
3. **CI-02.1 (TODOS.md L165, NOT GitHub #165):** the 3 deferred tests skip for
   `httpx.ReadTimeout` under load — a DIFFERENT root cause than #610's isolation
   gap, so CI-01's fix does NOT make them safe. Try re-enabling behind the
   EXISTING `_rpc_retry_timeout` guard IF that demonstrably stabilizes them;
   otherwise RE-JUSTIFY the deferral with the ReadTimeout evidence. Either
   satisfies CI-02.1. Default to re-justify if re-enabling would re-introduce
   load-timeout flake right before the milestone ship. NON-BLOCKING.
4. **CI-02.2 snapshots = regenerate exactly 3 owed** (`npm run schema:functions`):
   `set_compute_job_progress` (missing, Phase 95), `cleanup_abandoned_wizard_drafts`
   (missing, Phase 96), `set_wizard_composite_members` (stale, Phase-94 RT-1
   CREATE OR REPLACE). The regen diff MUST be bounded to exactly those 3 files.
5. **VERIFY-AND-DROP (already closed on the branch — do NOT re-do, cite evidence):**
   - The roadmap-named snapshots `enforce_strategy_keys_owner_coherence` /
     `sync_strategy_analytics_status` ALREADY have snapshots (v1.9 #607).
   - `audit-coverage.test.ts` + `audit-fanout-integration.test.ts` are GREEN
     (28 passed); the `stitch_composite` enqueue already has `logAuditEventAsUser`;
     the `strategy_keys` mock already exists (fanout ~:811).

## Test Infrastructure
| Property | Value |
|----------|-------|
| **Frameworks** | pytest + pytest-xdist + pytest-cov (analytics-service, pinned Py3.12.13 venv); vitest 4.x; tsx (hermetic snapshot gate) |
| **Config** | `analytics-service/pytest.ini`, `.github/workflows/ci.yml`, `.github/workflows/sql-function-snapshot.yml` |
| **Offline quick** | `npm run schema:functions:check` + `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/audit-fanout-integration.test.ts` |
| **Live full** | `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup` (needs the test Supabase project — CI is the runtime gate) |

## Per-Requirement Test Map
| Req | Behavior | Type | Fails-without-fix |
|-----|----------|------|-------------------|
| CI-01 | python suite green under `-n auto`; fence claim scoped to own job_id | integration (live-DB) + a NEW offline decoy-foreign-row regression | live fence fails on foreign `data[0]`; decoy fails offline without the scoping |
| CI-02.1 | 3 TODOS-L165 tests re-enabled behind `_rpc_retry_timeout` OR deferral re-justified | integration or doc | `ReadTimeout` unless guarded |
| CI-02.2 snapshot | `schema:functions:check` green; exactly 3 owed regenerated | hermetic gate | 3 owed files (2 missing, 1 stale) |
| DROP | audit-coverage + fanout + 2 roadmap-named snapshots | verify-and-drop | already green/present — cite, don't redo |

## Wave 0 (blocker)
- [ ] **Decoy-foreign-row regression** in `test_compute_jobs_fencing.py`: insert an unrelated pending `compute_jobs` row, assert the scoped claim still returns the test's OWN job — so CI-01's isolation is provable OFFLINE and fails without the fix (otherwise the only signal is a live CI run).

## Sign-Off
- [ ] #610's `python` check green (per-run-job_id isolation + decoy regression) — adopted-as-reference, absorbed into the milestone branch
- [ ] `sql-function-snapshot` green: exactly 3 owed snapshots regenerated, diff bounded
- [ ] CI-02.1 re-enabled-behind-guard OR deferral re-justified with evidence
- [ ] Closed items verified-and-dropped with grep evidence in the phase record (not re-done)
- [ ] `nyquist_compliant: true`

**Approval:** approved (autonomous, 2026-07-12)
