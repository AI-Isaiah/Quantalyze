"""Phase 240 CONN-05 — an adapter's STATED ``permanent`` decides the sync arms.

``ValidationResult.permanent`` is tri-state (see ``services/ingestion/adapter.py``).
``services/ingestion/long_fetch.py`` honours both directions. The two adapter-fed
validation arms in ``routers/process_key.py`` (the synchronous gate and
``_run_validate_only``'s invalid return) honour a stated **True only**, by the
Phase 240 CONTEXT decision:

* a stated True answers permanent: 403 with ``recoverable`` false at the
  synchronous gate (whatever the code: MT5_WRONG_SERVER and MT5_MASTER_PASSWORD
  are not in ``PERMANENT_VALIDATION_ERROR_CODES`` and used to land on the 424
  retryable arm), and ``recoverable`` false on the validate-only 200;
* a stated False and None keep the code-derived HEAD verdict, byte for byte.
  A stated False never turns a credential or scope 403 into a retryable 424.

The table below is the whole decision, typed literally. Nothing here reads a
status out of the router. The live MT5 path is the worker today (MT5 is admitted
to onboard and resync only and ``_is_long_fetch`` routes both there), so these
rows pin the contract of the route, not a current production path.

Import discipline: the router comes through ``tests.test_process_key`` by way of
the scope-rejection module, never from a direct import (see the note there and in
``tests/test_envelope_recoverable.py``). Only underscore helpers and the fixture
are imported by name, so no ``test_`` function is collected twice.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ingestion.adapter import ValidationResult
from tests.test_process_key import _auth_headers, _build_supabase_mock
from tests.test_process_key_scope_rejection_statuses import (  # noqa: F401
    _teaser_post,
    client,
)


def _result(
    *,
    valid: bool,
    read_only: bool | None,
    error_code: str | None,
    permanent: bool | None,
) -> ValidationResult:
    return ValidationResult(
        valid=valid,
        read_only=read_only,
        error_code=error_code,
        human_message="Key rejected.",
        debug_context={},
        permanent=permanent,
    )


# (id, valid, read_only, error_code, stated permanent, status, recoverable, code)
_SYNC_ROWS = [
    ("true-mt5-wrong-server", False, None, "MT5_WRONG_SERVER", True, 403, False, "MT5_WRONG_SERVER"),
    ("true-mt5-master-password", False, None, "MT5_MASTER_PASSWORD", True, 403, False, "MT5_MASTER_PASSWORD"),
    ("true-auth-failed", False, None, "AUTH_FAILED", True, 403, False, "AUTH_FAILED"),
    ("false-auth-failed", False, None, "AUTH_FAILED", False, 403, False, "AUTH_FAILED"),
    ("false-permission-denied", False, None, "PERMISSION_DENIED", False, 403, False, "PERMISSION_DENIED"),
    ("false-trade-scope", True, False, "TRADE_SCOPE", False, 403, False, "TRADE_SCOPE"),
    ("false-withdraw-scope", True, False, "WITHDRAW_SCOPE", False, 403, False, "WITHDRAW_SCOPE"),
    ("false-missing-scope", False, None, "MISSING_SCOPE", False, 403, False, "MISSING_SCOPE"),
    ("false-no-code-read-only-false", True, False, None, False, 403, False, "VALIDATION_UNEXPECTED"),
    ("false-mt5-server-unknown", False, None, "MT5_SERVER_UNKNOWN", False, 424, True, "MT5_SERVER_UNKNOWN"),
    ("none-auth-failed", False, None, "AUTH_FAILED", None, 403, False, "AUTH_FAILED"),
    ("none-rate-limited", False, None, "RATE_LIMITED", None, 424, True, "RATE_LIMITED"),
    ("none-no-code-read-only-false", True, False, None, None, 403, False, "VALIDATION_UNEXPECTED"),
]


@pytest.mark.parametrize(
    "case_id,valid,read_only,error_code,permanent,status,recoverable,code",
    _SYNC_ROWS,
    ids=[row[0] for row in _SYNC_ROWS],
)
def test_synchronous_gate_decision_table(
    client,  # noqa: F811
    case_id,
    valid,
    read_only,
    error_code,
    permanent,
    status,
    recoverable,
    code,
):
    r, _ = _teaser_post(
        client,
        _result(
            valid=valid,
            read_only=read_only,
            error_code=error_code,
            permanent=permanent,
        ),
        f"permplumb-{case_id}",
    )
    assert r.status_code == status, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == code
    assert body["recoverable"] is recoverable


def _validate_only_post(client, validation: ValidationResult, session: str):
    """The validate-only request of ``test_validate_only_invalid_answers_200_ok_false``.

    Only the ValidationResult differs from that driver.
    """
    adapter = MagicMock()
    adapter.validate = AsyncMock(return_value=validation)
    fake = _build_supabase_mock(existing_row=None)
    with patch("routers.process_key.get_supabase", return_value=fake), patch(
        "routers.process_key.get_adapter", return_value=adapter
    ):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "wizard_session_id": f"wiz-{session}",
                    "user_id": "u1",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": "Y29sMSxjb2wyCjEsMg==",
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )


# (id, error_code, stated permanent, recoverable)
_VALIDATE_ONLY_ROWS = [
    ("true-mt5-wrong-server", "MT5_WRONG_SERVER", True, False),
    ("false-auth-failed", "AUTH_FAILED", False, False),
]


@pytest.mark.parametrize(
    "case_id,error_code,permanent,recoverable",
    _VALIDATE_ONLY_ROWS,
    ids=[row[0] for row in _VALIDATE_ONLY_ROWS],
)
def test_validate_only_decision_table(
    client,  # noqa: F811
    case_id,
    error_code,
    permanent,
    recoverable,
):
    r = _validate_only_post(
        client,
        _result(
            valid=False,
            read_only=None,
            error_code=error_code,
            permanent=permanent,
        ),
        f"permplumb-vo-{case_id}",
    )
    # The validate-only step keeps its deliberate 200 (shape 6 of
    # tests/test_process_key_200_discriminator.py); only recoverable moves.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == error_code
    assert body["recoverable"] is recoverable
