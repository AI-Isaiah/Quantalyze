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
