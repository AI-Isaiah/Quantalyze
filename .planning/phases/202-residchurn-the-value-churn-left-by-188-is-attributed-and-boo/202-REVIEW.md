---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
reviewed: 2026-11-07T08:18:37Z
round: 3
round_1_reviewed: 2026-11-07T09:30:00Z
round_2_reviewed: 2026-11-07T08:00:13Z
depth: deep
files_reviewed: 37
files_reviewed_list:
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-CONTEXT.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-02-SUMMARY.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-05-SUMMARY.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-06-SUMMARY.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-07-SUMMARY.md
  - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-08-SUMMARY.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - TODOS.md
  - ~/.cache/quantalyze/residchurn/bin/rc.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/recompute_digest.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/gen_sql.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/check_capture.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/attribute.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/inputs.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/final_attribution.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/b3_replay.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/compare_prefix.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/deploy_proof.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/codepath.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/codepath_sig.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/codepath_xcheck.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/codepath_judge.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/assemble_c1.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/c01_signature.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/d14_b6.py (untracked)
  - ~/.cache/quantalyze/residchurn/bin/mcp_last.py (untracked)
  - ~/.cache/quantalyze/residchurn/sql/n_*.sql (untracked, 10 files)
  - ~/.cache/quantalyze/residchurn/sql/r_rows_*.sql (untracked, 14 files)
  - ~/.cache/quantalyze/residchurn/sql/d_*.sql + SHA256SUMS.d (untracked, pinned)
  - ~/.cache/quantalyze/residchurn/{attr,b3,codepath,deploy,c1,pre,rows,c1rows}/ outputs (untracked)
  - ~/.cache/quantalyze/residchurn/bin/codepath_writers.py (untracked, new in round 1 fixes)
  - ~/.cache/quantalyze/residchurn/codepath/{c0c1-writers,c0c1-derive,c0c1-judge}.out (untracked, round 2)
  - ~/.cache/quantalyze/residchurn/attr/{final-d15,c0-c1,b0-b1-evidence,c01-signature}.out (untracked, round 2)
  - ~/.cache/quantalyze/residchurn/codepath/{judge.out,c0c1-judge.out,clock-candidate.json} (untracked, regenerated round 3)
  - ~/.cache/quantalyze/residchurn/b3/{b0,b1}.out (untracked, regenerated round 3)
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
round_2_findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
round_1_findings:
  critical: 2
  warning: 5
  info: 6
  total: 13
status: issues_found
---

# Phase 202: Code Review Report

**Reviewed:** 2026-11-07T09:30:00Z
**Depth:** deep
**Files Reviewed:** 32 (tracked planning docs plus the untracked scratch kit that produced every number)
**Status:** issues_found

## Summary

Scope: the tracked diff `origin/main...HEAD` (planning docs only, no source under `analytics-service/` or `supabase/`), plus the untracked scripts, SQL kit and saved outputs under `~/.cache/quantalyze/residchurn/`. Every check below ran locally on the saved files. I made no PROD read and used no MCP, remote CLI or Keychain.

**I re-derived these and they hold:**
- The pinned `final_attribution.py` run is byte-equal to `attr/final.out`: b 36, d 1178.
- The D-15 record reproduces from the same unchanged script on a copy of `attr/c0-c1.out` with the `cv=undefined` offset lines removed: `a=0 b=1142 c=0 d=72`, band 48/966/128.
- The REPORT's 1214 table sums are correct, and so are the band sums (62/966/186 total, 48/966/128 for b).
- Each moved book holds exactly one moved member key, and b7 holds none.
- `gen_sql lint`: 24 files, 0 violations, `sha256_d=7/7`.
- `check_capture --kind rows`: 15/15, PRODUCTION.
- Every chk-bearing saved result in `pre/`, `c1/` and `rows/` recomputes, including `ledger.json`, which no script checks.
- Every script's `--self-test` passes, and `attribute.py` found the real 188-16 SUMMARY as its expectation.
- Planning hygiene passes (rule 1, 6, 7 OK).
- The tracked diff carries no uuid, no absolute home path and no amount. The `~/.cache/...` tilde paths follow the 188 precedent.
- D-14 to D-17 are applied consistently across REPORT, CONTEXT and ROADMAP.

**Two defects make a number or conclusion in the REPORT wrong.** Neither touches the D-15 split of the 1214 (b 1142 / d 72). Both touch Criterion 1 and the premise of `202-MT5-CLOCK-LEAD-01`:
- The four MT5 scopes counted as moving "with no code change" were written on their c0 side by a worker commit 56 analytics-service files away from the c1 side.
- s2 lost 29 winter rows in the control pair. The pipeline cannot see that, and the report says "none in winter".

D-16's bucket outcome for those scopes, (d), is unchanged. I am not re-opening it. What is wrong is the evidence the report, and the TODOS entry, give for it.

## Critical Issues

### CR-01: Criterion 1 counts s2, s5, s8 and s13 as movement "with no code change", but their c0 rows were written by a different analytics-service commit

**File:** `202-REPORT.md:30`, `:36`; `TODOS.md` (`202-MT5-CLOCK-LEAD-01`); root cause in `~/.cache/quantalyze/residchurn/bin/deploy_proof.py:121-128`
**Issue:** The deploy proof shows that no deployment happened between the c0 and c1 captures. The report then treats that as "no code change" for every scope that moved. That holds only when each scope's c0 rows were written by the same code that wrote its c1 rows.
- For the ten OKX and Bybit scopes it holds. Their c0 side came from the 2026-11-06 00:40Z nightly on worker `50594c75` (#1205). The only commits after it are records-only.
- For the four MT5 strategies it does not hold:
  - `codepath/xcheck.out` reads `pair=c0-c1 scope=s2|s5|s8|s13 older_derive=before_switch`.
  - `pre/jobs.json` holds the four derives created 2026-11-03T00:25Z and 01:25Z.
  - The worker live then was `099a9f166947` (from `deploy/pre-worker.json`).
  - `git diff --stat 099a9f166947..ba3c9012858e -- analytics-service` shows 56 files changed, +14633 lines.
  - The range spans the same commits plan 05 judged for s6, s9 and s10, among them #1196 TINYBASE and #1205 (stale-row delete).
- So the 87 changed values, and the 29 removed rows of CR-02, are a code straddle, the same shape as s6/s9/s10 between b0 and b1. They are not a deploy-free nightly's own movement.
- Plan 05's code-path judge (`codepath.py`, `codepath_judge.py`) was never run for this pair, so no candidate commit was judged against these four.
- The report and the TODOS entry name only the MT5 clock switch as the lead.

**Fix:**
- Run `codepath.py` and `codepath_judge.py` on the c0-to-c1 pair for s2, s5, s8 and s13, using the writer commit of each side as plan 05 did, and record the candidate list.
- Restate Criterion 1 in the REPORT. The deploy-free, code-identical evidence is the 1106 values of the ten OKX and Bybit scopes. The 87 values (plus 29 removed rows) straddle seven analytics-service commits.
- Add the straddle and the commit range to the TODOS entry's "Why it is open", beside the clock lead.
- For future pairs, have the proof check, per moved scope, that the worker commit live at the scope's last derive before c0 has an empty `git diff -- analytics-service supabase/migrations` against c0-live. Deployments inside the window are not enough.

### CR-02: 29 rows vanished from s2 in the control pair. The attribution cannot see them, and the report says the changes are summer-only

**File:** `~/.cache/quantalyze/residchurn/bin/attribute.py:51-81` (line 59), `bin/codepath_sig.py:64-65`; `202-REPORT.md:36`, `:92`; `TODOS.md` (`202-MT5-CLOCK-LEAD-01`)
**Issue:** `compare_scope` counts only `d in new and new[d] != base[d]`. Its docstring says it implements "188's exact rule from ... diff.py `diff_scope`". But `diff_scope` (tinybase-gc `bin/diff.py:66-77`) also counts `vanished` (split into stated, hull and unexplained) and `appeared`.

Re-running 188's rule on b1 against `c1rows` gives `changed=1193 vanished=29 appeared=0`. The 29 are all on s2, dated 2025-11-17 to 2025-12-15:
- All 29 fall in US winter (`c01-signature.out`: `days_in_c0_absent_from_c1=29 of_which_us_summer=0`).
- 15 of the 29 carried nonzero values.
- They are exactly the 29 days 188 deleted from s9 as stated tiny-base days between b0 and b1 (188-16: `s9 vanished_stated=29`).
- s2 had 0 stated tiny-base days at b1.

`attr/c0-c1.out` prints no vanished count at all. `attribute.py`'s reproduction gate compares only `changed` and `compared`, so it cannot catch this.

The REPORT then says two things:
- At line 36: "all 87 changed days fall in the US-rule summer and none in winter".
- At line 92: "s2 has 37 active winter days and none changed".

`active_days_winter` counts only days present in both captures (`codepath_sig.py:64-65`), so the 29 removed winter rows are left out of the "thin winter control" by construction. Plan 07's SUMMARY line 283 mentions the 29 in passing, but the REPORT and the TODOS lead drop them. That is the lead the founder booked under D-16.

**Fix:**
```python
# attribute.py compare_scope: report what diff_scope reports, beside `changed`
vanished = [d for d in comp if d not in new]
appeared = [d for d in new if d < last_b and d not in base]
# print vanished= and appeared= on every -diff line; make reproduce() compare them to 188-16's fields
```
- Amend REPORT lines 36 and 92, and the TODOS entry. s2 also lost 29 rows, all in US winter, the same days 188 removed from s9 as tiny-base days. The winter side of the "summer-only" signature is therefore not clean.
- Name #1196 and #1205 as candidates for those rows (see CR-01).

## Warnings

### WR-01: The MCP session renders float8 at 15 significant digits, so "exact, no tolerance" is not exact

**File:** `~/.cache/quantalyze/residchurn/bin/rc.py:28-44`; `bin/compare_prefix.py:91-108`; every `n_*` and `r_rows_*` SQL using `daily_return::text` or `(e->>'r')::float8::text`
**Issue:**
- `compare_prefix.pgfloat8_text` records that the MCP session prints float8 with `%.15g` (extra_float_digits=0). I re-measured it: b1's book prefix digests match `%.15g` on 7 of 7 books and the shortest-repr form on 0 of 7.
- `rc.pgtext` says it renders "the way Postgres float8::text does". The key and strategy digests match only because every stored b1 value has 15 or fewer significant digits (measured: 0 of 6249 key values and 0 of 1940 strategy values exceed 15).
- Consequences:
  - The PROD-side digests and the c1 row reads (`assemble_c1.parse_lines`) cannot see a change past the 15th significant digit. D-09's exact rule therefore has an effective relative tolerance of about 1e-15 on the c1 side and on every book digest.
  - `recompute_digest.py`'s 1-ulp self-test proves a sensitivity the PROD recipe does not have.
  - Prediction 3, "k38 changed 0 values (max difference 0.0e+00)", concerns k38, whose b0-to-b1 movement was the float-rounding class. Movement at the ulp level would be invisible.
- None of this is in the REPORT's Limits.

**Fix:**
- Add a Limits line: digests and reads resolve 15 significant digits, b1's stored key and strategy values all fit in 15, and book values do not.
- For reuse (Phase 203), read exact bits with `encode(float8send(daily_return),'hex')` and decode them with `struct.unpack('>d', bytes.fromhex(h))`.
- Correct the `rc.pgtext` docstring.

### WR-02: The capture gate checks only `n_*.json`, so the c1 gate's `n_files=1/1` covers one of eight chk-bearing files

**File:** `~/.cache/quantalyze/residchurn/bin/check_capture.py:188-210`
**Issue:**
- c1 saved its results as `keys_prefix.json`, `strats_prefix.json`, `books_prefix.json`, `anchor.json`, `b3_window.json`, `b3_ki.json` and `ledger.json`, none of them `n_*`. The gate's glob skips all of them, and its line reads `n_files=1/1` (final.json only). Re-run here: `gc-c-check: capture=c1 ... n_files=1/1`.
- The consumers mostly re-verify through `rc.read_n`: `compare_prefix`, `assemble_c1`, `inputs`, `b3_replay`.
- `ledger.json` is checked by no script. The REPORT's "ledger triple ... the same at c1 (measured both times)" rests on a hand comparison.
- I recomputed every chk here and all hold, so no reported number is wrong today. The gate is just unable to fail on those files.

**Fix:** Tally every `*.json` in the capture directory that carries `chk`, by shape and not by name, and fail on any chk-bearing file the gate did not check. Add a `pre`-against-`c1` ledger comparison step that exits 1 on a difference.

### WR-03: The nightly coverage gate passes on a `--nightly-created` that matches nothing

**File:** `~/.cache/quantalyze/residchurn/bin/check_capture.py:119-134`, `:328-346`
**Issue:**
- `nightly_coverage` requires re-derivation only for pre subjects whose `created_at` string-equals `--nightly-created`. It never checks that at least one subject matched.
- Measured: `check_capture.py --kind c1 --dir c1 --pre pre --nightly-created x --nightly-after y` prints a green `gc-c-check` and exits 0.
- In the actual run, `2026-11-06T00:40:00Z` matched 26 subjects, so this did not happen. But a mistyped second, or a nightly that enqueued at `00:40:01Z`, would turn the D-03 "c1 after the nightly's jobs are done" gate into a pass that checks nothing.

**Fix:**
```python
matched = [s for s, r in latest(pre_rows, "derive_broker_dailies").items() if r["created_at"] == created]
if not matched:
    rc.fatal(f"--nightly-created {created} matches no pre subject: the coverage gate would be vacuous")
# and print matched=<n> on the gc-c-gate / gc-c-check line
```

### WR-04: The read-only SQL lint can be bypassed. "Lint clean as read-only" overstates what it proves

**File:** `~/.cache/quantalyze/residchurn/bin/gen_sql.py:161-178`; claim at `202-REPORT.md:15`
**Issue:** I ran `lint_text` directly on these inputs:
- `SELECT '--' AS a; DELETE FROM public.csv_daily_returns` reads **CLEAN**, as does the same with `'/*'`. `strip_comments` runs before literals are removed, so a comment marker inside a literal hides the rest of a one-line body, including a second statement and a write verb.
- `SELECT net.http_post(...), cron.unschedule(1), pg_terminate_backend(1), set_config(...)` reads **CLEAN**.
- `SELECT ... INTO <table>` is caught only when the table happens to be named `copy`.

I read all 24 current files: each is a pure SELECT with no comment marker in a literal and no side-effecting call, so no PROD write happened.

**Fix:**
- Remove literals with a real tokenizer before removing comments.
- Reject `INTO`, and reject function calls outside an allowlist (md5, string_agg, jsonb_*, to_char, coalesce, count, min, max, split_part, shobj_description, lower).
- In the REPORT, state the actual guard. If the MCP connection is in read-only mode or the reads run in a read-only transaction, say that; otherwise say the lint is pattern-based.

### WR-05: The additive-offset oracle cannot fail a zero-to-nonzero change

**File:** `~/.cache/quantalyze/residchurn/bin/attribute.py:231-237`
**Issue:**
- `offset_cv` removes changed days with `|old| <= 1e-9` from the qualifying set. A day that went from 0 to nonzero cannot happen under a constant additive NAV offset (zero P&L stays zero), yet it is skipped rather than failing the stretch.
- The opposite case, nonzero to 0, raises ZeroDivisionError and scores `inf`, a fail. The handling is asymmetric.
- The self-test case `a_zero_return_day_does_not_qualify` covers only 0 to 0.
- Measured: such days exist only in (d) scopes (s9, s10 for b0 to b1; s2, s5, s8, s13 for c0 to c1). No (b) scope has one, so no reported bucket is affected.
- The rule is pinned as lineage (D-08), so it should not be edited inside 202.

**Fix:** For reuse (Phase 203 or later), score a stretch containing a day with `abs(old) <= 1e-9 and new != old` as `cv=inf`. Add a self-test case where one 0-to-0.02 day sits inside an otherwise passing offset run and must turn the stretch red.

## Info

### IN-01: REPORT cv range lower bound is 1.3e-11, measured 1.2e-11
**File:** `202-REPORT.md:35` (also `202-07-SUMMARY.md:311`)
**Issue:** `attr/c0-c1.out:45` has k24 `cv=1.2e-11`, so the defined-stretch range is 1.2e-11 to 1.4e-9.
**Fix:** Change the lower bound to 1.2e-11.

### IN-02: The D-15 attribution of record has no saved output file
**File:** `~/.cache/quantalyze/residchurn/attr/`
**Issue:** `gc-c-alt-*` exists only as text in `202-07-SUMMARY.md:315-334`. No file in `attr/` holds it, and the exact filter command is not saved. I reproduced it with `grep -v 'gc-c-c01-offset: .*cv=undefined'` and it matches.
**Fix:** Save `attr/c0-c1-alt.out` and `attr/final-alt.out` with the filter command in a header line.

### IN-03: STATE Current Position contradicts itself, and its decision log is stale on D-15 to D-17
**File:** `.planning/STATE.md` (Current Position; decision line ~1049)
**Issue:** The Current Position says "EXECUTING", then "Phase complete — ready for verification", then "Last activity ... Phase 202 execution started". The 202-07 decision line still says "none chosen (open founder question)", and no line records D-15, D-16 or D-17. CONTEXT and ROADMAP do carry them.
**Fix:** Hand-correct these by hand per the repo's handler rule.

### IN-04: The rows-kind gate never checks final.json's `busy`
**File:** `check_capture.py:249-270`
**Issue:** The `busy` check lives inside the jobs block, which does not run for `--kind rows`. This is harmless here, because the rows are bound to c1 by digest.

### IN-05: Unused parameter, and the pinned originals are never linted
**File:** `gen_sql.py:46`
**Issue:** The `line_expr` parameter of `lines_select` is unused (always `""`). The `d_*.sql` originals are SHA-pinned but never linted.

### IN-06: `deploy_proof` picks c0-live by status at read time, not status at c0
**File:** `deploy_proof.py:124-128`
**Issue:** A deployment created before c0 that went live after c0 would be taken as c0-live and dropped from the window. This did not happen here: c0-live was created 47 minutes before c0.

---

_Reviewed: 2026-11-07T09:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 2

**Reviewed:** 2026-11-07T08:00:13Z
**Depth:** deep
**Scope:** fixer commits `2963d0319` and `73a888780` (202-REPORT.md, 202-05-SUMMARY.md, 202-07-SUMMARY.md, TODOS.md, STATE.md). Also the untracked scripts changed against the round-1 backup (`attribute.py`, `codepath_sig.py`, `c01_signature.py`, `codepath_judge.py`, `b3_replay.py`, `check_capture.py`, `gen_sql.py`), the new `codepath_writers.py`, and the regenerated outputs.
**Reported:** MEDIUM and above only.
**Status:** issues_found. 0 critical and 2 warning. Neither changes a bucket total or a value count.

I made no PROD read and used no MCP, remote CLI or Keychain. Everything below ran on saved files and the local repo.

### What I re-ran, and what held

- **Self-tests.** All of these pass, and the new cases can go RED:
  - `attribute.py --self-test`
  - `codepath_sig.py` (7 cases)
  - `c01_signature.py`
  - `codepath_judge.py` (6 cases)
  - `gen_sql.py` (32 cases)
  - `final_attribution.py` (7 cases, sha12 `8a62ca3b1215`)
  - `check_capture.py --self-test --pre pre --c1 c1 --rows-dir rows --dir c0` (52 cases, `red-as-expected`)
- **Real gates on the saved captures.** All exit 0:
  - `check_capture --kind pre`: `n_files=6/6`
  - `--kind c1 --nightly-created 2026-11-06T00:40:00Z --nightly-after 2026-11-07T00:40:00Z`: `n_files=8/8`, `matched=26 books=7`
  - `--gate-only`: `ready=yes matched=26`
  - `--kind rows`: `15/15`
  - `--kind c0`: `4/4`
  - `gen_sql lint sql`: `files=31 violations=0 sha256_d=7/7`
- **Plan verify commands.** The `<automated>` commands of 202-05 (lines 101 and 127) and 202-07 (lines 149 and 175) all exit 0 on the edited SUMMARYs.
- **Outputs regenerated by me.**
  - `attribute.py --pair c01` is byte-equal to `attr/c0-c1.out`.
  - `attribute.py --pair b01 --expect-summary 188-16-SUMMARY.md --evidence` equals `attr/b0-b1-evidence.out`, apart from the `--neuter` line, and reads `reproduces_188_16=yes` with vanished compared.
  - `final_attribution.py` on `b0-b1-evidence.out` and `c0-c1.out` is byte-equal to `attr/final.out`.
  - The D-15 filter run equals `attr/final-d15.out`.
  - Both `codepath_judge` runs equal `judge.out` and `c0c1-judge.out`, and `evidence.json` is `{}`.
  - `b3_replay` on b0, b1 and c1 exits 0. The neuter run exits 1. `b2:k17` is named on all three.
- **Writer per side (CR-01).**
  - `git log 099a9f166947..ba3c9012858e -- analytics-service supabase/migrations` lists exactly #1190, #1193, #1194, #1196, #1197, #1200, #1202 and #1205, which is 8. Round 1's fix text said "seven", and that was wrong. The fixer's 8 is the measured count.
  - `50594c75034a..ba3c9012858e` on the same paths is empty.
  - Independent check: c0's `strats.json` `max_updated` for s2, s5, s8 and s13 reads 2026-11-03T00:25:35Z, 00:25:21Z, 01:37:10Z and 01:37:21Z. So the 2026-11-03 derives wrote those rows, not the 2026-11-06 key derives of their MT5 keys.
- **Numbers carried through.** Every figure the fix introduced matches the script outputs, and the REPORT, the 05 and 07 SUMMARYs and TODOS agree on each one:
  - 1106 values in (b) and 87 in (d) for the control pair
  - s2: 29 vanished, 15 of them nonzero, dated 2025-11-17 to 2025-12-15, all US winter
  - 0 appeared
  - b0 to b1: C, k1 and k2 7 each and s9 29, 50 in total, equal to 188-16 `vanished_stated=50`
  - 37 active winter days
  - cv 1.2e-11 to 1.4e-9
  - 23 of 30 keys (I recomputed it with `key_info` over the inputs files: 30 keys, 23 true)
  - 8 commits
  - pre `n_files=6/6` and c1 `n_files=8/8`
- **Hygiene.** Planning hygiene passes: rules 1, 6 and 7 OK, 10824 files.

### Round-1 items: closure status

| item | closed? | basis |
|---|---|---|
| CR-01 | **closed** | The writer table is right (see above). Criterion 1 is restated as ten code-identical scopes and four that straddle, the 8 commits are named, and the judge was run on the pair. Residual (low): the per-scope writer check lives in a new script, `codepath_writers.py`, which has no self-test and does not filter by job status (all 47 jobs are `done` in pre and c1). `deploy_proof.py` is unchanged. |
| CR-02 | **closed** | `attribute.py` counts vanished and appeared exactly as 188's `diff_scope` does (`comp`, `d < last_b`). `reproduce()` compares both counts, and the self-test turns RED on a vanished or appeared difference. The REPORT's lines 36 and 92 and the TODOS entry are amended. |
| WR-01 | **closed, with a defect in the wording it added** | The Limits line exists. Its supporting clause is not true: see WR-R2-02. Residual (low): the `rc.pgtext` docstring still says "the way Postgres float8::text does". |
| WR-02 | **closed for the gate** | Results are tallied by alias and by shape. A chk-bearing file that no check bound now fails, and the plan-named files are required per kind. Residual (low): no pre-against-c1 ledger comparison step was added. I re-measured it by hand and the two are equal: `n=316`, `max_version=20261106120000`, `h=4f5527…`, and the same `chk`. |
| WR-03 | **closed as raised** | A zero match is fatal, `matched=` is printed, timestamps compare as datetimes, and the book half also requires the compose to be after `--nightly-after`. The gate still covers only one cohort: see WR-R2-01. |
| WR-04 | **closed** | The tokenizer removes literals and comments in one pass, so neither can hide the other. `INTO`, a function denylist and schema denials for `net` and `cron` are added, with 23 RED and 5 GREEN cases. The REPORT now says the lint is pattern-based and is not a read-only transaction, so it no longer claims more than the lint proves. |
| WR-05 | not fixed, by design | Pinned rule lineage. |
| IN-01 | closed | 1.2e-11 is now in the REPORT and in 07-SUMMARY. |
| IN-02 | closed | `attr/final-d15.out` carries the filter command in its header. The header line is printed twice, which is cosmetic. |
| IN-03 | closed | STATE has one field per line, and a D-14 to D-17 line is added. Its wording "D-14 closed to D-17" is garbled (low). |
| IN-04 | closed | `final.json busy` is checked for `--kind rows`, by the self-test case `rows-final-busy`. |
| IN-05 | closed | The `line_expr` parameter is removed, and the `d_*.sql` originals are linted (31 files). |
| IN-06 | not fixed, by design | |

The silent-failure items from round 1:

| item | closed? | basis |
|---|---|---|
| deleted days invisible (`attribute.py:59`) | closed | Same fix as CR-02. |
| coverage gate passing on empty input | closed | Same fix as WR-03. Partial coverage is still open: WR-R2-01. |
| `check_capture` not binding the plan-named results, `ledger.json` included | closed | `ledger.json` has a chk recompute in both pre and c1, and a self-test case (`*-ledger-n-changed`) goes RED when it changes. |
| k38 (b) on flags true for 23 of 30 keys | closed | Now a stated limit in the REPORT (line 105), and the number is verified. |
| `codepath_judge` (c)=0 by construction | closed | An unjudged candidate is now FATAL, and the REPORT and the 05-SUMMARY now say "by construction of the table". Residual (low): `sorted(judged) != sorted(cands)` at `codepath_judge.py:76` can never be true, because `judged` is built from `cands`. `equal=yes` is therefore always printed. The real guard is the TABLE-coverage fatal at `:69`. |
| `b3_replay` dropping rowless members and turning exceptions into n/a | closed | The `gc-c-b3-members` lines and the stderr NOTE are added, and an exception now exits 1. A refusal of the function (`ke.equity is None`) still prints `agree=n/a`, which is correct. Residual (low): the saved `b3/b0.out` and `b3/b1.out` were not regenerated, so they lack the members line. I re-ran both: k17 is absent on b0 and b1, as the REPORT says. |

### Warnings

#### WR-R2-01: Prediction 4 ("s6, s9 and s10 did not move") held without a test: none of the three was re-derived between c0 and c1

**File:** `202-REPORT.md:43` and `:82` ("unmoved in the control pair, so prediction 4 holds for them"); `202-05-SUMMARY.md:314` ("as both explanations predict"); `202-02-SUMMARY.md:278`; `202-06-SUMMARY.md:124,134`; root cause in `~/.cache/quantalyze/residchurn/bin/check_capture.py:138-158` (`nightly_coverage`).

**Issue:**
- `c1/jobs.json` holds the latest derive per subject. For s6, s9 and s10 it is still the 2026-11-06 job: 00:25:00Z, 00:25:00Z and 01:25:00Z, all `done`. Each predates c0 (2026-11-06T15:02:09Z).
- Their stored rows were not rewritten: c1 `strats.json` `max_updated` for s6 and s9 equals c0's, 2026-11-06T00:25:50Z and 00:25:36Z.
- So nothing wrote these scopes inside the c0-to-c1 window. "Did not move" says only that no job ran. It is not a control result: the scopes never faced a re-derive.
- The same holds for s3, s4 and s7. The keys and the other strategies were all re-derived on 2026-11-07.

Why the gate did not catch it:
- `nightly_coverage` requires re-derivation only for pre subjects whose latest job was created at `--nightly-created`, the 00:40:00Z cohort. That is 26 of 47 subjects (`matched=26`).
- Subjects whose latest pre job came from the 00:10, 00:25, 01:25 or 11:25 cohorts, or from earlier days, are never required to re-derive. The round-1 fix made a match of zero fatal. It did not make the gate state what it leaves out.

Why this matters:
- The pinned control rule keeps a (c) assignment only on `control=quiet`, the prediction 4 seam (202-02-PLAN:183, and `"control_confirmation": "plan-07-prediction-4"` in the evidence schema). A scope with no derive inside the window reads as `quiet` and would confirm a code-path cause it never tested.
- No reported number changes today: (c) is 0 and s6, s9 and s10 stay (d). But the REPORT scores prediction 4 "Held" and cites it as support for the (d) list. Plan 05 also reads it as consistent with the MT5-clock explanation. Whoever closes `202-MT5-CLOCK-LEAD-01` would inherit "s6, s9 and s10 were stable across a nightly" as evidence, and they were not tested at all.

**Fix:**
- Rescore prediction 4 in the REPORT as "not tested: s6, s9 and s10 were not re-derived between c0 and c1 (latest derives 2026-11-06 00:25Z, 00:25Z and 01:25Z; c1 `max_updated` equal to c0's)". Make the same change at REPORT `:82`, `202-05-SUMMARY.md:314` and `202-02-SUMMARY.md:278`.
- Add the matching Limits line.
- Add a sentence to the TODOS entry so its closer does not use prediction 4 as evidence.
- For reuse, have `check_capture` print, beside `matched=`, the pre subjects it did not require. For example:

```python
# check_capture.py nightly_coverage: name what the gate leaves out instead of skipping it silently
skipped = [s for s, r in latest(pre_rows, "derive_broker_dailies").items() if ts(r["created_at"]) != created]
not_rederived = [s for s in skipped if not (now_k.get(s) and ts(now_k[s]["created_at"]) >= after)]
# print matched=<n> skipped=<n> not_rederived=<labels> on the gc-c-nightly line
```

- Have the control side (attribute or compare_prefix, not the pinned script) mark a scope `quiet_untested` when its latest c1 derive predates c0.

#### WR-R2-02: The new Limits line says b1's stored key and strategy values all fit in 15 significant digits. That count is an artifact of the 15-digit rendering, and the stored values almost certainly do not fit.

**File:** `202-REPORT.md:104` ("b1's stored key and strategy values all fit in 15 digits (0 of 6249 key values and 0 of 1940 strategy values exceed them), book values do not"). The wording came from round 1's own WR-01 fix suggestion, so this is partly my round-1 error, carried in faithfully by the fixer.

**Issue:**
- b1's key and strategy rows were read in the same MCP session that renders `float8::text` at `%.15g`, so no value in them can show more than 15 significant digits.
- The measured distribution of nonzero values has the shape of truncation, not of stored precision:
  - Keys: 5648 of 6249 carry exactly 15 significant digits, 529 carry 14, 66 carry 13, and none more.
  - Strategies: 1639 of 1940 carry exactly 15 digits.
- The book returns in the same b1 capture are not re-rendered through float8 output, because they are read from jsonb. They carry 16 digits on 604 values and 17 on 609, out of 2873.
- So "0 of 6249 exceed 15" proves nothing about storage. It reads as reassurance that the 15-digit blindness costs nothing for key and strategy scopes, and that is not established.
- This bears directly on prediction 3 (k38, whose b0-to-b1 movement was the float-rounding class) and on the 1193 and 1214 counts.
- The line's own conclusion, "blind past the 15th digit and can only under-count", still holds, because both sides of each pair were rendered the same way.

**Fix:** Replace the clause with something like: "b1 was itself read at 15 significant digits: 5648 of 6249 nonzero key values and 1639 of 1940 strategy values show exactly 15, none more, while the jsonb book returns of the same capture show up to 17. So whether stored values carry more than 15 digits is not measured, and every count here, 188's 1214 included, is a count at 15 digits on both sides." The rest of the line can stay.

### Notes (below MEDIUM, listed only so the closure table is complete; not findings)

- `202-07-SUMMARY.md:96` repeats "across a deploy-free nightly" in its headline sentence.
- `codepath_writers.py` takes the first subject (strategy, then key) that has any job, independently on each side. Correct here, as the `max_updated` check above shows.

---

_Round 2 reviewed: 2026-11-07T08:00:13Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 3

**Reviewed:** 2026-11-07T08:18:37Z
**Depth:** deep
**Scope:** fixer commit `0cff77c17` (202-REPORT.md, 202-02/05/06/07-SUMMARY.md, TODOS.md). Also the untracked scripts changed against the round-2 backup (`check_capture.py`, `codepath_judge.py`, `b3_replay.py`, and the `rc.py` docstring), and the regenerated outputs (`codepath/judge.out`, `codepath/c0c1-judge.out`, `codepath/clock-candidate.json`, `b3/b0.out`, `b3/b1.out`).
**Reported:** MEDIUM and above only.
**Status:** issues_found. 0 critical and 3 warning. None changes a bucket total, a value count or a bucket assignment.

I made no PROD read and used no MCP, remote CLI or Keychain. Everything below ran on saved files and the local repo.

### What I re-ran, and what held

- **The four changed scripts are the only ones that differ from the round-2 backup.** The other 15 are byte-equal to it.
- **Self-tests.** All of them pass:
  - `codepath_judge.py --self-test`: 8 cases, including the two new (d)-reason cases.
  - `check_capture.py --self-test --pre pre --c1 c1 --rows-dir rows --dir c0`: `red-as-expected`, including `gate-failed-final-{derive,compose}-not-covered`, the three `gate-skipped-subject-*` cases and `c1-nightly-names-not-rederived`.
- **Real gates on the saved captures.** Plan 06's c1 args give `gc-c-check: capture=c1 ... n_files=8/8 ... sql_sha=ok` and `gc-c-nightly: ... matched=26 of 40 books=7 skipped=14 not_rederived=s3,s4,s6,s7,s9,s10`, and exit 0. `--gate-only` gives `ready=yes` with the same coverage tail.
- **Every plan `<automated>` verify command passes on the edited SUMMARYs.** That is 11 commands: 02 (three), 05 (two), 06 (two), 07 (two) and 08 (two). All exit 0.
- **Regenerated outputs.**
  - `codepath_judge` on both pairs is byte-equal to `judge.out` and `c0c1-judge.out`, and both `evidence.json` files are `{}`.
  - `b3_replay` (analytics venv, `-I`) is byte-equal to `b3/b0.out`, `b3/b1.out` and `b3/c1.out`, and exits 0 on all three. Each file now carries 7 `gc-c-b3-members` lines.
  - The `--neuter` run exits 1 on the four `expect_b1` misses. It does not exit through the new cross-check exit, so the neuter still proves that `--expect b1` can fail.
- **F2 can fail on bad input.** I wrapped `replay_key_equity` and mutated only the first key (C):
  - A refusal exits 1 with `C:refused`.
  - A disagreement (`replay=7 formula=0`) exits 1 with `C:formula=0,replay=7`.
  - The unmutated run exits 0.
- **The `not_rederived` cut can fail on bad input.** I swapped the cut to the rejected `created_at < --nightly-after` form. `c1-nightly-names-not-rederived` then went WRONG, so the real-capture pin guards the deviation.
- **The deviation is right on these captures.** pre was taken at 2026-11-06T23:45:18Z, which is after c0 (15:02:09Z). So "the latest c1 derive is the one pre holds" can only over-name a subject, never under-name one.
  - s1, s14, s15 and s16 re-derived at 2026-11-07T00:10Z, and s2 and s5 at 00:25Z. A `--nightly-after` cut would have named all six wrongly.
  - s3, s4, s6, s7, s9 and s10 keep their pre job in c1. Their c0 and c1 `strats.json` `max_updated` are equal for all six (s10 too, which the REPORT does not mention).
- **The WR-R2-02 figures recompute from b1.** Of the nonzero values, keys show 6249 in total, with 5648 at 15 digits, 529 at 14 and 66 at 13. Strategies show 1940 in total, with 1639 at 15 digits.
- **F1's factual correction holds against git.** #1196 has a hunk in `combine_mt5_deal_ledger` and #1205 has hunks in `run_derive_broker_dailies_job`. #1187, #1197 and #1202 also edit `run_derive_broker_dailies_job`, but only in the Deribit key-mode, ccxt-read and exchange-read refusal branches. The TABLE codes them as off the MT5 strategy-mode path, and the hunks bear that out.
- **Hygiene.** Planning hygiene passes: rules 1, 6 and 7 OK, 10824 files. The added lines carry no uuid and no home path.

### Round-2 items: closure status

| item | closed? | basis |
|---|---|---|
| WR-R2-01 (prediction 4 untested) | **closed in the REPORT, TODOS and the SUMMARY bodies; one stale frontmatter line** | REPORT prediction 4, the control column, the (d) paragraph and Limits all say "not tested". TODOS `202-MT5-CLOCK-LEAD-01` forbids citing it. 02/05/06/07 bodies carry the correction, and 06 has a `gc-c-pred-corrected` line beside the lineage line. 06-SUMMARY's frontmatter still says "4 and 5 held": see WR-R3-02. |
| WR-R2-02 (15-digit clause) | **closed** | The Limits clause is replaced by the measured distribution, and every figure recomputes. The `rc.pgtext` docstring is corrected. |
| F1 (judge's hard-coded reason) | **closed for the false claim; the reason token is still a constant** | The false "no commit changes MT5 day bucketing" is gone. `commits_touching_path` is computed from the TABLE, the `equal=` tautology is removed, and `clock-candidate.json` carries a CORRECTED note. The `reason=` token itself is still one literal on every (d) line: see WR-R3-03. |
| F2 (b3 disagreement and refusal exit 0) | **closed** | Both now exit 1 (mutation-proven above). The real runs exit 0, and the neuter still fails through `expect_b1`. |
| F3 (fixed cohort; failed_final as coverage) | **closed for the required cohort; the new `not_rederived` list repeats the failed_final hole** | `covered()` now requires `COVERING` (no `failed_final`) for both derives and composes, with two RED self-test cases. The skipped subjects are now counted and named rather than silently left out. But `not_rederived` counts any post-pre job as a re-derive, a `failed_final` one included: see WR-R3-01. |

Deviation (`not_rederived` = the latest c1 derive is still pre's): **accepted.** It is correct here for the reason above, and the real-capture self-test pins it against the `--nightly-after` alternative. Residual (low): the cut is relative to `--pre` and not to c0. That matters only for a future pre taken before c0. The docstring's cohort list also omits 11:25Z (s7's cohort).

### Warnings

#### WR-R3-01: `not_rederived` treats a failed_final job as a re-derive, the same hole round 2 closed for the required cohort

**File:** `~/.cache/quantalyze/residchurn/bin/check_capture.py:161-165` (`nightly_coverage`, the `else:` branch). The claim that rests on it is at `202-REPORT.md:43` ("it now names the rest ... `not_rederived=s3,s4,s6,s7,s9,s10`") and `:113` (Limits: "`failed_final` is no coverage, and the line names `skipped=` and `not_rederived=`").

**Issue:**
- The fix defines `COVERING = ("done", "done_pending_children")` because "a failed derive covers nothing". `covered()` applies that to the matched cohort and to books.
- The new `not_rederived` test for the skipped subjects is `not n or ts(n["created_at"]) <= ts(r["created_at"])`, which checks time only. A skipped subject whose only job after pre ended `failed_final` wrote nothing, yet it counts as re-derived and is not named.
- That is exactly the case the REPORT relies on the list for: "quiet" means "no job wrote them".
- Measured on a copy of `c1` (jobs.json, jobs_after.json and both `*_check.json` chks recomputed):
  - I set s1's 2026-11-07T00:10:15Z derive to `failed_final`.
  - `--gate-only` prints `ready=yes ... not_rederived=s3,s4,s6,s7,s9,s10` and exits 0. s1 is not named.
- No reported line changes today: all 47 latest jobs in c1 are `done`. But the gate the REPORT presents as the source of the untested-control list cannot list a subject whose re-derive failed. A future control would then read that subject's `quiet` as tested.

**Fix:**
```python
# check_capture.py nightly_coverage, skipped branch: a re-derive that wrote nothing is not a re-derive
n = now_k.get(s)
if not n or ts(n["created_at"]) <= ts(r["created_at"]) or n["status"] not in COVERING:
    not_rederived.append(s)
```
- Add a self-test case, `gate-skipped-subject-failed-final-named`. It is a skipped pre subject whose only later c1 job is `failed_final`, and it must appear in `not_rederived`.
- Re-run the c1 gate. The real line is unchanged, because every job is `done`.

#### WR-R3-02: 202-06-SUMMARY's frontmatter still says prediction 4 held

**File:** `202-06-SUMMARY.md:14` (`provides:`): "predictions 1, 4 and 5 scored (1 failed, 4 and 5 held)".

**Issue:**
- The fixer corrected the body of 06 (line 125's `gc-c-pred-corrected` and line 135), the REPORT, TODOS and the 02/05/07 bodies. The frontmatter is the one place left stating the uncorrected result.
- The frontmatter is the part downstream tooling reads without the body: milestone summaries, `gsd-extract-learnings` and plan-dependency `provides`. So the one surface most likely to be quoted forward still reads "4 held". That is the exact inheritance WR-R2-01 asked to prevent ("whoever closes `202-MT5-CLOCK-LEAD-01` would inherit" it).
- Plan 06's own verify, `202-06-PLAN.md:189`, still matches the lineage `gc-c-pred: n=4 held=yes` line. That is acceptable as lineage, but it means no gate reads the correction.

**Fix:** Change line 14 to `predictions 1, 4 and 5 scored (1 failed, 4 not tested (review round 2: s6, s9 and s10 had no job between c0 and c1), 5 held)`.

#### WR-R3-03: The (d) `reason=` token is still a constant, so "derived from the TABLE" holds for the commit list and not for the reason

**File:** `~/.cache/quantalyze/residchurn/bin/codepath_judge.py:91-96`. The claim is at `202-REPORT.md:109` ("Its (d) reason is derived from the TABLE") and `202-05-SUMMARY.md:175` ("The reason is now derived from the judge's TABLE").

**Issue:**
- The `else:` branch prints `reason=table_has_no_entry_producing_a_changed_day_kind` for every scope with no commit meeting the rule. Only `commits_touching_path` is computed.
- The reason token is true only while every candidate's TABLE `kind` is `None`. With today's TABLE, that is true by construction, and that is the real-data case.
- It is false whenever a candidate has a `kind` and fails the rule in some other way. Measured with `build()`:
  - A TABLE entry `("job_worker.py:f", ..., "sign_flip", ...)` on a scope showing only `magnitude` prints `reason=table_has_no_entry_producing_a_changed_day_kind commits_touching_path=#1196,#9999`. The TABLE does have an entry producing a changed-day kind; the scope just does not show it.
  - An entry with `path=None, kind="magnitude"` on a `magnitude` scope prints the same reason.
- The self-test case `kind_not_observed_is_no` exercises exactly this shape, and its (d) line carries the false reason, but no case checks the reason there.
- This is the F1 defect class (a literal printed whatever the table says), narrowed and not removed. The REPORT and the 05-SUMMARY describe it as removed.

**Fix:**
```python
# codepath_judge.py build(), (d) branch: name why each candidate failed, from the judgements
why = sorted({("no_kind" if j["kind"] is None else
               "kind_not_observed" if signatures[scope].get(j["kind"], 0) == 0 else
               "path_not_on_derive") for j in js})
reason = ("table_has_no_entry_producing_a_changed_day_kind" if why == ["no_kind"]
          else "no_candidate_meets_rule:" + "+".join(why))
```
- Add a case asserting the reason on the `kind_not_observed_is_no` shape.
- Alternatively, keep the code and amend REPORT `:109` and 05-SUMMARY `:175` to say "the commit list is derived from the TABLE; the reason token is fixed and is true while every TABLE kind is None".

### Notes (below MEDIUM, listed only so the closure table is complete; not findings)

- The correction sentences were spliced in mechanically and read doubled: `202-02-SUMMARY.md:278`, `202-05-SUMMARY.md:316`, `202-06-SUMMARY.md:135` and `202-07-SUMMARY.md:271` each say "corrected in review round 2" twice in one sentence. 05:316 also reads "corrects that, because not tested (...)".
- `clock-candidate.json` is described as a "derived file", but no script writes it, so it was hand-edited. Its note names #1196 and #1205 but not #1194, which the judge's `commits_touching_path` also lists.
- The REPORT drops the TABLE's "MT5 strategy-mode" qualifier when it says the judge "names the commits that touch the derive path". #1187, #1197 and #1202 also edit `run_derive_broker_dailies_job` in non-MT5 branches.

---

_Round 3 reviewed: 2026-11-07T08:18:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
