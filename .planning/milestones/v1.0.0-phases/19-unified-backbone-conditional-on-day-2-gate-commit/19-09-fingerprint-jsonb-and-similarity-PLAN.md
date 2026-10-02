---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 09
type: execute
wave: 2
depends_on: [19-02-migrations-103-107, 19-03-ingestion-adapter-protocol]
files_modified:
  - analytics-service/services/ingestion/fingerprint.py
  - analytics-service/tests/test_fingerprint.py
autonomous: true
requirements: [FINGERPRINT-01, FINGERPRINT-02]
must_haves:
  truths:
    - "compute_fingerprint_v1(trades, metrics, positions=None) -> Fingerprint produces a 5-component JSONB-friendly fingerprint with version=1"
    - "trade_size_buckets sums to 1.0 over 4 buckets (<$1k, $1-10k, $10-100k, $100k+) — by USD notional (price * quantity)"
    - "hold_duration_buckets sums to 1.0 over 4 buckets (<1h, 1-24h, 1-7d, >7d) — uses position.duration_days from closed positions; falls back to 0-distribution when positions empty"
    - "asset_class_mix sums to 1.0 over 4 buckets (spot, perp_long, perp_short, futures) — heuristic per symbol pattern across exchanges"
    - "instrument_concentration is 10-array of % volume by top-10 symbols, padded with 0.0 when fewer than 10 instruments traded"
    - "temporal_pattern is 24-array of % volume per UTC hour, sums to 1.0"
    - "Empty trades → all-zero Fingerprint (compute_similarity returns 0.0 on either-zero input — no-op behavior)"
    - "compute_similarity SQL function from migration 105 verified via pytest: identical=1.0000, orthogonal<0.1, NULL=0.0, version_mismatch=0.0"
    - "pgvector explicitly deferred to v2 — DOCUMENTED in compute_fingerprint_v1 docstring per UC-C"
  artifacts:
    - path: "analytics-service/services/ingestion/fingerprint.py"
      provides: "compute_fingerprint_v1 — 5-component fingerprint computation"
      contains: "compute_fingerprint_v1"
    - path: "analytics-service/tests/test_fingerprint.py"
      provides: "Pytest covering FINGERPRINT-01 fingerprint shape + FINGERPRINT-02 similarity (extends test_compute_similarity_sql.py from P2)"
      contains: "test_empty_trades_zero_fingerprint"
  key_links:
    - from: "compute_fingerprint_v1"
      to: "Fingerprint dataclass (P3 services.ingestion.adapter)"
      via: "returns Fingerprint(version=1, ...) with .to_jsonb() shape"
      pattern: "Fingerprint"
    - from: "P4 router compute_fingerprint step"
      to: "supabase.table('strategies').update({'fingerprint': fp.to_jsonb()})"
      via: "P4 already wired the persist call"
      pattern: "fingerprint"
    - from: "test_fingerprint.py"
      to: "migration 105 compute_similarity SQL function"
      via: "supabase.rpc('compute_similarity', {a, b}) integration test"
      pattern: "compute_similarity"
---

<objective>
Ship the FINGERPRINT-01 computation primitive: `compute_fingerprint_v1(trades,
metrics, positions=None) -> Fingerprint`. The function produces a versioned
5-component JSONB-friendly fingerprint per CONTEXT.md L66-72 schema:

```jsonc
{
  "version": 1,
  "trade_size_buckets":       [4 floats summing to 1.0],   // <$1k, $1-10k, $10-100k, $100k+
  "hold_duration_buckets":    [4 floats summing to 1.0],   // <1h, 1-24h, 1-7d, >7d
  "asset_class_mix":          [4 floats summing to 1.0],   // spot, perp_long, perp_short, futures
  "instrument_concentration": [10 floats summing to 1.0],  // top-10 by % volume; pad with 0.0
  "temporal_pattern":         [24 floats summing to 1.0]   // % volume per UTC hour
}
```

The function is called from:
- P4 synchronous router (analytics-service/routers/process_key.py) — at the
  `compute_fingerprint` pipeline step, BEFORE `report_queued` transition.
  P4 already wired the persist (`supabase.table("strategies").update(...)`).
- P6 worker handler (`run_process_key_long_job`) — same pipeline step.

This plan also adds pytest coverage that complements P2's `test_compute_similarity_sql.py`:
- P2's pytest verifies the SQL function (compute_similarity in migration 105).
- This plan's pytest verifies the Python computation (compute_fingerprint_v1).
- A combined integration test calls compute_fingerprint_v1 → persists JSONB →
  calls compute_similarity SQL function on (fp_a.to_jsonb(), fp_b.to_jsonb())
  to verify end-to-end shape compatibility.

**Versioned shape (per UC-C):** `version: 1` is the v0 placeholder; pgvector
explicitly deferred to v2 once N≥1000. The function MUST produce shape-stable
output that survives weighting refinement in v2.

**Bucket boundaries (per RESEARCH §P9):**
- TRADE_SIZE_BUCKETS_USD = (1_000, 10_000, 100_000)  → 4 buckets: <1k, 1-10k, 10-100k, 100k+
- HOLD_DURATION_BUCKETS_HRS = (1, 24, 24*7)  → 4 buckets: <1h, 1-24h, 1-7d, >7d
- ASSET_CLASSES = ("spot", "perp_long", "perp_short", "futures")  → 4 buckets

**Asset class heuristic (RESEARCH §P9 gotcha L1877):** symbol patterns differ
across exchanges (OKX uses BTC-USDT-SWAP, Binance/Bybit use BTCUSDT). Phase 19
ships v0 with the simple rule below; UC-C accepts placeholder identity
preservation. v2 refinement.

**No backfill cron in this plan.** Per RESEARCH §P9 L1838-1845, the recommended
backfill is a one-shot Railway script (`scripts/backfill-fingerprints.py`), NOT
a cron — cron creates new attack surface for v1.0.0. The script is OUT OF SCOPE
for this plan (defer to a follow-up cleanup PR).

Purpose: Closes FINGERPRINT-01 (computation) + FINGERPRINT-02 (Python<->SQL
shape compatibility). Wave 2 — independent of P4/P6 because both lazy-import
this module per P3's adapter pattern.

Output: 1 source file (fingerprint.py) + 1 pytest stub.

Tracking: FINGERPRINT-01 (computation + persistence path), FINGERPRINT-02
(Python<->SQL shape integration).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@analytics-service/services/ingestion/adapter.py

<interfaces>
<!-- Inputs and outputs -->

From P3 (services.ingestion.adapter):
- `Trade` dataclass: exchange, symbol, side, price, quantity, fee, fee_currency, timestamp (datetime), order_type, is_fill
- `Position` dataclass: includes `duration_days: float | None` per migration 092
- `MetricsSnapshot` dataclass: optional input (currently unused — reserved for v2 weighting)
- `Fingerprint` dataclass with `to_jsonb()` method:
  ```python
  Fingerprint(
    version=1,
    trade_size_buckets=(...4 floats),
    hold_duration_buckets=(...4 floats),
    asset_class_mix=(...4 floats),
    instrument_concentration=(...10 floats),
    temporal_pattern=(...24 floats),
  )
  ```

From P2 migration 105 (FINGERPRINT-02):
- `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC`
- IMMUTABLE PARALLEL SAFE
- Returns 0.0 on NULL or version mismatch
- 46-dim concatenated vector (4+4+4+10+24)

From P4 router + P6 worker:
- Both call `adapter.compute_fingerprint(trades, metrics)` which delegates to this module via lazy import.
- P4 also calls `supabase.table("strategies").update({"fingerprint": fp.to_jsonb()})`. NOT this plan's responsibility.
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P9-1" type="auto" tdd="true">
  <name>Task 1: Write compute_fingerprint_v1 in services/ingestion/fingerprint.py</name>
  <files>analytics-service/services/ingestion/fingerprint.py, analytics-service/tests/test_fingerprint.py</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1729-1826 — full compute_fingerprint_v1 blueprint with bucket boundaries + heuristic; lines 1873-1880 gotchas)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md (lines 64-77 — fingerprint v0 schema; line 148 — pgvector deferred to v2)
    - analytics-service/services/ingestion/adapter.py (P3 — Fingerprint, Trade, Position, MetricsSnapshot dataclass shapes)
    - .planning/REQUIREMENTS.md (FINGERPRINT-01 + FINGERPRINT-02 spec)
  </read_first>
  <behavior>
    - Test 1 (test_empty_trades_zero_fingerprint): compute_fingerprint_v1([]) returns Fingerprint with all-zeros arrays + version=1.
    - Test 2 (test_single_trade_size_bucket): one $500 trade → trade_size_buckets=(1.0, 0, 0, 0).
    - Test 3 (test_size_bucket_distribution): 4 trades — $500, $5_000, $50_000, $500_000 → trade_size_buckets=(0.25, 0.25, 0.25, 0.25).
    - Test 4 (test_temporal_pattern_distribution): 24 trades evenly spaced across UTC hours → temporal_pattern=(1/24, 1/24, ..., 1/24) (24 elements summing to 1.0).
    - Test 5 (test_instrument_concentration_padded): 3 distinct symbols → instrument_concentration has 3 non-zero entries followed by 7 zeros.
    - Test 6 (test_asset_class_perp_long_buy): SWAP/PERP symbol with side='buy' → asset_class_mix index 1 (perp_long).
    - Test 7 (test_asset_class_spot_no_perp_marker): plain BTC/USDT (no SWAP/PERP/FUTURES marker) → asset_class_mix index 0 (spot).
    - Test 8 (test_hold_duration_with_positions): 4 closed positions with durations 0.5h, 12h, 36h, 240h → hold_duration_buckets=(0.25, 0.25, 0.25, 0.25).
    - Test 9 (test_hold_duration_no_positions): when positions=None, hold_duration_buckets all zero (no-op fallback).
    - Test 10 (test_to_jsonb_round_trip): compute_fingerprint_v1(...) → to_jsonb() → JSON-encode → JSON-decode produces a dict with the exact 6 keys and correct array lengths.
    - Test 11 (test_compute_similarity_integration): compute_fingerprint_v1(trades_a) and (trades_b); call SQL `compute_similarity(fp_a.to_jsonb(), fp_b.to_jsonb())` (P2 migration 105) — returns NUMERIC in [0,1].
    - Test 12 (test_compute_similarity_identical_returns_one) [H-9]: compute_similarity over two byte-identical fingerprints returns exactly 1.0000.
    - Test 13 (test_compute_similarity_orthogonal_returns_zero) [H-9]: compute_similarity over two fingerprints with disjoint single-bucket vectors (e.g., one all volume in trade_size_buckets[0], other all volume in trade_size_buckets[3]) returns < 0.1 (orthogonal cosine ~0).
    - Test 14 (test_compute_similarity_scaled_invariance) [H-9]: compute_similarity over a fingerprint and the same fingerprint scaled (multiply all values by k > 0) returns ~1.0 (cosine is scale-invariant). Verify against hand-computed expected value.
    - Test 15 (test_compute_similarity_swap_symmetry) [H-9]: compute_similarity(a, b) == compute_similarity(b, a) for arbitrary a, b. Exact equality (not within tolerance) — symmetry is a property of cosine on the same vector, NOT a numerical approximation.
    - Test 16 (test_compute_similarity_array_concat_order) [H-9]: explicit hand-computed test against a known input-output pair. Compute the 46-dim concatenated vector by hand from a fixture, compute cosine similarity, assert SQL function matches within 1e-6. Catches the array-concat order regression where `b.hold_duration` slot drifts to indices 0-3 instead of 4-7 — silently under-reports similarity by mixing components.
    - Test 17 (test_validate_failure_resets_draft_with_errors_xref) [H-14 cross-reference]: this is a cross-reference to the test owned by 19-02 P2-1 (test_transition_rpc.py). H-14 lives there by ownership. P9-1 acceptance verifies the test exists in the sibling file.
  </behavior>
  <action>
Create `analytics-service/services/ingestion/fingerprint.py`:

```python
"""Phase 19 / FINGERPRINT-01 — versioned 5-component fingerprint.

Computed at the end of every /process-key pipeline run (sync router + worker
handler). Persisted to strategies.fingerprint JSONB by the caller.

v0 placeholder per UC-C — pgvector explicitly deferred to v2 once N≥1000.
The shape is fixed at 46 dims (4+4+4+10+24) so future similarity computation
(plain plpgsql cosine in v1, pgvector in v2) operates on a stable contract.

Bucket boundaries (CONTEXT.md L66-72):
  - trade_size_buckets:       <$1k | $1-10k | $10-100k | $100k+
  - hold_duration_buckets:    <1h  | 1-24h  | 1-7d    | >7d
  - asset_class_mix:          spot | perp_long | perp_short | futures
  - instrument_concentration: top-10 symbols by % USD volume (padded with 0.0)
  - temporal_pattern:         24 UTC-hour buckets

Empty trades → all-zero Fingerprint. compute_similarity (migration 105)
returns 0.0 on either-zero input, so similarity is well-defined for new
strategies pre-trade-history.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

from services.ingestion.adapter import (
    Fingerprint,
    MetricsSnapshot,
    Position,
    Trade,
)

# Bucket boundaries
TRADE_SIZE_BUCKETS_USD: tuple[float, float, float] = (1_000.0, 10_000.0, 100_000.0)  # 4 buckets: <1k, 1-10k, 10-100k, 100k+
HOLD_DURATION_BUCKETS_HRS: tuple[float, float, float] = (1.0, 24.0, 24.0 * 7)         # 4 buckets: <1h, 1-24h, 1-7d, >7d
ASSET_CLASSES: tuple[str, str, str, str] = ("spot", "perp_long", "perp_short", "futures")


def compute_fingerprint_v1(
    trades: list[Trade],
    metrics: MetricsSnapshot | None = None,
    positions: list[Position] | None = None,
) -> Fingerprint:
    """5-component cosine-similarity-friendly fingerprint.

    Args:
        trades: List of trade fills from IngestionAdapter.fetch_raw.
        metrics: MetricsSnapshot (currently unused — reserved for v2 weighting).
        positions: List of reconstructed positions; when provided, used for
            hold_duration_buckets. Falls back to all-zero distribution when None.

    Returns:
        Fingerprint with version=1 and all 5 component arrays L1-normalized
        to sum to 1.0 (or all-zero when no data).
    """
    if not trades:
        return Fingerprint()  # all-zeros default

    total = len(trades)

    # 1. Trade-size buckets — by USD notional (price * quantity)
    notionals = [t.price * t.quantity for t in trades]
    size_counts = [0, 0, 0, 0]
    for n in notionals:
        if n < TRADE_SIZE_BUCKETS_USD[0]:
            size_counts[0] += 1
        elif n < TRADE_SIZE_BUCKETS_USD[1]:
            size_counts[1] += 1
        elif n < TRADE_SIZE_BUCKETS_USD[2]:
            size_counts[2] += 1
        else:
            size_counts[3] += 1
    size_dist = tuple(c / total for c in size_counts)

    # 2. Hold-duration buckets — requires position lifecycle.
    hold_counts = [0, 0, 0, 0]
    if positions:
        for p in positions:
            if p.status != "closed" or p.duration_days is None:
                continue
            hours = float(p.duration_days) * 24.0
            if hours < HOLD_DURATION_BUCKETS_HRS[0]:
                hold_counts[0] += 1
            elif hours < HOLD_DURATION_BUCKETS_HRS[1]:
                hold_counts[1] += 1
            elif hours < HOLD_DURATION_BUCKETS_HRS[2]:
                hold_counts[2] += 1
            else:
                hold_counts[3] += 1
    hold_total = sum(hold_counts)
    if hold_total > 0:
        hold_dist = tuple(c / hold_total for c in hold_counts)
    else:
        hold_dist = (0.0, 0.0, 0.0, 0.0)

    # 3. Asset class mix — heuristic per symbol pattern (RESEARCH §P9 L1877 — v0).
    # OKX: BTC-USDT-SWAP; Binance: BTCUSDT (perp via separate prefix); Bybit: BTCUSDT
    # Heuristic — refine in v2:
    class_counts = [0, 0, 0, 0]  # spot, perp_long, perp_short, futures
    for t in trades:
        sym_upper = t.symbol.upper()
        if "FUTURES" in sym_upper or "-FUTURES" in sym_upper:
            class_counts[3] += 1  # futures
        elif "SWAP" in sym_upper or "PERP" in sym_upper:
            # perp; long vs short by side
            if t.side.lower() == "buy":
                class_counts[1] += 1
            else:
                class_counts[2] += 1
        else:
            class_counts[0] += 1  # spot
    class_dist = tuple(c / total for c in class_counts)

    # 4. Instrument concentration — top-10 by % USD volume; padded with 0.0
    volume_by_symbol: dict[str, float] = defaultdict(float)
    for t in trades:
        volume_by_symbol[t.symbol] += t.price * t.quantity
    total_vol = sum(volume_by_symbol.values())
    if total_vol > 0:
        sorted_vols = sorted(volume_by_symbol.values(), reverse=True)[:10]
        instr_dist_list = [v / total_vol for v in sorted_vols]
    else:
        instr_dist_list = []
    # Pad to 10
    instr_dist = tuple(instr_dist_list + [0.0] * (10 - len(instr_dist_list)))

    # 5. Temporal pattern — % USD volume per UTC hour (24 buckets)
    hour_volumes = [0.0] * 24
    for t in trades:
        ts = t.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hour = ts.astimezone(timezone.utc).hour
        hour_volumes[hour] += t.price * t.quantity
    total_hv = sum(hour_volumes)
    if total_hv > 0:
        temporal_dist = tuple(v / total_hv for v in hour_volumes)
    else:
        temporal_dist = tuple([0.0] * 24)

    return Fingerprint(
        version=1,
        trade_size_buckets=size_dist,
        hold_duration_buckets=hold_dist,
        asset_class_mix=class_dist,
        instrument_concentration=instr_dist,
        temporal_pattern=temporal_dist,
    )
```

Then create `analytics-service/tests/test_fingerprint.py` with the 11 behaviors above. For test_compute_similarity_integration (Test 11), use the test Supabase project (skip when SUPABASE_TEST_URL absent — pattern from P2 test_compute_similarity_sql.py). Sample test:

```python
import json
from datetime import datetime, timezone

import pytest

from services.ingestion.adapter import Fingerprint, Trade, Position
from services.ingestion.fingerprint import compute_fingerprint_v1


def _make_trade(symbol: str = "BTC-USDT-SWAP", price: float = 1000.0, quantity: float = 1.0,
                side: str = "buy", ts: datetime = None) -> Trade:
    return Trade(
        exchange="okx",
        symbol=symbol,
        side=side,
        price=price,
        quantity=quantity,
        fee=0.0,
        fee_currency="USDT",
        timestamp=ts or datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc),
        order_type="limit",
        is_fill=True,
    )


def test_empty_trades_zero_fingerprint():
    fp = compute_fingerprint_v1([])
    assert fp.version == 1
    assert fp.trade_size_buckets == (0.0, 0.0, 0.0, 0.0)
    assert fp.temporal_pattern == tuple([0.0] * 24)


def test_single_trade_size_bucket():
    fp = compute_fingerprint_v1([_make_trade(price=500.0, quantity=1.0)])
    assert fp.trade_size_buckets == (1.0, 0.0, 0.0, 0.0)


def test_size_bucket_distribution():
    trades = [
        _make_trade(price=500.0, quantity=1.0),       # $500   → bucket 0
        _make_trade(price=5_000.0, quantity=1.0),      # $5_000  → bucket 1
        _make_trade(price=50_000.0, quantity=1.0),     # $50_000 → bucket 2
        _make_trade(price=500_000.0, quantity=1.0),    # $500_000 → bucket 3
    ]
    fp = compute_fingerprint_v1(trades)
    assert all(abs(b - 0.25) < 1e-9 for b in fp.trade_size_buckets)


def test_temporal_pattern_distribution():
    trades = [
        _make_trade(ts=datetime(2026, 1, 1, h, 0, tzinfo=timezone.utc))
        for h in range(24)
    ]
    fp = compute_fingerprint_v1(trades)
    assert len(fp.temporal_pattern) == 24
    assert all(abs(v - (1 / 24)) < 1e-9 for v in fp.temporal_pattern)


def test_instrument_concentration_padded():
    trades = [_make_trade(symbol=s) for s in ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]]
    fp = compute_fingerprint_v1(trades)
    assert len(fp.instrument_concentration) == 10
    assert sum(1 for v in fp.instrument_concentration if v > 0) == 3
    assert fp.instrument_concentration[3:] == (0.0,) * 7


def test_asset_class_perp_long_buy():
    fp = compute_fingerprint_v1([_make_trade(symbol="BTC-USDT-SWAP", side="buy")])
    # asset_class_mix index 1 = perp_long
    assert fp.asset_class_mix[1] == 1.0
    assert fp.asset_class_mix[0] == 0.0


def test_asset_class_spot_no_perp_marker():
    fp = compute_fingerprint_v1([_make_trade(symbol="BTC/USDT", side="buy")])
    assert fp.asset_class_mix[0] == 1.0  # spot


def test_hold_duration_with_positions():
    positions = [
        Position(strategy_id="s", symbol="X", side="buy",
                 opened_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                 closed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                 entry_price=1.0, exit_price=1.0, quantity=1.0,
                 pnl=0.0, funding_pnl=0.0, status="closed", roi=0.0,
                 duration_days=d)
        for d in [0.5/24, 12/24, 36/24, 240/24]
    ]
    fp = compute_fingerprint_v1([_make_trade()], positions=positions)
    assert all(abs(b - 0.25) < 1e-9 for b in fp.hold_duration_buckets)


def test_hold_duration_no_positions():
    fp = compute_fingerprint_v1([_make_trade()])  # no positions
    assert fp.hold_duration_buckets == (0.0, 0.0, 0.0, 0.0)


def test_to_jsonb_round_trip():
    fp = compute_fingerprint_v1([_make_trade()])
    blob = fp.to_jsonb()
    encoded = json.dumps(blob)
    decoded = json.loads(encoded)
    assert set(decoded.keys()) == {
        "version", "trade_size_buckets", "hold_duration_buckets",
        "asset_class_mix", "instrument_concentration", "temporal_pattern",
    }
    assert decoded["version"] == 1
    assert len(decoded["trade_size_buckets"]) == 4
    assert len(decoded["hold_duration_buckets"]) == 4
    assert len(decoded["asset_class_mix"]) == 4
    assert len(decoded["instrument_concentration"]) == 10
    assert len(decoded["temporal_pattern"]) == 24


# Integration test against migration 105 SQL function (FINGERPRINT-02)
@pytest.mark.skipif(
    "not __import__('os').getenv('SUPABASE_TEST_URL')",
    reason="test Supabase project not configured",
)
def test_compute_similarity_integration():
    import os
    from supabase import create_client
    admin = create_client(os.environ["SUPABASE_TEST_URL"], os.environ["SUPABASE_TEST_SERVICE_KEY"])
    fp_a = compute_fingerprint_v1([_make_trade(symbol="BTC-USDT-SWAP", price=1000.0)])
    fp_b = compute_fingerprint_v1([_make_trade(symbol="BTC-USDT-SWAP", price=1000.0)])
    res = admin.rpc("compute_similarity", {"a": fp_a.to_jsonb(), "b": fp_b.to_jsonb()}).execute()
    # Identical fingerprints → 1.0000
    assert float(res.data) == 1.0
```
  </action>
  <acceptance_criteria>
    - File `analytics-service/services/ingestion/fingerprint.py` exists; defines `compute_fingerprint_v1` function
    - `grep -q 'def compute_fingerprint_v1' analytics-service/services/ingestion/fingerprint.py`
    - `grep -q 'TRADE_SIZE_BUCKETS_USD' analytics-service/services/ingestion/fingerprint.py`
    - `grep -q 'HOLD_DURATION_BUCKETS_HRS' analytics-service/services/ingestion/fingerprint.py`
    - `grep -q 'ASSET_CLASSES' analytics-service/services/ingestion/fingerprint.py`
    - `grep -q 'pgvector' analytics-service/services/ingestion/fingerprint.py` (docstring mentions deferred-to-v2)
    - File `analytics-service/tests/test_fingerprint.py` exists with 11 test functions covering: empty, size buckets, temporal, instrument, asset class, hold duration, jsonb round-trip, SQL integration
    - `grep -q 'test_empty_trades_zero_fingerprint' analytics-service/tests/test_fingerprint.py`
    - `grep -q 'test_to_jsonb_round_trip' analytics-service/tests/test_fingerprint.py`
    - `grep -q 'test_compute_similarity_integration' analytics-service/tests/test_fingerprint.py`
    - `cd analytics-service && python -m pytest tests/test_fingerprint.py -x -k 'not integration'` exits 0 (Python-only tests pass without test Supabase)
    - **H-9 (compute_similarity tests):** `analytics-service/tests/test_compute_similarity_sql.py` (owned by 19-02 P2-3) AND `analytics-service/tests/test_fingerprint.py` cover identical=1.0, orthogonal<0.1, scaled-invariance ~1.0, swap symmetry exact, hand-computed pair within 1e-6. Verify via:
      `grep -E 'test_compute_similarity_(identical_returns_one|orthogonal_returns_zero|scaled_invariance|swap_symmetry|array_concat_order)' analytics-service/tests/test_fingerprint.py | wc -l` returns ≥ 5
    - **H-14 cross-reference:** `grep -q 'test_validate_failure_resets_draft_with_errors' analytics-service/tests/test_transition_rpc.py` (the test ships in 19-02 P2-1; this plan documents the dependency)
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/ingestion/fingerprint.py && grep -q "def compute_fingerprint_v1" services/ingestion/fingerprint.py && grep -q "pgvector" services/ingestion/fingerprint.py && grep -q "TRADE_SIZE_BUCKETS_USD" services/ingestion/fingerprint.py && test -f tests/test_fingerprint.py && grep -q "test_empty_trades_zero_fingerprint" tests/test_fingerprint.py && grep -q "test_to_jsonb_round_trip" tests/test_fingerprint.py && grep -q "test_compute_similarity_identical_returns_one" tests/test_fingerprint.py && grep -q "test_compute_similarity_orthogonal_returns_zero" tests/test_fingerprint.py && grep -q "test_compute_similarity_scaled_invariance" tests/test_fingerprint.py && grep -q "test_compute_similarity_swap_symmetry" tests/test_fingerprint.py && python -m pytest tests/test_fingerprint.py -x -k "not integration" --no-header 2>&1 | tail -5 | grep -qE "passed|no tests ran"'
  </automated>
  <requirements>FINGERPRINT-01, FINGERPRINT-02</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| compute_fingerprint_v1 → strategies.fingerprint JSONB | persisted by P4 router; CHECK constraint (migration 105) enforces version=1 |
| compute_similarity SQL function (migration 105) → JSONB inputs | typed input; no string concat — injection-safe |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-48 | DoS | oversized fingerprint payload (e.g., 10MB JSONB) | mitigate | Fixed shape — 46 floats; bounded ~1KB JSONB; CHECK on (fingerprint->>'version')::INT = 1 (migration 105) rejects unknown versions before persist |
| T-19-49 | Information disclosure | fingerprint reveals strategy patterns to admin readers | accept | Phase 19 v0 placeholder per UC-C — fingerprint is intended to enable similarity discovery; not user-facing in v1 |
| T-19-50 | Tampering | unbounded asset_class heuristic miscategorizes | accept | v0 heuristic per RESEARCH §P9 gotcha L1877 — UC-C accepts placeholder identity preservation; v2 refinement once N≥1000 |
| T-19-51 | Information disclosure | accidental pgvector extension import | mitigate | Pitfall 9 — migration 105 verified by P2 acceptance criteria to NOT contain CREATE EXTENSION vector; documentation in fingerprint.py docstring explicitly states "pgvector deferred to v2" |
| T-19-52 | Spoofing | malicious caller inserts invalid fingerprint via direct UPDATE | mitigate | Migration 105 CHECK constraint `(fingerprint->>'version')::INT = 1` rejects writes of unknown versions; partial index on `WHERE fingerprint IS NOT NULL` requires explicit shape |
</threat_model>

<verification>
- File `services/ingestion/fingerprint.py` exists with `compute_fingerprint_v1` function.
- 11 pytest cases cover empty input, size buckets, temporal, instrument concentration, asset class heuristic, hold duration with/without positions, jsonb round-trip, and SQL integration.
- Python-only tests pass without test Supabase project; integration test skips gracefully when SUPABASE_TEST_URL unset.
- Function returns Fingerprint dataclass with version=1 and 5 component arrays of correct lengths (4, 4, 4, 10, 24).
- Empty trades input produces all-zero Fingerprint (no-op for compute_similarity).
- pgvector deferred-to-v2 documented in module docstring.
</verification>

<success_criteria>
- FINGERPRINT-01: 5-component versioned fingerprint computed at end of /process-key pipeline; persisted to strategies.fingerprint JSONB by P4 router (already wired); shape stable for v2 weighting refinement.
- FINGERPRINT-02: Python compute_fingerprint_v1 output round-trips through to_jsonb() into the SQL compute_similarity function; identical fingerprints return 1.0000; cross-version returns 0.0.
- Empty-trades fallback: all-zero fingerprint; compute_similarity returns 0.0 (well-defined for new strategies).
- pgvector explicitly deferred to v2 per UC-C — no CREATE EXTENSION vector in migration 105 (verified by P2 acceptance); documentation in fingerprint.py docstring.
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-09-SUMMARY.md`
</output>
