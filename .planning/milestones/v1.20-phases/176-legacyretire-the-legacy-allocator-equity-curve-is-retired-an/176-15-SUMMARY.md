---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 15
subsystem: analytics-worker-tests-and-ledger
tags: [D-02, SC-1, SC-3, whole-service-pin, fake-table-trim, todos-triage]
requires: ["176-12", "176-13"]
provides:
  - "a CI pin that fails when any non-docstring string constant in analytics-service production code names a dropped object"
  - "the derive-compose LEGACY_TABLE fake guard and its five importers' seeds retired"
  - "two SC-3 TODOS closures, the OKX narrowing, and a dated disposition for 25 further legacy-curve entries"
affects: ["176-16 (reads the PROD apply the closures wait on)"]
key-files:
  created:
    - analytics-service/tests/test_legacy_table_not_named.py
  modified:
    - analytics-service/tests/test_derive_allocator_equity_job.py
    - analytics-service/tests/test_allocator_equity_departed.py
    - analytics-service/tests/test_allocator_equity_inception.py
    - analytics-service/tests/test_allocator_equity_writer_basis.py
    - analytics-service/tests/test_holder_matrix_parity.py
    - analytics-service/tests/test_writer_residual_parity.py
    - analytics-service/tests/test_match_portfolio_aum_per_key.py
    - analytics-service/tests/test_match_portfolio_aum_native_unpriced.py
    - analytics-service/tests/test_match_router.py
    - analytics-service/tests/test_allocator_equity_compose_read_race.py
    - analytics-service/tests/test_allocator_equity_dropped_day_pnl.py
    - analytics-service/tests/test_allocator_equity_emptied_stretch.py
    - analytics-service/tests/test_allocator_equity_realized_basis.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py
    - analytics-service/services/broker_dailies.py
    - TODOS.md
decisions:
  - "The pin scans AST string constants that are not docstrings, not comments: a comment cannot reach PostgREST, and the retirement history is rightly written in comments and docstrings."
  - "test_compose_does_not_read_legacy_snapshots kept its api_keys column assertions and was renamed test_compose_reads_the_account_identity_columns; its fake-refusal half went with the dropped table."
status: complete
commits: 3
plan_head_before: 57985b937771f1671ed6129719e65c0533eecb97
plan_head_after: aeb3794bdd8582e33e89b90e47b7163be608fe87
actuals:
  tokens: 21700  # chars/4 over the realized diff (86,834 chars)
  tasks: 3
  commits: 3
---

# Phase 176 Plan 15: the service is pinned never to name a dropped object Summary

A new AST pin fails CI when any non-docstring string constant in the Python service names the dropped table, a dropped
replace RPC, `extract_symbol_value_at` or the dropped fan-out. It replaces the one-fake `LEGACY_TABLE` guard in the derive-compose
tests, every fake that listed the dropped table lost that entry, and the ledger says which legacy-curve TODOS entries the
retirement closed, narrowed or left alone. The one production edit is a docstring.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | 842084270 | test(176-15): the service is pinned never to name a dropped object; the derive-compose legacy guard is retired (D-02) |
| 2 | 506ea3217 | test(176-15): fakes no longer list the dropped table; stale consumer docstring corrected |
| 3 | aeb3794bd | docs(176-15): close the two legacy-exclusion entries (SC-3), narrow the OKX entry, triage the rest |

`commits: 3` is measured from the plan base `57985b937` (HEAD when this plan started; the commit ledger was created at plan
start in `/tmp/legacyretire-15/PLAN_BASE`).

## Task 1: the pin (tracer) and the drill

- `analytics-service/tests/test_legacy_table_not_named.py::test_no_production_string_names_a_dropped_object` lists files with
  `git ls-files` over `services`, `routers`, `models`, `scripts`, `main.py`, `main_worker.py`, `main_worker_healthz.py` and
  `sentry_init.py` (a new tracked file is covered with no edit), walks each AST, skips module, class and function docstrings,
  and fails naming each `path:line`. It also asserts `services/job_worker.py`, `main.py` and `main_worker.py` are in the scanned set,
  so an empty list cannot pass vacuously.
- **GREEN on its base, as expected** (plan 11 already removed every such constant): `1 passed`.
- **RED drill** (`/tmp/legacyretire-15/drill.log`): on a byte backup of `services/job_worker.py`, a module-level
  `_LEGACY_PROBE = "allocator_equity_snapshots"` was appended. The test FAILED:
  `FAILED tests/test_legacy_table_not_named.py::test_no_production_string_names_a_dropped_object` with
  `services/job_worker.py:16342 names 'allocator_equity_snapshots'`. The file was restored from the backup with `cp`;
  `cmp` exit 0.
- D-02 trim in `test_derive_allocator_equity_job.py`: removed the `LEGACY_TABLE` constant, `_LegacyWriteError`, `_guard_legacy` and
  its four call sites, the legacy select refusal, and 41 `LEGACY_TABLE: []` seeds. Removed tests:
  - `test_pin6_compose_job_never_writes_legacy_snapshots` (its only assertions were the guard); the module docstring records
    the retirement and leaves the pin number unused so pin 7 keeps its name.
  - `test_compose_does_not_read_legacy_snapshots` was NOT removed: besides the guard it asserts the compose persists one
    version-2 curve and reads the account-identity columns of `api_keys`. Those assertions are unchanged; it is renamed
    `test_compose_reads_the_account_identity_columns`. Historical planning documents (`167.1.2-05-SUMMARY.md`,
    `167.1.2-C2-VERIFY.md`) cite the old name; they are records and were not edited.
- Five importers (`test_allocator_equity_departed`, `_inception`, `_writer_basis`, `test_holder_matrix_parity`,
  `test_writer_residual_parity`) lost the import and the `LEGACY_TABLE: []` seed.
- Result: the seven files `460 passed`; `git grep -aw LEGACY_TABLE -- analytics-service/tests` is empty.

## Task 2: the eight fakes and the docstring

- Removed the `"allocator_equity_snapshots": []` seed from `test_match_portfolio_aum_per_key` (11), `_native_unpriced` (1),
  `test_allocator_equity_compose_read_race`, `_dropped_day_pnl`, `_emptied_stretch`, `_realized_basis` and
  `test_nav_marks_compose_roundtrip` (1 each); in `test_match_router.py` four `name in ("allocator_holdings",
  "allocator_equity_snapshots")` tests became `name == "allocator_holdings"` and one comment line was shortened.
- `services/broker_dailies.py` (`reconstruct_mt5_nav_levels` docstring, the only production edit): the sentence naming
  `allocator_equity_snapshots.value_usd` as the consumer now names the live consumer, `run_derive_broker_dailies_job` reading the
  realized NAV level at the last USD return day, and says the legacy consumer was retired by Phase 176. Comment-only; no behaviour
  change.
- Full suite with CI's flags (`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-fail-under=80`, run
  from `analytics-service/`): **`13362 passed, 97 skipped, 0 failed`**, coverage **94.49%** (floor 80). The 97 skips were not
  introduced here (plan 17 recorded the same 97).
- mypy (CI's line, verbatim): **`Success: no issues found in 131 source files`**.
- Census of `allocator_equity_snapshots` in `analytics-service` (`git grep -an`): base `101` lines over 24 files
  (`/tmp/legacyretire-15/census-base.txt`, which also counts `LEGACY_TABLE`); now `23` lines, none a fake-table seed key. The
  survivors, all comments or docstrings or a retired-gate record:
  `services/allocator_equity_derive.py:54`, `services/equity_reconstruction.py:456`, `services/job_worker.py:14564` and `:16140`
  (docstrings), `tests/test_e2_deribit_allocator_dailies.py:6`, `tests/test_e2_parity_oracle.py:14`,
  `tests/test_marksource_cross_curve.py:3`, `tests/test_mt5_deal_reconstruction.py:538` (docstrings or comments),
  `tests/test_legacy_allocator_jobs_retired.py:151` (`_purge_allocator_equity_snapshots` in a deleted-names list),
  `tests/test_legacy_table_not_named.py` (the pin itself, 5 lines),
  and `tests/test_equity_reconstruction.py:329-406` (see Deferred Issues).

## Task 3: the ledger

All dates 2026-11-02. Entries cited by id. Counts only; no ids, amounts or paths added. `git diff --numstat` against the plan base:
57 added, **0 deleted** lines. Closures that depend on the drop name the migration and say closed by its PROD apply, which plan 16 reads;
closures that depend on deleted code name plan 11 (shipped in v0.133.15.0).

**SC-3**
- `167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION`: CLOSED (by the drop's apply).
- `167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION`: CLOSED (by the drop's apply).
- `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`: NARROWED to the `allocator_holdings` USDT rows and the append-only
  scenario audit sizes; stays open.

**Triage of every other hit** (read_first grep over the terms in the plan, plus a read of each entry and a check that its
subject symbol is or is not in the tree at HEAD):

| Entry | Disposition | Why |
|---|---|---|
| `167.2.1.1.2-ACCOUNT-REBUILD-BLOCKERS` | CLOSED | forced account rebuild deleted (plan 11) |
| `167.2.1.1.2.1-READ-CEILING-STRANDS-ACCOUNT` | CLOSED | rebuild trade read and `TruncatedTradeRead` deleted |
| `167.2.1.1.2.1-BINANCE-TRADES-NEED-SYMBOL` | CLOSED | rebuild trade read deleted |
| `167.2.1.1.2.1-BYBIT-TRADES-LINEAR-ONLY` | CLOSED | allocator rebuild read deleted; strategy sync's `_BYBIT_FILL_CATEGORIES` is another path, unchanged |
| `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` | CLOSED | forced OKX read and `_okx_forced_opening_check` deleted; orphaned OKX modules named |
| `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` | CLOSED | the 730-day rebuild it gated is gone |
| `172-OKX-NONPOSITIVE-REPLAY-UNGATED` | CLOSED | forced OKX rebuild deleted |
| `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` | CLOSED | `OPENING_TOLERANCE_REL` lives in an orphaned module, decides nothing |
| `173-BYBIT-HISTORY-REBUILD-HELD` | CLOSED | no rebuild path; a6 history stays as recorded by construction (founder `go`, D-08) |
| `180-BYBIT-EARN-FLOWS-UNREAD` | CLOSED | the Unified-edge rebuild replay is gone; `fetch_bybit_unified_flows` has no production caller |
| `167.2.1.1-ANCHOR-POSITIONS-READ-FAILURE` | CLOSED | the only `_fetch_current_equity` caller (Binance mark) passes `refuse_unread_positions=True` |
| `167.2.1.1.1-UNFORCED-ANCHOR-BYBIT-USDT-UPNL` | CLOSED | same: no unforced caller; Bybit mark reads UTA totals |
| `167.2.1.1.1.1-BINANCE-ANCHOR-UNPRICED-REFUSES` | CLOSED | `_fetch_and_price_window` deleted |
| `167.1.2.1.1-FALLBACK-LEADER-PREFLIGHT` | CLOSED | refresh job (`run_refresh_allocator_equity_daily_job`) deleted |
| `167.1.2.1.1-LEADER-STATUS-FLIP` | CLOSED | same |
| `167.1.2.1.1-IDENTITY-HOLD-DERIBIT` | CLOSED | refresh hold deleted; derive's identity hold has its own escalation |
| `167.1.2.1-TWIN-STALE-DEFINITION` | CLOSED (by the drop's apply) | trigger (a new fan-out CREATE) cannot occur |
| `167.1.2.1-TRANSIENT-NEVER-CAPS` | CLOSED (by the drop's apply) | the daily fan-out and its per-book handler are the subject |
| `167.1.2.1-CAPPED-KEY-STAYS-CAPPED` | CLOSED (by the drop's apply) | cap gated the fan-out retry; Overview note removed in PR 2; columns booked inert |
| `180-BYBIT-LIVE-FLOW-KINDS` | NARROWED | rebuilt-history half gone; live readers still read the on-chain pair only; stays open |
| `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY` | NARROWED | reconstruct anchor and rebuild refusal gone; holdings poll half stays open |
| `167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD` | NARROWED | reconstruct-anchor path gone; derive anchor and holdings spot rows halves stay open |
| `167.2.1.1-DERIVE-USDT-ONLY-ANCHOR` | note: unaffected | `_fetch_current_equity` survives; its pinning test still holds |
| `167.1.2.1.1-HOLD-SENTRY-LEADER` | note: unaffected | already closed in code; its subject job is deleted |
| `167.1.2.1.1-LEFTOUT-SENTRY-NO-WRITE` | note: unaffected | same |
| `166.3.1-NOCAP-MT5-A2-CIRCULAR` | note: unaffected | the refresh-job comparison no longer exists; the A2 check is untouched |

**Hits read and left without an edit** (historical narrative or already closed, nothing to correct): the item numbered 0.1 in the FIX NOW section
(MT5 factsheets go stale silently), which names the 05:00 refresh job as past context, the `167.1.1-BRIDGE-DOLLAR-RATIO-RETURNS` bullet (closed 2026-10-16), the
164.7 activation pre-flight narrative that names the fan-out functions (closed), `167.2.1.1-MULTIKEY-RECOMPUTE`,
`167.2.1.1.2-ACCOUNT-CRAWL-DIAGNOSTICS` and `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` (each already CLOSED),
`173-BYBIT-TRANSFERS-ON-CHAIN-ONLY` (already CLOSED), `167.2.1.1.1.1-OKX-OPTION-READ-429-MASKED` (the mark path survives),
`167.1.2.1.1-NEWBOOK-HELD-BACK-LINE` and `-NEWBOOK-WAIT-UNBOUNDED` (derive-side), `167.1.2.2.1-WRITER-BASIS-VALUES` and
`-WRITER-BASIS-EMPTY-READS-LEGACY` ("legacy roll" there is the compose's, not this table), `176-INERT-LEFTOVERS`,
`176-RECONSTRUCT-CAP-MARKER-INERT` (written by plan 11), and `QUANTSTATS-0086-REDERIVE-01` / `SECRETSCAN-FULLHISTORY-01` (matched
only on the words "daily refresh" and "full history").

## CHANGELOG inputs

- Added: `analytics-service/tests/test_legacy_table_not_named.py`, a whole-service pin (AST, non-docstring string constants,
  `git ls-files` file list) that no production code names the dropped table, its replace RPC, `extract_symbol_value_at` or the
  dropped fan-out. Proven to bite by a drill on `services/job_worker.py`.
- Removed: the derive-compose `LEGACY_TABLE` fake guard (`_LegacyWriteError`, `_guard_legacy`, the legacy select refusal, one
  pin-6 test) and the dropped table's entry in 14 test fakes. `test_compose_does_not_read_legacy_snapshots` renamed
  `test_compose_reads_the_account_identity_columns`.
- Changed: a docstring in `services/broker_dailies.py` that named the dropped table's column as a consumer.
- Notes: `TODOS.md` closes the MT5-BTC and sFOX legacy-exclusion entries (by the drop's apply), narrows the OKX double-count
  entry to the `allocator_holdings` USDT rows, and closes, narrows or annotates 25 more legacy-curve entries (list above).

## Deviations from Plan

### Auto-fixed Issues

None to code. Items the plan could not have anticipated:

**1. [Verify mismatch] The Task 3 uuid clause cannot pass as written.**
- **Found during:** Task 3.
- **Issue:** `! grep -aqE '<uuid pattern>' TODOS.md` scans the whole file, and TODOS.md already carries 3 uuid-shaped strings at the plan base (older entries: a wizard correlation id and two row ids).
- **Resolution:** checked what this plan adds instead: `git diff <base> HEAD -- TODOS.md | grep '^+'` has 0 uuid-shaped strings. The 3 pre-existing ones were left because removing them deletes lines, which the plan forbids (0 deleted lines), and rewriting old entries is outside this plan. They are a candidate for a separate scrub of public tracked text.

**2. [Expected] `verify-plan-anchors --pending` and two of its vitest cases fail while this plan is pending.**
- The plan's own `verify-symbol` lines name `LEGACY_TABLE` and `_LegacyWriteError`, which this plan deletes, so the real-tree scan reports
  them stale until the plan stops being pending (its SUMMARY exists). Re-run after this file landed: see Verification below.

## Deferred Issues

- `analytics-service/tests/test_equity_reconstruction.py:329-406` still carries a fake that emulates the dropped table and the
  two dropped replace RPCs (`replace_allocator_equity_snapshots`, `replace_allocator_equity_snapshots_window`). It is not in this
  plan's file list, it uses unquoted-key forms the Task 2 acceptance grep does not match, and plan 17 pruned this module and
  left this fake. The tests pass. It is the remaining place a fake still names a dropped object; it is outside the whole-service pin
  (tests are not production code). Left for the orchestrator to route.
- Three pre-existing uuid-shaped strings in TODOS.md (above).

## Threat Flags

None. No new endpoint, auth path or file access; test-only edits, one docstring and ledger paragraphs.

## Known Stubs

None.

## Verification

- Tasks 1 and 2 verify blocks' substance, run by hand: drill FAILED line present, `cmp` exit 0, seven files `460 passed`, full
  suite `13362 passed`, coverage 94.49%, mypy clean, no listed fake names the dropped table as a quoted string.
- Task 3 verify: both exclusion entries carry `CLOSED ... Phase 176 LEGACYRETIRE` inside their own section, the OKX entry carries
  `NARROWED ... Phase 176 LEGACYRETIRE`, `git diff --numstat` shows 57 added and 0 deleted lines, and no added line carries a uuid.
- TODOS-reading vitest files (`audit-coverage`, `baseline-content-drift-allowlist`, `csv-finalize-cross-submission-merge`,
  `gate-family-meta`, `lint-migration-data-dependence`, `verify-plan-anchors`): see the closing line of the handback for the
  post-SUMMARY re-run.
- No Supabase, TEST, PROD or Railway touched. No VERSION, package.json or CHANGELOG change.

## Self-Check: PASSED

- `analytics-service/tests/test_legacy_table_not_named.py` exists; commits `842084270`, `506ea3217`, `aeb3794bd` are ancestors of HEAD;
  `/tmp/legacyretire-15/job_worker.py.bak` is byte-equal to `analytics-service/services/job_worker.py` (`cmp` exit 0).
