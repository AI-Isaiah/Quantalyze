# Phase 105: Composite → the one CSV finalize route - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 8 (4 source MODIFY + 4 test MODIFY/CREATE)
**Analogs found:** 8 / 8 (all in-repo; this is a refactor phase — the closest analog for every change is an EXISTING pattern in the same or a sibling file)

> Phase 105 creates **no new source files**. Every change is a MODIFY of an existing module, and the best pattern to copy is almost always the additive-param / shared-route precedent already living in that file (Phase 103/104 laid the rails). Onboarding files (`routers/process_key.py`) are CARVED to 105.1 (D2) and deliberately NOT mapped here.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/basis_series.py` (MODIFY) | service (shared derive route) | transform | Phase-104 additive `benchmark_symbol` kwarg + `_PAYLOAD_SCHEMA_VERSION`, SAME file :131/:186/:84 | exact (self-precedent) |
| `analytics-service/services/job_worker.py` (MODIFY) | service (worker/finalize) | batch / event-driven | Phase-103 MTM shared-route arm `:4382-4418`, F-1 backstop `:4204-4231`, `_reconcile_full_delete` `:4466-4492`, SAME file | exact (self-precedent) |
| `analytics-service/services/analytics_runner.py` (MODIFY) | service (single-key runner) | transform | The venue-agnostic denominator + broker-NaN-reinstate block `:2272-2324`, SAME file | exact (self-precedent) |
| `src/lib/factsheet/composite-read-path.ts` (MODIFY) | reader/util | request-response | `shouldReadSingleKeyMtmSeries` `:401-416` + `readMtmSeries` `:94-114` | exact (sibling predicate) |
| `analytics-service/tests/test_basis_series.py` (MODIFY) | test (unit + round-trip guard) | transform | `_roundtrip_recompute` `:73-90` + additive-kwarg tests `:191-223` | exact |
| `analytics-service/tests/test_cash_basis_series_sc4.py` (MODIFY) | test (dual-run SC-4) | transform | `test_sc4_cash_series_dual_run_byte_identity` `:178-225` | exact |
| `analytics-service/tests/test_composite_headline_parity.py` (MODIFY) | test (dual-run) | transform | this file (extend for composite cash byte-identity) | role-match |
| `analytics-service/tests/test_stitch_composite_job.py` (MODIFY) | test (unit) | event-driven | this file (extend for #5 periods equality) | role-match |

## Pattern Assignments

### `services/basis_series.py` (service, transform) — the SC-4 core

**Analog:** the Phase-104 additive-kwarg pattern already in THIS file. The `scalar_returns` + `densify_policy` params are byte-for-byte the same "default None → byte-invisible" discipline that `benchmark_symbol` already uses.

**Additive-kwarg signature pattern** (copy from `:124-132`):
```python
def derive_basis_series(
    returns: pd.Series,
    benchmark_rets: pd.Series | None,
    *,
    periods_per_year: int,
    cumulative_method: str,
    day_basis: str,
    benchmark_symbol: str | None = None,   # ← Phase-104 additive precedent to copy
    # ADD: scalar_returns: pd.Series | None = None,
    # ADD: densify_policy: str | None = None,
) -> BasisSeriesResult:
```

**Scalar-input decouple** — today the scalar is forced from the sparse rows (`:155-162`). This is the line the `scalar_returns` param overrides (default preserves MTM byte-identity):
```python
sparse = _drop_nonfinite(returns).sort_index()   # ROWS: unchanged, honest
# TODAY:
dense = gap_fill_daily_returns(sparse)
metrics = compute_all_metrics(dense, benchmark_rets, periods_per_year=…, …)
# NEW: scalar_input = scalar_returns if scalar_returns is not None else gap_fill_daily_returns(sparse)
```

**Additive-only conventions echo** (copy the exact guard shape from `:186-187`) — `densify_policy` joins `benchmark` as an opt-in key:
```python
if benchmark_symbol is not None:
    conventions["benchmark"] = benchmark_symbol
# ADD (same idempotent additive shape):
# if densify_policy is not None: conventions["densify"] = densify_policy   # "sparse"|"broker_nan"|"zero_fill"
```

**Schema-version discipline for the composite `nan_dates` key** (D1 amendment). The version constant + payload dict are at `:84` and `:245-251`:
```python
_PAYLOAD_SCHEMA_VERSION = 1     # :84  → BUMP to 2 when nan_dates lands
...
payload = {                     # :245-251  → nan_dates is an additive JSONB key (NO DDL)
    "schema": _PAYLOAD_SCHEMA_VERSION,
    "basis": basis,
    "rows": result.series_rows,
    "gap_spans": result.gap_spans,
    "conventions": result.conventions,
    # ADD (composite zero_fill only): "nan_dates": result.nan_dates,
}
```
> `strategy_analytics_series.kind` is unconstrained TEXT and the payload is JSONB — an added key + a version bump is NOT a migration (D5/§specifics: 105 ships no DDL). The `BasisSeriesResult` dataclass (`:87-121`) gains one optional field; add it defaulting to `None`/`[]` exactly as the frozen dataclass style there.

---

### `services/job_worker.py` (service, batch) — composite re-route + `_metrics_result_for` DELETE + #5 + #6 + finalize

**Analog for the re-route:** the Phase-103 MTM arm at `:4382-4418` — the EXACT move (`stitch_clipped_series` → `derive_basis_series` → `dict(result.metrics_json)`) that #1 now applies to CASH.

**MTM shared-route arm to mirror for cash** (`:4389-4418`):
```python
stitched_mtm = stitch_clipped_series(clipped_mtm)
if int(stitched_mtm.notna().sum()) < 2:            # degenerate-length guard (keep the cash twin)
    await _stamp_failed(...); return DispatchResult(...permanent...)
_mtm_basis_result = derive_basis_series(
    stitched_mtm, benchmark_rets,
    periods_per_year=periods_per_year,
    cumulative_method=cumulative_method,
    day_basis=day_basis,
)                                                  # NOTE: MTM omits benchmark_symbol (LOW-2: cash MUST pass "BTC")
mtm_metrics_json = dict(_mtm_basis_result.metrics_json)
```

**The closure to DELETE** (`:4262-4290`) — `_metrics_result_for` + its call. Replace with a `derive_basis_series(scalar_returns=gap_fill_daily_returns(stitched_cash), densify_policy="zero_fill", benchmark_symbol="BTC", …)`. The scalar input `gap_fill_daily_returns(stitched)` is copied verbatim from the closure body (`:4279-4280`) so the scalar is byte-identical by construction. Preserve the F-5 `ValueError` arm (`:4291-4311`) by re-homing it onto `derive_basis_series`'s ValueError (same `except ValueError` shape). **Grep-gate:** `git grep _metrics_result_for` == 0 after.

**#5 periods_per_year collapse — KEEP the fail-loud assert** (D4). The venue-blend selector + F-1 backstop live at `:4199-4231`:
```python
periods_per_year = (                                    # :4199 venue-blend selector → REMOVE as selector
    PERIODS_PER_YEAR_CRYPTO
    if any(v in _COMPOSITE_CRYPTO_VENUES for v in venues)
    else DEFAULT_PERIODS_PER_YEAR
)
_asset_class_periods = periods_per_year_for_asset_class(strat_row.get("asset_class") …)   # :4214 → becomes THE rule
if _asset_class_periods != periods_per_year:            # :4217 → RETAIN as an equivalent sanity assert (D4: do NOT delete)
    await _stamp_failed("… clock disagrees …"); return DispatchResult(...permanent...)
```
Keep `_COMPOSITE_DEGRADE_VENUES` (`:3248`) as the unknown-venue backstop.

**#6 fork-collapse + MED-2** — the denominator resolution is ALREADY branch-outer + venue-agnostic in the composite path (`:3540-3546` parse, `:4234-4239` use). The MED-2 fix = confirm the cash echo mirrors `analytics_runner.py:2304-2316` (venue-agnostic `parse_returns_denominator_config(strat_row[...])`), NOT the deribit-only `:2162` arm. Venue-source forks (`combine_native_ledger` `:2246` / `combine_realized_and_funding` `:2663`) already return byte-identical `(returns, meta)` shape — feed ONE derive.

**Transactional finalize (SC-5, ordered-idempotent, NO DDL)** — analog is the existing persist sequence `:4447-4492`:
```python
await db_execute(_reconcile_full_delete)               # :4481 delete csv_daily_returns (idempotent, whole-strategy)
for _start in range(0, len(rows_payload), _UPSERT_CHUNK):   # :4484 chunked dailies upsert
    await db_execute(_upsert_dailies)
# THEN (D5): persist the cash_settlement SERIES row (single-row atomic RPC) + dailies BEFORE the
#            headline strategy_analytics scalar/status flip LAST → a `complete` scalar never exists
#            without its series. Re-derive is authoritative via _reconcile_full_delete idempotence.
```
Order: series-row RPC + dailies → **then** scalar/status flip last. This is GATED EVENTUAL CONSISTENCY (D5 honest boundary), not atomicity — the transient re-derive window is pre-existing.

---

### `services/analytics_runner.py` (service, transform) — #2 single-key CSV inline swap

**Analog:** the same-file conditioning block `:2272-2324`. The inline `compute_all_metrics` at `:2318` is swapped for `derive_basis_series(scalar_returns=…, densify_policy=…)`.

**Broker-NaN-reinstate vs user-CSV-sparse fork** (`:2272-2277`) — this IS the per-source `scalar_returns` builder (#6 in miniature):
```python
if _is_broker_sourced and not returns.empty:        # broker → dense-reindex, in-span gaps become NaN
    dense_index = pd.date_range(returns.index.min(), returns.index.max(), freq="D")
    returns = returns.reindex(dense_index)
    returns.name = "returns"
# user CSV (api_key_id IS NULL) → returns stays SPARSE (never reindexed)
```
So: `scalar_returns = returns` (broker → NaN-reindexed; user-CSV → sparse verbatim), `densify_policy = "broker_nan" if _is_broker_sourced else "sparse"`.

**Venue-agnostic denominator (MED-2 reference impl)** (`:2299-2324`) — copy this resolution shape into the composite echo:
```python
_periods_per_year = periods_per_year_for_asset_class(_strategy_row.get("asset_class") …)   # #5 the ONE rule
_cumulative_method, _day_basis = "geometric", "calendar"
_denominator_config = parse_returns_denominator_config(_strategy_row.get("returns_denominator_config")) …
if _denominator_config is not None:                 # venue-AGNOSTIC — the MED-2 target
    _cumulative_method = _denominator_config.cumulative_method
    _day_basis = metrics_day_basis(_denominator_config.metrics_basis)
metrics_result = compute_all_metrics(returns, benchmark_rets, …)   # :2318 → derive_basis_series swap
```
User-CSV single-key is the BROADEST SC-4 blast radius (every weekend-spanning CSV) — the `densify_policy="sparse"` path must pass the sparse series unchanged.

---

### `src/lib/factsheet/composite-read-path.ts` (reader, request-response) — MED-1 status-gate

**Analog:** `shouldReadSingleKeyMtmSeries` `:401-416` — the MED-1 cash-series read-gate is its exact twin. The stale-row heal is a **read-side status-gate** (D3 primary), and this predicate is the choke point to mirror.

**The DONE-gate to copy verbatim** (`:405`):
```typescript
const done = computationStatus === "complete" || computationStatus === "complete_with_warnings";
if (!done) return false;                            // ← the MED-1 guarantee: never trust a series row unless status is terminal-success
```

**Degrade-never-throw reader shape** (`:94-114`) — any new cash-series read mirrors `readMtmSeries`: `.maybeSingle()`, log-at-ERROR on `error`, return `null` (charts stay cash), NEVER throw. The by-basis extraction discipline (thread ONLY the intended key, never the raw `metrics_json_by_basis`) is at `:342-385` (`singleKeyBasisOpts`).

> D3 caveat to encode: the 106 cash reader MUST route through this predicate family, and the 105 round-trip guard / dual-run harness must itself respect the gate (skip / expect-absent when status ≠ complete) or it reddens on legitimately-failed strategies.

---

### `tests/test_basis_series.py` (test, transform) — extend the round-trip guard

**Analog:** `_roundtrip_recompute` `:73-90` + the additive-kwarg test trio `:191-223`.

**The round-trip guard to extend** (`:73-90`) — TODAY it always `gap_fill`s the rebuilt rows. The D1 amendment makes reconstruction `densify_policy`-aware:
```python
def _roundtrip_recompute(r):
    rebuilt = pd.Series([row["return"] for row in r.series_rows], index=…)
    redense = gap_fill_daily_returns(rebuilt)        # ← now branch on r.conventions["densify"]:
    #   "sparse"      → rebuilt verbatim
    #   "broker_nan"  → rebuilt.reindex(date_range(min,max))       (in-span absence = guard day → NaN)
    #   "zero_fill"   → gap_fill(rebuilt) THEN reinstate NaN at conventions/nan_dates  ← composite guard-NaN fixture
    return compute_all_metrics(redense, None, periods_per_year=r.conventions["periods_per_year"], …).metrics_json
```

**Additive-kwarg neuter-test pattern to copy** (`:191-223`) — `test_conventions_echo_includes_benchmark_identity_when_supplied` / `..._omits_benchmark_by_default` are the exact template for `densify_policy` + `nan_dates` (present-when-supplied / absent-by-default / neuter → RED). The composite guard-NaN fixture is the D1 flagship: a stitched series with an in-index member-guard NaN must round-trip GREEN under `zero_fill`+`nan_dates` and RED if `nan_dates` is dropped.

---

### `tests/test_cash_basis_series_sc4.py` (test, dual-run) — extend the SC-4 harness

**Analog:** `test_sc4_cash_series_dual_run_byte_identity` `:178-225` — the dual-run byte-identity template (Run A as-shipped vs Run B legacy-path, assert DICT-EQUAL on every captured payload).

**Dual-run byte-identity assertion pattern to copy** (`:194-208`):
```python
cap_a = await _run_seam(strategy_row, …, cash_noop=False)   # new route
cap_b = await _run_seam(strategy_row, …, cash_noop=True)    # legacy _metrics_result_for path
assert _noncash_track(cap_a)["prestamp"] == _noncash_track(cap_b)["prestamp"], "SC-4 breach"
# … csv_upserts / csv_deletes / rpc_noncash all DICT-EQUAL
```
Extend to the D1/SC-4 flagship fixtures: composite-member-guard-NaN, single-key broker guard-day, **user-CSV weekend-gap** (broadest blast radius), Zavara simple/active, ccxt-`returns_denominator_config`-override (MED-2). The round-trip guard uses `assert_series_equal(check_exact=True)` (`:270-271`) — never weaken tolerance for composites (D1: the guard stays VALID on the composite guard-NaN surface).

---

### `tests/test_composite_headline_parity.py` + `tests/test_stitch_composite_job.py` (test)

**Analog:** their own existing dual-run / unit structure. Add: (a) composite cash scalar byte-identical to the deleted `_metrics_result_for` on a member-guard-NaN fixture (parity); (b) `#5` — for every existing composite fixture, `periods_per_year_for_asset_class(asset_class) == venue_blend` (equality assertion, proving the F-1 backstop already forced agreement so the collapse shifts no live scalar); (c) MED-1 — a stale series row after a terminal-failure arm is NOT trusted when `computation_status != complete`.

## Shared Patterns

### Additive-only param / JSONB key (byte-invisible by default)
**Source:** `basis_series.py:186-187` (`benchmark_symbol`), `:84`+`:245-251` (`_PAYLOAD_SCHEMA_VERSION` + payload dict)
**Apply to:** `scalar_returns`, `densify_policy`, `nan_dates` — every new param defaults `None`/absent so MTM + all current callers stay byte-identical; new JSONB keys are additive + schema-version-bumped, NEVER a migration.
```python
if benchmark_symbol is not None:
    conventions["benchmark"] = benchmark_symbol   # opt-in key; omit → unchanged shape
```

### Shared-route adoption (never fork the derive)
**Source:** `job_worker.py:4389-4418` (MTM arm), `basis_series.py` module docstring `:16-20`
**Apply to:** composite cash (#1) and single-key CSV (#2) — `stitch/prepare → ONE derive_basis_series → dict(result.metrics_json)`. The per-source conditioning (which `scalar_returns` to build) lives UPSTREAM in preparation (#6), never as an `if` inside the derive.

### Terminal-success status-gate (MED-1 choke point)
**Source:** `composite-read-path.ts:405` / `:368` — `computationStatus ∈ {complete, complete_with_warnings}`
**Apply to:** the cash-series reader (106) AND the 105 round-trip guard/dual-run harness — a series row is trusted ONLY at terminal-success, covering all terminal-failure arms including future ones (single choke point beats N arm-by-arm heal-deletes).

### Ordered-idempotent finalize (no cross-table transaction)
**Source:** `job_worker.py:4466-4492` (`_reconcile_full_delete` + chunked upsert)
**Apply to:** SC-5 — series-row RPC + dailies FIRST, scalar/status flip LAST; re-derive authoritative via whole-strategy delete idempotence.

### Byte-identity proof harness
**Source:** `test_cash_basis_series_sc4.py:178-225` (dual-run DICT-EQUAL) + `test_basis_series.py:73-90` (round-trip recompute) + `assert_series_equal(check_exact=True)`
**Apply to:** every SC-4 fixture (composite/broker/user-CSV/Zavara/ccxt-override). Each test names the mutation it kills (neuter-falsifiability).

## No Analog Found

None. Every Phase-105 change has a direct in-repo precedent (Phase 103/104 built the shared route + additive-kwarg + status-gate + dual-run rails). The onboarding teaser persist (`routers/process_key.py`) — the one change WITHOUT a clean shared-persist analog (keyed `(strategy_id, kind)` but no strategy row exists at teaser time, D2) — is CARVED to Phase 105.1 and intentionally out of this map.

## Metadata

**Analog search scope:** `analytics-service/services/{basis_series,job_worker,analytics_runner}.py`, `analytics-service/tests/`, `src/lib/factsheet/composite-read-path.ts`
**Files scanned:** ~9 (2 read in full ≤256 lines; job_worker/analytics_runner via targeted grep+offset reads on the cited line ranges)
**Pattern extraction date:** 2026-07-14
