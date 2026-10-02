"""Phase 163 / OPS-09 — the resync draft pre-check resolves DETERMINISTICALLY.

WHAT WAS WRONG
--------------
`routers/process_key.py`'s resync pre-check selected the draft
`strategy_verifications` row to resume with `.limit(1).maybe_single()` and NO
`ORDER BY`. The block's own comment records a residual in which two drafts exist
for one strategy (the concurrent two-tab race: both SELECTs pass before either
INSERT, and the server-minted `wizard_session_id`s are distinct so neither row
23505s). With no ordering, WHICH of the two `.limit(1)` returned was whatever
PostgREST and the planner emitted first — so the same pair of rows could resume
either tab's session, run to run. There was also no lower bound at all: a draft
orphaned by a worker that died before its first state transition stayed eligible
forever and could be revived into a live session months later.

WHAT IS PINNED HERE
-------------------
Two properties, each with a discriminating twin so neither can pass vacuously:

* NEWEST WINS — with two in-window drafts, the pre-check resumes the one with
  the later `created_at`, and it does so against a store whose INSERTION order
  puts the OLDER row first. Insertion order is deliberately adversarial: it is
  exactly what an unordered `.limit(1)` returns, so this assertion separates
  "ordered" from "happened to be right".
* THE WINDOW BITES, AND ONLY ON THE FAR SIDE — a draft older than
  `_RESYNC_DRAFT_RESUME_WINDOW` reads as absent (the route falls through and
  mints a fresh draft), while a draft comfortably inside it is still resumed.
  The second half is what stops the first from being satisfiable by a pre-check
  that simply never fires.

RED DEMONSTRATIONS (run 2026-08-26, restored immediately after)
---------------------------------------------------------------
Both neuters were applied to `routers/process_key.py`, observed, and reverted;
the restores were verified by grepping for the clauses, not by file hash.

1. NEUTER: delete `.order("created_at", desc=True)` from the pre-check chain.
   OBSERVED (1 failed, 6 passed): `test_two_in_window_drafts_resume_the_newest`
   FAILS with `the pre-check resumed 'sv-resync-OLD', expected the NEWEST draft
   'sv-resync-NEW'`. The unordered read returns the store's first match, which
   the fixture makes the OLDER row. Note that
   `test_the_newest_wins_regardless_of_insertion_order` stays GREEN under this
   neuter — its seed order happens to favour the newest row — which is exactly
   why the claim is asserted under BOTH orders rather than one.

2. NEUTER: delete `.gte("created_at", resume_cutoff.isoformat())` from the same
   chain. OBSERVED (1 failed, 6 passed):
   `test_draft_older_than_the_window_is_not_resumed` FAILS — the reply is
   `{'ok': True, 'code': 'WIZARD_DUPLICATE', 'verification_id':
   'sv-resync-ANCIENT', 'queued': True, 'job_state': 'enqueued', ...}`, i.e. the
   9-hour-old orphan was revived AND its compute job re-enqueued.
   `test_draft_inside_the_window_is_still_resumed` stays green, so the pair
   really does discriminate the bound rather than the guard.

HARNESS
-------
Extends `tests/test_resync_draft_dedup.py` rather than inventing a second
stub — same stateful supabase double, same full-`main.app` TestClient, same
literal fixtures. ⚠️ That double's `.order()` was a `return self` NO-OP until
this phase; a no-op sort would have left demonstration 1 green with the
production clause deleted, i.e. a gate that cannot fail. It sorts for real now,
and `.gte()` filters for real, which is what makes both RED demos possible.

⛔ Run from `analytics-service/` with `python3`. A repo-root pytest run misses the
VCR cassettes and makes LIVE broker calls.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.test_resync_draft_dedup import (
    _STRATEGY_A,
    _StatefulSupabase,
    _post,
    _resync_body,
    _resync_drafts,
    full_stack_client,  # noqa: F401  — re-exported pytest fixture
    make_supabase,
)

# Literal row ids. Named, not generated, so a failure message says WHICH draft
# was resumed instead of comparing two opaque uuids.
_DRAFT_OLD = "sv-resync-OLD"
_DRAFT_NEW = "sv-resync-NEW"
_DRAFT_ANCIENT = "sv-resync-ANCIENT"
_DRAFT_RECENT = "sv-resync-RECENT"

#: The window, as a LITERAL. Written out rather than imported-and-compared:
#: asserting `_RESYNC_DRAFT_RESUME_WINDOW == _RESYNC_DRAFT_RESUME_WINDOW` would
#: prove only that the module agrees with itself.
_EXPECTED_WINDOW = timedelta(hours=8)

#: Ages used by the bound tests, chosen to straddle the window with margin so a
#: slow test run can never drift a case across the boundary.
_INSIDE_WINDOW = timedelta(hours=1)
_OUTSIDE_WINDOW = timedelta(hours=9)


def _seed_draft(
    sb: _StatefulSupabase,
    *,
    row_id: str,
    strategy_id: str,
    age: timedelta,
) -> None:
    """Append a draft resync verification of a given AGE directly to the store.

    Seeded rather than produced by a prior POST because the ages under test
    (1 h, 9 h) cannot be reached by a request the test can issue, and because the
    two-draft residual this file exists for is a concurrency artefact the route
    cannot be made to produce on demand.
    """
    sb.store["strategy_verifications"].append(
        {
            "id": row_id,
            "strategy_id": strategy_id,
            "wizard_session_id": f"session-for-{row_id}",
            "status": "draft",
            "trust_tier": "api_verified",
            "flow_type": "resync",
            "source": "binance",
            "created_at": (datetime.now(timezone.utc) - age).isoformat(),
        }
    )


def test_the_resume_window_is_eight_hours() -> None:
    """The bound's VALUE, pinned separately from its behaviour.

    The two behavioural tests below straddle the window by literal ages, so they
    would stay green if someone widened the constant to 24 h. This is the
    assertion that makes a silent widening — the easy way to make an
    inconvenient orphan resumable again — cost a conscious edit.
    """
    from routers import process_key

    assert process_key._RESYNC_DRAFT_RESUME_WINDOW == _EXPECTED_WINDOW, (
        "the resync draft resume window moved to "
        f"{process_key._RESYNC_DRAFT_RESUME_WINDOW!r}, expected "
        f"{_EXPECTED_WINDOW!r}. It is derived (see the constant's comment: the "
        "single-hop process_key_long envelope, 13,230s, under the house 1.25x / "
        "whole-4-hour rule). Re-derive it before changing this literal."
    )


def test_two_in_window_drafts_resume_the_newest(
    full_stack_client: TestClient,  # noqa: F811
) -> None:
    """The headline: the NEWEST draft is resumed, not an arbitrary one.

    ⚠️ INSERTION ORDER IS ADVERSARIAL ON PURPOSE. `_DRAFT_OLD` is appended to the
    store FIRST, so an unordered `.limit(1)` — the pre-fix behaviour — returns
    it. Seeding the newest row first would make this test pass with no ORDER BY
    at all, which is the shape of a gate that cannot fail.
    """
    sb = make_supabase(_STRATEGY_A)
    _seed_draft(sb, row_id=_DRAFT_OLD, strategy_id=_STRATEGY_A, age=timedelta(hours=2))
    _seed_draft(sb, row_id=_DRAFT_NEW, strategy_id=_STRATEGY_A, age=timedelta(minutes=5))

    with patch("routers.process_key.get_supabase", return_value=sb):
        resp = _post(full_stack_client, _resync_body(_STRATEGY_A))

    body: dict[str, Any] = resp.json()
    assert resp.status_code == 200, resp.text
    assert body.get("code") == "WIZARD_DUPLICATE", (
        f"a duplicate submit against two existing drafts replied {body!r}, "
        "expected the WIZARD_DUPLICATE duplicate path"
    )
    assert body.get("verification_id") == _DRAFT_NEW, (
        f"the pre-check resumed {body.get('verification_id')!r}, expected the "
        f"NEWEST draft {_DRAFT_NEW!r}. Without `.order('created_at', desc=True)` "
        "the read returns whatever the store/planner emits first — here the "
        f"deliberately older {_DRAFT_OLD!r}."
    )


def test_the_newest_wins_regardless_of_insertion_order(
    full_stack_client: TestClient,  # noqa: F811
) -> None:
    """The same claim with the seed order REVERSED.

    Together with the test above this says "newest", not "first" and not "last".
    A pre-check that had been 'fixed' by taking the last matching row instead of
    ordering would pass one of these two and fail the other.
    """
    sb = make_supabase(_STRATEGY_A)
    _seed_draft(sb, row_id=_DRAFT_NEW, strategy_id=_STRATEGY_A, age=timedelta(minutes=5))
    _seed_draft(sb, row_id=_DRAFT_OLD, strategy_id=_STRATEGY_A, age=timedelta(hours=2))

    with patch("routers.process_key.get_supabase", return_value=sb):
        resp = _post(full_stack_client, _resync_body(_STRATEGY_A))

    body: dict[str, Any] = resp.json()
    assert body.get("verification_id") == _DRAFT_NEW, (
        f"with the seed order reversed the pre-check resumed "
        f"{body.get('verification_id')!r}; the resumed row must be the newest "
        f"({_DRAFT_NEW!r}) under EITHER insertion order, or the resolution is "
        "still positional rather than ordered."
    )


def test_draft_older_than_the_window_is_not_resumed(
    full_stack_client: TestClient,  # noqa: F811
) -> None:
    """An ancient orphan reads as ABSENT — it cannot be revived.

    The observable is doubled deliberately: the reply must not be the duplicate
    path, AND the strategy must end up holding a second, fresh draft. Asserting
    only the reply would stay green if the route had merely stopped replying
    while still resuming the orphan's compute job.
    """
    sb = make_supabase(_STRATEGY_A)
    _seed_draft(
        sb, row_id=_DRAFT_ANCIENT, strategy_id=_STRATEGY_A, age=_OUTSIDE_WINDOW
    )

    with patch("routers.process_key.get_supabase", return_value=sb):
        resp = _post(full_stack_client, _resync_body(_STRATEGY_A))

    body: dict[str, Any] = resp.json()
    assert body.get("code") != "WIZARD_DUPLICATE", (
        f"a {_OUTSIDE_WINDOW} old orphaned draft was resumed as a duplicate "
        f"({body!r}). Outside `_RESYNC_DRAFT_RESUME_WINDOW` the pre-check must "
        "see nothing."
    )
    assert body.get("verification_id") != _DRAFT_ANCIENT, (
        f"the reply carries the ancient draft {_DRAFT_ANCIENT!r}"
    )

    drafts = _resync_drafts(sb, _STRATEGY_A)
    ids = sorted(r["id"] for r in drafts)
    assert len(drafts) == 2, (
        f"expected the ancient draft to survive untouched alongside a fresh one, "
        f"found {len(drafts)} draft(s): {ids}"
    )
    assert _DRAFT_ANCIENT in ids, (
        "the ancient draft disappeared — the pre-check must IGNORE it, not "
        "mutate it"
    )


def test_draft_inside_the_window_is_still_resumed(
    full_stack_client: TestClient,  # noqa: F811
) -> None:
    """The discriminating twin of the test above.

    Same single-draft shape, same code path, only the AGE differs. Without this,
    the bound test would pass against a pre-check that had been broken outright
    (or a window of zero), and the file would be reporting a fail-closed bug as
    a security property.
    """
    sb = make_supabase(_STRATEGY_A)
    _seed_draft(sb, row_id=_DRAFT_RECENT, strategy_id=_STRATEGY_A, age=_INSIDE_WINDOW)

    with patch("routers.process_key.get_supabase", return_value=sb):
        resp = _post(full_stack_client, _resync_body(_STRATEGY_A))

    body: dict[str, Any] = resp.json()
    assert body.get("code") == "WIZARD_DUPLICATE", (
        f"a {_INSIDE_WINDOW} old draft — comfortably inside the "
        f"{_EXPECTED_WINDOW} window — was NOT resumed ({body!r}). The bound is "
        "too tight, or the pre-check is not firing at all."
    )
    assert body.get("verification_id") == _DRAFT_RECENT
    assert len(_resync_drafts(sb, _STRATEGY_A)) == 1, (
        "an in-window duplicate submit must resume the existing draft, not mint "
        "a second one"
    )


@pytest.mark.parametrize("age", [_INSIDE_WINDOW, _OUTSIDE_WINDOW], ids=["inside", "outside"])
def test_the_pre_check_stays_strategy_scoped_across_the_bound(
    full_stack_client: TestClient,  # noqa: F811
    age: timedelta,
) -> None:
    """The bound must not have widened the read's tenant scope.

    `.order()` and `.gte()` were appended to a chain that carries the tenant
    scope only through its `.eq("strategy_id", ...)` filter (the route's TENANT
    SCOPE comment). A clause appended in the wrong place — or an `.or_()`
    reached for while sizing the window — would drop that filter. Asserted at
    BOTH sides of the bound so the check cannot be satisfied by the window
    excluding the foreign row by accident.
    """
    other_strategy = "bbbbbbbb-0000-4000-8000-0000000000ff"
    sb = make_supabase(_STRATEGY_A)
    _seed_draft(sb, row_id="sv-resync-FOREIGN", strategy_id=other_strategy, age=age)

    with patch("routers.process_key.get_supabase", return_value=sb):
        resp = _post(full_stack_client, _resync_body(_STRATEGY_A))

    body: dict[str, Any] = resp.json()
    assert body.get("verification_id") != "sv-resync-FOREIGN", (
        "the pre-check resumed a draft belonging to a DIFFERENT strategy — the "
        "`.eq('strategy_id', ...)` scope was lost when the ordering/bound "
        "clauses were added"
    )
    assert body.get("code") != "WIZARD_DUPLICATE", (
        f"no draft exists for {_STRATEGY_A} at all, so the duplicate path must "
        f"not fire; got {body!r}"
    )
