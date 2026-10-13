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
combine_mt5_deal_ledger → forward-roll NAV_t = NAV_{t-1} + P_t + F_t (levels, not returns:
164.6.6.2.3 WR-01 — a timed day's return is a cohort return) → the verdict
splits into TWO independent quantities (WR-01):

  * FIDELITY (reconstruction correctness): ``recon_ok`` iff BOTH
      (a) LEVELS: ``|reconstructed − balance| <= max($1, 1e-6·|balance|)``. The
          forward-roll ``initial`` is anchored to the account BALANCE
          (``balance − Σtrading_pnl − Σflows``), and the shipped
          ``reconstruct_nav_and_twr`` terminates the realized series at
          ``anchor_nav − open_unrealized_usd`` == balance (nav_twr.py:836). So the
          realized ledger reconstructs the BALANCE. This catches a deal the fold drops
          or double counts (``initial`` comes from the soak's independent totals). It
          does NOT read the published return series: ``Σ fold_pnl − Σ trading_pnl`` is
          an identity over the same primitives, so on its own it passes for ANY returns.
      (b) PUBLISHED RETURNS (FLOWTIMING R2-01): the combiner's ``returns`` — the series the
          derive stores and the factsheet shows — are tied back to the ledger. On every
          day the return identity holds (the day is NOT in the fold's ``timing`` map)
          the published ``r_t`` must equal ``P_t / NAV_{t-1}`` (NAV_{t-1} from the level
          roll), to 1e-9. A day whose P&L was dropped, zeroed or mis-based in the
          published series reddens the gate; a NaN the DQ-01 guards cannot explain does
          too. Days that are NOT exact-checked are COUNTED and printed in the record's
          ``return_check`` block, never dropped silently: ``guarded`` (a NaN the guards
          explain), ``timed`` (a flow day measured per cohort, where r_t is not
          P_t/NAV_{t-1}; its P&L is still inside the level roll in (a), but the cohort
          arithmetic itself is covered by the nav_twr/oracle unit tests, NOT by this gate)
          and ``flat`` (a no-activity day, which must be exactly 0.0). A run whose every
          day is excluded (``checked == 0``) is vacuous and is NOT green.
  * uPnL WEDGE (open-position exposure): ``wedge = equity − balance`` is the
    LEGITIMATE floating PnL of open positions, NEVER a reconstruction error. It is
    gated SEPARATELY at the SHIPPED 136 ``UNREALIZED_MATERIALITY_RATIO`` (5%,
    ``|wedge|/equity`` on a non-dust anchor, exactly the ``unrealized_pnl_in_anchor``
    rule of nav_twr.py:868).

``parity_ok = recon_ok AND wedge-within-materiality``. Reconciling reconstructed
directly against ``equity`` under one tight tolerance (the pre-WR-01 gate) made
``parity_ok`` true only for a near-flat account — any open position >$1 false-FAILed
a correctly-reconstructed live managed account. Splitting the two keeps a legitimate
open-position wedge from masquerading as a reconstruction breach while still
surfacing a MATERIAL wedge distinctly (a material wedge never exits 0 green). The
level residual, the return check and the wedge are recorded so the founder sees them
apart.

Honesty contract (fail-loud, never fabricate a flat account):
  * an ``Mt5ClientError`` read → observation="error", parity_ok=None, exit 1 —
    NEVER coerced to a zero-deal ledger (the ``None`` ≠ ``()`` lesson);
  * an empty ledger → observation="honest_empty", parity_ok=None (INCONCLUSIVE) —
    a zero-deal run can NEVER count as a green soak run;
  * an unclassifiable DEAL_TYPE → ``Mt5DealClassificationError`` propagates
    (never swallowed);
  * exit 0 ONLY when parity_ok is True AND the spike verdict is not NO-GO AND the
    read-only proof leg POSITIVELY passes (verdict == "GO", i.e. trade_allowed is
    False). A merely-INCONCLUSIVE read-only leg — including a trade-ENABLED account
    — is NEVER green (CR-01): the read-only investor-login premise is the whole
    security basis of this integration and must be affirmatively confirmed.

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
  0  soak run PASS — reconstruction fidelity holds (levels vs balance AND the published
     returns vs the ledger), uPnL wedge within materiality, spike verdict not NO-GO, AND the read-only proof leg == "GO"
  2  read-only premise violated (ScopeViolationError)
  3  missing required MT5_SPIKE_* env vars
  1  any other outcome (fidelity breach / return-series breach / material wedge / read-only not positively
     proven / INCONCLUSIVE / error / scrubbed failure)
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import pandas as pd

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
from services.broker_dailies import _fold_mt5_deals, combine_mt5_deal_ledger

# COMPOSE — the SHIPPED 136 uPnL-wedge materiality constants (reused verbatim, never
# a re-invented magic number). DUST_NAV_FLOOR gates the ratio on a non-dust anchor
# exactly as nav_twr's own ``unrealized_pnl_in_anchor`` flag does (nav_twr.py:868).
from services.account_unit import USD_FLOORS
from services.nav_twr import (
    DUST_NAV_FLOOR,
    PNL_DOM_RATIO,
    UNREALIZED_MATERIALITY_RATIO,
    _guard_denominator,
)

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


def _parity_tolerance(anchor: float) -> float:
    """The EXACT 136-03 gate tolerance: max($1, 1e-6·|anchor|). Applied to the
    BALANCE for the reconstruction-fidelity gate (WR-01) — balance is what the
    realized ledger can actually reproduce."""
    return max(1.0, 1e-6 * abs(anchor))


def _forward_terminal_nav(
    pnl_by_day: dict[str, float], *, initial: float, flows_by_day: dict[str, float]
) -> float:
    """Roll the NAV LEVEL forward from ``initial`` with the writer-basis identity
    NAV_t = NAV_{t-1} + P_t + F_t — no return factor, the same identity the allocator
    compose rolls (``broker_dailies.reconstruct_mt5_nav_levels`` / ``mt5_day_pnl``).

    WHY LEVELS AND NOT RETURNS (164.6.6.2.3 WR-01). This used to roll the combiner's
    RETURNS with NAV_t = NAV_{t-1}·(1+r_t) + F_t. Since plan 05 a timed flow day's r_t is
    a COHORT return (each position is measured against the capital in the account when it
    opened), and that end-of-day identity no longer holds on it: a 100_000 deposit at 09:00
    followed by a position opened at 10:00 reconstructed 110_595.50 against a balance of
    111_600 and exited 1 on a correct account. P_t and F_t are dollar amounts, so the
    additive roll is exact whatever convention the returns use.

    ``pnl_by_day`` is the SHIPPED fold's own per-day trading P&L (``_fold_mt5_deals``, the
    fold ``combine_mt5_deal_ledger`` consumes), while ``initial`` is derived from the
    soak's independent totals — so a fold that drops or double-counts a deal still lands
    off balance and reddens fidelity.

    Rolls over the UNION of pnl-days and flow-days: an account funded INSIDE the window
    has flow days that are not trading days, and iterating only the pnl days would drop
    those deposits while ``initial`` still subtracted them (the original WR-01).

    ⚠️ WHAT THIS ROLL DOES NOT CHECK (R2-01). It reads no return, so on its own it cannot
    notice a wrong published return series: ``Σ pnl_by_day − Σ trading_pnl`` is an identity
    over the same primitives. ``_reconcile_published_returns`` is the check that ties the
    combiner's ``returns`` to this ledger."""
    levels = _forward_nav_levels(pnl_by_day, initial=initial, flows_by_day=flows_by_day)
    return levels[-1][1] if levels else initial


def _forward_nav_levels(
    pnl_by_day: dict[str, float], *, initial: float, flows_by_day: dict[str, float]
) -> list[tuple[str, float]]:
    """``[(day, NAV_t)]`` ascending over the union of pnl-days and flow-days, rolled with
    NAV_t = NAV_{t-1} + P_t + F_t from ``initial`` (the capital before the first day)."""
    nav = initial
    levels: list[tuple[str, float]] = []
    for day in sorted(set(pnl_by_day) | set(flows_by_day)):
        nav = nav + pnl_by_day.get(day, 0.0) + flows_by_day.get(day, 0.0)
        levels.append((day, nav))
    return levels


# Tolerance for the published-return check. The expected return is P_t / NAV_{t-1} from a
# forward roll of dollar amounts; the combiner's is (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}
# from a backward roll. The two differ by float rounding on levels (~1e-11 of NAV), a
# relative error in the return of ~1e-14. 1e-9 absolute is five orders above that and six
# below the 1e-3 perturbation the negative control uses.
_RETURN_CHECK_TOL = 1e-9
_RETURN_CHECK_MAX_MISMATCHES_LISTED = 10


def _reconcile_published_returns(
    returns: pd.Series,
    *,
    pnl_by_day: dict[str, float],
    flows_by_day: dict[str, float],
    timed_days: set[str],
    initial: float,
) -> dict[str, Any]:
    """Tie the combiner's PUBLISHED ``returns`` to the ledger (FLOWTIMING R2-01).

    On a day the return identity holds, ``r_t = (NAV_t − NAV_{t-1} − F_t)/NAV_{t-1} =
    P_t/NAV_{t-1}``. That is every day absent from the fold's ``timing`` map: a flow day
    measured at the end of the day (D-07) satisfies it too, because the flow is in the
    numerator. ``NAV_{t-1}`` comes from the soak's own level roll (anchored to the BALANCE
    through its independent totals), so a published ``r_t`` that dropped, zeroed or
    mis-based a day's P&L lands off ``P_t/NAV_{t-1}`` and the check fails.

    Day classes (every class is COUNTED in the result, none is dropped silently):
      * ``checked``  — an untimed day with a usable base: ``r_t`` must be finite and equal
        ``P_t/NAV_{t-1}`` to ``_RETURN_CHECK_TOL``.
      * ``guarded``  — an untimed day the DQ-01 guards must break (``NAV_{t-1}`` not above
        the dust floor, ``|P_t| >= PNL_DOM_RATIO·NAV_{t-1}``, or the inception day): the
        published value must be NaN. A NaN the guards do NOT explain, or a finite value
        where they require NaN, is a mismatch.
      * ``timed``    — a flow day measured per cohort: ``r_t`` is a cohort return, not
        ``P_t/NAV_{t-1}``, so the exact check does not apply. It must not be infinite. The
        cohort arithmetic is pinned by the nav_twr and oracle unit tests, NOT by this gate.
      * ``flat``     — a day with no deal and no flow (gap-filled): must be exactly 0.0.

    ``ok`` iff there is no mismatch AND ``checked > 0``: a run that excluded every day
    certified nothing about the returns, so it is reported ``vacuous`` and is not green."""
    levels = _forward_nav_levels(pnl_by_day, initial=initial, flows_by_day=flows_by_day)
    union_days = [day for day, _ in levels]
    prev_by_day: dict[str, float] = {}
    prev = initial
    for day, level in levels:
        prev_by_day[day] = prev
        prev = level
    first_union_day = union_days[0] if union_days else None

    counts = {"checked": 0, "guarded": 0, "timed": 0, "flat": 0}
    mismatches: list[dict[str, Any]] = []
    max_abs_err = 0.0

    def _mismatch(day: str, kind: str, expected: float | None, actual: float) -> None:
        mismatches.append(
            {
                "day": day,
                "kind": kind,
                "expected": expected,
                "actual": None if math.isnan(actual) else actual,
            }
        )

    for ts, raw in returns.items():
        day = ts.date().isoformat()
        actual = float(raw)
        if day in timed_days:
            counts["timed"] += 1
            if math.isinf(actual):
                _mismatch(day, "timed_day_infinite", None, actual)
            continue
        if day not in prev_by_day:
            # No deal and no flow: gap_fill_daily_returns books a flat 0.0 here.
            counts["flat"] += 1
            if actual != 0.0:
                _mismatch(day, "flat_day_not_zero", 0.0, actual)
            continue

        base = prev_by_day[day]
        pnl = pnl_by_day.get(day, 0.0)
        flow = flows_by_day.get(day, 0.0)
        inception = (
            day == first_union_day
            and flow > 0
            and abs(base) <= USD_FLOORS.residual_abs_tol
        )
        must_break = (
            inception
            or _guard_denominator(base, USD_FLOORS.dust_nav) is not None
            or abs(pnl) >= PNL_DOM_RATIO * base
        )
        if must_break:
            counts["guarded"] += 1
            if not math.isnan(actual):
                _mismatch(day, "guarded_day_not_nan", None, actual)
            continue

        counts["checked"] += 1
        expected = pnl / base
        if not math.isfinite(actual):
            _mismatch(day, "checked_day_not_finite", expected, actual)
            continue
        err = abs(actual - expected)
        max_abs_err = max(max_abs_err, err)
        if err > _RETURN_CHECK_TOL:
            _mismatch(day, "return_off_ledger", expected, actual)

    vacuous = counts["checked"] == 0
    return {
        "ok": not mismatches and not vacuous,
        "vacuous": vacuous,
        **counts,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:_RETURN_CHECK_MAX_MISMATCHES_LISTED],
        "max_abs_err": max_abs_err,
        "tolerance": _RETURN_CHECK_TOL,
    }


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
    → the verdict splits (WR-01): ``recon_ok`` iff the level roll lands within
    ``max($1, 1e-6·|balance|)`` of the balance AND the combiner's published returns
    equal ``P_t/NAV_{t-1}`` on every untimed day (R2-01; the ``return_check`` block
    counts the days it excludes), and the uPnL wedge ``equity − balance`` gated separately at
    ``UNREALIZED_MATERIALITY_RATIO``. ``parity_ok = recon_ok AND wedge-within-
    materiality``.

    Returns a dict with ``observation`` ("populated"/"honest_empty"/"error"),
    ``parity_ok`` (True/False/None), ``recon_ok`` + ``recon_level_ok`` +
    ``return_check_ok`` + ``return_check`` + ``recon_residual`` +
    ``recon_tolerance`` (the fidelity gate reported distinctly),
    ``wedge_within_materiality`` + ``upnl_wedge`` + ``wedge_materiality_ratio`` (the
    open-position exposure reported distinctly), the equity/balance anchors, the
    reconstructed terminal, the deal_count, and the combine meta flags. An
    ``Mt5ClientError`` read → observation="error", parity_ok=None (NEVER coerced to
    an empty ledger). An empty ledger → observation="honest_empty", parity_ok=None
    (INCONCLUSIVE — never green). An unclassifiable DEAL_TYPE propagates
    ``Mt5DealClassificationError`` (never swallowed).
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
        # WR-01 (FLOWTIMING): roll LEVELS, not returns — a timed day's return is a cohort
        # return, so NAV_{t-1}·(1+r_t)+F_t no longer reproduces the day. The per-day P&L is
        # the shipped fold's own (the one the combiner above consumed).
        fold_daily_pnl, _fold_flows, _fold_timing = _fold_mt5_deals(
            deals, server_utc_offset_s
        )
        pnl_by_day = {
            ts.date().isoformat(): float(value) for ts, value in fold_daily_pnl.items()
        }
        reconstructed = _forward_terminal_nav(
            pnl_by_day, initial=initial, flows_by_day=flows_by_day
        )
        # R2-01: the level roll above reads no return, so on its own it passes for ANY
        # published series. Tie the combiner's returns to the ledger on the days the return
        # identity holds; the excluded days are counted in the record, never dropped.
        return_check = _reconcile_published_returns(
            returns,
            pnl_by_day=pnl_by_day,
            flows_by_day=flows_by_day,
            timed_days={ts.date().isoformat() for ts in _fold_timing},
            initial=initial,
        )

        # WR-01: the realized ledger reconstructs the BALANCE (not equity — the
        # terminal self-updates to ``anchor − open_unrealized_usd == balance``,
        # nav_twr.py:836), so FIDELITY is reconstructed-vs-balance under the tight
        # 136-03 tolerance. This level check catches a fold that drops or double counts a
        # deal; by itself it is blind to the published returns (R2-01), which is why
        # ``return_check`` above is a second, separate condition of ``recon_ok``.
        recon_tolerance = _parity_tolerance(balance)
        recon_residual = reconstructed - balance
        recon_level_ok = abs(recon_residual) <= recon_tolerance
        # Fidelity needs BOTH the level roll AND the published returns to reconcile.
        recon_ok = recon_level_ok and bool(return_check["ok"])

        # The uPnL wedge (equity − balance) is the LEGITIMATE open-position exposure
        # — NEVER a reconstruction error. Gate it SEPARATELY at the SHIPPED 136
        # materiality ratio (|wedge|/anchor, anchor=equity, guarded on a non-dust
        # anchor exactly like nav_twr's ``unrealized_pnl_in_anchor``, nav_twr.py:868)
        # so an open-position account is no longer false-FAILed as a reconstruction
        # breach, and a MATERIAL wedge is surfaced distinctly rather than folded into
        # the fidelity residual.
        wedge = equity - balance
        wedge_material = (
            abs(equity) > DUST_NAV_FLOOR
            and abs(wedge) / abs(equity) > UNREALIZED_MATERIALITY_RATIO
        )

        # PASS iff BOTH: reconstruction fidelity holds AND the wedge is within
        # materiality. A material wedge does not certify a green soak run (it must
        # not exit-0 green) but is distinguished from a fidelity FAIL in the record.
        parity_ok = recon_ok and not wedge_material

        return {
            "observation": "populated",
            "parity_ok": parity_ok,
            "recon_ok": recon_ok,
            "recon_level_ok": recon_level_ok,
            "return_check_ok": return_check["ok"],
            "return_check": return_check,
            "wedge_within_materiality": not wedge_material,
            "deal_count": deal_count,
            "equity": equity,
            "balance": balance,
            "upnl_wedge": wedge,
            "wedge_materiality_ratio": UNREALIZED_MATERIALITY_RATIO,
            "total_trading_pnl": total_trading_pnl,
            "total_flows": total_flows,
            "reconstructed_terminal": reconstructed,
            "recon_tolerance": recon_tolerance,
            "recon_residual": recon_residual,
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
    read_only = report.get("read_only_proof", {}).get("verdict")
    # CR-01: exit 0 ONLY on a genuine PASS — parity_ok (reconstruction fidelity vs
    # balance AND uPnL wedge within materiality), the spike has NO NO-GO leg, AND the
    # read-only investor-login premise is POSITIVELY proven (read_only == "GO", i.e.
    # trade_allowed is False). An INCONCLUSIVE read-only leg — INCLUDING a
    # trade-ENABLED account — is NEVER green: the whole security premise of this
    # integration is a read-only login, so "not disproven" can never pass the gate.
    if (
        parity.get("parity_ok") is True
        and spike_verdict != "NO-GO"
        and read_only == "GO"
    ):
        return 0
    return 1


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
