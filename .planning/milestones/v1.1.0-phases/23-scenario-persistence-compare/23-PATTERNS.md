# Phase 23: Scenario Persistence & Compare - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 14 (new + modified)
**Analogs found:** 14 / 14 (every file has a verified in-repo analog — this phase is pure wiring of existing primitives)

> Every analog below was opened and read on 2026-06-21; excerpts carry file:line. RESEARCH.md §Sources named most of them; this map verifies each and pins the exact lines the executor mirrors. No file in this phase needs a RESEARCH.md fallback.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_scenarios_table_and_rls.sql` | migration | CRUD (DDL) | `20260405061912_rls_policies.sql:22` (`api_keys_owner`) + `20260405061911_initial_schema.sql:19` (`api_keys` CREATE TABLE) | exact (role + flow) |
| `supabase/migrations/down/<ts>-rollback.sql` | migration | CRUD (DDL) | `supabase/migrations/down/20260620120000-rollback.sql` (naming) | exact |
| `supabase/tests/test_scenarios_rls.sql` | test | CRUD (RLS assertion) | `supabase/tests/test_funding_fees_rls.sql` | exact |
| `src/lib/database.types.ts` (MOD: add `scenarios` block) | config (generated types) | — | `database.types.ts:1021-1097` (`for_quants_leads` HAND-PATCHED block) | exact |
| `src/lib/database.types.test.ts` (MOD: pin `scenarios` columns) | test | — | `database.types.test.ts:12-25` (`expectTypeOf` pattern) | exact |
| `src/__tests__/critical-regressions.test.ts` (verify `[#14]` intact) | test | — | `critical-regressions.test.ts:54-101` (`[#14]` block) | exact (no edit needed; preserve) |
| `src/app/api/allocator/scenario/saved/route.ts` (GET list, POST create) | route | request-response / CRUD | `src/app/api/allocator/scenario/commit/route.ts` | exact (role) / role-match (single-row vs batch-RPC) |
| `src/app/api/allocator/scenario/saved/[id]/route.ts` (PATCH/PUT/DELETE) | route | request-response / CRUD | `src/app/api/allocator/scenario/commit/route.ts` | role-match |
| `…/scenario/saved/route.test.ts` + `[id]/route.test.ts` | test | — | `src/app/api/allocator/scenario/commit/route.test.ts` | exact |
| `src/app/(dashboard)/allocations/lib/scenario-compare.ts` | utility (pure) | transform | `src/lib/scenario.ts` (`computeScenario`) + `ScenarioComposer.tsx:460-630` adapter chain | role-match (extracts existing chain) |
| `…/allocations/lib/scenario-compare.test.ts` | test | — | `src/lib/scenario.test.ts` | role-match |
| `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` (MOD: add `hydrateFromSaved`) | hook | event-driven (one-shot) | its own `reset`/`setValue`/`baseOf` wiring (`useScenarioState.ts:202-237`) | exact (self-pattern) |
| `…/allocations/components/SavedScenariosList.tsx` | component | CRUD (list + manage) | `EmptyStateCard.tsx` + composer list-row shell (`ScenarioComposer.tsx:1386`) | role-match |
| `…/allocations/components/ScenarioCompareTable.tsx` | component | transform (render grid) | `src/components/strategy/CompareTable.tsx` | exact |
| `…/allocations/components/ScenarioComposer.tsx` (MOD: Save/Update toolbar) | component | event-driven | `ScenarioComposer.tsx:993` toolbar header (`flex flex-wrap items-center gap-3`) | exact (self-pattern) |

---

## Pattern Assignments

### `supabase/migrations/<ts>_scenarios_table_and_rls.sql` (migration, DDL)

**Analogs:** `20260405061911_initial_schema.sql:19-32` (`api_keys` CREATE TABLE shape) + `20260405061912_rls_policies.sql:22` (`api_keys_owner` policy).

**CREATE TABLE shape to mirror** (`initial_schema.sql:19-32`) — note `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `... REFERENCES profiles ON DELETE CASCADE`, `TIMESTAMPTZ NOT NULL DEFAULT now()`:
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Build `scenarios` per CONTEXT line 24: `id`, `allocator_id uuid not null references profiles on delete cascade`, `name text not null` + `CHECK (length(btrim(name)) between 1 and 120)`, `draft jsonb not null`, `schema_version int not null`, `created_at`/`updated_at timestamptz not null default now()`. Add `CREATE INDEX … ON scenarios (allocator_id, updated_at DESC)` for list ordering (RESEARCH Pattern 1 note). NO `UNIQUE` on name (CONTEXT line 29 — 23505 timebomb).

**Owner RLS pattern to copy verbatim** (`rls_policies.sql:22`, the `api_keys_owner` line — keyed on the owner column, both USING and WITH CHECK):
```sql
CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```
Translate to:
```sql
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenarios_owner ON scenarios FOR ALL USING (allocator_id = auth.uid()) WITH CHECK (allocator_id = auth.uid());
```
`allocator_id = auth.uid()` is correct because `profiles.id` IS the auth user id (`rls_policies.sql:13` keys `profiles_own` on `id = auth.uid()`).

**Gate notes (from RESEARCH Q1):** forward timestamp later than the remote tip (`20260620120000` is the latest applied) to clear `migration-policy.yml`. A plain table + policy defines **no tracked function** → the `dump-sql-functions.ts --check` snapshot gate does NOT trip. Prefer touching `updated_at = now()` in the UPDATE/PATCH route rather than adding a `set_updated_at()` trigger (a trigger fn WOULD trip the snapshot gate and require `npm run schema:functions` + committing `supabase/schema/functions/<name>.sql`).

---

### `supabase/migrations/down/<ts>-rollback.sql` (migration, DDL rollback)

**Analog:** `supabase/migrations/down/20260620120000-rollback.sql` (naming convention only).

Naming is `YYYYMMDDhhmmss-rollback.sql` (**hyphen + `-rollback`**, same timestamp as the forward file). Body: `DROP TABLE scenarios CASCADE;` (+ drop the index/policy implicitly via the table drop; drop any trigger fn if one was added — prefer not to add one).

---

### `supabase/tests/test_scenarios_rls.sql` (test, RLS content assertion)

**Analog:** `supabase/tests/test_funding_fees_rls.sql` (read in full).

This is the load-bearing honesty test — RLS fails silently, so assert on cross-tenant **content (specific row id)**, never policy presence. Mirror the structure exactly:

**1. Defensive pre-clean by email** (`test_funding_fees_rls.sql:41-45`):
```sql
DELETE FROM auth.users WHERE email IN ('test-scen-rls-tenant-a@quantalyze.test', 'test-scen-rls-tenant-b@quantalyze.test');
```

**2. Seed two tenants end-to-end** — for `scenarios` the chain is shorter than funding_fees (no api_keys/strategies needed): `auth.users → profiles → scenarios` (lines 69-95 show the auth.users + profiles seed; replace the api_keys/strategies/funding_fees inserts with a single `scenarios` insert per tenant). Capture each row id into a scratch var (`scen_a_id`, `scen_b_id`) via `RETURNING id INTO`.

**3. Forge JWT sub + switch role** (the exact technique, `test_funding_fees_rls.sql:144-149`):
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
```

**4. Cross-tenant content assertions** (mirror Assertion 2, lines 151-173) — tenant A sees own row by id, CANNOT see B's row by id:
```sql
IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = scen_a_id) THEN
  RESET ROLE; RAISE EXCEPTION 'tenant A cannot see own scenario — read policy regressed'; END IF;
IF EXISTS (SELECT 1 FROM scenarios WHERE id = scen_b_id) THEN
  RESET ROLE; RAISE EXCEPTION 'tenant A sees tenant B scenario — CROSS-TENANT LEAK'; END IF;
```

**5. Negative write path** — UPDATE/DELETE of B's row by A is filtered/rejected. UNLIKE funding_fees (which has deny-INSERT policies), `scenarios` is `FOR ALL` owner — so the test asserts A's UPDATE/DELETE targeting `scen_b_id` affects **0 rows** (the `WITH CHECK` + `USING` predicate filters B's row out of A's view entirely). Mirror the "no exception → verify row unchanged by id" branch (lines 227-251):
```sql
-- as tenant A:
UPDATE scenarios SET name = 'hijacked' WHERE id = scen_b_id;  -- expect 0 rows affected
-- then RESET ROLE and verify B's name is unchanged by id (service-role read)
```
Also assert A CAN update/delete its OWN row (positive path) so the policy isn't over-tight.

**6. Teardown** (lines 380-388 + the post-DO defensive clean lines 396-400): `DELETE FROM auth.users WHERE id IN (uid_a, uid_b);` (cascades to profiles → scenarios), plus the repeated email-based DELETE outside the `DO` block.

**CI conventions (header lines 11-33):** plain PL/pgSQL `DO $$ … $$` + `RAISE EXCEPTION` on failure / `RAISE NOTICE` on pass; NO pgTAP; no `\!`/`\copy`/`\o` meta-commands (the `sql-tests` preflight rejects them). Filename `test_*.sql` is auto-discovered.

---

### `src/lib/database.types.ts` (config, hand-patch — MODIFIED)

**Analog:** the `for_quants_leads` HAND-PATCHED block (`database.types.ts:1021-1097`).

**DO NOT regenerate** — hand-add a `scenarios` block inside `Database["public"]["Tables"]`. Mirror the exact `Row` / `Insert` / `Update` / `Relationships` quad. The `Insert` makes defaulted columns optional (`id?`, `created_at?`, `updated_at?`); `Update` makes everything optional. Carry a tripwire comment in the SAME style as lines 1021-1028:
```ts
// HAND-PATCHED — do not regenerate this section without verifying
// migration 115 (notify_attempted_at, notify_succeeded_at,
// notify_error) is present in the source the regenerator targets.
```
Write an analogous `// HAND-PATCHED — scenarios added by migration <ts>; a regen linked to a project missing this migration silently reverts the block` comment so the `[#14]` guard's intent extends to the new table. Preserve the GENERATED-FILE header (lines 1-48) untouched.

**`scenarios.Row` shape** (derive from the migration): `id: string`, `allocator_id: string`, `name: string`, `draft: Json`, `schema_version: number`, `created_at: string`, `updated_at: string`. `Relationships`: one FK entry to `profiles` (and `public_profiles`) mirroring the `for_quants_leads_processed_by_fkey` shape at lines 1081-1095.

---

### `src/lib/database.types.test.ts` (test — MODIFIED)

**Analog:** `database.types.test.ts:12-25` (`expectTypeOf` drift-pin pattern, read in full).

Add a `describe`/`it` block pinning the new columns' presence + nullability so a stale regen drops a column AND fails the build:
```ts
type Row = Database["public"]["Tables"]["scenarios"]["Row"];
expectTypeOf<Row["schema_version"]>().toEqualTypeOf<number>();
expectTypeOf<Row["draft"]>().toEqualTypeOf<Json>();   // or the generated Json alias
// Insert: defaulted cols optional
type Insert = Database["public"]["Tables"]["scenarios"]["Insert"];
expectTypeOf<NonNullable<Insert["id"]>>().toEqualTypeOf<string>();
```

**`src/__tests__/critical-regressions.test.ts` `[#14]` block (lines 54-101):** NO edit required — it greps for the `HAND-PATCHED` + `migration 115` strings and the GENERATED-FILE header. The executor MUST keep those strings intact (do not strip them when adding the `scenarios` block). If the planner adds a `scenarios`-specific assertion it follows the same `src.includes(col)` shape (lines 88-100).

---

### `src/app/api/allocator/scenario/saved/route.ts` + `[id]/route.ts` (route, request-response/CRUD)

**Analog:** `src/app/api/allocator/scenario/commit/route.ts` (read in full). Copy the conventions, NOT the batch-RPC machinery — Phase 23 writes are single-row `supabase.from("scenarios")` calls under RLS (RESEARCH §Alternatives: no RPC needed).

**Imports + runtime** (`commit/route.ts:44-58`):
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
export const runtime = "nodejs";
```

**Handler signature + body read → JSON parse → zod** (`commit/route.ts:346-387`) — `withAllocatorAuth` sources `user.id`; body's `allocator_id` (if any) is dropped:
```ts
export const POST = withAllocatorAuth(async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
  let rawBody: string;
  try { rawBody = await req.text(); } catch (err) {
    console.error("[scenario-save] body read failed:", err);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  let json: unknown;
  try { json = rawBody === "" ? null : JSON.parse(rawBody); } catch { json = null; }
  const parsed = SaveScenarioBodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues },
      { status: 400, headers: NO_STORE_HEADERS });
```

**Body schema** — reuse `scenarioDraftSchema` (exported from `scenario-state.ts:499`) for the `draft` field; do NOT author a second validator (RESEARCH "Don't Hand-Roll"). Name validated with `.trim()` + `.min(1).max(120)` to mirror the SQL CHECK:
```ts
const SaveScenarioBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  draft: scenarioDraftSchema,
});
```

**Rate-limit AFTER validation** (`commit/route.ts:479-505`) — the canonical B15 order `auth → validate → ratelimit → handler`; a 400 does NOT burn a token:
```ts
const rl = await checkLimit(userActionLimiter, `scenario_save:${user.id}`);
if (!rl.success) {
  if (isRateLimitMisconfigured(rl))
    return NextResponse.json({ error: "Rate limiter unavailable" },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } });
  return NextResponse.json({ error: "Too many requests" },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } });
}
```

**User-scoped client + RLS-bound write** (`commit/route.ts:507` + RESEARCH Pattern 2). `allocator_id: user.id` always sourced from auth, never the body; `schema_version` from `draft.schema_version`:
```ts
const supabase = await createClient();
const { data, error } = await supabase.from("scenarios")
  .insert({ allocator_id: user.id, name: parsed.data.name,
            draft: parsed.data.draft, schema_version: parsed.data.draft.schema_version })
  .select("id, name, created_at, updated_at, schema_version").single();
```

**Redacted error envelope** (`commit/route.ts:536-555`) — NEVER echo `error.message` (leaks schema/column names); log + Sentry server-side, return a stable UI-SPEC message:
```ts
if (error) {
  console.error("scenario_save error", { user: user.id, message: error.message });
  captureToSentry(error, { tags: { area: "scenario-save" } });
  return NextResponse.json({ error: "Save failed", message: "Couldn't save this scenario. Check your connection and try again." },
    { status: 500, headers: NO_STORE_HEADERS });
}
return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
```

**`[id]/route.ts` (PATCH rename / PUT update-draft / DELETE):** same skeleton. `[id]` route params are **async in this repo's Next.js** (AGENTS.md mandate — read `node_modules/next/dist/docs/` before writing the signature; do NOT assume sync params). Validate `id` as `z.string().uuid()` (400 on malformed → maps a 22P02 to 404/400 rather than leaking). RLS scopes the write to the owner; a row the caller doesn't own simply matches 0 rows — surface that as 404, not 403 (don't reveal existence). PATCH re-validates name trim/length; PUT touches `updated_at = now()` in the update payload (avoids the trigger-fn snapshot gate).

**GET list** — thin reader: `supabase.from("scenarios").select("id, name, schema_version, created_at, updated_at").order("updated_at", { ascending: false })`; RLS scopes to the caller; `NO_STORE_HEADERS`. (Planner may instead lift this as an RSC fetch on the Scenario tab — RESEARCH Q3 default is the GET route for symmetry.)

**ALWAYS `NO_STORE_HEADERS` on every response** (success + error), per `headers.ts:13`.

---

### `…/scenario/saved/route.test.ts` + `[id]/route.test.ts` (test)

**Analog:** `src/app/api/allocator/scenario/commit/route.test.ts` (header read, lines 1-40).

Mirror the test-matrix doc-comment style (`T_R1…T_Rn`) and the mock setup: `vi.mock("server-only", () => ({}))` (jsdom throws on the transitive `import "server-only"`), mock the supabase client + the rate limiter, then assert: 401 (no auth), 400 (invalid body / bad name length / non-uuid id), 429 + `Retry-After` (rate limit), 200 + RLS-bound write fired, `NO_STORE_HEADERS` present on every response, redacted error message on DB error (no raw `error.message`), and **T_R14-style cross-tenant**: a body-supplied `allocator_id` is ignored, the insert uses `user.id`.

---

### `src/app/(dashboard)/allocations/lib/scenario-compare.ts` (utility, pure transform)

**Analogs:** `src/lib/scenario.ts` (`computeScenario`, `buildDateMapCache`, `ComputedMetrics`) + the composer's adapter→compute chain (`ScenarioComposer.tsx:460-630`).

Extract the composer's existing chain into a testable pure helper `computeMetricsForDraft(draft, liveInputs): ComputedMetrics` (RESEARCH Code Examples). The chain: build `addedStrategyReturnsLookup`/`addedStrategyMetadataLookup` from `payload.strategies` → `buildStrategyForBuilderSet(holdingsSummary, disabledHoldingRefs, draft.addedStrategies, holdingReturnsByScopeRef, …)` → overlay `draft.toggleByScopeRef`/`draft.weightOverrides` into `projectionState` → `collapseAliasedHoldingStrategies(...)` → `buildDateMapCache(...)` → `computeScenario(...)`.

**Critical invariants the helper preserves:**
- **No leverage:** leverage is ephemeral `useState` in the composer, NEVER persisted (`ScenarioComposer.tsx:361-367`); a saved draft has no leverage field (`ScenarioDraft`, `scenario-state.ts:75-96`). The helper runs every leg at leverage 1.
- **Degenerate → null metrics:** `computeScenario` already returns null-metric `ComputedMetrics` for degenerate sets (n<10 / NaN-poisoned); the caller renders `"—"` via the formatters — do NOT add a `?? 0`.
- **Live-book column:** compute it through the SAME helper over a synthetic "all live holdings, equity-weight" draft so all six metrics populate honestly (RESEARCH Q4/A4 recommendation), rather than `payload.liveBaselineMetrics` which leaves cagr/sortino/volatility null.

**`scenario-compare.test.ts` analog:** `src/lib/scenario.test.ts` (do not regress it). New assertions: a draft round-trips to the metrics the composer shows; a degenerate draft yields null metrics → `"—"`; heterogeneous-window drafts each report their own `n`.

---

### `…/allocations/hooks/useScenarioState.ts` (hook — MODIFIED, one-shot hydrate seam)

**Analog:** the hook's own `reset`/`setValue`/`baseOf` wiring (`useScenarioState.ts:202-237`).

Add an imperative one-shot `hydrateFromSaved: (draft: ScenarioDraft) => void` to the returned API (extend the `UseScenarioStateReturn` interface at lines 65-83 and the return object at lines 271-282). Route it through the SAME `setValue` the mutators use (lines 202-231 show the `setValue((prev) => …)` shape) — RESEARCH Q2:
```ts
const hydrateFromSaved = useCallback((saved: ScenarioDraft) => {
  setValue(() => saved);          // in-memory working draft; autosave persists on next edit
  setMismatchDismissed(false);    // a freshly-opened scenario gets a fresh banner
}, [setValue]);
```

**Why this is the correct seam (load-bearing honesty):**
- The fingerprint-mismatch banner derives **automatically** — `storedMismatch` (lines 157-160) is `value.init_holdings_fingerprint !== fingerprint`. Because `hydrateFromSaved` writes the saved draft (carrying its own `init_holdings_fingerprint`) into `value`, a drifted draft fires the banner with NO special-casing (Pitfall 2). Do NOT add a `loadedFromDb` branch that bypasses `fingerprintMismatch`.
- It does NOT clobber the unsaved localStorage working draft destructively — `setValue` is the same path edits use (Pitfall 6); contrast `reset` (lines 232-237) which calls `removeStored` to wipe the key. Use `setValue`, not `removeStored`.
- **The codec trichotomy runs BEFORE calling `hydrateFromSaved`** (in the route/list/wrapper layer): pass the row's `draft` JSONB through `scenarioDraftCodec(defaultDraft).decode(JSON.stringify(row.draft))` (`scenario-state.ts:521-583`). `ok` → `hydrateFromSaved(decoded.value)`; `readonly` (version ahead) → hydrate but block edits + show the read-only notice; `reset` → do NOT hydrate, render the honest "older format" notice. Never `row.draft as ScenarioDraft` (Pitfall 3, the M-0153 lesson).

**Loaded-scenario id (Save vs Update):** the composer holds a `loadedScenarioId: string | null` useState (`ScenarioComposer.tsx`); Open sets it, `reset()` clears it. This is composer state, NOT a hook change.

---

### `…/allocations/components/ScenarioCompareTable.tsx` (component, render grid)

**Analog:** `src/components/strategy/CompareTable.tsx` (read in full) — mirror EXACTLY.

**Table scaffold** (`CompareTable.tsx:84-95`):
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    <thead><tr className="border-b border-border">
      <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted w-40">Metric</th>
      {/* each scenario column header: text-right px-4 py-3 text-xs font-semibold text-text-primary */}
```

**`METRICS` rows + `higherIsBetter` flags** (`CompareTable.tsx:27-37`) — Phase 23's six rows are a subset: Cumulative Return (`twr`, percent, true), CAGR (percent, true), Sharpe (number, true), Sortino (number, true), Max Drawdown (percent, **false**), Volatility (percent, **false**). Keys read from `ComputedMetrics` (not `StrategyAnalytics`).

**`findWinner` + `formatValue` em-dash** (`CompareTable.tsx:44-63`) — copy both verbatim. `formatValue` returns `"—"` for null; `findWinner` skips nulls and returns the best index:
```tsx
function formatValue(value, format) { if (value == null) return "—"; /* percent | number */ }
function findWinner(items, key, higherIsBetter) { /* skip null; track best idx */ }
```

**Winner cell styling** (`CompareTable.tsx:104-120`) — `isWinner` ⇒ `text-accent font-bold` + `" ✓"`, else `text-text-secondary`; value span is `text-xs font-metric`; metric label cell `px-4 py-2.5 text-xs text-text-muted`; row `border-b border-border/50 hover:bg-page/50`:
```tsx
<span className={cn("text-xs font-metric", isWinner ? "text-accent font-bold" : "text-text-secondary")}>
  {formatValue(val, metric.format)}{isWinner && " ✓"}
</span>
```

**Per-column honesty stamp (NET-NEW, the load-bearing divergence from CompareTable):** each column stamps its OWN `methodologyLine(scenarioMetrics.n)` (`scenario-history.ts:41`) in a caption sub-row/footer (12px, N in Geist Mono). Heterogeneous windows are EXPECTED — do NOT render a single shared-window header (Pitfall 5; common-window alignment is Phase 24). A whole column below `SAMPLE_FLOOR_OVERLAPPING_DAYS` (60, `sample-floor.ts`) gates to `evaluateSampleFloor` + the builder copy (neutral, no red/amber). Empty-selection state mirrors `CompareTable.tsx:66-68` ("Select strategies to compare." → UI-SPEC: "Select 2 or more scenarios (or the live book) to compare.").

---

### `…/allocations/components/SavedScenariosList.tsx` (component, list + manage)

**Analogs:** `EmptyStateCard.tsx` (empty state) + the composer's list-row shell (`ScenarioComposer.tsx:1386`: `flex items-center justify-between gap-3 rounded-md border border-border p-3`).

Each row: checkbox + name (14px) + 12px `text-text-muted` timestamp; right side `Open` (`ghost`) · `Rename` (inline edit → PATCH) · `Delete` (`danger` inline confirm, NOT a modal — CONTEXT line 41). Empty state = `EmptyStateCard` with the UI-SPEC heading "No saved scenarios yet" + body (heading MUST match body — the #509 lesson). Selection checkboxes feed the `Compare selected` CTA (enabled at ≥2). Reuse `Button` variants from `src/components/ui/Button.tsx` (UI-SPEC §Primitives).

---

### `…/allocations/components/ScenarioComposer.tsx` (component — MODIFIED, Save/Update toolbar)

**Analog (self):** the existing toolbar header at `ScenarioComposer.tsx:993` — `<div className="flex flex-wrap items-center gap-3"><h2 …>Scenario</h2><span …PROJECTED…/></div>`.

Add the Save/Update control INTO that same `flex flex-wrap items-center gap-3` header row (UI-SPEC §Component Inventory 1). Default (no scenario open): `Button variant="primary"` "Save scenario" → reveals an inline `Name this scenario` text input + confirm (NO modal). When `loadedScenarioId` is set: primary becomes "Update scenario" + secondary `Button variant="secondary"` "Save as new scenario". Inline validation copy per UI-SPEC §Copywriting. Do NOT re-style the existing PROJECTED badge / fingerprint-mismatch banner (`ScenarioComposer.tsx:992-1044`) — reopen surfaces reuse them verbatim.

---

## Shared Patterns

### Authentication + role gate
**Source:** `src/lib/api/withAllocatorAuth.ts:61-128`
**Apply to:** every CRUD route (`saved/route.ts`, `saved/[id]/route.ts`).
```ts
export const POST = withAllocatorAuth(async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => { … });
```
`user.id` is the authenticated allocator (gate already ran: 401 no-session, 503 DB-error, 403 missing-profile / non-allocator). NEVER trust a client-sent `allocator_id`. RLS `WITH CHECK (allocator_id = auth.uid())` is defense-in-depth on top.

### No-store headers
**Source:** `src/lib/api/headers.ts:13`
**Apply to:** EVERY route response (success AND error).
```ts
export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
```
Allocator payloads must never hit a shared cache (cross-tenant leak).

### Rate-limit AFTER validation (B15 ordering)
**Source:** `src/app/api/allocator/scenario/commit/route.ts:479-505`
**Apply to:** every side-effecting write route (POST/PATCH/PUT/DELETE).
Order: `auth → input-validation → rate-limit → handler`. A 400 must NOT consume a token. 503 if `isRateLimitMisconfigured`, else 429 + `Retry-After`.

### Redacted DB-error envelope
**Source:** `src/app/api/allocator/scenario/commit/route.ts:536-555`
**Apply to:** every route's DB-error branch.
`console.error` + `captureToSentry` server-side; return a stable UI-SPEC message (`{ error, message }`). NEVER echo `error.message` (F5a/F5b — leaks schema/column names).

### Draft validation on the wire AND on read
**Source:** `scenario-state.ts:499` (`scenarioDraftSchema`) + `:521` (`scenarioDraftCodec`)
**Apply to:** the save/update route body (`draft` field) AND the reopen read.
Wire: `scenarioDraftSchema.safeParse`. Read: `scenarioDraftCodec(...).decode(...)` trichotomy — never `JSON.parse(raw) as ScenarioDraft` (M-0153).

### Em-dash honesty + winner highlight
**Source:** `CompareTable.tsx:44-63` (`formatValue` null → `"—"`, `findWinner` skips null) + `formatPercent`/`formatNumber` (`src/lib/utils.ts`)
**Apply to:** the compare grid + any list-row metric stamp.
Null/non-finite renders `"—"` for free; never fabricate `0`/`0.00%`/`N/A`.

### Per-column window stamp
**Source:** `src/lib/scenario-history.ts:41` (`methodologyLine(n)`)
**Apply to:** each compare column independently.
Single source so the surfaces can't drift; heterogeneous windows are correct (Phase 24 owns alignment).

---

## No Analog Found

None. Every file in this phase has a verified in-repo analog. The only **net-new behavior** (not net-new file) is the per-column `methodologyLine(n)` stamp inside `ScenarioCompareTable.tsx` — its component scaffold copies `CompareTable.tsx`, and the stamp helper itself already exists (`scenario-history.ts:41`); only the per-column placement (vs CompareTable's single header) is new, and it is explicitly mandated by CONTEXT/UI-SPEC.

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/migrations/down/`, `supabase/tests/`, `src/app/api/allocator/scenario/`, `src/app/(dashboard)/allocations/` (lib + hooks + components), `src/components/strategy/`, `src/lib/` (database.types, api/*, scenario*, utils, sample-floor, scenario-history).
**Files read (analogs):** `commit/route.ts`, `commit/route.test.ts` (head), `withAllocatorAuth.ts`, `headers.ts`, `20260405061912_rls_policies.sql`, `20260405061911_initial_schema.sql` (api_keys), `test_funding_fees_rls.sql`, `CompareTable.tsx`, `scenario-state.ts` (ScenarioDraft + codec), `useScenarioState.ts`, `database.types.ts` (header + for_quants_leads hand-patch), `database.types.test.ts`, `critical-regressions.test.ts` (`[#14]`), `ScenarioComposer.tsx` (toolbar header), `down/` listing.
**Pattern extraction date:** 2026-06-21
