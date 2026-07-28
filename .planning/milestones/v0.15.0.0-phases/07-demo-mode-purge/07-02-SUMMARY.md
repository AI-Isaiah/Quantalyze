---
phase: 07-demo-mode-purge
plan: 02
subsystem: python-worker
tags: [python, fastapi, worker, ccxt, coingecko, equity-reconstruction]

# Dependency graph
requires:
  - phase: 07-demo-mode-purge
    plan: 01
    provides: "allocator_equity_snapshots + token_price_history + key-scoped job kinds + request_allocator_holdings_sync reconstruct enqueue"
provides:
  - "services.equity_reconstruction.run_reconstruct_allocator_history_job (per-key, idempotent backfill)"
  - "services.equity_reconstruction.run_refresh_allocator_equity_daily_job (per-key, aggregate-at-UPSERT daily delta)"
  - "services.equity_reconstruction.VENUE_HISTORY_DEPTH_MONTHS (binance=24, okx=3, bybit=24)"
  - "services.equity_reconstruction.history_depth_months_for_venue(venue) helper"
  - "job_worker.dispatch() extended: TIMEOUT_PER_KIND + elif branches for both new kinds"
  - "pytest TDD Red gate: 7 tests (9 with parametrization), all GREEN"
  - "env-gated live ccxt smoke per venue (QUANTALYZE_LIVE_CCXT=1)"
  - "env-gated test-DB end-to-end integration (QUANTALYZE_INTEGRATION_DB=1)"
affects: [07-03-getMyAllocationDashboard-rewire, 07-04-allocations-tabbed-layout, 09-bridge-live-holdings]

# Tech tracking
tech-stack:
  added: []  # No new runtime packages; ccxt.async_support + httpx already pinned in Phase 06
  patterns:
    - "Per-key compute-job handlers that aggregate at UPSERT on (allocator_id, asof) DO NOTHING — f1 BLOCKER semantics"
    - "Pre-emptive OKX terminus log fire: when since_ms < now-90d on OKX, log sentinel string + force history_depth_months=3 + clamp cursor"
    - "CoinGecko fallback cache-first (token_price_history SELECT), then fetch, then batch-UPSERT — never logs response body (T-07-V6 mitigation)"
    - "Per-venue history_depth_months injected at persist-time, with coingecko-fallback rows carrying NULL (f9)"
    - "Env-gated pytest.skip(..., allow_module_level=True) for live + integration suites — default CI sees zero collected tests in these files"

key-files:
  created:
    - "analytics-service/services/equity_reconstruction.py (~570 lines)"
    - "analytics-service/tests/test_equity_reconstruction.py (855 lines, 9 test cases)"
    - "analytics-service/tests/test_equity_reconstruction_live.py (147 lines)"
    - "analytics-service/tests/test_equity_reconstruction_integration.py (172 lines)"
  modified:
    - "analytics-service/services/job_worker.py (+8 lines: TIMEOUT_PER_KIND + dispatch elif)"

key-decisions:
  - "OKX terminus detected PRE-FETCH (not just on empty-page): if caller-requested since_ms predates the 90-day cap, log sentinel + clamp cursor to terminus + stamp hit_okx_terminus. This matches real OKX behaviour where any fetch_my_trades with since < 90d returns empty AND captures the 'capped' fact before the handler begins pagination."
  - "Reconstruction handler short-circuits to DONE when allocator_equity_snapshots already has rows for this allocator — emits allocator.equity.reconstruct_complete{reason:already_reconstructed}. Threat T-07-V5 (double-enqueue race) is belt-AND-suspenders mitigated: partial unique index (07-01) + early-return + ON CONFLICT DO NOTHING."
  - "Daily refresh consumes allocator_holdings (populated by Phase 06 poll_allocator_positions at 04:00 UTC) rather than re-fetching from the exchange — cron runs at 05:00 UTC so holdings are always fresh. value_usd is summed across (allocator_id, asof) from the pre-joined Phase 06 rows; derivative vs spot mix is preserved in the breakdown jsonb."
  - "ccxt.BadSymbol is the ONLY exception class that triggers CoinGecko fallback — NetworkError / RateLimitExceeded / Auth errors propagate up to the handler's exception path as usual. This keeps the fallback surface narrow (one specific 'the exchange doesn't list this symbol' case) and prevents masking auth failures as price-missing."
  - "_cap_breakdown falls back to top-20 by absolute USD value if the breakdown jsonb exceeds RAW_PAYLOAD_CAP_BYTES (4KB). Preserves the dashboard tooltip's most-impactful symbols while keeping row size bounded (threat T-07-V7 DoS secondary mitigation)."

patterns-established:
  - "Pre-fetch OKX terminus check pattern — same shape can drop into any future venue with a fetch-since cap (e.g., if Bybit ever tightens its 2-year limit)"
  - "Env-gated integration test guard (pytest.skip module-level) — cleanest pattern for secret-requiring tests that must coexist with default-CI green"
  - "Per-key handler + aggregate-at-UPSERT is the f1 BLOCKER fix expressed in code — reusable for any future allocator-scoped compute kind that needs to operate per-key (e.g., funding-fee backfill, PnL attribution)"

requirements-completed: [PURGE-02]

# Metrics
duration: ~15min
completed: 2026-04-20
---

# Phase 07 Plan 02: Historical Equity Reconstruction Worker Summary

**Ships `equity_reconstruction.py` — two key-scoped async handlers (`reconstruct_allocator_history`, `refresh_allocator_equity_daily`) with ccxt pagination, OKX 3-month terminus handling, CoinGecko fallback, per-venue `history_depth_months` recording, and four test files (9 TDD Red gate tests GREEN + 2 env-gated integration suites committed skipped).**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-20T17:20:47Z
- **Completed:** 2026-04-20T17:36:01Z
- **Tasks:** 5 (all completed)
- **Files created:** 4 (module + 3 test files)
- **Files modified:** 1 (job_worker.py, +8 lines)

## Accomplishments

- **Per-key handlers landed (f1 BLOCKER preserved):** Both entrypoints call `_allocator_key_preflight` which hard-requires `job['api_key_id']`. Allocator id is derived exactly once from `ctx.key_row["user_id"]` — never from the job dict — mirroring the Phase 06 owner-coherence trigger discipline (Pitfall 5 / threat T-07-V4b). Aggregation across an allocator's multiple keys happens naturally at the UPSERT layer via `ON CONFLICT (allocator_id, asof) DO NOTHING`.
- **TDD Red gate → GREEN in one cycle:** 9 test cases (7 logical, parametrization expands venue test to 3) all pass on the first implementation commit after a single targeted fix (pre-fetch OKX terminus check to match test mock semantics). Zero test quarantining; zero xfail.
- **OKX 3-month terminus handled per RESEARCH.md Pitfall 1:** Pre-fetch check on `since_ms < now-90d` logs the literal sentinel `"OKX trade history capped at 3 months"` (used by `caplog.records` assertion in the RED gate test), clamps the cursor, and forces `history_depth_months=3` on the resulting rows regardless of the VENUE_HISTORY_DEPTH_MONTHS lookup.
- **CoinGecko fallback cache-first:** `_read_cached_prices(symbol, start_iso, end_iso)` checks `token_price_history` before any CoinGecko HTTP call; writes batch-UPSERT on `(symbol, asof)` with `ignore_duplicates=True`. Never logs the response body — threat T-07-V6 mitigation enforced by logging-line discipline (only symbol + day-count + HTTP status).
- **f9 per-venue history_depth_months:** `VENUE_HISTORY_DEPTH_MONTHS = {binance: 24, okx: 3, bybit: 24}` exported; `history_depth_months_for_venue(venue)` helper resolves lookup to populate every non-fallback snapshot row. `coingecko_fallback`-sourced rows carry NULL depth (by design).
- **Dispatch registration is a 2-line-per-kind surgical edit:** `TIMEOUT_PER_KIND` gains 30min + 3min entries; `dispatch()` elif chain gains two lazy-import branches mirroring the existing `run_compute_analytics_job` pattern. No refactor of the dispatch dict, no new abstraction.
- **Env-gated verification suites authored per VOICES-ACCEPTED f5 + Grok f3:**
  - `tests/test_equity_reconstruction_live.py` — parametrized over binance/okx/bybit; reads real API keys from env; asserts OKX span ≤ 92 days + `history_depth_months == 3` for OKX rows.
  - `tests/test_equity_reconstruction_integration.py` — seeds allocator_holdings → invokes the daily refresh handler → mirrors `getMyAllocationDashboard`'s equity query shape → asserts `equitySnapshots` array non-empty AND `value_usd > 0` (proves charts have non-zero series).
- **No Phase 06 regression:** `test_allocator_positions` 9/9 GREEN; `test_job_worker` 27/27 GREEN; full analytics-service suite 506 passed / 5 skipped / 0 failed.

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD Red gate — 9-test pytest scaffold** — `825d390` (test)
2. **Task 2: equity_reconstruction.py module (~570 lines)** — `8ad33b0` (feat)
3. **Task 3: job_worker.py dispatch + TIMEOUT_PER_KIND registration** — `f61a60a` (feat, +8 lines)
4. **Task 4: env-gated live ccxt integration test** — `47c05c2` (test)
5. **Task 5: env-gated test-DB end-to-end integration test** — `e69238e` (test)

## Files Created/Modified

### Created
- `analytics-service/services/equity_reconstruction.py` — 2 entry handlers + ccxt fetch layer (`_fetch_trades_with_pagination`, `_fetch_transfers`, `_fetch_ohlcv_daily`) + CoinGecko layer (`_fetch_coingecko_daily_closes`, `_cache_coingecko_prices`, `_read_cached_prices`) + pure compute (`_compute_daily_equity`) + persistence (`persist_equity_snapshots`) + `VENUE_HISTORY_DEPTH_MONTHS` + `history_depth_months_for_venue`.
- `analytics-service/tests/test_equity_reconstruction.py` — 9 test cases (5 originals + history_depth_months parametrized ×3 + aggregate-across-keys). In-memory `FakeSupabaseClient` with ON CONFLICT DO NOTHING semantics; AsyncMock ccxt + patched httpx.AsyncClient for CoinGecko test.
- `analytics-service/tests/test_equity_reconstruction_live.py` — env-gated parametrized smoke for binance/okx/bybit + per-venue env var loading with granular skip-on-missing-creds.
- `analytics-service/tests/test_equity_reconstruction_integration.py` — env-gated full-pipeline test: seed holdings → invoke handler → assert snapshot row → mirror dashboard query → assert non-zero series.

### Modified
- `analytics-service/services/job_worker.py` — +8 lines only (TIMEOUT_PER_KIND ×2 + dispatch elif ×2, verified via `git diff --stat`).

## Test Count + Pass Status

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/test_equity_reconstruction.py` | 9 | ✅ 9/9 GREEN (unit, mocked) |
| `tests/test_equity_reconstruction_live.py` | 3 parametrized | ⏭ skipped by default (env-gated QUANTALYZE_LIVE_CCXT=1) |
| `tests/test_equity_reconstruction_integration.py` | 1 | ⏭ skipped by default (env-gated QUANTALYZE_INTEGRATION_DB=1) |
| `tests/test_allocator_positions.py` (Phase 06 regression) | 9 | ✅ 9/9 GREEN (no regression) |
| `tests/test_job_worker.py` (regression) | 27 | ✅ 27/27 GREEN |
| Full analytics-service suite | 506 | ✅ 506 passed, 5 skipped, 0 failed |

## TDD Red gate → GREEN trace

- **Initial RED (post-Task 1 commit `825d390`):** `pytest tests/test_equity_reconstruction.py --collect-only` → `ModuleNotFoundError: services.equity_reconstruction` (expected — module does not yet exist, per TDD Red gate pattern).
- **First GREEN attempt (post-Task 2 commit `8ad33b0`):** 8/9 tests pass; `test_reconstruct_okx_3month_terminus` failed because sentinel log fired only on empty-page-inside-terminus, not on request-window-predates-terminus. Handler semantics clarified: OKX terminus is a property of the request window, not just of the empty-page response.
- **Final GREEN (post-pre-fetch terminus check):** 9/9 GREEN. The fix was appended in the same Task 2 commit (pre-Task 3), so Task 2 is clean on first push.

## Decisions Made

### Pre-fetch OKX terminus check

Implementation deviated slightly from the literal RESEARCH.md Pitfall 1 wording (which says "on empty page response, check if `since` is older than 90 days"). The test's mock returns non-empty trades on first call (trades that fall INSIDE the terminus window), so an empty-page-only check fails to fire the sentinel when the handler was asked to backfill 730d but only finds 60d of trades.

The correct semantic is: **if the caller-requested backfill window predates the terminus, fire the sentinel before the first fetch** — this expresses "we know this venue caps at 90d and you asked for more; clamp and log". This matches real OKX behaviour (fetch_my_trades with since < 90d returns empty) AND gives the handler the information it needs to stamp `history_depth_months=3` regardless of whether the mock is realistic.

### CoinGecko fallback trigger narrowness

Only `ccxt.BadSymbol` triggers CoinGecko fallback. NetworkError / RateLimitExceeded / Auth errors propagate up to the handler's existing exception path — they must NOT be masked as "price missing" because that would silently convert a Binance outage into a "use CoinGecko for all symbols" failover storm. Explicit catch of BadSymbol only is documented in the module docstring.

### Daily refresh reads allocator_holdings (not re-fetches)

The 05:00 UTC daily cron runs an hour after Phase 06's 04:00 UTC `poll-allocator-positions` cron. `run_refresh_allocator_equity_daily_job` reads today's rows from `allocator_holdings` and sums `value_usd` per symbol — no re-fetch from the exchange. This keeps the 3-minute per-key timeout easy to honour and matches Pitfall 6's scheduling intent. The handler is exchange-aware only for the Preflight (credentials decrypt, circuit breaker), which it must run to honour the per-exchange cooldown contagion from Phase 06.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Pre-fetch OKX terminus check**
- **Found during:** Task 2 GREEN attempt (8/9 passing)
- **Issue:** RESEARCH.md Pitfall 1 describes the sentinel firing "on empty page response, check if since < 90d". The test fixture returns non-empty trades on first call (60-day-old trades within terminus) followed by empty on cursor advance. The empty-page-only check never fires because cursor (60d ago) is NOT older than terminus (90d ago).
- **Fix:** Added pre-fetch check in `_fetch_trades_with_pagination`: if the caller-requested `since_ms < okx_terminus_ms` AND venue is OKX, log the sentinel, set `hit_okx_terminus=True`, and clamp cursor to `okx_terminus_ms` before the first fetch_my_trades call.
- **Files modified:** analytics-service/services/equity_reconstruction.py
- **Committed in:** `8ad33b0` (same commit as the initial module — the edit was appended before Task 2's final commit push)

**Total deviations:** 1 (Rule 3 — matches planned semantic but extends the trigger to pre-fetch; planned semantic remains covered).

## Threat surface handled

| Threat ID | Status | Code-level mitigation |
|-----------|--------|-----------------------|
| T-07-V4b (wrong allocator_id) | mitigated | `allocator_id = ctx.key_row["user_id"]` — never from job dict |
| T-07-V5 (double-enqueue race) | mitigated | early-return on existing snapshots + ON CONFLICT DO NOTHING |
| T-07-V5b (two keys/same day race) | mitigated | ON CONFLICT (allocator_id, asof) DO NOTHING — first key wins; second is benign (proven by `test_refresh_daily_aggregates_across_keys`) |
| T-07-V6 (CoinGecko body logged) | mitigated | logger.info only records symbol + day-count + HTTP status; never response body |
| T-07-V7 (rate-limit DoS) | mitigated | 30-min `asyncio.wait_for` via `TIMEOUT_PER_KIND` + RateLimitExceeded → `_stamp_429` |
| T-07-V9 (SQL injection) | mitigated | All writes through `supabase.table(...).upsert(...)` parameterised calls; no f-string SQL |
| T-07-V10 (live test leaks secrets) | mitigated | Per-venue creds only from env; zero hardcoded secrets in `_live.py` or `_integration.py` |

T-07-V8 (forged CoinGecko response) remains accepted per plan's threat model.

## Manual QA step (VOICES-ACCEPTED f9 / Grok f4 reinforcement)

**Instructions for post-ship spot-check against live exchange UIs:**

1. Connect a test read-only API key to Binance AND to OKX via `/profile?tab=exchanges`.
2. After `request_allocator_holdings_sync` completes its first-connect reconstruction (observable via `compute_jobs` row with kind=`reconstruct_allocator_history` reaching `done`), query:
   ```sql
   SELECT asof, value_usd, breakdown, history_depth_months, source
   FROM allocator_equity_snapshots
   WHERE allocator_id = '<test-allocator-uuid>'
   ORDER BY asof DESC
   LIMIT 5;
   ```
3. Compare `value_usd` of the latest row against the portfolio value shown in the respective exchange's own UI ("Total Account Balance" in Binance spot wallet, "Total Assets" in OKX portfolio view).
4. **Acceptance:** `value_usd` must match within 5% of the exchange's own USD valuation.
5. **If mismatch > 5%:** escalate — likely candidates are (a) a held symbol missing from `COINGECKO_ID_OVERRIDES` that needs adding, (b) a stale `token_price_history` row that needs deletion + refetch, or (c) a breakdown-cap truncation if the portfolio has > 20 symbols.

**Result on this ship:** deferred until human execution against a real test allocator. Not blocking — unit tests prove the compute pipeline; this is a calibration spot-check for production fidelity.

## Instructions for running env-gated suites locally

### `_live.py` — live ccxt integration

```bash
export QUANTALYZE_LIVE_CCXT=1
export SUPABASE_URL=<test-project-url>
export SUPABASE_SERVICE_KEY=<test-project-service-key>
export QUANTALYZE_TEST_ALLOCATOR_ID=<uuid-of-seeded-test-allocator>

# Per venue — skip venues without creds
export BINANCE_TEST_API_KEY=... BINANCE_TEST_API_SECRET=...
export QUANTALYZE_TEST_BINANCE_KEY_ID=<api_keys row id for the above>

export OKX_TEST_API_KEY=... OKX_TEST_API_SECRET=... OKX_TEST_API_PASSPHRASE=...
export QUANTALYZE_TEST_OKX_KEY_ID=...

export BYBIT_TEST_API_KEY=... BYBIT_TEST_API_SECRET=...
export QUANTALYZE_TEST_BYBIT_KEY_ID=...

cd analytics-service && pytest tests/test_equity_reconstruction_live.py -v
```

### `_integration.py` — test-DB end-to-end

```bash
export QUANTALYZE_INTEGRATION_DB=1
export SUPABASE_URL=<test-project-url>
export SUPABASE_SERVICE_KEY=<test-project-service-key>
export QUANTALYZE_TEST_ALLOCATOR_ID=<uuid-of-seeded-test-allocator>
export QUANTALYZE_TEST_BINANCE_KEY_ID=<api_keys row id>

cd analytics-service && pytest tests/test_equity_reconstruction_integration.py -v
```

Both suites are **skipped by default in CI** — `pytest --collect-only` in a fresh environment shows `0 items / 2 skipped` for these files (verified).

## Issues Encountered

- **OKX terminus semantic refinement** (documented above). The plan's Pitfall 1 wording described the post-empty-page check; the test's happy path demanded the pre-fetch check. Both cover the same real-world scenario (empty page older than 90d), but the pre-fetch check is strictly more robust because it fires even when the test mock returns non-empty trades clamped inside the terminus.
- **No other issues.** Zero flaky tests, zero Phase 06 regressions, zero environment setup required beyond the pre-existing `pip install -r analytics-service/requirements.txt`.

## User Setup Required

None for the default CI path. For local execution of env-gated suites, see the instructions above.

## Next Phase Readiness

- **07-03 (getMyAllocationDashboard rewire):** Unblocked. `allocator_equity_snapshots` is queryable via the owner-scoped client (owner SELECT policy from 07-01). Plan 07-03 can consume `equitySnapshots`, `snapshotCount` (via COUNT-exact head=true), `minHistoryDepthMonths` (via `MIN(history_depth_months) FILTER (WHERE source != 'coingecko_fallback')`), and `activeVenues` (via DISTINCT on an api_keys join). The parallel-prop `equityDailyPoints` wiring from VOICES-ACCEPTED f7 consumes the `asof, value_usd, source` triple which persist_equity_snapshots now guarantees.
- **07-04 (Tabbed layout), 07-05 (Empty state):** No direct dependency on this plan's output; can proceed in parallel once 07-03 lands.
- **Phase 09 (Bridge Live):** Will consume the same equity snapshots as the allocator dashboard — the cron + RLS + backfill pipeline is already production-ready.

### Deferred items

- Live value_usd spot-check against exchange UI (documented above as manual QA step) — defer to human execution against a real test allocator.

## Self-Check: PASSED

- FOUND: analytics-service/services/equity_reconstruction.py
- FOUND: analytics-service/tests/test_equity_reconstruction.py
- FOUND: analytics-service/tests/test_equity_reconstruction_live.py
- FOUND: analytics-service/tests/test_equity_reconstruction_integration.py
- FOUND: analytics-service/services/job_worker.py (modified)
- FOUND: .planning/phases/07-demo-mode-purge/07-02-SUMMARY.md
- FOUND commit: 825d390 (test — TDD Red gate)
- FOUND commit: 8ad33b0 (feat — module implementation)
- FOUND commit: f61a60a (feat — dispatch registration)
- FOUND commit: 47c05c2 (test — env-gated live ccxt)
- FOUND commit: e69238e (test — env-gated test-DB integration)

---
*Phase: 07-demo-mode-purge*
*Completed: 2026-04-20*
