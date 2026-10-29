---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 02
subsystem: analytics-service / allocator history probe
tags: [bybit, probe, funding-evidence, census, read-only, redaction]
requires: ["180-01"]
provides:
  - "scripts/bybit_funding_record.py: the transaction-log census (CENSUS_LOG_TYPES, CENSUS_TIMEOUT_S, two census keys at the end of FUNDING_KEYS, 35 keys in all) and the Earn limitation sentence"
  - "tests/_bybit_evidence.py: the Unified transaction-log method with add_log and a wrong_type effect"
  - "a pin that the record module names only seven raw GET methods and no write"
affects: [180-03]
tech-stack:
  added: []
  patterns: ["one walk_paginated call per newest-first 7-day window over a closed type tuple", "shared _page_of shape check for sources and census"]
key-files:
  created: []
  modified:
    - analytics-service/scripts/bybit_funding_record.py
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/_bybit_evidence.py
    - analytics-service/tests/test_bybit_funding_record.py
    - analytics-service/tests/test_allocator_history_probe.py
key-decisions:
  - "The census count is a lower bound over the answered windows when its state is not read (same convention as plan 01's sources); a window never answered prints field-absent, never 0."
  - "A page is shape-checked and type-checked in full BEFORE any of its rows reach the sink, so a refused page counts no row."
  - "The Earn limitation sentence sits on ONE physical line in the module docstring, verbatim, so a search finds it whole."
status: complete
commits: 2
plan_head_before: f541b97935869bc855d1828d55ebe8165dd10935
plan_head_after: 3c69939ccb57706b607de0e14d9ca17d3d2c72ef
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
metrics:
  completed: 2026-10-28
requirements-completed: [SC-1]
---

# Phase 180 Plan 02: Census, bounds, read-only pin and leak test for the Bybit funding evidence Summary

The probe now also counts the Earn, staking, bonus-transfer and PEF log rows a rebuild would not replay (one count and a state), every evidence read stops at its own bound and says so by token, and the record module is pinned read-only and leak-tested with a fully populated record.

## What was built

- `analytics-service/scripts/bybit_funding_record.py`
  - `CENSUS_LOG_TYPES` (the eight RESEARCH Q2.3 types, in order), `CENSUS_TIMEOUT_S = 600.0`, `CENSUS_KEYS` (`bybit_other_transfer_like_rows`, `bybit_other_transfer_like_state`) appended at the END of `FUNDING_KEYS` (now 35), validators (count or field-absent; `SOURCE_STATES` without `not-master`) and defaults (`not-run`).
  - `_read_census`: newest-first 7-day windows, one `walk_paginated` call per window over all eight types, sending `accountType` "UNIFIED", `type`, `limit`, `startTime`, `endTime`, `cursor` to `private_get_v5_account_transaction_log`. A row whose `type` is not the requested one raises `EvidenceShapeError` (state `malformed`) before any row of that page is kept.
  - `_census_values`: distinct ids counted once, an id-less row each time; field-absent until one window was answered.
  - `measure_funding` runs the census LAST under `CENSUS_TIMEOUT_S`; a timeout is the state `Timeout`.
  - `_page_of`: the page shape check, factored out of `_read_source` and shared with the census (no behaviour change for the sources).
  - Docstring: the census, the Earn limitation (RESEARCH Q2.2's sentence, one line), the bounded-read statement and a READ-ONLY paragraph.
- `analytics-service/scripts/allocator_history_probe.py`: docstring item 7 (the funding evidence, read-only GETs, after the snapshot, each under its own bound, no gate) and the READ-ONLY paragraph's list of venue calls. No code change: the census keys reach `ACCOUNT_RECORD_KEYS`, the validators and the defaults through plan 01's splice.
- `analytics-service/tests/_bybit_evidence.py`: `private_get_v5_account_transaction_log` (refuses an `accountType` other than UNIFIED and a span over 7 days with `ccxt.BadRequest`, filters by `type`, same paging rule), `add_log`, `calls_to("transaction_log")`, the `wrong_type` effect, and the method in `METHODS`.

## Tests

- `tests/test_bybit_funding_record.py`: 26 -> 37 collected. New: `test_the_census_counts_transfer_like_log_rows_under_its_own_bound` (counts across windows and pages, de-dupes ids, excludes the D-01 pair and trades, runs under 456 s while sources run under 123 s, Timeout, wrong type on the first call and on a later window, refusal, a client without the method), `test_a_source_past_its_bound_is_a_timeout_and_the_next_source_still_runs` (x5 sources), `test_a_source_that_times_out_after_a_window_keeps_that_window_and_says_timeout`, `test_the_key_info_read_is_bounded_too`, `test_measure_funding_never_raises_and_returns_only_funding_keys`, `test_the_funding_keys_are_the_written_list` (35 keys by hand), `test_the_record_module_names_only_read_endpoints`.
- `tests/test_allocator_history_probe.py`: 133 -> 136 collected. New: `test_a_bybit_members_census_reaches_the_account_record` (the tracer), `test_a_record_with_every_funding_key_set_is_emitted`, `test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing` (planted fake transfer ids, member ids, UID, amounts and stamps; asserts every funding key is non-default so the run is not vacuous).
- Final run: `tests/test_bybit_funding_record.py tests/test_allocator_history_probe.py tests/test_okx_chain_record.py` -> 275 passed, 0 skipped.
- CI mypy line (verbatim, from `analytics-service/`): `Success: no issues found in 130 source files`. Probe and module mypy: `Success: no issues found in 2 source files`.
- Import checks printed `census-ok` and `evidence-ok`; `grep -acF 'the 5x implausibility bound is the only backstop' scripts/bybit_funding_record.py` prints 1.
- Task 1 tracer: `<verify>` re-run end to end before Task 2 expanded (all green).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole files green (275 passed).

- mutation-m1: red (`test_the_census_counts_transfer_like_log_rows_under_its_own_bound`: `assert 'read' == 'malformed'` with the census's type-equality check removed). restore: cmp clean
- mutation-m2: red (`test_a_source_past_its_bound_is_a_timeout_and_the_next_source_still_runs`: `assert 'read' == 'Timeout'`, all five source variants, with a timed-out source recorded as `read`). restore: cmp clean
- mutation-m3 (extra): red (`test_the_record_module_names_only_read_endpoints`: `match='private_post_'` after a comment naming a venue-write method was appended to the module). restore: cmp clean

## Deviations from Plan

**1. [Plan detail, no behaviour change] Page shape check shared**
- The plan says the census uses "the same shape refusal" as `_read_source`. Instead of copying it I factored it into `_page_of` and call it from both. One consequence for the sources: a page with a non-object row now keeps none of its rows (before, earlier rows of that page were kept before the refusal). That failure is a `malformed` state either way and the existing malformed-page tests stay green.

**2. [Test shape] The timeout test is parametrized over the five sources, plus two extra bound tests**
- The plan names one test; it runs once per source (5 cases), and two small tests were added (a timeout on a later window keeps the first window; the key-info read is bounded). `<verify>` selects by name, which runs every variant.

**3. [Test method] The "own bound" check spies on `asyncio.wait_for`**
- The fakes never suspend, so a lowered timeout cannot tell the census's bound from a source's by timing. The test records the `timeout` each `wait_for` call received (sources 123 s, census 456 s) and a separate hang case proves the census Timeout behaviour with `CENSUS_TIMEOUT_S` lowered.

Otherwise the plan was executed as written. Plan 01's key order is kept: funding keys before the chain keys in the probe's whitelist, `tests/test_okx_chain_record.py` green.

## Known Stubs

None.

## Threat Flags

None. The new surface is one more read-only GET (`private_get_v5_account_transaction_log`) through the existing client, every printed value passes `FUNDING_VALIDATORS` and `emit_record`, and the module's source is pinned to the seven raw GET names.

## Notes for plan 03

- `FUNDING_KEYS` is 35 long and the census keys are its last two; `INFLOW_SOURCE_NAMES` is unchanged and does not include the census (it is evidence, never an inflow).
- A non-zero `bybit_other_transfer_like_rows` is reported at SC-3 as a reason to hold a6's rebuild; it feeds no gate in code.
- The census adds about 840 calls per Bybit member (8 types x about 105 windows) after the five sources, each source under 420 s and the census under 600 s.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/bybit_funding_record.py, analytics-service/tests/_bybit_evidence.py, analytics-service/tests/test_bybit_funding_record.py, analytics-service/tests/test_allocator_history_probe.py, analytics-service/scripts/allocator_history_probe.py
- FOUND commits: bececddf0, 3c69939cc (both ancestors of HEAD)
- STATE.md and ROADMAP.md untouched; VERSION, package.json, CHANGELOG.md and TODOS.md untouched.
