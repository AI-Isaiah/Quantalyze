"""Phase 167.2.1.1.2 ACCTREBUILD, plan 01: the worker wrapper of the window replace.

WHY these tests exist. ``replace_allocator_equity_snapshots`` deletes every row an
allocator has, so it cannot honour D-01 ("only the rebuilt window is replaced"). The
new ``replace_allocator_equity_snapshots_window`` SQL function replaces only the window
and refuses, inside its own transaction, when a stored day in the window is not in the
payload (D-02). This module pins the worker half with no database: the call shape the
function reads, and the one mapping that turns its refusal into a named
``ForcedRebuildRefusedError``.

The mapping is the part that must not widen. The SQL message is the bare token
``history_days_unreproduced`` (SQLSTATE P0001, DETAIL a count). The wrapper maps that
and nothing else: another P0001 message, the same message under another code, a timeout
and a transport fault all propagate unchanged, because turning an unrelated failure into
"a stored day was not reproduced" would put a false reason in compute_jobs and audit_log.

Every test reaches the new names through ``er.`` inside its body, so before the code
exists each one fails on an AttributeError instead of aborting collection.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx
import pytest
from postgrest.exceptions import APIError

from services import equity_reconstruction as er

ALLOCATOR_ID = "00000000-0000-4000-8000-0000000000a1"
WINDOW_START = date(2026, 3, 1)
RPC_NAME = "replace_allocator_equity_snapshots_window"
TOKEN = "history_days_unreproduced"


class _StubResult:
    def __init__(self, data: Any) -> None:
        self.data = data


class _StubRpc:
    def __init__(self, owner: "_StubClient", name: str, params: dict[str, Any]) -> None:
        self._owner = owner
        self._name = name
        self._params = params

    def execute(self) -> _StubResult:
        self._owner.calls.append((self._name, self._params))
        if self._owner.raises is not None:
            raise self._owner.raises
        return _StubResult(self._owner.result)


class _StubClient:
    """Records ``rpc(name, params)`` and returns or raises one configured outcome."""

    def __init__(self, result: Any = None, raises: BaseException | None = None) -> None:
        self.result = result
        self.raises = raises
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rpc(self, name: str, params: dict[str, Any]) -> _StubRpc:
        return _StubRpc(self, name, params)


def _rows() -> list[dict[str, Any]]:
    return [
        {
            "asof": "2026-03-01",
            "value_usd": 11.0,
            "breakdown": {"BTC": 11.0},
            "source": "mixed",
            "pre_terminus_balance_unknown": True,
            "reconstructed_at": "2026-03-05T00:00:00Z",
            "history_depth_months": 24,
            "allocator_id": "must-not-leak",
        },
        {"asof": "2026-03-02", "value_usd": 12.0},
    ]


async def test_window_replace_sends_the_five_projected_columns_and_the_window_start() -> None:
    client = _StubClient(result=2)

    inserted = await er.replace_equity_snapshots_window(
        client, _rows(), ALLOCATOR_ID, 3, WINDOW_START
    )

    assert inserted == 2
    assert len(client.calls) == 1
    name, params = client.calls[0]
    assert name == "replace_allocator_equity_snapshots_window"
    assert set(params) == {"p_allocator_id", "p_rows", "p_depth_months", "p_window_start"}
    assert params["p_allocator_id"] == ALLOCATOR_ID
    assert params["p_depth_months"] == 3
    # The ISO string of the date passed, not a date object and not the row dates.
    assert params["p_window_start"] == "2026-03-01"
    assert params["p_rows"] == [
        {
            "asof": "2026-03-01",
            "value_usd": 11.0,
            "breakdown": {"BTC": 11.0},
            "source": "mixed",
            "pre_terminus_balance_unknown": True,
        },
        {
            # Defaults a row that never went through the terminus stamp: the flag is a
            # concrete False, the source the venue-primary one, the breakdown None.
            "asof": "2026-03-02",
            "value_usd": 12.0,
            "breakdown": None,
            "source": "exchange_primary",
            "pre_terminus_balance_unknown": False,
        },
    ]


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (5, 5),  # a scalar function result surfaces as an int under .data
        ([7], 7),  # ... or as a one-int list
        (None, 2),  # anything else falls back to the payload length
        ("2", 2),
        ([], 2),
        ([{"x": 1}], 2),
    ],
)
async def test_window_replace_unwraps_the_result_as_the_full_replace_does(
    result: Any, expected: int
) -> None:
    client = _StubClient(result=result)

    inserted = await er.replace_equity_snapshots_window(
        client, _rows(), ALLOCATOR_ID, 3, WINDOW_START
    )

    assert inserted == expected


def _api_error(code: str, message: str, details: str | None = "3") -> APIError:
    return APIError({"code": code, "message": message, "details": details, "hint": None})


async def test_the_refusal_token_maps_to_the_named_refusal() -> None:
    client = _StubClient(raises=_api_error("P0001", TOKEN))

    with pytest.raises(er.ForcedRebuildRefusedError) as caught:
        await er.replace_equity_snapshots_window(
            client, _rows(), ALLOCATOR_ID, 3, WINDOW_START
        )

    assert caught.value.reason == "history_days_unreproduced"
    assert str(caught.value) == "forced rebuild refused (history_days_unreproduced)"
    # `from None`: the APIError (whose repr carries DETAIL) is not chained behind it.
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True


_OTHER_FAILURES: list[BaseException] = [
    _api_error("P0001", "replace_allocator_equity_snapshots_window: row_before_window"),
    _api_error("22023", TOKEN),
    _api_error("57014", "canceling statement due to statement timeout"),
    RuntimeError("boom"),
    httpx.ConnectError("connection refused"),
]


@pytest.mark.parametrize("failure", _OTHER_FAILURES, ids=lambda f: type(f).__name__)
async def test_only_the_bare_p0001_token_maps_to_the_refusal(failure: BaseException) -> None:
    client = _StubClient(raises=failure)

    with pytest.raises(BaseException) as caught:
        await er.replace_equity_snapshots_window(
            client, _rows(), ALLOCATOR_ID, 3, WINDOW_START
        )

    # The SAME exception object, not a refusal and not a wrapper.
    assert caught.value is failure
    assert not isinstance(caught.value, er.ForcedRebuildRefusedError)


def test_the_mapping_reads_code_and_message_never_details() -> None:
    # DETAIL is a count today; the rule is that it is never consulted, so a DETAIL
    # that happened to carry the token or row text cannot flip the mapping.
    assert er._window_replace_refusal(_api_error("P0001", TOKEN, details="x")) == TOKEN
    assert (
        er._window_replace_refusal(_api_error("P0001", "something else", details=TOKEN))
        is None
    )
    assert er._window_replace_refusal(RuntimeError(TOKEN)) is None


async def test_an_empty_payload_is_refused_before_the_rpc() -> None:
    client = _StubClient(result=0)

    with pytest.raises(ValueError):
        await er.replace_equity_snapshots_window(client, [], ALLOCATOR_ID, 3, WINDOW_START)

    assert client.calls == []
