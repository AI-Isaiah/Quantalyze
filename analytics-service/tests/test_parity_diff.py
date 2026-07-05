"""Unit tests for the ACC-01 series-diff / delta-bucket classifier primitive.

Phase 73 (v1.8 Flow-Aware TWR). This pins the four Phase 78 golden-parity
buckets on synthetic series — ONE test per bucket, plus the fail-closed and
tolerance edges. The multi-venue panel and the live parity run are Phase 78;
this file only exercises the reusable classifier.

Bucket taxonomy (ROADMAP Phase 78 SC-1 / REQUIREMENTS ACC-01):
  (a) flow-less account   -> daily return SERIES unchanged                 => "unchanged"
  (b) TWR-05 reannualize  -> CAGR/Calmar shift by the known 365/252 factor => "reannualization"
  (c) flow-heavy account  -> series MUST move and is now honest            => "flow_moved"
  anything else (fail-closed default)                                      => "unexplained"
"""
import numpy as np
import pandas as pd
import pytest

from services.parity_diff import (
    BUCKET_LABELS,
    FLOW_MOVED,
    REANNUALIZATION,
    REANNUALIZATION_FACTOR,
    UNCHANGED,
    UNEXPLAINED,
    classify_delta,
)


def _returns(values):
    """Build a daily-DatetimeIndex return Series from a list of floats."""
    idx = pd.date_range("2024-01-01", periods=len(values), freq="D", tz="UTC")
    return pd.Series(values, index=idx, name="returns")


def _reannualize(cagr):
    """The exact TWR-05 calendar-clock CAGR shift (metrics.py: 365/252 exponent)."""
    return (1.0 + cagr) ** REANNUALIZATION_FACTOR - 1.0


def test_bucket_labels_are_the_four_fixed_constants():
    """Phase 78 imports the labels; the taxonomy is exactly four fixed strings."""
    assert BUCKET_LABELS == frozenset(
        {UNCHANGED, REANNUALIZATION, FLOW_MOVED, UNEXPLAINED}
    )


def test_identical_series_classifies_unchanged():
    """(a) A flow-less account: byte-identical old/new series -> 'unchanged'."""
    old = _returns([0.01, -0.02, 0.03, 0.005])
    new = _returns([0.01, -0.02, 0.03, 0.005])
    assert classify_delta(old, new) == UNCHANGED


def test_series_within_tolerance_classifies_unchanged():
    """Sub-rtol floating noise is still 'unchanged', not a regression."""
    old = _returns([0.01, -0.02, 0.03, 0.005])
    new = _returns([0.01 + 1e-13, -0.02, 0.03, 0.005 - 1e-13])
    assert classify_delta(old, new, rtol=1e-9) == UNCHANGED


def test_series_identical_metrics_unchanged_is_unchanged():
    """Same series AND same CAGR/Calmar -> 'unchanged' even with metrics supplied."""
    s = _returns([0.01, -0.02, 0.03, 0.005])
    m = {"cagr": 0.20, "calmar": 2.0}
    assert classify_delta(s, s, old_metrics=m, new_metrics=dict(m)) == UNCHANGED


def test_known_365_over_252_factor_classifies_reannualization():
    """(b) Series unchanged; CAGR/Calmar shifted by the known 365/252 factor."""
    s = _returns([0.01, -0.02, 0.03, 0.005])
    old_cagr = 0.20
    max_dd = 0.10  # calmar = cagr / |max_dd|
    old_metrics = {"cagr": old_cagr, "calmar": old_cagr / max_dd}
    new_cagr = _reannualize(old_cagr)
    new_metrics = {"cagr": new_cagr, "calmar": new_cagr / max_dd}
    assert (
        classify_delta(s, s, old_metrics=old_metrics, new_metrics=new_metrics)
        == REANNUALIZATION
    )


def test_reannualization_holds_within_tolerance():
    """A tiny fp perturbation on the reannualized CAGR still reads 'reannualization'."""
    s = _returns([0.01, -0.02, 0.03, 0.005])
    old_cagr = 0.35
    old_metrics = {"cagr": old_cagr, "calmar": None}
    new_metrics = {"cagr": _reannualize(old_cagr) * (1 + 1e-9), "calmar": None}
    assert (
        classify_delta(s, s, old_metrics=old_metrics, new_metrics=new_metrics)
        == REANNUALIZATION
    )


def test_flow_heavy_moved_series_classifies_flow_moved():
    """(c) A materially moved series on an account KNOWN to have flows -> 'flow_moved'."""
    old = _returns([0.01, -0.02, 0.03, 0.005])
    new = _returns([0.40, -0.35, 0.12, 0.08])  # honest, flow-driven movement
    assert classify_delta(old, new, has_flows=True) == FLOW_MOVED


def test_moved_series_without_flows_is_unexplained():
    """A flow-less account whose series MOVED is a regression -> 'unexplained' (fail-closed)."""
    old = _returns([0.01, -0.02, 0.03, 0.005])
    new = _returns([0.40, -0.35, 0.12, 0.08])
    assert classify_delta(old, new, has_flows=False) == UNEXPLAINED


def test_series_unchanged_but_arbitrary_metric_shift_is_unexplained():
    """Same series, but CAGR moved by something OTHER than the known factor -> 'unexplained'."""
    s = _returns([0.01, -0.02, 0.03, 0.005])
    old_metrics = {"cagr": 0.20, "calmar": 2.0}
    new_metrics = {"cagr": 0.20 * 3.7, "calmar": 2.0 * 3.7}  # not the 365/252 factor
    assert (
        classify_delta(s, s, old_metrics=old_metrics, new_metrics=new_metrics)
        == UNEXPLAINED
    )


def test_reannualization_requires_calmar_consistency():
    """CAGR reannualized but Calmar shifted inconsistently -> NOT reannualization."""
    s = _returns([0.01, -0.02, 0.03, 0.005])
    old_cagr = 0.20
    old_metrics = {"cagr": old_cagr, "calmar": old_cagr / 0.10}
    new_cagr = _reannualize(old_cagr)
    # Calmar deliberately wrong (uses a different, inconsistent drawdown basis).
    new_metrics = {"cagr": new_cagr, "calmar": new_cagr / 0.25}
    assert (
        classify_delta(s, s, old_metrics=old_metrics, new_metrics=new_metrics)
        == UNEXPLAINED
    )


def test_every_result_is_a_declared_bucket_label():
    """Whatever the inputs, the return is always one of the four fixed labels."""
    old = _returns([0.01, -0.02, 0.03])
    new = _returns([0.02, -0.01, 0.04])
    for has_flows in (True, False):
        assert classify_delta(old, new, has_flows=has_flows) in BUCKET_LABELS
