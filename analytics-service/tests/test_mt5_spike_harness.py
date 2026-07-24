"""Offline harness tests for scripts/mt5_spike.py (MT5SPIKE-01).

Regression gates — WHY each test earns its place:

  * The four LIVE proof legs (unattended Wine login, order_check read-only
    signal, deal-reconstruction viability, server-time offset) are human_needed
    and run in plan 134-03's checkpoint against a real broker demo. NOTHING here
    claims a live gate passed. What IS provable offline — and what these tests
    pin — is the harness's report-assembly, verdict, exit-code, secret-hygiene,
    and no-trade-path logic, driven through the injectable ``client_factory``
    seam with a fake Mt5Client. No network, no mt5linux, no live terminal.

  * test_leg3_distinguishes_none_error_from_empty is the load-bearing one:
    coercing a history_deals_get ERROR into "zero deals" would fabricate a flat
    account inside the very harness meant to prove honesty (the None≠() pitfall
    that motivates the whole source). It MUST record an error observation with
    its code, never an honest-empty.

  * test_leg2_never_calls_order_send_and_records_probe + the source-token guard
    encode the read-only premise structurally: the spike touches a live account,
    so the trade path must be unreachable by construction, not by intention.

  * test_emitted_report_is_sanitized proves credentials never survive into the
    emitted report — a leaked broker password interpolated into an rpyc error is
    a real disclosure (T-134-06).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts.deribit_ground_truth import assert_sanitized, sanitize_evidence
from scripts.mt5_spike import main, run_spike
from services.mt5_client import Mt5ClientError

# DEAL_TYPE_BALANCE == 2 (external deposit/withdrawal flow, never a return).
_DEAL_TYPE_BALANCE = 2

_VALID_ENV = {
    "MT5_SPIKE_LOGIN": "99887766",
    "MT5_SPIKE_INVESTOR_PASSWORD": "s3cr3t_pw",
    "MT5_SPIKE_SERVER": "SecretBroker-Demo",
    "MT5_SPIKE_HOST": "10.0.0.9",
    "MT5_SPIKE_PORT": "18812",
    "MT5_SPIKE_CYCLES": "10",
    "MT5_SPIKE_HISTORY_DAYS": "90",
}


class _FakeMt5:
    """RPyC/Mt5Client-shaped double. Records every method touched into a shared
    ``touched`` set so the no-trade-path invariant is checkable after a run."""

    def __init__(
        self,
        *,
        touched,
        login_effect=None,
        account_info=None,
        deals=None,
        order_check_result=None,
    ) -> None:
        self._touched = touched
        self._login_effect = login_effect
        self._account_info = account_info or {"trade_allowed": False, "login": 99887766}
        self._deals = deals if deals is not None else []
        self._order_check_result = order_check_result or {
            "retcode": 10027,
            "comment": "AutoTrading disabled by client",
        }

    def login(self, login, password, server) -> None:
        self._touched.add("login")
        if self._login_effect is not None:
            self._login_effect(login, password, server)

    def account_info(self) -> dict:
        self._touched.add("account_info")
        return dict(self._account_info)

    def history_deals_get(self, from_ts, to_ts) -> list[dict]:
        self._touched.add("history_deals_get")
        if isinstance(self._deals, BaseException):
            raise self._deals
        return [dict(d) for d in self._deals]

    def order_check(self, request) -> dict:
        self._touched.add("order_check")
        return dict(self._order_check_result)

    def close(self) -> None:
        self._touched.add("close")


def _make_factory(**client_kwargs):
    """A factory producing identical happy fakes; shares one ``touched`` set."""
    touched: set[str] = set()

    def factory(host, port):
        return _FakeMt5(touched=touched, **client_kwargs)

    factory.touched = touched  # type: ignore[attr-defined]
    return factory


def _make_cycle_factory(fail_cycles, **client_kwargs):
    """Factory whose Nth-produced client's login raises for N in ``fail_cycles``
    (leg-1 unattended-login flakiness simulation)."""
    touched: set[str] = set()
    state = {"n": 0}

    def factory(host, port):
        i = state["n"]
        state["n"] += 1

        effect = None
        if i in fail_cycles:
            def effect(login, password, server):
                raise Mt5ClientError(10001, "unattended login timed out")

        return _FakeMt5(touched=touched, login_effect=effect, **client_kwargs)

    factory.touched = touched  # type: ignore[attr-defined]
    return factory


_POPULATED_DEALS = [
    {
        "ticket": 1,
        "time": 1_700_000_000,
        "time_msc": 1_700_000_000_000,
        "type": 0,
        "profit": 12.5,
        "swap": -0.3,
        "commission": -0.7,
        "fee": 0.0,
    },
    {
        "ticket": 2,
        "time": 1_700_100_000,
        "time_msc": 1_700_100_000_000,
        "type": _DEAL_TYPE_BALANCE,
        "profit": 0.0,
        "swap": 0.0,
        "commission": 0.0,
        "fee": 0.0,
    },
]


def test_missing_env_exits_3(monkeypatch, capsys):
    for var in (
        "MT5_SPIKE_LOGIN",
        "MT5_SPIKE_INVESTOR_PASSWORD",
        "MT5_SPIKE_SERVER",
        "MT5_SPIKE_HOST",
        "MT5_SPIKE_PORT",
    ):
        monkeypatch.delenv(var, raising=False)

    rc = main([])

    assert rc == 3
    err = capsys.readouterr().err
    assert "ERROR" in err
    assert "MT5_SPIKE_LOGIN" in err
    # No secret values leak (none were set anyway, but the line must be safe).
    assert "s3cr3t_pw" not in err


def test_report_has_four_legs_with_verdicts():
    factory = _make_factory(deals=_POPULATED_DEALS)
    report = run_spike(_VALID_ENV, client_factory=factory)

    for leg in (
        "unattended_login",
        "read_only_proof",
        "deal_reconstruction",
        "server_time_offset",
    ):
        assert leg in report
        assert report[leg]["verdict"] in {"GO", "NO-GO", "INCONCLUSIVE"}

    assert report["verdict"] in {"GO", "NO-GO", "INCONCLUSIVE"}


def test_leg1_no_go_emits_escape_hatch():
    # 6 of 10 login cycles fail -> success_rate 0.4 < 0.8 -> NO-GO.
    factory = _make_cycle_factory(fail_cycles={0, 1, 2, 3, 4, 5}, deals=_POPULATED_DEALS)
    report = run_spike(_VALID_ENV, client_factory=factory)

    leg1 = report["unattended_login"]
    assert leg1["verdict"] == "NO-GO"
    hatch = json.dumps(leg1)
    assert "Windows VPS" in hatch
    assert "identical" in hatch.lower()


def test_leg2_never_calls_order_send_and_records_probe():
    factory = _make_factory(deals=_POPULATED_DEALS)
    report = run_spike(_VALID_ENV, client_factory=factory)

    touched = factory.touched  # type: ignore[attr-defined]
    assert "order_check" in touched
    assert "account_info" in touched
    assert "order_send" not in touched

    leg2 = report["read_only_proof"]
    investor = leg2["investor"]
    assert "retcode" in investor
    assert "comment" in investor
    assert "trade_allowed" in investor


def test_leg2_master_comparison_when_master_password_set():
    env = dict(_VALID_ENV, MT5_SPIKE_MASTER_PASSWORD="master_pw")
    factory = _make_factory(deals=_POPULATED_DEALS)
    report = run_spike(env, client_factory=factory)

    leg2 = report["read_only_proof"]
    assert "investor" in leg2
    assert "master" in leg2
    assert leg2.get("partial") is False


def test_leg2_partial_when_no_master_password():
    factory = _make_factory(deals=_POPULATED_DEALS)
    report = run_spike(_VALID_ENV, client_factory=factory)

    leg2 = report["read_only_proof"]
    assert leg2.get("partial") is True
    assert "master" not in leg2


def test_leg3_error_records_code_not_zero_deals():
    factory = _make_factory(deals=Mt5ClientError(5, "terminal pipe broke"))
    report = run_spike(_VALID_ENV, client_factory=factory)

    leg3 = report["deal_reconstruction"]
    assert leg3["observation"] == "error"
    assert leg3["error"]["code"] == 5
    # An error is NEVER coerced into an honest-empty "zero deals" reading.
    assert leg3["observation"] != "honest_empty"


def test_leg3_honest_empty():
    factory = _make_factory(deals=[])
    report = run_spike(_VALID_ENV, client_factory=factory)

    leg3 = report["deal_reconstruction"]
    assert leg3["observation"] == "honest_empty"
    assert leg3["deal_count"] == 0


def test_leg3_populated_reports_field_presence_and_balance_row():
    factory = _make_factory(deals=_POPULATED_DEALS)
    report = run_spike(_VALID_ENV, client_factory=factory)

    leg3 = report["deal_reconstruction"]
    assert leg3["observation"] == "populated"
    assert leg3["deal_count"] == 2
    fp = leg3["field_presence"]
    for field in ("profit", "swap", "commission", "fee"):
        assert fp[field] is True
    assert leg3["has_balance_deal"] is True


def test_leg4_offset_rounded_to_half_hour():
    utc_now = datetime(2026, 7, 23, 12, 0, 0, tzinfo=timezone.utc)
    # Most recent deal stamped at server time = UTC + 2h.
    latest = int((utc_now + timedelta(hours=2)).timestamp())
    deals = [dict(_POPULATED_DEALS[0], time=latest, time_msc=latest * 1000)]
    factory = _make_factory(deals=deals)

    report = run_spike(_VALID_ENV, client_factory=factory, utc_now=utc_now)

    leg4 = report["server_time_offset"]
    assert leg4["candidate_offset_minutes"] == 120
    assert leg4["founder_confirmation_required"] is True


def test_emitted_report_is_sanitized():
    # A leg captures an rpyc error whose text embeds the broker password + server.
    leaky = Mt5ClientError(
        7, "connect SecretBroker-Demo failed for pw s3cr3t_pw and login 99887766"
    )
    factory = _make_factory(deals=leaky)
    report = run_spike(_VALID_ENV, client_factory=factory)

    clean = sanitize_evidence(report)
    assert_sanitized(clean)  # raises if any secret survived

    dumped = json.dumps(clean, default=str)
    assert "s3cr3t_pw" not in dumped
    assert "SecretBroker-Demo" not in dumped


def test_harness_source_has_no_order_send_call_token():
    src = Path(__file__).resolve().parents[1] / "scripts" / "mt5_spike.py"
    text = src.read_text(encoding="utf-8")
    assert "order_send(" not in text
