"""Phase 164.6.7 harm probe: the composite run decides on the claim-time snapshot.

A standalone script, NOT a test (pytest collects only ``tests/``). It drives the
REAL ``run_stitch_composite_job`` against the loopback local-stack lane booted
by ``scripts/local-stack/run.sh up`` and nothing else:

1. enqueue a marked ``stitch_composite`` job with ``enqueue_compute_job`` (the
   composite fan-out's own call shape);
2. claim it through ``claim_compute_jobs_with_priority`` on the handler's own
   service-role client, so the handler receives the claim-time snapshot exactly
   as the worker does;
3. optionally retract the marker on the LIVE row with the TypeScript helper's
   write shape (``src/lib/ledger-refresh-marker.ts``), AFTER the claim and
   BEFORE the run, which is the window under test;
4. await the handler on the snapshot and read which terminal branch it took
   from what it wrote to ``strategy_analytics``;
5. recompute the SQL bridge's ``is_protected`` predicate over the live rows;
6. mark the job failed through ``mark_compute_job_failed`` with the claim
   token, as the worker loop does, and read the end state.

Safety, in order: the lane's ``.stack-env`` is read and BOTH ``API_URL`` and
``DB_URL`` must name a loopback host before any service module is imported or
any client exists. No worker loop and no web server is started or imported;
the handler is awaited directly. Every record the handler logs (they name job
and strategy ids) goes to the ``--handler-log`` file only. The verdict stream
carries statuses, booleans and counts, never an id, a DSN or a key.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

_SCRIPT = Path(__file__).resolve()
_ANALYTICS_DIR = _SCRIPT.parents[1]
_REPO_ROOT = _SCRIPT.parents[2]
_STACK_ENV = _REPO_ROOT / "scripts" / "local-stack" / ".stack-env"

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_REQUIRED_KEYS = ("API_URL", "DB_URL", "SERVICE_ROLE_KEY")

# The composite fan-out's marker, and the bridge's marker pair and kind triple
# (``sync_strategy_analytics_status``). The probe recomputes the bridge's
# predicate, so it checks the lane's live definition still carries both
# fragments before any arm runs.
_COMPOSITE_MARKER = "ledger-refresh-composite"
_BRIDGE_MARKER_IN_LIST = "('ledger-refresh', 'ledger-refresh-composite')"
_BRIDGE_PROTECTED_ALIAS = "AS is_protected"
_SEEDED_STATUS = "complete_with_warnings"

# (name, retracted, warned_seed, inflight). The modelled arm puts ONE other
# job for the same strategy in flight before the failure mark; a production
# path to that shape is unmeasured, so it is labelled modelled, never observed.
_ARMS: tuple[tuple[str, bool, bool, str], ...] = (
    ("control", False, True, "none"),
    ("retracted-warned", True, True, "none"),
    ("retracted-unwarned", True, False, "none"),
    ("retracted-warned-inflight", True, True, "modelled"),
)
# enqueue_compute_job gates a strategy-scoped kind only on the kind CHECK list
# and the retired compute_analytics; sync_trades needs no key or seed.
_INFLIGHT_KIND = "sync_trades"

_WORKER_ID = "probe-164.6.7-claimtime"
_CORRELATION_ID = "probe-164.6.7-retraction"


class ProbeError(RuntimeError):
    """A fail-loud stop. The message names what failed, never an id or a value."""


def _b(value: bool) -> str:
    return "true" if value else "false"


def _read_stack_env(path: Path) -> dict[str, str]:
    """Parse ``KEY="value"`` lines, splitting on the FIRST ``=`` only and
    stripping ONE surrounding pair of double quotes, as ``supabase status -o
    env`` writes them. Refuses by KEY name, never printing a value."""
    if not path.is_file():
        raise ProbeError(
            "scripts/local-stack/.stack-env is absent: boot the lane with "
            "'bash scripts/local-stack/run.sh up' first"
        )
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        values[key] = value
    for key in _REQUIRED_KEYS:
        if not values.get(key):
            raise ProbeError(f"scripts/local-stack/.stack-env lacks {key}")
    for key in ("API_URL", "DB_URL"):
        host = urlparse(values[key]).hostname
        if host not in _LOOPBACK_HOSTS:
            raise ProbeError(
                f"{key} in scripts/local-stack/.stack-env is not a loopback host; "
                "this probe runs only against the private local lane"
            )
    return values


def _configure_handler_log(path: Path) -> logging.Handler:
    """ONE file handler on the root logger and nothing else, so handler
    records never reach stdout or stderr."""
    path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(path, mode="w", encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logging.basicConfig(level=logging.INFO, handlers=[file_handler], force=True)
    return file_handler


def _confine_logging(file_handler: logging.Handler) -> None:
    """After the service import, drop any handler a module attached, so the
    file handler stays the only sink."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if handler is not file_handler:
            root.removeHandler(handler)
    for obj in list(logging.Logger.manager.loggerDict.values()):
        if isinstance(obj, logging.Logger):
            for handler in list(obj.handlers):
                obj.removeHandler(handler)
            obj.propagate = True


async def _main_async(args: argparse.Namespace) -> int:
    env = _read_stack_env(_STACK_ENV)
    file_handler = _configure_handler_log(Path(args.handler_log))

    # Only now point the service client at the lane, then import.
    os.environ["SUPABASE_URL"] = env["API_URL"]
    os.environ["SUPABASE_SERVICE_KEY"] = env["SERVICE_ROLE_KEY"]
    if str(_ANALYTICS_DIR) not in sys.path:
        sys.path.insert(0, str(_ANALYTICS_DIR))

    import psycopg

    from services.db import get_supabase
    from services.job_worker import run_stitch_composite_job

    if os.environ.get("SUPABASE_URL") != env["API_URL"]:
        raise ProbeError("SUPABASE_URL changed during the service import; refusing")
    if urlparse(os.environ["SUPABASE_URL"]).hostname not in _LOOPBACK_HOSTS:
        raise ProbeError("SUPABASE_URL is not a loopback host after import; refusing")
    _confine_logging(file_handler)

    supabase = get_supabase()

    readings: list[tuple[str, dict[str, Any]]] = []
    with psycopg.connect(env["DB_URL"], autocommit=True) as conn:
        _assert_bridge_definition(conn)
        for name, retracted, warned_seed, inflight in _ARMS:
            reading = await _run_arm(
                conn,
                supabase,
                run_stitch_composite_job,
                retracted=retracted,
                warned_seed=warned_seed,
                inflight=inflight,
            )
            print(_verdict_line(name, reading), flush=True)
            readings.append((name, reading))

    methods = sorted({str(r["next_bridge_method"]) for _, r in readings})
    print(
        f"HARM-PROBE next-bridge: method={','.join(methods)} "
        f"inflight_kind={_INFLIGHT_KIND}",
        flush=True,
    )
    result, code = _judge(args.expect, readings)
    print(
        f"HARM-PROBE summary: expect={args.expect or 'none'} arms={len(readings)} "
        f"result={result}",
        flush=True,
    )
    return code


def _judge(expect: str | None, readings: list[tuple[str, dict[str, Any]]]) -> tuple[str, int]:
    """Assert the DECISION readings for the chosen mode.

    The end-state values (warned_after_fail, both *_after_next_bridge readings
    and everything on the modelled arm) are printed and asserted in NEITHER
    mode: they size the harm, they gate nothing (D-02).

    Precedence in pre-fix mode: a broken control or a bridge-fidelity miss is
    FAIL first, because either one means the driver cannot be trusted, and a
    retracted reading from an untrusted driver cannot disprove anything. Only
    with a trusted driver does a retracted arm that AGREES read as
    PREMISE-DISPROVED (exit 3: stop and replan).
    """
    if expect is None:
        return "ok", 0

    fidelity_ok = all(
        r["bridge_agrees"] == "true" for _, r in readings if r["inflight"] == "none"
    )
    control = [r for name, r in readings if name == "control"]
    control_ok = len(control) == 1 and (
        control[0]["python_branch"] == "error_only"
        and control[0]["sql_is_protected"] is True
        and control[0]["layers_agree"] is True
    )
    retracted = [r for _, r in readings if r["retracted"]]
    if not (fidelity_ok and control_ok and retracted):
        return "FAIL", 1

    if expect == "pre-fix":
        if any(r["layers_agree"] for r in retracted):
            return "PREMISE-DISPROVED", 3
        if all(
            r["python_branch"] == "error_only" and r["sql_is_protected"] is False
            for r in retracted
        ):
            return "ok", 0
        return "FAIL", 1

    # post-fix
    if all(
        r["layers_agree"] is True
        and r["python_branch"] == "loud"
        and r["sql_is_protected"] is False
        for r in retracted
    ):
        return "ok", 0
    return "FAIL", 1


def _assert_bridge_definition(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pg_get_functiondef("
            "'public.sync_strategy_analytics_status(uuid)'::regprocedure)"
        )
        row = cur.fetchone()
    body = row[0] if row else ""
    if _BRIDGE_PROTECTED_ALIAS not in body:
        raise ProbeError(
            "the lane's sync_strategy_analytics_status no longer carries "
            f"'{_BRIDGE_PROTECTED_ALIAS}'; the probe's predicate would drift"
        )
    if _BRIDGE_MARKER_IN_LIST not in body:
        raise ProbeError(
            "the lane's sync_strategy_analytics_status no longer carries the "
            "marker IN-list; the probe's predicate would drift"
        )


def _seed(conn: Any, *, warned_seed: bool) -> tuple[str, str]:
    user_id = str(uuid.uuid4())
    strategy_id = str(uuid.uuid4())
    tag = uuid.uuid4().hex[:8]
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) "
            "VALUES (%s, %s, '{}'::jsonb)",
            (user_id, f"probe-164-6-7-{tag}@example.invalid"),
        )
        # ZERO strategy_keys members: the handler's earliest permanent failure,
        # with no exchange I/O.
        cur.execute(
            "INSERT INTO public.strategies (id, user_id, name) VALUES (%s, %s, %s)",
            (strategy_id, user_id, f"probe-164-6-7-{tag}"),
        )
        # The composite success path writes both columns.
        cur.execute(
            "INSERT INTO public.strategy_analytics "
            "(strategy_id, computation_status, computation_warned) "
            "VALUES (%s, %s, %s)",
            (strategy_id, _SEEDED_STATUS, warned_seed),
        )
    return user_id, strategy_id


def _cleanup(conn: Any, *, user_id: str, strategy_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.compute_jobs WHERE strategy_id = %s", (strategy_id,))
        cur.execute(
            "DELETE FROM public.strategy_analytics WHERE strategy_id = %s", (strategy_id,)
        )
        cur.execute("DELETE FROM public.strategies WHERE id = %s", (strategy_id,))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (user_id,))


def _enqueue(conn: Any, strategy_id: str, kind: str, metadata: dict[str, Any] | None) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT public.enqueue_compute_job("
            "p_strategy_id => %s::uuid, p_kind => %s, p_metadata => %s::jsonb)",
            (strategy_id, kind, json.dumps(metadata) if metadata is not None else None),
        )
        row = cur.fetchone()
    if not row or row[0] is None:
        raise ProbeError(f"enqueue_compute_job returned no id for kind {kind}")
    return str(row[0])


def _read_analytics(conn: Any, strategy_id: str) -> tuple[str | None, bool | None]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT computation_status, computation_warned "
            "FROM public.strategy_analytics WHERE strategy_id = %s",
            (strategy_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ProbeError("the arm's strategy_analytics row is missing")
    return row[0], row[1]


def _sql_is_protected(conn: Any, job_id: str) -> bool:
    """The bridge's own ``is_protected`` predicate, over the LIVE rows."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE("
            "  (j.metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')"
            "  AND j.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv',"
            "                 'stitch_composite'),"
            "  FALSE"
            ") AND EXISTS ("
            "  SELECT 1 FROM public.strategy_analytics sa"
            "   WHERE sa.strategy_id = j.strategy_id"
            "     AND sa.computation_status IN ('complete', 'complete_with_warnings')"
            ") FROM public.compute_jobs j WHERE j.id = %s",
            (job_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ProbeError("the arm's compute_jobs row is missing at the predicate read")
    return bool(row[0])


async def _run_arm(
    conn: Any,
    supabase: Any,
    handler: Any,
    *,
    retracted: bool,
    warned_seed: bool,
    inflight: str,
) -> dict[str, Any]:
    user_id, strategy_id = _seed(conn, warned_seed=warned_seed)
    try:
        job_id = _enqueue(
            conn, strategy_id, "stitch_composite", {"source": _COMPOSITE_MARKER}
        )

        claimed = await asyncio.to_thread(
            lambda: supabase.rpc(
                "claim_compute_jobs_with_priority",
                {
                    "p_batch_size": 1000,
                    "p_worker_id": _WORKER_ID,
                    "p_unified_backbone_active": None,
                    "p_kind_include": ["stitch_composite"],
                    "p_kind_exclude": None,
                },
            ).execute()
        )
        rows = list(getattr(claimed, "data", None) or [])
        own = [r for r in rows if str(r.get("id")) == job_id]
        foreign_rows_claimed = len(rows) - len(own)
        if len(own) != 1:
            raise ProbeError("the claim did not return the arm's own job")
        snapshot: dict[str, Any] = own[0]
        snapshot_meta = snapshot.get("metadata")
        if not (
            isinstance(snapshot_meta, dict)
            and snapshot_meta.get("source") == _COMPOSITE_MARKER
        ):
            raise ProbeError("the claim-time snapshot does not carry the marker")

        if retracted:
            # The TypeScript helper's write shape: metadata minus source, plus
            # refresh_marker_retracted and a correlation_id. AFTER the claim.
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE public.compute_jobs "
                    "SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'source') "
                    "  || jsonb_build_object('refresh_marker_retracted', %s::text,"
                    "                        'correlation_id', %s::text) "
                    "WHERE id = %s",
                    (_COMPOSITE_MARKER, _CORRELATION_ID, job_id),
                )
                if cur.rowcount != 1:
                    raise ProbeError("the retraction did not update exactly one row")

        result = await handler(snapshot)
        if getattr(result, "error_kind", None) != "permanent":
            raise ProbeError("the handler did not return a permanent failure")

        status_after_run, _ = _read_analytics(conn, strategy_id)
        if status_after_run == "failed":
            python_branch = "loud"
        elif status_after_run == _SEEDED_STATUS:
            python_branch = "error_only"
        else:
            raise ProbeError("unexpected: the handler left an unrecognised status")

        sql_is_protected = _sql_is_protected(conn, job_id)
        layers_agree = (python_branch == "error_only") == sql_is_protected

        if inflight == "modelled":
            _enqueue(conn, strategy_id, _INFLIGHT_KIND, None)

        claim_token = snapshot.get("claim_token")
        if not claim_token:
            raise ProbeError("the claimed row carries no claim token")
        await asyncio.to_thread(
            lambda: supabase.rpc(
                "mark_compute_job_failed",
                {
                    "p_job_id": job_id,
                    "p_error": getattr(result, "error_message", None) or "Unknown error",
                    "p_error_kind": "permanent",
                    "p_claim_token": claim_token,
                },
            ).execute()
        )
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM public.compute_jobs WHERE id = %s", (job_id,))
            job_row = cur.fetchone()
        if not job_row or job_row[0] != "failed_final":
            raise ProbeError("mark_compute_job_failed did not leave the job failed_final")

        status_after_fail, warned_after_fail = _read_analytics(conn, strategy_id)
        bridge_agrees: str
        if inflight == "none":
            bridge_agrees = _b((status_after_fail == "failed") == (not sql_is_protected))
        else:
            bridge_agrees = "n/a"

        # The next bridge call (H2): a fresh UNMARKED composite job stays
        # pending, then the bridge runs once more.
        next_job_id = _enqueue(conn, strategy_id, "stitch_composite", None)
        if next_job_id == job_id:
            raise ProbeError("the next-bridge enqueue returned the failed job")
        next_bridge_method = await _drive_next_bridge(
            conn, supabase, strategy_id, next_job_id
        )
        status_after_next_bridge, warned_after_next_bridge = _read_analytics(
            conn, strategy_id
        )

        return {
            "retracted": retracted,
            "warned_seed": warned_seed,
            "inflight": inflight,
            "python_branch": python_branch,
            "sql_is_protected": sql_is_protected,
            "layers_agree": layers_agree,
            "status_after_fail": status_after_fail,
            "warned_after_fail": warned_after_fail,
            "bridge_agrees": bridge_agrees,
            "status_after_next_bridge": status_after_next_bridge,
            "warned_after_next_bridge": warned_after_next_bridge,
            "next_bridge_method": next_bridge_method,
            "foreign_rows_claimed": foreign_rows_claimed,
        }
    finally:
        _cleanup(conn, user_id=user_id, strategy_id=strategy_id)


async def _drive_next_bridge(
    conn: Any, supabase: Any, strategy_id: str, next_job_id: str
) -> str:
    """Call the bridge directly on the lane (research A3). If the lane refuses
    the direct call, drive it by claiming and failing the fresh job through its
    claim token instead, and say which."""
    import psycopg

    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT public.sync_strategy_analytics_status(%s::uuid)", (strategy_id,)
            )
        return "direct"
    except psycopg.errors.InsufficientPrivilege:
        pass

    claimed = await asyncio.to_thread(
        lambda: supabase.rpc(
            "claim_compute_jobs_with_priority",
            {
                "p_batch_size": 1000,
                "p_worker_id": _WORKER_ID,
                "p_unified_backbone_active": None,
                "p_kind_include": ["stitch_composite"],
                "p_kind_exclude": None,
            },
        ).execute()
    )
    rows = [
        r for r in (getattr(claimed, "data", None) or []) if str(r.get("id")) == next_job_id
    ]
    if len(rows) != 1 or not rows[0].get("claim_token"):
        raise ProbeError("the next-bridge fallback could not claim the fresh job")
    token = rows[0]["claim_token"]
    await asyncio.to_thread(
        lambda: supabase.rpc(
            "mark_compute_job_failed",
            {
                "p_job_id": next_job_id,
                "p_error": "probe next-bridge fallback",
                "p_error_kind": "permanent",
                "p_claim_token": token,
            },
        ).execute()
    )
    return "claim-and-fail"


def _fmt(value: Any) -> str:
    if isinstance(value, bool):
        return _b(value)
    if value is None:
        return "null"
    return str(value)


def _verdict_line(name: str, r: dict[str, Any]) -> str:
    return (
        f"HARM-PROBE verdict: arm={name} retracted={_fmt(r['retracted'])} "
        f"warned_seed={_fmt(r['warned_seed'])} inflight={r['inflight']} "
        f"python_branch={r['python_branch']} "
        f"sql_is_protected={_fmt(r['sql_is_protected'])} "
        f"layers_agree={_fmt(r['layers_agree'])} "
        f"status_after_fail={_fmt(r['status_after_fail'])} "
        f"warned_after_fail={_fmt(r['warned_after_fail'])} "
        f"bridge_agrees={r['bridge_agrees']} "
        f"status_after_next_bridge={_fmt(r['status_after_next_bridge'])} "
        f"warned_after_next_bridge={_fmt(r['warned_after_next_bridge'])} "
        f"foreign_rows_claimed={r['foreign_rows_claimed']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--expect",
        choices=("pre-fix", "post-fix"),
        default=None,
        help="assert the decision readings for this tree (default: print only)",
    )
    parser.add_argument(
        "--handler-log",
        required=True,
        help="file that receives every handler log record (kept outside the repo)",
    )
    args = parser.parse_args()
    try:
        return asyncio.run(_main_async(args))
    except ProbeError as exc:
        print(f"HARM-PROBE refused: {exc}", file=sys.stderr, flush=True)
        return 2
    except Exception as exc:  # noqa: BLE001
        # A database error's text can name a row id: the traceback goes to the
        # handler log only, and the stream gets the exception TYPE.
        logging.getLogger(__name__).exception("probe aborted")
        print(
            f"HARM-PROBE error: {type(exc).__name__} (traceback in the handler log)",
            file=sys.stderr,
            flush=True,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
