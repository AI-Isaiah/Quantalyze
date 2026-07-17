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

    The parity chain was proven WITHOUT tautology BEFORE the deletion:

        legacy   ≡ inline-oracle   (TestLegacyParityBaseline — GREEN on the
                                     pre-delete tree, then DELETED with the
                                     symbols in plan 114-03)
        backbone ≡ inline-oracle   (TestBackboneDerivationParity — PERMANENT)
        ∴ legacy ≡ backbone         (transitive; neither leg read the other)

    Post-delete (114-03) the legacy leg is gone with the symbols; the PERMANENT
    backbone leg (and the new-helper wiring pins below it) stand as the ongoing
    guarantee that the survivors reproduce the inline oracle.

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

stdlib + pandas + numpy + pytest ONLY. The legacy imports and
TestLegacyParityBaseline were removed together with the symbols in plan 114-03;
only the backbone/survivor imports remain. This file legitimately carries the
deletion-target tokens (in the caller-census constants below, built by
concatenation) and is therefore self-excluded from its own census walk and named
in the permanent delete-gate's skip-list (tests/test_e1_delete_gate.py).
"""
from __future__ import annotations

import logging
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

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


# ── Whole-tree caller census (BACKBONE-01 clause 4, post-delete sweep) ────────
# Tokens built by concatenation so THIS file's census constants never contain the
# literal deletion-target symbols (belt-and-suspenders with the self-exclusion of
# the walk below — this file's docstring/comments still name the symbols, hence
# both guards). The permanent hasattr + tree-walk delete-gate lives in
# tests/test_e1_delete_gate.py; this census is the human-readable inventory pin.
_TWR_TOKEN = "compute" + "_twr"
_SHARPE_TOKEN = "_compute_sharpe" + "_and_vol"

_ANALYTICS_ROOT = Path(__file__).resolve().parent.parent  # tests/ -> analytics-service/

# The pinned inventory (relative posix paths from analytics-service/). Any NEW
# file referencing a deletion target — or any listed file that unexpectedly stops
# referencing one — fails this test loudly. POST-DELETE (plan 114-03): both
# deletion targets are gone from production and from every migrated test; the
# ONLY files that still carry the literal tokens are the two Phase-115 METHOD
# exemptions. (The permanent delete-gate tests/test_e1_delete_gate.py and this
# parity file carry the tokens ONLY as concatenated census constants, so they do
# not appear here — the walk matches the contiguous literal, which concatenation
# never forms.)
_PINNED_INVENTORY = frozenset({
    # EXEMPT: same-named METHOD on EquityCurveBuilder (Phase 115 / STITCH-02
    # scope) — a different symbol that does not import portfolio_metrics.
    "services/equity_reconstruction.py",
    # EXEMPT: builder.compute_twr() METHOD calls only (Phase 115 scope).
    "tests/test_equity_curve_builder.py",
})


def test_caller_census_matches_pinned_inventory():
    """Executable post-delete sweep: the set of analytics-service *.py files that
    reference either deletion target MUST equal the pinned inventory exactly (the
    two Phase-115 METHOD exemptions)."""
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


# ── TestLegacyParityBaseline — DELETED in plan 114-03 ────────────────────────
# The legacy leg (``_compute_sharpe_and_vol`` + the forward TWR scalar) was
# proven ≡ the inline oracle on the pre-delete tree and removed together with
# the symbols in this plan. The exact observable semantics it captured —
# including the nan_vol graceful-degradation baseline and the M-0698
# begin-value-0 warning — now live on the PERMANENT backbone/helper pins below
# (see TestBackboneDerivationParity: the degenerate-all-NaN status pin, the
# structural no-raise monkeypatch proof, and test_total_return_from_equity_
# zero_first_warns_m0698). The KEEP-path import/function proof for the survivor
# cashflow/IRR helpers lives in tests/test_e1_delete_gate.py.


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
        # Pins the shipped derivation (total_return_from_equity): the inline
        # endpoint ratio on the cumprod equals the survivor helper. Pre-delete
        # (114-01) this leg compared the inline ratio to the legacy forward TWR
        # scalar; post-delete (114-03) the legacy comparator is gone and the
        # survivor helper is the pinned reference (same inline oracle).
        for r in (_fixture_a(), _fixture_d()):
            eq = (1 + r).cumprod()
            endpoint_ratio = eq.iloc[-1] / eq.iloc[0] - 1
            _assert_rel(total_return_from_equity(eq), endpoint_ratio, msg="endpoint-ratio derivation pin")

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

    def test_total_return_from_equity_zero_first_warns_m0698(self, caplog):
        # M-0698 re-pin (PERMANENT): the deleted forward TWR scalar warned when a
        # sub-period began at zero (portfolio passed through 0 — a meaningful
        # blow-up), because no ratio is formable. The backbone helper preserves
        # that observable: a first-value-0.0 equity series returns None AND emits
        # a WARNING of the same begin_val=0 shape, so a caller can see the None is
        # a passed-through-zero, not a no-data None. This is the named successor to
        # the deleted test_twr_warns_on_zero_begin_value.
        zero_first = pd.Series(
            [0.0, 100.0, 110.0],
            index=pd.date_range("2024-01-01", periods=3, freq="D"),
        )
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
            result = total_return_from_equity(zero_first)
        assert result is None
        assert any("begin_val=0" in r.message for r in caplog.records), (
            "a zero first-value series must warn (M-0698 shape), not silently "
            "return a bare None indistinguishable from no-data"
        )

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
