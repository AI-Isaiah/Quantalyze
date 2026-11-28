"""B12 — calendar-day / event-ordering helpers (Python half).

Pins the single-sourced idiom:

* ``epoch_ms_to_iso_day`` reproduces the exact ``fromtimestamp(ms/1000,
  tz=utc).date().isoformat()`` conversion that bucketed trades / deposits /
  CoinGecko closes / OHLCV candles into per-UTC-day cells (golden parity), and
  is UTC-anchored so the day key never shifts with the worker's local tz.
"""

from datetime import datetime, timezone

import pytest

from services.dateday import epoch_ms_to_iso_day


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
