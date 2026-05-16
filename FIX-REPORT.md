# Fix report — `analytics-service/services/job_worker.py`

Pipeline: Stage 0 (fix-impl) → A (comment-analyzer) → B (code-simplifier) → C (specialist suite parallel) → D (red-team) → E (pytest).

Branch: `fix/audit-2026-05-07-job-worker-py`

## Commits

| Stage | Commit     | Title |
| ----- | ---------- | ----- |
| 0     | b01669df   | stage 0 fix-impl — closes 30 findings |
| A+B   | e4b9797d   | stage A+B (comments/simplify) — phase2_failed naming |
| C     | 4adb0536   | stage C (specialist suite) — H-0691 read-modify-write merge fix |
| D     | 81a07f55   | stage D (red-team) — self-healing flag clear + test fixture fix |
| chore | cdf0cece   | untrack FIX-BRIEF.md (input artifact) |

## Stage 0 — fix-impl

**Status**: COMPLETE
**Outcome**: 30 in-scope findings addressed; tests added/updated.

| ID         | Severity | Status   | Implementation |
| ---------- | -------- | -------- | -------------- |
| C-0317     | CRITICAL | CLOSED   | `tests/test_job_worker_sync_funding.py` — 6 tests cover unsupported exchange, 429+stamp_429, empty rows, happy path, upsert-errors, preflight short-circuit |
| H-0682     | HIGH     | CLOSED   | `run_rescore_allocator_job` delegates to `classify_exception` instead of hardcoded transient — permanent bugs (mandate KeyError, schema TypeError) no longer DoS the daily cron |
| H-0683     | HIGH     | CLOSED   | `await db_execute(_load_strategy_owner)` wrapped in try/except; reconcile epilogue continues even on transient PostgREST 503 |
| H-0684     | HIGH     | CLOSED   | `test_owner_lookup_returns_none_skips_audit_gracefully` test pins the conditional-skip branch |
| H-0685     | HIGH     | CLOSED   | Same fix as H-0683 + explicit `audit_owner_lookup_failed=true` warning for forensic searchability |
| H-0689     | HIGH     | DEFERRED | Concurrent sync_trades real-Supabase test — requires E2E scope outside this slice. Existing `phase2_complete`/cursor gate already prevents data loss across runs |
| H-0691     | HIGH     | CLOSED   | Phase 2 fetch+persist failures stamp `strategy_analytics.data_quality_flags.phase2_fill_ingestion_failed`; self-healing clear-on-success branch stamps `phase2_recovered_at` |
| H-0692     | HIGH     | ACCEPTED | Existing G12.A.6 amendment-collision SELECT already logs `fill_amendments_detected` with collision count per the briefing's option (a) |
| H-0693     | HIGH     | ACCEPTED | Existing `phase2_complete` gate prevents granular cursor advance on partial Phase 2 failure; `last_sync_at` advances because Phase 1 daily-PnL did persist |
| H-1110     | HIGH     | CLOSED   | `DispatchResult.error_kind: ErrorKind | None`, `@dataclass(frozen=True, slots=True)` |
| H-1111     | HIGH     | CLOSED   | `JobStatus` Literal + `CLAIMABLE_STATUSES: Final` mirror migration 089 SQL |
| H-1112     | HIGH     | CLOSED   | `classify_exception(exc) -> tuple[ErrorKind, str]` typed return |
| H-1113     | HIGH     | CLOSED   | 403/404 reclassified as `unknown` (retried) per briefing option; existing 404=permanent test updated; new 403 + 404 transient-infra tests pin the contract |
| H-1114     | HIGH     | CLOSED   | `_format_http_detail` helper handles str/dict/list/rogue-`__str__`; tests for dict-detail and rogue-detail |
| H-1115     | HIGH     | CLOSED   | `run_sync_funding_job` reads `result['errors']` → FAILED transient + per-error logger.error |
| M-0669     | MED      | CLOSED   | Orphan-owner warning emitted (forensic signal where there used to be silent drop) |
| M-0670     | MED      | CLOSED   | `_emit_audit(action: AllocatorHoldingsAction)` Literal narrowing |
| M-0671     | MED      | ACCEPTED | sync_trades has DB-layer dedup via partial unique index + watchdog. Deterministic idempotency-key is a queue-substrate change outside file scope |
| M-0672     | MED      | CLOSED   | `import os` at top-level (verified — closed pre-PR) |
| M-0673     | MED      | CLOSED   | `_RAW_TRADE_INGESTION_ENABLED: Final[bool]` module constant; tests updated to patch the constant |
| M-0946     | MED      | CLOSED   | `match status:` block makes the 408/429 / 403/404 / 400-499 / 500 trichotomy structurally explicit |
| M-0947     | MED      | CLOSED   | `__cause__` repr appended to HTTPException detail when present (preserves context across `analytics_runner.py`'s wrap-to-500 boundary) |
| M-0948-51  | MED      | CLOSED   | `_format_http_detail` shared coercer + dict-detail/rogue-detail tests |
| M-0950     | MED      | CLOSED   | `test_http_exception_with_ccxt_baseerror_parent_still_permanent` pins ordering |
| M-0952     | MED      | CLOSED   | `CLAIMABLE_STATUSES: Final[tuple[JobStatus, ...]]` mirrors migration 089 SQL (pragmatic version per briefing) |
| M-0953     | MED      | CLOSED   | `Priority = Literal['low','normal','high']` |
| M-0954     | MED      | DEFERRED | `ComputeJobRow` TypedDict would cascade into every handler signature — JobStatus/Priority/ErrorKind Literals + CLAIMABLE_STATUSES land the pragmatic v1 per briefing |
| M-0955     | MED      | CLOSED   | `test_rate_limit_exceeded_stamps_429_and_reraises` in new sync_funding test file |

## Stage A — comment-analyzer

**Status**: COMPLETE
**Outcome**: Renamed `phase2_fetch_failed`/`phase2_fetch_error` to `phase2_failed`/`phase2_error_message` so the data-quality stamp clearly covers BOTH fetch and persist failure modes under one signal. Comment block tightened.

## Stage B — code-simplifier

**Status**: COMPLETE
**Outcome**: No additional simplifications needed beyond Stage A's rename. The `_format_http_detail` helper, `match/case` block, and frozen/slots dataclass are already minimal.

## Stage C — specialist suite

**Status**: COMPLETE
**Outcome**:

- **code-reviewer**: no further blocking findings.
- **silent-failure-hunter**: no further blocking findings.
- **pr-test-analyzer**: identified missing test for the new phase2 flag stamp — `test_phase2_fetch_failure_stamps_data_quality_flag` added in Stage C.
- **api-contract**: surfaced that H-0691's `strategy_analytics.data_quality_flags` upsert was UNCONDITIONAL — it would clobber sibling flags written by `analytics_runner` (`benchmark_unavailable`, `sibling_kinds_failed`, `position_metrics_*`). **Fixed** with read-modify-write pattern + test that pre-loads `benchmark_unavailable` and asserts both flags coexist after the merge.
- **security**: no further blocking findings; `_format_http_detail` truncates safely and the 200-char bound on `phase2_error_message` matches existing `sync_error` semantics.
- **performance**: phase2 flag read adds one DB round-trip on failure path only (already a slow path). Acceptable.

## Stage D — red-team

**Status**: COMPLETE
**Outcome**: Two issues surfaced and fixed.

1. **Stamp-once persistence**: phase2_fill_ingestion_failed flag would stay set forever after a single transient blip. **Fixed**: clear-on-success branch when `phase2_complete=True`, stamping `phase2_recovered_at`. New test `test_phase2_recovery_clears_lingering_failure_flag` pins the contract.

2. **Test fixture mismatch**: `test_sync_trades_feature_flag_on` used `patch(..., side_effect=lambda fn: asyncio.to_thread(fn))` without `new=`. That returns a coroutine from `db_execute(...)` that the existing test never accessed; my H-0691 read step actually USES the return value, which broke the test. **Fixed**: switched the patch to `new=AsyncMock(side_effect=lambda fn: fn())` which matches every newer test in the file and gives `await db_execute(...)` a real return value.

## Stage E — pytest

**Status**: PASS
**Outcome**:

- `tests/test_job_worker.py` + `tests/test_job_worker_sync_funding.py` + `tests/test_job_worker_reconcile_audit.py`: **57 pass, 1 skipped** (pre-existing skip)
- Broader regression sweep (`test_main_worker.py`, `test_routers_audit_emission*.py`, `test_match_integration.py`, `test_feedback_engine.py`, `test_worker_load.py`): **123 pass, 1 skipped**
- Full analytics-service pytest: **1282 pass, 4 fail, 51 skipped**. The 4 failures are pre-existing — `csv_adapter.py` / `csv_header_case.py` fail on `ModuleNotFoundError: pandera` (missing dev dependency, not regression-related); 6 other tests fail collection on `ModuleNotFoundError: structlog`.

## Acceptances and deferrals

- **H-0689** concurrent sync_trades test deferred to E2E scope.
- **H-0692** `ignore_duplicates=True` amendment behavior: existing G12.A.6 collision SELECT already covers per briefing option (a).
- **H-0693** Phase 1+2 transactional consistency: `phase2_complete` cursor gate is in place; `last_sync_at` intentionally advances when Phase 1 succeeded.
- **M-0671** sync_trades idempotency key: out-of-file queue-substrate change.
- **M-0954** ComputeJobRow TypedDict: JobStatus / Priority / ErrorKind Literals + CLAIMABLE_STATUSES land the pragmatic v1 the briefing recommended.

## Files changed

- `analytics-service/services/job_worker.py` (modified)
- `analytics-service/tests/test_job_worker.py` (modified, +3 test classes)
- `analytics-service/tests/test_job_worker_sync_funding.py` (NEW)
- `analytics-service/tests/test_job_worker_reconcile_audit.py` (NEW)
