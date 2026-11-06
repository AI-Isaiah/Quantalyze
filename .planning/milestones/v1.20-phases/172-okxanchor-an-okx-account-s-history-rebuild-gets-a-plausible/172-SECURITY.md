---
phase: 172
slug: okxanchor
status: secured
asvs_level: 1
block_on: high
audited_head: 7cf901b87fb7f7aa963f5415cc3c4551882eb8c1
audited_scope: "git diff 53f25ac3ef26d7d5ce685b58e389200f47bb1e1a..HEAD -- . ':!.planning' (10 files, all under analytics-service/)"
threats_total: 29
threats_closed: 29
threats_open: 0
verdict: SECURED
---

# Phase 172 (OKXANCHOR) - Security Verification

Method: each threat in the `<threat_model>` of plans 01-05 was checked against the code at the audited head, not against a plan or a SUMMARY. Line numbers below are for the audited head (`analytics-service/services/okx_opening_balance.py` = OBAL, `analytics-service/services/equity_reconstruction.py` = ER, `analytics-service/scripts/allocator_history_probe.py` = PROBE, `analytics-service/services/exchange.py` = EXCH). The code changed after plan 04 through three review fix rounds; this audit reads the final state, including the round-1 walk rewrite, the round-2 outcome and ratio fields, and the round-3 sign and field-absent fixes.

Checks run: the six phase test files (272 passed); CI `mypy --strict --follow-imports=silent` over `services/ routers/ models/ main*.py sentry_init.py` (`Success: no issues found in 124 source files`); plan 05's import check run locally prints `0 15 True 0.05 True`; an AST comparison of the six probe functions Phase 173 reads against the phase base.

## Plan 01 - OKX opening-balance oracle (code)

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-172-01 | Tampering | medium | mitigate | `_decimal` (OBAL:154-168) rejects bool, non str/int/float, non-numeric text, NaN and inf; `_digits` (OBAL:171-175) accepts only ASCII digit ids; `_parse_bill` (OBAL:221-240) and `cash_balances` (OBAL:195-208) route every venue number through them and raise `malformed_balance` / `malformed_bills`. A broken `bal` chain, or a newest `bal` that is not today's `cashBal`, is `chain_break` (OBAL:308-312). No path substitutes a guessed 0: a currency with no bill keeps its `cashBal` only after the walk proved it reached a pre-opening bill. Pinned by `test_each_structural_gap_is_unavailable_by_name`, `test_bills_whose_newest_balance_is_not_todays_cash_are_not_a_measurement`, `test_every_unavailable_token_has_a_gap_case`. | CLOSED |
| T-172-02 | Denial of service | medium | mitigate | `BILLS_ARCHIVE_PAGE_CEILING = 500` (OBAL:107); the walk loop is bounded by it and ends `page_ceiling` (OBAL:259, 282); a cursor that does not strictly decrease is `malformed_bills` (OBAL:270-272); an empty page before a pre-opening bill is `reach_unproven`, never an end (OBAL:267-268); every page goes through `_okx_bills_fetch_with_backoff` (OBAL:263; EXCH:1378-1418, retries only rate-limit/DDoS, re-raises the rest). | CLOSED |
| T-172-03 | Denial of service | medium | mitigate | `read_okx_opening` catches only `OpeningUnavailable` (OBAL:455); `read_okx_balance_row` has no try (OBAL:178-192); price faults also propagate: `_cached_close_on` has no catch (OBAL:322-342) and `_coingecko_close_on` treats only 404 as "no price" and calls `raise_for_status()` otherwise (OBAL:358-360). Above the oracle, `_crawl_whole_account` sends a non-permanent class to `_AccountCrawlRetryableError` and logs the exception class only (ER:5546-5560). Pinned by `test_a_venue_error_propagates_and_is_never_unavailable`, `test_a_price_cache_read_failure_propagates_and_is_never_unpriced`, `test_a_coingecko_error_status_propagates_and_is_never_unpriced`, `test_a_rate_limit_inside_the_check_propagates_instead_of_refusing`. | CLOSED |
| T-172-04 | Tampering | medium | mitigate | Oracle is GET-only: `private_get_account_balance` (OBAL:185), `private_get_account_bills_archive` (OBAL:129); the only database access is `.select(...)` (OBAL:331-335); no `_cache_coingecko_prices`, `_stamp_429` or write verb in the module (grepped). Static pin `test_the_oracle_module_is_get_only_and_writes_nothing` (tests/test_okx_opening_balance.py:576-592) forbids `.insert/.update/.upsert/.delete/.rpc`, `private_(post|put|delete)_`, order/withdraw/transfer calls and the two writer names, via source scan and AST names. | CLOSED |
| T-172-05 | Repudiation | low | mitigate | `test_c01_03_implausible_offset_skips_anchor` (tests/test_ana_recon_audit.py:65) now calls the real `er._fetch_and_price_window` on an OKX-shaped exchange and asserts the replay's own end value, `anchor_offset_implausible is True`, and that the unforced path reads no bills. It no longer replaces the function under test. | CLOSED |
| T-172-SC | Tampering | low | accept | No dependency file changed in the scoped diff (10 files, all `analytics-service/{services,scripts,tests}`); imports are `ccxt`, `httpx`, standard library, already present. Accepted risk recorded here. | CLOSED |

## Plan 02 - Allocator history probe (code)

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-172-06 | Information disclosure | high | mitigate | Closed key whitelist and per-key validators: `ACCOUNT_RECORD_KEYS` / `_ACCOUNT_VALIDATORS` (PROBE, new keys), enforced by `validate_record` (PROBE:346-364: exact key set, every validator, then `assert_sanitized`) and the only stdout path `emit_record` (PROBE:367). Ratios only: `ratio_or_absent` (PROBE:625) returns 3 significant figures or `field-absent` for None, zero denominator, inf, NaN; `_is_ratio` accepts only `field-absent` or a finite 3-sig float. Counts default `field-absent` (`_account_record`, PROBE:1046+). Anchor, equity and bill amounts stay in memory: `_measure_anchor` (PROBE:857) prints only ratios against the anchor. Walk counters stay `field-absent` when the walk never completed (`_WALK_NOT_COMPLETED_REASONS`, round 3). Failure text is never read: classes only (`classify_failure`, PROBE:932+). Logging is disabled for the run (PROBE:1265). Pinned by `test_the_diagnostic_keys_refuse_values_outside_their_vocabulary` (tests/test_allocator_history_probe.py:1972) and the agreed-path leak test (output checked for total equity, opening balance, key id, trade-id prefix). | CLOSED |
| T-172-07 | Tampering | low | mitigate | Recorder lists are copied before the second pass in both arms (PROBE:978-981 for the agreed arm, PROBE:990-993 for the refusal arm); the diagnostic runs on its own `_TradeRecorder` (`fresh`, in `_measure_anchor`). Test pins `trade_calls == 2`, `trades_read == 5`, `read_args == [True, None]`. | CLOSED |
| T-172-08 | Elevation of privilege | medium | mitigate | `ReadOnlySupabase` (PROBE:391) exposes `select` only; `_ReadOnlyTable` (PROBE:380-388) raises on every other attribute. New functions type their handle `ReadOnlySupabase` (AST pin, tests/test_allocator_history_probe.py:812-826 and :2034-2040 extend to `_anchor_diagnostic` / `_measure_anchor`); `test_the_probe_source_calls_no_writer` (:786) passes; `supabase.writes == []` asserted. Venue calls in the diagnostic go through the GET-only oracle. | CLOSED |
| T-172-09 | Denial of service | low | mitigate | `_anchor_diagnostic` wraps `_measure_anchor` in `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)` (PROBE:939-942); any exception is recorded by class only, never raised, so the member's refusal stands (PROBE:932-948). The oracle-only exception is caught inside `_measure_anchor` so ratios already measured survive. | CLOSED |
| T-172-10 | Repudiation | low | mitigate | AST comparison against the phase base: `_busiest_inst_type`, `okx_newest_first`, `okx_passes_ended_full`, `first_page_rows` and `_passes` are AST-identical. `_read_member` differs on purpose (round-3 WR-02): its return grew a third value (`telemetry.get("anchor_opening_agreed") is True`) and its unused `_telemetry` was renamed; the OKX ordering-read statements inside it are unchanged in the diff. The plan's "all six identical" wording no longer holds literally for that one function; the intent (Phase 173's ordering read untouched) does, and no other consumer of the pair return exists in the diff. Low severity, non-blocking either way. | CLOSED (see note 2) |
| T-172-SC | Tampering | low | accept | No dependency change (see T-172-SC above). | CLOSED |

## Plan 03 - SC-1 probe run on the worker (operator step already executed)

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-172-11 | Denial of service | high | mitigate | 172-03-SUMMARY records `worker-restored: yes`, the payload variable deleted and the start command set back; the wrapper started the probe in the background and exec'd the normal start (SUMMARY line 9). Probe code cannot fail the worker's start: it exits 0/1/2 and the usage text in PROBE says nothing may depend on exit 0. | CLOSED |
| T-172-12 | Tampering | medium | mitigate | SUMMARY line 12 `payload-binding: match` and line 16 record sha256 prefixes of the probe, oracle, `equity_reconstruction.py` and `exchange.py` printed on the worker and equal to the local values at the probe commit. | CLOSED |
| T-172-13 | Information disclosure | medium | mitigate | SUMMARY pastes only `{"` lines (whitelisted emitter, 3-figure ratios, counts, tokens). Scan of the 172 phase directory and the scoped code diff for home paths, temp paths, uuids, ten-plus digit runs, IPv4 addresses, key/secret/bearer patterns, connection strings and hosted-service hostnames found none. | CLOSED |
| T-172-14 | Tampering | low | mitigate | Probe handles are `ReadOnlySupabase` (PROBE:391); no SQL file run (SUMMARY: "nothing written to any database"). | CLOSED |
| T-172-15 | Repudiation | low | mitigate | SUMMARY lines 33-45: fixed-table cause `sc1-cause: money_before_window`, founder answer recorded verbatim (`founder-decision: Anchor, 5% tolerance (Recommended)`), `sc1-branch: rule-anchors`. | CLOSED |
| T-172-SC | Tampering | low | accept | No package installed. | CLOSED |

## Plan 04 - Forced OKX anchor rule (code)

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-172-16 | Tampering | high | mitigate | The anchor is applied past the 5x bound only when `_okx_forced_opening_check` returns exactly `"agreed"` (ER:3783-3797). `"agreed"` requires `reading.opening_usd is not None` (ER:3514-3521), which `read_okx_opening` sets only after: balance row parsed, a pre-opening bill served (walk complete), at least one bill, every per-currency chain and head link holding (OBAL:285-313), and every non-stable currency priced (OBAL:437-446); then `opening_agrees` (OBAL:467-475) holds within `max(1.0, 0.05 * |anchor|)`, with `OPENING_TOLERANCE_REL = 0.05` at the founder's cap (OBAL:127). Every other outcome (a token, `disagreed`) sets `_anchor_skipped_implausible`, which raises `anchor_skipped_implausible` before any rows are returned (ER:3822-3840), so a refusal writes nothing. Ordered after the terminus, partial-ticker and unreliable-replay arms. Pinned by `test_a_disagreeing_opening_refuses_by_name_and_writes_nothing`, `test_each_unprovable_opening_refuses_by_name`, `test_an_opening_just_inside_the_tolerance_anchors_and_just_outside_refuses`. Residual (not a missing control): the 5% value rests on one account's partial-walk reading; see note 1. | CLOSED |
| T-172-17 | Denial of service | medium | mitigate | `_okx_forced_opening_check` has no `except`; the only catch in the chain is `OpeningUnavailable` in the oracle (OBAL:455). A rate limit raised inside the check reaches the crawl's `_stamp_429` / retry classification (ER:5433, 5546-5558). Pinned by `test_a_rate_limit_inside_the_check_propagates_instead_of_refusing`. | CLOSED |
| T-172-18 | Tampering | medium | mitigate | No new raise site or token: the only added `ForcedRebuildRefusedError` change passes the existing `_refusal` plus two audit-only side fields (ER:3828-3839). `FORCED_REBUILD_REFUSAL_REASONS` = 6 anchor + 9 account tokens = 15 (ER:2192-2214), measured 15 at head. `opening_check` values (oracle tokens, `disagreed`, `malformed_balance`) are audit fields, not refusal tokens. `test_forced_rebuild_refusal_reasons_are_a_closed_set` passes. | CLOSED |
| T-172-19 | Tampering | medium | mitigate | First statement of `_okx_forced_opening_check` returns `("not-run", None, None)` unless `require_anchor` and venue is okx (ER:3503-3504); it is evaluated only inside the `_implausible_anchor` arm (ER:3783-3788). Pinned: `test_the_unforced_okx_path_skips_the_check_even_when_the_bills_would_agree`, `test_a_non_positive_replay_anchors_without_the_bills_check`, `test_the_bybit_implausible_arm_reads_no_bills_and_still_refuses`, `test_an_ordinary_forced_rebuild_reports_no_opening_check`. | CLOSED |
| T-172-20 | Repudiation | low | mitigate | `anchor_opening_agreed` (bool) and `anchor_opening_check` plus two 3-sig-figure ratios ride telemetry (ER:3887+), the account merge (ER:2521-2550), the completion audit (ER:6086-6091) and, via `ForcedRebuildRefusedError`, the refusal audit (ER:5311-5324). One token-and-ratio log line per decision (info on agree, warning otherwise; ER:3522-3533). The audit residual uses the probe's sign (round 3). Pinned by `test_an_agreed_check_reports_how_close_the_bills_came`, `test_the_completion_audit_carries_the_agreed_ratios`, `test_a_refusal_audit_names_a_genuine_disagreement`. | CLOSED |
| T-172-SC | Tampering | low | accept | No package installed. | CLOSED |

## Plan 05 - Post-ship operator step (not executed; operator-step controls verified in 172-05-PLAN.md)

| Threat | Category | Sev | Disposition | Evidence | Status |
|---|---|---|---|---|---|
| T-172-21 | Denial of service | high | mitigate | Plan 05 Task 1 steps 3-4 (lines 89-90): probe started in the background and the normal start exec'd, restore (start command, variable, redeploy) before any analysis, `worker-restored: yes` recorded; "a worker that does not return is a STOP outranking everything else". The SC3_OK automated gate (line 102) fails without `^worker-restored: yes$`. | CLOSED (control present, step pending) |
| T-172-22 | Tampering | medium | mitigate | Step 10 (line 97) writes `rebuilds-enqueued: 0`; the gate requires `^rebuilds-enqueued: 0$`; the plan runs no enqueue and no SQL. | CLOSED (control present, step pending) |
| T-172-23 | Tampering | medium | mitigate | Step 2 (line 88): import check prints `EXIT_OK`, the refusal-token count, key presence, `OPENING_TOLERANCE_REL` and the rule helper's presence, expected `0 15 True <tolerance-rel> True`; the helper name in the plan is the current `_okx_forced_opening_check` (round-3 WR-03 fix). Run locally at head: `0 15 True 0.05 True`. Anything else is a STOP; the gate requires `^import-check: 0 15 True `. | CLOSED (control present, step pending) |
| T-172-24 | Information disclosure | medium | mitigate | Gate (line 102): no `[0-9a-f]{8}-[0-9a-f]{4}-` match in the SUMMARY, no ten-plus digit run outside the commit line, scratch directory removed; TODOS gate (line 124): no uuid in added `TODOS.md` lines; only `{"` lines pasted; counts and tokens only. | CLOSED (control present, step pending) |
| T-172-SC | Tampering | low | accept | No package installed. | CLOSED |

## Key properties asked for

- Probe read-only: confirmed (T-172-04, 08, 14). Leaks no ids, uuids, amounts or secrets: confirmed (T-172-06, 13).
- Audits and logs carry only tokens, counts and ratios: confirmed for every line this phase added (ER:3522-3533, 5311-5324, 6086-6091; OBAL:456 logs the reason token only). Note 3 records one older line the phase did not touch.
- Venue and database faults propagate (no transient fault becomes a permanent refusal): confirmed (T-172-03, 17), including the price-cache read and CoinGecko non-404 statuses.
- An unproven opening never anchors: the only route to `agreed` runs through a non-None `opening_usd` plus `opening_agrees`; every structural gap, malformed reply, unpriced currency and walk shortfall returns a token that refuses (T-172-16).
- The 15-token refusal vocabulary is closed (T-172-18).
- No secrets or PROD identifiers in tracked text: scans of the scoped diff and the 172 phase directory found no home path, temp path, uuid, long digit run, IP, credential pattern or hosted-service hostname.

## Unregistered flags

None. The `## Threat Flags` sections of the 01, 02 and 04 SUMMARYs all read "None"; plan 03's SUMMARY carries none; the new code adds no endpoint, write path or trust boundary beyond the two GETs the register covers.

## Notes (non-blocking; none counts toward `threats_open`)

1. Tolerance basis (T-172-16 residual). `OPENING_TOLERANCE_REL = 0.05` was chosen on the one OKX account the 5x gate refused, from a bills reading the round-1 oracle now refuses as partial (OBAL:109-125 says so). The control is present and capped at the founder's 5%; the basis is a decision-quality gap, not a missing mitigation. Plan 05 step 9b is where the founder re-decides it from a complete-walk reading; the plan's gate (line 102) now requires `tolerance-basis:` and `tolerance-founder-decision:`. Booked as `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` by plan 05 Task 2.
2. T-172-10 wording: `_read_member` is the one of the six functions that is no longer AST-identical (see its row). Phase 173 should read its three-value return.
3. An older warning line in `_fetch_and_price_window` (the "offset exceeds 5x last_value" message) logs two USD figures to the worker log. It predates this phase; the diff only appends a token to it. Worker logs are not tracked text, so no public-repo exposure, but it is the one log line in the path that carries amounts.
4. Replay at or below zero is not gated by the 5x arm (`last_value > 0` is part of the trigger), so it anchors at `totalEq` with no bills check. Unchanged by this phase, pinned by `test_a_non_positive_replay_anchors_without_the_bills_check`, booked by plan 05 as `172-OKX-NONPOSITIVE-REPLAY-UNGATED`.
5. The walk's stop rule assumes `billId` order equals `ts` order; no test can show it is sound if the venue breaks that. Review round 3 recorded the same limit.
6. A bill posted between the balance read and the walk makes the head link fail closed (`chain_break`, a refusal, never `agreed`). Probability per attempt is low and it cannot produce a wrong anchor.
7. `172-RESEARCH.md` quotes two balance figures taken from a prior phase's tracked verification (Phase 167.1.2.2.2.1), not from this phase's probe. They are pre-existing tracked text and outside this phase's diff; no new amount was introduced by phase 172.
8. Plan 05 is a pending operator step. Its controls are present in the plan text and gates; their execution is not evidence and is not claimed.

## Accepted risks log

| ID | Risk | Accepted by |
|---|---|---|
| T-172-SC (plans 01-05) | No package installs in this phase; supply-chain risk is nil for it | plan declaration, verified against the diff |

## Verdict

**SECURED.** 29 of 29 register entries closed (24 mitigate, 5 accept-class `T-172-SC` entries, one per plan), 0 open, `threats_open: 0` at `block_on: high`. Plan 05's four threats are closed as operator-step controls present in `172-05-PLAN.md`; the post-ship step itself has not run.
