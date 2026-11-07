# Phase 202 review disposition

Three review rounds, each gsd-code-reviewer in parallel with silent-failure-hunter, MEDIUM and above. The findings live in `202-REVIEW.md`; the silent-failure hunts were returned as reports and are summarised here.

| Round | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | CR-01 Criterion 1 counted s2, s5, s8, s13 as no-code-change movement | critical | fixed (2963d0319): per-side writer table, judge run on the c0-c1 pair |
| 1 | CR-02 / SFH-1 vanished rows invisible to the changed counts | critical | fixed (2963d0319): vanished/appeared counted, reproduced against 188-16 |
| 1 | WR-01 / SFH-3 15-digit resolution | warning | fixed: stated limit (re-worded in round 2) |
| 1 | WR-02 / SFH-6 gate bound only n_*.json; ledger unbound | warning | fixed: gate binds every chk-bearing result (pre 6/6, c1 8/8) |
| 1 | WR-03 / SFH-5 nightly coverage vacuous on empty input | warning | fixed (residual in rounds 2 and 3) |
| 1 | WR-04 read-only lint bypassable | warning | fixed: tokenizer, INTO, function denylist, d_*.sql linted (31 files) |
| 1 | WR-05 offset test skips zero-to-nonzero | warning | not fixed: pinned rule lineage, no bucket changes |
| 1 | SFH-2 tautological bucket/sum gates; SFH-7 parse_c01 defaults | medium | not fixed: live in the pinned `final_attribution.py` (sha12 8a62ca3b1215, D-15) |
| 1 | SFH-4 k38 (b) route on flags true for 23 of 30 keys | medium | fixed: stated limit |
| 1 | SFH-8 judge (c)=0 by construction, no candidate check | medium | fixed: candidate-set fatal; residual in round 3 |
| 1 | SFH-9 b3_replay rowless members dropped, exception read as n/a | medium | fixed: members named, exception exits 1 |
| 1 | IN-01 to IN-05 | info | fixed; IN-06 not fixed (not triggered) |
| 2 | WR-R2-01 / F3 prediction 4 scored Held but untested | warning | fixed (0cff77c17): rescored "not tested"; gate prints matched M of N, skipped, not_rederived |
| 2 | WR-R2-02 circular 15-digit clause | warning | fixed (0cff77c17): measured distribution |
| 2 | F1 judge hard-coded reason literal | medium | fixed: commit list derived; residual WR-R3-03 |
| 2 | F2 b3_replay disagreement/refusal exit 0 | medium | fixed: exit 1 |
| 3 | WR-R3-02 06-SUMMARY frontmatter still said prediction 4 held | warning | fixed by the orchestrator (this commit) |
| 3 | WR-R3-01 / M1 `not_rederived` ignores job status (a later failed_final job reads as a re-derive) | warning | survivor of 3 rounds, routed: TODOS `202-KIT-RESIDUALS-01` (Phase 203 reuses the kit). The real capture is unaffected: all 47 c1 jobs are `done` |
| 3 | WR-R3-03 judge `reason=` token still a fixed string | warning | survivor, routed: TODOS `202-KIT-RESIDUALS-01`. True for today's table (every kind None) |
| 3 | M2 gate proves job completion, not a write | medium-low | routed: TODOS `202-KIT-RESIDUALS-01` |
| 3 | M3 subjects with no job row in pre invisible to coverage | medium-low | routed: TODOS `202-KIT-RESIDUALS-01` |

No finding changes a bucket total, a value count or a bucket assignment after round 1.
