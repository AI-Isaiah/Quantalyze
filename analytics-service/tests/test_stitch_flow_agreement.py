"""Phase 167.1.2.1.1 WRITERRESIDUALS plan 02, SC-3 (decision D-03): the pure helper
that says on how many owned days the members of a stitched shared account DISAGREE
about the account's external flows.

WHY this matters. ``stitch_shared_account`` takes each day's flows from the ONE
member that owns the day, because a newer key's crawl that reaches back over an
older key's days lists the same transfers and taking both would double them. When
the newer member lists a DIFFERENT total for a day the older member owns, one of
them is wrong, and the stitch silently keeps the owner's. The curve is then built
on flows the account's own keys do not agree on. The helper counts those days so the
derive can withhold the curve. Silence is not disagreement: a newer key whose crawl
simply does not reach back lists nothing, and that is the normal case.

The ownership rule is shared with the stitch (``_stitch_owned_window``), so the
check and the stitch cannot disagree about who owns a day.
"""

from __future__ import annotations

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    _stitch_owned_window,
    stitch_flow_disagreement_days,
    stitch_shared_account,
)
from services.external_flows import ExternalFlow


def _series(first: str, last: str) -> pd.Series:
    days = [d.strftime("%Y-%m-%d") for d in pd.date_range(first, last, freq="D")]
    return pd.Series([0.0] * len(days), index=days, dtype="float64")


def _flow(day: str, usd: float) -> ExternalFlow:
    return ExternalFlow(utc_day_iso=day, usd_signed=usd)


# Older member owns 2026-05-01 .. 2026-05-31; the newer one owns 2026-06-01 on.
OLD = _series("2026-05-01", "2026-06-03")
NEW = _series("2026-06-01", "2026-06-05")


def test_members_that_agree_on_every_owned_day_disagree_on_none() -> None:
    """The same May deposit listed by both keys is one transfer, not two."""
    deposit = _flow("2026-05-15", 10_000.0)
    assert stitch_flow_disagreement_days([(OLD, [deposit]), (NEW, [deposit])]) == 0


def test_a_newer_member_listing_a_deposit_the_owner_does_not_is_one_disagreeing_day() -> None:
    """The newer key lists a deposit on a day the older key owns and the owner
    lists nothing that day: the stitch keeps the owner's (empty) flows, so a
    transfer the account's other key saw is dropped from the curve."""
    links = [(OLD, []), (NEW, [_flow("2026-05-15", 4_000.0)])]
    assert stitch_flow_disagreement_days(links) == 1


def test_two_disagreeing_flows_on_one_day_count_the_day_once() -> None:
    links = [
        (OLD, [_flow("2026-05-15", 100.0)]),
        (NEW, [_flow("2026-05-15", 200.0), _flow("2026-05-15", 50.0)]),
    ]
    assert stitch_flow_disagreement_days(links) == 1


def test_a_newer_member_listing_nothing_on_an_owned_day_is_silence_not_disagreement() -> None:
    """The newer crawl does not reach back over the older key's days. That is the
    normal case and must not block the book."""
    links = [(OLD, [_flow("2026-05-15", 10_000.0)]), (NEW, [])]
    assert stitch_flow_disagreement_days(links) == 0


def test_the_tolerance_boundary_is_one_cent() -> None:
    """RESEARCH assumption A1: ``math.isclose(rel_tol=1e-9, abs_tol=0.01)``. A
    difference of exactly one cent is rounding in the venue's own figures; two
    cents is a different number. The pair pins the edge from both sides."""
    day = "2026-05-15"
    assert stitch_flow_disagreement_days([(OLD, []), (NEW, [_flow(day, 0.01)])]) == 0
    assert stitch_flow_disagreement_days([(OLD, []), (NEW, [_flow(day, 0.02)])]) == 1


def test_the_relative_tolerance_scales_with_the_amount() -> None:
    """A large figure may differ by its own float noise (1e-9 relative) without
    being flagged, and by far more than that is."""
    day = "2026-05-15"
    big = 1_000_000_000.0
    assert stitch_flow_disagreement_days(
        [(OLD, [_flow(day, big)]), (NEW, [_flow(day, big * (1 + 5e-10))])]
    ) == 0
    assert stitch_flow_disagreement_days(
        [(OLD, [_flow(day, big)]), (NEW, [_flow(day, big * (1 + 1e-6))])]
    ) == 1


def test_a_flow_before_the_first_return_day_is_owned_by_the_first_member() -> None:
    """The first member keeps its flows dated before its own first return day (a
    key's pre-window flow), so a disagreement there is compared too."""
    links = [(OLD, [_flow("2026-04-20", 500.0)]), (NEW, [_flow("2026-04-20", 700.0)])]
    assert stitch_flow_disagreement_days(links) == 1


def test_a_day_the_newer_member_owns_is_not_compared() -> None:
    """From 2026-06-01 the newer member is the owner and no later member exists,
    so there is nobody to disagree with. The older key's overlap-day flow is
    discarded by the stitch and is not a disagreement."""
    links = [(OLD, [_flow("2026-06-02", -99.0)]), (NEW, [_flow("2026-06-02", -5_000.0)])]
    assert stitch_flow_disagreement_days(links) == 0


def test_three_members_compare_the_owner_against_every_later_member() -> None:
    first, second, third = _series("2026-05-01", "2026-05-20"), _series("2026-05-10", "2026-05-31"), _series("2026-06-01", "2026-06-05")
    # 2026-05-05 is the first member's; the third lists it with another total.
    # 2026-05-15 is the second member's; the third lists it with the same total.
    links = [
        (first, [_flow("2026-05-05", 10.0)]),
        (second, [_flow("2026-05-15", 20.0)]),
        (third, [_flow("2026-05-05", 99.0), _flow("2026-05-15", 20.0)]),
    ]
    assert stitch_flow_disagreement_days(links) == 1


def test_fewer_than_two_members_or_an_empty_series_is_nothing_to_compare() -> None:
    assert stitch_flow_disagreement_days([(OLD, [_flow("2026-05-15", 1.0)])]) == 0
    assert stitch_flow_disagreement_days(
        [(OLD, []), (pd.Series([], dtype="float64"), [_flow("2026-05-15", 1.0)])]
    ) == 0


@pytest.mark.parametrize(
    ("firsts", "index", "window"),
    [
        (["2026-05-01", "2026-06-01"], 0, (None, "2026-06-01")),
        (["2026-05-01", "2026-06-01"], 1, ("2026-06-01", None)),
        (["2026-05-01", "2026-05-10", "2026-06-01"], 1, ("2026-05-10", "2026-06-01")),
    ],
)
def test_the_owned_window_is_half_open_and_the_first_member_owns_everything_earlier(
    firsts: list[str], index: int, window: tuple[str | None, str | None]
) -> None:
    assert _stitch_owned_window(firsts, index) == window


def test_the_stitch_and_the_check_use_the_same_ownership() -> None:
    """Whatever day the helper treats as the older member's, the stitch takes its
    flow from the older member too: one ownership function, no drift."""
    old_flow, new_flow = _flow("2026-05-31", 1.0), _flow("2026-06-01", 2.0)
    stitched = stitch_shared_account([(OLD, [old_flow, _flow("2026-06-01", 7.0)]), (NEW, [new_flow])])
    assert stitched is not None
    _, flows = stitched
    assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [("2026-05-31", 1.0), ("2026-06-01", 2.0)]
