"""Bybit ground-truth reconciliation harness (BYB-01) — read-only evidence.

WHY: #563 surfaced a Bybit fills under-fetch class, and the Amsterdam egress
that formerly blocked Bybit is now clean. Before Phase 70 stacks Deribit onto
the SHARED realized+funding -> csv_daily_returns path, this harness re-proves
Bybit ingestion correct end-to-end against exchange truth for one live key:

  1. Fills — fresh exchange fills (``fetch_raw_trades``, the exact #563 code
     path, cursor-paginated) vs DB ``trades`` by native ``execId``, classified
     by the two-stage ``diff_strategy_fills`` (PRIMARY id match; SECONDARY tuple
     match emitting ``id_drift`` — Bybit ROTATES order ids, so id_drift is
     INFORMATIONAL, never a discrepancy).
  2. Funding — fresh funding (``fetch_funding_bybit``) vs DB ``funding_fees`` by
     ``match_key`` BUCKET set / per-day sum. NEVER native-id equality: Bybit
     rotates funding transaction ids across responses.
  3. Dailies — per-key realized+funding recomputed via the production
     ``combine_realized_and_funding`` vs stored ``csv_daily_returns`` within
     1e-9 on the OVERLAPPING historical tail (anchor-to-today: the most-recent
     day may legitimately move — compare overlap only).

The harness composes the EXACT production seams so the run exercises the real
code paths; it is READ-ONLY by construction (zero INSERT/UPDATE/UPSERT/DELETE —
mechanically enforced by a grep gate) and prints a sanitized JSON verdict to
stdout. It runs later via ``railway ssh`` (Plan 67-04, orchestrator-only —
executor subagents have no railway auth / Supabase MCP).

USAGE
-----
  railway ssh "cd /app && python -m scripts.bybit_reconcile --api-key-id <uuid> [--window-days 180]"

RUNBOOK — #563 discipline
-------------------------
A fills COUNT delta is RECORDED even when zero, but a delta is only a BYB-01
BUG if it moves reconciled P&L / dailies beyond 1e-9 OR drops a funding bucket.
A clean reconciliation IS the evidence — do NOT manufacture a fix for a benign
count delta (late-arriving fills, id rotation). Verdicts:
  clean          — no true discrepancy, no id_drift
  id_drift_only  — only Bybit id rotation observed (informational)
  discrepancy    — a true fills discrepancy, a dropped funding bucket, or a
                   dailies delta >= 1e-9 on an overlapping day

EXIT CODES
----------
  0  clean or id_drift_only
  1  true discrepancy (EXCLUSIVELY — a real fills/funding/dailies disagreement)
  2  usage / env / key error (no secrets printed on any path)
  3  harness error — an unexpected failure (network, DB, ccxt). NOT a verdict;
     rerun. Kept distinct from 1 so an infra hiccup is never misread as a
     confirmed discrepancy (IN-6).
"""
from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import Any, cast

# _build_match_key is the SINGLE funding dedup axis (per-exchange bucket cadence,
# H-1099). Import the private helper from our own package rather than
# reimplementing the bucket math — the only correct way to reconcile Bybit
# funding, whose transaction ids rotate across responses.
from services.funding_fetch import _build_match_key
from services.redact import scrub_freeform_string, truncate_account_id
from scripts.deribit_ground_truth import assert_sanitized

# Bybit /v5/execution/list retains only ~7 days of raw fills. Per the #563
# finding, the Bybit fills under-fetch is a PROVIDER retention cap, NOT a P&L
# bug — dailies derive from 365d closed-PnL (which walks fine), so a 180d fills
# request over-reaches the exchange side and yields exchange_count=0 vs a large
# DB count. Clamp BOTH sides of the fills compare to this retention floor so
# they reconcile like-for-like.
BYBIT_EXECUTION_RETENTION_DAYS = 7

# PostgREST returns at most 1000 rows per response on Supabase hosted; a bare
# ``.limit(N)`` silently truncates beyond that (the first live run read exactly
# 1000 fills / 1000 funding buckets against tables holding far more). Every DB
# read below drains to completion via ``services.db.paginated_select`` — the
# same ``.range()`` idiom the production reconciliation/broker-dailies seams use.
_PAGE_SIZE = 1000


def _effective_fills_since(now: datetime, window_days: int) -> tuple[datetime, bool]:
    """Clamp the requested fills window to Bybit's ~7d execution-list retention.

    Returns ``(effective_since, was_clamped)``. A request longer than
    ``BYBIT_EXECUTION_RETENTION_DAYS`` over-reaches the exchange side (#563
    provider cap), so ``effective_since`` is the LATER of the requested window
    start and the retention floor; ``was_clamped`` is True iff the floor bit."""
    window_start = now - timedelta(days=window_days)
    floor = now - timedelta(days=BYBIT_EXECUTION_RETENTION_DAYS)
    fills_since = max(window_start, floor)
    return fills_since, fills_since > window_start


def _load_db_fills(
    supabase: Any, strategy_id: str, effective_since_iso: str
) -> list[dict[str, Any]]:
    """Drain the strategy's DB fills at/after the effective (clamped) window.

    Paginated (``.range()`` to a short page) — a bare ``.limit()`` truncated the
    read at PostgREST's 1000-row ceiling on the first live run. Ordered by the
    unique primary key ``id`` so pagination cannot skip or duplicate rows across
    page boundaries."""
    from services.db import paginated_select

    builder = (
        supabase.table("trades")
        .select(
            "id, exchange, exchange_fill_id, symbol, side, price, quantity, timestamp"
        )
        .eq("strategy_id", strategy_id)
        .eq("is_fill", True)
        .gte("timestamp", effective_since_iso)
    )
    return paginated_select(
        builder,
        order_by=(("id", False),),
        page_size=_PAGE_SIZE,
        truncation_hint="bybit_reconcile db fills",
    )


def _load_db_funding(
    supabase: Any, strategy_id: str, window_start_iso: str
) -> list[dict[str, Any]]:
    """Drain the strategy's DB funding rows over the funding window.

    Paginated; ordered by the unique primary key ``id`` (added to the projection
    solely to anchor a stable page order — the bucket/day aggregations ignore
    it)."""
    from services.db import paginated_select

    builder = (
        supabase.table("funding_fees")
        .select(
            "id, strategy_id, exchange, symbol, amount, currency, timestamp, match_key"
        )
        .eq("strategy_id", strategy_id)
        .gte("timestamp", window_start_iso)
    )
    return paginated_select(
        builder,
        order_by=(("id", False),),
        page_size=_PAGE_SIZE,
        truncation_hint="bybit_reconcile db funding",
    )


def _load_stored_dailies(
    supabase: Any, column: str, value: Any
) -> list[dict[str, Any]]:
    """Drain stored ``csv_daily_returns`` for the axis. Paginated; ordered by
    ``date`` (one row per axis per day, so a stable unique page order)."""
    from services.db import paginated_select

    builder = (
        supabase.table("csv_daily_returns")
        .select("date, daily_return")
        .eq(column, value)
    )
    return paginated_select(
        builder,
        order_by=(("date", False),),
        page_size=_PAGE_SIZE,
        truncation_hint="bybit_reconcile stored dailies",
    )

# ---------------------------------------------------------------------------
# Coercion helpers (pure, pandas-agnostic)
# ---------------------------------------------------------------------------


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _iso_day(value: Any) -> str:
    """Normalize a date-ish key to a UTC ISO calendar day (``YYYY-MM-DD``).

    Handles ``datetime`` / ``date`` and (duck-typed) ``pandas.Timestamp``
    (a ``datetime`` subclass, so caught by the first branch) as well as ISO
    strings. ``datetime`` is checked before ``date`` because it subclasses it.
    """
    if isinstance(value, datetime):
        aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def _to_dt(value: Any) -> datetime:
    """Coerce a funding-row timestamp (datetime / epoch-ms / ISO string) to an
    aware UTC datetime for ``_build_match_key`` (which requires a datetime)."""
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Dailies compare — the 1e-9 BYB-01 reconciliation definition
# ---------------------------------------------------------------------------


def compare_dailies(
    recomputed: Mapping[Any, Any],
    stored_rows: Sequence[Mapping[str, Any]],
    tol: float = 1e-9,
) -> dict[str, Any]:
    """Compare a recomputed daily-return series against stored rows within ``tol``.

    ``recomputed`` is any ``.items()``-able mapping of date-key -> return; in
    production it is the ``pd.Series`` from ``combine_realized_and_funding``
    (duck-typed so the unit tests never construct a pandas object — the local
    Python 3.14 venv segfaults on pandas ops). ``stored_rows`` are
    ``csv_daily_returns`` rows (``date`` + ``daily_return``).

    Only days present on BOTH sides enter the tolerance check — days present on
    a single side (differing windows / the anchor-to-today most-recent day that
    may legitimately move) are EXCLUDED and reported separately. ``clean`` iff
    every overlapping delta is strictly below ``tol``.
    """
    rec: dict[str, float] = {}
    for key, val in recomputed.items():
        rec[_iso_day(key)] = _as_float(val)

    stored: dict[str, float] = {}
    for row in stored_rows:
        stored[_iso_day(row["date"])] = _as_float(row["daily_return"])

    rec_days = set(rec)
    stored_days = set(stored)
    overlap = sorted(rec_days & stored_days)
    deltas = {d: abs(rec[d] - stored[d]) for d in overlap}
    beyond = sorted(d for d, delta in deltas.items() if delta >= tol)
    max_abs = max(deltas.values()) if deltas else 0.0

    return {
        "tol": tol,
        "overlap_days": len(overlap),
        "max_abs_delta": max_abs,
        "dates_beyond_tol": beyond,
        "only_in_recomputed": sorted(rec_days - stored_days),
        "only_in_stored": sorted(stored_days - rec_days),
        "clean": len(beyond) == 0,
    }


# ---------------------------------------------------------------------------
# Funding compare — by match_key bucket / per-day sum, NEVER native id
# ---------------------------------------------------------------------------


def _row_bucket_key(row: Mapping[str, Any]) -> str:
    return _build_match_key(
        str(row.get("strategy_id", "")),
        str(row.get("exchange", "")),
        str(row.get("symbol", "")),
        _to_dt(row.get("timestamp")),
    )


def _bucket_and_day_sums(
    rows: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, float], dict[str, float]]:
    buckets: dict[str, float] = {}
    by_day: dict[str, float] = {}
    for row in rows:
        amt = _as_float(row.get("amount"))
        key = _row_bucket_key(row)
        buckets[key] = buckets.get(key, 0.0) + amt
        day = _iso_day(_to_dt(row.get("timestamp")))
        by_day[day] = by_day.get(day, 0.0) + amt
    return buckets, by_day


def funding_bucket_summary(
    fresh_rows: Sequence[Mapping[str, Any]],
    db_rows: Sequence[Mapping[str, Any]],
    tol: float = 1e-9,
) -> dict[str, Any]:
    """Reconcile fresh-from-exchange funding vs DB funding by ``match_key`` bucket.

    Reconciliation axis is the deterministic per-exchange bucket
    (``_build_match_key``), NOT the native transaction id (Bybit rotates those
    across responses). A bucket present fresh-from-exchange but absent in the DB
    is the #563 dropped-funding signal (``missing_in_db``). Per-day funding sums
    are also compared so an amount disagreement within a shared bucket surfaces.
    """
    fresh_buckets, fresh_day = _bucket_and_day_sums(fresh_rows)
    db_buckets, db_day = _bucket_and_day_sums(db_rows)

    fresh_keys = set(fresh_buckets)
    db_keys = set(db_buckets)
    missing_in_db = sorted(fresh_keys - db_keys)
    extra_in_db = sorted(db_keys - fresh_keys)

    days = sorted(set(fresh_day) | set(db_day))
    per_day_delta = {d: fresh_day.get(d, 0.0) - db_day.get(d, 0.0) for d in days}
    days_beyond_tol = sorted(d for d, delta in per_day_delta.items() if abs(delta) >= tol)

    return {
        "tol": tol,
        "fresh_bucket_count": len(fresh_keys),
        "db_bucket_count": len(db_keys),
        "bucket_keys": sorted(fresh_keys),
        "missing_in_db": missing_in_db,
        "extra_in_db": extra_in_db,
        "per_day_delta": per_day_delta,
        "days_beyond_tol": days_beyond_tol,
        "clean": len(missing_in_db) == 0 and len(days_beyond_tol) == 0,
    }


# ---------------------------------------------------------------------------
# Fills projection — DB trades row -> the fill-dict shape diff_strategy_fills reads
# ---------------------------------------------------------------------------


def db_trade_to_fill(row: Mapping[str, Any]) -> dict[str, Any]:
    """Project a ``trades`` SELECT row onto the fill-dict shape
    ``services.reconciliation.diff_strategy_fills`` matches on. The native id
    column is ``trades.exchange_fill_id`` (= Bybit ``execId``); when that is
    NULL (legacy rows persisted before execId capture) the match falls back to
    the DB primary key ``id`` so the row still reconciles by a stable key. The
    ``_load_db_fills`` SELECT projects ``id`` so this fallback is LIVE (IN-7)."""
    return {
        "exchange": row.get("exchange"),
        "exchange_fill_id": row.get("exchange_fill_id") or row.get("id"),
        "symbol": row.get("symbol"),
        "side": row.get("side"),
        "price": _as_float(row.get("price")),
        "quantity": _as_float(row.get("quantity")),
        "timestamp": row.get("timestamp"),
    }


# ---------------------------------------------------------------------------
# Report assembly + verdict + sanitization
# ---------------------------------------------------------------------------

_EXIT_FOR_VERDICT: dict[str, int] = {"clean": 0, "id_drift_only": 0, "discrepancy": 1}


def compute_verdict(
    fills: Mapping[str, Any],
    funding: Mapping[str, Any],
    dailies: Mapping[str, Any],
) -> str:
    """Map the three reconciliation sections to a verdict in
    {``clean``, ``id_drift_only``, ``discrepancy``}. id_drift is informational
    (Bybit rotates ids) and never escalates past ``id_drift_only``."""
    true_disc = int(fills.get("true_discrepancy_count", 0) or 0)
    funding_dirty = not funding.get("clean", True)
    dailies_dirty = not dailies.get("clean", True)
    if true_disc > 0 or funding_dirty or dailies_dirty:
        return "discrepancy"
    if int(fills.get("id_drift_count", 0) or 0) > 0:
        return "id_drift_only"
    return "clean"


def _sanitize(obj: Any) -> Any:
    """Recursively scrub every free-form string in the report (ccxt embeds
    ``&signature=<HMAC>`` in error URLs). Non-strings pass through; dict keys
    are preserved verbatim (values sanitized)."""
    if isinstance(obj, str):
        return scrub_freeform_string(obj)
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


def _iso_or_str(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def build_report(
    *,
    api_key_id: str,
    exchange: str,
    window: tuple[Any, Any],
    fills: dict[str, Any],
    funding: dict[str, Any],
    dailies: dict[str, Any],
    dq_flags: Mapping[str, Any] | None = None,
    axis_used: str = "api_key_id",
    run_meta: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the sanitized reconciliation report + verdict + exit code.

    The raw ``api_key_id`` is masked to ``***last4`` (never echoed raw), and the
    whole structure is passed through ``_sanitize`` so no secret/HMAC material
    can reach stdout or a committed artifact. ``fills`` carries ``count_delta``
    RECORDED EVEN IF ZERO (#563 discipline)."""
    verdict = compute_verdict(fills, funding, dailies)
    start, end = window
    report: dict[str, Any] = {
        "run_meta": {
            "window_start": _iso_or_str(start),
            "window_end": _iso_or_str(end),
            "axis_used": axis_used,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            **(dict(run_meta) if run_meta else {}),
        },
        "api_key_id": truncate_account_id(str(api_key_id)),
        "exchange": exchange,
        "fills": fills,
        "funding": funding,
        "dailies": dailies,
        "dq_flags": dict(dq_flags) if dq_flags else {},
        "verdict": verdict,
        "exit_code": _EXIT_FOR_VERDICT[verdict],
    }
    # _sanitize preserves the dict container (only scrubs string leaves).
    return cast("dict[str, Any]", _sanitize(report))


# ---------------------------------------------------------------------------
# Async reconciliation main (READ-ONLY) — worker-env gated
# ---------------------------------------------------------------------------


class ReconcileUsageError(RuntimeError):
    """Usage / environment / key-selection error → exit code 2. Its message is
    masked-id only and never carries secret material."""


def _relabel(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Normalize the funding ``strategy_id`` label OUT so both sides reconcile
    on the true funding identity (exchange, symbol, time-bucket), independent of
    whichever label the producer stored under."""
    return [{**dict(r), "strategy_id": ""} for r in rows]


async def run(api_key_id: str, window_days: int) -> tuple[dict[str, Any], int]:
    """Reconcile one Bybit key against exchange ground truth, READ-ONLY.

    Composes the EXACT production seams (``fetch_raw_trades`` /
    ``fetch_funding_bybit`` / ``combine_realized_and_funding`` /
    ``diff_strategy_fills``) so the run exercises the real #563 code paths.
    Performs ZERO writes (no INSERT/UPDATE/UPSERT/DELETE) — recompute is
    in-memory only. Returns ``(sanitized_report, exit_code)``.
    """
    # Lazy imports keep the pure-logic layer (and its unit tests) free of the
    # ccxt / exchange I/O surface — mirrors scripts/deribit_ground_truth.py.
    from services.broker_dailies import combine_realized_and_funding
    from services.db import db_execute, get_supabase, one, rows
    from services.encryption import decrypt_credentials, get_kek
    from services.exchange import (
        aclose_exchange,
        create_exchange,
        fetch_account_equity_usd,
        fetch_all_trades,
        fetch_raw_trades,
        get_and_clear_last_dq_flags,
    )
    from services.funding_fetch import fetch_funding_bybit
    from services.reconciliation import diff_strategy_fills

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)
    window_start_iso = window_start.isoformat()
    window_start_ms = int(window_start.timestamp() * 1000)

    # Fills window clamp (#563 provider cap): Bybit only retains ~7d of raw
    # fills, so a longer request over-reaches. Fetch since max(window_start,
    # retention_floor) and scope the DB-fills side to the SAME effective window
    # so both sides compare like-for-like.
    fills_since, fills_window_clamped = _effective_fills_since(now, window_days)
    fills_since_ms = int(fills_since.timestamp() * 1000)
    fills_since_iso = fills_since.isoformat()

    supabase = get_supabase()
    masked_id = truncate_account_id(api_key_id)

    def _load_key() -> Any:
        # api_keys has NO strategy_id column — the relationship is
        # strategies.api_key_id -> api_keys.id (proven live: 42703 on the
        # first worker run). The strategy is resolved separately below.
        return (
            supabase.table("api_keys")
            .select(
                "id, exchange, api_key_encrypted, "
                "dek_encrypted, kek_version"
            )
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )

    key_row = one(await db_execute(_load_key))
    if key_row is None:
        raise ReconcileUsageError(f"api_key {masked_id} not found")
    if key_row.get("exchange") != "bybit":
        raise ReconcileUsageError(
            f"api_key {masked_id} exchange is not bybit "
            f"(got {key_row.get('exchange')!r})"
        )

    def _load_strategies() -> Any:
        return (
            supabase.table("strategies")
            .select("id")
            .eq("api_key_id", api_key_id)
            .execute()
        )

    strategy_rows = rows(await db_execute(_load_strategies))
    if len(strategy_rows) != 1:
        raise ReconcileUsageError(
            f"api_key {masked_id} backs {len(strategy_rows)} strategies — "
            "fills reconcile per-strategy; expected exactly 1"
        )
    strategy_id: str = str(strategy_rows[0]["id"])

    # Fails loud (InvalidToken naming the key id) on malformed rows — do NOT catch.
    api_key, api_secret, passphrase = decrypt_credentials(key_row, get_kek())
    ex = create_exchange("bybit", api_key, api_secret, passphrase)

    try:
        # ---- Fills half (mirror run_reconcile_strategy_job, clamped window) ----
        exchange_fills = await fetch_raw_trades(
            ex, strategy_id, supabase, since_ms=fills_since_ms
        )
        # Drain the per-task DQ buffer IMMEDIATELY (the #563 sync_truncated_bybit
        # signal). Recorded in the report; never persisted.
        dq_flags = get_and_clear_last_dq_flags()

        db_fill_rows = await db_execute(
            lambda: _load_db_fills(supabase, strategy_id, fills_since_iso)
        )
        report_fills = diff_strategy_fills(
            strategy_id=str(strategy_id),
            date_range=(fills_since, now),
            exchange_fills=exchange_fills,
            db_fills=[db_trade_to_fill(r) for r in db_fill_rows],
        )

        # ---- Funding half (bucket reconcile, windowed) ----
        # Second positional arg mirrors the derive_broker_dailies key-mode call
        # site (a log/match-key label only; it never scopes the exchange call —
        # job_worker.py:1761). The reconcile normalizes the label out (_relabel).
        fresh_funding = await fetch_funding_bybit(ex, api_key_id, window_start_ms)

        db_funding_rows = await db_execute(
            lambda: _load_db_funding(supabase, strategy_id, window_start_iso)
        )

        # ---- Dailies half (mirror run_derive_broker_dailies_job) ----
        equity, balance_error = await fetch_account_equity_usd(ex, "bybit")
        realized = await fetch_all_trades(ex, since_ms=None)
        funding_full = await fetch_funding_bybit(ex, api_key_id, None)
    finally:
        try:
            await aclose_exchange(ex)
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    returns, _meta = combine_realized_and_funding(
        realized, funding_full, account_balance=equity, balance_error=balance_error
    )

    # Stored dailies axis: api_key_id first (A6), fallback strategy_id.
    stored_rows = await db_execute(
        lambda: _load_stored_dailies(supabase, "api_key_id", api_key_id)
    )
    dailies_axis = "api_key_id"
    if not stored_rows:
        stored_rows = await db_execute(
            lambda: _load_stored_dailies(supabase, "strategy_id", strategy_id)
        )
        dailies_axis = "strategy_id"

    funding_summary = funding_bucket_summary(
        _relabel(fresh_funding), _relabel(db_funding_rows)
    )
    dailies_summary = compare_dailies(returns, stored_rows)

    id_drift_count = sum(
        1 for d in report_fills.discrepancies if d.get("kind") == "id_drift"
    )
    true_discrepancy_count = report_fills.discrepancy_count - id_drift_count
    exchange_count = len(exchange_fills)
    db_count = len(db_fill_rows)
    fills_section: dict[str, Any] = {
        "exchange_count": exchange_count,
        "db_count": db_count,
        # #563 discipline: RECORDED even when zero.
        "count_delta": exchange_count - db_count,
        "status": report_fills.status,
        "id_drift_count": id_drift_count,
        "true_discrepancy_count": true_discrepancy_count,
        "discrepancy_count": report_fills.discrepancy_count,
        "discrepancies": report_fills.discrepancies,
        # Fills-window clamp evidence (#563 provider cap). Both the exchange and
        # DB sides above were scoped to this effective window.
        "window_clamped": fills_window_clamped,
        "effective_since": fills_since.isoformat(),
    }
    if fills_window_clamped:
        fills_section["provider_cap_note"] = (
            "Bybit /v5/execution/list retains only ~"
            f"{BYBIT_EXECUTION_RETENTION_DAYS}d of raw fills (#563 provider cap, "
            "not a P&L bug); both the exchange and DB fills sides were clamped to "
            "effective_since for a like-for-like compare."
        )

    report = build_report(
        api_key_id=api_key_id,
        exchange="bybit",
        window=(window_start, now),
        fills=fills_section,
        funding=funding_summary,
        dailies=dailies_summary,
        dq_flags=dq_flags,
        axis_used=dailies_axis,
        run_meta={"window_days": window_days, "balance_error": balance_error},
    )
    return report, int(report["exit_code"])


def main() -> int:
    import argparse
    import asyncio
    import json

    parser = argparse.ArgumentParser(
        prog="python -m scripts.bybit_reconcile",
        description="BYB-01 read-only Bybit ground-truth reconciliation harness.",
    )
    parser.add_argument(
        "--api-key-id", required=True, help="api_keys.id (UUID) of the Bybit key"
    )
    parser.add_argument(
        "--window-days",
        type=int,
        default=180,
        help="fills/funding reconcile window in days (default 180)",
    )
    args = parser.parse_args()

    try:
        report, exit_code = asyncio.run(run(args.api_key_id, args.window_days))
    except ReconcileUsageError as exc:
        # Usage/env/key error — masked-id message only, never a secret.
        print(scrub_freeform_string(str(exc)), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - scrub every free-form message
        # IN-6: an unexpected harness failure (network, DB, ccxt) is NOT a
        # verdict — return 3 ("harness error — rerun") so exit 1 stays
        # exclusively a confirmed discrepancy that `run()` deliberately returned.
        msg = str(scrub_freeform_string(f"{type(exc).__name__}: {exc}"))
        # F3 belt (parity with deribit_ground_truth): withhold rather than leak
        # if a token-like run survives the freeform scrub on this error path.
        try:
            assert_sanitized({"error": msg})
        except Exception:  # noqa: BLE001
            msg = f"{type(exc).__name__}: [error text withheld - unsanitized token detected]"
        print(msg, file=sys.stderr)
        return 3

    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
