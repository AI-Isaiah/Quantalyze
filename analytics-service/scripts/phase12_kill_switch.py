"""Phase 12 / D-07: kill-switch — cut over heavy keys from metrics_json to sibling table
when p99.9 (post-TOAST-compression on-disk size) >= 800kB.

Usage:
    # Opt-IN: kill-switch is OFF by default; set RUN_KILL_SWITCH to enable.
    RUN_KILL_SWITCH=true python -m scripts.phase12_kill_switch              # auto-runs SQL probe
    RUN_KILL_SWITCH=true python -m scripts.phase12_kill_switch --p999 820000 --count 15
    python -m scripts.phase12_kill_switch                                   # bypass (default)

P2021 (audit-2026-05-07 round 2):
    Inverted from the prior opt-OUT `SKIP_KILL_SWITCH=1` polarity — that fired the
    kill-switch by default on partial deploys. RUN_KILL_SWITCH is now an opt-IN
    truthy parse (true|yes|1|on / false|no|0|off|""); unknown values raise SystemExit
    rather than silently defaulting (CLAUDE.md Rule 12: fail loud).

Idempotent: re-running after a successful cutover is a no-op (heavy keys already missing
from metrics_json; the batch upsert into strategy_analytics_series is itself an upsert).

M-03 (12-REVIEWS.md):
    The size measurement is ALWAYS DB-side (pg_column_size). Two paths:
      1. phase12_deploy.py runs analyze_metrics_size.sql once and passes p999/count
         via --p999 / --count CLI args (preferred — single round-trip).
      2. If invoked standalone, this module re-runs the same SQL via psql subprocess
         using DATABASE_URL / SUPABASE_DB_URL.
    NEVER measure via Python json round-trip — that bypasses TOAST compression and
    misreports by 30-50% (see M-03 in 12-REVIEWS.md).
"""
from __future__ import annotations

import argparse
import asyncio
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# This module lives in analytics-service/scripts/. The analytics-service services
# package is on sys.path when invoked via `python -m scripts.phase12_kill_switch`
# from the analytics-service directory.
from services.db import db_execute, get_supabase

# --- Constants -------------------------------------------------------------

THRESHOLD_BYTES = 800_000  # 800kB — Phase 12 SC#3a kill-switch trigger.

# P2021: opt-IN env var (replaces prior opt-OUT SKIP_KILL_SWITCH=1). Unknown
# values fall through to _parse_run_flag's SystemExit (CLAUDE.md Rule 12).
_TRUTHY = frozenset({"true", "yes", "1", "on"})
_FALSY = frozenset({"false", "no", "0", "off", ""})


def _parse_run_flag(value: str) -> bool:
    """Parse a RUN_KILL_SWITCH-shaped env value with case folding.

    Truthy: true / yes / 1 / on
    Falsy:  false / no / 0 / off / "" (unset is handled by the caller)

    Unknown values raise SystemExit (Rule 12: fail loud — a typo like
    `RUN_KILL_SWITCH=ture` must not silently default to either polarity).
    """
    norm = (value or "").strip().lower()
    if norm in _TRUTHY:
        return True
    if norm in _FALSY:
        return False
    raise SystemExit(
        f"phase12_kill_switch: RUN_KILL_SWITCH={value!r} is not a recognized "
        f"boolean (expected one of: true/yes/1/on or false/no/0/off). "
        f"Aborting to avoid an ambiguous kill-switch decision."
    )


# P2024: the heavy-kind allowlist is no longer encoded in Python. Migration
# 129's `cutover_strategy_metrics_keys_atomic` RPC defines `v_allowlist`
# server-side and reads metrics_json under SELECT ... FOR UPDATE — the
# Python caller never touches the snapshot. Single source of truth lives
# in supabase/migrations/129_*.sql.

SQL_PROBE_PATH = Path(__file__).parent / "analyze_metrics_size.sql"

# Path to the phase 12 TODOS file — kill-switch trigger appends a log entry here.
TODOS_PATH = (
    Path(__file__).resolve().parents[2]
    / ".planning"
    / "phases"
    / "12-backend-metric-contracts"
    / "TODOS.md"
)


# --- Size measurement ------------------------------------------------------


def _parse_probe_value(raw: str) -> float:
    """Parse a single probe value (size in bytes) from psql output.

    Rejects NaN/inf/negative values rather than letting them poison the
    kill-switch threshold compare. Empty/missing is also rejected — the
    caller must not paper over a NULL row with `0.0` (that would make an
    empty DB look like "everything is fine" instead of "no data, abort").

    Normalizes float("-0") (which Python produces from "-0", "-0.0") to a
    positive 0.0 — the value is zero, and the sign would otherwise leak
    through to downstream comparisons in subtle ways.
    """
    if raw is None or raw == "":
        raise ValueError("phase12_kill_switch: empty probe value")
    val = float(raw)  # raises ValueError on garbage
    if not math.isfinite(val):
        raise ValueError(
            f"phase12_kill_switch: non-finite probe value {raw!r} (NaN/inf rejected)"
        )
    if val < 0:
        raise ValueError(
            f"phase12_kill_switch: negative probe value {raw!r} (size cannot be < 0)"
        )
    return 0.0 if val == 0 else val


def _nonneg_finite(raw: str) -> float:
    """argparse `type=` validator. Same contract as _parse_probe_value but
    accepts `argparse`'s string input shape. Used for --p999."""
    return _parse_probe_value(raw)


def _nonneg_finite_int(raw: str) -> int:
    """argparse `type=` validator for integer-valued counts. Same nonneg+
    finite contract as _parse_probe_value, but rejects non-integer floats
    (e.g. `--count 3.7`) rather than silently truncating to 3."""
    val = _parse_probe_value(raw)
    if val != int(val):
        raise ValueError(
            f"phase12_kill_switch: --count must be integer-valued, got {raw!r}"
        )
    return int(val)


def measure_p999_via_sql() -> tuple[float, int]:
    """Run analyze_metrics_size.sql via psql; return (p999_bytes, strategy_count).

    Uses pg_column_size (post-TOAST-compression on-disk size). M-03: this is the
    only authoritative measurement — never approximate via Python json round-trip.

    P2022: parses keyed output (k,v rows) rather than positional CSV columns —
    a SQL re-order can no longer silently shift the parsed p999 to a different
    percentile. Requires keys `p999` and `count` to be present; rejects NaN/
    inf/negative values.
    """
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError(
            "phase12_kill_switch: DATABASE_URL (or SUPABASE_DB_URL) not set; "
            "cannot run pg_column_size SQL probe (M-03)."
        )
    sql = SQL_PROBE_PATH.read_text()
    # P2022: explicit --dbname flag (the previous positional dbname was easy to
    # mis-read as a query when reviewing CI logs).
    result = subprocess.run(
        ["psql", "--dbname", db_url, "-tAF,", "-c", sql],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe failed: {result.stderr.strip()}"
        )
    parsed: dict[str, str] = {}
    for line in result.stdout.strip().splitlines():
        parts = line.split(",")
        if len(parts) != 2:
            raise RuntimeError(
                f"phase12_kill_switch: unexpected SQL output line {line!r} "
                f"(expected `key,value`)"
            )
        parsed[parts[0].strip()] = parts[1].strip()

    if "p999" not in parsed:
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe missing required key 'p999'; "
            f"got keys {sorted(parsed.keys())!r}"
        )
    if "count" not in parsed:
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe missing required key 'count'; "
            f"got keys {sorted(parsed.keys())!r}"
        )

    # Validate count first: an empty strategy_analytics table produces
    # count=0 and NULL→empty-string percentiles. Without this guard, the
    # p999 parse below would raise a generic "empty probe value" error and
    # the operator would mistake "you ran this against the wrong DB" for
    # "the kill-switch is broken". Fail loud with an explicit diagnostic.
    count = int(_parse_probe_value(parsed["count"]))
    if count == 0:
        raise RuntimeError(
            "phase12_kill_switch: SQL probe returned strategy_count=0 — "
            "refusing to make a kill-switch decision against an empty "
            "strategy_analytics table. Check that DATABASE_URL points to "
            "the correct DB."
        )

    p999 = _parse_probe_value(parsed["p999"])
    return (p999, count)


async def measure_p999(
    cli_p999: float | None = None,
    cli_count: int | None = None,
) -> tuple[float, int]:
    """Returns (p999_bytes, strategy_count).

    Prefers caller-provided values (M-03: phase12_deploy.py runs the SQL probe once
    and passes the result here). Falls back to direct subprocess execution.
    """
    if cli_p999 is not None and cli_count is not None:
        return (cli_p999, cli_count)
    # Offload blocking psql subprocess to a worker thread so the event loop
    # is not parked for the probe duration. The fallback path is rare (the
    # deploy orchestrator normally passes --p999/--count), but if a future
    # caller composes this with asyncio.gather, the loop must stay live.
    return await asyncio.to_thread(measure_p999_via_sql)


# --- Cutover logic ---------------------------------------------------------

async def cutover_strategy(strategy_id: str) -> int:
    """Atomic cutover via migration 129's `cutover_strategy_metrics_keys_atomic`.

    P2024 (audit-2026-05-07 round 2):
        The previous flow SELECTed metrics_json over PostgREST, projected a
        sibling payload in Python, then called the migration 088 RPC with
        that client-side snapshot. Between the SELECT and the RPC call,
        analytics_runner could write a NEW metrics_json the cutover wouldn't
        observe — a race window that could partially drop runner writes.

        Migration 129's RPC reads metrics_json INSIDE the Postgres function
        body under SELECT ... FOR UPDATE, copies the v_allowlist heavy keys
        into strategy_analytics_series, strips them from metrics_json, and
        returns `jsonb_build_object('moved', <int>)`. The entire read+strip
        runs under a row lock — no race window vs concurrent writers.

    Idempotent (per migration 129's contract): a re-run for a strategy whose
    heavy keys are already in the sibling table is a no-op.
    """
    supabase = get_supabase()
    result = await db_execute(
        lambda: supabase.rpc(
            "cutover_strategy_metrics_keys_atomic",
            {"p_strategy_id": strategy_id},
        ).execute()
    )
    payload = result.data
    # Migration 129 returns jsonb_build_object('moved', N) — a scalar JSONB
    # dict. Anything else (None, list, dict-without-'moved') indicates the
    # migration was rolled back or the wire format changed. Fail loud
    # rather than silently returning 0 and reporting "moved 0 keys" as if
    # everything succeeded (Rule 12).
    if not isinstance(payload, dict) or "moved" not in payload:
        raise RuntimeError(
            f"cutover_strategy_metrics_keys_atomic({strategy_id}) returned "
            f"unexpected shape {payload!r}; expected {{'moved': <int>}}. "
            f"Aborting cutover to avoid silent under-count."
        )
    return int(payload["moved"])


# --- Main ------------------------------------------------------------------

async def main(
    cli_p999: float | None = None,
    cli_count: int | None = None,
) -> int:
    # P2021: opt-IN. Default (unset) → bypass. Truthy → run. Garbage → SystemExit.
    raw = os.getenv("RUN_KILL_SWITCH")
    if raw is None or not _parse_run_flag(raw):
        print(
            "phase12_kill_switch: RUN_KILL_SWITCH not set (or falsy) — bypassing. "
            "Set RUN_KILL_SWITCH=true to enable."
        )
        return 0

    p999, n = await measure_p999(cli_p999=cli_p999, cli_count=cli_count)
    print(
        f"phase12_kill_switch: probe — p99.9 = {p999:.0f} bytes across {n} strategies "
        f"(threshold {THRESHOLD_BYTES}) [M-03: pg_column_size, DB-side only]"
    )

    if p999 < THRESHOLD_BYTES:
        print("phase12_kill_switch: p99.9 < threshold — no cutover needed.")
        return 0

    print("phase12_kill_switch: TRIGGERED — cutting over heavy keys for all strategies")

    supabase = get_supabase()
    rows = await db_execute(
        lambda: supabase.table("strategy_analytics").select("strategy_id").execute()
    )
    # rows.data is None on PostgREST query failure — None must NOT silently
    # coerce to [] and let the loop emit "moved 0 keys across 0 strategies"
    # as if the trigger was a no-op (Rule 12).
    if rows.data is None:
        raise RuntimeError(
            "phase12_kill_switch: strategy_analytics select returned None "
            "(PostgREST query failure); refusing to log a kill-switch "
            "no-op against an unverified row set."
        )
    strategy_ids = [r["strategy_id"] for r in rows.data]

    # Per-strategy try/except so a mid-loop RPC failure cannot skip the
    # post-loop audit-log write. Mirror P2025: collect (sid, exc) failures,
    # always write the TODOS.md entry with moved/failed counts, return
    # non-zero when any strategy failed.
    total_moved = 0
    failures: list[tuple[str, str]] = []
    for sid in strategy_ids:
        try:
            moved = await cutover_strategy(sid)
            total_moved += moved
            print(f"  strategy {sid}: moved {moved} keys")
        except Exception as exc:
            failures.append((sid, repr(exc)))
            print(
                f"  strategy {sid}: WARNING — cutover failed: {exc!r} (continuing)"
            )

    status = "COMPLETE" if not failures else "PARTIAL"
    print(
        f"phase12_kill_switch: {status} — {total_moved} keys moved across "
        f"{len(strategy_ids) - len(failures)}/{len(strategy_ids)} strategies"
        + (f" ({len(failures)} failed)" if failures else "")
    )

    # Always append the audit-log entry — even on partial completion the
    # mutations that DID land must be recoverable from in-tree history.
    if TODOS_PATH.exists():
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        TODOS_PATH.write_text(
            TODOS_PATH.read_text()
            + (
                f"\n## Kill-switch triggered (D-07) — {ts}\n"
                f"- p99.9 = {p999:.0f} bytes (threshold {THRESHOLD_BYTES}); "
                f"moved {total_moved} keys across "
                f"{len(strategy_ids) - len(failures)}/{len(strategy_ids)} "
                f"strategies ({len(failures)} failed).\n"
            )
        )

    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Phase 12 kill-switch — DB-side pg_column_size measurement only (M-03). "
            "Opt-IN: set RUN_KILL_SWITCH=true to enable; default is bypass (P2021)."
        )
    )
    parser.add_argument(
        "--p999",
        type=_nonneg_finite,  # P2022: reject NaN / inf / negative at parse time.
        default=None,
        help="pg_column_size p99.9 in bytes (from phase12_deploy.py SQL probe)",
    )
    parser.add_argument(
        "--count",
        type=_nonneg_finite_int,
        default=None,
        help="strategy_count from SQL probe (integer)",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(cli_p999=args.p999, cli_count=args.count)))
