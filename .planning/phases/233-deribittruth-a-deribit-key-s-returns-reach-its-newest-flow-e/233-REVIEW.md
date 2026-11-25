---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
reviewed: 2026-11-25T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - analytics-service/scripts/deribit_book_oracle.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_book_oracle.py
  - analytics-service/tests/test_deribit_txn.py
  - scripts/prod-prober/arms/freshness.mjs
  - scripts/prod-prober/run.mjs
  - .github/workflows/prod-prober.yml
  - src/__tests__/prod-prober-wiring.test.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 233: Code Review Report

**Reviewed:** 2026-11-25
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

I reviewed the diff from `549f3d977` to HEAD for the freshness prober arm, its registration and fixture harness in `run.mjs`, the workflow text, the wiring pins, the DBOOK-02 correction classifier and the DBOOK-01 book oracle.

Checked and found sound:
- The oracle imports only the standard library. It does not import any production helper, which meets PROOF-01.
- The oracle refuses id-shaped values, and its CLI prints only the exception type on an unexpected error.
- The prober arm selects no id or amount. It identifies a key only by `md5(id)` cut to 8 hex characters. It declares its credentials through `requiredEnv`, so an absent credential is a `credential-absent` failure, never a skip. It reports through `addDefect` and does not decide the exit code itself.
- Every `anchor_null_reason` token the writer emits (`native_unit`, `native_unpriced`, `balance_error`, `nonfinite`, `nonpositive`, `dust`, `flow_drop`) passes the arm's token regex.
- `csv_daily_returns_source_xor` guarantees that a row with an `api_key_id` is a key-mode row, so the arm's `nr` CTE needs no mode filter.
- The classifier change is narrower than before, so any shape it rejects fails loud rather than being counted. That is the safe direction.

Both warnings are in the freshness arm's judgement:
- WR-01: the arm can page wrongly on the day a stated stretch ends.
- WR-02: the most extreme staleness, a key with no stored return at all, never pages.

Seams S1, S2 and S5 are out of scope by founder decision and were not assessed. The necessity reference was not loaded, because context was limited, so this report carries no `necessity:` count.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The bound is not applied to trailing gap days, so a key pages wrongly on the day its tiny-base stretch ends

**File:** `scripts/prod-prober/arms/freshness.mjs:305-319` (header claim at `:45-47`)
**Issue:** The bound is checked only against the whole gap (`gap <= FRESHNESS_BOUND_DAYS`). Once the gap exceeds the bound, every day from `newest+1` to `ref` must appear in `tiny_base_days`, including the last one or two days. The bound exists to absorb exactly those days, which the header calls the non-atomic-write and previous-day lag.

Here is how a false page happens:
1. A key comes out of a stated stretch: its returns end on day D0, and days D0+1 to Dn are stated tiny.
2. The next day, Dn+1, is a day with no return that is not a tiny day. One case is the funding day of the deposit that revives the account: the writer drops that day into `dropped_day_pnl`, not into `tiny_base_days` (`job_worker.py`, the "the funding day, a day a guard drops" comment above `dropped_day_pnl`). The other case is a day whose return row has not been written yet.
3. The deposit is the newest flow, so `ref` = Dn+1.
4. The key then pages as `freshness-stale` with one uncovered day. The page lasts until the next derive stores a later return, and the hourly prober raises it on every run in between.

This matches what CONTEXT records for the diagnosed key: the stated days are exactly 2026-10-27 to 2026-11-23, but no rows exist for 2026-10-27 to 2026-11-24. So 2026-11-24 is neither stated nor stored. The header's claim at `:45-47` ("which the bound of 2 absorbs") is false on the covered path. The self-test has no fixture for a covered stretch followed by a trailing uncovered day within the bound, so this case is untested.
**Fix:** Require day-by-day coverage only up to the point where the remaining tail fits inside the bound. Keep the "every day" rule for the body of the gap:
```js
const tailStart = ref - FRESHNESS_BOUND_DAYS + 1; // days the bound already absorbs
for (let n = newest + 1; n < tailStart; n += 1) {
  if (!stated.has(dayText(n))) uncovered.push(dayText(n));
}
```
Add a held-back fixture with the shape "returns end, N stated days, then one unstated day which is the reference day". It should read green. Add a sibling with two unstated days before a third one that reads red. If the founder wants the literal "every day" reading of Q3, correct the header comment instead, and record that the arm will page on the day such a stretch ends.

### WR-02: A derived key with no stored return at all is never judged and never pages

**File:** `scripts/prod-prober/arms/freshness.mjs:286-291`
**Issue:** A key that has a derive job, a `key_inputs` row, a recent flow or terminal day, no anchor reason and zero key-mode `csv_daily_returns` rows is logged as `no stored return day (not judged)`. The run still exits 0. That is the largest gap possible: the returns are missing entirely. It reads green whether the cause is a reconcile delete that emptied the series or a derive that writes inputs but never returns.

The `no_returns=` count is printed but nothing gates on it. The same applies to `no_reference` at `:297-301` and `no_inputs` at `:276-280`. The `with_terminal === 0` guard catches only the case where every key is missing its terminal day. It does not catch a single key going blind.
**Fix:** When there is no stored return, a reference day exists and no anchor reason is set, raise `freshness-stale` with a "no stored return day" detail. As an alternative, accept the key under reason (1) only if every day up to `ref` is stated. Add a red fixture for it. If the founder rules that such a key is legitimately "not judged", raise a `measure-fail` instead whenever `no_returns > 0`, so the arm cannot stay silent.

## Info

### IN-01: The count check compares two separate statements, so a key crossing the 3-day window between them looks like a truncated read

**File:** `scripts/prod-prober/arms/freshness.mjs:338,386,411-419`
**Issue:** `derived` comes from one statement and the rows from a second. Each evaluates `now() - interval '3 days'` on its own. A key whose newest job ages out, or a new job, between the two reads produces a `measure-fail` that is not a real truncation.
**Fix:** Return `count(*) OVER ()` from `FRESHNESS_KEYS_SQL` and compare against that, or pin one timestamp shared by both statements.

### IN-02: Some field-name pins in the wiring test are vacuous

**File:** `src/__tests__/prod-prober-wiring.test.ts:656,665-670`
**Issue:** `storedBy(JOB_WORKER, '"venue"')` and `'"flows"'` match many unrelated literals in `job_worker.py`, for example the degrade-reason dicts. Renaming the `key_inputs` field would therefore not turn the test red. `utc_day_iso` has the same problem. The calibration case only proves the pin works for `tiny_base_days`.
**Fix:** Anchor each needle to the `_key_inputs_payload` literal or assignment, for example `"anchor_null_reason": _anchor_null_reason`.

### IN-03: Deribit's `d`-decimal option strikes do not match the instrument regex

**File:** `analytics-service/services/deribit_txn.py:936-941`
**Issue:** Linear options such as `XRP_USDC-30AUG24-0d625-C` write the decimal as `d`. The strike group is `\d+(?:\.\d+)?`, so such a correction fails loud. That is the safe direction, but it would block a derive on a real trading correction for such an instrument.
**Fix:** Change the strike group to `\d+(?:[.d]\d+)?` if that shape is ever observed. Otherwise record the limit.

### IN-04: The id refusal's error path can echo non-UUID dict keys

**File:** `analytics-service/scripts/deribit_book_oracle.py:567-569`
**Issue:** The path passed into the recursion includes raw dict key names. Only UUID-shaped keys are masked. A long-digit key name, such as an account number used as a map key, would appear in the `ExportError` path when a child value is refused.
**Fix:** Also apply `_LONG_DIGITS_RE` to key names, or mask key names that are not labels.

### IN-05: A day with no participant is named `skipped_nonpositive_denominator`

**File:** `analytics-service/scripts/deribit_book_oracle.py:879-881`
**Issue:** A union day on which no key participates gets the non-positive-denominator name, which does not describe it. The reading then states the wrong cause.
**Fix:** Use `no_stored_base_level` here, or another name from the closed set that fits.

---

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter lane (round 1, run in parallel)

### SFH-01 (MEDIUM): the freshness arm can exit green having judged zero keys

**File:** `scripts/prod-prober/arms/freshness.mjs` (`judgeFreshness` not-judged outcomes; `run()` guards; `FRESHNESS_SCOPE_SQL`)
**Issue:** `noInputs`, `noReturns` and `noReference` only log and count. `run()` gates on `derived === 0`, `with_terminal === 0` and the row count, never on `judged > 0` or on `with_inputs === derived`. A scope of one `coveredAnchor` key plus one `noInputs` key reads green with judged=0. `with_terminal` uses `payload ? 'realized_terminal_day'`, which counts a key that is present with a null value. Overlaps WR-02.
**Fix:** raise a defect when a derived key cannot be judged (no inputs, no returns) and when judged is 0; count `with_terminal` only for a string-typed `realized_terminal_day`; self-test scenario per case.

## Fix round 1

Fixed in `scripts/prod-prober/arms/freshness.mjs`, its fixtures and self-test scenarios in `scripts/prod-prober/run.mjs`, and `src/__tests__/prod-prober-wiring.test.ts`. Each gate was neutered in a byte-backup copy (`cp file file.bak`), the self-test run for the RED line, the file restored with `cp`, `cmp` checked, and the self-test run again for GREEN. Final verification: `node scripts/prod-prober/run.mjs --self-test` printed `=== SELF-TEST PASSED: 107/107 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===`, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts src/__tests__/critical-regressions.test.ts` passed (2 files, 305 tests).

### WR-01: the bound absorbs the trailing days

**Commit:** `e728e56ca`
**Applied fix:** when the gap exceeds `FRESHNESS_BOUND_DAYS`, the day-by-day loop now requires stated coverage only for days `newest < d <= ref - FRESHNESS_BOUND_DAYS`. The header rule (1) now says so, so the `:45-47` claim about the bound absorbing the non-atomic-write lag holds on the covered path. New fixtures: `ok.json` gained key `aaaa0007` (stated days cover everything except the last 2 days before the reference day, reads covered); new red fixture `tail-edge-uncovered.json` (misses the last required day, 2026-11-18, and pages). `SELF_TEST_SCENARIOS` 103 to 104.

RED, neuter A (loop restored to `n <= ref`, so the covered-tail key pages):
```
SELF-TEST FAIL: the GREEN control exits 0 (got 1)
```
RED, neuter B (`n <= ref - FRESHNESS_BOUND_DAYS + 1`, one day too strict):
```
SELF-TEST FAIL: the GREEN control exits 0 (got 1)
```
RED, neuter C (`n <= ref - FRESHNESS_BOUND_DAYS - 1`, one day too lenient):
```
SELF-TEST FAIL: partial-cover.json exits 1 (got 0)
SELF-TEST FAIL: bound-plus-one.json exits 1 (got 0)
SELF-TEST FAIL: tail-edge-uncovered.json exits 1 (got 0)
```
Restore: `cmp freshness.mjs.bak freshness.mjs` printed nothing, `cmp exit 0` (after each neuter).
GREEN:
```
=== SELF-TEST PASSED: 104/104 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===
```

### WR-02 and SFH-01: a derived key that cannot be judged must not read healthy

**Commit:** `1386eca14`
**Applied fix:**
- A key with a `key_inputs` row, no anchor reason and no stored return day pages as `freshness-stale` (gap is the whole series).
- A derived key with no `key_inputs` row raises a `measure-fail` with its `venue#tag` subject.
- When rows were read and fresh + covered_stated + stale is 0, a `measure-fail` on subject `freshness keys` names the not-judged counts (`covered_anchor`, `no_inputs`, `no_returns`, `no_reference`).
- `FRESHNESS_SCOPE_SQL` counts `with_terminal` only where `jsonb_typeof(d.payload->'realized_terminal_day') = 'string'`.
- `ok.json` lost its no-returns and no-inputs rows (no longer accepted shapes; scope now 5/5/5).
- Three new `freshness:` scenarios (no stored return pages; no inputs row measure-fails; anchor-covered key plus no-inputs key exits 1 with two measure-fails naming the counts), plus one wiring pin for the `jsonb_typeof` text. `SELF_TEST_SCENARIOS` 104 to 107.
- Messages print only `venue#tag`, days and counts.

RED, neuter N1 (noReturns page removed):
```
SELF-TEST FAIL: a key with no stored return exits 1 (got 0)
```
RED, neuter N2 (noInputs measure-fail removed):
```
SELF-TEST FAIL: no key_inputs row: exits 1 (got 0)
SELF-TEST FAIL: exactly two measure-fails, one per cause (got measure-fail)
```
RED, neuter N3 (judged-zero guard disabled):
```
SELF-TEST FAIL: exactly two measure-fails, one per cause (got measure-fail)
```
RED, neuter N4 (`with_terminal` back to the `?` operator), vitest pin:
```
× the scope statement counts realized_terminal_day only when it is a JSON string (a present-but-null key is not counted)
AssertionError: expected false to be true // Object.is equality
```
Restore: `cmp` printed nothing after each, `cmp exit 0`.
GREEN:
```
=== SELF-TEST PASSED: 107/107 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===
```

**Not covered here:** the `with_terminal` SQL change is pinned by text only. No test runs it against a database, so its behaviour on a null-valued key is unmeasured. The `no_reference` not-judged state is unchanged (it still only logs and counts), because the round-1 task named only `noReturns` and `noInputs`.
