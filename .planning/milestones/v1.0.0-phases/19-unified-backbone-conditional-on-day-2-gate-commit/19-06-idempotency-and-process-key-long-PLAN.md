---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 06
type: execute
wave: 2
depends_on: [19-02-migrations-103-107, 19-03-ingestion-adapter-protocol]
files_modified:
  - analytics-service/services/ingestion/long_fetch.py
  - analytics-service/services/job_worker.py
  - analytics-service/main_worker.py
  - src/lib/wizardErrors.ts
  - analytics-service/tests/test_long_fetch.py
autonomous: true
requirements: [BACKBONE-05, BACKBONE-09]
must_haves:
  truths:
    - "compute_jobs.kind='process_key_long' jobs claim via existing claim_compute_jobs_with_priority RPC and dispatch to run_process_key_long_job handler in services/job_worker.py"
    - "Worker handler reads compute_jobs.metadata->>'unified_backbone_at_claim' (drain semantics — Pitfall 3); legacy claims (flag_at_claim='false') return DispatchOutcome.FAILED with permanent error_kind"
    - "Worker handler runs the same 5-method IngestionAdapter pipeline as the synchronous router; transition_strategy_verification RPC advances state at each step; result written back to strategy_verifications by RPC (NOT returned to caller)"
    - "main_worker.py dispatch loop reads is_unified_backbone_active() once per dispatch tick and passes the value as 3rd arg to claim_compute_jobs_with_priority"
    - "TIMEOUT_PER_KIND['process_key_long'] = 30 * 60 (30 min) — supports 90-day OKX archive backfill on noisy accounts"
    - "Idempotency at SQL+route layer: Pitfall 2 23505 catch-and-return-existing already in P4 router; this plan's worker handler uses the same defense for race-on-update of strategy_verifications"
    - "wizardErrors.ts ships WIZARD_DUPLICATE error code (or verifies it already exists) so the wizard UI can render an idempotent-resubmit message"
  artifacts:
    - path: "analytics-service/services/ingestion/long_fetch.py"
      provides: "run_process_key_long_job worker handler — runs adapter pipeline + writes result back to strategy_verifications"
      contains: "run_process_key_long_job"
    - path: "analytics-service/services/job_worker.py"
      provides: "Dispatch dict entry for process_key_long + TIMEOUT_PER_KIND[process_key_long]"
      contains: "process_key_long"
    - path: "analytics-service/main_worker.py"
      provides: "Dispatch loop reads is_unified_backbone_active() and passes to claim RPC 3rd arg"
      contains: "p_unified_backbone_active"
    - path: "src/lib/wizardErrors.ts"
      provides: "WIZARD_DUPLICATE error code for idempotent-resubmit UI surface"
      contains: "WIZARD_DUPLICATE"
  key_links:
    - from: "main_worker.py dispatch tick"
      to: "claim_compute_jobs_with_priority(p_batch_size, p_worker_id, p_unified_backbone_active=<flag_value>)"
      via: "supabase.rpc 3-arg call (per migration 104)"
      pattern: "p_unified_backbone_active"
    - from: "run_process_key_long_job handler"
      to: "compute_jobs.metadata->>'unified_backbone_at_claim'"
      via: "drain check at handler entry (Pitfall 3)"
      pattern: "unified_backbone_at_claim"
    - from: "run_process_key_long_job handler"
      to: "transition_strategy_verification RPC"
      via: "state advancement at each pipeline step (mirrors P4 router)"
      pattern: "transition_strategy_verification"
---

<objective>
Ship the worker-side handler for `compute_jobs.kind='process_key_long'`
(BACKBONE-09 — long-fetch dispatch via existing PR #53 worker dyno on
Railway). The synchronous /process-key router (P4) enqueues these jobs for
onboard + resync flows; the worker dyno runs the SAME adapter pipeline as
the router and writes the VerificationResult back to `strategy_verifications`
via the state-machine RPC.

Three components:
1. **`analytics-service/services/ingestion/long_fetch.py`** — `run_process_key_long_job(job)`
   handler. Reads job.metadata for the captured flag value (drain semantics
   per Pitfall 3), the correlation_id, and the verification_id. Runs the same
   5-method adapter pipeline. State transitions match the synchronous router.
2. **`analytics-service/services/job_worker.py`** — register `process_key_long`
   in the dispatch dict (~L1576-1604) + add `TIMEOUT_PER_KIND['process_key_long'] = 30 * 60`.
3. **`analytics-service/main_worker.py`** — dispatch loop reads
   `is_unified_backbone_active()` once per dispatch tick and passes the value
   as the 3rd arg to `claim_compute_jobs_with_priority` so migration 104's
   drain RPC stamps `unified_backbone_at_claim` metadata at claim time.

**D-2 — Legacy claim drain operational gate:** the worker handler in this plan
returns FAILED-permanent for any claim whose metadata says `unified_backbone_at_claim != 'true'`
(legacy claim or missing metadata). This is intentional: legacy claims pre-date
migration 104 and should NOT be processed by the Phase 19 unified handler. The
operational gate is that PR-B's checklist requires zero in-flight `process_key_long`
jobs at flag-flip time (drain the queue before flipping). Document this in
P5 PR-B runbook + the `process_key_long.drain_skip` log message.

**MC-6 — Watchdog threshold for process_key_long:** the existing `reset_stalled`
watchdog default is 600s, but `process_key_long` jobs run 600-1800s (multi-year
backfill). Without an explicit per-kind threshold, the watchdog reclaims mid-run
and produces duplicate state transitions. Task P6-2 below adds an entry to the
`reset_stalled` per-kind config table mapping `process_key_long` to ≥2340s
(1800s × 1.30 slack).

**Drain semantics enforcement (Pitfall 3):** the handler reads `flag_at_claim`
from `job.metadata['unified_backbone_at_claim']`, NOT from the live env var.
If `flag_at_claim == 'false'`, return `DispatchOutcome.FAILED` with
`error_kind='permanent'` — this means the job was claimed under the legacy
backbone and the unified worker should not re-enter the unified path.
(Legacy claims pre-date migration 104 and have no metadata; treat them the
same — fail with permanent kind.)

Also ships `WIZARD_DUPLICATE` error code in `src/lib/wizardErrors.ts` (BACKBONE-08
UI surface) — when /process-key returns the existing verification_id from a
double-submit, the wizard can render a friendly "you already submitted this;
here's where it landed" envelope. Phase 17 DESIGN-05 contract requires this
to be source-of-truth in `wizardErrors.ts`. Verify the code does not already
exist before adding (Phase 15/16 may have shipped it).

Purpose: Closes BACKBONE-09 (worker handler for long-fetch flows) and the
drain-semantics half of BACKBONE-05 (worker reads claim-time metadata snapshot,
never the live env var). Wave 2 — runs in parallel with P4, P8, P9.

Output: 4 source files (long_fetch.py + job_worker.py extension + main_worker.py
extension + wizardErrors.ts addition) + 1 pytest stub.

Tracking: BACKBONE-05 (drain semantics half), BACKBONE-09 (worker handler).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@analytics-service/services/job_worker.py
@analytics-service/main_worker.py
@analytics-service/main.py
@src/lib/wizardErrors.ts

<interfaces>
<!-- Existing primitives this plan extends. -->

From `analytics-service/services/job_worker.py` (1653 LOC; verified existing):
- Existing kinds at L9-17 docstring + TIMEOUT_PER_KIND dict at L126-138:
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily'
- Dispatch chain at L1576-1604 — pattern: `elif kind == "X": handler = run_X_job`
- `class DispatchOutcome(Enum)` and `class DispatchResult` — used as return shape
- Existing handlers (e.g., `run_sync_trades_job` at L486-707) show the closest analog: read job.metadata, run async work, update DB, return DispatchResult

From `analytics-service/main_worker.py` (verified via main.py:84-86 + 109-114 — worker loop merged into FastAPI lifespan via PR #53):
- Dispatch loop polls `claim_compute_jobs_with_priority(BATCH_SIZE, WORKER_ID)` on a tick
- Migration 104 extended the RPC to accept a 3rd arg `p_unified_backbone_active BOOLEAN DEFAULT NULL`
- This plan updates the call site to pass the flag value

From migration 104 (P2):
- `claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT, p_unified_backbone_active BOOLEAN DEFAULT NULL) RETURNS SETOF compute_jobs`
- Stamps `metadata->>'unified_backbone_at_claim'` with `'true'` | `'false'` | `NULL` at claim time

From P3 (services.ingestion package):
- `from services.ingestion import get_adapter`
- `from services.ingestion.adapter import KeySubmissionRequest, ValidationResult, ...`

From P4 router (analytics-service/routers/process_key.py — pattern to mirror):
- The same 5-method pipeline runs in the worker; only difference is the result writes to strategy_verifications instead of returning to the caller.
- Use `transition_strategy_verification` RPC at each step.

From P4 services/feature_flags.py:
- `from services.feature_flags import is_unified_backbone_active`

From `src/lib/wizardErrors.ts` (Phase 17 DESIGN-05 SoT, 360 LOC):
- Existing error code shape: `{code, title, fix[]}` — title becomes `human_message`, fix[] becomes `debug_context.fix`
- Phase 17 17-03-PLAN added 17 CSV codes; Phase 19 may need WIZARD_DUPLICATE if not present
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P6-1" type="auto" tdd="true">
  <name>Task 1: Write run_process_key_long_job handler in services/ingestion/long_fetch.py + register in job_worker.py</name>
  <files>analytics-service/services/ingestion/long_fetch.py, analytics-service/services/job_worker.py, analytics-service/tests/test_long_fetch.py</files>
  <read_first>
    - analytics-service/services/job_worker.py (FULL file — focus L9-17 docstring, L126-138 TIMEOUT_PER_KIND, L486-707 run_sync_trades_job pattern, L1576-1604 dispatch chain)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1074-1092 — worker handler shape; lines 1240-1295 — dispatch wiring)
    - analytics-service/routers/process_key.py (P4 — pipeline shape to mirror)
    - analytics-service/services/ingestion/adapter.py (P3 — Trade, Position, etc.)
  </read_first>
  <behavior>
    - Test 1 (test_drain_legacy_claim_returns_failed): When job.metadata['unified_backbone_at_claim'] == 'false', handler returns DispatchOutcome.FAILED with error_kind='permanent' (no pipeline run).
    - Test 2 (test_drain_unified_claim_runs_pipeline): When metadata says 'true', handler runs the pipeline and calls transition_strategy_verification RPC.
    - Test 3 (test_drain_missing_metadata_treated_as_legacy): When metadata is None or no `unified_backbone_at_claim` key, handler treats it as legacy claim → FAILED permanent.
    - Test 4 (test_pipeline_idempotent_on_retry): If verification_id already at status='published', handler returns SUCCESS without re-running pipeline (worker retry safety).
    - Test 5 (test_dispatch_dict_routes_process_key_long): The job_worker dispatch chain at L1576-1604 routes kind='process_key_long' to run_process_key_long_job.
    - Test 6 (test_timeout_per_kind_set): TIMEOUT_PER_KIND['process_key_long'] == 30 * 60.
  </behavior>
  <action>
**Part 1:** Create `analytics-service/services/ingestion/long_fetch.py`:

```python
"""Phase 19 / BACKBONE-09 — process_key_long worker handler.

Runs the same 5-method IngestionAdapter pipeline as routers/process_key.py
but for queued (long-fetch) flows. Reads compute_jobs.metadata for:
  - unified_backbone_at_claim — drain check (Pitfall 3); legacy claims FAIL
  - correlation_id, verification_id, flow_type, source

Writes results back to strategy_verifications via transition_strategy_verification
RPC at each step. Idempotent on retry (skips pipeline if verification_id is
already at status='published').
"""
from __future__ import annotations

import logging
from typing import Any

import structlog

from services.db import get_supabase
from services.ingestion import get_adapter
from services.ingestion.adapter import KeySubmissionRequest

log = structlog.get_logger("quantalyze.analytics.long_fetch")


def _metrics_to_jsonb(m) -> dict:
    return {k: v for k, v in m.__dict__.items() if not k.startswith("_")}


async def run_process_key_long_job(job: dict) -> "DispatchResult":
    """Phase 19 / BACKBONE-09 — long-fetch worker handler.

    Returns a DispatchResult; the calling job_worker dispatch loop handles
    mark_compute_job_done / mark_compute_job_failed atomically.
    """
    # Late import to avoid circular dependency at module load.
    from services.job_worker import DispatchOutcome, DispatchResult

    metadata = job.get("metadata") or {}
    verification_id = metadata.get("verification_id")
    flow_type = metadata.get("flow_type")
    source = metadata.get("source")
    correlation_id = metadata.get("correlation_id", "")
    flag_at_claim = metadata.get("unified_backbone_at_claim")

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        verification_id=verification_id,
        flow_type=flow_type,
        source=source,
    )
    log.info("process_key_long.start")

    # Drain check (Pitfall 3 + D-2): legacy claims (or missing metadata) MUST NOT
    # re-enter the unified path. This is the worker-side enforcement of
    # BACKBONE-05 drain semantics.
    #
    # D-2 decision: legacy claims must be DRAINED BEFORE PR-B ships. The Phase 19
    # plan-checker entry condition for PR-B is "compute_jobs queue has zero
    # process_key_long jobs in flight" (operational gate per P5 PR-B checklist).
    # If a legacy claim somehow appears post-PR-B (e.g., an unfinished pre-PR-B
    # job), this handler returns FAILED-permanent so the row moves to failed_final
    # — the founder reviews via /admin/compute-jobs and decides on per-row recovery.
    # See docstring of run_process_key_long_job + .planning/phase-19/rollback-runbook.md
    # Stage A guidance.
    if flag_at_claim != "true":
        log.info("process_key_long.drain_skip", flag_at_claim=flag_at_claim)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                f"process_key_long claimed under legacy backbone "
                f"(unified_backbone_at_claim={flag_at_claim!r}); D-2 — legacy claims "
                f"must be drained pre-PR-B; failed_final triggers /admin review."
            ),
            error_kind="permanent",
        )

    if not verification_id or not source:
        log.error("process_key_long.bad_metadata", metadata=metadata)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="process_key_long: missing verification_id or source in metadata",
            error_kind="permanent",
        )

    supabase = get_supabase()

    # Idempotency: if already published, return success without re-running.
    existing = (
        supabase.table("strategy_verifications")
        .select("status")
        .eq("id", verification_id)
        .maybe_single()
        .execute()
    )
    if existing.data and existing.data.get("status") == "published":
        log.info("process_key_long.already_published_skip")
        return DispatchResult(outcome=DispatchOutcome.SUCCESS)

    # Build the request from the job's strategy + stored credentials.
    # NOTE: For onboard, credentials are in job.metadata.context.
    # For resync, credentials decrypt from strategy_verifications.encrypted_credentials.
    context = metadata.get("context") or {}
    request = KeySubmissionRequest(
        flow_type=flow_type,
        source=source,
        context=context,
    )

    adapter = get_adapter(source)

    # validate
    val = await adapter.validate(request)
    if not val.valid:
        supabase.rpc(
            "transition_strategy_verification",
            {
                "p_verification_id": verification_id,
                "p_new_status": "draft",
                "p_metadata": {
                    "errors": [
                        {"code": val.error_code, "human_message": val.human_message}
                    ]
                },
            },
        ).execute()
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"validate failed: {val.error_code}",
            error_kind="permanent" if val.error_code in {"AUTH_FAILED", "PERMISSION_DENIED"} else "transient",
        )

    supabase.rpc(
        "transition_strategy_verification",
        {"p_verification_id": verification_id, "p_new_status": "validated", "p_metadata": {}},
    ).execute()

    # fetch_raw — the long-fetch step (multi-year backfill)
    trades = await adapter.fetch_raw(context)

    # compute_metrics
    metrics = adapter.compute_metrics(trades)
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "metrics_captured",
            "p_metadata": {"metrics_snapshot": _metrics_to_jsonb(metrics)},
        },
    ).execute()

    # encrypt_credentials (API path only)
    encrypted = None
    if source != "csv":
        from services.encryption import encrypt_credentials, get_kek

        encrypted = encrypt_credentials(
            context["api_key"],
            context["api_secret"],
            context.get("passphrase"),
            get_kek(),
        )
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "encrypted",
            "p_metadata": {"encrypted_credentials": encrypted} if encrypted else {},
        },
    ).execute()

    # compute_fingerprint + persist
    fp = adapter.compute_fingerprint(trades, metrics)
    strategy_id = context.get("strategy_id") or job.get("strategy_id")
    if strategy_id:
        supabase.table("strategies").update({"fingerprint": fp.to_jsonb()}).eq(
            "id", strategy_id
        ).execute()

    supabase.rpc(
        "transition_strategy_verification",
        {"p_verification_id": verification_id, "p_new_status": "report_queued", "p_metadata": {}},
    ).execute()

    # reconstruct_positions (BACKBONE-09 wiring)
    await adapter.reconstruct_positions(trades)

    # Final transition
    supabase.rpc(
        "transition_strategy_verification",
        {"p_verification_id": verification_id, "p_new_status": "published", "p_metadata": {}},
    ).execute()

    log.info("process_key_long.complete")
    return DispatchResult(outcome=DispatchOutcome.SUCCESS)
```

**Part 2:** Update `analytics-service/services/job_worker.py`. Read the file in full first to find:
- the docstring listing kinds (L9-17 area)
- the `TIMEOUT_PER_KIND: dict[str, float]` block (L126-138 area)
- the dispatch chain (L1576-1604 area)

Add to TIMEOUT_PER_KIND:
```python
"process_key_long": 30 * 60,  # Phase 19 / BACKBONE-09 — supports 90-day OKX archive backfill
```

Add to dispatch chain (in the appropriate `elif`):
```python
elif kind == "process_key_long":
    from services.ingestion.long_fetch import run_process_key_long_job
    handler = run_process_key_long_job
```

Update the docstring at L9-17 to include `process_key_long`.

**Part 3:** Create `analytics-service/tests/test_long_fetch.py` with the 6 tests. Use `pytest-asyncio` + mocks for supabase + adapters. For test_drain_legacy_claim_returns_failed and test_drain_missing_metadata, no adapter call should occur (assert via mock).

Test sample:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.job_worker import DispatchOutcome
from services.ingestion.long_fetch import run_process_key_long_job

@pytest.mark.asyncio
async def test_drain_legacy_claim_returns_failed():
    job = {
        "id": "job-1",
        "metadata": {
            "unified_backbone_at_claim": "false",
            "verification_id": "v-1",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-1",
        },
    }
    result = await run_process_key_long_job(job)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "legacy backbone" in result.error_message
```
  </action>
  <acceptance_criteria>
    - File `analytics-service/services/ingestion/long_fetch.py` exists with `run_process_key_long_job` async function
    - `grep -q 'async def run_process_key_long_job' analytics-service/services/ingestion/long_fetch.py`
    - `grep -q 'unified_backbone_at_claim' analytics-service/services/ingestion/long_fetch.py`
    - `grep -q 'transition_strategy_verification' analytics-service/services/ingestion/long_fetch.py`
    - `grep -q 'DispatchOutcome.FAILED' analytics-service/services/ingestion/long_fetch.py`
    - `grep -q 'error_kind="permanent"' analytics-service/services/ingestion/long_fetch.py`
    - `analytics-service/services/job_worker.py` has new `elif kind == "process_key_long"` branch
    - `grep -q "process_key_long" analytics-service/services/job_worker.py`
    - `grep -q "\"process_key_long\": 30 \* 60" analytics-service/services/job_worker.py`
    - File `analytics-service/tests/test_long_fetch.py` exists with 6 test functions
    - `cd analytics-service && python -m pytest tests/test_long_fetch.py -x` exits 0
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/ingestion/long_fetch.py && grep -q "async def run_process_key_long_job" services/ingestion/long_fetch.py && grep -q "unified_backbone_at_claim" services/ingestion/long_fetch.py && grep -q "process_key_long" services/job_worker.py && grep -q "30 \* 60" services/job_worker.py && test -f tests/test_long_fetch.py && grep -q "test_drain_legacy_claim_returns_failed" tests/test_long_fetch.py'
  </automated>
  <requirements>BACKBONE-05, BACKBONE-09</requirements>
</task>

<task id="P6-2" type="auto" tdd="true">
  <name>Task 2: Update main_worker.py dispatch loop to pass unified_backbone flag to claim RPC</name>
  <files>analytics-service/main_worker.py</files>
  <read_first>
    - analytics-service/main_worker.py (FULL file — find the dispatch loop that calls claim_compute_jobs_with_priority; verify the existing 2-arg call signature)
    - analytics-service/main.py (lines 75-148 — lifespan worker merge per PR #53; if main_worker is merged into main.py, modify the relevant block in main.py instead and document the file change)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1468-1491 — drain semantics RPC call site update)
    - analytics-service/services/feature_flags.py (P4 Task 1 — is_unified_backbone_active import)
  </read_first>
  <behavior>
    - Test 1 (already covered by test_drain_semantics.py in P2): claim with p_unified_backbone_active=TRUE writes 'true' to metadata.
    - This task is wiring-only — no new test file. Existing test_drain_semantics.py from P2 verifies the SQL behavior; this task verifies the Python call site passes the flag.
  </behavior>
  <action>
**Read main_worker.py (or main.py if PR #53 merged the worker loop into the FastAPI lifespan).** The existing dispatch tick calls something like:

```python
claimed = supabase.rpc(
    "claim_compute_jobs_with_priority",
    {
        "p_batch_size": BATCH_SIZE,
        "p_worker_id": WORKER_ID,
    },
).execute()
```

**Update to:**

```python
from services.feature_flags import is_unified_backbone_active

# Inside the dispatch loop, BEFORE the claim RPC call:
flag_active = await is_unified_backbone_active()

claimed = supabase.rpc(
    "claim_compute_jobs_with_priority",
    {
        "p_batch_size": BATCH_SIZE,
        "p_worker_id": WORKER_ID,
        "p_unified_backbone_active": flag_active,  # Phase 19 / BACKBONE-09 drain
    },
).execute()
```

**IMPORTANT:**
- The 30s cache in `is_unified_backbone_active()` means this is cheap (~99.9% cache hits).
- The 3rd arg is `DEFAULT NULL` per migration 104, so old call sites that don't yet pass it get NULL stamped — backward compatible.
- If the claim loop is in main.py (PR #53 lifespan merge) rather than main_worker.py, modify the lifespan dispatch block in main.py instead. Read both files first to determine the actual location.

If main_worker.py is the entry point: import + use as above.
If main.py lifespan: same pattern, applied inside the lifespan async block.
  </action>
  <acceptance_criteria>
    - The dispatch loop file (whether main_worker.py or main.py lifespan) imports `is_unified_backbone_active` from `services.feature_flags`
    - Call site to `claim_compute_jobs_with_priority` includes `"p_unified_backbone_active": flag_active` (or equivalent third-arg passthrough)
    - `grep -E "p_unified_backbone_active" analytics-service/main_worker.py analytics-service/main.py 2>/dev/null` returns at least one match
    - Existing pytest test_drain_semantics.py from P2 still passes (no regression)
    - **H-5 caller enumeration:** every `claim_compute_jobs_with_priority(...)` call site has been audited and updated to pass the 3rd arg explicitly. Verify with:
      ```bash
      grep -rE 'claim_compute_jobs_with_priority\(.*?\)' --include='*.py' --include='*.ts' analytics-service/ src/ | tee /tmp/h5-callsites.txt
      ```
      For each call site listed in `/tmp/h5-callsites.txt`, the call MUST pass three arguments (or use the keyword form `p_unified_backbone_active=...`). Two-arg calls are blocked.
    - **H-5 PostgREST version verify:** Supabase project's PostgREST version ≥12 (PG12+ tolerates default-NULL added args). Verify via Supabase Dashboard → Project Settings → Infrastructure, OR `mcp__supabase__execute_sql --query "SELECT current_setting('server_version_num')::int"` (≥120000). Record the version in the task summary.
    - **MC-6 watchdog threshold:** `services/job_worker.py` `reset_stalled` config has an explicit `process_key_long` entry with threshold ≥1800s + 30% slack = 2340s (or higher). Without this, the 30-min long-fetch jobs get reclaimed mid-run and produce duplicate state transitions.
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && grep -rE "p_unified_backbone_active" main_worker.py main.py services/feature_flags.py | head -3 | grep -q "p_unified_backbone_active" && grep -rE "is_unified_backbone_active" main_worker.py main.py | grep -q "is_unified_backbone_active" && grep -E "process_key_long.*23[4-9][0-9]|process_key_long.*[2-9][0-9]{3}" services/job_worker.py | grep -qE "process_key_long"'
  </automated>
  <requirements>BACKBONE-05, BACKBONE-09</requirements>
</task>

<task id="P6-3" type="auto">
  <name>Task 3: Add WIZARD_DUPLICATE error code to wizardErrors.ts (verify if already present)</name>
  <files>src/lib/wizardErrors.ts</files>
  <read_first>
    - src/lib/wizardErrors.ts (FULL file — 360 LOC; search for existing WIZARD_DUPLICATE / DUPLICATE / IDEMPOTENT codes; verify shape `{code, title, fix[]}`)
    - .planning/phases/17-design-contract/17-CONTEXT.md (DESIGN-05 contract — wizardErrors.ts is source-of-truth for human_message)
    - DESIGN.md (verify error envelope shape)
  </read_first>
  <action>
Read `src/lib/wizardErrors.ts` in full. Search for existing entries matching `DUPLICATE` or `IDEMPOTENT`. If `WIZARD_DUPLICATE` (or equivalent semantic) already exists, this task is a no-op — verify and document. Otherwise, add a new entry following the existing shape.

If adding, the entry should look like (adjust to match the actual data structure in wizardErrors.ts):

```typescript
WIZARD_DUPLICATE: {
  code: "WIZARD_DUPLICATE",
  title: "You've already submitted this strategy",
  fix: [
    "We found an existing submission with the same wizard session.",
    "Open the strategy from your dashboard to view its current status.",
    "If you intended to submit a new strategy, start a fresh wizard session.",
  ],
} as const,
```

The `title` becomes `human_message` and `fix[]` becomes `debug_context.fix` per DESIGN-05.

Do NOT introduce new design tokens or colors — Theme 1 / DESIGN-01 forbids implementer-improvised UI without explicit DESIGN.md sanction. The trust-tier badge + envelope rendering are unchanged; only the textual content for this code is added.
  </action>
  <acceptance_criteria>
    - `src/lib/wizardErrors.ts` contains an entry with code matching `/WIZARD_DUPLICATE|DUPLICATE|IDEMPOTENT/` describing the wizard double-submit case
    - Adding the entry does NOT introduce new color tokens, design tokens, or font choices (DESIGN.md compliance)
    - **H-4 (replaces grep-only acceptance):** `npx tsc --noEmit` exits 0 — the new code added to the discriminated union and `WIZARD_ERROR_COPY` Record actually compiles. A literal in a comment is NOT sufficient.
    - **H-4:** `WIZARD_ERROR_COPY['WIZARD_DUPLICATE']` is present in `src/lib/wizardErrors.ts` AND its shape is valid (object with `title: string` and `fix: string[]`). Verify via vitest:

      ```typescript
      // tests/lib/wizard-errors-shape.test.ts
      import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
      it("WIZARD_DUPLICATE has shape-valid copy", () => {
        const entry = WIZARD_ERROR_COPY["WIZARD_DUPLICATE"];
        expect(entry).toBeDefined();
        expect(typeof entry.title).toBe("string");
        expect(Array.isArray(entry.fix)).toBe(true);
        expect(entry.fix.length).toBeGreaterThan(0);
      });
      ```
    - **H-4:** vitest case rendering the duplicate state through the existing `formatKeyError` (or equivalent envelope-renderer) returns a string containing the WIZARD_DUPLICATE title.
    - Vitest catalog test verifying every wizardErrors entry has shape `{code, title, fix[]}` still passes.
  </acceptance_criteria>
  <automated>
    bash -c 'grep -E "WIZARD_DUPLICATE|DUPLICATE|IDEMPOTENT" src/lib/wizardErrors.ts | head -3 | grep -qE "code.*(DUPLICATE|IDEMPOTENT)" && npx tsc --noEmit && grep -q "WIZARD_DUPLICATE" tests/lib/wizard-errors-shape.test.ts 2>/dev/null'
  </automated>
  <requirements>BACKBONE-08</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Worker dyno → encrypted credentials in compute_jobs.metadata | sensitive — credentials may transit metadata if context carries them; redact.py wired at structlog processor |
| Worker dyno → /process-key adapter pipeline | same trust as P4 router (INTERNAL_API_TOKEN-equivalent — service-role Supabase access) |
| dispatch loop → live env var | Pitfall 3 — drain semantics REQUIRE worker to read claim-time metadata snapshot, NOT live env var |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-30 | Tampering | drain semantics split-brain | mitigate | Pitfall 3 — handler reads `job.metadata.unified_backbone_at_claim` ONLY (never `is_unified_backbone_active()` mid-job); legacy claims (flag='false' or missing) return DispatchOutcome.FAILED with permanent error_kind |
| T-19-31 | Information disclosure | api_key/api_secret in compute_jobs.metadata.context | mitigate | KEK-encrypted before persist via existing `services/encryption.py` for resync flow; for onboard, raw credentials live in metadata transiently — redact.py at sentry_init.before_send + structlog processor scrubs on every log boundary; metadata is service-role-only via existing compute_jobs RLS |
| T-19-32 | Tampering | worker retries duplicate state transitions | mitigate | RPC `transition_strategy_verification` rejects illegal transitions (CHECK constraint); idempotency check at handler entry returns SUCCESS without re-running pipeline if already 'published' |
| T-19-33 | DoS | worker timeout on multi-year archive backfill | mitigate | TIMEOUT_PER_KIND['process_key_long'] = 30 * 60 (30 min ceiling); 90-day OKX archive ~10 min on 2 years of trades; 30 min handles long tail |
| T-19-34 | Repudiation | dispatch dict drift between job_worker.py and long_fetch.py | mitigate | self-verifying DO block in migration 104 asserts compute_jobs.kind admits 'process_key_long'; pytest test_dispatch_dict_routes_process_key_long verifies Python wiring |
</threat_model>

<verification>
- All 4 source files modified or created (long_fetch.py, job_worker.py, main_worker.py, wizardErrors.ts).
- 1 pytest stub (`test_long_fetch.py`) ships with 6 test functions covering drain + idempotency + dispatch wiring + timeout.
- `cd analytics-service && python -c "from services.ingestion.long_fetch import run_process_key_long_job; print('ok')"` succeeds.
- Existing test_drain_semantics.py from P2 still passes (Python call site updated to pass 3rd arg).
- WIZARD_DUPLICATE entry matches the existing wizardErrors.ts shape; no new design tokens introduced.
</verification>

<success_criteria>
- BACKBONE-09 worker handler ships: process_key_long jobs claim via existing dispatch chain and run the full adapter pipeline.
- BACKBONE-05 drain semantics enforced at handler entry: legacy claims (flag_at_claim != 'true') return FAILED permanent; live env var never read mid-job.
- main_worker.py / main.py dispatch loop passes the flag value to claim RPC 3rd arg every tick.
- TIMEOUT_PER_KIND['process_key_long'] = 30 * 60.
- WIZARD_DUPLICATE error code shipped (or verified existing) for wizard idempotent-resubmit UI surface.
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-06-SUMMARY.md`
</output>
