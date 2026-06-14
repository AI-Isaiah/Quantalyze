"""Phase 20 / MT5 EA daily-returns ingestion (Approach A) — golden-fixture
contract tests (T1–T13).

The MT5 Expert Advisor's daily-equity-return math runs in MQL5 under Wine and
has NO CI harness. The Phase-20 strategy is therefore to pin the EA's OUTPUT
CONTRACT with checked-in golden `date,daily_return` CSV fixtures, each asserted
through the EXISTING, verified Python ingestion + KPI pipeline
(`services.csv_validator.validate_csv` + `services.metrics.compute_all_metrics`).
These are the load-bearing CI tests of the phase: without them a plausible-but-
wrong Sharpe (the deposit-day cash-spike bug) can reach an allocator-facing page.

DENSE CALENDAR-DAILY (no synthetic zeros)
-----------------------------------------
Every fixture is a DENSE calendar-daily series — ONE row per calendar day. The
venues are crypto (OKX/Bybit, 24/7/365), so EVERY calendar day is a real trading
day with a REAL equity-based return. There are NO artificial weekend/holiday
zero-fill rows anywhere in these fixtures (a zero-fill block would falsely
deflate volatility). A gap test (T5) is a GENUINE missing span → fewer rows, not
a zero-filled gap.

ANNUALIZATION = the LIVE periods=252 (UNCHANGED)
------------------------------------------------
`compute_all_metrics` has NO `periods` parameter; its qs.stats calls use the
quantstats 0.0.81 DEFAULT periods=252. This is the SAME constant every displayed
strategy KPI uses — the crypto trades-path (analytics_runner.py:1584) AND the
CSV/MT5 path (:2027). MT5 MUST use the identical path so Sharpe/vol/CAGR are
apples-to-apples on the ranking page; plumbing periods=365 for MT5 alone would
inflate its Sharpe ~x1.20 vs equivalent crypto strategies. The T1/T5 KPI oracles
below assert exactly what `compute_all_metrics` ACTUALLY produces at 252, with
the hand arithmetic shown in a comment (the verified facts:
sqrt(252) = 15.8745078663877; quantstats uses SAMPLE std, ddof=1).

ORACLE DISCIPLINE
-----------------
For T2/T3/T4/T10/T11 the flow/cost-day `daily_return` is computed BY HAND (paper,
not Python) from the flow-adjusted formula
`(equity_close - net_external_flows - prior_close_equity) / prior_close_equity`
and written as a literal into the fixture, so the test asserts a first-principles
oracle (mirrors test_metrics_minigolden.py: a fixture regenerated from the SUT's
own helpers can mask a money-path bug).

SCOPE HONESTY (T10/T11/T13)
---------------------------
A CSV fixture can only assert that a given typed value is INGESTED. Deal
CLASSIFICATION (swap/commission as a cost vs a flow; CREDIT/CHARGE/BONUS/
CORRECTION exclusion) and DST-rollover correctness are EA-side (MQL5) concerns
with no CI surface — they are validated by the manual demo-account reconcile
(T14, Plan 02). The T10/T11/T13 docstrings say so explicitly; none of them makes
a tautological classification claim.

Run: cd analytics-service && pytest tests/test_mt5_golden_fixtures.py -x
"""
from __future__ import annotations

import math
from pathlib import Path

import pandas as pd
import pytest

from services.csv_validator import validate_csv
from services.metrics import compute_all_metrics

# Golden CSV inputs (one row per calendar day; dense calendar-daily).
FIXTURES = Path(__file__).parent / "fixtures" / "mt5"

# VERIFIED arithmetic fact (interfaces block, re-confirmed this session):
# quantstats 0.0.81 annualizes at the DEFAULT periods=252 →
# volatility = std(ddof=1) * sqrt(252); sharpe = (mean/std(ddof=1)) * sqrt(252).
SQRT_252 = math.sqrt(252)  # == 15.874507866387544


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fixture_bytes(name: str) -> bytes:
    """Read a checked-in golden CSV fixture as raw bytes for validate_csv()."""
    return (FIXTURES / name).read_bytes()


def _series_from_envelope(env: dict) -> pd.Series:
    """Build the float-dtype, ascending DatetimeIndex pd.Series that
    `run_csv_strategy_analytics` (analytics_runner.py:~2014-2027) constructs
    from the persisted csv_daily_returns rows before calling
    compute_all_metrics with NO periods override. Feeding the SAME shape here
    means the fixture flows through the EXACT live KPI path at periods=252.
    """
    rows = env["daily_returns_series"]
    idx = pd.to_datetime([r["date"] for r in rows])
    return pd.Series(
        [r["daily_return"] for r in rows],
        index=idx,
        dtype="float64",
    )


def _info_flag_rules(env: dict) -> set[str]:
    return {f.get("rule") for f in env["info_flags"]}


def _error_rules(env: dict) -> set[str]:
    return {e.get("rule") for e in env["errors"]}


# ===========================================================================
# Task 1 — validator-contract fixtures (T7 boundary bracket, T8, T9, T2, T3,
# T10, T11). These assert env["ok"] / env["errors"][n]["rule"] /
# env["info_flags"] / env["daily_returns_series"] directly.
# ===========================================================================


# ---------------------------------------------------------------------------
# T7 — auto-divide-by-100 percent-form detection is FALSIFIABLE.
#
# The validator's _maybe_auto_normalize_percent_form fires ONLY when the
# non-zero-value median |x| is > PERCENT_FORM_AUTO_NORM_LOWER (= 0.5) AND
# <= 100 AND max |x| <= 100. A boundary-bracket pair straddles the 0.5 trigger
# so a regression that MOVES the trigger fails loudly. The assertions are about
# whether rule=="auto_normalized_percent_form" appears in info_flags, INDEPENDENT
# of env["ok"].
# ---------------------------------------------------------------------------

def test_t7_percent_form_below_edge_does_not_autonormalize() -> None:
    """T7 lower edge: non-zero median |x| ~ 0.475 (< 0.5) → the auto-divide-by-100
    must NOT fire. Fixture values are +-0.45..+-0.49 (median abs 0.47), max |x|
    <= 1.0. If a regression dropped the LOWER trigger below 0.47, this series
    would wrongly auto-normalize and the test fails.
    """
    env = validate_csv(_fixture_bytes("percent_form_below_edge.csv"), "daily_returns")
    assert "auto_normalized_percent_form" not in _info_flag_rules(env), (
        f"Below-edge series (median |x| ~0.47 < 0.5) must NOT auto-normalize; "
        f"info_flags={env['info_flags']}"
    )


def test_t7_percent_form_above_edge_does_autonormalize() -> None:
    """T7 upper edge: non-zero median |x| ~ 0.525 (> 0.5) → the auto-divide-by-100
    MUST fire. Fixture values are +-0.51..+-0.55 (median abs 0.525), max |x|
    <= 1.0 (so it does not skip as dollar-PnL). If a regression raised the LOWER
    trigger above 0.525, this series would wrongly pass through unnormalized and
    the test fails.
    """
    env = validate_csv(_fixture_bytes("percent_form_above_edge.csv"), "daily_returns")
    assert "auto_normalized_percent_form" in _info_flag_rules(env), (
        f"Above-edge series (median |x| ~0.525 > 0.5, max <= 1.0) MUST "
        f"auto-normalize; info_flags={env['info_flags']}"
    )


def test_t7_realistic_fractional_series_has_no_info_flags() -> None:
    """T7 normal-EA case: a realistic fractional series (median |x| ~ 0.006,
    i.e. ~0.6%/day) must validate clean with info_flags == []. This is the
    expected shape of real EA output (decimals, never percents) — the
    auto-normalizer must stay silent.
    """
    env = validate_csv(_fixture_bytes("fractional_series.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    assert env["info_flags"] == [], (
        f"A realistic fractional series must produce zero info_flags; "
        f"got {env['info_flags']}"
    )


# ---------------------------------------------------------------------------
# T8 — blank / absent / USD currency validates OK.
# ---------------------------------------------------------------------------

def test_t8_blank_currency_column_validates_ok() -> None:
    """T8: a file WITH a `currency` column where every value is genuinely empty
    ("") validates ok=True. (A " " single-space would survive .str.upper() as
    " " != "" and FAIL — the fixture uses truly empty cells.)"""
    env = validate_csv(_fixture_bytes("blank_currency.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    assert "currency_usd_or_blank" not in _error_rules(env)


def test_t8_no_currency_column_validates_ok() -> None:
    """T8: a `date,daily_return` file with NO currency column validates ok=True
    (the column is required=False, nullable=True)."""
    env = validate_csv(_fixture_bytes("fractional_series.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"


# ---------------------------------------------------------------------------
# T9 — currency=EUR hard-fails (decision E1: USD-only is deliberate).
# ---------------------------------------------------------------------------

def test_t9_eur_currency_hard_fails() -> None:
    """T9 (must-pass): a `date,daily_return,currency` file with currency=EUR
    validates ok=False AND some error has rule=="currency_usd_or_blank". The
    USD-only choice (decision E1) is deliberate and documented; a non-USD file
    must be rejected at the validator, never silently treated as USD."""
    env = validate_csv(_fixture_bytes("eur_currency.csv"), "daily_returns")
    assert env["ok"] is False, "EUR currency must hard-fail"
    assert "currency_usd_or_blank" in _error_rules(env), (
        f"Expected currency_usd_or_blank in errors; got {env['errors']}"
    )


# ---------------------------------------------------------------------------
# T2 — deposit-day shows the TRADING return, NOT a cash spike (the #1 test).
# ---------------------------------------------------------------------------

def test_t2_deposit_day_shows_trading_return_not_cash_spike() -> None:
    """T2 (the #1 must-pass test): the deposit-day fixture is the daily_return
    SERIES the EA SHOULD emit on a deposit day — the deposit-day row carries the
    TRADING return only, never a cash-spike return.

    Hand-computed flow-adjusted oracle (paper, NOT Python) for the deposit day
    (fixture row index 4, date 2025-01-05):
        prior_close_equity = 100_000
        +$10_000 deposit (net_external_flows = +10_000)
        trading gain on the day = +$300
        equity_close = 100_000 + 300 + 10_000 = 110_300
        daily_return = (equity_close - net_external_flows - prior_close_equity)
                       / prior_close_equity
                     = (110_300 - 10_000 - 100_000) / 100_000
                     = 300 / 100_000
                     = 0.0030          <-- trading return, NOT the +10.3% spike

    Without the net_external_flows subtraction the day would read as +0.103
    (the cash spike) — the exact failure mode this test guards against.

    Scope: this is a CSV-shape pin. It proves the pipeline INGESTS the
    flow-adjusted number the EA produced; it does NOT test the EA's MQL5 deal
    classification (that is the manual T14 reconcile).
    """
    env = validate_csv(_fixture_bytes("deposit_day.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    assert env["info_flags"] == []
    series = env["daily_returns_series"]
    deposit_row = next(r for r in series if r["date"] == "2025-01-05")
    assert deposit_row["daily_return"] == pytest.approx(0.0030, abs=1e-9)
    # And it is decidedly NOT the +10.3% cash spike a non-flow-adjusted EA emits.
    assert deposit_row["daily_return"] < 0.05


# ---------------------------------------------------------------------------
# T3 — withdrawal-day return excludes the outflow.
# ---------------------------------------------------------------------------

def test_t3_withdrawal_day_excludes_outflow() -> None:
    """T3: a withdrawal day's daily_return is the trading return with the outflow
    subtracted out (a negative external flow).

    Hand-computed flow-adjusted oracle (paper) for the withdrawal day
    (fixture row index 3, date 2025-02-04):
        prior_close_equity = 100_000
        -$5_000 withdrawal (net_external_flows = -5_000)
        trading gain on the day = +$300
        equity_close = 100_000 + 300 - 5_000 = 95_300
        daily_return = (95_300 - (-5_000) - 100_000) / 100_000
                     = (95_300 + 5_000 - 100_000) / 100_000
                     = 300 / 100_000
                     = 0.0030          <-- outflow does NOT depress the return

    Same CSV-shape scoping as T2.
    """
    env = validate_csv(_fixture_bytes("withdrawal_day.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    withdrawal_row = next(r for r in series if r["date"] == "2025-02-04")
    assert withdrawal_row["daily_return"] == pytest.approx(0.0030, abs=1e-9)
    # The -$5,000 outflow must NOT show up as a -5% loss.
    assert withdrawal_row["daily_return"] > -0.01


# ---------------------------------------------------------------------------
# T10 — swap/commission COST is INGESTED (included in the return, not netted).
# ---------------------------------------------------------------------------

def test_t10_cost_included_value_is_ingested() -> None:
    """T10: a swap/commission cost day shows a daily_return that INCLUDES the
    cost (the cost reduces equity_close; it is NOT in net_external_flows).

    Hand-computed flow-adjusted oracle (paper) for the cost day (fixture row
    index 3, date 2025-03-04):
        prior_close_equity = 100_000
        gross trading gain  = +$500
        swap/commission cost = -$150 (a DEAL_SWAP / DEAL_TYPE_COMMISSION — a
                              COST, NOT an external flow → net_external_flows = 0)
        equity_close = 100_000 + 500 - 150 = 100_350
        daily_return = (100_350 - 0 - 100_000) / 100_000
                     = 350 / 100_000
                     = 0.0035          <-- gross +0.5% reduced to net +0.35% by
                                           the cost (correctly lowers the return)

    SCOPE LIMIT (honest, per red-team H4): at CI level this can ONLY assert that
    the typed daily_return value is ingested/included as-is by validate_csv. It
    CANNOT verify that the EA correctly CLASSIFIED swap/commission as a cost
    rather than an external flow — that classification lives in MQL5 and is
    validated by the manual demo-account reconcile (T14, Plan 02). This is NOT a
    tautological classification test.
    """
    env = validate_csv(_fixture_bytes("cost_included.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    cost_row = next(r for r in series if r["date"] == "2025-03-04")
    # The net (post-cost) +0.35% value ingests exactly as written.
    assert cost_row["daily_return"] == pytest.approx(0.0035, abs=1e-9)


# ---------------------------------------------------------------------------
# T11 — balance-deal (CREDIT/CHARGE/BONUS/CORRECTION) value is INGESTED.
# ---------------------------------------------------------------------------

def test_t11_balance_deal_excluded_value_is_ingested() -> None:
    """T11: a flow-day daily_return reflects BALANCE/CREDIT/CHARGE/BONUS/
    CORRECTION deals already EXCLUDED by the EA (treated as external flows).

    Hand-computed flow-adjusted oracle (paper) for the balance-deal day (fixture
    row index 2, date 2025-04-03):
        prior_close_equity = 100_000
        +$2_000 CREDIT/BONUS deal (DEAL_TYPE_CREDIT — an external flow,
                EXCLUDED → net_external_flows = +2_000)
        trading gain on the day = +$400
        equity_close = 100_000 + 400 + 2_000 = 102_400
        daily_return = (102_400 - 2_000 - 100_000) / 100_000
                     = 400 / 100_000
                     = 0.0040          <-- only the +0.4% trading gain, the
                                           +$2,000 credit does NOT inflate it

    SCOPE LIMIT (honest, per red-team H4): the CI fixture asserts only that this
    post-classification value ingests cleanly. The classification correctness
    (including the DEAL_TYPE_CORRECTION default) is an EA-side (MQL5) concern
    validated by the manual demo-account reconcile (T14, Plan 02), NOT by this
    CSV fixture. This is NOT a tautological classification test.
    """
    env = validate_csv(_fixture_bytes("balance_deal_classification.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    balance_row = next(r for r in series if r["date"] == "2025-04-03")
    assert balance_row["daily_return"] == pytest.approx(0.0040, abs=1e-9)


# ===========================================================================
# Task 2 — KPI + dense-calendar + re-upload fixtures (T1, T4, T5, T6, T12, T13).
# These drive compute_all_metrics on a DENSE calendar-daily series at the LIVE
# periods=252 and assert hand-computed oracles, plus ingestion/shape pins.
# ===========================================================================


# ---------------------------------------------------------------------------
# T1 — steady DENSE calendar-daily series → KPIs match the LIVE periods=252
# oracle.
# ---------------------------------------------------------------------------

def test_t1_steady_series_kpis_match_live_periods_252_oracle() -> None:
    """T1 (must-pass class): a no-flow steady fractional series over 12 CALENDAR
    days (dense — one row per calendar day; every row a real return, NO
    zero-fill). The KPIs from compute_all_metrics are asserted against the LIVE
    quantstats periods=252 oracle.

    periods=252 (quantstats default — the SAME constant compute_all_metrics uses
    for EVERY displayed strategy KPI; MT5 MUST match for cross-strategy
    comparability on the ranking page. Do NOT plumb periods=365 — that would
    inflate Sharpe ~x1.20 vs crypto peers).

    The 12 daily returns are:
        0.004, 0.002, 0.006, 0.001, 0.005, 0.003,
        0.004, 0.002, 0.006, 0.001, 0.005, 0.003
    Hand arithmetic (paper, not Python):
        n      = 12
        sum    = 2 * (0.004+0.002+0.006+0.001+0.005+0.003) = 2 * 0.021 = 0.042
        mean   = 0.042 / 12 = 0.0035
        sample std (ddof=1) = 0.0017837651700316896
            (each half repeats the same 6 values, so deviations from the mean
             are symmetric; computed to full precision = 0.00178376517...)
        volatility = std(ddof=1) * sqrt(252)
                   = 0.0017837651700316896 * 15.874507866387544
                   = 0.028316394223456172
        sharpe     = (mean / std(ddof=1)) * sqrt(252)
                   = (0.0035 / 0.0017837651700316896) * 15.874507866387544
                   = 31.148033645801785
        total_return = (1+r).prod() - 1 = 0.04279988507317234
    These are EXACTLY what qs.stats.volatility / qs.stats.sharpe produce at the
    default periods=252 (verified this session). The daily Sharpe
    (mean/std = 1.96) stays well under the validator's 10.0 sentinel, so the same
    series also passes validate_csv.
    """
    # First confirm it ingests clean (decimals, dense calendar, no info_flags).
    env = validate_csv(_fixture_bytes("steady_series.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    assert env["info_flags"] == []

    series = env["daily_returns_series"]
    # Assert the EXACT date,daily_return rows — the hand-verifiable EA contract.
    expected_rows = [
        ("2025-01-01", 0.0040), ("2025-01-02", 0.0020), ("2025-01-03", 0.0060),
        ("2025-01-04", 0.0010), ("2025-01-05", 0.0050), ("2025-01-06", 0.0030),
        ("2025-01-07", 0.0040), ("2025-01-08", 0.0020), ("2025-01-09", 0.0060),
        ("2025-01-10", 0.0010), ("2025-01-11", 0.0050), ("2025-01-12", 0.0030),
    ]
    assert [(r["date"], r["daily_return"]) for r in series] == expected_rows

    # Drive the EXACT live KPI path: float-dtype, ascending DatetimeIndex Series
    # → compute_all_metrics with NO periods override (periods=252 default).
    returns = _series_from_envelope(env)
    result = compute_all_metrics(returns)

    assert result["volatility"] == pytest.approx(0.028316394223456172, rel=1e-9)
    assert result["sharpe"] == pytest.approx(31.148033645801785, rel=1e-9)
    assert result["cumulative_return"] == pytest.approx(0.04279988507317234, rel=1e-9)


# ---------------------------------------------------------------------------
# T5 — gap series → FEWER rows, KPIs computed over the PRESENT rows at the
# LIVE periods=252.
# ---------------------------------------------------------------------------

def test_t5_gap_series_kpis_over_present_rows_at_live_252() -> None:
    """T5 (must-pass): the EA emits a DENSE calendar-daily series, but a genuine
    outage/missing span simply yields FEWER rows for that span — NOT a zero-fill
    of the gap. The fixture is a dense calendar-daily series with a deliberate
    multi-day MISSING span (no rows for 2025-03-06 .. 2025-03-12, a full week).

    # computed at the live periods=252 (compute_all_metrics default, the
    # product-wide displayed basis). Missing days are simply absent rows;
    # quantstats annualizes the PRESENT rows by 252. Do NOT assert a
    # 365-annualized value (would inflate Sharpe ~x1.20 vs crypto peers) and do
    # NOT zero-fill the gap.

    There is NO densification step (the EA already emits one row per calendar day
    for days it was running) and NO gap rejection (the validator requires only
    strictly-increasing unique dates). The 10 PRESENT daily returns are:
        0.003, -0.002, 0.004, 0.001, -0.003,   (2025-03-01 .. 2025-03-05)
        0.005, 0.002, -0.001, 0.004, 0.002     (2025-03-13 .. 2025-03-17)
    Hand arithmetic (paper) over the 10 present rows:
        n     = 10
        sum   = 0.0015 * 10 = 0.015 → mean = 0.0015
        sample std (ddof=1) = 0.002718251071716682
        volatility = std(ddof=1) * sqrt(252)
                   = 0.002718251071716682 * 15.874507866387544
                   = 0.04315089802078284
        sharpe     = (mean / std(ddof=1)) * sqrt(252)
                   = (0.0015 / 0.002718251071716682) * 15.874507866387544
                   = 8.759956741061178
    These match qs.stats.volatility / qs.stats.sharpe at periods=252 EXACTLY
    (verified this session). A 365-annualization or a zero-filled-gap regression
    would change both values and fail this test loudly.
    """
    env = validate_csv(_fixture_bytes("gap_dense.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    # The gap span has NO rows — the validator did not densify or reject it.
    assert len(series) == 10
    present_dates = {r["date"] for r in series}
    for missing in ("2025-03-06", "2025-03-09", "2025-03-12"):
        assert missing not in present_dates, (
            f"{missing} must be ABSENT — the gap is a genuine missing span, "
            f"NOT a zero-filled row"
        )

    returns = _series_from_envelope(env)
    result = compute_all_metrics(returns)
    # Asserted at the LIVE periods=252 over the present rows (not 365, not filled).
    assert result["volatility"] == pytest.approx(0.04315089802078284, rel=1e-9)
    assert result["sharpe"] == pytest.approx(8.759956741061178, rel=1e-9)


# ---------------------------------------------------------------------------
# T6 — overnight open position → return tracks equity INCLUDING floating PnL.
# ---------------------------------------------------------------------------

def test_t6_overnight_open_position_tracks_equity() -> None:
    """T6: a day with a large overnight open-position move shows a non-flat
    return because the EA snapshots ACCOUNT_EQUITY (which includes floating PnL
    of open positions), NOT ACCOUNT_BALANCE (realized only).

    The fixture's overnight day (row index 2, date 2025-04-03) carries
    daily_return = 0.0450 (+4.5%) — driven by an overnight open position's
    floating PnL. An ACCOUNT_BALANCE-based EA would emit ~0.0 on that day (no
    realized trade), so this row pins the equity-basis contract.

    Scope: CSV-shape pin. The EA's equity-vs-balance choice is verified FINE by
    the red-team and re-confirmed in the manual T14 reconcile.
    """
    env = validate_csv(_fixture_bytes("overnight_equity.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    overnight_row = next(r for r in series if r["date"] == "2025-04-03")
    assert overnight_row["daily_return"] == pytest.approx(0.0450, abs=1e-9)
    # Decidedly NOT flat — an ACCOUNT_BALANCE EA would emit ~0 here.
    assert abs(overnight_row["daily_return"]) > 0.01

    # And it still computes through the live KPI path without precondition error.
    # best_day lives in the nested metrics_json JSONB sub-dict (set via
    # metrics_json["best_day"] = returns.max() in compute_all_metrics), NOT at
    # the proxied top level — access it through result.metrics_json.
    returns = _series_from_envelope(env)
    result = compute_all_metrics(returns)
    assert result.metrics_json["metrics_json"]["best_day"] == pytest.approx(
        0.0450, abs=1e-9
    )


# ---------------------------------------------------------------------------
# T4 — intraday-flow follows the chosen (gross-day-flow subtraction) convention.
# ---------------------------------------------------------------------------

def test_t4_intraday_flow_follows_gross_subtraction_convention() -> None:
    """T4: an intraday deposit-then-trade day whose daily_return follows the
    gross-day-flow subtraction convention.

    Hand-computed oracle (paper) for the intraday-flow day (fixture row index 3,
    date 2025-06-04):
        prior_close_equity = 100_000
        +$20_000 deposit at 09:00 (net_external_flows = +20_000)
        trading gain after the deposit = +$600 (earned on the larger base)
        equity_close = 100_000 + 20_000 + 600 = 120_600
        daily_return = (120_600 - 20_000 - 100_000) / 100_000
                     = 600 / 100_000
                     = 0.0060          <-- gross-subtraction convention

    Bounded-approximation note: for a LARGE intraday flow the gross-subtraction
    approximation error is UNBOUNDED relative to the time-weighted (Modified-
    Dietz) truth — the post-deposit trading gain was earned on the post-deposit
    capital base, not the prior base. The EA FLAGS such a day above a documented
    threshold (handled in Plan 02 / the manual T14 reconcile); the CSV itself
    stays `date,daily_return`. This test pins the chosen convention's value.
    """
    env = validate_csv(_fixture_bytes("intraday_flow.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    intraday_row = next(r for r in series if r["date"] == "2025-06-04")
    assert intraday_row["daily_return"] == pytest.approx(0.0060, abs=1e-9)


# ---------------------------------------------------------------------------
# T13 — DST boundary day → exactly ONE row (no duplicate, no skip).
# ---------------------------------------------------------------------------

def test_t13_dst_boundary_single_row() -> None:
    """T13: a dense calendar-daily fixture spanning the 2025-03-09 US spring-
    forward DST boundary, with EXACTLY ONE row for that calendar date.

    SCOPE LIMIT (honest, per red-team M7): the CI fixture can ONLY assert that
    ingestion accepts the DST-boundary date as ONE valid row (a duplicate would
    trip the validator's _strictly_increasing check; a skip would drop the day).
    The actual DST-rollover CORRECTNESS (OnTimer firing twice / zero times around
    the wall-clock jump) is 100% EA-runtime behavior with NO CI surface — it is
    an EA-side concern validated by the manual demo-account reconcile (T14, Plan
    02), NOT by this CSV fixture.
    """
    env = validate_csv(_fixture_bytes("dst_boundary.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    boundary_rows = [r for r in series if r["date"] == "2025-03-09"]
    assert len(boundary_rows) == 1, (
        f"The DST-boundary date 2025-03-09 must appear EXACTLY once; "
        f"got {len(boundary_rows)} rows"
    )


# ---------------------------------------------------------------------------
# T12 — re-upload yields exactly its own uploaded rows (no stale rows).
# ---------------------------------------------------------------------------

def test_t12_reupload_yields_exactly_uploaded_rows() -> None:
    """T12: every upload mints a FRESH strategy via finalize_csv_strategy, so a
    strategy's csv_daily_returns holds exactly THAT upload's rows — cross-upload
    stale rows are structurally impossible (red-team verified FINE). This pins
    that as an INGESTION assertion: a partial-overlap re-upload series driven
    through validate_csv yields a row set equal to EXACTLY the uploaded rows — no
    extra rows, history not truncated.

    Deferred risk (resolved decision, documented): an IN-PLACE re-upload INTO an
    EXISTING strategy_id would need a real DELETE-then-insert replace path
    (`persist_csv_daily_returns` is upsert-only). That is OUT OF SCOPE for Phase
    20 — the contract is "every upload mints a fresh strategy", so the validated
    series IS the complete row set for the new strategy.
    """
    env = validate_csv(_fixture_bytes("reupload_partial_overlap.csv"), "daily_returns")
    assert env["ok"] is True, f"errors={env.get('errors')}"
    series = env["daily_returns_series"]
    expected_rows = [
        ("2025-05-10", 0.0010),
        ("2025-05-11", 0.0020),
        ("2025-05-12", -0.0010),
        ("2025-05-13", 0.0030),
    ]
    # Exactly the uploaded set — no extra (stale) rows, none truncated.
    assert [(r["date"], r["daily_return"]) for r in series] == expected_rows
    assert len(series) == 4
