---
phase: 173-rebuildgates
plan: 03
status: complete
---

# 173-03 SUMMARY: both rebuild gates read on the deployed worker, and the founder's rebuild decision (operator)

Run 2026-10-28, about 12:15Z to 13:38Z, on the backfill worker, by the orchestrator session under the founder's standing PROD authorization. Read-only: nothing was enqueued, no SQL was run, and nothing was written to any database.

## Preconditions

The phase merged as PR #1143 at 17bfd004c (v0.133.7.0). main's first CI run on that merge went red on `frontend-local-stack`: an edge-runtime 502 while the local stack booted, which is infrastructure and not this phase's code. Its re-run (attempt 2) was green. Railway deployed that head after the green. The UTC clock was outside 23:30 to 00:30, and the run ended well before 23:30.

deployed-commit: 17bfd004c6907cb2cbc8d7aa232314fdcca3541c

The deployed commit is the phase's own merge, so no deviation sentence is needed on this line.

## Delivery

A temporary start-command wrapper ran the import check, started `python -m scripts.allocator_history_probe` in the background with no payload (the FULL probe, D-03), printed `probe-exit:` and then exec'd `python -m main_worker`. It was applied with `railway redeploy --from-source`, so the wrapper actually ran. Founder approval for the run: "Yes, after deploy (Recommended)".

import-check: 0 16 True True True True

## Probe

Log-format note: Railway's log view prints each JSON record as `key=value` attributes (logfmt), not as the raw `{"` line. The lines below were rebuilt from those attributes into JSON objects, one per line, with every value copied exactly (strings quoted, numbers and booleans bare). Field order is alphabetical, as Railway printed it, not the probe's order. The 7 lines are 6 account records and 1 summary record; counts and tokens only, no identifier.

{"account":"a1","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"bybit_transfers_gate":"not-applicable","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_members_with_trades":0,"okx_order_failure_class":"none","okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"none","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":0}
{"account":"a2","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"bybit_transfers_gate":"not-applicable","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_members_with_trades":0,"okx_order_failure_class":"none","okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"none","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":0}
{"account":"a3","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"bybit_transfers_gate":"not-applicable","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_members_with_trades":0,"okx_order_failure_class":"none","okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"none","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":0}
{"account":"a4","advisory_arm":"implausible","anchor_diagnostic":"run","anchor_over_replay":11.9,"bal_over_cashbal":1,"bills_opening_over_anchor":"field-absent","bills_read":1489,"bills_transfer_net_over_anchor":0,"blank_inst_type_bills":0,"bot_equity_share":0,"breakdown_truncated":false,"bybit_members":0,"bybit_transfers_gate":"not-applicable","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":1,"failure_class":"none","first_page_rows":100,"flip_from_flat_closes":0,"flow_events_in_window":0,"hedge_mode_fills":0,"implied_opening_over_anchor":0.916,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"anchor_skipped_implausible","members_failed":1,"members_read":0,"negative_qty_assets":0,"negative_stable_cash":false,"non_stable_share":4.6e-9,"okx_members":1,"okx_members_with_trades":1,"okx_order_failure_class":"none","okx_order_readings":1,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"30-89","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"unavailable","opening_day_is_window_start":false,"opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"chain_break","other_members":0,"read_elapsed_s":34,"rebuilt_days":0,"record":"account","replay_final_sign":"positive","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":0,"stored_days":0,"trade_calls":22,"trades_read":1282,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":0.0243,"window_days":90,"withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":0}
{"account":"a5","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"bybit_transfers_gate":"not-applicable","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_members_with_trades":0,"okx_order_failure_class":"none","okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"none","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":0}
{"account":"a6","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":1,"bybit_transfers_gate":"unmeasured","comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"deposits_in_window":0,"deposits_older_365d":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":1,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_members_with_trades":0,"okx_order_failure_class":"none","okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"oldest_deposit_age_bucket":"none","oldest_fill_age_bucket":"180-364","oldest_fill_before_oldest_deposit":"field-absent","oldest_fill_before_oldest_withdrawal":"field-absent","oldest_withdrawal_age_bucket":"none","opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":2,"read_elapsed_s":1050,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":2160,"trades_read":203467,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":730,"withdrawals_in_window":0,"withdrawals_older_365d":0,"zero_contribution_members":3}
{"accounts":6,"accounts_comparable":0,"accounts_differing":0,"accounts_read":1,"accounts_trades_beyond_first_page":2,"bybit_accounts_applicable":1,"bybit_transfers_gate":"unmeasured","days_compared":0,"okx_members_with_trades":1,"okx_order_gate":"ok","okx_order_readings":1,"okx_order_violations":0,"okx_passes_ended_full":0,"record":"summary","run_date":"2026-10-28","trades_read":204749}

probe-exit: 1

Exit 1 is expected while a4 stays refused; nothing here depends on exit 0.

worker-restored: yes

The start command was set back to `python -m main_worker` and redeployed from source; that deployment reached SUCCESS before any line below was written.

## Labels (by shape)

a4-label: a4
a6-label: a6

a4 is the only record with `okx_members` 1 and `window_days` 90 (the OKX account). a6 is the only record with `bybit_members` 1 and `window_days` 730 (the Bybit account).

## OKX ordering gate (SC-1)

okx-order: ok
okx-order-reading: readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none

The code-derived token is stricter than the carried TRADEPAGES wording: it needs a reading from every OKX member that read trades, so `ok` here satisfies that wording. It is a tightening, not a new rule. The reading came from a4's refusal arm (D-01): a4 still refuses `anchor_skipped_implausible`, and its raw fills-history ordering read over 1282 trades found 0 violations with no failure class.

sc1-met: yes

## Bybit transfer-depth gate (SC-2)

bybit-transfers-kinds: a6 deposits=0 withdrawals=0 gate=unmeasured
bybit-transfers-evidence: a6 deposits_in_window=0 withdrawals_in_window=0 oldest_fill=180-364 oldest_deposit=none oldest_withdrawal=none fill_before_deposit=field-absent fill_before_withdrawal=field-absent
bybit-transfers: unmeasured (a6)
bybit-transfers-unread: a1, a2, a3, a5

A per-kind 0 is not a depth finding: the rebuild's Bybit transfer read is on-chain only, so an account funded off-chain shows 0 at every age; the evidence lines inform the decision and do not open the gate (D-02).

a6's read completed (203467 trades in 1050 s, `selection` ok, `failure_class` none, `member_refusal` none) and its transfer read returned no on-chain deposit and no on-chain withdrawal at any age, inside the window or older than 365 days, while its oldest fill is 180 to 364 days old. The account trades, so it was funded somehow; the funding is not visible to an on-chain-only read. The four accounts refused at selection (`account_key_not_working`) are not applicable and are named on the unread line (D-05).

sc2-met: no
sc2-founder-decision: Record, book follow-up (Recommended)

The option the founder chose read: "Record SC-2 as unmeasured with this evidence and book a follow-up: read Bybit internal and sub-account transfers to explain a6's funding. The gate stays shut and the TODOS entry stays open." The follow-up is booked as Phase 180 BYBITFUNDING.

Deviation on `sc2-met:`: step 8's mechanical rule reads `yes` on a6's record, because the read reached the transfer fetch (`selection` ok, `bybit_members` 1, `failure_class` and `member_refusal` none). The orchestrator recorded `no` instead, because SC-2 asks for the depth to be measured and both kinds read 0 at every age, which D-02 says is not a depth finding. It took the step-8 STOP to the founder, and the founder's answer above rules. The stricter reading is kept; the fixed verify allows a `no` with a recorded founder answer and gates only a `yes`.

## a4 anchor (for Phase 179 OKXBILLSCHAIN)

a4-anchor: refusal=anchor_skipped_implausible opening_check=unavailable reason=chain_break

## Rebuild decision (SC-3, D-04)

rebuild-decision: None now (Recommended)

The option the founder chose read: "Rebuild nothing; stored histories stay as recorded. a4 waits on 179, a6 on the Bybit follow-up." No gate was lifted, so there is no override line.

rebuilds-enqueued: 0

No SQL, no enqueue and no Railway change were made for SC-3. TRADEPAGES D-05 ("Accept as recorded") carries. a4's OKX rebuild waits on Phase 179 OKXBILLSCHAIN and then Phase 178 OKXREWRITE; a6's Bybit rebuild waits on Phase 180 BYBITFUNDING.

## Verify

The orchestrator applied the minimal fixes for the four surviving review findings (R4-SFH-1, R4-SFH-2, R4 WR-01, R4 WR-02) to this plan's Task 1 `<automated>` verify and `<fails_when>` before this SUMMARY was written. The chain now also checks that:
- the pasted account-record count equals the summary's `accounts`, with no repeated record label;
- the `bybit-transfers-unread:` labels are unique and equal the set of account records whose `selection` is not `ok`;
- `a4-label:` and `a6-label:` are each the one record of their shape;
- every `okx-order-reading:` field equals the summary record (and `failure_class=` the a4 record's `okx_order_failure_class`);
- `sc2-met: yes` requires a6's record to have `selection` ok, `failure_class` none, `member_refusal` none and `bybit_members` above 0;
- the `bybit-transfers-evidence:` labels equal the applicable (`bybit-transfers-kinds:`) labels.

The seven evidence values themselves are still operator-copied and shape-checked only; they were copied from a6's record above.

Task 1's verify was run after the scratch directory was deleted and printed `GATES_OK`. Task 3's verify was run in the records worktree after the TODOS edits and printed `DECISION_OK`.
