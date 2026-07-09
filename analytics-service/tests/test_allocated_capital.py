"""Unit tests for the allocated-capital returns denominator (Zavara-only override).

Covers: config parse/validate fail-loud, capital-schedule lookup, Option-2
daily_pnl_usd valuation (native × marks, USD-family ≡ 1.0, missing-mark fail-loud),
and the zavara-convention metrics (arithmetic cumulative, √365 Sharpe/Sortino,
cumulative-% max drawdown, active-day vs calendar-day)."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest

from services.allocated_capital import (
    ALLOCATED_CAPITAL_GUARD_KEYS,
    AllocatedCapitalValuationError,
    CapitalScheduleEntry,
    ReturnsDenominatorConfig,
    ReturnsDenominatorConfigError,
    allocated_capital_returns_and_metrics,
    capital_on_date,
    daily_pnl_usd_series,
    metrics_day_basis,
    parse_returns_denominator_config,
)

# The zavara capital schedule (the real fixture — NOT attached to any live row).
_ZAVARA_CONFIG_RAW = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [
        {"effective_from": "2025-08-03", "capital_usd": 4000000},
        {"effective_from": "2025-09-27", "capital_usd": 10000000},
        {"effective_from": "2025-12-16", "capital_usd": 1000000},
        {"effective_from": "2026-02-01", "capital_usd": 2000000},
    ],
    "metrics_basis": "active_day",
}


def _series(pairs: list[tuple[str, float]]) -> pd.Series:
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d, _ in pairs])
    return pd.Series([v for _, v in pairs], index=idx, dtype=float)


# ---------------------------------------------------------------------------
# parse_returns_denominator_config
# ---------------------------------------------------------------------------


def test_parse_none_and_empty_are_no_override() -> None:
    """None / empty-dict ⇒ None (the normal NAV path — every non-override strat)."""
    assert parse_returns_denominator_config(None) is None
    assert parse_returns_denominator_config({}) is None


def test_parse_valid_zavara_config() -> None:
    cfg = parse_returns_denominator_config(_ZAVARA_CONFIG_RAW)
    assert cfg is not None
    assert cfg.denominator == "allocated_capital"
    assert cfg.pnl_basis == "cash_settlement"
    assert cfg.metrics_basis == "active_day"
    assert len(cfg.capital_schedule) == 4
    assert cfg.capital_schedule[0] == CapitalScheduleEntry(date(2025, 8, 3), 4000000.0)
    assert cfg.capital_schedule[-1].capital_usd == 2000000.0


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: {**c, "denominator": "nav"},
        lambda c: {**c, "pnl_basis": "realized_only"},
        lambda c: {**c, "metrics_basis": "weekly"},
        lambda c: {**c, "capital_schedule": []},
        lambda c: {**c, "capital_schedule": "not-a-list"},
    ],
)
def test_parse_rejects_bad_enums_and_empty_schedule(mutate: object) -> None:
    bad = mutate(_ZAVARA_CONFIG_RAW)  # type: ignore[operator]
    with pytest.raises(ReturnsDenominatorConfigError):
        parse_returns_denominator_config(bad)


def test_parse_rejects_non_ascending_dates() -> None:
    bad = {
        **_ZAVARA_CONFIG_RAW,
        "capital_schedule": [
            {"effective_from": "2025-09-27", "capital_usd": 10000000},
            {"effective_from": "2025-08-03", "capital_usd": 4000000},  # out of order
        ],
    }
    with pytest.raises(ReturnsDenominatorConfigError, match="ASCENDING"):
        parse_returns_denominator_config(bad)


def test_parse_rejects_equal_dates() -> None:
    bad = {
        **_ZAVARA_CONFIG_RAW,
        "capital_schedule": [
            {"effective_from": "2025-08-03", "capital_usd": 4000000},
            {"effective_from": "2025-08-03", "capital_usd": 5000000},  # duplicate
        ],
    }
    with pytest.raises(ReturnsDenominatorConfigError, match="ASCENDING"):
        parse_returns_denominator_config(bad)


@pytest.mark.parametrize("cap", [0, -1000000, float("nan"), float("inf"), True, "4e6"])
def test_parse_rejects_non_positive_or_nonnumeric_capital(cap: object) -> None:
    bad = {
        **_ZAVARA_CONFIG_RAW,
        "capital_schedule": [{"effective_from": "2025-08-03", "capital_usd": cap}],
    }
    with pytest.raises(ReturnsDenominatorConfigError):
        parse_returns_denominator_config(bad)


@pytest.mark.parametrize("bad_from", ["", "  ", "2025-13-01", "notadate", 20250803])
def test_parse_rejects_bad_effective_from(bad_from: object) -> None:
    bad = {
        **_ZAVARA_CONFIG_RAW,
        "capital_schedule": [{"effective_from": bad_from, "capital_usd": 4000000}],
    }
    with pytest.raises(ReturnsDenominatorConfigError):
        parse_returns_denominator_config(bad)


# ---------------------------------------------------------------------------
# capital_on_date
# ---------------------------------------------------------------------------


def test_capital_on_date_selects_the_in_force_tranche() -> None:
    cfg = parse_returns_denominator_config(_ZAVARA_CONFIG_RAW)
    assert cfg is not None
    sched = cfg.capital_schedule
    assert capital_on_date(sched, pd.Timestamp("2025-08-03")) == 4_000_000.0  # boundary
    assert capital_on_date(sched, pd.Timestamp("2025-09-26")) == 4_000_000.0  # last day
    assert capital_on_date(sched, pd.Timestamp("2025-09-27")) == 10_000_000.0  # switch
    assert capital_on_date(sched, pd.Timestamp("2025-12-31")) == 1_000_000.0
    assert capital_on_date(sched, pd.Timestamp("2026-06-01")) == 2_000_000.0  # open-ended


def test_capital_on_date_before_schedule_fails_loud() -> None:
    cfg = parse_returns_denominator_config(_ZAVARA_CONFIG_RAW)
    assert cfg is not None
    with pytest.raises(AllocatedCapitalValuationError, match="precedes"):
        capital_on_date(cfg.capital_schedule, pd.Timestamp("2025-08-02"))


# ---------------------------------------------------------------------------
# daily_pnl_usd_series (Option 2)
# ---------------------------------------------------------------------------


def test_daily_pnl_usd_usd_family_mark_is_one() -> None:
    """A USD-family currency's native P&L passes through as USD (mark ≡ 1.0)."""
    native = {"USDC": _series([("2025-08-03", 1234.0), ("2025-08-04", -56.0)])}
    out = daily_pnl_usd_series(native, marks={})
    assert out.loc[pd.Timestamp("2025-08-03")] == pytest.approx(1234.0)
    assert out.loc[pd.Timestamp("2025-08-04")] == pytest.approx(-56.0)


def test_daily_pnl_usd_indexed_times_mark() -> None:
    """An indexed coin's native P&L is valued at its same-day mark."""
    native = {"BTC": _series([("2025-08-03", 1.0), ("2025-08-04", -0.5)])}
    marks = {"BTC": _series([("2025-08-03", 100000.0), ("2025-08-04", 90000.0)])}
    out = daily_pnl_usd_series(native, marks)
    assert out.loc[pd.Timestamp("2025-08-03")] == pytest.approx(100000.0)
    assert out.loc[pd.Timestamp("2025-08-04")] == pytest.approx(-45000.0)


def test_daily_pnl_usd_sums_multi_currency_same_day() -> None:
    native = {
        "BTC": _series([("2025-08-03", 1.0)]),
        "USDC": _series([("2025-08-03", 250.0)]),
    }
    marks = {"BTC": _series([("2025-08-03", 100000.0)])}
    out = daily_pnl_usd_series(native, marks)
    assert out.loc[pd.Timestamp("2025-08-03")] == pytest.approx(100250.0)


def test_daily_pnl_usd_missing_mark_fails_loud() -> None:
    """An indexed coin P&L day with NO same-day mark fails loud (never 1.0)."""
    native = {"BTC": _series([("2025-08-03", 1.0), ("2025-08-04", 0.5)])}
    marks = {"BTC": _series([("2025-08-03", 100000.0)])}  # 08-04 mark missing
    with pytest.raises(AllocatedCapitalValuationError, match="no same-day"):
        daily_pnl_usd_series(native, marks)


def test_daily_pnl_usd_indexed_no_marks_at_all_fails_loud() -> None:
    native = {"BTC": _series([("2025-08-03", 1.0)])}
    with pytest.raises(AllocatedCapitalValuationError, match="no daily USD marks"):
        daily_pnl_usd_series(native, marks={})


# ---------------------------------------------------------------------------
# allocated_capital_returns_and_metrics
# ---------------------------------------------------------------------------


def test_metrics_cumulative_and_maxdd_hand_computed() -> None:
    """Constant $1M capital, constant $100k BTC mark. Native P&L +1.0 / −0.5 / +2.0
    → returns +10% / −5% / +20% → cumulative 25%, and a real drawdown (peak 10 →
    trough 5) → maxDD −5%."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="active_day",
    )
    native = {"BTC": _series([
        ("2025-08-03", 1.0), ("2025-08-04", -0.5), ("2025-08-05", 2.0),
    ])}
    marks = {"BTC": _series([
        ("2025-08-03", 100000.0), ("2025-08-04", 100000.0), ("2025-08-05", 100000.0),
    ])}
    returns, meta = allocated_capital_returns_and_metrics(native, marks, cfg)

    assert returns.loc[pd.Timestamp("2025-08-03")] == pytest.approx(0.10)
    assert returns.loc[pd.Timestamp("2025-08-04")] == pytest.approx(-0.05)
    assert returns.loc[pd.Timestamp("2025-08-05")] == pytest.approx(0.20)
    assert meta["returns_denominator"] == "allocated_capital"
    assert meta["cumulative_return_pct"] == pytest.approx(25.0)
    assert meta["max_drawdown_pct"] == pytest.approx(-5.0)
    assert meta["n_active_days"] == 3
    assert meta["n_calendar_days"] == 3  # 08-03..08-05 dense, no gaps
    # Sharpe is the headline (active-day) and matches the √365 formula.
    r = np.array([0.10, -0.05, 0.20])
    expected_sharpe = r.mean() / r.std(ddof=1) * np.sqrt(365.0)
    assert meta["sharpe"] == pytest.approx(expected_sharpe)
    assert meta["sharpe"] == meta["sharpe_active_day"]
    assert np.isfinite(meta["sortino"])


def test_metrics_calendar_day_fills_gaps_with_zero() -> None:
    """A gap day (no activity) is a 0.0 calendar-day return: n_calendar spans the
    full [first,last] range while n_active counts only nonzero-P&L days."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="calendar_day",
    )
    native = {"BTC": _series([("2025-08-03", 1.0), ("2025-08-06", -1.0)])}  # gap 04,05
    marks = {"BTC": _series([("2025-08-03", 100000.0), ("2025-08-06", 100000.0)])}
    _returns, meta = allocated_capital_returns_and_metrics(native, marks, cfg)
    assert meta["n_active_days"] == 2
    assert meta["n_calendar_days"] == 4  # 08-03,04,05,06
    assert meta["cumulative_return_pct"] == pytest.approx(0.0)  # +10% then −10%
    # metrics_basis=calendar_day → headline sharpe is the calendar-day one.
    assert meta["sharpe"] == meta["sharpe_calendar_day"]


def test_metrics_excludes_pre_mandate_days() -> None:
    """P&L days BEFORE the schedule's first effective_from (the account's pre-mandate
    trading history — a Deribit txn-log reaches inception) are EXCLUDED from the
    allocated-capital track; the window is [mandate start, last activity]."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="active_day",
    )
    native = {"BTC": _series([
        ("2025-07-20", 5.0),    # PRE-mandate (before 2025-08-03) → excluded
        ("2025-08-03", 1.0),    # mandate start → +10%
        ("2025-08-04", -0.5),   # → −5%
    ])}
    marks = {"BTC": _series([
        ("2025-07-20", 100000.0),
        ("2025-08-03", 100000.0),
        ("2025-08-04", 100000.0),
    ])}
    returns, meta = allocated_capital_returns_and_metrics(native, marks, cfg)
    assert pd.Timestamp("2025-07-20") not in returns.index
    assert meta["n_active_days"] == 2  # only 08-03, 08-04
    # +10% then −5%, the huge pre-mandate +500% day dropped.
    assert meta["cumulative_return_pct"] == pytest.approx(5.0)
    # Fix B telemetry: the excluded pre-mandate activity day is counted + flagged.
    assert meta["n_pre_mandate_days_excluded"] == 1
    assert meta["n_post_mandate_days_excluded"] == 0
    assert meta["mandate_window_excluded_days"] is True


def test_metrics_mandate_end_cap_excludes_post_window_tail() -> None:
    """Fix B: a ``mandate_end`` caps the reporting-window END — post-mandate
    winding-down activity is EXCLUDED (with telemetry), so a spurious late drawdown
    never drags the factsheet."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="active_day",
        cumulative_method="simple",
        mandate_end=date(2025, 8, 5),
    )
    native = {"BTC": _series([
        ("2025-08-03", 1.0),    # +10%  (in window)
        ("2025-08-04", 0.5),    # +5%   (in window)
        ("2025-08-05", 0.2),    # +2%   (== mandate_end, inclusive)
        ("2025-08-10", -3.0),   # −30%  POST-mandate winding-down → excluded
    ])}
    marks = {"BTC": _series([
        ("2025-08-03", 100000.0), ("2025-08-04", 100000.0),
        ("2025-08-05", 100000.0), ("2025-08-10", 100000.0),
    ])}
    returns, meta = allocated_capital_returns_and_metrics(native, marks, cfg)
    assert pd.Timestamp("2025-08-10") not in returns.index
    assert meta["n_active_days"] == 3
    # Σ = 10 + 5 + 2 = 17% — the −30% post-mandate crash is NOT in the number.
    assert meta["cumulative_return_pct"] == pytest.approx(17.0)
    # The uncapped window would have shown a deep drawdown from the −30% day; capped
    # it is monotone-up → no drawdown.
    assert meta["max_drawdown_pct"] == pytest.approx(0.0)
    assert meta["n_post_mandate_days_excluded"] == 1
    assert meta["n_pre_mandate_days_excluded"] == 0
    assert meta["mandate_window_excluded_days"] is True


def test_metrics_no_exclusion_leaves_no_warn_flag() -> None:
    """When every activity day is IN-window, no exclusion flag is raised (a clean
    mandate rides `complete`, not `complete_with_warnings`)."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="active_day",
        mandate_end=date(2025, 8, 31),
    )
    native = {"BTC": _series([("2025-08-03", 1.0), ("2025-08-04", -0.5)])}
    marks = {"BTC": _series([("2025-08-03", 100000.0), ("2025-08-04", 100000.0)])}
    _returns, meta = allocated_capital_returns_and_metrics(native, marks, cfg)
    assert meta["n_pre_mandate_days_excluded"] == 0
    assert meta["n_post_mandate_days_excluded"] == 0
    assert "mandate_window_excluded_days" not in meta


def test_mark_zero_negative_or_inf_fails_loud() -> None:
    """Fix D: a PRESENT but zero / negative / non-finite mark is rejected (a 0.0
    mark would silently zero the day's P&L; neg sign-flips; inf → inf USD)."""
    native = {"BTC": _series([("2025-08-03", 1.0), ("2025-08-04", 0.5)])}
    for bad in (0.0, -100000.0, float("inf")):
        marks = {"BTC": _series([("2025-08-03", 100000.0), ("2025-08-04", bad)])}
        with pytest.raises(
            AllocatedCapitalValuationError, match="non-finite or non-positive"
        ):
            daily_pnl_usd_series(native, marks)


def test_parse_cumulative_method_and_mandate_end() -> None:
    """Fix A/B config: cumulative_method (default geometric) + mandate_end parse."""
    raw = dict(_ZAVARA_CONFIG_RAW)
    # Absent ⇒ geometric default; mandate_end absent ⇒ None.
    cfg = parse_returns_denominator_config(raw)
    assert cfg is not None
    assert cfg.cumulative_method == "geometric"
    assert cfg.mandate_end is None
    # Present + valid.
    cfg2 = parse_returns_denominator_config(
        {**raw, "cumulative_method": "simple", "mandate_end": "2026-04-30"}
    )
    assert cfg2 is not None
    assert cfg2.cumulative_method == "simple"
    assert cfg2.mandate_end == date(2026, 4, 30)
    # Invalid cumulative_method fails loud.
    with pytest.raises(ReturnsDenominatorConfigError, match="cumulative_method"):
        parse_returns_denominator_config({**raw, "cumulative_method": "bogus"})
    # mandate_end on/before the schedule start fails loud.
    with pytest.raises(ReturnsDenominatorConfigError, match="mandate_end"):
        parse_returns_denominator_config({**raw, "mandate_end": "2025-08-03"})
    with pytest.raises(ReturnsDenominatorConfigError, match="mandate_end"):
        parse_returns_denominator_config({**raw, "mandate_end": "not-a-date"})


def test_metrics_zero_activity_is_neutral() -> None:
    cfg = parse_returns_denominator_config(_ZAVARA_CONFIG_RAW)
    assert cfg is not None
    returns, meta = allocated_capital_returns_and_metrics({}, {}, cfg)
    assert len(returns) == 0
    assert meta["cumulative_return_pct"] == 0.0
    assert meta["n_active_days"] == 0
    assert np.isnan(meta["sharpe"])


# ---------------------------------------------------------------------------
# Finding 5a — automated parity: the two INDEPENDENT metric implementations
# (allocated_capital_returns_and_metrics meta vs compute_all_metrics on the
# simple/active/365 conventions) MUST agree on the headline scalars so they can
# never silently drift (the SHIPPED factsheet uses compute_all_metrics; ac_meta
# rides alongside — this pins them together).
# ---------------------------------------------------------------------------


def test_parity_compute_all_metrics_matches_allocated_meta() -> None:
    """The allocated-capital meta scalars (sharpe / sortino / cumulative / maxDD)
    equal what ``compute_all_metrics`` computes for the SAME conventions on the SAME
    (dense gap-filled) returns — a multi-tranche synthetic USDC fixture (marks ≡
    1.0). If either implementation changes its formula, this reddens."""
    from services.metrics import compute_all_metrics

    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(
            CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),
            CapitalScheduleEntry(date(2025, 8, 6), 2_000_000.0),  # second tranche
        ),
        metrics_basis="active_day",
    )
    native = {"USDC": _series([
        ("2025-08-03", 10000.0), ("2025-08-04", -5000.0), ("2025-08-05", 20000.0),
        ("2025-08-06", -8000.0), ("2025-08-07", 30000.0), ("2025-08-08", -12000.0),
    ])}
    returns, meta = allocated_capital_returns_and_metrics(native, {}, cfg)

    # The SAME dense, 0-gap-filled Series the shipped path (combine_native_ledger →
    # compute_all_metrics) consumes.
    dense = returns.reindex(
        pd.date_range(returns.index.min(), returns.index.max(), freq="D"),
        fill_value=0.0,
    )
    m = compute_all_metrics(
        dense, periods_per_year=365, cumulative_method="simple", day_basis="active",
    ).metrics_json

    # compute is a FRACTION; allocated meta is a PERCENT.
    assert m["cumulative_return"] * 100.0 == pytest.approx(
        meta["cumulative_return_pct"], abs=1e-9
    )
    assert m["max_drawdown"] * 100.0 == pytest.approx(
        meta["max_drawdown_pct"], abs=1e-9
    )
    # Sharpe / Sortino: both √365-annualised on the active (nonzero-day) series.
    assert m["sharpe"] == pytest.approx(meta["sharpe"], rel=1e-9)
    assert m["sortino"] == pytest.approx(meta["sortino"], rel=1e-9)


# ===========================================================================
# B2 — metrics_day_basis: exhaustive fail-loud map (no silent calendar default).
# S2 — type-owned invariants (__post_init__) + mandate_end vs LAST tranche.
# T5 — empty-post-filter window with nonzero exclusion counts.
# L1 — exclusion counts on ACTIVITY days only (a net-zero pre-mandate day never
#      spuriously raises the warn flag).
# S3 — the single-owner ALLOCATED_CAPITAL_GUARD_KEYS constant.
# ===========================================================================


def test_metrics_day_basis_exhaustive_fail_loud() -> None:
    """B2: the map raises on an unknown metrics_basis rather than silently shipping
    a calendar Sharpe basis on the money path."""
    assert metrics_day_basis("active_day") == "active"
    assert metrics_day_basis("calendar_day") == "calendar"
    with pytest.raises(ReturnsDenominatorConfigError, match="metrics_basis"):
        metrics_day_basis("weekly")
    with pytest.raises(ReturnsDenominatorConfigError, match="metrics_basis"):
        metrics_day_basis("")


@pytest.mark.parametrize("bad_cap", [0.0, -1.0, float("inf"), float("nan"), True])
def test_capital_schedule_entry_post_init_rejects_bad_capital(bad_cap: object) -> None:
    """S2: the invariant lives in the TYPE — a directly-constructed entry with a
    non-positive / non-finite / bool capital_usd raises (bypassing the parse
    factory is no longer an escape hatch)."""
    with pytest.raises(ReturnsDenominatorConfigError):
        CapitalScheduleEntry(effective_from=date(2025, 8, 3), capital_usd=bad_cap)  # type: ignore[arg-type]


def _valid_entry() -> CapitalScheduleEntry:
    return CapitalScheduleEntry(effective_from=date(2025, 8, 3), capital_usd=1_000_000.0)


@pytest.mark.parametrize(
    "field,value",
    [
        ("denominator", "nav"),
        ("pnl_basis", "settlement"),
        ("metrics_basis", "weekly"),
        ("cumulative_method", "log"),
    ],
)
def test_returns_denominator_config_post_init_rejects_bad_enum(
    field: str, value: str
) -> None:
    """S2: a directly-constructed config with a bad enum raises via __post_init__."""
    kwargs: dict[str, object] = dict(
        denominator="allocated_capital",
        pnl_basis="cash_settlement",
        capital_schedule=(_valid_entry(),),
        metrics_basis="active_day",
        cumulative_method="simple",
    )
    kwargs[field] = value
    with pytest.raises(ReturnsDenominatorConfigError, match=field):
        ReturnsDenominatorConfig(**kwargs)  # type: ignore[arg-type]


def test_returns_denominator_config_post_init_rejects_empty_and_nonascending() -> None:
    """S2: empty schedule + non-ascending dates rejected at construction."""
    with pytest.raises(ReturnsDenominatorConfigError, match="empty"):
        ReturnsDenominatorConfig(
            denominator="allocated_capital", pnl_basis="cash_settlement",
            capital_schedule=(), metrics_basis="active_day",
        )
    with pytest.raises(ReturnsDenominatorConfigError, match="ASCENDING"):
        ReturnsDenominatorConfig(
            denominator="allocated_capital", pnl_basis="cash_settlement",
            capital_schedule=(
                CapitalScheduleEntry(date(2025, 9, 1), 1.0),
                CapitalScheduleEntry(date(2025, 8, 1), 1.0),  # earlier → not ascending
            ),
            metrics_basis="active_day",
        )


def test_mandate_end_on_or_before_last_tranche_rejected() -> None:
    """S2: a mandate_end on/before the LAST tranche's effective_from silently kills
    that tranche — rejected at BOTH the parse factory and __post_init__."""
    raw = {
        "denominator": "allocated_capital",
        "pnl_basis": "cash_settlement",
        "capital_schedule": [
            {"effective_from": "2025-08-01", "capital_usd": 1_000_000},
            {"effective_from": "2025-10-01", "capital_usd": 2_000_000},  # LAST
        ],
        "metrics_basis": "active_day",
        # mandate_end AFTER the first tranche but ON/BEFORE the last → kills it.
        "mandate_end": "2025-09-15",
    }
    with pytest.raises(ReturnsDenominatorConfigError, match="mandate_end"):
        parse_returns_denominator_config(raw)
    # Direct construct with the same shape → __post_init__ rejects it too.
    with pytest.raises(ReturnsDenominatorConfigError, match="mandate_end"):
        ReturnsDenominatorConfig(
            denominator="allocated_capital", pnl_basis="cash_settlement",
            capital_schedule=(
                CapitalScheduleEntry(date(2025, 8, 1), 1_000_000.0),
                CapitalScheduleEntry(date(2025, 10, 1), 2_000_000.0),
            ),
            metrics_basis="active_day",
            mandate_end=date(2025, 9, 15),
        )
    # A mandate_end strictly AFTER the last tranche is accepted.
    ok = parse_returns_denominator_config({**raw, "mandate_end": "2025-10-31"})
    assert ok is not None and ok.mandate_end == date(2025, 10, 31)


def test_t5_only_pre_mandate_activity_yields_empty_window_with_counts() -> None:
    """T5: when EVERY activity day falls before the mandate start (only-pre), the
    returns Series is empty, the pre-count equals N, and the warn flag is set."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital", pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 9, 1), 1_000_000.0),),
        metrics_basis="active_day",
    )
    # Two activity days, BOTH before the 2025-09-01 mandate start.
    native = {"USDC": _series([("2025-08-10", 5000.0), ("2025-08-20", -3000.0)])}
    returns, meta = allocated_capital_returns_and_metrics(native, {}, cfg)
    assert len(returns) == 0
    assert meta["n_pre_mandate_days_excluded"] == 2
    assert meta["n_post_mandate_days_excluded"] == 0
    assert meta["mandate_window_excluded_days"] is True


def test_l1_net_zero_pre_mandate_day_does_not_raise_warn_flag() -> None:
    """L1: a pre-mandate NET-ZERO P&L day is NOT an activity day and must NOT set
    mandate_window_excluded_days (the docstring + n_active_days say ACTIVITY days).

    Mutation-honest: counting ALL pnl_usd days (the pre-fix behaviour) would count
    the 0.0 pre-day → n_pre==1 → warn flag True → this reddens."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital", pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 9, 1), 1_000_000.0),),
        metrics_basis="active_day",
    )
    # A 0.0-P&L pre-mandate day + a real in-window activity day.
    native = {"USDC": _series([("2025-08-25", 0.0), ("2025-09-05", 5000.0)])}
    _returns, meta = allocated_capital_returns_and_metrics(native, {}, cfg)
    assert meta["n_pre_mandate_days_excluded"] == 0  # the 0.0 day is not activity
    assert "mandate_window_excluded_days" not in meta


def test_s3_allocated_capital_guard_keys_owns_mandate_flag() -> None:
    """S3: the single-owner guard-keys constant contains the mandate warn flag (the
    two bridge sites iterate it instead of hand-copying the key)."""
    assert "mandate_window_excluded_days" in ALLOCATED_CAPITAL_GUARD_KEYS


# ===========================================================================
# F1 — the single-source spot-exclusion coupling helper (harness == worker).
# F2 — from-inception (peak-0) drawdown baseline in the allocated meta.
# ===========================================================================


def test_f1_exclude_spot_extraction_for_single_source() -> None:
    """F1: the ONE coupling source — config-bearing (allocated) ⇒ True (drop spot
    extraction), None (NAV) ⇒ False (retain). Both worker and harness route through
    this so the harness can never validate a different mode than production ships."""
    from services.allocated_capital import exclude_spot_extraction_for

    cfg = parse_returns_denominator_config(_ZAVARA_CONFIG_RAW)
    assert cfg is not None
    assert exclude_spot_extraction_for(cfg) is True
    assert exclude_spot_extraction_for(None) is False


def test_f2_allocated_maxdd_from_inception_baseline() -> None:
    """F2: the allocated meta max_drawdown_pct seeds the high-water at 0.0 (from
    inception), so a negative day-1 shows underwater. Constant $1M capital; native
    P&L -20k/+10k/+30k → returns -2%/+1%/+3% → cumulative-% [-2,-1,2] → maxDD -2%.

    Mutation-honest: the pre-F2 peak-first seed (no `.clip(lower=0.0)`) tracks
    day-1's own -2 as the peak → drawdown [0,0,0] → 0.0 → this reddens."""
    cfg = ReturnsDenominatorConfig(
        denominator="allocated_capital", pnl_basis="cash_settlement",
        capital_schedule=(CapitalScheduleEntry(date(2025, 8, 3), 1_000_000.0),),
        metrics_basis="active_day", cumulative_method="simple",
    )
    native = {"USDC": _series([
        ("2025-08-03", -20000.0), ("2025-08-04", 10000.0), ("2025-08-05", 30000.0),
    ])}
    _returns, meta = allocated_capital_returns_and_metrics(native, {}, cfg)
    assert meta["cumulative_return_pct"] == pytest.approx(2.0)
    assert meta["max_drawdown_pct"] == pytest.approx(-2.0)
