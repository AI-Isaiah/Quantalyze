---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 01
subsystem: analytics-service / deribit ledger classification
tags: [deribit, correction, money-integrity, fail-loud, PROOF-01]
requires: []
provides:
  - "correction_is_trading narrowed: capital denylist, then trading word AND a named instrument"
  - "one fixture per correction shape through the classifier and both aggregators"
affects:
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_txn.py
tech-stack:
  added: []
  patterns: ["anchored token regex as a structural test on free text", "conjunctive fail-loud gate"]
key-files:
  created: []
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_deribit_txn.py
decisions:
  - "A correction is trading only when the capital denylist does not match AND a trading word matches AND an instrument is named (anchored upper-case token in the raw reason, or a non-blank string instrument_name that fullmatches the same pattern)"
  - "classify_instrument is NOT the structural test: it accepts any name ending -C, -P or -PERPETUAL (SUB-C)"
metrics:
  duration: "about 40 minutes wall clock under heavy machine load"
  completed: 2026-11-25
status: complete
commits: 2
plan_head_before: 1b4725bf5dc5de6fe7516938227a6b4d7fcfbe72
plan_head_after: 66ceb48c143b9327184c6bd6b530f633be95942c
actuals:
  tokens: 4100
  tasks: 2
  commits: 2
requirements: [DBOOK-02, PROOF-01]
closes-todos: Deribit correction residual (DBOOK-02)
---

# Phase 233 Plan 01: Deribit correction classifier (DBOOK-02) Summary

A Deribit `correction` row is now trading P&L only when it clears the capital denylist, carries a trading word, and names an instrument; `funding account correction` (a capital adjustment with a trading token, no capital word, no instrument) now fails loud on the classifier and on both aggregators.

closes-todos: Deribit correction residual (DBOOK-02)

## Environment

`analytics-service/.venv/bin/python -c "import ccxt"` printed `4.5.89` (the shared install the orchestrator symlinked; no install was run). Node modules are the shared symlink.

## What changed

- `analytics-service/services/deribit_txn.py`: new module constant `_CORRECTION_INSTRUMENT_TOKEN_RE` (anchored upper-case pattern: underlying of 2 to 6 capitals, optional `_` quote, hyphen, then `PERPETUAL` or a `DMMMYY` expiry with an optional `-<strike>-C|P`; lookbehind and lookahead on `[A-Z0-9_-]`); new helper `_correction_names_instrument(row, reason_raw)`; `correction_is_trading` narrowed to the conjunction (denylist stays first and unchanged); `assert_correction_classifiable` message now says the instrument must also be named. No caller, keyword tuple or other helper was touched.
- `analytics-service/tests/test_deribit_txn.py`: `_correction_row` gained the defaulted keyword `instrument_name: object = None`; one headline test (Task 1) and nine shape tests (Task 2), 20 new cases in all counting parametrization. No existing test body was edited.

Commits: `d8b567d34` (Task 1, gate plus headline test) and `66ceb48c1` (Task 2, shape fixtures).

## RED first

Headline test run on the unmodified classifier (before any gate change):

```
E       AssertionError: assert True is False
E        +  where True = correction_is_trading({'type': 'correction', 'currency': 'BTC', 'change': -0.00032469, 'instrument_name': None, ...})
FAILED tests/test_deribit_txn.py::test_correction_capital_reason_with_trading_token_and_no_capital_word_fails_loud
1 failed in 19.82s
```

It failed on the FIRST assertion (the classifier), as required.

## PROOF-01

Backups taken with `cp` into the session scratchpad, verified with `cmp`, restored with `cp`, verified with `cmp`, working tree clean afterwards. No `git checkout`, `git restore` or `git stash` was used.

| arm | neuter | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| dbook02-headline | `correction_is_trading` return: `_reason_matches_any(...) and _correction_names_instrument(row, reason_raw)` becomes `_reason_matches_any(...)` alone (instrument conjunct dropped) | `.venv/bin/python -m pytest tests/test_deribit_txn.py::test_correction_capital_reason_with_trading_token_and_no_capital_word_fails_loud -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_txn.py::test_correction_capital_reason_with_trading_token_and_no_capital_word_fails_loud (E   AssertionError: assert True is False) | cmp: exit 0, no output | GREEN: 1 passed in 11.97s |
| dbook02-structured-name | `_correction_names_instrument` body reduced to the reason-token search only (the `instrument_name` fullmatch branch removed) | `.venv/bin/python -m pytest tests/test_deribit_txn.py::test_correction_structured_instrument_name_with_trading_word_is_trading -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_txn.py::test_correction_structured_instrument_name_with_trading_word_is_trading (E   AssertionError: assert False is True) | cmp: exit 0, no output | GREEN: 1 passed in 10.06s |
| dbook02-near-miss | `_correction_names_instrument` body replaced with suffix leniency: `any(tok.endswith(("-C", "-P", "-PERPETUAL")) for tok in reason_raw.split())` | `.venv/bin/python -m pytest tests/test_deribit_txn.py::test_correction_near_miss_instrument_tokens_fail_loud -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_txn.py::test_correction_near_miss_instrument_tokens_fail_loud[SUB-C funding correction] (1 failed, 2 passed: BTC-PERP and BTC-PERPETUALS end with none of the three suffixes and stay green under this neuter, as the plan expected) | cmp: exit 0, no output | GREEN: 3 passed in 9.81s |

## Gates run

- Correction subset: `tests/test_deribit_txn.py -k correction` 50 passed, 165 deselected (28 passed at Task 1, every pre-existing correction test unchanged in verdict).
- Deribit consumers: `tests/test_deribit_txn.py tests/test_job_worker_deribit.py tests/test_broker_dailies.py` 280 passed, 12 warnings.
- CI's strict mypy command: `Success: no issues found in 143 source files` (run twice, after each task).
- Full suite, CI-shaped (`-n auto --dist loadgroup -q -rfE`), final line verbatim: `1 failed, 16653 passed, 93 skipped, 1194 warnings in 551.19s (0:09:11)`.
- `gitleaks dir` on both changed files: `no leaks found` (twice).
- `npm run lint`: exit 0 (0 errors, 4 pre-existing warnings in unrelated TS; the planning-hygiene checks all OK).
- Vitest invariants (`src/lib/*invariant* src/__tests__/*invariant* src/lib/seam-log-coverage.test.ts src/__tests__/critical-regressions.test.ts`): 659 of 660 passed on the first run; the one failure, `seam-venue-vocabulary.invariant.test.ts` "every SCAN EXCLUSION is PINNED", was `Test timed out in 5000ms` under machine load. Re-run alone with `--testTimeout=60000`: 27 passed. No TypeScript was touched by this plan.
- `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`

## Full-suite failure, recorded rather than hidden

`FAILED tests/test_process_key_anon_ip_tier.py::test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log` (`assert any(e["event"] == "request.rate_limited" for e in logs), logs` printed `[]`, line 361). It passes alone (`1 passed in 10.68s`) and the whole file passes (`20 passed in 10.10s`). The file never references `deribit_txn` or `correction_is_trading` (`grep -ac` 0), and the test exercises the process-key router and structlog capture. It is consistent with a structlog configuration race under xdist load. I did NOT prove it on the pre-change file by re-running the nine-minute full suite with the old `deribit_txn.py` swapped in, because it cannot reproduce outside the full xdist run and the code path does not touch this change; the orchestrator should treat this as an unproven-pre-existing flake and confirm on CI.

## Known risk (A1)

Raw Deribit ledgers are not stored, so "no PROD key holds a correction whose reason lacks an instrument token" was not measured. No worker-side census runs before deploy, because it needs a founder go for a Railway start-command swap. If a PROD key does hold such a row, its nightly derive now fails loud with `LedgerValuationError` (the founder's fail-loud rule) and surfaces as a FAILED DERIVE through the job-failure path. The phase 233 freshness arm cannot see it: a derive that stops entirely freezes its inputs and its returns together.

A non-null but unrecognised structured `instrument_name` also fails loud: the structured branch requires the value to be a non-blank string that fullmatches the instrument pattern, so a value like `n/a`, a number, a dict or a name outside the four Deribit shapes does not count as naming an instrument, and a correction that relies on it (trading word, no token in the reason) raises. This is the intended reading of CONTEXT's "non-null `instrument_name`" and is the safe direction.

## Deviations from Plan

None - plan executed exactly as written. The only noteworthy event: a first PROOF-01 attempt for `dbook02-headline` failed to launch pytest (a shell quoting slip in the wrapper, not a test result); the neutered file was restored by `cp` and `cmp` (exit 0) and the arm was redone cleanly, the row above is from the clean run.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change; one pure function narrowed.

## Self-Check: PASSED

- `grep -ac '_CORRECTION_INSTRUMENT_TOKEN_RE' analytics-service/services/deribit_txn.py` = 4 (expect >= 2); `def _correction_names_instrument` = 1; `"funding account correction"` present in the test module; `def test_correction_` = 18 (expect >= 18); `instrument_name: object = None` = 1.
- Commits `d8b567d34` and `66ceb48c1` are ancestors of HEAD.
