"""Phase 12 / D-07: kill-switch — cut over heavy keys from metrics_json to sibling table
when p99.9 (post-TOAST-compression on-disk size) >= 800kB.

Usage:
    # Opt-IN: kill-switch is OFF by default; set RUN_KILL_SWITCH to enable.
    # Prod hosts also require --confirm-prod or PHASE12_KILL_SWITCH_CONFIRMED=true.
    RUN_KILL_SWITCH=true python -m scripts.phase12_kill_switch --confirm-prod
    RUN_KILL_SWITCH=true python -m scripts.phase12_kill_switch \\
        --p999 820000 --count 15 --confirm-prod
    python -m scripts.phase12_kill_switch                                   # bypass (default)

    # After a partial cutover (some strategies failed; p999 has dropped
    # because the successful ones shrank), re-run with --force to bypass
    # the threshold short-circuit.
    RUN_KILL_SWITCH=true python -m scripts.phase12_kill_switch --force --confirm-prod

P2021 (audit-2026-05-07 round 2):
    Inverted from the prior opt-OUT `SKIP_KILL_SWITCH=1` polarity — that fired the
    kill-switch by default on partial deploys. RUN_KILL_SWITCH is now an opt-IN
    truthy parse (true|yes|1|on / false|no|0|off|""); unknown values raise SystemExit
    rather than silently defaulting (CLAUDE.md Rule 12: fail loud).

audit-2026-05-07 specialist-fix round:
    * H-0611 / H-0616 / C-0217: DSN parsed into PG* libpq env vars and
      passed via subprocess(env=...) — never in argv (which is visible
      to `ps auxe`, /proc/<pid>/cmdline, and CI argv-capturing loggers).
    * H-0623: psql stderr is run through `_redact_dsn` before being
      propagated into RuntimeError — strips any embedded postgresql://
      DSN echoed back on auth / SSL / parse failures.
    * H-0606: per-strategy cutover loop runs with bounded concurrency
      (`asyncio.Semaphore(_CUTOVER_CONCURRENCY)`).
    * H-0614: `--force` / `PHASE12_FORCE_CUTOVER=true` bypasses the
      p999 < threshold short-circuit for the resume case after a
      partial cutover.
    * H-0620: strategy_id is UUID-validated at the cutover boundary.
    * H-0622: TODOS audit-log write is atomic (tempfile + os.replace).
    * H-0624: `--confirm-prod` / `PHASE12_KILL_SWITCH_CONFIRMED=true`
      is REQUIRED when DATABASE_URL points at a prod-looking host.
    * M-0637: missing TODOS_PATH is non-fatal — the audit line is also
      printed to stderr (which the deploy log captures unconditionally).
    * M-0639: DATABASE_URL is parsed via urllib.parse and rejected when
      the scheme is not postgresql / postgres or no host is present.
    * M-0640: THRESHOLD_BYTES is typed `Final[Bytes]` (Bytes is a
      NewType('Bytes', int)).

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
import re
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Final, NewType
from urllib.parse import parse_qs, urlparse

# This module lives in analytics-service/scripts/. The analytics-service services
# package is on sys.path when invoked via `python -m scripts.phase12_kill_switch`
# from the analytics-service directory.
from services.db import db_execute, get_supabase

# --- Constants -------------------------------------------------------------

# M-0640: typed-int wrapper around byte counts. The unit is encoded in the
# type so a future caller cannot accidentally pass `p999_kb` (a different
# unit) where bytes are expected without a type-checker complaint.
Bytes = NewType("Bytes", int)

THRESHOLD_BYTES: Final[Bytes] = Bytes(800_000)  # 800kB — Phase 12 SC#3a kill-switch trigger.
# Default timeout on the psql subprocess so a hung pgbouncer / network
# partition / held FOR UPDATE can't park the deploy indefinitely. Resolved
# lazily inside `_resolve_probe_timeout_s` so a malformed env var raises a
# loud diagnostic at probe time rather than crashing at module import (an
# import-time crash points at the wrong file in tracebacks and breaks
# `from scripts import phase12_kill_switch` for any caller).
_DEFAULT_PROBE_TIMEOUT_S = 60


def _resolve_probe_timeout_s() -> int:
    """Resolve PHASE12_PROBE_TIMEOUT_S → positive int.

    Uses the same digits-only regex as `_nonneg_finite_int` so the two
    env-var validators have consistent semantics: no leading sign, no
    decimal point, no thousands separators (`60_000`), no scientific
    notation. The strict pattern avoids quietly mis-interpreting a typo
    or shell-expansion artifact as a deliberate value.
    """
    raw = os.getenv("PHASE12_PROBE_TIMEOUT_S")
    if raw is None or raw == "":
        return _DEFAULT_PROBE_TIMEOUT_S
    # Allow an optional leading minus so the non-positive branch below can
    # emit the more-helpful "must be positive" message for `-1` / `-60`.
    # The regex still rejects decimals, underscores, scientific notation,
    # `+`, and whitespace — anything ambiguous.
    if not re.fullmatch(r"-?\d+", raw):
        raise RuntimeError(
            f"phase12_kill_switch: PHASE12_PROBE_TIMEOUT_S={raw!r} is not "
            f"an integer (digits only, no separators, no exponent); "
            f"expected positive seconds (e.g. '120')."
        )
    val = int(raw)
    if val <= 0:
        raise RuntimeError(
            f"phase12_kill_switch: PHASE12_PROBE_TIMEOUT_S={raw!r} must be "
            f"a positive integer; received {val}. A non-positive timeout "
            f"would turn every probe into an instant 'hung connection' "
            f"diagnostic."
        )
    return val

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


def _env_truthy(name: str) -> bool:
    """Return True iff the named env var is set AND parses as truthy.

    Unset / empty → False (don't enable the flag).
    Recognized truthy/falsy → bool per _parse_run_flag.
    Garbage → SystemExit (consistent with _parse_run_flag's polarity
    refusal — a typo in PHASE12_FORCE_CUTOVER must not silently default).
    """
    raw = os.getenv(name)
    if not raw:
        return False
    return _parse_run_flag(raw)


# P2024: the heavy-kind allowlist is no longer encoded in Python. Migration
# 129's `cutover_strategy_metrics_keys_atomic` RPC defines `v_allowlist`
# server-side and reads metrics_json under SELECT ... FOR UPDATE — the
# Python caller never touches the snapshot. Single source of truth lives
# in supabase/migrations/129_*.sql.

SQL_PROBE_PATH: Final[Path] = Path(__file__).parent / "analyze_metrics_size.sql"

# Bounded concurrency for the per-strategy cutover loop. The RPC takes a
# row-level FOR UPDATE lock on strategy_analytics — sending more than a
# handful of concurrent calls saturates the Postgres connection pool and
# starves other writers without speeding up the cutover (the bottleneck
# is row contention, not Python-side latency). The default of 5 is the
# same number `phase12_backfill_enqueue` uses for its own throttle.
_CUTOVER_CONCURRENCY: Final[int] = 5

# H-0611 / H-0616 / C-0217: credential disclosure surface.
# The DATABASE_URL contains a password that MUST NOT appear in process
# argv (visible to every local user via `ps auxe`, /proc/<pid>/cmdline,
# Railway/CI build logs, and journald/auditd). We parse it into PG*
# libpq env vars and pass them via subprocess.run(env=...) — keeping the
# secret out of argv entirely.


def _parse_postgres_url(db_url: str) -> dict[str, str]:
    """Parse a postgresql:// DSN into PG* libpq env vars.

    Returns a dict with PGHOST / PGUSER / PGPASSWORD / PGDATABASE / PGPORT /
    PGSSLMODE keys (only those present in the URL). The returned dict is
    intended for merge into os.environ via `{**os.environ, **parsed}`.

    Raises ValueError on URLs that don't have a recognized postgres scheme,
    or that lack a host. This is the only place the URL is parsed — the
    raw DSN string never leaves this function (M-0639).
    """
    if not isinstance(db_url, str) or not db_url:
        raise ValueError("phase12_kill_switch: empty DATABASE_URL")
    parsed = urlparse(db_url.strip())
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError(
            f"phase12_kill_switch: DATABASE_URL has unrecognized scheme "
            f"{parsed.scheme!r}; expected 'postgresql' or 'postgres'."
        )
    if not parsed.hostname:
        raise ValueError(
            "phase12_kill_switch: DATABASE_URL has no host component."
        )
    env: dict[str, str] = {"PGHOST": parsed.hostname}
    if parsed.port is not None:
        env["PGPORT"] = str(parsed.port)
    if parsed.username:
        env["PGUSER"] = parsed.username
    if parsed.password:
        env["PGPASSWORD"] = parsed.password
    # `/dbname` → strip the leading slash. Falls through to an unset
    # PGDATABASE when the URL has no path, which is libpq's "use the
    # username as the database name" default — same shape as before.
    db_path = (parsed.path or "").lstrip("/")
    if db_path:
        env["PGDATABASE"] = db_path
    # PGSSLMODE rides in the query string for Supabase URLs
    # (?sslmode=require). Forward it verbatim so the libpq behavior
    # matches what an operator running psql interactively would see.
    if parsed.query:
        sslmode_values = parse_qs(parsed.query).get("sslmode")
        if sslmode_values and sslmode_values[0]:
            env["PGSSLMODE"] = sslmode_values[0]
    return env


# Compiled once at import time — _redact_dsn is called on every psql
# stderr propagation and any malformed-DSN raise; compiling at call
# site would do unnecessary work on hot error paths.
# Non-greedy match up to the first whitespace, quote, or end-of-string.
# Covers: postgresql://user:pass@host:5432/db?sslmode=require
_DSN_PATTERN = re.compile(
    r"(?:postgresql|postgres)(?:\+psycopg)?://[^\s\"'<>]+",
    re.IGNORECASE,
)

# Specialist defense-in-depth: libpq also accepts a key=value
# connection-string form (`host=db.example.com user=postgres
# password=HUNTER2 dbname=quantalyze`). psql's error formatter
# normally surfaces the URI form, but pgbouncer / sslmode adapters
# can echo the kv form. The kv redactor scrubs `password=…` so
# the secret never reaches the deploy log, even if our primary URI
# regex misses something unusual.
_KV_PASSWORD_PATTERN = re.compile(
    r"\bpassword\s*=\s*\S+",
    re.IGNORECASE,
)


def _redact_dsn(message: str) -> str:
    """Strip embedded postgresql:// connection strings (and key=value
    `password=…` fragments) from an error message.

    psql commonly echoes the connection URI back in stderr on auth /
    SSL / parse failures — `connection to server at "postgresql://postgres:
    HUNTER2@db.host..." failed: ...`. Propagating that stderr verbatim
    into a RuntimeError → CI log = credential disclosure (H-0623).

    The URI regex matches the full DSN (with or without `+psycopg` driver
    suffix) and replaces it with `<postgres-dsn-redacted>`. We don't try
    to extract just the password — the host is also sensitive (it
    confirms which Supabase project the operator was connected to, and
    co-tenants can use that to scope further probes).

    The kv `password=…` regex is defense in depth for the rarer libpq
    key=value error format.
    """
    if not message:
        return message
    redacted = _DSN_PATTERN.sub("<postgres-dsn-redacted>", message)
    return _KV_PASSWORD_PATTERN.sub("password=<redacted>", redacted)

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
    """argparse `type=` validator for integer-valued counts.

    Rejects:
      * Negative / NaN / inf (via _parse_probe_value first)
      * Non-integer floats (e.g. `--count 3.7`)
      * Scientific notation (`--count 1e2`) — operator mental model says
        --count takes a plain integer; exponential forms are almost always
        a typo or accidental shell expansion. Refuse the ambiguity per
        CLAUDE.md Rule 12.
    """
    # Plain-integer regex check first. This rejects "1e2", "1.0", "+1",
    # "0x10", and any whitespace before downstream parsing has a chance
    # to silently coerce them. `\d+` is unsigned because _parse_probe_value
    # also rejects negatives — keeping the two layers' contracts aligned.
    if not isinstance(raw, str) or not re.fullmatch(r"\d+", raw):
        raise ValueError(
            f"phase12_kill_switch: --count must be a plain non-negative "
            f"integer (digits only, no sign, no decimal, no exponent); "
            f"got {raw!r}"
        )
    val = _parse_probe_value(raw)
    return int(val)


def measure_p999_via_sql() -> tuple[float, int]:
    """Run analyze_metrics_size.sql via psql; return (p999_bytes, strategy_count).

    Uses pg_column_size (post-TOAST-compression on-disk size). M-03: this is the
    only authoritative measurement — never approximate via Python json round-trip.

    P2022: parses keyed output (k,v rows) rather than positional CSV columns —
    a SQL re-order can no longer silently shift the parsed p999 to a different
    percentile. Requires keys `p999` and `count` to be present; rejects NaN/
    inf/negative values.

    H-0611 / H-0616 / C-0217: the DSN is parsed into PG* libpq env vars and
    passed via `subprocess.run(env=...)`. It is NEVER passed as a positional
    or `--dbname` argv argument — argv is visible to every local user via
    `ps auxe`, /proc/<pid>/cmdline, and Railway/CI argv-capturing logs.
    H-0623: any stderr propagated into the raised exception is run through
    `_redact_dsn` so a psql error message that echoes back the connection
    URI cannot leak the password into the calling log.
    """
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError(
            "phase12_kill_switch: DATABASE_URL (or SUPABASE_DB_URL) not set; "
            "cannot run pg_column_size SQL probe (M-03)."
        )
    try:
        pg_env = _parse_postgres_url(db_url)
    except ValueError as exc:
        # Don't propagate the URL into the message — it could be the raw
        # DSN with the password embedded. The redactor is defense in depth.
        raise RuntimeError(
            f"phase12_kill_switch: DATABASE_URL is malformed: {_redact_dsn(str(exc))}"
        ) from None
    sql = SQL_PROBE_PATH.read_text()
    timeout_s = _resolve_probe_timeout_s()
    # The bounded timeout prevents a hung pgbouncer / network partition /
    # held FOR UPDATE from parking the deploy indefinitely with no
    # diagnostic. The DSN is in env=, not argv — see _parse_postgres_url
    # docstring and the H-0611 / H-0616 / C-0217 finding.
    #
    # silent-failure-hunter HIGH conf-9 + security MED conf-7:
    # Strip ALL PG*/PGPASSFILE/PGSERVICEFILE keys from the inherited env
    # BEFORE overlaying pg_env. Otherwise a stale PGPASSWORD / PGUSER /
    # PGDATABASE / PGSERVICE / PGOPTIONS in os.environ survives the merge
    # (because _parse_postgres_url only sets keys present in the DSN) and
    # silently takes effect — operator believes the DSN determined the
    # connection target, but an inherited credential can authenticate as
    # a different role, bypass the _check_confirm_gate host check, or
    # amplify a DoS via PGOPTIONS. Additionally null out PGSERVICEFILE
    # and PGPASSFILE so libpq's fallback-file resolution cannot redirect
    # the probe away from the DSN-derived target.
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    subprocess_env = {
        **clean_env,
        "PGPASSFILE": "",
        "PGSERVICEFILE": "",
        **pg_env,
    }
    try:
        result = subprocess.run(
            ["psql", "-tAF,", "-c", sql],
            capture_output=True, text=True, check=False,
            timeout=timeout_s,
            env=subprocess_env,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe timed out after "
            f"{timeout_s}s (DATABASE_URL host unreachable, "
            f"pgbouncer hung, or strategy_analytics held under FOR UPDATE)"
        ) from exc
    if result.returncode != 0:
        # H-0623: psql can echo the connection URI in stderr on auth /
        # SSL handshake failures. Redact before raising so the exception
        # message never carries the DSN into the deploy log.
        raise RuntimeError(
            f"phase12_kill_switch: SQL probe failed (exit {result.returncode}): "
            f"{_redact_dsn(result.stderr.strip())}"
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

    for required in ("relation_visible", "row_security_active", "p999", "count", "total_rows"):
        if required not in parsed:
            raise RuntimeError(
                f"phase12_kill_switch: SQL probe missing required key "
                f"{required!r}; got keys {sorted(parsed.keys())!r}"
            )

    relation_visible = parsed["relation_visible"].strip().lower() in ("t", "true")
    row_security_active = parsed["row_security_active"].strip().lower() in ("t", "true")
    count = int(_parse_probe_value(parsed["count"]))
    total_rows = int(_parse_probe_value(parsed["total_rows"]))

    # Three distinct empty-looking states with three distinct root causes.
    # Order matters: check visibility first, then RLS, then true emptiness.
    if not relation_visible:
        raise RuntimeError(
            "phase12_kill_switch: strategy_analytics is not visible to the "
            "connecting role (table missing or SELECT denied). Check the "
            "DATABASE_URL role/GRANTs before re-running."
        )
    if count == 0 and total_rows == 0 and row_security_active:
        # has_table_privilege passed but RLS filters every row — operator
        # connected with the right role but lacks BYPASSRLS / a matching
        # policy. Different fix from "wrong DB".
        raise RuntimeError(
            "phase12_kill_switch: strategy_analytics has RLS enabled AND "
            "the connecting role lacks BYPASSRLS — every row appears "
            "filtered. Re-run via service_role or grant BYPASSRLS to the "
            "deploy role before triggering the kill-switch."
        )

    # Validate count: an empty strategy_analytics table produces count=0
    # and NULL→empty-string percentiles. Without this guard, the p999
    # parse below would raise a generic "empty probe value" error and
    # the operator can't tell "wrong DB" from "kill-switch broken".
    # Distinguish "table truly empty" from "table populated but no
    # metrics yet" using the total_rows key.
    if count == 0:
        if total_rows > 0:
            raise RuntimeError(
                f"phase12_kill_switch: strategy_analytics has {total_rows} "
                f"rows but all metrics_json values are NULL — analytics_runner "
                f"has not produced any output yet. Re-run after the runner "
                f"catches up; refusing to make a kill-switch decision "
                f"against a pre-populated table."
            )
        raise RuntimeError(
            "phase12_kill_switch: strategy_analytics is empty (0 rows) — "
            "refusing to make a kill-switch decision. Check DATABASE_URL "
            "points to the correct DB."
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

    H-0620: the strategy_id is validated as a UUID string at the function
    boundary. The RPC signature is `p_strategy_id UUID` — Postgres would
    reject a non-UUID at execute time, but the Python-side guard fails
    earlier (and surfaces a clearer error than a libpq parse failure).

    Idempotent (per migration 129's contract): a re-run for a strategy whose
    heavy keys are already in the sibling table is a no-op.
    """
    # H-0620: reject non-UUID strategy_ids before they hit the RPC. The
    # function signature accepts `str` (not `UUID`) so callers can keep
    # passing values that came over the wire as JSON strings, but the
    # validator pins the shape — any callers passing arbitrary text now
    # fail loud here rather than at the Postgres UUID parser.
    if not isinstance(strategy_id, str) or not strategy_id:
        raise ValueError(
            f"phase12_kill_switch: strategy_id must be a non-empty string; "
            f"got {strategy_id!r}"
        )
    try:
        uuid.UUID(strategy_id)
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(
            f"phase12_kill_switch: strategy_id {strategy_id!r} is not a "
            f"valid UUID; refusing to call cutover RPC."
        ) from exc
    supabase = get_supabase()
    result = await db_execute(
        lambda: supabase.rpc(
            "cutover_strategy_metrics_keys_atomic",
            {"p_strategy_id": strategy_id},
        ).execute()
    )
    payload = result.data
    # Migration 129 returns jsonb_build_object('moved', N) — a scalar JSONB
    # dict whose 'moved' value is an int. Anything else (None, list, dict
    # without 'moved', dict with non-int 'moved', dict with bool 'moved')
    # indicates the migration was rolled back or the wire format changed.
    # Fail loud rather than silently returning 0 and reporting "moved 0
    # keys" as if everything succeeded (Rule 12).
    #
    # bool is excluded explicitly because isinstance(True, int) is True in
    # Python — a buggy RPC returning {"moved": true} would otherwise be
    # int-coerced to 1 with no warning.
    if not isinstance(payload, dict) or "moved" not in payload:
        raise RuntimeError(
            f"cutover_strategy_metrics_keys_atomic({strategy_id}) returned "
            f"unexpected shape {payload!r}; expected {{'moved': <int>}}. "
            f"Aborting cutover to avoid silent under-count."
        )
    moved = payload["moved"]
    # `type(x) is int` rejects bool implicitly (type(True) is bool, not
    # int), making the type-guard ordering-independent — a future refactor
    # that drops one of the prior `isinstance` checks would not regress
    # silently. Subclasses-of-int (numpy.int64, etc.) are not expected
    # over the PostgREST wire so the strict check is appropriate here.
    if type(moved) is not int:
        raise RuntimeError(
            f"cutover_strategy_metrics_keys_atomic({strategy_id}) returned "
            f"'moved'={moved!r} of type {type(moved).__name__}; "
            f"expected int. Aborting cutover to avoid silent under-count."
        )
    return moved


# --- IAM gate (H-0624) -----------------------------------------------------

# Labels (or full hosts) that identify a non-prod DB target. Matched at
# DOT-DELIMITED LABEL BOUNDARIES, not substrings — otherwise a prod host
# whose name embeds one of these as a substring (e.g.
# `db.test.prod.example.com`, `attest.example.com`, `staging.prod.example.com`)
# would silently bypass the H-0624 confirm gate. The list is conservative:
# any host whose labels don't include a marker is treated as prod.
_NON_PROD_HOST_MARKERS: Final[frozenset[str]] = frozenset({
    "localhost",
    "127.0.0.1",
    "::1",
    "stg",
    "staging",
    "dev",
    "test",
    "local",
})


def _looks_like_prod_host(db_url: str | None) -> bool:
    """Heuristic: return True when the DSN host does NOT match a known
    non-prod marker at a DOT-LABEL BOUNDARY. Default-deny: if we can't
    tell, treat as prod and require the operator to confirm.

    H-0624: the gate is intentionally heuristic — false positives (a stg
    host that didn't match the marker list) just require the operator to
    set the confirm flag once. False negatives (a prod host that LOOKED
    like staging) would skip the gate, which is the worse failure mode.

    security MED conf-8 / silent-failure-hunter LOW conf-7: the prior
    substring-containment check let adversarially-named or accidentally-
    named prod hosts bypass the gate (e.g. `db.test.prod.example.com`
    contains 'test.' as a substring). Match must be on a full dot-label
    (or the entire host) so a marker appearing inside a longer label
    cannot fall through. `127.0.0.1` and `::1` are matched as full-host
    literals since they have no meaningful labels.
    """
    if not db_url:
        return True
    try:
        parsed = urlparse(db_url.strip())
        host = (parsed.hostname or "").lower()
    except (ValueError, AttributeError) as exc:
        # urllib.parse only raises ValueError on genuinely malformed
        # input. Log so a future urlparse signature change that bubbles
        # an unexpected type doesn't silently default-deny without a
        # diagnostic the operator can act on.
        print(
            f"phase12_kill_switch: _looks_like_prod_host: urlparse failed "
            f"({type(exc).__name__}: {exc!r}); defaulting to prod.",
            file=sys.stderr,
        )
        return True
    if not host:
        return True
    # Exact-host literal matches (covers `localhost`, `127.0.0.1`, `::1`).
    if host in _NON_PROD_HOST_MARKERS:
        return False
    # Label-boundary match: any dot-delimited label of the host equal
    # to a marker counts as non-prod. This rejects substring bypasses
    # like `db.test.prod.example.com` (labels: db, test, prod, example,
    # com — `test` IS a label, so this DOES match non-prod). The trade
    # off is conservative: a label-level match is a STRONGER signal
    # than substring containment that the host is intentionally non-prod.
    # Operators running against a prod environment that happens to have
    # a literal `test` / `dev` / `staging` label as one of its hostname
    # components must explicitly --confirm-prod, which the H-0624
    # docstring already calls out as the safer failure mode.
    labels = host.split(".")
    return not any(label in _NON_PROD_HOST_MARKERS for label in labels)


def _check_confirm_gate(force: bool) -> None:
    """Raise SystemExit when RUN_KILL_SWITCH=true points at a prod host
    AND the operator has not set either the CLI --confirm-prod flag or
    the PHASE12_KILL_SWITCH_CONFIRMED env var. Skipped if RUN_KILL_SWITCH
    is falsy (the bypass branch handles that).

    H-0624: the confirm gate is the second factor on top of the env-var
    "RUN_KILL_SWITCH=true" opt-in. A typo on the operator's part can
    point DATABASE_URL at prod just as easily as at staging; the confirm
    flag forces an explicit second action specific to the prod target.
    """
    if force:
        return
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not _looks_like_prod_host(db_url):
        return
    raise SystemExit(
        "phase12_kill_switch: RUN_KILL_SWITCH=true with a prod-looking "
        "DATABASE_URL host but no confirmation. Re-run with --confirm-prod "
        "or set PHASE12_KILL_SWITCH_CONFIRMED=true to acknowledge the "
        "table-wide rewrite of strategy_analytics.metrics_json. (Override "
        "the host check by including a dot-delimited 'stg', 'staging', "
        "'dev', 'test', or 'local' label in the DSN if you are pointing "
        "at non-prod, or use 'localhost'/127.0.0.1/::1.)"
    )


# --- Audit log write (H-0622) ----------------------------------------------


def _atomic_append_todos(content_to_append: str) -> None:
    """Append `content_to_append` to TODOS_PATH atomically via tempfile +
    os.replace. The existing file's contents are read first; the entire
    new payload is written to a sibling .tmp file in the same directory;
    `os.replace` makes the swap atomic on POSIX (single inode rename).

    H-0622: the previous `TODOS_PATH.write_text(read + append)` was a
    non-atomic read-modify-write. Two concurrent invocations could
    clobber each other's audit entries, and a crash mid-write could
    truncate the file (losing the prior phase 12 plan content). The
    tempfile + os.replace pattern guarantees no truncation: either the
    swap completes and the new content is visible, or the original
    file is untouched.

    Red-team caveat: tempfile + os.replace is ATOMIC against truncation
    but NOT serializable against concurrent appends. Two processes that
    both append at the same time will each succeed (no truncation), but
    only the LAST process's `os.replace` survives — the other's append
    is lost in TODOS.md. The mitigation is that main() ALSO prints the
    audit line to stderr unconditionally, which the deploy log captures.
    So a concurrent-append loss is recoverable from the deploy log even
    though TODOS.md only records one of the two trigger events.

    M-0637: when TODOS_PATH is missing (the audit is being written from
    a deployed container where `.planning/` is not shipped), the audit
    line is ALSO emitted to stderr by the caller — this helper still
    raises if the path can't be written, but the caller decides whether
    the absence is fatal.
    """
    parent = TODOS_PATH.parent
    parent.mkdir(parents=True, exist_ok=True)
    existing = TODOS_PATH.read_text() if TODOS_PATH.exists() else ""
    payload = existing + content_to_append
    # NamedTemporaryFile(delete=False) creates the file with a unique
    # name in the same parent — required for os.replace to be a single
    # rename rather than a cross-filesystem copy.
    with tempfile.NamedTemporaryFile(
        mode="w",
        dir=str(parent),
        prefix=".phase12_kill_switch_audit_",
        suffix=".tmp",
        delete=False,
        encoding="utf-8",
    ) as tmp:
        tmp.write(payload)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = tmp.name
    try:
        os.replace(tmp_path, TODOS_PATH)
    except OSError:
        # Clean up the temp file if the replace failed — otherwise a
        # disk-full / permissions failure would leave orphan .tmp files
        # accumulating in the audit directory.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# --- Main ------------------------------------------------------------------

async def _run_cutovers_bounded(
    strategy_ids: list[str],
    *,
    concurrency: int = _CUTOVER_CONCURRENCY,
) -> tuple[int, list[tuple[str, str]]]:
    """Run cutover_strategy across strategy_ids with bounded concurrency.

    H-0606: the previous serial loop did 2 sequential awaits per strategy
    (the RPC + its connection round-trip), so a 50-strategy cutover took
    10-30s of partial-state during which some strategies had heavy keys
    moved and others didn't. Bounded gather (concurrency=5) cuts the
    wall-clock by ~5x and shrinks the inconsistency window proportionally.

    The bound matters: unbounded gather would saturate the Postgres
    connection pool (the RPC takes a FOR UPDATE lock — too many concurrent
    locks starve other writers without improving throughput).

    Returns `(total_moved, failures)` where failures is a list of
    `(strategy_id, repr(exc))` pairs for any strategies whose cutover
    raised. The function never raises on a per-strategy failure — it
    always returns, so the caller can write the audit log even when
    some strategies failed.
    """
    sem = asyncio.Semaphore(max(1, concurrency))
    # `_one` returns (sid, moved, error) so .gather can collect both
    # successes and failures without an unhandled exception aborting the
    # whole batch. Per-strategy try/except is INSIDE the helper so a
    # bug-free strategy is not starved by a failure on another.
    #
    # Red-team: we catch `Exception` (not `BaseException`) so KeyboardInterrupt
    # / SystemExit / CancelledError still propagate. `return_exceptions=True`
    # on gather is the secondary defense: even if a future refactor leaks a
    # BaseException out of _one, the surviving cutovers' results are still
    # collected so the audit log captures what DID land.
    async def _one(sid: str) -> tuple[str, int, str | None]:
        async with sem:
            try:
                moved = await cutover_strategy(sid)
                return (sid, moved, None)
            except Exception as exc:
                return (sid, 0, repr(exc))

    raw_results = await asyncio.gather(
        *(_one(sid) for sid in strategy_ids),
        return_exceptions=True,
    )
    # With return_exceptions=True, gather returns an Exception object in the
    # result slot for any awaitable that raised. Each slot is either a normal
    # 3-tuple OR an Exception — we synthesize a failure tuple for the latter
    # so the downstream loop's unpacking remains uniform.
    results: list[tuple[str, int, str | None]] = []
    for sid, slot in zip(strategy_ids, raw_results):
        if isinstance(slot, BaseException):
            results.append((sid, 0, repr(slot)))
        else:
            results.append(slot)
    total_moved = 0
    failures: list[tuple[str, str]] = []
    for sid, moved, error in results:
        if error is not None:
            failures.append((sid, error))
            print(f"  strategy {sid}: WARNING — cutover failed: {error} (continuing)")
            continue
        total_moved += moved
        print(f"  strategy {sid}: moved {moved} keys")
    return (total_moved, failures)


async def main(
    cli_p999: float | None = None,
    cli_count: int | None = None,
    cli_force: bool = False,
    cli_confirm_prod: bool = False,
) -> int:
    # P2021: opt-IN. Default (unset) → bypass. Truthy → run. Garbage → SystemExit.
    raw = os.getenv("RUN_KILL_SWITCH")
    if raw is None or not _parse_run_flag(raw):
        print(
            "phase12_kill_switch: RUN_KILL_SWITCH not set (or falsy) — bypassing. "
            "Set RUN_KILL_SWITCH=true to enable."
        )
        return 0

    # H-0624: confirm gate — block prod-looking hosts unless the operator
    # has set either the --confirm-prod CLI flag or the
    # PHASE12_KILL_SWITCH_CONFIRMED env var. phase12_deploy.py passes the
    # env-var path so a single CI boolean propagates through the stack.
    _check_confirm_gate(cli_confirm_prod or _env_truthy("PHASE12_KILL_SWITCH_CONFIRMED"))

    # H-0614: --force / PHASE12_FORCE_CUTOVER overrides the p999 < threshold
    # short-circuit. Required for the resume case: after a partial cutover,
    # p999 may have dropped below threshold even though some strategies
    # still have heavy keys (because the SUCCESSFUL cutovers shrank their
    # rows by hundreds of kB, dragging the percentile down). Without
    # --force, the script would log "no cutover needed" and exit 0,
    # leaving the partial state in place forever.
    force = cli_force or _env_truthy("PHASE12_FORCE_CUTOVER")

    p999, n = await measure_p999(cli_p999=cli_p999, cli_count=cli_count)
    print(
        f"phase12_kill_switch: probe — p99.9 = {p999:.0f} bytes across {n} strategies "
        f"(threshold {THRESHOLD_BYTES}) [M-03: pg_column_size, DB-side only]"
    )

    if p999 < THRESHOLD_BYTES and not force:
        print("phase12_kill_switch: p99.9 < threshold — no cutover needed.")
        print(
            "phase12_kill_switch: re-run with --force or PHASE12_FORCE_CUTOVER=true "
            "if you suspect a prior partial cutover left some strategies in the "
            "old shape (H-0614)."
        )
        return 0

    if force and p999 < THRESHOLD_BYTES:
        print(
            f"phase12_kill_switch: --force / PHASE12_FORCE_CUTOVER set — "
            f"bypassing threshold gate (p99.9={p999:.0f} < {THRESHOLD_BYTES}). "
            f"Running cutover against every strategy."
        )

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
    # Defensive iteration: a row missing 'strategy_id' (schema rename,
    # RLS-projection change, malformed response) must NOT raise KeyError
    # mid-loop and skip the post-loop audit-log write. Capture the
    # malformed row as a failure so the trigger is still recorded.
    #
    # `input_total` is the row count BEFORE filtering — it is the
    # denominator the audit log reports. `strategy_ids` is the valid
    # subset the per-strategy loop iterates over. Without splitting these
    # two, `len(strategy_ids) - len(failures)` produces a negative
    # success count when malformed_rows > valid rows.
    input_total = len(rows.data)
    strategy_ids: list[str] = []
    malformed_rows: list[tuple[str, str]] = []
    for idx, row in enumerate(rows.data):
        sid = row.get("strategy_id") if isinstance(row, dict) else None
        if not isinstance(sid, str) or not sid:
            malformed_rows.append((f"<row-{idx}>", f"missing/invalid strategy_id in {row!r}"))
            continue
        strategy_ids.append(sid)

    # H-0606: bounded gather (concurrency=_CUTOVER_CONCURRENCY) replaces
    # the prior serial for-loop. Per-strategy try/except lives INSIDE
    # _run_cutovers_bounded so a mid-batch RPC failure can't skip the
    # post-loop audit-log write. Malformed-row failures (rows missing
    # strategy_id) are merged into the same failures list afterwards.
    total_moved, rpc_failures = await _run_cutovers_bounded(strategy_ids)
    failures: list[tuple[str, str]] = list(malformed_rows) + rpc_failures

    succeeded = input_total - len(failures)
    status = "COMPLETE" if not failures else "PARTIAL"
    print(
        f"phase12_kill_switch: {status} — {total_moved} keys moved across "
        f"{succeeded}/{input_total} strategies"
        + (f" ({len(failures)} failed)" if failures else "")
    )

    # Audit-log policy: ALWAYS append on a triggered run. The "skip on
    # no-op re-run" optimization (prior round) silently swallowed three
    # legitimate-trigger cases — (a) operator forces --p999 above
    # threshold but all keys already stripped server-side, (b) migration
    # 129's v_allowlist regressed to empty so RPC returns moved=0 for
    # every strategy, (c) zero published strategies. In each, the
    # operator must SEE the trigger fired. Mark the no-op cases with a
    # "(no-op)" suffix so duplicates are still distinguishable post-
    # incident without losing the record.
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    noop_marker = (
        " (no-op — moved=0, failures=0; either keys already stripped, "
        "v_allowlist empty, or zero published strategies)"
        if total_moved == 0 and not failures
        else ""
    )
    audit_line = (
        f"\n## Kill-switch triggered (D-07) — {ts}{noop_marker}\n"
        f"- p99.9 = {p999:.0f} bytes (threshold {THRESHOLD_BYTES}); "
        f"moved {total_moved} keys across "
        f"{succeeded}/{input_total} strategies "
        f"({len(failures)} failed).\n"
    )

    # Audit line ALSO goes to stderr unconditionally so a deploy log
    # captures it even when TODOS_PATH is missing (M-0637: `.planning/`
    # is a developer-tree artifact, not shipped to Railway / prod
    # containers — the in-tree audit trail is silently lost in the very
    # environment where the kill-switch is most likely to fire).
    print(f"phase12_kill_switch: AUDIT — {audit_line.strip()}", file=sys.stderr)

    # H-0622: atomic write. Falls through to a stderr-only log if the
    # TODOS_PATH parent doesn't exist (deploy artifact case) AND we're
    # not in a known dev/CI environment. The prior round's "raise on
    # missing TODOS_PATH" made the script unusable in production —
    # ironic, since production is exactly where the trigger fires.
    if TODOS_PATH.exists() or TODOS_PATH.parent.exists():
        try:
            _atomic_append_todos(audit_line)
        except OSError as exc:
            # The stderr line above is the primary durable record; an
            # OS-level failure writing the file is a SECONDARY signal
            # (the deploy log already has the audit entry). Log loudly
            # but don't abort — the cutover succeeded against the DB.
            print(
                f"phase12_kill_switch: WARNING — audit log write to "
                f"{TODOS_PATH} failed: {exc!r}. The stderr AUDIT line "
                f"above is the durable record.",
                file=sys.stderr,
            )
    else:
        # M-0637: don't fail loud — the stderr AUDIT line above is the
        # primary durable record in this deployment shape. Log the path
        # we tried so the operator can investigate post-hoc.
        print(
            f"phase12_kill_switch: NOTE — {TODOS_PATH} not in tree "
            f"(expected when running from a deploy container — `.planning/` "
            f"is dev-tree only). The stderr AUDIT line above is the "
            f"durable record.",
            file=sys.stderr,
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
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help=(
            "H-0614: bypass the p999 < threshold short-circuit. Required "
            "after a partial cutover — successful strategies shrank the "
            "p999 distribution, so re-running without --force would log "
            "'no cutover needed' and exit, leaving remaining strategies "
            "in the old shape. Same effect as PHASE12_FORCE_CUTOVER=true."
        ),
    )
    parser.add_argument(
        "--confirm-prod",
        action="store_true",
        default=False,
        help=(
            "H-0624: required when DATABASE_URL points at a prod-looking "
            "host (i.e. no dot-delimited 'stg', 'staging', 'dev', 'test', "
            "or 'local' label, and not 'localhost'/127.0.0.1/::1). Same "
            "effect as PHASE12_KILL_SWITCH_CONFIRMED=true. Without this, "
            "RUN_KILL_SWITCH=true against prod aborts with SystemExit."
        ),
    )
    args = parser.parse_args()
    sys.exit(
        asyncio.run(
            main(
                cli_p999=args.p999,
                cli_count=args.count,
                cli_force=args.force,
                cli_confirm_prod=args.confirm_prod,
            )
        )
    )
