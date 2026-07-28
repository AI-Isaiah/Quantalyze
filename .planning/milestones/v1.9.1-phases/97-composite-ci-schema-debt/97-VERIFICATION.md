---
phase: 97-composite-ci-schema-debt
verified: 2026-07-12T00:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
gaps: []
non_blocking:
  - item: "Live fence contention only reproduces in CI against the shared test Supabase project"
    reason: "Offline decoy is the local repro-gate; the ship PR's `python` check is the runtime gate. Cannot be reproduced locally (live tests pytest.skip without SUPABASE_TEST_URL). Flagged NON-BLOCKING per phase scope."
---

# Phase 97: Composite CI & Schema Debt — Verification Report

**Phase Goal:** Unblock the milestone→main ship PR by making the analytics-service `python` check parallelism-safe (CI-01), re-justifying the 3 deferred flaky live-DB fence tests (CI-02.1), and regenerating exactly the 3 owed SQL-function snapshots so `sql-function-snapshot` goes green (CI-02.2).
**Verified:** 2026-07-12
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CI-01: pytest parallelism-safe under `-n auto --dist loadgroup`; per-run-job_id claim scoping; #610 absorbed; offline decoy fails without scoping | ✓ VERIFIED | See criterion CI-01 below — all sub-checks passed, gates RUN |
| 2 | CI-02.1: 3 TODOS-L165 tests re-justified (collected-and-skipped, evidence-based) | ✓ VERIFIED | 3 tests collected + skipped; 3 skip-reason re-justifications + TODOS L213 tracker |
| 3 | CI-02.2: `schema:functions:check` GREEN; exactly 3 owed snapshots regenerated; already-closed items dropped not re-done | ✓ VERIFIED | Gate RUN → exit 0; git history confirms scope |

**Score:** 3/3 truths verified

---

## Criterion CI-01 — Parallelism-Safe Fence Tests — PASS

**Ran the gates directly (not trusting SUMMARY):**

- **Offline decoy** (`.venv/bin/python -m pytest tests/test_compute_jobs_fencing.py -k decoy`) → `1 passed, 1 skipped, 41 deselected`. PASS.
- **Whole file under `-n auto --dist loadgroup`** → `15 passed, 28 skipped in 5.31s` offline (648%-CPU parallelism; live tests skip without `SUPABASE_TEST_URL`, which is correct). Collects and runs green under xdist.

**Per-run-job_id scoping is real and load-bearing (`test_compute_jobs_fencing.py:692-714`):**
`_claim_one(admin, worker_id, *, want_job_id=None)` returns `next((r for r in rows if r["id"] == want_job_id), None)` when scoped; legacy arm (`want_job_id=None`) returns `rows[0]`. The offline decoy (`:785-827`) asserts (a) scoped returns OUR row when a foreign row heads the batch, (b) legacy returns the foreign `data[0]`, (c) scoped returns `None` (never a foreign row) on an only-foreign batch. The RED evidence (`TypeError: unexpected kwarg 'want_job_id'` against the unscoped helper) confirms the test is not vacuous.

**Not vacuously passing:** every scoped call site asserts `claimed is not None and claimed["id"] == job_id` (13 sites: :729, :809, :850, :890, :1102, :1116, :1247, :1551, :1632, :1646, :2734, …). An empty scoped list would FAIL `assert claimed is not None`, not silently pass.

**Fence security invariant HOLDS:** `git show 46b0fcea | grep '^-.*40001'` → empty (exit 1); `... | grep '^-.*serialization_failure'` → empty. No fence-raise / serialization_failure assertion removed or altered by the scoping commit. 58 `40001`/`serialization_failure` occurrences remain in the file; `_is_serialization_failure` classifier tests (:174-220) run green offline.

**#610 absorbed (all 5 surfaces):**
- `.github/workflows/ci.yml:991` → `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (`--cov-fail-under=80` preserved).
- `analytics-service/Makefile:73` → byte-identical flag string.
- `analytics-service/pytest.ini:6` → `xdist_group` marker registered.
- `analytics-service/tests/conftest.py:39-51` → `_is_shared_db_module` + `pytest_collection_modifyitems` adding `xdist_group("shared_test_db")`.
- `analytics-service/requirements-dev.txt:42` → `pytest-xdist` (unpinned).

---

## Criterion CI-02.1 — Re-justify Flaky Fence Tests — PASS

- `pytest --collect-only -k late_mark` → 6 collected (3 live deferred tests: `test_late_mark_done_with_stale_token_raises_serialization_failure`, `test_late_mark_failed_...`, `test_late_mark_done_after_w2_completed_...` + 3 mocked `dispatch_tick` equivalents). **None deleted; all collected-and-skipped.**
- 3 skip-reason re-justifications present: `grep -c "Re-justified 2026-07" test_compute_jobs_fencing.py` → 3 (:1057, :1170, :1599).
- TODOS.md L213 (`**Re-justified 2026-07-12 (Phase 97 / v1.9.1 CI-02.1)**`) — substantive, evidence-based, elements (a)-(d)+ present: CI-01 orthogonality to the `httpx.ReadTimeout @ ~120s` flake, declined pre-ship re-enable rationale, independently-pinned contract, concrete `_rpc_retry_timeout` guard-wrapped re-enable recipe. TODOS.md is 776 lines — **no Write-truncation**; the 2026-05-13 investigation history (:205-211) preserved verbatim above the new subsection.

Satisfies the roadmap CI-02 "re-enabled OR re-justified" arm via explicit, dated, cited re-justification.

---

## Criterion CI-02.2 — SQL-Function Snapshot Regen — PASS

**Ran the gate directly:** `npm run schema:functions:check` → `SQL function snapshot is current (101 functions).` **exit 0** (was failing with 3 owed). GREEN.

**Exactly the 3 owed snapshots regenerated (bounded diff):** all three last touched by phase-97 commit `b71b0d98`:
- `supabase/schema/functions/set_compute_job_progress.sql` (new)
- `supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql` (new)
- `supabase/schema/functions/set_wizard_composite_members.sql` (refreshed; re-bases onto mig `20260712120000`)

**Already-closed items correctly DROPPED, not re-done:**
- The 2 roadmap-named snapshots `enforce_strategy_keys_owner_coherence.sql` + `sync_strategy_analytics_status.sql` were last touched by `044bee50` (v1.9 #607) — **NOT regenerated by phase 97**. Roadmap named the wrong files; these already existed. Confirmed via `git log`.
- Audit-coverage / audit-fanout, `stitch_composite` enqueue instrumentation, `strategy_keys` mock — verified-and-dropped in 97-02 (evidence cited in SUMMARY; these are pre-existing on-branch, correctly not re-done).

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SQL snapshot gate | `npm run schema:functions:check` | exit 0, "101 functions current" | ✓ PASS |
| Offline decoy | `pytest ...test_compute_jobs_fencing.py -k decoy` | 1 passed, 1 skipped | ✓ PASS |
| Full fence file (parallel) | `pytest ...test_compute_jobs_fencing.py -n auto --dist loadgroup` | 15 passed, 28 skipped | ✓ PASS |
| Deferred tests collected | `pytest --collect-only -k late_mark` | 6 collected (3 live skipped, not deleted) | ✓ PASS |
| Fence invariant preserved | `git show 46b0fcea \| grep '^-.*40001'` | empty (no removals) | ✓ PASS |

### Required Artifacts

| Artifact | Expected | Status |
|----------|----------|--------|
| `analytics-service/tests/test_compute_jobs_fencing.py` | scoping + decoy + re-justified skips | ✓ VERIFIED |
| `analytics-service/tests/conftest.py` | collection hook | ✓ VERIFIED |
| `analytics-service/pytest.ini` | xdist_group marker | ✓ VERIFIED |
| `analytics-service/requirements-dev.txt` | pytest-xdist | ✓ VERIFIED |
| `analytics-service/Makefile` | parallel flags | ✓ VERIFIED |
| `.github/workflows/ci.yml` | `-n auto --dist loadgroup ... --cov-fail-under=80` | ✓ VERIFIED |
| `supabase/schema/functions/set_compute_job_progress.sql` | new snapshot (b71b0d98) | ✓ VERIFIED |
| `supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql` | new snapshot (b71b0d98) | ✓ VERIFIED |
| `supabase/schema/functions/set_wizard_composite_members.sql` | refreshed (b71b0d98) | ✓ VERIFIED |
| `TODOS.md` | L213 re-justification, non-truncated | ✓ VERIFIED |

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced. No hand-edited `@generated` files (snapshot check green). No stubs. Scoping assertions are load-bearing (fail on empty scope). Fence-raise assertions byte-preserved.

### Non-Blocking Runtime Confirmation

The live fence contention (`httpx.ReadTimeout @ ~120s` under shared-test-project load) only reproduces in CI against the shared test Supabase project; locally the live tests `pytest.skip`. Per phase scope this is **NON-BLOCKING** — the offline decoy is the local repro-gate, and the milestone→main ship PR's `python` + `sql-function-snapshot` checks are the runtime gate. All three success criteria are observably true in the codebase; both gates were RUN locally and pass. The ship PR's live green is a downstream confirmation, not this verification's blocker.

### Gaps Summary

No gaps. All 3 success criteria PASS with directly-run gate evidence. Phase goal achieved: the analytics-service test suite is parallelism-safe with the fence security invariant intact, the 3 deferred tests are collected-and-skipped with dated evidence-based re-justification, and `schema:functions:check` is green with exactly the 3 owed snapshots regenerated and the already-closed items correctly dropped.

---

_Verified: 2026-07-12_
_Verifier: Claude (gsd-verifier)_
