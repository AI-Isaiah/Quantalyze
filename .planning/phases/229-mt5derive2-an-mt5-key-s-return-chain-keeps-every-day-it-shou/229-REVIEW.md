---
phase: 229-mt5derive2
reviewed: 2026-11-24T16:15:02Z
depth: deep
diff_base: e5759fa76
reviewed_at_sha: f507b2b2b
files_reviewed: 12
files_reviewed_list:
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/nav_twr.py
  - analytics-service/services/transforms.py
  - analytics-service/tests/test_allocator_equity_writer_basis.py
  - analytics-service/tests/test_csv_analytics_runner.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_mt5_soak.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_transforms.py
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
  necessity: 0
status: issues_found
round: 3
---

# Phase 229: Code Review Report

> Rounds: the body below is **round 0**, a self-review run inline on one model (not independent; kept as lineage). **Round 1** is the independent pair, appended at the end.

**Reviewed:** 2026-11-24T16:15:02Z
**Depth:** deep (cross-file: writer exits, the `key_inputs` epilogue, the compose read loop, the stitch and the no-history rule)
**Files Reviewed:** 12
**Status:** clean (no MEDIUM or above). Round 1 of at most 3. No fixer round was needed.

## How this review was run (deviation, recorded)

The brief asked for two parallel lanes: `gsd-code-reviewer` (Opus) through `/gsd-code-review 229`, and
`pr-review-toolkit:silent-failure-hunter` (Sonnet, high). The session that ran this review had **no
agent-dispatch tool**, so neither subagent could be spawned. The workflow's `Agent(...)` step could not run.
Both lanes were therefore run inline by the review-loop owner (an Opus model, the reviewer lane's
model). Each lane's checklist was applied to `git diff e5759fa76..HEAD -- . ':!.planning'`, and every claim
was checked against the source at `f507b2b2b`. The silent-failure lane did not run on Sonnet as the brief asked.

## Summary

The phase changes five money-math seams. Each was traced to its producer and its consumer:

- **MT5D-04 (`nav_twr._judged_cohorts`).** An empty cohort 0 is now skipped whenever a later cohort holds
  P&L. On a healthy base the skipped cohort contributed `1 + 0/prev = 1`, so no published return moves. Only
  a day that opened on a base of zero or below, or a non-tiny dust base, now measures the deposit's cohort.
  That matches the CONTEXT rule. Phase 188's tiny-base test still runs afterwards on `prev`, and
  `cohort_min` is recomputed from the same judged list. The soak's `_walk_cohorts` applies the same rule:
  for `k = 0`, `cohort_pnl[1:]` is the same predicate as production's `range(1, n_cohorts)`.
- **MT5D-05 (`chain_linked_twr` inception branch).** With `prev0=None`, `cur - prev - flow_t` is `pnl0` by
  construction. The relative 1e-9 floor counts a real day-0 P&L and skips a deposit-only day, and a NaN level
  compares False. The flag is an annotation: it is outside `NAV_TWR_GUARD_KEYS` and is carried present-only
  through `_build_nav_meta`, `_merge_status_meta`, the job pre-stamp and `run_csv_strategy_analytics`.
- **MT5D-07 (store gate).** Every `None` exit of `_native_key_usd_writer_basis` now returns a closed token.
  Its only caller tells the two results apart with `isinstance(basis, str)`. A grep confirms there is no
  other caller. The store gate's `elif` writes `writer_basis_withheld` only for a TIMED MT5 key. The compose
  reads it at all three sites: counted, departed and stitch source. It pops the token for a key the
  no-history rule removes, and raises the blocking `KEY_INPUTS_MISMATCH` for both the primary and the
  fallback compose.
- **HOLD-03 (returns stamp).** Both key-mode exits stamp exactly the rows they upserted:
  - The main exit's reconcile delete removes every calendar day of the span absent from `rows_payload`, and
    the stamp window is inside that span.
  - The short exit stamps only `_measured`.
  - `csv_daily_returns.daily_return` is `double precision NOT NULL` (`supabase/schema/baseline.sql`). The
    compose builds `returns_by_key` with an ISO-string index straight from the rows. The comparison runs
    before `stitch_shared_account` rewrites a kept member's series. The 1e-12 tolerance sits above a float
    round trip through jsonb `numeric` and `float8`.
  - The only other writers of `csv_daily_returns` are the composite job and the OKX archive. Both are
    `strategy_id`-scoped and cannot touch a key's rows.
  - Nothing writes returns after the epilogue on either exit.
  - Every malformation of a stored stamp or token raises `ValueError` inside the `ki_rows` try, which
    disposes the job as a corrupt input.

Gates at the reviewed SHA: mypy strict reports `Success: no issues found in 142 source files`.
`git diff --quiet e5759fa76 -- analytics-service/tests/fixtures/` exits 0. The full-suite reading is under
"Final gates" below.

## Narrative Findings (AI reviewer)

No Critical or Warning (MEDIUM and above) findings. The six items below are LOW or INFO. Under the review rule
they are recorded here only. They are not fixed and not booked in `TODOS.md`.

## Info

### IN-01: A no-marks short exit can store a fresh writer basis with no stamp beside an earlier derive's returns (LOW)

**File:** `analytics-service/services/job_worker.py:10299-10380` (short exit), `:10131-10135` (stamp only when `_returns_stamp_rows is not None`)
**Issue:** A short exit without applied marks writes no `csv_daily_returns` rows, so `_returns_stamp_rows` stays
`None`. The epilogue can still store a writer basis. The compose then counts the row as stampless and never
compares it. The INFO log says such rows were "written before 229 HOLD-03", which is wrong for this case.
**Not a regression, and outside SC-4.** Before this phase no pair was compared at all. A same-terminal pair on
this exit would need the earlier derive's returns to end on the new derive's terminal day while the new derive
has fewer than two interpretable days. When the terminals differ, `realized_terminal_day_mismatch` already
catches the pair.
**Fix (not applied):** none required. If it is ever wanted, stamp `{}` on that exit. An empty stamp counts 0,
and the log would then stop misattributing the row.

### IN-02: A departed or failing key that carries `writer_basis_withheld` has no derive left to clear it (INFO)

**File:** `analytics-service/services/job_worker.py:17188-17196` (departed site), `:17220-17227` (stitch source)
**Issue:** The token clears itself on the next derive that stores a basis. A revoked or disconnected key never
derives again, so its book stays blocked as `key_inputs_mismatch` until the owner acts.
**Accepted.** This is the founder's "Block it" ruling (CONTEXT, MT5D-07). It matches the holed-key precedent,
and plan 229-03 made the departed and stitch-source sites honour the token on purpose. PROD measurement on
2026-11-24 found no MT5 key without a basis, so nothing live is affected. It sits beside 186 D-08 ("a failing key
affects only itself"). The block is the newer and more specific founder ruling, so it takes precedence (Rule 7).
That precedence is recorded here and not resolved here.

### IN-03: `inception_day_pnl_dropped` has no reader in `src/` (INFO)

**File:** `analytics-service/services/analytics_runner.py:284-289`
**Issue:** The flag is persisted in `data_quality_flags`, but no factsheet or API surface reads it. A grep of
`src/` finds no hits. "Counted by name" is therefore true in the stored row only.
**Accepted.** CONTEXT chose an annotation ("no return, no warning", matching D-12) and did not ask for factsheet
copy.

### IN-04: The soak's cohort walk now restates production's rule (INFO)

**File:** `analytics-service/scripts/mt5_soak.py:614-618`
**Issue:** `_walk_cohorts` now applies the same empty-cohort-0 predicate as `_judged_cohorts`. If both were wrong
in the same way, the soak could not catch it.
**Accepted.** The docstring says the rule is taken from the CONTEXT text, not from the production code. The
hand-fraction test `test_the_soak_walk_matches_a_hand_fraction_walk_on_the_refund_day` is the oracle that
imports no production code.

### IN-05: "Timed" means a MEASURED timed day (INFO)

**File:** `analytics-service/services/job_worker.py:10137`
**Issue:** `flow_timing_timed_days` counts only the timed days whose return was stored. A key whose every timed
day was guarded or tiny-base-dropped reads as untimed and gets no withheld token.
**Accepted.** Such a key stores no cohort-product return, so the legacy roll has no cohort-day error to hide.
That error is the reason MT5D-07 blocks.

### IN-06: The compose's stamp-mismatch log names no cause beyond the count (INFO)

**File:** `analytics-service/services/job_worker.py:17856-17864`
**Issue:** The log reports keys and total days only. It cannot tell an in-flight re-derive race, which heals on
the next compose, from a persistent disagreement.
**Accepted.** Counts only, by T-73-02 / T-164.6.6.2.3-16. The race case is self-healing, because each derive
enqueues a compose after its own `key_inputs` write.

## Silent-failure lane (run inline, see deviation above)

The lane checked:

- every new `None` or `return` path: the six writer-basis branches and the store-gate fallback
  `store_gate_unmet`;
- every new reader: `read_writer_basis_withheld`, `read_returns_stamp` and `returns_stamp_mismatch_days`;
- the stampless count;
- the non-finite refusal in `returns_stamp_payload`, which cannot be reached because `rows_payload` excludes
  NaN and the upsert would refuse Inf first;
- the closure variables declared before both exits.

It found no swallowed error and no broad `except` added. It found no default that hides a failure: the unknown
token blocks and is counted as `unknown`, an empty token string raises, and a malformed stamp raises. It found no
log line that echoes an id, day or amount. IN-01 and IN-05 above are this lane's two residuals. Both are LOW or
INFO.

## Triage

| id | severity | verdict |
|---|---|---|
| IN-01 | LOW | recorded only (not a regression, outside SC-4) |
| IN-02 | INFO | accepted (founder ruling MT5D-07, holed-key precedent) |
| IN-03 | INFO | accepted (CONTEXT annotation decision) |
| IN-04 | INFO | accepted (hand-fraction oracle is independent) |
| IN-05 | INFO | accepted |
| IN-06 | INFO | accepted (T-73-02) |

There is no HIGH or CRITICAL finding, no user-facing or data-integrity MEDIUM and no phase-goal gap, so no fixer
round ran. No PROOF-01 neuter/restore was needed, because no money-math code changed in review.

## Final gates (at `f507b2b2b`)

- mypy strict: `Success: no issues found in 142 source files`.
- `git diff --quiet e5759fa76 -- analytics-service/tests/fixtures/`: exit 0.
- Full analytics suite (`pytest -n auto --dist loadgroup --cov... --cov-fail-under=80`): `15583 passed, 93 skipped, 1188 warnings in 110.79s`; `Required test coverage of 80% reached. Total coverage: 94.72%`; exit 0. The phase diff adds no skip marker. Across the six touched test files exactly 1 test skips, `tests/test_job_worker.py:4278` (`LANE_DB_URL unset (local dev)`), an existing local-lane skip that CI runs on its own lane. The other 92 skips are in files this phase does not touch.

## Round 1: independent pair (2026-11-24, on `e5759fa76..3e49de6a6`, excluding .planning)

Run from the phase agent's level: gsd-code-reviewer (Opus) in parallel with pr-review-toolkit:silent-failure-hunter (Sonnet, high). Both were briefed with the code, ROADMAP and CONTEXT only, not round 0's conclusions. Full reports: `229-REVIEW-R1-CR.md`, `229-REVIEW-R1-SFH.md`. An earlier SFH run whose brief cited round 0 is treated as supplementary only; its one MEDIUM matches SFH-229-02.

| id | severity | finding | disposition |
|---|---|---|---|
| SFH-229-02 (= CR LR-01, anchored SFH MEDIUM-1) | MEDIUM, user-facing | A compose reading between a same-terminal re-derive's returns write and its key_inputs write sees new returns against the old stamp and blocks at once, bypassing the R2-WR-01 transient retry; the derive's own follow-up compose is deduped into the running job, so the false block persists until the next trigger. | Fixed in the round-1 fixer (stamp-mismatch counted keys join `lagging_inputs`). |
| MR-01 (CR) = SFH-229-01 | MEDIUM, user-facing | A departed key whose last row carries `writer_basis_withheld` (or a stale stamp) blocks the whole book forever: it never re-derives, contradicting the ruling's self-heal premise and D-22's rule for departed keys. PROD: 0 such rows. | Escalated to the coordinator: it narrows the founder's MT5D-07 "Block it" ruling. Recommendation recorded in the handback. |
| LR-02..LR-04, CR INFO x4, SFH LOW/INFO x2 | LOW / INFO | see the R1 reports | Recorded only, per the review rule. |

## Round 2: re-review of the fixer commit `156c56a08` (2026-11-24)

Same pair (gsd-code-reviewer Opus ‖ silent-failure-hunter Sonnet high), scoped to the fix.

- Code reviewer: no MEDIUM+. Ran `test_allocator_equity_writer_basis.py` + `test_derive_allocator_equity_job.py`: 313 passed. Confirmed a genuine mismatch is delayed by the retry, never lost (claim RPC increments `attempts`; the third run composes and blocks), and the new test fails without the fix.
- Silent-failure hunter: one MEDIUM (stitch-source stamp mismatches skip the retry). **Dismissed with evidence:** a stitch source is a group member whose first return day precedes the kept key's, and the kept key is the minimum over the working, unmarked pool whenever that pool is non-empty (`job_worker.py`, the group loop before `counted_ids = eligible_ids - excluded_shared`). So a stitch source is always non-working or marked, writes no new returns, and cannot be mid-write. The code reviewer reached the same conclusion independently.
- Below MEDIUM, recorded only: the transient message/log wording ("returns newer than their key_inputs row") also covers the same-terminal stamp case; the R2-WR-01 comment "the opposite skew blocks at once" no longer holds for the stamp arm; the SFH-229-02 comment's "left out by the no-history rule" holds only for failing or marked keys.

Open after round 2: MR-01 / SFH-229-01 (departed key), escalated to the coordinator, not fixed.

## Round 3: MR-01 fixed per founder ruling (2026-11-24)

Founder ruling "Exempt departed keys" (recorded as a dated SCOPE NOTE on the MT5D-07 ruling in 229-CONTEXT.md and ROADMAP SC-4). Fixer commit `5839f0f8b`: a departed key's withheld token or stale stamp goes into `departed_basis_unchecked`, raising the non-blocking benign flag `departed_writer_basis_unchecked` (count in `inputs.departed_writer_basis_unchecked_keys`, counts-only log); live counted and stitch-source keys still block. PROOF-01: reverting the exemption turned the two departed tests RED (2 failed, 152 passed); restored by `cp` + `cmp`; GREEN 154 passed.

Re-review (gsd-code-reviewer Opus ‖ silent-failure-hunter Sonnet high):
- Code reviewer: no MEDIUM+. Live keys still block for token and stamp; no consumer mis-handles the new flag or inputs key; tests fail on either regression.
- Silent-failure hunter: one MEDIUM — the log said "are not blocked", but a departed key with a basis can still block through the pre-existing writer-basis calendar gate (`writer_basis_mismatch`, predates the phase at b6b8c39d5, outside the ruling's token-and-stamp scope). Fixed by wording only (`b3b034f8b`): the log now says the keys "are exempt from that block". LOW notes recorded: an unknown departed token is exempt with no histogram bucket; the `read_writer_basis_withheld` docstring's "an unknown token still blocks" now holds for live keys only; no Sentry event for the new flag (the ruling asks for a counts-only log); the `departed_history_inclusion` docstring flag list omits the new token.

Open after round 3: none MEDIUM+.
