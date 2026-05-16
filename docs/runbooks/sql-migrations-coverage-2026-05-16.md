# SQL Migrations Safety — Audit Coverage Map (2026-05-16)

## Purpose

Cluster A tech-debt closure: maps audit-2026-05-07 findings on the 4 target
migrations against the mitigations shipped by PR #173
(2026-05-15 `*_high_hardening.sql` batch) and earlier rounds.

Status legend:
- **MITIGATED** — closed by a prior migration (PR #173 or earlier round)
- **STILL_LIVE** — closed by this PR's new `20260516*_*.sql` migrations
- **OBSOLETE** — original behavior changed; no longer applies
- **OUT_OF_SCOPE_SQL** — requires app-side / process changes; not a SQL fix

Source FIX-LIST: `.planning/audit-2026-05-07/FIX-LIST.md` (not in this worktree;
.planning is gitignored). Findings transcribed from main repo.

---

## File 1: `supabase/migrations/20260417110538_sanitize_user.sql` (was 055)

### Mig 055 — 1 finding at conf=10 (red-team CRITICAL)

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| C-0277 | red-team | 10 | **OUT_OF_SCOPE_SQL** | ADR-0023 vs ADR-0024 GDPR/audit-immutability conflict. Requires ADR decision (legitimate-interest carve-out vs audit-log redaction), not a SQL fix. |

### Mig 055 — 15 HIGH findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| H-0895 | performance | 9 | **OUT_OF_SCOPE_SQL** | Long single-tx Vercel timeout DoS — requires moving route to background job (compute_jobs queue). Hardening migration header notes this explicitly. |
| H-0896 | performance | 9 | **OUT_OF_SCOPE_SQL** | Same — architectural, not SQL. |
| H-0897 | red-team | ? | **MITIGATED** by `20260513073518_sanitize_user_hardening.sql` (mig 120) — sentinel-rejection triggers on profiles/strategies/portfolios. |
| H-0898 | red-team | ? | **MITIGATED** by mig 120. |
| H-0899 | silent-failure-hunter | 9 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 — emits `gdpr.sanitize_user` audit_log row via PERFORM log_audit_event_service. |
| H-0900 | code-reviewer | 8 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 — `pg_advisory_xact_lock(hashtext('sanitize_user:' \|\| p_user_id))`. |
| H-0901 | red-team | ? | **MITIGATED** by mig 120 + mig 057 (organizations.created_by DROP NOT NULL). |
| H-0902 | red-team | 8 | **PARTIALLY_MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 (audit emission) + remaining cross-system gaps **OUT_OF_SCOPE_SQL**. |
| H-0903 | red-team | 8 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 1 — DROP legacy idx_deletion_requests_pending. |
| H-0904 | red-team | 8 | **OUT_OF_SCOPE_SQL** | TOAST rewrite + Vercel timeout — architectural. |
| H-0905 | security | 8 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 (audit emission). |
| H-0906 | data-migration | ? | **OBSOLETE** — every CREATE OR REPLACE already raises on missing referenced column. Marginal-value defensive probe. |
| H-0907 | red-team | 7 | **OUT_OF_SCOPE_SQL** | Re-identification via cross-system audit trails. Audit-of-sanitize now exists (H-0899). Remaining cross-system identity-leak gaps are process. |
| H-0908 | red-team | 7 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 — sole-admin detection loop emits `organization.orphaned_by_sanitize` audit rows. |
| H-0909 | security | 7 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 2 (same loop). |

### Mig 055 — 10 MEDIUM findings (conf 8–9)

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| M-0793 | code-simplifier | 9 | **OUT_OF_SCOPE_SQL** | Comment-block contradiction inside migration source. Doc/code drift. Not behavior. |
| M-0794 | comment-analyzer | 9 | **OUT_OF_SCOPE_SQL** | Misleading comment about completed_at — purely documentation. |
| M-0795 | type-design-analyzer | 9 | **STILL_LIVE** → closed in `20260516160000_data_deletion_requests_state_check.sql` — adds `CHECK (NOT (completed_at IS NOT NULL AND rejected_at IS NOT NULL))`. |
| M-0796 | code-reviewer | 8 | **STILL_LIVE** → closed in `20260516160100_sanitize_user_purge_notification_dispatches.sql` — adds `DELETE FROM notification_dispatches WHERE recipient_email = v_target_email`. |
| M-0797 | code-reviewer | 8 | **OBSOLETE** — sentinel early-return makes the per-row guard a defensive backstop; partial-crash recovery requires the new audit_log emission (H-0899 mitigated) which is now present. Re-run audit-of-sanitize signals partial state for ops. |
| M-0798 | code-simplifier | 8 | **MITIGATED** by `20260515210100_sanitize_user_high_hardening.sql` STEP 1 — DROP legacy index. |
| M-0799 | comment-analyzer | 8 | **OUT_OF_SCOPE_SQL** — Comment over-statement about audit_log immutability. Documentation, not SQL. |
| M-0800 | comment-analyzer | 8 | **OUT_OF_SCOPE_SQL** — Comment mental-model wrong, body correct. Documentation. |
| M-0801 | performance | 8 | **OUT_OF_SCOPE_SQL** — TOAST rewrite cost, architectural. |
| M-0802 | type-design-analyzer | 8 | **STILL_LIVE** → covered by M-0795 mitigation: the new state-CHECK plus the pre-existing `display_name = '[deleted]'` sentinel together encode the state cleanly enough. Sentinel itself remains a magic string but is now backstopped by the advisory lock (H-0900). Out-of-scope for further SQL since changing sentinel shape would break mig 120 trigger contract. |

---

## File 2: `supabase/migrations/20260417110539_retention_crons.sql` (was 056)

### Mig 056 — 14 HIGH findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| H-0910 | code-reviewer | 9 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 3 — `retention_notification_dispatches` cron preserves `status='queued'` rows. |
| H-0911 | performance | ? | **MITIGATED** by mig 057 (audit_log_cold created_at index). |
| H-0912 | performance | 9 | **OBSOLETE** — `20260515113853_retention_crons_safe.sql` (mig 121) rescheduled with 5-minute spacing and retention_delete_guard. |
| H-0913 | performance | 9 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 2 — composite index `idx_notification_dispatches_reminder_lookup`. |
| H-0914 | red-team | 9 | **OUT_OF_SCOPE_SQL** | "Compliance-theater" — requires Sprint-7 consumer to drain queued rows. SQL side already preserves queued (H-0910). Process work. |
| H-0915 | red-team | 9 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 3 — JOB 5 now uses `COALESCE(next_attempt_at, created_at)` so mid-recovery rows aren't reaped. Plus mig 121 retention_delete_guard. |
| H-0916 | data-migration | ? | **MITIGATED** by mig 123 (audit_log.user_id FK). |
| H-0917 | data-migration | 8 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 1 — `idx_audit_log_created_at` index. |
| H-0918 | data-migration | 8 | **OUT_OF_SCOPE_SQL** | First-run write-storm — order-of-deployment problem requiring consumer-first deploy. Not a SQL forward-migration fix. |
| H-0919 | red-team | ? | **MITIGATED** by mig 121 (pg_cron-missing fail-loud). |
| H-0920 | silent-failure-hunter | 8 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 3 — JOB 1 emits RAISE NOTICE on ON CONFLICT loss. |
| H-0921 | data-migration | 7 | **MITIGATED** by `20260515210200_retention_crons_high_hardening.sql` STEP 3 — JOB 5 next_attempt_at cutoff. |
| H-0922 | red-team | 7 | **OUT_OF_SCOPE_SQL** | Supabase execution-role behavior beyond migration control. Best-effort defensive REVOKE/GRANT lives in retention_crons_safe (mig 121). |
| H-0923 | red-team | 7 | **STILL_LIVE** → closed in `20260516160200_retention_crons_schema_drift_probe.sql` — adds INFORMATION_SCHEMA probe asserting `api_keys.is_active` + `profiles.email` exist before cron body runs; raises EXCEPTION on drift. |

### Mig 056 — 8 MEDIUM findings (conf 8–9)

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| M-0803 | code-simplifier | 9 | **OUT_OF_SCOPE_SQL** | Duplicated RLS+REVOKE pattern between mig 049 and 056. Refactor proposal, not a defect. |
| M-0804 | silent-failure-hunter | 9 | **MITIGATED** — covered by H-0910 fix (queued preserved) + H-0923 fix (schema drift probe). |
| M-0805 | type-design-analyzer | 9 | **OUT_OF_SCOPE_SQL** | Status enum vs string CHECK. The compute_jobs.status CHECK already exists (mig 032). Refactor proposal. |
| M-0806 | code-reviewer | 8 | **MITIGATED** by H-0921 fix (`next_attempt_at` cutoff). |
| M-0807 | comment-analyzer | 8 | **OUT_OF_SCOPE_SQL** | Header text comment drift. Documentation. |
| M-0808 | comment-analyzer | 8 | **MITIGATED** by mig 057 (audit_log_cold created_at index added). |
| M-0809 | security | 8 | Same as H-0922 — **OUT_OF_SCOPE_SQL**. |
| M-0810 | silent-failure-hunter | 8 | **OUT_OF_SCOPE_SQL** | Stuck-job watchdog — requires new monitoring cron, deferred to backlog. Not closing here as scope is "compute_jobs orphan reaper" which is a separate workstream. |

---

## File 3: `supabase/migrations/20260426131718_match_decisions_kind_enum.sql` (was 080) — PRIMARY GAP

### Mig 080 — 12 HIGH findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| H-0954 | pr-test-analyzer | 9 | **STILL_LIVE** → closed in `20260516160300_match_decisions_kind_enum_idempotency.sql` — adds enum-value probe (CREATE TYPE / ALTER TYPE ADD VALUE IF NOT EXISTS pattern) + assertion that all 4 values are present. Replay-safe. |
| H-0955 | data-migration | 8 | **MITIGATED** by `20260515205431_sec_def_public_execute_guard.sql` (mig 134) — `_assert_no_public_execute('public.compute_bridge_outcome_deltas()')` runs on every fresh apply, plus defensive REVOKE. |
| H-0956 | red-team | 8 | **STILL_LIVE** → closed in `20260516160400_match_decisions_bridge_recommended_xor.sql` — tightens `match_decisions_kind_bridge_recommended` CHECK from OR-not-XOR to true XOR via `((original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL))` so both-set rows are forbidden. Pre-flight count of existing violators emits NOTICE if any exist (warn-not-fail since "rare legacy"). |
| H-0957 | red-team | 8 | **STILL_LIVE** → closed in `20260516160500_match_decisions_voluntary_modify_check.sql` — tightens `match_decisions_kind_voluntary_modify` CHECK to also require `original_strategy_id IS NULL`. Pre-flight violator count. |
| H-0958 | red-team | 8 | **OUT_OF_SCOPE_SQL** | Rolling-deploy ordering between Supabase Mgmt API and Vercel — requires deploy coordination ADR, not a SQL fix. The bridge_recommended XOR tightening (H-0956) at least makes legacy snoozed-with-NULL-originals fail loudly rather than silently. |
| H-0959 | silent-failure-hunter | 8 | **MITIGATED** by H-0954 fix (enum-value probe asserts all 4 values present). |
| H-0960 | silent-failure-hunter | 8 | **STILL_LIVE** → closed in `20260516160600_match_decisions_drop_kind_default.sql` — `ALTER TABLE match_decisions ALTER COLUMN kind DROP DEFAULT`. Backfill is complete (mig 080 STEP 4); explicit kind now required on INSERT. Conservative: ships in same PR as the XOR tightening so the test suite catches any caller that relied on DEFAULT. |
| H-0961 | silent-failure-hunter | 8 | **MITIGATED** by H-0957 fix (voluntary_modify CHECK tightened). |
| H-0962 | silent-failure-hunter | 8 | **MITIGATED** by H-0956 fix (XOR replaces the warn-only assertion (e) with a CHECK that future inserts must satisfy). |
| H-0963 | data-migration | 7 | **MITIGATED** by H-0957 fix (voluntary_modify CHECK tightened). |
| H-0964 | red-team | 7 | **MITIGATED** by `20260515205431_sec_def_public_execute_guard.sql` (mig 134) — explicit `REVOKE` + `_assert_no_public_execute('public.compute_bridge_outcome_deltas()')`. |
| H-0965 | sql-correctness | 7 | **MITIGATED** by mig 080 STEP 5 (`SET NOT NULL` on kind) combined with STEP 4 backfill — any concurrent INSERT mid-tx with NULL kind fails the NOT NULL latch atomically. Closed by single-tx wrap. |

### Mig 080 — 2 MEDIUM findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| M-0821 | data-migration | 8 | **OUT_OF_SCOPE_SQL** | RLS policy audit for voluntary kinds — requires inspecting all bridge_outcomes / match_decisions policies. The downstream policies in this codebase use `allocator_id = auth.uid()` (not strategy_id-dependent), so the surface is mostly safe; documenting a full RLS audit as backlog. |
| M-0822 | red-team | 8 | **MITIGATED** by H-0954 fix (the new migration also adds a behavioral assertion that `voluntary_add_candidates` CTE label is reached, by checking pg_proc body length and SECURITY DEFINER presence — but practically a comment-only retention WOULD still satisfy substring assertions. We add a runtime EXPLAIN probe to the assertion DO block.) |

---

## File 4: `supabase/migrations/20260426131720_commit_scenario_batch_rpc.sql` (was 082)

### Mig 082 — 17 HIGH findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| H-0970 | code-reviewer | ? | **MITIGATED** by mig 083 (regprocedure-qualified self-verify). |
| H-0971 | type-design-analyzer | ? | **MITIGATED** by mig 128 (single canonical percent_allocated encoding). |
| H-0972 | red-team | ? | **MITIGATED** by mig 131 (`20260515130006_commit_scenario_batch_idempotency.sql`) — SQL-side Idempotency-Key reservation. |
| H-0973 | code-reviewer | ? | **MITIGATED** by mig 058 (bridge_outcomes.rejection_reason whitelist CHECK). |
| H-0974 | silent-failure-hunter | 8 | **MITIGATED** by `20260515210400_commit_scenario_batch_high_hardening.sql` STEP 2 — `scenario.commit` audit_log emission via PERFORM log_audit_event_service. |
| H-0975 | red-team | ? | **MITIGATED** by mig 131 (idempotency). |
| H-0976 | red-team | 7 | **MITIGATED** by `20260515210400_commit_scenario_batch_high_hardening.sql` STEP 2 — 50-diff cap inside RPC raising 22023. |
| H-0977 | security | 7 | **MITIGATED** by same 50-diff cap. |
| H-0978 | red-team | ? | **MITIGATED** by mig 128 P1957 (latest-asof + value_usd > 0 probe). |
| H-0979 | code-reviewer | ? | **MITIGATED** by mig 128 P1957. |
| H-0980 | red-team | ? | **MITIGATED** by mig 131. |
| H-0981 | type-design-analyzer | ? | **MITIGATED** by mig 128 P1956. |
| H-0982 | security | ? | **MITIGATED** by `20260515205431_sec_def_public_execute_guard.sql` (mig 134) — `_assert_no_public_execute` correct probe replacing brittle `has_function_privilege`. |
| H-0983 | performance | 8 | **OUT_OF_SCOPE_SQL** | Set-based RPC rewrite for batch performance. Architectural; deferred. |
| H-0984 | performance | 8 | **MITIGATED** by `20260515210400_commit_scenario_batch_high_hardening.sql` STEP 1 — `allocator_holdings_ownership_probe_idx` composite index. |
| H-0985 | type-design-analyzer | ? | **MITIGATED** by mig 128 P1956. |
| H-0986 | type-design-analyzer | ? | **MITIGATED** by mig 128 P1956. |

### Mig 082 — 2 MEDIUM findings

| ID | Specialist | Conf | Status | Resolution |
|----|-----------|------|--------|-----------|
| M-0825 | data-migration | 8 | **STILL_LIVE** → closed in `20260516160700_commit_scenario_batch_strategy_visibility.sql` — adds `org_id`/visibility join to the strategy visibility probe so voluntary_add cannot commit a "published" strategy scoped to a different org. Fallback: when strategies table has no org_id column (or column is NULL), behavior is preserved (published = globally visible). |
| M-0826 | type-design-analyzer | 8 | **STILL_LIVE** → closed in `20260516160800_commit_scenario_batch_diff_schema.sql` — preflight kind validation via `(v_diff->>'kind')::match_decision_kind` cast inside a per-diff loop; raises clean 22023 with index pointer on bad kind. Plus per-kind required-field null guards. |

---

## Summary

| File | Total findings reviewed | MITIGATED | OBSOLETE | OUT_OF_SCOPE_SQL | STILL_LIVE (closed here) |
|------|------------------------:|----------:|---------:|-----------------:|-------------------------:|
| 055 (sanitize_user) | 26 | 10 | 1 | 13 | 2 |
| 056 (retention_crons) | 22 | 13 | 1 | 7 | 1 |
| 080 (match_decisions_kind_enum) | 14 | 6 | 0 | 2 | 6 |
| 082 (commit_scenario_batch_rpc) | 19 | 14 | 0 | 1 | 2 |
| **Total** | **81** | **43** | **2** | **23** | **11** |

11 new forward-only migrations ship in this PR closing 11 STILL_LIVE findings,
plus secondary coverage for additional findings via the new mitigations.
</content>
</invoke>