"""Phase 166's dispersion floor: the single source of truth for "does this series vary".

Phase 166.1 (D-03) moved the constant and the three functions below out of
``services/metrics.py`` verbatim, so every ratio-over-standard-deviation site in
analytics-service reads ONE floor instead of testing ``== 0`` on its own.

This module is a dependency-light leaf: numpy and pandas only, and no
``services`` import, so ``optimizer.py`` (declared PURE), ``csv_validator.py``
and ``allocated_capital.py`` can use the floor without pulling quantstats and
scipy in through ``services.metrics``.

Phase 166.1 plan 03 (D-02) adds the two correlation helpers at the bottom,
``pairwise_correlation_or_none`` and ``dispersing_corrwith``. A Pearson
correlation divides by BOTH legs' standard deviation, so it belongs to the same
class: pandas returns a residue correlation (measured 1.0 between two strategies
with the same compounding constant yield) instead of NaN.

``services/metrics.py`` re-binds the three FUNCTIONS under their old private
names (``_residue_floor``, ``_dispersion_is_residue``, ``_dispersion_is_real``)
and does NOT bind the constant at all (D-23, 2026-09-26 revision). Two
consequences:

- a monkeypatch of ``services.metrics._DISPERSION_RESIDUE_REL`` raises
  ``AttributeError`` instead of silently missing the floor;
- a monkeypatch of a re-bound name on ``services.metrics`` changes only the
  callers inside ``metrics.py``, never the functions here or the other sites.

So a neuter drill of the floor edits THIS file's source, and restores it from a
byte backup.
"""

from typing import Any, Optional

import numpy as np
import pandas as pd

#: A standard deviation at or below ``DISPERSION_RESIDUE_REL * max(1, |mean|)``
#: is float residue, not dispersion (``residue_floor``). Two residue scales exist
#: and the floor covers both:
#:
#: - a series built by REPEATING one float leaves about ``1e-16 * |mean|``
#:   (measured: 4.35e-19 for 120 days of a constant 0.001);
#: - a series built as ``E_t / E_{t-1} - 1`` from a compounding equity or NAV
#:   curve (``pct_change``, the way this platform gets most returns) leaves about
#:   ``1e-16`` ABSOLUTE, whatever the yield, because the rounding error is
#:   relative to the ratio ``1 + r``, not to ``r``.
#:
#: So the floor is 1e-12 in absolute terms for any ``|mean| <= 1`` and scales
#: with ``|mean|`` above that, four orders above either residue. The smallest
#: REAL dispersion pinned by a test is the quantisation noise of a cent-rounded
#: compounding NAV; see
#: ``test_q166r2_residue_floor_keeps_real_quantisation_dispersion``.
DISPERSION_RESIDUE_REL = 1e-12


def residue_floor(mean: Any) -> Any:
    """``DISPERSION_RESIDUE_REL * max(1, |mean|)``, for a scalar or elementwise.

    WHY ``max(1, |mean|)`` (Phase 166 review round 2, CR-01 / SFH R2-HIGH-1). The
    round-1 floor was ``1e-12 * |mean|``. That is right for repeated floats, but
    a return is a ratio to 1, so ``pct_change`` over an exactly compounding NAV
    leaves an ABSOLUTE ~1e-16 residue however small the yield. Scaled by a small
    ``|mean|`` the floor sank under that residue: a 1e-4 daily yield (about 3.7%
    APY, a stablecoin-lending shape) persisted a headline Sharpe of 1.49e13 with
    status ``ok`` and a PSR of 1.0. The reviewer's ``max(1.0, |mean|)`` and the
    SFH's ``1 + |mean|`` differ by at most a factor of 2 and agree on every
    measured input. ``max`` is taken because it keeps the floor EXACTLY at the
    round-1 value wherever ``|mean| >= 1``, so the only inputs it reclassifies
    are the small-mean residues the round-1 floor missed. A NaN ``mean`` gives a
    NaN floor, and every comparison against it is False.
    """
    return DISPERSION_RESIDUE_REL * np.maximum(1.0, np.abs(mean))


def dispersion_is_residue(sd: float, mean: float) -> bool:
    """True when ``sd`` is zero or only the float residue of a constant series.

    Phase 166 review (SFH HIGH-1): an exact ``== 0`` test misses a constant
    series whose ``std()`` comes back as ``~1e-19`` instead of ``0.0``, and the
    ratio over it is then a fabricated ``~1e16``. Callers treat True as "no
    dispersion", so a ratio over it is undefined (None), never a number. A NaN
    ``sd`` returns False: each caller handles NaN on its own path. The floor is
    ``residue_floor``.
    """
    return bool(sd <= residue_floor(mean))


def dispersion_is_real(sd: float, mean: float) -> bool:
    """True when ``sd`` is finite and above the residue floor: a leg that really moves.

    The complement of ``dispersion_is_residue`` EXCEPT on NaN, where both are
    False. A predicate that asks "does this leg vary" must answer False for a
    NaN ``sd`` (one row, or none), never "varies" (SFH R2-LOW-2).
    """
    return bool(sd > residue_floor(mean))


def _leg_disperses(leg: pd.Series) -> bool:
    """``dispersion_is_real`` over a leg's own std and mean (False on NaN)."""
    return dispersion_is_real(float(leg.std()), float(leg.mean()))


def pairwise_correlation_or_none(a: pd.Series, b: pd.Series) -> Optional[float]:
    """Pearson correlation of ``a`` and ``b``, or None when either leg does not disperse.

    Phase 166.1 (D-02). The legs are aligned by index and every row where either
    is missing is dropped, which is the rule ``Series.corr`` applies. The
    dispersion test runs on THOSE rows, so it judges exactly the numbers the
    correlation divides by. A leg whose dispersion is residue (or zero, or NaN
    because fewer than two rows overlap) defines no correlation: None, the same
    answer an all-zero leg gets from pandas today (NaN). A non-finite result is
    also None.
    """
    pair = pd.concat([a, b], axis=1, join="inner").dropna()
    x, y = pair.iloc[:, 0], pair.iloc[:, 1]
    if not (_leg_disperses(x) and _leg_disperses(y)):
        return None
    r = float(x.corr(y))
    return r if np.isfinite(r) else None


def dispersing_corrwith(frame: pd.DataFrame, target: pd.Series) -> pd.Series:
    """``frame.corrwith(target)`` restricted to columns whose correlation is defined.

    Phase 166.1 (D-02), the ``corrwith`` form of ``pairwise_correlation_or_none``
    with the same rule: per column, the rows where both the column and
    ``target`` are present, and both legs must disperse on those rows. A column
    that fails is DROPPED (not NaN), so a caller's ``idxmax`` never sees it.
    When ``target`` itself does not disperse, every column fails the same rule
    and the result is an EMPTY float Series: no candidate can correlate with a
    leg that does not move. Measured before this helper: two strategies with the
    same compounding constant yield ``corrwith`` each other at 1.0, above the
    0.95 match threshold.
    """
    common = frame.index.intersection(target.index)
    frame, target = frame.loc[common], target.loc[common]
    kept = []
    for col in frame.columns:
        pair = pd.concat([frame[col], target], axis=1).dropna()
        if _leg_disperses(pair.iloc[:, 0]) and _leg_disperses(pair.iloc[:, 1]):
            kept.append(col)
    if not kept:
        return pd.Series(dtype=float)
    return frame[kept].corrwith(target).astype(float)


def average_pairwise_correlation(frame: pd.DataFrame) -> tuple[Optional[float], int, int]:
    """Mean Pearson correlation over the DEFINED pairs of ``frame``'s columns.

    Returns ``(mean, pairs_used, pairs_total)``. Phase 166.1 round-1 WR-03 /
    SFH MEDIUM-1: the ONE rule for "average pairwise correlation", shared by
    the scorers (``portfolio_optimizer._avg_corr``) and the portfolio risk
    panel (``portfolio_risk.compute_avg_pairwise_correlation_with_pairs``). A
    column that does not disperse defines no correlation with anything, so
    every pair it is in is SKIPPED, as is a pair whose correlation is not
    finite. The mean is over the pairs that remain, and ``pairs_used`` states
    how many that is out of ``pairs_total = n(n-1)/2``, so a caller can say
    the average covers a subset. ``mean`` is None when no pair is defined.

    The frame is taken as already aligned (every caller passes a ``dropna``'d
    frame), so a column's own dispersion is the dispersion on the rows each
    of its pairs uses.
    """
    n = frame.shape[1]
    pairs_total = n * (n - 1) // 2
    moving = [c for c in frame.columns if _leg_disperses(frame[c])]
    if len(moving) < 2:
        return None, 0, pairs_total
    corr = frame[moving].corr().to_numpy()
    upper = corr[np.triu_indices(len(moving), k=1)]
    defined = upper[np.isfinite(upper)]
    if defined.size == 0:
        return None, 0, pairs_total
    return float(defined.mean()), int(defined.size), pairs_total
