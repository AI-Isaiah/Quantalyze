---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 02
subsystem: analytics-service match scorer
tags: [holdings, native-unpriced, match, parity, HOLD-02]
requires: []
provides:
  - "match AUM applies the native-unpriced marker per account (reading-day rule), equal to the TS reader"
affects: [analytics-service/routers/match.py]
tech-stack:
  added: []
  patterns: ["hand-typed JSON case table replayed by pytest and vitest"]
key-files:
  created:
    - analytics-service/tests/fixtures/native_unpriced_account_day_cases.json
    - analytics-service/tests/test_match_native_unpriced_account_day.py
    - src/lib/native-unpriced-account-day.parity.test.ts
  modified:
    - analytics-service/routers/match.py
decisions:
  - "Marker read skipped when no key has holdings rows (planner decision 2); with any rows it covers every key_rows id"
  - "SC-2 'unpriced days' met by equal counted key ids and totals per case; no output field invented (planner decision 3)"
status: complete
actuals:
  tokens: 6250
  tasks: 2
  commits: 2
plan_head_before: a1e669177f0a5c96bbe515c57bc2db78851650ac
plan_head_after: 7937cd824a20daa43fe713cac2f7e8a602d93fe7
metrics:
  completed: 2026-11-26
---

# Phase 235 Plan 02: native-unpriced marker per account in the matcher Summary

The matcher now reads a key's native-unpriced marker as that key's reading day (no rows) when it is strictly after the key's newest `asof`, and takes each account's newest day from its keys' reading days, exactly as `fetchLatestHoldingsPerKey` does; one hand-typed seven-case table is replayed by pytest and vitest.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 001fff96c | matcher change (`latest_by_key`, `_account_of_key`, `_reading_day`, widened marker read, Step 1b per-row drop loop removed), case file with `a_marker_b_older`, Python replay, TS replay |
| 2 | 7937cd824 | the remaining six cases, caplog assertion for `marker_read_failed` |

`commits: 2` is MEASURED from the ledger (`git rev-list --count a1e669177..HEAD` = 2) before this SUMMARY commit.

## What changed in `_load_holding_portfolio_context`

- Step 1 records `latest_by_key` (key id to newest `asof`).
- Step 1b: when any holdings row exists, `read_native_unpriced_days` reads markers for every `key_rows` id, inside the same try/except (`logger.exception`, message contains `native-unpriced`, markers treated as absent on failure). The old per-row drop loop and its `kept_rows` list are deleted; one INFO line counts keys a marker gave a no-rows reading day. The claim that this is "the same reader the daily refresh uses" is dropped.
- Step 2: `group_of` is built without the rows guard; `_account_of_key` (the single `key:{id}` f-string) and `_reading_day` added; `newest_day[account]` is the max over `key_rows` of reading days; `day_rows_by_account` is unchanged (rows kept when `asof == newest_day`).
- Docstring account paragraph gains the reading-day sentence. Step 3 untouched.

## Verification

- Case table: seven cases, `a_marker_b_older` first, `marker_read_failed` once (grep count 1).
- Python replay: 7 passed. TS replay: 15 passed (7 cases x 2 modes, plus the non-empty guard).
- Caller tests (10 files, plan's command): `290 passed, 1 warning in 11.56s`.
- mypy strict over the running-service surface: `Success: no issues found in 146 source files`.
- vitest (parity, holdings-account-day, holding-scope-key-census, computed-at-reader-census): `Test Files  4 passed (4)`, `Tests  130 passed (130)`.
- `git diff --quiet -- analytics-service/services/` exits 0 (no service file changed).
- Census guards: no `holding:` f-string, no new venue/symbol tuple key, no `computed_at` added.

## Pre-fix Python RED (HEAD matcher, base a1e669177, via `git show` of the pre-fix file)

The PRE run below swaps in the actual base `match.py`, so it is the true pre-fix behaviour (stronger than the plan's P1 stand-in, which is also run below). Lines:

- `AssertionError: a_marker_b_older: portfolio_aum 700.0 != 0`
- `AssertionError: marker_key_without_rows: portfolio_aum 700.0 != 0`
- `AssertionError: duplicate_marker_pair: portfolio_aum 200.0 != 100`

(`a_marker_b_older` was also captured RED before the fix existed, in Task 1 Step 2: `AssertionError: a_marker_b_older: portfolio_aum 700.0 != 0`, `1 failed`.)

## PROOF-01 transcripts (verbatim; harness `neuter.sh` in the scratchpad)

Backups live in `<scratchpad>/p235/plan-02/`. Neuters: PRE = base `match.py`; P1 `_reading_day` ignores markers; P2 keep rule drops rows of a key whose marker is on or after its newest asof; P3 marker always wins in `_reading_day`; P4 marker-read `except` re-raises; T1 `unpricedAsof` branch made `if (false)`; T2 `>` to `>=`; T3 branch drops the `latestAsof` comparison; T4 errored marker read becomes unpriced day `9999-12-31`. The `grep` filter in the harness keeps the RED/GREEN summary lines and drops pytest/vitest noise; repeated lines are pytest echoing the same assertion source context.

### PRE

```
### neuter PRE on analytics-service/routers/match.py
+ cp analytics-service/routers/match.py <scratchpad>/p235/plan-02/235-02-PRE.bak
+ cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q -p no:cacheprovider
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: a_marker_b_older: portfolio_aum 700.0 != 0
E         comparison failed
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: marker_key_without_rows: portfolio_aum 700.0 != 0
E         comparison failed
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: duplicate_marker_pair: portfolio_aum 200.0 != 100
E         comparison failed
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[a_marker_b_older]
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[marker_key_without_rows]
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[duplicate_marker_pair]
3 failed, 4 passed in 9.33s
+ cp <scratchpad>/p235/plan-02/235-02-PRE.bak analytics-service/routers/match.py
+ cmp <scratchpad>/p235/plan-02/235-02-PRE.bak analytics-service/routers/match.py   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
7 passed in 9.06s
```

### P1

```
### neuter P1 on analytics-service/routers/match.py
+ cp analytics-service/routers/match.py <scratchpad>/p235/plan-02/235-02-P1.bak
+ cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q -p no:cacheprovider
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: a_marker_b_older: portfolio_aum 700.0 != 0
E         comparison failed
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: marker_key_without_rows: portfolio_aum 700.0 != 0
E         comparison failed
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: two_accounts_marker_drops_only_its_own: portfolio_aum 1500.0 != 500
E         comparison failed
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: duplicate_marker_pair: portfolio_aum 200.0 != 100
E         comparison failed
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[a_marker_b_older]
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[marker_key_without_rows]
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[two_accounts_marker_drops_only_its_own]
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[duplicate_marker_pair]
4 failed, 3 passed in 9.31s
+ cp <scratchpad>/p235/plan-02/235-02-P1.bak analytics-service/routers/match.py
+ cmp <scratchpad>/p235/plan-02/235-02-P1.bak analytics-service/routers/match.py   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
7 passed in 9.10s
```

### P2

```
### neuter P2 on analytics-service/routers/match.py
+ cp analytics-service/routers/match.py <scratchpad>/p235/plan-02/235-02-P2.bak
+ cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q -p no:cacheprovider
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: marker_on_rows_own_day: portfolio_aum 700.0 != 1000
E         comparison failed
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[marker_on_rows_own_day]
1 failed, 6 passed in 9.30s
+ cp <scratchpad>/p235/plan-02/235-02-P2.bak analytics-service/routers/match.py
+ cmp <scratchpad>/p235/plan-02/235-02-P2.bak analytics-service/routers/match.py   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
7 passed in 9.29s
```

### P3

```
### neuter P3 on analytics-service/routers/match.py
+ cp analytics-service/routers/match.py <scratchpad>/p235/plan-02/235-02-P3.bak
+ cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q -p no:cacheprovider
            # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
            ), f"{case['name']}: the failed marker read was not logged at ERROR"
E       AssertionError: marker_older_than_rows: portfolio_aum 700.0 != 1000
E         comparison failed
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[marker_older_than_rows]
1 failed, 6 passed in 9.20s
+ cp <scratchpad>/p235/plan-02/235-02-P3.bak analytics-service/routers/match.py
+ cmp <scratchpad>/p235/plan-02/235-02-P3.bak analytics-service/routers/match.py   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
7 passed in 9.18s
```

### P4

```
### neuter P4 on analytics-service/routers/match.py
+ cp analytics-service/routers/match.py <scratchpad>/p235/plan-02/235-02-P4.bak
+ cd analytics-service && .venv/bin/python -m pytest tests/test_match_native_unpriced_account_day.py -q -p no:cacheprovider
__ test_match_aum_and_counted_keys_equal_the_shared_table[marker_read_failed] __
case = {'name': 'marker_read_failed', 'keys': [{'id': 'key-a', 'exchange': 'mt5', 'venue_account_id': 'L1', 'venue_server': '...': 'key-b', 'venue': 'mt5', 'symbol': 'ETHUSD', 'holding_type': 'spot', ...}], 'markers': {'key-a': '2026-10-10'}, ...}
ERROR    quantalyze.analytics:match.py:898 match: native-unpriced marker read failed for allocator alloc-235; the holdings rows are kept as they were
FAILED tests/test_match_native_unpriced_account_day.py::test_match_aum_and_counted_keys_equal_the_shared_table[marker_read_failed]
1 failed, 6 passed in 9.24s
+ cp <scratchpad>/p235/plan-02/235-02-P4.bak analytics-service/routers/match.py
+ cmp <scratchpad>/p235/plan-02/235-02-P4.bak analytics-service/routers/match.py   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
7 passed in 9.10s
```

### T1

```
### neuter T1 on src/lib/latest-holdings-per-key.ts
+ cp src/lib/latest-holdings-per-key.ts <scratchpad>/p235/plan-02/235-02-T1.bak
+ npx vitest run src/lib/native-unpriced-account-day.parity.test.ts
       × a_marker_b_older 1ms
       × a_marker_b_older 8ms
       × duplicate_marker_pair 1ms
       × marker_key_without_rows 1ms
       × two_accounts_marker_drops_only_its_own 1ms
      Tests  8 failed | 7 passed (15)
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > a_marker_b_older
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > duplicate_marker_pair
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > marker_key_without_rows
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > two_accounts_marker_drops_only_its_own
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > a_marker_b_older
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > duplicate_marker_pair
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > marker_key_without_rows
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > two_accounts_marker_drops_only_its_own
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
+ cp <scratchpad>/p235/plan-02/235-02-T1.bak src/lib/latest-holdings-per-key.ts
+ cmp <scratchpad>/p235/plan-02/235-02-T1.bak src/lib/latest-holdings-per-key.ts   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### T2

```
### neuter T2 on src/lib/latest-holdings-per-key.ts
+ cp src/lib/latest-holdings-per-key.ts <scratchpad>/p235/plan-02/235-02-T2.bak
+ npx vitest run src/lib/native-unpriced-account-day.parity.test.ts
       × marker_on_rows_own_day 1ms
       × marker_on_rows_own_day 6ms
      Tests  2 failed | 13 passed (15)
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > marker_on_rows_own_day
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > marker_on_rows_own_day
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
+ cp <scratchpad>/p235/plan-02/235-02-T2.bak src/lib/latest-holdings-per-key.ts
+ cmp <scratchpad>/p235/plan-02/235-02-T2.bak src/lib/latest-holdings-per-key.ts   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### T3

```
### neuter T3 on src/lib/latest-holdings-per-key.ts
+ cp src/lib/latest-holdings-per-key.ts <scratchpad>/p235/plan-02/235-02-T3.bak
+ npx vitest run src/lib/native-unpriced-account-day.parity.test.ts
       × marker_older_than_rows 1ms
       × marker_on_rows_own_day 1ms
       × marker_on_rows_own_day 6ms
      Tests  4 failed | 11 passed (15)
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > marker_older_than_rows
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > marker_on_rows_own_day
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > marker_older_than_rows
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > marker_on_rows_own_day
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
+ cp <scratchpad>/p235/plan-02/235-02-T3.bak src/lib/latest-holdings-per-key.ts
+ cmp <scratchpad>/p235/plan-02/235-02-T3.bak src/lib/latest-holdings-per-key.ts   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### T4

```
### neuter T4 on src/lib/latest-holdings-per-key.ts
+ cp src/lib/latest-holdings-per-key.ts <scratchpad>/p235/plan-02/235-02-T4.bak
+ npx vitest run src/lib/native-unpriced-account-day.parity.test.ts
       × marker_read_failed 1ms
       × marker_read_failed 6ms
      Tests  2 failed | 13 passed (15)
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > commit mode (auditEvidence: false) > marker_read_failed
 FAIL  |jsdom| src/lib/native-unpriced-account-day.parity.test.ts > the TS reader counts what the shared native-unpriced case table says > dashboard mode (default) > marker_read_failed
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
+ cp <scratchpad>/p235/plan-02/235-02-T4.bak src/lib/latest-holdings-per-key.ts
+ cmp <scratchpad>/p235/plan-02/235-02-T4.bak src/lib/latest-holdings-per-key.ts   (silent = byte-equal)
[cmp: silent, byte-equal]
+ GREEN re-run
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## Deviations from Plan

None to the work itself. Notes, none of which changed an expectation:

- The harness `grep` filters pytest/vitest output to the RED/GREEN summary lines and the failing case names; the full pytest tracebacks were not pasted.
- T3 (marker always wins in the TS branch) also turns `marker_on_rows_own_day` RED in the TS replay, besides the named `marker_older_than_rows`: a superset of the plan's expectation, correct by the rule (the marker day equals the rows' day, so key-a would read with no rows).
- P4 goes RED through the propagated `RuntimeError` out of `_load_holding_portfolio_context` (the transcript line is the ERROR log of the failed read, then `FAILED ...[marker_read_failed]`).
- Plan 01's strict `keyAccountOf` is not in this worktree; the TS replay imports only `./latest-holdings-per-key` and `./holdings-account-day`, as the plan requires. T1 to T4 edited only a byte-backed copy of `src/lib/latest-holdings-per-key.ts`, restored and `cmp`-verified within the same step; nothing from them is committed and the file is byte-identical to base.

## Recorded, not fixed (outside this plan's write scope)

`analytics-service/services/allocator_positions.py`: the docstring of `read_native_unpriced_days` still says the daily refresh reads the marker and that "a reader of a key's latest row drops a key's rows dated BEFORE the returned day". At HEAD the matcher (`routers/match.py`) is its only caller, and since this plan the marker is applied as a per-key reading day, not a per-row drop. The docstring is stale on both counts.

## Known Stubs

None.

## Threat Flags

None. The widened marker read passes the owner's own `key_rows` ids (read with `.eq("user_id", ...)`) and the reader still filters by `allocator_id` (T-235-04).

## Self-Check: PASSED

Created files exist, commits 001fff96c and 7937cd824 are ancestors of HEAD, working tree clean apart from this SUMMARY.
