# Phase 34: Explicit unified annualization (252) - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Make `compute_all_metrics` annualize on an **explicit** `periods_per_year` basis (default 252)
resolved at the call site, instead of the basis being hidden/hardcoded (the 5 explicit `np.sqrt(252)`
/ `*252` sites + the quantstats 0.0.81 default of 252 inside `qs.stats.sharpe/sortino/volatility/cagr`).

All displayed/ranking metrics stay on the **unified 252 basis** — cross-strategy comparability is the
priority (per the deliberate convention documented in `test_mt5_golden_fixtures.py:21-31`). The phase
also eliminates the `equity_reconstruction`@365 vs `compute_all_metrics`@252 ×1.20 (≈√(365/252)=1.204)
scale-factor mismatch by converging `equity_reconstruction` DOWN to 252.

In scope: the `compute_all_metrics` signature + internal threading, every call site resolving 252,
`equity_reconstruction` Sharpe/vol convergence, golden-parity fixtures (unified 252 + a parametrized
365 proof variant), and refreshing the stale MT5 test documentation.

Out of scope: per-key dailies store / derive-job generalization (Phase 35), repointing Overview reads
(Phase 36), the composer toggle (Phase 37), composer chart parity (Phase 38). No UI changes.
</domain>

<decisions>
## Implementation Decisions

### Annualization target — UNIFIED 252 (user decision, 2026-06-24)
- **Keep 252 as the universal annualization basis** for every displayed/ranking metric. Do NOT switch
  crypto to 365. This overrides the ROADMAP's original "crypto 365 / TradFi 252" proposal — the user
  chose comparability over per-asset statistical divergence.
- `compute_all_metrics` gains `periods_per_year: int = 252` (default preserves current behavior).
  Thread it through ALL annualization sites: the explicit `np.sqrt(252)` / `*252` lines (TE ~812,
  info_ratio ~814, rolling Sharpe ~1212, rolling Sortino ~1294, rolling vol ~1335) AND pass
  `periods=periods_per_year` into the quantstats `cagr/volatility/sharpe/sortino` calls (~439-446).
- Basis resolved **at the call site**, not inside the function. Every current production caller passes
  (or defaults to) 252. The param exists so a future per-asset divergence is a one-line call-site
  change, never a function rewrite. (Latent asset-class plumbing — not exercised in production yet.)

### Unknown / null asset-class default → 252 (user decision)
- When a strategy's `discovery_categories.group` is null/unknown (e.g. CSV strategies without a
  category), the resolver defaults to **252** — the conservative choice that preserves today's
  published numbers. Only an explicit decision could move a caller off 252.

### ×1.20 mismatch fix → converge equity_reconstruction to 252 (user decision)
- `equity_reconstruction.EquityCurveBuilder.compute_sharpe` currently defaults `periods=365`
  (`equity_reconstruction.py:3042`, documented NEW-C01-15). Converge it onto the **252** basis so it
  matches `compute_all_metrics` — no residual scale factor between the paths. Prefer routing through
  the same resolved `periods_per_year` rather than maintaining a parallel hand-rolled Sharpe; remove
  any divergent 252-vs-365 callers. Verify no caller relies on the 365 default before flipping it.

### Daily-data density (Phase 35 forward-context) → dense ~365 (user decision)
- Crypto exchange-key dailies stay on the **dense ~365-row calendar** (weekends included — crypto
  trades 24/7). This is data *density*, independent of the 252 annualization multiplier. Annualizing
  dense-365 data at 252 is a deliberate conservative/comparable choice, made explicit by the param.

### MT5 documentation refresh
- `test_mt5_golden_fixtures.py:21-31` documents "252-for-all (UNCHANGED), no periods param". After
  this phase a `periods_per_year` param exists (still defaulting 252). Update that doc block to
  describe the explicit-param design so it isn't stale/misleading — do NOT change MT5's resolved basis
  (still 252).

### Claude's Discretion
- Exact resolver shape (helper fn vs inline mapping), where the call-site basis lookup lives, and
  whether `equity_reconstruction` delegates to `compute_all_metrics` or just shares the constant —
  decide during planning from the codebase. Keep the diff surgical (Rule 3).
</decisions>

<code_context>
## Existing Code Insights (from codebase scout, 2026-06-24)

### Reusable Assets / key files
- `analytics-service/services/metrics.py:333` — `compute_all_metrics(returns, benchmark_returns=None)`.
  Hardcoded 252 at lines ~812 (TE), ~814 (info_ratio), ~1212 (rolling Sharpe), ~1294 (rolling
  Sortino), ~1335 (rolling vol); implicit 252 via quantstats at ~439/441/446.
- `analytics-service/services/equity_reconstruction.py:3041-3088` — `compute_sharpe(periods=365)`
  (NEW-C01-15 comment explains the 365 default and the √(252/365)≈0.83 under-scale).
- `analytics-service/services/analytics_runner.py:1913-2049` — `run_csv_strategy_analytics`; calls
  `compute_all_metrics(returns, benchmark_rets)` at ~2027 with no periods arg.
- `analytics-service/services/analytics_runner.py:1584` — crypto trades-path compute_all_metrics call.
- `services/job_worker.py:1716-1847` — `run_derive_broker_dailies_job` (Phase 35 target; feeds CSV pipeline).

### Established patterns
- Asset-class categorization: `src/lib/constants.ts:211` `type DiscoveryGroup = "Digital Assets" | "TradFi"`;
  DB `strategies.category_id` → `discovery_categories.id` → `discovery_categories.group`. Categories at
  `constants.ts:212-223`. Allocator `api_keys.exchange IN ('binance','okx','bybit')` (all crypto).
- quantstats 0.0.81 — `qs.stats.sharpe/sortino/volatility/cagr` accept a `periods=` kwarg (currently
  unset → defaults 252).

### Golden / parity fixtures
- Python: `analytics-service/tests/fixtures/golden_252d_input.json` + `golden_252d_expected.json`;
  test `analytics-service/tests/test_metrics_parity.py`.
- TS: `src/__tests__/metrics-parity.test.ts` (schema gate + orthogonal oracle scalars, 1e-12 epsilon).
- MT5: `analytics-service/tests/fixtures/mt5/` + `test_mt5_golden_fixtures.py` (the doc block to refresh).
- Add a parametrized `periods_per_year=365` proof case (rescale ≈√(365/252)) alongside the unchanged
  252 golden — proves the param actually threads, without changing any production basis.

### Integration points
- No new constant/enum exists for periods-per-year. Introduce a single resolver/constant so the 252
  default and the param threading share one source of truth.
</code_context>

<specifics>
## Specific Ideas

- Verification must prove (a) default 252 output is byte-identical to today (golden unchanged), and
  (b) passing `periods_per_year=365` actually rescales (the proof fixture), so a silent
  regression in the threading fails CI — this is the real guard, not just "a param exists".
- `equity_reconstruction` flip from 365→252 is the highest-risk edit (it changes a currently-live
  number). Confirm via grep that no caller passes/relies on `periods=365` before converging.
</specifics>

<deferred>
## Deferred Ideas

- Per-asset-class divergent annualization (crypto 365) — explicitly rejected by the user for now; the
  `periods_per_year` param leaves the door open as a future call-site change if comparability is ever
  deprioritized.
- Repointing Overview/Scenario reads onto the unified path — Phases 36/37.
</deferred>
