"""Phase 167.2.1.1 UPNLVENUES plan 03 - tests for ``scripts/bybit_upnl_probe.py``.

The probe is the D-01 live check, run once on the Railway worker after deploy:
per live Bybit key, does ``equity - walletBalance`` equal the open uPnL on the
wallet-balance response, and does ccxt's ``parse_balance`` ``total`` equal the
wallet balance on that same response? The fix in plan 01 rests on the second
fact (``total`` is the realized-basis wallet balance), and assumption A2 says
CONTRACT accounts behave the same. These tests prove the probe can SEE each of
those facts on recorded-shape responses, can only READ, and can only PRINT
booleans, counts and 3-significant-figure ratios. Nothing here touches a venue
or a database: the venue is a stub, the database a fake chain, and the parser
under test is ccxt's REAL ``parse_balance``.

Why each group matters (Rule 9):
  * run() end to end (tracer): the probe is a one-shot on a live worker. A bug
    in the wiring (wrong table filter, a decrypt that is skipped, a client that
    is never closed, a summary that miscounts) is only discovered on the
    deployed worker, where a second attempt costs a founder step. The tracer
    proves the whole path before anything is layered on it.
  * record semantics: a probe that cannot tell a confirmation from a flat key
    (uPnL zero, so any reading agrees), from a borrow-explained mismatch, from
    a missing field, or from a real disagreement would let a run of idle keys
    read as proof that ``total`` includes uPnL.
  * field-absent: a venue field the response lacks must never read as 0.0 or
    False, or a renamed field would look like "the identity holds".
  * redaction: the output is pasted into a tracked file in a public repo. An
    amount, a key id or a finer-than-day timestamp there is a disclosure.
  * read-only and fail-loud: the keys are live and trade-capable in principle.
    The wrapper must make a write unreachable, and one failing key must be
    recorded by class (never by message: ccxt messages can carry a signed URL)
    while the others are still measured and the run still exits 1.
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt
import pytest

from scripts import bybit_upnl_probe as bp

_PROBE_SRC = Path(bp.__file__).read_text(encoding="utf-8")

# Distinctive amounts, so a substring search for one in the output cannot be
# confused with a ratio's digits.
_WALLET = "1000"
_EQUITY = "1250.5"
_UPNL = "250.5"
_KEY_ID_ONE = "fake-key-id-one"
_KEY_ID_TWO = "fake-key-id-two"
_KEY_ID_THREE = "fake-key-id-three"


# ---------------------------------------------------------------------------
# Recorded-shape fixtures (the V5 wallet-balance and position-list shapes).
# ---------------------------------------------------------------------------


def _coin(
    coin: str,
    *,
    wallet: str,
    equity: str | None,
    upnl: str | None,
    spot_borrow: str | None = "0",
    borrow_amount: str | None = "0",
) -> dict[str, Any]:
    row: dict[str, Any] = {"coin": coin, "walletBalance": wallet}
    for name, value in (
        ("equity", equity),
        ("unrealisedPnl", upnl),
        ("spotBorrow", spot_borrow),
        ("borrowAmount", borrow_amount),
    ):
        if value is not None:
            row[name] = value
    return row


def _wallet_resp(
    coins: list[dict[str, Any]],
    *,
    account_type: str | None = "UNIFIED",
    total_equity: str | None = None,
    total_wallet: str | None = None,
    total_perp_upl: str | None = None,
) -> dict[str, Any]:
    account: dict[str, Any] = {"coin": coins}
    if account_type is not None:
        account["accountType"] = account_type
    for name, value in (
        ("totalEquity", total_equity),
        ("totalWalletBalance", total_wallet),
        ("totalPerpUPL", total_perp_upl),
    ):
        if value is not None:
            account[name] = value
    return {"retCode": 0, "retMsg": "OK", "result": {"list": [account]}, "time": 1672125441042}


def _positions_resp(upnls: list[str], *, next_cursor: str = "") -> dict[str, Any]:
    return {
        "retCode": 0,
        "retMsg": "OK",
        "result": {
            "list": [{"symbol": f"SYM{i}USDT", "unrealisedPnl": u} for i, u in enumerate(upnls)],
            "nextPageCursor": next_cursor,
        },
    }


def _flat_wallet() -> dict[str, Any]:
    """A key with no open position: equity equals the wallet balance, uPnL zero."""
    return _wallet_resp(
        [_coin("USDT", wallet="500", equity="500", upnl="0")],
        total_equity="500",
        total_wallet="500",
        total_perp_upl="0",
    )


def _open_wallet() -> dict[str, Any]:
    """A key holding an open perp: equity = wallet + uPnL, on coin and account."""
    return _wallet_resp(
        [_coin("USDT", wallet=_WALLET, equity=_EQUITY, upnl=_UPNL)],
        total_equity=_EQUITY,
        total_wallet=_WALLET,
        total_perp_upl=_UPNL,
    )


# ---------------------------------------------------------------------------
# A stub venue client, and the fakes that stand in for services.* in run().
# ---------------------------------------------------------------------------


class _StubBybit:
    """Counts its calls; ``close`` must never be reached through the wrapper."""

    def __init__(
        self,
        wallet: Any = None,
        positions: Any = None,
        *,
        wallet_effects: list[Any] | None = None,
        positions_effect: Any = None,
        hang: bool = False,
    ) -> None:
        self._wallet = wallet
        self._positions = positions
        self._wallet_effects = list(wallet_effects) if wallet_effects is not None else None
        self._positions_effect = positions_effect
        self._hang = hang
        self.wallet_calls: list[dict[str, Any]] = []
        self.position_calls: list[dict[str, Any]] = []
        self.close_calls = 0

    async def private_get_v5_account_wallet_balance(self, params: dict[str, Any]) -> Any:
        self.wallet_calls.append(dict(params))
        if self._hang:
            await asyncio.Event().wait()
        if self._wallet_effects is not None:
            effect = self._wallet_effects[len(self.wallet_calls) - 1]
            if isinstance(effect, BaseException):
                raise effect
            return effect
        return self._wallet

    async def private_get_v5_position_list(self, params: dict[str, Any]) -> Any:
        self.position_calls.append(dict(params))
        if isinstance(self._positions_effect, BaseException):
            raise self._positions_effect
        return self._positions

    async def close(self) -> None:
        self.close_calls += 1


class _FakeQuery:
    def __init__(self, data: list[dict[str, Any]], log: list[str]) -> None:
        self._data = data
        self._log = log

    def select(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._log.append("select")
        return self

    def eq(self, column: str, value: Any) -> "_FakeQuery":
        self._log.append(f"eq:{column}={value}")
        return self

    def order(self, column: str, **_k: Any) -> "_FakeQuery":
        self._log.append(f"order:{column}")
        return self

    def execute(self) -> Any:
        return SimpleNamespace(data=self._data)


class _FakeSupabase:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self._data = data
        self.log: list[str] = []
        self.tables: list[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.tables.append(name)
        return _FakeQuery(self._data, self.log)


class _Services:
    """Everything run() reaches for, patched in one place and recorded."""

    def __init__(self, key_rows: list[dict[str, Any]], clients: list[_StubBybit]) -> None:
        self.supabase = _FakeSupabase(key_rows)
        self.clients = list(clients)
        self.decrypt_calls: list[Any] = []
        self.built_for: list[str] = []
        self.closed: list[Any] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _db_execute(fn: Any) -> Any:
            return fn()

        def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
            self.decrypt_calls.append(row.get("id"))
            return ("fake-k", "fake-s", None)

        def _make_client(exchange_name: str, *_a: Any) -> _StubBybit:
            self.built_for.append(exchange_name)
            return self.clients[len(self.built_for) - 1]

        async def _aclose(exchange: Any) -> None:
            self.closed.append(exchange)

        monkeypatch.setattr("services.db.get_supabase", lambda: self.supabase)
        monkeypatch.setattr("services.db.db_execute", _db_execute)
        monkeypatch.setattr("services.encryption.get_kek", lambda: b"fake-kek")
        monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
        monkeypatch.setattr("services.job_worker._make_exchange_client", _make_client)
        monkeypatch.setattr("services.exchange.aclose_exchange", _aclose)


def _bybit_rows(*ids: str) -> list[dict[str, Any]]:
    return [{"id": key_id, "exchange": "bybit", "is_active": True} for key_id in ids]


def _stdout_lines(capsys: pytest.CaptureFixture[str]) -> list[str]:
    out = capsys.readouterr().out
    return [line for line in out.splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Tracer: run() end to end on fakes (D-01, SC-1).
# ---------------------------------------------------------------------------


async def test_run_end_to_end_prints_two_key_records_and_a_summary(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    c1 = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    c2 = _StubBybit(_flat_wallet(), _positions_resp([]))
    services = _Services(_bybit_rows(_KEY_ID_ONE, _KEY_ID_TWO), [c1, c2])
    services.install(monkeypatch)

    code = await bp.run()

    assert code == 0
    lines = _stdout_lines(capsys)
    assert len(lines) == 3
    k1, k2, summary = (json.loads(line) for line in lines)

    # k1: the identity holds on coin and account; ccxt's total is the wallet.
    assert k1["record"] == "key" and k1["key"] == "k1"
    assert k1["read_ok"] is True and k1["positions_read_ok"] is True
    assert k1["failure_class"] == "none"
    assert k1["account_type"] == "UNIFIED"
    assert k1["ccxt_total_equals_wallet"] is True  # 1000 == 1000: total is NOT equity
    assert k1["coin_equity_minus_wallet_equals_upnl"] is True  # 1250.5 - 1000 == 250.5
    assert k1["account_equity_minus_wallet_equals_perp_upl"] is True
    assert k1["upnl_ratio"] == 1.0  # (1250.5 - 1000) / 250.5
    assert k1["upnl_nonzero"] is True
    assert k1["borrow_present"] is False
    assert k1["non_usdt_coins_present"] is False
    assert k1["positions_upnl_matches_totalperpupl"] is True  # 250.5 == 250.5

    # k2: flat, so the identity holds trivially and proves nothing.
    assert k2["key"] == "k2"
    assert k2["upnl_nonzero"] is False
    assert k2["upnl_ratio"] == "field-absent"
    assert k2["coin_equity_minus_wallet_equals_upnl"] is True
    assert k2["account_equity_minus_wallet_equals_perp_upl"] is True
    assert k2["positions_upnl_matches_totalperpupl"] is True  # 0 == 0

    # Summary: one informative key, not two.
    assert summary == {
        "record": "summary",
        "run_date": k1["run_date"],
        "keys": 2,
        "keys_read": 2,
        "keys_informative": 1,
        "keys_identity_holds": 1,
        "keys_ccxt_total_is_wallet": 2,
    }

    # Exactly one wallet read and one position read per key; the wrapper never
    # lets the probe reach close(); the worker's own closer runs once per key.
    for client in (c1, c2):
        assert len(client.wallet_calls) == 1
        assert client.wallet_calls[0] == {"accountType": "UNIFIED"}
        assert len(client.position_calls) == 1
        assert client.position_calls[0]["category"] == "linear"
        assert client.position_calls[0]["settleCoin"] == "USDT"
        assert client.close_calls == 0
    assert services.closed == [c1, c2]
    assert services.built_for == ["bybit", "bybit"]
    assert services.decrypt_calls == [_KEY_ID_ONE, _KEY_ID_TWO]

    # One SELECT on api_keys, filtered to active bybit keys in created_at order.
    assert services.supabase.tables == ["api_keys"]
    assert services.supabase.log == ["select", "eq:exchange=bybit", "eq:is_active=True", "order:created_at"]

    # Nothing identifying or amount-bearing reached stdout.
    joined = "\n".join(lines)
    for leak in (_WALLET, _EQUITY, _UPNL, _KEY_ID_ONE, _KEY_ID_TWO):
        assert leak not in joined, leak
    assert not re.search(r"\d{2}:\d{2}:\d{2}", joined)


# ---------------------------------------------------------------------------
# Record semantics: confirmation, flat key, borrow, CONTRACT, missing fields.
# ---------------------------------------------------------------------------

_RUN_DATE = "2026-10-22"


def _measure(
    wallet: dict[str, Any],
    positions: dict[str, Any] | None = None,
    ccxt_total: Any = 1000.0,
) -> dict[str, Any]:
    return bp.measure_key("k1", _RUN_DATE, wallet, positions, ccxt_total)


def _parser() -> Any:
    """ccxt's REAL Bybit parser, credential-free, as the probe builds it."""
    import ccxt.async_support as ccxt_async

    return ccxt_async.bybit({})


def test_real_ccxt_parse_balance_total_is_the_wallet_balance_not_the_equity() -> None:
    """The finding plan 01 rests on, pinned on the installed parser: with a
    nonzero uPnL the parsed ``total`` is walletBalance (1000), not equity (1250.5)."""
    parsed = _parser().parse_balance(_open_wallet())
    assert parsed["USDT"]["total"] == 1000.0
    assert parsed["USDT"]["total"] != 1250.5


def test_a_flat_key_is_recorded_as_non_informative() -> None:
    rec = _measure(_flat_wallet(), _positions_resp([]), ccxt_total=500.0)
    assert rec["upnl_nonzero"] is False
    assert rec["upnl_ratio"] == "field-absent"
    # The identity holds trivially at zero uPnL, which is exactly why a flat key
    # must not be counted as confirmation.
    assert rec["coin_equity_minus_wallet_equals_upnl"] is True
    summary = bp.summarize([rec], _RUN_DATE)
    assert summary["keys_informative"] == 0
    assert summary["keys_identity_holds"] == 0


def test_margin_borrow_makes_the_coin_identity_false_and_is_recorded_as_the_reason() -> None:
    wallet = _wallet_resp(
        [_coin("USDT", wallet=_WALLET, equity="1150.5", upnl=_UPNL, spot_borrow="100")],
        total_equity="1150.5",
        total_wallet=_WALLET,
        total_perp_upl=_UPNL,
    )
    rec = _measure(wallet, _positions_resp([_UPNL]))
    # equity - wallet = 150.5, not the 250.5 of uPnL: the borrow explains the gap.
    assert rec["coin_equity_minus_wallet_equals_upnl"] is False
    assert rec["borrow_present"] is True
    assert rec["upnl_ratio"] == 0.601  # 150.5 / 250.5 = 0.60080 -> 0.601
    assert rec["upnl_nonzero"] is True


async def test_contract_account_is_read_after_a_unified_bad_request() -> None:
    contract = _wallet_resp(
        [_coin("USDT", wallet=_WALLET, equity=_EQUITY, upnl=_UPNL)],
        account_type="CONTRACT",
    )
    client = _StubBybit(
        wallet_effects=[ccxt.BadRequest("accountType only supports UNIFIED"), contract],
        positions=_positions_resp([_UPNL]),
    )
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, _parser())
    assert client.wallet_calls == [{"accountType": "UNIFIED"}, {"accountType": "CONTRACT"}]
    assert rec["account_type"] == "CONTRACT"
    assert rec["coin_equity_minus_wallet_equals_upnl"] is True  # from the CONTRACT response
    assert rec["ccxt_total_equals_wallet"] is True
    # A CONTRACT response carries no account totals: absent, not false.
    assert rec["account_equity_minus_wallet_equals_perp_upl"] == "field-absent"
    assert rec["positions_upnl_matches_totalperpupl"] == "field-absent"


async def test_an_empty_unified_list_falls_back_to_contract_once() -> None:
    empty = {"retCode": 0, "result": {"list": []}}
    contract = _wallet_resp([_coin("USDT", wallet="10", equity="10", upnl="0")], account_type="CONTRACT")
    client = _StubBybit(wallet_effects=[empty, contract], positions=_positions_resp([]))
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, _parser())
    assert len(client.wallet_calls) == 2
    assert rec["account_type"] == "CONTRACT"


async def test_two_empty_wallet_reads_are_an_empty_response_failure() -> None:
    empty = {"retCode": 0, "result": {"list": []}}
    client = _StubBybit(wallet_effects=[empty, empty], positions=_positions_resp([]))
    with pytest.raises(bp.EmptyResponseError):
        await bp.measure_key_live(client, "k1", _RUN_DATE, _parser())
    assert len(client.wallet_calls) == 2  # UNIFIED then CONTRACT, never a third
    assert bp.classify_failure(bp.EmptyResponseError("x")) == "EmptyResponse"


def test_a_missing_venue_field_reads_field_absent_never_zero_or_false() -> None:
    # No coin ``equity``: the coin identity and the ratio cannot be computed.
    no_equity = _wallet_resp(
        [_coin("USDT", wallet=_WALLET, equity=None, upnl=_UPNL)],
        total_equity=_EQUITY,
        total_wallet=_WALLET,
        total_perp_upl=_UPNL,
    )
    rec = _measure(no_equity, _positions_resp([_UPNL]))
    assert rec["coin_equity_minus_wallet_equals_upnl"] == "field-absent"
    assert rec["upnl_ratio"] == "field-absent"
    assert rec["upnl_nonzero"] is True  # the uPnL itself is present

    # No ``totalPerpUPL``: the account identity and the positions match cannot be computed.
    no_perp = _wallet_resp(
        [_coin("USDT", wallet=_WALLET, equity=_EQUITY, upnl=_UPNL)],
        total_equity=_EQUITY,
        total_wallet=_WALLET,
        total_perp_upl=None,
    )
    rec = _measure(no_perp, _positions_resp([_UPNL]))
    assert rec["account_equity_minus_wallet_equals_perp_upl"] == "field-absent"
    assert rec["positions_upnl_matches_totalperpupl"] == "field-absent"
    assert rec["coin_equity_minus_wallet_equals_upnl"] is True  # untouched by the gap

    # No USDT coin row at all and no coin borrow fields: every coin-level reading is absent.
    no_usdt = _wallet_resp([_coin("BTC", wallet="1", equity="1", upnl="0", spot_borrow=None, borrow_amount=None)])
    rec = _measure(no_usdt)
    for name in (
        "coin_equity_minus_wallet_equals_upnl",
        "upnl_nonzero",
        "upnl_ratio",
        "borrow_present",
        "ccxt_total_equals_wallet",
        "account_equity_minus_wallet_equals_perp_upl",
    ):
        assert rec[name] == "field-absent", name

    # An empty-string venue number is absent too, not zero.
    blank = _wallet_resp([_coin("USDT", wallet=_WALLET, equity="", upnl=_UPNL)])
    assert _measure(blank)["coin_equity_minus_wallet_equals_upnl"] == "field-absent"


def test_a_response_with_no_account_type_reads_field_absent() -> None:
    wallet = _wallet_resp([_coin("USDT", wallet="1", equity="1", upnl="0")], account_type=None)
    assert _measure(wallet)["account_type"] == "field-absent"
    other = _wallet_resp([_coin("USDT", wallet="1", equity="1", upnl="0")], account_type="FUND")
    assert _measure(other)["account_type"] == "other"


def test_non_usdt_coins_and_their_upnl_are_recorded_separately() -> None:
    base = [_coin("USDT", wallet=_WALLET, equity=_EQUITY, upnl=_UPNL)]
    held_only = _wallet_resp(base + [_coin("USDC", wallet="200", equity="200", upnl="0")])
    rec = _measure(held_only)
    assert rec["non_usdt_coins_present"] is True
    assert rec["non_usdt_upnl_present"] is False

    with_upnl = _wallet_resp(base + [_coin("USDC", wallet="200", equity="205", upnl="5")])
    rec = _measure(with_upnl)
    assert rec["non_usdt_coins_present"] is True
    assert rec["non_usdt_upnl_present"] is True

    only_usdt = _wallet_resp(base)
    rec = _measure(only_usdt)
    assert rec["non_usdt_coins_present"] is False
    assert rec["non_usdt_upnl_present"] is False


def test_positions_that_do_not_sum_to_total_perp_upl_are_a_recorded_mismatch() -> None:
    rec = _measure(_open_wallet(), _positions_resp(["150", "50"]))  # 200 against 250.5
    assert rec["positions_upnl_matches_totalperpupl"] is False
    rec = _measure(_open_wallet(), _positions_resp(["100.25", "150.25"]))  # 250.5 against 250.5
    assert rec["positions_upnl_matches_totalperpupl"] is True


def test_an_untrustworthy_position_list_is_absent_not_a_match() -> None:
    # A further page the single read did not take: the sum is a partial sum.
    truncated = _positions_resp([_UPNL], next_cursor="page-2")
    assert _measure(_open_wallet(), truncated)["positions_upnl_matches_totalperpupl"] == "field-absent"
    # A row without a number.
    blank_row = _positions_resp([""])
    assert _measure(_open_wallet(), blank_row)["positions_upnl_matches_totalperpupl"] == "field-absent"


async def test_a_failed_position_read_is_recorded_and_the_key_is_still_measured() -> None:
    client = _StubBybit(
        _open_wallet(),
        positions_effect=ccxt.ExchangeError("boom 4321.5 signature=abc"),
    )
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, _parser())
    assert rec["read_ok"] is True
    assert rec["positions_read_ok"] is False
    assert rec["failure_class"] == "none"  # the wallet read did not fail
    assert rec["positions_upnl_matches_totalperpupl"] == "field-absent"
    assert rec["coin_equity_minus_wallet_equals_upnl"] is True


async def test_ccxt_total_comparison_uses_the_real_parser_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parser = _parser()
    client = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, parser)
    assert rec["ccxt_total_equals_wallet"] is True  # the real parse: total == 1000 == wallet

    # If a ccxt release ever folded uPnL into ``total``, the record would say so.
    monkeypatch.setattr(parser, "parse_balance", lambda _resp: {"USDT": {"total": 1250.5}})
    client = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, parser)
    assert rec["ccxt_total_equals_wallet"] is False

    # A parser that cannot parse leaves the comparison absent, never false.
    def _boom(_resp: Any) -> Any:
        raise ValueError("unparseable")

    monkeypatch.setattr(parser, "parse_balance", _boom)
    client = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    rec = await bp.measure_key_live(client, "k1", _RUN_DATE, parser)
    assert rec["ccxt_total_equals_wallet"] == "field-absent"


def test_venue_decimals_equal_within_one_unit_of_eight_decimals_and_no_further() -> None:
    off_by_one_unit = _wallet_resp(
        [_coin("USDT", wallet="1000.00000000", equity="1250.50000001", upnl="250.5")],
    )
    assert _measure(off_by_one_unit)["coin_equity_minus_wallet_equals_upnl"] is True
    off_by_a_cent = _wallet_resp(
        [_coin("USDT", wallet="1000", equity="1250.51", upnl="250.5")],
    )
    assert _measure(off_by_a_cent)["coin_equity_minus_wallet_equals_upnl"] is False


# ---------------------------------------------------------------------------
# Redaction and the emitter.
# ---------------------------------------------------------------------------

_SECRET_WALLET = "9137.4521"
_SECRET_UPNL = "61.2389"
_SECRET_EQUITY = "9198.691"


def _distinctive_record() -> dict[str, Any]:
    wallet = _wallet_resp(
        [_coin("USDT", wallet=_SECRET_WALLET, equity=_SECRET_EQUITY, upnl=_SECRET_UPNL)],
        total_equity=_SECRET_EQUITY,
        total_wallet=_SECRET_WALLET,
        total_perp_upl=_SECRET_UPNL,
    )
    return bp.measure_key("k1", _RUN_DATE, wallet, _positions_resp([_SECRET_UPNL]), 9137.4521)


def test_output_carries_no_amount_and_exactly_the_declared_keys() -> None:
    rec = _distinctive_record()
    line = bp.emit_record(rec)
    parsed = json.loads(line)
    assert set(parsed) == set(bp.KEY_RECORD_KEYS)
    for amount in (9137.4521, 61.2389, 9198.691):
        for text in {repr(amount), str(amount), f"{abs(amount):g}"}:
            assert text not in line, f"amount {text} reached the output"
    lowered = line.lower()
    for banned in ("secret", "token", "api_key", "account_id", "strategy", "uuid", "email"):
        assert banned not in lowered
    assert not re.search(r"\d{2}:\d{2}:\d{2}", line)  # no clock time finer than a day
    assert parsed["run_date"] == _RUN_DATE

    summary = json.loads(bp.emit_record(bp.summarize([rec], _RUN_DATE)))
    assert set(summary) == set(bp.SUMMARY_RECORD_KEYS)


def test_emitter_refuses_a_key_or_a_value_outside_the_whitelist() -> None:
    rec = _distinctive_record()
    bp.emit_record(rec)  # control: the honest record prints

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, equity=9198.691))  # an extra key: a leaked amount

    missing = dict(rec)
    del missing["borrow_present"]
    with pytest.raises(ValueError):
        bp.emit_record(missing)

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, upnl_ratio=0.60080))  # not rounded to 3 s.f.

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, borrow_present="true"))  # a string where a boolean is declared

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, failure_class="AuthenticationError: 4321.5"))  # off the allow-list

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, key="key-1"))

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, key="k123"))

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, run_date="2026-10-22T10:30:15Z"))  # finer than the run date

    summary = bp.summarize([rec], _RUN_DATE)
    bp.emit_record(summary)  # control
    with pytest.raises(ValueError):
        bp.emit_record(dict(summary, keys=True))  # True where a count is declared

    with pytest.raises(ValueError):
        bp.emit_record(dict(summary, keys=1.0))

    with pytest.raises(ValueError):
        bp.emit_record(dict(rec, record="other"))

    # The refusal names the path, never the offending value.
    with pytest.raises(ValueError) as exc:
        bp.emit_record(dict(rec, failure_class="boom 4321.5"))
    assert "4321.5" not in str(exc.value)
    assert "failure_class" in str(exc.value)


def test_floats_are_rounded_to_three_significant_figures() -> None:
    assert bp.sig3(0.123456) == 0.123
    assert bp.sig3(1234.5) == 1230.0
    assert bp.sig3(0.0) == 0.0
    assert bp.sig3(float("inf")) == "non-finite"
    assert bp.sig3(float("nan")) == "non-finite"


# ---------------------------------------------------------------------------
# Read-only wrapper and source-level safety.
# ---------------------------------------------------------------------------


async def test_proxy_serves_each_read_once_per_distinct_request_and_refuses_a_repeat() -> None:
    stub = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    proxy = bp.ReadOnlyBybitProxy(stub)

    first = await proxy.private_get_v5_account_wallet_balance({"accountType": "UNIFIED"})
    assert first["result"]["list"][0]["accountType"] == "UNIFIED"
    with pytest.raises(RuntimeError):
        await proxy.private_get_v5_account_wallet_balance({"accountType": "UNIFIED"})
    # A different account type is a distinct request: allowed once.
    await proxy.private_get_v5_account_wallet_balance({"accountType": "CONTRACT"})
    with pytest.raises(RuntimeError):
        await proxy.private_get_v5_account_wallet_balance({"accountType": "CONTRACT"})
    assert len(stub.wallet_calls) == 2  # the refused repeats never reached the venue

    params = {"category": "linear", "settleCoin": "USDT"}
    await proxy.private_get_v5_position_list(params)
    with pytest.raises(RuntimeError):
        await proxy.private_get_v5_position_list(params)
    assert len(stub.position_calls) == 1


async def test_a_failed_read_is_not_retried_through_the_proxy() -> None:
    stub = _StubBybit(positions_effect=ccxt.RateLimitExceeded("slow down"))
    proxy = bp.ReadOnlyBybitProxy(stub)
    params = {"category": "linear", "settleCoin": "USDT"}
    with pytest.raises(ccxt.RateLimitExceeded):
        await proxy.private_get_v5_position_list(params)
    with pytest.raises(RuntimeError):  # the retry is refused, not re-sent
        await proxy.private_get_v5_position_list(params)
    assert len(stub.position_calls) == 1


async def test_proxy_exposes_reads_only() -> None:
    stub = _StubBybit(_open_wallet(), _positions_resp([]))
    proxy = bp.ReadOnlyBybitProxy(stub)
    assert callable(proxy.private_get_v5_account_wallet_balance)
    assert callable(proxy.private_get_v5_position_list)
    with pytest.raises(AttributeError):
        proxy.private_post_v5_order_create  # a write endpoint
    with pytest.raises(AttributeError):
        proxy.fetch_balance  # would add load_markets and account-info calls
    with pytest.raises(AttributeError):
        proxy.fetch_positions
    with pytest.raises(AttributeError):
        proxy.close  # lifecycle is the caller's, never reachable through the proxy
    with pytest.raises(AttributeError):
        proxy.private_get_v5_user_query_api  # a real GET endpoint, but not one of the two allowed
    assert stub.close_calls == 0


def test_the_probe_cannot_write_and_never_calls_the_breaker_preflight() -> None:
    assert "_allocator_key_preflight(" not in _PROBE_SRC
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert write not in _PROBE_SRC, write


def test_the_probe_reads_api_keys_with_exactly_one_select() -> None:
    assert _PROBE_SRC.count(".select(") == 1
    assert _PROBE_SRC.count("supabase.table(") == 1
    assert 'supabase.table("api_keys")' in _PROBE_SRC


# ---------------------------------------------------------------------------
# Refusal before any decrypt.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("row", "reason"),
    [
        ({"exchange": "bybit", "is_active": True}, None),
        ({"exchange": "okx", "is_active": True}, "not-bybit"),
        ({"exchange": "bybit", "is_active": False}, "inactive"),
        ({"exchange": "bybit"}, "inactive"),
        ({}, "missing"),
        (None, "missing"),
    ],
)
def test_a_row_that_is_not_an_active_bybit_key_is_refused(
    row: dict[str, Any] | None, reason: str | None
) -> None:
    assert bp.refusal_reason(row) == reason


async def test_no_active_bybit_key_refuses_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    services = _Services([], [])
    services.install(monkeypatch)
    assert await bp.run() == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("refused:")
    assert services.decrypt_calls == []
    assert services.built_for == []


async def test_a_selected_row_that_is_not_an_active_bybit_key_refuses_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = _bybit_rows(_KEY_ID_ONE) + [{"id": _KEY_ID_TWO, "exchange": "okx", "is_active": True}]
    services = _Services(rows, [_StubBybit(_open_wallet(), _positions_resp([]))])
    services.install(monkeypatch)
    assert await bp.run() == 2
    captured = capsys.readouterr()
    assert captured.out == ""  # not even k1 was measured: refusal comes first
    assert "refused:" in captured.err and "not-bybit" in captured.err
    assert _KEY_ID_TWO not in captured.err
    assert services.decrypt_calls == []


# ---------------------------------------------------------------------------
# Fail loud: one failed key does not hide the others.
# ---------------------------------------------------------------------------


async def test_one_failed_key_is_recorded_by_class_the_others_are_measured_and_the_run_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    hostile = ccxt.AuthenticationError(
        f"bybit GET /v5/account/wallet-balance 4321.5 {_KEY_ID_TWO} signature=abc"
    )
    c1 = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    c2 = _StubBybit(wallet_effects=[hostile])
    c3 = _StubBybit(_flat_wallet(), _positions_resp([]))
    services = _Services(_bybit_rows(_KEY_ID_ONE, _KEY_ID_TWO, _KEY_ID_THREE), [c1, c2, c3])
    services.install(monkeypatch)

    code = await bp.run()

    captured = capsys.readouterr()
    lines = [line for line in captured.out.splitlines() if line.strip()]
    assert code == 1
    assert len(lines) == 4  # k1, k2, k3 and the summary: every key printed
    k1, k2, k3, summary = (json.loads(line) for line in lines)
    assert (k1["read_ok"], k2["read_ok"], k3["read_ok"]) == (True, False, True)
    assert k2["failure_class"] == "AuthenticationError"
    assert k2["positions_read_ok"] is False
    for name in (
        "account_type",
        "ccxt_total_equals_wallet",
        "coin_equity_minus_wallet_equals_upnl",
        "account_equity_minus_wallet_equals_perp_upl",
        "upnl_ratio",
        "upnl_nonzero",
        "borrow_present",
        "non_usdt_coins_present",
        "non_usdt_upnl_present",
        "positions_upnl_matches_totalperpupl",
    ):
        assert k2[name] == "field-absent", name
    assert k3["upnl_nonzero"] is False  # the key after the failure was still measured
    assert summary["keys"] == 3 and summary["keys_read"] == 2
    assert len(c2.wallet_calls) == 1  # no pointless CONTRACT retry after an auth refusal
    assert services.closed == [c1, c2, c3]  # the failed key's client is closed too
    for leak in ("4321.5", _KEY_ID_TWO, "signature", "wallet-balance"):
        assert leak not in captured.out, leak
        assert leak not in captured.err, leak


async def test_a_failed_position_read_makes_the_run_exit_one_after_printing_everything(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    client = _StubBybit(_open_wallet(), positions_effect=ccxt.NetworkError("down"))
    services = _Services(_bybit_rows(_KEY_ID_ONE), [client])
    services.install(monkeypatch)
    assert await bp.run() == 1
    k1, summary = (json.loads(line) for line in _stdout_lines(capsys))
    assert k1["read_ok"] is True and k1["positions_read_ok"] is False
    assert summary["keys_read"] == 1


async def test_a_wallet_read_past_the_timeout_is_recorded_as_a_timeout(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(bp, "READ_TIMEOUT_S", 0.05)
    hung = _StubBybit(hang=True)
    services = _Services(_bybit_rows(_KEY_ID_ONE), [hung])
    services.install(monkeypatch)
    assert await bp.run() == 1
    k1, summary = (json.loads(line) for line in _stdout_lines(capsys))
    assert k1["read_ok"] is False and k1["failure_class"] == "Timeout"
    assert summary["keys_read"] == 0
    assert services.closed == [hung]


async def test_a_decrypt_failure_is_recorded_for_that_key_and_the_next_is_measured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    c2 = _StubBybit(_open_wallet(), _positions_resp([_UPNL]))
    services = _Services(_bybit_rows(_KEY_ID_ONE, _KEY_ID_TWO), [c2])
    services.install(monkeypatch)
    real_decrypt = services.decrypt_calls

    def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
        real_decrypt.append(row["id"])
        if row["id"] == _KEY_ID_ONE:
            raise ValueError(f"malformed credential row {_KEY_ID_ONE}")
        return ("fake-k", "fake-s", None)

    monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
    assert await bp.run() == 1
    captured = capsys.readouterr()
    k1, k2, summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert k1["read_ok"] is False and k1["failure_class"] == "other"
    assert k2["read_ok"] is True
    assert summary["keys"] == 2 and summary["keys_read"] == 1
    assert _KEY_ID_ONE not in captured.out + captured.err


class _HostileAuthError(ccxt.AuthenticationError):
    def __str__(self) -> str:
        raise AssertionError("classify_failure must never read the message")


@pytest.mark.parametrize(
    ("exc_name", "expected"),
    [
        ("PermissionDenied", "PermissionDenied"),  # a subclass of AuthenticationError
        ("AuthenticationError", "AuthenticationError"),
        ("RateLimitExceeded", "RateLimitExceeded"),  # a NetworkError subclass
        ("RequestTimeout", "RequestTimeout"),  # a NetworkError subclass
        ("NetworkError", "NetworkError"),
        ("BadRequest", "BadRequest"),  # an ExchangeError subclass
        ("ExchangeError", "ExchangeError"),
    ],
)
def test_failures_are_classified_most_specific_first_without_reading_the_message(
    exc_name: str, expected: str
) -> None:
    assert bp.classify_failure(getattr(ccxt, exc_name)("4321.5 fake-key-id signature=abc")) == expected


def test_classification_never_reads_the_message_and_falls_back_to_other() -> None:
    assert bp.classify_failure(_HostileAuthError("x")) == "AuthenticationError"
    assert bp.classify_failure(TimeoutError("x")) == "Timeout"
    assert bp.classify_failure(asyncio.TimeoutError()) == "Timeout"
    assert bp.classify_failure(ValueError("x")) == "other"
    assert bp.classify_failure(KeyError("x")) == "other"
    assert {bp.classify_failure(e) for e in (ValueError(), KeyError())} <= set(bp.FAILURE_CLASSES)


# ---------------------------------------------------------------------------
# Exit codes and main.
# ---------------------------------------------------------------------------


@pytest.fixture
def _logging_restored() -> Any:
    """main() switches logging off for the whole process; give it back."""
    import logging

    yield
    logging.disable(logging.NOTSET)


def test_the_exit_codes_are_the_documented_ones() -> None:
    assert (bp.EXIT_OK, bp.EXIT_FAILED, bp.EXIT_REFUSED) == (0, 1, 2)
    assert asyncio.iscoroutinefunction(bp.run)


def test_main_takes_no_options_and_rejects_any_argument() -> None:
    with pytest.raises(SystemExit) as exc:
        bp.main(["--anything"])
    assert exc.value.code != 0
    with pytest.raises(SystemExit) as exc:
        bp.main(["k1"])
    assert exc.value.code != 0


def test_main_returns_run_s_exit_code(
    monkeypatch: pytest.MonkeyPatch, _logging_restored: Any
) -> None:
    async def _refused() -> int:
        return bp.EXIT_REFUSED

    monkeypatch.setattr(bp, "run", _refused)
    assert bp.main([]) == 2


def test_main_prints_the_exception_type_only_on_a_run_level_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _logging_restored: Any,
) -> None:
    async def _boom() -> int:
        raise RuntimeError(f"db password 4321.5 {_KEY_ID_ONE}")

    monkeypatch.setattr(bp, "run", _boom)
    assert bp.main([]) == 1
    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: RuntimeError"
    assert "4321.5" not in captured.err and _KEY_ID_ONE not in captured.err
    assert captured.out == ""
