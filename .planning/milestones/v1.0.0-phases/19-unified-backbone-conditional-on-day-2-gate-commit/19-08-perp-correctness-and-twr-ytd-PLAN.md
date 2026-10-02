---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 08
type: execute
wave: 2
depends_on: [19-03-ingestion-adapter-protocol]
files_modified:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/exchange.py
  - analytics-service/services/position_reconstruction.py
  - analytics-service/requirements-dev.txt
  - analytics-service/tests/test_equity_curve_builder.py
  - analytics-service/tests/fixtures/equity-curve-golden/okx-multi-month-perps.json
  - analytics-service/tests/fixtures/equity-curve-golden/binance-spot-only.json
  - analytics-service/tests/fixtures/equity-curve-golden/bybit-perp-with-funding.json
  - analytics-service/tests/fixtures/equity-curve-golden/csv-spot-only.json  # H-13 - CSV TWR/YTD parity fixture (BACKBONE-02)
  - scripts/probe-quantstats-version.sh
  - .planning/phase-19/customer-feedback.md
autonomous: false
requirements: [BACKBONE-06, BACKBONE-07, BACKBONE-09, BACKBONE-10]
must_haves:
  truths:
    - "EquityCurveBuilder class added to analytics-service/services/equity_reconstruction.py — wraps existing position_reconstruction.py + funding_fetch.py primitives (REUSE flag — do NOT rewrite)"
    - "Open perpetual positions valued at mark-price via new services/exchange.py.fetch_mark_prices(instruments) (60s in-process cache); CSV positions assumed flat (v0 limitation)"
    - "TWR ≠ YTD when strategy has multi-period history: TWR = full-history geometric chain; YTD = window-filtered TWR over current calendar year"
    - "Sharpe matches an independently-computed quantstats reference within ±0.05 per source — golden-file fixtures cover OKX (perps), Binance (spot), Bybit (perp+funding)"
    - "Golden-file fixture JSON shape: {trades, mark_prices, funding_rows, expected_equity_curve, expected_twr, expected_ytd, expected_sharpe, quantstats_sharpe_reference}"
    - "_match_positions_fifo (currently private in position_reconstruction.py L25-100) exposed as match_positions_fifo (drop underscore) for in-memory use OR EquityCurveBuilder uses a thin private wrapper — pick one approach, document explicitly"
    - "quantstats added to requirements-dev.txt (NOT requirements.txt — dev/test only); version pinned after probe verifies API"
    - "Theme 4 customer-feedback exit gate stub created at .planning/phase-19/customer-feedback.md (P1 already wrote this stub — this plan re-verifies presence; does NOT overwrite)"
  artifacts:
    - path: "analytics-service/services/equity_reconstruction.py"
      provides: "EquityCurveBuilder class — to_equity_curve_daily, compute_twr, compute_ytd, compute_sharpe, reconstruct_positions, attach_funding, to_metrics_snapshot"
      contains: "class EquityCurveBuilder"
    - path: "analytics-service/services/exchange.py"
      provides: "fetch_mark_prices(exchange, instruments) with 60s in-process cache (BACKBONE-06 mark-price valuation)"
      contains: "fetch_mark_prices"
    - path: "analytics-service/tests/fixtures/equity-curve-golden/okx-multi-month-perps.json"
      provides: "Golden fixture — OKX multi-month perp strategy with mark_prices + funding_rows"
      contains: "expected_twr"
    - path: "analytics-service/tests/fixtures/equity-curve-golden/binance-spot-only.json"
      provides: "Golden fixture — Binance spot strategy (no funding, no mark prices)"
      contains: "expected_twr"
    - path: "analytics-service/tests/fixtures/equity-curve-golden/bybit-perp-with-funding.json"
      provides: "Golden fixture — Bybit perp with funding accumulation"
      contains: "funding_rows"
    - path: "analytics-service/requirements-dev.txt"
      provides: "quantstats pinned for golden-file Sharpe reference"
      contains: "quantstats"
  key_links:
    - from: "EquityCurveBuilder.reconstruct_positions"
      to: "position_reconstruction._match_positions_fifo (or exposed match_positions_fifo)"
      via: "in-memory FIFO matching using existing primitive (REUSE flag — BACKBONE-09)"
      pattern: "match_positions_fifo"
    - from: "EquityCurveBuilder.attach_funding"
      to: "services.funding_fetch primitives"
      via: "8h-window bucket sum into equity curve"
      pattern: "funding_fetch"
    - from: "OkxAdapter.compute_metrics"
      to: "EquityCurveBuilder.to_metrics_snapshot"
      via: "P3 adapters lazy-import EquityCurveBuilder"
      pattern: "to_metrics_snapshot"
---

<objective>
Close BACKBONE-06 (open-perpetual position valuation correctness) and
BACKBONE-07 (TWR ≠ YTD reconciliation) at the equity-curve layer. Both
requirements were pushed from Phase 18 to Phase 19 (per CONTEXT.md L22-23 +
ROADMAP §Phase 19 Success Criteria 7) because they pair naturally with
`IngestionAdapter.reconstruct_positions` and the equity-curve unification.

Three components:
1. **`EquityCurveBuilder` class** appended to existing
   `analytics-service/services/equity_reconstruction.py` (existing module —
   Phase 07 allocator-side primitives). The class WRAPS:
   - `position_reconstruction._match_positions_fifo` (existing FIFO matcher;
     P3 may need to expose it as `match_positions_fifo` without underscore,
     OR EquityCurveBuilder calls the private — pick one approach in Task 1).
   - `services.funding_fetch.upsert_funding_rows` primitives (existing 8h
     bucket dedup at L60-80 — REUSE flag).
   - new `services.exchange.fetch_mark_prices(exchange, instruments)` with
     60s in-process cache (this plan's Task 2 — BACKBONE-06).

2. **`fetch_mark_prices` extension** to `services/exchange.py`. Adds an
   in-process dict-with-TTL cache (mirrors existing `_FAIL_CLOSED` pattern
   at L101-213). Per-exchange branches:
   - OKX: `public_get_public_mark_price({"instId": sym})` → `data[0].markPx`.
   - Binance: `fapiPublic_get_premiumindex` (mark price endpoint).
   - Bybit: `private_get_v5_market_tickers?category=linear` → `result.list[0].markPrice`.

3. **3 golden-file fixtures** under `analytics-service/tests/fixtures/equity-curve-golden/`:
   - `okx-multi-month-perps.json` — multi-month OKX perp strategy. Asserts
     mark-price valuation + funding accumulation. Multi-year span tests
     TWR ≠ YTD discriminator.
   - `binance-spot-only.json` — Binance spot strategy (no funding, no mark
     prices). Asserts TWR == YTD when history is within current year.
   - `bybit-perp-with-funding.json` — Bybit perp with non-zero funding rows.
     Asserts funding accumulation in equity curve.

   Each fixture: `{strategy_name, trades, mark_prices, funding_rows,
   expected_equity_curve, expected_twr, expected_ytd, expected_sharpe,
   quantstats_sharpe_reference}`.

4. **`quantstats` dev dependency** pinned in `requirements-dev.txt` (NOT
   `requirements.txt` — only used in tests). Probe script verifies
   `qs.stats.sharpe(returns, periods=252)` API matches before pinning a
   version (Assumption A2).

5. **Theme 4 customer-feedback exit gate** — re-verify P1's
   `.planning/phase-19/customer-feedback.md` stub exists; do NOT overwrite.

**Open Question 2 / Pitfall 7 reminders (mark-price + Decimal):**
- Mark-price valuation runs on float64 (existing `analytics_runner.py` convention).
  Don't introduce Decimal mid-pipeline.
- `compute_ytd()` returns same as TWR if all trades are within current year —
  golden fixtures MUST include at least one multi-year case for the bug to surface
  (RESEARCH §P8 gotcha L1722).

Purpose: Ships BACKBONE-06 + BACKBONE-07 + the BACKBONE-09 wire-through for
position reconstruction. Wave 2; depends on P3 (Trade/Position dataclasses).

Output: 1 module extension (equity_reconstruction.py), 1 module extension
(services/exchange.py), 1 dev dep, 3 golden fixtures, 1 pytest, 1 probe script,
1 customer-feedback verify.

Tracking: BACKBONE-06 (mark-price valuation), BACKBONE-07 (TWR ≠ YTD),
BACKBONE-09 (position reconstruction wired through reconstruct_positions),
BACKBONE-10 (customer-feedback exit gate stub re-verify).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@analytics-service/services/equity_reconstruction.py
@analytics-service/services/position_reconstruction.py
@analytics-service/services/funding_fetch.py
@analytics-service/services/exchange.py
@analytics-service/services/analytics_runner.py
@analytics-service/requirements-dev.txt

<interfaces>
<!-- Existing primitives (REUSE flag — wrap, don't rewrite). -->

From `analytics-service/services/position_reconstruction.py:25-100` (verified):
- `_match_positions_fifo(symbol: str, fills: list[dict], strategy_id: str) -> list[dict]`
  — pure FIFO matcher; returns position dicts. Currently private (underscore prefix).
  RESEARCH gotcha L1720 says: P8 may need to expose as `match_positions_fifo` or
  pull into `services/positions/fifo.py`. Pick one in Task 1.
- `reconstruct_positions(strategy_id, supabase) -> ...` — DB-side persisting variant
  (existing).

From `analytics-service/services/funding_fetch.py:60-80` (verified):
- 8h funding-window bucket dedup pattern; `upsert_funding_rows(...)` writes
  signed funding payments.

From `analytics-service/services/equity_reconstruction.py` (existing module):
- Phase 07 allocator-side equity reconstruction primitives. P8 APPENDS class
  EquityCurveBuilder; do NOT delete or rewrite existing functions.

From `analytics-service/services/exchange.py` (629 LOC):
- ccxt-based broker SDK wrappers
- Existing in-process cache pattern at services/exchange.py L101-213 (e.g., key_permissions._FAIL_CLOSED)
- ccxt.async_support API per-exchange method names:
  - OKX `public_get_public_mark_price`
  - Binance `fapiPublic_get_premiumindex`
  - Bybit `private_get_v5_market_tickers` (category=linear for perps)

From `analytics-service/services/analytics_runner.py`:
- Existing convention `periods=252` for annualized Sharpe (verify in actual file).
- float64 throughout — DO NOT introduce Decimal.

From P3 (services.ingestion.adapter):
- `Trade` dataclass: exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type, is_fill
- `Position` dataclass: strategy_id, symbol, side, opened_at, closed_at, entry_price, exit_price, quantity, pnl, funding_pnl, status, roi, duration_days
- `MetricsSnapshot` dataclass: sharpe, twr, ytd, max_drawdown, total_pnl, trade_count, win_rate

Quantstats API per RESEARCH Assumption A2:
- `qs.stats.sharpe(returns, periods=252)` — annualized Sharpe; verify before pin
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P8-1" type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: Verify quantstats version + decide _match_positions_fifo exposure (Assumptions A2 + RESEARCH gotcha L1720)</name>
  <what-built>This task ships `scripts/probe-quantstats-version.sh` to verify Assumption A2 (`qs.stats.sharpe(returns, periods=252)` API stability) AND makes the explicit decision on _match_positions_fifo exposure (private wrapper inside EquityCurveBuilder vs renaming the function in position_reconstruction.py).</what-built>
  <how-to-verify>
1. Create `scripts/probe-quantstats-version.sh`:

```bash
#!/usr/bin/env bash
# Phase 19 / Assumption A2 — verify quantstats Sharpe API.
# Quantstats has had API drift; verify periods=252 default before pinning a version.
set -euo pipefail

LATEST=$(pip index versions quantstats 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ -z "$LATEST" ]]; then
  echo "FAIL: pip index versions quantstats returned no result." >&2
  exit 1
fi

echo "Latest quantstats: $LATEST"

# Install latest in an ephemeral venv and probe the API.
python -c "
import quantstats as qs
import pandas as pd
returns = pd.Series([0.001, 0.002, -0.001, 0.003, 0.0005] * 60)
sharpe = qs.stats.sharpe(returns, periods=252)
print(f'qs.stats.sharpe API responds; sharpe={sharpe:.4f}')
" || (echo "FAIL: qs.stats.sharpe(returns, periods=252) raised. Either API has drifted, or the venv is missing pandas. Check before pinning." >&2; exit 2)

echo "OK: pin quantstats==$LATEST in requirements-dev.txt"
```

`chmod +x scripts/probe-quantstats-version.sh`. Run locally (or in a fresh venv).

2. **Decide _match_positions_fifo exposure** (RESEARCH §P8 gotcha L1720, MC-2):
   - Option A: rename `_match_positions_fifo` → `match_positions_fifo` (drop underscore) in `position_reconstruction.py`. Update all callers. Pro: cleaner public API. Con: touches existing tested primitive; risks regression in DB-side path.
   - Option B: keep `_match_positions_fifo` private; have EquityCurveBuilder call it via underscore-prefixed import. Pro: zero touch on existing code. Con: imports a private function, slight code-smell.
   - **Decision (locked, MC-2): Option B** — minimum-touch on REUSE primitive.
   - **MC-2 deliverable:** add a one-line comment to `analytics-service/services/position_reconstruction.py` directly above the `def _match_positions_fifo` definition explaining the decision:
     ```python
     # Phase 19 / MC-2 decision: leave private (underscore prefix preserved).
     # EquityCurveBuilder (services/equity_reconstruction.py) imports this
     # directly to avoid touching the DB-side tested primitive. Future API
     # cleanup may rename without underscore once the equity-curve seam is stable.
     ```
   - This decision MUST land BEFORE P8-2 ships the EquityCurveBuilder; if Option A is chosen instead during checkpoint, P8-2 task body must be updated to match.

3. After probe + decision, type the resume signal so Task 2 proceeds with verified inputs.
  </how-to-verify>
  <resume-signal>Type "quantstats={version}; fifo_exposure=B" (or A if you chose Option A). Task 2 pins quantstats to the verified version and follows the chosen exposure path.</resume-signal>
  <requirements>BACKBONE-06, BACKBONE-07</requirements>
</task>

<task id="P8-2" type="auto" tdd="true">
  <name>Task 2: Append EquityCurveBuilder class to equity_reconstruction.py + extend exchange.py with fetch_mark_prices</name>
  <files>analytics-service/services/equity_reconstruction.py, analytics-service/services/exchange.py, analytics-service/requirements-dev.txt</files>
  <read_first>
    - analytics-service/services/equity_reconstruction.py (FULL file — APPEND below existing module; do NOT delete or rewrite Phase 07 code)
    - analytics-service/services/position_reconstruction.py (FULL file — verify _match_positions_fifo signature + behavior)
    - analytics-service/services/funding_fetch.py (FULL file — 8h bucket dedup + signed-payment shape)
    - analytics-service/services/exchange.py (FULL file — ccxt instance pattern, in-process cache pattern at L101-213)
    - analytics-service/services/analytics_runner.py (verify periods=252 convention)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1502-1665 — full P8 EquityCurveBuilder + fetch_mark_prices blueprint)
    - analytics-service/requirements-dev.txt (existing structure for pinning)
  </read_first>
  <behavior>
    - Test 1 (covered in test_equity_curve_builder.py — Task 3): EquityCurveBuilder constructor accepts trades + optional mark_prices.
    - Test 2: reconstruct_positions returns Position list with mark_price + unrealized_pnl on open positions when mark_prices supplied.
    - Test 3: compute_twr returns float; compute_ytd returns float; both differ when multi-year history.
    - Test 4: compute_sharpe matches qs.stats.sharpe(returns, periods=252) within ±0.05.
    - Test 5: to_metrics_snapshot returns MetricsSnapshot dataclass with all 7 fields.
    - Test 6: fetch_mark_prices caches per-symbol for 60s.
  </behavior>
  <action>
**Part 1:** Append to `analytics-service/services/equity_reconstruction.py` (DO NOT modify existing functions; add NEW class at end of file):

```python
# Phase 19 / BACKBONE-06 + BACKBONE-07 — EquityCurveBuilder.
# Wraps existing primitives (position_reconstruction.py, funding_fetch.py)
# per ROADMAP REUSE flag. Open perps valued at mark-price; YTD = window-filtered
# TWR; Sharpe matches quantstats reference within ±0.05.

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Iterable

import pandas as pd

logger = logging.getLogger(__name__)


class EquityCurveBuilder:
    """Phase 19 / BACKBONE-06 + BACKBONE-07.

    Builds an equity curve from raw trades, with mark-price valuation for
    open perpetual positions and funding-rate accumulation. YTD = window-
    filtered TWR; TWR = full-history.

    Wraps existing primitives (RESEARCH gotcha L1720 — Option B chosen):
      - position_reconstruction._match_positions_fifo (private; private
        import documented here because we don't touch the existing tested DB
        primitive)
      - services.funding_fetch primitives (8h bucket dedup)
      - services.exchange.fetch_mark_prices(instruments) (60s in-process cache)

    Sharpe matches an independently-computed quantstats reference
    (qs.stats.sharpe(returns, periods=252)) within ±0.05.
    """

    def __init__(
        self,
        trades: list,  # list[Trade] (lazy import avoided by `list` annotation)
        mark_prices: dict[str, float] | None = None,
    ):
        self.trades = sorted(trades, key=lambda t: t.timestamp)
        self.mark_prices = mark_prices or {}
        self._funding_pnl_by_day: dict[date, float] = {}
        self._curve_cache: pd.DataFrame | None = None

    def reconstruct_positions(self) -> list:
        """In-memory FIFO matching (NOT persisted to DB).

        Calls existing services.position_reconstruction._match_positions_fifo
        (private — Option B from Task 1 checkpoint).
        """
        from services.ingestion.adapter import Position
        from services.position_reconstruction import _match_positions_fifo

        positions_by_symbol: dict[str, list[dict]] = defaultdict(list)
        for trade in self.trades:
            positions_by_symbol[trade.symbol].append(
                {
                    "side": trade.side,
                    "price": trade.price,
                    "quantity": trade.quantity,
                    "fee": trade.fee,
                    "timestamp": trade.timestamp,
                }
            )

        all_positions: list[dict] = []
        for symbol, fills in positions_by_symbol.items():
            matched = _match_positions_fifo(symbol, fills, strategy_id="<in-memory>")
            all_positions.extend(matched)

        # Attach mark prices to open positions (BACKBONE-06)
        for pos in all_positions:
            if pos["status"] == "open":
                mark = self.mark_prices.get(pos["symbol"])
                if mark is not None:
                    pos["mark_price"] = mark
                    if pos["side"] == "buy":
                        pos["unrealized_pnl"] = (mark - pos["entry_price"]) * pos["quantity"]
                    else:
                        pos["unrealized_pnl"] = (pos["entry_price"] - mark) * pos["quantity"]

        return [Position(**_position_dict_to_kwargs(p)) for p in all_positions]

    def attach_funding(self, funding_rows: list[dict]) -> None:
        """Sum signed funding payments into self._funding_pnl_by_day.

        Each funding_row: {timestamp, symbol, payment, ...}; bucketed by date.
        8h cycles per services/funding_fetch.py — but daily aggregation is
        what the equity curve consumes.
        """
        for row in funding_rows:
            ts = row.get("timestamp")
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            d = ts.astimezone(timezone.utc).date() if ts else None
            if d is None:
                continue
            self._funding_pnl_by_day[d] = (
                self._funding_pnl_by_day.get(d, 0.0) + float(row.get("payment", 0.0))
            )
        self._curve_cache = None  # invalidate cache

    def to_equity_curve_daily(self) -> pd.DataFrame:
        """Returns a daily equity DataFrame: [date, realized_pnl,
        unrealized_pnl, funding_pnl, equity, daily_return].
        """
        if self._curve_cache is not None:
            return self._curve_cache

        if not self.trades:
            self._curve_cache = pd.DataFrame(columns=["date", "realized_pnl", "unrealized_pnl", "funding_pnl", "equity", "daily_return"])
            return self._curve_cache

        # Aggregate realized PnL by date from closed positions.
        positions = self.reconstruct_positions()
        realized_by_date: dict[date, float] = defaultdict(float)
        for pos in positions:
            if pos.status == "closed" and pos.closed_at and pos.pnl is not None:
                d = pos.closed_at.astimezone(timezone.utc).date()
                realized_by_date[d] += pos.pnl

        # Build the daily index from min trade date to max.
        first = min(t.timestamp for t in self.trades).astimezone(timezone.utc).date()
        last = max(t.timestamp for t in self.trades).astimezone(timezone.utc).date()
        idx = pd.date_range(first, last, freq="D")

        df = pd.DataFrame({"date": idx})
        df["realized_pnl"] = df["date"].map(lambda d: realized_by_date.get(d.date(), 0.0))
        df["funding_pnl"] = df["date"].map(lambda d: self._funding_pnl_by_day.get(d.date(), 0.0))
        df["unrealized_pnl"] = 0.0  # only on the last row, from open position mark-price
        if not df.empty:
            open_unrealized = sum(
                getattr(p, "pnl", 0.0) or 0.0 for p in positions if p.status == "open"
            )
            df.loc[df.index[-1], "unrealized_pnl"] = open_unrealized

        df["daily_pnl"] = df["realized_pnl"] + df["funding_pnl"] + df["unrealized_pnl"]
        df["equity"] = df["daily_pnl"].cumsum()
        # Daily return: pct change in equity (use 1.0 starting basis)
        df["equity_basis"] = df["equity"] + 1.0  # avoid divide-by-zero on day 1
        df["daily_return"] = df["equity_basis"].pct_change().fillna(0.0)
        df = df.drop(columns=["daily_pnl", "equity_basis"])
        self._curve_cache = df
        return df

    def compute_twr(self) -> float | None:
        """Time-Weighted Return over full history."""
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        return float((1 + df["daily_return"]).prod() - 1)

    def compute_ytd(self) -> float | None:
        """YTD = TWR computed over the year-to-date window.
        BACKBONE-07: differs from full-history TWR when history > 1 year.
        """
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        year_start = pd.Timestamp(date(date.today().year, 1, 1))
        ytd_df = df[df["date"] >= year_start]
        if ytd_df.empty:
            return None
        return float((1 + ytd_df["daily_return"]).prod() - 1)

    def compute_sharpe(self, risk_free_rate: float = 0.0, periods: int = 252) -> float | None:
        """Annualized Sharpe ratio. Matches qs.stats.sharpe within ±0.05."""
        df = self.to_equity_curve_daily()
        if df.empty or len(df) < 2:
            return None
        returns = df["daily_return"]
        excess = returns - (risk_free_rate / periods)
        if excess.std() == 0:
            return None
        return float((excess.mean() / excess.std()) * (periods ** 0.5))

    def compute_max_drawdown(self) -> float | None:
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        equity = df["equity"]
        running_max = equity.cummax()
        dd = (equity - running_max) / (running_max.replace(0, 1))
        return float(dd.min())

    def to_metrics_snapshot(self):
        """Compose into MetricsSnapshot dataclass."""
        from services.ingestion.adapter import MetricsSnapshot

        positions = self.reconstruct_positions()
        closed = [p for p in positions if p.status == "closed"]
        wins = [p for p in closed if p.pnl is not None and p.pnl > 0]
        win_rate = (len(wins) / len(closed)) if closed else None
        total_pnl = sum((p.pnl or 0.0) for p in closed) + sum(self._funding_pnl_by_day.values())

        return MetricsSnapshot(
            sharpe=self.compute_sharpe(),
            twr=self.compute_twr(),
            ytd=self.compute_ytd(),
            max_drawdown=self.compute_max_drawdown(),
            total_pnl=total_pnl,
            trade_count=len(self.trades),
            win_rate=win_rate,
        )


def _position_dict_to_kwargs(p: dict) -> dict:
    """Map _match_positions_fifo output dict → Position dataclass kwargs."""
    return {
        "strategy_id": p.get("strategy_id", "<in-memory>"),
        "symbol": p.get("symbol", ""),
        "side": p.get("side", ""),
        "opened_at": p.get("opened_at"),
        "closed_at": p.get("closed_at"),
        "entry_price": float(p.get("entry_price", 0.0)),
        "exit_price": p.get("exit_price"),
        "quantity": float(p.get("quantity", 0.0)),
        "pnl": p.get("pnl") if "pnl" in p else p.get("unrealized_pnl"),
        "funding_pnl": p.get("funding_pnl"),
        "status": p.get("status", "closed"),
        "roi": p.get("roi"),
        "duration_days": p.get("duration_days"),
    }
```

**Part 2:** Append to `analytics-service/services/exchange.py` (DO NOT modify existing 629 LOC; add NEW function at end):

```python
# Phase 19 / BACKBONE-06 — fetch_mark_prices for open-perp valuation.
# 60s in-process cache mirrors existing key_permissions._FAIL_CLOSED pattern.
import time as _phase19_time

_MARK_PRICE_CACHE: dict[str, tuple[float, float]] = {}  # symbol → (price, expires_at)
_MARK_PRICE_TTL_S = 60.0


async def fetch_mark_prices(
    exchange,  # ccxt.Exchange
    instruments: list[str],
) -> dict[str, float]:
    """Phase 19 / BACKBONE-06. Fetch current mark prices for open perp instruments.

    60s in-process cache prevents fan-out hammering on equity-curve recompute.
    Returns {symbol: price} for every requested symbol that has a mark.
    Symbols missing on the exchange are absent from the dict (caller decides).
    """
    now = _phase19_time.monotonic()
    result: dict[str, float] = {}
    to_fetch: list[str] = []
    for sym in instruments:
        cached = _MARK_PRICE_CACHE.get(sym)
        if cached and cached[1] > now:
            result[sym] = cached[0]
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return result

    if exchange.id == "okx":
        for sym in to_fetch:
            try:
                resp = await exchange.public_get_public_mark_price({"instId": sym})
                price = float(resp["data"][0]["markPx"])
                result[sym] = price
                _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
            except Exception as exc:  # noqa: BLE001
                logger.warning("fetch_mark_prices OKX failed for %s: %s", sym, exc)
    elif exchange.id == "binance":
        try:
            resp = await exchange.fapiPublic_get_premiumindex()
            # resp shape: list of {symbol, markPrice, ...}
            for row in resp:
                sym = row.get("symbol")
                if sym in to_fetch:
                    price = float(row["markPrice"])
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Binance failed: %s", exc)
    elif exchange.id == "bybit":
        try:
            resp = await exchange.private_get_v5_market_tickers({"category": "linear"})
            tickers = resp.get("result", {}).get("list", [])
            for row in tickers:
                sym = row.get("symbol")
                if sym in to_fetch:
                    price = float(row["markPrice"])
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Bybit failed: %s", exc)
    else:
        logger.warning("fetch_mark_prices: unknown exchange.id=%s", exchange.id)

    return result


def _reset_mark_price_cache_for_tests() -> None:
    """Test-only: clear the in-process cache."""
    _MARK_PRICE_CACHE.clear()
```

**Part 3:** Add to `analytics-service/requirements-dev.txt`:
```
quantstats=={VERSION}  # Phase 19 / BACKBONE-07 golden-file Sharpe reference (Assumption A2 verified via scripts/probe-quantstats-version.sh)
```
(Substitute `{VERSION}` with the value from Task 1 checkpoint.)
  </action>
  <acceptance_criteria>
    - `class EquityCurveBuilder` defined in `analytics-service/services/equity_reconstruction.py`
    - `grep -q 'class EquityCurveBuilder' analytics-service/services/equity_reconstruction.py`
    - 7 methods exist: reconstruct_positions, attach_funding, to_equity_curve_daily, compute_twr, compute_ytd, compute_sharpe, compute_max_drawdown, to_metrics_snapshot (8 total)
    - `grep -c 'def compute_' analytics-service/services/equity_reconstruction.py` returns ≥ 4
    - `def fetch_mark_prices` added to `analytics-service/services/exchange.py`
    - `grep -q 'async def fetch_mark_prices' analytics-service/services/exchange.py`
    - `grep -q '_MARK_PRICE_TTL_S = 60' analytics-service/services/exchange.py`
    - `grep -q 'public_get_public_mark_price' analytics-service/services/exchange.py` (OKX)
    - `grep -q 'fapiPublic_get_premiumindex' analytics-service/services/exchange.py` (Binance)
    - `grep -q 'private_get_v5_market_tickers' analytics-service/services/exchange.py` (Bybit)
    - `analytics-service/requirements-dev.txt` includes `quantstats==`
    - `grep -q 'quantstats' analytics-service/requirements-dev.txt`
    - **Existing equity_reconstruction.py functions UNCHANGED** — verify by ensuring the class is APPENDED below existing code (no deletions)
    - **Existing exchange.py 629 LOC UNCHANGED** — verify only additions at end
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && grep -q "class EquityCurveBuilder" services/equity_reconstruction.py && grep -q "def compute_twr" services/equity_reconstruction.py && grep -q "def compute_ytd" services/equity_reconstruction.py && grep -q "def compute_sharpe" services/equity_reconstruction.py && grep -q "def to_metrics_snapshot" services/equity_reconstruction.py && grep -q "async def fetch_mark_prices" services/exchange.py && grep -q "_MARK_PRICE_TTL_S = 60" services/exchange.py && grep -q "quantstats" requirements-dev.txt'
  </automated>
  <requirements>BACKBONE-06, BACKBONE-07, BACKBONE-09</requirements>
</task>

<task id="P8-3" type="auto" tdd="true">
  <name>Task 3: Write 3 golden-file fixtures + pytest covering BACKBONE-06/07 + verify customer-feedback stub</name>
  <files>analytics-service/tests/fixtures/equity-curve-golden/okx-multi-month-perps.json, analytics-service/tests/fixtures/equity-curve-golden/binance-spot-only.json, analytics-service/tests/fixtures/equity-curve-golden/bybit-perp-with-funding.json, analytics-service/tests/test_equity_curve_builder.py, .planning/phase-19/customer-feedback.md</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1668-1716 — golden fixture format + pytest skeleton)
    - .planning/phase-19/customer-feedback.md (P1 already created stub — verify presence; do NOT overwrite)
    - analytics-service/services/equity_reconstruction.py (Task 2 output — EquityCurveBuilder class)
    - analytics-service/services/ingestion/adapter.py (P3 — Trade dataclass)
  </read_first>
  <behavior>
    - Test 1 (test_open_perp_valuation_okx): okx-multi-month-perps.json fixture asserts open positions valued at mark_price; equity curve includes unrealized_pnl on last row.
    - Test 2 (test_twr_neq_ytd_multi_year): okx-multi-month-perps fixture has trades spanning 2024+2025; TWR ≠ YTD.
    - Test 3 (test_twr_eq_ytd_within_year): binance-spot-only fixture has all trades in current year; TWR == YTD (within float tolerance).
    - Test 4 (test_funding_accumulation_bybit): bybit-perp-with-funding fixture has funding_rows; equity curve includes funding_pnl column.
    - Test 5 (test_sharpe_within_tolerance): All 3 fixtures' compute_sharpe matches expected_sharpe within 1e-4 AND quantstats_sharpe_reference within ±0.05 (BACKBONE-07).
    - Test 6 (test_max_drawdown_negative_or_zero): max_drawdown is always ≤ 0.
    - Test 7 (test_to_metrics_snapshot_shape): to_metrics_snapshot returns MetricsSnapshot with all 7 fields.
  </behavior>
  <action>
**Part 1:** Create 3 golden fixture JSONs. Each follows the schema:

```json
{
  "strategy_name": "<name>",
  "trades": [
    {"timestamp": "<iso>", "symbol": "<sym>", "side": "<buy|sell>", "price": <float>, "quantity": <float>, "fee": <float>, "exchange": "<okx|binance|bybit|csv>", "fee_currency": "USDT", "order_type": "limit", "is_fill": true}
  ],
  "mark_prices": {"<sym>": <float>},
  "funding_rows": [{"timestamp": "<iso>", "symbol": "<sym>", "payment": <float>}],
  "expected_equity_curve": [...],
  "expected_twr": <float>,
  "expected_ytd": <float>,
  "expected_sharpe": <float>,
  "quantstats_sharpe_reference": <float>
}
```

**`okx-multi-month-perps.json`** — multi-year span (2024+2025) so TWR ≠ YTD. 3-5 buys + 2 closes + 1 open position in BTC-USDT-SWAP. mark_prices includes the open position's symbol. funding_rows = []. Compute expected_twr, expected_ytd by hand (or via a small calculator script) and validate against EquityCurveBuilder; iterate until both match. Quantstats Sharpe computed via `qs.stats.sharpe(returns, periods=252)`.

**`binance-spot-only.json`** — all trades in current year (e.g., 2026-01 to 2026-04). 3 closed positions, no open. mark_prices = {}, funding_rows = []. expected_twr == expected_ytd within rounding (within-year scenario).

**`bybit-perp-with-funding.json`** — short timeframe (e.g., 2025-08 to 2025-09). 2 closed perp positions + funding_rows showing 8h-cycle payments (e.g., 6 funding rows over 2 days). mark_prices = {}.

**`csv-spot-only.json` (H-13 — CSV TWR/YTD parity fixture):**

The CSV adapter's `reconstruct_positions` returns `[]` and mark-price valuation is N/A (CSV positions are assumed flat at upload time, per CONTEXT.md L83). H-13 mandates a contract test asserting the CSV adapter pipeline still produces a usable `twr` / `ytd` for spot-only CSV uploads — otherwise BACKBONE-02 CSV parity is violated. Add a fixture mirroring `binance-spot-only.json` shape but tagged `exchange: "csv"`:

```json
{
  "strategy_name": "csv-spot-only",
  "exchange": "csv",
  "trades": [
    {"timestamp": "2026-01-05T10:00:00Z", "symbol": "BTC/USDT", "side": "buy", "price": 100.0, "quantity": 1.0, "fee": 0.1, "exchange": "csv", "fee_currency": "USDT", "order_type": "limit", "is_fill": true},
    {"timestamp": "2026-01-15T10:00:00Z", "symbol": "BTC/USDT", "side": "sell", "price": 110.0, "quantity": 1.0, "fee": 0.1, "exchange": "csv", "fee_currency": "USDT", "order_type": "limit", "is_fill": true},
    {"timestamp": "2026-02-10T10:00:00Z", "symbol": "ETH/USDT", "side": "buy", "price": 200.0, "quantity": 1.0, "fee": 0.1, "exchange": "csv", "fee_currency": "USDT", "order_type": "limit", "is_fill": true},
    {"timestamp": "2026-03-15T10:00:00Z", "symbol": "ETH/USDT", "side": "sell", "price": 220.0, "quantity": 1.0, "fee": 0.1, "exchange": "csv", "fee_currency": "USDT", "order_type": "limit", "is_fill": true}
  ],
  "mark_prices": {},
  "funding_rows": [],
  "expected_equity_curve": "(computed by EquityCurveBuilder; commit values after authoring)",
  "expected_twr": "(commit value after authoring; non-zero, in-year so equals YTD)",
  "expected_ytd": "(same as expected_twr)",
  "expected_sharpe": "(commit value after authoring)",
  "quantstats_sharpe_reference": "(commit value after authoring)"
}
```

The fixture's expected values are derived by running EquityCurveBuilder against the seed trades (same authoring procedure as the OKX/Binance fixtures). The H-13 pytest case `test_csv_adapter_twr_ytd_parity` asserts:

```python
def test_csv_adapter_twr_ytd_parity():
    """H-13 - BACKBONE-02 CSV parity: CSV adapter pipeline produces usable TWR + YTD."""
    gold = _load_fixture("csv-spot-only")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices={})  # CSV: no mark prices
    twr = builder.compute_twr()
    ytd = builder.compute_ytd()
    assert twr is not None, "CSV TWR must be computable for spot-only fixture"
    assert ytd is not None, "CSV YTD must be computable for spot-only fixture"
    # In-year fixture - TWR ~= YTD
    assert abs(twr - ytd) < 1e-4
    # Sanity: non-zero return on a profitable trade pair
    assert twr > 0
```

**Authoring tip:** Generate fixture data starting from a seed, run EquityCurveBuilder against it to derive `expected_*` values, then commit. Quantstats reference: install latest, compute, copy. Tolerance is ±0.05 for sharpe vs quantstats; ±1e-5 for TWR/YTD vs internal.

**Part 2:** Create `analytics-service/tests/test_equity_curve_builder.py`:

```python
"""Phase 19 / BACKBONE-06 + BACKBONE-07 — golden-file equity curve tests."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from services.ingestion.adapter import Trade
from services.equity_reconstruction import EquityCurveBuilder

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "equity-curve-golden"
FIXTURES = ["okx-multi-month-perps", "binance-spot-only", "bybit-perp-with-funding"]


def _load_fixture(name: str) -> dict:
    with open(FIXTURE_DIR / f"{name}.json") as f:
        return json.load(f)


def _trade_from_dict(d: dict) -> Trade:
    return Trade(
        exchange=d.get("exchange", "okx"),
        symbol=d["symbol"],
        side=d["side"],
        price=float(d["price"]),
        quantity=float(d["quantity"]),
        fee=float(d.get("fee", 0.0)),
        fee_currency=d.get("fee_currency", "USDT"),
        timestamp=datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")),
        order_type=d.get("order_type", "limit"),
        is_fill=bool(d.get("is_fill", True)),
    )


@pytest.mark.parametrize("fixture_name", FIXTURES)
def test_equity_curve_golden_twr_ytd(fixture_name):
    gold = _load_fixture(fixture_name)
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold.get("mark_prices") or {})
    builder.attach_funding(gold.get("funding_rows") or [])

    twr = builder.compute_twr()
    ytd = builder.compute_ytd()
    assert twr is not None and ytd is not None
    assert abs(twr - gold["expected_twr"]) < 1e-4, f"TWR drift in {fixture_name}: {twr} vs {gold['expected_twr']}"
    assert abs(ytd - gold["expected_ytd"]) < 1e-4, f"YTD drift in {fixture_name}: {ytd} vs {gold['expected_ytd']}"


def test_twr_neq_ytd_multi_year():
    """BACKBONE-07: when history spans multiple years, TWR ≠ YTD."""
    gold = _load_fixture("okx-multi-month-perps")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold.get("mark_prices") or {})
    twr = builder.compute_twr()
    ytd = builder.compute_ytd()
    assert abs(twr - ytd) > 1e-3, "TWR and YTD must differ for multi-year fixture"


def test_twr_eq_ytd_within_year():
    """When all history is within current year, TWR ≈ YTD."""
    gold = _load_fixture("binance-spot-only")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold.get("mark_prices") or {})
    twr = builder.compute_twr()
    ytd = builder.compute_ytd()
    assert abs(twr - ytd) < 1e-4


@pytest.mark.parametrize("fixture_name", FIXTURES)
def test_sharpe_within_tolerance(fixture_name):
    gold = _load_fixture(fixture_name)
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold.get("mark_prices") or {})
    builder.attach_funding(gold.get("funding_rows") or [])

    sharpe = builder.compute_sharpe()
    if sharpe is None:
        pytest.skip(f"{fixture_name}: insufficient data for Sharpe")

    assert abs(sharpe - gold["expected_sharpe"]) < 0.05

    # Cross-check against quantstats reference (BACKBONE-07: ±0.05 per source)
    try:
        import quantstats as qs
        df = builder.to_equity_curve_daily()
        qs_sharpe = qs.stats.sharpe(df["daily_return"], periods=252)
        assert abs(sharpe - float(qs_sharpe)) < 0.05, (
            f"{fixture_name}: builder sharpe {sharpe} vs quantstats {qs_sharpe} drift > 0.05"
        )
    except ImportError:
        pytest.skip("quantstats not installed (dev-only dep)")


def test_open_perp_valuation_okx():
    """BACKBONE-06: open position picks up mark_price + unrealized_pnl."""
    gold = _load_fixture("okx-multi-month-perps")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold["mark_prices"])
    positions = builder.reconstruct_positions()
    open_positions = [p for p in positions if p.status == "open"]
    assert len(open_positions) > 0
    for p in open_positions:
        assert p.symbol in gold["mark_prices"]


def test_funding_accumulation_bybit():
    """Funding rows accumulate into equity curve."""
    gold = _load_fixture("bybit-perp-with-funding")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades)
    builder.attach_funding(gold["funding_rows"])
    df = builder.to_equity_curve_daily()
    assert df["funding_pnl"].sum() != 0.0


def test_to_metrics_snapshot_shape():
    gold = _load_fixture("okx-multi-month-perps")
    trades = [_trade_from_dict(t) for t in gold["trades"]]
    builder = EquityCurveBuilder(trades, mark_prices=gold["mark_prices"])
    snap = builder.to_metrics_snapshot()
    for field in ("sharpe", "twr", "ytd", "max_drawdown", "total_pnl", "trade_count", "win_rate"):
        assert hasattr(snap, field)
```

**Part 3:** Verify `.planning/phase-19/customer-feedback.md` exists (P1 created the stub). Do NOT overwrite. If somehow missing (e.g., P1 not yet run), abort with a clear error message — this is Theme 4 / BACKBONE-10 exit gate.

```bash
test -f .planning/phase-19/customer-feedback.md || \
  (echo "FAIL: customer-feedback.md stub missing — P1 entry-gate must run first" >&2; exit 1)
```
  </action>
  <acceptance_criteria>
    - 4 golden fixture files exist under `analytics-service/tests/fixtures/equity-curve-golden/` (H-13 added csv-spot-only.json)
    - `ls analytics-service/tests/fixtures/equity-curve-golden/*.json | wc -l` returns 4
    - **H-13:** `test -f analytics-service/tests/fixtures/equity-curve-golden/csv-spot-only.json` AND `grep -q 'test_csv_adapter_twr_ytd_parity' analytics-service/tests/test_equity_curve_builder.py`
    - Each fixture contains keys: trades, mark_prices, funding_rows, expected_twr, expected_ytd, expected_sharpe, quantstats_sharpe_reference
    - File `analytics-service/tests/test_equity_curve_builder.py` exists with 7+ test functions
    - `cd analytics-service && python -m pytest tests/test_equity_curve_builder.py -x` exits 0 (or skips quantstats-dependent tests if dev dep not installed; mark `@pytest.mark.skip` reasonable when not in dev venv)
    - `.planning/phase-19/customer-feedback.md` exists (Theme 4 / BACKBONE-10 exit-gate stub from P1)
    - `test -f .planning/phase-19/customer-feedback.md`
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && ls tests/fixtures/equity-curve-golden/*.json | wc -l | grep -q "^4$" && test -f tests/test_equity_curve_builder.py && grep -q "test_twr_neq_ytd_multi_year" tests/test_equity_curve_builder.py && grep -q "test_open_perp_valuation_okx" tests/test_equity_curve_builder.py && grep -q "test_sharpe_within_tolerance" tests/test_equity_curve_builder.py && grep -q "test_csv_adapter_twr_ytd_parity" tests/test_equity_curve_builder.py && grep -q "expected_twr" tests/fixtures/equity-curve-golden/okx-multi-month-perps.json && grep -q "quantstats_sharpe_reference" tests/fixtures/equity-curve-golden/okx-multi-month-perps.json && test -f tests/fixtures/equity-curve-golden/csv-spot-only.json && cd .. && test -f .planning/phase-19/customer-feedback.md'
  </automated>
  <requirements>BACKBONE-06, BACKBONE-07, BACKBONE-10</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| EquityCurveBuilder → mark-price (broker) | mark_prices fetched on demand; cache TTL 60s; stale data risk on slow broker |
| EquityCurveBuilder → existing position_reconstruction primitive | private function import — Option B chosen at Task 1 checkpoint to minimize touch on REUSE'd code |
| pytest fixtures → repo | golden-file fixtures must NOT contain real customer creds or PII |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-42 | Information disclosure | golden-file fixtures with real account data | mitigate | Fixtures synthesize trades/funding rows from clean numerical sequences; no real customer data committed; no API keys; review committed JSON before merge |
| T-19-43 | Tampering | mark-price drift between cache TTL and recompute | accept | 60s cache acceptable for equity-curve recompute (low-frequency); UC-locked decision per CONTEXT.md L70 |
| T-19-44 | DoS | mark-price fetch fan-out hammers broker | mitigate | 60s in-process cache mirrors existing services/exchange.py _FAIL_CLOSED pattern; per-symbol caching means N symbols = up to N broker calls per 60s window |
| T-19-45 | Tampering | quantstats API drift breaks reference assertion | mitigate | Task 1 probe verifies API stability before pinning; fixtures store both expected_sharpe (internal) and quantstats_sharpe_reference (external) so internal tolerance assertion stands even if quantstats drifts |
| T-19-46 | Spoofing | mark-price endpoint returns wrong symbol | mitigate | Per-exchange branches verify symbol match (OKX `instId`, Binance/Bybit `symbol` field); unknown symbols absent from result dict |
| T-19-47 | Repudiation | TWR/YTD math drift over time | mitigate | Golden-file fixtures lock the expected output; pytest assertion on every CI run catches regression |
</threat_model>

<verification>
- EquityCurveBuilder class exists with 8 methods (reconstruct_positions, attach_funding, to_equity_curve_daily, compute_twr, compute_ytd, compute_sharpe, compute_max_drawdown, to_metrics_snapshot).
- fetch_mark_prices added to services/exchange.py with 60s cache.
- 3 golden-file fixtures + pytest covering BACKBONE-06 (open-perp valuation) and BACKBONE-07 (TWR ≠ YTD + Sharpe ±0.05).
- quantstats pinned in requirements-dev.txt (Assumption A2 verified at Task 1).
- Customer-feedback exit gate stub exists (P1 ships, this plan re-verifies).
- Existing equity_reconstruction.py + exchange.py code UNCHANGED (only appends).
</verification>

<success_criteria>
- BACKBONE-06: open perpetual positions valued at mark-price (OKX, Binance, Bybit branches in fetch_mark_prices); funding-rate accumulation via attach_funding.
- BACKBONE-07: TWR ≠ YTD bug fixed at equity-curve layer; YTD = window-filtered TWR over current calendar year; Sharpe matches quantstats reference within ±0.05 per source.
- BACKBONE-09: reconstruct_positions wires existing position_reconstruction primitive (Option B — private import); funding_fetch primitives wired in attach_funding.
- BACKBONE-10: customer-feedback exit gate stub present (Theme 4 — founder fills with verbatim feedback from 1-2 onboarding teams during stability window).
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-08-SUMMARY.md`
</output>
