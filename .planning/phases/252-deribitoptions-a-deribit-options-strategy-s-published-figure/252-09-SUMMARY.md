---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 09
subsystem: analytics-service
tags: [composite, smoothed_mtm, headline-promotion, deribit-options, fail-safe]
status: complete
gap_closure: true
requires:
  - phase: 252
    provides: wave-1 named withhold (mtm_gated_reason unsmoothed_options_book) and the 2026-11-27 PROD measurement that passed
provides:
  - "smoothed_headline_promotion (P2 to P4) and HEADLINE_BASIS_FLAG / HEADLINE_BASIS_SMOOTHED / SMOOTHED_HEADLINE_NOT_PROMOTED_CAUSES in stitch_composite.py"
  - "run_stitch_composite_job stores the smoothed result as an option-active composite's headline when P1 to P4 hold, flag-independent"
  - "an honest smoothed derive (member-guard NaN day reinstated as a chain break)"
affects: [252-10 TS surfaces, post-deploy re-stitch of the two flagged composites]
plan_head_before: 33d4cf8639a8e8d33b2df71a540a3f9054029a2b
plan_head_after: b9a0c400237af1b1285ba0c9a640b96b96ad0047
actuals:
  tokens: 12900     # chars/4 over the added lines of the realized analytics-service diff (51545 chars)
  tasks: 2
  commits: 2        # MEASURED: git rev-list --count plan_head_before..plan_head_after (code commits; the SUMMARY docs commit follows)
tech-stack:
  added: []
  patterns:
    - "one pure decision function owns the promotion criteria; the worker never inlines them"
    - "marker, reason pop and promoted scalars ride the ONE headline_payload upsert"
key-files:
  created: []
  modified:
    - analytics-service/services/stitch_composite.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/closed_sets.py
    - analytics-service/tests/test_stitch_composite.py
    - analytics-service/tests/test_stitch_composite_job.py
    - analytics-service/tests/test_composite_headline_parity.py
key-decisions:
  - "P4 (no interior chain break in the smoothed headline) is part of the promotion test, as recorded in the plan"
  - "Sibling series kinds stay cash on purpose (known mismatch with their comment, see below)"
---

# Phase 252 Plan 09: Smoothed headline promotion (producer half) Summary

An option-active composite whose smoothed mark-to-market build computes, carries no retention-bucketed option day and has no interior chain break now stores the smoothed result as its headline with `SMOOTHED_MTM_ENABLED` unset; every other option-active stitch keeps today's cash headline and the named withhold.

## What was built

- `services/stitch_composite.py`: `HEADLINE_BASIS_FLAG = "headline_basis"`, `HEADLINE_BASIS_SMOOTHED = "smoothed_mtm"` (one-line literals, regex-parseable for plan 10), `SMOOTHED_HEADLINE_NOT_PROMOTED_CAUSES` (closed tuple of three causes), pure `smoothed_headline_promotion` (P2, then P3, then P4), and the extended `MTM_REASON_OPTIONS` comment.
- `services/job_worker.py`, inside `run_stitch_composite_job` only:
  - step 6b: `smoothed_ok = smoothed_mtm_available(member_signals)` (no flag read), rewritten kill-switch comment, and the smoothed `derive_basis_series` call now passes `scalar_returns=gap_fill_daily_returns(stitched_smoothed)` and `densify_policy="zero_fill"`;
  - new step 6c: the decision (`smoothed_promoted`, one `logger.info` line carrying only the cause literal, none when `smoothed_ok` is False) and the single `_headline_result` / `_headline_metrics` pair;
  - step 7: `_composite_chain_broken`, `insufficient_window`, `headline_since`, the tiny-day list, the three marks notes, the marker/reason pair and the spread (`headline_payload.update(_headline_metrics)`) follow the promoted result on a promoted row; the not-promoted branch is byte-identical to before and pops a stale `headline_basis` on every non-promoting stitch.
- `services/closed_sets.py`: comment only above `is_smoothed_mtm_enabled` (the composite route no longer reads it; function body unchanged).
- Tests: pure truth table (6 cases), 19 new cases in `test_stitch_composite_job.py`, 2 generalized parity cases in `test_composite_headline_parity.py`.

## Task commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `a482c0c31` | vocabulary, flag-independent pass, honest derive, decision, step-7 promoted branch, pure + end-to-end tests, four existing tests re-stated |
| 2 | `b9a0c4002` | fail-safe matrix, stale-marker, withhold-drop, transient, failure-after-promotion, honest derive, no-option byte identity, parity generalization |

## Environment, counts, mypy

- mypy used: `mypy 2.4.0 (compiled: yes)` from the main checkout venv (`analytics-service/.venv/bin/python`, symlinked). `python3` in this shell is `mypy 2.0.0`, so it was not used.
- Pre-edit pass count of the Task 2 verify command's pytest part (13 files, run at the plan base before any edit): `560 passed, 115 warnings in 45.78s`.
- Post-edit: `587 passed, 115 warnings in 76.81s (0:01:16)`. Net +27 = 6 pure + 19 job + 2 parity; the renamed existing case is net zero.
- mypy strict gate (services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py): `Success: no issues found in 146 source files`.
- `node scripts/verify-plan-anchors.mjs --pending`: `claims: 37 checked` / `OK: 10 plan file(s), no stale claims.` exit 0.

## Acceptance greps (post-edit)

| Check | Expected | Got |
|---|---|---|
| `smoothed_ok = is_smoothed_mtm_enabled() and smoothed_mtm_available(member_signals)` count | 0 | 0 |
| non-comment `is_smoothed_mtm_enabled()` reads in job_worker.py | 2 (HEAD 3) | 2 |
| `^HEADLINE_BASIS_FLAG = "headline_basis"` | 1 | 1 |
| `^HEADLINE_BASIS_SMOOTHED = "smoothed_mtm"` | 1 | 1 |
| `densify_policy="zero_fill"` in job_worker.py | 2 (HEAD 1) | 2 |
| non-`analytics-service/` files in `git diff --name-only 33d4cf863 -- . ':!.planning'` | 0 | 0 |
| changed lines in `test_mtm_single_key.py`, `deribit_txn.py`, `deribit_ingest.py`, `basis_series.py` | 0 | 0 |

The plan cites base `57229df98`; this worktree's base is `33d4cf863` (the phase worktree head after the plan commits), so the diff gates were taken against `33d4cf863`. HEAD counts for the greps were the plan's and were not re-measured at `57229df98`.

## PROOF-01 outputs (verbatim)

RED at HEAD (HEAD's `job_worker.py` swapped in from `git show`, new cases run, restored by `cp`):

```
FAILED tests/test_stitch_composite_job.py::test_smoothed_flag_off_composite_still_runs_smoothed_pass
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_options_composite_stores_smoothed_headline_with_flag_unset
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_and_cash_metrics_share_one_key_set
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_row_carries_smoothed_top_level_series_and_pops_cash_marks_notes
FAILED tests/test_stitch_composite_job.py::test_g252_withhold_reason_is_dropped_when_the_row_promotes
5 failed, 116 deselected in 19.75s
cmp exit 0
```

Task 1, spread source (`headline_payload.update(cash_metrics_json)` on the promoted branch):

```
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_options_composite_stores_smoothed_headline_with_flag_unset
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_row_carries_smoothed_top_level_series_and_pops_cash_marks_notes
2 failed, 20 passed, 99 deselected in 16.58s
restore cmp exit 0
```

Task 1, flag (the `is_smoothed_mtm_enabled() and` conjunct restored on `smoothed_ok`):

```
FAILED tests/test_stitch_composite_job.py::test_smoothed_flag_off_composite_still_runs_smoothed_pass
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_options_composite_stores_smoothed_headline_with_flag_unset
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_and_cash_metrics_share_one_key_set
FAILED tests/test_stitch_composite_job.py::test_g252_promoted_row_carries_smoothed_top_level_series_and_pops_cash_marks_notes
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[budget_refusal]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[bounded_timeout]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[structural_ledger_error]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[degenerate_length]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[smoothed_overlap_error]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[smoothed_derive_valueerror]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[retention_bucketed]
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[chain_broken]
FAILED tests/test_stitch_composite_job.py::test_g252_honest_smoothed_derive_reinstates_a_member_guard_break
FAILED tests/test_stitch_composite_job.py::test_g252_withhold_reason_is_dropped_when_the_row_promotes
FAILED tests/test_stitch_composite_job.py::test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing
15 failed, 7 passed, 99 deselected in 20.08s
restore cmp exit 0
```

(The run selector for the Task 1 neuters was `-k "g252 or smoothed_flag_off or options_composite_persists or mtm_gated_reason_in"`; the two cases on the `options_composite_persists` / `mtm_gated_reason_in` names stay green under the flag neuter because the module-level opt-in sets the flag, which is why the by-name failures are the flag-unset G252 cases.) Green after restore: `22 passed, 99 deselected in 24.87s`.

Task 2 (selector `-k g252` over `test_stitch_composite_job.py` and `test_composite_headline_parity.py`):

```
=== NEUTER P3: retention_bucketed=False unconditionally ===
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[retention_bucketed]
1 failed, 20 passed, 109 deselected in 30.96s
restore cmp exit 0
=== NEUTER P4: chain_broken=False unconditionally ===
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[chain_broken]
FAILED tests/test_stitch_composite_job.py::test_g252_honest_smoothed_derive_reinstates_a_member_guard_break
FAILED tests/test_composite_headline_parity.py::test_g252_unpromoted_headline_equals_cash_settlement
3 failed, 18 passed, 109 deselected in 23.97s
restore cmp exit 0
=== NEUTER honest derive: drop scalar_returns and densify_policy from the smoothed derive ===
FAILED tests/test_stitch_composite_job.py::test_g252_non_promoting_path_keeps_the_cash_headline_and_the_named_withhold[chain_broken]
FAILED tests/test_stitch_composite_job.py::test_g252_honest_smoothed_derive_reinstates_a_member_guard_break
FAILED tests/test_composite_headline_parity.py::test_g252_unpromoted_headline_equals_cash_settlement
3 failed, 18 passed, 109 deselected in 24.62s
restore cmp exit 0
=== NEUTER stale marker: remove the headline_basis pop on the not-promoted branch ===
FAILED tests/test_stitch_composite_job.py::test_g252_stale_promoted_marker_heals_on_a_non_promoting_option_stitch
FAILED tests/test_stitch_composite_job.py::test_g252_formerly_promoted_row_with_no_option_activity_is_an_ordinary_cash_composite
2 failed, 19 passed, 109 deselected in 46.86s
restore cmp exit 0
=== NEUTER no-option: decision runs when smoothed_ok is False too ===
FAILED tests/test_stitch_composite_job.py::test_g252_no_option_composite_is_byte_identical_with_the_flag_unset_and_set[perp_only_deribit]
FAILED tests/test_stitch_composite_job.py::test_g252_no_option_composite_is_byte_identical_with_the_flag_unset_and_set[ccxt_member]
2 failed, 19 passed, 109 deselected in 49.30s
restore cmp exit 0
=== GREEN ===
21 passed, 109 deselected in 36.03s
```

Every neuter was a byte copy of `job_worker.py` taken first (`cmp` exit 0 against the copy before and after), restored by `cp`, never by git checkout, restore or stash.

Two honest gaps against the plan's wording. (1) The stale-marker neuter names the two stale-marker cases and not "the exactly-one invariant" separately: the invariant helper (`_g252_assert_exactly_one_marker`) runs in the promoted case and every matrix case, and none of those seed a stale marker, so the invariant by itself cannot see this neuter; the stale-marker cases do. (2) The honest-derive neuter makes the chain-broken matrix case and the parity case fail as well as the dedicated one, because without the zero_fill input the NaN day is bridged and the row promotes. That is the same causal chain the plan describes (no break reinstated, so the row promotes).

## Existing tests whose intent changed

None deleted. All four re-stated for the flag-independent pass; each was red for a real reason after the change.

| Test | Old intent | New intent |
|---|---|---|
| `test_mtm_gated_reason_in_dq_flags_when_option_active` | an option-active composite stores `mtm_gated_reason` and `{cash_settlement, smoothed_mtm}` | forces a smoothed structural degrade (`LedgerValuationError` on the smoothed build) so the reason is still pinned on its real population, an UNPROMOTED option-active row; by-basis is `{cash_settlement}` |
| `test_options_composite_persists_smoothed_while_mtm_gated` | smoothed persists, MTM key absent, reason stays `unsmoothed_options_book` | smoothed persists, MTM key absent, and the row is PROMOTED: `headline_basis == "smoothed_mtm"`, no `mtm_gated_reason` |
| `test_smoothed_dark_launch_composite_skips_smoothed_pass` | flag off, options composite runs NO smoothed pass (2 combines, `{cash_settlement}`) | **renamed `test_smoothed_flag_off_composite_still_runs_smoothed_pass`**: flag off, an options composite runs cash + smoothed (4 combines, a `smoothed_mtm` ledger build, `{cash_settlement, smoothed_mtm}`). The no-option half moved to `test_g252_no_option_composite_is_byte_identical_with_the_flag_unset_and_set` |
| `test_composite_smoothed_helper_valueerror_degrades` | discriminated the smoothed derive from the cash derive by the absence of `densify_policy` | same degrade intent, discriminates by call order (cash derive is call 1, smoothed derive is call 2), because the smoothed derive now carries `densify_policy` |

The module comment above `pytestmark` was updated to say the opt-in is inert for the composite route and kept so these cases stay as written.

`test_composite_headline_parity.py`: edited by APPENDING two cases only (`test_g252_promoted_headline_equals_the_basis_object_named_by_headline_basis`, `test_g252_unpromoted_headline_equals_cash_settlement`) plus a short module-level note; no existing case changed, and none was red. Its existing cases now ride a promoted row whose smoothed series equals the cash one (combine is basis-independent there), which is why they stayed green; only the two new cases distinguish the bases.

`test_stamp_io_exhaustive.py`: NOT edited (it stayed green).

## Chart-decision reading (2026-11-26 founder decision)

Recorded as the plan states it. "The OG card does NOT get the withheld sentence, and the return and drawdown charts are NOT withheld. Both stay as they are" is read as: no chart or card code changes, and the charts stay un-withheld. What moves is the stored series they read. On a promoted row the top-level series in the `metrics_json` spread (`returns_series`, `drawdown_series`, `monthly_returns`, `sparkline_returns`, `sparkline_drawdown`) are the smoothed ones, so every chart drawn from them shows the curve that matches the promoted figures. `csv_daily_returns`, the cash by-basis object and the sibling series rows stay cash; the factsheet's "Cash settlement" view still draws the cash curve beside its withheld figures. Pinned by `test_g252_promoted_row_carries_smoothed_top_level_series_and_pops_cash_marks_notes` (series equal the smoothed by-basis values, differ from cash) and by the `csv_daily_returns` equality inside the end-to-end case.

## Known mismatch (recorded, not fixed)

The sibling series kinds (rolling metrics, drawdown curve via `upsert_strategy_analytics_series_batch`) stay on the CASH result on a promoted row. The code comment above `_upsert_siblings` still says they agree with the headline, which is no longer true on a promoted row. Plan-time measurement: no file under `src/` reads those kinds (only the basis-series and conventions reads in `composite-read-path.ts`), so moving them would change a stored chart input nobody draws, against the "charts stay as they are" decision. `test_g252_promoted_options_composite_stores_smoothed_headline_with_flag_unset` and each matrix case pin that the sibling batch equals the budget-refusal (cash) run's batch.

## MT5-membership grep (T-252-29, 155.2)

An MT5 key cannot be a composite member. `closed_sets.py`: `CRYPTO_VENUES = frozenset({"deribit", "binance", "okx", "bybit", "sfox"})`, so `mt5` is outside it. `job_worker.py`: `_COMPOSITE_CRYPTO_VENUES = CRYPTO_VENUES`, `_COMPOSITE_DEGRADE_VENUES = _COMPOSITE_CRYPTO_VENUES - {"deribit", "sfox"}`, and a member on any other venue reaches the `venue != "deribit"` arm in `_reconstruct_all`, which stamps failed and returns a PERMANENT `unsupported composite member venue` result before any reconstruction. Greps: `grep -an "_COMPOSITE_DEGRADE_VENUES\|venue != \"deribit\"" analytics-service/services/job_worker.py` (declaration, the degrade-venue branch, the refusal arm) and `grep -an "^CRYPTO_VENUES" -A3 analytics-service/services/closed_sets.py`. Behaviourally, `test_g252_no_option_composite_is_byte_identical_with_the_flag_unset_and_set` (perp-only Deribit and ccxt-member) pins identical headline payload and flags across both flag states, no smoothed build, no marker and no promotion line.

## `origin/main` re-check of `job_worker.py`

`git log --oneline HEAD..origin/main -- analytics-service/services/job_worker.py` after `git fetch` printed nothing: `origin/main` is 3 commits ahead of this worktree (`da98acd39`, `90bde12a8`, `ccacb3761`), none of which touches `job_worker.py`. The most recent `job_worker.py` commit on `origin/main`, `2fda7ab31`, is an ancestor of this worktree HEAD. No other branch edited `run_stitch_composite_job` since the plan's base.

## Deviations from Plan

None - plan executed as written. Two notes, neither a deviation: the diff gates and the "plan base" were taken against this worktree's base `33d4cf863` rather than the plan's `57229df98`, and the Task 1 / Task 2 split of the test file was done by committing Task 1's tests first, then appending Task 2's.

## Threat model coverage

- T-252-25 (cash artefact published as the smoothed headline): promotion only through `smoothed_headline_promotion`; marker, reason pop and scalars in the one upsert; the exactly-one invariant and the spread-source / stale-marker neuters above.
- T-252-26 (invented flat days): honest derive plus P4; honest-derive neuter above.
- T-252-27 (third crawl / transient): GLB-3 unchanged; `test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing` pins a transient with no `strategy_analytics` or `csv_daily_returns` write, a byte-unchanged seeded row, and the `_stamp_429` spy (the api_keys 429 stamp is the expected side effect). Ongoing cost accepted: every stitch of an option-active composite, the recurring composite ledger refresh included, now runs the third crawl.
- T-252-28 (kill-switch bypass widening to single-key): the non-comment read count went 3 to 2, `test_mtm_single_key.py` unedited and green, fence diff 0.
- T-252-29 (an MT5 number moves): no-option byte identity case plus the grep above.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change. `data_quality_flags.headline_basis` is a new stored flag key on the existing row, covered by T-252-25.

## Post-deploy (orchestrator-owned; restated for the verifier, NOT executor tasks)

Plans 09 and 10 ship together in the next 252 ship PR. Then:

1. After main's CI is green and the Railway worker has deployed the ship (the founder's deploy path), re-stitch the two flagged composites through the product's own job (a `stitch_composite` compute job through the existing enqueue path). Never a backfill UPDATE.
2. Read PROD through the Supabase MCP, read-only, marker query first. For each of the two rows read `data_quality_flags->>'headline_basis'`, `data_quality_flags->>'mtm_gated_reason'`, `computation_status`, `computed_at`, the top-level `cumulative_return`, `cagr`, `calmar`, `sharpe`, `max_drawdown`, the `metrics_json_by_basis` key set, and whether each top-level figure equals `metrics_json_by_basis->'smoothed_mtm'`.
3. Pass: `headline_basis = smoothed_mtm`, no `mtm_gated_reason`, status `complete` or `complete_with_warnings`, top-level figures equal the smoothed object, and plan 10's owner-factsheet check passes. Then list the moved figures in the CHANGELOG entry (SC-5) and close G252-MTM-PROMOTION.
4. Fail: the row still carries `unsmoothed_options_book` and no marker (the safe, still-withheld state). Read the worker log line `smoothed headline not promoted ... (<cause>)` or the step-6b degrade warning and keep the gap open. Routing: `smoothed_chain_broken` and `retention_bucketed_option_days` go to a founder question; `smoothed_basis_not_computed` after a budget or timeout warning goes to measuring the stitch budget for the 1232-day member, then a founder decision; a structural warning is a new probe reading.

Known limits (recorded, not covered): the stitch-time budget for the third crawl on the 1232-day member is unmeasured; whether an in-the-money payout lands as cash on the close day is unmeasured (252-08 next step 3); a future single-key Deribit options strategy stays with `[252-SINGLEKEY-OPTIONS-CASH]` (this promotion is composite-only).

## Self-Check: PASSED

- FOUND: `analytics-service/services/stitch_composite.py`, `job_worker.py`, `closed_sets.py`, `tests/test_stitch_composite.py`, `tests/test_stitch_composite_job.py`, `tests/test_composite_headline_parity.py`
- FOUND commits: `a482c0c31`, `b9a0c4002` (both ancestors of HEAD)
- `STATE.md` and `ROADMAP.md` untouched.
