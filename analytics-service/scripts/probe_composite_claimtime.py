"""Phase 164.6.7 harm probe: the composite run decides on the claim-time snapshot.

A standalone script, NOT a test (pytest collects only ``tests/``). It drives the
REAL ``run_stitch_composite_job`` against the loopback local-stack lane booted
by ``scripts/local-stack/run.sh up`` and nothing else:

1. enqueue a marked ``stitch_composite`` job with ``enqueue_compute_job`` (the
   composite fan-out's own call shape);
2. claim it through ``claim_compute_jobs_with_priority`` on the handler's own
   service-role client, with a batch of ONE and only after checking that no
   other claimable ``stitch_composite`` job is on the lane, so the handler
   receives the claim-time snapshot exactly as the worker does. If the claim
   still takes a job the probe did not seed (the pre-check is check-then-act),
   the probe releases that job back to ``pending`` through
   ``defer_compute_job`` with its claim token and stops (exit 2); it never
   reads a verdict from a run that claimed a foreign job;
3. optionally retract the marker on the LIVE row with the TypeScript helper's
   write shape (``src/lib/ledger-refresh-marker.ts``), AFTER the claim and
   BEFORE the run, which is the window under test;
4. await the handler on the snapshot and read which terminal branch it took
   from what it wrote to ``strategy_analytics`` (a branch counts only if the
   handler wrote ``computation_error``: an untouched row is not "error-only");
5. recompute the SQL bridge's ``is_protected`` predicate over the live rows;
6. mark the job failed through ``mark_compute_job_failed`` with the claim
   token, as the worker loop does, and read the end state.

With ``--expect post-fix --pre-fix-output FILE`` it also prints one
``HARM-SIZE:`` line per retracted arm and ONE ``HARM-VERDICT:`` line, derived
from this run's readings and a judged pre-fix run's verdict lines, so a
document quoting the verdict quotes probe output.

Safety, in order:

- ``--handler-log`` must resolve outside every git work tree (this repository
  included), because it receives job and strategy ids.
- ``API_URL`` must name a loopback host, and ``DB_URL`` is resolved the way
  libpq resolves it (``conninfo_to_dict``): every ``host`` and ``hostaddr``
  entry must be loopback, a ``service`` is refused, and so is ``PGSERVICE``,
  ``PGHOSTADDR`` or a non-loopback ``PGHOST`` in the environment. All of this
  runs before any service module is imported or any client exists.
- After connecting, and before the first statement, the connection's own
  ``host`` and ``hostaddr`` must be loopback.

No worker loop and no web server is started or imported; the handler is
awaited directly. Every record the handler logs goes to the ``--handler-log``
file only, and so does any traceback; before that file exists, an abort prints
the exception TYPE and nothing else. The verdict stream carries statuses,
booleans and counts, never an id, a DSN or a key.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from psycopg.conninfo import conninfo_to_dict

_SCRIPT = Path(__file__).resolve()
_ANALYTICS_DIR = _SCRIPT.parents[1]
_REPO_ROOT = _SCRIPT.parents[2]
_STACK_ENV = _REPO_ROOT / "scripts" / "local-stack" / ".stack-env"
_JOB_WORKER_SOURCE = _ANALYTICS_DIR / "services" / "job_worker.py"

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_LOOPBACK_ADDRS = frozenset({"127.0.0.1", "::1"})
_REQUIRED_KEYS = ("API_URL", "DB_URL", "SERVICE_ROLE_KEY")

# The composite fan-out's marker, and the bridge's marker pair, kind triple and
# healthy-status pair (``sync_strategy_analytics_status``). The probe recomputes
# the bridge's predicate FROM THESE CONSTANTS, and checks the lane's live
# definition still carries every one of them before any arm runs, so the copy
# cannot drift from the bridge unnoticed.
_COMPOSITE_MARKER = "ledger-refresh-composite"
_BRIDGE_MARKER_IN_LIST = "('ledger-refresh', 'ledger-refresh-composite')"
_BRIDGE_KIND_IN_LIST = (
    "('derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite')"
)
_BRIDGE_HEALTHY_IN_LIST = "('complete', 'complete_with_warnings')"
# Whitespace-normalised fragments of the bridge body, each tied to a part of the
# predicate ``_sql_is_protected`` hardcodes.
_BRIDGE_FRAGMENTS: tuple[tuple[str, str], ...] = (
    ("the marker IN-list", f"(f.metadata ->> 'source') IN {_BRIDGE_MARKER_IN_LIST}"),
    ("the kind IN-list", f"f.kind IN {_BRIDGE_KIND_IN_LIST}"),
    (
        "the COALESCE-to-FALSE protected expression",
        f"COALESCE( (f.metadata ->> 'source') IN {_BRIDGE_MARKER_IN_LIST} "
        f"AND f.kind IN {_BRIDGE_KIND_IN_LIST}, FALSE ) "
        "AND v_publish_healthy AS is_protected",
    ),
    (
        "the healthy-status pair",
        f"sa.computation_status IN {_BRIDGE_HEALTHY_IN_LIST}",
    ),
)
_SEEDED_STATUS = "complete_with_warnings"

# The live re-read helper's failure line (``_refresh_marker_still_on_row``). A
# post-fix LOUD reading is only evidence of the retraction if no re-read failed:
# a failed read is loud too. The probe checks the fragment is still in the
# handler's source before trusting its absence from the handler log.
_REREAD_FAILURE_FRAGMENT = "could not re-read the refresh marker"

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
# Written to a released foreign job's last_error by defer_compute_job; no id.
_FOREIGN_RELEASE_REASON = "probe-164.6.7 released a job it claimed but did not seed"

_PRE_FIX_SUMMARY = f"HARM-PROBE summary: expect=pre-fix arms={len(_ARMS)} result=ok"
_SAFE_TOKEN = re.compile(r"^[a-z_]+$")

logger = logging.getLogger(__name__)


class ProbeError(RuntimeError):
    """A fail-loud stop. The message names what failed, never an id or a value."""


def _b(value: bool) -> str:
    return "true" if value else "false"


def _resolve_handler_log(raw: str) -> Path:
    """The handler log receives every job and strategy id, and the repository
    is public with ``.planning/`` tracked. Refuse a path inside ANY git work
    tree: that covers this checkout (its root carries ``.git``), a nested
    worktree, and a sibling checkout alike."""
    path = Path(raw).expanduser().resolve()
    for parent in path.parents:
        if (parent / ".git").exists():
            raise ProbeError("--handler-log resolves inside a git work tree; refusing")
    return path


def _assert_loopback_dsn(dsn: str, environ: Mapping[str, str]) -> None:
    """Check the target libpq will ACTUALLY use, not the URI netloc: query
    parameters (``?host=``, ``?hostaddr=``, ``?service=``) override the netloc,
    and ``PGHOSTADDR`` / ``PGSERVICE`` apply with no change to the DSN at all."""
    try:
        params = conninfo_to_dict(dsn)
    except Exception:  # noqa: BLE001 — the DSN text must not reach the stream
        raise ProbeError("DB_URL is not a parseable libpq conninfo; refusing") from None
    if params.get("service"):
        raise ProbeError("DB_URL names a libpq service; refusing")
    for var in ("PGSERVICE", "PGHOSTADDR"):
        if environ.get(var):
            raise ProbeError(f"{var} is set in the environment; refusing")
    pghost = environ.get("PGHOST")
    if pghost and any(h.strip() not in _LOOPBACK_HOSTS for h in pghost.split(",")):
        raise ProbeError("PGHOST in the environment is not loopback; refusing")
    if not params.get("host"):
        raise ProbeError("DB_URL names no host; refusing")
    for part, allowed in (("host", _LOOPBACK_HOSTS), ("hostaddr", _LOOPBACK_ADDRS)):
        raw = params.get(part)
        if raw is None:
            continue
        if any(h.strip() not in allowed for h in str(raw).split(",")):
            raise ProbeError(
                f"DB_URL {part} is not loopback; this probe runs only against "
                "the private local lane"
            )


def _assert_connected_loopback(conn: Any) -> None:
    """The peer the connection actually reached, checked before any statement.

    A Unix-socket connection is refused ON PURPOSE: its ``hostaddr`` is empty,
    so it cannot prove the peer is loopback. Do not turn that into an
    allowance (round-2 silent-failure review I-R2-3)."""
    host = conn.info.host
    hostaddr = conn.info.hostaddr
    if host not in _LOOPBACK_HOSTS or hostaddr not in _LOOPBACK_ADDRS:
        raise ProbeError("the connected database peer is not loopback; refusing")


def _read_stack_env(path: Path, environ: Mapping[str, str]) -> dict[str, str]:
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
    if urlparse(values["API_URL"]).hostname not in _LOOPBACK_HOSTS:
        raise ProbeError(
            "API_URL in scripts/local-stack/.stack-env is not a loopback host; "
            "this probe runs only against the private local lane"
        )
    _assert_loopback_dsn(values["DB_URL"], environ)
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


def _handler_log_installed() -> bool:
    return any(isinstance(h, logging.FileHandler) for h in logging.getLogger().handlers)


def _assert_reread_fragment_in_source(source_path: Path) -> None:
    """The post-fix handler-log scan is only meaningful while the helper still
    logs this fragment; a reworded line would make the scan pass vacuously."""
    text = source_path.read_text(encoding="utf-8")
    if _REREAD_FAILURE_FRAGMENT not in text:
        raise ProbeError(
            "services/job_worker.py no longer carries the live re-read's failure "
            "line; the post-fix handler-log scan would pass vacuously"
        )


def _count_reread_failures(log_path: Path) -> int:
    text = log_path.read_text(encoding="utf-8")
    return sum(1 for line in text.splitlines() if _REREAD_FAILURE_FRAGMENT in line)


def _parse_verdict_lines(text: str) -> dict[str, dict[str, str]]:
    """Read a JUDGED pre-fix run: its summary line must say
    ``expect=pre-fix ... result=ok``, and every arm must have a verdict line."""
    lines = text.splitlines()
    if lines.count(_PRE_FIX_SUMMARY) != 1:
        raise ProbeError(
            "--pre-fix-output does not hold exactly one judged pre-fix summary line"
        )
    arms: dict[str, dict[str, str]] = {}
    for line in lines:
        if not line.startswith("HARM-PROBE verdict: "):
            continue
        fields: dict[str, str] = {}
        for token in line[len("HARM-PROBE verdict: "):].split():
            key, sep, value = token.partition("=")
            if sep:
                fields[key] = value
        name = fields.get("arm", "")
        if name in arms:
            raise ProbeError("--pre-fix-output repeats an arm's verdict line")
        arms[name] = fields
    expected = {name for name, *_ in _ARMS}
    if set(arms) != expected:
        raise ProbeError("--pre-fix-output does not hold one verdict line per arm")
    for fields in arms.values():
        for key in ("status_after_fail", "warned_after_fail", "status_after_next_bridge"):
            if not _SAFE_TOKEN.match(fields.get(key, "")):
                raise ProbeError(f"--pre-fix-output carries an unreadable {key}")
    return arms


def _harm_lines(
    pre: dict[str, dict[str, str]], readings: list[tuple[str, dict[str, Any]]]
) -> list[str]:
    """One HARM-SIZE line per retracted arm and ONE HARM-VERDICT line, compared
    end state against end state (D-02: recorded, gates nothing)."""
    out: list[str] = []
    differing: list[str] = []
    for name, r in readings:
        if not r["retracted"]:
            continue
        p = pre[name]
        pre_s = (
            f"{p['status_after_fail']}/{p['warned_after_fail']}"
            f"->{p['status_after_next_bridge']}"
        )
        post_s = (
            f"{_fmt(r['status_after_fail'])}/{_fmt(r['warned_after_fail'])}"
            f"->{_fmt(r['status_after_next_bridge'])}"
        )
        differs = pre_s != post_s
        if differs:
            differing.append(name)
        out.append(f"HARM-SIZE: arm={name} pre={pre_s} post={post_s} differs={_b(differs)}")
    if differing:
        out.append(
            "HARM-VERDICT: end-state harm shown on the lane for "
            f"{', '.join(differing)}; scoped to the lane, production cohort unmeasured"
        )
    else:
        out.append(
            "HARM-VERDICT: no end-state difference on the lane; the fix ships for "
            "the decision disagreement (D-02)"
        )
    return out


async def _main_async(args: argparse.Namespace) -> int:
    handler_log = _resolve_handler_log(args.handler_log)
    env = _read_stack_env(_STACK_ENV, os.environ)
    pre_fix: dict[str, dict[str, str]] | None = None
    if args.pre_fix_output is not None:
        if args.expect != "post-fix":
            raise ProbeError("--pre-fix-output is read only with --expect post-fix")
        try:
            pre_text = Path(args.pre_fix_output).read_text(encoding="utf-8")
        except OSError:
            raise ProbeError("--pre-fix-output could not be read") from None
        pre_fix = _parse_verdict_lines(pre_text)
    if args.expect == "post-fix":
        _assert_reread_fragment_in_source(_JOB_WORKER_SOURCE)
    file_handler = _configure_handler_log(handler_log)

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
    # The service import may have read a .env; re-check what libpq will see.
    _assert_loopback_dsn(env["DB_URL"], os.environ)
    _confine_logging(file_handler)

    supabase = get_supabase()

    readings: list[tuple[str, dict[str, Any]]] = []
    with psycopg.connect(env["DB_URL"], autocommit=True) as conn:
        _assert_connected_loopback(conn)
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
    file_handler.flush()
    reread_failures = _count_reread_failures(handler_log)
    print(f"HARM-PROBE reread-failures: count={reread_failures}", flush=True)
    result, code = _judge(args.expect, readings, reread_failures=reread_failures)
    print(
        f"HARM-PROBE summary: expect={args.expect or 'none'} arms={len(readings)} "
        f"result={result}",
        flush=True,
    )
    if args.expect == "post-fix":
        if pre_fix is None:
            print("HARM-PROBE harm-size: not computed (no --pre-fix-output)", flush=True)
        elif result != "ok":
            print(f"HARM-PROBE harm-size: withheld (result={result})", flush=True)
        else:
            for line in _harm_lines(pre_fix, readings):
                print(line, flush=True)
    return code


def _judge(
    expect: str | None,
    readings: list[tuple[str, dict[str, Any]]],
    *,
    reread_failures: int = 0,
) -> tuple[str, int]:
    """Assert the DECISION readings for the chosen mode.

    A claim that takes a job the probe did not seed never reaches this
    function: ``_claim_own`` releases that job and raises, so the run stops at
    exit 2 with no verdict (round-2 review IN-04).

    Without ``--expect`` nothing is asserted and the result says so
    (``unasserted``), so a copied command that drops the flag cannot read as a
    pass.

    The end-state values (warned_after_fail, both *_after_next_bridge readings
    and everything on the modelled arm) are printed and asserted in NEITHER
    mode: they size the harm, they gate nothing (D-02).

    Precedence in pre-fix mode: a broken control or a bridge-fidelity miss is
    FAIL first, because either one means the driver cannot be trusted, and a
    retracted reading from an untrusted driver cannot disprove anything. Only
    with a trusted driver does a retracted arm that AGREES read as
    PREMISE-DISPROVED (exit 3: stop and replan).

    In post-fix mode a LOUD retracted arm counts only if no live re-read failed
    during the run: a failed re-read is loud too, so it would pass for the
    wrong reason.
    """
    if expect is None:
        return "unasserted", 0

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
    if reread_failures != 0:
        return "FAIL", 1
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
    body = " ".join(str(row[0] if row else "").split())
    for label, fragment in _BRIDGE_FRAGMENTS:
        if fragment not in body:
            raise ProbeError(
                f"the lane's sync_strategy_analytics_status no longer carries {label}; "
                "the probe's predicate would drift"
            )


def _seed(conn: Any, *, user_id: str, strategy_id: str, warned_seed: bool) -> None:
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
        # The composite success path writes both columns. computation_error is
        # left NULL: a branch is read only once the handler has written it.
        cur.execute(
            "INSERT INTO public.strategy_analytics "
            "(strategy_id, computation_status, computation_warned) "
            "VALUES (%s, %s, %s)",
            (strategy_id, _SEEDED_STATUS, warned_seed),
        )


def _cleanup(conn: Any, *, user_id: str, strategy_id: str) -> None:
    """Deletes by the arm's own ids; every statement tolerates a row that was
    never seeded, so a partial seed is cleaned too."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.compute_jobs WHERE strategy_id = %s", (strategy_id,))
        cur.execute(
            "DELETE FROM public.strategy_analytics WHERE strategy_id = %s", (strategy_id,)
        )
        cur.execute("DELETE FROM public.strategies WHERE id = %s", (strategy_id,))
        cur.execute("DELETE FROM auth.users WHERE id = %s", (user_id,))


def _cleanup_guarded(
    conn: Any, *, user_id: str, strategy_id: str, arm_failed: bool
) -> None:
    """A cleanup failure never masks the arm's own failure. While an arm error
    is in flight, the cleanup error goes to the handler log and the caller
    re-raises the ORIGINAL. Otherwise the cleanup error is a named stop."""
    try:
        _cleanup(conn, user_id=user_id, strategy_id=strategy_id)
    except Exception as exc:
        if arm_failed:
            logger.exception("probe cleanup failed while an arm error was in flight")
            return
        logger.exception("probe cleanup failed")
        raise ProbeError(
            "cleanup failed for an arm (traceback in the handler log)"
        ) from exc


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


def _assert_no_foreign_claimable(conn: Any, own_job_id: str) -> None:
    """The claim RPC takes the queue head, not a chosen row. Claim only when the
    probe's own job is the one claimable ``stitch_composite`` on the lane (the
    candidacy test mirrors ``claim_compute_jobs_with_priority``)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM public.compute_jobs "
            "WHERE kind = 'stitch_composite' "
            "  AND status IN ('pending', 'failed_retry') "
            "  AND (next_attempt_at IS NULL OR next_attempt_at <= now()) "
            "  AND id <> %s::uuid",
            (own_job_id,),
        )
        row = cur.fetchone()
    foreign = int(row[0]) if row else 0
    if foreign:
        raise ProbeError(
            f"the lane holds {foreign} claimable stitch_composite job(s) the probe "
            "did not seed; refusing to claim them"
        )


async def _release_foreign(supabase: Any, rows: list[dict[str, Any]]) -> int:
    """Hand each foreign row the claim took back to ``pending`` through
    ``defer_compute_job`` with that row's own claim token (the RPC's fence, so
    it can release only the claim this probe just made). It restores
    ``pending``, gives the attempt back and clears the claim. Returns how many
    were released; a release that fails is logged to the handler log and
    counted as not released, never raised past the caller's refusal."""
    released = 0
    for row in rows:
        params = {
            "p_job_id": row.get("id"),
            "p_defer_seconds": 0,
            "p_reason": _FOREIGN_RELEASE_REASON,
            "p_claim_token": row.get("claim_token"),
        }

        def _release(params: dict[str, Any] = params) -> Any:
            return supabase.rpc("defer_compute_job", params).execute()

        try:
            await asyncio.to_thread(_release)
        except Exception:  # noqa: BLE001
            logger.exception("probe could not release a job it claimed but did not seed")
            continue
        released += 1
    return released


async def _claim_own(supabase: Any, conn: Any, own_job_id: str) -> dict[str, Any]:
    """Claim a batch of ONE and return the probe's own row.

    A claim that took a job the probe did not seed is released, then refused:
    the run stops, and no foreign row is left ``running`` under the probe's
    worker id unless its release failed, which the refusal then says."""
    _assert_no_foreign_claimable(conn, own_job_id)
    claimed = await asyncio.to_thread(
        lambda: supabase.rpc(
            "claim_compute_jobs_with_priority",
            {
                "p_batch_size": 1,
                "p_worker_id": _WORKER_ID,
                "p_unified_backbone_active": None,
                "p_kind_include": ["stitch_composite"],
                "p_kind_exclude": None,
            },
        ).execute()
    )
    rows: list[dict[str, Any]] = list(getattr(claimed, "data", None) or [])
    own = [r for r in rows if str(r.get("id")) == own_job_id]
    foreign_rows = [r for r in rows if str(r.get("id")) != own_job_id]
    if foreign_rows:
        released = await _release_foreign(supabase, foreign_rows)
        stuck = len(foreign_rows) - released
        message = (
            f"the claim took {len(foreign_rows)} job(s) the probe did not seed; "
            f"released {released} back to pending"
        )
        if stuck:
            message += (
                f"; {stuck} could not be released and are left running under the "
                "probe's worker id (see the handler log)"
            )
        raise ProbeError(message)
    if len(own) != 1:
        raise ProbeError("the claim did not return the probe's own job")
    return own[0]


def _read_analytics(conn: Any, strategy_id: str) -> tuple[str | None, bool | None, bool]:
    """(computation_status, computation_warned, computation_error IS NOT NULL)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT computation_status, computation_warned, computation_error IS NOT NULL "
            "FROM public.strategy_analytics WHERE strategy_id = %s",
            (strategy_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ProbeError("the arm's strategy_analytics row is missing")
    return row[0], row[1], bool(row[2])


def _classify_branch(status: str | None, has_error: bool) -> str:
    """Both terminal branches write ``computation_error``; the error-only branch
    leaves the status alone. So an unchanged status with NO error is a handler
    that stamped nothing, never the error-only branch."""
    if not has_error:
        raise ProbeError(
            "the handler wrote no computation_error; neither terminal branch ran"
        )
    if status == "failed":
        return "loud"
    if status == _SEEDED_STATUS:
        return "error_only"
    raise ProbeError("unexpected: the handler left an unrecognised status")


def _sql_is_protected(conn: Any, job_id: str) -> bool:
    """The bridge's own ``is_protected`` predicate, over the LIVE rows, built
    from the same constants ``_assert_bridge_definition`` pins."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE("
            f"  (j.metadata ->> 'source') IN {_BRIDGE_MARKER_IN_LIST}"
            f"  AND j.kind IN {_BRIDGE_KIND_IN_LIST},"
            "  FALSE"
            ") AND EXISTS ("
            "  SELECT 1 FROM public.strategy_analytics sa"
            "   WHERE sa.strategy_id = j.strategy_id"
            f"     AND sa.computation_status IN {_BRIDGE_HEALTHY_IN_LIST}"
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
    # The ids exist before the first INSERT, so a seed that fails half way is
    # still cleaned up by id.
    user_id = str(uuid.uuid4())
    strategy_id = str(uuid.uuid4())
    try:
        reading = await _run_arm_body(
            conn,
            supabase,
            handler,
            user_id=user_id,
            strategy_id=strategy_id,
            retracted=retracted,
            warned_seed=warned_seed,
            inflight=inflight,
        )
    except BaseException:
        _cleanup_guarded(conn, user_id=user_id, strategy_id=strategy_id, arm_failed=True)
        raise
    _cleanup_guarded(conn, user_id=user_id, strategy_id=strategy_id, arm_failed=False)
    return reading


async def _run_arm_body(
    conn: Any,
    supabase: Any,
    handler: Any,
    *,
    user_id: str,
    strategy_id: str,
    retracted: bool,
    warned_seed: bool,
    inflight: str,
) -> dict[str, Any]:
    _seed(conn, user_id=user_id, strategy_id=strategy_id, warned_seed=warned_seed)
    if _read_analytics(conn, strategy_id)[2]:
        raise ProbeError("the seeded strategy_analytics row already carries an error")
    job_id = _enqueue(conn, strategy_id, "stitch_composite", {"source": _COMPOSITE_MARKER})

    snapshot = await _claim_own(supabase, conn, job_id)
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

    status_after_run, _, has_error = _read_analytics(conn, strategy_id)
    python_branch = _classify_branch(status_after_run, has_error)

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

    status_after_fail, warned_after_fail, _ = _read_analytics(conn, strategy_id)
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
    next_bridge_method = await _drive_next_bridge(conn, supabase, strategy_id, next_job_id)
    status_after_next_bridge, warned_after_next_bridge, _ = _read_analytics(
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
    }


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

    row = await _claim_own(supabase, conn, next_job_id)
    token = row.get("claim_token")
    if not token:
        raise ProbeError("the next-bridge fallback could not claim the fresh job")
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
        f"warned_after_next_bridge={_fmt(r['warned_after_next_bridge'])}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument(
        "--expect",
        choices=("pre-fix", "post-fix"),
        default=None,
        help="assert the decision readings for this tree "
        "(default: print only, and the summary says result=unasserted)",
    )
    parser.add_argument(
        "--handler-log",
        required=True,
        help="file that receives every handler log record and any traceback; "
        "refused inside the repository or any git work tree",
    )
    parser.add_argument(
        "--pre-fix-output",
        default=None,
        help="with --expect post-fix: the stdout of a judged pre-fix run; the probe "
        "then prints the HARM-SIZE and HARM-VERDICT lines",
    )
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_main_async(args))
    except ProbeError as exc:
        print(f"HARM-PROBE refused: {exc}", file=sys.stderr, flush=True)
        return 2
    except Exception as exc:  # noqa: BLE001
        # A database error's text can name a row id, and a traceback names
        # absolute paths: it goes to the handler log only, and only once that
        # file is the root logger's sink. Otherwise logging's last-resort
        # handler would write it to stderr. The stream gets the TYPE.
        if _handler_log_installed():
            logger.exception("probe aborted")
            where = "traceback in the handler log"
        else:
            where = "raised before the handler log existed; no traceback kept"
        print(
            f"HARM-PROBE error: {type(exc).__name__} ({where})",
            file=sys.stderr,
            flush=True,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
