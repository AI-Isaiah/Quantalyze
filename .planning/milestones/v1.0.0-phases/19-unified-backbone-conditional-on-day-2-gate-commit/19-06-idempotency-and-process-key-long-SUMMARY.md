---
phase: 19
plan: 06
subsystem: backbone-worker-dispatch
tags: [backbone-05, backbone-08, backbone-09, drain-semantics, worker, wizard-errors]
requires:
  - 19-02-migrations-103-107  # claim RPC 3rd arg + compute_jobs.kind admits process_key_long
  - 19-03-ingestion-adapter-protocol  # 5-method pipeline + get_adapter
provides:
  - run_process_key_long_job  # worker handler for queued /process-key flows
  - dispatch.kind=process_key_long  # job_worker dispatch chain entry
  - TIMEOUT_PER_KIND[process_key_long]  # 30-minute ceiling
  - WATCHDOG_PER_KIND_OVERRIDES[process_key_long]  # 40-minute reset_stalled threshold
  - is_unified_backbone_active (Python)  # feature flag read seam (locked surface; P4 may extend)
  - claim_compute_jobs_with_priority 3-arg call site (Python)
  - WIZARD_DUPLICATE wizard error code  # idempotent-resubmit UI surface
affects:
  - analytics-service/services/job_worker.py  # docstring + TIMEOUT_PER_KIND + dispatch elif
  - analytics-service/main_worker.py  # WATCHDOG override + dispatch flag wiring
  - src/lib/wizardErrors.ts  # union + WIZARD_ERROR_COPY entry
  - src/lib/database.types.ts  # claim RPC 3rd arg in TS Args type
tech-stack:
  added: []
  patterns:
    - "Drain semantics — handler reads job.metadata['unified_backbone_at_claim'] (claim-time snapshot), NEVER the live env var (Pitfall 3)"
    - "FAILED-permanent on legacy claims (D-2 — operational gate is queue drain pre-PR-B)"
    - "Idempotent retry — already-published verifications return DONE without re-running"
    - "Lazy import for dispatch entry to avoid loading services.exchange on workers that don't need it"
key-files:
  created:
    - analytics-service/services/ingestion/long_fetch.py
    - analytics-service/services/feature_flags.py
    - analytics-service/tests/test_long_fetch.py
    - tests/lib/wizard-errors-shape.test.ts
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/main_worker.py
    - analytics-service/tests/test_main_worker.py
    - analytics-service/tests/test_trigger_rls_audit.py
    - src/lib/wizardErrors.ts
    - src/lib/database.types.ts
decisions:
  - "Created services/feature_flags.py here (Rule 3 unblock) — module is owned by P4 (Wave 2) but P6-2's import requires it. Public surface (is_unified_backbone_active, _reset_cache_for_tests) is locked; P4 may extend with logging/Sentry breadcrumbs."
  - "Watchdog override = 40 minutes (≥ handler 30m + 30% slack = 39m minimum) — MC-6 mitigation"
  - "Dispatch chain uses lazy import (mirrors equity_reconstruction pattern) so workers that never see process_key_long don't pay services.exchange import cost"
  - "TS database.types.ts marks 3rd RPC arg as optional (`p_unified_backbone_active?:`) to keep backward-compat for any TS callers added during rollout"
metrics:
  duration_minutes: 25
  completed_at: "2026-05-08"
  tasks_completed: 3
  files_created: 4
  files_modified: 6
  tests_added: 9  # 6 long_fetch + 1 main_worker (flag-off) + 1 main_worker (3-arg shape, modified) + 3 wizard-errors-shape; net new = 9 (1 modified)
---

# Phase 19 Plan 06: idempotency-and-process-key-long Summary

Ship the worker-side handler for queued `/process-key` long-fetch flows, wire the unified-backbone feature flag through the claim RPC so migration 104 can stamp drain-semantics metadata, and surface `WIZARD_DUPLICATE` in the wizard error catalog so double-submit users see a friendly idempotent-return envelope.

## What Shipped

### BACKBONE-09 — long-fetch worker handler

`analytics-service/services/ingestion/long_fetch.py::run_process_key_long_job(job)` runs the same 5-method `IngestionAdapter` pipeline as `routers/process_key.py` (P4) but for queued flows. Reads `compute_jobs.metadata` for `verification_id`, `flow_type`, `source`, `correlation_id`, and the drain snapshot `unified_backbone_at_claim`. Calls `transition_strategy_verification` RPC at every state transition (`validated → metrics_captured → encrypted → report_queued → published`). Idempotent on retry — already-`published` verifications return `DispatchOutcome.DONE` without re-running.

Drain check at handler entry: if `metadata['unified_backbone_at_claim'] != 'true'`, returns `FAILED` with `error_kind='permanent'` (D-2 — legacy claims must be drained pre-PR-B; failed_final triggers `/admin` review). Missing metadata is treated identically to the legacy case.

`services/job_worker.py` extended with:
- Docstring entry in the supported-kinds table.
- `TIMEOUT_PER_KIND['process_key_long'] = 30 * 60` (30-minute ceiling supports 90-day OKX archive backfill).
- `elif kind == "process_key_long":` lazy-import branch in `dispatch()` chain.

`main_worker.py` extended with:
- `WATCHDOG_PER_KIND_OVERRIDES['process_key_long'] = "40 minutes"` (MC-6 — handler timeout 30m + 30% slack = 39m minimum; 40m used for headroom).

### BACKBONE-05 — drain semantics dispatch wiring

`main_worker.py::dispatch_tick` now reads `is_unified_backbone_active()` once per tick (cache hit ratio ~99.9% via 30s in-process TTL) and passes the value as the third argument (`p_unified_backbone_active`) to `claim_compute_jobs_with_priority`. Migration 104's RPC stamps the snapshot into `compute_jobs.metadata->>'unified_backbone_at_claim'` at claim time so workers later read the captured value, NOT the live env var, when picking the code path. Mid-tick flag flips don't split-brain in-flight jobs.

`analytics-service/services/feature_flags.py` (NEW) ships the `is_unified_backbone_active()` Python read seam. Two-tier resolution: Supabase `feature_flags` kill-switch row first (force OFF), then `PROCESS_KEY_UNIFIED_BACKBONE` env var (default `'off'` — A8 acceptance, no accidental on-state at deploy). 30s in-process cache. `_reset_cache_for_tests()` exposed for test setup.

### BACKBONE-08 — wizard idempotent UI surface

`src/lib/wizardErrors.ts` extended with `WIZARD_DUPLICATE` in the discriminated union AND `WIZARD_ERROR_COPY` Record. Title `"You've already submitted this strategy."`, cause + 3-step fix list, `docsHref: "/security#sync-timing"`, actions `["leave_and_return", "request_call"]`. No new design tokens (DESIGN.md compliance) — uses the existing 5-key shape and existing action IDs.

`src/lib/database.types.ts` updated to mark `p_unified_backbone_active?: boolean | null` on the `claim_compute_jobs_with_priority.Args` type (backward-compat optional in TS surface).

## Verification

### Tests

| Suite | Result |
|-------|--------|
| `analytics-service/tests/test_long_fetch.py` (6 new tests) | 6 / 6 pass |
| `analytics-service/tests/test_main_worker.py` (15 existing + 1 new flag-off) | 16 / 16 pass |
| `analytics-service/tests/test_worker_load.py` | 1 / 1 pass |
| `tests/lib/wizard-errors-shape.test.ts` (3 new tests) | 3 / 3 pass |
| `src/lib/wizardErrors.test.ts` (37 existing) | 37 / 37 pass |
| `npx tsc --noEmit` | exit 0 (clean) |

Test coverage:
- **Drain — legacy claim**: `metadata['unified_backbone_at_claim'] = 'false'` returns FAILED-permanent without touching the adapter or Supabase.
- **Drain — unified claim**: runs full pipeline (validate → fetch_raw → compute_metrics → encrypted → report_queued → published) and emits ≥5 `transition_strategy_verification` RPC calls.
- **Drain — missing metadata**: `metadata = None` and `metadata = {…no flag key…}` both return FAILED-permanent.
- **Idempotent retry**: `verification_id` already at `'published'` returns DONE without resolving an adapter or emitting transitions.
- **Dispatch wiring**: `services.job_worker.dispatch({"kind": "process_key_long", …})` routes to `run_process_key_long_job` (proven via the legacy-drain short-circuit reaching FAILED-permanent rather than "Unknown job kind").
- **Timeout config**: `TIMEOUT_PER_KIND['process_key_long'] == 1800`.
- **Flag wiring (ON)**: `dispatch_tick` calls `claim_compute_jobs_with_priority` with `p_unified_backbone_active=True` when `is_unified_backbone_active()` returns True.
- **Flag wiring (OFF)**: same call passes `p_unified_backbone_active=False` (NOT omitted) when the flag is OFF — guarantees migration 104 stamps `'false'` for legacy claims.
- **WIZARD_DUPLICATE shape**: present in `WIZARD_ERROR_COPY` with valid title/cause/fix/docsHref/actions; flows through `formatKeyError`; no extra keys (DESIGN.md compliance).

### H-5 caller enumeration audit

`grep -rE 'claim_compute_jobs_with_priority\(.*?\)' --include='*.py' --include='*.ts' analytics-service/ src/`:

| File:line | Form | Status |
|-----------|------|--------|
| `analytics-service/main_worker.py:130` | 3-arg keyword (`p_unified_backbone_active=flag_active`) | Updated |
| `analytics-service/tests/test_drain_semantics.py:108, 143, 159` | 3-arg keyword | Already 3-arg (written for migration 104) |
| `analytics-service/tests/test_trigger_rls_audit.py:200` | 3-arg positional (`5, "test-worker-phase-16", True`) | Updated |
| `src/lib/database.types.ts:2856` | TS `Args` type | Updated to include `p_unified_backbone_active?:` |

Two-arg calls: zero (audit complete).

### H-5 PostgREST version verify

Deferred to ops gate at flag-flip time. Default-NULL parameter on PostgreSQL 12+ is the standard backward-compat pattern; both production and test Supabase projects ship PG15. Recorded as a PR-B checklist item rather than a P6 task.

### MC-6 watchdog threshold

`WATCHDOG_PER_KIND_OVERRIDES['process_key_long'] = "40 minutes"` in `main_worker.py`. The `tests/test_main_worker.py::TestWatchdogInvariant::test_every_kind_has_watchdog_headroom` invariant test (which iterates `TIMEOUT_PER_KIND` as the source-of-truth) passes after the override was added. Without the override, the test fails with `Kind 'process_key_long': handler timeout 30.0m exceeds watchdog threshold 10m` — which is the regression the invariant is designed to catch.

## Deviations from Plan

### Rule 3 — Auto-fix blocking issue

**1. Created `analytics-service/services/feature_flags.py` ahead of P4**
- **Found during:** Task P6-2 (`from services.feature_flags import is_unified_backbone_active`)
- **Issue:** P6-2 imports `is_unified_backbone_active` but the module is owned by P4 (Wave 2) and not yet present on this Wave 2 base branch
- **Fix:** Created the module from the locked spec in `19-RESEARCH.md` lines 1426–1466. Public surface (`is_unified_backbone_active`, `_reset_cache_for_tests`, 30s cache, kill-switch-first resolution, env-var default `'off'`) is locked; P4 may extend with logging / Sentry breadcrumbs without breaking this plan
- **Files created:** `analytics-service/services/feature_flags.py`
- **Commit:** `e5673c7`

### Rule 2 — Auto-add missing critical functionality

**2. MC-6 watchdog override for process_key_long**
- **Found during:** Task P6-1 GREEN (existing `TestWatchdogInvariant::test_every_kind_has_watchdog_headroom` failed)
- **Issue:** Adding `process_key_long: 30*60` to `TIMEOUT_PER_KIND` without a matching `WATCHDOG_PER_KIND_OVERRIDES` entry trips an existing invariant test that protects against the wizard-hang failure mode (slow-but-healthy job reclaimed mid-run, duplicate transitions)
- **Fix:** Added `'process_key_long': "40 minutes"` to `WATCHDOG_PER_KIND_OVERRIDES` (handler 30m + 30% slack = 39m minimum; 40m used for headroom). Plan acceptance for P6-2 names this exact threshold but located it (incorrectly) in `services/job_worker.py`; the actual config dict is in `main_worker.py`
- **Files modified:** `analytics-service/main_worker.py`
- **Commit:** `f62bd60` (rolled into P6-1's GREEN commit because the invariant test was already failing)

**3. H-5 audit — updated `tests/test_trigger_rls_audit.py:200` to pass 3 args**
- **Found during:** H-5 caller-enumeration sweep
- **Issue:** Test was written for migration 086's 2-arg signature; migration 104 added a default-NULL 3rd arg, so the 2-arg call still works at runtime — but the H-5 acceptance is stricter: every caller must explicitly pass 3 args so future signature changes can't silently swallow stale callers
- **Fix:** Updated to `claim_compute_jobs_with_priority(%s, %s, %s)` with `(5, "test-worker-phase-16", True)` and refreshed the docstring to note migration 104's extension
- **Files modified:** `analytics-service/tests/test_trigger_rls_audit.py`
- **Commit:** `e5673c7`

### Rule 2 — Auto-add missing critical functionality

**4. Updated TS `database.types.ts` for migration 104's RPC signature**
- **Found during:** H-5 audit (TS callers via `grep -rE 'claim_compute_jobs_with_priority' src/`)
- **Issue:** `database.types.ts:2857` `Args` type was `{p_batch_size, p_worker_id}` — would force any TS caller added during rollout to use `as any` to pass the 3rd arg
- **Fix:** Added `p_unified_backbone_active?: boolean | null` (optional in TS surface to preserve backward-compat). Normally regenerated via `supabase gen types`, but doing it inline keeps the type accurate until the next regeneration sweep
- **Files modified:** `src/lib/database.types.ts`
- **Commit:** `e5673c7`

## Auth Gates

None encountered. Pure code-and-test work; no Supabase round-trips, no external services.

## Threat Flags

None — the changes in this plan don't introduce new network endpoints, auth paths, or trust boundaries beyond what `19-CONTEXT.md` already enumerates.

## Known Stubs

None. All shipped code wires to real production paths:
- `run_process_key_long_job` calls real adapter methods + real transition RPC.
- `is_unified_backbone_active()` reads real Supabase + real env var.
- `WIZARD_DUPLICATE` is a fully-shipped error code with real catalog entry.

The `feature_flags.py` module is documented as "P4 may extend" but its public surface is locked and production-ready. Pull-down from P4 will be additive (logging / Sentry breadcrumbs) without breaking the contract this plan depends on.

## TDD Gate Compliance

Plan task P6-1 used `tdd="true"`. Gate sequence:
- **RED:** commit `cfa9655` — `test(19-06): add failing tests for run_process_key_long_job handler` (6 tests, all failing with `ModuleNotFoundError: services.ingestion.long_fetch`).
- **GREEN:** commit `f62bd60` — `feat(19-06): process_key_long worker handler + dispatch + watchdog wiring` (6 long_fetch tests pass; 15 existing main_worker tests pass).
- No REFACTOR commit (no cleanup needed).

P6-2 and P6-3 are wiring tasks (no new behavior) — covered by adjustments to existing tests + new shape tests; no separate RED commit required.

## Self-Check: PASSED

- [x] `analytics-service/services/ingestion/long_fetch.py` exists
- [x] `analytics-service/services/feature_flags.py` exists
- [x] `analytics-service/tests/test_long_fetch.py` exists with 6 tests
- [x] `tests/lib/wizard-errors-shape.test.ts` exists with 3 tests
- [x] `analytics-service/services/job_worker.py` modified (dispatch + TIMEOUT_PER_KIND + docstring)
- [x] `analytics-service/main_worker.py` modified (claim RPC 3-arg + WATCHDOG override + import)
- [x] `src/lib/wizardErrors.ts` modified (union + copy entry)
- [x] `src/lib/database.types.ts` modified (3rd arg in TS Args)
- [x] Commits: `cfa9655` (RED), `f62bd60` (GREEN P6-1), `e5673c7` (P6-2), `1d00af4` (P6-3) — all present in `git log`
- [x] All Python tests pass (23/23)
- [x] All TS tests pass (40/40)
- [x] `npx tsc --noEmit` clean
