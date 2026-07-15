"""Tests for analytics-service/services/analytics_runner.py.

The trades-based ``run_strategy_analytics`` chain was deleted in Stage B
(Phase 106-09); its end-to-end integration tests went with it. What remains
here exercises the retained, runner-independent computation units and the
live CSV/backbone path:

- the metric-computation helpers (derived-trade metrics, volume aggregator,
  trade-mix, position-side volume pcts, has-maker-taker coverage,
  trade-mix-approximate) as direct unit tests;
- ``_load_position_time_series`` NAV-safety unit tests
  (``TestLoadPositionTimeSeriesNavSafety``);
- the ``run_csv_strategy_analytics`` CSV path (sibling-upsert + status
  promotion) and the ``MetricsResult`` contract / sibling-kinds RPC
  privilege source-pins.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
import math
import pathlib
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import numpy as np
import pytest
from supabase import Client

from services.metrics import MetricsResult

# ---------------------------------------------------------------------------
# Audit-2026-05-07 H-0770 — MetricsResult contract shape pin
# ---------------------------------------------------------------------------
# The MetricsResult literals scattered through these tests embed legacy
# series keys (`metrics_json`, `returns_series`, `drawdown_series`,
# `monthly_returns`, `rolling_metrics`, `return_quantiles`) INSIDE the
# `metrics_json` dict — a transitional (Phase 12) shape. The production
# contract is the dataclass itself: exactly TWO fields, `metrics_json`
# (top-level dict spread into strategy_analytics) and `sibling_kinds`
# (split-storage series keyed by kind). This test pins that contract via
# dataclasses.fields() so:
#   - a third dataclass field added in production (drifting the contract the
#     mock literals encode) fails loudly here, AND
#   - the split-storage invariant (`sibling_kinds` is NOT proxied by
#     subscript / `in`) stays locked, catching a mechanical
#     `result.sibling_kinds[k]` → `result[k]` refactor.


def test_metrics_result_dataclass_contract_shape():
    """Pin the real MetricsResult dataclass shape so the mock literals used
    throughout this module can't silently diverge from production."""
    assert dataclasses.is_dataclass(MetricsResult)

    field_names = {f.name for f in dataclasses.fields(MetricsResult)}
    assert field_names == {"metrics_json", "sibling_kinds", "insufficient_window"}, (
        "MetricsResult contract drifted. The mock literals in this module "
        "encode `MetricsResult(metrics_json=..., sibling_kinds=...)`; a new "
        "or renamed field means those mocks no longer match production. "
        "HARD-04 (#67) added `insufficient_window: bool = False` — a DQ "
        "annotation lifted into data_quality_flags, NOT a metrics_json key. "
        f"Got fields: {sorted(field_names)}"
    )

    # All fields default (dict factories + insufficient_window=False) so
    # MetricsResult() is constructible with no args — relied on by callers.
    empty = MetricsResult()
    assert empty.metrics_json == {}
    assert empty.sibling_kinds == {}
    assert empty.insufficient_window is False

    # Split-storage invariant: subscript / `in` proxy ONLY to metrics_json.
    # A series key that lives in sibling_kinds must NOT be visible via the
    # bare-dict compatibility shim (D-01/D-02). This is the exact misuse the
    # production __getitem__ guards against.
    result = MetricsResult(
        metrics_json={"sharpe": 1.5},
        sibling_kinds={"exposure_series": [{"date": "2024-01-15", "gross": 1.0}]},
    )
    assert "sharpe" in result
    assert result["sharpe"] == 1.5
    assert "exposure_series" not in result, (
        "sibling_kinds keys must NOT be visible via `in` (split storage)."
    )
    with pytest.raises(KeyError):
        # Subscripting a sibling_kinds-only key must raise, not silently
        # return it — guards the mechanical .sibling_kinds[k] → [k] refactor.
        _ = result["exposure_series"]


# ---------------------------------------------------------------------------
# Audit-2026-05-07 H-0762 — sibling-kinds RPC privilege posture (source pin)
# ---------------------------------------------------------------------------
# A MagicMock-backed runner test can only record that
# `supabase.rpc("upsert_strategy_analytics_series_batch", ...)` was called
# with the right shape — the client is a MagicMock, so it proves NOTHING
# about WHO is allowed to call that SECURITY DEFINER RPC. A
# migration flipping it to SECURITY INVOKER, or (the S15g PUBLIC-grant-no-op
# chain) re-widening EXECUTE to public/anon/authenticated AFTER the canonical
# REVOKE, would gate-pass every one of those mock tests.
#
# The live-DB posture is covered by the pgTAP-style probes in
# supabase/tests/test_upsert_strategy_analytics_series_batch_privilege.sql and
# analytics-service/tests/test_upsert_strategy_analytics_series_batch_privilege.py.
# This static-source pin lives IN the file the finding flagged so the
# privilege regression is fail-loud even when those companion jobs are
# skipped, and specifically closes a gap they leave open: the existing static
# check only asserts the REVOKE line EXISTS. A later
# `GRANT EXECUTE ... TO public` on the SAME function (a privilege no-op of the
# REVOKE) would keep that REVOKE line intact and still re-open the surface.
# Here we scan EVERY grant statement that targets this function and assert
# none of them grants to a non-service_role principal.

_SERIES_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260428120919_strategy_analytics_series.sql"
)

_BATCH_RPC = "upsert_strategy_analytics_series_batch"


def test_sibling_batch_rpc_security_definer_and_not_publicly_granted():
    """H-0762: pin the privilege posture of the sibling-kinds batch RPC at the
    migration-source layer so the MagicMock runner tests can't mask a
    privilege regression.

    Catches three concrete regressions:
      1. SECURITY DEFINER → SECURITY INVOKER on the RPC body.
      2. Loss of the canonical
         `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
      3. The S15g chain: a NEW `GRANT EXECUTE ... ON FUNCTION
         upsert_strategy_analytics_series_batch ... TO public/anon/authenticated`
         that re-widens the surface even though the REVOKE line is still
         present (a privilege no-op the existing REVOKE-line regex check
         would NOT catch).
    """
    src = _SERIES_MIGRATION_PATH.read_text(encoding="utf-8")

    # The function must exist and declare SECURITY DEFINER + a pinned
    # search_path. Match the preamble through `AS $$` (non-greedy stops at
    # LANGUAGE, before SECURITY DEFINER on the next line).
    block = re.search(
        r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+" + _BATCH_RPC + r"\b[\s\S]*?AS\s+\$\$",
        src,
        re.IGNORECASE,
    )
    assert block, (
        f"{_BATCH_RPC} definition not found in {_SERIES_MIGRATION_PATH.name}; "
        "the runner tests below mock this RPC and would silently pass if it "
        "were renamed or dropped."
    )
    assert re.search(r"SECURITY\s+DEFINER", block.group(0), re.IGNORECASE), (
        f"{_BATCH_RPC} must be SECURITY DEFINER. Flipping to SECURITY INVOKER "
        "would break every legitimate service-role upsert AND, combined with a "
        "GRANT widening, open a privilege-bypass on a table with no RLS — yet "
        "the MagicMock runner tests would still pass."
    )

    # Canonical REVOKE present (defense in depth; the companion privilege test
    # owns the exhaustive REVOKE assertion).
    assert re.search(
        r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+" + _BATCH_RPC
        + r"[^;]*FROM\s+[^;]*PUBLIC",
        src,
        re.IGNORECASE | re.DOTALL,
    ), f"Canonical REVOKE ALL ... FROM PUBLIC on {_BATCH_RPC} is missing."

    # The S15g no-op chain guard: enumerate EVERY GRANT EXECUTE statement that
    # targets this function and assert each one grants ONLY to service_role.
    # A re-widening `GRANT EXECUTE ... TO public` added after the REVOKE would
    # be a no-op of that REVOKE yet pass any check that only looks for the
    # REVOKE line.
    grant_stmts = re.findall(
        r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+" + _BATCH_RPC + r"\b[^;]*?TO\s+([^;]+)",
        src,
        re.IGNORECASE | re.DOTALL,
    )
    assert grant_stmts, (
        f"Expected at least one GRANT EXECUTE ... TO service_role on {_BATCH_RPC}."
    )
    forbidden = {"public", "anon", "authenticated"}
    for grantees_clause in grant_stmts:
        grantees = {
            g.strip().lower()
            for g in grantees_clause.replace("\n", " ").split(",")
            if g.strip()
        }
        leaked = grantees & forbidden
        assert not leaked, (
            f"H-0762 / S15g regression: {_BATCH_RPC} is GRANTed EXECUTE to "
            f"{sorted(leaked)} — a privilege widening that re-opens the "
            "no-RLS sibling table to non-service callers and is a no-op of the "
            "REVOKE above. The MagicMock runner tests cannot see this."
        )
        assert "service_role" in grantees, (
            f"Every GRANT EXECUTE on {_BATCH_RPC} must target service_role only; "
            f"got grantees {sorted(grantees)}."
        )


def _sample_inputs():
    """Builds (volume_metrics, trade_metrics_from_positions) shaped per B-01 path (b).

    The position-side dict mirrors the extended `reconstruct_positions` return
    shape (Plan 12-05 Task 1 adds avg_winning_trade / avg_losing_trade /
    winners_count / losers_count / realized_pnl_per_trade alongside the
    existing legacy keys).
    """
    volume_metrics = {
        "buy_volume_pct": 0.55,
        "sell_volume_pct": 0.45,
        "long_volume_pct": 0.55,
        "short_volume_pct": 0.45,
        "total_fills": 250,
        "total_volume_usd": 250000.0,
    }
    trade_metrics_from_positions = {
        "total_positions": 50,
        "open_positions": 0,
        "closed_positions": 50,
        "win_rate": 0.6,
        "avg_roi": 0.025,
        "avg_duration_days": 4.0,
        "long_count": 28,
        "short_count": 22,
        "best_trade_roi": 0.40,
        "worst_trade_roi": -0.18,
        # Phase 12 extension (Plan 12-05 adds these to reconstruct_positions):
        "avg_winning_trade": 0.05,    # avg ROI of winners
        "avg_losing_trade": -0.025,   # avg ROI of losers (signed, negative)
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 100.0},
            {"side": "long", "realized_pnl": -50.0},
            {"side": "short", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -75.0},
            {"side": "long", "realized_pnl": 25.0},
            {"side": "short", "realized_pnl": -10.0},
        ] * 10,  # 60 closed positions; representative
    }
    return volume_metrics, trade_metrics_from_positions


def test_derived_trade_metrics_expectancy():
    """METRICS-07: expectancy = (win_rate × avg_win) - ((1-win_rate) × |avg_loss|)."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "expectancy" in result
    wr = t["win_rate"]
    avg_w = t["avg_winning_trade"]
    avg_l = t["avg_losing_trade"]
    expected = wr * avg_w - (1 - wr) * abs(avg_l)
    assert abs(result["expectancy"] - expected) < 1e-6


def test_derived_trade_metrics_risk_reward_ratio():
    """METRICS-07: R:R = avg_win / |avg_loss|."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "risk_reward_ratio" in result
    avg_w = t["avg_winning_trade"]
    avg_l = t["avg_losing_trade"]
    assert abs(result["risk_reward_ratio"] - avg_w / abs(avg_l)) < 1e-6


def test_derived_trade_metrics_weighted_risk_reward_ratio():
    """METRICS-07 (H-F): Weighted R:R is the pnl-weighted average of per-trade
    R-multiples: Σ(R_i × |pnl_i|) / Σ|pnl_i|.

    Audit-2026-05-07 H-0627 / H-0628 ratchet: the previous formulation
    `(avg_win × winners_count) / (|avg_loss| × losers_count)` is algebraically
    identical to Profit Factor and was reporting the same number under two
    labels. The new pnl-weighted formula varies independently of Profit Factor
    when individual trade magnitudes are heterogeneous.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "weighted_risk_reward_ratio" in result

    risk_unit = abs(t["avg_losing_trade"])
    if risk_unit == 0 or not t["realized_pnl_per_trade"]:
        assert result["weighted_risk_reward_ratio"] is None
        return

    num = 0.0
    den = 0.0
    for trade in t["realized_pnl_per_trade"]:
        pnl = float(trade["realized_pnl"])
        r = pnl / risk_unit
        w = abs(pnl)
        num += r * w
        den += w
    expected = num / den if den > 0 else None
    if expected is None:
        assert result["weighted_risk_reward_ratio"] is None
    else:
        assert abs(result["weighted_risk_reward_ratio"] - expected) < 1e-6


def test_weighted_rr_is_not_algebraically_profit_factor():
    """Audit-2026-05-07 H-0627 / H-0628: the genuine pnl-weighted R:R formula
    must produce a number distinct from Profit Factor when per-trade
    magnitudes are heterogeneous. Construct a deliberately asymmetric cohort
    and assert the two metrics diverge."""
    from services.analytics_runner import _compute_derived_trade_metrics

    t = {
        "win_rate": 0.5,
        "avg_winning_trade": 100.0,
        "avg_losing_trade": -50.0,
        "winners_count": 2,
        "losers_count": 2,
        # Heterogeneous magnitudes — large winners + small winners + medium
        # losers. The old (broken) formula collapses to gross_profit/|gross_loss|;
        # the new pnl-weighted formula weights each trade's R by its own |pnl|.
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 500.0},
            {"side": "long", "realized_pnl": 10.0},
            {"side": "short", "realized_pnl": -100.0},
            {"side": "short", "realized_pnl": -50.0},
        ],
    }
    result = _compute_derived_trade_metrics({}, t)

    # Compute Profit Factor (aggregate, both sides).
    pnls = [trade["realized_pnl"] for trade in t["realized_pnl_per_trade"]]
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    profit_factor = gross_profit / gross_loss
    weighted_rr = result["weighted_risk_reward_ratio"]

    assert weighted_rr is not None
    # The whole point: the two MUST diverge on heterogeneous magnitudes.
    assert abs(weighted_rr - profit_factor) > 1e-3, (
        "weighted_risk_reward_ratio must not equal Profit Factor for "
        f"heterogeneous trade magnitudes; got weighted_rr={weighted_rr} "
        f"profit_factor={profit_factor}"
    )


def test_derived_trade_metrics_sqn():
    """METRICS-08: SQN = (mean(R)/std(R)) × sqrt(min(N,100)) over closed positions.

    Audit-2026-05-07 H-0766 ratchet: the prior assertion only checked
    `is None or isinstance(..., float)` — against `_sample_inputs()` (60
    closed positions) the None branch is unreachable and the float branch
    passes for ANY float, so a formula off by 2× (e.g. sqrt(N) instead of
    sqrt(min(N,100)), or population vs sample variance) would slip through.
    Pin the ABSOLUTE value, computed independently from the same fixture
    with the canonical Van Tharp formula (sample variance, N-1 denom).
    """
    import math

    from services.analytics_runner import (
        _compute_derived_trade_metrics,
        SQN_TRADE_COUNT_CAP,
    )

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "sqn" in result

    # Independently recompute SQN from the fixture: R = realized_pnl /
    # |avg_loss|, mean/std over R-multiples (N-1 sample variance), scaled by
    # sqrt(min(N, cap)).
    risk_unit = abs(t["avg_losing_trade"])
    r_multiples = [
        tr["realized_pnl"] / risk_unit for tr in t["realized_pnl_per_trade"]
    ]
    n = len(r_multiples)
    assert n == 60  # fixture invariant — 6-element pattern × 10
    mean_r = sum(r_multiples) / n
    var_r = sum((r - mean_r) ** 2 for r in r_multiples) / (n - 1)
    std_r = math.sqrt(var_r)
    expected_sqn = (mean_r / std_r) * math.sqrt(min(n, SQN_TRADE_COUNT_CAP))

    assert result["sqn"] == pytest.approx(expected_sqn), (
        f"SQN must equal (mean(R)/std(R)) × sqrt(min(N,{SQN_TRADE_COUNT_CAP})); "
        f"expected {expected_sqn}, got {result['sqn']}"
    )


def test_derived_trade_metrics_sqn_caps_at_sqrt_100():
    """Audit-2026-05-07 H-0652 regression — SQN scaling factor is capped at
    sqrt(min(N, 100)), NOT the academic sqrt(N).

    Build two cohorts with IDENTICAL R-multiple shape (same mean and std)
    but different N. If the cap is active, sqn(N=200) / sqn(N=50) ==
    sqrt(100)/sqrt(50) == sqrt(2). Without the cap, the ratio would be
    sqrt(200)/sqrt(50) == 2. A future refactor that drops the cap would
    fail THIS test specifically (assertNotEqual on the wrong-formula
    ratio).
    """
    import math

    from services.analytics_runner import _compute_derived_trade_metrics

    # Asymmetric pattern produces positive mean R-multiple so SQN ≠ 0.
    # [+15, -10] alternating, avg_loss=-10 → risk_unit=10 → R = [1.5, -1.0].
    # Identical (mean_R, std_R) across N, so any SQN scale ratio comes
    # purely from sqrt(min(N, cap)).
    def _pnls(n: int) -> list[dict]:
        pattern = [15.0, -10.0]
        return [
            {"side": "long", "realized_pnl": pattern[i % 2]}
            for i in range(n)
        ]

    v = {
        "buy_volume_pct": 50.0, "sell_volume_pct": 50.0,
        "long_volume_pct": 100.0, "short_volume_pct": 0.0,
        "total_fills": 0, "total_volume_usd": 0.0,
    }
    base_metrics = {
        "win_rate": 0.5,
        "avg_winning_trade": 15.0,
        "avg_losing_trade": -10.0,
        "winners_count": 0,  # set below
        "losers_count": 0,   # set below
    }

    t50 = {**base_metrics, "winners_count": 25, "losers_count": 25,
           "realized_pnl_per_trade": _pnls(50)}
    t200 = {**base_metrics, "winners_count": 100, "losers_count": 100,
            "realized_pnl_per_trade": _pnls(200)}

    sqn_50 = _compute_derived_trade_metrics(v, t50)["sqn"]
    sqn_200 = _compute_derived_trade_metrics(v, t200)["sqn"]

    assert sqn_50 is not None and sqn_200 is not None
    # With cap: ratio ≈ sqrt(100/50) ≈ 1.414. Without cap: ratio ≈
    # sqrt(200/50) ≈ 2.0. Slight deviation from the exact ratio arises
    # from the N-1 sample-variance denominator differing between cohorts;
    # 2% relative tolerance keeps the assertion robust while still
    # distinguishing the two formulas (gap > 40%).
    ratio = sqn_200 / sqn_50
    assert ratio == pytest.approx(math.sqrt(2), rel=0.02), (
        f"SQN cap regression: ratio={ratio} expected≈{math.sqrt(2)}. "
        "If this jumps to ~2.0 the sqrt(min(N,100)) cap was dropped."
    )


def test_derived_trade_metrics_profit_factor_segmented():
    """METRICS-07: separate PF for long and short via realized_pnl_per_trade.

    Audit-2026-05-07 H-0766 ratchet: the prior assertion only checked
    `is None or isinstance(..., (int, float))` — a production formula that
    summed the wrong side, double-counted, or returned gross_profit/N
    instead of gross_profit/gross_loss would still pass. Pin the ABSOLUTE
    numeric value computed independently from the fixture so a wrong scalar
    fails loudly.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "profit_factor_long" in result
    assert "profit_factor_short" in result

    # Independently recompute PF = gross_profit / |gross_loss| per side from
    # the SAME realized_pnl_per_trade fixture the production code consumes.
    long_pnls = [
        tr["realized_pnl"] for tr in t["realized_pnl_per_trade"]
        if tr["side"] == "long"
    ]
    short_pnls = [
        tr["realized_pnl"] for tr in t["realized_pnl_per_trade"]
        if tr["side"] == "short"
    ]
    expected_pf_long = (
        sum(p for p in long_pnls if p > 0)
        / abs(sum(p for p in long_pnls if p < 0))
    )
    expected_pf_short = (
        sum(p for p in short_pnls if p > 0)
        / abs(sum(p for p in short_pnls if p < 0))
    )
    # Sanity: the fixture is built so both sides have a finite, > 1 PF.
    assert expected_pf_long == pytest.approx(2.5)        # 1250 / 500
    assert expected_pf_short == pytest.approx(2000 / 850)  # ≈ 2.3529

    assert result["profit_factor_long"] == pytest.approx(expected_pf_long), (
        f"profit_factor_long must equal gross_profit/|gross_loss| for the "
        f"long side; expected {expected_pf_long}, got {result['profit_factor_long']}"
    )
    assert result["profit_factor_short"] == pytest.approx(expected_pf_short), (
        f"profit_factor_short must equal gross_profit/|gross_loss| for the "
        f"short side; expected {expected_pf_short}, got {result['profit_factor_short']}"
    )


def test_derived_trade_metrics_handles_empty_positions():
    """B-01 path (b): every metric returns None when position-side dict is empty/zero."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "long_volume_pct": 0.0,
        "short_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    t_empty = {
        "win_rate": 0.0,
        "avg_winning_trade": 0.0,
        "avg_losing_trade": 0.0,
        "winners_count": 0,
        "losers_count": 0,
        "realized_pnl_per_trade": [],
    }
    result = _compute_derived_trade_metrics(v, t_empty)
    assert result["expectancy"] is None
    assert result["risk_reward_ratio"] is None
    assert result["weighted_risk_reward_ratio"] is None
    assert result["sqn"] is None
    assert result["profit_factor_long"] is None
    assert result["profit_factor_short"] is None


def test_derived_trade_metrics_drops_non_finite_realized_pnl():
    """Audit-2026-05-07 H-0647 / H-0648: NaN / inf realized_pnl (commonly an
    upstream divide-by-zero from reconstruct_positions when entry price is 0)
    must NOT poison SQN, profit_factor_long, or profit_factor_short.

    Compare two inputs that differ only by an extra NaN / inf trade per side.
    The output for the clean cohort and the polluted-but-filtered cohort
    must match — pinning that the non-finite values were dropped at the
    boundary rather than silently propagating into JSONB.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    clean = {
        "avg_winning_trade": 100.0,
        "avg_losing_trade": -50.0,
        "winners_count": 2,
        "losers_count": 2,
        "win_rate": 0.5,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 100.0},
            {"side": "long", "realized_pnl": -50.0},
            {"side": "short", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -75.0},
        ],
    }
    polluted = {
        **clean,
        "realized_pnl_per_trade": clean["realized_pnl_per_trade"] + [
            {"side": "long", "realized_pnl": float("nan")},
            {"side": "short", "realized_pnl": float("inf")},
        ],
    }
    a = _compute_derived_trade_metrics(v, clean)
    b = _compute_derived_trade_metrics(v, polluted)

    assert a["sqn"] == b["sqn"], (
        f"NaN/inf must be filtered out of r_multiples before SQN math. "
        f"clean={a['sqn']} polluted={b['sqn']}"
    )
    assert a["profit_factor_long"] == b["profit_factor_long"], (
        "NaN long-side realized_pnl must NOT change profit_factor_long. "
        f"clean={a['profit_factor_long']} polluted={b['profit_factor_long']}"
    )
    assert a["profit_factor_short"] == b["profit_factor_short"], (
        "inf short-side realized_pnl must NOT change profit_factor_short. "
        f"clean={a['profit_factor_short']} polluted={b['profit_factor_short']}"
    )


def test_derived_trade_metrics_normalizes_percent_win_rate():
    """Audit-2026-05-07 H-0645 / H-0653: if a future refactor of
    `reconstruct_positions` returns win_rate in percent (60.0) instead of
    fraction (0.6), the consumer here MUST normalize defensively so
    expectancy doesn't blow up ~100×.

    Compare expectancy from win_rate=0.6 vs win_rate=60.0 — both should
    collapse to the same number after normalization.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    base = {
        "avg_winning_trade": 0.05,
        "avg_losing_trade": -0.025,
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [],
    }
    fraction_result = _compute_derived_trade_metrics(
        v, {**base, "win_rate": 0.6}
    )
    percent_result = _compute_derived_trade_metrics(
        v, {**base, "win_rate": 60.0}
    )
    assert fraction_result["expectancy"] == percent_result["expectancy"], (
        "win_rate=60.0 (percent) must be normalized to 0.6 (fraction). "
        f"Without the normalize, expectancy diverges by ~100×: "
        f"fraction={fraction_result['expectancy']} "
        f"percent={percent_result['expectancy']}"
    )


# Phase B pr-test-analyzer F11: the named boundary case for the
# WIN_RATE_PERCENT_HEURISTIC_THRESHOLD constant. A ULP drift from
# `winners/total` at 100% winners (e.g. 1.0001) must stay fractional. The
# OLD threshold of `> 1.0` would have rescaled this to 0.010001 — shipping
# a 1% win-rate for a 100%-winner strategy (catastrophic 100× error in the
# WRONG direction). The current `> 1.5` threshold pins the regression.
def test_derived_trade_metrics_win_rate_ulp_drift_stays_fractional():
    from services.analytics_runner import (
        _compute_derived_trade_metrics,
        WIN_RATE_PERCENT_HEURISTIC_THRESHOLD,
    )

    # Pin the threshold value too — a refactor that lowers it back to 1.0
    # would re-introduce the catastrophic mis-rescale.
    assert WIN_RATE_PERCENT_HEURISTIC_THRESHOLD == 1.5, (
        "WIN_RATE_PERCENT_HEURISTIC_THRESHOLD must stay at 1.5 to keep ULP "
        f"drift at 1.0 fractional; got {WIN_RATE_PERCENT_HEURISTIC_THRESHOLD}"
    )

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    base = {
        "avg_winning_trade": 0.05,
        "avg_losing_trade": -0.025,
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [],
    }
    baseline = _compute_derived_trade_metrics(v, {**base, "win_rate": 1.0})
    ulp_drift = _compute_derived_trade_metrics(v, {**base, "win_rate": 1.0001})
    # Both should yield expectancy = 1.0 * avg_win - 0 * |avg_loss| = avg_win.
    # If the rescale fires, ulp_drift's expectancy would be ~0.01 * avg_win
    # minus 0.99 * |avg_loss| = ~-0.0245 — a 100× error in the wrong
    # direction (positive expectancy flips negative). Tolerance is the
    # natural ULP gap between win_rate=1.0 and win_rate=1.0001 baselines.
    assert baseline["expectancy"] is not None
    assert ulp_drift["expectancy"] is not None
    assert abs(baseline["expectancy"] - ulp_drift["expectancy"]) < 1e-3, (
        f"win_rate=1.0001 must stay fractional (no /100 rescale). "
        f"baseline={baseline['expectancy']} ulp={ulp_drift['expectancy']}"
    )


# /simplify Phase B+C test-coverage HIGH #2: comprehensive boundary
# parametrize covering ULP drift near 1.0, the 1.5 strict threshold, percent
# values, and non-finite producer drift. A future "tidy" that flips the
# threshold back to `> 1.0` (or relaxes it to `>= 1.5`) fails this loudly
# across 13 cases — complementary to the ULP-drift test above, which pins
# the named constant.
@pytest.mark.parametrize(
    "raw_win_rate, expected_normalized",
    [
        # Legitimate fractional values near 1.0 stay fractional.
        (0.0, 0.0),
        (0.5, 0.5),
        (1.0, 1.0),
        (1.0001, 1.0),     # ULP drift — clamped to 1.0, NOT divided by 100
        (1.4999, 1.0),     # still below the 1.5 percent threshold
        (1.5, 1.0),        # exactly at threshold (`> 1.5` is False) — clamp
        (1.5001, 0.015001),  # just above threshold → percent → /100
        (60.0, 0.6),
        (100.0, 1.0),
        (-0.1, 0.0),       # negative → clamped to 0
        # Non-finite producer drift collapses to 0 (NOT NaN propagating).
        (float("inf"), 0.0),
        (float("-inf"), 0.0),
        (float("nan"), 0.0),
    ],
)
def test_derived_trade_metrics_win_rate_boundary(
    raw_win_rate: float, expected_normalized: float,
) -> None:
    """Pins win_rate normalization across the load-bearing boundary (1.5,
    ULP drift near 1.0, non-finite). Asserts expectancy reflects the
    normalized win_rate by computing it independently against the same
    avg_win / avg_loss.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    avg_win = 1.0
    avg_loss = -1.0
    result = _compute_derived_trade_metrics(
        v,
        {
            "win_rate": raw_win_rate,
            "avg_winning_trade": avg_win,
            "avg_losing_trade": avg_loss,
            "winners_count": 0,
            "losers_count": 0,
            "realized_pnl_per_trade": [],
        },
    )
    # expectancy = wr * avg_win - (1 - wr) * |avg_loss|
    expected_expectancy = (
        expected_normalized * avg_win
        - (1 - expected_normalized) * abs(avg_loss)
    )
    assert result["expectancy"] == pytest.approx(expected_expectancy), (
        f"raw_win_rate={raw_win_rate!r} expected normalized "
        f"{expected_normalized}, got expectancy {result['expectancy']} "
        f"(expected {expected_expectancy})"
    )


# ---------------------------------------------------------------------------
# Phase 12 Plan 05 / METRICS-09 — volume aggregator over raw fills
# Phase 12 Plan 05 / METRICS-10 — Trade Mix (audit-gated 4-bucket vs 2-bucket)
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_fills() -> list[dict]:
    """Fills shaped per `raw_fills WHERE is_fill=true` for METRICS-09 input.

    Each fill has side, notional_usd, holding_period_hours, filled_at — the
    fields the volume aggregator + trade mix consume. Spans 3 distinct days
    in 2 distinct months so daily/monthly turnover have non-trivial denominators.
    """
    return [
        # Day 1 — 2024-01-15
        {"side": "long", "notional_usd": 1000.0, "holding_period_hours": 4.0,
         "filled_at": "2024-01-15T10:00:00+00:00"},
        {"side": "long", "notional_usd": 500.0, "holding_period_hours": 6.0,
         "filled_at": "2024-01-15T14:00:00+00:00"},
        {"side": "short", "notional_usd": 800.0, "holding_period_hours": 2.0,
         "filled_at": "2024-01-15T18:00:00+00:00"},
        # Day 2 — 2024-01-16
        {"side": "long", "notional_usd": 1200.0, "holding_period_hours": 8.0,
         "filled_at": "2024-01-16T11:00:00+00:00"},
        {"side": "short", "notional_usd": 600.0, "holding_period_hours": 3.0,
         "filled_at": "2024-01-16T15:00:00+00:00"},
        # Day 3 — 2024-02-05 (different month for monthly aggregation)
        {"side": "long", "notional_usd": 900.0, "holding_period_hours": 5.0,
         "filled_at": "2024-02-05T09:00:00+00:00"},
    ]


@pytest.fixture
def sample_fills_with_maker_taker(sample_fills) -> list[dict]:
    """Same fills as `sample_fills` but with `is_maker` flag populated.

    Used for the 4-bucket Trade Mix happy-path (TRADE_MIX_HAS_MAKER_TAKER=true).
    Mix of maker / taker so each of the 4 buckets gets non-zero counts.
    """
    pattern = [True, False, True, False, True, False]
    enriched: list[dict] = []
    for fill, is_maker in zip(sample_fills, pattern):
        enriched.append({**fill, "is_maker": is_maker})
    return enriched


def test_volume_aggregator_includes_required_keys(sample_fills):
    """METRICS-09: aggregator returns gross_volume_usd, mean_trade_size_usd,
    mean_daily_turnover_usd, mean_monthly_turnover_usd."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator(sample_fills)
    for key in [
        "gross_volume_usd",
        "mean_trade_size_usd",
        "mean_daily_turnover_usd",
        "mean_monthly_turnover_usd",
    ]:
        assert key in result


def test_volume_aggregator_empty_fills():
    """METRICS-09: empty fills → every aggregate returns 0.0."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator([])
    assert result["gross_volume_usd"] == 0.0
    assert result["mean_trade_size_usd"] == 0.0
    assert result["mean_daily_turnover_usd"] == 0.0
    assert result["mean_monthly_turnover_usd"] == 0.0


def test_volume_aggregator_computes_correct_values(sample_fills):
    """METRICS-09: gross_volume = sum(notional); mean = gross/N; daily =
    mean per-day total; monthly = mean per-month total."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator(sample_fills)
    # gross = 1000 + 500 + 800 + 1200 + 600 + 900 = 5000
    assert abs(result["gross_volume_usd"] - 5000.0) < 1e-6
    # mean trade = 5000 / 6 ≈ 833.33
    assert abs(result["mean_trade_size_usd"] - 5000.0 / 6) < 1e-6
    # 3 distinct days: 2300 (1/15) + 1800 (1/16) + 900 (2/5) = 5000; mean = 5000/3
    assert abs(result["mean_daily_turnover_usd"] - 5000.0 / 3) < 1e-6
    # 2 distinct months: 4100 (jan) + 900 (feb) = 5000; mean = 5000/2
    assert abs(result["mean_monthly_turnover_usd"] - 5000.0 / 2) < 1e-6


def test_volume_aggregator_malformed_timestamp_kept_in_gross_excluded_from_turnover():
    """M-0650: the `if not ts or len(ts) < 10: continue` defensive branch
    drops fills with missing / short timestamps from the daily/monthly
    turnover buckets while STILL counting their notional in gross_volume +
    mean_trade_size. A regression that swapped `continue` for `break` (or
    dropped the notional from gross too) silently changes aggregate
    semantics — no existing test exercises ts=None or a length-7 prefix.
    """
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        # Well-formed: contributes to BOTH gross and daily/monthly.
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        # ts is None → skipped from daily/monthly, KEPT in gross.
        {"notional_usd": 500.0, "filled_at": None},
        # ts is "2024-01" (length 7 < 10) → skipped from daily/monthly,
        # KEPT in gross. This is the exact short-prefix case the finding
        # named.
        {"notional_usd": 300.0, "filled_at": "2024-01"},
    ]
    result = _compute_volume_aggregator(fills)
    # All three notionals survive into gross + mean.
    assert result["gross_volume_usd"] == pytest.approx(1800.0)
    assert result["mean_trade_size_usd"] == pytest.approx(1800.0 / 3)
    # Only the well-formed fill reaches the daily/monthly buckets → 1 day
    # carrying 1000.0 → mean over 1 day = 1000.0. If `continue` were
    # `break`, the loop would have exited and daily would still be 1000;
    # but if gross also dropped the malformed fills, the assertions above
    # would catch that. The turnover figure pins the exclusion side.
    assert result["mean_daily_turnover_usd"] == pytest.approx(1000.0)
    assert result["mean_monthly_turnover_usd"] == pytest.approx(1000.0)


def test_volume_aggregator_uses_created_at_when_filled_at_missing():
    """M-0650 companion: the `f.get('filled_at') or f.get('created_at')`
    fallback path is untested because the sample_fills fixture always
    populates filled_at. A fill with only created_at must still bucket
    into daily/monthly turnover."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 2000.0, "created_at": "2024-02-20T00:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert result["gross_volume_usd"] == pytest.approx(2000.0)
    # created_at fallback drove the daily bucket (single day → mean 2000).
    assert result["mean_daily_turnover_usd"] == pytest.approx(2000.0)
    assert result["mean_monthly_turnover_usd"] == pytest.approx(2000.0)


def test_derived_trade_metrics_sqn_degenerate_variance_returns_none():
    """M-0648: all-identical R-multiples → sample variance 0 → std_r == 0,
    so the `if std_r > 0` guard leaves SQN as None (avoids a divide-by-zero
    blow-up). No prior test exercises this branch — the existing SQN tests
    all use heterogeneous R-multiples with non-zero variance.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    # Four closed trades, ALL with realized_pnl == 50.0 → every R-multiple
    # is identical (50/|−10| = 5.0) → variance 0 → std 0 → SQN None.
    t = {
        "win_rate": 1.0,
        "avg_winning_trade": 50.0,
        "avg_losing_trade": -10.0,
        "winners_count": 4,
        "losers_count": 0,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 50.0} for _ in range(4)
        ],
    }
    result = _compute_derived_trade_metrics(v, t)
    assert result["sqn"] is None, (
        "All-identical R-multiples produce zero variance; SQN must be None "
        "(the `if std_r > 0` guard), not a NaN/Inf from dividing by std=0."
    )


def test_derived_trade_metrics_profit_factor_zero_loss_returns_none_not_inf():
    """M-0649 / T-12-05-03: a side with gross losses summing to 0 (a
    long-only winning cohort) must yield profit_factor=None, NOT +Infinity.
    The existing segmented PF test always has losses on both sides, so the
    `if gl == 0: return None` branch is unexercised — and an isinstance
    check would PASS for math.inf (it's a float). Pin the None contract so
    a regression to `gp / gl if gl else math.inf` is caught: +inf would
    propagate into Supabase JSONB and break the downstream render.
    """
    import math

    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    # Long side: only positive pnls (no losing long trade) → gross_loss = 0
    # → profit_factor_long must be None (NOT inf). Short side keeps a loss
    # so its PF stays finite — proving the None is the zero-loss branch,
    # not a global wipe.
    t = {
        "win_rate": 1.0,
        "avg_winning_trade": 50.0,
        "avg_losing_trade": -10.0,
        "winners_count": 3,
        "losers_count": 0,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 50.0},
            {"side": "long", "realized_pnl": 30.0},
            {"side": "long", "realized_pnl": 20.0},
            {"side": "short", "realized_pnl": -15.0},
            {"side": "short", "realized_pnl": 40.0},
        ],
    }
    result = _compute_derived_trade_metrics(v, t)
    assert result["profit_factor_long"] is None, (
        "Zero-loss long side must yield None, not +Infinity (T-12-05-03). "
        f"got {result['profit_factor_long']!r}"
    )
    # Guard against an isinstance-style regression: must NOT be inf.
    assert not (
        isinstance(result["profit_factor_long"], float)
        and math.isinf(result["profit_factor_long"])
    )
    # Short side has a real loss → PF is finite (gp=40 / |gl|=15 ≈ 2.667).
    assert result["profit_factor_short"] == pytest.approx(40.0 / 15.0)


def test_trade_mix_4_bucket(sample_fills_with_maker_taker):
    """METRICS-10: 4-bucket Trade Mix when audit passes (D-15 OK)."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(
        sample_fills_with_maker_taker, has_maker_taker=True
    )
    assert set(result.keys()) == {
        "long_maker", "long_taker", "short_maker", "short_taker"
    }
    for bucket_key in ["long_maker", "long_taker", "short_maker", "short_taker"]:
        bucket = result[bucket_key]
        assert "count" in bucket
        assert "total_notional" in bucket


def test_trade_mix_2_bucket_fallback(sample_fills):
    """METRICS-10: 2-bucket fallback when audit fails (TRADE_MIX_HAS_MAKER_TAKER=false)."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(sample_fills, has_maker_taker=False)
    assert set(result.keys()) == {"long", "short"}
    for bucket_key in ["long", "short"]:
        bucket = result[bucket_key]
        assert "count" in bucket
        assert "total_notional" in bucket
    # Long: 4 fills → count=4, notional=1000+500+1200+900=3600
    # Short: 2 fills → count=2, notional=800+600=1400
    assert result["long"]["count"] == 4
    assert abs(result["long"]["total_notional"] - 3600.0) < 1e-6
    assert result["short"]["count"] == 2
    assert abs(result["short"]["total_notional"] - 1400.0) < 1e-6


def test_trade_mix_empty_fills():
    """METRICS-10: empty fills → every bucket carries count=0, total_notional=0.0."""
    from services.analytics_runner import _compute_trade_mix

    result_4 = _compute_trade_mix([], has_maker_taker=True)
    assert set(result_4.keys()) == {
        "long_maker", "long_taker", "short_maker", "short_taker"
    }
    assert result_4["long_maker"]["count"] == 0
    assert result_4["long_maker"]["total_notional"] == 0.0

    result_2 = _compute_trade_mix([], has_maker_taker=False)
    assert set(result_2.keys()) == {"long", "short"}
    assert result_2["long"]["count"] == 0
    assert result_2["short"]["count"] == 0


def test_trade_mix_4_bucket_skips_fills_missing_is_maker():
    """METRICS-10 / T-12-05-04: in 4-bucket mode, fills with is_maker=None
    are skipped (cannot bucket into maker/taker without the flag)."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "long", "is_maker": True, "notional_usd": 1000.0},
        # is_maker missing — must be skipped
        {"side": "long", "notional_usd": 500.0},
        {"side": "short", "is_maker": False, "notional_usd": 800.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert result["long_maker"]["count"] == 1
    assert result["long_taker"]["count"] == 0  # the missing-flag fill is dropped
    assert result["short_taker"]["count"] == 1
    assert result["short_maker"]["count"] == 0


# ---------------------------------------------------------------------------
# Audit-2026-05-27 H-0650 / M-0655 / M-0656: trade_mix side-normalization +
# typed bucket / mode contracts.
# ---------------------------------------------------------------------------


def test_trade_mix_uppercase_side_buckets_correctly_h0650():
    """H-0650 regression: an uppercase `side="LONG"` must bucket into `long`.

    Pre-fix `_compute_trade_mix` read `side = f.get("side")` with RAW equality
    (the only one of the three side-parse regimes that did not case-fold), so
    `"LONG"` matched neither buy/sell nor the lowercase bucket keys and was
    SILENTLY DROPPED (count stayed 0). This test fails before the
    `_normalize_side` fix and passes after.
    """
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "LONG", "notional_usd": 1000.0},
        {"side": "Short", "notional_usd": 400.0},
        {"side": "SELL", "notional_usd": 250.0},  # sell alias, uppercase
        {"side": "BUY", "notional_usd": 150.0},   # buy alias, uppercase
    ]
    result = _compute_trade_mix(fills, has_maker_taker=False)
    # LONG + BUY-alias → long bucket (2 fills); Short + SELL-alias → short (2)
    assert result["long"]["count"] == 2
    assert abs(result["long"]["total_notional"] - 1150.0) < 1e-6
    assert result["short"]["count"] == 2
    assert abs(result["short"]["total_notional"] - 650.0) < 1e-6


def test_trade_mix_lowercase_side_unchanged_h0650():
    """H-0650 invariant: lowercase input produces IDENTICAL results to pre-fix.

    The normalization helper is behavior-preserving for current
    (lowercase/alias) input — only the uppercase edge case changes.
    """
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "long", "notional_usd": 1000.0},
        {"side": "buy", "notional_usd": 500.0},     # buy → long
        {"side": "short", "notional_usd": 800.0},
        {"side": "sell", "notional_usd": 600.0},    # sell → short
    ]
    result = _compute_trade_mix(fills, has_maker_taker=False)
    assert result["long"]["count"] == 2
    assert abs(result["long"]["total_notional"] - 1500.0) < 1e-6
    assert result["short"]["count"] == 2
    assert abs(result["short"]["total_notional"] - 1400.0) < 1e-6


def test_trade_mix_count_is_int_not_float_m0655():
    """M-0655 regression: `count` must be a Python int, not a float.

    The bucket was annotated `dict[str, float]` but `count` is incremented as
    an int. TradeMixBucket pins `count: int`; assert the runtime type so a
    future refactor that coerces it to float (matching the lying annotation)
    fails here.
    """
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "long", "notional_usd": 1000.0},
        {"side": "long", "notional_usd": 500.0},
        {"side": "short", "notional_usd": 800.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=False)
    assert type(result["long"]["count"]) is int
    assert type(result["short"]["count"]) is int
    # total_notional remains a float.
    assert isinstance(result["long"]["total_notional"], float)


def test_trade_mix_mode_key_sets_m0656():
    """M-0656: each mode returns EXACTLY its documented key set.

    Pins the 4-bucket vs 2-bucket contract (TradeMix4Bucket / TradeMix2Bucket)
    so a future change to either mode's key set is caught at runtime.
    """
    from services.analytics_runner import _compute_trade_mix

    fills_mt = [
        {"side": "long", "is_maker": True, "notional_usd": 1000.0},
        {"side": "short", "is_maker": False, "notional_usd": 800.0},
    ]
    result_4 = _compute_trade_mix(fills_mt, has_maker_taker=True)
    assert set(result_4.keys()) == {
        "long_maker", "long_taker", "short_maker", "short_taker"
    }

    fills_2 = [
        {"side": "long", "notional_usd": 1000.0},
        {"side": "short", "notional_usd": 800.0},
    ]
    result_2 = _compute_trade_mix(fills_2, has_maker_taker=False)
    assert set(result_2.keys()) == {"long", "short"}


# ---------------------------------------------------------------------------
# KPI-17: per-strategy is_maker coverage gate (_has_maker_taker_coverage)
# ---------------------------------------------------------------------------


def test_has_maker_taker_coverage_empty_fills_returns_false():
    """No fills → cannot satisfy the audit gate; returns False."""
    from services.analytics_runner import _has_maker_taker_coverage

    assert _has_maker_taker_coverage([]) is False


def test_has_maker_taker_coverage_full_population_returns_true():
    """100% is_maker coverage (typical OKX prod shape) clears the gate."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"is_maker": True}, {"is_maker": False}, {"is_maker": False}]
    assert _has_maker_taker_coverage(fills) is True


def test_has_maker_taker_coverage_below_threshold_returns_false():
    """Below 99% → falls back to 2-bucket so partial Binance/Bybit ingestion
    can't silently null out a strategy's Trade Mix."""
    from services.analytics_runner import _has_maker_taker_coverage

    # 98 of 100 populated = 98% coverage, below the 99% threshold.
    fills = [{"is_maker": True}] * 98 + [{"is_maker": None}, {}]
    assert _has_maker_taker_coverage(fills) is False


def test_has_maker_taker_coverage_threshold_inclusive():
    """Exactly 99% clears the gate (≥99%, not >99%)."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"is_maker": True}] * 99 + [{"is_maker": None}]
    assert _has_maker_taker_coverage(fills) is True


def test_has_maker_taker_coverage_handles_missing_key():
    """Fills without an is_maker key count as unpopulated (same as None)."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"side": "long"}, {"side": "short"}]  # no is_maker key at all
    assert _has_maker_taker_coverage(fills) is False


def test_trade_mix_buy_sell_side_normalized_to_long_short():
    """Raw fills carry buy/sell side from the venue; trade_mix buckets by
    long/short. Without normalization, _compute_trade_mix drops every fill
    and the 4-bucket render shows 0 counts (the bug surfaced in v0.17.1.14
    against the OKX prod fills: 200 fills with side=buy/sell, all dropped)."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "is_maker": True, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "buy", "is_maker": False, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "sell", "is_maker": True, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "sell", "is_maker": False, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert result["long_maker"]["count"] == 1
    assert result["long_taker"]["count"] == 1
    assert result["short_maker"]["count"] == 1
    assert result["short_taker"]["count"] == 1


def test_trade_mix_2_bucket_buy_sell_normalized():
    """Same buy/sell normalization in 2-bucket fallback mode."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "notional_usd": 100.0, "holding_period_hours": 1.0},
        {"side": "buy", "notional_usd": 100.0, "holding_period_hours": 1.0},
        {"side": "sell", "notional_usd": 100.0, "holding_period_hours": 1.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=False)
    assert result["long"]["count"] == 2
    assert result["short"]["count"] == 1


# ---------------------------------------------------------------------------
# KPI-17 follow-up: position-side volume attribution
# ---------------------------------------------------------------------------


def test_position_side_volume_pcts_attributes_via_timestamp_window():
    """Fills inside a long-side position's window count as long volume; same
    for short. The classic v0.16.x bug aliased buy_volume_pct as
    long_volume_pct, which double-counted "buy to close short" as long
    volume — this test pins the corrected attribution."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00"},
        {"side": "short", "opened_at": "2024-01-03T00:00:00+00:00",
         "closed_at": "2024-01-04T00:00:00+00:00"},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T06:00:00+00:00"},
        {"side": "sell", "cost": 100.0, "timestamp": "2024-01-01T18:00:00+00:00"},
        {"side": "sell", "cost": 50.0, "timestamp": "2024-01-03T06:00:00+00:00"},
        {"side": "buy", "cost": 50.0, "timestamp": "2024-01-03T18:00:00+00:00"},
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    # long_volume = 200, short_volume = 100, total = 300 -> 0.6667 / 0.3333
    assert abs(result["long_volume_pct"] - 0.6667) < 0.001
    assert abs(result["short_volume_pct"] - 0.3333) < 0.001


def test_position_side_volume_pcts_open_position_no_close():
    """Open position (closed_at=None) attributes everything from opened_at
    onward — fills after the open should land in that side."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": None},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-02T00:00:00+00:00"},
        {"side": "sell", "cost": 50.0, "timestamp": "2024-01-03T00:00:00+00:00"},
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    assert result["long_volume_pct"] == 1.0
    assert result["short_volume_pct"] == 0.0


def test_position_side_volume_pcts_skips_unattributable_fills():
    """A fill whose timestamp falls outside every position window doesn't
    inflate either side."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00"},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T12:00:00+00:00"},  # in window
        {"side": "sell", "cost": 999.0, "timestamp": "2024-01-10T00:00:00+00:00"},  # outside
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    # Only the in-window fill is attributed; pct over attributed_total = 100%
    assert result["long_volume_pct"] == 1.0
    assert result["short_volume_pct"] == 0.0


def test_position_side_volume_pcts_empty_inputs_return_zero():
    """No fills or no positions returns 0/0 (frontend renders '—')."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    assert _compute_position_side_volume_pcts([], []) == {
        "long_volume_pct": 0.0, "short_volume_pct": 0.0,
    }
    assert _compute_position_side_volume_pcts(
        [{"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T00:00:00+00:00"}],
        [],
    ) == {"long_volume_pct": 0.0, "short_volume_pct": 0.0}


def test_position_side_volume_pcts_mixed_tz_naive_aware_no_crash():
    """F6 (red-team HIGH8): a tz-naive position window vs tz-aware fill
    timestamp (or vice-versa) must NOT raise. Pre-fix `_parse` returned a naive
    datetime for an offset-less string and an aware one for an offset string, so
    `ts < opened` raised `TypeError: can't compare offset-naive and
    offset-aware`. That TypeError propagated out of this function and was caught
    by the broad except at the call site → position_side_volume_failed=True,
    silently dropping the long/short volume panel for the WHOLE strategy on
    otherwise-valid data. Normalizing every parsed datetime to tz-aware UTC fixes
    the comparison and preserves correct attribution."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    # Position windows are tz-NAIVE (no offset); fills are tz-AWARE (Z/offset).
    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00",
         "closed_at": "2024-01-02T00:00:00"},
        {"side": "short", "opened_at": "2024-01-03T00:00:00",
         "closed_at": "2024-01-04T00:00:00"},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T06:00:00Z"},
        {"side": "sell", "cost": 100.0, "timestamp": "2024-01-01T18:00:00+00:00"},
        {"side": "sell", "cost": 50.0, "timestamp": "2024-01-03T06:00:00Z"},
        {"side": "buy", "cost": 50.0, "timestamp": "2024-01-03T18:00:00+00:00"},
    ]
    # Pre-fix this raises TypeError (offset-naive vs offset-aware).
    result = _compute_position_side_volume_pcts(fills, positions)
    # long = 200, short = 100, total = 300 → 0.6667 / 0.3333
    assert abs(result["long_volume_pct"] - 0.6667) < 0.001
    assert abs(result["short_volume_pct"] - 0.3333) < 0.001


def test_position_side_volume_pcts_aware_window_naive_fill_no_crash():
    """F6 (reverse polarity): tz-AWARE position windows vs tz-NAIVE fill
    timestamps must also not raise and must attribute correctly."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00"},
    ]
    fills = [
        # Naive fill timestamps (no offset) — promoted to UTC by the fix.
        {"side": "buy", "cost": 80.0, "timestamp": "2024-01-01T06:00:00"},
        {"side": "sell", "cost": 20.0, "timestamp": "2024-01-01T18:00:00"},
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    assert result["long_volume_pct"] == 1.0
    assert result["short_volume_pct"] == 0.0


def test_is_trade_mix_approximate_open_only_short_does_not_fire():
    """Open-only short (closed_at is None) does NOT trigger the chip — its
    sell fill is bucketed correctly as 'short' and there's no closing buy
    in the dataset yet to mis-attribute as 'long'."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "long", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
        {"side": "short", "opened_at": "2024-01-03", "closed_at": None},
    ]
    assert _is_trade_mix_approximate(positions) is False


def test_is_trade_mix_approximate_closed_short_fires():
    """Closed short means a buy-to-close fill exists in the dataset and
    will be mis-bucketed as a long entry — chip should fire."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "short", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
    ]
    assert _is_trade_mix_approximate(positions) is True


def test_is_trade_mix_approximate_long_only_does_not_fire():
    """Long-only strategy: the panel labels match fill bucketing for longs
    (buy=long entry). No mis-attribution, so no chip."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "long", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
        {"side": "long", "opened_at": "2024-01-03", "closed_at": None},
    ]
    assert _is_trade_mix_approximate(positions) is False


def test_is_trade_mix_approximate_empty_positions_does_not_fire():
    """No positions = no mis-attribution risk, no chip."""
    from services.analytics_runner import _is_trade_mix_approximate

    assert _is_trade_mix_approximate([]) is False


def test_volume_metrics_no_longer_aliases_long_to_buy():
    """_compute_volume_metrics dropped the misleading long_volume_pct /
    short_volume_pct aliases that copied buy/sell percentages. Those
    fields now come from _compute_position_side_volume_pcts so the field
    name reflects the actual computation."""
    from services.analytics_runner import _compute_volume_metrics

    fills = [
        {"side": "buy", "cost": 100.0},
        {"side": "sell", "cost": 200.0},
    ]
    result = _compute_volume_metrics(fills)
    assert "buy_volume_pct" in result
    assert "sell_volume_pct" in result
    # Misleading aliases gone
    assert "long_volume_pct" not in result
    assert "short_volume_pct" not in result


# ---------------------------------------------------------------------------
# Audit 2026-05-07 G12.G.4 — _compute_volume_metrics edge-case coverage
# ---------------------------------------------------------------------------


class TestComputeVolumeMetrics:
    """Audit 2026-05-07 G12.G.4 regression: the helper had zero test
    coverage for the data-quality cases that come up in production
    (negative cost from rebates / exchange adjustments, zero cost from
    a price=0 or qty=0 fill, missing 'cost' key, capitalized 'Buy',
    empty side string). All paths must produce sane percentages bounded
    [0, 1] and a non-negative total_volume_usd.
    """

    def test_basic_buy_sell_split(self) -> None:
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.5
        assert result["sell_volume_pct"] == 0.5
        assert result["total_volume_usd"] == 200.0
        assert result["total_fills"] == 2

    def test_asymmetric_split_catches_buy_sell_swap_and_dropped_abs(self) -> None:
        """H-0760: the golden parity fixture feeds `cost`-less fills to
        _compute_volume_metrics, so buy/sell percentages bake to 0.0 in
        golden_252d_expected.json and the cross-runtime parity test trains
        exclusively on zero-input — it cannot catch a buy/sell-swap or a
        dropped-abs() formula drift. The pre-existing in-class coverage doesn't
        close that either: `test_basic_buy_sell_split` uses a SYMMETRIC 50/50
        split, so swapping the buy/sell branches yields the identical 0.5/0.5
        and the swap slips through.

        This test exercises the real (non-degenerate) code path with an
        ASYMMETRIC cost-bearing split and a negative (rebate) cost, and asserts
        the EXACT percentages so the two named formula-drift regressions fail
        loud:
          - buy/sell branch swap: correct buy=0.75 / sell=0.25; a swap gives
            buy=0.25 / sell=0.75 and diverges here.
          - dropped abs() on cost: the -100 rebate would subtract instead of
            adding magnitude, moving total to 200 and shifting both pcts.
        """
        from services.analytics_runner import _compute_volume_metrics

        # buy = 300 (200 + a 100-magnitude rebate), sell = 100, total = 400.
        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 200.0},
                {"side": "buy", "cost": -100.0},  # rebate: abs() -> +100 magnitude
                {"side": "sell", "cost": 100.0},
            ],
        )
        # Exact asymmetric split. A buy<->sell branch swap flips these to
        # 0.25 / 0.75; a dropped abs() makes buy magnitude 100 (200-100) and
        # total 200, giving buy=0.5 — both diverge from the pinned values.
        assert result["buy_volume_pct"] == 0.75, (
            "H-0760: buy_volume_pct drifted from the 3:1 asymmetric split — a "
            "buy/sell branch swap or a dropped abs() on a rebate cost."
        )
        assert result["sell_volume_pct"] == 0.25
        # total is the absolute (magnitude) sum: 200 + |−100| + 100 = 400.
        assert result["total_volume_usd"] == 400.0
        assert result["total_fills"] == 3

    def test_empty_fills_list(self) -> None:
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics([])
        # No division-by-zero, all percentages 0, total 0.
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 0.0
        assert result["total_volume_usd"] == 0.0
        assert result["total_fills"] == 0

    def test_negative_cost_does_not_skew_percentages_above_one(self) -> None:
        """Negative cost (rebate / exchange-side adjustment) MUST NOT
        produce buy_pct or sell_pct outside [0, 1]. Pre-audit code summed
        the signed cost: a fill with cost=-50 inflated the side
        asymmetrically and could yield percentages > 1 or < 0. The fix
        takes abs(cost) so volume is treated as a magnitude.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "sell", "cost": -50.0},  # rebate
            ],
        )
        # Each percentage is in [0, 1].
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        # Sum of buy + sell <= 1.0 (no over-attribution).
        assert (
            result["buy_volume_pct"] + result["sell_volume_pct"]
            <= 1.0 + 1e-9
        )
        # total_volume_usd is the absolute sum of magnitudes (100 + 50).
        assert result["total_volume_usd"] >= 0
        assert result["total_volume_usd"] == 150.0

    def test_zero_cost_fills_dont_break_totals(self) -> None:
        """Fills with cost=0 (price=0 or qty=0) MUST NOT cause a
        division-by-zero. Total_volume stays correct.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 0.0},
                {"side": "sell", "cost": 0.0},
            ],
        )
        # Percentages collapse to 0 (no volume to attribute).
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 0.0
        assert result["total_volume_usd"] == 0.0
        assert result["total_fills"] == 2

    def test_missing_cost_key_defaults_to_zero(self) -> None:
        """Fills with no 'cost' key (upstream parser bug, missing column)
        MUST NOT raise KeyError or crash the analytics run.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy"},  # missing cost
                {"side": "sell", "cost": 100.0},
            ],
        )
        # The fill with missing cost contributes 0 to total/buy.
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 1.0
        assert result["total_volume_usd"] == 100.0

    def test_capitalized_side_is_normalized(self) -> None:
        """'Buy', 'BUY', 'sell', 'SELL' all fold into the lowercase
        comparison branches.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "Buy", "cost": 100.0},
                {"side": "SELL", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.5
        assert result["sell_volume_pct"] == 0.5
        assert result["total_volume_usd"] == 200.0

    def test_empty_side_contributes_to_total_but_neither_bucket(self) -> None:
        """Fills with empty/unknown side strings contribute volume to the
        total (so the figure stays accurate) but to neither buy nor sell.
        Caller can detect the residual via 1 - buy_pct - sell_pct.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "", "cost": 50.0},  # unknown side
                {"side": None, "cost": 25.0},  # null side
            ],
        )
        # Buy is 100/175 ≈ 0.5714; sell is 0; residual is 75/175 ≈ 0.4286.
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert result["sell_volume_pct"] == 0.0
        assert (
            result["buy_volume_pct"] + result["sell_volume_pct"]
            <= 1.0 + 1e-9
        )
        assert result["total_volume_usd"] == 175.0

    def test_non_numeric_cost_defaults_to_zero(self) -> None:
        """A string cost from a malformed upstream payload MUST NOT crash
        the runner. It defaults to 0 and the fill contributes nothing to
        the totals.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": "garbage"},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 1.0
        assert result["total_volume_usd"] == 100.0

    # Audit-2026-05-07 H-0769: NaN / inf cost coverage. A NaN cost from
    # an upstream parser divide-by-zero is a *numeric* float, so the
    # `except (TypeError, ValueError)` guard does NOT catch it — it survives
    # `abs(float(...))` and would propagate into total_volume_usd, which the
    # runner then writes into strategy_analytics JSONB. NaN/Inf are NOT
    # JSON-compliant (`json.dumps(..., allow_nan=False)` raises), so an
    # unsanitized non-finite cost corrupts the row or bypasses encoder
    # safeguards downstream.
    #
    # PR #290 closed the gap: _compute_volume_metrics now applies a
    # `math.isfinite(cost)` guard (coerce non-finite → 0, count + log it).
    # These two tests are therefore LIVE (NOT xfail) regression guards that
    # pin the CORRECT contract documented in the helper's docstring
    # ("total_volume_usd is the absolute sum"; percentages in [0,1]): the
    # output must be FINITE and JSON-serializable. If a future refactor drops
    # the isfinite guard, both tests fail hard — they ratchet the fix in
    # rather than silently tolerating a regression.

    def test_nan_cost_does_not_poison_totals(self) -> None:
        """A NaN cost (upstream divide-by-zero) must NOT propagate into
        total_volume_usd — the result must stay finite and JSON-serializable.
        """
        import json
        import math

        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": float("nan")},
                {"side": "sell", "cost": 100.0},
            ],
        )
        # total_volume_usd must be finite (the NaN fill contributes 0).
        assert math.isfinite(result["total_volume_usd"]), (
            f"NaN cost leaked into total_volume_usd: {result['total_volume_usd']!r}"
        )
        assert result["total_volume_usd"] == 100.0
        # Percentages stay bounded and finite.
        assert math.isfinite(result["buy_volume_pct"])
        assert math.isfinite(result["sell_volume_pct"])
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        # The whole payload must round-trip through strict JSON (no NaN/Inf).
        json.dumps(result, allow_nan=False)

    def test_inf_cost_does_not_poison_totals(self) -> None:
        """An inf cost must NOT propagate into total_volume_usd / percentages
        — the result must stay finite and JSON-serializable.
        """
        import json
        import math

        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": float("inf")},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert math.isfinite(result["total_volume_usd"]), (
            f"inf cost leaked into total_volume_usd: {result['total_volume_usd']!r}"
        )
        assert result["total_volume_usd"] == 100.0
        assert math.isfinite(result["buy_volume_pct"])
        assert math.isfinite(result["sell_volume_pct"])
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        json.dumps(result, allow_nan=False)


# ---------------------------------------------------------------------------
# PostgREST pagination mocks — shared by the `_load_position_time_series`
# NAV-safety unit tests below (`TestLoadPositionTimeSeriesNavSafety`).
# ---------------------------------------------------------------------------


def _make_paged_range(rows: list[dict]):
    """Build a `.range(start, end)` mock that simulates PostgREST pagination.

    Returns a chainable that:
      - on the first call returns the full ``rows`` payload (the runner's
        page-1 fetch), and
      - on every subsequent call returns an empty list (so the runner's
        bounded pagination loop terminates after one page).

    Used by the H-0629 / H-0630 / H-0643 paginated SELECTs in the runner.
    """
    state = {"called": False}

    def _range(start, end):
        r = MagicMock()
        if not state["called"]:
            state["called"] = True
            r.execute.return_value = MagicMock(data=rows)
        else:
            r.execute.return_value = MagicMock(data=[])
        return r

    return MagicMock(side_effect=_range)


def _make_paginated_order_mock(rows: list[dict]) -> MagicMock:
    """Build a chainable `.order(...).order(...)...range(start, end).execute()` mock.

    The runner now uses composite order_by tuples (e.g. (snapshot_date,
    symbol, side) for snapshots, (timestamp, id) for fills) so
    ``paginated_select`` chains multiple ``.order(col, desc=...)`` calls
    before ``.range()``. Each ``.order()`` must land back on the same
    configured mock so the final ``.range()`` exposes ``_make_paged_range``.
    """
    order = MagicMock()
    order.execute.return_value = MagicMock(data=rows)
    order.range = _make_paged_range(rows)
    order.order.return_value = order
    return order


@pytest.mark.asyncio
async def test_real_compute_exposure_metrics_derives_series_from_snapshots() -> None:
    """audit-2026-05-07 H-0763 / H-0765 / M-0726 (non-tautological coverage).

    The (now-deleted) runner sibling-kinds tests MOCKED
    `compute_exposure_metrics`, so they could not detect a regression where
    the real function fails to derive exposure_series from position_snapshots.
    This test drives the REAL `compute_exposure_metrics` against a snapshot
    fixture and pins the COMPUTED gross/net values — the mock is told
    nothing, the assertions check what the production math produces.

    Fixture (two dates, mixed sides so net != gross on day 2):
      2024-01-15: long 10_000 + long 5_000              → gross 15_000, net +15_000
      2024-01-16: long 12_000 + short 4_000             → gross 16_000, net +8_000
    """
    from services.position_reconstruction import compute_exposure_metrics

    snapshot_rows = [
        {"snapshot_date": "2024-01-15", "side": "long", "size_usd": "10000",
         "mark_price": "65000"},
        {"snapshot_date": "2024-01-15", "side": "long", "size_usd": "5000",
         "mark_price": "65000"},
        {"snapshot_date": "2024-01-16", "side": "long", "size_usd": "12000",
         "mark_price": "66000"},
        {"snapshot_date": "2024-01-16", "side": "short", "size_usd": "4000",
         "mark_price": "66000"},
    ]

    # Mock supabase supporting the REAL compute_exposure_metrics call chains:
    #   strategies.select("api_key_id").eq("id",...).limit(1).execute()
    #   strategies.select("id").eq("api_key_id",...).execute()  (sibling check)
    #   position_snapshots.select(...).eq("strategy_id",...).order(...).execute()
    def _table(name):
        t = MagicMock()
        if name == "strategies":
            sel = MagicMock()

            def _select(cols):
                eq = MagicMock()
                if "api_key_id" in cols:
                    # self lookup: .eq("id", ...).limit(1).execute()
                    limit = MagicMock()
                    limit.execute.return_value = MagicMock(
                        data=[{"api_key_id": "key-1"}]
                    )
                    eq.limit.return_value = limit
                else:
                    # sibling check: .eq("api_key_id", ...).execute()
                    # Return exactly ONE row so the shared-api-key skip path
                    # does NOT fire (len(sib_rows) == 1).
                    eq.execute.return_value = MagicMock(
                        data=[{"id": "strat-test"}]
                    )
                sel.eq.return_value = eq
                return sel

            t.select = _select
        elif name == "position_snapshots":
            sel = MagicMock()
            eq = MagicMock()
            order = MagicMock()
            order.execute.return_value = MagicMock(data=snapshot_rows)
            eq.order.return_value = order
            sel.eq.return_value = eq
            t.select.return_value = sel
        return t

    mock_supabase = MagicMock(spec=Client)
    mock_supabase.table = _table

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        result = await compute_exposure_metrics("strat-test", mock_supabase)

    # The shared-key skip must NOT have fired (sibling check returned 1 row).
    assert "exposure_series" in result, (
        f"real compute_exposure_metrics did not produce exposure_series; "
        f"got keys {sorted(result.keys())}"
    )
    series = result["exposure_series"]
    assert len(series) == 2, f"expected one point per snapshot date; got {series!r}"

    by_date = {pt["date"]: pt for pt in series}
    # Day 1: gross = |10000| + |5000| = 15000; net = +10000 + 5000 = 15000.
    assert by_date["2024-01-15"]["gross"] == pytest.approx(15000.0)
    assert by_date["2024-01-15"]["net"] == pytest.approx(15000.0)
    # Day 2: gross = |12000| + |4000| = 16000; net = +12000 - 4000 = 8000.
    assert by_date["2024-01-16"]["gross"] == pytest.approx(16000.0)
    assert by_date["2024-01-16"]["net"] == pytest.approx(8000.0)

    # Aggregates are derived from the SAME per-date series, so pin them too.
    assert result["max_gross_exposure"] == pytest.approx(16000.0)
    assert result["mean_gross_exposure"] == pytest.approx((15000.0 + 16000.0) / 2)


# ---------------------------------------------------------------------------
# Audit-2026-05-07 C-0221 — `_load_position_time_series` MUST NOT write the
# raw tenant `account_balance` into `nav_by_date` (the value propagates to
# the public `turnover_series` sibling row and is readable by anon via the
# `fetch_strategy_lazy_metrics` RPC). Use a normalized constant proxy.
# ---------------------------------------------------------------------------


class TestLoadPositionTimeSeriesNavSafety:
    @pytest.mark.asyncio
    async def test_nav_proxy_uses_rolling_max_gross_exposure(
        self,
    ) -> None:
        """C-0221 is now enforced by construction (account_balance is not a
        parameter of `_load_position_time_series`), but the NAV-proxy
        contract still needs a regression guard: nav values must equal the
        rolling-max gross exposure, constant within a run."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-16",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "12000",
                "mark_price": "66000",
            },
        ]

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            _, _, nav_by_date = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Contract: NAV proxy is per-strategy rolling max gross exposure,
        # constant within a run. max(|10000| over 2024-01-15, |12000| over
        # 2024-01-16) = 12000.
        assert nav_by_date, "expected NAV entries for the two snapshot dates"
        nav_values = set(nav_by_date.values())
        assert nav_values == {12000.0}, (
            f"NAV proxy must be the rolling-max gross exposure (12000) and "
            f"constant within the run; got distinct values {nav_values}"
        )

    @pytest.mark.asyncio
    async def test_nav_proxy_handles_multi_symbol_same_day(
        self,
    ) -> None:
        """NAV proxy sums |size_usd| across all symbols on a date when picking
        the rolling-max gross exposure (C-0221 + H-0636 follow-up).
        Pins the H-0632 branch."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "short",
                "size_usd": "5000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            _, _, nav = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # max_gross_exposure on 2024-01-15 = |10000| + |-5000| = 15000.
        # Constant within the run.
        assert set(nav.values()) == {15000.0}, (
            f"NAV proxy should be rolling-max gross exposure (15000); got {nav}"
        )

    @pytest.mark.asyncio
    async def test_empty_snapshots_yields_empty_grids(self) -> None:
        """H-0631 coverage: empty snapshots → all three grids empty."""
        from services.analytics_runner import _load_position_time_series

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=[])
        order.range = _make_paged_range([])
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, nav = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        assert positions == {} and prices == {} and nav == {}

    @pytest.mark.asyncio
    async def test_snapshot_fetch_uses_pagination(self) -> None:
        """H-0629 / H-0643 regression: `_load_position_time_series` paginates
        through `.range()` so PostgREST's 1000-row default cap does not
        silently truncate snapshot reads for multi-year / multi-symbol
        strategies. The runner should iterate `.range()` until a short page
        appears.
        """
        from services.analytics_runner import _load_position_time_series

        # Build a 2-page paginated mock: page 0 yields 1000 rows, page 1
        # yields 200 rows (short page → loop terminates).
        page_size = 1000
        page0_rows = [
            {
                "snapshot_date": "2024-01-01",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(page_size)
        ]
        page1_rows = [
            {
                "snapshot_date": "2024-01-02",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(200)
        ]
        pages = [page0_rows, page1_rows]
        range_calls: list[tuple[int, int]] = []
        order_calls: list[tuple[str, bool]] = []

        order = MagicMock()
        order.execute.return_value = MagicMock(data=[])

        def _range(start, end):
            range_calls.append((start, end))
            page_idx = start // page_size
            data = pages[page_idx] if page_idx < len(pages) else []
            r = MagicMock()
            r.execute.return_value = MagicMock(data=data)
            return r

        order.range = MagicMock(side_effect=_range)

        # Capture every .order() call on the configured mock so the
        # composite order_by contract (snapshot_date, symbol, side) is
        # pinned. A regression that drops a column or reorders them
        # would surface here instead of going latent.
        def _order_side_effect(column, *, desc=False, **_kw):
            order_calls.append((column, bool(desc)))
            return order

        order.order.side_effect = _order_side_effect

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()

        def _eq_order_side_effect(column, *, desc=False, **_kw):
            order_calls.append((column, bool(desc)))
            return order

        eq.order = MagicMock(side_effect=_eq_order_side_effect)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, _, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Both pages worth of symbols must appear in positions.
        assert len(range_calls) == 2, (
            f".range() should be invoked once per page until short-page; "
            f"got {len(range_calls)} calls: {range_calls}"
        )
        assert range_calls[0] == (0, page_size - 1)
        assert range_calls[1] == (page_size, 2 * page_size - 1)
        # Page 0 has 1000 unique symbols on 2024-01-01; page 1 has 200 on 2024-01-02.
        assert len(positions["2024-01-01"]) == 1000
        assert len(positions["2024-01-02"]) == 200

        # Audit-2026-05-07 follow-up: pin the composite order_by contract.
        # Non-unique sort keys allow PostgREST to reorder ties across
        # pages → cross-page duplicates / skips → corrupted aggregates.
        # The composite (snapshot_date, symbol, side) matches the
        # `position_snapshots_unique_per_day` index from migration 034.
        assert order_calls == [
            ("snapshot_date", False),
            ("symbol", False),
            ("side", False),
        ], (
            "Snapshot pagination must order by the unique composite "
            "(snapshot_date, symbol, side) so cross-page ties cannot "
            f"duplicate or skip rows. Got order calls: {order_calls!r}"
        )

    @pytest.mark.asyncio
    async def test_short_side_is_signed_negative(self) -> None:
        """H-0631 coverage: short positions appear with negative signed size_usd."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "short",
                "size_usd": "5000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, _, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        assert positions["2024-01-15"]["ETHUSDT"] == -5000.0, (
            f"shorts must store signed-negative size_usd; got {positions}"
        )

    @pytest.mark.asyncio
    async def test_near_zero_size_is_skipped(self) -> None:
        """H-0644 / H-0654 regression: a NUMERIC residual like 1e-15 must be
        skipped just like an exact 0.0 — otherwise it poisons the
        positions/prices grids with phantom entries that show up as
        artificial turnover_series datapoints."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "1e-15",  # NUMERIC residual after partial close
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # ETH is kept, BTC residual is skipped.
        assert "BTCUSDT" not in positions.get("2024-01-15", {}), (
            f"near-zero size_usd should be filtered out; got {positions}"
        )
        assert positions["2024-01-15"]["ETHUSDT"] == 10000.0
        # Prices grid likewise must not carry the residual symbol.
        assert "BTCUSDT" not in prices.get("2024-01-15", {})

    @pytest.mark.asyncio
    async def test_malformed_mark_price_does_not_poison_prices_grid(
        self,
    ) -> None:
        """H-0631 coverage: non-numeric mark_price must be skipped silently
        without breaking the positions grid for that snapshot."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "garbage",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Position recorded, price omitted.
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "BTCUSDT" not in prices.get("2024-01-15", {})

    @pytest.mark.asyncio
    async def test_malformed_size_usd_is_surfaced_not_silently_dropped(
        self, caplog,
    ) -> None:
        """Audit-2026-05-07 M-0654: a non-numeric `size_usd` was silently
        coerced to 0.0 and then dropped by the zero-tolerance skip — corrupting
        the turnover/exposure grids with NO operator signal.

        WHY this matters: a migration / connector bug that leaves, say, 5% of
        snapshot rows with non-numeric size_usd would silently shrink the
        position grid by 5% and degrade every panel built on it (turnover,
        exposure) with nothing in the logs to point an operator at the cause.
        The fix must (a) still drop the corrupt row from the grid (it has no
        usable size) but (b) emit a counted warning so the drop is observable —
        mirroring the counter+warning convention the sibling fill helpers use.

        Pin BOTH halves: the good row survives, the corrupt row is absent, AND
        a warning naming the count fires. The OLD behavior emitted no log.
        """
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "long",
                "size_usd": "NOT_A_NUMBER",  # corrupt — was silently → 0.0 → dropped
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with caplog.at_level(
            logging.WARNING, logger="quantalyze.analytics.runner"
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Good row survives; corrupt row is dropped from BOTH grids (it has no
        # usable signed size — keeping it would poison the turnover delta).
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "ETHUSDT" not in positions.get("2024-01-15", {})
        assert "ETHUSDT" not in prices.get("2024-01-15", {})
        # The drop is SURFACED, not silent — a warning naming size_usd fires.
        # This is the assertion that fails on the OLD silent-coerce behavior.
        size_warnings = [
            r for r in caplog.records
            if r.levelno == logging.WARNING and "size_usd" in r.getMessage()
        ]
        assert size_warnings, (
            "a non-numeric size_usd must emit a counted warning (M-0654), "
            f"not be silently coerced to 0.0; caplog={[r.getMessage() for r in caplog.records]}"
        )

    @pytest.mark.asyncio
    async def test_non_finite_size_usd_is_coerced_and_surfaced(
        self, caplog,
    ) -> None:
        """M-0654 isfinite branch: a size_usd that PARSES via float() but is
        NaN/Inf must be coerced to 0.0, dropped from the grid, AND counted —
        distinct from the ValueError path covered by the sibling test above.

        WHY: without the `math.isfinite` guard, ``float('inf')`` (or 'nan')
        passes the zero-tolerance skip (``abs(inf) < tol`` is False) and writes
        ``signed=inf`` into positions_by_date, poisoning every turnover /
        exposure cell that aggregates it — with no operator signal, since
        ``size_malformed`` stays False and the counted warning never fires.
        The "garbage" sibling test does NOT cover this branch: it raises
        ValueError before `isfinite` is ever reached.
        """
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "long",
                "size_usd": "inf",  # parses to float('inf') — not a ValueError
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with caplog.at_level(
            logging.WARNING, logger="quantalyze.analytics.runner"
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Good row survives; the non-finite row is coerced → 0.0 → dropped
        # (NOT written as inf).
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "ETHUSDT" not in positions.get("2024-01-15", {})
        # No NaN/Inf leaked into ANY position cell — this is the assertion the
        # missing isfinite guard breaks (signed=inf would land in the grid).
        for sym_map in positions.values():
            for v in sym_map.values():
                assert math.isfinite(v), f"non-finite size leaked into grid: {v!r}"
        # The drop is surfaced — same counter + warning as the ValueError path.
        size_warnings = [
            r for r in caplog.records
            if r.levelno == logging.WARNING and "size_usd" in r.getMessage()
        ]
        assert size_warnings, (
            "a non-finite size_usd must emit a counted warning (M-0654); "
            f"caplog={[r.getMessage() for r in caplog.records]}"
        )

    @pytest.mark.asyncio
    async def test_malformed_mark_price_is_surfaced_not_silently_dropped(
        self, caplog,
    ) -> None:
        """Audit-2026-05-07 M-0654 (mark_price half): a non-numeric mark_price
        was silently `pass`-ed, omitting the price with no signal. The position
        survives (size is fine) but the turnover ratio for that symbol-date is
        unavailable — and an operator had no way to know why. Assert the omission
        is now counted + warned, while the position grid is unaffected."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "garbage",  # non-numeric → price omitted
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with caplog.at_level(
            logging.WARNING, logger="quantalyze.analytics.runner"
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Position kept (size is valid), price omitted — unchanged behavior.
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "BTCUSDT" not in prices.get("2024-01-15", {})
        # But the omission is now SURFACED via a counted warning (M-0654).
        mark_warnings = [
            r for r in caplog.records
            if r.levelno == logging.WARNING and "mark_price" in r.getMessage()
        ]
        assert mark_warnings, (
            "a non-numeric mark_price must emit a counted warning (M-0654), "
            f"not silently pass; caplog={[r.getMessage() for r in caplog.records]}"
        )

    @pytest.mark.asyncio
    async def test_clean_snapshots_emit_no_data_quality_warnings(
        self, caplog,
    ) -> None:
        """M-0654 false-positive guard: a clean snapshot set must NOT emit the
        malformed-size_usd / malformed-mark_price warnings. Otherwise every
        normal run would log noise and operators couldn't distinguish a real
        data-quality issue from background spam (the same reasoning the sibling
        helpers' counter+warning gate on `> 0`)."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-16",
                "symbol": "ETHUSDT",
                "side": "short",
                "size_usd": "5000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with caplog.at_level(
            logging.WARNING, logger="quantalyze.analytics.runner"
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            await _load_position_time_series("strat-test", mock_supabase)

        dq_warnings = [
            r for r in caplog.records
            if r.levelno == logging.WARNING
            and ("size_usd" in r.getMessage() or "mark_price" in r.getMessage())
        ]
        assert not dq_warnings, (
            "clean snapshots must not emit malformed-field warnings (M-0654 "
            f"gates on count > 0); got {[r.getMessage() for r in dq_warnings]}"
        )

    # Phase B pr-test-analyzer F7: `_load_position_time_series` declares
    # `except PaginatedSelectTruncated: raise` to fail loud. The runner has
    # a broad `except Exception` immediately after; a reorder regression
    # would let the typed exception fall through into the SNAPSHOTS_LOAD_FAILED
    # DQF path. This test pins the re-raise contract.
    @pytest.mark.asyncio
    async def test_snapshot_pagination_truncation_raises_typed_exception(
        self,
    ) -> None:
        from services.analytics_runner import _load_position_time_series
        from services.db import PaginatedSelectTruncated

        # Build a mock whose `.range()` ALWAYS returns a full page — the
        # helper will run until it hits hard_cap_pages and then raise.
        page_size = 1000
        full_page = [
            {
                "snapshot_date": "2024-01-01",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(page_size)
        ]

        order = MagicMock()
        order.execute.return_value = MagicMock(data=full_page)

        def _range(_start, _end):
            r = MagicMock()
            r.execute.return_value = MagicMock(data=full_page)
            return r

        order.range = MagicMock(side_effect=_range)
        order.order.return_value = order

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        eq.order.return_value = order
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            with pytest.raises(PaginatedSelectTruncated):
                await _load_position_time_series("strat-truncated", mock_supabase)

# ---------------------------------------------------------------------------
# NEW-C02-07: _compute_position_side_volume_pcts — malformed cost guard
# ---------------------------------------------------------------------------


def test_position_side_volume_pcts_malformed_cost_does_not_raise():
    """NEW-C02-07: a single fill with non-numeric cost must NOT raise —
    it must contribute 0 to the attribution totals."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    fills = [
        {"timestamp": "2024-01-15T10:00:00+00:00", "cost": "NOT_A_NUMBER"},
        {"timestamp": "2024-01-16T10:00:00+00:00", "cost": 500.0},
    ]
    positions = [
        {
            "opened_at": "2024-01-01T00:00:00+00:00",
            "closed_at": "2024-01-31T00:00:00+00:00",
            "side": "long",
        }
    ]
    # Must not raise; malformed fill contributes cost=0
    result = _compute_position_side_volume_pcts(fills, positions)
    # Only the 500.0 fill attributed → long_volume_pct = 1.0 (100%), short = 0.0
    assert result["long_volume_pct"] == pytest.approx(1.0), (
        f"long_volume_pct={result['long_volume_pct']} — malformed cost fill "
        "must not alter attribution of valid fills (NEW-C02-07)"
    )
    assert result["short_volume_pct"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# NEW-C02-08 / C02-09 / C02-10: _compute_volume_aggregator — guarded notional,
# single-pass, turnover_timestamp_coverage flag
# ---------------------------------------------------------------------------


def test_volume_aggregator_malformed_notional_does_not_raise():
    """NEW-C02-09: non-numeric notional_usd must contribute 0, not crash."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": "NOT_A_NUMBER", "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T11:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    # Malformed fill contributes 0; only 1000.0 counts
    assert result["gross_volume_usd"] == pytest.approx(1000.0), (
        "malformed notional_usd must contribute 0 to gross_volume (NEW-C02-09)"
    )


def test_volume_aggregator_emits_coverage_flag_on_missing_timestamps():
    """NEW-C02-08: when some fills lack timestamps, turnover_timestamp_coverage
    must be present in the result and be < 1.0."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 500.0, "filled_at": None},  # no timestamp
        {"notional_usd": 300.0},                     # no timestamp key
    ]
    result = _compute_volume_aggregator(fills)
    assert "turnover_timestamp_coverage" in result, (
        "turnover_timestamp_coverage must be emitted when fills lack timestamps "
        "(NEW-C02-08 regression)"
    )
    coverage = result["turnover_timestamp_coverage"]
    # 1 of 3 fills has a timestamp → 1/3 ≈ 0.3333
    assert coverage == pytest.approx(1 / 3, abs=1e-3), (
        f"Expected coverage ≈ 0.333, got {coverage}"
    )


def test_volume_aggregator_no_coverage_flag_when_all_timestamped():
    """NEW-C02-08: when all fills have timestamps, turnover_timestamp_coverage
    must NOT be emitted (coverage=1.0 is the happy path)."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 500.0, "filled_at": "2024-01-16T10:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert "turnover_timestamp_coverage" not in result, (
        "turnover_timestamp_coverage must not appear when all fills are timestamped "
        "(NEW-C02-08)"
    )


def test_volume_aggregator_single_pass_gross_matches_turnover_subset(sample_fills):
    """NEW-C02-10: gross_volume computed in the single pass must equal the sum
    of all notional_usd values, identical to the pre-refactor two-pass result."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator(sample_fills)
    expected_gross = sum(abs(float(f["notional_usd"])) for f in sample_fills)
    assert result["gross_volume_usd"] == pytest.approx(expected_gross), (
        "gross_volume_usd must equal sum of all notionals after single-pass "
        "refactor (NEW-C02-10)"
    )


def test_volume_aggregator_mean_excludes_zero_notional_fills():
    """Audit-2026-05-07 M-0645: `mean_trade_size_usd` must average over fills
    that carry a real (> 0) notional, NOT over every row.

    WHY this matters: raw_fills includes zero-notional rows (orders placed but
    never filled, cancelled, partial-fill edge cases, or malformed-coerced-to-0).
    The old code divided gross_volume by len(fills), so those dead rows silently
    dragged the published mean toward zero in proportion to how many existed —
    an allocator reading `mean_trade_size_usd` would see a number diluted by
    activity that never moved size. The denominator must be the count of fills
    with notional > 0.

    Construct a set where exactly half the fills have zero notional. The mean
    over the real fills is 1000.0; the OLD (broken) per-row mean would be 500.0.
    Pinning 1000.0 fails loudly on a regression to `gross / len(fills)`.
    """
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 0.0, "filled_at": "2024-01-15T11:00:00+00:00"},   # never filled
        {"notional_usd": 1000.0, "filled_at": "2024-01-16T10:00:00+00:00"},
        {"notional_usd": 0.0, "filled_at": "2024-01-16T11:00:00+00:00"},   # cancelled
    ]
    result = _compute_volume_aggregator(fills)
    # gross is unchanged — zero-notional rows add nothing to the sum.
    assert result["gross_volume_usd"] == pytest.approx(2000.0)
    # mean averages over the 2 fills with a real notional (2000/2), NOT 2000/4.
    assert result["mean_trade_size_usd"] == pytest.approx(1000.0), (
        "mean_trade_size_usd must divide gross_volume by the count of fills "
        "with notional > 0 (M-0645); dividing by len(fills) would yield 500.0 "
        f"and dilute the mean. got {result['mean_trade_size_usd']}"
    )


def test_volume_aggregator_mean_zero_when_all_notional_zero():
    """M-0645 divide-by-zero guard: a fill set where every notional is 0 (all
    cancelled / never filled) must yield mean_trade_size_usd == 0.0, not raise
    ZeroDivisionError. There are no real trades to average."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 0.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 0.0, "filled_at": "2024-01-16T10:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert result["gross_volume_usd"] == pytest.approx(0.0)
    assert result["mean_trade_size_usd"] == pytest.approx(0.0), (
        "all-zero-notional fills must give mean 0.0 (guarded), not divide by zero"
    )


def test_volume_aggregator_malformed_notional_excluded_from_mean_denominator():
    """M-0645 + M-0654 interaction: a malformed notional is coerced to 0 (and
    counted as a parse failure). Because it is now 0, it must ALSO be excluded
    from the mean denominator — otherwise the malformed row both contributes 0
    to the numerator and inflates the denominator, double-diluting the mean."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": "GARBAGE", "filled_at": "2024-01-16T10:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert result["gross_volume_usd"] == pytest.approx(1000.0)
    # Only the one real fill counts in the denominator → mean == 1000, not 500.
    assert result["mean_trade_size_usd"] == pytest.approx(1000.0), (
        "a malformed (→0) notional must not inflate the mean denominator (M-0645)"
    )


# ---------------------------------------------------------------------------
# NEW-C02-09: _compute_trade_mix — guarded notional cast
# ---------------------------------------------------------------------------


def test_trade_mix_malformed_notional_does_not_raise():
    """NEW-C02-09: non-numeric notional_usd in _compute_trade_mix must contribute
    0 to total_notional, not crash the whole run."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "notional_usd": "BAD", "is_maker": True},
        {"side": "sell", "notional_usd": 200.0, "is_maker": False},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    # long_maker: count=1, total_notional=0 (bad → 0); short_taker: count=1, total_notional=200
    assert result["long_maker"]["count"] == 1
    assert result["long_maker"]["total_notional"] == pytest.approx(0.0), (
        "malformed notional must contribute 0 to total_notional (NEW-C02-09)"
    )
    assert result["short_taker"]["total_notional"] == pytest.approx(200.0)


# ---------------------------------------------------------------------------
# NEW-C02-06: CSV sibling upsert must not flip computation_status to 'failed'
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_csv_sibling_upsert_failure_keeps_complete_status():
    """NEW-C02-06: if the sibling-table RPC raises after _mark_complete, the
    strategy must remain 'complete' (not be overwritten to 'failed').
    Mirrors the exchange runner's sibling-failure handling."""
    from unittest.mock import AsyncMock, MagicMock, patch

    import pandas as pd
    import numpy as np

    from services.analytics_runner import run_csv_strategy_analytics
    from services.metrics import MetricsResult

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ] * 5  # 15 rows

    upsert_statuses: list[str] = []

    # Build supabase mock that tracks upsert statuses and fails on the RPC call
    sb = MagicMock()
    table_mock = MagicMock()
    sb.table.return_value = table_mock

    # select chain for the strategy existence probe + data load
    select_chain = MagicMock()
    eq_chain = MagicMock()
    order_chain = MagicMock()
    order_chain.execute.return_value = MagicMock(data=rows)
    range_chain = MagicMock()
    range_chain.execute.return_value = MagicMock(data=rows)
    order_chain.range.return_value = range_chain
    eq_chain.order.return_value = order_chain
    select_chain.eq.return_value = eq_chain
    table_mock.select.return_value = select_chain

    def upsert_side_effect(payload, **kwargs):
        status = payload.get("computation_status")
        if status:
            upsert_statuses.append(status)
        m = MagicMock()
        m.execute = MagicMock(return_value=MagicMock(data=[]))
        return m

    table_mock.upsert.side_effect = upsert_side_effect

    # RPC blip: the SIBLING upsert fails. Phase 105 (BB-02) added a cash_settlement
    # series persist that ALSO routes through sb.rpc BEFORE the scalar flip — that one
    # must SUCCEED (a persist failure legitimately fails the whole run, D5 fail-loud), so
    # distinguish by p_kinds: the sibling call (no cash_settlement kind) is the one that
    # blips.
    def _rpc(name, payload):
        m = MagicMock()
        if "cash_settlement" in payload.get("p_kinds", {}):
            m.execute = MagicMock(return_value=MagicMock(data=[]))
        else:
            m.execute = MagicMock(
                side_effect=RuntimeError("simulated RPC blip (NEW-C02-06)")
            )
        return m
    sb.rpc.side_effect = _rpc

    # MetricsResult WITH sibling_kinds so the RPC path is exercised
    def _make_result_with_siblings():
        return MetricsResult(
            metrics_json={
                "cumulative_return": 0.1, "cagr": 0.12, "volatility": 0.2,
                "sharpe": 1.5, "sortino": 2.0, "calmar": 1.0,
                "max_drawdown": -0.05, "max_drawdown_duration_days": 5,
                "six_month_return": 0.06, "sparkline_returns": [],
                "sparkline_drawdown": [], "metrics_json": {},
                "returns_series": [], "drawdown_series": [],
                "monthly_returns": {}, "rolling_metrics": {}, "return_quantiles": {},
            },
            sibling_kinds={"rolling_sharpe": []},  # non-empty → triggers RPC
        )

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.basis_series.compute_all_metrics",
               return_value=_make_result_with_siblings()):
        result = await run_csv_strategy_analytics("test-csv-c02-06")

    # Must have returned complete despite sibling failure
    assert result == {"status": "complete", "strategy_id": "test-csv-c02-06"}, (
        f"run_csv_strategy_analytics must return 'complete' when sibling RPC fails; "
        f"got {result} (NEW-C02-06 regression)"
    )
    # Must have written 'complete' status — never 'failed'
    assert "complete" in upsert_statuses, (
        f"Expected at least one 'complete' upsert; got: {upsert_statuses}"
    )
    assert "failed" not in upsert_statuses, (
        f"Sibling-table RPC failure must NOT overwrite status to 'failed'; "
        f"got statuses: {upsert_statuses} (NEW-C02-06)"
    )


# ---------------------------------------------------------------------------
# SF-H2: float("nan") / float("inf") must not bypass guards in the three
#         new cost/notional sites (specialist review 2026-05-26)
# ---------------------------------------------------------------------------


def test_position_side_volume_pcts_nan_cost_coerced_to_zero():
    """SF-H2: float('nan') in cost field must be coerced to 0, not poison
    attributed_total (NaN <= 0 evaluates False, silently computing NaN/NaN=NaN)."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    fills = [
        {"timestamp": "2024-01-15T10:00:00+00:00", "cost": float("nan")},
        {"timestamp": "2024-01-16T10:00:00+00:00", "cost": 500.0},
    ]
    positions = [
        {
            "opened_at": "2024-01-01T00:00:00+00:00",
            "closed_at": "2024-01-31T00:00:00+00:00",
            "side": "long",
        }
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    # NaN fill must contribute 0; only 500.0 fill counts → long_pct=1.0
    assert math.isfinite(result["long_volume_pct"]), (
        f"long_volume_pct is non-finite ({result['long_volume_pct']}) — "
        "NaN cost bypassed guard and poisoned attributed_total (SF-H2)"
    )
    assert result["long_volume_pct"] == pytest.approx(1.0), (
        "NaN cost fill must contribute 0 to attribution; only 500.0 fill counts"
    )


def test_position_side_volume_pcts_inf_cost_coerced_to_zero():
    """SF-H2: float('inf') in cost field must be coerced to 0."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    fills = [
        {"timestamp": "2024-01-15T10:00:00+00:00", "cost": float("inf")},
        {"timestamp": "2024-01-16T10:00:00+00:00", "cost": 200.0},
    ]
    positions = [
        {
            "opened_at": "2024-01-01T00:00:00+00:00",
            "closed_at": "2024-01-31T00:00:00+00:00",
            "side": "long",
        }
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    assert math.isfinite(result["long_volume_pct"]), (
        f"long_volume_pct is non-finite — Inf cost bypassed guard (SF-H2)"
    )


def test_volume_aggregator_nan_notional_coerced_to_zero():
    """SF-H2: float('nan') in notional_usd must be coerced to 0, not poison
    gross_volume (which would make mean_size / daily_avg NaN)."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": float("nan"), "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T11:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert math.isfinite(result["gross_volume_usd"]), (
        f"gross_volume_usd is non-finite ({result['gross_volume_usd']}) — "
        "NaN notional bypassed guard and poisoned gross_volume (SF-H2)"
    )
    assert result["gross_volume_usd"] == pytest.approx(1000.0), (
        "NaN notional must contribute 0; only 1000.0 counts"
    )


def test_volume_aggregator_inf_notional_coerced_to_zero():
    """SF-H2: float('inf') in notional_usd must be coerced to 0."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": float("inf"), "filled_at": "2024-01-15T10:00:00+00:00"},
        {"notional_usd": 500.0, "filled_at": "2024-01-15T11:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert math.isfinite(result["gross_volume_usd"]), (
        f"gross_volume_usd is non-finite — Inf notional bypassed guard (SF-H2)"
    )
    assert result["gross_volume_usd"] == pytest.approx(500.0)


def test_trade_mix_nan_notional_coerced_to_zero():
    """SF-H2: float('nan') in notional_usd for _compute_trade_mix must be
    coerced to 0 rather than accumulating into total_notional."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "notional_usd": float("nan"), "is_maker": True},
        {"side": "sell", "notional_usd": 300.0, "is_maker": False},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert math.isfinite(result["long_maker"]["total_notional"]), (
        f"long_maker total_notional is non-finite — NaN notional bypassed guard (SF-H2)"
    )
    assert result["long_maker"]["total_notional"] == pytest.approx(0.0), (
        "NaN notional must contribute 0 to total_notional"
    )
    assert result["short_taker"]["total_notional"] == pytest.approx(300.0)


# ---------------------------------------------------------------------------
# Phase 76 (v1.8 DQ-02): flow_coverage_incomplete status lift (run_csv path)
# ---------------------------------------------------------------------------
def _csv_supabase_mock(rows, *, existing_flags):
    """Supabase mock for run_csv_strategy_analytics: existence probe + paginated
    data load + a maybe_single read of the pre-existing data_quality_flags (the
    DQ-02 pre-stamp channel). Records every upsert payload on ``.upserts``."""
    sb = MagicMock()
    table_mock = MagicMock()
    sb.table.return_value = table_mock

    select_chain = MagicMock()
    eq_chain = MagicMock()
    # data load: .select().eq().order().range().execute()
    order_chain = MagicMock()
    order_chain.execute.return_value = MagicMock(data=rows)
    range_chain = MagicMock()
    range_chain.execute.return_value = MagicMock(data=rows)
    order_chain.range.return_value = range_chain
    eq_chain.order.return_value = order_chain
    # existence probe: .select().eq().single().execute()
    single_chain = MagicMock()
    single_chain.execute.return_value = MagicMock(data={"id": "s1", "user_id": "u1"})
    eq_chain.single.return_value = single_chain
    # DQ-02 pre-stamp read: .select().eq().maybe_single().execute()
    maybe_single_chain = MagicMock()
    maybe_single_chain.execute.return_value = MagicMock(
        data={"data_quality_flags": dict(existing_flags)}
    )
    eq_chain.maybe_single.return_value = maybe_single_chain
    select_chain.eq.return_value = eq_chain
    table_mock.select.return_value = select_chain

    sb.upserts = []

    def _upsert(payload, **_kw):
        sb.upserts.append(dict(payload))
        m = MagicMock()
        m.execute = MagicMock(return_value=MagicMock(data=[]))
        return m

    table_mock.upsert.side_effect = _upsert
    sb.rpc.return_value = MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))
    return sb


def _clean_metrics_result():
    return MetricsResult(
        metrics_json={
            "cumulative_return": 0.1, "cagr": 0.12, "volatility": 0.2,
            "sharpe": 1.5, "sortino": 2.0, "calmar": 1.0,
            "max_drawdown": -0.05, "max_drawdown_duration_days": 5,
            "six_month_return": 0.06, "sparkline_returns": [],
            "sparkline_drawdown": [], "metrics_json": {},
            "returns_series": [], "drawdown_series": [],
            "monthly_returns": {}, "rolling_metrics": {}, "return_quantiles": {},
        },
        sibling_kinds={},
    )


@pytest.mark.asyncio
async def test_csv_run_promotes_to_warnings_when_flow_coverage_prestamped():
    """DQ-02 surfacing: when derive_broker_dailies PRE-STAMPED
    flow_coverage_incomplete onto strategy_analytics, the CSV run PRESERVES the
    flag and promotes computation_status to complete_with_warnings — the broker
    factsheet honestly signals the refused retention gap."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]
    sb = _csv_supabase_mock(
        rows,
        existing_flags={"csv_source": True, "flow_coverage_incomplete": True},
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_clean_metrics_result()):
        result = await run_csv_strategy_analytics("s1")

    assert result["status"] == "complete"  # returns 'complete' string envelope
    complete = [
        u for u in sb.upserts
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert complete, "expected a completion upsert"
    final = complete[-1]
    assert final["computation_status"] == "complete_with_warnings", (
        "a pre-stamped flow_coverage_incomplete must promote the CSV factsheet"
    )
    assert (final.get("data_quality_flags") or {}).get("flow_coverage_incomplete"), (
        "the flag must be preserved on the completion upsert, not wiped"
    )


@pytest.mark.asyncio
async def test_csv_run_stays_complete_without_flow_coverage_flag():
    """SC-4: a normal broker/CSV account (no pre-stamped coverage gap) keeps its
    exact-string 'complete' — the 8 downstream consumers that gate on it are
    unaffected."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]
    sb = _csv_supabase_mock(rows, existing_flags={"csv_source": True})
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=([], False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_clean_metrics_result()):
        await run_csv_strategy_analytics("s1")

    complete = [
        u for u in sb.upserts
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert complete
    final = complete[-1]
    assert final["computation_status"] == "complete", (
        "no coverage gap → status must stay exact-string 'complete' (SC-4)"
    )
    assert not (final.get("data_quality_flags") or {}).get("flow_coverage_incomplete")


@pytest.mark.asyncio
async def test_csv_run_promotes_to_warnings_when_dq01_guard_prestamped():
    """MED-2: when derive_broker_dailies PRE-STAMPED a DQ-01 guard flag
    (flow_dominated_guard — a NaN-broken day honestly absent from
    csv_daily_returns) onto strategy_analytics, the CSV run PRESERVES it and
    promotes computation_status to complete_with_warnings — bridging the guard
    meta to the broker factsheet. Mutation: dropping the guard flags from the
    read/promote leaves status 'complete' → RED."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]
    sb = _csv_supabase_mock(
        rows,
        existing_flags={"csv_source": True, "flow_dominated_guard": True},
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=([], False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_clean_metrics_result()):
        await run_csv_strategy_analytics("s1")

    complete = [
        u for u in sb.upserts
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert complete
    final = complete[-1]
    assert final["computation_status"] == "complete_with_warnings", (
        "a pre-stamped DQ-01 guard flag must promote the broker CSV factsheet"
    )
    assert (final.get("data_quality_flags") or {}).get("flow_dominated_guard"), (
        "the guard flag must be preserved on the completion upsert, not wiped"
    )


@pytest.mark.asyncio
async def test_csv_run_promotes_to_warnings_when_unrealized_pnl_prestamped():
    """FLOW-04 (v1.8, 77-03): when derive_broker_dailies PRE-STAMPED
    unrealized_pnl_in_anchor (a material open-uPnL wedge) onto strategy_analytics,
    the CSV run PRESERVES the flag and promotes computation_status to
    complete_with_warnings — bridging the wedge materiality to the broker
    factsheet, mirroring the flow_coverage / DQ-01 guard bridges. Mutation:
    dropping unrealized_pnl_in_anchor from the broker warn-flag lift leaves status
    'complete' → RED."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]
    sb = _csv_supabase_mock(
        rows,
        existing_flags={"csv_source": True, "unrealized_pnl_in_anchor": True},
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=([], False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_clean_metrics_result()):
        await run_csv_strategy_analytics("s1")

    complete = [
        u for u in sb.upserts
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert complete
    final = complete[-1]
    assert final["computation_status"] == "complete_with_warnings", (
        "a pre-stamped unrealized_pnl_in_anchor must promote the broker CSV factsheet"
    )
    assert (final.get("data_quality_flags") or {}).get("unrealized_pnl_in_anchor"), (
        "the wedge materiality flag must be preserved on the completion upsert"
    )


@pytest.mark.asyncio
async def test_csv_run_stays_complete_without_unrealized_pnl_flag():
    """SC-4: a broker/CSV account with no pre-stamped unrealized_pnl_in_anchor
    keeps its exact-string 'complete' — the 8 downstream consumers that gate on it
    are unaffected (an immaterial / zero-wedge account is clean-complete)."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]
    sb = _csv_supabase_mock(rows, existing_flags={"csv_source": True})
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=([], False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_clean_metrics_result()):
        await run_csv_strategy_analytics("s1")

    complete = [
        u for u in sb.upserts
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert complete
    final = complete[-1]
    assert final["computation_status"] == "complete", (
        "no material wedge → status must stay exact-string 'complete' (SC-4)"
    )
    assert not (final.get("data_quality_flags") or {}).get("unrealized_pnl_in_anchor")
