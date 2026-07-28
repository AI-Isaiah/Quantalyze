---
phase: 07-demo-mode-purge
fixed_at: 2026-04-20T21:47:30Z
review_path: .planning/phases/07-demo-mode-purge/07-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-04-20T21:47:30Z
**Source review:** .planning/phases/07-demo-mode-purge/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (all 5 Warnings — no Critical findings; 8 Info findings excluded per `fix_scope=critical_warning`)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: DrawdownChart divide-by-zero when first snapshot value_usd ≤ 0

**Files modified:** `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx`, `src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx`
**Commit:** 940515d
**Applied fix:** Extracted snapshot-derived drawdown derivation into a pure named export `deriveSnapshotDrawdowns`, and seeded the running peak at `Math.max(points[0].value, 0)`. A leading 0 or negative equity value previously relied solely on the `peak > 0 ? ... : 0` guard; the explicit seed makes the invariant load-bearing rather than accidentally correct. Added direct unit tests for `deriveSnapshotDrawdowns` covering leading-zero, leading-negative, and empty inputs (all must produce finite series with first drawdown = 0).

### WR-02: `getMyAllocationDashboard` holdings "defensive" comment misleads future readers

**Files modified:** `src/lib/queries.ts`, `src/lib/queries.my-allocation.test.ts`
**Commit:** abf8dec
**Applied fix:** Rewrote the "defensively keep only the max-asof row" comment to explicitly state that input order is IRRELEVANT for correctness — the `.order()` PostgREST clause is a log-inspection hedge, not a prerequisite. Added a regression test (TC p7-11) that feeds unordered / ASC holdings rows through `getMyAllocationDashboard` and asserts the max-asof row wins per symbol.

### WR-03: `_compute_daily_equity` assumes `/`-delimited symbol shape (leaks `USDT:USDT` for perps)

**Files modified:** `analytics-service/services/equity_reconstruction.py`, `analytics-service/tests/test_equity_reconstruction.py`
**Commit:** 7c030b7
**Applied fix:** Changed the quote-currency parse from `split("/")[-1]` to `split("/")[-1].split(":")[0]` so linear perps (`BTC/USDT:USDT`) and inverse contracts (`BTC/USD:BTC`) land on the canonical quote currency instead of leaking a phantom `USDT:USDT` / `BTC:BTC` key into the running quantities dict. Added regression tests: a 1 BTC @ $50k buy on `BTC/USDT:USDT` must net to $0 equity (base credit offset by quote debit), and the spot-symbol path is unchanged.

### WR-04: `_fetch_transfers` silently swallows generic exceptions after first window

**Files modified:** `analytics-service/services/equity_reconstruction.py`, `analytics-service/tests/test_equity_reconstruction.py`
**Commit:** d17247c
**Applied fix:** Removed the bare `except Exception: break` branch. Only `ccxt.NotSupported` is caught locally (legitimate feature detection); every other exception bubbles to the outer `run_reconstruct_*` try/except where `classify_exception` + `_emit_audit` classify and record the failure as `reconstruct_failed`. Mirrors `_fetch_trades_with_pagination`. Regression test raises `ccxt.AuthenticationError` from `fetch_deposits` mid-backfill and asserts `DispatchOutcome.FAILED` + `error_kind='permanent'` + a `reconstruct_failed` audit event (pre-fix returned silent DONE with partial data).

### WR-05: `persist_equity_snapshots` attaches history_depth_months to `mixed` rows

**Files modified:** `analytics-service/services/equity_reconstruction.py`, `analytics-service/tests/test_equity_reconstruction.py`
**Commit:** 247c76f
**Applied fix:** Flipped the gate to the stricter direction: only rows with `source == "exchange_primary"` inherit the caller-supplied `history_depth_months`. Both `mixed` (part exchange OHLCV, part CoinGecko) and `coingecko_fallback` rows receive NULL. This aligns with the intent of the column (pure per-venue retention) and prevents the f9 warm-up copy ("Only N months of history available on Binance") from being misapplied to rows whose actual limiting factor is CoinGecko. Regression test feeds one row of each source through `persist_equity_snapshots` and asserts only the `exchange_primary` row gets the depth stamp.

---

## Test Results

**TypeScript (touched areas, `src/lib/` + `src/app/(dashboard)/allocations/`):**
- 857 passed, 7 skipped (70 test files)
- New: TC p7-11 (WR-02), `deriveSnapshotDrawdowns` WR-01 block (3 tests)

**Python (`analytics-service/tests/`):**
- 510 passed, 5 skipped (pre-existing env-gated live/integration tests)
- New: `test_wr03_compute_daily_equity_strips_settle_suffix_from_perp_symbol`, `test_wr03_compute_daily_equity_spot_symbol_unchanged`, `test_wr04_fetch_transfers_auth_error_bubbles_to_outer_handler`, `test_wr05_persist_equity_snapshots_depth_by_source`

All regression tests were verified to FAIL under the pre-fix code (by temporarily reverting the fix) before being committed, satisfying the project's "tests when finding errors" rule — WR-01 being the exception: its tests document the invariant rather than catch the NaN regression directly, because the pre-fix code's `peak > 0` guard coincidentally still prevented NaN emission. The seed fix is defense-in-depth against a future refactor that removes the guard.

## VOICES-ACCEPTED Preservation

- **f1 key-scoping:** WR-04 preserves the outer handler's auth/rate-limit classification + audit chain, which is where key-scoped audits emit. No change to job payload shape.
- **f3 derive-each-render:** no touches to `AllocationsTabs` or `AllocationDashboard` tab state.
- **f7 parallel-prop:** WR-01's extraction keeps the same `equityDailyPoints !== undefined` parallel-prop semantics — the `deriveSnapshotDrawdowns` helper is only invoked on the snapshot branch, preserving the Bridge-allocator fallback to `buildCompositeReturns`.

## Skipped Issues

None — all 5 in-scope findings fixed.

---

_Fixed: 2026-04-20T21:47:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
