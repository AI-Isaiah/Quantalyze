"""Phase 12 / D-07: kill-switch — cut over heavy keys from metrics_json to sibling table
when p99.9 (post-TOAST-compression on-disk size) >= 800kB.

Usage:
    python -m scripts.phase12_kill_switch                 # auto-runs SQL probe
    python -m scripts.phase12_kill_switch --p999 820000 --count 15
    SKIP_KILL_SWITCH=1 python -m scripts.phase12_kill_switch  # honors override

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

# P2024 (audit-2026-05-07 round 2): the heavy-kind allowlist is no longer
# encoded in Python. Migration 129's `cutover_strategy_metrics_keys_atomic`
# RPC defines `v_allowlist` server-side and reads metrics_json under
# SELECT ... FOR UPDATE — the Python caller never touches the snapshot.
# Keeping a duplicate list here invites drift; the single source of truth
# lives in supabase/migrations/129_*.sql.

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

def measure_p999_via_sql() -> tuple[float, int]:
    """Run analyze_metrics_size.sql via psql; return (p999_bytes, strategy_count).

    Uses pg_column_size (post-TOAST-compression on-disk size). M-03: this is the
    only authoritative measurement — never approximate via Python json round-trip.
    """
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError(
            "phase12_kill_switch: DATABASE_URL (or SUPABASE_DB_URL) not set; "
            "cannot run pg_column_size SQL probe (M-03)."
        )
    sql = SQL_PROBE_PATH.read_text()
    result = subprocess.run(
        ["psql", db_url, "-tAF,", "-c", sql],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe failed: {result.stderr.strip()}"
        )
    # Output columns (per analyze_metrics_size.sql contract):
    #   p50_bytes,p95_bytes,p99_bytes,p999_bytes,max_bytes,strategy_count
    line = ""
    if result.stdout.strip():
        line = result.stdout.strip().splitlines()[-1]
    parts = line.split(",")
    if len(parts) < 6:
        raise RuntimeError(f"phase12_kill_switch: unexpected SQL output: {line!r}")
    p999 = float(parts[3]) if parts[3] else 0.0
    n = int(parts[5]) if parts[5] else 0
    return (p999, n)


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
    # Run synchronously via subprocess; psql is fast enough that wrapping in
    # asyncio.to_thread is overkill for a one-shot deploy invocation.
    return measure_p999_via_sql()


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
    return int((result.data or {}).get("moved", 0))


# --- Main ------------------------------------------------------------------

async def main(
    cli_p999: float | None = None,
    cli_count: int | None = None,
) -> int:
    if os.getenv("SKIP_KILL_SWITCH") == "1":
        print("phase12_kill_switch: SKIP_KILL_SWITCH=1 — bypassing.")
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
    total_moved = 0
    strategy_ids = [r["strategy_id"] for r in (rows.data or [])]
    for sid in strategy_ids:
        moved = await cutover_strategy(sid)
        total_moved += moved
        print(f"  strategy {sid}: moved {moved} keys")

    print(
        f"phase12_kill_switch: COMPLETE — {total_moved} keys moved across "
        f"{len(strategy_ids)} strategies"
    )

    # Append a log entry to TODOS.md so the trigger is auditable in-tree.
    if TODOS_PATH.exists():
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        TODOS_PATH.write_text(
            TODOS_PATH.read_text()
            + (
                f"\n## Kill-switch triggered (D-07) — {ts}\n"
                f"- p99.9 = {p999:.0f} bytes (threshold {THRESHOLD_BYTES}); "
                f"moved {total_moved} keys across {len(strategy_ids)} strategies.\n"
            )
        )

    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Phase 12 kill-switch — DB-side pg_column_size measurement only (M-03). "
            "Honors SKIP_KILL_SWITCH=1."
        )
    )
    parser.add_argument(
        "--p999",
        type=float,
        default=None,
        help="pg_column_size p99.9 in bytes (from phase12_deploy.py SQL probe)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="strategy_count from SQL probe",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(cli_p999=args.p999, cli_count=args.count)))
