---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 11
subsystem: analytics-worker
tags: [deletion, D-02, D-04, D-08, legacy-writers, crawl, operator-scripts]
requires: ["176-08", "176-10"]
provides:
  - "services/equity_reconstruction.py without the legacy writers, both job bodies, the bootstrap twin and the dead crawl"
  - "two pins: test_the_legacy_writers_are_gone and test_the_d04_inert_helpers_stay"
  - "TODOS 176-RECONSTRUCT-CAP-MARKER-INERT"
affects: ["176-17 (test pruning)", "176-12 (replace-RPC drop)"]
key-files:
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_legacy_allocator_jobs_retired.py
    - TODOS.md
  deleted:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/scripts/e2_allocator_ground_truth.py
decisions:
  - "Founder decision D-08 (2026-11-01): go. Delete the old engine in full, minus the D-04 keep-list."
status: complete
commits: 2
plan_head_before: e30f1ac511481f441bbfb419ac6a8c84fbfa8e67
plan_head_after: 7da85f226
actuals:
  tokens: 123600  # chars/4 over the realized diff (494,311 chars), mostly deleted lines
  tasks: 3
  commits: 2
---

# Phase 176 Plan 11: the legacy writers, the job bodies and the dead crawl are deleted Summary

`services/equity_reconstruction.py` fell from 8,122 to 1,734 lines: nothing in the worker can write the legacy curve or call
either replace RPC any more, the D-04 cap and marker helpers are byte-identical and pinned, and both legacy operator
scripts are gone.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (checkpoint) | none (artifacts only) | founder go/no-go, answered `go` |
| 2 (tracer) | 7bfcb1929 | refactor(176-11): delete the legacy writers, both job bodies and the bootstrap twin, and per the founder's go/no-go the crawl only they used (D-02, D-04); delete the two legacy operator scripts |
| 3 | 7da85f226 | docs(176-11): book the inert reconstruct machinery, the removed tooling and the crawl's orphans (D-04) |

`commits: 2` is measured from the plan's ledger (`e30f1ac51`, the orchestrator's D-08 record, was HEAD when the first task
commit was made). `PLAN_BASE` (`3aa7f30ab`) to HEAD is three commits because it includes that record.

## The founder's decision (Task 1, blocking-human checkpoint)

`decision.txt` holds the single line `go`. The founder's answers, 2026-11-01 (AskUserQuestion), quoted verbatim:

1. The founder first asked how the new solution looks, and whether the deletion removes the named phases' work or the legacy code.
2. They then chose "Check the new path, then go (Recommended)": "First check whether the new curve's path has the problems those phases fixed in the old engine (Bybit above the trade-read limit, OKX opening balance, trade pages, multi-key accounts). Report any gap, then delete the old engine in full."
3. After the check, they answered "Go (Recommended)": "Delete the old engine in full. The REBUILDGATES/BYBITFUNDING probe script, which imports it, is retired with it. The Bybit Unified-transfer reader is not on the delete list and stays, ready for the gap below."

The gaps the check found in the NEW path are booked as a separate fix phase. They are not 176's work, and this plan books
nothing for them. `bybit_unified_flows.py` was left untouched.

`collect-base` (the full suite's collected count before any deletion, for plan 17): `14119 tests collected in 7.87s`.

## Completed-phase tooling this removes or orphans

Presented to the founder under `go`, re-measured by AST (production importers, never by text grep). The re-measure agrees
with the plan's list; the symbol count differs by one (see "Dead set" below).

- Removed with the crawl:
  - ACCTREBUILD 167.2.1.1.2: `_crawl_whole_account`, `_forced_refusal_result`, `_job_requests_force_rebuild`,
    `replace_equity_snapshots_window`, the `force_rebuild` metadata contract (`RECONSTRUCT_FORCE_REBUILD_KEY`, the three
    `RECONSTRUCT_EXPECTED_*` keys, `_account_keys_digest`), `FORCED_REBUILD_ANCHOR_REASONS`, `FORCED_REBUILD_ACCOUNT_REASONS`,
    `FORCED_REBUILD_REFUSAL_REASONS`.
  - TRADEPAGES 167.2.1.1.2.1: `_read_bybit_window`, `_read_bybit_trades_resumable`, `_fetch_trades_with_pagination`,
    `_fetch_okx_inst_type_trades`.
  - READCEILING 171: `TruncatedTradeRead`, `TRUNCATED_READ_SITES`, `_validated_claim_budget`.
  - OKXANCHOR 172: `_okx_forced_opening_check`. OKXREWRITE 178: `_select_account_crawl_keys`.
  - The MT5 backfill arm (164.5.4) and MT5OFFSET 175: `_mt5_fetch_window` (with `_mt5_rows_from_levels`, `_mt5_telemetry`).
- Removed with the scripts: the REBUILDGATES 173 and BYBITFUNDING 180 gate readings (`allocator_history_probe.py`), and the
  Phase 115 E2 harness (`e2_allocator_ground_truth.py`).
- Orphaned, kept and booked (measured post-deletion, see "Measured orphans"): `services/trade_read_store.py` and its tables,
  `services/okx_opening_balance.py` and `services/okx_bills_chain.py`, `fetch_bybit_unified_flows`.
- Not orphaned: `services/okx_archive_job.py` (`job_worker` dispatches it).

## Dead set (Task 2)

The AST tool (a symbol is live when on the keep-list, named by any production file as a Name, an Attribute attribute, an
import alias or an identifier-shaped string constant, or named by a live symbol; fixpoint) found **114 dead symbols** under
`go`: 5,892 node lines, 6,104 with the comment block directly above each. The plan's planning figure was 113 (122 minus 9 on the
keep-list). The tool's reconciliation block reproduces the planning shape (keep-list not treated as roots: 123 dead symbols
against the planning 122, 9 keep-list names in that set, as planned), so the difference is one symbol; the tool cannot say
which, because the planning script is not preserved. Counting identifier-shaped strings or not changes nothing (114 both
ways). Every one of the 114 has zero production references, which the import smoke, the name-resolution sweep and mypy strict
confirm independently. One name-collision suspect was kept by the rule (`RAW_PAYLOAD_CAP_BYTES`, which `allocator_positions.py`
defines separately).

By group (symbols, node lines): the eight seeds 8 / 1,537; named on the plan's tooling list 20 / 1,346; refresh-job support
18 / 828; daily-equity replay and snapshot-writer support 8 / 633; perp and contract valuation tables and helpers 22 / 309;
other crawl machinery and trade-read plumbing 38 / 1,239. The 86 symbols outside the named list and the seeds are listed in the Task 1
report (`report-go.txt`), which is what the checkpoint presented.

Seeds (both options): `persist_equity_snapshots` (82), `_purge_allocator_equity_snapshots` (37),
`_allocator_has_equity_snapshots` (36), `replace_equity_snapshots` (79), `replace_equity_snapshots_window` (68),
`run_reconstruct_allocator_history_job` (709), `run_refresh_allocator_equity_daily_job` (432),
`_owed_reconstructs_for_zero_snapshot_book` (94): 1,537 lines, as planned.

All 114 with node line counts (the record of `deadset.txt`): OKX_TRADE_TERMINUS_DAYS 1, BYBIT_TRADE_TERMINUS_DAYS 1,
BACKFILL_CAP_DAYS 1, _TRADE_PAGE_LIMIT 1, _BYBIT_TRADE_WINDOW_MS 1, _BYBIT_WINDOW_PAGE_CEILING 1,
_BYBIT_WINDOW_SEGMENT_CEILING 1, _TRADE_PASS_PAGE_CEILING 1, _TRUNCATED_READ_MESSAGE 3, TRUNCATED_READ_SITES 5,
TruncatedTradeRead 14, _RECONSTRUCT_CRAWL_TIMEOUT_S 3, _validated_claim_budget 17, _TRADE_READ_CLAIM_BUDGET_S 3,
_TRADE_READ_DEFER_S 1, _STORE_SETTLE_MS 1, OKX_INSTRUMENT_TYPES 3, VENUE_HISTORY_DEPTH_MONTHS 5,
OKX_CTVAL_LAST_VERIFIED_AT 1, PERP_AMT_CTVAL_DIVERGENCE_THRESHOLD 1, PERP_AMT_CTVAL_DRIFT_WARN_THRESHOLD 1,
_PERP_AMT_FROM_COST_MIN 1, _PERP_AMT_FROM_COST_MAX 1, OKX_PERP_CONTRACT_SIZE 16, OKX_FUTURES_CONTRACT_SIZE 1,
_OKX_LINEAR_INST_TYPES 1, _PerpAmtSource 12, PerpPosition 50, _is_inverse_perp 13, breakdown_key_for_perp 12,
split_holdings_symbol_to_base_quote 20, _resolve_perp_amt_base 104, _DeribitNotSupportedBase 9, DeribitNotSupportedError 8,
history_depth_months_for_venue 5, _BREAKDOWN_TOP_N 1, _BREAKDOWN_PROTECTED_KEYS 6, _cap_breakdown 38, _extend_unseen 18,
_next_page_cursor 9, _read_bybit_window 140, _refuse_bybit_start_past_terminus 21, _fetch_bybit_trades 37,
_read_bybit_range 17, _as_stored_trade 8, _read_bybit_trades_resumable 101, _fetch_trades_with_pagination 62,
_fetch_okx_inst_type_trades 71, _fetch_trades_paginated_one_pass 66, _compute_daily_equity 453, _result_row_count 23,
persist_equity_snapshots 82, SiblingCheckResult 25, _allocator_has_other_api_keys 87, _purge_allocator_equity_snapshots 37,
EmptyReplaceRefusedError 15, SnapshotPresence 14, _allocator_has_equity_snapshots 36, replace_equity_snapshots 79,
_WINDOW_REPLACE_REFUSAL_TOKEN 1, _window_replace_refusal 15, replace_equity_snapshots_window 68,
RECONSTRUCT_FORCE_REBUILD_KEY 1, RECONSTRUCT_EXPECTED_NON_WORKING_KEY 1, RECONSTRUCT_EXPECTED_WINDOW_KEY 1,
RECONSTRUCT_EXPECTED_KEY_DIGEST_KEY 1, _account_keys_digest 9, _job_requests_force_rebuild 13,
FORCED_REBUILD_ANCHOR_REASONS 10, FORCED_REBUILD_ACCOUNT_REASONS 15, FORCED_REBUILD_REFUSAL_REASONS 3,
_AccountCrawlRetryableError 24, _ACCOUNT_REBUILD_VENUES 1, _select_account_crawl_keys 83, _bybit_window_start 12,
_account_rebuild_window 21, _account_history_depth_months 10, _sum_breakdowns 25, _sum_account_rows 46,
_merge_account_telemetry 74, _strategy_linked_key_ids 40, _owed_reconstructs_for_zero_snapshot_book 94,
_REFRESH_HOLDINGS_COLUMNS 4, CARRY_AGE_WARN_DAYS 1, CARRY_AGE_CAP_DAYS 1, _LatestHoldings 66,
_fetch_latest_holdings_per_eligible_key 397, _is_refresh_price_gap 14, _judge_price_gaps 45, _over_age_account_holds 9,
_identity_unknown_and_not_working 19, _POLL_COMPLETED_ACTION 1, _POLL_OUTCOME_READ_LIMIT 1, _NO_EMPTINESS_PROOF_VENUES 1,
_parse_utc_instant 12, _polled_empty_since 170, _okx_forced_opening_check 74, _fetch_and_price_window 417,
_MT5_BACKFILL_MESSAGES 89, _mt5_telemetry 31, _mt5_rows_from_levels 111, _mt5_fetch_window 460, _forced_refusal_result 54,
_AccountCrawl 22, _ACCOUNT_KEY_COLUMNS 4, _read_account_keys 35, _crawl_account_key 67, _crawl_whole_account 214,
run_reconstruct_allocator_history_job 709, _defer_reconstruct 52, _HOLD_SENTRY_OUTCOME 7, _refresh_hold_reason 13,
_refresh_audit_counts 27, run_refresh_allocator_equity_daily_job 432.

## Task 2: RED first, then the deletion

- RED at the base (`red-at-base.log`): `FAILED tests/test_legacy_allocator_jobs_retired.py::test_the_legacy_writers_are_gone`,
  `1 failed, 4 passed`; `test_the_d04_inert_helpers_stay` passed on the base.
- After: `5 passed`. Import smoke (`services.equity_reconstruction`, `services.job_worker`, `main_worker`) exits 0.
  mypy strict with CI's line: `Success: no issues found in 131 source files`.
- Deletion: a script took the spans of `deadset.txt` and removed them bottom-up, each with its decorators and the comment
  block directly above; an AST pass then removed the module-level imports nothing left uses (27 import statements edited,
  `dataclass` caught by a second pass because a docstring mentioned it). Empty section banners and the stale MT5 backfill
  comment block were removed; the module docstring now says what Phase 176 removed, that the D-04 helpers stay inert (TODOS
  `176-RECONSTRUCT-CAP-MARKER-INERT`), and what the module still provides. `git diff --patience --numstat` for the module:
  22 insertions (docstring, import lines), 6,410 deletions.
- The two scripts were `git rm`'d after an AST check that no file under `analytics-service/scripts/` other than those two
  imports a deleted symbol. `scripts/okx_chain_record.py` still imports (`import scripts.okx_chain_record` exits 0).
- Name-resolution sweep: every name that any production file imports from `services.equity_reconstruction`, or reads as an
  attribute of it (13 names), still exists (`missing: []`).
- Acceptance greps: `git grep -nw` of the three names over services, routers, models, main and main_worker lists comment
  lines only:
  - `analytics-service/services/broker_dailies.py:975`, the docstring line ``` ``persist_equity_snapshots`` / ``replace_equity_snapshots``. Handing that column a ```
  - `analytics-service/services/equity_reconstruction.py:4`, the new module docstring naming the removed writers.
  - `analytics-service/services/equity_reconstruction.py:521`, the comment ``in-flight job is waited on, see ``_owed_reconstructs_for_zero_snapshot_book`` ``.
- Keep-list check: the plan's acceptance one-liner uses the default `git diff` algorithm, which misaligns around a deletion of
  this size and prints three keep-list `def` lines as removed and re-added. That would make its `! grep` fail. The truth was
  measured two other ways: `git diff --patience` shows none of them removed, and an AST comparison of the base and the new module
  finds all ten keep-list symbols' source segments byte-identical (`10 10 True`).

## Task 3: both pins can fail

- Drill A (`persist_equity_snapshots = None` appended): `AssertionError: persist_equity_snapshots is back in services.equity_reconstruction: Phase 176 D-02 deleted the legacy allocator equity writers, both job bodies and the bootstrap twin`, `FAILED tests/test_legacy_allocator_jobs_retired.py::test_the_legacy_writers_are_gone`, `1 failed, 4 passed`. Restore from the byte backup: `cmp` exit 0.
- Drill B (`del _mark_api_key_history_reconstructed` appended): `AssertionError: _mark_api_key_history_reconstructed is missing from services.equity_reconstruction: D-04 keeps the cap and marker helpers inert (TODOS 176-RECONSTRUCT-CAP-MARKER-INERT)`, `FAILED tests/test_legacy_allocator_jobs_retired.py::test_the_d04_inert_helpers_stay`, `1 failed, 4 passed`. Restore: `cmp` exit 0.
- `npx vitest run src/__tests__/history-reconstruct-cap-twins.test.ts src/__tests__/marksource-okx-census-sql.test.ts`: 2 files, 138 tests passed. The TODOS-reading tests (`audit-coverage`, `baseline-content-drift-allowlist`, `gate-family-meta`, `lint-migration-data-dependence`, `csv-finalize-cross-submission-merge`, `verify-plan-anchors`): 6 files, 199 tests passed.

## Measured orphans (AST, production files only, after the deletion, against the base)

- Services modules that lost their last production importer: none.
- Modules now imported only by an entry point or a script: `services.trade_read_store` (only `main_worker`, for
  `purge_expired`), `services.okx_opening_balance` (only `scripts/okx_chain_record.py` and `services/okx_bills_chain.py`),
  `services.okx_bills_chain` (only `scripts/okx_chain_record.py`). `services.bybit_unified_flows` and
  `services.okx_archive_job` still have `services/job_worker.py`.
- Public functions under services/ with no production caller left that had one at the base: `bybit_unified_flows.fetch_bybit_unified_flows`,
  `closed_sets.perp_quote`, `dateday.sort_events_stable`, `holding_equity.is_price_gap_holding`,
  `okx_opening_balance.opening_agrees`, `okx_opening_balance.read_okx_opening`, `price_rule.close_on_or_before`,
  `price_rule.gap_holds_the_day`, and nine of `trade_read_store` (`begin_claim`, `claim_deadline`,
  `current_trade_read_scope`, `deadline_passed`, `job_too_old`, `load_window`, `purge_keys`, `record_progress`, `save_window`).
- Compute job kinds: Python never had an enqueue site for `reconstruct_allocator_history` or `refresh_allocator_equity_daily`;
  the module's only literal of the first was the twin's `.eq("kind", ...)` read, now gone. Python literals left: `job_worker`
  (dispatch, cap hook) and `main_worker` (watchdog). Their SQL enqueuer `enqueue_refresh_allocator_equity_for_all` has its newest
  definer in `20261021120000_refresh_fanout_owed_key_reconstruct.sql` and still enqueues both kinds; retiring it belongs to
  the migration plans of the phase. No other kind changed its literal count.
- The services modules `equity` and `ingestion.*` show no static importer; they are loaded through a registry, a pre-existing
  condition outside this plan.

All of it is booked in TODOS `176-RECONSTRUCT-CAP-MARKER-INERT`.

## For plan 17 (test pruning)

The full suite's collection is red by construction: `14119 tests collected` at the base, now `12961 tests collected, 24 errors`
(`collect-after.log`). The 24 modules fail on `cannot import name` of a deleted symbol (`run_reconstruct_allocator_history_job`,
`run_refresh_allocator_equity_daily_job`, `VENUE_HISTORY_DEPTH_MONTHS`, `_owed_reconstructs_for_zero_snapshot_book`) or
`No module named 'scripts.allocator_history_probe'` / `'scripts.e2_allocator_ground_truth'`: test_allocator_history_probe,
test_bybit_funding_record, test_bybit_two_year_window, test_bybit_unified_flows, test_e2_ground_truth_harness,
test_equity_reconstruction, test_fanout_owed_predicate_twins, test_history_reconstruct_cap_event,
test_history_reconstruct_cap_orphan_sweep, test_marksource_cross_curve, test_okx_anchor_rule, test_okx_chain_record,
test_okx_close_precision, test_okx_opening_tolerance, test_one_key_per_account_day, test_reconstruct_force_rebuild,
test_reconstruct_marker_writer, test_reconstruct_sibling_replace_scope, test_reconstruct_whole_account,
test_refresh_allocator_equity_carry_forward, test_refresh_holds_for_inflight_reconstruct, test_trade_pages,
test_trade_read_resume, test_trade_read_store. Note that `test_history_reconstruct_cap_event`,
`test_history_reconstruct_cap_orphan_sweep` and `test_reconstruct_marker_writer` cover the D-04 inert cap and marker code,
which still exists; their imports of deleted names need pruning, not the tests of the kept helpers.

## Deviations from Plan

1. **[Reporting] Symbol count 114 against the planning 113.** Explained above; no behaviour impact, all 114 verified dead.
2. **[Rule 1 - tooling] The plan's keep-list acceptance one-liner is unreliable.** Default `git diff` misaligns a 6,000-line
   deletion. Replaced by `--patience` plus an AST source comparison; the keep-list is intact.
3. **[Scope, own mess] Beyond the span deletion** the executor also removed the empty section banners, the stale MT5 backfill
   comment block, the stale B8b stablecoin comment, and the stale `math` import comment that named a deleted function, all in
   `equity_reconstruction.py` and all orphaned by the deletion. Survivors' docstrings that still name deleted functions
   (`ForcedRebuildRefusedError`, a few price-gap comments) were left as written: they are comments, not code, and editing
   them is outside "delete what is dead".
4. **[Order] The two tests were added with `import services.equity_reconstruction as er` at the top of the test file**, beside the
   existing import, instead of a mid-file import.

No auth gates. No stubs were introduced.

## CHANGELOG inputs

- Removed (worker): the legacy allocator equity writers `persist_equity_snapshots`, `_purge_allocator_equity_snapshots`,
  `_allocator_has_equity_snapshots`, `replace_equity_snapshots`, `replace_equity_snapshots_window`; the job bodies
  `run_reconstruct_allocator_history_job` (709 lines) and `run_refresh_allocator_equity_daily_job` (432 lines); the bootstrap
  gate's Python twin `_owed_reconstructs_for_zero_snapshot_book`; and, by the founder's `go` (2026-11-01), the 114-symbol history
  crawl (ACCTREBUILD forced rebuild, TRADEPAGES and READCEILING trade reads, OKXANCHOR, OKXREWRITE, the MT5 backfill arm, the
  daily-equity replay). `services/equity_reconstruction.py`: 8,122 to 1,734 lines (6,410 deleted, 22 added).
- Removed (scripts): `allocator_history_probe.py` (2,240 lines) and `e2_allocator_ground_truth.py` (493 lines), the REBUILDGATES
  and BYBITFUNDING gate readings and the Phase 115 E2 harness.
- Kept inert, byte-identical, pinned: the ten D-04 cap and marker helpers; `bybit_unified_flows.py` untouched.
- Tests: `test_the_legacy_writers_are_gone` and `test_the_d04_inert_helpers_stay`, each with a neuter drill.
- Notes: the Python test suite's collection is red until plan 17 prunes the 24 modules above. TODOS
  `176-RECONSTRUCT-CAP-MARKER-INERT` books the inert machinery, the removed tooling and the measured orphans.
- Net: 5 files, 187 insertions, 9,225 deletions (code and TODOS).

## Self-Check: PASSED

- Files: `analytics-service/services/equity_reconstruction.py` FOUND; `analytics-service/tests/test_legacy_allocator_jobs_retired.py` FOUND; the two scripts ABSENT as intended.
- Commits: `7bfcb1929` and `7da85f226` are ancestors of HEAD.
- Task verifies: Task 1 printed OK; Task 2's checks (RED on base, import smoke, retire tests, mypy strict) all passed; Task 3 printed OK.
