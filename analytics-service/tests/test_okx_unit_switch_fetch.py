"""Phase 256 OKXUNITSWITCH plan 03 (SC-4, SC-7): the OKX bills read books a switched coin only when asked.

An OKX account that moved from USDT into BTC has bills in two units. Before this plan
``fetch_daily_pnl`` refused every such read by name (``daily_pnl_non_usd_okx``, Phase 232 VREAD-06).
Now an optional ``unit_switch`` resolver (built by the derive in plan 06, passed by nobody else)
lets the read return the stable-coin P&L and hand the coin bills to the caller on a drained side
channel, ``get_and_clear_last_unit_switch_read``. Every other caller, and every other shape of
bill, still refuses exactly as before.

Pre-fix: on origin/main the fetch has no keyword and refuses every switched read. Every arm here
reaches the new surface through ``_read`` / ``_drain_read``, which turn a missing keyword
(``TypeError``) or a missing drain function into a NAMED assertion failure ("fetch_daily_pnl has no
unit_switch keyword"), so each arm is RED by assertion on pre-fix code and never by an ImportError
that would hide which arm bites. The default-keyword refusal is pinned separately in
``tests/test_okxtrades_ccy.py`` (GREEN before and after, which is its point: SC-4, nothing else changed).

Every test drives the REAL ``fetch_daily_pnl`` against ``tests/_okx_bills.py::OkxBillsArchive`` with
the clock pinned as in ``tests/test_okxtrades_ccy.py``. Every amount is synthetic.

PROOF-01. NEUTER (recorded in the SUMMARY, restored from a byte backup with ``cp``, ``cmp`` silent):

- A (booking, T-256-08) also add the coin amount into ``daily_totals``:
  ``test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel``.
- B (other-coin refusal) drop the "code != switch.coin" check so an ETH bill is booked:
  ``test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one``.
- C (call-site pin, T-256-09) pass ``unit_switch=None`` from the sync_trades call in ``job_worker.py``:
  ``test_only_the_derive_may_pass_unit_switch``.
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock

import pytest

import services.exchange as ex
from services.exchange import fetch_all_trades, fetch_daily_pnl
from services.unit_switch import CoinBillCensus, UnitSwitch
from tests._okx_bills import OkxBillsArchive, okx_bill

if TYPE_CHECKING:
    from services.exchange import UnitSwitchRead

# 2026-11-20T12:00:00Z, the pinned clock (the same instant as tests/test_okxtrades_ccy.py).
NOW_MS = 1795176000000
DAY_MS = 86_400_000
D_11_10 = NOW_MS - 10 * DAY_MS
D_11_12 = NOW_MS - 8 * DAY_MS
D_11_14 = NOW_MS - 6 * DAY_MS
D_11_20 = NOW_MS - 1000  # still 2026-11-20, one second before the pinned clock
SINCE_MS = NOW_MS - 12 * DAY_MS
FLAG = "daily_pnl_non_usd_okx"
SWITCH = UnitSwitch("BTC", "2026-11-14", "2026-11-15")


class _Exchange:
    """The slice of ccxt.okx the OKX branch of fetch_daily_pnl touches."""

    id = "okx"
    rateLimit = 0

    def __init__(self, rows: list[dict[str, str]]) -> None:
        self.private_get_account_bills = OkxBillsArchive(rows)
        self.private_get_account_bills_archive = OkxBillsArchive(rows)


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)


class _Resolver:
    """An async resolver that records the census it was given and every await."""

    def __init__(self, answer: UnitSwitch | str) -> None:
        self.answer = answer
        self.seen: list[dict[str, tuple[str, int]]] = []

    async def __call__(self, census: CoinBillCensus) -> UnitSwitch | str:
        self.seen.append(dict(census))
        return self.answer


def _drain_read() -> UnitSwitchRead | None:
    drain = getattr(ex, "get_and_clear_last_unit_switch_read", None)
    if drain is None:
        pytest.fail("services.exchange has no get_and_clear_last_unit_switch_read")
    read: UnitSwitchRead | None = drain()
    return read


async def _read(
    rows: list[dict[str, str]], resolver: _Resolver | None = None, *, use_keyword: bool = True
) -> tuple[list[dict[str, Any]], dict[str, Any], UnitSwitchRead | None]:
    ex.get_and_clear_last_dq_flags()
    _drain_read()
    try:
        if use_keyword:
            out = await fetch_daily_pnl(_Exchange(rows), SINCE_MS, unit_switch=resolver)
        else:
            out = await fetch_daily_pnl(_Exchange(rows), SINCE_MS)
    except TypeError as exc:
        pytest.fail(f"fetch_daily_pnl has no unit_switch keyword: {exc}")
    return out, ex.get_and_clear_last_dq_flags(), _drain_read()


def _bill(
    bill_id: int, ts: int, ccy: str | None, pnl: str, fee: str, *, bill_type: str = "2"
) -> dict[str, str]:
    bill = okx_bill(
        bill_id, ts, ccy or "USDT", "10000", pnl, bill_type=bill_type, inst_type="SWAP", pnl=pnl, fee=fee
    )
    if ccy is None:
        del bill["ccy"]
    else:
        bill["ccy"] = ccy
    return bill


def _founder_shaped_rows() -> list[dict[str, str]]:
    """USDT through 2026-11-14 (a zero-amount USDT leg on 11-14 and 11-20), BTC fee bills from 11-14."""
    return [
        _bill(1, D_11_10, "USDT", "10", "-1"),
        _bill(2, D_11_12, "USDT", "4", "-0.5"),
        _bill(3, D_11_14, "USDT", "0", "0"),
        _bill(4, D_11_14 + 1000, "BTC", "0", "-0.0006"),
        _bill(5, D_11_14 + 2000, "BTC", "0", "-0.0006"),
        _bill(6, D_11_20 - 1000, "USDT", "0", "0"),
        _bill(7, D_11_20, "BTC", "0", "-0.0009"),
    ]


def _signed(records: list[dict[str, Any]]) -> dict[str, float]:
    """Signed dollars per UTC day from the daily_pnl records (``side`` encodes the sign)."""
    return {
        r["timestamp"][:10]: (r["price"] if r["side"] == "buy" else -r["price"]) for r in records
    }


class TestSwitchedCoinIsBookedOnlyWhenAsked:
    async def test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel(
        self,
    ) -> None:
        resolver = _Resolver(SWITCH)

        out, flags, read = await _read(_founder_shaped_rows(), resolver)

        # Pre-fix: [] and daily_pnl_non_usd_okx True (the whole read refused).
        assert FLAG not in flags, f"a switched read was refused by name: {flags}"
        # The read is USDT P&L: the 11-10 and 11-12 days, plus the zero-amount USDT legs of 11-14 and
        # 11-20 (the Phase 232 zero-day behaviour is unchanged). No coin amount is in a record.
        assert sorted(_signed(out)) == ["2026-11-10", "2026-11-12", "2026-11-14", "2026-11-20"]
        assert _signed(out) == pytest.approx(
            {"2026-11-10": 9.0, "2026-11-12": 3.5, "2026-11-14": 0.0, "2026-11-20": 0.0}
        )
        assert {r["fee_currency"] for r in out} == {"USDT"}
        assert resolver.seen == [{"BTC": ("2026-11-14", 3)}]
        assert read is not None
        assert read.switch == SWITCH
        assert read.refusal is None
        assert read.census == {"BTC": ("2026-11-14", 3)}
        assert read.coin_by_day == pytest.approx({"2026-11-14": -0.0012, "2026-11-20": -0.0009})
        # T-256-08: the stable side is exactly what the records say; the coin never leaks into it.
        assert read.stable_by_day == pytest.approx(_signed(out))
        # The channel is drained by the read (a second drain is empty).
        assert _drain_read() is None

    async def test_without_the_keyword_the_same_bills_still_refuse_by_name(self) -> None:
        out, flags, read = await _read(_founder_shaped_rows(), use_keyword=False)

        assert out == []
        assert flags.get(FLAG) is True
        assert read is None

    async def test_an_explicit_none_keyword_is_the_default_refusal(self) -> None:
        out, flags, read = await _read(_founder_shaped_rows(), None)

        assert out == []
        assert flags.get(FLAG) is True
        assert read is None

    async def test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one(self) -> None:
        resolver = _Resolver(SWITCH)
        rows = _founder_shaped_rows() + [_bill(8, D_11_14 + 3000, "ETH", "0", "-0.01")]

        out, flags, read = await _read(rows, resolver)

        assert out == [], f"an ETH bill was booked beside the BTC switch: {out}"
        assert flags.get(FLAG) is True
        assert read is None

    async def test_a_resolver_refusal_refuses_and_its_token_reaches_the_caller(self) -> None:
        resolver = _Resolver("two_coins")

        out, flags, read = await _read(_founder_shaped_rows(), resolver)

        assert out == []
        assert flags.get(FLAG) is True
        assert read is not None
        assert read.refusal == "two_coins"
        assert read.switch is None
        assert read.coin_by_day == {} and read.stable_by_day == {}
        assert read.census == {"BTC": ("2026-11-14", 3)}

    @pytest.mark.parametrize("ccy", ["", None, "BT-C", "ABCDEFGHIJKLMNOPQ"], ids=["blank", "missing", "dash", "too_long"])
    async def test_a_blank_or_malformed_ccy_refuses_and_the_resolver_is_never_awaited(
        self, ccy: str | None
    ) -> None:
        resolver = _Resolver(SWITCH)
        rows = _founder_shaped_rows() + [_bill(8, D_11_14 + 3000, ccy, "0", "-0.01")]

        out, flags, read = await _read(rows, resolver)

        assert out == []
        assert flags.get(FLAG) is True
        assert read is None
        assert resolver.seen == [], "the resolver was awaited with an unusable ccy in the census"

    async def test_a_coin_transition_fee_before_the_last_usd_day_is_carried_for_the_splitter(
        self,
    ) -> None:
        """CR-01 (founder ruling "Move switch to coin majority"). Pre-fix a coin bill dated before S
        refused the whole read (``daily_pnl_non_usd_okx``) because S used to be the first coin bill.
        S is now the persistent majority day, so the fee bills of the transition lead it: they are
        carried on the side channel and the splitter books them in USD at their own day's close."""
        resolver = _Resolver(UnitSwitch("BTC", "2026-11-16", "2026-11-17"))

        out, flags, read = await _read(_founder_shaped_rows(), resolver)

        assert FLAG not in flags
        assert sorted(_signed(out)) == ["2026-11-10", "2026-11-12", "2026-11-14", "2026-11-20"]
        assert read is not None and read.switch == UnitSwitch("BTC", "2026-11-16", "2026-11-17")
        assert read.coin_by_day == pytest.approx({"2026-11-14": -0.0012, "2026-11-20": -0.0009})

    async def test_a_coin_bill_with_no_parseable_ts_refuses_and_the_resolver_is_never_awaited(self) -> None:
        resolver = _Resolver(SWITCH)
        rows = _founder_shaped_rows()
        undated = _bill(8, D_11_14 + 3000, "BTC", "0", "-0.01")
        # int() accepts the leading plus (so the fake archive's window filter serves the row) but
        # str.isdigit() does not, which is the shape the walk's own parse guard refuses.
        undated["ts"] = f"+{D_11_14 + 3000}"
        rows.append(undated)

        out, flags, read = await _read(rows, resolver)

        assert out == []
        assert flags.get(FLAG) is True
        assert read is None
        assert resolver.seen == []

    async def test_a_coin_funding_bill_never_reaches_the_census_or_the_resolver(self) -> None:
        # Type 8 is dropped before the currency check (Phase 232), with or without a resolver.
        resolver = _Resolver(SWITCH)
        rows = [
            _bill(1, D_11_10, "USDT", "10", "-1"),
            _bill(2, D_11_14, "BTC", "0", "-0.01", bill_type="8"),
        ]

        out, flags, read = await _read(rows, resolver)

        assert FLAG not in flags
        assert [r["price"] for r in out] == [9.0]
        assert resolver.seen == []
        assert read is None

    async def test_a_usdt_fee_on_a_spot_sell_is_a_stable_bill_and_never_enters_the_coin_census(self) -> None:
        # RESEARCH fixture (g): selling BTC for USDT. The BTC leg moves the coin balance with no
        # pnl and no fee; the fee is charged in the received USDT, so it is a stable bill.
        resolver = _Resolver(SWITCH)
        rows = [
            okx_bill(1, D_11_14, "BTC", "0.5", "-0.01", bill_type="2", inst_type="SPOT"),
            _bill(2, D_11_14 + 1000, "USDT", "0", "-5"),
        ]

        out, flags, read = await _read(rows, resolver)

        assert FLAG not in flags
        assert _signed(out) == pytest.approx({"2026-11-14": -5.0})
        assert resolver.seen == [], "a USDT fee on a spot sell entered the coin census"
        assert read is None, "no coin bills, so no side channel"

    async def test_a_read_that_stores_nothing_clears_the_previous_reads_coin_bills(self) -> None:
        # The entry reset: a stale UnitSwitchRead must never be handed to the next read's caller.
        _drain_read()
        await fetch_daily_pnl(_Exchange(_founder_shaped_rows()), SINCE_MS, unit_switch=_Resolver(SWITCH))
        # Deliberately NOT drained. A second read with only stable bills must reset the channel.
        await fetch_daily_pnl(_Exchange([_bill(1, D_11_10, "USDT", "10", "-1")]), SINCE_MS)

        assert _drain_read() is None

    async def test_fetch_all_trades_forwards_the_keyword(self) -> None:
        resolver = _Resolver(SWITCH)
        ex.get_and_clear_last_dq_flags()
        _drain_read()

        out = await fetch_all_trades(_Exchange(_founder_shaped_rows()), since_ms=SINCE_MS, unit_switch=resolver)
        read = _drain_read()
        flags = ex.get_and_clear_last_dq_flags()

        assert FLAG not in flags
        assert out != []
        assert read is not None and read.switch == SWITCH


# --- SC-4 / T-256-09: only the derive may ask ---------------------------------------------------

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
_FETCHERS = frozenset({"fetch_all_trades", "fetch_daily_pnl"})
# (path relative to analytics-service, enclosing function). The derive is the ONLY caller allowed to
# ask. The forwarder is the definition site: ``fetch_all_trades`` passes the keyword on to
# ``fetch_daily_pnl`` and asks nothing itself.
_PERMITTED_SITES = frozenset(
    {
        ("services/job_worker.py", "run_derive_broker_dailies_job"),
        ("services/exchange.py", "fetch_all_trades"),
    }
)


def _callee_name(call: ast.Call) -> str | None:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _asking_sites(source: str, relpath: str) -> list[tuple[str, str, int]]:
    """Every call to a fetcher that carries ``unit_switch=`` (or a ``**`` splat that could carry it),
    as (relpath, enclosing function name or '<module>', line)."""
    tree = ast.parse(source)
    sites: list[tuple[str, str, int]] = []

    def visit(node: ast.AST, enclosing: str) -> None:
        for child in ast.iter_child_nodes(node):
            inner = (
                child.name
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                else enclosing
            )
            if (
                isinstance(child, ast.Call)
                and _callee_name(child) in _FETCHERS
                and any(kw.arg in ("unit_switch", None) for kw in child.keywords)
            ):
                sites.append((relpath, enclosing, child.lineno))
            visit(child, inner)

    visit(tree, "<module>")
    return sites


def _scanned_files() -> list[Path]:
    files = sorted(_SERVICE_ROOT.glob("*.py"))
    for sub in ("services", "routers", "models"):
        files.extend(sorted((_SERVICE_ROOT / sub).rglob("*.py")))
    return files


class TestOnlyTheDeriveMayAsk:
    def test_the_checker_flags_a_call_site_outside_the_derive(self) -> None:
        # The pin can fail: a synthetic sync_trades-shaped call carrying the keyword is found.
        source = (
            "async def run_sync_trades_job(ctx):\n"
            "    return await fetch_all_trades(ctx.exchange, since_ms=None, unit_switch=None)\n"
            "async def other(ctx):\n"
            "    return await fetch_daily_pnl(ctx.exchange, **{'unit_switch': 1})\n"
        )

        sites = _asking_sites(source, "services/job_worker.py")

        assert [s[1] for s in sites] == ["run_sync_trades_job", "other"]

    def test_only_the_derive_may_pass_unit_switch(self) -> None:
        found: list[tuple[str, str, int]] = []
        for path in _scanned_files():
            rel = path.relative_to(_SERVICE_ROOT).as_posix()
            found.extend(_asking_sites(path.read_text(encoding="utf-8"), rel))

        offenders = [s for s in found if (s[0], s[1]) not in _PERMITTED_SITES]
        assert offenders == [], (
            "only run_derive_broker_dailies_job may pass unit_switch to the OKX bills read "
            f"(sync_trades, the cron tick and okx_archive_job keep refusing): {offenders}"
        )
        # The scan is not vacuous: the forwarder in exchange.py is always found.
        assert ("services/exchange.py", "fetch_all_trades") in {(s[0], s[1]) for s in found}


# --- the live per-ccy equity share ---------------------------------------------------------------


def _balance_exchange(payload: Any) -> Any:
    class _Balance:
        id = "okx"

        def __init__(self) -> None:
            self.private_get_account_balance = AsyncMock(return_value=payload)

    return _Balance()


class TestLiveCcyShare:
    async def test_the_share_comes_from_the_same_balance_response(self) -> None:
        payload = {
            "code": "0",
            "data": [
                {
                    "totalEq": "200000",
                    "upl": "0",
                    "details": [
                        {"ccy": "BTC", "eqUsd": "199400"},
                        {"ccy": "USDT", "eqUsd": "600"},
                    ],
                }
            ],
        }
        exchange = _balance_exchange(payload)
        ex.get_and_clear_last_okx_ccy_share()

        result = await ex.fetch_okx_total_equity_and_upl_usd(exchange)
        share = ex.get_and_clear_last_okx_ccy_share()

        assert result == (200000.0, 0.0, False), "the 3-tuple return changed"
        assert share == pytest.approx({"BTC": 0.997, "USDT": 0.003})
        assert exchange.private_get_account_balance.await_count == 1
        assert ex.get_and_clear_last_okx_ccy_share() is None

    async def test_a_malformed_detail_ccy_is_dropped_not_zeroed_in(self) -> None:
        payload = {
            "data": [
                {
                    "totalEq": "1000",
                    "upl": "0",
                    "details": [
                        {"ccy": "BTC", "eqUsd": "750"},
                        {"ccy": "US DT", "eqUsd": "100"},
                        {"ccy": "", "eqUsd": "100"},
                        {"ccy": "USDT", "eqUsd": "250"},
                        {"ccy": "ETH", "eqUsd": "nan"},
                        {"ccy": "SOL", "eqUsd": "-5"},
                    ],
                }
            ]
        }
        ex.get_and_clear_last_okx_ccy_share()

        await ex.fetch_okx_total_equity_and_upl_usd(_balance_exchange(payload))

        assert ex.get_and_clear_last_okx_ccy_share() == pytest.approx({"BTC": 0.75, "USDT": 0.25})

    async def test_the_live_price_is_eq_usd_over_eq_for_a_coin_that_has_both(self) -> None:
        """WR-01: the price the unit switch anchors at comes from the SAME response."""
        payload = {
            "data": [
                {
                    "totalEq": "1000",
                    "upl": "0",
                    "details": [
                        {"ccy": "BTC", "eq": "0.01", "eqUsd": "750"},
                        {"ccy": "ETH", "eqUsd": "100"},
                        {"ccy": "SOL", "eq": "0", "eqUsd": "0"},
                        {"ccy": "USDT", "eq": "250", "eqUsd": "250"},
                    ],
                }
            ]
        }
        ex.get_and_clear_last_okx_ccy_price()

        await ex.fetch_okx_total_equity_and_upl_usd(_balance_exchange(payload))

        assert ex.get_and_clear_last_okx_ccy_price() == pytest.approx({"BTC": 75000.0, "USDT": 1.0})
        assert ex.get_and_clear_last_okx_ccy_price() is None

    async def test_a_failed_read_leaves_no_share_from_an_earlier_read(self) -> None:
        good = {"data": [{"totalEq": "10", "upl": "0", "details": [{"ccy": "BTC", "eqUsd": "10"}]}]}
        await ex.fetch_okx_total_equity_and_upl_usd(_balance_exchange(good))  # not drained

        failing = _balance_exchange(None)
        failing.private_get_account_balance = AsyncMock(side_effect=RuntimeError("boom"))
        result = await ex.fetch_okx_total_equity_and_upl_usd(failing)

        assert result == (None, 0.0, False)
        assert ex.get_and_clear_last_okx_ccy_share() is None

    async def test_no_positive_sum_records_no_share(self) -> None:
        payload = {"data": [{"totalEq": "10", "upl": "0", "details": [{"ccy": "BTC", "eqUsd": "0"}]}]}
        ex.get_and_clear_last_okx_ccy_share()

        await ex.fetch_okx_total_equity_and_upl_usd(_balance_exchange(payload))

        assert ex.get_and_clear_last_okx_ccy_share() is None
