"""Reusable old-vs-new series-diff + delta-bucket classifier (ACC-01 infrastructure).

Phase 73 (v1.8 Flow-Aware TWR). This is the small, isolated primitive that the
Phase 78 golden old-vs-new parity harness will consume — RESEARCH Open Question 2
recommends standing it up early to de-risk that hard gate. It is PURE and
I/O-free: it compares two return Series (plus their scalar CAGR/Calmar metrics)
and assigns the delta to exactly one of four fixed buckets.

  NOTE: the multi-venue panel, real-account fixtures, and the live parity run
  are explicitly Phase 78 — NOT built here. ACC-01 gates/completes in Phase 78.

Bucket taxonomy (ROADMAP Phase 78 SC-1 / REQUIREMENTS ACC-01):

  (a) flow-less account   -> daily return SERIES unchanged (within rtol)      => "unchanged"
  (b) TWR-05 reannualize  -> series unchanged, CAGR/Calmar shift by the known
                             365/252 calendar factor (metrics.py TWR-05 split) => "reannualization"
  (c) flow-heavy account  -> series MUST materially move and is now honest     => "flow_moved"
  anything else                                                               => "unexplained"

The Phase 78 gate must classify EVERY delta into one expected bucket and accept
NO unexplained movement. The default disposition is therefore FAIL-CLOSED: a
movement that matches no known bucket is "unexplained" (T-73-04) — a
misclassified regression sneaking through as "unchanged" is the harm class, so
"unexplained" is never reached by silent fallthrough, only by explicit
non-match.

Why an external ``has_flows`` signal: reannualization changes the scalar metrics
but NOT the return series; a moved series is therefore either an honest
flow-driven move (flow-heavy account) or a regression (flow-less account that
must NOT have moved). Those two are indistinguishable from the series alone, so
the caller (the Phase 78 harness, which knows each account's flow status) passes
``has_flows``. A moved series with flows is "flow_moved"; a moved series without
flows is "unexplained".

Purity: stdlib ``typing`` + pandas + numpy only. No panel, no fixtures, no live
run, no I/O.
"""
from typing import Mapping, Optional

import numpy as np
import pandas as pd

# --- Fixed bucket labels (Phase 78 imports these instead of restating literals) ---
UNCHANGED = "unchanged"
REANNUALIZATION = "reannualization"
FLOW_MOVED = "flow_moved"
UNEXPLAINED = "unexplained"

# The complete, closed taxonomy. classify_delta always returns a member of this set.
BUCKET_LABELS = frozenset({UNCHANGED, REANNUALIZATION, FLOW_MOVED, UNEXPLAINED})

# The known TWR-05 calendar-clock exponent: on a dense-daily series metrics.py
# shifts CAGR from the 252-basis to the 365-calendar basis, i.e.
# ``new_cagr = (1 + old_cagr) ** (365/252) - 1`` (see metrics.py TWR-05 split and
# the rescale proof at test_metrics_parity.py). Calmar shares the CAGR basis
# (calmar = cagr / |max_dd|), so a reannualized Calmar shifts consistently.
REANNUALIZATION_FACTOR = 365.0 / 252.0

# Default tolerances. The series "unchanged" check uses a tight relative
# tolerance (byte-identity intent); the reannualization metric check is looser
# because CAGR/Calmar accumulate more floating error through the exponent.
_DEFAULT_RTOL = 1e-9
_DEFAULT_REANN_RTOL = 1e-6
_DEFAULT_ATOL = 1e-12


def _series_unchanged(old: pd.Series, new: pd.Series, rtol: float) -> bool:
    """True iff the two return Series are equal within ``rtol`` (index + values).

    Uses ``pandas.testing.assert_series_equal`` — the natural "unchanged"
    primitive named in the plan interfaces. A differing index (length,
    ordering, or timestamps) counts as changed, i.e. NOT unchanged.
    """
    try:
        pd.testing.assert_series_equal(
            old,
            new,
            check_exact=False,
            rtol=rtol,
            atol=_DEFAULT_ATOL,
            check_names=False,
            check_dtype=False,
        )
        return True
    except AssertionError:
        return False


def _metric(metrics: Optional[Mapping[str, Optional[float]]], key: str) -> Optional[float]:
    if metrics is None:
        return None
    return metrics.get(key)


def _close(a: Optional[float], b: Optional[float], rtol: float) -> bool:
    """Tolerant scalar equality where a missing value on BOTH sides is 'equal'."""
    if a is None or b is None:
        return a is None and b is None
    return bool(np.isclose(float(a), float(b), rtol=rtol, atol=_DEFAULT_ATOL))


def _metrics_unchanged(
    old_metrics: Optional[Mapping[str, Optional[float]]],
    new_metrics: Optional[Mapping[str, Optional[float]]],
    rtol: float,
) -> bool:
    """True iff CAGR and Calmar are both unchanged (or absent on both sides)."""
    if old_metrics is None and new_metrics is None:
        return True
    return _close(_metric(old_metrics, "cagr"), _metric(new_metrics, "cagr"), rtol) and _close(
        _metric(old_metrics, "calmar"), _metric(new_metrics, "calmar"), rtol
    )


def _reannualize_cagr(old_cagr: float, factor: float) -> float:
    """Apply the known 365/252 calendar-clock shift to a CAGR value."""
    return float((1.0 + old_cagr) ** factor - 1.0)


def _matches_reannualization(
    old_metrics: Optional[Mapping[str, Optional[float]]],
    new_metrics: Optional[Mapping[str, Optional[float]]],
    factor: float,
    rtol: float,
) -> bool:
    """True iff the CAGR (and, when present, Calmar) shift is exactly the 365/252 factor.

    CAGR must move from ``old_cagr`` to ``(1+old_cagr)**factor - 1``. When Calmar
    is supplied on both sides it must move consistently: since
    ``calmar = cagr / |max_dd|`` and ``|max_dd|`` is unchanged (the series is
    unchanged), ``new_calmar == expected_cagr * old_calmar / old_cagr``.
    """
    old_cagr = _metric(old_metrics, "cagr")
    new_cagr = _metric(new_metrics, "cagr")
    if old_cagr is None or new_cagr is None:
        return False

    expected_cagr = _reannualize_cagr(float(old_cagr), factor)
    if not _close(new_cagr, expected_cagr, rtol):
        return False

    old_calmar = _metric(old_metrics, "calmar")
    new_calmar = _metric(new_metrics, "calmar")
    if old_calmar is None and new_calmar is None:
        return True  # CAGR-only reannualization is sufficient
    if old_calmar is None or new_calmar is None:
        return False  # Calmar present on only one side is not a clean reannualization

    if float(old_cagr) == 0.0:
        # Degenerate base: a real reannualization leaves a zero CAGR at zero, so
        # Calmar must be unchanged too.
        return _close(new_calmar, old_calmar, rtol)

    expected_calmar = expected_cagr * float(old_calmar) / float(old_cagr)
    return _close(new_calmar, expected_calmar, rtol)


def classify_delta(
    old_returns: pd.Series,
    new_returns: pd.Series,
    *,
    old_metrics: Optional[Mapping[str, Optional[float]]] = None,
    new_metrics: Optional[Mapping[str, Optional[float]]] = None,
    has_flows: bool = False,
    rtol: float = _DEFAULT_RTOL,
    reannualization_factor: float = REANNUALIZATION_FACTOR,
    reannualization_rtol: float = _DEFAULT_REANN_RTOL,
) -> str:
    """Classify an old-vs-new return delta into exactly one Phase 78 bucket.

    Args:
        old_returns, new_returns: aligned daily return Series (DatetimeIndex).
        old_metrics, new_metrics: optional ``{"cagr": ..., "calmar": ...}``
            mappings; values may be ``None``. Only consulted when the series
            itself is unchanged (reannualization lives entirely in the scalars).
        has_flows: whether the account is KNOWN to carry external cash flows.
            Disambiguates a moved series: with flows the move is honest
            ("flow_moved"); without flows it is a regression ("unexplained").
        rtol: relative tolerance for the series-unchanged comparison.
        reannualization_factor: the calendar-clock CAGR exponent (default 365/252).
        reannualization_rtol: relative tolerance for the reannualization check.

    Returns:
        One of :data:`UNCHANGED`, :data:`REANNUALIZATION`, :data:`FLOW_MOVED`,
        :data:`UNEXPLAINED` — always a member of :data:`BUCKET_LABELS`.
    """
    if _series_unchanged(old_returns, new_returns, rtol):
        # The return series did not move: any delta is in the scalar metrics.
        if _metrics_unchanged(old_metrics, new_metrics, rtol):
            return UNCHANGED
        if _matches_reannualization(
            old_metrics, new_metrics, reannualization_factor, reannualization_rtol
        ):
            return REANNUALIZATION
        # Series identical but metrics moved by something other than the known
        # factor: fail closed.
        return UNEXPLAINED

    # The return series moved materially. Only an account with external flows is
    # allowed to move honestly; a flow-less account that moved is a regression.
    if has_flows:
        return FLOW_MOVED
    return UNEXPLAINED
