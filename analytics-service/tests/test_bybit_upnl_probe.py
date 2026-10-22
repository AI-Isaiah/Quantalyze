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
