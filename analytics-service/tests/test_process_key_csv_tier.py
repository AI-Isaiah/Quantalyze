"""Phase 240 plan 04 / RLIM-02 (Python half) -- the CSV-scoped upstream tier on /process-key.

The edge admits 20 CSV validations per 60 s per signed-in user (1,200/hour), while
``/process-key`` gave that user 100/hour shared with key onboarding and resync: a
12x mismatch, so a user inside the edge limit could still be refused upstream. The
TS side now signs the scope into the claim as ``csv:<uuid>`` and Python gives that
payload its own per-user bucket, sized at three times the edge's per-window cap and
exempt from the platform ceiling.

What lives here, all over the REAL limiter stack on the REAL route:

* the edge limit (20) and the full 60/minute tier are admitted, call 61 refused;
* the csv bucket is separate from the same user's plain tenant bucket;
* the provider sizes the csv key at 60/minute;
* (Task 2) the ceiling exemption, its strictness and its fault default.

Oracle discipline (programme non-negotiable #3): every expected status, count and
bucket string is a LITERAL typed here. Claims are minted by the stdlib recipe in
``tests.test_process_key``, never by the module under test.

The router module comes FROM ``tests.test_process_key``, never from a direct
import: that module pops ``routers.process_key`` from ``sys.modules`` and
re-imports it, so a direct import would be a second module object whose
decorators register a second set of limits on the shared limiter.
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.test_process_key import (  # noqa: F401  (throttled_client is a fixture)
    _CLAIM_SECRET,
    _mint_claim,
    _post,
    process_key_router,
    throttled_client,
)

# Canonical lowercase uuids, typed out. Distinct, so isolation assertions are real.
_UUID_A = "0b8f2c4e-5d1a-4c7b-9e3f-6a2d8c1b7e90"
_UUID_B = "7e1d9a30-2b4c-4f85-8a6d-3c5e9b0f1a27"


def _csv_claim(user_id: str) -> str:
    return _mint_claim(f"csv:{user_id}")


def _admitted(resp: Any) -> bool:
    # raise_server_exceptions=False: an admitted request runs the real handler and
    # fails downstream (no DB in unit tests). Any non-429 means the limiter admitted.
    return bool(resp.status_code != 429)


# ---------------------------------------------------------------------------
# Task 1: the csv bucket, its size, its isolation
# ---------------------------------------------------------------------------


def test_the_edge_limits_twenty_csv_validations_are_never_refused_upstream(
    throttled_client: Any,
) -> None:
    """RLIM-02 tracer, constants at their REAL values. The edge allows 20 CSV
    validations per 60 s per user; every one of them must be admitted upstream.

    With the csv tier mis-sized below the edge limit this fails at or before call 20.
    """
    claim = _csv_claim(_UUID_A)

    for i in range(20):
        assert _admitted(_post(throttled_client, claim)), (
            f"call {i + 1} of the edge limit's 20 must never be refused upstream"
        )


def test_the_csv_tier_admits_sixty_calls_in_a_window_and_refuses_the_sixty_first(
    throttled_client: Any,
) -> None:
    """Edge (boundary), constants at their REAL values: call 60 is admitted and call
    61 inside the same window is refused.

    Under the pre-240 grammar the csv claim was a plain tenant at 100/hour, so call
    61 would be admitted and this test fails there on the final assertion.
    """
    claim = _csv_claim(_UUID_A)

    for i in range(60):
        assert _admitted(_post(throttled_client, claim)), (
            f"call {i + 1} of the 60/minute csv tier must be admitted"
        )
    assert _post(throttled_client, claim).status_code == 429, (
        "call 61 inside the same window must be refused: the csv tier is 60/minute, "
        "not the 100/hour tenant tier"
    )


def test_the_csv_bucket_is_separate_from_the_users_tenant_bucket_and_from_other_users(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CSV traffic never spends the same user's 100/hour onboard and resync window,
    and one user's csv window never throttles another user's."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_CSV_LIMIT", "2/minute")
    csv_a = _csv_claim(_UUID_A)

    assert [_admitted(_post(throttled_client, csv_a)) for _ in range(3)] == [
        True,
        True,
        False,
    ]
    # The same user's plain tenant claim (onboard / resync) has its own bucket.
    assert _admitted(_post(throttled_client, _mint_claim(_UUID_A))), (
        "the user's plain tenant bucket must be untouched by csv traffic"
    )
    # A second csv-scoped user has a virgin window.
    assert _admitted(_post(throttled_client, _csv_claim(_UUID_B))), (
        "another user's csv window must be untouched"
    )


def test_the_provider_sizes_a_csv_key_at_sixty_per_minute() -> None:
    limit_for = process_key_router._process_key_limit_for

    assert limit_for(f"process_key:csv:{_UUID_A}") == "60/minute"
    # The shared tenant tier is NOT retuned: SC-4 is met by the csv tier.
    assert limit_for("process_key:t:tenant-a") == "100/hour"
    # A tenant whose id merely starts with "csv:" is a TENANT key, not a csv one.
    assert limit_for(f"process_key:t:csv:{_UUID_A}") == "100/hour"
    assert limit_for("process_key:anon") == "30/hour"


# ---------------------------------------------------------------------------
# Task 2: the platform-ceiling exemption, strictly
# ---------------------------------------------------------------------------

# Two distinct, well-formed 32-lowercase-hex per-IP pseudonyms, typed out.
_PSEUDONYM_X = "0123456789abcdef0123456789abcdef"
_PSEUDONYM_Y = "fedcba9876543210fedcba9876543210"


def _saturate_the_ceiling(client: Any) -> None:
    """With the ceiling at 3/hour: three tenants are admitted and the fourth refused,
    so the platform ceiling is provably full before the assertion under test."""
    for name in ("tenant-a", "tenant-b", "tenant-c"):
        assert _admitted(_post(client, _mint_claim(name))), f"{name} fills one ceiling slot"
    assert _post(client, _mint_claim("tenant-d")).status_code == 429, (
        "the ceiling (shrunk to 3/hour) must be full before the exemption is tested"
    )


def test_a_csv_scoped_call_is_admitted_after_tenant_traffic_saturated_the_ceiling(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RLIM-02: the 500/hour ceiling must not refuse a csv-scoped user, or "a CSV user
    inside the edge limit never gets an upstream 429" is false. Ceiling shrunk to
    3/hour and saturated by tenants, then a csv-scoped call is still admitted.

    Without ``exempt_when`` on the ceiling decorator the csv call is refused here.
    """
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_CEILING_LIMIT", "3/hour")
    _saturate_the_ceiling(throttled_client)

    assert _admitted(_post(throttled_client, _csv_claim(_UUID_A))), (
        "a strictly csv-scoped call must be exempt from the platform ceiling"
    )
    assert _admitted(_post(throttled_client, _csv_claim(_UUID_B)))


@pytest.mark.parametrize(
    "payload",
    [
        "csv:NOT-A-UUID",
        "csv:" + _UUID_A.upper(),
        "csv:" + _UUID_A + "x",
        "csv:",
    ],
    ids=["non-uuid", "uppercase", "trailing-char", "empty"],
)
def test_a_malformed_csv_payload_is_not_exempt_from_the_ceiling(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch, payload: str
) -> None:
    """Strictness: only a strict csv-scoped claim is exempt. A malformed ``csv:``
    payload buckets to the generic tenant arm and is refused at the ceiling."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_CEILING_LIMIT", "3/hour")
    _saturate_the_ceiling(throttled_client)

    assert _post(throttled_client, _mint_claim(payload)).status_code == 429, (
        "a malformed csv payload must NOT be exempt from the platform ceiling"
    )


def test_a_malformed_csv_payload_buckets_to_the_generic_tenant_arm_at_100_per_hour() -> None:
    limit_for = process_key_router._process_key_limit_for

    # The key function's output for a malformed payload is `process_key:t:csv:...`.
    assert limit_for("process_key:t:csv:NOT-A-UUID") == "100/hour"


def test_csv_traffic_never_consumes_an_anonymous_aggregate_slot(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """csv is not an anonymous kind: with the aggregate at 1/hour, csv calls leave
    the one slot free, the first anonymous call after them takes it and the second
    anonymous call, from another pseudonym, is refused by the aggregate."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_AGGREGATE_LIMIT", "1/hour")

    for i in range(3):
        assert _admitted(_post(throttled_client, _csv_claim(_UUID_A))), f"csv call {i + 1}"
    assert _admitted(
        _post(throttled_client, _mint_claim(f"public:{_PSEUDONYM_X}"))
    ), "a csv call spent the one aggregate slot"
    assert (
        _post(throttled_client, _mint_claim(f"public:{_PSEUDONYM_Y}")).status_code == 429
    ), "the aggregate is live at 1/hour, so the second anonymous call is refused"


def _request_with(claim: str | None) -> Any:
    from unittest.mock import MagicMock

    r = MagicMock()
    r.headers = {"X-Tenant-Claim": claim} if claim is not None else {}
    return r


def test_the_csv_predicate_is_true_only_for_a_strict_csv_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", _CLAIM_SECRET)
    is_csv = process_key_router._process_key_is_csv_scoped

    assert is_csv(_request_with(_csv_claim(_UUID_A))) is True
    assert is_csv(_request_with(_mint_claim(_UUID_A))) is False
    assert is_csv(_request_with(_mint_claim("public"))) is False
    assert is_csv(_request_with(_mint_claim(f"public:{_PSEUDONYM_X}"))) is False
    assert is_csv(_request_with(_mint_claim("csv:NOT-A-UUID"))) is False
    assert is_csv(_request_with(_mint_claim("csv:" + _UUID_A.upper()))) is False
    assert is_csv(_request_with(None)) is False


def test_the_csv_predicate_refuses_rather_than_skips_on_a_fault(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G-8 / T-240-15: an exempt_when that raises becomes a bodyless 500, and one that
    defaults to exempt would silently skip the ceiling on a fault. On a fault the
    predicate answers 'not exempt' (False) and raises nothing."""

    def _boom(request: Any) -> Any:
        raise RuntimeError("classifier fault")

    monkeypatch.setattr(process_key_router, "classify_tenant_claim", _boom)
    assert process_key_router._process_key_is_csv_scoped(object()) is False


def test_the_stack_still_has_exactly_three_limits_in_the_same_order() -> None:
    """The exemption rides the EXISTING ceiling decorator: no fourth limit, and the
    ceiling stays the last limit evaluated."""
    groups = process_key_router.limiter._dynamic_route_limits[
        "routers.process_key.process_key"
    ]
    assert [g.key_function.__name__ for g in groups] == [
        "_process_key_rate_limit_key",
        "_process_key_anon_aggregate_key",
        "_process_key_ceiling_key",
    ]
