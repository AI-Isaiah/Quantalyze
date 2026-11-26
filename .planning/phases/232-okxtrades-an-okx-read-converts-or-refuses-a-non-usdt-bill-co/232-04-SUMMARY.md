---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
plan: 04
subsystem: analytics-service
tags: [okx, cron, prefix-tick, vread-07, proof-01]
status: complete
requires: ["232-02", "232-03"]
provides:
  - "OKX_CRON_READ_DEADLINE_S, _FETCH_PREFIX_FLAG, _fetch_prefix_only in routers/cron.py"
  - "a stored-and-held prefix tick in _sync_single_key (status held, result key fetch_partial_prefix)"
affects: []
key-files:
  modified:
    - analytics-service/routers/cron.py
    - analytics-service/tests/test_cron_router.py
    - docs/runbooks/okxhistory-go-live.md
decisions:
  - "OKX_CRON_READ_DEADLINE_S = 35.0 of the 60 s KEY_SYNC_TIMEOUT, OKX only (assumed, unmeasured)"
  - "A prefix tick stores its whole-day rows and moves nothing else: last_sync_at, markers, trades_fetched_at stamp and recompute enqueue all held; degraded wins over prefix"
metrics:
  tasks: 3
  completed: 2026-11-24
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 16f61fde923fe6ffd16670c24de638da679787f1
plan_head_after: 651c683f29e5b39661d75d599ba75e0af89913d3
---

# Phase 232 Plan 04: OKX cron prefix tick Summary

The cron now gives an OKX key a 35 s read deadline, stores the contiguous whole-day prefix the window walk returns at that deadline, and holds every cursor, so a first window longer than one tick completes across consecutive ticks with no tick degrading the key and `OKX_BILLS_PAGE_CAP` unchanged.

`commits: 3` is measured from the ledger (`git rev-list --count plan_head_before..HEAD` before this SUMMARY's own commit).

closes-todos: 167.1.2.2.2-OKX-PERSISTENT-TRUNCATION (VREAD-07)
follow-on (recorded, not fixed): a marker-present strategy whose 30-day window exceeds OKX_CRON_READ_DEADLINE_S, and an empty prefix, re-read the same span every tick, loudly (held + fetch_partial_prefix); the queued sync job, which passes no deadline, completes either
assumed: OKX_CRON_READ_DEADLINE_S = 35.0 is an unmeasured split of KEY_SYNC_TIMEOUT; tune it from the first PROD ticks that report fetch_partial_prefix

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | 02b201c91 | constant, helper, five gates in `_sync_single_key`, tracer through the real walk |
| 2 | 22a3ed3a5 | the six remaining arms (8 collected items in `TestAnOkxPrefixIsStoredAndHeld`) |
| 3 | 651c683f2 | two dated runbook corrections (PROOF-01 and the suite diff change no repo file) |

## Tracer RED line on pre-fix code (verbatim, run before any cron edit)

```
E           AssertionError: tick 1 spent 80 s of venue time, more than the 60 s per-key budget: on PROD that is the cancel that stores nothing
E           assert 80.0 <= 60
E            +  where 60 = cron_mod.KEY_SYNC_TIMEOUT
```

Arithmetic: 61 UTC days of bills, 5 SWAP bills a day; 9 windows from the high-water day, 40 requests at 2.0 s = 80 s. The 35 s deadline admits 18 requests = 4 whole windows (28 days) per tick, so it completes in 3 ticks (2 `held`, 1 `ok`). Each held tick's single `cron_runs` row is `error` with `held=1` and neither `failed=` nor `fetch_degraded=`; the completing row is `ok`; the stored-day union equals every day with bills from the high-water day to now.

## PROOF-01 records (verbatim, scratch `proof.log`)

Neuters applied to the working `routers/cron.py` from a byte backup; `cp` back; `cmp` (no output, exit 0); GREEN. RED excerpts are the first six matching lines of each run (the failing test is named in the first failure).

```
### N1: drop the read_deadline_s keyword from the fetch_all_trades call
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_tracer_a_long_okx_first_window_completes_across_ticks_inside_the_key_budget'
  RED> E           AssertionError: tick 1 spent 80 s of venue time, more than the 60 s per-key budget: on PROD that is the cancel that stores nothing
  RED> E           assert 80.0 <= 60
  RED> E            +  where 60 = cron_mod.KEY_SYNC_TIMEOUT
  RED> FAILED tests/test_cron_router.py::TestAnOkxPrefixIsStoredAndHeld::test_tracer_a_long_okx_first_window_completes_across_ticks_inside_the_key_budget
  RED> 1 failed, 191 deselected in 4.52s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 1 passed, 191 deselected in 4.51s
### N2: drop 'and not fetch_prefix_only' from should_advance_cursor
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_a_prefix_is_stored_and_every_cursor_is_held or test_an_empty_prefix_is_held_not_idle'
  RED> E       AssertionError: {'key_id': 'live', 'strategy_id': 'strat-live', 'strategy_ids': ['strat-live'], 'exchange': 'okx', ...}
  RED> E       assert 'ok' == 'held'
  RED> E         
  RED> E         - held
  RED> E         + ok
  RED> E       AssertionError: {'key_id': 'live', 'strategy_id': 'strat-live', 'strategy_ids': ['strat-live'], 'exchange': 'okx', ...}
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 2 passed, 190 deselected in 4.54s
### N3: drop '(not fetch_prefix_only)' from strategy_advances
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_a_present_marker_is_held_at_its_pre_tick_value_by_a_prefix'
  RED> E       AssertionError: the marker stays at its pre-tick value: the unread suffix is still outstanding
  RED> E       assert {'strat-A': '...255153+00:00'} == {'strat-A': '...213154+00:00'}
  RED> E         
  RED> E         Differing items:
  RED> E         {'strat-A': '2026-11-24T16:25:50.255153+00:00'} != {'strat-A': '2026-11-24T16:10:50.213154+00:00'}
  RED> E         Use -v to get more diff
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 1 passed, 191 deselected in 4.44s
### N4: drop 'or fetch_prefix_only' from recompute_strategy_ids
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_a_prefix_enqueues_no_recompute'
  RED> E       AssertionError: a derive over a half-read span is wasted: it runs on the completing tick
  RED> E       assert not [call('enqueue_compute_job', {'p_strategy_id': 'strat-live', 'p_kind': 'derive_broker_dailies'})]
  RED> FAILED tests/test_cron_router.py::TestAnOkxPrefixIsStoredAndHeld::test_a_prefix_enqueues_no_recompute
  RED> 1 failed, 191 deselected in 4.50s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 1 passed, 191 deselected in 4.44s
### N5: pass the deadline to every venue
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_okx_gets_the_cron_read_deadline_and_bybit_none'
  RED> E       AssertionError: ('bybit', {'since_ms': None, 'read_deadline_s': 35.0})
  RED> E       assert 35.0 == None
  RED> FAILED tests/test_cron_router.py::TestAnOkxPrefixIsStoredAndHeld::test_okx_gets_the_cron_read_deadline_and_bybit_none[bybit-None]
  RED> 1 failed, 1 passed, 190 deselected in 4.58s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 2 passed, 190 deselected in 4.41s
### N6: compute fetch_prefix_only without 'and not fetch_degraded'
  cmd: pytest tests/test_cron_router.py -q -p no:cacheprovider -k 'test_a_degraded_fetch_wins_over_a_prefix'
  RED> E       AssertionError: a degraded read is not a prefix: {... 'status': 'error', 'fetch_degraded': True, 'fetch_degraded_reasons': ['daily_pnl_truncated_okx'], ... 'fetch_partial_prefix': True, ...}
  RED> E       assert 'fetch_partial_prefix' not in {... 'exchange': 'okx', ...}
  RED> FAILED tests/test_cron_router.py::TestAnOkxPrefixIsStoredAndHeld::test_a_degraded_fetch_wins_over_a_prefix
  RED> 1 failed, 191 deselected in 4.51s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> 1 passed, 191 deselected in 4.42s
```

(N6's RED line is shortened with `...` for the envelope dict; the dict printed by the run is longer.)

## Whole-suite regression diff (all four plans of the phase)

- `PHASE_BASE=5217975b6f9078719852a85d3835c99b6e02818f` (`git merge-base HEAD origin/main`), detached throwaway worktree, THIS worktree's ccxt 4.5.89 interpreter by absolute path, `env -i PATH HOME` (no database credential reaches a test).
- base: `15588 passed, 93 skipped, 1188 warnings in 108.20s (0:01:48)`, 0 failures.
- head: `16126 passed, 93 skipped, 1189 warnings in 115.20s (0:01:55)`, 0 failures.
- `comm -13 base-fails.txt head-fails.txt` exit 0, `new-fails.txt` 0 lines. No failure at either sha, so no pre-existing failure list.
- Throwaway worktree removed (`git worktree remove --force`, `git worktree prune`; `[ ! -d base ]` true).
- Task 3 verify list: `2592 passed, 1 skipped`. mypy strict (CI command): `Success: no issues found in 142 source files`. `verify-plan-anchors.mjs` exit 0.

## `git diff -U0 16f61fde9 HEAD -- analytics-service/routers/cron.py` hunk headers

```
@@ -81,0 +82,11 @@ KEY_SYNC_TIMEOUT = 60                        (constant)
@@ -503,0 +515,19 @@ _ERROR_CLASS_NAME_RE ...                    (helper region)
@@ -1044 +1074,7 @@ async def _sync_single_key(                  (fetch_all_trades call)
@@ -1062,0 +1099,4 @@ async def _sync_single_key(                 (fetch_prefix_only)
@@ -1214,0 +1255,5 @@ async def _sync_single_key(                (comment)
@@ -1216 +1261,3 @@ async def _sync_single_key(                 (should_advance_cursor)
@@ -1258,0 +1306,10 @@ async def _sync_single_key(                (held log branch)
@@ -1340,0 +1398,2 @@ async def _sync_single_key(                (comment)
@@ -1342 +1401,3 @@ async def _sync_single_key(                 (recompute_strategy_ids)
@@ -1435 +1496,7 @@ async def _sync_single_key(                 (strategy_advances + comment)
@@ -1803,0 +1871,2 @@ async def _sync_single_key(                (result key)
```

`_sync_single_key` spans lines 809 to 1944. `services/exchange.py` and `services/job_worker.py` unchanged by this plan (`git diff --quiet` exit 0).

## Deviations from Plan

**1. [Process] Task 2 tests were not written red-first.** The Task 1 gates already satisfied them, so there was no RED to observe before the change. Their ability to fail is proven by PROOF-01 neuters N2 to N6 instead.

**2. [Reading, for the orchestrator] SC-2 and the heartbeat.** As the plan states and the tracer pins: a catch-up tick is `held`, so its `cron_runs` row reads `error` with `held=1` (no `failed=`, no `fetch_degraded=`); the completing tick's row reads `ok`. No key status is `error` on any tick. This plan did not change `_NON_OK_STATUSES` or the heartbeat builder.

Otherwise none: no deviation rules fired.

## Known Stubs

None.

## Threat Flags

None. The new WARNING names the key id, a row count and the flag name only; the envelope key is a boolean.

## Self-Check: PASSED

Commits 02b201c91, 22a3ed3a5, 651c683f2 are ancestors of HEAD; `routers/cron.py`, `tests/test_cron_router.py` and the runbook contain the changes; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `STATE.md` and `ROADMAP.md` untouched.
