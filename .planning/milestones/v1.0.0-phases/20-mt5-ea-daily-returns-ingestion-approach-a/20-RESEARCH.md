# Phase 20: MT5 EA daily-returns ingestion (Approach A) - Research

**Researched:** 2026-06-14
**Domain:** MQL5 Expert Advisor (financial daily-equity-return export) + existing Python CSV→analytics ingestion contract
**Confidence:** HIGH for the Python ingestion contract (read in-code), MEDIUM-HIGH for MQL5 APIs (cited from official mql5.com docs; the EA's behavior cannot run in CI and is gated on manual T14/T15)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Output contract & format (E1, E7)**
- CSV schema: `date,daily_return`; fractional returns (0.0123 = 1.23%); no `currency` column required.
- Blank/absent currency column validates OK (T8). A `currency=EUR` (non-USD) file HARD-FAILS — USD-only is deliberate, documented (T9).
- Auto-÷100 percent-form detection must NOT misfire on a realistic fractional series — `info_flags == []` for fractional input (T7).

**Flow vs return classification (E4, E5)**
- Deposits/withdrawals are NOT returns: a deposit-day shows the trading return, never a cash spike (T2 — the #1 test); a withdrawal-day return excludes the outflow (T3).
- Swap/commission are costs INCLUDED in the return, not netted as flows (T10).
- CREDIT/CHARGE/CORRECTION balance deals classified per the documented excluded-vs-included table (T11).
- Intraday-flow (deposit at 09:00 then trades) follows the chosen convention; day flagged if approximate (T4 — taste).

**Equity basis & calendar (E2, E3, E8)**
- Daily return tracks total equity INCLUDING floating PnL of overnight open positions, not balance (T6).
- Gap series: rejected OR zero-filled to a dense calendar; volatility computed on the dense calendar (T5).
- DST boundary day yields exactly one row, correct label, no dup/skip (T13).

**Re-upload & restart semantics (E9, A1)**
- Re-upload is full-replace: overlapping/partial re-upload replaces all rows, no stale rows, history not truncated (T12).
- Restart-state: after a terminal kill+relaunch, the next day's return uses the persisted `prior_close_equity`, not a fresh/zero base (T15).

**Security (CI)**
- EA source is read-only: a CI static check greps `tools/mt5/*.mq5` and FAILS on any order/trade mutation API (`OrderSend|CTrade|PositionClose|PositionModify|OrderModify|OrderDelete|trade\.`) (T16).

**Validation gates (must-pass before any KPI is page-visible)**
- T2 (deposit-day), T5 (gap), T14 (manual demo-account reconcile).

### Claude's Discretion
- Exact fixture file naming/layout and Python test-module organization.
- The dense-calendar zero-fill vs reject choice for T5 (within the test strategy's stated options).

### Deferred Ideas (OUT OF SCOPE)
- None. T14/T15 (manual demo-account reconcile + restart-state) are EA-side acceptance steps the user runs on a demo account; they cannot be automated in CI and gate the first live KPI, not this phase's CI completion.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

Tests T1–T16 from `20-TEST-STRATEGY.md` are the authoritative requirement set, mapped 1:1 to Eng findings E1–E9 + A1. Research support for each:

| ID | Behavior | Research Support |
|----|----------|------------------|
| T1 | no-flow steady series → KPIs match hand-computed | `compute_all_metrics` verified: quantstats `qs.stats.{cagr,volatility,sharpe,sortino,calmar,max_drawdown}` (metrics.py:439-448). Mirror `test_metrics_minigolden.py` hand-computed oracle pattern. |
| T2 | deposit-day → trading return, NOT cash spike | Flow-adjusted return formula (see §"The Deposit-Day Bug"). EA-side math; fixture pins the CSV the EA *should* emit. |
| T3 | withdrawal-day → return excludes outflow | Same flow-adjusted formula; withdrawal is negative external flow. |
| T4 | intraday-flow (deposit 09:00 then trades) | Convention choice (see §"Intraday Flow Timing"); day flagged if approximate. |
| T5 | gap series → rejected OR zero-fill dense | **Pipeline does NOT zero-fill or reject gaps** (verified — see Pitfall 2). EA/test side must enforce. Validator only requires strictly-increasing unique dates (csv_validator.py:110-111). |
| T6 | overnight open position → tracks equity incl floating PnL | `AccountInfoDouble(ACCOUNT_EQUITY)` [CITED]. Not ACCOUNT_BALANCE. |
| T7 | realistic fractional series → `info_flags == []` | Auto-÷100 fires only when non-zero median \|x\| ∈ (0.5, 100] AND max \|x\| ≤ 100 (csv_validator.py:310-350). A fractional series (median \|x\| ≪ 0.5) never trips it. |
| T8 | blank-currency file → validates OK | `currency` column is `required=False, nullable=True` (csv_validator.py:141-149). |
| T9 | `currency=EUR` → HARD-FAILS | currency check `.isin(["", "USD"])` (csv_validator.py:144) → fails on EUR with rule `currency_usd_or_blank`. |
| T10 | swap/commission days → included in return | These are equity-reducing deals NOT netted as external flows (see deal table). |
| T11 | CREDIT/CHARGE/CORRECTION → classified per table | ENUM_DEAL_TYPE values [CITED]; see deal-classification table. |
| T12 | re-upload → full-replace, no stale rows | **AT RISK: `persist_csv_daily_returns` is upsert-only, no DELETE of non-overlapping rows** (see Pitfall 1 — the #1 landmine). |
| T13 | DST boundary → exactly one row, no dup/skip | `csv_daily_returns.date` is a `DATE` (migration 20260522111839:38), and validator enforces strictly-increasing unique dates. EA must emit one calendar-date row per day. |
| T14 | manual demo-account reconcile | Not CI. Gates first live KPI. |
| T15 | restart-state test | GlobalVariable persistence gotcha (see §"Persisting prior_close_equity"). File-based persistence recommended over GlobalVariable. |
| T16 | read-only static check | New CI step; mirror `scripts/check-banned-packages.mjs` pattern (ci.yml:284). |
</phase_requirements>

---

## Summary

Phase 20 has two halves that meet at a CSV file. **Half 1 (Python/CI, fully verifiable):** the existing `daily_returns` ingestion contract is mature, hardened, and was read line-by-line for this research. The EA must emit a `date,daily_return` CSV that `csv_validator.validate_csv(raw_bytes, fmt="daily_returns")` accepts; that envelope's `daily_returns_series` flows to `persist_csv_daily_returns` → `csv_daily_returns` table → `run_csv_strategy_analytics` → `compute_all_metrics` (quantstats Sharpe/vol/CAGR/maxDD). Golden CSV fixtures asserted through this exact pipeline (T1–T13) are the load-bearing CI tests, mirroring `test_metrics_minigolden.py` (hand-computed oracle) and `test_csv_validator.py`. **Half 2 (MQL5/Wine, NOT CI-verifiable):** the EA's daily-equity-return math, balance-deal classification, snapshot timing, and restart persistence run under Wine with no harness — validated only by the manual demo reconcile (T14/T15).

Three findings dominate planning. **(1) T12 is at architectural risk and is the single most important landmine.** The production re-upload path is **upsert-only** (`ON CONFLICT (strategy_id, date) DO UPDATE`, migration 20260522111839:179) — there is **no DELETE of rows whose dates are absent from the new upload** anywhere in production code (the only `DELETE FROM csv_daily_returns` in the repo is in a test's cleanup helper). A partial re-upload therefore leaves stale older/non-overlapping dates in the table; T12's "no stale rows" requirement is not satisfiable by the existing pipeline without either a code change or a contract that re-uploads are always full-history. **(2) The pipeline does NOT zero-fill or reject gaps** — `compute_all_metrics` simply computes over whatever dates are present (NaN policy: fillna(0) for chart continuity, NaN-dropped for scalars), so T5's "dense calendar" must be enforced by the EA's output and pinned by the fixture, not assumed from the pipeline. **(3) MQL5 GlobalVariables do not reliably survive an unexpected kill** — they are disk-flushed periodically and on clean shutdown but a crash can lose unflushed state, so `prior_close_equity` (A1/T15) should persist to a file in the `MQL5\Files` sandbox, not (only) a GlobalVariable.

**Primary recommendation:** Plan the Python/fixtures/CI half with full confidence against the verified contract; treat the MQL5 half as a spec-the-output + pin-the-contract + manual-reconcile exercise (per the test strategy). Before any task touches it, the planner must decide T12's resolution: either (a) add a small DELETE-then-insert "replace" RPC/path, or (b) lock the contract to "re-upload replaces full history" and add a fixture/test proving stale dates are gone — option (a) is the only one that makes T12 literally true given partial re-uploads.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily total-equity snapshot + flow-adjusted return math | MQL5 EA (client, under Wine) | — | Only the terminal sees ACCOUNT_EQUITY and the deal history; runs entirely client-side. |
| CSV emission to sandbox | MQL5 EA (client filesystem) | — | `MQL5\Files` sandbox via FileOpen/FileWrite. |
| Output-contract enforcement (schema, date format, currency, percent-detection) | Python analytics-service (`csv_validator`) | Next.js route boundary | `validate_csv` is the single gate; route adds NaN/range/future-date guards. |
| Persistence | Postgres (`csv_daily_returns` + `persist_csv_daily_returns` RPC) | — | SECURITY DEFINER RPC, owner-scoped, upsert. |
| KPI computation (Sharpe/vol/CAGR/maxDD) | Python analytics-service (`run_csv_strategy_analytics` → `compute_all_metrics`) | quantstats | Reuses exchange-path metrics; CSV path skips fills/positions. |
| Golden-fixture + KPI assertion tests | Python pytest suite (`analytics-service/tests/`) | — | The CI-verifiable half (T1–T13). |
| Read-only security static check | CI (GitHub Actions, new step) | — | grep over `tools/mt5/*.mq5` (T16). |
| Manual acceptance reconcile | Human on a demo MT5 account | — | T14/T15 — not automatable. |

## Standard Stack

This phase introduces **no new runtime libraries**. It reuses the existing analytics-service stack and adds source files only.

### Core (existing, reused — verified in-code)
| Library / Asset | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pandera` | per requirements.txt | CSV row-schema validation in `csv_validator.SCHEMAS["daily_returns"]` | Already the project's validator; the contract the EA must satisfy. |
| `pandas` | per requirements.txt | Series construction + date handling | Used throughout `compute_all_metrics`. |
| `quantstats` (`qs`) | per requirements.txt | Sharpe/vol/CAGR/Sortino/Calmar/maxDD | The KPI oracle (`qs.stats.*`, metrics.py:439-448). |
| `pytest` + `@vitest`-free Python suite | per requirements-dev.txt | Golden-fixture + KPI assertion tests | `--cov-fail-under=80` gate (ci.yml:747). |

### Supporting (net-new source, NOT packages)
| Asset | Purpose | When |
|---------|---------|------|
| `tools/mt5/*.mq5` | The Expert Advisor source (MQL5). Net-new directory; does not exist yet (verified). | Half 2. |
| Golden CSV fixtures | `date,daily_return` files + expected-KPI JSON, asserted through the Python pipeline. | T1–T13. |
| New pytest module(s) in `analytics-service/tests/` | Drive `validate_csv` + `run_csv_strategy_analytics`/`compute_all_metrics` against fixtures. | T1–T13. |
| New CI step (GitHub Actions) | grep static-check over `tools/mt5/*.mq5`. | T16. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Approach A (reuse CSV pipeline) | New MT5 ingestion code path | OUT OF SCOPE — CONTEXT locks Approach A. Do not propose. |
| GlobalVariable persistence (A1) | File in `MQL5\Files` | File survives crashes more reliably (see Pitfall 3). |
| `date,daily_return` schema | `daily_nav` schema | `daily_nav` would let the pipeline derive returns via `pct_change`, but it CANNOT flow-adjust deposits (a NAV jump from a deposit reads as a return). Locked to `daily_returns`; the EA must flow-adjust before emitting. |

**Installation:** None. No `npm install` / `pip install` introduced. **Banned-package note (CLAUDE.md):** this phase adds zero npm packages; the existing `scripts/check-banned-packages.mjs` CI step (ci.yml:284) is the model to mirror for the T16 static check, not a dependency.

## Package Legitimacy Audit

> Not applicable. Phase 20 installs **no external packages** in any ecosystem. It adds `.mq5` source files, CSV fixtures, Python test modules, and one CI grep step. slopcheck/registry verification is moot — there is nothing to install. (Recorded explicitly per protocol rather than left blank.)

## Architecture Patterns

### System Architecture Diagram

```
[MT5 terminal under Wine]
        │  OnTimer / day-rollover detect (TimeTradeServer)
        ▼
  read ACCOUNT_EQUITY (incl floating PnL)  ──┐
  scan HistoryDeal* for the day's deals       │  classify each deal:
        │                                     │   BALANCE/CREDIT(deposit-like)/CHARGE → EXTERNAL FLOW (exclude)
        ▼                                     │   COMMISSION*/INTEREST/SWAP/CORRECTION → cost (INCLUDE in return)
  net_external_flows for the day  ◄───────────┘
        │
        ▼
  daily_return = (equity_close − net_external_flows − prior_close_equity) / prior_close_equity
        │            (prior_close_equity persisted to MQL5\Files, survives restart)
        ▼
  FileWrite one "YYYY-MM-DD,<fraction>" row  →  MQL5\Files\<strategy>.csv
        │  (user manually retrieves + uploads via the wizard)
        ▼
================ existing pipeline (verified, unchanged) ================
  Next.js csv-validate route → CsvAdapter.validate → csv_validator.validate_csv(fmt="daily_returns")
        │  envelope.daily_returns_series  (auto-÷100 / currency / date-format / sentinel gates)
        ▼
  Next.js csv-finalize route → parseDailyReturnsSeries (range/NaN/future-date/dup guards)
        │  persist_csv_daily_returns RPC  (SECURITY DEFINER, ON CONFLICT DO UPDATE — UPSERT ONLY)
        ▼
  csv_daily_returns table  (PK strategy_id,date — a DATE not a timestamp)
        │  enqueue compute_analytics_from_csv → Python worker
        ▼
  run_csv_strategy_analytics → compute_all_metrics (quantstats Sharpe/vol/CAGR/maxDD)
        ▼
  strategy_analytics row (computation_status='complete', data_quality_flags.csv_source=true)
        ▼
  factsheet / allocator-facing page
```

### The Verified Output Contract (what the EA MUST emit)

All [VERIFIED in code] from `analytics-service/services/csv_validator.py`:

- **Header:** `date,daily_return` (case-insensitive — headers lowercased+stripped at csv_validator.py:686). An optional `currency` column is accepted but **not required** (`required=False, nullable=True`, lines 141-149).
- **`date`:** must be strictly increasing AND unique (`_strictly_increasing`, lines 110-111). **Emit ISO `YYYY-MM-DD`** — the date auto-detector (lines 526-605) short-circuits ISO cleanly (line 548-550) and avoids the day-first/month-first ambiguity rejection. The downstream route hard-requires `^\d{4}-\d{2}-\d{2}$` (csv-finalize route.ts:67).
- **`daily_return`:** float, fractional decimal (0.0123 = 1.23%). Per-row bound `> -100.0` (lines 136-139). Route-boundary ceiling `|daily_return| ≤ 10` i.e. ±1000%/day (route.ts:169-170). Max 5000 rows (csv_validator MAX_INGEST_ROWS=82, route MAX_DAILY_RETURNS_ROWS=66).
- **`currency`:** if present, must be `""` or `"USD"` (case-insensitive); `EUR` → rule `currency_usd_or_blank` hard-fail (lines 144). **T8/T9 verified.**
- **Auto-÷100 trap (T7):** the percent-form normalizer (lines 310-350) divides by 100 **only when** the non-zero median `|x|` is in `(0.5, 100]` **and** max `|x| ≤ 100`. A realistic fractional series has non-zero median `|x| ≪ 0.5`, so it is untouched and `info_flags == []`. **The EA must emit decimals, never percents** — a percent-form file would either auto-normalize (firing an info_flag, failing T7) or hit the dollar-form sentinel.
- **Dollar-form sentinel (lines 241-285):** rejects series whose non-zero median `|x| > 0.5` that don't auto-normalize — protects against raw-PnL uploads.
- **Daily-Sharpe sentinel (lines 223-238):** rejects if daily Sharpe `> 10.0`. A plausible-but-too-good EA series trips this.
- **`info_flags`:** always present (empty array when nothing fired, line 892). T7 asserts `== []`.

### KPI Computation (what gets computed)

`run_csv_strategy_analytics` (analytics_runner.py:1913) loads `csv_daily_returns`, builds a `pd.Series` with a `DatetimeIndex`, and calls `compute_all_metrics(returns, benchmark_rets)`. Verified KPIs (metrics.py:437-448):
- `cumulative_return` / `total_return` = `(1+returns).prod() - 1` (NaN-dropped for the scalar)
- `cagr` = `qs.stats.cagr(returns)`
- `volatility` = `qs.stats.volatility(returns)`
- `sharpe` = `qs.stats.sharpe(returns)`
- `sortino` = `qs.stats.sortino(returns, rf=MAR)`
- `calmar` = `qs.stats.calmar(returns)`
- `max_drawdown` = `qs.stats.max_drawdown(returns)`

**Input-shape preconditions (fail-loud, metrics.py:367-395):** `returns.index` must be a `DatetimeIndex`, dtype must be float, index must be monotonic-increasing. The runner builds these correctly from the table; fixtures fed directly to `compute_all_metrics` in tests must satisfy them too.

### Recommended Project Structure
```
tools/mt5/
  └── <EAName>.mq5                 # the Expert Advisor (net-new)
analytics-service/tests/
  ├── test_mt5_golden_fixtures.py  # T1–T13 driver (mirror test_metrics_minigolden + test_csv_validator)
  └── fixtures/mt5/                # *.csv golden inputs + *.json expected KPIs (naming = Claude's discretion)
.github/workflows/ci.yml
  └── (new step) "MT5 EA read-only static check"  # T16, mirror ci.yml:284 banned-packages pattern
```

### Pattern: Golden-fixture KPI assertion (T1–T13)
**What:** Check a CSV fixture into the repo, feed its bytes to `validate_csv`, then feed the validated series to `compute_all_metrics` (or stand up the runner with a mocked Supabase per `test_csv_analytics_runner.py:_make_supabase_mock`), and assert KPIs against **hand-computed** expected values.
**When:** Every T1–T13 fixture.
**Why hand-computed:** `test_metrics_minigolden.py` exists precisely because the auto-regenerated golden (`regen_golden.py`) shares helpers with the SUT and can bake in a bug silently. First-principles expected values (computed on paper, not Python) are the only defense for a money-path KPI.
```python
# Source pattern: analytics-service/tests/test_metrics_minigolden.py + test_csv_validator.py
def test_deposit_day_shows_trading_return_not_cash_spike():  # T2
    raw = (FIXTURES / "mt5" / "deposit_day.csv").read_bytes()
    env = validate_csv(raw, fmt="daily_returns")
    assert env["ok"] is True
    assert env["info_flags"] == []          # T7-style guard: no auto-÷100
    series = env["daily_returns_series"]
    # The deposit day's return reflects trading only (hand-computed), not the cash jump:
    assert series[DEPOSIT_DAY_INDEX]["daily_return"] == pytest.approx(EXPECTED_TRADING_RETURN, abs=1e-9)
```

### Pattern: Validator-only assertions (T7/T8/T9)
Use `validate_csv` directly and assert on `env["ok"]`, `env["errors"][0]["rule"]`, and `env["info_flags"]`. T9 asserts `ok is False` and a `currency_usd_or_blank` rule; T8 asserts `ok is True` with no currency column.

### Anti-Patterns to Avoid
- **Building a second ingestion path.** OUT OF SCOPE — Approach A reuses the existing pipeline. The only new code is the EA + fixtures + tests + the T16 CI step.
- **Emitting NAV instead of returns.** `daily_nav` would let the pipeline `pct_change`, but a deposit makes NAV jump and reads as a return — it cannot flow-adjust. Locked to `daily_returns`; flow-adjust in the EA.
- **Trusting GlobalVariable persistence alone for `prior_close_equity`.** Use a file (see Pitfall 3).
- **Assuming the pipeline densifies the calendar.** It does not (see Pitfall 2).
- **Assuming re-upload truncates stale rows.** It does not (see Pitfall 1).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV schema validation | A new validator in the EA or a new Python module | `csv_validator.validate_csv(fmt="daily_returns")` | Already enforces date/currency/percent/sentinel rules; the contract is THIS function. |
| Sharpe/vol/CAGR/maxDD | Re-implementing metrics in MQL5 or a new Python helper | `compute_all_metrics` (quantstats) | The verified oracle; fixtures assert against it. |
| Persistence + RLS | A new table or a direct INSERT | `persist_csv_daily_returns` RPC + `csv_daily_returns` | SECURITY DEFINER, owner-scoped, probe-oracle closed. |
| Deal-type classification | String-matching deal comments | `HistoryDealGetInteger(ticket, DEAL_TYPE)` + ENUM_DEAL_TYPE | Comment text is broker-specific and unreliable; the enum is canonical. |
| CSV delimiter handling in MQL5 | Manual string concatenation | `FileOpen(..., FILE_WRITE\|FILE_CSV\|FILE_ANSI, ',')` + FileWrite | FILE_CSV auto-delimits; FILE_ANSI keeps it byte-clean for `utf-8-sig` read. |

**Key insight:** The entire Python/persistence half is already built and hardened. The phase's real new work is (a) correct MQL5 equity/flow math and (b) fixtures that PROVE the contract. Re-implementing any validated component is both wasted effort and a divergence risk.

## Runtime State Inventory

> This is a net-new feature, not a rename/refactor. Most categories are N/A. Included for the persistence-state question that A1/T15 raises on the EA side.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` table already exists (migration 20260522111839). The EA writes to a CSV file in `MQL5\Files`, not directly to any DB. | None — reuse existing table via existing RPC. |
| Live service config | None. The EA runs in the user's MT5 terminal; no service config in this repo. | None. |
| OS-registered state | None in this repo. (On the user's machine, the EA is "attached to a chart" — not OS-registered. The terminal restart behavior is the A1/T15 concern.) | None for the repo. |
| Secrets/env vars | None new. Existing CSV path uses `INTERNAL_API_TOKEN` / Supabase keys (unchanged). | None. |
| Build artifacts | None. `.mq5` is compiled to `.ex5` by MetaEditor on the user's machine; the repo ships source only. | None. |
| **EA-internal restart state (A1/T15)** | `prior_close_equity` must survive a terminal kill+relaunch. GlobalVariables are NOT guaranteed across an unexpected kill (see Pitfall 3). | EA writes `prior_close_equity` to a file in `MQL5\Files` and reloads it in `OnInit`. |

## Common Pitfalls

### Pitfall 1: Re-upload does NOT full-replace — the #1 T12 landmine
**What goes wrong:** A partial/overlapping re-upload (e.g. user re-exports only the last month) leaves the older, non-overlapping dates in `csv_daily_returns`. T12 requires "no stale rows; history not truncated" — the pipeline as built can do neither selectively.
**Why it happens:** `persist_csv_daily_returns` is **upsert-only**: `INSERT ... ON CONFLICT (strategy_id, date) DO UPDATE` (migration 20260522111839:173-181). There is **no DELETE of rows whose dates are absent from `p_rows`** anywhere in production code. The only `DELETE FROM csv_daily_returns` in the repo is in `test_persist_csv_daily_returns_live.py:152` (test cleanup) — [VERIFIED by repo-wide grep]. The csv-finalize route also **creates a NEW strategy per upload** (no UNIQUE on `wizard_session_id` for the data path; see route.ts:1150-1170 rationale) — so "re-upload" may mean a new strategy entirely, not an update of the old one.
**How to avoid:** The planner MUST pick T12's resolution before tasking:
  - **(a)** Add a small "replace" path — either a new SECURITY DEFINER RPC that `DELETE`s the strategy's rows then bulk-inserts (full-replace), or extend `persist_csv_daily_returns` with a `p_replace` flag. This is the only option that makes "no stale rows" literally true for a partial re-upload.
  - **(b)** Lock the contract to "re-upload always supplies full history" and add a T12 fixture proving that a full re-upload of overlapping+extended dates yields exactly the new set (which upsert already satisfies, because every old date is also present in the new full series). This needs no code change but constrains the EA to always export the complete series.
  Note option (b) does NOT cover the "user uploads a SHORTER series" case — those extra old dates survive. Flag this explicitly to the user during discuss/plan.
**Warning signs:** A test that re-uploads a strictly-shorter date range and asserts the table has only the new dates will FAIL against the current RPC.

### Pitfall 2: The pipeline does NOT zero-fill or reject gaps (T5)
**What goes wrong:** A series with a missing week computes volatility/Sharpe over a sparse calendar, understating annualized vol (fewer-than-expected observations, quantstats annualizes by periods-per-year). T5 wants a dense calendar.
**Why it happens:** `validate_csv` only requires strictly-increasing unique dates (csv_validator.py:110-111) — gaps are legal. `compute_all_metrics` computes over exactly the dates present; its NaN policy (metrics.py:402-430) only fills NaN *values within existing rows* (`fillna(0)` for chart continuity), it does not insert missing calendar dates. There is no densification step.
**How to avoid:** Per CONTEXT (Claude's discretion within T5's options): either the **EA emits a dense calendar** (one row per calendar day, zero-return for no-trade days) — recommended, simplest, and matches the "vol on dense calendar" requirement — OR the test asserts a gap series is rejected (would require a new gap-detection rule, more code). The fixture must pin whichever is chosen and assert the resulting vol.
**Warning signs:** A gap fixture whose computed vol differs from the dense-calendar expectation.

### Pitfall 3: GlobalVariable does not reliably survive an unexpected kill (A1/T15)
**What goes wrong:** After a crash/kill, the next day's return is computed against a fresh/zero base instead of the persisted `prior_close_equity`, producing a garbage first-day-after-restart return.
**Why it happens:** MQL5 terminal global variables are disk-flushed only periodically and on **clean** shutdown; `GlobalVariablesFlush()` forces a save but unflushed state at the moment of a hard kill is lost. They also auto-delete after 4 weeks of no access. [CITED: mql5.com/en/docs/globals]
**How to avoid:** Persist `prior_close_equity` (and the last-snapshot date) to a small file in `MQL5\Files` via FileWrite, written immediately after each daily snapshot; reload it in `OnInit`. A file write is durable at write-time, unlike a GlobalVariable. T15 (manual) must verify the restart path.
**Warning signs:** First post-restart return is wildly off; the base equity reads as 0 or current equity.

### Pitfall 4: Equity vs balance (T6/E8)
**What goes wrong:** Using `ACCOUNT_BALANCE` excludes floating PnL of overnight open positions, so an open winner/loser doesn't show in that day's return.
**Why it happens:** `ACCOUNT_BALANCE` is realized only; `ACCOUNT_EQUITY` = balance + floating PnL + credit. [CITED: mql5.com/en/docs/account/accountinfodouble]
**How to avoid:** Snapshot `AccountInfoDouble(ACCOUNT_EQUITY)`. T6 fixture pins an overnight-position day.
**Warning signs:** Return is flat on a day with a large open-position move.

### Pitfall 5: Day-rollover / DST double-or-skipped snapshot (T13/E3)
**What goes wrong:** Two rows for one date (duplicate → validator's `_strictly_increasing` rejects the whole file) or a skipped day, around a DST boundary.
**Why it happens:** OnTimer fires on wall-clock intervals; naive "snapshot at 00:00 local" logic can fire twice or zero times when the clock jumps. `OnTimer` (unlike `OnTick`) fires even when the market is closed. [CITED: mql5.com/en/docs/event_handlers/ontimer]
**How to avoid:** Detect rollover by comparing the **date component** of `TimeTradeServer()` (or a chosen fixed reference) against the last-snapshotted date, taking exactly one snapshot when the date changes — not by matching a wall-clock instant. Persist last-snapshot date alongside `prior_close_equity`. T13 fixture pins one row per DST-boundary date.
**Warning signs:** Validator rejects with `monotonic_dates`; or a calendar day missing from the series.

## Code Examples

### MQL5: read total equity (T6) — CITED
```mql5
// Source: https://www.mql5.com/en/docs/account/accountinfodouble
double equity = AccountInfoDouble(ACCOUNT_EQUITY);   // includes floating PnL of open positions
// double balance = AccountInfoDouble(ACCOUNT_BALANCE); // realized only — do NOT use for the daily return
```

### MQL5: classify a deal as external flow vs cost (E5/T10/T11) — CITED enums
```mql5
// Source: https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties
// Iterate the day's deals via HistorySelect(from, to) then HistoryDealGetTicket(i):
long dtype = HistoryDealGetInteger(ticket, DEAL_TYPE);
double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT); // signed cash effect of the deal
// EXTERNAL FLOW (exclude from return): DEAL_TYPE_BALANCE (deposit/withdrawal), DEAL_TYPE_CREDIT, DEAL_TYPE_CHARGE, DEAL_TYPE_BONUS
// COST INCLUDED in return (do NOT net as flow): DEAL_TYPE_COMMISSION[_DAILY|_MONTHLY|_AGENT_*], DEAL_TYPE_INTEREST, swap (carried in DEAL_SWAP)
// CORRECTION: DEAL_TYPE_CORRECTION — classify per the documented table (default: treat as a flow if it's a balance correction, document the choice for T11)
```

### MQL5: write the CSV row (FileOpen/FileWrite) — CITED
```mql5
// Source: https://www.mql5.com/en/docs/files/fileopen
// Lands in MQL5\Files\ (sandbox). FILE_CSV auto-delimits; FILE_ANSI keeps bytes clean for pandas utf-8-sig read.
int h = FileOpen("strategy_dailies.csv", FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
// ... seek to end, then:
FileWrite(h, TimeToString(snapDate, TIME_DATE), DoubleToString(daily_return, 8)); // "YYYY.MM.DD" — convert to YYYY-MM-DD before writing
FileClose(h);
```
> Note: `TimeToString(..., TIME_DATE)` yields `YYYY.MM.DD`; emit ISO `YYYY-MM-DD` to satisfy the route regex (`^\d{4}-\d{2}-\d{2}$`). Build the date string manually or replace `.` with `-`.

### Python: T9 currency hard-fail — VERIFIED contract
```python
# Source pattern: analytics-service/tests/test_csv_validator.py
env = validate_csv(b"date,daily_return,currency\n2026-01-01,0.001,EUR\n2026-01-02,0.002,EUR\n", "daily_returns")
assert env["ok"] is False
assert any(e["rule"] == "currency_usd_or_blank" for e in env["errors"])
```

### CI: T16 read-only static check — mirror ci.yml:284
```yaml
# New step in .github/workflows/ci.yml — model: the existing "Check for banned packages" step.
- name: MT5 EA read-only static check
  run: |
    if grep -rnE 'OrderSend|CTrade|PositionClose|PositionModify|OrderModify|OrderDelete|trade\.' tools/mt5/*.mq5; then
      echo "::error::MT5 EA must be read-only (no order/trade mutation API)."; exit 1
    fi
```
> An equity-recording EA legitimately calls only: `AccountInfoDouble`, `HistorySelect`/`HistoryDeal*`, `PositionsTotal`/`PositionGet*` (read), `FileOpen`/`FileWrite`/`FileClose`, `GlobalVariable*`, `EventSetTimer`/`OnTimer`, `Time*`. None of these are trade-mutating, so T16's denylist is satisfiable. [VERIFIED against the MQL5 reference surface]

## The Deposit-Day Bug (E4/E5/T2) — the #1 test

The daily return must reflect **trading P&L only**, removing external cash flows. With `prior_close_equity` = yesterday's closing equity and `equity_close` = today's closing equity:

```
net_external_flows = Σ(signed cash of DEAL_TYPE_BALANCE/CREDIT/CHARGE/BONUS deals that day)
                     (deposit > 0, withdrawal < 0)

daily_return = (equity_close − net_external_flows − prior_close_equity) / prior_close_equity
```

- **Deposit day (T2):** a +$10,000 deposit raises `equity_close` by $10,000 with no trading; subtracting `net_external_flows` cancels it, so the day shows only trading return (≈0 if no trades, or the real trading return if trades happened). Without the subtraction, the day reads as a huge positive "return" (the cash spike) — the exact failure mode.
- **Withdrawal day (T3):** withdrawal is negative flow; subtracting a negative adds it back, so the outflow doesn't depress the return.
- **Swap/commission (T10):** these are NOT in `net_external_flows` — they reduce `equity_close` as genuine costs and correctly lower the return.

**Intraday flow timing (T4 — taste):** the formula above is exact only if the flow lands when no position value is mid-swing. For an intraday deposit at 09:00 followed by trades, the flow-then-trade ordering means subtracting the gross day-flow is an approximation (the post-deposit capital base earned the trading return). The Modified-Dietry / time-weighted variant weights the flow by time-in-period; the locked decision is **follow the chosen convention and FLAG the day if approximate**. The EA can flag by emitting an audit sidecar (the manual T14 reconcile checks it); the CSV itself stays `date,daily_return`. Pin T4's fixture to whatever convention the EA implements.

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| MQL4 `AccountEquity()` global function | MQL5 `AccountInfoDouble(ACCOUNT_EQUITY)` | MT5 era | Training data may mix MQL4/MQL5 — MT5 uses the typed enum accessor, not bare globals. [CITED] |
| MQL4 `OrderSelect` over a single order pool | MQL5 `HistorySelect` + `HistoryDeal*` (deals) and `PositionsTotal`/`PositionGet*` (positions) | MT5 era | MT5 separates deals/orders/positions; deal-history is the source for balance-deal classification. [CITED] |

**Deprecated/outdated:** Do not use any MQL4 API name (`AccountBalance()`, `AccountEquity()`, `OrderSend()` 4-style). MT5/MQL5 is a different API surface (AGENTS.md's "this is NOT the X you know" caution applies in spirit to MQL5 too).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `DEAL_TYPE_CORRECTION` should default to "external flow / excluded" in the EA, with the exact CREDIT/CHARGE/BONUS/CORRECTION classification confirmed against the user's broker behavior during T14 | Deal table / T11 | A correction misclassified as a cost vs a flow shifts one day's return; T11 documents the table and T14 reconciles it live. The classification is a taste/contract decision the test strategy explicitly says to "document per table." |
| A2 | A dense daily calendar (zero-return no-trade days) is the better T5 choice vs rejecting gaps | Pitfall 2 | Both are allowed by CONTEXT (Claude's discretion). If the user prefers reject-on-gap, a new validator rule is needed (more code). Confirm during plan. |
| A3 | Emitting a file to `MQL5\Files` (vs FILE_COMMON) is the right sandbox; the user manually retrieves it for upload | FileOpen example | If multiple terminals or an automated pickup is wanted, FILE_COMMON may be preferable. Low risk — both are sandbox-legal. |
| A4 | The MQL5 deal/account enum identifiers cited from mql5.com are current for the user's terminal build | Code Examples | MetaTrader builds add enum members over time (e.g. DEAL_DIVIDEND); the core BALANCE/COMMISSION/SWAP/EQUITY set is stable. Verified against current docs; T14 confirms on the real terminal. |

## Open Questions

1. **T12 resolution (code change vs full-history contract)** — see Pitfall 1.
   - What we know: the persist RPC is upsert-only; no production DELETE exists.
   - What's unclear: whether the user accepts "re-upload must be full history" (no code) or wants true partial-replace (needs a small RPC/path change).
   - Recommendation: surface this in discuss/plan as a decision; option (a) (add a replace path) is the only one that makes T12 literally pass for a shorter re-upload.

2. **Does "re-upload" target the same strategy or a new one?** The csv-finalize route mints a new strategy per upload session (no data-path UNIQUE on wizard_session_id, route.ts:1150-1170). T12's "no stale rows" only makes sense if re-upload updates the SAME strategy_id.
   - Recommendation: confirm the re-upload UX (replace existing strategy's series vs create-new). This decides whether T12 is even about the same table rows.

3. **`DEAL_TYPE_CORRECTION` semantics on the user's broker** — confirm during T14 (A1).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python + pandas/pandera/quantstats/pytest | Half-1 fixtures + KPI tests | ✓ (existing analytics-service) | per requirements.txt | — |
| `--cov-fail-under=80` gate | Test acceptance | ✓ | ci.yml:747 | — |
| GitHub Actions (grep step) | T16 static check | ✓ | existing ci.yml | — |
| MetaTrader 5 terminal + MetaEditor (compile `.mq5`) | EA build/run (T14/T15) | ✗ in repo/CI — runs on the user's machine under Wine | n/a | None — EA is intentionally not CI-built; manual acceptance only. |
| A demo MT5 account | T14/T15 acceptance | ✗ (user-provided) | n/a | None — gates first live KPI, not this phase's CI completion. |

**Missing dependencies with no fallback (by design):** MT5 terminal + demo account — the EA half is validated manually (T14/T15), not in CI. This is the locked strategy, not a gap to fix.

## Validation Architecture

> nyquist_validation not disabled in config → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) |
| Config file | `analytics-service/pytest.ini` (`testpaths=tests`, `asyncio_mode=auto`) |
| Quick run command | `cd analytics-service && pytest tests/test_mt5_golden_fixtures.py -x` |
| Full suite command | `cd analytics-service && pytest --cov=services --cov-report=term-missing --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| T1 | steady series KPIs | unit (golden) | `pytest tests/test_mt5_golden_fixtures.py::test_steady_series_kpis -x` | ❌ Wave 0 |
| T2 | deposit-day | unit (golden) | `...::test_deposit_day_trading_return -x` | ❌ Wave 0 |
| T3 | withdrawal-day | unit (golden) | `...::test_withdrawal_day -x` | ❌ Wave 0 |
| T4 | intraday-flow | unit (golden) | `...::test_intraday_flow_convention -x` | ❌ Wave 0 |
| T5 | gap series | unit (golden) | `...::test_gap_series_dense_or_reject -x` | ❌ Wave 0 |
| T6 | overnight equity | unit (golden) | `...::test_overnight_tracks_equity -x` | ❌ Wave 0 |
| T7 | fractional → no auto-÷100 | unit (validator) | `...::test_fractional_no_info_flags -x` | ❌ Wave 0 |
| T8 | blank currency OK | unit (validator) | `...::test_blank_currency_ok -x` | ❌ Wave 0 |
| T9 | EUR hard-fail | unit (validator) | `...::test_eur_hard_fails -x` | ❌ Wave 0 |
| T10 | swap/commission included | unit (golden) | `...::test_costs_included_not_netted -x` | ❌ Wave 0 |
| T11 | CREDIT/CHARGE/CORRECTION | unit (golden) | `...::test_balance_deal_classification -x` | ❌ Wave 0 |
| T12 | re-upload full-replace | integration (DB) | mirror `test_persist_csv_daily_returns_live.py` | ❌ Wave 0 (see Pitfall 1 — may need a code/RPC change first) |
| T13 | DST boundary one row | unit (golden/validator) | `...::test_dst_boundary_single_row -x` | ❌ Wave 0 |
| T16 | EA read-only | CI grep | new ci.yml step over `tools/mt5/*.mq5` | ❌ Wave 0 |
| T14/T15 | manual reconcile + restart | manual-only | human on demo MT5 account | n/a (not CI) |

### Sampling Rate
- **Per task commit:** `pytest tests/test_mt5_golden_fixtures.py -x`
- **Per wave merge:** full analytics-service suite with coverage
- **Phase gate:** full suite green (`--cov-fail-under=80`) before `/gsd:verify-work`; plus the must-pass T2 + T5 + T14 from CONTEXT.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_mt5_golden_fixtures.py` — covers T1–T13 (drives `validate_csv` + `compute_all_metrics` / runner)
- [ ] `analytics-service/tests/fixtures/mt5/*.csv` + expected-KPI `*.json` (naming = Claude's discretion)
- [ ] New CI step in `.github/workflows/ci.yml` for T16 (mirror ci.yml:284)
- [ ] T12 integration test — **blocked on the Pitfall-1 decision** (full-replace path may need a new RPC/code change before a meaningful test can pass)
- Framework install: none — pytest already present.

## Security Domain

> security_enforcement not disabled → section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | EA writes a local file; upload uses the existing authenticated wizard. |
| V3 Session Management | no | Reuses existing wizard session. |
| V4 Access Control | yes | `csv_daily_returns` RLS (owner-only SELECT + admin) + `persist_csv_daily_returns` SECURITY DEFINER asserts `auth.uid()=p_user_id` + ownership (migration 20260522111839, verified). No new surface. |
| V5 Input Validation | yes | `validate_csv` (pandera + sentinels) + route-boundary guards (range/NaN/future-date/dup) — the EA's output is untrusted input, fully validated. |
| V6 Cryptography | no | No crypto in scope. |
| (EA-specific) Read-only guarantee | yes | T16 CI static check forbids any trade-mutation API in `tools/mt5/*.mq5` — prevents a recording EA from ever placing/closing/modifying trades. This is the phase's distinctive security control. |

### Known Threat Patterns for {MQL5 EA + CSV ingestion}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/buggy EA places trades on the user's live account | Tampering / Elevation | T16 read-only static check (CI denylist of `OrderSend\|CTrade\|Position*Modify/Close\|Order*Modify/Delete\|trade.`). |
| Plausible-but-wrong Sharpe reaches an allocator page | Information disclosure (false claim) | Daily-Sharpe sentinel (>10 reject) + dollar-form sentinel + hand-computed golden fixtures (T2/T5) + manual T14 reconcile gate before any live KPI. |
| Crafted CSV with NaN/Inf/huge return drives ±Inf factsheet | Tampering | Route guards `|daily_return| ≤ 10`, `Number.isFinite`, calendar-valid + non-future date (route.ts:154-206); validator per-row bound `> -100`. |
| Cross-tenant write via the persist RPC | Elevation | SECURITY DEFINER `auth.uid()=p_user_id` + ownership check, probe-oracle collapsed to 42501 (migration verified). |
| File path traversal from the EA | Tampering | MQL5 file sandbox forbids writing outside `MQL5\Files` / Common (cited) — EAs cannot escape it. |

## Sources

### Primary (HIGH confidence — read in-code this session)
- `analytics-service/services/csv_validator.py` — `validate_csv`, SCHEMAS["daily_returns"], auto-÷100 (310-350), sentinels (223-285), date detection (526-605), currency/percent rules, info_flags.
- `analytics-service/services/ingestion/csv_adapter.py` — CsvAdapter.validate, byte cap, envelope threading.
- `analytics-service/services/analytics_runner.py` — `run_csv_strategy_analytics` (1913-2172), DataQualityFlags, csv_source.
- `analytics-service/services/metrics.py` — `compute_all_metrics` (333-492), quantstats KPI calls, input-shape preconditions, NaN/gap policy.
- `src/app/api/strategies/csv-finalize/route.ts` — `parseDailyReturnsSeries` (range/NaN/future/dup guards), persist RPC call, new-strategy-per-upload.
- `supabase/migrations/20260522111839_csv_daily_returns.sql` — table (DATE PK), RLS, `persist_csv_daily_returns` (upsert-only, no DELETE).
- `analytics-service/tests/test_metrics_minigolden.py`, `test_csv_validator.py`, `test_metrics_parity.py`, `test_csv_analytics_runner.py`, `test_persist_csv_daily_returns_live.py` — fixture/oracle/mock patterns.
- `.github/workflows/ci.yml` — `--cov-fail-under=80` (747), banned-packages grep step (284) as T16 model.

### Secondary (HIGH-MEDIUM — official MQL5 docs, cited this session)
- https://www.mql5.com/en/docs/account/accountinfodouble — ACCOUNT_EQUITY vs ACCOUNT_BALANCE.
- https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties — ENUM_DEAL_TYPE / ENUM_DEAL_ENTRY / ENUM_DEAL_REASON, HistoryDealGet*.
- https://www.mql5.com/en/docs/globals — GlobalVariable persistence + 4-week + flush gotchas.
- https://www.mql5.com/en/docs/files/fileopen — FileOpen flags, sandbox, FILE_CSV/FILE_ANSI.
- https://www.mql5.com/en/docs/event_handlers/ontimer — OnTimer vs OnTick, server-time, rollover.

### Tertiary (LOW — none relied upon for load-bearing claims)
- None. All factual claims trace to in-code reads or official MQL5 docs.

## Metadata

**Confidence breakdown:**
- Python ingestion/KPI contract: HIGH — every claim verified by reading the actual source this session.
- T12 / T5 / persistence semantics: HIGH — verified there is NO production DELETE and NO densification (repo-wide grep + code read).
- MQL5 APIs: MEDIUM-HIGH — cited from current official docs; enum/function names are stable, but the EA's runtime behavior is intentionally unverifiable in CI (gated on T14/T15).
- Deal-classification edge cases (CORRECTION/BONUS): MEDIUM — documented per the test strategy's "classify per table" instruction; confirmed live in T14.

**Research date:** 2026-06-14
**Valid until:** ~2026-07-14 for the Python contract (stable); MQL5 docs are stable across MT5 builds — re-check only the deal-type enum list if the user's terminal build is newer.
