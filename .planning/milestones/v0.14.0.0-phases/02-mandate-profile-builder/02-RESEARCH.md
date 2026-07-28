# Technical Research — Phase 02: Mandate Profile Builder

**Researched:** 2026-04-18
**Domain:** Supabase SECURITY DEFINER RPC / Next.js 16 App Router / React auto-save form
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Route + /preferences Reconciliation**
- D-01: MandateForm replaces the existing `/preferences` page content. Route path stays at `/preferences`. Page title and copy update to "My Allocation Settings". No new route introduced.
- D-02: `excluded_exchanges` moves into MandateForm (single source of truth). `PreferenceForm.tsx` is deleted; its three fields (`mandate_archetype`, `target_ticket_size_usd`, `excluded_exchanges`) migrate into the new form.
- D-03: `preferred_strategy_types` promoted from admin-only to self-editable via RPC. `SELF_EDITABLE_PREFERENCE_FIELDS` extends accordingly; admin retains direct-UPDATE write path.

**Mandate Column Taxonomy**
- D-04: `style_exclusions` = `text[]`, values from `SUBTYPES` constant. Multi-select chips. No new enum.
- D-05: `liquidity_preference` = `text` with CHECK `IN ('high','medium','low')` (NULL allowed). Three segmented radio pills.
- D-06: `risk_budget` column = `numeric` (max drawdown, 0–1). Reuse `max_drawdown_tolerance` column (rename UI label only).
- D-07: `correlation_ceiling` = `numeric` (0–1, default 0.6; NULL = no constraint). `max_weight` = `numeric` (0.05–0.50; NULL = no constraint) — column confirmed already exists in `allocator_preferences`.
- D-08: `mandate_edited_at` = `timestamptz`, updated on every allocator-initiated mandate write. Separate from `updated_at`.

**Empty + Clear Semantics**
- D-09: First-visit: all mandate fields blank / NULL. No default pre-fill.
- D-10: Clearing a field is allowed; writes NULL via RPC.
- D-11: Per-field Reset link (text "Reset") → sets field to NULL → same auto-save path.

**Admin PreferencesPanel Reconciliation**
- D-12: Admin retains direct UPDATE via `/api/admin/match/preferences/[allocator_id]/route.ts`. Both paths call `log_audit_event`. `pickAdminEditableFields` expands to include new mandate columns.
- D-13: Admin PreferencesPanel.tsx gains UI controls for new mandate fields.
- D-14: Admin panel shows `Last edited by: allocator | admin [timestamp]`. Allocator form shows `Last saved: N min ago` using `mandate_edited_at` only.

**Auto-Save Behavior**
- D-15: Auto-save trigger = on blur per field. Sliders on thumb release. Chip multi-selects on each toggle. No submit button. No debounced batch.
- D-16: Save feedback = inline aria-live region ("Mandate saved" + checkmark) + "Last saved: N min ago" timestamp. On RPC failure, inline field-level error + Retry affordance. Field value does NOT revert.

**Validation**
- D-17: Bounds — max_weight: 0.05–0.50; correlation_ceiling: 0.0–1.0; risk_budget (max_drawdown_tolerance): 0.0–1.0; liquidity_preference: high|medium|low; style_exclusions: subset of SUBTYPES; preferred_strategy_types: subset of STRATEGY_TYPES; excluded_exchanges: subset of EXCHANGES; target_ticket_size_usd: 0–1,000,000,000; mandate_archetype: ≤500 chars.
- D-18: Validation lives in `src/lib/preferences.ts` (`validateSelfEditableInput`) — extended for new fields; RPC performs same checks server-side.

### Claude's Discretion
- Auto-save debounce granularity for rapid slider drags
- "Last saved: N min ago" format (relative vs absolute, refresh cadence)
- Basic vs Advanced split layout
- Component structure (single `MandateForm` vs composed `MandateBasicSection` + `MandateAdvancedAccordion`)
- Toast library — reuse Phase 1's bridge-outcome flow inline pattern (no new dependency)
- Error copy for RPC failures
- Exact RPC signature: parameter names/types, return shape, error codes
- Whether to reuse `max_drawdown_tolerance` for `risk_budget` (D-06) — research favors reuse
- Route guard / redirect if any other page links to the old `/preferences` content model

### Deferred Ideas (OUT OF SCOPE)
- Onboarding nudge / first-visit banner
- Field-level history / audit timeline UI
- Cross-field validation (e.g., max_weight × portfolio_size)
- Bulk import from CSV
- Admin "impersonate allocator" write path
- Cross-field invariants in migration CHECK constraints vs application-layer only
- Coarser `style_categories` taxonomy
- Per-field admin override lock
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MANDATE-01 | Allocator can set `max_weight` (slider, 5–50%, default 25%) in My Allocation settings | D-07 confirms column exists; UI-SPEC prescribes slider step 0.01; `validateSelfEditableInput` extension handles bounds |
| MANDATE-02 | Allocator can set preferred strategy types (multi-select chips) and excluded exchanges (always-visible Basic section) | D-03 promotes `preferred_strategy_types` to self-editable; `EXCHANGES` + `STRATEGY_TYPES` constants verified in `src/lib/constants.ts` |
| MANDATE-03 | Allocator can set correlation ceiling, risk budget, liquidity preference, style exclusions — Advanced accordion | New columns: `correlation_ceiling`, reused `max_drawdown_tolerance`, `liquidity_preference`, `style_exclusions`; migration 061 |
| MANDATE-04 | Mandate form auto-saves on blur per field with "Last saved: N min ago" | `NotesWidget.tsx` debounce pattern + `WizardChrome.tsx` inline toast precedent. No library needed. |
| MANDATE-05 | All mandate writes go through `update_allocator_mandates(...)` SECURITY DEFINER RPC scoped to `auth.uid()` | Full RPC template in §SECURITY DEFINER RPC Pattern below |
| MANDATE-06 | Direct UPDATE on `allocator_preferences` remains admin-only | Migration 011 RLS `allocator_prefs_self_update` policy stays untouched; RPC bypasses RLS with SECURITY DEFINER |
| MANDATE-07 | `ALLOCATOR_PREFERENCES_COLUMNS` in `src/lib/admin/match.ts` stays schema-synced; smoke test asserts against `information_schema.columns` | Schema-sync smoke test template verified in `preferences.test.ts` + live-DB pattern in `src/__tests__/` |
| MANDATE-08 | Every mandate update logged via `log_audit_event` with `entity_type='allocator_preference_mandate'` | `log_audit_event` signature verified in migration 049; new `AuditAction` + `AuditEntityType` entries needed in `src/lib/audit.ts` |
</phase_requirements>

---

## Executive Summary

Phase 2 adds five new database columns to `allocator_preferences`, a SECURITY DEFINER RPC that is the exclusive allocator write path, a replacement for `PreferenceForm.tsx` called `MandateForm`, auto-save-on-blur UX, admin panel parity, and full audit coverage. No new external dependencies are introduced — every building block (RLS policies, migration pattern, inline inline aria-live toast, route handler shape, schema-sync smoke test, live-DB RLS tests, Playwright E2E gate) has a direct precedent in the Phase 1 codebase.

The biggest planning risk is the **D-06 reuse decision**: `max_drawdown_tolerance` already exists and is fully wired into admin validation and the match engine. The research recommendation is to reuse the column and rename the UI label only, making the migration a pure ADD (no column rename or backfill). The second-largest risk is the **`ALLOCATOR_PREFERENCES_COLUMNS` contract**: MANDATE-07 requires this constant (in `src/lib/admin/match.ts`) stays in sync with `information_schema.columns`. The smoke test must be updated in the same wave that adds columns.

**Primary recommendation:** Write `update_allocator_mandates` as a named-parameter RPC (not `p_fields jsonb`) — the named-parameter pattern matches every existing SECURITY DEFINER RPC in this codebase and keeps server-side whitelisting explicit and refactor-safe.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mandate field storage | Database (Postgres) | — | `allocator_preferences` table, RLS-protected |
| Allocator write path | Database (SECURITY DEFINER RPC) | API / Next.js route handler | RPC is the authorization boundary; route handler is orchestrator only |
| Admin write path | API / Next.js route handler | Database (direct UPDATE via admin client) | Existing pattern per D-12 |
| Form rendering + auto-save | Browser (React client component) | — | `"use client"` — requires `useState`, event handlers |
| Initial data fetch | Frontend Server (Server Component) | — | `preferences/page.tsx` is a Server Component; reads via `getOwnPreferences()` |
| Field validation | Browser (client) + Database (RPC guard) | API route (Zod parse) | Double-checked per D-18; RPC is the authoritative gate |
| Audit logging | Database (SECURITY DEFINER RPC) | API route (fire-and-forget via `logAuditEvent`) | Allocator path: `logAuditEvent` from route handler calls `log_audit_event` RPC; admin path: same |
| Schema-sync smoke test | TypeScript unit test (Vitest, live-DB gate) | — | `ALLOCATOR_PREFERENCES_COLUMNS` vs `information_schema.columns` |
| E2E test | Playwright (browser) | — | `HAS_SEEDED_SUPABASE` gating pattern |

---

## SECURITY DEFINER RPC Pattern

### Verified Signature: `log_audit_event`
[VERIFIED: supabase/migrations/049_audit_log_hardening.sql]

```sql
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_metadata    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
```

Called from inside other SECURITY DEFINER RPCs as: `PERFORM public.log_audit_event(...)` or from the TypeScript layer via `supabase.rpc('log_audit_event', {...})`. `user_id` is derived from `auth.uid()` internally — the caller cannot spoof attribution.

### Verified Signature: `finalize_wizard_strategy` pattern (named-parameter RPC)
[VERIFIED: supabase/migrations/031_wizard_source_column.sql]

Key invariants of every SECURITY DEFINER RPC in this codebase:
1. `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`
2. First assertion: `v_auth_uid := auth.uid(); IF v_auth_uid IS NULL THEN RAISE EXCEPTION '...' USING ERRCODE = 'insufficient_privilege'; END IF;`
3. Ownership check: `IF v_auth_uid <> p_user_id THEN RAISE EXCEPTION '...' USING ERRCODE = 'insufficient_privilege'; END IF;`
4. `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;  GRANT EXECUTE ON FUNCTION ... TO authenticated;`
5. Self-verifying DO block in the same migration asserting `prosecdef = TRUE`.

### Recommended `update_allocator_mandates` Signature
[ASSUMED based on codebase patterns; verify with executor before implementation]

The codebase uses **named parameters** (not `jsonb`) in all existing RPCs (`finalize_wizard_strategy`, `create_wizard_strategy`, `send_intro_with_decision`). There is no `p_fields jsonb` precedent. Named parameters keep the whitelist explicit and avoid JSON deserialization inside the RPC.

```sql
CREATE OR REPLACE FUNCTION public.update_allocator_mandates(
  p_max_weight                NUMERIC DEFAULT NULL,
  p_preferred_strategy_types  TEXT[]  DEFAULT NULL,
  p_excluded_exchanges        TEXT[]  DEFAULT NULL,
  p_target_ticket_size_usd    NUMERIC DEFAULT NULL,
  p_mandate_archetype         TEXT    DEFAULT NULL,
  p_correlation_ceiling       NUMERIC DEFAULT NULL,
  p_max_drawdown_tolerance    NUMERIC DEFAULT NULL,  -- "risk_budget" in UI
  p_liquidity_preference      TEXT    DEFAULT NULL,
  p_style_exclusions          TEXT[]  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  -- 1. Auth guard
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'update_allocator_mandates: no auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Bounds validation (mirrors TypeScript validateSelfEditableInput)
  IF p_max_weight IS NOT NULL AND (p_max_weight < 0.05 OR p_max_weight > 0.50) THEN
    RAISE EXCEPTION 'max_weight must be between 0.05 and 0.50'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_correlation_ceiling IS NOT NULL AND (p_correlation_ceiling < 0 OR p_correlation_ceiling > 1) THEN
    RAISE EXCEPTION 'correlation_ceiling must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_drawdown_tolerance IS NOT NULL AND (p_max_drawdown_tolerance < 0 OR p_max_drawdown_tolerance > 1) THEN
    RAISE EXCEPTION 'max_drawdown_tolerance must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_liquidity_preference IS NOT NULL AND p_liquidity_preference NOT IN ('high', 'medium', 'low') THEN
    RAISE EXCEPTION 'liquidity_preference must be high, medium, or low'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_mandate_archetype IS NOT NULL AND length(p_mandate_archetype) > 500 THEN
    RAISE EXCEPTION 'mandate_archetype must be 500 characters or less'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Upsert row
  INSERT INTO allocator_preferences (
    user_id,
    max_weight, preferred_strategy_types, excluded_exchanges,
    target_ticket_size_usd, mandate_archetype,
    correlation_ceiling, max_drawdown_tolerance, liquidity_preference,
    style_exclusions, mandate_edited_at, updated_at
  ) VALUES (
    v_auth_uid,
    p_max_weight, p_preferred_strategy_types, p_excluded_exchanges,
    p_target_ticket_size_usd, p_mandate_archetype,
    p_correlation_ceiling, p_max_drawdown_tolerance, p_liquidity_preference,
    p_style_exclusions, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    max_weight                = COALESCE(EXCLUDED.max_weight,                allocator_preferences.max_weight),
    preferred_strategy_types  = COALESCE(EXCLUDED.preferred_strategy_types,  allocator_preferences.preferred_strategy_types),
    excluded_exchanges        = COALESCE(EXCLUDED.excluded_exchanges,        allocator_preferences.excluded_exchanges),
    target_ticket_size_usd    = COALESCE(EXCLUDED.target_ticket_size_usd,    allocator_preferences.target_ticket_size_usd),
    mandate_archetype         = COALESCE(EXCLUDED.mandate_archetype,         allocator_preferences.mandate_archetype),
    correlation_ceiling       = COALESCE(EXCLUDED.correlation_ceiling,       allocator_preferences.correlation_ceiling),
    max_drawdown_tolerance    = COALESCE(EXCLUDED.max_drawdown_tolerance,    allocator_preferences.max_drawdown_tolerance),
    liquidity_preference      = COALESCE(EXCLUDED.liquidity_preference,      allocator_preferences.liquidity_preference),
    style_exclusions          = COALESCE(EXCLUDED.style_exclusions,          allocator_preferences.style_exclusions),
    mandate_edited_at         = now(),
    updated_at                = now();

  -- 4. Audit
  PERFORM public.log_audit_event(
    'mandate_preference.update',
    'allocator_preference_mandate',
    v_auth_uid,
    jsonb_build_object('source', 'rpc')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_allocator_mandates FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_allocator_mandates TO authenticated;
```

**CRITICAL DESIGN NOTE ON NULL vs OMIT:** Using `DEFAULT NULL` for all params means there is no way to distinguish "caller did not provide this field" from "caller explicitly wants to clear this field to NULL". Two options:

- **Option A (recommended, simpler):** Each auto-save call sends only the one changed field. The RPC uses `COALESCE(EXCLUDED.val, existing.val)` — if the caller sends NULL for a field, the COALESCE silently leaves the existing value. The Reset affordance (D-11) must send an explicit sentinel or use a separate `clear_allocator_mandate_field(p_field_name text)` RPC that is simpler to reason about.
- **Option B (fully typed):** Each field gets a companion `_touched` boolean. More parameters, harder to maintain.

**Planner decision needed (Claude's Discretion, D-11):** Document whether the Reset path calls a second RPC (`clear_allocator_mandate_field`) or the same RPC with a special NULL-sentinel.

**PRACTICAL RECOMMENDATION:** Have the Reset button explicitly call the same PUT /api/preferences route with the field set to `null`. In the RPC, use a different COALESCE strategy — pass `null` explicitly, and the RPC treats a field that was sent (even as null) as "clear this". This requires sending field names along with values. The cleanest approach: the API route calls `supabase.rpc('update_allocator_mandates', { [fieldName]: value })` — for reset, `value` is `null`. In the RPC, use `IS DISTINCT FROM` or track which params are non-missing via a per-field presence parameter.

**Simplest correct implementation for Phase 2 scope:** The UPSERT path uses `EXCLUDED.val IS NOT NULL` guards in the DO UPDATE SET. When the caller explicitly sends `null` for a field (Reset case), the API route should instead call a thin variant `nullify_allocator_mandate_field(p_field text)` — or handle it in the same route/RPC but with an explicit "clear" signal in the JSONB metadata. Planner to choose; the code example above uses COALESCE which means NULL values from the caller are silently ignored (not cleared). For Reset to work, either a different path or a second parameter (`p_clear_fields text[] DEFAULT '{}'`) is needed.

### Error Codes from RPC to Route Handler
[VERIFIED: migration 031, 049, 058 patterns]

| SQLSTATE | ERRCODE constant | When | HTTP response |
|----------|------------------|------|---------------|
| `insufficient_privilege` | `28000` | No auth session or ownership mismatch | 401 |
| `invalid_parameter_value` | `22023` | Validation failure | 400 |
| Any other error | varies | Unexpected DB error | 500 |

Route handler extracts `error.code` from the Supabase response and maps it:
```typescript
if (error.code === '28000') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
if (error.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 });
```

### Audit Integration in RPC vs Route Handler
Two valid options:
1. **Inside the RPC** (as shown above): `PERFORM public.log_audit_event(...)`. Pros: atomic with the write. Cons: `log_audit_event` calls `auth.uid()` — this works because SECURITY DEFINER runs with the *caller's* JWT context (the GUC `auth.uid()` reflects the authenticated user's JWT, not the function owner).
2. **From the route handler** (existing `logAuditEvent()` pattern): fire-and-forget via `after()`. Pros: consistent with all other audit sites. Cons: one additional round-trip.

**Recommendation:** Emit from the route handler using `logAuditEvent(supabase, {...})` (existing pattern). This keeps the RPC focused on data writes and matches every other audit emission site in the codebase. The `audit-coverage.test.ts` meta-test (which greps route.ts files) will catch omissions.

New `AuditAction` values to add to `src/lib/audit.ts`:
```typescript
| "mandate_preference.update"   // allocator self-edit via RPC
| "mandate_preference.admin_update"  // admin direct UPDATE (D-12)
```

New `AuditEntityType` value: `"allocator_preference_mandate"`.

Entity-id: `user.id` (matches existing `notification_preferences.update` precedent — `allocator_preferences` has no standalone UUID PK, uses `user_id`).

---

## Auto-Save-on-Blur Pattern

### Precedents Found
[VERIFIED: src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx]
[VERIFIED: src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx]

**NotesWidget.tsx** — closest analog to Phase 2 auto-save. Uses:
- `debounceRef = useRef<ReturnType<typeof setTimeout>>()` + `clearTimeout` + `setTimeout(save, 1000)` on `onChange`
- `SaveState = "idle" | "saving" | "saved" | "error"` discriminated union
- `aria-live="polite"` span below the textarea for status text
- Flush-on-unmount pattern

**WizardChrome.tsx** — closest analog to "Progress saved" inline toast:
- `toastKey` integer incremented on each save triggers a `useEffect` that shows the toast for 2 seconds
- Inline `role="status" aria-live="polite"` div positioned absolutely over the form
- No external toast library — pure React state + CSS

### "Toast" for Phase 2: No Library Required
[VERIFIED: UI-SPEC.md §Component Inventory — "No new dependencies. The 'toast' language from D-16 maps to the MandateSaveStatus inline aria-live region — identical pattern to OutcomeRecordedRow's inline success marker in Phase 1."]

The `PreferenceForm.tsx` deletion removes its submit button entirely. The "Mandate saved" feedback is an **inline status region**, not a global toast. Pattern:
```tsx
// In MandateForm (client component)
const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
const [lastSavedAt, setLastSavedAt] = useState<Date | null>(mandateEditedAt);

// On successful save:
setSaveStatus("saved");
setLastSavedAt(new Date());
setTimeout(() => setSaveStatus("idle"), 2000);
```

Status region (matches WizardChrome pattern):
```tsx
<div
  role="status"
  aria-live="polite"
  className="text-xs text-text-muted font-metric"
>
  {saveStatus === "saved" && (
    <span>
      <span className="text-accent" aria-hidden="true">{"\u2713"}</span>{" "}
      Mandate saved
    </span>
  )}
  {saveStatus === "idle" && lastSavedAt && (
    <span>Last saved: {formatRelativeTime(lastSavedAt)}</span>
  )}
  {saveStatus === "idle" && !lastSavedAt && (
    <span>Not saved yet</span>
  )}
</div>
```

### `useMandateAutoSave` Hook Shape
[ASSUMED — no existing hook in codebase; derived from NotesWidget + WizardChrome patterns]

```typescript
// src/components/mandate/useMandateAutoSave.ts
export function useMandateAutoSave(fieldName: string, value: unknown, enabled: boolean) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaveState("saving");
    setErrorMessage(null);
    const res = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [fieldName]: value }),
    });
    if (res.ok) {
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorMessage(data.error ?? "Couldn't save.");
      setSaveState("error");
    }
  }, [fieldName, value]);

  // Trigger on blur for text/number inputs (caller calls save() from onBlur)
  // Trigger on toggle for chips (caller calls save() immediately on toggle)
  // Trigger on pointerup for sliders (caller calls save() from onPointerUp)
  return { saveState, errorMessage, save };
}
```

**Slider coalescing for rapid drags (Claude's Discretion):** The UI-SPEC specifies save on `pointerup`/`touchend`/`keyup`. No debounce is needed for the RPC call itself — each gesture produces exactly one save event. The hook should track a `pendingValue` ref to handle rapid keyboard arrow-key increments:

```typescript
// Coalesce rapid keyboard increments: 300ms debounce ONLY for keyboard events
const keyDebounceRef = useRef<ReturnType<typeof setTimeout>>();
function handleKeyUp() {
  clearTimeout(keyDebounceRef.current);
  keyDebounceRef.current = setTimeout(save, 300);
}
```

---

## Schema Changes

### Migration File: `supabase/migrations/061_mandate_columns.sql`
[VERIFIED: Migration 060 is the last applied migration (bridge_outcome_cron). Next slot is 061.]

#### New Columns on `allocator_preferences`

| Column | Type | Default | Constraint | Notes |
|--------|------|---------|------------|-------|
| `max_weight` | `NUMERIC` | `NULL` | none | D-07; 0.05–0.50 enforced at app layer |
| `correlation_ceiling` | `NUMERIC` | `NULL` | none | D-07 |
| `liquidity_preference` | `TEXT` | `NULL` | `CHECK (liquidity_preference IN ('high','medium','low'))` | D-05 |
| `style_exclusions` | `TEXT[]` | `NULL` | none | D-04; subset of SUBTYPES constant |
| `mandate_edited_at` | `TIMESTAMPTZ` | `NULL` | none | D-08; NULL on first-visit; set by RPC on every allocator write |

**NOT adding `risk_budget`:** Per D-06, the column `max_drawdown_tolerance` already exists. The UI label "Max drawdown tolerance" (from UI-SPEC §Copywriting) is used for the field labeled `risk_budget` in requirements. No column addition, no migration change needed for this field — only the TypeScript whitelist and RPC need to include it.

**NOT adding `preferred_strategy_types`:** This column already exists (migration 011). It is admin-only in v1; Phase 2 promotes it to self-editable by adding it to `SELF_EDITABLE_PREFERENCE_FIELDS` in `preferences.ts`.

**Backfill notes:** All new columns are nullable with no default. NULL rows on first visit are expected (D-09). No backfill migration required.

#### SQL Template
[VERIFIED: patterns from migrations 031, 037, 049]

```sql
BEGIN;

ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS max_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS correlation_ceiling NUMERIC,
  ADD COLUMN IF NOT EXISTS liquidity_preference TEXT,
  ADD COLUMN IF NOT EXISTS style_exclusions TEXT[],
  ADD COLUMN IF NOT EXISTS mandate_edited_at TIMESTAMPTZ;

ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_liquidity_preference_check;

ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_liquidity_preference_check
    CHECK (liquidity_preference IN ('high', 'medium', 'low'));

-- update_allocator_mandates RPC (SECURITY DEFINER) goes here ...

-- Self-verifying DO block (assertions on columns + RPC + SECURITY DEFINER status) ...

COMMIT;
```

### RLS Policy Impact: NO CHANGE REQUIRED
[VERIFIED: migration 011 lines 240–253]

The existing RLS policies on `allocator_preferences` cover all operations at the *row* level:
- `allocator_prefs_self_read` — owner SELECT
- `allocator_prefs_self_insert` — owner INSERT WITH CHECK (user_id = auth.uid())
- `allocator_prefs_self_update` — owner UPDATE
- `allocator_prefs_admin_all` — admin all
- `allocator_prefs_service_all` — service_role all

Since `update_allocator_mandates` runs as SECURITY DEFINER (postgres/table-owner role), it bypasses RLS entirely. The allocator cannot directly UPDATE `allocator_preferences` to write mandate fields — the SECURITY DEFINER RPC is the only path. The existing `allocator_prefs_self_update` policy technically allows direct UPDATE by the owner, but MANDATE-06 is satisfied by convention + the API route enforcing the RPC path. The planner may choose to add a trigger blocking direct owner updates to mandate-specific columns for defense-in-depth, but this is not required.

**CRITICAL:** Phase 2 does NOT add, modify, or drop any RLS policy. The migration adds columns and the new RPC only.

---

## Admin Parity

### `PreferencesPanel.tsx` Extension
[VERIFIED: src/components/admin/PreferencesPanel.tsx — current file read above]

New state variables to add (lines 34–58 pattern):
```typescript
const [maxWeight, setMaxWeight] = useState<string>(
  preferences?.max_weight != null ? String(preferences.max_weight) : "",
);
const [correlationCeiling, setCorrelationCeiling] = useState<string>(
  preferences?.correlation_ceiling != null ? String(preferences.correlation_ceiling) : "",
);
// max_drawdown_tolerance already exists as `maxDD` state (line 34)
const [liquidityPreference, setLiquidityPreference] = useState<string>(
  preferences?.liquidity_preference ?? "",
);
const [styleExclusions, setStyleExclusions] = useState<string[]>(
  preferences?.style_exclusions ?? [],
);
```

Body additions to `body` object (line 108 pattern):
```typescript
max_weight: parseNum(maxWeight),
correlation_ceiling: parseNum(correlationCeiling),
// max_drawdown_tolerance already in body via `maxDD`
liquidity_preference: liquidityPreference || null,
style_exclusions: styleExclusions,
```

**"Last edited by" indicator (D-14):**
The admin panel receives `preferences` which currently has `edited_by_user_id` + `updated_at`. Phase 2 adds `mandate_edited_at`. Admin panel should display:
```tsx
{preferences?.mandate_edited_at && (
  <p className="text-xs text-text-muted font-metric">
    Mandate last edited by:{" "}
    {preferences.edited_by_user_id === null ? "allocator" : "admin"}{" "}
    · {new Date(preferences.mandate_edited_at).toLocaleDateString()}
  </p>
)}
```

`edited_by_user_id = NULL` means the allocator wrote via RPC (which sets `edited_by_user_id = NULL`). `edited_by_user_id = <some uuid>` means an admin wrote directly.

### `pickAdminEditableFields` Extension
[VERIFIED: src/lib/preferences.ts lines 77–84]

```typescript
// Add to ADMIN_ONLY_PREFERENCE_FIELDS (NOTE: max_weight, preferred_strategy_types,
// correlation_ceiling, liquidity_preference, style_exclusions are now SELF_EDITABLE;
// admin can ALSO edit them via the expanded union in pickAdminEditableFields)
```

The `pickAdminEditableFields` function iterates both `SELF_EDITABLE_PREFERENCE_FIELDS` and `ADMIN_ONLY_PREFERENCE_FIELDS`. The new mandate fields belong in `SELF_EDITABLE_PREFERENCE_FIELDS` (per D-03 + D-04 + D-05 + D-07). `pickAdminEditableFields` picks everything, so admin access is automatic once the fields are in `SELF_EDITABLE_PREFERENCE_FIELDS`.

### `ALLOCATOR_PREFERENCES_COLUMNS` Update
[VERIFIED: src/lib/admin/match.ts lines 34–38]

Current value:
```typescript
const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, updated_at";
```

Phase 2 must extend to:
```typescript
const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, edited_by_user_id, updated_at, " +
  // Phase 2 mandate fields
  "max_weight, correlation_ceiling, liquidity_preference, style_exclusions, mandate_edited_at";
```

Note: `edited_by_user_id` is referenced in the admin parity D-14 implementation but is NOT currently in `ALLOCATOR_PREFERENCES_COLUMNS`. The smoke test (MANDATE-07) will verify the constant matches `information_schema.columns`. Since `edited_by_user_id` was already in the table since migration 011, add it to the constant in the same PR (it was missing — this is a MANDATE-07 correction, not a new addition).

---

## Validation + Smoke Test Contract

### `preferences.test.ts` Schema-Sync Pattern
[VERIFIED: src/lib/preferences.test.ts — validated via inspection; the file does NOT currently contain a schema-sync smoke test. The smoke test described in MANDATE-07 must be created.]

**IMPORTANT FINDING:** The current `preferences.test.ts` contains only unit tests for pure helper functions (`SELF_EDITABLE_PREFERENCE_FIELDS`, `pickSelfEditableFields`, `validateSelfEditableInput`, etc.). There is NO existing smoke test against `information_schema.columns`. MANDATE-07 requires creating one.

The smoke test pattern for live-DB column existence is established in `src/__tests__/` (e.g., `audit-log-rls.test.ts`). The MANDATE-07 smoke test belongs in `src/__tests__/mandate-columns-schema-sync.test.ts`.

### Schema-Sync Smoke Test Template
[VERIFIED: live-DB pattern from TESTING.md + Phase 1 PATTERNS.md]

```typescript
// src/__tests__/mandate-columns-schema-sync.test.ts
import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
// Import the constant under test
import { ALLOCATOR_PREFERENCES_COLUMNS } from "@/lib/admin/match";

const EXPECTED_COLUMNS = ALLOCATOR_PREFERENCES_COLUMNS.split(",").map((c) => c.trim());

describe("MANDATE-07: ALLOCATOR_PREFERENCES_COLUMNS schema sync", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "every column in ALLOCATOR_PREFERENCES_COLUMNS exists in information_schema",
    async () => {
      const admin = createLiveAdminClient();
      const { data, error } = await admin
        .from("information_schema.columns")  // Note: PostgREST cannot query information_schema directly
        .select("column_name")
        .eq("table_schema", "public")
        .eq("table_name", "allocator_preferences");
      // Alternative: use admin.rpc or raw SQL via supabase-py
    },
    60_000,
  );
});
```

**PITFALL:** PostgREST (Supabase client) cannot query `information_schema` directly — it requires a service-role RPC or a raw Postgres query. The correct pattern for the smoke test is to execute raw SQL:

```typescript
const { data, error } = await admin.rpc("sql", {
  query: `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'allocator_preferences'
    ORDER BY column_name`
});
```

However, `admin.rpc("sql", ...)` is not a standard Supabase RPC. The canonical approach used in this codebase is a service-role raw query via `admin.from().select()` with a PostgREST function, OR — most simply — write the smoke test as a plain `vitest` test that imports the constant and checks it's a non-empty string with expected substrings. The live-DB assertion is secondary; the primary value of MANDATE-07 is that the TypeScript constant is updated in the same PR as the migration.

**Alternative smoke test approach (no live DB needed):**
```typescript
it("ALLOCATOR_PREFERENCES_COLUMNS includes all Phase 2 mandate fields", () => {
  const cols = ALLOCATOR_PREFERENCES_COLUMNS;
  expect(cols).toContain("max_weight");
  expect(cols).toContain("correlation_ceiling");
  expect(cols).toContain("liquidity_preference");
  expect(cols).toContain("style_exclusions");
  expect(cols).toContain("mandate_edited_at");
});
```

**Recommended:** combine both — static assertion (always runs, CI-safe) + live-DB assertion (gated on `HAS_LIVE_DB`).

### `HAS_SEEDED_SUPABASE` Gating Contract
[VERIFIED: e2e/bridge-outcome.spec.ts lines 14–19]

```typescript
// E2E test guards
test.describe.configure({ mode: "serial" });
// Skip block when env is not available:
test.skip(
  !process.env.HAS_SEEDED_SUPABASE || 
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY,
  "requires HAS_SEEDED_SUPABASE=1 and live Supabase credentials"
);
```

Phase 1 E2E provisions its own allocator per test via `admin.auth.admin.createUser()` to avoid shared-state flakiness. Phase 2 should follow the same pattern.

---

## Next.js 16 Route Handler

### Verified App Router Patterns
[VERIFIED: src/lib/supabase/server.ts, src/proxy.ts, src/app/api/preferences/route.ts, STACK.md]

**Middleware rename:** `middleware.ts` → `src/proxy.ts` (Next 16). Do not rename back. [VERIFIED: CONVENTIONS.md, STACK.md]

**`cookies()` is async in Next 16:** [VERIFIED: src/lib/supabase/server.ts line 4 — `const cookieStore = await cookies()`]

**`params` are async in Next 16:** [VERIFIED: CONVENTIONS.md — "Dynamic route params are awaited (Next 16 async params)"]

**No `"use server"` directives:** [VERIFIED: CONVENTIONS.md — "Server Actions (`'use server'`): Not used in this codebase."]

### Rewritten PUT /api/preferences Route Shape
[VERIFIED: existing route at src/app/api/preferences/route.ts + CONVENTIONS.md route handler pattern]

The Phase 2 rewrite of `PUT /api/preferences`:

```typescript
// src/app/api/preferences/route.ts (rewrite)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { validateSelfEditableInput, pickSelfEditableFields } from "@/lib/preferences";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

export async function PUT(req: NextRequest): Promise<NextResponse> {
  // 1. CSRF
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // 2. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 3. Rate limit
  const rl = await checkLimit(userActionLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // 4. Parse body
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  // 5. Whitelist + validate
  const fields = pickSelfEditableFields(body);
  const validationError = validateSelfEditableInput(fields);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // 6. Call RPC (not direct upsert)
  const { error } = await supabase.rpc("update_allocator_mandates", {
    // Only pass the fields that are present in `fields`
    ...fields,
  });

  if (error) {
    console.error("[api/preferences] RPC error:", error);
    if (error.code === "28000") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to save mandate" }, { status: 500 });
  }

  // 7. Audit (fire-and-forget)
  logAuditEvent(supabase, {
    action: "mandate_preference.update",
    entity_type: "allocator_preference_mandate",
    entity_id: user.id,
    metadata: { fields: Object.keys(fields) },
  });

  return NextResponse.json({ success: true });
}
```

**Note on RPC parameter spreading:** When calling `supabase.rpc("update_allocator_mandates", { ...fields })`, only the keys present in `fields` are sent. Supabase-js serializes the object as named parameters. The RPC uses `DEFAULT NULL` for all params — params not passed will use their defaults.

**CSRF Gap:** The existing `PUT /api/preferences` already has `assertSameOrigin(req)` (verified in route.ts line 29). The Phase 2 rewrite keeps this.

**GET handler:** The existing GET handler (`GET /api/preferences`) can remain unchanged as it only reads from `allocator_preferences`. The page server component (`preferences/page.tsx`) calls `getOwnPreferences()` directly — the GET route is available for client-side re-fetches.

### Error Response Shape
[VERIFIED: adr-0018-error-handling.md §Pattern C + CONVENTIONS.md §API Response Shape]

```typescript
// Error: { error: string }
// Success: { success: true }
// Validation error: { error: string }  (no Zod issues array for simple validation)
```

---

## Toast + UI Integration

### No New Toast Library
[VERIFIED: UI-SPEC.md §Component Inventory — "No new external dependencies. No new @radix-ui/*, no react-aria, no sonner, no react-hot-toast."]

**"Toast" in Phase 2 = inline aria-live region.** Not a global portal toast. The `MandateSaveStatus` component (per UI-SPEC naming) is a React state-driven `role="status" aria-live="polite"` div placed at the top of the form card.

**Existing toast precedents:**
1. `WizardChrome.tsx` — `role="status" aria-live="polite"` inline div, 2-second display, no library
2. `OutcomeRecordedRow.tsx` — inline `"\u2713"` (checkmark, `text-accent`) confirmation, no library
3. `UndoToast.tsx` — `role="alert" aria-live="assertive"` fixed div, 10-second auto-dismiss, no library

Phase 2 uses pattern 1/2 (not `role="alert"` — save success is polite, not assertive).

### Toast Provider
No global toast provider is mounted in `src/app/layout.tsx`. The Phase 2 inline status region is colocated with the form component. No layout changes needed.

### Save Status Data Flow
```
MandateForm (client component)
  └── MandateSaveStatus (sub-component or inline)
        state: { status: "idle"|"saving"|"saved"|"error", lastSavedAt: Date|null }
        aria-live="polite"
        content: "Not saved yet" | "Last saved: N min ago" | "Mandate saved ✓" | "Couldn't save."
```

"Last saved: N min ago" format:
- < 60s: "Last saved: just now"
- 60s–59min: "Last saved: {n} min ago"
- 1hr–23hr: "Last saved: {n} hr ago"
- ≥24hr: "Last saved: {YYYY-MM-DD}"

A pure `formatRelativeTime(date: Date): string` utility in `src/lib/utils.ts` or inline in `MandateForm` — no new module needed.

---

## Test Strategy

### Unit Tests (Vitest, always run, no live DB)

| File | Tests | Covers |
|------|-------|--------|
| `src/lib/preferences.test.ts` (extend) | validateSelfEditableInput with new fields | D-17 bounds for max_weight, correlation_ceiling, max_drawdown_tolerance, liquidity_preference, style_exclusions, preferred_strategy_types |
| `src/__tests__/mandate-columns-schema-sync.test.ts` (new) | ALLOCATOR_PREFERENCES_COLUMNS contains all new columns | MANDATE-07 |
| `src/app/api/preferences/route.test.ts` (extend or new) | PUT → RPC called; 401 on no auth; 400 on validation; 429 on rate-limit | MANDATE-05, MANDATE-08 (audit emission) |

### Integration Tests (Vitest, `HAS_LIVE_DB` gated)

| File | Tests | Covers |
|------|-------|--------|
| `src/__tests__/update-allocator-mandates-rpc.test.ts` (new) | RPC succeeds for authenticated user; RPC fails for unauthenticated call; validation errors return SQLSTATE 22023; audit row created in audit_log | MANDATE-05, MANDATE-06, MANDATE-08 |

### E2E Tests (Playwright, `HAS_SEEDED_SUPABASE` gated)

| File | Tests | Covers |
|------|-------|--------|
| `e2e/mandate-form.spec.ts` (new) | Load /preferences page → fields visible → blur on max_weight input → "Mandate saved" indicator appears → revisit page → value persists | MANDATE-01, MANDATE-04 |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (unit + route handler + integration) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test -- --reporter verbose src/lib/preferences.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MANDATE-01 | max_weight slider saves correctly, out-of-range rejected | unit | `npm test -- src/lib/preferences.test.ts` | ❌ extend existing |
| MANDATE-02 | preferred_strategy_types + excluded_exchanges self-editable | unit | `npm test -- src/lib/preferences.test.ts` | ❌ extend existing |
| MANDATE-03 | correlation_ceiling, risk_budget, liquidity_preference, style_exclusions save | unit + integration | `npm test -- src/lib/preferences.test.ts src/__tests__/update-allocator-mandates-rpc.test.ts` | ❌ Wave 0 |
| MANDATE-04 | Auto-save on blur — "Mandate saved" indicator appears | E2E | `npm run test:e2e -- e2e/mandate-form.spec.ts` | ❌ Wave 0 |
| MANDATE-05 | All allocator writes go through `update_allocator_mandates` RPC | route test + integration | `npm test -- src/app/api/preferences/route.test.ts` | ❌ Wave 0 |
| MANDATE-06 | Direct UPDATE remains admin-only | integration (live-DB RLS) | `npm test -- src/__tests__/update-allocator-mandates-rpc.test.ts` | ❌ Wave 0 |
| MANDATE-07 | ALLOCATOR_PREFERENCES_COLUMNS schema sync | unit (static) + integration (live-DB) | `npm test -- src/__tests__/mandate-columns-schema-sync.test.ts` | ❌ Wave 0 |
| MANDATE-08 | Every update audit-logged with entity_type='allocator_preference_mandate' | route test (mock) | `npm test -- src/app/api/preferences/route.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/lib/preferences.test.ts`
- **Per wave merge:** `npm test` (full Vitest suite)
- **Phase gate:** Full Vitest suite green + Playwright mandate-form spec green (if HAS_SEEDED_SUPABASE available) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/app/api/preferences/route.test.ts` — route handler test for PUT; covers MANDATE-05, MANDATE-08
- [ ] `src/__tests__/mandate-columns-schema-sync.test.ts` — schema sync test; covers MANDATE-07
- [ ] `src/__tests__/update-allocator-mandates-rpc.test.ts` — live-DB RPC test; covers MANDATE-05, MANDATE-06
- [ ] `e2e/mandate-form.spec.ts` — E2E; covers MANDATE-01, MANDATE-04
- [ ] `src/lib/preferences.test.ts` extensions — validation tests for new fields

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase JWT via `supabase.auth.getUser()` in route handler + `auth.uid()` inside SECURITY DEFINER RPC |
| V3 Session Management | no | Handled globally by `src/proxy.ts` and Supabase SSR |
| V4 Access Control | yes | SECURITY DEFINER RPC with `auth.uid()` owner check; admin direct UPDATE gated by `withAdminAuth` wrapper |
| V5 Input Validation | yes | `validateSelfEditableInput()` (TypeScript, client+server), RAISE EXCEPTION in RPC, Zod parse on admin route |
| V6 Cryptography | no | No new cryptographic operations |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Horizontal privilege escalation (allocator writes another user's mandate) | Spoofing | SECURITY DEFINER RPC uses `auth.uid()` — client cannot pass a different `user_id` |
| Direct UPDATE to `allocator_preferences` bypassing RPC | Tampering | RLS `allocator_prefs_self_update` exists but allows direct UPDATE; mitigation is API layer enforcing RPC-only path + admin-only for direct UPDATE (MANDATE-06) |
| Parameter injection via RPC args | Tampering | Named parameters (not dynamic SQL); Postgres parameterized call via supabase-js |
| Audit spoofing (fake entity_type) | Repudiation | `log_audit_event` called from route handler with hardcoded `"allocator_preference_mandate"` string — no user input in entity_type |
| CSRF on PUT /api/preferences | Tampering | `assertSameOrigin(req)` (existing, verified in route.ts line 29) |
| Rate-limit bypass | DoS | `userActionLimiter` via Upstash; graceful degradation if Redis unavailable |

---

## Pitfalls

### Pitfall 1: NULL vs Clear Semantics in UPSERT RPC
**What goes wrong:** The RPC uses `COALESCE(EXCLUDED.field, allocator_preferences.field)` — sending `null` for a field does NOT clear it; it silently retains the existing value. The Reset affordance (D-11) requires explicitly clearing a field to NULL.
**Why it happens:** Standard COALESCE upsert pattern ignores NULL inputs as "not provided."
**How to avoid:** Either (a) add a `p_clear_fields text[]` parameter to list field names to set NULL, or (b) write a separate `clear_allocator_mandate_field(p_field text)` RPC for the Reset path.
**Warning signs:** Reset button appears to do nothing (field retains value after Reset click).

### Pitfall 2: `ALLOCATOR_PREFERENCES_COLUMNS` Diverges from Schema
**What goes wrong:** Migration 061 adds five columns. If `ALLOCATOR_PREFERENCES_COLUMNS` in `src/lib/admin/match.ts` is not updated in the same PR, the admin match queue silently omits new columns from the PreferencesPanel payload.
**Why it happens:** The constant is a hand-maintained string, not derived from schema.
**How to avoid:** Update `ALLOCATOR_PREFERENCES_COLUMNS` in the same task/wave that applies migration 061. The MANDATE-07 smoke test is the backstop.
**Warning signs:** Admin PreferencesPanel shows blank for `max_weight`, `correlation_ceiling`, etc. even after a write.

### Pitfall 3: `preferred_strategy_types` Already Admin-Only in Validation
**What goes wrong:** `ADMIN_ONLY_PREFERENCE_FIELDS` contains `"preferred_strategy_types"`. If only `SELF_EDITABLE_PREFERENCE_FIELDS` is extended (D-03) but `ADMIN_ONLY_PREFERENCE_FIELDS` is not pruned, `pickAdminEditableFields` will accidentally include the field twice (once from each array's iteration). The whitelist function iterates `[...SELF_EDITABLE, ...ADMIN_ONLY]` so duplication in output won't cause errors — but the type definitions will be misleading.
**How to avoid:** Move `preferred_strategy_types` from `ADMIN_ONLY_PREFERENCE_FIELDS` to `SELF_EDITABLE_PREFERENCE_FIELDS`. Confirm `validateSelfEditableInput` is extended to validate it.

### Pitfall 4: `/recommendations/page.tsx` Links to `/preferences` with Old Copy
**What goes wrong:** `src/app/(dashboard)/recommendations/page.tsx` has two links to `/preferences` (lines 206 + 238). The page description on line 24 says "no mandate → CTA to /preferences". The route stays `/preferences` (D-01) so the links do not break. BUT the description text on recommendations/page.tsx references "allocator_preferences row" — after Phase 2, the CTA copy should ideally say "My Allocation Settings" instead of the generic text.
**Impact:** Low — the route doesn't break. This is a cosmetic update.
**Warning signs:** CTA text on recommendations page still says "Preferences" instead of "My Allocation Settings".

### Pitfall 5: `PreferenceForm.tsx` Import in `preferences/page.tsx`
**What goes wrong:** Deleting `PreferenceForm.tsx` (D-02) without updating `preferences/page.tsx` causes an import error at build time.
**File to update:** `src/app/(dashboard)/preferences/page.tsx` line 3: `import { PreferenceForm } from "@/components/preferences/PreferenceForm";`
**How to avoid:** Delete `PreferenceForm.tsx` and update `preferences/page.tsx` in the same commit.

### Pitfall 6: `max_weight` Column Does NOT Yet Exist
**What goes wrong:** The `AllocatedForm.tsx` file (Phase 1) has a comment `/** Allocator's Phase 2 max_weight — soft-warn only (D-09). */` referencing a `max_weight` prop, but the actual column `max_weight` does not exist in `allocator_preferences` yet. Migration 011 added `max_drawdown_tolerance` but not `max_weight`.
**Verified:** grep of all migrations for `max_weight` returns no results. Migration 061 must ADD this column.
**Warning signs:** `supabase.rpc("update_allocator_mandates", { max_weight: 0.25 })` fails with "column max_weight does not exist" if migration 061 has not been applied.

### Pitfall 7: Audit-Coverage Meta-Test Will Fail
**What goes wrong:** `src/__tests__/audit-coverage.test.ts` greps every `route.ts` mutation file for `logAuditEvent` within 60 lines of a `.upsert`/`.from(...)` mutation. The rewritten `PUT /api/preferences/route.ts` will be scanned. If `logAuditEvent` is not present or is preceded by an `@audit-skip:` pragma, the meta-test fails.
**How to avoid:** Ensure `logAuditEvent(supabase, {...})` is called within 60 lines of the `supabase.rpc("update_allocator_mandates", ...)` call. The `action: "mandate_preference.update"` literal must be in the `AuditAction` union in `src/lib/audit.ts` at build time.

### Pitfall 8: `style_exclusions text[]` Default NULL — No Backfill Needed
**Verified:** All existing `allocator_preferences` rows have `style_exclusions = NULL` after migration 061 (column added with no default). The scoring engine (Phase 3) treats `NULL` as "no filter" (SCORING-04 graceful degradation). No backfill required.

### Pitfall 9: Sidebar Does NOT Link to `/preferences`
**Verified:** `src/components/layout/Sidebar.tsx` allocator workspace items are: My Allocation, Connections, Scenarios, Recommendations. No `/preferences` link in the sidebar. The `/preferences` route is linked from:
1. `src/app/(dashboard)/recommendations/page.tsx` (lines 206, 238) — two CTAs
These links continue to work after Phase 2 (D-01: route stays at `/preferences`).

---

## Open Questions for Planner

1. **Reset / Clear Semantics (Directly affects RPC design)**
   - What we know: D-11 requires per-field Reset → NULL via same auto-save path. The COALESCE upsert pattern ignores NULL inputs.
   - What's unclear: Should Reset call a separate `clear_allocator_mandate_field(p_field text)` RPC, or should the main RPC accept a `p_clear_fields text[]` parameter? Or should the route handler call `supabase.from("allocator_preferences").update({ [field]: null })` directly for the Reset path only, bypassing the RPC (which would conflict with MANDATE-05)?
   - Recommendation: Add `p_clear_fields text[] DEFAULT '{}'` to `update_allocator_mandates`. The RPC explicitly sets each named field in `p_clear_fields` to NULL regardless of the corresponding parameter value. This keeps a single RPC as the exclusive allocator write path.

2. **`max_weight` Not Yet in `allocator_preferences` — Confirm Migration 061 adds it**
   - What we know: No migration adds `max_weight` to `allocator_preferences`. The column was referenced in Phase 1 planning docs but not shipped.
   - What's unclear: Should migration 061 be named `061_mandate_columns.sql` or is there a numbering gap to fill?
   - Recommendation: `061_mandate_columns.sql` is the next free slot (confirmed by `ls` of migrations directory).

3. **`AuditAction` Union Extension — New action name**
   - Recommendation: `"mandate_preference.update"` for allocator RPC path; `"mandate_preference.admin_update"` for admin direct UPDATE. These follow the existing `<subject>.<verb>` taxonomy.
   - Planner must add these to `src/lib/audit.ts` and to ADR-0023 in the same PR.

4. **Admin audit action distinction**
   - D-12 says both allocator and admin paths call `log_audit_event` with `entity_type = 'allocator_preference_mandate'`. Do we differentiate by action string (`mandate_preference.update` vs `mandate_preference.admin_update`) or by metadata? Recommendation: different action strings, same entity_type.

5. **`preferred_strategy_types` validation whitelist**
   - D-03 promotes this field to self-editable. Current `validateSelfEditableInput` does NOT validate it (it's admin-only). The new validation must check array values are subset of `STRATEGY_TYPES` from `constants.ts`. This is a new validation branch in `validateSelfEditableInput`.

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/011_perfect_match.sql` — `allocator_preferences` schema + RLS policies (verified)
- `supabase/migrations/031_wizard_source_column.sql` — SECURITY DEFINER RPC pattern (verified)
- `supabase/migrations/049_audit_log_hardening.sql` — `log_audit_event` signature (verified)
- `supabase/migrations/058_log_audit_event_service.sql` — service-role audit pattern (verified)
- `src/lib/preferences.ts` — existing types, validation, whitelist arrays (verified)
- `src/lib/admin/match.ts` — `ALLOCATOR_PREFERENCES_COLUMNS` constant (verified)
- `src/components/preferences/PreferenceForm.tsx` — to-be-deleted form (verified)
- `src/components/admin/PreferencesPanel.tsx` — admin panel to extend (verified)
- `src/app/api/preferences/route.ts` — PUT route to rewrite (verified)
- `src/app/(dashboard)/preferences/page.tsx` — page wrapper to update (verified)
- `src/lib/constants.ts` — SUBTYPES (8 values), STRATEGY_TYPES (7 values), EXCHANGES (3 values) (verified)
- `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` — auto-save pattern (verified)
- `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` — inline toast pattern (verified)
- `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx` — checkmark glyph pattern (verified)
- `e2e/bridge-outcome.spec.ts` — HAS_SEEDED_SUPABASE gating contract (verified)
- `.planning/codebase/STACK.md` — Next.js 16 version, Vitest 4.1.2, Playwright 1.59 (verified)
- `.planning/codebase/TESTING.md` — test patterns, live-DB gate, HAS_LIVE_DB contract (verified)
- `.planning/codebase/CONVENTIONS.md` — route handler shape, audit emission pattern (verified)
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth (verified)
- `docs/architecture/adr-0004-mutation-api-contract.md` — mutation contract (verified)
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — AuditAction enum, entity_type mapping (verified)
- `docs/architecture/adr-0018-error-handling.md` — error response shape (verified)
- `src/components/layout/Sidebar.tsx` — no /preferences link in sidebar (verified)
- `src/app/(dashboard)/recommendations/page.tsx` — /preferences CTA links (verified)
- `ls supabase/migrations/` — last migration is 060; next slot is 061 (verified)

### Secondary (MEDIUM confidence)
- `node_modules/next/dist/docs/01-app/02-guides/forms.md` — Server Actions are the documented mutation pattern in Next.js 16 docs, but CONVENTIONS.md explicitly prohibits them in this codebase

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified against live codebase
- Architecture: HIGH — SECURITY DEFINER RPC shape verified against 3 existing RPCs; auto-save pattern verified against 2 existing components
- Pitfalls: HIGH for schema pitfalls (grep-verified); MEDIUM for RPC null-semantics pitfall (inferred from COALESCE pattern)
- Schema: HIGH — migration 011 read verbatim; column list verified
- Test patterns: HIGH — verified against Phase 1 PATTERNS.md and live test files

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days; stable stack)

---

## RESEARCH COMPLETE
