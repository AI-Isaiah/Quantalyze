"""Offline tests for scripts/mt5_soak.py (MT5GOLIVE-02).

The soak/parity runner is the founder's daily go-live verifier: it COMPOSES the
offline-proven 134 spike legs (``run_spike``) with the shipped 136 reconciliation
(``combine_mt5_deal_ledger`` + the forward-NAV roll) against the REAL account, and
appends one sanitized record per run. The actual RUN is human_needed (plan 139-03);
what IS provable offline — and what these tests pin, driven through the injectable
``client_factory`` seam with a fake Mt5Client (no mt5linux, no network) — is:

  * Test 1 (parity green): a ledger consistent with the live equity reconciles
    within max($1, 1e-6·|equity|) → parity_ok True, observation "populated".
  * Test 2 (negative control — TEETH): a $2 equity drift the realized deal ledger
    does NOT explain reddens → parity_ok False AND main() exits non-zero. The gate
    is not vacuous.
  * Test 3 (fail-loud read): an Mt5ClientError from history_deals_get is recorded
    typed (code preserved), NEVER coerced to an empty ledger (the None ≠ ()
    honesty); parity_ok is never True; main exits non-zero.
  * Test 4 (honest empty): a () ledger is INCONCLUSIVE (parity_ok None), never a
    green run; main exits non-zero — a zero-deal ledger can never pass the soak.
  * Test 5 (fail-loud classification): an unclassifiable DEAL_TYPE propagates
    Mt5DealClassificationError out of the parity path (never swallowed).
  * Test 6 (secret hygiene): the written log record carries NO literal of the
    login / investor-password / server string (assert on the serialized file).
  * Test 7 (log append): main writes exactly one sanitized JSON record named
    mt5-soak-<UTC-date>.json to the injected log dir and prints a summary.

WHY the reconstruction anchors ``initial`` to BALANCE (not equity): the shipped
``reconstruct_nav_and_twr`` anchors the realized terminal to
``anchor_nav - open_unrealized_usd`` == balance (nav_twr.py:800). Deriving the
forward-roll ``initial`` from equity would make ``|reconstructed − equity|`` a
mathematical identity (always ~0) — a self-referential oracle with no teeth (the
[[feedback_economic_invariant_oracles_not_self_referential]] lesson). Anchoring
``initial`` to balance keeps the check honest: the realized ledger reconstructs
the balance, and parity to the live equity holds only when the uPnL wedge is
within tolerance — so a $2 unexplained equity drift genuinely reddens.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.deribit_ground_truth import assert_sanitized, sanitize_evidence
from scripts.mt5_soak import main, reconcile_parity, run_soak
from services.mt5_client import Mt5ClientError

_DEAL_TYPE_BUY = 0
_DEAL_TYPE_SELL = 1
_DEAL_TYPE_BALANCE = 2

# Credentials the fake account will never see leak into a record.
_LOGIN = "99887766"
_INVESTOR_PW = "s3cr3t_pw"
_SERVER = "SecretBroker-Demo"

_VALID_ENV = {
    "MT5_SPIKE_LOGIN": _LOGIN,
    "MT5_SPIKE_INVESTOR_PASSWORD": _INVESTOR_PW,
    "MT5_SPIKE_SERVER": _SERVER,
    "MT5_SPIKE_HOST": "10.0.0.9",
    "MT5_SPIKE_PORT": "18812",
    "MT5_SPIKE_CYCLES": "3",
    "MT5_SPIKE_HISTORY_DAYS": "90",
}


def _epoch(year: int, month: int, day: int, hour: int = 12) -> int:
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp())


def _canonical_deals() -> list[dict]:
    """Mirror the 136-03 fixture: initial 100_000, +10_000 BALANCE deposit on
    2025-06-04, trading cash effects summing +500 → balance 110_500."""
    return [
        {"type": _DEAL_TYPE_BUY, "profit": 500.0, "swap": 0.0,
         "commission": -100.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": _DEAL_TYPE_SELL, "profit": 300.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": _DEAL_TYPE_SELL, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 5)},
    ]


class _FakeMt5:
    """RPyC/Mt5Client-shaped double. ``trade_allowed=False`` so the spike leg-2
    read-only proof is GO; investor login only; no trade path."""

    def __init__(
        self,
        *,
        touched,
        equity: float,
        balance: float,
        login: int = 99887766,
        deals=None,
        deals_error: BaseException | None = None,
    ) -> None:
        self._touched = touched
        self._equity = equity
        self._balance = balance
        self._login = login
        self._deals = deals if deals is not None else []
        self._deals_error = deals_error

    def login(self, login, password, server) -> None:
        self._touched.add("login")

    def account_info(self) -> dict:
        self._touched.add("account_info")
        return {
            "equity": self._equity,
            "balance": self._balance,
            "login": self._login,
            "trade_allowed": False,
        }

    def history_deals_get(self, from_ts, to_ts):
        self._touched.add("history_deals_get")
        if self._deals_error is not None:
            raise self._deals_error
        return [dict(d) for d in self._deals]

    def order_check(self, request) -> dict:
        self._touched.add("order_check")
        return {"retcode": 10027, "comment": "AutoTrading disabled by client"}

    def close(self) -> None:
        self._touched.add("close")


def _make_factory(**client_kwargs):
    touched: set[str] = set()

    def factory(host, port):
        return _FakeMt5(touched=touched, **client_kwargs)

    factory.touched = touched  # type: ignore[attr-defined]
    return factory


def _reconcile(factory):
    return reconcile_parity(
        factory,
        "10.0.0.9",
        18812,
        int(_LOGIN),
        _INVESTOR_PW,
        _SERVER,
        history_days=90,
        server_utc_offset_s=0,
        utc_now=datetime(2025, 6, 6, tzinfo=timezone.utc),
    )


# ---------------------------------------------------------------------------
# Test 1 — parity green.
# ---------------------------------------------------------------------------
def test_parity_reconciles_within_tolerance():
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=_canonical_deals())
    parity = _reconcile(factory)

    assert parity["observation"] == "populated"
    assert parity["parity_ok"] is True
    tol = max(1.0, 1e-6 * abs(110_500.0))
    assert abs(parity["reconstructed_terminal"] - 110_500.0) <= tol
    assert parity["tolerance"] == tol
    assert parity["deal_count"] == 4
    assert parity["upnl_wedge"] == 0.0


# ---------------------------------------------------------------------------
# Test 2 — negative control: a $2 equity drift the ledger does NOT explain.
# ---------------------------------------------------------------------------
def test_two_dollar_drift_reddens_parity():
    # Balance (realized) unchanged at 110_500; equity reads $2 higher — an
    # unexplained wedge beyond max($1, 1e-6·|equity|). The realized reconstruction
    # anchors to balance, so this genuinely lands OUTSIDE tolerance.
    factory = _make_factory(equity=110_502.0, balance=110_500.0, deals=_canonical_deals())
    parity = _reconcile(factory)

    assert parity["observation"] == "populated"
    assert parity["parity_ok"] is False
    assert abs(parity["reconstructed_terminal"] - 110_502.0) > parity["tolerance"]
    assert parity["upnl_wedge"] == pytest.approx(2.0)


def test_two_dollar_drift_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=110_502.0, balance=110_500.0, deals=_canonical_deals())
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc != 0


# ---------------------------------------------------------------------------
# Test 3 — fail-loud read: an error is recorded typed, never an empty ledger.
# ---------------------------------------------------------------------------
def test_read_error_records_code_never_empty():
    factory = _make_factory(
        equity=110_500.0,
        balance=110_500.0,
        deals_error=Mt5ClientError(5, "terminal pipe broke"),
    )
    parity = _reconcile(factory)

    assert parity["observation"] == "error"
    assert parity["parity_ok"] is None  # NEVER True on an error read
    assert parity["error"]["code"] == 5
    assert parity["observation"] != "honest_empty"  # None != () honesty


def test_read_error_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(
        equity=110_500.0,
        balance=110_500.0,
        deals_error=Mt5ClientError(5, "terminal pipe broke"),
    )
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc != 0


# ---------------------------------------------------------------------------
# Test 4 — honest empty: a () ledger is INCONCLUSIVE, never a green run.
# ---------------------------------------------------------------------------
def test_empty_ledger_is_inconclusive():
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=[])
    parity = _reconcile(factory)

    assert parity["observation"] == "honest_empty"
    assert parity["parity_ok"] is None  # INCONCLUSIVE — never True
    assert parity["deal_count"] == 0


def test_empty_ledger_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=[])
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc != 0


# ---------------------------------------------------------------------------
# Test 5 — fail-loud classification: an ambiguous DEAL_TYPE propagates.
# ---------------------------------------------------------------------------
def test_unclassifiable_deal_type_propagates():
    from services.mt5_deals import Mt5DealClassificationError

    bad = _canonical_deals()
    bad.append(
        {"type": 5, "profit": 1.0, "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": _epoch(2025, 6, 5)}  # CORRECTION=5 — fails loud (136-05)
    )
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=bad)

    with pytest.raises(Mt5DealClassificationError):
        _reconcile(factory)


# ---------------------------------------------------------------------------
# Test 6 — secret hygiene: no credential literal survives into the log record.
# ---------------------------------------------------------------------------
_UTC_NOW = datetime(2025, 6, 6, tzinfo=timezone.utc)


def _set_env(monkeypatch, tmp_path, **overrides):
    env = dict(_VALID_ENV, MT5_SOAK_LOG_DIR=str(tmp_path))
    env.update(overrides)
    for key in list(env.keys()) + ["MT5_SPIKE_MASTER_PASSWORD"]:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)


def test_written_record_is_sanitized(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    # A leg captures an rpyc error that embeds the credentials — it must be
    # scrubbed before the record is written.
    leaky = Mt5ClientError(
        7, f"connect {_SERVER} failed for pw {_INVESTOR_PW} and login {_LOGIN}"
    )
    factory = _make_factory(
        equity=110_500.0, balance=110_500.0, deals_error=leaky
    )

    main([], client_factory=factory, utc_now=_UTC_NOW)

    files = list(tmp_path.glob("mt5-soak-*.json"))
    assert len(files) == 1
    text = files[0].read_text(encoding="utf-8")
    assert _INVESTOR_PW not in text
    assert _SERVER not in text
    # And the parsed record survives assert_sanitized.
    record = json.loads(text)
    assert_sanitized(record)


# ---------------------------------------------------------------------------
# Test 7 — log append: exactly one record named by UTC date + stdout summary.
# ---------------------------------------------------------------------------
def test_main_writes_one_record_and_prints_summary(tmp_path, monkeypatch, capsys):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=_canonical_deals())

    rc = main([], client_factory=factory, utc_now=_UTC_NOW)

    assert rc == 0  # parity True + spike verdict not NO-GO
    files = list(tmp_path.glob("mt5-soak-*.json"))
    assert len(files) == 1
    assert files[0].name == "mt5-soak-2025-06-06.json"

    out = capsys.readouterr().out
    printed = json.loads(out)
    assert printed["parity"]["parity_ok"] is True
    assert printed["parity"]["observation"] == "populated"

    record = json.loads(files[0].read_text(encoding="utf-8"))
    assert record["parity"]["parity_ok"] is True
    assert "soak_run_at" in record


def test_missing_env_exits_3(monkeypatch, capsys):
    for var in (
        "MT5_SPIKE_LOGIN", "MT5_SPIKE_INVESTOR_PASSWORD", "MT5_SPIKE_SERVER",
        "MT5_SPIKE_HOST", "MT5_SPIKE_PORT",
    ):
        monkeypatch.delenv(var, raising=False)

    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=_canonical_deals())
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)

    assert rc == 3
    err = capsys.readouterr().err
    assert "MT5_SPIKE_LOGIN" in err
    assert _INVESTOR_PW not in err


def test_run_soak_composes_spike_and_parity():
    factory = _make_factory(equity=110_500.0, balance=110_500.0, deals=_canonical_deals())
    report = run_soak(_VALID_ENV, client_factory=factory, utc_now=_UTC_NOW)

    # Composition: the 134 spike legs AND the parity verdict are both present.
    for leg in ("unattended_login", "read_only_proof", "deal_reconstruction",
                "server_time_offset"):
        assert leg in report
    assert report["parity"]["parity_ok"] is True
    assert "soak_run_at" in report


def test_source_composes_not_reimplements():
    src = Path(__file__).resolve().parents[1] / "scripts" / "mt5_soak.py"
    text = src.read_text(encoding="utf-8")
    assert "from scripts.mt5_spike import" in text
    assert "combine_mt5_deal_ledger" in text
    assert "sanitize_evidence" in text
    assert "order_send(" not in text
