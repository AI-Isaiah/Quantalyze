---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 02
subsystem: testing
tags: [pytest, asyncio, healthz, pg_cron, grep-gate, wedge-01, job-07]

# Dependency graph
requires:
  - phase: 125-worker-isolation
    provides: "tests/test_worker_isolation_e2e.py — the real-TCP healthz probe helpers (_free_ephemeral_port / _wait_port_listening / _probe_healthz) and the mid-dispatch 200 / forced-stale 503 shapes"
  - phase: 106-backbone-unification
    provides: "tests/test_dark_path_deleted.py — the comment-stripped grep-gate idioms (_repo_root, _strip_comment, _py_scan_files, anti-vacuity assert, deleted-file gate)"
provides:
  - "JOB-07 structural absence gate: no reaper identifier reachable from the worker's dispatch surface, with a scanner self-test proving the gate can go RED"
  - "JOB-07 behavioural control pair: blocking (time.sleep) vs yielding (asyncio.sleep) work through one shared driver — the falsifier that gives the healthz 200 meaning"
  - "Stays-absent gate for the deleted scripts/reset_stuck_computing_rows.py one-off"
  - "Forbidden-token guard on the cron jobname `reap_strategy_analytics_stuck_computing` (consumed by plan 142-04's migration)"
affects: [142-04, 142-05, 144-compute-jobs-orphaned-running]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-falsifiable-by-construction tests are shipped ONLY alongside the structural gate + control that CAN fail, and say so in their own docstring"
    - "Control pairs driven through ONE shared driver parameterised by a single boolean, so the arms provably differ in exactly one token"
    - "Race-free loop-liveness oracle: sample LAST_TICK_AT INSIDE the handler on both sides of the work, so no scheduler interleaving can smear the observation"

key-files:
  created:
    - analytics-service/tests/test_job07_reaper_off_worker_loop.py
  modified:
    - analytics-service/scripts/reset_stuck_computing_rows.py (DELETED)

key-decisions:
  - "Probe helpers are IMPORTED from tests/test_worker_isolation_e2e.py (tests/ is a package, pythonpath=.) rather than copied — a forked second implementation could drift from the one the existing isolation suite trusts"
  - "The forbidden tokens are LOCAL literals in the test file, never a shared constant: an import site would itself be a reachable reference, and the scan would be comparing the surface against a value the surface supplies"
  - "The blocking arm's deterministic oracle is LAST_TICK_AT sampled inside the handler; latency/503 is asserted as an OR because the post-block status is genuinely scheduler-dependent (both were observed, but only the tick freeze is race-free)"
  - "The starved arm does NOT assert `not dt.done()` (the analog's mid-dispatch oracle) — a wedged loop cannot service the probe before it releases, so that assertion would contradict the very property being demonstrated. It is recorded and asserted in the yielding twin instead, as one more arm asymmetry"

patterns-established:
  - "Scanner self-test: a grep-gate must assert that a synthetic violating line IS flagged and a pure comment is NOT, otherwise GREEN is indistinguishable from a broken matcher"
  - "Docstring honesty bound: any test touching the healthz heartbeat restates that it detects LOOP-BLOCKING freezes only, never a yielding single-job hang"

requirements-completed: [JOB-07, JOB-02]

# Metrics
duration: 41min
completed: 2026-08-02
---

# Phase 142 Plan 02: JOB-07 reaper-off-the-worker-loop gate Summary

**A JOB-07 gate with real teeth — a comment-stripped structural absence scan (with scanner self-test) plus a one-token-apart blocking/yielding control pair against the real healthz TCP server — and the broken `reset_stuck_computing_rows.py` one-off deleted behind a stays-absent gate.**

## Performance

- **Duration:** ~41 min
- **Started:** 2026-08-02T10:36:00Z
- **Completed:** 2026-08-02T11:17:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 deleted)

## Accomplishments

- **The naive JOB-07 test was NOT shipped alone.** `test_healthz_stays_200_with_large_stranded_backlog` exists, but its docstring opens with a warning that it cannot fail for the reaper property (pg_cron ⇒ no worker-loop reap path) and names where the teeth actually live. Nobody can cite it as proof.
- **Structural gate:** `test_no_reaper_identifier_on_worker_surface` scans the dispatch-reachable Python surface (`services/analytics_runner.py`, `services/job_worker.py`, `routers/cron.py`, `main_worker.py`, `main.py`, plus rglob of `routers/` and `scripts/`) for `reap_strategy_analytics_stuck_computing` and `reset_stuck_computing_rows`, comment-stripped, reporting `file:line` per hit. Anti-vacuity: `assert scan` non-empty **and** `main_worker.py` must be in the surface.
- **Scanner self-test:** `test_scanner_flags_a_synthetic_reaper_identifier` proves the matcher fires on a synthetic `dispatch_tick` line bearing the jobname and stays silent on a pure comment — both directions, for both tokens.
- **Control pair:** one shared driver `_drive_probe_against_dispatch(monkeypatch, *, blocking)` runs the identical real `dispatch_tick` + real healthz server on an ephemeral port; the arms differ in `time.sleep(0.5)` vs `await asyncio.sleep(0.5)` and nothing else.
- **The broken one-off is gone:** `analytics-service/scripts/reset_stuck_computing_rows.py` deleted, with a stays-absent gate whose message records *why* (42703 on a non-existent `updated_at`, false "platform upgrade" attribution, never clears `computation_warned`).

## Task Commits

1. **Task 1: Structural gate + deleted-script gate + delete the broken one-off** — `0721d574` (test)
2. **Task 2: Behavioral healthz probe + blocking-vs-yielding control pair** — `0cba81d9` (test)

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified

- `analytics-service/tests/test_job07_reaper_off_worker_loop.py` (created, 595 lines) — 3 structural tests + 4 behavioural tests. Structural: forbidden-token absence, scanner self-test, deleted-file gate. Behavioural: backlog-200 (self-declared non-falsifiable), blocking-starved, yielding-healthy, forced-stale 503.
- `analytics-service/scripts/reset_stuck_computing_rows.py` (**deleted**) — broken one-off superseded by the pg_cron reaper (142-04).

## Falsifiability Ledger — Observations

### SC-4 (structural gate) — **Observed ✅ RED**

Mutation applied to production source (`analytics-service/main_worker.py:125`):

```python
_MUTANT_REAPER_JOB = "reap_strategy_analytics_stuck_computing"  # MUTANT SC-4
_VALID_CLAIM_ROLES: Final[tuple[str, ...]] = ("all", "interactive", "backfill")
```

`cd analytics-service && pytest tests/test_job07_reaper_off_worker_loop.py -q` →

```
E       AssertionError: JOB-07 violated: a reaper identifier is reachable from the worker's
        dispatch surface. The strategy_analytics stuck-`computing` reaper runs in pg_cron
        precisely so no janitor work can block the shared asyncio event loop (WEDGE-01).
        Move it back to pg_cron:
E         .../analytics-service/main_worker.py:125: reap_strategy_analytics_stuck_computing
E       assert not ['.../analytics-service/main_worker.py:125: reap_strategy_analytics_stuck_computing']

tests/test_job07_reaper_off_worker_loop.py:179: AssertionError
=========================== short test summary info ============================
FAILED tests/test_job07_reaper_off_worker_loop.py::test_no_reaper_identifier_on_worker_surface
1 failed, 2 passed in 0.76s
```

**Revert-and-green:** `git checkout -- analytics-service/main_worker.py` → `3 passed in 0.73s`.
`grep -rn MUTANT analytics-service/` → **0**. `git diff --diff-filter=D --name-only HEAD~1 HEAD` on the task-1 commit showed exactly one deletion, the intended script.

### SC-4 bonus (resurrection guard) — **Observed ✅ RED**

Not required by the plan, but run because a stays-absent gate that never fires is worth nothing.
Temporarily restoring the deleted script (`git checkout HEAD -- .../reset_stuck_computing_rows.py`) reddened **two** tests:

```
E       AssertionError: scripts/reset_stuck_computing_rows.py was recreated — it must stay
        deleted: it filters on a non-existent `updated_at` column (42703), misattributes the
        cause, and omits the `computation_warned = FALSE` clear. The pg_cron reaper supersedes
        it; do not resurrect the one-off.
=========================== short test summary info ============================
FAILED ...::test_no_reaper_identifier_on_worker_surface
FAILED ...::test_superseded_one_off_stays_deleted
2 failed, 1 passed in 0.77s
```

(The structural gate also fired, because the restored file's usage docstring line
`python -m scripts.reset_stuck_computing_rows` is a live non-comment line on the scanned
`scripts/` surface.) Re-deleted → `3 passed`.

### SC-4b (behavioural control pair) — **Observed ✅, opposite outcomes**

The pair **is** the mutation+control; no production edit needed. Measured observations from the
as-written run (instrumented temporarily, instrumentation removed before commit):

| Arm | latency | healthz status | `LAST_TICK_AT` advanced across the work | probe serviced mid-dispatch |
|-----|---------|----------------|------------------------------------------|------------------------------|
| **blocking** (`time.sleep(0.5)`) | **0.512 s** | `HTTP/1.1 503 Service Unavailable` | **False** | **False** |
| **yielding** (`await asyncio.sleep(0.5)`) | **0.001 s** | `HTTP/1.1 200 OK` | **True** | **True** |

Stable across 5 consecutive runs (blocking latency 0.503–0.512 s, always 503; yielding
0.000–0.001 s, always 200). The blocking arm shows **both** symptoms the plan allowed as an OR,
so the assertion is satisfied by either.

**Liveness proof (the arms are asserting, not decorating).** Swapping the driver's boolean in each
test — blocking arm → `blocking=False`, yielding arm → `blocking=True` — reddened **exactly those
two tests and nothing else**:

```
E   AssertionError: LAST_TICK_AT advanced across a loop-BLOCKING span — impossible if the block
    is real, so the arm is not exercising the property
    (before=1785660849.4207518 after=1785660849.903081)
E   assert 1785660849.4207518 == 1785660849.903081

E   AssertionError: the heartbeat must advance LAST_TICK_AT across YIELDING work; if it does not,
    the twin is not actually yielding and the pair proves nothing
E   assert 1785660850.0103738 > 1785660850.0103738

FAILED ...::test_probe_starved_by_loop_blocking_sync_work
FAILED ...::test_probe_healthy_when_same_work_yields
2 failed, 5 passed in 2.74s
```

Both mutations reverted; `7 passed in 2.65 s`.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| New file | `cd analytics-service && pytest tests/test_job07_reaper_off_worker_loop.py -x -q` | **7 passed in 2.65 s** (well under the 15 s budget) |
| Script deleted | `test ! -f analytics-service/scripts/reset_stuck_computing_rows.py` | `deleted-ok` |
| No py importer survives | `grep -rn "reset_stuck_computing_rows" . --include="*.py"` | 3 hits, **all in the new test file** (docstring, `DELETED_ONE_OFF_STEM` literal, gate docstring) |
| Analog suite unaffected | `pytest tests/test_worker_isolation_e2e.py -x -q` | **4 passed** |
| No shared-state pollution | `pytest tests/test_job07_reaper_off_worker_loop.py tests/test_worker_isolation_e2e.py tests/test_main_worker.py tests/test_job_worker_csv_kind.py tests/test_dark_path_deleted.py -q` | **73 passed in 3.56 s** |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent services/ routers/ models/` | **Success: no issues found in 89 source files** |
| Mutation residue | `grep -rn MUTANT analytics-service/` | **0** |

Per the plan's non-negotiables, the pre-delete grep was scoped `--include="*.py"`. The unscoped
repo-wide grep still hits prose in `CHANGELOG.md` and five `.planning/` documents — **expected
historical references, explicitly not a STOP condition** — and those were left untouched.

## Decisions Made

- **Imported the probe helpers rather than copying them.** `analytics-service/tests/__init__.py` exists and `pytest.ini` sets `pythonpath = .`, so `from tests.test_worker_isolation_e2e import _free_ephemeral_port, _probe_healthz, _wait_port_listening` resolves both locally and in CI. The plan permitted a commented copy as fallback; the import is strictly better — one implementation, no drift.
- **The control pair shares one driver.** The plan's requirement is that the arms "differ ONLY in `time.sleep` vs `asyncio.sleep`". Two hand-written tests would let that claim rot silently; a single driver parameterised by `blocking: bool` makes it structurally true.
- **`LAST_TICK_AT` is sampled inside the handler**, immediately before and immediately after the work. A loop-blocking span cannot let the heartbeat run between those two samples, so the core oracle is race-free — unlike the response status, which depends on whether the heartbeat's expired-timer continuation runs before the healthz handler computes `age`.
- **The starved arm does not assert `not dt.done()`.** See key-decisions above: it contradicts the property. Recorded as an observation and asserted in the yielding twin, where it is a genuine mid-dispatch-liveness oracle.
- **Fixture honesty.** The backlog test asserts its own mock actually holds 5,000 rows at `computation_status='computing'`. `main_worker` never calls `.table()`, so without that assert the docstring's "with a large stranded backlog present" would be an unverified claim about the test's own setup — the SEAMUX-08 defect class.

## Deviations from Plan

**1. [Rule 1 - Bug] Removed the plan's `assert not dt.done()` from the blocking arm**

- **Found during:** Task 2 (first run of the control pair)
- **Issue:** The plan's Task 2 driver text inherited `assert not dt.done()` from the analog's positive case. In the **blocking** arm this is self-contradictory: a wedged event loop cannot service the probe until it releases, by which time `dispatch_tick` has finished. The test failed with `AssertionError: the probe must be captured WHILE the dispatch is in flight` — a false negative caused by the assertion, not by a real defect.
- **Fix:** Recorded the value as `obs["probe_landed_mid_dispatch"]` instead of asserting it in the driver, and asserted it (`True`) in the **yielding** twin, where mid-dispatch capture is the correct oracle. This converts a contradiction into one more arm asymmetry.
- **Files modified:** `analytics-service/tests/test_job07_reaper_off_worker_loop.py`
- **Verification:** 7 passed; the swapped-arm mutation run confirms both arms still redden on their own oracles.
- **Committed in:** `0cba81d9` (Task 2 commit)

**2. [Rule 2 - Missing critical] Added the resurrection-guard RED observation**

- **Found during:** Task 1
- **Issue:** The plan required an observed RED only for the structural gate (SC-4). The stays-absent gate shipped with no evidence it can fire — the same "a test that cannot fail is not evidence" bar the phase's non-negotiable #7 sets for JOB-07.
- **Fix:** Temporarily restored the deleted script, observed both gates go RED, re-deleted, re-confirmed green. Evidence pasted above.
- **Files modified:** none (observation only)
- **Verification:** `2 failed, 1 passed` under restoration; `3 passed` after re-deletion.
- **Committed in:** n/a (no source change)

---

**Total deviations:** 2 (1 bug fix in the plan's own test text, 1 added falsification observation)
**Impact on plan:** No scope change. Deviation 1 was required for the plan's own acceptance criteria to be satisfiable; deviation 2 strengthens evidence at zero cost.

## Issues Encountered

- **`git merge-base` showed the worktree forked from the wrong base** (`34127316`, not the required `dd498aea`) — the known GSD worktree-forks-from-default-branch issue. The `<worktree_branch_check>` `git reset --hard dd498aea…` corrected it before any work; `.planning/phases/142-…/` only became visible after the reset.
- **Temporary instrumentation ordering.** The observation `print` initially sat before `await dt`, which raised `KeyError: 'tick_after_work'` in the yielding arm (the probe returns long before the 0.5 s yielding work finishes). Moved after `await dt` to capture, then removed entirely before commit.

## Known Stubs

None. Both tests and the deletion are complete and self-contained; nothing in this plan is placeholder or awaiting a later plan to wire up.

## Threat Flags

None. This plan adds no network endpoint, auth path, file-access pattern, or schema change. The threat register's T-142-SC (`accept`, zero package installs) held — the new file is stdlib-only plus `pytest`/`unittest.mock`, already present.

## Next Phase Readiness

- **142-04 (migration)** must name its pg_cron job exactly `reap_strategy_analytics_stuck_computing`. The structural gate hard-guards that literal against appearing in any production **Python** file — the migration SQL and the 142-04 drift-gate test are both outside the scanned surface, so no conflict.
- **142-04's `TestReaperThresholdDriftGate`** and **142-05's SQL gate** are unaffected by this plan; they live in `tests/` and `supabase/tests/`, neither of which this gate scans.
- **Wave-1 sibling 142-01** adds `STRATEGY_ANALYTICS_REAP_THRESHOLD` and `JOB_CHAIN_FOLLOW_ON` to `services/job_worker.py` — a scanned file. Neither identifier contains a forbidden token, so the gate stays green after merge. Worth a re-run of `pytest tests/test_job07_reaper_off_worker_loop.py -q` post-merge as the cheap confirmation.
- **No blockers.**

## Self-Check: PASSED

- `analytics-service/tests/test_job07_reaper_off_worker_loop.py` — **FOUND** (595 lines, ≥ the plan's 120-line floor)
- `.planning/phases/142-…/142-02-SUMMARY.md` — **FOUND** (240 lines, not truncated)
- `analytics-service/scripts/reset_stuck_computing_rows.py` — **ABSENT** (intended deletion)
- Commits `0721d574`, `0cba81d9`, `135a395e` — all **FOUND** in `git log`
- `git status --short` — clean; no untracked or uncommitted residue

---
*Phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star*
*Plan: 02*
*Completed: 2026-08-02*
