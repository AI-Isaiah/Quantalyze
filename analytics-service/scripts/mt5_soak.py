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
  * the soak's OWN per-day walk (``_walk_*``) — deliberately NOT composed from
    ``services.mt5_deals``. An oracle that imports the arithmetic it judges agrees with it
    by construction (PITFALLS Pitfall 12), so the walk re-buckets every raw deal itself and
    is compared with the fold day by day. An ambiguous / unclassifiable type still FAILS
    LOUD: ``combine_mt5_deal_ledger`` raises ``Mt5DealClassificationError`` first, and the
    walk raises ``ValueError`` on a type outside its own allow-list.
  * ``scripts.deribit_ground_truth`` sanitize primitives — single-definition
    secret hygiene; a credential literal can never survive into the committed log.

RECONCILIATION (the 136-03 gate on real data)
----------------------------------------------
login → account_info() (equity + balance anchor) → history_deals_get(window) →
combine_mt5_deal_ledger → forward-roll NAV_t = NAV_{t-1} + P_t + F_t (levels, not returns:
164.6.6.2.3 WR-01 — a timed day's return is a cohort return) → the verdict
splits into TWO independent quantities (WR-01):

  * FIDELITY (reconstruction correctness): ``recon_ok`` iff ALL THREE
      (a) LEVELS: ``|reconstructed − balance| <= max($1, 1e-6·|balance|)``. The
          forward-roll ``initial`` is anchored to the account BALANCE
          (``balance − Σtrading_pnl − Σflows``), and the shipped
          ``reconstruct_nav_and_twr`` terminates the realized series at
          ``anchor_nav − open_unrealized_usd`` == balance (nav_twr.py:836). So the
          realized ledger reconstructs the BALANCE. This catches a deal the fold drops
          or double counts (``initial`` comes from the walk's independent totals). It
          does NOT read the published return series: ``Σ fold_pnl − Σ trading_pnl`` is
          an identity over the same primitives, so on its own it passes for ANY returns.
      (b) PUBLISHED RETURNS (FLOWTIMING R2-01): the combiner's ``returns`` — the series the
          derive stores and the factsheet shows — are tied back to the ledger. On every
          day the return identity holds (the day is NOT in the fold's ``timing`` map)
          the published ``r_t`` must equal ``P_t / NAV_{t-1}`` (NAV_{t-1} from the level
          roll), to 1e-9. A day whose P&L was dropped, zeroed or mis-based in the
          published series reddens the gate; a NaN the DQ-01 guards cannot explain does
          too. Days that are NOT exact-checked are COUNTED and printed in the record's
          ``return_check`` block, never dropped silently: ``guarded`` (a NaN the soak's
          own guard reading, ``_walk_day_guard``, or its own tiny-base reading,
          ``_walk_tiny_base_days``, explains), ``timed`` (a flow day measured per cohort, where r_t is not
          P_t/NAV_{t-1}: the soak recomputes it with its own D-17 cohort walk,
          ``_walk_timed_return``, on the timed set it derived itself, and compares to
          1e-9; a NaN is accepted only where the walk's own guard reading is NaN) and
          ``flat`` (a no-activity day, which must be exactly 0.0, or NaN when the soak's own
          tiny-base reading names it); ``indeterminate`` (a day whose base sits within float
          noise of zero or the dust floor, where the soak's forward roll and production's
          backward roll can land on opposite sides, so either reading is accepted: 226 review
          WR-03; it certifies nothing, so it counts in the share's denominator and never its
          numerator: 226 review CR-04). A run whose every
          day is excluded (``checked == 0``) is vacuous and is NOT green, and so is a run whose
          certified share ``(checked + timed_verified) / (checked + timed + guarded +
          indeterminate)`` is under ``_MIN_CHECKED_SHARE`` (one certified day among two hundred guarded ones).
      (c) ATTRIBUTION (SOAK-03): the fold's per-day trading P&L and per-day flows must equal
          the soak's own walk's, day by day. The expected return in (b) reads the walk's P&L,
          so a deal the fold buckets onto the wrong UTC day no longer moves P_t and
          NAV_{t-1} together unseen: the published return, the level roll and this compare
          each see it. A day on one side only, or a differing amount, is a named
          ``day_attribution_mismatch`` / ``flow_attribution_mismatch`` in the record's
          ``attribution_check`` block. The TIMED-DAY SET is compared too (SOAK-02): the walk
          times the flow days itself from the raw instants and positions, a day the fold timed
          and the walk cannot confirm is ``timed_day_unconfirmed``, and a day the walk times
          and the fold did not is ``timed_day_not_timed_by_fold``.
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

import bisect
import math
from collections.abc import Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction
from typing import Any, Callable, NamedTuple

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

# COMPOSE — the SHIPPED 136 uPnL-wedge materiality ratio (reused verbatim, never a
# re-invented magic number; it is unitless). The dust gate on the anchor reads the ACCOUNT
# UNIT's floors, as nav_twr's own ``unrealized_pnl_in_anchor`` flag does.
from services.account_unit import (
    USD_FLOORS,
    AccountCurrencyBlank,
    AccountCurrencyMalformed,
    AccountCurrencyUnsupported,
    UnitFloors,
    classify_account_currency,
)
from services.nav_twr import UNREALIZED_MATERIALITY_RATIO

from services.mt5_client import Mt5ClientError

_REQUIRED_ENV = (
    "MT5_SPIKE_LOGIN",
    "MT5_SPIKE_INVESTOR_PASSWORD",
    "MT5_SPIKE_SERVER",
    "MT5_SPIKE_HOST",
    "MT5_SPIKE_PORT",
)


def _parity_tolerance(anchor: float, floors: UnitFloors = USD_FLOORS) -> float:
    """The 136-03 gate tolerance: max(floor, 1e-6·|anchor|), where the absolute floor is the
    account unit's residual floor ($1 for USD, 1e-6 for BTC) and the relative band is
    unitless. Applied to the BALANCE for the reconstruction-fidelity gate (WR-01) — balance
    is what the realized ledger can actually reproduce. The USD default keeps a caller that
    names no unit at the historic $1."""
    return max(floors.residual_abs_tol, 1e-6 * abs(anchor))


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
    walk's independent totals (``_walk_deal_ledger``) — so a fold that drops or
    double-counts a deal still lands off balance and reddens fidelity.

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
# Float noise of a ROLLED level, relative to the account's own scale (the largest level it holds).
# The soak rolls forward from a subtracted ``initial`` and production backward from equity, so a
# level lands ~1e-13 of its scale apart on the two sides; 1e-12 is ~10^4 ulps, and far below every
# threshold it is compared with. Sized from the levels and never from ``residual_abs_tol``, which on
# BTC is ten times ``dust_nav`` and would swallow the dust guard whole (226 review WR-03).
_LEVEL_NOISE_REL = 1e-12
_RETURN_CHECK_MAX_MISMATCHES_LISTED = 10
# Minimum certified share: ``(checked + timed_verified) / (checked + timed + guarded +
# indeterminate)`` must be at or above this for the return check to be green. No live soak record
# exists to calibrate against, so the value is set from fixture shares: the timed fixture is 2/2 and the tiny-base fixture is 3/5,
# both green; one day in 200 is not. 0.5 reads
# "a strict majority of the days that could have been certified were". A timed day that passes the
# exact cohort compare counts as certified. An indeterminate (knife-edge) day certifies nothing but
# could have been certified, so it counts against the share and never toward it (226 review CR-04).
# Flat days carry no ledger information and are excluded,
# and so are flow-only days, those whose trading P&L can test no base (a deposit or withdrawal with no
# trading deal, or a zero-cash opening: an untimed day whose P&L is 0.0 or float residue, a timed day
# whose every cohort's is, i.e. at most ``_RETURN_CHECK_TOL`` of its base): their expected return is
# 0.0 whatever the combiner does with the day's base, so they certify nothing about it
# (226 review CR-01, CR-03, WR-05).
# One reversible constant: moving it is a one-line change with no data effect.
_MIN_CHECKED_SHARE = 0.5

# SOAK-03 walk constants. Soak-owned on purpose: the walk imports nothing it judges, so these
# are COPIES of ``services.mt5_deals``' allow-lists, pinned equal by a test (a production
# change turns that test red and forces a conscious soak update).
# BUY, SELL and the COMMISSION family: realized cash that reduces equity, never a flow.
_WALK_TRADING_TYPES: frozenset[int] = frozenset({0, 1, 7, 8, 9, 10, 11})
# BALANCE, CREDIT, BONUS: external capital, booked in ``profit`` and out of the return.
_WALK_FLOW_TYPES: frozenset[int] = frozenset({2, 3, 6})
# SOAK-02 timing constants, copies of ``broker_dailies`` / ``mt5_deals`` pinned equal by a test.
# BUY and SELL open and close positions; the commission family (7..11) is account-level.
_WALK_POSITION_TYPES: frozenset[int] = frozenset({0, 1})
# DEAL_ENTRY_IN: the deal that OPENS a position, the only entry code that sets an open instant.
_WALK_ENTRY_IN = 0
# IN, OUT, INOUT, OUT_BY: any other code is unresolvable and leaves the day untimed.
_WALK_ENTRY_CODES: frozenset[int] = frozenset({0, 1, 2, 3})
# Exact integer arithmetic on instants runs from the Unix epoch, never from a float.
_WALK_EPOCH0 = datetime(1970, 1, 1, tzinfo=timezone.utc)
# SOAK-02 cohort walk: a P&L-dominated cohort has |P| >= RATIO * base. A COPY of
# ``nav_twr.PNL_DOM_RATIO``, pinned equal by a test, so a production guard edit (Phase 229) turns
# that pin red on purpose and forces a conscious soak update. The soak never imports the
# guard it judges: an oracle that imports its own guard agrees with it by construction.
_WALK_PNL_DOM_RATIO = 10.0
# SOAK-02 tiny-base reading: a day is tiny when its base is positive and under this fraction of the
# peak level over the previous ``_WALK_TINY_BASE_WINDOW_DAYS`` calendar days. COPIES of
# ``services.tiny_base``' constants, pinned equal by a test, for the same reason as the ratio above.
_WALK_TINY_BASE_FRACTION = 0.05
_WALK_TINY_BASE_WINDOW_DAYS = 30
# Both sides add the same four fields in the same order, so equality is bit-exact in
# practice: the relative band is float-rounding slack only, and the absolute floor is
# deliberately tiny because a flat 1e-9 would hide a 10% error on a 1e-8 BTC deal.
_WALK_ATTRIBUTION_REL_TOL = 1e-9
_WALK_ATTRIBUTION_ABS_TOL = 1e-12
_WALK_MAX_MISMATCHES_LISTED = 10


class _WalkDayTiming(NamedTuple):
    """The soak's own intraday record of ONE flow day (SOAK-02). ``flows``: the UTC instant
    in ms and the amount of each flow, ascending by instant, stable. ``pnl``: the open
    instant in ms (``None`` when the position was carried overnight) and the cash of each
    trading deal, in deal order."""

    flows: tuple[tuple[int, float], ...]
    pnl: tuple[tuple[int | None, float], ...]


@dataclass(frozen=True)
class _WalkLedger:
    """What the soak's own walk read off the raw deals: per-UTC-day trading P&L, per-UTC-day
    external flows, and their totals (the totals anchor ``initial``). ``timing`` holds the
    ``_WalkDayTiming`` of every flow day whose instants the walk could all resolve; the keys
    are the soak's own timed-day set."""

    pnl_by_day: dict[str, float]
    flows_by_day: dict[str, float]
    total_trading_pnl: float
    total_flows: float
    timing: dict[str, _WalkDayTiming] = dataclass_field(default_factory=dict)


def _walk_money(raw: object, name: str) -> float:
    """One raw money field as a finite float; ``None`` is 0.0 (an absent field books nothing).
    A bool, a non-numeric or a non-finite value raises a ValueError that names the field
    and never the value (account sizes are private)."""
    if raw is None:
        return 0.0
    if isinstance(raw, bool):
        raise ValueError(f"walk deal {name} is a bool")
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ValueError(f"walk deal {name} is not numeric") from None
    if not math.isfinite(value):
        raise ValueError(f"walk deal {name} is not finite")
    return value


def _walk_epoch(raw: object) -> float:
    """A deal's broker-server ``time`` as epoch seconds. A naive datetime is read as UTC, an
    aware one by its own offset. A bool, a non-number or a non-finite number raises a
    ValueError that never echoes the value."""
    if isinstance(raw, datetime):
        aware = raw if raw.tzinfo is not None else raw.replace(tzinfo=timezone.utc)
        return aware.timestamp()
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("walk deal time is not a datable epoch")
    if not math.isfinite(raw):
        raise ValueError("walk deal time is not finite")
    return float(raw)


def _walk_utc_day(epoch: float, offset_s: int) -> str:
    """The UTC calendar day (ISO) of a server-time epoch once the fixed server-ahead-of-UTC
    offset is removed."""
    try:
        return datetime.fromtimestamp(epoch - offset_s, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        raise ValueError("walk deal time is out of the datable epoch range") from None


def _walk_position_id(deal: Mapping[str, Any]) -> int | None:
    """The deal's ``position_id`` when it is a positive int ticket, else ``None``. A bool, a
    non-int, zero (MT5's id for an account-level deal) and a negative all name no position."""
    raw = deal.get("position_id")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        return None
    return raw


def _walk_entry_code(deal: Mapping[str, Any]) -> int | None:
    """The deal's ``entry`` code when it is a non-bool int in ``_WALK_ENTRY_CODES``, else
    ``None``. An unknown code is unresolvable and is never defaulted."""
    raw = deal.get("entry")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    return raw if raw in _WALK_ENTRY_CODES else None


def _walk_instant_ms(
    deal: Mapping[str, Any], epoch: float, offset_s: int, day: str
) -> int | None:
    """A deal's UTC instant in epoch milliseconds, or ``None`` when it cannot be trusted.

    The server-clock milliseconds are ``time_msc`` when the deal carries one (it must be a
    non-bool int or a finite integral float, and fall in the same second as ``time``), else
    ``time`` itself in exact milliseconds. The fixed offset is removed, and the instant must
    sit on ``day``, the UTC day the walk already bucketed this deal on. Anything untrusted
    answers ``None``, and no default is ever substituted: not ``time``, not midnight."""
    raw_msc = deal.get("time_msc")
    if raw_msc is None:
        if epoch.is_integer():
            server_ms = int(epoch) * 1000
        else:
            server_ms = math.floor(Fraction(epoch) * 1000)
    else:
        if isinstance(raw_msc, bool):
            return None
        if isinstance(raw_msc, int):
            msc = raw_msc
        elif isinstance(raw_msc, float) and math.isfinite(raw_msc) and raw_msc.is_integer():
            msc = int(raw_msc)
        else:
            return None
        if msc // 1000 != math.floor(epoch):
            return None
        server_ms = msc
    instant = server_ms - offset_s * 1000
    try:
        instant_day = (_WALK_EPOCH0 + timedelta(milliseconds=instant)).date().isoformat()
    except OverflowError:
        return None
    return instant if instant_day == day else None


def _walk_day_timing(
    day: str,
    flow_deals: Sequence[tuple[Mapping[str, Any], float, float]],
    trading_deals: Sequence[
        tuple[Mapping[str, Any], float, int | None, int | None, int, float]
    ],
    in_days_by_position: Mapping[int, Sequence[tuple[str, Mapping[str, Any], float]]],
    offset_s: int,
) -> _WalkDayTiming | None:
    """The ``_WalkDayTiming`` of ONE flow day, or ``None`` when any instant it needs cannot be
    trusted (the day then stays untimed, exactly as the fold leaves it).

    ``flow_deals``: ``(deal, epoch, amount)`` for each of the day's flow deals.
    ``trading_deals``: ``(deal, epoch, position_id, entry_code, type, cash)`` for each of the
    day's trading deals, in deal order. ``in_days_by_position``: for each position id its IN
    deals as ``(utc_day, deal, epoch)``, on any day.

    Rules, in order: every flow instant resolves (flows sorted by instant, stably); every
    trading deal's own instant resolves; a commission-family deal with no position opens at its
    own instant; any other deal needs a position id, an entry code and a recorded IN deal.
    An IN deal on an EARLIER day means carried overnight (open ``None``); otherwise a same-day
    IN deal must exist, its instant must resolve, and the earliest one is the open, which may
    not be later than the deal that closes the position."""
    flows: list[tuple[int, float]] = []
    for deal, epoch, amount in flow_deals:
        flow_instant = _walk_instant_ms(deal, epoch, offset_s, day)
        if flow_instant is None:
            return None
        flows.append((flow_instant, amount))
    flows.sort(key=lambda event: event[0])  # stable: equal instants keep deal order

    pnl: list[tuple[int | None, float]] = []
    for deal, epoch, position_id, entry_code, kind, cash in trading_deals:
        own = _walk_instant_ms(deal, epoch, offset_s, day)
        if own is None:
            return None
        if kind not in _WALK_POSITION_TYPES and position_id is None:
            pnl.append((own, cash))
            continue
        if position_id is None or entry_code is None:
            return None
        in_deals = in_days_by_position.get(position_id)
        if not in_deals:
            return None
        if any(in_day < day for in_day, _in_deal, _in_epoch in in_deals):
            pnl.append((None, cash))
            continue
        today = [(d, e) for in_day, d, e in in_deals if in_day == day]
        if not today:
            return None
        opens = [_walk_instant_ms(d, e, offset_s, day) for d, e in today]
        resolved = [instant for instant in opens if instant is not None]
        if len(resolved) != len(opens):
            return None
        open_instant = min(resolved)
        if open_instant > own:
            return None
        pnl.append((open_instant, cash))
    return _WalkDayTiming(flows=tuple(flows), pnl=tuple(pnl))


def _walk_deal_ledger(
    deals: Sequence[Mapping[str, Any]], server_utc_offset_s: int
) -> _WalkLedger:
    """Accumulate per-UTC-day trading P&L, external flows and the timed-day set straight from
    the raw deal fields (``type``, ``time``, ``time_msc``, ``position_id``, ``entry``,
    ``profit``, ``swap``, ``commission``, ``fee``).

    WHY THIS RE-IMPLEMENTS PRODUCTION ON PURPOSE (PITFALLS Pitfall 12; CONTEXT "Independence
    rule"). The soak judges ``broker_dailies._fold_mt5_deals``. An oracle built from the fold's
    own helpers (``classify_deal``, ``deal_cash_effect``, ``deal_utc_day``) agrees with it by
    construction: a deal bucketed onto the wrong UTC day is bucketed there on both sides, so
    P_t and NAV_{t-1} move together and every check stays green. This walk therefore imports
    nothing from ``services.*`` and calls no other soak helper;
    ``test_the_walk_imports_no_production_helper`` proves it from the source.

    Its SPEC, read and never imported: ``services.mt5_deals`` (``classify_deal`` and the two
    allow-lists, ``deal_cash_effect``, ``_coerce_money``, ``_server_epoch_seconds``,
    ``_utc_day_of_server_epoch``, ``deal_utc_instant_ms``, ``deal_entry_code``,
    ``deal_position_id``) and ``broker_dailies`` (``_fold_mt5_deals``: its flow amounts are the
    ``profit`` field, and ``_mt5_flow_day_timing``: which flow days are timed).

    TIMING (SOAK-02). A flow day is timed when every instant it needs resolves, and only flow
    days can be timed. ``timing`` is built here from the raw ``time_msc`` / ``position_id`` /
    ``entry`` fields; its keys are the soak's own timed-day set, which the published-return
    reading judges by and the attribution compare checks against the fold's.

    It handles a FIXED INTEGER offset only (RESEARCH A4). A DST-aware soak would need this
    walk extended and re-fuzzed first.

    Raises ValueError (static text naming the field, never the value) on a type outside the
    two allow-lists, a bool type, an undatable time or a bad money field. A malformed
    ``time_msc``, ``position_id`` or ``entry`` never raises: it leaves its day untimed."""
    pnl_by_day: dict[str, float] = {}
    flows_by_day: dict[str, float] = {}
    flow_deals_by_day: dict[str, list[tuple[Mapping[str, Any], float, float]]] = {}
    trading_deals_by_day: dict[
        str, list[tuple[Mapping[str, Any], float, int | None, int | None, int, float]]
    ] = {}
    in_days_by_position: dict[int, list[tuple[str, Mapping[str, Any], float]]] = {}
    total_trading_pnl = 0.0
    total_flows = 0.0
    for deal in deals:
        kind = deal.get("type")
        if isinstance(kind, bool) or not isinstance(kind, int):
            raise ValueError("walk deal type is not an integer code")
        if kind not in _WALK_TRADING_TYPES and kind not in _WALK_FLOW_TYPES:
            raise ValueError("walk deal type is not in an allow-list")
        epoch = _walk_epoch(deal.get("time"))
        day = _walk_utc_day(epoch, server_utc_offset_s)
        if kind in _WALK_TRADING_TYPES:
            cash = 0.0
            for field in ("profit", "swap", "commission", "fee"):
                cash += _walk_money(deal.get(field, 0.0), field)
            pnl_by_day[day] = pnl_by_day.get(day, 0.0) + cash
            total_trading_pnl += cash
            position_id = _walk_position_id(deal)
            entry_code = _walk_entry_code(deal)
            trading_deals_by_day.setdefault(day, []).append(
                (deal, epoch, position_id, entry_code, kind, cash)
            )
            if position_id is not None and entry_code == _WALK_ENTRY_IN:
                in_days_by_position.setdefault(position_id, []).append((day, deal, epoch))
        else:
            amount = _walk_money(deal.get("profit", 0.0), "profit")
            flows_by_day[day] = flows_by_day.get(day, 0.0) + amount
            total_flows += amount
            flow_deals_by_day.setdefault(day, []).append((deal, epoch, amount))
    timing: dict[str, _WalkDayTiming] = {}
    for day, flow_deals in flow_deals_by_day.items():
        day_timing = _walk_day_timing(
            day,
            flow_deals,
            trading_deals_by_day.get(day, []),
            in_days_by_position,
            server_utc_offset_s,
        )
        if day_timing is not None:
            timing[day] = day_timing
    return _WalkLedger(
        pnl_by_day=pnl_by_day,
        flows_by_day=flows_by_day,
        total_trading_pnl=total_trading_pnl,
        total_flows=total_flows,
        timing=timing,
    )


def _walk_day_guard(base: float, pnl: float, *, dust_nav: float) -> str | None:
    """The soak's own reading of the DQ-01 denominator guards for ONE ``(base, pnl)`` cohort:
    ``"base_guard"`` when the base is not positive or sits under the account unit's dust floor,
    ``"pnl_dominated"`` when the P&L is at least ``_WALK_PNL_DOM_RATIO`` times the base, else
    ``None``. SPEC ONLY: production's denominator guards, never imported. The untimed branch of
    ``_reconcile_published_returns`` and the cohort walk both judge with this one predicate."""
    if base <= 0 or base < dust_nav:
        return "base_guard"
    if abs(pnl) >= _WALK_PNL_DOM_RATIO * base:
        return "pnl_dominated"
    return None


def _walk_cohorts(
    prev: float, timing: _WalkDayTiming, *, inception: bool
) -> list[tuple[float, float]]:
    """``[(base_k, P&L_k)]`` for the JUDGED cohorts of ONE timed day.

    A zero-amount flow is dropped. A P&L entry belongs to cohort ``bisect_right(instants,
    open)``, so a flow AT an open counts first; an overnight open (``None``) is cohort 0. The
    base telescopes: capital starts at ``prev`` and adds the flow that opens cohort ``k`` for
    ``k > 0``, then the cohort's P&L. ``prev`` is the soak's own level before the day.

    Which cohorts are judged is the founder's cohort-0 rule (Phase 229 CONTEXT, 2026-11-24, "Empty
    cohort 0"), taken from its TEXT: a cohort with no P&L is skipped when ``k > 0``, on an
    inception day, or on any day whose later cohort holds P&L; a cohort with P&L is always judged.
    So an empty cohort 0 never tests a base when something after it does (a re-fund from zero is
    measured on the deposit's cohort), and a day nothing else tests keeps its empty cohort 0."""
    flows = [(instant, amount) for instant, amount in timing.flows if amount != 0.0]
    instants = [instant for instant, _ in flows]
    cohort_pnl = [0.0] * (len(flows) + 1)
    for open_instant, cash in timing.pnl:
        k = 0 if open_instant is None else bisect.bisect_right(instants, open_instant)
        cohort_pnl[k] += cash
    capital = prev
    cohorts: list[tuple[float, float]] = []
    for k, pnl in enumerate(cohort_pnl):
        if k > 0:
            capital += flows[k - 1][1]
        later_cohort_has_pnl = any(later != 0.0 for later in cohort_pnl[k + 1 :])
        if not (pnl == 0.0 and (k > 0 or inception or later_cohort_has_pnl)):
            cohorts.append((capital, pnl))
        capital += pnl
    return cohorts


def _walk_timed_return(
    prev: float, timing: _WalkDayTiming, *, dust_nav: float, inception: bool
) -> tuple[float, str | None]:
    """The soak's own D-17 cohort return of ONE timed day, and the guard reading that broke
    it, if any: ``prod_k(1 + P_k / B_k) - 1`` over the judged cohorts.

    SPEC ONLY: ``nav_twr._judged_cohorts`` and ``_timed_day_return``, re-implemented here and
    never imported (a walk built from the arithmetic it judges agrees with it by
    construction, PITFALLS Pitfall 12).

    The judged cohorts are ``_walk_cohorts``'. A day with nothing judged is ``(nan,
    "inception_no_pnl")``; the first cohort the guard reads as broken gives ``(nan, reason)``."""
    judged = _walk_cohorts(prev, timing, inception=inception)
    if not judged:
        return math.nan, "inception_no_pnl"
    growth = 1.0
    for base, pnl in judged:
        reason = _walk_day_guard(base, pnl, dust_nav=dust_nav)
        if reason is not None:
            return math.nan, reason
        growth *= 1.0 + pnl / base
    return growth - 1.0, None


def _walk_tiny_base_days(
    levels: Sequence[tuple[str, float]], *, initial: float, days: Iterable[str]
) -> set[str]:
    """The days the soak's OWN reading names tiny-base: ``0 < base < _WALK_TINY_BASE_FRACTION *
    peak``, where ``base`` is the level before the day and ``peak`` the highest level over the
    calendar days ``d-30 .. d-1``.

    SPEC ONLY: ``services.tiny_base`` (``window_peaks`` / ``is_tiny_base``), ``broker_dailies``'
    leave-out of quiet gap-filled days and ``nav_twr``'s timed-day test, re-implemented with the
    standard library and never imported or read from ``meta["tiny_base_days"]``, which is the code
    under test's own claim. The reading is judged on the BASE BEFORE THE DAY, never on a cohort
    base. The level map is ``initial`` keyed on the day before the first level's day plus every
    ``(day, end level)`` in ``levels``; a day with no key of its own carries the last key before
    it, so the level in force at the window's first day counts (carry-in), and a window that
    starts before the first key starts at the first key. A day with no key before it is skipped
    and a non-positive base is never tiny."""
    if not levels:
        return set()
    keyed = {date.fromisoformat(levels[0][0]) - timedelta(days=1): initial}
    for level_day, level in levels:
        keyed[date.fromisoformat(level_day)] = level
    keys = sorted(keyed)
    values = [keyed[key] for key in keys]
    tiny: set[str] = set()
    for day in days:
        parsed = date.fromisoformat(day)
        end = bisect.bisect_right(keys, parsed - timedelta(days=1))
        if end == 0:
            continue
        window_first = parsed - timedelta(days=_WALK_TINY_BASE_WINDOW_DAYS)
        start = max(bisect.bisect_right(keys, window_first) - 1, 0)
        peak = max(values[start:end])
        base = values[end - 1]
        if 0.0 < base < _WALK_TINY_BASE_FRACTION * peak:
            tiny.add(day)
    return tiny


def _walk_attribution_check(
    walk: _WalkLedger,
    *,
    fold_pnl_by_day: Mapping[str, float],
    fold_flows_by_day: Mapping[str, float],
    fold_timed_days: AbstractSet[str],
) -> dict[str, Any]:
    """Compare the fold's per-day P&L, per-day flows and timed-day set with the walk's.

    A day booked on one side only is a mismatch (None for the missing side); a day on both
    sides is a mismatch when the amounts differ by more than the tolerance. Records are
    ``{"day", "kind", "expected", "actual"}``: ``expected`` is the walk's value and
    ``actual`` the fold's. Kinds: ``day_attribution_mismatch`` (trading P&L) and
    ``flow_attribution_mismatch`` (external flows). ``days_compared`` is the number of
    distinct days across all three channels.

    TIMED SET (SOAK-02, RESEARCH OQ2). A day the fold timed and the walk cannot confirm is
    ``timed_day_unconfirmed``; a day the walk times and the fold did not is
    ``timed_day_not_timed_by_fold``. Both record expected None and actual None, since the
    disagreement is the set membership, not a number.

    BLIND SPOT, stated: a zero-cash deal moved onto a day that already holds another trading
    deal on both sides changes no per-day amount, so this compare cannot see it."""
    mismatches: list[dict[str, Any]] = []

    def _compare(
        kind: str, walk_side: Mapping[str, float], fold_side: Mapping[str, float]
    ) -> None:
        for day in sorted(set(walk_side) | set(fold_side)):
            expected = walk_side.get(day)
            actual = fold_side.get(day)
            if (
                expected is None
                or actual is None
                or abs(expected - actual)
                > _WALK_ATTRIBUTION_REL_TOL * max(abs(expected), abs(actual))
                + _WALK_ATTRIBUTION_ABS_TOL
            ):
                mismatches.append(
                    {"day": day, "kind": kind, "expected": expected, "actual": actual}
                )

    _compare("day_attribution_mismatch", walk.pnl_by_day, fold_pnl_by_day)
    _compare("flow_attribution_mismatch", walk.flows_by_day, fold_flows_by_day)
    walk_timed = set(walk.timing)
    for day in sorted(walk_timed | set(fold_timed_days)):
        if day in walk_timed and day not in fold_timed_days:
            mismatches.append(
                {"day": day, "kind": "timed_day_not_timed_by_fold", "expected": None, "actual": None}
            )
        elif day not in walk_timed:
            mismatches.append(
                {"day": day, "kind": "timed_day_unconfirmed", "expected": None, "actual": None}
            )
    days = (
        set(walk.pnl_by_day)
        | set(fold_pnl_by_day)
        | set(walk.flows_by_day)
        | set(fold_flows_by_day)
        | walk_timed
        | set(fold_timed_days)
    )
    return {
        "ok": not mismatches,
        "days_compared": len(days),
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:_WALK_MAX_MISMATCHES_LISTED],
    }


def _reconcile_published_returns(
    returns: pd.Series,
    *,
    pnl_by_day: dict[str, float],
    flows_by_day: dict[str, float],
    timed_days: set[str],
    initial: float,
    floors: UnitFloors = USD_FLOORS,
    timing: Mapping[str, _WalkDayTiming] | None = None,
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
      * ``guarded``  — an untimed day the soak's own guard reading must break
        (``_walk_day_guard``: ``NAV_{t-1}`` not above the dust floor or ``|P_t|`` at least
        ``_WALK_PNL_DOM_RATIO`` times it; the inception day; or a tiny-base day, see
        ``_walk_tiny_base_days``): the published value must be NaN. The dust and inception
        floors are the ACCOUNT UNIT's (``floors``), never the USD row's, so a BTC account is
        judged in BTC. A NaN the guards do NOT explain, or a finite value where they require
        NaN, is a mismatch.
      * ``timed``    — a trading day that also has a flow, measured per cohort: ``r_t`` is a cohort return, not
        ``P_t/NAV_{t-1}``, so ``P_t/NAV_{t-1}`` does not apply. It is recomputed by the soak's
        own D-17 cohort walk (``_walk_timed_return``, on ``timing``) and compared to
        ``_RETURN_CHECK_TOL``. A day the walk reads as NaN must be published NaN
        (``timed_day_not_nan``); a day the walk reads as finite must be published finite
        (``timed_day_not_finite``) and equal to the walk (``timed_return_off_cohort_walk``); a
        timed day with no walk result is ``timed_day_not_walked``. A day that passes the exact
        compare is counted in ``timed_verified``. A timed day on a tiny base expects NaN
        whatever the cohort walk reads (production judges that on the day's starting NAV).
      * ``flat``     — a day with no deal and no flow (gap-filled): must be exactly 0.0, unless
        the soak's own reading names it tiny-base, when it must be NaN
        (``tiny_base_day_not_nan``); it stays outside the share's denominator either way.
      * ``flow_only`` — a day whose trading P&L can test no base, timed or untimed: a flow with no
        trading deal, or a trading deal that books zero cash (an opening, ``entry`` IN with profit 0).
        Untimed, that is ``|P_t|`` at most ``_RETURN_CHECK_TOL`` of the base (or of the unit's dust
        floor on a smaller one), so deals that net to float residue count here too. Timed, it is
        every cohort's P&L that small (``+x`` and ``-x`` inside one cohort test no base; split across
        two cohorts they test both) (226 review WR-05). It is judged
        exactly as the branches above judge it (0.0, or NaN under the guard or tiny reading, and the
        same mismatch kinds), because a flow booked as return is a defect. But its expected return is
        0.0 whatever the combiner does with the day's base, so it certifies nothing about trading
        returns: it is counted here, outside the numerator, the denominator and ``vacuous``, as a flat
        day is (226 review CR-01, CR-03). Every other class counts days that test a base only.

      * ``indeterminate`` — a day whose base (untimed), or any judged cohort base (timed: an empty
        cohort is skipped after the first, an empty cohort 0 is skipped on an inception day or
        whenever a later cohort holds P&L, so a judged base is one whose P&L tests it; see
        ``_walk_cohorts``), sits within float noise (``_LEVEL_NOISE_REL`` of the account's
        scale) of zero or of the unit's dust floor. The soak rolls levels forward and production
        backward, so on such a knife edge the two land on opposite sides of the threshold and an
        honest combiner can publish either NaN or the measured value. The day is accepted when the
        published value is NaN or equals the measured one (the walk read with the dust floor lowered
        by twice the noise, and no measured value on a tiny-base day, which reads NaN on both sides
        of the dust edge) to ``_RETURN_CHECK_TOL``, and anything else is judged and reported as
        before. It certifies nothing, so it is counted here and in the share's denominator, never
        in its numerator, and outside ``vacuous`` (226 review CR-04). A flat day whose prior level is within noise of zero accepts NaN or 0.0
        and stays counted as ``flat``. (226 review WR-03)

    ``tiny_base`` counts the published days the soak's own reading names tiny-base.

    Two mismatches are about the series' COVERAGE, not a day's value: ``ledger_day_not_published``
    (a day the ledger books that the series lacks, so a series truncated at either end is red) and
    ``published_day_outside_ledger`` (a published day before the first or after the last ledger day).

    ``ok`` iff there is no mismatch, ``checked > 0`` and the certified share is at or above
    ``_MIN_CHECKED_SHARE``. ``certified_share = (checked + timed_verified) / (checked + timed +
    guarded + indeterminate)``: flat and flow-only days are excluded, and a zero denominator
    gives ``None`` and is not green. A run that excluded every day certified nothing about the returns, so it is reported
    ``vacuous`` (``checked == 0``, unchanged) and is not green; the cost of that reading is that
    an account whose every active day is a flow day or an opening stays not green, and a
    ``flow_only`` day never clears it. A run that certified one day of two hundred is not green either, whatever its
    mismatch count."""
    levels = _forward_nav_levels(pnl_by_day, initial=initial, flows_by_day=flows_by_day)
    union_days = [day for day, _ in levels]
    prev_by_day: dict[str, float] = {}
    prev = initial
    for day, level in levels:
        prev_by_day[day] = prev
        prev = level
    first_union_day = union_days[0] if union_days else None
    published_days = [ts.date().isoformat() for ts in returns.index]
    tiny = _walk_tiny_base_days(levels, initial=initial, days=published_days)

    counts = {
        "checked": 0,
        "guarded": 0,
        "timed": 0,
        "timed_verified": 0,
        "flat": 0,
        "flow_only": 0,
        "indeterminate": 0,
    }
    noise = _LEVEL_NOISE_REL * max([abs(initial), *(abs(level) for _, level in levels)])

    def _near(level: float) -> bool:
        return abs(level) <= noise or abs(level - floors.dust_nav) <= noise

    mismatches: list[dict[str, Any]] = []
    max_abs_err = 0.0

    def _mismatch(day: str, kind: str, expected: float | None, actual: float) -> None:
        # NaN is not valid strict JSON, so a NaN on either side is recorded as None.
        mismatches.append(
            {
                "day": day,
                "kind": kind,
                "expected": None if expected is None or math.isnan(expected) else expected,
                "actual": None if math.isnan(actual) else actual,
            }
        )

    for ts, raw in returns.items():
        day = ts.date().isoformat()
        actual = float(raw)
        if day in timed_days:
            day_timing = None if timing is None else timing.get(day)
            if day_timing is None or day not in prev_by_day:
                # A timed day the soak cannot walk is never a silent pass.
                counts["timed" if day in pnl_by_day else "flow_only"] += 1
                _mismatch(day, "timed_day_not_walked", None, actual)
                continue
            base = prev_by_day[day]
            inception = (
                day == first_union_day
                and flows_by_day.get(day, 0.0) > 0
                and abs(base) <= floors.residual_abs_tol
            )
            # A day is judged like any other but certifies only when some cohort's P&L is large
            # enough to test its base (CR-01, CR-03, WR-05): deals that net to float residue test
            # nothing. The judged cohorts' bases are the ones a knife-edge band applies to (WR-03).
            cohorts = _walk_cohorts(base, day_timing, inception=inception)
            has_trade = any(
                abs(pnl) > _RETURN_CHECK_TOL * max(abs(b), floors.dust_nav) for b, pnl in cohorts
            )
            value, _reason = _walk_timed_return(
                base, day_timing, dust_nav=floors.dust_nav, inception=inception
            )
            if day in tiny:
                # A day that OPENED on a sliver of the peak has no return, whatever the cohorts say.
                value, _reason = math.nan, "tiny_base"
            if any(_near(b) for b, _ in cohorts):
                # A tiny-base day reads NaN on both sides of the dust edge, so it has no measured value.
                measured = (
                    math.nan
                    if day in tiny
                    else _walk_timed_return(
                        base, day_timing, dust_nav=floors.dust_nav - 2 * noise, inception=inception
                    )[0]
                )
                if math.isnan(actual) or any(
                    abs(actual - v) <= _RETURN_CHECK_TOL for v in (value, measured)
                ):
                    counts["indeterminate"] += 1
                    continue
            counts["timed" if has_trade else "flow_only"] += 1
            if math.isnan(value):
                # The walk's own guard reading says nothing was measurable: only NaN is honest.
                if not math.isnan(actual):
                    _mismatch(day, "timed_day_not_nan", value, actual)
                continue
            if not math.isfinite(actual):
                _mismatch(day, "timed_day_not_finite", value, actual)
                continue
            err = abs(actual - value)
            max_abs_err = max(max_abs_err, err)
            if err > _RETURN_CHECK_TOL:
                _mismatch(day, "timed_return_off_cohort_walk", value, actual)
            elif has_trade:
                counts["timed_verified"] += 1
            continue
        if day not in prev_by_day:
            # No deal and no flow: gap_fill_daily_returns books a flat 0.0 here.
            counts["flat"] += 1
            idx = bisect.bisect_left(union_days, day)
            if abs(levels[idx - 1][1] if idx else initial) <= noise and (
                math.isnan(actual) or actual == 0.0
            ):
                continue
            if day in tiny:
                if not math.isnan(actual):
                    _mismatch(day, "tiny_base_day_not_nan", None, actual)
            elif actual != 0.0:
                _mismatch(day, "flat_day_not_zero", 0.0, actual)
            continue

        base = prev_by_day[day]
        pnl = pnl_by_day.get(day, 0.0)
        flow = flows_by_day.get(day, 0.0)
        # A day whose P&L is zero (a flow with no trade, or a zero-cash opening) or float residue
        # (deals that net to ~1e-17) reads about `0.0 / base`, so it tests no base and certifies
        # nothing, though it is judged below (CR-01, CR-03, WR-05).
        has_trade = abs(pnl) > _RETURN_CHECK_TOL * max(abs(base), floors.dust_nav)
        inception = (
            day == first_union_day
            and flow > 0
            and abs(base) <= floors.residual_abs_tol
        )
        if not inception and _near(base):
            measured = (
                pnl / base
                if day not in tiny
                and _walk_day_guard(base, pnl, dust_nav=floors.dust_nav - 2 * noise) is None
                else math.nan
            )
            if math.isnan(actual) or abs(actual - measured) <= _RETURN_CHECK_TOL:
                counts["indeterminate"] += 1
                continue
        must_break = (
            inception
            or _walk_day_guard(base, pnl, dust_nav=floors.dust_nav) is not None
            or day in tiny
        )
        if must_break:
            counts["guarded" if has_trade else "flow_only"] += 1
            if not math.isnan(actual):
                _mismatch(day, "guarded_day_not_nan", None, actual)
            continue

        counts["checked" if has_trade else "flow_only"] += 1
        expected = pnl / base
        if not math.isfinite(actual):
            _mismatch(day, "checked_day_not_finite", expected, actual)
            continue
        err = abs(actual - expected)
        max_abs_err = max(max_abs_err, err)
        if err > _RETURN_CHECK_TOL:
            _mismatch(day, "return_off_ledger", expected, actual)

    # The loop above visits only the days the combiner chose to publish, so a day the series
    # does not carry is invisible to it. Name every ledger day the series lacks (a series cut at
    # either end would otherwise certify 100% of what is left), and refuse a published day
    # outside the ledger span, which gap_fill_daily_returns never produces (226 review CR-02).
    published = set(published_days)
    for day in union_days:
        if day not in published:
            mismatches.append(
                {"day": day, "kind": "ledger_day_not_published", "expected": None, "actual": None}
            )
    outside = [
        day for day in published_days if union_days and not union_days[0] <= day <= union_days[-1]
    ]
    if outside:
        mismatches.append(
            {
                "day": outside[0],
                "kind": "published_day_outside_ledger",
                "expected": None,
                "actual": None,
            }
        )

    vacuous = counts["checked"] == 0
    certified = counts["checked"] + counts["timed_verified"]
    denominator = (
        counts["checked"] + counts["timed"] + counts["guarded"] + counts["indeterminate"]
    )
    certified_share = certified / denominator if denominator else None
    return {
        "ok": (
            not mismatches
            and not vacuous
            and certified_share is not None
            and certified_share >= _MIN_CHECKED_SHARE
        ),
        "vacuous": vacuous,
        "certified_share": certified_share,
        "min_certified_share": _MIN_CHECKED_SHARE,
        "tiny_base": sum(1 for day in published_days if day in tiny),
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
    ``max(unit residual floor, 1e-6·|balance|)`` of the balance ($1 floor for USD) AND the combiner's published returns
    equal ``P_t/NAV_{t-1}`` on every untimed day (R2-01; the ``return_check`` block
    counts the days it excludes) AND the fold's per-day P&L and flows equal the soak's own
    walk's on every day (SOAK-03; the ``attribution_check`` block), and the uPnL wedge ``equity − balance`` gated separately at
    ``UNREALIZED_MATERIALITY_RATIO``. ``parity_ok = recon_ok AND wedge-within-
    materiality``. The timed-day set the published returns are judged by is the soak's OWN
    (``walk.timing``, RESEARCH OQ2), not the fold's: a day the two disagree on is a named
    ``attribution_check`` mismatch.

    Returns a dict with ``observation`` ("populated"/"honest_empty"/"error"/
    "unit_unresolved"), ``account_unit`` ({"code", "native"}: the unit whose floors judged
    this run, present on a populated result),
    ``parity_ok`` (True/False/None), ``recon_ok`` + ``recon_level_ok`` +
    ``return_check_ok`` + ``return_check`` + ``attribution_ok`` + ``attribution_check`` +
    ``recon_residual`` +
    ``recon_tolerance`` (the fidelity gate reported distinctly),
    ``wedge_within_materiality`` + ``upnl_wedge`` + ``wedge_materiality_ratio`` (the
    open-position exposure reported distinctly), the equity/balance anchors, the
    reconstructed terminal, the deal_count, and the combine meta flags. An
    ``Mt5ClientError`` read → observation="error", parity_ok=None (NEVER coerced to
    an empty ledger). An empty ledger → observation="honest_empty", parity_ok=None
    (INCONCLUSIVE — never green). An account currency that is blank, malformed or
    unsupported → observation="unit_unresolved", parity_ok=None, ``unit_error`` = the
    exception class name (and ``unit_code`` for an unsupported code only): INCONCLUSIVE,
    never a USD fallback, never the raw broker text. An unclassifiable DEAL_TYPE propagates
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
            # The account unit is resolved ONCE and every unit-sized read below uses its
            # floors. A currency we cannot resolve is INCONCLUSIVE, never a USD fallback.
            unit = classify_account_currency(info.get("currency"))
            equity = float(info["equity"])
            balance = float(info["balance"])
            if not (math.isfinite(equity) and math.isfinite(balance)):
                # NaN fails every threshold comparison, so a non-finite anchor must never reach
                # a verdict. Static text: account sizes are private (226 review SFH-02).
                return {
                    "observation": "error",
                    "parity_ok": None,
                    "error": {
                        "code": "account_info_not_finite",
                        "message": "account_info equity or balance is not finite",
                    },
                }
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
        except (
            AccountCurrencyBlank,
            AccountCurrencyMalformed,
            AccountCurrencyUnsupported,
        ) as exc:
            # Only the class name (and, for an unsupported currency, the code the
            # classifier already validated and upper-cased) enters the record: never the
            # exception message and never the raw broker text.
            unresolved: dict[str, Any] = {
                "observation": "unit_unresolved",
                "parity_ok": None,
                "unit_error": type(exc).__name__,
            }
            if isinstance(exc, AccountCurrencyUnsupported):
                unresolved["unit_code"] = exc.code
            return unresolved

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
            deals,
            equity,
            balance,
            server_utc_offset_s=server_utc_offset_s,
            floors=unit.floors,
        )

        # SOAK-03: the soak's OWN per-day walk of the raw deals. It shares no helper with the
        # fold above (deliberately: an oracle built from the code it judges agrees with it by
        # construction), so it supplies the independent totals, the flows and the P&L the
        # published returns are judged against.
        walk = _walk_deal_ledger(deals, server_utc_offset_s)
        total_trading_pnl = walk.total_trading_pnl
        total_flows = walk.total_flows

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
        initial = balance - walk.total_trading_pnl - walk.total_flows
        # WR-01 (FLOWTIMING): roll LEVELS, not returns — a timed day's return is a cohort
        # return, so NAV_{t-1}·(1+r_t)+F_t no longer reproduces the day. The per-day P&L is
        # the shipped fold's own (the one the combiner above consumed).
        fold_daily_pnl, fold_flows, _fold_timing = _fold_mt5_deals(
            deals, server_utc_offset_s
        )
        pnl_by_day = {
            ts.date().isoformat(): float(value) for ts, value in fold_daily_pnl.items()
        }
        fold_flows_by_day: dict[str, float] = {}
        for flow in fold_flows:
            fold_flows_by_day[flow.utc_day_iso] = (
                fold_flows_by_day.get(flow.utc_day_iso, 0.0) + flow.usd_signed
            )
        # The level roll keeps the FOLD's P&L (a fold that drops a deal lands off balance);
        # the walk supplies the flows and, through ``initial``, the independent totals.
        reconstructed = _forward_terminal_nav(
            pnl_by_day, initial=initial, flows_by_day=walk.flows_by_day
        )
        # R2-01: the level roll above reads no return, so on its own it passes for ANY
        # published series. Tie the combiner's returns to the ledger on the days the return
        # identity holds; the excluded days are counted in the record, never dropped.
        return_check = _reconcile_published_returns(
            returns,
            pnl_by_day=walk.pnl_by_day,
            flows_by_day=walk.flows_by_day,
            timed_days=set(walk.timing),
            initial=initial,
            floors=unit.floors,
            timing=walk.timing,
        )
        # SOAK-03: the fold's per-day P&L and flows against the walk's, day by day.
        attribution_check = _walk_attribution_check(
            walk,
            fold_pnl_by_day=pnl_by_day,
            fold_flows_by_day=fold_flows_by_day,
            fold_timed_days={ts.date().isoformat() for ts in _fold_timing},
        )

        # WR-01: the realized ledger reconstructs the BALANCE (not equity — the
        # terminal self-updates to ``anchor − open_unrealized_usd == balance``,
        # nav_twr.py:836), so FIDELITY is reconstructed-vs-balance under the tight
        # 136-03 tolerance. This level check catches a fold that drops or double counts a
        # deal; by itself it is blind to the published returns (R2-01), which is why
        # ``return_check`` above is a second, separate condition of ``recon_ok``.
        recon_tolerance = _parity_tolerance(balance, unit.floors)
        recon_residual = reconstructed - balance
        recon_level_ok = abs(recon_residual) <= recon_tolerance
        # Fidelity needs the level roll, the published returns AND the per-day attribution.
        recon_ok = (
            recon_level_ok and bool(return_check["ok"]) and bool(attribution_check["ok"])
        )

        # The uPnL wedge (equity − balance) is the LEGITIMATE open-position exposure
        # — NEVER a reconstruction error. Gate it SEPARATELY at the SHIPPED 136
        # materiality ratio (|wedge|/anchor, anchor=equity floored at the ACCOUNT UNIT's
        # dust, unlike nav_twr's ``unrealized_pnl_in_anchor``, which skips a dust anchor)
        # so an open-position account is no longer false-FAILed as a reconstruction
        # breach, and a MATERIAL wedge is surfaced distinctly rather than folded into
        # the fidelity residual.
        wedge = equity - balance
        # No dust escape: "equity too small to divide by" is not a reason to pass the oracle (a
        # stop-out leaves sub-dust equity over a large balance). The denominator is floored at the
        # unit's dust instead, so the test stays defined and a large wedge over it is material.
        wedge_material = abs(wedge) > UNREALIZED_MATERIALITY_RATIO * max(
            abs(equity), unit.floors.dust_nav
        )

        # PASS iff BOTH: reconstruction fidelity holds AND the wedge is within
        # materiality. A material wedge does not certify a green soak run (it must
        # not exit-0 green) but is distinguished from a fidelity FAIL in the record.
        parity_ok = recon_ok and not wedge_material

        return {
            "observation": "populated",
            "account_unit": {"code": unit.code, "native": unit.native},
            "parity_ok": parity_ok,
            "recon_ok": recon_ok,
            "recon_level_ok": recon_level_ok,
            "return_check_ok": return_check["ok"],
            "return_check": return_check,
            "attribution_ok": attribution_check["ok"],
            "attribution_check": attribution_check,
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
