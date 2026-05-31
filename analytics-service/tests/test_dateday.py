"""B12 — calendar-day / event-ordering helpers (Python half).

Pins the two single-sourced idioms:

* ``epoch_ms_to_iso_day`` reproduces the exact ``fromtimestamp(ms/1000,
  tz=utc).date().isoformat()`` conversion that bucketed trades / deposits /
  CoinGecko closes / OHLCV candles into per-UTC-day cells (golden parity), and
  is UTC-anchored so the day key never shifts with the worker's local tz.
* ``sort_events_stable`` is the NEW-C01-18 fix: a missing/zero timestamp sorts
  LAST within its day (never epoch-0 first, which inverted same-day
  open→close), and same-timestamp events keep insertion order.
"""

from datetime import datetime, timezone

import pytest

from services.dateday import epoch_ms_to_iso_day, sort_events_stable


# ---------------------------------------------------------------------------
# epoch_ms_to_iso_day — golden parity with the inline idiom it replaces
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ts_ms",
    [
        1_700_000_000_000,  # 2023-11-14
        1_704_067_200_000,  # 2024-01-01 00:00:00Z
        1_704_153_599_000,  # 2024-01-01 23:59:59Z — same UTC day as above
        0,  # 1970-01-01
        1_577_836_800_000,  # 2020-01-01
    ],
)
def test_epoch_ms_to_iso_day_matches_inline_idiom(ts_ms):
    # The exact expression that lived (3×) in equity_reconstruction.py.
    expected = (
        datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=timezone.utc).date().isoformat()
    )
    assert epoch_ms_to_iso_day(ts_ms) == expected


def test_epoch_ms_to_iso_day_is_utc_anchored_not_local():
    # 2024-01-01T23:59:59Z is still 2024-01-01 in UTC. A local-tz conversion
    # west of UTC would book it to 2024-01-01 too, but east of UTC could roll it
    # to 2024-01-02 — the UTC anchor pins it regardless of where the worker runs.
    assert epoch_ms_to_iso_day(1_704_153_599_000) == "2024-01-01"


def test_epoch_ms_to_iso_day_accepts_float_and_str_coercible():
    assert epoch_ms_to_iso_day(1_704_067_200_000.0) == "2024-01-01"
    assert epoch_ms_to_iso_day("1704067200000") == "2024-01-01"


def test_epoch_ms_to_iso_day_raises_on_garbage():
    # Callers that tolerate missing timestamps (e.g. _event_date) guard with
    # their own None check; the helper itself fails loud on un-coercible input.
    with pytest.raises((TypeError, ValueError)):
        epoch_ms_to_iso_day("not-a-number")
    with pytest.raises((TypeError, ValueError)):
        epoch_ms_to_iso_day(None)


# ---------------------------------------------------------------------------
# sort_events_stable — NEW-C01-18 intra-day ordering
# ---------------------------------------------------------------------------


def test_sort_events_orders_ascending_by_timestamp():
    events = [
        {"timestamp": 300, "id": "c"},
        {"timestamp": 100, "id": "a"},
        {"timestamp": 200, "id": "b"},
    ]
    assert [e["id"] for e in sort_events_stable(events)] == ["a", "b", "c"]


def test_sort_events_open_before_close_for_same_day_round_trip():
    # A round trip a few minutes apart inside one day: the open (earlier ts)
    # MUST sort before the close so position state is correct.
    open_evt = {"timestamp": 1_704_067_200_000, "kind": "open"}
    close_evt = {"timestamp": 1_704_067_500_000, "kind": "close"}
    assert [e["kind"] for e in sort_events_stable([close_evt, open_evt])] == [
        "open",
        "close",
    ]


def test_sort_events_missing_or_zero_timestamp_sorts_LAST_not_first():
    # NEW-C01-18 regression: the original `int(ts or 0)` collapsed a missing /
    # zero timestamp to epoch-0, sorting it BEFORE every real fill and inverting
    # open→close ordering. The sentinel must place it last within the day.
    events = [
        {"timestamp": None, "id": "missing"},
        {"timestamp": 0, "id": "zero"},
        {"timestamp": 100, "id": "real1"},
        {"timestamp": 200, "id": "real2"},
    ]
    ordered = [e["id"] for e in sort_events_stable(events)]
    assert ordered[:2] == ["real1", "real2"]
    # Both the None and the 0 land after the real fills (their relative order is
    # the stable insertion order: missing was inserted before zero).
    assert set(ordered[2:]) == {"missing", "zero"}
    assert ordered.index("missing") < ordered.index("zero")


def test_sort_events_stable_on_equal_timestamps_preserves_insertion_order():
    events = [
        {"timestamp": 100, "id": "first"},
        {"timestamp": 100, "id": "second"},
        {"timestamp": 100, "id": "third"},
    ]
    assert [e["id"] for e in sort_events_stable(events)] == [
        "first",
        "second",
        "third",
    ]


def test_sort_events_does_not_mutate_input():
    events = [{"timestamp": 200, "id": "b"}, {"timestamp": 100, "id": "a"}]
    sort_events_stable(events)
    assert [e["id"] for e in events] == ["b", "a"]  # original order intact


def test_sort_events_custom_ts_key():
    events = [{"ms": 2}, {"ms": 1}]
    assert sort_events_stable(events, ts_key="ms") == [{"ms": 1}, {"ms": 2}]
