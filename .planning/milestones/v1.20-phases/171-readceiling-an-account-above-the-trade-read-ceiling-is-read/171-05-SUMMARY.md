---
phase: 171-readceiling
plan: 05
status: complete
---

# 171-05 SUMMARY: the a6 re-probe (D-01, operator)

Run 2026-10-27 19:35Z-19:45Z on the backfill worker, deployed commit 04f5568a9 (v0.133.3.0, which carries none of Phase 171's read changes). Preconditions: plan 01's probe commit is 030742017; `deployed-names: 11 declared, 0 missing` against the deployed `equity_reconstruction.py`; clock outside 23:30-00:30. The phase branch's probe (sha256 prefix da26ab47, matched on the worker) rode a temporary service variable, and a temporary start command ran it from a copy of the app in the background while the worker started normally. Founder approval: AskUserQuestion 2026-10-27, "Yes, after funding probe (Recommended)".

Log-format note: Railway's log view rendered each JSON record as `key=value` attributes, so the lines below were rebuilt from them with every value copied exactly (strings, numbers, booleans).

## Probe (D-01)

{"account":"a1","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"none","first_page_rows":0,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"account_key_not_working","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","window_days":"field-absent","zero_contribution_members":0}
{"account":"a2","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"none","first_page_rows":0,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"account_key_not_working","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","window_days":"field-absent","zero_contribution_members":0}
{"account":"a3","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"none","first_page_rows":0,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"account_key_not_working","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","window_days":"field-absent","zero_contribution_members":0}
{"account":"a4","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"none","first_page_rows":100,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"anchor_skipped_implausible","members_failed":1,"members_read":0,"okx_members":1,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":17,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"ok","stored_days":0,"trade_calls":22,"trades_read":1282,"transfers_older_365d":0,"truncated_site":"none","window_days":90,"zero_contribution_members":0}
{"account":"a5","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"none","first_page_rows":0,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"account_key_not_working","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","window_days":"field-absent","zero_contribution_members":0}
{"account":"a6","bybit_members":1,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"truncated","first_page_rows":0,"last_window_age_bucket":"90-179","last_window_calls":100,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":1,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":2,"read_elapsed_s":504,"rebuilt_days":0,"record":"account","run_date":"2026-10-27","selection":"ok","stored_days":0,"trade_calls":1114,"trades_read":101557,"transfers_older_365d":0,"truncated_site":"bybit_window_ceiling","window_days":730,"zero_contribution_members":3}
{"accounts":6,"accounts_comparable":0,"accounts_differing":0,"accounts_read":0,"accounts_trades_beyond_first_page":2,"days_compared":0,"okx_order_violations":0,"okx_passes_ended_full":0,"record":"summary","run_date":"2026-10-27","trades_read":102839}
probe-exit: 1

## Worker restored

start-command: restored
service-variable: removed

## D-01 reading

d01-account: a6
d01-failure-class: truncated
d01-site: bybit_window_ceiling
d01-window-age: 90-179
d01-last-window-calls: 100
d01-trade-calls: 1114
d01-trades-read: 101557
d01-elapsed-s: 504
d01-layer1: covers
d01-budget-note: elapsed 504 s against the crawl bound 1500 s and the claim budget 900 s
d01-ship: go

The read stopped at the 100-page window ceiling in a window 90-179 days old, which plan 02 continues by time past the ceiling. Exactly one record matched a6's shape (bybit_members 1, other_members 2, window_days 730). a4 is unchanged (anchor_skipped_implausible on the deployed code; Phase 172's fix is not deployed). Restore: the start command was set back to `python -m main_worker`, the variable deleted (the list no longer names it) and the worker redeployed from source.
