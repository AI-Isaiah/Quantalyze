"""Offline tests for the Phase 155.1 clock leg of scripts/mt5_spike.py (`--leg clock`).

WHY these tests exist: the committed remote expression behind
``Mt5Client.server_tick_times`` has never run on the live bridge. The founder runs
this leg ONCE, right after the phase deploys, to prove those exact bytes work and to
read how long the one crossing takes. So each test pins one property that reading
depends on:

  * the leg calls the PRODUCTION ``server_tick_times`` and assesses it under both
    rules, and its overall verdict follows the us-rule verdict only;
  * ``crossing_elapsed_s`` brackets exactly that one call (not the login, not
    ``account_info``) and is reported even when the call raises, because a slow
    FAILING crossing is itself the evidence the derive read bound needs;
  * ``crossing_elapsed_s`` is evidence, never a threshold: it cannot move a verdict;
  * a failed read, an empty answer and a login that landed on another account each
    have their own verdict, and the client is always closed;
  * the report carries only counts, offsets, residual, verdicts, reasons and the
    elapsed seconds (public repo): no login, server, password, symbol or id.

No network, no mt5linux: a fake Mt5Client. Nothing here touches a gateway.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import pytest

from scripts import mt5_spike
from scripts.mt5_spike import run_clock_spike
from services.mt5_client import Mt5ClientError, Mt5ServerTickTimes

_ENV = {
    "MT5_SPIKE_LOGIN": "99887766",
    "MT5_SPIKE_INVESTOR_PASSWORD": "s3cr3t_pw",
    "MT5_SPIKE_SERVER": "SecretBroker-Live",
    "MT5_SPIKE_HOST": "10.0.0.9",
    "MT5_SPIKE_PORT": "8001",
}

# 2026-11-17 12:00:00Z: both rules put the broker on +2 h (eu since 10-25, us since
# 11-01), so a healthy reading is a match under BOTH rules.
_NOW = datetime(2026, 11, 17, 12, 0, 0, tzinfo=timezone.utc)
_NOW_MS = 1_794_916_800_000  # 2026-11-17T12:00:00Z, typed by hand (epoch seconds * 1000)


def _utc_now() -> datetime:
    return _NOW


class _FakeClient:
    def __init__(
        self,
        events: list[str],
        *,
        tick: Mt5ServerTickTimes | None = None,
        tick_exc: BaseException | None = None,
        login_exc: BaseException | None = None,
        account_login: int = 99887766,
    ) -> None:
        self._events = events
        self._tick = tick
        self._tick_exc = tick_exc
        self._login_exc = login_exc
        self._account_login = account_login

    def login(self, login: int, password: str, server: str) -> None:
        self._events.append("login")
        if self._login_exc is not None:
            raise self._login_exc

    def account_info(self) -> dict[str, Any]:
        self._events.append("account_info")
        return {"login": self._account_login, "balance": 12345.67}

    def server_tick_times(self) -> Mt5ServerTickTimes:
        self._events.append("server_tick_times")
        if self._tick_exc is not None:
            raise self._tick_exc
        assert self._tick is not None
        return self._tick

    def close(self) -> None:
        self._events.append("close")


def _healthy_tick(offset_ms: int = 7_199_836) -> Mt5ServerTickTimes:
    return Mt5ServerTickTimes(1416, 14, 14, _NOW_MS + offset_ms)


def _run(
    events: list[str],
    *,
    monotonic_fn: Any = None,
    **client_kwargs: Any,
) -> dict[str, Any]:
    def factory(host: str, port: int) -> _FakeClient:
        return _FakeClient(events, **client_kwargs)

    return run_clock_spike(
        _ENV, client_factory=factory, utc_now_fn=_utc_now, monotonic_fn=monotonic_fn
    )


def test_the_fixture_epoch_is_2026_11_17_noon_utc() -> None:
    assert int(_NOW.timestamp() * 1000) == _NOW_MS


def test_a_healthy_reading_is_go_with_a_match_under_both_rules() -> None:
    report = _run([], tick=_healthy_tick())
    leg = report["server_clock_live"]
    assert leg["verdict_us"] == "match"
    assert leg["verdict_eu"] == "match"
    assert leg["measured_offset_s"] == 7200
    assert leg["residual_s"] == pytest.approx(0.164, abs=1e-6)
    assert leg["raw_offset_s"] == pytest.approx(7199.836, abs=1e-6)
    assert (leg["symbols_total"], leg["symbols_visible"], leg["symbols_answered"]) == (
        1416, 14, 14,
    )
    assert leg["reason"] is None
    assert leg["verdict"] == "GO"
    assert report["verdict"] == "GO"


def test_a_clock_an_hour_off_is_no_go_under_both_rules() -> None:
    # A broker reading UTC + 3 h on a day both rules call +2 h is the mismatch the
    # derive refuses on: the leg must not call it GO.
    report = _run([], tick=_healthy_tick(offset_ms=10_799_900))
    leg = report["server_clock_live"]
    assert leg["verdict_us"] == "mismatch"
    assert leg["verdict_eu"] == "mismatch"
    assert leg["measured_offset_s"] == 10800
    assert leg["verdict"] == "NO-GO"


def test_the_timer_brackets_exactly_the_one_server_tick_times_call() -> None:
    events: list[str] = []
    readings = iter([100.0, 101.25])

    def monotonic() -> float:
        events.append("monotonic")
        return next(readings)

    report = _run(events, tick=_healthy_tick(), monotonic_fn=monotonic)
    assert report["server_clock_live"]["crossing_elapsed_s"] == pytest.approx(1.25)
    # Not the login, not account_info: the first read is right before the call and
    # the second right after it.
    assert events == [
        "login", "account_info", "monotonic", "server_tick_times", "monotonic", "close",
    ]


def test_a_slow_crossing_is_reported_but_never_moves_the_verdict() -> None:
    readings = iter([0.0, 600.0])
    report = _run([], tick=_healthy_tick(), monotonic_fn=lambda: next(readings))
    leg = report["server_clock_live"]
    assert leg["crossing_elapsed_s"] == pytest.approx(600.0)
    assert leg["verdict"] == "GO"


def test_a_raising_crossing_still_reports_its_elapsed_time() -> None:
    readings = iter([10.0, 14.5])
    events: list[str] = []
    report = _run(
        events,
        tick_exc=Mt5ClientError(None, "listing unanswered"),
        monotonic_fn=lambda: next(readings),
    )
    leg = report["server_clock_live"]
    assert leg["crossing_elapsed_s"] == pytest.approx(4.5)
    assert leg["verdict"] == "NO-GO"


def test_a_failed_tick_read_is_no_go_tick_read_failed_and_closes() -> None:
    events: list[str] = []
    report = _run(events, tick_exc=Mt5ClientError(None, "tick read failed"))
    leg = report["server_clock_live"]
    assert leg["verdict"] == "NO-GO"
    assert leg["reason"] == "tick_read_failed"
    assert leg["verdict_us"] == "unmeasured"
    assert leg["measured_offset_s"] is None
    assert events[-1] == "close"


def test_a_failed_tick_read_message_is_redacted() -> None:
    exc = Mt5ClientError(10004, "tick failed for 99887766 on SecretBroker-Live pw s3cr3t_pw")
    report = _run([], tick_exc=exc)
    text = json.dumps(report)
    for secret in (
        _ENV["MT5_SPIKE_LOGIN"], _ENV["MT5_SPIKE_SERVER"], _ENV["MT5_SPIKE_INVESTOR_PASSWORD"],
    ):
        assert secret not in text, secret


def test_no_newest_tick_is_inconclusive_no_tick() -> None:
    report = _run([], tick=Mt5ServerTickTimes(1416, 14, 0, None))
    leg = report["server_clock_live"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["reason"] == "no_tick"
    assert leg["symbols_answered"] == 0


def test_a_login_that_landed_on_another_account_is_no_go_and_reads_no_ticks() -> None:
    events: list[str] = []
    report = _run(events, tick=_healthy_tick(), account_login=11112222)
    leg = report["server_clock_live"]
    assert leg["verdict"] == "NO-GO"
    assert leg["reason"] == "login_mismatch"
    assert "server_tick_times" not in events
    assert events[-1] == "close"
    # The mismatch error names both logins; neither may reach the report.
    text = json.dumps(report)
    assert "11112222" not in text
    assert _ENV["MT5_SPIKE_LOGIN"] not in text


def test_a_login_error_is_inconclusive_redacted_and_closes() -> None:
    events: list[str] = []
    exc = Mt5ClientError(10004, "auth failed for 99887766 on SecretBroker-Live")
    report = _run(events, login_exc=exc)
    leg = report["server_clock_live"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["error"]["code"] == 10004
    assert "99887766" not in leg["error"]["message"]
    assert "SecretBroker-Live" not in leg["error"]["message"]
    assert "server_tick_times" not in events
    assert events[-1] == "close"


def test_report_carries_only_counts_offsets_residual_verdicts_reasons_and_elapsed() -> None:
    report = _run([], tick=_healthy_tick())
    leg = report["server_clock_live"]
    assert set(leg) == {
        "symbols_total", "symbols_visible", "symbols_answered", "raw_offset_s",
        "measured_offset_s", "residual_s", "crossing_elapsed_s", "verdict_eu",
        "verdict_us", "reason", "verdict",
    }
    text = json.dumps(report)
    for secret in (
        _ENV["MT5_SPIKE_LOGIN"], _ENV["MT5_SPIKE_SERVER"],
        _ENV["MT5_SPIKE_INVESTOR_PASSWORD"], "12345.67",
    ):
        assert secret not in text, secret


def test_main_leg_clock_runs_only_the_clock_leg(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    events: list[str] = []

    def factory(host: str, port: int) -> _FakeClient:
        # The leg reads the real clock on this path, so the tick is built from it.
        tick = Mt5ServerTickTimes(1416, 14, 14, int(time.time() * 1000) + 7_200_000)
        return _FakeClient(events, tick=tick)

    for key, value in _ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(mt5_spike, "_default_client_factory", factory)
    assert mt5_spike.main(["--leg", "clock"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert set(out) == {"server_clock_live", "verdict"}
    assert out["verdict"] in {"GO", "NO-GO", "INCONCLUSIVE"}
    assert events.count("login") == 1
    assert events.count("server_tick_times") == 1
