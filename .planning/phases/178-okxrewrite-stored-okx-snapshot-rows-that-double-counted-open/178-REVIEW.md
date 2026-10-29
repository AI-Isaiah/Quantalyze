---
phase: 178-okxrewrite-stored-okx-snapshot-rows-that-double-counted-open
reviewed: 2026-10-29T07:49:30Z
depth: deep
round: 3
files_reviewed: 7
files_reviewed_list:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/tests/test_reconstruct_whole_account.py
  - docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql
  - docs/runbooks/marksource-okx-census/README.md
  - docs/runbooks/marksource-okx-history-correction.md
  - src/__tests__/marksource-okx-census-sql.test.ts
  - src/__tests__/marksource-okx-nonworking-keys-exec.test.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
round_2_findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
round_1_findings:
  critical: 2
  warning: 3
  info: 0
  total: 5
status: issues_found
---

# Phase 178: Code Review Report

**Reviewed:** 2026-10-29
**Depth:** deep (selection code traced into `account_groups`, `working_holder_predicate`, `eligible_key_predicate`, `identity_pending_venues`, the daily refresh's carry rules, `_account_marker_key_ids`, the persist-time key re-read, the window replace and the B'5/B'6 forms)
**Files Reviewed:** 8
**Status:** issues_found
**Scope:** MEDIUM and above only, as the brief asked. HIGH findings are filed as CR- (blocker tier), MEDIUM as WR-.

## Summary

The Python change is internally consistent. Checked and found matching:

- The new per-group order: Deribit $0 first, then dead, then the venue checks over the working members.
- The P7 SQL and the `crosswalk` form follow the same grouping: transitive marker reach, deciding venues = working members' venues (every member's when none works), state in plan 01's order, window back 89/729/730, and predicted window 90/730.
- The probe and audit plumbing: the record key is declared, validated, defaulted and set, and the audit key sits beside `account_zero_contribution_accounts`. The enqueue/newjob forms already pick a working key.

The defects are in what P7 assumes about the stored rows, and in where the D-06 protection sits relative to the irreversible write.

1. P7 assumes the refresh carries a failing key at most 7 days. That has only been true since v0.132.5.0 (2026-10-19). From v0.111.0.0 (2026-09-29) until then, the carry had no age cap, and that period is inside the 90-day window. P7's "superset" claim is false there.
2. D-05 turns a key that goes non-working between P7 and the crawl into a silent 90-day removal of that whole exchange account. This includes a transient `error` from a poll blip, which `working_holder_predicate` treats as not working. Nothing compares the crawl's selection with what P7 measured before the window replace commits. B'5's count check runs after the write.

The three MEDIUMs:

- P7 cannot see a hard-deleted key.
- The SQL-to-Python parity has no committed executable test.
- A predicted 730-day window can still reach the write while B'6 assumes 90 days.

## Critical Issues

### CR-01 (HIGH, data-integrity): P7's 7-day carry bound is false for rows stored from 2026-09-29 to 2026-10-19, so P7 can say `rebuild` for an account whose stored in-window days hold a dead key's balance

**File:** `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql:150`. Also `docs/runbooks/marksource-okx-history-correction.md:500-505` (the stated reason), `analytics-service/tests/test_reconstruct_whole_account.py:1753-1756` and `analytics-service/services/equity_reconstruction.py:2721-2723` (the same premise in a docstring and a code comment).

**Issue:** The overlap test is `sd.asof BETWEEN ds.first_asof - 1 AND ds.last_asof + 7`. It rests on RESEARCH line 62 and the runbook's Why paragraph: the refresh carries an `error`/`sign_in_failed` key at most `CARRY_AGE_CAP_DAYS` (7) days. That cap shipped in v0.132.5.0 (WRITERRESIDUALS 167.1.2.1.1 SC-5, CHANGELOG 2026-10-19). The release before it, v0.111.0.0 (ACCOUNTTRUTH C2, 2026-09-29), introduced "an account that did not poll today is carried at its latest holdings". Between those two releases, an eligible-but-failing key (active, not revoked, not disconnected) was carried flat with no age limit; v0.132.5.0's own entry says it "flags a failing ... key instead of carrying it flat". Both dates fall inside the 90-day window the rebuild replaces (today minus 89 days is about 2026-07-31).

Concrete miss:

- A key went `error` and its last holdings day was before about 2026-07-24.
- It was still eligible on 2026-09-29.
- The refresh rows labelled from about 2026-09-29 to about 2026-10-19 then carry its July balance.
- P7's span (last day + 7) ends before the window, so `in_window_days_overlapping_dead_key_holdings` = 0 and `p7_outcome` = `rebuild`.
- The forced rebuild skips the dead account (D-05) and writes about 20 in-window days lower by that whole account's carried balance.

That is exactly what D-06 says must not happen. A currently `revoked` key can have the same history, because it may have been `error` before it became `revoked`, and P7 cannot see past status (no revoked-at column).

**Fix:** Widen the upper bound of the overlap span to cover the uncapped-carry era. Do the same in the Why paragraph and in the two code/test comments that state the bound.
```sql
AND sd.asof BETWEEN ds.first_asof - 1
                AND greatest(ds.last_asof + 7, DATE '2026-10-19')
```
`2026-10-19` is the v0.132.5.0 deploy date; use the measured deploy instant's UTC date if it differs. Name it in the runbook. Then re-run the fixture gate from plan 02 with a case "last holdings before the window, key eligible, stored non-bulk day inside 2026-09-29..2026-10-18": it must read `not recomputed (D-06)`.

### CR-02 (HIGH, data-integrity): a key that stops working between P7 and the crawl is silently dropped from the whole rebuilt window; the only check that would notice runs after the irreversible write

**Files:**
- `analytics-service/services/equity_reconstruction.py:2717-2725`: the skip is decided on the live `working_holder_predicate` at crawl time.
- `analytics-service/services/equity_reconstruction.py:6863-6865`: the persist-time re-read compares key IDs only.
- `analytics-service/services/equity_reconstruction.py:2498-2519`: `_account_marker_key_ids` stamps the skipped active key.
- `docs/runbooks/marksource-okx-history-correction.md:823-825`: B'5 rule 5's dead-count STOP.

**Issue:** Before D-05, a key that was not working refused the whole allocator (`account_key_not_working`). That failed safe: nothing was written, and the operator could re-enqueue later. Now such a key's exchange account is skipped for the entire window. `working_holder_predicate` treats `sync_status = 'error'` as not working, and `error` is what the holdings poll writes on a transient transport failure (`AllocatorHoldingsSyncTransientError.sync_status = "error"`, error_kind `transient`, `services/allocator_positions.py:331`; also the persist-failure stamp at `services/job_worker.py:12988`). A user-triggered `request_allocator_holdings_sync` or any poll that blips between the operator's P7 run and the job's `_read_account_keys` makes this happen, as does a blip during the crawl:

- P7 measured the key as working, so its holdings were never tested for overlap.
- The job skips its account and replaces all 90 in-window days without it. This understates every in-window day by a whole exchange account that the stored rows correctly held.
- The persist-time re-read (`frozenset` of IDs vs `account.account_key_ids`) cannot see a status change.
- `_account_marker_key_ids` then stamps `history_reconstructed_at` on that still-active key. When the blip clears, the daily fan-out does not treat it as owed, so nothing ever surfaces the hole.
- B'5 rule 5 compares `account_non_working_accounts_excluded` with P7's `dead_exchange_accounts` only after the window replace has committed. B'2's row set is scratch-only and is "not a restore source", so that STOP cannot undo anything.

The phase's own threat entry (T-178-06) lists this post-write STOP as the mitigation.

**Fix (minimal, keeps C1's placement):** Make the P7 prediction a pre-write precondition inside the job.

1. Have the `enqueue` form carry P7's count in the job metadata, for example `jsonb_build_object('force_rebuild', true, 'expected_non_working_accounts', <p7 dead_exchange_accounts>)`.
2. In `_crawl_whole_account`, before any venue call, refuse with an existing re-enqueue-once token (`account_keys_changed`) when it is present and differs from `non_working_excluded`.
3. At persist, also refuse `account_keys_changed` when the set of working key IDs differs from crawl time, not only the full ID set:
```python
expected = (job.get("metadata") or {}).get("expected_non_working_accounts")
if isinstance(expected, int) and expected != non_working_excluded:
    raise ForcedRebuildRefusedError("account_keys_changed")
```
Pin it with a job test where the second key is working in the P7 expectation (expected 0) and `error` at crawl time. It must end FAILED with nothing written and no marker stamped.

The alternative root-cause option is to limit the D-05 skip to keys that fail `eligible_key_predicate` (revoked, disconnected, inactive), which are what the founder's sentence names. `error`/`sign_in_failed` would keep refusing, since the refresh still carries them. That changes the C1 decision and needs the founder's call.

## Warnings

### WR-01 (MEDIUM, data-integrity): P7 cannot see a key that was hard-deleted inside the window, so "if none overlaps, the skip is exact" does not hold

**File:** `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql:74-90, 119-127`; `docs/runbooks/marksource-okx-history-correction.md:927-954` ("What this cannot reach").

**Issue:** `delete_allocator_api_key(p_cascade_holdings => true)` is user-reachable from `AllocatorExchangeManager`. It deletes the key's `allocator_holdings` rows and then the key. It wipes `allocator_equity_snapshots` only when no other key is left, so a multi-key book keeps stored rows that include the deleted account up to its deletion day. A key with holdings cannot be deleted without the cascade (FK `ON DELETE RESTRICT`), so every deleted key that ever polled is gone from both tables P7 reads.

The forced rebuild cannot see it either: `_read_account_keys` reads only existing rows. So a key deleted inside the window gives `dead_keys` 0 and `p7_outcome` `rebuild`, and the rebuild writes those days lower by that account. This limitation existed in the rebuild before 178. It becomes a defect here because P7 is now the stated D-06 guard, and neither P7 nor "What this cannot reach" names the case.

**Fix:** Have P7 count, per label, the key-deletion audit events inside the predicted window. The RPC is under the audit law, `src/__tests__/audit-coverage.test.ts:405`, so the call site must log one. Make a non-zero count rule `not recomputed (D-06)`. Or at least add the case to "What this cannot reach" and to the P7 Why paragraph, so the operator records it instead of trusting the `rebuild` verdict.

### WR-02 (MEDIUM, data-integrity / tests that can fail): no committed test executes the P7 or crosswalk SQL against the Python selection; the semantic gate was run once in scratch and deleted

**File:** `src/__tests__/marksource-okx-census-sql.test.ts:250-261, 304-314, 368-378` (the only new pins). The parity was shown only in 178-02-SUMMARY "Local execution" ("no fixture or gate committed").

**Issue:** The committed pins are textual:

- The file exists and is one statement.
- The runbook contains `- **P7 ` and the string `not recomputed (D-06)`.
- The `user_key`..`exchange_account` block is byte-equal between P7 and `crosswalk`.

None of them fails if the SQL's grouping, deciding-venue rule, state order, dead-key test, carry pad or window-back diverges from `_select_account_crawl_keys` / `_account_rebuild_window` / `CARRY_AGE_CAP_DAYS`. Both sides can move together and stay byte-equal while both are wrong. The 52-triple fixture gate and the five mutations from plan 02 would catch exactly that, but they were deleted.

The operator-time crosswalk fingerprint compares counts only. It never checks the `dead_key` set or the overlap span, and those decide `p7_outcome`, which gates a PROD write. A later edit to `_select_account_crawl_keys` therefore leaves every committed test green.

**Fix:** Commit the plan 02 fixture and gate, for example as a pg-lane gate under `supabase/tests` with `RED-UNDER` annotations so `sql-mutation` exercises it. Add a Python-side parity test that runs the same fixture owners through `_select_account_crawl_keys` and asserts the per-owner `(crawled okx/bybit/other, zero, dead, window_days)` equals the gate's oracle table. The two oracles must stay one table.

### WR-03 (MEDIUM, data-integrity): the runbook now admits a predicted 730-day window, but nothing stops it before the write, and B'1's seam rule and B'6's diff still assume 90 days

**File:** `docs/runbooks/marksource-okx-history-correction.md:541-545` (B'1 "Predicted window ... a dead OKX account beside a working Bybit one gives 730"; seam expected iff `days_before_the_90_day_window` > 0), `:826-828` (rule 5 seam check), `:907-910` (B'6 `window_start` = rebuild date minus 89; `older_rows_changed` must be 0); code at `analytics-service/services/equity_reconstruction.py:6291` (`_account_rebuild_window(selected, ...)` now sees only crawled keys).

**Issue:** After D-05, an allocator with a dead OKX account and a working Bybit account rebuilds 729 days: `window_days` 730, pinned by the new job test. Phase 178's mandate is the 90-day OKX window (CONTEXT domain; the phase cannot correct OKX rows through a dead OKX key anyway). The runbook records that prediction but has no pre-write STOP on `predicted_window_days != 90`. If such a label reaches B'3b, the rebuild replaces about 640 days outside the phase's scope. Afterwards:

- B'1 predicts a seam from the 90-day column, which is wrong for a 729-day window.
- B'6 counts every replaced day between minus 729 and minus 90 as `older_rows_changed`, so the run reports a STOP after the rewrite.

Today P7's overlap usually blocks this path, because a label chosen by in-window OKX suspect days has OKX holdings in the window. That is an indirect guard and not a stated one, and CR-01 shows the overlap test has gaps.

**Fix:** In B'1 (or P7), add an explicit rule: a label whose P7 `predicted_window_days` is not 90 (no crawled OKX account) is left out of `MS_LABELS` and recorded `recorded, not recomputed (no crawled OKX account)`. Optionally emit that as a `p7_outcome` value so the check is mechanical.

---

_Reviewed: 2026-10-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 1 (Python)

Scope: the Python side of CR-01 and CR-02 (the SQL, runbook and vitest side is a second fixer's).

| Finding | Disposition | Commit |
|---|---|---|
| CR-02 / SFH M1 | Fixed. `expected_non_working_accounts` in the forced job's metadata is compared with the dead-account count at crawl-key selection and refuses `account_keys_changed` before any venue call. The persist-time re-read now also compares the working key id set with the crawl's, so a key that stopped working during the crawl refuses too. No new refusal token; the closed-set pin stays green. | 44a8f45ad |
| CR-01 (Python half) | Fixed as wording only. The code comment in `_select_account_crawl_keys` carried no cap claim, so it gained a clause naming the uncapped-carry era (v0.111.0.0 to v0.132.5.0, cap shipped 2026-10-19, checked against `git log -S` and CHANGELOG); the test docstring's "$0 after it" premise now states the cap and the uncapped era. No behaviour changed, so no test applies; the P7 widening and its fixture case belong to the SQL fixer. | e88baa633 |

Metadata key literal for the runbook's enqueue form: `expected_non_working_accounts`, the P7 `dead_exchange_accounts` value for that label as a JSON number. A present value that differs from the job's count (including a non-number) refuses.

RED proof for CR-02: with the two checks neutered (byte backup, restored, `cmp` equal), `test_a_key_that_stopped_working_after_the_operator_reading_refuses_the_rebuild` and `test_a_key_that_stopped_working_during_the_crawl_refuses_the_account` failed with `assert <DispatchOutcome.DONE> == <DispatchOutcome.FAILED>`.

Gates from `analytics-service/`: the three target test files 263 passed; full pytest 13765 passed, 102 skipped (tests/test_xdist_group_is_real.py deselected); CI's mypy line "Success: no issues found in 130 source files".

## Fix round 1 (SQL and runbook)

Scope: the SQL, runbook and vitest side of CR-01, CR-02, WR-01, WR-02, WR-03 and the silent-failure hunt's M1, M2, M3. Nothing touched PROD, TEST or Railway; every execution ran on a socket-only throwaway local cluster.

| Finding | Disposition | Commit |
|---|---|---|
| WR-02 / SFH M3 | Fixed, committed first so the other fixes could be shown RED against it. `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` boots a throwaway cluster the way `accounttruth-census.test.ts` block (6) does (binaries from `scripts/pg-lane/run.sh --print-pgbin`, no skip gate), freezes the clock with a shadowing `public.now()`, and checks every P7 column and every `crosswalk` fingerprint column for the fixture owners against oracles computed from the fixture dates. It also pins P7 against the crosswalk's shared counts. It runs in the ordinary vitest shards, so CI does run it. The existing SQL-lane mechanism (`supabase/tests`, `sql-mutation`) was not used: those gates need the real schema and RED-UNDER annotations and move several censuses, which is new infrastructure for a runbook-only statement. | a77203496 |
| CR-01 | Fixed (SQL, runbook, README). The overlap is now `asof >= first - 1 AND (asof <= last + 7 OR asof BETWEEN 2026-09-29 AND 2026-10-19)`. The review's `greatest(last + 7, 2026-10-19)` would also flag days from `last + 8` to 2026-09-28, before any carry existed; the dates are the CHANGELOG release dates of v0.111.0.0 (carry with no age limit) and v0.132.5.0 (cap of 7), not deploy instants, so the bound is a superset. P7's Why paragraph and the README state the premise. The Python wording half was fixed in round 1 (Python). | 444b8a7bf |
| CR-02 / SFH M1 (runbook half) | Fixed. The `enqueue` form is still one guarded statement, marker first. It is now `WITH RECURSIVE`, carries P7's `user_key` .. `exchange_account` block (pinned byte for byte, as for `crosswalk`), and passes `'expected_non_working_accounts', (SELECT count(*) ... x.state = 'dead')` computed in the statement, never typed. B'3a re-runs P7 right before the write and STOPs on any change in `dead_exchange_accounts`, `dead_keys` or `p7_outcome` (and on a chosen label leaving 90). B'3b and B'5 rule 3 name `account_keys_changed` as "re-run P7, then re-enqueue once". Residual, stated: a key flip in the seconds between the B'3a re-run and the enqueue is baked into the expectation; B'5 rule 5 stays the post-hoc check for that gap. | f2dd9eecb |
| WR-03 | Fixed (text rule). P7, B'1 and the B'3a re-run leave a label whose `predicted_window_days` is not 90 out of `MS_LABELS`, recorded `recorded, not recomputed (no crawled OKX account)`. Not made a `p7_outcome` value: the column is already printed and the rule is one line. | 83dbf83d0 |
| WR-01 | Fixed as a named limit plus a control, not as a mechanical P7 rule. The review's suggested audit-event count is not possible: `delete_allocator_api_key` writes no audit event, no trigger on `api_keys` logs a delete, and the only call site (`AllocatorExchangeManager`) emits none, so a deleted key leaves nothing to count. P7's Why paragraph and "What this cannot reach" now say so, and a chosen label needs the key owner's recorded confirmation that no key of the account was deleted with its holdings inside the predicted window, else it is `recorded, not recomputed (D-06)`. Adding an audit emission is a product change and is not made here. | b1be32d41 |
| SFH M2 | Fixed. The crosswalk section states two explicit aborts: probe and crosswalk on different UTC days or `probe_accounts_total` differing from the summary's `accounts`; and an `ok` record whose fingerprint equals more than one census row's predicted fingerprint (the fixture has two such rows, a1 and a7). | 6f9b65f82 |
| README | One sentence naming the executed gate. | 906a5b40c |

### RED proof (byte backup with `cp -p`, restore, `cmp` equal each time)

Executed gate (`marksource-okx-nonworking-keys-exec.test.ts`, 26 tests), statement neutered:
- `last_asof + 7` to `+ 0`: a2, a4, a6 fail (overlap counts).
- window `ELSE 730` to `ELSE 90`: a4, a8 and the crosswalk-vs-P7 window check fail.
- bulk term dropped from the outcome: a7 fails (`rebuild` for a bulk-written window).
- dead-key same-venue exclusion widened (`AND w.venue = u.venue` removed): a9 fails (`dead_keys` 0, not 1).
- marker reach made one-directional: a5 and the crosswalk-vs-P7 check fail.
- crosswalk `'dead'` to `'crawled'` in the runbook form: seven crosswalk rows fail.
- CR-01 before the fix, with the new owner a10 (dead key's holdings end 2026-07-10, stored days 09-29, 10-01, 10-19 in the uncapped era; 08-01, 09-28, 10-20, 10-25 outside it): overlap 0 and `rebuild` against expected 3 and `not recomputed (D-06)`. Green after the fix; removing only the new `OR ... BETWEEN` clause turns a10 red again.
- CR-02: enqueue state filter `'dead'` to `'crawled'` fails a3 in the executed run; the expectation dropped fails a1; both the vitest text pin and the byte-equality pin (one character of the enqueue copy changed to `'zerx'`) fail.

Text pins in `marksource-okx-census-sql.test.ts` (133 tests, was 126), each seen RED by neutering one phrase of the runbook: CR-01 premise (`v0.132.5.0 (2026-10-19)`) and the SQL literal; CR-02 B'3a re-run sentence and rule 3's `account_keys_changed` sentence; WR-03 three phrases (P7, B'1, B'3a); WR-01 two phrases (P7, "What this cannot reach"); M2 two abort sentences.

### Gates

- `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts src/__tests__/marksource-okx-nonworking-keys-exec.test.ts`: 159 passed (133 + 26).
- `cd analytics-service && <python> -m pytest tests/test_allocator_history_probe.py -q`: 127 passed.
- `npm run -s check:planning-hygiene`: exit 0. eslint on both test files: clean. `tsc --noEmit` reports nothing for the new file.
- The forced job's metadata literal is checked against `RECONSTRUCT_EXPECTED_NON_WORKING_KEY` parsed from the Python module, so a rename on either side turns the vitest pin red.

## Round 2 re-review

**Reviewed:** 2026-10-28T23:03:50Z (UTC; 2026-10-29 local)
**Depth:** deep, scoped to the fix range `1e6baa982..HEAD` and what it touches, read against the whole phase diff `3b065928f..HEAD`
**Scope:** MEDIUM and above only. Nothing touched PROD, TEST or Railway. Executed locally: `npx vitest run` on the two runbook test files (159 passed), and the seven new or affected pytest cases in `test_reconstruct_whole_account.py` (7 passed). One read-only GitHub API call measured the v0.132.5.0 merge CI.
**Files:** the 8 round-1 files plus `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts`.
**Result:** 0 HIGH, 3 MEDIUM. Every round-1 finding is closed or narrowed. Each MEDIUM below is a residual or a new defect introduced by a fix.

### Round-1 closure

| Finding | Verdict | Evidence |
|---|---|---|
| CR-01 | **Closed.** | The overlap at `okx-nonworking-keys.sql:150-151` keeps every stored non-bulk day from 2026-09-29 to 2026-10-19 that falls on or after the key's first holdings day minus 1. Fixture owner a10 pins both edges of the era (09-28 and 10-20 out; 09-29, 10-01 and 10-19 in) and the `first - 1` edge (a9). Checked the era bounds against git: `_fetch_latest_holdings_per_eligible_key` and `CARRY_AGE_WARN_DAYS` first appear in the v0.111.0.0 merge, 2026-09-29 15:27Z, so the first carried refresh label is 09-30 at the earliest. `CARRY_AGE_CAP_DAYS` first appears in the v0.132.5.0 merge, 2026-10-19 20:18Z. Its push CI concluded `success` at 20:31Z, well before the 2026-10-20 05:00Z refresh. One problem with the wording: runbook :524 says "release dates, not deploy instants, so a superset". For the upper bound that reasoning runs the wrong way, because a deploy happens at or after its release date. The bound holds because of the measured CI time and the auto-deploy, not because of the sentence. This is LOW, so it is not filed. |
| CR-02 / SFH M1 | **Closed inside the job. Narrowed but still open at the runbook seam (WR-R2-01).** | The crawl-start check (`equity_reconstruction.py:6304-6310`) refuses before any trade read. `working_key_ids` is built from the `dict(row)` copies `_read_account_keys` returns (`:6185`), so it is a crawl-start snapshot and not a live reference. The persist re-read (`:6889-6895`) refuses on any move in the working set. The three new pytest cases assert FAILED with nothing written and no marker stamped, and the control case runs DONE with `account_non_working_accounts_excluded == 1`. `_enqueue_compute_job_internal` stores `p_metadata` verbatim (migration `20261024120000`), so the key reaches the worker. |
| WR-01 | **Reworded, plus a human control. The reason given for rejecting the mechanical control is false (WR-R2-02).** | See WR-R2-02. |
| WR-02 / SFH M3 | **Closed.** | The new exec test sits in the jsdom project, the same as `accounttruth-census.test.ts`. Neither file is in `NODE_ENV_TEST_FILES` or `LOCAL_STACK_LANE_FILES`, so both run in the ordinary sharded `frontend-test`. `judge` in `scripts/classify-changed-paths.mjs` counts only `.planning/` as docs, so a change limited to `docs/runbooks/**` still runs the shards. There is no skip gate: `beforeAll` throws when `--print-pgbin` fails. Vacuity guards cover the frozen clock and the seeded owner count. The label list is pinned exactly, so an empty result cannot pass the per-label loops. The enqueue case pins `logged.length` before it iterates. Every oracle is computed from fixture dates. The test can fail (fixer's RED proof, re-checked by reading the fixture: changing either era date by one day, or dropping `>= first_asof - 1`, changes a10's or a9's count). |
| WR-03 | **Closed as a text rule.** | Dynamically, the job's dead-count check also refuses when the only OKX account goes dead after enqueue. A hard-deleted OKX sibling still escapes it (folded into WR-R2-01). |
| SFH M2 | **First abort closed. The second abort has no terminal state (WR-R2-03).** | See WR-R2-03. |

### WR-R2-01 (MEDIUM, data-integrity): the job's expectation is the live count at enqueue, not P7's reading, so a key that flips between B'3a's re-run and B'3b is skipped from the whole window, and nothing catches it before the write

**Files:** `docs/runbooks/marksource-okx-history-correction.md:735` (the expectation is a live `count(*)` in the enqueue statement); `:594-599` (B'3a compares two P7 readings by eye, in a separate statement); `analytics-service/services/equity_reconstruction.py:6304-6310` (the job compares against whatever the enqueue computed).

**Issue:** Round-1 CR-02 asked the job to carry **P7's** count. The fix carries a count the enqueue statement recomputes from live `api_keys` at enqueue time. The comparison chain is therefore:

1. P7 (pre-flight) versus the B'3a re-run, by eye.
2. A gap with no check: the operator moves from B'3a to B'3b.
3. The enqueue's live count versus the job's crawl-start count, by the worker.

A key that goes `error` during step 2 is counted dead by the enqueue, so the job's count matches and the account is skipped. The case is the same as round 1:

- The key's last holdings day is yesterday, so P7 would have ruled `not recomputed (D-06)`.
- The rebuild replaces all 90 in-window days without that exchange account.
- B'5 rule 5 sees the mismatch only after the window replace has committed.

The fixer recorded this residual. It was not closed, and no runbook timing rule keeps B'3a/B'3b away from the daily holdings poll (04:00Z), which writes the transient `error` (`AllocatorHoldingsSyncTransientError`). The worker check is also count-only. A hard delete of the OKX sibling between enqueue and crawl start leaves the dead count unchanged, but it moves `_account_rebuild_window` to 730 days while a Bybit account is still crawled. That is the WR-03 rewrite outside the 90-day window, and the job does not check for it.

**Fix (small):**

- Have the renderer read `$MS_SP/p7-before-enqueue.csv` and inline each chosen label's `dead_exchange_accounts` and `predicted_window_days` as a `VALUES` list. It is rendered, not typed.
- The `enqueue` statement targets a label only when its live count equals the rendered P7 value. Otherwise `accounts_targeted` is below the label count, and B'3c names the label.
- The metadata carries the rendered P7 value, not the live recount.
- Add `expected_window_days` to the metadata. The worker refuses `account_keys_changed` when `_account_rebuild_window(selected, end_date)[1]` differs from it.

Pin both checks with the existing two-account fixtures. Alternatively, add a B'3a/B'3b timing rule that forbids the 03:30-06:45Z poll and refresh band (the band the v0.132.5.0 CHANGELOG already names for deploys). This narrows the gap; it does not close it.

### WR-R2-02 (MEDIUM, data-integrity): WR-01's control rests on a false premise. A hard-deleted key DOES leave a countable trace, and the tracked text and a vitest pin now say it does not

**Files:**
- `docs/runbooks/marksource-okx-history-correction.md:527-535`: "Such a key leaves nothing ... for this file to find"; the control is "the key owner's confirmation".
- `:1049`: "a fifth case no read can see".
- `:1074`: "(Phase 178, unmeasurable)".
- `src/__tests__/marksource-okx-census-sql.test.ts:628, :635`: these pin that wording.
- The round-1 fix table: "a deleted key leaves nothing to count".

**Evidence:**

- Every holdings poll writes an audit row per key: `allocator.holdings.sync_completed` (`analytics-service/services/job_worker.py:13013`) or `sync_failed` (`:12761`, `:12864`). Each is `_emit_audit(allocator_id, api_key_id, ...)`, which logs `user_id = allocator`, `entity_type = 'api_key'`, `entity_id = <key id>` (`:1867-1896`). The refresh's own docstring says "a daily poll writes one per key per day" (`equity_reconstruction.py:3828`).
- `delete_allocator_api_key` (latest body in migration `20261028120000`) deletes `allocator_holdings`, `api_keys` and, on the last key, the snapshots and seam. It never touches `audit_log`.
- `audit_log.entity_id` is a plain `uuid NOT NULL` with no FK (`supabase/schema/baseline.sql:13169-13177`), and hot rows are kept 2 years (`:13201`, `:15576`).
- A key cannot have holdings without a completed poll. So every key that was deleted with holdings inside the window left `api_key` audit rows inside the window whose `entity_id` is no longer in `api_keys`.

The fixer was right that the delete itself emits nothing. But "nothing to count" does not follow from that, and on this premise the runbook replaces an available read-only mechanical check with the owner's memory of the last 90 days.

**Fix:**

- Add one column to P7: per label, `deleted_keys_seen_in_window`. This is `count(DISTINCT al.entity_id)` from `public.audit_log al` where `al.user_id` is the allocator, `al.entity_type = 'api_key'`, `al.action LIKE 'allocator.holdings.%'`, `al.created_at` is on or after (today minus `window_back_days` minus 8), and `NOT EXISTS` an `api_keys` row with that id.
- Make a non-zero value rule `not recomputed (D-06)` in the `p7_outcome` CASE.
- Add an `audit_log` stand-in and a fixture owner to the exec test, and show the new term RED by neutering it.
- Correct the three runbook sentences and the two vitest pins. Keep the owner's confirmation only as a backstop for a dropped audit (`_emit_audit` is fire-and-forget).

### WR-R2-03 (MEDIUM, data-integrity / phase goal): the new fingerprint-uniqueness abort has no terminal outcome, "re-run" cannot clear it, and plan 03's line grammar has no value for it

**Files:** `docs/runbooks/marksource-okx-history-correction.md:284-287`; the operator plan that runs it, `178-03-PLAN.md:123` (planning artifact, cited as evidence), whose `crosswalk:` line accepts only `match|mismatch|not-comparable|no-probe-record`.

**Issue:**

- The abort fires when an `ok` record's six-count fingerprint equals more than one census row. The runbook's remedy is "Re-run the probe and the crosswalk".
- A tie is structural. Two accounts with the same key shape print the same six counts on every run, so re-running changes nothing.
- The committed fixture already has one (a1 and a7 in `XW_EXPECTED` are identical, including `snapshot_days`).
- PROD likely has one among the targets. D-01's background says 4 of the 5 OKX accounts held a revoked Bybit key beside working OKX. After D-05 that shape prints `okx 1, bybit 0, other 0, zero 0, excluded 1, window 90` for each such account.

A persistent tie leaves the operator with two paths, both bad:

- Loop forever on the abort, which blocks every tied target with no recorded outcome.
- Follow plan 03, whose grammar records `fingerprint=match` and proceeds, mapping by label order alone. That is the exact D-02 failure M2 was raised to prevent: a target written on another account's ordering reading.

**Fix:**

- Name the terminal state. A tie that survives one same-day re-run is recorded `recorded, not recomputed (crosswalk ambiguous)` and left out of `MS_LABELS`, unless the founder's recorded ruling says otherwise.
- Or add a discriminating field that the probe record already prints (for example `keys_total`, or the job key's venue and created day) to both sides of the fingerprint.
- Add `fingerprint=ambiguous` to plan 03's `crosswalk:` grammar and to its verify, so the abort cannot be recorded as `match`.

### Checked in round 2 and found sound (no finding)

- The enqueue form is still one guarded write. The `DO $guard$` marker check runs first. The statement adds only `SELECT` CTEs; `enqueue_compute_job` is its only call; it runs as written under `WITH RECURSIVE` on the exec test's cluster. The text pin and the byte-equality pin on the shared `user_key` .. `exchange_account` block cover the new copy.
- The worker literal is parsed from the Python module by the vitest pin, so a rename on either side goes red. `count(*)` gives a JSON number, which compares to Python `int` as intended.
- Count parity between SQL and Python. Both read every `api_keys` row of the user. Both put Deribit first, then dead, then refused or crawled. Both count dead groups, not keys. `account_groups` union-find equals the `reach` closure. Exec-test owner a9 pins "dead key, but no dead exchange account" (expectation 0).
- The persist working-set check can refuse falsely when a working Deribit key or another non-crawled key changes status mid-crawl. That is fail-safe (`account_keys_changed`, re-enqueue once), so it is LOW.

_Round 2 reviewed: 2026-10-28T23:03:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 2 (Python)

**Commit:** `795972b36` (`analytics-service/services/equity_reconstruction.py`, `analytics-service/tests/test_reconstruct_whole_account.py`).

| Finding | Disposition |
|---|---|
| WR-R2-01 / SFH R2-2 (window half) | Fixed in the worker. New constant `RECONSTRUCT_EXPECTED_WINDOW_KEY`, literal `"expected_window_days"`, next to `RECONSTRUCT_EXPECTED_NON_WORKING_KEY`. `_crawl_whole_account` now computes `_account_rebuild_window` first (pure, no venue call) and, at the same place as the existing check, refuses `account_keys_changed` when the key is present and differs from `window_days`. Absent means no expectation. The runbook enqueue form and the P7 rendering that carries the value are the SQL and runbook fixer's half. |
| SFH R2-1 (worker half) | Fixed. Both expectation values must satisfy `type(value) is int`, so JSON `true` and `1.0` refuse. This is a clause in the same condition, not a new check. R2-1's other half (an `expectation_armed` column in B'3c) is the SQL and runbook fixer's. |
| SFH N3 | Tests added for a bool, a float, a string and a null value of the existing key, and the same for the new key. |
| SFH R2-3 | Python has nothing to change; the binding comparison at enqueue is the runbook's. |

The refusal literal is unchanged (`account_keys_changed`), so the closed-set pin needed no edit.

**New tests** (`test_reconstruct_whole_account.py`): `test_a_non_integer_dead_count_expectation_refuses_even_when_it_equals_the_count` (bool, float, string, null), `test_a_window_that_differs_from_the_operator_reading_refuses_the_rebuild`, `test_a_non_integer_window_expectation_refuses_the_rebuild` (float, string, null), and the control `test_a_window_that_matches_the_operator_reading_lets_the_rebuild_run`. All refusal cases assert FAILED, no venue call and nothing written.

**RED proof** (byte backup of the service file with `cp -p`, neuter, run, restore, `cmp` equal each time):

- Old check restored (no type test, no window): 6 failed, 5 passed. Red: dead-count `bool` and `float`, the window mismatch, and window `float`, `string`, `null`. (The dead-count `string` and `null` cases were already refused by the old `!=`, so they are N3 coverage, not RED.)
- Type test dropped only: 3 failed (dead-count `bool` and `float`, window `float`).
- Window tuple dropped only: 4 failed (window mismatch, window `float`, `string`, `null`).

**Gates**, from `analytics-service/`: the three target files plus the force-rebuild file, 272 passed; full pytest with `tests/test_xdist_group_is_real.py` deselected, 13774 passed, 102 skipped; CI's `mypy --strict` line, no issues in 130 files.

_Fix round 2 (Python) applied: 2026-10-29_

## Fix round 2 (SQL and runbook)

Scope: WR-R2-01, WR-R2-02, WR-R2-03 (all MEDIUM, data-integrity), SFH R2-1, R2-3, N1 and N2, on the SQL, runbook, tests and plan 03. Nothing touched PROD, TEST or Railway; every execution ran on the exec test's socket-only throwaway cluster.

| Finding | Disposition | Commit |
|---|---|---|
| WR-R2-02 | Fixed. The premise was true: `_emit_audit` (`job_worker.py`, `entity_type='api_key'`, `entity_id` the key, `user_id` the allocator) writes `allocator.holdings.sync_completed` / `sync_failed` on every poll, `audit_log.entity_id` has no FK (`baseline.sql`), `delete_allocator_api_key` never touches `audit_log`, hot rows are kept 2 years. P7 gains `deleted_keys_seen_in_window` (distinct `entity_id`s of those two actions for the allocator, on or after today - `window_back_days` - 8, absent from `api_keys`); above 0 rules `not recomputed (D-06)` before the existing CASE arms. The tie to the allocator is `audit_log.user_id`, which exists, so the default-deny was not needed as the primary control; the owner's confirmation stays as the backstop for a dropped (fire-and-forget) audit write. The runbook's three "unmeasurable" sentences and the vitest pin are corrected; README row updated. | e7b431788 |
| WR-R2-01 / SFH R2-3 | Fixed. The renderer's new `__EXPECTED__` reads `p7-before-enqueue.csv` (the B'3a re-run) and renders `(label,dead_exchange_accounts,predicted_window_days)` per chosen label, exiting 2 on a missing or empty file, a quoted field, a chosen label with no row, a label whose `p7_outcome` is not `rebuild` or whose window is not 90, or a non-integer count. The `enqueue` form targets a label only when its statement-time dead-account count and window equal the rendered values, and the metadata carries the RENDERED values as `expected_non_working_accounts` and `expected_window_days` (both literals pinned against the Python constants). B'3a gains the timing rule (band opens 30 minutes before the manifest's `poll-allocator-positions` slot and closes 105 minutes after its `refresh-allocator-equity` slot, both read from the manifest at run time; pinned, with a vacuity check that both jobs exist in the manifest) and the STOP now covers an errored, empty or label-less re-run (SFH wording gap). B'3b and B'5 rule 3 mention the window; a hard-deleted OKX sibling between enqueue and crawl start is caught by the worker's window check from the Python round. | 3848481b4 |
| SFH R2-1 | Fixed. The `newjob` form gains `expectation_armed` (every forced job since t0 carries both keys as JSON numbers, and at least one exists); B'3c requires `forced_jobs_since_t0` 1 and `expectation_armed` true for every label and STOPs otherwise, before the worker claims a still-pending job. | 3848481b4 |
| WR-R2-03 / SFH N2 | Fixed. A fingerprint tie is no longer a runbook-wide abort; each tied census row is recorded `recorded, not recomputed (crosswalk ambiguous)` and left out of `MS_LABELS`, unless the founder rules otherwise at the plan 03 checkpoint (the exec test shows a1 and a7 tie in the fixture, so the state is reachable). `178-03-PLAN.md`: the `crosswalk:` grammar and verify accept `fingerprint=ambiguous`, step 9 adds the `predicted:` value, the verify gains a check that an ambiguous non-D-06 target is predicted exactly that, and (necessary for the verify to stay coherent with the new P7 column) the `p7:` line carries `deleted_keys_seen=<n>` and its outcome-consistency awk treats a non-zero value as `not recomputed (D-06)`. Fragments of the verify were run on a mock summary (the outcome awk flags a `rebuild` with `deleted_keys_seen` 1; the ambiguous loop flags a target predicted `rebuild expected`); `verify plan-structure` valid. | 60133dd65 |
| N1 (LOW) | Fixed, one clause: the upper bound now states the measured CI time (`2026-10-19T20:31Z`, before the 2026-10-20 05:00Z refresh). | 48ba80225 |
| SFH N4 (LOW) | Not fixed (below the bar). | none |

### RED proof (byte backup with `cp -p`, neuter one thing, run, restore, `cmp` equal each time)

Executed gate, `okx-nonworking-keys.sql` (fixture owner a11 plus controls on a1):
- outcome term `> 0` made `> 99`: a11 red. Pad `- 8` to `- 7`: a11 red (its key on the pad's first day); `- 8` to `- 9`: a1 red (its key one day before). `count(DISTINCT ...)` to `count(...)`, the action filter, the `entity_type` filter: a11 red. `NOT EXISTS` dropped: a1 red. Join on `user_id` dropped: all eleven rows red.

Executed gate, runbook forms:
- `enqueue`: the dead-count equality neutered, or the window equality neutered, or the `expected_window_days` metadata key dropped: the "does not target a label whose live count or window differs from the rendered P7 reading" case goes red (a6, a3, a2, a9 are targeted), and the end-to-end and per-label metadata cases go red for the dropped key.
- `newjob` `expectation_armed`: the window `number` test dropped, `count(c.id) > 0` dropped, `= count(c.id)` made `>= 1`, the dead-count `number` test made `IS NOT NULL`: the armed case goes red each time (a3, a7, a6, a5 respectively).
- renderer: the `p7_outcome` guard, the window guard, the missing-label check, the empty-file check each removed: the renderer refusal case goes red.

Text pins: the P7 audit-trace sentences, "fire-and-forget", the "What this cannot reach" bullet, the B'3a STOP sentence, the timing sentence ("never from memory"), a renamed manifest job, the B'3c STOP, rule 3's wording, the old runbook-wide abort restored, the dropped `crosswalk ambiguous` end state, the dropped founder clause, N1's measured time, and a renamed `RECONSTRUCT_EXPECTED_WINDOW_KEY` literal in the Python module: each turns one named pin red. The redundant `lines.length < 2` renderer check was removed after its neuter showed no behaviour change (the missing-label check covers a header-only file).

### Gates

- `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts src/__tests__/marksource-okx-nonworking-keys-exec.test.ts`: 170 passed (138 text and renderer, 32 executed; was 159).
- `cd analytics-service && <python> -m pytest tests/test_allocator_history_probe.py -q`: 127 passed.
- `npm run -s check:planning-hygiene`: exit 0. eslint on both test files: clean. `verify plan-structure` on `178-03-PLAN.md`: valid.

### Carried to the caller

- Plan 04 (not edited): its pre-flight reuses plan 03's `p7:` and `crosswalk:` line formats, which now carry `deleted_keys_seen=` and may read `fingerprint=ambiguous`; it runs B'3a to B'3c from the runbook, so its operator will meet the renderer's `__EXPECTED__` and the `expectation_armed` STOP.
- The renderer's `__EXPECTED__` depends on `supabase db query -o csv` printing unquoted plain fields, as `rowdiff.mjs` already assumes; a quoted CSV refuses loudly (exit 2) rather than rendering a wrong list.

_Fix round 2 (SQL and runbook) applied: 2026-10-29_

## Round 3 re-review

**Reviewed:** 2026-10-29T07:49:30Z
**Depth:** deep. Scoped to the round-2 fix range `d9e4b4e2e..HEAD`: the worker guard, `okx-nonworking-keys.sql`, the README, the runbook's renderer, `enqueue`, `newjob`, B'3a and crosswalk text, both vitest files, and `178-03-PLAN.md`. Read against the whole-phase diff `3b065928f..HEAD`, against `178-04-PLAN.md` (not edited in round 2), and against origin/main at `dff2d4ecf`.
**Scope:** MEDIUM and above only. Nothing touched PROD, TEST, Railway or `supabase --linked`. Executed locally:
- the two runbook vitest files: 170 passed (the exec file ran on its own socket-only throwaway cluster);
- 15 selected cases in `test_reconstruct_whole_account.py` (expectation, window, stopped-working and operator-reading): 15 passed.

**Result:** 0 HIGH, 1 new MEDIUM (WR-R3-01). The silent-failure hunt's round-3 findings R3-1 to R3-4 are confirmed and not repeated here.

### Round-2 closure

| Finding | Verdict | Evidence |
|---|---|---|
| WR-R2-01 | **Closed for what it names.** Residual: WR-R3-01. | Renderer `__EXPECTED__` block (runbook `form.mjs`): it exits 2 on each of these: a missing, empty or header-only file; a quoted field; a missing label; a non-`rebuild` outcome; a window other than 90; a non-integer count. The `enqueue` statement targets a label only when the live values equal the rendered ones (runbook :770-771). The metadata carries the rendered values (:791-792). The worker computes `_account_rebuild_window` (pure) and then checks both keys as exact integers before any venue call (`equity_reconstruction.py:6310-6319`). Every forced job reaches that check, because the forced branch always calls `_crawl_whole_account` (:6596-6615). A non-dict metadata is unforced (:2544-2555), so a string-typed metadata cannot skip the check. |
| WR-R2-02 | **Closed.** Residual: R3-3 (confirmed). | `okx-nonworking-keys.sql:161-172`, with the outcome arm first (:188-189). Premise re-checked end to end:<br>- `_emit_audit` passes the allocator as `user_id` with `entity_type="api_key"` (`job_worker.py:1867-1903`).<br>- `log_audit_event_service` raises on a NULL `p_user_id` and never derives it from `auth.uid()` (baseline).<br>- MT5 polls go through the same handler.<br>- The emission dates from 2026-04-20, well before the pad.<br>For R3-3, note that Python spells the action set twice: the `AllocatorHoldingsAction` Literal (`job_worker.py:1834-1839`) and `_POLL_COMPLETED_ACTION` (`equity_reconstruction.py:3836`). A parity pin can parse the Literal. |
| WR-R2-03 | **Closed as a recorded outcome.** Residual: R3-4 (confirmed). | Runbook "One abort and one per-label outcome". Plan 03 step 2 grammar, step 9 `predicted:` value, and the verify's ambiguous loop. The `p7:` awk fields are correct after the new column: `$8` is `deleted_keys_seen`, `$9` the outcome. |
| SFH R2-1 | **Closed.** Residual: R3-1 (confirmed). | Exact-integer test in the worker. `expectation_armed` in `newjob` is correct as written (exec test, owners a1/a3/a5/a6/a7). `grep -c expectation_armed 178-04-PLAN.md` returns 0. |
| SFH R2-2 | **Window half closed.** | A SQL-vs-Python window drift now refuses `account_keys_changed` before any venue call instead of writing 730 days. The Python-side parity test is still absent. Because a drift now fails closed, it is not re-filed. |
| SFH R2-3 | **Closed.** Residual: R3-2 (confirmed). | Statement-time equality, :770-771. |

### WR-R3-01 (MEDIUM, data-integrity): the pre-write contract is two counts, so a hard-deleted working key or a dead/working swap after the B'3a re-run drops an exchange account from the whole window, and B'3b says that cannot happen

**Files:**
- `docs/runbooks/marksource-okx-history-correction.md:658-663`: the claim "a key that stopped working or was deleted after the B'3a re-run cannot be skipped from a window the operator measured as complete".
- `:770-771`: the statement compares counts.
- `:790-793`: the metadata carries counts.
- `analytics-service/services/equity_reconstruction.py:6308-6319`: the worker compares counts.
- `:6895-6902`: the persist re-read compares with the crawl-start sets, never with the operator's reading.
- Runbook rule 5 (:1010): `account_key_count` equal to B'1's `keys_total`, checked only after the write.

**Issue:** the operator's B'3a reading reaches the job only as `(dead_exchange_accounts, predicted_window_days)`. Two key changes leave both numbers where they were.

1. **A working key is hard-deleted.** The key belongs to a crawled exchange account that is not the only crawled OKX account, for example a working Bybit or MT5 sibling, or a second OKX account. Its group disappears; it does not become dead, so the dead count is unchanged and the window stays 90. Then:
   - The enqueue targets the label.
   - The worker's crawl-start check passes.
   - `_read_account_keys` no longer returns the key, so `account_key_ids` and `working_key_ids` are taken without it.
   - The persist re-read matches that set.
   - The window replace writes every in-window day without the account, although the stored rows held it up to its deletion day.

   `deleted_keys_seen_in_window` would rule the label `not recomputed (D-06)`, but P7 is not run again after B'3a. The first check that sees the change is B'5 rule 5 (`account_key_count` one below `keys_total`), and it runs after the replace has committed.
2. **A swap.** One dead account revives: an `error` or `sign_in_failed` key whose next poll succeeds (the poll skips only revoked keys). At the same time another account's key goes `error` or `sign_in_failed`. The dead count and the window are unchanged.
   - The newly dead account is the one skipped. Its holdings are current, so P7 would have ruled the label `not recomputed (D-06)` on overlap, and B'3a's re-run would have stopped.
   - The job compares only the count. B'5 rule 5 compares the same count and passes, so this case is fully silent.

**How wide the gap is:** it opens after the B'3a re-run and closes at the crawl's key read. At minimum that is minutes. A forced job can be DEFERRED (an exchange cooldown on any key of the account, or the READCEILING claim budget; runbook B'4). Each claim re-reads the keys and compares them only with the two counts, so the gap can last hours and can include the daily poll. The B'3a timing band covers only the first claim.

This gap became the binding one when WR-R2-01's fix made the two counts the job's contract, and the runbook now states that binding as complete.

**Fix:** bind the key set, not two counts of it. The smallest complete version:
1. P7 prints, per label, `key_state_digest = md5(string_agg(u.id::text || ':' || u.working::text, ',' ORDER BY u.id))` over `user_key`. It is a hash, so P7's output stays id-free. It stays in scratch, as the CSV does.
2. The renderer carries the digest in `__EXPECTED__`. The `enqueue` statement targets a label only when the live digest equals it, and writes it to the metadata as `expected_key_state_digest`.
3. The worker computes the same string from `account_keys` at crawl start (ids sorted, `working_holder_predicate` for the flag). It refuses `account_keys_changed` on a mismatch. Because this runs on every claim, a deferral is covered.

A cheaper partial fix: the `enqueue` statement writes the live sorted `(id, working)` list into the metadata, and the worker compares it at each claim. That closes the enqueue-to-crawl gap and deferrals, but not the minutes between the B'3a re-run and the enqueue.

**Tests to add:**
- An expectation that names two working siblings, with one absent at crawl start: the job ends FAILED, nothing is written and no marker is stamped.
- A swap with an equal dead count and a different digest: the job ends FAILED.
- An exec-test case where the enqueue skips a label whose live digest moved.

Then change the B'3b sentence to claim only what the contract binds.

### Plan 04's D-03 precondition against origin/main `dff2d4ecf`: reads correctly

- `close_agrees` is at `analytics-service/services/okx_opening_balance.py:298` on origin/main, so `d03-close-fix` holds at any deployed SHA from 0.133.9.1 on.
- `OPENING_TOLERANCE_REL: Final[float] = 0.02` is at :127. Plan 04's `sed -nE 's/^OPENING_TOLERANCE_REL[^=]*= *([0-9.]+).*/\1/p'` extracts `0.02`.
- `179-05-SUMMARY.md` exists on the 179 feature branch but not on origin/main yet (only `.gitkeep` is there). It carries `tolerance-founder-decision: Tighten to 2%` and `tolerance-rel-after: 0.02 (pending replan)`. Plan 04's `([0-9.]+).*` reads that as `0.02`.
- Instruction 4's "(pending replan) is a STOP" is conditioned on "not deployed yet". The replan shipped as 0.133.9.2.

So once 179's records PR lands and Railway runs at or after `dff2d4ecf`, `d03-tolerance: rel_after=0.02 deployed_rel=0.02` passes. Before that, the verify fails closed, because the file is absent. Two consequences, neither a defect:
- The tightening edits `okx_opening_balance.py`. A plan 03 probe taken before 0.133.9.2 was deployed therefore fails plan 04's `git diff --quiet` probe-currency test and forces a re-probe. That is the intended outcome: a target whose opening is between 2% and 5% off now refuses `disagreed`, and the re-probe shows it.
- Phase 179 stays open until 179-07 re-reads a4 on 0.02. D-03's "179's post-deploy re-read" was 179-05's reading when the founder chose it, so plan 04 does not wait for 179-07. That is a reading of the decision, not a defect. Raise it only if the founder meant the later re-read.

### Plan 03 and plan 04 against the runbook

- Plan 03 matches the runbook: the `p7:` grammar carries `deleted_keys_seen`; `ambiguous` is in the crosswalk grammar, in step 9 and in the verify.
- Plan 04's mismatches are the silent-failure hunt's R3-1 (no `expectation_armed`, no B'3a re-run line) and R3-4 (an ambiguous label can never pass), plus its LOW notes N8 and N9. Nothing further at MEDIUM.
- Noted below the bar: the B'3a timing band's parenthetical "(03:30Z to 06:45Z at the committed manifest)" goes stale as soon as MARKSOURCE plan 08's Step B moves both jobs toward 00:10Z, and D-04 requires that cut-over before any write. The rule itself reads the manifest at run time, and plan 08's Step C re-captures it, so only the example is stale.

### Checked in round 3 and found sound (no finding)

- **Renderer against the CLI's CSV.** No field the renderer reads can need quoting: `not recomputed (D-06)` has no comma, and a quoted field refuses. Columns are found by header name, so the new P7 column moves nothing.
- **Types end to end.** The `VALUES` integers compare to `count(*)` bigints, become JSON numbers in `jsonb_build_object`, and arrive in Python as `int`. That is what the exact-integer test expects.
- **No crash path from the moved window call.** Moving `_account_rebuild_window` ahead of the check adds none: `selected` is never empty there, because the selection raises first.
- **Over-blocking by `deleted_keys_seen_in_window` fails safe.** These all count: a deleted Deribit key, a deleted login whose exchange account another key still covers, and a key that polled but never held. Each rules the label `not recomputed`, the safe direction, so none is a data-integrity path.

_Round 3 reviewed: 2026-10-29T07:49:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Fix round 3 (Python)

**Scope:** WR-R3-01, Python half only. The SQL and runbook half (P7's `key_state_digest` column, the renderer, the `enqueue` statement and the B'3b sentence) follows in a separate round and must produce the value below.

| Finding | Disposition | Commit |
|---|---|---|
| WR-R3-01 | Fixed (Python half). The forced job now holds a third pre-write expectation next to the two counts. | `d9100ab8a` |

**What changed** (`analytics-service/services/equity_reconstruction.py`):
- New constant `RECONSTRUCT_EXPECTED_KEY_DIGEST_KEY`, and a pure helper `_account_keys_digest(account_keys)`.
- `_crawl_whole_account` compares it in the same `any(...)` as the dead-count and window checks, before any venue call, on every claim. The existing per-key test became `type(value) is not type(actual) or value != actual`, so the two integer expectations behave as before and the digest must be a `str`. A mismatch or a non-string value refuses `account_keys_changed`; an absent key is no expectation. No new refusal token, so the closed set is untouched.

**Exact metadata literal:** `expected_key_digest`

**Canonical form** (the SQL side reproduces it exactly):
1. Input is every `api_keys` row the selection reads (`_read_account_keys`: all rows of the allocator, active or not).
2. Sort by the id's text (SQL: `ORDER BY id::text COLLATE "C"`, the byte order Python's `sorted` on `str` uses).
3. Render each row as `<id>:<flag>`, with `t` when `working_holder_predicate` is true (active, not disconnected, `sync_status` NULL or not one of revoked, sign_in_failed, error) and `f` otherwise.
4. Join with `|`, no spaces and no trailing separator.
5. Digest is the lower-case hex MD5 of that UTF-8 string (SQL: `md5(string_agg(id::text || ':' || CASE WHEN working THEN 't' ELSE 'f' END, '|' ORDER BY id::text COLLATE "C"))`).

**Pinned digest literal** (pytest `test_the_key_set_digest_has_the_canonical_form_the_sql_side_reproduces`): the fixed key list `key-a` working, `key-b` `sync_status` `error`, `key-c` disconnected, `key-d` `sync_status` NULL (working), `key-e` inactive renders as `key-a:t|key-b:f|key-c:f|key-d:t|key-e:f` and hashes to

`b686b2e1962180296772b08bb7e395c1`

The SQL fixer should pin the same literal against the same string.

**Tests added** (`analytics-service/tests/test_reconstruct_whole_account.py`): the canonical-form pin above; the reviewer's two cases (a working sibling absent at crawl start with both counts equal, and a dead/working swap across three keys with equal counts); a parametrized non-string digest refusal (int, null, bool, list); and a matching-digest control that ends DONE. Each refusal asserts FAILED/permanent `account_keys_changed`, no venue call, no row changed, no marker stamped, no replace call.

**RED proof:** byte backup (`cp -p`), the one digest tuple line deleted from the check, the new tests run: 6 failed (the two reviewer cases and the four non-string cases), 2 passed (the canonical-form pin and the control, which do not depend on the check). Restored from the backup and `cmp` reported the files identical.

**Gates** (from `analytics-service/`, read-only interpreter of the sibling checkout): the three target files (`test_reconstruct_whole_account.py`, `test_reconstruct_force_rebuild.py`, `test_closed_sets.py`) 191 passed; full pytest with `tests/test_xdist_group_is_real.py` deselected 13782 passed, 102 skipped; CI's mypy line verbatim: no issues in 130 source files.

_Fixed: 2026-10-29_
_Fixer: Claude (gsd-code-fixer)_

## Fix round 3 (SQL, runbook and plans)

Scope: the SQL, runbook, vitest and plan half of WR-R3-01, plus the silent-failure hunt's R3-1 to R3-4 and the below-the-bar B'3a example (all MEDIUM, data-integrity except the example). Nothing touched PROD, TEST or Railway; every execution ran on the exec test's socket-only throwaway cluster. No digest, id or count of real data was written to tracked text; the only digest in tracked text is the synthetic `key-a:t|...` literal the Python round pinned.

| Finding | Disposition | Commit |
|---|---|---|
| WR-R3-01 (SQL half) | Fixed. `okx-nonworking-keys.sql` prints `key_digest` per label (`md5(string_agg(id::text \|\| ':' \|\| CASE WHEN working THEN 't' ELSE 'f' END, '\|' ORDER BY id::text COLLATE "C"))` over every key of the allocator, the form the Python round fixed). The renderer's `__EXPECTED__` now carries it from the B'3a re-run csv as a quoted hex literal and exits 2 on a missing or malformed digest (a re-run file from before the column exists is refused too). `enqueue` has the same `key_digest` CTE (pinned byte-equal to P7's), targets a label only when the live digest equals the rendered one, and writes the rendered digest as `expected_key_digest` (pinned against `RECONSTRUCT_EXPECTED_KEY_DIGEST_KEY`). `newjob`'s `expectation_armed` also requires the digest key to be a JSON string. The expression, executed on the exec test's cluster over the Python round's key list (rows fed scrambled so the aggregate's ORDER BY is what orders them), gives `b686b2e1962180296772b08bb7e395c1`; P7's printed digest is checked against an independent JS computation from the fixture. New exec case: with both counts and the window unchanged, a Deribit key going `error` and the same key hard-deleted each move the digest, and the enqueue skips that label while targeting the others. The B'3b sentence now claims only what the contract binds (the key set and each key's working flag, on every claim) and says it does not bind P7's other inputs; B'3a STOPs on a moved digest; README row updated. | 4bd133747 |
| SFH R3-1 | Fixed. Plan 04 Task 2 now records `b3a-p7:` per written label (the re-run's seven fields beside the pre-flight's, digest written only as `equal`) and `newjob:` lines with `forced_jobs_since_t0=1 expectation_armed=true`; `REBUILD_OK` requires all of it, cross-checking `pre=` against Task 1's `p7:` line. The runbook sentence that promised an operator could act "before the worker claims it" is reworded: the check is detective, the job may already have started. | e4a054983 (plan), 492ad6108 (runbook) |
| SFH R3-2 | Fixed. The renderer refuses (exit 2) a `p7-before-enqueue.csv` modified before `MS_T0`. B'3a compares the re-run with `p7-nonworking.csv` on every P7 input (`dead_exchange_accounts`, `dead_keys`, the overlap and bulk day counts, `deleted_keys_seen_in_window`, `p7_outcome`, `key_digest`, window 90) and STOPs on any difference; every B'3a, a re-enqueue included, exports a fresh `MS_T0` and re-runs P7. The database-clock versus local-clock skew is stated. | 4e22200fd |
| SFH R3-3 | Fixed. A vitest case parses `AllocatorHoldingsAction` and the `_emit_audit` call sites in `job_worker.py`, `_emit_audit`'s `entity_type`, `user_id=allocator_id`, `entity_id=api_key_id`, and `_POLL_COMPLETED_ACTION` in `equity_reconstruction.py`, and requires P7's two actions and `entity_type` to be members of / equal to them. | 60cde102e |
| SFH R3-4 | Fixed, by dropping the unreachable clause. The crosswalk SELECT gains `fingerprint_ties` (the OTHER census rows sharing the six predicted counts). Plan 03's `crosswalk:` line carries `ties=<n>` and its verify rejects a tie recorded `match` or `mismatch` and an `ambiguous` at `ties=0`; plan 04 requires `ties=0 fingerprint=match` for a written label. The runbook's "unless the founder rules otherwise" is deleted from the crosswalk section and plan 03: no ruling can prove the mapping, so making the clause reachable would have re-opened the D-02 failure the tie exists to prevent. If the founder wants ambiguous labels writable, that is a runbook change that proves the mapping by other means, not a ruling. | aceb2fc6c (runbook, tests), e4a054983 (plans) |
| B'3a example (below the bar) | Fixed. The "(03:30Z to 06:45Z at the committed manifest)" parenthetical is gone and a test refuses a clock band in B'3a. | 0b341e482 |

Found while testing the plan verify fragments, fixed in the plan commit: `MS=$(... \| grep -c .)`, `RE=$(grep -c ...)` and `RC=$(grep -c ...)` in plan 04 Task 2 and `T=$(... \| grep -c .)` in plan 03 Task 2 exit 1 on a count of 0, which breaks the `&&` chain, so `REBUILD_OK` could never print for `ms-labels: none`, for zero re-enqueues or for zero recomputed labels, and `MEASURE_OK` could never print for `targets: none`. Each now ends `|| true` inside the substitution.

### RED proof (byte backup with `cp -p`, neuter one thing, run, restore, `cmp` equal each time)

- Digest: `COLLATE "C"` dropped (only the byte-equal and expression text pin goes red: the cluster is C-locale, so the executed literal cannot see it); `ORDER BY` dropped (pinned-literal, live-mutation, end-to-end and block-equality cases red); `'t'`/`'f'` swapped (all eleven P7 oracle rows and the pinned literal red); enqueue digest equality dropped (the live-mutation case, both scenarios, and the text pin red); enqueue metadata key dropped (per-label, end-to-end and literal-parity red); `newjob` string test dropped (the armed case and its text pin red); renderer digest regex dropped (renderer refusal case red); the Python constant renamed (literal-parity red); enqueue's block altered (five cases red); the B'3b "does not bind" sentence and the B'3a digest STOP each removed (text pin red).
- Freshness: the mtime test neutered (new accept/refuse case red); the compare list shortened and the pre-flight file unnamed (B'3a pin red).
- Audit trace: Literal entry renamed, call site renamed, `entity_type` renamed, `entity_id` changed, `_POLL_COMPLETED_ACTION` renamed, the SQL action list shortened, the SQL `entity_type` changed: each turns the new case red.
- Ties: column dropped and `- 1` dropped (all eleven crosswalk oracle rows red); partition missing the zero-contribution count (a5, a9, a11 red); partition missing the window (text pin only: the window is a function of the OKX count, so it carries no extra information); the founder clause restored (text pin red).
- B'3c wording: the old sentence restored and "detective" removed each turn its pin red.
- Plan 04 `REBUILD_OK` on a mock summary: the good mock prints `REBUILD_OK`; with the `b3a-p7` compare clause removed, mocks whose re-run differs, whose digest moved or whose `pre` disagrees with Task 1's `p7:` line pass, and with the clause intact all fail; with the `newjob` clause removed, an unarmed, a two-job and an old-format `newjob` line pass, and intact all fail; a second `b3a-p7` line that differs for a re-enqueued label fails; the `ms-labels: none` mock prints `REBUILD_OK`. Plan 03's crosswalk fragment on a mock: passes with ties and `ambiguous` consistent; a tie recorded `match` and an `ambiguous` at `ties=0` each fail.

### Gates

- `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts src/__tests__/marksource-okx-nonworking-keys-exec.test.ts`: 177 passed (was 170).
- `cd analytics-service && <python> -m pytest tests/test_allocator_history_probe.py -q`: 127 passed; the Python round's digest cases (`-k digest`): 6 passed.
- `npm run -s check:planning-hygiene`: exit 0. eslint on both test files: clean. `verify plan-structure` on `178-03-PLAN.md` and `178-04-PLAN.md`: valid.

### Carried to the caller

- Dropping the ambiguous-label override means a field where most targets tie records zero rebuilds by design; plan 03's checkpoint should say so in plain words if the founder is asked.
- The renderer's freshness test compares the machine's file time with the database's `t0`; a clock skew larger than the minutes between `t0` and the re-run refuses a fresh file (loudly, with the remedy in the message).
- The `key_digest` in the P7 and `p7-before-enqueue.csv` output hashes real key ids: it stays in scratch with the CSVs (the runbook and README say so).

_Fix round 3 (SQL, runbook and plans) applied: 2026-10-29_
