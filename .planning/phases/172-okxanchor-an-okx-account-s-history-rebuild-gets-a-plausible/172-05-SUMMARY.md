---
phase: 172-okxanchor
plan: 05
status: complete
---

# 172-05 SUMMARY: SC-3, a4 re-read by the deployed probe (operator)

Run 2026-10-28 08:39Z to 08:58Z on the backfill worker, by the orchestrator session under the founder's standing PROD authorization. Read-only: nothing was enqueued and nothing was written to any database.

## Preconditions

The phase merged as PR #1136 at b3225373a. main's CI on that merge is green: 4 workflow runs, all `success`. The probe ran on the deploy of main c9458d7b4 (v0.133.5.1), which contains this phase's merge (b3225373a) and Phase 171's merge (dae62ece3, PR #1138). The UTC clock was outside 23:30 to 00:30.

deployed-commit: c9458d7b4f58ce21ccb67b18e86137aa51d7637f

Deviation on `deployed-commit:`: the plan asks for the merge sha. The worker ran a later main head that contains it, so the line records the commit that actually ran. The phase's own merge is b3225373a.

## Delivery

A temporary start-command wrapper ran the two import checks (this phase's and Phase 171's), started `python -m scripts.allocator_history_probe` in the background with no payload, printed `probe-exit:` and then exec'd `python -m main_worker`. It was applied with `railway redeploy --from-source`. One probe run served both phases, with founder approval ("One run after #1138 deploys (Recommended)").

Deviation: a first attempt at 07:46Z used a redeploy that reused the old service config, so the wrapper never ran and no probe line was printed. The 08:39Z run is the only probe run.

import-check: 0 16 True 0.05 True

Deviation on `import-check:`: the plan expects `0 15 True 0.05 True` on a rule branch, and its automated verify matches `^import-check: 0 15 True `. The deployed code reports 16 refusal tokens, because Phase 171 (merged and deployed before this run) added `account_key_read_stalled` to `FORCED_REBUILD_REFUSAL_REASONS`. The other four values match the rule branch: `EXIT_OK` 0, `opening_check` in the record keys, `OPENING_TOLERANCE_REL` 0.05, and the opening-check helper callable. So this is not a deploy mismatch. The line is recorded as printed, and the verify fails on it (see Verify below).

## Probe (SC-3)

Log-format note: Railway's log view prints each JSON record as `key=value` attributes (logfmt), not as the raw `{"` line. The lines below were rebuilt from those attributes into JSON objects, with every value copied exactly (strings, numbers, booleans). Field order is alphabetical, as Railway printed it, not the probe's order.

{"account":"a1","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a2","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a3","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a4","advisory_arm":"implausible","anchor_diagnostic":"run","anchor_over_replay":14.1,"bal_over_cashbal":1,"bills_opening_over_anchor":"field-absent","bills_read":1489,"bills_transfer_net_over_anchor":0,"blank_inst_type_bills":0,"bot_equity_share":0,"breakdown_truncated":false,"bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":1,"failure_class":"none","first_page_rows":100,"flip_from_flat_closes":0,"flow_events_in_window":0,"hedge_mode_fills":0,"implied_opening_over_anchor":0.929,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"anchor_skipped_implausible","members_failed":1,"members_read":0,"negative_qty_assets":0,"negative_stable_cash":false,"non_stable_share":4.72e-9,"okx_members":1,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"unavailable","opening_day_is_window_start":false,"opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"chain_break","other_members":0,"read_elapsed_s":32,"rebuilt_days":0,"record":"account","replay_final_sign":"positive","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":0,"stored_days":0,"trade_calls":22,"trades_read":1282,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":0.0107,"window_days":90,"zero_contribution_members":0}
{"account":"a5","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a6","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":1,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":1,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":2,"read_elapsed_s":1048,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":2158,"trades_read":203279,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":730,"zero_contribution_members":3}
{"accounts":6,"accounts_comparable":0,"accounts_differing":0,"accounts_read":1,"accounts_trades_beyond_first_page":2,"days_compared":0,"okx_order_violations":0,"okx_passes_ended_full":0,"record":"summary","run_date":"2026-10-28","trades_read":204561}
probe-exit: 1

Exit 1 is the probe's `EXIT_FAILED` (a record has `members_failed` above 0: a4), not the refusal code 2. The lines hold no uuid and no run of ten or more digits.

## Worker restored

The start command was set back to `python -m main_worker` and redeployed from source. That deploy was then superseded by the #1141 merge deploy, and the worker started normally.

worker-restored: yes

## SC-3 outcome

a4 still carries plan 03's label and is the only record with `okx_members` 1 and `window_days` 90.

a4-label: a4
sc3: a4 refused anchor_skipped_implausible (chain_break)

Cause: this run's diagnostic names a different cause from plan 03's, so this run's is written. Plan 03 recorded `money_before_window`, read from a partial bills walk (`bills_read=100`, one page) that the shipped oracle now refuses. This run walked the bills archive further (`bills_read=1489`, `bal_over_cashbal=1`), and the oracle returned `opening_check=unavailable` with `opening_unavailable_reason=chain_break`. In `services/okx_opening_balance.py` that token means a per-currency running balance does not close: some bill's `bal` is not the previous `bal` plus its `balChg`, or the newest `bal` is not today's cash balance. Since `bal_over_cashbal` reads 1, the second condition looks unlikely, but the token does not say which arm fired. The opening is therefore unproven and the forced path fails closed with the existing `anchor_skipped_implausible`, as the code intends. Why OKX's bills chain does not close for a4 is not known yet.

a4's other readings: `advisory_arm=implausible`, `anchor_diagnostic=run`, `anchor_over_replay=14.1`, `replay_final_sign=positive`, `implied_opening_over_anchor=0.929`, `upl_over_anchor=0.0107`, `non_stable_share=4.72e-9`, `bot_equity_share=0`, `flip_from_flat_closes=0`, `hedge_mode_fills=0`, `negative_qty_assets=0`, `negative_stable_cash=false`, `flow_events_in_window=0`, `skipped_symbols_count=0`, `trades_read=1282` over `trade_calls=22`, `read_elapsed_s=32`.

sc3-expected: anchored
sc3-matches-branch: no

`sc3-expected:` follows plan 03's `sc1-branch: rule-anchors`. The mismatch is a STOP. The founder was asked (AskUserQuestion, 2026-10-28), with this option text: "Record the mismatch and the chain_break reading in plan 05, keep the 0.05 tolerance code as shipped (it can't fire until the opening is measurable), and book a follow-up phase to find why OKX's bills chain doesn't close for a4 before any OKX rebuild. a4 stays refused (fails closed)."

sc3-founder-decision: Record, route a follow-up (Recommended)

The follow-up is booked as Phase 179 OKXBILLSCHAIN (records PR, 2026-10-28).

## For Phase 173 (not decided here)

okx-order-reading: readings=0 violations=0 passes_ended_full=0

a4 did not anchor, so its forced read did not complete and the probe's ordering read did not run. These zeros are "not run", not a clean ordering measurement. Phase 173 still owns the OKX ordering gate.

## Tolerance basis (step 9b)

tolerance-basis: opening_check=unavailable reason=chain_break residual=field-absent bills_read=1489 bal_over_cashbal=1

No residual was measured: the walk did not prove the opening, so `opening_residual_over_anchor` is absent. The plan's recommendation keeps 0.05 only with `opening_check=measured` and an absolute residual under 0.025, and neither holds. The founder was asked to keep or re-set `OPENING_TOLERANCE_REL` on this reading.

tolerance-founder-decision: Keep 0.05, re-decide later (Recommended)

The shipped 0.05 can only fire when the opening is measurable. It still rests on no complete walk. Phase 179 OKXBILLSCHAIN re-decides it once a4's bills chain closes or the break is named.

rebuilds-enqueued: 0

TRADEPAGES D-05 is carried: stored histories stay as recorded. Phase 173 owns any OKX rebuild.

## Ledger (Task 2)

Task 2's `TODOS.md` edits land in the orchestrator's records PR, not on this branch. Deviation from the plan's Task 2 text, per the founder's decision above: `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` is NOT closed. a4 stays refused, but the refusal is not yet shown to be correct: the follow-up phase has to find why the chain does not close. The entry gets the dated reading and a pointer to Phase 179 OKXBILLSCHAIN in place of the plan's "Closed: recorded as a correct refusal" sentence. `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` gets its dated reading and stays open. `172-OKX-NONPOSITIVE-REPLAY-UNGATED` and `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT` are booked (rule branch), the latter with the residual recorded as field-absent (unmeasured).

## Scratch

The scratch directory was deleted after the run.

## Verify

Task 1's `<automated>` verify was run on this file and FAILS on one check only: `grep -aqE '^import-check: 0 15 True '`. The recorded line is `import-check: 0 16 True 0.05 True`, for the reason given under Delivery. The line was not changed to pass the check. The same command with only `0 15` changed to `0 16` prints `SC3_OK`, so every other line, the uuid and digit-run gates and the deleted scratch pass. Task 2's `TODOS.md` verify runs in the records PR.
