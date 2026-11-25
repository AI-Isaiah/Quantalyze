"""Phase 164.5.4 / D-01 — the ONE MT5 deal-ledger read, shared by every job that
needs it.

Until this module existed, the login → PRE bracket → ``history_deals_get`` → POST
bracket sequence lived as a closure inside ``run_derive_broker_dailies_job``. The
full-backfill job (``services/equity_reconstruction.py``) needs the SAME read, and
a second hand-written copy is exactly the drift this extraction exists to prevent:
the repo already carries THREE hand-written copies of the login bracket alone
(``mt5_probe.assert_expected_login``, this module's caller, and
``services/allocator_positions.py``) to show what that looks like in practice.

⛔ THIS MODULE DECIDES NOTHING ABOUT WHAT A FAILURE MEANS. It performs the read and
lets its exceptions out UNCHANGED in type. Six are reachable through a call:

  * ``Mt5AccountMismatchError`` — either login bracket rejected the terminal's
    account. Deliberately NOT an ``Mt5ClientError``, so no classify/stamp arm can
    absorb a mis-routed terminal into a credential verdict.
  * ``_Mt5PostReadVerificationError`` — a transport blip on the ASSERTION-ONLY POST
    re-read, after the correct account's deals were already fetched. Also
    deliberately not an ``Mt5ClientError`` (IN-01).
  * ``Mt5ClientError`` — a login rejection or a transport fault on the economic
    read. Its message is secret-scrubbed at construction.
  * ``Mt5SessionAbandoned`` — the WIZFORM-ABANDON fence refused a read whose lease
    had already ended.
  * ``asyncio.TimeoutError`` — produced by the CALLER'S own ``asyncio.wait_for``
    bound, never by this module; named here because it is part of the set every
    caller must answer.
  * ``Mt5HistoryUnsettledError`` — (164.6.6.3 / D-04, D-06) a FRESH login's deal
    history had not settled when the wait budget ran out, under material equity.
    A PLAIN ``Exception`` on purpose: an ``Mt5ClientError`` would be classified as
    a credential verdict, a ``TimeoutError`` would restart a healthy terminal.

⛔ The DISPOSITIONS stay at each call site, and that is the point of the split: the
derive job restarts the terminal on a timeout but deliberately does NOT on a fence
refusal, never stamps on a mismatch, and routes ``Mt5ClientError`` through
``classify_mt5_login_error``; the backfill job answers some of them DIFFERENTLY. A
helper that chose for them would have to be forked the first time they disagreed.

Also NOT here, deliberately, for the same reason: the per-terminal lease
(``mt5_terminal_lease``), the wall-clock bound (``asyncio.wait_for`` /
``_MT5_DERIVE_READ_TIMEOUT_S``) and the bounded terminal restart. This function is
SYNCHRONOUS and BLOCKING — the caller is what runs it off the event loop and what
bounds it.

Leaf-module invariant (mirrors the ``mt5_concurrency.py`` / ``mt5_probe.py``
convention, and the Phase 151 precedent this move follows): this module's only
in-tree imports are ``services.account_unit`` (itself a leaf), ``services.mt5_client``,
``services.mt5_concurrency``, ``services.mt5_handover`` (225-20: the site literal and the
holder normaliser the verdict line uses) and ``services.mt5_probe``. ⛔ It MUST NEVER import ``services.job_worker`` — nor
anything that does — because ``job_worker`` imports IT. That is also why the two
deal-fetch margin constants below MOVED here out of ``job_worker`` rather than
being imported back from it: importing them from their old home would have closed
exactly that cycle.
"""
from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Final, NamedTuple

from services.account_unit import (
    AccountCurrencyBlank,
    AccountCurrencyMalformed,
    AccountCurrencyUnsupported,
    classify_account_currency,
)
from services.mt5_client import (
    Mt5ClientError,
    Mt5ServerTickTimes,
    Mt5Session,
    note_mt5_history_settled,
)
from services.mt5_concurrency import (
    _MT5_HISTORY_POLL_S,
    _MT5_HISTORY_STABLE_INTERVALS,
    _MT5_HISTORY_WAIT_S,
    _Mt5PostReadVerificationError,
)
from services.mt5_handover import SITE_DERIVE, normalize_mt5_holder
from services.mt5_probe import assert_expected_login, normalise_mt5_server

logger = logging.getLogger("quantalyze.analytics.mt5_read")

# WR-02 — MT5 deal-fetch upper-bound margin. ``history_deals_get``'s upper bound is
# built from UTC ``now``, but MT5 deal ``time`` values are in the broker's SERVER
# timezone (``mt5_deals.deal_utc_day`` is the ONE server-time→UTC correction seam).
# A server AHEAD of UTC stamps a just-happened deal with an epoch LATER than UTC
# ``now``, so without a margin that same-day deal would fall past the upper bound
# and be silently CLIPPED from the ledger → under-counted terminal PnL → a wrong
# (but plausible) series. The margin MUST cover the maximum plausible
# server-ahead-of-UTC offset; real MT5 brokers sit within ±13h of UTC. The assert
# ties the (deliberately generous, one full day) margin to that offset bound so a
# future edit that tightens the window to "avoid fetching the future" can never
# silently make it too tight to survive a same-day deal on an ahead-of-UTC server.
#
# ⭐ 164.5.4 — MOVED here from ``job_worker`` with the read they bound, and
# RE-IMPORTED there so ``jw._MT5_DEAL_FETCH_MARGIN_S`` /
# ``jw._MT5_MAX_SERVER_UTC_OFFSET_S`` still resolve for the existing regression
# that reads them through that module alias.
_MT5_MAX_SERVER_UTC_OFFSET_S: Final[int] = 13 * 3600  # ±13h — the real-broker bound
_MT5_DEAL_FETCH_MARGIN_S: Final[int] = 86_400  # one full day
assert _MT5_DEAL_FETCH_MARGIN_S >= _MT5_MAX_SERVER_UTC_OFFSET_S, (
    "MT5 deal-fetch margin must cover the max server-UTC offset so a same-day "
    "server-time deal is never clipped by the UTC-based upper bound (WR-02)"
)

# Phase 164.6.6.3 / D-04 — the settle loop's clock and sleep. Module attributes
# ONLY so a test can drive the wait budget without waiting it (the
# `mt5_relogin._clock` / `_sleep` precedent): production never rebinds them. A real
# clock in a never-settling test would busy-spin the whole budget (RESEARCH
# Pitfall 1), a real sleep would add a poll interval to every fresh-login test.
_clock: Callable[[], float] = time.monotonic
_sleep: Callable[[float], None] = time.sleep


def _tick_read_now() -> datetime:
    """The worker's UTC now, taken immediately after the server-tick crossing
    returns (155.1 / D-08). Module level so a test can pin the instant. The
    caller's own ``now`` dates from before the lease and is far too stale for a
    5 s residual bound."""
    return datetime.now(timezone.utc)


class Mt5DealLedgerRead(NamedTuple):
    """What ``read_mt5_deal_ledger`` returns: the PRE ``account_info``, the deals
    and the server-clock tick read taken between the deal read and the POST
    bracket (155.1 / D-06, D-20(d)).

    ``tick`` is ``None`` exactly when ``tick_read_failed`` is True (the tick call
    raised ``Mt5ClientError``, D-20(b)). ``tick_read_at`` is the worker's UTC now
    right after that crossing, the instant the offset is measured against."""

    info: dict[str, Any]
    deals: list[dict[str, Any]]
    tick: Mt5ServerTickTimes | None
    tick_read_failed: bool
    tick_read_at: datetime


class Mt5HistoryUnsettledError(Exception):
    """A fresh login's deal history had NOT settled when the wait budget ended,
    and the account's equity is material (164.6.6.3 / D-06, D-13).

    A PLAIN ``Exception``, deliberately and for two separate reasons:

    * never an ``Mt5ClientError`` — ``classify_mt5_login_error`` would turn it
      into a credential verdict and stamp a working key permanently failed;
    * never a ``TimeoutError`` — the derive timeout arm RESTARTS the terminal, and
      restarting a healthy terminal would kill the very download being waited for.

    It carries counts and a boolean ONLY: no equity amount, login or server.
    """

    def __init__(self, deal_count: int, material: bool) -> None:
        super().__init__("mt5 deal history did not settle within its wait budget")
        self.deal_count = deal_count
        self.material = material


def _settle_deal_history(
    session: Mt5Session,
    info: dict[str, Any],
    first: list[dict[str, Any]],
    *,
    now: datetime,
) -> tuple[list[dict[str, Any]], bool]:
    """Re-read ``history_deals_get`` until the count is STABLE (D-04), or raise.
    Returns ``(deals, settled)``: ``settled`` is False only on the equity skip below,
    where nothing was proven about the history.

    Settled = the same count across `_MT5_HISTORY_STABLE_INTERVALS` consecutive FULL
    poll intervals (three equal reads, WR-02) AND (that count is above zero OR
    equity is not material). A count stable at zero under material equity is NOT
    settled: Finding C measured exactly that, two empty reads a second apart on a
    funded account whose history MT5 had not yet downloaded.

    Reads are only ever compared a full `_MT5_HISTORY_POLL_S` apart (CR-01): the
    deadline is checked BEFORE each sleep, so a tail that cannot fit a whole
    interval raises instead of comparing two near-simultaneous reads.

    The equity comes from the PRE ``account_info`` already in hand. ⛔ This loop
    never calls ``account_info`` itself: the POST bracket is the only re-read, and
    the test doubles' ``second_account`` / ``post_read_exc`` mean exactly that.

    An absent, non-numeric or non-finite equity skips the wait and returns the
    first read untouched, NOT settled: the callers' existing step-(c) guards fail
    loud on it.

    ⭐ 164.6.6.2 / D-07 — materiality is the account's OWN unit's: ``info["currency"]``
    is classified here and ``abs(equity) > unit.floors.material_equity`` decides, so a
    funded 0.1 BTC login waits for its history exactly as a funded 5000 USD one does
    (the USD floor of 100 read 0.1 BTC as "immaterial" and returned an empty ledger as
    if it were the account's history). A blank, malformed or unsupported currency skips
    the wait exactly like the absent-equity skip: the caller refuses on the same
    currency right after, so no wait is spent on an account that cannot be derived.

    On expiry it RAISES and returns nothing: never a partial ledger, never an
    invented deal.
    """
    try:
        equity = float(info["equity"])
    except (KeyError, TypeError, ValueError):
        return first, False
    if not math.isfinite(equity):
        return first, False
    try:
        unit = classify_account_currency(info.get("currency"))
    except (AccountCurrencyBlank, AccountCurrencyMalformed, AccountCurrencyUnsupported):
        return first, False
    material = abs(equity) > unit.floors.material_equity
    deadline = _clock() + _MT5_HISTORY_WAIT_S
    previous = len(first)
    stable_intervals = 0
    while True:
        # CR-01: expiry is decided BEFORE the sleep, and a sleep is only ever a
        # FULL poll interval. The loop used to shorten its last sleep to the time
        # left, so its final comparison could be two reads taken almost back to
        # back; a history that is still downloading looks stable across such a
        # gap, and the loop settled on a partial ledger. If a full interval no
        # longer fits, the history did not settle: raise, never compare.
        if _clock() + _MT5_HISTORY_POLL_S > deadline:
            raise Mt5HistoryUnsettledError(previous, material)
        _sleep(_MT5_HISTORY_POLL_S)
        deals = session.client.history_deals_get(
            0, int(now.timestamp()) + _MT5_DEAL_FETCH_MARGIN_S
        )
        count = len(deals)
        # WR-02: ONE equal pair is not proof. A fresh login can be served the
        # account's stale on-disk cache first while the delta is still on its way,
        # and a chunked download can pause for longer than one interval; both repeat
        # a count that is not the history. Settled is the count holding across
        # `_MT5_HISTORY_STABLE_INTERVALS` consecutive full intervals. A zero count
        # under material equity never counts as stable (Finding C), and any change
        # restarts the run.
        if count == previous and (count > 0 or not material):
            stable_intervals += 1
            if stable_intervals >= _MT5_HISTORY_STABLE_INTERVALS:
                return deals, True
        else:
            stable_intervals = 0
        previous = count


def log_mt5_poll_server_verdict(
    info: dict[str, Any],
    *,
    requested_server: str,
    site: str,
    holder: str | None,
) -> bool | None:
    """Write ONE INFO line saying whether the terminal's session is on the broker
    server the poll asked for, and return that verdict.

    LOG-ONLY BY DESIGN (Phase 225 plan 20 / PR-2c0). CONTEXT Q6 item 2 (founder
    ruling 2026-11-25): a connect on the same broker with the wrong server must be
    refused at connect or validation time, and the gap plans "confirm by
    measurement" that the existing validation already refuses it. Review WR-01
    found the three poll reads check the login only and then stamp what they read.
    PR-2c's ``assert_expected_server`` fails CLOSED on a mismatch AND on a missing
    server, and it has never been measured whether ``account_info().server`` is
    spelled the way the session requested it, for any broker. This line is that
    measurement. The REFUSAL belongs to the follow-up plan that 225-20 Task 3
    books, because it needs PR-2c's error type; nothing here refuses a poll,
    raises, or changes what a poll returns or stamps.

    The MT5 docs say ``account_info()`` returns a named tuple with ``login`` and
    ``server`` fields (https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py)
    and that ``login()``'s ``server`` is "the server name as it is specified in the
    terminal" and optional (https://www.mql5.com/en/docs/python_metatrader5/mt5login_py).
    Neither page says the two spellings are equal; that is what this line records.

    The predicate mirrors PR-2c's: a reported server that is a ``str`` with a
    non-blank ``strip()`` is compared with the requested one through
    ``normalise_mt5_server`` (True or False). An absent, non-string or blank server
    is ``not_captured`` (None), which is what PR-2c's bracket would refuse.

    The line is a static message plus ``site``, the lease ``holder`` (through
    ``normalize_mt5_holder``: a UUID key id or a literal, never a number) and the
    verdict. ⛔ It carries NO login, broker server or password value, so an operator
    maps a line to a key through the holder and a read-only database query. The
    function is total over every shape of ``info["server"]`` (a dict lookup and a
    string compare cannot raise) and does not mutate ``info``.
    """
    reported = info.get("server")
    verdict: bool | None
    if isinstance(reported, str) and reported.strip():
        verdict = normalise_mt5_server(reported) == normalise_mt5_server(requested_server)
    else:
        verdict = None
    logger.info(
        "mt5 poll server verdict site=%s holder=%s session_server_matches_requested=%s",
        site,
        normalize_mt5_holder(holder),
        "not_captured" if verdict is None else verdict,
    )
    return verdict


def read_mt5_deal_ledger(
    session: Mt5Session,
    *,
    now: datetime,
    settle_history: bool = False,
    holder: str | None = None,
) -> Mt5DealLedgerRead:
    """Log in and read the FULL deal history, bracketed by the MT5CONC-02 login
    assertions. Returns ``Mt5DealLedgerRead(info, deals, tick, tick_read_failed,
    tick_read_at)``: the PRE ``account_info``, the deals, and (155.1) one
    server-clock tick read taken inside the PRE/POST bracket.

    ⭐ 164.6.6.3 / D-04 — ``settle_history=True`` is for a FRESH login (the caller
    decides, BEFORE ``login()``, via ``mt5_client.mt5_history_wait_due``): MT5
    downloads a new account's history after authorization, so the first
    ``history_deals_get`` can come back short or empty. With it, the deal read
    repeats until the count is stable, inside the POST bracket, or raises
    ``Mt5HistoryUnsettledError`` when ``_MT5_HISTORY_WAIT_S`` runs out under
    material equity, where materiality is decided from the account's own currency
    (164.6.6.2 / D-07: no floor is passed in any more). ``settle_history=False`` is today's
    single read, byte-for-byte. The helper still decides NOTHING about what the
    raise means: the caller disposes.

    ONE synchronous read block: login → account_info → history_deals_get over the
    FULL history (epoch 0 → ``now`` + one day margin so a same-day deal near the
    boundary is never clipped) → an assertion-only account_info re-read. Each
    round-trip is already rpyc-bounded inside ``Mt5Client``; the caller's own
    ``asyncio.wait_for`` is what catches a hang OUTSIDE a bounded call, and the
    caller's ``mt5_terminal_lease`` is what serializes the terminal-IPC region.

    ⭐ 225-20 — ``holder`` is the lease holder (the key id), used ONLY for the
    one server-verdict line this read writes (``log_mt5_poll_server_verdict``).

    ⛔ It is BLOCKING (``Mt5Client`` is blocking RPyC). Run it off the event loop.
    """
    session.client.login(
        session.login,
        session.investor_password,
        session.server,
    )
    info = session.client.account_info()  # None→typed raise
    # None (error) is a typed raise inside the client; () → [] honest
    # empty. NO fabricated flat account can enter here.
    # PRE-read login bracket (MT5CONC-02): refuse the read before the
    # deal fetch if the terminal is on the wrong account.
    #
    # ⭐ 164.5.4 — this calls the SHARED ``mt5_probe.assert_expected_login`` rather
    # than a local closure. Its contract is the one this read has always had:
    # STRICT equality, a MISSING "login" field FAILS LOUD and never default-matches
    # (Pitfall 3), and a mismatch is a mis-routed/stale-terminal INFRA fault →
    # ``Mt5AccountMismatchError`` (NOT an ``Mt5ClientError``, so the classify/stamp
    # arm can never absorb it) → the caller's dedicated no-stamp/no-persist branch.
    assert_expected_login(info, login=session.login)
    # ⭐ 225-20 (PR-2c0) — LOG-ONLY server verdict on the snapshot whose login the
    # bracket above just accepted. PRE only, so one line means one poll; the POST
    # bracket below is unchanged (it belongs to the follow-up enforcement plan).
    # The derive branch in job_worker is the only production caller
    # (``git grep -n read_mt5_deal_ledger -- analytics-service/services`` at planning
    # time: outside this module the code references are job_worker's import and the
    # derive's ``asyncio.to_thread`` call, which passes the function without calling
    # it; every other hit is a comment), so a second caller must add a site argument.
    log_mt5_poll_server_verdict(
        info, requested_server=session.server, site=SITE_DERIVE, holder=holder
    )
    deals = session.client.history_deals_get(
        0, int(now.timestamp()) + _MT5_DEAL_FETCH_MARGIN_S
    )
    settled = False
    if settle_history:
        # D-04: the poll window sits BEFORE the POST bracket, so the POST bracket
        # also covers it (a mid-wait re-login by another actor is still caught).
        deals, settled = _settle_deal_history(session, info, deals, now=now)
    # ⭐ Phase 155.1 / D-06, D-20(b), D-20(d) — ONE server-clock tick read, on the
    # same session, after the deal read and the settle loop and BEFORE the POST
    # bracket below, so a mid-read re-login by another actor is caught for the
    # reading exactly as it is for the deals: a reading can never be attributed
    # to the wrong key. ONLY this call is wrapped, and only for `Mt5ClientError`:
    # a failed tick read is `unmeasured` / `tick_read_failed` and must never reach
    # the derive's credential classify arm (a scrubbed terminal text could match
    # an auth phrase and permanently fail a working key). Transport timeouts INSIDE
    # the crossing ARE converted to `Mt5ClientError` by `_guarded_read`, so they
    # land here as `tick_read_failed`. Only `Mt5SessionAbandoned`,
    # `Mt5AccountMismatchError` and the caller's outer `asyncio.TimeoutError` are
    # not `Mt5ClientError` and propagate untouched. The WARNING names the stage
    # and the exception's integer `code` (0 for a converted transport fault, the
    # far side's `last_error()` code for an unanswered listing) so those causes
    # are distinguishable: never the text, never a server value (D-17).
    tick: Mt5ServerTickTimes | None
    try:
        tick = session.client.server_tick_times()
        tick_read_failed = False
    except Mt5ClientError as exc:
        tick = None
        tick_read_failed = True
        logger.warning(
            "mt5 server tick read failed (stage=server_tick_times code=%s) — the "
            "clock reading is unmeasured, the read continues (155.1 / D-20(b))",
            getattr(exc, "code", None),
        )
    tick_read_at = _tick_read_now()
    # POST-read login bracket (MT5CONC-02): re-read account_info and
    # re-assert, catching a mid-read terminal re-login by another actor
    # (the cross-process net for the module-level lock's documented
    # cross-replica gap). The PRE info stays the returned economic
    # anchor (equity/balance byte-preserved from 136); this POST read is
    # assertion-only and its dict is discarded.
    # IN-01: the re-read is ASSERTION-ONLY — the correct account's deals
    # were already fetched. A transient transport blip HERE
    # (Mt5ClientError) is a retry-worthy verification gap, NOT a
    # credential fault, so re-signal it as a distinct transient-only type
    # rather than let it flow into the permanent-stamp classify arm. Only
    # the account_info() CALL is wrapped; a real mismatch still raises
    # Mt5AccountMismatchError from the assertion below, so the
    # never-stamp-the-wrong-account guarantee is untouched.
    try:
        post_info = session.client.account_info()
    except Mt5ClientError as exc:
        raise _Mt5PostReadVerificationError(str(exc)) from exc
    assert_expected_login(post_info, login=session.login)
    if settled:
        # D-15: ONLY a history that was stable AND whose POST bracket passed makes
        # this key cached on this terminal. Never on a single read, the equity
        # skip, or any raise above.
        note_mt5_history_settled(session.client.terminal_key)
    return Mt5DealLedgerRead(
        info=info,
        deals=deals,
        tick=tick,
        tick_read_failed=tick_read_failed,
        tick_read_at=tick_read_at,
    )
