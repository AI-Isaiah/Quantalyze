# Fix report — `analytics-service/services/job_worker.py`

Pipeline: Stage 0 (fix-impl) → A (comment-analyzer) → B (code-simplifier) → C (specialist suite parallel) → D (red-team) → E (pytest).

Branch: `fix/audit-2026-05-07-job-worker-py`

## Stage 0 — fix-impl

**Status**: COMPLETE
**Commit**: `b01669df` — fix(audit-2026-05-07): job_worker.py — stage 0 fix-impl

### Findings closed (30 in scope)

| ID         | Severity | Status   | Implementation |
| ---------- | -------- | -------- | -------------- |
| C-0317     | CRITICAL | CLOSED   | New file `tests/test_job_worker_sync_funding.py` — 6 tests covering unsupported exchange, 429+stamp_429, empty rows, happy path, upsert-errors, preflight short-circuit |
| H-0682     | HIGH     | CLOSED   | `run_rescore_allocator_job` now delegates to `classify_exception` instead of hardcoded transient |
| H-0683     | HIGH     | CLOSED   | `await db_execute(_load_strategy_owner)` wrapped in try/except |
| H-0684     | HIGH     | CLOSED   | `test_owner_lookup_returns_none_skips_audit_gracefully` test |
| H-0685     | HIGH     | CLOSED   | Same fix as H-0683 + explicit observability warning |
| H-0689     | HIGH     | DEFERRED | Concurrent sync_trades test requires real Supabase. Documented in FIX-BRIEF acceptance: alternative is advisory lock around Phase 2 (deferred to E2E scope; existing partial-success checkpoint already prevents data loss across runs) |
| H-0691     | HIGH     | CLOSED   | Phase 2 fetch+persist failures stamp `strategy_analytics.data_quality_flags.phase2_fill_ingestion_failed` |
| H-0692     | HIGH     | ACCEPTED | Existing G12.A.6 collision-detection SELECT already logs `fill_amendments_detected` with collision count. Briefing's alternative (a) was emit warning per amended fill — already in place. |
| H-0693     | HIGH     | ACCEPTED | Existing `phase2_complete` gate already prevents granular cursor advance on partial Phase 2 failure. last_sync_at intentionally advances (Phase 1 succeeded). |
| H-1110     | HIGH     | CLOSED   | `DispatchResult.error_kind: ErrorKind | None`, `@dataclass(frozen=True, slots=True)` |
| H-1111     | HIGH     | CLOSED   | `JobStatus` Literal + `CLAIMABLE_STATUSES: Final` mirror migration 089 |
| H-1112     | HIGH     | CLOSED   | `classify_exception(exc) -> tuple[ErrorKind, str]` |
| H-1113     | HIGH     | CLOSED   | 403/404 reclassified as `unknown` (retried) per briefing option; new tests pin contract |
| H-1114     | HIGH     | CLOSED   | `_format_http_detail` helper handles str/dict/list/rogue-`__str__`; tests for dict-detail and rogue-detail |
| H-1115     | HIGH     | CLOSED   | `run_sync_funding_job` reads `result['errors']` → FAILED transient + per-error logger.error |
| M-0669     | MED      | CLOSED   | Orphan-owner warning emitted (forensic signal where there used to be silent drop) |
| M-0670     | MED      | CLOSED   | `_emit_audit(action: AllocatorHoldingsAction)` Literal |
| M-0671     | MED      | ACCEPTED | sync_trades dedup at the DB layer via partial unique index; watchdog handles in-flight dedup. Briefing's deterministic idempotency-key path is a queue-substrate change outside the file scope. |
| M-0672     | MED      | CLOSED   | `import os` already at top-level (closed pre-PR) — verified |
| M-0673     | MED      | CLOSED   | `_RAW_TRADE_INGESTION_ENABLED: Final[bool]` module-level constant |
| M-0946     | MED      | CLOSED   | `match status:` block in HTTPException branch with explicit trichotomy |
| M-0947     | MED      | CLOSED   | `__cause__` repr appended to HTTPException detail when present |
| M-0948-51  | MED      | CLOSED   | `_format_http_detail` shared coercer; dict-detail test added |
| M-0950     | MED      | CLOSED   | `test_http_exception_with_ccxt_baseerror_parent_still_permanent` pins ordering |
| M-0952     | MED      | CLOSED   | `CLAIMABLE_STATUSES` Final mirrors migration 089 (pragmatic version) |
| M-0953     | MED      | CLOSED   | `Priority = Literal['low','normal','high']` |
| M-0954     | MED      | DEFERRED | `ComputeJobRow` TypedDict — would cascade into every handler signature; doc'd as next-step rather than mass-refactor in audit scope |
| M-0955     | MED      | CLOSED   | `test_rate_limit_exceeded_stamps_429_and_reraises` in new sync_funding test file |

### Tests
- `tests/test_job_worker.py`: 47 tests (46 pass, 1 skipped existing)
- `tests/test_job_worker_sync_funding.py`: NEW — 6 tests pass
- `tests/test_job_worker_reconcile_audit.py`: NEW — 3 tests pass
- `tests/test_routers_audit_emission*.py + test_main_worker.py + test_match_integration.py + test_feedback_engine.py`: 65 tests pass (no regressions)

### Notes / deviations
- H-0689 (concurrent sync_trades real-Supabase test) deferred — requires E2E scope and the existing checkpoint logic already serializes cursor advance.
- H-0692 (`ignore_duplicates=True` discards amendments) accepted — existing collision-detection SELECT (G12.A.6) already emits `fill_amendments_detected` warning with collision count. Upgrading to DO UPDATE is a wider data-shape change tracked separately.
- H-0693 partial-failure inconsistency: gating already exists via `phase2_complete` controlling `advance_fetched_cursor`; last_sync_at intentionally advances since Phase 1 daily-PnL did persist.
- M-0671 deterministic idempotency keys for sync_trades — queue-substrate change outside file scope; current dedup is watchdog + DB unique index.
- M-0954 ComputeJobRow TypedDict — adopted CLAIMABLE_STATUSES + JobStatus/Priority Literals as the pragmatic v1; full TypedDict would touch every handler signature.
