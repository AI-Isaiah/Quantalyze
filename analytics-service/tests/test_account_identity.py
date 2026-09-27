"""Phase 167.1.2 (D-01) — the venue account id extractor.

Why these cases matter: the id feeds ``api_keys.venue_account_id``, and a
partial UNIQUE index on it is what refuses a second live key on one exchange
account. Two failure directions, both pinned:

- A blank or whitespace id must be ``None``, never ``''``. ``''`` is non-NULL,
  so the index would treat every blank key on a venue as ONE account and refuse
  a genuinely different account (wrong-account attribution).
- A real id must come back as its exact string. An integer uid is ``str()``-ed
  (never ``None``), or the refusal silently never fires for that venue.

Every id below is synthetic. No venue is called.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.account_identity import venue_account_id_from


SYNTHETIC_UID = "100000001"


class TestOkx:
    def test_uid_is_returned_as_its_string(self) -> None:
        raw = {"code": "0", "data": [{"uid": SYNTHETIC_UID, "mainUid": "100000000"}]}
        assert venue_account_id_from("okx", raw) == SYNTHETIC_UID

    def test_integer_uid_is_returned_as_its_string(self) -> None:
        assert venue_account_id_from("okx", {"data": [{"uid": 100000001}]}) == SYNTHETIC_UID

    def test_surrounding_whitespace_is_stripped_and_case_is_kept(self) -> None:
        assert venue_account_id_from("okx", {"data": [{"uid": "  AbC123  "}]}) == "AbC123"

    def test_blank_uid_is_none_never_empty_string(self) -> None:
        assert venue_account_id_from("okx", {"data": [{"uid": ""}]}) is None

    def test_whitespace_uid_is_none(self) -> None:
        assert venue_account_id_from("okx", {"data": [{"uid": "   "}]}) is None

    def test_missing_data_is_none(self) -> None:
        assert venue_account_id_from("okx", {"code": "0"}) is None

    def test_empty_data_list_is_none(self) -> None:
        assert venue_account_id_from("okx", {"data": []}) is None

    def test_missing_uid_is_none(self) -> None:
        assert venue_account_id_from("okx", {"data": [{"perm": "read_only"}]}) is None

    def test_main_uid_is_never_read_as_the_identity(self) -> None:
        # A sub-account carries its own uid; mainUid is the master's. Reading
        # mainUid would make every sub-account look like its master.
        assert venue_account_id_from("okx", {"data": [{"mainUid": "100000000"}]}) is None


@pytest.mark.parametrize(
    "raw",
    [
        {"data": "not-a-list"},
        {"data": [None]},
        {"data": ["uid"]},
        {"data": [{"uid": None}]},
        {"data": [{"uid": True}]},
        {"data": [{"uid": {"nested": "x"}}]},
        {"data": [{"uid": ["100000001"]}]},
        {"data": [{"uid": 1.5}]},
    ],
)
def test_okx_wrongly_typed_containers_are_none_and_never_raise(raw: dict[str, Any]) -> None:
    assert venue_account_id_from("okx", raw) is None


def test_a_non_mapping_response_is_none() -> None:
    assert venue_account_id_from("okx", None) is None  # type: ignore[arg-type]
    assert venue_account_id_from("okx", ["uid"]) is None  # type: ignore[arg-type]


@pytest.mark.parametrize("venue", ["sfox", "mt5", "kraken", "", "OKX"])
def test_a_venue_with_no_known_id_source_is_none(venue: str) -> None:
    # sFOX has no known account id (D-10) and MT5's identity is its login,
    # stamped by the Next route. An unknown venue must never borrow another
    # venue's field. Venue ids are the lowercase ccxt ids; "OKX" is not one.
    raw = {"data": [{"uid": SYNTHETIC_UID}], "result": {"userID": SYNTHETIC_UID}, "uid": SYNTHETIC_UID, "id": SYNTHETIC_UID}
    assert venue_account_id_from(venue, raw) is None
