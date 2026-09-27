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

- Pure and total. No I/O, and it never raises: a missing or wrongly typed
  container yields ``None``.
- Never returns ``''``. A blank or whitespace value is ``None``, because a blank
  identity is non-NULL to the partial unique index and would collapse two
  different accounts into one (the ``api_keys_venue_account_id_nonblank`` CHECK
  refuses it too).
- Never lowercases. Venue ids are numeric or opaque, and case is part of them.
- Only a ``str`` or an ``int`` counts as an id. ``bool`` is an ``int`` subclass in
  Python and is refused explicitly, so a flag can never pass for an account.
- ⛔ The value is an account identifier. Callers must never log it or put it in
  error copy. It leaves the service only as the ``venue_account_id`` field of
  the validate response.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any, Final, Literal

from services.db import db_execute

__all__ = [
    "ACCOUNT_IDENTITY_UNIQUE_INDEX",
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


def _normalise(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
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
        return _normalise(_child(data[0], "uid"))
    if venue == "bybit":
        return _normalise(_child(raw.get("result"), "userID"))
    if venue == "binance":
        return _normalise(raw.get("uid"))
    if venue == "deribit":
        return _normalise(raw.get("id"))
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
    code = getattr(exc, "code", None)
    return code if isinstance(code, str) else None


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


async def _mark_shared(
    supabase: Any, key_row: Mapping[str, Any], holder_id: str
) -> StampOutcome:
    """Write the marker on ``key_row``, naming ``holder_id``.

    The key is neither disconnected nor deleted (D-01); its
    ``venue_account_id`` stays NULL, so its next poll tries the stamp again and
    succeeds once the holder has left (the self-heal).
    """
    kind = "duplicate"
    if (
        key_row.get("account_shared_with_api_key_id") == holder_id
        and key_row.get("account_share_kind") == kind
    ):
        # Already marked with this holder and kind: no write.
        return "marked_duplicate"

    def _q() -> object:
        return (
            supabase.table("api_keys")
            .update({
                "account_shared_with_api_key_id": holder_id,
                "account_share_kind": kind,
            })
            .eq("id", key_row["id"])
            .execute()
        )

    await db_execute(_q)
    return "marked_duplicate"


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
    trigger ``api_keys_account_share_same_owner`` alike, is ``error``, logged by
    exception class and SQLSTATE code, and retried by the next poll.
    ``asyncio.CancelledError`` is not caught: a cancelled poll stays cancelled.
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
        logger.warning(
            "account_identity: stamp failed for api_key %s (venue %s): "
            "outcome=error class=%s code=%s — the next poll retries",
            key_id, venue, type(exc).__name__, _error_code(exc),
        )
        return "error"
    logger.info(
        "account_identity: api_key %s (venue %s) outcome=%s",
        key_id, venue, outcome,
    )
    return outcome
