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

from services.dispersion import dispersion_is_residue

logger = logging.getLogger("quantalyze.analytics")

SHARPE_SENTINEL_DAILY = 10.0
DEFAULT_RISK_FREE_DAILY = 0.0

# 170.1 / D-10 — the ONE sentence every layer uses for an unsupported `fmt`.
# `validate_csv` raises ValueError for it, and the exception text must never
# reach a client or a log: a caller that put `str(exc)` on the wire would echo
# whatever the caller sent as `fmt`. The router's pre-check and the CSV adapter
# send this fixed sentence instead. It is the router's long-standing wording.
UNSUPPORTED_FMT_MESSAGE = "fmt must be one of daily_returns, daily_nav, trades."

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

# 2026-05-27 (H1, security) — hard row ceiling enforced BEFORE the date
# double-parse. The /process-key path has no upstream row cap (unlike the TS
# edge route), so an unbounded CSV would make pandas read_csv + the two
# pd.to_datetime passes run on arbitrarily many rows. Matches the 5000-row
# persistence limit (the finalize_csv_strategy_with_returns fold's p_rows
# cap); a larger file is rejected
# with an actionable error rather than silently truncated or DoS-ing the pod.
MAX_INGEST_ROWS = 5000

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
#
# The order is judged on the cells that READ AS A DATE (review TR-3). When pandera
# cannot coerce a cell (a zone the validator does not read, the placeholder
# standing in for one, plain garbage) the column reaches this check UN-coerced,
# as text or as a mix of timestamps and text, and the old check then compared
# those: a file whose dates increase also reported "dates must be strictly
# increasing" beside the real date error at the unreadable row. So an un-coerced
# column is read cell by cell here, an unreadable cell becomes NaT and is left
# out of the order. That cell is always reported by its own rule (`coerce_dtype`
# and `dtype`, or `not_nullable`), so leaving it out accepts nothing new, and a
# file whose readable dates are out of order or repeated still fails this rule.
# A column pandera DID coerce arrives as datetime64 and takes the old path.
def _strictly_increasing(s: pd.Series) -> bool:
    if not pd.api.types.is_datetime64_any_dtype(s):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # pandas' per-value inference warnings
            s = _parse_dates(s)
    s = s.dropna()
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

def _has_numeric_daily_return(df: pd.DataFrame) -> bool:
    """True when `df` carries a `daily_return` column the sentinels can do float
    maths on. Pandera's `coerce=True` makes it float on a file that passes the
    schema; on the SchemaErrors fallback the frame is the unvalidated read and a
    non-numeric cell leaves the column as strings (170.1 / D-10)."""
    return "daily_return" in df.columns and pd.api.types.is_numeric_dtype(
        df["daily_return"]
    )


def _check_sharpe_sentinel(df: pd.DataFrame, fmt: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if fmt == "daily_returns" and _has_numeric_daily_return(df) and len(df) >= 2:
        r = df["daily_return"].dropna()
        if len(r) >= 2:
            sd = r.std(ddof=1)
            # Phase 166.1 (S3, D-04): a std that is only float residue (a repeated
            # float, or a constant yield taken from a compounding NAV) has no
            # Sharpe to print; dividing by it printed a fabricated ~1e15. Keep the
            # VERDICT (a constant return above the risk-free rate is an unbounded
            # Sharpe, so it is rejected) and drop the number.
            #
            # D-24 (founder decision 2026-09-26): an EXACTLY zero std now takes
            # this branch too, so a constant positive series is rejected at every
            # length with the one message below. Before D-24 this block was gated
            # on a strictly positive std, so a short constant series (whose std
            # sums to exactly 0) was ACCEPTED and a longer one (float residue)
            # was REJECTED: float summation decided the verdict. That gate was
            # kept in plan 01 for D-04 verdict preservation; D-24 supersedes that
            # reason. A constant ZERO series is out of scope: its mean is not
            # above the risk-free rate, so it still gets no error. A NaN std
            # (non-finite rows) is not residue and its Sharpe comparison is
            # False, so it still gets no error either.
            #
            # Round-1 WR-01 / SFH MEDIUM-3 (amends D-04, recorded in
            # 166.1-CONTEXT): this branch emits its OWN rule key,
            # `daily_returns_constant`. It shared `daily_sharpe_sentinel`, whose
            # label "Daily Sharpe > 10 looks unrealistic" states a comparison
            # that is never made here: with no dispersion there is no Sharpe.
            # The Sharpe-number branch below keeps its key and label.
            if dispersion_is_residue(float(sd), float(r.mean())):
                if r.mean() - DEFAULT_RISK_FREE_DAILY > 0:
                    errors.append({
                        "rule": "daily_returns_constant",
                        "row": 0,
                        "message": (
                            "Daily returns do not vary, so the Sharpe is unbounded; "
                            "a constant positive return is not a realistic track record"
                        ),
                    })
                return errors
            sharpe = (r.mean() - DEFAULT_RISK_FREE_DAILY) / sd
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
    if fmt == "daily_returns" and _has_numeric_daily_return(df) and len(df) >= 2:
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
# strictly-increasing requirement to pick the reading that yields a valid
# ascending series. When only ONE reading is valid (the common case — any
# real >=20-day daily series contains a day > 12, which rules out the wrong
# reading) the format is unambiguous; the chosen reading is written back as
# a single datetime64 column BEFORE pandera runs, so downstream coercion is
# a no-op and the emitted daily_returns_series is always YYYY-MM-DD.
#
# When BOTH readings are valid but DIFFER (every component <= 12 — only
# reachable for short / sparse series, which a real >=20-day daily track
# record never is), the data genuinely cannot disambiguate DD/MM from MM/DD.
# We do NOT guess: a wrong guess silently mis-parses the entire track record
# into the wrong calendar with no error (e.g. a monthly day-first series
# "05/01,05/02,05/03" read as three consecutive days in May). Instead
# validate_csv rejects with an actionable `date_format_ambiguous` error
# asking for ISO. (A richer wizard fallback — show the first rows and let the
# user confirm the column/format — is tracked as a follow-up.)
#
# Minimal-intervention by construction: the column is rewritten ONLY when a
# single, non-month-first reading is valid. ISO, US dates, and unparseable
# garbage are left untouched (byte-for-byte unchanged, no info-flag); the
# unambiguous day-first case emits a `date_format_normalized` info-flag.
# ---------------------------------------------------------------------------

# 170.1 / D-14 (WR-A, amended 2026-10-16) - A UTC OFFSET IS NOT PART OF THE DATE
# THE USER WROTE, AND A ZONE WE CANNOT READ IS A DATE ERROR, NEVER A SHIFTED DATE.
#
# A local-time broker export carries the offset in force on each row, and the
# offset changes across a daylight-saving boundary (`...T00:00:00+01:00` then
# `...T00:00:00+02:00`). `pd.to_datetime` refuses a column with more than one
# offset ("Mixed timezones detected") and it raised out of `validate_csv`, so an
# ordinary file came back as CSV_UPSTREAM_FAIL ("our side, try again") and a
# retry could never help.
#
# Converting to UTC stops the raise but moves the DAY: local midnight at +02:00 is
# the previous evening in UTC. So nothing here converts a date silently
# (`utc=True` is gone from the parser). The recognised spellings below are
# handled explicitly, per format, and every other zone is rejected:
#   - `daily_returns` / `daily_nav`: the offset is removed and the WALL CLOCK is
#     parsed, so the calendar date the user wrote is the date stored.
#   - `trades`: a trade timestamp is an instant, and the worker reads it as one
#     (`services/ingestion/_timestamps.py` `coerce_to_aware_utc`), so each
#     timestamp is converted to a UTC-naive instant. See `_apply_trade_offsets`.
#   - any zone that survives the strip is a `coerce_dtype` date error at the
#     row's real position, the line the wizard already renders as "A value is
#     not a valid date or number". See `_normalise_date_zones`.
#
# What is recognised: `Z`, `UTC`, `GMT` (no number), and a numeric offset of the
# form `+HH`, `+HHMM`, `+HH:MM` with an optional `UTC` in front, hours 00-23 and
# minutes 00-59. What is NOT recognised, on purpose, and so rejected:
#   - `GMT+1`, `GMT-5`, `GMT+02:00`: dateutil reads the sign of a `GMT+N`
#     spelling INVERTED (the POSIX convention), so `GMT+1` means UTC-1. The sign
#     is not guessed; the file is rejected.
#   - a single-digit hour (`+2`, `+2:00`) and a name after the offset
#     (`+01:00 (CET)`): pandas reads them as zones, so they must not slip through
#     the strip's `$` anchor and be converted later.
_UTC_OFFSET_SUFFIX_RE = re.compile(
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)"  # the wall-clock time, kept
    r"\s*(?:[Zz]|UTC|GMT"
    r"|(?:UTC)?(?P<sign>[+-])(?P<hh>\d{2})(?::?(?P<mm>\d{2}))?)\s*$",  # the offset, dropped
    re.ASCII,
)

# A value of exactly this shape is digits and separators, an optional time, and
# nothing else: it cannot carry a zone, so the (slower) per-value zone check
# skips it. Anything else, a month name, a `PM`, a stray suffix, gets the check.
_ZONE_FREE_SHAPE_RE = re.compile(
    r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}"
    r"(?:[T ]\s*\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?",
    re.ASCII,
)

# What a zone-bearing cell is replaced with while the date column is parsed. It
# is not a date under any reading (month 00), so pandera reports the cell through
# its own `coerce_dtype` rule at the cell's row. It is year-first on purpose:
# `_detect_and_normalize_date_column` leaves an all-ISO column to pandera, where a
# token of another shape would make it rewrite the column and turn this cell into
# a NaT, which pandera reports as `not_nullable` instead. The user never sees it:
# the preview gets the original text back (see `validate_csv`), and no error
# message ever carries a cell.
_UNSUPPORTED_ZONE_TOKEN = "0000-00-00"

# The longest date cell, measured without its padding, that is read at all (security
# re-audit T-170.1-51). The longest honest spelling is a date, a time to the
# nanosecond and a zone (`2024-03-31 00:00:00.123456789 UTC+02:00`, 39 characters),
# so 64 leaves room for any real export. A longer cell is NOT handed to pandas or to
# a zone regex: both cost grows with the cell on a hostile shape (repeated `1:11 `
# took 40 s or more for a 10 MB file), and the row cap and body cap do not bound a
# cell. It is replaced by the placeholder, so it is the same `coerce_dtype` date
# error at its row as any other unreadable zone.
MAX_DATE_CELL_CHARS = 64


def _split_zone(value: str) -> tuple[str, int | None]:
    """Split a recognised trailing zone off `value`: `(wall_clock_text, offset)`.

    `offset` is the UTC offset in seconds (0 for `Z`/`UTC`/`GMT`), or None when
    `value` carries no recognised zone (including an offset that is not a real
    one, such as `+99:99`), in which case `value` comes back unchanged.
    """
    m = _UTC_OFFSET_SUFFIX_RE.search(value)
    if m is None:
        return value, None
    seconds = 0
    if m.group("sign") is not None:
        hours, minutes = int(m.group("hh")), int(m.group("mm") or 0)
        if hours > 23 or minutes > 59:
            return value, None
        seconds = (hours * 3600 + minutes * 60) * (-1 if m.group("sign") == "-" else 1)
    return value[: m.end("time")], seconds


def _carries_zone(value: str) -> bool:
    """True when pandas reads `value` as a zone-AWARE timestamp.

    This is the test for "a zone survived the strip". A value pandas cannot read
    at all is not this case: it stays as it is and pandera reports it.
    """
    if _ZONE_FREE_SHAPE_RE.fullmatch(value.strip()):
        return False
    try:
        parsed = pd.to_datetime(value, errors="coerce")
    except (ValueError, OverflowError, TypeError):
        return False
    return parsed is not pd.NaT and getattr(parsed, "tzinfo", None) is not None


# A capitalised zone NAME (`EST`, `CEST`, `AEST`) after a wall-clock time. pandas
# reads such a value as NaT under every reading, so `_carries_zone` cannot see it
# and, in a day-first column, the day/month detector would turn the cell into a
# blank (`not_nullable`) instead of the date error it is (review SFH-R2).
_TRAILING_ZONE_NAME_RE = re.compile(
    r"(?P<rest>.*\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s*[A-Z]{2,5}",
    re.ASCII,
)


def _names_an_unread_zone(value: str) -> bool:
    """True when `value` is a readable date and time followed by a zone NAME that
    pandas will not read (so the whole value is NaT).

    A value pandas reads as it stands (`10:00 PM`, where `PM` is a meridian and
    not a zone) is not this case, and neither is one whose date part is not
    readable either: that stays for pandera to report as it always has.
    """
    m = _TRAILING_ZONE_NAME_RE.fullmatch(value.strip())
    if m is None:
        return False
    try:
        if pd.to_datetime(value, errors="coerce") is not pd.NaT:
            return False
        rest = m.group("rest")
        return any(
            pd.to_datetime(rest, errors="coerce", dayfirst=dayfirst) is not pd.NaT
            for dayfirst in (False, True)
        )
    except (ValueError, OverflowError, TypeError):
        return False


def _normalise_date_zones(
    df: pd.DataFrame, fmt: str
) -> tuple[list[int | None] | None, dict[int, str], dict[int, str]]:
    """Strip every recognised trailing UTC offset from `df["date"]` (in place,
    keeping the wall clock) and fail closed on any zone left over.

    Returns `(offsets, rejected, named)`:
      - `offsets`: per row, the stripped offset in seconds or None, or None
        overall when no row had one. A column with no offsets is left
        byte-for-byte unchanged.
      - `rejected`: row position -> the cell as written, for every cell that
        still carries a zone after the strip, and every cell longer than
        `MAX_DATE_CELL_CHARS` (which is never parsed). Each is replaced in `df` by
        `_UNSUPPORTED_ZONE_TOKEN`, so pandera reports it as a date error at its
        real row. The caller restores the original text for the preview.
      - `named`: row position -> the cell as written, for every cell that is a
        readable date and time followed by a zone NAME pandas will not read
        (`_names_an_unread_zone`). These cells are NOT touched in `df`: left as
        they are, pandera already reports them as a date error. They are
        reported here only so `validate_csv` can put them back when the
        day-first detector rewrites the column and turns them into blanks.

    Only a string that ends in a TIME followed by an offset is stripped, so a
    plain date such as `2024-03-30` (whose `-30` is a day, not an offset) is
    never altered.
    """
    if "date" not in df.columns:
        return None, {}, {}
    col = df["date"]
    if not (pd.api.types.is_string_dtype(col) or pd.api.types.is_object_dtype(col)):
        return None, {}, {}

    cleaned: list[Any] = []
    offsets: list[int | None] = []
    rejected: dict[int, str] = {}
    named: dict[int, str] = {}
    changed = False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # dateutil's per-value zone warnings
        for position, value in enumerate(col.tolist()):
            wall, offset = value, None
            if isinstance(value, str) and len(value.strip()) > MAX_DATE_CELL_CHARS:
                rejected[position] = value
                wall = _UNSUPPORTED_ZONE_TOKEN
                changed = True
            elif isinstance(value, str) and not _ZONE_FREE_SHAPE_RE.fullmatch(value.strip()):
                wall, offset = _split_zone(value)
                if _carries_zone(wall):
                    rejected[position] = value
                    wall, offset = _UNSUPPORTED_ZONE_TOKEN, None
                elif offset is None and _names_an_unread_zone(wall):
                    named[position] = value
                changed = changed or wall is not value
            cleaned.append(wall)
            offsets.append(offset)
    if changed:
        df["date"] = pd.Series(cleaned, index=df.index, dtype=col.dtype)
    return (offsets if any(o is not None for o in offsets) else None), rejected, named


def _apply_trade_offsets(df: pd.DataFrame, offsets: list[int | None]) -> None:
    """`trades` only: turn the wall-clock `date` column into UTC-naive instants.

    A trade timestamp is a moment, and the worker reads it as one
    (`services/ingestion/_timestamps.py` `coerce_to_aware_utc`: the offset is
    kept, a naive value is taken as UTC). So a recognised offset is subtracted
    from the parsed wall clock, which is the same instant, and a value with no
    offset stays as it is (UTC). The offset is applied AFTER the date column is
    parsed, because the day/month reading of a `13/01/2024 10:00 +01:00` file is
    deduced from the whole column, not from one cell.

    The column is converted only when every value parsed. If any did not, the
    file is rejected by pandera at those rows anyway and the text is left for it.

    This is why the strict-increase check is correct across a daylight-saving
    fall-back: `01:45-04:00` then `01:10-05:00` is 05:45Z then 06:10Z.
    """
    col = df["date"]
    if not pd.api.types.is_datetime64_any_dtype(col):
        col = _parse_dates(col)
    if col.isna().any():
        return
    shift = pd.to_timedelta([o or 0 for o in offsets], unit="s")
    df["date"] = col - pd.Series(shift, index=df.index)


def _parse_dates(values: pd.Series, **kwargs: Any) -> pd.Series:
    """`pd.to_datetime(errors="coerce")` that fails CLOSED on a zone.

    No accepted file reaches this with a zone on a value: `_normalise_date_zones`
    has already stripped or rejected every one. If one ever did, converting it
    would move the calendar date silently (the D-14 amendment forbids that), and
    pandas raises on a column of mixed offsets (which the callers report as "our
    side, try again"). So a zone-aware result, or the mixed-offset raise, comes
    back as all-NaT: every row is then a date error, and none is a date.
    """
    try:
        parsed = pd.to_datetime(values, errors="coerce", **kwargs)
    except ValueError:  # "Mixed timezones detected"
        return pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns]")
    if parsed.dt.tz is not None:
        return pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns]")
    return parsed


def _date_parse_is_usable(parsed: pd.Series) -> bool:
    """True when every value parsed (no NaT) AND the series is monotonic
    non-decreasing.

    Uniqueness is intentionally NOT required here — format *selection* only
    needs a consistent ordering; the per-format pandera `_strictly_increasing`
    check still enforces uniqueness downstream.
    """
    return bool(not parsed.isna().any() and parsed.is_monotonic_increasing)


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
        parsed_mf = _parse_dates(s, dayfirst=False)
        parsed_df = _parse_dates(s, dayfirst=True)

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

    # The reading is chosen on the cells at least one reading can read. A cell
    # neither reads (a footer such as `Total`, a blank, `garbage`, a zone NAME) is
    # no evidence for either, and left in it made BOTH readings "unusable", so the
    # column stayed text and the order check then read it month-first from its
    # first cell (review LR-2).
    readable = parsed_mf.notna() | parsed_df.notna()
    mf_ok = _date_parse_is_usable(parsed_mf[readable])
    df_ok = _date_parse_is_usable(parsed_df[readable])
    # Only day-first reads every readable cell: month-first leaves a NaT in one.
    # That settles the reading even when the dates are out of order, so the order
    # check, not the format guess, reports the disorder.
    day_first_only = bool(parsed_df[readable].notna().all() and parsed_mf[readable].isna().any())

    if mf_ok and not df_ok:
        return None  # month-first is the only valid reading — unchanged

    if day_first_only or (df_ok and not mf_ok):
        # Day-first is the ONLY valid reading (e.g. a day > 12 rules out
        # month-first). Unambiguous — normalize in place and flag it. A cell
        # neither reading could read keeps what the file (or the zone guard) put
        # there, so pandera reports it at its row as it does in an ISO column.
        df["date"] = (
            parsed_df if readable.all() else parsed_df.astype(object).where(readable, df["date"])
        )
        return {
            "rule": "date_format_normalized",
            "detected_format": "day_first",
            "message": (
                "Detected day-first (DD/MM/YYYY) dates and normalized them "
                "to YYYY-MM-DD."
            ),
        }

    if mf_ok and df_ok:
        # Both readings yield valid ascending series that DIFFER → the data
        # genuinely cannot disambiguate DD/MM from MM/DD (every component is
        # <= 12). Do NOT guess — a wrong guess silently mis-parses the whole
        # track record into the wrong calendar with no error (e.g. a monthly
        # day-first series read as consecutive days). A real >=20-day daily
        # series always contains a day > 12 and takes the unambiguous branch
        # above; only short/sparse series reach here. Signal an ambiguity
        # error for validate_csv to surface and do NOT mutate df["date"].
        return {
            "rule": "date_format_ambiguous",
            "message": (
                "Could not determine the date format — these dates are "
                "ambiguous (each could be DD/MM/YYYY or MM/DD/YYYY). Please "
                "re-upload with ISO dates in YYYY-MM-DD format."
            ),
        }

    return None  # neither reading is a clean ascending series — let pandera raise


def _raw_header_names(raw_bytes: bytes, header_row: int, width: int) -> list[str]:
    """The header cells exactly as written in the file.

    `pd.read_csv` renames a repeated header (`x,x` -> `x`, `x.1`) before the
    frame exists, so a repeat can only be seen on the raw row. `header_row` is
    0 for a normal file and 1 when the Excel blank first row was skipped, and
    `width` is the frame's column count.

    This is a pandas read with the frame read's own options, so both reads apply
    the same rules for which line is the header (blank, whitespace-only and
    quoted-empty lines, bare carriage returns, a BOM, quoted line breaks) and
    agree by construction. A second parser did not: it disagreed with pandas
    three times (review R-1, TR-1 and TR-2, LR-1), each a header taken from the
    wrong line. `header=None` keeps the names unrenamed; `names=range(width)`
    stops pandas fixing the field count from a first line narrower than the
    header (`,` above `date,x,x`, review R-1); `index_col=False` drops the extra
    fields of a wider blank row (`,,,,` above a two-column header), and the
    warning pandas gives for that is not a defect of the file.

    FAIL CLOSED: a header that cannot be read RAISES (a `ValueError` from
    pandas, which covers `UnicodeDecodeError`). There is no fallback to the
    frame's own names; they are the renamed ones, which would restore the defect
    this function exists to remove. The caller turns the exception into a
    `parse_error`.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # ParserWarning for the dropped fields
        raw = pd.read_csv(
            io.BytesIO(raw_bytes),
            encoding="utf-8-sig",
            header=None,
            names=range(width),
            dtype=str,
            keep_default_na=False,
            nrows=header_row + 1,
            index_col=False,
        )
    return raw.iloc[header_row].tolist()


def _row_longer_than_header() -> dict[str, Any]:
    """The `parse_error` envelope for a file whose header row and data rows do not
    line up in width. It is the one sentence for two paths: pandas promoted the
    first column to the index because a data row is longer than the header, and
    the raw header read (`_raw_header_names`) came out a different width than the
    frame (review TR-1, a guard against the two readers drifting apart). It names
    the problem and never a cell."""
    return {
        "ok": False,
        "preview": None,
        "errors": [{
            "rule": "parse_error",
            "row": 0,
            # One literal, on one line: the WR-01 parity test greps the
            # producer source for this exact sentence.
            "message": "Could not parse CSV: a data row has more fields than the header row.",
        }],
        "correlation_id": None,
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
        # The text is for a developer reading a traceback; no caller may send it
        # to a client or a log (see UNSUPPORTED_FMT_MESSAGE).
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
    header_row = 0
    looks_like_blank_header = (
        len(df.columns) > 0
        and all(str(c).startswith("Unnamed:") for c in df.columns)
    )
    if looks_like_blank_header:
        header_row = 1
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

    # 170.1 / D-10 — A DATA ROW LONGER THAN THE HEADER IS A NAMED REJECTION.
    # When a data row has more fields than the header, pandas does not raise: it
    # promotes the FIRST column to the frame's INDEX and shifts every other
    # column left. Everything below assumes the positional RangeIndex that a
    # normal read gives. The row-number step in the SchemaErrors loop does
    # `int(failure.index) + 1`, and with a date index that is `int("<a date>")`,
    # a ValueError whose text carries a cell. The tokenizer error already
    # reported for a LATER over-long row says the same thing in the same rule, so
    # this shape gets the same rule with a fixed sentence: it names the problem,
    # never a cell. (`RangeIndex` is the only index a read gives when pandas did
    # NOT promote a column, including for a header-only file.)
    if not isinstance(df.index, pd.RangeIndex):
        logger.warning("[csv-validator] data row longer than header")
        return _row_longer_than_header()

    # 2026-05-07 — case-insensitive header normalization. Real-world CSVs
    # ship headers like "Date,Daily_Return" or "DATE,DAILY_RETURN". Pandera
    # column matching is case-sensitive, so without this pass the schema
    # would fire `column_in_dataframe` and reject otherwise-valid files.
    # Lowercased + stripped headers are also what the downstream
    # _redact_preview / Sharpe sentinel / preview accessors all expect.
    # Trailing/leading whitespace is also stripped because Excel and
    # certain accounting tools sometimes emit "  date  ,  daily_return  ".
    #
    # 170.1 / D-14 (WR-A, amended 2026-10-16) - TWO HEADERS WITH THE SAME NAME ARE
    # A NAMED REJECTION. `date,Date,daily_return` leaves two columns called `date`,
    # so `df["date"]` is a two-column FRAME and the date detector raised
    # AttributeError ('DataFrame' has no attribute 'str'); `Daily_Return` beside
    # `daily_return` raised TypeError in the percent normaliser. Either escape
    # reached the callers as CSV_UPSTREAM_FAIL, "our side, try again", for a
    # deterministic file defect. The sentence is founder-approved (D-14) and names
    # no header: the header text is the user's own and is not echoed.
    #
    # The collision is counted on the RAW header row, not on `df.columns`: pandas
    # renames an exact repeat (`daily_return,daily_return` -> `daily_return`,
    # `daily_return.1`) before the frame exists, and `strict="filter"` then drops
    # the copy, so the file was accepted using only the first column and the
    # user's second one was silently ignored. Counting the raw names covers an
    # exact repeat and a case or padding difference alike.
    #
    # Only a collision on a column the schema DECLARES is rejected (D-14
    # amendment). An undeclared pair (`Notes,notes`, `notes,notes`) is dropped by
    # `strict="filter"` without being read: that file validated before and still
    # must. A literal `daily_return.1` is a different name, not a repeat, and is
    # undeclared too.
    normalized_columns = [str(c).strip().lower() for c in df.columns]
    try:
        header_names = _raw_header_names(raw_bytes, header_row, len(df.columns))
    except ValueError as e:
        # Fail closed: a header the raw read cannot parse is rejected, never
        # replaced by the frame's renamed names. Same sentence shape as the two
        # other parse failures above, and the same logger discipline.
        logger.warning("[csv-validator] raw header parse failure")
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
    if len(header_names) != len(df.columns):
        # The raw read and the frame read disagree about which record is the
        # header (review TR-1). Neither can be trusted to name a column, so the
        # file is rejected rather than checked against a header that may be the
        # wrong line. Fixed text, no cell.
        logger.warning("[csv-validator] raw header and frame disagree on width")
        return _row_longer_than_header()
    normalized_header = [str(c).strip().lower() for c in header_names]
    declared = SCHEMAS[fmt].columns.keys()
    if any(
        normalized_header.count(name) > 1
        for name in declared
        if name in normalized_header
    ):
        logger.warning("[csv-validator] two columns have the same declared name")
        return {
            "ok": False,
            "preview": None,
            "errors": [{
                "rule": "parse_error",
                "row": 0,
                # One literal, on one line: the WR-01 parity test greps the
                # producer source for this exact sentence.
                "message": "Could not parse CSV: two columns have the same name.",
            }],
            "correlation_id": None,
        }
    df.columns = normalized_columns

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

    # 2026-05-27 (H1, security) — reject oversize row counts BEFORE the date
    # double-parse / sentinels run, to bound worker CPU + memory on the
    # /process-key path (which has no upstream row cap).
    if len(df) > MAX_INGEST_ROWS:
        return {
            "ok": False,
            "preview": None,
            "errors": [{
                "rule": "too_many_rows",
                "row": 0,
                "message": (
                    f"CSV exceeds the {MAX_INGEST_ROWS}-row limit "
                    f"(got {len(df)} rows)."
                ),
            }],
            "correlation_id": None,
        }

    # 2026-05-27 — deduce the date format from the data and normalize the
    # `date` column to a single datetime64 series BEFORE pandera coercion,
    # so non-US uploads (D/M/YYYY) are parsed correctly instead of silently
    # mis-read as month-first. Returns None for ISO / US / garbage inputs, a
    # `date_format_normalized` info-flag for an unambiguous day-first file, or
    # a `date_format_ambiguous` error when the format genuinely can't be
    # determined (validate_csv rejects rather than guess). See
    # _detect_and_normalize_date_column.
    # 170.1 / D-14 amendment: offsets stripped (or rejected) before any parse.
    zone_offsets, zone_rejected, zone_named = _normalise_date_zones(df, fmt)
    date_result = _detect_and_normalize_date_column(df)
    if (zone_rejected or zone_named) and pd.api.types.is_datetime64_any_dtype(df["date"]):
        # The detector rewrote the column and wrote a NaT where it could not read
        # the placeholder, or a zone NAME it will not read; put the placeholder
        # back so pandera reports the cell through `coerce_dtype`, as it does in a
        # file the detector leaves alone, and not as a blank (`not_nullable`).
        # (Review SFH-R2: a named zone is only ever in this state after a rewrite.)
        zone_rejected = {**zone_rejected, **zone_named}
        restored = df["date"].astype(object)
        restored.iloc[list(zone_rejected)] = _UNSUPPORTED_ZONE_TOKEN
        df["date"] = restored
    elif fmt == "trades" and zone_offsets is not None:
        _apply_trade_offsets(df, zone_offsets)  # instants, like the worker reads them
    date_flag: dict[str, Any] | None = None
    date_error: dict[str, Any] | None = None
    if date_result is not None:
        if date_result.get("rule") == "date_format_ambiguous":
            date_error = {
                "rule": "date_format_ambiguous",
                "row": 0,
                "message": date_result["message"],
            }
        else:
            date_flag = date_result

    all_errors: list[dict[str, Any]] = []
    if date_error is not None:
        # Ambiguous date format — reject with an actionable message instead
        # of silently mis-parsing (see _detect_and_normalize_date_column).
        all_errors.append(date_error)
    schema = SCHEMAS[fmt]

    schema_validation_ok = True
    try:
        df_validated = schema.validate(df, lazy=True)
    except SchemaErrors as exc:
        schema_validation_ok = False
        for _, row in exc.failure_cases.iterrows():
            # Cross-AI revision 2026-04-30: NEVER log row.get('failure_case')
            # — that's the raw cell value. Log only the row index + rule.
            rule_name = str(row.get("check", "unknown"))
            row_idx_raw = row.get("index")
            # 161-REVIEW / CR-02 — `0` IS THE ABSENT-ROW SENTINEL ON THE WIRE.
            # Real rows are 1-BASED here (`int(...) + 1`), so `row: 0` can only
            # ever mean "this failure has no row". The sentinel STAYS on the
            # wire — `_forwarded_pandera_rows` and the wizard's typed shape both
            # expect an int — but it may never be INTERPOLATED into a sentence a
            # human reads. See the message builder below.
            has_row = row_idx_raw is not None and pd.notna(row_idx_raw)
            row_idx = int(row_idx_raw) + 1 if has_row else 0
            logger.warning(
                "[csv-validator] rule violation row=%d rule=%s",
                row_idx, rule_name,
            )
            # 2026-05-27 — do NOT echo the raw failing cell value
            # (`row.get('failure_case')`) into the user-facing message: it is
            # untrusted CSV content that can carry PII, and this envelope is
            # persisted into strategy_verifications metadata. Mirror the
            # no-row-data discipline (above) on the response channel too.
            #
            # 161-03 / WIZERR-13 — AND DO NOT NAME A COLUMN THAT DOES NOT
            # EXIST. `column` is NaN for a DATAFRAME-level check (the schema
            # itself failed, not a cell in a column), and pandera reports that
            # as a float, so the pre-fix f-string rendered its `str()`:
            #
            #     Column 'nan' failed rule 'column_in_dataframe' at row 0.
            #
            # measured verbatim against a daily_returns upload whose value
            # column is misnamed. The wizard prints that sentence unchanged.
            # With no column to name, the clause is OMITTED rather than filled
            # with a fabricated name.
            #
            # ⛔ The guard is `pd.isna`, NEVER a string match on "nan": a CSV
            # is free to have a column literally named `nan`, and for that file
            # the column clause is CORRECT. Only the absent reading is absent.
            #
            # ⛔ 161-REVIEW / CR-02 — AND DO NOT NAME A ROW THAT DOES NOT EXIST.
            # 161-03 removed the invented COLUMN name and left the invented ROW
            # number standing, so the founder-measured specimen still read:
            #
            #     Failed rule 'column_in_dataframe' at row 0.
            #
            # A dataframe-level check has no row either — pandera reports
            # `index` as NaN for the same reason it reports `column` as NaN —
            # and there is no row 0 in a 1-based sentence. The row clause is now
            # OMITTED on exactly the same terms as the column clause: absent
            # means absent, never a fabricated number (161-UI-SPEC Copy
            # Principle 5).
            #
            # ⚠️ MEASURED, not reasoned. Driving a `daily_returns` upload whose
            # value column is misnamed through `validate_csv` produces
            # `has_column` False AND `has_row` False on the same failure_cases
            # row, so this is the arm the requirement's own specimen reaches.
            column_raw = row.get("column")
            has_column = column_raw is not None and not pd.isna(column_raw)
            column_name = str(column_raw).strip() if has_column else ""
            #
            # 170.1-01 / D-10 — A MISSING COLUMN IS NAMED IN PLAIN WORDS.
            # For `column_in_dataframe` ONLY, pandera reports `column=None`,
            # `index=None` and `failure_case=<the SCHEMA's expected column
            # name>` (measured, not the file's header and not a cell), so it is
            # safe to read here and nowhere else: for every other rule
            # `failure_case` IS the raw cell. ⛔ Never widen this branch.
            expected_column = ""
            if rule_name == "column_in_dataframe":
                failure_case_raw = row.get("failure_case")
                if failure_case_raw is not None and not pd.isna(failure_case_raw):
                    expected_column = str(failure_case_raw).strip()
            if expected_column:
                message = f"Your file has no {expected_column} column."
            elif column_name and has_row:
                message = (
                    f"Column '{column_name}' failed rule "
                    f"'{rule_name}' at row {row_idx}."
                )
            elif column_name:
                message = f"Column '{column_name}' failed rule '{rule_name}'."
            elif has_row:
                message = f"Failed rule '{rule_name}' at row {row_idx}."
            else:
                message = f"Failed rule '{rule_name}'."
            error: dict[str, Any] = {
                "rule": rule_name,
                "row": row_idx,
                "message": message,
            }
            if expected_column:
                error["column"] = expected_column
            elif column_name:
                # Every other rule: pandera's `column` is the SCHEMA key the
                # check is attached to. `failure_case` (the raw cell) is never
                # consulted here.
                error["column"] = column_name
            all_errors.append(error)
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
    # 2026-05-27 — only auto-normalize a frame that PASSED schema validation.
    # On the SchemaErrors fallback `df_validated = df` (unvalidated), so the
    # /100 mutation + its info-flag would otherwise run on an already-rejected
    # file — pointless and misleading.
    norm_flag = (
        _maybe_auto_normalize_percent_form(df_validated, fmt)
        if schema_validation_ok
        else None
    )
    if norm_flag is not None:
        info_flags.append(norm_flag)

    # 170.1 / D-10 — THE DATASET-LEVEL SENTINELS NEED A NUMERIC `daily_return`
    # COLUMN, AND THEY NOW CHECK FOR ONE. On the SchemaErrors fallback
    # `df_validated = df` is the UNVALIDATED, uncoerced frame, so a non-numeric
    # `daily_return` cell leaves the whole column as strings and both sentinels
    # did float maths on it. The result was a TypeError out of `r.std(...)`
    # whose text carries the cell, escaping `validate_csv` instead of the
    # `coerce_dtype` row pandera had already emitted for that cell (measured at
    # HEAD 712c47eea). The precondition lives in `_has_numeric_daily_return`, so
    # a rejected file reports its pandera rows and never raises.
    #
    # ⚠️ This is NOT `if schema_validation_ok`, the guard the auto-normalize step
    # above uses, and the difference is deliberate. A dollar-PnL upload with a
    # negative day (-329) ALSO fails the schema (`daily_return_lower_bound`), yet
    # its column is numeric and the sentinel's actionable "looks like dollar PnL,
    # convert each row" message is exactly what that user needs
    # (`test_dollar_form_daily_return_caught_by_sentinel`). Gating on schema
    # success would have replaced it with a bare row-0 bound rule.
    all_errors.extend(_check_sharpe_sentinel(df_validated, fmt))
    all_errors.extend(_check_dollar_form_sentinel(df_validated, fmt))
    # _check_trading_window REMOVED 2026-04-30 (crypto trades 24/7)

    ok = len(all_errors) == 0

    date_min, date_max = "", ""
    if "date" in df.columns:
        # `_detect_and_normalize_date_column` already converted `date` to
        # datetime64 for non-ISO files; only re-parse when it's still strings
        # (ISO / month-first / rejected paths) rather than a redundant pass.
        date_col = df["date"]
        if not pd.api.types.is_datetime64_any_dtype(date_col):
            date_col = _parse_dates(date_col)
        dates = date_col.dropna()
        if not dates.empty:
            date_min = str(dates.min().date())
            date_max = str(dates.max().date())
        # Give the preview back the text the user wrote in a cell whose zone was
        # rejected; the placeholder was only for the parse above.
        if zone_rejected and not pd.api.types.is_datetime64_any_dtype(df["date"]):
            df.loc[list(zone_rejected), "date"] = list(zone_rejected.values())

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
        # `date` is already datetime64 by here (normalized above and/or coerced
        # by pandera), so this is one vectorized strftime, not a per-row
        # pd.to_datetime reconvert.
        iso_dates = pd.to_datetime(valid["date"]).dt.strftime("%Y-%m-%d")
        daily_returns_series = [
            {"date": str(d), "daily_return": float(r)}
            for d, r in zip(iso_dates, valid["daily_return"])
        ]
    elif ok and fmt == "daily_nav" and "nav" in df_validated.columns:
        nav_series = df_validated[["date", "nav"]].dropna().copy()
        nav_series["return"] = nav_series["nav"].pct_change()
        valid = nav_series.dropna(subset=["return"])
        iso_dates = pd.to_datetime(valid["date"]).dt.strftime("%Y-%m-%d")
        daily_returns_series = [
            {"date": str(d), "daily_return": float(r)}
            for d, r in zip(iso_dates, valid["return"])
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
