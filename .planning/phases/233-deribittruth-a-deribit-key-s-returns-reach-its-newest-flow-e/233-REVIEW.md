---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
reviewed: 2026-11-25T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - analytics-service/scripts/deribit_book_oracle.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_book_oracle.py
  - analytics-service/tests/test_deribit_txn.py
  - scripts/prod-prober/arms/freshness.mjs
  - scripts/prod-prober/run.mjs
  - .github/workflows/prod-prober.yml
  - src/__tests__/prod-prober-wiring.test.ts
  - scripts/prod-prober/fixtures/freshness/ok.json
  - scripts/prod-prober/fixtures/freshness/tail-edge-uncovered.json
findings:
  critical: 0
  warning: 3
  info: 10
  total: 13
  necessity: 0
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

## Round 2

**Reviewed:** 2026-11-25
**Depth:** standard
**Scope:** (1) the fix commits `e728e56ca` and `1386eca14` (`git diff f121cbec7 HEAD -- scripts/prod-prober src/__tests__/prod-prober-wiring.test.ts`); (2) the parts round 1 did not cover: `emit_reading` and the `--print-sql` statements in `analytics-service/scripts/deribit_book_oracle.py`, `analytics-service/tests/test_deribit_book_oracle.py`, and the Phase 233 tests in `analytics-service/tests/test_deribit_txn.py`. Seams S1, S2 and S5 were not assessed (founder decision). The necessity rubric was loaded, and no finding in this round is a necessity finding.

### Summary

What I ran:
- `node scripts/prod-prober/run.mjs --self-test` printed `SELF-TEST PASSED: 107/107 scenarios`.
- `pytest tests/test_deribit_txn.py tests/test_deribit_book_oracle.py` passed (250).
- I ran two in-memory neuters through a throwaway pytest plugin that patches one module attribute. No source file was touched. For each neuter, a sanity patch in the opposite direction on the same module turned the suite red, so each patch did take effect.

Fix verification:
- **WR-01: closed.** The loop at `freshness.mjs:341` requires stated days only for `newest < d <= ref - 2`. The header and the stale detail (`gap - FRESHNESS_BOUND_DAYS`) agree with the loop. `tail-edge-uncovered.json` and ok.json's `aaaa0007` pin both sides of the edge, and the three recorded neuters cover both off-by-one directions. No regression found.
- **SFH-01: closed.** The no-inputs measure-fail, the judged-zero guard and the `jsonb_typeof(...) = 'string'` count are all present, and scenarios pin them. The `with_terminal` change is pinned by its text only, as round 1 recorded. The judged-zero guard raises one side effect, filed as IN-08.
- **WR-02: closed as written, but the fix introduced a regression** (WR-03 below). It now pages a state the writer produces on purpose.

On the oracle and its tests:
- The emitter's closed vocabulary holds.
- The `--print-sql` statements are read-only and reference real columns. `allocator_equity_derived` has primary key `(allocator_id, kind)`, and `api_keys` carries the share and inclusion columns.
- The oracle still imports only the standard library.
- Two gaps, both Warnings:
  - A truncated export can read CLEAN (WR-05).
  - The structured-`instrument_name` half of the DBOOK-02 gate can be loosened without any test going red (WR-04).

### Warnings

#### WR-03: The WR-02 fix pages a funded key that is new or idle and has fewer than two return days, a state the derive produces on purpose

**File:** `scripts/prod-prober/arms/freshness.mjs:306-318` (commit `1386eca14`)
**Issue:** The new `newest === null` branch raises `freshness-stale` for every key that has a `key_inputs` row, no anchor reason and no stored return. The branch runs before the reference-day candidates are computed, so it pages even a key that has no flow, terminal or mark day. Round 1's suggested fix had "a reference day exists" as a condition, and the applied fix dropped it.

The writer produces this exact shape on purpose:
- `job_worker.py`'s key-mode `< 2 daily-return days` exit (the `if int(returns.notna().sum()) < 2:` block, "Brand-new / inactive account") still runs the Option-B epilogue: "an idle/short key with real capital must still land its anchored key_inputs row ... anchored-without-returns" (the F1(a) comments at the epilogue and in that exit).
- It writes no `csv_daily_returns` row unless marks were applied. It can also delete stale rows on stated or marked days.
- For a material, positive, finite equity read, `_anchor_null_reason` stays `None`.

So every newly connected funded key pages `freshness-stale` on every hourly run until it has two stored return days. An idle funded account that never builds two return days pages for as long as it is derived. The compose already handles this key by name (DROPPED_KEY, degrade), so the page is a false alarm, not a new signal. How many PROD keys are in this state is unmeasured: no prober reading with a `no_returns=` count exists in the phase directory yet (plan 233-06 has not run).
**Fix:** This needs a founder decision. Three options:
- (a) Keep the page, but only for a key whose record is old enough that two return days must exist. Add the key's age to `FRESHNESS_KEYS_SQL`, for example `(now()::date - k.created_at::date)` from a join to `api_keys` (no id leaves the database). Page only when the age is above `FRESHNESS_BOUND_DAYS + 2` and a reference day exists. Add a green fixture for a key one day old with no returns, beside the existing red one.
- (b) Turn the no-returns case into a `measure-fail` only when `no_returns > 0` persists beyond that age.
- (c) Restore "not judged" for this state, and rely on the judged-zero guard plus the compose's own DROPPED_KEY degrade.

Whichever option is chosen, add a self-test scenario for the brand-new funded key.

#### WR-04: Nothing tests the structured-`instrument_name` half of the DBOOK-02 correction gate, so loosening it to "any non-blank string" stays green

**File:** `analytics-service/services/deribit_txn.py:954`; tests at `analytics-service/tests/test_deribit_txn.py:956-980` (shape 10, `test_correction_blank_or_nonstring_instrument_name_fails_loud`)
**Issue:** `_correction_names_instrument` accepts a structured name only when it fullmatches the anchored instrument pattern. Its docstring says a value like `n/a` is not an instrument. Shape 10's parameters are `""`, `"   "`, `123` and a dict. None of them is a non-blank string that is not an instrument, so the `fullmatch` is never what refuses a parameter.

Measured neuter: I replaced the branch with `isinstance(name, str) and name.strip()` (any non-blank string counts as an instrument).
- `pytest tests/test_deribit_txn.py -k correction` still printed `50 passed`.
- Under the neuter, `correction_is_trading` on `{"instrument_name": "n/a", reason "funding calculation correction", change -1e-4}` flips from `False` to `True`.
- The sanity neuter (the function always returns False) turned 11 of the same tests red, so the patch took effect.

This is a money-math gate: a loosened branch would sum a capital adjustment as realized trading P&L, which is the misroute DBOOK-02 exists to stop. Under the repo rule, a data-integrity gate must be able to fail.
**Fix:** Add non-blank, non-instrument strings to shape 10's parametrisation, each with a trading word and no token in the reason, so the structured branch alone decides them. Examples: `"n/a"`, `"SUB-C"`, `"btc-perpetual"`, `"BTC-PERP"`. Record the neuter above in the docstring as its REVERT-PROOF line.

#### WR-05: A book export that lost its first or last year slice reads CLEAN, because the fetched `n_returns` is never compared

**File:** `analytics-service/scripts/deribit_book_oracle.py:1402` (`book_curve` selects `jsonb_array_length(payload -> 'returns') AS n_returns`); `_BOOK_FIELDS` at `:403-412` and `book.inputs` at `:499` have no slot for it
**Issue:** The book's `returns` array is assembled from per-year `key_array_by_year` slices. If a leading or trailing slice is missing (a year not fetched, or a truncated MCP answer), its days fall outside the first-to-last published day. They are then named `omitted ... outside_published_window`, which never stops the reading.

Measured on `explained_two_keys.json`:
- With the last `book.returns` row dropped, the oracle printed `verdict=CLEAN` and exited 0, with `2025-01-05 reason=outside_published_window`.
- With the last two rows dropped, it again printed CLEAN, exit 0.

The statement already fetches the database's own count for exactly this check, but the export format cannot carry it, and neither the 233-05 nor the 233-07 plan or summary records a manual `published` against `n_returns` comparison. A losing slice in the middle is caught as `omission_unexplained`. Losing a slice at either end is not caught.
**Fix:**
- Add an optional `n_returns` to `book.inputs`, or a top-level `book.n_returns`, which the orchestrator fills from `book_curve`.
- In `_load_book`, raise `ExportError("book.returns: count disagrees with n_returns")` when the flattened row count differs. Make the field required for the PROD recipe.
- Add a test that drops a trailing slice and expects exit 2.

### Info

#### IN-06: `book_key_rows` puts every NULL-`venue_account_id` key of one exchange in the same `account_group`

**File:** `analytics-service/scripts/deribit_book_oracle.py:1442`
**Issue:** `dense_rank() OVER (ORDER BY exchange, venue_account_id)` ranks NULLs equal. Production treats a NULL account id as unknown, never as shared (`account_identity_tokens`; `account_groups` groups by share markers only). An orchestrator who reads the rank as account grouping would merge unrelated keys. The `n_keys` comparison backstops the count but not which keys were chosen.
**Fix:** `CASE WHEN venue_account_id IS NULL THEN NULL ELSE dense_rank() OVER (...) END`, or rank over `coalesce(venue_account_id, id::text)`. Update the verbatim pin in `test_print_sql_is_read_only_and_id_free`.

#### IN-07: The emitter's whole-text id backstop is not pinned, and it is the only guard on an object-form flag count

**File:** `analytics-service/scripts/deribit_book_oracle.py:1236`; `tests/test_deribit_book_oracle.py:556-572`
**Issue:**
- Every bad value in `test_emitter_refuses_values_outside_vocabulary` is refused by `_render_val`, so the `_UUID_RE` / `_LONG_DIGITS_RE` check in `_render_rows` is never reached.
- When I neutered `_LONG_DIGITS_RE` to never match, all 35 oracle tests still passed.
- An object-form flag with a 7-digit or longer integer value reaches `_cnt` unrefused, and only this backstop catches it. Measured: `flags: {"x_flag": 12345678}` exits 2 with `failed: ValueError`.
- PROD flags arrive in array form (every value `true`), so this path is not reachable from PROD's shape today.

**Fix:** Add a test that renders `Val("count", 12345678)` and a token that passes `_TOKEN_RE` but holds a long digit run, and expects `ValueError`.

#### IN-08: The judged-zero guard raises a measure-fail on a scope made only of anchor-covered keys

**File:** `scripts/prod-prober/arms/freshness.mjs:466-475`
**Issue:** The header calls reason (2), a non-empty `anchor_null_reason`, a valid named reason. Even so, a scope in which every derived key carries one (for example a book of native-unit keys only) raises `measure-fail` on every hourly run. The founder asked for this outcome in SFH-01, so it is recorded here, not disputed.
**Fix:** If the founder wants such a scope green, exclude `covered_anchor` from the "judged nothing" condition, or state the hourly measure-fail in the header.

#### IN-09: `test_print_sql_is_read_only_and_id_free` proves the absence of ids with the oracle's own regexes

**File:** `analytics-service/tests/test_deribit_book_oracle.py:604-605`
**Issue:** `assert not oracle._UUID_RE.search(text)` and `oracle._LONG_DIGITS_RE` cannot fail if either regex is broken. The same regexes guard the loader and the emitter.
**Fix:** Use test-local literal patterns.

#### IN-10: Object-form flag values that are strings, floats or negative integers are dropped from the reading without a trace

**File:** `analytics-service/scripts/deribit_book_oracle.py:1351-1357`
**Issue:** The loader accepts any scalar flag value, but the emitter prints a state only for a bool and a count only for a non-negative int. Dropping the value is the safe direction for redaction, but the reading then shows the flag with no indication that a value existed.
**Fix:** Emit `state=other` for any value the emitter does not render.

### Round 2 counts

The frontmatter counts open items after round 2:
- WR-01, WR-02 and SFH-01 are closed.
- WR-03, WR-04 and WR-05 are open.
- IN-01 to IN-10 stay open, because LOW and Info findings are recorded here and never fixed.
- Open Critical/Warning: **0 Critical, 3 Warning.**

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: standard_

## Fix round 2

Fixes for WR-03, WR-04 and WR-05, one commit per topic. Each new gate was neutered in a byte backup (`cp f f.bak`), the RED line recorded, the file restored with `cp f.bak f`, `cmp f f.bak` checked (exit 0, no output), and GREEN recorded. The `.bak` files were removed. IN-06 to IN-10 were not touched.

### WR-03: a key with no stored return is not paged; the not-judged guard is per venue

**Commit:** `71892f8f6`
**Files:** `scripts/prod-prober/arms/freshness.mjs`, `scripts/prod-prober/fixtures/freshness/ok.json` (comment only), `scripts/prod-prober/run.mjs`, `src/__tests__/prod-prober-wiring.test.ts`
**Applied fix (orchestrator decision, option (c), reversible):**
- A key with a `key_inputs` row, no anchor reason and no stored return day is "not judged" again, counted as `noReturns`, never `freshness-stale`.
- The global judged-zero guard is replaced by a per-venue guard. For each venue in the rows read, when none of its keys is fresh, `coveredStated`, stale or `coveredAnchor`, one `measure-fail` is raised on subject `freshness <venue>` naming that venue's `no_inputs`, `no_returns` and `no_reference` counts. This closes the round-2 silent-failure residual (a venue whose keys all fall to `noReference` or `noReturns` reading green behind another venue's judged keys). `coveredAnchor` counts as judged, so an all-anchor scope exits 0 (IN-08 resolved by the same change, not as a separate edit).
- The `noInputs` per-key `measure-fail` and the WR-01 bound window are unchanged. The header comment matches.
- Decision recorded: a key with no `key_inputs` row is not attributed to a venue by the guard. Its venue column is the pseudo-value `unknown`, and it already raises its own per-key `measure-fail`, so counting it would double-report. As a result `no_inputs` in the per-venue message is always 0 for a real venue.
- Self-test: the no-stored-return scenario is now "a lone no-return key beside a fresh key of its venue exits 0 with no defect and `no_returns=1` on the summary line"; the judged-zero scenario became "a venue whose only key is `noReference` beside a fresh venue exits 1 with one `measure-fail` on `freshness binance`"; new scenario "an all-coveredAnchor scope exits 0". `SELF_TEST_SCENARIOS` 107 to 108 (`toBe(108)` pin updated).

RED, neuter N1 (per-venue guard condition made unsatisfiable):
```
SELF-TEST FAIL: binance has only a no_reference key: exits 1 (got 0)
```
RED, neuter N2 (`coveredAnchor` removed from the judged sum):
```
SELF-TEST FAIL: ok.json exits 0 (got 1; defects [{"kind":"measure-fail","arm":"freshness","subject":"freshness okx", ...
SELF-TEST FAIL: an all-coveredAnchor scope exits 0 (got 1)
SELF-TEST FAIL: the GREEN control exits 0 (got 1)
```
RED, neuter N3 (the no-return key paged again):
```
SELF-TEST FAIL: a new or idle key with no stored return beside a fresh key of its venue exits 0 (got 1)
```
RED, neuter N4 (`noReference` counted as judged in the venue guard):
```
SELF-TEST FAIL: binance has only a no_reference key: exits 1 (got 0)
```
Restore: after each neuter `cmp freshness.mjs freshness.mjs.bak` printed nothing, `cmp exit 0`.
GREEN:
```
=== SELF-TEST PASSED: 108/108 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===
```
`npx vitest run src/__tests__/prod-prober-wiring.test.ts src/__tests__/critical-regressions.test.ts`: 2 files, 305 tests passed.

### WR-04: the structured `instrument_name` gate is pinned

**Commit:** `bd28a768a`
**File:** `analytics-service/tests/test_deribit_txn.py` only (`deribit_txn.py` unchanged; every new case classifies as the current code does).
**Applied fix:** shape 10's parametrisation gained `"n/a"`, `"SUB-C"`, `"btc-perpetual"` and `"BTC-PERP"` (ids `n-a`, `sub-c`, `lower-perpetual`, `truncated-perp`), each with reason `funding calculation correction` (a trading word, no instrument token). The docstring's REVERT-PROOF line records the neuter.

RED, neuter (the structured branch loosened to `isinstance(name, str) and name.strip()`), `pytest tests/test_deribit_txn.py -k correction`:
```
FAILED tests/test_deribit_txn.py::test_correction_blank_or_nonstring_instrument_name_fails_loud[n-a]
FAILED tests/test_deribit_txn.py::test_correction_blank_or_nonstring_instrument_name_fails_loud[sub-c]
FAILED tests/test_deribit_txn.py::test_correction_blank_or_nonstring_instrument_name_fails_loud[lower-perpetual]
FAILED tests/test_deribit_txn.py::test_correction_blank_or_nonstring_instrument_name_fails_loud[truncated-perp]
4 failed, 50 passed, 165 deselected in 116.36s (0:01:56)
```
Restore: `cmp services/deribit_txn.py services/deribit_txn.py.bak` printed nothing, `cmp exit 0`.
GREEN (before the neuter): `8 passed, 211 deselected` for `-k correction_blank`; final run of both test files `255 passed in 113.22s`.

### WR-05: the book export carries `n_returns`, and a truncated returns array is refused

**Commit:** `c91d447a5`
**Files:** `analytics-service/scripts/deribit_book_oracle.py`, `analytics-service/tests/test_deribit_book_oracle.py`, the 15 fixtures under `analytics-service/tests/fixtures/deribit_book_oracle/`.
**Applied fix:**
- `book.n_returns` is a required top-level book field (the `n_returns` column the `book_curve` statement already selects; its SQL is unchanged). `_load_book` raises `ExportError("book.returns: row count disagrees with book.n_returns")` (exit 2) when the flattened published row count differs. The docstring export format and a paragraph describe it.
- Every fixture carries the true count (`production_shapes.json`, whose returns arrive as `[null, [..4 rows..]]`, carries 4).
- New test `test_a_book_that_lost_a_returns_row_is_refused`: dropping the last row exits 2, dropping the first row exits 2, a missing `n_returns` exits 2 (`book.n_returns: missing`), each with an empty stdout.
- The oracle still imports only the standard library (the AST import test is unchanged and green).

RED, neuter (`if len(returns) != _count(...)` replaced by `if False`), the drop-last variant:
```
E           assert 0 == 2
FAILED tests/test_deribit_book_oracle.py::test_a_book_that_lost_a_returns_row_is_refused
```
Restore: `cmp scripts/deribit_book_oracle.py scripts/deribit_book_oracle.py.bak` printed nothing, `cmp exit 0`.
GREEN: `tests/test_deribit_book_oracle.py` `36 passed in 68.17s`.

### Final verification

```
node scripts/prod-prober/run.mjs --self-test
=== SELF-TEST PASSED: 108/108 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===

npx vitest run src/__tests__/prod-prober-wiring.test.ts src/__tests__/critical-regressions.test.ts
 Test Files  2 passed (2)
      Tests  305 passed (305)

analytics-service: pytest tests/test_deribit_txn.py tests/test_deribit_book_oracle.py -q -p no:cacheprovider
255 passed in 113.22s (0:01:53)

mypy --strict scripts/deribit_book_oracle.py
Success: no issues found in 1 source file

mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 143 source files
```

**Not covered here:** the per-venue guard and the `n_returns` check are exercised by fixtures and in-memory scenarios only, not against PROD. No prober reading with a `no_returns=` count exists yet (plan 233-06). The WR-03 decision is reversible in one branch of `judgeFreshness`; options (a) and (b) in the Round 2 text remain available if PROD shows idle keys that should page.
