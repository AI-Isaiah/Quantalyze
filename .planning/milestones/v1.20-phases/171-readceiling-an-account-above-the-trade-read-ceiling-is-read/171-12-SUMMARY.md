---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 12
status: complete
---

# Plan 12 SUMMARY: SC-3 on PROD

## Ship gate

Plan 05's SUMMARY carries exactly one `d01-ship:` line and it reads `d01-ship: go` (checked 2026-10-27, before the phase PR opened).

ship-gate: d01-ship go

## Preconditions

Measured by the orchestrator session on 2026-10-28 under the founder's standing PROD authorization. The phase merged as PR #1138.

merge-sha: dae62ece3
ci: 6 runs green at dae62ece3
migrate: apply-test success, apply success (run 40648704098)
deploy: analytics worker c9458d7b4, backfill worker c9458d7b4
deploy-order: worker-first
store-fault-window: 0 min (plan 07 layer-1 fallback, not a STOP)
prod-marker: names PRODUCTION
prod-catalogue: tables 2, rls forced 2, policies 0, anon/authenticated privileges 0

The six runs on dae62ece3 are CI, Contracts, SQL Function Snapshot, Supabase Migrate and two Main CI cancelled watcher runs, all `success`. The deploy ran at c9458d7b4 (v0.133.5.1, the baseline re-dump after this merge, PR #1140), which contains dae62ece3. main's CI on c9458d7b4 is green too: CI, Contracts and SQL Function Snapshot all `success`.

Deploy order: the PROD apply ran 07:14:14Z to 07:14:32Z. The backfill worker started dae62ece3 at 07:14:23Z, 9 s before the apply finished, because the backfill service deploys without waiting for checks. The window rounds to 0 min. Plan 07's store-fault fallback reads layer 1 until the tables exist, so this is recorded, not a STOP.

SQL deviation: the plan says every SQL file starts with the marker query. The orchestrator ran the marker as its own file, before `catalogue.sql` and `jobs.sql`, and its answer named PRODUCTION. Neither of those two files repeated it. All three files held SELECT statements only, with no INSERT, UPDATE, DELETE, RPC or enqueue.

## Probe (SC-3)

One deployed-probe run served both Phase 171 (this plan) and Phase 172 (plan 05), with founder approval ("One run after #1138 deploys (Recommended)"). It ran 2026-10-28 08:39Z to 08:58Z on the backfill worker at main c9458d7b4. A temporary start-command wrapper printed both import checks, started `python -m scripts.allocator_history_probe` in the background, then exec'd `python -m main_worker`. It was applied with `railway redeploy --from-source`.

Deviation: a first attempt at 07:46Z used a redeploy that reused the old service config, so the wrapper never ran and no probe line was printed. The 08:39Z run is the only probe run.

import-check: force_rebuild 0 16 730 True 1

Log-format note: Railway's log view prints each JSON record as `key=value` attributes (logfmt), not as the raw `{"` line. The lines below were rebuilt from those attributes into JSON objects, with every value copied exactly (strings, numbers, booleans). Field order is alphabetical, as Railway printed it, not the probe's order.

{"account":"a1","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a2","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a3","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a4","advisory_arm":"implausible","anchor_diagnostic":"run","anchor_over_replay":14.1,"bal_over_cashbal":1,"bills_opening_over_anchor":"field-absent","bills_read":1489,"bills_transfer_net_over_anchor":0,"blank_inst_type_bills":0,"bot_equity_share":0,"breakdown_truncated":false,"bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":1,"failure_class":"none","first_page_rows":100,"flip_from_flat_closes":0,"flow_events_in_window":0,"hedge_mode_fills":0,"implied_opening_over_anchor":0.929,"last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"anchor_skipped_implausible","members_failed":1,"members_read":0,"negative_qty_assets":0,"negative_stable_cash":false,"non_stable_share":4.72e-9,"okx_members":1,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"unavailable","opening_day_is_window_start":false,"opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"chain_break","other_members":0,"read_elapsed_s":32,"rebuilt_days":0,"record":"account","replay_final_sign":"positive","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":0,"stored_days":0,"trade_calls":22,"trades_read":1282,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":0.0107,"window_days":90,"zero_contribution_members":0}
{"account":"a5","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":0,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":0,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"account_key_not_working","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":0,"trades_read":0,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":"field-absent","zero_contribution_members":0}
{"account":"a6","advisory_arm":"not-run","anchor_diagnostic":"not-run","anchor_over_replay":"field-absent","bal_over_cashbal":"field-absent","bills_opening_over_anchor":"field-absent","bills_read":"field-absent","bills_transfer_net_over_anchor":"field-absent","blank_inst_type_bills":"field-absent","bot_equity_share":"field-absent","breakdown_truncated":"field-absent","bybit_members":1,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"diagnostic_failure_class":"none","diagnostic_members":0,"failure_class":"none","first_page_rows":0,"flip_from_flat_closes":"field-absent","flow_events_in_window":"field-absent","hedge_mode_fills":"field-absent","implied_opening_over_anchor":"field-absent","last_window_age_bucket":"none","last_window_calls":0,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":0,"members_read":1,"negative_qty_assets":"field-absent","negative_stable_cash":"field-absent","non_stable_share":"field-absent","okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"opening_check":"not-run","opening_day_is_window_start":"field-absent","opening_residual_over_anchor":"field-absent","opening_unavailable_reason":"none","other_members":2,"read_elapsed_s":1048,"rebuilt_days":0,"record":"account","replay_final_sign":"absent","run_date":"2026-10-28","selection":"ok","skipped_symbols_count":"field-absent","stored_days":0,"trade_calls":2158,"trades_read":203279,"transfers_older_365d":0,"truncated_site":"none","upl_over_anchor":"field-absent","window_days":730,"zero_contribution_members":3}
{"accounts":6,"accounts_comparable":0,"accounts_differing":0,"accounts_read":1,"accounts_trades_beyond_first_page":2,"days_compared":0,"okx_order_violations":0,"okx_passes_ended_full":0,"record":"summary","run_date":"2026-10-28","trades_read":204561}
probe-exit: 1

No stderr line was captured. Exit 1 is the probe's `EXIT_FAILED`: some record has `members_failed` above 0. Here that is a4, refused `anchor_skipped_implausible` (Phase 172's subject). It is not the STOP code 2 (`EXIT_REFUSED`). a1, a2, a3 and a5 have `selection: account_key_not_working` and read nothing. The run printed no uuid and no run of ten or more digits.

## Worker restored

The start command was set back to `python -m main_worker` and redeployed from source. That deploy was then superseded by the #1141 merge deploy, and the worker started normally.

start-command: restored

## SC-3: a6

a6 is the only record with `bybit_members` 1, `other_members` 2 and `window_days` 730.

sc3-account: a6
sc3-failure-class: none
sc3-site: none
sc3-trade-calls: 2158
sc3-trades-read: 203279
sc3-last-window-calls: 0
sc3-elapsed-s: 1048
sc3-vs-d01: trades 101557 -> 203279, calls 1114 -> 2158, class truncated -> none, site bybit_window_ceiling -> none
sc3-a6: read-in-full

The deployed code read a6 whole in one bounded claim: about twice the trades and calls of the D-01 reading, with no named stop. The verdict is `read-in-full`, so no founder STOP was raised.

sc3-layer2-proof: synthetic books and the live lane (plans 07 to 11); the probe reads without a store scope
sc3-layer2-needed: yes (elapsed 1048 s at or over the 900 s claim budget)

This reading exercised layer 1 only (the probe has no store scope). It took 1048 s, inside the probe's 1500 s crawl bound but over the 900 s claim budget, so a real reconstruct job for a6 would defer across claims and use layer 2. Layer 2 is proven by plans 07 to 11, not by this reading. The budget is env-overridable (`TRADE_READ_CLAIM_BUDGET_S`); a reading this far over 900 s is a tuning note for the orchestrator, not a code change here.

todos-line: 2026-10-28 Phase 171 SC-3 (post-deploy probe, counts only): a6 read-in-full, 203279 trades over 2158 calls in 1048 s, site none.
todos-close: no (the OKX per-type ceiling and the one-millisecond group named in the entry are not changed by this phase)

## a6 reconstruct job (Task 3)

The orchestrator resolved a6 in the scratch on PROD, read-only, by the probe's listing (active OKX and Bybit keys in `created_at` order, grouped by user in first-seen order). That resolution gives a6 one active Bybit key and five other active keys that are neither OKX nor Bybit. The probe's record says `other_members=2`. The two counts measure different things: the SQL listing counts every active non-OKX/Bybit key of the user, while the probe's `other_members` counts the members it groups into the account. Both readings are recorded as measured. The shape the plan checks (one Bybit key) agrees, so this was not raised as a STOP.

a6-jobs-since-deploy: 0
a6-store-rows: state 0, windows 0
a6-job: none enqueued

No reconstruct job for a6 ran after the deploy. This plan enqueued none: the founder's TRADEPAGES decision "Rebuild none, book follow-ups" stands, and Phase 173 decides with the founder which Bybit histories are rebuilt. Every SQL file run for this plan held the marker query or SELECTs only. The scratch directory was deleted after the run.
