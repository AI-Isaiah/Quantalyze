"""MT5 go-live soak / parity runner (MT5GOLIVE-02) — reconstructed-equity-vs-live
parity over the soak window, secret-safe and fail-loud, COMPOSED from shipped parts.

WHY: Phase 139's soak gate needs a founder-runnable verifier that proves the
Phase-136 reconciliation gate — reconstructed daily-NAV terminal vs the live
``account_info().equity`` — holds on REAL prod data over a multi-day window BEFORE
the ``MT5_ENABLED`` / ``NEXT_PUBLIC_MT5_ENABLED`` flip. Terminal self-update is a
managed risk (the image tag/digest is pinnable, the terminal binary is not — Phase
139 research Pitfall 2); the soak window is the parity-break DETECTOR. A break
reddens a run before the flip.

This runner writes almost no new logic. It COMPOSES:
  * ``scripts.mt5_spike.run_spike`` — the offline-proven 134 connectivity legs
    (unattended login, read-only proof, deal reconstruction, server-time offset).
    The connectivity legs are NEVER reimplemented.
  * ``services.broker_dailies.combine_mt5_deal_ledger`` — the SHIPPED 136 combiner
    that folds the deal ledger into the ONE backbone's ``(returns, meta)`` shape.
    NOT a parallel parity calc.
  * ``services.mt5_deals`` (classify_deal / deal_cash_effect / deal_utc_day /
    _coerce_money) — the ONE DEAL_TYPE allow-list + server-time→UTC seam. An
    ambiguous / unclassifiable type FAILS LOUD (the deribit-``correction`` lesson).
  * ``scripts.deribit_ground_truth`` sanitize primitives — single-definition
    secret hygiene; a credential literal can never survive into the committed log.

RECONCILIATION (the 136-03 gate on real data)
----------------------------------------------
login → account_info() (equity + balance anchor) → history_deals_get(window) →
combine_mt5_deal_ledger → forward-roll NAV_t = NAV_{t-1}·(1+r_t) + F_t → parity_ok
iff ``|reconstructed − equity| <= max($1, 1e-6·|equity|)`` (the exact 136-03
tolerance).

The forward-roll ``initial`` is anchored to the account BALANCE
(``balance − Σtrading_pnl − Σflows``), NOT equity. The shipped
``reconstruct_nav_and_twr`` anchors the realized terminal to
``anchor_nav − open_unrealized_usd`` == balance (nav_twr.py:800). Deriving
``initial`` from equity would make ``|reconstructed − equity|`` a mathematical
identity (always ~0) — a self-referential oracle with no teeth. Anchoring to
balance keeps the check honest: the realized ledger reconstructs the balance, and
parity to the live equity holds only when the uPnL wedge is within tolerance — so
an unexplained equity drift genuinely reddens the run. The uPnL wedge
(``equity − balance``) is recorded so the founder sees any open-position exposure.

Honesty contract (fail-loud, never fabricate a flat account):
  * an ``Mt5ClientError`` read → observation="error", parity_ok=None, exit 1 —
    NEVER coerced to a zero-deal ledger (the ``None`` ≠ ``()`` lesson);
  * an empty ledger → observation="honest_empty", parity_ok=None (INCONCLUSIVE) —
    a zero-deal run can NEVER count as a green soak run;
  * an unclassifiable DEAL_TYPE → ``Mt5DealClassificationError`` propagates
    (never swallowed);
  * exit 0 ONLY when parity_ok is True AND the spike verdict is not NO-GO.

SECURITY (hard constraint, carried forward from 134):
  * the ``mt5linux`` RPyC bridge is an UNAUTHENTICATED arbitrary-remote-code
    channel — the gateway MUST be reachable ONLY over a PRIVATE network (Railway
    internal / WireGuard / SSH tunnel), NEVER a public port;
  * credentials arrive via ENV only; the whole record passes
    ``sanitize_evidence`` + ``assert_sanitized`` BEFORE any write or stdout.

The forbidden trade call is referred to without call parentheses; this runner
composes ``run_spike`` (which never touches order_send) and adds NO trade surface.

USAGE
-----
  # reuse the 134 MT5_SPIKE_* env contract verbatim + the soak-only knobs:
  export MT5_SPIKE_LOGIN=<broker account login (int)>
  export MT5_SPIKE_INVESTOR_PASSWORD=<investor (read-only) password>
  export MT5_SPIKE_SERVER=<exact broker server string>
  export MT5_SPIKE_HOST=<gateway private host/ip>
  export MT5_SPIKE_PORT=<gateway rpyc port>
  # optional:
  export MT5_SPIKE_HISTORY_DAYS=90                 # reconciliation window
  export MT5_SOAK_SERVER_OFFSET_MIN=0              # [ASSUMED] until founder-confirmed
                                                    # from spike leg 4 / the VNC clock
  export MT5_SOAK_LOG_DIR=docs/evidence            # per-run record dir
  cd analytics-service && python -m scripts.mt5_soak
  echo "exit=$?"

Recommended window: 5–10 business days [ASSUMED A5, founder confirms], one run per
day, EVERY run within tolerance; extend the window on any red run.

EXIT CODES
----------
  0  soak run PASS — parity within tolerance + spike verdict not NO-GO
  2  read-only premise violated (ScopeViolationError)
  3  missing required MT5_SPIKE_* env vars
  1  any other outcome (parity breach / INCONCLUSIVE / error / scrubbed failure)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

# COMPOSE — the 134 connectivity legs, reused verbatim (never reimplemented).
from scripts.mt5_spike import _default_client_factory, run_spike

# COMPOSE — single-definition secret hygiene (never a bespoke sanitizer).
from scripts.deribit_ground_truth import (
    ScopeViolationError,
    _redact_secret_values,
    assert_sanitized,
    sanitize_evidence,
)

# COMPOSE — the SHIPPED 136 combiner (the reconstruction path, not a parallel calc).
from services.broker_dailies import combine_mt5_deal_ledger

# COMPOSE — the ONE DEAL_TYPE allow-list + server-time→UTC seam (fail-loud).
from services.mt5_deals import (
    Mt5DealClassificationError,
    _coerce_money,
    classify_deal,
    deal_cash_effect,
    deal_utc_day,
)
from services.mt5_client import Mt5ClientError

_REQUIRED_ENV = (
    "MT5_SPIKE_LOGIN",
    "MT5_SPIKE_INVESTOR_PASSWORD",
    "MT5_SPIKE_SERVER",
    "MT5_SPIKE_HOST",
    "MT5_SPIKE_PORT",
)


def _parity_tolerance(equity: float) -> float:
    """The EXACT 136-03 gate tolerance: max($1, 1e-6·|equity|)."""
    return max(1.0, 1e-6 * abs(equity))


def _forward_terminal_nav(
    returns_by_day: dict[str, float], *, initial: float, flows_by_day: dict[str, float]
) -> float:
    """Roll the equity curve FORWARD from ``initial`` using the flow-in-numerator
    identity NAV_t = NAV_{t-1}·(1+r_t) + F_t — the SAME roll the 136-03 oracle uses
    (test_mt5_derive_branch.py:594). Independent of the SUT's own NAV levels."""
    nav = initial
    for day in sorted(returns_by_day):
        nav = nav * (1.0 + returns_by_day[day]) + flows_by_day.get(day, 0.0)
    return nav


def _safe_close(client: Any) -> None:
    if client is None:
        return
    try:
        client.close()
    except Exception:  # noqa: BLE001 - a teardown error must never mask the result
        pass


def reconcile_parity(
    client_factory: Callable[..., Any],
    host: str,
    port: int,
    login: int,
    investor_pw: str,
    server: str,
    *,
    history_days: int,
    server_utc_offset_s: int,
    utc_now: datetime | None = None,
) -> dict:
    """Prove the 136 reconciliation gate against the live account.

    login → account_info() (equity + balance anchor) → history_deals_get over the
    window → combine_mt5_deal_ledger → forward-roll from a BALANCE-anchored initial
    → parity_ok iff ``|reconstructed − equity| <= max($1, 1e-6·|equity|)``.

    Returns a dict with ``observation`` ("populated"/"honest_empty"/"error"),
    ``parity_ok`` (True/False/None), the equity/balance/upnl_wedge anchors, the
    reconstructed terminal, the tolerance, the deal_count, and the combine meta
    flags. An ``Mt5ClientError`` read → observation="error", parity_ok=None (NEVER
    coerced to an empty ledger). An empty ledger → observation="honest_empty",
    parity_ok=None (INCONCLUSIVE — never green). An unclassifiable DEAL_TYPE
    propagates ``Mt5DealClassificationError`` (never swallowed).
    """
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    redact = lambda text: _redact_secret_values(str(text), str(login), investor_pw, server)  # noqa: E731

    client = None
    try:
        try:
            client = client_factory(host, port)
            client.login(login, investor_pw, server)
            info = client.account_info()
            equity = float(info["equity"])
            balance = float(info["balance"])
            from_ts = utc_now - timedelta(days=history_days)
            deals = client.history_deals_get(from_ts, utc_now)
        except Mt5ClientError as exc:
            # An error is recorded typed — NEVER coerced into a zero-deal reading
            # (the None != () honesty that motivates this whole source).
            return {
                "observation": "error",
                "parity_ok": None,
                "error": {"code": exc.code, "message": redact(exc)},
            }

        deal_count = len(deals)
        if not deals:
            return {
                "observation": "honest_empty",
                "parity_ok": None,
                "deal_count": 0,
                "equity": equity,
                "balance": balance,
                "upnl_wedge": equity - balance,
                "note": (
                    "zero-deal ledger — INCONCLUSIVE, never a green soak run "
                    "(a deposit-only/empty account has no track record)"
                ),
            }

        # The SHIPPED 136 combiner is the reconstruction path (Mt5DealClassificationError
        # on an ambiguous DEAL_TYPE propagates out — nothing partial, never swallowed).
        returns, meta = combine_mt5_deal_ledger(
            deals, equity, balance, server_utc_offset_s=server_utc_offset_s
        )

        # Independent fold for the forward-roll inputs (classify_deal / deal_cash_effect /
        # deal_utc_day are the SAME primitives combine uses — no parallel classification).
        total_trading_pnl = 0.0
        total_flows = 0.0
        flows_by_day: dict[str, float] = {}
        for deal in deals:
            kind = classify_deal(deal)
            if kind == "trading":
                total_trading_pnl += deal_cash_effect(deal)
            else:  # external_flow — capital in/out (BALANCE books the amount in profit)
                day = deal_utc_day(deal.get("time"), server_utc_offset_s)
                raw = deal.get("profit", 0.0)
                amount = 0.0 if raw is None else _coerce_money(raw, field="mt5_flow_profit")
                flows_by_day[day] = flows_by_day.get(day, 0.0) + amount
                total_flows += amount

        returns_by_day = {
            ts.date().isoformat(): float(value)
            for ts, value in returns.items()
            if value == value  # drop NaN gap days (they carry no return information)
        }

        # A ledger with no interpretable trading return series (e.g. deposit-only)
        # is INCONCLUSIVE — never a fabricated flat green run.
        if returns.empty or not returns_by_day:
            return {
                "observation": "honest_empty",
                "parity_ok": None,
                "deal_count": deal_count,
                "equity": equity,
                "balance": balance,
                "upnl_wedge": equity - balance,
                "note": "no interpretable trading-return series — INCONCLUSIVE",
            }

        # BALANCE-anchored initial (see the module docstring — an equity-anchored
        # initial would make the check a vacuous identity with no teeth).
        initial = balance - total_trading_pnl - total_flows
        reconstructed = _forward_terminal_nav(
            returns_by_day, initial=initial, flows_by_day=flows_by_day
        )
        tolerance = _parity_tolerance(equity)

        return {
            "observation": "populated",
            "parity_ok": abs(reconstructed - equity) <= tolerance,
            "deal_count": deal_count,
            "equity": equity,
            "balance": balance,
            "upnl_wedge": equity - balance,
            "total_trading_pnl": total_trading_pnl,
            "total_flows": total_flows,
            "reconstructed_terminal": reconstructed,
            "tolerance": tolerance,
            "residual": reconstructed - equity,
            "meta": {
                key: meta[key]
                for key in ("nav_coverage_gap_days", "computation_status_hint")
                if key in meta
            },
        }
    finally:
        _safe_close(client)


def run_soak(
    env: dict,
    *,
    client_factory: Callable[..., Any],
    utc_now: datetime | None = None,
) -> dict:
    """Compose the 134 spike legs (``run_spike``) with the 136 parity reconciliation
    into one soak-run report. Reuses the MT5_SPIKE_* env contract verbatim; the
    soak-only knobs are MT5_SOAK_SERVER_OFFSET_MIN and MT5_SOAK_LOG_DIR."""
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)

    login = int(env["MT5_SPIKE_LOGIN"])
    investor_pw = env["MT5_SPIKE_INVESTOR_PASSWORD"]
    server = env["MT5_SPIKE_SERVER"]
    host = env["MT5_SPIKE_HOST"]
    port = int(env["MT5_SPIKE_PORT"])
    history_days = int(env.get("MT5_SPIKE_HISTORY_DAYS") or 90)
    # [ASSUMED A2] until the founder confirms the broker server-time offset from
    # spike leg 4 / the VNC-displayed server clock. Whole/half-hour minutes → seconds.
    offset_min = int(env.get("MT5_SOAK_SERVER_OFFSET_MIN") or 0)
    server_utc_offset_s = offset_min * 60

    report = run_spike(env, client_factory=client_factory, utc_now=utc_now)
    report["parity"] = reconcile_parity(
        client_factory,
        host,
        port,
        login,
        investor_pw,
        server,
        history_days=history_days,
        server_utc_offset_s=server_utc_offset_s,
        utc_now=utc_now,
    )
    report["server_utc_offset_min_assumed"] = offset_min
    report["soak_run_at"] = utc_now.isoformat()
    return report


def main(
    argv: list[str] | None = None,
    *,
    client_factory: Callable[..., Any] | None = None,
    utc_now: datetime | None = None,
) -> int:
    """CLI entrypoint. Writes ONE sanitized JSON record per run to
    MT5_SOAK_LOG_DIR/mt5-soak-<UTC-date>.json and prints a sanitized summary to
    stdout. Exit codes: 0 PASS, 2 scope violation, 3 missing env, 1 otherwise.

    ``client_factory`` / ``utc_now`` are injectable so the offline tests run with
    zero network and no mt5linux import.
    """
    import argparse
    import json
    import os
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(
        description="MT5 go-live soak / parity runner (MT5GOLIVE-02)."
    )
    parser.parse_args(argv)

    missing = [name for name in _REQUIRED_ENV if not os.getenv(name)]
    if missing:
        print(
            "ERROR: missing required env vars: "
            + ", ".join(missing)
            + " (env only; values are never printed).",
            file=sys.stderr,
        )
        return 3

    env = {
        k: v
        for k, v in os.environ.items()
        if k.startswith("MT5_SPIKE_") or k.startswith("MT5_SOAK_")
    }
    login = os.getenv("MT5_SPIKE_LOGIN")
    investor_pw = os.getenv("MT5_SPIKE_INVESTOR_PASSWORD")
    server = os.getenv("MT5_SPIKE_SERVER")

    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    if client_factory is None:
        client_factory = _default_client_factory

    try:
        report = run_soak(env, client_factory=client_factory, utc_now=utc_now)
    except ScopeViolationError as exc:
        # Scope strings are not secrets — print the fail-loud reason verbatim.
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - scrub credential literals before stderr
        print(
            "ERROR: " + _redact_secret_values(str(exc), login, investor_pw, server),
            file=sys.stderr,
        )
        return 1

    # Sanitize the WHOLE record BEFORE any write or stdout (T-139-01).
    clean = sanitize_evidence(report)
    assert_sanitized(clean)

    log_dir = Path(env.get("MT5_SOAK_LOG_DIR") or "docs/evidence")
    log_dir.mkdir(parents=True, exist_ok=True)
    record_path = log_dir / f"mt5-soak-{utc_now.date().isoformat()}.json"
    record_path.write_text(json.dumps(clean, indent=2, default=str), encoding="utf-8")

    print(json.dumps(clean, indent=2, default=str))

    parity = report.get("parity", {})
    spike_verdict = report.get("verdict")
    # Exit 0 ONLY when parity is within tolerance AND the spike is not a NO-GO.
    if parity.get("parity_ok") is True and spike_verdict != "NO-GO":
        return 0
    return 1


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
