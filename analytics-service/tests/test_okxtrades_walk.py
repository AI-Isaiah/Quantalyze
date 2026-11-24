"""Phase 232 OKXTRADES VREAD-07: the OKX bills read walks day-aligned windows, oldest first.

Before this phase ``fetch_daily_pnl`` paged each instType over the WHOLE range with ``begin``
only, so the 100-page cap was spent on the newest bills and a long first window truncated on
every tick. The walk now reads UTC-day-aligned windows of ``OKX_BILLS_WINDOW_DAYS`` days, oldest
first, every request carrying ``begin`` and ``end``; the cap is per (window, instType,
endpoint) and a stop returns a contiguous oldest prefix.

Every test drives the REAL ``fetch_daily_pnl`` against ``tests/_okx_bills.py::OkxBillsArchive``,
the venue-faithful fake that honours ``begin``/``end``/``after``/``limit``/``instType`` (a canned
page mock that serves the same bills to every window would let the dedup hide a missing
window). Bills carry the recorded OKX v5 field names through ``okx_bill``. Instants are typed
epoch-millisecond literals relative to the pinned clock ``NOW_MS``; none is computed from the code
under test.

PROOF-01. NEUTER (each recorded in the SUMMARY, restored from a byte backup with ``cp`` and
checked with ``cmp``):

- N1 ``OKX_BILLS_WINDOW_DAYS = 400`` (one window for the whole range): the tracer goes RED naming
  ``daily_pnl_truncated_okx``.
- N2 keep the in-progress window's rows on a deadline stop: ``test_a_deadline_returns_whole_windows_only``.
- N3 continue to later windows after a cap breach: ``test_a_cap_breach_returns_a_contiguous_oldest_prefix``.
- N4 delete the ``billId`` order check: ``test_a_venue_serving_oldest_first_under_begin_is_refused_by_name``.
- N5 delete the ``ts`` window check: ``test_a_row_outside_its_window_is_refused_by_name``.
- N6 route a window to the archive only when ``since_ms`` is older than 90 days:
  ``test_an_eight_to_eighty_nine_day_window_reads_the_archive``.
- N7 ``OKX_BILLS_PAGE_CAP = 101``: ``test_the_page_caps_are_unchanged`` goes RED.
- N8 treat a row at exactly start minus 1 or end as out of window:
  ``test_a_bill_on_a_window_edge_is_counted_once``.
"""
from __future__ import annotations

from typing import Any

import pytest

import services.exchange as ex
from services.exchange import fetch_daily_pnl
from tests._okx_bills import OkxBillsArchive, okx_bill

# 2026-11-20T12:00:00Z, the pinned clock.
NOW_MS = 1795176000000
DAY_MS = 86_400_000
WEEK_MS = 604_800_000
HALF_HOUR_MS = 1_800_000
# 2026-08-19T00:00:00Z: the UTC-day floor of NOW_MS minus 93 days, the walk's reach start.
REACH_START_MS = 1787097600000
# 2026-11-14T00:00:00Z: the UTC day of NOW_MS minus 6 days, the oldest instant /account/bills serves.
LIVE_FLOOR_MS = 1794614400000
# 2026-10-21T12:00:00Z: NOW_MS minus 30 days.
THIRTY_DAYS_BACK_MS = 1792584000000
# 2026-10-21T00:00:00Z: the UTC-day floor of the instant above.
THIRTY_DAYS_BACK_DAY_MS = 1792540800000


class _Spy:
    """Wraps an OkxBillsArchive and appends ``(endpoint, params)`` to a log shared by both fakes."""

    def __init__(self, inner: OkxBillsArchive, log: list[tuple[str, dict[str, str]]], name: str) -> None:
        self.inner = inner
        self.log = log
        self.name = name

    async def __call__(self, params: dict[str, str]) -> dict[str, Any]:
        self.log.append((self.name, dict(params)))
        return await self.inner(params)


class _Exchange:
    """The slice of ccxt.okx the OKX branch of fetch_daily_pnl touches."""

    id = "okx"
    rateLimit = 0

    def __init__(self, live: Any, archive: Any) -> None:
        self.private_get_account_bills = live
        self.private_get_account_bills_archive = archive


def _exchange(
    rows: list[dict[str, str]], *, archive_rows: list[dict[str, str]] | None = None, **archive_kwargs: Any
) -> tuple[_Exchange, list[tuple[str, dict[str, str]]]]:
    """An exchange whose live endpoint reaches back to LIVE_FLOOR_MS and whose archive reaches all."""
    log: list[tuple[str, dict[str, str]]] = []
    live = OkxBillsArchive(rows, reach_floor_ms=LIVE_FLOOR_MS)
    archive = OkxBillsArchive(rows if archive_rows is None else archive_rows, **archive_kwargs)
    return _Exchange(_Spy(live, log, "bills"), _Spy(archive, log, "archive")), log


def _bills(
    first_id: int,
    first_ts: int,
    count: int,
    *,
    step_ms: int = HALF_HOUR_MS,
    inst_type: str = "SWAP",
    pnl: str = "1",
) -> list[dict[str, str]]:
    """``count`` USDT bills, ids and timestamps rising together, pnl a string and fee zero."""
    return [
        okx_bill(
            first_id + i,
            first_ts + i * step_ms,
            "USDT",
            "10000",
            pnl,
            inst_type=inst_type,
            pnl=pnl,
            fee="0",
        )
        for i in range(count)
    ]


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # raising=False: the same fixture runs on code that predates the ``_now_ms`` seam.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)


async def _read(exchange: _Exchange, since_ms: int | None, **kwargs: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    ex.get_and_clear_last_dq_flags()
    rows = await fetch_daily_pnl(exchange, since_ms, **kwargs)  # type: ignore[arg-type]
    return rows, ex.get_and_clear_last_dq_flags()


def _by_day(rows: list[dict[str, Any]]) -> dict[str, float]:
    return {r["timestamp"][:10]: r["price"] for r in rows}


class TestOkxBillsWindowWalk:
    async def test_tracer_a_long_first_window_completes_with_the_caps_unchanged(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Both caps at 3 pages: a 7-day window holds 210 SWAP bills (3 pages), the whole 94-day
        # range holds 2,784. The old walk spent the cap on the newest 300 bills of the range.
        monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 3)
        monkeypatch.setattr(ex, "OKX_ARCHIVE_PAGE_CAP", 3)
        rows: list[dict[str, str]] = []
        next_id = 1_000_000
        for day_index in range(94):  # 2026-08-19 .. 2026-11-20, one day each
            day_start = REACH_START_MS + day_index * DAY_MS
            # 30 bills a day, 30 minutes apart from 00:00; on the last day only those before NOW.
            for i in range(30):
                ts = day_start + i * HALF_HOUR_MS
                if ts < NOW_MS:
                    rows.extend(_bills(next_id, ts, 1))
                    next_id += 1
        exchange, _log = _exchange(rows)

        out, flags = await _read(exchange, None)

        days = _by_day(out)
        first_missing = next(
            (
                d
                for d in range(94)
                if _iso_day(REACH_START_MS + d * DAY_MS) not in days
            ),
            None,
        )
        assert "daily_pnl_truncated_okx" not in flags, (
            f"the long first window was refused as truncated (first missing day index {first_missing})"
        )
        assert first_missing is None, f"day index {first_missing} is missing from the read"
        assert len(out) == 94
        # 93 whole days of 30 bills at pnl 1; the partial last day holds 24 (00:00 .. 11:30).
        assert [r["price"] for r in out[:93]] == [30.0] * 93
        assert out[93]["price"] == 24.0
        assert flags == {}

    def test_the_page_caps_are_unchanged(self) -> None:
        # Raising a cap is not a close of VREAD-07: the cap is per window now, and stays 100.
        assert ex.OKX_BILLS_PAGE_CAP == 100
        assert ex.OKX_ARCHIVE_PAGE_CAP == 100

    async def test_windows_are_day_aligned_oldest_first_and_carry_begin_and_end(self) -> None:
        rows = _bills(5_000_000, THIRTY_DAYS_BACK_DAY_MS + 3_600_000, 6, step_ms=DAY_MS)
        exchange, log = _exchange(rows)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert flags == {}
        assert len(out) == 6
        windows: list[tuple[int, int]] = []
        for _endpoint, params in log:
            assert params["begin"].isdigit() and params["end"].isdigit()
            assert params["limit"] == "100"
            begin, end = int(params["begin"]), int(params["end"])
            assert (begin + 1) % DAY_MS == 0, "a window must start on a UTC-day boundary"
            assert end - begin - 1 <= 7 * DAY_MS
            if not windows or windows[-1] != (begin, end):
                windows.append((begin, end))
        starts = [b + 1 for b, _ in windows]
        assert starts == sorted(starts) and len(set(starts)) == len(starts)
        assert windows[0][0] + 1 == THIRTY_DAYS_BACK_DAY_MS
        for (_, prev_end), (next_begin, _) in zip(windows, windows[1:]):
            assert next_begin + 1 == prev_end, "each window starts where the previous one ends"
        assert windows[-1][1] == NOW_MS

    # ---- Task 2: whole-window stops, ticks, self-checks, routing, edges ----

    async def test_a_deadline_returns_whole_windows_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # One SWAP bill a day at 06:00 from 2026-10-21 to 2026-11-20 (31 days, 5 windows).
        rows = _bills(7_000_000, THIRTY_DAYS_BACK_DAY_MS + 6 * 3_600_000, 31, step_ms=DAY_MS)
        exchange, log = _exchange(rows)
        # Windows 1-3 are archive-only: 4 requests each (one page per instType) = 12. The clock
        # passes the deadline after the 13th request, i.e. during window 4 (the straddling one).
        monkeypatch.setattr(ex, "_monotonic", lambda: 0.0 if len(log) < 13 else 1e12)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS, read_deadline_s=10.0)

        assert flags.get("daily_pnl_deadline_okx") is True
        assert "daily_pnl_truncated_okx" not in flags
        days = _by_day(out)
        # Windows 1-3 cover 2026-10-21 .. 2026-11-10 (21 days), each whole (one bill, pnl 1).
        assert sorted(days) == [_iso_day(THIRTY_DAYS_BACK_DAY_MS + d * DAY_MS) for d in range(21)]
        assert set(days.values()) == {1.0}
        assert len(log) == 13, "no request may be issued after the deadline"

    async def test_a_cap_breach_returns_a_contiguous_oldest_prefix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 2)
        monkeypatch.setattr(ex, "OKX_ARCHIVE_PAGE_CAP", 2)
        nov4 = THIRTY_DAYS_BACK_DAY_MS + 2 * WEEK_MS  # window 3 starts 2026-11-04
        rows = (
            _bills(7_000_000, THIRTY_DAYS_BACK_DAY_MS + 6 * 3_600_000, 14, step_ms=DAY_MS)  # windows 1-2
            + _bills(8_000_000, nov4, 250)  # window 3: 250 bills, over the cap of 2 pages
            + _bills(9_000_000, nov4 + WEEK_MS + 6 * 3_600_000, 9, step_ms=DAY_MS)  # windows 4-5
        )
        exchange, log = _exchange(rows)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert flags.get("daily_pnl_truncated_okx") is True
        assert "daily_pnl_deadline_okx" not in flags
        assert sorted(_by_day(out)) == [_iso_day(THIRTY_DAYS_BACK_DAY_MS + d * DAY_MS) for d in range(14)]
        assert all(int(p["begin"]) + 1 <= nov4 for _e, p in log), "no window after the breached one is requested"

    async def test_a_first_window_past_the_cap_returns_nothing_and_names_the_truncation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 2)
        monkeypatch.setattr(ex, "OKX_ARCHIVE_PAGE_CAP", 2)
        exchange, _log = _exchange(_bills(8_000_000, THIRTY_DAYS_BACK_DAY_MS, 250))

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert out == []
        assert flags.get("daily_pnl_truncated_okx") is True

    async def test_ticks_complete_the_range(self, monkeypatch: pytest.MonkeyPatch) -> None:
        rows = _bills(7_000_000, THIRTY_DAYS_BACK_DAY_MS + 6 * 3_600_000, 31, step_ms=DAY_MS)
        holder: dict[str, Any] = {}
        monkeypatch.setattr(ex, "_monotonic", lambda: 0.0 if len(holder["log"]) < 8 else 1e12)
        since: int | None = THIRTY_DAYS_BACK_MS
        seen: dict[str, float] = {}
        calls = 0
        while True:
            exchange, holder["log"] = _exchange(rows)
            out, flags = await _read(exchange, since, read_deadline_s=10.0)
            calls += 1
            assert "daily_pnl_truncated_okx" not in flags
            assert calls <= 10, "the ticks must make progress"
            seen.update(_by_day(out))
            if not flags.get("daily_pnl_deadline_okx"):
                break
            newest = max(r["timestamp"] for r in out)
            since = _day_ms(newest[:10])
        assert calls > 1, "the deadline must have stopped at least one call"
        assert sorted(seen) == [_iso_day(THIRTY_DAYS_BACK_DAY_MS + d * DAY_MS) for d in range(31)]
        assert set(seen.values()) == {1.0}

    async def test_a_venue_serving_oldest_first_under_begin_is_refused_by_name(self) -> None:
        exchange, _log = _exchange(
            _bills(5_000_000, THIRTY_DAYS_BACK_DAY_MS, 5), oldest_first_with_begin=True
        )

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert out == []
        assert flags.get("daily_pnl_fetch_error") is True
        assert flags.get("daily_pnl_fetch_error_class") == "OkxBillsWindowIncomplete"

    async def test_a_stalled_cursor_is_refused_by_name(self) -> None:
        exchange, _log = _exchange(_bills(5_000_000, THIRTY_DAYS_BACK_DAY_MS, 250), ignore_after=True)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert out == []
        assert flags.get("daily_pnl_fetch_error_class") == "OkxBillsWindowIncomplete"

    async def test_a_row_outside_its_window_is_refused_by_name(self) -> None:
        rows = _bills(5_000_000, THIRTY_DAYS_BACK_DAY_MS + 3_600_000, 20, step_ms=DAY_MS)
        exchange = _Exchange(_StripBounds(OkxBillsArchive(rows)), _StripBounds(OkxBillsArchive(rows)))

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert out == []
        assert flags.get("daily_pnl_fetch_error_class") == "OkxBillsWindowIncomplete"

    async def test_a_bill_on_a_window_edge_is_counted_once(self) -> None:
        edge = THIRTY_DAYS_BACK_DAY_MS + WEEK_MS  # 2026-10-28T00:00:00Z, window 1 ends and window 2 starts
        rows = [
            okx_bill(6_000_001, edge - 1, "USDT", "0", "3", pnl="3", fee="0", inst_type="SWAP"),
            okx_bill(6_000_002, edge, "USDT", "0", "5", pnl="5", fee="0", inst_type="SWAP"),
        ]
        exchange, _log = _exchange(rows)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert flags == {}
        assert _by_day(out) == {"2026-10-27": 3.0, "2026-10-28": 5.0}

    async def test_an_eight_to_eighty_nine_day_window_reads_the_archive(self) -> None:
        recent = _bills(7_100_000, LIVE_FLOOR_MS + 3_600_000, 1, pnl="2")
        twenty_days_back = _bills(7_000_000, 1793448000000, 1, pnl="7")  # 2026-10-31T12:00Z, only in the archive
        exchange, log = _exchange(recent, archive_rows=twenty_days_back + recent)

        out, flags = await _read(exchange, THIRTY_DAYS_BACK_MS)

        assert flags == {}
        assert _by_day(out) == {"2026-10-31": 7.0, "2026-11-14": 2.0}
        assert any(endpoint == "archive" for endpoint, _p in log)

    async def test_a_straddling_window_reads_both_endpoints_and_counts_each_bill_once(self) -> None:
        nov11 = 1794355200000
        rows = (
            _bills(7_000_000, 1794484800000, 1, pnl="2")  # 2026-11-12T12:00Z: before the live floor
            + _bills(7_000_001, 1794744000000, 1, pnl="4")  # 2026-11-15T12:00Z: both endpoints serve it
        )
        exchange, log = _exchange(rows)

        out, flags = await _read(exchange, nov11)

        assert flags == {}
        assert _by_day(out) == {"2026-11-12": 2.0, "2026-11-15": 4.0}
        first_window = {endpoint for endpoint, p in log if p["begin"] == str(nov11 - 1)}
        assert first_window == {"bills", "archive"}
        last_window = {endpoint for endpoint, p in log if p["begin"] != str(nov11 - 1)}
        assert last_window == {"bills"}

    async def test_a_non_digit_ts_row_still_reaches_the_malformed_path(self) -> None:
        good = okx_bill(20, 1795068000000, "USDT", "0", "1", pnl="1", fee="0", inst_type="SWAP")
        bad = dict(okx_bill(10, 0, "USDT", "0", "1", pnl="1", fee="0", inst_type="SWAP"), ts="abc")

        async def canned(params: dict[str, str]) -> dict[str, Any]:
            return {"data": [dict(good), dict(bad)]} if params["instType"] == "SWAP" else {"data": []}

        out, flags = await _read(_Exchange(canned, canned), 1794960000000)  # since 2026-11-18

        assert flags.get("daily_pnl_malformed_okx") is True
        assert "daily_pnl_fetch_error" not in flags
        assert _by_day(out) == {"2026-11-19": 1.0}

    async def test_a_start_older_than_the_reach_is_clamped_to_it(self) -> None:
        exchange, log = _exchange([])

        out, flags = await _read(exchange, 1781697600000)  # 156 days before NOW_MS

        assert out == [] and flags == {}
        assert log[0][1]["begin"] == str(REACH_START_MS - 1)
        assert min(int(p["begin"]) for _e, p in log) == REACH_START_MS - 1

    async def test_no_start_walks_the_whole_reach(self) -> None:
        exchange, log = _exchange([])

        out, flags = await _read(exchange, None)

        # 14 windows from 2026-08-19: 12 archive-only x 4 instTypes + 1 straddling x 8 + 1 live x 4.
        assert len(log) == 12 * 4 + 8 + 4 == 60
        assert len({(p["begin"], p["end"]) for _e, p in log}) == 14
        assert out == [] and flags == {}

    @pytest.mark.parametrize("reason", ["out_of_window", "order_drift"])
    def test_the_refusal_text_carries_no_digits(self, reason: str) -> None:
        text = str(ex.OkxBillsWindowIncomplete(reason))  # type: ignore[arg-type]
        assert not any(c.isdigit() for c in text)
        assert "OKX" in text


class _StripBounds:
    """A venue that ignores ``begin`` and ``end``: they are removed before the fake answers."""

    def __init__(self, inner: OkxBillsArchive) -> None:
        self.inner = inner

    async def __call__(self, params: dict[str, str]) -> dict[str, Any]:
        return await self.inner({k: v for k, v in params.items() if k not in ("begin", "end")})


def _day_ms(iso_day: str) -> int:
    from datetime import datetime, timezone

    return int(datetime.strptime(iso_day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


def _iso_day(ms: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
