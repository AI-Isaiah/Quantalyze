"""BACKBONE-01 — THE Phase-114 E1 Sharpe/TWR deletion GATE (independent oracle).

WHAT THIS GATES
    No production change in the E1 backbone-absorption phase (plan 114-02
    re-route, plan 114-03 delete) may proceed until this file is GREEN on the
    CURRENT (pre-change) tree. It proves — with a re-derivation that computes
    every expectation INLINE from raw pandas/numpy and NEVER calls the code
    slated for deletion as its own reference — that the legacy
    ``routers.portfolio._compute_sharpe_and_vol`` and
    ``services.portfolio_metrics.compute_twr`` numbers are exactly reproducible
    from the unified backbone ``services.metrics.compute_all_metrics``.

    The parity chain is proven WITHOUT tautology:

        legacy   ≡ inline-oracle   (TestLegacyParityBaseline)
        backbone ≡ inline-oracle   (TestBackboneDerivationParity)
        ∴ legacy ≡ backbone         (transitive; neither leg reads the other)

    Because the inline oracle re-derives the arithmetic from first principles
    (r.std()·√252, r.mean()·252, eq[-1]/eq[0]−1) the transitive equality has no
    circular reference to the symbols being deleted.

ANTI-TAUTOLOGY DATUM (load-bearing, do NOT delete)
    Legacy router TWR (``compute_twr(equity, [])``) collapses to an equity
    ENDPOINT ratio ``eq.iloc[-1]/eq.iloc[0] − 1`` — which, on a ``(1+r).cumprod()``
    series whose first value is ``(1+r_0)``, EXCLUDES day-0's return. The backbone
    ``cumulative_return`` is ``Π(1+r)−1`` over ALL days INCLUDING day 0. These
    genuinely differ by the ``(1+r_0)`` factor whenever ``r_0 ≠ 0``. The divergence
    is ASSERTED here (TestBackboneDerivationParity.test_day0_exclusion_divergence)
    so the gate provably CAN fail — and to pin WHY plan 114-02 must derive TWR
    from equity endpoints, NOT by reading ``cumulative_return``.

HARD STOP
    If any parity assertion fails, DO NOT loosen REL_TOL or edit the oracle to
    force green — that defeats the gate. A real semantic gap (e.g. a quantstats
    ``prepare_returns`` behaviour change) MUST fail this gate. Surface the
    divergence as a founder decision and BLOCK plans 114-02/114-03.

stdlib + pandas + numpy + pytest ONLY. The legacy imports in
TestLegacyParityBaseline are TEMPORARY and are removed together with the symbols
by plan 114-03.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Legacy deletion targets — imported ONLY to prove they equal the inline oracle.
# These two imports (and TestLegacyParityBaseline) are deleted by plan 114-03.
from routers.portfolio import _compute_sharpe_and_vol
from services.portfolio_metrics import compute_twr

# Backbone (survivor) — the unified metrics pipeline that must reproduce them,
# plus the plan-114-02 backbone-module replacement helpers under test.
import services.metrics as metrics_mod
from services.metrics import (
    compute_all_metrics,
    sharpe_vol_status_from_backbone,
    total_return_from_equity,
)

# Numeric parity tolerance. Same math, different op order → agreement to ~1e-16
# in practice; 1e-12 leaves headroom for float reassociation but is orders of
# magnitude tighter than any real semantic gap. Do NOT loosen (HARD STOP rule).
REL_TOL = 1e-12
PPY = 252  # non-crypto annualization clock (portfolio.py legacy uses √252 / ×252)


def _assert_rel(actual: float, expected: float, tol: float = REL_TOL, msg: str = "") -> None:
    """Relative-tolerance equality that fails LOUD (never silently passes NaN)."""
    assert actual is not None, f"actual is None {msg}"
    assert not math.isnan(actual), f"actual is NaN {msg}"
    denom = abs(expected) if expected != 0 else 1.0
    rel = abs(actual - expected) / denom
    assert rel <= tol, f"rel {rel:.3e} > tol {tol:.3e} (actual={actual!r} expected={expected!r}) {msg}"


# ── Deterministic fixtures (module-scope, DatetimeIndex via date_range) ───────
def _fixture_a() -> pd.Series:
    """(a) 120-day seeded daily returns, nonzero day-0 (the anti-tautology lever)."""
    rng = np.random.default_rng(114)
    idx = pd.date_range("2024-01-01", periods=120, freq="D")
    r = pd.Series(rng.normal(0.001, 0.01, 120), index=idx, dtype="float64")
    assert r.iloc[0] != 0.0  # nonzero r_0 is required for the divergence datum
    return r


def _fixture_b() -> pd.Series:
    """(b) 90-day flat all-zeros (zero_volatility edge)."""
    idx = pd.date_range("2024-01-01", periods=90, freq="D")
    return pd.Series(np.zeros(90), index=idx, dtype="float64")


def _fixture_c() -> pd.Series:
    """(c) 1-sample series (insufficient_history edge)."""
    return pd.Series([0.01], index=pd.date_range("2024-01-01", periods=1, freq="D"), dtype="float64")


def _fixture_d() -> pd.Series:
    """(d) short 10-day series with a NEGATIVE day-0 (2nd anti-tautology sample)."""
    rng = np.random.default_rng(2)
    idx = pd.date_range("2024-01-01", periods=10, freq="D")
    r = pd.Series(rng.normal(0.0, 0.02, 10), index=idx, dtype="float64")
    r.iloc[0] = -0.03  # force a negative day-0 to exercise sign handling
    return r


def _fixture_e() -> pd.Series:
    """(e) equity-curve fixture at a non-1.0 baseline (strategy-equity call shape)."""
    idx = pd.date_range("2024-01-01", periods=5, freq="D")
    return pd.Series([1000.0, 1010.0, 1005.0, 1020.0, 1015.0], index=idx, dtype="float64")


def _fixture_f() -> pd.Series:
    """(f) DEGENERATE all-NaN returns, len>=2 (nan_vol edge, the BLOCKER fixture).

    This is exactly the input that slips PAST compute_all_metrics's only
    degenerate guard (metrics.py:457 fires on len<2 ONLY), so it is the case the
    plan-02 helper must handle WITHOUT feeding the full pipeline. NaN-carrying →
    NOT part of the rel-1e-12 numeric parity set.
    """
    return pd.Series([np.nan] * 5, index=pd.date_range("2024-01-01", periods=5, freq="D"), dtype="float64")


# ── Whole-tree caller census (BACKBONE-01 clause 4, pre-delete sweep) ─────────
# Tokens built by concatenation so THIS file's census constants never contain the
# literal deletion-target symbols (belt-and-suspenders with the self-exclusion of
# the walk below — the file's imports/calls DO contain them, hence both guards).
_TWR_TOKEN = "compute" + "_twr"
_SHARPE_TOKEN = "_compute_sharpe" + "_and_vol"

_ANALYTICS_ROOT = Path(__file__).resolve().parent.parent  # tests/ -> analytics-service/

# The pinned inventory (relative posix paths from analytics-service/). Any NEW
# file referencing a deletion target — or any listed file that unexpectedly stops
# referencing one — fails this test loudly. Plan 114-03 updates this set as the
# legacy references disappear.
_PINNED_INVENTORY = frozenset({
    # Definition + all live call sites (routers/portfolio.py: L32 import, L596 def,
    # call sites L811/L835/L948/L985/L2302/L2306).
    "routers/portfolio.py",
    # compute_twr definition (+ two internal log strings).
    "services/portfolio_metrics.py",
    # EXEMPT: same-named METHOD on EquityCurveBuilder (Phase 115 / STITCH-02 scope).
    "services/equity_reconstruction.py",
    # Legacy-symbol tests (migrated/deleted in plan 114-03).
    "tests/test_portfolio_metrics.py",
    "tests/test_nav_twr.py",
    "tests/test_portfolio_router_audit_2026_05_07.py",
    "tests/test_coverage_extras.py",
    # EXEMPT: builder.compute_twr() METHOD calls only (no changes this phase).
    "tests/test_equity_curve_builder.py",
})


def test_caller_census_matches_pinned_inventory():
    """Executable pre-delete sweep: the set of analytics-service *.py files that
    reference either deletion target MUST equal the pinned inventory exactly."""
    self_path = Path(__file__).resolve()
    scanned = 0
    found: set[str] = set()
    for py in _ANALYTICS_ROOT.rglob("*.py"):
        parts = py.parts
        if ".venv" in parts or "__pycache__" in parts:
            continue
        if py.resolve() == self_path:  # self-exclude: this oracle imports the symbols
            continue
        scanned += 1
        text = py.read_text(encoding="utf-8", errors="ignore")
        if _TWR_TOKEN in text or _SHARPE_TOKEN in text:
            found.add(py.relative_to(_ANALYTICS_ROOT).as_posix())

    # Neutered-walk guard (mirrors 111-04 self-invalidation-proof): a broken walk
    # that scans nothing must not pass silently.
    assert scanned >= 100, f"census walk only scanned {scanned} .py files (expected >=100)"

    extra = found - _PINNED_INVENTORY
    missing = _PINNED_INVENTORY - found
    assert not extra, (
        f"NEW caller(s) of a deletion target appeared — STOP the phase and re-scope: {sorted(extra)}"
    )
    assert not missing, (
        f"pinned inventory file(s) no longer reference a deletion target "
        f"(update the pin if intentional): {sorted(missing)}"
    )


def test_railway_oneoff_scripts_are_clean_of_deletion_targets():
    """Zombie-trap clause: analytics-service/scripts/ has ZERO references to either
    deletion target (the real backfill one-off is phase35_backfill_enqueue.py; the
    CONTEXT's 'phase12_backfill_enqueue.py' filename is stale and does not exist)."""
    scripts_dir = _ANALYTICS_ROOT / "scripts"
    assert scripts_dir.is_dir()
    offenders = []
    for py in sorted(scripts_dir.glob("*.py")):
        text = py.read_text(encoding="utf-8", errors="ignore")
        if _TWR_TOKEN in text or _SHARPE_TOKEN in text:
            offenders.append(py.name)
    assert not offenders, f"deletion targets referenced in one-off scripts/: {offenders}"


# ── TestLegacyParityBaseline (TEMPORARY — deleted by plan 114-03) ─────────────
class TestLegacyParityBaseline:
    """Proves the LEGACY symbols equal the independent inline oracle.

    THIS ENTIRE CLASS (and the two legacy imports at module top) is deleted by
    plan 114-03 together with the symbols it exercises. It captures the exact
    observable semantics — including the nan_vol graceful-degradation baseline —
    that the plan-02 replacement helper must reproduce.
    """

    def test_sharpe_and_vol_matches_inline_oracle(self):
        r = _fixture_a()
        exp_vol = r.std() * math.sqrt(PPY)
        exp_mean = r.mean() * PPY
        exp_sharpe = exp_mean / exp_vol

        vol, mean_ret, sharpe, status = _compute_sharpe_and_vol(r)
        assert status == "ok"
        _assert_rel(vol, exp_vol, msg="legacy vol vs oracle")
        _assert_rel(mean_ret, exp_mean, msg="legacy mean_ret vs oracle")
        _assert_rel(sharpe, exp_sharpe, msg="legacy sharpe vs oracle")

    def test_sharpe_and_vol_zero_volatility_status(self):
        # (b) flat all-zeros → vol 0.0, sharpe None, status "zero_volatility".
        assert _compute_sharpe_and_vol(_fixture_b()) == (0.0, 0.0, None, "zero_volatility")

    def test_sharpe_and_vol_insufficient_history_status(self):
        # (c) 1 sample → all None, status "insufficient_history".
        assert _compute_sharpe_and_vol(_fixture_c()) == (None, None, None, "insufficient_history")

    def test_sharpe_and_vol_all_nan_returns_nan_vol_without_raising(self):
        # (f) DEGENERATE all-NaN, len>=2: legacy vol = std(all-NaN)·√252 = NaN →
        # _safe_float(NaN) → None → the nan_vol branch (portfolio.py L616,620).
        # This pins the graceful baseline the plan-02 helper must reproduce WITHOUT
        # feeding the full pipeline. It must NOT raise. (nan_mean/nan_sharpe are
        # unreachable under pandas skipna once vol is finite+nonzero — dead branches
        # documented in plan 114-02, not synthesized here.)
        result = _compute_sharpe_and_vol(_fixture_f())
        assert result == (None, None, None, "nan_vol")

    def test_compute_twr_endpoint_ratio_on_cumprod_a(self):
        # compute_twr(equity, []) collapses to eq[-1]/eq[0]-1. On (1+r).cumprod()
        # this equals Π(1+r) over days 1..n MINUS day 0 (eq[0] == 1+r_0).
        r = _fixture_a()
        eq = (1 + r).cumprod()
        exp = eq.iloc[-1] / eq.iloc[0] - 1
        _assert_rel(compute_twr(eq, []), exp, msg="legacy TWR vs endpoint oracle (a)")

    def test_compute_twr_endpoint_ratio_on_cumprod_d(self):
        r = _fixture_d()
        eq = (1 + r).cumprod()
        exp = eq.iloc[-1] / eq.iloc[0] - 1
        _assert_rel(compute_twr(eq, []), exp, msg="legacy TWR vs endpoint oracle (d)")

    def test_compute_twr_on_non_unit_baseline_equity(self):
        # (e) equity starting at 1000.0 → last/first − 1.
        eq = _fixture_e()
        exp = eq.iloc[-1] / eq.iloc[0] - 1
        _assert_rel(compute_twr(eq, []), exp, msg="legacy TWR on non-unit equity (e)")

    def test_compute_twr_none_guards(self):
        # len<2 → None; first value 0.0 → None (no formable ratio).
        one_pt = pd.Series([1.0], index=pd.date_range("2024-01-01", periods=1, freq="D"))
        assert compute_twr(one_pt, []) is None
        zero_first = pd.Series([0.0, 1.0, 2.0], index=pd.date_range("2024-01-01", periods=3, freq="D"))
        assert compute_twr(zero_first, []) is None


# ── TestBackboneDerivationParity (PERMANENT) ─────────────────────────────────
class TestBackboneDerivationParity:
    """Proves the BACKBONE (compute_all_metrics) equals the SAME inline oracle,
    and asserts the day-0-exclusion divergence that pins the plan-02 derivation."""

    def test_backbone_volatility_and_sharpe_match_oracle(self):
        r = _fixture_a()
        exp_vol = r.std() * math.sqrt(PPY)
        exp_sharpe = (r.mean() * PPY) / exp_vol

        m = compute_all_metrics(r, periods_per_year=PPY)
        _assert_rel(m["volatility"], exp_vol, msg="backbone volatility vs oracle")
        _assert_rel(m["sharpe"], exp_sharpe, msg="backbone sharpe vs oracle")

    def test_backbone_flat_series_zero_vol_none_sharpe(self):
        # (b) matches the legacy zero_volatility contract's observable outputs.
        m = compute_all_metrics(_fixture_b(), periods_per_year=PPY)
        assert m["volatility"] == 0.0
        assert m["sharpe"] is None

    def test_endpoint_ratio_twr_derivation_pins_plan_02(self):
        # Pins the derivation plan 114-02 will implement as total_return_from_equity:
        # the inline endpoint ratio on the cumprod equals the legacy TWR oracle.
        for r in (_fixture_a(), _fixture_d()):
            eq = (1 + r).cumprod()
            endpoint_ratio = eq.iloc[-1] / eq.iloc[0] - 1
            _assert_rel(compute_twr(eq, []), endpoint_ratio, msg="endpoint-ratio derivation pin")

    def test_day0_exclusion_divergence(self):
        # ANTI-TAUTOLOGY DATUM: backbone cumulative_return (Π(1+r)−1 over ALL days,
        # INCLUDING day 0) is NOT the legacy TWR (equity endpoint ratio, which
        # EXCLUDES day 0). They differ by exactly the (1+r_0) factor. This proves
        # the parity claim is non-tautological (the gate CAN fail) AND pins WHY
        # plan 114-02 must derive TWR from equity endpoints, not read
        # cumulative_return.
        r = _fixture_a()
        r0 = r.iloc[0]
        assert r0 != 0.0
        eq = (1 + r).cumprod()
        legacy_twr = eq.iloc[-1] / eq.iloc[0] - 1  # == compute_twr(eq, [])

        m = compute_all_metrics(r, periods_per_year=PPY)
        cum_ret = m["cumulative_return"]

        # The two genuinely differ (well above any tolerance).
        assert not math.isclose(cum_ret, legacy_twr, rel_tol=1e-9, abs_tol=1e-9), (
            "day-0-exclusion divergence collapsed — the parity claim would be tautological"
        )
        assert abs(cum_ret - legacy_twr) > 1e-4

        # And the divergence is EXACTLY the (1+r_0) factor: re-including day 0 in the
        # endpoint-ratio reproduces cumulative_return.
        _assert_rel((1 + legacy_twr) * (1 + r0) - 1, cum_ret, msg="(1+r_0) reconciliation")

    # ── plan-114-02 helper wiring pins (PERMANENT) ────────────────────────────
    # These prove the new backbone-module replacement helpers equal the SAME
    # inline oracle the legacy symbols were pinned to — so ``new ≡ oracle ≡
    # legacy`` transitively, with no reference to the deletion targets.

    def test_total_return_from_equity_matches_endpoint_oracle(self):
        # On the cumprod of (a)/(d) and on the non-unit equity fixture (e), the
        # helper equals the legacy endpoint-ratio oracle at rel 1e-12.
        for r in (_fixture_a(), _fixture_d()):
            eq = (1 + r).cumprod()
            exp = eq.iloc[-1] / eq.iloc[0] - 1
            _assert_rel(total_return_from_equity(eq), exp, msg="helper TWR vs endpoint oracle")
        eq_e = _fixture_e()
        exp_e = eq_e.iloc[-1] / eq_e.iloc[0] - 1
        _assert_rel(total_return_from_equity(eq_e), exp_e, msg="helper TWR on non-unit equity")

    def test_total_return_from_equity_none_guards(self):
        # 1-point series -> None; a zero first value -> None (no formable ratio).
        one_pt = pd.Series([1.0], index=pd.date_range("2024-01-01", periods=1, freq="D"))
        assert total_return_from_equity(one_pt) is None
        assert total_return_from_equity(None) is None
        zero_first = pd.Series([0.0, 1.0, 2.0], index=pd.date_range("2024-01-01", periods=3, freq="D"))
        assert total_return_from_equity(zero_first) is None

    def test_sharpe_vol_status_ok_matches_oracle(self):
        # (a) -> (vol, sharpe, "ok") matching the inline oracle at rel 1e-12.
        r = _fixture_a()
        exp_vol = r.std() * math.sqrt(PPY)
        exp_sharpe = (r.mean() * PPY) / exp_vol
        vol, sharpe, status = sharpe_vol_status_from_backbone(r, periods_per_year=PPY)
        assert status == "ok"
        _assert_rel(vol, exp_vol, msg="helper vol vs oracle")
        _assert_rel(sharpe, exp_sharpe, msg="helper sharpe vs oracle")

    def test_sharpe_vol_status_zero_volatility(self):
        # (b) flat all-zeros -> (0.0, None, "zero_volatility").
        assert sharpe_vol_status_from_backbone(_fixture_b(), periods_per_year=PPY) == (
            0.0, None, "zero_volatility",
        )

    def test_sharpe_vol_status_insufficient_history(self):
        # (c) 1-sample -> (None, None, "insufficient_history").
        assert sharpe_vol_status_from_backbone(_fixture_c(), periods_per_year=PPY) == (
            None, None, "insufficient_history",
        )

    def test_sharpe_vol_status_degenerate_all_nan_no_raise(self):
        # BLOCKER-fix b: (f) DEGENERATE all-NaN len>=2 -> EXACTLY
        # (None, None, "nan_vol") and DOES NOT RAISE (the anti-500 proof matching
        # the legacy graceful baseline pinned in 114-01). A pipeline raise here
        # would surface as a pytest ERROR, failing this test loudly.
        assert sharpe_vol_status_from_backbone(_fixture_f(), periods_per_year=PPY) == (
            None, None, "nan_vol",
        )

    def test_degenerate_paths_never_call_the_backbone(self, monkeypatch):
        # BLOCKER-fix (structural, not incidental): patch compute_all_metrics to
        # RAISE, then prove the degenerate paths (c) 1-sample and (f) all-NaN
        # STILL return the graceful tuples — i.e. they provably never reach the
        # pipeline. monkeypatch auto-restores after the test.
        def _boom(*_a, **_k):  # pragma: no cover - must never be invoked here
            raise AssertionError("compute_all_metrics must NOT be called on degenerate input")

        monkeypatch.setattr(metrics_mod, "compute_all_metrics", _boom)
        assert sharpe_vol_status_from_backbone(_fixture_c(), periods_per_year=PPY) == (
            None, None, "insufficient_history",
        )
        assert sharpe_vol_status_from_backbone(_fixture_f(), periods_per_year=PPY) == (
            None, None, "nan_vol",
        )
