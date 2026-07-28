# Voices Accepted — Phase 06

All 8 divergent findings from Voice A accepted by user (`/gsd-plan-phase 06`, 2026-04-19).
Grok returned `approve` / empty findings (no consensus items to auto-fold).

Planner MUST fold each of the following into the existing PLAN.md files. Preserve plan structure; modify scope, sequencing, task details, threat_model, and acceptance criteria as each finding directs.

---

## f1 — RLS probe false-positive (BLOCKER / HIGH — verification)

**Change target:** `06-01-PLAN.md` → Plan 01 Task 1 (migration 066 authoring) + Task 2 (migration apply checkpoint).

**Problem:** The DO block's multi-actor RLS probe uses `PERFORM set_config('role', 'authenticated', true)` which sets a custom GUC, NOT the PostgreSQL session role. The migration runs as `postgres`/`supabase_admin` (BYPASSRLS = true), so RLS policies do not engage and the probe passes vacuously even if RLS is completely broken. This silently false-positives the primary DB-level proof for INGEST-09 / SC4.

**Required fix:**
1. Replace `PERFORM set_config('role', 'authenticated', true)` in the DO block with `EXECUTE 'SET LOCAL ROLE authenticated'` followed by the SELECTs that count visible rows. Use `RESET ROLE` (or `EXECUTE 'SET LOCAL ROLE postgres'`) before cleanup.
2. Before any actor switch, `ASSERT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) = false` inside the probe to blow up the migration if it's ever applied by a superuser role that would vacuously pass.
3. Per migration 062 precedent: if PL/pgSQL DO blocks cannot run the `SET LOCAL ROLE` cleanly, move the actor probe out of the DO block into a separate psql-driven verification script that `apply_migration` runs AFTER the main DDL (Phase 5 D-20c precedent).
4. Task 1 acceptance criteria must grep for `SET LOCAL ROLE authenticated` in the migration file AND NOT match `set_config('role'`.
5. Task 2 (live-apply checkpoint) acceptance must include a post-apply query `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` returning `false` immediately before the in-block probe executes — OR verify the probe script ran under a non-BYPASSRLS role.

---

## f2 — No preview-branch apply + smoke test before production promotion (BLOCKER / HIGH — sequencing)

**Change target:** `06-01-PLAN.md` → insert a new Task 1.5 between Task 1 (write migration) and Task 2 (apply to production).

**Problem:** Task 2 targets live production Supabase directly. Migration 066 does DROP+REDEFINE on `enqueue_compute_job` which strategy-side cron depends on. If the new 9-param signature regresses the 7-param call shape used by `enqueue_poll_positions_for_all_strategies`, production strategy ingestion breaks the moment the migration applies. No rollback plan is documented.

**Required fix:**
1. Add **Task 1.5: Apply migration 066 to Supabase preview branch**.
   - Use `supabase branches create phase-06-preview` (or Supabase MCP `create_branch` equivalent) to stand up a preview branch off production.
   - Apply migration 066 to the preview branch via `apply_migration` or `supabase db push --db-url <preview-url>`.
   - Run both smoke tests against the preview branch:
     - `SELECT enqueue_poll_positions_for_all_strategies();` — MUST NOT raise; MUST enqueue jobs exactly as before (regression check for the strategy cron path).
     - `SELECT enqueue_poll_allocator_positions_for_all_keys();` — MUST not raise; MUST enqueue N jobs where N = active non-revoked api_keys count (new-path smoke).
     - `SELECT enqueue_compute_job(p_kind := 'compute_analytics', p_strategy_id := <existing>);` — legacy 1–2 param-style call MUST still succeed (signature backward compat).
   - Capture the preview branch URL in the task's `<what-built>` block.
   - `autonomous: false` — pauses for user confirmation that smoke tests passed before Task 2 fires.
2. Modify Task 2 acceptance to include a reference to the preview-branch smoke test result (task cannot start unless Task 1.5 is green).
3. Add a `<rollback_sql>` section to Task 1 (and Task 1.5) with the exact DDL to revert: DROP new functions (`enqueue_poll_allocator_positions_for_all_keys`, `request_allocator_holdings_sync`, updated `enqueue_compute_job`, `_enqueue_compute_job_internal`), DROP new table (`allocator_holdings`), DROP kind row, DROP partial unique index, DROP `compute_jobs.api_key_id` column, revert `compute_jobs_target_xor` to 3-way, revert `api_keys.sync_status` CHECK, DROP cron schedule. Rollback must restore production to pre-migration state.

---

## f3 — Deribit `fetch_balance()` shape unverified → silent-empty sync (WARNING / HIGH — risk)

**Change target:** `06-02-PLAN.md` → Plan 02 Task 1 (Wave 0 tests) + Task 2 (Deribit + allocator_positions implementation).

**Problem:** Plan 02 Task 2 adds Deribit to `EXCHANGE_CLASSES` but `_fetch_spot_rows` calls plain `await exchange.fetch_balance()`. Per RESEARCH Section 1 Assumption A1, Deribit's unified `fetch_balance()` may return `{'total': {}}` for derivatives-only accounts, triggering the `if not non_zero: return []` branch. INGEST-04 idempotency passes (empty == empty), no exception, `sync_status='complete'` — but Deribit holdings are silently absent. No Deribit test case currently exists.

**Required fix:**
1. Plan 02 Task 1 (Wave 0 tests) add a new RED pytest case `test_deribit_balance_per_currency_shape` that mocks Deribit returning `{'total': {}, 'info': {'result': {...per-currency...}}}` and asserts the normalizer extracts spot rows from per-currency info (or explicitly raises "Deribit spot not supported" with a defined error class, not silent-empty).
2. Plan 02 Task 2 — one of two paths must be taken:
   - **Path A (ship Deribit in Phase 06):** add a Deribit branch in `_fetch_spot_rows` that iterates `['BTC', 'ETH', 'USDC']` with per-currency `fetch_balance({'currency': c})` calls; emit rows using the returned structure. Acceptance criteria must grep for the per-currency branch.
   - **Path B (defer Deribit):** narrow D-17 — raise `DeribitNotSupportedError` (a subclass of `ccxt.NotSupported`) in `_fetch_spot_rows` when `exchange.id == 'deribit'`; `_map_exception_to_sync_status` maps it to `sync_status='error'` with sanitized message "Deribit spot ingestion not yet supported — derivatives still sync." Add pytest that asserts this explicit error (not silent empty). Update ROADMAP.md Phase 06 note and PROJECT.md "Active — Inherited deferrals" to log the deferral.
3. Planner picks Path A if a Deribit test key is available in the Keychain harness; otherwise Path B. Planner must explicitly state the choice and why in Plan 02 Task 2's `<reasoning>` block.

---

## f4 — Fire-and-forget first-run sync produces stuck "Syncing…" pill (WARNING / MED — risk)

**Change target:** `06-04-PLAN.md` → Plan 04 Task 2 (AllocatorExchangeManager extension) + Task 2 test suite.

**Problem:** Plan 04 Task 2 step 5 implements first-run as `fetch('/api/allocator/holdings/sync', …).catch(() => {})` + optimistic `sync_status='syncing'` — errors are swallowed, pill stays "Syncing…" while server stays `idle`. User sees flicker with no feedback on failure.

**Required fix:**
1. Rewrite the first-run sync block in `handleAddKey` to await the POST.
2. On non-2xx, surface helper text on the new row using the same `aria-live="polite"` pattern as `handleSync` (the SAVE path from MandateSaveStatus). Pill drops back to `idle` (or `error` if the server confirmed 500); helper line shows "Sync request failed — click Sync now to retry".
3. Close the add-key modal before the POST fires so the error surfaces on the row rather than blocking the modal; OR await the POST then close the modal on success and keep it open with an inline error on failure — planner picks based on UX-SPEC intent.
4. Add Plan 04 Task 2 pytest case `handleAddKey_shows_error_when_first_run_sync_fails_with_403` asserting the pill transitions to `idle` and the helper text contains "Sync request failed".
5. Threat model block in Plan 04 must add a STRIDE row for "Tampering / DoS: stuck UI state masking backend failures" with this mitigation cited.

---

## f5 — No DB constraint couples `allocator_holdings.allocator_id` to `api_keys.user_id` (WARNING / HIGH — architecture)

**Change target:** `06-01-PLAN.md` → Plan 01 Task 1 (migration 066).

**Problem:** The worker writes `allocator_id = ctx.key_row["user_id"]` at run time. Table has FKs on both `allocator_id` and `api_key_id` but nothing couples them. If `api_keys.user_id` is ever updated (admin reassignment, Phase 08 revoke/delete), the unique index `(allocator_id, venue, symbol, asof)` can silently fork history under a new owner while old rows persist under the old `allocator_id`.

**Required fix:**
1. Add a BEFORE INSERT OR UPDATE trigger on `allocator_holdings` (function: `enforce_allocator_holdings_owner_coherence()`, SECURITY DEFINER):
   - Raises `EXCEPTION 'allocator_holdings.allocator_id (%) must match api_keys.user_id (%) for api_key_id %', NEW.allocator_id, (SELECT user_id FROM api_keys WHERE id = NEW.api_key_id), NEW.api_key_id` when the two don't match.
   - `SECURITY DEFINER` + `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` to avoid info disclosure via raise-messages.
2. Add to the self-verifying DO block: an explicit insert of a mismatched-owner row that MUST raise the trigger error (the test validates that the trigger fires). Use a SAVEPOINT/`EXCEPTION WHEN OTHERS` pattern equivalent to capture and assert the error, then rollback the failing insert.
3. Task 1 acceptance criteria must grep for `CREATE OR REPLACE FUNCTION enforce_allocator_holdings_owner_coherence` and `BEFORE INSERT OR UPDATE ON allocator_holdings`.

---

## f6 — Cron idempotency key races across day boundaries with ±600s jitter (WARNING / MED — risk)

**Change target:** `06-01-PLAN.md` → Plan 01 Task 1 (migration 066 — `enqueue_poll_allocator_positions_for_all_keys` body).

**Problem:** Idempotency key is built as `'daily-alloc-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '-' || v_api_key_id` at enqueue time. Safe at 04:00 UTC today, but fragile: schedule moves leave a silent race where a job enqueued at 23:59:xx with 600s jitter lands on day D+1 while its idempotency key says day D — and the next day's 04:00 fires a new `daily-alloc-(D+1)-…` before the first runs.

**Required fix:**
1. Compute the idempotency key against the **actual run day** by jittering first:
   ```sql
   v_jitter := (random() * interval '600 seconds');
   v_run_at := now() + v_jitter;
   v_idempotency_key := 'daily-alloc-' || to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '-' || v_api_key_id;
   ```
2. Add a comment in the migration + an assertion line to the DO block: `ASSERT EXTRACT(HOUR FROM (SELECT schedule FROM cron.job WHERE jobname = 'poll-allocator-positions')) BETWEEN 1 AND 22, 'Cron schedule must stay ≥1h from midnight to avoid jitter-boundary race';` — breaks the migration if a future edit moves the cron inside the danger zone.
3. Task 1 acceptance criteria must grep for both the `v_run_at` pre-jitter pattern AND the cron-schedule hour assertion.

---

## f7 — `_emit_audit` path unverified; Python audit taxonomy may be absent (WARNING / MED — verification)

**Change target:** `06-02-PLAN.md` → Plan 02 Task 1 (pre-impl inspection) + Task 3 (worker handler wiring).

**Problem:** Plan 02 Task 3 leaves `_emit_audit` underspecified ("inspect services/audit.py and wire accordingly"). Per RESEARCH Section 4, the Python-side audit action constants `allocator.holdings.sync_completed` and `allocator.holdings.sync_failed` are likely NOT currently present in `analytics-service/services/audit.py`. If the function or constants are missing, the executor may silently define a local no-op and the audit rows never materialize.

**Required fix:**
1. Add a Plan 02 pre-task (insert as Task 1.5 or fold into Task 1): `Read analytics-service/services/audit.py; verify (a) function log_audit_event_service(supabase, action, entity_type, entity_id, metadata) exists with that exact signature, AND (b) string constants for the three allocator.holdings.* events. If either is missing, add them in this task.`
2. Plan 02 Task 3 acceptance criteria must include BOTH grep conditions:
   - `grep -c 'allocator.holdings.sync_completed\|allocator.holdings.sync_failed\|allocator.holdings.sync_requested' analytics-service/services/audit.py` ≥ 3 (constants registered)
   - `grep -c 'log_audit_event_service\|_emit_audit' analytics-service/services/job_worker.py` ≥ 2 (handler actually calls the function)
3. Add a pytest case in Plan 02 Task 1's RED suite: `test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done` — mock the audit service call, run the handler with a DONE outcome, assert the mock received the `allocator.holdings.sync_completed` action.

---

## f8 — Rate-limit contagion: strategy 429 blocks allocator first-run on same exchange (INFO / MED — architecture)

**Change target:** `06-02-PLAN.md` (worker semantics note) + `06-04-PLAN.md` (UI state decision) + phase summary.

**Problem:** `_check_circuit_breaker` is per-exchange. Strategy-side `poll_positions` 429 on Binance = per-exchange cooldown blocks allocator `poll_allocator_positions` on Binance for 120s (or up to 600s on Bybit). INGEST-07 first-run-on-key-add silently defers with `DispatchOutcome.DEFERRED` and the UI pill shows "Syncing…" with no deferred state indicator.

**Required fix (chosen path: document + surface, do NOT split breaker):**
1. Plan 02 Task 3 (worker handler) — explicitly comment that `DispatchOutcome.DEFERRED` is a valid terminal-for-this-invocation state that leaves `api_keys.sync_status='syncing'` (job stays pending in queue). Document the contagion in a code comment above `_allocator_key_preflight`.
2. Plan 04 Task 1 (AllocatorSyncStatus sub-component) — do not add a new pill state; the existing `syncing` state covers it. BUT the helper text rendering logic must check `compute_jobs.next_attempt_at > now() + interval '30 seconds'` as a heuristic — if the next attempt is ≥30s out, helper text reads "Queued — exchange cooldown, retry in {N}s". This requires the route or a polling endpoint to return the queued-job's next_attempt_at.
3. Plan 03 (sync route) — extend the response on `already_inflight: true` to include the existing job's `next_attempt_at` if the job is in `pending` status (not `running`). Plan 04 surfaces this.
4. Phase summary doc (addendum or SUMMARY at phase completion) must contain: "Note: first-run sync may show 'Queued' pill for up to 10 minutes if the strategy-side worker has recently hit rate-limiting on the same exchange. This is expected behavior — per-exchange circuit-breaker is shared across worker kinds. The pill surfaces the queue state; no action needed from the allocator."
5. NOT in scope for Phase 06: splitting `_check_circuit_breaker` to a per-(exchange, api_key_id) breaker. Leave as a tracked item for future work in PROJECT.md "Active — Inherited deferrals".

---

**Total accepted:** 8 findings → 2 BLOCKER + 5 WARNING + 1 INFO. Planner must return `## REVISION COMPLETE` with a bullet per finding confirming where it was applied.
