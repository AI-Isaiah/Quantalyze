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
import warnings
from typing import Any

import pandas as pd
import pandera as pa
from pandera.errors import SchemaErrors

logger = logging.getLogger("quantalyze.analytics")

SHARPE_SENTINEL_DAILY = 10.0
DEFAULT_RISK_FREE_DAILY = 0.0

# QA report 2026-05-21 ISSUE-008: an uploaded series where the user
# pasted raw dollar PnL into the `daily_return` column slipped through.
# The values (-3.29, +1.71, …) sit well within the wide -100.0..+inf
# per-row bound widened on 2026-05-07 for leveraged strategies, so no
# per-row rule fires — but treated as decimal returns those numbers
# imply -329% / +171% daily moves, which compound into nonsense CAGR /
# Sharpe / Max DD downstream.
#
# A dataset-level "median absolute return > threshold" heuristic catches
# the systematic case without re-narrowing the per-row bound (which would
# re-break leveraged uploads). Median is robust to the occasional big
# leverage day — a real decimal-return series's median abs is typically
# well under 0.05; dollar-PnL uploads usually sit at 1.0+. Threshold
# 0.5 = 50% daily return; well above the 99th-percentile leveraged
# series and well below any plausible dollar-PnL median.
DAILY_RETURN_DOLLAR_FORM_MEDIAN_ABS_THRESHOLD = 0.5

# 2026-05-25 prod incident: the `break-momentum` strategy (MM_dailies CSV)
# slipped through the dollar-form sentinel because the file is ~50%
# zero-padded (the strategy started with months of no-trade days). The
# old `_check_dollar_form_sentinel` used `r.dropna().abs().median()` —
# but dropna() does NOT drop zeros, so the median collapsed to 0 and
# the 0.5 threshold never triggered. The 2026-05-25 fix:
#   1. Sentinel switches to the median over **non-zero** values when
#      enough non-zero samples exist (>= 2 — preserves prior behaviour
#      on edge cases too small to compute a meaningful non-zero stat).
#   2. A new auto-normalize pass runs BEFORE the sentinel. If the
#      non-zero median |x| is in the percent range (> 0.5 AND <= 100)
#      AND the max |x| is also <= 100, the daily_return column is
#      divided by 100 in-place and an info-flag is appended to the
#      envelope so the wizard/factsheet can surface a chip. Genuine
#      dollar-PnL uploads (max |x| > 100, e.g. raw $5,000/day account
#      PnL) skip normalization and continue to reject at the sentinel
#      with the existing actionable error message.
PERCENT_FORM_AUTO_NORM_LOWER = 0.5
PERCENT_FORM_AUTO_NORM_UPPER = 100.0

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


def _check_dollar_form_sentinel(df: pd.DataFrame, fmt: str) -> list[dict[str, Any]]:
    """QA report 2026-05-21 ISSUE-008. Detect a daily_return column that
    looks like raw dollar PnL — median abs(daily_return) above the
    threshold strongly suggests the column was renamed/repurposed
    without converting to decimal returns. Surface a friendly,
    actionable error rather than letting the obvious-garbage series
    flow into the analytics pipeline.

    Median is robust to outliers — a leveraged decimal-return series
    can dip below -1.0 on bad days but its median abs is well under
    0.5. A dollar-PnL series with daily $5/$50 moves on a modest
    account has median abs >> 1.0.

    2026-05-25 update: compute the median over **non-zero** values when
    enough non-zero samples exist (>= 2). Zero-padded prefixes (a
    strategy's pre-trading period) used to mask the issue when >50% of
    rows were literal zero, because `dropna()` does NOT drop zeros and
    the all-rows median collapsed to 0 — see the new
    PERCENT_FORM_AUTO_NORM_LOWER comment block for the prod incident.
    """
    errors: list[dict[str, Any]] = []
    if fmt == "daily_returns" and "daily_return" in df.columns and len(df) >= 2:
        r = df["daily_return"].dropna()
        # 2026-05-25 fix: prefer the non-zero subset so zero-padded
        # files don't drag the median to 0. Fall back to all-rows if
        # too few non-zero samples exist (preserves prior behaviour on
        # genuinely tiny files).
        non_zero = r[r != 0]
        sample = non_zero if len(non_zero) >= 2 else r
        if len(sample) >= 2:
            median_abs = float(sample.abs().median())
            if median_abs > DAILY_RETURN_DOLLAR_FORM_MEDIAN_ABS_THRESHOLD:
                errors.append({
                    "rule": "daily_return_dollar_form_sentinel",
                    "row": 0,
                    "message": (
                        f"Median |daily_return| = {median_abs:.2f} "
                        f"looks like dollar PnL, not decimal returns "
                        f"(expected median below "
                        f"{DAILY_RETURN_DOLLAR_FORM_MEDIAN_ABS_THRESHOLD:.2f}). "
                        f"Convert each row to a decimal return "
                        f"(daily PnL / account size), or upload Daily NAV instead."
                    ),
                })
    return errors


# ---------------------------------------------------------------------------
# 2026-05-25 prod incident hotfix — auto-normalize percent-form daily_return.
#
# Mutates `df["daily_return"]` in-place by dividing by 100 when the
# distribution looks like percent-without-sign (median |non-zero x|
# between PERCENT_FORM_AUTO_NORM_LOWER and PERCENT_FORM_AUTO_NORM_UPPER,
# AND max |x| <= PERCENT_FORM_AUTO_NORM_UPPER). Returns an info-flag
# dict the caller appends to the envelope's `info_flags` array.
#
# Designed to be conservative:
#   - Skipped entirely on fmt != "daily_returns" (no decimal/percent
#     ambiguity on NAV or trades).
#   - Requires >= 2 non-zero samples — a truly empty or single-trade
#     file falls back to the pandera schema + sentinel without
#     speculative mutation.
#   - Upper ceiling (100) is the only guard against eating genuine
#     dollar-PnL uploads: $5,000/day account PnL has max |x| of 5000,
#     well above the ceiling, so it skips normalization and the
#     post-norm `_check_dollar_form_sentinel` still rejects it with the
#     existing actionable error.
# ---------------------------------------------------------------------------

def _maybe_auto_normalize_percent_form(
    df: pd.DataFrame, fmt: str,
) -> dict[str, Any] | None:
    if fmt != "daily_returns" or "daily_return" not in df.columns:
        return None
    r = df["daily_return"].dropna()
    non_zero = r[r != 0]
    if len(non_zero) < 2:
        return None
    median_abs = float(non_zero.abs().median())
    max_abs = float(r.abs().max()) if len(r) > 0 else 0.0
    in_percent_band = (
        median_abs > PERCENT_FORM_AUTO_NORM_LOWER
        and median_abs <= PERCENT_FORM_AUTO_NORM_UPPER
    )
    if not in_percent_band:
        return None
    if max_abs > PERCENT_FORM_AUTO_NORM_UPPER:
        # Looks like dollar-PnL with some percent rows mixed in — let
        # the post-norm sentinel handle it instead of partial-normalizing
        # what we can't safely recover.
        return None
    df["daily_return"] = df["daily_return"] / 100.0
    logger.info(
        "[csv-validator] auto-normalized percent-form daily_return "
        "(median |non-zero x| = %.4f, max |x| = %.4f)",
        median_abs, max_abs,
    )
    return {
        "rule": "auto_normalized_percent_form",
        "factor": 0.01,
        "non_zero_median_abs_before": round(median_abs, 5),
        "non_zero_median_abs_after": round(median_abs / 100.0, 5),
        "max_abs_before": round(max_abs, 5),
        "message": (
            f"Detected percent-form daily_return (median |non-zero| = "
            f"{median_abs:.2f}). Auto-normalized to decimal by dividing "
            f"every row by 100. If your file was already in decimal "
            f"form, contact support."
        ),
    }


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
# Numeric-column scrub (currency / percent / thousands separators).
# Real-world Excel + accounting tools encode `nav` as "$9,994,084.29" and
# `daily_return` / `drawdown` as "-0.06%". Pandera coerce() can't handle
# the cosmetic decoration; without this scrub a perfectly valid track
# record fails column_in_dataframe with no actionable feedback. Strip
# only the columns the active schema declares as `float`, leave string
# columns (currency, side, symbol) alone.
# ---------------------------------------------------------------------------

# Regex captures a leading sign, then the magnitude (digits + optional
# decimal), tolerating thousands separators and a trailing percent. The
# percent flag is detected separately so we can divide by 100. Wrapped
# parentheses (Excel's "(123)" for negatives) are also handled.
_CURRENCY_OR_PERCENT_RE = re.compile(
    r"""
    ^\s*                       # leading whitespace
    (?P<paren>\()?             # optional opening paren (Excel negatives)
    \s*
    (?P<sign>[+-])?            # explicit sign
    \s*
    [\$€£¥]?                   # optional currency symbol
    \s*
    (?P<sign2>[+-])?           # sign can come after the symbol too
    \s*
    [\$€£¥]?                   # currency may even repeat in pasted data
    \s*
    (?P<num>[\d,]+(?:\.\d+)?)  # digits + optional decimal, allow commas
    \s*
    (?P<percent>%)?            # optional percent suffix
    \s*
    \)?                        # optional closing paren
    \s*$
    """,
    re.VERBOSE,
)


def _scrub_numeric_columns(df: pd.DataFrame, fmt: str) -> None:
    """In-place scrub of currency/percent decoration on float-typed columns
    declared by the active schema. NO-OP for string columns (e.g. side,
    symbol, currency). Caller is `validate_csv` after lowercasing
    headers and before `schema.validate(...)`."""
    schema = SCHEMAS.get(fmt)
    if schema is None:
        return
    float_cols: set[str] = set()
    for col_name, col_spec in schema.columns.items():
        # pandera Column carries a `dtype` attribute — `float` here
        # matches the daily_return / nav / qty / price / drawdown shape.
        if col_spec.dtype is not None and "float" in str(col_spec.dtype).lower():
            float_cols.add(col_name)
    for col in float_cols:
        if col not in df.columns:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            continue
        df[col] = df[col].map(_coerce_numeric_string)


def _coerce_numeric_string(value: object) -> object:
    """Strip currency / thousands / percent decoration from a single
    cell. Leaves NaN and unrecognized shapes untouched so the caller's
    Pandera coerce step can raise a precise per-row failure."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    if isinstance(value, (int, float)):
        return value
    s = str(value).strip()
    if not s:
        return value
    m = _CURRENCY_OR_PERCENT_RE.match(s)
    if not m:
        return value  # let pandera coerce raise on this
    num = m.group("num").replace(",", "")
    try:
        result = float(num)
    except ValueError:
        return value
    sign1 = m.group("sign")
    sign2 = m.group("sign2")
    is_negative = (sign1 == "-") or (sign2 == "-") or bool(m.group("paren"))
    if is_negative:
        result = -result
    if m.group("percent"):
        result /= 100.0
    return result


# ---------------------------------------------------------------------------
# 2026-05-27 — date-format auto-detection.
#
# The `date` column was previously coerced straight through pandas'
# `pd.to_datetime` (via pandera `coerce=True`), which defaults to
# MONTH-FIRST (US). That silently mis-parsed non-US uploads:
#   - European / German D/M/YYYY where every day <= 12 (e.g. "01/02/2023"
#     meaning 1 Feb) parsed as 2 Jan — and because the wrong dates were
#     still monotonic, NO error fired and the whole track record computed
#     against the wrong calendar (garbage CAGR / time-weighting).
#   - D/M/YYYY with any day > 12 (e.g. "13/02/2023") raised a cryptic
#     `dtype('datetime64[ns]')` pandera error with no actionable message.
#
# Real customers will not reformat their broker/accounting exports to ISO
# on request, so the ingester deduces the format FROM THE DATA: parse the
# column both month-first and day-first, then use the schema's existing
# strictly-increasing requirement (plus daily-cadence spacing for the
# genuinely-ambiguous all-<=12 case) to pick the reading that yields a
# valid ascending series. The chosen reading is written back as a single
# datetime64 column BEFORE pandera runs, so downstream coercion is a no-op
# and the emitted daily_returns_series is always YYYY-MM-DD.
#
# Minimal-intervention by construction: the column is rewritten ONLY when
# month-first (what pandera would do today) is wrong or ambiguous. ISO,
# US dates, and unparseable garbage are left untouched, so their existing
# behaviour is byte-for-byte unchanged and no info-flag is emitted. Any
# day-first or ambiguity-resolved pick DOES emit a `date_format_normalized`
# info-flag so the wizard can surface a chip and the user can catch a wrong
# guess.
# ---------------------------------------------------------------------------

def _date_series_quality(parsed: pd.Series) -> tuple[bool, float | None]:
    """(usable, median_abs_gap_days) for one candidate date parse.

    `usable` = no NaT (every cell parsed) AND monotonic non-decreasing.
    Uniqueness is intentionally NOT required here — format *selection*
    only needs a consistent ordering; the per-format pandera
    `_strictly_increasing` check still enforces uniqueness downstream. The
    median gap is used only to break a day-first/month-first tie in favour
    of the daily-cadence reading.
    """
    if parsed.isna().any() or not parsed.is_monotonic_increasing:
        return (False, None)
    gaps = parsed.diff().dropna()
    if len(gaps) == 0:
        return (True, None)
    return (True, float(gaps.dt.total_seconds().abs().median() / 86400.0))


def _detect_and_normalize_date_column(df: pd.DataFrame) -> dict[str, Any] | None:
    """Deduce day-first vs month-first FROM THE DATA and normalize
    df["date"] to datetime64 in-place. Returns a `date_format_normalized`
    info-flag when a non-default format was applied (or an ambiguous case
    resolved), else None.

    See the module comment above for why this exists. Only rewrites the
    column when pandas' month-first default would be wrong or ambiguous;
    ISO / US / unparseable inputs are left for the unchanged path.
    """
    if "date" not in df.columns or pd.api.types.is_datetime64_any_dtype(df["date"]):
        return None

    s = df["date"].astype(str).str.strip()

    # ISO-family (year-first: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD) is
    # unambiguous and pandas parses it correctly on the default path. We
    # must short-circuit it BEFORE the day-first probe below, because
    # `pd.to_datetime("2023-02-01", dayfirst=True)` FALSELY flips it to
    # YYYY-DD-MM (2023-01-02) — a wrong-but-monotonic parse that would
    # manufacture a phantom day-first/month-first ambiguity for every ISO
    # upload. Year-first inputs have no day/month ambiguity to resolve.
    iso_like = s.str.match(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}")
    if iso_like.fillna(False).all():
        return None

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # silence pandas' per-row inference warnings
        parsed_mf = pd.to_datetime(s, dayfirst=False, errors="coerce")
        parsed_df = pd.to_datetime(s, dayfirst=True, errors="coerce")

    # Identical under both flags → no day/month ambiguity to resolve (e.g.
    # every first component > 12, so pandas can only read it day-first). ISO
    # already returned above. Normalize to the shared parse so neither
    # pandera's coerce nor the date-range computation below re-parses the raw
    # strings (which would re-emit pandas' dayfirst warning), but stay silent
    # — there was nothing to disambiguate.
    if parsed_mf.equals(parsed_df):
        if not parsed_mf.isna().all():
            df["date"] = parsed_mf
        return None

    mf_ok, mf_gap = _date_series_quality(parsed_mf)
    df_ok, df_gap = _date_series_quality(parsed_df)

    if mf_ok and not df_ok:
        return None  # month-first is the only valid reading — unchanged

    detected: str
    ambiguous = False
    if df_ok and not mf_ok:
        df["date"] = parsed_df
        detected = "day_first"
    elif mf_ok and df_ok:
        # Both readings are valid but differ → genuinely ambiguous (every
        # component <= 12). Daily-return / NAV series are daily-cadence, so
        # the smaller median gap is the intended reading: day-first
        # "01/02,02/02,03/02" = 1-3 Feb (gap 1d) beats month-first
        # Jan2/Feb2/Mar2 (gap ~29d).
        ambiguous = True
        if df_gap is not None and mf_gap is not None and df_gap < mf_gap:
            df["date"] = parsed_df
            detected = "day_first"
        else:
            df["date"] = parsed_mf
            detected = "month_first"
    else:
        return None  # neither reading is a clean ascending series — let pandera raise

    human = (
        "day-first (DD/MM/YYYY)"
        if detected == "day_first"
        else "month-first (MM/DD/YYYY)"
    )
    message = f"Detected {human} dates and normalized them to YYYY-MM-DD."
    if ambiguous:
        message += (
            " Both day-first and month-first parsed cleanly; chose the"
            " reading that matches a daily-spaced series. Upload ISO"
            " (YYYY-MM-DD) if your dates are not daily-spaced."
        )
    return {
        "rule": "date_format_normalized",
        "detected_format": detected,
        "ambiguous": ambiguous,
        "message": message,
    }


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

    # 2026-05-07 — leading blank-header detection. Excel + many accounting
    # tools export an unhelpful all-empty first row (e.g. ",,,,,,") above
    # the real header row. pd.read_csv treats the blank row as the header,
    # which makes every column "Unnamed: N" and the actual headers slip
    # into row 0 of the data. Re-parse with header=1 once we detect this
    # so the founder doesn't have to hand-clean their export.
    looks_like_blank_header = (
        len(df.columns) > 0
        and all(str(c).startswith("Unnamed:") for c in df.columns)
    )
    if looks_like_blank_header:
        try:
            df = pd.read_csv(io.BytesIO(raw_bytes), encoding="utf-8-sig", header=1)
        except Exception as e:
            logger.warning("[csv-validator] blank-header re-parse failure")
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

    # 2026-05-07 — currency / percent / thousands-separator scrub on the
    # numeric schema columns. Excel + accounting tools love to format
    # `nav` as "$9,994,084.29" and `daily_return` / drawdown values as
    # "-0.06%". Pandera's `coerce=True` calls float() under the hood,
    # which can't parse those — we'd reject otherwise-valid track records
    # with a generic `column_in_dataframe`. Strip the cosmetic decoration
    # off any column declared `float` in the active schema BEFORE
    # validation, then let coerce do its job. Percent-suffix values are
    # divided by 100 so a "5.5%" daily return becomes 0.055 — matches the
    # decimal convention the downstream analytics service expects, and
    # complements the wider `daily_return > -100.0` bound below.
    _scrub_numeric_columns(df, fmt)

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

    # 2026-05-27 — deduce the date format from the data and normalize the
    # `date` column to a single datetime64 series BEFORE pandera coercion,
    # so non-US uploads (D/M/YYYY) are parsed correctly instead of silently
    # mis-read as month-first. No-op (returns None) for ISO / US / garbage
    # inputs. See _detect_and_normalize_date_column.
    date_flag = _detect_and_normalize_date_column(df)

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

    # 2026-05-25 prod incident hotfix — auto-normalize percent-form
    # daily_return BEFORE the sentinels run. If the file uses percent
    # convention without a `%` sign (median |non-zero x| > 0.5), mutate
    # in-place by /100 and emit an info-flag so the wizard can surface
    # a chip and the analytics worker computes against the normalized
    # series. Skipped on dollar-PnL uploads (max |x| > 100) so the
    # post-norm sentinel still rejects those.
    info_flags: list[dict[str, Any]] = []
    if date_flag is not None:
        info_flags.append(date_flag)
    norm_flag = _maybe_auto_normalize_percent_form(df_validated, fmt)
    if norm_flag is not None:
        info_flags.append(norm_flag)

    all_errors.extend(_check_sharpe_sentinel(df_validated, fmt))
    all_errors.extend(_check_dollar_form_sentinel(df_validated, fmt))
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

    # Phase 19.1 / CSV → analytics pipeline Task 4: include the full
    # normalized daily-return series in the envelope so the wizard can
    # forward it to csv-finalize for persistence. Only emitted for
    # ok=True on daily_returns / daily_nav (trades format produces no
    # return series — that branch keeps the honest "analytics not
    # generated" copy until a future iteration). Re-derived from PR
    # #270 commit 8611ae1c.
    daily_returns_series = None
    if ok and fmt == "daily_returns" and "daily_return" in df_validated.columns:
        valid = df_validated[["date", "daily_return"]].dropna()
        daily_returns_series = [
            {
                "date": str(pd.to_datetime(d).date()),
                "daily_return": float(r),
            }
            for d, r in zip(valid["date"], valid["daily_return"])
        ]
    elif ok and fmt == "daily_nav" and "nav" in df_validated.columns:
        nav_series = df_validated[["date", "nav"]].dropna().copy()
        nav_series["return"] = nav_series["nav"].pct_change()
        valid = nav_series.dropna(subset=["return"])
        daily_returns_series = [
            {
                "date": str(pd.to_datetime(d).date()),
                "daily_return": float(r),
            }
            for d, r in zip(valid["date"], valid["return"])
        ]

    envelope: dict[str, Any] = {
        "ok": ok,
        "preview": preview,
        "errors": all_errors,
        "correlation_id": None,
    }
    if daily_returns_series is not None:
        envelope["daily_returns_series"] = daily_returns_series
    # 2026-05-25 hotfix: info_flags is a NEW envelope field surfacing
    # informational events (auto-normalize being the first). Always
    # present so the wizard's TypeScript consumer can rely on it; empty
    # array when no info-flag fired (backward-compatible — older wizard
    # versions that don't read it simply ignore the field).
    envelope["info_flags"] = info_flags
    return envelope
