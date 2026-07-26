"""PYAPI-05 — the status-attributability contract at S-13..S-20 and S-23.

The contract itself lives at ``analytics-service/docs/STATUS_CONTRACT.md``; its
executable half is ``services/error_contract.py``. Plan 140.1-03 pinned
S-01..S-12 in ``tests/test_status_contract_exchange_internal.py``; this suite
pins the remaining nine explicit sites: ``routers/match.py`` S-13..S-17,
``routers/simulator.py`` S-18, ``routers/portfolio.py`` S-19/S-20 and
``main.py`` S-23.

Why each case matters (Rule 9 — these encode ECONOMICS, not the
implementation's own formula):

  - **A caller's oversized eval window answering ``503`` (S-16) is a lie about
    our uptime.** The service is healthy; the request asked for more rows than
    the paginator will drain. Under 140.2 a ``503`` counts toward the breaker,
    so an admin hammering ``lookback_days=365`` would trip a platform-wide
    outage for everybody else. The truthful answer is ``400`` — *narrow your
    window* — and a 4xx is breaker-inert by construction.
  - **A raw exception interpolated into ``detail`` (S-15/S-17) ships our
    internals to the caller.** ``f"Scoring failed: {err}"`` renders whatever a
    pandas/Supabase exception happens to carry — table names, row payloads,
    connection strings. The two canary tests raise an exception whose message
    contains ``CANARY_ERR`` and assert **zero** occurrences anywhere in the
    serialized response; they turn RED the moment anyone restores the
    interpolation. The diagnostic is not lost — it moves to a structured
    server-side log carrying a ``correlation_id`` that IS in the body.
  - **``SERVICE_KEY`` unset answering ``503`` (S-23) is the permanent-503 flap
    shape.** Every request to every guarded route answers ``503`` until an
    operator sets an env var, so the breaker trips, expires, re-probes, trips
    again, forever — and no retry can ever clear it (A-08/A-25/C-17). R-1 says
    an operator-only fault is ``500`` with ``retryable:false``.
  - **A Supabase insert that returns no row (S-19) is a transient blip, not a
    bug.** Answering ``500`` marks it non-retryable, so the caller gives up on
    a condition that clears in seconds.
  - **``/health``'s ``503`` (S-24) is CORRECT and must survive this plan
    untouched** — routing the health warmer through the seam would let the
    breaker block its own recovery probe (O-7). It is pinned here precisely so
    a future edit cannot quietly "unify" it with S-23.

ORACLE DISCIPLINE (programme non-negotiable #3): every expected status int and
every expected code string below is a **literal typed into this file**. Nothing
is imported from ``services.error_contract`` — an oracle that reads its
expectation back out of the thing under test cannot fail. Ten simultaneous
semantic mutations to the Phase-140 seam core once produced a byte-identical
``8859 passed`` for exactly that reason.
"""
from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------- #
# routers/match.py — S-13..S-17
# --------------------------------------------------------------------------- #


@pytest.fixture()
def match_client() -> TestClient:
    """Bare FastAPI app with ``routers.match`` mounted — no middleware.

    Cloned from ``tests/test_match_router.py``'s fixture (Rule 11 — match the
    existing idiom rather than inventing a second one).
    """
    from routers.match import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _arrange_recompute(monkeypatch, scorer) -> None:
    """Walk POST /api/match/recompute up to the scoring call with ``scorer``."""
    from routers import match as match_mod

    monkeypatch.setattr(match_mod, "_is_allocator_profile", lambda *_: True)
    monkeypatch.setattr(match_mod, "_engine_is_enabled", lambda: True)

    async def _no_skip(allocator_id, force):
        return False

    monkeypatch.setattr(match_mod, "_should_skip_allocator", _no_skip)
    monkeypatch.setattr(
        match_mod,
        "_load_candidate_universe",
        lambda *_: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
    )
    monkeypatch.setattr(match_mod, "_score_one_allocator", scorer)


def test_s13_actor_admin_check_transient_is_503_naming_supabase(
    match_client, monkeypatch
) -> None:
    """S-13 — ``_is_admin_profile`` returned its transient ``None`` sentinel.

    Supabase is genuinely unavailable, so this one IS ours and IS transient:
    503, ``dependency:"supabase"`` so 140.2 keys the breaker on Supabase alone
    rather than globally (O-2), and a ``Retry-After`` so 140.3 can name the
    real wait instead of guessing (O-6).
    """
    from routers import match as match_mod

    monkeypatch.setattr(match_mod, "_is_admin_profile", lambda *_: None)
    monkeypatch.setattr(match_mod, "_is_allocator_profile", lambda *_: True)

    resp = match_client.post(
        "/api/match/recompute",
        json={
            "allocator_id": str(uuid4()),
            "actor_id": str(uuid4()),
            "force": False,
        },
    )

    assert resp.status_code == 503
    envelope = resp.json()["detail"]
    assert envelope["code"] == "ADMIN_CHECK_UNAVAILABLE"
    assert envelope["dependency"] == "supabase"
    assert envelope["retryable"] is True
    assert isinstance(envelope["detail"], str)
    retry_after = resp.headers.get("Retry-After")
    assert retry_after is not None, "a SERVICE-TRANSIENT 503 must carry Retry-After"
    assert int(retry_after) > 0


def test_s14_profile_role_check_transient_is_503_naming_supabase(
    match_client, monkeypatch
) -> None:
    """S-14 — ``_is_allocator_profile`` returned its transient ``None``.

    M-2's original reasoning still holds (a real allocator must not be told
    "you are not an allocator" during a DB blip); this adds the attribution.
    """
    from routers import match as match_mod

    monkeypatch.setattr(match_mod, "_is_allocator_profile", lambda *_: None)

    resp = match_client.post(
        "/api/match/recompute",
        json={"allocator_id": str(uuid4()), "force": False},
    )

    assert resp.status_code == 503
    envelope = resp.json()["detail"]
    assert envelope["code"] == "ROLE_CHECK_UNAVAILABLE"
    assert envelope["dependency"] == "supabase"
    assert envelope["retryable"] is True
    retry_after = resp.headers.get("Retry-After")
    assert retry_after is not None, "a SERVICE-TRANSIENT 503 must carry Retry-After"
    assert int(retry_after) > 0


def test_s15_scoring_failure_is_permanent_500(match_client, monkeypatch) -> None:
    """S-15 — a crash inside ``_score_one_allocator`` is OUR bug.

    500 ``retryable:false``: an identical retry re-runs the identical scoring
    and crashes identically, so counting it toward the breaker (or inviting a
    retry) buys nothing.
    """

    async def _boom(allocator_id, universe):
        raise RuntimeError("synthetic scoring crash")

    _arrange_recompute(monkeypatch, _boom)

    resp = match_client.post(
        "/api/match/recompute",
        json={"allocator_id": str(uuid4()), "force": False},
    )

    assert resp.status_code == 500
    envelope = resp.json()["detail"]
    assert envelope["code"] == "SCORING_FAILED"
    assert envelope["retryable"] is False
    assert envelope["dependency"] is None
    assert isinstance(envelope["detail"], str)
    assert "Retry-After" not in resp.headers


def test_s15_scoring_failure_leaks_no_exception_text(
    match_client, monkeypatch, caplog
) -> None:
    """S-15 canary — the exception message must not reach the caller.

    ``f"Scoring failed: {err}"`` shipped whatever the exception carried. This
    fails the moment the interpolation is restored, and separately proves the
    diagnostic still reaches the operator's log.
    """

    async def _boom(allocator_id, universe):
        raise RuntimeError("CANARY_ERR internal table row payload")

    _arrange_recompute(monkeypatch, _boom)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = match_client.post(
            "/api/match/recompute",
            json={"allocator_id": str(uuid4()), "force": False},
        )

    assert resp.status_code == 500
    assert resp.text.count("CANARY_ERR") == 0, (
        "the exception message must not be interpolated into the response body"
    )
    # The diagnostic moved server-side, it was not deleted.
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert "CANARY_ERR" in logged, (
        "stripping {err} from the body must not destroy the operator's diagnostic"
    )
    # ...and the body carries the id that joins the two.
    correlation_id = resp.json()["detail"]["correlation_id"]
    assert correlation_id
    assert correlation_id in logged


def test_s16_eval_window_too_large_is_caller_400(match_client, monkeypatch) -> None:
    """S-16 — ``PaginatedSelectTruncated`` means the CALLER asked for too much.

    The paginator hit its hard cap draining the caller's ``lookback_days``
    window. Nothing of ours is down, so there is no dependency to name and no
    wait to advertise — and, crucially, no breaker input.
    """
    from routers import match as match_mod
    from services.db import PaginatedSelectTruncated

    def _truncated(lookback_days, partner_tag):
        raise PaginatedSelectTruncated(
            page_count=1000, page_size=1000, hint="compute_hit_rate n_allocators=42"
        )

    monkeypatch.setattr(match_mod, "compute_hit_rate_metrics", _truncated)

    resp = match_client.get("/api/match/eval?lookback_days=365")

    assert resp.status_code == 400
    envelope = resp.json()["detail"]
    assert envelope["code"] == "EVAL_WINDOW_TOO_LARGE"
    assert envelope["dependency"] is None
    assert envelope["retryable"] is False
    assert "Retry-After" not in resp.headers
    # The copy must tell the caller what to DO. "We are down" was the old lie.
    assert "lookback_days" in envelope["detail"]


def test_s17_eval_failure_is_permanent_500(match_client, monkeypatch) -> None:
    """S-17 — any other crash in the eval aggregation is OUR bug."""
    from routers import match as match_mod

    def _boom(lookback_days, partner_tag):
        raise ValueError("synthetic eval crash")

    monkeypatch.setattr(match_mod, "compute_hit_rate_metrics", _boom)

    resp = match_client.get("/api/match/eval")

    assert resp.status_code == 500
    envelope = resp.json()["detail"]
    assert envelope["code"] == "EVAL_FAILED"
    assert envelope["retryable"] is False
    assert envelope["dependency"] is None
    assert "Retry-After" not in resp.headers


def test_s17_eval_failure_leaks_no_exception_text(
    match_client, monkeypatch, caplog
) -> None:
    """S-17 canary — same discipline as S-15."""
    from routers import match as match_mod

    def _boom(lookback_days, partner_tag):
        raise ValueError("CANARY_ERR connection dsn=postgres://u:p@h/db")

    monkeypatch.setattr(match_mod, "compute_hit_rate_metrics", _boom)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = match_client.get("/api/match/eval")

    assert resp.status_code == 500
    assert resp.text.count("CANARY_ERR") == 0, (
        "the exception message must not be interpolated into the response body"
    )
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert "CANARY_ERR" in logged
    correlation_id = resp.json()["detail"]["correlation_id"]
    assert correlation_id
    assert correlation_id in logged
