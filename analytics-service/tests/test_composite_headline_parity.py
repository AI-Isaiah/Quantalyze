"""Phase 86 — headline↔by-basis parity + F5(a) authoritative re-derive.

These drive ``run_stitch_composite_job`` end-to-end over stubbed per-key ledgers
against a stateful fake supabase that stores, serves, and deletes
``csv_daily_returns`` — so the headline path is genuinely exercised and compared
against the by-basis object.

Root cause (HIGH): the headline ``cash_settlement`` metrics (top-level scalars on
the ``complete`` stamp) MUST equal ``metrics_json_by_basis.cash_settlement`` —
same cumulative_return AND same vol/sharpe/maxdd. Pre-fix the headline was
delegated to the divergent single-key ``run_csv_strategy_analytics`` recompute
(asset_class-driven periods + sparse/0.0-gap semantics). Post-fix
run_stitch_composite_job writes the headline DIRECTLY from the SAME in-memory
compute that produces the by-basis object, so headline == by-basis by construction
(the divergent recompute is retired entirely).

F5(a) (LOW): the composite re-derive must delete the WHOLE csv_daily_returns
series for the strategy (it fully OWNS it), not just the new [span_start,
span_end] — otherwise a SHRUNK re-derive leaves stale out-of-span rows that the
headline folds back in. Pure-stub supabase / exchange mocks (no live DB / creds);
run with ``--no-file-parallelism`` if local contention flakes.
"""
from __future__ import annotations

from contextlib import ExitStack
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.broker_dailies import gap_fill_daily_returns
from services.deribit_ingest import CompletenessReport
from services.job_worker import DispatchOutcome, run_stitch_composite_job
from services.metrics import PERIODS_PER_YEAR_CRYPTO, compute_all_metrics
from services.native_nav import NativeLedger

_STRATEGY_ID = "s-composite-parity"

# A GAPLESS-config composite (no allocated-capital override) → geometric/calendar,
# asset_class-driven √365. This is exactly the convention parity both the headline
# (periods_per_year_for_asset_class('crypto')) and the by-basis (venue-driven 365)
# resolve to, so any divergence is purely the SERIES (sparse vs dense), which is
# what F1 closes.
_STRATEGY_ROW = {
    "id": _STRATEGY_ID,
    "user_id": "owner-1",
    "api_key_id": None,  # composite: keys live in strategy_keys, not api_key_id
    "asset_class": "crypto",
    "returns_denominator_config": None,
}


class _StatefulQuery:
    def __init__(self, fake: "_StatefulSupabase", table: str) -> None:
        self.fake = fake
        self.table = table
        self._op = "select"
        self._eqs: list[tuple[str, Any]] = []
        self._gte: tuple[str, Any] | None = None
        self._lte: tuple[str, Any] | None = None
        self._single = False
        self._maybe = False
        self._range: tuple[int, int] | None = None
        self._payload: Any = None
        self._conflict: str | None = None

    def select(self, *a: Any, **k: Any) -> "_StatefulQuery":
        self._op = "select"
        return self

    def eq(self, col: str, val: Any) -> "_StatefulQuery":
        self._eqs.append((col, val))
        return self

    def gte(self, col: str, val: Any) -> "_StatefulQuery":
        self._gte = (col, val)
        return self

    def lte(self, col: str, val: Any) -> "_StatefulQuery":
        self._lte = (col, val)
        return self

    def order(self, *a: Any, **k: Any) -> "_StatefulQuery":
        return self

    def range(self, start: int, end: int) -> "_StatefulQuery":
        self._range = (start, end)
        return self

    def single(self) -> "_StatefulQuery":
        self._single = True
        return self

    def maybe_single(self) -> "_StatefulQuery":
        self._maybe = True
        return self

    def delete(self) -> "_StatefulQuery":
        self._op = "delete"
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None) -> "_StatefulQuery":
        self._op = "upsert"
        self._payload = payload
        self._conflict = on_conflict
        return self

    def execute(self) -> SimpleNamespace:
        if self._op == "upsert":
            return self.fake._do_upsert(self.table, self._payload, self._conflict)
        if self._op == "delete":
            return self.fake._do_delete(
                self.table, list(self._eqs), self._gte, self._lte
            )
        return self.fake._do_select(
            self.table, list(self._eqs), self._single, self._maybe, self._range
        )


class _StatefulSupabase:
    def __init__(
        self,
        *,
        members: list[dict[str, Any]],
        seed_csv: dict[str, float] | None = None,
    ) -> None:
        self.members = members
        self.strategy_row = dict(_STRATEGY_ROW)
        # date(iso str) -> daily_return; the authoritative composite series store.
        self.csv_rows: dict[str, float] = dict(seed_csv or {})
        self.analytics_flags: dict[str, Any] = {}
        self.upserts: list[tuple[str, Any, str | None]] = []
        self.deletes: list[tuple[str, list[tuple[str, Any]], Any, Any]] = []
        self.rpc_calls: list[tuple[str, dict[str, Any]]] = []

    def table(self, name: str) -> _StatefulQuery:
        return _StatefulQuery(self, name)

    def rpc(self, name: str, args: dict[str, Any]) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))

    def _do_upsert(
        self, table: str, payload: Any, conflict: str | None
    ) -> SimpleNamespace:
        self.upserts.append((table, payload, conflict))
        if table == "csv_daily_returns" and isinstance(payload, list):
            for row in payload:
                self.csv_rows[str(row["date"])] = float(row["daily_return"])
        if table == "strategy_analytics" and isinstance(payload, dict):
            flags = payload.get("data_quality_flags")
            if isinstance(flags, dict):
                self.analytics_flags = dict(flags)
        return SimpleNamespace(data=payload)

    def _do_delete(
        self, table: str, eqs: list[tuple[str, Any]], gte: Any, lte: Any
    ) -> SimpleNamespace:
        self.deletes.append((table, eqs, gte, lte))
        if table == "csv_daily_returns":
            keep: dict[str, float] = {}
            for date, val in self.csv_rows.items():
                # Honor an optional [gte, lte] date window (the PRE-fix span
                # delete); post-fix there is no window so every row is removed.
                in_window = True
                if gte is not None and date < str(gte[1]):
                    in_window = False
                if lte is not None and date > str(lte[1]):
                    in_window = False
                if not in_window:
                    keep[date] = val
            self.csv_rows = keep
        return SimpleNamespace(data=[])

    def _do_select(
        self,
        table: str,
        eqs: list[tuple[str, Any]],
        single: bool,
        maybe: bool,
        rng: tuple[int, int] | None,
    ) -> SimpleNamespace:
        if table == "strategy_keys":
            return SimpleNamespace(data=list(self.members))
        if table == "strategies":
            return SimpleNamespace(data=dict(self.strategy_row))
        if table == "strategy_analytics":
            return SimpleNamespace(
                data={"data_quality_flags": dict(self.analytics_flags)}
            )
        if table == "csv_daily_returns":
            rows = [
                {"date": d, "daily_return": v}
                for d, v in sorted(self.csv_rows.items())
            ]
            if rng is not None:
                start, end = rng
                rows = rows[start : end + 1]
            return SimpleNamespace(data=rows)
        return SimpleNamespace(data=None)


def _member(seq: int, window_start: str, window_end: str | None) -> dict[str, Any]:
    return {
        "api_key_id": f"key-{seq}",
        "owner_id": "owner-1",
        "window_start": window_start,
        "window_end": window_end,
        "seq": seq,
    }


def _ctx() -> MagicMock:
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = None
    ctx.key_row = {"id": "key-x", "user_id": "owner-1", "exchange": "deribit"}
    return ctx


def _stub_ledger() -> NativeLedger:
    return NativeLedger(
        native_pnl={"BTC": pd.Series([1.0], index=pd.DatetimeIndex(["2024-01-01"]))},
        terminal_native_equity={"BTC": 1.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )


def _returns(pairs: list[tuple[str, float]]) -> pd.Series:
    idx = pd.DatetimeIndex([d for d, _ in pairs]).as_unit("us")
    return pd.Series([v for _, v in pairs], index=idx, dtype="float64")


def _patches(
    fake: _StatefulSupabase,
    *,
    combine_returns: list[tuple[pd.Series, dict[str, Any]]],
) -> list:
    """Patch set driving run_stitch_composite_job over stubbed per-key ledgers,
    with the REAL compute_all_metrics exercised. The SAME stateful fake backs both
    job_worker and analytics_runner get_supabase."""
    report = CompletenessReport(
        total_return_rows=2,
        indexable_currencies=frozenset({"BTC"}),
        has_option_activity=True,  # gate CLOSED → single cash pass (simpler)
    )
    preflight = AsyncMock(return_value=_ctx())
    return [
        patch("services.job_worker.get_supabase", new=MagicMock(return_value=fake)),
        patch("services.analytics_runner.get_supabase", new=MagicMock(return_value=fake)),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.analytics_runner.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._allocator_key_preflight", new=preflight),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.analytics_runner.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ),
        # F-2: run_stitch_composite_job fetches the BTC benchmark via a LOCAL
        # `from services.benchmark import get_benchmark_returns` — patch that target
        # (default: unavailable → benchmark-invariant scalars, offline).
        patch(
            "services.benchmark.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ),
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(return_value=MagicMock(
                balance_error=False, native_equity={"BTC": 1.0},
            )),
        ),
        patch(
            "services.deribit_ingest.build_deribit_native_ledger",
            new=AsyncMock(return_value=(_stub_ledger(), report)),
        ),
        patch("services.deribit_ingest.assert_ledger_complete", new=MagicMock()),
        patch(
            "services.broker_dailies.combine_native_ledger",
            new=MagicMock(side_effect=list(combine_returns)),
        ),
    ]


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


def _headline_metrics(fake: _StatefulSupabase) -> dict[str, Any]:
    """The top-level scalars from the headline `_mark_complete` upsert (the
    strategy_analytics row stamped complete / complete_with_warnings that carries
    the spread metrics_json)."""
    for table, payload, _ in reversed(fake.upserts):
        if (
            table == "strategy_analytics"
            and isinstance(payload, dict)
            and str(payload.get("computation_status", "")).startswith("complete")
        ):
            return payload
    raise AssertionError("no headline `complete` strategy_analytics upsert found")


def _by_basis_cash(fake: _StatefulSupabase) -> dict[str, Any]:
    for table, payload, _ in reversed(fake.upserts):
        if (
            table == "strategy_analytics"
            and isinstance(payload, dict)
            and "metrics_json_by_basis" in payload
        ):
            return payload["metrics_json_by_basis"]["cash_settlement"]
    raise AssertionError("no by-basis strategy_analytics upsert found")


@pytest.mark.asyncio
async def test_gapped_composite_headline_equals_by_basis_cash_settlement() -> None:
    """Root cause: on a composite with a genuine inter-member gap (Jan-03..Jan-09),
    the headline cash_settlement scalars are byte-identical to
    metrics_json_by_basis.cash_settlement — same cumulative_return AND same
    vol/sharpe/maxdd. Neuter (route the headline back through a separate recompute
    of the SPARSE csv_daily_returns instead of the in-memory compute) → vol/sharpe
    diverge → this reddens."""
    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-03"),
        _member(2, "2024-01-10", None),
    ])
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    headline = _headline_metrics(fake)
    cash = _by_basis_cash(fake)

    # Independently confirm the by-basis reference IS the dense 0.0-gap-filled
    # metric object (the honest composite convention) so the parity assertion
    # pins the RIGHT number, not two identically-wrong sparse ones.
    stitched = _returns([
        ("2024-01-01", 0.02), ("2024-01-02", 0.01),
        ("2024-01-10", 0.03), ("2024-01-11", -0.05),
    ])
    dense = gap_fill_daily_returns(stitched)
    reference = compute_all_metrics(
        dense, None,
        periods_per_year=PERIODS_PER_YEAR_CRYPTO,
        cumulative_method="geometric",
        day_basis="calendar",
    ).metrics_json
    for key in ("cumulative_return", "volatility", "sharpe", "max_drawdown"):
        assert cash[key] == pytest.approx(reference[key]), f"by-basis {key} not dense"
        assert headline[key] == pytest.approx(cash[key]), (
            f"F1 divergence: headline {key}={headline[key]} != "
            f"by-basis cash_settlement {key}={cash[key]} on a gapped composite"
        )


@pytest.mark.asyncio
async def test_shrinking_rederive_deletes_stale_out_of_span_rows() -> None:
    """F5(a): the composite re-derive OWNS the whole series — it must delete every
    csv_daily_returns row for the strategy before the upsert. Seed a stale row
    OUTSIDE the new span (Feb-20); after a re-derive over Jan-01..Jan-11 it must
    be GONE. Neuter (restore the [span_start, span_end] delete) → the stale Feb-20
    row survives → the headline folds it back in → this reddens."""
    fake = _StatefulSupabase(
        members=[
            _member(1, "2024-01-01", "2024-01-03"),
            _member(2, "2024-01-10", None),
        ],
        seed_csv={"2024-02-20": 0.99},  # stale row from a prior, WIDER re-derive
    )
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert "2024-02-20" not in fake.csv_rows, (
        "stale out-of-span row survived the authoritative composite re-derive"
    )
    assert set(fake.csv_rows) == {
        "2024-01-01", "2024-01-02", "2024-01-10", "2024-01-11",
    }
    # The delete that ran must be UNBOUNDED by date (whole-series ownership).
    csv_deletes = [d for d in fake.deletes if d[0] == "csv_daily_returns"]
    assert csv_deletes, "expected a csv_daily_returns delete on re-derive"
    for _table, eqs, gte, lte in csv_deletes:
        assert ("strategy_id", _STRATEGY_ID) in eqs
        assert gte is None and lte is None, "re-derive delete must not bound by date"


@pytest.mark.asyncio
async def test_composite_headline_equals_by_basis_with_interior_guard_day() -> None:
    """ROOT CAUSE regression (collapses F1/F2/F7). A composite (asset_class='crypto'
    — the value finalize-wizard force-derives for a composite, F-1a) with an
    interior guard day (NaN) AND an inter-member gap. Pre-fix the headline was
    delegated to run_csv_strategy_analytics(composite_dense_gap_fill=True), which
    annualized on periods_per_year_for_asset_class(asset_class) and reinstated
    NaN/0.0 gap semantics that disagreed with the in-memory by-basis compute (and,
    for a traditional-default composite, diverged ~√(365/252) — now hard-blocked by
    the F-1b mismatch guard, tested separately below).

    Post-fix the headline IS the same cash_metrics_json spread into
    metrics_json_by_basis.cash_settlement (computed ONCE, venue-blend √365), so:
      (a) headline == by-basis for cumulative_return/volatility/sharpe/max_drawdown,
      (b) the guard day is absent from csv_daily_returns (never fabricated as 0.0),
      (c) the reference number is the honest √365 dense one, not a sparse recompute.
    Neuter (route the headline back through the asset_class recompute) → (a) reddens.
    """
    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-04"),  # half-open: Jan-01..Jan-03
        _member(2, "2024-01-10", None),
    ])
    # asset_class='crypto' — the value finalize-wizard force-derives for a composite
    # (F-1a); the venue blend (deribit → √365) agrees, so the F-1b guard passes.
    fake.strategy_row["asset_class"] = "crypto"
    # m1 carries an INTERIOR guard day (Jan-02 = NaN) — a refused/guarded day the
    # honest series must leave as a chain break, never 0.0-fabricate.
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", float("nan")), ("2024-01-03", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    # (b) the guard day is honestly ABSENT from csv_daily_returns — not fabricated.
    assert "2024-01-02" not in fake.csv_rows, (
        "interior guard day fabricated into csv_daily_returns as flat performance"
    )
    assert set(fake.csv_rows) == {
        "2024-01-01", "2024-01-03", "2024-01-10", "2024-01-11",
    }

    headline = _headline_metrics(fake)
    cash = _by_basis_cash(fake)

    # (c) pin the reference to the honest venue-blend √365 dense series with the
    # guard day left as a chain break (NaN survives gap_fill; stats skip it).
    stitched = _returns([
        ("2024-01-01", 0.02), ("2024-01-02", float("nan")), ("2024-01-03", 0.01),
        ("2024-01-10", 0.03), ("2024-01-11", -0.05),
    ])
    dense = gap_fill_daily_returns(stitched)
    reference = compute_all_metrics(
        dense, None,
        periods_per_year=PERIODS_PER_YEAR_CRYPTO,  # venue blend √365
        cumulative_method="geometric",
        day_basis="calendar",
    ).metrics_json
    # A guard NaN must survive gap_fill (chain break), not become a 0.0 day.
    assert bool(dense.isna().any()), "guard day must remain NaN in the honest series"

    for key in ("cumulative_return", "volatility", "sharpe", "max_drawdown"):
        assert cash[key] == pytest.approx(reference[key]), (
            f"by-basis {key} is not the honest venue-blend √365 dense number"
        )
        # (a) headline == by-basis byte-for-byte — the root-cause parity.
        assert headline[key] == pytest.approx(cash[key]), (
            f"ROOT-CAUSE divergence: headline {key}={headline[key]} != "
            f"by-basis cash_settlement {key}={cash[key]}"
        )


@pytest.mark.asyncio
async def test_composite_sc4_flagship_member_guard_nan_dual_run_dict_equal() -> None:
    """SC-4 FLAGSHIP (collapse #1): on a composite whose stitch carries BOTH an
    in-index member-guard NaN (Jan-02) AND an inter-member absent gap (Jan-04..09),
    the new-route cash_settlement scalars are DICT-EQUAL to the legacy oracle computed
    in-test — compute_all_metrics(gap_fill_daily_returns(stitch), None, same
    conventions).metrics_json (the EXACT input the deleted closure fed). Byte-identity,
    never a weakened tolerance. The captured cash BasisSeriesResult carries
    densify='zero_fill', conventions.benchmark == 'BTC', and nan_dates == the guard
    date. Neuters: omit scalar_returns → the guard-NaN scalar 0.0-bridges (the dropped
    NaN day gap-fills to 0.0) → DICT-EQUAL RED; drop nan_dates emission → the round-
    trip guard can't reinstate the break → the nan_dates assertion RED."""
    import services.basis_series as _bs

    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-04"),  # half-open: Jan-01..Jan-03
        _member(2, "2024-01-10", None),
    ])
    fake.strategy_row["asset_class"] = "crypto"
    # m1 carries an INTERIOR member-guard NaN (Jan-02); the members leave an
    # inter-member gap Jan-04..Jan-09 — the two divergence shapes in one fixture.
    m1 = _returns([
        ("2024-01-01", 0.02), ("2024-01-02", float("nan")), ("2024-01-03", 0.01),
    ])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])

    _real_derive = _bs.derive_basis_series
    _cash: dict[str, Any] = {}

    def _derive_spy(*a: Any, **k: Any) -> Any:
        r = _real_derive(*a, **k)
        if "densify_policy" in k:  # the cash derive (carries the zero_fill bridge)
            _cash["result"] = r
        return r

    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])), patch(
        "services.basis_series.derive_basis_series",
        new=MagicMock(side_effect=_derive_spy),
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    headline = _headline_metrics(fake)
    cash = _by_basis_cash(fake)

    # Legacy oracle: the deleted closure's EXACT compute over the stitched cash series
    # (gap_fill preserves the in-index guard NaN as a chain break, 0.0-fills the gap).
    stitched = _returns([
        ("2024-01-01", 0.02), ("2024-01-02", float("nan")), ("2024-01-03", 0.01),
        ("2024-01-10", 0.03), ("2024-01-11", -0.05),
    ])
    oracle = compute_all_metrics(
        gap_fill_daily_returns(stitched), None,
        periods_per_year=PERIODS_PER_YEAR_CRYPTO,
        cumulative_method="geometric",
        day_basis="calendar",
    ).metrics_json

    # DICT-EQUAL byte-identity — the new-route cash scalars ARE the legacy oracle.
    assert cash == oracle, (
        "new-route cash scalars must be DICT-EQUAL to the legacy closure oracle "
        "(gap_fill(stitch) → compute_all_metrics), never a weakened tolerance"
    )
    # headline == by-basis cash_settlement preserved (the SAME object spread).
    assert headline["metrics_json"] == cash["metrics_json"]

    # The captured cash BasisSeriesResult payload conventions (D1 + LOW-2).
    _cash_result = _cash["result"]
    assert _cash_result.conventions["densify"] == "zero_fill"
    assert _cash_result.conventions["benchmark"] == "BTC"
    assert _cash_result.nan_dates == ["2024-01-02"], (
        "the in-index member-guard NaN must surface as nan_dates so the round-trip "
        f"guard reinstates the break; got {_cash_result.nan_dates}"
    )


@pytest.mark.asyncio
async def test_traditional_asset_class_composite_fails_loud_mismatch_guard() -> None:
    """F-1b: the composite headline annualizes on the venue blend (deribit → √365),
    but every #597 asset-class surface recomputes from strategies.asset_class. A
    composite left at asset_class='traditional' (√252) would make those surfaces
    diverge from the headline by ~√(365/252). The worker must FAIL LOUD PERMANENT
    (terminal stamp) rather than ship the mismatch. Neuter (drop the guard) → the
    job returns DONE with a √365 headline beside √252 surfaces → this reddens."""
    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    fake.strategy_row["asset_class"] = "traditional"  # √252 ≠ venue-blend √365
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-02-01", 0.03), ("2024-02-02", -0.05)])
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # Terminal 'failed' stamp so the wizard poller reaches a gate.
    assert any(
        isinstance(p, dict) and p.get("computation_status") == "failed"
        for _t, p, _c in fake.upserts
    ), "asset_class mismatch must stamp a terminal failed row"
    # No by-basis object shipped for the mismatched composite.
    assert not any(
        isinstance(p, dict) and "metrics_json_by_basis" in p
        for _t, p, _c in fake.upserts
    )


@pytest.mark.asyncio
async def test_composite_carries_benchmark_family_headline_and_by_basis() -> None:
    """F-2: the atomic-upsert refactor must NOT drop the BTC benchmark family. The
    global BTC series is threaded into the ONE canonical compute, so the headline
    AND metrics_json_by_basis.cash_settlement both carry correlation/alpha/beta
    (byte-identical — benchmark is strategy-independent, same compute), and
    benchmark_unavailable is NOT set. Neuter (pass benchmark=None) → correlation
    absent → this reddens."""
    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-06"),  # Jan-01..Jan-05
        _member(2, "2024-01-06", None),
    ])
    fake.strategy_row["asset_class"] = "crypto"
    m1 = _returns([
        ("2024-01-01", 0.02), ("2024-01-02", -0.01),
        ("2024-01-03", 0.03), ("2024-01-04", 0.01), ("2024-01-05", -0.02),
    ])
    m2 = _returns([("2024-01-06", 0.02), ("2024-01-07", -0.03), ("2024-01-08", 0.01)])
    # A real BTC benchmark spanning the composite window (>1 aligned day → greeks).
    btc_idx = pd.date_range("2024-01-01", "2024-01-08", freq="D").as_unit("us")
    btc = pd.Series(
        [0.01, -0.02, 0.02, 0.00, -0.01, 0.03, -0.02, 0.01],
        index=btc_idx, dtype="float64", name="BTC",
    )
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])), patch(
        "services.benchmark.get_benchmark_returns",
        new=AsyncMock(return_value=(btc, False)),  # available → fresh
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    headline = _headline_metrics(fake)
    cash = _by_basis_cash(fake)
    # The benchmark family lands in the inner metrics_json JSONB sub-dict (spread
    # into the headline row + carried in the by-basis object).
    headline_inner = headline["metrics_json"]
    cash_inner = cash["metrics_json"]
    # The benchmark family is present (correlation computed off the BTC overlay)…
    assert "correlation" in headline_inner and headline_inner["correlation"] is not None
    # …and byte-identical across headline and by-basis (same benchmark, same compute).
    for key in ("correlation", "alpha", "beta"):
        assert headline_inner.get(key) == pytest.approx(cash_inner.get(key)), (
            f"benchmark-family {key} diverges headline={headline_inner.get(key)} "
            f"by-basis={cash_inner.get(key)}"
        )
    # Benchmark was available → no unavailable flag.
    assert fake.analytics_flags.get("benchmark_unavailable") is not True


@pytest.mark.asyncio
async def test_composite_sets_benchmark_unavailable_when_fetch_fails() -> None:
    """F-2: when the BTC benchmark is unavailable the composite still ships, but the
    factsheet must SAY SO — data_quality_flags.benchmark_unavailable + note — rather
    than silently omit the family with no explanation."""
    fake = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-04"),
        _member(2, "2024-01-10", None),
    ])
    fake.strategy_row["asset_class"] = "crypto"
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])
    with _apply(_patches(fake, combine_returns=[(m1, {}), (m2, {})])), patch(
        "services.benchmark.get_benchmark_returns",
        new=AsyncMock(side_effect=RuntimeError("benchmark source down")),
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert fake.analytics_flags.get("benchmark_unavailable") is True
    assert "benchmark_note" in fake.analytics_flags
