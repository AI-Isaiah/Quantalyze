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

## Apply pass — round 2 specialist + red-team

**Status**: COMPLETE
**Branch state**: 2 new commits on top of round-1 final.

| Stage | Commit     | Title |
| ----- | ---------- | ----- |
| 1     | e79d76f3   | specialist apply (round 2) — 4 HIGH-conf findings |
| 3     | 8d5cf8c0   | red-team apply — phase2 load-failed self-heal |

### Stage 1 — specialist apply (round 2)

Applied 4 HIGH-severity findings from `.review/specialist.*.jsonl`:

1. **code-reviewer #1 (H conf=9)** — `run_reconcile_strategy_job`
   had a local `from services.exchange import ColdStartSymbolDiscoveryError,
   fetch_raw_trades` that shadowed the module-level `fetch_raw_trades`.
   The 3 new reconcile-audit tests patched `services.job_worker.
   fetch_raw_trades`, but the patch was ineffective and the real
   `fetch_raw_trades` ran against a MagicMock exchange — tests passed
   only because the assertion path didn't depend on what
   `exchange_fills` contained for the clean-status case. **Fix**:
   removed the redundant local `fetch_raw_trades` import (kept
   ColdStartSymbolDiscoveryError as a rarely-used sentinel). The
   patches now actually exercise the code.

2. **code-reviewer #2 (H conf=9)** — `phase2_fill_ingestion_failed`
   never self-healed on a successful run that returned ZERO new fills
   (paused account / weekend / flat). `phase2_complete=True` only got
   set inside `if raw_fills:`, so the previous gate
   `needs_flag_write = phase2_failed or phase2_complete` perma-skipped
   the clear branch. The admin "Position Metrics Failed" health card
   kept showing the strategy as needing attention indefinitely after
   any transient blip. **Fix**: introduced `phase2_success =
   _RAW_TRADE_INGESTION_ENABLED and not phase2_failed` and gated on
   `phase2_failed or phase2_success`. Adds one extra SELECT per
   successful run when the feature flag is on (deferred performance
   concern, see red-team JSONL).

3. **silent-failure-hunter #1 (H conf=9)** — `_emit_audit`'s
   docstring promised silent audit drops, but the
   audit-2026-05-07 P907 commit changed `services.audit.log_audit_event`
   to RE-RAISE on permission_denied (SQLSTATE 42501) and on
   unrecognized exception classes. At the success callsite
   (~line 1416) an audit re-raise marked a complete allocator
   holdings sync as FAILED; at the failure callsites (~lines 1340 /
   ~1370) it swapped the original error envelope (rate_limited /
   revoked credential) with the audit error in
   compute_jobs.last_error, hiding the real root cause from on-call.
   **Fix**: wrapped the inner `audit_module.log_audit_event` call in
   `try/except Exception: logger.warning(...)` so the docstring
   contract actually holds.

4. **silent-failure-hunter #2 (H conf=9)** — `reconcile_strategy`'s
   `log_audit_event` for the `reconcile.compare` event was unwrapped,
   so the same audit-re-raise class would propagate past the alert
   fan-out (the reconcile_reports row was already upserted; the
   worker would classify the audit error as the job failure and
   skip step-5 alert generation). **Fix**: wrapped the call in
   try/except + WARNING to match the owner-lookup guard above it;
   alert fan-out now always runs.

### Stage 2 — red-team review

Performed a fresh-context red-team pass over the Stage-1 diff +
5 specialist JSONLs + post-apply state. Output:
`.review/red-team.jsonl` (2 findings: 1 MED-conf=8 applied,
1 LOW-conf=7 deferred).

### Stage 3 — red-team apply

Applied the MED-conf=8 red-team finding:

- **red-team #1**: After Stage-1 expansion of `phase2_success`
  semantics, the self-healing branch still silently failed when the
  existing-flags SELECT errored. The fallback `existing_flags = {}`
  made `flag_was_set` always False, so the recovery payload never
  fired — the same silent-lag class of failure one level deeper.
  **Fix**: track `flag_load_failed=True` in the except branch and
  gate the recovery write on `flag_was_set or flag_load_failed`.
  On the load-failed path emit an EXPLICIT
  `phase2_fill_ingestion_failed=False` (rather than `pop`) because
  the upsert merges keys — a pop on a row we never read leaves the
  stale DB key in place.

### Stage 4 — pytest

**Targeted suite**:
`tests/test_job_worker.py + tests/test_job_worker_sync_funding.py +
tests/test_job_worker_reconcile_audit.py` → **57 pass, 1 pre-existing
skip**.

**Full analytics-service sweep**: **1370 pass, 2 fail, 52 skipped**.
The 2 failures are pre-existing (verified by checking out HEAD~2's
`job_worker.py` and re-running):
`tests/test_repro_key_flow.py::test_happy_path_replays_balance_fetch[bybit/okx]`
make a real-network call to bybit/okx and fail on
`AuthenticationError: API key is invalid` — infrastructure/fixture
issue, NOT a regression from this PR. (Earlier round-1 sweep already
noted these as out-of-PR-scope.)

### Files changed (round 2)

- `analytics-service/services/job_worker.py` (modified)
- `.review/specialist.*.jsonl` (5 — input artifacts, untracked)
- `.review/red-team.jsonl` (NEW — untracked)

## Stage F — post-rebase Grok 4.3 adversarial pass (2026-05-16)

**Status**: PASS

Single adversarial pass on `analytics-service/services/job_worker.py` diff (29.6KB prompt, focus areas: concurrency, silent-failure regression, retry storm, cross-dep with portfolio.py reaper, test coverage).

Findings (none BLOCKING):

- **HIGH**, 8/10, `job_worker.py:334` (`classify_exception` + `_HTTP_UNKNOWN_4XX`): 403/404 now map to "unknown" (retried). Comment justifies deploy/rotation races but no per-job backoff bound visible in this diff. Scope-bounded: caller-side retry cap is in the dispatcher, not classify_exception. Backlog: long-tail tech-debt to add explicit max-retry cap visible from this layer.
- **MEDIUM**, 7/10, `job_worker.py:675` (`run_sync_funding_job` upsert_errors → FAILED+transient): aligns with `classify_exception` but depends on caller-side retry/backoff (out of file scope). Same scope-bounded conclusion as the HIGH finding.
- **LOW**, 6/10, `job_worker.py:892` (`phase2_failed` RMW): TOCTOU acknowledged + mitigated by best-effort + recovery writes. No new race introduced vs. prior cursor logic.
- **LOW**, 5/10, `job_worker.py:607` (`_emit_audit` broad-except warning): intentional per P907 contract; does not re-introduce silent failure for job outcome.

**VERDICT: PASS** — 30 prior findings remain closed; no BLOCKING concurrency / swallow / retry-storm defects in this diff.
