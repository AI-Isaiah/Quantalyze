"""Phase 12 deploy orchestrator.

Run this AFTER migrations 086 + 087 have applied (Plan 02 Task 3 schema push).

Order of operations:
  1. M-01: read TRADE_MIX_HAS_MAKER_TAKER from
     .planning/phases/12-backend-metric-contracts/TODOS.md → write to ./.env.test
     (gitignored) so CI sources the audited value before parity tests.
  2. M-03: run analyze_metrics_size.sql via psql; capture p99.9 + strategy_count
     from the CSV output. NEVER approximated via Python json round-trip; the SQL
     probe (pg_column_size) is the only authoritative measurement.
  3. Pass (p999, count) to phase12_kill_switch.main(...) — auto-cuts over heavy
     keys from metrics_json → strategy_analytics_series when p99.9 ≥ 800kB.
  4. M-02: phase12_backfill_enqueue.main() — pre-checks pending compute_analytics
     jobs and skips when any are present (no duplicate-job pile-ups).

The throttle in main_worker.dispatch_tick (Plan 07) guarantees backfill cannot
starve sync_trades — the migration 086 RPC's ORDER BY + low-skip guard pace it.

Usage:
    cd analytics-service
    python -m scripts.phase12_deploy                          # kill-switch OFF by default (P2021)
    RUN_KILL_SWITCH=true python -m scripts.phase12_deploy     # enable kill-switch
"""
from __future__ import annotations

import asyncio
import math
import os
import re
import subprocess
import sys
from pathlib import Path

# Co-located scripts; importing via the package path mirrors how
# `python -m scripts.phase12_deploy` resolves them.
from scripts import phase12_backfill_enqueue, phase12_kill_switch

# Resolve project root from this file's location: analytics-service/scripts/<file>
# parents[0] = scripts/, parents[1] = analytics-service/, parents[2] = repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
TODOS_PATH = (
    REPO_ROOT / ".planning" / "phases" / "12-backend-metric-contracts" / "TODOS.md"
)
ENV_TEST_PATH = REPO_ROOT / ".env.test"
SQL_PROBE_PATH = Path(__file__).resolve().parent / "analyze_metrics_size.sql"


# --- M-01: TRADE_MIX_HAS_MAKER_TAKER propagation ---------------------------

def _read_trade_mix_flag_from_todos() -> str:
    """M-01: TODOS.md is the canonical source-of-truth for the audit decision.

    Plan 12-01 Task 1 writes the literal line `TRADE_MIX_HAS_MAKER_TAKER = true|false`
    based on the is_maker coverage audit. We read it back here verbatim and
    propagate to .env.test for CI consumption.

    Default 'false' on absent file or unmatched line — CI defaults to the safer
    2-bucket Trade Mix path rather than booting the 4-bucket reader against
    incomplete fixture data.
    """
    if not TODOS_PATH.exists():
        print(
            f"phase12_deploy: WARNING — TODOS.md not found at {TODOS_PATH}; "
            f"defaulting TRADE_MIX_HAS_MAKER_TAKER=false"
        )
        return "false"
    text = TODOS_PATH.read_text()
    m = re.search(r"TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)", text)
    if not m:
        print(
            "phase12_deploy: WARNING — TRADE_MIX_HAS_MAKER_TAKER not found in "
            "TODOS.md; defaulting to false"
        )
        return "false"
    return m.group(1)


def _write_env_test(flag: str) -> None:
    """M-01: write TRADE_MIX_HAS_MAKER_TAKER to .env.test (gitignored).

    Preserves any other keys already in .env.test so this script can be re-run
    without clobbering local CI overrides. Strips and rewrites only our key.
    """
    existing_lines: list[str] = []
    if ENV_TEST_PATH.exists():
        existing_lines = [
            line
            for line in ENV_TEST_PATH.read_text().splitlines()
            if not line.startswith("TRADE_MIX_HAS_MAKER_TAKER=")
            and line.strip() != ""
        ]
    existing_lines.append(f"TRADE_MIX_HAS_MAKER_TAKER={flag}")
    ENV_TEST_PATH.write_text("\n".join(existing_lines) + "\n")
    print(
        f"phase12_deploy: wrote TRADE_MIX_HAS_MAKER_TAKER={flag} to {ENV_TEST_PATH}"
    )


# --- M-03: SQL probe -------------------------------------------------------

def _parse_probe_value(raw: str) -> float:
    """P2022: parse + validate a probe value. NaN/inf/negative all raise."""
    if raw is None or raw == "":
        raise ValueError("phase12_deploy: empty probe value")
    val = float(raw)
    if not math.isfinite(val):
        raise ValueError(
            f"phase12_deploy: non-finite probe value {raw!r} (NaN/inf rejected)"
        )
    if val < 0:
        raise ValueError(
            f"phase12_deploy: negative probe value {raw!r} (size cannot be < 0)"
        )
    return val


def _run_sql_probe() -> tuple[float, int]:
    """M-03: run analyze_metrics_size.sql via psql; return (p999_bytes, strategy_count).

    Single source of truth for size measurement — pg_column_size is the only
    quantity that correlates with the 1MB JSONB decompression ceiling.

    P2022: parses keyed (k,v) output rows; requires `p999` and `count` keys
    to be present; rejects NaN/inf/negative numeric values; uses explicit
    `--dbname` flag.
    """
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError(
            "phase12_deploy: DATABASE_URL (or SUPABASE_DB_URL) not set; "
            "cannot run pg_column_size SQL probe (M-03)."
        )
    sql = SQL_PROBE_PATH.read_text()
    result = subprocess.run(
        ["psql", "--dbname", db_url, "-tAF,", "-c", sql],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"phase12_deploy: SQL probe failed: {result.stderr.strip()}"
        )
    parsed: dict[str, str] = {}
    for line in result.stdout.strip().splitlines():
        parts = line.split(",")
        if len(parts) != 2:
            raise RuntimeError(
                f"phase12_deploy: unexpected SQL output line {line!r} "
                f"(expected `key,value`)"
            )
        parsed[parts[0].strip()] = parts[1].strip()

    if "p999" not in parsed:
        raise RuntimeError(
            f"phase12_deploy: SQL probe missing required key 'p999'; "
            f"got keys {sorted(parsed.keys())!r}"
        )
    if "count" not in parsed:
        raise RuntimeError(
            f"phase12_deploy: SQL probe missing required key 'count'; "
            f"got keys {sorted(parsed.keys())!r}"
        )
    p999 = _parse_probe_value(parsed["p999"])
    n = int(_parse_probe_value(parsed["count"]))
    return (p999, n)


# --- Main ------------------------------------------------------------------

async def main() -> int:
    print("=== Phase 12 deploy: starting ===")

    # Step 1 (M-01): TRADE_MIX_HAS_MAKER_TAKER propagation.
    flag = _read_trade_mix_flag_from_todos()
    _write_env_test(flag)
    # Mirror to current process env so any subprocess kicked off later inherits it.
    os.environ["TRADE_MIX_HAS_MAKER_TAKER"] = flag

    # Step 2 (M-03): authoritative DB-side size probe.
    try:
        p999, n_strategies = _run_sql_probe()
        print(
            f"phase12_deploy: SQL probe — p99.9 = {p999:.0f} bytes "
            f"across {n_strategies} strategies"
        )
    except Exception as exc:
        print(f"phase12_deploy: SQL probe failed: {exc}")
        print(
            "phase12_deploy: aborting deploy — cannot make kill-switch decision "
            "without DB-side measurement"
        )
        return 1

    # Step 3: kill-switch with caller-provided p999/count (M-03 path).
    rc = await phase12_kill_switch.main(cli_p999=p999, cli_count=n_strategies)
    if rc != 0:
        print(f"phase12_deploy: kill-switch returned {rc} — aborting")
        return rc

    # Step 4 (M-02): backfill enqueue with duplicate-job guard.
    rc = await phase12_backfill_enqueue.main()
    if rc != 0:
        print(
            f"phase12_deploy: backfill enqueue returned {rc} — backfill may be partial"
        )
        return rc

    print("=== Phase 12 deploy: complete ===")
    print("Monitor compute_analytics queue depth for the next ~10 min:")
    print(
        "  SELECT count(*) FROM compute_jobs "
        "WHERE kind='compute_analytics' AND status='pending';"
    )
    print("Phase 12 SC#4: queue depth should never exceed 50 for >10 min.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
