"""Phase 170.2 / SC-5: one-time backfill of BTC closes older than the cache.

``benchmark_prices`` starts later than the oldest strategy's first return, so a
strategy older than the cache pairs against a truncated benchmark and loses
alpha / beta / Treynor / R-squared history. This writes the missing older closes
ONCE, so the consolidated recompute that follows pairs every strategy over its
full history even if Binance is unreachable from Railway that day.

It goes through the product's own path, not a private one:

    get_benchmark_returns("BTC", since=<oldest strategy return date>,
                          require_persist=True)

i.e. the same fetch -> cache-wins merge -> upsert-only-new-dates the recompute
takes. A cached close is never overwritten, so re-running writes nothing new
(idempotent), and ``require_persist=True`` makes a lost write raise instead of
being logged and swallowed.

Flow: read the oldest ``strategy_id``-keyed ``csv_daily_returns`` date (or
``--since``) and the BTC cache's oldest / newest / row count -> print ``before:``
-> call the product path -> re-read -> print ``after:``. Exit 1 when the result is
flagged stale, or when the stored history still starts after the day before
``since`` (the return dated ``since`` needs the previous day's close; the floor is
``BTC_FIRST_DAY``, before which no close exists). ``--dry-run`` stops after the
reads and prints the plan: no fetch, no write.

Usage (service environment supplies SUPABASE_URL / SUPABASE_SERVICE_KEY):
    railway ssh "cd /app && python -m scripts.backfill_btc_benchmark [--dry-run] [--since YYYY-MM-DD]"

If Railway's egress cannot reach Binance, the fallback source cannot span the older
dates, the result is stale, and this exits 1. The documented alternative is to run
it from a machine that can reach Binance, with the service's own environment:
    cd analytics-service && railway run python -m scripts.backfill_btc_benchmark

Output is dates and counts only: never a URL, key or row id.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, timedelta
from typing import NamedTuple

from postgrest.types import CountMethod

from services.benchmark import BTC_FIRST_DAY, get_benchmark_returns
from services.db import db_execute, get_supabase, rows

_SYMBOL = "BTC"


class CacheRange(NamedTuple):
    oldest: date
    newest: date
    n_rows: int


def _iso(value: object) -> date:
    return date.fromisoformat(str(value)[:10])


async def _read_oldest_strategy_return() -> date:
    """Oldest ``csv_daily_returns.date`` among strategy-keyed rows.

    Per-API-key rows carry ``strategy_id`` NULL and are not strategies; one older
    than every strategy must not pull the backfill target back.
    """
    supabase = get_supabase()
    resp = await db_execute(
        lambda: supabase.table("csv_daily_returns")
        .select("date")
        .not_.is_("strategy_id", "null")
        .order("date", desc=False)
        .limit(1)
        .execute()
    )
    got = rows(resp)
    if not got:
        raise RuntimeError(
            "backfill_btc_benchmark: csv_daily_returns returned no strategy-keyed "
            "row; refusing to treat an empty or failed read as 'no history'. "
            "Pass --since YYYY-MM-DD to name the date explicitly."
        )
    return _iso(got[0]["date"])


async def _read_cache_range() -> CacheRange:
    """Oldest, newest and row count of the stored BTC closes."""
    supabase = get_supabase()
    counted = await db_execute(
        lambda: supabase.table("benchmark_prices")
        .select("date", count=CountMethod.exact)
        .eq("symbol", _SYMBOL)
        .limit(1)
        .execute()
    )
    # An exact count was asked for; None means the count header is absent and the
    # read cannot be trusted. Fail loud rather than print zero (Rule 12).
    if counted.count is None:
        raise RuntimeError(
            "backfill_btc_benchmark: benchmark_prices count came back None "
            "(count header absent); refusing to print an unverified row count."
        )
    if counted.count == 0:
        raise RuntimeError(
            "backfill_btc_benchmark: benchmark_prices holds no BTC rows; refusing "
            "to report an empty cache as a result. Inspect the table first."
        )
    oldest_rows = rows(
        await db_execute(
            lambda: supabase.table("benchmark_prices")
            .select("date")
            .eq("symbol", _SYMBOL)
            .order("date", desc=False)
            .limit(1)
            .execute()
        )
    )
    newest_rows = rows(
        await db_execute(
            lambda: supabase.table("benchmark_prices")
            .select("date")
            .eq("symbol", _SYMBOL)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
    )
    if not oldest_rows or not newest_rows:
        raise RuntimeError(
            "backfill_btc_benchmark: benchmark_prices reports rows but the "
            "oldest/newest read came back empty; refusing to print a partial range."
        )
    return CacheRange(
        oldest=_iso(oldest_rows[0]["date"]),
        newest=_iso(newest_rows[0]["date"]),
        n_rows=int(counted.count),
    )


def _fmt(label: str, rng: CacheRange) -> str:
    return f"{label}: oldest={rng.oldest.isoformat()} newest={rng.newest.isoformat()} rows={rng.n_rows}"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="backfill_btc_benchmark",
        description="One-time backfill of BTC closes older than the benchmark cache.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="read and print the plan; no fetch, no write",
    )
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=None,
        metavar="YYYY-MM-DD",
        help="first strategy return date to cover (default: oldest strategy-keyed "
        "csv_daily_returns date)",
    )
    return parser.parse_args(argv)


async def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)

    since: date = args.since if args.since is not None else await _read_oldest_strategy_return()
    # The return dated `since` needs the close of the day before it; no close
    # exists before BTC_FIRST_DAY.
    required_oldest = max(since - timedelta(days=1), BTC_FIRST_DAY)

    before = await _read_cache_range()
    print(_fmt("before", before))
    print(f"plan: since={since.isoformat()} requires closes from {required_oldest.isoformat()}")
    if args.dry_run:
        print("plan: dry-run, no fetch and no write")
        return 0

    series, is_stale = await get_benchmark_returns(
        _SYMBOL, since=since, require_persist=True
    )

    after = await _read_cache_range()
    print(_fmt("after", after))

    if series is None:
        print("FAIL: no benchmark series came back; the sources were unreachable.")
        return 1
    if is_stale:
        print(
            f"FAIL: result is STALE; stored range is {after.oldest.isoformat()} to "
            f"{after.newest.isoformat()}. The older closes were not fetched."
        )
        return 1
    if after.oldest > required_oldest:
        print(
            f"FAIL: stored history is still short: starts {after.oldest.isoformat()}, "
            f"needs {required_oldest.isoformat()}."
        )
        return 1
    print(f"ok: stored history reaches {after.oldest.isoformat()} (needs {required_oldest.isoformat()}).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
