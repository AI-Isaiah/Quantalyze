---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 02
subsystem: testing
tags: [attribution, additive-offset-oracle, size-bands, control-rule, sha-pinned-rule, scratch]

requires:
  - phase: 202-01
    provides: b1 rows stand for c0 on all 54 digest scopes; rc.py helpers (labels, read_n, scope_digest); check_capture.py
  - phase: 188-tinybase
    provides: b0 and b1 row-level captures, map.json labels, diff.py comparison rule, 188-16 gc-r-diff counts
provides:
  - 188's 'changed' rule reproduced value for value on b0 and b1 (1214 over 54 scopes, 14 changed scopes) with D-09 size bands beside it
  - the 1214 split into D-08 buckets on b0-to-b1 evidence (b 935, d 279, a 0, c 0), with the unexplained scopes named
  - the additive NAV-offset oracle, shown able to fail
  - final_attribution.py, the control rule plan 07 applies, written and sha256-pinned before any c1 number exists
affects: [202-05, 202-06, 202-07, 202-08]

actuals:
  tokens: 22070
  tasks: 3
  commits: 3
plan_head_before: ad64c6d17d499a534bcbaf08fe672f60fa65bf6a
plan_head_after: 1dfbbf465ed59fed3a4250b194153c24869ad2cd

tech-stack:
  added: []
  patterns:
    - "every gate script is shown RED on a broken input before it is trusted (stub, mutated copy, perturbed value)"
    - "a rule that must not bend to the data is hashed and recorded before the data exists"

key-files:
  created:
    - ~/.cache/quantalyze/residchurn/bin/attribute.py
    - ~/.cache/quantalyze/residchurn/bin/inputs.py
    - ~/.cache/quantalyze/residchurn/bin/final_attribution.py
    - ~/.cache/quantalyze/residchurn/attr/b0-b1.out
    - ~/.cache/quantalyze/residchurn/attr/inputs-b0.json
    - ~/.cache/quantalyze/residchurn/attr/inputs-b1.json
  modified: []

key-decisions:
  - "Offset stretches are cut at the key's first mark day S: days before S are the realized-basis era the additive-offset model describes, day S is a boundary row, not a member (nav_marks_apply rule 2)"
  - "A strategy with no strategy-to-key map is unlinked and lands in (d); it is never linked by guesswork"
  - "In the control rule, contradicts is judged for (b) scopes only and is checked before unbound; inconsistent control inputs are FATAL"

requirements-completed: [RESID-01]

coverage:
  - id: D1
    description: "188's exact changed rule reproduced on b0 and b1 (14 changed scopes, 1214 values, 54 scopes) with D-09 size bands 62/966/186 beside it"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I attribute.py --self-test (band bounds, last-day edge, reverted value exits 1); attribute.py --pair b01 ... --expect-summary 188-16-SUMMARY.md prints reproduces_188_16=yes"
        status: pass
    human_judgment: false
  - id: D2
    description: "clusters, the additive-offset oracle and the D-08 buckets for b0 to b1; every one of the 1214 values in exactly one bucket"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I attribute.py --self-test (29 cases) and --neuter (went_red=yes); bucket-total sum=1214"
        status: pass
    human_judgment: true
    rationale: "Where an offset stretch ends at the mark day was fixed after the literal reading had been seen to fail (see Deviations); the reviewer should confirm that reading of the mechanism."
  - id: D3
    description: "final_attribution.py, the control rule of the final attribution, self-tested and sha256-pinned before any c1 number exists"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I final_attribution.py --self-test (7 cases); six mutated copies of the rule each turn the self-test RED; gc-c-final-rule hash equals the file on disk"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-11-06
status: complete
---

# Phase 202 Plan 02: Attribution of the 1214 and the control rule Summary

**188's 1214 changed values are reproduced exactly under its own rule (62 low, 966 mid, 186 high), 935 of them are attributed to a re-roll from a moved NAV terminal by a mechanism test that has been seen to fail, 279 stay unexplained by scope, and the control rule plan 07 applies is written and hashed before any c1 number exists.**

Measured lines. Each is one whole line from `~/.cache/quantalyze/residchurn/attr/b0-b1.out` (or the hash of the rule); labels only, no balances, ids or paths.

gc-c-b01-diff: scope=k15 compared=285 changed=277 band_low=6 band_mid=271 band_high=0 first_changed=2026-01-23 last_changed=2026-10-26 max_abs=4.5e-07 lastday_moved=no
gc-c-b01-diff: scope=k18 compared=194 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.1e-04 lastday_moved=no
gc-c-b01-diff: scope=k19 compared=94 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.1e-04 lastday_moved=no
gc-c-b01-diff: scope=k24 compared=94 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.2e-04 lastday_moved=no
gc-c-b01-diff: scope=k27 compared=194 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.1e-04 lastday_moved=no
gc-c-b01-diff: scope=k32 compared=194 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.2e-04 lastday_moved=no
gc-c-b01-diff: scope=k38 compared=162 changed=36 band_low=36 band_mid=0 band_high=0 first_changed=2026-05-28 last_changed=2026-10-23 max_abs=2.0e-16 lastday_moved=no
gc-c-b01-diff: scope=s1 compared=254 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.1e-04 lastday_moved=no
gc-c-b01-diff: scope=s6 compared=96 changed=31 band_low=9 band_mid=0 band_high=22 first_changed=2026-07-29 last_changed=2026-10-28 max_abs=9.4e-02 lastday_moved=no
gc-c-b01-diff: scope=s9 compared=380 changed=24 band_low=3 band_mid=0 band_high=21 first_changed=2025-10-30 last_changed=2026-08-08 max_abs=3.7e-02 lastday_moved=no
gc-c-b01-diff: scope=s10 compared=213 changed=17 band_low=2 band_mid=0 band_high=15 first_changed=2026-04-06 last_changed=2026-08-08 max_abs=3.9e-02 lastday_moved=no
gc-c-b01-diff: scope=s14 compared=285 changed=277 band_low=6 band_mid=271 band_high=0 first_changed=2026-01-23 last_changed=2026-10-26 max_abs=4.5e-07 lastday_moved=no
gc-c-b01-diff: scope=s15 compared=190 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.0e-04 lastday_moved=no
gc-c-b01-diff: scope=s16 compared=188 changed=69 band_low=0 band_mid=53 band_high=16 first_changed=2026-08-02 last_changed=2026-10-26 max_abs=1.2e-04 lastday_moved=no
gc-c-b01-total: scopes=54 changed_scopes=14 changed=1214 band_low=62 band_mid=966 band_high=186 reproduces_188_16=yes
gc-c-b01-cluster: cluster=A scopes=k15,s14 rows=554 identical_series=yes
gc-c-b01-cluster: cluster=B scopes=k18,k19,k24,k27,k32,s1,s15,s16 rows=552 identical_series=no
gc-c-b01-cluster: cluster=C scopes=k38 rows=36 identical_series=no
gc-c-b01-cluster: cluster=D scopes=s6 rows=31 identical_series=no
gc-c-b01-cluster: cluster=E scopes=s9 rows=24 identical_series=no
gc-c-b01-cluster: cluster=F scopes=s10 rows=17 identical_series=no
gc-c-b01-inputs: key=k15 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k18 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k19 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k24 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k27 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k32 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=k38 anchor_changed=yes nav_mark_changed=yes terminal_changed=yes flows_changed=no marks_since=2026-10-26
gc-c-b01-inputs: key=unlinked scope=s1 link=unlinked
gc-c-b01-inputs: key=unlinked scope=s6 link=unlinked
gc-c-b01-inputs: key=unlinked scope=s9 link=unlinked
gc-c-b01-inputs: key=unlinked scope=s10 link=unlinked
gc-c-b01-inputs: key=unlinked scope=s15 link=unlinked
gc-c-b01-inputs: key=unlinked scope=s16 link=unlinked
gc-c-b01-offset: scope=k15 stretch=2026-01-23..2026-01-24 days=2 cv=1.2e-11 pass=yes qualifying=2
gc-c-b01-offset: scope=k15 stretch=2026-01-26..2026-01-27 days=2 cv=1.8e-10 pass=yes qualifying=2
gc-c-b01-offset: scope=k15 stretch=2026-01-29..2026-08-19 days=203 cv=1.4e-09 pass=yes qualifying=203
gc-c-b01-offset: scope=k15 stretch=2026-08-21..2026-09-07 days=18 cv=1.3e-09 pass=yes qualifying=18
gc-c-b01-offset: scope=k15 stretch=2026-09-09..2026-10-25 days=47 cv=1.0e-09 pass=yes qualifying=47
gc-c-b01-offset: scope=k15 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k15 stretch=2026-09-09..2026-10-26 days=48 cv=5.0e-02 pass=no qualifying=48
gc-c-b01-offset: scope=k18 stretch=2026-08-02..2026-08-19 days=18 cv=2.7e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=k18 stretch=2026-09-06..2026-10-25 days=50 cv=3.6e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=k18 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k18 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-b01-offset: scope=k19 stretch=2026-08-02..2026-08-19 days=18 cv=3.8e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=k19 stretch=2026-09-06..2026-10-25 days=50 cv=4.5e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=k19 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k19 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-b01-offset: scope=k24 stretch=2026-08-02..2026-08-19 days=18 cv=2.9e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=k24 stretch=2026-09-06..2026-10-25 days=50 cv=3.8e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=k24 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k24 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-b01-offset: scope=k27 stretch=2026-08-02..2026-08-19 days=18 cv=2.6e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=k27 stretch=2026-09-06..2026-10-25 days=50 cv=4.0e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=k27 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k27 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-b01-offset: scope=k32 stretch=2026-08-02..2026-08-19 days=18 cv=3.4e-12 pass=yes qualifying=18
gc-c-b01-offset: scope=k32 stretch=2026-09-06..2026-10-25 days=50 cv=3.3e-12 pass=yes qualifying=50
gc-c-b01-offset: scope=k32 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=k32 stretch=2026-09-06..2026-10-26 days=51 cv=1.4e-01 pass=no qualifying=51
gc-c-b01-offset: scope=k38 stretch=2026-05-28..2026-05-29 days=2 cv=3.3e-04 pass=no qualifying=2
gc-c-b01-offset: scope=k38 stretch=2026-05-31..2026-05-31 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-06-03..2026-06-03 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-06-08..2026-06-09 days=2 cv=2.8e-01 pass=no qualifying=2
gc-c-b01-offset: scope=k38 stretch=2026-06-14..2026-06-16 days=3 cv=5.6e-01 pass=no qualifying=3
gc-c-b01-offset: scope=k38 stretch=2026-06-23..2026-06-25 days=3 cv=9.2e-02 pass=no qualifying=3
gc-c-b01-offset: scope=k38 stretch=2026-06-29..2026-07-01 days=3 cv=1.5e-01 pass=no qualifying=3
gc-c-b01-offset: scope=k38 stretch=2026-07-03..2026-07-03 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-07-07..2026-07-07 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-07-13..2026-07-13 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-07-15..2026-07-15 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-07-27..2026-07-28 days=2 cv=1.0e-01 pass=no qualifying=2
gc-c-b01-offset: scope=k38 stretch=2026-08-03..2026-08-06 days=4 cv=7.7e-01 pass=no qualifying=4
gc-c-b01-offset: scope=k38 stretch=2026-08-11..2026-08-11 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-08-13..2026-08-13 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-08-17..2026-08-18 days=2 cv=3.0e-02 pass=no qualifying=2
gc-c-b01-offset: scope=k38 stretch=2026-09-14..2026-09-14 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-10-05..2026-10-05 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-10-08..2026-10-08 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-10-14..2026-10-14 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-10-18..2026-10-18 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset: scope=k38 stretch=2026-10-23..2026-10-23 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-skipped: scope=s1 reason=unlinked
gc-c-b01-offset-skipped: scope=s6 reason=unlinked
gc-c-b01-offset-skipped: scope=s9 reason=unlinked
gc-c-b01-offset-skipped: scope=s10 reason=unlinked
gc-c-b01-offset: scope=s14 stretch=2026-01-23..2026-01-24 days=2 cv=1.2e-11 pass=yes qualifying=2
gc-c-b01-offset: scope=s14 stretch=2026-01-26..2026-01-27 days=2 cv=1.8e-10 pass=yes qualifying=2
gc-c-b01-offset: scope=s14 stretch=2026-01-29..2026-08-19 days=203 cv=1.4e-09 pass=yes qualifying=203
gc-c-b01-offset: scope=s14 stretch=2026-08-21..2026-09-07 days=18 cv=1.3e-09 pass=yes qualifying=18
gc-c-b01-offset: scope=s14 stretch=2026-09-09..2026-10-25 days=47 cv=1.0e-09 pass=yes qualifying=47
gc-c-b01-offset: scope=s14 stretch=2026-10-26..2026-10-26 days=1 cv=undefined pass=no qualifying=1
gc-c-b01-offset-literal: scope=s14 stretch=2026-09-09..2026-10-26 days=48 cv=5.0e-02 pass=no qualifying=48
gc-c-b01-offset-skipped: scope=s15 reason=unlinked
gc-c-b01-offset-skipped: scope=s16 reason=unlinked
gc-c-b01-bucket: scope=k15 bucket=b rows=277 band=6/271/0 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5
gc-c-b01-bucket: scope=k18 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=k19 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=k24 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=k27 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=k32 bucket=b rows=69 band=0/53/16 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_2_of_2
gc-c-b01-bucket: scope=k38 bucket=b rows=36 band=36/0/0 evidence=float_rounding,anchor_changed,terminal_changed
gc-c-b01-bucket: scope=s1 bucket=d rows=69 band=0/53/16 evidence=none
gc-c-b01-bucket-why: scope=s1 reason=unlinked
gc-c-b01-bucket: scope=s6 bucket=d rows=31 band=9/0/22 evidence=none
gc-c-b01-bucket-why: scope=s6 reason=unlinked
gc-c-b01-bucket: scope=s9 bucket=d rows=24 band=3/0/21 evidence=none
gc-c-b01-bucket-why: scope=s9 reason=unlinked
gc-c-b01-bucket: scope=s10 bucket=d rows=17 band=2/0/15 evidence=none
gc-c-b01-bucket-why: scope=s10 reason=unlinked
gc-c-b01-bucket: scope=s14 bucket=b rows=277 band=6/271/0 evidence=anchor_changed,nav_mark_changed,terminal_changed,offset_pass_5_of_5
gc-c-b01-bucket: scope=s15 bucket=d rows=69 band=0/53/16 evidence=none
gc-c-b01-bucket-why: scope=s15 reason=unlinked
gc-c-b01-bucket: scope=s16 bucket=d rows=69 band=0/53/16 evidence=none
gc-c-b01-bucket-why: scope=s16 reason=unlinked
gc-c-b01-bucket-total: a=0 b=935 c=0 d=279 sum=1214
gc-c-b01-neuter: scope=k15 stretch=2026-01-23..2026-01-24 cv_before=1.2e-11 cv_after=9.9e-01 went_red=yes
gc-c-final-rule: script_sha12=8a62ca3b1215 selftest=red-as-expected cases=7

## Accomplishments

- **188's rule reproduced (Task 1).** `attribute.py` copies `diff.py`'s `diff_scope` for the changed count: every stored base day strictly before the scope's last base day, changed when `new != old` on parsed floats, no tolerance. Against 188-16's `gc-r-diff` lines it asserts per-scope `changed` and `compared`, the scope count, the compared total and that unlisted scopes changed nothing, and exits 1 on any difference. It reproduces 14 changed scopes, 1214 values, 54 scopes. The D-09 bands sit beside it and never redefine it: low 62, mid 966, high 186, and the per-scope bands equal the research list. Band bounds are inclusive and the self-test feeds 1e-9, `nextafter(1e-9)`, 1e-6 and `nextafter(1e-6)`. A scope's own last baseline day is outside the comparison and is printed as `lastday_moved`. Reverting one value on a temp copy of b1 makes the asserting run exit 1.
- **Inputs, clusters, the oracle and the buckets (Task 2).** `inputs.py` normalises a `ki.json` or a saved `n_anchor` result into one json per key label (30 keys, no multi-book key in b0 or b1). `attribute.py` reads each key's input flags, forms six clusters (A: k15 with s14, identical series; B: the OKX eight, same 69 days; k38, s6, s9, s10 alone), runs the additive-offset oracle on every flow-free run of changed days, and assigns D-08 buckets by a rule fixed before any c1 number exists. Seven key scopes and s14 are (b): k15, s14, k18, k19, k24, k27, k32 on input change plus an offset test that passes on every defined stretch (CV 1e-9 to 1e-12 against the 1e-4 bound), k38 on float rounding with the key's anchor and terminal changed. Six strategy scopes (s1, s6, s9, s10, s15, s16) are (d) because no strategy-to-key map exists yet. Bucket counts sum to 1214 or the script exits 1.
- **The oracle can fail.** `--neuter` multiplies one moved value of the first passing stretch by 1.001 and requires CV of at least 1e-2: it reads 0.99. A pass-everything oracle makes the neuter exit 1 (self-test), and the sum gate is tested at 1214 and 1215.
- **The control rule (Task 3).** `final_attribution.py` applies, per scope, what the deploy-free pair says: (b) stays unless the pair's offset test contradicts it, (c) stays only if the scope did not move, (a) stays only if it moved again with a bound read, (d) carries over. The self-test covers the seven behaviours and was first run against a stub that assigns nothing. Six mutated copies (a always kept, c always kept, b never moved, sum gate off, unbound checked before contradicts, quiet read as unbound) each turn the self-test RED. Its sha256 prefix is the `gc-c-final-rule` line above; plan 07 refuses a copy that differs.

## Task Commits

1. **Task 1: 188's exact rule on b0 and b1, bands beside it** - `2ae5a1096` (test)
2. **Task 2: inputs, clusters, offset oracle, D-08 buckets** - `45cfe4c6f` (feat)
3. **Task 3: the control rule, hashed before c1** - `1dfbbf465` (feat)

**Plan metadata:** the `docs(202-02)` commit that adds this file, plus the STATE and ROADMAP commit after it.

The three scripts live in untracked scratch on purpose, so the tracked part of each commit is this SUMMARY growing by that task's measured lines.

## Files Created/Modified

- `~/.cache/quantalyze/residchurn/bin/attribute.py` - 188's rule, bands, clusters, offset oracle, buckets, `--neuter`, `--self-test` (29 cases)
- `~/.cache/quantalyze/residchurn/bin/inputs.py` - key_inputs normaliser for the ki and anchor forms, `--self-test`
- `~/.cache/quantalyze/residchurn/bin/final_attribution.py` - the control rule, `--self-test` (7 cases)
- `~/.cache/quantalyze/residchurn/attr/b0-b1.out`, `inputs-b0.json`, `inputs-b1.json` - outputs; the inputs files hold balances and never leave scratch (mode 600)

## Decisions Made

- **Stretches end at the mark day.** The oracle describes the realized-basis era, which `nav_marks_apply.py` rule 2 keeps at its realized value for every day before the key's first mark day S. Day S is booked against the realized level of the day before and is a boundary. `find_stretches` therefore starts a new run at S. A run is also cut at a flow day (dropped) and at an unchanged day.
- **No strategy-to-key guesswork.** Without `--strat-keys`, a strategy is linked only when its whole series equals exactly one key's series on both captures (s14 to k15). Everything else prints `key=unlinked` and is (d).
- **`contradicts` is judged for (b) scopes only and before `unbound`.** The offset test is (b)'s own mechanism test; for an (a) or (c) scope a failing offset line says nothing about its bucket. A failing line is never discarded for a read that cannot be bound. A scope that changed in the control pair but sits in no group is FATAL (groups.json and the c01 output disagree).
- **Neutral labels for unknown ids.** A key, strategy or book id 188 never labelled gets `uk<N>`, `us<N>` or `ub<N>`, so no id reaches any output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Spec gap] Where an offset stretch ends (the mark day)**
- **Found during:** Task 2 (offset oracle)
- **Issue:** The plan says to split the changed days into maximal runs of consecutive stored days with no flow day, and does not say where a run ends relative to the key's first mark day S. Read literally, the run that contains S fails the oracle for every moved key scope: CV 1.4e-01 for the OKX five and 5.0e-02 for k15 and s14 (the `gc-c-b01-offset-literal` lines). Cutting at S gives CV of 1e-9 to 1e-12 on the same days. I saw the literal result first, then fixed the construction; the 1e-4 threshold was not touched.
- **Fix:** `find_stretches` starts a new run at S. The mechanism of record is `nav_marks_apply.py` rule 2 and the research section "Why the OKX and Bybit rows move", which the plan's own read_first names; its day-S sentence is the reason, not the CV values. The literal reading is printed beside every affected scope so a reviewer can see both.
- **Sensitivity (stated so it can be judged):** under the literal reading the offset route would not hold for k15, k18, k19, k24, k27, k32 and s14 (899 rows), so (b) would be 36 rows (k38 by float rounding) and (d) 1178. Plan 02's own behaviour section ("the OKX eight and the Bybit two pass the offset test on every qualifying stretch") only holds under the cut.
- **Files modified:** `~/.cache/quantalyze/residchurn/bin/attribute.py`
- **Verification:** `--self-test` case `stretches_cut_at_flow_unchanged_and_mark_day`; `gc-c-b01-offset` and `gc-c-b01-offset-literal` lines above.
- **Committed in:** 45cfe4c6f

**2. [Rule 3 - Blocker, recorded not fixed] No strategy-to-key map yet, so six strategy scopes read (d)**
- **Found during:** Task 2 (bucket run)
- **Issue:** The plan's "Expected from research" puts the OKX eight in (b), but s1, s15 and s16 equal no key's series, and no `n_strat_keys` result exists before plan 04's pre read. By the plan's own rule such a strategy prints `key=unlinked` and is (d). The measured split is b 935 / d 279, not the research's 1142 / 72.
- **Fix:** none here, by design: plan 05 re-runs `attribute.py` on b0 and b1 with `--strat-keys "$RC/pre/strat_keys.json"`. The `--strat-keys` path is covered by a self-test with a synthetic mapping (a linked strategy leaves `unlinked` and gets a bucket; a bad chk is refused). Whether s1, s15 and s16 then pass the offset test with their linked key's flow days and mark day is not known today.
- **Files modified:** none
- **Committed in:** n/a

**3. [Note] Extra output lines and fields.** Beyond the plan's line shapes the script prints `gc-c-b01-offset-literal`, `-offset-skipped`, `-bucket-why`, `-neuter`, a trailing `qualifying=<n>` on each offset line, and one `gc-c-groups-outside-b01` line in the control rule. None starts with a prefix the plan counts. `b0-b1.out` holds one full run (diff, total, inputs, clusters, offsets, buckets, neuter) instead of an appended second run; it is a superset.

---

**Total deviations:** 2 recorded (1 spec gap fixed, 1 blocker recorded for plan 05), 1 note
**Impact on plan:** Deviation 1 changes which scopes are (b) and is flagged for the reviewer. Deviation 2 changes nothing in the rule; it is the missing input plan 05 already owns.

## Issues Encountered

- One combined mutation-test command was denied by the tool-permission check because it ended in a recursive scratch removal. Nothing ran and nothing was deleted; the mutation test was re-run as a script file without the removal. A small `mut` directory is left under the scratchpad.

## TDD Gate Compliance

The plan is `type: execute` with `tdd="true"` tasks, and the scripts are untracked scratch, so the RED evidence is the stub run recorded in the session, not a classifier-readable report. RED for Task 1 and Task 2 was the self-test against a stub that raised `NotImplementedError` (four band cases, then the task-2 cases, failing); RED for Task 3 was the self-test against a stub that assigns nothing (exit 1). `test(202-02)` precedes the two `feat(202-02)` commits. `gsd_run check tdd-red-evidence` was not run because these self-tests print their own format, which the classifier does not read.

## Limits

- The additive-offset physical origin (research assumption A1) is not claimed; bucket (b) rests on the re-roll from a moved terminal plus the constant-offset signature.
- The oracle uses flow days from the key's own `key_inputs` on both captures; a flow the payloads do not list would break a run and be read as a failed stretch, not as a flow.
- Unlinked strategies carry no offset evidence here (`offset-skipped`), so their (d) is "no evidence named by the rule", not "tested and failed".
- s6, s9 and s10 are (d) with `evidence=none`: their code-path evidence is plan 05's. Prediction 4 was scored held by plans 06 and 07, and review round 2 corrects that: it is not tested (corrected in review round 2): s6, s9 and s10 were not re-derived between c0 and c1 (latest derives 2026-11-06 00:25Z, 00:25Z and 01:25Z, all before c0), so "did not move" means no job wrote them, not that they survived a re-derive. Their `control=quiet` reading is untested; (c) is empty, so no pinned decision depends on it.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or schema was added; nothing touched PROD, Railway, Keychain or `q.sh`. The inputs files carry balances and stay in scratch; the SUMMARY passes the uuid, home-path and balance greps.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05 re-runs `attribute.py` on b0 and b1 with `--strat-keys "$RC/pre/strat_keys.json"` and `--evidence "$RC/codepath/evidence.json"`; the inputs files are already in `~/.cache/quantalyze/residchurn/attr/`.
- Plan 07 runs `final_attribution.py` unchanged after checking its sha256 prefix against `gc-c-final-rule` above, and runs `attribute.py --pair c01` with the same flags; the c01 output must carry a `gc-c-c01-total` line.
- No c1 number exists yet (`~/.cache/quantalyze/residchurn/c1` is absent), as this plan requires.

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-06*

## Self-Check: PASSED

- Scripts and outputs present under `~/.cache/quantalyze/residchurn/` (bin: attribute, inputs, final_attribution; attr: b0-b1.out, inputs-b0.json, inputs-b1.json).
- Task commits present on this branch: 2ae5a1096, 45cfe4c6f, 1dfbbf465 (3 commits measured from `plan_head_before` to `plan_head_after`; plan 04 commits interleave on the branch after `plan_head_after` and are not counted).
- The three plan verify commands and the acceptance greps pass; the SUMMARY holds no uuid, home path or balance.
