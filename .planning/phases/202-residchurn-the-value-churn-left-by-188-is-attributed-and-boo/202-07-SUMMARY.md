---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 07
subsystem: infra
tags: [prod-read-only, row-level-control, attribution, sha-pinned-rule, book-b3, clock-lead]

requires:
  - phase: 202-residchurn
    provides: plan 02 attribute.py and the pinned final_attribution.py, plan 03 b3_replay.py, plan 05 code-path judgements and the clock lead, plan 06 c1 and groups.json
provides:
  - the row-level reads of the 14 scopes that moved across the deploy-free nightly, each bound to c1
  - assemble_c1.py (argument-driven, self-tested), the c0-to-c1 attribution and the final attribution of the 1214
  - success criterion 1 answered on a valid pair, predictions 2 and 3 scored
affects: [202-08]

plan_head_before: a1492776696f12c8b8316b59ef79027175386905
plan_head_after: eecda8381753a8d9c92cda80985dd9c9bf6469d8
actuals:
  tokens: 17100
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "an argument-driven assembler that must reproduce the newer capture's prefix digests from its rows before any comparison runs"
    - "a pinned rule run unchanged, with a clearly labelled alternative reading beside it and no choice made"

key-files:
  created: []
  modified:
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-07-SUMMARY.md
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md

key-decisions:
  - "The pinned final_attribution.py (hash prefix 8a62ca3b1215) was run unchanged and its output is the attribution of record: b 36, d 1178. The alternative reading (undefined one-day stretches not counted as failures: b 1142, d 72) is printed beside it under the gc-c-alt- prefixes and the choice is the founder's."
  - "Two scratch scripts were corrected, not any saved file: check_capture.py's rows kind (marker and <label>.json names, with self-test cases) and b3_replay.py's c1 loader (the d_keys and d_ki aggregate shapes)."
  - "D-14: book b6's gap is a standing behaviour (one key counted on b0, b1 and c1), named at function level only under plan 05's rule; the reason inside departed_history_inclusion is not separated and the one PROD read that would separate it was not made."
  - "D-12 is routed by the plan's rule to reopened=yes reason=component_disagrees (b6's truncation line, plan 03's rule unamended per D-14) and returned as a checkpoint, not decided by the executor."
  - "The clock lead and the pinned-rule reading are reported as measured and left as open founder questions; bucket (c) was not widened."

requirements-completed: [RESID-01, RESID-02]

coverage:
  - id: D1
    description: "The row reads of the 14 moved scopes are bound to c1 and the assembled c1 row set reproduces 54 of 54 prefix digests"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "check_capture.py --kind rows (exit 0, n_files=15/15, marker=PRODUCTION) and assemble_c1.py (38/38 and 16/16 prefix digests reproduced), assemble_c1.py --self-test (12 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Success criterion 1 answered on a valid pair: stored values moved across a deploy-free nightly on 14 scopes (1193 values), predictions 2 and 3 held"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "attribute.py --pair c01 (gc-c-c01-total changed=1193) and the Task 2 verify command (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The 1214 values attributed by the pinned rule (b 36, d 1178) with an alternative reading beside it (b 1142, d 72)"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "final_attribution.py --self-test (7 cases) and the Task 2 verify command (sum 1214)"
        status: pass
    human_judgment: true
    rationale: "Which reading of an undefined one-day stretch the phase adopts, and the bucket wording for the worker clock setting, are founder decisions"
  - id: D4
    description: "Book b3 re-read on c1 (out_of_window_flow correct, window_truncated unexplained on b6's line) and D-12 routed to reopened=yes component_disagrees"
    requirement: RESID-02
    verification:
      - kind: other
        ref: "b3_replay.py --c1 on the real c1 capture, neuter run flips the replay, Task 3 verify command (routing recomputed from the verdict line)"
        status: pass
    human_judgment: true
    rationale: "Whether plan 08 acts on the re-open or D-13 is applied is the founder's decision"
  - id: D5
    description: "D-14: book b6's stored curve counts one key (k18); function-level naming, reason-level not separated"
    requirement: RESID-02
    verification:
      - kind: other
        ref: "d14_b6.py (self-test and run on b0 and b1 stored rows)"
        status: pass
    human_judgment: true
    rationale: "Whether omitting a departed key's history from a book without a naming token is intended needs the owner's key row from PROD and a founder call"

duration: 25min
completed: 2026-11-07
status: complete
---

# Phase 202 Plan 07: row-level control, final attribution and book b3 Summary

**On a deploy-free nightly 14 of 54 scopes (1193 values) moved across a deploy-free nightly (code-identical writers for ten of them, 1106 values; the four MT5 strategies' c0 rows were written by an earlier worker commit, see the review round 1 correction after the criterion line), the pinned rule leaves 36 of the 1214 attributed and 1178 unexplained (1142 and 72 under the alternative reading it contradicts), book b3 reads out_of_window_flow correct with D-12 re-opened on b6's truncation line, and b6's curve is shown to count one key only**

## Result lines (Task 2: rows bound to c1, the deploy-free nightly at row level, the final attribution)

Labels, ISO days, counts and tokens only. The rows were read by the orchestrator after c1 (marker alone at 03:10:50Z, `n_final.sql` last at 03:13:46Z, jobs idle, last done 2026-11-07T01:37:14Z, the same as c1's final). The saved marker file is not reproduced.

marker-202: capture=rows alone=PRODUCTION last_query=PRODUCTION taken=2026-11-07T03:13:46Z
gc-c-check: capture=rows marker=PRODUCTION checks=0/0 counts=absent n_files=15/15 jobs=absent sql_sha=ok
gc-c-lint: capture=rows gen_sql_lint files=24 violations=0 sha256_d=7/7 read_only=yes
gc-c-rows-bound: bound_to_c1=14/14 rows_unbound=none reads=14 final_read=1 note=n_files_15_of_15_is_14_reads_plus_the_final_query
gc-c-inputs-base: c0_key_inputs_kind_and_computed_at_equal_b1=30/30
gc-c-assemble: kind=key scopes=38 rows=11774 prefix_digests_reproduced=38/38
gc-c-assemble: kind=strat scopes=16 rows=3273 prefix_digests_reproduced=16/16

The c1 row set is built from b1's rows for the 40 scopes that did not move (b1 stands for c0 on 54 of 54 digests, plan 01) and from the 14 reads for the scopes that did, and it reproduces every one of the 54 prefix digests and prefix row counts of c1. The strategy table holds 3273 rows, the same as c1's whole-table count.

### The c0-to-c1 attribution (`attribute.py --pair c01`, 188's exact rule, bands beside it)

gc-c-c01-diff: scope=k15 compared=286 changed=277 band_low=5 band_mid=272 band_high=0 first_changed=2026-01-23 last_changed=2026-10-26 max_abs=4.9e-07 lastday_moved=no
gc-c-c01-diff: scope=k18 compared=195 changed=69 band_low=2 band_mid=56 band_high=11 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=2.3e-05 lastday_moved=no
gc-c-c01-diff: scope=k19 compared=95 changed=69 band_low=2 band_mid=56 band_high=11 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.9e-05 lastday_moved=no
gc-c-c01-diff: scope=k24 compared=95 changed=69 band_low=2 band_mid=55 band_high=12 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=2.7e-05 lastday_moved=no
gc-c-c01-diff: scope=k27 compared=195 changed=69 band_low=2 band_mid=55 band_high=12 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=2.7e-05 lastday_moved=no
gc-c-c01-diff: scope=k32 compared=195 changed=69 band_low=2 band_mid=56 band_high=11 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=2.1e-05 lastday_moved=no
gc-c-c01-diff: scope=s1 compared=255 changed=69 band_low=2 band_mid=56 band_high=11 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.7e-05 lastday_moved=no
gc-c-c01-diff: scope=s2 compared=381 changed=24 band_low=3 band_mid=0 band_high=21 first_changed=2025-10-30 last_changed=2026-08-08 max_abs=3.7e-02 lastday_moved=no
gc-c-c01-diff: scope=s5 compared=226 changed=21 band_low=4 band_mid=0 band_high=17 first_changed=2026-03-25 last_changed=2026-10-01 max_abs=3.9e-02 lastday_moved=no
gc-c-c01-diff: scope=s8 compared=226 changed=21 band_low=4 band_mid=0 band_high=17 first_changed=2026-03-25 last_changed=2026-10-01 max_abs=3.9e-02 lastday_moved=no
gc-c-c01-diff: scope=s13 compared=226 changed=21 band_low=4 band_mid=0 band_high=17 first_changed=2026-03-25 last_changed=2026-10-01 max_abs=3.9e-02 lastday_moved=no
gc-c-c01-diff: scope=s14 compared=286 changed=277 band_low=5 band_mid=272 band_high=0 first_changed=2026-01-23 last_changed=2026-10-26 max_abs=4.9e-07 lastday_moved=no
gc-c-c01-diff: scope=s15 compared=191 changed=69 band_low=3 band_mid=58 band_high=8 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.2e-05 lastday_moved=no
gc-c-c01-diff: scope=s16 compared=189 changed=69 band_low=2 band_mid=56 band_high=11 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=2.1e-05 lastday_moved=no
gc-c-c01-total: scopes=54 changed_scopes=14 changed=1193 band_low=42 band_mid=992 band_high=159 reproduces_188_16=not-asked
gc-c-c01-cluster: cluster=A scopes=k15,s14 rows=554 identical_series=no
gc-c-c01-cluster: cluster=B scopes=k18,k19,k24,k27,k32,s1,s15,s16 rows=552 identical_series=no
gc-c-c01-cluster: cluster=C scopes=s2 rows=24 identical_series=no
gc-c-c01-cluster: cluster=D scopes=s5,s8,s13 rows=63 identical_series=no
gc-c-c01-inputs: key=k15 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k18 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k19 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k24 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k27 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k32 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k8 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k33 anchor_changed=no nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k30 anchor_changed=no nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-inputs: key=k21 anchor_changed=no nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-c01-offset: scope=k15 stretch=2026-01-23..2026-01-24 days=2 cv=8.3e-11 pass=yes qualifying=2
gc-c-c01-offset: scope=k15 stretch=2026-01-26..2026-01-27 days=2 cv=2.2e-10 pass=yes qualifying=2
gc-c-c01-offset: scope=k15 stretch=2026-01-29..2026-08-19 days=203 cv=1.4e-09 pass=yes qualifying=203
gc-c-c01-offset: scope=k15 stretch=2026-08-21..2026-09-07 days=18 cv=1.3e-09 pass=yes qualifying=18
gc-c-c01-offset: scope=k15 stretch=2026-09-09..2026-10-25 days=47 cv=1.1e-09 pass=yes qualifying=47
gc-c-c01-offset: scope=k15 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k15 stretch=2026-09-09..2026-10-26 days=48 cv=5.0e-02 pass=no qualifying=48
gc-c-c01-offset: scope=k18 stretch=2026-08-02..2026-08-19 days=18 cv=1.3e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=k18 stretch=2026-09-06..2026-10-25 days=50 cv=1.7e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=k18 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k18 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=k19 stretch=2026-08-02..2026-08-19 days=18 cv=2.1e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=k19 stretch=2026-09-06..2026-10-25 days=50 cv=2.3e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=k19 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k19 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=k24 stretch=2026-08-02..2026-08-19 days=18 cv=1.2e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=k24 stretch=2026-09-06..2026-10-25 days=50 cv=1.5e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=k24 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k24 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=k27 stretch=2026-08-02..2026-08-19 days=18 cv=1.4e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=k27 stretch=2026-09-06..2026-10-25 days=50 cv=1.8e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=k27 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k27 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=k32 stretch=2026-08-02..2026-08-19 days=18 cv=2.1e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=k32 stretch=2026-09-06..2026-10-25 days=50 cv=1.9e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=k32 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=k32 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=s1 stretch=2026-08-02..2026-08-19 days=18 cv=2.0e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=s1 stretch=2026-09-06..2026-10-25 days=50 cv=2.7e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=s1 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=s1 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=s2 stretch=2025-10-30..2025-10-31 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-03-16..2026-03-17 days=2 cv=8.2e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s2 stretch=2026-03-25..2026-03-26 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-03-28..2026-03-28 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-04-06..2026-04-08 days=3 cv=1.7e+01 pass=no qualifying=3
gc-c-c01-offset: scope=s2 stretch=2026-04-13..2026-04-14 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-04-22..2026-04-23 days=2 cv=5.7e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s2 stretch=2026-05-11..2026-05-11 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-05-17..2026-05-18 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-05-23..2026-05-23 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s2 stretch=2026-05-28..2026-05-29 days=2 cv=4.0e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s2 stretch=2026-06-02..2026-06-03 days=2 cv=8.8e-02 pass=no qualifying=2
gc-c-c01-offset: scope=s2 stretch=2026-08-07..2026-08-08 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-03-25..2026-03-26 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-04-06..2026-04-08 days=3 cv=2.1e+00 pass=no qualifying=3
gc-c-c01-offset: scope=s5 stretch=2026-04-13..2026-04-14 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-04-17..2026-04-17 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-04-22..2026-04-23 days=2 cv=3.3e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s5 stretch=2026-05-12..2026-05-12 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-05-17..2026-05-18 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-05-26..2026-05-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-05-28..2026-05-29 days=2 cv=5.5e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s5 stretch=2026-06-02..2026-06-03 days=2 cv=2.3e-02 pass=no qualifying=2
gc-c-c01-offset: scope=s5 stretch=2026-08-08..2026-08-08 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s5 stretch=2026-10-01..2026-10-01 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-03-25..2026-03-26 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-04-06..2026-04-08 days=3 cv=2.1e+00 pass=no qualifying=3
gc-c-c01-offset: scope=s8 stretch=2026-04-13..2026-04-14 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-04-17..2026-04-17 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-04-22..2026-04-23 days=2 cv=3.3e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s8 stretch=2026-05-12..2026-05-12 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-05-17..2026-05-18 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-05-26..2026-05-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-05-28..2026-05-29 days=2 cv=5.5e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s8 stretch=2026-06-02..2026-06-03 days=2 cv=2.3e-02 pass=no qualifying=2
gc-c-c01-offset: scope=s8 stretch=2026-08-08..2026-08-08 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s8 stretch=2026-10-01..2026-10-01 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-03-25..2026-03-26 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-04-06..2026-04-08 days=3 cv=2.1e+00 pass=no qualifying=3
gc-c-c01-offset: scope=s13 stretch=2026-04-13..2026-04-14 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-04-17..2026-04-17 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-04-22..2026-04-23 days=2 cv=3.3e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s13 stretch=2026-05-12..2026-05-12 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-05-17..2026-05-18 days=2 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-05-26..2026-05-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-05-28..2026-05-29 days=2 cv=5.5e-01 pass=no qualifying=2
gc-c-c01-offset: scope=s13 stretch=2026-06-02..2026-06-03 days=2 cv=2.3e-02 pass=no qualifying=2
gc-c-c01-offset: scope=s13 stretch=2026-08-08..2026-08-08 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s13 stretch=2026-10-01..2026-10-01 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset: scope=s14 stretch=2026-01-23..2026-01-24 days=2 cv=9.9e-11 pass=yes qualifying=2
gc-c-c01-offset: scope=s14 stretch=2026-01-26..2026-01-27 days=2 cv=2.2e-10 pass=yes qualifying=2
gc-c-c01-offset: scope=s14 stretch=2026-01-29..2026-08-19 days=203 cv=1.2e-09 pass=yes qualifying=203
gc-c-c01-offset: scope=s14 stretch=2026-08-21..2026-09-07 days=18 cv=1.3e-09 pass=yes qualifying=18
gc-c-c01-offset: scope=s14 stretch=2026-09-09..2026-10-25 days=47 cv=1.1e-09 pass=yes qualifying=47
gc-c-c01-offset: scope=s14 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=s14 stretch=2026-09-09..2026-10-26 days=48 cv=5.0e-02 pass=no qualifying=48
gc-c-c01-offset: scope=s15 stretch=2026-08-02..2026-08-19 days=18 cv=2.6e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=s15 stretch=2026-09-06..2026-10-25 days=50 cv=3.2e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=s15 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=s15 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-offset: scope=s16 stretch=2026-08-02..2026-08-19 days=18 cv=2.0e-11 pass=yes qualifying=18
gc-c-c01-offset: scope=s16 stretch=2026-09-06..2026-10-25 days=50 cv=2.3e-11 pass=yes qualifying=50
gc-c-c01-offset: scope=s16 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-c01-offset-literal: scope=s16 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-c01-bucket: scope=k15 bucket=b rows=277 band=5/272/0 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5
gc-c-c01-bucket: scope=k18 bucket=b rows=69 band=2/56/11 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=k19 bucket=b rows=69 band=2/56/11 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=k24 bucket=b rows=69 band=2/55/12 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=k27 bucket=b rows=69 band=2/55/12 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=k32 bucket=b rows=69 band=2/56/11 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=s1 bucket=b rows=69 band=2/56/11 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=s2 bucket=d rows=24 band=3/0/21 evidence=none
gc-c-c01-bucket-why: scope=s2 reason=offset_0_of_5_pass
gc-c-c01-bucket: scope=s5 bucket=d rows=21 band=4/0/17 evidence=none
gc-c-c01-bucket-why: scope=s5 reason=offset_0_of_4_pass
gc-c-c01-bucket: scope=s8 bucket=d rows=21 band=4/0/17 evidence=none
gc-c-c01-bucket-why: scope=s8 reason=offset_0_of_4_pass
gc-c-c01-bucket: scope=s13 bucket=d rows=21 band=4/0/17 evidence=none
gc-c-c01-bucket-why: scope=s13 reason=offset_0_of_4_pass
gc-c-c01-bucket: scope=s14 bucket=b rows=277 band=5/272/0 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5
gc-c-c01-bucket: scope=s15 bucket=b rows=69 band=3/58/8 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket: scope=s16 bucket=b rows=69 band=2/56/11 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-c01-bucket-total: a=0 b=1106 c=0 d=87 sum=1193

### Predictions 2 and 3, and success criterion 1

gc-c-pred: n=2 held=yes scopes_moved=k15,s14,k18,k19,k24,k27,k32,s1,s15,s16 latest_changed=k15:2026-10-26,s14:2026-10-26,k18:2026-10-26,k19:2026-10-26,k24:2026-10-26,k27:2026-10-26,k32:2026-10-26,s1:2026-10-26,s15:2026-10-26,s16:2026-10-26 stretches_failing=0 undefined_stretches=10 k38_changed_after_2026-10-23=no
gc-c-pred: n=3 held=yes k38_changed=0 k38_max_abs=0.0e+00
gc-c-criterion1: pair=valid moved_without_code_change=yes scopes=k15,k18,k19,k24,k27,k32,s1,s2,s5,s8,s13,s14,s15,s16 bucket_a=none bucket_b=k15,k18,k19,k24,k27,k32,s1,s14,s15,s16 bucket_d=s2,s5,s8,s13 c01_rows=1193 c01_b=1106 c01_d=87 basis=c01_bucket_lines

**Correction, review round 1 (CR-01, CR-02).** The line above reads `moved_without_code_change=yes` for all 14 scopes. That holds only where both sides were written by the same code. Measured per scope from the saved job and deployment files (`codepath/c0c1-writers.out`):

gc-c-criterion1-corrected: code_identical_both_sides=k15,k18,k19,k24,k27,k32,s1,s14,s15,s16 values=1106 c0_writer=50594c75034a c1_writer=ba3c9012858e diff_analytics_service_migrations=empty
gc-c-criterion1-corrected: writers_differ=s2,s5,s8,s13 values=87 vanished_s2=29 c0_writer=099a9f166947 c1_writer=ba3c9012858e commits_between=#1190,#1193,#1194,#1196,#1197,#1200,#1202,#1205 count=8

Plan 05's judge on this pair (`codepath/c0c1-judge.out`, `gc-c-codepath-judged` and `gc-c-codepath` lines): all 8 candidates `meets_rule=no`, `evidence.json` `{}`, s2, s5, s8 and s13 stay (d). The judge weighs changed days only; #1196 and #1205 were not weighed against s2's 29 vanished rows. D-16's (d) outcome stands. `attribute.py` now also prints 188's vanished and appeared counts (`gc-c-c01-vanappear`: s2 29 vanished, 2025-11-17 to 2025-12-15, all US winter, 15 nonzero; 0 appeared anywhere; b0 to b1: C, k1, k2 7 each and s9 29, 50 in total, equal to 188-16, 0 appeared). `changed` and the 1214 are untouched.

Prediction 2 is scored on the ten scopes it names. `undefined_stretches=10` is one stretch per scope, the single mark day, which has one qualifying day and so no coefficient of variation; `stretches_failing=0` counts only stretches with a defined coefficient of variation at or above 1e-4. Prediction 1 failed in plan 06 (s2, s5, s8 and s13 moved), and prediction 4 was scored held by plan 06, which review round 2 corrects to not tested: not tested (corrected in review round 2): s6, s9 and s10 were not re-derived between c0 and c1 (latest derives 2026-11-06 00:25Z, 00:25Z and 01:25Z, all before c0), so "did not move" means no job wrote them.

### The four strategies prediction 1 missed: plan 05's changed-day test, applied to the c0-to-c1 rows

Plan 05 asked for the same summer/winter test on s2, s5, s8 and s13. It is plan 05's `analyse` function imported unchanged (`c01_signature.py`, with its own self-test).

gc-c-c01-signature: scope=s2 day_shift=2 sign_flip=3 zero_change=4 magnitude=15 changed=24 shift_receiver_earlier=1 shift_receiver_later=0
gc-c-c01-pattern: scope=s2 changed_in_us_summer=24/24 changed_in_us_winter=0/24 active_days_summer=122 active_days_winter=37 runs=13 multi_day_runs=10 runs_compound_conserved=10
gc-c-c01-removed: scope=s2 days_in_c0_absent_from_c1=29 of_which_us_summer=0
gc-c-c01-signature: scope=s5 day_shift=2 sign_flip=3 zero_change=3 magnitude=13 changed=21 shift_receiver_earlier=1 shift_receiver_later=0
gc-c-c01-pattern: scope=s5 changed_in_us_summer=21/21 changed_in_us_winter=0/21 active_days_summer=109 active_days_winter=1 runs=12 multi_day_runs=8 runs_compound_conserved=8
gc-c-c01-removed: scope=s5 days_in_c0_absent_from_c1=0 of_which_us_summer=0
gc-c-c01-signature: scope=s8 day_shift=2 sign_flip=3 zero_change=3 magnitude=13 changed=21 shift_receiver_earlier=1 shift_receiver_later=0
gc-c-c01-pattern: scope=s8 changed_in_us_summer=21/21 changed_in_us_winter=0/21 active_days_summer=109 active_days_winter=1 runs=12 multi_day_runs=8 runs_compound_conserved=8
gc-c-c01-removed: scope=s8 days_in_c0_absent_from_c1=0 of_which_us_summer=0
gc-c-c01-signature: scope=s13 day_shift=2 sign_flip=3 zero_change=3 magnitude=13 changed=21 shift_receiver_earlier=1 shift_receiver_later=0
gc-c-c01-pattern: scope=s13 changed_in_us_summer=21/21 changed_in_us_winter=0/21 active_days_summer=109 active_days_winter=1 runs=12 multi_day_runs=8 runs_compound_conserved=8
gc-c-c01-removed: scope=s13 days_in_c0_absent_from_c1=0 of_which_us_summer=0

Measured, not explained. All 87 changed values of the four fall on days in the US-rule summer, and none in winter. The winter control is thin and was read wrongly in the first version of this line: s2 has 37 active winter days present in both captures and none of its changed days is in winter, but its 29 days absent from c1 are all US winter (15 nonzero), and the count of active days leaves them out by construction. s5, s8 and s13 have one active winter day each. The offset test fails on every defined stretch of the four (`bucket_d reason=offset_0_of_5_pass` for s2 and `offset_0_of_4_pass` for the other three). The counts of s2's changed days by kind (2 day shifts, 3 sign flips, 4 zero changes, 15 magnitude, 29 days absent from c1, 13 runs of which 10 span several days and all 10 compound unchanged) equal the counts plan 05 printed for s9 between b0 and b1, although the two series are not equal (349 of 356 common days equal in c1). This is the same signature as the b0-to-b1 movement of s6, s9 and s10, in four more strategies, and every one of the four was re-derived across the MT5 server-clock switch (plan 05's cross-check, `sets_equal=yes` on this pair). It is a measured match to the lead, not a cause.

### The final attribution of the 1214 (plan 02's `final_attribution.py`, run unchanged)

gc-c-final-rule-used: script_sha12=8a62ca3b1215 equal_to_plan_02=yes
selftest: `final_attribution.py --self-test` 7 cases, all ok

gc-c-cause-scope: scope=k15 bucket=d rows=277 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k18 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k19 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k24 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k27 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k32 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=k38 bucket=b rows=36 b01_evidence=float_rounding,anchor_changed,terminal_changed control=quiet moved_to_d=no b01_bucket=b
gc-c-cause-scope: scope=s1 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=s6 bucket=d rows=31 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-cause-scope: scope=s9 bucket=d rows=24 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-cause-scope: scope=s10 bucket=d rows=17 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-cause-scope: scope=s14 bucket=d rows=277 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=s15 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause-scope: scope=s16 bucket=d rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=contradicts moved_to_d=control_contradicts b01_bucket=b
gc-c-cause: bucket=a scopes=none rows=0 band=0/0/0 evidence=none
gc-c-cause: bucket=b scopes=k38 rows=36 band=36/0/0 evidence=float_rounding,anchor_changed,terminal_changed
gc-c-cause: bucket=c scopes=none rows=0 band=0/0/0 evidence=none
gc-c-cause: bucket=d scopes=k15,k18,k19,k24,k27,k32,s1,s6,s9,s10,s14,s15,s16 rows=1178 band=26/966/186 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5,control_contradicts,offset_pass_2_of_2
gc-c-total: rows=1214 a=0 b=36 c=0 d=1178 attributed=36 unexplained=1178 sum_ok=yes
gc-c-groups-outside-b01: scopes=s2,s5,s8,s13

**Reading note, stated before any conclusion is drawn from the lines above.** The pinned rule sends a (b) scope that moved in the control pair to (d) `control_contradicts` when the c0-to-c1 output holds ANY `gc-c-c01-offset ... pass=no` line for it (`parse_c01` reads `pass=no`). Every one of the ten scopes it moved this way (k15, k18, k19, k24, k27, k32, s1, s14, s15, s16) has exactly one such line, and it is the single mark-day stretch with `cv=undefined qualifying=1`: a stretch with one qualifying day has no coefficient of variation and cannot fail a test. Every stretch of those ten with a defined coefficient of variation passes (5 of 5 for k15 and s14, 2 of 2 for the other eight, cv from 1.2e-11 to 1.4e-9 against the 1e-4 bound). The b0-to-b1 side treats the same single-day stretch as not counted (`offset_pass_2_of_2`). So the 1178 in (d) is produced by how the pinned script reads an undefined stretch, and it contradicts the control pair's own bucketing of the same ten scopes by `attribute.py` (b, above). The script is not edited (its hash is pinned and equals plan 02's). The alternative reading, computed by the SAME unchanged script on a copy of the c0-to-c1 output with the `cv=undefined` offset lines filtered out, is printed below under its own prefix and is not the attribution of record. Which reading the phase adopts is an open founder question, in the report.

Alternative reading (not the attribution of record; same script, filtered input):

gc-c-alt-cause-scope: scope=k15 bucket=b rows=277 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k18 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k19 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k24 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k27 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k32 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=k38 bucket=b rows=36 b01_evidence=float_rounding,anchor_changed,terminal_changed control=quiet moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=s1 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=s6 bucket=d rows=31 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-alt-cause-scope: scope=s9 bucket=d rows=24 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-alt-cause-scope: scope=s10 bucket=d rows=17 b01_evidence=none control=quiet moved_to_d=no b01_bucket=d
gc-c-alt-cause-scope: scope=s14 bucket=b rows=277 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=s15 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause-scope: scope=s16 bucket=b rows=69 b01_evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2 control=recurs moved_to_d=no b01_bucket=b
gc-c-alt-cause: bucket=a scopes=none rows=0 band=0/0/0 evidence=none
gc-c-alt-cause: bucket=b scopes=k15,k18,k19,k24,k27,k32,k38,s1,s14,s15,s16 rows=1142 band=48/966/128 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5,offset_pass_2_of_2,float_rounding
gc-c-alt-cause: bucket=c scopes=none rows=0 band=0/0/0 evidence=none
gc-c-alt-cause: bucket=d scopes=s6,s9,s10 rows=72 band=14/0/58 evidence=none
gc-c-alt-total: rows=1214 a=0 b=1142 c=0 d=72 attributed=1142 unexplained=72 sum_ok=yes
gc-c-alt-groups-outside-b01: scopes=s2,s5,s8,s13

## Result lines (Task 3: book b3 re-read on c1, the D-12 or D-13 verdict)

`b3_replay.py --c1` run on the real c1 capture for the first time (plan 03 had only exercised it on a synthetic directory). Its c1 loader read the wrong file shapes and failed with a KeyError; the fix is in Deviations. The output is `~/.cache/quantalyze/residchurn/b3/c1.out`; the neuter run on the same inputs (k15's pre-window flow moved onto its first return day) flips the replay to `flags=none trustworthy=true`, so the replay can say yes as well as no.

gc-c-b3-venues: FULL_HISTORY_VENUES=deribit,mt5 pinned=yes
gc-c-b3-key: capture=c1 key=C venue=deribit full_history=yes first=2023-06-28 last=2026-10-26 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-key: capture=c1 key=k4 venue=deribit full_history=yes first=2024-12-07 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-key: capture=c1 key=k8 venue=mt5 full_history=yes first=2025-10-17 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-key: capture=c1 key=k10 venue=deribit full_history=yes first=2025-09-27 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-key: capture=c1 key=k14 venue=mt5 full_history=yes first=2026-07-29 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-key: capture=c1 key=k15 venue=bybit full_history=no first=2026-01-23 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=0 out_of_window_flows=1
gc-c-b3-xcheck: capture=c1 key=k15 replay=1 formula=1 agree=yes
gc-c-b3-key: capture=c1 key=k35 venue=mt5 full_history=yes first=2026-07-28 last=2026-11-06 pre_window_flows=1 post_window_flows=0 opening_run=1 out_of_window_flows=0
gc-c-b3-replay: capture=c1 key=k15 inception=false flags=out_of_window_flows:1 reasons=out_of_window_flow trustworthy=false
gc-c-b3-replay: capture=c1 key=k15 inception=true flags=inception_unreconciled_flows:1 reasons=inception_unreconciled trustworthy=false implied_start_share=0.0082 band=0.0001
gc-c-b3-stored: capture=c1 book=b3 trust=false reasons=out_of_window_flow,window_truncated other_blocking=none
gc-c-b3-proxy: capture=c1 book=b3 key_inputs_mismatch=no
gc-c-b3-truncated: capture=c1 book=b1 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-truncated: capture=c1 book=b2 keys=8 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-truncated: capture=c1 book=b3 keys=7 predicted=yes stored=yes agree=yes trustworthy=false
gc-c-b3-truncated: capture=c1 book=b4 keys=1 predicted=no stored=no agree=yes trustworthy=true
gc-c-b3-truncated: capture=c1 book=b5 keys=3 predicted=yes stored=yes agree=yes trustworthy=true
gc-c-b3-truncated: capture=c1 book=b6 keys=2 predicted=yes stored=no agree=no trustworthy=true
gc-c-b3-truncated: capture=c1 book=b7 keys=7 predicted=yes stored=yes agree=yes trustworthy=true

gc-c-b3-verdict: capture=c1 window_truncated=unexplained out_of_window_flow=correct other_blocking=none trust=false d13=open
gc-c-b3-d12: reopened=yes reason=component_disagrees

How the verdict lines were composed, by the plan's rule. `out_of_window_flow` is `correct`: b3's stored c1 reasons carry it, the k15 key line reads `full_history=no out_of_window_flows=1`, the six other keys read 0, the replay with `inception=false` reads `flags=out_of_window_flows:1`, and the replay with `inception=true` reads `inception_unreconciled` with an implied-start share of 0.0082 against the band 0.0001 (outside the band: extending the venue list would not green the book). `window_truncated` is `unexplained`: b3's own line agrees (`predicted=yes stored=yes`), but six of seven truncation lines agree and the b6 line reads `predicted=yes stored=no agree=no`, the same line as on b1 and b0. Plan 03's prediction rule is not amended (founder D-14, 2026-11-07), so the verdict starts from `unexplained`. `other_blocking=none`, `trust=false`. Routing (1): a reason `unexplained` gives `reopened=yes`; the k15 `inception=true` share is not inside the band (0.0082 is above 0.0001), so the reason is `component_disagrees`. The component that disagrees is b6's truncation line, not b3's; b3's own truncation line agrees and its stored curve holds all its members (plan 03). That is a fact about the rule's reach, stated so the re-open is not read as a defect found in b3.

## Result lines (D-14: why the compose leaves a key out of book b6's curve)

Founder D-14 (2026-11-07): book b6's stored curve leaving out k20's days is its own finding, investigated read-only from stored rows already in scratch plus the compose code, a code path named only under plan 05's evidence rule, with its limits. No PROD read was made. Labels, ISO days and counts only.

gc-c-d14-book: capture=b0 book=b6 keys=k18,k20 return_days=194 curve_first=2026-02-28 curve_last=2026-11-04 flags=sole_key reasons=none trust=true return_days_covered_by_no_member=0
gc-c-d14-key: capture=b0 book=b6 key=k18 first=2026-02-28 last=2026-11-04 days=195 days_inside_book_returns=194 book_equals_key=194/194 key_nonzero_inside=176 anchor_read_day=2026-11-05
gc-c-d14-key: capture=b0 book=b6 key=k20 first=2026-01-22 last=2026-07-20 days=180 days_inside_book_returns=99 book_equals_key=0/99 key_nonzero_inside=99 anchor_read_day=2026-07-20
gc-c-d14-book: capture=b0 book=b5 keys=k19,k34,k37 return_days=193 curve_first=2026-02-28 curve_last=2026-11-04 flags=degraded,departed_history_included,skipped_nonpositive_denominator,sole_key,window_truncated reasons=classified_rotation,window_truncated trust=true return_days_covered_by_no_member=0
gc-c-d14-key: capture=b0 book=b5 key=k19 first=2026-08-02 last=2026-11-04 days=95 days_inside_book_returns=94 book_equals_key=94/94 key_nonzero_inside=77 anchor_read_day=2026-11-05
gc-c-d14-key: capture=b0 book=b5 key=k34 first=2026-01-22 last=2026-07-20 days=180 days_inside_book_returns=99 book_equals_key=0/99 key_nonzero_inside=99 anchor_read_day=2026-07-20
gc-c-d14-key: capture=b0 book=b5 key=k37 first=2026-02-28 last=2026-06-07 days=100 days_inside_book_returns=99 book_equals_key=99/99 key_nonzero_inside=98 anchor_read_day=2026-07-18
gc-c-d14-book: capture=b1 book=b6 keys=k18,k20 return_days=195 curve_first=2026-02-28 curve_last=2026-11-05 flags=sole_key reasons=none trust=true return_days_covered_by_no_member=0
gc-c-d14-key: capture=b1 book=b6 key=k18 first=2026-02-28 last=2026-11-05 days=196 days_inside_book_returns=195 book_equals_key=195/195 key_nonzero_inside=177 anchor_read_day=2026-11-06
gc-c-d14-key: capture=b1 book=b6 key=k20 first=2026-01-22 last=2026-07-20 days=180 days_inside_book_returns=99 book_equals_key=0/99 key_nonzero_inside=99 anchor_read_day=2026-07-20
gc-c-d14-book: capture=b1 book=b5 keys=k19,k34,k37 return_days=194 curve_first=2026-02-28 curve_last=2026-11-05 flags=degraded,departed_history_included,skipped_nonpositive_denominator,sole_key,window_truncated reasons=classified_rotation,window_truncated trust=true return_days_covered_by_no_member=0
gc-c-d14-key: capture=b1 book=b5 key=k19 first=2026-08-02 last=2026-11-05 days=96 days_inside_book_returns=95 book_equals_key=95/95 key_nonzero_inside=78 anchor_read_day=2026-11-06
gc-c-d14-key: capture=b1 book=b5 key=k34 first=2026-01-22 last=2026-07-20 days=180 days_inside_book_returns=99 book_equals_key=0/99 key_nonzero_inside=99 anchor_read_day=2026-07-20
gc-c-d14-key: capture=b1 book=b5 key=k37 first=2026-02-28 last=2026-06-07 days=100 days_inside_book_returns=99 book_equals_key=99/99 key_nonzero_inside=98 anchor_read_day=2026-07-18
gc-c-d14-same-series: keys=k20,k34 common_days=180 equal_1e-12=179/180
gc-c-d14-c1: capture=c1 book=b6 predicted=yes stored=no agree=no trustworthy=true gap_unchanged_since=b0
gc-c-d14-code: book=b6 function=allocator_equity_derive.py:allocator_equity_curve behaviour=window_truncated_computed_over_the_keys_handed_in produces=b6_stored_no_window_truncated_with_one_key_handed_in meets_rule_2_and_3=yes
gc-c-d14-code: book=b6 function=job_worker.py:departed_history_inclusion behaviour=departed_key_counted_only_when_decision_says_included produces=departed_key_absent_from_book_with_no_naming_token reasons_in_function=owner_excluded,account_unknown,no_returns,same_account_bound separated=no none_picked meets_rule_2_and_3=yes
gc-c-d14-rule: scope=b6 rule_1=not_applicable_no_movement rule_4=not_applicable_no_movement reason_level_naming=no needs_read=owner_key_row_of_k20 done_here=no
gc-c-d14-read-needed: table=key_list_of_the_owner_of_b6 key=k20 columns=history_inclusion,venue_account_id,account_share_kind,disconnected_at,sync_status,is_active read_only=yes done_here=no

Stored facts, in order of strength.

1. **b6's stored returns are k18's, on every day, including the days k20 reports.** The book's return equals k18's stored daily return on 195 of 195 days (194 of 194 on b0) to 1e-12, and the book's return equals k20's on 0 of the 99 days that lie inside k20's own window, on all 99 of which k20's return is nonzero. The compose therefore counted k18 alone. The stored flags are `sole_key` and nothing else, the stored reasons are empty, and no omission token names k20. The curve begins on k18's first day (2026-02-28) and k20's own window starts on 2026-01-22.
2. **The same happens in b5, to the same kind of key.** b5's returns equal k37's on 99 of 99 days and k19's on 95 of 95, and k34's on 0 of 99. k34's stored series equals k20's on 179 of 180 days (the same Bybit account under two logins, or one series copied; the rows cannot say which), and both end on 2026-07-20 with their last key-inputs read on that day. b5 carries `departed_history_included` and `window_truncated` and b6 carries neither, which fits b5 counting a departed OKX key (k37, ending 2026-06-07) and b6 counting no departed key.
3. **b6 agrees with itself.** `window_truncated` is computed over the keys that reach the curve, and b6's curve holds one key. Plan 03's prediction ranged over every member key's stored window, k20 included, so it predicted a truncation the compose had no key to make. That is the whole of the b6 disagreement on the stored evidence.

The code path, under plan 05's rule (a function named by file and function, and its stated behaviour producing the kind of difference observed). Rules (1) and (4) of that rule are about a movement between two worker commits and a control that confirms it; b6's gap is one standing behaviour on b0, b1 and c1 (the c1 truncation line is unchanged), so neither has an object here and nothing is claimed from them.

- `allocator_equity_derive.py:allocator_equity_curve` computes `window_truncated` over the per-key equity curves it is handed (`anchored` is the keys with a level). A key that is not handed in cannot make the reason. Its stated behaviour produces b6's `reasons=none`.
- `job_worker.py:departed_history_inclusion` decides which departed keys the book counts and until when, and the derive hands the compose only the keys it includes (`departed_end_by_key`). Its docstring gives the ways a departed key with returns is left out: the owner's `exclude`, an unknown account (excluded by default unless the owner includes it), and a same-account bound that leaves no counted day. Its stated behaviour produces a departed key present in the stored key inputs and absent from the book without any token naming it.

**The reasons inside `departed_history_inclusion` are not separated, and none is picked.** Which one applies to k20 depends on that key's row in the owner's key list (`history_inclusion`, `venue_account_id`, `account_share_kind`, `disconnected_at`, `sync_status`, `is_active`), which is not in scratch. The read that would separate them is a read-only select of those six columns for the one key, by its id, from the PROD key table; it was not made (no PROD read is allowed in this plan) and the finding stands without it as a function-level naming, not a reason-level one. Whether the silent omission of a departed Bybit key's history from a book is intended is not decided here: the stored book names no left-out key, and whether that is a defect is the founder's call (recorded as an open question in the report). It does not touch b3.

## Performance

- **Duration:** about 25 min (resume after the orchestrator's row reads at 03:13:46Z)
- **Completed:** 2026-11-07T03:50Z (approx.)
- **Tasks:** 3 (Task 1, the orchestrator's row reads, was verified here; Tasks 2 and 3 executed)
- **Files modified:** 2 tracked (this SUMMARY and `202-REPORT.md`); scratch under `~/.cache/quantalyze/residchurn`

## Accomplishments

- **Task 1 verified before use.** All 14 row files, `marker.json` and `final.json` exist and are non-empty, the marker names PRODUCTION, and `gen_sql.py lint` reads 0 violations with `sha256_d=7/7`. The extra `marker-taken.txt` is kept and ignored. `check_capture.py --kind rows` passes: 15 of 15 results recompute against PROD (14 reads and the final query), every read bound to c1.
- **Criterion 1 answered on a valid pair.** Stored values move across a deploy-free nightly: 14 scopes, 1193 values by 188's exact rule, ten of the scopes (the Bybit pair and the OKX eight) in bucket (b) on changed inputs and a constant additive offset, four strategies (s2, s5, s8, s13) in (d) with the offset test failing and every changed day in the US-rule summer (their c0 rows were written by worker commit 099a9f166947, not the commit that wrote c1; s2 also lost 29 winter rows).
- **The 1214 attributed under the pinned rule, with its limit stated.** The rule's output is b 36, d 1178; it reads one undefined single-day stretch per scope as a contradiction. The alternative reading is b 1142, d 72. Both are in the report; neither was chosen.
- **b3 re-read on c1.** `out_of_window_flow` correct again, `window_truncated` unexplained on b6's line, trust false, D-12 routed to `reopened=yes reason=component_disagrees`.
- **D-14 investigated read-only.** b6's stored returns are k18's on every day, k20 contributes on none, and the compose code that produces this is named at function level; the reason inside the function is not separated.

## Task Commits

1. **Task 1: orchestrator reads (checkpoint, human-action)** - no commit; resumed with "rows saved"
2. **Task 2: rows bound to c1, c0-to-c1 attribution, predictions 2 and 3, the final attribution** - `aa6944253` (test)
3. **Task 3: b3 on c1, the D-12 routing, D-14, the phase report** - `eecda8381` (test)

**Plan metadata:** the `docs(202-07)` commit that carries this final SUMMARY with STATE and ROADMAP (not counted in `commits:`, which is measured to the Task 3 commit).

## Files Created/Modified

Tracked: this SUMMARY and `.planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md`. Untracked scratch under `~/.cache/quantalyze/residchurn`: `bin/assemble_c1.py` (12 self-test cases, four mutants each turn it RED), `bin/c01_signature.py`, `bin/d14_b6.py` (each with `--self-test`), `c1rows/keys.json` and `strats.json`, `attr/inputs-c1.json`, `attr/c0-c1.out`, `attr/c01-signature.out`, `attr/final.out`, `b3/c1.out`, `b3/c1-verdict.txt`, `b3/d14.out`. Edited scratch scripts: `bin/check_capture.py` (rows kind) and `bin/b3_replay.py` (c1 loader). The inputs file `attr/inputs-c1.json` holds balances and stays in scratch. `final_attribution.py` was not edited.

## Decisions Made

See `key-decisions`. The one that matters most: the executor ran the pinned rule unchanged even though its output contradicts the control pair's own bucketing, and surfaced the contradiction rather than editing a hashed rule or picking a reading.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in a scratch script] `check_capture.py --kind rows` could not run on the saved files**
- **Found during:** Task 2, first run of the plan's own check
- **Issue:** the rows kind looked for `r_rows_<label>.json` while Task 1 saves `<label>.json`, printed `marker=n/a`, and so could never print the `marker=PRODUCTION` the verify requires; it also did not require `marker.json` and `final.json` or that every moved scope has a read.
- **Fix:** the rows kind reads `marker.json` and `final.json` (both required), accepts `<label>.json` and `r_rows_<label>.json`, and fails if a label in `c1/moved.json` has no read. Five self-test cases were added first and failed (RED), then passed. No saved file was edited.
- **Files modified:** `~/.cache/quantalyze/residchurn/bin/check_capture.py` (untracked)

**2. [Rule 1 - Bug in a scratch script] `b3_replay.py --c1` read the wrong file shapes**
- **Found during:** Task 3, first run on the real c1 capture (KeyError on `api_key_id`)
- **Issue:** plan 03 exercised the c1 mode only on a synthetic directory built from b1. The real `c1/keys.json` and `c1/ki.json` are the `d_keys.sql` and `d_ki.sql` aggregates (`scope`, `first`, `last`; `scope` is the allocator id).
- **Fix:** the loader reads those shapes. Verified by the run on c1 (every window cross-check inside the loader passes) and by the neuter run, which flips k15's replay to `flags=none`.
- **Files modified:** `~/.cache/quantalyze/residchurn/bin/b3_replay.py` (untracked)

**3. [Process] TDD.** The scripts are untracked scratch, so RED and GREEN could not be separate repo commits (the plan 02 and 05 precedent). `assemble_c1.py`: RED was the self-test against a stub whose `build` raises, and against three mutants (no prefix check, no cut, no read) that each turned it RED; GREEN is its 12 cases. `check_capture.py`: RED then GREEN as in deviation 1. `c01_signature.py` and `d14_b6.py` each have a self-test.

---

**Total deviations:** 2 auto-fixed (Rule 1, both in scratch scripts), 1 process note
**Impact on plan:** none on a verdict; both fixes were needed for the plan's own commands to run on the real captures.

## Issues Encountered

- **The pinned control rule's reading of an undefined stretch** (see the reading note above and the report): not an execution failure, a measured disagreement between the rule's text and the plan's wording ("a moved stretch failing the offset test"). Surfaced as an open founder question.
- **Plan 03's prediction rule gives `unexplained` on b6's line**, so D-12 re-opens by the plan's routing although the line belongs to b6 and b3's own line agrees.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or schema surface was added; no PROD, Railway, Keychain or `q.sh` call was made by this executor (the row reads were the orchestrator's). The SUMMARY and the report hold labels, ISO times, counts and public commit ids; the uuid, home-path and balance gates print nothing on either file.

## Limits

- See `202-REPORT.md` `## Limits`: assumption A1 not established; no strategy derive replay; the 11:25:40Z derive cleared; 185-BOOK-CUMULATIVE-UNEXPLAINED not owned; the D-04 ledger half measured from pre to c1 and inferred from c0 to pre.
- `requirements-completed` above copies the plan's field as the template requires. `REQUIREMENTS.md` was not changed by this plan: RESID-02 is not closed (D-12 re-opened), and closing either requirement is for the phase verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 08's gate needs the founder: `gc-c-b3-d12: reopened=yes reason=component_disagrees`, with the open questions in `202-REPORT.md` (bucket wording for the worker clock setting, how the pinned rule reads a one-day stretch, D-12 versus D-13, b6's omitted departed key).
- D-05's hold on merges touching `analytics-service/` or `supabase/migrations/**` lifted when c1 was taken and the pair was valid (plan 06).

## TDD Gate Compliance

The plan is `type: execute` with `tdd="true"` on Task 2. `test(202-07)` precedes any `feat(202-07)`; there is no `feat` commit because every deliverable is a measurement committed as its result lines (the scripts are untracked scratch). `gsd_run check tdd-red-evidence` was not run: the self-tests print their own format, which the classifier does not read.

## Self-Check: PASSED

- Scratch files exist and are non-empty: `bin/assemble_c1.py`, `bin/c01_signature.py`, `bin/d14_b6.py`, `c1rows/keys.json` and `strats.json`, `attr/inputs-c1.json`, `attr/c0-c1.out`, `attr/c01-signature.out`, `attr/final.out`, `b3/c1.out`, `b3/d14.out`.
- Commits `aa6944253` and `eecda8381` are ancestors of HEAD; `git rev-list --count` from the ledger base reads 2.
- Task 2 and Task 3 verify commands exit 0 (Task 3 expecting `reopened=yes reason=component_disagrees` recomputed from the verdict line); the uuid, home-path and balance gates print nothing on this file or the report; `git status --porcelain -- analytics-service supabase` prints nothing.
- Self-tests re-run at the end: `assemble_c1.py` (12 cases), `final_attribution.py` (7, hash prefix 8a62ca3b1215 unchanged), `check_capture.py` (11 original and 6 rows cases), `c01_signature.py`, `d14_b6.py`, `attribute.py`, `compare_prefix.py` (all ok).

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-07*

