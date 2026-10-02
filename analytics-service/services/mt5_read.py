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
lets its exceptions out UNCHANGED in type. Five are reachable through a call:

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
in-tree imports are ``services.mt5_client``, ``services.mt5_concurrency`` and
``services.mt5_probe``. ⛔ It MUST NEVER import ``services.job_worker`` — nor
anything that does — because ``job_worker`` imports IT. That is also why the two
deal-fetch margin constants below MOVED here out of ``job_worker`` rather than
being imported back from it: importing them from their old home would have closed
exactly that cycle.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Final

from services.mt5_client import Mt5ClientError, Mt5Session
from services.mt5_concurrency import _Mt5PostReadVerificationError
from services.mt5_probe import assert_expected_login

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


def read_mt5_deal_ledger(
    session: Mt5Session, *, now: datetime
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Log in and read the FULL deal history, bracketed by the MT5CONC-02 login
    assertions. Returns ``(pre_account_info, deals)``.

    ONE synchronous read block: login → account_info → history_deals_get over the
    FULL history (epoch 0 → ``now`` + one day margin so a same-day deal near the
    boundary is never clipped) → an assertion-only account_info re-read. Each
    round-trip is already rpyc-bounded inside ``Mt5Client``; the caller's own
    ``asyncio.wait_for`` is what catches a hang OUTSIDE a bounded call, and the
    caller's ``mt5_terminal_lease`` is what serializes the terminal-IPC region.

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
    deals = session.client.history_deals_get(
        0, int(now.timestamp()) + _MT5_DEAL_FETCH_MARGIN_S
    )
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
    return info, deals
