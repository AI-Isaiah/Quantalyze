"""Phase 164.6.6 (MT5TERMINALISOLATION) criterion 1 — THE HANDOVER RECORD: every
time this process logs the shared MT5 terminal into a DIFFERENT holder than the
one it last logged in, ONE row naming the DISPLACED holder and the incoming one
is written into ``public.cron_runs``.

WHAT THIS IS FOR. On 2026-09-21 the Journal showed a clean one-second handover
of the shared terminal from one account to another. The displaced account was
serving a live session and got no error, no signal and NO RECORD. The founder
decided (``164.6.6-CONTEXT.md`` D-01, 2026-09-27) that job-terminal switches
between onboarded keys STAY under the per-call-login read model, and that each
one is RECORDED against the holder it displaced (the "(f)" half of D-02). This
module is that record. Whether switches still HAPPEN is D-01's answer, not this
module's claim.

HOW A HANDOVER IS SEEN. ``services.mt5_client`` keeps a per-terminal registry of
who this process last logged the terminal into (``mt5_terminal_holder``), stamped
only by a SUCCESSFUL login and set to ``unknown`` by a recycle.
``services.mt5_concurrency.mt5_terminal_lease`` reads it on acquisition and again
right after release; when the two differ, it awaits
``record_mt5_terminal_handover`` with both sides. A lease whose body logged in
the holder that was already recorded writes nothing.

THE SINK, AND WHY THIS ONE (founder ACCEPTED 2026-09-27, ``164.6.6-CONTEXT.md``
``### Claude's Discretion``). ``public.cron_runs`` under a NEW ``cron_name``,
``mt5_terminal_handover``, with NO MIGRATION — the same reasoning
``services.mt5_session_episodes`` records for its own name:

  * the table is service-role writable by its existing ``cron_runs_service_role``
    policy (``FOR ALL`` with a matching ``WITH CHECK``);
  * ``cron_runs.cron_name`` carries no CHECK constraint, so a new name needs no
    DDL (RESEARCH "Schema / Migration Answer");
  * ``latest_cron_success(p_cron_name)`` takes a NAME and does not enumerate
    them, so a new name raises no false stale alert;
  * the SQL gates that count this table narrow by ``cron_name`` (re-measured in
    ``mt5_session_episodes``' docstring). ⛔ Never introduce an unfiltered count
    over ``public.cron_runs`` yourself.

⭐ A HANDOVER IS A POINT EVENT, NOT AN EPISODE. Each row is inserted ALREADY
CLOSED (``status='ok'``, ``started_at`` and ``completed_at`` set to the same
instant, ``error`` null), so it never leaves a ``running`` row behind for the
``idx_cron_runs_running`` partial index or an episode reader to trip on.

⚠️ AND, LIKE THE EPISODE ROWS, IT STRETCHES THE TABLE'S STATED PURPOSE. Migration
``20260408113029_cron_heartbeat.sql`` describes heartbeat rows written by cron
jobs. These are not: they are handover events written from the lease. ⛔ Do NOT
"fix" that by editing the table's ``COMMENT`` — that is a migration, which is
precisely what this sink was chosen to avoid.

⛔ NEVER ADD ``FORCE ROW LEVEL SECURITY`` TO ``cron_runs``. The heartbeat
migration's own note calls that "the one clause under which owning a table stops
being an exemption", and it would silently drop the dormancy rows this repo's
ledger gates depend on.

⛔ WHAT MAY NEVER REACH A ROW OR A LOG LINE. No account number, login, password,
broker server, gateway host, port or terminal key. A holder is a UUID
``api_key_id`` or one of four literals (``house``, ``validation``, ``unknown``,
``unattributed``), and EVERY holder passes ``normalize_mt5_holder`` before the
insert, so anything else — a digit-only string shaped like an account number
included — is written as ``unattributed``. The site is one of a closed set and is
normalized the same way. The displaced account is never learned by reading the
terminal's own account record: that read is the extra one
``mt5_session_episodes.ATTRIBUTION_LIMIT`` forbids, and it would put an account
number in memory and in logs on a PUBLIC repo.

⛔ AND IT NEVER RAISES ``Exception``. It is awaited inside the lease's
``finally``, after the lock is released. A raise there would REPLACE the body's
own exception (a caller would see a Supabase error instead of its real failure)
and, in a ``lifespan`` task, reach ``main.lifespan``'s ``_crash_handler``, which
stops the dispatch, watchdog and enqueue loops behind a green ``/health``. A
down sink must leave every lease caller observing exactly what it did before.
``asyncio.CancelledError`` is NOT an ``Exception`` and is let through.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Final

from services.db import db_execute, get_supabase, rows
from services.mt5_client import (
    HOLDER_HOUSE,
    HOLDER_UNATTRIBUTED,
    HOLDER_UNKNOWN,
    HOLDER_VALIDATION,
)

__all__ = [
    "HANDOVER_ATTRIBUTION_LIMIT",
    "HOLDER_HOUSE",
    "HOLDER_UNATTRIBUTED",
    "HOLDER_UNKNOWN",
    "HOLDER_VALIDATION",
    "MT5_TERMINAL_HANDOVER_CRON_NAME",
    "SCHEMA_VERSION",
    "SITE_BACKFILL",
    "SITE_BALANCE",
    "SITE_DERIVE",
    "SITE_HEAL",
    "SITE_HOLDINGS",
    "SITE_VALIDATE_WIZARD",
    "SITE_VALIDATE_WORKER",
    "normalize_mt5_holder",
    "record_mt5_terminal_handover",
]

# ⛔ A STDLIB logger under the `quantalyze.analytics.` prefix — the convention
# `mt5_session_episodes` and `mt5_relogin` use: a module-scope `structlog` proxy
# freezes the processor list at import time and carries the unredacted chain.
logger = logging.getLogger("quantalyze.analytics.mt5_handover")

#: ⭐ THE NEW NAME. Nothing else writes it and no alert enumerates it.
MT5_TERMINAL_HANDOVER_CRON_NAME: Final[str] = "mt5_terminal_handover"

#: The metadata contract's version.
SCHEMA_VERSION: Final[int] = 1

# --------------------------------------------------------------------------- #
# The lease SITES — one per production `mt5_terminal_lease` call. A closed set:
# a site outside it is written as `unattributed`, for the same disclosure
# reason a holder outside the closed holder set is.
# --------------------------------------------------------------------------- #
SITE_DERIVE: Final[str] = "derive_broker_dailies"
SITE_BALANCE: Final[str] = "sync_trades_balance"
SITE_HOLDINGS: Final[str] = "allocator_holdings"
SITE_BACKFILL: Final[str] = "equity_backfill"
SITE_VALIDATE_WIZARD: Final[str] = "validate_wizard"
SITE_VALIDATE_WORKER: Final[str] = "validate_worker"
SITE_HEAL: Final[str] = "session_heal"

_SITES: Final[frozenset[str]] = frozenset(
    {
        SITE_DERIVE,
        SITE_BALANCE,
        SITE_HOLDINGS,
        SITE_BACKFILL,
        SITE_VALIDATE_WIZARD,
        SITE_VALIDATE_WORKER,
        SITE_HEAL,
    }
)

_HOLDER_LITERALS: Final[frozenset[str]] = frozenset(
    {HOLDER_HOUSE, HOLDER_VALIDATION, HOLDER_UNKNOWN, HOLDER_UNATTRIBUTED}
)

#: The CANONICAL hyphenated UUID shape only. ⛔ Not `uuid.UUID(...)` parsing,
#: which also accepts 32 bare hex digits — and 32 bare DIGITS — so a long
#: digit-only string would have passed as a "UUID".
_UUID_RE: Final[re.Pattern[str]] = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
)

#: ⭐ THE ATTRIBUTION LIMIT, IN THE ROW AND NOT ONLY IN THE PROSE.
HANDOVER_ATTRIBUTION_LIMIT: Final[str] = (
    "This record sees only logins THIS process made through the terminal lease. "
    "It cannot see a login made at the VNC console, the account a terminal "
    "relaunch auto-logs into (recorded as unknown), a login made by any other "
    "process or replica, or a login an abandoned session completed after its "
    "lease released (refused by the epoch guard and reported only as a "
    "WARNING). A holder is an api_key_id or a closed literal, never an account "
    "number."
)

#: The bound on the one insert. Awaited AFTER the lease released the lock, so it
#: never lengthens the terminal hold; it bounds how long the lease's caller waits
#: on a slow sink before carrying on.
_HANDOVER_RECORD_TIMEOUT_S: Final[float] = 5.0


def normalize_mt5_holder(value: object) -> str:
    """A holder as it may reach a row: a canonical lower-case UUID, or one of the
    four literals. Anything else — ``None``, a digit-only string shaped like an
    account number, free text — is ``unattributed``."""
    if not isinstance(value, str):
        return HOLDER_UNATTRIBUTED
    if value in _HOLDER_LITERALS:
        return value
    lowered = value.lower()
    if _UUID_RE.fullmatch(lowered):
        return lowered
    return HOLDER_UNATTRIBUTED


def _normalize_site(value: object) -> str:
    return value if isinstance(value, str) and value in _SITES else HOLDER_UNATTRIBUTED


async def _insert_handover_row(
    *, previous_holder: object, incoming_holder: object, site: object
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "cron_name": MT5_TERMINAL_HANDOVER_CRON_NAME,
        # ⭐ A POINT EVENT: closed at insert, never a `running` row.
        "started_at": now,
        "completed_at": now,
        "status": "ok",
        "error": None,
        # ⛔ METADATA CARRIES THIS AND NOTHING ELSE (a closed key set, pinned by
        # `tests/test_mt5_handover.py`).
        "metadata": {
            "schema_version": SCHEMA_VERSION,
            "previous_holder": normalize_mt5_holder(previous_holder),
            "incoming_holder": normalize_mt5_holder(incoming_holder),
            "site": _normalize_site(site),
            "records_account_number": False,
            "attribution_limit": HANDOVER_ATTRIBUTION_LIMIT,
        },
    }
    supabase = get_supabase()

    def _insert() -> Any:
        return supabase.table("cron_runs").insert(payload).execute()

    response = await db_execute(_insert)
    if not rows(response):
        logger.error(
            "mt5 terminal handover: the INSERT returned no rows — the record may "
            "not have landed"
        )


async def record_mt5_terminal_handover(
    *, previous_holder: str | None, incoming_holder: str | None, site: str | None
) -> None:
    """Write ONE already-closed handover row. NEVER RAISES ``Exception``.

    The body is exactly one ``try`` whose one handler catches bare
    ``Exception`` and whose handler body is exactly one nested ``try`` with a
    ``BaseException`` fallback: the shape the shared never-raises predicate
    (``tests/test_mt5_relogin.py::_heal_guard_defects``) enforces, because a
    warning's own argument evaluation can raise. ``asyncio.CancelledError`` is
    not an ``Exception`` and passes through. Everything that can fail — the
    payload build, the holder normalization, the client, the insert and its
    bound — sits inside the outer ``try``.
    """
    try:
        await asyncio.wait_for(
            _insert_handover_row(
                previous_holder=previous_holder,
                incoming_holder=incoming_holder,
                site=site,
            ),
            timeout=_HANDOVER_RECORD_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.warning(
                "mt5 terminal handover: the handover could not be recorded "
                "(exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            logger.warning(
                "mt5 terminal handover: the handover could not be recorded, and "
                "the failure could not be described"
            )
