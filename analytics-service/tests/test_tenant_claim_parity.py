"""TS-36 (146-02, D-146-3) — cross-language tenant-claim parity, Python side.

Binds ``services/rate_limit.py:verify_tenant_claim`` to the BYTES of the
committed fixture ``tests/fixtures/tenant-claim-parity.json`` at the REPO ROOT
(not ``analytics-service/tests/``). No re-derived table, no forked fixture:
each ``claim`` in that file was computed ONCE by a standalone ``node -e``
process (see the fixture's ``_comment``), so nothing on the expected side ever
asks the code under test what it expects.

⚠️ This fixture is ALSO bound by ``src/lib/tenant-claim.test.ts`` and
``src/lib/analytics-client.test.ts`` on the TypeScript side — editing it
reddens both suites by design. That is the point: a drift in either
implementation (TS mint or Python verify) reddens the OTHER language's suite.

The 2050/2030 ``exp`` cases are deliberate: far-future expiries keep the
expiry check from being a time bomb while still exercising it as an input.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import Request

from services import rate_limit as rl

#: Repo root = analytics-service/tests/ -> analytics-service/ -> root.
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tenant-claim-parity.json"
)


class _ClaimRequest:
    """Header-only Request stand-in — ``verify_tenant_claim`` reads only the
    ``X-Tenant-Claim`` header (same surface as ``_FakeRequest`` in
    ``test_limiter_identity.py``)."""

    def __init__(self, claim: str) -> None:
        self.headers = {rl.TENANT_CLAIM_HEADER: claim}


def _load_cases() -> list[dict[str, Any]]:
    raw = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))
    cases = raw["cases"]
    assert isinstance(cases, list)
    return cases


def test_fixture_is_present_and_populated() -> None:
    """Guard: a silently-empty load is a test that cannot fail."""
    assert _FIXTURE_PATH.is_file(), (
        f"committed parity fixture missing at {_FIXTURE_PATH} — the "
        "cross-language gate has no byte table to bind to"
    )
    assert len(_load_cases()) >= 4, (
        "the committed table carries at least 4 cases (tenant-a, tenant-b, "
        "uuid-payload, public-anonymous-different-secret); fewer means the "
        "fixture was truncated or forked"
    )


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: str(c["name"]))
def test_verify_tenant_claim_accepts_the_committed_bytes(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each committed ``claim`` verifies under its committed ``secret`` and
    returns exactly the committed ``payload`` — the same triple the TS suites
    pin from the mint side."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", case["secret"])
    request = cast(Request, _ClaimRequest(case["claim"]))
    assert rl.verify_tenant_claim(request) == case["payload"], (
        f"case {case['name']!r}: the Python verifier no longer accepts the "
        "committed wire bytes the TS mint is pinned to — the two "
        "implementations have drifted"
    )
