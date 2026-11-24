"""Offline tests for scripts/mt5_soak.py (MT5GOLIVE-02).

The soak/parity runner is the founder's daily go-live verifier: it COMPOSES the
offline-proven 134 spike legs (``run_spike``) with the shipped 136 reconciliation
(``combine_mt5_deal_ledger`` + the forward-NAV roll) against the REAL account, and
appends one sanitized record per run. The actual RUN is human_needed (plan 139-03);
what IS provable offline — and what these tests pin, driven through the injectable
``client_factory`` seam with a fake Mt5Client (no mt5linux, no network) — is:

  * Test 1 (parity green): a flat ledger reconstructs to BALANCE within
    max($1, 1e-6·|balance|) with a zero wedge → parity_ok True, observation
    "populated".
  * Test 2 (WR-01 — the reconstruction/wedge split): fidelity is
    reconstructed-vs-BALANCE, and the open-position uPnL wedge (equity − balance) is
    gated SEPARATELY at the 136 UNREALIZED_MATERIALITY_RATIO. 2a — a small legitimate
    wedge reconstructs perfectly and passes (pre-fix it false-FAILed vs equity). 2b —
    a MATERIAL wedge reconstructs perfectly yet is NOT green (parity_ok False, exits
    non-zero), reported distinctly from a fidelity FAIL. 2c — a genuine $2
    reconstruction drift vs balance still reddens fidelity (the gate keeps its teeth).
  * CR-01 (read-only premise — TEETH): a trade-ENABLED account with clean parity
    yields an INCONCLUSIVE (not NO-GO) read-only leg; the gate requires the leg to
    POSITIVELY pass (GO), so main() exits non-zero. Reds against the `!= "NO-GO"`
    gate.
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

import ast
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts.deribit_ground_truth import assert_sanitized, sanitize_evidence
from scripts.mt5_soak import (
    _forward_terminal_nav,
    _parity_tolerance,
    main,
    reconcile_parity,
    run_soak,
)
import services.broker_dailies as broker_dailies
import services.mt5_deals as mt5_deals
import services.nav_twr as nav_twr
import services.tiny_base as tiny_base
from services.account_unit import USD_FLOORS, classify_account_currency
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


def _btc_canonical_deals() -> list[dict]:
    """``_canonical_deals`` scaled by 1e-5 on profit and commission: a 1.105 BTC account
    (initial 1.0; 06-02 BUY cash 0.004; 06-04 deposit 0.1 and SELL 0.003; 06-05 SELL -0.002)."""
    return [
        {**deal, "profit": deal["profit"] * 1e-5, "commission": deal["commission"] * 1e-5}
        for deal in _canonical_deals()
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
        trade_allowed: bool = False,
        currency: str = "USD",
    ) -> None:
        self._touched = touched
        self._equity = equity
        self._balance = balance
        self._login = login
        self._deals = deals if deals is not None else []
        self._deals_error = deals_error
        self._trade_allowed = trade_allowed
        self._currency = currency

    def login(self, login, password, server) -> None:
        self._touched.add("login")

    def account_info(self) -> dict:
        self._touched.add("account_info")
        return {
            "equity": self._equity,
            "balance": self._balance,
            "currency": self._currency,
            "login": self._login,
            "trade_allowed": self._trade_allowed,
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
    # Fidelity is reconstructed-vs-BALANCE (WR-01); the flat account has a zero wedge.
    tol = max(1.0, 1e-6 * abs(110_500.0))  # == $1 at this scale
    assert abs(parity["reconstructed_terminal"] - 110_500.0) <= tol
    assert parity["recon_tolerance"] == tol
    assert parity["recon_ok"] is True
    assert abs(parity["recon_residual"]) <= tol
    assert parity["deal_count"] == 4
    assert parity["upnl_wedge"] == 0.0
    assert parity["wedge_within_materiality"] is True


# ---------------------------------------------------------------------------
# Test 2 (WR-01) — an open-position uPnL wedge is NOT a reconstruction breach.
#
# 2a: a SMALL legitimate wedge (equity $2 above balance) reconstructs to balance
#     PERFECTLY and the wedge is within materiality → parity_ok True. Pre-WR-01 this
#     compared reconstructed vs EQUITY under max($1,1e-6·equity)=$1, so the $2 wedge
#     false-FAILed a correctly-reconstructed account. Reds against the pre-fix gate.
# 2b: a MATERIAL wedge (equity 110_000, balance 100_000 → 9.09% > 5%) reconstructs to
#     balance PERFECTLY (recon_ok True) yet is NOT a green run — parity_ok False and
#     main() exits non-zero. The wedge is reported distinctly, never conflated with a
#     fidelity FAIL. Mirrors the 136-03 derive-branch materiality fixture.
# 2c: a GENUINE reconstruction error (reconstructed off balance by $2) still FAILs
#     fidelity — the balance-anchored fidelity gate keeps its teeth (hand-derived).
# ---------------------------------------------------------------------------
def test_small_wedge_within_materiality_passes():
    # WR-01 regression: balance 110_500 (realized ledger reconstructs it exactly);
    # equity reads $2 higher → a $2 open-position uPnL wedge. 2/110_502 ≈ 1.8e-5 well
    # under the 5% materiality ratio, so this is a legitimate flat-ish account, NOT a
    # reconstruction breach → parity_ok True. (Pre-fix: |reconstructed−equity|=$2 > $1
    # tolerance → false FAIL.)
    factory = _make_factory(equity=110_502.0, balance=110_500.0, deals=_canonical_deals())
    parity = _reconcile(factory)

    assert parity["observation"] == "populated"
    assert parity["recon_ok"] is True
    assert abs(parity["reconstructed_terminal"] - 110_500.0) <= parity["recon_tolerance"]
    assert parity["upnl_wedge"] == pytest.approx(2.0)
    assert parity["wedge_within_materiality"] is True
    assert parity["parity_ok"] is True


def test_small_wedge_exits_zero(tmp_path, monkeypatch):
    # The corrected end-to-end verdict: a correctly-reconstructed account carrying a
    # tiny legitimate open-position wedge PASSES the soak (read-only leg is GO on the
    # trade_allowed=False fake). Reds against the pre-WR-01 gate (which exited 1).
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=110_502.0, balance=110_500.0, deals=_canonical_deals())
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc == 0


def test_material_wedge_reconstructs_but_is_not_green():
    # Balance 100_000 (the realized ledger reconstructs it EXACTLY — perfect
    # fidelity), equity 110_000 → wedge 10_000; 10_000/110_000 ≈ 0.0909 > 0.05. The
    # reconstruction is correct, but a MATERIAL open-position wedge must NOT count as
    # a green soak run — and it must be reported as a wedge, never a fidelity FAIL.
    factory = _make_factory(equity=110_000.0, balance=100_000.0, deals=_canonical_deals())
    parity = _reconcile(factory)

    assert parity["observation"] == "populated"
    assert parity["recon_ok"] is True  # fidelity vs BALANCE holds
    assert abs(parity["reconstructed_terminal"] - 100_000.0) <= parity["recon_tolerance"]
    assert parity["upnl_wedge"] == pytest.approx(10_000.0)
    assert parity["wedge_within_materiality"] is False  # 9.09% > 5%
    assert parity["parity_ok"] is False  # material wedge → not green


def test_material_wedge_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=110_000.0, balance=100_000.0, deals=_canonical_deals())
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc != 0


def test_fidelity_gate_has_teeth_vs_balance():
    # WR-01 negative control (hand-derived, mirrors test_mt5_derive_branch.py:638):
    # the fidelity gate is reconstructed-vs-BALANCE under max($1, 1e-6·|balance|). If
    # the reconstruction were off balance by $2 (a genuine roll/anchor bug), it lands
    # OUTSIDE tolerance and reddens — the gate is not vacuous. balance 110_500 →
    # tolerance max($1, 0.1105) = $1; a $2 drift exceeds it.
    balance = 110_500.0
    tol = _parity_tolerance(balance)  # == $1 at this scale
    assert tol == pytest.approx(1.0)
    # A correct reconstruction (initial rolls to balance) is within tolerance …
    correct = _forward_terminal_nav({}, initial=balance, flows_by_day={})
    assert abs(correct - balance) <= tol
    # … but a $2 drift on the reconstructed terminal reddens fidelity.
    drifted = _forward_terminal_nav({}, initial=balance + 2.0, flows_by_day={})
    assert abs(drifted - balance) > tol


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
# CR-01 — a trade-ENABLED account is NEVER a green soak run, even with clean parity.
#
# The read-only investor-login premise is the entire security basis of this
# integration. run_spike's read-only leg returns INCONCLUSIVE (NOT NO-GO) whenever
# trade_allowed is not False (mt5_spike.py:245) — including a trade-ENABLED account.
# The pre-fix gate (parity_ok True AND verdict != "NO-GO") green-lit that exact case.
# The fixed gate additionally requires the read-only leg to POSITIVELY pass
# (verdict == "GO"), so a trade-enabled account exits NON-ZERO. Reds against the
# pre-fix `!= "NO-GO"` gate (which returned 0 here).
# ---------------------------------------------------------------------------
def test_trade_enabled_account_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    # Clean parity (equity == balance, canonical ledger) so parity_ok is True and the
    # ONLY thing withholding a green verdict is the unconfirmed read-only premise.
    factory = _make_factory(
        equity=110_500.0, balance=110_500.0, deals=_canonical_deals(),
        trade_allowed=True,
    )
    rc = main([], client_factory=factory, utc_now=_UTC_NOW)
    assert rc != 0


def test_trade_enabled_readonly_leg_is_inconclusive_not_nogo():
    # Prove the failure MODE the gate must catch: a trade-enabled account yields an
    # INCONCLUSIVE read-only leg (never NO-GO) and clean parity — so the pre-fix
    # `!= "NO-GO"` gate would have returned 0. The verdict split is what the CR-01
    # gate keys on.
    factory = _make_factory(
        equity=110_500.0, balance=110_500.0, deals=_canonical_deals(),
        trade_allowed=True,
    )
    report = run_soak(_VALID_ENV, client_factory=factory, utc_now=_UTC_NOW)

    assert report["read_only_proof"]["verdict"] == "INCONCLUSIVE"
    assert report["verdict"] != "NO-GO"  # the pre-fix gate would have passed this
    assert report["parity"]["parity_ok"] is True


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
    assert _LOGIN not in text  # IN-01: the login is scrubbed too, never emitted
    # And the parsed record survives assert_sanitized.
    record = json.loads(text)
    assert_sanitized(record)


def test_sanitize_masks_login_key():
    """IN-01: a future record embedding ``account_info()`` (which carries the raw
    ``login``) must have the login MASKED, not emitted verbatim. Exercises the
    ``login`` entry added to sanitize's ``_MASK_KEYS`` directly, so a regression
    that stores the account snapshot into the soak record is caught."""
    record = {"account": {"login": _LOGIN, "equity": 110_500.0, "trade_allowed": False}}
    clean = sanitize_evidence(record)
    text = json.dumps(clean)
    assert _LOGIN not in text  # masked via truncate_account_id (***<last4>)
    assert clean["account"]["login"] != _LOGIN
    assert_sanitized(clean)


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


def test_forward_terminal_nav_includes_flow_only_days():
    """WR-01 regression (red-team FABLE, 2026-07-25): a deposit on a day with NO
    computable return — an account funded INSIDE the window, whose day-0 return
    NaN-breaks because prior NAV is 0 — must still be included in the forward roll.
    Iterating only ``returns_by_day`` dropped that deposit while ``initial`` still
    subtracted it, reconstructing ~0 and FALSE-failing the fidelity gate for exactly
    the real prod account (first $10k deposit 03-17, first return 03-20). Rolling over
    the UNION of return-days and flow-days lands the deposit at the right point."""
    pnl_by_day = {"2026-03-20": 10_000.0}  # trading starts day 3; funding day has none
    flows_by_day = {"2026-03-17": 100_000.0, "2026-03-20": 0.0}
    # initial = 0 (funded-inside-window). day1 deposit: 0+0+100000; day3: 100000+10000.
    nav = _forward_terminal_nav(pnl_by_day, initial=0.0, flows_by_day=flows_by_day)
    assert nav == pytest.approx(110_000.0)  # pre-fix (return-days only) reconstructs 0.0


# ---------------------------------------------------------------------------
# FLOWTIMING WR-01 — the fidelity roll is on LEVELS, not on the returns.
#
# Since plan 05 a timed flow day's return is a COHORT return, so the end-of-day identity
# NAV_t = NAV_{t-1}*(1+r_t) + F_t no longer holds on it. The ledger below is the review's
# reproduction: 10_000 deposited on 10-16, 100_000 deposited at 09:00 on 10-17, a position
# opened at 10:00 that day and closed at 15:00 for +1_100, then +500 the next day. The
# account ends at 10_000 + 100_000 + 1_100 + 500 = 111_600 and the soak's reconstruction is
# CORRECT, so the gate must be green. Rolling the returns forward gave 110_595.50 here (a
# -1_004.50 residual on a $1 tolerance) and exited 1 on a correct account.
# ---------------------------------------------------------------------------
def _ms(day: int, hh: int, mm: int = 0) -> int:
    return int(datetime(2025, 10, day, hh, mm, tzinfo=timezone.utc).timestamp()) * 1000


def _stamped_deal(row: dict, utc_ms: int) -> dict:
    return {
        **row,
        "swap": 0.0, "commission": 0.0, "fee": 0.0,
        "time": utc_ms // 1000, "time_msc": utc_ms,
    }


def _timed_deposit_then_trade_deals() -> list[dict]:
    return [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(16, 8)),
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100_000.0}, _ms(17, 9)),
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 7, "profit": 0.0}, _ms(17, 10)
        ),
        _stamped_deal(
            {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 7, "profit": 1_100.0},
            _ms(17, 15),
        ),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 500.0}, _ms(18, 12)),
    ]


def test_a_timed_deposit_then_trade_day_reconciles_to_the_balance():
    factory = _make_factory(
        equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
    )
    parity = _reconcile(factory)

    assert parity["observation"] == "populated"
    assert parity["total_trading_pnl"] == pytest.approx(1_600.0)
    assert parity["total_flows"] == pytest.approx(110_000.0)
    # The level roll NAV_t = NAV_{t-1} + P_t + F_t lands on the balance to the cent; the
    # return roll landed 110_595.50 (off by -1_004.50) because day 10-17's r_t is cohort-based.
    assert parity["reconstructed_terminal"] == pytest.approx(111_600.0)
    assert parity["recon_ok"] is True
    assert parity["parity_ok"] is True


def test_a_timed_deposit_then_trade_day_exits_zero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(
        equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
    )
    assert main([], client_factory=factory, utc_now=_UTC_NOW) == 0


# ---------------------------------------------------------------------------
# FLOWTIMING R2-01 — the fidelity gate must still see the PUBLISHED return series.
#
# After the WR-01 level roll, `initial = balance - Σtrading_pnl - Σflows` and the roll
# `initial + Σfold_pnl + Σflows` reduce to `Σfold_pnl - Σtrading_pnl`, an identity over the
# same primitives: recon_ok was True for ANY return series the combiner produced (the review
# reproduced +700% a day certified green). The tests below go through `reconcile_parity`
# itself (not the roll helper) and corrupt what the combiner PUBLISHES. Each must fail on an
# identity-only gate, and the positive controls above (the real combiner) must stay green.
# ---------------------------------------------------------------------------
import pandas as pd  # noqa: E402

import scripts.mt5_soak as _soak  # noqa: E402


def _publish_corrupted(monkeypatch, corrupt):
    """Make the soak's combiner hand back `corrupt(real_returns)`; meta untouched."""
    real = _soak.combine_mt5_deal_ledger

    def wrapped(*args, **kwargs):
        returns, meta = real(*args, **kwargs)
        return corrupt(returns.copy()), meta

    monkeypatch.setattr(_soak, "combine_mt5_deal_ledger", wrapped)


def _canonical_parity():
    return _reconcile(
        _make_factory(equity=110_500.0, balance=110_500.0, deals=_canonical_deals())
    )


def _shift_in_fold(monkeypatch, match):
    """Move the ONE deal for which ``match(deal)`` is true by one UTC day, in the input of the
    fold, in BOTH namespaces: the soak's own ``_fold_mt5_deals`` and ``broker_dailies``' (which
    the combiner calls). That is the TODO's real failure: the combiner and the soak's fold share
    one wrong bucketing, so the published returns and the level roll agree with each other and
    only an independent per-day walk can see it (RESEARCH Pitfall 1)."""
    real = broker_dailies._fold_mt5_deals  # captured BEFORE either namespace is patched

    def wrapper(deals, server_utc_offset_s):
        moved = [dict(d) for d in deals]
        hits = [d for d in moved if match(d)]
        assert len(hits) == 1, "the shift must move exactly one deal"
        hits[0]["time"] = hits[0]["time"] + 86_400
        return real(moved, server_utc_offset_s)

    monkeypatch.setattr(_soak, "_fold_mt5_deals", wrapper)
    monkeypatch.setattr(broker_dailies, "_fold_mt5_deals", wrapper)


def _assert_returns_breach(parity, kind: str) -> None:
    assert parity["observation"] == "populated"
    # The LEVEL roll is untouched by a corrupted return series, which is exactly why it
    # cannot be the only fidelity check.
    assert parity["recon_level_ok"] is True
    assert parity["return_check_ok"] is False
    assert parity["recon_ok"] is False
    assert parity["parity_ok"] is False
    assert kind in {m["kind"] for m in parity["return_check"]["mismatches"]}


def test_a_dropped_day_pnl_in_the_published_returns_reddens_the_gate(monkeypatch):
    # 2025-06-05 books -200 on a 110_700 base. Zeroing its published return is "the day's
    # P&L was dropped from the series".
    def drop(returns):
        returns[pd.Timestamp("2025-06-05")] = 0.0
        return returns

    _publish_corrupted(monkeypatch, drop)
    parity = _canonical_parity()
    _assert_returns_breach(parity, "return_off_ledger")
    bad = [m for m in parity["return_check"]["mismatches"] if m["day"] == "2025-06-05"]
    assert bad and bad[0]["expected"] == pytest.approx(-200.0 / 110_700.0)


def test_a_nan_the_guards_cannot_explain_reddens_the_gate(monkeypatch):
    def nan_out(returns):
        returns[pd.Timestamp("2025-06-05")] = float("nan")
        return returns

    _publish_corrupted(monkeypatch, nan_out)
    _assert_returns_breach(_canonical_parity(), "checked_day_not_finite")


def test_a_small_perturbation_on_one_untimed_day_reddens_the_gate(monkeypatch):
    # The review's negative control: 1e-3 on one untimed day.
    def nudge(returns):
        returns[pd.Timestamp("2025-06-02")] += 1e-3
        return returns

    _publish_corrupted(monkeypatch, nudge)
    _assert_returns_breach(_canonical_parity(), "return_off_ledger")


def test_a_constant_garbage_return_series_no_longer_certifies_green(monkeypatch):
    # The review's reproduction: every value replaced by +700% a day was certified
    # recon_ok=True, recon_residual=0.0 by the identity-only gate.
    _publish_corrupted(monkeypatch, lambda returns: returns.mask(returns.notna(), 7.0))
    parity = _canonical_parity()
    _assert_returns_breach(parity, "return_off_ledger")
    assert parity["recon_residual"] == pytest.approx(0.0)  # levels alone said green


def test_a_corrupted_flat_day_reddens_the_gate(monkeypatch):
    def poison(returns):
        returns[pd.Timestamp("2025-06-03")] = 0.01  # no deal, no flow that day
        return returns

    _publish_corrupted(monkeypatch, poison)
    _assert_returns_breach(_canonical_parity(), "flat_day_not_zero")


# 226 review CR-02 / SFH-01 — the check must also see the days the combiner did NOT publish.
# The return loop walks only the published index, so a series truncated at either end certified
# 100% of what was left. Every ledger day is now named when absent, and a published day outside
# the ledger span (which gap_fill never produces) is refused. The canonical ledger's active days
# are 06-02 (+400), 06-04 (+10_300 incl. the deposit) and 06-05 (-200); 06-03 is gap-filled.
@pytest.mark.parametrize(
    ("keep", "dropped"),
    [
        (lambda r: r.iloc[:-1], {"2025-06-05"}),  # the walk's LAST active day
        (lambda r: r.iloc[1:], {"2025-06-02"}),  # the walk's FIRST active day
        (lambda r: r.iloc[:1], {"2025-06-04", "2025-06-05"}),  # two of three active days
    ],
    ids=["drops_last_day", "drops_first_day", "keeps_only_first_day"],
)
def test_a_truncated_published_series_is_named_and_not_green(monkeypatch, keep, dropped):
    _publish_corrupted(monkeypatch, keep)
    parity = _canonical_parity()
    # FIRST (ledger-day arm): everything the series DOES carry is honest, so the missing days are
    # the only reason this run is not green.
    assert parity["return_check_ok"] is False and parity["parity_ok"] is False
    assert parity["recon_level_ok"] is True  # the level roll reads the fold, not the series
    named = {
        m["day"] for m in parity["return_check"]["mismatches"] if m["kind"] == "ledger_day_not_published"
    }
    assert dropped <= named


@pytest.mark.parametrize(
    "extra_day", ["2025-06-01", "2025-06-06"], ids=["before_first_day", "after_last_day"]
)
def test_a_published_day_outside_the_ledger_span_is_refused(monkeypatch, extra_day):
    def extend(returns):
        extra = pd.Series([0.0], index=pd.DatetimeIndex([extra_day]).as_unit(returns.index.unit))
        return pd.concat([returns, extra]).sort_index()

    _publish_corrupted(monkeypatch, extend)
    parity = _canonical_parity()
    assert parity["return_check_ok"] is False and parity["parity_ok"] is False
    assert (extra_day, "published_day_outside_ledger") in _mismatch_pairs(parity)


def test_the_real_combiner_passes_and_every_excluded_day_is_counted():
    parity = _canonical_parity()
    check = parity["return_check"]
    assert parity["return_check_ok"] is True and parity["recon_ok"] is True
    # 06-02, 06-04, 06-05 are exact-checked; 06-03 is the gap-filled flat day.
    assert (check["checked"], check["flat"], check["timed"], check["guarded"]) == (3, 1, 0, 0)
    assert check["mismatch_count"] == 0 and check["max_abs_err"] < check["tolerance"]


def test_timed_days_are_counted_not_silently_dropped(monkeypatch):
    # In the timed ledger 10-17 is cohort-measured (excluded from the exact check, and said so)
    # and 10-16, a deposit with no trading deal, is flow-only (judged, counted apart); 10-18 is
    # exact-checked, and corrupting it still reddens.
    factory = _make_factory(
        equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
    )
    check = _reconcile(factory)["return_check"]
    assert (check["checked"], check["timed"], check["flow_only"]) == (1, 1, 1)

    _publish_corrupted(
        monkeypatch,
        lambda returns: returns.mask(returns.index == pd.Timestamp("2025-10-18"), 0.0),
    )
    parity = _reconcile(factory)
    assert parity["return_check_ok"] is False and parity["recon_ok"] is False


def test_a_run_that_excludes_every_day_is_vacuous_and_not_green():
    # A single timed flow day: nothing is exact-checked, so nothing about the returns was
    # certified. That must be said, not passed.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(16, 8)),
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 9, "profit": 0.0}, _ms(16, 10)
        ),
        _stamped_deal(
            {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 9, "profit": 100.0},
            _ms(16, 15),
        ),
    ]
    parity = _reconcile(_make_factory(equity=10_100.0, balance=10_100.0, deals=deals))
    assert parity["return_check"]["checked"] == 0
    assert parity["return_check"]["vacuous"] is True
    assert parity["recon_level_ok"] is True
    assert parity["recon_ok"] is False and parity["parity_ok"] is False


def test_guard_explained_nan_is_accepted_and_a_finite_value_there_is_not():
    # A 50-dollar base is under the $100 dust floor, so the DQ-01 guard breaks the day:
    # NaN is the CORRECT published value, and a finite one is the defect.
    kwargs = dict(
        pnl_by_day={"2025-06-02": 1.0, "2025-06-03": 2.0},
        flows_by_day={},
        timed_days=set(),
        initial=50.0,
    )
    idx = pd.DatetimeIndex(["2025-06-02", "2025-06-03"]).as_unit("us")
    nan_ok = _soak._reconcile_published_returns(
        pd.Series([float("nan"), float("nan")], index=idx), **kwargs
    )
    assert nan_ok["guarded"] == 2 and nan_ok["mismatch_count"] == 0
    finite = _soak._reconcile_published_returns(pd.Series([0.02, 0.03], index=idx), **kwargs)
    assert finite["mismatch_count"] == 2
    assert {m["kind"] for m in finite["mismatches"]} == {"guarded_day_not_nan"}


# ---------------------------------------------------------------------------
# SOAK-01 (Phase 226) — the soak judges an account on the floors of ITS unit.
#
# Until this phase every USD-denominated read in the soak (the combiner call, the inception
# read, the dust guard, the level tolerance, the wedge gate) used the USD row, so a BTC
# account read `vacuous`, its level check had a one-whole-BTC tolerance, and a 15% BTC wedge
# read within materiality. Each test below puts the verdict of ONE of those reads first, so a
# neuter of that read alone reddens that test on its own assertion (PROOF-01).
# ---------------------------------------------------------------------------
def test_a_btc_account_reconciles_green_on_its_own_floors():
    parity = _reconcile(
        _make_factory(equity=1.105, balance=1.105, deals=_btc_canonical_deals(), currency="BTC")
    )
    check = parity["return_check"]
    # FIRST (combiner-floors arm): on USD floors the combiner publishes NaN on every day of
    # a 1-BTC account, and every checked day then reads checked_day_not_finite.
    assert check["mismatch_count"] == 0, check["mismatches"]
    # SECOND (judging arm): the BTC dust floor is 1e-7, so all three active days are checked.
    assert check["checked"] == 3 and check["guarded"] == 0
    assert parity["parity_ok"] is True
    assert check["vacuous"] is False
    assert parity["account_unit"] == {"code": "BTC", "native": True}


@pytest.mark.parametrize(
    ("raw", "class_name", "unit_code"),
    [
        ("", "AccountCurrencyBlank", None),
        ("   ", "AccountCurrencyBlank", None),
        ("US$", "AccountCurrencyMalformed", None),
        ("EUR", "AccountCurrencyUnsupported", "EUR"),
    ],
)
def test_an_unresolved_account_currency_is_inconclusive(raw, class_name, unit_code):
    # A broker reporting garbage must never get its account judged on USD floors (or the
    # reverse): INCONCLUSIVE, typed, and never carrying the raw broker text.
    result = _reconcile(
        _make_factory(
            equity=110_500.0, balance=110_500.0, deals=_canonical_deals(), currency=raw
        )
    )
    assert result["observation"] == "unit_unresolved"
    assert result["parity_ok"] is None
    assert result["unit_error"] == class_name
    assert result.get("unit_code") == unit_code
    if raw == "US$":
        assert raw not in json.dumps(result)


def test_an_unresolved_account_currency_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(
        equity=110_500.0, balance=110_500.0, deals=_canonical_deals(), currency="EUR"
    )
    assert main([], client_factory=factory, utc_now=_UTC_NOW) == 1
    files = list(tmp_path.glob("mt5-soak-*.json"))
    assert len(files) == 1
    record = json.loads(files[0].read_text(encoding="utf-8"))
    assert record["parity"]["observation"] == "unit_unresolved"


def _deal(deal_type: int, profit: float, day: int, month: int = 6) -> dict:
    return {
        "type": deal_type, "profit": profit, "swap": 0.0, "commission": 0.0, "fee": 0.0,
        "time": _epoch(2025, month, day),
    }


def test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors():
    # ROADMAP SC1. A 150-BTC account: bases 150, 151 and 51.5. The first two clear the USD
    # dust floor (100), so USD judging has real checked days; 51.5 sits between BTC dust
    # (1e-7) and 100, so USD floors call 06-04 guarded (NaN accepted) while BTC floors call
    # it checked (NaN is a defect). The published series is correct except 06-04 = NaN.
    kwargs = dict(
        pnl_by_day={"2025-06-02": 1.0, "2025-06-03": 0.5, "2025-06-04": -0.3},
        flows_by_day={"2025-06-03": -100.0},
        timed_days=set(),
        initial=150.0,
    )
    idx = pd.DatetimeIndex(["2025-06-02", "2025-06-03", "2025-06-04"]).as_unit("us")
    series = pd.Series([1.0 / 150.0, 0.5 / 151.0, float("nan")], index=idx)

    # FIRST (guard-read arm): on the BTC row the NaN on 06-04 is a defect.
    btc = _soak._reconcile_published_returns(
        series, **kwargs, floors=classify_account_currency("BTC").floors
    )
    assert btc["ok"] is False
    assert ("2025-06-04", "checked_day_not_finite") in {
        (m["day"], m["kind"]) for m in btc["mismatches"]
    }
    usd = _soak._reconcile_published_returns(series, **kwargs, floors=USD_FLOORS)
    assert (usd["ok"], usd["checked"], usd["guarded"], usd["mismatch_count"]) == (True, 2, 1, 0)

    # End to end through reconcile_parity, with the combiner's published 06-04 set to NaN.
    deals = [
        _deal(_DEAL_TYPE_BUY, 1.0, 2),
        _deal(_DEAL_TYPE_BALANCE, -100.0, 3),
        _deal(_DEAL_TYPE_SELL, 0.5, 3),
        _deal(_DEAL_TYPE_SELL, -0.3, 4),
    ]

    def nan_out(returns):
        returns[pd.Timestamp("2025-06-04")] = float("nan")
        return returns

    with pytest.MonkeyPatch.context() as mp:
        _publish_corrupted(mp, nan_out)
        btc_parity = _reconcile(
            _make_factory(equity=51.2, balance=51.2, deals=deals, currency="BTC")
        )
        usd_parity = _reconcile(
            _make_factory(equity=51.2, balance=51.2, deals=deals, currency="USD")
        )
    assert btc_parity["parity_ok"] is False
    assert "checked_day_not_finite" in {
        m["kind"] for m in btc_parity["return_check"]["mismatches"]
    }
    assert usd_parity["parity_ok"] is True


def test_a_btc_first_day_is_judged_on_the_btc_residual_floor():
    # A 0.4 BTC base with a +1.0 deposit on its first day is a real checked day
    # (0.01 / 0.4 = 0.025). The USD residual floor of 1.0 would call the 0.4 base inception.
    deals = [
        _deal(_DEAL_TYPE_BALANCE, 1.0, 2),
        _deal(_DEAL_TYPE_SELL, 0.01, 2),
        _deal(_DEAL_TYPE_SELL, 0.005, 3),
    ]
    parity = _reconcile(
        _make_factory(equity=1.415, balance=1.415, deals=deals, currency="BTC")
    )
    check = parity["return_check"]
    assert check["guarded"] == 0 and check["checked"] == 2
    assert parity["parity_ok"] is True
    assert "guarded_day_not_nan" not in {m["kind"] for m in check["mismatches"]}


def test_the_btc_level_tolerance_is_in_btc_not_one_dollar(monkeypatch):
    # The soak's own fold read drops the 0.003 BTC SELL, so the rolled level lands 0.003
    # under the balance. On a one-whole-BTC tolerance that is certified; on the unit's own
    # tolerance max(1e-6, 1e-6 x |balance|) it is a level breach.
    real_fold = _soak._fold_mt5_deals

    def dropping_fold(deals, server_utc_offset_s):
        kept = [dict(d) for i, d in enumerate(deals) if i != 2]
        return real_fold(kept, server_utc_offset_s)

    monkeypatch.setattr(_soak, "_fold_mt5_deals", dropping_fold)
    parity = _reconcile(
        _make_factory(equity=1.105, balance=1.105, deals=_btc_canonical_deals(), currency="BTC")
    )
    assert parity["recon_level_ok"] is False
    assert parity["recon_tolerance"] == pytest.approx(1.105e-6)
    assert parity["recon_residual"] == pytest.approx(-0.003)


def test_a_material_btc_wedge_is_not_green():
    # Equity 1.3 against balance 1.105 is a 15% open-position wedge. The wedge gate reads
    # the unit's dust floor, not the USD 100, so a 1.3 BTC anchor is evaluated, not skipped.
    parity = _reconcile(
        _make_factory(equity=1.3, balance=1.105, deals=_btc_canonical_deals(), currency="BTC")
    )
    assert parity["wedge_within_materiality"] is False
    assert parity["recon_ok"] is True
    assert parity["parity_ok"] is False


def test_a_sub_dust_equity_over_a_large_balance_is_a_material_wedge():
    # 226 review SFH-02. A stop-out: the floating loss took equity from 110_500 to 0.50. The
    # realized ledger still reconstructs the balance exactly (recon_ok), and the wedge is -110_499.5.
    # The dust escape (|equity| <= dust: "cannot divide, so pass") read that as within materiality
    # and the run could exit 0. The wedge is now judged against ratio x max(|equity|, dust).
    parity = _reconcile(_make_factory(equity=0.5, balance=110_500.0, deals=_canonical_deals()))
    assert parity["observation"] == "populated"
    assert parity["recon_ok"] is True
    # FIRST (dust-escape arm).
    assert parity["wedge_within_materiality"] is False
    assert parity["parity_ok"] is False


def test_a_sub_dust_equity_over_a_large_balance_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=0.5, balance=110_500.0, deals=_canonical_deals())
    assert main([], client_factory=factory, utc_now=_UTC_NOW) != 0


@pytest.mark.parametrize(
    ("equity", "balance"),
    [
        (float("nan"), 110_500.0),
        (float("inf"), 110_500.0),
        (110_500.0, float("nan")),
        (110_500.0, float("-inf")),
    ],
    ids=["equity_nan", "equity_inf", "balance_nan", "balance_neg_inf"],
)
def test_a_non_finite_equity_or_balance_is_an_error_never_a_verdict(equity, balance):
    parity = _reconcile(_make_factory(equity=equity, balance=balance, deals=_canonical_deals()))
    # FIRST (finiteness arm): NaN compares False against every threshold, so a non-finite
    # reading used to fall through the wedge gate as "not material".
    assert parity["observation"] == "error"
    assert parity["parity_ok"] is None
    assert "not finite" in parity["error"]["message"]


def test_a_non_finite_equity_exits_nonzero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(equity=float("nan"), balance=110_500.0, deals=_canonical_deals())
    assert main([], client_factory=factory, utc_now=_UTC_NOW) != 0


# ---------------------------------------------------------------------------
# SOAK-03 (Phase 226) — day attribution is checked against the soak's OWN per-day walk.
#
# Until this phase the expected return used the fold's own per-day P&L, so a deal bucketed onto
# the wrong UTC day moved P_t and NAV_{t-1} together and every check stayed green (measured:
# parity_ok True on the scenario below). The walk re-buckets every raw deal by its own
# arithmetic and the two per-day maps are compared day by day. Each test puts the arm's own
# verdict FIRST, so a neuter of that arm alone reddens that test on its own assertion.
# ---------------------------------------------------------------------------
def _attribution_pairs(parity) -> set[tuple[str, str]]:
    return {(m["day"], m["kind"]) for m in parity["attribution_check"]["mismatches"]}


def test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution(monkeypatch):
    # ROADMAP SC3. The canonical SELL +300 sits on 06-04; the fold (and the combiner) put it
    # on 06-05. The walk says 06-04 = +300 and 06-05 = -200; the fold says 06-04 has no
    # trading deal and 06-05 = +100.
    _shift_in_fold(monkeypatch, lambda d: d["type"] == _DEAL_TYPE_SELL and d["profit"] == 300.0)
    parity = _canonical_parity()

    # FIRST (P&L attribution arm). return_off_ledger is expected too, so the kind is asserted
    # before any verdict: a neuter of this arm alone must redden THIS line.
    assert {
        ("2025-06-04", "day_attribution_mismatch"),
        ("2025-06-05", "day_attribution_mismatch"),
    } <= _attribution_pairs(parity), parity["attribution_check"]["mismatches"]
    by_day = {
        m["day"]: m
        for m in parity["attribution_check"]["mismatches"]
        if m["kind"] == "day_attribution_mismatch"
    }
    assert (by_day["2025-06-04"]["expected"], by_day["2025-06-04"]["actual"]) == (300.0, None)
    assert (by_day["2025-06-05"]["expected"], by_day["2025-06-05"]["actual"]) == (-200.0, 100.0)
    assert parity["attribution_ok"] is False
    assert parity["recon_ok"] is False
    assert parity["parity_ok"] is False


def test_a_flow_moved_one_utc_day_in_the_fold_reddens_flow_attribution(monkeypatch):
    # The +10_000 deposit sits on 06-04; the fold puts it on 06-05.
    _shift_in_fold(monkeypatch, lambda d: d["type"] == _DEAL_TYPE_BALANCE)
    parity = _canonical_parity()

    # FIRST (flow attribution arm).
    assert {
        ("2025-06-04", "flow_attribution_mismatch"),
        ("2025-06-05", "flow_attribution_mismatch"),
    } <= _attribution_pairs(parity), parity["attribution_check"]["mismatches"]
    assert parity["attribution_ok"] is False
    assert parity["parity_ok"] is False


def test_the_real_fold_and_the_walk_agree_day_by_day():
    parity = _canonical_parity()
    check = parity["attribution_check"]
    assert check["ok"] is True
    assert check["mismatch_count"] == 0
    # 06-02, 06-04 and 06-05 carry a deal; 06-03 is a gap day neither side books.
    assert check["days_compared"] == 3
    assert parity["attribution_ok"] is True

    timed = _reconcile(
        _make_factory(
            equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
        )
    )
    assert timed["attribution_ok"] is True


# ---------------------------------------------------------------------------
# SOAK-02 — the soak judges by ITS OWN timed-day set (RESEARCH OQ2).
#
# Until now the timed set was taken from the fold under test, so a production fold that
# silently degraded a resolvable flow day to the day-level rule was judged the same way and
# stayed green. The walk times the flow days itself from the raw instants and positions, and
# a day the two sets disagree on is a named mismatch in either direction. Only the soak's own
# ``_fold_mt5_deals`` is patched, so the combiner and the published series are untouched.
# ---------------------------------------------------------------------------
def _edit_fold_timing(monkeypatch, edit) -> None:
    real = _soak._fold_mt5_deals  # captured BEFORE the namespace is patched

    def wrapper(deals, server_utc_offset_s):
        pnl, flows, timing = real(deals, server_utc_offset_s)
        timing = dict(timing)
        edit(timing)
        return pnl, flows, timing

    monkeypatch.setattr(_soak, "_fold_mt5_deals", wrapper)


def test_a_flow_day_the_fold_failed_to_time_is_named(monkeypatch):
    def drop_1017(timing):
        (key,) = [ts for ts in timing if ts.date().isoformat() == "2025-10-17"]
        del timing[key]

    _edit_fold_timing(monkeypatch, drop_1017)
    parity = _reconcile(
        _make_factory(
            equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
        )
    )

    # FIRST (timed-set arm): the walk times 10-17 from its raw instants and the fold did not.
    assert ("2025-10-17", "timed_day_not_timed_by_fold") in _attribution_pairs(parity), parity[
        "attribution_check"
    ]["mismatches"]
    assert parity["attribution_ok"] is False
    assert parity["parity_ok"] is False


def test_a_day_the_fold_timed_and_the_walk_cannot_is_named(monkeypatch):
    def add_1018(timing):
        (key,) = [ts for ts in timing if ts.date().isoformat() == "2025-10-17"]
        timing[pd.Timestamp("2025-10-18").as_unit("us")] = timing[key]

    _edit_fold_timing(monkeypatch, add_1018)
    parity = _reconcile(
        _make_factory(
            equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
        )
    )

    # FIRST: 10-18 holds only a SELL and no flow, so the walk has nothing to time there and
    # cannot confirm the timing entry the fold claims for it.
    assert ("2025-10-18", "timed_day_unconfirmed") in _attribution_pairs(parity), parity[
        "attribution_check"
    ]["mismatches"]
    assert parity["attribution_ok"] is False
    assert parity["parity_ok"] is False


# ---------------------------------------------------------------------------
# SOAK-03 — the walk is INDEPENDENT of the code it judges, and that is a test that can fail.
#
# An oracle that calls the production helpers agrees with production by construction (Pitfall
# 12), and nothing but a rule keeps a later edit from re-introducing one. The AST check below
# is that rule: every module-level ``_walk_*`` def of the soak may reference only walk-owned
# names, builtins and stdlib modules. The test file MAY import production (the drift pin does).
# ---------------------------------------------------------------------------
_PRODUCTION_DENYLIST = frozenset(
    {
        "_fold_mt5_deals", "combine_mt5_deal_ledger", "classify_deal", "deal_cash_effect",
        "deal_utc_day", "deal_utc_instant_ms", "deal_position_id", "deal_entry_code",
        "_coerce_money", "_guard_denominator", "_judged_cohorts", "_timed_day_return",
        "chain_linked_twr", "reconstruct_nav_and_twr", "DayTiming", "PNL_DOM_RATIO",
        "DUST_NAV_FLOOR", "USD_FLOORS", "UnitFloors", "Mt5ServerClock", "fixed_server_clock",
        "is_tiny_base", "window_peaks",
    }
)
_WALK_OWNED_PREFIXES = ("_walk_", "_WALK_", "_Walk")


def _independence_violations(fn_node, forbidden, module_names) -> list[str]:
    """Names inside ``fn_node`` that a walk must not reference: anything in ``forbidden``
    (an import from ``services.*`` or a denylisted production helper), any other
    module-level soak name that is not itself walk-owned, and ANY import statement. A walk
    needs no import at all, and a function-local import defeats the name sets above because
    its alias is bound where those sets never look (226 review WR-02)."""
    found: list[str] = []
    for node in ast.walk(fn_node):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            found.append("import:" + (getattr(node, "module", None) or node.names[0].name))
            continue
        if isinstance(node, ast.Name):
            name = node.id
        elif isinstance(node, ast.Attribute):
            name = node.attr
        else:
            continue
        if name in forbidden:
            found.append(name)
        elif (
            isinstance(node, ast.Name)
            and name in module_names
            and not name.startswith(_WALK_OWNED_PREFIXES)
        ):
            found.append(name)
    return found


def _soak_module_tree() -> ast.Module:
    return ast.parse(Path(_soak.__file__).read_text(encoding="utf-8"))


def _soak_forbidden_and_module_names(tree: ast.Module) -> tuple[set[str], set[str]]:
    forbidden = set(_PRODUCTION_DENYLIST)
    module_names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("services"):
            forbidden.update(alias.asname or alias.name for alias in node.names)
        elif isinstance(node, ast.Import):
            forbidden.update(
                (alias.asname or alias.name).split(".")[0]
                for alias in node.names
                if alias.name.startswith("services")
            )
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            module_names.add(node.name)
        elif isinstance(node, ast.Assign):
            module_names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            module_names.add(node.target.id)
    return forbidden, module_names


def test_the_walk_imports_no_production_helper():
    tree = _soak_module_tree()
    forbidden, module_names = _soak_forbidden_and_module_names(tree)
    walk_defs = [
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name.startswith("_walk_")
    ]
    # A rename must not make this test vacuous: the minimum walk set is named here.
    assert {
        "_walk_money", "_walk_epoch", "_walk_utc_day", "_walk_deal_ledger",
        "_walk_attribution_check", "_walk_position_id", "_walk_entry_code",
        "_walk_instant_ms", "_walk_day_timing", "_walk_day_guard", "_walk_timed_return",
        "_walk_tiny_base_days",
    } <= {n.name for n in walk_defs}

    # FIRST: the verdict on the real walk. Names the offender so a failure is actionable.
    violations = {
        fn.name: _independence_violations(fn, forbidden, module_names) for fn in walk_defs
    }
    assert {name: bad for name, bad in violations.items() if bad} == {}

    # Self-test: the checker can fail. A walk calling a production helper, and a walk calling
    # a non-walk soak helper, are both flagged.
    fake = ast.parse("def _walk_fake(d):\n    return deal_utc_day(d, 0)\n").body[0]
    assert "deal_utc_day" in _independence_violations(fake, forbidden, module_names)
    fake2 = ast.parse("def _walk_fake2(d):\n    return _forward_nav_levels(d)\n").body[0]
    assert "_forward_nav_levels" in _independence_violations(fake2, forbidden, module_names)
    # 226 review WR-02: a function-local import binds its alias where the name sets never look.
    # Both shapes below returned [] before the import rule; each must now be named.
    local_from = ast.parse(
        "def _walk_x(p, t):\n"
        "    from services.nav_twr import _judged_cohorts as jc\n"
        "    return jc(p, t, inception=False)\n"
    ).body[0]
    assert "import:services.nav_twr" in _independence_violations(
        local_from, forbidden, module_names
    )
    local_module = ast.parse(
        "def _walk_x(p, t):\n"
        "    import services.tiny_base as tb\n"
        "    return tb.TINY_BASE_FRACTION\n"
    ).body[0]
    assert "import:services.tiny_base" in _independence_violations(
        local_module, forbidden, module_names
    )
    # Attribute access through a MODULE-LEVEL production alias is caught by the alias name.
    alias_tree = ast.parse(
        "import services.tiny_base as tb\n"
        "def _walk_x(p):\n"
        "    return tb.TINY_BASE_FRACTION\n"
    )
    alias_forbidden, alias_names = _soak_forbidden_and_module_names(alias_tree)
    assert "tb" in _independence_violations(alias_tree.body[1], alias_forbidden, alias_names)


def test_the_walk_type_sets_match_production():
    # The walk copies production's allow-lists on purpose. A production change (Phase 229
    # widening the flow types, say) must turn THIS red, forcing a conscious soak update.
    assert _soak._WALK_TRADING_TYPES == mt5_deals._MT5_TRADING_DEAL_TYPES
    assert _soak._WALK_FLOW_TYPES == mt5_deals._MT5_EXTERNAL_FLOW_DEAL_TYPES


# ---------------------------------------------------------------------------
# SOAK-02 — every instant and position shape the fuzz missed, hand-derived and cross-checked.
#
# Each shape is a 2025-10-17 flow day. For every one the walk's timed set and the production
# fold's must agree: the walk is a re-derivation, and the day is either timed on both sides
# or untimed on both. An untrusted instant leaves the day untimed (T-226-07), never a
# guessed instant, and a resolvable shape is timed.
# ---------------------------------------------------------------------------
_TIMED_DAY = "2025-10-17"


def _deposit(utc_ms: int | None = None) -> dict:
    return _stamped_deal(
        {"type": _DEAL_TYPE_BALANCE, "profit": 100_000.0}, _ms(17, 9) if utc_ms is None else utc_ms
    )


def _open_close(close_entry: int = 1, position_id: int = 7) -> list[dict]:
    """A BUY that opens position ``position_id`` at 10:00 and a SELL that closes it at 15:00."""
    return [
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": position_id, "profit": 0.0},
            _ms(17, 10),
        ),
        _stamped_deal(
            {
                "type": _DEAL_TYPE_SELL,
                "entry": close_entry,
                "position_id": position_id,
                "profit": 1_100.0,
            },
            _ms(17, 15),
        ),
    ]


def _with_msc(deal: dict, msc) -> dict:
    return {**deal, "time_msc": msc}


def _without_msc(deals: list[dict]) -> list[dict]:
    return [{k: v for k, v in d.items() if k != "time_msc"} for d in deals]


_UNTIMED_SHAPES = {
    "time_msc_off_by_one_second": lambda: [
        _with_msc(_deposit(), _ms(17, 9) + 1_000), *_open_close()
    ],
    "fractional_time_msc": lambda: [
        _with_msc(_deposit(), _ms(17, 9) + 0.5), *_open_close()
    ],
    "bool_time_msc": lambda: [_with_msc(_deposit(), True), *_open_close()],
    "buy_without_position_id": lambda: [
        _deposit(),
        _stamped_deal({"type": _DEAL_TYPE_BUY, "entry": 0, "profit": 5.0}, _ms(17, 10)),
    ],
    "every_in_deal_on_a_later_day": lambda: [
        _deposit(),
        _open_close()[1],
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 7, "profit": 0.0}, _ms(18, 10)
        ),
    ],
    "unknown_entry_code": lambda: [
        _deposit(),
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 7, "position_id": 7, "profit": 0.0}, _ms(17, 10)
        ),
    ],
    "commission_with_position_and_no_entry": lambda: [
        _deposit(),
        *_open_close(),
        _stamped_deal({"type": 7, "position_id": 7, "profit": -2.0}, _ms(17, 15)),
    ],
}

_TIMED_SHAPES = {
    "inout_close": lambda: [_deposit(), *_open_close(close_entry=2)],
    "out_by_close": lambda: [_deposit(), *_open_close(close_entry=3)],
    "commission_without_position": lambda: [
        _deposit(),
        *_open_close(),
        _stamped_deal({"type": 7, "profit": -2.0}, _ms(17, 12)),
    ],
    "commission_with_position_and_entry": lambda: [
        _deposit(),
        *_open_close(),
        _stamped_deal(
            {"type": 7, "entry": 1, "position_id": 7, "profit": -2.0}, _ms(17, 15)
        ),
    ],
    "time_msc_absent": lambda: _without_msc([_deposit(), *_open_close()]),
    "flow_at_exact_utc_midnight": lambda: [_deposit(_ms(17, 0)), *_open_close()],
}


def _timed_sets(deals: list[dict]) -> tuple[set[str], set[str]]:
    walk = set(_soak._walk_deal_ledger(deals, 0).timing)
    fold = {ts.date().isoformat() for ts in broker_dailies._fold_mt5_deals(deals, 0)[2]}
    return walk, fold


@pytest.mark.parametrize("shape", list(_UNTIMED_SHAPES))
def test_the_walk_degrades_an_untrusted_flow_day_to_untimed(shape):
    walk, fold = _timed_sets(_UNTIMED_SHAPES[shape]())
    # FIRST: the walk never guesses an instant for an untrusted day.
    assert _TIMED_DAY not in walk
    # And production degrades the same day, so the soak is not stricter than the fold.
    assert _TIMED_DAY not in fold


@pytest.mark.parametrize("shape", list(_TIMED_SHAPES))
def test_the_walk_times_known_entries_commissions_and_midnight_flows(shape):
    deals = _TIMED_SHAPES[shape]()
    walk, fold = _timed_sets(deals)
    assert _TIMED_DAY in walk
    assert _TIMED_DAY in fold
    if shape == "commission_with_position_and_entry":
        # A commission carrying a position opens when that position opened (10:00 the same
        # day), not at its own 15:00 instant.
        events = _soak._walk_deal_ledger(deals, 0).timing[_TIMED_DAY].pnl
        assert (_ms(17, 10), -2.0) in events
        assert (_ms(17, 15), -2.0) not in events


def test_the_walk_position_constants_match_production():
    # The walk copies production's position vocabulary on purpose. A deliberate production
    # change turns this red on purpose, forcing a conscious soak update.
    assert _soak._WALK_POSITION_TYPES == broker_dailies._MT5_POSITION_DEAL_TYPES
    assert _soak._WALK_ENTRY_IN == mt5_deals.MT5_DEAL_ENTRY_IN
    assert _soak._WALK_ENTRY_CODES == mt5_deals._MT5_KNOWN_DEAL_ENTRIES


def _walk_deal(deal_type, day_time, **fields) -> dict:
    return {"type": deal_type, "time": day_time, **fields}


def test_the_walk_sums_swap_fee_and_commission_family_cash():
    t = _epoch(2025, 6, 2)
    deals = [
        # 10.0 - 1.5 - 2.0 - 0.25 = 6.25
        _walk_deal(_DEAL_TYPE_BUY, t, profit=10.0, swap=-1.5, commission=-2.0, fee=-0.25),
        _walk_deal(7, t, profit=4.0),
        _walk_deal(8, t, swap=-0.5),
        _walk_deal(9, t, commission=-1.25),
        _walk_deal(10, t, fee=-0.75),
        _walk_deal(11, t, profit=2.0),
    ]
    # 6.25 + 4.0 - 0.5 - 1.25 - 0.75 + 2.0 = 9.75 (every term a dyadic fraction: exact).
    walk = _soak._walk_deal_ledger(deals, 0)
    assert walk.pnl_by_day == {"2025-06-02": 9.75}
    assert walk.total_trading_pnl == 9.75
    assert walk.flows_by_day == {} and walk.total_flows == 0.0
    # Cross-check against the fold the walk judges: same day, same number.
    fold_pnl = broker_dailies._fold_mt5_deals(deals, 0)[0]
    assert {ts.date().isoformat(): float(v) for ts, v in fold_pnl.items()} == {
        "2025-06-02": 9.75
    }


def test_the_walk_books_credit_and_bonus_as_flows():
    t = _epoch(2025, 6, 2)
    deals = [
        _walk_deal(3, t, profit=500.0),  # CREDIT
        _walk_deal(6, t, profit=50.0),  # BONUS
        _walk_deal(_DEAL_TYPE_BALANCE, t),  # no profit key: books nothing
        _walk_deal(_DEAL_TYPE_BALANCE, t, profit=None),  # None: books nothing
    ]
    walk = _soak._walk_deal_ledger(deals, 0)
    assert walk.flows_by_day == {"2025-06-02": 550.0}  # 500 + 50 + 0 + 0
    assert walk.pnl_by_day == {}
    assert walk.total_flows == 550.0
    assert walk.total_trading_pnl == 0.0


def _server_wall(year, month, day, hour=0, minute=0, second=0) -> int:
    # The broker's server clock is carried as if it were UTC: the epoch of the wall reading.
    return int(datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp())


def test_the_walk_buckets_on_the_fixed_server_offset():
    def day_of(server_epoch: int, offset_s: int) -> str:
        walk = _soak._walk_deal_ledger([_walk_deal(_DEAL_TYPE_BUY, server_epoch, profit=1.0)], offset_s)
        (day,) = walk.pnl_by_day
        return day

    # +5:30 server: wall 2025-06-02 03:00 is 2025-06-01 21:30 UTC.
    assert day_of(_server_wall(2025, 6, 2, 3), 19_800) == "2025-06-01"
    # -1h server (behind UTC): wall 2025-06-02 23:30 is 2025-06-03 00:30 UTC.
    assert day_of(_server_wall(2025, 6, 2, 23, 30), -3_600) == "2025-06-03"
    # Exactly server midnight at offset 0 opens the new day, not the old one.
    assert day_of(_server_wall(2025, 6, 3, 0, 0, 0), 0) == "2025-06-03"


def test_the_walk_reads_a_datetime_time():
    naive = datetime(2025, 6, 2, 23, 59, 59)  # no tzinfo: read as UTC
    aware = datetime(2025, 6, 3, 1, 0, tzinfo=timezone(timedelta(hours=2)))  # 2025-06-02 23:00Z
    walk = _soak._walk_deal_ledger(
        [
            _walk_deal(_DEAL_TYPE_BUY, naive, profit=1.0),
            _walk_deal(_DEAL_TYPE_BUY, aware, profit=2.0),
        ],
        0,
    )
    assert walk.pnl_by_day == {"2025-06-02": 3.0}


@pytest.mark.parametrize(
    ("deal", "field", "bad_text"),
    [
        (_walk_deal(_DEAL_TYPE_BUY, 1_748_865_600, profit=True), "profit", "True"),
        (_walk_deal(_DEAL_TYPE_BUY, 1_748_865_600, profit=float("nan")), "profit", "nan"),
        (_walk_deal(_DEAL_TYPE_BUY, 1_748_865_600, profit="abc"), "profit", "abc"),
        (_walk_deal(_DEAL_TYPE_BUY, True, profit=1.0), "time", "True"),
        (_walk_deal(_DEAL_TYPE_BUY, float("inf"), profit=1.0), "time", "inf"),
        (_walk_deal(True, 1_748_865_600, profit=1.0), "type", "True"),
        (_walk_deal(5, 1_748_865_600, profit=1.0), "type", "5"),
    ],
)
def test_the_walk_rejects_bad_fields_naming_the_field_only(deal, field, bad_text):
    with pytest.raises(ValueError) as excinfo:
        _soak._walk_deal_ledger([deal], 0)
    message = str(excinfo.value)
    assert field in message
    assert bad_text.lower() not in message.lower()


# ---------------------------------------------------------------------------
# SOAK-02 (Phase 226-04) — a timed day is recomputed by the soak's own D-17 cohort walk.
#
# Until this plan a timed day was rejected only for infinity, so 7.0, NaN or -0.99 on it read
# `recon_ok=True` ([164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED], closed by Phase 226). Every expected value below is
# HAND-DERIVED (never read back from the walk), so the walk is never compared with itself.
# ---------------------------------------------------------------------------
def _timed_factory():
    return _make_factory(
        equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
    )


def _mismatch_pairs(parity) -> set[tuple[str, str]]:
    return {(m["day"], m["kind"]) for m in parity["return_check"]["mismatches"]}


def test_a_small_nudge_on_a_timed_day_reddens_the_gate(monkeypatch):
    # Hand derivation of 2025-10-17's cohort return:
    #   - 10_000 sits in the account from 10-16;
    #   - 100_000 is deposited at 09:00;
    #   - the position opens at 10:00 and closes at 15:00 for +1_100;
    #   - cohort 0 is judged with base 10_000 and P&L 0.0, factor 1;
    #   - cohort 1 has base 110_000 and P&L 1_100, so 0.01.
    def nudge(returns):
        returns[pd.Timestamp("2025-10-17")] += 1e-3
        return returns

    _publish_corrupted(monkeypatch, nudge)
    parity = _reconcile(_timed_factory())

    # FIRST (cohort arm): the nudged timed day is named, with the soak's own expectation.
    assert ("2025-10-17", "timed_return_off_cohort_walk") in _mismatch_pairs(parity)
    hits = [
        m
        for m in parity["return_check"]["mismatches"]
        if (m["day"], m["kind"]) == ("2025-10-17", "timed_return_off_cohort_walk")
    ]
    assert hits[0]["expected"] == pytest.approx(0.01)
    assert hits[0]["actual"] == pytest.approx(0.011)
    _assert_returns_breach(parity, "timed_return_off_cohort_walk")


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        (float("nan"), "timed_day_not_finite"),
        (float("inf"), "timed_day_not_finite"),
        (7.0, "timed_return_off_cohort_walk"),
        (-0.99, "timed_return_off_cohort_walk"),
    ],
)
def test_an_implausible_or_missing_timed_return_reddens_the_gate(monkeypatch, value, kind):
    def corrupt(returns):
        returns[pd.Timestamp("2025-10-17")] = value
        return returns

    _publish_corrupted(monkeypatch, corrupt)
    parity = _reconcile(_timed_factory())

    # FIRST: the exact (day, kind) pair for this shape.
    assert ("2025-10-17", kind) in _mismatch_pairs(parity)
    _assert_returns_breach(parity, kind)


def test_a_timed_day_the_walk_reads_as_nan_must_be_published_nan(monkeypatch):
    # 2025-10-16 is a deposit-only inception day: the walk judges no cohort, so NaN is the
    # only honest published value. A finite 0.0 there is the defect.
    def corrupt(returns):
        returns[pd.Timestamp("2025-10-16")] = 0.0
        return returns

    _publish_corrupted(monkeypatch, corrupt)
    parity = _reconcile(_timed_factory())

    # FIRST (NaN-explained arm).
    assert ("2025-10-16", "timed_day_not_nan") in _mismatch_pairs(parity)
    assert parity["parity_ok"] is False


def test_the_real_combiner_timed_days_are_verified_against_the_walk():
    parity = _reconcile(_timed_factory())
    check = parity["return_check"]
    # 10-16 (a deposit-only inception day: walk NaN, the combiner publishes NaN) is flow-only and
    # certifies no return; 10-17 is verified against the walk; 10-18 is an exact-checked untimed day.
    assert (check["timed"], check["timed_verified"], check["checked"], check["flow_only"]) == (
        1, 1, 1, 1,
    )
    assert check["mismatch_count"] == 0
    assert parity["parity_ok"] is True


def _cohort_trade(position_id: int, open_hh: int, close_hh: int, cash: float) -> list[dict]:
    """A BUY opening ``position_id`` at ``open_hh`` and a SELL closing it at ``close_hh`` for
    ``cash``, both on 2025-10-17."""
    return [
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": position_id, "profit": 0.0},
            _ms(17, open_hh),
        ),
        _stamped_deal(
            {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": position_id, "profit": cash},
            _ms(17, close_hh),
        ),
    ]


def _cohort_flow(amount: float, hh: int, mm: int = 0) -> dict:
    return _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": amount}, _ms(17, hh, mm))


_USD_DUST = USD_FLOORS.dust_nav
_BTC_DUST = classify_account_currency("BTC").floors.dust_nav

# (deals, prev, dust_nav, expected return or None for NaN, expected reason)
_COHORT_CASES = {
    # prev 10_000, deposit 100_000 at 09:00, open 10:00, close 15:00 +1_100. Cohort 0 is
    # (10_000, 0) with factor 1; cohort 1 is (110_000, 1_100): 1_100 / 110_000 = 0.01.
    "deposit_before_open": (
        lambda: [_cohort_flow(100_000.0, 9), *_cohort_trade(7, 10, 15, 1_100.0)],
        10_000.0, _USD_DUST, 0.01, None,
    ),
    # prev 10_000, open 10:00, deposit 100_000 at 11:00, close 15:00 +1_100. The position
    # opened before the deposit, so cohort 0 is (10_000, 1_100): 1_100 / 10_000 = 0.11. The
    # deposit's own cohort holds no P&L and is skipped.
    "deposit_after_open": (
        lambda: [*_cohort_trade(7, 10, 15, 1_100.0)[:1], _cohort_flow(100_000.0, 11),
                 *_cohort_trade(7, 10, 15, 1_100.0)[1:]],
        10_000.0, _USD_DUST, 0.11, None,
    ),
    # prev 100_000, withdrawal -50_000 at 09:00, open 10:00, close +500. Cohort 0 is
    # (100_000, 0), factor 1; cohort 1 is (50_000, 500): 500 / 50_000 = 0.01.
    "withdrawal": (
        lambda: [_cohort_flow(-50_000.0, 9), *_cohort_trade(7, 10, 15, 500.0)],
        100_000.0, _USD_DUST, 0.01, None,
    ),
    # Position 5 opened on 10-16 (carried overnight), 1_000 deposited at 09:00 on 10-17, the
    # position closes at 15:00 for +1_000, prev 50_000. The open is None, so the P&L is cohort
    # 0's: (50_000, 1_000) = 0.02. Cohort 1 holds no P&L.
    "overnight_position": (
        lambda: [
            _stamped_deal(
                {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 5, "profit": 0.0},
                int(datetime(2025, 10, 16, 20, tzinfo=timezone.utc).timestamp()) * 1000,
            ),
            _cohort_flow(1_000.0, 9),
            _stamped_deal(
                {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 5, "profit": 1_000.0},
                _ms(17, 15),
            ),
        ],
        50_000.0, _USD_DUST, 0.02, None,
    ),
    # +1_000 and +2_000 both at 10:00, open at 10:00 (a flow AT the open counts first), close
    # +300, prev 7_000. Cohort 0 is (7_000, 0), cohort 1 is skipped, cohort 2 is
    # (7_000 + 1_000 + 2_000 = 10_000, 300): 300 / 10_000 = 0.03.
    "two_flows_at_the_open_instant": (
        lambda: [_cohort_flow(1_000.0, 10), _cohort_flow(2_000.0, 10),
                 *_cohort_trade(7, 10, 15, 300.0)],
        7_000.0, _USD_DUST, 0.03, None,
    ),
    # A 0.0 flow at 09:00 and +1_000 at 11:00, open 10:00, close +90, prev 9_000. The zero flow
    # is dropped, so cohort 0 is (9_000, 90): 90 / 9_000 = 0.01.
    "zero_amount_flow": (
        lambda: [_cohort_flow(0.0, 9), _cohort_trade(7, 10, 15, 90.0)[0],
                 _cohort_flow(1_000.0, 11), _cohort_trade(7, 10, 15, 90.0)[1]],
        9_000.0, _USD_DUST, 0.01, None,
    ),
    # BTC: prev 0.5, deposit 1.0 at 09:00, open 10:00, close +0.015, dust 1e-7. Cohort 0 is
    # (0.5, 0), cohort 1 is (1.5, 0.015): 0.015 / 1.5 = 0.01. On the USD dust floor (100) the
    # 0.5 base is dust, so the same day is NaN (checked in the test body).
    "btc_cohort": (
        lambda: [_cohort_flow(1.0, 9), *_cohort_trade(7, 10, 15, 0.015)],
        0.5, _BTC_DUST, 0.01, None,
    ),
    # USD dust: prev 50, deposit 1_000 at 09:00, open 10:00, close +10. Cohort 0 is (50, 0),
    # and 50 is under the 100 dust floor: NaN.
    "usd_dust_cohort": (
        lambda: [_cohort_flow(1_000.0, 9), *_cohort_trade(7, 10, 15, 10.0)],
        50.0, _USD_DUST, None, "base_guard",
    ),
    # prev 1_000, open 08:00, deposit 100 at 09:00, close +10_000. The position opened before
    # the deposit, so cohort 0 is (1_000, 10_000): |10_000| >= 10 * 1_000, P&L dominated: NaN.
    "pnl_dominated_cohort": (
        lambda: [_cohort_trade(7, 8, 15, 10_000.0)[0], _cohort_flow(100.0, 9),
                 _cohort_trade(7, 8, 15, 10_000.0)[1]],
        1_000.0, _USD_DUST, None, "pnl_dominated",
    ),
    # D-17 TELESCOPING (226 review WR-01). prev 10_000; position 7 runs 08:00-10:00 for +1_000;
    # 11_000 is deposited at 11:00; position 8 runs 12:00-15:00 for +2_200. Cohort 0 is
    # (10_000, 1_000): 1.10. The base then carries cohort 0's P&L: 10_000 + 1_000 + 11_000 =
    # 22_000, so cohort 1 is (22_000, 2_200): 1.10. (1.10)(1.10) - 1 = 0.21. A base that dropped
    # the earlier cohort's P&L (21_000) would read 1.10 * (1 + 2_200 / 21_000) - 1 = 0.2152.
    "telescoping_base": (
        lambda: [*_cohort_trade(7, 8, 10, 1_000.0), _cohort_flow(11_000.0, 11),
                 *_cohort_trade(8, 12, 15, 2_200.0)],
        10_000.0, _USD_DUST, 0.21, None,
    ),
}


@pytest.mark.parametrize("case", list(_COHORT_CASES))
def test_the_cohort_walk_matches_hand_derived_returns(case):
    build, prev, dust_nav, expected, reason = _COHORT_CASES[case]
    timing = _soak._walk_deal_ledger(build(), 0).timing["2025-10-17"]
    value, got_reason = _soak._walk_timed_return(
        prev, timing, dust_nav=dust_nav, inception=False
    )
    if expected is None:
        assert math.isnan(value)
        assert got_reason == reason
    else:
        assert value == pytest.approx(expected, abs=1e-12)
        assert got_reason is None
    if case == "btc_cohort":
        # The same BTC-sized day is dust on the USD floor: the unit decides the verdict.
        usd_value, usd_reason = _soak._walk_timed_return(
            prev, timing, dust_nav=_USD_DUST, inception=False
        )
        assert math.isnan(usd_value) and usd_reason == "base_guard"


def test_an_inception_day_skips_its_empty_cohort_zero():
    # 226 review WR-01. An inception day (base 0, +10_000 deposited at 09:00, a position 10:00 to
    # 15:00 for +100) is the most common first day of a new account. Cohort 0 holds no P&L and
    # sits on a zero base, so it must be SKIPPED, not judged: cohort 1 is (10_000, 100) = 0.01.
    # Judging cohort 0 would read a zero base and return NaN with ``base_guard``.
    deals = [_cohort_flow(10_000.0, 9), *_cohort_trade(7, 10, 15, 100.0)]
    timing = _soak._walk_deal_ledger(deals, 0).timing["2025-10-17"]
    value, reason = _soak._walk_timed_return(0.0, timing, dust_nav=_USD_DUST, inception=True)
    assert value == pytest.approx(0.01, abs=1e-12)
    assert reason is None
    # The same day off the inception reading is judged on the zero base: the flag decides.
    off_value, off_reason = _soak._walk_timed_return(
        0.0, timing, dust_nav=_USD_DUST, inception=False
    )
    assert math.isnan(off_value) and off_reason == "base_guard"


def test_the_walk_pnl_dominance_ratio_matches_production():
    # The walk copies production's P&L-dominance ratio on purpose. Phase 229 changing a guard
    # turns this red on purpose, forcing a conscious soak update.
    assert _soak._WALK_PNL_DOM_RATIO == nav_twr.PNL_DOM_RATIO


# ---------------------------------------------------------------------------
# SOAK-02 (Phase 226-05) — a run that certified under half of its certifiable days is not green.
#
# `ok` used to need only "no mismatch and checked > 0", so ONE exact-checked day among two
# hundred guarded days read green ([164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED], last clause; closed by Phase 226). The
# floor is `_MIN_CHECKED_SHARE`; every share below is hand-counted from the day classes.
# ---------------------------------------------------------------------------
def _published_for(initial, pnl_by_day, flows_by_day, nan_days):
    """The series an honest combiner publishes for a hand-built ledger: NaN on ``nan_days`` and
    P_t / NAV_{t-1} elsewhere, with NAV_{t-1} rolled here in the test (never read from the soak)."""
    days = sorted(set(pnl_by_day) | set(flows_by_day))
    nav = initial
    values = []
    for day in days:
        values.append(float("nan") if day in nan_days else pnl_by_day.get(day, 0.0) / nav)
        nav += pnl_by_day.get(day, 0.0) + flows_by_day.get(day, 0.0)
    index = pd.DatetimeIndex(days).as_unit("us")
    return pd.Series(values, index=index)


def _direct_reconcile(initial, pnl_by_day, flows_by_day, nan_days, returns=None):
    published = (
        returns
        if returns is not None
        else _published_for(initial, pnl_by_day, flows_by_day, nan_days)
    )
    return _soak._reconcile_published_returns(
        published,
        pnl_by_day=pnl_by_day,
        flows_by_day=flows_by_day,
        timed_days=set(),
        initial=initial,
    )


def test_a_run_certifying_under_half_its_days_is_not_green():
    # USD ledger, initial 50.0, every date before the 2025-06-06 clock:
    #   05-29, 05-30, 05-31: SELL +1.0 on bases 50, 51, 52 (under the $100 dust floor): guarded;
    #   06-01: BALANCE +1_000 on base 53, a deposit-only day the walk times, cohort 0 is
    #          (53, 0.0) on a dust base, so NaN: flow-only, judged but outside the share;
    #   06-02: SELL +5.0 on base 1_053: checked.
    # certified = 1 checked + 0 timed_verified; denominator = 1 + 0 timed + 3 guarded = 4.
    deals = [
        _deal(_DEAL_TYPE_SELL, 1.0, 29, month=5),
        _deal(_DEAL_TYPE_SELL, 1.0, 30, month=5),
        _deal(_DEAL_TYPE_SELL, 1.0, 31, month=5),
        _deal(_DEAL_TYPE_BALANCE, 1_000.0, 1),
        _deal(_DEAL_TYPE_SELL, 5.0, 2),
    ]
    parity = _reconcile(_make_factory(equity=1_058.0, balance=1_058.0, deals=deals))
    check = parity["return_check"]
    # FIRST (share arm): nothing is wrong with a single day, so the share is the only reason
    # this run is not green.
    assert check["ok"] is False and check["mismatch_count"] == 0 and check["vacuous"] is False
    assert check["certified_share"] == pytest.approx(0.25)
    assert (
        check["checked"], check["guarded"], check["timed"], check["timed_verified"],
        check["flow_only"],
    ) == (1, 3, 0, 0, 1)
    assert check["min_certified_share"] == 0.5
    assert parity["parity_ok"] is False


def test_one_checked_day_among_two_hundred_is_not_green():
    # 199 days of +0.01 on a ~$50 base (dust, guarded), a +1_000 flow-only day on the same dust
    # base (judged, outside the share), then +10.0 on a ~$1_052 base (checked). Bases are rolled
    # by the helper.
    start = datetime(2025, 1, 1)
    days = [(start + timedelta(days=i)).date().isoformat() for i in range(201)]
    pnl = {d: 0.01 for d in days[:199]}
    flows = {days[199]: 1_000.0}
    pnl[days[200]] = 10.0
    result = _direct_reconcile(50.0, pnl, flows, nan_days=set(days[:200]))
    # FIRST (share arm).
    assert result["ok"] is False and result["mismatch_count"] == 0
    assert result["vacuous"] is False
    assert result["certified_share"] == pytest.approx(1 / 200)
    assert (result["checked"], result["guarded"], result["flow_only"]) == (1, 199, 1)


def test_the_checked_share_boundary():
    # (a) day 1: +0.01 and a +1_000 flow on base 50 (a trading day on a dust base, guarded); day 2:
    # +10 on base 1_050.01 (checked): 1 of 2. Day 1 carries a trading deal because a flow-only day
    # is outside the share (226 review CR-01) and would leave 1 of 1.
    a_flows = {"2025-06-01": 1_000.0}
    a_pnl = {"2025-06-01": 0.01, "2025-06-02": 10.0}
    a = _direct_reconcile(50.0, a_pnl, a_flows, nan_days={"2025-06-01"})
    assert a["mismatch_count"] == 0
    assert a["certified_share"] == pytest.approx(0.5) and a["ok"] is True

    # (b) days 1-2: +0.01 on a dust base (guarded); day 3: +0.01 and a +1_000 flow on a dust base
    # (guarded, a trading day for the same reason as (a)); days 4-5: +10 on bases 1_050.03 and
    # 1_060.03 (checked): 2 of 5.
    b_pnl = {
        "2025-06-01": 0.01, "2025-06-02": 0.01, "2025-06-03": 0.01,
        "2025-06-04": 10.0, "2025-06-05": 10.0,
    }
    b_flows = {"2025-06-03": 1_000.0}
    b = _direct_reconcile(
        50.0, b_pnl, b_flows, nan_days={"2025-06-01", "2025-06-02", "2025-06-03"}
    )
    assert b["ok"] is False and b["mismatch_count"] == 0
    assert b["certified_share"] == pytest.approx(0.4)
    assert (b["checked"], b["guarded"]) == (2, 3)

    # (c) one flat day, absent from both dicts: nothing could be certified.
    idx = pd.DatetimeIndex(["2025-06-02"]).as_unit("us")
    c = _direct_reconcile(100.0, {}, {}, nan_days=set(), returns=pd.Series([0.0], index=idx))
    assert c["certified_share"] is None
    assert c["vacuous"] is True and c["ok"] is False


# ---------------------------------------------------------------------------
# 226 review CR-01 — a day with NO trading deal certifies nothing about trading returns.
#
# A deposit or withdrawal day has P_t = 0, so its expected return is 0.0 whatever the combiner
# does with the day's trading P&L. Counting it as `checked` / `timed_verified` let one guarded
# trading day followed by four +100 deposits read 0.8 certified and exit 0 with zero trading
# returns compared. Flow-only days are still JUDGED (their published return must still match),
# but they are counted in their own class, `flow_only`, outside the share and outside `vacuous`.
# ---------------------------------------------------------------------------
def _guarded_trade_then_four_deposits_deals() -> list[dict]:
    """Base 10_000; 10-14 books +200_000 (P&L-dominated: 200_000 >= 10 x 10_000, guarded);
    then four +100 deposit-only days 10-15..10-18. 10-15..10-17 carry an exact ``time_msc``
    (timed); 10-18's is five seconds off its ``time`` (untimed). Balance 210_400."""
    deals = [_stamped_deal({"type": _DEAL_TYPE_BUY, "profit": 200_000.0}, _ms(14, 10))]
    for day in (15, 16, 17):
        deals.append(_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100.0}, _ms(day, 9)))
    untimed = _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100.0}, _ms(18, 9))
    deals.append(_with_msc(untimed, untimed["time_msc"] + 5_000))
    return deals


def _guarded_trade_then_four_deposits_factory():
    return _make_factory(
        equity=210_400.0, balance=210_400.0, deals=_guarded_trade_then_four_deposits_deals()
    )


def test_deposit_only_days_do_not_certify_a_run_with_no_checked_trading_day():
    parity = _reconcile(_guarded_trade_then_four_deposits_factory())
    check = parity["return_check"]
    # FIRST (flow-only class arm): the one trading day was guarded, so no trading return was
    # compared at all, and the four honest deposit days must not stand in for one.
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["vacuous"] is True and check["ok"] is False
    assert parity["recon_level_ok"] is True
    assert parity["parity_ok"] is False
    # The deposit days are judged and counted in their own class; none is certified or timed.
    assert check["guarded"] == 1
    assert check["certified_share"] == pytest.approx(0.0)
    assert (check["flow_only"], check["checked"], check["timed"], check["timed_verified"]) == (
        4, 0, 0, 0,
    )


def test_deposit_only_days_cannot_exit_zero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    rc = main(
        [], client_factory=_guarded_trade_then_four_deposits_factory(), utc_now=_UTC_NOW
    )
    assert rc != 0


def test_timed_deposit_days_cannot_lift_a_one_in_six_run_to_the_share_floor():
    # The review's milder variant. Base 50 (under the $100 dust floor): 10-01..10-05 SELL +1
    # (five trading days, guarded); 10-06 deposit +10_000 (flow-only, on a dust base: NaN);
    # 10-07 SELL +10 on base 10_055 (the one checked trading day); 10-08..10-12 timed +1 deposits
    # (flow-only, 0.0 each, honest). One of six trading days is certified. Counting the six
    # flow-only days gave (1 + 5) / (1 + 6 + 5) = 0.5, exactly the floor, and green.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 1.0}, _ms(day, 10)) for day in range(1, 6)
    ]
    deals.append(_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(6, 9)))
    deals.append(_stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 10.0}, _ms(7, 10)))
    deals += [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 1.0}, _ms(day, 9))
        for day in range(8, 13)
    ]
    parity = _reconcile(_make_factory(equity=10_070.0, balance=10_070.0, deals=deals))
    check = parity["return_check"]
    # FIRST (timed-verified arm): the series is honest and one trading day in six is certified.
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["ok"] is False and parity["parity_ok"] is False
    assert check["certified_share"] == pytest.approx(1 / 6)
    assert (check["checked"], check["guarded"], check["timed"], check["timed_verified"]) == (
        1, 5, 0, 0,
    )
    assert check["flow_only"] == 6


@pytest.mark.parametrize(
    ("day", "kind"),
    [("2025-10-18", "return_off_ledger"), ("2025-10-15", "timed_return_off_cohort_walk")],
)
def test_a_deposit_only_day_is_still_judged_even_though_it_is_not_certified(
    monkeypatch, day, kind
):
    # 10-18 is the untimed deposit day, 10-15 a timed one: a nonzero published return on a day
    # whose only activity is a flow is a booked-flow-as-return defect on either branch.
    def poison(returns):
        returns[pd.Timestamp(day)] = 0.01
        return returns

    _publish_corrupted(monkeypatch, poison)
    parity = _reconcile(_guarded_trade_then_four_deposits_factory())
    assert (day, kind) in _mismatch_pairs(parity)
    assert parity["return_check"]["flow_only"] == 4
    assert parity["parity_ok"] is False


# ---------------------------------------------------------------------------
# 226 review CR-03 — a trading day whose P&L can test NO base certifies nothing either.
#
# CR-01 stopped a day with no trading deal from certifying. A zero-cash OPEN is a trading deal
# (BUY, entry IN, profit 0, commission 0; every opening on a spread-only account has this shape),
# yet its P_t is 0.0, so the check reads `0.0 / base == 0.0` whatever NAV_{t-1} is and never
# tests the base. Counting it as `checked` let one P&L-dominated (guarded) day followed by one
# open-only day read 0.5 certified, `vacuous` False and exit 0 with no trading return compared.
# Such a day is still JUDGED, and is counted in `flow_only` (the class now means "a day whose
# trading P&L tests no base"), outside the share and outside `vacuous`.
# On a timed day the test is per COHORT: `+x` and `-x` inside one cohort test no base, while a
# zero day-sum split across two cohorts tests both cohort bases.
# ---------------------------------------------------------------------------
def _open_only(position_id: int, day: int) -> dict:
    """A BUY that opens ``position_id`` on 10-``day`` at 10:00 for zero cash (an opening)."""
    return _stamped_deal(
        {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": position_id, "profit": 0.0},
        _ms(day, 10),
    )


def _guarded_then_open_only_deals() -> list[dict]:
    """The review's row 1. 10-01 deposit +10_000 (flow-only); 10-02 SELL +150_000 on a 10_000
    base (P&L-dominated: 150_000 >= 10 x 10_000, guarded); 10-03 one zero-cash open (no P&L).
    Balance 160_000. Every nonzero-P&L day was guarded, so no trading return is compared."""
    return [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 150_000.0}, _ms(2, 10)),
        _open_only(63, 3),
    ]


def _dust_guarded_deposit_then_open_only_deals(n_guard: int, n_open: int) -> list[dict]:
    """The review's rows 2-4. Base 50 (under the $100 dust floor): ``n_guard`` SELL +1 days
    (guarded); a +10_000 deposit-only day; then ``n_open`` open-only days on a 10_000+ base.
    Balance 50 + n_guard + 10_000."""
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 1.0}, _ms(day, 10))
        for day in range(1, 1 + n_guard)
    ]
    deals.append(
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1 + n_guard, 9))
    )
    deals += [_open_only(40 + day, day) for day in range(2 + n_guard, 2 + n_guard + n_open)]
    return deals


def test_a_zero_cash_open_day_does_not_certify_a_run_with_no_checked_trading_day():
    parity = _reconcile(
        _make_factory(equity=160_000.0, balance=160_000.0, deals=_guarded_then_open_only_deals())
    )
    check = parity["return_check"]
    # FIRST (untimed arm): the honest series passes every compare, and the run is still not
    # green, because the only day with nonzero P&L was guarded and the open-only day tests no base.
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["vacuous"] is True and check["ok"] is False
    assert parity["recon_level_ok"] is True
    assert parity["parity_ok"] is False
    assert check["guarded"] == 1
    assert (check["checked"], check["timed"], check["timed_verified"], check["flow_only"]) == (
        0, 0, 0, 2,
    )
    assert check["certified_share"] == pytest.approx(0.0)


def test_a_zero_cash_open_day_cannot_exit_zero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    factory = _make_factory(
        equity=160_000.0, balance=160_000.0, deals=_guarded_then_open_only_deals()
    )
    assert main([], client_factory=factory, utc_now=_UTC_NOW) != 0


@pytest.mark.parametrize("n_guard, n_open", [(1, 1), (3, 3), (5, 5)])
def test_open_only_days_cannot_stand_in_for_a_guarded_runs_trading_days(n_guard, n_open):
    balance = 50.0 + n_guard + 10_000.0
    deals = _dust_guarded_deposit_then_open_only_deals(n_guard, n_open)
    parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["vacuous"] is True and check["ok"] is False
    assert parity["parity_ok"] is False
    assert (check["checked"], check["guarded"], check["flow_only"]) == (0, n_guard, 1 + n_open)


def test_open_only_days_cannot_lift_a_one_in_six_run_to_the_share_floor():
    # Base 50: 10-01..10-05 SELL +1 (guarded); 10-06 deposit +10_000 (flow-only); 10-07 SELL +10 on
    # base 10_055 (the one checked day); 10-08..10-12 one zero-cash open each. One trading day in
    # six tests a base. Counting the five open-only days gave (1 + 5) / (6 + 5) = 0.545, green.
    deals = _dust_guarded_deposit_then_open_only_deals(5, 0)
    deals.append(_stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 10.0}, _ms(7, 10)))
    deals += [_open_only(80 + day, day) for day in range(8, 13)]
    parity = _reconcile(_make_factory(equity=10_065.0, balance=10_065.0, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["checked"], check["guarded"], check["flow_only"]) == (1, 5, 6)
    assert check["certified_share"] == pytest.approx(1 / 6)
    assert check["ok"] is False and parity["parity_ok"] is False


def test_a_timed_day_with_a_deposit_and_a_zero_cash_open_is_not_certified():
    # Base 50: 10-01 and 10-02 SELL +1 (guarded); 10-03 deposit +10_000 (flow-only, dust base);
    # 10-04 SELL +10 (checked); 10-05 a timed day: a +100 deposit at 09:00 and a zero-cash open at
    # 10:00, on a healthy base. Its cohorts hold no P&L, so it tests no base. Counting it as
    # `timed_verified` gave (1 + 1) / (1 + 1 + 2) = 0.5, exactly the floor, and green.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 1.0}, _ms(day, 10)) for day in (1, 2)
    ]
    deals.append(_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(3, 9)))
    deals.append(_stamped_deal({"type": _DEAL_TYPE_SELL, "profit": 10.0}, _ms(4, 10)))
    deals.append(_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100.0}, _ms(5, 9)))
    deals.append(_open_only(90, 5))
    parity = _reconcile(_make_factory(equity=10_162.0, balance=10_162.0, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["checked"], check["guarded"], check["timed"], check["timed_verified"]) == (
        1, 2, 0, 0,
    )
    assert check["flow_only"] == 2
    assert check["certified_share"] == pytest.approx(1 / 3)
    assert check["ok"] is False and parity["parity_ok"] is False


def _two_trade_timed_day(
    *,
    deposit_hh: int,
    first: tuple[int, int, float],
    second: tuple[int, int, float],
) -> list[dict]:
    """10-01 deposit +10_000 at 09:00, then on 10-02 a deposit +10_000 at ``deposit_hh`` and two
    positions, each ``(open_hh, close_hh, cash)``. The two cash amounts cancel: balance 20_000."""
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(2, deposit_hh)),
    ]
    for position_id, (open_hh, close_hh, cash) in ((11, first), (12, second)):
        deals.append(
            _stamped_deal(
                {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": position_id, "profit": 0.0},
                _ms(2, open_hh),
            )
        )
        deals.append(
            _stamped_deal(
                {
                    "type": _DEAL_TYPE_SELL,
                    "entry": 1,
                    "position_id": position_id,
                    "profit": cash,
                },
                _ms(2, close_hh),
            )
        )
    return deals


def test_plus_x_and_minus_x_inside_one_cohort_test_no_base():
    # Deposit 09:00, then both positions open after it (10:00 and 11:00): one cohort, P&L
    # +500 - 500 = 0. A zero-sum cohort tests no base, so the day certifies nothing.
    deals = _two_trade_timed_day(deposit_hh=9, first=(10, 13, 500.0), second=(11, 14, -500.0))
    check = _reconcile(_make_factory(equity=20_000.0, balance=20_000.0, deals=deals))[
        "return_check"
    ]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["timed"], check["timed_verified"], check["flow_only"]) == (0, 0, 2)


def test_plus_x_and_minus_x_across_two_cohorts_test_both_bases():
    # Position A opens 10:00, before the 11:00 deposit (cohort 0, +500); position B opens 12:00,
    # after it (cohort 1, -500). The day sums to zero, yet each cohort's P&L is measured against
    # its own base, so the day IS certified. This is the control that keeps the per-cohort test
    # from being replaced by a day-sum test.
    deals = _two_trade_timed_day(deposit_hh=11, first=(10, 13, 500.0), second=(12, 14, -500.0))
    check = _reconcile(_make_factory(equity=20_000.0, balance=20_000.0, deals=deals))[
        "return_check"
    ]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["timed"], check["timed_verified"], check["flow_only"]) == (1, 1, 1)


# ---------------------------------------------------------------------------
# 226 review WR-03 — a level on a threshold is indeterminate, not a mismatch.
#
# The soak rolls levels FORWARD from `initial = balance - Σpnl - Σflows`; production rolls them
# BACKWARD from equity. The two carry different float residues of ~1e-13, so when a level sits
# exactly on a threshold (zero, or the unit's dust floor) they land on opposite sides of it and an
# honest combiner was named a mismatch. Two common shapes put a level on one by construction: the
# $100 minimum deposit (the USD dust floor) and a full withdrawal followed by a re-deposit (zero).
# Every fixture below is a REVIEW probe, pinned: it was RED on the exact compares, with the kind
# recorded beside it, and its P&L list is the one that reproduced the residue.
# ---------------------------------------------------------------------------
def _balance_from(start: float, pnl) -> float:
    """``start`` plus ``pnl`` accumulated left to right: the order the residue depends on."""
    balance = start
    for amount in pnl:
        balance += amount
    return balance


def _hundred_dollar_deposit_deals(pnl: list[float]) -> list[dict]:
    """10-02 a +100 deposit at 08:00 and a same-day position 10:00-15:00 (timed first day), then
    one untimed trade per day on 10-03 onward: ``pnl[0]`` closes the position, ``pnl[1:]`` follow."""
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100.0}, _ms(2, 8)),
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 1, "profit": 0.0}, _ms(2, 10)
        ),
        _stamped_deal(
            {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 1, "profit": pnl[0]}, _ms(2, 15)
        ),
    ]
    deals += [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": amount}, _ms(3 + i, 12))
        for i, amount in enumerate(pnl[1:])
    ]
    return deals


def _deposit_day_then_untimed_trades_deals(pnl: list[float]) -> list[dict]:
    """10-01 a +100 deposit-only day, then one untimed trade per day from 10-02: the first trade
    day opens on a base of exactly the dust floor."""
    deals = [_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 100.0}, _ms(1, 8))]
    deals += [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": amount}, _ms(2 + i, 12))
        for i, amount in enumerate(pnl)
    ]
    return deals


def _drain_and_redeposit_deals(deposit: float, before: list[float], after: list[float]) -> list[dict]:
    """10-02 a deposit, one trade a day on 10-03.., a withdrawal of the WHOLE balance on 10-07,
    quiet days, a +2_000 deposit on 10-12 and one trade a day from 10-13."""
    deals = [_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": deposit}, _ms(2, 8))]
    deals += [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": amount}, _ms(3 + i, 12))
        for i, amount in enumerate(before)
    ]
    deals.append(
        _stamped_deal(
            {"type": _DEAL_TYPE_BALANCE, "profit": -_balance_from(deposit, before)}, _ms(7, 9)
        )
    )
    deals.append(_stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 2_000.0}, _ms(12, 9)))
    deals += [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": amount}, _ms(13 + i, 12))
        for i, amount in enumerate(after)
    ]
    return deals


def test_a_100_dollar_minimum_deposit_account_is_not_false_red():
    # The first day's cohort base is the dust floor to the last bit: the soak's `initial` is
    # -1.42e-14, so it reads 99.99999999999999 < 100 and expects NaN, while production's base is
    # exactly 100.0 and publishes 0.0136 (RED before: `timed_day_not_nan` on 10-02).
    pnl = [1.36, 2.19, 2.57, 3.6, 2.18, 3.46]
    balance = _balance_from(100.0, pnl)
    parity = _reconcile(
        _make_factory(equity=balance, balance=balance, deals=_hundred_dollar_deposit_deals(pnl))
    )
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["indeterminate"] == 1
    # The five untimed days after the first are exact-checked. The knife-edge first day certifies
    # nothing but counts in the denominator (226 review CR-04), so the share is 5/6; it was 1.0
    # while indeterminate days sat outside the denominator.
    assert (check["checked"], check["guarded"], check["timed"], check["timed_verified"]) == (
        5, 0, 0, 0,
    )
    assert check["certified_share"] == pytest.approx(5 / 6)
    assert parity["parity_ok"] is True


def test_an_untimed_day_opening_on_the_dust_floor_is_not_false_red():
    # 10-02 opens on 100 - 1.4e-14 in the soak and 100.0 in production: the soak says
    # base_guard (NaN), production publishes 1.05 / 100 (RED before: `guarded_day_not_nan`).
    pnl = [1.05, 0.55, 2.35, 0.71, 1.17]
    balance = _balance_from(100.0, pnl)
    parity = _reconcile(
        _make_factory(
            equity=balance, balance=balance, deals=_deposit_day_then_untimed_trades_deals(pnl)
        )
    )
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["indeterminate"] == 1
    assert check["checked"] == 4 and check["guarded"] == 0
    assert parity["parity_ok"] is True


@pytest.mark.parametrize(
    ("deposit", "before", "after", "pre_fix_kind"),
    [
        # The soak's drained level is +2.27e-13: it calls the quiet days tiny and expects NaN,
        # while production publishes 0.0 and names no tiny-base day.
        (1_000.0, [8.56, 34.53, -10.46], [39.9, -8.32, -24.61], "tiny_base_day_not_nan"),
        # The mirror: the soak's level is exactly 0.0, which it does not call tiny, while
        # production names tiny_base_days and publishes NaN.
        (5_000.0, [-14.65, 15.2, 36.66], [32.64, 39.58, 19.4], "flat_day_not_zero"),
    ],
)
def test_a_full_withdrawal_then_a_redeposit_is_not_false_red(
    deposit, before, after, pre_fix_kind
):
    balance = _balance_from(2_000.0, after)
    parity = _reconcile(
        _make_factory(
            equity=balance,
            balance=balance,
            deals=_drain_and_redeposit_deals(deposit, before, after),
        )
    )
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, (pre_fix_kind, check["mismatches"])
    assert check["flat"] == 5 and check["indeterminate"] == 1
    assert parity["parity_ok"] is True


def _inception_position() -> list[dict]:
    """A position opened 10:00 and closed 15:00 on 10-01 for +100."""
    return [
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 3, "profit": 0.0}, _ms(1, 10)
        ),
        _stamped_deal(
            {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 3, "profit": 100.0}, _ms(1, 15)
        ),
    ]


def test_a_healthy_inception_day_is_not_indeterminate():
    # Deposit +10_000 at 08:00, a position 10:00-15:00 for +100, on a zero starting level. Cohort 0
    # is empty and its zero base is expected, so it is never judged; the one judged cohort's base is
    # 10_000, nowhere near a threshold. The day must therefore certify, and a NaN published on it
    # must still be refused: reading cohort 0's zero base as a knife edge would accept that NaN.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 8)),
        *_inception_position(),
    ]
    parity = _reconcile(_make_factory(equity=10_100.0, balance=10_100.0, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["indeterminate"] == 0
    assert (check["timed"], check["timed_verified"]) == (1, 1)


def test_a_nan_published_on_a_healthy_inception_day_is_still_refused(monkeypatch):
    def poison(returns):
        returns[pd.Timestamp("2025-10-01")] = float("nan")
        return returns

    _publish_corrupted(monkeypatch, poison)
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 8)),
        *_inception_position(),
        # A second finite day, so the series is not all-NaN (which would read honest_empty).
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 50.0}, _ms(2, 12)),
    ]
    parity = _reconcile(_make_factory(equity=10_150.0, balance=10_150.0, deals=deals))
    assert ("2025-10-01", "timed_day_not_finite") in _mismatch_pairs(parity)
    assert parity["parity_ok"] is False


@pytest.mark.parametrize("wrong", [0.5, 0.0136 + 1e-6])
def test_a_knife_edge_day_still_rejects_a_value_that_is_neither_nan_nor_the_measured_one(
    monkeypatch, wrong
):
    # The $100 fixture again, with its first day's published return replaced. The band accepts NaN
    # and the walk's own measured value to `_RETURN_CHECK_TOL`, and nothing else: 1e-6 off is over.
    def poison(returns):
        returns[pd.Timestamp("2025-10-02")] = wrong
        return returns

    _publish_corrupted(monkeypatch, poison)
    pnl = [1.36, 2.19, 2.57, 3.6, 2.18, 3.46]
    balance = _balance_from(100.0, pnl)
    parity = _reconcile(
        _make_factory(equity=balance, balance=balance, deals=_hundred_dollar_deposit_deals(pnl))
    )
    assert ("2025-10-02", "timed_day_not_nan") in _mismatch_pairs(parity)
    assert parity["parity_ok"] is False


def test_an_untimed_knife_edge_day_still_rejects_a_value_that_is_not_the_measured_one(
    monkeypatch,
):
    # The untimed dust-floor fixture with its 10-02 return replaced by 0.5 (the honest 0.0105).
    def poison(returns):
        returns[pd.Timestamp("2025-10-02")] = 0.5
        return returns

    _publish_corrupted(monkeypatch, poison)
    pnl = [1.05, 0.55, 2.35, 0.71, 1.17]
    balance = _balance_from(100.0, pnl)
    parity = _reconcile(
        _make_factory(
            equity=balance, balance=balance, deals=_deposit_day_then_untimed_trades_deals(pnl)
        )
    )
    assert ("2025-10-02", "guarded_day_not_nan") in _mismatch_pairs(parity)
    assert parity["parity_ok"] is False


def test_a_quiet_day_on_a_drained_account_still_rejects_a_value_that_is_neither_nan_nor_zero(
    monkeypatch,
):
    # A flat day whose prior level is float residue accepts NaN or 0.0, never a return.
    def poison(returns):
        returns[pd.Timestamp("2025-10-09")] = 0.5
        return returns

    _publish_corrupted(monkeypatch, poison)
    before, after = [8.56, 34.53, -10.46], [39.9, -8.32, -24.61]
    balance = _balance_from(2_000.0, after)
    parity = _reconcile(
        _make_factory(
            equity=balance,
            balance=balance,
            deals=_drain_and_redeposit_deals(1_000.0, before, after),
        )
    )
    kinds = {kind for day, kind in _mismatch_pairs(parity) if day == "2025-10-09"}
    assert kinds & {"flat_day_not_zero", "tiny_base_day_not_nan"}
    assert parity["parity_ok"] is False


def test_the_knife_edge_band_is_float_noise_and_does_not_swallow_the_btc_dust_guard():
    # A BTC account whose base is 5e-8, under the BTC dust floor (1e-7) and nowhere near it in float
    # terms. The soak expects NaN; a combiner that publishes the unguarded P&L / base (0.2) is the
    # defect the dust guard exists to catch. A band sized from `residual_abs_tol` (1e-6 on BTC, ten
    # times the dust floor) would call it indeterminate and accept the 0.2.
    floors = classify_account_currency("BTC").floors
    published = pd.Series([0.2], index=pd.DatetimeIndex(["2025-06-02"]).as_unit("us"))
    result = _soak._reconcile_published_returns(
        published,
        pnl_by_day={"2025-06-02": 1e-8},
        flows_by_day={},
        timed_days=set(),
        initial=5e-8,
        floors=floors,
    )
    assert result["indeterminate"] == 0
    assert result["mismatches"][0]["kind"] == "guarded_day_not_nan"


def test_a_tiny_base_day_on_the_dust_edge_still_reads_nan_only():
    # 5_000 drawn down to exactly 100.0 (the dust floor) by a withdrawal on 06-02. Against its own
    # 5% of the 5_000 peak the base is tiny by a wide margin, which is not a knife edge: BOTH sides
    # of the dust edge read NaN, so the measured value is never an honest alternative. A finite
    # return on 06-03 is the tiny-base defect the rule exists to catch, untimed and timed alike.
    index = pd.DatetimeIndex(["2025-06-02", "2025-06-03"]).as_unit("us")
    untimed = _soak._reconcile_published_returns(
        pd.Series([0.0, 0.01], index=index),
        pnl_by_day={"2025-06-03": 1.0},
        flows_by_day={"2025-06-02": -4_900.0},
        timed_days=set(),
        initial=5_000.0,
    )
    assert untimed["tiny_base"] == 1
    assert ("2025-06-03", "guarded_day_not_nan") in {
        (m["day"], m["kind"]) for m in untimed["mismatches"]
    }
    # Timed: a +10 deposit at 09:00 and a +1 position opened at 10:00 on the same 100.0 base.
    timing = {
        "2025-06-03": _soak._WalkDayTiming(flows=((9, 10.0),), pnl=((10, 1.0),)),
    }
    timed = _soak._reconcile_published_returns(
        pd.Series([0.0, 1.0 / 110.0], index=index),
        pnl_by_day={"2025-06-03": 1.0},
        flows_by_day={"2025-06-02": -4_900.0, "2025-06-03": 10.0},
        timed_days={"2025-06-03"},
        initial=5_000.0,
        timing=timing,
    )
    assert timed["tiny_base"] == 1
    assert ("2025-06-03", "timed_day_not_nan") in {
        (m["day"], m["kind"]) for m in timed["mismatches"]
    }


def test_an_untimed_inception_day_is_guarded_not_indeterminate():
    # The first day, funded INSIDE the window, on a zero level: the inception rule owns it and it is
    # `guarded`. Its zero base is expected, never a knife edge, so it must not be read as one.
    published = pd.Series([float("nan")], index=pd.DatetimeIndex(["2025-06-02"]).as_unit("us"))
    result = _soak._reconcile_published_returns(
        published,
        pnl_by_day={"2025-06-02": 1.0},
        flows_by_day={"2025-06-02": 100.0},
        timed_days=set(),
        initial=0.0,
    )
    assert result["mismatch_count"] == 0
    assert (result["guarded"], result["indeterminate"]) == (1, 0)


def test_a_finite_return_on_a_base_of_zero_is_never_indeterminate():
    # Zero is a knife edge too, but the measured reading there is NaN (no base), so only NaN is
    # honest. The same 5.0 of P&L published as a return of 1.0 must stay a mismatch, and the
    # measured value must never be computed as 5.0 / 0.0.
    published = pd.Series([1.0], index=pd.DatetimeIndex(["2025-06-02"]).as_unit("us"))
    result = _soak._reconcile_published_returns(
        published,
        pnl_by_day={"2025-06-02": 5.0},
        flows_by_day={},
        timed_days=set(),
        initial=0.0,
    )
    assert result["indeterminate"] == 0
    assert result["mismatches"][0]["kind"] == "guarded_day_not_nan"


# ---------------------------------------------------------------------------
# SOAK-02 (Phase 226-05) — a tiny-base day production leaves out is explained by the soak's OWN
# reading (`_walk_tiny_base_days`), never by production's `meta["tiny_base_days"]`, and the
# untimed branch judges its guards with the soak-owned `_walk_day_guard`.
# ---------------------------------------------------------------------------
def _tiny_base_deals() -> list[dict]:
    return [
        _deal(_DEAL_TYPE_SELL, 1_000.0, 26, month=5),
        _deal(_DEAL_TYPE_SELL, 1_000.0, 27, month=5),
        _deal(_DEAL_TYPE_SELL, 500.0, 28, month=5),
        _deal(_DEAL_TYPE_BALANCE, -98_000.0, 29, month=5),
        _deal(_DEAL_TYPE_SELL, 30.0, 30, month=5),
        _deal(_DEAL_TYPE_BALANCE, 10.0, 1),
        _deal(_DEAL_TYPE_SELL, 20.0, 2),
    ]


def _tiny_base_factory():
    return _make_factory(equity=4_560.0, balance=4_560.0, deals=_tiny_base_deals())


def test_a_tiny_base_day_the_real_combiner_leaves_out_is_explained():
    # initial = 4_560 - (1_000 + 1_000 + 500 + 30 + 20) - (-98_000 + 10) = 100_000. Bases
    # (the level before each day) and the 30-day peak, all hand-rolled:
    #   05-26 base 100_000 (+1_000)          -> 101_000   checked
    #   05-27 base 101_000 (+1_000)          -> 102_000   checked
    #   05-28 base 102_000 (+500)            -> 102_500   checked
    #   05-29 base 102_500 (withdrawal -98_000, no trade) -> 4_500
    #         timed flow-only day: one cohort (102_500, 0.0), return 0.0, verified
    #   05-30 base 4_500 (+30)               -> 4_530     peak 102_500, 5% = 5_125: tiny, guarded
    #   05-31 base 4_530, no deal            -> 4_530     tiny quiet day, flat, must be NaN
    #   06-01 base 4_530 (deposit +10)       -> 4_540     tiny, timed, NaN expected
    #   06-02 base 4_540 (+20)               -> 4_560     tiny, guarded
    # 05-29 and 06-01 are flow-only days (no trading deal): judged, outside the share.
    # checked 3, timed 0, guarded 2, flat 1, flow-only 2; tiny 4; share 3 / 5.
    parity = _reconcile(_tiny_base_factory())
    check = parity["return_check"]
    # FIRST (tiny-base reading arm): production NaNs the four tiny days, and only the soak's own
    # reading can explain them.
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["tiny_base"] == 4
    assert (
        check["checked"], check["timed"], check["timed_verified"], check["guarded"], check["flat"],
        check["flow_only"],
    ) == (3, 0, 0, 2, 1, 2)
    assert check["certified_share"] == pytest.approx(3 / 5)
    assert parity["parity_ok"] is True


def test_the_tiny_base_reading_is_hand_derived():
    # Level map: initial 99_000 keyed 05-31 (the day before the first level), 06-01 100_000,
    # 06-02 4_000, 06-03 4_100. Window is d-30 .. d-1, carrying the level in force at its start.
    #   06-01: base 99_000 (05-31), peak 99_000 (no earlier key): ratio 1, not tiny
    #   06-02: base 100_000, peak 100_000: not tiny
    #   06-03: base 4_000 < 0.05 * 100_000 = 5_000: tiny
    #   06-04: base 4_100 < 5_000: tiny
    #   07-05: base 4_100, window 06-05 .. 07-04 holds no key, so the carried 06-03 level 4_100
    #          is the peak: 4_100 < 205 is false, not tiny
    levels = [("2025-06-01", 100_000.0), ("2025-06-02", 4_000.0), ("2025-06-03", 4_100.0)]
    days = ["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04", "2025-07-05"]
    got = _soak._walk_tiny_base_days(levels, initial=99_000.0, days=days)
    assert got == {"2025-06-03", "2025-06-04"}
    # A base of 0.0 is never tiny (only a positive base can be a sliver of the peak).
    zero = _soak._walk_tiny_base_days(
        [("2025-06-01", 0.0)], initial=100.0, days=["2025-06-02"]
    )
    assert zero == set()


@pytest.mark.parametrize(
    ("day", "kind"),
    [
        ("2025-05-31", "tiny_base_day_not_nan"),
        ("2025-05-30", "guarded_day_not_nan"),
        ("2025-06-01", "timed_day_not_nan"),
    ],
)
def test_a_finite_value_on_a_tiny_base_day_reddens_the_gate(monkeypatch, day, kind):
    def corrupt(returns):
        returns[pd.Timestamp(day)] = 0.0
        return returns

    _publish_corrupted(monkeypatch, corrupt)
    parity = _reconcile(_tiny_base_factory())

    # FIRST: the tiny day's class decides the kind (quiet, active, timed).
    assert (day, kind) in _mismatch_pairs(parity)
    assert parity["parity_ok"] is False


def test_the_walk_tiny_base_constants_match_production():
    # The walk copies the tiny-base rule's numbers on purpose; a production change turns this
    # red and forces a conscious soak update.
    assert _soak._WALK_TINY_BASE_FRACTION == tiny_base.TINY_BASE_FRACTION
    assert _soak._WALK_TINY_BASE_WINDOW_DAYS == tiny_base.TINY_BASE_WINDOW_DAYS


_RETURN_READING_SOURCES = ("services.nav_twr", "services.broker_dailies", "services.mt5_deals")


def test_the_return_reading_uses_no_production_guard():
    tree = _soak_module_tree()
    forbidden = set(_PRODUCTION_DENYLIST) - {"USD_FLOORS", "UnitFloors"}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module in _RETURN_READING_SOURCES:
            forbidden.update(alias.asname or alias.name for alias in node.names)
    fn = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "_reconcile_published_returns"
    )
    referenced = {n.id for n in ast.walk(fn) if isinstance(n, ast.Name)} | {
        n.attr for n in ast.walk(fn) if isinstance(n, ast.Attribute)
    }
    assert referenced & forbidden == set()
    # Self-test: the check can fail. A function naming a production guard is flagged.
    fake = ast.parse("def f(b):\n    return _guard_denominator(b, 1.0)\n").body[0]
    fake_refs = {n.id for n in ast.walk(fake) if isinstance(n, ast.Name)}
    assert fake_refs & forbidden == {"_guard_denominator"}


# ---------------------------------------------------------------------------
# 226 review SFH-03 — three arms of `_reconcile_published_returns` that no test failed without.
# ---------------------------------------------------------------------------
def _direct_timed_reconcile(deals, published, *, initial, floors, timing="walk"):
    """``_reconcile_published_returns`` over the soak's own walk of ``deals`` (offset 0). ``timing``
    defaults to the walk's; pass ``{}`` or ``None`` for a timed day the soak cannot walk."""
    walk = _soak._walk_deal_ledger(deals, 0)
    return _soak._reconcile_published_returns(
        published,
        pnl_by_day=walk.pnl_by_day,
        flows_by_day=walk.flows_by_day,
        timed_days=set(walk.timing),
        initial=initial,
        floors=floors,
        timing=walk.timing if timing == "walk" else timing,
    )


def test_a_timed_first_day_is_judged_on_the_account_units_residual_floor():
    # (a) The timed branch's inception test is `abs(base) <= floors.residual_abs_tol`, and the
    # floor is the ACCOUNT UNIT's. BTC deposit +1.0 at 09:00, a position 10:00-15:00 for +0.006, on a
    # base of -0.4 BTC: above the BTC floor (1e-6), under the USD floor (1.0).
    #   BTC floor: not inception; cohort 0 is (-0.4, 0.0), a non-positive base: NaN, `base_guard`.
    #   USD floor: inception; the empty cohort 0 is skipped and cohort 1 is (0.6, 0.006) = 0.01.
    # A POSITIVE 0.4 base cannot tell the units apart: skipping an empty cohort 0 on a healthy base
    # and judging it are both a factor of 1. A base the guard breaks is what makes the unit visible.
    deals = [_cohort_flow(1.0, 9), *_cohort_trade(7, 10, 15, 0.006)]
    btc_floors = classify_account_currency("BTC").floors
    published = pd.Series([float("nan")], index=pd.DatetimeIndex(["2025-10-17"]).as_unit("us"))
    result = _direct_timed_reconcile(deals, published, initial=-0.4, floors=btc_floors)
    # FIRST (unit-floor arm): the BTC reading is NaN, so the published NaN is honest. Were the
    # clause read on the USD floor the walk would read 0.01 and the NaN would be a mismatch.
    assert result["mismatch_count"] == 0, result["mismatches"]
    assert result["timed"] == 1
    # The inception flag is what separates the two readings of the same day on the BTC dust floor.
    timing = _soak._walk_deal_ledger(deals, 0).timing["2025-10-17"]
    as_inception, _ = _soak._walk_timed_return(
        -0.4, timing, dust_nav=btc_floors.dust_nav, inception=True
    )
    as_ordinary, ordinary_reason = _soak._walk_timed_return(
        -0.4, timing, dust_nav=btc_floors.dust_nav, inception=False
    )
    assert as_inception == pytest.approx(0.01, abs=1e-12)
    assert math.isnan(as_ordinary) and ordinary_reason == "base_guard"


@pytest.mark.parametrize("timing", [{}, None])
def test_a_timed_day_the_soak_cannot_walk_is_named_never_passed(timing):
    # (b) The day is in `timed_days` but `timing` holds nothing for it (an empty map, or no map).
    # `reconcile_parity` cannot produce this, so it is pinned by a direct call.
    deals = [_cohort_flow(1_000.0, 9), *_cohort_trade(7, 10, 15, 100.0)]
    published = pd.Series([0.01], index=pd.DatetimeIndex(["2025-10-17"]).as_unit("us"))
    result = _direct_timed_reconcile(
        deals, published, initial=9_000.0, floors=USD_FLOORS, timing=timing
    )
    # FIRST (not-walked arm).
    assert ("2025-10-17", "timed_day_not_walked") in {
        (m["day"], m["kind"]) for m in result["mismatches"]
    }
    assert result["ok"] is False


def test_an_all_nan_published_series_is_inconclusive_not_a_verdict(monkeypatch):
    # (c) The combiner hands back a series with an index and no value: nothing to interpret.
    # That is INCONCLUSIVE (`parity_ok` None), the same as an empty ledger, not a False verdict.
    _publish_corrupted(monkeypatch, lambda returns: returns * float("nan"))
    parity = _canonical_parity()
    # FIRST (second honest_empty arm).
    assert parity["observation"] == "honest_empty"
    assert parity["parity_ok"] is None
    assert "no interpretable trading-return series" in parity["note"]


# ---------------------------------------------------------------------------
# 226 review SFH-04 — the attribution tolerances are pinned from both sides.
# ---------------------------------------------------------------------------
def test_the_attribution_tolerances_are_tight_on_small_amounts_and_loose_only_on_float_slack():
    # `_WALK_ATTRIBUTION_ABS_TOL` is tiny on purpose (a flat 1e-9 would hide a 10% error on a 1e-8
    # BTC deal) and `_WALK_ATTRIBUTION_REL_TOL` is float-rounding slack only. Tolerance for a pair is
    # 1e-9 x max(|a|, |b|) + 1e-12.
    #   06-02: 1e-8 vs 1.1e-8, diff 1e-9, tolerance ~1e-12: MISMATCH (an abs floor of 1e-9 hides it).
    #   06-03: 1e6 vs 1e6 + 5e-4, diff 5e-4 (relative 5e-10), tolerance 1e-3: PASS.
    #   06-04: 1e6 vs 1e6 + 1, diff 1 (relative 1e-6), tolerance 1e-3: MISMATCH (a rel tol of 1e-3
    #   would call it equal).
    pnl = {"2025-06-02": 1e-8, "2025-06-03": 1e6, "2025-06-04": 1e6}
    walk = _soak._WalkLedger(
        pnl_by_day=pnl, flows_by_day={}, total_trading_pnl=sum(pnl.values()), total_flows=0.0
    )
    check = _soak._walk_attribution_check(
        walk,
        fold_pnl_by_day={"2025-06-02": 1.1e-8, "2025-06-03": 1e6 + 5e-4, "2025-06-04": 1e6 + 1.0},
        fold_flows_by_day={},
        fold_timed_days=set(),
    )
    assert {(m["day"], m["kind"]) for m in check["mismatches"]} == {
        ("2025-06-02", "day_attribution_mismatch"),
        ("2025-06-04", "day_attribution_mismatch"),
    }
    assert check["ok"] is False


# ---------------------------------------------------------------------------
# 226 review CR-04 — an indeterminate day certifies nothing, so it stays IN the share's denominator.
#
# The WR-03 band turns knife-edge days into `indeterminate`. Dropping them from the denominator let
# a run that certified one trading day in eleven read share 1.0 and exit 0: the same hole CR-01
# closed for flow-only days. They count against the share and never toward it, as guarded days do.
# ---------------------------------------------------------------------------
def _funded_each_morning_and_swept_each_evening(
    first_deposit: float, drain: float, sweep_days: int
) -> tuple[list[dict], float]:
    """Review CR-04's ledger. 10-01 a deposit, 10-02 a +50 trade (the one checked day), 10-03 a
    withdrawal of ``drain`` (to zero, or to the 100 dust floor), then ``sweep_days`` days each of:
    deposit 1_000 at 08:00, open 09:00, close 15:00 for +p, withdraw 1_000 + p at 20:00. A final
    deposit of 1_000 follows. Every sweep day opens on the evening level, a knife edge. Returns the
    deals and the closing balance."""
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": first_deposit}, _ms(1, 8)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 50.0}, _ms(2, 12)),
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": -drain}, _ms(3, 8)),
    ]
    for day in range(4, 4 + sweep_days):
        pnl = 10.0 + day
        deals += [
            _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 1_000.0}, _ms(day, 8)),
            _stamped_deal(
                {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 100 + day, "profit": 0.0},
                _ms(day, 9),
            ),
            _stamped_deal(
                {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 100 + day, "profit": pnl},
                _ms(day, 15),
            ),
            _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": -(1_000.0 + pnl)}, _ms(day, 20)),
        ]
    deals.append(
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 1_000.0}, _ms(4 + sweep_days, 8))
    )
    evening_level = first_deposit + 50.0 - drain
    return deals, evening_level + 1_000.0


# (first deposit, drain, evening level): the zero-base sweep and the dust-floor sweep.
_KNIFE_EDGE_SWEEPS = [(10_000.0, 10_050.0), (1_000.0, 950.0)]


@pytest.mark.parametrize(("first_deposit", "drain"), _KNIFE_EDGE_SWEEPS)
def test_one_checked_day_among_knife_edge_sweep_days_is_not_green(first_deposit, drain):
    deals, balance = _funded_each_morning_and_swept_each_evening(first_deposit, drain, 5)
    parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
    check = parity["return_check"]
    # The series is honest, so nothing is a mismatch; the run is red on its coverage alone.
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["checked"] == 1
    # The knife-edge days certify nothing, so they count against the share and never toward it.
    assert check["indeterminate"] >= 5
    assert check["certified_share"] < check["min_certified_share"]
    assert check["ok"] is False
    assert parity["parity_ok"] is not True


@pytest.mark.parametrize(("first_deposit", "drain"), _KNIFE_EDGE_SWEEPS)
def test_one_checked_day_among_knife_edge_sweep_days_cannot_exit_zero(
    tmp_path, monkeypatch, first_deposit, drain
):
    _set_env(monkeypatch, tmp_path)
    deals, balance = _funded_each_morning_and_swept_each_evening(first_deposit, drain, 5)
    rc = main(
        [],
        client_factory=_make_factory(equity=balance, balance=balance, deals=deals),
        utc_now=_UTC_NOW,
    )
    assert rc != 0


def test_one_checked_day_cannot_be_carried_to_green_by_a_hundred_indeterminate_days():
    # The silent-failure hunter's probe. Day 0 is the one checked trading day. Then 100 cycles of a
    # +1_000 deposit with +5 of P&L on a zero base (an honest NaN, a knife edge) and a full
    # withdrawal the next day (an honest 0.0, on a base that is neither tiny nor under dust).
    days = [(datetime(2026, 1, 1) + timedelta(days=i)).date().isoformat() for i in range(202)]
    pnl = {days[0]: 100.0}
    flows = {days[1]: -10_100.0}
    returns = {days[0]: 100.0 / 10_000.0, days[1]: 0.0}
    for k in range(100):
        deposit_day, withdraw_day = days[2 + 2 * k], days[3 + 2 * k]
        flows[deposit_day], pnl[deposit_day] = 1_000.0, 5.0
        flows[withdraw_day] = -1_005.0
        returns[deposit_day], returns[withdraw_day] = float("nan"), 0.0
    series = pd.Series(returns)
    series.index = pd.DatetimeIndex(series.index).as_unit("us")
    result = _soak._reconcile_published_returns(
        series, pnl_by_day=pnl, flows_by_day=flows, timed_days=set(), initial=10_000.0
    )
    assert result["mismatch_count"] == 0, result["mismatches"]
    assert result["checked"] == 1 and result["indeterminate"] == 100
    assert result["certified_share"] == pytest.approx(1 / 101)
    assert result["ok"] is False


# ---------------------------------------------------------------------------
# 226 review WR-04 — the knife-edge band's WIDTH is pinned, and a base genuinely under dust is
# never read as a knife edge. The band is safe only because it is narrow: widened to 1e-5 it
# accepted a finite return on a base half a cent under the USD dust floor, and every test passed.
# ---------------------------------------------------------------------------
def test_the_knife_edge_band_width_is_pinned():
    assert _soak._LEVEL_NOISE_REL == 1e-12


def test_a_finite_return_on_a_base_half_a_cent_under_the_dust_floor_is_refused():
    # 1_000 drawn down to 99.995 on 06-02 (not tiny: 5% of 1_000 is 50), then +1.0 on 06-03,
    # published as 1.0 / 99.995. The base is under the 100 dust floor by 0.005, a margin far wider
    # than float noise, so the dust guard must have broken the day: only NaN is honest.
    index = pd.DatetimeIndex(["2025-06-02", "2025-06-03"]).as_unit("us")
    result = _soak._reconcile_published_returns(
        pd.Series([0.0, 1.0 / 99.995], index=index),
        pnl_by_day={"2025-06-03": 1.0},
        flows_by_day={"2025-06-02": -900.005},
        timed_days=set(),
        initial=1_000.0,
    )
    assert result["indeterminate"] == 0
    assert result["tiny_base"] == 0
    assert [(m["day"], m["kind"]) for m in result["mismatches"]] == [
        ("2025-06-03", "guarded_day_not_nan")
    ]
    assert result["ok"] is False


# ---------------------------------------------------------------------------
# 226 review WR-05 — a day certifies only when its P&L can test a base.
#
# `pnl != 0.0` certified a day whose deals net to float residue: +0.1, +0.2, -0.3 books 5.5e-17,
# and one close of 0.30 profit, -0.10 commission and -0.20 swap books -2.8e-17. Such a day's expected
# return is about 1e-21, so any published value within 1e-9 passes whatever base the combiner used.
# A day certifies only when |P&L| is above the return tolerance relative to its base (or to the unit's
# dust floor on a base under it); a smaller one is judged but counted flow-only, as a zero-P&L day is.
# ---------------------------------------------------------------------------
def _net_zero_trade_deals(day: int) -> list[dict]:
    """Three untimed closes on ``day`` whose profits (+0.1, +0.2, -0.3) net to float residue."""
    return [
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": amount}, _ms(day, 10 + i))
        for i, amount in enumerate((0.1, 0.2, -0.3))
    ]


def _balance_after(deals: list[dict]) -> float:
    return _balance_from(0.0, [deal["profit"] + deal["commission"] + deal["swap"] for deal in deals])


def test_a_day_whose_deals_net_to_float_residue_does_not_certify_a_run():
    # 10-01 a +10_000 deposit; 10-02 a +150_000 trade (P&L-dominated, so guarded); 10-03 three
    # closes netting 5.5e-17. Every day whose P&L can test a base was guarded, so the run is vacuous.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 150_000.0}, _ms(2, 10)),
        *_net_zero_trade_deals(3),
    ]
    balance = _balance_after(deals)
    parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["checked"], check["guarded"], check["flow_only"]) == (0, 1, 2)
    assert check["vacuous"] is True and check["ok"] is False
    assert parity["parity_ok"] is False


def test_a_breakeven_close_after_costs_does_not_certify_a_run():
    # One close of +0.30 profit, -0.10 commission and -0.20 swap books -2.8e-17, not 0.0; which
    # decimals leave a residue is arbitrary (0.70 / -0.35 / -0.35 books exactly 0.0).
    close = _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 0.30}, _ms(3, 10))
    close["commission"], close["swap"] = -0.10, -0.20
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 150_000.0}, _ms(2, 10)),
        close,
    ]
    balance = _balance_after(deals)
    parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert check["checked"] == 0 and check["vacuous"] is True
    assert parity["parity_ok"] is False


def test_a_net_zero_run_cannot_exit_zero(tmp_path, monkeypatch):
    _set_env(monkeypatch, tmp_path)
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 150_000.0}, _ms(2, 10)),
        *_net_zero_trade_deals(3),
    ]
    balance = _balance_after(deals)
    rc = main(
        [], client_factory=_make_factory(equity=balance, balance=balance, deals=deals), utc_now=_UTC_NOW
    )
    assert rc != 0


def test_a_timed_day_whose_cohort_deals_net_to_float_residue_does_not_certify():
    # Two P&L-dominated days (guarded) and one real +50 day (checked) leave the share at 1/3. A
    # timed day (a +1_000 deposit at 09:00, a position 10:00-15:02 whose three closes net 5.5e-17)
    # must not lift it: counted verified, the share was 2/4 = 0.5, exactly the floor, and green.
    deals = [
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 10_000.0}, _ms(1, 9)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 150_000.0}, _ms(2, 10)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 50.0}, _ms(3, 10)),
        _stamped_deal({"type": _DEAL_TYPE_SELL, "entry": 1, "profit": 2_000_000.0}, _ms(4, 10)),
        _stamped_deal({"type": _DEAL_TYPE_BALANCE, "profit": 1_000.0}, _ms(5, 9)),
        _stamped_deal(
            {"type": _DEAL_TYPE_BUY, "entry": 0, "position_id": 9, "profit": 0.0}, _ms(5, 10)
        ),
        *[
            _stamped_deal(
                {"type": _DEAL_TYPE_SELL, "entry": 1, "position_id": 9, "profit": amount},
                _ms(5, 15, i),
            )
            for i, amount in enumerate((0.1, 0.2, -0.3))
        ],
    ]
    balance = _balance_after(deals)
    parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
    check = parity["return_check"]
    assert check["mismatch_count"] == 0, check["mismatches"]
    assert (check["checked"], check["guarded"], check["timed"], check["timed_verified"]) == (
        1, 2, 0, 0,
    )
    assert check["certified_share"] == pytest.approx(1 / 3)
    assert check["ok"] is False and parity["parity_ok"] is False
