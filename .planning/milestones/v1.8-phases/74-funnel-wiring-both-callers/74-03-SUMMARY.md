---
phase: 74-funnel-wiring-both-callers
plan: 03
subsystem: analytics
tags: [nav-twr, flow-aware-twr, analytics-runner, data-quality-flags, status-promotion, fail-loud, tdd]
requires:
  - services/analytics_runner.py (run_strategy_analytics — the CSV/stored-trades callsite at :1309)
  - services/nav_twr.py (NavReconstructionError, NavTWRMeta guard keys — from 74-02)
  - services/transforms.py (trades_to_daily_returns_with_status returns NavTWRMeta — from 74-02)
provides:
  - The three NAV-denominator guard keys (negative_nav_guard / dust_nav_guard /
    flow_dominated_guard) lift from returns_meta into strategy_analytics.data_quality_flags
  - A fired guard promotes computation_status to complete_with_warnings; a no-guard
    flow-less account stays computation_status=complete (status-identical; 8 exact-string
    consumers unaffected)
  - A NavReconstructionError at the analytics_runner callsite lands a terminal permanent
    failed (HTTPException 422 -> classify_exception permanent), not a retried-forever unknown
affects:
  - Plan 74-04 (job_worker broker path: the parallel NavReconstructionError catch + NaN-safe upsert)
  - The 8 frontend consumers gating exact-string on computation_status === "complete" (verified unaffected)
tech-stack:
  added: []
  patterns:
    - "DQF-predicate promotion (not raw hint): guard keys join used_heuristic_capital /
      balance_error in the consumer_specific_flags OR, keeping the deliberate DQF-predicate
      design over reading computation_status_hint (RESEARCH anti-pattern)"
    - "Additive guard-key lift with None-vs-empty-dict guarding: keys present ONLY when fired
      (NavTWRMeta total=False), so a clean run trips none and stays byte/status-identical"
    - "Typed permanent catch mirroring LedgerValuationError (job_worker.py:1916-1941): typed
      subclass before the generic except; stamp failed; raise 4xx; scrub; narrow so transient
      ValueErrors still fall through to the generic 500"
    - "No from-exc chain on the raised HTTPException so an unscrubbed NavReconstructionError
      repr cannot leak into classify_exception's __cause__ append (T-74-03)"
key-files:
  created: []
  modified:
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_analytics_runner.py
decisions:
  - "Guard keys added to the DataQualityFlags TypedDict (analytics_runner.py:163+) so the
    additive lift type-checks under mypy --strict — same treatment as used_heuristic_capital"
  - "HTTPException(422) chosen (not 400) to distinguish a structural NAV/TWR fault from the
    pre-existing 400 'Insufficient trading days'; both are in the 400..499 permanent bucket"
  - "Raised HTTPException carries detail=<fixed string> and NO `from exc`; the raw exception
    message is scrubbed and stamped in computation_error only — prevents the unscrubbed repr
    leaking into compute_jobs.error_message via classify_exception's __cause__ append"
metrics:
  tasks_completed: 2
  files_modified: 2
  tests_added: 5
  full_suite: "2971 passed, 92 skipped"
  completed: 2026-07-06
requirements: [TWR-04]
---

# Phase 74 Plan 03: Funnel Wiring — analytics_runner Status Wiring Summary

Routes the honest core's DQ signal and fail-loud error type through the
`analytics_runner.run_strategy_analytics` callsite (the CSV / stored-trades path
at `:1309` and the status chokepoint for all 8 frontend consumers). Two
behaviors landed: (1) the three NAV-denominator guard keys the honest core
carries on `returns_meta` (74-02) now lift into `data_quality_flags` and promote
`computation_status` to `complete_with_warnings`, while a no-guard flow-less
account stays exactly `complete` (the 8 `=== "complete"` consumers are
status-identical); (2) a `NavReconstructionError` at the callsite now lands a
terminal permanent `failed` (HTTPException 422) instead of the retried-forever
`unknown` a bare ValueError becomes via the generic 500 handler.

## What Was Built

- **Task 1 — NAV-guard DQF lift + status promotion** (`analytics_runner.py`):
  after the existing `used_heuristic_capital` / `balance_error` lift
  (`~:1704-1713`), a loop reads the three guard keys
  (`negative_nav_guard`, `dust_nav_guard`, `flow_dominated_guard`) from
  `returns_meta` and sets each into `data_quality_flags` ONLY when
  present-and-True — same additive, None-vs-empty-dict-guarding shape as
  `used_heuristic_capital`. The `consumer_specific_flags` promotion predicate
  (`~:1775-1788`) is extended to OR in the three guard keys so a guarded run
  promotes to `complete_with_warnings`. The three keys were added to the
  `DataQualityFlags` TypedDict so the lift type-checks under `mypy --strict`.
  The raw `computation_status_hint` is deliberately NOT read as the source (the
  DQF-predicate design is preserved). Section-level flags and the `complete`
  path for no-guard runs are untouched.
- **Task 2 — typed NavReconstructionError permanent catch** (`analytics_runner.py`):
  imported `NavReconstructionError` from `services.nav_twr`; added
  `except NavReconstructionError as exc:` BEFORE the generic `except Exception`
  (`~:1896`). It lazily imports `scrub_freeform_string`, scrubs the message,
  upserts `computation_status='failed'` with the scrubbed
  `computation_error`, then `raise HTTPException(status_code=422, ...)` so
  `classify_exception` buckets it permanent (422 ∈ 400..499, not 408/429/403/404).
  Narrow to the typed subclass so a transient ValueError escaping elsewhere still
  falls through to the generic 500 handler and stays retryable. Mirrors the
  `LedgerValuationError` catch at `job_worker.py:1916-1941`.

## Status Invariant (SC-4): the 8 consumers stay safe

A no-guard, flow-less, `estimated_start>0` account carries ZERO guard keys
(NavTWRMeta is `total=False` — a key is present only when it fired), so the
promotion predicate does not trip and `computation_status` stays `complete` —
byte- AND status-identical to today. `test_complete_unchanged_no_guard_flow_less_stays_complete`
pins this (drives a fully clean run with a valid non-stale benchmark and asserts
`complete` + zero guard keys). The consumer list at `analytics_runner.py:1760-1767`
(factsheet PDFs, discovery, strategy detail, portfolios, PerformanceReport,
SyncProgress, queries) is unaffected.

## TDD Gate Compliance

Both behavior-adding tasks followed RED → GREEN:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1 (DQF lift + promotion) | `7d3fa7ef` (2 promotion tests fail, invariant passes) | `077393f3` |
| 2 (permanent catch) | `fc233bff` (permanent test fails at 500, narrow test passes) | `88712263` |

Each RED run was verified failing against the pre-implementation code before
GREEN (Task 1: guard keys dropped from DQF + status stuck at `complete`; Task 2:
NavReconstructionError → generic 500 `unknown`). The narrow-catch invariant
(`test_nav_error_permanent_catch_is_narrow_transient_valueerror_still_5xx`)
passed at RED already — proving the mutation honesty of the change: it fails only
if the catch over-broadens.

## Threat Register Mitigations

| Threat | Mitigation landed |
|--------|-------------------|
| T-74-02 (DoS: permanent NAV fault retried forever as unknown) | Task 2 typed catch → HTTPException 422 → classify_exception permanent |
| T-74-05 (Tampering: guarded NaN account rendered canonical-complete) | Task 1 promotes guard runs to complete_with_warnings; no-guard runs stay complete |
| T-74-03 (Info disclosure: account-size USD in stamped computation_error) | scrub_freeform_string before stamping; no `from exc` chain so the unscrubbed repr never reaches classify_exception's __cause__ append |

## Deviations from Plan

### Auto-added (Rule 2 — correctness/security requirements)

**1. [Rule 2 — Type] Guard keys added to the DataQualityFlags TypedDict**
- **Found during:** Task 1 (mypy --strict).
- **Issue:** `data_quality_flags["negative_nav_guard"] = True` failed
  `mypy --strict` with `TypedDict "DataQualityFlags" has no key "negative_nav_guard"` —
  the assignment target is the typed `DataQualityFlags`, not the widened
  `dict[str, Any]` used later for `top_level_flags`.
- **Fix:** added `negative_nav_guard` / `dust_nav_guard` / `flow_dominated_guard`
  (all `bool`) to the `DataQualityFlags` TypedDict (`analytics_runner.py:163+`),
  same treatment as `used_heuristic_capital` / `balance_error`.
- **Files:** `analytics-service/services/analytics_runner.py` · **Commit:** `077393f3`

**2. [Rule 2 — Security] No `from exc` on the raised HTTPException**
- **Found during:** Task 2 (adversarial review of the info-disclosure surface).
- **Issue:** `classify_exception` (job_worker.py:369-371) appends
  `repr(__cause__)[:180]` to the error_message it returns for compute_jobs. A
  `raise HTTPException(...) from exc` would set `__cause__` to the UNscrubbed
  `NavReconstructionError` (whose message carries the row repr / any USD
  magnitude), leaking it into `compute_jobs.error_message` — defeating the
  scrub. The plan specified `detail=<scrubbed>` but did not address the cause
  chain.
- **Fix:** raise WITHOUT `from exc`; pass a fixed `detail` string (the scrubbed
  text lives in the stamped `computation_error` only). Implicit `__context__` is
  still set for traceback debugging but `classify_exception` reads `__cause__`
  (None here), so no leak.
- **Files:** `analytics-service/services/analytics_runner.py` · **Commit:** `88712263`

## Known Stubs

None. `external_flows` / `open_unrealized_usd` remain wired-but-inert upstream
(74-02, Phases 75/77) but that is out of this plan's scope. The guard-key lift
and the permanent catch are fully wired and integration-tested.

## Out-of-scope (verified unchanged)

- `job_worker.py` — the parallel NavReconstructionError catch on the broker path
  is Plan 74-04. Untouched here.
- `transforms.py` — untouched (74-02 delegated it; this plan is the consumer).
- `sync_strategy_analytics_status` / mig-038 — no migration touched. A
  guard-flagged SUCCESS keeps its `compute_job` `done`; the new permanent
  `failed` is exactly the terminal state mig-038 is meant to reflect.

## Verification

- `pytest tests/test_analytics_runner.py -k "status_guard_promotion or complete_unchanged"` — GREEN (3).
- `pytest tests/test_analytics_runner.py -k "nav_error_permanent"` — GREEN (2).
- `pytest tests/test_analytics_runner.py -k "consumer_migration"` — GREEN (existing status contract unbroken).
- `mypy --strict --follow-imports=silent services/analytics_runner.py` — clean.
- **Full analytics suite (CI-3.12 venv): 2971 passed, 92 skipped** (~33s) — the
  74-01 byte-identity pins and 74-02 delegation pins all stayed GREEN (+5 = the 5 new tests).
- Scope guard: `git diff --name-only` shows ONLY `analytics_runner.py` +
  `test_analytics_runner.py` changed — no job_worker / transforms / migration / .sql.

## Commits

- `7d3fa7ef` test(74-03): RED NAV-guard DQF lift + status promotion (invariant stays complete)
- `077393f3` feat(74-03): lift NAV-guard keys into DQF + promote computation_status
- `fc233bff` test(74-03): RED NavReconstructionError permanent catch at callsite
- `88712263` feat(74-03): typed NavReconstructionError permanent catch at callsite

## Self-Check: PASSED

All 4 commits present in git log; `74-03-SUMMARY.md` exists; only the two allowed
files changed (scope guard clean); full analytics suite 2971 passed / 92 skipped.
