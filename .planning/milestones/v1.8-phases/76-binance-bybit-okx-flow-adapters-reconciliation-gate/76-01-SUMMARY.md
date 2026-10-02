---
phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate
plan: 01
subsystem: analytics
tags: [ccxt, pagination, equity-reconstruction, flow-fetch, twr, deposits, withdrawals]

# Dependency graph
requires:
  - phase: 07-equity-reconstruction
    provides: "_fetch_transfers (paginated ccxt deposit/withdrawal fetch) + its allocator-dashboard consumer"
  - phase: 75-deribit-flow-adapter
    provides: "ExternalFlow shape + the shared nav_twr union/guard core the flow adapters feed"
provides:
  - "services/ccxt_flow_fetch.py — the ONE shared importable ccxt transfer-fetch path (fetch_ccxt_transfers) + _rate_limit_sleep"
  - "OKX/Bybit under-pagination fix: full multi-page transfer history is fetched (no len<page_limit truncation)"
  - "Characterization pin proving the allocator-dashboard equity reconstruction is byte-identical across the promotion"
affects: [76-04 ccxt flow adapter, 76-02 flow valuation, FLOW-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure/I-O split: venue-agnostic ccxt transfer FETCH lives in its own importable module so every caller rides one path (FLOW-03)"
    - "Cursor-advance + empty-page + window-end pagination termination (never len<page_limit) — mirrors _fetch_ohlcv_daily"
    - "Byte-identity characterization pin (rtol 1e-12) as a before/after safety net around a relocation"

key-files:
  created:
    - analytics-service/services/ccxt_flow_fetch.py
    - analytics-service/tests/test_exchange_pagination.py (transfer-pagination section appended)
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_equity_reconstruction.py

key-decisions:
  - "Moved _rate_limit_sleep into ccxt_flow_fetch alongside fetch_ccxt_transfers (one definition, no circular import — equity_reconstruction imports both)"
  - "Chose the in-repo precedent (drop len<page_limit break, drive by cursor-advance) over ccxt params={'paginate':True} — venue-cursor-support-independent and byte-identical for the allocator path"
  - "Raised the per-window safety ceiling from 100 to 1000 iterations so the ~50k rows/window headroom holds at Bybit's 50-row cap"

patterns-established:
  - "FLOW-03 single flow-fetch path: fetch_ccxt_transfers is the shared home the 76-04 ccxt adapter imports"

requirements-completed: []  # FLOW-03 only PARTIAL — the adapter (76-04) completes it

# Metrics
duration: ~35min
completed: 2026-07-06
---

# Phase 76 Plan 01: ccxt Flow-Fetch Promotion + OKX/Bybit Pagination Fix Summary

**Promoted `_fetch_transfers` verbatim into the shared `services/ccxt_flow_fetch.py` (fetch_ccxt_transfers) with a byte-identity characterization pin, then fixed the latent OKX(100/page)/Bybit(50/page) under-pagination that dropped every transfer past page 1.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-06
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `services/ccxt_flow_fetch.py` is the ONE shared, importable ccxt transfer-fetch path — the ccxt flow adapter (76-04) will ride it, satisfying FLOW-03's "one path, not three copies".
- The allocator-dashboard equity reconstruction is proven byte-identical across the promotion by a committed characterization snapshot (equity curve + breakdown + `pre_terminus_balance_unknown` + telemetry, rtol 1e-12).
- OKX/Bybit multi-page transfer histories are now fully fetched: the `len(page) < page_limit` break that mistook a full venue-capped page for end-of-history is gone (threat T-76-01-TRUNC mitigated), proven by >page-cap fixtures.
- WR-04 exception discipline preserved verbatim (only `ccxt.NotSupported` caught; all else bubbles) — asserted by a dedicated pagination-path test plus the existing end-to-end handler test.

## Task Commits

1. **Task 1: Characterization pin (before/after safety net)** - `feb205de` (test)
2. **Task 2: Promote `_fetch_transfers` → `fetch_ccxt_transfers` shared module** - `6393ac34` (refactor)
3. **Task 3: Fix OKX/Bybit under-pagination (TDD RED→GREEN)** - `caeb0c67` (fix)

## Files Created/Modified
- `analytics-service/services/ccxt_flow_fetch.py` — NEW shared I/O module: `fetch_ccxt_transfers` (paginated ccxt deposit/withdrawal fetch, 90-day windowing, WR-04 discipline) + `_rate_limit_sleep`.
- `analytics-service/services/equity_reconstruction.py` — removed local `_fetch_transfers` + `_rate_limit_sleep`; imports both from the new module; allocator consumer (`_fetch_and_price_window`) re-pointed to `fetch_ccxt_transfers`.
- `analytics-service/tests/test_equity_reconstruction.py` — added the byte-identity characterization pin; re-pointed the WR-ADV-02 direct-import test to the new module.
- `analytics-service/tests/test_exchange_pagination.py` — appended OKX 100/page + Bybit 50/page multi-page proofs, a short-final-page terminate guard, and a NotSupported guard.

## Decisions Made
- **`_rate_limit_sleep` moved (not left behind):** it is shared by the trade/OHLCV paginators too. Leaving it in `equity_reconstruction` while `ccxt_flow_fetch` imported it would create a circular import; moving it down into the low-level I/O module keeps a single definition and a one-directional dependency.
- **Pagination option (a) over (b):** dropped the `len(page) < page_limit` break and drive termination by cursor-advance / empty page / window-end (the in-repo `_fetch_ohlcv_daily` precedent) rather than delegating to ccxt `params={'paginate': True}`. This does not depend on per-venue ccxt cursor support and keeps the allocator characterization pin byte-identical.
- **Safety-ceiling raise (100 → 1000):** with the short-page break removed, the per-window row headroom becomes `ceiling × venue_cap`. At Bybit's 50-row cap, 100 iters would cap a window at 5k rows (a reduction from the old 50k intent). Raised to 1000 to preserve ~50k rows/window regardless of venue cap. Cursor-advance remains the real terminator; the ceiling is a pathological-loop guard only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Characterization fixture did not model ccxt `since_ms` filtering**
- **Found during:** Task 3 (pagination fix)
- **Issue:** The Task 1 pin used `AsyncMock(return_value=deposits)` for `fetch_deposits`/`fetch_withdrawals`, which returns the same rows on every call regardless of `since_ms`. The old short-page break masked this by stopping after one call. Once the cursor-advance fix issued a second (cursor-advanced) call, the naive mock returned the same deposit again and the reconstruction double-counted it (value_usd 2000 → 3000), falsely reddening the pin.
- **Root cause:** test-double fidelity, NOT a production behavior change — real ccxt `fetch_deposits(since=X)` filters by timestamp, so a cursor-advanced second call returns `[]`. Verified directly: naive mock yields 2 rows, a since-filtering fetcher yields 1 (the correct, production-equivalent result).
- **Fix:** Replaced the deposit/withdrawal doubles with `since_ms`-honouring async fetchers. The committed snapshot values are unchanged — the pin is byte-identical GREEN on both pre- and post-fix code, now against a faithful exchange model.
- **Files modified:** analytics-service/tests/test_equity_reconstruction.py
- **Verification:** Characterization pin GREEN; full suite GREEN.
- **Committed in:** `caeb0c67` (Task 3 commit)

**2. [Rule 2 - Missing Critical] Per-window safety-ceiling raised to preserve row capacity**
- **Found during:** Task 3
- **Issue:** Removing the short-page break made the effective per-window row cap `iterations × venue_cap`. At Bybit's 50-row cap this silently dropped from ~50k to 5k rows/window — a residual truncation risk in the same T-76-01-TRUNC threat class the task closes.
- **Fix:** Raised the inner-loop ceiling from `range(100)` to `range(1000)` with an updated rationale comment (1000 × 50 = 50k headroom).
- **Files modified:** analytics-service/services/ccxt_flow_fetch.py
- **Verification:** Multi-page fixtures GREEN; short-page guard proves no over-fetch (cursor-advance still terminates in 2 calls for a 7-row history).
- **Committed in:** `caeb0c67` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical). Both within scope, no scope creep — the naive-mock fix was mandatory to keep the pin honest and the ceiling raise closes the same truncation threat.

## Issues Encountered
- The characterization pin flagged a value drift the moment the pagination fix landed. Rather than blindly re-baseline, traced it to the test-double's missing `since` filter (Deviation 1) and proved production is unaffected before adjusting the fixture — keeping the pin's byte-identity guarantee intact.

## Threat Flags
None — no new security surface. T-76-01-TRUNC mitigated as planned; WR-04 error-bubbling (T-76-01-SIG) preserved verbatim; no package installs (T-76-01-SC).

## Known Stubs
None.

## Verification
- Full analytics suite in CI-3.12 venv: **3041 passed / 92 skipped** (3036 baseline + 5 new tests).
- `test_equity_reconstruction.py` (80) + `test_exchange_pagination.py` (20) all GREEN.
- `mypy --strict` clean on `services/ccxt_flow_fetch.py` + `services/equity_reconstruction.py`.

## Next Phase Readiness
- `fetch_ccxt_transfers` is ready for the 76-04 ccxt flow adapter to import; the shared fetch path (FLOW-03) exists but is only PARTIAL until the adapter wires it.
- 76-02 (flow valuation) and 76-03 (reconciliation gate) remain unbuilt per scope — this plan touched only `equity_reconstruction.py`, the new module, and tests.

## Self-Check: PASSED

- `analytics-service/services/ccxt_flow_fetch.py` — FOUND
- `76-01-SUMMARY.md` — FOUND
- Commits `feb205de`, `6393ac34`, `caeb0c67` — FOUND

---
*Phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate*
*Completed: 2026-07-06*
