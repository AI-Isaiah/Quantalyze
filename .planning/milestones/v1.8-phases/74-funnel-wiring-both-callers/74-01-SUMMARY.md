---
phase: 74-funnel-wiring-both-callers
plan: 01
subsystem: analytics
tags: [nav-twr, tests, pre-flight, snapshot-pins, nan-tolerance, flow-aware-twr]
requires:
  - services/transforms.py (trades_to_daily_returns_with_status)
  - services/broker_dailies.py (combine_realized_and_funding)
  - services/nav_twr.py (chain_linked_twr guarded-day NaN semantics)
provides:
  - Revert-proof byte-identity snapshot pins for all 3 flow-less input shapes + heuristic branch
  - Definitive per-sink NaN-tolerance finding (authoritative input to 74-03/74-04)
affects:
  - Plan 74-02 (delegation diff must keep these pins GREEN)
  - Plan 74-03 / 74-04 (consume the NaN-tolerance finding)
tech-stack:
  added: []
  patterns:
    - "Byte-identity snapshot pin (rtol 1e-12, check_names=False) mirroring test_nav_twr SC-4"
    - "Empirical downstream-sink characterization at the real transport boundary (httpx JSON encode)"
key-files:
  created: []
  modified:
    - analytics-service/tests/test_csv_analytics_runner.py
    - analytics-service/tests/test_transforms.py
    - analytics-service/tests/test_broker_dailies.py
decisions:
  - "Sink (a) TOLERATES NaN; Sink (b) NEEDS-A-GUARD (skip-NaN in the upsert list-comp)"
metrics:
  tasks_completed: 3
  files_modified: 3
  tests_added: 5
  full_suite: "2959 passed, 92 skipped"
  completed: 2026-07-05
---

# Phase 74 Plan 01: Wave 0 Pre-flight (NaN-tolerance + byte-identity safety net) Summary

Wave 0 pre-flight for the high-blast-radius transforms.py refactor: resolved the one
LOW-confidence NaN-tolerance dependency with a definitive per-sink empirical finding, and
authored the revert-proof byte-identity snapshot pins that freeze today's exact numbers for
every flow-less input shape (plus the heuristic branch) so 74-02's delegation is provably
behavior-preserving. No production code changed.

## What Was Built

- **Task 1 — NaN-tolerance characterization** (`test_csv_analytics_runner.py`): two pins in
  `TestNaNReturnsDownstreamTolerance` that empirically fix the current behavior of BOTH
  downstream sinks against a leading+interior NaN Series (the exact shape the flow-aware core
  emits for an `estimated_start<=0` guarded-day account).
- **Task 2 — byte-identity pins** (`test_transforms.py`, `TestByteIdentitySnapshotPins`):
  `test_byte_identical_daily_pnl_snapshot`, `test_byte_identical_individual_snapshot`, and
  (hardening) `test_byte_identical_heuristic_snapshot`.
- **Task 3 — broker byte-identity pin** (`test_broker_dailies.py`):
  `test_byte_identical_combine_snapshot` freezing the gap-filled realized+funding series and
  asserting the dense-calendar / 0.0-no-activity invariant.

## NaN-Tolerance Finding (authoritative input to 74-03 / 74-04)

Guarded days in `nav_twr.chain_linked_twr` emit `np.nan` (never a substituted floor). The
returns Series that reaches the shared path after 74-02 can therefore carry LEADING and
INTERIOR NaN. Empirically verified in the CI-3.12 venv against the real code + transport:

### Sink (a) — `compute_all_metrics` + `compute_period_returns` (analytics_runner path): **TOLERATES**

- `compute_all_metrics` does NOT crash on a NaN-bearing Series. `len(returns)` counts NaN
  entries, so the `len(returns) < 2` precondition is satisfied by guarded days rather than
  tripped by them.
- NaN days are honestly EXCLUDED from statistics: headline `cumulative_return` uses
  `(1 + returns.dropna()).prod() - 1` (verified byte-equal to the manual dropna value), and the
  chart-only equity uses `returns.fillna(0)` — a guarded day never becomes a fabricated magnitude.
- `compute_period_returns`: MTD/YTD compound via `.prod()` (skipna default) so NaN days are
  skipped; a NaN LAST day nulls `return_24h` via `_safe_float(nan) -> None` (honest null, not a
  fabricated number).
- **Disposition: no guard needed.** The pin `test_nan_returns_downstream_tolerance` locks this.

### Sink (b) — `csv_daily_returns` `float(val)` upsert (`job_worker.py:2068` / `:2078`): **NEEDS-A-GUARD**

- The `daily_return` column is `DOUBLE PRECISION NOT NULL` (migration
  `20260522111839_csv_daily_returns.sql:39`), which *stores* NaN fine — so the column type is
  not the constraint.
- `float(np.nan)` does NOT crash at the Python conversion (`job_worker.py:2068`). The failure is
  one layer down: the **postgrest-py 2.31.0 / httpx 0.28.1 JSON encoder raises**
  `ValueError: Out of range float values are not JSON compliant: nan` when it serializes the
  upsert batch — BEFORE the request is sent. A guarded-day NaN would therefore **crash the
  upsert fail-loud**, not persist silently.
- **Guard location (localizable — NO HALT): `job_worker.py:2062-2082`.** Skip NaN rows in the
  upsert list-comprehension so a guarded day is ABSENT from `csv_daily_returns` (it has no
  interpretable return), rather than attempting to transmit/persist a NaN. This is the exact
  location the plan pre-authorized; the fix is a single list-comprehension filter, so no
  architectural change is required. The pin `test_nan_return_upsert_serialization_fails_loud`
  locks the current fail-loud behavior at the httpx boundary.
- **Consumed by 74-03 / 74-04:** when the shared path flips to emit guarded-day NaN, the
  csv_daily_returns writer MUST filter NaN rows at `job_worker.py:2062-2082`. Sink (a) requires
  no change.

## Byte-Identity Snapshot Pins (revert-proof safety net — must stay GREEN all phase)

All pins freeze TODAY's exact output to `rtol=1e-12`, index-name excluded (the "returns" vs
input index-name convention is cosmetic, per the SC-4 pattern). None assert NaN/guard behavior
(that is 74-02's divergence pin); every fixture is `estimated_start>0` or the heuristic branch so
no guard fires.

| Pin | Branch | Fixture | Meta |
|-----|--------|---------|------|
| `test_byte_identical_daily_pnl_snapshot` | daily_pnl (`transforms.py:120-176`) | acct 250k, Σpnl 1800 → est_start 248,200 | complete |
| `test_byte_identical_individual_snapshot` | individual trades (`:178-212`) — net-new vs SC-4 | acct 50k, raw buy/sell fills w/ fees | complete |
| `test_byte_identical_heuristic_snapshot` (hardening) | heuristic (`:160-169`, `account_balance=None`) | process_key:896 path | complete_with_warnings |
| `test_byte_identical_combine_snapshot` | broker combine (`broker_dailies.py:130`) | realized(01/02/05)+funding(01/03), acct 180k | complete |

The broker pin also asserts the gap-fill invariant: dense calendar over `[first,last]`
(02-04 inserted) with the no-activity day == 0.0.

## Deviations from Plan

### Auto-added (plan `<critical>` hardening directive)

**1. [Rule 2 - directed hardening] Heuristic-branch byte-identity pin**
- **Added:** `test_byte_identical_heuristic_snapshot` for the `account_balance=None`
  (process_key:896) heuristic sub-branch, per the plan's ADDITIONAL HARDENING note
  (plan-checker Warning 2), so the flow-less invariance guarantee covers that branch too.
- **File:** `analytics-service/tests/test_transforms.py`
- **Commit:** `ff96df6d`

No production code changed. No HALT triggered — the sink (b) guard is localizable to the
plan-named location.

## Known Stubs

None. This plan adds tests + a documented finding only.

## Threat Flags

None. No new security surface (test fixtures use synthetic amounts; T-74-01 mitigated by the
Task-1 empirical verification; no package installs).

## Verification

- `test_csv_analytics_runner.py -k nan_returns_downstream_tolerance` — PASS (both sink pins).
- `test_transforms.py -k byte_identical_*` — 3 PASS.
- `test_broker_dailies.py -k byte_identical_combine_snapshot` — PASS.
- Quick regression `test_transforms.py test_broker_dailies.py test_nav_twr.py test_csv_analytics_runner.py` — 81 passed.
- Full analytics suite (CI-3.12 venv) — **2959 passed, 92 skipped** in ~61s.

## Commits

- `ca2c1f7a` test(74-01): characterize NaN-tolerance of both downstream sinks
- `ff96df6d` test(74-01): byte-identity snapshot pins for daily_pnl + individual + heuristic branches
- `67a9e0ae` test(74-01): byte-identity snapshot pin for broker combine_realized_and_funding

## Self-Check: PASSED

All 3 modified test files exist; all 3 task commits (ca2c1f7a, ff96df6d, 67a9e0ae) present in git log.
