---
phase: 74-funnel-wiring-both-callers
plan: 04
subsystem: analytics
tags: [nav-twr, flow-aware-twr, job-worker, broker-path, nan-safe-upsert, fail-loud, tdd]
requires:
  - services/nav_twr.py (NavReconstructionError — from 74-02)
  - services/broker_dailies.py (combine_realized_and_funding returns dict(meta) carrying guard keys — from 74-02)
  - services/job_worker.py (derive_broker_dailies broker path; LedgerValuationError typed-catch template @:1916-1941)
provides:
  - Broker-path NavReconstructionError typed permanent catch (job_worker.py:2010) — a structural
    NAV/TWR fault lands DispatchResult FAILED permanent (was retried-forever unknown), strategy-mode
    stamps a scrubbed terminal 'failed', key-mode skips the stamp (no per-key analytics row)
  - NaN-safe csv_daily_returns upsert on BOTH is_key_mode and strategy-mode branches — guarded-day
    NaN rows SKIPPED (74-01 sink-(b) finding); a guarded day is honestly ABSENT (never 0.0, never crash)
  - End-to-end estimated_start<=0 honesty test through the real broker + CSV analytics path
affects:
  - Completes Phase 74 (both direct callers of the honest core now fail-loud + NaN-safe)
tech-stack:
  added: []
  patterns:
    - "Typed permanent catch mirroring LedgerValuationError (job_worker.py:1916-1941): typed subclass
      caught before the generic dispatcher classifier; scrub + strategy-mode stamp + permanent FAILED;
      narrow so a transient ValueError still falls through to stay retryable"
    - "Skip-NaN upsert list-comp filter (if pd.notna(val)) applied identically to both payload builders"
    - "Two-stage genuine end-to-end: REAL broker handler -> captured csv rows -> REAL run_csv_strategy_analytics"
key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_csv_analytics_runner.py
decisions:
  - "NaN policy = SKIP-NaN-row (74-01 sink-(b) finding), applied identically to both is_key_mode and
    strategy-mode payload builders — a guarded day has no interpretable return, so it is ABSENT"
  - "The broker->CSV path renders complete (with csv_source), NOT complete_with_warnings: the CSV job
    (run_csv_strategy_analytics) re-reads csv_daily_returns and has no access to the guard meta;
    carrying the guard flag through it would require touching analytics_runner.py (out of scope).
    The honesty this plan guarantees for the CSV path is the ABSENCE of a fabricated magnitude and the
    ABSENCE of a crash. complete_with_warnings IS produced on the run_strategy_analytics callsite (74-03)."
metrics:
  tasks_completed: 2
  files_modified: 3
  tests_added: 6
  full_suite: "2977 passed, 92 skipped"
  completed: 2026-07-06
requirements: [TWR-04]
---

# Phase 74 Plan 04: job_worker Broker Path — Fail-Loud + NaN-Safe Summary

The second direct caller of the Phase-73 honest core goes honest. The broker call
site `combine_realized_and_funding` (job_worker.py:2010, reached by every
Bybit/Binance/OKX/Deribit key + the reconcile harness) sits OUTSIDE the deribit
`LedgerValuationError` try, so a `NavReconstructionError` there escaped to the
generic dispatcher classifier and was retried forever as `unknown` (T-74-02 DoS).
Two behaviors landed: (1) a typed `NavReconstructionError` catch returns a terminal
PERMANENT `FAILED` (strategy-mode stamps a scrubbed terminal `failed`; key-mode skips
the stamp like the `<2` branch); (2) the `csv_daily_returns` upsert applies the 74-01
sink-(b) finding — a guarded-day NaN (`estimated_start<=0` → `negative_nav_guard`) is
SKIPPED so the day is honestly ABSENT, never a fabricated `0.0`, and never a crash at
the postgrest-py/httpx JSON encoder that rejects non-finite floats before send.

## What Was Built

- **Task 1 — typed NavReconstructionError permanent catch** (`job_worker.py`):
  imported `NavReconstructionError` from `services.nav_twr` (function-level, next to
  the `combine_realized_and_funding` import); wrapped the combine call at `:2010` in
  `try/except NavReconstructionError as exc:`. The handler lazily imports
  `scrub_freeform_string`, scrubs the message, and for strategy-mode upserts
  `strategy_analytics computation_status='failed'` with the scrubbed
  `computation_error` and `data_quality_flags={"csv_source": True}` (same inline-upsert
  shape as `_mark_insufficient`); key-mode skips the stamp (no per-key analytics row).
  Then `return DispatchResult(outcome=FAILED, error_kind="permanent")`. Narrowed to the
  typed subclass so a transient `ValueError` still falls through to the generic
  classifier and stays retryable. Mirrors the `LedgerValuationError` catch at
  `:1916-1941`.
- **Task 2 — NaN-safe upsert + end-to-end honesty** (`job_worker.py`,
  `test_csv_analytics_runner.py`): added `if pd.notna(val)` to BOTH the is_key_mode
  (`:2062-2071`) and strategy-mode (`:2074-2082`) `rows_payload` list-comprehensions
  (function-level `import pandas as pd`), so a guarded-day NaN row is skipped identically
  on both branches. Added a two-stage genuine end-to-end test: the REAL broker handler
  runs with a NaN-bearing combine output (leading + interior guarded days) and the
  captured `csv_daily_returns` rows are fed into the REAL `run_csv_strategy_analytics`
  with the REAL `compute_all_metrics` — proving guarded days are absent, the payload
  survives the httpx JSON encoder, the factsheet KPIs are all finite, and the run
  completes without an exception.

## The NaN Policy Applied (74-01 sink-(b) finding)

**SKIP-NaN-row.** `csv_daily_returns.daily_return` is `DOUBLE PRECISION` (it *stores*
NaN), but postgrest-py 2.31.0 / httpx 0.28.1 raise
`ValueError: Out of range float values are not JSON compliant: nan` when serializing the
upsert batch — BEFORE the request is sent. A guarded day has no interpretable return, so
the honest resolution is ABSENCE, not a persisted NaN and not a fabricated `0.0`. The
single-line list-comp filter is applied identically to both payload builders (the exact
location 74-01 pre-authorized). `len(returns) < 2` still counts NaN entries, so the
insufficient-history gate is unchanged; the `gap_fill` semantics are untouched.

## Status Honesty: complete, not complete_with_warnings (documented gap)

An `estimated_start<=0` broker account renders honest end-to-end — guarded days ABSENT,
finite factsheet, no crash — but the CSV analytics row is stamped `complete` (with
`csv_source`), NOT `complete_with_warnings`. This is architectural, not a defect of this
plan: the broker path enqueues `compute_analytics_from_csv` →
`run_csv_strategy_analytics`, which RE-READS `csv_daily_returns` (guarded days already
absent) and has no access to the honest core's guard meta; its `_mark_complete` writes
`data_quality_flags={"csv_source": True}` fresh, overwriting anything the broker path
could stamp. Surfacing `complete_with_warnings` on the CSV path would require carrying the
guard flag through `run_csv_strategy_analytics` — i.e. modifying `analytics_runner.py`,
which this plan explicitly excludes. `complete_with_warnings` IS produced on the
`run_strategy_analytics` (stored-trades) callsite wired in 74-03. See Deviations.

## TDD Gate Compliance

Both behavior-adding tasks followed RED → GREEN:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1 (NavReconstructionError catch) | `bb7356a5` | `82bf6822` |
| 2 (NaN-safe upsert + e2e) | `bb7356a5` | `c29fe845` |

The RED run was verified failing against the pre-implementation code before GREEN: Task 1
tests errored because `NavReconstructionError` escaped the handler (no catch); Task 2
tests failed because the upsert payload carried all 4 days including the 2 NaN rows. The
narrow-catch mutation test (`test_transient_valueerror_still_falls_through`) passed at RED
already — it fails only if the catch over-broadens.

## Deviations from Plan

### Surfaced conflict (Rule 7 / Rule 12 — fail loud, don't fabricate)

**1. [Finding] The broker→CSV path cannot render `complete_with_warnings` in-scope**
- **Found during:** Task 2 (designing the end-to-end honesty assertion).
- **Issue:** Plan Task 2 `<behavior>` and `<acceptance_criteria>` call for the end-to-end
  `estimated_start<=0` account to render `complete_with_warnings`. But the broker path uses
  the CSV analytics job (`run_csv_strategy_analytics`), which re-reads `csv_daily_returns`
  (guarded days already skipped) with no access to the guard meta, and whose `_mark_complete`
  overwrites `data_quality_flags` with `{csv_source: True}`. The guard-key → status promotion
  lives only on the `run_strategy_analytics` callsite (74-03).
- **Resolution:** Rather than fabricate a passing `complete_with_warnings` assertion the code
  does not produce, the end-to-end test asserts the honesty guarantees that ARE reachable and
  load-bearing: guarded days ABSENT, payload httpx-serializable (no crash), all factsheet KPIs
  finite (no fabricated/NaN magnitude), status `complete` with `csv_source`. Carrying the guard
  flag through the CSV job is a follow-up (would touch `analytics_runner.py`, out of scope;
  natural home Phase 75+). Documented in-test and in Status Honesty above.
- **Files:** `tests/test_csv_analytics_runner.py` · **Commit:** `c29fe845`

No auto-fixes (Rules 1–3) were needed — the plan-named guard location was localizable and the
combine call-site catch mirrored the existing LedgerValuationError template exactly.

## Known Stubs

None. The NaN skip and the permanent catch are fully wired and integration-tested end to end.

## Threat Flags

None. No new security surface. T-74-02 (retried-forever unknown) mitigated by the typed
permanent catch; T-74-01 (fabricated magnitude / crash on a guarded day) mitigated by the
skip-NaN upsert + the finite-KPI end-to-end assertion; T-74-03 (account-size USD in the
stamped `computation_error`) mitigated by `scrub_freeform_string` (proven by the redacted
`secret=` assertion); T-74-06 (guard warning mis-mapped to failed_final) not triggered — a
guard-flagged SUCCESS still returns DONE and enqueues the CSV job; `sync_strategy_analytics_status`
/ mig-038 untouched. No package installs.

## Out-of-scope (verified unchanged)

- `analytics_runner.py`, `transforms.py`, `nav_twr.py` — untouched (this plan owns the
  broker path only). Scope guard: `git diff --name-only` across all 4 commits shows ONLY
  `job_worker.py` + the two test files.
- `sync_strategy_analytics_status` / mig-038 — no migration touched. A guard-flagged SUCCESS
  keeps its `compute_job` `done`; the new permanent `failed` is exactly the terminal state
  mig-038 is meant to reflect.

## Verification

- `pytest tests/test_derive_broker_dailies_dualmode.py -q` — 10 passed (2 nav_error, 1 narrow,
  2 nan_upsert + 5 pre-existing dual-mode).
- `pytest tests/test_csv_analytics_runner.py::TestNaNAccountHonestEndToEnd` — PASS.
- `pytest tests/test_derive_broker_dailies_dualmode.py tests/test_csv_analytics_runner.py -q` — 21 passed.
- `mypy --strict --follow-imports=silent services/job_worker.py` — clean.
- **Full analytics suite (CI-3.12 venv): 2977 passed, 92 skipped** (~35s) — +6 vs 74-03's 2971;
  all 74-01 byte-identity pins and 74-02/74-03 pins stayed GREEN.
- Scope guard: only `job_worker.py` + the two test files changed; no migration / analytics_runner /
  transforms / nav_twr touched.

## Commits

- `bb7356a5` test(74-04): RED broker-path NavReconstructionError permanent catch + NaN-safe csv_daily_returns upsert
- `82bf6822` feat(74-04): typed NavReconstructionError permanent catch on the broker path
- `c29fe845` feat(74-04): NaN-safe csv_daily_returns upsert + estimated_start<=0 end-to-end honesty

## Self-Check: PASSED

All 3 commits present in git log; all 3 modified files exist; scope guard clean; full analytics
suite 2977 passed / 92 skipped.
