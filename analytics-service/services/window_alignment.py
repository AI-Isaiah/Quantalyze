"""
B3 (audit-2026-05-07) — Shared window-coincident alignment helper.

Three independent paths — match scoring (``match_engine``),
simulator/portfolio impact (``simulator_scoring``), and the portfolio
bridge (``routers.portfolio``) — compute ``current_metric`` vs
``proposed_metric`` over a candidate-extended window. Pre-fix each path
inlined a near-identical pd.concat(..).dropna() + reindex pattern. The
small differences silently re-introduced the "compare current over the
full portfolio window vs proposed over the shorter intersection"
ranking bias (NEW-C08-01, NEW-C11-03) every time a refactor touched
one path but not the others.

This module is the single source of truth: a single ``align_current_and_proposed``
helper that returns the intersection-aligned portfolio frame plus the
candidate column, the candidate-only series at intersection dates, and the
overlap day count. Callers decide what to do when overlap is too short;
``align_current_and_proposed`` never silently truncates — when the
intersection is below the caller-supplied minimum, it returns
``AlignmentMetadata(overlap_days=N, sufficient=False, ...)`` so the
caller's "insufficient_data" branch fires loud rather than computing on a
mismatched window.

Why this matters in plain terms: a candidate strategy with a short, low-
vol history added to a long-history portfolio will manufacture an
artificial Sharpe lift if the current_port baseline is computed over the
FULL portfolio window while the new_port (with candidate) is forced to
the short intersection. Both metrics must be scored on the SAME window
for the delta to mean anything.
"""

from dataclasses import dataclass
from typing import Optional

import pandas as pd


@dataclass(frozen=True)
class AlignmentMetadata:
    """The shape of an aligned window, returned for caller-side disclosure.

    ``port_aligned`` and ``candidate_aligned`` reindex to the SAME
    intersection-of-dates index, so any per-bar comparison can index
    positionally without re-aligning. ``aligned_concat`` includes the
    candidate as a final column so callers that compute new portfolio
    weighted-sum metrics get a single DataFrame with the candidate
    already present.

    ``sufficient`` is False when overlap_days < min_overlap_days at the
    call site; the helper still returns the aligned frames so callers
    can render disclosure (e.g. "scored over 18 days, insufficient for
    publication") without re-doing the join.
    """

    overlap_days: int
    sufficient: bool
    # The portfolio columns, reindexed to the intersection date index.
    # All columns from ``port_df`` are present; rows are restricted to
    # dates where every column AND the candidate are non-null.
    port_aligned: pd.DataFrame
    # The candidate series, reindexed to the same intersection index.
    candidate_aligned: pd.Series
    # ``port_df`` columns + the candidate column appended. Convenient
    # for the proposed-portfolio weighted-sum compute. The candidate
    # column name matches ``candidate_id`` passed in.
    aligned_concat: pd.DataFrame


def align_current_and_proposed(
    port_df: pd.DataFrame,
    candidate_returns: pd.Series,
    *,
    candidate_id: str,
    min_overlap_days: int = 30,
) -> AlignmentMetadata:
    """Compute the intersection of portfolio + candidate dates and return
    the aligned views needed by the three downstream paths.

    Args:
        port_df: portfolio returns frame — one column per strategy, dates
            on the index. Caller is expected to have already applied any
            ``.dropna()`` it wants on the portfolio side.
        candidate_returns: the candidate strategy's daily-return series
            (DateIndex same kind as ``port_df`` index).
        candidate_id: column name to use for the candidate in
            ``aligned_concat``. Pass the strategy_id when you need a
            traceable name (simulator_scoring); pass a sentinel
            like ``"__cand__"`` when you only need positional access
            (match_engine).
        min_overlap_days: caller-defined floor; the loud-skip threshold.
            Defaults to 30 (MIN_DATA_POINTS used by both call sites).

    Returns:
        AlignmentMetadata. ``sufficient`` is False when the intersection
        is below ``min_overlap_days``; callers should branch on that to
        emit their domain-specific "insufficient data" result rather than
        computing metrics on a sub-floor window.
    """
    # Build the intersection by concatenating and dropping any row with
    # a NaN anywhere. ``dropna()`` is the conservative choice — pad/ffill
    # would invent observations the candidate never had.
    aligned_concat = pd.concat(
        [port_df, candidate_returns.rename(candidate_id)], axis=1
    ).dropna()
    overlap_days = int(len(aligned_concat))

    # Portfolio-only view at intersection dates. Slice by column list to
    # match the order ``port_df`` had on the way in (downstream weight
    # vectors index positionally).
    port_aligned = aligned_concat[list(port_df.columns)]
    candidate_aligned = aligned_concat[candidate_id]

    return AlignmentMetadata(
        overlap_days=overlap_days,
        sufficient=overlap_days >= min_overlap_days,
        port_aligned=port_aligned,
        candidate_aligned=candidate_aligned,
        aligned_concat=aligned_concat,
    )


# ----------------------------------------------------------------------
# Convenience: empty-overlap detection without building the frame.
# ----------------------------------------------------------------------
# Some callers (analytics-service/routers/portfolio.py covariance gate,
# NEW-C19-04) need the overlap day count BUT not the aligned views. They
# previously did ``len(pd.concat([a, b], axis=1).dropna())`` inline; the
# helper below is the readable replacement that avoids growing a second
# alignment idiom in the repo.

def overlap_days(
    port_df: pd.DataFrame,
    candidate_returns: Optional[pd.Series] = None,
) -> int:
    """Return the count of dates where every column AND the candidate
    are non-null. When ``candidate_returns`` is None, returns
    ``len(port_df.dropna())`` — the row-wise intersection of the
    portfolio columns alone.
    """
    if candidate_returns is None:
        return int(len(port_df.dropna()))
    return int(
        len(pd.concat([port_df, candidate_returns.rename("__overlap")], axis=1).dropna())
    )
