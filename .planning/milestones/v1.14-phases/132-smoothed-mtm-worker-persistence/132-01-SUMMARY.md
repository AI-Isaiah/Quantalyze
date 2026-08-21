---
phase: 132-smoothed-mtm-worker-persistence
plan: 01
subsystem: analytics-service (worker persistence of the smoothed_mtm third factsheet basis)
tags: [deribit, options, smoothed_mtm, worker, persistence, fail-loud, sc-4, money-path]
requires:
  - PNL_BASIS_SMOOTHED_MTM + use_smoothed branch + ΔMTM adapter merge (131-01a/01b)
  - CompletenessReport.pre_mark_retention_option_days (131-01b)
provides:
  - KIND_SMOOTHED_MTM in basis_series._KIND_BY_BASIS (persist kind; no DDL)
  - single-key smoothed_mtm third pass (run_derive_broker_dailies_job) → series + by-basis
  - composite smoothed_mtm third pass (run_stitch_composite_job) → series + by-basis
  - smoothed_mtm_available(members) predicate (opens the unsmoothed_options_book gate)
  - NAV_TWR_GUARD_KEYS entry pre_mark_retention_option_dailies (complete_with_warnings)
affects:
  - strategy_analytics.metrics_json_by_basis (gains the smoothed_mtm key on options books)
  - strategy_analytics_series (gains the smoothed_mtm_daily_returns kind)
tech-stack:
  added: []  # no new packages (threat T-131-SC accept upheld)
  patterns:
    - "additive THIRD pass cloned from the MTM second pass, gated on option-activity, never reassigning cash/MTM objects"
    - "smoothed availability is a SEPARATE predicate keyed on option-activity ALONE; the MTM gate decision stays byte-identical"
    - "smoothed persist is GUARDED (only on a completed pass) unlike the always-heal MTM persist — SC-4: no-option keys persist NO smoothed artifacts"
    - "fail-loud on holed marks (LedgerValuationError → whole job); scalar-compute ValueError degrades symmetrically with MTM (honest omission, not fabrication)"
key-files:
  created: []
  modified:
    - analytics-service/services/basis_series.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/stitch_composite.py
    - analytics-service/services/nav_twr.py
    - analytics-service/tests/test_basis_series.py
    - analytics-service/tests/test_mtm_single_key.py
    - analytics-service/tests/test_stitch_composite.py
    - analytics-service/tests/test_stitch_composite_job.py
    - analytics-service/tests/test_cash_basis_series_sc4.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_composite_headline_parity.py
    - analytics-service/tests/test_nav_twr.py
    - analytics-service/tests/test_sfox_reconstruct.py
decisions:
  - "Smoothed series persist is GUARDED (only when attempted+computed), NOT the always-heal MTM pattern — the plan's must-have 'no-option keys persist NO smoothed artifacts / byte-identical persisted rows' forbids a smoothed RPC on a no-option key. Trade-off: an options→perp-only reconfiguration leaves a latent stale smoothed series row (the by-basis SCALAR heals via the wholesale metrics_json_by_basis write, and the frontend gates on the scalar), documented as a known limitation."
  - "Smoothed LEDGER/marks reconstruction fail-loud (holed marks / retention-straddle LedgerValuationError → whole job fails) is non-negotiable; the downstream SCALAR compute (compute_all_metrics ValueError on a cumulative_method='simple' interior chain-break) DEGRADES symmetrically with MTM — a math chain-break over an honest series is honest omission, not marks fabrication. Composite: both MTM and smoothed already fail-loud on the metrics ValueError (existing composite semantics), so the smoothed composite mirrors that."
  - "The pre_mark_retention_option_dailies warn flag was registered in NAV_TWR_GUARD_KEYS + NavTWRMeta (the idiomatic one-source-of-truth mechanism the plan says to clone) so the broker prestamp (job_worker) and the analytics_runner promotion both pick it up by construction."
metrics:
  duration: ~4h
  completed: 2026-07-22
  tasks: 3
  new_tests: 18  # 5 basis_series + 6 single-key + 7 stitch-unit + 3 composite-job (minus overlaps)
---

# Phase 132 Plan 01: smoothed_mtm worker persistence Summary

Wired the proven 131 smoothed core into worker persistence: both the single-key and
composite routes now run a THIRD `smoothed_mtm` ledger pass, persist a
`smoothed_mtm_daily_returns` series (`KIND_SMOOTHED_MTM`), and write
`metrics_json_by_basis.smoothed_mtm` — and, the point of the phase, the smoothed basis
OPENS the `unsmoothed_options_book` gate that `mark_to_market` honestly keeps closed,
while the MTM gate decision stays byte-identical. Fail-loud on holed marks; SC-4 holds
at the worker layer (no option activity ⇒ no third pass ⇒ no smoothed artifacts).

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | KIND_SMOOTHED_MTM + enum↔kind sync pin | 107887d9 | basis_series.py, test_basis_series.py |
| 2 | Single-key third smoothed pass + persistence | cad6a898 | job_worker.py, nav_twr.py, test_mtm_single_key.py (+4 harness files) |
| 3 | Composite third pass + OPEN the gate | 60800ee9 | stitch_composite.py, job_worker.py, test_stitch_composite*.py (+2 harness files) |

### Task 1 — KIND_SMOOTHED_MTM
`KIND_SMOOTHED_MTM = "smoothed_mtm_daily_returns"` + `_KIND_BY_BASIS["smoothed_mtm"]`
(no DDL — `kind` is unconstrained TEXT). `derive_basis_series` / `persist_basis_series`
untouched (basis-agnostic). Added a GENERIC enum↔kind sync pin over
`deribit_txn._PNL_BASES` so a future fourth basis with no map entry fails loud here.
RED (ImportError) → GREEN. `test_basis_series.py` 30 → 35.

### Task 2 — single-key third pass
A third `build_deribit_native_ledger(pnl_basis=smoothed_mtm)` + `combine` + `derive` +
GUARDED persist, inserted AFTER the MTM second pass, gated on the SAME
`not is_key_mode AND cash-headline AND has_option_activity` predicate (no new signal).
`metrics_json_by_basis` gains `smoothed_mtm` alongside `mark_to_market`; smoothing
OPENS what MTM keeps closed (present even when MTM degrades). A holed-marks
`LedgerValuationError` (incl. the retention-straddle) is NOT caught in the pass — it
propagates to the outer permanent-FAILED handler and fails the whole job (never a
silent two-basis fallback). `pre_mark_retention_option_days` → `complete_with_warnings`
via a new `NAV_TWR_GUARD_KEYS` entry. The cash pass, MTM pass, and MTM gate decision
are byte-unchanged (the only edit to an existing line is the by-basis assignment, which
now additively includes the smoothed key while staying byte-identical for non-options
paths).

### Task 3 — composite third pass + the gate
New `smoothed_mtm_available(members)` in `stitch_composite.py` (option-activity ALONE;
does NOT consult/mutate `mark_to_market_available` / `MTM_REASON_OPTIONS`; unlike the
MTM gate it does not close on a ccxt venue — a ccxt leg passes through as cash). A third
`_reconstruct_all(PNL_BASIS_SMOOTHED_MTM)` fan-out in `run_stitch_composite_job`,
mirroring the MTM pass, inserted after it. An options composite that MTM keeps GATED OFF
(`unsmoothed_options_book`) now persists `smoothed_mtm` — `mark_to_market` stays ABSENT
with its unchanged reason. A per-leg smoothed reconstruction failure surfaces as a
`DispatchResult` from `_reconstruct_all`'s `_PERMANENT_LEDGER_ERRORS` handler and fails
the whole job loud; the degraded-member-set invariant is enforced against the cash pass.
The `mark_to_market_available` function and the composite MTM gate decision are
byte-unchanged (purely additive diff).

## Deviations from Plan

### Contract evolution — authorized pre-existing test updates (Rule 3)
The plan's `<done>` claimed "all pre-existing single-key tests green unmodified" and
"Existing test_stitch_composite gate tests green UNMODIFIED", but the additive third
pass legitimately changes the by-basis SHAPE contract and the pass/fan-out arity. This
was surfaced as a blocker and the coordinator AUTHORIZED narrowly-scoped test updates
(option 1): change ONLY the combine/fan-out arity and the by-basis-SHAPE assertions to
the new correct contract; preserve every cash/mtm/smoothed VALUE and gate assertion. All
updated tests can still FAIL if the by-basis logic breaks. Changes:

- **`test_mtm_single_key.py`** — updated the by-basis-shape / pass-arity assertions in:
  `test_options_book_runs_second_mtm_pass_same_anchor` (len 2→3),
  `test_structural_mtm_failure_degrades_with_reason` (len 2→3),
  `test_inception_reconciliation_on_mtm_stamps_anchor_race` (len 2→3; by-basis
  None→`{smoothed_mtm}`), `test_non_inception_structural_mtm_failure_keeps_coverage_reason`
  (len 2→3), `test_finite_mtm_object_persisted` (keys `{mark_to_market}`→`{mark_to_market,
  smoothed_mtm}`), `test_degraded_mtm_persists_null_and_reason` (assert `mark_to_market`
  absent instead of by-basis is None — smoothed now populates it), `test_benchmark_failure_never_gates_mtm`
  (+3rd pass), `test_sc4_cash_parity_mtm_on_vs_off` (run A +3rd pass),
  `test_mtm_object_uses_allocated_capital_conventions` (keys +smoothed),
  `test_mtm_compute_valueerror_degrades` (+3rd pass; by-basis stays None — smoothed
  scalar ALSO degrades on the global compute reject), `test_mtm_periods_uses_crypto_clock_from_real_select`
  (spy `[365,365]`→`[365,365,365]`), `test_mtm_second_pass_timeout_degrades_loud_not_failed_final`
  (by-basis `{smoothed_mtm}`), `test_single_key_routes_through_shared_derive_and_persists`
  (derive/persist counts 2→3), `test_single_key_derive_helper_valueerror_degrades_and_heals`
  (+3rd pass; persist stays 2 via the guard). Every cash/mtm VALUE + gate/reason
  assertion preserved byte-for-byte.
- **`test_stitch_composite_job.py`** — `test_mtm_gated_reason_in_dq_flags_when_option_active`
  by-basis `["cash_settlement"]`→`{cash_settlement, smoothed_mtm}` (mtm reason
  UNCHANGED); the WEDGE-01 thread test now expects 4 off-loop combines (2 cash + 2
  smoothed). Harness `_deribit_patches` doubles `combine_returns` + a list
  `preflight_side_effect` for `has_option_activity=True` (the smoothed pass re-crawls the
  same members with basis-independent stub output). Added 3 new smoothed tests.
- **`test_composite_headline_parity.py`** — `_patches` harness doubles `combine_returns`
  (has_option_activity hardcoded True → smoothed pass always runs). No assertion changes.
- **`test_cash_basis_series_sc4.py`** / **`test_derive_broker_dailies_dualmode.py`** —
  shared `_run_seam` / inline harness gain the third combine side-effect. SC-4 cash-track
  comparisons (which exclude metrics_json_by_basis) are unaffected.

### Registry / structural pins grown by a plan-required additive change (Rule 3)
- **`test_nav_twr.py`** — the closed-set pin `set(NAV_TWR_GUARD_KEYS) == {...}` gained
  `pre_mark_retention_option_dailies` (the plan's must-have: the pre-retention bucket
  stamps `complete_with_warnings` via the existing mechanism). Non-weakening — the pin
  still catches typos/undeclared keys and the subset check still holds.
- **`test_sfox_reconstruct.py`** — `test_one_path_derive_basis_series_call_sites_unchanged`
  count 4→6 (the 2 new smoothed derive call sites, single-key + composite). Still proves
  the sfox branch adds zero.

### Design adjustments (within the additive mandate — no gate loosened)
1. **`nav_twr.py` touched (not in the plan's files_modified).** Registering the
   `pre_mark_retention_option_dailies` warn flag required a `NavTWRMeta` field
   (`total=False`, so additive/no construction breaks) + a `NAV_TWR_GUARD_KEYS` entry —
   the idiomatic one-source-of-truth mechanism the plan says to clone. This is the
   minimal way to make both the broker prestamp and the analytics_runner promotion pick
   up the flag by construction.
2. **Smoothed persist GUARDED, not always-heal** (see decisions). Required by the plan's
   SC-4 must-have ("no-option keys persist NO smoothed artifacts / byte-identical rows").
3. **Smoothed scalar-compute degrades** (single-key) while the ledger/marks failure
   fails loud (see decisions). Keeps the fail-loud discipline where it matters (holed
   marks) without killing the cash headline over an orthogonal math edge, and matches
   MTM's symmetric treatment. The composite mirrors the existing composite MTM semantics
   (metrics ValueError fails the whole job).

## Known limitations
- **Latent stale smoothed series on options→perp-only reconfiguration.** The guarded
  smoothed persist (mandated by SC-4) does not heal a stale `smoothed_mtm_daily_returns`
  series row when a strategy loses option activity. The by-basis SCALAR heals via the
  authoritative wholesale `metrics_json_by_basis` write, and the frontend (131-03) gates
  on the scalar, so the stale series is latent/benign. A follow-up could add a smoothed
  heal-delete IF the SC-4 "no artifacts" constraint is relaxed for the heal path.

## Founder-visible trade-off (accepted, per plan objective / D-07)
An options key whose held instrument's life comes to STRADDLE the ~2.5yr mark-retention
horizon flips green→HARD-FAILING at the job level: the smoothed pass raises
`LedgerValuationError` (partial marks are never interpolated) and the WHOLE job fails,
so ALL persisted analytics for that key stop refreshing on future recomputes as the
retention window moves. This is the deliberate no-interpolation/no-fallback consequence
(the alternative fabricates a basis). If it fires in production it is an operational
signal (persistent mark cache is the named follow-up knob), not a defect. Pinned by
`test_smoothed_ledger_valuation_error_fails_job_loud` (single-key) and
`test_smoothed_composite_per_leg_failure_fails_job_loud` (composite).

## MTM gate decision — byte-unchanged (explicit confirmation)
`git diff` on `stitch_composite.py` and the composite portion of `job_worker.py` show
ZERO deletions — purely additive. `mark_to_market_available`, `MTM_REASON_OPTIONS`, and
the composite `mtm_ok, mtm_reason = mark_to_market_available(member_signals)` decision
are byte-identical. In the single-key route the MTM second-pass decision
(`not is_key_mode AND cash-headline AND has_option_activity`) and the MTM pass block are
byte-unchanged; the only edited existing line is the by-basis assignment, which stays
byte-identical for every non-options path and additively includes the smoothed key.

## Verification (plan gates)
- `pytest tests/ -q` → **4203 passed, 96 skipped**, 3 pre-existing OKX failures in
  `test_equity_reconstruction.py` (`private_get_account_balance` FakeExchange drift —
  proven independent of this plan, baseline was 4183 passed). ZERO new failures.
- `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 0
  issues (84 files)**.
- `git diff` audit: zero-line diff inside the existing cash/MTM pass blocks in both
  routes; `stitch_composite` MTM decision byte-identical; no DDL / migration.
- No pre-existing test DELETED; the only pre-existing tests MODIFIED are the
  authorized by-basis-shape / arity contract-evolution updates + two structural pins
  grown by the plan-required additive change (enumerated above).

## Self-Check: PASSED
- FOUND: KIND_SMOOTHED_MTM in services/basis_series.py
- FOUND: PNL_BASIS_SMOOTHED_MTM (4×) in services/job_worker.py
- FOUND: smoothed_mtm_available in services/stitch_composite.py
- FOUND: pre_mark_retention_option_dailies in services/nav_twr.py (NavTWRMeta + NAV_TWR_GUARD_KEYS)
- FOUND commits: 107887d9, cad6a898, 60800ee9
</content>
