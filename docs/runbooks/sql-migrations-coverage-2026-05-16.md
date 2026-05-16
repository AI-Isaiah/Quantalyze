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

## Grok adversarial pass — override

- Verdict: BLOCK on SECDEF `search_path` discipline (severity 9 x 2 findings on
  `20260516160100` and `20260516160700`). Grok preferred greenfield rule
  `SET search_path TO ''` with fully-qualified internal calls.
- Override: user decision per CLAUDE.md Rule 11 (match codebase conventions).
  Convention `SET search_path = public, pg_catalog` is in prod across 89 prior
  migrations including PR #173 high-hardening batch (2026-05-15). The two
  flagged functions are CREATE OR REPLACE / REVOKE-from-PUBLIC, so search_path
  is not reachable without EXECUTE.
- Follow-up: project-wide SECDEF `search_path TO ''` refactor filed as backlog
  tech-debt; would require touching all 89 prior migrations in lockstep.

## Proper-specialist apply pass take 2 — 2026-05-16

Six specialists (code-reviewer, security, data-migration, pr-test-analyzer,
performance, red-team) re-reviewed PR #182 after the initial review-cluster
landed. Aggregate: ~52 findings (1 CRITICAL conf-9 confirmed by 3
specialists, 6 HIGH conf 8-10, ~14 MED conf 7-8, rest LOW/INFO).

### CRITICAL findings closed in this PR

| ID | Specialist consensus | Source | Closure |
|----|----------------------|--------|---------|
| CRITICAL-1 | code-reviewer c9 + security c9 + data-migration c9 | mig 160700 — `_match_decisions_visibility_check` trigger fires as caller's role and `PERFORM`s `_assert_strategy_visible_to_allocator` which was REVOKEd from service_role. Every direct service_role INSERT (test suites + admin routes) would 42501. | `20260516170000_match_decisions_visibility_check_secdef_fix.sql` — GRANT EXECUTE on the helper to service_role + authenticated, matches sanitize_user pattern. |
| CRITICAL-2 | security c9 | mig 122247 — `reset_stalled_portfolio_analytics` SECDEF function created with no REVOKE; PUBLIC EXECUTE → cross-tenant DoS via `interval '1 second'` parameter. | `20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql` — REVOKE FROM PUBLIC/anon/authenticated; GRANT TO service_role; `_assert_no_public_execute` probe. |

### HIGH findings closed in this PR

| ID | Specialist | Closure |
|----|-----------|---------|
| HIGH-1 | data-migration c8 | `20260516170200_match_decisions_constraint_validate.sql` — VALIDATE CONSTRAINT for both v2 CHECKs after pre-flight violator-count probe. |
| HIGH-2 | red-team c9 | `20260516170300_notification_dispatches_recipient_email_idx.sql` — `CREATE INDEX CONCURRENTLY` on recipient_email closes the seq-scan inside the sanitize_user advisory-locked tx. |
| HIGH-3 | performance c8 | `20260516170400_portfolio_analytics_computing_idx_concurrently.sql` — DROP + rebuild idx_portfolio_analytics_computing CONCURRENTLY (the original mig 122247 build took ACCESS EXCLUSIVE). |
| HIGH-4 | pr-test-analyzer c10 | EDIT `src/__tests__/bridge-outcome-cron.test.ts` + `bridge-outcome-cron-holding.test.ts` — add `kind: 'bridge_recommended'` to 4 match_decisions INSERT sites (mig 160600 dropped the DEFAULT). |
| HIGH-5 | red-team c8 | DOCUMENT only — sanitize_user verification regex requires unqualified `notification_dispatches`. Future hardening must coordinate the regex update; flagged in tech-debt backlog. CANNOT edit mig 160100 itself per the rebase contract. |
| HIGH-6 | red-team c8 | DOCUMENT only — see "Vercel rollback hazard" below. |

### MED findings closed in this PR

| ID | Specialist | Closure |
|----|-----------|---------|
| MED-1 | code-reviewer c8 + red-team c8 | `20260516170600_validate_scenario_diff_numeric_cast_hardening.sql` — CREATE OR REPLACE `_validate_scenario_diff` with BEGIN/EXCEPTION-guarded numeric casts. Smoke-test verifies non-numeric input raises 22023 with `[index=N]` annotation. |
| MED-2 | code-reviewer c8 + security c6 | Folded into mig 170000 (trigger fn) + mig 170600 (validator). Both functions now carry `SET search_path = public, pg_catalog`. |
| MED-3 | data-migration c7 + security c7 + red-team c7 | Folded into mig 170000 — orphan-org branch now returns FALSE (fail-closed). Sanitize-orphan recovery handled by manual admin override, not silent helper relaxation. |
| MED-4 | pr-test-analyzer c7 | EDIT `supabase/tests/test_sanitize_user_hardening.sql` Test 3 — invert polarity to assert PRESENT (PR #173 re-added the sentinel signal); also add M-0796 notification_dispatches purge PRESENT assertion. |

### Deferred (LOW conf or settled overrides)

- search_path TO '' (Grok BLOCK): settled override (per CLAUDE.md Rule 11; codebase convention).
- match_decisions visibility GUC escape hatch (red-team MED c8): over-engineering; no current code path needs it.
- frozen_post_sanitize column (red-team MED c7): out-of-scope (new schema column).
- 23514 admin route remap to 409 (red-team MED c7): out-of-scope (route changes).
- 122247 lock_timeout (performance MED c7): defer — `122247` index migration becomes CONCURRENTLY in mig 170400 so the lock-acquisition concern shifts to SHARE UPDATE EXCLUSIVE.
- 160300 STEP 3 block-comment hole (code-reviewer + red-team LOW c7): defer.
- 160300 STEP 1 bootstrap (data-migration LOW c7): defer.
- 160100 second-sanitize PII gap (data-migration LOW c6): defer.
- SET LOCAL lock_timeout (data-migration LOW c8): defer — Supabase migration-runner-per-file isolates session.
- Sequential ALTER TABLE lock-acquisition race (red-team MED c8): defer — operationally acceptable retry semantics with lock_timeout=5s.
- COUNT(*) → EXISTS optimization (performance LOW c6): defer.

### Vercel rollback hazard — HIGH-6 documentation

The combination of mig 20260516160600 (DROP DEFAULT on `match_decisions.kind`)
and the route patches in `src/app/api/match/decisions/holding/route.ts` +
`src/app/api/admin/match/decisions/route.ts` creates a forward-only deploy
coupling:

* Forward deploy is safe — both routes explicitly INSERT `kind: 'bridge_recommended'`.
* `vercel rollback` to a pre-PR-#182 deploy removes the explicit `kind`
  literal, but the migration's DROP DEFAULT remains in the DB. Result: every
  allocator-side INSERT raises 23502 NOT NULL violation on `match_decisions.kind`
  until a forward-fix re-adds the DEFAULT.
* The audit-2026-05-07 batch is forward-only by policy; there is no
  `supabase/migrations/down/20260516160600_...` partner file.

**Operator runbook**: if an unrelated SEV-1 forces a rollback past PR #182's
merge-commit AND the rollback-deploy lacks the explicit `kind` literal:

1. Roll the app forward to the latest deploy that contains the route patches
   (preferred — no DB schema change needed).
2. If forward-roll is blocked, apply emergency migration:
   ```sql
   ALTER TABLE public.match_decisions
     ALTER COLUMN kind SET DEFAULT 'bridge_recommended';
   ```
   then re-deploy the rollback target. This restores the implicit DEFAULT
   that mig 160600 dropped.

Tracked as follow-up to add a deploy-time gate (CI assertion that any new
DROP DEFAULT migration has accompanying route patches that survive a
deploy-N rollback).

### Schema-prefix tolerance — HIGH-5 documentation

mig 20260516160100 STEP 2 verification block uses regexes like
`'DELETE\s+FROM\s+notification_dispatches\s+WHERE\s+recipient_email'` —
strictly UNqualified. A future hardening refactor that qualifies the table
reference (e.g. `DELETE FROM public.notification_dispatches`) will fail the
verification probe and abort re-apply.

**Convention to maintain**: when modifying sanitize_user, keep the unqualified
references that the verification probe matches, OR update mig 160100's
verification regex in a coordinated migration. The cleaner long-term fix
is to change the regex to allow optional `(public\.)?` prefix — but per
the rebase contract we cannot edit mig 160100 in this PR. Tracked as
tech-debt follow-up.
</content>
</invoke>