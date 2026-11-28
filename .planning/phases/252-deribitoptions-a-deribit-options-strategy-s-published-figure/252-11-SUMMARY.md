---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 11
subsystem: composite-stitch
tags: [composite, smoothed_mtm, crawl-reuse, deribit-options, retain_raw_rows, gap-closure]
status: complete
gap_closure: true
requires:
  - phase: 252
    provides: plan 09's smoothed headline promotion (P1 to P4) and 185 D-04's build_deribit_options_basis_ledger
provides:
  - "run_stitch_composite_job: each Deribit member's transaction log is crawled once, in the cash pass; the smoothed pass rebuilds the member's ledger from the retained rows and the same account-state read"
  - "build_deribit_options_basis_ledger(exclude_spot_extraction=False): the composite passes its configured extraction mode"
  - "one INFO line naming the smoothed pass's elapsed seconds against its bound, for the post-deploy headroom reading"
affects: [post-deploy re-stitch of both flagged composites, G252-MTM-PROMOTION closure]
plan_head_before: 00e61bf13381869b1446d9487f9013dfa2681dde
plan_head_after: 9f17a1fcf74bf065e0346619e4bf975617621b49
actuals:
  tokens: 8400     # chars/4 over the added lines of the realized analytics-service diff
  tasks: 2
  commits: 2       # MEASURED: git rev-list --count plan_head_before..plan_head_after (2 code commits; the SUMMARY commit follows)
key-files:
  created: []
  modified:
    - analytics-service/services/deribit_ingest.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py
    - analytics-service/tests/test_composite_headline_parity.py
    - analytics-service/tests/test_nav_marks_composite_allocated.py
    - analytics-service/tests/test_deribit_options_basis_ledger.py
decisions:
  - "Retention keyed by member seq in a closure dict (member_cash_crawl), popped once by the smoothed pass; a missing entry is a ValueError, never a fresh crawl (Design 3)."
  - "_g252_run keeps its 3-tuple and returns a _G252Builds NamedTuple (.native, .options) as the third element."
  - "The smoothed pass keeps its bounded timeout and floor; no budget constant changed (Design 7)."
---

# Phase 252 Plan 11: the composite smoothed pass builds from the cash pass's crawl Summary

On an option-active composite each Deribit member's transaction log is crawled exactly once, in the cash pass, and the smoothed ledger is assembled from that crawl's retained rows and the same account-state read through `build_deribit_options_basis_ledger`, in the composite's own extraction mode. This answers the third `missing:` item of G252-MTM-PROMOTION (founder decision 2026-11-28, "Fix inside 252 first"). The fourth item (re-stitch both composites on PROD and read them) is the orchestrator's.

## What changed

- `deribit_ingest.build_deribit_options_basis_ledger`: new keyword-only `exclude_spot_extraction: bool = False`, passed to `_assemble_deribit_native_ledger` in place of the literal. Key mode passes nothing, so its call is byte-unchanged. Docstring updated.
- `job_worker.run_stitch_composite_job` (inside the function only):
  - local import block gains `CompletenessReport`, `DeribitNativeAccountState`, `build_deribit_options_basis_ledger`;
  - `member_cash_crawl` closure dict (beside `member_marked`) and `_release_cash_crawl`;
  - `_reconstruct_deribit` gains keyword-only `member_seq`, `retain_cash_crawl`, `reuse_cash_crawl`. Retain: adds `retain_raw_rows=True` to the native build and stores `(completeness, account_state)` after `assert_ledger_complete`. Reuse: pops the member's entry (missing = `ValueError` naming the seq), skips the account-state read and the native build, calls the options builder inside the same `asyncio.wait_for(..., _BROKER_CRAWL_TIMEOUT_S)`, then runs the unchanged `asyncio.to_thread(combine_native_ledger, ...)`. The MED-01 `pre_mark_retention_option_dailies` bridge and `has_option_activity` read the report RETURNED by the options builder. A `finally` sets the retained report's `raw_rows` to None;
  - `_reconstruct_all` gains `retain_cash_crawl` / `reuse_cash_crawl`, passes them and `seq` to `_reconstruct_deribit`; the cash-pass call passes `retain_cash_crawl=True`, step 6b's call passes `reuse_cash_crawl=True`. The MTM second pass passes neither and is unchanged. ccxt members route to `_reconstruct_ccxt_member` as before (live re-read);
  - release points: after the cash pass when `smoothed_mtm_available(member_signals)` is False; at the budget refusal; in a `finally` on the bounded smoothed call (every other exit of step 6b);
  - INFO line `run_stitch_composite_job: smoothed_mtm pass built from the cash pass's crawl in %.0fs of its %.0fs bound for strategy %s` after the bounded call returns a tuple (seconds and strategy id only);
  - the 6b comment block, the GLB-3(b) BUDGET paragraph and the budget-refusal comment reworded. No existing log line reworded; no budget constant changed; `stitch_composite.py` unchanged.

## Tracer RED at HEAD, verbatim

Run before any implementation edit, at `00e61bf13` with only the tracer added (`.venv/bin/python -m pytest tests/test_stitch_composite_job.py -q -p no:cacheprovider -k test_g252_crawl_once`):

```
>       assert len(calls) == 2 * k, f"{len(calls)} transaction-log calls, want {2 * k}"
E       AssertionError: 4 transaction-log calls, want 2
E       assert 4 == (2 * 1)
E        +  where 4 = len([('main', 'BTC'), ('main', 'BTC'), ('main', 'BTC'), ('main', 'BTC')])
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_smoothed_ledger_comes_from_the_cash_crawl
1 failed, 129 deselected in 5.26s
```

GREEN after implementation: all `test_g252_crawl_once*` cases pass (5 passed).

## Counts and tool versions

- mypy: `mypy 2.4.0 (compiled: yes)`; `mypy --strict ... services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` prints `Success: no issues found in 151 source files` (run after Task 1 and again after the last code edit; no source edit followed).
- Task 2 verify command pytest count: pre-edit (plan base `00e61bf13`, before Task 1's first edit) `927 passed`; post-edit `933 passed` (+6: tracer, 2 identity, 2 release, 1 allocated-mode equality), 0 failed.
- Task 1 verify command (8 files): `299 passed`.
- `.venv` is the existing symlink to the main checkout's venv; nothing created.

## PROOF-01, verbatim (byte-copy backup, `cmp` before and after, restore by `cp`)

Every neuter below: `cp` backup then `cmp` exit 0, neuter applied, RED run, `cp` restore, `cmp` exit 0, `git diff --stat -- services/` empty, GREEN run. Scripts live in the session scratchpad.

**N1 (reuse: smoothed pass ignores `reuse_cash_crawl`, crawls fresh)**
```
backup cmp job_worker exit=0 / backup cmp deribit_ingest exit=0
--- N1 neutered; RED run:
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_smoothed_ledger_comes_from_the_cash_crawl
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[unconfigured]
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[configured]
3 failed in 5.17s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N1 restored; GREEN run:
3 passed in 4.92s
```

**N2 (retention: the cash build drops `retain_raw_rows=True`)**. The first attempt aborted because the neuter's anchor matched two sites (the key-mode derive has the same line); nothing was edited, the run showed 3 passed, and the anchor was tightened to the stitch's own `if retain_cash_crawl:` block. Second attempt:
```
backup cmp job_worker exit=0 / backup cmp deribit_ingest exit=0
--- N2 neutered; RED run:
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_smoothed_ledger_comes_from_the_cash_crawl
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[unconfigured]
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[configured]
3 failed in 5.35s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N2 restored; GREEN run:
3 passed in 5.09s
```

**N3 (P3 source: the bridge reads the retained cash report, not the returned options report)**
```
--- N3 neutered; RED run:
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[retention_bucketed]
FAILED tests/test_stitch_composite_job.py::test_composite_pre_mark_retention_stamps_complete_with_warnings
2 failed, 7 passed in 6.06s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N3 restored; GREEN run:
9 passed in 5.89s
```

**N4 (ingest mode: `build_deribit_options_basis_ledger` passes the literal False again)**
```
--- N4 neutered; RED run:
FAILED tests/test_deribit_options_basis_ledger.py::test_same_crawl_smoothed_ledger_equals_an_independent_build_in_allocated_mode
1 failed, 16 passed in 5.08s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N4 restored; GREEN run:
17 passed in 4.94s
```

**N5 (composite mode: the smoothed call passes `exclude_spot_extraction=False`)**
```
--- N5 neutered; RED run:
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[configured]
1 failed, 1 passed in 5.03s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N5 restored; GREEN run:
2 passed in 5.43s
```

**N6 (release: every release point removed)**
```
--- N6 neutered; RED run:
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_smoothed_ledger_comes_from_the_cash_crawl
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[unconfigured]
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[configured]
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_unused_retained_rows_are_released[budget_refusal]
FAILED tests/test_stitch_composite_job.py::test_g252_crawl_once_unused_retained_rows_are_released[no_option_activity]
5 failed in 5.26s
restore cmp job_worker exit=0 / restore cmp deribit_ingest exit=0
--- N6 restored; GREEN run:
5 passed in 5.00s
```

Each RED names exactly the cases the plan listed. After N6 the working tree was clean (`git status --short` empty).

## Existing tests whose code changed (old intent, new intent)

The seven re-pointed smoothed-build assertion sites (each read `c.kwargs.get("pnl_basis") == "smoothed_mtm"` off a native-build spy; each now reads the options-builder spy):

1. `test_options_composite_persists_smoothed_while_mtm_gated`: "a smoothed ledger build was issued" now reads the options spy; added the converse (no smoothed build on the native spy, so the smoothed ledger cannot come from a second crawl).
2. `test_smoothed_flag_off_composite_still_runs_smoothed_pass`: options spy.
3. `test_smoothed_composite_structural_failure_degrades`: "the smoothed build was attempted before the structural degrade" reads the options spy; the injector fires from it.
4. `test_smoothed_composite_budget_overrun_degrades`: same, for the slow injector.
5. `test_perp_only_composite_persists_no_smoothed_artifacts` (negative, the vacuity hazard): now asserts `options_spy.await_count == 0` as well as the native spy's absence of the smoothed basis.
6. `test_g252_promoted_options_composite_stores_smoothed_headline_with_flag_unset`: `builds.options`.
7. `test_g252_no_option_composite_is_byte_identical_with_the_flag_unset_and_set` (negative): `build.options.await_count == 0` plus the native spy check; its runner now returns a `_G252Builds`.

Other edited cases, intent unchanged: `test_mtm_gated_reason_in_dq_flags_when_option_active`, `test_composite_pre_mark_retention_stamps_complete_with_warnings` (generic injector patched onto both builders), `test_blowup_member_persists_finite_series_and_plausible_contribution` (its own patch list now also patches the options builder with the same blow-up ledger). All per-basis injectors (`_build` closures, `_g252_build_structural|slow|retention`, `_g252_transient_build`, `_g252_transient_read_build`, `_g252_network_error_build`) accept `retain_raw_rows` and `report`. The `_G252_MATRIX` and last-attempt matrices keep every case; their smoothed failures now fire from `build_deribit_options_basis_ledger`.

Harnesses: `_deribit_patches` patches the options builder by default (same stub ledger and report) and its docstring/comments no longer say "re-crawls"; new `_dual_patches(native, options)` helper; `test_composite_headline_parity.py`'s patch builder patches the options builder by default and rewords its comment; `test_nav_marks_composite_allocated.py`'s strict `_build` accepts `retain_raw_rows`.

**`_g252_run` return shape chosen:** it keeps its `(fake, result, builds)` 3-tuple, and `builds` is a `_G252Builds(native, options)` NamedTuple (two separate AsyncMock spies, both driven by `build_side_effect`). Only one existing call site read the third element.

**`test_stamp_io_exhaustive.py` was NOT edited** (green after Task 1 and Task 2).

**ccxt pin:** the existing divergence cases (`test_smoothed_cash_degraded_member_divergence_fails_transient`, `test_g252_divergent_member_sets_on_the_last_attempt_ship_the_cash_composite`, `test_g252_ccxt_network_error_before_the_last_attempt_still_retries`, the last-attempt `escaping_ccxt_network_error` arm) passed unedited in their assertions; they are the pin that ccxt members keep their live smoothed-pass re-read.

## New tests

`test_g252_crawl_once_smoothed_ledger_comes_from_the_cash_crawl` (real-ingest tracer: paginate log 2k not 4k; native builds retain rows; options builds take the very report each cash build returned; each smoothed ledger equals a fresh smoothed crawl under `_assert_ledgers_equal`, with the 2026-01-16 dMTM day present only on the smoothed side and `stub.chart_calls` non-empty; row promotes with exactly one marker; rows released; one INFO line), `test_g252_crawl_once_each_member_is_rebuilt_from_its_own_crawl[unconfigured|configured]`, `test_g252_crawl_once_unused_retained_rows_are_released[budget_refusal|no_option_activity]`, `test_same_crawl_smoothed_ledger_equals_an_independent_build_in_allocated_mode`.

## origin/main re-check, verbatim

At execute start and again at the end, `git fetch` then `git log --oneline 278cafac3..origin/main -- analytics-service/services/job_worker.py analytics-service/services/deribit_ingest.py` printed nothing (no merged edit to either file since the plan's base; the check is clean).

## Deviations from Plan

**1. [Rule 3 - premise stale] The non-analytics diff gate reads 18 against `278cafac3`.** `278cafac3` is a main commit AHEAD of this phase branch (`git merge-base 278cafac3 HEAD` is `00639f88f`; the branch is not a descendant), so `git diff 278cafac3` includes main's own later files (CHANGELOG, VERSION, migrations, scripts). The gate's intent (this plan touches only analytics files) is met and measured against the real base: `git diff --name-only 00e61bf13 HEAD -- . ':!.planning' | grep -a -v -c '^analytics-service/'` prints 0, and the diff lists exactly the six files above. The fence gate (stitch_composite.py, deribit_txn.py, basis_series.py, test_deribit_key_mode_options_basis.py, test_mtm_single_key.py vs `278cafac3`) prints 0 and the `run_derive_broker_dailies_job` source hash prints `b30930d1074f79c1` (equal to the plan's). `node scripts/verify-plan-anchors.mjs --pending` exits 0.

**2. [Tool, no behaviour change] A grep acceptance gate needed a line-shape fix.** The new INFO message was first wrapped so the phrase `built from the cash pass` split across two source lines; the gate (`grep -c 'built from the cash pass'`, EXPECT 1) read 0. Re-wrapped so the phrase sits on one line; no text change.

Otherwise the plan executed as written.

## Acceptance greps (at `9f17a1fcf`)

- `build_deribit_options_basis_ledger(` non-comment count in job_worker.py: 2 (EXPECT 2).
- `retain_cash_crawl=True`: 1; `reuse_cash_crawl=True`: 1.
- `build_deribit_native_ledger(` non-comment inside the stitch function: 1.
- `exclude_spot_extraction=exclude_spot_extraction` in deribit_ingest.py: 4.
- `built from the cash pass` non-comment: 1.
- `test_no_verification_or_publish_status_write_source_scan` green; the stitch source holds neither banned word.
- MT5 (155.2 freeze): `_COMPOSITE_DEGRADE_VENUES` (ccxt crypto venues minus the native one) and the `if venue != "deribit":` permanent-refusal arm are untouched, so an MT5 key still cannot be a composite member; no routing line changed.

## Known Stubs

None. No placeholder, mock or empty-value data flows to a surface; the stubs here are test doubles only.

## Threat Flags

None. No new network endpoint, auth path, file access or schema change. T-252-35 to T-252-41 are mitigated as planned (T-252-35 by the identity cases and N1/N2, T-252-36 by release and N6, T-252-37 by the allocated equality and N4/N5, T-252-38 by N3, T-252-40 by the unchanged derive hash and zero-diff key-mode tests). T-252-39 stays accepted: the INFO line measures the remaining read time.

## Known limits (recorded, not covered)

- The smoothed pass's remaining read time (option marks, index marks, preflight, combine) for the evidence members is UNMEASURED until the INFO line is read on PROD.
- Peak worker memory now holds every Deribit member's raw rows from the cash pass into the smoothed pass, unmeasured.
- The perp-only MTM second pass keeps its own crawl. ccxt members keep their live smoothed re-read (no PROD composite has one today).
- Whether an in-the-money payout lands as cash on the close day is unmeasured (252-08 next step 3).

## Post-deploy (orchestrator-owned; restated for the verifier, NOT done by this plan)

1. After main's CI is green and the Railway worker has deployed the ship, re-stitch both flagged composites through the product's own job (`stitch_composite` via `enqueue_compute_job`, the path `keys/sync` uses). Never a backfill UPDATE.
2. Read PROD through the Supabase MCP, read-only, marker query first. For each row read `data_quality_flags->>'headline_basis'`, `data_quality_flags->>'mtm_gated_reason'`, `computation_status`, `computed_at`, the top-level `cumulative_return`, `cagr`, `calmar`, `sharpe`, `max_drawdown`, the `metrics_json_by_basis` key set, and whether each top-level figure equals `metrics_json_by_basis->'smoothed_mtm'`. Ask the coordinator for the worker log lines `smoothed_mtm pass built from the cash pass's crawl in ...` and `smoothed headline ... promoted` for each job.
3. Pass: `headline_basis = smoothed_mtm`, no `mtm_gated_reason`, status `complete` or `complete_with_warnings`, top-level figures equal the smoothed object, plan 10's owner-factsheet check passes. Then list the moved figures in the CHANGELOG entry (SC-5) and close G252-MTM-PROMOTION.
4. Fail: row still carries `unsmoothed_options_book` and no marker (safe, still withheld). An "exceeded its bounded" warning goes to a founder budget question with the measured seconds, never a silent raise; `retention_bucketed_option_days` or `smoothed_chain_broken` goes to a founder question as 252-09 routes them; a structural warning is a new probe reading.

## Self-Check: PASSED

Verified: the six modified files exist and are committed (`3477698b5` feat, `9f17a1fcf` test); `git merge-base --is-ancestor` holds for both hashes against HEAD; no tracked file deleted; working tree clean before this SUMMARY; STATE.md and ROADMAP.md untouched.
