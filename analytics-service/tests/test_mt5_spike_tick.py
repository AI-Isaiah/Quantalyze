"""Offline tests for the Phase 155.1 tick leg of scripts/mt5_spike.py (`--leg tick`).

WHY these tests exist: the founder runs this leg ONCE, supervised, against the live
gateway (2026-11-16), and 155.1's design (D-05, D-08, D-10) is built on what it
reports. A leg that misreads its own measurements would send the plan the wrong
way, so each test pins one reading the plan depends on:

  * the offset arithmetic and the broker-wall-clock vs UTC encoding call, because a
    wrong call there would make the product assert the wrong rule (MT5-06);
  * a terminal that answers None for every tick must read NO-GO, never a GO built
    on zero ticks;
  * a stale newest tick (closed market) must not read GO, because the freshness
    bound is what D-10's `unmeasured` verdict rests on;
  * the report must carry no symbol name, login or server (public repo), and the
    leg must never call symbol_select (it changes terminal state) or a trade path.

No network, no mt5linux: a fake Mt5Client and a fake raw terminal handle.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from scripts import mt5_spike
from scripts.mt5_spike import run_tick_spike
from services.mt5_client import Mt5ClientError

# Monday 2026-11-16 10:00 UTC: after both autumn moves, so eu and us both say +2h.
_NOW = datetime(2026, 11, 16, 10, 0, 0, tzinfo=timezone.utc)
_NOW_S = int(_NOW.timestamp())
_OFFSET = 7200

_ENV = {
    "MT5_SPIKE_LOGIN": "99887766",
    "MT5_SPIKE_INVESTOR_PASSWORD": "s3cr3t_pw",
    "MT5_SPIKE_SERVER": "SecretBroker-Live",
    "MT5_SPIKE_HOST": "10.0.0.9",
    "MT5_SPIKE_PORT": "8001",
}

_VISIBLE = ["VISSYM_AAA", "VISSYM_BBB", "VISSYM_CCC"]
_HIDDEN = "HIDSYM_ZZZ"


class _Tick:
    """A tick that exposes ONLY its time fields; touching a price raises, so a
    leg that reads prices fails these tests."""

    def __init__(self, wall_ms: int) -> None:
        self.time = wall_ms // 1000
        self.time_msc = wall_ms

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"tick leg read a non-time field: {name}")


class _FakeRaw:
    def __init__(self, touched: set[str], ticks: dict[str, Any]) -> None:
        self._touched = touched
        self._ticks = ticks

    def symbols_get(self) -> list[SimpleNamespace]:
        self._touched.add("symbols_get")
        syms = [SimpleNamespace(name=n, visible=True) for n in _VISIBLE]
        syms.append(SimpleNamespace(name=_HIDDEN, visible=False))
        syms.append(SimpleNamespace(name="OTHER_HIDDEN", visible=False))
        return syms

    def symbol_info_tick(self, name: str) -> Any:
        self._touched.add("symbol_info_tick")
        self._touched.add(f"tick:{name}")
        value = self._ticks.get(name)
        if isinstance(value, BaseException):
            raise value
        return value

    def last_error(self) -> tuple[int, str]:
        return (-1, "generic fail")

    def symbol_select(self, *_a: Any) -> bool:
        self._touched.add("symbol_select")
        return True


class _FakeClient:
    def __init__(self, touched: set[str], raw: _FakeRaw, deals: list[dict[str, Any]],
                 login_exc: BaseException | None = None) -> None:
        self._touched = touched
        self._mt5 = raw
        self._deals = deals
        self._login_exc = login_exc

    def login(self, login: int, password: str, server: str) -> None:
        self._touched.add("login")
        if self._login_exc is not None:
            raise self._login_exc

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> list[dict[str, Any]]:
        self._touched.add("history_deals_get")
        return [dict(d) for d in self._deals]

    def close(self) -> None:
        self._touched.add("close")


def _wall_ms(age_s: float, offset_s: int = _OFFSET) -> int:
    """Broker wall clock (as if UTC) of a tick `age_s` seconds old."""
    return int((_NOW_S - age_s + offset_s) * 1000)


def _deal(symbol: str, age_s: float, offset_s: int = _OFFSET) -> dict[str, Any]:
    wall_ms = _wall_ms(age_s, offset_s)
    return {"symbol": symbol, "time": wall_ms // 1000, "time_msc": wall_ms}


def _run(ticks: dict[str, Any], deals: list[dict[str, Any]] | None = None,
         login_exc: BaseException | None = None) -> tuple[dict[str, Any], set[str]]:
    touched: set[str] = set()
    raw = _FakeRaw(touched, ticks)
    deals = deals if deals is not None else [_deal(_HIDDEN, 3600), _deal(_VISIBLE[0], 7200)]

    def factory(host: str, port: int) -> _FakeClient:
        touched.add("factory")
        return _FakeClient(touched, raw, deals, login_exc)

    report = run_tick_spike(_ENV, client_factory=factory, utc_now_fn=lambda: _NOW)
    return report, touched


def _fresh_ticks(offset_s: int = _OFFSET) -> dict[str, Any]:
    return {
        _VISIBLE[0]: _Tick(_wall_ms(1, offset_s)),
        _VISIBLE[1]: _Tick(_wall_ms(30, offset_s)),
        _VISIBLE[2]: _Tick(_wall_ms(400, offset_s)),
        _HIDDEN: _Tick(_wall_ms(5, offset_s)),
    }


def test_fresh_broker_wall_clock_ticks_read_go_with_the_right_offset() -> None:
    report, _ = _run(_fresh_ticks())
    leg = report["server_clock_tick"]
    assert leg["verdict"] == "GO", leg["verdict_reasons"]
    assert leg["listing"] == {
        "observation": "ok", "symbols_total": 5, "visible_count": 3,
        "elapsed_s": leg["listing"]["elapsed_s"],
    }
    assert leg["visible_ticks"]["answered"] == 3
    assert leg["visible_ticks"]["time_matches_time_msc"] is True
    off = leg["offset"]
    assert off["rounded_offset_s"] == _OFFSET
    assert off["encoding"] == "broker_wall_clock"
    assert off["expected_offset_s"] == {"eu": _OFFSET, "us": _OFFSET}
    assert off["matches_rule"] == {"eu": True, "us": True}
    # The newest tick is 1 s old: the age against the rule is that 1 s.
    assert leg["freshness"]["newest_tick_age_s_vs_rule"] == {"eu": 1.0, "us": 1.0}
    assert leg["freshness"]["lag_behind_newest_s"]["max"] == 399.0
    assert leg["freshness"]["symbols_within_60s_of_newest"] == 2
    assert leg["deal_encoding"]["consistent"] is True
    assert leg["deal_encoding"]["deal_time_matches_time_msc"] is True


def test_utc_encoded_ticks_are_called_utc_and_never_go() -> None:
    report, _ = _run(_fresh_ticks(offset_s=0), deals=[_deal(_HIDDEN, 3600, 0)])
    leg = report["server_clock_tick"]
    assert leg["offset"]["encoding"] == "utc"
    assert leg["offset"]["matches_rule"] == {"eu": False, "us": False}
    assert leg["verdict"] == "INCONCLUSIVE"


def test_every_tick_none_reads_no_go() -> None:
    report, _ = _run({})
    leg = report["server_clock_tick"]
    assert leg["verdict"] == "NO-GO"
    assert leg["visible_ticks"]["none"] == 3
    assert "offset" not in leg


def test_stale_newest_tick_is_not_go_and_reports_its_age() -> None:
    # Weekend: the newest tick is ~2 days old.
    stale = {name: _Tick(_wall_ms(2 * 86400 + i)) for i, name in enumerate(_VISIBLE)}
    report, _ = _run(stale, deals=[_deal(_HIDDEN, 3 * 86400)])
    leg = report["server_clock_tick"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["freshness"]["newest_tick_age_s_vs_rule"]["eu"] == pytest.approx(2 * 86400)
    assert any("older than" in r for r in leg["verdict_reasons"])


def test_nonvisible_deal_symbol_is_read_without_symbol_select() -> None:
    report, touched = _run(_fresh_ticks())
    nonvis = report["server_clock_tick"]["nonvisible_deal_symbol"]
    assert nonvis["observation"] == "answered"
    assert nonvis["deal_symbols"] == 2
    assert nonvis["deal_symbols_visible"] == 1
    assert f"tick:{_HIDDEN}" in touched
    assert "symbol_select" not in touched


def test_nonvisible_none_is_recorded_with_its_error_code() -> None:
    ticks = _fresh_ticks()
    del ticks[_HIDDEN]
    report, _ = _run(ticks)
    nonvis = report["server_clock_tick"]["nonvisible_deal_symbol"]
    assert nonvis["observation"] == "none"
    assert nonvis["last_error_code"] == -1


def test_a_deal_later_than_the_newest_tick_is_flagged_inconsistent() -> None:
    # A deal stamped in UTC while ticks are on the broker clock would sit EARLIER;
    # a deal stamped 2 h AHEAD of the tick clock is the impossible case.
    report, _ = _run(_fresh_ticks(), deals=[_deal(_HIDDEN, 60, offset_s=_OFFSET + 7200)])
    leg = report["server_clock_tick"]
    assert leg["deal_encoding"]["consistent"] is False
    assert leg["verdict"] == "INCONCLUSIVE"


def test_report_carries_no_symbol_name_login_or_server_and_no_trade_path() -> None:
    report, touched = _run(_fresh_ticks())
    text = json.dumps(report)
    for secret in [*_VISIBLE, _HIDDEN, "OTHER_HIDDEN", _ENV["MT5_SPIKE_LOGIN"],
                   _ENV["MT5_SPIKE_SERVER"], _ENV["MT5_SPIKE_INVESTOR_PASSWORD"]]:
        assert secret not in text, secret
    assert not {"order_send", "order_check", "symbol_select"} & touched
    assert "close" in touched


def test_tick_read_exception_message_never_enters_the_report() -> None:
    ticks = {name: RuntimeError(f"boom on {name}") for name in _VISIBLE}
    report, _ = _run(ticks)
    leg = report["server_clock_tick"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["visible_ticks"]["error_types"] == ["RuntimeError"]
    assert "VISSYM" not in json.dumps(report)


def test_login_error_is_redacted() -> None:
    exc = Mt5ClientError(10004, "auth failed for 99887766 on SecretBroker-Live")
    report, _ = _run(_fresh_ticks(), login_exc=exc)
    leg = report["server_clock_tick"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["error"]["code"] == 10004
    assert "99887766" not in leg["error"]["message"]
    assert "SecretBroker-Live" not in leg["error"]["message"]


def test_main_leg_tick_runs_only_the_tick_leg(monkeypatch: pytest.MonkeyPatch,
                                              capsys: pytest.CaptureFixture[str]) -> None:
    touched: set[str] = set()
    raw = _FakeRaw(touched, _fresh_ticks())
    logins: list[int] = []

    def factory(host: str, port: int) -> _FakeClient:
        client = _FakeClient(touched, raw, [_deal(_HIDDEN, 3600)])
        orig = client.login

        def counting_login(login: int, password: str, server: str) -> None:
            logins.append(login)
            orig(login, password, server)

        client.login = counting_login  # type: ignore[method-assign]
        return client

    for key, value in _ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(mt5_spike, "_default_client_factory", factory)
    assert mt5_spike.main(["--leg", "tick"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert set(out) == {"server_clock_tick", "verdict"}
    assert len(logins) == 1
    assert "order_check" not in touched
