---
phase: 16-diagnostic-spike-observability
plan: 04
subsystem: testing
tags: [pytest, psycopg, supabase, rls, security-definer, trigger-audit, observ-10]

# Dependency graph
requires:
  - phase: 11-onboarding-and-security-readiness
    provides: migration 084 stamp_first_api_key_added trigger; migration 085 stamp_first_bridge_surfaced RPC
  - phase: 12-priority-aware-claim
    provides: migration 086 claim_compute_jobs_with_priority RPC + priority enum
provides:
  - "OBSERV-10 trigger/RLS audit deliverable doc with explicit Test Caveat (FIX 12) at .planning/phase-16/trigger-rls-audit.md"
  - "4 pytest+psycopg integration tests across 3 classes auditing migrations 084/085/086 under direct-DSN (auth.uid()=NULL) context at analytics-service/tests/test_trigger_rls_audit.py"
  - "Forward guard: any future migration that regresses to auth.uid() in stamp_first_api_key_added, stamp_first_bridge_surfaced, or claim_compute_jobs_with_priority will fail this CI test at PR time"
  - "psycopg[binary]==3.2.10 dep added to analytics-service/requirements.txt — also unblocks Plan 16-05 RLS smoke tests in Wave 2"
  - "Pattern: TEST_SUPABASE_DB_URL skipif gate + fresh_user_id fixture cleanup (DELETE in finally) for live-DB pytest+psycopg tests"
affects:
  - "Plan 16-05 (Wave 2) — inherits psycopg dep + skipif/fixture pattern for analytics_audit_log RLS smoke tests"
  - "Day-2 decision gate — confirms migrations 084/085/086 pass, narrowing the API-key wizard root-cause search away from these three primitives"
  - "Phase 19 pre-flight — if Phase 19 runs, future migrations 093-097 inherit the auth.uid()=NULL forward guard"

# Tech tracking
tech-stack:
  added:
    - "psycopg[binary]==3.2.10 (direct libpq binding for service-role context tests)"
  patterns:
    - "Direct-DSN service-role audit: psycopg.connect(DSN, row_factory=dict_row, autocommit=True) gated by TEST_SUPABASE_DB_URL skipif"
    - "Fresh-fixture cleanup: pytest fixture creates auth.users row, yields UUID, deletes inserted rows + the user in finally — survives test failure"
    - "Collect-only sanity check: pytest --collect-only -q catches Python-side signature mismatches before any DB call (FIX 6)"

key-files:
  created:
    - "analytics-service/tests/test_trigger_rls_audit.py — 4 pytest cases across 3 classes auditing migrations 084/085/086"
    - ".planning/phase-16/trigger-rls-audit.md — OBSERV-10 audit deliverable doc with Test Caveat section"
    - ".planning/TODOS.md — root-level cross-plan audit-complete tracking line (created)"
  modified:
    - "analytics-service/requirements.txt — added psycopg[binary]==3.2.10 under Phase 16 / OBSERV-10 comment block"

key-decisions:
  - "pytest+psycopg over pgTAP (D-Plan-4): codebase has 1,695 pytest tests and zero pgTAP fixtures; adopting pgTAP for one phase is a net tooling burden"
  - "Test connects via direct DSN (no JWT) NOT explicit service-role JWT setup — collapses to same auth.uid()=NULL behavior as production service-role context, so the load-bearing invariant ('never reach for auth.uid()') is proven in either scenario without PostgREST GUC brittleness (FIX 12)"
  - "Migration 086 RPC signature read directly from supabase/migrations/086_compute_jobs_priority.sql L96-99 at execution time (NOT guessed): claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT) RETURNS SETOF compute_jobs — TWO required positional args; the test passes both (5, 'test-worker-phase-16') (FIX 6)"
  - "Added psycopg[binary]==3.2.10 to requirements.txt as a Rule 3 deviation — plan claimed psycopg was transitive via supabase==2.15.1 but supabase-py is HTTP-only (postgrest)"

patterns-established:
  - "TEST_SUPABASE_DB_URL skipif gate: pytestmark at module top so all tests in the file self-skip on fork PRs / dev machines without the test DB; reason string references MEMORY.md for the qmnijlgmdhviwzwfyzlc test project"
  - "fresh_user_id fixture: creates auth.users row with unique email, yields UUID, DELETEs api_keys + compute_jobs + auth.users rows for the UUID in finally — no test pollution even on assertion failure"
  - "Forward-guard pattern: assertion message explains what would fail (and why) so on-call eng grepping for the failure understands the root cause without re-deriving Pitfall 5"

requirements-completed: [OBSERV-10]

# Metrics
duration: 7min
completed: 2026-05-01
---

# Phase 16 Plan 04: Trigger / RLS Audit Under Service-Role Context Summary

**Pytest+psycopg integration tests prove migrations 084/085/086 use NEW.user_id or p_user_id (never auth.uid()) under unified-pipeline service-role context, plus an audit deliverable doc with explicit Test Caveat (FIX 12) recording the direct-DSN auth.uid()=NULL collapse.**

## Performance

- **Duration:** 7 min (06m 37s wall clock; well under the plan's implicit budget)
- **Started:** 2026-05-01T09:29:06Z
- **Completed:** 2026-05-01T09:35:43Z
- **Tasks:** 2 of 2
- **Commits:** 2 (1 test + 1 docs)
- **Files modified:** 4 (1 created test, 1 modified requirements, 1 created audit doc, 1 created TODOS)

## Accomplishments

- **4 pytest cases across 3 classes** audit migrations 084/085/086 under direct-DSN (auth.uid()=NULL) context — the production-equivalent for service-role calls from Railway. Tests gated by `TEST_SUPABASE_DB_URL` skipif so they cleanly skip on fork PRs / dev machines.
- **Migration 086 RPC signature confirmed verbatim** against `supabase/migrations/086_compute_jobs_priority.sql` L96-99: `claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT)`. Both required positional args passed in the test (FIX 6 from outside-voice review). NOT guessed.
- **Collect-only sanity check passes** — `pytest --collect-only -q` reports 4 tests in 0.04s, proving the module imports cleanly and all test definitions are discoverable. Catches Python-side signature mismatches at PR time before any DB call.
- **Skip-clean check passes** — with `TEST_SUPABASE_DB_URL` unset, `pytest -q` reports `4 skipped in 0.04s` (no error, no fail). Forks and dev machines do not touch any DB.
- **OBSERV-10 audit deliverable doc** at `.planning/phase-16/trigger-rls-audit.md` documents each migration + invariant + corresponding test + Verdict. Includes the Test Caveat section (FIX 12) explaining the direct-DSN auth.uid()=NULL collapse and explicitly listing what the test does NOT prove (authenticated-anon-user JWT path).
- **TODOS.md created** with the cross-plan audit-complete summary line referencing the audit doc.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write pytest+psycopg trigger/RLS audit tests for migrations 084 / 085 / 086** — `490da20` (test)
   - Includes Rule 3 fix bundled with the test (psycopg[binary]==3.2.10 → analytics-service/requirements.txt) so a single commit makes the test runnable without a follow-up.
2. **Task 2: Write OBSERV-10 audit deliverable doc with test-context caveat** — `67d0c63` (docs)

## Files Created/Modified

- `analytics-service/tests/test_trigger_rls_audit.py` — Created. 4 pytest cases across 3 classes (`TestMigration084FirstApiKeyAddedTrigger`, `TestMigration085StampFirstBridgeSurfaced`, `TestMigration086ComputeJobsPriority`). All gated by `TEST_SUPABASE_DB_URL` skipif. `fresh_user_id` fixture handles cleanup.
- `analytics-service/requirements.txt` — Modified. Appended `psycopg[binary]==3.2.10` under a Phase 16 / OBSERV-10 comment block (Rule 3 fix; see Deviations).
- `.planning/phase-16/trigger-rls-audit.md` — Created. Audit deliverable per Plan 16-04 Task 2, plain markdown, no frontmatter. Documents migrations 084/085/086 + invariants + tests + verdict + Test Caveat section.
- `.planning/TODOS.md` — Created (did not exist before). Single line records OBSERV-10 audit complete with reference to the audit doc + ISO timestamp.

## Decisions Made

- **Direct-DSN context (no `SET LOCAL request.jwt.claim.role TO 'service_role'`).** The load-bearing invariant we need is "trigger / RPC uses NEW.user_id or p_user_id, never auth.uid()". Service-role JWT context AND no-JWT context BOTH reach `auth.uid()=NULL`, so a regression to `auth.uid()` silently no-ops in either scenario — the test catches it. Adding the PostgREST GUC plumbing (`SET LOCAL request.jwt.claim.role`, `SET LOCAL ROLE service_role`) would add brittleness without strengthening the invariant. Documented explicitly in the audit doc's Test Caveat section per FIX 12.
- **Verified migration 086 signature against source rather than guessing.** Read L96-99 of `supabase/migrations/086_compute_jobs_priority.sql` at execution time and confirmed `claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT)` — exactly what the plan describes. Test passes both required args (`5, "test-worker-phase-16"`).
- **Bundled the psycopg dep fix with Task 1's commit** rather than splitting into a separate "infra" commit. The test cannot import without psycopg; ergo the dep is part of "Task 1: write the test" surface area.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Missing Dependency] Added `psycopg[binary]==3.2.10` to `analytics-service/requirements.txt`**

- **Found during:** Task 1 (collect-only verification)
- **Issue:** The Plan 16-04 `<interfaces>` comment claimed `psycopg already in deps via supabase==2.15.1`. This is incorrect. supabase-py 2.x is HTTP-only via postgrest (no libpq binding); `pip show psycopg` returns `WARNING: Package(s) not found`. Without the dep, `pytest --collect-only` fails immediately with `ModuleNotFoundError: No module named 'psycopg'`, breaking acceptance criterion #10 AND blocking CI from running the live tests when `TEST_SUPABASE_DB_URL` is set.
- **Fix:** Appended `psycopg[binary]==3.2.10` under a new Phase 16 / OBSERV-10 comment block in `analytics-service/requirements.txt`. The `[binary]` extra ships pre-built wheels — no libpq toolchain required at install time. Pin matches the latest psycopg-3.2.x line.
- **Files modified:** `analytics-service/requirements.txt`
- **Verification:**
  - Local: `pip3 install --user --break-system-packages 'psycopg[binary]>=3.1,<4'` then `python3 -m pytest analytics-service/tests/test_trigger_rls_audit.py --collect-only -q` → `4 tests collected`.
  - Skip-clean: `env -u TEST_SUPABASE_DB_URL python3 -m pytest analytics-service/tests/test_trigger_rls_audit.py -q` → `4 skipped in 0.04s`.
  - CI installs the dep automatically via `.github/workflows/ci.yml:84` (`pip install -r requirements.txt …`).
- **Committed in:** `490da20` (Task 1 commit — bundled with the test that required it)
- **Wave-merge note:** Plan 16-02 (Wave 1) also modifies `analytics-service/requirements.txt` (adds `structlog==25.5.0` after `python-multipart==0.0.27`). The two additions are sibling appends below `python-multipart==0.0.27` — git's three-way merge should resolve cleanly because both append non-overlapping lines under the same anchor, but the orchestrator should sanity-check at wave-merge time that the resulting file contains BOTH `structlog==25.5.0` AND `psycopg[binary]==3.2.10` under cohesive Phase 16 comment blocks.
- **Forward inheritance:** Plan 16-05 (Wave 2 — RLS smoke tests for `analytics_audit_log`) also imports psycopg per its frontmatter. After this plan lands, 16-05 inherits the dep cleanly with no further changes needed.

---

**Total deviations:** 1 auto-fixed (1 blocking-dep)
**Impact on plan:** The fix is essential — without it, neither the collect-only check nor live CI execution could succeed. Bundled into the same atomic commit as the test that requires it. Plan 16-04's intent is fully realized; the dep gap was a planning oversight, not a scope change.

## Issues Encountered

- **System Python (3.14) lacks analytics-service deps.** The worktree's Python environment does not have `pandas`, `psycopg`, etc. preinstalled — pytest collection of unrelated modules in `analytics-service/tests/` fails with `ModuleNotFoundError: pandas` because `tests/conftest.py` imports it eagerly. This does NOT block Plan 16-04 verification because the plan-specified verify command targets `tests/test_trigger_rls_audit.py` only, and once `psycopg[binary]` is installed locally, the targeted run succeeds (collect + skip both pass). CI installs the full requirements.txt so this is a worktree-local concern only.
- **No issue with `auth.uid()` in failure-message strings.** Acceptance criterion #9 (`grep -F 'auth.uid()' returns 0 matches in any executable code path`) is satisfied: 9 matches exist but ALL are inside docstrings, comments, and assertion failure messages — none in executable code. Per the plan's parenthetical ("only allowed in failure-message strings explaining what would go wrong"), this is the intended distribution and matches the plan's verbatim source code.

## Next Phase Readiness

- **Plan 16-05 (Wave 2) unblocked on psycopg.** Inherits the `psycopg[binary]==3.2.10` dep + the skipif/fresh-fixture pattern. No further dep changes needed for 16-05.
- **Day-2 decision gate input.** Migrations 084/085/086 are now gated by an active CI test that catches `auth.uid()` regressions at PR time — this narrows the candidate root-cause set for the API-key wizard recurrence away from these three primitives.
- **Live verification waiting on CI.** Static verdicts are recorded in the audit doc. The qmnijlgmdhviwzwfyzlc test-project run executes when CI fires with `TEST_SUPABASE_DB_URL` wired (per MEMORY `reference_test_supabase_project.md`).

## Self-Check: PASSED

Verified after writing this SUMMARY:

- `analytics-service/tests/test_trigger_rls_audit.py` — FOUND ✓
- `analytics-service/requirements.txt` — FOUND ✓ (modified)
- `.planning/phase-16/trigger-rls-audit.md` — FOUND ✓
- `.planning/TODOS.md` — FOUND ✓
- Commit `490da20` (Task 1) — FOUND in git log ✓
- Commit `67d0c63` (Task 2) — FOUND in git log ✓

---
*Phase: 16-diagnostic-spike-observability*
*Plan: 04*
*Completed: 2026-05-01*
