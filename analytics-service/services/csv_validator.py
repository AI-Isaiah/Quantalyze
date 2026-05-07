"""
Phase 15 / CSV-01..CSV-02: pandera-backed CSV row-schema validator.

Pure-logic service. No FastAPI / no DB calls. Returns a dict envelope
with the v0 shape {ok, preview | None, errors[], correlation_id: None}.
Phase 16 / OBSERV-06 will populate correlation_id; Phase 15 leaves
None to forward-compat the call site.

Three formats supported (per CSV-02): daily_returns / daily_nav /
trades. SIX validation rules collect ALL errors at once (not
first-fail) so the user fixes once, not iteratively.

Cross-AI revision 2026-04-30 — TWO behavior changes vs iteration 1:
 1. `_check_trading_window` is REMOVED entirely. Crypto markets trade
    24/7; the prior weekend-flag would fail every real customer CSV.
    CSV-02 now covers 6 rules instead of 7.
 2. Preview rows pass through `_redact_preview` which masks values
    whose column name matches a PII regex (account | email | user |
    customer | wallet | address). Phase 18 / FIX-04 ships full
    redact.py mirroring src/lib/admin/pii-scrub.ts.
"""
from __future__ import annotations

import io
import logging
import re
from typing import Any

import pandas as pd
import pandera as pa
from pandera.errors import SchemaErrors

logger = logging.getLogger("quantalyze.analytics")

SHARPE_SENTINEL_DAILY = 10.0
DEFAULT_RISK_FREE_DAILY = 0.0

# Phase 15 PII column-name pattern. Matches column NAMES (case-insensitive)
# that historically carry user-identifying values in CSV exports. The
# match is on the column name; values are masked to '***' regardless of
# their content. Phase 18 / FIX-04 swaps this for the full redact.py
# walker that also matches by VALUE shape (JWT detector, account-id
# truncator, denylist of 8 keys). Phase 15 ships only this column-name
# defense — sufficient for preview rendering, NOT sufficient for log
# scrubbing (logs MUST not carry raw row data; see logger calls below).
_PII_COLUMN_PATTERN = re.compile(
    r"^.*(account|email|user|customer|wallet|address).*$",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Per-format pandera schemas (6 rules total).
#
# Each pa.Check carries an `error=` kwarg matching the rule keys from
# UI-SPEC §8.8 verbatim — these are the strings the React
# <CsvValidationEnvelope> in plan 15-04 maps to human labels.
# ---------------------------------------------------------------------------

# Date check: strictly increasing (monotonic AND no duplicates).
# UI label says "Dates must be strictly increasing"; the prior
# `is_monotonic_increasing`-only check accepted equal consecutive
# dates which would silently double-count days downstream.
def _strictly_increasing(s: pd.Series) -> bool:
    return bool(s.is_monotonic_increasing and s.is_unique)


SCHEMAS: dict[str, pa.DataFrameSchema] = {
    "daily_returns": pa.DataFrameSchema(
        columns={
            "date": pa.Column(
                pa.DateTime,
                checks=pa.Check(
                    _strictly_increasing,
                    error="monotonic_dates",
                ),
            ),
            "daily_return": pa.Column(
                float,
                # 2026-05-07 — bound widened from -1.0 to -100.0 so the
                # validator accepts strategies whose CSVs are in PERCENT
                # form (e.g. -7.17 for a -7.17% day) and leveraged /
                # derivative strategies whose decimal returns can dip
                # below -1.0 in a single bar. The original -1.0 floor
                # rejected the IQSF QuantumAlpha founder UAT submission
                # along with any leveraged track record. -100.0 still
                # catches obvious sentinel garbage (NaN-cast, -1e10,
                # corrupt int) and complements the dataset-level Sharpe
                # sentinel post-check below.
                checks=pa.Check.greater_than(
                    -100.0,
                    error="daily_return_lower_bound",
                ),
            ),
            "currency": pa.Column(
                pd.StringDtype(),
                checks=pa.Check(
                    lambda s: s.fillna("").str.upper().isin(["", "USD"]).all(),
                    error="currency_usd_or_blank",
                ),
                nullable=True,
                required=False,
            ),
        },
        # `strict="filter"` drops undeclared columns from the validated
        # DataFrame so unexpected PII columns (ones the redact regex does
        # not match) cannot reach the preview output.
        strict="filter",
        coerce=True,
    ),
    "daily_nav": pa.DataFrameSchema(
        columns={
            "date": pa.Column(
                pa.DateTime,
                checks=pa.Check(
                    _strictly_increasing,
                    error="monotonic_dates",
                ),
            ),
            "nav": pa.Column(
                float,
                checks=pa.Check(
                    lambda s: (s != 0).all(),
                    error="nav_non_zero",
                ),
            ),
            "currency": pa.Column(
                pd.StringDtype(),
                checks=pa.Check(
                    lambda s: s.fillna("").str.upper().isin(["", "USD"]).all(),
                    error="currency_usd_or_blank",
                ),
                nullable=True,
                required=False,
            ),
        },
        strict="filter",
        coerce=True,
    ),
    "trades": pa.DataFrameSchema(
        columns={
            "date": pa.Column(
                pa.DateTime,
                checks=pa.Check(
                    _strictly_increasing,
                    error="monotonic_dates",
                ),
            ),
            "side": pa.Column(pd.StringDtype()),
            "qty": pa.Column(
                float,
                checks=pa.Check.greater_than(0, error="qty_price_positive"),
            ),
            "price": pa.Column(
                float,
                checks=pa.Check.greater_than(0, error="qty_price_positive"),
            ),
            "symbol": pa.Column(pd.StringDtype()),
            "currency": pa.Column(
                pd.StringDtype(),
                checks=pa.Check(
                    lambda s: s.fillna("").str.upper().isin(["", "USD"]).all(),
                    error="currency_usd_or_blank",
                ),
            ),
        },
        strict="filter",
        coerce=True,
    ),
}


# ---------------------------------------------------------------------------
# Sharpe-sentinel post-check (run AFTER pandera; dataset-level not row-level).
# ---------------------------------------------------------------------------

def _check_sharpe_sentinel(df: pd.DataFrame, fmt: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if fmt == "daily_returns" and "daily_return" in df.columns and len(df) >= 2:
        r = df["daily_return"].dropna()
        if len(r) >= 2 and r.std(ddof=1) > 0:
            sharpe = (r.mean() - DEFAULT_RISK_FREE_DAILY) / r.std(ddof=1)
            if sharpe > SHARPE_SENTINEL_DAILY:
                errors.append({
                    "rule": "daily_sharpe_sentinel",
                    "row": 0,
                    "message": (
                        f"Daily Sharpe {sharpe:.2f} exceeds sentinel "
                        f"{SHARPE_SENTINEL_DAILY:.0f}"
                    ),
                })
    return errors


# ---------------------------------------------------------------------------
# Inline _redact_preview helper (cross-AI revision 2026-04-30).
#
# Phase 18 / FIX-04 ships analytics-service/services/redact.py with full
# denylist + value-shape detectors. Until then, this column-name match is
# the ONLY redaction gate on the CSV path.
# ---------------------------------------------------------------------------

def _redact_preview(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mask values whose column name matches the PII pattern.

    Phase 15 inline helper — defense for preview rendering only.
    Phase 18 / FIX-04 ships analytics-service/services/redact.py
    with full denylist + value-shape detectors. Until then, this
    column-name match is the ONLY redaction gate on the CSV path.

    Numeric / date columns whose names happen to match (e.g. a
    column literally named 'account_id_count') are still masked —
    the false-positive rate is acceptable for v0 because the
    preview is purely cosmetic; the underlying validation runs on
    the unredacted DataFrame.
    """
    redacted: list[dict[str, Any]] = []
    for row in rows:
        out: dict[str, Any] = {}
        for col, val in row.items():
            if _PII_COLUMN_PATTERN.match(str(col)):
                out[col] = "***"
            else:
                out[col] = val
        redacted.append(out)
    return redacted


# ---------------------------------------------------------------------------
# validate_csv — public API used by the FastAPI router AND (Phase 19) by
# the worker. Pure logic; no I/O beyond pd.read_csv on the in-memory bytes.
# ---------------------------------------------------------------------------

def validate_csv(raw_bytes: bytes, fmt: str) -> dict[str, Any]:
    """Validate a CSV upload against the per-format pandera schema.

    Returns envelope {ok, preview | None, errors[], correlation_id: None}.
    Raises ValueError if fmt is not one of the three supported formats.
    """
    if fmt not in SCHEMAS:
        raise ValueError(f"Unsupported fmt: {fmt}")

    if not raw_bytes:
        return {
            "ok": False,
            "preview": None,
            "errors": [{
                "rule": "empty",
                "row": 0,
                "message": "No file uploaded",
            }],
            "correlation_id": None,
        }

    try:
        df = pd.read_csv(io.BytesIO(raw_bytes), encoding="utf-8-sig")
    except Exception as e:
        # Logger discipline (cross-AI revision 2026-04-30): never log raw
        # row data. The exception message is allowed because pandas
        # exception messages do not echo row contents.
        logger.warning("[csv-validator] parse failure")
        return {
            "ok": False,
            "preview": None,
            "errors": [{
                "rule": "parse_error",
                "row": 0,
                "message": f"Could not parse CSV: {e}",
            }],
            "correlation_id": None,
        }

    # 2026-05-07 — case-insensitive header normalization. Real-world CSVs
    # ship headers like "Date,Daily_Return" or "DATE,DAILY_RETURN". Pandera
    # column matching is case-sensitive, so without this pass the schema
    # would fire `column_in_dataframe` and reject otherwise-valid files.
    # Lowercased + stripped headers are also what the downstream
    # _redact_preview / Sharpe sentinel / preview accessors all expect.
    # Trailing/leading whitespace is also stripped because Excel and
    # certain accounting tools sometimes emit "  date  ,  daily_return  ".
    df.columns = [str(c).strip().lower() for c in df.columns]

    if len(df) == 0:
        return {
            "ok": False,
            "preview": None,
            "errors": [{
                "rule": "empty",
                "row": 0,
                "message": "No data rows found",
            }],
            "correlation_id": None,
        }

    all_errors: list[dict[str, Any]] = []
    schema = SCHEMAS[fmt]

    try:
        df_validated = schema.validate(df, lazy=True)
    except SchemaErrors as exc:
        for _, row in exc.failure_cases.iterrows():
            # Cross-AI revision 2026-04-30: NEVER log row.get('failure_case')
            # — that's the raw cell value. Log only the row index + rule.
            rule_name = str(row.get("check", "unknown"))
            row_idx_raw = row.get("index")
            row_idx = int(row_idx_raw) + 1 if row_idx_raw is not None and pd.notna(row_idx_raw) else 0
            logger.warning(
                "[csv-validator] rule violation row=%d rule=%s",
                row_idx, rule_name,
            )
            all_errors.append({
                "rule": rule_name,
                "row": row_idx,
                "message": (
                    f"Column '{row.get('column')}' failed: "
                    f"{row.get('failure_case')}"
                ),
            })
        df_validated = df

    all_errors.extend(_check_sharpe_sentinel(df_validated, fmt))
    # _check_trading_window REMOVED 2026-04-30 (crypto trades 24/7)

    ok = len(all_errors) == 0

    date_min, date_max = "", ""
    if "date" in df.columns:
        dates = pd.to_datetime(df["date"], errors="coerce").dropna()
        if not dates.empty:
            date_min = str(dates.min().date())
            date_max = str(dates.max().date())

    # Cross-AI revision 2026-04-30: redact preview rows. Underlying
    # validation already ran on the unredacted df; only the preview
    # serialization gets masked.
    #
    # Adversarial-review fix 2026-05-02: project the preview to declared
    # schema columns only (mirrors `strict="filter"`) so undeclared
    # columns that the redact regex does not match cannot reach the UI
    # — even on the SchemaErrors fallback path where df_validated = df.
    declared_cols = set(SCHEMAS[fmt].columns.keys())
    present_declared = [c for c in df.columns if c in declared_cols]
    df_preview = df[present_declared] if present_declared else df.iloc[:, :0]
    first_raw = df_preview.head(3).to_dict(orient="records")
    last_raw = df_preview.tail(3).to_dict(orient="records")
    preview = {
        "row_count": int(len(df)),
        "date_range": [date_min, date_max],
        "columns_detected": list(df_preview.columns),
        "first_rows": _redact_preview(first_raw),
        "last_rows": _redact_preview(last_raw),
    }

    return {
        "ok": ok,
        "preview": preview,
        "errors": all_errors,
        "correlation_id": None,
    }
