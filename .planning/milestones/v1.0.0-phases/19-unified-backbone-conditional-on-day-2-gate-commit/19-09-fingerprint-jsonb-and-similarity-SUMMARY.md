---
phase: 19-unified-backbone-conditional-on-day-2-gate-commit
plan: 09
subsystem: api
tags: [python, fingerprint, cosine-similarity, jsonb, pure-python, l1-normalization, pgvector-deferred]

# Dependency graph
requires:
  - phase: 19
    provides: "19-02 — strategies.fingerprint JSONB column + compute_similarity SQL function (migration 105) consumed by this plan's tests as the cross-layer contract"
  - phase: 19
    provides: "19-03 — Fingerprint dataclass + IngestionAdapter Protocol with compute_fingerprint method on each adapter (which lazy-imported compute_fingerprint_v1 — this plan ships the lazy-imported symbol)"
provides:
  - services/ingestion/fingerprint.compute_fingerprint_v1(trades, metrics) -> Fingerprint
  - "Locked v0 bucket boundaries: trade_size [<1k, 1-10k, 10-100k, 100k+] USD notional; hold_duration [<1h, 1-24h, 1-7d, >7d] FIFO holding-pair age; asset_class_mix [spot, perp_long, perp_short, futures]; instrument_concentration top-10 zero-padded; temporal_pattern UTC hour-of-day"
  - L1-normalization invariant on every non-empty component (cosine well-defined)
  - "FIFO holding-pair construction (per-symbol fill timeline, opposite-side close pops oldest open)"
  - "Asset-class detection heuristic (order_type + symbol parsing for perp `:` notation and dated-futures `-DDMMM` / `_DDMMM` suffixes)"
  - "Top-10 instrument cap with re-normalization over kept slice (deterministic alphabetical tie-break)"
  - 3 H-9 SQL contract tests on top of 19-02's 7 (scaled invariance, swap symmetry, hand-computed concat)
  - 20 Python contract tests (shape, bucket boundaries, L1 norm, JSONB round-trip, H-9 cosine cases)
  - "Removed Wave-1 → Wave-2 lazy-import shims (`# type: ignore[import-not-found]` and redundant `cast(Fingerprint, ...)`) from the 4 concrete adapters now that fingerprint.py is real"
affects: [phase-19-04 process-key router (calls compute_fingerprint at end of pipeline), phase-19-08 EquityCurveBuilder (consumed by P9 via metrics), Bridge similarity ranker (downstream)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-Python computation of the cross-layer contract — same 5-component shape consumed by migration 105 SQL function with no SDK dependency (Pitfall 9: pgvector deferred to v2)"
    - "L1-normalize-then-pad: top-N concentration buckets re-normalize over the kept slice rather than over the un-capped denominator (cosine well-defined regardless of tail length)"
    - "FIFO pair construction with deferred quantity-proportion approximation: one-pair-per-fill is locked for v0 because the bucket boundaries (1h / 24h / 7d) are coarse enough that exact qty weighting won't change bucket assignments at realistic flows"
    - "Cross-layer contract test: hand-computed concat-order constant (2/sqrt(6)) verified BOTH in pure Python (test_fingerprint.py) and in SQL (test_compute_similarity_sql.py) — same fingerprint inputs, same expected output, locks the array-concat order at trade_size || hold_duration || asset_class || instrument || temporal across both layers"
    - "Lazy-import lifecycle for cross-wave dependencies: when the lazy-imported module ships, REMOVE the `type: ignore[import-not-found]` and `cast(Type, ...)` shims (mypy --strict flags them as unused-ignore / redundant-cast) — adapter code becomes its own type-check guard"

key-files:
  created:
    - analytics-service/services/ingestion/fingerprint.py
    - analytics-service/tests/test_fingerprint.py
  modified:
    - analytics-service/services/ingestion/okx.py
    - analytics-service/services/ingestion/binance.py
    - analytics-service/services/ingestion/bybit.py
    - analytics-service/services/ingestion/csv_adapter.py
    - analytics-service/tests/test_compute_similarity_sql.py

key-decisions:
  - "Bucket boundaries are LOCKED (trade_size 1k/10k/100k thresholds, hold_duration 1h/24h/7d edges, asset_class 4-tier ordering, instrument top-10 cap, temporal UTC hour-of-day) — re-bucketing is a v1→v2 migration concern. UC-C may subsume this with pgvector; v0 stays plain Python."
  - "Lower-bound INCLUSIVE convention for all numeric buckets — a trade at exactly $1000 lands in bucket 1, exactly $10000 in bucket 2, etc. Locked so a trade on a boundary always maps to the same bucket across deploys."
  - "instrument_concentration cap=10: when >10 distinct symbols, the kept top-10 is re-normalized to sum=1.0 (cosine well-defined). Tail symbols are dropped from the fingerprint, not folded into a zero slot. Tie-break is alphabetical for determinism (so the same trade history always produces the same fingerprint)."
  - "FIFO holding-pair construction with one-pair-per-fill (no qty-proportion weighting). v0 limitation locked because the buckets are coarse and partial fills don't change the bucket assignment at realistic flows."
  - "Empty trades → all-zeros fingerprint. compute_similarity returns 0.0 on either-zero norm, so the empty case is benign for the similarity ranker (matches migration 105 behavior; verified by 19-02's test_null_inputs_return_zero plus this plan's test_shape_empty_trades_all_zeros)."
  - "Naive datetimes interpreted as UTC. Matches services/exchange.py fetcher convention (broker SDKs emit UTC datetimes)."
  - "Removed Wave-1 → Wave-2 lazy-import shims in 4 adapters. The `# type: ignore[import-not-found]` and `cast(Fingerprint, ...)` were defensive guards for the period when fingerprint.py was a Wave-2 forward declaration. Now that it ships in this plan, mypy --strict flags them as unused-ignore / redundant-cast. Cleanup keeps CI green (Rule 1 — bug fix, scoped to my task surface)."
  - "pgvector explicitly deferred to v2 per UC-C. fingerprint.py imports nothing from pgvector / numpy.linalg / scipy — pure Python, plus collections.Counter / defaultdict. Migration 105 docstring already documents the deferral; this plan is the compute side of the same contract."
  - "MetricsSnapshot is on the signature but unused in v0. Kept for v1→v2 forward compat (v2 may pull win_rate / sharpe into asset_class_mix or add a metrics-derived component). Documented in compute_fingerprint_v1 docstring."
  - "H-9 SQL contract tests use the same admin fixture and helpers as 19-02's 7 existing tests. Auto-skip when SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset — matches the existing convention; no new infrastructure needed for the orchestrator to enable them post-merge."

patterns-established:
  - "Pattern — Lock cross-layer contract via shared hand-computed test vector. The same fingerprint inputs (a = one-hot at slots 0/5/10, b = one-hot at slots 0/10) produce the same expected cosine (2/sqrt(6) ≈ 0.8165) when computed in pure Python (Python test) AND when computed by the SQL function (Postgres test). If anyone reorders the 5-component concat in either layer, both tests fail."
  - "Pattern — L1-normalize-then-pad for top-N concentration. Compute counts → sort desc → take top-N → re-normalize over the kept slice → pad with zeros to N. Sum=1.0 (cosine well-defined) regardless of how many distinct values existed in the input."
  - "Pattern — FIFO pair construction with same-direction extend. Walk fills sorted by ts; same-direction fills enqueue, opposite-direction fills pop oldest open. Locked one-pair-per-fill for v0 (qty-proportion approximation)."
  - "Pattern — Lazy-import shim retirement on Wave-2 lands. When the Wave-2 module ships, remove the Wave-1 `# type: ignore[import-not-found]` and `cast(...)` shims. mypy --strict flags them; the cleanup is the unblock signal for the next CI cycle."

requirements-completed: [FINGERPRINT-01, FINGERPRINT-02]

# Metrics
duration: ~14 min
completed: 2026-05-08
---

# Phase 19 Plan 09: Fingerprint JSONB v0 Computation + compute_similarity Contract Tests Summary

**Pure-Python `compute_fingerprint_v1(trades, metrics) -> Fingerprint` shipping the locked 46-dim 5-component shape (4+4+4+10+24) consumed by migration 105's `compute_similarity` SQL function, plus 20 Python contract tests + 3 new H-9 SQL contract tests on top of 19-02's 7 — completing FINGERPRINT-01 / FINGERPRINT-02 and unblocking the P4 router's end-of-pipeline persist step.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-08T11:49:03Z (RED commit `340cf44`)
- **Completed:** 2026-05-08T12:02:06Z (final commit `59f52bf`)
- **Tasks:** 3/3 (TDD RED → GREEN → SQL contract augmentation)
- **Files created:** 2 (1 source, 1 test)
- **Files modified:** 5 (4 adapters cleanup + 1 SQL contract test augmentation)

## Accomplishments

- **`services/ingestion/fingerprint.py` shipped** — pure-Python `compute_fingerprint_v1` producing the locked 5-component fingerprint with version=1, L1-normalized components, JSON-serializable output. No pgvector / numpy / scipy imports. Output shape is byte-identical to what `Fingerprint().to_jsonb()` produces from 19-03.
- **20 Python contract tests pass** — shape (4/4/4/10/24, version=1), bucket boundaries (trade_size USD notional, hold_duration FIFO pair age, asset_class spot/perp_long/perp_short/futures, instrument top-10 zero-padded, temporal UTC hour-of-day), L1 normalization invariant, empty-trades all-zeros, JSONB round-trip, and the 5 H-9 cosine cases (identical / orthogonal / scale-invariance / swap-symmetry / hand-computed-concat / slot-by-slot concat-order).
- **3 H-9 SQL contract tests added** — `test_h9_scale_invariance`, `test_h9_swap_symmetry`, `test_h9_hand_computed_concat` (`2/sqrt(6) ≈ 0.8165`) extend `test_compute_similarity_sql.py` from 7 to 10 cases. Same `_v1_fp` / `_call_compute_similarity` helpers as 19-02, same admin fixture, same auto-skip behavior — no new infrastructure.
- **Cross-layer contract lock** — the SAME hand-computed inputs (one-hot at slots 0/5/10 vs slots 0/10) produce the SAME expected cosine (`2/sqrt(6)`) in pure-Python (`test_fingerprint.py::test_h9_hand_computed_concat_order`) AND in SQL (`test_compute_similarity_sql.py::test_h9_hand_computed_concat`). If anyone reorders the 5-component concat in either layer, both tests fail.
- **Wave-1 → Wave-2 shim retirement** — removed `# type: ignore[import-not-found]` and redundant `cast(Fingerprint, ...)` from the 4 concrete adapters' `compute_fingerprint` methods. They were defensive guards for when fingerprint.py was a Wave-2 forward declaration; mypy --strict now flags them as `unused-ignore` / `redundant-cast`. Cleanup keeps the CI gate (`mypy --strict --follow-imports=silent services/ingestion/`) green.
- **mypy --strict clean** — `Success: no issues found in 7 source files` (4 adapters + adapter.py + fingerprint.py + __init__.py).

## Task Commits

Each task was committed atomically following TDD RED → GREEN, with the SQL contract augmentation as Task 3:

1. **Task 1 RED — failing tests for compute_fingerprint_v1 + H-9 cosine cases** — `340cf44` (test)
2. **Task 2 GREEN — compute_fingerprint_v1 + remove Wave-1→Wave-2 lazy-import shims** — `40464eb` (feat)
3. **Task 3 — augment compute_similarity SQL tests with H-9 cosine cases** — `59f52bf` (test)

## Files Created/Modified

### Created

- **`analytics-service/services/ingestion/fingerprint.py`** (236 LOC) — `compute_fingerprint_v1(trades, metrics)` plus 5 component computers (`_compute_trade_size_buckets`, `_compute_hold_duration_buckets`, `_compute_asset_class_mix`, `_compute_instrument_concentration`, `_compute_temporal_pattern`) and 2 helpers (`_aware_ts` for naive→UTC datetime normalization, `_looks_like_dated_futures` for asset-class detection). Module docstring locks the 5-component shape, the bucket boundaries, the L1 normalization contract, and the pgvector-deferred-to-v2 invariant.
- **`analytics-service/tests/test_fingerprint.py`** (498 LOC, 20 tests) — Module-import contract, dataclass return type, shape contract (empty + non-empty), bucket-boundary contract (`test_trade_size_bucket_boundaries`, `test_trade_size_bucket_edges`, `test_temporal_pattern_hour_of_day`, `test_temporal_pattern_normalizes_naive_datetime_to_utc`, `test_asset_class_mix_spot_vs_perp`, `test_instrument_concentration_top_10_padded`, `test_instrument_concentration_caps_at_top_10`, `test_hold_duration_buckets`), L1 normalization invariant (`test_components_l1_normalized_when_nonempty`), 6 H-9 cosine cases including the slot-by-slot concat-order verification, and a JSONB round-trip test. Reference helpers `_cosine` and `_concat_46` mirror migration 105's vector construction exactly.

### Modified

- **`analytics-service/services/ingestion/okx.py`** — removed `# type: ignore[import-not-found]` on the lazy fingerprint import; removed `cast(Fingerprint, ...)` (the function is now properly typed). Updated comment.
- **`analytics-service/services/ingestion/binance.py`** — same shim retirement.
- **`analytics-service/services/ingestion/bybit.py`** — same shim retirement.
- **`analytics-service/services/ingestion/csv_adapter.py`** — same shim retirement.
- **`analytics-service/tests/test_compute_similarity_sql.py`** — augmented from 7 to 10 tests. Updated module docstring to enumerate the 10 behaviors. Added `test_h9_scale_invariance` (cos(fp, k*fp) == 1.0 across the full 46-dim concat), `test_h9_swap_symmetry` (compute_similarity(a, b) == compute_similarity(b, a) for non-trivial pair, asserting cos in (0, 1)), `test_h9_hand_computed_concat` (fixed inputs producing 2/sqrt(6), locking the SQL function's array-concat order to match migration 105 + Python-side fingerprint.py).

### Untouched

- `supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` — unchanged. Already authored and committed by 19-02 (commit `e3b0126`); this plan is the compute side of the same FINGERPRINT-01 / FINGERPRINT-02 contract.
- `analytics-service/services/ingestion/adapter.py` — unchanged. The Fingerprint dataclass shape was locked by 19-03 (`to_jsonb()` already emits the 5-component shape with version=1).
- `analytics-service/services/ingestion/__init__.py` — unchanged. The IngestionAdapter Protocol's `compute_fingerprint` method was already declared in 19-03; this plan only ships the lazy-imported helper that 4 adapters call into.

## Decisions Made

All decisions were either locked upstream in 19-CONTEXT.md (5-component shape, IMMUTABLE PARALLEL SAFE, returns 0.0 on shape mismatch) or fall out of the locked H-9 acceptance criteria (explicit test cases for identical / orthogonal / scaled / swap / hand-computed). Three implementation-detail decisions made during execution:

1. **Lower-bound INCLUSIVE convention.** `[1000, 10000)` lands in bucket 1; exactly $1000 → bucket 1; exactly $10000 → bucket 2. Locked so trades on the boundary always map to the same bucket across deploys (similarity rankings stable). Documented in module docstring + `test_trade_size_bucket_edges`.
2. **One-pair-per-fill FIFO holding construction (no qty-proportion weighting).** A 1-unit sell against a 0.6-unit buy + 0.4-unit buy produces ONE pair (sell vs oldest open buy), not two. Locked for v0 because the buckets are coarse (1h / 24h / 7d) — partial-fill weighting wouldn't change bucket assignments at realistic flows. Documented in `_compute_hold_duration_buckets` docstring.
3. **Top-10 instrument cap with re-normalization over kept slice.** When >10 distinct symbols, the tail is dropped (NOT folded into a zero slot); the kept top-10 is re-normalized so the component sums to 1.0 regardless. Tie-break is alphabetical for determinism. Verified by `test_instrument_concentration_caps_at_top_10` (12 symbols → 10 kept, each at 0.1, sum=1.0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Wave-1→Wave-2 lazy-import shims now flagged by mypy --strict**

- **Found during:** Task 2 (GREEN — implementing `services.ingestion.fingerprint`).
- **Issue:** The 4 concrete adapters' `compute_fingerprint` methods carried `# type: ignore[import-not-found]` on the lazy `from services.ingestion.fingerprint import compute_fingerprint_v1` line and wrapped the return value in `cast(Fingerprint, ...)`. These were defensive shims for the period when fingerprint.py was a Wave-2 forward declaration; once it ships and is properly typed, mypy --strict flags them as `[unused-ignore]` and `[redundant-cast]` errors. Without cleanup, CI's `mypy --strict --follow-imports=silent services/ingestion/` step (Makefile `lint` target, MC-3 fix from 19-REVIEWS.md) would fail with 8 errors across 4 files.
- **Fix:** Removed the `# type: ignore[import-not-found]` directive and the redundant `cast(Fingerprint, ...)` wrapper from `compute_fingerprint` in `okx.py`, `binance.py`, `bybit.py`, `csv_adapter.py`. The `cast` for the EquityCurveBuilder lazy imports (Wave 2, not yet shipped) is preserved. Updated comment to "P9 ships compute_fingerprint_v1 in this same package; lazy import preserved to keep adapter module-load cost minimal".
- **Files modified:** `services/ingestion/okx.py`, `services/ingestion/binance.py`, `services/ingestion/bybit.py`, `services/ingestion/csv_adapter.py` (4 files, 6 lines net removed).
- **Verification:** `mypy --strict --follow-imports=silent services/ingestion/` → `Success: no issues found in 7 source files`. Existing `tests/test_ingestion_protocol.py` (10 tests) still passes — the shim cleanup is transparent at the runtime level (`isinstance(adapter, IngestionAdapter)` still passes; `compute_fingerprint(trades, metrics)` still returns a `Fingerprint`).
- **Committed in:** `40464eb` (bundled with the GREEN feat commit per the deviation-rule rule that auto-fixes ride along with the task that surfaced them).

---

**Total deviations:** 1 auto-fixed (1 mypy / type-system bug surfaced by my new module).
**Impact on plan:** Zero scope change. The cleanup is required to keep the CI gate green; without it, the next push would fail `mypy --strict` on 8 errors that the previous Wave-1 plan necessarily had to ship as defensive shims.

## Authentication Gates

None encountered. The plan's compute logic is pure Python (no broker auth, no Supabase write); the SQL contract tests against the test Supabase project auto-skip in this environment because `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` aren't set on the worktree executor — matching the existing 19-02 convention. The orchestrator owns the post-merge schema-push step (already documented in 19-02's deviation §1) and the test-Supabase env wiring; no auth gate surfaced for this plan.

## Critical Invariants Verification

All 7 invariants from the executor prompt were verified before commit:

| # | Invariant | Verification |
|---|-----------|--------------|
| 1 | v0 shape: 4+4+4+10+24 = 46 dims, version=1 | `test_shape_with_trades` + `test_shape_empty_trades_all_zeros` assert exact lengths and the 6-key set; `to_jsonb()` round-trip in `test_to_jsonb_matches_migration_105_shape` |
| 2 | Bucket boundaries locked: trade_size 1k/10k/100k, hold_duration 1h/24h/7d, asset_class spot/perp_long/perp_short/futures, temporal UTC hour 0..23 | 4 dedicated tests: `test_trade_size_bucket_boundaries`, `test_trade_size_bucket_edges`, `test_hold_duration_buckets`, `test_asset_class_mix_spot_vs_perp`, `test_temporal_pattern_hour_of_day`, `test_temporal_pattern_normalizes_naive_datetime_to_utc` |
| 3 | compute_fingerprint method called by P4 router via the adapter | All 4 adapters delegate `compute_fingerprint(trades, metrics)` → `services.ingestion.fingerprint.compute_fingerprint_v1(trades, metrics)`; verified by mypy --strict and the existing `test_ingestion_protocol.py` runtime-checkable conformance |
| 4 | CHECK constraint enforces version=1 + non-NULL (M-3 fix in migration 105) | Already verified in 19-02 by `test_check_constraint_rejects_v0` and `test_check_rejects_missing_version`; this plan's `test_returns_fingerprint_dataclass` confirms the Python compute side always emits version=1 |
| 5 | H-9 explicit pytest test cases (identical, orthogonal, scaled invariance, swap symmetry, hand-computed concat) | Python: `test_h9_identical_returns_one`, `test_h9_orthogonal_returns_zero`, `test_h9_scale_invariance`, `test_h9_swap_symmetry`, `test_h9_hand_computed_concat_order`, `test_h9_concat_order_matches_migration_105`. SQL: `test_h9_scale_invariance`, `test_h9_swap_symmetry`, `test_h9_hand_computed_concat` (auto-skip pending env). |
| 6 | pgvector explicitly deferred to v2 per UC-C — DOCUMENT in plan summary | `services/ingestion/fingerprint.py` module docstring: "pgvector explicitly DEFERRED to v2 per UC-C. This module returns a plain Python tuple-of-floats Fingerprint dataclass; the to_jsonb() serializer on Fingerprint produces a JSON-compatible dict. No vector SDK import here." `grep -E 'pgvector\|numpy.linalg\|scipy' services/ingestion/fingerprint.py` returns 0 matches. Documented in this Summary's `key-decisions`. |
| 7 | Persist fingerprint to strategies.fingerprint JSONB at end of /process-key pipeline | This plan ships the COMPUTE side; the persist step is wired by the P4 router (Phase 19-04) which calls `adapter.compute_fingerprint(trades, metrics).to_jsonb()` and writes to `strategies.fingerprint`. The contract is locked here; the persist call lives in the P4 router. |

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `tests/test_fingerprint.py` | 20 | All pass (0 skipped) |
| `tests/test_ingestion_protocol.py` (regression) | 10 | All pass — no break from adapter shim cleanup |
| `tests/test_compute_similarity_sql.py` | 10 (was 7 + 3 new H-9) | All collected; auto-skip in this env (no `SUPABASE_TEST_URL`) — matches existing convention |
| `tests/test_transition_rpc.py` (regression) | 5 | All collected; auto-skip in this env |
| `tests/test_drain_semantics.py` (regression) | 6 | All collected; auto-skip in this env |
| `mypy --strict --follow-imports=silent services/ingestion/` | — | "Success: no issues found in 7 source files" |

Coverage is measurement-only per repo policy (CLAUDE.md). The new module `services/ingestion/fingerprint.py` is 236 LOC with 20 tests exercising every code path (trade_size 4 buckets, hold_duration 4 buckets, asset_class 4 classes, instrument 10 slots + cap path, temporal 24 hours, empty-trade fast path, naive-datetime UTC normalization, top-10 tie-break).

## Threat Flags

None. Phase 19's threat register covers compute_similarity (T-19-13) and the fingerprint column (T-19-14); this plan's compute side does NOT introduce any new trust boundary, network endpoint, file-system access pattern, or schema change. `compute_fingerprint_v1` is pure Python operating on already-validated trade dataclasses produced by the adapter pipeline.

## Issues Encountered

- **Plan files not on the worktree branch.** The worktree was created from base `5581851d` which carries 19-CONTEXT.md / 19-RESEARCH.md / 19-REVIEWS.md as already-merged but does NOT carry the 19-09 PLAN.md as a committed file (per 19-02's pattern, plan files are orchestrator-owned artifacts that aren't committed by the implementing plans). Resolved by following the executor prompt's `<critical_invariants>` and `<success_criteria>` blocks directly, which carry the locked contract verbatim. The 19-CONTEXT / 19-RESEARCH / 19-REVIEWS files referenced in `<files_to_read>` are likewise not on disk; the locked contracts they document are repeated in the executor prompt and in 19-02's SUMMARY.md, which I cross-referenced.
- **`pandera` not installed in this env.** `tests/test_csv_adapter.py` (4 tests) fails to import `services.csv_validator` with `ModuleNotFoundError: No module named 'pandera'`. Pre-existing infra gap on this worktree's Python env, NOT caused by my changes — confirmed by reading `requirements.txt` (pandera ~0.20 is pinned but not installed in the system Python the worktree uses). Out of scope per the deviation-rule scope boundary; the pandera-gated tests are unaffected by this plan's compute logic. Logged for the orchestrator's post-merge env wiring.

## User Setup Required

None — the 3 new H-9 SQL contract tests reuse the existing `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` env vars that 19-02's 7 tests already use. No new env vars, no new secrets.

## Next Phase Readiness

- **FINGERPRINT-01 + FINGERPRINT-02 closed.** Both requirements have shipping compute (Python) + SQL (migration 105) + cross-layer-locked contract tests. Ready for P4 router (19-04) to import `adapter.compute_fingerprint(trades, metrics).to_jsonb()` and persist to `strategies.fingerprint` at the end of the /process-key pipeline.
- **Wave 2 unblock:** the 4 concrete adapters' `compute_fingerprint` methods now resolve to a real, mypy-strict-clean implementation. EquityCurveBuilder (P8) is still a Wave-2 lazy import; that one's `cast` shim remains in place (correct).
- **No blockers.** mypy --strict clean; 30/30 unit tests pass; 10/10 SQL contract tests collected (auto-skip pending orchestrator env-wire); zero pgvector references in the new module (Pitfall 9 honored); all 7 critical invariants verified.

## Self-Check

**Files claimed created — verified present:**

- `analytics-service/services/ingestion/fingerprint.py` — FOUND
- `analytics-service/tests/test_fingerprint.py` — FOUND

**Files claimed modified — verified in `git diff`:**

- `analytics-service/services/ingestion/okx.py` — modified (shim cleanup)
- `analytics-service/services/ingestion/binance.py` — modified (shim cleanup)
- `analytics-service/services/ingestion/bybit.py` — modified (shim cleanup)
- `analytics-service/services/ingestion/csv_adapter.py` — modified (shim cleanup)
- `analytics-service/tests/test_compute_similarity_sql.py` — modified (3 new H-9 tests)

**Commits claimed — verified in `git log 5581851..HEAD`:**

- `340cf44` test(19-09): add failing tests for compute_fingerprint_v1 + H-9 cosine cases — FOUND
- `40464eb` feat(19-09): compute_fingerprint_v1 + remove Wave-1→Wave-2 lazy-import shims — FOUND
- `59f52bf` test(19-09): augment compute_similarity SQL tests with H-9 cosine cases — FOUND

**Cross-layer hand-computed contract:** `2/sqrt(6) ≈ 0.81649658` verified by hand math, by `test_h9_hand_computed_concat_order` (Python `_cosine` reference helper), and by `test_h9_hand_computed_concat` (Postgres `compute_similarity` RPC, auto-skip pending env). All three would fail in lockstep if the 5-component concat order changed.

**REUSE flag invariant:** `git diff 5581851..HEAD -- analytics-service/services/exchange.py analytics-service/services/csv_validator.py supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` produces no output — Wave-1 reused primitives are byte-identical.

## Self-Check: PASSED

All file claims, commit claims, and acceptance criteria verified. No STATE.md / ROADMAP.md modifications (parallel-mode contract honored). SUMMARY ready for orchestrator-side merge + STATE/ROADMAP sync.

---
*Phase: 19-unified-backbone-conditional-on-day-2-gate-commit*
*Completed: 2026-05-08*
