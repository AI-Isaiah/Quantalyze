# Phase 02 — Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** 17 new/modified files
**Analogs found:** 16 / 17

---

## Summary

Phase 2 replaces the three-field `PreferenceForm` with a full mandate-profile builder (`MandateForm`) backed by a SECURITY DEFINER RPC (`update_allocator_mandates`). Every building block has a direct codebase analog: the migration pattern comes from 031 (SECURITY DEFINER RPC) + 049 (audit-log hardening), the route handler rewrites directly from `api/preferences/route.ts`, the form and chip UI replicate `PreferenceForm.tsx` + `PreferencesPanel.tsx`, the auto-save hook derives from `NotesWidget.tsx`, the inline-toast pattern comes from `WizardChrome.tsx`, validation tests extend `preferences.test.ts`, and the live-DB / Playwright tests follow `bridge-outcomes-rls.test.ts` / `bridge-outcome.spec.ts`.

---

## File Inventory

| Action | File Path | Role | Nearest Analog | Confidence |
|--------|-----------|------|----------------|------------|
| new | `supabase/migrations/061_mandate_columns.sql` | migration + RPC | `031_wizard_source_column.sql` + `049_audit_log_hardening.sql` | exact |
| modify | `src/lib/admin/match.ts` | config constant | self (lines 34–38) | exact |
| modify | `src/lib/preferences.ts` | types + whitelist + validation | self (full file) | exact |
| modify | `src/lib/preferences.test.ts` | unit tests | self (full file) | exact |
| new | `src/lib/audit.ts` | type union extension | self (lines 85–166) | exact |
| new | `src/__tests__/mandate-columns-schema-sync.test.ts` | live-DB smoke test | `audit-log-rls.test.ts` | close |
| new | `src/__tests__/update-allocator-mandates-rpc.test.ts` | live-DB RLS + RPC test | `bridge-outcomes-rls.test.ts` | close |
| new | `src/__tests__/mandate-audit.test.ts` | audit coverage live-DB test | `audit-fanout-integration.test.ts` | close |
| modify | `src/app/api/preferences/route.ts` | route handler (PUT rewrite) | self (lines 28–110) | exact |
| modify | `src/app/(dashboard)/preferences/page.tsx` | server component page | self (lines 1–23) | exact |
| delete | `src/components/preferences/PreferenceForm.tsx` | client component (deleted) | self — pattern still useful for MandateForm | exact |
| new | `src/components/mandate/MandateForm.tsx` | client component (form) | `PreferenceForm.tsx` + `PreferencesPanel.tsx` | close |
| new | `src/components/mandate/useMandateAutoSave.ts` | custom hook | `NotesWidget.tsx` + `WizardChrome.tsx` | adapt |
| new | `src/components/mandate/MandateForm.test.tsx` | unit test | `preferences.test.ts` structure | close |
| new | `src/components/mandate/MandateAdvanced.test.tsx` | unit test | `preferences.test.ts` structure | close |
| new | `src/components/mandate/useMandateAutoSave.test.ts` | hook unit test | `preferences.test.ts` structure | close |
| modify | `src/components/admin/PreferencesPanel.tsx` | client component (admin) | self (full file) | exact |
| new | `e2e/mandate-form.spec.ts` | Playwright E2E | `bridge-outcome.spec.ts` | exact |

---

## Per-File Patterns

---

### `supabase/migrations/061_mandate_columns.sql`

**Role:** migration (schema add + SECURITY DEFINER RPC)

**Nearest analogs:** `supabase/migrations/031_wizard_source_column.sql` (SECURITY DEFINER RPC structure + self-verifying DO block) and `supabase/migrations/049_audit_log_hardening.sql` (REVOKE/GRANT pattern + CHECK constraint pattern)

**Pattern to replicate:** Wrap everything in `BEGIN; ... COMMIT;`. Every SECURITY DEFINER function must assert `v_auth_uid := auth.uid(); IF v_auth_uid IS NULL THEN RAISE with ERRCODE = 'insufficient_privilege'`. End migration with a self-verifying DO block that uses `pg_proc.prosecdef` to assert SECURITY DEFINER status and `information_schema.columns` to assert every new column exists.

**Code excerpt — RPC auth guard (031 lines 144–153):**
```sql
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;
```

**Code excerpt — REVOKE/GRANT pattern (031 lines 192–193 and 049 lines 163–165):**
```sql
REVOKE ALL ON FUNCTION create_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_wizard_strategy TO authenticated;

-- For log_audit_event: also grant to service_role
REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO service_role;
```

**Code excerpt — self-verifying DO block pattern (031 lines 367–488, abbreviated):**
```sql
DO $$
DECLARE
  fn_exists BOOLEAN;
  fn_secdef BOOLEAN;
  col_exists BOOLEAN;
BEGIN
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'update_allocator_mandates'),
    COALESCE(
      (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'update_allocator_mandates'),
      FALSE)
  INTO fn_exists, fn_secdef;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'Migration 061 failed: update_allocator_mandates function missing';
  END IF;
  IF NOT fn_secdef THEN
    RAISE EXCEPTION 'Migration 061 failed: update_allocator_mandates is not SECURITY DEFINER';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'allocator_preferences'
      AND column_name = 'max_weight'
  ) INTO col_exists;
  IF NOT col_exists THEN
    RAISE EXCEPTION 'Migration 061 failed: allocator_preferences.max_weight column missing';
  END IF;

  RAISE NOTICE 'Migration 061: all columns + update_allocator_mandates RPC verified.';
END
$$;
```

**Code excerpt — CHECK constraint pattern (031 lines 79–83):**
```sql
ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_liquidity_preference_check;

ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_liquidity_preference_check
    CHECK (liquidity_preference IN ('high', 'medium', 'low'));
```

**Deltas for new file:**
- RPC is `update_allocator_mandates` not `finalize_wizard_strategy`
- No `p_user_id` parameter — auth guard uses only `auth.uid()` (no ownership cross-check needed since allocator only ever writes their own row)
- UPSERT with `ON CONFLICT (user_id) DO UPDATE SET` using `COALESCE` for all fields — plus a `p_clear_fields text[] DEFAULT '{}'` parameter for the Reset path (D-11)
- Bounds validation inside RPC mirrors `validateSelfEditableInput` (D-18)
- `PERFORM public.log_audit_event(...)` call inside RPC is optional (RESEARCH.md recommends emitting from route handler instead)
- `SET search_path = public, pg_catalog` required on every SECURITY DEFINER function

**Pitfalls:**
- `update_allocator_mandates` must NOT take `p_user_id` as a parameter — the ownership is always `auth.uid()`. The wizard RPCs take `p_user_id` because they create rows for other tables; mandate updates are always self-directed.
- `max_weight` column does NOT yet exist (Pitfall 6 in RESEARCH.md) — migration 061 MUST add it with `ADD COLUMN IF NOT EXISTS`.
- NULL vs COALESCE semantics: the recommended `p_clear_fields text[]` parameter is the clean solution for the Reset path (Pitfall 1 in RESEARCH.md).

---

### `src/lib/admin/match.ts` (modify)

**Role:** config constant

**Nearest analog:** self — `src/lib/admin/match.ts` lines 34–38

**Pattern to replicate:** Extend the string constant `ALLOCATOR_PREFERENCES_COLUMNS` in place — same format, one logical string addition. Must be updated in the same commit as migration 061 to keep MANDATE-07 smoke test green.

**Code excerpt — current constant (lines 34–38):**
```typescript
const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, updated_at";
```

**Deltas for new file:** Extend to:
```typescript
const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, edited_by_user_id, updated_at, " +
  "max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at";
```

Note: `edited_by_user_id` was already in the table but missing from the constant — add it here as a MANDATE-07 correction.

**Pitfalls:** The constant is used in `getAllocatorMatchPayload` to build a `.select(...)` string. Adding columns that do not yet exist in the DB will cause a PostgREST error. Apply migration 061 before running any code that reads this constant against the live DB.

---

### `src/lib/preferences.ts` (modify)

**Role:** types + whitelist arrays + validation functions

**Nearest analog:** self — full file (175 lines)

**Pattern to replicate:** Extend `AllocatorPreferences` interface, `SELF_EDITABLE_PREFERENCE_FIELDS`, `DEFAULT_PREFERENCES`, and `validateSelfEditableInput` in place. The whitelist-then-validate pattern from `validateSelfEditableInput` (lines 87–103) is the exact shape to extend.

**Code excerpt — interface to extend (lines 16–32):**
```typescript
export interface AllocatorPreferences {
  user_id: string;
  // Self-editable
  mandate_archetype: string | null;
  target_ticket_size_usd: number | null;
  excluded_exchanges: string[] | null;
  // Admin-only (not exposed via the self-edit API)
  max_drawdown_tolerance: number | null;
  min_track_record_days: number | null;
  min_sharpe: number | null;
  max_aum_concentration: number | null;
  preferred_strategy_types: string[] | null;
  preferred_markets: string[] | null;
  founder_notes: string | null;
  edited_by_user_id: string | null;
  updated_at: string;
}
```

**Code excerpt — whitelist arrays to extend (lines 34–50):**
```typescript
export const SELF_EDITABLE_PREFERENCE_FIELDS = [
  "mandate_archetype",
  "target_ticket_size_usd",
  "excluded_exchanges",
] as const;

export const ADMIN_ONLY_PREFERENCE_FIELDS = [
  "max_drawdown_tolerance",
  "min_track_record_days",
  "min_sharpe",
  "max_aum_concentration",
  "preferred_strategy_types",
  "preferred_markets",
  "founder_notes",
] as const;
```

**Code excerpt — validation pattern to extend (lines 87–103):**
```typescript
export function validateSelfEditableInput(input: Partial<AllocatorPreferences>): string | null {
  if (input.mandate_archetype !== undefined && input.mandate_archetype !== null) {
    if (typeof input.mandate_archetype !== "string") return "mandate_archetype must be a string";
    if (input.mandate_archetype.length > 500) return "mandate_archetype must be 500 characters or less";
  }
  if (input.target_ticket_size_usd !== undefined && input.target_ticket_size_usd !== null) {
    if (typeof input.target_ticket_size_usd !== "number") return "target_ticket_size_usd must be a number";
    if (!Number.isFinite(input.target_ticket_size_usd)) return "target_ticket_size_usd must be finite";
    if (input.target_ticket_size_usd < 0) return "target_ticket_size_usd must be non-negative";
    if (input.target_ticket_size_usd > 1_000_000_000) return "target_ticket_size_usd is unrealistically large";
  }
  if (input.excluded_exchanges !== undefined && input.excluded_exchanges !== null) {
    if (!Array.isArray(input.excluded_exchanges)) return "excluded_exchanges must be an array";
    if (input.excluded_exchanges.some((e) => typeof e !== "string")) return "excluded_exchanges must be string[]";
  }
  return null;
}
```

**Deltas for new file:**
- Add to `AllocatorPreferences`: `max_weight: number | null`, `correlation_ceiling: number | null`, `liquidity_preference: "high" | "medium" | "low" | null`, `style_exclusions: string[] | null`, `mandate_edited_at: string | null`
- Move `preferred_strategy_types` from `ADMIN_ONLY_PREFERENCE_FIELDS` to `SELF_EDITABLE_PREFERENCE_FIELDS` (D-03)
- Add to `SELF_EDITABLE_PREFERENCE_FIELDS`: `"max_weight"`, `"preferred_strategy_types"`, `"correlation_ceiling"`, `"liquidity_preference"`, `"style_exclusions"`
- Add numeric bounds validation in `validateSelfEditableInput` for: `max_weight` (0.05–0.50), `correlation_ceiling` (0–1); `max_drawdown_tolerance` is already validated in `validateAdminEditableInput` — add the same bounds check in `validateSelfEditableInput` now that it becomes self-editable
- Add array subset validation for `preferred_strategy_types` (must be subset of `STRATEGY_TYPES`) and `style_exclusions` (must be subset of `SUBTYPES`) — import those constants from `@/lib/constants`
- Add `liquidity_preference` enum validation: value must be `"high" | "medium" | "low"` or `null`

**Pitfalls:** Moving `preferred_strategy_types` out of `ADMIN_ONLY_PREFERENCE_FIELDS` is required (D-03, Pitfall 3 in RESEARCH.md). Leaving it in both arrays causes `pickAdminEditableFields` to include it twice — harmless functionally but misleading in type definitions. The existing test `"is disjoint from ADMIN_ONLY_PREFERENCE_FIELDS"` will catch this if it is left in both arrays.

---

### `src/lib/preferences.test.ts` (modify)

**Role:** unit tests — validation + whitelist

**Nearest analog:** self — full file (265 lines)

**Pattern to replicate:** Every new validation branch in `validateSelfEditableInput` needs a set of test cases matching the existing pattern: valid input returns null, wrong type returns error matching a specific substring, out-of-range returns error matching a specific substring.

**Code excerpt — existing test pattern per field (lines 123–143):**
```typescript
it("rejects oversized mandate_archetype", () => {
  const long = "x".repeat(501);
  expect(
    validateSelfEditableInput({ mandate_archetype: long }),
  ).toMatch(/500 characters/);
});

it("rejects non-string mandate_archetype", () => {
  expect(
    validateSelfEditableInput({
      mandate_archetype: 42 as unknown as string,
    }),
  ).toMatch(/must be a string/);
});
```

**Code excerpt — the disjoint-fields test that must be updated (lines 22–27):**
```typescript
it("is disjoint from ADMIN_ONLY_PREFERENCE_FIELDS", () => {
  const selfSet = new Set(SELF_EDITABLE_PREFERENCE_FIELDS);
  for (const field of ADMIN_ONLY_PREFERENCE_FIELDS) {
    expect(selfSet.has(field as never)).toBe(false);
  }
});
```

**Code excerpt — the "exactly N fields" test that must be updated (lines 14–19):**
```typescript
it("contains exactly the 3 v1 self-editable fields", () => {
  expect(SELF_EDITABLE_PREFERENCE_FIELDS).toEqual([
    "mandate_archetype",
    "target_ticket_size_usd",
    "excluded_exchanges",
  ]);
});
```

**Deltas for new file:** Update the "exactly 3" test to expect all Phase 2 self-editable fields. Add validation test blocks for: `max_weight` (below 0.05, above 0.50, non-number, NaN), `correlation_ceiling` (above 1.0, below 0.0), `liquidity_preference` (invalid string like `"ultra"`, non-string, null is valid), `style_exclusions` (non-array, values outside `SUBTYPES`), `preferred_strategy_types` (non-array, values outside `STRATEGY_TYPES`).

---

### `src/lib/audit.ts` (modify — type union extension only)

**Role:** type definitions

**Nearest analog:** self — lines 85–166

**Pattern to replicate:** Append new `AuditAction` and `AuditEntityType` string literals to the existing unions. Each action is namespaced `<subject>.<verb>`. Each entity_type is a snake_case noun.

**Code excerpt — existing union pattern (lines 85–128, abbreviated):**
```typescript
export type AuditAction =
  | "api_key.decrypt"
  | "intro.send"
  // ...
  | "bridge_outcome.record"
  | "bridge_outcome.update"
  | "bridge_outcome.dismiss";

export type AuditEntityType =
  | "api_key"
  | "contact_request"
  // ...
  | "bridge_outcome"
  | "bridge_outcome_dismissal";
```

**Deltas for new file:** Add to `AuditAction`:
```typescript
  | "mandate_preference.update"        // allocator self-edit via RPC
  | "mandate_preference.admin_update"  // admin direct UPDATE (D-12)
```
Add to `AuditEntityType`:
```typescript
  | "allocator_preference_mandate"
```

**Pitfalls:** `audit-coverage.test.ts` greps all `route.ts` mutation files for `logAuditEvent` within 60 lines of any `.upsert(`/`.from(` call. After the route rewrite, the `supabase.rpc(...)` call replaces the `supabase.from(...).upsert(...)` call — the audit-coverage test may not detect `rpc(` as a mutation. Check whether `audit-coverage.test.ts` scans for `.rpc(` in addition to `.insert(`, `.update(`, `.upsert(`. If it does not, the test will pass silently even without the `logAuditEvent` call. Also: the action literal `"mandate_preference.update"` must be in the `AuditAction` union at compile time or `logAuditEvent(supabase, { action: "mandate_preference.update", ... })` will fail the TypeScript build.

---

### `src/__tests__/mandate-columns-schema-sync.test.ts` (new)

**Role:** unit + live-DB smoke test (MANDATE-07)

**Nearest analog:** `src/__tests__/audit-log-rls.test.ts` (live-DB gating pattern, lines 1–80)

**Pattern to replicate:** Import from `@/lib/test-helpers/live-db` for the `HAS_LIVE_DB` gate and `createLiveAdminClient`. Static assertion (always runs, no DB needed) plus an `it.skipIf(!HAS_LIVE_DB)(...)` live-DB path.

**Code excerpt — live-DB import and gate (audit-log-rls.test.ts lines 31–41):**
```typescript
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
```

**Deltas for new file:** The live-DB path cannot query `information_schema` directly via PostgREST (Pitfall in RESEARCH.md §Validation Architecture). Use one of two approaches: (a) a static string-containment assertion (always runs) supplemented by a raw SQL via an admin client RPC; or (b) purely static assertions. The recommended pattern:

```typescript
import { ALLOCATOR_PREFERENCES_COLUMNS } from "@/lib/admin/match";

describe("MANDATE-07: ALLOCATOR_PREFERENCES_COLUMNS schema sync", () => {
  // Static — always runs in CI, no live DB needed
  it("contains all Phase 2 mandate columns", () => {
    const cols = ALLOCATOR_PREFERENCES_COLUMNS;
    expect(cols).toContain("max_weight");
    expect(cols).toContain("correlation_ceiling");
    expect(cols).toContain("liquidity_preference");
    expect(cols).toContain("style_exclusions");
    expect(cols).toContain("mandate_edited_at");
    expect(cols).toContain("edited_by_user_id");
  });

  // Live-DB — only when HAS_LIVE_DB=1
  it.skipIf(!HAS_LIVE_DB)(
    "every listed column exists in information_schema.columns",
    async () => {
      const admin = createLiveAdminClient();
      // Use a service-role raw query via a known RPC or direct Postgres
      // The admin client cannot query information_schema via PostgREST REST layer
      // Use a custom RPC or verify column existence by attempting a SELECT
    },
    60_000,
  );
});
```

**Pitfalls:** PostgREST blocks `information_schema` queries from the REST layer. The live-DB path must use either a custom SQL-execution RPC (if one exists) or verify column existence indirectly by doing a `SELECT column_name FROM ...` probe via the admin client in a different way. Alternatively, the static assertions alone may be sufficient for the MANDATE-07 contract — the live-DB path is a nice-to-have backstop.

---

### `src/__tests__/update-allocator-mandates-rpc.test.ts` (new)

**Role:** live-DB integration test (MANDATE-05, MANDATE-06)

**Nearest analog:** `src/__tests__/bridge-outcomes-rls.test.ts` (lines 1–80 for structure) and `src/__tests__/audit-log-rls.test.ts` (live-DB helper imports)

**Pattern to replicate:** Import live-DB helpers, provision a throw-away test user via `createTestUser`, exercise the RPC as that user, assert success/failure, tear down in `afterEach`.

**Code excerpt — test user provisioning and client creation (bridge-outcomes-rls.test.ts lines 28–38):**
```typescript
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
```

**Code excerpt — unauthenticated RPC rejection pattern (audit-log-rls.test.ts — analogous):**
```typescript
it.skipIf(!HAS_LIVE_DB)("unauthenticated call is rejected", async () => {
  // Create an anon client (no JWT)
  const anon = createClient(LIVE_DB_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { error } = await anon.rpc("update_allocator_mandates", {
    p_max_weight: 0.25,
  });
  expect(error).not.toBeNull();
  expect(error?.code).toBe("28000"); // insufficient_privilege
}, 30_000);
```

**Deltas for new file:**
- Test 1: Authenticated user calls RPC with valid `p_max_weight: 0.25` → succeeds, row exists in `allocator_preferences` with `max_weight = 0.25`
- Test 2: Unauthenticated anon client call → error code `28000`
- Test 3: `p_max_weight: 0.99` (out of range) → error code `22023` (invalid_parameter_value)
- Test 4: `p_liquidity_preference: "ultra"` (invalid enum) → error code `22023`
- Test 5: Direct UPDATE on `allocator_preferences` by authenticated user succeeds (existing `allocator_prefs_self_update` RLS policy allows it — MANDATE-06 is enforced at API layer, not at DB layer); this test documents the known gap and is informational only

**Pitfalls:** `createTestUser` must also insert an `allocator_preferences` row (or confirm the RPC creates one via UPSERT) before testing the read-back. The RPC uses `ON CONFLICT (user_id) DO UPDATE` so the INSERT path must also work for a first-time user.

---

### `src/__tests__/mandate-audit.test.ts` (new)

**Role:** audit coverage integration test (MANDATE-08)

**Nearest analog:** `src/__tests__/audit-fanout-integration.test.ts`

**Pattern to replicate:** After a mandate write (via the API route or RPC), assert an `audit_log` row exists with `action = 'mandate_preference.update'` and `entity_type = 'allocator_preference_mandate'`.

**Deltas for new file:** The audit emission happens in the route handler (fire-and-forget via `logAuditEvent`). The live-DB test must wait briefly after the route call before querying `audit_log` (the emission is scheduled via `after()` — it may land after the response). Add a short `await new Promise(r => setTimeout(r, 500))` between the route call and the audit_log assertion.

**Pitfalls:** `logAuditEvent` is fire-and-forget and uses `after()` — the audit row is not guaranteed to be present synchronously. The 500ms wait is the same pattern used in `audit-fanout-integration.test.ts`.

---

### `src/app/api/preferences/route.ts` (modify — PUT rewrite)

**Role:** route handler (mutation)

**Nearest analog:** self — full file (111 lines)

**Pattern to replicate:** The existing file is the exact starting point. The PUT handler structure (CSRF → auth → rate-limit → parse body → whitelist → validate → mutate → audit) is preserved identically. Only the mutate step changes: replace `supabase.from("allocator_preferences").upsert(...)` with `supabase.rpc("update_allocator_mandates", { ...fields })`.

**Code excerpt — current PUT handler structure (lines 28–110):**
```typescript
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkLimit(userActionLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const fields = pickSelfEditableFields(body);
  const validationError = validateSelfEditableInput(fields);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // CURRENT: direct upsert — REPLACE THIS BLOCK with supabase.rpc(...)
  const { error } = await supabase
    .from("allocator_preferences")
    .upsert({ user_id: user.id, ...fields, edited_by_user_id: null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });

  if (error) { /* ... */ }

  // KEEP THIS: audit emission
  logAuditEvent(supabase, {
    action: "notification_preferences.update",  // CHANGE to "mandate_preference.update"
    entity_type: "user",                         // CHANGE to "allocator_preference_mandate"
    entity_id: user.id,
    metadata: { fields: Object.keys(fields), self_edit: true },
  });

  // REMOVE: the profiles.preferences_updated_at denorm write (no longer needed)
  return NextResponse.json({ success: true });
}
```

**Deltas for new file:**
- Replace `supabase.from("allocator_preferences").upsert(...)` with `supabase.rpc("update_allocator_mandates", { ...fields })`
- RPC error mapping: `error.code === "28000"` → 401, `error.code === "22023"` → 400 with `error.message`, other → 500 with `"Failed to save mandate"`
- Remove the `PGRST205` handler (that was for the missing-table path — migration 061 must be applied before Phase 2 ships)
- Change `action` to `"mandate_preference.update"` and `entity_type` to `"allocator_preference_mandate"` in `logAuditEvent`
- Remove the `profiles.preferences_updated_at` denorm write (lines 101–107) — no longer needed; `mandate_edited_at` is written by the RPC itself
- Keep the `GET` handler unchanged

**Pitfalls:** The `audit-coverage.test.ts` meta-test scans for `.insert(`, `.update(`, `.upsert(`, `.delete(` — the new `supabase.rpc(...)` call is NOT one of those literals. Check whether the meta-test would miss the mutation. If it does, add an `@audit-skip: rpc write path; logAuditEvent called below` pragma above the `rpc(` call to satisfy the test scanner OR verify the scanner handles `rpc(`.

---

### `src/app/(dashboard)/preferences/page.tsx` (modify)

**Role:** server component page

**Nearest analog:** self — full file (23 lines)

**Pattern to replicate:** Minimal server component — auth guard → `getOwnPreferences` → pass to client component. The same three-line structure is preserved; only the imports and JSX change.

**Code excerpt — current page (full file, lines 1–23):**
```typescript
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PreferenceForm } from "@/components/preferences/PreferenceForm";
import { createClient } from "@/lib/supabase/server";
import { getOwnPreferences } from "@/lib/preferences";

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const initial = await getOwnPreferences(supabase, user.id);

  return (
    <>
      <PageHeader
        title="Preferences"
        description="Tell us about your mandate so we can send better strategy recommendations."
      />
      <PreferenceForm initial={initial} />
    </>
  );
}
```

**Deltas for new file:**
- Change import: `PreferenceForm` → `MandateForm` from `@/components/mandate/MandateForm`
- Change `PageHeader` title to `"My Allocation Settings"` (D-01, MANDATE-01)
- Change `PageHeader` description to `"Tell us about your mandate. Changes save automatically."` (UI-SPEC copywriting contract)
- Replace `<PreferenceForm initial={initial} />` with `<MandateForm initial={initial} />`
- Pass `mandate_edited_at` from `initial` to `MandateForm` so the "Last saved" timestamp initializes correctly

**Pitfalls:** `PreferenceForm` is deleted (D-02) — this page.tsx import must be updated in the same commit or the build breaks (Pitfall 5 in RESEARCH.md).

---

### `src/components/mandate/MandateForm.tsx` (new)

**Role:** client component (root form)

**Nearest analog:** `src/components/preferences/PreferenceForm.tsx` (chip pattern, form structure, fetch call) + `src/components/admin/PreferencesPanel.tsx` (chip toggle helper, multi-field state, `parseNum` helper)

**Pattern to replicate:** `"use client"` component. State per field initialized from `initial`. Chip toggle via a generic `toggle<T>` helper (from `PreferencesPanel.tsx:74`). No form `onSubmit` — auto-save only. `useMandateAutoSave` hook called per field.

**Code excerpt — chip toggle helper and state init (PreferencesPanel.tsx lines 74–76):**
```typescript
function toggle<T extends string>(list: T[], value: T, set: (v: T[]) => void) {
  set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
}
```

**Code excerpt — parseNum helper (PreferencesPanel.tsx lines 79–83):**
```typescript
function parseNum(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
```

**Code excerpt — chip render pattern (PreferencesPanel.tsx lines 251–268):**
```typescript
{STRATEGY_TYPES.map((type) => {
  const active = preferredTypes.includes(type);
  return (
    <button
      key={type}
      type="button"
      onClick={() => toggle(preferredTypes, type, setPreferredTypes)}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-text-secondary hover:border-border-focus"
      }`}
    >
      {type}
    </button>
  );
})}
```

**Code excerpt — excluded exchanges chip (red variant) (PreferencesPanel.tsx lines 300–316):**
```typescript
{EXCHANGES.map((exchange) => {
  const active = excludedExchanges.includes(exchange);
  return (
    <button
      key={exchange}
      type="button"
      onClick={() => toggle(excludedExchanges, exchange, setExcludedExchanges)}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-negative bg-negative/10 text-negative"
          : "border-border bg-surface text-text-secondary hover:border-border-focus"
      }`}
    >
      {exchange}
    </button>
  );
})}
```

**Code excerpt — PreferenceForm "use client" + Card wrapper (PreferenceForm.tsx lines 1–16, 74–76):**
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
// ...
export function PreferenceForm({ initial }: PreferenceFormProps) {
  // ...
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-6">
```

**Deltas for new file:**
- Remove `useRouter` — no `router.refresh()` call (auto-save does not navigate)
- Remove `onSubmit` form handler — no `<form>` element; individual field `onBlur`/`onClick` handlers call `useMandateAutoSave` per field
- Add `MandateSaveStatus` component inline (aria-live region with `saveStatus` and `lastSavedAt` state)
- Add `MandateAdvancedSection` accordion wrapping `correlation_ceiling`, `max_drawdown_tolerance`, `liquidity_preference`, `style_exclusions`
- Slider for `max_weight`, `correlation_ceiling`, `max_drawdown_tolerance` using native `<input type="range">` with value-pill in `font-metric`
- Per-field Reset link: `<button type="button" onClick={() => save(null)} className="text-xs text-text-muted">Reset</button>` — visible only when field is non-null
- `useId()` for label-to-control `htmlFor` associations (per UI-SPEC a11y contract)
- Chip multi-selects use `<button role="checkbox" aria-checked={selected}>` (not `<label><input type="checkbox">`) for proper a11y
- `SUBTYPES` imported from `@/lib/constants` for `style_exclusions` chips
- Import `useMandateAutoSave` from `./useMandateAutoSave`

**Pitfalls:** The `<form>` element should be removed or its `onSubmit` should be `e.preventDefault()` only — there is no submit button. Using a `<form>` without a submit button is fine semantically but add `onSubmit={e => e.preventDefault()}` as a safety net. Do NOT add `router.refresh()` on save — auto-save must not trigger a full server component re-render on every field blur (use the returned `success: true` to update local state only).

---

### `src/components/mandate/useMandateAutoSave.ts` (new)

**Role:** custom hook (auto-save per field)

**Nearest analog:** `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` (save state machine, debounce pattern, flush-on-unmount) + `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` (toast timing via `useEffect` + timers)

**Pattern to replicate:** `SaveState` discriminated union. `save` function as `useCallback`. Timer-based fade-out after "saved". Error message state. No external toast library.

**Code excerpt — NotesWidget save state machine and useCallback save (lines 1–69):**
```typescript
type SaveState = "idle" | "saving" | "saved" | "error";

// ...
const [saveState, setSaveState] = useState<SaveState>("idle");
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const save = useCallback(
  async (content: string) => {
    if (!portfolioId) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, portfolio_id: portfolioId }),
      });
      if (res.ok) {
        lastSavedRef.current = content;
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  },
  [portfolioId],
);
```

**Code excerpt — WizardChrome toastKey/showToast timer pattern (lines 44–56):**
```typescript
useEffect(() => {
  if (toastKey === undefined) return;
  const showTimer = setTimeout(() => setShowToast(true), 0);
  const hideTimer = setTimeout(() => setShowToast(false), 2000);
  return () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  };
}, [toastKey]);
```

**Code excerpt — NotesWidget flush-on-unmount (lines 83–95):**
```typescript
useEffect(() => {
  return () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (contentRef.current !== lastSavedRef.current && portfolioId) {
      fetch("/api/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentRef.current, portfolio_id: portfolioId }),
      }).catch(() => {});
    }
  };
}, [portfolioId]);
```

**Deltas for new file:**
- Hook signature: `useMandateAutoSave()` returns `{ saveState, errorMessage, lastSavedAt, save }` — `save(fieldName: string, value: unknown)` triggers the PUT call
- The hook is **form-level** (one instance per `MandateForm`), not per-field — it tracks `saveState` and `lastSavedAt` globally for the "Last saved" status region
- `save(fieldName, value)` constructs `{ [fieldName]: value }` as the request body — for Reset, caller passes `value = null`
- Keyboard debounce for sliders: `keyDebounceRef = useRef<ReturnType<typeof setTimeout>>()`, `handleKeyUp` sets a 300ms debounce (RESEARCH.md pattern)
- On HTTP 429 response: parse `Retry-After` header and schedule an auto-retry via `setTimeout`
- `retryCount` ref to cap at 3 exponential-backoff retries for 5xx errors (1s, 2s, 4s)
- No `flush-on-unmount` needed (unlike NotesWidget) — each field save is triggered by an explicit user gesture, not a debounced change

**Pitfalls:** The hook returns a single shared `saveState` for the whole form (the "Last saved" region is form-level per UI-SPEC). Individual fields show their own per-field spinner/error state — this requires either (a) the hook tracking a `Map<fieldName, "saving"|"error">` for per-field status, or (b) each field calling the hook independently. The per-field inline error (D-16) requires per-field error tracking. The simplest approach: the hook tracks both `formSaveState` (for the top-level status region) and a `fieldErrors: Record<string, string>` map (for per-field inline errors).

---

### `src/components/admin/PreferencesPanel.tsx` (modify)

**Role:** client component (admin panel)

**Nearest analog:** self — full file (347 lines)

**Pattern to replicate:** Add state variables following the existing `useState<string>` pattern for numerics (lines 34–58). Add body keys following the existing `body` object pattern (lines 108–119). Add UI controls following the existing `grid grid-cols-3 gap-3` pattern for numeric inputs (lines 218–243). Add "Last edited by" indicator following the `savedMessage` pattern.

**Code excerpt — state init pattern (lines 34–58):**
```typescript
const [maxDD, setMaxDD] = useState<string>(
  preferences?.max_drawdown_tolerance != null
    ? String(preferences.max_drawdown_tolerance)
    : "",
);
```

**Code excerpt — body construction pattern (lines 108–119):**
```typescript
const body: Record<string, unknown> = {
  mandate_archetype: archetype.trim() || null,
  target_ticket_size_usd: parseNum(ticketSize),
  excluded_exchanges: excludedExchanges,
  max_drawdown_tolerance: parseNum(maxDD),
  // ...
};
```

**Code excerpt — chip group pattern for new fields (lines 251–268, re-used for style_exclusions):**
```typescript
// style_exclusions — same pattern as preferred_strategy_types but imports SUBTYPES
{SUBTYPES.map((subtype) => {
  const active = styleExclusions.includes(subtype);
  return (
    <button key={subtype} type="button"
      onClick={() => toggle(styleExclusions, subtype, setStyleExclusions)}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active ? "border-accent bg-accent/10 text-accent"
               : "border-border bg-surface text-text-secondary hover:border-border-focus"
      }`}>{subtype}</button>
  );
})}
```

**Code excerpt — "Last edited by" indicator shape (RESEARCH.md §Admin Parity lines 478–486):**
```tsx
{preferences?.mandate_edited_at && (
  <p className="text-xs text-text-muted font-metric">
    Mandate last edited by:{" "}
    {preferences.edited_by_user_id === null ? "allocator" : "admin"}{" "}
    · {new Date(preferences.mandate_edited_at).toLocaleDateString()}
  </p>
)}
```

**Deltas for new file:**
- Add state: `maxWeight`, `correlationCeiling`, `liquidityPreference` (`useState<string>`), `styleExclusions` (`useState<string[]>`)
- Import `SUBTYPES` from `@/lib/constants`
- Add to body: `max_weight: parseNum(maxWeight)`, `correlation_ceiling: parseNum(correlationCeiling)`, `liquidity_preference: liquidityPreference || null`, `style_exclusions: styleExclusions`
- Add numeric inputs for `max_weight` (step=0.01, min=0.05, max=0.50) and `correlation_ceiling` (step=0.05, min=0, max=1) in a new grid group
- Add three-button radio group for `liquidity_preference` (same visual pattern as chip group but `role="radiogroup"`)
- Add chip group for `style_exclusions` (accent variant, same as `preferred_strategy_types`)
- Add "Last edited by" indicator above the sticky save button
- The existing `AllocatorPreferences` type imported from `@/components/admin/AllocatorMatchQueue` must be extended with the new columns — that type is local to the admin area and separate from `src/lib/preferences.ts`'s `AllocatorPreferences`

**Pitfalls:** `PreferencesPanel.tsx` imports `AllocatorPreferences` from `@/components/admin/AllocatorMatchQueue` (line 8), NOT from `@/lib/preferences`. Both must be extended. Do not confuse the two. The admin component's local type is the one driving the `preferences?.max_weight` prop access in the panel.

---

### `e2e/mandate-form.spec.ts` (new)

**Role:** Playwright E2E test

**Nearest analog:** `e2e/bridge-outcome.spec.ts` — full file (238 lines)

**Pattern to replicate:** Identical structure — `HAS_SEEDED_SUPABASE` gate, per-test allocator provisioning via `makeAdminClient()` + `admin.auth.admin.createUser()`, `beforeEach` login + navigate, `afterEach` `destroyAllocator`. Use `data-testid` attributes to locate form elements.

**Code excerpt — HAS_SEEDED_SUPABASE gate and per-test provisioner (bridge-outcome.spec.ts lines 119–158):**
```typescript
test.describe("Phase 1 — Bridge Outcome recording", () => {
  test.skip(
    !process.env.HAS_SEEDED_SUPABASE ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "requires seeded Supabase + service role key",
  );

  test.setTimeout(60_000);

  let admin: SupabaseClient;
  let ctx: AllocatorCtx;

  test.beforeAll(() => { admin = makeAdminClient(); });

  test.beforeEach(async ({ page }) => {
    ctx = await provisionAllocator(admin);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ctx.email);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.goto("/preferences");
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    if (ctx) await destroyAllocator(admin, ctx);
  });
});
```

**Code excerpt — making a provisioner with preferences row (bridge-outcome.spec.ts lines 43–78):**
```typescript
async function provisionAllocator(admin: SupabaseClient): Promise<AllocatorCtx> {
  // createUser → update profile → insert allocator_preferences → ...
  const { error: prefErr } = await admin.from("allocator_preferences").insert({
    user_id: userId,
    mandate_archetype: "Market Neutral",
    target_ticket_size_usd: 5_000_000,
    excluded_exchanges: [],
    min_sharpe: 1.0,
    min_track_record_days: 180,
  });
  if (prefErr) throw prefErr;
```

**Deltas for new file:**
- Navigate to `/preferences` (not `/allocations`)
- Provisioned allocator does NOT need pre-seeded `allocator_preferences` row — Phase 2 first-visit shows blank form per D-09
- Test 1 (MANDATE-01 + MANDATE-04): Navigate to `/preferences` → `max_weight` input visible → interact with slider → "Mandate saved" indicator appears → revisit page → value persists (check `data-testid="mandate-save-status"` for the "Last saved" text)
- Test 2 (MANDATE-03 + accordion): Expand "Advanced constraints" accordion → `correlation_ceiling` slider visible → interact → "Mandate saved" indicator appears
- Test 3 (Reset affordance): Set a field, verify "Reset" link appears, click it, verify field clears and "Mandate saved" fires

**Pitfalls:** The provisioned allocator must have `role: "allocator"` and `allocator_status: "verified"` on their profile (same as bridge-outcome.spec.ts lines 62–67) or the dashboard redirect may not land on `/preferences`. The `waitForLoadState("networkidle")` call is critical — the auto-save fields attach `onBlur` during hydration; clicking before hydration completes silently no-ops.

---

### `src/components/mandate/MandateForm.test.tsx` (new)
### `src/components/mandate/MandateAdvanced.test.tsx` (new)
### `src/components/mandate/useMandateAutoSave.test.ts` (new)

**Role:** unit tests (component + hook)

**Nearest analog:** `src/lib/preferences.test.ts` for structure and assertion style

**Pattern to replicate:** `describe` → `it` blocks, assertion style (`expect(...).toBeNull()`, `expect(...).toMatch(/pattern/)`). For component tests, use `@testing-library/react` (check if the project uses it) or pure hook testing with `renderHook`.

**Deltas for each file:**
- `MandateForm.test.tsx`: render with `initial = null` → assert Basic section fields are empty; render with `initial` populated → assert values are displayed; assert "Reset" link is absent when field is null, present when field is non-null
- `MandateAdvanced.test.tsx`: accordion is collapsed by default; clicking trigger expands; `correlation_ceiling` and `risk_budget` sliders are rendered inside
- `useMandateAutoSave.test.ts`: mock `fetch` → call `save("max_weight", 0.25)` → assert `saveState === "saved"` after resolution; mock 400 → assert `saveState === "error"` + `errorMessage` is set; mock 429 with `Retry-After: 1` → assert auto-retry is scheduled

**Pitfalls:** Check whether the project has `@testing-library/react` before writing component tests. The component tests may need to be moved to integration tests or skipped if the library is not available. Check `package.json` before implementing.

---

## Cross-Cutting Patterns

### CSRF Guard
**Source:** `src/app/api/preferences/route.ts` line 29 — `const csrfError = assertSameOrigin(req); if (csrfError) return csrfError;`
**Apply to:** `PUT /api/preferences` (already present, keep it)

---

### Auth Guard (Route Handler)
**Source:** `src/app/api/preferences/route.ts` lines 32–36:
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```
**Apply to:** `PUT /api/preferences` (keep unchanged)

---

### Rate Limiter
**Source:** `src/app/api/preferences/route.ts` lines 38–44:
```typescript
const rl = await checkLimit(userActionLimiter, `preferences:${user.id}`);
if (!rl.success) {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
  );
}
```
**Apply to:** `PUT /api/preferences` (keep unchanged)

---

### Audit Emission (Route Handler, Fire-and-Forget)
**Source:** `src/lib/audit.ts` lines 185–200 (`logAuditEvent`) — called with `after()` internals:
```typescript
logAuditEvent(supabase, {
  action: "mandate_preference.update",      // NEW action
  entity_type: "allocator_preference_mandate",  // NEW entity_type
  entity_id: user.id,
  metadata: { fields: Object.keys(fields), self_edit: true },
});
```
**Apply to:** `PUT /api/preferences` (replace the existing `logAuditEvent` call — change action + entity_type strings). Also add `logAuditEventAsUser` call in the admin route handler for `"mandate_preference.admin_update"`.
**Critical:** The action literal must be added to `AuditAction` union in `src/lib/audit.ts` before the route handler can compile.

---

### RPC Error Code Mapping
**Source:** RESEARCH.md §Error Codes (lines 248–258):
```typescript
if (error.code === "28000") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
return NextResponse.json({ error: "Failed to save mandate" }, { status: 500 });
```
**Apply to:** `PUT /api/preferences` (replaces the `PGRST205` handler)

---

### SECURITY DEFINER RPC Invariants (Migration)
**Source:** `supabase/migrations/031_wizard_source_column.sql` lines 133–153:
1. `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`
2. `v_auth_uid := auth.uid()` as first statement
3. `IF v_auth_uid IS NULL THEN RAISE EXCEPTION ... USING ERRCODE = 'insufficient_privilege'`
4. `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`
5. Self-verifying DO block asserting `prosecdef = TRUE`

**Apply to:** `update_allocator_mandates` RPC in migration 061

---

### Column Whitelist Extension Checklist
Every time a new mandate column is added, update ALL of these in the same commit:
1. `supabase/migrations/061_mandate_columns.sql` — `ALTER TABLE ADD COLUMN IF NOT EXISTS`
2. `src/lib/preferences.ts` — `AllocatorPreferences` interface
3. `src/lib/preferences.ts` — `SELF_EDITABLE_PREFERENCE_FIELDS` (or `ADMIN_ONLY_PREFERENCE_FIELDS`)
4. `src/lib/admin/match.ts` — `ALLOCATOR_PREFERENCES_COLUMNS` string
5. `src/app/api/preferences/route.ts` — the `supabase.rpc("update_allocator_mandates", ...)` spread includes it (via `pickSelfEditableFields`)
6. `src/components/admin/PreferencesPanel.tsx` — add state + UI control + body field
7. `src/lib/preferences.test.ts` — new validation test cases
8. `src/__tests__/mandate-columns-schema-sync.test.ts` — new `expect(cols).toContain(...)` assertion

---

### `HAS_SEEDED_SUPABASE` + `HAS_LIVE_DB` Gating Convention
**Source:** `e2e/bridge-outcome.spec.ts` lines 119–125 (Playwright) + `src/__tests__/audit-log-rls.test.ts` imports (Vitest):

Playwright:
```typescript
test.skip(
  !process.env.HAS_SEEDED_SUPABASE ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY,
  "requires seeded Supabase + service role key",
);
```

Vitest live-DB:
```typescript
it.skipIf(!HAS_LIVE_DB)("...", async () => { ... }, 30_000);
```

**Apply to:** all new live-DB tests and Playwright E2E spec

---

### `async cookies()` / `await createClient()` Convention
**Source:** `src/app/(dashboard)/preferences/page.tsx` line 8 — `const supabase = await createClient()`

This is Next.js 16's async API. All route handlers and server components must `await createClient()`. Do NOT call `createClient()` synchronously.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All 17 files have analogs. The `useMandateAutoSave` hook is the weakest match (adapt-level) but has two strong component analogs in `NotesWidget.tsx` and `WizardChrome.tsx`. |

---

## Metadata

**Analog search scope:** `src/app/api/`, `src/components/`, `src/lib/`, `src/__tests__/`, `supabase/migrations/`, `e2e/`
**Files scanned:** 20 analog files read (8 fully, 12 partially)
**Pattern extraction date:** 2026-04-18

## PATTERN MAPPING COMPLETE
