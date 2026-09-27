"""Venue account identity, read from responses the key validator already holds.

Phase 167.1.2 (D-01, success criterion 1). One exchange account behind two live
keys is summed twice by every consumer that adds keys together. The database
already refuses a second live key on one account
(``api_keys_user_exchange_venue_account_uniq``), but only when
``api_keys.venue_account_id`` is written, and nothing wrote it for a ccxt venue.
This module is the one place that knows WHERE each venue puts its account id.

Sources, one per venue, all from a call the validator already makes:

    okx      GET /api/v5/account/config        -> data[0].uid
    bybit    GET /v5/user/query-api            -> result.userID  (never parentUid:
                                                  a sub-account has its own userID)
    binance  fetch_balance() info (spot)       -> uid
    deribit  fetch_balance({"extended": True}) -> info.id  (absent without extended)

Contract of :func:`venue_account_id_from`:

- Total, and no I/O beyond the one WARNING below. It never raises: a missing
  or wrongly typed container yields ``None``.
- Never returns ``''``. A blank or whitespace value is ``None``, because a blank
  identity is non-NULL to the partial unique index and would collapse two
  different accounts into one (the ``api_keys_venue_account_id_nonblank`` CHECK
  refuses it too).
- Never lowercases. Venue ids are numeric or opaque, and case is part of them.
- Only a ``str`` or an ``int`` counts as an id. ``bool`` is an ``int`` subclass in
  Python and is refused explicitly, so a flag can never pass for an account.
- Never returns an id over :data:`MAX_VENUE_ACCOUNT_ID_LENGTH` (128) UTF-16 code
  units after trimming, the cap ``src/lib/analytics-schemas.ts`` enforces. An
  over-long id is ``None`` and the one side effect is a WARNING naming the
  venue, never the value (review round 2, SF2-M1).
- ⛔ The value is an account identifier. Callers must never log it or put it in
  error copy. It leaves the service only as the ``venue_account_id`` field of
  the validate response.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any, Final, Literal

import ccxt
import httpx
from postgrest.exceptions import APIError

from services.db import _is_gateway_timeout, db_execute
from services.redact import scrub_freeform_string
from services.stitch_composite import MemberWindow, windows_overlap

__all__ = [
    "ACCOUNT_IDENTITY_UNIQUE_INDEX",
    "COMPOSITE_MEMBER_SHARED_ACCOUNT",
    "DUPLICATE_DETECTED_AUDIT_ACTION",
    "MAX_VENUE_ACCOUNT_ID_LENGTH",
    "StampOutcome",
    "VENUES_WITH_ACCOUNT_ID",
    "read_venue_account_id",
    "stamp_account_identity",
    "venue_account_id_from",
]

logger = logging.getLogger("quantalyze.analytics")

# The ccxt venues whose validator responses carry an account id. A validation
# on one of these that yields no id is venue schema drift, logged by the
# validator (venue named, value never). sFOX and MT5 are deliberately absent.
VENUES_WITH_ACCOUNT_ID: frozenset[str] = frozenset({"okx", "bybit", "binance", "deribit"})


# The same cap as ``ValidateKeyResponseSchema.venue_account_id`` in
# src/lib/analytics-schemas.ts (``.trim().min(1).max(128)``). An id the seam
# refuses connects the key UNSTAMPED, so the service never sends one: it
# answers None, as for a venue that reports no id. zod measures a JS string's
# ``.length``, in UTF-16 code units, so this does too. Change both together.
MAX_VENUE_ACCOUNT_ID_LENGTH: Final = 128


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def _normalise(value: object, venue: str) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    if _utf16_length(text) > MAX_VENUE_ACCOUNT_ID_LENGTH:
        # ⛔ The venue only. The value is an account identifier.
        logger.warning(
            "account_identity: venue %s answered a venue_account_id over %d "
            "characters; treated as no id, so the key is not checked for a "
            "duplicate",
            venue, MAX_VENUE_ACCOUNT_ID_LENGTH,
        )
        return None
    return text or None


def _child(container: object, key: str) -> object:
    if isinstance(container, Mapping):
        return container.get(key)
    return None


def venue_account_id_from(venue: str, raw: Mapping[str, Any]) -> str | None:
    """Return the venue account id carried by ``raw``, or ``None``.

    ``raw`` is the venue response named in the module docstring for ``venue``:
    the OKX ``account/config`` body, the Bybit ``query-api`` body, or the
    ``info`` dict of a Binance or Deribit ``fetch_balance`` result. Any other
    venue answers ``None``: sFOX has no known account id (D-10) and MT5's
    identity is its login, handled by the Next route.
    """
    if not isinstance(raw, Mapping):
        return None
    if venue == "okx":
        data = raw.get("data")
        if not isinstance(data, list) or not data:
            return None
        return _normalise(_child(data[0], "uid"), venue)
    if venue == "bybit":
        return _normalise(_child(raw.get("result"), "userID"), venue)
    if venue == "binance":
        return _normalise(raw.get("uid"), venue)
    if venue == "deribit":
        return _normalise(raw.get("id"), venue)
    return None


# ---------------------------------------------------------------------------
# The backfill stamper (plan 04, D-01 / D-11, RESEARCH Pattern 4 and Pitfall 4)
# ---------------------------------------------------------------------------
#
# Plan 02 stamps a key connected from now on. A key connected before it carries
# a NULL ``venue_account_id``, so the unique index cannot see it. The daily poll
# already holds every live key's decrypted session, so the poll stamps the id
# here, once per key, with one venue call.
#
# ⛔ What this step may write: ``venue_account_id``,
# ``account_shared_with_api_key_id`` and ``account_share_kind``. Nothing else.
# It never touches ``sync_status``, ``sync_error``, ``disconnected_at`` or
# ``is_active``, it never disconnects or deletes a key (D-01), and it never
# raises into the poll (Pitfall 4): a stamp failure must not blame the user's
# key or change the poll's outcome. It logs the key id, the venue and an
# outcome token, never the id value.

# The partial unique index the stamp can hit (a live sibling of the same owner
# already holds this exchange account). Matched against the error MESSAGE only,
# which names the constraint; the DETAIL echoes the id value and is never read
# or logged.
ACCOUNT_IDENTITY_UNIQUE_INDEX: Final = "api_keys_user_exchange_venue_account_uniq"

_PG_UNIQUE_VIOLATION: Final = "23505"

# A logged error message is bounded, so a pathological one cannot flood a line.
_MAX_LOGGED_MESSAGE: Final = 200

StampOutcome = Literal[
    "skipped_not_ccxt",
    "skipped_already_stamped",
    "skipped_no_budget",
    "stamped",
    "marked_duplicate",
    "marked_composite_member",
    "no_id",
    "error",
]


async def read_venue_account_id(exchange: Any, venue: str) -> str | None:
    """Make the ONE venue call ``venue`` needs and return its account id.

    The same sources the validator reads (module docstring): OKX
    ``account/config``, Bybit ``query-api``, the Binance spot balance ``info``
    and the Deribit ``fetch_balance({"extended": True})`` ``info``. Raises
    whatever the venue call raises; :func:`stamp_account_identity` is the
    never-raising boundary. Any other venue answers ``None`` with no call.
    """
    if venue == "okx":
        raw: object = await exchange.private_get_account_config()
    elif venue == "bybit":
        raw = await exchange.private_get_v5_user_query_api()
    elif venue == "binance":
        balance = await exchange.fetch_balance()
        raw = balance.get("info") if isinstance(balance, Mapping) else None
    elif venue == "deribit":
        balance = await exchange.fetch_balance({"extended": True})
        raw = balance.get("info") if isinstance(balance, Mapping) else None
    else:
        return None
    if not isinstance(raw, Mapping):
        return None
    return venue_account_id_from(venue, raw)


def _error_code(exc: BaseException) -> str | None:
    """The error's SQLSTATE or gateway code as a string, or ``None``.

    Review round 2 (WR-01): a Supabase gateway 504 can carry an int ``code``
    (``services.db._is_gateway_timeout`` checks both types), and a str-only
    read logged it as ``code=None``. ``bool`` is an ``int`` and is refused.
    """
    code = getattr(exc, "code", None)
    if isinstance(code, bool) or not isinstance(code, (str, int)):
        return None
    return str(code)


def _names_identity_index(exc: BaseException) -> bool:
    message = getattr(exc, "message", None)
    return isinstance(message, str) and ACCOUNT_IDENTITY_UNIQUE_INDEX in message


def _first_row(res: object) -> dict[str, Any] | None:
    data = getattr(res, "data", None)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return None


async def _find_live_holder(
    supabase: Any, key_row: Mapping[str, Any], account_id: str
) -> dict[str, Any] | None:
    """The live key of the same owner that holds ``account_id`` on this venue.

    Filtered by ``user_id`` so a holder can never be another tenant's key
    (T-167.1.2-18); the database trigger refuses that too.
    """

    def _q() -> object:
        return (
            supabase.table("api_keys")
            .select("id")
            .eq("user_id", key_row["user_id"])
            .eq("exchange", key_row["exchange"])
            .eq("venue_account_id", account_id)
            .is_("disconnected_at", "null")
            .neq("id", key_row["id"])
            .limit(1)
            .execute()
        )

    return _first_row(await db_execute(_q))


# D-04 (167.1.2-CONTEXT, measured in code by the planner at 83eae5da5): two
# members of ONE composite strategy may read ONE exchange account. The composite
# key-add RPC mints a fresh api_keys row per member and writes no identity, each
# member carries a declared half-open [window_start, window_end) in
# strategy_keys, the stitch requires those windows to be pairwise disjoint, and
# nothing disconnects a member whose window has closed. A disjoint pair on one
# account is therefore a key rotation inside a composite: legitimate, NOT a
# duplicate. The stamper names it with this kind instead, emits no duplicate
# audit event, and the allocator book counts that account once, through the
# holder. The overlap test is stitch_composite.windows_overlap, the one
# canonical predicate; it is never re-implemented here.
COMPOSITE_MEMBER_SHARED_ACCOUNT: Final = "composite_member"
_DUPLICATE: Final = "duplicate"

# The audit action for a key newly marked 'duplicate' (RESEARCH A4). No action in
# the closed set described it, so it is new, in both services.audit.AuditAction
# and the TS AuditAction union (test_action_literal_matches_ts_union).
DUPLICATE_DETECTED_AUDIT_ACTION: Final = "api_key.account_duplicate_detected"


def _member_window(row: Mapping[str, Any]) -> MemberWindow:
    end = row.get("window_end")
    return MemberWindow(
        seq=int(row["seq"]),
        window_start=str(row["window_start"]),
        window_end=None if end is None else str(end),
    )


async def _share_kind(supabase: Any, key_id: str, holder_id: str) -> str:
    """``composite_member`` when the key and its holder are members of one
    composite strategy with disjoint declared windows (D-04), else ``duplicate``.
    """

    def _q() -> object:
        return (
            supabase.table("strategy_keys")
            .select("strategy_id, api_key_id, window_start, window_end, seq")
            .in_("api_key_id", [key_id, holder_id])
            .execute()
        )

    rows = getattr(await db_execute(_q), "data", None) or []
    by_strategy: dict[str, dict[str, MemberWindow]] = {}
    for row in rows:
        if isinstance(row, Mapping):
            by_strategy.setdefault(str(row["strategy_id"]), {})[
                str(row["api_key_id"])
            ] = _member_window(row)
    for members in by_strategy.values():
        mine, theirs = members.get(key_id), members.get(holder_id)
        if mine is not None and theirs is not None and not windows_overlap(mine, theirs):
            return COMPOSITE_MEMBER_SHARED_ACCOUNT
    return _DUPLICATE


def _safe_message(exc: BaseException) -> str | None:
    """A loggable message for ``exc``, or ``None``.

    Only the ``message`` of a PostgREST ``APIError`` is used. It names the
    constraint or the trigger's refusal token and never carries a value. The
    error's ``details`` (DETAIL) echoes the row, the account id included, and
    ``str(exc)`` of an ``APIError`` is the whole dict, DETAIL and all, so
    neither is ever read. Any other class yields ``None``: a ccxt message can
    embed the API key in its signature text (``routers/portfolio.py`` redacts it
    for that reason) and can echo a venue body, so the class name and the code
    carry the diagnosis instead. What is returned is scrubbed and bounded.

    Review round 2 (SF2-L4): the class is checked, not the attribute. Other
    SDKs set ``.message`` too, to text that can echo a request or a body.
    """
    if not isinstance(exc, APIError):
        return None
    message = exc.message
    if not isinstance(message, str) or not message:
        return None
    scrubbed = scrub_freeform_string(message)
    text = scrubbed if isinstance(scrubbed, str) else ""
    return text[:_MAX_LOGGED_MESSAGE] or None


def _audit_duplicate(key_row: Mapping[str, Any], holder_id: str) -> None:
    """One ``api_key.account_duplicate_detected`` event; never raises.

    Synchronous by design: it runs inside the marker write's worker thread
    (:func:`_write_marker_and_audit`), never on the event loop, so a slow audit
    RPC cannot stall other jobs on the worker.

    ``log_audit_event`` re-raises a permission failure and any unrecognised
    error by contract, and a lost audit row must not undo a marker that has
    already landed, so the drop is logged at ERROR, where Sentry sees it, with
    the class, the SQLSTATE and a scrubbed message. Metadata carries the venue
    and the holder key id only: never the account id, never the user id
    (T-167.1.2-17).
    """
    from services import audit as audit_module

    try:
        audit_module.log_audit_event(
            user_id=str(key_row["user_id"]),
            action=DUPLICATE_DETECTED_AUDIT_ACTION,
            entity_type="api_key",
            entity_id=str(key_row["id"]),
            metadata={"venue": key_row["exchange"], "holder_api_key_id": holder_id},
        )
    except Exception as exc:  # noqa: BLE001 — the marker stands; the drop is logged
        logger.error(
            "account_identity: audit %s dropped for api_key %s: class=%s code=%s "
            "message=%s",
            DUPLICATE_DETECTED_AUDIT_ACTION, key_row.get("id"), type(exc).__name__,
            _error_code(exc), _safe_message(exc),
        )


def _write_marker_and_audit(
    supabase: Any, key_row: Mapping[str, Any], holder_id: str, kind: str
) -> bool:
    """Write the marker and, for a 'duplicate', its audit, as ONE thread task.

    Returns whether the UPDATE landed on a row. Review round 1 (SF-M2 / IN-04):
    the marker UPDATE runs in a worker thread, and ``asyncio.wait_for`` can
    cancel the coroutine awaiting it without stopping the thread, so the UPDATE
    commits anyway. When the audit was a separate step after that await, a
    budget that ran out between the two recorded the transition in the table and
    never in the audit log, and the next poll, meeting an unchanged marker,
    skipped the audit for good. A synchronous callable cannot be split by a
    cancellation: once the UPDATE lands, its audit follows in the same thread.
    An UPDATE that matched no row marked nothing and announces nothing.
    """
    res = (
        supabase.table("api_keys")
        .update({
            "account_shared_with_api_key_id": holder_id,
            "account_share_kind": kind,
        })
        .eq("id", key_row["id"])
        .execute()
    )
    if _first_row(res) is None:
        return False
    if kind == _DUPLICATE:
        _audit_duplicate(key_row, holder_id)
    return True


async def _mark_shared(
    supabase: Any, key_row: Mapping[str, Any], holder_id: str
) -> StampOutcome:
    """Write the marker on ``key_row``, naming ``holder_id`` and its kind.

    The key is neither disconnected nor deleted (D-01); its
    ``venue_account_id`` stays NULL, so its next poll tries the stamp again and
    succeeds once the holder has left (the self-heal). A 'duplicate' is audited
    once, on the transition into it; the daily poll meeting the same marker
    again writes and audits nothing. The write and its audit run as one thread
    task (:func:`_write_marker_and_audit`); a write that matched no row raises
    :class:`_MarkerNotWritten`, so the step never claims a marker it did not
    write.
    """
    kind = await _share_kind(supabase, str(key_row["id"]), holder_id)
    outcome: StampOutcome = (
        "marked_composite_member"
        if kind == COMPOSITE_MEMBER_SHARED_ACCOUNT
        else "marked_duplicate"
    )
    if (
        key_row.get("account_shared_with_api_key_id") == holder_id
        and key_row.get("account_share_kind") == kind
    ):
        return outcome

    def _q() -> bool:
        return _write_marker_and_audit(supabase, key_row, holder_id, kind)

    if not await db_execute(_q):
        raise _MarkerNotWritten()
    return outcome


async def _stamp(
    supabase: Any, key_row: Mapping[str, Any], exchange: Any
) -> StampOutcome:
    venue = key_row["exchange"]
    if venue not in VENUES_WITH_ACCOUNT_ID:
        return "skipped_not_ccxt"
    if key_row.get("venue_account_id") is not None:
        return "skipped_already_stamped"

    account_id = await read_venue_account_id(exchange, venue)
    if account_id is None:
        return "no_id"

    def _q() -> object:
        # Clears any marker in the same write: a key that stamps has no live
        # sibling on its account (the index would have refused it), so it no
        # longer shares one.
        return (
            supabase.table("api_keys")
            .update({
                "venue_account_id": account_id,
                "account_shared_with_api_key_id": None,
                "account_share_kind": None,
            })
            .eq("id", key_row["id"])
            .is_("venue_account_id", "null")
            .execute()
        )

    try:
        res = await db_execute(_q)
    except Exception as exc:  # noqa: BLE001 — classified below, re-raised otherwise
        if _error_code(exc) == _PG_UNIQUE_VIOLATION and _names_identity_index(exc):
            holder = await _find_live_holder(supabase, key_row, account_id)
            if holder is None:
                # The holder left between the refusal and the look-up. The
                # next poll stamps.
                raise _HolderVanished() from exc
            return await _mark_shared(supabase, key_row, str(holder["id"]))
        raise
    if _first_row(res) is None:
        # Another writer stamped the key first.
        return "skipped_already_stamped"
    return "stamped"


class _HolderVanished(Exception):
    """The index refused the stamp, yet no live holder was found after it."""


class _MarkerNotWritten(Exception):
    """The marker UPDATE matched no row: the key left between the refusal and
    the write. Nothing was marked, so nothing was audited."""


# Failures the next poll can clear: logged at WARNING (SF-M3). Everything else
# at the boundary is ERROR. :func:`_is_retryable` is the one classifier.
#
# By class: asyncio's TimeoutError is the builtin on 3.11+. ccxt.NetworkError
# covers RequestTimeout, ExchangeNotAvailable, DDoSProtection and
# RateLimitExceeded; httpx.TransportError and ConnectionError cover a database
# blip, as services.audit._is_transient_network_error treats them.
_RETRYABLE_FAILURES: Final = (
    TimeoutError,
    ccxt.NetworkError,
    httpx.TransportError,
    ConnectionError,
    _HolderVanished,
    _MarkerNotWritten,
)

# Review round 2 (WR-01 / SF2-L3): the same failures, when they reach the
# client as a PostgREST APIError. A statement timeout, a serialization failure
# and a deadlock clear on a retry by nature.
_RETRYABLE_SQLSTATES: Final = frozenset({"57014", "40001", "40P01"})

# The two same-owner trigger refusals (migration 20260925120000) that mean the
# holder left between _find_live_holder and the marker UPDATE: the next poll
# stamps instead (the self-heal). Matched against the whole MESSAGE, which is
# the bare token, never against the bare SQLSTATE: another 23503 or 55000 is
# not this race. The trigger's other refusals (NOT_SAME_OWNER, IS_MARKED,
# KEY_IS_A_HOLDER) do not clear on a retry and stay ERROR.
_RETRYABLE_TRIGGER_TOKENS: Final = frozenset(
    {"ACCOUNT_SHARE_HOLDER_NOT_LIVE", "ACCOUNT_SHARE_HOLDER_NOT_FOUND"}
)


def _is_retryable(exc: BaseException) -> bool:
    """Whether the next poll can be expected to clear ``exc`` (WARNING)."""
    if isinstance(exc, _RETRYABLE_FAILURES):
        return True
    if _is_gateway_timeout(exc):
        return True
    if _error_code(exc) in _RETRYABLE_SQLSTATES:
        return True
    return isinstance(exc, APIError) and exc.message in _RETRYABLE_TRIGGER_TOKENS


async def stamp_account_identity(
    supabase: Any,
    key_row: Mapping[str, Any],
    exchange: Any,
    *,
    timeout_s: float,
) -> StampOutcome:
    """Stamp ``key_row``'s venue account id, or mark it as sharing an account.

    Returns an outcome token and NEVER raises (Pitfall 4). ``timeout_s`` bounds
    the whole step so it cannot run the poll past its own handler timeout; a
    budget of zero or less skips the step (``skipped_no_budget``). Every failure,
    the venue call, the look-up, the write and a refusal by the database
    trigger ``api_keys_account_share_same_owner`` alike, is ``error`` and is
    retried by the next poll.
    ``asyncio.CancelledError`` is not caught: a cancelled poll stays cancelled.

    Review round 1 (SF-M3 / SF-M4): the log level says whether anyone must act.
    Sentry events at ERROR and keeps WARNING as a breadcrumb.

    - A failure the next poll can clear (:func:`_is_retryable`: the budget
      running out, a venue network error or rate limit, a transport error to
      the database, a gateway 504, a statement timeout, a serialization
      failure or a deadlock, a holder or key that moved mid-step, including
      the trigger's ``ACCOUNT_SHARE_HOLDER_NOT_LIVE`` and
      ``ACCOUNT_SHARE_HOLDER_NOT_FOUND`` refusals) is WARNING.
    - Anything else (a renamed ccxt method, the trigger's other refusals, a
      schema-cache miss, a CHECK violation) is not a known transient failure,
      is likely to repeat every day and hides the duplicate it would have
      found, so it is ERROR, with the class, the SQLSTATE and the error's
      scrubbed MESSAGE (:func:`_safe_message`). The DETAIL, which echoes the
      row and the account id, is never read. The line does not claim a retry
      cannot clear it (review round 2, WR-01): unrecognised is not permanent.
    - ``no_id`` is venue schema drift, as the validator treats it, and
      ``skipped_no_budget`` means this key's polls leave no time to check it
      for a duplicate, so both are WARNING. The routine outcomes stay INFO.
    """
    key_id = key_row.get("id")
    venue = key_row.get("exchange")
    try:
        if timeout_s <= 0:
            outcome: StampOutcome = "skipped_no_budget"
        else:
            outcome = await asyncio.wait_for(
                _stamp(supabase, key_row, exchange), timeout=timeout_s
            )
    except Exception as exc:  # noqa: BLE001 — the never-raising boundary
        if _is_retryable(exc):
            logger.warning(
                "account_identity: stamp failed for api_key %s (venue %s): "
                "outcome=error class=%s code=%s — the next poll retries",
                key_id, venue, type(exc).__name__, _error_code(exc),
            )
        else:
            logger.error(
                "account_identity: stamp failed for api_key %s (venue %s): "
                "outcome=error class=%s code=%s message=%s — not a known "
                "transient failure; while it recurs, the key is not checked "
                "for a duplicate",
                key_id, venue, type(exc).__name__, _error_code(exc),
                _safe_message(exc),
            )
        return "error"
    if outcome == "skipped_no_budget":
        logger.warning(
            "account_identity: api_key %s (venue %s) outcome=%s budget_s=%.1f — "
            "the poll used its handler time, so the key was not checked for a "
            "duplicate",
            key_id, venue, outcome, timeout_s,
        )
    elif outcome == "no_id":
        logger.warning(
            "account_identity: api_key %s (venue %s) outcome=%s — the venue "
            "answered without an account id (schema drift?)",
            key_id, venue, outcome,
        )
    else:
        logger.info(
            "account_identity: api_key %s (venue %s) outcome=%s",
            key_id, venue, outcome,
        )
    return outcome
