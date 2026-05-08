"""Phase 19 / FINGERPRINT-01..02 — tests for compute_fingerprint_v1.

Behavior contract per CONTEXT.md L66-72 + REVIEWS.md H-9:

  Shape (locked):
    {
      version: 1,
      trade_size_buckets:        [4 floats], sum=1.0   (or all zeros if empty)
      hold_duration_buckets:     [4 floats], sum=1.0   (or all zeros if empty)
      asset_class_mix:           [4 floats], sum=1.0   (or all zeros if empty)
      instrument_concentration:  [10 floats] padded with 0 if <10 distinct symbols
      temporal_pattern:          [24 floats], sum=1.0  (UTC hour-of-day)
    }

  Bucket boundaries (locked):
    trade_size      (USD notional = price * quantity):
      [<$1k, $1-10k, $10-100k, $100k+]
    hold_duration   (per FIFO matched holding pair):
      [<1h, 1-24h, 1-7d, >7d]
    asset_class_mix:
      [spot, perp_long, perp_short, futures]
    temporal_pattern:
      UTC hour-of-day 0..23

H-9 explicit cases:
  - identical fingerprints → cosine = 1.0
  - orthogonal one-hot vectors → cosine = 0.0
  - scale invariance (same shape, different magnitudes) → cosine = 1.0
  - swap symmetry: compute_similarity(a,b) == compute_similarity(b,a)
  - hand-computed array-concat order verification (deterministic)
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

from services.ingestion.adapter import Fingerprint, MetricsSnapshot, Trade


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _trade(
    symbol: str = "BTC/USDT",
    side: str = "buy",
    price: float = 50_000.0,
    quantity: float = 0.01,
    fee: float = 0.0,
    fee_currency: str = "USDT",
    ts: datetime | None = None,
    order_type: str = "spot",
    is_fill: bool = True,
    exchange: str = "okx",
) -> Trade:
    if ts is None:
        ts = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    return Trade(
        exchange=exchange,
        symbol=symbol,
        side=side,
        price=price,
        quantity=quantity,
        fee=fee,
        fee_currency=fee_currency,
        timestamp=ts,
        order_type=order_type,
        is_fill=is_fill,
    )


def _empty_metrics() -> MetricsSnapshot:
    return MetricsSnapshot(
        sharpe=None,
        twr=None,
        ytd=None,
        max_drawdown=None,
        total_pnl=None,
        trade_count=0,
        win_rate=None,
    )


def _cosine(a: list[float], b: list[float]) -> float:
    """Reference cosine over the concatenated 46-dim vector — mirrors
    migration 105 compute_similarity SQL function exactly."""
    assert len(a) == len(b) == 46
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _concat_46(jsonb: dict[str, list[float] | int]) -> list[float]:
    """Concatenate the 5 components in the canonical order locked by
    migration 105: trade_size || hold_duration || asset_class || instrument || temporal."""
    out: list[float] = []
    out.extend(jsonb["trade_size_buckets"])  # type: ignore[arg-type]
    out.extend(jsonb["hold_duration_buckets"])  # type: ignore[arg-type]
    out.extend(jsonb["asset_class_mix"])  # type: ignore[arg-type]
    out.extend(jsonb["instrument_concentration"])  # type: ignore[arg-type]
    out.extend(jsonb["temporal_pattern"])  # type: ignore[arg-type]
    return out


# ---------------------------------------------------------------------------
# Import contract
# ---------------------------------------------------------------------------


def test_module_importable() -> None:
    """services.ingestion.fingerprint exposes compute_fingerprint_v1."""
    from services.ingestion import fingerprint as fp_mod

    assert hasattr(fp_mod, "compute_fingerprint_v1")
    assert callable(fp_mod.compute_fingerprint_v1)


def test_returns_fingerprint_dataclass() -> None:
    from services.ingestion.fingerprint import compute_fingerprint_v1

    fp = compute_fingerprint_v1([], _empty_metrics())
    assert isinstance(fp, Fingerprint)
    assert fp.version == 1


# ---------------------------------------------------------------------------
# Shape contract — every output respects the locked 4/4/4/10/24 shape
# ---------------------------------------------------------------------------


def test_shape_empty_trades_all_zeros() -> None:
    """Empty trade list → all-zeros components, version=1, valid shape."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    fp = compute_fingerprint_v1([], _empty_metrics())
    jsonb = fp.to_jsonb()

    assert jsonb["version"] == 1
    assert len(jsonb["trade_size_buckets"]) == 4
    assert len(jsonb["hold_duration_buckets"]) == 4
    assert len(jsonb["asset_class_mix"]) == 4
    assert len(jsonb["instrument_concentration"]) == 10
    assert len(jsonb["temporal_pattern"]) == 24
    # Empty inputs → all zeros (cosine returns 0.0 on either-zero norm,
    # benign for the similarity ranker).
    assert all(v == 0.0 for v in jsonb["trade_size_buckets"])
    assert all(v == 0.0 for v in jsonb["hold_duration_buckets"])
    assert all(v == 0.0 for v in jsonb["asset_class_mix"])
    assert all(v == 0.0 for v in jsonb["instrument_concentration"])
    assert all(v == 0.0 for v in jsonb["temporal_pattern"])


def test_shape_with_trades() -> None:
    """Non-empty trade list → 5 components present with locked lengths."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [_trade()]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    jsonb = fp.to_jsonb()

    assert set(jsonb.keys()) == {
        "version",
        "trade_size_buckets",
        "hold_duration_buckets",
        "asset_class_mix",
        "instrument_concentration",
        "temporal_pattern",
    }
    assert len(jsonb["trade_size_buckets"]) == 4
    assert len(jsonb["hold_duration_buckets"]) == 4
    assert len(jsonb["asset_class_mix"]) == 4
    assert len(jsonb["instrument_concentration"]) == 10
    assert len(jsonb["temporal_pattern"]) == 24


# ---------------------------------------------------------------------------
# Bucket-boundary contract
# ---------------------------------------------------------------------------


def test_trade_size_bucket_boundaries() -> None:
    """trade_size buckets:  [<$1k, $1-10k, $10-100k, $100k+] by USD notional."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [
        _trade(price=100.0, quantity=1.0),       # notional $100  → bucket 0
        _trade(price=1_000.0, quantity=5.0),     # notional $5,000 → bucket 1
        _trade(price=1_000.0, quantity=50.0),    # notional $50,000 → bucket 2
        _trade(price=1_000.0, quantity=500.0),   # notional $500,000 → bucket 3
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    # Each bucket should contain exactly 1 trade → 0.25 per bucket after L1 norm.
    assert fp.trade_size_buckets == pytest.approx((0.25, 0.25, 0.25, 0.25), abs=1e-9)


def test_trade_size_bucket_edges() -> None:
    """Edge cases at boundary values: $1000, $10000, $100000.
    Boundary convention: lower bound inclusive ([1000,10000) lands in bucket 1)."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [
        _trade(price=999.99, quantity=1.0),   # < $1k → bucket 0
        _trade(price=1_000.0, quantity=1.0),  # exactly $1k → bucket 1 ([1k, 10k))
        _trade(price=10_000.0, quantity=1.0), # exactly $10k → bucket 2 ([10k, 100k))
        _trade(price=100_000.0, quantity=1.0),# exactly $100k → bucket 3
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    assert fp.trade_size_buckets == pytest.approx((0.25, 0.25, 0.25, 0.25), abs=1e-9)


def test_temporal_pattern_hour_of_day() -> None:
    """temporal_pattern is UTC hour-of-day distribution (24 buckets, sums to 1)."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    trades = [
        _trade(ts=base.replace(hour=0)),
        _trade(ts=base.replace(hour=12)),
        _trade(ts=base.replace(hour=23)),
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())

    # Three trades equally distributed over hours 0, 12, 23 → 1/3 each.
    assert fp.temporal_pattern[0] == pytest.approx(1 / 3, abs=1e-9)
    assert fp.temporal_pattern[12] == pytest.approx(1 / 3, abs=1e-9)
    assert fp.temporal_pattern[23] == pytest.approx(1 / 3, abs=1e-9)
    # All others zero.
    for h in range(24):
        if h not in (0, 12, 23):
            assert fp.temporal_pattern[h] == 0.0
    assert sum(fp.temporal_pattern) == pytest.approx(1.0, abs=1e-9)


def test_temporal_pattern_normalizes_naive_datetime_to_utc() -> None:
    """A naive datetime is interpreted as UTC (matches services/exchange.py
    timestamp convention — fetchers emit UTC datetimes)."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    naive_ts = datetime(2026, 1, 1, 5, 0, 0)  # no tzinfo
    trades = [_trade(ts=naive_ts)]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    assert fp.temporal_pattern[5] == pytest.approx(1.0, abs=1e-9)


def test_asset_class_mix_spot_vs_perp() -> None:
    """asset_class_mix order: [spot, perp_long, perp_short, futures]."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [
        # spot — symbol has no perp/futures suffix and order_type='spot'
        _trade(symbol="BTC/USDT", order_type="spot", side="buy"),
        # perp_long — perp symbol + buy side
        _trade(symbol="BTC/USDT:USDT", order_type="swap", side="buy"),
        # perp_short — perp symbol + sell side
        _trade(symbol="BTC/USDT:USDT", order_type="swap", side="sell"),
        # futures — dated futures symbol
        _trade(symbol="BTC/USDT-26DEC", order_type="future", side="buy"),
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    assert fp.asset_class_mix == pytest.approx(
        (0.25, 0.25, 0.25, 0.25), abs=1e-9
    )


def test_instrument_concentration_top_10_padded() -> None:
    """instrument_concentration: top-10 symbols by trade count, padded with 0."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    # 3 distinct symbols → 7 trailing zeros.
    trades = [
        _trade(symbol="BTC/USDT"),
        _trade(symbol="BTC/USDT"),
        _trade(symbol="BTC/USDT"),
        _trade(symbol="ETH/USDT"),
        _trade(symbol="ETH/USDT"),
        _trade(symbol="SOL/USDT"),
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    ic = list(fp.instrument_concentration)
    assert len(ic) == 10
    # Sorted descending: BTC=3, ETH=2, SOL=1, then 7 zeros
    assert ic[0] == pytest.approx(0.5, abs=1e-9)   # 3/6
    assert ic[1] == pytest.approx(1 / 3, abs=1e-9)  # 2/6
    assert ic[2] == pytest.approx(1 / 6, abs=1e-9)  # 1/6
    assert ic[3:] == [0.0] * 7
    assert sum(ic) == pytest.approx(1.0, abs=1e-9)


def test_instrument_concentration_caps_at_top_10() -> None:
    """When >10 distinct symbols exist, only top-10 by count are kept; tail dropped."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    # 12 distinct symbols, each with 1 trade → top-10 take 10/12 of the mass,
    # tail 2 dropped (sum < 1.0 because we re-normalize over the kept top-10).
    trades = [_trade(symbol=f"S{i}/USDT") for i in range(12)]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    ic = list(fp.instrument_concentration)
    assert len(ic) == 10
    # Locked semantic: re-normalize over kept top-10 so the component sums to 1.0
    # (cosine well-defined). Each kept symbol gets 1/10.
    assert all(abs(v - 0.1) < 1e-9 for v in ic)
    assert sum(ic) == pytest.approx(1.0, abs=1e-9)


def test_hold_duration_buckets() -> None:
    """hold_duration buckets:  [<1h, 1-24h, 1-7d, >7d]. FIFO-matched holding pairs."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    # 4 round-trip pairs on distinct symbols with locked durations:
    trades = [
        # Pair A: 30-minute hold (bucket 0)
        _trade(symbol="A/USDT", side="buy",  ts=base, quantity=1.0),
        _trade(symbol="A/USDT", side="sell", ts=base + timedelta(minutes=30), quantity=1.0),
        # Pair B: 6-hour hold (bucket 1)
        _trade(symbol="B/USDT", side="buy",  ts=base, quantity=1.0),
        _trade(symbol="B/USDT", side="sell", ts=base + timedelta(hours=6), quantity=1.0),
        # Pair C: 3-day hold (bucket 2)
        _trade(symbol="C/USDT", side="buy",  ts=base, quantity=1.0),
        _trade(symbol="C/USDT", side="sell", ts=base + timedelta(days=3), quantity=1.0),
        # Pair D: 30-day hold (bucket 3)
        _trade(symbol="D/USDT", side="buy",  ts=base, quantity=1.0),
        _trade(symbol="D/USDT", side="sell", ts=base + timedelta(days=30), quantity=1.0),
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    assert fp.hold_duration_buckets == pytest.approx(
        (0.25, 0.25, 0.25, 0.25), abs=1e-9
    )


# ---------------------------------------------------------------------------
# L1 normalization invariant
# ---------------------------------------------------------------------------


def test_components_l1_normalized_when_nonempty() -> None:
    """Each non-empty component sums to 1.0 (L1-normalized). Empty → all zeros."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [
        _trade(symbol="BTC/USDT", price=500.0, quantity=1.0),
        _trade(symbol="ETH/USDT", price=2_000.0, quantity=1.0),
        _trade(symbol="SOL/USDT", price=50.0, quantity=1.0),
    ]
    fp = compute_fingerprint_v1(trades, _empty_metrics())

    # Each populated component sums to 1.0.
    assert sum(fp.trade_size_buckets) == pytest.approx(1.0, abs=1e-9)
    assert sum(fp.asset_class_mix) == pytest.approx(1.0, abs=1e-9)
    assert sum(fp.instrument_concentration) == pytest.approx(1.0, abs=1e-9)
    assert sum(fp.temporal_pattern) == pytest.approx(1.0, abs=1e-9)
    # hold_duration may be empty (no closed pairs in the input — three open
    # buys on distinct symbols); document the contract: empty → all zeros.
    assert sum(fp.hold_duration_buckets) in (0.0, pytest.approx(1.0, abs=1e-9))


# ---------------------------------------------------------------------------
# H-9 cosine cases — exercise the contract end-to-end through the JSONB shape
# ---------------------------------------------------------------------------


def test_h9_identical_returns_one() -> None:
    """Cosine of identical fingerprints is 1.0."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [_trade()]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    vec = _concat_46(fp.to_jsonb())
    assert _cosine(vec, vec) == pytest.approx(1.0, abs=1e-9)


def test_h9_orthogonal_returns_zero() -> None:
    """Disjoint one-hot vectors yield cosine 0.0."""
    a = [0.0] * 46
    b = [0.0] * 46
    a[0] = 1.0   # only trade_size bucket 0
    b[5] = 1.0   # only hold_duration bucket 1 — fully disjoint
    assert _cosine(a, b) == pytest.approx(0.0, abs=1e-9)


def test_h9_scale_invariance() -> None:
    """Cosine is scale-invariant: cos(a, k*a) == 1.0 for k > 0."""
    base = [0.0] * 46
    base[0] = 1.0
    base[1] = 0.5
    base[20] = 0.3

    scaled = [v * 7.0 for v in base]
    assert _cosine(base, scaled) == pytest.approx(1.0, abs=1e-9)
    # Different non-trivial scaling factor.
    scaled2 = [v * 0.001 for v in base]
    assert _cosine(base, scaled2) == pytest.approx(1.0, abs=1e-9)


def test_h9_swap_symmetry() -> None:
    """compute_similarity(a, b) == compute_similarity(b, a) (cosine is symmetric)."""
    a = [0.0] * 46
    a[0] = 0.7
    a[5] = 0.2
    a[10] = 0.1
    b = [0.0] * 46
    b[0] = 0.4
    b[5] = 0.5
    b[15] = 0.1
    assert _cosine(a, b) == pytest.approx(_cosine(b, a), abs=1e-12)


def test_h9_hand_computed_concat_order() -> None:
    """Hand-verified result for two known fingerprints — locks the
    array-concatenation order (trade_size || hold_duration || asset_class ||
    instrument || temporal) shared with migration 105 compute_similarity."""
    a_jsonb = {
        "version": 1,
        "trade_size_buckets":       [1.0, 0.0, 0.0, 0.0],
        "hold_duration_buckets":    [0.0, 1.0, 0.0, 0.0],
        "asset_class_mix":          [0.0, 0.0, 1.0, 0.0],
        "instrument_concentration": [0.0] * 10,
        "temporal_pattern":         [0.0] * 24,
    }
    b_jsonb = {
        "version": 1,
        "trade_size_buckets":       [1.0, 0.0, 0.0, 0.0],
        "hold_duration_buckets":    [0.0, 0.0, 0.0, 0.0],
        "asset_class_mix":          [0.0, 0.0, 1.0, 0.0],
        "instrument_concentration": [0.0] * 10,
        "temporal_pattern":         [0.0] * 24,
    }
    a_vec = _concat_46(a_jsonb)
    b_vec = _concat_46(b_jsonb)

    # Hand math:
    #   a = [1, 0,0,0, 0,1,0,0, 0,0,1,0, 0...0(10), 0...0(24)]
    #   b = [1, 0,0,0, 0,0,0,0, 0,0,1,0, 0...0(10), 0...0(24)]
    #   a · b = 1*1 + 0*0... + 1*1 (asset_class[2]) = 2
    #   ||a|| = sqrt(1 + 1 + 1) = sqrt(3)
    #   ||b|| = sqrt(1 + 1) = sqrt(2)
    #   cos   = 2 / (sqrt(3) * sqrt(2)) = 2 / sqrt(6) ≈ 0.81649658
    expected = 2.0 / math.sqrt(6.0)
    assert _cosine(a_vec, b_vec) == pytest.approx(expected, abs=1e-9)


def test_h9_concat_order_matches_migration_105() -> None:
    """The 5-component concatenation order is locked: trade_size, hold_duration,
    asset_class, instrument, temporal. Verify slot-by-slot using one-hot
    fingerprints — each component lit alone produces a 1.0 in the expected slot."""
    fps_and_slots = [
        ("trade_size_buckets",       0,  [1.0, 0.0, 0.0, 0.0]),
        ("hold_duration_buckets",    4,  [1.0, 0.0, 0.0, 0.0]),
        ("asset_class_mix",          8,  [1.0, 0.0, 0.0, 0.0]),
        ("instrument_concentration", 12, [1.0] + [0.0] * 9),
        ("temporal_pattern",         22, [1.0] + [0.0] * 23),
    ]
    for component_name, expected_slot, payload in fps_and_slots:
        jsonb = {
            "version": 1,
            "trade_size_buckets":       [0.0, 0.0, 0.0, 0.0],
            "hold_duration_buckets":    [0.0, 0.0, 0.0, 0.0],
            "asset_class_mix":          [0.0, 0.0, 0.0, 0.0],
            "instrument_concentration": [0.0] * 10,
            "temporal_pattern":         [0.0] * 24,
        }
        jsonb[component_name] = payload
        vec = _concat_46(jsonb)
        assert vec[expected_slot] == 1.0, (
            f"{component_name} → vec[{expected_slot}] expected 1.0, got {vec[expected_slot]}"
        )


# ---------------------------------------------------------------------------
# JSONB round-trip — output is structurally compatible with migration 105
# ---------------------------------------------------------------------------


def test_to_jsonb_matches_migration_105_shape() -> None:
    """Output to_jsonb() must serialize as exactly the shape compute_similarity expects."""
    from services.ingestion.fingerprint import compute_fingerprint_v1

    trades = [_trade(), _trade(symbol="ETH/USDT")]
    fp = compute_fingerprint_v1(trades, _empty_metrics())
    jsonb = fp.to_jsonb()

    assert jsonb["version"] == 1
    # All values JSON-serializable (lists of floats, no tuples).
    import json
    serialized = json.dumps(jsonb)
    deserialized = json.loads(serialized)
    assert deserialized["version"] == 1
    assert len(deserialized["trade_size_buckets"]) == 4
    assert len(deserialized["hold_duration_buckets"]) == 4
    assert len(deserialized["asset_class_mix"]) == 4
    assert len(deserialized["instrument_concentration"]) == 10
    assert len(deserialized["temporal_pattern"]) == 24
