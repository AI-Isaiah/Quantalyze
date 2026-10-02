---
phase: 106-cutover-flip-delete-legacy-janitor
reviewed: 2026-07-14T00:00:00Z
depth: deep
scope: "git diff 45900f48..HEAD (Stage A — reversible cutover)"
files_reviewed: 10
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/routers/cron.py
  - src/app/api/cron/janitor/route.ts
  - vercel.json
  - src/app/api/strategies/csv-finalize/route.ts
  - src/lib/factsheet/composite-read-path.ts
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_cron_router.py
  - src/__tests__/csv-finalize-after-failloud.test.ts
  - src/__tests__/vercel-cron-limits.test.ts
findings:
  blocker: 0
  high: 0
  medium: 2
  low: 2
  total: 4
status: issues_found
---

# Phase 106 Stage A — Code Review Report

**Reviewed:** 2026-07-14
**Depth:** deep (cross-file: worker seam ordering, migration status enums, middleware auth chain)
**Files Reviewed:** 10
**Status:** no blockers — 2 MEDIUM + 2 LOW (all test-quality / observability)

## Summary

I reviewed all four Stage-A work items adversarially, cross-checking the worker
seam against the composite analog, the janitor's status literals against the
`compute_jobs` migration enums, the auth chain against `main.py` middleware, and
the read-gate helper against `closed-sets.ts`. **Every load-bearing claim in the
task brief holds:**

- **M2 ordering swap (106-02)** — Verified. Both `persist_basis_series` calls
  (MTM + cash) now precede the DONE-gating `metrics_json_by_basis` prestamp, which
  still lands before the CSV enqueue. **No reader sits between the moved writes**
  — every write in the tail is a sequential `db_execute`, and external DONE-gated
  reads gate on `computation_status`, which stays `'computing'` for the entire
  broker-derive (the downstream csv finalizer flips it), so the intermediate state
  is never observable. The swap only changes crash-recovery semantics into the
  self-healing (fresh-series + stale-scalar) direction, exactly as documented.
  The persist **count is unchanged (2)** — order-only. The composite seam change
  is **comment-only**; the F-5 heal removed by 6eef30d1 is NOT reintroduced and
  the composite cash series still persists unconditionally.
- **Janitor (106-03)** — Reap is a compare-and-set on `computation_status='computing'`
  (no-stomp). The live-job guard's `NON_TERMINAL_JOB_STATUSES`
  (`pending/running/done_pending_children/failed_retry`) match the production
  `compute_jobs` status literals in migrations; the probe fails **safe** (probe
  throw → `except` → no reap). Threshold 60 min > 40-min watchdog ceiling. FastAPI
  `/api/cron-janitor` is behind the `X-Service-Key` middleware (only
  `/health`, `/internal/*`, `/process-key*` are skipped). Next proxy uses
  `safeCompare` (constant-time) on `Bearer ${CRON_SECRET}`, fails closed on unset
  secret, forwards Python status through (non-2xx → cron alarm). `updated_at` is
  trigger-maintained, so the staleness probe is reliable and cannot reap a row
  receiving intermediate updates.
- **csv-finalize fail-loud (106-04)** — Exactly the 4 `after()` arms;
  `console.warn` KEPT alongside each `captureToSentry`; import + `{tags, extra}`
  signature match the existing `:620`/`:826` precedent; distinct step tags;
  additive-only (happy path + response timing untouched).
- **Composite read-gate fix (ddbcbb50)** — `isComputedAnalytics` is exactly the
  two literals (`closed-sets.ts:263`); the `unknown → string|null|undefined` cast
  is sound (helper only does `===`, false for non-strings — identical to the prior
  inline compare); exactly the 3 sites; SC-4 output unchanged.

No BLOCKER or HIGH issues. The findings below are test-strength and observability
gaps that should be fixed but do not block ship.

## Medium

### MD-01: Threshold test permits a regression into the race-danger zone

**File:** `analytics-service/tests/test_cron_router.py` (`test_stale_threshold_exceeds_max_watchdog_ceiling`)
**Issue:** The test asserts `age_minutes >= 40`, but `cron.py`'s own contract
(the constant's comment) demands **`threshold >= max ceiling + 15` (i.e. >= 55
min)** so the janitor never races a legitimately-slow job. With the current 60-min
constant the test passes, but it would also stay green if someone lowered
`STALE_COMPUTING_THRESHOLD_MINUTES` to 41 — leaving only 1 min of headroom over
the 40-min `process_key_long` watchdog ceiling. That is exactly the race the
threshold exists to prevent, and the test that is supposed to pin it wouldn't
catch it. The test encodes the ceiling but not the *headroom* invariant it guards.
**Fix:** Tighten the bound to match the documented contract:
```python
assert age_minutes >= 55, (  # max watchdog ceiling (40) + 15 headroom
    f"stale threshold is only {age_minutes:.1f} min; contract requires "
    ">= 40-min ceiling + 15-min headroom so the janitor never races a slow job"
)
```

### MD-02: csv-finalize fail-loud tests don't prove the *specific* warn survived

**File:** `src/__tests__/csv-finalize-after-failloud.test.ts` (all 4 paths)
**Issue:** Each test asserts `expect(warnSpy).toHaveBeenCalled()` to prove
"console.warn is KEPT (Vercel log parity)". But `warnSpy` is a global
`console.warn` spy, and the finalize flow emits other warns. The assertion passes
if *any* warn fired during the request — so a regression that deleted the specific
failure-arm `console.warn` (leaving only the Sentry capture) would NOT redden this
test, defeating the stated "Sentry ADDED alongside, never a replacement" intent
(the WHY the test docstring claims to encode). The `captureToSentry` assertion is
correctly specific (`findCapture(step)`); only the warn-parity half is loose.
**Fix:** Assert the specific warn substring for each arm, e.g.:
```ts
expect(warnSpy.mock.calls.some(
  (c) => String(c[0]).includes("placeholder upsert failed"),
)).toBe(true);
```

## Low

### LW-01: Janitor per-row probe/update failure drops the row from both counters

**File:** `analytics-service/routers/cron.py` (`cron_janitor`, per-row `except`)
**Issue:** When the active-job probe or the reap UPDATE raises, the `except`
logs and continues without incrementing `reaped` or `skipped_active`. The
returned summary then has `reaped + skipped_active < scanned` with no field
explaining the gap, so an operator reading the JSON tick can't tell a clean
"nothing to reap" sweep from one where N rows errored. Behavior is fail-safe
(no over-reap) and the traceback reaches Sentry via `logger.exception`, so this
is observability-only.
**Fix:** Add an `errored` counter incremented in the `except` and include it in
the return dict so `scanned == reaped + skipped_active + errored` always holds.

### LW-02: Ordering test's `_ordering_table` maybe_single stub returns a select shape unused by the asserted path

**File:** `analytics-service/tests/test_job_worker.py` (`test_series_persist_before_scalar_prestamp_then_enqueue`)
**Issue:** The test wires a broad `MagicMock` select chain
(`select/eq/single/maybe_single/order/range`) returning `data={"data_quality_flags": {}}`
for every `strategy_analytics` read. This over-broad stub means the ordering
assertion relies entirely on the `upsert` payload sniff for `metrics_json_by_basis`.
It works today, but if a future refactor adds a second `strategy_analytics` upsert
carrying `metrics_json_by_basis` on this path, `events.count("scalar_prestamp") == 1`
would silently start failing for the wrong reason (harder to diagnose than an
intent-scoped stub). Not a correctness defect — a resilience/clarity note.
**Fix:** Optional — narrow the sniff to also require the `data_quality_flags` key
(the actual prestamp payload shape) so the event is pinned to the real prestamp
upsert, not any future by-basis writer.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
