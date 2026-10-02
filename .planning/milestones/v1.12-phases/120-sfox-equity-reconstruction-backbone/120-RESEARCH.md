# Phase 120: SFOX Equity reconstruction + backbone - Research

**Researched:** 2026-07-18
**Domain:** Broker-dailies ingestion (custom non-ccxt exchange) → the ONE unified backbone (`derive_basis_series`) + `api_verified` trust stamp + P115 ground-truth parity
**Confidence:** HIGH (the deribit analog is traced end-to-end in-repo; the sFOX read surface + TWR primitive already exist; every claim below is `[VERIFIED: codebase]` unless tagged otherwise)

## Summary

The deribit broker-dailies ONE-path is fully mapped and the sFOX mirror is **simpler than deribit**, not harder. Deribit must *reconstruct* a NAV series by rolling a txn-log ledger backward from a terminal anchor (`build_deribit_native_ledger` → `reconstruct_native_nav_and_twr`); sFOX **hands us the NAV series directly** as `/v1/account/balance/history`'s daily `usd_value`. That means sFOX skips the entire ledger-reconstruction tier and plugs its `usd_value` series straight into the existing `chain_linked_twr` primitive (`services/nav_twr.py:351`) — the same TWR engine, with the same DQ-01 guards, that deribit's reconstruction ultimately feeds. From there the path is byte-identical to deribit: `gap_fill_daily_returns` → `derive_basis_series` (THE ONE backbone) → `persist_basis_series`. No parallel metrics path, no sfox-special derive chain.

Three seams are already done or free: (1) `SfoxClient` (118) + `read_sfox_account` (119) supply the reads; `get_balance_history()` exists on the client but is NOT yet in the read pull — 120 adds it. (2) `api_verified` is stamped **automatically** at `routers/process_key.py:828` for any non-csv `source` — no new stamping code; sfox earns it the moment it is a valid `Source`. (3) `SfoxAdapter.compute_metrics` fails loud exactly like `DeribitAdapter.compute_metrics` — returns flow through the broker-dailies ONE-path, never fills. Registration (Source Literal + `SUPPORTED_SOURCES` + `_FACTORIES`, landed together) resolves the phase-119 deferral and the F2/F7 finalize/process/verify seams in one move.

**Primary recommendation:** Add a `combine_sfox_balance_history(nav, flows_by_day)` in `services/broker_dailies.py` that calls `chain_linked_twr(nav=usd_value_series, daily_pnl=<implied>, flows_by_day, prev0=nav.iloc[0])` → `gap_fill_daily_returns`, add an `elif venue == "sfox":` branch in `job_worker.derive_broker_dailies` that reads balance-history + transactions (bounded by `asyncio.wait_for`), then routes the returns through the unchanged `derive_basis_series` / `persist_basis_series` calls. Ship `SfoxAdapter` (compute_metrics fail-loud) + registry entry + `scripts/sfox_ground_truth.py` (P115-independent oracle: `usd_value`-derived series validated against transactions' running `account_balance` + typed cashflows). Live prod parity is founder-gated on 121; a fixture/skipIf parity test carries CI.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Reconstruction shape — mirror the deribit broker-dailies ONE-path.** `SfoxAdapter` mirrors `DeribitAdapter`: a broker-dailies adapter whose `compute_metrics` FAILS LOUD. Daily returns derive from the balance-history `usd_value` series fed into `derive_basis_series` (the ONE backbone). No parallel metrics path, no sfox-special derive chain; scalars/charts/coverage all derive from the same dailies.
- **Cashflow separation.** Use `/v1/account/transactions` typed Deposit/Withdraw rows (with running `account_balance`) as the cashflow axis so daily RETURNS are cashflow-neutral (TWR/Dietz), never contaminated by deposits (perf-curve ≠ equity-curve — v1.11 carry-forward).
- **Ground-truth parity (SFOX-06) — P115-compliant, independent oracle.** Reuse the `scripts/deribit_ground_truth.py` pattern: anchor-consistency between the reconstructed curve and the account's own ground truth. The parity oracle MUST be economically independent — validate reconstructed dailies against the RAW balance-history `usd_value` anchors + transactions' running `account_balance`, NEVER against the module's own transform. Material divergence FAILS LOUD (raise, no display). The LIVE parity run on a whitelisted prod key is founder-gated (needs a real sFOX key + phase-121 egress); the committed harness + fixture/sandbox parity test carry the code-complete gate.
- **api_verified stamp (SFOX-05).** The reconstructed sfox strategy carries `trust_tier = api_verified` (strongest Phase-111 tier), stamped at the same seam deribit/live-key strategies get theirs. Distinct from `csv_uploaded` / `self_reported`.
- **Degenerate input — fail-loud / no invented data.** Empty account, <10 days of history, non-finite returns → honest empty/gated state using the EXISTING backbone degenerate gates, not a bespoke one. Never synthesize.
- **Register the sfox ingestion adapter** in `services/ingestion/__init__.py` (`_FACTORIES` + `SUPPORTED_SOURCES`) and add `'sfox'` to the ingestion `Source` Literal (`adapter.py`) — resolves the phase-119 deferral (`test_source_literal_excludes_sfox` flips to include; `test_source_literal_and_registry_agree` stays green because registry + Literal land together). Also resolves the phase-119 F2/F7 seams (finalize/process/verify can resolve sfox).

### Claude's Discretion
- Whether the sfox crawl uses single-page reads (119) or adds a bounded multi-page crawl. **IF a crawl is added, it MUST have a hard `asyncio.wait_for` per-crawl timeout** (v1.11 FLIP worker-wedge lesson + FLIPRETRY-01) — a slow/hanging sFOX crawl must NEVER block the worker loop.
- Exact `SfoxAdapter` method bodies + where the balance-history→dailies transform lives.

### Deferred Ideas (OUT OF SCOPE)
- Static-IP egress (121) — the live prod parity run gates on it.
- Add-key wizard sfox card + `api_verified` badge + e2e all roles (122).
- Phase-119 F3 (read-only label honesty) + F6 (mixed-case insert) — founder/122 items.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SFOX-05 | sFOX balances+trades → daily-return series on the ONE unified backbone (`derive_basis_series`), carrying the `api_verified` provenance stamp; degenerate input → honest empty/gated state | The full deribit analog call chain is mapped below (§Architecture Patterns). sFOX plugs `usd_value` into the existing `chain_linked_twr` → `gap_fill_daily_returns` → `derive_basis_series` → `persist_basis_series` path. `api_verified` is auto-stamped at `process_key.py:828` for any non-csv source. Degenerate gates are inherited from `chain_linked_twr` (DQ-01) + `derive_basis_series` (<2 finite rows) + `MIN_ANNUALIZATION_DAYS` (`insufficient_window`). Registration resolves F2/F7. |
| SFOX-06 | Reconstructed equity validated against a live sFOX account ground truth (anchor-consistency / parity); material divergence FAILS LOUD | `scripts/deribit_ground_truth.py` structure mapped (§Ground-Truth Parity). P115-independent oracle design: `usd_value`-derived series vs transactions' running `account_balance` + typed cashflows. Fixture/skipIf parity test carries CI; live prod leg founder-gated on 121. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read sFOX balance-history + transactions | Python worker (`SfoxClient` + a 120 read pull) | — | Worker owns credentials; all exchange reads live here (`sfox_read.py` precedent) |
| Bounded multi-page crawl (depth) | Python worker (new, `asyncio.wait_for`-bounded) | — | Crawl orchestration was explicitly deferred to 120 (119 reads single-page); must not wedge the sequential worker |
| `usd_value` → cashflow-neutral daily TWR returns | Python worker (`combine_sfox_balance_history` in `broker_dailies.py`, wrapping `nav_twr.chain_linked_twr`) | — | Mirrors `combine_native_ledger`; the TWR engine + DQ-01 guards already exist |
| Dailies → scalars/rows/gap_spans (THE backbone) | `services/basis_series.py::derive_basis_series` | — | The ONE funnel; sfox feeds it identically to deribit — NO parallel path |
| Persist the series | `persist_basis_series` → `strategy_analytics_series` | — | Single-row authoritative upsert, identical to deribit MTM/cash |
| `api_verified` trust stamp | `routers/process_key.py:828` (auto for non-csv) | `strategy_verifications.source/trust_tier` | Free once sfox is a valid `Source`; no new stamping code |
| Adapter dispatch registration | `services/ingestion/__init__.py` + `adapter.py` `Source` | — | Resolves 119 deferral + F2/F7 |
| Ground-truth parity oracle | `scripts/sfox_ground_truth.py` (committed one-off) | fixture/skipIf pytest (CI) | P115-independent; live prod leg gated on 121 egress |

## The Deribit Broker-Dailies ONE-Path — traced end-to-end (LOAD-BEARING)

This is the exact chain the planner mirrors. All `[VERIFIED: codebase 2026-07-18]`.

**Entry:** `services/job_worker.py` — the single-key `derive_broker_dailies` path. Venue dispatch at `job_worker.py:2114` (`if venue == "deribit":`), with `binance/okx/bybit` handled by `combine_realized_and_funding` (`:2540-2555`, `:2668`). sFOX gets a NEW `elif venue == "sfox":` branch here.

**Deribit branch (`job_worker.py:2114`–~2400):**
1. `account_state = await fetch_deribit_native_account_state(exchange)` — terminal equity/uPnL anchor from `get_account_summaries` (`:2156`). Empty read → `DeribitTransientReadError` (retryable, never a zero anchor).
2. `native_ledger, _completeness = await build_deribit_native_ledger(exchange, account_state=…, pnl_basis=…)` (`:2208`; impl `deribit_ingest.py:1757`, delegating to `_crawl_deribit_ledger:899` → `paginate_txn_log:366`). Crawls txn-log across scope × currency, count=250, follows `continuation` to null. **Fail-loud crawl guards:** `LedgerTruncatedError` (10028 budget), `LedgerCompletenessError`, `ScopeAuthError`, `CurrencyEnumerationError`.
3. `assert_ledger_complete(_completeness)` (`:2215`; impl `deribit_ingest.py:1940`) — the **D-02 honesty gate**: any expected scope×currency that did not reach `continuation=null` → RAISE. No partial track record is ever written.
4. **C2 equity-vs-activity floor** (`:2222`): materially-funded account + zero return-bearing rows → `_stamp_strategy_analytics_failed` + `DispatchResult(FAILED)` (a broken key / wrong account / mass -32602 must never render as a green-but-empty ledger).
5. `returns, meta = combine_native_ledger(native_ledger, _completeness.indexable_currencies, denominator_config=…)` (`:2251`; impl `broker_dailies.py:173`). This calls `reconstruct_native_nav_and_twr` (rolls NAV backward per currency, chain-links TWR, §5 inception gate inside) → `gap_fill_daily_returns` → **a gap-filled float `pd.Series` on an ascending daily DatetimeIndex** + a meta dict.
6. `_mtm_basis_result = derive_basis_series(returns, benchmark_rets, periods_per_year=…, cumulative_method=…, day_basis=…)` (`job_worker.py:3182`; impl `basis_series.py:181`). **THE ONE backbone.** Takes the already-computed daily-return series and emits `BasisSeriesResult(metrics_json, series_rows, gap_spans, conventions, …)`.
7. `persist_basis_series(supabase, strategy_id, basis=…, result=…)` (`job_worker.py:3296`; impl `basis_series.py:294`) — upserts the `(strategy_id, kind)` row into `strategy_analytics_series`. `result=None` DELETES a stale row (the heal path).

**Critical invariant already coded:** `DeribitAdapter.compute_metrics` (`ingestion/deribit.py:108`) RAISES `NotImplementedError` — returns are ledger-backed, NEVER fill-derived (`process_key` fill metrics would persist a silently-empty/wrong track record — the BYB-02 corruption class). `compute_fingerprint`/`reconstruct_positions` delegate to the shared exchange-agnostic impls (only the RETURNS axis is guarded).

**`derive_basis_series` contract (`basis_series.py:181`) — what it takes and produces:**
- **Takes:** `returns: pd.Series` (ALREADY-COMPUTED daily returns — it does NOT compute returns from equity; the caller does), an optional `benchmark_rets: pd.Series`, and convention kwargs (`periods_per_year`, `cumulative_method`, `day_basis`, optional `benchmark_symbol`/`scalar_returns`/`densify_policy`).
- **Produces:** `BasisSeriesResult`: `metrics_json` (scalar cache derived FROM the sparse rows), `series_rows` (sparse honest `[{date, return}]`, NaN/±Inf ABSENT, 0.0 kept), `gap_spans` (coverage mask), `conventions` echo.
- **Degenerate gate:** raises `ValueError` if `<2` finite rows survive `_drop_nonfinite` (`basis_series.py:225`).

## The sFOX Mirror — how each tier maps

| Deribit tier | sFOX equivalent | Why simpler |
|--------------|-----------------|-------------|
| `fetch_deribit_native_account_state` (terminal anchor) | first/last balance-history `usd_value` point | sFOX gives the equity series directly — no terminal-anchor backward roll |
| `build_deribit_native_ledger` + `paginate_txn_log` crawl (txn-log → NativeLedger) | `SfoxClient.get_balance_history()` (daily `usd_value`) + `get_transactions()` (flows), bounded crawl | sFOX serves a pre-computed daily `usd_value` series; NO per-currency pricing / NAV reconstruction |
| `assert_ledger_complete` (D-02 gate) | a balance-history **span/coverage gate** (did the crawl reach the requested `start_date`? are there interior holes?) — 120 designs the analog | sFOX gives one clean series; the honesty gate is span-coverage, not scope×currency reconciliation |
| C2 equity-vs-activity floor | material `usd_value` present + <2 usable return days → fail-loud (same posture) | analog floor: funded account with no interpretable history is not "insufficient" |
| `combine_native_ledger` → `reconstruct_native_nav_and_twr` → `chain_linked_twr` | **`combine_sfox_balance_history` → `chain_linked_twr` DIRECTLY** | sFOX HAS the NAV; it skips `reconstruct_native_nav_and_twr` and calls `chain_linked_twr(nav=usd_value, …)` straight |
| `derive_basis_series` | `derive_basis_series` — **IDENTICAL** | the ONE backbone; no change |
| `persist_basis_series` | `persist_basis_series` — **IDENTICAL** | single-row upsert |
| `DeribitAdapter.compute_metrics` fail-loud | `SfoxAdapter.compute_metrics` fail-loud — **IDENTICAL posture** | returns come from the broker-dailies path, never fills |

**The TWR primitive is already built (`nav_twr.py:351`, `chain_linked_twr`):**
`r_t = (NAV_t − NAV_{t-1} − F_t) / NAV_{t-1}` — the external flow F sits in the NUMERATOR (end-of-day convention), never the base → **deposits/withdrawals do not count as return** (this IS the perf-curve ≠ equity-curve separation, already coded). It carries the full DQ-01 guard set (`_guard_denominator:437`): `negative_nav_guard`, `dust_nav_guard` (`< DUST_NAV_FLOOR`), `flow_dominated_guard` (`|flow| >= FLOW_DOM_RATIO·prev`), plus the `pnl_dominated_guard`. Broken days become NaN → dropped by `_drop_nonfinite` inside `derive_basis_series`. **sFOX inherits every one of these guards for free.**

- For sFOX, `nav` = the `usd_value` series; `flows_by_day` = signed deposits/withdrawals from `get_transactions()`; pass `prev0=nav.iloc[0]` (App A #2 additive kwarg) so day-0 uses the first balance-history point as inception capital rather than reconstructing pre-history. `daily_pnl` is only consulted for `iloc[0]` when `prev0 is None` and for a display-only path; sFOX can pass `nav.diff()` (implied pnl) or a zeros series — **flag the exact day-0 convention as a red-team decision (see Open Questions Q1).**

## Standard Stack

**No new packages.** `aiohttp` (already vendored; `SfoxClient`), `pandas` (already used throughout `nav_twr`/`basis_series`/`broker_dailies`), `pytest` (analytics-service test framework). All existing.

| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| `aiohttp` | vendored | `SfoxClient` reads | 118/119 precedent; `[VERIFIED: codebase]` |
| `pandas` | vendored | daily-return Series / TWR / backbone | the entire dailies path is pandas `[VERIFIED: codebase]` |

**Verification:** no `npm view` / `pip index` needed — zero new dependencies. `[VERIFIED: codebase — no install line in this phase]`

## Package Legitimacy Audit

No external packages are installed by this phase. slopcheck not run — **no new package surface to audit.**

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — reuse `aiohttp`/`pandas`/`pytest`) | — | No new install |

## Architecture Patterns

### System Architecture Diagram

```
 worker: derive_broker_dailies (job_worker.py)
        venue dispatch (job_worker.py:2114)
   ┌──────────────┬───────────────┬──────────────── NEW ────────────────┐
   │ binance/okx/ │  deribit      │  sfox (this phase)                   │
   │ bybit        │  :2114        │                                      │
   │ combine_     │  build_native │  SfoxClient.get_balance_history()  ──┐
   │ realized_&_  │  _ledger →    │    → daily usd_value series (NAV)    │
   │ funding      │  combine_     │  SfoxClient.get_transactions()      ─┤ bounded by
   │              │  native_ledger│    → deposits/withdrawals (flows)    │ asyncio.wait_for
   └──────┬───────┴──────┬────────┤  [span/coverage gate + material-     │ (FLIPRETRY-01)
          │              │        │   balance floor: fail loud]          │
          │              │        │  combine_sfox_balance_history() ─────┘
          │              │        │    chain_linked_twr(nav=usd_value,
          │              │        │      flows_by_day, prev0=nav[0])
          │              │        │    → gap_fill_daily_returns
          │              │        │    returns: pd.Series (cashflow-
          │              │        │      neutral TWR; DQ-01 guards)
          ▼              ▼        ▼
        returns (pd.Series) ─────────────► derive_basis_series(returns, …)   [THE ONE BACKBONE]
                                              → BasisSeriesResult
                                              → persist_basis_series → strategy_analytics_series
                                           trust_tier = api_verified  (process_key.py:828, auto)
```

### Pattern 1: `SfoxAdapter` mirrors `DeribitAdapter` (compute_metrics fail-loud)
**What:** a 5-method `IngestionAdapter` whose `compute_metrics` RAISES.
**Example (mirror `ingestion/deribit.py:108`):**
```python
# Source: services/ingestion/deribit.py:108 (DeribitAdapter.compute_metrics) [VERIFIED: codebase]
def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
    raise NotImplementedError(
        "SfoxAdapter.compute_metrics is intentionally fail-loud: sFOX returns "
        "come from the balance-history usd_value series via the broker-dailies "
        "ONE-path (chain_linked_twr → derive_basis_series), never from fill metrics."
    )
```
`validate` reuses the 119 non-ccxt validate branch (`routers/exchange.py::_validate_sfox_key` → `SfoxClient.get_balances()`; structural `read_only=True`). `fetch_raw`/`compute_fingerprint`/`reconstruct_positions` — decide per deribit precedent: deribit's `fetch_raw` returns normalized fills and fingerprint/positions delegate to shared impls. For sFOX (spot, no fill-based track record needed), `fetch_raw` may return `[]`/trades and the RETURNS axis is owned entirely by the broker-dailies branch. **This is discretion; the LOAD-BEARING requirement is only that `compute_metrics` fails loud.**

### Pattern 2: `combine_sfox_balance_history` mirrors `combine_native_ledger`
**What:** a new function in `services/broker_dailies.py`, sibling to `combine_native_ledger:173` and `combine_realized_and_funding:140`.
```python
# NEW, mirrors services/broker_dailies.py:173 combine_native_ledger
def combine_sfox_balance_history(
    usd_value: pd.Series,          # sFOX balance-history NAV (equity) series
    flows_by_day: pd.Series,       # signed deposits(+)/withdrawals(-) from transactions
) -> tuple[pd.Series, dict[str, Any]]:
    returns, flags = chain_linked_twr(
        nav=usd_value,
        daily_pnl=usd_value.diff().fillna(0.0),   # implied; only iloc[0] matters, prev0 overrides
        flows_by_day=flows_by_day,
        prev0=float(usd_value.iloc[0]),            # first balance-history point = inception capital
    )
    returns = gap_fill_daily_returns(returns)      # same shape contract as the other combiners
    meta = _build_nav_meta(flags)                  # nav_twr.py:529 — carries DQ-01 flags
    return returns, dict(meta)
```

### Anti-Patterns to Avoid
- **A second/parallel metrics path for sfox.** Everything funnels through `derive_basis_series`. `compute_metrics` fail-loud enforces this.
- **Treating `usd_value` as the returns series.** `usd_value` is the EQUITY curve ($, steps on deposits); the RETURN series must be cashflow-neutral via `chain_linked_twr` (F in the numerator). Displaying `usd_value.pct_change()` would book deposits as return.
- **Reconstructing NAV for sFOX.** Do NOT call `reconstruct_native_nav_and_twr`/`reconstruct_nav` — sFOX already gives NAV; use `chain_linked_twr` directly.
- **Unbounded balance-history/transactions crawl on the worker loop.** Wrap each crawl in `asyncio.wait_for` (FLIPRETRY-01) — see §Crawl Safety.
- **A parity oracle that consumes `usd_value` (P115).** The oracle must reconstruct independently from transactions' running `account_balance` + typed cashflows.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Cashflow-neutral daily TWR from an equity series | A bespoke sfox TWR loop | `nav_twr.chain_linked_twr` (`:351`) | Already computes `r_t=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1}` with the full DQ-01 guard set |
| Scalars/rows/coverage from dailies | A sfox derive chain | `basis_series.derive_basis_series` (`:181`) | THE ONE backbone; anti-divergence guard is by-construction |
| DQ guards (dust/negative/flow-dominated NAV) | New sfox guards | Inherited from `chain_linked_twr` / `_guard_denominator` (`:437`) | Free by routing through the primitive |
| `api_verified` stamping | New sfox stamp code | `process_key.py:828` (`csv → csv_uploaded, else → api_verified`) | Automatic for any non-csv source |
| Read-only assertion | New probe | 119 structural guard (`is_sfox` validate branch + `read_sfox_account` isinstance gate) | sFOX has no scope endpoint; read-only is STRUCTURAL |
| Bounded session teardown | New close logic | `SfoxClient.aclose()` (bounded `asyncio.wait_for`, `:347`) | Already handles the hung-close wedge |

**Key insight:** sFOX's `balance/history` endpoint collapses the hard half of broker-dailies (per-asset historical pricing → NAV) into a single read. The phase is *validation/stitching + a TWR pass through existing primitives*, not new valuation math.

## Ground-Truth Parity (SFOX-06) — mirror `scripts/deribit_ground_truth.py`

**Harness structure to mirror (`scripts/deribit_ground_truth.py`, 1036 lines) `[VERIFIED: codebase]`:**
- A committed one-off (`python -m scripts.sfox_ground_truth`), credentials via env only (never a tracked file), runs from the prod egress (121).
- Read-only proven BEFORE any fetch (deribit: `scope_is_read_only` / `ScopeViolationError` exit code 2). For sFOX, read-only is structural (`SfoxClient` GET-only) — assert the isinstance/structural guard.
- Fully-paginated reads of whitelisted fields only → a single SANITIZED JSON to stdout. `sanitize_evidence` (`:359`) + `assert_sanitized` (`:390`) re-walk the payload and RAISE on any unmasked email/token/deny-key. **Never prints the Bearer token** (`_redact_secret_values:63`, `scrub_freeform_string`).
- Exit codes: 0 success / 2 scope violation / 3 missing creds / 1 other (scrubbed to stderr).

**P115-independent oracle design (the load-bearing part):**
- **Series under test (canonical):** the `usd_value`-derived daily returns (via `combine_sfox_balance_history`), re-cumulated into an equity curve.
- **Independent oracle:** reconstruct an equity/return path from `/v1/account/transactions` **running `account_balance`** + typed Deposit/Withdraw/Buy/Sell cashflows — a stream sFOX computes independently of `balance/history`'s `usd_value`. Check **anchor-consistency at cashflow events** and **cumulative reconciliation** across the window. A material divergence → RAISE (the wrong curve is never displayed).
- ⚠️ **Open (Q2 below):** whether `account_balance` is a USD *cash* running balance vs total portfolio MTM determines exactly how it anchors against `usd_value` (they reconcile at cashflow events but are different economic quantities day-to-day). Resolve empirically from the ground-truth evidence capture — this is the phase-118 A1/Q2 carry-forward and needs real account data.

**Gating:** the LIVE parity run on a whitelisted prod key is **founder-gated on phase-121 egress**. A **fixture/sandbox parity test** (skipIf no key, mirroring `test_sfox_client_live.py`) carries the code-complete CI gate — never a faked pass.

## Registration + F2/F7 Resolution — exactly what to add where

1. `services/ingestion/adapter.py:40` — `Source = Literal["okx","binance","bybit","csv","deribit","sfox"]` (add `"sfox"`).
2. `services/ingestion/__init__.py:98` — `SUPPORTED_SOURCES = ("okx","binance","bybit","csv","deribit","sfox")`.
3. `services/ingestion/__init__.py` — add `_make_sfox_adapter()` (lazy import `SfoxAdapter`) + `_FACTORIES["sfox"] = _make_sfox_adapter` (`:151`).
4. **Flip the two parity tests together** so both stay green (they assert `set(get_args(Source)) == set(SUPPORTED_SOURCES)`):
   - `tests/test_ingestion_deribit.py:262` `test_source_literal_and_registry_agree` — expected set now includes `"sfox"`.
   - `tests/test_ingestion_protocol.py:198` `test_literal_types` (`:211`) — expected set `{"okx","binance","bybit","csv","deribit","sfox"}`.
   Landing Literal + registry TOGETHER is why parity holds (the 119 deferral was exactly the Literal-without-registry split).
5. **F2/F7 (from 119 deferred-items.md):** once `get_adapter("sfox")` resolves AND the worker `derive_broker_dailies` has an sfox branch, `finalize-wizard`/`process_key`/`verify` can resolve sfox. The `process_key.py` `source: Source` Literal now admits sfox (no longer a 422). **Interim honesty (per 119 F2):** until the wizard offers sfox (122), a finalize path that cannot yet run (e.g. needs 121 egress for a real key) must return an honest "sFOX not yet available" rejection, NOT a misleading KEY_NETWORK_TIMEOUT. Do NOT ship a sfox wizard card before finalize works.

**api_verified (SFOX-05) — no new code:** `routers/process_key.py:828` — `trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"`. sfox is non-csv → `api_verified` automatically, stamped into the `strategy_verifications` draft (`:837`) and the response (`:1163`). The `strategy_verifications.source` CHECK already admits `'sfox'` (widened in 119, migration `20260718182056`). `[VERIFIED: codebase + STATE.md]`

## Degenerate Gates — inherited, not bespoke

| Gate | Source | sFOX gets it via |
|------|--------|------------------|
| `<2` finite daily returns → `ValueError` | `basis_series.py:225` | routing returns through `derive_basis_series` |
| dust / negative / flow-dominated / pnl-dominated NAV → NaN break | `nav_twr._guard_denominator:437` + `chain_linked_twr:428` | routing through `chain_linked_twr` |
| non-finite returns dropped from persisted rows | `_drop_nonfinite` inside `derive_basis_series` | free |
| `<MIN_ANNUALIZATION_DAYS` → `insufficient_window` flag | `metrics.py:59,627,698` (via `compute_all_metrics`) | free (this is the "<10 days" honest-gate analog) |
| material balance + zero interpretable history → fail loud | deribit C2 floor (`job_worker.py:2222`) | **120 adds the sfox analog** (usd_value present + <2 usable return days) |
| empty account → honest empties | `read_sfox_account` fail-loud, no fabricated rows | 119 precedent |

**Only one new gate is bespoke:** the balance-history **span/coverage gate** (did the crawl reach the requested `start_date`; are there interior holes that should surface as `gap_spans` vs indicate an under-fetch?) — the sfox analog of `assert_ledger_complete`. Design it fail-loud on a truncated/under-fetched crawl, and let genuine interior gaps flow through as honest `gap_spans` (never 0.0-bridged).

## Crawl Safety (FLIPRETRY-01 / v1.11 worker-wedge)

`SfoxClient` already has: a per-endpoint rate gate (`_rate_gate:151`, transactions 1-req/10s) and a bounded idempotent `aclose` (`:347`, `asyncio.wait_for(SFOX_CLOSE_TIMEOUT_S)`). What 120 ADDS is the crawl loop over `get_balance_history()` / `get_transactions()` (119 reads single-page; `read_sfox_account` does NOT yet call `get_balance_history`).

**Where the timeout wraps:** each crawl (the balance-history depth crawl and the transactions cashflow crawl) must be wrapped in `asyncio.wait_for(...)` at the `derive_broker_dailies` sfox branch — the same place deribit's full-history crawl runs under the outer 15-min budget. The v1.11 rollback root cause was a slow/hanging live crawl blocking the sequential worker's event loop → healthz stale → no auto-restart (STATE.md `:54`). A hard per-crawl `asyncio.wait_for` converts a hang into a classified transient failure (retry/fail) instead of a wedge. **A bounded backfill should ideally run off the sequential worker** (FLIPRETRY-01/02 discipline), but at minimum every crawl on the shared loop MUST be `wait_for`-bounded. `[VERIFIED: codebase + STATE.md carry-forward]`

## Runtime State Inventory

Not a rename/refactor — greenfield ingestion capability. The only cross-runtime state:
- **Stored data:** a new `strategy_analytics_series` row (kind derived from basis) per ingested sfox strategy — written by `persist_basis_series`, same as deribit. **None to migrate.**
- **DB constraints:** `strategy_verifications.source` / `strategies.source` / `api_keys.exchange` / `compute_jobs.exchange` already admit `'sfox'` (widened in 119, migration `20260718182056`, MCP-applied+verified on TEST). **None new in 120.** `[VERIFIED: STATE.md]`
- **Live service config / OS-registered state / secrets:** none introduced by 120. The Fly.io egress IP the founder whitelists at sFOX is phase 121. **None — verified by scope.**
- **Build artifacts:** none.

## Common Pitfalls

### Pitfall 1: Booking deposits as return
**What goes wrong:** using `usd_value.pct_change()` counts a deposit day as a huge positive return.
**Avoid:** `chain_linked_twr` puts F in the numerator (`r_t=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1}`). Feed real `flows_by_day` from typed transactions. **Warning sign:** a return spike exactly on a deposit date.

### Pitfall 2: A parity oracle that isn't independent (P115)
**What goes wrong:** validating the `usd_value`-derived series against a reconstruction that itself consumes `usd_value` → trivially passes.
**Avoid:** oracle reconstructs from transactions' running `account_balance` + typed cashflows, independent of `balance/history`. **Warning sign:** the oracle imports/reads `usd_value`.

### Pitfall 3: Unbounded crawl wedging the worker
**What goes wrong:** a slow multi-page balance-history/transactions crawl on the sequential worker blocks the loop → healthz stale, no restart (the exact v1.11 FLIP failure).
**Avoid:** `asyncio.wait_for` per crawl; prefer off-loop backfill. **Warning sign:** rising healthz age during an sfox ingest.

### Pitfall 4: Silent under-fetch rendered as complete
**What goes wrong:** a truncated balance-history crawl (rate-limit / short page) looks like a complete-but-short series.
**Avoid:** a span/coverage gate (deribit `assert_ledger_complete` analog) that fails loud when the crawl did not reach the requested `start_date`. **Warning sign:** history that stops suspiciously at a page boundary.

### Pitfall 5: Shipping a wizard card before finalize resolves sfox (F2)
**What goes wrong:** 122 UI offers sfox but finalize 502s with a misleading KEY_NETWORK_TIMEOUT.
**Avoid:** 120 makes finalize/process resolve sfox (or return an honest "not yet available"); the card is 122. **Warning sign:** a sfox connect attempt returning a network-timeout copy.

## State of the Art

| Old approach | Current approach | Impact |
|--------------|------------------|--------|
| Reconstruct equity from trades + historical price marks (deribit-style NAV backward-roll) | Consume sFOX's pre-computed `usd_value` daily series, TWR-pass it through `chain_linked_twr` | sFOX is the simplest broker-dailies path — no pricing engine, no ledger completeness reconciliation, just a span/coverage gate + a TWR pass |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `balance/history` + `transactions` reach account inception (docs silent on max range) | Crawl / gates | If depth is capped, early-history reconstruction needs trade-replay backfill; changes crawl/backfill design, not correctness. Resolve empirically in the ground-truth run. `[ASSUMED — carried from 118 A1]` |
| A2 | Transactions' running `account_balance` is economically independent of `balance/history` `usd_value` (valid P115 oracle) | Ground-truth parity | If `account_balance` is derived from the same valuation as `usd_value`, the oracle is not independent — must fall back to a trades-based reconstruction. Resolve from ground-truth evidence. `[ASSUMED]` |
| A3 | Day-0 return convention: `prev0 = usd_value.iloc[0]` (first balance-history point = inception capital), returns begin day 1 | `combine_sfox_balance_history` | A different inception convention shifts the first return / early CAGR window. Red-team decision on live data. `[ASSUMED]` |
| A4 | sfox needs no new `strategies.source`/`strategy_verifications.source` CHECK widen (119 covered it) | Registration | If a value-space is missing, finalize INSERT 23514s. Confirm by running the zod↔DB parity test. `[VERIFIED: STATE.md migration 20260718182056]` — low risk |

## Open Questions

1. **Day-0 / inception convention for `chain_linked_twr` on a directly-supplied NAV series.** `chain_linked_twr` was built to consume a *reconstructed* NAV (deribit) where day-0 prev is the pre-history capital. sFOX supplies real NAV from day 0. Recommendation: pass `prev0=usd_value.iloc[0]` and start returns at day 1 (day-0 is the anchor, not a return); verify against the ground-truth curve. Decide in red team on live data.
2. **`account_balance` semantics (USD cash vs total portfolio MTM).** Determines the exact anchor-consistency check in the parity oracle. Resolve empirically from the `sfox_ground_truth.py` evidence capture (needs a real account — founder-gated). This is the 118 Q2 carry-forward.
3. **Historical depth of `balance/history`.** Resolve by requesting `start_date` far in the past and observing the earliest returned point during the ground-truth run.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `SfoxClient` (118) | reads | ✓ | `services/sfox_client.py` | — |
| `read_sfox_account` (119) | read pull | ✓ (but lacks balance_history — 120 adds) | `services/sfox_read.py` | 120 extends |
| `chain_linked_twr` / `nav_twr` | TWR | ✓ | `services/nav_twr.py:351` | — |
| `derive_basis_series` / `persist_basis_series` | backbone | ✓ | `services/basis_series.py:181/294` | — |
| `process_key.py:828` api_verified stamp | trust tier | ✓ | — | — |
| sFOX **sandbox key** | fixture/live parity leg | ✗ (founder mints at beta.sfox.com) | — | skipIf-gate → CI green; committed harness carries |
| sFOX **prod key** + Fly.io static IP | LIVE ground-truth parity (SFOX-06 live leg) | ✗ | — | **founder-gated on phase 121**; fixture parity carries code-complete |
| `aiohttp` / `pandas` / `pytest` | all | ✓ | vendored | — |

**Missing with fallback:** sandbox/prod sFOX key → parity live leg is founder-gated (121); the committed harness + fixture/skipIf parity test carry the phase. Code must not fake a pass.

## Validation Architecture

**nyquist_validation:** enabled (no `workflow.nyquist_validation:false`). SFOX-05's central claim — "sfox dailies flow through the ONE backbone and carry `api_verified`" — is validated by unit tests on the transform + registration; SFOX-06's — "reconstruction agrees with ground truth or fails loud" — by a fixture parity test in CI + a founder-gated live leg.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), async via existing setup |
| Config | `analytics-service/` pytest config (existing); `--cov-fail-under=80` gate |
| Quick run | `pytest analytics-service/tests/test_sfox_dailies.py -x` |
| Full suite | `pytest --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | Exists? |
|-----|----------|-----------|-------------------|---------|
| SFOX-05 | `combine_sfox_balance_history`: usd_value+flows → cashflow-neutral TWR (deposit day ≠ return); DQ-01 guards fire | unit (fixtures) | `pytest tests/test_sfox_dailies.py -x` | ❌ Wave 0 |
| SFOX-05 | Registration parity: `Source` Literal == `SUPPORTED_SOURCES` incl sfox; `get_adapter("sfox")` resolves | unit | `pytest tests/test_ingestion_deribit.py::test_source_literal_and_registry_agree tests/test_ingestion_protocol.py::test_literal_types -x` | ⚠️ flip existing |
| SFOX-05 | `SfoxAdapter.compute_metrics` raises (fail-loud) | unit | `pytest tests/test_ingestion_sfox.py -x` | ❌ Wave 0 |
| SFOX-05 | `api_verified` stamped for source='sfox' | unit | `pytest tests/test_process_key*.py -k trust_tier -x` | ⚠️ extend |
| SFOX-05 | Degenerate: <2 usable days / material-balance-zero-history → fail-loud/gated, no invented data | unit | `pytest tests/test_sfox_dailies.py -k degenerate -x` | ❌ Wave 0 |
| SFOX-06 | Fixture parity: usd_value-derived series vs independent account_balance/cashflow oracle; material divergence raises | unit (fixture) | `pytest tests/test_sfox_ground_truth.py -x` | ❌ Wave 0 |
| SFOX-06 | LIVE parity on whitelisted prod key | live, skipIf(no key) | `SFOX_*_KEY=… python -m scripts.sfox_ground_truth` | ❌ founder-gated on 121 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_sfox_dailies.py tests/test_ingestion_sfox.py -x` (offline, always CI).
- **Per wave merge:** full analytics-service suite (`--cov-fail-under=80`).
- **Phase gate:** offline suite green in CI; the LIVE ground-truth parity is the empirical SFOX-06 gate but is **founder-credential + phase-121-egress gated** — skip keeps CI green, a skip is NOT a pass, and the code must never fabricate a green.

### Wave 0 Gaps
- [ ] `services/broker_dailies.py::combine_sfox_balance_history` — the usd_value+flows→TWR transform (+ unit tests `tests/test_sfox_dailies.py`)
- [ ] `services/ingestion/sfox.py::SfoxAdapter` — 5-method adapter, compute_metrics fail-loud (+ `tests/test_ingestion_sfox.py`)
- [ ] registry + Source Literal edits + the two parity-test flips
- [ ] `job_worker.derive_broker_dailies` sfox branch (read + bounded crawl + span gate + material floor + derive/persist)
- [ ] `services/sfox_read.py` extension to include `get_balance_history` (+ the bounded crawl)
- [ ] `scripts/sfox_ground_truth.py` + `tests/test_sfox_ground_truth.py` (fixture parity, P115-independent oracle)

## Security Domain

**security_enforcement:** enabled (absent = enabled).

### Applicable ASVS Categories
| Category | Applies | Standard control |
|----------|---------|------------------|
| V2 Authentication | yes | Bearer token via encrypted `api_keys`; reuse existing encryption (no hand-roll) |
| V4 Access Control | yes | Read-only STRUCTURAL (`SfoxClient` GET-only; isinstance guard at the ingestion boundary — 119); no order/withdraw surface exists |
| V5 Input Validation | yes | Parse sFOX JSON fail-loud (`_unwrap_data` raises on missing `data` envelope); no invented data on degenerate input |
| V6 Cryptography | no (reuse) | Existing `api_keys` encryption path |
| V7 Logging | yes | Scrub token before logging (`scrub_freeform_string`); the ground-truth harness `sanitize_evidence`/`assert_sanitized` re-walk + RAISE on any unmasked token/email |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Bearer token leak in logs/evidence JSON | Info disclosure | `scrub_freeform_string` + `assert_sanitized` (deribit harness precedent); never log `Authorization` |
| Silently-partial ledger rendered as a complete track record | Tampering (data integrity) | span/coverage gate fails loud (deribit `assert_ledger_complete` analog); material-balance-zero-history floor |
| Booking a deposit as return (economic corruption) | Tampering | `chain_linked_twr` flow-in-numerator; typed-cashflow separation |
| Crawl wedges the sequential worker | DoS (self-inflicted) | `asyncio.wait_for` per crawl (FLIPRETRY-01) |

## Sources

### Primary (HIGH — codebase, verified 2026-07-18)
- `services/ingestion/deribit.py` — DeribitAdapter, compute_metrics fail-loud (`:108`)
- `services/ingestion/__init__.py` — `SUPPORTED_SOURCES` (`:98`), `_FACTORIES` (`:151`), `get_adapter`
- `services/ingestion/adapter.py` — `Source` Literal (`:40`), `TrustTier` (`:41`), dataclasses
- `services/deribit_ingest.py` — the crawl/ledger ONE-path plumbing (`_crawl_deribit_ledger:899`, `paginate_txn_log:366`, `build_deribit_native_ledger:1757`, `assert_ledger_complete:1940`)
- `services/basis_series.py` — `derive_basis_series:181`, `persist_basis_series:294`
- `services/nav_twr.py` — `chain_linked_twr:351`, `reconstruct_nav:320`, `_guard_denominator:437`, `_build_nav_meta:529`
- `services/broker_dailies.py` — `combine_realized_and_funding:140`, `combine_native_ledger:173`, `gap_fill_daily_returns:123`
- `services/job_worker.py` — `derive_broker_dailies` venue dispatch (`:2114` deribit branch; `:2251` combine; `:3182` derive_basis_series; `:3296` persist)
- `routers/process_key.py` — `trust_tier` stamp (`:828`, `:837`, `:1163`)
- `services/sfox_client.py` — `get_balance_history:313`, `get_transactions:268`, `aclose:347`, `_rate_gate:151`
- `services/sfox_read.py` — `read_sfox_account` (single-page, no balance_history yet)
- `scripts/deribit_ground_truth.py` — harness structure (`sanitize_evidence:359`, `assert_sanitized:390`, exit codes)
- `tests/test_ingestion_deribit.py:262`, `tests/test_ingestion_protocol.py:198,211` — the parity tests to flip
- `.planning/phases/119-.../deferred-items.md` — F2/F7 seams; `.planning/STATE.md` — carry-forwards (dailies-canonical, FLIP wedge, P115, migration 20260718182056)
- `.planning/phases/118-.../118-RESEARCH.md` — sFOX endpoint contract, GO verdict, A1/Q2 carry-forwards

### Secondary (MEDIUM)
- docs.sfox.com (via 118 RESEARCH) — `balance/history` daily `usd_value`, `transactions` running `account_balance`, 1-req/10s limit

## Metadata

**Confidence breakdown:**
- Deribit ONE-path trace + sfox mapping: HIGH — every call site read in-repo with line numbers.
- TWR primitive reuse (`chain_linked_twr`): HIGH — signature + guards read directly.
- api_verified auto-stamp: HIGH — `process_key.py:828` read directly.
- Registration + F2/F7: HIGH — tests + deferred-items read directly.
- `account_balance` oracle independence (A2) + inception convention (A3): MEDIUM/LOW — need real account data (founder-gated), flagged.

**Research date:** 2026-07-18
**Valid until:** ~2026-08-17 (codebase-stable; re-verify line numbers if job_worker/basis_series churn before execution)

## RESEARCH COMPLETE

**Phase:** 120 — SFOX Equity reconstruction + backbone
**Confidence:** HIGH

**Reconstruction approach (one paragraph):** sFOX is the *simplest* broker-dailies path because `/v1/account/balance/history` hands us the daily `usd_value` NAV series directly — no ledger reconstruction. The exact deribit-analog call chain is: `job_worker.derive_broker_dailies` venue dispatch (`:2114`, add `elif venue == "sfox":`) → read `SfoxClient.get_balance_history()` (NAV) + `get_transactions()` (flows), each bounded by `asyncio.wait_for` (FLIPRETRY-01) → a span/coverage + material-balance fail-loud gate (the `assert_ledger_complete`/C2 analog) → a NEW `combine_sfox_balance_history(usd_value, flows_by_day)` in `broker_dailies.py` (sibling of `combine_native_ledger:173`) that calls the EXISTING `nav_twr.chain_linked_twr(nav=usd_value, flows_by_day, prev0=usd_value.iloc[0])` (flow-in-numerator → cashflow-neutral TWR, full DQ-01 guard set) → `gap_fill_daily_returns` → the returns `pd.Series` flows through the UNCHANGED `derive_basis_series(returns, …)` (`basis_series.py:181`, THE ONE backbone) → `persist_basis_series` (`:294`). `SfoxAdapter.compute_metrics` fails loud exactly like `DeribitAdapter` (`ingestion/deribit.py:108`); registering sfox in `Source`+`SUPPORTED_SOURCES`+`_FACTORIES` (flipping the two parity tests together) resolves the 119 deferral and F2/F7; `api_verified` is auto-stamped at `process_key.py:828`. SFOX-06 parity mirrors `scripts/deribit_ground_truth.py` with a P115-independent oracle (usd_value-derived series vs transactions' running `account_balance` + typed cashflows), fixture test carrying CI and the live prod leg founder-gated on 121.
