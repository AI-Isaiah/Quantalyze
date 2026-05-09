---
phase: 19-unified-backbone-conditional-on-day-2-gate-commit
plan: 03
subsystem: api
tags: [python, fastapi, ccxt, typing-protocol, mypy-strict, adapter-pattern, ingestion-pipeline]

# Dependency graph
requires:
  - phase: 15
    provides: services/csv_validator.py (validate_csv envelope, pandera schemas, 6 CSV-02 rules)
  - phase: 18
    provides: services/exchange.py 629-LOC broker SDK fetchers (REUSE flag — wrap, don't rewrite)
provides:
  - IngestionAdapter Protocol (typing.Protocol, @runtime_checkable, 5 methods)
  - 4 concrete adapters: OkxAdapter, BinanceAdapter, BybitAdapter, CsvAdapter
  - 8 shared dataclasses (KeySubmissionRequest, ValidationResult, Trade, Position, MetricsSnapshot, Fingerprint, VerificationResult; +RawFill remains in exchange.py)
  - 4 Literal type aliases (FlowType, Source, TrustTier, Status)
  - get_adapter(source) lookup with explicit allowlist (UC-B drops MT5/IBKR)
  - Fingerprint.to_jsonb() shape contract (4/4/4/10/24 floats + version=1) for migration 105
  - mypy --strict CI gate scoped to services/ingestion/ (MC-3 fix)
affects: [phase-19-04 process-key router, phase-19-05 thin adapters, phase-19-08 EquityCurveBuilder, phase-19-09 fingerprint v1]

# Tech tracking
tech-stack:
  added: [mypy (CI dev dep)]
  patterns:
    - "typing.Protocol with @runtime_checkable for structural subtyping"
    - "Lazy per-source adapter instantiation (unknown-source rejection avoids importing concrete adapters)"
    - "Lazy method-body imports for cross-wave dependencies (P8/P9 not yet shipped)"
    - "try/finally await ex.close() on every ccxt code path (httpx pool hygiene)"
    - "@dataclass envelope dataclasses (mirrors services/exchange.py:444 RawFill precedent — pydantic only at FastAPI boundary)"

key-files:
  created:
    - analytics-service/services/ingestion/__init__.py
    - analytics-service/services/ingestion/adapter.py
    - analytics-service/services/ingestion/okx.py
    - analytics-service/services/ingestion/binance.py
    - analytics-service/services/ingestion/bybit.py
    - analytics-service/services/ingestion/csv_adapter.py
    - analytics-service/tests/test_ingestion_protocol.py
    - analytics-service/tests/test_csv_adapter.py
    - analytics-service/Makefile
  modified:
    - .github/workflows/ci.yml (added mypy --strict step in python job)

key-decisions:
  - "Source allowlist enforced before any adapter import (lazy lookup) — get_adapter('mt5') returns ValueError without ever loading the concrete adapter modules"
  - "P8 EquityCurveBuilder + P9 compute_fingerprint_v1 are lazy-imported inside method bodies because they ship in Wave 2; hard imports would create a forbidden Wave-1→Wave-2 cycle"
  - "Bybit currency-meta workaround stays canonical at services/exchange.py:35-46; adapter does NOT re-patch (verified by inspect.getsource regex test)"
  - "CSV adapter wraps the actual csv_validator.validate_csv() envelope, not the granular parse_csv/validate_schema/df_to_trades helpers the plan blueprint imagined — those helpers do not exist (Rule 3 deviation, documented)"
  - "mypy --strict scoped via --follow-imports=silent so the strict gate is local to services/ingestion/; legacy untyped surface migrates incrementally"

patterns-established:
  - "IngestionAdapter contract: 3 async methods (validate, fetch_raw, reconstruct_positions) + 2 sync methods (compute_metrics, compute_fingerprint); router orchestrates the 5 in sequence"
  - "ValidationResult envelope: read_only=None for CSV (file-format N/A), populated bool for broker validation; error_code is the SoT discriminator (Phase 17 DESIGN-05); human_message is informational only"
  - "Adapter SOURCE class constant matches the canonical Source Literal — useful for routing inside P4"
  - "Fingerprint dataclass uses default_factory for the 10/24-element tuples (mutable defaults discipline)"

requirements-completed:
  - BACKBONE-01
  - BACKBONE-02

# Metrics
duration: 28min
completed: 2026-05-08
---

# Phase 19 Plan 03: IngestionAdapter Protocol + 4 concrete adapters Summary

**Shipped the typed protocol surface for Phase 19's unified backbone — `services/ingestion/` package with a `@runtime_checkable typing.Protocol` (5 methods) and 4 concrete adapters (OKX, Binance, Bybit, CSV) that wrap existing primitives without rewriting them.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-05-08T10:51:05Z
- **Completed:** 2026-05-08T11:19:29Z
- **Tasks:** 3/3 + 1 plan-level chore (MC-3 mypy fix)
- **Files created:** 9 (6 source, 2 test, 1 Makefile)
- **Files modified:** 1 (.github/workflows/ci.yml)
- **services/exchange.py touched:** 0 (REUSE flag honored — byte-identical to base)

## Accomplishments

- `IngestionAdapter` Protocol with 5 methods (`validate`, `fetch_raw`, `compute_metrics`, `compute_fingerprint`, `reconstruct_positions`) is importable from `services.ingestion`; passes runtime `isinstance` for all 4 concrete adapters.
- 8 shared dataclasses + 4 Literal type aliases co-located in `services/ingestion/adapter.py`; `Fingerprint.to_jsonb()` emits the locked 5-component shape (4/4/4/10/24 floats + `version: 1`) that migration-105 `compute_similarity()` will consume.
- 4 concrete adapters delegate to `services/exchange.py` (broker) and `services/csv_validator.py` (CSV) without modifying either; ccxt close-on-finally pattern preserved on every path.
- MC-3 fix wired: `mypy --strict --follow-imports=silent services/ingestion/` runs in CI before pytest. Catches signature drift that `@runtime_checkable` cannot. Local Makefile `lint` target mirrors CI.
- 14 tests pass (10 protocol-shape, 4 CSV behavior); existing `test_exchange.py` and `test_csv_validator.py` suites remain green.

## Task Commits

Each task was committed atomically following TDD RED→GREEN:

1. **Task 1 RED: Protocol shape tests** — `984b331` (test)
2. **Task 1 GREEN: IngestionAdapter Protocol + dataclasses + registry** — `0ba10ac` (feat)
3. **Task 2 RED: Broker adapter Protocol-conformance tests** — `0c583ad` (test)
4. **Task 2 GREEN: OkxAdapter / BinanceAdapter / BybitAdapter** — `44d3082` (feat)
5. **Task 3 RED: CSV adapter behavior tests** — `b083cf7` (test)
6. **Task 3 GREEN: CsvAdapter** — `4cc03f6` (feat)
7. **MC-3 fix: mypy --strict + Makefile + ci.yml** — `3711896` (chore)

## Files Created/Modified

### Created

- `analytics-service/services/ingestion/__init__.py` — Protocol declaration, `SUPPORTED_SOURCES` allowlist, `ADAPTERS` registry, `get_adapter()` lookup with lazy per-source instantiation.
- `analytics-service/services/ingestion/adapter.py` — 8 dataclasses + 4 Literal aliases. `Fingerprint.to_jsonb()` serializer.
- `analytics-service/services/ingestion/okx.py` — OkxAdapter; hosts the shared `_normalize_trade` helper imported by Binance/Bybit.
- `analytics-service/services/ingestion/binance.py` — BinanceAdapter; `fetch_raw` accepts `strategy_id` + `supabase` from the dict to satisfy `exchange._fetch_raw_trades_binance`'s 4-arg signature.
- `analytics-service/services/ingestion/bybit.py` — BybitAdapter; deliberately does NOT re-patch the currency-meta quirk (canonical fix at `exchange.py:35-46`).
- `analytics-service/services/ingestion/csv_adapter.py` — CsvAdapter; wraps `csv_validator.validate_csv()` envelope; v0 limitation (mark prices N/A → `reconstruct_positions` returns `[]`) documented in module docstring.
- `analytics-service/tests/test_ingestion_protocol.py` — 10 tests covering Protocol runtime-checkability, dataclass importability, Fingerprint shape, get_adapter behavior, broker conformance, Bybit no-re-patch invariant, Literal type contents.
- `analytics-service/tests/test_csv_adapter.py` — 4 async tests covering valid/invalid CSV validation, empty reconstruct_positions, Protocol conformance.
- `analytics-service/Makefile` — `install`, `lint`, `typecheck`, `test`, `ci` targets. `lint` invokes `mypy --strict --follow-imports=silent services/ingestion/`.

### Modified

- `.github/workflows/ci.yml` — added `mypy --strict --follow-imports=silent services/ingestion/` step in the `python` job before pytest; `mypy` added to inline pip install.

### Untouched (REUSE flag)

- `analytics-service/services/exchange.py` — verified byte-identical to base commit `e9439e5b`. `git diff --stat` returns empty.
- `analytics-service/services/csv_validator.py` — wrapped, not modified.
- `analytics-service/services/encryption.py` — referenced from VerificationResult shape, no changes.

## Decisions Made

- **Lazy per-source adapter lookup.** `get_adapter()` checks the source against the static `SUPPORTED_SOURCES` tuple first, then imports + instantiates only the requested adapter. Unknown-source rejection (e.g. `mt5`) never triggers a concrete adapter import. Cleaner than the plan blueprint's eager `_register_adapters()` because it avoids hard cross-module dependencies during package import.
- **Lazy P8/P9 imports inside method bodies.** Hard-importing `EquityCurveBuilder` (P8) or `compute_fingerprint_v1` (P9) at adapter module load would create a Wave-1 → Wave-2 cycle. Lazy method-body imports + `# type: ignore[attr-defined]` (P8) and `# type: ignore[import-not-found]` (P9) communicate "Wave 2 will provide this".
- **`cast()` over `# type: ignore[no-any-return]`.** mypy's `--strict` flags `Returning Any from function declared to return X` for the lazy-imported call sites. Wrapping the return value in `cast(X, ...)` documents the contract explicitly and survives when the imported modules become typed in Wave 2.
- **`mypy --strict --follow-imports=silent`.** Without `--follow-imports=silent`, mypy follows imports into the rest of analytics-service (which has 814 legacy untyped errors). Silent follow keeps strictness local to the new package.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] csv_validator.py public API differs from plan blueprint**
- **Found during:** Task 3 (CSV adapter implementation)
- **Issue:** Plan blueprint references `csv_validator.parse_csv`, `validate_schema`, `df_to_trades`, and `CsvValidationError` — none of which exist. The actual Phase 15 `csv_validator.py` exposes a single public entrypoint `validate_csv(raw_bytes, fmt) -> dict` returning the envelope `{ok, preview, errors, correlation_id}`.
- **Fix:** CsvAdapter wraps `validate_csv()` directly. The envelope's `ok` flag maps to `ValidationResult.valid`; the first `errors[i].rule` becomes `error_code` (uppercased); the full `errors` list flows into `debug_context.violations`. For `fetch_raw`, since `df_to_trades` does not exist, the adapter inlines `pd.read_csv` for the `fmt='trades'` path; `daily_returns` and `daily_nav` formats return `[]` (those formats route through a separate daily-PnL aggregation downstream that does not need Trade objects).
- **Files modified:** `analytics-service/services/ingestion/csv_adapter.py` (documented in module docstring under "DEVIATION FROM PLAN BLUEPRINT").
- **Verification:** All 4 CSV adapter tests pass; pandera schemas still run; all 6 CSV-02 rules still fire; Sharpe sentinel still applies.
- **Committed in:** `4cc03f6`.

**2. [Rule 3 — Blocking issue] `_fetch_raw_trades_binance` signature mismatch**
- **Found during:** Task 2 (Binance adapter implementation)
- **Issue:** Plan blueprint assumed all 3 broker fetchers had the signature `(ex, since_ms)`. Actual `services/exchange.py` `_fetch_raw_trades_binance` is `(exchange, strategy_id, supabase, since_ms)` because Binance's per-symbol `fetch_my_trades` requires the symbol set up-front; the existing fetcher reads it from the strategy's already-traded set in trades + position_snapshots tables.
- **Fix:** BinanceAdapter's `fetch_raw(creds_or_file)` extracts `strategy_id` and `supabase` from the dict (the P4 router will supply them alongside the raw credentials). Documented in module docstring.
- **Files modified:** `analytics-service/services/ingestion/binance.py` (module docstring).
- **Verification:** `BinanceAdapter()` passes `isinstance(adapter, IngestionAdapter)`; existing exchange tests untouched; exchange.py byte-identical.
- **Committed in:** `44d3082`.

**3. [Rule 3 — Test infrastructure] Manual `asyncio.get_event_loop()` fails on Python 3.14**
- **Found during:** Task 3 (CSV adapter test execution)
- **Issue:** Initial test draft used `asyncio.get_event_loop().run_until_complete(coro)` to drive the async adapter methods. Python 3.14 removed the implicit "create an event loop if one does not exist" behavior, so the call raises `RuntimeError: There is no current event loop`.
- **Fix:** Made the test functions `async def` and `await`-ed the adapter methods directly. `pytest.ini` already declares `asyncio_mode = auto`, so pytest-asyncio runs them without per-function decoration.
- **Files modified:** `analytics-service/tests/test_csv_adapter.py`.
- **Verification:** All 4 async tests pass.
- **Committed in:** `4cc03f6` (combined with Task 3 GREEN; same atomic unit).

**4. [Rule 3 — Test specificity] Bybit no-re-patch test triggered on docstring mention**
- **Found during:** Task 2 (Bybit adapter test execution)
- **Issue:** `test_bybit_adapter_does_not_repatch_fetchcurrencies` greps the bybit module source for the literal string `fetchCurrencies`, intending to catch a `exchange.has["fetchCurrencies"] = False` assignment. The initial docstring used the word `fetchCurrencies` to explain why we DON'T re-patch, which the regex flagged.
- **Fix:** Reworded the docstring to use "currency-meta call" instead of the literal API name. The plan's automated check (`! grep -q "fetchCurrencies" services/ingestion/bybit.py`) is the same overly-strict rule — keeping the source string-free of `fetchCurrencies` matches the plan's verbatim acceptance criterion.
- **Files modified:** `analytics-service/services/ingestion/bybit.py`.
- **Verification:** Test now passes; `! grep -q "fetchCurrencies" bybit.py` returns true.
- **Committed in:** `44d3082`.

## Auth Gates

None encountered. All adapters are pure Python; no broker auth was performed during execution (broker `validate_key_permissions` is mocked at the contract surface, not exercised live).

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `test_ingestion_protocol.py` | 10 | All pass |
| `test_csv_adapter.py` | 4 | All pass |
| `test_exchange.py` (regression) | 22 | All pass (no new failures) |
| `test_csv_validator.py` (regression) | 18 | All pass (no new failures) |
| `mypy --strict --follow-imports=silent services/ingestion/` | — | "Success: no issues found in 6 source files" |

Coverage is measurement-only per repo policy (CLAUDE.md). The new package adds 6 source files + 2 test files; CI's `--cov-fail-under=80` gate continues to apply against the overall services/ tree.

## Threat Flags

None. Phase 19 plan-19-03 threat register (T-19-11..T-19-15b) covers the adapter surface; this implementation does not introduce any new trust boundary, network endpoint, file-system access pattern, or schema change beyond what the threat model already enumerates.

## Self-Check

**Files claimed created — verified present:**
- `analytics-service/services/ingestion/__init__.py` — FOUND
- `analytics-service/services/ingestion/adapter.py` — FOUND
- `analytics-service/services/ingestion/okx.py` — FOUND
- `analytics-service/services/ingestion/binance.py` — FOUND
- `analytics-service/services/ingestion/bybit.py` — FOUND
- `analytics-service/services/ingestion/csv_adapter.py` — FOUND
- `analytics-service/tests/test_ingestion_protocol.py` — FOUND
- `analytics-service/tests/test_csv_adapter.py` — FOUND
- `analytics-service/Makefile` — FOUND

**Commits claimed — verified in `git log`:**
- `984b331` test(19-03): add failing tests for IngestionAdapter Protocol shape — FOUND
- `0ba10ac` feat(19-03): IngestionAdapter Protocol + shared dataclasses + ADAPTERS registry — FOUND
- `0c583ad` test(19-03): add failing tests for broker adapter Protocol conformance — FOUND
- `44d3082` feat(19-03): OKX/Binance/Bybit adapters wrapping services/exchange.py — FOUND
- `b083cf7` test(19-03): add failing tests for CsvAdapter behavior contract — FOUND
- `4cc03f6` feat(19-03): CsvAdapter wrapping services/csv_validator.py — FOUND
- `3711896` chore(19-03): wire mypy --strict on services/ingestion (MC-3 fix) — FOUND

**REUSE flag invariant:** `git diff e9439e5b..HEAD -- analytics-service/services/exchange.py` produces no output — exchange.py is byte-identical to the base commit.

## Self-Check: PASSED
