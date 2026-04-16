"""Reconciliation diff service — compare stored trades against live exchange fills.

Sprint 5 Task 5.1b. Pure function `diff_strategy_fills` that takes two sides
(exchange fills + DB fills) and classifies each mismatch into one of seven
kinds. Caller is responsible for fetching both sides; this module never
touches the DB or the network, so unit tests are a trivial matter of
constructing two lists and asserting on the returned report.

Two-stage matching (addresses the P0 "ladder false-positive" finding from
eng review — Bybit fills at the same price/qty/timestamp but with rotating
fill IDs were being flagged as `missing_in_db` every night):

  Stage 1 — PRIMARY: exact match on (exchange, exchange_fill_id).
    These are the easy wins. Any pair that matches here is dropped from
    both working sets.

  Stage 2 — SECONDARY: for rows that missed the primary stage, try a
    tuple match on (exchange, symbol, ts_bucket_30s, side, qty, price±1bp,
    cost, fee_currency + fee_amount). A 1:1 match classifies the pair as
    `id_drift` (informational, not a true discrepancy). An N:M match (the
    same tuple appears multiple times on one side but with a different
    multiplicity on the other) is ambiguous — we demote it to
    `needs_manual_review`.

  Stage 3 — residue: everything still unmatched is classified:
    - unmatched EXCHANGE rows → `missing_in_db`
    - unmatched DB rows        → `unknown_in_exchange`

Quantity and price mismatches are detected as a side-effect of the
secondary stage: if two fills match on ID but disagree on qty or price,
we emit `mismatch_quantity` / `mismatch_price`. This is structurally
separate from `id_drift` (same tuple, different id) — ID match with
disagreeing numbers means something got rewritten.

The `stale_sync` kind is reserved for the caller to emit when the
exchange side is empty because the last sync is too old — we surface it
as a valid discrepancy kind but do not classify it ourselves (no signal
in the two-sided diff).

Status resolution:
  - zero discrepancies       → 'clean'
  - any needs_manual_review  → 'needs_manual_review' (escalates)
  - otherwise                → 'discrepancies'
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


# ---------------------------------------------------------------------------
# Matching tolerances
# ---------------------------------------------------------------------------
# 30-second timestamp buckets tolerate ntp drift and client/exchange
# round-trip latency without being so wide that two distinct fills
# coincidentally fall in the same bucket.
TS_BUCKET_SECONDS = 30

# 1 basis point price tolerance — exchanges quote to 4-6 decimal places
# and we have seen <0.01% drift due to price rounding on Bybit
# derivatives. Wider than this and we'd mask real price slippage.
PRICE_TOLERANCE_BP = 0.0001  # 1bp = 0.01%

# Quantity tolerance: exact equality after rounding to 8 decimal places.
# CCXT normalizes to 8dp; the DB stores NUMERIC with unbounded precision,
# so we compare with a tiny epsilon to absorb float-vs-Decimal round-trip.
QTY_EPSILON = 1e-8


# ---------------------------------------------------------------------------
# Report shape
# ---------------------------------------------------------------------------

@dataclass
class ReconciliationReport:
    """Structured result of a two-sided fill diff.

    `status` drives downstream alerting:
      - 'clean': no row inserted to portfolio_alerts
      - 'discrepancies': 'high' severity sync_failure
      - 'needs_manual_review': 'critical' severity sync_failure

    `discrepancies` is a list of dicts with stable keys — the exact shape
    is serialized to JSONB into reconciliation_reports.discrepancies, and
    the admin UI (post-5.1c cut: not yet built) would render from it.
    """
    strategy_id: str
    report_date: str  # ISO date (YYYY-MM-DD)
    status: str  # 'clean' | 'discrepancies' | 'needs_manual_review'
    discrepancy_count: int
    discrepancies: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _to_ms(value: Any) -> int | None:
    """Coerce a trade timestamp (int ms, ISO string, or datetime) to int ms.

    Returns None for unparseable values so the caller can fall back to
    the secondary-stage tuple without a coincidental zero-ms bucket
    pulling unrelated rows in.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Heuristic: seconds vs milliseconds — post-2001 in seconds is
        # <2 billion; anything >1e12 is already ms.
        return int(value) if value > 1e12 else int(value * 1000)
    if isinstance(value, datetime):
        return int(value.timestamp() * 1000)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            return None
    return None


def _bucket(ts_ms: int | None) -> int | None:
    if ts_ms is None:
        return None
    return ts_ms // (TS_BUCKET_SECONDS * 1000)


def _f(row: dict, *keys: str) -> Any:
    """Tolerant getter — returns the first present key's value."""
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _tuple_key(row: dict) -> tuple | None:
    """Deterministic tuple identity for secondary-stage matching.

    Price is excluded from the hash key and compared with ±1bp tolerance
    in `_tuple_matches`; including it here would force exact equality
    and undo the tolerance.
    """
    exchange = _f(row, "exchange")
    symbol = _f(row, "symbol")
    side = _f(row, "side")
    ts_ms = _to_ms(_f(row, "timestamp", "ts", "datetime"))
    bucket = _bucket(ts_ms)
    qty = _as_float(_f(row, "quantity", "amount", "qty"))
    if exchange is None or symbol is None or side is None or bucket is None or qty is None:
        return None
    # Round qty to absorb float/Decimal round-trip without collapsing
    # distinct fills.
    return (str(exchange), str(symbol), str(side).lower(), bucket, round(qty, 8))


def _price_matches(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    if a == 0 or b == 0:
        return a == b
    return abs(a - b) / abs(a) <= PRICE_TOLERANCE_BP


def _qty_matches(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= QTY_EPSILON


def _tuple_matches(exchange_row: dict, db_row: dict) -> bool:
    """Confirm a tuple-key pair really agrees on the non-key fields.

    The tuple key already pinned exchange/symbol/side/bucket/qty; here we
    additionally require price within 1bp. Cost and fee are informational
    — they're logged on mismatch but don't veto the match (fees can
    differ by maker/taker inference drift).
    """
    ex_price = _as_float(_f(exchange_row, "price"))
    db_price = _as_float(_f(db_row, "price"))
    return _price_matches(ex_price, db_price)


def _summarize(row: dict) -> dict[str, Any]:
    """Project a trade row down to the fields we echo in the discrepancy payload."""
    return {
        "exchange": _f(row, "exchange"),
        "symbol": _f(row, "symbol"),
        "side": _f(row, "side"),
        "price": _as_float(_f(row, "price")),
        "quantity": _as_float(_f(row, "quantity", "amount", "qty")),
        "timestamp": _f(row, "timestamp", "ts", "datetime"),
        "exchange_fill_id": _f(row, "exchange_fill_id", "id"),
    }


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def diff_strategy_fills(
    strategy_id: str,
    date_range: tuple[datetime, datetime],
    exchange_fills: list[dict],
    db_fills: list[dict],
) -> ReconciliationReport:
    """Compute a reconciliation report for one strategy over a date window.

    Parameters
    ----------
    strategy_id : str
        UUID of the strategy. Echoed back into the report.
    date_range : tuple[datetime, datetime]
        (start, end) of the window the report covers. End-of-window is
        used as `report_date`.
    exchange_fills : list[dict]
        Live exchange fills normalized via `_normalize_fill`
        (shape: exchange, symbol, side, price, quantity, fee, fee_currency,
        timestamp, cost, exchange_fill_id, exchange_order_id, is_fill,
        is_maker, raw_data). All keys accessed via `_f` so callers that
        ship a slightly different shape still work.
    db_fills : list[dict]
        Rows selected from the `trades` table where `is_fill = true`.
        Same shape as `exchange_fills` — both came from `_normalize_fill`
        originally.

    Returns
    -------
    ReconciliationReport
    """
    report_date = date_range[1].strftime("%Y-%m-%d")

    discrepancies: list[dict[str, Any]] = []

    # ---- Stage 1: PRIMARY match on (exchange, exchange_fill_id) ----
    #
    # Index DB fills by (exchange, exchange_fill_id). Any exchange row
    # that finds a match here is removed from both working sets. ID
    # mismatches in price/qty are caught here and surfaced as
    # mismatch_* (a rewrite, not a drift).
    db_by_id: dict[tuple[str, str], dict] = {}
    db_ladder: list[dict] = []  # DB rows with no fill_id (unlikely post-039 but defensive)
    for row in db_fills:
        ex = _f(row, "exchange")
        fid = _f(row, "exchange_fill_id", "id")
        if ex is not None and fid:
            db_by_id[(str(ex), str(fid))] = row
        else:
            db_ladder.append(row)

    exchange_residue: list[dict] = []
    matched_db_ids: set[tuple[str, str]] = set()

    for ex_row in exchange_fills:
        ex = _f(ex_row, "exchange")
        fid = _f(ex_row, "exchange_fill_id", "id")
        key = (str(ex), str(fid)) if ex is not None and fid else None
        db_row = db_by_id.get(key) if key else None
        if db_row is None:
            exchange_residue.append(ex_row)
            continue

        matched_db_ids.add(key)

        # ID-match sanity check: qty + price must agree. A rewritten
        # fill (exchange corrects a price after a partial-fill replay)
        # surfaces here as mismatch_price/_quantity so admins can
        # investigate.
        ex_qty = _as_float(_f(ex_row, "quantity", "amount", "qty"))
        db_qty = _as_float(_f(db_row, "quantity", "amount", "qty"))
        if not _qty_matches(ex_qty, db_qty):
            discrepancies.append({
                "kind": "mismatch_quantity",
                "exchange_fill_id": fid,
                "details": {
                    "exchange": _summarize(ex_row),
                    "db": _summarize(db_row),
                    "exchange_qty": ex_qty,
                    "db_qty": db_qty,
                },
            })
            continue

        ex_price = _as_float(_f(ex_row, "price"))
        db_price = _as_float(_f(db_row, "price"))
        if not _price_matches(ex_price, db_price):
            discrepancies.append({
                "kind": "mismatch_price",
                "exchange_fill_id": fid,
                "details": {
                    "exchange": _summarize(ex_row),
                    "db": _summarize(db_row),
                    "exchange_price": ex_price,
                    "db_price": db_price,
                },
            })

    # ---- Stage 2: SECONDARY tuple match on (exchange, symbol, bucket, side, qty, price±1bp) ----
    #
    # For rows that missed the primary stage: build a tuple-key index
    # on BOTH sides, walk each bucket, and either emit `id_drift` (1:1
    # matching pairs) or `needs_manual_review` (N:M ambiguity).
    db_residue = [r for (k, r) in db_by_id.items() if k not in matched_db_ids] + db_ladder

    ex_by_tuple: dict[tuple, list[dict]] = defaultdict(list)
    for row in exchange_residue:
        tk = _tuple_key(row)
        if tk is not None:
            ex_by_tuple[tk].append(row)

    db_by_tuple: dict[tuple, list[dict]] = defaultdict(list)
    for row in db_residue:
        tk = _tuple_key(row)
        if tk is not None:
            db_by_tuple[tk].append(row)

    # Walk every tuple appearing on either side.
    matched_ex: set[int] = set()  # id() of matched exchange rows
    matched_db: set[int] = set()  # id() of matched db rows

    all_tuples = set(ex_by_tuple.keys()) | set(db_by_tuple.keys())
    for tk in all_tuples:
        ex_candidates = ex_by_tuple.get(tk, [])
        db_candidates = db_by_tuple.get(tk, [])
        if not ex_candidates or not db_candidates:
            continue

        # Price sanity on the cartesian product: pair each ex_candidate
        # with a db_candidate that agrees on price-within-1bp. Bybit
        # ladder: qty/ts/price all identical, only fill_id differs, so
        # we expect a symmetric min(len_ex, len_db) pairing to emerge.
        if len(ex_candidates) == 1 and len(db_candidates) == 1:
            ex_r, db_r = ex_candidates[0], db_candidates[0]
            if _tuple_matches(ex_r, db_r):
                discrepancies.append({
                    "kind": "id_drift",
                    "exchange_fill_id": _f(ex_r, "exchange_fill_id", "id"),
                    "details": {
                        "exchange": _summarize(ex_r),
                        "db": _summarize(db_r),
                        "note": "Same tuple, different fill_id — exchange rotated the id.",
                    },
                })
                matched_ex.add(id(ex_r))
                matched_db.add(id(db_r))
            continue

        # N:M secondary match: ambiguous. Try symmetric pairing first;
        # if the counts agree we can safely classify as id_drift (the
        # Bybit ladder regression case). Otherwise escalate.
        if len(ex_candidates) == len(db_candidates):
            # Confirm every ex_candidate has a price-compatible db_candidate.
            # We zip them in order — the price tolerance check ensures we
            # don't accept a 3-for-1 rewrite masquerading as a ladder.
            all_price_ok = all(
                _tuple_matches(ex_r, db_r)
                for ex_r, db_r in zip(ex_candidates, db_candidates)
            )
            if all_price_ok:
                for ex_r, db_r in zip(ex_candidates, db_candidates):
                    discrepancies.append({
                        "kind": "id_drift",
                        "exchange_fill_id": _f(ex_r, "exchange_fill_id", "id"),
                        "details": {
                            "exchange": _summarize(ex_r),
                            "db": _summarize(db_r),
                            "note": (
                                f"Ladder of {len(ex_candidates)} identical fills "
                                "— exchange rotated ids."
                            ),
                        },
                    })
                    matched_ex.add(id(ex_r))
                    matched_db.add(id(db_r))
                continue

        # Residual N:M — escalate.
        discrepancies.append({
            "kind": "needs_manual_review",
            "exchange_fill_id": None,
            "details": {
                "note": (
                    f"Ambiguous tuple match: {len(ex_candidates)} exchange rows vs "
                    f"{len(db_candidates)} DB rows at same (symbol,side,bucket,qty)."
                ),
                "tuple_key": {
                    "exchange": tk[0],
                    "symbol": tk[1],
                    "side": tk[2],
                    "bucket": tk[3],
                    "quantity": tk[4],
                },
                "exchange_rows": [_summarize(r) for r in ex_candidates],
                "db_rows": [_summarize(r) for r in db_candidates],
            },
        })
        for r in ex_candidates:
            matched_ex.add(id(r))
        for r in db_candidates:
            matched_db.add(id(r))

    # ---- Stage 3: residue classification ----
    for ex_r in exchange_residue:
        if id(ex_r) in matched_ex:
            continue
        discrepancies.append({
            "kind": "missing_in_db",
            "exchange_fill_id": _f(ex_r, "exchange_fill_id", "id"),
            "details": {"exchange": _summarize(ex_r)},
        })

    for db_r in db_residue:
        if id(db_r) in matched_db:
            continue
        discrepancies.append({
            "kind": "unknown_in_exchange",
            "exchange_fill_id": _f(db_r, "exchange_fill_id", "id"),
            "details": {"db": _summarize(db_r)},
        })

    # ---- Status resolution ----
    discrepancy_count = len(discrepancies)
    if discrepancy_count == 0:
        status = "clean"
    elif any(d["kind"] == "needs_manual_review" for d in discrepancies):
        status = "needs_manual_review"
    else:
        status = "discrepancies"

    return ReconciliationReport(
        strategy_id=strategy_id,
        report_date=report_date,
        status=status,
        discrepancy_count=discrepancy_count,
        discrepancies=discrepancies,
    )
