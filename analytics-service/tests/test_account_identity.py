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


class TestBybit:
    def test_integer_user_id_is_returned_as_its_string(self) -> None:
        # Bybit documents userID as an integer.
        raw = {"retCode": 0, "result": {"userID": 100000001, "parentUid": "100000000", "isMaster": False}}
        assert venue_account_id_from("bybit", raw) == SYNTHETIC_UID

    def test_string_user_id_is_returned(self) -> None:
        assert venue_account_id_from("bybit", {"result": {"userID": SYNTHETIC_UID}}) == SYNTHETIC_UID

    def test_parent_uid_is_never_read_as_the_identity(self) -> None:
        # A sub-account has its own userID; parentUid is the master's ("0" on a master).
        assert venue_account_id_from("bybit", {"result": {"parentUid": "100000000"}}) is None

    def test_blank_user_id_is_none(self) -> None:
        assert venue_account_id_from("bybit", {"result": {"userID": " "}}) is None

    def test_missing_result_is_none(self) -> None:
        assert venue_account_id_from("bybit", {"retCode": 0}) is None

    def test_non_mapping_result_is_none(self) -> None:
        assert venue_account_id_from("bybit", {"result": [SYNTHETIC_UID]}) is None


class TestBinance:
    """``raw`` is the ``info`` of a spot ``fetch_balance()`` (GET /api/v3/account)."""

    def test_integer_uid_is_returned_as_its_string(self) -> None:
        raw = {"accountType": "SPOT", "balances": [], "uid": 100000001}
        assert venue_account_id_from("binance", raw) == SYNTHETIC_UID

    def test_blank_uid_is_none(self) -> None:
        assert venue_account_id_from("binance", {"uid": ""}) is None

    def test_missing_uid_is_none(self) -> None:
        assert venue_account_id_from("binance", {"accountType": "SPOT"}) is None


class TestDeribit:
    """``raw`` is the ``info`` of ``fetch_balance({"extended": True})``, the
    ``result`` dict of private/get_account_summaries."""

    def test_integer_id_is_returned_as_its_string(self) -> None:
        assert venue_account_id_from("deribit", {"id": 100000001, "summaries": []}) == SYNTHETIC_UID

    def test_without_extended_the_id_is_absent_and_the_result_is_none(self) -> None:
        assert venue_account_id_from("deribit", {"summaries": []}) is None

    def test_whitespace_id_is_none(self) -> None:
        assert venue_account_id_from("deribit", {"id": "\t "}) is None


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


# ---------------------------------------------------------------------------
# Review round 2 SF2-M1 — the same 128-character cap as the Next seam
# ---------------------------------------------------------------------------
#
# ``src/lib/analytics-schemas.ts`` (``ValidateKeyResponseSchema``) trims the id
# and refuses one over 128 characters, so a key whose id is longer connects
# UNSTAMPED and is never checked for a duplicate. The service must not send
# what the seam refuses: over-long is ``None`` here, with a WARNING that names
# the venue and never the value. zod measures a JS string, in UTF-16 code
# units, so the service measures the same way.

_CAP = 128
_OVER_LONG_MARK = "OVERLONGID"


def _okx(uid: object) -> dict[str, Any]:
    return {"code": "0", "data": [{"uid": uid}]}


class TestLengthCap:
    def test_an_id_of_exactly_the_cap_is_kept(self) -> None:
        uid = "7" * _CAP
        assert venue_account_id_from("okx", _okx(uid)) == uid

    def test_whitespace_is_trimmed_before_the_cap_is_measured(self) -> None:
        uid = "7" * _CAP
        assert venue_account_id_from("okx", _okx(f"  {uid}\n")) == uid

    def test_one_over_the_cap_is_none_with_a_warning_naming_the_venue(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level("DEBUG")
        uid = _OVER_LONG_MARK + "7" * (_CAP + 1 - len(_OVER_LONG_MARK))

        assert venue_account_id_from("bybit", {"result": {"userID": uid}}) is None

        (rec,) = [r for r in caplog.records if "venue_account_id" in r.getMessage()]
        assert rec.levelname == "WARNING"
        assert "bybit" in rec.getMessage()
        # The value is an account identifier: never logged, not even a slice.
        assert _OVER_LONG_MARK not in caplog.text
        assert "7777777" not in caplog.text

    def test_the_cap_counts_utf16_code_units_as_the_seam_does(self) -> None:
        # U+1D7D9 is outside the BMP: one Python character, two UTF-16 units.
        # 65 of them are 130 units, which zod's .max(128) refuses.
        astral = "\U0001d7d9"
        assert venue_account_id_from("okx", _okx(astral * 64)) == astral * 64
        assert venue_account_id_from("okx", _okx(astral * 65)) is None

    def test_an_over_long_integer_id_is_none(self) -> None:
        assert venue_account_id_from("binance", {"uid": int("9" * (_CAP + 1))}) is None

    def test_a_lone_surrogate_never_raises(self) -> None:
        # json.loads turns "\ud800" into a lone surrogate, which a strict
        # UTF-16 encode refuses. The extractor is total, so it must not raise.
        assert venue_account_id_from("okx", _okx("\ud800" * (_CAP + 1))) is None
        assert venue_account_id_from("okx", _okx("7\ud800")) == "7\ud800"
