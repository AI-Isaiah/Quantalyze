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

MT5 (debug session unstamped-venue-account-id, founder Option B, 2026-10-03).
The poll stamper also stamps an MT5 key, from its login TEXT, which the poll's
``Mt5Session`` already carries from the decrypted credentials
(``Mt5Session.venue_account_id``, built by
``services.mt5_validation.mt5_venue_account_id``, the helper rotate uses). No
terminal call is made. An MT5 key connected before the ``venue_account_id``
column (migration 20260812083206) was otherwise never stamped, so two live MT5
keys on one broker account were invisible to the unique index and summed
twice. MT5 is NOT in :data:`VENUES_WITH_ACCOUNT_ID`: that set names the ccxt
venues whose validator responses carry an id, and other modules read it as
such. sFOX stays unstamped (D-10).

Phase 225 plan 12 (CONN-03, CONTEXT Q2). The poll also captures an MT5 key's
BROKER SERVER from the same session (``Mt5Session.server``, no terminal call):
it is stored, normalised, beside the login in ``api_keys.venue_server``. An
unstamped key writes both in one update; an already-stamped key with no server
is backfilled (outcome ``server_backfilled``) only when the session's login
equals the stored login. Because a null-server holder no longer collides in the
server-qualified identity index, an unstamped MT5 key's same-owner holder is
looked up BEFORE the update. Neither the login nor the server is ever logged.
Two OWNERS' keys on one login and server each stamp their own identity and
neither is marked: the equal identity is the share link (ONCE-04).
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

import ccxt
import httpx
from postgrest.exceptions import APIError

from services.allocator_equity_derive import working_holder_predicate
from services.db import _is_gateway_timeout, db_execute
from services.redact import scrub_freeform_string
from services.stitch_composite import MemberWindow, windows_overlap

__all__ = [
    "ACCOUNT_IDENTITY_UNIQUE_INDEX",
    "COMPOSITE_MEMBER_SHARED_ACCOUNT",
    "DUPLICATE_DETECTED_AUDIT_ACTION",
    "MAX_VENUE_ACCOUNT_ID_LENGTH",
    "MAX_VENUE_SERVER_LENGTH",
    "StampOutcome",
    "UNSTAMPED_ESCALATION_DAYS",
    "VENUES_WITH_ACCOUNT_ID",
    "escalate_if_unchecked",
    "escalate_session_build_failure",
    "normalise_venue_server",
    "pick_same_account_holder",
    "read_venue_account_id",
    "same_venue_server",
    "stamp_account_identity",
    "venue_account_id_from",
]

logger = logging.getLogger("quantalyze.analytics")

# The ccxt venues whose validator responses carry an account id. A validation
# on one of these that yields no id is venue schema drift, logged by the
# validator (venue named, value never). sFOX and MT5 are deliberately absent.
VENUES_WITH_ACCOUNT_ID: frozenset[str] = frozenset({"okx", "bybit", "binance", "deribit"})

# MT5's identity is its login, read from the poll's own session, not from a
# venue response, so it is stamped here without being in the set above.
_MT5: Final = "mt5"

# Every venue the poll stamps (and whose unstamped age escalates).
_STAMPED_VENUES: Final = VENUES_WITH_ACCOUNT_ID | {_MT5}


# The same cap as ``ValidateKeyResponseSchema.venue_account_id`` in
# src/lib/analytics-schemas.ts (``.trim().min(1).max(128)``). An id the seam
# refuses connects the key UNSTAMPED, so the service never sends one: it
# answers None, as for a venue that reports no id. zod measures a JS string's
# ``.length``, in UTF-16 code units, so this does too. Change both together.
MAX_VENUE_ACCOUNT_ID_LENGTH: Final = 128


# Phase 225 plan 06 (CONN-03). The broker server of an MT5 key, stored beside the
# login in ``api_keys.venue_server``. The cap of the CHECK
# ``api_keys_venue_server_valid`` and of ``MAX_VENUE_SERVER_LENGTH`` in
# src/lib/venue-identity.ts, which is this module's TypeScript twin. Unlike the
# account id above, the database counts this one in CODE POINTS (``char_length``),
# so ``len`` measures it here and the spread count does there.
MAX_VENUE_SERVER_LENGTH: Final = 128

# Space, tab, CR and LF: the SQL ``btrim(x, E' \t\r\n')`` of ``swap_account_slot``
# and the CHECK, NOT ``str.strip()`` with no argument, which also strips a
# vertical tab, a form feed and every Unicode space the database keeps.
_SERVER_EDGE_WHITESPACE: Final = " \t\r\n"


def normalise_venue_server(raw: object) -> str | None:
    """Return the stored form of a broker server, or ``None``.

    Trim space, tab, CR and LF from both ends, lower-case, and treat blank or
    more than :data:`MAX_VENUE_SERVER_LENGTH` characters as ``None`` (the CHECK
    would refuse it; ``None`` makes the key a wildcard instead). A value that is
    not a ``str`` is ``None``: an ``int`` must never be ``str()``-ed into an
    identity. TypeScript twin: ``normaliseVenueServer`` in
    src/lib/venue-identity.ts; both replay
    tests/fixtures/venue_server_identity.json.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip(_SERVER_EDGE_WHITESPACE).lower()
    if not text or len(text) > MAX_VENUE_SERVER_LENGTH:
        return None
    return text


def same_venue_server(a: str | None, b: str | None) -> bool:
    """Two servers are the same account when equal or when EITHER is ``None``.

    A key not yet backfilled matches on login alone (CONTEXT Q2). TypeScript
    twin: ``sameVenueServer``; fixture ``venue_server_identity.json``.
    """
    return a is None or b is None or a == b


def pick_same_account_holder(
    rows: Sequence[Mapping[str, Any]],
    server: str | None,
    *,
    after_index_refusal: bool,
) -> Mapping[str, Any] | None:
    """Pick the live key a new key on the same login is "the same account as".

    Tiers, first non-empty wins: (1) a row whose ``venue_server`` equals
    ``server`` (``None`` equals ``None``), (2) a row where either side is
    ``None``, (3) any row, only when ``after_index_refusal`` (the live
    login-only unique index refused the write and the caller must still name the
    key that refused it). Inside a tier the smallest ``id`` by plain string
    comparison wins, so the pick never depends on row order. ``server`` must
    already be normalised. TypeScript twin: ``pickSameAccountHolder``; fixture
    ``venue_server_identity.json``.
    """
    tiers: list[Any] = [
        lambda row: row.get("venue_server") == server,
        lambda row: same_venue_server(row.get("venue_server"), server),
    ]
    if after_index_refusal:
        tiers.append(lambda row: True)
    for qualifies in tiers:
        hits = [row for row in rows if qualifies(row)]
        if hits:
            return min(hits, key=lambda row: str(row["id"]))
    return None


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
# Phase 225 plan 09 adds one more writer, and it is the database's, not this
# module's: ``swap_account_slot`` (:func:`_swap_slot_and_audit`) moves the stamp
# (``venue_account_id`` and ``venue_server``) from a failing holder to a working
# key and marks the holder, in one transaction. This module sends no UPDATE for it.
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
    "swapped_holder",
    "server_backfilled",
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


# The columns the holder pick and the D-18 working check read. ``is_active``,
# ``sync_status`` and ``disconnected_at`` are required by
# ``working_holder_predicate``, which treats a missing field as NOT working: a
# holder row without them would read as failing and be swapped out.
_HOLDER_COLUMNS: Final = (
    "id, venue_server, is_active, sync_status, disconnected_at, "
    "account_shared_with_api_key_id, account_share_kind"
)


async def _find_live_holder(
    supabase: Any,
    key_row: Mapping[str, Any],
    account_id: str,
    server: str | None,
    *,
    after_index_refusal: bool,
) -> Mapping[str, Any] | None:
    """The live key of the same owner that holds ``account_id`` on this venue.

    Returns the full holder row (:data:`_HOLDER_COLUMNS`), chosen by
    :func:`pick_same_account_holder` so the broker-server tiers and the
    smallest-id tie-break match the TypeScript connect routes. Filtered by
    ``user_id`` so a holder can never be another tenant's key
    (T-167.1.2-18, T-225-28); the database trigger and ``swap_account_slot``
    refuse that too. ``server`` is the stamping key's normalised broker server.
    """

    def _q() -> object:
        return (
            supabase.table("api_keys")
            .select(_HOLDER_COLUMNS)
            .eq("user_id", key_row["user_id"])
            .eq("exchange", key_row["exchange"])
            .eq("venue_account_id", account_id)
            .is_("disconnected_at", "null")
            .neq("id", key_row["id"])
            .order("id")
            .execute()
        )

    data = getattr(await db_execute(_q), "data", None)
    rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
    return pick_same_account_holder(rows, server, after_index_refusal=after_index_refusal)


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
    # Phase 183 WR-01: a curve composed before this marker landed may count the
    # account twice; see _enqueue_recompose for the best-effort contract.
    _enqueue_recompose(supabase, key_row, "a new marker")
    return True


async def _mark_shared(
    supabase: Any,
    key_row: Mapping[str, Any],
    holder_id: str,
    kind: str | None = None,
) -> StampOutcome:
    """Write the marker on ``key_row``, naming ``holder_id`` and its kind.

    The key is neither disconnected nor deleted (D-01); its
    ``venue_account_id`` stays NULL, so its next poll tries the stamp again and
    succeeds once the holder has left (the self-heal). A 'duplicate' is audited
    once, on the transition into it; the daily poll meeting the same marker
    again writes and audits nothing. The write and its audit run as one thread
    task (:func:`_write_marker_and_audit`); a write that matched no row raises
    :class:`_MarkerNotWritten`, so the step never claims a marker it did not
    write. ``kind`` is passed by a caller that has already read it
    (:func:`_settle_with_holder`); otherwise it is read here.
    """
    if kind is None:
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


def _enqueue_recompose(supabase: Any, key_row: Mapping[str, Any], why: str) -> None:
    """Ask for the owner's allocator recompose; logged, never raised.

    Phase 183 WR-01. Same call and owner source as the per-key derive epilogue.
    Best effort, because the write it follows has landed: a dropped enqueue is
    not retried (the next poll meets an unchanged state), so the curve stays as
    composed until the nightly fan-out. Logged at ERROR so it reaches Sentry.
    """
    try:
        supabase.rpc(
            "enqueue_compute_job",
            {
                "p_strategy_id": None,
                "p_allocator_id": str(key_row["user_id"]),
                "p_kind": "derive_allocator_equity",
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001 — the write stands; the drop is logged
        logger.error(
            "account_identity: recompose enqueue after %s failed for api_key %s: "
            "class=%s code=%s",
            why, key_row.get("id"), type(exc).__name__, _error_code(exc),
        )


# A refusal of ``swap_account_slot``: the message is the bare token, with a static
# DETAIL that carries no login and no server. Only the matched token is ever logged.
_SLOT_REFUSAL: Final = re.compile(r"ACCOUNT_SLOT_[A-Z_]+")


def _slot_refusal_token(exc: BaseException) -> str | None:
    """The ``ACCOUNT_SLOT_*`` token of a swap refusal, or ``None``.

    Only a PostgREST ``APIError`` whose MESSAGE starts with the prefix counts, and
    only the token itself is returned: nothing else of the message, and never the
    DETAIL.
    """
    message = exc.message if isinstance(exc, APIError) else None
    if not isinstance(message, str):
        return None
    match = _SLOT_REFUSAL.match(message)
    return match.group(0) if match else None


def _swap_slot_and_audit(
    supabase: Any,
    key_row: Mapping[str, Any],
    holder: Mapping[str, Any],
    account_id: str,
    server: str | None,
) -> str | None:
    """Move the account slot to ``key_row`` and audit the demoted holder, as ONE
    thread task.

    Phase 225 plan 09 (D-25, MT5D-08, Q1). Same shape as
    :func:`_write_marker_and_audit`, and for the same reason: the RPC runs in a
    worker thread, ``asyncio.wait_for`` can cancel the coroutine awaiting it
    without stopping the thread, so the swap commits anyway. A synchronous
    callable cannot be split by a cancellation: once ``swap_account_slot`` has
    moved the slot, the audit of the demoted holder and the recompose enqueue
    follow in the same thread. Order: the swap, the audit, the enqueue.

    ``swap_account_slot`` writes the stamp and the marker itself, in one
    transaction, so no ``api_keys`` UPDATE happens here. ``p_venue_server`` is
    sent only when known: NULL is a wildcard and never erases the captured one.
    The demoted holder is the audited key, naming the stamped key as its holder,
    as the connect routes' ``swapAccountSlot`` does.

    Returns ``None`` when the slot moved, or the ``ACCOUNT_SLOT_*`` token when the
    database REFUSED the swap (the holder recovered, the key is not working, a
    composite depends on the holder, the rows moved). A refusal wrote nothing, so
    the slot never moves on it and there is nothing to audit or recompose; the
    caller falls back to the marker, which is today's stable state, and the next
    poll re-decides. Any other error propagates: it is a failure of the step.
    """
    params: dict[str, Any] = {
        "p_new_key": str(key_row["id"]),
        "p_old_holder": str(holder["id"]),
        "p_venue_account_id": account_id,
    }
    if server is not None:
        params["p_venue_server"] = server
    try:
        supabase.rpc("swap_account_slot", params).execute()
    except Exception as exc:  # noqa: BLE001 — only a named refusal is absorbed
        token = _slot_refusal_token(exc)
        if token is None:
            raise
        return token
    _audit_duplicate(
        {
            "id": holder["id"],
            "user_id": key_row["user_id"],
            "exchange": key_row["exchange"],
        },
        str(key_row["id"]),
    )
    _enqueue_recompose(supabase, key_row, "a slot swap")
    return None


async def _settle_with_holder(
    supabase: Any,
    key_row: Mapping[str, Any],
    holder: Mapping[str, Any],
    account_id: str,
    server: str | None,
) -> StampOutcome:
    """Decide what a refused stamp does about the holder that refused it.

    D-25 / Q1 / D-18: a WORKING key meeting a holder that is NOT working takes
    the slot (:func:`_swap_slot_and_audit`), so the account is read by a key that
    works. Every other pair is marked exactly as before (:func:`_mark_shared`):
    a working holder, a failing key (a key that is not working has no claim), and
    a composite rotation (D-04 unchanged: two members of one composite with
    disjoint windows are a key rotation, not a duplicate, so the pair is read
    BEFORE any swap and stays ``composite_member``, with no duplicate audit).
    A swap the database refuses falls back to the marker too: the slot never
    moves on a refusal, the token is logged at WARNING and nothing else, and the
    next poll re-decides. ``working_holder_predicate`` is imported, never copied:
    the TypeScript parity test reads exactly one status tuple per file.
    """
    holder_id = str(holder["id"])
    if not (working_holder_predicate(key_row) and not working_holder_predicate(holder)):
        return await _mark_shared(supabase, key_row, holder_id)
    kind = await _share_kind(supabase, str(key_row["id"]), holder_id)
    if kind != _DUPLICATE:
        return await _mark_shared(supabase, key_row, holder_id, kind)

    def _q() -> str | None:
        return _swap_slot_and_audit(supabase, key_row, holder, account_id, server)

    refused = await db_execute(_q)
    if refused is None:
        return "swapped_holder"
    logger.warning(
        "account_identity: api_key %s (venue %s) slot swap refused: %s — the key "
        "is marked against its holder and the next poll re-decides",
        key_row.get("id"), key_row.get("exchange"), refused,
    )
    return await _mark_shared(supabase, key_row, holder_id, kind)


def _mt5_session_server(session: Any) -> str | None:
    """The normalised broker server an MT5 poll session carries, or ``None``.

    ``Mt5Session.server`` is the server the credentials were parsed with, so
    reading it needs no terminal call. A blank, over-length or non-string value is
    ``None``, which makes the key a wildcard on the server (CONTEXT Q2) instead of
    writing a value the ``api_keys_venue_server_valid`` CHECK would refuse.
    """
    return normalise_venue_server(getattr(session, "server", None))


async def _backfill_mt5_server(
    supabase: Any, key_row: Mapping[str, Any], session: Any
) -> StampOutcome:
    """Give an already-stamped MT5 key the broker server its session carries.

    Phase 225 plan 12 (Q2, CONN-03). A key stamped before ``venue_server`` existed
    has the login and no server, and a null-server key matches any server, so the
    column is filled from the poll that already holds the credentials. One guarded
    update, no data-reading guard: it runs only while ``venue_server`` is still
    null, so a concurrent writer (a connect, another poll) is never overwritten.

    T-225-29: the server is taken from the session ONLY when the session's login
    equals the stored login, so a session of another login can never stamp its
    broker onto this key. A mismatch writes nothing and logs one WARNING naming
    the cause; neither login nor server is in the line. A 23505 here is not
    retried: it would mean two live same-login same-server keys, which census
    gate A5 must have caught, so it propagates to the boundary's ERROR line.
    """
    stored_login = key_row.get("venue_account_id")
    if _mt5_account_id(session) != stored_login:
        logger.warning(
            "account_identity: api_key %s (venue %s) server backfill skipped: the "
            "poll session's login does not match the stored login (or carries "
            "none), so its broker server is not used",
            key_row.get("id"), key_row.get("exchange"),
        )
        return "skipped_already_stamped"
    server = _mt5_session_server(session)
    if server is None:
        return "skipped_already_stamped"

    def _q() -> object:
        return (
            supabase.table("api_keys")
            .update({"venue_server": server})
            .eq("id", key_row["id"])
            .eq("venue_account_id", stored_login)
            .is_("venue_server", "null")
            .execute()
        )

    if _first_row(await db_execute(_q)) is None:
        # Another writer filled the server, or the key left, first.
        return "skipped_already_stamped"
    return "server_backfilled"


async def _stamp(
    supabase: Any, key_row: Mapping[str, Any], exchange: Any
) -> StampOutcome:
    """Stamp one key, or mark it as sharing an account. May raise; the caller
    :func:`stamp_account_identity` is the boundary.

    A ccxt key's id comes from ONE venue call (:func:`read_venue_account_id`);
    an MT5 key's from the login text its poll session carries
    (:func:`_mt5_account_id`, no terminal call), and its broker server from the
    same session (Phase 225 plan 12, :func:`_mt5_session_server`). Both then
    share the one UPDATE and, on a refusal by the identity index, the one holder
    look-up -> :func:`_settle_with_holder` path. sFOX and any other venue are
    skipped (``skipped_not_ccxt``, the token name kept for log continuity).

    An MT5 key's holder is looked up BEFORE its UPDATE (Q2): once the identity
    index includes the server, a holder whose ``venue_server`` is still null no
    longer collides with the stamp, so the index alone would let two live keys
    carry one account. A ccxt key keeps the UPDATE-first order, because every
    ccxt server is null and the index refuses those exactly.
    """
    venue = key_row["exchange"]
    if venue not in _STAMPED_VENUES:
        return "skipped_not_ccxt"
    if key_row.get("venue_account_id") is not None:
        if venue == _MT5 and key_row.get("venue_server") is None:
            return await _backfill_mt5_server(supabase, key_row, exchange)
        return "skipped_already_stamped"

    server: str | None
    if venue == _MT5:
        # The login text the session was built with; no terminal call. From
        # here on MT5 shares the ccxt path: the same UPDATE, the same 23505 ->
        # holder -> marker -> one audit.
        account_id = _mt5_account_id(exchange)
        server = _mt5_session_server(exchange)
    else:
        account_id = await read_venue_account_id(exchange, venue)
        server = None
    if account_id is None:
        return "no_id"
    if server is None:
        # A key's stored server is read as before (null for every ccxt key).
        server = normalise_venue_server(key_row.get("venue_server"))

    if venue == _MT5:
        holder = await _find_live_holder(
            supabase, key_row, account_id, server, after_index_refusal=False
        )
        if holder is not None:
            return await _settle_with_holder(supabase, key_row, holder, account_id, server)

    stamp: dict[str, Any] = {
        "venue_account_id": account_id,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }
    if venue == _MT5 and server is not None:
        stamp["venue_server"] = server

    def _q() -> object:
        # Clears any marker in the same write: a key that stamps has no live
        # sibling on its account (the index would have refused it), so it no
        # longer shares one.
        return (
            supabase.table("api_keys")
            .update(stamp)
            .eq("id", key_row["id"])
            .is_("venue_account_id", "null")
            .execute()
        )

    try:
        res = await db_execute(_q)
    except Exception as exc:  # noqa: BLE001 — classified below, re-raised otherwise
        if _error_code(exc) == _PG_UNIQUE_VIOLATION and _names_identity_index(exc):
            holder = await _find_live_holder(
                supabase, key_row, account_id, server, after_index_refusal=True
            )
            if holder is None:
                # The holder left between the refusal and the look-up. The
                # next poll stamps.
                raise _HolderVanished() from exc
            return await _settle_with_holder(supabase, key_row, holder, account_id, server)
        raise
    if _first_row(res) is None:
        # Another writer stamped the key first.
        return "skipped_already_stamped"
    return "stamped"


def _mt5_account_id(session: Any) -> str | None:
    """The venue account id an MT5 poll session carries, or ``None``.

    ``Mt5Session.venue_account_id`` is already stripped by
    ``mt5_validation.mt5_venue_account_id``; a session without one (or a
    non-string) yields ``None`` and the stamp reports ``no_id``.

    167.1.2-08 review, IN-01: the value then goes through :func:`_normalise`,
    so it obeys the same :data:`MAX_VENUE_ACCOUNT_ID_LENGTH` cap as a ccxt id
    (an over-cap login is ``None``, with the venue-only WARNING). ``int()``
    accepts a digit string of any length, so the credential parse does not
    bound it. The ``str`` check comes first: an int must never reach
    ``_normalise``, whose ``str(int)`` would be the int-parsed form the MT5
    identity forbids.
    """
    value = getattr(session, "venue_account_id", None)
    if not isinstance(value, str):
        return None
    return _normalise(value, _MT5)


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


# Review round 2 (SF2-M2): a retryable failure or ``skipped_no_budget`` is a
# WARNING because the next poll may clear it. When it recurs every day, the key
# is never stamped and its duplicate check never runs, and a WARNING never
# reaches Sentry. So once a ccxt or MT5 key is older than this many days and still
# unstamped, the same line is logged at ERROR instead. Three daily polls is
# long enough for a transient to have cleared.
UNSTAMPED_ESCALATION_DAYS: Final = 3


def _unstamped(key_row: Mapping[str, Any]) -> bool:
    """A venue this module stamps, still without a ``venue_account_id``."""
    return (
        key_row.get("exchange") in _STAMPED_VENUES
        and key_row.get("venue_account_id") is None
    )


def _duplicate_check_missing(key_row: Mapping[str, Any]) -> bool:
    """An unstamped key that the stamper has NOT marked as sharing an account.

    167.1.2-08 review round 2, SFH R2-L4. A key marked against a holder keeps
    ``venue_account_id`` NULL by design (the identity index refuses its id;
    :func:`_mark_shared`), so a NULL alone does not mean its duplicate check
    is missing: the check ran and found the holder. The census
    (``scripts/accounttruth-census.mjs``, the ``unresolved`` CTE) counts such a
    key as RESOLVED while its holder, in the same owner's keys, still holds the
    index slot. The key row cannot see the holder, so this treats every marked
    key as resolved, the conservative half of that rule.

    The one divergence from the census: a key marked against a holder that has
    since departed is unresolved there and resolved here. For MT5 it does not
    last, because the MT5 stamp runs before the fetch on every poll and
    self-heals once the holder has left. A ccxt key stamps only on a DONE poll,
    so one whose polls keep failing stays marked and logs no escalation; census
    (a)'s ``live_keys_unstamped_unmarked`` is the backstop for that case.
    """
    return _unstamped(key_row) and key_row.get("account_shared_with_api_key_id") is None


def _unstamped_for_too_long(key_row: Mapping[str, Any]) -> bool:
    """Whether ``key_row`` should have been stamped by now and is not.

    Only a venue this module stamps (a ccxt venue in
    :data:`VENUES_WITH_ACCOUNT_ID`, or MT5) and only
    while ``venue_account_id`` is NULL and the key is not marked as sharing an
    account (:func:`_duplicate_check_missing`): for any other key no duplicate
    check is missing. ``skipped_no_budget`` is decided before the venue check, which is
    why the venue is checked here. ``created_at`` is ``NOT NULL`` on
    ``api_keys`` and the poll loads the key with ``select("*")``
    (``job_worker._allocator_key_preflight``), so an absent or unparseable
    value is not a production state; it answers ``False``, making no claim.
    A value without an offset is read as UTC.
    """
    if not _duplicate_check_missing(key_row):
        return False
    raw = key_row.get("created_at")
    if not isinstance(raw, str):
        return False
    try:
        created = datetime.fromisoformat(raw)
    except ValueError:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return datetime.now(UTC) - created > timedelta(days=UNSTAMPED_ESCALATION_DAYS)


_ESCALATION_NOTE: Final = (
    f"key unstamped for >{UNSTAMPED_ESCALATION_DAYS} days; duplicate check not running"
)


def escalate_if_unchecked(key_row: Mapping[str, Any], *, cause: str) -> None:
    """Log the SF2-M2 escalation for a poll that never reached the stamp.

    167.1.2-08 review, SFH H-1. The escalation lives in
    :func:`stamp_account_identity`, which runs only when the poll gets far
    enough to call it. A poll that fails first (a venue error, a sign-in
    refusal, a 429, a persist failure) skipped it, so a key whose polls kept failing stayed unstamped with no line
    saying its duplicate check was not running. The poll calls this on every
    path that did not call the stamp. It applies the same rule
    (:func:`_unstamped_for_too_long`): a stamped venue, still NULL and unmarked, older than
    :data:`UNSTAMPED_ESCALATION_DAYS`, logged at ERROR. Below the threshold it
    logs nothing, because the poll's own failure is already logged. A session
    that could not be built is :func:`escalate_session_build_failure`.

    ``cause`` is a fixed token chosen by the caller, never exception text.
    Synchronous and never raises: it runs in the poll's ``finally``, where an
    exception would mask the real one.
    """
    try:
        if not _unstamped_for_too_long(key_row):
            return
        logger.error(
            "account_identity: api_key %s (venue %s) outcome=not_attempted "
            "cause=%s — %s",
            key_row.get("id"), key_row.get("exchange"), cause, _ESCALATION_NOTE,
        )
    except Exception:  # noqa: BLE001 — a log line must never mask the poll's outcome
        logger.exception("account_identity: escalation check itself failed")


def escalate_session_build_failure(
    key_row: Mapping[str, Any], exc: BaseException
) -> None:
    """ERROR for an unstamped key whose poll session could not be built.

    167.1.2-08 review, SFH H-1. NOT age-gated, unlike
    :func:`escalate_if_unchecked`: the preflight re-raises the decrypt or
    construction error, the dispatcher turns it into a FAILED result, and
    ``main_worker`` logs that at WARNING only, so without this line even a
    fresh key would never reach Sentry. A key with no session cannot be
    checked for a duplicate at all, and the cause (a credential that will not
    decrypt, a gateway that is not configured) does not clear by itself.
    Only the exception CLASS is logged: decrypt and parse errors can carry
    credential material. A key already stamped, or on a venue this module
    never stamps, logs nothing here. Synchronous and never raises.

    A key already MARKED as sharing an account (SFH R2-L4) still gets the
    ERROR, because this line is the only Sentry-level record of a session that
    cannot be built, but its text says the marker is not re-checked rather
    than that the duplicate check is not running: the check ran and its marker
    stands (:func:`_duplicate_check_missing`).
    """
    try:
        if not _unstamped(key_row):
            return
        if not _duplicate_check_missing(key_row):
            note = (
                "the poll session could not be built; the key is marked as "
                "sharing an account, and that marker is not re-checked while "
                "this recurs"
            )
        elif _unstamped_for_too_long(key_row):
            note = _ESCALATION_NOTE
        else:
            note = "the poll session could not be built; duplicate check not running"
        logger.error(
            "account_identity: api_key %s (venue %s) outcome=not_attempted "
            "cause=session_build_failed class=%s — %s",
            key_row.get("id"), key_row.get("exchange"), type(exc).__name__, note,
        )
    except Exception:  # noqa: BLE001 — a log line must never mask the poll's outcome
        logger.exception("account_identity: escalation check itself failed")


async def stamp_account_identity(
    supabase: Any,
    key_row: Mapping[str, Any],
    exchange: Any,
    *,
    timeout_s: float,
) -> StampOutcome:
    """Stamp ``key_row``'s venue account id, or mark it as sharing an account.

    Returns an outcome token and NEVER raises (Pitfall 4). ``swapped_holder``
    (Phase 225 plan 09, D-25 / Q1) is a working key that took the account's slot
    from a same-owner holder that is not working (D-18), through
    ``swap_account_slot``; the demoted holder is marked ``duplicate`` and audited,
    and the owner's allocator curve is recomposed. A swap the database refuses
    (an ``ACCOUNT_SLOT_*`` token: the holder recovered, a composite depends on
    it, the rows moved) is logged at WARNING with the token only and falls back to
    the marker, today's stable state; the next poll re-decides. ``server_backfilled``
    (Phase 225 plan 12, Q2 / CONN-03) is an already-stamped MT5 key that had no
    broker server and now carries its session's, written only while the column is
    still null and only when the session's login equals the stored login. An
    unstamped MT5 key is checked for a same-owner holder BEFORE its update (a
    null-server holder no longer collides in the server index); a ccxt key is
    stamped first and checked after a refusal. ``timeout_s`` bounds
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
    - ``no_id`` on a ccxt venue is venue schema drift, as the validator treats
      it, and ``skipped_no_budget`` means this key's polls leave no time to
      check it for a duplicate, so both are WARNING. The routine outcomes stay
      INFO.
    - ``no_id`` on MT5 is ERROR (167.1.2-08 review, SFH M-1): the poll session
      carries no usable login, which only a constructor defect produces.
    - Review round 2 (SF2-M2): a retryable failure, ``skipped_no_budget`` or
      (SFH M-1) a ccxt ``no_id`` on a ccxt or MT5 key still unstamped, and not
      marked as sharing an account (SFH R2-L4), more than
      :data:`UNSTAMPED_ESCALATION_DAYS` after it was created is ERROR ("key
      unstamped for >N days; duplicate check not running"): a WARNING that
      recurs daily never reaches Sentry.
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
            if _unstamped_for_too_long(key_row):
                logger.error(
                    "account_identity: stamp failed for api_key %s (venue %s): "
                    "outcome=error class=%s code=%s — %s",
                    key_id, venue, type(exc).__name__, _error_code(exc),
                    _ESCALATION_NOTE,
                )
            else:
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
    if outcome == "skipped_no_budget" and _unstamped_for_too_long(key_row):
        logger.error(
            "account_identity: api_key %s (venue %s) outcome=%s budget_s=%.1f — "
            "%s",
            key_id, venue, outcome, timeout_s, _ESCALATION_NOTE,
        )
    elif outcome == "skipped_no_budget":
        logger.warning(
            "account_identity: api_key %s (venue %s) outcome=%s budget_s=%.1f — "
            "the poll used its handler time, so the key was not checked for a "
            "duplicate",
            key_id, venue, outcome, timeout_s,
        )
    elif outcome == "no_id" and venue == _MT5:
        # 167.1.2-08 review, SFH M-1. parse_mt5_credentials refuses a blank
        # login, so an MT5 session without an id is a constructor that did not
        # set it (or a login over the length cap): our defect, not the
        # venue's, and it recurs every poll. ERROR, never "schema drift".
        logger.error(
            "account_identity: api_key %s (venue %s) outcome=%s — the poll "
            "session carries no usable login (absent, or over %d characters); "
            "this is a construction defect, and while it recurs the key is not "
            "checked for a duplicate",
            key_id, venue, outcome, MAX_VENUE_ACCOUNT_ID_LENGTH,
        )
    elif outcome == "no_id" and _unstamped_for_too_long(key_row):
        # SFH M-1 (a): the same "duplicate check not running" state as a
        # retryable failure that recurs, so it escalates the same way.
        logger.error(
            "account_identity: api_key %s (venue %s) outcome=%s — the venue "
            "answered without an account id — %s",
            key_id, venue, outcome, _ESCALATION_NOTE,
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
