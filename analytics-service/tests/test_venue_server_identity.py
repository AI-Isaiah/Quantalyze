"""Phase 225 plan 06 (CONN-03, MT5D-08): the Python half of the broker-server
identity rule, replayed against the case table the TS twin reads too
(``tests/fixtures/venue_server_identity.json``; ``src/lib/venue-identity.ts``).

The expectations in that file are hand-typed. Nothing here derives one from the
code under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from services.account_identity import (
    MAX_VENUE_SERVER_LENGTH,
    _mt5_session_server,
    normalise_venue_server,
    pick_same_account_holder,
    same_venue_server,
)
from services.allocator_equity_derive import (
    account_identity_tokens,
    ambiguous_server_key_ids,
)
from services.mt5_validation import Mt5ValidationError, parse_mt5_credentials

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "venue_server_identity.json").read_text(
        encoding="utf-8"
    )
)


def test_the_shared_fixture_is_not_vacuous() -> None:
    assert len(_SPEC["normalise"]) > 0
    assert len(_SPEC["connect"]) > 0
    assert len(_SPEC["same"]) > 0
    assert len(_SPEC["pick"]) > 0
    assert len(_SPEC["tokens"]) > 0


@pytest.mark.parametrize("case", _SPEC["normalise"], ids=lambda c: repr(c["in"])[:40])
def test_normalise_venue_server(case: dict[str, Any]) -> None:
    assert normalise_venue_server(case["in"]) == case["out"]


@pytest.mark.parametrize("case", _SPEC["connect"], ids=lambda c: repr(c["raw"])[:40])
def test_connect_raw_passphrase_is_stored_as_the_poll_reads_it(case: dict[str, Any]) -> None:
    """WR-03, end to end: the RAW connect-time passphrase goes through the real
    ``parse_mt5_credentials`` (``str.strip()``) and the poll's own session
    reader, and must equal what the TS connect routes store
    (``normaliseConnectedVenueServer``)."""
    _login, _pw, server = parse_mt5_credentials("123456", "pw", case["raw"])
    session = SimpleNamespace(server=server)
    assert _mt5_session_server(session) == case["stored"]


@pytest.mark.parametrize(
    "raw_server",
    [None, "", "   ", "\u00a0", "\x1f"],
    ids=["none", "empty", "spaces", "nbsp", "control-char"],
)
def test_an_mt5_key_without_a_server_is_refused_as_wrong_server(raw_server: Any) -> None:
    """Founder ruling 2026-11-25 (Phase 225 CONTEXT Q6, "Delete keys without
    Server, dont accept keys without Server"): the offline credential parse
    refuses a blank server as ``wrong_server`` before any probe. The TS connect
    routes refuse the same set before any insert. Reddens if the blank-server
    guard is dropped from ``parse_mt5_credentials``."""
    with pytest.raises(Mt5ValidationError) as excinfo:
        parse_mt5_credentials("123456", "pw", raw_server)
    assert excinfo.value.kind == "wrong_server"


def test_normalise_counts_code_points_like_the_databases_char_length() -> None:
    assert MAX_VENUE_SERVER_LENGTH == 128
    assert normalise_venue_server("\U0001f600" * 128) == "\U0001f600" * 128
    assert normalise_venue_server("\U0001f600" * 129) is None


@pytest.mark.parametrize("case", _SPEC["same"], ids=lambda c: f"{c['a']}-{c['b']}")
def test_same_venue_server(case: dict[str, Any]) -> None:
    assert same_venue_server(case["a"], case["b"]) is case["same"]


def _pick_id(case: dict[str, Any], rows: list[dict[str, Any]]) -> str | None:
    picked = pick_same_account_holder(
        rows,
        case["server"],
        after_index_refusal=case["mode"] == "after_index_refusal",
    )
    return None if picked is None else str(picked["id"])


@pytest.mark.parametrize("case", _SPEC["pick"], ids=lambda c: c["name"])
def test_pick_same_account_holder(case: dict[str, Any]) -> None:
    assert _pick_id(case, case["rows"]) == case["expect"]


@pytest.mark.parametrize("case", _SPEC["pick"], ids=lambda c: c["name"])
def test_pick_does_not_depend_on_row_order(case: dict[str, Any]) -> None:
    assert _pick_id(case, list(reversed(case["rows"]))) == case["expect"]


@pytest.mark.parametrize("case", _SPEC["tokens"], ids=lambda c: c["name"])
@pytest.mark.parametrize("order", ["given", "reversed"])
def test_account_identity_tokens_and_ambiguity(case: dict[str, Any], order: str) -> None:
    """225 CONN-03, CONTEXT Q6: one login on two set servers is two accounts, a key
    with no server joins only a login with at most one distinct set server, and a
    key that cannot be placed has no token (and is named by ``ambiguous_server_key_ids``).
    Each case runs in the given order and reversed: a token that depended on row
    order would answer differently."""
    keys = list(case["keys"]) if order == "given" else list(reversed(case["keys"]))
    assert account_identity_tokens(keys) == case["tokens"]
    assert ambiguous_server_key_ids(keys) == frozenset(case["ambiguous"])
