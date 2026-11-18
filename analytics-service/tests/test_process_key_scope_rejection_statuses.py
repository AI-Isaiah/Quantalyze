"""Per-arm status pin for the ``/process-key`` ``_scope_rejected`` gate.

Every arm of the synchronous rejection gate in ``routers/process_key.py`` is
pinned here at the status and ``recoverable`` value it answers.

The arms, by what the adapter's ``ValidationResult`` carries:

* the five permanent codes (``AUTH_FAILED``, ``PERMISSION_DENIED``,
  ``TRADE_SCOPE``, ``WITHDRAW_SCOPE``, ``MISSING_SCOPE``) answer **403** with
  ``recoverable`` false: a caller credential fault, an identical retry cannot
  succeed;
* OUR OWN ``VALIDATION_UNEXPECTED`` fallback (a write-capable key, no code to
  name it) answers **403** with ``recoverable`` false;
* a CSV validator verdict (the ``csv`` source with a non-null code other than
  ``CSV_UPSTREAM_FAIL``: the upper-cased rule family, ``CSV_VALIDATION_FAILED``,
  ``CSV_TOO_LARGE``, ``CSV_FORMAT_UNSUPPORTED``) answers **422** with
  ``recoverable`` false: a deterministic input fault, the same bytes fail the
  same rule on every retry;
* ``CSV_UPSTREAM_FAIL`` (the adapter's internal-fault code) and every OTHER
  code, venue codes included, answer **424** with ``recoverable`` true;
* the validate-only step (``_run_validate_only``) stays **200** with ``ok``
  false.

Lineage: Phase 215 pinned the old CSV arm at 424 under founder decision
Option A, "pin today, book the fix". Phase 216 CSVSTATUS made that fix and
changed the CSV cases on purpose.

The expected values are literals. Nothing here reads a status out of the router.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from services import exchange
from services.ingestion.adapter import ValidationResult
from tests.app_factory import build_test_app

# The router module comes FROM tests.test_process_key, never from a direct import:
# that module pops routers.process_key from sys.modules and re-imports it at load,
# so a direct import taken first would be a second module object whose decorators
# register a second pair of limits on the shared limiter.
from tests.test_process_key import (
    _auth_headers,
    _build_supabase_mock,
    process_key_router,
)

_TOKEN = "a" * 64  # the value _auth_headers sends as the bearer token


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    app = build_test_app(process_key_router.router)
    app.state.limiter = process_key_router.limiter
    return TestClient(app)


def _teaser_post(client, validation: ValidationResult, session: str):
    """POST the teaser flow with the adapter's validate() returning ``validation``.

    Returns ``(response, supabase_mock)``.
    """
    adapter = MagicMock()
    adapter.validate = AsyncMock(return_value=validation)
    fake = _build_supabase_mock(existing_row=None, insert_id=f"ver-{session}")
    with patch("routers.process_key.get_supabase", return_value=fake), patch(
        "routers.process_key.get_adapter", return_value=adapter
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": f"wiz-{session}",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )
    adapter.fetch_raw.assert_not_called()
    return r, fake


def _csv_post(client, validation: ValidationResult, session: str):
    """POST the synchronous CSV flow (the route csv_adapter's codes arrive on).

    Returns ``(response, supabase_mock)``.
    """
    adapter = MagicMock()
    adapter.validate = AsyncMock(return_value=validation)
    fake = _build_supabase_mock(existing_row=None, insert_id=f"ver-{session}")
    with patch("routers.process_key.get_supabase", return_value=fake), patch(
        "routers.process_key.get_adapter", return_value=adapter
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "wizard_session_id": f"wiz-{session}",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": "Y29sMSxjb2wyCjEsMg==",
                },
            },
            headers=_auth_headers(),
        )
    adapter.fetch_raw.assert_not_called()
    return r, fake


# (a) The five permanent codes: 403, recoverable false. ``valid`` mirrors what
# each adapter sets (the scope codes validate True with read_only False).
@pytest.mark.parametrize(
    "error_code,valid",
    [
        ("AUTH_FAILED", False),
        ("PERMISSION_DENIED", False),
        ("TRADE_SCOPE", True),
        ("WITHDRAW_SCOPE", True),
        ("MISSING_SCOPE", False),
    ],
)
def test_permanent_codes_answer_403_not_recoverable(client, error_code, valid):
    r, _ = _teaser_post(
        client,
        ValidationResult(
            valid=valid,
            read_only=False,
            error_code=error_code,
            human_message="Key rejected.",
            debug_context={},
        ),
        f"perm-{error_code}",
    )
    assert r.status_code == 403, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == error_code
    assert body["recoverable"] is False


# (b) OUR OWN fallback: no error code, a write-capable key.
def test_validation_unexpected_fallback_answers_403_not_recoverable(client):
    r, _ = _teaser_post(
        client,
        ValidationResult(
            valid=True,
            read_only=False,
            error_code=None,
            human_message="Key validation failed.",
            debug_context={},
        ),
        "fallback",
    )
    assert r.status_code == 403, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == "VALIDATION_UNEXPECTED"
    assert body["recoverable"] is False


# (c) A CSV validator verdict: 422 with recoverable false (Phase 216 contract).
# It is a deterministic input fault: an identical retry of the same bytes and
# ``fmt`` fails identically, so it is the CALLER class at 422 and not retryable.
# ``COERCE_DTYPE('DATETIME64[NS]')`` is the argument-carrying form pandera's
# coerce_dtype failure produces after ``.upper()``.
@pytest.mark.parametrize(
    "error_code",
    [
        "MONOTONIC_DATES",
        "COLUMN_IN_DATAFRAME",
        "PARSE_ERROR",
        "CSV_VALIDATION_FAILED",
        "DAILY_RETURN_LOWER_BOUND",
        "COERCE_DTYPE('DATETIME64[NS]')",
        "CSV_TOO_LARGE",
        "CSV_FORMAT_UNSUPPORTED",
    ],
)
def test_csv_validator_verdict_answers_422_not_recoverable(client, error_code):
    r, fake = _csv_post(
        client,
        ValidationResult(
            valid=False,
            read_only=None,
            error_code=error_code,
            human_message="Failed rule at row 5.",
            debug_context={},
        ),
        "csv-" + "".join(c for c in error_code if c.isalnum()),
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == error_code
    assert body["recoverable"] is False
    # The best-effort draft transition must still run BEFORE the 422 return, so
    # the verdict is recorded on the verification row. Hoisting the 422 arm above
    # the rpc would leave every assertion above green and drop this record.
    draft_calls = [
        c
        for c in fake.rpc.call_args_list
        if c.args
        and c.args[0] == "transition_strategy_verification"
        and c.args[1].get("p_new_status") == "draft"
    ]
    assert draft_calls, "the CSV rejection must transition the verification to draft"
    assert draft_calls[0].args[1]["p_metadata"]["errors"][0]["code"] == error_code


# (c2) The verdicts that stay 424 with recoverable true. Each row proves one
# clause of the Phase 216 arm. The first: the adapter's internal-fault code is
# retryable, so it is not a malformed file. The second: the request SOURCE
# discriminates, not the code string, so a CSV-looking code on a venue flow
# keeps the PYAPIFIX-02 default-transient shape.
@pytest.mark.parametrize(
    "poster,error_code",
    [
        pytest.param(_csv_post, "CSV_UPSTREAM_FAIL", id="csv-upstream-fail"),
        pytest.param(_teaser_post, "MONOTONIC_DATES", id="teaser-csv-looking-code"),
    ],
)
def test_retryable_verdicts_stay_424_recoverable(client, poster, error_code):
    r, _ = poster(
        client,
        ValidationResult(
            valid=False,
            read_only=None,
            error_code=error_code,
            human_message="Validation did not complete.",
            debug_context={},
        ),
        "retryable-" + "".join(c for c in error_code if c.isalnum()),
    )
    assert r.status_code == 424, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == error_code
    assert body["recoverable"] is True


# (d) The permanent set is exactly the five literals above, so a new permanent
# code (which would move an arm from 424 to 403) forces a decision in this file.
def test_permanent_set_is_exactly_the_five_pinned_codes():
    assert exchange.PERMANENT_VALIDATION_ERROR_CODES == frozenset(
        {
            "AUTH_FAILED",
            "PERMISSION_DENIED",
            "TRADE_SCOPE",
            "WITHDRAW_SCOPE",
            "MISSING_SCOPE",
        }
    )


# The sibling arm that answers differently. Phase 216 left it at 200 on
# purpose (CONTEXT: the validate-only arm is out of scope, the wizard renders
# its per-row verdicts from a 200): the validate-only step answers HTTP 200
# with ok false for an invalid validation, not 403, 422 or 424.
def test_validate_only_invalid_answers_200_ok_false(client):
    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=False,
            read_only=None,
            error_code="MONOTONIC_DATES",
            human_message="Failed rule 'monotonic_dates' at row 5.",
            debug_context={},
        )
    )
    fake = _build_supabase_mock(existing_row=None)
    with patch("routers.process_key.get_supabase", return_value=fake), patch(
        "routers.process_key.get_adapter", return_value=adapter
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "wizard_session_id": "wiz-validate-only-pin",
                    "user_id": "u1",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": "Y29sMSxjb2wyCjEsMg==",
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is False
