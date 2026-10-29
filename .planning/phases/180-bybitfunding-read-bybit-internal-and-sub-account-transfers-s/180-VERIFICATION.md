---
status: passed
verified_at_sha: 10387c1ae49923f57c6e11b084f99bd3f274f6d6
drift_subjects:
  - analytics-service/scripts/bybit_funding_record.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/ccxt_flow_fetch.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/job_worker.py
  - docs/runbooks/marksource-okx-history-correction.md
---

# Phase 180: BYBITFUNDING Verification Report

**Phase Goal:** The allocator history probe and the rebuild read a Bybit account's internal (off-chain) deposits and sub-account transfers beside its on-chain deposits and withdrawals, so a6's funding is explained and the Bybit transfer-depth gate (`bybit_transfers_gate`) can be measured before any Bybit history rebuild.
**Verified:** 2026-10-29 at the sha above (worktree `quantalyze-180`, branch `feat/180-bybitfunding`)
**Status:** passed (post-deploy reading recorded 2026-10-29, see the last section)
**Re-verification:** No, initial verification
**Scope note:** plans 01 to 07 are executed. Plan 08 (operator: founder-approved deployed probe of a6, gate recording, founder rebuild decision, ledger) has not run, by design: it waits for ship, merge, green main and the Railway deploy. SC-3 and the live half of SC-1 are therefore `human_needed` (pending operator), not failed.

## Verdict in one paragraph

Everything code and tests can prove is proven. The probe machinery (per-source counts, tokens, redaction, the gate's named cause, the funding explanation), the rebuild's Unified-edge flow read (7-day windows, every cursor page, refusals instead of short lists), the cursor paging fix in `fetch_ccxt_transfers` for every caller, the 17th refusal token, and the unforced permanent failure all exist, are wired, and are held by tests that I re-neutered myself and saw go RED. No gap found. The phase is not closable until plan 08 runs, because "a6's funding is explained" and "`bybit_transfers_gate` reads `ok` or stays `unmeasured` with the named cause" are statements about a live Bybit key that no test can make.

## Commands run (all from the worktree's `analytics-service/`, main checkout venv, ccxt 4.5.85 vs repo pin 4.5.88)

| Check | Result |
|---|---|
| CI mypy line verbatim (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) | `Success: no issues found in 131 source files`, exit 0 |
| Focused set: `test_ccxt_flow_fetch`, `test_bybit_unified_flows`, `test_bybit_funding_record`, `test_allocator_history_probe`, `test_okx_chain_record`, `test_trade_pages`, `test_bybit_two_year_window`, `test_reconstruct_force_rebuild`, `test_exchange_pagination` | 527 passed, 0 failed |
| Full suite once, `-n auto --dist loadgroup -q` | 13941 passed, 102 skipped, 0 failed (the 102 skips are the pre-existing live-DB and TODO skips named in SUMMARY 06 and 07; none added by this phase) |
| Vocabulary import check | anchor reasons 6, account reasons 11, total 17; `account_flow_source_unreadable` in the closed set; the probe's `_FLOW_SOURCE_REFUSAL` is in it |
| Debt-marker scan (TBD, FIXME, XXX) on every phase-touched service and script | none |
| Tree after my mutation runs | `git status` shows no tracked changes; every restore was `cmp`-identical to its byte backup |

## Observable Truths

Source: ROADMAP SC-1..SC-3, CONTEXT D-01..D-04, plan must-haves.

| # | Truth | Status | Evidence |
|---|---|---|---|
| SC-1a | A read-only probe measurement (counts and tokens only) can name how a6 was funded: on-chain deposits, internal deposits, sub-account or universal transfers, or a source still unnamed | VERIFIED (machinery) | `scripts/bybit_funding_record.py` reads five sources (`onchain_dep`, `internal_dep`, `withdraw_all`, `inter_xfer`, `universal_xfer`) plus `isMaster` and `uta`, 35 `FUNDING_KEYS` (6 per source, 3 key-info, 2 census). Each source records rows, `older_365d`, `oldest_age_bucket`, `other_status_rows`, `depth_bucket` and a closed state. `bybit_funding_explained` derives `explained` / `off_edge` / `unexplained` ("a source still unnamed") / `unmeasured` / `not-applicable` in code. Spliced into the probe's whitelist, validators and defaults; evidence runs after the snapshot and changes no member outcome (`test_the_evidence_runs_after_the_snapshot_and_changes_no_member_outcome`, 6 arms). All green in the 527. |
| SC-1b | The measurement is redacted: no id, amount, UID or finer-than-run-date stamp leaves the process; a source the key cannot read is a token, never a 0 | VERIFIED | Counts are `field-absent` unless a window answered; `SOURCE_STATES` is closed; `read_key_info` keeps booleans only and never `userID` / `parentUid`. `test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing` plants fake transfer ids, member ids, UID, amounts and stamps and asserts none reaches stdout, stderr or the result, and that every funding key is non-default so the run is not vacuous. The module is pinned read-only on its own text (`test_the_record_module_names_only_read_endpoints`, seven raw GET names, m3 RED seen by the executor). |
| SC-1c | a6 was actually funded by a named source, per kind and age bucket, on the live key | VERIFIED (live, 2026-10-29) | Needs the deployed probe of a6 (plan 08 Task 1). The "per kind and age bucket" reading is the per-source `older_365d` count plus `oldest_age_bucket` and `depth_bucket`, not a full histogram; that is the shape the plan chose and it is enough for the gate, but the founder should know it is a bucket of the oldest row, not a distribution. | Live: see "Post-deploy reading".
| SC-2a | The transfer read the rebuild uses covers the Unified edge (every kind that crosses it), not the on-chain pair | VERIFIED | `services/equity_reconstruction.py::_fetch_and_price_window` Bybit branch calls `fetch_bybit_unified_flows` (TRANSFER_IN is the deposit kind, TRANSFER_OUT the withdrawal kind, direction from the requested type, never the sign) and never awaits `fetch_ccxt_transfers` for Bybit. Replace-not-add (D-01) is pinned by `test_the_bybit_replay_takes_only_the_unified_flows` (exact id sets, both on-chain fetchers awaited 0 times). |
| SC-2b | The read covers every page of a window | VERIFIED | `bybit_unified_flows.py`: `walk_paginated` over 7-day windows tiled with the +1 ms boundary, 50 a page, `nextPageCursor` authoritative, `stop_on_short_page=False`, a cursor echoed on a non-empty page raises, an empty page ends the window, ceiling `on_ceiling="raise"`. `ccxt_flow_fetch._read_bybit_transfer_window` pages the on-chain record endpoints by the raw answer's own cursor with seen-cursor and 1000-page raises. |
| SC-2c | A test goes RED on the on-chain-only read | VERIFIED (re-run by me) | Neuter: Bybit branch of `_fetch_and_price_window` made to read `fetch_ccxt_transfers` instead of the Unified reader. Result: `test_the_bybit_replay_takes_only_the_unified_flows` and `test_the_bybit_flows_are_read_before_the_trades` FAILED (2 failed, 1 passed). Restored from byte backup, `cmp` identical. Executor's own m1/m2 for plan 06 are recorded in SUMMARY 06. |
| SC-2d | A test goes RED on a dropped page | VERIFIED (re-run by me, two sites) | (i) Unified reader: `next_cursor=""` forced in the `PageResult`: `test_every_page_of_a_window_is_read`, `test_a_repeated_cursor_raises_and_stops_at_once`, `test_an_empty_page_ends_the_window_even_when_its_cursor_repeats`, `test_a_window_past_the_page_cap_raises` FAILED (4 failed, 46 passed). (ii) Shared transfer read: Bybit dispatch in `fetch_ccxt_transfers` made unreachable (old one-ms advance runs): 8 tests FAILED including `test_a_bybit_window_holding_more_than_one_page_returns_every_row`, the cursor-repeat, cycle and ceiling tests, `test_a_full_bybit_page_whose_rows_all_parse_away_still_continues` and `test_an_empty_bybit_page_ends_the_window_even_when_its_cursor_repeats`. Both restored, `cmp` identical, files green again. |
| SC-2e | The page fix applies to every caller (D-02) | VERIFIED | The Bybit branch is inside `fetch_ccxt_transfers` behind `exchange_id == "bybit"`, so `job_worker` broker-dailies and composite readers inherit it; the generic loop for Binance/OKX is byte-identical (diff shows hunks only in imports, the helper, the docstring and the dispatch). `test_exchange_pagination.py` and the caller suites pass (498+ in the fixer's runs, full suite green here). |
| SC-3 | After deploy the probe re-reads a6: `bybit_transfers_gate` reads `ok` or stays `unmeasured` with the named cause; the founder decides the rebuild; nothing is rebuilt over a shut gate | VERIFIED (live, 2026-10-29): gate stays `unmeasured`, cause `neither_older_365d` | Machinery verified: `bybit_transfers_verdict` is byte-identical to its Phase 173 body (needs BOTH a deposit and a withdrawal older than 365 days); `bybit_transfers_cause` derives a closed token in code (`flow_source_unreadable`, `read_incomplete`, `neither_older_365d`, `no_deposit_older_365d`, `no_withdrawal_older_365d`, `none`, `not-applicable`) and feeds no gate; plan 08's `rebuild` option exists only on `ok` and has no override. The live reading and the founder decision cannot be made before deploy. | Live: see "Post-deploy reading"; the founder decided `hold` ("Hold (Recommended)", 2026-10-29).
| D-01 | Unified edge is the rebuild flow source; deposit endpoints stay in the probe as evidence | VERIFIED | See SC-2a and SC-1a. The probe's `_UNIFIED_FLOW_KINDS` equals the reader's `UNIFIED_FLOW_TYPES` and is disjoint from the census types (pinned in `test_bybit_unified_flows.py`). The Earn limitation (flagged discretion) is written, in one searchable line, in the reader, the record module, and the rebuild comment, with the census counting eight candidate types for the founder to read at SC-3; the choice (not flows) is an orchestrator reading, labelled as such. |
| D-02 | Page fix everywhere; new kinds only in rebuild and probe | VERIFIED | `fetch_bybit_unified_flows` is imported only by `equity_reconstruction.py` (call site) and `job_worker.py` (error class for the classifier arm; no call). `test_only_the_rebuild_reads_the_unified_flows` reads `services/*.py` from disk and pins it. Live NAV, composite and broker-dailies keep their kinds; the follow-up is booked in plan 08 as `180-BYBIT-LIVE-FLOW-KINDS`. |
| D-03 | Refuse by name: per-source unreadable token and master/sub flag in the probe; rebuild refuses with a new closed reason; never a silent 0 (only `NotSupported` swallowed) | VERIFIED | Probe: closed `SOURCE_STATES`, `bybit_is_master`, never an id. Rebuild: `ForcedRebuildRefusedError("account_flow_source_unreadable") from None` for AuthenticationError, PermissionDenied, BadRequest and `BybitUnifiedFlowReadError`; transient classes propagate as the same object (`test_a_transient_flow_source_fault_is_not_a_refusal`). The Unified reader and the Bybit transfer helper swallow nothing but `NotSupported` (transfer helper) / nothing (reader). |
| D-04 | One phase, one deploy: wave 1 probe, wave 2 rebuild read with RED tests, then one approved probe and the founder decision | VERIFIED (structure) / PENDING (operator wave) | Waves 1 to 6 are in the git history in that order (`dd08c4a8f` through `e3f4b92b3`); plan 08 is `autonomous: false` and carries the founder-approval and gate checks. |
| T-17 | The refusal vocabulary is a closed, pinned set of 17 tokens, moved in one commit | VERIFIED (re-run by me) | Import check printed 6 + 11 = 17; token present; probe literal inside the set. `test_forced_rebuild_refusal_reasons_are_a_closed_set`, the two `len` pins, the raise-site scan, `test_the_runbook_lists_every_refusal_token_once` and `test_the_two_year_refusal_adds_no_token` pass. Neuter: the token raise replaced by a bare `raise`: 9 failed, 46 passed in `test_reconstruct_force_rebuild.py`. Restored, `cmp` identical. Runbook B'3 rule 3 lists all 17 (and the drift where Phase 171's token was missing from it is fixed and pinned). |
| U-1 | The unforced rebuild with an unreadable Unified flow source fails PERMANENT, writes nothing, and does not fall back to the on-chain pair | VERIFIED (re-run by me) | `classify_exception` arm `isinstance(exc, BybitUnifiedFlowReadError)` returns `("permanent", ...)` above the HTTPException/ccxt arms; the venue's permanent ccxt classes propagate and classify as permanent already. `test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing` (5 cases) and `test_a_bybit_unified_flow_read_error_is_permanent`. Neuter: the arm replaced by `pass`: 5 failed, 177 passed over `test_job_worker.py` + `test_reconstruct_force_rebuild.py`. Restored, `cmp` identical. Transient classes still retry (`test_an_unforced_transient_flow_fault_still_retries`). |
| TB | Time budget: the flow read cannot lose transfers to the 1500 s crawl bound | VERIFIED (by construction) / UNMEASURED live | Flows are read before the trade crawl (`test_the_bybit_flows_are_read_before_the_trades`, m3 RED seen by the executor); the two-year guard runs before the flow read and outside the refusal (`test_the_two_year_guard_runs_before_the_flow_read_and_outside_its_refusal`). The per-claim re-read cost (about 210 requests, about 90 s of the 900 s soft claim budget) is stated in code and SUMMARY 06 as accepted. The 90 s figure is an estimate, not a live measurement. |

**Score:** 14 verified truths, 2 pending operator (SC-1c live, SC-3 live), 0 failed, 0 override.

## Required artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/scripts/bybit_funding_record.py` | VERIFIED | 563 lines, five sources, census, bounds, read-only pin; imported by the probe (`bybit_funding_record.INFLOW_SOURCE_NAMES` used in `bybit_funding_explained`) |
| `analytics-service/services/bybit_unified_flows.py` | VERIFIED | 220 lines, imported and called by `equity_reconstruction.py` |
| `analytics-service/services/ccxt_flow_fetch.py` (Bybit helper) | VERIFIED | `_read_bybit_transfer_window` dispatched from the window loop |
| `analytics-service/services/equity_reconstruction.py` (Bybit branch, 17th token, wrapper) | VERIFIED | |
| `analytics-service/services/job_worker.py` (classifier arm) | VERIFIED | one import, one arm, one docstring row |
| `analytics-service/tests/_bybit_evidence.py`, `_trade_pages.py` doubles | VERIFIED | faithful vendor span and paging rules; `_NewestFirstBybitTransfers` subclasses the real `ccxt.bybit` so ccxt's own cursor and parse code run (this is what exposed the `last_json_response` defect in round 1) |
| `docs/runbooks/marksource-okx-history-correction.md` | VERIFIED | 17 tokens, pinned to the code by test |
| `180-08-SUMMARY.md`, TODOS routed items | NOT YET (plan 08) | expected; operator plan |

## Key links

| From | To | Status |
|---|---|---|
| `_fetch_and_price_window` | `fetch_bybit_unified_flows` | WIRED (single call site, guarded by `_refuse_bybit_start_past_terminus` first) |
| probe `_TradeRecorder` wrapper | the rebuild's own `private_get_v5_account_transaction_log` call | WIRED (`test_the_probe_recorder_sees_the_unified_read_as_deposits_and_withdrawals` wraps the client before the real reader runs) |
| `fetch_ccxt_transfers` | `_read_bybit_transfer_window` | WIRED (early `continue` for `exchange_id == "bybit"`) |
| `BybitUnifiedFlowReadError` | `classify_exception` permanent arm | WIRED |
| `hp._FLOW_SOURCE_REFUSAL` | `er.FORCED_REBUILD_REFUSAL_REASONS` | WIRED (asserted; `emit_record` accepts a record carrying it) |
| probe `_UNIFIED_FLOW_KINDS` | reader `UNIFIED_FLOW_TYPES` | PINNED equal |
| `bybit_transfers_verdict` | gate inputs | UNCHANGED body; the gate's per-kind counts now come from the Unified edge once plan 06 is deployed |

## Review and fix trail (read, not trusted)

Three review rounds (`180-REVIEW*.md`, `180-SFH*.md`) and a fixer log (`180-REVIEW-FIX.md`). The material defects the rounds found, and what I confirmed in code:

- Round 1 WR-02: the first cursor fix read `exchange.last_json_response`, which ccxt leaves off by default, so in production every Bybit window would have ended on page 1. Corrected in `bf2a8ccab` by calling the raw record endpoints and reading the cursor from the call's own answer; the double was rebuilt on the real `ccxt.bybit`. I confirmed the shipped code has no `last_json_response` dependence (only a comment mentions it) and that the re-neuter above is RED.
- Round 1 WR-01/M-5/M-6/M-7: probe states and counts follow the reader's acceptance, per-member state, all Bybit members' evidence, a non-string evidence cursor is `malformed`. Parity test between the probe's row check and the reader's `normalise_unified_flow_row` exists.
- Round 2 CR-01: an empty raw page that still carries a cursor raised `TransferPageStalled`. Fixed; round 3 confirmed; round 3's only warning (WR-01, missing test for the continue direction) was closed by two tests, which I saw RED under neuter.
- Round 3 left: 0 critical, 0 warning open; only LOW/INFO (SFH-3 N-1, N-2, earlier L-1..L-5).

## Behavioral spot-checks

| Behavior | Command | Result |
|---|---|---|
| Closed refusal set is 17 and contains the new token | Python import check (see above) | `6 11 17 True`, probe literal in set |
| Unified reader returns every page | `test_every_page_of_a_window_is_read` (neutered and restored) | RED then 50 passed |
| Rebuild reads only Unified flows, before trades | two `test_trade_pages` tests (neutered and restored) | RED then green |
| Dropped page in shared transfer read | `test_ccxt_flow_fetch.py` (neutered and restored) | 8 RED then green |
| Forced refusal by name | `test_reconstruct_force_rebuild.py` (neutered and restored) | 9 RED then green |
| Unforced permanent classification | `test_job_worker.py` + force-rebuild file (neutered and restored) | 5 RED then green |

Probe execution (Step 7c): no repo probe script (`scripts/*/tests/probe-*.sh`) is declared for this phase; the "probe" here is the allocator history probe, which only runs against a live key and is the operator plan's job. Not run, by instruction (no exchange network calls).

## Requirements coverage

ROADMAP lists `Requirements: TBD`; the plans use phase-local ids SC-1, SC-2, SC-3. SC-1 and SC-2 machinery SATISFIED; SC-1 live half and SC-3 are pending plan 08. No orphaned requirement ids.

## Anti-patterns

None blocking. No TBD, FIXME or XXX markers in the phase's service and script files. No stubs: every new module is called from production code. The unused-wrapper note (probe recorder wraps `fetch_deposits` / `fetch_withdrawals` on a Bybit client, which the Bybit branch no longer calls) is dead but harmless and was dispositioned in the fix log.

## Warnings (non-blocking, for the record)

1. **Live behaviour is unmeasured.** Everything above runs against doubles. The cursor shape of `GET /v5/asset/deposit/query-record` and `.../withdraw/query-record` through ccxt 4.5.88's `privateGetV5Asset...` methods, the Unified transaction log's real row shape (the sign of a `TRANSFER_IN` / `TRANSFER_OUT` row is undocumented; the reader deliberately ignores it and the probe counts contradicting signs in `bybit_unified_sign_mismatch_rows`), and whether a6's key may read the log at all are all first exercised by the plan 08 probe. The local venv has ccxt 4.5.85; the fixer read 4.5.88 source from the uv cache and reported the relevant methods identical, which I did not independently re-check.
2. **Accepted, not fixed (SFH M-2 and the M-7 empty-cursor half):** a full 50-row page that arrives with an empty cursor ends its window as complete. This rests on Bybit's documented cursor contract and matches the funding reader that already runs in production. If Bybit ever returns an empty cursor on a non-final full page, that window would be silently short. The fixer and orchestrator chose not to refuse; I record it as a known residual, not a gap.
3. **Earn / staking / bonus types are not flows** (orchestrator reading 3). For an account that used Earn the replay level is off by the staked amount while staked, backstopped only by the 5x implausibility bound. This is stated in code and the census gives the founder the count for SC-3.
4. **Behaviour changes to name in the CHANGELOG at ship:** unforced Bybit reconstruct with an unreadable Unified log now fails permanent (no on-chain fallback); a Bybit window whose cursor stalls now fails the broker-dailies and composite jobs loudly (`TransferPageStalled` is a plain `RuntimeError`, so `classify_exception` reads it `unknown` and the queue retries it; SFH-2 L-5 booked it as LOW); those live readers now return every Bybit transfer row of a window, which grows their flow lists. Plan 08's text already requires the CHANGELOG to name the first and third.
5. **Bookkeeping, not a verdict input:** `180-VALIDATION.md` still reads `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false`, and its per-task status column is all pending, although every named test exists and passes. ROADMAP plan checkboxes for 01 to 07 are still `[ ]`. Both are for the orchestrator's records step, not code.
6. **Probe depth reading is by bucket of the oldest row**, see SC-1c.

## Human verification required

### 1. Founder-approved deployed full probe of a6 (plan 08 Task 1)

**Test:** After ship, merge, green main (count bound to the merge sha) and the Railway deploy, run the full probe once on the backfill worker (no transfers-only mode), between 00:30 and 21:30 UTC, and copy a6's per-source, Unified-edge and gate lines into the SUMMARY.
**Expected:** a6's record carries all five source readings with a closed state each, `bybit_unified_state` `read`, `bybit_unified_sign_mismatch_rows` 0, `bybit_funding_explained` of `explained`, `off_edge` or `unexplained` (SC-1 met); `unmeasured` is a STOP for the founder.
**Why human:** needs the deployed worker, a real Bybit key and the founder's approval; no test can say how a6 was funded.

### 2. The gate and its named cause (SC-3)

**Test:** Read `bybit_transfers_gate` and `bybit_transfers_cause` for a6 from the summary record.
**Expected:** `ok`, or `unmeasured` with a closed cause (`neither_older_365d`, `no_deposit_older_365d`, `no_withdrawal_older_365d`, `flow_source_unreadable` or `read_incomplete`). Per CONTEXT, if a6 never moved money out more than a year ago the gate cannot read `ok` even on a complete read and SC-3 allows that.
**Why human:** live reading; the gate is a function of a6's real history.

### 3. Founder's rebuild decision

**Test:** Put the decision to the founder once. A non-zero `bybit_other_transfer_like_rows` on a6 is a reason to hold.
**Expected:** `rebuild` is offered only when a6's own gate is `ok`; nothing is rebuilt over a shut gate; ledger closes follow the if-and-only-if rules in plan 08.
**Why human:** a founder decision by definition.

### 4. Live shape confirmations to read off the first probe

**Test:** In a6's record, check the two Bybit record endpoints paged without a `TransferPageStalled`, the Unified read did not refuse (`bybit_unified_state` not `malformed`), and no sign mismatch was counted.
**Expected:** `read`, 0 mismatches.
**Why human:** exercises ccxt 4.5.88 and Bybit's real answers, which the doubles only mirror.

## Gaps Summary

No gaps. Nothing in the phase's code or tests fails a must-have. The status was `human_needed` until the 2026-10-29 post-deploy reading, solely because SC-3 and the live half of SC-1 are the operator plan's output and the phase must not be marked complete before plan 08 runs.

## Post-deploy reading (2026-10-29, plan 08, deployed commit `10387c1ae`)

The full deployed probe ran once on the backfill worker with the founder's approval (shared with Phase 178 plan 03), `probe-exit: 0`, worker restored (`worker-restored: yes`). All figures are copied from `180-08-SUMMARY.md`; counts and tokens only.

| Success criterion | Live reading | Verdict |
|---|---|---|
| SC-1 | a6 `bybit_funding_explained` = `explained`; five source states: `onchain_dep`, `internal_dep`, `inter_xfer` read 0 rows; `universal_xfer` read 8 rows, oldest 180 to 364 days, 0 older than 365 days; `withdraw_all` `not-master` (sub key, master-only endpoint, a limit of the key); key `is_master` false, `is_uta` true; census 0, `census_state` read. a6 was funded by sub-account (universal) transfers. | MET |
| SC-2 | a6 `bybit_unified_state` `read`, in 4 / out 2, `sign_mismatch` 0, `failure_class` none, `member_refusal` none, explanation `explained`: the Unified-edge read the rebuild uses saw the money that funds a6. | MET |
| SC-3 | `bybit_transfers_gate` stays `unmeasured` with the named cause `neither_older_365d`, which D-03 and SC-3 allow. Nothing was rebuilt (`rebuilds-enqueued: 0`). | MET |

**Founder decision.** The gate reads `unmeasured`, so the plan offered only `hold` and `as-recorded`. The founder answered on 2026-10-29: "Hold (Recommended)" (option text: "Keep a6's stored history as is; the TODOS entry holding the rebuild stays open until the gate can be measured."). Recorded as `rebuild-decision: Hold (Recommended)` and `rebuild-option: hold`; `173-BYBIT-HISTORY-REBUILD-HELD` stays open. Nothing was rebuilt over the shut gate.

The four human-verification items above are discharged by this reading: item 1 and item 2 by the SC-1 and SC-3 rows, item 4 by `state=read` with 0 sign mismatches and a completed a6 read, item 3 by the founder decision.

---

_Verified: 2026-10-29_
_Verifier: Claude (gsd-verifier)_
