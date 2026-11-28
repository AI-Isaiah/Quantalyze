"""Phase 256 OKXUNITSWITCH plan 06: an end-to-end harness for the OKX unit-switch derive.

``run_switched_derive`` drives the REAL ``run_derive_broker_dailies_job`` against a fake OKX exchange
(the real ``fetch_daily_pnl`` over ``tests/_okx_bills.py::OkxBillsArchive``, the real
``fetch_okx_total_equity_and_upl_usd`` over a raw balance response), a recording supabase stub and
the stored-holdings and stored-closes reads, so the whole chain runs for real: the plan-03 coin-bill
booking, the plan-01 switch rule, the plan-04 series builder, the marks block and the strategy
prestamp. It captures every write by table.

Plan 09 reuses it with ``key_mode=True``. Every input has a founder-shaped default built from a
calendar relative to today (the derive reads the wall clock, so fixed 2026 dates would age out of
the venue's bills reach). Dates are therefore computed, never hard-coded; every amount is a round
synthetic literal (T-256-02: no PROD figure).

Calendar of the default account (``Calendar.day(back)`` is the ISO UTC day ``back`` days before today):

- stable (USDT) bills on days -18 and -16;
- coin (BTC) fee bills on S = day -14 and on day -8;
- stored holdings: spot USDT only for ``asof`` days -20 to -14 (the end of days -21 to -15), then BTC
  about 99.7% from ``asof`` day -13 (the end of S), so the switch derives as S = day -14;
- the live balance is BTC about 99.7% of ``totalEq``;
- stored BTC closes for every day from -40 to -1 (the latest completed day).
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import ExitStack
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd

from services.benchmark import BtcClosesReadError
from services.job_worker import DispatchResult, run_derive_broker_dailies_job
from services.nav_marks import StoredMark
from tests._okx_bills import OkxBillsArchive, okx_bill

DAY_MS = 86_400_000
EQUITY_USD = 200_000.0


@dataclass(frozen=True)
class Calendar:
    """ISO UTC days relative to today (negative offsets are the past)."""

    today: date

    @classmethod
    def now(cls) -> "Calendar":
        return cls(datetime.now(timezone.utc).date())

    def day(self, back: int) -> str:
        return (self.today - timedelta(days=back)).isoformat()

    def noon_ms(self, back: int) -> int:
        midnight = datetime.combine(
            self.today - timedelta(days=back), datetime.min.time(), tzinfo=timezone.utc
        )
        return int(midnight.timestamp() * 1000) + DAY_MS // 2


# --- default founder-shaped inputs -----------------------------------------------------------------


def bill(
    bill_id: int, cal: Calendar, back: int, ccy: str, pnl: str, fee: str, *, offset_s: int = 0
) -> dict[str, str]:
    """One OKX bill on the day ``back`` days ago (``pnl`` and ``fee`` in ``ccy``)."""
    row = okx_bill(
        bill_id,
        cal.noon_ms(back) + offset_s * 1000,
        ccy,
        "10000",
        pnl,
        bill_type="2",
        inst_type="SWAP",
        pnl=pnl,
        fee=fee,
    )
    row["ccy"] = ccy
    return row


def founder_bills(cal: Calendar) -> list[dict[str, str]]:
    """USDT bills on days -18 and -16, BTC fee bills on S (day -14, two bills) and on day -8."""
    return [
        bill(1, cal, 18, "USDT", "10", "-1"),
        bill(2, cal, 16, "USDT", "4", "-0.5"),
        bill(3, cal, 14, "BTC", "0", "-0.0006", offset_s=1),
        bill(4, cal, 14, "BTC", "0", "-0.0006", offset_s=2),
        bill(5, cal, 8, "BTC", "0", "-0.0009"),
    ]


def founder_holdings_rows(cal: Calendar) -> list[dict[str, Any]]:
    """Spot USDT only for asof days -20..-14, then BTC about 99.7% from asof day -13."""
    rows: list[dict[str, Any]] = []
    for back in range(20, 13, -1):
        rows.append(
            {"symbol": "USDT", "value_usd": "100000", "asof": cal.day(back), "holding_type": "spot"}
        )
    for back in range(13, 0, -1):
        rows.append(
            {"symbol": "BTC", "value_usd": "99700", "asof": cal.day(back), "holding_type": "spot"}
        )
        rows.append(
            {"symbol": "USDT", "value_usd": "300", "asof": cal.day(back), "holding_type": "spot"}
        )
    return rows


def founder_balance_details() -> list[dict[str, str]]:
    """BTC at the default latest close (119500), so a derive anchors the coin exactly where the
    pure builder does when it is given that close as the price."""
    return [
        {"ccy": "BTC", "eq": repr(199400.0 / 119500.0), "eqUsd": "199400"},
        {"ccy": "USDT", "eq": "600", "eqUsd": "600"},
    ]


def founder_closes(cal: Calendar, *, first_back: int = 40) -> pd.Series:
    """A stored BTC close for every day from ``first_back`` days ago to the latest completed day."""
    days = [pd.Timestamp(cal.day(back)) for back in range(first_back, 0, -1)]
    values = [100_000.0 + 500.0 * i for i in range(len(days))]
    return pd.Series(values, index=pd.DatetimeIndex(days), dtype="float64", name="close")


# --- the fake exchange and the supabase stub -------------------------------------------------------


class FakeOkx:
    """The slice of ``ccxt.okx`` the derive touches."""

    id = "okx"
    rateLimit = 0

    def __init__(
        self,
        bills: Sequence[dict[str, str]],
        balance_details: Sequence[Mapping[str, str]],
        total_eq: str = str(EQUITY_USD),
    ):
        self.private_get_account_bills = OkxBillsArchive(bills)
        self.private_get_account_bills_archive = OkxBillsArchive(bills)
        self.private_get_account_balance = AsyncMock(
            return_value={
                "code": "0",
                "data": [
                    {"totalEq": total_eq, "upl": "0", "details": [dict(d) for d in balance_details]}
                ],
            }
        )
        # NAVMTM plan 19: the OKX option check reads open positions once a day; "no options".
        self.privateGetAccountPositions = AsyncMock(return_value={"data": []})


@dataclass
class SwitchedDeriveCapture:
    """Everything one harness run wrote or asked for."""

    result: DispatchResult | None = None
    raised: BaseException | None = None
    upserts: list[tuple[str, Any, Any]] = field(default_factory=list)
    deletes: list[dict[str, Any]] = field(default_factory=list)
    rpc_calls: list[tuple[str, Any]] = field(default_factory=list)
    updates: list[dict[str, Any]] = field(default_factory=list)
    # The keyword arguments the derive called ``fetch_all_trades`` with, raw (the resolver as passed).
    fetch_kwargs: list[dict[str, Any]] = field(default_factory=list)
    resolver_awaits: int = 0
    holdings_reads: int = 0
    closes_reads: int = 0
    exchange: FakeOkx | None = None

    def rows_for(self, table: str) -> list[Any]:
        return [payload for name, payload, _conflict in self.upserts if name == table]

    @property
    def csv_rows(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for payload in self.rows_for("csv_daily_returns"):
            out.extend(payload if isinstance(payload, list) else [payload])
        return out

    @property
    def prestamp(self) -> dict[str, Any]:
        (stamp,) = [p for p in self.rows_for("strategy_analytics") if "data_quality_flags" in p]
        assert isinstance(stamp, dict)
        return stamp


def _build_ctx(
    *,
    key_mode: bool,
    holdings: Sequence[dict[str, Any]] | BaseException,
    capture: SwitchedDeriveCapture,
    stored_analytics_row: Mapping[str, Any] | None = None,
    stored_key_inputs: Mapping[str, Any] | None = None,
    stored_csv_rows: Sequence[dict[str, Any]] | BaseException = (),
) -> MagicMock:
    ctx = MagicMock()
    ctx.exchange = capture.exchange
    ctx.supabase = MagicMock()
    ctx.strategy_row = None if key_mode else {"id": "strat-sw", "user_id": "user-sw"}
    ctx.key_row = {"id": "key-sw", "exchange": "okx", "user_id": "user-sw"}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture.upserts.append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert

        def _delete(**kw: object) -> MagicMock:
            record: dict[str, Any] = {"table": name, "filters": {}}
            capture.deletes.append(record)
            chain = MagicMock()

            def _eq(col: str, val: object) -> MagicMock:
                record["filters"][f"eq:{col}"] = val
                return chain

            def _bound(prefix: str) -> Callable[[str, object], MagicMock]:
                def _inner(col: str, val: object) -> MagicMock:
                    record["filters"][f"{prefix}:{col}"] = val
                    return chain

                return _inner

            chain.eq.side_effect = _eq
            chain.gte.side_effect = _bound("gte")
            chain.lte.side_effect = _bound("lte")
            chain.in_.side_effect = _bound("in")
            chain.execute.return_value = MagicMock(data=[], count=0)
            return chain

        tbl.delete.side_effect = _delete

        def _update(payload: object, **kw: object) -> MagicMock:
            record: dict[str, Any] = {"table": name, "payload": payload, "filters": {}}
            capture.updates.append(record)
            chain = MagicMock()
            chain.eq.side_effect = lambda col, val: (
                record["filters"].__setitem__(f"eq:{col}", val),
                chain,
            )[1]
            chain.execute.return_value = MagicMock(data=[payload])
            return chain

        tbl.update.side_effect = _update

        if name == "strategy_analytics" and stored_analytics_row is not None:
            # The strategy's stored row, as the refusal path's "do published numbers exist" read
            # and the prior-flags read see it.
            tbl.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
                MagicMock(data=stored_analytics_row)
            )
        if name == "allocator_equity_derived" and stored_key_inputs is not None:
            # select("payload").eq("allocator_id", ..).eq("kind", ..).maybe_single().execute(): the key's
            # stored ``key_inputs`` row, as the derive's prior-switch read sees it (CR-02).
            tbl.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data={"payload": dict(stored_key_inputs)}
            )
        if name == "csv_daily_returns":
            # select(..).eq(..).lte(..).order(..).range(a, b).execute(): the stored headline rows the
            # first switched derive seeds the chart's USD segment from (R2-03).
            def _csv_select(*_a: object, **_k: object) -> MagicMock:
                chain = MagicMock()
                window: dict[str, int] = {"start": 0, "end": 0}
                chain.eq.return_value = chain
                chain.lte.return_value = chain
                chain.order.return_value = chain

                def _range(start: int, end: int) -> MagicMock:
                    window["start"], window["end"] = start, end
                    return chain

                chain.range.side_effect = _range

                def _csv_execute() -> MagicMock:
                    if isinstance(stored_csv_rows, BaseException):
                        raise stored_csv_rows
                    return MagicMock(data=list(stored_csv_rows)[window["start"] : window["end"] + 1])

                chain.execute.side_effect = _csv_execute
                return chain

            tbl.select.side_effect = _csv_select
        if name == "allocator_holdings":
            # select(...).eq(...).order(...).order(...).range(a, b).execute(): the real read pages
            # by range, so the stub serves the slice the derive asked for.
            def _select(*_a: object, **_k: object) -> MagicMock:
                chain = MagicMock()
                window: dict[str, int] = {"start": 0, "end": 0}
                chain.eq.return_value = chain
                chain.order.return_value = chain

                def _range(start: int, end: int) -> MagicMock:
                    window["start"], window["end"] = start, end
                    return chain

                def _execute() -> MagicMock:
                    capture.holdings_reads += 1
                    if isinstance(holdings, BaseException):
                        raise holdings
                    return MagicMock(data=list(holdings)[window["start"] : window["end"] + 1])

                chain.range.side_effect = _range
                chain.execute.side_effect = _execute
                return chain

            tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        capture.rpc_calls.append((name, payload))
        stub = MagicMock()
        stub.execute.return_value = MagicMock(
            data=True if name == "mark_compute_job_kept_figures" else 1
        )
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    return ctx


async def run_switched_derive(
    *,
    key_mode: bool = False,
    holdings_rows: Sequence[dict[str, Any]] | BaseException | None = None,
    balance_details: Sequence[Mapping[str, str]] | None = None,
    closes: pd.Series | BaseException | None | str = "default",
    marks: Sequence[StoredMark] | BaseException = (),
    bills: Sequence[dict[str, str]] | None = None,
    funding: Sequence[Mapping[str, Any]] = (),
    deposits: Sequence[Mapping[str, Any]] = (),
    total_eq: str = str(EQUITY_USD),
    stored_analytics_row: Mapping[str, Any] | None = None,
    stored_key_inputs: Mapping[str, Any] | None = None,
    stored_csv_rows: Sequence[dict[str, Any]] | BaseException = (),
    cal: Calendar | None = None,
    expect_raises: type[BaseException] | None = None,
) -> SwitchedDeriveCapture:
    """Run one OKX derive end to end and return what it wrote.

    ``holdings_rows`` defaults to the founder-shaped rows (a ``BaseException`` makes the read raise);
    ``closes`` defaults to a close for every day to the latest completed day (``None`` is "no close
    stored", a ``BaseException`` is a failed read, which the derive sees as ``BtcClosesReadError``);
    ``marks`` are the key's stored USD marks; ``bills`` default to the founder-shaped bills."""
    import services.exchange as ex

    cal = cal or Calendar.now()
    capture = SwitchedDeriveCapture()
    capture.exchange = FakeOkx(
        bills if bills is not None else founder_bills(cal),
        balance_details if balance_details is not None else founder_balance_details(),
        total_eq,
    )
    holdings = holdings_rows if holdings_rows is not None else founder_holdings_rows(cal)
    ctx = _build_ctx(
        key_mode=key_mode,
        holdings=holdings,
        capture=capture,
        stored_analytics_row=stored_analytics_row,
        stored_key_inputs=stored_key_inputs,
        stored_csv_rows=stored_csv_rows,
    )
    stored_closes = founder_closes(cal) if isinstance(closes, str) else closes

    ex.get_and_clear_last_dq_flags()
    ex.get_and_clear_last_unit_switch_read()
    ex.get_and_clear_last_okx_ccy_share()

    async def _fetch_all_trades(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        # The REAL read, over the fake exchange; the harness records what the derive asked for and
        # counts the resolver's awaits.
        capture.fetch_kwargs.append(dict(kwargs))
        resolver: Callable[..., Awaitable[Any]] | None = kwargs.get("unit_switch")
        forwarded = dict(kwargs)
        if resolver is not None:

            async def _counting(census: Any) -> Any:
                capture.resolver_awaits += 1
                return await resolver(census)

            forwarded["unit_switch"] = _counting
        return await ex.fetch_all_trades(*args, **forwarded)

    async def _read_btc_closes() -> pd.Series | None:
        capture.closes_reads += 1
        if isinstance(stored_closes, BaseException):
            raise BtcClosesReadError(str(stored_closes))
        return stored_closes

    def _read_key_marks(*_a: Any) -> list[StoredMark]:
        if isinstance(marks, BaseException):
            raise marks
        return list(marks)

    def _write_nav_mark(_sb: object, read: Any, *, api_key_id: str, allocator_id: str) -> StoredMark:
        return StoredMark(
            mark_day=read.mark_day.isoformat(),
            marked_at=read.marked_at.isoformat(),
            venue="okx",
            nav_usd=read.nav_usd,
            open_pnl_usd=read.open_pnl_usd,
            nav_native=None,
            native_unit=None,
        )

    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode
        else "services.job_worker._exchange_preflight"
    )
    patches = [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(side_effect=_fetch_all_trades)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.funding_fetch.fetch_funding_okx",
            new=AsyncMock(return_value=[dict(r) for r in funding]),
        ),
        patch(
            "services.ccxt_flow_fetch.fetch_ccxt_transfers",
            new=AsyncMock(
                side_effect=lambda _ex, kind, _since, _now: (
                    [dict(r) for r in deposits] if kind == "deposits" else []
                )
            ),
        ),
        patch(
            "services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})
        ),
        patch("services.benchmark.read_btc_closes", new=AsyncMock(side_effect=_read_btc_closes)),
        patch("services.job_worker.read_key_marks", new=MagicMock(side_effect=_read_key_marks)),
        patch("services.job_worker.read_stored_mark", new=MagicMock(return_value=None)),
        patch("services.job_worker.write_nav_mark", new=MagicMock(side_effect=_write_nav_mark)),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker.db_read_with_retry", new=AsyncMock(side_effect=lambda fn: fn())),
    ]
    job: dict[str, Any] = {"id": "j-sw", "kind": "derive_broker_dailies"}
    job["api_key_id" if key_mode else "strategy_id"] = "key-sw" if key_mode else "strat-sw"
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        if expect_raises is not None:
            try:
                await run_derive_broker_dailies_job(job)
            except expect_raises as exc:
                capture.raised = exc
            return capture
        capture.result = await run_derive_broker_dailies_job(job)
    return capture
