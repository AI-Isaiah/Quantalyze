import asyncio
import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Literal

import sentry_sdk
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_supabase, rows
from services.encryption import decrypt_credentials, get_kek
from services.exchange import aclose_exchange, create_exchange, fetch_all_trades, parse_since_ms, fetch_usdt_balance, validate_key_permissions, get_and_clear_last_dq_flags, EXCHANGE_CLASSES

router = APIRouter(prefix="/api", tags=["cron"])
logger = logging.getLogger("quantalyze.analytics")

# audit-2026-05-07 C-0193 — per-key validation cache.
#
# Pre-fix every cron tick (currently every 15 min) called
# `validate_key_permissions` for EVERY active api_keys row, which hits the
# exchange's /account or /apiRestrictions endpoint per key. With N keys
# that's N exchange RPCs every 15 min just to confirm "yes, still valid",
# burning the per-IP rate-limit budget against work the user already paid
# for last tick.
#
# In-memory TTL keyed by api_keys.id:
#   * miss / expired entry  -> re-validate, refresh the entry on success
#   * fresh entry           -> assume valid, skip the exchange round-trip
#
# In-memory only (no migration), so a pod restart or a deploy invalidates
# the whole cache and the next tick re-validates everything from scratch
# — that's intentional: a TTL is a budget, not a guarantee.
#
# Failures (valid=False or validator raise) are NOT cached: the next tick
# must re-attempt so a transient exchange blip doesn't pin a key into
# permanent "needs revalidation" for the TTL window.
#
# PR #257 red-team: pre-fix the TTL was 24h, which gave a user who
# revoked a key at the exchange a worst-case 24h window where the cron
# kept treating it as `is_active=True`. With a 15-minute cron cadence,
# a 1h TTL still cuts ~96% of redundant validation calls while bounding
# the staleness window to one hour — closer to the actual revocation
# detection SLA the credential-purge flow needs.
KEY_VALIDATION_TTL_SECONDS = 60 * 60  # 1h
_key_validation_cache: dict[str, float] = {}


def _validation_cache_hit(key_id: str, *, now: float | None = None) -> bool:
    """Return True if `key_id` has a fresh validation entry.

    `now` is injectable so tests can advance time deterministically without
    monkey-patching `time.monotonic`.
    """
    entry = _key_validation_cache.get(key_id)
    if entry is None:
        return False
    current = time.monotonic() if now is None else now
    return (current - entry) < KEY_VALIDATION_TTL_SECONDS


def _record_validation_success(key_id: str, *, now: float | None = None) -> None:
    """Refresh the cache entry after a successful re-validation."""
    _key_validation_cache[key_id] = time.monotonic() if now is None else now


def _invalidate_validation_cache(key_id: str) -> None:
    """Drop a key from the cache (e.g. on credential rejection)."""
    _key_validation_cache.pop(key_id, None)

# Per-key timeout in seconds
KEY_SYNC_TIMEOUT = 60
# Max concurrent keys per batch
BATCH_SIZE = 5
# Delay between batches for the same exchange (seconds)
EXCHANGE_BATCH_DELAY = 2.0
# Per-portfolio recompute timeout (seconds). A wedged compute on one
# portfolio must not block the cron tick or starve live HTTP requests
# also competing for `_compute_semaphore`.
PORTFOLIO_RECOMPUTE_TIMEOUT = 90
# Cron-internal cap on how many portfolio recomputes are in flight at
# once. `_compute_semaphore` is shared with live `POST
# /api/portfolio-analytics` traffic; if cron `asyncio.gather`s N
# portfolios it monopolises every slot and live requests stall.
# Capping cron concurrency to (shared_limit - 1) leaves at least one
# slot for interactive users.
CRON_RECOMPUTE_CONCURRENCY = 2
# Cap the number of failure entries returned in `portfolio_recomputes.failures`.
# A platform-wide Supabase outage can fail N portfolios and the unbounded
# list would otherwise bloat the response body Sentry/log aggregators
# have to store and search.
RECOMPUTE_FAILURE_CAP = 50

# NEW-C32-02: cap the `results` list in the cron response body.
# `failures` is capped but `results` was unbounded — the LARGER payload
# (one full dict per active key with per-strategy stats), scaling 1:1 with
# active keys. During a platform-wide incident this produces the exact
# unbounded body the failures cap was introduced to prevent.
# Priority: non-ok statuses first (error/timeout/partial/key_revoked), then ok.
RESULTS_CAP = 50

# NEW-C32-01: page size for IN-list fetches in the portfolio recompute cascade.
# `synced_strategy_ids` and `candidate_portfolio_ids` are unbounded — they grow
# 1:1 with active keys × strategies. PostgREST serialises the IN list into the
# URL; on a large platform book this 414s (or silently truncates) and some
# portfolios skip their recompute. Reuses the 50-id chunk size already
# documented at routers/match.py (C-retention fix) and match.py:L874.
_CRON_IN_LIST_PAGE_SIZE = 50

# Wire-format status values for a per-key sync result. Annotated on
# `_sync_single_key` / `_sync_key_with_timeout` returns so misspelled
# comparisons (`"OK"`, `"errored"`) are caught at type-check time
# before they silently misclassify a result in the summary counters.
SyncStatus = Literal[
    "ok",
    "partial",
    "key_revoked",
    "transient_failure",
    "error",
    "timeout",
    # F1: a non-ccxt exchange (sfox) whose cron ingestion path has not shipped
    # yet. Benign — NOT an error. Counted separately in the summary so a tick
    # that only "syncs" deferred keys is not misread as an idle/failed tick, and
    # so recurring deferrals never masquerade as errors in the Sentry stream.
    "deferred",
    # 2026-09-19 FANOUT-COHORT-SYNC-CONSTANT-01 / D-03 follow-up: real trades
    # were fetched and NONE were stored, so `last_sync_at` was deliberately
    # held back (see the cursor gate in `_sync_single_key`). No per-strategy
    # RPC raised, so this is neither `error` nor `partial` — but it is NOT
    # `ok` either: the key is stalled and does NOT self-resolve (it clears
    # only when a strategy on that key re-enters ALLOWED_STRATEGY_STATUSES),
    # and with the cursor pinned the `fetch_all_trades` window grows every
    # tick. Given its own bucket so the summary alarm can see it instead of
    # counting it as healthy.
    "held",
]

# Single registry mapping each `SyncStatus` to its counter key in the
# cron_sync response body. The summary counters below are DERIVED from this
# map, so a status that is registered here always reaches the response.
# `tests/test_cron_router.py::TestSyncStatusSummaryBucketCompleteness` asserts
# the registry covers every `get_args(SyncStatus)` member AND that every
# registered counter key is present in the response — a new status therefore
# cannot ship without an alarmable bucket.
SYNC_STATUS_SUMMARY_KEYS: dict[str, str] = {
    "ok": "synced",
    "partial": "partial",
    "error": "failed",
    "timeout": "timed_out",
    "key_revoked": "revoked",
    "transient_failure": "transient",
    "deferred": "deferred",
    "held": "held",
}

# Statuses that are NOT healthy and must therefore win a slot when the
# response `results` list is capped at RESULTS_CAP (see the triage in
# cron_sync). `deferred` is deliberately absent: a benign non-ccxt deferral
# is not diagnostic. `held` IS present — it names the key whose cursor is
# pinned and whose fetch window is growing every tick.
_NON_OK_STATUSES: set[str] = {
    "error",
    "timeout",
    "key_revoked",
    "transient_failure",
    "partial",
    "held",
}

# Outcome bucket for a per-portfolio recompute attempt. `in_flight` is
# distinct from `ok` so the response payload doesn't conflate "I
# computed this" with "someone else might be computing this" — alerting
# on `pr["failed"] == 0 and pr["ok"] == pr["attempted"]` would otherwise
# silently treat unfinished work as success.
RecomputeStatus = Literal["ok", "in_flight", "skipped", "failed"]

# Only these validation error codes mean "credentials are bad, deactivate the
# key." Transient codes (rate limit, network, exchange-down, unexpected) mean
# "try again next tick" — treating them as credential failure would let a 30s
# network blip permanently disable a user's key.
CREDENTIAL_REJECTION_CODES = {
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "WITHDRAW_SCOPE",
    "TRADE_SCOPE",
}

# Lifecycle statuses that may receive cron-synced trades. Syncing into an
# archived or deleted strategy can overwrite its submission snapshot and flip
# its approval-gate verdict between Submit and Approve.
#
# 164.5.1.3 SYNCADMIT (Area 2 verdict) — `private` is the owner-only TERMINAL
# status the contribution wizard finalizes to by design
# (`src/app/api/strategies/finalize-wizard/route.ts`), admitted here because
# it is terminal: an omitted `private` strategy stays dark forever, not for a
# transitional window. `rejected` and `archived` stay excluded on purpose
# (Area 1). Mirroring the ledger fan-out migration's admit set
# (`published`, `pending_review`, `private` — 20260917120000) is explicitly
# NOT the goal here. The two constants are meant to diverge, and after this
# change they differ by exactly one value: `draft`. The ledger fan-out
# excludes it for a ledger-specific reason — a draft strategy has no
# factsheet to refresh, so every job enqueued for one is worker time spent on
# nothing — and that reason does not transfer to trade sync, where a draft
# strategy's trades still need storing. That migration's own checks 9 and 10
# refuse a re-base that mirrors THIS set into the ledger; this comment is the
# other half of the same fence.
ALLOWED_STRATEGY_STATUSES = {"draft", "pending_review", "published", "private"}

# 164.5.1.4 SYNCCURSOR — the per-STRATEGY trade-sync resume marker.
#
# `_sync_single_key` STORES per strategy (`per_strategy_stored[sid]`) but
# historically RESUMED per key, from `api_keys.last_sync_at`. On a two-strategy
# key where A stores and B raises, the key cursor still advances — past the very
# window B failed on — and B's trades are stranded permanently rather than
# transiently. `supabase/migrations/20260919120000_strategy_sync_cursors.sql`
# ships the container; the two helpers below are the only place its three states
# are interpreted.
#
# ⛔ The key-level cursor and its `should_advance_cursor` gate are NOT touched by
# any of this. Holding the whole key's cursor on a partial failure would starve
# the SUCCEEDING strategies into permanent re-fetch — the symmetric defect, and
# the reason C-0198 chose to advance. This marker is purely ADDITIVE.
_STRATEGY_SYNC_CURSOR_TABLE = "strategy_sync_cursors"

# 164.5.1.4 SYNCCURSOR / WR-04 — THE OLDEST A HELD MARKER MAY PIN THE KEY'S
# FETCH WINDOW AT.
#
# ⛔ THE REGRESSION THIS CLOSES, AND IT IS A REGRESSION IN BLAST RADIUS.
# `fetch_all_trades` runs ONCE PER KEY, and `_resume_floor_ms` pins that one
# window at the EARLIEST resume point across the key's strategies. So a single
# strategy whose `sync_trades` (or whose recompute enqueue) keeps failing holds
# its marker forever and the key's window grows by one tick interval every
# tick, WITHOUT BOUND. `_sync_key_with_timeout` cancels at KEY_SYNC_TIMEOUT, and
# once the growing fetch crosses it NO strategy on that key syncs, NEITHER
# cursor advances, and the key is WEDGED — permanently, since the next tick
# asks for an even larger window and fails sooner.
#
# Pre-phase, that same failure stranded ONE strategy and left the key healthy.
# So the marker, unbounded, converts a per-strategy degradation into a
# whole-key outage. That is strictly worse than what it replaced, which is the
# one thing a purely-additive fix may not be.
#
# ⭐ THE DECISION (taken here, autonomously, and this is the reasoning).
# Clamp the marker-driven lookback to a fixed maximum age. The choice is
# between two losses and there is no third option:
#
#   * UNCAPPED — worst case: EVERY strategy on the key stops syncing, forever,
#     and no cursor advances. Unbounded, and it takes down healthy siblings.
#   * CAPPED   — worst case: the held strategy's outstanding window OLDER than
#     the cap is abandoned. Bounded, confined to the one strategy that was
#     already failing, and NO WORSE THAN PRE-PHASE, where that strategy was
#     stranded in full.
#
# The capped worst case is a strict subset of the pre-phase worst case while
# the uncapped one is a superset, so the cap is taken.
#
# ⚠️ THE ACCEPTED COST, STATED PLAINLY: a hold that never clears LOSES that
# strategy's trades older than the cap. Not "re-fetches them later" — loses
# them. That is tolerable only because a hold of this age is no longer a
# transient failure; it is a bug that needs a human, and the clamp logs a
# warning naming the strategy and the age every tick it bites so the human
# hears about it. Thirty days is chosen to sit far above any plausible venue
# or database outage (hours, not weeks) while staying well inside the fetch
# volume one key can drain within KEY_SYNC_TIMEOUT.
#
# ⛔ APPLIED ONLY TO A FLOOR THAT CAME FROM A MARKER. `_resume_floor_ms` falls
# back to the KEY cursor for any strategy ABSENT from the marker mapping, and
# that value is not a held resume point — it is pre-phase behaviour, which had
# no cap at all. Clamping it would abandon history no strategy was ever holding
# and would falsify both halves of the derivation above: the loss would NOT be
# confined to the strategy that was already failing, and the capped worst case
# would NOT be a strict subset of the pre-phase one. The read path tracks the
# provenance explicitly; see `_resume_floor_ms`.
#
# ⛔ NOT APPLIED to the full-history (`None`) resume point, deliberately. A
# marker PRESENT WITH A NULL means "this strategy has no resume point at all,
# re-fetch everything", which is the three-state contract the read path is
# built on and the correct reading for a brand-new key. Clamping it would
# silently convert "get everything" into "get the last 30 days" and lose the
# older history it was asking for. Nor is it applied to the no-eligible-
# strategies branch, which parses the KEY cursor and is pre-phase behaviour
# this phase does not touch.
MAX_MARKER_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

# 164.5.1.4 SYNCCURSOR / WR-06 — how many rows the per-row marker-write fallback
# will retry individually when the BATCHED upsert fails.
#
# The batch is one statement, so one bad row (a 23503 from a strategy deleted
# mid-tick, say) discards the marker write for EVERY strategy on the key — and
# any of those with no row yet then falls back to the key cursor and
# UNDER-fetches. The fallback re-issues the rows one at a time so a single bad
# row costs only itself.
#
# ⚠️ WHY IT IS BOUNDED AT ALL. The fallback runs inside the key's
# `KEY_SYNC_TIMEOUT` budget, on a path that is ALREADY failing. A key with a
# large fan-out could otherwise turn one batch failure into that many serial
# round-trips and convert a marker-write problem into a key-sync timeout — the
# same whole-key escalation WR-04 exists to prevent, arriving by a different
# road. Rows past the limit are NOT silently dropped: each is recorded in the
# envelope error field naming the limit, so the condition is visible.
#
# The realistic fan-out is one API key's linked strategies, typically one to
# three, so this bound is not expected to bind in practice.
_STRATEGY_CURSOR_ROW_RETRY_LIMIT = 25

# 164.5.1.4 SYNCCURSOR / WR-03 — THE ROLLOUT WINDOW IS A KNOWN, EXPECTED,
# INDEFINITE CONDITION, AND `logger.exception` IS THE WRONG VERB FOR ONE.
#
# Railway deploys this service on main CI going green. The PROD migration apply
# sits behind the `Production` environment's HUMAN reviewer gate. Between those
# two events — minutes or days, nobody controls which — the code below is live
# and `strategy_sync_cursors` DOES NOT EXIST. Every 15-minute tick then emits
# one `logger.exception` for the lookup plus one per key for the upsert, each
# with a full traceback, each landing in Sentry as a new error event.
#
# ⛔ FAIL-OPEN IS AND STAYS CORRECT — the tick degrades to the key-level cursor,
# which is exactly pre-phase behaviour. What is wrong is the NOISE: a Sentry
# feed drowned in a condition that is neither a surprise nor actionable trains
# the operator to ignore the very channel the REAL failures arrive on. So a
# missing relation is latched to ONE `logger.warning` per process naming the
# window; every other exception keeps its `logger.exception` and its traceback.
#
# ⛔ THE ENVELOPE FIELD IS NOT SUPPRESSED. `strategy_cursor_write_error` /
# `strategy_cursor_lookup_error` are still populated on EVERY affected tick, so
# the summary alarm sees the condition for as long as it lasts even though the
# log line is emitted once. Quietening the log is not the same as hiding the
# fact, and only the first is intended here.
_UNDEFINED_TABLE_SQLSTATE = "42P01"
# PostgREST answers a relation missing from its schema cache with its own
# PGRST205 rather than the raw SQLSTATE, so both spellings are ONE condition.
_UNDEFINED_TABLE_POSTGREST_CODE = "PGRST205"

# Module-level latch for the one-shot warning above. Rebound (not mutated) so a
# test can reset it with a plain assignment on the module.
_missing_cursor_table_warned = False


def _is_missing_cursor_table(exc: BaseException) -> bool:
    """True when `exc` says `strategy_sync_cursors` is not in the database.

    Three probes, widest-to-narrowest, because supabase-py surfaces PostgREST
    errors inconsistently across versions — sometimes a typed `APIError` with
    `.code`, sometimes a dict-ish payload whose text is all that survives:

      1. a `.code` attribute equal to the SQLSTATE or the PostgREST code;
      2. either code appearing anywhere in the error's text;
      3. the TABLE NAME beside a "does not exist" / "schema cache" phrase.

    ⚠️ Probe 3 is deliberately conjunctive. Matching the table name ALONE would
    classify a genuine permission denial or a constraint violation on this very
    table as "the table is missing" and downgrade a real, actionable fault to a
    one-shot warning — the exact failure this whole helper must not cause.

    ⛔ TWO EXCLUSIONS RUN FIRST, AND THEY ARE NOT LOG FIDELITY. This predicate
    is also the branch condition deciding whether WR-06's per-row fallback runs
    AT ALL: a `True` here skips it, on the sound reasoning that a missing
    relation is not a row-scoped fault. So a MIS-classification consumes the
    recovery mechanism as well as latching the log, and every strategy whose
    marker row the batch dropped then falls back to the key cursor and
    UNDER-fetches its outstanding window.

    Probed against the shipped predicate with 11 payloads. It rejects every
    permission fault correctly (42501, RLS violation, 23505). Three over-matches
    survived, all classified as "the table does not exist yet":

      * `42703` — `column "x" of relation "strategy_sync_cursors" does not
        exist`: the table name AND "does not exist", both present, both about a
        COLUMN.
      * `PGRST204` — "could not find the 'x' column of 'strategy_sync_cursors'
        in the schema cache": the most common post-apply condition there is,
        because PostgREST's schema-cache reload is asynchronous. The operator
        was told the migration had not landed when it HAD and a column was
        drifting.
      * a `42P01` naming an UNRELATED relation (a view or trigger this table
        depends on): the code probe never looked at which relation.

    A COLUMN fault is a schema-DRIFT fault, which is actionable, row-scoped and
    exactly what the per-row fallback and the traceback exist for. Excluding it
    fails in the LOUD direction, which is the one this helper is allowed to
    fail in.
    """
    blob = " ".join(
        str(part)
        for part in (
            getattr(exc, "message", None),
            getattr(exc, "details", None),
            str(exc),
        )
        if part
    ).lower()

    # EXCLUSION 1 — a COLUMN fault is never a missing table, whatever the code
    # says. 42703 and PGRST204 both satisfy probe 3's conjunct while being
    # about a column of a table that plainly EXISTS.
    if "column" in blob:
        return False

    # EXCLUSION 2 — a message that positively names a DIFFERENT relation is
    # about that relation. Deliberately narrow: it only bites when the text
    # identifies the relation, so a bare code with no text (which is why the
    # code probes exist at all) still latches the rollout-window warning and
    # WR-03 is untouched.
    named_relation = re.search(r'relation "([^"]+)" does not exist', blob)
    if named_relation and named_relation.group(1) != _STRATEGY_SYNC_CURSOR_TABLE:
        return False

    code = getattr(exc, "code", None)
    if isinstance(code, str) and code.strip().upper() in (
        _UNDEFINED_TABLE_SQLSTATE,
        _UNDEFINED_TABLE_POSTGREST_CODE,
    ):
        return True

    if (
        _UNDEFINED_TABLE_SQLSTATE.lower() in blob
        or _UNDEFINED_TABLE_POSTGREST_CODE.lower() in blob
    ):
        return True
    return _STRATEGY_SYNC_CURSOR_TABLE in blob and (
        "does not exist" in blob or "schema cache" in blob
    )


def _log_strategy_cursor_exc(exc: BaseException, msg: str, *args: Any) -> None:
    """Log a marker-table failure at the severity the CONDITION deserves.

    Missing relation -> ONE `logger.warning` per process, naming the rollout
    window. Anything else -> `logger.exception` with `msg % args`, unchanged.

    ⚠️ MUST BE CALLED FROM INSIDE AN `except` BLOCK. `logger.exception` reads
    the ACTIVE exception from `sys.exc_info()`, not from the `exc` argument, so
    calling this anywhere else would log a traceback of None (or, worse, of an
    unrelated exception still being handled further up the stack).
    """
    global _missing_cursor_table_warned

    if _is_missing_cursor_table(exc):
        if _missing_cursor_table_warned:
            return
        _missing_cursor_table_warned = True
        logger.warning(
            "cron_sync: table %s is not present in the database yet (%s) — "
            "this is the ROLLOUT WINDOW: the service deploys on CI green while "
            "the migration apply waits behind the production reviewer gate, so "
            "until the apply lands every tick falls back to the key-level "
            "cursor (pre-phase behaviour, no data loss). Logged ONCE per "
            "process; the per-tick envelope still carries the error field "
            "every time. If this outlives the migration apply it is a REAL "
            "fault and the envelope field is where to see it",
            _STRATEGY_SYNC_CURSOR_TABLE,
            type(exc).__name__,
        )
        return

    logger.exception(msg, *args)


def _strategy_resume_point(
    strategy_id: str,
    strategy_cursors: dict[str, str | None],
    key_cursor: str | None,
) -> str | None:
    """Resolve where ONE strategy should resume its trade fetch from.

    ⛔ THE MEMBERSHIP RULE, AND WHY A `.get()` IS WRONG HERE. The marker has
    THREE states and the first two are DIFFERENT (the migration says so in the
    column comment, in the database itself):

      * `strategy_id` ABSENT from the mapping -> there is no per-strategy
        information for it yet, so fall back to the KEY's own cursor. This is
        what makes the migration inert the moment it lands: no rows exist, every
        strategy falls back, and behaviour is today's byte for byte.
      * `strategy_id` PRESENT with a null value -> this strategy has no resume
        point at all and must re-fetch from the START OF HISTORY.
      * `strategy_id` PRESENT with a timestamp -> resume from there.

    A `strategy_cursors.get(strategy_id)` returns the same `None` for the first
    two, and collapsing them is not a cosmetic slip — it makes the whole fix
    INERT ON THE FIRST FAILURE, which is the common case. Trace it: strat-B's
    RPC raises, so under a `.get()`-shaped design it is given no row; the KEY
    cursor advances anyway (correctly — a sibling succeeded); the next tick
    finds no row for strat-B and falls back to that ALREADY-ADVANCED key cursor;
    strat-B is stranded exactly as before, while every "a row was written"
    assertion stays green.

    This resolver is shared by BOTH the read floor and the hold-write below, so
    the two sites cannot drift apart. Neither re-implements it.
    """
    if strategy_id in strategy_cursors:
        return strategy_cursors[strategy_id]
    return key_cursor


def _resume_floor_ms(
    strategy_ids: list[str],
    strategy_cursors: dict[str, str | None],
    key_cursor: str | None,
    *,
    now_ms: int | None = None,
    clamp_report: dict[str, Any] | None = None,
) -> int | None:
    """The single per-key fetch window: the EARLIEST resume point across the
    eligible strategies, in epoch milliseconds, or None for "start of history".

    One `fetch_all_trades` call serves the whole key, so the window must cover
    the SLOWEST linked strategy's outstanding span — anything later silently
    drops the trades a held strategy is still owed. Over-fetching costs a
    re-store and is idempotent (`sync_trades` deletes payload-window-scoped
    before re-inserting); under-fetching loses data permanently. Every decision
    here is deliberately biased toward the first.

    With no eligible strategies the key's own cursor is parsed, preserving
    today's behaviour on a key whose fan-out is empty. A null resume point
    ANYWHERE in the set collapses the whole window to a full-history fetch, and
    an unparseable value is treated the same way as a null.

    ⚠️ `parse_since_ms` is called as the MODULE GLOBAL, by name. Existing tests
    intercept it with `patch.object(cron_mod, "parse_since_ms", ...)`; a local
    re-import or an alias would silently escape that patch.

    ⛔ WR-04: a MARKER-DERIVED floor is CLAMPED to `MAX_MARKER_LOOKBACK_MS`.
    Without it a permanently-held strategy grows this window every tick until
    the key crosses `KEY_SYNC_TIMEOUT`, at which point EVERY strategy on the key
    stops syncing — see the constant's own derivation for why a bounded loss
    confined to the already-failing strategy is taken over an unbounded
    whole-key one. `now_ms` is injectable so the clamp can be measured against a
    fixed clock; production passes nothing and reads the wall clock.

    ⛔ "MARKER-DERIVED" IS THE WHOLE OF IT, AND IT WAS NOT ALWAYS. The clamp
    was first written after the loop, unconditionally, so it clamped whatever
    the loop produced — INCLUDING the key-cursor value `_strategy_resume_point`
    falls back to for a strategy with no marker row, i.e. a strategy that has
    never held anything. MEASURED against that shape (fixed `now`, a key cursor
    200 days old, `strategy_cursors={}` — the exact state the migration lands
    in): the window was clamped to the cap and the warning named an innocent
    strategy as "holding" it, while the no-eligible-strategies branch two lines
    above returned the same key cursor UNCLAMPED. Two branches written to be
    identical pre-phase behaviour disagreed, and the clamped one was the common
    one. It is reachable in production with nothing failing anywhere:
    `reconnect_allocator_api_key` preserves `last_sync_at` across a
    disconnect/reconnect and the credential-failure `is_active=False` path
    preserves it too, so a key dormant for longer than the cap used to catch up
    in full and would have silently dropped everything older than it. The
    provenance flag is therefore load-bearing, not bookkeeping.

    ⛔ `clamp_report` IS THE CLAMP'S ONLY STRUCTURAL OUTPUT, AND IT EXISTS
    BECAUSE A LOG LINE IS NOT ONE. Every other degradation this phase can
    produce reaches the response envelope — `strategy_cursors_held`,
    `strategy_cursor_write_error`, `strategy_cursor_lookup_error`. The clamp is
    the only one that causes PERMANENT, UNRECOVERABLE loss ("fetched by no
    tick", by its own derivation) and it used to produce a `logger.warning` and
    nothing else: the tick returned success, the envelope was clean, and the
    only evidence was a line nobody greps. That is the canonical silent-failure
    shape this phase avoids everywhere else. An out-param rather than a changed
    return type, deliberately: the return value is the fetch window and every
    caller and gate reads it as `int | None`; widening it would churn them all
    to carry a field only one caller consumes. Passing nothing keeps the old
    behaviour, so the parameter cannot break a caller that does not care.
    """
    if not strategy_ids:
        return parse_since_ms(key_cursor)

    floor: int | None = None
    # Which strategy PRODUCED the floor, so a clamp warning can name it. The
    # operator's next question after "the window was clamped" is always "by
    # whom", and reconstructing that from the marker table after the fact is
    # exactly the forensics this file surfaces error fields to avoid.
    floor_sid: str | None = None
    # ⛔ WHERE THE FLOOR CAME FROM, AND THE CLAMP BELOW TURNS ON IT.
    # `_strategy_resume_point` returns either the strategy's OWN marker value
    # or, for a strategy ABSENT from the mapping, the KEY's cursor. Those are
    # different facts and only the first one may be clamped — see the clamp
    # itself for the derivation. Recorded with the SAME membership rule the
    # resolver uses (`sid in strategy_cursors`, never a `.get()`), so the two
    # readings cannot drift apart: a present-with-NULL marker has already
    # returned from inside this loop, so membership here means "this strategy
    # holds a marker timestamp".
    floor_from_marker = False
    # Every MARKER-held resume point, not just the winning one. The clamp
    # truncates the KEY's single window, so it costs every strategy holding a
    # point older than the cap — not only the one that produced the floor. The
    # warning and the envelope field both name that set, and it can only be
    # named if it is collected here. Bounded by the key's fan-out (one API
    # key's linked strategies, typically one to three), which this loop already
    # walks.
    marker_floors: dict[str, int] = {}
    for sid in strategy_ids:
        resume_point = _strategy_resume_point(sid, strategy_cursors, key_cursor)
        if resume_point is None:
            return None
        parsed = parse_since_ms(resume_point)
        if parsed is None:
            # Either a genuine null or an unparseable value — `parse_since_ms`
            # already logs the latter. Both mean "no trustworthy resume point",
            # and the safe direction is a full-history fetch.
            return None
        if sid in strategy_cursors:
            marker_floors[sid] = parsed
        if floor is None or parsed < floor:
            floor = parsed
            floor_sid = sid
            floor_from_marker = sid in strategy_cursors

    # ⚠️ NO `if floor is None: return None` GUARD HERE, deliberately. An earlier
    # draft had one and it was DEAD CODE: every path that would leave `floor`
    # unset has already returned from inside the loop, and `strategy_ids` was
    # checked non-empty above. MEASURED — mutating that guard's body produced no
    # test failure at all, which is how it was found. The `is not None` below
    # carries the type narrowing instead, on a branch that is genuinely live.
    if not floor_from_marker:
        # ⛔ THE FLOOR CAME FROM THE KEY CURSOR, SO IT IS RETURNED UNTOUCHED.
        # Every strategy here is ABSENT from the mapping, which is the state
        # the migration lands in and the state its "inert on arrival" claim is
        # about: pre-phase this path parsed the key cursor and had NO cap at
        # all. Clamping it would silently drop history no marker ever held —
        # reachable with nothing failing anywhere, because
        # `reconnect_allocator_api_key` and the credential-failure
        # deactivation both PRESERVE `last_sync_at`, so a key disconnected or
        # deactivated for longer than the cap and then reconnected used to
        # catch up in full. It would also name an innocent strategy in the
        # warning as "holding" a resume point it never held.
        return floor
    if now_ms is None:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    oldest_allowed_ms = now_ms - MAX_MARKER_LOOKBACK_MS
    if floor is not None and floor < oldest_allowed_ms:
        # ⛔ WHO ACTUALLY PAYS, AND IT IS NOT ONLY THE FLOOR-HOLDER. One
        # `fetch_all_trades` serves the whole key, so raising the window's floor
        # to the cap truncates the span of EVERY strategy whose marker sits
        # older than it. The previous wording said "that strategy's trades",
        # which under-states the loss and sends an operator looking at one row.
        truncated_sids = sorted(
            sid for sid, ms in marker_floors.items() if ms < oldest_allowed_ms
        )
        if clamp_report is not None:
            clamp_report.update(
                {
                    "cap_days": MAX_MARKER_LOOKBACK_MS / 86_400_000,
                    "floor_strategy_id": floor_sid,
                    "floor_age_days": round((now_ms - floor) / 86_400_000, 1),
                    "oldest_allowed_ms": oldest_allowed_ms,
                    "truncated_strategy_ids": truncated_sids,
                }
            )
        logger.warning(
            "cron_sync: the key's fetch window has been CLAMPED to the "
            "%.0f-day cap. The EARLIEST marker on this key is strategy %s's, "
            "%.1f day(s) old, and the window was growing every tick toward "
            "KEY_SYNC_TIMEOUT (%ds), which would have stopped EVERY strategy "
            "on this key. ⛔ The truncation is per-KEY: one fetch serves the "
            "whole key, so EVERY strategy holding a marker older than the cap "
            "loses that span — here %s. The cost is real and it is a LOSS, not "
            "a deferral: those trades will be fetched by no tick. A hold this "
            "old is not transient, it needs a human, and the same facts are in "
            "the envelope under strategy_cursor_window_clamped",
            MAX_MARKER_LOOKBACK_MS / 86_400_000,
            floor_sid,
            (now_ms - floor) / 86_400_000,
            KEY_SYNC_TIMEOUT,
            ", ".join(truncated_sids),
        )
        return oldest_allowed_ms
    return floor


async def _sync_single_key(
    key_row: dict[str, Any],
    kek: bytes,
) -> dict[str, Any]:
    """Sync a single API key: decrypt, fetch trades, store, update cursor.

    Returns a structured result dict for logging.
    """
    key_id = key_row["id"]
    exchange_name = key_row["exchange"]
    # One API key can back N strategies — the FK lives on
    # `strategies.api_key_id`, so a single `key_id` appears in the join N
    # times. `strategy_ids` is the authoritative list (each gets its own
    # `sync_trades` RPC); `strategy_id` is the primary, kept only for
    # result-payload back-compat.
    strategy_ids: list[str] = list(key_row.get("strategy_ids") or [])
    strategy_id = strategy_ids[0] if strategy_ids else None
    # 164.5.1.4 SYNCCURSOR — capture the key's PRE-TICK cursor and the
    # per-strategy marker mapping BEFORE anything runs. The `api_keys` UPDATE
    # below overwrites the stored `last_sync_at`, and the hold-write at the foot
    # of this function needs the value the tick STARTED from, not the one it
    # produced. An ABSENT `strategy_cursors` key becomes an empty mapping, which
    # under `_strategy_resume_point`'s membership rule means "every strategy
    # falls back to the key cursor" — today's behaviour exactly.
    key_cursor_at_tick_start: str | None = key_row.get("last_sync_at")
    strategy_cursors: dict[str, str | None] = dict(key_row.get("strategy_cursors") or {})
    start = time.monotonic()

    try:
        # F1: non-ccxt exchanges (sfox) have no cron ingestion path yet — their
        # live pull lands in a later phase. `create_exchange(exchange_name, …)`
        # below raises ValueError("Unsupported exchange: <x>") for anything not
        # in EXCHANGE_CLASSES, which the outer `except Exception` would log via
        # logger.exception (→ Sentry) with status="error" on EVERY 15-min tick,
        # forever, for every connected sfox key. Guard BEFORE create_exchange:
        # log at INFO (not exception) and return a benign "deferred" status that
        # the summary counts apart from real errors. The key STAYS active —
        # nothing is broken, ingestion just hasn't shipped. Generalizes to any
        # future non-ccxt venue. Placed before decrypt: the exchange is known
        # from key_row, so a deferred key needn't be decrypted at all.
        if exchange_name not in EXCHANGE_CLASSES:
            logger.info(
                "cron_sync: key %s exchange=%s has no cron ingestion path yet "
                "(deferred to a later phase) — skipping benignly, key stays active",
                key_id,
                exchange_name,
            )
            return {
                "key_id": key_id,
                "strategy_id": strategy_id,
                "strategy_ids": strategy_ids,
                "exchange": exchange_name,
                "trades_fetched": 0,
                "duration_s": round(time.monotonic() - start, 2),
                "status": "deferred",
            }

        # A key row with NULL encryption columns (malformed/seed data that
        # slipped into api_keys with is_active=true) makes decrypt_credentials
        # call `.encode()` on None → AttributeError, which surfaces to Sentry
        # as an unactionable crash every tick (QUANTALYZE-M). Detect it up
        # front and skip the key with a clean `error` status instead of letting
        # the decrypt blow up. Fail loud (status=error, logged) but don't crash.
        if not key_row.get("dek_encrypted") or not key_row.get("api_key_encrypted"):
            logger.warning(
                "cron_sync: key %s has missing/NULL encryption columns — "
                "skipping (malformed credential row, not syncing)",
                key_id,
            )
            return {
                "key_id": key_id,
                "strategy_id": strategy_id,
                "strategy_ids": strategy_ids,
                "exchange": exchange_name,
                "trades_fetched": 0,
                "duration_s": round(time.monotonic() - start, 2),
                "status": "error",
                "error": "missing_credentials",
            }

        # 164.5.1.4 SYNCCURSOR round-2 — the clamp's structural channel. Filled
        # by `_resume_floor_ms` ONLY when `MAX_MARKER_LOOKBACK_MS` actually
        # truncates the window; stays empty on every healthy tick, so the
        # envelope field below is genuinely conditional. Declared out here
        # because the fetch runs inside a `try` whose `finally` closes the
        # exchange, while the envelope is built after it.
        strategy_cursor_window_clamped: dict[str, Any] = {}

        # Decrypt credentials
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)

        try:
            # audit-2026-05-07 C-0193 — skip the exchange round-trip when a
            # recent successful validation is still within TTL. Tests use
            # `_validation_cache_hit` directly; the production path treats a
            # hit as "valid, no re-check needed."
            validation: dict[str, Any]
            if _validation_cache_hit(key_id):
                validation = {"valid": True, "error": None, "error_code": None}
            else:
                # Re-validate key permissions before syncing
                validation = await validate_key_permissions(exchange)
            if not validation["valid"]:
                error_code = validation.get("error_code")
                is_credential_failure = error_code in CREDENTIAL_REJECTION_CODES

                supabase = get_supabase()
                if is_credential_failure and strategy_id:
                    # audit-2026-05-07 C-0195 — before flipping is_active=False,
                    # check whether this key backs any allocator_holdings rows.
                    # An allocator's portfolio of holdings depends on the key
                    # staying active for the next sync window; silently flipping
                    # is_active=False breaks the allocator's holdings ingest
                    # without surfacing why. ON DELETE RESTRICT on the FK
                    # already prevents row deletion, but a soft-deactivate has
                    # the same operational effect.
                    allocator_used = False
                    try:
                        ah_result = (
                            supabase.table("allocator_holdings")
                            .select("id")
                            .eq("api_key_id", key_id)
                            .limit(1)
                            .execute()
                        )
                        allocator_used = bool(getattr(ah_result, "data", None))
                    except Exception:
                        # A Supabase blip on the linkage probe must NOT silently
                        # green-light deactivation. Fail closed: treat the key
                        # as allocator-used and skip the flip; the next tick
                        # will retry. logger.exception so the traceback reaches
                        # Sentry.
                        logger.exception(
                            "cron_sync: allocator_holdings linkage probe failed "
                            "for key %s — failing closed (skipping deactivation)",
                            key_id,
                        )
                        allocator_used = True

                    if allocator_used:
                        logger.warning(
                            "cron_sync: key %s failed validation (code=%s) but "
                            "backs allocator_holdings rows — NOT deactivating "
                            "(allocator-protected path)",
                            key_id,
                            error_code,
                        )
                        _invalidate_validation_cache(key_id)
                        return {
                            "key_id": key_id,
                            "strategy_id": strategy_id,
                            "strategy_ids": strategy_ids,
                            "exchange": exchange_name,
                            "trades_fetched": 0,
                            "duration_s": round(time.monotonic() - start, 2),
                            "status": "key_revoked",
                            "error_code": error_code,
                            "error": validation.get("error", "Key no longer valid"),
                            "allocator_protected": True,
                        }

                    logger.warning(
                        "cron_sync: key %s failed validation (code=%s): %s — deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
                    update_result = supabase.table("api_keys").update(
                        {"is_active": False}
                    ).eq("id", key_id).execute()
                    # A no-op UPDATE (row was deleted or re-keyed between
                    # the cron SELECT and now) looks identical to success
                    # in the logs unless we inspect `.data` here.
                    if not getattr(update_result, "data", None):
                        logger.error(
                            "cron_sync: deactivation no-op for key %s — row "
                            "vanished mid-tick (deleted/re-keyed by another writer)",
                            key_id,
                        )
                    _invalidate_validation_cache(key_id)
                else:
                    # Transient failure — leave is_active=True, retry next tick.
                    logger.warning(
                        "cron_sync: key %s transient validation failure (code=%s): %s — NOT deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
                    # Transient failures evict from cache so next tick
                    # re-validates instead of trusting a stale entry.
                    _invalidate_validation_cache(key_id)
                return {
                    "key_id": key_id,
                    "strategy_id": strategy_id,
                    "strategy_ids": strategy_ids,
                    "exchange": exchange_name,
                    "trades_fetched": 0,
                    "duration_s": round(time.monotonic() - start, 2),
                    "status": "key_revoked" if is_credential_failure else "transient_failure",
                    "error_code": error_code,
                    "error": validation.get("error", "Key no longer valid"),
                }

            # Cache the successful validation so subsequent ticks within the
            # TTL window can skip the exchange round-trip (C-0193).
            _record_validation_success(key_id)

            # 164.5.1.4 SYNCCURSOR — the window is the EARLIEST per-strategy
            # resume point, not the key cursor alone. With no marker rows (the
            # state the migration lands in) every strategy falls back to the key
            # cursor and the floor is exactly `parse_since_ms(last_sync_at)`.
            since_ms = _resume_floor_ms(
                strategy_ids,
                strategy_cursors,
                key_cursor_at_tick_start,
                clamp_report=strategy_cursor_window_clamped,
            )
            trades = await fetch_all_trades(exchange, since_ms=since_ms)
            # ⛔ DRAIN THE DQ FLAGS IMMEDIATELY AFTER THE AWAIT — the buffer is
            #    a per-task ContextVar and a later call on the same task would
            #    otherwise read stale flags. `services/job_worker.py` drains at
            #    the same point; the cron path never did, which is the defect
            #    below.
            #
            # ⭐ WHY THIS IS READ AT ALL. `fetch_daily_pnl`'s OUTERMOST
            #    `except Exception` logs, stamps `daily_pnl_fetch_error` and
            #    then RETURNS the partially-built list — frequently EMPTY. So
            #    an empty `trades` conflates "the venue has nothing in this
            #    window" with "the venue call crashed". That function's own
            #    comment says the flag exists precisely so a caller can tell
            #    those apart; until now this caller never looked.
            fetch_dq_flags = get_and_clear_last_dq_flags()
            fetch_degraded = bool(fetch_dq_flags.get("daily_pnl_fetch_error"))
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await aclose_exchange(exchange)

        # Store trades atomically via RPC — one call per linked strategy.
        # Each RPC is wrapped so one failing strategy does NOT abort the
        # rest of the fan-out or skip the `last_sync_at` UPDATE; otherwise
        # the next tick refetches the same trades and we lose the cursor.
        supabase = get_supabase()
        trades_stored = 0
        per_strategy_stored: dict[str, int] = {}
        strategy_errors: dict[str, str] = {}

        if trades and strategy_ids:
            for sid in strategy_ids:
                try:
                    # Pass `trades` (list[dict]) directly. Pre-serializing via
                    # json.dumps makes PostgREST cast the JSON *string* into a
                    # JSONB scalar string instead of a JSONB array, which trips
                    # sync_trades' `jsonb_array_elements(p_trades)` with 22023
                    # "cannot extract elements from a scalar". The supabase
                    # Python client serializes the request body exactly once.
                    # (Same fix already applied in routers/exchange.py and
                    # services/job_worker.py — this inline cron path was the
                    # last caller still double-encoding.)
                    rpc_result = supabase.rpc(
                        "sync_trades",
                        {"p_strategy_id": sid, "p_trades": trades},
                    ).execute()
                except Exception as rpc_exc:
                    logger.exception(
                        "cron_sync: sync_trades RPC failed for key %s strategy %s",
                        key_id,
                        sid,
                    )
                    per_strategy_stored[sid] = 0
                    strategy_errors[sid] = f"{type(rpc_exc).__name__}: {rpc_exc}"
                    continue
                if isinstance(rpc_result.data, int):
                    stored = rpc_result.data
                else:
                    # Contract drift: sync_trades is declared to return the
                    # integer row count. A dict / list / None here means the
                    # SQL function changed shape, so we have NO evidence about
                    # what landed for THIS strategy.
                    #
                    # 2026-09-19: this fell back to `stored = len(trades)`,
                    # i.e. it FABRICATED a success count from the fetch size.
                    # That number flows into `synced_count`, so any shape drift
                    # made `synced_count > 0` unconditionally and advanced
                    # `last_sync_at` on evidence that nothing was stored —
                    # reintroducing the exact C-0198 data-loss class through a
                    # side door. Counting 0 is the honest direction, and replay
                    # is safe because sync_trades does a payload-window-scoped
                    # DELETE of non-fill rows before re-INSERTing, so
                    # refetching a window does not duplicate.
                    #
                    # 2026-09-19 (later) — WHAT COUNTING 0 DOES *NOT* BUY, and
                    # what this comment wrongly claimed it did. "The cursor
                    # HOLDS and the next tick retries the same window" is true
                    # ONLY when EVERY strategy on the key drifts.
                    # `should_advance_cursor` keys off `synced_count`, which is
                    # the SUM over the whole key, so on a multi-strategy key a
                    # sibling storing successfully advances `last_sync_at` past
                    # the drifted strategy's window and those trades are lost
                    # on the next tick. One shared per-key cursor cannot
                    # express "advance for A, hold for B"; the per-strategy
                    # cursor that can is booked as Phase 164.5.1.4 SYNCCURSOR.
                    #
                    # What recording the drift in `strategy_errors` DOES buy is
                    # that the drift stops being invisible. `strategy_errors`
                    # is the only input the status classifier below has for
                    # "something went wrong", so writing it here is what turns
                    # a single-strategy drift into `error` — it was `held`, the
                    # benign bucket whose documented remedy (a strategy
                    # re-entering ALLOWED_STRATEGY_STATUSES) can never clear a
                    # SQL shape change — and a fan-out drift into `partial`
                    # naming the drifted strategy in the response body, where
                    # before it was `ok` with nothing recorded at all. It
                    # changes NO cursor behaviour: `stored` is still 0, so
                    # `synced_count` is untouched.
                    logger.error(
                        "cron_sync: sync_trades returned unexpected shape "
                        "for key %s strategy %s: %r — counting 0 stored for "
                        "this strategy and reporting it under "
                        "strategy_errors; note a sibling strategy on this key "
                        "storing successfully still advances the shared cursor "
                        "past this window",
                        key_id,
                        sid,
                        rpc_result.data,
                    )
                    stored = 0
                    strategy_errors[sid] = (
                        "ContractDrift: sync_trades returned "
                        f"{type(rpc_result.data).__name__}"
                    )
                per_strategy_stored[sid] = stored
            # `trades_stored` reflects the primary strategy for back-compat;
            # `per_strategy_stored` carries the per-strategy breakdown.
            trades_stored = (
                per_strategy_stored.get(strategy_id, 0)
                if strategy_id is not None
                else 0
            )

        # audit-2026-05-07 C-0198 — only advance `last_sync_at` when something
        # was actually stored, OR when there were no trades to store at all
        # (idle tick). The pre-fix branch advanced the cursor on EVERY return,
        # so a tick where the worker fetched trades but every per-strategy RPC
        # failed (concurrent advisory-lock contention, deadlock, etc.) would
        # silently lose those trades on the next tick because `last_sync_at`
        # already pointed past them. With this gate, a 100%-RPC-failure tick
        # leaves the cursor alone so the next tick retries the same window.
        #
        # 2026-09-19 FANOUT-COHORT-SYNC-CONSTANT-01 / D-03 — the idle-tick
        # test must be "no trades were fetched at all" (`not trades`), not
        # "nothing to store" (`not (trades and strategy_ids)`). The latter
        # also fired when `strategy_ids` was empty (no strategy on this key
        # was currently eligible), even though real trades WERE fetched —
        # the per-strategy RPC loop is itself gated on
        # `if trades and strategy_ids:`, so it never ran and
        # `per_strategy_stored` stayed `{}`, making `synced_count == 0`
        # structurally, not because anything failed. That collapsed a
        # genuinely idle tick with a tick that fetched real trades and
        # stored none, wrongly advancing the cursor and losing those trades
        # on the next tick. Dropping `bool(strategy_ids)` from the gate
        # fixes this without inventing a new gate shape: `synced_count > 0`
        # is the same disjunct C-0198 already established, and it is
        # already structurally zero whenever `strategy_ids` is empty.
        #
        # Balance updates are independent of the cursor gate — fetching the
        # USDT balance succeeded if we got here, and stashing it doesn't
        # affect trade replay semantics.
        synced_count = sum(per_strategy_stored.values())
        should_advance_cursor = (not trades) or synced_count > 0

        # 164.5.1.4 SYNCCURSOR / WR-01 — ONE instant for BOTH cursor writes.
        #
        # ⛔ THE SAMPLING POINT IS THE FIX, NOT A TIDY-UP. Until this line the
        # key cursor was stamped here and the per-strategy marker was stamped
        # AFTER the recompute-enqueue loop below, so the marker was later than
        # the key cursor by the wall-clock duration of N `enqueue_compute_job`
        # round-trips. Pre-phase that skew did not exist because there was only
        # one cursor; once markers exist they DOMINATE the resume floor
        # (`_resume_floor_ms` reads them in preference to the key cursor), so
        # the next tick would resume LATER than main would have, and anything
        # the venue booked inside that gap would be fetched by no tick, ever.
        # The gap is small but it is a permanent LOSS, not a re-fetch, which is
        # the direction this file refuses everywhere else.
        #
        # Sampling before the `api_keys` UPDATE keeps that write semantically
        # what it always was — the same instant, taken microseconds earlier —
        # while giving the marker write at the foot of this function an instant
        # that cannot drift past it.
        tick_now = datetime.now(timezone.utc).isoformat()

        update_data: dict[str, Any] = {}
        if should_advance_cursor:
            update_data["last_sync_at"] = tick_now
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        if update_data:
            supabase.table("api_keys").update(update_data).eq("id", key_id).execute()
        if not should_advance_cursor:
            if not strategy_ids:
                logger.warning(
                    "cron_sync: key %s held last_sync_at unchanged — %d "
                    "trade(s) fetched but no strategy on this key was "
                    "currently eligible to receive them; next tick will "
                    "retry the same window",
                    key_id,
                    len(trades),
                )
            else:
                logger.warning(
                    "cron_sync: key %s held last_sync_at unchanged — %d "
                    "trade(s) fetched but 0 stored across every eligible "
                    "strategy on this key; each per-strategy RPC either "
                    "raised, returned an unreadable shape, or legitimately "
                    "stored 0 rows. Next tick will retry the same window",
                    key_id,
                    len(trades),
                )

        # audit-2026-05-07 C-0197 / 2026-06-01 root-cause fix — trigger an
        # analytics recompute for strategies that received new trades.
        #
        # The pre-fix code wrote `computation_status='stale'` to
        # strategy_analytics, but that was broken two ways:
        #   (a) 'stale' is NOT in the strategy_analytics_computation_status_check
        #       CHECK constraint (only 'pending'/'computing'/'complete'/'failed'),
        #       so every write on a cron-synced strategy raised SQLSTATE 23514
        #       (Sentry QUANTALYZE-P), and
        #   (b) nothing ever READ 'stale' — the imagined "downstream analytics
        #       cron picks up stale rows and recomputes" did not exist, so
        #       cron-synced (e.g. bybit) strategies were never recomputed and
        #       their dashboard KPIs froze until a user-triggered recompute.
        #
        # The real recompute trigger is the compute_jobs queue: enqueue one
        # `derive_broker_dailies` job per strategy that got new trades — mirroring
        # the Phase-18 sync_trades follow-on at
        # services/job_worker.py::run_sync_trades_job. enqueue_compute_job is
        # dedup-safe (the partial unique index
        # compute_jobs_one_inflight_per_kind_strategy caps one in-flight
        # job per kind per strategy) and runs here as the service role,
        # so _assert_owner inside the RPC bypasses cleanly (auth.uid() IS NULL).
        # Best-effort PER STRATEGY: a transient enqueue failure for one
        # strategy must not abort the others or fail the sync — trades are
        # already persisted. Failures are logged to Sentry AND surfaced in
        # the result envelope below (`recompute_enqueue_errors`) so the
        # cron_sync summary alarm sees them rather than the failure living
        # only in Sentry.
        #
        # 164.5.1.4 SYNCCURSOR (shipped) — A FAILED ENQUEUE *IS* RE-DRIVEN BY
        # THE NEXT SYNC TICK ON THIS PATH NOW, and this note used to say the
        # opposite. What used to be true: `last_sync_at` is per-KEY and had
        # already advanced, so the next tick fetched no new trades for this
        # strategy and recomputed nothing — recovery then depended on the
        # daily/portfolio recompute cascade or a user-triggered recompute. That
        # is the Phase-18 shape described above, where cron-synced strategies
        # were never recomputed and their dashboard KPIs froze, and it is kept
        # here because it is the REASON the protection below exists.
        # What ships now: the per-strategy marker write at the foot of this
        # function carries a `sid not in recompute_enqueue_errors` conjunct, so
        # a strategy whose enqueue raised does NOT advance its own marker. Its
        # resume point holds, `_resume_floor_ms` keeps the next tick's fetch
        # window covering that span, and the enqueue is re-attempted. Both
        # re-drives are safe: `sync_trades` deletes payload-window-scoped before
        # re-inserting, and `enqueue_compute_job` is dedup-safe via the partial
        # unique index named above.
        recompute_strategy_ids = [
            sid for sid, stored in per_strategy_stored.items() if stored > 0
        ]
        recompute_enqueue_errors: dict[str, str] = {}
        # Funding-inclusive CSV route (derive_broker_dailies ->
        # compute_analytics_from_csv). MUST mirror the sync_trades epilogue
        # (job_worker.run_sync_trades_job) — otherwise this periodic re-sync
        # would overwrite the funding-inclusive factsheet with funding-EXCLUDING
        # returns on the next cron tick. The legacy trades-only compute_analytics
        # re-entry + its funding kill-switch flag were retired in 106-08.
        _recompute_kind = "derive_broker_dailies"
        for sid in recompute_strategy_ids:
            try:
                supabase.rpc(
                    "enqueue_compute_job",
                    {"p_strategy_id": sid, "p_kind": _recompute_kind},
                ).execute()
            except Exception as enq_exc:
                # logger.exception (active traceback) so the full stack reaches
                # Sentry; non-fatal — continue so one strategy's failure does
                # not starve the rest, and record it for the result envelope.
                recompute_enqueue_errors[sid] = f"{type(enq_exc).__name__}: {enq_exc}"
                logger.exception(
                    "cron_sync: failed to enqueue derive_broker_dailies for "
                    "strategy %s on key %s — analytics will lag until the daily "
                    "recompute cascade or a user-triggered recompute",
                    sid,
                    key_id,
                )

        # 164.5.1.4 SYNCCURSOR — persist the PER-STRATEGY resume point.
        #
        # ⛔ ORDERING IS A CONSTRAINT, NOT A STYLE CHOICE. This block reads
        # `recompute_enqueue_errors`, which only exists once the enqueue loop
        # above has finished. It therefore cannot move up beside the storage
        # loop; doing so would read a half-filled input and silently lose the
        # recompute-stranding half of the fix. It is the LAST write in this
        # function for that reason.
        #
        # ⭐ THE ADVANCE CONDITION IS *NOT* A PER-STRATEGY MIRROR OF
        # `should_advance_cursor`. A naive mirror (`stored > 0`) closes the
        # trade-stranding path and looks correct while leaving the
        # recompute-stranding path wide open: a strategy whose trades stored but
        # whose `derive_broker_dailies` job never got queued would advance past
        # the very window whose recompute never fired, and nothing would ever
        # re-drive it — the Phase-18 shape the enqueue loop's own comment above
        # describes, where cron-synced strategies were never recomputed and
        # their dashboard KPIs froze. The extra `sid not in
        # recompute_enqueue_errors` conjunct is what makes that re-drivable.
        #
        # ⛔ EVERY strategy in the fan-out gets a row, HELD OR ADVANCING. Writing
        # only for the strategies that advance is the single most likely way to
        # ship a change that passes a row-was-written assertion and fixes
        # nothing: the failed strategy would have no row, the next tick would
        # fall back to the key cursor that just advanced past its window, and it
        # would be stranded exactly as before. A held strategy therefore has its
        # PRE-TICK resume point written down THIS tick, resolved through the
        # same `_strategy_resume_point` the read floor uses so the two cannot
        # drift.
        #
        # One instant for every advancing strategy in a tick, so the markers a
        # single tick writes are mutually comparable — and it is the SAME
        # instant the key cursor above was stamped with (WR-01), so a marker can
        # never resume later than the key cursor it is meant to survive.
        marker_now = tick_now
        strategy_cursor_rows: list[dict[str, Any]] = []
        held_strategy_ids: list[str] = []
        for sid in strategy_ids:
            # ⛔ THE IDLE DISJUNCT IS EVIDENCE-BASED, AND IT MUST STAY THAT WAY.
            #    `not trades` is only proof that nothing is outstanding when the
            #    fetch actually SUCCEEDED and returned nothing. When
            #    `fetch_daily_pnl` swallows an exception it returns an empty
            #    list with `daily_pnl_fetch_error` set, and a bare `not trades`
            #    would then read a crashed fetch as an idle tick.
            #
            #    THE CONSEQUENCE IF THIS CONJUNCT IS DROPPED, and it is the
            #    exact loss this phase exists to close, re-entered through the
            #    new advance rule: tick 1 holds strat-B at T0 because its
            #    `sync_trades` raised. Tick 2 correctly pins the window at T0,
            #    the venue call crashes, `trades == []`, `not trades` is True,
            #    and strat-B's marker ADVANCES to now — discarding a hold of
            #    arbitrary age. Its `[T0, now)` window is then fetched by no
            #    later tick, permanently.
            #
            # ⚠️ The KEY-level `should_advance_cursor` deliberately keeps the
            #    bare `(not trades)` form and is byte-identical to main. That
            #    is not an inconsistency: the key cursor advancing is C-0198's
            #    accepted behaviour, and the whole point of the marker is to
            #    SURVIVE that advance. A marker that clears itself on the same
            #    evidence would be no marker at all.
            strategy_advances = ((not trades) and not fetch_degraded) or (
                per_strategy_stored.get(sid, 0) > 0
                and sid not in recompute_enqueue_errors
            )
            if not strategy_advances:
                held_strategy_ids.append(sid)
            strategy_cursor_rows.append(
                {
                    "strategy_id": sid,
                    "last_sync_at": (
                        marker_now
                        if strategy_advances
                        else _strategy_resume_point(
                            sid, strategy_cursors, key_cursor_at_tick_start
                        )
                    ),
                    # No trigger on this table by design (single writer), so the
                    # writer sets `updated_at` in its own payload.
                    "updated_at": marker_now,
                }
            )

        # 164.5.1.4 SYNCCURSOR — NAME the held strategies and what holding them
        # costs, once per key.
        #
        # ⭐ THIS IS AN ACCEPTED TRADEOFF MADE VISIBLE, NOT A DEFECT LEFT OPEN.
        # The marker is per-STRATEGY but `fetch_all_trades` is per-KEY and runs
        # once, so `_resume_floor_ms` takes the EARLIEST resume point across the
        # key's eligible strategies: one persistently-held strategy pins the
        # whole key's fetch window at its resume point, and the range re-fetched
        # grows every tick until the hold clears. What WOULD be a defect is the
        # degradation being invisible, inferable only from the ABSENCE of an
        # advancing row. So it is surfaced: `strategy_cursors_held` in the
        # envelope for the summary alarm, and one WARNING per key here.
        #
        # ⛔ WR-04 CORRECTION — THIS COMMENT USED TO UNDERSTATE THE COST AND THE
        # UNDERSTATEMENT WAS THE BUG. It called the growth "an efficiency cost
        # on a re-fetch that is idempotent, not a correctness or user-facing
        # loss", and cited the key-level `held` growth as precedent. Both halves
        # were wrong. The growth is UNBOUNDED, and `_sync_key_with_timeout`
        # cancels the key at KEY_SYNC_TIMEOUT, so a hold that never clears
        # eventually stops EVERY strategy on the key — a whole-key outage, which
        # is a correctness loss and a strictly WIDER blast radius than the
        # pre-phase behaviour where one strategy was stranded and the key stayed
        # healthy. It is not precedented by the key-level `held` case either:
        # that one clears as soon as any strategy becomes eligible again,
        # whereas this one has no self-clearing condition at all.
        #
        # `MAX_MARKER_LOOKBACK_MS` bounds it. The residual accepted cost is
        # therefore the honest one: a hold that never clears LOSES that
        # strategy's trades older than the cap. The hold itself is still correct
        # and still what makes a TRANSIENT failure re-drivable.
        #
        # ⛔ Deliberately NOT a new `SyncStatus` value. That vocabulary is a
        # registry the summary counters are DERIVED from, it describes the KEY's
        # outcome, and this is orthogonal to it: a key whose trades all landed
        # while one strategy's recompute enqueue failed is correctly `ok`, and a
        # key with a genuine storage failure is correctly `partial`.
        if held_strategy_ids:
            logger.warning(
                "cron_sync: key %s held the per-strategy resume point for "
                "%d of %d strategy(ies) (%s) — their windows are re-drivable "
                "next tick, and because the fetch is per-key the whole key's "
                "window stays pinned at the earliest held resume point, so the "
                "range re-fetched grows every tick until the hold clears. A "
                "hold that NEVER clears would otherwise grow the window past "
                "KEY_SYNC_TIMEOUT and wedge the WHOLE key; it is bounded by "
                "MAX_MARKER_LOOKBACK_MS, at the cost of losing that strategy's "
                "trades older than the cap",
                key_id,
                len(held_strategy_ids),
                len(strategy_ids),
                ", ".join(held_strategy_ids),
            )

        strategy_cursor_write_error: str | None = None
        if strategy_cursor_rows:
            # Plain direct-write upsert, matching the style this file already
            # uses for `api_keys` and the convention in
            # `services/job_worker.py`. ⛔ Deliberately NOT the fenced
            # `advance_sync_cursor` RPC style from that same file — CONTEXT
            # Area 2 rules it out, and harmonising the two sync-cursor
            # disciplines is a much larger change than this phase.
            try:
                supabase.table(_STRATEGY_SYNC_CURSOR_TABLE).upsert(
                    strategy_cursor_rows,
                    on_conflict="strategy_id",
                ).execute()
            except Exception as cursor_exc:
                # Never abort the tick and never discard the sync results
                # already collected.
                #
                # ⚠️ BE PRECISE ABOUT THE DIRECTION — a failed marker write is
                # NOT uniformly safe, and an early draft of this comment claimed
                # it was.
                #   * Strategy ALREADY HAS a marker row: the row stays BEHIND,
                #     the next tick over-fetches, and over-fetching is
                #     idempotent because `sync_trades` deletes scoped to the
                #     incoming payload's own timestamp range before
                #     re-inserting. Safe, as claimed.
                #   * Strategy has NO row yet (first tick after rollout, or a
                #     23503 from a concurrently-deleted sibling): the read path
                #     finds nothing, falls back to `api_keys.last_sync_at` —
                #     which THIS tick's epilogue may have just advanced past the
                #     failed window — and UNDER-fetches. That is the per-key
                #     stranding this phase exists to remove, re-entering through
                #     the error path.
                #
                # ⛔ WR-06 — ONE BAD ROW MUST NOT VOID THE REST. A multi-row
                # upsert is a single statement: a 23503 raised by ONE strategy
                # deleted mid-tick discards the marker write for EVERY strategy
                # on the key, and each of those with no row yet then UNDER-
                # fetches per the second bullet. The blast radius of an
                # unrelated sibling's deletion was the whole key.
                #
                # The previous note here said a per-strategy write "is larger
                # than this phase". That was an overstatement: the fan-out is
                # one API key's linked strategies — typically one to three — so
                # the fallback is a short bounded loop, not an architecture.
                batch_error = f"{type(cursor_exc).__name__}: {cursor_exc}"
                # WR-03: `logger.exception` for a genuine fault, ONE latched
                # `logger.warning` while the table simply has not been migrated
                # yet — otherwise the rollout window emits one traceback PER KEY
                # PER TICK for a condition nobody can act on. The envelope field
                # is populated either way.
                _log_strategy_cursor_exc(
                    cursor_exc,
                    "cron_sync: batched per-strategy sync-cursor upsert failed "
                    "for key %s (%d row(s)) — retrying row by row so one bad "
                    "row cannot void the rest",
                    key_id,
                    len(strategy_cursor_rows),
                )

                if _is_missing_cursor_table(cursor_exc):
                    # ⛔ NO PER-ROW RETRY FOR A MISSING RELATION, and this is
                    # not an optimisation. A missing table is not a per-ROW
                    # condition — every single retry would fail identically —
                    # so retrying would multiply the rollout window's wasted
                    # round-trips by the fan-out size on every key on every
                    # tick, inside a budget bounded by KEY_SYNC_TIMEOUT. The
                    # per-row loop exists for row-scoped faults; this is not
                    # one.
                    strategy_cursor_write_error = batch_error
                else:
                    per_row_errors: dict[str, str] = {}
                    attempted = strategy_cursor_rows[
                        :_STRATEGY_CURSOR_ROW_RETRY_LIMIT
                    ]
                    skipped = strategy_cursor_rows[
                        _STRATEGY_CURSOR_ROW_RETRY_LIMIT:
                    ]
                    for row in attempted:
                        try:
                            supabase.table(_STRATEGY_SYNC_CURSOR_TABLE).upsert(
                                row,
                                on_conflict="strategy_id",
                            ).execute()
                        except Exception as row_exc:
                            per_row_errors[row["strategy_id"]] = (
                                f"{type(row_exc).__name__}: {row_exc}"
                            )
                            _log_strategy_cursor_exc(
                                row_exc,
                                "cron_sync: per-row sync-cursor upsert failed "
                                "for key %s strategy %s — this strategy's "
                                "resume point is stale; if it had no row yet it "
                                "falls back to the key cursor and may "
                                "UNDER-fetch its outstanding window",
                                key_id,
                                row["strategy_id"],
                            )
                    for row in skipped:
                        per_row_errors[row["strategy_id"]] = (
                            "not retried: per-row fallback limit "
                            f"({_STRATEGY_CURSOR_ROW_RETRY_LIMIT}) reached"
                        )

                    # ⛔ THE FIELD IS POPULATED EVEN WHEN EVERY ROW RECOVERED.
                    # A batch that failed and was rescued row by row is still a
                    # degraded tick the summary alarm must be able to see —
                    # reporting only the unrecovered rows would make a
                    # persistent, worsening fault look like a healthy key right
                    # up until it stopped being recoverable.
                    recovered = len(
                        [
                            row
                            for row in attempted
                            if row["strategy_id"] not in per_row_errors
                        ]
                    )
                    if per_row_errors:
                        strategy_cursor_write_error = (
                            f"batch upsert failed ({batch_error}); per-row "
                            f"fallback recovered {recovered}/"
                            f"{len(strategy_cursor_rows)} row(s), still "
                            f"failing: {per_row_errors}"
                        )
                    else:
                        strategy_cursor_write_error = (
                            f"batch upsert failed ({batch_error}); per-row "
                            f"fallback recovered all "
                            f"{len(strategy_cursor_rows)} row(s)"
                        )

        duration = time.monotonic() - start
        # `partial` means *some* strategies landed AND *some* failed.
        # If every per-strategy RPC raised, that's `error`, not
        # `partial` — calling it partial would mislead the operator
        # into thinking trades were stored when none were.
        #
        # A tick that fetched real trades and stored NONE of them with no
        # per-strategy error recorded is `held`, NOT `ok`:
        # `should_advance_cursor` is False there, so `last_sync_at` was pinned
        # and the same window will be refetched (and will keep growing) every
        # tick until a strategy on this key becomes eligible again. Contract
        # drift is deliberately NOT one of those cases any more — it writes a
        # `strategy_errors` entry, so it lands in `error`/`partial`, whose
        # remedy is a human fixing the SQL function rather than `held`'s
        # "wait for a strategy to become eligible again", which would never
        # clear it. That is the opposite of "there was
        # nothing to do" — there WAS something to do and it was not done, so
        # it must not land in the `synced` bucket that alarms read as healthy.
        # `ok` is now only reached when the cursor actually advanced, i.e. a
        # genuinely idle tick (no trades fetched) or trades that landed.
        any_stored = any(n > 0 for n in per_strategy_stored.values())
        if strategy_errors and any_stored:
            status: SyncStatus = "partial"
        elif strategy_errors:
            status = "error"
        elif not should_advance_cursor:
            status = "held"
        else:
            status = "ok"
        result: dict[str, Any] = {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "strategy_ids": strategy_ids,
            "exchange": exchange_name,
            "trades_fetched": len(trades),
            "trades_stored": trades_stored,
            "per_strategy_stored": per_strategy_stored,
            "balance_usdt": account_balance,
            "duration_s": round(duration, 2),
            "status": status,
        }
        if strategy_errors:
            result["strategy_errors"] = strategy_errors
            # When every strategy failed, surface a top-level error too
            # for consumers that switch on `r.get("error")`.
            if status == "error":
                first_sid = next(iter(strategy_errors))
                result["error"] = strategy_errors[first_sid]
        # Surface recompute-trigger failures so the cron_sync summary sees a
        # tick where trades stored fine but the analytics recompute enqueue
        # failed (otherwise it would be indistinguishable from a healthy
        # tick — the failure would live only in Sentry). Does NOT change the
        # ok/partial/error status, which reflects trade *persistence*: the
        # trades did land; only the fire-and-forget recompute trigger failed.
        if recompute_enqueue_errors:
            result["recompute_enqueue_errors"] = recompute_enqueue_errors
        # 164.5.1.4: surface a failed marker write in the envelope for the same
        # reason `recompute_enqueue_errors` is surfaced — otherwise the failure
        # lives only in Sentry and the summary alarm cannot see that this key's
        # per-strategy resume points are stale. Does NOT change the status,
        # which reflects trade PERSISTENCE: the trades did land.
        if strategy_cursor_write_error:
            result["strategy_cursor_write_error"] = strategy_cursor_write_error
        # 164.5.1.4 SYNCCURSOR — the held set, CONDITIONALLY, in the same style
        # as `recompute_enqueue_errors` above. A tick that holds nothing adds no
        # key at all: a "conditional" field that is always present is not
        # conditional, and an always-empty list in every healthy tick's envelope
        # is noise the summary alarm would learn to ignore.
        if held_strategy_ids:
            result["strategy_cursors_held"] = held_strategy_ids
        # 164.5.1.4 SYNCCURSOR round-2 — THE CLAMP IN THE ENVELOPE, and it is
        # the finding that matters most of the three the field answers. Every
        # other degradation here is structural; the clamp is the ONLY one whose
        # loss is permanent and unrecoverable, and it was the only one visible
        # solely as a log line. A tick that clamps returns success with a clean
        # envelope otherwise — exactly the silent-failure shape this phase
        # closes everywhere else. Conditional in the same style as the fields
        # above: a healthy tick adds no key at all.
        if strategy_cursor_window_clamped:
            result["strategy_cursor_window_clamped"] = (
                strategy_cursor_window_clamped
            )
        return result

    except Exception as e:
        duration = time.monotonic() - start
        logger.exception(
            "cron_sync: key %s failed after %.1fs",
            key_id,
            duration,
        )
        return {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "strategy_ids": strategy_ids,
            "exchange": exchange_name,
            "trades_fetched": 0,
            "duration_s": round(duration, 2),
            "status": "error",
            "error": str(e),
        }


async def _sync_key_with_timeout(key_row: dict[str, Any], kek: bytes) -> dict[str, Any]:
    """Wrap _sync_single_key with a per-key timeout."""
    try:
        return await asyncio.wait_for(
            _sync_single_key(key_row, kek),
            timeout=KEY_SYNC_TIMEOUT,
        )
    except asyncio.TimeoutError:
        # `wait_for` cancels the inner coroutine, which runs the inner
        # `finally: await aclose_exchange(exchange)`. aclose_exchange
        # shields+drains ccxt's close() so the aiohttp session/connector are
        # released even under this cancellation (was Sentry QUANTALYZE-8/9/S —
        # "Unclosed connector"). Still log so a key timeout maps to a key.
        strategy_ids = list(key_row.get("strategy_ids") or [])
        logger.warning(
            "cron_sync: key %s timed out after %ds — exchange connection "
            "may have leaked (cancelled `finally` is best-effort)",
            key_row["id"],
            KEY_SYNC_TIMEOUT,
        )
        return {
            "key_id": key_row["id"],
            "strategy_id": strategy_ids[0] if strategy_ids else None,
            "strategy_ids": strategy_ids,
            "exchange": key_row.get("exchange"),
            "trades_fetched": 0,
            "duration_s": KEY_SYNC_TIMEOUT,
            "status": "timeout",
            "error": f"Timed out after {KEY_SYNC_TIMEOUT}s",
        }


@router.post("/cron-sync")
async def cron_sync() -> dict[str, Any]:
    """Daily cron endpoint: sync trades for ALL active API keys.

    - Groups keys by exchange for rate-limit awareness
    - Processes each exchange group in batches of BATCH_SIZE with asyncio.gather
    - Per-key timeout of KEY_SYNC_TIMEOUT seconds
    - Individual key failures do not stop the batch
    """
    overall_start = time.monotonic()

    try:
        kek = get_kek()
    except RuntimeError:
        # Raise 500 — the cron runner only alarms on non-2xx; a 200 body
        # with `error:` is silently treated as success and KEK outages
        # go undetected.
        logger.critical("cron_sync: KEK not configured, aborting")
        raise HTTPException(status_code=500, detail="Encryption not configured (KEK missing)")

    supabase = get_supabase()

    # Pull `status` alongside `id` so we can filter live strategies
    # in-process. PostgREST's embedded-resource filter has behaved
    # inconsistently across the supabase-py versions we ship; local
    # filtering is robust to that churn.
    try:
        keys_result = (
            supabase.table("api_keys")
            .select("*, strategies!strategies_api_key_id_fkey(id, status)")
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        logger.exception("cron_sync: initial api_keys SELECT failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail=f"cron_sync: api_keys SELECT failed: {type(exc).__name__}",
        ) from exc
    raw_keys = rows(keys_result)

    # Flatten the embed: `strategy_ids` is the full linked set (each
    # downstream `sync_trades` RPC fans out across all of them);
    # `strategy_id` is the primary, kept only for result-payload
    # back-compat. A strategy missing `status` entirely is dropped —
    # the SELECT above always pulls `status`, so a missing key signals
    # PostgREST or schema drift and we fail closed (don't sync into
    # something whose lifecycle we can't verify).
    keys = []
    for row in raw_keys:
        strategy_rel = row.pop("strategies", None)
        if isinstance(strategy_rel, list):
            entries = strategy_rel
        elif isinstance(strategy_rel, dict):
            entries = [strategy_rel]
        else:
            entries = []

        strategy_ids = [
            e["id"]
            for e in entries
            if isinstance(e, dict)
            and e.get("id")
            and e.get("status") in ALLOWED_STRATEGY_STATUSES
        ]

        row["strategy_ids"] = strategy_ids
        row["strategy_id"] = strategy_ids[0] if strategy_ids else None
        keys.append(row)

    if not keys:
        logger.info("cron_sync: no active API keys found")
        return {"synced": 0, "failed": 0, "total_keys": 0, "duration_s": 0}

    logger.info("cron_sync: found %d active API keys", len(keys))

    # 164.5.1.4 SYNCCURSOR — attach each key's PER-STRATEGY resume markers.
    #
    # This is the production source of the mapping `_sync_single_key` reads
    # through `_strategy_resume_point`. Chunked at `_CRON_IN_LIST_PAGE_SIZE`
    # using the same `in_` idiom as the portfolio lookup below: the id list is
    # unbounded (it grows 1:1 with active keys x strategies) and PostgREST
    # serialises it into the URL, so an unchunked walk risks a 414 or a silent
    # truncation — and a truncated marker read would quietly hand a strategy the
    # wrong window.
    #
    # ⭐ MEMBERSHIP IS PRESERVED THROUGH BOTH STEPS. `_cursor_by_strategy` gets an
    # entry for every row RETURNED and for no other strategy, and each key's
    # sub-mapping is restricted to its own eligible strategies the same way. A
    # strategy with no row must be ABSENT, never present-with-a-null: the two
    # mean different things (fall back to the key cursor vs re-fetch all
    # history) and only absence keeps this change inert on arrival.
    strategy_cursor_lookup_error: str | None = None
    _cursor_by_strategy: dict[str, str | None] = {}
    _marker_strategy_ids = list(
        {sid for row in keys for sid in row["strategy_ids"]}
    )
    if _marker_strategy_ids:
        try:
            for _page_start in range(
                0, len(_marker_strategy_ids), _CRON_IN_LIST_PAGE_SIZE
            ):
                _chunk = _marker_strategy_ids[
                    _page_start:_page_start + _CRON_IN_LIST_PAGE_SIZE
                ]
                _page = (
                    supabase.table(_STRATEGY_SYNC_CURSOR_TABLE)
                    .select("strategy_id, last_sync_at")
                    .in_("strategy_id", _chunk)
                    .execute()
                )
                for _marker in rows(_page):
                    _cursor_by_strategy[_marker["strategy_id"]] = _marker.get(
                        "last_sync_at"
                    )
        except Exception as exc:
            # FAIL OPEN, in the same posture as the recompute lookup below: a
            # Supabase blip here must NOT abort the tick. Every key gets an
            # empty mapping, which IS the absent-row semantics, so the tick
            # degrades to today's key-cursor-only behaviour rather than to a
            # wrong window. The error is recorded in the response body instead
            # of being raised.
            # WR-03: `logger.exception` for a genuine fault, ONE latched
            # `logger.warning` while the table simply has not been migrated
            # yet. The error field below is populated either way.
            _log_strategy_cursor_exc(
                exc,
                "cron_sync: per-strategy sync-cursor lookup failed (%s) over "
                "%d strategy id(s) — every key falls back to its key-level "
                "cursor for this tick",
                type(exc).__name__,
                len(_marker_strategy_ids),
            )
            strategy_cursor_lookup_error = f"{type(exc).__name__}: {exc}"
            _cursor_by_strategy = {}
        else:
            # ⛔ A ZERO-ROW RESULT DOES NOT RAISE, so the branch above never
            # runs for it. If SUPABASE_SERVICE_KEY ever degrades to an anon or
            # authenticated key, this table's deny-all policy answers 200 with
            # an EMPTY list rather than an error — and an empty mapping IS the
            # absent-row semantics, so every strategy silently reverts to the
            # key-level cursor. That is byte for byte the stranding defect this
            # phase exists to remove, arriving with a green tick and, without
            # the line below, no operator signal whatsoever.
            #
            # ⚠️ Zero rows is NOT by itself a fault: it is also the correct
            # reading during rollout, before any marker has been written. So
            # this reports the MEASUREMENT (requested vs returned) and does not
            # claim a diagnosis.
            if not _cursor_by_strategy:
                logger.warning(
                    "cron_sync: per-strategy sync-cursor lookup returned 0 "
                    "marker(s) for %d requested strategy id(s). Expected while "
                    "the table is still filling; once it is in service this is "
                    "also what a service-role credential degraded to anon or "
                    "authenticated looks like, since deny-all RLS answers 200 "
                    "with an empty list and raises nothing",
                    len(_marker_strategy_ids),
                )

    for row in keys:
        row["strategy_cursors"] = {
            sid: _cursor_by_strategy[sid]
            for sid in row["strategy_ids"]
            if sid in _cursor_by_strategy
        }

    # Group by exchange for rate-limit awareness
    exchange_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for key in keys:
        exchange_groups[key.get("exchange", "unknown")].append(key)

    all_results: list[dict[str, Any]] = []

    for exchange_name, group_keys in exchange_groups.items():
        logger.info(
            "cron_sync: processing %d keys for exchange %s",
            len(group_keys),
            exchange_name,
        )

        # Process in batches of BATCH_SIZE
        for i in range(0, len(group_keys), BATCH_SIZE):
            batch = group_keys[i : i + BATCH_SIZE]
            batch_results = await asyncio.gather(
                *[_sync_key_with_timeout(k, kek) for k in batch]
            )
            all_results.extend(batch_results)

            # Delay between batches for the same exchange (skip after last batch)
            if i + BATCH_SIZE < len(group_keys):
                await asyncio.sleep(EXCHANGE_BATCH_DELAY)

    # Summary — every status bucket must be counted or the cron runner's
    # alarm conditions (which watch the response body) silently misclassify
    # a tick where every key hit a transient validation failure as
    # "0 synced, 0 failed = idle" instead of "everything failed transiently."
    # Counters are DERIVED from SYNC_STATUS_SUMMARY_KEYS rather than written
    # out one `sum(...)` per status, so registering a new status is the only
    # step needed for it to appear in the body — the previous hand-written
    # block was exactly the shape where a new status silently gets no bucket.
    # F1: benign non-ccxt deferrals (e.g. sfox pre-ingestion) are counted apart
    # from `failed` so a book of only-deferred keys reads as "deferred", never
    # "error"; `held` is likewise counted apart from `synced` so a permanently
    # stalled key is never indistinguishable from a healthy one.
    status_counts: dict[str, int] = {
        summary_key: sum(1 for r in all_results if r["status"] == status)
        for status, summary_key in SYNC_STATUS_SUMMARY_KEYS.items()
    }
    synced = status_counts["synced"]
    partial = status_counts["partial"]
    failed = status_counts["failed"]
    timed_out = status_counts["timed_out"]
    revoked = status_counts["revoked"]
    transient = status_counts["transient"]
    deferred = status_counts["deferred"]
    held = status_counts["held"]
    total_trades = sum(r.get("trades_fetched", 0) for r in all_results)
    overall_duration = round(time.monotonic() - overall_start, 2)

    logger.info(
        "cron_sync complete: %d synced, %d partial, %d failed, %d timed out, "
        "%d revoked, %d transient, %d deferred, %d held, %d total trades, "
        "%.1fs total duration",
        synced,
        partial,
        failed,
        timed_out,
        revoked,
        transient,
        deferred,
        held,
        total_trades,
        overall_duration,
    )

    # Log each key result for observability
    for r in all_results:
        level = logging.INFO if r["status"] == "ok" else logging.WARNING
        logger.log(
            level,
            "cron_sync key_id=%s exchange=%s strategy=%s trades=%d "
            "duration=%.1fs status=%s%s",
            r.get("key_id"),
            r.get("exchange"),
            r.get("strategy_id"),
            r.get("trades_fetched", 0),
            r.get("duration_s", 0),
            r["status"],
            f" error={r['error']}" if r.get("error") else "",
        )

    # Recompute analytics for portfolios affected by synced strategies.
    #
    # audit-2026-05-07 G8.F.2 / FIX-LIST P164 — filter on is_test=false
    # before triggering recompute. Post-v0.4.0 pivot, allocators can
    # save what-if scenarios as is_test=true portfolios that share
    # strategy ids with their real book. Without this filter, cron
    # recomputes analytics for every scenario portfolio on every tick:
    #   * wastes compute proportional to saved-scenarios per allocator
    #   * inflates portfolio_analytics row volume
    #   * fires portfolio_alerts (rebalance drift, etc.) for hypothetical
    #     positions that nobody is monitoring
    #   * triggers email dispatches via notification_dispatches for
    #     scenario books — alert spam to the allocator's inbox
    # The Test Portfolios surface was hidden from the allocator sidebar
    # in the v0.4.0 pivot specifically because scenario books are
    # exploratory; the cron path was overlooked at that time.
    # Include `partial` keys: at least one of their per-strategy RPCs
    # succeeded, and the portfolios backed by those successful
    # strategies still need a recompute. Iterating
    # `per_strategy_stored` (instead of `strategy_ids`) restricts the
    # cascade to the strategies that actually received trades, so a
    # partial key doesn't drag its failed strategies' portfolios in.
    synced_strategy_ids = list({
        sid
        for r in all_results
        if r["status"] in ("ok", "partial")
        for sid, stored in r.get("per_strategy_stored", {}).items()
        if stored > 0
    })
    portfolio_recomputes_error: str | None = None
    if synced_strategy_ids:
        try:
            # NEW-C32-01: paginate the synced_strategy_ids IN-list.
            # An unbounded list grows 1:1 with active keys × strategies and
            # can exceed the PostgREST URL limit (HTTP 414 / silent truncation),
            # silently dropping affected portfolios from the recompute cascade.
            # match.py:L1126 already documents this hazard; same fix here.
            #
            # B19 deferred: these two loops are NOT routed through
            # services.db.chunked_in_query. The helper does the whole walk
            # internally and propagates a chunk failure, hiding the partial
            # accumulator — but the A3-03 / L-1 blast-radius contract requires
            # the except block below to log `_ps_collected = len(ps_data)` (how
            # many portfolio_ids were collected before a mid-walk DB blip). That
            # per-chunk-error-context shape is a deliberately different pattern
            # the all-or-nothing coverage helper does not model (Rule 7); forcing
            # it would either regress A3-03/L-1 or bloat the helper with a
            # single-caller partial-on-error type. The IN-list is already bounded
            # at _CRON_IN_LIST_PAGE_SIZE here, so the 414 risk is closed; only the
            # uniform coverage flag is forgone.
            ps_data: list[dict[str, Any]] = []
            for _page_start in range(0, len(synced_strategy_ids), _CRON_IN_LIST_PAGE_SIZE):
                _chunk = synced_strategy_ids[_page_start:_page_start + _CRON_IN_LIST_PAGE_SIZE]
                _page = (
                    supabase.table("portfolio_strategies")
                    .select("portfolio_id")
                    .in_("strategy_id", _chunk)
                    .execute()
                )
                ps_data.extend(rows(_page))
            candidate_portfolio_ids = list(
                set(r["portfolio_id"] for r in ps_data)
            )

            # Second round-trip filters out is_test=true portfolios. We
            # could in principle do this in one query via PostgREST's
            # embedded-resource filter, but a simple .in_() on the
            # already-deduped candidate id list is clearer and survives
            # supabase-py syntax churn.
            # NEW-C32-01 (continued): also paginate candidate_portfolio_ids.
            portfolio_ids: list[str] = []
            if candidate_portfolio_ids:
                real_data: list[dict[str, Any]] = []
                for _page_start in range(
                    0, len(candidate_portfolio_ids), _CRON_IN_LIST_PAGE_SIZE
                ):
                    _chunk = candidate_portfolio_ids[
                        _page_start:_page_start + _CRON_IN_LIST_PAGE_SIZE
                    ]
                    _page = (
                        supabase.table("portfolios")
                        .select("id")
                        .in_("id", _chunk)
                        .eq("is_test", False)
                        .execute()
                    )
                    real_data.extend(rows(_page))
                portfolio_ids = [r["id"] for r in real_data]
        except Exception as exc:
            # A Supabase blip on the recompute lookup must NOT lose the
            # per-key sync results we already collected. Record the
            # error in the response and short-circuit the recompute
            # branch instead of letting the exception propagate.
            #
            # A3-03: include page-context in the log so the blast radius is
            # visible. Pre-fix the log only showed the exception type, making
            # it impossible to determine which chunk failed and how many
            # portfolio_ids had already been successfully collected before the
            # failure — those are silently dropped when we reset to [].
            _ps_collected = len(ps_data)
            _n_strat_pages = (
                (len(synced_strategy_ids) + _CRON_IN_LIST_PAGE_SIZE - 1)
                // _CRON_IN_LIST_PAGE_SIZE
            )
            logger.exception(
                "cron_sync: recompute lookup failed (%s) — "
                "%d portfolio_ids already collected (from %d strategy pages) will be dropped; "
                "sync results preserved",
                type(exc).__name__,
                _ps_collected,
                _n_strat_pages,
            )
            portfolio_recomputes_error = f"{type(exc).__name__}: {exc}"
            portfolio_ids = []
            candidate_portfolio_ids = []

        skipped_test = len(candidate_portfolio_ids) - len(portfolio_ids)
        if skipped_test > 0:
            logger.info(
                "cron_recompute skipped %d is_test=true portfolio(s); recomputing %d real portfolio(s)",
                skipped_test,
                len(portfolio_ids),
            )

        # C-0213: reset stalled portfolio_analytics rows older than threshold before recomputing
        # audit-2026-05-07 C-0213 — reap any orphan computation_status='computing'
        # rows before the per-portfolio in-flight check below. If a previous
        # tick / pod was SIGKILL'd between the INSERT and the final UPDATE,
        # the row sits in 'computing' forever and `_guarded_recompute` would
        # otherwise classify the portfolio as `in_flight` indefinitely. The
        # reaper RPC was added in migration
        # 20260516122247_portfolio_analytics_stuck_row_reaper.sql.
        try:
            reaped = supabase.rpc(
                "reset_stalled_portfolio_analytics",
                {"p_stale_threshold": "30 minutes"},
            ).execute()
            if reaped.data:
                logger.info(
                    "cron_recompute: reaped %s stale portfolio_analytics rows",
                    reaped.data,
                )
        except Exception:
            # Non-fatal — the in-flight check will still classify the orphan
            # row as `in_flight` (not `ok`), but the user-facing 409 from
            # `POST /api/portfolio-analytics` won't auto-clear this tick.
            # Fail-loud via logger.exception so the traceback reaches Sentry
            # instead of being swallowed.
            logger.exception(
                "cron_recompute: stale-row reaper RPC failed",
            )

        # Best-effort within-process throttle via the shared
        # `_compute_semaphore` (process-local, so it does NOT prevent
        # double-compute across Vercel function instances or worker
        # pods; nor does it serialize same-pod races — the Semaphore
        # admits up to 3 coroutines concurrently and the DB-level
        # in-flight check is itself TOCTOU between SELECT and the
        # implicit INSERT inside `_compute_portfolio_analytics`).
        # A real cross-process guard would need a UNIQUE INDEX on
        # `portfolio_analytics(portfolio_id) WHERE computation_status='computing'`
        # or a Postgres advisory lock — tracked separately.
        #
        # The cron-internal `cron_recompute_sem` caps how many of the
        # shared 3 slots cron itself is allowed to hold, leaving at
        # least one slot for live `POST /api/portfolio-analytics`
        # traffic during long cron ticks.
        #
        # Per-portfolio outcomes are aggregated into the response so a
        # 100%-failure tick is not indistinguishable from a healthy one.
        #
        # Lazy import: test isolation (other test files have been
        # observed to unload `routers.portfolio` from sys.modules; see
        # test_cron_router.py TestPortfolioRecomputeErrorIsolation).
        from routers.portfolio import (
            _compute_portfolio_analytics,
            _compute_semaphore,
        )

        cron_recompute_sem = asyncio.Semaphore(CRON_RECOMPUTE_CONCURRENCY)

        async def _guarded_recompute(
            pid: str,
        ) -> tuple[str, RecomputeStatus, str | None]:
            """Acquire the cron-internal cap, then the shared
            semaphore, then check for an in-flight 'computing' row
            before recomputing. Mirrors the public POST
            /api/portfolio-analytics guard. Returns
            (portfolio_id, status, error_repr).
            """
            try:
                async with cron_recompute_sem, _compute_semaphore:
                    in_flight = (
                        supabase.table("portfolio_analytics")
                        .select("id")
                        .eq("portfolio_id", pid)
                        .eq("computation_status", "computing")
                        .limit(1)
                        .execute()
                    )
                    if in_flight.data:
                        # Distinct bucket from `ok` and `failed`: we
                        # neither computed nor crashed. Conflating
                        # this with `ok` would let a stuck "computing"
                        # row (the other worker may have died) report
                        # as success forever — exactly the silent-
                        # failure pattern this audit is closing.
                        logger.info(
                            "cron_recompute: portfolio %s already in-flight elsewhere",
                            pid,
                        )
                        return (pid, "in_flight", None)
                    await asyncio.wait_for(
                        _compute_portfolio_analytics(pid),
                        timeout=PORTFOLIO_RECOMPUTE_TIMEOUT,
                    )
                    return (pid, "ok", None)
            except asyncio.TimeoutError:
                # Capacity issue, not a logic bug — log as warning so
                # the failure bucket sees it but Sentry doesn't open a
                # ticket per portfolio.
                logger.warning(
                    "cron_recompute: portfolio %s exceeded %ds timeout",
                    pid,
                    PORTFOLIO_RECOMPUTE_TIMEOUT,
                )
                return (pid, "failed", f"TimeoutError: exceeded {PORTFOLIO_RECOMPUTE_TIMEOUT}s")
            except HTTPException as http_exc:
                # PI-07: `_compute_portfolio_analytics` raises 409 when the
                # losing racer's `computing` INSERT hits the partial UNIQUE
                # fence (portfolio_analytics_one_computing_per_portfolio) —
                # another worker holds the sole computing slot. We neither
                # computed nor crashed, so this is the EXISTING `in_flight`
                # bucket, NOT a failure. Route it BEFORE the 400-skip check.
                if http_exc.status_code == 409:
                    logger.info(
                        "cron_recompute: portfolio %s lost the computing-row "
                        "race (PI-07 fence), in-flight elsewhere",
                        pid,
                    )
                    return (pid, "in_flight", None)
                # `_compute_portfolio_analytics` raises HTTP 400 for
                # benign business states ("No strategies", "No returns
                # data") — those are *skipped*, not failures. Anything
                # else (500-level, unexpected) is a real failure.
                if http_exc.status_code == 400:
                    logger.info(
                        "cron_recompute: portfolio %s skipped (benign): %s",
                        pid,
                        http_exc.detail,
                    )
                    return (pid, "skipped", None)
                logger.exception(
                    "Portfolio recompute failed for %s (HTTPException %d)",
                    pid,
                    http_exc.status_code,
                )
                return (pid, "failed", f"HTTPException {http_exc.status_code}: {http_exc.detail}")
            except Exception as exc:
                logger.exception(
                    "Portfolio recompute failed for %s (%s)",
                    pid,
                    type(exc).__name__,
                )
                return (pid, "failed", f"{type(exc).__name__}: {exc}")

        recompute_outcomes: list[tuple[str, RecomputeStatus, str | None]] = []
        if portfolio_ids:
            recompute_outcomes = await asyncio.gather(
                *[_guarded_recompute(pid) for pid in portfolio_ids],
                return_exceptions=False,
            )

        recompute_ok = sum(1 for _, status, _ in recompute_outcomes if status == "ok")
        recompute_in_flight = sum(
            1 for _, status, _ in recompute_outcomes if status == "in_flight"
        )
        recompute_skipped = sum(
            1 for _, status, _ in recompute_outcomes if status == "skipped"
        )
        recompute_failed = sum(
            1 for _, status, _ in recompute_outcomes if status == "failed"
        )
        all_failures = [
            {"portfolio_id": pid, "error": err}
            for pid, status, err in recompute_outcomes
            if status == "failed"
        ]
        # Cap the failures list — a platform-wide outage can produce
        # thousands of entries; the cap keeps the response payload
        # usable in Sentry / log search and bounds the body size the
        # cron runner has to store.
        if len(all_failures) > RECOMPUTE_FAILURE_CAP:
            recompute_failures = all_failures[:RECOMPUTE_FAILURE_CAP]
            failures_truncated = True
        else:
            recompute_failures = all_failures
            failures_truncated = False

        portfolio_recomputes = {
            "attempted": len(recompute_outcomes),
            "ok": recompute_ok,
            "in_flight": recompute_in_flight,
            "skipped": recompute_skipped,
            "failed": recompute_failed,
            "failures": recompute_failures,
            "failures_truncated": failures_truncated,
            "total_failures": len(all_failures),
        }
        if portfolio_recomputes_error:
            portfolio_recomputes["lookup_error"] = portfolio_recomputes_error
    else:
        portfolio_recomputes = {
            "attempted": 0,
            "ok": 0,
            "in_flight": 0,
            "skipped": 0,
            "failed": 0,
            "failures": [],
            "failures_truncated": False,
            "total_failures": 0,
        }

    # NEW-C32-02: cap the results list. `all_results` scales 1:1 with active
    # keys (each entry has per-strategy stats), so a large platform-wide
    # incident produces an unbounded body — the exact scenario the
    # RECOMPUTE_FAILURE_CAP was introduced to prevent, but for a LARGER
    # payload. Prefer non-ok statuses so the body is maximally diagnostic.
    non_ok_results = [r for r in all_results if r.get("status") in _NON_OK_STATUSES]
    ok_results = [r for r in all_results if r.get("status") not in _NON_OK_STATUSES]
    if len(all_results) > RESULTS_CAP:
        # Fill cap with non-ok first, then ok results.
        capped_results = (non_ok_results + ok_results)[:RESULTS_CAP]
        results_truncated = True
    else:
        capped_results = all_results
        results_truncated = False

    response: dict[str, Any] = {
        **status_counts,
        "total_keys": len(keys),
        "total_trades": total_trades,
        "total_results": len(all_results),
        "results_truncated": results_truncated,
        "duration_s": overall_duration,
        "results": capped_results,
        "portfolio_recomputes": portfolio_recomputes,
    }
    # 164.5.1.4: the marker lookup failed open, so the tick ran on key-level
    # cursors alone. Record it beside the recompute lookup error rather than
    # raising — but record it, or a whole tick of key-only resumption looks
    # identical to a healthy one.
    if strategy_cursor_lookup_error:
        response["strategy_cursor_lookup_error"] = strategy_cursor_lookup_error
    return response


# ---------------------------------------------------------------------------
# POST /prober-cadence-alert — PROBER-CADENCE-UNDELIVERED-01 (Phase 164.1.1)
# ---------------------------------------------------------------------------
#
# The far end of the alarm `public.prod_prober_cadence_check()` posts when the
# prod-prober's last contact (a cron_runs row, cron_name='prod_prober')
# exceeds the measured ~10h25m ceiling — see supabase/migrations/
# 20260918120000_prod_prober_cadence.sql for the derivation. Landing this
# route on the existing `/api` prefix, rather than under `/internal`, is a
# DECISION, not an oversight: `/internal/*` is gated by INTERNAL_API_TOKEN, a
# credential the PROD function does not hold and would need a new Vault
# secret and a founder act to obtain, whereas `/api/*` is already guarded by
# the SERVICE_KEY middleware (main.verify_service_key) that carries
# match_engine_cron_tick()'s posts today. Zero new credentials, no carve-out.
#
# Terminal-channel decision (164.1.1-03 checkpoint, founder-measured
# 2026-09-18): SENTRY_DSN IS SET on Railway -> analytics-service ->
# production -> Variables (outcome a-sentry-already-set). The escalation
# below is therefore a rate-limited sentry_sdk capture plus a structured log
# on every occurrence, cloned from `_alert_kek_unavailable`
# (routers/internal.py). Only the variable's PRESENCE was confirmed, ever —
# never its value — and nothing in this module may claim more.
#
# ⚠️ CAVEAT THAT MUST STAY ATTACHED: delivery still depends on that Railway
# environment variable staying set, outside this repository's control. If it
# is ever unset, this escalation silently degrades to a log-only signal —
# nothing here would detect that regression. Never round this up into a
# permanent guarantee that the alarm reaches a human.


class ProberCadenceAlert(BaseModel):
    """The body `prod_prober_cadence_check()` posts. A frozen contract with
    the SQL function above — a field rename here needs a matching migration.
    """

    cron_name: str
    # Nullable, NOT optional: the SQL function sends NULL when the prober has
    # NEVER made contact (no cron_runs row exists at all) — the loudest
    # possible stale signal, and it must be ACCEPTED, not refused as
    # malformed. The key itself stays REQUIRED (no default): a body that
    # omits `gap_minutes` entirely is a producer contract violation, not the
    # never-contacted case, and gets the same 4xx as any other missing field.
    gap_minutes: int | None
    ceiling: str
    detected_at: datetime


# Bounds how often a SUSTAINED cadence alarm re-escalates to Sentry while the
# gap stays open. The structured log below fires on EVERY occurrence
# regardless of this window — only the Sentry capture is bounded, the shape
# `_alert_kek_unavailable` (routers/internal.py) already established in this
# service: an unbounded capture becomes a flood that gets muted, which is
# indistinguishable from having no signal at all.
_PROBER_CADENCE_ALERT_WINDOW_S = 3600.0
# Keyed by `alert.cron_name` — NOT a single shared timestamp. There is only
# one caller today (`prod_prober`), but `cron_name` is an unconstrained
# string and a second cadence source reusing this route would otherwise have
# an in-window escalation for cron A silently downgrade cron B's own
# Sentry-paged signal to log-only (WR-02, 164.1.1 code review).
_last_prober_cadence_alert_at: dict[str, float] = {}


def _reset_prober_cadence_alert() -> None:
    """Test-only helper to clear the escalation window between cases."""
    _last_prober_cadence_alert_at.clear()


def _escalate_prober_cadence_gap(alert: ProberCadenceAlert) -> None:
    """Log every occurrence; escalate to Sentry at most once per window.

    Shape cloned from ``_alert_kek_unavailable`` (routers/internal.py):
    ``logger.error`` BEFORE any window check — the RATE of these lines is
    itself the operator's evidence, unconditional on whether the Sentry
    capture actually fires — then ``set_tag`` before ``capture_message`` so
    events are greppable per-cause, with the whole capture wrapped in a bare
    ``try/except: pass``. A Sentry transport failure (DSN misconfigured,
    network down before the SDK connected) must never mask or crash the path
    it is reporting on; here that path is an async ``net.http_post`` on the
    database side that nothing downstream would otherwise notice failing.

    Neither the log line nor the capture may carry any credential, header
    value, or the request's own ``X-Service-Key`` — the alert body carries
    only a cron name, an integer (or null), an interval rendered as text and
    a timestamp, and nothing else may be echoed.
    """
    gap_display = "never" if alert.gap_minutes is None else str(alert.gap_minutes)
    detected_display = alert.detected_at.isoformat()
    logger.error(
        "prober_cadence_alert: cron_name=%s gap_minutes=%s ceiling=%s "
        "detected_at=%s — prod-prober contact exceeded the measured cadence "
        "ceiling",
        alert.cron_name,
        gap_display,
        alert.ceiling,
        detected_display,
    )
    now = time.monotonic()
    last_at = _last_prober_cadence_alert_at.get(alert.cron_name)
    if last_at is not None and (now - last_at) < _PROBER_CADENCE_ALERT_WINDOW_S:
        return
    _last_prober_cadence_alert_at[alert.cron_name] = now
    try:
        sentry_sdk.set_tag("prober_cadence_alert", alert.cron_name)
        sentry_sdk.capture_message(
            f"prod-prober cadence alarm: {alert.cron_name} last contact "
            f"{gap_display} min ago (ceiling {alert.ceiling}, detected "
            f"{detected_display})",
            level="error",
        )
    except Exception:
        pass  # never mask the path this is reporting on


@router.post("/prober-cadence-alert")
async def prober_cadence_alert(alert: ProberCadenceAlert) -> dict[str, Any]:
    """Receive the alert ``prod_prober_cadence_check()`` posts when the
    prod-prober's cron_runs contact goes stale, log the measurement, and
    escalate (rate-limited) per the 164.1.1-03 checkpoint outcome.

    Body validation is entirely pydantic's: ``ProberCadenceAlert`` requires
    ``cron_name``/``ceiling``/``detected_at`` and requires-but-nullable
    ``gap_minutes``, so a missing or wrongly-typed field never reaches this
    body at all — FastAPI answers 4xx before ``_escalate_prober_cadence_gap``
    ever runs, and nothing is logged for a rejected body.

    Always answers 200. ``net.http_post`` on the database side is
    fire-and-forget — no status code from this route reaches anyone — so a
    non-2xx here would add a SECOND silent failure on top of whatever the
    escalation could not deliver, rather than surfacing the first. The
    structured log line is already written by the time this returns,
    regardless of what happens next. An operator can see whether the
    database's OWN post succeeded via ``net._http_response`` on the PROD
    side — never via ``cron.job_run_details.status``. That is the kind of
    distinction the ``cron-obs`` prober arm exists to make FOR THE JOB IT
    WATCHES — but ``cron-obs`` is hardcoded to
    ``jobname = 'match_engine_cron'`` (``scripts/prod-prober/arms/cron-obs.mjs``)
    and does NOT watch this function's own posts. Today the
    ``net._http_response`` check is a MANUAL query an operator must run by
    hand, not an automated one — see ``TODOS.md``
    ``[PROBER-ALERT-DELIVERY-UNVERIFIED-01]``.
    """
    _escalate_prober_cadence_gap(alert)
    return {"acknowledged": True}
