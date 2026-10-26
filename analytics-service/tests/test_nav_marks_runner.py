"""``run_csv_strategy_analytics`` x marked-to-market series (Phase 167.2.1.1.1 NAVMTM, plan 08).

The compute half of consumption. From the day a key's marks start, the derive stores a
return only on a marked day (D-05, "No row; next mark covers it"), and it stamps three
things onto the strategy's flags before it queues this runner: ``marks_since`` (the first
marked day), ``marks_covered_from`` (the first day whose absence a mark's return covers,
apply_marks' ``covered_from``) and the day list ``mark_gap_days``. This runner rebuilds ``data_quality_flags`` wholesale, so it has
to carry them, and it has to stop treating a covered absence as a refused day:

* the broker load boundary re-densifies every absent in-span day into a NaN chain break
  (MEDIUM-1, DQ-03). A covered day is not a refused day, so on and after
  ``marks_covered_from`` the stored rows are used as stored;
* a pre-start refused day keeps its NaN exactly as today (the boundary is the derive's,
  never re-derived from stored rows, which lack the NaN days);
* the cash series persists ``covered_day_count`` and lists no gap span for a covered day;
* the simple-sum rule (D-14) needs no runner change: the published ``cumulative_return``
  of a strategy configured ``simple`` is the sum of every stored row.

Every value is synthetic.
"""
from __future__ import annotations

import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# 02-20 .. 03-05, fourteen consecutive realized-basis days.
_PRE_DAYS = [f"2026-02-{d:02d}" for d in range(20, 29)] + [f"2026-03-{d:02d}" for d in range(1, 6)]
_PRE_RETURNS = [
    0.010, -0.004, 0.006, 0.003, -0.002, 0.008, -0.006,
    0.004, 0.007, -0.003, 0.005, 0.002, -0.001, 0.009,
]
# Marked rows. 03-08 is ABSENT by construction: the 03-09 mark's return covers it.
_MARK_ROWS = [("2026-03-06", 0.012), ("2026-03-07", -0.003), ("2026-03-09", 0.020)]

_PRESTAMP = {
    "csv_source": True,
    "marks_since": "2026-03-06",
    "marks_covered_from": "2026-03-06",
    "mark_gap_days": ["2026-03-08"],
}

_ALLOC_CFG_SIMPLE_ACTIVE = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [{"effective_from": "2025-08-01", "capital_usd": 1_000_000}],
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
}


def _rows(drop: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    pairs = list(zip(_PRE_DAYS, _PRE_RETURNS)) + _MARK_ROWS
    return [
        {"date": d, "daily_return": r} for d, r in pairs if d not in drop
    ]


def _make_mock(
    daily_rows: list[dict[str, Any]],
    *,
    existing_flags: dict[str, Any],
    returns_denominator_config: object | None = None,
    series_payloads: list[dict[str, Any]] | None = None,
) -> MagicMock:
    """A per-name-memoized supabase mock for a BROKER strategy (api_key_id set).
    ``series_payloads`` collects every ``cash_settlement`` payload sent through the
    series batch RPC."""
    sb = MagicMock()
    tables: dict[str, MagicMock] = {}

    def _table(name: str) -> MagicMock:
        if name in tables:
            return tables[name]
        tbl = MagicMock()
        tables[name] = tbl
        if name == "strategies":
            row: dict[str, Any] = {
                "id": "s", "user_id": "u", "api_key_id": "key-1", "asset_class": "crypto",
            }
            if returns_denominator_config is not None:
                row["returns_denominator_config"] = returns_denominator_config
            tbl.select.return_value.eq.return_value.single.return_value.execute = MagicMock(
                return_value=MagicMock(data=row)
            )
        elif name == "csv_daily_returns":
            eq_chain = tbl.select.return_value.eq.return_value
            order_chain = eq_chain.order.return_value
            order_chain.range.return_value.execute.return_value = MagicMock(data=daily_rows)
            order_chain.limit.return_value.execute.return_value = MagicMock(data=daily_rows)
            order_chain.execute.return_value = MagicMock(data=daily_rows)
            eq_chain.gt.return_value.order.return_value.limit.return_value.execute.return_value = (
                MagicMock(data=[])
            )
        elif name == "strategy_analytics":
            tbl.select.return_value.eq.return_value.maybe_single.return_value.execute = MagicMock(
                return_value=MagicMock(data={"data_quality_flags": dict(existing_flags)})
            )
            tbl.upsert.return_value = MagicMock(execute=MagicMock())
        else:
            tbl.upsert.return_value = MagicMock(execute=MagicMock())
        return tbl

    sb.table.side_effect = _table

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        kinds = payload.get("p_kinds", {}) if isinstance(payload, dict) else {}
        if (
            series_payloads is not None
            and name == "upsert_strategy_analytics_series_batch"
            and "cash_settlement" in kinds
        ):
            series_payloads.append(kinds["cash_settlement"])
        return MagicMock(execute=MagicMock())

    sb.rpc.side_effect = _rpc
    return sb


async def _run(
    daily_rows: list[dict[str, Any]],
    existing_flags: dict[str, Any],
    *,
    returns_denominator_config: object | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Drive the REAL runner (real derive, real compute). Returns the completed
    ``strategy_analytics`` upsert payload and the cash_settlement series payload."""
    from services.analytics_runner import run_csv_strategy_analytics

    series: list[dict[str, Any]] = []
    sb = _make_mock(
        daily_rows,
        existing_flags=existing_flags,
        returns_denominator_config=returns_denominator_config,
        series_payloads=series,
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))):
        await run_csv_strategy_analytics("navmtm-runner-uuid")
    completed = [
        c.args[0] for c in sb.table("strategy_analytics").upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "expected a completed headline upsert"
    assert series, "expected the cash_settlement series to be persisted"
    return completed[0], series[0]


@pytest.mark.asyncio
async def test_mark_gap_is_not_a_chain_break() -> None:
    """D-05 at the compute. 03-08 is absent because the 03-09 mark's return covers it;
    it is not a refused day. Without the boundary the load reinstates it as NaN, the
    headline restarts after it (`headline_since` 2026-03-09) and the factsheet drops
    three weeks of history. With it the series stays one chain."""
    payload, _series = await _run(_rows(), dict(_PRESTAMP))
    dq = payload["data_quality_flags"]

    assert "headline_since" not in dq, f"a covered gap read as a chain break: {dq!r}"
    assert "twr_chain_broken" not in dq
    # D-12 + D-05 + D-15: the date real marks begin, the boundary and the day lists.
    assert dq["marks_since"] == "2026-03-06"
    assert dq["marks_covered_from"] == "2026-03-06"
    assert dq["mark_gap_days"] == ["2026-03-08"]
    # An annotation, never a warning.
    assert payload["computation_status"] == "complete"
    assert payload["computation_warned"] is False


@pytest.mark.asyncio
async def test_pre_start_guard_day_still_breaks_the_chain() -> None:
    """A day refused BEFORE marks start keeps its NaN: only days on or after the
    derive's boundary are covered. The suffix restarts the day after the refused day,
    exactly as it does with no marks at all, and the derive's own chain-break flag is
    still carried."""
    flags = {**_PRESTAMP, "twr_chain_broken": True}
    payload, series = await _run(_rows(drop=("2026-03-03",)), flags)
    dq = payload["data_quality_flags"]

    assert dq["headline_since"] == "2026-03-04"
    assert dq["twr_chain_broken"] is True
    assert dq["marks_since"] == "2026-03-06"
    # The refused day is a real gap span; the covered day is not.
    assert series["gap_spans"] == [{"start": "2026-03-03", "end": "2026-03-03"}]
    assert series["conventions"]["covered_day_count"] == 1


@pytest.mark.asyncio
async def test_trailing_refused_pre_start_day_still_breaks_the_chain() -> None:
    """The refused day sits immediately before marks start. It is still BEFORE the
    boundary (apply_marks counts a NaN input day when it places `covered_from`), so it
    must reinstate as NaN even though no stored pre-start row follows it. Clipping the
    pre-start reindex to the last stored pre-start row would bridge the break."""
    payload, series = await _run(_rows(drop=("2026-03-05",)), dict(_PRESTAMP))
    dq = payload["data_quality_flags"]

    assert dq["headline_since"] == "2026-03-06"
    assert series["gap_spans"] == [{"start": "2026-03-05", "end": "2026-03-05"}]


@pytest.mark.asyncio
async def test_cash_series_has_no_gap_after_the_boundary() -> None:
    """The persisted cash_settlement payload names no gap span for a covered day and
    echoes the covered-day count (derive_basis_series(covered_days=...))."""
    _payload, series = await _run(_rows(), dict(_PRESTAMP))

    assert series["gap_spans"] == []
    assert series["conventions"]["covered_day_count"] == 1
    assert series["conventions"]["densify"] == "broker_nan"
    dates = [r["date"] for r in series["rows"]]
    assert "2026-03-08" not in dates, "a covered day gets no row of its own (D-05, D-15)"
    assert "2026-03-09" in dates


@pytest.mark.asyncio
async def test_no_navmtm_flags_is_byte_identical() -> None:
    """With no NAVMTM key in the prestamp the runner behaves as it did before this plan:
    03-08 is an absent in-span day on a broker series, so it reinstates as NaN, the
    chain breaks, the headline restarts on 03-09, the cash series lists it as a gap and
    carries no covered-day echo."""
    payload, series = await _run(_rows(), {"csv_source": True})

    assert payload["data_quality_flags"] == {
        "csv_source": True,
        "cumulative_method": "geometric",
        "benchmark_unavailable": True,
        "benchmark_note": "Benchmark data unavailable.",
        "headline_since": "2026-03-09",
        # Today's rule leaves a one-day suffix after the break, too short to annualize.
        "insufficient_window": True,
    }
    assert payload["computation_status"] == "complete"
    assert series["gap_spans"] == [{"start": "2026-03-08", "end": "2026-03-08"}]
    assert "covered_day_count" not in series["conventions"]


@pytest.mark.asyncio
async def test_malformed_navmtm_flags_are_dropped(caplog: pytest.LogCaptureFixture) -> None:
    """A malformed prestamp value moves nothing and reaches no public row (T-28). Each
    bad key is dropped with ONE warning that names the key and the reason, never the
    value; a dropped boundary leaves today's reindex in place."""
    bad = {
        "csv_source": True,
        "marks_since": "2026-3-6",
        "marks_covered_from": "2026-02-30",
        "mark_gap_days": ["not-a-day-value"],
    }
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.runner"):
        payload, series = await _run(_rows(), bad)
    dq = payload["data_quality_flags"]

    for key in ("marks_since", "marks_covered_from", "mark_gap_days"):
        assert key not in dq, f"{key} was carried although malformed"
    # The boundary was dropped, so the load boundary is exactly today's.
    assert dq["headline_since"] == "2026-03-09"
    assert "covered_day_count" not in series["conventions"]

    warned = [r.getMessage() for r in caplog.records if "not carried" in r.getMessage()]
    for key in ("marks_since", "marks_covered_from", "mark_gap_days"):
        assert sum(key in m for m in warned) == 1, f"expected one warning for {key}: {warned!r}"
    for value in ("2026-3-6", "2026-02-30", "not-a-day-value"):
        assert not any(value in m for m in warned), f"a warning quoted {value!r}: {warned!r}"


@pytest.mark.asyncio
async def test_a_valid_boundary_does_not_need_the_other_keys() -> None:
    """The boundary is read on its own: a valid `marks_covered_from` beside a malformed
    `marks_since` still keeps the covered gap out of the chain-break path."""
    flags = {"csv_source": True, "marks_since": "tomorrow", "marks_covered_from": "2026-03-06"}
    payload, _series = await _run(_rows(), flags)
    dq = payload["data_quality_flags"]

    assert "headline_since" not in dq
    assert "marks_since" not in dq
    assert dq["marks_covered_from"] == "2026-03-06"


@pytest.mark.asyncio
async def test_navmtm_flags_never_promote_status() -> None:
    """They are annotations (D-12): in neither guard registry, so a guard flag is the only
    thing that warns. A real guard flag beside them still warns."""
    from services.nav_twr import NAV_TWR_GUARD_KEYS

    for key in ("marks_since", "marks_covered_from", "mark_gap_days"):
        assert key not in NAV_TWR_GUARD_KEYS
    from services.analytics_runner import ALLOCATED_CAPITAL_GUARD_KEYS

    for key in ("marks_since", "marks_covered_from", "mark_gap_days"):
        assert key not in ALLOCATED_CAPITAL_GUARD_KEYS

    guard = sorted(NAV_TWR_GUARD_KEYS)[0]
    payload, _series = await _run(_rows(), {**_PRESTAMP, guard: True})
    assert payload["computation_status"] == "complete_with_warnings"
    assert payload["data_quality_flags"]["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_simple_sum_rule_published_for_a_configured_strategy() -> None:
    """W7 / D-14. A strategy configured `cumulative_method: simple` publishes the SUM of
    every stored row, the post-start marked rows included. Nothing in the runner
    special-cases marks: it reads the configured method and day basis as it always has, so
    this pins the figure a reader sees. The compounded figure differs, so a runner that
    ignored the method would fail here."""
    payload, _series = await _run(
        _rows(), dict(_PRESTAMP), returns_denominator_config=_ALLOC_CFG_SIMPLE_ACTIVE
    )
    eight = sum(r for _, r in zip(_PRE_DAYS, _PRE_RETURNS)) + sum(r for _, r in _MARK_ROWS)
    compounded = 1.0
    for r in _PRE_RETURNS + [r for _, r in _MARK_ROWS]:
        compounded *= 1.0 + r
    compounded -= 1.0

    assert payload["data_quality_flags"]["cumulative_method"] == "simple"
    assert abs(eight - compounded) > 1e-6
    assert payload["cumulative_return"] == pytest.approx(eight, abs=1e-9)
    assert payload["cumulative_return"] != pytest.approx(compounded, abs=1e-6)
    assert "marks_not_applied" not in payload["data_quality_flags"]


@pytest.mark.asyncio
async def test_marks_trailing_since_is_carried_present_only_and_never_a_warning() -> None:
    """CR-03. The derive stamps the first day the published series is missing when the last
    applied mark is older than the day it labels. The runner rebuilds data_quality_flags
    wholesale, so it must carry the day (validated, present-only), must drop it when the next
    prestamp does not have it, and must not let it promote computation_status."""
    from services.nav_twr import NAV_TWR_GUARD_KEYS
    from services.analytics_runner import ALLOCATED_CAPITAL_GUARD_KEYS

    assert "marks_trailing_since" not in NAV_TWR_GUARD_KEYS
    assert "marks_trailing_since" not in ALLOCATED_CAPITAL_GUARD_KEYS

    payload, _series = await _run(_rows(), {**_PRESTAMP, "marks_trailing_since": "2026-03-10"})
    assert payload["data_quality_flags"]["marks_trailing_since"] == "2026-03-10"
    assert payload["computation_status"] == "complete"
    assert payload["computation_warned"] is False

    current, _series = await _run(_rows(), _PRESTAMP)
    assert "marks_trailing_since" not in current["data_quality_flags"]

    bad, _series = await _run(_rows(), {**_PRESTAMP, "marks_trailing_since": "2026-3-10"})
    assert "marks_trailing_since" not in bad["data_quality_flags"]
