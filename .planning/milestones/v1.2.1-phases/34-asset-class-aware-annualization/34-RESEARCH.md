# Phase 34: Explicit unified annualization (252) - Research

**Researched:** 2026-06-24
**Domain:** Python analytics (quantstats annualization), money/correctness path, TS↔Py golden parity
**Confidence:** HIGH (every load-bearing claim verified against live code + an empirical quantstats probe)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Annualization target — UNIFIED 252 (user decision, 2026-06-24).** Keep 252 as the universal
  annualization basis for every displayed/ranking metric. Do NOT switch crypto to 365. This overrides
  the ROADMAP's original "crypto 365 / TradFi 252" proposal — comparability over per-asset divergence.
- `compute_all_metrics` gains `periods_per_year: int = 252` (default preserves current behavior),
  threaded through ALL annualization sites: the explicit `np.sqrt(252)` / `*252` lines AND the
  quantstats `cagr/volatility/sharpe/sortino` calls.
- Basis resolved **at the call site**, not inside the function. Every current production caller passes
  (or defaults to) 252. The param exists so a future per-asset divergence is a one-line call-site
  change. (Latent asset-class plumbing — not exercised in production yet.)
- **Unknown / null asset-class default → 252.** Conservative; preserves today's published numbers.
- **×1.20 mismatch fix → converge `equity_reconstruction` to 252.** `EquityCurveBuilder.compute_sharpe`
  defaults `periods=365` today (NEW-C01-15). Converge it onto 252 so it matches `compute_all_metrics`
  — no residual scale factor. Verify no caller relies on the 365 default before flipping it.
- **Daily-data density (Phase 35 forward-context) → dense ~365.** Crypto exchange-key dailies stay on
  the dense ~365-row calendar. Data *density*, independent of the 252 annualization multiplier.
- **MT5 documentation refresh.** Update `test_mt5_golden_fixtures.py:21-31` doc block to describe the
  explicit-param design (still defaulting 252). Do NOT change MT5's resolved basis (still 252).

### Claude's Discretion
- Exact resolver shape (helper fn vs inline mapping), where the call-site basis lookup lives, and
  whether `equity_reconstruction` delegates to `compute_all_metrics` or just shares the constant.
  Keep the diff surgical (Rule 3).

### Deferred Ideas (OUT OF SCOPE)
- Per-asset-class divergent annualization (crypto 365) — explicitly rejected for now; the param leaves
  the door open as a future call-site change.
- Repointing Overview/Scenario reads onto the unified path — Phases 36/37.
- Per-key dailies store / derive-job generalization — Phase 35.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANNUAL-01 | `compute_all_metrics` accepts `periods_per_year` (default 252), threaded through every annualization site. | §"Annualization Site Inventory" — 9 sites enumerated (5 explicit + 4 qs.stats + greeks alpha + rolling helpers). All thread one new param. |
| ANNUAL-02 | Basis resolved at the call site; every current production caller resolves 252. | §"Production Caller Graph" — EXACTLY 2 callers (`analytics_runner.py:1584`, `:2027`). Both inherit the 252 default → unchanged. Minimal: default-only, no resolver needed now. |
| ANNUAL-03 | All displayed/ranking metrics stay on unified 252. | Default 252 + golden-unchanged invariant proves it. MT5 doc block (§6) re-states the convention. |
| ANNUAL-04 | Golden fixtures pin unified 252 (unchanged) AND a parametrized 365 proof case (≈√(365/252)). | §"Golden Fixture Mechanics" — exact rescale ratios verified empirically: sharpe/sortino/vol ×1.20350; **CAGR is nonlinear** — `(1+cagr₂₅₂)^(365/252)-1`. |
| ANNUAL-05 | `equity_reconstruction`@365 → 252; two paths agree, no residual scale. | §"equity_reconstruction Convergence" — 1 production caller (`compute_sharpe` method @ `equity_reconstruction.py:3041`), no caller passes `periods=365`. Flip default 365→252; update 2 tests + 4 golden `expected_sharpe` literals + 1 docstring. |
</phase_requirements>

## Summary

This is a surgical, well-bounded Python plumbing change on a money/correctness path. There are **no new
dependencies**, no migrations, no UI. The work is: (1) add `periods_per_year: int = 252` to
`compute_all_metrics` and thread it through **9 annualization sites** (not the 5 the scout listed — the
quantstats `greeks()` alpha annualization and three rolling helpers also bake in 252); (2) leave both
production callers untouched (they inherit the 252 default — the param is latent plumbing); (3) converge
`EquityCurveBuilder.compute_sharpe` from its `periods=365` default down to 252 (a **live displayed
number** changes — the verification-card Sharpe); (4) add a parametrized 365-proof assertion proving the
param actually rescales; (5) refresh the MT5 doc block.

**The two things that will catch you out:** (a) **CAGR does not rescale by √(365/252)** like the other
three — it rescales geometrically as `(1+cagr₂₅₂)^(365/252)-1` because quantstats computes
`years = len(returns)/periods` (verified empirically below); a 365-proof case that asserts ×1.2035 on
CAGR will fail. (b) Converging `compute_sharpe` to 252 **changes 4 hand-maintained golden `expected_sharpe`
literals** (×√(252/365)≈0.8312) plus a `periods=365` quantstats cross-check and a `365**0.5` literal in
two test files — these are not regenerated by any script.

**Primary recommendation:** Add the param with a default of 252, thread it through all 9 sites
(introduce one module-level `DEFAULT_PERIODS_PER_YEAR = 252` constant as the single source of truth),
**do not build an asset-class resolver** (ANNUAL-02 is satisfied by the default since every caller
resolves 252), and converge `equity_reconstruction` by giving `compute_sharpe` a `periods=252` default
that shares the same constant. Prove threading with an in-test parametrized 365 case (no new fixture
file) using the empirically-verified rescale formulas.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Metric annualization basis | API / Backend (Python analytics-service) | — | `compute_all_metrics` is the sole product-wide KPI engine; annualization is pure math owned by the analytics tier. |
| Equity-curve Sharpe (verify/process-key) | API / Backend (`equity_reconstruction`) | — | Adapter compute path; feeds the persisted `metrics_snapshot` JSONB read by the landing verification card. |
| Asset-class → basis resolution | API / Backend (call site) | DB (`discovery_categories.group`) | Per the unified-252 decision the resolver is *latent*; the mapping exists in DB but no production caller diverges from 252. |
| Golden-parity contract | CI (pytest + vitest) | — | Cross-runtime TS↔Py contract; the byte-stable oracle that makes a silent math regression fail loudly. |

## Standard Stack

No new packages. This phase modifies existing code only.

### Core (already pinned, verified)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| quantstats | 0.0.81 | Annualized Sharpe/Sortino/Volatility/CAGR scalars | Product-wide KPI engine since Phase 12 [VERIFIED: installed `quantstats.version=="0.0.81"`; PyPI release 2026-01-13, not yanked]. |
| numpy / pandas | (pinned in requirements.txt) | `np.sqrt(252)` explicit-annualization sites + rolling windows | Already the math substrate of `metrics.py`. |

**Installation:** None. `pip install` is a no-op for this phase.

**Version verification:** [VERIFIED: `python3 -c "import quantstats; print(quantstats.__version__)"` → `0.0.81`]
matches the `requirements.txt:210` pin `quantstats==0.0.81` and `requirements-dev.txt:16`.
[CITED: pypi.org/pypi/quantstats/0.0.81/json — released 2026-01-13, `yanked: false`].

> **Runtime caveat (MEDIUM):** the quantstats source inspected lives in homebrew **python 3.14**
> (`/opt/homebrew/lib/python3.14/site-packages/quantstats`); CI/prod run **python 3.12** with the same
> `0.0.81` pin. A pinned version yields identical source across interpreters, and the empirical probe
> (run on 3.14) matches the documented quantstats math, so the `periods=` behavior is the same. If the
> planner wants belt-and-suspenders, re-run the probe under a CI-pinned `uv venv --python 3.12 +
> requirements.txt` (per the B-mypy-local-venv-drift memory note) — but no behavior is expected to change.

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages**. All work modifies existing pinned code.
> `quantstats==0.0.81` is already in `requirements.txt` and was not introduced here; its PyPI legitimacy
> is confirmed (released 2026-01-13, not yanked, ≥3.10).

## Architecture Patterns

### Data flow (annualization threading)

```
                    periods_per_year: int = 252   (default; latent plumbing)
                              │
  analytics_runner.py:1584 ──┤ (crypto trades path)
  analytics_runner.py:2027 ──┤ (CSV / MT5 path)        ← both inherit default, UNCHANGED
                              ▼
                   compute_all_metrics(returns, benchmark, periods_per_year=252)
                              │
        ┌──────────────┬──────┴───────┬───────────────┬─────────────────┐
        ▼              ▼              ▼               ▼                 ▼
  qs.stats.cagr   qs.stats.vol   qs.stats.sharpe  qs.stats.sortino   np.sqrt(252) sites:
  (periods=ppy)   (periods=ppy)  (periods=ppy)    (periods=ppy)      • TE  ~812
   ~439            ~440           ~441             ~446               • info_ratio ~814
                                                                      • rolling sharpe ~1212
   qs.stats.greeks(... periods=ppy)  ← alpha *= periods (site the scout missed, ~807)
   qs.stats.rolling_greeks(...)       ← rolling_alpha (~1368)        • rolling sortino ~1294
                                                                      • rolling vol ~1335

  ─────────────────────────────────────────────────────────────────────────────
  SEPARATE PATH (converge to 252):
  ingestion adapters (binance/bybit/okx/csv) → EquityCurveBuilder.to_metrics_snapshot()
        → compute_sharpe(periods=365)  ← FLIP default to 252  (equity_reconstruction.py:3041)
        → persisted as metrics_snapshot.sharpe → landing verification card (LIVE displayed number)
```

### Pattern 1: Single-source annualization constant
**What:** Introduce one module-level `DEFAULT_PERIODS_PER_YEAR = 252` in `metrics.py` and use it as the
default for both `compute_all_metrics(periods_per_year=...)` and (shared) the converged
`compute_sharpe`. `optimizer.py` already does this (`TRADING_DAYS = 252`, line 43).
**When to use:** Always — the CONTEXT integration note explicitly asks for "a single resolver/constant so
the 252 default and the param threading share one source of truth."
**Example:**
```python
# Source: services/optimizer.py:43 (existing precedent in this codebase)
TRADING_DAYS = 252
```

### Pattern 2: Thread the factor, keep the window separate (rolling helpers)
**What:** The rolling helpers (`_rolling_sharpe`, `_rolling_sortino_from_components`,
`_rolling_volatility`) take a `window: int` (63/126/252 — **window length**, NOT annualization) and
**separately** multiply by `np.sqrt(252)` (the **annualization factor**). These two 252s are independent.
Thread a NEW `periods_per_year` parameter into each helper; do NOT touch the `window` args.
**When to use:** For all three rolling helpers. The `*np.sqrt(252)` → `*np.sqrt(periods_per_year)`.
**Warning:** Do not confuse `window=252` (the 12-month rolling window in
`rolling_sortino_12m`/`rolling_volatility_12m`) with the annualization `sqrt(252)`. Only the latter changes.

### Anti-Patterns to Avoid
- **Asserting CAGR rescales by √(365/252).** It does NOT — CAGR is geometric on `years=len/periods`. See
  the empirical proof below. A 365-proof case that uses the √ ratio for CAGR will fail CI.
- **Building an asset-class resolver now.** ANNUAL-02 is satisfied by the `=252` default because both
  production callers resolve 252. A resolver that maps `discovery_categories.group → 252-for-all` is
  dead code that resolves to a constant (gold-plating; violates Rule 2). Recommend deferring the
  resolver to whenever a caller actually needs to diverge.
- **Regenerating `golden_252d_expected.json`.** The default-252 output is byte-identical to today; the
  regen script `regen_golden.py` refuses without `--i-am-fixing-a-real-bug` for exactly this reason. The
  252 golden MUST stay untouched — that IS the ANNUAL-04 "golden unchanged" proof.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Annualizing Sharpe/Sortino/Vol/CAGR | A custom annualization wrapper | `qs.stats.*(returns, periods=periods_per_year)` | quantstats already accepts `periods=` on all four; passing it is the entire change. |
| Asset-class → basis lookup | A new resolver helper resolving 252-for-all | The `=252` default | Every prod caller resolves 252; a resolver is a constant function. Defer until a caller diverges. |
| 365-proof fixture | A whole new `golden_365d_*.json` file pair | In-test `@pytest.mark.parametrize` recompute of the SAME 252 input at `periods_per_year=365` | Cleaner, no fixture drift, asserts the rescale relationship directly. |

**Key insight:** The hardest part of this phase is not the threading (mechanical) — it's knowing the
**exact rescale relationships** so the proof assertion is correct, and finding **every** annualization
site (the scout missed `greeks()` alpha and the rolling helpers).

## Annualization Site Inventory (verified line numbers — file is 1499 lines)

> The CONTEXT scout cited ~439-446, ~812, ~814, ~1212, ~1294, ~1335. Verified line numbers below differ
> slightly and add **3 sites the scout missed** (greeks alpha + rolling_greeks). Every site threads
> `periods_per_year`.

| # | Site | File:Line | Form today | Change |
|---|------|-----------|-----------|--------|
| 1 | scalar CAGR | metrics.py:439 | `qs.stats.cagr(returns)` | `qs.stats.cagr(returns, periods=periods_per_year)` |
| 2 | scalar volatility | metrics.py:440 | `qs.stats.volatility(returns)` | `... periods=periods_per_year` |
| 3 | scalar sharpe | metrics.py:441 | `qs.stats.sharpe(returns)` | `... periods=periods_per_year` |
| 4 | scalar sortino | metrics.py:446 | `qs.stats.sortino(returns, rf=MAR)` | `... rf=MAR, periods=periods_per_year` |
| 5 | **scalar greeks (alpha)** ⚠️scout-missed | metrics.py:807 | `qs.stats.greeks(aligned_returns, aligned_benchmark)` | `... periods=periods_per_year` — greeks annualizes **alpha** via `alpha *= periods` (default 252.0). |
| 6 | tracking error | metrics.py:812 | `excess.std() * np.sqrt(252)` | `... * np.sqrt(periods_per_year)` |
| 7 | info_ratio | metrics.py:814 | `excess.mean() * 252 / te` | `excess.mean() * periods_per_year / te` |
| 8 | **rolling_greeks (rolling_alpha)** ⚠️scout-missed | metrics.py:1368 (`_rolling_alpha_beta`) | `qs.stats.rolling_greeks(aligned_returns, aligned_benchmark, window)` | `rolling_greeks` annualizes alpha via `periods=252`; thread `periods=periods_per_year` (positional/kw — verify sig). |
| 9a | rolling sharpe | metrics.py:1212 (`_rolling_sharpe`) | `ratio_series * np.sqrt(252)` | thread `periods_per_year` param into helper; `* np.sqrt(periods_per_year)` |
| 9b | rolling sortino | metrics.py:1294 (`_rolling_sortino_from_components`) | `ratio_series * np.sqrt(252)` | thread param; `* np.sqrt(periods_per_year)` |
| 9c | rolling volatility | metrics.py:1335 (`_rolling_volatility`) | `returns.rolling(window).std() * np.sqrt(252)` | thread param; `* np.sqrt(periods_per_year)` |

**Treynor (metrics.py:817):** `cagr / beta`. CAGR is already annualized at site #1, so once #1 threads the
param, treynor follows automatically. No separate edit.

**Plumbing note for rolling helpers:** sites 9a/9b/9c are in standalone module-level helper functions
called from inside `compute_all_metrics` (lines 472-474, 921-926). Each helper signature must gain a
`periods_per_year` parameter so the value flows down from the public function. `_rolling_sortino` (the
thin wrapper at ~1318) delegates to `_rolling_sortino_from_components` and must forward the param too.
There are also `_rolling_alpha`/`_rolling_beta` thin wrappers (~1392/1406) retained for test back-compat
that call `_rolling_alpha_beta` — forward the param there as well or leave their default 252.

## Production Caller Graph

### `compute_all_metrics` — EXACTLY 2 production callers
[VERIFIED: `grep -rn "compute_all_metrics(" services/ routers/`]
- `services/analytics_runner.py:1584` — crypto trades path. `compute_all_metrics(returns, benchmark_rets)`.
- `services/analytics_runner.py:2027` — CSV / MT5 path (`run_csv_strategy_analytics`). Same shape.
- **Neither passes a periods arg today.** Under unified-252 both inherit the `=252` default → **no
  call-site edit required**. This is the entire reason ANNUAL-02 needs no resolver.
- Test/tooling callers (do not change behavior, default 252): `test_metrics_parity.py:794`,
  `test_metrics.py` (many), `regen_golden.py:485`, `test_mt5_golden_fixtures.py` (via `_series_from_envelope`).

### `EquityCurveBuilder.compute_sharpe` (the 365 method) — convergence target
[VERIFIED: `grep -rn "\.compute_sharpe(" --include="*.py"`]
- Definition: `services/equity_reconstruction.py:3041` — `def compute_sharpe(self, risk_free_rate=0.0, periods: int = 365)`.
- **Production caller: EXACTLY ONE** — `self.compute_sharpe()` at `equity_reconstruction.py:3121` inside
  `to_metrics_snapshot()`, called with **no explicit periods arg** (relies on the 365 default).
- Test callers: `test_equity_curve_builder.py:125`, `test_ana_recon_audit.py:1025` — both call
  `builder.compute_sharpe()` with no arg.
- **No caller anywhere passes `periods=365` explicitly** → flipping the default 365→252 is safe;
  nothing must be changed at a call site. [VERIFIED: `grep -rn "periods=365" --include="*.py"` returns
  only the def docstring + the 2 test files' cross-check literals, never a `compute_sharpe(...periods=365)` call.]

**Blast radius of the flip (a LIVE number changes):** `to_metrics_snapshot()` is called by the 4 ingestion
adapters — `services/ingestion/{binance,bybit,okx,csv_adapter}.py` — during `compute_metrics()` in the
verify/process-key flow (`routers/process_key.py:859`). The resulting `MetricsSnapshot.sharpe` is
serialized via `metrics_to_jsonb` into the persisted `metrics_snapshot` JSONB and rendered on the
landing-page verification card (`VerificationSection.tsx`). **Converging to 252 lowers this Sharpe by
×√(252/365) ≈ 0.8312.** This is the single user-visible behavior change in the phase — call it out
loudly in the plan and in the commit (this is the documented ×1.20 fix, not a regression).

> **`portfolio_optimizer._compute_sharpe` is a DIFFERENT, unrelated function.** A repo-wide `compute_sharpe`
> grep also surfaces `services/portfolio_optimizer.py:250 _compute_sharpe(returns, rf=0)` (used by
> bridge/match/simulator scoring). It **already annualizes ×√252** and is NOT the convergence target —
> do not touch it. The two share a name fragment only.

### Smallest-surface convergence (Claude's discretion → recommendation)
`compute_sharpe` is a hand-rolled ~3-line annualization (`equity_reconstruction.py:3084-3088`:
`excess = returns - rf/periods; std = excess.std(); return (excess.mean()/std) * periods**0.5`). It is NOT
a quantstats call. The smallest-surface fix is simply **flip the default `periods: int = 365` → `252`**
(optionally referencing the shared `DEFAULT_PERIODS_PER_YEAR` constant). Do NOT attempt to delegate it to
`compute_all_metrics` — that function takes a `pd.Series` of returns and returns a `MetricsResult`
dataclass over a different (NAV-derived, day-0/terminal-bar-adjusted) return series; rerouting would drag
in the C01-06/C01-14 bar-dropping logic and is a much larger surface than the decision wants (Rule 3).
Sharing the **constant** satisfies "two paths agree at 252 with no residual scale factor."

## Runtime State Inventory

> This is a refactor/convergence phase. There is **no stored or registered runtime state** keyed on the
> annualization basis — the basis is a pure-math multiplier applied at compute time, not persisted as a key.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.metrics_json` (sharpe/vol/cagr/sortino…) and `metrics_snapshot` JSONB carry annualized VALUES computed at the old basis. The `compute_all_metrics` values are already 252 (no change). The `metrics_snapshot.sharpe` values from `equity_reconstruction` were computed at **365** and will not auto-update for existing rows. | **No backfill in scope.** New verifications recompute at 252. Existing landing-card Sharpe values stay at their stored 365 number until re-verified. Note this in the plan; do NOT add a migration (out of scope; the CONTEXT lists no data migration). |
| Live service config | None — annualization is code, not config. | None. |
| OS-registered state | None. | None — verified by category review (no scheduler/registry references the basis). |
| Secrets/env vars | None. There is no kill-switch env for annualization (unlike `BROKER_DAILIES_VIA_FUNDING`). | None. The default-252 + golden-unchanged invariant is the safety net; no flag needed. |
| Build artifacts | None — pure Python source change, no compiled artifact carries the constant. | None. |

**Nothing found in OS-registered / secrets / build-artifact categories — verified by code review.** The
only "stored state" consideration is that historical `metrics_snapshot.sharpe` rows hold 365-basis values;
the user decision and CONTEXT do not request a backfill, so leave them.

## Common Pitfalls

### Pitfall 1: CAGR does not rescale by √(365/252)
**What goes wrong:** A 365-proof assertion written as `assert cagr_365 ≈ cagr_252 * 1.2035` fails.
**Why it happens:** quantstats `cagr` (stats.py:1507) computes `years = len(returns) / periods`, then
`(1+total)^(1/years) - 1`. Changing `periods` changes the *exponent*, not a linear scale. Verified:
for the same input, `cagr_365 = (1 + cagr_252)^(365/252) - 1` **exactly** (match < 1e-12).
**How to avoid:** Use the geometric relationship for the CAGR proof; use `√(365/252)` only for
sharpe/sortino/volatility (and ×(365/252) linear for info_ratio / tracking-error-driven quantities).
**Warning signs:** A proof test green on sharpe/vol but red on CAGR — that's the √ vs geometric mismatch.

### Pitfall 2: Forgetting the greeks() / rolling_greeks() alpha sites
**What goes wrong:** Alpha (scalar at metrics.py:807, rolling at :1368) stays annualized at 252 while
everything else threads the param — so a `periods_per_year=365` proof shows alpha unchanged, a silent
threading hole.
**Why it happens:** `greeks(returns, benchmark, periods=252.0)` annualizes alpha via `alpha *= periods`
INTERNALLY (stats.py:2676). It's not an obvious `np.sqrt` site.
**How to avoid:** Pass `periods=periods_per_year` to both `qs.stats.greeks` (:807) and
`qs.stats.rolling_greeks` (:1368). Add `alpha` to the 365-proof assertions.

### Pitfall 3: The 4 equity-curve golden `expected_sharpe` literals are hand-maintained
**What goes wrong:** Flipping `compute_sharpe` 365→252 turns `test_equity_curve_builder.py::test_sharpe_within_tolerance`
red because the golden `expected_sharpe` values were computed at 365.
**Why it happens:** These 4 fixtures (`tests/fixtures/equity-curve-golden/*.json`) are NOT produced by
`regen_golden.py` (which only regenerates `golden_252d_*`). They carry literal `expected_sharpe`:
| Fixture | expected_sharpe @365 (current) | ×√(252/365) → @252 (new ≈) |
|---------|-------------------------------|----------------------------|
| binance-spot-only.json | 3.0719603935764024 | ≈ 2.5535 |
| bybit-perp-with-funding.json | 5.088077470517692 | ≈ 4.2293 |
| csv-spot-only.json | 2.55693759 | ≈ 2.1254 |
| okx-multi-month-perps.json | 0.8337293172341194 | ≈ 0.6930 |
**How to avoid:** Recompute each at 252 (×√(252/365) is the right ratio for this hand-rolled formula,
which is `(mean/std)*sqrt(periods)` — pure √ scaling, unlike quantstats CAGR). Also update the
`qs.stats.sharpe(df["daily_return"], periods=365)` cross-check at `test_equity_curve_builder.py:160`
→ `periods=252`, and the `365 ** 0.5` literal at `test_ana_recon_audit.py:1037` → `252 ** 0.5` (the
latter assertion only checks the two *differ*, so it's convention-agnostic, but update for consistency).
The ±0.10 tolerance comments referencing C01-15 should be refreshed.
**Warning signs:** 4 failing assertions in `test_equity_curve_builder.py` after the flip — that's expected
work, not a bug; regenerate the literals.

### Pitfall 4: Updating the wrong 252 in rolling helpers
**What goes wrong:** Threading the param into the `window=252` arg (the 12-month rolling window) instead
of the `np.sqrt(252)` annualization factor — breaks the rolling-window length.
**How to avoid:** Only `* np.sqrt(252)` → `* np.sqrt(periods_per_year)`. The `63/126/252` window args
passed from `compute_all_metrics` (lines 921-926) stay literal.

## Code Examples

### The qs.stats periods= kwarg (verified signatures, quantstats 0.0.81)
```python
# Source: /opt/homebrew/lib/python3.14/site-packages/quantstats/stats.py (v0.0.81)
def volatility(returns, periods: int = 252, annualize=True, prepare_returns=True): ...
def sharpe(returns, rf=0.0, periods: int = 252, annualize=True, smart=False): ...
def sortino(returns, rf=0, periods: int = 252, annualize=True, smart=False): ...
def cagr(returns, rf=0.0, compounded=True, periods: int = 252): ...   # years = len(returns)/periods
def greeks(returns, benchmark, periods=252.0, prepare_returns=True): ...   # alpha *= periods
```
**All four take `periods=` and default to 252.** [VERIFIED: source inspection + empirical probe below.]

### Empirical proof — periods=252 == default; the exact rescale ratios
```python
# Run this session against quantstats 0.0.81. Seed 42, 252-bday series.
# sharpe   default=0.758838  explicit252==default? True   365/252_ratio = 1.20350  ( == sqrt(365/252) )
# sortino  default=1.149822  explicit252==default? True   365/252_ratio = 1.20350
# volatility default=0.153541 explicit252==default? True  365/252_ratio = 1.20350
# cagr     default=0.110462  explicit252==default? True   365/252_ratio = 1.48359  (NONLINEAR — not the √)
#
# sqrt(365/252) = 1.2035001862952488   365/252 = 1.4484126984126984
# CAGR exact:  cagr_365 == (1 + cagr_252) ** (365/252) - 1     (match < 1e-12, verified)
```
[VERIFIED: probe executed this session]. This is the load-bearing fact for the ANNUAL-04 proof case.

### Recommended in-test 365-proof (no new fixture file)
```python
# Source: pattern for test_metrics_parity.py — reuse golden_252d_input
def test_periods_param_rescales_365(golden_252d_input):
    """ANNUAL-04 proof: passing periods_per_year=365 rescales output by the
    KNOWN annualization relationship — so a silent threading regression fails."""
    r = golden_252d_input["returns"]
    b = golden_252d_input["benchmark"]
    base = compute_all_metrics(r, b)                       # 252 default
    p365 = compute_all_metrics(r, b, periods_per_year=365) # threaded
    sqrt_ratio = (365 / 252) ** 0.5                        # 1.2035…
    for k in ("sharpe", "sortino", "volatility"):
        assert p365.metrics_json[k] == pytest.approx(base.metrics_json[k] * sqrt_ratio, rel=1e-9)
    # CAGR is geometric, NOT √-scaled:
    assert p365.metrics_json["cagr"] == pytest.approx(
        (1 + base.metrics_json["cagr"]) ** (365 / 252) - 1, rel=1e-9)
    # info_ratio scales linearly (×365/252) when both present; alpha too (greeks alpha *= periods).
```
The existing `test_metrics_parity_full` (calling `compute_all_metrics(...)` with no periods arg) **stays
unchanged** and IS the "golden byte-identical at 252" half of the proof.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 252 hardcoded inside `compute_all_metrics` (5 explicit + qs defaults) | Explicit `periods_per_year: int = 252` threaded through all sites | This phase | Basis is visible at the call site; future divergence is a 1-line change. |
| `equity_reconstruction.compute_sharpe(periods=365)` vs metrics@252 → ×1.20 mismatch | `compute_sharpe(periods=252)` — both paths agree | This phase (ANNUAL-05) | Landing-card Sharpe drops ×0.8312; no residual scale factor. |

**Deprecated/outdated:**
- NEW-C01-15 (the 252→365 change in `compute_sharpe`, `equity_reconstruction.py:3041` docstring +
  `:2742` class docstring) is being **reversed** by this phase. Update both docstrings to say "252,
  unified with `compute_all_metrics` (Phase 34)" and drop the "√(252/365)≈0.83 under-scale" rationale.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (Python, analytics-service) + vitest (TS, `src/__tests__/`) |
| Config file | `analytics-service/pyproject.toml` (`[tool.mypy] strict=true`); `vitest.config.ts` |
| Quick run command | `cd analytics-service && pytest tests/test_metrics_parity.py tests/test_equity_curve_builder.py -x` |
| Full suite command | `cd analytics-service && pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANNUAL-01 | param exists + threads all 9 sites | unit | `pytest tests/test_metrics_parity.py -x` | ✅ (extend) |
| ANNUAL-03/04a | **default 252 byte-identical to today** (golden unchanged) | parity | `pytest tests/test_metrics_parity.py::test_metrics_parity_full -x` | ✅ unchanged |
| ANNUAL-04b | **periods_per_year=365 rescales** (√ for sharpe/sortino/vol; geometric for CAGR; linear for IR/alpha) | unit | `pytest tests/test_metrics_parity.py::test_periods_param_rescales_365 -x` | ❌ Wave 0 |
| ANNUAL-04a (TS) | TS independent oracle still green at 252 (`TRADING_DAYS=252`) | parity | `npx vitest run src/__tests__/metrics-parity.test.ts` | ✅ unchanged |
| ANNUAL-05 | `equity_reconstruction` converged to 252; **no residual scale** | unit | `pytest tests/test_equity_curve_builder.py::test_sharpe_within_tolerance -x` | ✅ (update goldens) |
| ANNUAL-05 | MT5 path still 252 (resolved basis unchanged) | golden | `pytest tests/test_mt5_golden_fixtures.py -x` | ✅ unchanged (doc-only refresh) |

### Sampling Rate
- **Per task commit:** `pytest tests/test_metrics_parity.py tests/test_equity_curve_builder.py tests/test_mt5_golden_fixtures.py -x` (the 3 affected suites).
- **Per wave merge:** full `pytest --cov … --cov-fail-under=80` + `mypy --strict … services/ routers/ models/` + `npx vitest run src/__tests__/metrics-parity.test.ts`.
- **Phase gate:** full suite green before `/gsd:verify-work`.

### The four proofs this phase must demonstrate (the real guard, not "a param exists")
1. **default-252-unchanged** — `test_metrics_parity_full` + `regen_golden.py`'s untouched
   `golden_252d_expected.json` (byte-stable; regen refuses without `--i-am-fixing-a-real-bug`).
2. **param-rescales-365** — new `test_periods_param_rescales_365` with the empirically-verified ratios
   (√ for sharpe/sortino/vol, geometric for CAGR, linear for info_ratio/alpha).
3. **equity_reconstruction-converged** — updated `test_equity_curve_builder.py` goldens at 252 + the
   `periods=252` quantstats cross-check, proving the builder matches `qs.stats.sharpe(..., periods=252)`.
4. **no-residual-scale-factor** — an assertion (recommend a new small test) that a builder Sharpe and the
   `compute_all_metrics` Sharpe on the SAME daily-return series now agree at 252 within tolerance (was
   ×1.204 apart). This is the direct ANNUAL-05 contract.

### Wave 0 Gaps
- [ ] `tests/test_metrics_parity.py::test_periods_param_rescales_365` — new proof case (ANNUAL-04b).
- [ ] Recompute 4 × `expected_sharpe` literals in `tests/fixtures/equity-curve-golden/*.json` (×√(252/365)).
- [ ] `tests/test_equity_curve_builder.py:160` cross-check `periods=365` → `252`; refresh C01-15 comments.
- [ ] `tests/test_ana_recon_audit.py:1037` `365 ** 0.5` → `252 ** 0.5` (consistency).
- [ ] (Recommend) a `no-residual-scale-factor` agreement test (builder vs compute_all_metrics at 252).
- [ ] No framework install needed — pytest + vitest already present.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **`--cov-fail-under=80`** on the analytics-service pytest job (`ci.yml:934`). New tests + the converged
  goldens must keep coverage ≥ 80. Adding the param/proof test *raises* coverage; the convergence touches
  already-covered lines.
- **`mypy --strict --follow-imports=silent services/ routers/ models/`** (`ci.yml:913`). The new
  `periods_per_year: int = 252` param and threaded helper signatures must be fully typed. A bare `int`
  default is fine; no `Any`. [VERIFIED: `pyproject.toml [tool.mypy] strict = true`]. Per the
  B-mypy-local-venv-drift memory note, validate mypy against a CI-pinned `uv venv --python 3.12` +
  `requirements.txt`, NOT the local `.venv` (which has supabase 2.28.3 drift).
- **AGENTS.md** ("This is NOT the Next.js you know") — irrelevant; this phase is Python-only, no Next.js.
- **Rule 3 (surgical) / Rule 2 (simplicity)** — drives the "no asset-class resolver, default-only"
  recommendation and the "share the constant, don't delegate compute_sharpe" recommendation.
- **No test silently skipped (Rule 12 / CLAUDE.md fail-loud)** — the 365-proof must actually assert
  numeric rescale, not merely "param accepted."
- **`commit_docs: false`** — RESEARCH.md is written but not committed (config).
- **No new CI grammar/signature gate blocks this:** [VERIFIED] no test pins `compute_all_metrics` via
  `inspect.signature`; the SQL `raise-exception-concat-grammar` test concerns SQL functions, not
  `metrics.py`. Adding a keyword-default param is backward-compatible with all existing positional callers.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CI python 3.12 + `requirements.txt` quantstats 0.0.81 yields the SAME source/behavior as the homebrew py3.14 0.0.81 I inspected/probed. | Standard Stack caveat | LOW — a pinned version is identical source across interpreters; probe matched documented math. If wrong, the rescale ratios could differ (re-probe under py3.12 to eliminate). |
| A2 | `metrics_snapshot.sharpe` from `equity_reconstruction` is rendered on the landing verification card. | Caller Graph blast radius | LOW — traced through `metrics_to_jsonb` → process_key enrichment; the card consumes the JSONB. Worst case the number is stored-but-not-shown, which only *reduces* user-visible impact. |
| A3 | No data backfill of historical `metrics_snapshot.sharpe` (365→252) is in scope. | Runtime State Inventory | LOW — CONTEXT lists no migration; decision is code-only. If the user later wants historical rows corrected, that's a separate follow-up. |

## Open Questions

1. **Should `info_ratio` and `alpha` be in the 365-proof assertion?**
   - What we know: tracking-error/info_ratio scale linearly (×365/252) and greeks-alpha scales ×periods.
     The golden_252d fixture has `info_ratio: None` / `alpha: None` (benchmark calendar produces nulls in
     that fixture), so the parity fixture can't prove them.
   - What's unclear: whether to add a separate small synthetic benchmark in the proof test to exercise
     sites #5/#7/#8 (greeks alpha, info_ratio, rolling_alpha).
   - Recommendation: add a tiny aligned synthetic returns+benchmark pair in the proof test specifically
     to assert alpha (×365/252) and info_ratio (×365/252) rescale — otherwise sites #5/#7/#8 are threaded
     but unproven (a silent hole). Low effort, closes the guard fully.

2. **Tolerance on the no-residual-scale-factor agreement test.**
   - What we know: the builder uses NAV-derived returns with C01-06/C01-14 bar adjustments; `compute_all_metrics`
     uses the raw daily-return series. They won't be byte-identical even at the same `periods`.
   - Recommendation: assert they agree *at the same basis* on a fixture WITHOUT terminal-bar/day-0
     adjustments (so the only former difference was the 365-vs-252 factor), tolerance ±0.05 mirroring the
     existing builder-vs-quantstats cross-check. The point is "no ×1.204 factor," not bit-equality.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | analytics-service tests | ✓ | 3.14 local / 3.12 CI | — |
| quantstats | annualization | ✓ | 0.0.81 (pinned) | — |
| pytest | Python test suite | ✓ (dev dep) | — | — |
| numpy/pandas | metrics math | ✓ | pinned | — |
| node/vitest | TS parity test | ✓ | — | — |

**Missing dependencies:** none. This phase is code-only against already-installed, pinned deps.

## Sources

### Primary (HIGH confidence)
- Live codebase (grep/sed, this session): `analytics-service/services/metrics.py` (1499 lines),
  `services/equity_reconstruction.py`, `services/analytics_runner.py`, `routers/process_key.py`,
  `tests/test_metrics_parity.py`, `tests/test_equity_curve_builder.py`, `tests/test_ana_recon_audit.py`,
  `tests/test_mt5_golden_fixtures.py`, `tests/fixtures/{golden_252d_*,equity-curve-golden/*,regen_golden.py}`,
  `src/__tests__/metrics-parity.test.ts`, `src/lib/constants.ts`, `.github/workflows/ci.yml`, `pyproject.toml`.
- quantstats 0.0.81 source: `/opt/homebrew/lib/python3.14/site-packages/quantstats/stats.py` (sharpe 841,
  sortino 982, volatility 683, cagr 1507, greeks 2676).
- Empirical probe (this session): `periods=252 == default` for all 4 fns; rescale ratios √(365/252)=1.20350
  for sharpe/sortino/vol; CAGR geometric `(1+c)^(365/252)-1`; both verified < 1e-12.

### Secondary (MEDIUM confidence)
- [CITED: pypi.org/pypi/quantstats/0.0.81/json] — release date 2026-01-13, `yanked: false`, requires ≥3.10.

### Tertiary (LOW confidence)
- None. No claim in this research rests on unverified web/training data.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; quantstats version + signatures verified in source + on PyPI.
- Annualization site inventory: HIGH — every line read directly; 3 scout-missed sites found and verified.
- Caller graph: HIGH — exhaustive grep; exactly 2 `compute_all_metrics` callers, exactly 1 production
  `compute_sharpe` caller, no `periods=365` passed anywhere.
- Rescale relationships: HIGH — empirically proven this session (not from training).
- Test/CI invariants: HIGH — ci.yml + pyproject read directly; no signature/grammar gate blocks the param.

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable; the only volatility is a future quantstats bump — pinned, so N/A).
