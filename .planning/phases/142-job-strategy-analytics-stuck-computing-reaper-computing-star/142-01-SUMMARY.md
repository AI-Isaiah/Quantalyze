---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 01
subsystem: testing
tags: [python, pytest, mypy, job-queue, pg_cron, invariants, analytics-service]

# Dependency graph
requires:
  - phase: 141-jobs-rate-retry
    provides: the compute_jobs retry/backoff surface (attempt 1 -> +30s, 2 -> +2min, ELSE -> +8min) the chain ceiling sums per hop
provides:
  - "JOB_CHAIN_FOLLOW_ON — the canonical job-chain topology constant, READ by all three production enqueue sites"
  - "STRATEGY_ANALYTICS_REAP_THRESHOLD = '16 hours' — the canonical Postgres interval the reaper migration embeds"
  - "TestReaperThresholdInvariant — chain-inclusive headroom (SC-3), sane upper bound, parseable-interval"
affects: [142-04 migration threshold literal + drift gate, 142-05 SQL gate, 143 dropped-enqueue reconciliation, 144 compute_jobs orphaned-running]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Load-bearing topology constant: production enqueue sites READ the map, so a wrong entry changes real behavior instead of only reddening a decorative gate"
    - "Chain-inclusive ceiling: sum per hop over simple paths, never batch_size x max_per_kind_timeout (C-6)"
    - "Registry-size literal pin (len(TIMEOUT_PER_KIND) == 15) as the forced-conscious-decision mechanism for a walk's coverage blind spot"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/ingestion/long_fetch.py
    - analytics-service/tests/test_main_worker.py

key-decisions:
  - "Topology single-source = PATTERNS option (a): the three enqueue sites read JOB_CHAIN_FOLLOW_ON. Option (b)'s match-the-literals AST gate is a second artifact that can itself rot; option (a) makes the constant load-bearing so the existing job-flow suites are the drift detector."
  - "Chain-inclusive ceiling = 43,920 s (12.2 h) on process_key_long -> sync_trades -> derive_broker_dailies -> compute_analytics_from_csv. Per hop: (batch-1) x max_handler + handler x max_attempts + retry backoff."
  - "STRATEGY_ANALYTICS_REAP_THRESHOLD = '16 hours' (57,600 s, 1.31x ceiling) — the rule-derived smallest whole 4-hour multiple >= 1.25 x ceiling. The plan's provisional value was confirmed by derivation, not assumed."
  - "The ceiling walk enumerates simple paths from EVERY topology key rather than from computed roots: root detection is extra logic that could silently drop the worst path, and every root-originated path is already enumerated, so the maximum is identical."
  - "The dominance assert (chain ceiling >= all-kinds single-hop ceiling) is deliberately ABSENT and documented as such in the test — both sides share max(TIMEOUT_PER_KIND.values()), so it can never fail."

patterns-established:
  - "JOB-03: tag comments at every enqueue site that reads the chain topology"
  - "Oracle independence via local literals: batch size, max_attempts and retry backoff are declared in the test naming their production file:line, never imported"

requirements-completed: [JOB-03]

# Metrics
duration: 24min
completed: 2026-08-02
---

# Phase 142 Plan 01: JOB-03 threshold infrastructure Summary

**A load-bearing `JOB_CHAIN_FOLLOW_ON` topology map that all three production enqueue sites read, plus `STRATEGY_ANALYTICS_REAP_THRESHOLD = '16 hours'` derived from a 43,920 s chain-inclusive ceiling and pinned by three invariants that were observed to fail.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-02T00:00:00Z (approx — worktree spawn)
- **Completed:** 2026-08-02
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- The three chain edges were inline string literals at three sites with no topology constant anywhere in `analytics-service/`. They now read one map, so a wrong entry changes production enqueue behavior and reddens the existing job-flow suites — the constant is load-bearing, not decorative.
- The reaper threshold is derived from `strategy_analytics`'s own chain math (43,920 s) rather than re-applying the `compute_jobs` formula, which measures one claimed job and under-counts a multi-hop chain by ~4x.
- The headroom invariant was **observed** RED under the SC-3 mutation, not merely asserted to cover it.

## Task Commits

1. **Task 1: Declare the constants and rewire the three enqueue sites** — `85647b27` (feat)
2. **Task 2: TestReaperThresholdInvariant + SC-3 mutation observation** — `91496ad9` (test)

## Files Created/Modified

- `analytics-service/services/job_worker.py` — `JOB_CHAIN_FOLLOW_ON` + `STRATEGY_ANALYTICS_REAP_THRESHOLD` declared beside `TIMEOUT_PER_KIND` (:509, :540); the `sync_trades` follow-on (:1907) and `_enqueue_csv_analytics` `p_kind` (:4935) now read the map.
- `analytics-service/services/ingestion/long_fetch.py` — tail selection (:588-593) unpacks `(ledger_tail, trade_tail)` from the map via a function-scoped import mirroring the existing `DispatchResult` deferred-import convention.
- `analytics-service/tests/test_main_worker.py` — `_chain_inclusive_ceiling_seconds()` helper + `class TestReaperThresholdInvariant` (3 tests) appended after `TestWatchdogInvariant`.

## Threshold Derivation (the numbers plan 142-04's migration header must restate)

Per-hop cost, all inputs local literals in the test naming their production source:

```
(P_BATCH_SIZE - 1) x max(TIMEOUT_PER_KIND.values())   batch-tail exposure   4 x 1800 = 7200
+ TIMEOUT_PER_KIND[hop] x MAX_ATTEMPTS                 own handler, retried
+ RETRY_BACKOFF_TOTAL_S                                30 + 120 + 480       = 630
```

- `P_BATCH_SIZE = 5` — `main_worker.py:470`, `:511`
- `MAX_ATTEMPTS = 3` — `job_worker.py:8171`
- `RETRY_BACKOFF_TOTAL_S = 630` — migration `20260505115047:176-182`, COMMENT `:209`

Worst simple path (4 hops): `process_key_long -> sync_trades -> derive_broker_dailies -> compute_analytics_from_csv`

```
4 x 7830 + 3 x (1800 + 900 + 900 + 600) = 31320 + 12600 = 43920 s = 12.2 h
```

| Quantity | Value |
|---|---|
| **Computed chain-inclusive ceiling** | **43,920 s (12.2 h)** |
| 1.25 x ceiling | 54,900 s (15.25 h) |
| Smallest whole 4-hour multiple >= that | **16 hours** |
| **Final `STRATEGY_ANALYTICS_REAP_THRESHOLD`** | **`'16 hours'` (57,600 s)** |
| Margin over ceiling | 1.31x (MAX_RATIO cap 2.0) |

The plan's provisional `'16 hours'` was **confirmed by running the derivation**, not carried over on trust. For contrast, the forbidden `compute_jobs` formula would have produced `5 x 1800 = 9,000 s` (2.5 h) — 4.9x too small, and it would have reaped healthy chains.

## SC-3 Mutation Evidence (Falsifiability Ledger)

**Mutation:** `STRATEGY_ANALYTICS_REAP_THRESHOLD: Final[str] = "16 hours"` → `"96 minutes"` (one tenth).
**Command:** `cd analytics-service && pytest tests/test_main_worker.py -k Reaper -x`
**Result: RED.** Pasted failing assertion:

```
>       assert threshold_s > ceiling_s, (
E       AssertionError: STRATEGY_ANALYTICS_REAP_THRESHOLD is '96 minutes' (5760s) but the
        chain-inclusive ceiling is 43920s (12.2h) on path process_key_long -> sync_trades ->
        derive_broker_dailies -> compute_analytics_from_csv. Below the ceiling the pg_cron
        reaper terminalizes healthy in-flight chains as 'failed' — a false failure on a money
        surface. Raise the constant. Do NOT re-derive it as batch_size x max(TIMEOUT_PER_KIND):
        that is the compute_jobs formula (migration 20260720120000) and it measures ONE claimed
        job, not a whole multi-hop chain (CONTEXT.md C-6).
E       assert 5760 > 43920

tests/test_main_worker.py:1260: AssertionError
FAILED tests/test_main_worker.py::TestReaperThresholdInvariant::test_threshold_exceeds_chain_inclusive_ceiling
1 failed, 49 deselected in 1.34s
```

**Restore:** `git checkout -- analytics-service/services/job_worker.py` — restored from the committed pre-mutation text (task-1 commit `85647b27`), never retyped from memory. `git status --short` on that path returned empty afterwards.
**Re-run GREEN:** `3 passed, 49 deselected in 1.31s`.
**`grep -rn MUTANT analytics-service/` → 0.**

Ledger row **SC-3: Observed ✅** (evidence above). SC-3b (the SQL↔Python drift gate) is plan 142-04's row and remains pending.

## Verification

| Gate | Result |
|---|---|
| `pytest tests/test_main_worker.py -k Reaper -x -q` | 3 passed |
| `pytest tests/test_main_worker.py tests/test_job_worker_csv_kind.py -x -q` | 58 passed |
| Full suite `pytest -q` (from `analytics-service/`) | **4827 passed, 96 skipped** |
| `mypy --strict services/job_worker.py services/ingestion/long_fetch.py` | Success, 0 issues, 0 new `# type: ignore` |
| CI-equivalent `mypy --strict --follow-imports=silent services/ routers/ models/` | Success, 89 files |
| Inline chain-edge literals remaining in live code | 0 (both greps return 0) |
| `grep "import" tests/test_main_worker.py \| grep -c "P_BATCH_SIZE\|MAX_ATTEMPTS\|RETRY_BACKOFF"` | 0 (P-8 satisfied) |
| `batch_size * max(` applied as the ceiling | absent (C-6 satisfied) |

## Decisions Made

- **Topology single-source = option (a)** (the three enqueue sites read the constant), as the plan fixed. Confirmed viable at execution time: `long_fetch.py` already uses function-scoped imports from `services.job_worker` (`:43`, `:74`), so no import cycle was introduced.
- **Registry count pinned at 15**, verified by reading `TIMEOUT_PER_KIND` at test-authoring time (`len()` printed as 15; the plan's expected value was correct but was re-derived, not trusted).
- **The `'16 hours'` value was re-derived from the running test's ceiling** before being finalized, per the plan's rule ("derive it — do not hardcode past the rule").

## Deviations from Plan

Two small, non-behavioral shape choices inside the latitude the plan left to the executor. Neither changes a fixed decision, a number, or an acceptance criterion.

**1. [Shape] The ceiling walk enumerates simple paths from every topology key rather than from computed "root" kinds**
- **Found during:** Task 2
- **Rationale:** The plan says "walk the map from each root kind". Root detection (keys never named as a follow-on) is extra logic whose failure mode is *silently dropping the worst path* — precisely the failure the invariant exists to prevent. Walking from every key is a strict superset that yields the identical maximum (verified: 43,920 s on the expected 4-hop path). Documented in a code comment.
- **Files modified:** `analytics-service/tests/test_main_worker.py`

**2. [Shape] The per-hop ceiling lives in a module-level `_chain_inclusive_ceiling_seconds()` helper rather than being inlined in test 1**
- **Found during:** Task 2
- **Rationale:** Tests 1 and 2 both need the ceiling; inlining it twice would create the exact second-oracle drift the plan forbids for the interval parser (`test_job_worker_csv_kind.py:118`'s `_parse_minutes` is the named cautionary case). The batch/retry inputs remain **function-local literals** inside the helper, so the P-8 acceptance criterion (`grep "import" … P_BATCH_SIZE\|MAX_ATTEMPTS\|RETRY_BACKOFF` → 0) still holds and was verified.
- **Files modified:** `analytics-service/tests/test_main_worker.py`

---

**Total deviations:** 0 auto-fixed under Rules 1-3; 2 shape choices within stated executor latitude.
**Impact on plan:** None. Every acceptance criterion and every phase-critical constraint was met and verified. No scope creep — the plan's "Touch NOTHING else" boundary held (`routers/cron.py`, `WATCHDOG_PER_KIND_OVERRIDES`, and the partial upserts at `job_worker.py:1702`/`:4875`/`analytics_runner.py:1555` were not touched).

## Issues Encountered

- **`mypy --strict tests/test_main_worker.py` reports 59 pre-existing errors.** These are NOT from this plan: zero errors fall in the added range (lines 1143-1340), verified by filtering mypy output by line number. `ci.yml:1131` gates `mypy --strict --follow-imports=silent services/ routers/ models/` with an explicit comment at `:1130` that "tests/ stays untyped by design", so the test file is outside the type gate. Out of scope per the executor scope boundary — not fixed, not logged as new debt (it is the repo's standing, documented posture).
- `python` is not on PATH in this environment; `python3` was used throughout. pytest was run from `analytics-service/` in every invocation, per the VCR cassette constraint.

## Known Stubs

None. Both constants are live and consumed by production code paths; the threshold's downstream consumers (the migration literal and the SQL gate) are plans 142-04 and 142-05 by design, which the constant's own comment block names explicitly.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change was introduced — this plan is one module-constant declaration, three one-line enqueue rewires, and a test class. T-142-01 (topology tampering) and T-142-02/03 (threshold too small / unit typo) are mitigated as the threat register specified: the enqueue sites read the map, and the headroom + MAX_RATIO invariants ship green with SC-3 observed.

## User Setup Required

None — no external service configuration required. This plan installs zero packages (T-142-SC: no install task exists).

## Next Phase Readiness

- **Plan 142-04** can embed the literal `16 hours` in `20260802120000_strategy_analytics_stuck_computing_reaper.sql`'s pg_cron body and build `TestReaperThresholdDriftGate` against `STRATEGY_ANALYTICS_REAP_THRESHOLD`. The migration header should restate both numbers from the Derivation table above (ceiling 43,920 s / threshold 57,600 s / 1.31x).
- **Plan 142-05**'s SQL gate can assert the deployed `cron.job.command` carries `interval '16 hours'` as a positive anchor.
- **JOB-07 note for plan 142-02:** the cron jobname `reap_strategy_analytics_stuck_computing` appears **nowhere in Python** after this plan — that absence is the JOB-07 property and remains intact (`grep` for it under `analytics-service/` returns 0).
- **Watch item for future kinds:** `len(TIMEOUT_PER_KIND) == 15` is now pinned. Adding a job kind will redden `test_threshold_exceeds_chain_inclusive_ceiling` by design, forcing a conscious chain-edge decision. That is the intended cost, not a flake.

## Self-Check: PASSED

All claimed files exist on disk and all claimed commits exist on the branch.

| Claim | Result |
|---|---|
| `analytics-service/services/job_worker.py` | FOUND |
| `analytics-service/services/ingestion/long_fetch.py` | FOUND |
| `analytics-service/tests/test_main_worker.py` | FOUND |
| `.planning/phases/142-.../142-01-SUMMARY.md` | FOUND |
| Commit `85647b27` (Task 1) | FOUND |
| Commit `91496ad9` (Task 2) | FOUND |
| Commit `76b8fcac` (SUMMARY) | FOUND |

No files were deleted by any commit in this plan (`git diff --diff-filter=D HEAD~1 HEAD` empty after each). No untracked files remain.

---
*Phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star*
*Completed: 2026-08-02*
