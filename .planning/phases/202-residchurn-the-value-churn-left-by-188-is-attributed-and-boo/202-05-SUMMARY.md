---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 05
subsystem: testing
tags: [attribution, deploy-history, evidence-rule, mt5-server-clock, offset-oracle, scratch]

requires:
  - phase: 202-02
    provides: attribute.py (188's rule, offset oracle, D-08 buckets), the inputs files, the --strat-keys and --evidence seams
  - phase: 202-04
    provides: the worker and API deployment lists reaching back past 2026-11-02, deploy_proof.py's list parser, pre/strat_keys.json
  - phase: 202-06
    provides: c1 moved scopes (s2, s5, s8, s13 among them) used for the clock cross-check
provides:
  - the worker commit behind each side of s6, s9 and s10, with every straddled deployment named
  - the nine candidate commits between the two sides, each judged against the fixed evidence rule (none meets it)
  - an empty evidence.json, so s6, s9 and s10 stay (d); the b0 to b1 buckets re-run with the real strategy-to-key links (b 1142, d 72)
  - s1, s15 and s16 pass the offset test (they move from (d) to (b))
  - a recorded lead outside the rule: the worker's MT5 server-clock switch of 2026-11-03, with a cross-check over all 11 MT5 strategies
affects: [202-07, 202-08]

actuals:
  tokens: 16000
  tasks: 2
  commits: 2
plan_head_before: 9230007707aed706f1797fc41e80a2479a6c0d67
plan_head_after: 7af529f46a53a7a277310d279fe47b4da57ffe37

tech-stack:
  added: []
  patterns:
    - "an evidence rule fixed before the analysis, applied per commit, with the rule shown able to say yes in a self-test"
    - "a lead that does not meet the rule is reported beside it, never folded into the evidence file"

key-files:
  created:
    - ~/.cache/quantalyze/residchurn/bin/codepath.py
    - ~/.cache/quantalyze/residchurn/bin/codepath_sig.py
    - ~/.cache/quantalyze/residchurn/bin/codepath_xcheck.py
    - ~/.cache/quantalyze/residchurn/bin/codepath_judge.py
    - ~/.cache/quantalyze/residchurn/codepath/derive.out
    - ~/.cache/quantalyze/residchurn/codepath/evidence.json
    - ~/.cache/quantalyze/residchurn/codepath/clock-candidate.json
    - ~/.cache/quantalyze/residchurn/attr/b0-b1-evidence.out
  modified: []

key-decisions:
  - "straddle=yes only when the set of commits that may have served a job holds more than one distinct commit; a redeploy of the same commit is counted in window_deployments and is not a straddle"
  - "evidence.json is derived from the per-commit judgements, never typed beside them, and is empty: none of the judged commits between the worker commits was entered as meeting rule (2) and (3) for an MT5 strategy (the judge fails on a candidate commit with no TABLE judgement; review round 2 removed an `equal=` check that could never fail)"
  - "the MT5 server-clock switch is a worker variable change, not a commit, so it is reported as a lead outside the rule and s6, s9 and s10 stay (d) until a decision on the bucket wording"

requirements-completed: [RESID-01]

coverage:
  - id: D1
    description: "Each side of s6, s9 and s10 is tied to the worker commit that ran it, every straddled deployment is named, and the commits between are listed"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "Task 1 verify command (6 derive lines, 3 candidates lines, files non-empty); codepath.py --self-test (7 cases, RED when the 30 minute window is neutered)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The nine candidate commits are judged against rule (2) and (3); none meets it; evidence.json is empty and s6, s9 and s10 stay (d)"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "Task 2 verify command; codepath_judge.py --self-test (4 cases: the rule says yes for a matching commit, no for an unobserved kind, names two commits unseparated)"
        status: pass
    human_judgment: true
    rationale: "Each judgement is a reading of a diff and a CHANGELOG entry; a reviewer should confirm the nine readings and decide the bucket wording for the clock lead"
  - id: D3
    description: "The b0 to b1 buckets re-run with the strategy-to-key links: b 1142, d 72, sum 1214; s1, s15 and s16 pass the offset test"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "attribute.py --pair b01 ... --strat-keys pre/strat_keys.json --evidence codepath/evidence.json --neuter (exit 0, bucket-total sum=1214, neuter went_red=yes)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-07
status: complete
---

# Phase 202 Plan 05: Code path of s6, s9 and s10 Summary

**Each of the 9 commits between the two worker commits was read by hand against the four changed-day kinds of s6, s9 and s10 and none was entered as producing one (the judge's table has no such entry, so this is by construction of the table, and it weighs changed days only, not the vanished rows, where #1196 and #1205 were not weighed), so the 72 moved values stay unexplained under the evidence rule; the repo's own records name a better lead, the worker's MT5 server clock going from a fixed +2 h to the US rule on 2026-11-03, which every MT5 strategy that crossed it matches; s1, s15 and s16 pass the offset test and leave (d), so the b0 to b1 split is now b 1142 and d 72.**

## Performance

- **Duration:** about 25 min (03:01Z to 03:26Z, 2026-11-07)
- **Tasks:** 2
- **Files modified:** 1 tracked (this SUMMARY); scratch under `~/.cache/quantalyze/residchurn`

## Result lines (Task 1: which worker commit wrote each side)

Labels, commits (public) and ISO times only. `also=` names the other commit that may have served a job whose window overlaps a deployment; the earlier one is never assumed.

gc-c-codepath-venue: scope=s6 venue=mt5 key=k35
gc-c-codepath-derive: scope=s6 side=b0 job=2026-11-02T22:12:30Z..2026-11-02T22:13:01Z status=done worker_commit=099a9f166947 straddle=yes also=6f76ff29c35a window_deployments=3 subject_via=self api_commit=099a9f166947
gc-c-codepath-derive: scope=s6 side=b1 job=2026-11-06T00:25:00Z..2026-11-06T00:25:51Z status=done worker_commit=50594c75034a straddle=no also=none window_deployments=0 subject_via=self api_commit=50594c75034a
gc-c-codepath-candidates: scope=s6 range=6f76ff29c35a..50594c75034a commits=#1187,#1190,#1193,#1194,#1196,#1197,#1200,#1202,#1205 count=9 b0_uncertain=#1187 same_commit=no
gc-c-codepath-venue: scope=s9 venue=mt5 key=k3
gc-c-codepath-derive: scope=s9 side=b0 job=2026-11-02T21:15:53Z..2026-11-02T21:16:12Z status=done worker_commit=6f76ff29c35a straddle=yes also=ce9014d4e84e window_deployments=1 subject_via=self api_commit=6f76ff29c35a
gc-c-codepath-derive: scope=s9 side=b1 job=2026-11-06T00:25:00Z..2026-11-06T00:25:38Z status=done worker_commit=50594c75034a straddle=no also=none window_deployments=0 subject_via=self api_commit=50594c75034a
gc-c-codepath-candidates: scope=s9 range=ce9014d4e84e..50594c75034a commits=#1187,#1190,#1193,#1194,#1196,#1197,#1200,#1202,#1205 count=9 b0_uncertain=none same_commit=no
gc-c-codepath-venue: scope=s10 venue=mt5 key=k13
gc-c-codepath-derive: scope=s10 side=b0 job=2026-11-02T21:13:13Z..2026-11-02T21:13:50Z status=done worker_commit=6f76ff29c35a straddle=yes also=ce9014d4e84e window_deployments=1 subject_via=self api_commit=6f76ff29c35a
gc-c-codepath-derive: scope=s10 side=b1 job=2026-11-06T01:25:00Z..2026-11-06T01:37:27Z status=done worker_commit=50594c75034a straddle=no also=none window_deployments=0 subject_via=self api_commit=50594c75034a
gc-c-codepath-candidates: scope=s10 range=ce9014d4e84e..50594c75034a commits=#1187,#1190,#1193,#1194,#1196,#1197,#1200,#1202,#1205 count=9 b0_uncertain=none same_commit=no

The nine commits of the range, the same for the three scopes (`git log <b0 commit>..50594c75034a -- analytics-service`, every candidate of a straddled side included; #1187 is the only commit inside s6's own b0 uncertainty):

gc-c-codepath-commit: scope=s6,s9,s10 commit=#1187 sha=099a9f166947 subject='feat(185): DERIBITFLOWTIME — a Deribit allocator book values open options at market (v0.13'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1190 sha=eb4c86fd0a9e subject='fix(analytics): container app user gets a home directory so Railway SSH can open a session'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1193 sha=69141d785834 subject='feat(186): DERIVEGAPS tooling — a read-only probe that counts what each derive gap affects'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1194 sha=b588bbb14bf9 subject='feat(190): FACTSHEETQUEUED — finalize queues no redundant re-run, and a re-compute never h'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1196 sha=cdb9061435a7 subject='feat(188): TINYBASE — a day measured against a near-empty account is left out and named, n'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1197 sha=8f4523131d64 subject='feat(186): DERIVEGAPS — the per-key derive refuses a truncated or failed read, reads Bybit'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1200 sha=a363392ea668 subject='feat(191): REFUSALRACE PR 1 — single-statement metadata merge functions (v0.133.22.0)'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1202 sha=976f67ece637 subject='feat(191): REFUSALRACE PR 2 — the refusal marker and refresh-marker retractions merge inst'
gc-c-codepath-commit: scope=s6,s9,s10 commit=#1205 sha=50594c75034a subject='fix(188): TINYBASE gap closure — the derive deletes the stale rows on the days it leaves o'

## Result lines (Task 2: the signature, the nine judgements, the code path)

The signature of the changed days, and where they fall in the broker clock's year. `day_shift` is an exact move of a value to an adjacent day; `runs_compound_conserved` counts runs of consecutive changed days in which the compounded return is the same in both captures to 1e-9 (P&L moved between days inside the run and its end points did not move). The US-rule summer is the 2nd Sunday of March up to the 1st Sunday of November, at day granularity.

gc-c-codepath-signature: scope=s6 day_shift=0 sign_flip=4 zero_change=0 magnitude=27 changed=31 shift_receiver_earlier=0 shift_receiver_later=0
gc-c-codepath-pattern: scope=s6 changed_in_us_summer=31/31 changed_in_us_winter=0/31 active_days_summer=74 active_days_winter=0 runs=14 multi_day_runs=9 runs_compound_conserved=9
gc-c-codepath-removed: scope=s6 days_in_b0_absent_from_b1=0 of_which_us_summer=0
gc-c-codepath-signature: scope=s9 day_shift=2 sign_flip=3 zero_change=4 magnitude=15 changed=24 shift_receiver_earlier=1 shift_receiver_later=0
gc-c-codepath-pattern: scope=s9 changed_in_us_summer=24/24 changed_in_us_winter=0/24 active_days_summer=120 active_days_winter=36 runs=13 multi_day_runs=10 runs_compound_conserved=10
gc-c-codepath-removed: scope=s9 days_in_b0_absent_from_b1=29 of_which_us_summer=0
gc-c-codepath-signature: scope=s10 day_shift=0 sign_flip=3 zero_change=3 magnitude=11 changed=17 shift_receiver_earlier=0 shift_receiver_later=0
gc-c-codepath-pattern: scope=s10 changed_in_us_summer=17/17 changed_in_us_winter=0/17 active_days_summer=101 active_days_winter=0 runs=8 multi_day_runs=7 runs_compound_conserved=7
gc-c-codepath-removed: scope=s10 days_in_b0_absent_from_b1=0 of_which_us_summer=0

The judgements. A commit meets the rule only if it names a function on the strategy-mode MT5 derive path and its stated behaviour produces the kind of difference observed on the scope's changed days.

gc-c-codepath-judge: scope=s6 commit=#1187 path_touched=none behaviour=deribit_key_mode_options_basis matches=none meets_rule=no reason=other_venue_and_mode
gc-c-codepath-judge: scope=s6 commit=#1190 path_touched=none behaviour=container_home_directory matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s6 commit=#1193 path_touched=none behaviour=bybit_flow_retention_and_read_only_probe matches=none meets_rule=no reason=other_venue
gc-c-codepath-judge: scope=s6 commit=#1194 path_touched=job_worker.py:_last_success_snapshot behaviour=last_success_flags_snapshot_on_prestamp matches=none meets_rule=no reason=writes_flags_not_returns
gc-c-codepath-judge: scope=s6 commit=#1196 path_touched=broker_dailies.py:combine_mt5_deal_ledger+nav_twr.py:chain_linked_twr behaviour=tiny_base_day_left_out_no_row matches=none meets_rule=no reason=kind_mismatch
gc-c-codepath-judge: scope=s6 commit=#1197 path_touched=none behaviour=truncated_or_failed_read_refusal_and_bybit_transfers matches=none meets_rule=no reason=other_venue_or_refusal
gc-c-codepath-judge: scope=s6 commit=#1200 path_touched=none behaviour=metadata_merge_sql_functions_test_only matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s6 commit=#1202 path_touched=none behaviour=refusal_marker_merge_through_rpc matches=none meets_rule=no reason=writes_job_metadata_not_returns
gc-c-codepath-judge: scope=s6 commit=#1205 path_touched=job_worker.py:run_derive_broker_dailies+_reconcile_hull behaviour=stale_row_delete_on_left_out_days matches=none meets_rule=no reason=kind_mismatch
gc-c-codepath-judge: scope=s9 commit=#1187 path_touched=none behaviour=deribit_key_mode_options_basis matches=none meets_rule=no reason=other_venue_and_mode
gc-c-codepath-judge: scope=s9 commit=#1190 path_touched=none behaviour=container_home_directory matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s9 commit=#1193 path_touched=none behaviour=bybit_flow_retention_and_read_only_probe matches=none meets_rule=no reason=other_venue
gc-c-codepath-judge: scope=s9 commit=#1194 path_touched=job_worker.py:_last_success_snapshot behaviour=last_success_flags_snapshot_on_prestamp matches=none meets_rule=no reason=writes_flags_not_returns
gc-c-codepath-judge: scope=s9 commit=#1196 path_touched=broker_dailies.py:combine_mt5_deal_ledger+nav_twr.py:chain_linked_twr behaviour=tiny_base_day_left_out_no_row matches=none meets_rule=no reason=kind_mismatch
gc-c-codepath-judge: scope=s9 commit=#1197 path_touched=none behaviour=truncated_or_failed_read_refusal_and_bybit_transfers matches=none meets_rule=no reason=other_venue_or_refusal
gc-c-codepath-judge: scope=s9 commit=#1200 path_touched=none behaviour=metadata_merge_sql_functions_test_only matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s9 commit=#1202 path_touched=none behaviour=refusal_marker_merge_through_rpc matches=none meets_rule=no reason=writes_job_metadata_not_returns
gc-c-codepath-judge: scope=s9 commit=#1205 path_touched=job_worker.py:run_derive_broker_dailies+_reconcile_hull behaviour=stale_row_delete_on_left_out_days matches=none meets_rule=no reason=kind_mismatch
gc-c-codepath-judge: scope=s10 commit=#1187 path_touched=none behaviour=deribit_key_mode_options_basis matches=none meets_rule=no reason=other_venue_and_mode
gc-c-codepath-judge: scope=s10 commit=#1190 path_touched=none behaviour=container_home_directory matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s10 commit=#1193 path_touched=none behaviour=bybit_flow_retention_and_read_only_probe matches=none meets_rule=no reason=other_venue
gc-c-codepath-judge: scope=s10 commit=#1194 path_touched=job_worker.py:_last_success_snapshot behaviour=last_success_flags_snapshot_on_prestamp matches=none meets_rule=no reason=writes_flags_not_returns
gc-c-codepath-judge: scope=s10 commit=#1196 path_touched=broker_dailies.py:combine_mt5_deal_ledger+nav_twr.py:chain_linked_twr behaviour=tiny_base_day_left_out_no_row matches=none meets_rule=no reason=kind_mismatch
gc-c-codepath-judge: scope=s10 commit=#1197 path_touched=none behaviour=truncated_or_failed_read_refusal_and_bybit_transfers matches=none meets_rule=no reason=other_venue_or_refusal
gc-c-codepath-judge: scope=s10 commit=#1200 path_touched=none behaviour=metadata_merge_sql_functions_test_only matches=none meets_rule=no reason=no_derive_code
gc-c-codepath-judge: scope=s10 commit=#1202 path_touched=none behaviour=refusal_marker_merge_through_rpc matches=none meets_rule=no reason=writes_job_metadata_not_returns
gc-c-codepath-judge: scope=s10 commit=#1205 path_touched=job_worker.py:run_derive_broker_dailies+_reconcile_hull behaviour=stale_row_delete_on_left_out_days matches=none meets_rule=no reason=kind_mismatch

The code path, per scope. `evidence.json` is `{}`: no scope meets the rule.

gc-c-codepath: scope=s6 bucket=d commits=none functions=none separated=n/a reason=table_has_no_entry_producing_a_changed_day_kind commits_touching_path=#1194,#1196,#1205 outside_rule_lead=worker_env_mt5_clock_switch
gc-c-codepath: scope=s9 bucket=d commits=none functions=none separated=n/a reason=table_has_no_entry_producing_a_changed_day_kind commits_touching_path=#1194,#1196,#1205 outside_rule_lead=worker_env_mt5_clock_switch
gc-c-codepath: scope=s10 bucket=d commits=none functions=none separated=n/a reason=table_has_no_entry_producing_a_changed_day_kind commits_touching_path=#1194,#1196,#1205 outside_rule_lead=worker_env_mt5_clock_switch

Corrected in review round 2 (F1): these three lines first read `reason=no_commit_between_the_worker_commits_changes_mt5_day_bucketing`, a literal printed whatever the table said. It was false: #1196 touches `combine_mt5_deal_ledger` and #1205 touches `run_derive_broker_dailies`. The reason is now derived from the judge's TABLE (`codepath_judge.py`): no entry produces a changed-day kind, and the commits that do touch the derive path are named. `clock-candidate.json`'s note of the same claim was corrected too (it is our own derived file). The bucket, the commits judged and `evidence.json` (`{}`) are unchanged.

## The lead outside the rule: the worker's MT5 server clock (measured here, not assigned)

The strategy-mode MT5 derive reads the broker's deals live and buckets each deal's day by `resolve_mt5_server_clock()` (`analytics-service/services/mt5_server_clock.py`) through `deal_utc_day` (`mt5_deals.py`) inside `combine_mt5_deal_ledger` (`broker_dailies.py`). That clock comes from a worker variable, not from a commit. The repo's records (CHANGELOG `[0.133.18.4]`, `175-VERIFICATION.md`) say: the fixed integer 10800 until 2026-11-01 07:11Z, 7200 after, then the rule `us` set at 13:38:28Z and 13:38:36Z on 2026-11-03. The worker deployment list shows a redeploy of the previous commit 19 seconds after the second switch line. `mt5_server_clock.py` and `mt5_deals.py` do not differ between the worker commits of this plan, and #1135 (MT5OFFSET) is an ancestor of every one of them, so the code is the same on both sides and only the setting differs. Under the US rule the clock is +3 h in summer and +2 h in winter, so a fixed 7200 and the rule agree in winter and differ in summer, by one hour of the deal's day boundary.

That is what the rows show. Every one of the 72 changed days of s6, s9 and s10 lies in the US-rule summer; s9 is the only one of the three with winter activity and it changed 24 of 120 active summer days and 0 of 36 active winter days (active: nonzero in either capture) (probability about 0.001 if the 24 were placed at random among its 156 active days). Every one of the 26 runs of two or more consecutive changed days keeps its compounded return, which a re-roll from a moved terminal does not (the offset test fails on every defined stretch of these scopes, `cv` from 1e-2 to 2e+1). And across all 11 MT5 strategies the set re-derived across the switch equals the set that moved, in both pairs:

gc-c-codepath-clock: interim_offset_s=7200 interim_set=2026-11-01T07:11:00Z rule_set=2026-11-03T13:38:28Z offset_deleted=2026-11-03T13:38:36Z worker_redeploy=2026-11-03T13:38:55Z worker_redeploy_commit=eb4c86fd0a9e previous_worker_commit=eb4c86fd0a9e same_commit_as_previous=yes source=records
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s2 older_derive=before_switch newer_derive=before_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s2 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s3 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s3 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s4 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s4 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s5 older_derive=before_switch newer_derive=before_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s5 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s6 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes changed=31
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s6 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s7 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s7 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s8 older_derive=before_switch newer_derive=before_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s8 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s9 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes changed=24
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s9 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s10 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes changed=17
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s10 older_derive=after_switch newer_derive=after_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s12 older_derive=none_switch newer_derive=none_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s12 older_derive=none_switch newer_derive=none_switch rederived_across_switch=no moved=no
gc-c-codepath-clock-xcheck: pair=b0-b1 scope=s13 older_derive=before_switch newer_derive=before_switch rederived_across_switch=no moved=no changed=0
gc-c-codepath-clock-xcheck: pair=c0-c1 scope=s13 older_derive=before_switch newer_derive=after_switch rederived_across_switch=yes moved=yes
gc-c-codepath-clock-summary: pair=b0-b1 mt5_strategies=11 rederived_across_switch=s6,s9,s10 moved=s6,s9,s10 sets_equal=yes
gc-c-codepath-clock-summary: pair=c0-c1 mt5_strategies=11 rederived_across_switch=s2,s5,s8,s13 moved=s2,s5,s8,s13 sets_equal=yes

What this does and does not show:

- **It does not meet the rule, by design.** Rule (2) asks for a commit that changes a function on the path. The change is a worker variable. Under the rule as fixed before the analysis the three scopes stay (d), and `evidence.json` does not carry them. `~/.cache/quantalyze/residchurn/codepath/clock-candidate.json` holds the lead for plan 07.
- **Decision for the founder (not taken here).** D-08's bucket (c) reads "a named code path" and bucket (b) "upstream input changed". A recorded configuration switch of an existing code path fits neither word exactly. Recommendation: plan 07 reports the lead as measured and the three scopes as (d) by the rule, and the founder decides whether (c) is widened to "a named code path or a recorded worker setting". Nothing here picks.
- **Two causes lie in the same interval and the scope-level cross-check cannot separate them.** Every older row set of both pairs predates both the clock switch and #1196 and #1205 (TINYBASE). What separates them is the kind of change on a day present in both captures: TINYBASE leaves a day out or deletes its row and cannot change the value of a surviving day (read in `chain_linked_twr`, which computes `(cur - prev - flow) / prev` for every day it does not leave out). The 29 rows of s9 present in b0 and absent from b1 are that other effect; 188's diff counts them in its own `vanished` field, outside the 1214. The four c0 to c1 scopes also lost or gained rows (s2 lost 26), so plan 07 should apply the same changed-day test to them from rows.
- **No replay.** No venue data is stored, so no derive was re-run; the claim is that the stored rows match what a one-hour change of the day boundary does, not that they were reproduced. The clock history is the repo's record, not a read of the Railway variables (no Railway call is allowed in this plan).
- **s6 and s10 have no winter-active day**, so the summer-only pattern is not an independent test for them; their evidence is the shared dates with s9 and the crossing of the switch.

## The b0 to b1 buckets re-run with the real strategy-to-key links

Heading as the plan requires: the (c) assignments still wait for plan 07's prediction 4. There are none to wait for, because `evidence.json` is empty (c = 0).

`attribute.py --pair b01 ... --strat-keys $RC/pre/strat_keys.json --evidence $RC/codepath/evidence.json --neuter` (exit 0). Plan 02 flagged s1, s15 and s16 as (d) only because no strategy-to-key map existed. Linked to k18, k32 and k19, each passes the offset test on every defined stretch (cv 2.5e-12 to 3.9e-12 against the 1e-4 bound; the third stretch is the single mark day, cv undefined), so they are (b). s6, s9 and s10 link to k35, k3 and k13 and fail it on every stretch.

gc-c-b01-inputs: key=k18 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k19 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k32 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k35 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-11-01
gc-c-b01-inputs: key=k3 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-11-01
gc-c-b01-inputs: key=k13 anchor_changed=no nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-11-01
gc-c-b01-offset: scope=s1 stretch=2026-08-02..2026-08-19 days=18 cv=3.3e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=s1 stretch=2026-09-06..2026-10-25 days=50 cv=3.9e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=s1 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=s15 stretch=2026-08-02..2026-08-19 days=18 cv=2.8e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=s15 stretch=2026-09-06..2026-10-25 days=50 cv=3.6e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=s15 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=s16 stretch=2026-08-02..2026-08-19 days=18 cv=2.5e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=s16 stretch=2026-09-06..2026-10-25 days=50 cv=3.7e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=s16 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-bucket: scope=s1 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=s6 bucket=d rows=31 band=9/0/22 evidence=none
gc-c-b01-bucket-why: scope=s6 reason=offset_0_of_9_pass
gc-c-b01-bucket: scope=s9 bucket=d rows=24 band=3/0/21 evidence=none
gc-c-b01-bucket-why: scope=s9 reason=offset_0_of_5_pass
gc-c-b01-bucket: scope=s10 bucket=d rows=17 band=2/0/15 evidence=none
gc-c-b01-bucket-why: scope=s10 reason=offset_0_of_4_pass
gc-c-b01-bucket: scope=s15 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=s16 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket-total: a=0 b=1142 c=0 d=72 sum=1214
gc-c-b01-neuter: scope=k15 stretch=2026-01-23..2026-01-24 cv_before=1.2e-11 cv_after=9.9e-01 went_red=yes

## Accomplishments

- **Each side of the three scopes is tied to a worker commit (Task 1).** Both lists reach back before the windows. On the b1 side every job ran on #1205's commit with no deployment near it. On the b0 side every job sat within 30 minutes of a deployment, so each names its alternative: s6 either #1187's commit or the baseline re-dump before it, s9 and s10 either the baseline re-dump or the commit before it. None of the alternatives changes a function the analysis needs.
- **Nine candidate commits judged, none meets the rule (Task 2).** Two of them (#1196, #1205) do change functions on the MT5 strategy-mode path and fail rule (3): they leave a day out or delete a row, and every changed day exists in both captures. The other seven touch other venues, other modes, tests, metadata or flags. The judge script derives `evidence.json` from the table and was shown able to say yes.
- **s1, s15 and s16 answered.** They pass the offset test, so the b0 to b1 split is b 1142 / d 72 / a 0 / c 0, the research expectation.
- **A lead outside the rule is recorded with its cross-check.** See above.

## Task Commits

1. **Task 1: worker commit behind each side of s6, s9 and s10** - `7add6b703` (test)
2. **Task 2: the nine judgements, the empty evidence file, the buckets re-run and the clock lead** - `7af529f46` (test)

**Plan metadata:** the `docs(202-05)` commit that completes this file and updates STATE and ROADMAP (not counted in `commits:`, which is measured to the Task 2 commit).

## Files Created/Modified

Tracked: this SUMMARY only. Untracked scratch under `~/.cache/quantalyze/residchurn`: `bin/codepath.py` (Task 1), `bin/codepath_sig.py`, `bin/codepath_xcheck.py`, `bin/codepath_judge.py` (Task 2, each with `--self-test`), `codepath/derive.out`, `signature.out`, `judge.out`, `xcheck.out`, `evidence.json` (`{}`), `clock-candidate.json`, `attr/b0-b1-evidence.out`. No script under `$RC/bin` that another plan owns was edited, and `$RC/pre`, `c1`, `deploy` and `rows` were only read.

## Decisions Made

- **straddle means a code ambiguity.** A job straddles only if the commits that may have served it are more than one. A deployment inside the window that carries the commit already in force changes no code, so it is counted in `window_deployments` and does not make a straddle. (All three b0 jobs do straddle, because the deployment before their window carries a different commit.)
- **The lead is not evidence.** `evidence.json` is derived from the judgements and is empty. Writing the clock lead into it would have changed the rule after seeing the data.
- **Per-day values stay in scratch.** The SUMMARY holds counts by kind, run counts and season counts only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, narrowed] The c0 jobs file holds no per-strategy rows**
- **Found during:** Task 2 (clock cross-check, first run)
- **Issue:** `$RC/c0/jobs.json` is the 188-era `last_updated` shape, so the c0 side of the cross-check read `none` for every strategy.
- **Fix:** the cross-check takes `$RC/pre/jobs.json` for the c0 side. Plan 04 measured that the pre rows equal c0's on all 54 scopes (`gc-c-prefix ... equal=54`), so the latest derive per subject in pre is the one that wrote c0's rows. Stated as an assumption of the cross-check.
- **Files modified:** none tracked (the script takes the file as a flag)

**2. [Note] Extra line shapes.** Beyond the plan's line shapes: `gc-c-codepath-venue`, `gc-c-codepath-commit`, `gc-c-codepath-pattern`, `gc-c-codepath-removed`, `gc-c-codepath-clock`, `-clock-xcheck`, `-clock-summary`, and trailing fields on the derive and candidates lines. None starts with a prefix the plan counts.

---

**Total deviations:** 1 narrowed blocker (Rule 3), 1 note.
**Impact on plan:** none on the rule or the counts; the second pair of the cross-check would have read empty without it.

## Issues Encountered

- A zsh `$c:analytics...` expansion broke one shell check of function names; re-run with braces, nothing was written.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or schema was added; nothing touched PROD, Railway, Keychain or `q.sh`. The SUMMARY holds labels, ISO times, counts and public commit ids; the uuid and home-path gate prints nothing.

## Limits (for plan 07's `## Limits`)

- The code-path analysis reads git history, the CHANGELOG, the deployment list and 188's stored jobs and rows. It does not replay a derive (no venue data is stored).
- The deployment list has no per-job record of which deployment served a job; the commit is the latest deployment created before the job, with the 30 minute window as the stated ambiguity.
- The MT5 clock history (7200 from 2026-11-01 07:11Z, `us` from 2026-11-03 13:38Z) is the repo's record, not a read of the Railway variables.
- The summer-only pattern is a statistic over 72 days in three scopes of which only one has a winter control.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 07 reads `evidence.json` (`{}`), `clock-candidate.json` and the clock lines above. It was to confirm prediction 4 for s6, s9 and s10 (plan 06 scored it held: they did not move across the deploy-free pair, as both explanations predict; review round 2 corrects that, because not tested (corrected in review round 2): s6, s9 and s10 were not re-derived between c0 and c1 (latest derives 2026-11-06 00:25Z, 00:25Z and 01:25Z, all before c0), so "did not move" means no job wrote them, so prediction 4 is untested), applies the same changed-day test to s2, s5, s8 and s13 from rows, and carries the bucket-wording decision to the founder.
- D-14 (b6's curve gap) is plan 07's and was not touched here.

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-07*

## Self-Check: PASSED

- Scratch files exist and are non-empty: `bin/codepath.py`, `bin/codepath_sig.py`, `bin/codepath_xcheck.py`, `bin/codepath_judge.py`, `codepath/derive.out`, `signature.out`, `judge.out`, `xcheck.out`, `evidence.json` (a dict, `{}`), `clock-candidate.json`, `attr/b0-b1-evidence.out`.
- Commits `7add6b703` and `7af529f46` are ancestors of HEAD; `git rev-list --count` from the ledger base to `7af529f46` reads 2.
- Task 1 and Task 2 verify commands exit 0; exactly 6 derive lines, 3 candidates lines, 3 signature lines, 27 judge lines, 3 `gc-c-codepath:` lines; no `bucket=c` line; every `straddle=yes` derive line lists a commit in `also=`; the uuid and home-path gate prints nothing.
- Self-tests pass: `codepath.py` (7 cases, RED with the window neutered), `codepath_sig.py` (6), `codepath_xcheck.py` (7), `codepath_judge.py` (4); the attribute.py re-run exits 0 with `neuter went_red=yes`.
