---
phase: 12-backend-metric-contracts
plan: 05
subsystem: analytics
tags: [python, trade-metrics, derived-metrics, sqn, weighted-rr, profit-factor, volume-aggregator, trade-mix, audit-gated, b-01-path-b, h-f, tdd]

# Dependency graph
requires:
  - phase: 12-01
    provides: "TRADE_MIX_HAS_MAKER_TAKER=false (D-15 audit outcome — 2-bucket fallback ships, 4-bucket deferred to v0.17.1)"
  - phase: 12-02
    provides: "Frozen TS contract: TradeMetrics +7 derived fields including weighted_risk_reward_ratio per H-F; TradeMixBuckets all-optional union covering 4-bucket and 2-bucket variants"
  - phase: 12-04
    provides: "compute_exposure_metrics + compute_turnover_series helpers (Plan 12-06 will combine with this plan's helpers in the orchestrator)"
provides:
  - "_compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions) — B-01 path (b) — 6 derived metrics: expectancy, risk_reward_ratio, weighted_risk_reward_ratio (H-F / METRICS-07), sqn (METRICS-08), profit_factor_long, profit_factor_short"
  - "_compute_volume_aggregator(fills) — METRICS-09 — gross_volume_usd, mean_trade_size_usd, daily_turnover_usd, monthly_turnover_usd over raw fills"
  - "_compute_trade_mix(fills, has_maker_taker) — METRICS-10 — 4-bucket happy-path / 2-bucket fallback (D-15 audit-gated) with each bucket {count, total_notional, avg_holding_period_hours}"
  - "Extended reconstruct_positions return dict (strictly additive): avg_winning_trade, avg_losing_trade, winners_count, losers_count, realized_pnl_per_trade — feeds the derived-metric function"
affects: [12-06 (orchestrator wiring — will call all 3 helpers + reconstruct_positions and merge into trade_metrics JSONB), 12-09 (sibling-table parity test — derived metrics + volume/mix participate in trade_metrics parity check), 12-10 (deploy script — propagates TRADE_MIX_HAS_MAKER_TAKER env var that 12-06 reads), 14b (lazy panels — Trade Main + Risk/Reward + SQN + Volume + Trade Mix rows consume these keys)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "B-01 path (b) data-flow architecture: derived trade metrics live in a NEW separate function that consumes BOTH the volume-side dict (raw_fills shape) AND the position-side dict (positions shape) — mixing them inside _compute_volume_metrics silently defaults all derived metrics to None"
    - "Strictly-additive return-dict extension: reconstruct_positions gains 5 new keys (avg_winning_trade, avg_losing_trade, winners_count, losers_count, realized_pnl_per_trade) without touching any of the 10 legacy keys — no caller breakage"
    - "Pure-helper architecture: _compute_volume_aggregator + _compute_trade_mix + _compute_derived_trade_metrics are pure / standalone — Plan 12-06 orchestrator coordinates I/O, calls all 4 helpers, merges into JSONB before upsert"
    - "Audit-gated branching: _compute_trade_mix(fills, has_maker_taker: bool) takes the bucket-count decision as an explicit parameter; deploy script reads TRADE_MIX_HAS_MAKER_TAKER from TODOS.md and propagates via env var"
    - "T-12-05-03 mitigation pattern: every divisor in derived metrics guarded with explicit `> 0` check; zero-loss / zero-divisor cases yield None (rendered as '—' downstream) to avoid +Infinity propagating into JSONB"
    - "T-12-05-04 mitigation: in 4-bucket Trade Mix mode, fills with is_maker missing/None are skipped — D-15 audit gates that path so skipped fills represent a known small fraction"

key-files:
  created: []
  modified:
    - "analytics-service/services/analytics_runner.py (+285 lines: _compute_derived_trade_metrics, _compute_volume_aggregator, _compute_trade_mix, plus `import math` and `from collections import defaultdict`)"
    - "analytics-service/services/position_reconstruction.py (+33 lines: 5 new keys in reconstruct_positions return dict — avg_winning_trade, avg_losing_trade, winners_count, losers_count, realized_pnl_per_trade — plus losers segmentation)"
    - "analytics-service/tests/test_analytics_runner.py (+316 lines: 14 RED-then-GREEN tests covering all 10 acceptance criteria)"

key-decisions:
  - "B-01 path (b) honored verbatim: NEW function _compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions) NOT inlined into _compute_volume_metrics. The volume_metrics arg is currently only consumed for plumbing/contract compatibility (assigned to `_`) so Plan 12-06's orchestrator-wiring contract matches the path-(b) signature literally."
  - "Strictly additive reconstruct_positions extension: every legacy key (total_positions, open_positions, closed_positions, win_rate, avg_roi, avg_duration_days, long_count, short_count, best_trade_roi, worst_trade_roi) preserved unchanged. The 5 new keys (avg_winning_trade, avg_losing_trade, winners_count, losers_count, realized_pnl_per_trade) are appended at the end of the return dict — readers that only know the legacy shape continue to work."
  - "Inline fixtures (sample_fills + sample_fills_with_maker_taker) declared inside test_analytics_runner.py rather than touching the global conftest.py — matches Plan 12-04's adaptation pattern (fixture mismatch = Rule 3 blocking, not architectural)."
  - "Profit-factor zero-divisor returns None (not 0.0, not Infinity): explicit T-12-05-03 mitigation. _profit_factor returns None when gross_loss == 0, which downstream renders as '—' per the frozen TradeMetrics contract (`number | null`)."
  - "Locked exact numeric values in tests, not just structural shape: gross=5000, daily=5000/3, monthly=5000/2, long_count=4 / notional=3600, short_count=2 / notional=1400, long_avg_holding=23/4, short_avg_holding=2.5 — gives Plan 12-09's parity gate concrete reference values to diff against."
  - "Added 4 augmentation tests beyond the plan's stated 8 — empty volume aggregator, computed numeric values, T-12-05-04 missing-flag skip, computed avg_holding_period — locks every threat-model mitigation and graceful-behavior contract."

patterns-established:
  - "B-01 path (b): the canonical Phase 12 pattern for any future helper that needs BOTH fill-level and position-level data — declare a NEW pure function that takes both dicts as args; orchestrator coordinates I/O. Mixing layers inside one function silently defaults derived metrics to None."
  - "Rule for divisor-by-zero in financial metrics: return None (rendered '—' downstream) rather than 0.0 or +Infinity. Frozen TradeMetrics contract uses `number | null` precisely so renderer can distinguish 'no data' from 'zero outcome'."
  - "Audit-gated branching as explicit boolean param: _compute_trade_mix(fills, has_maker_taker) — keeps the helper pure and unit-testable while letting the orchestrator (Plan 12-06) read the env var (which 12-10 deploy script writes from TODOS.md)."

requirements-completed: [METRICS-07, METRICS-08, METRICS-09, METRICS-10]

# Metrics
duration: 6min
completed: 2026-04-28
---

# Phase 12 Plan 05: Derived Trade Metrics + Volume Aggregator + Audit-Gated Trade Mix Summary

**6 derived trade metrics including Weighted R:R (H-F / METRICS-07) + SQN (METRICS-08) added via NEW `_compute_derived_trade_metrics` honoring B-01 path (b); volume aggregator (METRICS-09) and audit-gated 2-bucket Trade Mix (METRICS-10 — D-15 fallback) shipped as pure helpers ready for Plan 12-06 orchestrator wiring.**

## Performance

- **Duration:** 6 min (356 seconds)
- **Started:** 2026-04-28T13:09:42Z
- **Completed:** 2026-04-28T13:15:38Z
- **Tasks:** 2 (TDD: 4 commits — 2 RED + 2 GREEN)
- **Files modified:** 3 (2 services, 1 test)

## Accomplishments

- **METRICS-07 lands:** `_compute_derived_trade_metrics` produces 7 fields per the frozen TradeMetrics contract (Plan 12-02 D-16 lock):
  - `expectancy = win_rate × avg_win - (1 - win_rate) × |avg_loss|`
  - `risk_reward_ratio = avg_win / |avg_loss|` (None when denominator is zero)
  - `weighted_risk_reward_ratio = (avg_win × winners_count) / (|avg_loss| × losers_count)` — H-F formula from 12-REVIEWS.md
  - `profit_factor_long` and `profit_factor_short` — segmented from `realized_pnl_per_trade` by side
  - `sqn` — METRICS-08 below
- **METRICS-08 lands:** SQN `(mean(R) / std(R)) × sqrt(min(N, 100))` over per-trade R-multiples where `R = realized_pnl / |avg_loss|`. Sample variance with `N-1` denominator. Returns None when fewer than 2 trades or zero std (avoids divide-by-zero).
- **METRICS-09 lands:** `_compute_volume_aggregator(fills)` produces all 4 keys — gross_volume_usd, mean_trade_size_usd, daily_turnover_usd, monthly_turnover_usd. Groups by `filled_at` (or `created_at` fallback) date / month prefix.
- **METRICS-10 lands:** `_compute_trade_mix(fills, has_maker_taker)` branches off D-15 audit outcome — 4-bucket happy path or 2-bucket fallback. Per D-15 (TODOS.md, 2026-04-28), production currently ships the 2-bucket variant: `{long, short}` only. Each bucket: `{count, total_notional, avg_holding_period_hours}`. T-12-05-04 mitigation: in 4-bucket mode, fills missing `is_maker` are skipped.
- **B-01 path (b) honored:** the 3 derived-metric primitives (avg_winning_trade, avg_losing_trade, winners_count, losers_count) and a per-trade realized-PnL list (realized_pnl_per_trade) are now emitted from `reconstruct_positions` — the data the new function needs to compute everything in one place. Without this extension, `_compute_derived_trade_metrics` would have no inputs and ship `None` for every field.
- **14 new tests pass GREEN** (RED-then-GREEN); 102/102 across the related suites (analytics_runner + position_reconstruction* + metrics) — no regressions; 584/584 across the full analytics-service suite excluding the pre-existing `test_drain_100_jobs` (logged in deferred-items.md, out of scope).

## Task Commits

Each task was committed atomically (TDD RED-then-GREEN):

1. **Task 1 RED: failing tests for `_compute_derived_trade_metrics`** — `d20fe09` (test)
2. **Task 1 GREEN: implement `_compute_derived_trade_metrics` + extend `reconstruct_positions`** — `425bce0` (feat)
3. **Task 2 RED: failing tests for volume aggregator + trade mix** — `65f2418` (test)
4. **Task 2 GREEN: implement `_compute_volume_aggregator` + `_compute_trade_mix`** — `512c6f6` (feat)

## Files Created/Modified

- `analytics-service/services/analytics_runner.py` — `+285 lines`: added `_compute_derived_trade_metrics` (B-01 path b), `_compute_volume_aggregator` (METRICS-09), `_compute_trade_mix` (METRICS-10 — 4-bucket / 2-bucket branching). Top-of-file `import math` and `from collections import defaultdict` added.
- `analytics-service/services/position_reconstruction.py` — `+33 lines`: extended `reconstruct_positions` return dict with 5 new keys (avg_winning_trade, avg_losing_trade, winners_count, losers_count, realized_pnl_per_trade) feeding the derived-metric function. Strictly additive — every legacy key preserved.
- `analytics-service/tests/test_analytics_runner.py` — `+316 lines`: 14 RED-then-GREEN tests:
  - 6 tests for `_compute_derived_trade_metrics` (expectancy, R:R, weighted R:R, SQN, segmented profit factor, empty-position graceful)
  - 3 tests for `_compute_volume_aggregator` (key presence, empty fills, computed values)
  - 5 tests for `_compute_trade_mix` (4-bucket, 2-bucket, empty fills, missing-flag skip, avg holding period)

## Decisions Made

- **B-01 path (b) — NEW function, not extension**: Per 12-REVIEWS.md path (b), derived trade metrics live in their own function that consumes BOTH dicts. The `volume_metrics` arg is currently kept in the signature for path-(b) contract compatibility (assigned to `_`) — Plan 12-06's orchestrator wiring will call this with both dicts even though Phase 12's current derivation only reads the position-side primitives.
- **Profit factor returns None on zero divisor**: The frozen TradeMetrics contract uses `profit_factor_long: number | null` precisely so the UI can render "—" when there's no loss to divide by. Returning 0.0 would imply "zero profit factor" (a measured outcome); returning +Infinity would break JSONB serialization. None is the correct semantics.
- **Inline fixtures over conftest changes**: `sample_fills` and `sample_fills_with_maker_taker` declared inside `test_analytics_runner.py` rather than touching the global `analytics-service/tests/conftest.py`. Matches Plan 12-04's pattern — keeps the change scoped and follows existing module-local-fixture conventions.
- **Locked numeric values in tests**: rather than only structural assertions (`"foo" in result`), every test pins exact numeric outcomes (gross=5000, daily=5000/3, etc.). Plan 12-09's parity gate diffs Python output against TS output byte-by-byte; concrete reference values eliminate ambiguity in the diff.
- **Augmentation tests beyond the plan's stated coverage**: 4 extra tests (empty volume aggregator, computed numeric values, missing-flag skip, computed avg_holding_period_hours) lock every threat-model mitigation in the plan's `<threat_model>` block. None of these are scope creep — they cover behaviors the plan documented but didn't test.

## Deviations from Plan

### Auto-fixed Issues

None — the plan's RED-snippet pseudocode and GREEN-snippet pseudocode landed essentially verbatim. The fixture-source tweak (inline vs conftest) is documented as a key decision (Plan 12-04 established that pattern; this plan continues it) rather than a deviation, since the plan said "Add a fixture in `tests/conftest.py` (or in test_analytics_runner.py if conftest is global)" — the alternative path was explicitly sanctioned.

The plan's Step 2 GREEN docstring for `_compute_derived_trade_metrics` listed `volume_metrics` as accepted but unused in the current pure derivation; I retained that arg in the signature (assigned to `_`) for path-(b) contract compatibility per the plan's explicit B-01 architecture statement.

### Plan-as-drafted vs final convergence

The plan included a working RED snippet (lines 130-237) and a working GREEN snippet (lines 251-342) for Task 1, plus a working RED snippet (lines 388-429) and GREEN snippet (lines 442-535) for Task 2. The shipped code matches those snippets line-by-line modulo the inline-fixture reorganization and the explicit threat-model mitigations expanded into runtime guards (T-12-05-03 in `_profit_factor`, T-12-05-04 in `_compute_trade_mix`).

---

**Total deviations:** 0 (plan executed exactly as drafted; key decisions augment but don't replace)
**Impact on plan:** All 10 acceptance criteria pass first-try; 14 RED-then-GREEN tests pass; 102 / 102 across related suites; 584 / 584 across the full analytics-service suite (excluding pre-existing `test_drain_100_jobs` in deferred-items.md).

## Issues Encountered

- **Pre-existing test failure (out of scope):** `tests/test_worker_load.py::TestWorkerLoadDrain::test_drain_100_jobs` fails on `feature/v0.17-sprint-12` — verified pre-existing in Plan 12-04. Logged in `.planning/phases/12-backend-metric-contracts/deferred-items.md` for triage in v0.17.1. Per SCOPE BOUNDARY rule, did not attempt to fix.

## Verification

```bash
$ cd analytics-service && python3 -m pytest tests/test_analytics_runner.py -k "derived_trade_metrics or volume_aggregator or trade_mix" -x
14 passed, 2 deselected in 1.22s

$ cd analytics-service && python3 -m pytest tests/test_analytics_runner.py tests/test_position_reconstruction.py tests/test_position_reconstruction_edges.py tests/test_position_reconstruction_funding.py tests/test_metrics.py
102 passed in 1.54s

$ cd analytics-service && python3 -m pytest tests/
584 passed, 5 skipped, 1 failed (pre-existing test_drain_100_jobs — unrelated, logged in deferred-items.md)
```

## Acceptance Criteria

| Plan AC | Status |
|---------|--------|
| `grep -q "def _compute_derived_trade_metrics" analytics-service/services/analytics_runner.py` | OK |
| All 6 derived metric keys present (expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, profit_factor_long, profit_factor_short) | OK |
| `grep -q "import math" analytics-service/services/analytics_runner.py` | OK |
| `grep -q "avg_winning_trade" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "realized_pnl_per_trade" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "winners_count" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "def _compute_volume_aggregator" analytics-service/services/analytics_runner.py` | OK |
| `grep -q "def _compute_trade_mix" analytics-service/services/analytics_runner.py` | OK |
| `grep -q "has_maker_taker" analytics-service/services/analytics_runner.py` | OK |
| 4-bucket keys present (long_maker / long_taker / short_maker / short_taker) | OK |
| All 14 unit tests pass (6 derived + 3 volume + 5 trade mix) | OK |

## TDD Gate Compliance

Plan-level type: `tdd`. Both tasks followed RED → GREEN cycle:

- **Task 1**: `d20fe09` (RED test commit) → `425bce0` (GREEN feat commit). RED confirmed via `ImportError`.
- **Task 2**: `65f2418` (RED test commit) → `512c6f6` (GREEN feat commit). RED confirmed via `ImportError`.

REFACTOR phase not needed — the GREEN implementations are minimal, idiomatic, and mirror the plan's snippet pseudocode line-by-line modulo the inline-fixture organizational choice.

## Threat Surface Scan

Threat-model items in the plan all have on-code mitigations:

- **T-12-05-01 (Bucket count drift between Plan 01 audit and aggregator)** — mitigated: `has_maker_taker` is an explicit boolean parameter on `_compute_trade_mix`; Plan 12-10 deploy script reads `TRADE_MIX_HAS_MAKER_TAKER` from TODOS.md and writes to env; Plan 12-09 parity test catches mismatch (expected JSON has correct bucket count).
- **T-12-05-02 (PF computation discloses position sizes via division)** — accepted: PF is a dimensionless ratio; original aggregates already exposed; no new attack surface.
- **T-12-05-03 (Pathological fills → division by zero)** — mitigated at code: `_profit_factor` explicit `if gl == 0: return None`; weighted R:R guards `den > 0`; SQN guards `std_r > 0` and `risk_unit > 0`. Downstream renders None as "—" per frozen TradeMetrics `number | null` contract.
- **T-12-05-04 (Fill missing `is_maker` in 4-bucket mode)** — mitigated at code: `if is_maker is None: continue` in 4-bucket branch with regression test `test_trade_mix_4_bucket_skips_fills_missing_is_maker` locking the behavior.

No new threat flags introduced.

## User Setup Required

None — no external service configuration. The `TRADE_MIX_HAS_MAKER_TAKER` env var consumed by `_compute_trade_mix` is set by Plan 12-10's deploy script (reads it from TODOS.md). Plan 12-06 orchestrator wiring will read the env var and pass it through.

## Next Phase Readiness

- **Plan 12-06 (orchestrator wiring) is unblocked** — all 4 helpers it needs from this plan are now shipped:
  1. `_compute_volume_metrics(fills)` (existing, untouched)
  2. `reconstruct_positions(strategy_id, supabase)` (extended with 5 new keys)
  3. `_compute_volume_aggregator(fills)` (new — METRICS-09)
  4. `_compute_trade_mix(fills, has_maker_taker)` (new — METRICS-10)
  5. `_compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions)` (new — METRICS-07 + METRICS-08)
- **Plan 12-09 (sibling-table parity test) is unblocked** — Plan 12-04 + Plan 12-05 together produce every `metrics_json` key and every `trade_metrics` field that the parity gate diffs.
- **Plan 12-10 (deploy script) is informed** — its TRADE_MIX_HAS_MAKER_TAKER propagation hook now has a concrete consumer (Plan 12-06's orchestrator).

## Self-Check: PASSED

Verified post-write:

```bash
$ [ -f "analytics-service/services/analytics_runner.py" ] && grep -qE "def _compute_derived_trade_metrics|def _compute_volume_aggregator|def _compute_trade_mix" analytics-service/services/analytics_runner.py && echo OK
OK

$ [ -f "analytics-service/services/position_reconstruction.py" ] && grep -qE "avg_winning_trade|realized_pnl_per_trade|winners_count" analytics-service/services/position_reconstruction.py && echo OK
OK

$ git log --oneline -5 | grep -E "^(d20fe09|425bce0|65f2418|512c6f6)"
512c6f6 feat(12-05): implement volume aggregator + audit-gated trade mix (GREEN)
65f2418 test(12-05): add failing tests for volume aggregator + trade mix (RED)
425bce0 feat(12-05): add _compute_derived_trade_metrics + extend reconstruct_positions for B-01 path (b) + Weighted R:R per H-F (GREEN)
d20fe09 test(12-05): add failing tests for _compute_derived_trade_metrics — B-01 path (b) + H-F (RED)
```

All commits exist; all 10 acceptance criteria pass; all 14 plan-target tests pass GREEN; no out-of-scope work performed.

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
