# Phase 25: Read-Only Sharing - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 9 (3 created backend, 2 created routes, 1 created lib, 1 created page, 1 modified component, 3 created/modified tests)
**Analogs found:** 9 / 9 (every file has a strong in-tree analog — this phase is composition, not invention)

> The two highest-risk files are the **SECURITY DEFINER read RPC** (in the new migration) and the **public recipient page**. They get the most concrete excerpts (Pattern Assignment 1 + 6). Both have direct, hardened in-tree analogs; the planner's job is to compose them under the locked leak invariants, not author novel security primitives.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/2026XXXX_scenario_shares_and_read_rpc.sql` (table + owner RLS + REVOKE anon) | migration | CRUD | `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` | exact (table+RLS spine) |
| ↳ same migration: `get_shared_scenario(p_token text)` SECURITY DEFINER RPC | migration (SECURITY DEFINER) | request-response (token-scoped read) | `supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql` (token-param RPC shape) + `20260515205431_sec_def_public_execute_guard.sql` (REVOKE + `_assert_no_public_execute`) | exact (synthesis of two canon migrations) |
| `supabase/migrations/down/2026XXXX-rollback.sql` | migration | — | `supabase/migrations/down/20260515205431-rollback.sql` (referenced in mig-134 header) | role-match |
| `src/lib/scenario-share-token.ts` (`mintShareToken` / `hashShareToken`) | utility | transform | `src/lib/demo-pdf-token.ts` (Node `crypto` opaque-token discipline) | role-match (adapt HMAC→stored-hash) |
| `src/app/api/allocator/scenario/share/route.ts` (POST generate) | route (controller) | CRUD (write) | `src/app/api/allocator/scenario/saved/route.ts` (POST create) | exact |
| `src/app/api/allocator/scenario/share/revoke/route.ts` (POST revoke; or DELETE on `[id]`) | route (controller) | CRUD (update) | `src/app/api/allocator/scenario/saved/[id]/route.ts` (PATCH/DELETE owner-scoped) | exact |
| `src/app/scenario-share/[token]/page.tsx` (public RSC) | page (RSC) | request-response (public read) | `src/app/factsheet/[id]/v2/page.tsx` (gate→admin-resolve→`notFound()`) + `src/app/demo/page.tsx` (`force-dynamic` + `createAdminClient` allowlist precedent) | exact (two-analog composite) |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (+ Share affordance) | component | event-driven (UI state machine) | self (existing Rename/Delete row actions) + `src/components/strategy/ShareableLink.tsx` (clipboard state machine) | exact (extend in place) |
| `supabase/tests/test_scenario_shares_rls.sql` (two-tenant + anon CONTENT leak + revoke) | test (integration SQL) | request-response | `supabase/tests/test_scenarios_rls.sql` (Assertion 2/3/5) | exact |
| `src/lib/scenario-share-token.test.ts` + share-resolve helper unit test + `SavedScenariosList.test.tsx` (extend) | test (vitest) | — | `SavedScenariosList.test.tsx` T_SL7b/T_SL7c | exact |

---

## Pattern Assignments

### 1. `get_shared_scenario(p_token text)` SECURITY DEFINER RPC — HIGHEST RISK

**Analogs:** `supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql` (token-param RPC body shape, `SET search_path`, REVOKE + body-shape self-assert) + `supabase/migrations/20260515205431_sec_def_public_execute_guard.sql` (the `_assert_no_public_execute` helper + the `DO $$` self-verify block).

**SECURITY DEFINER + search_path + REVOKE shape to copy** — from mig 117 (`compute_jobs_claim_token_fencing.sql:142-151, 205`):
```sql
CREATE OR REPLACE FUNCTION claim_compute_jobs(...)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp        -- NOT pg_catalog (mig 87 H-B hardening; the read RPCs use public,pg_temp)
AS $$ ... $$;
-- ...
REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;
```
> NOTE: mig 117's *mark* RPCs use `SET search_path = public, pg_catalog` (lines 383, 516, 630) but the *claim* RPCs use `public, pg_temp` (lines 149, 247). RESEARCH §Pattern 1 + the strategy_analytics_series read RPC (mig 87 H-B) lock the read path to **`public, pg_temp`** — use that. Surface the conflict, don't blend (CLAUDE Rule 7).

**`_assert_no_public_execute` helper + self-verify DO-block to copy** — from mig 134 (`sec_def_public_execute_guard.sql:70-100` for the helper, `136-141` for the call site):
```sql
-- The helper already exists in the DB (mig 134). Do NOT redefine it — just CALL it:
DO $$ BEGIN
  PERFORM public._assert_no_public_execute('public.get_shared_scenario(text)');
  RAISE NOTICE 'Migration XXX: PUBLIC EXECUTE absence verified for get_shared_scenario.';
END $$;
```
The helper's correct probe (why `has_function_privilege('public', …)` is NOT used) — mig 134:86-91:
```sql
SELECT COUNT(*) INTO v_leaks
  FROM pg_proc p,
       LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
 WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
```

**Grant model (Anti-pattern guard):** the page calls via `createAdminClient` (service_role transport). After `REVOKE ALL ... FROM PUBLIC, anon` you MAY `GRANT EXECUTE ... TO service_role` but **never** `GRANT ... TO anon`. (RESEARCH Anti-pattern: "`GRANT EXECUTE ... TO anon` on the read RPC".)

**Body-shape self-assert precedent** (optional defense-in-depth the planner may add) — mig 117's STEP 7 DO-block (`compute_jobs_claim_token_fencing.sql:702-840`) reads `pg_get_functiondef(p.oid)` and `~*`-regexes the body to prove it still contains required clauses / does NOT contain forbidden ones. Mirror this to assert the `get_shared_scenario` body does **not** reference `api_keys` / `portfolio_strategies` / `portfolios` and **does** filter `revoked_at IS NULL` (RESEARCH Pitfall 1).

**The RPC's scoping contract (the leak surface — see Pattern Assignment 2):** returns ONLY `name`, `draft`, `schema_version`, and the `addedStrategies[].id`-scoped `strategy_analytics` series filtered to `strategies.status = 'published'`. Explicit column list, never `SELECT *`. Hashes the raw token internally (`encode(digest(p_token,'sha256'),'hex')` — verify pgcrypto `digest` at plan time per RESEARCH A1; fall back to hash-in-Node if absent). Full shape sketch is in RESEARCH §Architecture Pattern 1 (lines 197-262).

---

### 2. `scenario_shares` table + owner RLS + REVOKE anon (same migration)

**Analog:** `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` (the Phase 23 spine — verbatim mirror).

**Table + RLS + REVOKE pattern to copy** (`scenarios_table_and_rls.sql:38-79`):
```sql
CREATE TABLE scenarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id  UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  draft         JSONB NOT NULL,
  schema_version INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY scenarios_owner ON scenarios
  FOR ALL
  TO authenticated
  USING (allocator_id = auth.uid())
  WITH CHECK (allocator_id = auth.uid());

REVOKE ALL ON scenarios FROM anon;

CREATE INDEX scenarios_allocator_updated_idx ON scenarios (allocator_id, updated_at DESC);
```

**For `scenario_shares` (apply the same shape, owner col = `created_by`):**
- Columns per CONTEXT Area 1: `id`, `scenario_id UUID NOT NULL REFERENCES scenarios ON DELETE CASCADE`, `created_by UUID NOT NULL REFERENCES profiles ON DELETE CASCADE`, `token_hash TEXT NOT NULL`, `created_at`, `revoked_at TIMESTAMPTZ`.
- `CREATE POLICY scenario_shares_owner ... TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());` (swap `allocator_id`→`created_by`).
- `REVOKE ALL ON scenario_shares FROM anon;` — anon's ONLY path is the SECURITY DEFINER RPC.
- **"One active share per scenario"** (RESEARCH §Pattern 3): partial unique index `CREATE UNIQUE INDEX ... ON scenario_shares (scenario_id) WHERE revoked_at IS NULL;` as the structural guarantee + a pre-revoke UPDATE in the generate route.
- **NO `set_updated_at()` trigger** — `scenarios` migration header (lines 27-32) documents that a tracked trigger function trips `dump-sql-functions.ts --check`. `created_at` + `revoked_at` suffice; no `updated_at` needed.
- **Migration discipline** (header lines 34-35): do NOT `supabase db push` from the plan; applies at `/land-and-deploy` (anon NO-EXEC verified). Provide `down/…-rollback.sql` = `DROP FUNCTION get_shared_scenario; DROP TABLE scenario_shares CASCADE;`.

**Snapshot-don't-reference leak boundary (the central rule)** — the draft mixes two ref classes; resolve ONLY added strategies. From `scenario-adapter.ts:100-144`:
```ts
// Holdings → id = "holding:{venue}:{symbol}:{holding_type}"  ← LIVE BOOK, never resolve on the share path
const scopeRef = buildHoldingRef(h as HoldingRefInput);   // line 101
// Added strategies → id = strategies.id UUID  ← published; the ONLY class the RPC resolves
return { id: a.id, ... };                                  // line 131
```
The `addedStrategies` shape the RPC reads (`scenario-state.ts:65-73, 81`):
```ts
export interface AddedStrategy { id: StrategyForBuilderId; name: string; markets: string[]; strategy_types: string[]; }
// ScenarioDraft.addedStrategies: AddedStrategy[]   (line 81)
```
Published-only RLS predicate the RPC must mirror (`20260405061912_rls_policies.sql:28-29, 36-40`):
```sql
CREATE POLICY strategies_read ON strategies FOR SELECT USING (status = 'published' OR user_id = auth.uid());
CREATE POLICY analytics_read ON strategy_analytics FOR SELECT USING (... s.status = 'published' OR s.user_id = auth.uid());
```
> The RPC runs SECURITY DEFINER (bypasses RLS), so it MUST hard-code `AND st.status = 'published'` itself — RLS will not protect it. (RESEARCH Pitfall 1.)

---

### 3. `src/lib/scenario-share-token.ts` (mint + hash)

**Analog:** `src/lib/demo-pdf-token.ts` — adapt from HMAC-stateless (can't revoke) to random+stored-hash (revocable, the hard requirement).

**Node crypto pattern to copy** (`demo-pdf-token.ts:1, 32-34`):
```ts
import { createHmac, timingSafeEqual } from "crypto";   // adapt → randomBytes, createHash
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
```
**Target shape** (RESEARCH §Code Examples lines 368-382):
```ts
import { randomBytes, createHash } from "crypto";
export function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");   // 256-bit, raw lives ONLY in the URL
  return { raw, hash: hashShareToken(raw) };
}
export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex"); // MUST match the RPC's digest
}
```
> NO `SECRET_ENV` (the stored-hash model needs no HMAC secret, unlike `demo-pdf-token.ts:20`). Entropy comes from `randomBytes`. If the planner chooses hash-in-Node over hash-in-SQL, this file is the single source of truth for the digest algorithm; keep the hex/base64 form aligned with the RPC.

---

### 4. `src/app/api/allocator/scenario/share/route.ts` (POST generate)

**Analog:** `src/app/api/allocator/scenario/saved/route.ts` — copy the auth/error/limiter conventions verbatim.

**Imports + runtime + B15 ordering** (`saved/route.ts:27-39, 66-126`):
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
export const runtime = "nodejs";

export const POST = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    // B15: body read → byte-cap → JSON.parse → zod safeParse (400, no token burned)
    //      → checkLimit(userActionLimiter, `scenario_share:${user.id}`) AFTER validation
```
**Rate-limit-misconfig → 503 (not a misleading 429)** (`saved/route.ts:108-126`):
```ts
const rl = await checkLimit(userActionLimiter, `scenario_save:${user.id}`);
if (!rl.success) {
  if (isRateLimitMisconfigured(rl)) {
    return NextResponse.json({ error: "Rate limiter unavailable" },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } });
  }
  return NextResponse.json({ error: "Too many requests" },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } });
}
```
**Owner-scoped write + redacted error envelope** (`saved/route.ts:128-155`):
```ts
const supabase = await createClient();   // user-scoped (RLS binds created_by = auth.uid())
const { data, error } = await supabase.from("scenario_shares")
  .insert({ scenario_id: scenarioId, created_by: user.id, token_hash: hash })  // created_by from AUTH, never body
  .select("id").single();
if (error) {
  console.error("scenario_share error", { user: user.id, message: error.message });
  captureToSentry(error, { tags: { area: "scenario-share" } });   // NEVER echo error.message
  return NextResponse.json(
    { error: "Save failed", message: "Couldn't create a share link. Try again." },
    { status: 500, headers: NO_STORE_HEADERS });
}
return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });  // NO_STORE on EVERY response
```
**Generate-specific additions:**
- Mint the token AFTER the limiter (`const { raw, hash } = mintShareToken();`).
- Pre-revoke any active share for `scenario_id` first (RESEARCH §Generate route skeleton lines 402-419): `.from("scenario_shares").update({ revoked_at: new Date().toISOString() }).eq("scenario_id", scenarioId).is("revoked_at", null)` — RLS scopes it; the partial unique index is the structural backstop.
- Return `{ url: `${origin}/scenario-share/${raw}` }` — build origin from `NEXT_PUBLIC_APP_URL` (demo-pdf precedent `portfolio-pdf/[id]/route.ts:17`), never a hardcoded host. The raw token appears ONLY here.
- Body schema validates `{ scenario_id }` (uuid). `logAuditEvent` (saved route lines 162-170) carries no draft content — mirror that privacy posture.

---

### 5. `src/app/api/allocator/scenario/share/revoke/route.ts` (POST revoke; or DELETE on `[id]`)

**Analog:** `src/app/api/allocator/scenario/saved/[id]/route.ts` — owner-scoped UPDATE, uuid-validate-first, 0-rows→404.

**uuid-first + 0-rows→404 (not 403) pattern** (`saved/[id]/route.ts` header lines 21-26 + body lines 144, 246, 297-309):
```ts
import { isUuid } from "@/lib/utils";
// uuid id validated FIRST (400 on malformed — maps a would-be 22P02 to a clean
// non-retryable 400, no schema leak; runs before auth/rate-limit).
if (!isUuid(id)) return badId();   // 400, NO_STORE_HEADERS
return withAllocatorAuth(async (req, user) => {
  const supabase = await createClient();
  const { error, count } = await supabase.from("scenario_shares")
    .update({ revoked_at: new Date().toISOString() })   // SET revoked_at, never DELETE (audit trail, CONTEXT Area 1)
    .eq("scenario_id", scenarioId).is("revoked_at", null);  // RLS already scopes to created_by = auth.uid()
  // caller does NOT own / no active share → 0 rows → 404 (T-23-10: NOT 403 — no existence oracle)
});
```
> Revoke sets `revoked_at = now()`; the RPC's `revoked_at IS NULL` predicate makes it immediate; the page's `force-dynamic` + `no-store` means no edge cache outlives it (RESEARCH SHARE-03). Either `POST /share/revoke` or `DELETE /share/[id]` is acceptable (RESEARCH Open Question 3) — both `withAllocatorAuth`, both scope by `created_by = auth.uid()`, both set `revoked_at` not delete.

---

### 6. `src/app/scenario-share/[token]/page.tsx` (public RSC) — HIGHEST RISK

**Analogs:** `src/app/factsheet/[id]/v2/page.tsx` (gate → `createAdminClient` resolve → `notFound()`) + `src/app/demo/page.tsx` (`force-dynamic` + admin-client public-route security comment).

**`force-dynamic` + admin-client-behind-a-gate security comment** (`demo/page.tsx:1-6, 38`):
```ts
// SECURITY BOUNDARY: All Supabase reads on this page MUST be parameterized by a
// gated value ... never add a query that reads an arbitrary id from searchParams.
export const dynamic = "force-dynamic";   // revoke must be instant; no ISR/edge cache
```
**`await params` (Next 16) + gate → `notFound()`** (`factsheet/[id]/v2/page.tsx:219-277`):
```ts
export default async function FactsheetV2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;          // Next 16: params is a Promise — await it
  const supabase = await createClient();
  // ... signature probe ...
  if (signRes.error || !signature) {
    console.warn("[factsheet/v2/page] signature gate -> notFound", { id, ... });
    notFound();                          // invalid/hidden → 404, never a partial / different row
  }
```
**For the share page (compose the two analogs):**
```ts
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";   // service_role = transport ONLY; the RPC is the gate
import { publicIpLimiter, checkLimit, getClientIp, rateLimitDenyJson } from "@/lib/ratelimit";
export const dynamic = "force-dynamic";

export default async function ScenarioSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 1. LIMIT FIRST (demo-pdf precedent — reject scrapers before any DB/crypto work)
  // 2. const admin = createAdminClient(); admin.rpc("get_shared_scenario", { p_token: token })
  // 3. no row → notFound()
  // 4. decode draft via scenarioDraftCodec — BRANCH ON OUTCOME (see DI-23-01 below)
  // 5. fetch GET /api/benchmark/btc (public, cacheable — do NOT add no-store to it)
  // 6. computeScenario(...) + computeScenarioBenchmark(...) server-side; feed props-only components
}
```
**Limit-first ordering to mirror** (`api/demo/portfolio-pdf/[id]/route.ts:39-49`):
```ts
const ip = getClientIp(req.headers);
const rl = await checkLimit(publicIpLimiter, `scenario-share:${ip}`);   // publicIpLimiter = makeLimiter(10,"60 s")
if (!rl.success) return rateLimitDenyJson(rl);   // misconfig → 503 not a misleading 429
```
> NOTE: a page RSC has no `NextRequest`/headers the way a route handler does. RESEARCH Open Question 2 recommends the **RSC page** for one fewer surface; if the planner needs `getClientIp(req.headers)` it must either read headers via `next/headers` `headers()` (Next 16 async) or split the data fetch into a route handler. If a route handler is added it ALSO needs `Cache-Control: no-store` + `export const dynamic="force-dynamic"`.

**`no-store` cache-control reasoning to copy verbatim** (`api/demo/portfolio-pdf/[id]/route.ts:113-115`):
```ts
// DO NOT cache at the edge. Shared caches are keyed on the URL, not the token's
// state. A cached response could be replayed after the token [is revoked].
"Cache-Control": "private, no-store, no-cache, must-revalidate",
```

**DI-23-01 LANDMINE — branch on codec outcome, NEVER render `.value` on non-`"ok"`** (`scenario-state.ts:578-608`):
```ts
// version_ahead → outcome:"readonly", value = defaultDraft (or safeParse)   ← lines 578-587
// schema_invalid / parse_failed / version_mismatch → outcome:"reset", value = defaultDraft  ← 599, 564, 608
```
On the dashboard `defaultDraft` is the viewer's live holdings; on a PUBLIC page rendering it would surface SOMEONE'S book under a recipient's eyes. The share page MUST treat `"readonly"` AND `"reset"` as **honest-absence** (`EmptyStateCard` "This shared scenario can't be displayed", per UI-SPEC line 150) and only `"ok"` renders the projection. Pin against `SCENARIO_SCHEMA_VERSION` = **2** (`scenario-state.ts:57`), not 1.

**Empty `addedStrategies` → `series=[]` → honest correlation/projection empty states** (not a bug; RESEARCH §Pattern 2 line 268). `computeScenario` returns the all-null degenerate shape for `activeIds.length === 0` (`scenario.ts:157-173`).

**Compute engine signatures the page calls server-side:**
```ts
// src/lib/scenario.ts:149
export function computeScenario(strategies: StrategyForBuilder[], state: ScenarioState, dateMapCache: Map<string, Map<string, number>>): ComputedMetrics
// src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:97
export function computeScenarioBenchmark(portfolioDaily: DailyPoint[], btcDaily: DailyPoint[]): ScenarioBenchmark
```
Feed `ComputedMetrics.portfolio_daily_returns` (`scenario.ts:128`) into `computeScenarioBenchmark` with the BTC series. Render reused props-only components: `EquityChart`, `CorrelationHeatmap` (`src/components/portfolio/CorrelationHeatmap.tsx`), `ScenarioBenchmarkSection` (`src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx`). Return/% form only — no USD (UI-SPEC §Honesty Invariant 1).

---

### 7. `SavedScenariosList.tsx` — add per-row Share affordance

**Analogs:** itself (existing inline Rename/Delete row-action state machine) + `src/components/strategy/ShareableLink.tsx` (clipboard + execCommand fallback + honest-failure).

**Honest mutation-failure pattern to mirror** (`SavedScenariosList.tsx:185-209, 399-403`):
```ts
const confirmDelete = useCallback(async (row) => {
  setMutationError(null);
  try {
    const res = await fetch(`/api/allocator/scenario/saved/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setMutationError("Couldn't delete this scenario. Try again."); return; }  // onMutated NOT fired
    setLocalRows((prev) => prev.filter((r) => r.id !== row.id));
    setConfirmingDeleteId(null);
    onMutated?.();   // fires ONLY on success
  } catch { setMutationError("Couldn't delete this scenario. Try again."); }
}, [onMutated]);
// ...
{mutationError && <p role="alert" className="text-xs text-negative">{mutationError}</p>}
```
Share copy (UI-SPEC §Copywriting): `"Couldn't create a share link. Try again."` / `"Couldn't revoke this link. Try again."`. `onMutated` NOT fired on a failed generate/revoke (the T_SL7b/T_SL7c contract).

**Inline destructive confirm pattern to mirror for Revoke** (`SavedScenariosList.tsx:338-357`):
```tsx
) : isConfirmingDelete ? (
  <div className="flex items-center gap-2">
    <span className="text-xs text-text-secondary">Delete &quot;{row.name}&quot;?</span>
    <Button variant="danger" size="sm" onClick={() => confirmDelete(row)}>Delete</Button>
    <Button variant="ghost" size="sm" onClick={() => setConfirmingDeleteId(null)}>Cancel</Button>
  </div>
) : ( ... )
```
Revoke copy (UI-SPEC line 135): `"Revoke this share link? Anyone with the link will lose access."` + `Revoke`(danger) / `Keep link`(ghost). Inline reveal, NOT a modal.

**Clipboard + execCommand fallback + audit-#43 honest-failure state machine to copy** (`ShareableLink.tsx:16-50`):
```ts
const handleCopy = useCallback(async () => {
  try {
    await navigator.clipboard.writeText(url);
    setCopied(true); setCopyFailed(false); setTimeout(() => setCopied(false), 2000); return;
  } catch { /* fall through to execCommand */ }
  let fallbackSucceeded = false;
  const input = document.createElement("input");
  try { input.value = url; document.body.appendChild(input); input.select();
        fallbackSucceeded = document.execCommand("copy"); }
  catch { fallbackSucceeded = false; }
  finally { if (input.parentNode) input.parentNode.removeChild(input); }
  if (fallbackSucceeded) { setCopied(true); setCopyFailed(false); setTimeout(() => setCopied(false), 2000); }
  else { setCopyFailed(true); setTimeout(() => setCopyFailed(false), 4000); }  // #43: badge fires ONLY on real success
}, [url]);
```
Generate flow per UI-SPEC §Interaction State Matrix: `none → Share`(accent `size="sm"`) → `generating ("Generating…")` → on success mint+copy → `copied ("Link copied!"` `role="status"` `aria-live="polite"`) → settle to `active` (`Copy link` secondary + `Revoke` danger). Copy-failed → `role="alert"` `"Copy failed — copy the link manually"`.

---

### 8. `supabase/tests/test_scenario_shares_rls.sql` — the load-bearing CONTENT leak test

**Analog:** `supabase/tests/test_scenarios_rls.sql` — plain PL/pgSQL `DO $$ … RAISE EXCEPTION`, no pgTAP, auto-discovered by ci.yml `test_*.sql` glob.

**Two-tenant seed + role-forge + content-by-row-id assertion to mirror** (`test_scenarios_rls.sql:60-137`):
```sql
-- seed tenant A + B via auth.users → profiles → scenarios (+ here: scenario_shares + published strategy w/ analytics)
INSERT INTO auth.users (id, instance_id, email, ...) VALUES (uid_a, '00000000-...', 'test-...-a@quantalyze.test', ...);
INSERT INTO profiles (id, ..., role) VALUES (uid_a, ..., 'allocator') ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, ...;
-- forge jwt so auth.uid() resolves, drop to authenticated so RLS applies:
PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a::text, 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
-- CONTENT assertion BY ROW ID (not a 200/row-count):
IF EXISTS (SELECT 1 FROM scenarios WHERE id = scen_b_id) THEN
  RESET ROLE; RAISE EXCEPTION 'TEST FAILED: tenant A can see tenant B scenario — CROSS-TENANT LEAK';
END IF;
```
**Anon-blocked-at-grant-layer assertion to mirror** (`test_scenarios_rls.sql:225-247`):
```sql
PERFORM set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE anon;
BEGIN PERFORM 1 FROM scenario_shares WHERE id = ...; EXCEPTION WHEN OTHERS THEN raised := TRUE; err_state := SQLSTATE; END;
RESET ROLE;
IF NOT raised THEN RAISE EXCEPTION 'anon SELECT on scenario_shares SUCCEEDED — REVOKE ALL FROM anon not applied'; END IF;
IF err_state <> '42501' THEN RAISE EXCEPTION 'anon SELECT raised %, expected 42501', err_state; END IF;
```
**Cross-tenant write → 0 rows (no error, RLS silently scopes)** to mirror (`test_scenarios_rls.sql:144-158`):
```sql
UPDATE scenario_shares SET revoked_at = now() WHERE id = <B's share id>;   -- as tenant A
GET DIAGNOSTICS affected = ROW_COUNT;
IF affected <> 0 THEN RESET ROLE; RAISE EXCEPTION 'tenant A revoke of B share affected % rows — CROSS-TENANT WRITE', affected; END IF;
```
**Phase-25-SPECIFIC assertions the analog does NOT have (RESEARCH §Pitfall 2 + SHARE-02/03):**
- Call `get_shared_scenario(rawToken_A)` and assert the returned `series` jsonb contains ONLY A's published `addedStrategies[].id`(s) and NO key matching `api_key|allocated_amount|account_balance|value_usd` (CONTENT-by-field, because RLS/SECURITY DEFINER fails silently — a test that returns 200 is NOT proof).
- A draft whose `addedStrategies` is empty (pure holdings reweight) → `series = []` (no holdings leak).
- UNKNOWN token → 0 rows (→ 404). Revoke-immediacy: `UPDATE ... SET revoked_at = now()` then the SAME token → 0 rows.
- Tenant B's token resolves ONLY B's content, never A's.

Header conventions to reproduce (`test_scenarios_rls.sql:1-31`): the "RLS FAILS SILENTLY → assert CONTENT by row id" rationale, the `psql -v ON_ERROR_STOP=1` usage line, the defensive pre-clean + teardown `DELETE FROM auth.users WHERE email IN (...)` bookends.

---

### 9. vitest tests (token lib, share-resolve helper, SavedScenariosList extension)

**Analog:** `SavedScenariosList.test.tsx` T_SL7b/T_SL7c (the honest-failure + onMutated-not-on-failure pattern).

**Pattern to extend** (`SavedScenariosList.test.tsx:222-281`):
```ts
// T_SL7b Rename failure shows an honest alert and does not signal success
expect(alert.textContent).toContain("Couldn't rename this scenario");
expect(onMutated).not.toHaveBeenCalled();   // fires ONLY on success
// T_SL7c Delete failure ... keeps the row
expect(onMutated).not.toHaveBeenCalled();
```
Add Share/Copy/Revoke state-machine cases mirroring these: generate-error → `role="alert"` `"Couldn't create a share link…"` + `onMutated` not fired; revoke-error → `role="alert"` `"Couldn't revoke this link…"` + share stays active; copied success badge fires only on real clipboard success.

**Token lib unit test (`scenario-share-token.test.ts`, new):** assert `raw` decodes to 32 bytes (256-bit) base64url, `hash` is sha256 hex, `raw !== hash`, and `hashShareToken(raw)` is deterministic (matches the RPC digest). No analog file — but the assertion style mirrors any pure-lib `*.test.ts` (e.g. the `demo-pdf-token` spec referenced in `demo-pdf-token.ts:48`).

**Share-resolve helper unit test (new):** a `version_ahead` / garbage draft → honest-absence (decode `outcome` branch), NOT a rendered curve / live-book substitution (DI-23-01). Drive `scenarioDraftCodec.decode` with a `schema_version` > 2 blob and assert the page helper maps `"readonly"`/`"reset"` → the EmptyStateCard path.

---

## Shared Patterns

### Authentication (allocator side)
**Source:** `src/lib/api/withAllocatorAuth.ts` via `src/app/api/allocator/scenario/saved/route.ts:66`
**Apply to:** both new allocator routes (`share/route.ts`, `share/revoke/route.ts`)
```ts
export const POST = withAllocatorAuth(async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => { ... });
// user.id is the ONLY source of created_by / ownership — never read it from the request body.
```

### Token-scoped read gate (public side)
**Source:** mig 134 `_assert_no_public_execute` + mig 117 `SECURITY DEFINER SET search_path` + `REVOKE ALL FROM PUBLIC, anon`
**Apply to:** the `get_shared_scenario` RPC (the SOLE anon data path; never a direct anon table select)
```sql
SECURITY DEFINER SET search_path = public, pg_temp
... REVOKE ALL ON FUNCTION public.get_shared_scenario(text) FROM PUBLIC, anon;
DO $$ BEGIN PERFORM public._assert_no_public_execute('public.get_shared_scenario(text)'); END $$;
```

### Redacted error envelope (F5a/F5b)
**Source:** `src/app/api/allocator/scenario/saved/route.ts:143-155` + `src/app/api/benchmark/btc/route.ts:73-79`
**Apply to:** all routes + the public page
```ts
console.error("...", { message: error.message });
captureToSentry(error, { tags: { area: "scenario-share" } });
// stable UI-facing message; NEVER echo error.message (leaks schema/column names).
```

### No-store on private surfaces / cacheable on shared market data
**Source:** `src/lib/api/headers.ts:13` `NO_STORE_HEADERS` (private) vs `src/app/api/benchmark/btc/route.ts:52` `public, s-maxage=3600` (shared)
**Apply to:** every share route + the public page → `no-store`; the reused `GET /api/benchmark/btc` stays cacheable — do NOT add no-store to it (RESEARCH Anti-pattern).

### Rate-limit, limit-first
**Source:** `src/app/api/demo/portfolio-pdf/[id]/route.ts:39-49` (`publicIpLimiter`, `rateLimitDenyJson`) + `saved/route.ts:108-126` (`userActionLimiter`, `isRateLimitMisconfigured` → 503)
**Apply to:** public page → `publicIpLimiter` (10/60s/IP) before any DB/crypto work; allocator routes → `userActionLimiter` AFTER zod validation (B15 ordering, so a 400 never burns a token).

### Honest empty states / em-dash
**Source:** `src/components/ui/EmptyStateCard.tsx:16-27` (`{heading, body}`), `CorrelationHeatmap`, `ScenarioBenchmarkSection` (3 honest empty bodies)
**Apply to:** the recipient page — degenerate metric → "—" not 0; honest-absence → EmptyStateCard whose heading matches its body (the #509 lesson).

---

## No Analog Found

None. Every file has a strong in-tree analog (the phase reuses Phase 23 persistence, the mig-117/134 SECURITY DEFINER canon, the Phase 24 benchmark engine + public route, the demo/factsheet public-page precedents, and the shipped ShareableLink + SavedScenariosList state machines). The only genuinely net-new artifact is `src/lib/scenario-share-token.ts`, and it is a thin adaptation of `demo-pdf-token.ts` (HMAC → random+stored-hash).

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `src/app/api/allocator/scenario/`, `src/app/api/demo/`, `src/app/api/benchmark/`, `src/app/demo/`, `src/app/factsheet/`, `src/app/(dashboard)/allocations/`, `src/components/strategy/`, `src/components/ui/`, `src/lib/`.
**Files scanned (read in full or targeted):** 13 — 3 migrations, 1 SQL test, 4 routes/pages, 1 component, 1 component-test, 1 token lib, 2 engine/codec libs.
**Cross-cutting conflicts surfaced:** (1) mig-117 *read* RPCs use `search_path = public, pg_temp` while its *mark* RPCs use `public, pg_catalog` — the share read RPC must use `public, pg_temp` (more-recent read-path canon, mig 87 H-B). (2) `SCENARIO_SCHEMA_VERSION` is **2** in live code; CONTEXT/RESEARCH prose says "1" illustratively — pin against the constant.
**Pattern extraction date:** 2026-06-22
