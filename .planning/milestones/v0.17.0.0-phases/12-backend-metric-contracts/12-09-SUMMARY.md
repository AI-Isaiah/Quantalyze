---
phase: 12-backend-metric-contracts
plan: 09
subsystem: analytics-service+web
tags: [metrics-parity, golden-fixture, tdd, schema-gate, cross-runtime]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: "Plan 12-06 wired MetricsResult dataclass + B-01 path-b orchestrator (compute_all_metrics returns MetricsResult.metrics_json + MetricsResult.sibling_kinds), and analytics_runner now emits 12 sibling kinds (10 from compute_all_metrics + 2 from position-side: exposure_series + turnover_series). Plan 12-08 locked LazyMetricsPayload + StrategyAnalyticsSeriesKind types in src/lib/types.ts."
provides:
  - "analytics-service/tests/fixtures/regen_golden.py — deterministic 252-day fixture regenerator (np.random.seed(42))."
  - "analytics-service/tests/fixtures/golden_252d_input.parquet — strategy returns + benchmark series (binary fixture for Python-side reads)."
  - "analytics-service/tests/fixtures/golden_252d_input.json — full input bundle (returns, benchmark, fills, positions, trade_metrics_from_positions, positions_by_date, prices_by_date, nav_by_date) for cross-runtime read."
  - "analytics-service/tests/fixtures/golden_252d_expected.json — committed expected output: metrics_json + 12 sibling kinds (D-01) including exposure_series + turnover_series (H-A1) and weighted_risk_reward_ratio (H-F)."
  - "analytics-service/tests/test_metrics_parity.py — Python math gate; assertMetricParity routes through _scalar_close (12-sig-digit + 1e-12 epsilon fallback per M-Grok-2) and _series_close (1e-9 relative epsilon, +0==-0, NaN==NaN per H-C); fail-loud on missing/extra keys (D-12)."
  - "src/lib/metrics-parity-helper.ts — TS schema-gate helper exporting EXPECTED_SIBLING_KINDS (12 kinds), FROZEN_TRADE_METRICS_KEYS (D-16 frozen contract), assertMetricParity, assertTradeMixBucketCount."
  - "src/__tests__/metrics-parity.test.ts — TS schema gate (Reading A per RESEARCH.md §9.3); 5 vitest assertions including dynamic sibling-count threshold (keys.length === EXPECTED_SIBLING_KINDS.size)."
  - "analytics-service/tests/conftest.py — golden_252d_input + golden_252d_expected pytest fixtures."
affects: [12-10-deploy-script-and-ci-gate, 14a-strategy-page-eager-panels, 14b-strategy-page-lazy-panels-4-7]

# Tech tracking
tech-stack:
  added:
    - "pyarrow (Python parquet engine — installed local user-site for fixture generation; pin in analytics-service/requirements.txt deferred to Plan 12-10 deploy script)"
  patterns:
    - "Single-source deterministic fixture: regen_golden.py is the ONLY way to (re)generate the 3 fixture files; CI never re-runs the generator. Adding a new metric requires explicit fixture regen, which forces the contract drift to surface as a diff in PR review."
    - "Two-tier scalar comparator (Tier 1 = 12-sig-digit exact, Tier 2 = 1e-12 relative epsilon fallback) avoids false-fail on 1-ULP float-to-string-to-float drift across runtimes."
    - "Series comparator (_series_close) explicitly handles +0/-0 and NaN==NaN — never divides by zero, never produces NaN-from-NaN false positives. H-C from 12-REVIEWS.md."
    - "Schema gate / math gate split (Reading A): TS test asserts the typed contract conforms to the JSON shape; Python test runs the math and compares numerics. Single source of math (D-01) means the TS test never re-implements quantstats — it only enforces the type union + frozen-key whitelist."

key-files:
  created:
    - "analytics-service/tests/fixtures/regen_golden.py — 304 LoC deterministic generator."
    - "analytics-service/tests/fixtures/golden_252d_input.parquet — 9.1KB binary fixture."
    - "analytics-service/tests/fixtures/golden_252d_input.json — 220KB JSON companion (RESEARCH.md §9.2)."
    - "analytics-service/tests/fixtures/golden_252d_expected.json — 266KB committed expected metrics output."
    - "analytics-service/tests/test_metrics_parity.py — 285 LoC math gate (5 tests)."
    - "src/lib/metrics-parity-helper.ts — 138 LoC schema helper."
    - "src/__tests__/metrics-parity.test.ts — 76 LoC schema gate (5 tests)."
  modified:
    - "analytics-service/tests/conftest.py — appended golden_252d_input + golden_252d_expected pytest fixtures."

key-decisions:
  - "Honored TRADE_MIX_HAS_MAKER_TAKER=false from TODOS.md per the D-15 audit outcome — trades table is empty in production for binance/okx/bybit, so coverage cannot meet the ≥99% threshold; ship the 2-bucket fallback (long, short) and defer maker/taker to v0.17.1."
  - "Python parity test is the single math source (D-01); the TS test follows Reading A from RESEARCH.md §9.3 and asserts ONLY the JSON contract shape. Math drift is gated by Python; schema drift is gated by TS. This eliminates the cost of dual-runtime quantstats reproduction."
  - "Sibling-count threshold tracks EXPECTED_SIBLING_KINDS.size dynamically (Issue 6 fix) so the TS bar matches the Python invariant without hardcoding 12 in two places. Updating the typed union in src/lib/types.ts updates the test threshold automatically."
  - "Both regen_golden.py and test_metrics_parity.py read TRADE_MIX_HAS_MAKER_TAKER from the same env var so the parity contract stays consistent across regen and verification (M-01 / Plan 12-10 deploy-script propagation)."
  - "Pre-existing TS test fixture drift in MetricPanel.test.tsx + PositionsTab.test.tsx (frozen TradeMetrics expansion landed in Plan 12-02; those tests were never migrated) is logged to deferred-items.md — out of Plan 12-09 scope."

patterns-established:
  - "Pattern: deterministic-byte-stable golden-fixture regenerator. Every bytes of every output flows from np.random.seed + the runner's existing helpers; no float-precision drift is possible without a deliberate regen."
  - "Pattern: TS-side parity helper as a separate module (src/lib/metrics-parity-helper.ts) so Phase 14a/14b consumers can import EXPECTED_SIBLING_KINDS to validate runtime payloads without depending on the test file."
  - "Pattern: env-var propagation for fixture variants (TRADE_MIX_HAS_MAKER_TAKER). Plan 12-10's deploy script will read the same env var and write it to .env.test so CI sources it before running parity tests."

threat-coverage:
  - id: T-12-09-01
    disposition: mitigate
    mechanism: "Code-review of fixture diffs catches tampered expected.json. regen_golden.py is fully reproducible (seed=42, deterministic NumPy + pandas paths) so reviewers can re-run and diff. Fixture commits include rationale (this commit's body cites METRICS-13)."
  - id: T-12-09-02
    disposition: accept
    mechanism: "TS is schema gate by design (D-01). Math gate is Python-side test_metrics_parity.py; both must pass for CI green."
  - id: T-12-09-03
    disposition: accept
    mechanism: "Fixture is np.random.seed(42) synthetic; no PII, no production data."
  - id: T-12-09-04
    disposition: accept
    mechanism: "regen_golden.py runs in <5s on Python 3.14 + NumPy 2.x; only invoked manually on metric add, never in CI."
  - id: T-12-09-05
    disposition: mitigate
    mechanism: "Both runtimes read the same env var (TRADE_MIX_HAS_MAKER_TAKER) and Plan 12-10 deploy script enforces consistency between TODOS.md and the .env.test file CI sources."

# Metrics
metrics:
  duration_minutes: 8
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 1
  tests_added: 10
  tests_passing: 10
  completed_date: 2026-04-28
---

# Phase 12 Plan 09: Cross-Runtime Parity Test Pair Summary

**One-liner:** METRICS-13 lands — deterministic 252-day fixture (parquet + JSON companion + expected.json) + Python math gate + TS schema gate. Both runtimes fail-loud on any metric drift (missing keys, extra keys, value drift outside D-11 hybrid tolerance), with H-A1 exposure/turnover series simulated end-to-end and H-F weighted_risk_reward_ratio + H-D equity_series_1y exclusion enforced.

## What Shipped

### Task 1 — `fec9607`: regen_golden.py + 3 fixture files + conftest loaders

Deterministic 252-trading-day fixture generator at `analytics-service/tests/fixtures/regen_golden.py`. Seeded `np.random.seed(42)` so every byte of the output is reproducible across machines. Three fixture files committed:

- `golden_252d_input.parquet` (9.1KB) — strategy returns + BTC-like benchmark, parquet-encoded for Python-side reads.
- `golden_252d_input.json` (220KB) — full input bundle JSON companion per RESEARCH.md §9.2: returns, benchmark, 250 synthetic fills, 50 closed positions with B-01 path-b extensions (`avg_winning_trade`, `avg_losing_trade`, `winners_count`, `losers_count`, `realized_pnl_per_trade`), positions_by_date / prices_by_date / nav_by_date for H-A1 simulation.
- `golden_252d_expected.json` (266KB) — committed expected metrics output: `metrics_json` (19 keys including merged trade_metrics with weighted_risk_reward_ratio per H-F) + `sibling` (exactly 12 kinds per D-01: 6 rolling sortino/volatility + rolling_alpha + rolling_beta + daily_returns_grid + log_returns_series + exposure_series + turnover_series; `equity_series_1y` excluded per H-D since it lives in metrics_json above-the-fold).

The generator calls `compute_all_metrics()` to produce above-the-fold scalars + 10 sibling kinds, then layers the runner-side helpers (`_compute_volume_metrics` + `_compute_volume_aggregator` + `_compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions)` per B-01 path b + `_compute_trade_mix(fills, has_maker_taker)`) and stamps `exposure_series` (gross/net per simulated day) + `turnover_series` (via `compute_turnover_series` from positions × prices / NAV) into the sibling output. `TRADE_MIX_HAS_MAKER_TAKER=false` per TODOS.md → 2-bucket trade_mix (long, short).

`conftest.py` extended with `golden_252d_input` + `golden_252d_expected` pytest fixtures using existing FIXTURES_DIR convention.

### Task 2 — `bc5bd39`: Python parity test (math gate)

`analytics-service/tests/test_metrics_parity.py` (TDD RED→GREEN; 5/5 tests pass). The contract:

- **`assertMetricParity(actual, expected, prefix)`** — D-11 + D-12 enforcement. Recurses into nested dicts; routes lists to `_assert_series_equal`, scalars to `_assert_scalar_equal`. Missing keys in `actual` (relative to `expected`) and extras in `actual` (not in `expected`) BOTH fail-loud.
- **`_scalar_close(a, b)`** — M-Grok-2 two-tier comparator. Tier 1: exact equality after rounding to 12 significant digits. Tier 2: 1e-12 relative epsilon fallback for legitimate 1-ULP float-to-string-to-float drift across runtimes. NaN==NaN True; +0==-0 True (never divides by zero).
- **`_series_close(a, b, rel_eps=1e-9)`** — H-C-aware series comparator. NaN==NaN True; +0==-0 True; one-zero-one-nonzero falls through to absolute epsilon (never divides by zero); standard relative-epsilon comparison otherwise.
- **3 helper unit tests + 1 full parity test** = 5 tests, all green.

Helper unit tests assert: `_series_close(0.0, -0.0) == True`, `_series_close(NaN, NaN) == True`, `_series_close(NaN, 0.5) == False`, `_scalar_close(1.234567890123, 1.2345678901230001) == True` (epsilon fallback), `_scalar_close(1.0, 1.0001) == False` (drift > 1e-12).

The full-parity test mirrors `regen_golden.py` exactly: reads input parquet + JSON companion, runs `compute_all_metrics` + the runner-side helpers, populates `exposure_series` + `turnover_series` from simulated positions/prices/NAV, asserts vs the committed expected JSON.

### Task 3 — `181ee57`: TS parity test (schema gate per Reading A)

Two files:

- `src/lib/metrics-parity-helper.ts` — exports `EXPECTED_SIBLING_KINDS: ReadonlySet<StrategyAnalyticsSeriesKind>` (exactly 12 kinds, `equity_series_1y` excluded per H-D), `FROZEN_TRADE_METRICS_KEYS` array (D-16 frozen contract: 10 base + 6 derived + `weighted_risk_reward_ratio` per H-F + 5 reconstruct_positions extension keys + `trade_mix` + 6 volume keys + 4 aggregator keys = 33 frozen keys), `assertMetricParity` (sibling-kind whitelist + trade_metrics frozen-key whitelist), `assertTradeMixBucketCount` (D-15 audit branch: 4-bucket vs 2-bucket).
- `src/__tests__/metrics-parity.test.ts` — 5 vitest assertions: top-level shape, sibling-kind union conformance, trade_metrics frozen-key conformance, trade_mix bucket-count vs D-15, `keys.length === EXPECTED_SIBLING_KINDS.size` (Issue 6 fix — dynamic threshold tracks the typed union, no hardcoded 12).

Per RESEARCH.md §9.3, this is Reading A: schema gate, not math gate. The TS test does NOT re-implement quantstats — it asserts that the JSON contract (committed by Task 1's expected.json) conforms to the typed contract in `src/lib/types.ts`. Math drift is gated entirely by Task 2's Python test.

5/5 tests pass on `npx vitest run src/__tests__/metrics-parity.test.ts`.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Python parity | `cd analytics-service && TRADE_MIX_HAS_MAKER_TAKER=false python3 -m pytest tests/test_metrics_parity.py -x` | 5 passed in 1.65s |
| TS schema gate | `npx vitest run src/__tests__/metrics-parity.test.ts` | 5 passed in 640ms |
| H-A1 invariant | `len(data['sibling']) == 12` | exposure_series=252 pts, turnover_series=252 pts |
| H-D invariant | `equity_series_1y` not in `EXPECTED_SIBLING_KINDS` (TS) and not in expected.json sibling (Python) | Confirmed via inverted grep |
| H-F invariant | `weighted_risk_reward_ratio` in `metrics_json.trade_metrics` | Confirmed |
| D-12 fail-loud | Missing key in actual → AssertionError; extra key in actual → AssertionError | Confirmed in `assertMetricParity` |
| D-15 branch | TRADE_MIX_HAS_MAKER_TAKER=false → 2-bucket {long, short} | Confirmed; trade_mix.long, trade_mix.short present |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] pyarrow not pinned in requirements.txt — installed user-site to enable parquet generation**

- **Found during:** Task 1 — `regen_golden.py` first run failed with `ImportError: Unable to find a usable engine; tried using: 'pyarrow', 'fastparquet'`.
- **Issue:** `analytics-service/requirements.txt` does not pin `pyarrow` or `fastparquet`, so `pd.DataFrame.to_parquet(...)` failed at the first call.
- **Fix:** Installed pyarrow 24.0.0 to `--user --break-system-packages` site (PEP-668 override on Homebrew Python). The fixture generation now runs without modifying the project requirements.txt — pinning pyarrow there is deferred to Plan 12-10's deploy-script PR which will own the analytics-service Python dependency surface.
- **Files modified:** None (system-level install only). The plan's `regen_golden.py` is byte-identical to the planned content.
- **Commit:** N/A (no project file change).

### Out-of-scope (logged to deferred-items.md)

**Pre-existing TS test fixture drift** — `src/components/strategy/MetricPanel.test.tsx:118` references obsolete `total_trades` key, and `src/components/strategy/PositionsTab.test.tsx:31, 106` use trade_metrics fixtures missing the 7 derived fields (`expectancy`, `risk_reward_ratio`, `weighted_risk_reward_ratio`, `sqn`, `profit_factor_long`, `profit_factor_short`, `trade_mix?`) and 5 reconstruct-positions extension fields. These typecheck errors predate Plan 12-09 (Plan 12-02 expanded TradeMetrics; the two test files were never migrated). Logged to `.planning/phases/12-backend-metric-contracts/deferred-items.md` for v0.17.1 cleanup. Plan 12-09's own files typecheck clean.

## Authentication Gates

None — fully autonomous.

## Self-Check: PASSED

- Files exist:
  - `analytics-service/tests/fixtures/regen_golden.py` — FOUND
  - `analytics-service/tests/fixtures/golden_252d_input.parquet` — FOUND
  - `analytics-service/tests/fixtures/golden_252d_input.json` — FOUND
  - `analytics-service/tests/fixtures/golden_252d_expected.json` — FOUND
  - `analytics-service/tests/test_metrics_parity.py` — FOUND
  - `src/lib/metrics-parity-helper.ts` — FOUND
  - `src/__tests__/metrics-parity.test.ts` — FOUND
- Commits exist (`git log --oneline -5`):
  - `fec9607` test(12-09): add regen_golden + 3 fixture files + conftest loaders — FOUND
  - `bc5bd39` test(12-09): add Python parity assertion vs golden fixture — FOUND
  - `181ee57` test(12-09): add TS parity test (schema gate per Reading A) — FOUND
- Python pytest: 5/5 pass.
- TS vitest: 5/5 pass.
- Both runtimes fail-loud on missing/extra keys (D-12).
- 12-sibling-kind invariant honored on both sides (Python: `len == 12` static; TS: `keys.length === EXPECTED_SIBLING_KINDS.size` dynamic per Issue 6 fix).
