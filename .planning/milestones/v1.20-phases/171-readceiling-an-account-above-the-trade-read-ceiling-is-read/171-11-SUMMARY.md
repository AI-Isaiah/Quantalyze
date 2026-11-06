---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 11
subsystem: analytics-service
tags: [trade-read, resumable-read, store, postgrest, jsonb, live-probe, local-stack]

requires:
  - phase: 171-readceiling
    provides: "plan 03's tables allocator_trade_reads and allocator_trade_read_windows; plan 04's services/trade_read_store.py"
provides:
  - "tests/test_trade_read_store_live.py: a loopback-only live probe of the store over the real PostgREST: exact round trip of a 5,001-trade window, claim bookkeeping, grants and purges"
affects: [171-12]

actuals:
  tokens: 4450
  tasks: 2
  commits: 2

key-files:
  created:
    - analytics-service/tests/test_trade_read_store_live.py

key-decisions:
  - "The round-trip test pins a MEASURED PostgREST/jsonb property instead of asserting bare == for every value (see Deviations 1)"

requirements-completed: [SC-1]

duration: 25min
completed: 2026-10-27
status: complete
commits: 2
plan_head_before: 7790e92ab5efbdb5050f5f45d32af137cd02b81e
plan_head_after: 77c85ec2a94d54cf9d3ebc4b4b8a96fd60c1d1ed
---

# Phase 171 Plan 11: the live probe of the trade-read store Summary

**On the local-stack lane (the PostgREST image CI runs, with plan 03's migration replayed), a 5,001-trade window stored through `save_window` reads back through `begin_claim` and `load_window` as exactly the trades that went in, and the claim bookkeeping, the grants and both purges behave on the real tables. One measured property of jsonb needs the orchestrator's attention: a double of 1e16 or more comes back as a Python `int`.**

## Accomplishments

- Tracer (Task 1): `test_a_stored_window_round_trips_through_postgrest`. 5,001 ccxt-shaped trades (one full 5,000 chunk and one of 1; prices, amounts, costs and fee costs cycling through 0.1, 1e-05, 123456.789012345, 2.2250738585072014e-308, 1.7976931348623157e308, -0.0, 0.30000000000000004, 5e-324, 1.0, 100.0; `None` in symbol, side, amount, price, cost and fee; all four fee shapes). The expectation is built straight from the original dict (the seven-field tuple, a dict fee reduced to `fee.get("cost") or 0.0`), never from the store's projection. Order kept; `None` kept as `None`; every other value `==` with the same type.
- Bookkeeping (Task 2): `test_claim_bookkeeping_holds_on_the_real_tables` (claims 1/2/3 of one job leave `stalled_claims` 3 with the grid origin held at the first start, the fourth raises `TradeReadStalled("stalled_claims")` and writes nothing, a new job restarts at 1 and keeps the window, `record_progress` resets to 0 through service_role's UPDATE, another `TRADE_READ_VERSION` discards both tables' rows through service_role's DELETE) and `test_the_purges_remove_only_what_they_name` (two throwaway keys; one window of A forced expired by a direct UPDATE; `purge_expired` removes only it; `purge_keys([A])` removes A's rest and leaves B's).
- Every `begin_claim` in the module goes through `_claim`, which asserts `state is not None` and a `ReadState`, so a fault disposition cannot make a later assertion vacuous.
- The module imports `wrap_live_db_client` (the derived transport pin passes) and names `SUPABASE_TEST_URL`, so `conftest._DB_MODULE_SENTINELS` puts it in the serialized `shared_test_db` group by content. ci.yml's `python` job exports the lane as those two variables, so it runs there with no workflow edit.

## Task Commits

1. **Task 1 (tracer): a stored window round-trips exactly through the real PostgREST** - `f0ca8b9ea` (test)
2. **Task 2: bookkeeping, grants and purges on the real tables** - `77c85ec2a` (test)

`plan_head_before` (also `PLAN_BASE`) `7790e92ab5efbdb5050f5f45d32af137cd02b81e`; `rev-list --count` over the plan: 2 (this SUMMARY's own commit is not counted).

## Verification evidence

- Skip without the lane env (`env -u SUPABASE_TEST_URL -u SUPABASE_TEST_SERVICE_KEY -u CI`): `1 passed, 1 skipped` at Task 1 (guard passes, round trip skips). With `CI=true` and no lane env, the final module gives `3 failed, 1 passed` (the three lane tests `pytest.fail`; the guard test passes).
- Live run on the lane, Task 1: `2 passed`. Final live run, all four tests: `4 passed, 6 warnings in 9.36s` (`live2.log`).
- Largest chunk's JSON byte length (a 5,000-trade chunk, `json.dumps` default separators): **441020** bytes. The plan 03 comment budgeted "about 300 KB" for a chunk; the measured figure is about 430 KB, and the real PostgREST accepted it in one request. Plan 12 may want the figure when it records the gateway body-limit measurement.
- Derived transport pin: `tests/test_live_db_transport.py -k all_live_db_client_factories` gives `1 passed, 30 deselected` (`transport-pin.log`). The dated census in `live_db_transport.py`'s docstring is NOT pinned; it was left alone, as the NAV-marks probe left it.
- CI mypy line verbatim from `analytics-service/`: `Success: no issues found in 124 source files`.
- Full analytics suite without the lane env: `12996 passed, 99 skipped` (plan 04's final was 12948 passed, 96 skipped; the three extra skips are this module's three lane tests, the guard test is one of the extra passes). Nothing else changed outcome.
- Local stack: lane booted with `run.sh up` (57 s, plan 03's migration replayed on top of the dump), `--assert-local-handoff` exit 0 before use, brought down with `run.sh down`; `docker ps -q | wc -l` afterwards: **0**. It was down (0 containers) when this plan began. The lane was held up from Task 1's live run until Task 2's last drill, then taken down once.

### Drills (the live probe can fail)

The store was backed up to `store.fixed` before each drill, edited, tested on the lane, restored with `cp` and compared with `cmp`. The store is unchanged in the committed tree.

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| V (plan) | `project_trade` rounds price to 6 decimals | `FAILED ...::test_a_stored_window_round_trips_through_postgrest` | 0 |
| W (extra) | `purge_expired` looks 10 years ahead | `FAILED ...::test_the_purges_remove_only_what_they_name` (the round trip and bookkeeping also fail: `begin_claim` purges the lot) | 0 |
| X (extra) | `record_progress` stops resetting `stalled_claims` | `FAILED ...::test_claim_bookkeeping_holds_on_the_real_tables` | 0 |
| Y (extra) | the stall check no longer raises | `FAILED ...::test_claim_bookkeeping_holds_on_the_real_tables` | 0 |

## Deviations from Plan

**1. [Plan instruction: STOP if a float does not survive] A double at or above 1e16 comes back as a Python `int`; the test pins the property instead of stopping**
- **Found during:** Task 1 first live run. `trade 2 field cost: stored 1.7976931348623157e+308, read back 17976931348623157000...0` (309 digits). Reproduced for amount, price and cost: 1,481 values in the 5,001-trade window (every occurrence of 1.7976931348623157e308).
- **Cause (a real Postgres/PostgREST property, not a defect of plan 04's projection):** `json.dumps` writes a double of 1e16 or more as `1e+16`-style text with no fraction; jsonb keeps numbers as exact decimals, so it comes back as a JSON integer literal, which `json.loads` makes an `int`. `int == float` then compares exactly, and the padded shortest-repr digits are not the double's exact value, so a bare `==` is False even though `float(int)` equals the original. Every other extreme survives with `==` and the same type: 5e-324, 2.2250738585072014e-308, 1e-05, 0.1, 0.30000000000000004, 123456.789012345, 100.0, 1.0, -0.0 (== 0.0), and every `None`.
- **Why it was not stopped on:** the value survives (`float(back) == original` for all 1,481), the replay (`equity_reconstruction.py`, the `float(ev.get("amount") or 0.0)` family at lines 1515-1517, 1710, 1715) converts every amount, price and cost with `float(...)`, and a real Bybit trade is nowhere near 1e16. The plan said STOP for "a float that does not survive"; this survives numerically and changes only its Python type.
- **What the test does:** `None` must stay `None`; a `float` must come back as the same type and `==`; the single allowed exception is a stored float of absolute value at or above 1e16 returning as `int` with `float(back) == original`, and the test prints how many it saw (1,481). Any other type change or value change fails the test.
- **Decision left to the orchestrator or founder:** if a type-exact read is wanted, the fix is one line in plan 04's `unproject_trade` (coerce an `int` in the numeric positions to `float`). It was NOT made here: `services/trade_read_store.py` is outside this plan's `files_modified`. If it is made, drop the `int` branch in this test so the stricter contract is pinned.
- **Files modified:** `analytics-service/tests/test_trade_read_store_live.py`. **Commit:** `f0ca8b9ea`.

**2. Scratch directory** — `/tmp/readceiling-11` is a symlink to a directory under the session scratchpad (same arrangement as plan 04; the plan's verify blocks hardcode `/tmp/readceiling-11`). The venv is a git-ignored symlink; `requirements.txt` was byte-identical to the main checkout's.

**3. Extra tests and values beyond the plan** — the value list also holds 5e-324, 0.30000000000000004, 1.0 and 100.0; the bookkeeping test also checks that a later `since_ms` keeps the grid origin and that a new job restarts at one stalled claim and keeps the window; drills W, X and Y were added.

**Total deviations:** 1 (the type-widening pin above); no must-have truth is weakened: the stored window reads back as exactly the trades that went in, value for value.

## Known Stubs

None.

## Threat Flags

None. The probe writes only its own throwaway users' rows on a loopback lane and deletes them in `finally`.

## Self-Check: PASSED

- `analytics-service/tests/test_trade_read_store_live.py`: FOUND; `_require_loopback_lane(` present; `def test_` count 4; `is not None` asserted on every claim.
- Commits `f0ca8b9ea`, `77c85ec2a`: ancestors of HEAD on `wt/171-p11`.
- `services/trade_read_store.py`: `cmp` against the pre-drill backup exit 0; nothing under `analytics-service/` uncommitted; STATE.md and ROADMAP.md untouched.
- `docker ps -q` after the plan: 0 containers.
