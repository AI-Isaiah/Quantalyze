---
phase: 101-options-mtm-toggle
plan: 01
subsystem: analytics-service (Deribit native ledger / pnl_basis / by-basis persistence)
tags: [mtm, pnl_basis, deribit, options, metrics_json_by_basis, sc-4]
requires:
  - services.deribit_ingest.build_deribit_native_ledger (pnl_basis param, has_option_activity)
  - services.broker_dailies.combine_native_ledger
  - services.metrics.compute_all_metrics + periods_per_year_for_asset_class
  - services.stitch_composite (reason-constant vocabulary owner)
provides:
  - "single-key Deribit options derive persists strategy_analytics.metrics_json_by_basis.mark_to_market (seven headline scalars, finite or JSON null)"
  - "honest single-key MTM gate: structural reconstruction failure degrades with data_quality_flags.mtm_gated_reason=mtm_summary_coverage_incomplete, cash derive still ships"
  - MTM_REASON_SUMMARY_COVERAGE reason constant (services/stitch_composite.py)
affects:
  - "Phase 102 (read side): page.tsx / build-payload / useBasisMetrics overlay + SegmentedControl will now find a mark_to_market by-basis object to enable the toggle"
tech-stack:
  added: []   # zero new packages (RESEARCH: no Package Legitimacy Audit needed)
  patterns:
    - "additive dual-pass mirroring the composite _reconstruct_deribit template, MINUS the cash by-basis key (single-key headline IS the cash truth)"
    - "typed structural-family catch degrades; bare ValueError / transient errors propagate (retry whole derive)"
key-files:
  created:
    - analytics-service/tests/test_mtm_single_key.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/stitch_composite.py
decisions:
  - "Single-key by-basis object carries ONLY mark_to_market (never cash_settlement) — the strict basis-metrics.ts overlay keeps single-key cash byte-identical only when the cash key is ABSENT"
  - "Second pass gated on (not is_key_mode AND pnl_basis==cash_settlement AND _completeness.has_option_activity)"
  - "Structural degrade catches the TYPED family (LedgerValuationError, NavReconstructionError, LedgerCompletenessError, LedgerTruncatedError, CurrencyEnumerationError, ScopeAuthError); bare ValueError deliberately EXCLUDED so transient parse/network blips retry"
  - "Persistence lives in the _prestamp_dq_flags seam (survives the CSV finalizer's Finding-5 composite gate); degrade writes SQL NULL to heal a stale key"
metrics:
  duration: ~1 session (2026-07-12)
  tasks_completed: 3
  commits: 4
  completed: 2026-07-12
---

# Phase 101 Plan 01: Single-key Deribit MTM second-pass persistence Summary

Teach `run_derive_broker_dailies_job` to run a SECOND `pnl_basis=mark_to_market`
Deribit ledger pass on options books and persist it additively into
`strategy_analytics.metrics_json_by_basis.mark_to_market`, with an honest gate
that degrades-with-reason on structural failure and keeps `cash_settlement`
byte-identical (SC-4). No smoothing, no new packages, no migration, no UI.

## What shipped

- **Reason constant** `MTM_REASON_SUMMARY_COVERAGE = "mtm_summary_coverage_incomplete"`
  added to `services/stitch_composite.py` (single admissibility-vocabulary owner;
  machine reason only — human copy is Phase 102). Docstring §4 extended.
- **Second MTM ledger pass** inside the existing crawl `try`, mirroring
  `_reconstruct_deribit` verbatim, reusing the ONE-read `account_state`; binds to
  MTM-only names (`mtm_returns` / `_mtm_meta` / `_mtm_completeness`) so the cash
  pass objects are never touched.
- **Honest gate**: structural failures degrade (cash ships, reason stamped);
  transient errors propagate to retry the whole derive.
- **MTM metrics compute** with finalizer-mirrored conventions (asset-class
  `periods_per_year` + allocated-capital `cumulative_method`/`day_basis`), guarded
  BTC benchmark fetch (a blip never gates).
- **Additive persistence** in `_prestamp_dq_flags`: `{"mark_to_market": <dict>}`
  on success, SQL NULL on degrade (heals a stale key), column omitted entirely
  when the pass was not attempted (perp-only / ccxt / key-mode).

## Exact insertion line ranges (analytics-service/services/job_worker.py)

| Insertion | Lines |
|-----------|-------|
| Branch-outer var init (`mtm_returns` / `mtm_gated_reason` / `mtm_attempted`) | 2011–2020 (before the `try:` at 2021) |
| Imports (`PNL_BASIS_MARK_TO_MARKET`, `MTM_REASON_SUMMARY_COVERAGE`) | 2042–2050 |
| Second `mark_to_market` pass + structural-degrade catch | 2244–2319 (inside the crawl try; catch tuple at 2291–2298, `as _mtm_exc`) |
| MTM metrics compute (conventions + guarded benchmark + compute-degrade) | 2828–2892 |
| By-basis prestamp persistence (payload build + reason stamp) | 2933–2971 |

**Final structural catch tuple (the degrade path, `job_worker.py:2291–2298`):**
```python
except (
    LedgerValuationError,
    NavReconstructionError,
    LedgerCompletenessError,
    LedgerTruncatedError,
    CurrencyEnumerationError,
    ScopeAuthError,
) as _mtm_exc:
```
Bare `ValueError` is deliberately EXCLUDED (mirrors the cash-pass narrowing at
:2249) so a transient parse/network `ValueError`/`json.JSONDecodeError` stays
transient-retryable. A second compute-level `except ValueError` guards
`compute_all_metrics` and DEGRADES (does not fail the job).

## Tasks completed

| Task | Commit | Subject |
|------|--------|---------|
| 1 — reason constant + second pass + structural catch | `1064c7aa` | feat(101-01): single-key MTM second ledger pass + structural-degrade gate |
| 2 — MTM metrics compute + additive prestamp persist | `c378b852` | feat(101-01): compute MTM metrics + additive by-basis prestamp persistence |
| 3 — SC-4 derive-level parity + neuter sweep | `b5794481` | test(101-01): SC-4 derive-level cash parity + neuter-falsifiability sweep |
| (coverage follow-up) | `12a8e742` | test(101-01): cover allocated-capital MTM conventions + compute-ValueError degrade |

## Test results

- `tests/test_mtm_single_key.py`: **15 passed** (6 Task-1 wiring, 5 Task-2
  persistence, 2 Task-3 SC-4 parity, 2 convention/compute-degrade coverage).
- Regression sweep (test_job_worker, test_job_worker_deribit,
  test_derive_broker_dailies_dualmode, test_stitch_composite,
  test_stitch_composite_job, test_deribit_txn): **392 passed, 1 skipped**.
- Full analytics suite (`tests/ --ignore=tests/e2e`): **3631 passed, 93 skipped,
  1 failed** — the single failure is the pre-existing, unrelated
  `test_audit.py::...test_action_literal_matches_ts_union` (audit taxonomy TS↔Python
  drift; touches no file in this plan). Logged to `deferred-items.md`.

### Neuter-falsifiability confirmations (Task 3 step 3)

Each guarded branch was neutered locally and the matching test confirmed RED,
then restored:

| Neuter | Test that went RED |
|--------|--------------------|
| Dropped the `_completeness.has_option_activity` guard | `test_perp_only_book_runs_single_pass` + `test_non_options_deribit_leaves_by_basis_untouched` |
| Added bare `ValueError` to the structural catch tuple | `test_transient_valueerror_on_mtm_propagates` |
| Reassigned cash `returns`/`meta` to the MTM pass output | `test_sc4_cash_parity_mtm_on_vs_off` |

## Coverage delta

Full-suite `--cov-fail-under=80` gate is unchanged (additive tests + covered new
logic). The new derive MTM block is exercised end-to-end: after the two coverage
follow-up tests, the only remaining "missing" lines inside the touched region are
the pre-existing `_prestamp_flags[_flag] = True` guard-key loops (2923/2930),
which are not part of this plan's new logic.

## Deviations from Plan

None affecting design. The plan-mandated Task-1 refinement (typed structural
family, NOT bare `ValueError`, plus the companion transient-`ValueError`
propagation test) was honored exactly. Two small **additive** coverage tests were
added beyond the plan's explicit test list to close the new-logic coverage gaps
(allocated-capital convention branch + compute-level ValueError degrade) — no
production behavior change.

## Observed-but-out-of-scope (NOT fixed here)

1. **Composite→single stale-by-basis window (pre-existing).** When a strategy that
   was previously a COMPOSITE is re-derived through the single-key broker path, the
   broker prestamp REPLACES `data_quality_flags` wholesale and drops the `composite`
   flag *before* the CSV finalizer's Finding-5 gate reads it. The finalizer then
   treats the row as never-composite and omits `metrics_json_by_basis` from its
   `_mark_complete` upsert — so the prior composite's `cash_settlement` by-basis
   object can linger next to the newly-prestamped single-key `mark_to_market` key.
   Observed during planning; NOT in scope for MTM-01 (single-key persistence). Flag
   for a composite/single transition-cleanup pass.
2. **Pre-existing audit taxonomy drift** — see `deferred-items.md`.

## Ship-time handoff (RE-DERIVE required — RESEARCH OQ-3 / migration note)

A code edit alone changes only how NEW derives are written. To populate
`metrics_json_by_basis.mark_to_market` for an EXISTING options strategy (e.g. the
Zavara Deribit book), ship-time MUST trigger a **re-derive** of that strategy
(`derive_broker_dailies` → CSV analytics), then verify:
- the new `mark_to_market` object is present with seven finite headline scalars;
- `cash_settlement` (headline + charting rows) is byte-identical post-re-derive
  (SC-4). Zavara's corroborated window (Aug 2025–Mar 2026) is post-rollout, so it
  should reconstruct rather than hit the pre-rollout-straddle degrade — but the
  honest gate covers the general case.

## Phase 102 handoff

The read side (`basis-context.tsx` / `basis-metrics.ts` / `FactsheetView` toggle,
composite MTM compose + Zavara regression, and the `unsmoothed_options_book`
reason-copy rewrite that still references the dropped Phase-83 smoothing framing)
is Phase 102. This plan stamps only the machine reason.

## Self-Check: PASSED
- `analytics-service/tests/test_mtm_single_key.py` — FOUND
- `analytics-service/services/job_worker.py` — FOUND (modified)
- `analytics-service/services/stitch_composite.py` — FOUND (modified)
- Commits `1064c7aa`, `c378b852`, `b5794481`, `12a8e742` — all present in `git log`.
