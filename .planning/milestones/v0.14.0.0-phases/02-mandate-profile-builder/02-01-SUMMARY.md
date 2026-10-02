---
phase: 02-mandate-profile-builder
plan: 01
subsystem: database + data-access
requirements-completed: [MANDATE-05, MANDATE-06, MANDATE-07, MANDATE-08]
tags: [supabase, rpc, rls, mandate, allocator_preferences, security-definer]
requires:
  - "migration 011 (allocator_preferences table + three-tier RLS)"
  - "migration 049 (log_audit_event RPC)"
  - "src/lib/audit.ts (logAuditEvent fire-and-forget)"
  - "src/lib/test-helpers/live-db.ts (HAS_LIVE_DB gate)"
provides:
  - "supabase/migrations/061_mandate_columns.sql (5 columns + RPC + policy drop)"
  - "public.update_allocator_mandates(named-params + p_clear_fields) SECURITY DEFINER"
  - "AuditAction: mandate_preference.update + mandate_preference.admin_update"
  - "AuditEntityType: allocator_preference_mandate"
  - "exported ALLOCATOR_PREFERENCES_COLUMNS in src/lib/admin/match.ts"
  - "extended SELF_EDITABLE_PREFERENCE_FIELDS (9 entries) + validateSelfEditableInput bounds"
  - "PUT /api/preferences rewritten to call update_allocator_mandates RPC"
  - "admin PreferencesPanel + AllocatorMatchQueue type extended with 6 Phase 2 fields"
  - "3 live-DB integration tests + route handler unit test (10 TCs)"
affects:
  - "src/app/api/preferences/route.ts"
  - "src/app/api/admin/match/preferences/[allocator_id]/route.ts"
  - "src/components/admin/PreferencesPanel.tsx"
  - "src/components/admin/AllocatorMatchQueue.tsx"
  - "src/lib/preferences.ts"
  - "src/lib/preferences.test.ts"
  - "src/lib/admin/match.ts"
  - "src/lib/audit.ts"
  - "docs/architecture/adr-0023-audit-event-taxonomy.md"
  - "supabase/migrations/061_mandate_columns.sql"
  - "src/__tests__/mandate-columns-schema-sync.test.ts"
  - "src/__tests__/update-allocator-mandates-rpc.test.ts"
  - "src/__tests__/mandate-audit.test.ts"
  - "src/app/api/preferences/route.test.ts"
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER RPC (reused from migration 031 + 049)"
    - "named parameters convention (finalize_wizard_strategy style)"
    - "p_clear_fields escape hatch for COALESCE-Upsert NULL ambiguity"
    - "Option A RLS drop — DB-level enforcement over convention"
    - "route-handler-emitted audit (not inline in RPC body)"
key-files:
  created:
    - "supabase/migrations/061_mandate_columns.sql"
    - "src/__tests__/mandate-columns-schema-sync.test.ts"
    - "src/__tests__/update-allocator-mandates-rpc.test.ts"
    - "src/__tests__/mandate-audit.test.ts"
    - "src/app/api/preferences/route.test.ts"
  modified:
    - "src/lib/audit.ts"
    - "src/lib/admin/match.ts"
    - "src/lib/preferences.ts"
    - "src/lib/preferences.test.ts"
    - "src/app/api/preferences/route.ts"
    - "src/app/api/admin/match/preferences/[allocator_id]/route.ts"
    - "src/components/admin/PreferencesPanel.tsx"
    - "src/components/admin/AllocatorMatchQueue.tsx"
    - "docs/architecture/adr-0023-audit-event-taxonomy.md"
decisions:
  - "Plan 02-01 (2026-04-18): MANDATE-06 Option A enforced at DB — migration 061 drops allocator_prefs_self_update RLS policy. Allocator direct UPDATE is now impossible; only update_allocator_mandates RPC writes. ROADMAP SC4 is literally true at the DB layer."
  - "Plan 02-01 (2026-04-18): RPC uses named params + p_clear_fields TEXT[] escape hatch (D-11 Reset). A NULL parameter preserves the existing column value (COALESCE); a field listed in p_clear_fields is set to NULL regardless of its parameter value. Whitelist of allowed clear fields enforced inside RPC."
  - "Plan 02-01 (2026-04-18): Audit emission lives in the route handler (logAuditEvent fire-and-forget), not inside the RPC body. Matches every other audit site. audit-coverage.test.ts scans .insert/.update/.upsert/.delete — .rpc() is not scanned, so an @audit-skip pragma documents the coverage for future maintainers (the logAuditEvent call is inline 12 lines below the rpc call)."
  - "Plan 02-01 (2026-04-18): ALLOCATOR_PREFERENCES_COLUMNS EXPORTED from src/lib/admin/match.ts (was file-local). Schema-sync test imports the constant directly — no duplicated literal, no drift possible between test and production constant."
  - "Plan 02-01 (2026-04-18): Anon RPC rejection surfaces as SQLSTATE 42501 (permission_denied at GRANT layer) in production — stronger than the in-function 28000 guard because the function body never runs. The test accepts both 42501 and 28000 as valid rejection paths (defense-in-depth)."
  - "Plan 02-01 (2026-04-18): Phase 2 taxonomy promotes max_drawdown_tolerance + preferred_strategy_types from ADMIN_ONLY to SELF_EDITABLE (D-03, D-06). Existing pickSelfEditableFields test + validateAdminEditableInput valid-input test updated to reflect the new taxonomy (Trend Following is a SUBTYPE, not a STRATEGY_TYPE — pre-existing test used the wrong constant by accident)."
metrics:
  duration: "~25m"
  completed: 2026-04-18
---

# Phase 02 Plan 01: Mandate Profile Builder — Database Foundation Summary

Database + data-access foundation for the Mandate Profile Builder: migration 061 adds 5 mandate columns + SECURITY DEFINER RPC + drops `allocator_prefs_self_update` RLS policy (ROADMAP SC4 Option A); PUT /api/preferences rewires to call the RPC; admin parity + schema-sync + audit contracts wired; 3 live-DB tests + 1 route handler unit suite all green.

## What Shipped

### Migration 061

**File:** `supabase/migrations/061_mandate_columns.sql` (282 lines)

- 5 nullable columns added to `allocator_preferences`: `max_weight NUMERIC`, `correlation_ceiling NUMERIC`, `liquidity_preference TEXT`, `style_exclusions TEXT[]`, `mandate_edited_at TIMESTAMPTZ`
- CHECK constraint: `liquidity_preference IS NULL OR liquidity_preference IN ('high','medium','low')` with `DROP IF EXISTS` idempotency guard
- **DROP POLICY allocator_prefs_self_update** — MANDATE-06 Option A (ROADMAP Phase 2 SC4): allocators can no longer direct-UPDATE `allocator_preferences`
- `public.update_allocator_mandates(10 named params + p_clear_fields text[])` SECURITY DEFINER RPC:
  - `SET search_path = public, pg_catalog`
  - Auth guard: SQLSTATE 28000 (`insufficient_privilege`) if `auth.uid()` is NULL
  - Bounds validation: SQLSTATE 22023 (`invalid_parameter_value`) for max_weight (0.05–0.50), correlation_ceiling (0–1), max_drawdown_tolerance (0–1), liquidity_preference enum, mandate_archetype ≤500 chars, target_ticket_size_usd (0–1B)
  - `p_clear_fields` whitelist inside the RPC — enforced by `v_allowed_clear_fields` array; unknown field names raise 22023
  - UPSERT with `CASE WHEN '<field>' = ANY (p_clear_fields) THEN NULL ELSE COALESCE(...) END` per column
  - `edited_by_user_id = NULL` (allocator self-edit marker, D-14); `mandate_edited_at = now()`
  - `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`
- Self-verifying DO block asserts 5 columns, CHECK constraint, `prosecdef = TRUE`, AND the dropped policy is absent from `pg_policies`. Emits `NOTICE`: `Migration 061: mandate columns + update_allocator_mandates RPC + self-update RLS removed verified.`

### Migration Applied — `npx supabase db push` Output

```
Applying migration 061_mandate_columns.sql...
NOTICE (00000): constraint "allocator_preferences_liquidity_preference_check" of relation "allocator_preferences" does not exist, skipping
NOTICE (00000): Migration 061: mandate columns + update_allocator_mandates RPC + self-update RLS removed verified.
Finished supabase db push.
```

The self-verify DO block emitted the success NOTICE — confirming all 4 post-apply probes pass at apply-time:
- 5 new columns present on `allocator_preferences`
- `allocator_preferences_liquidity_preference_check` CHECK constraint exists
- `update_allocator_mandates` exists with `prosecdef = TRUE`
- `allocator_prefs_self_update` policy is ABSENT from `pg_policies`

No incidental file modifications (config.toml, vercel.json, pre-existing migrations untouched — `git status` clean post-push).

**`SUPABASE_ACCESS_TOKEN` precondition:** the env var was NOT set in the executor's shell. However the Supabase CLI was already authenticated via macOS keychain + linked to the `quantalyze` project (confirmed via `npx supabase projects list`). The push succeeded non-interactively (one "do you want to push" yes-default prompt that the CLI auto-accepts with `--yes`).

### AuditAction / AuditEntityType + ADR-0023 (Task 3a)

- `src/lib/audit.ts`: added `"mandate_preference.update" | "mandate_preference.admin_update"` to `AuditAction`; added `"allocator_preference_mandate"` to `AuditEntityType`
- `docs/architecture/adr-0023-audit-event-taxonomy.md`: added two rows to the Registered-actions table for the new Phase 2 actions, per the established shape (`| Action | entity_type | entity_id source | Metadata keys |`)

### Preferences Lib + Exports (Task 3b)

- `src/lib/admin/match.ts`: `const ALLOCATOR_PREFERENCES_COLUMNS` → **`export const ALLOCATOR_PREFERENCES_COLUMNS`** (consumed directly by the schema-sync test, no drift possible); extended with `edited_by_user_id` (MANDATE-07 correction) + 5 Phase 2 mandate columns
- `src/lib/preferences.ts`:
  - `AllocatorPreferences` interface extended with 5 Phase 2 fields
  - `SELF_EDITABLE_PREFERENCE_FIELDS` now has 9 entries (original 3 + max_weight, preferred_strategy_types, correlation_ceiling, max_drawdown_tolerance, liquidity_preference, style_exclusions) — D-03, D-06, D-07 promotions
  - `ADMIN_ONLY_PREFERENCE_FIELDS` shrunk to 5 (min_track_record_days, min_sharpe, max_aum_concentration, preferred_markets, founder_notes) — tuples are now disjoint
  - `validateSelfEditableInput` extended with 6 new branches: max_weight (0.05–0.50), correlation_ceiling (0–1), max_drawdown_tolerance (0–1), liquidity_preference enum, style_exclusions subset of SUBTYPES, preferred_strategy_types subset of STRATEGY_TYPES. Imports `STRATEGY_TYPES, SUBTYPES` from `./constants`
  - `validateAdminEditableInput` trimmed: removed duplicate max_drawdown_tolerance + preferred_strategy_types branches (now in selfError path)
- `src/lib/preferences.test.ts`: updated "exactly self-editable fields" test to assert the new 9-entry tuple; added **18 Phase 2 validation cases**; fixed `pickSelfEditableFields` test to reflect max_drawdown_tolerance promotion; fixed `validateAdminEditableInput` valid-input test to use `"Long-Short"` (valid STRATEGY_TYPE) not `"Trend Following"` (which is a SUBTYPE — pre-existing bug exposed by the new STRATEGY_TYPES whitelist)

### Route Handler Rewrite (Task 4)

- `src/app/api/preferences/route.ts`: PUT handler rewritten to call `supabase.rpc("update_allocator_mandates", rpcArgs)`. Direct `.upsert(...)` removed. `profiles.preferences_updated_at` denorm write removed. `PGRST205` fallback removed (migration 061 applied — table exists).
  - Null-to-clear transform (D-11 Reset): splits `fields` into (a) non-null values → `p_<field>` named params, (b) keys sent as null → `p_clear_fields` array
  - SQLSTATE error mapping: 28000→401 "Unauthorized", 22023→400 with `error.message` surfaced, else→500 "Failed to save mandate"
  - Audit emission within 12 lines of the RPC call — `action: "mandate_preference.update"`, `entity_type: "allocator_preference_mandate"`, metadata: `{ fields: Object.keys(fields), self_edit: true }`
  - `@audit-skip` pragma documents the .rpc() path (audit-coverage.test.ts scans .insert/.update/.upsert/.delete, not .rpc())
- `src/app/api/admin/match/preferences/[allocator_id]/route.ts`: audit action changed from `notification_preferences.update` to `mandate_preference.admin_update`; entity_type from `user` to `allocator_preference_mandate`. Direct-upsert write path unchanged (D-12). Denorm `profiles.preferences_updated_at` write retained (admin-separation from allocator "Last saved" — intentional).
- `src/app/api/preferences/route.test.ts`: Wave 0 scaffold overwritten with **10 test cases** (TC1–TC10) covering happy path, Reset, auth, rate-limit, TS-layer validation, RPC SQLSTATE error mapping, CSRF, JSON parse failures — all green.

### Admin Panel Parity (Task 5)

- `src/components/admin/AllocatorMatchQueue.tsx`: `AllocatorPreferences` type extended with 6 optional Phase 2 fields
- `src/components/admin/PreferencesPanel.tsx`:
  - Imports `SUBTYPES` alongside existing constants
  - 4 new state variables: `maxWeight`, `correlationCeiling`, `liquidityPreference`, `styleExclusions`
  - Extended client-side numeric validation + request body
  - Added numeric inputs (`max_weight` 0.05–0.50, `correlation_ceiling` 0–1)
  - Added liquidity 3-button `role="radiogroup"` with `role="radio"` + `aria-checked` children (High/Medium/Low with AUM tier labels per D-05)
  - Added `style_exclusions` chip multi-select from SUBTYPES
  - Added "Mandate last edited by: allocator|admin · date" indicator above the sticky save bar
  - **0 hex literals** — DESIGN.md tokens throughout

### Live-DB Tests (Task 6)

- `src/__tests__/mandate-columns-schema-sync.test.ts` (MANDATE-07): imports `ALLOCATOR_PREFERENCES_COLUMNS` from `@/lib/admin/match` (no duplicated literal); static assertion + live-DB projection-select probe
- `src/__tests__/update-allocator-mandates-rpc.test.ts` (MANDATE-04 + 05 + 06): **7 live-DB cases** including the MANDATE-06 Option A direct-UPDATE-blocked assertion (ROADMAP SC4 proof)
- `src/__tests__/mandate-audit.test.ts` (MANDATE-08): 1 live-DB case proving `log_audit_event` writes an audit row with `action='mandate_preference.update'` + `entity_type='allocator_preference_mandate'`

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| `src/lib/preferences.test.ts` | 49 | ✅ all green |
| `src/app/api/preferences/route.test.ts` | 10 (TC1–TC10) | ✅ all green |
| `src/__tests__/audit-coverage.test.ts` | 1 (sentinel) | ✅ green |
| `src/__tests__/mandate-columns-schema-sync.test.ts` | 2 (1 static + 1 live-DB) | ✅ 1 green, 1 live-DB pass |
| `src/__tests__/update-allocator-mandates-rpc.test.ts` | 7 (all live-DB gated) | ✅ 7 live-DB pass |
| `src/__tests__/mandate-audit.test.ts` | 1 (live-DB gated) | ✅ 1 live-DB pass |

### HAS_LIVE_DB Run Outcome

**HAS_LIVE_DB was available during executor's run** (via `.env.local`). All 10 live-DB tests passed in a single `npx vitest run` (34 s total). Specifically:

- MANDATE-04: `mandate_edited_at` populated within 5 s after RPC write ✅
- MANDATE-05 anon rejection: SQLSTATE 42501 at GRANT layer (`REVOKE ALL FROM anon`) — production path ✅
- MANDATE-05 out-of-range: SQLSTATE 22023 ✅
- MANDATE-05 invalid enum: SQLSTATE 22023 ✅
- D-11 Reset: `p_clear_fields` nulls the column ✅
- **MANDATE-06 Option A direct-UPDATE-blocked** (ROADMAP SC4 proof): authenticated allocator direct UPDATE returns 0 rows affected; value preserved from prior RPC seed ✅
- Admin direct UPDATE via service-role: succeeds (unchanged) ✅
- MANDATE-07 live-DB projection: `.select(ALLOCATOR_PREFERENCES_COLUMNS)` returns no error ✅
- MANDATE-08 audit_log row: appears with mandate_preference.update action + allocator_preference_mandate entity_type ✅

Without HAS_LIVE_DB: 1 static test passes, 9 live-DB cases skip cleanly with `advertiseLiveDbSkipReason` console.warn visible. Total: 4 passed / 2 skipped test files, 61 passed / 9 skipped individual tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Live-DB anon-rejection test expected 28000; actual error is 42501**
- **Found during:** Task 6 live-DB run
- **Issue:** Test asserted `error.code === "28000"`. Actual production-path error is `42501` (`permission denied for function update_allocator_mandates`) because `REVOKE ALL FROM anon` blocks the call at the GRANT layer BEFORE the function body ever runs. The in-function 28000 guard is defense-in-depth but unreachable in practice.
- **Fix:** Test now accepts both 42501 (GRANT-layer denial, primary path) and 28000 (function-body guard, fallback). Documented both paths in a comment.
- **Files modified:** `src/__tests__/update-allocator-mandates-rpc.test.ts`
- **Commit:** `2cee335`

**2. [Rule 3 - Blocking issue] server-only import in @/lib/admin/match fails under vitest+jsdom**
- **Found during:** Task 6 schema-sync test initial run
- **Issue:** `src/lib/admin/match.ts` starts with `import "server-only"`. When the schema-sync test imports `ALLOCATOR_PREFERENCES_COLUMNS` from that module, server-only throws "This module cannot be imported from a Client Component module."
- **Fix:** Add `vi.mock("server-only", () => ({}))` at the top of the schema-sync test (same pattern used throughout the codebase for bridge/outcome/route.test.ts and audit-fanout-integration.test.ts).
- **Files modified:** `src/__tests__/mandate-columns-schema-sync.test.ts`
- **Commit:** `2cee335`

**3. [Rule 1 - Bug] Pre-existing test used a SUBTYPE value for a STRATEGY_TYPE field**
- **Found during:** Task 3b preferences.test.ts run after adding array-subset validation for `preferred_strategy_types`
- **Issue:** The existing `validateAdminEditableInput` "returns null for valid input" test passed `preferred_strategy_types: ["Trend Following"]`. "Trend Following" is a SUBTYPE, not a STRATEGY_TYPE (which was previously loosely validated as "string[]"). With Phase 2 enforcing subset-of-STRATEGY_TYPES, this test correctly started failing.
- **Fix:** Changed the test value to `"Long-Short"` (a real STRATEGY_TYPES entry). Comment explains the old value was wrong.
- **Files modified:** `src/lib/preferences.test.ts`
- **Commit:** `55dca14`

**4. [Rule 1 - Bug] Pre-existing test drifted from Phase 2 taxonomy promotion**
- **Found during:** Task 3b preferences.test.ts run
- **Issue:** The existing `pickSelfEditableFields` "keeps only the 3 self-editable fields" test asserted that `max_drawdown_tolerance` is dropped. Phase 2 D-06 promotes it to self-editable; the new `SELF_EDITABLE_PREFERENCE_FIELDS` tuple keeps it, so the test assertion was now wrong.
- **Fix:** Updated the test to assert `max_drawdown_tolerance` is KEPT (reflecting its Phase 2 promotion), renamed the test to "keeps the self-editable fields, drops admin-only".
- **Files modified:** `src/lib/preferences.test.ts`
- **Commit:** `55dca14`

### Intentional Adjustments

**5. `@audit-skip` pragma retained as documentation even though audit-coverage scans only mutations**
- **Context:** RESEARCH.md's Pitfall 7 warned audit-coverage.test.ts may scan `.rpc(` — empirical check confirmed it does NOT (only `.insert/.update/.upsert/.delete`). The pragma is therefore not strictly necessary for coverage; the sentinel is green either way.
- **Decision:** Keep the pragma as inline documentation for future maintainers ("this mutation is audited — here's where the audit call lives"). Adds no runtime cost.

### Auth Gates

None. `SUPABASE_ACCESS_TOKEN` was not set but the Supabase CLI was already authed via macOS keychain + the project was linked. Non-interactive push succeeded with `--yes`.

## Confirmation: Only RLS Policy Operation Was DROP allocator_prefs_self_update

```
$ grep -c "CREATE POLICY" supabase/migrations/061_mandate_columns.sql
0
$ grep -c "DROP POLICY" supabase/migrations/061_mandate_columns.sql
1
$ grep "DROP POLICY" supabase/migrations/061_mandate_columns.sql
DROP POLICY IF EXISTS allocator_prefs_self_update ON allocator_preferences;
```

All other RLS policies on `allocator_preferences` are untouched: `allocator_prefs_self_read`, `allocator_prefs_self_insert`, `allocator_prefs_admin_read`, `allocator_prefs_admin_all`, `allocator_prefs_service_all` all remain.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 0 | `bd7caef` | test(02-01): add Wave 0 test scaffolds for mandate profile builder |
| 1 | `e7ce157` | feat(02-01): author migration 061 — mandate columns, RPC, drop self-update RLS |
| 2 | (no commit — DB push only) | `npx supabase db push` applied 061 non-interactively; self-verify NOTICE emitted |
| 3a | `afaebec` | feat(02-01): extend AuditAction + AuditEntityType unions for mandate writes |
| 3b | `55dca14` | feat(02-01): extend preferences types + validation + export ALLOCATOR_PREFERENCES_COLUMNS |
| 4 | `69b16f9` | feat(02-01): rewrite PUT /api/preferences to call update_allocator_mandates RPC |
| 5 | `bb21d62` | feat(02-01): extend admin PreferencesPanel with Phase 2 mandate controls |
| 6 | `2cee335` | test(02-01): three live-DB integration tests for mandate profile builder |

## Metrics

- **Duration:** ~25 minutes
- **Completed:** 2026-04-18
- **Tasks:** 7 (0, 1, 2, 3a, 3b, 4, 5, 6)
- **Commits:** 7 per-task commits (Task 2 is a live DB operation, no file commit)
- **Files created:** 5 (migration + 4 test files)
- **Files modified:** 9 (audit.ts, match.ts, preferences.ts + test, two route.ts files, PreferencesPanel.tsx, AllocatorMatchQueue.tsx, ADR-0023)
- **Diff size:** +1409 / -59 lines across 14 files
- **Tests:** 61 passed / 9 skipped (no-live-DB env); 70 passed (with HAS_LIVE_DB)

## Self-Check: PASSED

### Created files exist

- FOUND: supabase/migrations/061_mandate_columns.sql
- FOUND: src/__tests__/mandate-columns-schema-sync.test.ts
- FOUND: src/__tests__/update-allocator-mandates-rpc.test.ts
- FOUND: src/__tests__/mandate-audit.test.ts
- FOUND: src/app/api/preferences/route.test.ts

### Commits exist

- FOUND: bd7caef (Task 0)
- FOUND: e7ce157 (Task 1)
- FOUND: afaebec (Task 3a)
- FOUND: 55dca14 (Task 3b)
- FOUND: 69b16f9 (Task 4)
- FOUND: bb21d62 (Task 5)
- FOUND: 2cee335 (Task 6)

### Truths verified (from plan frontmatter)

- ✅ Wave 0 scaffolds exist (4 files) with `describe.skip('TBD'...)` + `it.todo(...)` shells
- ✅ Migration 061 adds max_weight, correlation_ceiling, liquidity_preference (CHECK), style_exclusions text[], mandate_edited_at timestamptz
- ✅ Migration 061 DROPS `allocator_prefs_self_update` RLS policy
- ✅ `allocator_prefs_admin_all` remains; SECURITY DEFINER RPC bypasses RLS via function-owner privileges
- ✅ `update_allocator_mandates` with named params + `p_clear_fields text[] DEFAULT '{}'` + `SET search_path=public,pg_catalog` + SQLSTATE 28000/22023 + `REVOKE ALL FROM PUBLIC,anon` + `GRANT EXECUTE TO authenticated`
- ✅ `npx supabase db push` exited 0 with verify NOTICE in stdout
- ✅ `AuditAction` includes `'mandate_preference.update'` + `'mandate_preference.admin_update'`; `AuditEntityType` includes `'allocator_preference_mandate'`; ADR-0023 documents both rows
- ✅ `AllocatorPreferences` TS interface + `SELF_EDITABLE_PREFERENCE_FIELDS` (9 entries) extended; `ADMIN_ONLY_PREFERENCE_FIELDS` (5 entries) symmetrically shrunk
- ✅ `validateSelfEditableInput` validates all new fields per D-17 bounds
- ✅ `ALLOCATOR_PREFERENCES_COLUMNS` is EXPORTED from `src/lib/admin/match.ts` and contains all 5 new columns + `edited_by_user_id` correction
- ✅ PUT /api/preferences calls `supabase.rpc('update_allocator_mandates', fields)`, maps 28000→401 + 22023→400, emits `logAuditEvent` with `action='mandate_preference.update'` + `entity_type='allocator_preference_mandate'` within 60 lines of the rpc call, drops the `profiles.preferences_updated_at` denorm write
- ✅ Admin route emits `logAuditEvent` with `action='mandate_preference.admin_update'` + `entity_type='allocator_preference_mandate'`
- ✅ `PreferencesPanel.tsx` renders controls for max_weight, correlation_ceiling, liquidity (3-button radiogroup), style_exclusions (chip group), and displays "Mandate last edited by: allocator|admin [date]"
- ✅ `mandate-columns-schema-sync.test.ts` imports `ALLOCATOR_PREFERENCES_COLUMNS` from `@/lib/admin/match`; static + HAS_LIVE_DB projection-select probe
- ✅ `update-allocator-mandates-rpc.test.ts` HAS_LIVE_DB-gated proves all 7 required invariants (MANDATE-04/05/06 including SC4 Option A)
- ✅ `mandate-audit.test.ts` HAS_LIVE_DB-gated proves audit_log row appears after a successful mandate write

Nothing missing. Plan complete.
