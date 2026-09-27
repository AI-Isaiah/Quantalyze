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

from collections.abc import Mapping
from typing import Any

__all__ = ["VENUES_WITH_ACCOUNT_ID", "venue_account_id_from"]

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
