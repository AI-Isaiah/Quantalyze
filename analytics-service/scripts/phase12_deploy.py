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
from typing import Literal, NewType, cast
from urllib.parse import urlparse

# Co-located scripts; importing via the package path mirrors how
# `python -m scripts.phase12_deploy` resolves them.
from scripts import phase12_kill_switch

# Resolve project root from this file's location: analytics-service/scripts/<file>
# parents[0] = scripts/, parents[1] = analytics-service/, parents[2] = repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
TODOS_PATH = (
    REPO_ROOT / ".planning" / "phases" / "12-backend-metric-contracts" / "TODOS.md"
)
ENV_TEST_PATH = REPO_ROOT / ".env.test"
SQL_PROBE_PATH = Path(__file__).resolve().parent / "analyze_metrics_size.sql"


# --- M-01: TRADE_MIX_HAS_MAKER_TAKER propagation ---------------------------

# M-0636: the flag is a closed two-value enum, not an arbitrary string. The
# regex below only ever captures "true"/"false", but typing the return as a
# bare `str` would let a future edit return "TRUE"/"1"/"yes" and silently
# bypass analytics_runner's `.lower() == "true"` parse on the consuming side.
# Pinning the Literal makes any such drift a type-check failure. Note the
# reader has NO default branch: a missing/absent flag raises rather than
# silently defaulting to "false" (a false default would let a misconfigured
# deploy run parity tests against the wrong bucket path).
TradeMixFlag = Literal["true", "false"]


def _read_trade_mix_flag_from_todos() -> TradeMixFlag:
    """M-01: TODOS.md is the canonical source-of-truth for the audit decision.

    Plan 12-01 Task 1 writes the literal line `TRADE_MIX_HAS_MAKER_TAKER = true|false`
    based on the is_maker coverage audit. We read it back here verbatim and
    propagate to .env.test for CI consumption.

    Fails loud (SystemExit) when TODOS.md is absent or the line is missing.
    The audit decision must be explicit — a silent "false" default would
    let a misconfigured deploy environment run parity tests against the
    2-bucket path even when the strategy has maker/taker data.
    """
    if not TODOS_PATH.exists():
        raise SystemExit(
            f"phase12_deploy: TODOS.md not found at {TODOS_PATH}. "
            f"The TRADE_MIX_HAS_MAKER_TAKER audit decision is required; "
            f"either provide TODOS.md or pass the flag via env "
            f"(TRADE_MIX_HAS_MAKER_TAKER=true|false)."
        )
    text = TODOS_PATH.read_text()
    m = re.search(r"TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)", text)
    if not m:
        raise SystemExit(
            f"phase12_deploy: TRADE_MIX_HAS_MAKER_TAKER line missing from "
            f"{TODOS_PATH}. The audit decision must be explicit — refusing "
            f"to default a flag that governs Trade Mix bucketing in CI."
        )
    # The regex alternation constrains the capture to exactly "true"/"false",
    # but the type checker only sees `str` from `m.group(1)`. The cast pins
    # the runtime-guaranteed Literal without changing the value (M-0636).
    return cast(TradeMixFlag, m.group(1))


def _write_env_test(flag: TradeMixFlag) -> None:
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

# M-0639: a DATABASE_URL is documented as a postgres DSN. The NewType is
# documentation-only (it is still a `str` at runtime); the validator below
# returns it so a caller that threads the value onward carries the "this
# string was shape-checked" intent in the type.
PostgresUrl = NewType("PostgresUrl", str)


def _validate_postgres_url(db_url: str) -> PostgresUrl:
    """M-0639: reject a DATABASE_URL whose scheme is not postgres(ql) or
    that lacks a host, before it is handed to `psql`.

    Mirrors `phase12_kill_switch._parse_postgres_url`'s scheme/host checks.
    The prior code passed `os.getenv("DATABASE_URL")` verbatim to
    `subprocess.run(["psql", "--dbname", db_url, ...])` after only a falsy
    guard — a value like a bare Supabase project ref ("abcd1234") or an
    `http://` paste would reach psql and fail with an opaque libpq error
    instead of a clear "malformed DSN" diagnostic here.

    Returns the (unchanged) URL so callers can use it inline. Raises
    ValueError on a non-postgres scheme or a missing host.
    """
    parsed = urlparse((db_url or "").strip())
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError(
            f"phase12_deploy: DATABASE_URL has unrecognized scheme "
            f"{parsed.scheme!r}; expected 'postgresql' or 'postgres'."
        )
    if not parsed.hostname:
        raise ValueError(
            "phase12_deploy: DATABASE_URL has no host component."
        )
    return PostgresUrl(db_url)


def _parse_probe_value(raw: str) -> float:
    """Reject NaN/inf/negative probe values — they would poison the
    threshold compare. Empty/missing is rejected too (NULL row must not
    silently become 0.0). Normalizes float("-0") → 0.0.
    """
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
    return 0.0 if val == 0 else val


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
    # M-0639: validate the DSN shape before handing it to psql. A non-postgres
    # scheme or a host-less value (bare project ref, http:// paste) would
    # otherwise reach psql and surface as an opaque libpq error.
    db_url = _validate_postgres_url(db_url)
    # SECURITY F4 (red-team HIGH9): the DSN MUST NOT travel in psql's argv —
    # process argv is world-readable via `ps auxe`, /proc/<pid>/cmdline, and
    # CI/Railway argv-capturing logs, so a password-bearing DATABASE_URL passed
    # as `--dbname db_url` leaks verbatim. Mirror the sibling kill-switch's
    # proven pattern (phase12_kill_switch.measure_p999_via_sql): parse the DSN
    # into PG* libpq env vars, strip ALL stale PG*/PGPASSFILE/PGSERVICEFILE keys
    # from the inherited env (so an inherited PGPASSWORD/PGUSER/PGSERVICE cannot
    # silently redirect the connection), overlay the DSN-derived PG* vars, and
    # pass them via subprocess.run(env=...). The connection params travel via
    # env; argv carries only the SQL flags. Reuse the kill-switch helper rather
    # than duplicating the parser.
    try:
        pg_env = phase12_kill_switch._parse_postgres_url(db_url)
    except ValueError as exc:
        # Don't propagate the raw URL — it may embed the password. The redactor
        # is defense in depth on the exception text.
        raise RuntimeError(
            f"phase12_deploy: DATABASE_URL is malformed: "
            f"{phase12_kill_switch._redact_dsn(str(exc))}"
        ) from None
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    subprocess_env = {
        **clean_env,
        "PGPASSFILE": "",
        "PGSERVICEFILE": "",
        **pg_env,
    }
    sql = SQL_PROBE_PATH.read_text()
    # Bounded timeout (see phase12_kill_switch._resolve_probe_timeout_s)
    # so a hung connection cannot park the deploy with no diagnostic.
    # Lazy resolution at probe time, so a malformed env var raises here
    # rather than at module import.
    timeout_s = phase12_kill_switch._resolve_probe_timeout_s()
    try:
        result = subprocess.run(
            ["psql", "-tAF,", "-c", sql],
            capture_output=True, text=True, check=False,
            timeout=timeout_s,
            env=subprocess_env,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"phase12_deploy: SQL probe timed out after {timeout_s}s "
            f"(DATABASE_URL host unreachable, pgbouncer hung, or "
            f"strategy_analytics held under FOR UPDATE)"
        ) from exc
    if result.returncode != 0:
        # SECURITY (2026-05-27): psql echoes the connection URI in stderr on
        # auth / SSL / parse failures — and this probe passes the DSN via
        # `--dbname db_url`, so a DATABASE_URL with an embedded password would
        # otherwise leak verbatim into the deploy log via this RuntimeError.
        # Run stderr through the sibling kill-switch's `_redact_dsn` (single
        # source of truth for the postgresql:// + key=value password scrubbers)
        # before raising — same hardening as phase12_kill_switch's H-0623 path.
        raise RuntimeError(
            f"phase12_deploy: SQL probe failed: "
            f"{phase12_kill_switch._redact_dsn(result.stderr.strip())}"
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

    for required in ("relation_visible", "row_security_active", "p999", "count", "total_rows"):
        if required not in parsed:
            raise RuntimeError(
                f"phase12_deploy: SQL probe missing required key "
                f"{required!r}; got keys {sorted(parsed.keys())!r}"
            )

    relation_visible = parsed["relation_visible"].strip().lower() in ("t", "true")
    row_security_active = parsed["row_security_active"].strip().lower() in ("t", "true")
    n = int(_parse_probe_value(parsed["count"]))
    total_rows = int(_parse_probe_value(parsed["total_rows"]))

    if not relation_visible:
        raise RuntimeError(
            "phase12_deploy: strategy_analytics is not visible to the "
            "connecting role (table missing or SELECT denied). Check the "
            "DATABASE_URL role/GRANTs before re-running."
        )
    if n == 0 and total_rows == 0 and row_security_active:
        raise RuntimeError(
            "phase12_deploy: strategy_analytics has RLS enabled AND the "
            "connecting role lacks BYPASSRLS — every row appears filtered. "
            "Re-run via service_role or grant BYPASSRLS before triggering "
            "the kill-switch."
        )

    # Distinguish "table populated but no metrics yet" from "empty
    # table / wrong DB" using the unfiltered total_rows key.
    if n == 0:
        if total_rows > 0:
            raise RuntimeError(
                f"phase12_deploy: strategy_analytics has {total_rows} rows "
                f"but all metrics_json values are NULL — analytics_runner "
                f"has not produced output yet. Re-run after the runner "
                f"catches up."
            )
        raise RuntimeError(
            "phase12_deploy: strategy_analytics is empty (0 rows) — "
            "refusing to make a kill-switch decision. Check DATABASE_URL "
            "points to the correct DB."
        )
    p999 = _parse_probe_value(parsed["p999"])
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

    print("=== Phase 12 deploy: complete ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
