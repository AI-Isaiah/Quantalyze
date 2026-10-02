---
phase: 110-contrib-private-by-default-contribution
plan: 01
subsystem: database
tags: [rls, secdef-rpc, status-lifecycle, contrib-private]
status: complete
requires: []
provides:
  - "strategies.status admits an owner-only 'private' terminal value"
  - "finalize_wizard_strategy + finalize_csv_strategy accept a guarded p_terminal_status (pending_review|private); 'published' unreachable from any finalize caller"
  - "RLS cross-owner isolation SQL test for status='private' (CONTRIB-04 DB layer)"
affects:
  - "plan 110-04 (contribution finalize branch) — will call a finalize RPC with p_terminal_status='private'"
tech-stack:
  added: []
  patterns:
    - "CHECK-constraint DROP-then-ADD widening idiom (clone of 20260602180000_funding_fees_exchange_check.sql)"
    - "DROP FUNCTION exact-sig + CREATE FUNCTION (not CREATE OR REPLACE) to add a param without a PostgREST overload"
    - "plain PL/pgSQL BEGIN..ROLLBACK RLS isolation test (clone of test_strategy_keys_rls.sql)"
key-files:
  created:
    - supabase/migrations/20260716130000_strategies_status_private.sql
    - supabase/migrations/20260716130500_finalize_terminal_status_param.sql
    - supabase/tests/test_strategies_private_owner_isolation.sql
  modified:
    - supabase/schema/functions/finalize_wizard_strategy.sql
    - supabase/schema/functions/finalize_csv_strategy.sql
decisions:
  - "trust-tier (strategy_verifications) insert KEPT on both terminal statuses — it is an owner-facing data-quality label, not a publish signal (RESEARCH Open Q3)"
  - "W1 resolved: the unified finalize arm writes strategies.status via NO third DB function — no additional migration widening needed this plan"
metrics:
  tasks_completed: 2
  tasks_total: 3
  files_created: 3
  files_modified: 2
  completed: 2026-07-16
---

# Phase 110 Plan 01: Private-by-default DB unit Summary

**Owner-only `status='private'` foundation for allocator contributions: widened the strategies status CHECK, threaded a guarded `p_terminal_status` through both SECURITY DEFINER finalize RPCs so `'published'` is unreachable from any finalize caller, and content-asserted cross-owner RLS isolation.** Tasks 1–2 are complete and committed; Task 3 is a `[BLOCKING]` Supabase-MCP migration-apply to the test project — the executor has no Supabase MCP, so it is handed to the orchestrator (see CHECKPOINT below).

## Status: COMPLETE (all 3 tasks)

| Task | Name | Status | Commit |
| ---- | ---- | ------ | ------ |
| 1 | status CHECK widen + guarded p_terminal_status on both finalize RPCs | done | `af543d3b` |
| 2 | RLS cross-owner isolation SQL test | done | `6de14afc` |
| 3 | MCP-apply migrations to test project + run isolation test | done (orchestrator MCP) | — (test-project apply, no repo commit) |

## What was built

- **Migration A — `20260716130000_strategies_status_private.sql`:** DROP-then-ADD `strategies_status_check` widening the IN-list to `('draft','pending_review','published','archived','private')`. Pre-flight fail-loud guard + self-verifying DO block, cloned from the funding_fees analog. NOT an RLS-policy migration — `strategies_read` (`status='published' OR user_id=auth.uid()`) already makes `'private'` owner-visible + never-public; contains zero `CREATE POLICY`/`ALTER POLICY`.
- **Migration B — `20260716130500_finalize_terminal_status_param.sql`:** `DROP FUNCTION` (exact old signature) + `CREATE FUNCTION` for both `finalize_wizard_strategy` (12→13 params) and `finalize_csv_strategy` (4→5 params), re-based byte-for-byte on the canonical snapshots. Each gains a trailing `p_terminal_status TEXT DEFAULT 'pending_review'` and a FIRST-statement guard `IF p_terminal_status NOT IN ('pending_review','private') THEN RAISE`. The hardcoded terminal write is swapped to `p_terminal_status`. Guard gauntlet, `strategy_verifications` insert, SECURITY DEFINER, `search_path` pin, and re-issued `REVOKE FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated` footers preserved. A self-verify DO block asserts exactly one overload of each function survives and both carry `p_terminal_status`. Snapshots regenerated via `npm run schema:functions` (idempotency verified with `schema:functions:check`).
- **Test — `test_strategies_private_owner_isolation.sql`:** 5 content-asserted arms (owner-B-sees-0-private, owner-B-sees-published-control, owner-A-sees-own-private, anon-sees-0-private, and the guard pin that `finalize_wizard_strategy(p_terminal_status=>'published')` RAISEs). Every count is scoped to a specific fixture id (never a global count) so nothing passes vacuously; the private-row INSERT is the RED guard on migration A (23514 until applied).

## W1 resolution — the unified finalize arm's status writer (plan-checker warning)

**Finding: the current plan is SUFFICIENT — no additional DB function needs widening in this migration.** Traced the finalize surface end-to-end:

- **Terminal `strategies.status` is written by exactly two DB functions:** `finalize_wizard_strategy` and `finalize_csv_strategy`. Both are widened here. A whole-repo grep confirms no other `UPDATE strategies SET status = 'pending_review'` (migrations) and no other Python/TS status-to-terminal writer.
- **Unified CSV arm** (`analytics-service/routers/process_key.py:778`) calls `finalize_csv_strategy` RPC — covered by the widening. The `"status": "pending_review"` at `process_key.py:809` is a **response literal**, not a DB write.
- **Unified API-key wizard arm** (`unifiedFinalizeWizardHandler` → `postProcessKey` → analytics `/process-key` → `enqueue_compute_job('process_key_long')`) does **NOT** synchronously write `strategies.status` via any DB function or literal. It advances `strategy_verifications.status` through the `transition_strategy_verification` state machine; the worker (`long_fetch.py:436`) writes only `strategies.fingerprint`. So there is no third DB function writing `strategies.status` to a terminal state that would need a `p_terminal_status` widening. This is the "TS/literal is sufficient" branch of the W1 decision → **current plan sufficient**.
- **Legacy path** (`runLegacyFinalize` at `finalize-wizard/route.ts:713`, reached today via the composite hoist) calls `finalize_wizard_strategy` — covered.

**Wiring note handed to plan 110-04 (non-blocking for 110-01):** a single-key API-key contribution currently routes to the unified arm, which does not promote `strategies.status`. To finalize such a contribution at `'private'`, 110-04 must route the contribution branch through a writer that honors `p_terminal_status` — i.e. `finalize_wizard_strategy` (via `runLegacyFinalize`) with `p_terminal_status='private'` for the API-key path, and `finalize_csv_strategy` with `p_terminal_status='private'` for the CSV path. That is a route-wiring decision for 110-04, not a missing migration here.

## Threat model coverage

- **T-110-01** (cross-owner private read): asserted by test arms 1 (owner B → 0) + 4 (anon → 0), with arm 2 proving the harness.
- **T-110-02** (finalize to 'published'): the first-statement RAISE guard on both RPCs; pinned by test arm 5.
- **T-110-03 / T-110-04** (ownership gauntlet / dropped-fn grants): guard gauntlet re-based byte-identical; REVOKE/GRANT re-issued after DROP+CREATE.

## Guard-trigger interaction (verified non-regression)

`guard_wizard_draft_updates` (trigger on strategies) blocks direct client flips out of `(source=wizard, status=draft)` but does not inspect the specific target status value (only draft-ness). Writing `p_terminal_status='private'` therefore behaves identically to `'pending_review'` under that trigger — no new regression. The new guard is the first statement, so it RAISEs before the strategies UPDATE (and thus before the trigger) on a rejected terminal status.

## Deviations from Plan

None — Tasks 1–2 executed exactly as written. The W1 plan-checker warning was investigated first (per critical reminder) and resolved as "current plan sufficient" with a documented wiring note for 110-04.

## Task 3 — MCP-apply to test project (COMPLETE, confirmed by orchestrator 2026-07-16)

Both migrations applied to test project `qmnijlgmdhviwzwfyzlc` via MCP `apply_migration` in filename order. Verified green:

- **schema_migrations timestamp fix CONFIRMED:** `apply_migration` stamps `now()`; the two version rows were corrected to the file timestamps `20260716130000` + `20260716130500`, so prod auto-apply on merge will not double-apply.
- `strategies_status_check` now = `CHECK status IN ('draft','pending_review','published','archived','private')` — `'private'` admitted.
- `finalize_wizard_strategy`: exactly 1 overload; `finalize_csv_strategy`: exactly 1 overload (no PostgREST ambiguity). Both carry `p_terminal_status`.
- `test_strategies_private_owner_isolation.sql` ran via `execute_sql` with **no exception** — all 5 arms passed (RLS 1 owner-B-sees-0-private, RLS 2 owner-B-sees-published-control, RLS 3 owner-A-sees-own-private, GUARD 5 finalize rejects `p_terminal_status=published`, RLS 4 anon-sees-0-private).

CI's `sql-tests` job re-proves the isolation test post-merge.

## Self-Check: PASSED

- `supabase/migrations/20260716130000_strategies_status_private.sql` — FOUND
- `supabase/migrations/20260716130500_finalize_terminal_status_param.sql` — FOUND
- `supabase/tests/test_strategies_private_owner_isolation.sql` — FOUND
- Commit `af543d3b` — FOUND
- Commit `6de14afc` — FOUND
- Snapshot idempotency (`schema:functions:check`) — CLEAN
- Branch — `gsd/v1.11-scenario-composer-v2` (unchanged)
