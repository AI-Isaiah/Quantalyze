"""Regression tests for the FIFO snap-to-zero fix (Audit-2026-05-07 P1100 / PATTERN-2).

Replays the production fingerprint from
`.planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md`: a long
position that closes with a sub-ULP positive residual in `net_qty`,
followed by a small sell that the buggy code interprets as a
close-and-flip event. Without the snap, the algorithm emits a phantom
zero-duration "long" whose `entry_price_avg` equals a SELL-fill price
(impossible under correct FIFO semantics) and whose `opened_at` equals
`closed_at`.

Each test below is structured so that *removing* the snap-to-zero
guards in `_match_positions_fifo` (search the function for
``flip_eps = max(total_entry_qty * FLIP_EPS_FACTOR, 1e-9)``) makes the
phantom reappear and the assertions fail. Tests purposefully avoid
mocking `_match_positions_fifo` itself — they call it directly with a
synthetic fill stream that triggers the float-residual code path the
exact same way the production OKX micro-fill streams did.
"""
from __future__ import annotations

import pytest

from services.position_reconstruction import _match_positions_fifo


def _mk(
    side: str,
    qty: float,
    price: float,
    ts: str,
    fee: float = 0.0,
) -> dict:
    """Build a trades-row-shaped fill dict (one-way / `posSide=net` mode)."""
    return {
        "symbol": "ETH-USDT",
        "side": side,
        "quantity": qty,
        "price": price,
        "fee": fee,
        "timestamp": ts,
        "raw_data": {"posSide": "net"},
        "is_fill": True,
    }


# ---------------------------------------------------------------------------
# Production replay
# ---------------------------------------------------------------------------
# Shape of the production fill stream (INVEST doc §"Data trace" Step 3):
#   1) Feb 23: a large long is opened by many micro buys totalling 101.95 ETH.
#   2) Feb 26 17:36:00.344: 2 sell fills closing the long (94.27 + 7.68).
#      Float-sum residual leaves `net_qty` at + or - sub-ULP after the close.
#   3) Feb 26 17:36:00.529–.531: 60+ sell fills opening a real short of
#      ~32+ ETH at prices clustered around 1991.5x.
#
# The float residual + the very-first .529 sell triggers the close-and-flip
# branch in `_match_positions_fifo`, dragging the original long into a
# spurious "flip → tiny long → next-sell close" oscillation. The visible
# artifact is one or more positions whose opened_at == closed_at, side="long",
# and entry_price_avg matches a SELL-fill price (production rows had
# entry=1991.69/1991.70/1991.72).
#
# The tests below replay a minimal version of this stream that lands
# net_qty at exactly +1e-9 (well above the existing 1e-12 floor but well
# below any real exposure). The snap-to-zero fix collapses that residue
# to 0.0 and prevents the phantom flip.
# ---------------------------------------------------------------------------


def _build_phantom_producing_fills() -> list[dict]:
    """Construct a fill stream that produces a phantom long without the fix.

    Net-qty trajectory across the stream (with the snap DISABLED):
      step 0 (open short 100):      net_qty = -100.0
      step 1 (buy 50.0):            net_qty = -50.0
      step 2 (buy 50.000000001):    net_qty = +1e-9   ← residual; close-branch
                                                       fires, flips to LONG
                                                       with size 1e-9 and
                                                       entry = 1991.5
      step 3 (sell 0.01):           net_qty = -0.01 + 1e-9  → close-branch
                                                       fires AGAIN, emitting
                                                       a PHANTOM "long" with
                                                       size~0, entry=1991.5,
                                                       exit=1991.69 and
                                                       opened_at == closed_at,
                                                       then flips to a new
                                                       short with entry=1991.69.

    With the snap ENABLED, step 2's residual collapses to 0.0, the
    close-branch produces a clean zero-remainder flat reset, and step 3
    simply opens a fresh short. No phantom emitted.
    """
    return [
        # Step 0: open the short at 17:36:00.500.
        _mk("sell", 100.0, 2000.0, "2026-02-26T17:36:00.500+00:00", fee=1.0),
        # Steps 1-2: two buys closing the short. The float value
        # `50.000000001` is chosen so the cumulative `net_qty` lands at
        # *exactly* +1e-9 after step 2 — large enough to escape the
        # existing `abs(net_qty) < 1e-12` zero-check inside the opening
        # branch, small enough to be IEEE-754 dust per any sensible
        # base-asset epsilon.
        _mk("buy", 50.0, 1991.5, "2026-02-26T17:36:00.529+00:00", fee=0.5),
        _mk("buy", 50.000000001, 1991.5, "2026-02-26T17:36:00.529+00:00", fee=0.5),
        # Step 3: the trigger fill — a tiny sell at the SAME millisecond
        # as step 2. Without snap, this becomes the second close-and-flip
        # in the chain and the phantom long is emitted with
        # opened_at == closed_at == "2026-02-26T17:36:00.529+00:00".
        _mk("sell", 0.01, 1991.69, "2026-02-26T17:36:00.529+00:00", fee=0.001),
    ]


def test_no_phantom_zero_duration_long_on_residual_flip() -> None:
    """Snap-to-zero must suppress the phantom `opened_at == closed_at` long.

    Production fingerprint (INVEST §"Step 4"): rows with
    `opened_at == closed_at`, side="long", entry_avg ≈ exit_avg, and
    entry_price equal to a SELL-fill price. None of those rows may exist
    in the output.
    """
    fills = _build_phantom_producing_fills()

    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    zero_duration_longs = [
        p
        for p in positions
        if p["side"] == "long"
        and p.get("opened_at") is not None
        and p.get("closed_at") is not None
        and p["opened_at"] == p["closed_at"]
    ]
    assert zero_duration_longs == [], (
        "Found phantom zero-duration long position(s) — the FIFO "
        "close-and-flip branch fired on a sub-ULP residual. The "
        "snap-to-zero guard in _match_positions_fifo is missing or "
        "broken. Phantom rows: " + repr(zero_duration_longs)
    )


def test_no_zero_size_position_emitted() -> None:
    """No position should have `size_base` rounding to 0.

    A zero-size closed position is a clear phantom: the FIFO algorithm
    only emits a row when it computes `total_entry_qty > 0`, but the
    close-and-flip branch can reset `total_entry_qty` to the
    `remainder` of a float residual (sub-ULP) which then rounds to 0
    at the 8-decimal projection (line 568 in
    `services/position_reconstruction.py`). This row is the
    "phantom" callout in
    `.planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md`.
    """
    fills = _build_phantom_producing_fills()
    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    zero_size_rows = [
        p
        for p in positions
        if p.get("size_base") is not None and p["size_base"] == 0.0
    ]
    assert zero_size_rows == [], (
        "Found zero-size phantom position(s). Offending rows: "
        + repr(zero_size_rows)
    )


def test_real_short_opens_at_trigger_timestamp_with_expected_size() -> None:
    """After the residual close, a single fresh short of 0.01 ETH should open at .529.

    The phantom-producing path emits THREE positions (real short, phantom
    long, new short of 0.01). With the snap, only TWO positions are
    emitted: the real short closing cleanly at .529 and the new short of
    0.01 opening at .529.
    """
    fills = _build_phantom_producing_fills()
    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    # Filter to open positions (the new short).
    open_shorts = [
        p
        for p in positions
        if p["side"] == "short"
        and p.get("status") == "open"
        and p.get("opened_at") == "2026-02-26T17:36:00.529+00:00"
    ]
    assert len(open_shorts) == 1, (
        f"Expected exactly one open short at .529, got {len(open_shorts)}: "
        f"{open_shorts!r}"
    )
    assert open_shorts[0]["size_base"] == pytest.approx(0.01, abs=1e-9)

    # And the closed short that preceded it must have its full 100 ETH size.
    closed_shorts = [
        p
        for p in positions
        if p["side"] == "short" and p.get("status") == "closed"
    ]
    assert len(closed_shorts) == 1
    assert closed_shorts[0]["size_base"] == pytest.approx(100.0, abs=1e-6)


def test_total_position_count_is_two_not_three() -> None:
    """Without the fix, three positions are emitted (real short + phantom + new short).

    With the fix only two should be emitted (real short + new short).
    """
    fills = _build_phantom_producing_fills()
    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    assert len(positions) == 2, (
        f"Expected exactly two positions after snap-to-zero, got "
        f"{len(positions)}. Surplus likely indicates a phantom row: "
        f"{positions!r}"
    )


# ---------------------------------------------------------------------------
# Regression coverage: the snap must not corrupt clean (non-residual) flows.
# ---------------------------------------------------------------------------


def test_legitimate_overshoot_flip_still_works() -> None:
    """A genuine overshoot (long → short) above the snap epsilon must still flip.

    The snap-to-zero rule MUST NOT swallow a real flip. This test opens
    a long of 10.0 then sells 25.0 — overshoot is 15.0, far above any
    plausible flip epsilon (max(10.0 * 1e-9, 1e-9) = 1e-8). A new short
    of 15.0 must be created.
    """
    fills = [
        _mk("buy", 10.0, 1900.0, "2026-02-23T11:12:00.000+00:00", fee=0.1),
        _mk("sell", 25.0, 1991.5, "2026-02-26T17:36:00.500+00:00", fee=0.5),
    ]
    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    # One closed long of size 10 and one open short of size 15.
    assert len(positions) == 2
    closed_long = next(p for p in positions if p["side"] == "long")
    open_short = next(p for p in positions if p["side"] == "short")
    assert closed_long["status"] == "closed"
    assert closed_long["size_base"] == pytest.approx(10.0, abs=1e-9)
    assert open_short["status"] == "open"
    assert open_short["size_base"] == pytest.approx(15.0, abs=1e-9)


def test_clean_close_no_residual_still_closes() -> None:
    """If buys and sells exactly cancel (no IEEE residual), close branch still fires.

    Sanity check: the snap must be a no-op when net_qty is genuinely 0.
    """
    fills = [
        _mk("buy", 1.0, 1900.0, "2026-02-23T11:12:00.000+00:00", fee=0.01),
        _mk("sell", 1.0, 1991.5, "2026-02-26T17:36:00.000+00:00", fee=0.01),
    ]
    positions = _match_positions_fifo("ETH-USDT", fills, "test-strategy")

    assert len(positions) == 1
    assert positions[0]["side"] == "long"
    assert positions[0]["status"] == "closed"
    assert positions[0]["size_base"] == pytest.approx(1.0, abs=1e-9)
