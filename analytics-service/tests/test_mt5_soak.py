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

import json
from datetime import datetime, timezone
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
        trade_allowed: bool = False,
    ) -> None:
        self._touched = touched
        self._equity = equity
        self._balance = balance
        self._login = login
        self._deals = deals if deals is not None else []
        self._deals_error = deals_error
        self._trade_allowed = trade_allowed

    def login(self, login, password, server) -> None:
        self._touched.add("login")

    def account_info(self) -> dict:
        self._touched.add("account_info")
        return {
            "equity": self._equity,
            "balance": self._balance,
            "currency": "USD",
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


def test_the_real_combiner_passes_and_every_excluded_day_is_counted():
    parity = _canonical_parity()
    check = parity["return_check"]
    assert parity["return_check_ok"] is True and parity["recon_ok"] is True
    # 06-02, 06-04, 06-05 are exact-checked; 06-03 is the gap-filled flat day.
    assert (check["checked"], check["flat"], check["timed"], check["guarded"]) == (3, 1, 0, 0)
    assert check["mismatch_count"] == 0 and check["max_abs_err"] < check["tolerance"]


def test_timed_days_are_counted_not_silently_dropped(monkeypatch):
    # In the timed ledger 10-16 and 10-17 are cohort-measured (excluded from the exact
    # check, and said so); 10-18 is exact-checked, and corrupting it still reddens.
    factory = _make_factory(
        equity=111_600.0, balance=111_600.0, deals=_timed_deposit_then_trade_deals()
    )
    check = _reconcile(factory)["return_check"]
    assert (check["checked"], check["timed"]) == (1, 2)

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
