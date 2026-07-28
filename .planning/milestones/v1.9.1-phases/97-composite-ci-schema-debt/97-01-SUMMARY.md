---
phase: 97-composite-ci-schema-debt
plan: 01
subsystem: testing
tags: [pytest, pytest-xdist, compute_jobs, fencing, claim-token, ci, supabase]

# Dependency graph
requires:
  - phase: v1.9-multi-key-composite
    provides: compute_jobs claim-token fence (mig 117) + shared test Supabase project wiring
provides:
  - Per-run-job_id claim scoping across all 12 _claim_one sites + the 1 unscoped batch site
  - Offline decoy-foreign-row regression (repro-gate — proves isolation without a live DB)
  - PR #610's pytest-xdist parallelization re-applied as fresh edits (ci.yml, Makefile, pytest.ini, requirements-dev, conftest)
affects: [97-02, 97-03, milestone-ship-python-check]

# Tech tracking
tech-stack:
  added: [pytest-xdist]
  patterns:
    - "Own-job_id claim scoping: _claim_one(*, want_job_id) filters the claim batch to the test's own seeded row, removing the res.data[0] global-queue assumption"
    - "Content-based xdist_group pinning: conftest pytest_collection_modifyitems scans module source for shared-test-DB sentinels and pins matches to a single worker"
    - "Offline stub repro-gate: SimpleNamespace-backed admin stub proves the scoping is load-bearing with no live DB"

key-files:
  created: []
  modified:
    - analytics-service/tests/test_compute_jobs_fencing.py
    - analytics-service/tests/conftest.py
    - analytics-service/pytest.ini
    - analytics-service/requirements-dev.txt
    - analytics-service/Makefile
    - .github/workflows/ci.yml

key-decisions:
  - "Scope WHICH row is claimed, never WHETHER the 40001 fence raises — all serialization_failure assertions left byte-equivalent (T-97-03)"
  - "Only 1 of the 9 batch-claim sites (G21-001) needed scoping; the other 8 were already own-row-scoped via the ours = set(...) idiom"
  - "pytest-xdist installed and verified locally (3.8.0 already in venv); full offline suite green under -n auto --dist loadgroup in 12.01s"
  - "Plan-checker WARNING-2 folded in: the Task-3 verify's dead MK_LINE grep was replaced with a real byte-identity comparison of the flag substring across ci.yml and Makefile"

patterns-established:
  - "Pattern: parallelism-safe live-DB tests assert against their own seeded job_id, never the head of the global claim queue"
  - "Pattern: DB-touching test modules are auto-grouped onto one xdist worker by content scan, not a hardcoded file list"

requirements-completed: [CI-01]

# Metrics
duration: ~35min
completed: 2026-07-12
---

# Phase 97 Plan 01: CI-01 Parallelism-Safe Fence Tests Summary

**Per-run-job_id claim scoping across all 21 live claim/assert sites in `test_compute_jobs_fencing.py` + an offline decoy-foreign-row repro-gate, with PR #610's pytest-xdist parallelization re-applied as fresh edits — unblocking the milestone→main ship PR's `python` check.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-12T04:50:53Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Removed the `res.data[0]` global-queue assumption from the live fence suite: a foreign pending `compute_jobs` row (from an interleaved grouped DB test or the concurrent e2e job) can no longer break any fence assertion.
- Added an offline decoy-foreign-row regression that provably fails when the scoping is neutered and passes with it — the local repro-gate, no live DB required.
- Re-applied PR #610's `-n auto --dist loadgroup` parallelization as fresh commits on the milestone branch (no branch ops, no cherry-pick, no VERSION/CHANGELOG churn). Full offline suite: **3614 passed, 93 skipped in 12.01s** under the pinned interpreter (648% CPU — genuine parallelism).

## Task Commits

Each task was committed atomically:

1. **Task 1: Decoy-foreign-row regressions (RED)** — `bc1cd0b2` (test)
2. **Task 2: Per-run-job_id claim scoping (GREEN)** — `46b0fcea` (fix)
3. **Task 3: Re-apply #610 parallelization** — `8e5751a1` (chore)
4. **Red-team F-1 hardening: `want_job_id` required + legacy arm deleted** — `dc246899` (harden)

_Task 1/2 form the TDD RED→GREEN pair (the plan structured the decoy test and its scoping fix as separate commits). Commit 4 was added post-review (see below)._

## RED → GREEN evidence (repro-gate)

- **RED (before Task 2, against the unscoped helper):**
  `test_claim_one_decoy_foreign_row_offline` FAILED with
  `TypeError: _claim_one() got an unexpected keyword argument 'want_job_id'`
  (`1 failed, 1 skipped, 41 deselected`). Exit non-zero — satisfies Task 1's `test $? -ne 0`.
- **GREEN (after Task 2):** `-k decoy` → `1 passed, 1 skipped`; whole file → `15 passed, 28 skipped` (live tests skip locally without `SUPABASE_TEST_URL`); the `return res.data[0] if res.data else None` helper shape is gone.

## Scoped sites (12 `_claim_one` + 9 batch)

**12 `_claim_one` call sites — all threaded with `want_job_id=job_id`:**

| Original line | Test | Note |
|---|---|---|
| 713 | test_claim_stamps_claim_token | assertion already `== job_id` |
| 749 | test_mark_compute_job_failed_writes_error_kind | — |
| 790 | test_reclaim_invalidates_claim_token | assertion kept (`is not None` now means "our job") |
| 941 | test_late_mark_done… (skipped) | scoped anyway (CI-02.1) |
| 955 | test_late_mark_done… (skipped) | scoped anyway |
| 1024 | test_late_mark_failed… (skipped) | scoped anyway |
| 1034 | test_late_mark_failed… (skipped) | scoped anyway |
| 1082 | test_mark_done_without_token_raises_strict | **was discarding result** — now captures + asserts `claimed["id"] == job_id` |
| 1382 | test…perkind | — |
| 1459 | test_late_mark_done_after_w2_completed (skipped) | scoped anyway |
| 1473 | test_late_mark_done_after_w2_completed (skipped) | scoped anyway |
| 2555 | test_advance_sync_cursor_fence_owned_orphan_backcompat | — |

`@pytest.mark.skip` decorators/reasons untouched (that is plan 97-03's surface).

**9 batch-claim sites — audited; 1 scoped, 8 already own-row-safe:**

| Original line | Test | Disposition |
|---|---|---|
| 1706 | G21-001 test_claim_includes_failed_retry_when_backoff_elapsed | **SCOPED** — `assert len(claimed) == 1` was a global-batch count; now `ours = [c for c in claimed if c["id"] == job_id]; assert len(ours) == 1` (intent preserved: our elapsed-backoff row enters the pool) |
| 1756 | G21-002 | already safe — `ours = [c for c in claimed if c["id"] == job_id]` |
| 1868 | G21-003 | already safe — membership checks (`low not in`, `normal in claimed_ids`) |
| 1948 | G21-004 | already safe — `ours = claimed_ids & {id_a, id_b}` |
| 2037 | H-1238 tie-break | already safe — `ours = claimed_ids & {id_a, id_b}` |
| 2151 | H-1235 carve-out positive | already safe — `ours = all_claimed & {id_a, id_b}` |
| 2268 | H-1235 carve-out negative | already safe — `ours = claimed_ids & {id_a, id_b}` |
| 2394 | M-1133 A low-when-empty | already safe — `low_id in {c["id"] for c in claimed}` |
| 2481 | M-1133 B low-throttled | already safe — membership (`low not in`, `normal in claimed_ids`) |

`test_concurrent_claim_disjoint_under_skip_locked` (the `ours = set(job_ids)` model) was NOT touched, as instructed.

## Security pin (T-97-03) — verified

Scoping changed WHICH row is claimed, never WHETHER the fence raises. The 40001 / `serialization_failure` fence-raise assertions are byte-equivalent: 57 occurrences of `40001`/`serialization_failure` remain, and `git show 46b0fcea | grep '^-'` for any fence-raise token returned NONE (no fence-raise line removed or altered).

## #610 re-applied files (fresh edits, no branch ops)

1. `.github/workflows/ci.yml` — `pytest -n auto --dist loadgroup …` + 7-line xdist comment; `env:` block untouched.
2. `analytics-service/Makefile` — same flag insertion, **byte-identical** to ci.yml.
3. `analytics-service/pytest.ini` — `markers = xdist_group: …`.
4. `analytics-service/requirements-dev.txt` — `pytest-xdist` (unpinned) + 4-line comment, after `pytest-mock`.
5. `analytics-service/tests/conftest.py` — `import functools`, `_DB_MODULE_SENTINELS`, `@functools.lru_cache _is_shared_db_module`, `pytest_collection_modifyitems` adding `xdist_group("shared_test_db")`.

**Byte-identity check (WARNING-2 fix):** the flag substring
`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`
is identical in ci.yml and Makefile and matches the expected pattern exactly. `--cov-fail-under=80` present in both (T-97-02).

**Grouped-module inventory (16 DB-touching test modules of 152 total — small set, parallelism preserved):**
`test_compute_jobs_fencing`, `test_compute_similarity_sql`, `test_csv_daily_returns_dualaxis_live`, `test_csv_daily_returns_perkey_rls_live`, `test_drain_semantics`, `test_feedback_engine`, `test_job_worker`, `test_match_engine`, `test_match_integration`, `test_migration_108_idempotent`, `test_persist_csv_daily_returns_live`, `test_resend_correlation_rls`, `test_sync_trades_preserves_fills`, `test_transition_rpc`, `test_trigger_rls_audit`, `test_upsert_strategy_analytics_series_batch_privilege`. (`conftest.py` matches the grep on its own sentinel literals but is not a collected test item, so it is not grouped.)

## Red-team F-1 hardening (post-review, commit `dc246899`)

Fresh-context Fable red team confirmed the scoping is a sound refactor (no vacuous passes, 40001 invariant intact) and flagged one LOW hardening worth folding, since the phase's point is a PERMANENT flake fix that cannot silently revert:

- **Foot-gun:** the offline decoy guards the `_claim_one` HELPER, but a future edit dropping `want_job_id=job_id` at any of the 12 call sites would silently revert that site to the old `data[0]` global-head behavior (foreign-row flake) and stay green offline. The legacy None-default arm invited exactly that call form.
- **Fix:** `want_job_id` is now a REQUIRED keyword-only param (no default); the dead legacy `rows[0] if rows else None` global-head fallback is DELETED. Grep-confirmed ZERO `_claim_one(` callers outside this file and all 12 in-file callers supply `want_job_id`, so the arm was dead code. A future omitting call now fails at call time with `TypeError` instead of silently reverting.
- **Decoy update:** the deleted legacy arm's "returns the foreign row" demonstration is inlined as the old global-head logic (`stub.rpc(...).execute().data[0]` → foreign row) so the scoped-vs-unscoped distinction stays visible, plus a `pytest.raises(TypeError)` on `_claim_one(stub, "decoy-offline")` that pins the foot-gun closed.
- **Verify:** all 12 sites still pass (already supply `want_job_id`); `-k decoy` green (1 passed, 1 skipped); full file green offline; full parallel suite `3614 passed, 93 skipped` under `-n auto --dist loadgroup`; this round's diff added/removed ZERO `40001`/`serialization_failure` lines (fence assertions untouched).

## Decisions Made
- **MK_LINE dead-variable cleanup (plan-checker WARNING-2):** replaced the plan's dead `MK_LINE` grep (which never matched the Makefile's `$(PYTEST)` uppercase token and was never referenced) with a real byte-identity string comparison of the flag substring across ci.yml and Makefile. Machine-check now matches the byte-identity intent.
- **pytest-xdist local verification:** the plugin was already present (3.8.0) in `.venv`; no `pip` in the venv (`No module named pip`), but the install was unnecessary. Ran the parallel invocation locally rather than deferring to CI-only.

## Deviations from Plan

None affecting scope — plan executed as written. The only judgment call was the WARNING-2 MK_LINE cleanup, which the plan explicitly instructed to fold in.

## Issues Encountered
- The plan's Task-1 verify uses `-k "decoy"`; the initial test names (`…_scopes_to_own_job_id_…`) did not contain "decoy" and were deselected. Renamed to `test_claim_one_decoy_foreign_row_offline` / `…_live` so the plan's verify command selects them. Resolved before the Task 1 commit.

## Non-blocking caveat (research assumption A1)
The live fence contention only reproduces in CI against the shared test Supabase project (`E2E_TEST_DB_CONFIGURED=true`); locally the live tests `pytest.skip`. The offline decoy is the local repro-gate; the full live confirmation is the milestone→main ship PR's `python` check. If that live run still reddens, the recorded fallback is a dedicated `fence_serial` xdist_group (a follow-up, not improvised here).

## Next Phase Readiness
- The `python` check should now go green on the milestone→main ship PR (pending the live CI confirmation above).
- PR #610 remains untouched; it gets closed as absorbed at ship time (not by this plan).
- 97-02 / 97-03 can proceed; 97-03 owns the `@pytest.mark.skip` decorators/reasons this plan deliberately left alone.

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/97-composite-ci-schema-debt/97-01-SUMMARY.md`
- Commits verified in git log: `bc1cd0b2`, `46b0fcea`, `8e5751a1`, `dc246899`
- 6 modified files confirmed changed; no VERSION/package.json/CHANGELOG touched

---
*Phase: 97-composite-ci-schema-debt*
*Completed: 2026-07-12*
