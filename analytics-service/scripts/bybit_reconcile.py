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
  1  true discrepancy
  2  usage / env / key error (no secrets printed on any path)
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Mapping

# _build_match_key is the SINGLE funding dedup axis (per-exchange bucket cadence,
# H-1099). Import the private helper from our own package rather than
# reimplementing the bucket math — the only correct way to reconcile Bybit
# funding, whose transaction ids rotate across responses.
from services.funding_fetch import _build_match_key
from services.redact import scrub_freeform_string, truncate_account_id

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
    stored_rows: list[Mapping[str, Any]],
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
    rows: list[Mapping[str, Any]],
) -> tuple[dict[str, float], dict[str, float]]:
    buckets: dict[str, float] = {}
    by_day: dict[str, float] = {}
    for row in rows:
        amt = _as_float(row.get("amount"))
        buckets[_row_bucket_key(row)] = buckets.get(_row_bucket_key(row), 0.0) + amt
        day = _iso_day(_to_dt(row.get("timestamp")))
        by_day[day] = by_day.get(day, 0.0) + amt
    return buckets, by_day


def funding_bucket_summary(
    fresh_rows: list[Mapping[str, Any]],
    db_rows: list[Mapping[str, Any]],
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
    column is ``trades.exchange_fill_id`` (= Bybit ``execId``)."""
    qty = row.get("quantity")
    if qty is None:
        qty = row.get("amount")
    return {
        "exchange": row.get("exchange"),
        "exchange_fill_id": row.get("exchange_fill_id") or row.get("id"),
        "symbol": row.get("symbol"),
        "side": row.get("side"),
        "price": _as_float(row.get("price")),
        "quantity": _as_float(qty),
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
    return _sanitize(report)
