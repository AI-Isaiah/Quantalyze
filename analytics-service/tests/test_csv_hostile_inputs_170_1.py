"""170.1 / D-10 follow-up: a rejected CSV returns its pandera rows and never
raises, and no caller ever sends or logs the text of a cell.

The defect (reproduced at HEAD 712c47eea): a non-numeric cell in the
`daily_return` column made `validate_csv` RAISE `TypeError: could not convert
string to float: '<the cell>'`. Pandera had already emitted the right
`coerce_dtype('float64')` row. On the SchemaErrors fallback the code keeps the
UNVALIDATED frame (`df_validated = df`), and the dataset-level sentinels then did
float maths on string cells. The three callers turned that escape into a leak:
`routers/csv.py` returned `str(e)` to the client and logged it, and
`csv_adapter.py` / `/process-key` (validate-only) either echoed `str(exc)` or
let the TypeError out as a bodyless 500 whose traceback carries the cell.

A second escape, found by the enumeration in the same round: a data row with MORE
fields than the header makes pandas promote the first column to the frame's INDEX,
and the row-number step (`int(failure.index) + 1`) then did `int("<a date>")` and
raised a ValueError whose text carries a cell.

Every cell value below is a synthetic marker (`ZXQCELL`). No real data.

Where each assertion looks, and why `preview` is excluded: a rejected envelope's
`preview` is the first/last rows of the user's own upload (declared columns only,
PII-named columns masked). That is the preview feature working as designed and is
not the subject here; the subject is the error path, so the response checks cover
everything EXCEPT `preview`.
"""
from __future__ import annotations

import base64
import json
import logging
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.csv_validator import validate_csv

MARKER = "ZXQCELL"

HEADER = {
    "daily_returns": "date,daily_return",
    "daily_nav": "date,nav",
    "trades": "date,side,qty,price,symbol,currency",
}
GOOD_ROWS = {
    "daily_returns": ["2024-01-01,0.01", "2024-01-02,0.02", "2024-01-03,-0.01"],
    "daily_nav": ["2024-01-01,100", "2024-01-02,101", "2024-01-03,102"],
    "trades": [
        "2024-01-01,buy,1,10,BTC,USD",
        "2024-01-02,sell,1,11,BTC,USD",
        "2024-01-03,buy,2,12,BTC,USD",
    ],
}

# The new sentence for a data row with more fields than the header. Hand-typed
# on purpose: a reworded producer message must fail here, and the WR-01 parity
# specimen for this rule is typed from the same sentence.
RAGGED_ROW_MESSAGE = "Could not parse CSV: a data row has more fields than the header row."


def _csv(fmt: str, rows: list[str] | None = None, header: str | None = None) -> bytes:
    body = rows if rows is not None else GOOD_ROWS[fmt]
    return ((header if header is not None else HEADER[fmt]) + "\n" + "\n".join(body) + "\n").encode()


def _without_preview(envelope: dict) -> str:
    return json.dumps({k: v for k, v in envelope.items() if k != "preview"}, default=str)


# Each trigger: (id, fmt, bytes, expected [(rule, row)] prefix-or-None)
NON_NUMERIC_TRIGGERS = [
    pytest.param(
        "daily_returns",
        _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,{MARKER}", "2024-01-03,0.02"]),
        id="marker-in-one-daily_return-cell",
    ),
    pytest.param(
        "daily_returns",
        _csv("daily_returns", [f"2024-01-01,{MARKER}", f"2024-01-02,{MARKER}"]),
        id="marker-in-every-daily_return-cell",
    ),
    pytest.param(
        "daily_returns",
        _csv("daily_returns", ["2024-01-01,0.01", f'2024-01-02,"{MARKER}\n{MARKER}"', "2024-01-03,0.02"]),
        id="quoted-newline-in-daily_return-cell",
    ),
    pytest.param(
        "daily_returns",
        _csv("daily_returns", ["2024-01-01,0.01", "2024-01-02,1.2.3", "2024-01-03,0x10"]),
        id="malformed-number-shapes",
    ),
    pytest.param(
        "daily_returns",
        _csv("daily_returns", ["2024-01-01,(5)", "2024-01-02,1e3", "2024-01-03,"]),
        id="mixed-numeric-shapes-in-daily_return",
    ),
    pytest.param(
        "daily_returns",
        _csv("daily_returns", [f"13/02/2024,0.01", f"14/02/2024,{MARKER}", "15/02/2024,0.02"]),
        id="day-first-dates-plus-marker",
    ),
]


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("fmt,raw", NON_NUMERIC_TRIGGERS)
def test_non_numeric_daily_return_is_rejected_with_pandera_rows_not_raised(
    fmt: str, raw: bytes, caplog: pytest.LogCaptureFixture
) -> None:
    """The producer must not run the dataset-level sentinels on a frame that
    failed schema validation: a rejected file returns its pandera rows."""
    with caplog.at_level(logging.DEBUG):
        envelope = validate_csv(raw, fmt)  # must not raise

    assert envelope["ok"] is False
    assert envelope["errors"], "a rejected file must say why"
    # No marker anywhere in the error path, and none in what was logged.
    assert MARKER not in _without_preview(envelope)
    assert MARKER not in caplog.text


def test_marker_in_second_daily_return_row_is_labelled_at_row_two() -> None:
    """The user-visible outcome: ok false, a `coerce_dtype` row at the row the
    cell is on, in the 1-based numbering the wizard prints."""
    raw = _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,{MARKER}", "2024-01-03,0.02"])
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is False
    coerce = [e for e in envelope["errors"] if e["rule"].startswith("coerce_dtype")]
    assert [(e["rule"], e["row"], e.get("column")) for e in coerce] == [
        ("coerce_dtype('float64')", 2, "daily_return")
    ]


def test_sentinels_still_run_on_a_file_that_passed_schema_validation() -> None:
    """Control for the guard: it must not switch the sentinels off for good
    files. A dollar-PnL series (max |x| above the percent-form ceiling, so it is
    not auto-normalised) passes the per-row bounds and is rejected by the
    dataset-level sentinel only."""
    rows = ["2024-01-01,500", "2024-01-02,300", "2024-01-03,450"]
    envelope = validate_csv(_csv("daily_returns", rows), "daily_returns")

    assert envelope["ok"] is False
    assert "daily_return_dollar_form_sentinel" in {e["rule"] for e in envelope["errors"]}


def test_sentinel_still_runs_when_the_column_is_numeric_but_another_rule_failed() -> None:
    """The guard is the column's TYPE, not the schema verdict. A dollar-PnL file
    with a day below -100 also fails `daily_return_lower_bound`; its user still
    needs the actionable dollar-PnL sentence, not just the bare bound rule."""
    rows = ["2024-01-01,-329", "2024-01-02,171", "2024-01-03,-240", "2024-01-04,410"]
    envelope = validate_csv(_csv("daily_returns", rows), "daily_returns")

    rules = {e["rule"] for e in envelope["errors"]}
    assert "daily_return_lower_bound" in rules
    assert "daily_return_dollar_form_sentinel" in rules


RAGGED_TRIGGERS = [
    pytest.param(
        fmt,
        _csv(fmt, [GOOD_ROWS[fmt][0] + f",{MARKER}", *GOOD_ROWS[fmt][1:]]),
        id=f"{fmt}-first-data-row-has-an-extra-field",
    )
    for fmt in HEADER
] + [
    pytest.param(
        fmt,
        _csv(fmt, [r + f",{MARKER}" for r in GOOD_ROWS[fmt]]),
        id=f"{fmt}-every-data-row-has-an-extra-field",
    )
    for fmt in HEADER
] + [
    pytest.param(
        fmt,
        _csv(fmt, [GOOD_ROWS[fmt][0] + f",{MARKER},{MARKER},{MARKER}", GOOD_ROWS[fmt][1]]),
        id=f"{fmt}-first-data-row-has-many-extra-fields",
    )
    for fmt in HEADER
] + [
    pytest.param(
        "trades",
        _csv("trades", GOOD_ROWS["trades"], header="date,side,qty,price,symbol"),
        id="trades-header-is-one-field-short",
    ),
]


@pytest.mark.parametrize("fmt,raw", RAGGED_TRIGGERS)
def test_a_data_row_with_extra_fields_is_a_named_parse_error_not_a_raise(
    fmt: str, raw: bytes, caplog: pytest.LogCaptureFixture
) -> None:
    """pandas promotes the first column to the INDEX when a data row is longer
    than the header; the row-number step then did int('<a date>') and raised a
    ValueError carrying a cell. It is now one named, cell-free rejection."""
    with caplog.at_level(logging.DEBUG):
        envelope = validate_csv(raw, fmt)  # must not raise

    assert envelope["ok"] is False
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, RAGGED_ROW_MESSAGE)
    ]
    assert envelope["preview"] is None
    assert MARKER not in json.dumps(envelope, default=str)
    assert MARKER not in caplog.text


def test_a_ragged_row_after_the_first_data_row_keeps_its_pandas_parse_error() -> None:
    """Control: the shape that already returned `parse_error` is untouched."""
    raw = _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,0.02,{MARKER}", "2024-01-03,0.03"])
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is False
    assert [(e["rule"], e["row"]) for e in envelope["errors"]] == [("parse_error", 0)]
    assert MARKER not in json.dumps(envelope, default=str)


# ---------------------------------------------------------------------------
# routers/csv.py via TestClient
# ---------------------------------------------------------------------------


@pytest.fixture
def csv_client():
    import routers.csv as csv_router

    app = FastAPI()
    app.state.limiter = csv_router.limiter
    app.include_router(csv_router.router)
    return TestClient(app, raise_server_exceptions=False)


def _post_csv(client: TestClient, raw: bytes, fmt: str = "daily_returns"):
    return client.post(
        "/api/csv/validate",
        files={"file": ("upload.csv", raw, "text/csv")},
        data={"fmt": fmt, "wizard_session_id": "wiz-170-1"},
    )


def test_route_non_numeric_cell_is_a_200_envelope_with_a_coerce_dtype_row(
    csv_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    raw = _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,{MARKER}", "2024-01-03,0.02"])
    with caplog.at_level(logging.DEBUG):
        resp = _post_csv(csv_client, raw)

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert ("coerce_dtype('float64')", 2) in {(e["rule"], e["row"]) for e in body["errors"]}
    assert MARKER not in _without_preview(body)
    assert MARKER not in caplog.text


def test_route_extra_field_row_is_a_200_parse_error_envelope(
    csv_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    raw = _csv("daily_returns", [f"2024-01-01,0.01,{MARKER}", "2024-01-02,0.02"])
    with caplog.at_level(logging.DEBUG):
        resp = _post_csv(csv_client, raw)

    assert resp.status_code == 200
    body = resp.json()
    assert [(e["rule"], e["row"], e["message"]) for e in body["errors"]] == [
        ("parse_error", 0, RAGGED_ROW_MESSAGE)
    ]
    assert MARKER not in resp.text
    assert MARKER not in caplog.text


@pytest.mark.parametrize("exc_type", [ValueError, TypeError, RuntimeError])
def test_route_never_echoes_or_logs_an_unexpected_exception_text(
    csv_client: TestClient, caplog: pytest.LogCaptureFixture, exc_type: type[Exception]
) -> None:
    """Defence in depth, independent of the producer fix: whatever escapes
    `validate_csv`, the client body and the log carry no exception text."""
    raw = _csv("daily_returns")

    def boom(_raw: bytes, _fmt: str):
        raise exc_type(f"could not convert string to float: '{MARKER}'")

    with patch("routers.csv.validate_csv", boom), caplog.at_level(logging.DEBUG):
        resp = _post_csv(csv_client, raw)

    assert resp.status_code == 500
    body = resp.json()
    assert body["detail"]["ok"] is False
    assert body["detail"]["code"] == "CSV_UPSTREAM_FAIL"
    assert MARKER not in resp.text
    assert MARKER not in caplog.text
    # The log keeps what is safe and useful: the exception TYPE.
    assert exc_type.__name__ in caplog.text


def test_route_bad_fmt_keeps_its_fixed_400_sentence(csv_client: TestClient) -> None:
    resp = _post_csv(csv_client, _csv("daily_returns"), fmt=MARKER)

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["code"] == "CSV_INVALID_FORMAT"
    assert detail["human_message"] == "fmt must be one of daily_returns, daily_nav, trades."


# ---------------------------------------------------------------------------
# services/ingestion/csv_adapter.py
# ---------------------------------------------------------------------------


def _adapter_request(raw: bytes, fmt: str):
    from services.ingestion.adapter import KeySubmissionRequest

    return KeySubmissionRequest(
        flow_type="csv",
        source="csv",
        context={
            "raw_bytes": raw,
            "fmt": fmt,
            "wizard_session_id": "wiz-170-1",
            "user_id": "user-170-1",
        },
    )


async def test_adapter_non_numeric_cell_is_a_rejection_with_a_coerce_dtype_row(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from services.ingestion.csv_adapter import CsvAdapter

    raw = _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,{MARKER}", "2024-01-03,0.02"])
    with caplog.at_level(logging.DEBUG):
        result = await CsvAdapter().validate(_adapter_request(raw, "daily_returns"))

    assert result.valid is False
    violations = result.debug_context["violations"]
    assert ("coerce_dtype('float64')", 2) in {(v["rule"], v["row"]) for v in violations}
    assert MARKER not in repr(result)
    assert MARKER not in caplog.text


@pytest.mark.parametrize("exc_type", [ValueError, TypeError, KeyError])
async def test_adapter_never_echoes_or_logs_an_unexpected_exception_text(
    caplog: pytest.LogCaptureFixture, exc_type: type[Exception]
) -> None:
    """A ValueError used to be labelled CSV_FORMAT_UNSUPPORTED with `str(exc)` as
    the client message; any other exception type was not caught at all."""
    from services import csv_validator
    from services.ingestion.csv_adapter import CsvAdapter

    def boom(_raw: bytes, _fmt: str):
        raise exc_type(f"invalid literal for int() with base 10: '{MARKER}'")

    with patch.object(csv_validator, "validate_csv", boom), caplog.at_level(logging.DEBUG):
        result = await CsvAdapter().validate(_adapter_request(_csv("daily_returns"), "daily_returns"))

    assert result.valid is False
    assert result.error_code == "CSV_UPSTREAM_FAIL"
    assert result.human_message == "CSV validation failed. Please retry."
    assert MARKER not in repr(result)
    assert MARKER not in caplog.text
    assert exc_type.__name__ in caplog.text


async def test_adapter_unsupported_fmt_is_a_fixed_sentence_that_never_echoes_the_fmt(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from services.ingestion.csv_adapter import CsvAdapter

    with caplog.at_level(logging.DEBUG):
        result = await CsvAdapter().validate(_adapter_request(_csv("daily_returns"), MARKER))

    assert result.valid is False
    assert result.error_code == "CSV_FORMAT_UNSUPPORTED"
    assert result.human_message == "fmt must be one of daily_returns, daily_nav, trades."
    assert MARKER not in repr(result)
    assert MARKER not in caplog.text


# ---------------------------------------------------------------------------
# /process-key validate-only path
# ---------------------------------------------------------------------------

_TOKEN = "a" * 64
_TEST_CID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def process_key_client(monkeypatch):
    import routers.process_key as process_key_router

    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    app = FastAPI()
    app.state.limiter = process_key_router.limiter
    app.include_router(process_key_router.router)
    # The 500 case must be observed as the client sees it (a response), not as
    # the exception re-raised into the test.
    return TestClient(app, raise_server_exceptions=False)


def _post_validate_only(client: TestClient, raw: bytes, fmt: str = "daily_returns"):
    with patch("routers.process_key.get_supabase", return_value=MagicMock()):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "validate",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-170-1",
                    "fmt": fmt,
                    "raw_bytes_base64": base64.b64encode(raw).decode("ascii"),
                },
            },
            headers={"Authorization": f"Bearer {_TOKEN}", "X-Correlation-Id": _TEST_CID},
        )


def test_process_key_validate_only_non_numeric_cell_returns_the_coerce_dtype_row(
    process_key_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    raw = _csv("daily_returns", ["2024-01-01,0.01", f"2024-01-02,{MARKER}", "2024-01-03,0.02"])
    with caplog.at_level(logging.DEBUG):
        resp = _post_validate_only(process_key_client, raw)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is False
    rows = body["debug_context"]["pandera_errors"]
    assert ("coerce_dtype('float64')", 2) in {(r["rule"], r["row"]) for r in rows}
    assert MARKER not in resp.text
    assert MARKER not in caplog.text


def test_process_key_validate_only_extra_field_row_returns_the_parse_error(
    process_key_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    raw = _csv("daily_returns", [f"2024-01-01,0.01,{MARKER}", "2024-01-02,0.02"])
    with caplog.at_level(logging.DEBUG):
        resp = _post_validate_only(process_key_client, raw)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is False
    rows = body["debug_context"]["pandera_errors"]
    assert [(r["rule"], r["row"], r["message"]) for r in rows] == [
        ("parse_error", 0, RAGGED_ROW_MESSAGE)
    ]
    assert MARKER not in resp.text
    assert MARKER not in caplog.text


def test_process_key_validate_only_unexpected_exception_is_an_envelope_not_a_bodyless_500(
    process_key_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Before the fix a TypeError out of `validate_csv` was not caught anywhere
    on this path: a bodyless 500 whose server-side traceback carries the cell."""
    from services import csv_validator

    def boom(_raw: bytes, _fmt: str):
        raise TypeError(f"could not convert string to float: '{MARKER}'")

    with patch.object(csv_validator, "validate_csv", boom), caplog.at_level(logging.DEBUG):
        resp = _post_validate_only(process_key_client, _csv("daily_returns"))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is False
    assert body["code"] == "CSV_UPSTREAM_FAIL"
    assert MARKER not in resp.text
    assert MARKER not in caplog.text
