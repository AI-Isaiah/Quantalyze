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

from scripts.golden_parity import old_anchor_to_today_returns

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
