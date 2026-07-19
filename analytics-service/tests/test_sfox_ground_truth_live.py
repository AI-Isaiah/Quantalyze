"""SFOX-06 LIVE parity leg — FOUNDER-GATED on Phase-121 egress.

This is the empirical SFOX-06 gate: the committed ``scripts/sfox_ground_truth``
harness run end-to-end against a REAL read-only sFOX account, asserting exit 0
(parity holds, or an A2/A3 interpretation ambiguity flagged for the founder — a
material divergence returns exit 1 and FAILS this test, as it must: the wrong
curve can never ship).

Founder gate (why this skips in CI):
  * a real read-only sFOX API key is required (``SFOX_GROUND_TRUTH_KEY``), and
  * an IP-whitelisted key additionally needs the Phase-121 Fly.io STATIC EGRESS
    (the dedicated v4 the founder whitelists at sFOX) — neither exists in CI.

Without ``SFOX_GROUND_TRUTH_KEY`` this module SKIPS with a verbose reason so CI
stays green. A skip is NOT a pass: SFOX-06's live leg stays ``human_needed``
until a founder runs this green (the 118-02 / 119-04 precedent). No code path can
synthesize a green — the harness reads a real account or it raises.

Founder runbook (flip the live leg human_needed → green):
  1. After Phase 121's egress IP is VERIFIED (== the dedicated v4, measured from
     the machine), or immediately with a NON-whitelisted read-only key:
       export SFOX_GROUND_TRUTH_KEY=<read-only sFOX token>   # env only, never a file
       # (optional, whitelisted key) export SFOX_GROUND_TRUTH_PROXY=<121 egress URL>
  2. cd analytics-service && python -m pytest tests/test_sfox_ground_truth_live.py -q
     — OR capture the evidence: python -m scripts.sfox_ground_truth > /tmp/sfox_parity.json
  3. Review the evidence ``a2_*`` residuals (account_balance cash vs total-MTM —
     which interpretation reconciles?) and ``a3_*`` inception residual (does
     prev0 = first usd_value hold?). These RESOLVE assumptions A2/A3 with data.
  4. exit 1 → MATERIAL DIVERGENCE: STOP, the curve must not ship; file the
     evidence. exit 2 → read-only premise violated: revoke the key. exit 3 → key
     not exported.

Security posture (T-120-16, mirrors deribit_ground_truth / test_sfox_client_live):
the key lives ONLY as an env var, never a tracked file; this test asserts only
the exit code, never account contents, and the harness sanitizes its own stdout.
"""
from __future__ import annotations

import os

import pytest

from scripts.sfox_ground_truth import main

# Module-level founder gate. Verbose reason (Rule 12): a silent skip is a
# fail-loud violation, and a skip must never read as a pass.
pytestmark = pytest.mark.skipif(
    not os.environ.get("SFOX_GROUND_TRUTH_KEY"),
    reason=(
        "FOUNDER-GATED SFOX-06 live parity: SFOX_GROUND_TRUTH_KEY unset. This "
        "needs a real read-only sFOX key and — for an IP-whitelisted key — the "
        "Phase-121 static egress. Export SFOX_GROUND_TRUTH_KEY (+ optional "
        "SFOX_GROUND_TRUTH_PROXY) then run `python -m pytest "
        "tests/test_sfox_ground_truth_live.py -q`. Skipping keeps CI green, but "
        "SFOX-06's live leg stays human_needed until this runs green — a skip is "
        "NOT a pass."
    ),
)


def test_live_prod_key_parity_holds_exit_zero() -> None:
    """The harness runs end-to-end against the real account and returns exit 0
    (parity holds, or an A2/A3 ambiguity flagged requires_founder_decision).

    A material divergence returns exit 1 and FAILS here — the reconstructed curve
    must never be displayed. ``main([])`` reads SFOX_GROUND_TRUTH_KEY from the env
    and sanitizes its own stdout; this assertion carries only the exit code.
    """
    exit_code = main([])
    assert exit_code == 0, (
        "sFOX live ground-truth parity did not hold (exit "
        f"{exit_code}: 1=material divergence, 2=read-only premise violated, "
        "3=key not exported). SFOX-06 live leg stays human_needed until exit 0."
    )
