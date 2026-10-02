# Phase 29: Unified Composer Spine - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 7 (1 new route, 6 modified)
**Analogs found:** 7 / 7 (1 exact + composed-from-verified for the new route)

> Phase 29 is ~90% wiring of already-built, test-pinned primitives. Almost every
> file is MODIFIED, not created — so the dominant "analog" is the file's own
> existing patterns plus the sibling files it must stay consistent with. The
> single genuinely-new file (the lazy-returns route) has no exact analog; it is
> composed from two verified conventions (`browse/route.ts` RLS read + the
> saved-`[id]` route's `isUuid`-first / async-`params` shape).

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/app/api/strategies/[id]/returns/route.ts` | NEW | route (GET handler) | request-response (lazy read) | `src/app/api/strategies/browse/route.ts` (RLS read) + `src/app/api/allocator/scenario/saved/[id]/route.ts` (async-params/isUuid shape) | composed — role-match (no single exact analog) |
| `src/app/api/strategies/[id]/returns/route.test.ts` | NEW | test | request-response | `src/app/api/strategies/browse/route.test.ts` (`STATE`-driven supabase mock) | exact (test harness) |
| `src/app/api/strategies/browse/route.ts` | MOD | route (GET handler) | request-response (CRUD-read / catalog) | itself (extend the SELECT + map) | exact (self) |
| `src/app/api/strategies/browse/route.test.ts` | MOD | test | request-response | itself (T3/T12 absence + pseudonymity cases) | exact (self) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | MOD | component (client) | event-driven (UI state → frozen-engine recompute) | itself (`addedStrategyReturnsLookup`, `projectionState`, `handleReset`, `openSavedScenario`, empty-state, save toolbar) | exact (self) |
| `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | MOD | component (client) | request-response (lazy-on-open fetch) + event-driven (add) | itself + `ScenarioBuilder.tsx:286` (Example pill recipe) | exact (self) |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | MOD | component (client) | CRUD (PATCH/DELETE) | itself (rename/delete/open inline) | exact (self) |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | MOD (likely) | provider/host | event-driven (tab state) | itself (`ScenarioComposer` dynamic host + `?tab=scenario`) | exact (self) — Assumption A2: edit may prove unnecessary |

**Reused-verbatim (NOT edited — flow through unchanged):**
`src/lib/scenario.ts` (frozen engine, SCENARIO-05), `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` (`buildStrategyForBuilderSet`), `src/app/(dashboard)/allocations/lib/scenario-state.ts` (`scenarioDraftCodec`, `defaultDraftFromHoldings`), `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` (`addStrategyBrowse`/`hydrateFromSaved`/`reset`), `src/app/api/allocator/scenario/saved/route.ts` + `saved/[id]/route.ts` (save/list/rename/update/delete — copy relabel only, zero route change), `src/lib/visibility.ts` (`withPublishedOnly`), `src/lib/strategy-display.ts` (`displayStrategyName`).

---

## Pattern Assignments

### `src/app/api/strategies/[id]/returns/route.ts` (NEW route, request-response)

**Analog A (RLS read + redaction + headers):** `src/app/api/strategies/browse/route.ts`
**Analog B (async-`params` + `isUuid`-first + inner-wrapper):** `src/app/api/allocator/scenario/saved/[id]/route.ts`

This route has NO single exact analog — it is the verified composition the
RESEARCH names (Implementation shape, RESEARCH lines 133-136). Copy the import
block and RLS posture from Analog A; copy the dynamic-`[id]` plumbing from
Analog B.

**Imports + runtime pattern** — copy from `browse/route.ts:1-10,37`:
```typescript
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";          // RLS-scoped — NOT createAdminClient
import { withPublishedOnly } from "@/lib/visibility";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
export const runtime = "nodejs";   // AGENTS.md: explicit Node runtime — server client needs the cookie store
```

**Dynamic-`[id]` + isUuid-first + inner-wrapper shape** — copy from `saved/[id]/route.ts:55,142-147` (the wrappers do NOT forward route context; validate the id BEFORE auth so bad input never burns a token):
```typescript
type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;          // async params (AGENTS.md / Next 16)
  if (!isUuid(id)) return NextResponse.json(
    { error: "Invalid strategy id" },
    { status: 400, headers: NO_STORE_HEADERS },
  );                                         // 400 maps would-be 22P02; runs before auth/rate-limit
  return withAllocatorAuth(
    async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
      /* rate-limit AFTER validation (B15), per-user key; RLS read below */
    },
  )(req);
}
```

**RLS read + published existence-probe + redaction** — adapt from `browse/route.ts:98-131` (existence probe uses the `.eq("id", id)` + `withPublishedOnly` defense-in-depth; `analytics_read` RLS permits any caller to read published-strategy analytics — VERIFIED live anon-read 200, RESEARCH Pattern 3):
```typescript
const supabase = await createClient();                    // RLS — NEVER createAdminClient
const { data: strat } = await withPublishedOnly(
  supabase.from("strategies").select("id").eq("id", id),
).maybeSingle();
if (!strat) return NextResponse.json(
  { error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
const { data, error } = await supabase
  .from("strategy_analytics").select("daily_returns").eq("strategy_id", id).maybeSingle();
if (error) {
  console.error("[api/strategies/returns] select error:", error);   // F5b — never forward error.message
  captureToSentry(error, { tags: { route: "api/strategies/returns" } });
  return NextResponse.json(
    { error: "Failed to load returns" }, { status: 500, headers: NO_STORE_HEADERS });
}
const daily_returns = Array.isArray(data?.daily_returns) ? data!.daily_returns : [];
return NextResponse.json({ daily_returns }, { status: 200, headers: NO_STORE_HEADERS });
```

**Rate-limit ordering** — copy from `browse/route.ts:84-96`: per-user key `returns:${user.id}`, `checkLimit(userActionLimiter, ...)`, 429 + `Retry-After`. (Scope is one id per call — `is_example` is NOT a separate gate; `status='published'` covers verified AND example published rows.)

**Exit-gate guards (do NOT violate):** no `createAdminClient`; `withPublishedOnly` MUST be called; one-id-per-call (never an unbounded pull); raw Postgres error never reaches the client.

---

### `src/app/api/strategies/[id]/returns/route.test.ts` (NEW test)

**Analog:** `src/app/api/strategies/browse/route.test.ts` (exact harness match)

Copy the `vi.hoisted(STATE)` + `vi.mock("@/lib/supabase/server")` chained-builder
mock verbatim (`route.test.ts:29-134`). Key reusable scaffolding:
- `vi.mock("server-only", () => ({}))` (line 27) — required or the supabase/audit imports throw under vitest.
- `STATE.profileRole` + the `from("profiles")` arm (lines 71-88) so `withAllocatorAuth` runs end-to-end without mocking the helper.
- `STATE.observedFilters` to assert the SELECT/`.eq` shape, and a `STATE.strategiesQueried`-style flag to prove the gate short-circuits (mirror T10 line 375-388).
- `captureSpy` (lines 146-149) to pin the redaction channel on the 500 path.

Required cases (RESEARCH Validation Architecture, UNIFY-04 server side): 400 on bad uuid (before auth), 404 on unpublished, 200 + `{daily_returns}` on published, NO raw error on 500 (`captureToSentry` called), NO `createAdminClient`, per-user rate-limit 429.

---

### `src/app/api/strategies/browse/route.ts` (MOD route, request-response)

**Analog:** itself — extend the existing SELECT + map; the LOCKED RLS contract is already implemented here.

**Extend the SELECT to co-fetch `is_example`** (current SELECT at line 109-119; the response stays metadata-only, NO `daily_returns`):
```typescript
const { data, error } = await withPublishedOnly(
  supabase
    .from("strategies")
    .select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"),  // ADD is_example
)
  .order("name", { ascending: true })
  .limit(STRATEGY_BROWSE_LIMIT + 1);
```

**Map: `is_example` drives the tag; pseudonymity unchanged** (extend the projection at lines 157-182 — `displayStrategyName` runs on example rows too):
```typescript
return {
  id: r.id,
  name: safeLabel,                       // displayStrategyName — pseudonymity on example rows too
  codename: r.codename ?? null,
  markets: Array.isArray(r.markets) ? r.markets : [],
  strategy_types: Array.isArray(r.strategy_types) ? r.strategy_types : [],
  is_example: r.is_example === true,     // NEW field on BrowseStrategyRow (drives the "Example" tag)
};
```
Add `is_example: boolean` to the `BrowseStrategyRow` interface (line 39-54). **Critical (H-0300 allow-list fence, route.test.ts:598-650):** the map projects an EXPLICIT allow-list — do NOT switch to `{ ...row }`; add `is_example` as a named key so the forbidden-key test still proves no extra column leaks.

**Forbidden:** `is_example=true` must NOT become a `.or(...)` that bypasses `withPublishedOnly` — example rows are just published rows that also carry the flag (RESEARCH Code Examples, lines 320-335).

---

### `src/app/api/strategies/browse/route.test.ts` (MOD test)

**Analog:** itself — the absence/pseudonymity cases already exist (T3 observes the `status` filter; T12a-e pin `displayStrategyName`).

Add the non-vacuous leak case (RESEARCH Pitfall 2): seed `STATE.strategyRows` with an unpublished example row AND a cross-tenant row, assert neither reaches the response WITH `is_example` included, AND that an example row's response `name` === its pseudonymity-safe label (codename / `Strategy #<id>`), never the raw name. Mirror T12a's `JSON.stringify(body)).not.toContain("<rawName>")` whole-payload sweep (lines 491-492). Extend T12e (line 572) to assert `is_example` is in the SELECT list.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (MOD component, event-driven)

**Analog:** itself — all the hard parts are landed; Phase 29 wires three things in.

**(1) Entry-mode switch routes through the existing reset discipline** — reuse `handleReset` (lines 519-528) + `ResetConfirmationModal` (rendered at 1787-1795, defined at 2033). A mode switch that would discard a dirty draft (`scenario.diffCount > 0`) MUST open `setResetModalOpen(true)`, NOT call `scenario.reset()` directly (RESEARCH Pattern 1 / Pitfall 5):
```typescript
const handleReset = useCallback(() => {
  scenario.reset();                 // removeStored + re-init to default
  setLoadedScenarioId(null);
  setLoadedScenarioName(null);
  setLoadedReadonly(false);
  setOpenNotice(null);
  /* ... */
}, [scenario.reset]);
```

**(2) Lazy-returns plumbing into `addedStrategyReturnsLookup`** — the current lookup (lines 777-790) is keyed ONLY off `strategyById` built from `payload.strategies` (book-only — RESEARCH reason #2: this is the H-0133 gap for verified-add too). Add a client-side `addedReturnsById` map populated by a fetch to `/api/strategies/[id]/returns` on `addStrategyBrowse`, and merge it (payload wins when present — Open Question #1):
```typescript
const addedStrategyReturnsLookup = useMemo<Record<string, DailyPoint[]>>(() => {
  const map: Record<string, DailyPoint[]> = {};
  for (const a of scenario.draft.addedStrategies) {
    const found = strategyById.get(a.id);
    const raw = found?.strategy.strategy_analytics?.daily_returns;
    const fromBook = Array.isArray(raw) ? (raw as unknown as DailyPoint[]) : null;
    map[a.id] = fromBook ?? addedReturnsById[a.id] ?? [];   // payload wins; lazy fills the gap
  }
  return map;
}, [scenario.draft.addedStrategies, strategyById, addedReturnsById]);
```
The adapter call (lines 827-856) and the projection/engine path (`projectionState` 891-918 → `deAliased` 926-934 → `computeScenario` 939-942) are UNCHANGED — the series flows through the frozen engine. While the fetch is in flight the strategy contributes `[]` (warm-up-gated out) — surface an honest "loading returns…" affordance, NEVER a fabricated flat series (Pitfall 4).

**(3) "Portfolio" copy relabel** — empty-state heading/body (lines 1242-1274), save toolbar labels (lines 1334/1348/1361, placeholder 1374-1375), `openSavedScenario` notices (lines 552/564). Use the UI-SPEC §Copywriting table verbatim. Code/route/state names stay "scenario".

**Reopen codec trichotomy (LOCKED — reuse, do not weaken)** — `openSavedScenario` (lines 539-584) already branches `reset`/`readonly`/`ok` through `scenarioDraftCodec(defaultDraft).decode(...)`. Only relabel the two notice strings; never replace the codec with a bare `JSON.parse(row.draft) as ScenarioDraft` (M-0153).

**Empty-state = blank-slate front door** — the `isEmptyState` branch (lines 1236-1291) already renders the serif card + dual CTA (`Connect Exchange →` accent / `Browse strategies` border) + the `StrategyBrowseDrawer`. Relabel copy to "Start a portfolio"; the "Blank slate" path is reachable here.

---

### `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (MOD component, lazy-fetch + event-driven)

**Analog:** itself (lazy-on-open lifecycle) + `src/components/scenarios/ScenarioBuilder.tsx:286` (Example pill recipe).

**Lazy-on-open fetch lifecycle — keep verbatim** (lines 149-196): `AbortController` + `cancelled` flag, H-0117 loud-fail (a non-cleanup AbortError surfaces the error, never wedges "Loading…"), H-0082b close-reset of the fetch trio. Do NOT fork this lifecycle for the lazy-returns fetch — that fetch lives in the composer's add handler, not the drawer.

**Add `is_example` to the row shape + interleave** — extend `StrategyBrowseRow` (lines 43-49) with `is_example?: boolean`; the client-side `filtered` memo (lines 264-289) already searches/filters over all rows — example rows interleave by name automatically.

**"Example" pill — copy the neutral-outline recipe verbatim from `ScenarioBuilder.tsx:286-291`** (NOT accent, NOT a filled `<Badge>` — accent = verified/action; example = provenance metadata). Render it inside the row's label block (next to `s.name` at line 486-493), gated on `s.is_example`:
```tsx
<span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted">
  Example
</span>
```
This is the SAME recipe as the composer's PROJECTED pill (`ScenarioComposer.tsx:1306-1311`) — one neutral-outline family.

**Add gesture — unchanged** (`handleAdd` lines 317-346): one click → `onAdd({id,name,markets,strategy_types})` → composer's `addStrategyBrowse`; "Added ✓ → opacity-60" dim-timer stays; drawer stays open for multi-add.

**Title relabel** — drop "verified" → "Browse strategies" (lines 373 `aria-label` + 391-393 heading). Empty-state copy "No strategies are live yet." (line 452, drop "verified").

---

### `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (MOD component, CRUD)

**Analog:** itself — Open / Rename (inline → PATCH) / Delete (inline danger confirm → DELETE) already implemented.

**Reuse verbatim, relabel copy only:**
- `submitRename` (lines 307-336): `fetch(\`/api/allocator/scenario/saved/${row.id}\`, { method: "PATCH" })` — route UNCHANGED.
- `confirmDelete` (lines 338-355): `fetch(..., { method: "DELETE" })` — route UNCHANGED. Inline `Delete "{name}"?` danger confirm (lines 496-511), NOT a modal.
- `onOpen` (line 74, invoked ~544) delegates to the composer's codec-trichotomy Open handler — UNCHANGED.

Relabel: section heading "Saved scenarios" → "Saved portfolios"; empty-state heading/body; rename `aria-label` (line 449); validation copy. Use UI-SPEC §Copywriting verbatim. The Share affordance + "Compare selected" gate stay as shipped.

---

### `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (MOD — likely, Assumption A2)

**Analog:** itself — already hosts `ScenarioComposer` via `dynamic()` (lines 119-122) at `?tab=scenario` and owns tab/scenario-state preservation.

The segmented entry-mode control lives in the composer body, so this edit may prove
unnecessary (RESEARCH A2). IF a tab-level nudge is needed to surface the
blank-slate front door for no-book allocators, follow the existing tab-button +
`dynamic()` host pattern. Preserve the `.scenario-state-preservation.test.tsx`
contract — do not regress tab-switch state retention.

---

## Shared Patterns

### Authentication / Authorization (V2 + V4)
**Source:** `src/lib/api/withAllocatorAuth.ts` (`withAllocatorAuth` wrapper) + RLS policies (`supabase/migrations/20260405061912_rls_policies.sql:36-42`)
**Apply to:** every new/edited route (`[id]/returns`, `browse`).
- `withAllocatorAuth(async (req, user) => ...)` gates role IN ('allocator','both') → 403 BEFORE any DB query (browse `route.test.ts:375-388` proves the catalog query never fires on a 403).
- For the dynamic `[id]` route the wrapper does NOT forward `ctx` — validate `isUuid(id)` first, then call `withAllocatorAuth(...)(req)` (pattern: `saved/[id]/route.ts:142-147`).
- RLS-scoped `createClient()` ONLY — `createAdminClient()` is the LOCKED exit-gate anti-pattern (it is what `/scenarios/page.tsx:58` does; do NOT carry it over, do NOT edit that file — Phase 32).

### Published-only + pseudonymity (V4 + Info-Disclosure)
**Source:** `src/lib/visibility.ts` (`withPublishedOnly`) + `src/lib/strategy-display.ts` (`displayStrategyName`)
**Apply to:** every `strategies` read this phase (browse extend + returns existence-probe).
- `withPublishedOnly(supabase.from("strategies").select(...))` — defense-in-depth over RLS; the B25 lint rule bans raw `.eq("status","published")`.
- `displayStrategyName({ id, name, codename, disclosure_tier })` on every browse row INCLUDING example rows (browse `route.ts:167-172`); the C-0112 leak test (T12a-e) pins it.

### Error redaction + cache headers (Info-Disclosure + V3)
**Source:** `src/app/api/strategies/browse/route.ts:121-131` + `src/lib/api/headers.ts` (`NO_STORE_HEADERS`)
**Apply to:** every response (success + error) on every new/edited route.
```typescript
if (error) {
  console.error("[route] select error:", error);          // server-side only
  captureToSentry(error, { tags: { route: "<name>" } });  // Sentry
  return NextResponse.json({ error: "<static message>" },  // NEVER error.message
    { status: 500, headers: NO_STORE_HEADERS });
}
```
`NO_STORE_HEADERS` (= `Cache-Control: private, no-store`) on 200/400/404/429/500 so allocator payloads never hit a shared cache (browse `route.test.ts` T11a-c).

### Rate-limit ordering (B15) (DoS)
**Source:** `src/app/api/allocator/scenario/saved/route.ts:106-126` + `browse/route.ts:84-96`
**Apply to:** the new returns route.
- Validate (uuid / body) FIRST so a 400 never burns a token, THEN `checkLimit(userActionLimiter, "<scope>:${user.id}")`. Per-user key, 429 + `Retry-After` (+ 503 on `isRateLimitMisconfigured`).

### Reopen decode trichotomy (success-criterion-3 honesty guard)
**Source:** `src/app/(dashboard)/allocations/lib/scenario-state.ts:599-644` (`scenarioDraftCodec`) wired at `ScenarioComposer.tsx:539-584`
**Apply to:** the reopen-named-portfolio path (reuse verbatim; relabel notices only).
- `decode()` → `ok` (hydrate + adopt id, editable) / `readonly` (hydrate real data + block Update + notice) / `reset` (NO hydrate, honest "older format" notice). Never a bare `JSON.parse(row.draft) as ScenarioDraft` (M-0153).

### Frozen engine + adapter (zero-diff)
**Source:** `src/lib/scenario.ts` (`computeScenario`, SCENARIO-05) via `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` (`buildStrategyForBuilderSet`)
**Apply to:** the add→projection path — the ONLY new input is the lazy series in `addedStrategyReturnsLookup`. Zero engine change; one 252-day annualization convention (never a √365 path). `git diff --exit-code src/lib/scenario.ts` must stay clean.

---

## No Analog Found

No file lacks a usable analog. The one NEW file
(`src/app/api/strategies/[id]/returns/route.ts`) has no SINGLE exact analog, but
is fully composable from two verified ones (browse RLS read + saved-`[id]`
dynamic-param shape) — so the planner does NOT need RESEARCH.md's generic
examples here; the concrete excerpts above cover it.

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `src/app/api/strategies/[id]/returns/route.ts` | route | request-response | No single exact analog; composed from `browse/route.ts` (RLS read/redaction/headers) + `saved/[id]/route.ts` (async-`params` / isUuid-first / inner-wrapper). All excerpts provided above. |

---

## Metadata

**Analog search scope:** `src/app/api/strategies/`, `src/app/api/allocator/scenario/saved/`, `src/app/(dashboard)/allocations/{components,hooks,lib}/`, `src/components/scenarios/`, `src/lib/{scenario,visibility,strategy-display}.ts`.
**Files scanned (read in full or targeted):** `browse/route.ts`, `browse/route.test.ts`, `saved/route.ts`, `saved/[id]/route.ts`, `ScenarioComposer.tsx` (targeted: 515-614, 745-975, 1236-1395, 1745-1820, 2025-2092), `StrategyBrowseDrawer.tsx`, `ScenarioBuilder.tsx:270-308`, `SavedScenariosList.tsx` (grep), `useScenarioState.ts` (grep), `scenario-adapter.ts` (grep), `scenario-state.ts` (grep), `AllocationsTabs.tsx` (grep).
**Confirmed:** `src/app/api/strategies/[id]/returns/` does NOT exist yet (only `browse`, `create-with-key`, `csv-finalize`, `csv-validate`, `draft`, `finalize-wizard`).
**Pattern extraction date:** 2026-06-23
