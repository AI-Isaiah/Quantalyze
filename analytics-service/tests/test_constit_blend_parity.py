"""CONSTIT-05 — THE Phase-111 parity GATE (independent numpy/pandas oracle).

WHAT THIS GATES
    No CONSTIT scenario-composer UI (plans 111-02/03/04) may merge until this
    test is green (ROADMAP 111 SC-1). It proves — with a re-derivation that
    NEVER imports or calls `src/lib/scenario.ts` — that the per-key daily-series
    blend the composer renders today is reproducible from raw per-key inputs,
    and determines WHICH interpretation of "per-position weighted blend" the
    frozen engine implements:

        A) FIXED-WEIGHT-PER-KEY  — each key weighted by its CURRENT (final-day)
           equity snapshot, held constant across the whole window. This is the
           composer's live semantics (queries.ts:2190 + scenario.ts:314-319).
        B) TIME-VARYING-PER-POSITION — each key weighted by its DRIFTING daily
           equity share (a "true book return"). RESEARCH A3's alternative
           hypothesis.

    A is ASSERTED against the committed frozen-engine golden. B is REPORTED as
    founder-facing data (the A-vs-B divergence is the datum for any future
    re-baseline conversation) — B is NEVER asserted.

FIXTURE IDENTITY
    analytics-service/tests/fixtures/constit_parity_fixture.json — 3 synthetic
    sin/cos keys over 120 consecutive days; key_b ragged-starts at index 20
    (exercises scenario.ts:422-430 pre-start member drop); deliberate front/back
    weight drift (Pitfall 1 anti-tautology: fixed-weight terminal wealth differs
    from time-varying by |Δ|=0.0122 > 1e-4); a cashflow variant (key_b deposit
    at day 70) to demonstrate the blend is TWR-based and cashflow-neutral
    (divergence-watch #7). Equities are UNITLESS capital units — no USD NAV
    magnitude is committed or printed (T-111-01 / golden_parity.py discipline).
    The golden (constit_parity_golden.json) is computeScenario's output for the
    SAME fixture, captured ONCE by scripts/capture-constit-parity-golden.ts.

TOLERANCES
    - Curve A vs golden.portfolio_daily_returns (UNROUNDED, full-res): the
      per-day blended return series at atol/rtol 1e-9 (pure float, same op
      order — anything looser signals a real semantic gap), and the derived
      cumulative curve likewise.
    - KPIs A vs golden: the golden is ENGINE-ROUNDED (5dp for twr/cagr/vol/
      maxDD, 3dp for sharpe/sortino), so tolerance is the rounding granularity
      with margin: atol 1e-5 (5dp) / 1e-3 (3dp). A REAL divergence between A and
      the engine (A re-derives the engine's own arithmetic) would be orders of
      magnitude larger, so these still genuinely gate.

HARD STOP
    If A fails parity, DO NOT loosen tolerances or edit the oracle/golden to
    force green — that defeats the gate. Surface the divergence as a founder
    re-baseline decision (CONTEXT protocol → .planning/PROJECT.md Key Decisions)
    and block all Wave-2 UI work.

stdlib + pandas + numpy ONLY. No import of scenario.ts, services.*, or any TS
runtime; inputs come exclusively from the two committed fixture JSONs.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_FIXTURE_DIR = Path(__file__).parent / "fixtures"
_PPY = 365  # all-crypto blend basis (#597)
_CALENDAR_DAYS_PER_YEAR = 365.25  # scenario.ts calendarYears (closed-sets.ts:179)

# Curve parity: same float arithmetic, same op order → machine-precision.
_CURVE_ATOL = 1e-9
_CURVE_RTOL = 1e-9
# KPI parity: golden is engine-rounded → tolerance = rounding granularity + margin.
_KPI_ATOL_5DP = 1e-5  # twr, cagr, volatility, max_drawdown
_KPI_ATOL_3DP = 1e-3  # sharpe, sortino


# ── Fixture loaders ──────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def fixture() -> dict:
    with open(_FIXTURE_DIR / "constit_parity_fixture.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def golden() -> dict:
    with open(_FIXTURE_DIR / "constit_parity_golden.json") as f:
        return json.load(f)


# ── Raw-input helpers (never touch scenario.ts) ──────────────────────────────
def _union_axis(fixture: dict) -> list[str]:
    """Engine union date-axis: sorted union of every key's dates (each key's
    series only holds dates >= its own include-from), scenario.ts:359-376."""
    dates: set[str] = set()
    for key in fixture["keys"].values():
        for pt in key["daily_returns"]:
            dates.add(pt["date"])
    return sorted(dates)


def _returns_frame(fixture: dict, axis: list[str]) -> pd.DataFrame:
    """Per-key returns aligned on the union axis. A key contributes its return
    on days >= its start_date, else NaN (→ dropped from BOTH numerator and
    denominator, replicating the engine's `commonDates[i] < from` continue)."""
    cols = {}
    for kid, key in fixture["keys"].items():
        s = pd.Series(
            {pt["date"]: pt["value"] for pt in key["daily_returns"]},
            dtype="float64",
        )
        cols[kid] = s.reindex(axis)  # missing (pre-start) → NaN
    return pd.DataFrame(cols, index=axis)


def _blend_fixed_weight(fixture: dict) -> pd.Series:
    """Interpretation A — fixed-weight-per-key blend (composer semantics).

    Per day: r_i = Σ_k w_k·ret_{k,i} / Σ_k w_k over STARTED keys (NaN keys drop
    from both sums). w_k = the key's final-day equity (current-equity snapshot),
    held constant. Normalization cancels, so raw engine weights suffice.
    Blend-THEN-compound (divergence-watch #2)."""
    axis = _union_axis(fixture)
    rets = _returns_frame(fixture, axis)
    weights = pd.Series(
        {kid: key["engine_weight"] for kid, key in fixture["keys"].items()},
        dtype="float64",
    )
    started = rets.notna()  # True where key has started (in denominator)
    num = (rets.fillna(0.0) * weights).sum(axis=1)
    den = (started * weights).sum(axis=1)
    return num / den.where(den > 0, other=np.nan)


def _blend_time_varying(
    fixture: dict, equity_source: str
) -> pd.Series:
    """Interpretation B — time-varying-per-position ("true book return").

    Weight each key each day by its BEGINNING-OF-DAY equity share
    w_k(i) = E_k(i-1) / Σ E(i-1) (base_capital at inception). REPORT ONLY.

    `equity_source` selects the per-key equity path key:
      - "equity_path"                → clean compounded equity
      - "equity_path_with_deposit"   → key_b's deposit-stepped equity (others
        clean); demonstrates cashflow sensitivity of a $-equity-weighted book."""
    axis = _union_axis(fixture)
    rets = _returns_frame(fixture, axis)

    # Beginning-of-day equity per key on the union axis.
    equity_cols = {}
    for kid, key in fixture["keys"].items():
        if equity_source == "equity_path_with_deposit" and kid == "key_b":
            path = fixture["cashflow_variant"]["equity_path_with_deposit"]
        else:
            path = key["equity_path"]
        end_of_day = pd.Series(
            {pt["date"]: pt["equity"] for pt in path}, dtype="float64"
        ).reindex(axis)
        # Beginning-of-day equity = prior day's end-of-day; at a key's first
        # active day use its base_capital (no prior close yet).
        bod = end_of_day.shift(1)
        first_active = end_of_day.first_valid_index()
        if first_active is not None:
            bod.loc[first_active] = key["base_capital"]
        equity_cols[kid] = bod
    equity = pd.DataFrame(equity_cols, index=axis)

    started = rets.notna()
    w = equity.where(started)  # only started keys carry weight
    num = (rets.fillna(0.0) * w.fillna(0.0)).sum(axis=1)
    den = w.sum(axis=1)
    return num / den.where(den > 0, other=np.nan)


def _cumulative(port_daily: pd.Series) -> np.ndarray:
    return np.cumprod(1.0 + port_daily.to_numpy())


def _calendar_years(first: str, last: str) -> float:
    ms = (pd.Timestamp(last) - pd.Timestamp(first)).total_seconds() * 1000.0
    return ms / (_CALENDAR_DAYS_PER_YEAR * 86_400_000.0) if ms > 0 else 0.0


def _kpis(port_daily: pd.Series, axis: list[str]) -> dict:
    r = port_daily.to_numpy()
    n = len(r)
    cum = _cumulative(port_daily)
    twr = cum[-1] - 1.0
    years = _calendar_years(axis[0], axis[-1])
    cagr = math.pow(1.0 + twr, 1.0 / years) - 1.0 if years > 0 else None

    mean_r = r.mean()
    # sample std (ddof=1) × √ppy (scenario.ts:533-536)
    variance = ((r - mean_r) ** 2).sum() / (n - 1)
    vol = math.sqrt(variance) * math.sqrt(_PPY)
    sharpe = (mean_r * _PPY) / vol if vol > 0 else None

    # sortino: downside RMS ÷ TOTAL n, × √ppy (scenario.ts:550-557)
    downside_sumsq = float((np.where(r < 0, r, 0.0) ** 2).sum())
    downside_vol = math.sqrt(downside_sumsq / n) * math.sqrt(_PPY)
    sortino = (mean_r * _PPY) / downside_vol if downside_vol > 0 else None

    # max drawdown from running peak of cumulative (scenario.ts:560-574)
    peak = cum[0]
    max_dd = 0.0
    cur_dur = 0
    max_dur = 0
    for v in cum:
        if v > peak:
            peak = v
            cur_dur = 0
        else:
            cur_dur += 1
        dd = v / peak - 1.0
        if dd < max_dd:
            max_dd = dd
        if cur_dur > max_dur:
            max_dur = cur_dur

    return {
        "twr": twr,
        "cagr": cagr,
        "volatility": vol,
        "sharpe": sharpe,
        "sortino": sortino,
        "max_drawdown": max_dd,
        "max_dd_days": max_dur,
        "n": n,
    }


# ── THE GATE: interpretation A vs the frozen-engine golden ───────────────────
def test_A_daily_return_curve_matches_engine(fixture, golden):
    """A's per-day blended return series == golden.portfolio_daily_returns
    (UNROUNDED) at machine precision. This IS the parity assertion."""
    axis = _union_axis(fixture)
    port_a = _blend_fixed_weight(fixture)

    golden_pdr = golden["portfolio_daily_returns"]
    golden_dates = [p["date"] for p in golden_pdr]
    golden_vals = np.array([p["value"] for p in golden_pdr], dtype="float64")

    assert golden_dates == axis, "axis mismatch (A vs engine date axis)"
    np.testing.assert_allclose(
        port_a.to_numpy(),
        golden_vals,
        atol=_CURVE_ATOL,
        rtol=_CURVE_RTOL,
        err_msg=(
            "CONSTIT-05 HARD STOP: interpretation A (fixed-weight) daily blend "
            "DIVERGES from the frozen engine. DO NOT loosen this tolerance — "
            "surface a re-baseline decision to the founder."
        ),
    )


def test_A_cumulative_curve_matches_engine(fixture, golden):
    """A's cumulative curve (blend-then-compound) reproduces the engine's
    downsampled equity_curve at its 5dp rounding granularity."""
    axis = _union_axis(fixture)
    port_a = _blend_fixed_weight(fixture)
    cum_return = _cumulative(port_a) - 1.0  # engine equity_curve is return-form
    by_date = dict(zip(axis, cum_return))

    for pt in golden["equity_curve"]:
        assert pt["date"] in by_date
        np.testing.assert_allclose(
            by_date[pt["date"]], pt["value"], atol=_KPI_ATOL_5DP, rtol=0,
        )


def test_A_kpis_match_engine(fixture, golden):
    """A's KPIs reproduce the engine golden within its rounding granularity."""
    axis = _union_axis(fixture)
    kpis = _kpis(_blend_fixed_weight(fixture), axis)
    g = golden["kpis"]

    assert kpis["n"] == golden["n"]
    assert kpis["max_dd_days"] == g["max_dd_days"]
    for field, atol in (
        ("twr", _KPI_ATOL_5DP),
        ("cagr", _KPI_ATOL_5DP),
        ("volatility", _KPI_ATOL_5DP),
        ("max_drawdown", _KPI_ATOL_5DP),
        ("sharpe", _KPI_ATOL_3DP),
        ("sortino", _KPI_ATOL_3DP),
    ):
        np.testing.assert_allclose(
            kpis[field], g[field], atol=atol, rtol=0,
            err_msg=f"CONSTIT-05 KPI parity failed on {field}",
        )


def test_gap_fill_semantics():
    """Pre-start key drops from BOTH numerator and denominator; a STARTED key
    with a 0.0 gap-filled return stays in the denominator (scenario.ts:422-430).
    Encoded as a focused synthetic case so the rule is guarded independently of
    the (dense) main fixture."""
    axis = ["2024-01-01", "2024-01-02", "2024-01-03"]
    mini = {
        "keys": {
            # k1 started throughout; day 2 is a 0.0 gap-filled return.
            "k1": {
                "start_date": "2024-01-01",
                "engine_weight": 3.0,
                "base_capital": 1.0,
                "daily_returns": [
                    {"date": "2024-01-01", "value": 0.10},
                    {"date": "2024-01-02", "value": 0.00},  # gap-filled 0.0
                    {"date": "2024-01-03", "value": 0.10},
                ],
                "equity_path": [],
            },
            # k2 ragged-starts on day 2 → absent from day 1's blend entirely.
            "k2": {
                "start_date": "2024-01-02",
                "engine_weight": 1.0,
                "base_capital": 1.0,
                "daily_returns": [
                    {"date": "2024-01-02", "value": 0.20},
                    {"date": "2024-01-03", "value": 0.20},
                ],
                "equity_path": [],
            },
        }
    }
    blend = _blend_fixed_weight(mini)

    # Day 1: only k1 started → r = 0.10 (k2 excluded from num AND denom).
    assert blend.loc["2024-01-01"] == pytest.approx(0.10)
    # Day 2: k1 has a 0.0 return but STAYS in the denominator (weight 3), k2
    # contributes 0.20 (weight 1): r = (3·0.0 + 1·0.20)/(3+1) = 0.05.
    assert blend.loc["2024-01-02"] == pytest.approx(0.05)
    # Day 3: both active: r = (3·0.10 + 1·0.20)/4 = 0.125.
    assert blend.loc["2024-01-03"] == pytest.approx(0.125)


# ── REPORT (no assert): the A-vs-B divergence — founder-facing datum ──────────
def test_report_A_vs_B_divergence(fixture, golden, capsys):
    """REPORT interpretation B (time-varying-per-position) vs A and vs the
    engine. B's divergence is DATA, not failure — it is the magnitude a future
    'true book return' re-baseline would shift displayed numbers by (RESEARCH
    A3). Also reports the cashflow variant: B on the deposit-stepped equity vs B
    clean, demonstrating a $-equity-weighted book reacts to cashflows while the
    TWR blend (A) does not (divergence-watch #7). Ratios/returns only — no USD
    magnitudes printed (T-111-01)."""
    axis = _union_axis(fixture)
    port_a = _blend_fixed_weight(fixture)
    port_b = _blend_time_varying(fixture, "equity_path")
    port_b_cf = _blend_time_varying(fixture, "equity_path_with_deposit")

    tw_a = float(_cumulative(port_a)[-1])
    tw_b = float(_cumulative(port_b)[-1])
    tw_b_cf = float(_cumulative(port_b_cf)[-1])

    max_curve_div = float(np.max(np.abs(port_a.to_numpy() - port_b.to_numpy())))
    terminal_delta_ab = tw_a - tw_b
    cashflow_neutrality_delta = tw_b_cf - tw_b

    # KPI deltas (A is the engine golden; report B's KPI shift).
    kpis_a = _kpis(port_a, axis)
    kpis_b = _kpis(port_b, axis)

    lines = [
        "",
        "── CONSTIT-05 A-vs-B divergence report (founder-facing) ──",
        f"  interpretation A (fixed-weight-per-key)   : terminal wealth mult = {tw_a:.8f}",
        f"  interpretation B (time-varying-per-pos)   : terminal wealth mult = {tw_b:.8f}",
        f"  A−B terminal-wealth delta                 : {terminal_delta_ab:+.8f}",
        f"  A−B max abs daily-return divergence       : {max_curve_div:.2e}",
        f"  TWR   A={kpis_a['twr']:+.6f}  B={kpis_b['twr']:+.6f}  Δ={kpis_a['twr']-kpis_b['twr']:+.6f}",
        f"  Sharpe A={kpis_a['sharpe']:.4f}  B={kpis_b['sharpe']:.4f}",
        f"  maxDD A={kpis_a['max_drawdown']:+.6f}  B={kpis_b['max_drawdown']:+.6f}",
        "  cashflow variant (divergence-watch #7):",
        f"    B(deposit-stepped equity) − B(clean)    : {cashflow_neutrality_delta:+.8f}",
        f"    → A is cashflow-NEUTRAL by construction (TWR series unchanged);",
        f"      a $-equity-weighted book (B) shifts by the above under a deposit.",
        "  VERDICT: the composer renders interpretation A (asserted == engine).",
        f"           A 'true book return' (B) differs by {terminal_delta_ab:+.6f} terminal wealth.",
        "──────────────────────────────────────────────────────────",
    ]
    print("\n".join(lines))

    # Sanity: B genuinely diverges from A (fixture is non-tautological). This is
    # NOT the gate — it guards the fixture, not the engine.
    assert max_curve_div > 1e-6, "fixture tautological: A and B do not diverge"
    # And the cashflow variant genuinely moves B (deposit is non-trivial).
    assert abs(cashflow_neutrality_delta) > 1e-9
