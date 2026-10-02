# Phase 136: MT5RECON — Equity reconstruction → backbone → api_verified - Research

**Researched:** 2026-07-23
**Domain:** Money-math — deal-ledger → daily-return reconstruction → the ONE `derive_basis_series` backbone; asset-class annualization narrowing; ground-truth reconciliation + DQ-flag semantics
**Confidence:** HIGH (every claim is a codebase citation with file:line; no external library research needed — this phase composes existing in-repo primitives)

<user_constraints>
## User Constraints (from 136-CONTEXT.md)

### Locked Decisions
- **`combine_mt5_deal_ledger` mirrors `combine_native_ledger`** (`services/broker_dailies.py:174`): fold `history_deals_get` realized `profit`/`swap`/`commission`/`fee` + `DEAL_TYPE_BALANCE` external cash flows against the `account_info().equity` anchor → daily returns → the ONE `derive_basis_series` backbone (`services/basis_series.py:190`) with the `api_verified` provenance stamp.
- **A deposit day NEVER reads as a return spike** — external flows (`DEAL_TYPE_BALANCE`) are removed from the return numerator via the flow-adjusted daily formula: `(equity_close - net_external_flows - prior_close) / prior_close`.
- **Unclassifiable deal type FAILS LOUD** (the deribit-`correction` lesson): every `DEAL_TYPE` maps to realized-cost / external-flow / excluded; an unknown type RAISES, never silently dropped or coerced to a flow.
- **Wire through `Mt5Adapter.compute_metrics`/`fetch_raw`** — the Phase-135 fail-loud RAISE stubs are now IMPLEMENTED to route through the broker-dailies ONE-path (never a fill-based `MetricsSnapshot` — the BYB-02 corruption class).
- **Fail-loud error contract end-to-end**: `initialize`/`login` False → typed raise carrying `last_error()`; `history_deals_get` `None` (error) distinguished from `()` (honest empty) at every read. NO failure path fabricates data.
- **Traditional √252 annualization**: MT5 stamps `asset_class='traditional'`; `isCryptoExchange` (`src/lib/closed-sets.ts`) + the Python asset-class path (`services/metrics.py`, `services/ingestion/adapter.py`) NARROWED to EXCLUDE `'mt5'`. Guards against the DEFERRED unknown→crypto latent bug. Also fixes the Phase-135 `create-with-key` `asset_class:'crypto'` hardcode — MT5 must stamp `traditional`. Mutation-style fixture test FAILS if an MT5 series ever annualizes √365.
- **Reconciliation to live equity**: reconstructed equity reconciles to `account_info().equity` within a DEFINED tolerance (ground-truth parity gate). A material uPnL wedge raises the fail-loud DQ flag (v1.8 realized-basis convention). A missing-history window renders as HONEST coverage-masked absence — NEVER a fabricated flat account.
- **Oracle discipline (NON-NEGOTIABLE)**: test oracles pin the ECONOMICS, not the implementation's own formula — zero-cash-rotation ⇒ external flow F=0; hand-derived daily returns written as literals; a deposit day's return computed BY HAND. A fixture regenerated from the SUT's own helpers can mask a money bug — forbidden.

### Claude's Discretion
The reconciliation tolerance value, the exact DEAL_TYPE→classification table, and the DQ-flag threshold are engineering-discretion, grounded in the deribit/sFOX precedents and the v1.8 realized-basis convention.

### Deferred Ideas (OUT OF SCOPE)
- Live-broker reconciliation against a real account → Phase-134 human_needed spike / Phase 139.
- Concurrency / terminal wedge hardening → Phase 137 (`asyncio.to_thread`/`wait_for` + terminal-restart-on-timeout).
- The master-rejection retcode confirmation (WR-03) → Phase 139 go-live gate.
- lot→USD notional exposure widgets; `copy_rates`-based historical uPnL marking.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5RECON-01 | `combine_mt5_deal_ledger` folds deal ledger + `DEAL_TYPE_BALANCE` flows against `account_info().equity` → daily returns → `derive_basis_series` with `api_verified`; fail-loud | §1 (combine seam), §2 (DEAL_TYPE table), §3 (flow-adjusted formula), §4 (api_verified stamp), §Architecture Patterns |
| MT5RECON-02 | MT5 annualized TRADITIONAL √252; `isCryptoExchange`/asset-class path narrowed to exclude `'mt5'`; mutation-style fixture test | §5 (annualization narrowing — 4 exact edit sites) |
| MT5RECON-03 | Reconstructed equity reconciles to `account_info().equity` within tolerance; uPnL-wedge / missing-history flagged fail-loud, never fabricated flat | §6 (reconciliation + DQ flag mechanics + tolerances) |
</phase_requirements>

## Summary

This is a **composition** phase, not a new-math phase. The entire reconstruction path already exists and is battle-tested by Deribit (`combine_native_ledger`) and sFOX (`combine_sfox_balance_history`), both of which converge on the SAME two shared primitives — `nav_twr.chain_linked_twr` (flow-in-the-numerator TWR + the DQ-01 guard set) and `basis_series.derive_basis_series` (the ONE backbone that emits scalars + sparse rows + coverage mask). MT5's job is to write a THIRD combiner, `combine_mt5_deal_ledger`, that turns `history_deals_get` rows into the identical `(returns, meta)` shape those two produce, then let the unchanged worker downstream persist it.

**MT5 is structurally closest to sFOX, not Deribit.** A retail MT5 account is single-currency (broker deposit currency, effectively USD-family for our purposes) with a live `account_info().equity` anchor — there is NO per-currency coin-margined index reconstruction (Deribit's `native_nav` complexity). The natural build is: bucket signed deal cash-effect (`profit + swap + commission + fee`) per UTC day into an equity curve anchored to `account_info().equity`, subtract `DEAL_TYPE_BALANCE` external flows from the return numerator, and feed `chain_linked_twr` (or the realized-daily-record path via `combine_realized_and_funding`). The deposit-day-never-a-spike behavior is exactly the sFOX cashflow-separation identity `r_t = (NAV_t − NAV_{t-1} − F_t) / NAV_{t-1}` (`broker_dailies.py:249-253`), which is byte-identical to the MT5-EA golden-fixture flow-adjusted oracle (`test_mt5_golden_fixtures.py:222-228`).

**The `api_verified` stamp requires ZERO new stamping code.** Trust tier is decided by source at `routers/process_key.py:847`: `trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"`. Because MT5 is a broker-key (non-csv) source (`'mt5'` already in the `Source` Literal, `adapter.py:59`), it inherits `api_verified` automatically. `derive_basis_series` does NOT carry trust tier — it is orthogonal (the series backbone vs the `strategy_verifications` DB row). **However there is a latent gap** (see §4 Open Question): the `finalize_wizard_strategy` SQL RPC gates the DB verification-row insert on `v_exchange IN ('bybit','okx','binance')` — deribit/sfox/mt5 take a DIFFERENT verification write path; confirm MT5's long-fetch flow actually persists an `api_verified` row before claiming the badge works.

**Primary recommendation:** Write `combine_mt5_deal_ledger(deals, account_equity, server_utc_offset) -> (pd.Series, dict)` in `services/broker_dailies.py` beside its two siblings, feeding `chain_linked_twr`; add a new `venue == "mt5"` branch in `job_worker.py derive_broker_dailies` modeled on the sFOX branch (`:3009`); implement `Mt5Adapter.compute_metrics`/`fetch_raw` to route through it; and narrow the FOUR annualization sites (§5) so MT5 = √252. Normalize raw server-time epochs to UTC in the combiner (the ONE seam) before day-bucketing.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deal-ledger → daily-return reconstruction | API/Backend (analytics-service worker) | — | Money-math; runs in `job_worker.derive_broker_dailies`, the long-fetch worker branch — never client, never SSR |
| DEAL_TYPE classification (cost/flow/excluded/fail-loud) | API/Backend (`broker_dailies.py` / a new `mt5_deals.py` pure module) | — | Pure, I/O-free classifier — mirrors `deribit_txn.py`'s pure classification core so tests stay network-free |
| Server-time→UTC normalization | API/Backend (combiner — the ONE seam) | — | Go/no-go doc pins Phase 136 `combine_mt5_deal_ledger` as the single normalize seam; `Mt5Client` returns raw epochs verbatim (`mt5_client.py:237-239`) |
| Equity reconciliation + DQ-flag | API/Backend (`nav_twr` guards + worker gate) | — | Reuses `chain_linked_twr` DQ-01 guard set + `reconcile_flow_residual` construction check |
| `api_verified` trust-tier stamp | API/Backend (`process_key.py` + finalize RPC) | Database (`strategy_verifications`) | Source-driven at `process_key.py:847`; DB row via finalize path |
| Asset-class = traditional (√252) | API/Backend (`metrics.py` periods path) + Database (`strategies.asset_class`) | Frontend (`closed-sets.ts` `isCryptoExchange`) | Annualization is asset-class-driven on BOTH the Python KPI path and the TS scenario-blend path |

## Standard Stack

**No new packages.** This phase composes existing in-repo primitives only. All dependencies are already installed and CI-verified:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas | (existing) | daily-return Series, DatetimeIndex `.as_unit("us")` | The canonical analytics unit across the backbone |
| numpy | (existing) | finite-checks, vectorized guards | Used by `nav_twr` / `native_nav` |
| quantstats | 0.0.81 | Sharpe/vol/Sortino at `periods=252` | `metrics.compute_all_metrics` — the single KPI engine `[CITED: services/metrics.py:2]` |

**Installation:** none. `[VERIFIED: codebase]` — no `pip install` step; the plan MUST NOT add one.

## Package Legitimacy Audit

**Not applicable — this phase installs NO external packages.** All code is pure in-repo Python (analytics-service `services/`) + TypeScript (`src/lib/`, `src/app/api/`). `mt5linux` / `MetaTrader5` are NOT touched this phase — the build is against the Phase-134 `Mt5Client` CONTRACT (offline transport double via the `_connect` injection seam, `mt5_client.py:158-162`). No slopcheck / registry verification needed.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────────┐
  MT5 gateway (offline    │  Mt5Client (services/mt5_client.py)             │
  double this phase)  ───▶│   .login()  → fail-loud on False (last_error)   │
                         │   .account_info() → {equity, login, currency…}   │  raw server-time
                         │   .history_deals_get(from,to)                    │  epochs VERBATIM
                         │      None=ERROR(raise) ≠ ()=honest empty ≠ [rows] │  (mt5_client.py:237)
                         └───────────────────────┬─────────────────────────┘
                                                 │ list[deal dict]
                                                 ▼
       ┌──────────────────────────────────────────────────────────────────────┐
       │  combine_mt5_deal_ledger  (NEW — services/broker_dailies.py, beside    │
       │  combine_native_ledger:174 / combine_sfox_balance_history:230)         │
       │  1. normalize server-time epoch → UTC (subtract recorded offset) ← the │
       │     ONE seam (mt5-spike-gonogo.md §7)                                   │
       │  2. classify each deal.type → cost | external-flow | excluded | RAISE  │
       │     (pure classifier; unknown type FAILS LOUD — deribit 'correction')  │
       │  3. daily_pnl_per_day = Σ(profit+swap+commission+fee) of trading deals  │
       │  4. flows_per_day     = Σ(profit) of DEAL_TYPE_BALANCE (external)       │
       │  5. anchor to account_info().equity; feed chain_linked_twr             │
       │     r_t = (NAV_t − NAV_{t-1} − F_t)/NAV_{t-1}  (deposit ≠ spike)        │
       │  → (returns: pd.Series, meta: dict)  ── byte-shape identical to sibs    │
       └───────────────────────────────┬──────────────────────────────────────┘
                                        │ (returns, meta)
                                        ▼
       ┌──────────────────────────────────────────────────────────────────────┐
       │  job_worker.derive_broker_dailies  — NEW `venue == "mt5"` branch       │
       │  (model on the sFOX branch :3009 — single-equity, no coin buckets)     │
       │  • material-equity-but-<2-days floor (the C2 / sFOX :3116 analog)       │
       │  • reconcile reconstructed terminal NAV vs account_info().equity       │
       │    within tolerance → DQ flag on breach (MT5RECON-03)                   │
       │  • NavReconstructionError → permanent FAILED + terminal stamp          │
       └───────────────────────────────┬──────────────────────────────────────┘
                                        │ (returns, meta)  — UNCHANGED downstream
                                        ▼
   periods_per_year_for_asset_class ──▶ derive_basis_series (basis_series.py:190)
   (metrics.py:43 — MUST resolve 252   → metrics_json (scalars) + series_rows (sparse)
    for mt5; §5)                          + gap_spans (coverage mask) + conventions
                                        ▼
                          persist_basis_series → strategy_analytics_series

   trust_tier = "api_verified"  ← process_key.py:847 (source != 'csv') — orthogonal,
                                  no new code; DB row via finalize path (§4)
```

File-to-implementation is in the Component Responsibilities below; the diagram traces the primary use case (connected MT5 account → honest api_verified daily-return series).

### Recommended Project Structure
```
analytics-service/services/
├── broker_dailies.py       # ADD combine_mt5_deal_ledger beside :174/:230
├── mt5_deals.py            # NEW (recommended): PURE, I/O-free DEAL_TYPE classifier
│                           #   + server-time→UTC normalize (mirror deribit_txn.py's
│                           #   pure-core discipline so tests stay network-free)
├── job_worker.py           # ADD `venue == "mt5"` branch in derive_broker_dailies
├── ingestion/mt5.py        # IMPLEMENT compute_metrics/fetch_raw (currently RAISE)
└── metrics.py              # (unchanged mechanism — asset_class drives 252 already)

analytics-service/tests/
├── test_mt5_deal_reconstruction.py   # NEW: hand-derived economic oracles
└── test_mt5_golden_fixtures.py       # EXISTING √252 + flow-adjusted precedent

src/lib/closed-sets.ts                # NARROW isCryptoExchange to exclude 'mt5'
src/app/api/strategies/create-with-key/route.ts   # asset_class 'crypto'→per-source
```

### Pattern 1: The three-sibling combiner contract (mirror, don't invent)
**What:** Every broker source produces `(returns: pd.Series, meta: dict)` where `returns` is a float Series on an ascending daily `DatetimeIndex` (unit `[us]`) and `meta` is a plain dict of the `NavTWRMeta` DQ flags. Downstream (`derive_basis_series`, persist, factsheet) is UNTOUCHED because the shape is identical.
**When to use:** Always — this is the locked backbone-unification principle.
**Reference:**
```python
# Source: services/broker_dailies.py:174 (deribit) and :230 (sfox)
def combine_native_ledger(...) -> tuple[pd.Series, dict[str, Any]]: ...
def combine_sfox_balance_history(usd_value, flows_by_day) -> tuple[pd.Series, dict[str, Any]]: ...
# combine_mt5_deal_ledger MUST return the same (pd.Series, dict) shape.
```

### Pattern 2: Cashflow separation — the deposit-is-not-a-return identity
**What:** The external flow F sits in the numerator: `r_t = (NAV_t − NAV_{t−1} − F_t) / NAV_{t−1}`. A deposit day books its REAL PnL, never the deposit itself.
**When to use:** Every day carrying a `DEAL_TYPE_BALANCE` deal.
**Reference:**
```python
# Source: services/broker_dailies.py:249-253 (sFOX docstring — the exact identity)
# "the external flow F sits in the numerator r_t = (NAV_t - NAV_{t-1} - F_t)/NAV_{t-1}
#  — a deposit day therefore books its REAL PnL, never the deposit itself."
# Booking usd_value.pct_change() instead would count a deposit as return.
```
This is byte-identical to the MT5-EA golden oracle `(equity_close − net_external_flows − prior_close)/prior_close` (`test_mt5_golden_fixtures.py:222-228`, hand-computed 0.0030 not +10.3%).

### Pattern 3: Pure classifier core, I/O-free (fail-loud on unknown)
**What:** Classification lives in a pure module importing only stdlib+typing (no network), so correctness tests are network-free and revert-proof. Unknown types are an ALLOW-LIST, not a block-list — an unknown carrying cash FAILS LOUD.
**When to use:** The DEAL_TYPE classifier.
**Reference:**
```python
# Source: services/deribit_txn.py:516-535, :779-789
CASH_BEARING_TYPES = frozenset({"trade","settlement","delivery","liquidation","negative_balance_fee"})
INFORMATIONAL_TYPES = frozenset({"transfer","deposit","withdrawal","usdc_reward","swap"})
assert not (CASH_BEARING_TYPES & INFORMATIONAL_TYPES)  # import-time disjointness
# An unknown type carrying nonzero cash fails loud (never silently leaks in or out).
```

### Anti-Patterns to Avoid
- **Fill-based MetricsSnapshot (BYB-02 corruption class):** `Mt5Adapter.compute_metrics` must NEVER delegate to `EquityCurveBuilder` — that reopens the silently-empty/wrong track-record path. Current stub already raises this exact warning (`ingestion/mt5.py:219-233`). Route through the deal-ledger backbone only.
- **`None` treated as empty:** `history_deals_get` `None` is an ERROR (raise); `()` is an honest empty (`[]`). Conflating them fabricates a flat account — the highest-severity pitfall for this source (`mt5_client.py:233-243` already enforces at the client; the combiner must not re-conflate).
- **Silently coercing an unknown DEAL_TYPE to a flow (or dropping it):** the deribit-`correction` lesson (`deribit_txn.py:608-660`) — an unrecognized/capital-flavored type must fail loud, never be assumed trading performance.
- **`pct_change()` on the equity series:** counts deposits as return. Use the flow-in-numerator identity.
- **Plumbing `periods_per_year=365` for MT5:** inflates Sharpe ~×1.20 vs crypto peers (`test_mt5_golden_fixtures.py:32-33`). MT5 = 252.
- **Regenerating fixtures from the SUT:** self-referential oracles mask money bugs (locked oracle discipline; `test_mt5_golden_fixtures.py:43-48`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flow-in-numerator TWR + DQ guards | A bespoke `r_t` loop | `nav_twr.chain_linked_twr` (`nav_twr.py:365`) | Full DQ-01 guard set (dust/negative/flow-/pnl-dominated) already tuned against real accounts |
| Realized-daily-records → anchored return series | A custom anchor roll | `combine_realized_and_funding` (`broker_dailies.py:141`) OR `chain_linked_twr` directly | anchor-to-today reconstruction + gap-fill already correct |
| Scalars + sparse rows + coverage mask | A second metrics compute | `derive_basis_series` (`basis_series.py:190`) | Anti-divergence-by-construction; kills the √252-vs-√365 divergence class |
| Sharpe/vol/CAGR | A stats formula | `compute_all_metrics` (`metrics.py`) | Single KPI engine, calendar-clock CAGR vs frequency-clock risk |
| UTC-day bucketing of a timestamp | Ad-hoc `datetime` math | `deribit_txn._row_utc_day` (`deribit_txn.py:919`) | Fail-loud on undatable ts; handles epoch-ms/ISO/datetime |
| asset_class → periods | A `365`/`252` literal | `periods_per_year_for_asset_class` (`metrics.py:43`) / `annualizationPeriods` (`closed-sets.ts:258`) | ONE registry each side; a bare literal drifts |
| Non-finite input rejection | Bare `float()` | `nav_twr._coerce_float` (`nav_twr.py:223`) / `deribit_txn._coerce_float` | Rejects NaN/Inf that would sail past DQ guards as silent-NaN `complete` |
| gap-fill to dense daily | Manual reindex | `gap_fill_daily_returns` (`broker_dailies.py:124`) | Pins `[us]` unit (pandas 3.0 #593), 0.0-fill for a ledger-complete venue |

**Key insight:** MT5 is a ledger-COMPLETE venue (like Deribit, unlike sFOX's sampled NAV). A no-activity day is genuinely flat, so `gap_fill_daily_returns` 0.0-fill is CORRECT here — but a genuinely MISSING history window (no deal data for a span) must render as coverage-masked absence via `gap_spans`, not a fabricated flat run. Decide which regime each gap is in explicitly (see §6).

## Runtime State Inventory

Not a rename/refactor/migration phase — this is additive money-math. **Category-by-category:**
- **Stored data:** None mutated. `combine_mt5_deal_ledger` writes NO new stored keys; it produces a return Series persisted under the EXISTING `strategy_analytics_series` kinds (`basis_series.py:103-125`) via the unchanged `persist_basis_series`. Verified — no new `kind`, no DDL.
- **Live service config:** None. No new env vars introduced by RECON (the gateway env `MT5_GATEWAY_HOST/PORT` already exist from 135; the `MT5_ENABLED` server gate is 135/139).
- **OS-registered state:** None.
- **Secrets/env vars:** None new. (`MT5_REQUEST_TIMEOUT_S`, `MT5_LOGIN_TIMEOUT_MS` already exist, `mt5_client.py:77/83`.)
- **Build artifacts:** None.

## Common Pitfalls

### Pitfall 1: Broker-server-time is NOT UTC — deals near midnight bucket to the wrong day
**What goes wrong:** MT5 `history_deals_get` returns `time`/`time_msc` in the broker's server timezone (whole/half-hour offset from UTC), returned VERBATIM by `Mt5Client` (`mt5_client.py:237-239`). Bucketing them raw shifts near-midnight deals onto the wrong calendar day → wrong daily returns.
**Why it happens:** The client deliberately does NOT normalize (`mt5-spike-gonogo.md` §7 pins Phase 136's combiner as the ONE normalize seam).
**How to avoid:** In `combine_mt5_deal_ledger`, subtract the recorded per-broker offset to normalize to UTC BEFORE `_row_utc_day` bucketing. The offset is `[ASSUMED]` until the live spike (Phase 134/139) confirms it; the offset value is a `checkpoint:human-verify` concern.
**Warning signs:** A return on a calendar day the account was flat; a deposit's flow landing one day off from its equity jump.

### Pitfall 2: The `finalize_wizard_strategy` RPC does NOT stamp api_verified for non-{binance,okx,bybit}
**What goes wrong:** `finalize_wizard_strategy` inserts the `strategy_verifications` `api_verified` row ONLY when `v_exchange IN ('bybit','okx','binance')` (`supabase/migrations/20260716130500_finalize_terminal_status_param.sql:188`). deribit/sfox/mt5 are NOT in that IN-list, so a naive assumption "MT5 gets the badge for free" may be false.
**Why it happens:** deribit/sfox are long-fetch flows; their api_verified row is written on a DIFFERENT path (the long-fetch/verify path), NOT this synchronous finalize RPC.
**How to avoid:** Trace the deribit/sfox long-fetch verification-row write and confirm MT5 rides the same one. `process_key.py:847` sets `trust_tier="api_verified"` in the pipeline response for any non-csv source, but the DB `strategy_verifications` row is what the badge reads (`get_published_trust_signals`, migration `20260719140000`). See §4 Open Question.
**Warning signs:** MT5 factsheet renders `self_reported` fallback despite a live api read; `strategy_verifications` has no `api_verified` row for the MT5 strategy.

### Pitfall 3: Realized-ledger equity ≠ live mark-to-market equity (the v1.8 uPnL wedge)
**What goes wrong:** A realized-basis reconstruction (summing closed-deal PnL) will NOT equal `account_info().equity` when open positions carry floating uPnL. Forcing them equal fabricates data; ignoring the gap silently mis-states returns.
**Why it happens:** `account_info().equity` = balance + floating PnL of open positions; the realized deal ledger only books closed PnL.
**How to avoid:** Reconcile within a tolerance; beyond tolerance, raise the DQ flag (`unrealized_pnl_in_anchor`, `nav_twr.py:207`) → `complete_with_warnings`, exactly as Deribit does (`job_worker.py:2496-2503` uses `UNREALIZED_MATERIALITY_RATIO = 0.05`, `nav_twr.py:90`). Never silently reconcile.
**Warning signs:** Terminal reconstructed NAV differs from `account_info().equity` by more than a fee-dust band on an account with open positions.

### Pitfall 4: quantstats mis-reads an all-non-negative return series with a >100% day as PRICES
**What goes wrong:** quantstats `_prepare_returns` can mis-detect a returns series as a price series if all values are non-negative and one day exceeds 100%, flipping Sharpe/vol sign/scale (DEFERRED latent bug `[[project_quantstats_price_detection_sharpe_bug]]`).
**Why it happens:** quantstats 0.0.81 heuristic price-vs-returns detection.
**How to avoid:** Feed `compute_all_metrics` an unambiguous RETURNS series (fractional, signed, never a NAV level). The reconstruction already emits fractional daily returns via `chain_linked_twr` — verify the MT5 fixture includes at least one negative day so detection cannot flip, and never route a NAV/equity level into the KPI engine.
**Warning signs:** A reconstructed MT5 series with only gains and one large day producing an implausibly low/negative Sharpe.

### Pitfall 5: `DEAL_ENTRY` vs `DEAL_TYPE` confusion; double-counting PnL fields
**What goes wrong:** MT5 deals carry BOTH `type` (`DEAL_TYPE_*`) and `entry` (`DEAL_ENTRY_IN/OUT/INOUT/OUT_BY`). `profit` is only realized on close (`DEAL_ENTRY_OUT`); summing `profit` on entry rows or double-counting `commission`/`fee` (some brokers post commission as a separate `DEAL_TYPE_COMMISSION` row AND in the `commission` field) over-/under-states returns.
**Why it happens:** Broker-dependent deal shaping.
**How to avoid:** Decide the exact per-broker fold rule (which fields sum, whether commission is a field or a separate deal row) as a `[ASSUMED]` convention pending the live spike; hand-derive the golden oracle so a wrong fold fails loud. Mirror the balance-identity discipline (`deribit_txn.py` — computed total == Σ of the fields, fail-loud).
**Warning signs:** Reconstructed terminal NAV drifts from `account_info().equity` by a consistent commission-sized amount.

## Code Examples

### The api_verified stamp (no new code — source-driven)
```python
# Source: analytics-service/routers/process_key.py:847
trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"
# 'mt5' is a non-csv Source (adapter.py:59) → api_verified automatically.
```

### DEAL_TYPE_BALANCE is the external-flow signal (established in the spike)
```python
# Source: analytics-service/scripts/mt5_spike.py:88-89
# DEAL_TYPE_BALANCE == 2: an external deposit/withdrawal flow, never a return.
_DEAL_TYPE_BALANCE = 2
```

### The flow-adjusted daily oracle (hand-derived, from the golden fixtures)
```python
# Source: analytics-service/tests/test_mt5_golden_fixtures.py:222-228
# prior_close = 100_000; +$10_000 deposit; +$300 trading gain
# equity_close = 110_300
# daily_return = (110_300 - 10_000 - 100_000) / 100_000 = 0.0030   (NOT +10.3%)
```

### chain_linked_twr DQ guard keys (the DQ-flag vocabulary MT5 inherits)
```python
# Source: analytics-service/services/nav_twr.py:201-212
NAV_TWR_GUARD_KEYS = (
    "dust_nav_guard", "negative_nav_guard", "flow_dominated_guard",
    "pnl_dominated_guard", "flow_coverage_incomplete", "unrealized_pnl_in_anchor",
    "unrealized_pnl_unreadable", "twr_chain_broken",
    "pre_summary_rollout_option_dailies", "pre_mark_retention_option_dailies",
)
# Tolerances: DUST_NAV_FLOOR=1000.0 (:58), FLOW_DOM_RATIO=1.0 (:60),
# UNREALIZED_MATERIALITY_RATIO=0.05 (:90).
```

## Detailed Answers to Research Questions

### Q1 — combine_native_ledger signature/shape & what combine_mt5_deal_ledger must do differently
- **Signature** (`broker_dailies.py:174`): `combine_native_ledger(ledger: NativeLedger, indexable: frozenset[str], *, denominator_config: ReturnsDenominatorConfig | None = None) -> tuple[pd.Series, dict[str, Any]]`.
- **How deribit folds:** it does NOT fold raw fields itself — it calls `reconstruct_native_nav_and_twr(ledger, indexable_currencies=indexable, venue="deribit")` (`:223`) then `gap_fill_daily_returns`. The fold of realized cash lives upstream in `build_deribit_native_ledger` (per-currency `native_pnl` = Σ ledger `change` per UTC day) and the anchor is `NativeLedger.terminal_native_equity` (`native_nav.py:219`). External BALANCE-type flows are handled by classifying types into `CASH_BEARING_TYPES` vs `_EXTERNAL_FLOW_TYPES` (`deribit_txn.py:533-563`); the anchor SUBTRACTS net external flow so a lifetime transfer cannot distort initial capital (`deribit_txn.py:555-563`).
- **How it anchors:** anchor-to-today, reconstruct backward — `initial = equity_today − Σrealized`, most-recent equity == live read (`broker_dailies.py:27-32`). Deribit does per-currency backward roll via `reconstruct_nav` (`native_nav.py:449-460`); the §5 inception gate (`native_nav.py:661`) reconciles the roll to a ~0 pre-history balance.
- **Handoff/stamp:** `combine_native_ledger` does NOT stamp provenance — it returns `(returns, meta)`. The `meta` (`NavTWRMeta` dict) carries DQ flags. `derive_basis_series` (`:190`) consumes `(returns, ...)`. Trust tier is separate (§4).
- **What MT5 must do differently:** MT5 is single-currency (broker deposit ccy — treat as USD-family, NO coin-index reconstruction). So DO NOT use `native_nav`'s per-currency machinery. Instead: fold `profit+swap+commission+fee` of trading deals per UTC day → `daily_pnl`; sum `DEAL_TYPE_BALANCE` deals per UTC day → `flows_by_day`; anchor to `account_info().equity`; call `chain_linked_twr(nav, daily_pnl, flows_by_day, prev0=...)` directly (the sFOX pattern, `broker_dailies.py:356-361`) OR build realized-daily-records and use `combine_realized_and_funding` (`:141`). The MT5 deal shape's fields (`profit/swap/commission/fee`, `type=DEAL_TYPE_*`, `entry=DEAL_ENTRY_*`) replace deribit's `change`/`type`. Normalize server-time→UTC first (Pitfall 1).

### Q2 — DEAL_TYPE classification table (mirroring the deribit allow-list/deny-list discipline)
The established constant is `DEAL_TYPE_BALANCE == 2` (external flow). The full MT5 `DEAL_TYPE_*` enum (from the MetaTrader5 Python package, standard values — tag `[ASSUMED]`, confirm against the live spike / official docs before locking):

| DEAL_TYPE | Value | Classification | Rationale |
|-----------|-------|----------------|-----------|
| `DEAL_TYPE_BUY` | 0 | trading realized (fold `profit+swap+commission+fee` on close) | market fill |
| `DEAL_TYPE_SELL` | 1 | trading realized | market fill |
| `DEAL_TYPE_BALANCE` | 2 | **external flow** (deposit/withdrawal) | never a return — the flow numerator subtraction `[VERIFIED: codebase mt5_spike.py:88]` |
| `DEAL_TYPE_CREDIT` | 3 | external flow (broker credit) | not the user's trading PnL (golden fixture treats CREDIT/BONUS as flow, `test_mt5_golden_fixtures.py:323`) |
| `DEAL_TYPE_CHARGE` | 4 | **decide: cost vs flow** `[ASSUMED]` | additional charge — likely a cost; confirm on evidence |
| `DEAL_TYPE_CORRECTION` | 5 | **FAIL LOUD by default** (per-reason if evidence) | the deribit-`correction` lesson: never assume trading vs capital (`deribit_txn.py:608-660`); golden-fixture note flags CORRECTION as the hard case (`test_mt5_golden_fixtures.py:334`) |
| `DEAL_TYPE_BONUS` | 6 | external flow | broker bonus, not trading PnL |
| `DEAL_TYPE_COMMISSION` | 7 | trading cost | reduces equity, not a flow (`test_mt5_golden_fixtures.py:289`) |
| `DEAL_TYPE_COMMISSION_DAILY` | 8 | trading cost | recurring commission |
| `DEAL_TYPE_COMMISSION_MONTHLY` | 9 | trading cost | recurring commission |
| `DEAL_TYPE_COMMISSION_AGENT_DAILY` | 10 | trading cost | agent commission |
| `DEAL_TYPE_COMMISSION_AGENT_MONTHLY` | 11 | trading cost | agent commission |
| `DEAL_TYPE_INTEREST` | 12 | **decide: cost/return vs flow** `[ASSUMED]` | ambiguous like deribit `interest` (dropped from the allow-list, `deribit_txn.py:694`); fail-loud until evidence |
| `DEAL_TYPE_BUY_CANCELED` | 13 | excluded / fail-loud | cancelled — no economic effect; confirm |
| `DEAL_TYPE_SELL_CANCELED` | 14 | excluded / fail-loud | cancelled |
| `DEAL_DIVIDEND` | 15 | **decide: return vs flow** `[ASSUMED]` | CFD dividend adjustment — likely trading return; confirm |
| `DEAL_DIVIDEND_FRANKED` | 16 | as dividend `[ASSUMED]` | |
| `DEAL_TAX` | 17 | trading cost `[ASSUMED]` | |

**Discipline to mirror (`deribit_txn.py`):** (1) define `_MT5_TRADING_DEAL_TYPES` (cost/PnL) and `_MT5_EXTERNAL_FLOW_DEAL_TYPES` as frozensets with an import-time disjointness assert (`deribit_txn.py:552`); (2) an unknown/unlisted type carrying nonzero cash FAILS LOUD (allow-list, not block-list, `deribit_txn.py:516-519`); (3) `DEAL_TYPE_CORRECTION` (and any ambiguous type) fails loud by default — classify on evidence, never guess (`deribit_txn.py:762-776`); (4) if a per-comment/reason classification is ever added, the capital deny-list is checked FIRST by plain substring, the trading allow-list second by word-boundary (`deribit_txn.py:724-759`), and a non-string reason → `""` → fail loud (`deribit_txn.py:708-721`). **The exact table (esp. CHARGE/INTEREST/CANCELED/DIVIDEND) is Claude's-discretion, grounded in evidence; lock ASSUMED rows behind a human-verify checkpoint.**

### Q3 — Deposit-day / flow-adjusted daily formula & where net_external_flows is subtracted
- **Formula:** `daily_return = (equity_close − net_external_flows − prior_close) / prior_close` — hand-derived oracle `[VERIFIED: test_mt5_golden_fixtures.py:222-228]` (deposit day → 0.0030 not +10.3%; withdrawal → outflow does not depress, `:256-264`; cost included in equity_close not in flows, `:288-294`).
- **Where subtracted in the shared engine:** `chain_linked_twr` places F in the numerator: `r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1}` `[VERIFIED: broker_dailies.py:249-253]`. The flow series is built per UTC day and unioned into the pnl index via `_union_flow_days` (`nav_twr.py:281`) so a deposit on a no-trade day becomes a valid zero-pnl NAV day. `combine_realized_and_funding` threads `external_flows` straight to the honest core (`broker_dailies.py:147-169`).

### Q4 — api_verified provenance stamp
- **The `TrustTier` Literal** = `"api_verified" | "csv_uploaded" | "self_reported"` `[VERIFIED: adapter.py:60]`.
- **Where stamped:** `routers/process_key.py:847` — `trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"`. Non-csv (incl. `'mt5'`) → api_verified `[VERIFIED: codebase]`. Written into the response at `:856/:1182`.
- **How deribit/sfox stamp it through derive_basis_series:** they DON'T — `derive_basis_series` produces only the return series + scalars + mask. Trust tier is orthogonal (pipeline response tier at `process_key.py`; DB `strategy_verifications.trust_tier` read by the badge via `get_published_trust_signals`, migration `20260719140000`). **No new stamping code for MT5.**
- **⚠️ OPEN (see Open Questions):** the synchronous `finalize_wizard_strategy` RPC inserts the DB `api_verified` row ONLY for `IN ('bybit','okx','binance')` (`migration 20260716130500:188`). Confirm the deribit/sfox/mt5 long-fetch flow writes its `api_verified` `strategy_verifications` row on its own path (not this RPC) before claiming the badge renders.

### Q5 — Annualization narrowing (MT5RECON-02) — the EXACT edit sites
Four sites decide √365 vs √252:

1. **`src/lib/closed-sets.ts:245-250` `isCryptoExchange`** — currently returns `true` for ANY member of `SUPPORTED_EXCHANGES`, and `'mt5'` was added to that set (`:39`). **Edit:** narrow to an explicit crypto subset that EXCLUDES `'mt5'` (the docstring already anticipates this: "When a non-crypto (equities/FX) venue is ever added…this must be narrowed to an explicit crypto subset", `:240-243`). This is the single TS gate; `annualizationPeriods` (`:258`) and `blendPeriodsPerYear` (`:281`) key off `asset_class === "crypto"` so they need no edit IF asset_class is stamped `traditional`.
2. **`src/app/api/strategies/create-with-key/route.ts:354`** — `.update({ asset_class: "crypto" })` force-derives crypto on the freshly-created key-backed draft. **Edit:** make it per-source — `'traditional'` for mt5, `'crypto'` otherwise (or derive via `isCryptoExchange(exchange)`). Same hardcode exists at `finalize-wizard/route.ts:534` (`apiKeyId || isCompositeForAssetClass ? "crypto" : ...`) and `composite/add-key/route.ts:330` — audit all three.
3. **`analytics-service/services/metrics.py:43` `periods_per_year_for_asset_class`** — already correct: `crypto → 365 else 252`. The MECHANISM needs no change; MT5 just needs `asset_class='traditional'` in `strategies` so the worker reads 252 (`job_worker.py:3897/4147/5378` all call this off `strategy_row.get("asset_class")`). **No edit** if #2 stamps traditional.
4. **`analytics-service/services/ingestion/adapter.py`** — no asset_class hardcode in the adapter itself; the periods clock is read from the DB `asset_class` at the worker. **No edit.**

**Mutation-style fixture test:** feed a fabricated MT5 return series through the worker/derive path and assert `conventions["periods_per_year"] == 252` AND that Sharpe/vol equal the √252 oracle (not the √365 value). Because `basis_series.py` echoes `periods_per_year` into `conventions` (`:263-267`) and the scalar is a cache of the rows, the test fails loud if MT5 ever resolves 365. The precedent is `test_mt5_golden_fixtures.py:357-412` (T1) — hand-computed `SQRT_252` KPIs.

### Q6 — Reconciliation + DQ flag (MT5RECON-03)
- **How the codebase reconciles reconstructed vs ground-truth equity:** two mechanisms:
  1. **Construction self-check** `reconcile_flow_residual` (`nav_twr.py:572`): `residual = terminal_nav − reconstructed_start − Σpnl − Σflows`, tolerance `max(1.00, 1e-6 * abs(terminal_nav))` (`:602`), breach → `NavReconstructionError` (permanent). NOTE it is a CONSTRUCTION tautology — it catches a roll-loop-vs-Σ code divergence, NOT a wrong-scope anchor (`:583-598`).
  2. **Inception reconciliation gate** (deribit only, full-history) `_assert_inception_reconciled` (`native_nav.py:661`): tolerance `max(INCEPTION_ABS_TOL_USD=1.00, INCEPTION_REL_TOL=1e-4 * anchor_nav)` (`native_nav.py:178-183, :767`), with a per-currency native dust floor `INCEPTION_NATIVE_DUST_REL=1e-4` (`:199`).
- **Where the uPnL-wedge DQ flag is raised:** `job_worker.py:2496-2503` — when `abs(open_unrealized_usd)/equity > UNREALIZED_MATERIALITY_RATIO (0.05)` and anchor `> DUST_NAV_FLOOR (1000)`, set `meta["unrealized_pnl_in_anchor"] = True` → promotes to `complete_with_warnings` (a registered `NAV_TWR_GUARD_KEYS` flag, `nav_twr.py:207`). This IS the v1.8 realized-basis convention: realized ledger vs live MTM equity legitimately diverge by open-position uPnL; beyond tolerance it is FLAGGED, not silently reconciled.
- **Tolerances deribit/sfox use:** deribit — `UNREALIZED_MATERIALITY_RATIO=0.05`, inception `max($1, 1e-4·NAV)`, construction `max($1, 1e-6·terminal)`. sFOX — no uPnL wedge (`open_unrealized_usd=0.0`, `job_worker.py:3177`); it uses the material-equity-but-<2-usable-days floor (`_DERIBIT_EMPTY_LEDGER_FLOOR_USD`, `job_worker.py:3116-3132`) and `nav_coverage_gap_days` for sampled gaps. **Recommended MT5 tolerance:** reconcile terminal reconstructed NAV to `account_info().equity`; treat the realized-vs-MTM gap as the uPnL wedge and reuse `UNREALIZED_MATERIALITY_RATIO=0.05` → `complete_with_warnings` on breach. Exact value is Claude's-discretion; ground it on the live soak (Phase 139).
- **Missing-history window as coverage-masked absence:** `derive_basis_series` DROPS non-finite/absent days into `gap_spans` (`basis_series.py:257-261`), which the client renders as FS-02 missing-segment annotations — never a fabricated flat run (`basis_series.py:324-331`). MT5 must decide per gap: a no-activity day on a ledger-COMPLETE window = genuine flat (0.0 via `gap_fill_daily_returns`); a window with NO deal data = coverage-masked absence (leave absent → `gap_spans`). Do not 0.0-bridge a genuine data gap.

### Q7 — Oracle discipline & the quantstats price-detection bug
- **quantstats bug** (`[[project_quantstats_price_detection_sharpe_bug]]`): an all-non-negative return series with a >100% day can be mis-read as PRICES by qs `_prepare_returns` → wrong Sharpe. Feed `compute_all_metrics` an unambiguous fractional signed RETURNS series (never a NAV level); include a negative day in fixtures. (`metrics.py:2` imports quantstats; the strategy-analytics path is the open one — the reconstruction path here must not regress it.)
- **Oracle discipline:** test oracles pin ECONOMICS, not the SUT's own formula (`test_mt5_golden_fixtures.py:43-48`, `[[feedback_economic_invariant_oracles_not_self_referential]]`). Hand-derive: zero-cash-rotation ⇒ F=0; deposit-day return by hand (0.0030 not +10.3%); daily returns as literals. Never regenerate a fixture from `combine_mt5_deal_ledger`'s own output — that masks money bugs.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-source bespoke metrics | ONE `derive_basis_series` backbone; dailies canonical → derive everything | Phase 103-108 (v1.10) | MT5 must route here, never a fill-based snapshot |
| USD-space deribit reconstruction | NATIVE per-currency roll (`reconstruct_native_nav_and_twr`) | Phase 79-80 (v1.9) | MT5 is single-ccy → use the simpler sFOX-style `chain_linked_twr`, NOT the native machinery |
| Hardcoded `periods=252` | `asset_class`-driven `periods_per_year_for_asset_class` (crypto 365 / traditional 252) | Phase 34 / #597 | MT5 = traditional 252 via asset_class stamp |
| MT5 EA CSV `self_reported` | LIVE api read → `api_verified` reconstruction | v1.15 (this milestone) | The whole point — defeat fabricatable EA/CSV numbers |

**Deprecated/outdated:** `Mt5Adapter.compute_metrics`/`fetch_raw` RAISE stubs (`ingestion/mt5.py:205-233`) — this phase IMPLEMENTS them to route through the backbone. The RAISE was the Phase-135 tripwire, not a permanent state.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Full `DEAL_TYPE_*` enum values/semantics (CHARGE/INTEREST/CANCELED/DIVIDEND/TAX classification) | Q2 table | Mis-classify a cost as a flow (or vice-versa) → wrong returns; MITIGATED by fail-loud-on-unknown + human-verify checkpoint |
| A2 | Broker-server-time→UTC offset value (whole/half hour) | Pitfall 1 / Q1 | Near-midnight deals bucket to wrong day; offset is per-broker, confirmed live (Phase 134/139) |
| A3 | Per-broker field fold rule (commission as field vs separate deal row; profit only on `DEAL_ENTRY_OUT`) | Pitfall 5 / Q1 | Double-count or drop PnL; MITIGATED by reconcile-to-equity tolerance gate |
| A4 | MT5 account is single-currency / USD-family (no coin-index reconstruction needed) | Summary / Q1 | If a broker reports multi-currency equity, need currency handling; retail investor accounts are single deposit ccy |
| A5 | The deribit/sfox long-fetch flow writes an `api_verified` `strategy_verifications` DB row (not via the narrow finalize RPC) | Q4 / Pitfall 2 | MT5 badge renders `self_reported`; MUST trace before claiming done |
| A6 | Recommended reconciliation tolerance = reuse `UNREALIZED_MATERIALITY_RATIO=0.05` for the realized-vs-MTM wedge | Q6 | Too tight → false DQ flags; too loose → misses real wedge; Claude's-discretion, tune on soak |

## Open Questions

1. **Does MT5's long-fetch flow persist an `api_verified` `strategy_verifications` row?**
   - What we know: `process_key.py:847` sets the pipeline-response tier to api_verified for non-csv; the badge reads the DB row via `get_published_trust_signals`.
   - What's unclear: `finalize_wizard_strategy` gates the DB insert on `IN ('bybit','okx','binance')` — the deribit/sfox DB-row write path is elsewhere and unverified for mt5.
   - Recommendation: the plan MUST include a task to trace the deribit/sfox verification-row write and confirm MT5 rides it (grep `strategy_verifications` inserts in the long-fetch/verify path); add a regression test asserting an MT5 strategy gets an `api_verified` row.

2. **Exact DEAL_TYPE classification (CHARGE/INTEREST/CANCELED/DIVIDEND).**
   - What we know: BALANCE=flow (verified), COMMISSION=cost, CREDIT/BONUS=flow, CORRECTION=fail-loud.
   - What's unclear: the ambiguous middle (A1).
   - Recommendation: fail-loud-on-unknown as the safe default; lock the ASSUMED rows behind a `checkpoint:human-verify` referencing the live spike / official MetaTrader5 docs.

3. **Realized-basis vs mark-to-market reconciliation regime for MT5.**
   - What we know: `account_info().equity` includes floating uPnL; realized deal ledger does not.
   - What's unclear: whether once-daily batch reconciliation to live equity is close enough without `copy_rates` historical marking (deferred).
   - Recommendation: realized-basis + uPnL-wedge DQ flag (Q6); `copy_rates` marking stays deferred unless the soak proves realized insufficient (per REQUIREMENTS future-deferred).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pandas | reconstruction | ✓ | existing | — |
| numpy | DQ guards | ✓ | existing | — |
| quantstats | KPI compute | ✓ | 0.0.81 | — |
| `Mt5Client` contract (offline double) | build/test | ✓ | Phase 134 (`services/mt5_client.py`) | — |
| `mt5linux` / live MT5 terminal | (NOT this phase) | ✗ | — | Built against the CONTRACT double; live is Phase 139 |
| pandera | Python test suite locally | ⚠️ | `pandera==0.32.1` (`pip install --break-system-packages`) | Declared dep; CI has it — local-only gap `[[reference_local_python_missing_pandera]]` |

**Missing dependencies with no fallback:** none block this phase (offline-contract build).
**Missing with fallback:** `mt5linux`/live terminal — intentionally absent; the `_connect` injection seam (`mt5_client.py:158-162`) doubles it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service Python) + vitest (TS) |
| Config file | `analytics-service` uses `--cov-fail-under=80`; TS `vitest.config.ts` |
| Quick run command | `cd analytics-service && pytest tests/test_mt5_deal_reconstruction.py -x` |
| Full suite command | `cd analytics-service && pytest` (+ `npm run test:coverage` for TS) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5RECON-01 | deposit day ≠ spike; flow-adjusted return | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_deposit_day_not_spike -x` | ❌ Wave 0 |
| MT5RECON-01 | unknown DEAL_TYPE fails loud | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_unknown_deal_type_raises -x` | ❌ Wave 0 |
| MT5RECON-01 | `history_deals_get` None≠() honesty preserved through combiner | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_none_vs_empty -x` | ❌ Wave 0 (client half exists: `test_mt5_client_contract.py:289`) |
| MT5RECON-02 | MT5 annualizes √252 not √365 (mutation-style) | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_annualizes_252_not_365 -x` | ❌ Wave 0 (√252 precedent: `test_mt5_golden_fixtures.py:357`) |
| MT5RECON-02 | `isCryptoExchange('mt5') === false` | unit (TS) | `npx vitest run src/lib/closed-sets.test.ts` | ❌ Wave 0 |
| MT5RECON-03 | uPnL-wedge beyond tolerance → `complete_with_warnings` | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_upnl_wedge_flags -x` | ❌ Wave 0 |
| MT5RECON-03 | missing-history window → gap_spans, not flat | unit | `pytest tests/test_mt5_deal_reconstruction.py::test_missing_window_masked -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_mt5_deal_reconstruction.py -x`
- **Per wave merge:** `cd analytics-service && pytest` + `npm run test:coverage`
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_mt5_deal_reconstruction.py` — hand-derived economic oracles for MT5RECON-01/02/03 (NOT regenerated from the SUT)
- [ ] `src/lib/closed-sets.test.ts` — add `isCryptoExchange('mt5')===false` assertion (or extend existing)
- [ ] (No framework install needed — pytest + vitest present)

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | MT5 auth is Phase 135 (validate/encrypt); RECON consumes already-encrypted keys |
| V3 Session Management | no | worker-internal |
| V4 Access Control | no | trust-tier is a data-quality label, not a publish signal (finalize RPC comment) |
| V5 Input Validation | yes | Untrusted broker deal rows: `_coerce_float` fail-loud on non-numeric/NaN/Inf (`nav_twr.py:223`); fail-loud on unknown DEAL_TYPE |
| V6 Cryptography | no | keys already KEK-wrapped upstream |

### Known Threat Patterns for MT5 reconstruction
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fabricated flat account from `None` deal read | Spoofing/Info | `None`≠`()` discipline (`mt5_client.py:233-243`); never coerce error→empty |
| Silent capital-as-performance (CORRECTION/CHARGE) | Tampering | fail-loud-on-unknown; deny-list-first classification (`deribit_txn.py:743-759`) |
| Credential leak in error strings | Info disclosure | `scrub_freeform_string` + by-value redaction at `Mt5ClientError` (`mt5_client.py:200-224`) — already enforced |
| Account-size leak in DQ raise messages | Info disclosure | leak-safe raises carry CODES/COUNTS/RATIOS only, never raw USD (`nav_twr.py` / `native_nav.py:14`) |
| Silent-NaN track record stamped `complete` | Tampering | `_coerce_float` rejects NaN/Inf at input choke point (`nav_twr.py:241-244`) |

## Project Constraints (from CLAUDE.md / AGENTS.md)
- **Money-math = caution over speed** (global Rule 6 root-cause; Rule 9 tests-verify-intent; Rule 12 fail-loud). No bandaids.
- **Coverage is a BLOCKING CI gate** (lines 82 / statements 80 / functions 74 / branches 72; Python `--cov-fail-under=80`). New reconstruction code must carry tests.
- **AGENTS.md:** this is a modified Next.js — read `node_modules/next/dist/docs/` before any Next.js code (the TS route edits in §5 touch API routes; check current conventions).
- **DESIGN.md** must be read before any UI change (none this phase — RECON is worker/backend + TS lib).
- **Feature-branch + PR** workflow; per-phase review = `gsd-code-reviewer` + `gsd-verifier` only.
- **Never `git add` `.planning/`**; subagents Edit not Write on ledgers.

## Sources

### Primary (HIGH confidence — codebase, this session)
- `analytics-service/services/broker_dailies.py:124-389` — `gap_fill_daily_returns`, `combine_realized_and_funding`, `combine_native_ledger`, `combine_sfox_balance_history`
- `analytics-service/services/basis_series.py:190-366` — `derive_basis_series`, `persist_basis_series`, `conventions` echo
- `analytics-service/services/nav_twr.py:56-640` — DQ guard keys, tolerances, `chain_linked_twr`, `reconcile_flow_residual`
- `analytics-service/services/native_nav.py:1-781` — deribit per-currency roll + inception gate + tolerances
- `analytics-service/services/deribit_txn.py:1-972` — pure classification core, allow/deny-list, correction fail-loud
- `analytics-service/services/mt5_client.py:1-272` — Mt5Client contract, None≠() discipline, dual timeout, redaction
- `analytics-service/services/ingestion/mt5.py:1-252` — Mt5Adapter RAISE stubs (to implement)
- `analytics-service/services/ingestion/adapter.py:59-266` — Source/TrustTier Literals, VerificationResult
- `analytics-service/services/metrics.py:32-763` — `periods_per_year_for_asset_class`, DEFAULT_PERIODS_PER_YEAR=252
- `analytics-service/services/job_worker.py:2297-3178` — deribit + sfox `derive_broker_dailies` branches
- `analytics-service/routers/process_key.py:847` — trust_tier source-driven stamp
- `analytics-service/tests/test_mt5_golden_fixtures.py` — √252 + flow-adjusted hand oracles
- `analytics-service/scripts/mt5_spike.py:88-89`, `docs/mt5-spike-gonogo.md:120-175` — DEAL_TYPE_BALANCE=2, server-time-UTC seam
- `src/lib/closed-sets.ts:39,245-285` — SUPPORTED_EXCHANGES (incl. mt5), isCryptoExchange, annualizationPeriods
- `src/app/api/strategies/create-with-key/route.ts:354`, `finalize-wizard/route.ts:534`, `composite/add-key/route.ts:330` — asset_class:'crypto' hardcodes
- `supabase/migrations/20260716130500_finalize_terminal_status_param.sql:188`, `20260719140000_get_published_trust_signals.sql` — api_verified DB-row gate + badge read

### Secondary (MEDIUM)
- MEMORY.md project notes (v1.15 kickoff, v1.8 realized-basis convention, quantstats bug, unknown→crypto latent bug)

### Tertiary (LOW / ASSUMED)
- MetaTrader5 Python package `DEAL_TYPE_*` enum values (A1) — verify against official docs / live spike before locking

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives cited in-repo
- Architecture (combiner seam, backbone, worker branch): HIGH — direct deribit/sfox analogs read line-by-line
- api_verified stamp: HIGH for the source-driven tier; MEDIUM for the DB-row write path (Open Q1)
- DEAL_TYPE table: MEDIUM — BALANCE/COMMISSION/CREDIT/CORRECTION verified; ambiguous middle ASSUMED
- Reconciliation/DQ: HIGH — tolerances and guard keys read directly
- Annualization narrowing: HIGH — all four edit sites located with line numbers

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (stable — in-repo composition; DEAL_TYPE enum re-verify at live spike)
