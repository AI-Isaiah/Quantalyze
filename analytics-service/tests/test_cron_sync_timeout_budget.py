"""167.1.2.2.2 plan 06, SC-5 — the filtered tick fits the pg_net timeout.

WHAT IS UNDER TEST. The daily tick (`public.cron_sync_tick()`) posts to
`/api/cron-sync` with a `timeout_milliseconds` declared ONCE, in the committed
migration. The route walks its keys exchange by exchange, in batches of
`BATCH_SIZE` run concurrently, each key bounded by `KEY_SYNC_TIMEOUT`, with an
`EXCHANGE_BATCH_DELAY` between batches of the same exchange. If the worst case of
that walk reaches the tick's timeout, pg_net gives up on a run that is still
writing; if it reaches Railway's 300 s idle cut-off, the connection is cut under
the run.

WHY THE FILTER IS LOAD-BEARING (RESEARCH Section 1 and 5, PROD census
2026-10-09). Unfiltered, the tick would walk 42 active keys; filtered (D-13:
connected AND backing an eligible strategy) it walks 4. The unfiltered walk does
not fit; the filtered one does. This file pins both halves, so removing the
filter, or growing a batch constant, fails here by name instead of as a silent
mid-run cut-off on PROD.

THE ARITHMETIC IS CHECKED AGAINST THE ROUTE, NOT ONLY WRITTEN DOWN. A formula in
a test that nothing ties to the route would stay green if the route's batching
changed shape (say, sequential keys), so `TestTheModelMatchesTheRoute` drives the
real `cron_sync` loop and reads the batch sizes and the delays it actually uses.

The timeout is read out of the migration TEXT, never restated as a second literal
here: a stale copy would pin a number nobody runs.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from routers import cron as cron_mod

# Railway's idle cut-off for a request with no bytes on the wire (RESEARCH
# Section 1). A platform fact, not a repo constant.
RAILWAY_IDLE_CUTOFF_S = 300

# The go-live runbook's rehearsal decision rule (plan 17): a rehearsal that runs
# longer than this is not a pass. It must sit below the tick's timeout, or the
# rule would accept a run pg_net had already abandoned.
RUNBOOK_REHEARSAL_CEILING_S = 90

# Key census per exchange, written as literals with their date.
#   FILTERED: connected keys backing an eligible strategy, PROD 2026-10-09
#   (RESEARCH Section 5): okx 3, bybit 1.
#   UNFILTERED: every active ccxt key on the same day: okx 11, deribit 16,
#   bybit 6. The 9 mt5 keys take the benign `deferred` path and are left out.
FILTERED_CENSUS_2026_10_09 = {"okx": 3, "bybit": 1}
UNFILTERED_CENSUS_2026_10_09 = {"okx": 11, "deribit": 16, "bybit": 6}

_MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def _tick_timeout_s() -> float:
    """`timeout_milliseconds` out of the ONE committed tick migration, in seconds."""
    files = sorted(_MIGRATIONS.glob("*_cron_sync_tick.sql"))
    assert len(files) == 1, (
        f"expected exactly one *_cron_sync_tick.sql under {_MIGRATIONS}, "
        f"found {[f.name for f in files]!r}"
    )
    matches = re.findall(r"timeout_milliseconds\s*:=\s*(\d+)", files[0].read_text())
    assert len(matches) == 1, (
        f"expected exactly one `timeout_milliseconds := N` in {files[0].name}, "
        f"found {matches!r}: a second declaration would make the timeout "
        "ambiguous"
    )
    return int(matches[0]) / 1000


def _worst_case_s(census: dict[str, int]) -> float:
    """Worst case of the route's walk: exchanges run one after another; within one,
    `ceil(n / BATCH_SIZE)` batches each cost a full `KEY_SYNC_TIMEOUT` (every key
    in the batch timing out at once), with `EXCHANGE_BATCH_DELAY` between batches.
    Portfolio recomputes add 0: none of the census strategies is in a portfolio
    (RESEARCH Section 5)."""
    total = 0.0
    for n in census.values():
        batches = math.ceil(n / cron_mod.BATCH_SIZE)
        total += (
            batches * cron_mod.KEY_SYNC_TIMEOUT
            + (batches - 1) * cron_mod.EXCHANGE_BATCH_DELAY
        )
    return total


class TestTickTimeoutBudget:
    def test_the_tick_migration_declares_one_parseable_timeout(self):
        timeout_s = _tick_timeout_s()
        assert 0 < timeout_s < RAILWAY_IDLE_CUTOFF_S, (
            f"the tick timeout {timeout_s}s must be above 0 and below Railway's "
            f"{RAILWAY_IDLE_CUTOFF_S}s idle cut-off, or the cut-off decides the run"
        )

    def test_the_filtered_worst_case_fits_the_tick_timeout_and_railway(self):
        worst = _worst_case_s(FILTERED_CENSUS_2026_10_09)
        timeout_s = _tick_timeout_s()
        assert worst < timeout_s, (
            f"filtered worst case {worst}s reaches the tick timeout {timeout_s}s "
            f"(BATCH_SIZE={cron_mod.BATCH_SIZE}, KEY_SYNC_TIMEOUT="
            f"{cron_mod.KEY_SYNC_TIMEOUT}, EXCHANGE_BATCH_DELAY="
            f"{cron_mod.EXCHANGE_BATCH_DELAY}): pg_net would abandon a run that "
            "is still writing"
        )
        assert worst < RAILWAY_IDLE_CUTOFF_S, (
            f"filtered worst case {worst}s reaches Railway's "
            f"{RAILWAY_IDLE_CUTOFF_S}s idle cut-off"
        )

    def test_the_runbook_rehearsal_ceiling_sits_below_the_tick_timeout(self):
        assert RUNBOOK_REHEARSAL_CEILING_S < _tick_timeout_s()

    def test_the_unfiltered_census_would_not_fit_which_is_why_the_filter_exists(self):
        worst = _worst_case_s(UNFILTERED_CENSUS_2026_10_09)
        assert worst > RAILWAY_IDLE_CUTOFF_S, (
            f"the unfiltered census now fits ({worst}s <= {RAILWAY_IDLE_CUTOFF_S}s). "
            "If a constant moved so that it does, D-13's recorded reason for the "
            "selector filter changed and the ADR must be re-read; if it did not, "
            "the census literal above is stale."
        )
        assert worst > _tick_timeout_s()


class TestTheModelMatchesTheRoute:
    """The arithmetic above assumes: one exchange at a time, keys of an exchange
    in concurrent batches of `BATCH_SIZE`, and a delay only BETWEEN batches of
    the same exchange. Drive the real loop and measure those three facts."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "census",
        [FILTERED_CENSUS_2026_10_09, {"okx": cron_mod.BATCH_SIZE + 2, "bybit": 1}],
    )
    async def test_batches_and_delays_are_what_the_formula_counts(self, census):
        import asyncio

        keys: list[dict[str, Any]] = []
        for exchange, n in census.items():
            for i in range(n):
                keys.append(
                    {
                        "id": f"{exchange}-{i}",
                        "exchange": exchange,
                        "is_active": True,
                        "strategies": [{"id": f"s-{exchange}-{i}", "status": "published"}],
                    }
                )

        in_flight = {"now": 0, "peak_by_exchange": {}}
        delays: list[float] = []

        async def _fake_sync(key_row: dict[str, Any], _kek: bytes) -> dict[str, Any]:
            in_flight["now"] += 1
            exchange = key_row["exchange"]
            peaks = in_flight["peak_by_exchange"]
            peaks[exchange] = max(peaks.get(exchange, 0), in_flight["now"])
            await asyncio.sleep(0)  # yield, so a concurrent batch overlaps
            in_flight["now"] -= 1
            return {
                "key_id": key_row["id"],
                "exchange": exchange,
                "status": "ok",
                "trades_fetched": 0,
                "duration_s": 0.0,
            }

        real_sleep = asyncio.sleep

        async def _record_sleep(seconds: float, *a: Any, **k: Any) -> None:
            if seconds:  # the yield above is sleep(0); only real delays count
                delays.append(seconds)
            await real_sleep(0)

        class _Query:
            def select(self, *_a: Any, **_k: Any) -> "_Query":
                return self

            def eq(self, *_a: Any, **_k: Any) -> "_Query":
                return self

            def is_(self, *_a: Any, **_k: Any) -> "_Query":
                return self

            def execute(self) -> Any:
                return MagicMock(data=[dict(k, strategies=list(k["strategies"])) for k in keys])

        supabase = MagicMock()
        supabase.table.side_effect = lambda name: (
            _Query() if name == "api_keys" else MagicMock(data=[])
        )

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=supabase), \
             patch.object(cron_mod, "_sync_key_with_timeout", _fake_sync), \
             patch.object(cron_mod.asyncio, "sleep", _record_sleep):
            response = await cron_mod.cron_sync()

        assert response["total_keys"] == sum(census.values())
        for exchange, n in census.items():
            assert in_flight["peak_by_exchange"][exchange] == min(
                n, cron_mod.BATCH_SIZE
            ), (
                f"{exchange}: keys of one exchange no longer run in concurrent "
                "batches of BATCH_SIZE, so the formula's batch count is wrong"
            )
        expected_delays = sum(
            math.ceil(n / cron_mod.BATCH_SIZE) - 1 for n in census.values()
        )
        assert delays == [cron_mod.EXCHANGE_BATCH_DELAY] * expected_delays, (
            f"delays {delays!r}: the formula counts one EXCHANGE_BATCH_DELAY "
            "between batches of the same exchange and none after the last"
        )
