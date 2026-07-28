---
phase: 105-composite-the-one-csv-finalize-route
plan: 04
subsystem: analytics-service (single-key CSV runner)
tags: [BB-02, backbone-unification, cash-scalar, SC-4, dailies-canonical]
requires:
  - 105-01 (derive_basis_series scalar_returns/densify_policy params)
  - 105-03 (single-key seam; _trusted_cash_payload gate)
provides:
  - single-key cash SCALAR routed through the ONE shared derive_basis_series
  - cash_settlement SERIES persisted before the scalar flip (D5 ordering)
  - terminal-arm heal-delete of the cash series row (D3 defense-in-depth)
affects:
  - services/analytics_runner.py:run_csv_strategy_analytics
tech-stack:
  added: []
  patterns:
    - shared-route adoption (scalar_returns = legacy-conditioned series, D1)
    - series-before-scalar ordered-idempotent persist (D5)
    - swallow+warn terminal heal-delete (mirrors job_worker._heal_delete_basis_series)
key-files:
  created: []
  modified:
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_csv_analytics_runner.py
    - analytics-service/tests/test_cash_basis_series_sc4.py
    - analytics-service/tests/test_analytics_runner.py
decisions:
  - "Re-pointed the :921/:981 behavior tests' patch target to services.basis_series (the plan claimed they patch nothing on the compute path — they DO, via a spy); assertions kept byte-identical, so SC-4 conditioning evidence is preserved."
  - "Fixed test_analytics_runner.py::test_csv_sibling_upsert_failure (not the sibling's file) — the D5 persist RPC now precedes the scalar flip, so its blanket sb.rpc failure had to distinguish the cash persist (must succeed) from the sibling blip."
  - "Deleted the Phase-104 SC-2 boundary guard (test_analytics_runner_series_only_boundary) — its own docstring named this plan's reroute as the mutation it kills; retired by design."
  - "DICT-EQUAL implemented as json.dumps(sort_keys) byte-identity — NaN-safe (both sides are the SAME computation), never a tolerance."
metrics:
  tasks: 2
  files_modified: 4
  commits: 3
  completed: 2026-07-14
---

# Phase 105 Plan 04: Single-Key CSV Cash-Scalar Shared-Route Swap Summary

Collapse #2 of BB-02: `run_csv_strategy_analytics`'s inline `compute_all_metrics`
(the last single-key cash bypass) now routes through the one shared
`derive_basis_series`, making the single-key cash scalar a cache of a persisted
`cash_settlement` series — byte-identical to the legacy compute BY CONSTRUCTION
(scalar_returns = the exact `:2272` broker-dense-NaN / user-sparse conditioned series).

## What was built

**Task 1 — the swap + persist-before-scalar + heal** (`analytics_runner.py`)
- The `:2318` inline `compute_all_metrics(returns, …)` is GONE. It is replaced by
  `derive_basis_series(returns, benchmark_rets, …, benchmark_symbol="BTC",
  scalar_returns=returns, densify_policy="broker_nan" if _is_broker_sourced else "sparse")`.
  `returns` serves both params: as `returns` it feeds the honest sparse rows/gap_spans;
  as `scalar_returns` it is the exact legacy compute input (D1 → byte-identical scalar).
- A `cash_settlement` series row is persisted (`persist_basis_series`) IMMEDIATELY
  BEFORE the `strategy_analytics` scalar/status flip (D5 — a `complete` scalar never
  exists without its series; a persist failure fails-loud before the flip).
- The unrecoverable catch-all arm heal-deletes the cash series row
  (`persist_basis_series(result=None)`), swallow+warn so a heal failure never masks
  the terminal stamp (mirrors `job_worker._heal_delete_basis_series`).
- Function-local import of `derive_basis_series`/`persist_basis_series` before the
  `try:` (binds the names for both the success persist and the except-arm heal).

**Task 2 — the three runner SC-4 dual-run fixtures** (`test_cash_basis_series_sc4.py`)
- `test_user_csv_weekend` (broadest blast radius), `test_broker_guard_day`,
  `test_zavara_simple_active` — each runs the REAL `run_csv_strategy_analytics` (no
  compute patch) and compares the persisted scalar against an in-test legacy recompute.

## Grep proof — the :2318 inline compute is GONE

```
$ grep -n "compute_all_metrics(" services/analytics_runner.py
1678:        metrics_result = compute_all_metrics(      # OUT OF SCOPE (stored-trades path)
$ grep -n "derive_basis_series(" services/analytics_runner.py
2342:        metrics_result = derive_basis_series(       # the swap
```
Only the out-of-scope `:1678` (`run_strategy_analytics`) site remains; the single-key
CSV path is on the shared route.

## Behavior tests (:921 / :981)

`test_broker_series_reinstates_interior_nan_suffix_only_headline` (:921) and
`test_user_csv_sparse_day_not_nan_filled` (:981) stayed **green with their ASSERTIONS
UNMODIFIED**. Their patch-target string was re-pointed
`services.analytics_runner.compute_all_metrics` → `services.basis_series.compute_all_metrics`
(see Deviations) — the spy captures the identical conditioned series (`scalar_returns ==
returns` by construction), so every NaN-reinstatement / sparsity assertion holds
byte-for-byte. This is a deviation from the plan's (incorrect) claim that they "patch
nothing on the compute path."

## Three dual-run results (byte-identity)

| Fixture | Conditioning | DICT-EQUAL vs legacy oracle | Extra proof |
|---|---|---|---|
| `test_user_csv_weekend` | user CSV, sparse verbatim (densify="sparse") | scalar == compute(SPARSE) | scalar ≠ compute(gap_fill(sparse)); `volatility` differs (divergence is real) |
| `test_broker_guard_day` | broker dense-reindex, interior NaN (densify="broker_nan") | scalar == compute(dense-with-NaN) | guard day `2024-01-03` ABSENT from persisted rows |
| `test_zavara_simple_active` | broker + simple/active override | scalar == compute(…, simple, active) | conventions echo `{365, simple, active, BTC, broker_nan}` |

DICT-EQUAL is a `json.dumps(sort_keys=True)` byte-identity comparison (NaN-safe — the
broker guard-day metrics carry NaN keys that `==` would mishandle); NEVER a tolerance.

## Ordering + heal test results

- `test_cash_series_persists_before_complete_scalar_upsert` — asserts the cash-series
  persist event precedes the `complete` scalar upsert (RED before the swap; neuter:
  move the persist after `_mark_complete`).
- `test_terminal_failure_heals_cash_series_row` — asserts the catch-all heal-deletes
  the `cash_settlement` row (kind + strategy_id filters); RED before the heal existed.

## Verification

- `pytest tests/test_csv_analytics_runner.py tests/test_analytics_runner.py
  tests/test_cash_basis_series_sc4.py tests/test_basis_series.py` → **213 passed**.
- Wave gate `pytest --cov --cov-fail-under=80` → **3715 passed, 93 skipped, coverage
  92.20%** (gate ≥ 80%).

## Deviations from Plan

### Auto-fixed / re-pointed

**1. [Rule 1 — plan factual error] Behavior tests :921/:981 required patch-target re-point**
- **Found during:** Task 1.
- **Issue:** The plan asserted :921/:981 "patch nothing on the compute path" and must
  stay unmodified. They DO patch `services.analytics_runner.compute_all_metrics` (a
  `_spy_compute` capturing the conditioned series). After the swap that patch stops
  intercepting (the compute moved inside `services.basis_series`), so leaving them
  unmodified would redden them (KeyError — spy never invoked).
- **Fix:** Re-pointed the patch target to `services.basis_series.compute_all_metrics`.
  ALL assertions are byte-identical; `scalar_returns == returns` means the spy captures
  the exact same conditioned series, so the SC-4 conditioning evidence is preserved.
- **Files:** `tests/test_csv_analytics_runner.py`. **Commit:** c6be6233.

**2. [Rule 1 — plan under-scoped] test_analytics_runner.py sibling-blip test broke**
- **Found during:** Task 1 GREEN verify.
- **Issue:** `test_csv_sibling_upsert_failure_keeps_complete_status` (in
  `test_analytics_runner.py`, NOT a sibling-agent file) failed: the new D5 cash-series
  persist routes through `sb.rpc` BEFORE the scalar flip, and the test's blanket
  `sb.rpc` failure hit the persist → whole run failed. This is CORRECT fail-loud
  behavior (a persist failure legitimately aborts before the flip).
- **Fix:** Made the rpc mock distinguish the persist call (`p_kinds` has
  `cash_settlement` → succeeds) from the sibling blip (no cash kind → raises); re-pointed
  its compute patch to `services.basis_series`. The plan's `<verification>` explicitly
  runs `test_analytics_runner.py`, so this fix is in-scope.
- **Files:** `tests/test_analytics_runner.py`. **Commit:** c6be6233.

**3. [Rule 3 — planned deletion] Retired the Phase-104 SC-2 boundary guard**
- `test_analytics_runner_series_only_boundary` (in the SC-4 file I own) asserted
  `analytics_runner.py` has ZERO `basis_series` references. Its docstring named "a
  premature Phase-105 cash-scalar reroute" as the mutation it kills — this plan IS that
  reroute. Deleted deliberately, replaced by a comment pointing at the three positive
  dual-run proofs. **Commit:** c6be6233.

### Not deviations
- The two other cash-bypass sites (`:1678`, `process_key.py`) were left untouched
  (out of scope / carved to 105.1).
- `job_worker.py` and the sibling's test files were NOT read-then-edited or touched.

## Threat Flags

None. The change introduces no new network endpoint, auth path, or schema surface —
it consolidates an existing compute onto the shared route and adds a persist/heal that
mirror the already-mitigated job_worker seam (T-105-10/11/12 dispositions satisfied).

## Self-Check: PASSED
- Files present: `analytics_runner.py`, `test_csv_analytics_runner.py`,
  `test_cash_basis_series_sc4.py` (all FOUND).
- Commits present: e444b2fa (test RED), c6be6233 (feat GREEN), a76b9f18 (test Task 2).
- TDD gate: `test(105-04)` RED commit precedes `feat(105-04)` GREEN commit.
