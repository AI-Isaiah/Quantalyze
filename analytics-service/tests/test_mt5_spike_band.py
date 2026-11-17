"""Offline tests for the Phase 155.1 band leg of scripts/mt5_spike.py (`--leg band`).

WHY these tests exist: criterion 5 of Phase 155.1 (MT5-06) pins ONE real deal from
the DST divergence week whose UTC day differs between the `eu` and `us` server-clock
rules. The founder runs this leg once against the live gateway (D-18 as changed on
2026-11-16) and the pinned test is written from what it prints. So each test pins
one property that reading depends on:

  * the eu/us class comes from the product seam (`deal_utc_day`) and is right at
    both edges of the one-hour disagreement window, because a wrong class would
    hand the criterion-5 test a deal that cannot go RED under the wrong rule;
  * deals outside the divergence week or the wall band never appear, and an
    undatable deal is counted, never dropped silently;
  * no deal at all in the window reads INCONCLUSIVE, never GO;
  * the report carries no id, symbol, amount, comment, login or server (public
    repo), and the leg logs in once and touches no trade path.

No network, no mt5linux: a fake Mt5Client returning deal dicts.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from scripts import mt5_spike
from scripts.mt5_spike import run_band_spike
from services.mt5_client import Mt5ClientError

_ENV = {
    "MT5_SPIKE_LOGIN": "99887766",
    "MT5_SPIKE_INVESTOR_PASSWORD": "s3cr3t_pw",
    "MT5_SPIKE_SERVER": "SecretBroker-Live",
    "MT5_SPIKE_HOST": "10.0.0.9",
    "MT5_SPIKE_PORT": "8001",
}


def _wall(y: int, mo: int, d: int, h: int, mi: int, s: int = 0) -> int:
    """A deal `time`: the broker wall clock written as if it were UTC."""
    return int(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp())


def _deal(wall_s: Any, ticket: int = 51234567) -> dict[str, Any]:
    return {
        "ticket": ticket,
        "order": ticket + 1,
        "position_id": ticket + 2,
        "time": wall_s,
        "time_msc": wall_s * 1000 if isinstance(wall_s, int) else None,
        "symbol": "SECRETSYM",
        "volume": 1.25,
        "price": 1.08765,
        "profit": 4321.5,
        "comment": "secret-comment",
        "type": 2,
    }


class _FakeClient:
    def __init__(self, touched: list[str], deals: list[dict[str, Any]],
                 login_exc: BaseException | None = None) -> None:
        self._touched = touched
        self._deals = deals
        self._login_exc = login_exc
        self.window: tuple[Any, Any] | None = None

    def login(self, login: int, password: str, server: str) -> None:
        self._touched.append("login")
        if self._login_exc is not None:
            raise self._login_exc

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> list[dict[str, Any]]:
        self._touched.append("history_deals_get")
        self.window = (from_ts, to_ts)
        return [dict(d) for d in self._deals]

    def close(self) -> None:
        self._touched.append("close")


def _run(deals: list[dict[str, Any]], login_exc: BaseException | None = None
         ) -> tuple[dict[str, Any], list[str], list[_FakeClient]]:
    touched: list[str] = []
    made: list[_FakeClient] = []

    def factory(host: str, port: int) -> _FakeClient:
        client = _FakeClient(touched, deals, login_exc)
        made.append(client)
        return client

    report = run_band_spike(_ENV, client_factory=factory)
    return report, touched, made


def test_class_comes_from_the_seam_and_is_right_at_both_edges() -> None:
    # 2026-10-28: eu is +2 h (moved 10-25), us still +3 h (moves 11-01).
    # Wall 02:00:00 is 00:00Z (eu, 10-28) vs 23:00Z (us, 10-27): differs.
    # Wall 02:59:59 still differs; 01:59:59 and 03:00:00 land on one day.
    deals = [
        _deal(_wall(2026, 10, 28, 1, 59, 59)),
        _deal(_wall(2026, 10, 28, 2, 0, 0)),
        _deal(_wall(2026, 10, 28, 2, 59, 59)),
        _deal(_wall(2026, 10, 28, 3, 0, 0)),
    ]
    report, _, _ = _run(deals)
    leg = report["divergence_band_deals"]
    assert leg["in_band"] == [
        {"wall_date": "2026-10-28", "wall_time": "01:59:59", "eu_us_utc_day_differs": False},
        {"wall_date": "2026-10-28", "wall_time": "02:00:00", "eu_us_utc_day_differs": True},
        {"wall_date": "2026-10-28", "wall_time": "02:59:59", "eu_us_utc_day_differs": True},
        {"wall_date": "2026-10-28", "wall_time": "03:00:00", "eu_us_utc_day_differs": False},
    ]
    assert leg["deals_differing"] == 2
    assert leg["verdict"] == "GO"
    assert report["verdict"] == "GO"


def test_only_the_week_and_the_band_are_listed_and_counted() -> None:
    deals = [
        _deal(_wall(2026, 10, 25, 2, 30)),  # before the first wall date
        _deal(_wall(2026, 11, 2, 2, 30)),   # after the last wall date
        _deal(_wall(2026, 10, 30, 12, 0)),  # in the week, outside the band
        _deal(_wall(2026, 10, 30, 0, 59, 59)),  # in the week, just before the band
        _deal(_wall(2026, 11, 1, 2, 15)),   # last wall date, in band
    ]
    report, _, made = _run(deals)
    leg = report["divergence_band_deals"]
    assert leg["deals_fetched"] == 5
    assert leg["deals_in_week"] == 3
    assert leg["deals_in_band"] == 1
    assert [r["wall_date"] for r in leg["in_band"]] == ["2026-11-01"]
    # The fetch window is padded so a deal on either edge wall date is fetched.
    start, end = made[0].window  # type: ignore[misc]
    assert start <= datetime(2026, 10, 26, tzinfo=timezone.utc)
    assert end >= datetime(2026, 11, 2, tzinfo=timezone.utc)


def test_rows_are_sorted_by_wall_date_then_time() -> None:
    deals = [
        _deal(_wall(2026, 10, 29, 2, 10)),
        _deal(_wall(2026, 10, 27, 3, 5)),
        _deal(_wall(2026, 10, 27, 1, 5)),
    ]
    report, _, _ = _run(deals)
    rows = report["divergence_band_deals"]["in_band"]
    assert [(r["wall_date"], r["wall_time"]) for r in rows] == [
        ("2026-10-27", "01:05:00"), ("2026-10-27", "03:05:00"), ("2026-10-29", "02:10:00"),
    ]


def test_no_differing_deal_reads_inconclusive_never_go() -> None:
    report, _, _ = _run([_deal(_wall(2026, 10, 28, 1, 30))])
    leg = report["divergence_band_deals"]
    assert leg["deals_in_band"] == 1
    assert leg["deals_differing"] == 0
    assert leg["verdict"] == "INCONCLUSIVE"
    assert "no deal whose eu and us UTC days differ" in leg["verdict_reasons"]


def test_no_deals_at_all_reads_inconclusive() -> None:
    report, _, _ = _run([])
    leg = report["divergence_band_deals"]
    assert leg["deals_fetched"] == 0
    assert leg["in_band"] == []
    assert leg["verdict"] == "INCONCLUSIVE"


def test_undatable_deal_is_counted_and_blocks_go() -> None:
    deals = [_deal(_wall(2026, 10, 28, 2, 30)), _deal(None), _deal(True)]
    report, _, _ = _run(deals)
    leg = report["divergence_band_deals"]
    assert leg["undatable"] == 2
    assert leg["deals_differing"] == 1
    assert leg["verdict"] == "INCONCLUSIVE"


def test_report_carries_no_id_symbol_amount_login_or_server() -> None:
    report, touched, _ = _run([_deal(_wall(2026, 10, 28, 2, 30))])
    text = json.dumps(report)
    for secret in ["51234567", "51234568", "51234569", "SECRETSYM", "1.25", "1.08765",
                   "4321.5", "secret-comment", _ENV["MT5_SPIKE_LOGIN"],
                   _ENV["MT5_SPIKE_SERVER"], _ENV["MT5_SPIKE_INVESTOR_PASSWORD"]]:
        assert secret not in text, secret
    row = report["divergence_band_deals"]["in_band"][0]
    assert set(row) == {"wall_date", "wall_time", "eu_us_utc_day_differs"}
    assert touched == ["login", "history_deals_get", "close"]


def test_login_error_is_redacted_and_closes() -> None:
    exc = Mt5ClientError(10004, "auth failed for 99887766 on SecretBroker-Live")
    report, touched, _ = _run([], login_exc=exc)
    leg = report["divergence_band_deals"]
    assert leg["verdict"] == "INCONCLUSIVE"
    assert leg["error"]["code"] == 10004
    assert "99887766" not in leg["error"]["message"]
    assert "SecretBroker-Live" not in leg["error"]["message"]
    assert "close" in touched


def test_main_leg_band_runs_only_the_band_leg(monkeypatch: pytest.MonkeyPatch,
                                              capsys: pytest.CaptureFixture[str]) -> None:
    touched: list[str] = []

    def factory(host: str, port: int) -> _FakeClient:
        return _FakeClient(touched, [_deal(_wall(2026, 10, 28, 2, 30))])

    for key, value in _ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(mt5_spike, "_default_client_factory", factory)
    assert mt5_spike.main(["--leg", "band"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert set(out) == {"divergence_band_deals", "verdict"}
    assert out["verdict"] == "GO"
    assert touched.count("login") == 1
    assert out["divergence_band_deals"]["in_band"] == [
        {"wall_date": "2026-10-28", "wall_time": "02:30:00", "eu_us_utc_day_differs": True},
    ]
