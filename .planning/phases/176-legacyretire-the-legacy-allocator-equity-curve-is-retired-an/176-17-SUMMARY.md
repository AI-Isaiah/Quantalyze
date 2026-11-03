---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 17
subsystem: analytics-worker-tests
tags: [test-pruning, D-02, D-04, D-08, text-readers, mt5-lease-roster]
requires: ["176-11"]
provides:
  - "a Python suite that collects (13221 tests, 0 errors) and passes under CI's own flags at 94.45 percent coverage"
  - "the three text readers of the deleted crawl handled by name, two of them drilled RED"
affects: ["176-12 (PR 2 now ships a green Python job)"]
key-files:
  modified:
    - analytics-service/tests/test_mt5_concurrency.py
    - analytics-service/tests/test_mt5_server_clock.py
    - analytics-service/tests/test_trade_pages.py
    - analytics-service/tests/test_closed_sets.py
    - analytics-service/tests/test_equity_reconstruction.py
    - analytics-service/tests/test_trade_read_store.py
    - analytics-service/tests/test_allocator_positions.py
  deleted:
    - "14 test modules (listed below)"
decisions:
  - "Decision D-08 (go) governs: the dead set is plan 11's 114 symbols, and the readers of the deleted MT5 backfill arm are retired, not kept."
status: complete
commits: 2
plan_head_before: 6f651af7c39b78826d15475a1528496a53b8d7f2
plan_head_after: db03349764d8b990a65ab6145867b32d21ea3002
actuals:
  tokens: 308600  # chars/4 over the realized diff (1,234,464 chars, almost all deleted lines)
  tasks: 3
  commits: 2
---

# Phase 176 Plan 17: the tests move with the code plan 11 deleted Summary

The Python suite tests only code that still exists: 14 modules and 627 test functions went with their subjects, the three text
readers of the deleted crawl were re-pointed or retired by name, and the full suite under CI's own flags is green at 94.45
percent coverage with mypy strict clean. Only files under `analytics-service/tests` changed.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | f0db094f1 | test(176-17): tests move with their deleted subjects (cross-module fixpoint) |
| 2 | db0334976 | test(176-17): re-point the text readers of the deleted crawl (D-04) |
| 3 | none (drills on byte backups, tree clean) | |

`commits: 2` is measured from the plan's ledger (`6f651af7c`, HEAD when the first task commit was made).

## Counts

- Decision: `go` (derived: `_mt5_fetch_window` is in the dead set; agrees with plan 11).
- Dead set: derived by AST from plan 11's deletion commit (`7bfcb1929`) as 113 top-level names plus `_DeribitNotSupportedBase`, which
  is bound inside an `if TYPE_CHECKING` branch and which a top-level walk misses. That makes 114, equal to plan 11's list.
- Collection: base `14119 tests collected` (plan 11's `collect-base`); after plan 11 `12961 collected, 24 errors` (`red-collect.log`,
  exit 2, 24 collection errors naming deleted symbols or the two deleted scripts); after Task 1 `13222 collected, 0 errors`
  (`green-collect.log`); after Task 2 `13221` (one more test removed). Net removed from the collected count: 898.
- Test functions (AST, `def test*`, parametrize not expanded): 627 removed across 14 deleted modules and 17 pruned modules.
- Full suite with CI's flags (`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-fail-under=80`):
  `13124 passed, 97 skipped, 0 failed` (`t2-full.log`), coverage `94.45%` against the 80 floor.
- The 97 skips are all environment-gated and none is new: a live Supabase or lane URL unset (most of them), founder-gated sFOX
  and cassette tests, the `HAS_PY_ENV` parity tests, and two known flaky-timeout skips. One `empty parameter set` skip is in
  `test_mt5_validate.py`, untouched by this plan. Reasons are in `skips.log`.
- mypy strict with CI's exact line: `Success: no issues found in 131 source files` (`t2-mypy.log`), exit 0.
- Lines: Task 1 `32 files changed, 141 insertions(+), 26492 deletions(-)`; Task 2 `4 files changed, 19 insertions(+), 35 deletions(-)`;
  base to HEAD `35 files changed, 72 insertions(+), 26439 deletions(-)` (`--patience`).
- `git diff --stat` of `analytics-service/services routers models scripts` against the plan base: empty (tests only).

## Task 1: the prune

The tool was `prune.py`, a cross-module AST fixpoint (six rounds). A unit is a top-level function, class or assignment, or a `test_*`
method; it is removed when it names a dead binding (a name imported from `services.equity_reconstruction` that is in the dead set, a
name bound from a dead script, a name removed from another test module, `er.<dead>` through any alias, a patch-path string, or a
`setattr(er, "<dead>")` string). The report was read before write mode. Then three clean-up passes removed what the removals left
behind: helpers and constants no test or importer reached any more, imports they left unused, and section banners with nothing
under them. Each pass only touched names or comments that were used or attached before.

Per file (tests before / after, AST):

| File | Before | After | Result |
|---|---|---|---|
| test_allocator_history_probe | 122 | - | deleted (the probe script is gone) |
| test_e2_ground_truth_harness | 5 | - | deleted (the E2 script is gone) |
| test_bybit_two_year_window | 9 | - | deleted (drives the job body and `_account_rebuild_window`) |
| test_equity_reconstruction_integration | 1 | - | deleted (drives the refresh job) |
| test_equity_reconstruction_live | 1 | - | deleted (drives the reconstruct job) |
| test_okx_anchor_rule | 18 | - | deleted (OKXANCHOR forced-rebuild check) |
| test_reconstruct_marker_writer | 9 | - | deleted (all nine drive the job body; the plan expected this) |
| test_reconstruct_sibling_replace_scope | 5 | - | deleted |
| test_reconstruct_whole_account | 74 | - | deleted |
| test_refresh_allocator_equity_carry_forward | 70 | - | deleted |
| test_refresh_holds_for_inflight_reconstruct | 19 | - | deleted |
| test_replace_snapshots_window | 6 | - | deleted |
| test_reconstruct_force_rebuild | 30 | - | deleted (29 drive the job body; the 30th, see below) |
| test_replace_snapshots_window_live | 4 | - | deleted (3 drive the window replace; the 4th guarded only them) |
| test_equity_reconstruction | 126 | 2 | pruned; stays as the home of the shared fakes other modules import |
| test_trade_pages | 35 | 1 | pruned (the unified-flows pin, re-pointed in Task 2) |
| test_trade_read_resume | 24 | 2 | pruned (kept: store-vs-migration names, watchdog sweep) |
| test_marksource_cross_curve | 15 | 1 | pruned (14 compared the deleted legacy curve) |
| test_fanout_owed_predicate_twins | 11 | 2 | pruned (the two SQL-literal arms survive, as planned) |
| test_ana_recon_audit | 37 | 22 | pruned (15) |
| test_price_rule | 29 | 18 | pruned (11) |
| test_okx_chain_record | 59 | 50 | pruned (9 drove the deleted probe's record emitter) |
| test_one_key_per_account_day | 9 | 6 | pruned (3) |
| test_okx_opening_tolerance | 5 | 2 | pruned (3) |
| test_okx_close_precision | 10 | 8 | pruned (2) |
| test_bybit_funding_record | 18 | 16 | pruned (2) |
| test_bybit_unified_flows | 16 | 14 | pruned (2 used the probe; the reader's own tests stay) |
| test_job_worker_flipretry | 15 | 14 | pruned (`test_reconstruct_window_crawl_hang_is_bounded_transient`) |
| test_mt5_handover | 27 | 26 | pruned (the BACKFILL site test) |
| test_nav_marks_compose_roundtrip | 48 | 47 | pruned (`_polled_empty_since` pin) |
| test_allocator_positions | 64 | 64 | one test edited, none removed (below) |
| test_trade_read_store | 19 | 19 | one test rewritten, none removed (below) |

Untouched and green: `test_history_reconstruct_cap_event` (8 tests), `test_history_reconstruct_cap_orphan_sweep` (10),
`test_history_reconstruct_cap_twins` (2), `test_legacy_allocator_jobs_retired` (5), `test_nav_marks_bybit_uta`,
`test_nav_marks_l4_read`. All 34 tests of the five D-04 files pass. The cap-event handler tests needed no pruning: plan 08 had
already moved their patch target. The keep-list survivors the plan named are all present: both cap twins, both SQL-literal arms
of the fan-out twins, `test_the_cap_is_five`, and `test_the_d04_inert_helpers_stay`.

The 24 modules plan 11 listed: 10 deleted, 12 modified (`test_trade_read_store` by a rewrite, the rest pruned), 2 (`cap_event`,
`cap_orphan_sweep`) unchanged.

### Removed tests of surviving code (T-176-31, listed as the plan requires)

None of these touch a keep-list helper; each names a deleted oracle or a deleted script as its subject.

- `test_okx_chain_record`: nine tests (`test_the_chain_keys_are_the_tail_of_the_probes_record_keys`,
  `test_the_probes_defaults_equal_the_chain_defaults`, `test_every_default_passes_its_validator_and_none_reads_as_a_clean_zero`,
  `test_the_honest_record_prints_and_leaks_nothing`, `test_every_declared_key_refuses_a_value_outside_its_vocabulary`,
  `test_every_ordering_key_...`, `test_every_repeat_and_below_stop_key_...`, `test_every_seven_day_and_sweep_key_...`,
  `test_the_chain_vocabulary_is_fifty_nine_keys_and_the_tail_of_the_probe`). Their subject is the deleted probe's `emit_record` and
  `_account_record` guard; `okx_chain_record.py` itself keeps its other 50 tests. Founder: the probe script "is retired with it".
- `test_bybit_funding_record` (2) and `test_bybit_unified_flows` (2): each compares a constant of the surviving module with the
  deleted probe's (`hp.<name>`).
- `test_marksource_cross_curve`: 14 tests compared the legacy curve with the derived curve; the legacy writer is deleted.
- `test_ana_recon_audit` (15) and `test_price_rule` (11): all call `_compute_daily_equity`, `_fetch_and_price_window`, the job body,
  or `split_holdings_symbol_to_base_quote` and `_merge_account_telemetry` (dead set). The `price_rule` module's own tests stay (18).
- `test_nav_marks_compose_roundtrip::test_stored_mark_anchor_is_no_empty_poll_proof` and
  `test_mt5_handover::test_the_BACKFILL_site_records_its_switch_against_its_api_key_id`: subject `_polled_empty_since` and
  `_mt5_fetch_window`, both deleted.
- `test_reconstruct_force_rebuild::test_the_user_callable_reconstruct_enqueue_passes_no_metadata` (the one survivor of that
  module's 30): a text pin on `request_allocator_holdings_sync.sql` asserting the SQL still names the reconstruct kind. Plan 09's
  migration removed that enqueue (`4add324e0`), so the pin was already red against the tree and its premise is retired by the
  phase's own SQL change, not by a missing symbol. The module is deleted with it.
- `test_replace_snapshots_window_live::test_loopback_guard_refuses_every_non_lane_host`: guarded only the three deleted live probes
  of the window RPC (plan 12 drops the RPC); the module went with them.

### Two tests of surviving code, rewritten instead of removed

- `test_allocator_positions::test_deribit_error_class_removed`: the first half (the allocator-side class stays removed) is surviving
  behaviour; the second half imported the reconstruction-side `DeribitNotSupportedError`. Only that half is dropped.
- `test_trade_read_store::test_the_projection_is_replay_equal_for_every_fee_shape`: its oracle was `_compute_daily_equity`. It is
  now `test_the_projection_keeps_every_fee_shape_as_the_replay_read_it`, with fixture constants as the expected fee (dict with None
  cost is 0.0, dict with cost is the cost, float and None are kept) and a field-by-field comparison; the "can fail" tail compares
  a stored 7.25 fee against a stored None fee. The module's other 18 tests are unchanged.

### Files changed that the plan list does not name

`test_closed_sets.py` (Task 2, below). Every other changed file is on the list; `test_nav_marks_bybit_uta` and
`test_nav_marks_l4_read` are on the list and untouched (their hits are comments). A first tool run over-removed 21 tests of
`test_ledger_refresh_composite_nondestructive` and a few `_FakeTable` helpers because it treated a class that holds only a docstring
as empty; that bug was fixed in the tool before write mode, and none of those files changed.

### Acceptance greps

`git grep -nwE 'run_reconstruct_allocator_history_job|run_refresh_allocator_equity_daily_job|allocator_history_probe|e2_allocator_ground_truth' -- analytics-service/tests`
lists only `test_legacy_allocator_jobs_retired.py:111-112` (the retire pin names them on purpose) and `test_mt5_concurrency.py:969`
(a lineage comment). No code line names a deleted binding.

## Task 2: the text readers

RED (`red-full.log`, CI flags, after Task 1): `5 failed, 13120 passed, 97 skipped`, coverage 94.45. The three planned readers failed:
`test_one_clock_per_backfill`, `test_only_the_rebuild_reads_the_unified_flows`, and both roster tests of `test_mt5_concurrency`
(`test_no_production_function_holds_two_terminal_leases`, `test_every_production_lease_site_names_its_holder_and_site`, one
literal). One more reader the tool could not see failed: `test_closed_sets::test_consumers_share_the_registry_objects`.

| Reader | File | Old expectation | New expectation |
|---|---|---|---|
| `_PRODUCTION_LEASE_SITES` | test_mt5_concurrency | nine sites incl. `("services/equity_reconstruction.py", "_mt5_fetch_window")` | the entry and its two comment lines removed; a dated re-cut note (2026-11-01, Phase 176 D-04) above the literal; the pin's docstring count says the 164.5.4 site was retired by Phase 176 |
| `test_one_clock_per_backfill` | test_mt5_server_clock | the backfill resolves one clock | deleted (its subject is deleted); no helper was used only by it |
| `test_only_the_rebuild_reads_the_unified_flows` | test_trade_pages | `["bybit_unified_flows.py", "equity_reconstruction.py"]` name the reader | renamed `test_no_service_module_calls_the_unified_flows_reader`, expects `["bybit_unified_flows.py"]`; docstring says the rebuild was retired by Phase 176 (D-04), the reader is orphaned and booked in TODOS `176-RECONSTRUCT-CAP-MARKER-INERT`, and the second half is unchanged |
| `test_consumers_share_the_registry_objects` | test_closed_sets | `er.STABLECOINS is cs.STABLECOINS` and `er._STABLECOINS_LONGEST_FIRST is ...` | the `allocator_positions` identity stays; the two `er` assertions are dropped (the deleted crawl was the module's only consumer) |

`test_exchange.py`'s negative pin on the module stayed green unchanged. The date in the re-cut note is 2026-11-01 (the actual
date and the date of D-08), not the plan's 2026-10-31. After the edits: `13124 passed, 97 skipped`, coverage 94.45, mypy exit 0.
`git grep -n '_mt5_fetch_window'` over the two MT5 test files lists comment lines only.

## Task 3: drills and TypeScript readers

- Drill A (the deleted `_mt5_fetch_window` tuple added back to `_PRODUCTION_LEASE_SITES`):
  `FAILED tests/test_mt5_concurrency.py::test_no_production_function_holds_two_terminal_leases`,
  `FAILED tests/test_mt5_concurrency.py::test_every_production_lease_site_names_its_holder_and_site`, `2 failed, 33 passed`.
  Restored from the byte backup: `cmp` exit 0.
- Drill B (`"equity_reconstruction.py"` added back to the unified-flows expected list):
  `FAILED tests/test_trade_pages.py::test_no_service_module_calls_the_unified_flows_reader`, `1 failed`. Restored: `cmp` exit 0.
- `npx vitest run src/__tests__/history-reconstruct-cap-twins.test.ts src/__tests__/marksource-okx-census-sql.test.ts`: 2 files,
  138 tests passed. The tree was clean after the drills.

## Full vitest run (end of plan)

`Test Files 2 failed | 1182 passed | 20 skipped (1204); Tests 4 failed | 23301 passed | 315 skipped (23620)`. The four failures:

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (2): a snapshot differs in the last digit of a float (`skew`
  `-0.11360716852722537` against `...538`). This plan changed nothing outside `analytics-service/tests`, so it predates the phase
  work; it is a platform floating-point difference in untouched code.
- `src/__tests__/verify-plan-anchors.test.ts` "`--pending` ... on the real tree" and "R2-W05: the REAL marker" (2): caused by this
  plan, and cleared by its own SUMMARY. The scan reported one stale claim, `176-17-PLAN.md:141`, the anchor on
  `test_only_the_rebuild_reads_the_unified_flows`, which the plan itself instructs to rename. A plan with a SUMMARY is no longer
  pending, so writing this file clears it. Re-run after the SUMMARY: see the Self-Check.

## Deviations from Plan

1. **[Rule 1 - tooling] Dead set is 114 by one nested binding.** A top-level AST walk gave 113; `_DeribitNotSupportedBase` sits under
   `if TYPE_CHECKING`. Added by hand; equals plan 11.
2. **[Rule 1 - tooling] Prune tool bug fixed before write mode** (a docstring-only class counted as "empty"); see above.
3. **[Rule 2 - correctness] Two tests rewritten rather than removed** (a half-surviving pin and a test whose oracle was deleted),
   so surviving code keeps its coverage. See above.
4. **[Scope, own mess] Clean-up beyond the tool's first pass** in the pruned modules: 160 helpers or constants nothing referenced
   any more, the imports they left unused, section banners and an end-of-file banner block with nothing under them, stale module
   docstrings of the heavily pruned modules (`test_equity_reconstruction`, `test_marksource_cross_curve`, `test_trade_pages`). Names
   unused or comments already stray before the plan were left alone (four stray indented comments in `test_equity_reconstruction`
   were there at the base).
5. **[Reader the planner missed]** `test_closed_sets::test_consumers_share_the_registry_objects` (Task 2, above).
6. **[Date]** The re-cut note carries 2026-11-01, not the plan's 2026-10-31.
7. **[Scope]** The module `test_reconstruct_force_rebuild` was deleted although one test survived the symbol prune: its premise was
   retired by plan 09's SQL, so it was red against the tree. The plan expected a suite red only from deleted symbols.

No auth gates. No stubs. No production file touched.

## CHANGELOG inputs

- Tests: 14 Python test modules deleted (`allocator_history_probe`, `e2_ground_truth_harness`, `bybit_two_year_window`,
  `equity_reconstruction_integration`, `equity_reconstruction_live`, `okx_anchor_rule`, `reconstruct_marker_writer`,
  `reconstruct_sibling_replace_scope`, `reconstruct_whole_account`, `refresh_allocator_equity_carry_forward`,
  `refresh_holds_for_inflight_reconstruct`, `replace_snapshots_window`, `reconstruct_force_rebuild`, `replace_snapshots_window_live`)
  and 17 pruned: 627 test functions removed, collected tests 14119 to 13221, 26,439 lines deleted, 72 added.
- Re-pointed readers: the MT5 lease-site roster (`_mt5_fetch_window` entry removed), `test_one_clock_per_backfill` retired,
  `test_only_the_rebuild_reads_the_unified_flows` renamed `test_no_service_module_calls_the_unified_flows_reader`, and the
  `closed_sets` registry identity pin (one consumer fewer).
- Rewritten: `test_the_projection_keeps_every_fee_shape_as_the_replay_read_it` (fixture-constant oracle).
- Verified: full pytest with CI flags 13124 passed, 97 skipped, coverage 94.45 percent against 80; mypy strict clean on 131 files;
  both text readers drilled RED and restored with `cmp`.
- Notes: the reconstruct-kind enqueue pin on `request_allocator_holdings_sync.sql` was already red after plan 09 and is gone.

## Self-Check

- Files: the four edited reader files and the rewritten store test FOUND; the four spot-checked deleted modules ABSENT.
- Commits: `f0db094f1` and `db0334976` are ancestors of HEAD.
- Task verifies: Task 1 printed OK; Task 2's pytest and mypy ran green (the named RED failures are in `red-full.log`); Task 3's drills
  went RED, `cmp` exit 0 on both restores, the two TS files passed, the tree was clean.
- After this SUMMARY: `node scripts/verify-plan-anchors.mjs --pending` prints `OK: 9 plan file(s), no stale claims`, and
  `verify-plan-anchors.test.ts` passes (58 tests), which clears the two vitest failures this plan had caused.

Self-Check: PASSED
