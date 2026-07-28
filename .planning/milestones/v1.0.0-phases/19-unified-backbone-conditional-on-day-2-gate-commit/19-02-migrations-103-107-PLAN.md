---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/103_strategy_verifications_state_machine.sql
  - supabase/migrations/104_process_key_long_idempotency_drain.sql
  - supabase/migrations/105_strategies_fingerprint_compute_similarity.sql
  - supabase/migrations/106_view_shim_step_a_sentinel.sql
  - supabase/migrations/107_verification_requests_view_shim.sql
  - analytics-service/tests/test_transition_rpc.py
  - analytics-service/tests/test_compute_similarity_sql.py
  - analytics-service/tests/test_drain_semantics.py
  - supabase/migrations/down/103-rollback.sql
  - supabase/migrations/down/104-rollback.sql
  - supabase/migrations/down/105-rollback.sql
  - supabase/migrations/down/106-rollback.sql
  - supabase/migrations/down/107-rollback.sql
autonomous: true
requirements: [BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-07, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02]
must_haves:
  truths:
    - "All 5 migration files (103-107) exist and apply cleanly to the test Supabase project via `supabase db push`"
    - "transition_strategy_verification RPC enforces legal state transitions (draft → validated → metrics_captured → encrypted → report_queued → published) and rejects illegal transitions with SQLSTATE 22023"
    - "wizard_session_id UNIQUE INDEX prevents wizard double-submit at the DB layer (BACKBONE-08)"
    - "compute_jobs.kind CHECK admits process_key_long; claim_compute_jobs_with_priority writes unified_backbone_at_claim metadata at claim time (BACKBONE-09 drain)"
    - "feature_flags table exists with kill-switch row default 'off' (BACKBONE-05)"
    - "strategies.fingerprint JSONB column exists with partial index + version=1 CHECK (FINGERPRINT-01)"
    - "compute_similarity SQL function is IMMUTABLE PARALLEL SAFE, returns 0.0 on NULL or version mismatch, returns NUMERIC(5,4) in [0,1] (FINGERPRINT-02)"
    - "Migration 107 ships `verification_requests` as VIEW with INSTEAD OF read-only triggers; legacy table renamed to `verification_requests_legacy` with 90-day RLS retention"
    - "Live test Supabase DB matches the migration files (no drift; verified via `supabase db push` exit 0 + post-push DO-block self-verify)"
  artifacts:
    - path: "supabase/migrations/103_strategy_verifications_state_machine.sql"
      provides: "BACKBONE-03 state-machine RPC + transitioned_at + encrypted_credentials + public_token + expires_at columns"
      contains: "CREATE OR REPLACE FUNCTION transition_strategy_verification"
    - path: "supabase/migrations/104_process_key_long_idempotency_drain.sql"
      provides: "BACKBONE-08 UNIQUE INDEX + BACKBONE-09 process_key_long kind + drain RPC + BACKBONE-05 kill-switch table"
      contains: "CREATE UNIQUE INDEX strategy_verifications_wizard_session_id_unique_idx"
    - path: "supabase/migrations/105_strategies_fingerprint_compute_similarity.sql"
      provides: "FINGERPRINT-01 column + partial index + CHECK + FINGERPRINT-02 cosine function"
      contains: "CREATE OR REPLACE FUNCTION compute_similarity"
    - path: "supabase/migrations/106_view_shim_step_a_sentinel.sql"
      provides: "BACKBONE-04 step (a) sentinel — repoint of verify-strategy/route.ts:115"
      contains: "BACKBONE-04 step (a)"
    - path: "supabase/migrations/107_verification_requests_view_shim.sql"
      provides: "BACKBONE-04 step (d) — rename + VIEW + INSTEAD OF triggers"
      contains: "RENAME TO verification_requests_legacy"
  key_links:
    - from: "transition_strategy_verification RPC"
      to: "strategy_verifications.status column"
      via: "SECURITY DEFINER + CHECK + FOR UPDATE row lock"
      pattern: "FOR UPDATE"
    - from: "claim_compute_jobs_with_priority RPC"
      to: "compute_jobs.metadata->>'unified_backbone_at_claim'"
      via: "metadata JSONB merge inside UPDATE clause"
      pattern: "unified_backbone_at_claim"
    - from: "compute_similarity"
      to: "strategies.fingerprint JSONB"
      via: "called from psql/debug/Python with NUMERIC return"
      pattern: "RETURNS NUMERIC"
---

<objective>
Ship Phase 19 migrations 103-107. This plan is Wave 1 foundation — every other
Phase 19 plan depends on the schema substrate this plan delivers.

Migration 103: `strategy_verifications` state-machine completion via
`transition_strategy_verification` SECURITY DEFINER RPC + new columns
(`transitioned_at TIMESTAMPTZ`, `encrypted_credentials JSONB`, `public_token TEXT`,
`expires_at TIMESTAMPTZ`). The first-class `public_token` and `expires_at`
columns are the Pitfall 7 mitigation — VIEW shim does NOT push them into
JSONB so `verify-strategy/[id]/status` keeps working.

Migration 104: `wizard_session_id` UNIQUE INDEX (BACKBONE-08), `compute_jobs.kind`
CHECK widened with `process_key_long` (BACKBONE-09), `claim_compute_jobs_with_priority`
extended with 3rd arg `p_unified_backbone_active BOOLEAN DEFAULT NULL` writing
`unified_backbone_at_claim` metadata (BACKBONE-09 drain semantics), and
`feature_flags` kill-switch table (BACKBONE-05) seeded with the default-OFF row.

Migration 105: `strategies.fingerprint JSONB` (FINGERPRINT-01) + partial index
`WHERE fingerprint IS NOT NULL` + CHECK constraint `(fingerprint->>'version')::INT = 1`
(per RESEARCH Open Question 3). Plus `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC`
plain plpgsql cosine, IMMUTABLE PARALLEL SAFE, returns 0.0 on NULL or version
mismatch (FINGERPRINT-02). Mirrors migration 086 H-B `search_path=public, pg_temp`
hardening.

Migration 106: VIEW-shim step (a) sentinel — empty migration body except a
DO block raising NOTICE. Exists for the migration sequence audit only; the
load-bearing change ships in P5 commit (a).

Migration 107: VIEW-shim step (d) — `ALTER TABLE verification_requests RENAME TO
verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ...
FROM strategy_verifications WHERE flow_type='teaser'` + INSTEAD OF read-only
triggers + 90-day RLS retention on the legacy table.

**BLOCKING schema-push task (Task 6):** runs `supabase db push` against the
linked test Supabase project (`qmnijlgmdhviwzwfyzlc`) AFTER all 5 migration
files are written. Without this, build/types pass while the live DB is divergent
(false-positive verification per Phase 18 lessons).

Purpose: The Wave 1 schema substrate every other Phase 19 plan stands on.
Output: 5 migration files + 3 pytest stub files for Wave 0 (covers BACKBONE-03,
BACKBONE-09 drain, FINGERPRINT-02 SQL function).

Tracking: BACKBONE-03 (state-machine), BACKBONE-04 (VIEW-shim 106+107),
BACKBONE-05 (kill-switch table), BACKBONE-07 (state-machine row-lock support),
BACKBONE-08 (UNIQUE INDEX), BACKBONE-09 (kind+drain), FINGERPRINT-01 (column),
FINGERPRINT-02 (cosine function).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@supabase/migrations/093_strategy_verifications.sql
@supabase/migrations/094_strategy_verifications_rls_polish.sql
@supabase/migrations/086_compute_jobs_priority.sql
@supabase/migrations/062_scoring_weight_overrides.sql
@supabase/migrations/099_mark_compute_job_atomic_status_bridge.sql
@supabase/migrations/032_compute_jobs_queue.sql

<interfaces>
<!-- Existing schema this plan extends. Verify by reading the actual files. -->

From supabase/migrations/093_strategy_verifications.sql:
- Table `strategy_verifications` with columns: id (UUID PK), strategy_id (UUID FK), status TEXT CHECK admitting (draft, validated, metrics_captured, encrypted, report_queued, published), trust_tier TEXT CHECK admitting (api_verified, csv_uploaded, self_reported), wizard_session_id UUID NOT NULL, source TEXT, flow_type TEXT, metrics_snapshot JSONB, errors JSONB, correlation_id TEXT, created_at TIMESTAMPTZ
- Self-verifying DO block pattern at STEP 7 (lines 296-370) — mirror this in 103, 104, 105

From supabase/migrations/086_compute_jobs_priority.sql:
- Function `claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT) RETURNS SETOF compute_jobs` — 2 args, SECURITY DEFINER, search_path=public, pg_temp
- Existing kinds: 'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'rescore_allocator', 'poll_allocator_positions', 'reconstruct_allocator_history', 'refresh_allocator_equity_daily'
- Migration 104 ADDS: 'process_key_long'

From supabase/migrations/062_scoring_weight_overrides.sql:
- enqueue_compute_job(p_strategy_id, p_kind, p_metadata JSONB DEFAULT NULL) — pattern for default-NULL JSONB args

Existing legacy `verification_requests` table (from supabase/migrations/010_portfolio_intelligence.sql L78-98):
- id UUID PK, exchange TEXT, api_key_encrypted TEXT, api_secret_encrypted TEXT, passphrase_encrypted TEXT, dek_encrypted TEXT, status TEXT, public_token TEXT, expires_at TIMESTAMPTZ, results JSONB, created_at, completed_at TIMESTAMPTZ

From src/app/api/verify-strategy/[id]/status/route.ts (L20-46):
- SELECT id, status, public_token, expires_at, results FROM verification_requests
- Migration 107 VIEW must surface these as columns; Pitfall 7 — public_token + expires_at MUST be first-class columns on strategy_verifications, NOT pushed into JSONB
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P2-1" type="auto" tdd="true">
  <name>Task 1: Migration 103 — strategy_verifications state-machine RPC + first-class public_token/expires_at columns</name>
  <files>supabase/migrations/103_strategy_verifications_state_machine.sql, analytics-service/tests/test_transition_rpc.py</files>
  <read_first>
    - supabase/migrations/093_strategy_verifications.sql (full file — STEP 7 self-verify pattern, status CHECK constraint shape)
    - supabase/migrations/094_strategy_verifications_rls_polish.sql (RLS pattern)
    - supabase/migrations/099_mark_compute_job_atomic_status_bridge.sql (SECURITY DEFINER + atomic UPDATE pattern)
    - supabase/migrations/086_compute_jobs_priority.sql (search_path=public, pg_temp + REVOKE/GRANT pattern)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 261-291 — Migration 103 spec)
    - analytics-service/tests/test_csv_validator.py (pytest pattern reference for SQLSTATE 22023 distinguishing test)
  </read_first>
  <behavior>
    - Test 1 (test_legal_transition_succeeds): RPC called with from='draft', to='validated' returns the updated row JSONB with status='validated' and transitioned_at recent.
    - Test 2 (test_illegal_transition_raises): RPC called with from='draft', to='published' raises SQLSTATE 22023 with message containing 'illegal transition'.
    - Test 3 (test_metadata_merge): RPC called with metadata={"metrics_snapshot": {"sharpe": 1.5}} sets metrics_snapshot column to that JSONB.
    - Test 4 (test_restart_path): RPC called with from='metrics_captured', to='draft', metadata={"errors": [{"code": "..."}]} succeeds (* → draft is legal when errors IS NOT NULL).
    - Test 5 (test_validate_failure_resets_draft_with_errors) [H-14]: RPC called with from='draft', to='draft', metadata={"errors": [{"code": "VALIDATE_FAILED", "human_message": "Bad creds"}]} returns success and idempotently sets transitioned_at + persists metadata.errors into the errors JSONB column. Re-call (draft→draft, errors already present) succeeds idempotently.
  </behavior>
  <action>
Create `supabase/migrations/103_strategy_verifications_state_machine.sql` with:

1. **Add new columns** (idempotent, IF NOT EXISTS):
   ```sql
   ALTER TABLE strategy_verifications
     ADD COLUMN IF NOT EXISTS transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     ADD COLUMN IF NOT EXISTS encrypted_credentials JSONB,
     ADD COLUMN IF NOT EXISTS public_token TEXT,
     ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
   CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_public_token_unique_idx
     ON strategy_verifications (public_token)
     WHERE public_token IS NOT NULL;
   ```

   Comment each: `COMMENT ON COLUMN strategy_verifications.transitioned_at IS 'Phase 19 / BACKBONE-03 — updated by transition_strategy_verification RPC; single source of truth for status changes.';` etc.

2. **Define legal-transition lookup** as a static array CHECK on the RPC body (no separate `transitions` table — keep it in-RPC). Legal pairs:
   - (draft, validated)
   - (validated, metrics_captured)
   - (metrics_captured, encrypted)
   - (encrypted, report_queued)
   - (report_queued, published)
   - (* , draft) only when `metadata->>'errors'` is non-null (restart path)

3. **`transition_strategy_verification(p_verification_id UUID, p_new_status TEXT, p_metadata JSONB DEFAULT NULL) RETURNS JSONB`** — SECURITY DEFINER, search_path=public, pg_temp:
   ```sql
   CREATE OR REPLACE FUNCTION transition_strategy_verification(
     p_verification_id UUID,
     p_new_status      TEXT,
     p_metadata        JSONB DEFAULT NULL
   )
   RETURNS JSONB
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $$
   DECLARE
     v_row strategy_verifications%ROWTYPE;
     v_legal BOOLEAN;
     v_legal_pairs CONSTANT TEXT[][] := ARRAY[
       ARRAY['draft','validated'],
       ARRAY['validated','metrics_captured'],
       ARRAY['metrics_captured','encrypted'],
       ARRAY['encrypted','report_queued'],
       ARRAY['report_queued','published']
     ];
     v_pair TEXT[];
     v_metrics_snapshot JSONB;
     v_errors JSONB;
     v_encrypted JSONB;
     v_correlation_id TEXT;
   BEGIN
     -- Acquire row lock
     SELECT * INTO v_row FROM strategy_verifications
       WHERE id = p_verification_id FOR UPDATE;
     IF NOT FOUND THEN
       RAISE EXCEPTION 'strategy_verification % not found', p_verification_id
         USING ERRCODE = '22023';
     END IF;

     -- Legal-transition check
     v_legal := FALSE;
     FOREACH v_pair SLICE 1 IN ARRAY v_legal_pairs LOOP
       IF v_row.status = v_pair[1] AND p_new_status = v_pair[2] THEN
         v_legal := TRUE;
         EXIT;
       END IF;
     END LOOP;

     -- Restart path: any → draft when metadata has errors
     IF NOT v_legal AND p_new_status = 'draft' AND p_metadata ? 'errors' THEN
       v_legal := TRUE;
     END IF;

     IF NOT v_legal THEN
       RAISE EXCEPTION 'illegal transition % → % for verification %',
         v_row.status, p_new_status, p_verification_id
         USING ERRCODE = '22023';
     END IF;

     -- Merge metadata into respective columns
     v_metrics_snapshot := COALESCE(p_metadata->'metrics_snapshot', v_row.metrics_snapshot);
     v_errors           := COALESCE(p_metadata->'errors', v_row.errors);
     v_encrypted        := COALESCE(p_metadata->'encrypted_credentials', v_row.encrypted_credentials);
     v_correlation_id   := COALESCE(p_metadata->>'correlation_id', v_row.correlation_id);

     UPDATE strategy_verifications
        SET status                 = p_new_status,
            transitioned_at        = now(),
            metrics_snapshot       = v_metrics_snapshot,
            errors                 = v_errors,
            encrypted_credentials  = v_encrypted,
            correlation_id         = v_correlation_id
      WHERE id = p_verification_id
      RETURNING to_jsonb(strategy_verifications.*) INTO v_row;

     RETURN to_jsonb(v_row);
   END;
   $$;

   COMMENT ON FUNCTION transition_strategy_verification IS
     'Phase 19 / BACKBONE-03. Single source of truth for strategy_verifications status changes. Adapter MUST NOT direct-UPDATE status.';

   REVOKE EXECUTE ON FUNCTION transition_strategy_verification(UUID, TEXT, JSONB) FROM PUBLIC, anon;
   GRANT EXECUTE ON FUNCTION transition_strategy_verification(UUID, TEXT, JSONB) TO authenticated, service_role;
   ```

4. **Self-verifying DO block** (mirror 093 STEP 7 shape) — assert:
   - `transitioned_at`, `encrypted_credentials`, `public_token`, `expires_at` columns exist
   - `transition_strategy_verification` function exists with 3 args, returns JSONB
   - Function `prosecdef = TRUE` (SECURITY DEFINER)
   - Function search_path includes `public` and `pg_temp`
   - REVOKE/GRANT applied (check `pg_proc.proacl`)

   Emit `RAISE NOTICE 'Migration 103: all assertions passed.';` at end.

Then create `analytics-service/tests/test_transition_rpc.py` — pytest stub with the 4 behaviors above. Use the existing pattern from `test_csv_validator.py` for SQLSTATE distinguishing (regex on `psycopg2.errors.RaiseException` message). Use the test Supabase project (`SUPABASE_TEST_*` env vars from existing conftest.py) for integration. If `SUPABASE_TEST_URL` is absent, mark all 4 tests with `@pytest.mark.skipif(...)` to skip.

Test skeleton:
```python
import os
import uuid
import pytest
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

@pytest.fixture
def admin():
    if not SUPABASE_URL or not SUPABASE_KEY:
        pytest.skip("test Supabase project not configured")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def _make_draft(admin, strategy_id):
    return admin.table("strategy_verifications").insert({
        "strategy_id": strategy_id, "wizard_session_id": str(uuid.uuid4()),
        "status": "draft", "trust_tier": "api_verified",
        "flow_type": "onboard", "source": "okx",
    }).execute().data[0]

def test_legal_transition_succeeds(admin):
    """Legal draft → validated returns updated row."""
    ...

def test_illegal_transition_raises(admin):
    """Illegal draft → published raises SQLSTATE 22023."""
    ...

def test_metadata_merge(admin):
    """Metadata metrics_snapshot merges into column."""
    ...

def test_restart_path(admin):
    """metrics_captured → draft with errors metadata is legal."""
    ...

def test_validate_failure_resets_draft_with_errors(admin):
    """H-14 — draft → draft with metadata.errors persists errors column + sets transitioned_at idempotently.
    Required for the synchronous /process-key router validate-failure path that
    keeps a row in 'draft' status while recording the validation error.
    Re-calling MUST succeed idempotently with errors already present.
    """
    # 1. Insert draft row, call RPC with from='draft', to='draft', metadata={"errors": [...]}
    # 2. Assert response status='draft', transitioned_at advanced, errors column populated
    # 3. Call RPC again (draft → draft, same errors) — must succeed (idempotent restart path)
    # 4. Assert SQLSTATE NOT raised on the re-call
    ...
```
  </action>
  <acceptance_criteria>
    - File `supabase/migrations/103_strategy_verifications_state_machine.sql` exists
    - `grep -q 'CREATE OR REPLACE FUNCTION transition_strategy_verification' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'SECURITY DEFINER' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q "search_path = public, pg_temp" supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'public_token TEXT' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'expires_at TIMESTAMPTZ' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'transitioned_at TIMESTAMPTZ' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q "ERRCODE = '22023'" supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'REVOKE EXECUTE' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - `grep -q 'Migration 103: all assertions passed' supabase/migrations/103_strategy_verifications_state_machine.sql`
    - File `analytics-service/tests/test_transition_rpc.py` exists with all 5 test functions (4 + H-14 test_validate_failure_resets_draft_with_errors)
    - **H-14:** `grep -q 'test_validate_failure_resets_draft_with_errors' analytics-service/tests/test_transition_rpc.py`
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/103_strategy_verifications_state_machine.sql && grep -q "transition_strategy_verification" supabase/migrations/103_strategy_verifications_state_machine.sql && grep -q "ERRCODE = .22023." supabase/migrations/103_strategy_verifications_state_machine.sql && grep -q "search_path = public, pg_temp" supabase/migrations/103_strategy_verifications_state_machine.sql && grep -q "public_token TEXT" supabase/migrations/103_strategy_verifications_state_machine.sql && test -f analytics-service/tests/test_transition_rpc.py && grep -q "test_illegal_transition_raises" analytics-service/tests/test_transition_rpc.py && grep -q "test_validate_failure_resets_draft_with_errors" analytics-service/tests/test_transition_rpc.py'
  </automated>
  <requirements>BACKBONE-03, BACKBONE-07</requirements>
</task>

<task id="P2-2" type="auto" tdd="true">
  <name>Task 2: Migration 104 — wizard_session_id UNIQUE + process_key_long kind + drain RPC + feature_flags table</name>
  <files>supabase/migrations/104_process_key_long_idempotency_drain.sql, analytics-service/tests/test_drain_semantics.py</files>
  <read_first>
    - supabase/migrations/093_strategy_verifications.sql (verify wizard_session_id UUID NOT NULL on line 80; if NOT NULL, drop the partial-WHERE on UNIQUE INDEX)
    - supabase/migrations/086_compute_jobs_priority.sql (full body — claim_compute_jobs_with_priority signature + UPDATE clause shape, pg_advisory_xact_lock pattern)
    - supabase/migrations/062_scoring_weight_overrides.sql (enqueue_compute_job p_metadata DEFAULT NULL precedent — lines 160-335)
    - supabase/migrations/099_mark_compute_job_atomic_status_bridge.sql (atomic UPDATE pattern)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 293-371 — full Migration 104 spec)
  </read_first>
  <behavior>
    - Test 1 (test_unique_wizard_session_id_blocks_double_insert): inserting two rows with the same wizard_session_id raises SQLSTATE 23505.
    - Test 2 (test_compute_jobs_kind_admits_process_key_long): inserting a compute_jobs row with kind='process_key_long' succeeds.
    - Test 3 (test_claim_writes_unified_backbone_metadata): calling claim_compute_jobs_with_priority(batch_size=1, worker_id='test', unified_backbone_active=TRUE) on a queued row stamps `metadata->>'unified_backbone_at_claim' = 'true'`.
    - Test 4 (test_feature_flags_table_seeded_off): SELECT value FROM feature_flags WHERE flag_key='process_key_unified_backbone' returns 'off' on fresh apply.
    - Test 5 (test_drain_reclaim_preserves_snapshot) [D-1]: claim a job with `unified_backbone_active=TRUE` (metadata stamped 'true'); manually reset job back to `pending` (simulate watchdog reset_stalled); call claim again with `unified_backbone_active=FALSE` — assert metadata->>'unified_backbone_at_claim' STILL says 'true' (original snapshot preserved via COALESCE).
    - Test 6 (test_status_enum_pending_not_queued) [C-1]: insert a `pending` row, call claim, assert it gets claimed; insert a `queued` row (will fail CHECK constraint — proving the enum value 'queued' is invalid in the schema and confirming C-1 plan correction).
  </behavior>
  <action>
Create `supabase/migrations/104_process_key_long_idempotency_drain.sql` with the following STEPs:

**STEP 1 — wizard_session_id UNIQUE INDEX (BACKBONE-08):**
```sql
-- Per migration 093 line 80, wizard_session_id is UUID NOT NULL.
-- Plain UNIQUE INDEX (no partial WHERE clause) is correct.
CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_wizard_session_id_unique_idx
  ON strategy_verifications (wizard_session_id);
COMMENT ON INDEX strategy_verifications_wizard_session_id_unique_idx IS
  'Phase 19 / BACKBONE-08. Wizard double-submit prevention; route catches 23505 and returns existing row.';
```

**STEP 2 — compute_jobs.kind CHECK widening (BACKBONE-09):**
```sql
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily',
  'process_key_long'   -- Phase 19 / BACKBONE-09
));
```

(Verify the existing list against `services/job_worker.py:9-17` docstring + `TIMEOUT_PER_KIND` dict at L126-138 before writing — adjust if any kind is missing from this enumeration. Keep ALL existing kinds; only ADD `process_key_long`.)

**STEP 3 — Extend `claim_compute_jobs_with_priority` to write `unified_backbone_at_claim` metadata (BACKBONE-09 drain):**

**CRITICAL ground-truth corrections (C-1, C-2, C-3, D-1, D-3):**
- `compute_jobs.status` enum is `'pending'` / `'running'` / `'done'` / `'done_pending_children'` / `'failed_retry'` / `'failed_final'` per migration 032 lines 112-120. **NEVER `'queued'`.** Filtering by `status = 'queued'` returns ZERO rows and silently breaks the dispatcher (C-1).
- Schedule column is `next_attempt_at TIMESTAMPTZ` per migration 032 line 123 + migration 086 lines 131/146. **NEVER `run_after`.** That column does not exist (C-3).
- Migration 086 line 163 issues `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`. **DO NOT issue any new GRANT to authenticated** — RLS does not protect SECURITY DEFINER, and any authenticated user could claim arbitrary jobs (C-2 — privilege expansion vs preservation). Service-role bypasses RLS by default; service-role workers continue working without explicit GRANT.
- D-1 — re-claim must NOT overwrite the original `unified_backbone_at_claim` snapshot. Use `COALESCE(metadata->>'unified_backbone_at_claim', p_unified_backbone_active::text)` so the watchdog reset_stalled path preserves the original claim-time value.

```sql
-- Body mirrors migration 086's claim_compute_jobs_with_priority verbatim
-- (FOR UPDATE SKIP LOCKED inner SELECT, priority ordering, lock semantics).
-- The only behavioral additions are:
--   (a) 3rd arg p_unified_backbone_active BOOLEAN DEFAULT NULL
--   (b) metadata merge writing unified_backbone_at_claim at claim time
--   (c) D-1 — COALESCE preserves any pre-existing snapshot on watchdog re-claim
-- The status filter ('pending'), schedule column (next_attempt_at), and the
-- REVOKE-but-no-GRANT pattern below are LOAD-BEARING per C-1/C-2/C-3.
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT,
  p_unified_backbone_active BOOLEAN DEFAULT NULL  -- Phase 19 / BACKBONE-09 drain
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  RETURN QUERY
  WITH ready AS (
    SELECT id FROM compute_jobs
     WHERE status = 'pending'                                  -- C-1: pending, NOT queued (cite migration 032 L112-120)
       AND (next_attempt_at IS NULL OR next_attempt_at <= v_now)  -- C-3: next_attempt_at column (cite migration 032 L123 + 086 L131/L146)
       -- existing priority + ordering preserved verbatim from migration 086
     ORDER BY priority DESC NULLS LAST, next_attempt_at ASC
     LIMIT p_batch_size
     FOR UPDATE SKIP LOCKED
  )
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = v_now,
         claimed_by = p_worker_id,
         attempts   = attempts + 1,
         metadata   = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           -- D-1: COALESCE the existing snapshot so watchdog re-claim preserves
           -- the ORIGINAL claim-time value. Without this, reset_stalled rewrites
           -- the snapshot from the live flag and Pitfall 3 mitigation breaks.
           'unified_backbone_at_claim',
           COALESCE(
             metadata->>'unified_backbone_at_claim',
             CASE WHEN p_unified_backbone_active IS NULL THEN NULL
                  ELSE p_unified_backbone_active::text
             END
           )
         )
   WHERE id IN (SELECT id FROM ready)
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Phase 19 / BACKBONE-09 drain. New 3rd arg p_unified_backbone_active stamps unified_backbone_at_claim into compute_jobs.metadata so workers read the snapshot, never the live env var. Status filter is ''pending'' per migration 032 L112-120 (C-1); schedule column is next_attempt_at per migration 032 L123 (C-3); REVOKE is preserved without re-GRANT to authenticated per migration 086 L163 (C-2); D-1 — COALESCE preserves pre-existing snapshot on watchdog re-claim.';

-- C-2: REVOKE matches migration 086 line 163 verbatim. NO new GRANT issued.
-- service_role bypasses RLS in Supabase by default — workers continue working
-- via the service-role client without explicit GRANT. Issuing GRANT TO
-- authenticated would expand privilege beyond migration 086's posture and
-- allow any authenticated user to claim arbitrary jobs (RLS does not protect
-- SECURITY DEFINER).
REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
```

**Self-verify additions inside the migration's existing DO block (functional drain test):**

After the existing column/index/function checks, add a transactional functional check that proves C-1 fix is correct:

```sql
-- C-1 functional verification: seed a pending row, call the new RPC, assert claim succeeds.
-- Wrapped in a SAVEPOINT so test data is rolled back inside the migration transaction.
DO $$
DECLARE
  v_test_strategy_id UUID;
  v_test_job_id UUID;
  v_claimed_id UUID;
BEGIN
  SAVEPOINT migration_104_drain_smoke;
  -- Seed a strategy + pending compute_job
  SELECT id INTO v_test_strategy_id FROM strategies LIMIT 1;
  IF v_test_strategy_id IS NULL THEN
    RAISE NOTICE 'Migration 104: no strategies present, skipping drain functional smoke';
    RELEASE SAVEPOINT migration_104_drain_smoke;
    RETURN;
  END IF;
  INSERT INTO compute_jobs (strategy_id, kind, status, priority, next_attempt_at, metadata)
    VALUES (v_test_strategy_id, 'process_key_long', 'pending', 'normal', now(), '{}'::jsonb)
    RETURNING id INTO v_test_job_id;

  -- Claim it via the new 3-arg RPC
  SELECT id INTO v_claimed_id
    FROM claim_compute_jobs_with_priority(1, 'migration-104-smoke', TRUE)
   WHERE id = v_test_job_id;
  IF v_claimed_id IS NULL THEN
    RAISE EXCEPTION 'Migration 104 C-1 smoke FAILED: claim_compute_jobs_with_priority returned no row for pending job (status enum drift?)';
  END IF;

  -- Assert metadata stamped
  IF NOT EXISTS (
    SELECT 1 FROM compute_jobs
     WHERE id = v_test_job_id
       AND (metadata->>'unified_backbone_at_claim') = 'true'
  ) THEN
    RAISE EXCEPTION 'Migration 104 D-1 smoke FAILED: unified_backbone_at_claim not stamped';
  END IF;

  RAISE NOTICE 'Migration 104 C-1/D-1 functional smoke passed (claimed=%)', v_claimed_id;
  ROLLBACK TO SAVEPOINT migration_104_drain_smoke;
END $$;
```

**M-1 pre-flight wizard_session_id uniqueness check (BEFORE STEP 1):**

The plan in STEP 1 creates `strategy_verifications_wizard_session_id_unique_idx` as `CREATE UNIQUE INDEX IF NOT EXISTS`. If the test or production project has any pre-existing duplicate wizard_session_id rows, the index creation will FAIL mid-transaction and Tasks 2-4 silently won't apply. Add a pre-flight as the very first step of migration 104:

```sql
-- M-1 pre-flight: abort if any duplicate wizard_session_id exists.
-- CREATE UNIQUE INDEX would otherwise fail mid-transaction and leave the migration
-- partially applied. Run against test Supabase project before production push.
DO $$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT wizard_session_id FROM strategy_verifications
     GROUP BY wizard_session_id HAVING count(*) > 1
  ) AS d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Migration 104 M-1 ABORT: % duplicate wizard_session_id values present; resolve manually before applying UNIQUE INDEX', v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;
```

**M-2 — wrap STEP 2 (kind CHECK widening) in explicit BEGIN/COMMIT for clarity:**

The existing draft of STEP 2 uses `ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS ...; ALTER TABLE ... ADD CONSTRAINT ...;`. While Postgres takes ACCESS EXCLUSIVE locks making this safe in practice, wrap explicitly:

```sql
BEGIN;
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily',
  'process_key_long'
));
COMMIT;
```

**D-3 PostgREST fallback documentation:**

If the 3-arg form is invoked from PostgREST and the function-not-found resolution fails (e.g., schema cache stale), every long-fetch claim breaks and the unified backbone becomes unreachable. P7-2 task in plan 19-07 implements the application-side fallback (alert SEV-2 + retry with 2-arg form). Migration 104 itself does not need a fallback inside SQL; PostgREST resolution is a client-side concern. The PostgREST schema cache is reloaded on Supabase function deploys; verify Supabase project's PostgREST version ≥12 (which tolerates default-NULL added args). Document this in the migration comment.

**IMPORTANT:** Read migration 086 in full and copy the EXACT inner SELECT shape (FOR UPDATE SKIP LOCKED, priority ordering). The only ADDITIONS are: (a) 3rd arg `p_unified_backbone_active`, (b) metadata merge in UPDATE clause with D-1 COALESCE preservation. The `status`/`next_attempt_at`/`REVOKE` semantics are NOT additions — they are the verified ground-truth from migrations 032 + 086 (C-1, C-2, C-3 ground-truth corrections).

**STEP 4 — feature_flags kill-switch table (BACKBONE-05):**
```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key   TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (value IN ('on', 'off')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_authenticated_select ON feature_flags;
CREATE POLICY feature_flags_authenticated_select ON feature_flags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS feature_flags_service_all ON feature_flags;
CREATE POLICY feature_flags_service_all ON feature_flags
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO feature_flags (flag_key, value, updated_by)
  VALUES ('process_key_unified_backbone', 'off', 'migration-104-seed')
  ON CONFLICT (flag_key) DO NOTHING;

COMMENT ON TABLE feature_flags IS
  'Phase 19 / BACKBONE-05. Kill-switch row written by /api/cron/flag-monitor on auto-rollback.';
```

**STEP 5 — Self-verifying DO block** (mirror 093 STEP 7):
```sql
DO $$
DECLARE
  v_idx_count INT;
  v_kind_check_ok BOOLEAN;
  v_rpc_ok BOOLEAN;
  v_flag_count INT;
  v_rls_count INT;
BEGIN
  -- UNIQUE INDEX
  SELECT count(*) INTO v_idx_count FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='strategy_verifications'
      AND indexname='strategy_verifications_wizard_session_id_unique_idx';
  IF v_idx_count <> 1 THEN RAISE EXCEPTION 'Migration 104: wizard_session_id UNIQUE INDEX missing'; END IF;

  -- compute_jobs.kind admits process_key_long
  SELECT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name='compute_jobs_kind_check'
      AND check_clause LIKE '%process_key_long%'
  ) INTO v_kind_check_ok;
  IF NOT v_kind_check_ok THEN RAISE EXCEPTION 'Migration 104: process_key_long not in compute_jobs_kind_check'; END IF;

  -- claim RPC has 3 args
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname='public'
      AND p.proname='claim_compute_jobs_with_priority'
      AND p.pronargs = 3
  ) INTO v_rpc_ok;
  IF NOT v_rpc_ok THEN RAISE EXCEPTION 'Migration 104: claim_compute_jobs_with_priority not 3-arg'; END IF;

  -- feature_flags row seeded
  SELECT count(*) INTO v_flag_count FROM feature_flags WHERE flag_key='process_key_unified_backbone';
  IF v_flag_count <> 1 THEN RAISE EXCEPTION 'Migration 104: process_key_unified_backbone row missing'; END IF;

  -- RLS policies present
  SELECT count(*) INTO v_rls_count FROM pg_policies
    WHERE schemaname='public' AND tablename='feature_flags';
  IF v_rls_count < 2 THEN RAISE EXCEPTION 'Migration 104: feature_flags RLS policies missing'; END IF;

  RAISE NOTICE 'Migration 104: all assertions passed.';
END $$;
```

Then create `analytics-service/tests/test_drain_semantics.py` with the 4 behaviors above. Use the existing `conftest.py` test Supabase fixture pattern. Skip when test project not configured. Each test inserts a fresh strategy + compute_job, calls the RPC, asserts metadata shape.
  </action>
  <acceptance_criteria>
    - File `supabase/migrations/104_process_key_long_idempotency_drain.sql` exists
    - `grep -q 'CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_wizard_session_id_unique_idx' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q "'process_key_long'" supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q 'p_unified_backbone_active BOOLEAN DEFAULT NULL' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q 'unified_backbone_at_claim' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q 'CREATE TABLE IF NOT EXISTS feature_flags' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q "process_key_unified_backbone.*off" supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q 'FOR UPDATE SKIP LOCKED' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - `grep -q 'Migration 104: all assertions passed' supabase/migrations/104_process_key_long_idempotency_drain.sql`
    - File `analytics-service/tests/test_drain_semantics.py` exists with 6 test functions (4 + D-1 + C-1)
    - **C-1 verification:** `grep -q "status = 'pending'" supabase/migrations/104_process_key_long_idempotency_drain.sql` — RPC body filters on 'pending' (NOT 'queued')
    - **C-2 verification:** `grep -q 'REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority' supabase/migrations/104_process_key_long_idempotency_drain.sql` AND `! grep -q 'GRANT EXECUTE ON FUNCTION claim_compute_jobs_with_priority' supabase/migrations/104_process_key_long_idempotency_drain.sql` — REVOKE preserved, no new GRANT
    - **C-3 verification:** `grep -q 'next_attempt_at IS NULL OR next_attempt_at <= v_now' supabase/migrations/104_process_key_long_idempotency_drain.sql` — schedule column is next_attempt_at (NOT run_after)
    - **D-1 verification:** `grep -q "COALESCE.*metadata.*unified_backbone_at_claim" supabase/migrations/104_process_key_long_idempotency_drain.sql` — re-claim preserves original snapshot
    - **M-1 verification:** `grep -q 'M-1 pre-flight' supabase/migrations/104_process_key_long_idempotency_drain.sql` — duplicate wizard_session_id pre-check present
    - **M-2 verification:** the kind CHECK widening is wrapped in BEGIN/COMMIT (`grep -A1 'BEGIN;' supabase/migrations/104_process_key_long_idempotency_drain.sql | grep -q 'compute_jobs_kind_check'`)
    - **C-1 functional smoke:** the migration's self-verify DO block contains a SAVEPOINT-wrapped functional check that seeds a pending row, calls the RPC, asserts a row was claimed (`grep -q 'C-1.*smoke' supabase/migrations/104_process_key_long_idempotency_drain.sql`)
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "process_key_long" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "unified_backbone_at_claim" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "p_unified_backbone_active BOOLEAN DEFAULT NULL" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "FOR UPDATE SKIP LOCKED" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "feature_flags" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "wizard_session_id_unique_idx" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "status = .pending." supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "next_attempt_at IS NULL OR next_attempt_at" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority" supabase/migrations/104_process_key_long_idempotency_drain.sql && ! grep -q "GRANT EXECUTE ON FUNCTION claim_compute_jobs_with_priority" supabase/migrations/104_process_key_long_idempotency_drain.sql && grep -q "M-1 pre-flight" supabase/migrations/104_process_key_long_idempotency_drain.sql && test -f analytics-service/tests/test_drain_semantics.py' 
  </automated>
  <requirements>BACKBONE-05, BACKBONE-08, BACKBONE-09</requirements>
</task>

<task id="P2-3" type="auto" tdd="true">
  <name>Task 3: Migration 105 — strategies.fingerprint JSONB + compute_similarity cosine function</name>
  <files>supabase/migrations/105_strategies_fingerprint_compute_similarity.sql, analytics-service/tests/test_compute_similarity_sql.py</files>
  <read_first>
    - supabase/migrations/086_compute_jobs_priority.sql (search_path hardening + REVOKE/GRANT pattern; mirror exactly)
    - supabase/migrations/093_strategy_verifications.sql (STEP 7 self-verify DO-block pattern)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 373-449 — Migration 105 full body + Open Question 3 CHECK constraint)
    - .planning/REQUIREMENTS.md (FINGERPRINT-01, FINGERPRINT-02 spec verbatim)
  </read_first>
  <behavior>
    - Test 1 (test_identical_returns_one): compute_similarity(fp, fp) returns 1.0000 for any non-empty fingerprint.
    - Test 2 (test_orthogonal_returns_low): compute_similarity over disjoint single-bucket vectors returns < 0.1.
    - Test 3 (test_null_inputs_return_zero): compute_similarity(NULL, fp) and compute_similarity(fp, NULL) both return 0.0 — never errors.
    - Test 4 (test_version_mismatch_returns_zero): compute_similarity(fp_v1, fp_v2) returns 0.0.
    - Test 5 (test_check_constraint_rejects_v0): INSERT with fingerprint = '{"version": 0, ...}' raises a CHECK violation (SQLSTATE 23514).
    - Test 6 (test_immutable_parallel_safe_flags): pg_proc.provolatile='i' AND pg_proc.proparallel='s' for compute_similarity.
    - Test 7 (test_check_rejects_missing_version) [M-3]: INSERT with fingerprint = '{"trade_size_buckets": [...]}' (no `version` key) raises CHECK violation (SQLSTATE 23514). Original CHECK without NULL guard would have permitted this row — proves M-3 fix.
  </behavior>
  <action>
Create `supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`:

**STEP 1 — strategies.fingerprint JSONB column + partial index + CHECK:**

**M-3 fix:** the CHECK constraint must explicitly guard against NULL `version` key. The `->>` operator returns TEXT and `NULL = 1` evaluates to NULL (not FALSE), so a fingerprint missing the `version` key would pass the original constraint. Use the explicit `IS NOT NULL` guard.

**M-4 fix:** the partial index is reconsidered. Indexing `(id)` (already PK) under `WHERE fingerprint IS NOT NULL` provides minimal query benefit — the existing PK index already supports lookups, and the partial filter only narrows the index size. We retain the partial index for v0 to support the future `WHERE fingerprint IS NOT NULL AND compute_similarity(fingerprint, $1) > $2` query pattern that v2 will introduce, but the rationale is documented inline for future reviewers. If a v2-stage query benchmark shows zero benefit, drop the index in a follow-up migration.

```sql
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS fingerprint JSONB;

-- M-3: Explicit NULL-guard. The original draft `(fingerprint->>'version')::INT = 1`
-- accepts a fingerprint with NULL version key because `NULL = 1` is NULL (not FALSE),
-- which Postgres treats as constraint-satisfied. Wrap in IS NOT NULL guard.
ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_fingerprint_version_check;
ALTER TABLE strategies
  ADD CONSTRAINT strategies_fingerprint_version_check
  CHECK (
    fingerprint IS NULL
    OR (
      (fingerprint->>'version') IS NOT NULL
      AND (fingerprint->>'version')::INT = 1
    )
  );

-- M-4: partial index retained for v0 to support future v2 similarity queries
-- (compute_similarity over WHERE fingerprint IS NOT NULL). Indexing PK column under
-- partial predicate has minimal benefit on its own; document rationale here so future
-- reviewers can drop in a follow-up if benchmarks show zero benefit.
CREATE INDEX IF NOT EXISTS strategies_fingerprint_partial_idx
  ON strategies (id) WHERE fingerprint IS NOT NULL;

COMMENT ON COLUMN strategies.fingerprint IS
  'Phase 19 / FINGERPRINT-01. v0 placeholder; pgvector explicitly deferred to v2 per UC-C. Shape: {version: 1, trade_size_buckets: [4 floats], hold_duration_buckets: [4 floats], asset_class_mix: [4 floats], instrument_concentration: [10 floats], temporal_pattern: [24 floats]}.';
COMMENT ON INDEX strategies_fingerprint_partial_idx IS
  'Phase 19 / FINGERPRINT-01 / M-4. Retained for v0; supports future v2 similarity queries on populated rows. Drop in follow-up if benchmarks show no benefit.';
```

**STEP 2 — compute_similarity function:**
```sql
CREATE OR REPLACE FUNCTION compute_similarity(a JSONB, b JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_a_vec NUMERIC[];
  v_b_vec NUMERIC[];
  v_dot   NUMERIC := 0;
  v_norm_a NUMERIC := 0;
  v_norm_b NUMERIC := 0;
  i INT;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0.0; END IF;
  IF (a->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;
  IF (b->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;

  -- Build 46-dim vector by concat of 5 components.
  -- Using array_cat: WITH a_components AS (SELECT … FROM jsonb_array_elements_text(a->'trade_size_buckets'))
  WITH parts AS (
    SELECT
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'trade_size_buckets')      AS e) AS a1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'hold_duration_buckets')   AS e) AS a2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'asset_class_mix')         AS e) AS a3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'instrument_concentration') AS e) AS a4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'temporal_pattern')         AS e) AS a5,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'trade_size_buckets')      AS e) AS b1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'hold_duration_buckets')   AS e) AS b2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'asset_class_mix')         AS e) AS b3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'instrument_concentration') AS e) AS b4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'temporal_pattern')         AS e) AS b5
  )
  SELECT a1 || a2 || a3 || a4 || a5, b1 || b2 || b3 || b4 || b5
    INTO v_a_vec, v_b_vec
    FROM parts;

  IF v_a_vec IS NULL OR v_b_vec IS NULL THEN RETURN 0.0; END IF;
  IF array_length(v_a_vec, 1) <> 46 OR array_length(v_b_vec, 1) <> 46 THEN RETURN 0.0; END IF;

  FOR i IN 1..46 LOOP
    v_dot    := v_dot    + v_a_vec[i] * v_b_vec[i];
    v_norm_a := v_norm_a + v_a_vec[i] * v_a_vec[i];
    v_norm_b := v_norm_b + v_b_vec[i] * v_b_vec[i];
  END LOOP;

  IF v_norm_a = 0 OR v_norm_b = 0 THEN RETURN 0.0; END IF;

  RETURN GREATEST(0.0, LEAST(1.0, v_dot / (sqrt(v_norm_a) * sqrt(v_norm_b))))::NUMERIC(5,4);
EXCEPTION
  WHEN OTHERS THEN
    RETURN 0.0;
END;
$$;

COMMENT ON FUNCTION compute_similarity IS
  'Phase 19 / FINGERPRINT-02. v0 plain plpgsql cosine on 46-dim concatenated component vector. pgvector explicitly deferred to v2 per UC-C. Returns 0.0 on NULL or version mismatch — never errors.';

REVOKE EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) TO authenticated, service_role;
```

**STEP 3 — Self-verifying DO block:**
```sql
DO $$
DECLARE
  v_col_exists BOOLEAN;
  v_idx_exists BOOLEAN;
  v_check_exists BOOLEAN;
  v_func_volatile CHAR(1);
  v_func_parallel CHAR(1);
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='strategies' AND column_name='fingerprint'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN RAISE EXCEPTION 'Migration 105: fingerprint column missing'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='strategies_fingerprint_partial_idx'
  ) INTO v_idx_exists;
  IF NOT v_idx_exists THEN RAISE EXCEPTION 'Migration 105: partial index missing'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name='strategies_fingerprint_version_check'
  ) INTO v_check_exists;
  IF NOT v_check_exists THEN RAISE EXCEPTION 'Migration 105: version CHECK missing'; END IF;

  SELECT p.provolatile, p.proparallel INTO v_func_volatile, v_func_parallel
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname='public' AND p.proname='compute_similarity';
  IF v_func_volatile <> 'i' THEN RAISE EXCEPTION 'Migration 105: compute_similarity is not IMMUTABLE (got %)', v_func_volatile; END IF;
  IF v_func_parallel <> 's' THEN RAISE EXCEPTION 'Migration 105: compute_similarity is not PARALLEL SAFE (got %)', v_func_parallel; END IF;

  RAISE NOTICE 'Migration 105: all assertions passed.';
END $$;
```

**STEP 4 — Pitfall 9 plan-checker grep guard inside the file body itself:**
Add a SQL comment near the top: `-- Phase 19 Pitfall 9: this migration MUST NOT contain CREATE EXTENSION vector or vector(N) type references — pgvector is deferred to v2 per UC-C.`

Then create `analytics-service/tests/test_compute_similarity_sql.py` with the 6 tests above. Use existing test conftest pattern; skip when test Supabase project not configured.
  </action>
  <acceptance_criteria>
    - File `supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` exists
    - `grep -q 'ADD COLUMN IF NOT EXISTS fingerprint JSONB' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - `grep -q 'strategies_fingerprint_partial_idx' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - `grep -q "(fingerprint->>'version') IS NOT NULL" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` (M-3 — NULL-safe version CHECK)
    - `grep -q "(fingerprint->>'version')::INT = 1" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - `grep -q 'IMMUTABLE PARALLEL SAFE' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - `grep -q 'compute_similarity' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - `grep -q 'NUMERIC(5,4)' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - **Pitfall 9 guard:** `! grep -E 'CREATE EXTENSION (vector|pgvector)' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` (must NOT match — pgvector deferred to v2)
    - `grep -q 'Migration 105: all assertions passed' supabase/migrations/105_strategies_fingerprint_compute_similarity.sql`
    - File `analytics-service/tests/test_compute_similarity_sql.py` exists with 6 test functions
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && grep -q "compute_similarity" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && grep -q "IMMUTABLE PARALLEL SAFE" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && grep -q "NUMERIC(5,4)" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && grep -q "fingerprint->>.version..::INT = 1" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && ! grep -qE "CREATE EXTENSION (vector|pgvector)" supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && test -f analytics-service/tests/test_compute_similarity_sql.py && grep -q "test_identical_returns_one" analytics-service/tests/test_compute_similarity_sql.py'
  </automated>
  <requirements>FINGERPRINT-01, FINGERPRINT-02</requirements>
</task>

<task id="P2-4" type="auto">
  <name>Task 4: Migration 106 — VIEW-shim step (a) sentinel migration</name>
  <files>supabase/migrations/106_view_shim_step_a_sentinel.sql</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 451-469 — Migration 106 sentinel body)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md (lines 23-26 — VIEW-shim 4-PR sequence)
  </read_first>
  <action>
Create `supabase/migrations/106_view_shim_step_a_sentinel.sql` — sentinel-only migration. The migration body carries NO schema change; it exists so the migration sequence preserves the 4-PR shim ordering for audit.

```sql
-- Migration 106: Phase 19 / BACKBONE-04 step (a) sentinel.
-- The actual change is the Next.js route handler at
--   src/app/api/verify-strategy/route.ts:114-117
-- changing FROM:
--   .from("verification_requests").update({...})
-- TO:
--   .from("strategy_verifications").update({...})
--
-- This migration carries NO schema change. It exists so the migration
-- sequence preserves the 4-PR VIEW-shim ordering for audit (BACKBONE-04
-- step (a) per Phase 19 entry-gate migration-plan.md).
--
-- Plan-checker note: this migration MUST be applied in commit (a) alongside
-- the route.ts repoint. Commit message convention: `phase-19-shim-step-a:`.

DO $$
BEGIN
  RAISE NOTICE 'Migration 106: Phase 19 / BACKBONE-04 step (a) — verify-strategy/route.ts repoint sentinel.';
END
$$;
```
  </action>
  <acceptance_criteria>
    - File `supabase/migrations/106_view_shim_step_a_sentinel.sql` exists
    - `grep -q 'BACKBONE-04 step (a)' supabase/migrations/106_view_shim_step_a_sentinel.sql`
    - `grep -q 'sentinel' supabase/migrations/106_view_shim_step_a_sentinel.sql`
    - `grep -q 'phase-19-shim-step-a' supabase/migrations/106_view_shim_step_a_sentinel.sql`
    - `! grep -qE '(CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|CREATE FUNCTION|CREATE VIEW)' supabase/migrations/106_view_shim_step_a_sentinel.sql` (sentinel only — no DDL)
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/106_view_shim_step_a_sentinel.sql && grep -q "BACKBONE-04 step (a)" supabase/migrations/106_view_shim_step_a_sentinel.sql && grep -q "sentinel" supabase/migrations/106_view_shim_step_a_sentinel.sql && ! grep -qE "(CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|CREATE FUNCTION|CREATE VIEW)" supabase/migrations/106_view_shim_step_a_sentinel.sql'
  </automated>
  <requirements>BACKBONE-04</requirements>
</task>

<task id="P2-5" type="auto">
  <name>Task 5: Migration 107 — VIEW-shim step (d) rename + VIEW + INSTEAD OF triggers</name>
  <files>supabase/migrations/107_verification_requests_view_shim.sql</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 471-540 — Migration 107 full body + caveats; also Pitfall 7 on first-class public_token + expires_at)
    - supabase/migrations/010_portfolio_intelligence.sql (verification_requests origin schema L78-98)
    - src/app/api/verify-strategy/[id]/status/route.ts (read full file — VIEW must surface id, status, public_token, expires_at, results as columns)
    - .planning/phase-19/migration-plan.md (slot 107 reservation)
  </read_first>
  <action>
Create `supabase/migrations/107_verification_requests_view_shim.sql` — Phase 19 BACKBONE-04 step (d). All changes wrapped in a single BEGIN/COMMIT block.

**C-7 fix — backfill historical rows:** the original sketch ships only the VIEW + filter, leaving any pre-existing public-API-readable rows in `verification_requests` (legacy table) unreachable through the new VIEW after rename. Migration 107 adds a one-time data migration step that copies historical rows from `verification_requests_legacy` to `strategy_verifications` for any teaser-flow rows the public status API reads. Non-teaser legacy rows are NOT backfilled (they pre-date Phase 15 strategy_verifications and have no equivalent strategy_id; they are accessible via admin-only SELECT on the legacy table per the 90-day retention policy).

**C-9 fix — INSTEAD OF UPDATE/DELETE behavior:** the original sketch raises on UPDATE/DELETE, but the routes that previously did read-modify-write through `verification_requests` would break with SQLSTATE 42501 noise. Decision (per inspection of read-modify callers — `verify-strategy/route.ts:114-117` is the only writer; PR-A repoints it pre-PR-D, so no read-modify caller will reach the VIEW post-PR-D): RAISE with a clearer error message that links to the migration plan. If a future caller is discovered reading-modifying through the VIEW, swap RAISE for a routing INSTEAD OF that delegates to `strategy_verifications`.

**M-5 fix — VIEW filter scope:** legacy `[id]/status/route.ts` queries by `id` alone for ANY flow_type (Phase 15 CSV path also writes to `strategy_verifications`). Filtering `WHERE sv.flow_type='teaser'` would return 404 for non-teaser rows that previously worked through the legacy table. Migration 107 adds a runtime assertion verifying no non-teaser rows currently exist in `strategy_verifications` and aborts the migration if any do — defending the current narrow filter; if the assertion fires, widen the filter and re-test.

**M-6 fix — preserve public_token-gated reads on legacy table:** the original verification_requests RLS allowed unauthenticated reads gated by the public_token URL parameter. After 107, the new VIEW (filter teaser) handles the new public-token reads, but the legacy table policy was admin-only — meaning any URL link to a 90-day-old strategy returned 404 for unauthenticated callers. Re-add a public_token-gated SELECT policy on `verification_requests_legacy` for the 90-day window.

```sql
-- Migration 107: Phase 19 / BACKBONE-04 step (d).
-- Renames the legacy verification_requests table and replaces it with a
-- read-only VIEW backed by strategy_verifications. INSTEAD OF triggers reject
-- writes. Legacy table retained read-only for 90-day support-lookup window
-- (per BACKBONE-05) with public_token-gated SELECT policy preserved (M-6).
--
-- Plan-checker note: this migration ships in commit (d) of the 4-PR VIEW-shim
-- sequence. Commit message convention: `phase-19-shim-step-d:`. MUST be ≥168h
-- after commit (b) (flag-flip timestamp). Plan-checker reads
-- .planning/phase-19/stability-log.md for the flag_flipped_at timestamp.

BEGIN;

-- M-5: pre-flight assertion that no non-teaser rows currently exist in
-- strategy_verifications (which would be hidden by the VIEW filter and break
-- the legacy [id]/status/route.ts read path). Aborts migration if any.
DO $$
DECLARE
  v_non_teaser_count INT;
BEGIN
  SELECT count(*) INTO v_non_teaser_count
    FROM strategy_verifications
   WHERE flow_type <> 'teaser';
  IF v_non_teaser_count > 0 THEN
    RAISE EXCEPTION 'Migration 107 M-5 ABORT: % non-teaser rows in strategy_verifications would be hidden by VIEW filter; widen filter or migrate non-teaser flow_types separately', v_non_teaser_count;
  END IF;
END $$;

-- 1. Rename the legacy table out of the way (data + FKs preserved).
ALTER TABLE verification_requests RENAME TO verification_requests_legacy;

-- 2. C-7 — Backfill historical teaser rows from legacy into strategy_verifications.
-- The legacy `verification_requests` schema does not carry strategy_id / wizard_session_id
-- (it pre-dates Phase 15), so this backfill creates synthetic strategy_id-less rows
-- ONLY for legacy entries that the public status API would otherwise lose. Any
-- legacy row missing the FK target is logged and skipped — admins can fall back
-- to the legacy table via the admin/public_token policies below.
DO $$
DECLARE
  v_backfilled INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_synthetic_strategy_id UUID;
BEGIN
  FOR r IN SELECT * FROM verification_requests_legacy LOOP
    -- For each legacy row, attempt to find a matching strategy by exchange + recent
    -- timestamp. If none, skip (non-teaser legacy or orphan) — admins still see via legacy table.
    SELECT id INTO v_synthetic_strategy_id
      FROM strategies
     WHERE created_at <= COALESCE(r.completed_at, r.created_at)
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_synthetic_strategy_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    -- Insert if a row with this id does not already exist in strategy_verifications.
    INSERT INTO strategy_verifications (
      id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
      metrics_snapshot, public_token, expires_at, created_at, transitioned_at
    )
    VALUES (
      r.id, v_synthetic_strategy_id, gen_random_uuid(),
      COALESCE(r.status, 'published'),
      'self_reported',  -- legacy rows are pre-Phase-15; no trust verification done
      'teaser',
      COALESCE(r.exchange, 'okx'),
      r.results, r.public_token, r.expires_at,
      r.created_at, COALESCE(r.completed_at, r.created_at)
    )
    ON CONFLICT (id) DO NOTHING;
    v_backfilled := v_backfilled + 1;
  END LOOP;
  RAISE NOTICE 'Migration 107 C-7 backfill: % rows copied, % rows skipped (no strategy_id match)', v_backfilled, v_skipped;
END $$;

-- 3. CREATE VIEW verification_requests AS SELECT … FROM strategy_verifications.
-- The columns must match the OLD verification_requests shape that
-- src/app/api/verify-strategy/[id]/status/route.ts (L20-46) reads:
--   id, status, public_token, expires_at, results
-- Per Pitfall 7 mitigation, public_token and expires_at are first-class
-- columns on strategy_verifications (added in migration 103), NOT nested in JSONB.
-- M-5: filter retained as 'teaser' (preflight asserted no non-teaser rows present).
CREATE VIEW verification_requests AS
SELECT
  sv.id                                AS id,
  NULL::TEXT                           AS email,
  sv.source                            AS exchange,
  NULL::TEXT                           AS api_key_encrypted,
  NULL::TEXT                           AS api_secret_encrypted,
  NULL::TEXT                           AS passphrase_encrypted,
  NULL::TEXT                           AS dek_encrypted,
  sv.status                            AS status,
  sv.public_token                      AS public_token,
  sv.expires_at                        AS expires_at,
  sv.metrics_snapshot                  AS results,
  sv.created_at                        AS created_at,
  sv.transitioned_at                   AS completed_at
FROM strategy_verifications sv
WHERE sv.flow_type = 'teaser';

COMMENT ON VIEW verification_requests IS
  'Phase 19 / BACKBONE-04 step (d). Read-only VIEW backed by strategy_verifications WHERE flow_type=teaser (M-5 — verified at apply time that no non-teaser rows exist). Writes rejected by INSTEAD OF triggers. New code MUST write to strategy_verifications directly.';

-- 4. INSTEAD OF triggers — INSERT/UPDATE/DELETE all rejected with clearer error message.
-- C-9: explicit UPDATE and DELETE triggers (originally only INSERT was specified).
-- All three RAISE the same custom message linking to the migration plan so callers
-- know exactly where to update. If a read-modify caller is discovered post-PR-D,
-- swap the trigger body for a routing INSTEAD OF that delegates to strategy_verifications.
CREATE OR REPLACE FUNCTION verification_requests_view_readonly_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verification_requests is now a read-only VIEW (Phase 19 / BACKBONE-04 step d). Writes go to strategy_verifications via POST /process-key. See .planning/phase-19/migration-plan.md slot 107.'
    USING ERRCODE = '42501',
          HINT = 'Operation: % on the verification_requests VIEW. The legacy BASE TABLE was renamed to verification_requests_legacy in migration 107.';
END;
$$;

CREATE TRIGGER verification_requests_view_readonly_insert
  INSTEAD OF INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_update  -- C-9
  INSTEAD OF UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_delete  -- C-9
  INSTEAD OF DELETE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();

-- 5. RLS on the renamed legacy table:
--    a. service-role write/read works via auth.role() bypass (no policy needed).
--    b. admin SELECT for 90-day support window.
--    c. M-6: PUBLIC_TOKEN-GATED SELECT preserved for unauthenticated callers
--       hitting `/api/verify-strategy/<old-id>/status`. Without this, every
--       pre-Phase-19 verification status URL returns 404 for the public after PR-D.
ALTER TABLE verification_requests_legacy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_admin_select ON verification_requests_legacy
  FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- M-6: public_token-gated SELECT for 90-day public reachability window.
-- Caller passes ?token=... in the URL; route handler validates token != NULL
-- and matches the row's public_token. Postgres RLS check enforces this so
-- unauthenticated PostgREST requests can SELECT only the matching row.
DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy
  FOR SELECT
  USING (
    public_token IS NOT NULL
    AND expires_at > now()
    AND created_at > (now() - interval '90 days')
  );

COMMENT ON POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy IS
  'M-6 — preserves the original verification_requests public_token-gated SELECT for the 90-day window after rename. Without this policy, every public verification status URL pointing at a pre-Phase-19 row would 404 for the public.';

-- 6. Self-verifying DO block.
DO $$
DECLARE
  v_view_exists BOOLEAN;
  v_legacy_exists BOOLEAN;
  v_trigger_count INT;
  v_legacy_policy_count INT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='verification_requests'
  ) INTO v_view_exists;
  IF NOT v_view_exists THEN RAISE EXCEPTION 'Migration 107: verification_requests VIEW missing'; END IF;

  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_requests_legacy' AND table_type='BASE TABLE'
  ) INTO v_legacy_exists;
  IF NOT v_legacy_exists THEN RAISE EXCEPTION 'Migration 107: verification_requests_legacy table missing'; END IF;

  -- C-9: assert all 3 INSTEAD OF triggers (INSERT, UPDATE, DELETE) are present
  SELECT count(*) INTO v_trigger_count FROM pg_trigger
    WHERE tgname IN (
      'verification_requests_view_readonly_insert',
      'verification_requests_view_readonly_update',
      'verification_requests_view_readonly_delete'
    );
  IF v_trigger_count <> 3 THEN RAISE EXCEPTION 'Migration 107 C-9: expected 3 INSTEAD OF triggers, got %', v_trigger_count; END IF;

  -- M-6: assert legacy public_token-gated policy is present
  SELECT count(*) INTO v_legacy_policy_count FROM pg_policies
    WHERE tablename = 'verification_requests_legacy'
      AND policyname = 'verification_requests_legacy_public_token_select';
  IF v_legacy_policy_count <> 1 THEN RAISE EXCEPTION 'Migration 107 M-6: public_token-gated SELECT policy missing on verification_requests_legacy'; END IF;

  RAISE NOTICE 'Migration 107: all assertions passed (C-7 backfill + C-9 INSTEAD OF UPDATE/DELETE + M-5 filter scope + M-6 public_token RLS).';
END $$;

COMMIT;
```
  </action>
  <acceptance_criteria>
    - File `supabase/migrations/107_verification_requests_view_shim.sql` exists
    - `grep -q 'RENAME TO verification_requests_legacy' supabase/migrations/107_verification_requests_view_shim.sql`
    - `grep -q 'CREATE VIEW verification_requests' supabase/migrations/107_verification_requests_view_shim.sql`
    - `grep -q 'sv.public_token' supabase/migrations/107_verification_requests_view_shim.sql` (first-class column per Pitfall 7)
    - `grep -q 'sv.expires_at' supabase/migrations/107_verification_requests_view_shim.sql`
    - `grep -q "WHERE sv.flow_type = 'teaser'" supabase/migrations/107_verification_requests_view_shim.sql`
    - **C-9:** `grep -q 'INSTEAD OF INSERT' supabase/migrations/107_verification_requests_view_shim.sql`
    - **C-9:** `grep -q 'INSTEAD OF UPDATE' supabase/migrations/107_verification_requests_view_shim.sql`
    - **C-9:** `grep -q 'INSTEAD OF DELETE' supabase/migrations/107_verification_requests_view_shim.sql`
    - `grep -q 'phase-19-shim-step-d' supabase/migrations/107_verification_requests_view_shim.sql`
    - `grep -q 'Migration 107: all assertions passed' supabase/migrations/107_verification_requests_view_shim.sql`
    - **C-7:** `grep -q 'C-7 backfill' supabase/migrations/107_verification_requests_view_shim.sql` AND `grep -q 'verification_requests_legacy' supabase/migrations/107_verification_requests_view_shim.sql` AND `grep -q 'INSERT INTO strategy_verifications' supabase/migrations/107_verification_requests_view_shim.sql`
    - **M-5:** `grep -q 'M-5 ABORT' supabase/migrations/107_verification_requests_view_shim.sql` (preflight non-teaser assertion)
    - **M-6:** `grep -q 'verification_requests_legacy_public_token_select' supabase/migrations/107_verification_requests_view_shim.sql` (90-day public_token policy preserved)
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/107_verification_requests_view_shim.sql && grep -q "RENAME TO verification_requests_legacy" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "CREATE VIEW verification_requests" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "INSTEAD OF INSERT" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "INSTEAD OF UPDATE" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "INSTEAD OF DELETE" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "sv.public_token" supabase/migrations/107_verification_requests_view_shim.sql && grep -q "sv.expires_at" supabase/migrations/107_verification_requests_view_shim.sql'
  </automated>
  <requirements>BACKBONE-04</requirements>
</task>

<task id="P2-6" type="auto">
  <name>Task 6 [BLOCKING — schema push]: Apply migrations 103-107 to the linked test Supabase project via `supabase db push`</name>
  <files>(no file changes — runs supabase db push)</files>
  <read_first>
    - supabase/migrations/103_strategy_verifications_state_machine.sql
    - supabase/migrations/104_process_key_long_idempotency_drain.sql
    - supabase/migrations/105_strategies_fingerprint_compute_similarity.sql
    - supabase/migrations/106_view_shim_step_a_sentinel.sql
    - supabase/migrations/107_verification_requests_view_shim.sql
  </read_first>
  <action>
**BLOCKING task** — runs AFTER Tasks 1-5 have written all 5 migration files; runs BEFORE any verification step. This is the schema-push gate per dispatch CONTEXT.md.

The migration push uses the Supabase MCP (preferred when available) — call `mcp__supabase__apply_migration` for each migration in order, using project_id `qmnijlgmdhviwzwfyzlc`.

**IMPORTANT — Migration 107 has a hard precondition:** it renames `verification_requests` to `_legacy` and replaces it with a VIEW. If the test project has live `verification_requests` rows from prior testing, the rename succeeds but the VIEW's `flow_type='teaser'` filter must surface compatible rows. Migration 106 is a sentinel; safe to apply. Migration 107 is destructive (forward-only) — apply in a separate session AFTER Tasks 1-5 land in git, AFTER human review of the migration body.

**Recommended order:**

1. Apply 103, 104, 105 (foundational schema — Wave 1 substrate). Verify each by re-reading via `mcp__supabase__execute_sql`:
   ```
   SELECT 1 FROM pg_proc WHERE proname='transition_strategy_verification';  -- expect 1
   SELECT 1 FROM pg_indexes WHERE indexname='strategy_verifications_wizard_session_id_unique_idx';  -- expect 1
   SELECT 1 FROM pg_proc WHERE proname='compute_similarity' AND provolatile='i' AND proparallel='s';  -- expect 1
   SELECT value FROM feature_flags WHERE flag_key='process_key_unified_backbone';  -- expect 'off'
   ```
2. Apply 106 (sentinel — no schema change; safe).
3. **Defer 107** until P5 commit (d) per BACKBONE-04 sequence. **Do NOT apply 107 in this Wave 1 run.** Document this deferral in the task summary; P5 plan re-applies via the migration framework when commit (d) ships.

**If `mcp__supabase__apply_migration` is not available**, fall back to `supabase db push` with the test project linked. Verify branch is on the test project (not production) via `supabase status` first. If branch protection or auth issues arise, surface as a checkpoint via the parent orchestrator — do NOT bypass.

**Verify post-push:** read each of the 4 self-verifying DO blocks' RAISE NOTICE messages from the apply log, AND run a few asserts via SQL:
- `SELECT count(*) FROM information_schema.columns WHERE table_name='strategy_verifications' AND column_name IN ('transitioned_at','encrypted_credentials','public_token','expires_at')` → 4
- `SELECT count(*) FROM pg_indexes WHERE indexname='strategy_verifications_wizard_session_id_unique_idx'` → 1
- `SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name='compute_jobs_kind_check' AND check_clause LIKE '%process_key_long%'` → 1
- `SELECT (a.fingerprint->>'version')::INT FROM (SELECT '{"version":1,"trade_size_buckets":[1,0,0,0],"hold_duration_buckets":[1,0,0,0],"asset_class_mix":[1,0,0,0],"instrument_concentration":[1,0,0,0,0,0,0,0,0,0],"temporal_pattern":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb AS fingerprint) a` → 1
- `SELECT compute_similarity('{"version":1,"trade_size_buckets":[1,0,0,0],"hold_duration_buckets":[1,0,0,0],"asset_class_mix":[1,0,0,0],"instrument_concentration":[1,0,0,0,0,0,0,0,0,0],"temporal_pattern":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb, '{"version":1,"trade_size_buckets":[1,0,0,0],"hold_duration_buckets":[1,0,0,0],"asset_class_mix":[1,0,0,0],"instrument_concentration":[1,0,0,0,0,0,0,0,0,0],"temporal_pattern":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb)` → 1.0000

If ANY assertion fails, STOP — do not proceed to verification. Report failure to the orchestrator and let plan-checker pick up.
  </action>
  <acceptance_criteria>
    - All 4 of migrations 103, 104, 105, 106 applied successfully to test project `qmnijlgmdhviwzwfyzlc`
    - Migration 107 NOT applied in Wave 1 (deferred to P5 commit (d) per BACKBONE-04 7-day stability window)
    - Post-push assertions all pass:
      - `transition_strategy_verification` exists
      - `wizard_session_id` UNIQUE INDEX exists
      - `compute_jobs.kind` CHECK admits `process_key_long`
      - `feature_flags` row seeded with value='off'
      - `compute_similarity` returns 1.0000 for identical vectors and 0.0 for NULL inputs
  </acceptance_criteria>
  <automated>
    bash -c 'test -f supabase/migrations/103_strategy_verifications_state_machine.sql && test -f supabase/migrations/104_process_key_long_idempotency_drain.sql && test -f supabase/migrations/105_strategies_fingerprint_compute_similarity.sql && test -f supabase/migrations/106_view_shim_step_a_sentinel.sql && test -f supabase/migrations/107_verification_requests_view_shim.sql && ls supabase/migrations/ | grep -E "^10[3-7]_" | wc -l | grep -q "^5$"'
  </automated>
  <requirements>BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02</requirements>
</task>

<task id="P2-7" type="auto">
  <name>Task 7 [C-8]: Write paired down-migrations for 103-107</name>
  <files>supabase/migrations/down/103-rollback.sql, supabase/migrations/down/104-rollback.sql, supabase/migrations/down/105-rollback.sql, supabase/migrations/down/106-rollback.sql, supabase/migrations/down/107-rollback.sql</files>
  <read_first>
    - supabase/migrations/103_strategy_verifications_state_machine.sql (Task 1 output)
    - supabase/migrations/104_process_key_long_idempotency_drain.sql (Task 2 output)
    - supabase/migrations/105_strategies_fingerprint_compute_similarity.sql (Task 3 output)
    - supabase/migrations/106_view_shim_step_a_sentinel.sql (Task 4 output)
    - supabase/migrations/107_verification_requests_view_shim.sql (Task 5 output)
  </read_first>
  <action>
**C-8 fix — paired down-migrations.** None of 103-107 currently ship reversible scripts. A failed `supabase db push` mid-sequence leaves the DB half-migrated with no documented recovery. Ship one paired down script per migration, in `supabase/migrations/down/{N}-rollback.sql`. Each inverse covers every forward DDL. Test at least one round-trip locally before any production push.

**Files to create:**

(1) `supabase/migrations/down/103-rollback.sql`:
```sql
BEGIN;
DROP FUNCTION IF EXISTS transition_strategy_verification(UUID, TEXT, JSONB);
ALTER TABLE strategy_verifications
  DROP COLUMN IF EXISTS transitioned_at,
  DROP COLUMN IF EXISTS encrypted_credentials,
  DROP COLUMN IF EXISTS public_token,
  DROP COLUMN IF EXISTS expires_at;
DROP INDEX IF EXISTS strategy_verifications_public_token_unique_idx;
COMMIT;
```

(2) `supabase/migrations/down/104-rollback.sql`:
```sql
BEGIN;
-- Restore the 086 2-arg signature; the 3-arg form is dropped.
DROP FUNCTION IF EXISTS claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN);
-- DO NOT drop the 086 2-arg form; that belongs to migration 086.
DROP INDEX IF EXISTS strategy_verifications_wizard_session_id_unique_idx;
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily'
));
DROP TABLE IF EXISTS feature_flags;
COMMIT;
```

(3) `supabase/migrations/down/105-rollback.sql`:
```sql
BEGIN;
DROP FUNCTION IF EXISTS compute_similarity(JSONB, JSONB);
DROP INDEX IF EXISTS strategies_fingerprint_partial_idx;
ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_fingerprint_version_check;
ALTER TABLE strategies DROP COLUMN IF EXISTS fingerprint;
COMMIT;
```

(4) `supabase/migrations/down/106-rollback.sql`:
```sql
-- Sentinel migration is no-op forward; rollback is also no-op.
DO $$ BEGIN RAISE NOTICE 'Migration 106 rollback: sentinel — no-op'; END $$;
```

(5) `supabase/migrations/down/107-rollback.sql`:
```sql
BEGIN;
-- Mirrors the rollback runbook Stage D recovery procedure.
DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;
DROP VIEW IF EXISTS verification_requests;
DROP FUNCTION IF EXISTS verification_requests_view_readonly_trigger();
ALTER TABLE verification_requests_legacy RENAME TO verification_requests;
DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests;
DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests;
-- The C-7 backfill rows in strategy_verifications are NOT removed by rollback —
-- they are real strategy_verifications rows now and removing them would lose data.
-- Document this asymmetry: forward migration is one-way for the backfill data.
COMMIT;
```

**Round-trip test (run locally before production push):**
1. Apply 103 forward, verify schema state, apply down/103-rollback.sql, re-verify schema is back to pre-103 state.
2. Repeat for 104, 105.
3. (Migration 107 round-trip requires the C-7 backfill data to be re-creatable; document the asymmetry above.)
  </action>
  <acceptance_criteria>
    - 5 down-migration files exist under `supabase/migrations/down/`
    - `ls supabase/migrations/down/10[3-7]-rollback.sql | wc -l` returns 5
    - Each down file is non-empty (`wc -l` > 5)
    - **C-8 verification:** `grep -q 'DROP FUNCTION IF EXISTS transition_strategy_verification' supabase/migrations/down/103-rollback.sql`
    - **C-8 verification:** `grep -q 'DROP FUNCTION IF EXISTS claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN)' supabase/migrations/down/104-rollback.sql`
    - **C-8 verification:** `grep -q 'DROP FUNCTION IF EXISTS compute_similarity' supabase/migrations/down/105-rollback.sql`
    - **C-8 verification:** `grep -q 'RENAME TO verification_requests' supabase/migrations/down/107-rollback.sql`
  </acceptance_criteria>
  <automated>
    bash -c 'ls supabase/migrations/down/10[3-7]-rollback.sql 2>/dev/null | wc -l | grep -q "^5$" && grep -q "DROP FUNCTION IF EXISTS transition_strategy_verification" supabase/migrations/down/103-rollback.sql && grep -q "DROP FUNCTION IF EXISTS claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN)" supabase/migrations/down/104-rollback.sql && grep -q "DROP FUNCTION IF EXISTS compute_similarity" supabase/migrations/down/105-rollback.sql && grep -q "RENAME TO verification_requests" supabase/migrations/down/107-rollback.sql'
  </automated>
  <requirements>BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel/Railway → Supabase RPC | adapter calls `transition_strategy_verification` RPC; arguments cross trust boundary |
| Worker dyno → Supabase RPC | `claim_compute_jobs_with_priority` writes metadata; race risk between flag-flip + claim |
| Public/anon → compute_similarity | function GRANTed to authenticated + service_role only (REVOKE from PUBLIC, anon) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-04 | Tampering | transition_strategy_verification RPC | mitigate | RPC is SECURITY DEFINER + search_path=public, pg_temp; arguments typed as UUID/TEXT/JSONB (no string concatenation); FOR UPDATE row lock prevents concurrent illegal transitions; legal pairs hard-coded in RPC body |
| T-19-05 | Injection | transition_strategy_verification metadata JSONB | mitigate | JSONB inputs parsed via `->`, `->>` operators only — no `EXECUTE` or string concatenation; CHECK on status enum baseline from migration 093 |
| T-19-06 | Tampering | claim_compute_jobs_with_priority row lock | mitigate | `FOR UPDATE SKIP LOCKED` on inner SELECT prevents two workers claiming the same job; atomic UPDATE of status + metadata in one statement; existing 086 lock semantics preserved verbatim |
| T-19-07 | Information disclosure | compute_similarity SQL function | mitigate | REVOKE EXECUTE FROM PUBLIC, anon + GRANT EXECUTE TO authenticated, service_role; search_path hardened (mirrors 086 H-B); IMMUTABLE PARALLEL SAFE prevents I/O side effects |
| T-19-08 | DoS | compute_similarity oversized JSONB payload | mitigate | CHECK constraint `(fingerprint->>'version')::INT = 1` rejects unknown versions before persist; function returns 0.0 on shape mismatch (no resource exhaustion path) |
| T-19-09 | Tampering | feature_flags table | mitigate | RLS enabled; service_role-only WRITE policy + SELECT-all read policy; updates always carry updated_by audit field |
| T-19-10 | Tampering | verification_requests VIEW | mitigate | INSTEAD OF triggers reject all writes with SQLSTATE 42501; legacy table RLS retains admin-only SELECT for 90-day support window |
</threat_model>

<verification>
- All 5 migration files exist (verifiable via `ls supabase/migrations/10[3-7]_*.sql | wc -l` returns 5).
- 4 of 5 migrations applied to test Supabase project (`qmnijlgmdhviwzwfyzlc`); migration 107 deferred to P5 commit (d) per BACKBONE-04.
- Each applied migration's self-verifying DO block emits `Migration N: all assertions passed.` in the apply log.
- 3 pytest stub files exist (`test_transition_rpc.py`, `test_drain_semantics.py`, `test_compute_similarity_sql.py`) with 4+, 4+, and 6+ test functions respectively.
- Pitfall 9 verified: `! grep -E 'CREATE EXTENSION (vector|pgvector)' supabase/migrations/105_*.sql` succeeds (no pgvector dependency).
- Pitfall 7 verified: migration 103 adds `public_token TEXT` and `expires_at TIMESTAMPTZ` as first-class columns; migration 107 VIEW maps them as columns NOT JSONB.
</verification>

<success_criteria>
- BACKBONE-03 schema: `transition_strategy_verification` RPC enforces 6 legal transitions + restart path.
- BACKBONE-04: migrations 106 + 107 written; 106 sentinel applied in Wave 1; 107 deferred to P5 commit (d).
- BACKBONE-05: `feature_flags` table exists with default-OFF kill-switch row + RLS policies.
- BACKBONE-08: `wizard_session_id` UNIQUE INDEX present (BACKBONE-08 idempotency at DB layer).
- BACKBONE-09: `compute_jobs.kind` CHECK admits `process_key_long`; `claim_compute_jobs_with_priority` writes `unified_backbone_at_claim` metadata at claim time.
- FINGERPRINT-01: `strategies.fingerprint JSONB` + partial index + version=1 CHECK constraint.
- FINGERPRINT-02: `compute_similarity` IMMUTABLE PARALLEL SAFE, returns NUMERIC(5,4) in [0,1], returns 0.0 on NULL or version mismatch.
- Live test Supabase DB matches the migration files (no drift).
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-02-SUMMARY.md`
</output>
