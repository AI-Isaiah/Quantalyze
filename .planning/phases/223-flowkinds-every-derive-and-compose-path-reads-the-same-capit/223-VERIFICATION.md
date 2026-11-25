---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
verified: 2026-11-24T17:00:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: adca3ebeb6a3d61f2c58312930c13909e972688c
drift_subjects:
  - analytics-service/services/okx_archive_job.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/funding_fetch.py
  - analytics-service/services/exchange.py
  - analytics-service/tests/test_okx_archive_apply.py
  - analytics-service/tests/test_job_worker_sync_funding.py
  - analytics-service/tests/test_job_worker_funding_cursor.py
  - analytics-service/tests/test_funding_fetch.py
  - analytics-service/tests/test_bybitreads_census_pins.py
  - analytics-service/tests/test_daily_pnl_read_verdict.py
behavior_unverified: 0
overrides_applied: 0
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `a1aeda57a`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `adca3ebeb` (#1327) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only a1aeda57a adca3ebeb -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.

# Phase 223: FLOWKINDS Verification Report

**Phase Goal:** Each funding caller outside the composite path refuses a malformed funding row by name or keeps dropping it, by a recorded decision a test pins, and no refusal of a malformed realized row is switched on before the PROD malformed count and the founder's ruling are on record.
**Verified:** 2026-11-24 at HEAD `a1aeda57a474819c06942150b52c0b2eb02fe18a`, branch `gsd/phase-223-flowkinds`
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | SC-1: `run_sync_funding_job` and `okx_archive_job` each have a recorded decision pinned by a test (FLOWK-02) | VERIFIED | `okx_archive_job._live_reference` passes `on_malformed="raise"` and maps `FundingRowsMalformed` to `_Stop("live_anchor_unusable", "live_funding=malformed")` (fixed literal, `from None`). Ruling recorded in CONTEXT and in the docstring. Pinned by `TestLiveFundingMalformed` (calibrate and apply, zero writes, plus a clean-read twin). `run_sync_funding_job` keeps the default drop for binance, okx and bybit; the decision and reason are in its docstring and CONTEXT; pinned by `TestSyncFundingMalformedRowDecision[binance/okx/bybit]` with real fetchers. |
| 2 | SC-2: the PROD per-key count is recorded read-only with date, brought to the founder, and the ruling on a realized-row refusal is recorded before any refusal is switched on (FLOWK-03) | VERIFIED | `223-PROD-MALFORMED-COUNT.md` (2026-11-24, marker checked, SELECT only, 0 flags on every measured key and strategy, unmeasured rows named). Ruling 2 "Keep flagging" in CONTEXT and ROADMAP. No code adds a realized-row refusal: `daily_pnl_read_verdict` still ignores `daily_pnl_malformed_*` (diff is docstring-only), pinned by `test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing`. |
| 3 | SC-3: TODOS deletions and CHANGELOG in the ship PR | VERIFIED (ship-time by design) | Not failed on this. `closes-todos:` lines are present: `223-02-SUMMARY.md` (186-REALIZED-MALFORMED-COUNT) and `223-05-SUMMARY.md` (186-OTHER-FUNDING-CALLERS-DROP, composite caller recorded as out of scope by F-2, not fixed). `223-VALIDATION.md` records the ship-time obligation. Both TODOS entries are still present, as expected before ship. |
| 4 | SC-4: PROOF-01, each decision test RED on a neutered caller, restored by byte backup, GREEN | VERIFIED | Verbatim neuter/RED/cmp/GREEN records in 223-01 (2 cycles), 223-02, 223-03 (2), 223-04 (5), 223-05 (3 venues). Independently re-run by this verifier: OKX keyword removed gives `2 failed, 1 passed` (calibrate and apply RED); Bybit store-once-after-loop neuter gives `5 failed, 4 passed` in the `c27` group, including the cancelled-walk test. Both restored from byte backup, `cmp` clean, `git status --porcelain` empty, `213 passed` after restore. |
| 5 | SC-5: C27, a budget-cut Bybit walk keeps every finished window, a timeout still fails the job, a test pins the cancelled walk under PROOF-01 | VERIFIED | `fetch_funding_bybit(..., until_ms=)` and `bybit_funding_windows` (shares the `_windows` seam). The Bybit arm walks oldest window first and calls `_store_funding_window` per window (ascending sort, 500-row slices, return at first failing slice) before reading the next. No self-deadline, no catch of cancellation. `test_c27_a_cancelled_walk_keeps_the_windows_it_finished_and_fails_transient` runs the real `dispatch` with the real `asyncio.wait_for`, a 1.5 s budget and the real fetcher; it asserts FAILED, transient, `Handler exceeded timeout`, an upsert after each of two windows and none for the third. It goes RED under the store-once neuter (re-run here). |

**Score:** 5/5 truths verified (0 present, behavior-unverified).

The two behavior-dependent truths (SC-5's cancellation invariant and SC-1's refuse-before-any-write) are each backed by a passing named test that this verifier saw go RED on a neutered caller, so neither rests on symbol presence.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/okx_archive_job.py` | raise keyword and named stop | VERIFIED | `_live_reference` lines in diff; `FundingRowsMalformed` imported and used; wired to calibrate and apply via `_evaluate` |
| `analytics-service/services/funding_fetch.py` | `until_ms`, `bybit_funding_windows` | VERIFIED | Both present; helper used by the handler; fetcher default walk unchanged (census C27 pin unedited in logic) |
| `analytics-service/services/job_worker.py` | windowed store-per-window Bybit arm, `_store_funding_window`, decision docstring | VERIFIED | Wired in the Bybit arm; `finally` still closes the exchange; `ccxt.RateLimitExceeded` path still stamps 429 and re-raises |
| `analytics-service/services/exchange.py` | D-12 docstring with the reading and ruling | VERIFIED | Docstring-only change (+3/-2) |
| `223-PROD-MALFORMED-COUNT.md` | dated read-only count | VERIFIED | Present, substantive |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `run_sync_funding_job` Bybit arm | `bybit_funding_windows` and `fetch_funding_bybit(until_ms=w_end)` | per-window loop | WIRED |
| Bybit arm | `_store_funding_window` then `upsert_funding_rows` | called before the next window's read | WIRED |
| `_live_reference` | `_Stop` to `_evaluate` before any write | `except FundingRowsMalformed` | WIRED |
| `bybit_funding_windows` | `exchange_pagination._windows` | same seam as the fetcher's inner walk, so a per-window read is one inner window | WIRED |

### Data-Flow Trace (Level 4)

Not applicable beyond the above: no rendered UI. Rows flow fetcher, sorted slices, `upsert_funding_rows` (idempotent on `match_key`, unique in migration `20260416081039_funding_fees.sql`), so the 2-day overlap re-read writes no duplicates.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Seven-file quick set | `.venv/bin/python -m pytest tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py -q -p no:cacheprovider` | `963 passed in 10.53s` | PASS |
| mypy strict (CI command) | `.venv/bin/python -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 142 source files` | PASS |
| OKX neuter RED | keyword removed, `-k LiveFundingMalformed` | `2 failed, 1 passed`, restored, `cmp` clean | PASS |
| C27 neuter RED | store-once-after-loop, `-k c27` | `5 failed, 4 passed`, restored, `cmp` clean | PASS |

The full suite (15608 passed, 93 skipped, 94.79% coverage) is the executor's record in 223-05-SUMMARY; this verifier did not re-run it.

### Probe Execution

Step 7c: SKIPPED (no probes declared by the phase).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| FLOWK-02 | 223-01, 223-05 (also 223-03, 223-04 for C27) | SATISFIED | SC-1 evidence above |
| FLOWK-03 | 223-02 | SATISFIED | SC-2 evidence above |
| FLOWK-01 | none | Out of scope | Dropped by founder ruling F-2 (2026-11-23); not mapped to this phase |

No orphaned requirements.

### Anti-Patterns Found

None blocking. No TBD/FIXME/XXX markers in the changed service lines. Code review `223-REVIEW.md` is clean at MEDIUM and above. One silent-failure-hunter MEDIUM (SFH-1: a run of empty leading windows does not move the funding cursor) was booked as a known limit, not user-facing or data-integrity because no published number reads `funding_fees`; it reopens if a first walk is measured timing out before its first row.

### Human Verification Required

None before ship.

Post-ship observation (not a pre-ship must-have, recorded in `223-VALIDATION.md` Manual-Only Verifications): after deploy, a read-only check that `funding_fees` fills for the Bybit strategy and that `sync_funding` outcomes stop being `Handler exceeded timeout`.

### Ship-time obligations (not gaps)

- Delete `[186-OTHER-FUNDING-CALLERS-DROP]` and `[186-REALIZED-MALFORMED-COUNT]` from `TODOS.md` in the ship PR and name them in the CHANGELOG entry; state that the composite caller is out of scope by F-2, not fixed.
- Record the known limits (per-window inverse refusal WARNING, empty windows not persisted, single window over the page ceiling still fails that day, OKX and Binance arms store once after their walk with no measured timeout).

### Gaps Summary

No gaps. Every success criterion is backed by code at HEAD and by tests this verifier ran, and the two decisive neuters were independently reproduced RED and restored byte-identical.

---

_Verified: 2026-11-24T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
