"""ACC-01 golden pin for the FROZEN anchor-to-today oracle.

Mutation-honest self-test: the live (transcribed) oracle in
`scripts/golden_parity.py` MUST reproduce an INDEPENDENT pre-73 golden series
within rtol 1e-9. If the transcription drifts (e.g. the `estimated_start <= 0 ->
account_balance` fallback is dropped), this test goes RED.

Witness provenance / regeneration
---------------------------------
`tests/fixtures/golden_parity/oracle_pre73_expected.json` was captured ONCE from
the REAL pre-73 module — NOT from the transcription under test — via:

    git worktree add --detach <tmp> 9a1e7b8e
    PYTHONPATH=<tmp>/analytics-service <ci-3.12-venv>/bin/python \
        scratchpad/capture_witness.py   # imports the REAL
                                        # services.transforms.trades_to_daily_returns_with_status
    git worktree remove --force <tmp>

That keeps the witness an independent oracle: the RUNTIME oracle
(`scripts/golden_parity.py`) stays a pure transcription with zero service-graph
imports; only the WITNESS that pins it is sourced from real old code, once,
offline. Run this test in the CI-3.12 venv (local Python 3.14 SIGSEGVs on pandas).

Security (T-78-01): assertions compare Series; no raw USD magnitudes are printed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.golden_parity import gate_account, main, old_anchor_to_today_returns
from services.metrics import compute_all_metrics
from services.parity_diff import (
    FLOW_MOVED,
    REANNUALIZATION,
    REANNUALIZATION_FACTOR,
    UNCHANGED,
    UNEXPLAINED,
    classify_delta,
)
from tests.fixtures.golden_parity.panel_fixtures import (
    flowless_controls,
    ltp068_mover,
    unexplained_injection,
)

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "golden_parity"
_INPUT_PATH = _FIXTURE_DIR / "oracle_input.json"
_EXPECTED_PATH = _FIXTURE_DIR / "oracle_pre73_expected.json"


def _daily_pnl_from_trades(trades: list[dict]) -> pd.Series:
    """Deterministic parse/group prelude (buy->+price, sell->-price, sum per day).

    This is the non-buggy prelude that is UPSTREAM of the frozen formula (it
    mirrors the real pre-73 groupby before `old_anchor_to_today_returns` takes
    over); it is not the code under pin.
    """
    df = pd.DataFrame(trades)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601", utc=True)
    df["date"] = df["timestamp"].dt.date
    df["dp"] = df.apply(
        lambda r: float(r["price"]) if r["side"] == "buy" else -float(r["price"]),
        axis=1,
    )
    return df.groupby("date")["dp"].sum()


def _expected_series(points: list[dict]) -> pd.Series:
    # The real pre-73 code (and the oracle) wrap `pd.DatetimeIndex(groupby-by-"date"
    # index)`, so the index carries name "date"; match it for byte-identity.
    idx = pd.DatetimeIndex(pd.to_datetime([p["date"] for p in points]), name="date")
    return pd.Series([p["value"] for p in points], index=idx, name="returns")


def test_oracle_matches_pre73_golden() -> None:
    """The frozen oracle reproduces the independent pre-73 witness (rtol 1e-9).

    Covers BOTH regimes: an `estimated_start > 0` control account and an
    `estimated_start <= 0` (LTP068 profits-withdrawn) account. Dropping the
    `<= 0 -> account_balance` fallback from the oracle turns this RED.
    """
    payload = json.loads(_INPUT_PATH.read_text())
    expected = json.loads(_EXPECTED_PATH.read_text())["cases"]

    assert set(c["label"] for c in payload["cases"]) == set(expected.keys())

    for case in payload["cases"]:
        label = case["label"]
        daily_pnl = _daily_pnl_from_trades(case["trades"])
        got = old_anchor_to_today_returns(daily_pnl, case["account_balance"])
        want = _expected_series(expected[label])
        pd.testing.assert_series_equal(
            got, want, rtol=1e-9, check_names=True,
            obj=f"oracle vs pre-73 witness [{label}]",
        )


# ===========================================================================
# ACC-01 PANEL GATE — the mutation-honest CI self-test (Plan 78-02, Task 3)
# ===========================================================================
# This IS the gate that authorizes the production flip. It proves, per venue,
# that the shared-path refactor preserved byte-identity (flow-less controls stay
# UNCHANGED), that the honest move happens (an LTP068-shaped fixture moves as
# FLOW_MOVED), and that EVERY delta is accounted for (any UNEXPLAINED fails
# closed). It is mutation-honest: neutering classify_delta, dropping the driver's
# fail-closed assert, OR flipping a moved fixture's has_flows each turns a case RED
# (proven by scratch mutation in the plan, then reverted). Run in the CI-3.12 venv
# (local 3.14 SIGSEGVs on pandas); auto-collected by the existing pytest job — no
# ci.yml wiring (the live deribit_acceptance re-run is Wave 3).


@pytest.mark.parametrize("control", flowless_controls(), ids=lambda c: c.venue)
def test_flowless_controls_unchanged(control) -> None:
    """Each per-venue flow-less control classifies UNCHANGED on the SERIES.

    The ``estimated_start > 0`` regime is the byte-identity precondition: the NEW
    honest core (``external_flows=None``) is algebraically identical to the OLD
    oracle, so the delta must be UNCHANGED with the caller-known ``has_flows=False``.
    A control that MOVED would fail closed as UNEXPLAINED (proven separately).
    """
    ok = gate_account(
        control.daily_pnl,
        control.account_balance,
        external_flows=control.external_flows,
        open_unrealized_usd=control.open_unrealized_usd,
        has_flows=control.has_flows,
        expected_bucket=control.expected_bucket,
    )
    assert control.expected_bucket == UNCHANGED
    assert ok, f"{control.venue} flow-less control did not classify UNCHANGED"


def test_flowless_control_cagr_is_reannualization() -> None:
    """LOW-3: a byte-identical SERIES whose CAGR shifted by 365/252 buckets
    REANNUALIZATION (metric-only), NEVER UNEXPLAINED — the no-move invariant is
    keyed on the SERIES, not CAGR.

    Reachability (LOW-3 note): driving both metrics through HEAD
    ``compute_all_metrics`` (the 365-clock) yields IDENTICAL scalars on a
    byte-identical series → UNCHANGED, so REANNUALIZATION is unreachable through
    the Task-2 driver. This test therefore calls ``classify_delta`` DIRECTLY with
    an ASYMMETRIC pair: the real 365-basis ``new_metrics`` vs a synthetic 252-basis
    ``old_metrics`` constructed so ``new_cagr == reannualize(old_cagr, 365/252)``
    (and Calmar shifts consistently, sharing the unchanged |max_dd|). That exercises
    the genuine 365/252 shift.
    """
    control = flowless_controls()[0]
    series = old_anchor_to_today_returns(control.daily_pnl, control.account_balance)

    # Real 365-basis (HEAD) metrics — the NEW side.
    head = compute_all_metrics(series).metrics_json
    new_cagr = head["cagr"]
    new_calmar = head["calmar"]
    assert new_cagr is not None and new_cagr != 0.0
    assert new_calmar is not None and new_calmar != 0.0

    # Synthetic 252-basis OLD side: invert the calendar-clock factor so
    # reannualize(old_cagr) == new_cagr, and share the (unchanged) |max_dd| so
    # old_calmar == old_cagr * new_calmar / new_cagr.
    old_cagr = (1.0 + new_cagr) ** (1.0 / REANNUALIZATION_FACTOR) - 1.0
    old_calmar = old_cagr * new_calmar / new_cagr
    old_metrics = {"cagr": old_cagr, "calmar": old_calmar}
    new_metrics = {"cagr": new_cagr, "calmar": new_calmar}

    # SERIES identical + metrics moved by exactly the known factor -> REANNUALIZATION.
    bucket = classify_delta(
        series, series, old_metrics=old_metrics, new_metrics=new_metrics,
        has_flows=False,
    )
    assert bucket == REANNUALIZATION
    assert bucket != UNEXPLAINED

    # Control: the SAME series with NO metric delta stays UNCHANGED — proving the
    # bucket split is driven by the scalars, while the series is provably identical.
    assert classify_delta(series, series, has_flows=False) == UNCHANGED


def test_ltp068_shape_flow_moved() -> None:
    """The LTP068-shaped flow-heavy fixture classifies FLOW_MOVED.

    OLD is flow-blind (the ``estimated_start <= 0 -> account_balance`` inflation);
    NEW reconstructs the honest NAV from the real dated withdrawal, so the SERIES
    moves. With the caller-known ``has_flows=True`` the move is FLOW_MOVED.
    """
    mover = ltp068_mover()
    ok = gate_account(
        mover.daily_pnl,
        mover.account_balance,
        external_flows=mover.external_flows,
        open_unrealized_usd=mover.open_unrealized_usd,
        has_flows=mover.has_flows,
        expected_bucket=mover.expected_bucket,
    )
    assert mover.expected_bucket == FLOW_MOVED
    assert ok, "LTP068-shaped mover did not classify FLOW_MOVED"


def test_any_unexplained_fails_gate() -> None:
    """An injected unexplained move (a moved series declared ``has_flows=False``)
    makes the gate fail CLOSED: ``gate_account`` RAISES and ``main`` exits nonzero.

    Asserting the RAISE is load-bearing for mutation honesty: it goes RED if the
    driver's ``assert bucket != UNEXPLAINED`` is dropped, OR if the injection's
    ``has_flows`` is flipped to True (which would reclassify the move as
    FLOW_MOVED and defeat the fail-closed net — T-78-04).
    """
    injection = unexplained_injection()

    with pytest.raises(AssertionError):
        gate_account(
            injection.daily_pnl,
            injection.account_balance,
            external_flows=injection.external_flows,
            open_unrealized_usd=injection.open_unrealized_usd,
            has_flows=injection.has_flows,
            expected_bucket=injection.expected_bucket,
        )

    # main() must surface the breach as a nonzero exit code (classifier-neuter net).
    assert main([injection]) != 0
