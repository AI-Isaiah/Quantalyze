---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phase-19/route-inventory.md
  - .planning/phase-19/migration-plan.md
  - .planning/phase-19/rollback-runbook.md
  - .planning/phase-19/customer-feedback.md
  - .planning/phase-19/stability-log.md
  - scripts/check-route-inventory.sh
  - scripts/check-phase-19-shim-commits.sh
autonomous: true
requirements: [BACKBONE-04, BACKBONE-10]
must_haves:
  truths:
    - "Phase 19 entry gate has both required documents (route-inventory.md + migration-plan.md) present and grep-passing"
    - "Every Next.js non-GET handler touching the 6 sentinel tables maps to a flow_type or carries an explicit out-of-scope rationale (Pitfall 1 / Theme 6 mitigation)"
    - "Migration slots 103, 104, 105, 106, 107 are reserved upfront with role + rollback semantics documented"
    - "CI guard scripts exist and exit non-zero when route inventory is incomplete or shim commit-message convention is violated"
    - "Route inventory method labels are cross-checked against actual route handler exports (C-6 — script greps each route file's `export (const|async function) METHOD` and fails if inventory disagrees)"
    - "Rollback runbook covers per-stage rollback semantics (post-PR-A vs post-PR-B vs post-PR-D) with a transactional DROP VIEW + RENAME recovery path for post-PR-D state (C-4 / MC-7)"
  artifacts:
    - path: ".planning/phase-19/route-inventory.md"
      provides: "Phase 19 entry-gate route inventory (BACKBONE-10)"
      contains: "flow_type=teaser|onboard|internal_report|csv|resync OR out of scope"
    - path: ".planning/phase-19/migration-plan.md"
      provides: "Migrations 103-107 slot reservations with role + rollback"
      contains: "| 103 |"
    - path: "scripts/check-route-inventory.sh"
      provides: "Theme 6 CI guard for route-inventory completeness AND method-label parity (C-6 fix)"
      contains: "(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale:"
    - path: "scripts/check-phase-19-shim-commits.sh"
      provides: "Pitfall 10 CI guard for 4-PR VIEW-shim commit-message convention"
      contains: "phase-19-shim-step-"
    - path: ".planning/phase-19/rollback-runbook.md"
      provides: "Per-stage rollback semantics: post-PR-A, post-PR-B, post-PR-D distinct paths (MC-7 + C-4)"
      contains: "post-PR-D"
  key_links:
    - from: ".planning/phase-19/route-inventory.md"
      to: "src/app/api/**/route.ts"
      via: "grep scan covering api_keys|strategies|strategy_analytics|verification_requests|strategy_verifications|compute_jobs"
      pattern: "(flow_type=|out of scope, rationale:)"
    - from: "scripts/check-route-inventory.sh"
      to: ".planning/phase-19/route-inventory.md"
      via: "regex assertion every non-GET row carries flow_type= or out-of-scope rationale + method-label parity check (C-6)"
      pattern: "grep -E '\\\\| (POST|PUT|PATCH|DELETE) \\\\|'"
---

<objective>
Phase 19 entry-gate documentation. Produces the two artifacts the plan-checker
requires before any Phase 19 code may land:
1. `.planning/phase-19/route-inventory.md` — completeness gate (Theme 6 / Pitfall 1
   — 4th-orphan-path mitigation per BACKBONE-10).
2. `.planning/phase-19/migration-plan.md` — slot reservation 103-107 (the original
   093-097 reservation in REQUIREMENTS.md is impossible because slots 093, 094,
   098-102 are already taken).

Also ships two CI guard scripts:
- `scripts/check-route-inventory.sh` (Theme 6 — every non-GET row maps to a flow_type
  or carries an explicit out-of-scope rationale + C-6 method-label parity check
  against actual route handler exports).
- `scripts/check-phase-19-shim-commits.sh` (Pitfall 10 — enforces commit-message
  convention `phase-19-shim-step-{a|b|c|d}:` so squash-merge cannot collapse the
  4-PR VIEW-shim sequence into a single commit).

And three runtime/runbook stubs for phase exit:
- `.planning/phase-19/rollback-runbook.md` — per-stage rollback runbook covering
  post-PR-A / post-PR-B / post-PR-D rollback semantics distinctly (C-4 + MC-7).
  Primary path is the Supabase kill-switch row flip (NOT `vercel env rm` — env-var
  mutation leaves a 30s gap where the legacy fallback raises SQLSTATE 42501 after
  PR-D ships INSTEAD OF triggers on the VIEW). Documents a transactional
  `DROP VIEW + RENAME` recovery for post-PR-D state.
- `.planning/phase-19/customer-feedback.md` — Theme 4 exit-gate stub for founder
  to fill with verbatim feedback from 1-2 of the 10 onboarding teams (BACKBONE-10
  exit gate per ROADMAP §Exit gate).
- `.planning/phase-19/stability-log.md` — 7-day stability-window log per BACKBONE-04
  (records flag_flipped_at + 168h delta + Sentry error-envelope rate per day).

Purpose: Phase 19 cannot start without the route-inventory and migration-plan
documents. The plan-checker grep-rejects Phase 19 entry without them, and rejects
exit if any single PR combines adjacent VIEW-shim steps (Pitfall 10).
Output: 2 docs (entry gate) + 3 stubs (exit gate) + 2 CI scripts.

Tracking: BACKBONE-10 (route inventory) + BACKBONE-04 (4-PR shim sequence)
+ Theme 4 (customer-feedback exit gate) + Theme 6 (route-inventory completeness)
+ Pitfall 1 (VIEW-shim race) + Pitfall 10 (squash-merge collapse).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@DESIGN.md
@AGENTS.md
@CLAUDE.md

<interfaces>
<!-- Files Phase 19 entry-gate scripts will scan against. NO new code interfaces produced here -->

Existing migration slot inventory (verified by `ls supabase/migrations/`):
- 093 = strategy_verifications (Phase 15 / CSV-01)
- 094 = strategy_verifications_rls_polish
- 095..097 = NOT YET ASSIGNED (consumed in absentia by Phase 16 prep / migration-drift-resolution.md)
- 098 = resend_message_correlation
- 099 = mark_compute_job_atomic_status_bridge
- 100 = strategies_source_csv
- 101 = partner_tag_check_constraint
- 102 = sync_trades_preserve_fills
- 103..107 = next 5 sequential slots (Phase 19 reserves)

Existing Next.js non-GET routes touching the 6 sentinel tables (verified by
RESEARCH.md §P1 grep — `src/app/api/**/route.ts`):
- src/app/api/verify-strategy/route.ts — POST → verification_requests (L114-117 UPDATE)
- src/app/api/verify-strategy/[id]/status/route.ts — GET → verification_requests (read-only)
- src/app/api/keys/validate-and-encrypt/route.ts — POST → api_keys
- src/app/api/strategies/finalize-wizard/route.ts — POST → strategies + api_keys
- src/app/api/keys/sync/route.ts — POST → compute_jobs + strategy_analytics
- src/app/api/factsheet/[id]/pdf/route.ts — GET → strategies + strategy_analytics
- src/app/api/strategies/csv-validate/route.ts — POST (validate-only, no DB write)
- src/app/api/strategies/csv-finalize/route.ts — POST → strategies + strategy_verifications
- src/app/api/strategies/draft/route.ts — POST/PUT → strategies (out of scope: pre-validation draft)
- src/app/api/strategies/draft/[id]/route.ts — PATCH/DELETE → strategies (out of scope: draft mutation)
- src/app/api/strategies/create-with-key/route.ts — POST → strategies + api_keys (out of scope: deprecated)
- src/app/api/portfolio-strategies/alias/route.ts — POST → portfolio_strategies (out of scope: allocator-side)
- src/app/api/cron/reconcile-strategies/route.ts — GET (out of scope: cron, not user)
- src/app/api/keys/[id]/permissions/route.ts — **GET** → api_keys (out of scope: internal probe; corrected per C-6 — line 97 of the route file actually exports `GET = withAuth(...)`, NOT POST)
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
Treat `.planning/` as gitignored. If you need to verify the branch, use
`git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P1-1" type="auto">
  <name>Task 1: Write `.planning/phase-19/route-inventory.md` (BACKBONE-10 entry gate)</name>
  <files>.planning/phase-19/route-inventory.md</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 198-258 — full inventory table verbatim — but NOTE: keys/[id]/permissions row is GET, not POST per C-6 ground-truth verification at src/app/api/keys/[id]/permissions/route.ts:97)
    - .planning/REQUIREMENTS.md (BACKBONE-10 row + Phase-Internal Gates table for Phase 19 entry)
    - src/app/api/verify-strategy/route.ts (verify L114-117 UPDATE shape)
    - src/app/api/keys/sync/route.ts (verify line numbers)
    - src/app/api/strategies/finalize-wizard/route.ts (verify L60-86 force-refresh probe)
    - src/app/api/factsheet/[id]/pdf/route.ts (verify GET shape, x-internal-token bypass)
    - src/app/api/keys/[id]/permissions/route.ts (verify line 97 — `export const GET = withAuth(...)`. C-6 mandate: inventory MUST list this as GET, not POST)
  </read_first>
  <action>
Create `.planning/phase-19/route-inventory.md` with this exact structure. **C-6 mandate:** the `keys/[id]/permissions` row uses GET (not POST per the original RESEARCH.md sketch). Verified at `src/app/api/keys/[id]/permissions/route.ts:97` which exports `GET = withAuth(...)`.

```markdown
# Phase 19 — Route Inventory (BACKBONE-10 entry gate)

**Generated:** 2026-05-08
**Phase entry condition:** every Next.js route exporting non-GET handlers touching `api_keys | strategies | strategy_analytics | verification_requests | strategy_verifications | compute_jobs` MUST map to a `flow_type` in `KeySubmissionRequest` OR carry explicit `out of scope, rationale: <one-line reason>` (Pitfall 1 — 4th orphan path mitigation).

**Sentinel tables grepped:** api_keys, strategies, strategy_analytics, verification_requests, strategy_verifications, compute_jobs.

## Inventory

| Route file | Method | Touches | Disposition | Notes |
|------------|--------|---------|-------------|-------|
| `src/app/api/verify-strategy/route.ts` | POST | `verification_requests` (rate-limit count + UPDATE public_token L114-117) | flow_type=teaser | **Public unauthenticated**; CSRF + IP rate-limit |
| `src/app/api/verify-strategy/[id]/status/route.ts` | GET | `verification_requests` (SELECT only) | out of scope, rationale: read-only sibling — moves to VIEW-read in migration 107 shim step (d) | Public token-gated read |
| `src/app/api/keys/validate-and-encrypt/route.ts` | POST | `api_keys` (writes encrypted blob) | flow_type=onboard | `withAuth` user-scoped; validate-only step in onboard wizard |
| `src/app/api/strategies/finalize-wizard/route.ts` | POST | `strategies` + `api_keys` (last_sync_at via after()) | flow_type=onboard | finalize step; force-refresh permissions probe at L60-86 retained at thin-adapter layer |
| `src/app/api/keys/sync/route.ts` | POST | `compute_jobs` + `strategy_analytics` | flow_type=resync | retires legacy `after()` path; absorbs USE_COMPUTE_JOBS_QUEUE flag |
| `src/app/api/factsheet/[id]/pdf/route.ts` | GET | `strategies` + `strategy_analytics` (SELECT only) | out of scope, rationale: read-only PDF generation; consumes `strategy_verifications` via VIEW only — no /process-key write call (Open Question 2 resolution) | cron + public IP rate-limit; bypass via x-internal-token |
| `src/app/api/strategies/csv-validate/route.ts` | POST | (no DB write — validate-only) | flow_type=csv | Phase 15 ships; Phase 19 absorbs into `IngestionAdapter.validate` |
| `src/app/api/strategies/csv-finalize/route.ts` | POST | `strategies` + `strategy_verifications` (via finalize_csv_strategy RPC) | flow_type=csv | Phase 15 already at `strategy_verifications.status='validated'` |
| `src/app/api/strategies/draft/route.ts` | POST/PUT | `strategies` (draft step) | out of scope, rationale: pre-validation wizard step 1 — not a key submission | Wizard step 1 |
| `src/app/api/strategies/draft/[id]/route.ts` | PATCH/DELETE | `strategies` (draft mutation) | out of scope, rationale: same as draft route — not a key submission | Same |
| `src/app/api/strategies/create-with-key/route.ts` | POST | `strategies` + `api_keys` (legacy create-with-key) | out of scope, rationale: deprecated pre-wizard legacy path; slated for removal post-Phase 19 cleanup PR | Document explicit deprecation |
| `src/app/api/portfolio-strategies/alias/route.ts` | POST | `portfolio_strategies` (alias write) | out of scope, rationale: allocator-side alias — not key submission | Allocator-side |
| `src/app/api/cron/reconcile-strategies/route.ts` | GET | `compute_jobs` (enqueue reconcile) | out of scope, rationale: cron-driven reconcile not user-driven submission | Cron path |
| `src/app/api/keys/[id]/permissions/route.ts` | GET | `api_keys` (probe via Vercel cache) | out of scope, rationale: server-to-server internal probe — not user submission; GET-only per route file line 97 (`export const GET = withAuth(...)`) | Internal probe only — corrected per C-6 |

## Theme 6 / Pitfall 1 Compliance

Every non-GET route above carries either `flow_type=...` (5 unification targets — verify-strategy/route.ts, keys/validate-and-encrypt, strategies/finalize-wizard, keys/sync, csv-validate, csv-finalize all map to `teaser|onboard|csv|resync`) or `out of scope, rationale: ...` (5 explicit refusals). The plan-checker grep at Phase 19 entry asserts: every row matches `(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale: .{10,}`.

## Method-Label Parity (C-6 fix)

`scripts/check-route-inventory.sh` additionally cross-checks each inventory row's Method column against the actual `export (const|async function) METHOD` declarations in the corresponding route file. A row labeled `POST` whose route file only exports `GET` is a CI failure. This catches the original C-6 finding where `keys/[id]/permissions` was misclassified as POST.

## CI Guard

`scripts/check-route-inventory.sh` runs on every commit touching `src/app/api/**/route.ts` and rejects if a non-GET route exists in the codebase that does NOT appear in this inventory.
```

Use the EXACT inventory above. Do NOT invent additional rows; do NOT remove rows. Maintain the 14-row table. **The `keys/[id]/permissions` row MUST say GET (per C-6 ground-truth verification).**
  </action>
  <acceptance_criteria>
    - File exists at `.planning/phase-19/route-inventory.md`
    - `grep -c '| POST |' .planning/phase-19/route-inventory.md` returns ≥ 5
    - `grep -c 'flow_type=' .planning/phase-19/route-inventory.md` returns ≥ 5
    - `grep -c 'out of scope, rationale:' .planning/phase-19/route-inventory.md` returns ≥ 6
    - `grep -E '(flow_type=(teaser\|onboard\|internal_report\|csv\|resync))\|out of scope, rationale: .{10,}' .planning/phase-19/route-inventory.md | wc -l` matches the count of `| POST |` + `| PUT |` + `| PATCH |` + `| DELETE |` rows
    - **C-6 verification:** `grep -q 'keys/\[id\]/permissions/route.ts. | GET |' .planning/phase-19/route-inventory.md` — permissions row labeled GET, not POST
  </acceptance_criteria>
  <automated>
    bash -c 'test -f .planning/phase-19/route-inventory.md && grep -q "flow_type=teaser" .planning/phase-19/route-inventory.md && grep -q "flow_type=onboard" .planning/phase-19/route-inventory.md && grep -q "flow_type=resync" .planning/phase-19/route-inventory.md && grep -q "flow_type=csv" .planning/phase-19/route-inventory.md && grep -q "out of scope, rationale:" .planning/phase-19/route-inventory.md && grep -E "permissions/route.ts. \| GET \|" .planning/phase-19/route-inventory.md | grep -q "GET"'
  </automated>
  <requirements>BACKBONE-10</requirements>
</task>

<task id="P1-2" type="auto">
  <name>Task 2: Write `.planning/phase-19/migration-plan.md` (Phase 19 entry gate)</name>
  <files>.planning/phase-19/migration-plan.md</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 235-258 — slot reservation table)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md (lines 17-29 — plan-to-migration mapping)
    - supabase/migrations/102_sync_trades_preserve_fills.sql (verify latest slot is 102)
    - supabase/migrations/093_strategy_verifications.sql (existing schema baseline migration 103 extends)
  </read_first>
  <action>
Create `.planning/phase-19/migration-plan.md` with this exact structure:

```markdown
# Phase 19 — Migration Plan (slots 103-107)

**Generated:** 2026-05-08
**Phase entry condition:** migration numbers reserved upfront in this document; plan-checker rejects Phase 19 entry if any of slots 103-107 collide with shipped migrations or if numbering is not sequential.

## Why 103-107, not 093-097

REQUIREMENTS.md FINGERPRINT-01 originally referenced "Migration 096" and the autoplan reserved 093-097. Those slots are taken:

| Slot | Status | Title |
|------|--------|-------|
| 093 | shipped | strategy_verifications (Phase 15 / CSV-01) |
| 094 | shipped | strategy_verifications_rls_polish |
| 095..097 | NOT ASSIGNED in repo (consumed in absentia by Phase 16 prep `migration-drift-resolution.md`) |
| 098 | shipped | resend_message_correlation |
| 099 | shipped | mark_compute_job_atomic_status_bridge |
| 100 | shipped | strategies_source_csv |
| 101 | shipped | partner_tag_check_constraint |
| 102 | shipped | sync_trades_preserve_fills |

Phase 19 claims the next 5 sequential slots: 103, 104, 105, 106, 107.

## Slot Reservation

| Slot | Title | Phase 19 Plan | Required For | Rollback Semantics |
|------|-------|---------------|--------------|---------------------|
| 103 | strategy_verifications state-machine extensions + transition_strategy_verification RPC + transitioned_at + encrypted_credentials + public_token first-class column | P2 | BACKBONE-03 (state-machine completion) + P4 router pipeline | Drop RPC, drop transitioned_at + encrypted_credentials + public_token columns. Existing rows preserved (no DELETE). Phase 15 finalize_csv_strategy continues working (INSERTs fresh `validated` row using DEFAULT now() for transitioned_at). Down-migration: `down/103-rollback.sql` covers each forward DDL. |
| 104 | wizard_session_id UNIQUE INDEX + compute_jobs.kind widened to admit `process_key_long` + claim_compute_jobs_with_priority extended with 3rd arg `p_unified_backbone_active BOOLEAN DEFAULT NULL` writing `unified_backbone_at_claim` metadata + feature_flags kill-switch table | P2 | BACKBONE-08 (UNIQUE INDEX duplicate prevention) + BACKBONE-09 (process_key_long dispatch) + BACKBONE-05 (kill-switch row) + drain semantics | Drop UNIQUE INDEX (safe — no other code reads it); narrow kind CHECK after verifying zero `process_key_long` rows in flight; drop feature_flags table (kills auto-rollback but flags fall back to env var read). Down-migration: `down/104-rollback.sql`. |
| 105 | strategies.fingerprint JSONB + partial index `WHERE fingerprint IS NOT NULL` + CHECK constraint `((fingerprint->>'version') IS NOT NULL AND (fingerprint->>'version')::INT = 1)` + compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC plain plpgsql cosine (IMMUTABLE PARALLEL SAFE) | P2 | FINGERPRINT-01 (column + persistence) + FINGERPRINT-02 (cosine function) | Drop column (preserves existing rows by NULL-out via prior backup; backfill required if reverted). Drop function. CHECK lifts on column drop. Down-migration: `down/105-rollback.sql`. |
| 106 | VIEW-shim step (a) sentinel — repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename. Empty migration body except `DO $$ ... RAISE NOTICE 'Migration 106: BACKBONE-04 step (a) sentinel.' END $$;` | P5 (commit a) | BACKBONE-04 step (a) | No-op rollback — migration is sentinel only; route.ts revert handles the actual rollback. |
| 107 | VIEW-shim step (d) — rename `verification_requests` → `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ... FROM strategy_verifications` + INSTEAD OF INSERT/UPDATE/DELETE triggers + RLS retention 90 days on legacy table + `verification_requests_legacy` retains public_token-gated SELECT policy for 90 days (M-6) | P5 (commit d) | BACKBONE-04 step (d) | Drop VIEW + INSTEAD OF triggers; `ALTER TABLE verification_requests_legacy RENAME TO verification_requests`; flip kill-switch row to `off`; restart Vercel + Railway to clear 30s flag cache. Forward migration is 30s; rollback path documented in `.planning/phase-19/rollback-runbook.md` post-PR-D section. Down-migration: `down/107-rollback.sql` performs the rename in reverse + drops VIEW + drops triggers. |

## Sequencing

- 103, 104, 105 land in Wave 1 (P2) — independent foundation; can apply atomically via `supabase db push` after all three files are written.
- 106 lands AT commit (a) of P5 (Wave 3) — the migration is a sentinel; the load-bearing change is the route.ts repoint shipping in the same commit.
- 107 lands AT commit (d) of P5 (Wave 3) — AFTER 7 calendar days of zero writes to `verification_requests` legacy table per BACKBONE-04 stability window. Plan-checker enforces 168h delta between commit (b) flag-flip timestamp and commit (d) shipping.

## Self-verifying DO blocks

Each migration MUST end with a `DO $$ ... END $$;` block asserting the migration's load-bearing changes (e.g., column exists, RPC exists, function flags are correct). Pattern: see `supabase/migrations/093_strategy_verifications.sql` STEP 7 (lines 296-370). 086_compute_jobs_priority.sql also a reference.

## Down-Migrations (C-8 fix)

Every forward migration in 103-107 ships a paired `supabase/migrations/down/{N}-rollback.sql` (or single `down/103-107-rollback.sql`) covering the inverse statements. Tested at least once in dev before production push.

## Plan-Checker Enforcement

- File presence: `test -f supabase/migrations/103_*.sql && test -f supabase/migrations/104_*.sql && test -f supabase/migrations/105_*.sql && test -f supabase/migrations/106_*.sql && test -f supabase/migrations/107_*.sql`
- Sequencing: `ls supabase/migrations/ | grep -E '^10[3-7]_' | wc -l` returns 5
- Down-migration paired: `ls supabase/migrations/down/ | wc -l` returns ≥ 1 covering 103-107
- Schema push: `supabase db push` BEFORE Phase 19 verification (else build/types pass while live DB diverges).
```

Use the EXACT slot table above. Do NOT invent additional slots; do NOT remove slots. Maintain the 5-row reservation table.
  </action>
  <acceptance_criteria>
    - File exists at `.planning/phase-19/migration-plan.md`
    - `grep -c '| 10[3-7] |' .planning/phase-19/migration-plan.md` returns 5
    - `grep -q 'transition_strategy_verification' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'wizard_session_id' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'compute_similarity' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'verification_requests_legacy' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'feature_flags' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'unified_backbone_at_claim' .planning/phase-19/migration-plan.md` succeeds
    - `grep -q 'down/' .planning/phase-19/migration-plan.md` succeeds (C-8 down-migration mention)
  </acceptance_criteria>
  <automated>
    bash -c 'test -f .planning/phase-19/migration-plan.md && grep -q "transition_strategy_verification" .planning/phase-19/migration-plan.md && grep -q "wizard_session_id" .planning/phase-19/migration-plan.md && grep -q "compute_similarity" .planning/phase-19/migration-plan.md && grep -q "verification_requests_legacy" .planning/phase-19/migration-plan.md && grep -q "feature_flags" .planning/phase-19/migration-plan.md && grep -q "unified_backbone_at_claim" .planning/phase-19/migration-plan.md && grep -q "down/" .planning/phase-19/migration-plan.md'
  </automated>
  <requirements>BACKBONE-04, BACKBONE-10</requirements>
</task>

<task id="P1-3" type="auto">
  <name>Task 3: Write CI guard scripts + 3 phase-exit stub files</name>
  <files>scripts/check-route-inventory.sh, scripts/check-phase-19-shim-commits.sh, .planning/phase-19/rollback-runbook.md, .planning/phase-19/customer-feedback.md, .planning/phase-19/stability-log.md</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1198-1213 — shim commit-message regex; lines 198-234 — route-inventory regex)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md (lines 23-26 — VIEW-shim 4-PR sequence)
    - scripts/repro-key-flow.sh (existing script for shebang + style precedent)
  </read_first>
  <action>
Create FIVE files:

(1) `scripts/check-route-inventory.sh` — executable bash, asserts every non-GET route in `src/app/api/**/route.ts` matching the 6-sentinel-tables grep is referenced in `.planning/phase-19/route-inventory.md`. **Plus C-6 method-label parity check.** Body:

```bash
#!/usr/bin/env bash
# Phase 19 / BACKBONE-10 / Theme 6 — route-inventory completeness CI guard.
# Rejects when a Next.js non-GET route handler exists that touches one of the 6
# sentinel tables but is NOT listed in .planning/phase-19/route-inventory.md.
# Also enforces method-label parity (C-6): inventory's Method column for each row
# must agree with the actual `export (const|async function) METHOD` exports in
# the corresponding route file.
set -euo pipefail

INVENTORY=".planning/phase-19/route-inventory.md"
SENTINEL_TABLES='(api_keys|strategies|strategy_analytics|verification_requests|strategy_verifications|compute_jobs)'

if [[ ! -f "$INVENTORY" ]]; then
  echo "FAIL: $INVENTORY missing — Phase 19 entry gate not satisfied." >&2
  exit 1
fi

# Find every non-GET route handler touching the 6 sentinel tables.
routes=$(grep -RElZ 'export (async function|const) (POST|PUT|PATCH|DELETE)' src/app/api 2>/dev/null \
  | xargs -0 grep -lE "$SENTINEL_TABLES" 2>/dev/null \
  | sort -u || true)

missing=()
for route in $routes; do
  rel="${route#./}"
  if ! grep -Fq "$rel" "$INVENTORY"; then
    missing+=("$rel")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "FAIL: routes touching sentinel tables not in $INVENTORY:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 2
fi

# Every non-GET row in the inventory must carry flow_type= or out-of-scope rationale.
violations=$(grep -E '\| (POST|PUT|PATCH|DELETE) \|' "$INVENTORY" \
  | grep -vE '(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale: .{10,}' || true)

if [[ -n "$violations" ]]; then
  echo "FAIL: inventory rows missing flow_type or out-of-scope rationale:" >&2
  echo "$violations" >&2
  exit 3
fi

# C-6 method-label parity check: parse inventory rows and verify the Method
# column matches the actual route file's exported handler names.
parity_violations=()
while IFS= read -r line; do
  # Match table rows like:  | `path/to/route.ts` | METHOD | ... |
  if [[ "$line" =~ ^\|[[:space:]]*\`([^[:space:]\`]+)\`[[:space:]]*\|[[:space:]]*([A-Z/]+)[[:space:]]*\| ]]; then
    rel="${BASH_REMATCH[1]}"
    label="${BASH_REMATCH[2]}"
    # If the file does not exist locally, skip silently (e.g., docs-only rows).
    [[ -f "$rel" ]] || continue
    # Each method label may be a slash-separated list (e.g., POST/PUT or PATCH/DELETE).
    IFS='/' read -ra methods <<< "$label"
    for method in "${methods[@]}"; do
      # Skip GET — the inventory may legitimately list a GET-only sibling for documentation.
      # Still verify exports include the listed method.
      if ! grep -qE "^export (async function|const) ${method}\b" "$rel"; then
        parity_violations+=("$rel: inventory says $method but route file does NOT export $method")
      fi
    done
  fi
done < "$INVENTORY"

if [[ ${#parity_violations[@]} -gt 0 ]]; then
  echo "FAIL: C-6 method-label parity check failed:" >&2
  printf '  - %s\n' "${parity_violations[@]}" >&2
  exit 4
fi

echo "OK: route inventory complete + every non-GET row mapped + method-label parity verified (C-6)."
```

`chmod +x scripts/check-route-inventory.sh`

(2) `scripts/check-phase-19-shim-commits.sh` — executable bash, asserts the 4-PR VIEW-shim sequence preserves commit-message convention. Body:

```bash
#!/usr/bin/env bash
# Phase 19 / BACKBONE-04 / Pitfall 10 — VIEW-shim 4-PR commit-message guard.
# Rejects when fewer than 4 sequential commits with prefixes
# 'phase-19-shim-step-{a,b,c,d}:' exist on the current branch.
# (CONTEXT.md mandates 4 sequential PRs, NOT 4 squashed commits.)
set -euo pipefail

# Look for the 4 prefixes anywhere in branch history.
expected=(a b c d)
for step in "${expected[@]}"; do
  if ! git log --format='%s' --no-merges | grep -qE "^phase-19-shim-step-$step:"; then
    echo "FAIL: missing commit with prefix 'phase-19-shim-step-$step:'." >&2
    echo "      Each VIEW-shim step (a/b/c/d) must ship as its own PR per BACKBONE-04." >&2
    exit 1
  fi
done

# Order check: a must precede b must precede c must precede d in branch history.
order=$(git log --format='%s' --no-merges --reverse | grep -E '^phase-19-shim-step-[abcd]:' | sed 's/^phase-19-shim-step-\([abcd]\):.*$/\1/')
expected_order="a
b
c
d"
if [[ "$order" != "$expected_order" ]]; then
  echo "FAIL: shim commits out of order. Expected a→b→c→d; got:" >&2
  echo "$order" >&2
  exit 2
fi

# H-7: ≥168h delta between commit (b) and commit (d) timestamps.
commit_b=$(git log --format='%H %ct %s' --no-merges | awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-b:/ {print $1, $2; exit}')
commit_d=$(git log --format='%H %ct %s' --no-merges | awk '/^[a-f0-9]+ [0-9]+ phase-19-shim-step-d:/ {print $1, $2; exit}')

if [[ -n "$commit_b" && -n "$commit_d" ]]; then
  ts_b=$(echo "$commit_b" | awk '{print $2}')
  ts_d=$(echo "$commit_d" | awk '{print $2}')
  delta=$(( ts_d - ts_b ))
  required=604800  # 168h × 3600
  if (( delta < required )); then
    echo "FAIL: H-7 — only ${delta}s between commit (b) and commit (d); need ≥${required}s (168h)." >&2
    echo "      The 7-day stability window must elapse between flag-flip and VIEW rename." >&2
    exit 3
  fi
fi

echo "OK: 4-PR VIEW-shim sequence preserved + 168h delta between commits (b) and (d) (H-7)."
```

`chmod +x scripts/check-phase-19-shim-commits.sh`

(3) `.planning/phase-19/rollback-runbook.md` — per-stage rollback runbook (C-4 + MC-7). Body:

```markdown
# Phase 19 — Rollback Runbook (per-stage)

**Trigger:** Auto-rollback path needs reinforcement OR manual revert required because the Supabase kill-switch row write itself fails.

## Rollback semantics differ per stage

The 4-PR VIEW-shim sequence creates **three distinct rollback regimes**. Use the section that matches the current state (M-7).

---

## Stage A — post-PR-A, pre-PR-B (verify-strategy UPDATE repointed; flag still off)

In this state, `verify-strategy/route.ts:115` writes to `strategy_verifications` instead of `verification_requests`, but the unified backbone flag is OFF — most traffic still hits legacy routes.

**Rollback:**
1. Revert PR-A on a hotfix branch (`git revert <PR-A-merge-commit>`).
2. `/ship` the revert as `phase-19-shim-step-a-revert:`.
3. No data migration needed; PR-A only repointed the write target.

---

## Stage B — post-PR-B, pre-PR-D (flag is ON; legacy table still exists; no VIEW shim)

In this state, the unified backbone routes new traffic through `/process-key`. The legacy `verification_requests` table is still a real BASE TABLE; no VIEW yet.

**Primary rollback (kill-switch flip):**
1. Verify the kill-switch row state via Supabase MCP:
   `select value, updated_at, updated_by from feature_flags where flag_key='process_key_unified_backbone';`
2. Force-flip via Supabase SQL editor:
   `update feature_flags set value='off', updated_at=now(), updated_by='manual-rollback' where flag_key='process_key_unified_backbone';`
3. Wait 30 seconds for the in-process flag cache (Vercel + Railway) to expire.
4. Verify legacy fallback is serving traffic:
   `curl -s https://quantalyze-rho.vercel.app/api/health/diag | jq '.flags.process_key_unified_backbone'` → `false`.

**Manual fallback (if Supabase itself is unreachable):**
1. Vercel: `vercel env rm PROCESS_KEY_UNIFIED_BACKBONE production` (then `vercel env add PROCESS_KEY_UNIFIED_BACKBONE production` with value `off`).
2. Railway: dashboard → service → Variables → `PROCESS_KEY_UNIFIED_BACKBONE=off`.
3. Restart Vercel + Railway:
   - Vercel: `vercel deploy --prod` (no-op deploy triggers refresh).
   - Railway: dashboard → service → Restart deployment.
4. **Note:** in this stage, the env-var-only path works because legacy `verification_requests` is still a real table — no INSTEAD OF triggers fire on direct UPDATE.

---

## Stage D — post-PR-D (legacy table renamed; VIEW + INSTEAD OF triggers active)

**This is the most dangerous stage to rollback.** PR-D ships migration 107 which renamed `verification_requests` → `verification_requests_legacy` and replaced it with a VIEW that has INSTEAD OF triggers raising SQLSTATE 42501 on writes. **A naive `vercel env rm` here produces hard 500s** because the legacy fallback path tries to UPDATE `verification_requests` and the VIEW's INSTEAD OF trigger raises.

**Primary rollback (kill-switch flip — same as Stage B):**
1. Flip the kill-switch row to `off` (Supabase SQL editor).
2. Wait 30s for cache.
3. **CAUTION:** New /process-key traffic correctly stops, BUT the legacy fallback path WILL hit the VIEW's INSTEAD OF triggers if it tries to UPDATE `verification_requests`. The kill-switch flip alone is **insufficient** if Stage D rollback requires the legacy code path to write.

**Recovery procedure for full-revert (transactional DROP VIEW + RENAME):**
If the kill-switch flip alone doesn't restore service (because the legacy code path needs to write to `verification_requests`), execute this transactional recovery in the Supabase SQL editor:

```sql
BEGIN;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;
DROP VIEW IF EXISTS verification_requests;
ALTER TABLE verification_requests_legacy RENAME TO verification_requests;
COMMIT;
```

Then:
4. Restart Vercel + Railway.
5. Confirm legacy traffic resumed: `curl -s ... /api/verify-strategy/<known-id>/status` returns 200.
6. File `.planning/phase-19/incident-{date}.md` post-mortem.

**Note:** This recovery is `down/107-rollback.sql` per migration-plan.md (C-8). After this rollback, the Phase 19 schema is at the post-PR-B state — re-applying migration 107 in the future requires a fresh 7-day stability window.

---

## Post-Rollback (any stage)

- Open a Sentry issue with the correlation_id chain that triggered the breach.
- File a `.planning/phase-19/incident-{date}.md` post-mortem.
- Decide: re-enable after fix, or ship full Phase 19 revert (heavy — touches 5 entry routes + worker handler + 5 migrations).
```

(4) `.planning/phase-19/customer-feedback.md` — Theme 4 stub. Body:

```markdown
# Phase 19 — Customer Feedback (Theme 4 / BACKBONE-10 exit gate)

**Status:** TODO — founder fills with verbatim feedback from 1-2 of the 10 onboarding teams running a real key submission via the unified flow.

**Capture format per team:**

## Team {N}

- **Source:** {okx|binance|bybit|csv}
- **Flow type used:** {teaser|onboard|csv|resync}
- **Date submitted:** YYYY-MM-DD
- **correlation_id:** {uuid}
- **Verbatim feedback:**
  > "..."
- **Concrete defect (if any):** ...
- **Action taken:** ...

## Team {N+1}

(same shape)

**Exit gate:** ≥1 team must have submitted feedback before milestone close. Below 1: log gap to `.planning/phase-19/customer-signal-gap.md` and ship anyway (per Theme 4 thresholding policy, mirrors Phase 15 entry-gate language).
```

(5) `.planning/phase-19/stability-log.md` — 7-day window log stub. Body:

```markdown
# Phase 19 — Stability Log (BACKBONE-04 / BACKBONE-09)

**Purpose:** Records the 7-calendar-day stability window between commit (b) flag-flip and commit (d) VIEW rename per BACKBONE-04. Plan-checker reads `flag_flipped_at` and asserts ≥168h delta before commit (d) ships.

## Flag Flip Timestamp

- **flag_flipped_at:** TODO (record from commit (b) timestamp; ISO-8601 UTC, e.g. `2026-05-15T14:00:00Z`)

## Daily Sentry Error-Envelope Rate (15-min tumbling windows averaged daily)

| Day | Date | Error rate (%) | /process-key calls | Errors | Notes |
|-----|------|----------------|--------------------|--------|-------|
| 1 | YYYY-MM-DD | 0.00 | N | M | first 24h post-flip |
| 2 | YYYY-MM-DD | 0.00 | N | M | |
| 3 | YYYY-MM-DD | 0.00 | N | M | |
| 4 | YYYY-MM-DD | 0.00 | N | M | |
| 5 | YYYY-MM-DD | 0.00 | N | M | |
| 6 | YYYY-MM-DD | 0.00 | N | M | |
| 7 | YYYY-MM-DD | 0.00 | N | M | ≥168h elapsed; commit (d) eligible if all rows below 0.5% |

## Daily vcrpy + repro-key-flow.sh Cassette Refresh (Theme 5)

| Day | OKX cassettes refreshed | Bybit cassettes refreshed | Result |
|-----|-------------------------|---------------------------|--------|
| 1 | 4/4 | 4/4 | ✓ |
| 2 | 4/4 | 4/4 | ✓ |
| ... | ... | ... | ... |

## Exit Criteria

- All 7 days at error rate < 0.5%
- ≥168h between flag_flipped_at and commit (d)
- Daily cassette refresh succeeded all 7 days
- Customer-feedback file (`.planning/phase-19/customer-feedback.md`) has ≥1 verbatim entry
```

Make BOTH scripts executable: `chmod +x scripts/check-route-inventory.sh scripts/check-phase-19-shim-commits.sh`.
  </action>
  <acceptance_criteria>
    - `test -x scripts/check-route-inventory.sh` — script exists and is executable
    - `test -x scripts/check-phase-19-shim-commits.sh` — script exists and is executable
    - `scripts/check-route-inventory.sh` exits 0 (route inventory from Task 1 must satisfy the guard, including the C-6 method-label parity check)
    - `bash -n scripts/check-phase-19-shim-commits.sh` — syntax valid
    - `test -f .planning/phase-19/rollback-runbook.md`
    - `test -f .planning/phase-19/customer-feedback.md`
    - `test -f .planning/phase-19/stability-log.md`
    - `grep -q 'phase-19-shim-step-' scripts/check-phase-19-shim-commits.sh`
    - `grep -q 'flow_type=' scripts/check-route-inventory.sh`
    - **C-6 verification:** `grep -q 'C-6' scripts/check-route-inventory.sh` AND `grep -q 'parity' scripts/check-route-inventory.sh` (script enforces method-label parity)
    - **H-7 verification:** `grep -q '604800' scripts/check-phase-19-shim-commits.sh` (168h × 3600 enforced)
    - **C-4 / MC-7 verification:** `grep -q 'Stage A' .planning/phase-19/rollback-runbook.md` AND `grep -q 'Stage B' .planning/phase-19/rollback-runbook.md` AND `grep -q 'Stage D' .planning/phase-19/rollback-runbook.md` AND `grep -q 'DROP VIEW' .planning/phase-19/rollback-runbook.md` AND `grep -q 'RENAME TO verification_requests' .planning/phase-19/rollback-runbook.md`
  </acceptance_criteria>
  <automated>
    bash -c 'test -x scripts/check-route-inventory.sh && test -x scripts/check-phase-19-shim-commits.sh && bash -n scripts/check-phase-19-shim-commits.sh && bash scripts/check-route-inventory.sh && test -f .planning/phase-19/rollback-runbook.md && test -f .planning/phase-19/customer-feedback.md && test -f .planning/phase-19/stability-log.md && grep -q "C-6" scripts/check-route-inventory.sh && grep -q "604800" scripts/check-phase-19-shim-commits.sh && grep -q "Stage D" .planning/phase-19/rollback-runbook.md && grep -q "DROP VIEW" .planning/phase-19/rollback-runbook.md'
  </automated>
  <requirements>BACKBONE-04, BACKBONE-10</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer → CI | shim-commits guard runs in CI; if bypassed (e.g., admin merge), the 4-PR sequence can be collapsed |
| developer → docs | route-inventory.md is the source-of-truth for "which routes are unified" — drift between code and doc is a Theme 6 risk |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-01 | Tampering | route-inventory.md | mitigate | `scripts/check-route-inventory.sh` runs in CI; rejects when a non-GET route in code is missing from inventory; **C-6 fix:** also enforces method-label parity (inventory's Method column must match actual `export const|async function METHOD` declarations in the route file) |
| T-19-02 | Tampering | 4-PR shim sequence | mitigate | `scripts/check-phase-19-shim-commits.sh` enforces commit-message convention `phase-19-shim-step-{a\|b\|c\|d}:` AND H-7 168h delta between commits (b) and (d); CONTEXT.md mandates 4 separate PRs (NOT 4 squashed commits) per Pitfall 10 |
| T-19-03 | Repudiation | rollback runbook | mitigate | per-stage rollback documented (Stage A / B / D distinct paths per MC-7); transactional DROP VIEW + RENAME recovery for post-PR-D state per C-4; logged in `.planning/phase-19/incident-{date}.md` after any rollback |
</threat_model>

<verification>
- `scripts/check-route-inventory.sh` exits 0 — route inventory complete + every non-GET row carries flow_type or out-of-scope rationale + C-6 method-label parity verified.
- `bash -n scripts/check-phase-19-shim-commits.sh` — script is syntactically valid (the order check + H-7 168h delta fire only after Wave 3 P5 lands).
- All 5 phase-exit stub files exist and are non-empty.
- `wc -l .planning/phase-19/route-inventory.md` ≥ 30 lines (full inventory present).
- `wc -l .planning/phase-19/migration-plan.md` ≥ 30 lines (full slot reservations present).
- `wc -l .planning/phase-19/rollback-runbook.md` ≥ 60 lines (per-stage runbook with Stage A/B/D + transactional recovery).
</verification>

<success_criteria>
- Phase 19 entry-gate documents (`route-inventory.md` + `migration-plan.md`) exist and pass the plan-checker grep.
- Two CI scripts exist + executable; the route-inventory guard exits 0 on this branch + C-6 method-label parity enforced.
- 3 phase-exit stub files (`rollback-runbook.md`, `customer-feedback.md`, `stability-log.md`) exist as templates for founder fill-in during the 7-day stability window.
- BACKBONE-10 entry gate satisfied; BACKBONE-04 commit-message convention guard armed for Wave 3 + H-7 168h delta enforced.
- C-4 / MC-7 per-stage rollback semantics documented; transactional DROP VIEW + RENAME recovery path defined.
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-01-SUMMARY.md`
</output>
