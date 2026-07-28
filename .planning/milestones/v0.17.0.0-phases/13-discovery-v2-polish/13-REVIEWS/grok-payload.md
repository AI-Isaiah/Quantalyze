# PHASE 13 PEER REVIEW REQUEST — Grok 4.2 (outside voice)

## Phase Goal
/discovery/[slug] reaches IA parity with Quants.Space — Watchlist sub-tab, per-user-keyed Customize prefs in localStorage, single-accent sparkline rule, default Hide Examples backed by a seed-row data backfill, and (audit-gated) filter-by-team.

## In-scope REQs
DISCO-01 (Watchlist), DISCO-02 (Customize prefs), DISCO-04 (Sparkline single-accent), DISCO-05 (Hide examples default + seed backfill).
DISCO-03 deferred to v0.18 (audit_count=0 in production DB on 2026-04-28).

## Recent Context
- Branch: feature/v0.17-sprint-13 (off main)
- Phase 12 (KPI Parity backend) merged to main via PR #81
- PR #82 then landed 089_claim_failed_retry.sql on main between CONTEXT capture and now → Phase 13's only new migration is 090_seed_is_example_backfill.sql (DISCO-05 data-only DML)
- The plan-checker (gsd-plan-checker, sonnet) already returned APPROVED after one revision; this peer review is a second outside-voice pass.

## Files (concatenated below)

==== FILE: 13-CONTEXT.md ====
# Phase 13: Discovery v2 Polish - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

`/discovery/[slug]` reaches IA parity with Quants.Space — Watchlist sub-tab on the existing
`StrategyFilters` row, per-user-keyed Customize prefs in localStorage, single-accent
Sparkline rule (DESIGN.md DIFF-05), default "Hide examples" backed by a seed-row data
backfill, and (audit-gated) filter-by-team with privacy gate via
`organizations.is_public`. No changes to the Python `analytics-service`. No DDL beyond
the conditional migration `088_organizations_is_public.sql` (only ships if
`SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'`
returns > 0).

Phase 13 is independent of Phase 12 (parallel wave) and does not block Phase 14a/14b.

</domain>

<decisions>
## Implementation Decisions

### Watchlist UX & Star Toggle (DISCO-01)
- "My Watchlist" sub-tab lives **inside the existing `StrategyFilters` row** as a 2-tab
  segmented control "All / My Watchlist", visible above the table/grid surface. The
  Watchlist tab carries a count badge sourced from the watched-set length.
- Star icon position in **table rows: leading column** (left of strategy name) — matches
  Quants.Space convention and is fast to scan in dense tables.
- Star icon position on **grid cards: top-right corner overlay** — standard card
  affordance (matches existing `StrategyGrid` card layout).
- Rapid double-click idempotency is **server-side**: `PUT /api/watchlist/[strategyId]`
  upserts to `user_favorites` (`ON CONFLICT DO NOTHING` for add, `DELETE` for remove);
  the client uses optimistic UI with no client-side debounce. The PUT body carries
  `{ action: "add" | "remove" }`.

### Customize Prefs Modal (DISCO-02)
- Customize trigger is a **settings-cog icon button at the right end of the existing
  `StrategyFilters` row** (next to sort dropdowns). No new top-level header surface.
- Customize panel is a **right-edge slide-out drawer** matching DESIGN.md
  "Modals: White surface, subtle shadow, slide-out panels from right edge".
- **No migration of any prior `discovery_view_preferences*` localStorage keys** — the
  `{auth.uid}:{slug}` keying scheme is fresh; no prior version was deployed to
  allocators.
- **Defaults when localStorage key is missing**: `view = "table"`,
  `sort = { key: "sharpe", dir: "desc" }`, `hide_examples = true`. The
  `hide_examples = true` default is required by DISCO-05.

### Audit Gate, Seed Backfill & Visual Regression (DISCO-03 / DISCO-04 / DISCO-05)
- The `organization_id` population audit SQL runs **inline via Supabase MCP at
  plan-phase time** against the production DB (`khslejtfbuezsmvmtsdn`). The single
  query is `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND
  status='published'`. The integer result is recorded in
  `.planning/phases/13-discovery-v2-polish/TODOS.md` (under a "DISCO-03 audit" section
  header) **before any DISCO-03 plan task is generated** — gate decision is locked
  before planning continues.
- **If audit count = 0**: migration `088_organizations_is_public.sql` is **not shipped**;
  DISCO-03 (filter-by-team UI) is **deferred to v0.18** with a TODOS entry. This
  matches phase success criterion 4 verbatim.
- **If audit count > 0**: migration 088 ships (adds `is_public BOOLEAN DEFAULT false`
  to `organizations`); the filter dropdown reads only orgs `WHERE is_public = true`;
  surface only orgs whose strategies are visible to the allocator under existing RLS.
  Default-false avoids leaking private/stealth fund names; admin can flip orgs to
  public manually during v0.17. The `/strategies/team` opt-in toggle is deferred to
  v0.18 (out of Phase 13 scope).
- **Seed UUID source for `is_example = true` backfill**: pull the seed-strategy UUIDs
  by querying production for strategies whose `created_by` matches the seed-admin
  auth uid (with a fallback `name ILIKE 'demo_%'` pattern if the seed-admin uid is
  not available). The final UUID list is captured in the data-only migration
  produced by Phase 13. No DDL — `is_example` column already exists (migration
  001:64).
- **Sparkline visual regression harness**: add a Playwright spec under `tests/e2e/`
  that visits `/discovery/[slug]`, snapshots both the table and grid sparklines, and
  asserts no SVG `path` element mixes `#16A34A` and `#DC2626` strokes (per the
  DESIGN.md DIFF-05 single-accent rule). The spec is wired into the existing
  Playwright CI lane.

### Claude's Discretion
- Component file layout (e.g., `WatchlistTab.tsx`, `CustomizeDrawer.tsx`,
  `StarToggle.tsx`) is at Claude's discretion provided imports follow the existing
  `src/components/strategy/` and `src/components/discovery/` conventions.
- Exact API route handler structure (single PUT vs PUT + DELETE) is at Claude's
  discretion provided the success-criterion grep `PUT /api/watchlist/[strategyId]`
  is satisfied and the operation is idempotent under rapid double-click.
- Whether to read the audit count via `mcp__plugin_supabase_supabase__execute_sql`
  vs `mcp__plugin_supabase_supabase__list_tables` + a follow-up query is at
  Claude's discretion — both surface the same integer.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/strategy/StrategyTable.tsx` — already has `viewMode` (table | grid),
  `showExamples` state, `StrategyFilters`, `StrategyGrid`. Phase 13 extends rather than
  replaces.
- `src/components/strategy/StrategyFilters.tsx` — receives `viewMode`, `sortKey`,
  `sortDir`, `advancedFilters`. Add the All/Watchlist segmented control + Customize
  cog button to this row.
- `src/components/charts/Sparkline.tsx` — already single-color (`color` prop, no
  per-point segmentation). Phase 13 wires the final-value sign → color rule
  (`#1B6B5A` / `#DC2626` / `#94A3B8`) at the call site, not inside Sparkline.
- `src/lib/queries.ts` — already exports `getStrategiesByCategory`. Phase 13 adds
  `getMyWatchlist(userId)` querying `user_favorites` (migration 024 — RLS-protected,
  schema already shipped).
- `src/components/discovery/SimulateImpactButton.tsx` — pattern for row-action
  components in discovery; Star toggle follows the same structure.
- `src/lib/database.types.ts` — already has the `user_favorites` row type.

### Established Patterns
- **Client components** for any stateful UI (`"use client"` directive at top).
  StrategyTable is already a client component — Watchlist sub-tab + Customize drawer
  attach inside it.
- **Server actions / route handlers** for mutations: `PUT /api/watchlist/[strategyId]`
  follows the existing `src/app/api/.../route.ts` pattern with `createClient` from
  `@/lib/supabase/server`.
- **Optimistic UI** via `useOptimistic` or local state mirror — pattern already used in
  `OutcomesWidget.tsx` for inline edits.
- **localStorage scoping** — pattern already used in Sprint 10 Scenario Builder
  (per-allocator scoped key, `{auth.uid}` segment).
- **Visual snapshot testing** — Playwright is already in the project; `tests/e2e/` is
  the standard directory.

### Integration Points
- Discovery list page: `src/app/(dashboard)/discovery/[slug]/page.tsx` — passes
  strategies + portfolio to `StrategyTable`. Phase 13 also fetches the user's
  watched-set in parallel and threads it through.
- Watchlist API route: new file `src/app/api/watchlist/[strategyId]/route.ts`.
- `user_favorites` schema (migration 024) — full RLS already in place; Phase 13
  consumes, no DDL needed.
- Conditional new migration `088_organizations_is_public.sql` — only emitted if the
  audit returns > 0. Lives in `supabase/migrations/`.
- Data-only migration for `is_example = true` seed backfill — lives in
  `supabase/migrations/` next to 088 if it ships, or as a standalone file
  (`089_seed_is_example_backfill.sql` or similar — final number assigned at
  plan-phase time relative to whatever 088 ends up being).
- Playwright e2e spec — `tests/e2e/discovery-sparkline-regression.spec.ts` (or
  similar) — runs in the existing CI lane.

</code_context>

<specifics>
## Specific Ideas

- DESIGN.md DIFF-05 single-accent sparkline rule is the visual contract — `#1B6B5A`
  when final value > 0, `#DC2626` when < 0, `#94A3B8` when = 0. The Playwright
  regression spec exists specifically to catch any future split-color reintroduction.
- The `localStorage` key format is exactly
  `discovery_view_preferences:{auth.uid}:{slug}`. The phase success criterion explicitly
  calls for a Playwright spec that proves login-as-A-then-login-as-B leaves no A-keys
  in B's localStorage — this should be the same spec or a sibling spec.
- The audit gate behaviour is binary: 0 → defer DISCO-03 + 088, > 0 → ship both.
  No middle ground (no "ship migration without UI", no "ship UI with empty dropdown").

</specifics>

<deferred>
## Deferred Ideas

- `/strategies/team` opt-in settings UI for managers to flip their org public
  (deferred to v0.18). Phase 13 only ships the schema + read path; admin manually
  flips orgs as needed during v0.17.
- Multi-benchmark sparkline overlays (ETH/SOL) — descoped at milestone level
  (UC#6); not relevant to Phase 13.
- Keyboard navigation polish for the Customize drawer (full a11y is the Phase
  14a/14b A11Y-XX work — Phase 13 only ships standard tab order + ESC-to-close).

</deferred>

==== FILE: TODOS.md ====
# Phase 13 — Discovery v2 Polish — TODOs

## DISCO-03 Audit (run 2026-04-28 at plan-phase time)

**Query:**
```sql
SELECT COUNT(*) AS audit_count
FROM strategies
WHERE organization_id IS NOT NULL AND status='published';
```

**Result:** `audit_count = 0`

**Decision (per CONTEXT.md locked decision and ROADMAP success criterion 4):**
- The conditional `organizations.is_public` migration (originally penciled as `088_*`, then shifted) is **NOT shipped** in Phase 13.
- DISCO-03 (filter-by-team UI) is **DEFERRED to v0.18**.
- Phase 13 in-scope reduces to DISCO-01, DISCO-02, DISCO-04, DISCO-05 (4 of 5 REQs).

**Re-evaluation trigger:** Re-run the audit query at the start of v0.18 milestone planning. If `audit_count > 0` at that time, ship the `organizations.is_public` migration + filter UI as a v0.18 phase deliverable using the next-free migration number at that time. Pitfall 18 mitigation (privacy gate via `is_public BOOLEAN DEFAULT false`) remains the locked design — only the *timing* moves.

## Migration numbering (resolved 2026-04-28; updated post-rebase)

- Highest migration shipped on `main` after rebase: `089_claim_failed_retry.sql` (PR #82, queue fix — landed mid-Phase-13 planning).
- Earlier intent (CONTEXT.md): the `organizations.is_public` migration would have been `088_*`. Phase 12 took 088 (`088_cutover_strategy_metrics_keys.sql`), pushing the conditional migration to 089. PR #82 then took 089 (`089_claim_failed_retry.sql`).
- **Phase 13 deferred its only conditional migration** (would have been at the next-free number) per audit-count=0 above.
- The DISCO-05 data-only DML migration (the only new migration Phase 13 actually ships) takes the next-free number = **`090_seed_is_example_backfill.sql`**. Plan 13-05 references this filename throughout.

## Seed UUIDs (resolved 2026-04-28 from research)

`scripts/seed-demo-data.ts` defines `STRATEGY_UUIDS = ['cccccccc-0001-4000-8000-000000000001' .. '..-000000000006']` (6 UUIDs). The DISCO-05 data migration hard-codes those 6 UUIDs in the `WHERE id IN (...)` clause — no `created_by` query, no `name ILIKE` fallback (CONTEXT.md's `created_by` reference uses a column name that does not exist on `strategies`; correct column would be `user_id`, but a hard-coded list is simpler and safer).

## Open questions for planner

(Open questions from RESEARCH.md that survive the audit-count=0 simplification:)

1. **Watchlist PUT rate limiter:** `mandateAutoSaveLimiter` (30/min) recommended over `userActionLimiter` (5/min) — star toggling can legitimately exceed 5/min during browsing.
2. **Optimistic UI primitive:** `useTransition` + local mirror (codebase consistency with `AllocatorExchangeManager.tsx`) over React 19 `useOptimistic` (not yet adopted in-tree).
3. **Logout route URL** for the cross-account Playwright spec — needs verification by planner (likely user-menu sign-out button, not a `/logout` page).
4. **Playwright cross-account spec** — confirm test-user env vars (`E2E_USER_A_EMAIL` / `_PASSWORD` / `E2E_USER_B_EMAIL` / `_PASSWORD` or similar) are wired into Playwright CI; if not, descope DISCO-02 cross-account spec to manual UAT.

## DISCO-03 closed (deferred)

Audit returned 0; no further action in Phase 13 for DISCO-03.

==== FILE: 13-01-PLAN.md ====
---
phase: 13
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/api/watchlist/[strategyId]/route.ts
  - src/app/api/watchlist/[strategyId]/route.test.ts
  - src/lib/queries.ts
  - src/lib/queries.test.ts
  - src/components/strategy/StarToggle.tsx
  - src/components/strategy/StarToggle.test.tsx
  - src/components/strategy/WatchlistTabs.tsx
  - src/components/strategy/WatchlistTabs.test.tsx
  - src/components/strategy/EmptyWatchlist.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyTable.test.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/app/(dashboard)/discovery/[slug]/page.tsx
  - e2e/discovery-watchlist.spec.ts
autonomous: true
requirements:
  - DISCO-01
tags:
  - watchlist
  - discovery
  - star-toggle
  - user-favorites
  - csrf
  - rate-limit

must_haves:
  truths:
    - "Allocator can star a strategy from any row on /discovery/[slug] and the leading-column star icon flips to filled"
    - "Allocator can star a strategy from any card on /discovery/[slug] and the top-right corner star icon flips to filled"
    - "After starring, refreshing the page shows the same strategy still starred (server-persisted via user_favorites)"
    - "Allocator can switch between 'All' and 'My Watchlist' tabs and only watchlisted strategies appear in the My Watchlist scope"
    - "My Watchlist tab carries a numeric count badge equal to the watched-set size when non-zero; the badge is hidden when zero"
    - "Rapid double-clicks on a star toggle do not produce duplicate user_favorites rows or 500-class errors"
    - "Empty watchlist (zero starred) renders the EmptyWatchlist two-line empty state pointing back to the All tab"
  artifacts:
    - path: "src/app/api/watchlist/[strategyId]/route.ts"
      provides: "PUT handler accepting { action: 'add' | 'remove' }, idempotent server-side via ON CONFLICT DO NOTHING + DELETE"
      exports: ["PUT"]
    - path: "src/app/api/watchlist/[strategyId]/route.test.ts"
      provides: "Vitest unit tests covering 401 on unauth, 400 on bad body, 429 on rate-limit, idempotent add/remove, CSRF rejection"
    - path: "src/lib/queries.ts"
      provides: "getMyWatchlist(userId): Promise<Set<string>> server-side query"
      contains: "export async function getMyWatchlist"
    - path: "src/components/strategy/StarToggle.tsx"
      provides: "Polymorphic star button with optimistic UI, useTransition primitive, 200ms double-click absorption, retry-once-on-failure"
      exports: ["StarToggle"]
    - path: "src/components/strategy/WatchlistTabs.tsx"
      provides: "Two-tab segmented control (All / My Watchlist) with WAI-ARIA tablist + count badge"
      exports: ["WatchlistTabs"]
    - path: "src/components/strategy/EmptyWatchlist.tsx"
      provides: "Two-line empty state: 'Your watchlist is empty' / 'Star strategies from the All tab to track them here.'"
      exports: ["EmptyWatchlist"]
    - path: "e2e/discovery-watchlist.spec.ts"
      provides: "Playwright spec — login, star a strategy, reload, assert still starred, assert count=1, switch to My Watchlist tab, assert one row"
  key_links:
    - from: "src/components/strategy/StarToggle.tsx"
      to: "PUT /api/watchlist/[strategyId]"
      via: "fetch() with method=PUT, body={action: 'add' | 'remove'}, Content-Type: application/json"
      pattern: "fetch\\(`/api/watchlist/\\$\\{strategyId\\}`"
    - from: "src/app/api/watchlist/[strategyId]/route.ts"
      to: "supabase.from('user_favorites')"
      via: "upsert with onConflict=user_id,strategy_id and ignoreDuplicates=true; delete with .eq('user_id', user.id).eq('strategy_id', strategyId)"
      pattern: "from\\(\"user_favorites\"\\)"
    - from: "src/app/(dashboard)/discovery/[slug]/page.tsx"
      to: "src/lib/queries.ts:getMyWatchlist"
      via: "Promise.all parallel fetch with getStrategiesByCategory + getRealPortfolio"
      pattern: "getMyWatchlist\\(user\\.id\\)"
    - from: "src/components/strategy/StrategyTable.tsx"
      to: "src/components/strategy/WatchlistTabs.tsx + StarToggle.tsx + EmptyWatchlist.tsx"
      via: "props: scope state, watchedSet local mirror, userId thread-through"
      pattern: "<WatchlistTabs|<StarToggle|<EmptyWatchlist"
---

<objective>
Ship DISCO-01 — the Watchlist sub-tab on /discovery/[slug]. Allocators star strategies via a leading-column star (table) or top-right card overlay (grid), persist to existing user_favorites table (migration 024) via a new PUT /api/watchlist/[strategyId] route, and switch between "All" and "My Watchlist" scopes via a 2-tab segmented control inside the existing StrategyFilters row. Idempotency lives server-side (ON CONFLICT DO NOTHING for add, DELETE for remove); the client uses optimistic UI with useTransition. CSRF + rate-limit (mandateAutoSaveLimiter, 30/min) inherited from project conventions.

Purpose: Ship the Watchlist UX layer that DISCO-01 mandates. This is the foundational plan for Phase 13 — every later plan extends StrategyTable on top of the scope state established here.

Output: 1 new API route handler + 1 new server-side query + 4 new React components + extensions to StrategyTable / StrategyGrid / discovery page + 1 new Playwright spec + 4 new test files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/13-discovery-v2-polish/13-CONTEXT.md
@.planning/phases/13-discovery-v2-polish/13-RESEARCH.md
@.planning/phases/13-discovery-v2-polish/13-UI-SPEC.md
@.planning/phases/13-discovery-v2-polish/13-VALIDATION.md
@.planning/phases/13-discovery-v2-polish/TODOS.md
@DESIGN.md
@./CLAUDE.md
@./AGENTS.md

@src/components/strategy/StrategyTable.tsx
@src/components/strategy/StrategyGrid.tsx
@src/components/strategy/StrategyFilters.tsx
@src/app/(dashboard)/discovery/[slug]/page.tsx
@src/lib/queries.ts
@src/lib/api/withAuth.ts
@src/lib/csrf.ts
@src/lib/ratelimit.ts
@src/app/api/preferences/route.ts
@src/app/api/keys/[id]/permissions/route.ts
@src/components/charts/Sparkline.tsx
@src/components/exchanges/AllocatorExchangeManager.tsx

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->
<!-- Executor uses these directly — no codebase exploration needed. -->

From src/lib/database.types.ts (user_favorites row):
```typescript
type UserFavoriteRow = {
  user_id: string;
  strategy_id: string;
  created_at: string;
  notes: string | null;
};
```

From src/lib/api/withAuth.ts:
```typescript
type AuthenticatedHandler = (req: NextRequest, user: User) => Promise<NextResponse>;
export function withAuth(handler: AuthenticatedHandler): (req: NextRequest) => Promise<NextResponse>;
// IMPORTANT: withAuth does NOT forward route ctx (params). For dynamic routes use the
// inline auth pattern from api/preferences/route.ts:28-44.
```

From src/lib/csrf.ts:
```typescript
export function assertSameOrigin(req: NextRequest): NextResponse | null;
// Returns null on pass; returns NextResponse(403) on origin mismatch.
```

From src/lib/ratelimit.ts:
```typescript
export const userActionLimiter: RateLimiter;       // 5/min  (sensitive ops)
export const mandateAutoSaveLimiter: RateLimiter;  // 30/min (autosave / star toggle bursts)
export async function checkLimit(
  limiter: RateLimiter,
  key: string,
): Promise<{ success: boolean; retryAfter: number }>;
```

From src/app/api/preferences/route.ts (canonical inline-auth pattern):
```typescript
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = await checkLimit(mandateAutoSaveLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  // ... body parse + business logic
}
```

From src/app/api/keys/[id]/permissions/route.ts (Next 16 awaited params pattern):
```typescript
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;  // Next 16 awaited promise — NOT { id } = ctx.params
  // ...
}
```

From src/components/strategy/StrategyTable.tsx (existing extension target):
```typescript
// Current props (extending in this plan):
interface StrategyTableProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
  basePath?: string;
  portfolioId?: string | null;
}
// Phase 13 adds OPTIONAL props (back-compat):
//   userId?: string;
//   initialWatchedSet?: Set<string>;
```

From src/components/exchanges/AllocatorExchangeManager.tsx (useTransition optimistic pattern):
```typescript
const [isPending, startTransition] = useTransition();
// ... onClick: optimisticFlip(); startTransition(async () => { fetch(...) });
```

From DESIGN.md (locked tokens):
- --color-accent: #1B6B5A
- --color-accent-hover: #155A4B
- --color-text-muted: #718096
- --color-border: #E2E8F0
- bg-surface: #FFFFFF
- bg-page: #F8F9FA
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wave 0 test scaffolding — create the 4 failing test files for Watchlist</name>
  <files>src/app/api/watchlist/[strategyId]/route.test.ts, src/components/strategy/StarToggle.test.tsx, src/components/strategy/WatchlistTabs.test.tsx, e2e/discovery-watchlist.spec.ts, src/lib/queries.test.ts (extend with getMyWatchlist describe)</files>
  <read_first>
    - src/app/api/preferences/route.ts (canonical inline-auth + rate-limit pattern; lines 1-130)
    - src/app/api/keys/[id]/permissions/route.ts (Next 16 awaited params)
    - src/lib/queries.test.ts (existing query test pattern)
    - src/lib/csrf.test.ts (existing CSRF test pattern)
    - src/components/strategy/StrategyHeader.test.tsx (existing component test scaffold)
    - e2e/full-flow.spec.ts (login fixture template; matratzentester24@gmail.com/Test12)
    - playwright.config.ts (testDir = "./e2e", confirms NOT tests/e2e/)
  </read_first>
  <behavior>
    - route.test.ts: 401 unauth, 403 origin mismatch, 400 bad body, 429 rate-limit, 200 add (upsert), 200 remove (delete), 200 add-twice idempotent (no duplicate row error)
    - queries.test.ts: getMyWatchlist returns Set<string> of strategy_ids for the user; returns empty Set on error
    - StarToggle.test.tsx: clicking unstarred → flips to starred immediately (optimistic), button disabled for 200ms; PUT failure → reverts to unstarred + shows inline retry hint copy
    - WatchlistTabs.test.tsx: arrow-left/right move active tab; clicking My Watchlist with watchedSet.size=3 shows count badge "3"; watchedSet.size=0 hides badge entirely
    - e2e/discovery-watchlist.spec.ts: login, navigate to /discovery/crypto-sma, click first row star, reload page, assert star is still filled, assert My Watchlist tab badge reads "1", click My Watchlist, assert one row visible
  </behavior>
  <action>
Create 5 test files; each MUST FAIL on first run (RED step of TDD).

**File 1:** `src/app/api/watchlist/[strategyId]/route.test.ts` — Vitest. Mock `@/lib/supabase/server` and `@/lib/ratelimit` per existing patterns in `src/lib/queries.test.ts`. Test cases:
1. Returns 401 when getUser returns null
2. Returns 403 when assertSameOrigin returns a NextResponse (mock req with mismatched Origin header)
3. Returns 400 when body is `{ action: "invalid" }` or `{}` or non-JSON
4. Returns 429 when checkLimit returns `{ success: false, retryAfter: 30 }`
5. action="add" → calls `upsert({ user_id, strategy_id }, { onConflict: 'user_id,strategy_id', ignoreDuplicates: true })` exactly once
6. action="remove" → calls `delete().eq('user_id', user.id).eq('strategy_id', strategyId)` exactly once
7. action="add" twice in a row → still resolves 200 200 (idempotent — no throw on second call because ignoreDuplicates: true)
8. Calls `checkLimit(mandateAutoSaveLimiter, 'watchlist:' + user.id)` — assert exact key shape

**File 2:** `src/lib/queries.test.ts` — extend the existing file. Add `describe('getMyWatchlist')`. Mock supabase client per existing pattern. Cases:
1. Returns `Set<string>` of strategy_ids for the given userId
2. Returns empty `Set` when supabase returns `{ data: null, error: <truthy> }`
3. Returns empty `Set` when data is empty array
4. Calls `.from("user_favorites").select("strategy_id").eq("user_id", userId)` — exact select shape

**File 3:** `src/components/strategy/StarToggle.test.tsx` — Vitest + React Testing Library (use `@testing-library/react` per existing test patterns). Cases:
1. Renders StarOutlineIcon when starred=false
2. Renders StarFilledIcon when starred=true
3. aria-label = "Add Stellar Neutral Alpha to watchlist" when starred=false (props: name="Stellar Neutral Alpha")
4. aria-label = "Remove Stellar Neutral Alpha from watchlist" when starred=true
5. aria-pressed reflects the starred prop
6. onClick triggers optimistic onToggle(strategyId, !starred) immediately (before fetch resolves)
7. After click, button has `disabled` attribute for 200ms then re-enables (use vitest fake timers)
8. PUT failure (mock fetch to reject or 500) calls onToggle again with the original starred value (revert)

**File 4:** `src/components/strategy/WatchlistTabs.test.tsx` — Vitest + RTL. Cases:
1. Renders parent `<div role="tablist" aria-label="Strategy list scope">`
2. Both tabs have `role="tab"`; only one has `aria-selected="true"` at a time
3. count={3} on My Watchlist tab → badge text "3" visible
4. count={0} on My Watchlist tab → no badge in DOM (`queryByText('0')` returns null AND no element with class containing 'bg-accent text-white' for the count)
5. ArrowRight on focused All tab → focus moves to My Watchlist tab
6. ArrowLeft on focused My Watchlist tab → focus moves to All tab
7. Clicking My Watchlist calls onScopeChange("watchlist")

**File 5:** `e2e/discovery-watchlist.spec.ts` — Playwright. Reuse the `matratzentester24@gmail.com` / `Test12` login fixture from `e2e/full-flow.spec.ts:53-60`. Single test: "watchlist toggle persists across reload":
1. `await page.goto("/login")` + fill email + password + click sign-in
2. `await page.waitForURL(/\/(discovery|strategies)/)`
3. `await page.goto("/discovery/crypto-sma")`
4. `await page.waitForSelector('table tbody tr')`
5. Click the FIRST row's `button[aria-label*="to watchlist"]`
6. Wait for the network PUT to complete (`await page.waitForResponse(r => r.url().includes('/api/watchlist/') && r.status() === 200)`)
7. `await page.reload()`
8. `await page.waitForSelector('table tbody tr')`
9. Assert the first row's star button has `aria-label*="from watchlist"` (i.e., starred state persisted)
10. Assert `<button role="tab">My Watchlist</button>` shows a count badge with text "1"
11. Click "My Watchlist" tab; assert exactly 1 strategy row visible
12. **Cleanup step**: at end of test, click the star to unstar (idempotent reset for repeated CI runs).

CRITICAL: All 5 files MUST be in the RED state (failing) at end of Task 1. Source files do not exist yet.
  </action>
  <verify>
    <automated>npm test -- src/app/api/watchlist src/lib/queries.test src/components/strategy/StarToggle src/components/strategy/WatchlistTabs 2>&1 | grep -E "(FAIL|failed)" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - File `src/app/api/watchlist/[strategyId]/route.test.ts` exists with `grep -c "it\\|test(" route.test.ts >= 8`
    - File `src/components/strategy/StarToggle.test.tsx` exists with `grep -c "it\\|test(" StarToggle.test.tsx >= 8`
    - File `src/components/strategy/WatchlistTabs.test.tsx` exists with `grep -c "it\\|test(" WatchlistTabs.test.tsx >= 7`
    - File `e2e/discovery-watchlist.spec.ts` exists in `e2e/` directory (NOT `tests/e2e/`)
    - File `src/lib/queries.test.ts` has `grep -c "describe.*getMyWatchlist" queries.test.ts >= 1`
    - `npm test -- src/app/api/watchlist 2>&1` exits non-zero (RED state — source files do not exist yet)
    - All 5 test files import from the not-yet-created source paths exactly: `import { PUT } from "./route"`, `import { getMyWatchlist } from "@/lib/queries"`, `import { StarToggle } from "@/components/strategy/StarToggle"`, `import { WatchlistTabs } from "@/components/strategy/WatchlistTabs"`
  </acceptance_criteria>
  <done>5 test files exist; all unit tests are in RED state; e2e file is in `e2e/` directory; tests reference the not-yet-created public surfaces of every source file in this plan.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wave 1 — Watchlist backend + components — implement to GREEN</name>
  <files>src/app/api/watchlist/[strategyId]/route.ts, src/lib/queries.ts (extend), src/components/strategy/StarToggle.tsx, src/components/strategy/WatchlistTabs.tsx, src/components/strategy/EmptyWatchlist.tsx, src/components/strategy/StrategyGrid.tsx (extend with userId/watchedSet props + StarToggle render)</files>
  <read_first>
    - src/app/api/watchlist/[strategyId]/route.test.ts (the test file from Task 1)
    - src/components/strategy/StarToggle.test.tsx
    - src/components/strategy/WatchlistTabs.test.tsx
    - src/lib/queries.test.ts (the new getMyWatchlist describe block)
    - src/app/api/preferences/route.ts (inline auth + CSRF + rate-limit pattern, lines 28-44)
    - src/app/api/keys/[id]/permissions/route.ts (Next 16 await ctx.params; line 35 reference)
    - src/lib/queries.ts:160-188 (getStrategiesByCategory pattern for the new getMyWatchlist function)
    - src/components/exchanges/AllocatorExchangeManager.tsx (useTransition optimistic pattern, line 31)
    - src/components/strategy/StrategyFilters.tsx:319 (existing activeCount chip — reference for badge styling)
    - src/components/strategy/StrategyFilters.tsx:369-385 (existing view-mode toggle — visual template for WatchlistTabs)
    - src/components/strategy/StrategyFilters.tsx:227-256 (inline SVG icon convention)
    - 13-UI-SPEC.md State Matrix sections for WatchlistTabs and StarToggle
  </read_first>
  <behavior>
    Production code that turns Task 1's RED tests GREEN. Idempotent server-side. Optimistic client. Inline SVG icons (no icon library).
  </behavior>
  <action>
Create the 6 source files below. Implementation must satisfy the Task 1 tests verbatim — no test edits.

**File 1: `src/app/api/watchlist/[strategyId]/route.ts`** — single PUT handler. Use the **inline auth + CSRF + rate-limit pattern** (NOT `withAuth`, because `withAuth` does not forward `ctx.params` per RESEARCH.md Pitfall 5). Per Open Question #3 in TODOS.md, use `mandateAutoSaveLimiter` (30/min) — star-toggling can legitimately exceed 5/min.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ strategyId: string }> },
): Promise<NextResponse> {
  // T-01 CSRF mitigation
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // Next 16 awaited params (NOT `ctx.params.strategyId` — that returns a Promise)
  const { strategyId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // T-02 DoS / spam mitigation
  const rl = await checkLimit(mandateAutoSaveLimiter, `watchlist:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: { action?: "add" | "remove" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "remove") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (body.action === "add") {
    // Server-side idempotency: PRIMARY KEY (user_id, strategy_id) on user_favorites
    const { error } = await supabase
      .from("user_favorites")
      .upsert(
        { user_id: user.id, strategy_id: strategyId },
        { onConflict: "user_id,strategy_id", ignoreDuplicates: true },
      );
    if (error) {
      console.error("[api/watchlist] add failed:", error.message);
      return NextResponse.json({ error: "Failed to add" }, { status: 500 });
    }
  } else {
    // RLS rejects rows where user_id != auth.uid() — T-03 IDOR mitigation
    const { error } = await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("strategy_id", strategyId);
    if (error) {
      console.error("[api/watchlist] remove failed:", error.message);
      return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
```

**File 2: extend `src/lib/queries.ts`** — append `getMyWatchlist`:

```typescript
export async function getMyWatchlist(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_favorites")
    .select("strategy_id")
    .eq("user_id", userId);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.strategy_id));
}
```

**File 3: `src/components/strategy/StarToggle.tsx`** — polymorphic icon button with `useTransition` optimistic UI per RESEARCH.md Pattern 5 + Open Question #6 in TODOS.md. The visual icon size is 16×16; the hit area is 44×44 in `size="table"` (matches table row height) or 32×32 in `size="card"`. Per UI-SPEC State Matrix:

```typescript
"use client";
import { useState, useTransition } from "react";

interface StarToggleProps {
  strategyId: string;
  name: string;
  starred: boolean;
  onToggle: (strategyId: string, nextStarred: boolean) => void;
  size?: "table" | "card";
}

export function StarToggle({ strategyId, name, starred, onToggle, size = "table" }: StarToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [showRetryHint, setShowRetryHint] = useState(false);

  const hitClass = size === "table"
    ? "min-w-11 min-h-11 inline-flex items-center justify-center"
    : "w-8 h-8 inline-flex items-center justify-center";

  const handleClick = () => {
    const nextStarred = !starred;
    onToggle(strategyId, nextStarred);              // Optimistic flip
    setShowRetryHint(false);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/watchlist/${strategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: nextStarred ? "add" : "remove" }),
        });
        if (!res.ok) {
          // Single retry after 600ms per UI-SPEC State Matrix
          await new Promise((r) => setTimeout(r, 600));
          const retry = await fetch(`/api/watchlist/${strategyId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: nextStarred ? "add" : "remove" }),
          });
          if (!retry.ok) throw new Error("retry-failed");
        }
      } catch {
        onToggle(strategyId, starred);              // Revert
        setShowRetryHint(true);
        setTimeout(() => setShowRetryHint(false), 4000);
      }
    });
  };

  const ariaLabel = starred
    ? `Remove ${name} from watchlist`
    : `Add ${name} to watchlist`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={ariaLabel}
      aria-pressed={starred}
      className={`${hitClass} rounded transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60`}
    >
      {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
      {showRetryHint && (
        <span className="sr-only">Couldn&apos;t update watchlist. Retry?</span>
      )}
    </button>
  );
}

function StarOutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5l2 4.2 4.5.4-3.4 3 1 4.4L8 11.3 3.9 13.5l1-4.4-3.4-3 4.5-.4L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        className="text-text-muted"
      />
    </svg>
  );
}

function StarFilledIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5l2 4.2 4.5.4-3.4 3 1 4.4L8 11.3 3.9 13.5l1-4.4-3.4-3 4.5-.4L8 1.5z"
        fill="var(--color-accent)"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

**File 4: `src/components/strategy/WatchlistTabs.tsx`** — 2-tab segmented control with WAI-ARIA tablist + count badge.

```typescript
"use client";
import { useRef } from "react";

interface WatchlistTabsProps {
  scope: "all" | "watchlist";
  onScopeChange: (scope: "all" | "watchlist") => void;
  count: number;
}

export function WatchlistTabs({ scope, onScopeChange, count }: WatchlistTabsProps) {
  const allRef = useRef<HTMLButtonElement>(null);
  const watchRef = useRef<HTMLButtonElement>(null);

  const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>, target: "all" | "watchlist") => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = target === "all" ? "watchlist" : "all";
      (next === "all" ? allRef : watchRef).current?.focus();
    }
  };

  return (
    <div role="tablist" aria-label="Strategy list scope" className="inline-flex border border-border rounded overflow-hidden">
      <button
        ref={allRef}
        role="tab"
        aria-selected={scope === "all"}
        aria-controls="strategy-list"
        tabIndex={scope === "all" ? 0 : -1}
        onClick={() => onScopeChange("all")}
        onKeyDown={(e) => handleKey(e, "all")}
        className={`px-3 h-9 text-sm transition-colors ${
          scope === "all"
            ? "bg-accent/10 text-accent"
            : "bg-surface text-text-secondary hover:bg-page"
        }`}
      >
        All
      </button>
      <button
        ref={watchRef}
        role="tab"
        aria-selected={scope === "watchlist"}
        aria-controls="strategy-list"
        tabIndex={scope === "watchlist" ? 0 : -1}
        onClick={() => onScopeChange("watchlist")}
        onKeyDown={(e) => handleKey(e, "watchlist")}
        className={`px-3 h-9 text-sm transition-colors inline-flex items-center gap-2 border-l border-border ${
          scope === "watchlist"
            ? "bg-accent/10 text-accent"
            : "bg-surface text-text-secondary hover:bg-page"
        }`}
      >
        My Watchlist
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-semibold">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
```

**File 5: `src/components/strategy/EmptyWatchlist.tsx`** — two-line empty state per UI-SPEC Copywriting Contract:

```typescript
export function EmptyWatchlist() {
  return (
    <div className="text-center py-12">
      <p className="text-sm font-semibold text-text-primary mb-1">Your watchlist is empty</p>
      <p className="text-sm text-text-secondary">Star strategies from the All tab to track them here.</p>
    </div>
  );
}
```

**File 6: extend `src/components/strategy/StrategyGrid.tsx`** — add `userId?` and `watchedSet?` props + render `<StarToggle size="card">` absolute-positioned `top-2 right-2` of the Card. Reflow existing siblings (HealthScore, VerifiedBadge, is_example chip) leftward to clear the top-right corner. The grid card MUST keep working when `userId`/`watchedSet` are NOT passed (existing call sites e.g. `compare` page must still compile).

**Order of operations in a single commit:** routes → query → primitives → grid extension. StrategyTable extension lands in Task 3 (it's the heaviest changeset).

After implementation: run `npm test -- src/app/api/watchlist src/lib/queries.test src/components/strategy/StarToggle src/components/strategy/WatchlistTabs` — must be GREEN before commit.
  </action>
  <verify>
    <automated>npm test -- src/app/api/watchlist src/lib/queries.test src/components/strategy/StarToggle src/components/strategy/WatchlistTabs 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "await ctx.params" src/app/api/watchlist/\[strategyId\]/route.ts` >= 1
    - `grep -c "assertSameOrigin\\|checkLimit\\|mandateAutoSaveLimiter\\|onConflict.*user_id,strategy_id" src/app/api/watchlist/\[strategyId\]/route.ts` >= 4
    - `grep -c "watchlist:.*user.id\\|\`watchlist:\\$" src/app/api/watchlist/\[strategyId\]/route.ts` >= 1 (rate-limit key includes user.id)
    - `grep -c "ignoreDuplicates: true" src/app/api/watchlist/\[strategyId\]/route.ts` >= 1
    - `grep -c "export async function getMyWatchlist" src/lib/queries.ts` == 1
    - `grep -c "Promise<Set<string>>" src/lib/queries.ts` >= 1
    - `grep -c "export function StarToggle" src/components/strategy/StarToggle.tsx` == 1
    - `grep -c "useTransition\\|aria-pressed\\|aria-label" src/components/strategy/StarToggle.tsx` >= 3
    - `grep -c "export function WatchlistTabs" src/components/strategy/WatchlistTabs.tsx` == 1
    - `grep -c "role=\"tablist\"\\|role=\"tab\"" src/components/strategy/WatchlistTabs.tsx` >= 2
    - `grep -c "Strategy list scope" src/components/strategy/WatchlistTabs.tsx` == 1
    - `grep -c "text-\\[11px\\] font-semibold\\|text-\\[11px\\]\\sfont-semibold" src/components/strategy/WatchlistTabs.tsx` >= 1
    - `grep -c "Your watchlist is empty\\|Star strategies from the All tab" src/components/strategy/EmptyWatchlist.tsx` >= 2
    - StarToggle.tsx contains NO import from icon libraries: `! grep -E "lucide-react|@heroicons|react-icons" src/components/strategy/StarToggle.tsx`
    - StarToggle.tsx contains NO import of axios: `! grep "from \"axios\"" src/components/strategy/StarToggle.tsx`
    - All Vitest unit suites for these files pass: `npm test -- src/app/api/watchlist src/lib/queries.test src/components/strategy/StarToggle src/components/strategy/WatchlistTabs` exits 0
    - `npm run build` exits 0 (no TypeScript regression in the broader codebase)
  </acceptance_criteria>
  <done>4 unit-test suites GREEN; route handler + query + primitives + EmptyWatchlist exist with correct contracts; StrategyGrid renders the star without breaking existing call sites; build passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wave 1 — Wire StrategyTable + Discovery page; ship E2E spec to GREEN</name>
  <files>src/components/strategy/StrategyTable.tsx (extend), src/components/strategy/StrategyTable.test.tsx, src/app/(dashboard)/discovery/[slug]/page.tsx (extend), src/components/strategy/StrategyFilters.tsx (add leadingSlot prop)</files>
  <read_first>
    - src/components/strategy/StrategyTable.tsx (full file — extension target)
    - src/components/strategy/StrategyTable.test.tsx (Task 1 RED tests)
    - src/app/(dashboard)/discovery/[slug]/page.tsx (full file — server component thread-through)
    - src/lib/queries.ts (the new getMyWatchlist exported in Task 2)
    - src/components/strategy/WatchlistTabs.tsx (props from Task 2)
    - src/components/strategy/StarToggle.tsx (props from Task 2)
    - src/components/strategy/EmptyWatchlist.tsx (props from Task 2)
    - e2e/discovery-watchlist.spec.ts (Task 1 e2e)
    - e2e/full-flow.spec.ts:51-60 (login fixture template)
    - 13-UI-SPEC.md Layout Contract section (filter row order — search → All Filters → WatchlistTabs → Hide-examples → Sort → Cog → ViewToggle)
  </read_first>
  <behavior>
    StrategyTable accepts optional `userId` + `initialWatchedSet`; renders the `<WatchlistTabs>` inside `<StrategyFilters>`-row left of search OR pass-through prop; renders leading-column `<StarToggle size="table">` on each row before the strategy name; switches the row set based on `scope`; renders `<EmptyWatchlist>` when `scope=watchlist && watchedSet.size===0`. The discovery page server component fetches the watched-set in parallel with strategies/portfolio and threads `userId` + `initialWatchedSet` through.

    The e2e spec from Task 1 must turn GREEN — a real signed-in allocator clicks a star, reloads, sees it persisted, sees the count badge, can switch to My Watchlist scope.
  </behavior>
  <action>
**Step 3a — Extend `src/components/strategy/StrategyTable.tsx`:**

1. Add 2 OPTIONAL props to the `StrategyTableProps` interface:
   ```typescript
   userId?: string;
   initialWatchedSet?: Set<string>;
   ```

2. Inside the component, add new state — DO NOT remove any existing state:
   ```typescript
   const [scope, setScope] = useState<"all" | "watchlist">("all");
   const [watchedSet, setWatchedSet] = useState<Set<string>>(initialWatchedSet ?? new Set());
   ```

3. Add an `onToggleStar` callback for `<StarToggle>` that mutates `watchedSet`:
   ```typescript
   const onToggleStar = (strategyId: string, nextStarred: boolean) => {
     setWatchedSet((prev) => {
       const next = new Set(prev);
       if (nextStarred) next.add(strategyId);
       else next.delete(strategyId);
       return next;
     });
   };
   ```

4. Inside the `useMemo` `filtered` block, add the scope filter as the FIRST filter step (before search/advanced):
   ```typescript
   if (scope === "watchlist") {
     result = result.filter((s) => watchedSet.has(s.id));
   }
   ```

5. Insert `<WatchlistTabs scope={scope} onScopeChange={setScope} count={watchedSet.size} />` into the filter row. Per UI-SPEC Layout Contract, place it **between the search input and Hide-examples** in the existing `<StrategyFilters>` rendering. Since `<StrategyFilters>` is a separate component, the cleanest path is: add a `leadingSlot?: ReactNode` optional prop to `StrategyFilters` and pass `<WatchlistTabs ... />` in. Render the slot inside the filter row immediately after the search input. (StrategyFilters edit is contained — single new optional prop, single new render position.)

6. In the table `<tbody>`, modify each `<tr>` to add a leading column. Add a new first `<th>` (no header label, 44px wide) and a new first `<td>` per row containing `<StarToggle strategyId={s.id} name={s.name} starred={watchedSet.has(s.id)} onToggle={onToggleStar} size="table" />`. The star renders only when `userId !== undefined` — non-Discovery callers (e.g., the existing browse page) keep working without the new column.

7. Update the `colSpan` of the "No strategies match your filters." empty-state row to reflect the new column count (was 11, now 12 if userId present).

8. Add an `id="strategy-list"` and `role="tabpanel"` to the wrapper `<div>` containing the table+grid (matches the WatchlistTabs `aria-controls="strategy-list"`).

9. After the row sort + filter pipeline produces `paged`, insert before the `<table>` block:
   ```typescript
   if (scope === "watchlist" && watchedSet.size === 0) {
     return <EmptyWatchlist />;  // Inside the same parent with id="strategy-list"
   }
   ```
   Empty-watchlist state replaces the table/grid entirely.

10. Pass `watchedSet` + `onToggleStar` + `userId` down to `<StrategyGrid>` via new optional props (mirroring the StrategyTable extension).

**Step 3b — Update `src/app/(dashboard)/discovery/[slug]/page.tsx`:**

Replace the existing `Promise.all` with the 3-way fetch and thread the new props:

```typescript
import { getRealPortfolio, getStrategiesByCategory, getMyWatchlist } from "@/lib/queries";
// ...
const [strategies, portfolio, watchedSet] = await Promise.all([
  getStrategiesByCategory(slug),
  getRealPortfolio(user.id),
  getMyWatchlist(user.id),
]);
// ...
<StrategyTable
  strategies={strategies}
  categorySlug={slug}
  portfolioId={portfolio?.id ?? null}
  userId={user.id}
  initialWatchedSet={watchedSet}
/>
```

**Step 3c — Add the StrategyTable test file:**

Create `src/components/strategy/StrategyTable.test.tsx` with these cases (RED→GREEN; create as RED then immediately GREEN since the component exists in the same task — this is acceptable for shell-extension tests):

1. Renders WatchlistTabs when `userId` is provided
2. Does NOT render WatchlistTabs when `userId` is undefined (back-compat)
3. Renders leading star column when `userId` is provided
4. Does NOT render leading star column when `userId` is undefined
5. Switching scope to "watchlist" with empty `initialWatchedSet` → `<EmptyWatchlist>` rendered, table NOT rendered
6. Switching scope to "watchlist" with `initialWatchedSet=new Set([s1.id, s2.id])` → only those 2 strategies appear
7. After clicking a star (mock fetch), `watchedSet` updates and the count badge increments

Use react-testing-library + Vitest with `vi.mock("@/components/strategy/StarToggle")` and similar mocking for sub-components when convenient.

**Step 3d — Run the e2e spec to GREEN:**

The e2e spec from Task 1 (`e2e/discovery-watchlist.spec.ts`) must now pass against a real dev server. Run it via `npm run test:e2e -- --grep "watchlist toggle"`. If the user `matratzentester24@gmail.com` does NOT have any starred strategies in production-like env, the test will pass on the first toggle. If it DOES have one already, the cleanup step in Task 1 step 12 keeps the spec idempotent across reruns.

If `npm run test:e2e` is not feasible in CI (no running dev server), document this in the SUMMARY as `e2e_executed=false; spec_authored=true` — the spec must still PASS in spec-authoring mode (`npx playwright test --list -g "watchlist toggle"` lists the test).
  </action>
  <verify>
    <automated>npm test -- src/components/strategy/StrategyTable && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "userId\\?: string\\|initialWatchedSet\\?: Set<string>" src/components/strategy/StrategyTable.tsx` >= 2
    - `grep -c "<WatchlistTabs\\|<StarToggle\\|<EmptyWatchlist" src/components/strategy/StrategyTable.tsx` >= 3
    - `grep -c "scope === \"watchlist\"\\|scope === 'watchlist'" src/components/strategy/StrategyTable.tsx` >= 1
    - `grep -c "watchedSet.has\\|watchedSet.size" src/components/strategy/StrategyTable.tsx` >= 2
    - `grep -c "id=\"strategy-list\"\\|id='strategy-list'" src/components/strategy/StrategyTable.tsx` >= 1
    - `grep -c "getMyWatchlist" src/app/\\(dashboard\\)/discovery/\\[slug\\]/page.tsx` >= 1
    - `grep -c "userId={user.id}\\|initialWatchedSet={watchedSet}" src/app/\\(dashboard\\)/discovery/\\[slug\\]/page.tsx` >= 2
    - `grep -c "describe\\|it(\\|test(" src/components/strategy/StrategyTable.test.tsx` >= 7
    - `npm test -- src/components/strategy/StrategyTable` exits 0 (all unit tests GREEN)
    - `npm run build` exits 0
    - `npm test` (full unit suite) exits 0 (no regression in any other test)
    - Playwright spec list: `npx playwright test --list -g "watchlist toggle persists across reload"` lists exactly 1 test
    - Inverted: `! grep -E "tests/e2e/" e2e/discovery-watchlist.spec.ts` (no path drift)
    - StrategyGrid extension does not break existing usage: `grep -c "userId\\?\\|watchedSet\\?\\|onToggleStar\\?" src/components/strategy/StrategyGrid.tsx` >= 2 AND `grep -c "<StarToggle" src/components/strategy/StrategyGrid.tsx` >= 1
  </acceptance_criteria>
  <done>StrategyTable renders WatchlistTabs + leading star column + EmptyWatchlist gating; discovery page threads getMyWatchlist; all unit tests GREEN; build passes; e2e spec authored and listable.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Next.js route handler (`PUT /api/watchlist/[strategyId]`) | Untrusted user-supplied `{ action }` body crosses here. CSRF + auth + rate-limit applied. |
| Next.js route handler → Supabase Postgres (`user_favorites` table) | Authenticated server-side request. RLS policies on `user_favorites` (migration 024) reject any row where `user_id != auth.uid()`. |
| Browser → page render (`/discovery/[slug]`) | SSR boundary: server fetches the watched-set with `auth.uid()`; client receives a hydrated `Set<string>` and treats it as already-authorized. No client-side authorization needed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-13-01-01 | Spoofing (CSRF) | `PUT /api/watchlist/[strategyId]` | mitigate | `assertSameOrigin(req)` invoked at handler entry (line 9 of route.ts). Mirrors `api/preferences/route.ts:28-44` pattern. ASVS V13 control. |
| T-13-01-02 | Denial of Service (rapid-toggle spam) | `PUT /api/watchlist/[strategyId]` | mitigate | `checkLimit(mandateAutoSaveLimiter, "watchlist:" + user.id)` — 30/min cap. Returns 429 with `Retry-After` header when exceeded. Per Open Question #3 in TODOS.md, `mandateAutoSaveLimiter` (30/min) chosen over `userActionLimiter` (5/min) because legitimate browsing can star 10–20 strategies in 30s. |
| T-13-01-03 | Tampering / IDOR (write to another user's favorites) | `user_favorites` table | mitigate | RLS on `user_favorites` (migration 024:42-73, 4 policies) rejects `user_id != auth.uid()`. The route handler additionally constrains `delete().eq("user_id", user.id)` so even a permissive RLS would not allow cross-user deletes. ASVS V4 control. |
| T-13-01-04 | Information Disclosure (leak watchlist contents) | `getMyWatchlist(userId)` server query | accept | Read-only query within an authenticated server-rendered route. RLS on `user_favorites` enforces `user_id = auth.uid()` on SELECT (one of the 4 policies). The `userId` parameter is sourced from `supabase.auth.getUser()` server-side — never from client input. |
| T-13-01-05 | Repudiation (no audit trail of watchlist changes) | `PUT /api/watchlist/[strategyId]` | accept | Watchlist toggle is an allocator-self-action with no security or commercial impact. `api/preferences/route.ts` audits `update_allocator_mandates` (D-19); we follow the same pattern of NOT auditing self-action mutations. Open follow-up if compliance asks for it. |
| T-13-01-06 | Input validation bypass (malformed body) | `PUT /api/watchlist/[strategyId]` | mitigate | Strict body shape `{ action: "add" \| "remove" }` validated at line 35; any other shape returns 400. ASVS V5 control. |
</threat_model>

<verification>
**Wave 0 (Task 1):** All 5 test files exist; unit tests are RED (production code not yet written). Acceptance grep verifies file structure and minimum test count per file.

**Wave 1 (Tasks 2 + 3):**
- All Vitest unit suites GREEN: `npm test -- src/app/api/watchlist src/lib/queries.test src/components/strategy/StarToggle src/components/strategy/WatchlistTabs src/components/strategy/StrategyTable`
- `npm run build` exits 0 (no TypeScript regression)
- Full Vitest suite has no regressions: `npm test` exits 0
- Playwright e2e spec lists: `npx playwright test --list -g "watchlist toggle persists across reload"` shows exactly 1 test
- ASVS L1 controls verified: `grep -c "assertSameOrigin\|checkLimit\|mandateAutoSaveLimiter\|onConflict" src/app/api/watchlist/\[strategyId\]/route.ts` >= 4

**Goal-backward grep checks (single command, all must match):**
- `grep -c "PUT /api/watchlist" e2e/discovery-watchlist.spec.ts` >= 0 (URL referenced in commentary or fetch)
- `grep -c "/api/watchlist/" src/components/strategy/StarToggle.tsx` >= 1
- `grep -c "getMyWatchlist" src/app/\(dashboard\)/discovery/\[slug\]/page.tsx` >= 1

**Negative checks (must produce zero matches):**
- `! grep -rn "tests/e2e/" .planning/phases/13-discovery-v2-polish/13-01-PLAN.md` (no testDir drift)
- `! grep "from \"axios\"" src/app/api/watchlist/\[strategyId\]/route.ts src/components/strategy/StarToggle.tsx`
- `! grep "from \"lucide-react\"\|from \"@heroicons\"\|from \"react-icons\"" src/components/strategy/StarToggle.tsx src/components/strategy/WatchlistTabs.tsx`
</verification>

<success_criteria>
1. **DISCO-01 acceptance criterion 1 (REQUIREMENTS.md line 17):** Allocator can star a strategy from any row or card; "My Watchlist" sub-tab appears with a count badge; star toggle is idempotent and survives reload via `user_favorites`. Verified by `e2e/discovery-watchlist.spec.ts` end-to-end + `route.test.ts` idempotency unit test.
2. **CONTEXT.md DISCO-01 locked decisions:**
   - WatchlistTabs lives inside StrategyFilters row (UI-SPEC Layout Contract).
   - Star icon: leading column on table rows, top-right on grid cards.
   - PUT /api/watchlist/[strategyId] body `{ action: "add" | "remove" }`.
   - Server-side idempotency via `ON CONFLICT DO NOTHING` (upsert with `ignoreDuplicates: true`); no client-side debounce.
3. **Threat model:** All 6 threats have a documented disposition; T-13-01-01/02/03/06 are MITIGATED with cited code references. ASVS V4/V5/V13 controls land.
4. **Wave-0 nyquist test scaffolding:** All 5 test files exist before production code; the `<verify>` `<automated>` field in every task is concrete and grep-verifiable.
5. **No regression:** `npm test` (full suite) exits 0; `npm run build` exits 0; `npx playwright test --list` works.
</success_criteria>

<output>
After completion, create `.planning/phases/13-discovery-v2-polish/13-01-SUMMARY.md` summarizing:
- The 4 source files and 5 test files created
- Threat-model dispositions and concrete mitigation file:line references
- Vitest + Playwright result counts
- Any deviations from plan (with Rule 1/2/3 categorization)
- Open follow-ups for Plan 13-02 (which extends StrategyTable for Customize prefs)
</output>

==== FILE: 13-02-PLAN.md ====
---
phase: 13
plan: 02
type: execute
wave: 2
depends_on:
  - 13-01
files_modified:
  - src/lib/discovery-prefs.ts
  - src/lib/discovery-prefs.test.ts
  - src/components/strategy/CustomizeDrawer.tsx
  - src/components/strategy/CustomizeDrawer.test.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/components/strategy/StrategyTable.tsx
  - e2e/discovery-prefs-isolation.spec.ts
autonomous: false
requirements:
  - DISCO-02
tags:
  - customize
  - localStorage
  - per-user-prefs
  - drawer
  - cross-account-isolation

must_haves:
  truths:
    - "Allocator's Customize prefs (default view, default sort, hide examples) persist across page reloads in localStorage keyed by both auth.uid AND category slug"
    - "Login-as-A then login-as-B leaves zero discovery_view_preferences:{A.uid}:* keys readable from session B"
    - "Customize drawer opens via a settings-cog button at the right end of the StrategyFilters row, replacing the existing 'Customize' text button"
    - "Customize drawer slides in from the right edge with a backdrop, closes on ESC + backdrop click + close-X click"
    - "Defaults when localStorage key is missing are view=table, sort=sharpe-desc, hide_examples=true (DISCO-05 default)"
    - "Saving the drawer commits draft state to localStorage and closes the drawer; Reset to defaults reverts the draft (does not close)"
    - "First paint renders defaults; persisted prefs apply on a single post-mount re-render (no SSR hydration error)"
  artifacts:
    - path: "src/lib/discovery-prefs.ts"
      provides: "useDiscoveryPrefs(uid, slug) hook + DEFAULTS constant + key-shape helper"
      exports: ["useDiscoveryPrefs", "DiscoveryViewPreferences", "DEFAULTS"]
    - path: "src/lib/discovery-prefs.test.ts"
      provides: "Vitest unit tests covering defaults, key shape, partial-merge tolerance, hydration flag, persistence-after-hydration gate"
    - path: "src/components/strategy/CustomizeDrawer.tsx"
      provides: "Right-edge slide-out drawer with sticky header/footer, ESC close, backdrop close, focus trap, Save/Reset buttons matching UI-SPEC copywriting contract"
      exports: ["CustomizeDrawer"]
    - path: "src/components/strategy/CustomizeDrawer.test.tsx"
      provides: "Vitest unit tests covering ESC close, backdrop close, dirty-detection on Save button, Reset reverts draft, primary CTA aria-label = 'Save preferences'"
    - path: "e2e/discovery-prefs-isolation.spec.ts"
      provides: "Playwright spec proving cross-account localStorage isolation (DISCO-02 success criterion 4)"
  key_links:
    - from: "src/components/strategy/CustomizeDrawer.tsx"
      to: "src/lib/discovery-prefs.ts:useDiscoveryPrefs"
      via: "imports DEFAULTS + DiscoveryViewPreferences type"
      pattern: "import.*DEFAULTS.*from.*discovery-prefs"
    - from: "src/components/strategy/StrategyTable.tsx"
      to: "src/lib/discovery-prefs.ts:useDiscoveryPrefs"
      via: "useDiscoveryPrefs(userId, categorySlug) hydrates initial state for view/sort/hideExamples"
      pattern: "useDiscoveryPrefs\\("
    - from: "src/components/strategy/StrategyFilters.tsx"
      to: "src/components/strategy/CustomizeDrawer.tsx"
      via: "settings-cog button opens the drawer (replaces existing Modal-based CustomizeModal at line 583)"
      pattern: "<CustomizeDrawer|aria-label=\"Customize discovery view\""
---

<objective>
Ship DISCO-02 — per-user-keyed Customize prefs in localStorage. Allocators set Default view / Default sort / Hide examples in a right-edge slide-out drawer; values persist in `localStorage["discovery_view_preferences:{auth.uid}:{slug}"]`. Cross-account isolation is structurally guaranteed by the per-uid key; a Playwright spec proves it. Defaults align with DISCO-05 (Hide examples = true). The existing Modal-based CustomizeModal at `StrategyFilters.tsx:583-684` is replaced by the new `<CustomizeDrawer>`; the existing "Customize" text button at `StrategyFilters.tsx:364` is replaced by an icon-only `<SettingsCogButton>`.

Purpose: Persistence + isolation are the two halves of DISCO-02. The hook (`useDiscoveryPrefs`) is the persistence half; the drawer is the editor; the Playwright spec is the isolation proof. All three land in this plan.

Output: 1 new hook + 1 new drawer component + extensions to StrategyFilters + StrategyTable + 1 new Playwright spec + 2 new test files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/13-discovery-v2-polish/13-CONTEXT.md
@.planning/phases/13-discovery-v2-polish/13-RESEARCH.md
@.planning/phases/13-discovery-v2-polish/13-UI-SPEC.md
@.planning/phases/13-discovery-v2-polish/13-VALIDATION.md
@.planning/phases/13-discovery-v2-polish/TODOS.md
@.planning/phases/13-discovery-v2-polish/13-01-PLAN.md
@DESIGN.md
@./CLAUDE.md
@./AGENTS.md

@src/components/strategy/StrategyTable.tsx
@src/components/strategy/StrategyFilters.tsx
@src/app/(dashboard)/allocations/context/TweaksContext.tsx
@src/lib/wizard/localStorage.ts
@src/components/ui/Button.tsx

<interfaces>
<!-- Patterns the executor needs to honor verbatim. -->

From src/app/(dashboard)/allocations/context/TweaksContext.tsx (canonical hydration pattern, lines 55-99):
```typescript
function loadTweaks(): TweakState {
  if (typeof window === "undefined") return TWEAK_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return TWEAK_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<TweakState>;
    return { ...TWEAK_DEFAULTS, ...parsed };
  } catch {
    return TWEAK_DEFAULTS;
  }
}

const [state, setState] = useState<TweakState>(TWEAK_DEFAULTS);
const [hydrated, setHydrated] = useState(false);

// Hydrate post-mount to avoid SSR mismatch.
useEffect(() => {
  setState(loadTweaks());
  setHydrated(true);
}, []);

// Persist whenever state changes (after hydration so we never overwrite
// the stored value with TWEAK_DEFAULTS on the initial render).
useEffect(() => {
  if (!hydrated) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Safari private mode / quota — non-fatal.
  }
}, [state, hydrated]);
```

From src/components/strategy/StrategyFilters.tsx (current CustomizeSettings shape — REPLACE):
```typescript
// LINE 63 (existing — Phase 13 keeps the names but moves to discovery-prefs.ts):
export interface CustomizeSettings {
  defaultView: ViewMode;
  defaultSortKey: SortKey;
  defaultSortDir: SortDir;
  hideExamples: boolean;
}
// LINE 70:
export const DEFAULT_CUSTOMIZE: CustomizeSettings = {
  defaultView: "table",
  defaultSortKey: "sharpe",
  defaultSortDir: "desc",
  hideExamples: false,        // ← DISCO-05 BUG: this MUST become `true`
};
```

From 13-UI-SPEC.md State Matrix (CustomizeDrawer):
- Open ⇒ slides in from right over 250ms; backdrop fades to bg-black/40
- ESC ⇒ closes
- Backdrop click ⇒ closes
- Save ⇒ commits draft to localStorage, closes after 150ms
- Reset ⇒ replaces draft with DEFAULTS; does NOT close
- Save button is disabled when `JSON.stringify(draft) === JSON.stringify(persisted)` (no-op state)
- Save button visible text and aria-label both = "Save preferences" (WCAG 2.5.3)

From 13-UI-SPEC.md Layout Contract for the Customize drawer:
- `fixed inset-0 z-50 flex justify-end`
- backdrop = `absolute inset-0 bg-black/40`
- panel = `relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto`
- sticky header = `px-6 py-4 border-b`
- scrollable body = `p-6 space-y-6`
- sticky footer = `px-6 py-4 border-t flex gap-3`; primary `flex-1`; secondary fixed-width

From src/components/ui/Button.tsx (Button variants):
- `<Button variant="primary">` = `bg-accent text-white hover:bg-accent-hover`
- `<Button variant="ghost">` = transparent / hover bg-page
- `size="sm"` ⇒ 36px tall

DESIGN.md tokens:
- --color-text-primary: #1A1A2E
- --color-text-secondary: #4A5568
- --color-warning-bg / --color-warning-border (already defined; not used here)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wave 0 test scaffolding — discovery-prefs hook + CustomizeDrawer (RED)</name>
  <files>src/lib/discovery-prefs.test.ts, src/components/strategy/CustomizeDrawer.test.tsx, e2e/discovery-prefs-isolation.spec.ts</files>
  <read_first>
    - src/app/(dashboard)/allocations/context/TweaksContext.tsx (hydration pattern)
    - src/lib/wizard/localStorage.ts (SSR-safe helper template)
    - 13-UI-SPEC.md State Matrix → CustomizeDrawer
    - 13-UI-SPEC.md Copywriting Contract → "Save preferences" / "Reset to defaults" / "Close customize panel"
    - src/components/strategy/StrategyFilters.tsx:63-77 (existing CustomizeSettings + DEFAULT_CUSTOMIZE)
  </read_first>
  <behavior>
    - discovery-prefs.test.ts: SSR-safe (returns DEFAULTS when typeof window === undefined); reads localStorage on mount; persists on change AFTER hydrated; key shape = `discovery_view_preferences:{uid}:{slug}`; partial JSON tolerated via {...DEFAULTS, ...parsed}; defaults are `view=table, sort.key=sharpe, sort.dir=desc, hide_examples=true`.
    - CustomizeDrawer.test.tsx: ESC closes; backdrop click closes; close-X click closes; Save button is disabled until draft != persisted; Reset replaces draft with DEFAULTS but does NOT close; Save button visible text "Save preferences" AND aria-label "Save preferences"; Reset button visible text "Reset to defaults"; close-X aria-label "Close customize panel"; drawer heading text "Customize"; drawer description copy includes "Saved per device".
    - e2e/discovery-prefs-isolation.spec.ts: full cross-account isolation per RESEARCH.md Example 4.
  </behavior>
  <action>
Create 3 test files; all unit tests in RED state at end of task.

**File 1: `src/lib/discovery-prefs.test.ts`** — Vitest. Mock window.localStorage. Cases:

1. `safeRead(uid, slug)` returns DEFAULTS when `typeof window === "undefined"` — simulate by setting `vi.stubGlobal("window", undefined)` for one test
2. `safeRead("uid-A", "crypto-sma")` returns DEFAULTS when localStorage has no entry under that key
3. `safeRead("uid-A", "crypto-sma")` reads and merges partial JSON: stored `{ view: "grid" }` returns `{ view: "grid", sort: { key: "sharpe", dir: "desc" }, hide_examples: true }`
4. `safeRead` returns DEFAULTS on JSON.parse error (corrupted entry)
5. Key shape: `keyFor("user-1", "crypto-sma")` returns exact string `"discovery_view_preferences:user-1:crypto-sma"`
6. DEFAULTS = `{ view: "table", sort: { key: "sharpe", dir: "desc" }, hide_examples: true }` — all 3 fields, hide_examples MUST be `true` (DISCO-05 lock)
7. `useDiscoveryPrefs(uid, slug)` initial render returns `{ prefs: DEFAULTS, hydrated: false }`
8. After mount-effect runs (use `act()` + `await waitFor`), `hydrated` becomes `true` and `prefs` reflects what was in localStorage
9. Calling `setPrefs({ ...prefs, view: "grid" })` AFTER hydration writes to localStorage (verify mock setItem called with the correct key)
10. Calling `setPrefs(...)` BEFORE hydration does NOT write (the hydration gate is the contract)
11. Two different `uid` values produce two different localStorage keys (cross-account isolation at the storage layer)
12. `useDiscoveryPrefs(undefined, "crypto-sma")` NEVER writes to localStorage — calling `setPrefs(...)` while uid is undefined is a no-op (verify mock setItem NOT called). This guards the Task 3 retroactive hook signature change (`uid: string | undefined`) so the executor lands the test alongside Task 1, not buried inside Task 3's diff.

**File 2: `src/components/strategy/CustomizeDrawer.test.tsx`** — Vitest + RTL. Cases:

1. `<CustomizeDrawer open={false}>` → drawer not in DOM (returns null)
2. `<CustomizeDrawer open={true}>` → drawer rendered with `role="dialog"` + `aria-modal="true"` + `aria-labelledby="customize-heading"`
3. ESC key closes (calls `onClose`)
4. Click on backdrop `<div>` closes
5. Click close-X button closes; close-X has `aria-label="Close customize panel"`
6. Heading text is `"Customize"` (NOT "Customize View")
7. Description includes "Saved per device"
8. Save button visible text is `"Save preferences"`
9. Save button `aria-label` is `"Save preferences"` (WCAG 2.5.3 — accessible name matches visible text)
10. Save button is disabled when `draft === persisted` (deep equality via JSON.stringify)
11. Save button enables when draft differs (e.g., `draft.view = "grid"` while `persisted.view = "table"`)
12. Reset button visible text is `"Reset to defaults"`
13. Reset replaces draft with DEFAULTS (verify via setDraft mock); does NOT call onClose
14. Section headers exist for: `"Default view"`, `"Default sort"`, and the toggle label `"Hide example strategies"`
15. Save click calls `onSave` (which the parent then routes to localStorage write + onClose)

**File 3: `e2e/discovery-prefs-isolation.spec.ts`** — Playwright. Per RESEARCH.md Example 4:

1. Login as user A (`E2E_USER_A_EMAIL` / `E2E_USER_A_PASSWORD` env vars). If env vars are not set, **fall back to seeding two test users via `e2e/helpers/seed-test-project.ts:seedAllocator()` at test setup**.
2. Navigate to `/discovery/crypto-sma`
3. Click `button[aria-label="Customize discovery view"]`
4. Click "Grid" view button inside the drawer
5. Click `button[aria-label="Save preferences"]`
6. Read out A's localStorage: `Object.keys(localStorage).filter(k => k.startsWith("discovery_view_preferences:"))` → expect length >= 1
7. Capture A's uid: `aUid = aKeysAfterSave[0].split(":")[1]`
8. **Sign out via the user-menu sign-out button** (NOT a `/logout` URL — TODOS.md Open Question 3 confirms there's no /logout page; use the user-menu logout per the auth-flow). If no user-menu button is found, fall back to clearing all `sb-*` localStorage entries + `await page.context().clearCookies()` per RESEARCH.md Pitfall 8.
9. Login as user B
10. Navigate to `/discovery/crypto-sma`
11. Assert `Object.keys(localStorage).filter(k => k.startsWith("discovery_view_preferences:" + aUid + ":"))` returns `[]` (no A-keyed entries readable)
12. Assert B's view is the default `<table>` (not A's grid)

If `E2E_USER_A_*` and `E2E_USER_B_*` env vars are NOT set in CI, the spec MUST `test.skip(!process.env.E2E_USER_A_EMAIL, "cross-account env vars not wired — see TODOS.md")` so the spec is authored but does not block CI. Document this in SUMMARY.

CRITICAL: Tests #1–#15 in CustomizeDrawer.test.tsx are RED (drawer source not yet written). Tests #1–#11 in discovery-prefs.test.ts are RED (hook source not yet written). The Playwright spec is in spec-authored-but-skipped state.
  </action>
  <verify>
    <automated>npm test -- src/lib/discovery-prefs src/components/strategy/CustomizeDrawer 2>&1 | grep -E "(FAIL|failed)" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/discovery-prefs.test.ts` exists with `grep -c "it\\|test(" >= 11`
    - File `src/components/strategy/CustomizeDrawer.test.tsx` exists with `grep -c "it\\|test(" >= 15`
    - File `e2e/discovery-prefs-isolation.spec.ts` exists in `e2e/` directory
    - `grep -c "Save preferences" src/components/strategy/CustomizeDrawer.test.tsx` >= 2 (both visible text + aria-label)
    - `grep -c "Reset to defaults\\|Close customize panel\\|Saved per device" src/components/strategy/CustomizeDrawer.test.tsx` >= 3
    - `grep -c "discovery_view_preferences:.*:.*" src/lib/discovery-prefs.test.ts` >= 1 (key-shape contract)
    - `grep -c "hide_examples.*true" src/lib/discovery-prefs.test.ts` >= 1 (DISCO-05 default lock)
    - `grep -c "test.skip\\|skipIfNoEnv\\|process.env.E2E_USER_A_EMAIL" e2e/discovery-prefs-isolation.spec.ts` >= 1 (skip-when-env-missing safeguard)
    - `npm test -- src/lib/discovery-prefs src/components/strategy/CustomizeDrawer 2>&1` exits non-zero (RED state — source files do not exist yet)
  </acceptance_criteria>
  <done>3 test files exist; unit tests are RED; e2e spec is authored with env-skip fallback.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wave 1 — Implement useDiscoveryPrefs hook + CustomizeDrawer (GREEN)</name>
  <files>src/lib/discovery-prefs.ts, src/components/strategy/CustomizeDrawer.tsx</files>
  <read_first>
    - src/lib/discovery-prefs.test.ts (Task 1)
    - src/components/strategy/CustomizeDrawer.test.tsx (Task 1)
    - src/app/(dashboard)/allocations/context/TweaksContext.tsx (canonical hydration pattern)
    - src/components/ui/Button.tsx (Button variant="primary" / variant="ghost")
    - src/components/strategy/StrategyFilters.tsx:583-684 (existing CustomizeModal — for migrating field labels and section structure to the drawer)
    - 13-UI-SPEC.md Layout Contract → CustomizeDrawer
    - 13-UI-SPEC.md State Matrix → CustomizeDrawer (states: closed/opening/open/saving/save-error/closing/reset-confirmed)
  </read_first>
  <behavior>
    Production code that turns Task 1's RED tests GREEN. Hook is SSR-safe and gates persistence on `hydrated`. Drawer matches UI-SPEC's State Matrix verbatim; copywriting matches the contract.
  </behavior>
  <action>
**File 1: `src/lib/discovery-prefs.ts`** — hook + helpers. Mirrors `TweaksContext.tsx:55-99` pattern but **per-uid + per-slug**. Note the `uid` is REQUIRED (not optional) — rendering this hook with no uid is a bug; defer to type system to enforce.

```typescript
"use client";
import { useState, useEffect, useCallback } from "react";

import type { ViewMode, SortKey, SortDir } from "@/components/strategy/StrategyFilters";

export interface DiscoveryViewPreferences {
  view: ViewMode;
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

export const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,                    // DISCO-05 LOCK
};

export function keyFor(uid: string, slug: string): string {
  return `discovery_view_preferences:${uid}:${slug}`;
}

export function safeRead(uid: string, slug: string): DiscoveryViewPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(keyFor(uid, slug));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DiscoveryViewPreferences>;
    // Partial-merge tolerance: stored entries from older minor versions still load
    return {
      ...DEFAULTS,
      ...parsed,
      sort: { ...DEFAULTS.sort, ...(parsed.sort ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function useDiscoveryPrefs(uid: string, slug: string) {
  const [prefs, setPrefsRaw] = useState<DiscoveryViewPreferences>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  // Mount-effect hydrate
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefsRaw(safeRead(uid, slug));
    setHydrated(true);
  }, [uid, slug]);

  // Persistence-effect — gated on hydrated to avoid stomping on saved state with DEFAULTS
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(keyFor(uid, slug), JSON.stringify(prefs));
    } catch {
      // Safari private mode / quota — non-fatal
    }
  }, [prefs, hydrated, uid, slug]);

  // Stable updater
  const setPrefs = useCallback(
    (next: DiscoveryViewPreferences | ((prev: DiscoveryViewPreferences) => DiscoveryViewPreferences)) => {
      setPrefsRaw((prev) => (typeof next === "function" ? (next as (p: DiscoveryViewPreferences) => DiscoveryViewPreferences)(prev) : next));
    },
    [],
  );

  return { prefs, setPrefs, hydrated };
}
```

**File 2: `src/components/strategy/CustomizeDrawer.tsx`** — right-edge slide-out per UI-SPEC Layout Contract. ESC key listener; backdrop click; sticky header/footer; Save dirty-detection. Reuse `<Button>` primitives:

```typescript
"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import type { DiscoveryViewPreferences } from "@/lib/discovery-prefs";
import { DEFAULTS } from "@/lib/discovery-prefs";
import type { ViewMode, SortKey, SortDir } from "./StrategyFilters";

interface CustomizeDrawerProps {
  open: boolean;
  onClose: () => void;
  draft: DiscoveryViewPreferences;
  setDraft: (next: DiscoveryViewPreferences) => void;
  persisted: DiscoveryViewPreferences;
  onSave: () => void;
}

export function CustomizeDrawer({ open, onClose, draft, setDraft, persisted, onSave }: CustomizeDrawerProps) {
  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-heading"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto">
        <header className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 id="customize-heading" className="text-lg font-semibold text-text-primary">Customize</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customize panel"
            className="text-text-muted hover:text-text-primary"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="p-6 space-y-6">
          <p className="text-sm text-text-secondary">
            Set your default view, sort, and visibility on this category. Saved per device.
          </p>

          {/* Default view section */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Default view</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...draft, view: "table" })}
                className={`px-4 h-9 rounded border text-sm transition-colors ${
                  draft.view === "table"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-secondary hover:bg-page"
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, view: "grid" })}
                className={`px-4 h-9 rounded border text-sm transition-colors ${
                  draft.view === "grid"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-secondary hover:bg-page"
                }`}
              >
                Grid
              </button>
            </div>
          </section>

          {/* Default sort section */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Default sort</h3>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={draft.sort.key}
                onChange={(e) => setDraft({ ...draft, sort: { ...draft.sort, key: e.target.value as SortKey } })}
                className="h-9 px-3 rounded border border-border bg-surface text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Default sort key"
              >
                <option value="sharpe">Sharpe</option>
                <option value="cagr">CAGR</option>
                <option value="cumulative_return">Return</option>
                <option value="max_drawdown">Max Drawdown</option>
                <option value="volatility">Volatility</option>
                <option value="aum">AUM</option>
                <option value="computed_at">Last Synced</option>
              </select>
              <select
                value={draft.sort.dir}
                onChange={(e) => setDraft({ ...draft, sort: { ...draft.sort, dir: e.target.value as SortDir } })}
                className="h-9 px-3 rounded border border-border bg-surface text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Default sort direction"
              >
                <option value="desc">High to Low</option>
                <option value="asc">Low to High</option>
              </select>
            </div>
          </section>

          {/* Hide examples toggle */}
          <section>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hide_examples}
                onChange={(e) => setDraft({ ...draft, hide_examples: e.target.checked })}
                className="h-4 w-4 rounded border-border text-accent focus-visible:ring-accent"
              />
              <span className="text-sm text-text-secondary">Hide example strategies</span>
            </label>
          </section>
        </div>

        <footer className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center gap-3">
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!dirty}
            className="flex-1"
            aria-label="Save preferences"
          >
            Save preferences
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDraft(DEFAULTS)}
          >
            Reset to defaults
          </Button>
        </footer>
      </aside>
    </div>
  );
}
```

(Note: the Sort key list is the existing `SortKey` union from `StrategyFilters.tsx:10-19`. If a key is missing, refer to that union and add — do NOT invent new keys.)

After writing both files:
1. Run `npm test -- src/lib/discovery-prefs` — must be GREEN
2. Run `npm test -- src/components/strategy/CustomizeDrawer` — must be GREEN
3. Verify build: `npm run build` exits 0
  </action>
  <verify>
    <automated>npm test -- src/lib/discovery-prefs src/components/strategy/CustomizeDrawer && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export function useDiscoveryPrefs" src/lib/discovery-prefs.ts` == 1
    - `grep -c "discovery_view_preferences:" src/lib/discovery-prefs.ts` >= 1 (key shape literal)
    - `grep -c "hide_examples: true" src/lib/discovery-prefs.ts` >= 1 (DISCO-05 default)
    - `grep -c "if (!hydrated) return" src/lib/discovery-prefs.ts` >= 1 (persistence gate)
    - `grep -c "if (typeof window === \"undefined\")" src/lib/discovery-prefs.ts` >= 1 (SSR guard)
    - `grep -c "export function CustomizeDrawer" src/components/strategy/CustomizeDrawer.tsx` == 1
    - `grep -c "Save preferences" src/components/strategy/CustomizeDrawer.tsx` >= 2 (visible text + aria-label)
    - `grep -c "Reset to defaults" src/components/strategy/CustomizeDrawer.tsx` >= 1
    - `grep -c "Close customize panel" src/components/strategy/CustomizeDrawer.tsx` >= 1
    - `grep -c "aria-modal=\"true\"\\|role=\"dialog\"" src/components/strategy/CustomizeDrawer.tsx` >= 2
    - `grep -c "Saved per device" src/components/strategy/CustomizeDrawer.tsx` == 1
    - `grep -c "Hide example strategies" src/components/strategy/CustomizeDrawer.tsx` == 1
    - `grep -c "Default view\\|Default sort" src/components/strategy/CustomizeDrawer.tsx` >= 2
    - `grep -c "e.key === \"Escape\"" src/components/strategy/CustomizeDrawer.tsx` >= 1
    - `grep -c "JSON.stringify(draft) !== JSON.stringify(persisted)\\|JSON.stringify(draft) === JSON.stringify(persisted)" src/components/strategy/CustomizeDrawer.tsx` >= 1 (dirty detection)
    - Inverted: `! grep "Modal\\|<Modal" src/components/strategy/CustomizeDrawer.tsx` (does NOT use the existing Modal primitive — UI-SPEC mandates a bespoke right-edge drawer)
    - `npm test -- src/lib/discovery-prefs src/components/strategy/CustomizeDrawer` exits 0
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>discovery-prefs hook GREEN; CustomizeDrawer GREEN; build passes; no regression in other unit tests.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire StrategyFilters cog button + StrategyTable hydration; ship cross-account isolation spec</name>
  <files>src/components/strategy/StrategyFilters.tsx (extend — remove CustomizeModal, add cog button), src/components/strategy/StrategyTable.tsx (extend — wire useDiscoveryPrefs + CustomizeDrawer), src/lib/discovery-prefs.ts (extend hook signature to accept undefined uid)</files>
  <read_first>
    - src/components/strategy/StrategyFilters.tsx (full file — extension target; current CustomizeModal at lines 583-684 must be removed)
    - src/components/strategy/StrategyTable.tsx (extended in Plan 13-01 with userId/scope; this plan threads useDiscoveryPrefs)
    - src/lib/discovery-prefs.ts (Task 2 output)
    - src/components/strategy/CustomizeDrawer.tsx (Task 2 output)
    - e2e/discovery-prefs-isolation.spec.ts (Task 1 spec)
    - 13-UI-SPEC.md Layout Contract → filter row order
    - 13-UI-SPEC.md Component Inventory → "StrategyFilters: extend — add WatchlistTabs to the left edge of the row (before search); replace the text 'Customize' Button with SettingsCogButton"
  </read_first>
  <behavior>
    StrategyFilters renders a settings-cog icon button at the right end of the filter row (replacing the existing "Customize" text Button at line 364). The cog opens the new `<CustomizeDrawer>`, which manages a draft state and saves via the parent's `onSavePrefs` callback. StrategyTable consumes `useDiscoveryPrefs(userId, categorySlug)` and treats its return as the seed for `viewMode` / `sortKey` / `sortDir` / `showExamples` post-hydration.
  </behavior>
  <action>
**Step 3a — Update `src/components/strategy/StrategyFilters.tsx`:**

1. Fix the bug at line 70-77: change `hideExamples: false` to `hideExamples: true` in `DEFAULT_CUSTOMIZE`. (Note: `DEFAULT_CUSTOMIZE` may become unused after this plan — the new source of truth is `DEFAULTS` in `discovery-prefs.ts`. Either keep both as legacy aliases OR remove `DEFAULT_CUSTOMIZE` after grep confirms zero importers. Run `grep -rn "DEFAULT_CUSTOMIZE\|CustomizeSettings" src/` and decide; if any non-test file imports them, keep with the corrected default and add a `@deprecated` JSDoc. If only tests import, delete and update the tests to import from `discovery-prefs.ts`.)

2. Remove the inline `CustomizeModal` component (lines ~583-684) entirely. Remove the import of `Modal` if no longer used. Remove the `<CustomizeModal ... />` render at ~565.

3. Add a new prop to `StrategyFiltersProps`:
   ```typescript
   onOpenCustomize?: () => void;
   ```

4. Replace the existing "Customize" text `<Button>` (around line 364, identifiable by the literal text "Customize") with an icon-only cog button. Use the existing inline-SVG convention (no icon library). Per UI-SPEC Component Inventory:
   ```typescript
   <button
     type="button"
     onClick={onOpenCustomize}
     aria-label="Customize discovery view"
     aria-haspopup="dialog"
     aria-expanded={false /* parent will toggle if it tracks open state; OK as static for now */}
     className="h-9 w-9 inline-flex items-center justify-center rounded border border-border bg-surface text-text-secondary hover:bg-page hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
   >
     <SettingsCogIcon />
   </button>
   ```
   And add `SettingsCogIcon` inline (16×16 SVG):
   ```typescript
   function SettingsCogIcon() {
     return (
       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
         <path d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" stroke="currentColor" strokeWidth="1.4" />
         <path d="M13.4 9a5.4 5.4 0 00-.04-2l1.34-1.05-1.5-2.6-1.6.55a5.4 5.4 0 00-1.74-1l-.24-1.7h-3l-.24 1.7a5.4 5.4 0 00-1.74 1l-1.6-.55-1.5 2.6L2.64 7a5.4 5.4 0 00-.04 2 5.4 5.4 0 00.04 2L1.3 12.05l1.5 2.6 1.6-.55a5.4 5.4 0 001.74 1l.24 1.7h3l.24-1.7a5.4 5.4 0 001.74-1l1.6.55 1.5-2.6L13.36 11a5.4 5.4 0 00.04-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
       </svg>
     );
   }
   ```

5. Update the `activeCount` chip styling (around line 319) from `text-[10px] font-bold` to `text-[11px] font-semibold` per UI-SPEC Typography Micro-label exception. (Read the existing chip; replace ONLY the className tokens. Other props/structure unchanged.)

6. Per UI-SPEC Layout Contract, the filter row order is:
   `search → All Filters → WatchlistTabs (slot from Plan 13-01) → Hide-examples → Sort selects (ml-auto pushes right) → SettingsCogButton (replaces Customize) → ViewToggle → Clear filters`
   The `<WatchlistTabs>` slot was wired in Plan 13-01 via the `leadingSlot` prop. This plan ONLY swaps the Customize button — leave the leadingSlot wiring intact.

**Step 3b — Update `src/components/strategy/StrategyTable.tsx`:**

This component is now responsible for:
- Owning the `<CustomizeDrawer>` open/close state
- Bridging `useDiscoveryPrefs` to the existing `viewMode` / `sortKey` / `sortDir` / `showExamples` state

Insert at the top of the component (after existing useState block from Plan 13-01):

```typescript
import { useDiscoveryPrefs } from "@/lib/discovery-prefs";
import { CustomizeDrawer } from "./CustomizeDrawer";
import type { DiscoveryViewPreferences } from "@/lib/discovery-prefs";

// ... inside StrategyTable (only when userId is provided):
const { prefs, setPrefs, hydrated } = useDiscoveryPrefs(userId ?? "anon", categorySlug);
const [customizeOpen, setCustomizeOpen] = useState(false);
const [draft, setDraft] = useState<DiscoveryViewPreferences>(prefs);
```

Add an effect that mirrors `prefs` into the existing legacy state (`viewMode`, `sortKey`, `sortDir`, `showExamples`) AFTER hydration — this keeps the existing UI logic working:

```typescript
useEffect(() => {
  if (!hydrated) return;
  setViewMode(prefs.view);
  setSortKey(prefs.sort.key);
  setSortDir(prefs.sort.dir);
  setShowExamples(!prefs.hide_examples);  // showExamples is the inverse
  setDraft(prefs);                         // sync draft when prefs change externally
}, [hydrated, prefs]);

const handleOpenCustomize = () => {
  setDraft(prefs);             // start fresh from persisted on open
  setCustomizeOpen(true);
};
const handleSavePrefs = () => {
  setPrefs(draft);
  setCustomizeOpen(false);
};
const handleCloseCustomize = () => {
  setCustomizeOpen(false);
};
```

Pass the new props to `<StrategyFilters>` and render `<CustomizeDrawer>` inside the table wrapper:

```typescript
<StrategyFilters
  // ... existing props ...
  onOpenCustomize={handleOpenCustomize}
/>

{/* ... existing table/grid render ... */}

{userId && (
  <CustomizeDrawer
    open={customizeOpen}
    onClose={handleCloseCustomize}
    draft={draft}
    setDraft={setDraft}
    persisted={prefs}
    onSave={handleSavePrefs}
  />
)}
```

Important: when `userId` is undefined (non-Discovery callers like compare/browse), do NOT render the drawer and do NOT call `useDiscoveryPrefs` (since `useDiscoveryPrefs("anon", slug)` would still write a key — leaks to localStorage on shared machines). Use a guard: only call `useDiscoveryPrefs` when `userId` is truthy. Since hooks cannot be conditionally called, factor the prefs logic into a child component:

**Cleaner approach** — add a wrapper component `<StrategyTableWithPrefs userId={...}>{children}</...>` that owns the hook and passes the resolved `viewMode/sortKey/sortDir/showExamples + onOpenCustomize` callbacks down to a presentational `StrategyTable`. **OR** keep the hook always-called but use a stable key like `"anon"` ONLY when no userId is provided AND check inside the hook for a sentinel: but this writes a key. The cleanest simple path:

- Keep `StrategyTable` as one component
- Always call `useDiscoveryPrefs(userId, categorySlug)` — but **bail to DEFAULTS without writing to localStorage if userId is undefined** by adding an `enabled?: boolean` flag to the hook. Update the hook to:
  ```typescript
  export function useDiscoveryPrefs(uid: string | undefined, slug: string) {
    const enabled = !!uid;
    // ...
    useEffect(() => {
      if (!enabled) return;
      setPrefsRaw(safeRead(uid!, slug));
      setHydrated(true);
    }, [enabled, uid, slug]);

    useEffect(() => {
      if (!hydrated || !enabled) return;
      try { window.localStorage.setItem(keyFor(uid!, slug), JSON.stringify(prefs)); } catch {}
    }, [prefs, hydrated, enabled, uid, slug]);
    // ...
  }
  ```
  This is the simplest approach. Update Task 2's hook signature retroactively to accept `string | undefined` and gate persistence on truthy uid. (Add a test in Task 1 if not already present: "useDiscoveryPrefs(undefined, slug) NEVER writes to localStorage". If absent, ADD this test now.)

**Step 3c — Run the e2e isolation spec:**

If `E2E_USER_A_EMAIL` / `E2E_USER_B_EMAIL` env vars are wired (per macOS Keychain `service: quantalyze-test` per user MEMORY.md — verify by `security find-generic-password -s "quantalyze-test" -w 2>/dev/null | head -1`), run:

```bash
npm run test:e2e -- --grep "discovery prefs isolation"
```

Else, the spec is in `test.skip` mode (Task 1) — confirm via:
```bash
npx playwright test --list -g "discovery prefs isolation"
```

Document outcome in the SUMMARY: either "spec ran GREEN" or "spec authored, skipped pending env wiring (TODOS open question 4)".

**[CHECKPOINT] human verification:** This task touches `StrategyFilters.tsx`, removes the existing `CustomizeModal`, replaces the Customize button, AND modifies `StrategyTable.tsx` (already touched in Plan 13-01). Surface area is large enough that a quick visual smoke is warranted.
  </action>
  <verify>
    <automated>npm test && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "hideExamples: true" src/components/strategy/StrategyFilters.tsx` >= 1 (default fixed; or DEFAULT_CUSTOMIZE removed entirely if unused — equivalent)
    - `grep -c "Customize discovery view" src/components/strategy/StrategyFilters.tsx` >= 1 (cog button aria-label)
    - `grep -c "aria-haspopup=\"dialog\"" src/components/strategy/StrategyFilters.tsx` >= 1
    - Inverted: `! grep -E "function CustomizeModal\\b\\|<CustomizeModal\\b" src/components/strategy/StrategyFilters.tsx` (CustomizeModal component + render call removed)
    - Inverted: `! grep "<Modal title=\"Customize" src/components/strategy/StrategyFilters.tsx` (Modal usage removed)
    - `grep -c "useDiscoveryPrefs\\|CustomizeDrawer\\|onOpenCustomize" src/components/strategy/StrategyTable.tsx` >= 3
    - `grep -c "text-\\[11px\\] font-semibold" src/components/strategy/StrategyFilters.tsx` >= 1 (activeCount chip promoted per UI-SPEC Micro-label exception)
    - Inverted: `! grep "text-\\[10px\\] font-bold" src/components/strategy/StrategyFilters.tsx` (legacy chip styling removed)
    - `grep -c "string | undefined\\|uid?: string\\|uid: string | undefined" src/lib/discovery-prefs.ts` >= 1 (hook accepts undefined uid; persistence gated)
    - `grep -c "test.skip\\|--grep" e2e/discovery-prefs-isolation.spec.ts` >= 1
    - `npm test` exits 0 (full Vitest suite no regression)
    - `npm run build` exits 0
    - `npx playwright test --list -g "discovery prefs isolation"` lists exactly 1 test
  </acceptance_criteria>
  <done>StrategyFilters renders cog button + activeCount chip promoted to 11px/600; StrategyTable wires useDiscoveryPrefs + CustomizeDrawer; hook safely handles undefined uid; e2e spec listed and either GREEN or test.skipped with documented reason.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Visual smoke — Customize drawer + prefs persistence</name>
  <files>(human-driven smoke test — touches no files)</files>
  <read_first>
    - 13-UI-SPEC.md Layout Contract (filter row order)
    - 13-UI-SPEC.md State Matrix → CustomizeDrawer
    - DESIGN.md tokens (white surface, accent button, no Plotly chrome)
  </read_first>
  <action>
    Run the manual visual-smoke checklist documented in <how-to-verify> below. This is a human-attested checkpoint — there is no Claude-side action to automate beyond what Tasks 1-3 already shipped (route handler, hook, drawer, components, e2e specs). The checkpoint exists to confirm the live browser behavior matches the unit tests + jsdom assertions.
  </action>
  <verify>
    <automated>echo "Manual checkpoint — see <how-to-verify> steps 1-19; resume only after operator types 'approved'."</automated>
  </verify>
  <done>Operator typed "approved" after running steps 1-19 against a live dev server.</done>
  <what-built>
    Plan 13-01 + 13-02 are now both wired into StrategyTable.tsx and StrategyFilters.tsx — surface area = entire filter row + the new right-edge drawer. Before merging, a 3-minute visual smoke confirms:
    - Filter row layout correct: search → All Filters → WatchlistTabs → Hide-examples → Sort → SettingsCogButton → ViewToggle
    - Cog button opens the right-edge drawer
    - Drawer matches DESIGN.md tokens (white surface, 1px left border, sticky header/footer)
    - Save / Reset / Close-X buttons all functional
    - Closing then re-opening shows the persisted state, not a stale draft
    - Reload restores the saved prefs (proves localStorage round-trip works in a real browser, not just jsdom)
  </what-built>
  <how-to-verify>
1. Start dev server: `npm run dev`
2. Sign in as the test allocator (`matratzentester24@gmail.com` / `Test12`)
3. Navigate to `http://localhost:3000/discovery/crypto-sma`
4. Verify the filter row reads left-to-right: Search → All Filters → All / My Watchlist tabs → Hide examples → Sort selects (right-aligned) → cog icon → grid/table view toggle. Per UI-SPEC Layout Contract.
5. Click the cog icon (right end of filter row, before view toggle)
6. Verify the drawer slides in from the right, has a white panel with a 1px left border, and shows `Customize` as the heading
7. Verify the description reads `Set your default view, sort, and visibility on this category. Saved per device.`
8. Verify the close-X button is in the top-right of the drawer
9. Click "Grid" inside the Default view section
10. Verify the "Save preferences" button enables (was disabled because draft = persisted)
11. Click "Save preferences"
12. Verify the drawer closes and the underlying table switches to grid view
13. Hit reload (Cmd+R / F5)
14. Verify after reload: grid view is still active (proves localStorage round-trip works)
15. Open DevTools Console; run `Object.keys(localStorage).filter(k => k.startsWith("discovery_view_preferences:"))` — expect at least one entry shaped like `discovery_view_preferences:{uuid}:crypto-sma`
16. Click cog → click "Reset to defaults" → verify draft state shows Table + Sharpe + desc + checked Hide examples; verify drawer DOES NOT close (Reset is a draft-only revert)
17. Click "Save preferences" → drawer closes → verify table view is restored
18. Click cog → press ESC → drawer closes; click cog → click backdrop (anywhere outside the panel) → drawer closes
19. Verify the existing "All Filters" button still opens the existing All-Filters drawer (regression check on the legacy slide-out)

**Pass criteria (every step):**
- Filter row matches UI-SPEC Layout Contract
- Drawer cosmetics match DESIGN.md (white surface, accent on Save button, no Plotly chrome, no purple accents)
- Save/Reset/Close work as documented
- Reload preserves saved state
- localStorage key shape matches `discovery_view_preferences:{uuid}:crypto-sma` exactly

**Fail signals:**
- Hydration error in DevTools console on first paint
- Drawer renders as a centered modal instead of right-edge slide-out (would mean Modal usage leaked through)
- Save button stays disabled after a real change (dirty detection broken)
- Reload reverts to defaults (persistence-effect not gated correctly)
- localStorage key uses just the slug without the uid (regression to insecure shape)
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues. If issues exist, the planner returns to the relevant Task with a Rule 1/2/3 fix.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser localStorage → another browser session (same machine) | A user's preferences are stored unencrypted in localStorage. Cross-account isolation depends entirely on the per-uid key shape — no other layer enforces it. |
| Server (SSR) → Browser | The page renders DEFAULTS server-side; the client mounts the hook and reads localStorage on first render. The one-frame mismatch is masked by the existing `<Skeleton>` rows. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-13-02-01 | Information Disclosure (cross-account leak on shared machines) | `discovery_view_preferences:*` localStorage entries | mitigate | Per-uid key shape `discovery_view_preferences:{auth.uid}:{slug}`. The hook structurally cannot read another uid's entry — the key is constructed from the current `auth.uid()` only. The Playwright spec `e2e/discovery-prefs-isolation.spec.ts` proves login-as-A-then-login-as-B leaves zero A-keys readable in B's session. ASVS V3 (Session Management) control. |
| T-13-02-02 | Tampering (user edits localStorage to set malicious values) | useDiscoveryPrefs `safeRead` | mitigate | The hook applies `{...DEFAULTS, ...parsed}` partial-merge so only known fields land in the typed `DiscoveryViewPreferences`. Any extra fields a user might inject via DevTools are ignored. The fields themselves (view, sort, hide_examples) have no security or commercial impact — worst case a user sees their own table sorted oddly. ASVS V5 (Input Validation) control at the merge layer. |
| T-13-02-03 | Information Disclosure (server logs persist user uid in URL) | n/a — uid is in localStorage key only, not URL | accept | The uid never appears in URLs or server logs from this feature. Existing Supabase auth cookies already carry the uid implicitly. |
| T-13-02-04 | Denial of Service (localStorage quota exhaustion via repeated saves) | useDiscoveryPrefs persistence-effect | accept | The hook writes a single small JSON entry (~120 bytes); even pathological save spam cannot fill the 5MB quota in a session. Try/catch around `setItem` quietly absorbs Safari private mode + quota errors. |
</threat_model>

<verification>
**Wave 0 (Task 1):** All 3 test files exist; unit tests are RED. Acceptance grep verifies file structure and minimum test count.

**Wave 1 (Tasks 2 + 3):**
- All Vitest unit suites GREEN: `npm test -- src/lib/discovery-prefs src/components/strategy/CustomizeDrawer`
- Full Vitest suite has no regressions: `npm test` exits 0
- `npm run build` exits 0 (no TypeScript regression)
- Playwright spec lists: `npx playwright test --list -g "discovery prefs isolation"` shows exactly 1 test
- ASVS V3 control verified: `grep -c "discovery_view_preferences:.*:.*" src/lib/discovery-prefs.ts` >= 1 (per-uid key)

**Wave 2 (Task 4):** Human visual smoke approves the live drawer behavior.

**Goal-backward grep checks:**
- `grep -c "hide_examples: true" src/lib/discovery-prefs.ts` >= 1 (DISCO-05 default lock)
- `grep -c "if (!hydrated) return\\|if (!enabled) return" src/lib/discovery-prefs.ts` >= 1 (persistence gate)
- `grep -c "useDiscoveryPrefs" src/components/strategy/StrategyTable.tsx` >= 1
- `grep -c "<CustomizeDrawer" src/components/strategy/StrategyTable.tsx` >= 1
- `grep -c "Save preferences" src/components/strategy/CustomizeDrawer.tsx` >= 2

**Negative checks:**
- `! grep "<Modal title=\"Customize" src/components/strategy/StrategyFilters.tsx` (legacy CustomizeModal removed)
- `! grep "from \"axios\"" src/lib/discovery-prefs.ts src/components/strategy/CustomizeDrawer.tsx`
- `! grep -E "lucide-react|@heroicons|react-icons" src/lib/discovery-prefs.ts src/components/strategy/CustomizeDrawer.tsx`
</verification>

<success_criteria>
1. **DISCO-02 acceptance criterion 2 (REQUIREMENTS.md line 18):** Customize prefs (Default view / Default sort / Hide examples) persist in localStorage keyed by `{auth.uid}:{slug}`; cross-account leakage is prevented. Verified by `e2e/discovery-prefs-isolation.spec.ts`.
2. **CONTEXT.md DISCO-02 locked decisions:**
   - Customize trigger = settings-cog at right end of StrategyFilters row.
   - Panel = right-edge slide-out drawer (NOT a centered Modal).
   - No migration of any prior keys (clean break).
   - Defaults: view=table, sort=sharpe-desc, hide_examples=true.
3. **DISCO-05 cross-link:** The `hide_examples=true` default in DEFAULTS is a hard contract. Plan 13-04 (data-only `is_example=true` backfill) is the other half — together they ensure a fresh allocator's first Discovery visit shows zero example strategies.
4. **Threat model:** T-13-02-01 (cross-account leak) MITIGATED with the per-uid key + Playwright proof. T-13-02-02 (tampering) MITIGATED at the merge layer. T-13-02-03/04 ACCEPTED with rationale.
5. **No regression:** `npm test` exits 0; `npm run build` exits 0; Playwright spec lists.
6. **Human visual smoke (Task 4)** approves drawer behavior end-to-end.
</success_criteria>

<output>
After completion, create `.planning/phases/13-discovery-v2-polish/13-02-SUMMARY.md` summarizing:
- The 5 source files created/modified
- Threat-model dispositions and code references
- Test result counts (Vitest + Playwright)
- e2e cross-account spec status (GREEN | skipped | failed) + reason
- Whether `DEFAULT_CUSTOMIZE` was kept-with-fix or removed entirely (note importer count)
- Any deviations + Rule 1/2/3 categorization
- Open follow-ups for Plan 13-03 (sparkline single-accent rule shares the same StrategyTable)
</output>

==== FILE: 13-04-PLAN.md ====
---
phase: 13
plan: 04
type: execute
wave: 3
depends_on:
  - 13-01
  - 13-02
files_modified:
  - src/lib/sparkline-color.ts
  - src/lib/sparkline-color.test.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyTable.test.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/strategy/StrategyGrid.test.tsx
  - e2e/discovery-sparkline-regression.spec.ts
autonomous: true
requirements:
  - DISCO-04
tags:
  - sparkline
  - design-system
  - DIFF-05
  - visual-regression
  - design-fidelity

must_haves:
  truths:
    - "Sparkline strokes on /discovery/[slug] use #1B6B5A (accent) when the final value of sparkline_returns is positive"
    - "Sparkline strokes on /discovery/[slug] use #DC2626 (negative) when the final value of sparkline_returns is negative"
    - "Sparkline strokes on /discovery/[slug] use #94A3B8 (chart-benchmark) when the final value of sparkline_returns is exactly zero (or empty array)"
    - "The drawdown sparkline cell at StrategyTable.tsx:319 keeps using --color-negative statically (NOT subject to the sign-driven rule — drawdown is always non-positive)"
    - "No SVG path element on /discovery/[slug] has BOTH #16A34A and #DC2626 stroke colors simultaneously (DESIGN.md DIFF-05 single-accent rule)"
    - "Sparkline.tsx itself is unchanged — the color rule lives at the call site, preserving the 'caller picks color' contract"
  artifacts:
    - path: "src/lib/sparkline-color.ts"
      provides: "sparklineColor(data: number[]): string — pure function returning the CSS variable name based on final-value sign"
      exports: ["sparklineColor"]
    - path: "src/lib/sparkline-color.test.ts"
      provides: "Vitest unit tests covering positive / negative / zero / empty input"
    - path: "e2e/discovery-sparkline-regression.spec.ts"
      provides: "Playwright DOM walk asserting no SVG mixes #16A34A and #DC2626 strokes"
  key_links:
    - from: "src/components/strategy/StrategyTable.tsx"
      to: "src/lib/sparkline-color.ts:sparklineColor"
      via: "applied to sparkline_returns rendering at the table row's returns column (line ~315)"
      pattern: "sparklineColor\\(s\\.analytics\\.sparkline_returns"
    - from: "src/components/strategy/StrategyGrid.tsx"
      to: "src/lib/sparkline-color.ts:sparklineColor"
      via: "applied to sparkline_returns rendering inside the Card body (line ~88)"
      pattern: "sparklineColor\\(s\\.analytics\\.sparkline_returns"
    - from: "e2e/discovery-sparkline-regression.spec.ts"
      to: "src/components/charts/Sparkline.tsx (rendered output)"
      via: "DOM-walks all <svg path[stroke]> elements under /discovery/[slug]; asserts none contain BOTH green and red strokes"
      pattern: "discovery-sparkline-regression"
---

<objective>
Ship DISCO-04 — single-accent sparkline rule on /discovery/[slug]. The Sparkline component already supports a single `color` prop; this plan wires the sign-driven rule (`#1B6B5A` if final>0, `#DC2626` if final<0, `#94A3B8` if final==0 or empty) at the two `sparkline_returns` call sites in `StrategyTable.tsx` and `StrategyGrid.tsx`. The drawdown sparkline at `StrategyTable.tsx:319` is OUT OF SCOPE — drawdown is statically non-positive and already passes `color="var(--color-negative)"`. A Playwright spec walks every SVG on the discovery page and asserts none mix `#16A34A` (positive return text color) and `#DC2626` strokes — this catches any future regression to per-point color splitting.

Purpose: DESIGN.md DIFF-05 is a locked design contract. The Playwright spec exists *specifically* to prevent regression to the split-color style.

Output: 1 new pure-function module + 1 unit test + edits to 2 sparkline call sites + 1 Playwright spec + 2 component test files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/13-discovery-v2-polish/13-CONTEXT.md
@.planning/phases/13-discovery-v2-polish/13-RESEARCH.md
@.planning/phases/13-discovery-v2-polish/13-UI-SPEC.md
@.planning/phases/13-discovery-v2-polish/13-VALIDATION.md
@.planning/phases/13-discovery-v2-polish/13-01-PLAN.md
@.planning/phases/13-discovery-v2-polish/13-02-PLAN.md
@DESIGN.md
@./CLAUDE.md
@./AGENTS.md

@src/components/charts/Sparkline.tsx
@src/components/strategy/StrategyTable.tsx
@src/components/strategy/StrategyGrid.tsx

<interfaces>
<!-- Patterns the executor needs to honor verbatim. -->

From src/components/charts/Sparkline.tsx (current contract — unchanged):
```typescript
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;        // ← caller picks; default "var(--color-chart-strategy)"
  fill?: boolean;
  className?: string;
}
```

From src/components/strategy/StrategyTable.tsx (call sites):
```typescript
// Line ~315 — RETURNS sparkline (Phase 13 SCOPE):
<Sparkline data={s.analytics.sparkline_returns ?? []} />

// Line ~319 — DRAWDOWN sparkline (Phase 13 OUT OF SCOPE):
<Sparkline
  data={s.analytics.sparkline_drawdown ?? []}
  color="var(--color-negative)"
  fill
/>
```

From src/components/strategy/StrategyGrid.tsx (call site, lines ~88-93):
```typescript
<Sparkline
  data={s.analytics.sparkline_returns ?? []}
  width={240}
  height={40}
  className="w-full"
/>
```

DESIGN.md tokens (locked):
- --color-accent: #1B6B5A
- --color-chart-strategy: #1B6B5A (alias of accent)
- --color-negative: #DC2626
- --color-chart-benchmark: #94A3B8
- --color-positive: #16A34A (used for return-percentage TEXT, NOT for sparkline strokes per DIFF-05)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wave 0 — sparkline-color helper + visual regression test scaffolding (RED)</name>
  <files>src/lib/sparkline-color.test.ts, src/components/strategy/StrategyTable.test.tsx (extend with DISCO-04 describe), src/components/strategy/StrategyGrid.test.tsx (create or extend), e2e/discovery-sparkline-regression.spec.ts</files>
  <read_first>
    - src/components/charts/Sparkline.tsx (single-color contract)
    - src/components/strategy/StrategyTable.tsx (lines 310-330 — both sparkline call sites)
    - src/components/strategy/StrategyGrid.tsx (lines 80-100 — sparkline call site)
    - 13-RESEARCH.md Pattern 3 (Sign-driven sparkline color at the call site)
    - 13-RESEARCH.md Pitfall 7 (drawdown sparkline must NOT receive the rule)
    - 13-RESEARCH.md Example 3 (regression spec template)
    - 13-UI-SPEC.md Color → Sparkline color rule table
    - DESIGN.md (color tokens locked)
  </read_first>
  <behavior>
    - sparkline-color.test.ts: covers positive/negative/zero/empty input; returns CSS variable strings (NOT hex literals) so token changes propagate
    - StrategyTable.test.tsx + StrategyGrid.test.tsx: add cases asserting the color prop on the returns Sparkline matches sign-driven rule for each of three fixtures (final>0, final<0, final==0)
    - e2e/discovery-sparkline-regression.spec.ts: DOM-walks every SVG under /discovery/[slug] and asserts no SVG has BOTH #16A34A and #DC2626 strokes (sign-color split)
  </behavior>
  <action>
Create the test files. All unit tests are in RED state at end of task; the e2e spec is authored.

**File 1: `src/lib/sparkline-color.test.ts`** — Vitest pure-function tests:

```typescript
import { describe, it, expect } from "vitest";
import { sparklineColor } from "./sparkline-color";

describe("sparklineColor", () => {
  it("returns var(--color-accent) when final value > 0", () => {
    expect(sparklineColor([0, 0.05, 0.1])).toBe("var(--color-accent)");
  });

  it("returns var(--color-negative) when final value < 0", () => {
    expect(sparklineColor([0, -0.02, -0.05])).toBe("var(--color-negative)");
  });

  it("returns var(--color-chart-benchmark) when final value === 0", () => {
    expect(sparklineColor([0.01, -0.01, 0])).toBe("var(--color-chart-benchmark)");
  });

  it("returns var(--color-chart-benchmark) on empty array", () => {
    expect(sparklineColor([])).toBe("var(--color-chart-benchmark)");
  });

  it("handles single-element arrays — value is also the final", () => {
    expect(sparklineColor([0.5])).toBe("var(--color-accent)");
    expect(sparklineColor([-0.5])).toBe("var(--color-negative)");
    expect(sparklineColor([0])).toBe("var(--color-chart-benchmark)");
  });

  it("ignores intermediate values — only the final value drives the color", () => {
    // Path goes positive → negative → positive, ends positive → accent
    expect(sparklineColor([0.5, -0.3, 0.1])).toBe("var(--color-accent)");
    // Path goes positive → positive → negative, ends negative → negative color
    expect(sparklineColor([0.5, 0.3, -0.1])).toBe("var(--color-negative)");
  });
});
```

**File 2: extend `src/components/strategy/StrategyTable.test.tsx`** (created in Plan 13-01) — add a `describe("DISCO-04 sparkline color rule")` block:

```typescript
describe("DISCO-04 sparkline color rule (returns column only)", () => {
  it("renders the returns sparkline with var(--color-accent) when final > 0", () => {
    // Build a fixture strategy with sparkline_returns ending positive (e.g., [0, 0.05, 0.1])
    // Render <StrategyTable strategies={[fixture]} userId="u1" categorySlug="crypto-sma" />
    // Find the returns sparkline cell (NOT the drawdown cell — those are siblings)
    // Assert its <path stroke="..."> attribute resolves to var(--color-accent)
    // Implementation hint: locate via the column index — returns sparkline is the 2nd-to-last cell, drawdown is the last sparkline cell
  });
  it("renders the returns sparkline with var(--color-negative) when final < 0", () => { /* fixture: [0, -0.02, -0.05] */ });
  it("renders the returns sparkline with var(--color-chart-benchmark) when final === 0", () => { /* fixture: [0.01, -0.01, 0] */ });
  it("does NOT change the drawdown sparkline color (always var(--color-negative))", () => {
    // Build a fixture with sparkline_drawdown values; assert drawdown cell color == var(--color-negative)
    // even when sparkline_returns ends positive — proves the new rule does NOT bleed into drawdown
  });
});
```

**File 3: extend `src/components/strategy/StrategyGrid.test.tsx`** — create the file if it doesn't exist (template from `WorstDrawdowns.test.tsx`); add a `describe("DISCO-04 sparkline color rule")`:

```typescript
describe("DISCO-04 sparkline color rule on grid card", () => {
  it("renders the card sparkline with var(--color-accent) when final > 0", () => { /* render single-strategy grid; locate sparkline; assert color */ });
  it("renders the card sparkline with var(--color-negative) when final < 0", () => { /* */ });
  it("renders the card sparkline with var(--color-chart-benchmark) when final === 0", () => { /* */ });
});
```

**File 4: `e2e/discovery-sparkline-regression.spec.ts`** — Playwright DOM walk per RESEARCH.md Example 3:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Discovery sparkline single-accent rule (DESIGN.md DIFF-05)", () => {
  test.beforeEach(async ({ page }) => {
    // Reuse the matratzentester24 fixture from full-flow.spec.ts
    await page.goto("/login");
    await page.fill('input[name="email"], input[placeholder*="email" i]', "matratzentester24@gmail.com");
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
  });

  test("no sparkline SVG on /discovery/crypto-sma mixes positive (#16A34A) and negative (#DC2626) strokes", async ({ page }) => {
    // Walk every SVG under the table; for each, collect the set of distinct stroke colors used by its <path> children
    const distinctPerSvg = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll("table svg, [data-testid='strategy-grid'] svg")) as SVGElement[];
      return svgs.map((svg) => {
        const strokes = new Set(
          Array.from(svg.querySelectorAll("path[stroke]"))
            .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
            .filter((s) => s && s !== "none")
            .map((s) => s.toLowerCase()),
        );
        return [...strokes];
      });
    });

    expect(distinctPerSvg.length).toBeGreaterThan(0);

    for (const strokes of distinctPerSvg) {
      // Forbidden: any single SVG mixing #16A34A (positive) and #DC2626 (negative).
      // Note: The accent #1B6B5A is the canonical positive stroke; #16A34A is positive-text-color
      // and would only appear on sparklines if someone reintroduced split-color. Either being on
      // the same path as #DC2626 is a failure.
      const hasGreen = strokes.some((s) => /#16a34a|var\(--color-positive\)/i.test(s));
      const hasRed = strokes.some((s) => /#dc2626|var\(--color-negative\)/i.test(s));
      expect(hasGreen && hasRed).toBe(false);
    }
  });

  test("each sparkline SVG owns at most one stroke color (single-trace rule)", async ({ page }) => {
    const distinctPerSvg = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll("table svg, [data-testid='strategy-grid'] svg")) as SVGElement[];
      return svgs.map((svg) => {
        const strokes = new Set(
          Array.from(svg.querySelectorAll("path[stroke]"))
            .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
            .filter((s) => s && s !== "none"),
        );
        return strokes.size;
      });
    });

    for (const size of distinctPerSvg) {
      // Each sparkline is one path → one stroke color. The bookkeeping circle endpoint inherits the same fill (not stroke).
      // Drawdown SVGs may have a fill path AND a stroke path — but both should share the same color.
      expect(size).toBeLessThanOrEqual(1);
    }
  });
});
```

CRITICAL: All RED. The helper module does not exist; the table call sites still use the default Sparkline color (or no color at all for returns).
  </action>
  <verify>
    <automated>npm test -- src/lib/sparkline-color src/components/strategy/StrategyTable src/components/strategy/StrategyGrid 2>&1 | grep -E "(FAIL|failed)" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - File `src/lib/sparkline-color.test.ts` exists with `grep -c "it\\|test(" >= 6`
    - File `src/components/strategy/StrategyGrid.test.tsx` exists OR has been extended with the DISCO-04 describe block
    - File `e2e/discovery-sparkline-regression.spec.ts` exists in `e2e/` directory
    - `grep -c "var(--color-accent)\\|var(--color-negative)\\|var(--color-chart-benchmark)" src/lib/sparkline-color.test.ts` >= 3 (all three colors covered)
    - `grep -c "drawdown sparkline\\|sparkline_drawdown" src/components/strategy/StrategyTable.test.tsx` >= 1 (Pitfall 7 — drawdown out-of-scope assertion)
    - `grep -c "#16a34a\\|#16A34A" e2e/discovery-sparkline-regression.spec.ts` >= 1 AND `grep -c "#dc2626\\|#DC2626" e2e/discovery-sparkline-regression.spec.ts` >= 1 (split-color regression check)
    - `grep -c "hasGreen && hasRed" e2e/discovery-sparkline-regression.spec.ts` >= 1
    - `! grep "tests/e2e/" e2e/discovery-sparkline-regression.spec.ts` (Pitfall 3 — actual e2e dir is `e2e/`)
    - `npm test -- src/lib/sparkline-color 2>&1` exits non-zero (RED — sparkline-color.ts does not yet exist)
  </acceptance_criteria>
  <done>3 test files exist; unit tests are RED; e2e spec is authored.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wave 1 — Implement sparkline-color helper + wire to call sites (GREEN)</name>
  <files>src/lib/sparkline-color.ts, src/components/strategy/StrategyTable.tsx (single-line edit at returns sparkline call site), src/components/strategy/StrategyGrid.tsx (single-line edit at card sparkline call site)</files>
  <read_first>
    - src/lib/sparkline-color.test.ts (Task 1)
    - src/components/strategy/StrategyTable.test.tsx (DISCO-04 describe block)
    - src/components/strategy/StrategyGrid.test.tsx (DISCO-04 describe block)
    - src/components/strategy/StrategyTable.tsx (call sites at lines ~315 and ~319)
    - src/components/strategy/StrategyGrid.tsx (call site at lines ~88-93)
    - 13-RESEARCH.md Pitfall 7 (drawdown call site stays static)
  </read_first>
  <behavior>
    Pure helper that returns CSS variable strings. Two call-site edits — surgical, leave Sparkline.tsx untouched.
  </behavior>
  <action>
**File 1: `src/lib/sparkline-color.ts`** — pure function, no React dependency:

```typescript
/**
 * DESIGN.md DIFF-05 single-accent sparkline rule.
 *
 * The Sparkline component renders a single-color trace; the caller picks the color.
 * For sparkline_returns on /discovery/[slug], the color is driven by the FINAL value
 * of the series — not by per-point sign. This avoids the split-color anti-pattern that
 * was reintroduced multiple times historically (see e2e/discovery-sparkline-regression.spec.ts
 * for the regression gate).
 *
 * Drawdown sparklines (StrategyTable.tsx:319) are NOT subject to this rule — they pass
 * color="var(--color-negative)" statically because drawdown is by definition non-positive.
 */
export function sparklineColor(data: number[]): string {
  if (!data || data.length === 0) return "var(--color-chart-benchmark)";
  const final = data[data.length - 1];
  if (final > 0) return "var(--color-accent)";
  if (final < 0) return "var(--color-negative)";
  return "var(--color-chart-benchmark)";
}
```

**File 2: edit `src/components/strategy/StrategyTable.tsx`** at the returns sparkline call site (~line 315). Surgical change:

```typescript
// BEFORE:
<Sparkline data={s.analytics.sparkline_returns ?? []} />

// AFTER (add color prop derived from sparklineColor):
<Sparkline
  data={s.analytics.sparkline_returns ?? []}
  color={sparklineColor(s.analytics.sparkline_returns ?? [])}
/>
```

Add `import { sparklineColor } from "@/lib/sparkline-color";` at the top alongside existing imports.

**DO NOT TOUCH the drawdown call site at line ~319.** It stays as `color="var(--color-negative)"` per Pitfall 7. If you accidentally modify it, the Task 1 test "does NOT change the drawdown sparkline color" will fail.

**File 3: edit `src/components/strategy/StrategyGrid.tsx`** at the card sparkline call site (~lines 88-93):

```typescript
// BEFORE:
<Sparkline
  data={s.analytics.sparkline_returns ?? []}
  width={240}
  height={40}
  className="w-full"
/>

// AFTER:
<Sparkline
  data={s.analytics.sparkline_returns ?? []}
  color={sparklineColor(s.analytics.sparkline_returns ?? [])}
  width={240}
  height={40}
  className="w-full"
/>
```

Add `import { sparklineColor } from "@/lib/sparkline-color";` at the top.

**Verification after wiring:**
1. `npm test -- src/lib/sparkline-color` exits 0
2. `npm test -- src/components/strategy/StrategyTable src/components/strategy/StrategyGrid` exits 0
3. `npm run build` exits 0
4. Inverted: confirm `Sparkline.tsx` itself was NOT modified — `git diff src/components/charts/Sparkline.tsx` shows no changes.

**Run the e2e spec** if a dev server is available:
```bash
npm run test:e2e -- --grep "sparkline single-accent"
```
The matratzentester24 fixture has at least 8 seeded strategies with mixed-sign sparkline_returns (per scripts/seed-demo-data.ts:STRATEGY_PROFILES — annualizedReturn ranges from 0.11 to 0.28, all positive in expectation, but mulberry32 PRNG seeded fixtures will produce both positive and negative final values across the 8 strategies). The spec walks every SVG and asserts no mixing — should be GREEN.

If e2e cannot run (no dev server), use:
```bash
npx playwright test --list -g "sparkline single-accent"
```
to confirm the spec is registered.
  </action>
  <verify>
    <automated>npm test -- src/lib/sparkline-color src/components/strategy/StrategyTable src/components/strategy/StrategyGrid && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export function sparklineColor" src/lib/sparkline-color.ts` == 1
    - `grep -c "var(--color-accent)\\|var(--color-negative)\\|var(--color-chart-benchmark)" src/lib/sparkline-color.ts` >= 3 (all three branches)
    - `grep -c "data\\[data.length - 1\\]\\|data.length === 0\\|data.length == 0\\|!data\\|data\\.length" src/lib/sparkline-color.ts` >= 2 (final-value comparison + empty guard)
    - `grep -c "sparklineColor(s.analytics.sparkline_returns" src/components/strategy/StrategyTable.tsx` == 1 (one call site — returns column only)
    - `grep -c "sparklineColor(s.analytics.sparkline_returns" src/components/strategy/StrategyGrid.tsx` == 1 (card body)
    - `grep -c "import.*sparklineColor.*from.*sparkline-color" src/components/strategy/StrategyTable.tsx` >= 1
    - `grep -c "import.*sparklineColor.*from.*sparkline-color" src/components/strategy/StrategyGrid.tsx` >= 1
    - **Pitfall 7 invariant** — drawdown call site unchanged: `grep -c "color=\"var(--color-negative)\"" src/components/strategy/StrategyTable.tsx` >= 1 AND `grep -c "sparkline_drawdown" src/components/strategy/StrategyTable.tsx` >= 1
    - **Pitfall 7 invariant** — drawdown call site does NOT use sparklineColor: zero matches for `sparklineColor(s.analytics.sparkline_drawdown` (the helper is only applied to the returns column)
    - Sparkline component itself unchanged: `git diff --stat src/components/charts/Sparkline.tsx` shows 0 lines changed (`! git diff --quiet src/components/charts/Sparkline.tsx; echo $?` returns 0 means no diff)
    - `npm test -- src/lib/sparkline-color src/components/strategy/StrategyTable src/components/strategy/StrategyGrid` exits 0
    - `npm run build` exits 0
    - `npx playwright test --list -g "sparkline single-accent"` lists at least 1 test
  </acceptance_criteria>
  <done>sparkline-color helper GREEN; both call sites wired; Sparkline.tsx untouched; drawdown invariant preserved; e2e spec registered.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| n/a | This plan introduces no security-sensitive surfaces. Read-only color computation against pre-rendered analytics. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-13-04-01 | Information Disclosure (color leaks something about the strategy) | sparklineColor helper + call sites | accept | Color reflects the publicly-rendered final value of `sparkline_returns`, which is already visible in adjacent percentage cells (e.g., the `cumulative_return` column). Adding a color encoding does not leak any information not already in the DOM. No PII, no proprietary data. |
| T-13-04-02 | Tampering (visual regression to split-color sparklines) | Sparkline call sites | mitigate | The Playwright spec `e2e/discovery-sparkline-regression.spec.ts` runs in CI on every PR and fails if any SVG mixes `#16A34A` and `#DC2626` strokes. This is the structural defense against the design-rule violation (DESIGN.md DIFF-05). Out of ASVS scope but is a regression gate. |
</threat_model>

<verification>
**Wave 0 (Task 1):** All 3 test files exist; unit tests are RED.

**Wave 1 (Task 2):**
- All Vitest unit suites GREEN: `npm test -- src/lib/sparkline-color src/components/strategy/StrategyTable src/components/strategy/StrategyGrid`
- Full Vitest suite has no regressions: `npm test` exits 0
- `npm run build` exits 0
- Sparkline.tsx is untouched (caller-side rule contract preserved)
- Drawdown call site is untouched (Pitfall 7 invariant preserved)
- Playwright spec `discovery-sparkline-regression` is registered

**Goal-backward grep checks:**
- `grep -c "sparklineColor" src/lib/sparkline-color.ts` >= 1 (export)
- `grep -c "import.*sparklineColor" src/components/strategy/StrategyTable.tsx src/components/strategy/StrategyGrid.tsx` >= 2 (both call sites)
- `! git diff --quiet src/components/charts/Sparkline.tsx; echo $?` exits 0 (no changes to Sparkline)

**Negative checks:**
- `! grep "sparklineColor(s.analytics.sparkline_drawdown" src/components/strategy/StrategyTable.tsx` (drawdown invariant)
- `! grep -E "lucide-react|@heroicons|react-icons" src/lib/sparkline-color.ts`
</verification>

<success_criteria>
1. **DISCO-04 acceptance criterion 3 (REQUIREMENTS.md line 20):** Sparklines on row + card use single accent color across the trace; never split green/red by daily return; fill color decided by final-value sign. Verified by sparkline-color.test.ts + StrategyTable.test.tsx + StrategyGrid.test.tsx + e2e regression spec.
2. **CONTEXT.md DISCO-04 locked decision:** color rule lives at the call site, not inside Sparkline.tsx (preserves "Sparkline is single-color, caller picks the color" contract).
3. **Pitfall 7 invariant:** the drawdown sparkline at StrategyTable.tsx:319 still uses `color="var(--color-negative)"` statically — sign-driven rule does NOT bleed into drawdown.
4. **Visual regression gate:** `e2e/discovery-sparkline-regression.spec.ts` walks every SVG on /discovery/crypto-sma and fails if any mixes `#16A34A` and `#DC2626` strokes.
5. **No regression:** `npm test` exits 0; `npm run build` exits 0; Sparkline.tsx untouched.
</success_criteria>

<output>
After completion, create `.planning/phases/13-discovery-v2-polish/13-04-SUMMARY.md` summarizing:
- The helper + the 2 call-site edits
- Confirmation that Sparkline.tsx was untouched (cite git diff stat)
- Confirmation that the drawdown call site invariant was preserved
- Test result counts (Vitest + Playwright)
- e2e spec status (GREEN | listed-only | failed)
- Any deviations + Rule 1/2/3 categorization
- Open follow-ups for Plan 13-05 (data-only is_example backfill — independent surface)
</output>

==== FILE: 13-05-PLAN.md ====
---
phase: 13
plan: 05
type: execute
wave: 4
depends_on:
  - 13-02
files_modified:
  - supabase/migrations/090_seed_is_example_backfill.sql
  - e2e/discovery-hide-examples-default.spec.ts
autonomous: false
requirements:
  - DISCO-05
tags:
  - is_example
  - seed-backfill
  - data-only-migration
  - supabase-db-push
  - hide-examples-default

must_haves:
  truths:
    - "All 8 seed strategy UUIDs (cccccccc-0001-4000-8000-000000000001 through ..-000000000008) have is_example=true after migration 090 applies"
    - "Migration 090 is data-only DML (UPDATE strategies SET is_example=true WHERE id IN (...)) — no DDL, no ALTER TABLE"
    - "Migration 090 is idempotent — running twice is a no-op (set-to-true is the same as set-to-true)"
    - "A fresh allocator's first /discovery/[slug] visit shows zero example strategies (because Plan 13-02 already locked DEFAULTS.hide_examples = true)"
    - "After running supabase db push, the audit query SELECT COUNT(*) FROM strategies WHERE id IN (<seed UUIDs>) AND is_example=true returns 8"
  artifacts:
    - path: "supabase/migrations/090_seed_is_example_backfill.sql"
      provides: "Data-only DML migration with literal seed UUID list and an idempotent UPDATE"
      contains: "UPDATE strategies SET is_example = true WHERE id IN"
    - path: "e2e/discovery-hide-examples-default.spec.ts"
      provides: "Playwright spec proving a fresh allocator (no localStorage entry) lands on /discovery/[slug] with zero example strategies visible"
  key_links:
    - from: "supabase/migrations/090_seed_is_example_backfill.sql"
      to: "scripts/seed-demo-data.ts:STRATEGY_UUIDS (lines 44-53)"
      via: "Literal UUIDs hard-coded in WHERE id IN clause; matches the seeder's 8-element STRATEGY_UUIDS array"
      pattern: "cccccccc-0001-4000-8000-00000000000"
    - from: "e2e/discovery-hide-examples-default.spec.ts"
      to: "src/lib/discovery-prefs.ts:DEFAULTS (Plan 13-02)"
      via: "Spec relies on hide_examples=true default to hide example strategies on first visit"
      pattern: "hide_examples\\|hide-examples\\|example"
---

<objective>
Ship DISCO-05 — `is_example=true` data-only backfill for the 8 canonical seed strategy UUIDs, plus the e2e gate proving a fresh allocator (no localStorage entry, no prior session prefs) sees zero example strategies on first /discovery/[slug] visit. The Customize default `hide_examples=true` is locked in Plan 13-02; this plan ships the other half — the seed rows must actually have `is_example=true` for that filter to do anything. Production audit on 2026-04-28 returned `count(strategies WHERE is_example=true AND status='published') = 0` per TODOS.md, so this migration is a one-shot real fix, not a no-op.

Per orchestrator's BLOCKING schema-push requirement: the migration ships and `supabase db push` runs against the remote DB before verification. The `autonomous: false` flag is set because supabase db push may require interactive confirmation that cannot be suppressed.

Note on UUID count: orchestrator's planning context says "6 values from `scripts/seed-demo-data.ts:STRATEGY_UUIDS`", but inspection of that file confirms the array has 8 elements (`STRATEGY_UUIDS[0..7]`) and all 8 are inserted with `is_example=true` by the seeder at line 904. This plan ships ALL 8 to match the actual seeder; running a 6-UUID subset would leave 2 rows in production unflagged. Documented as a Rule 1 deviation from the orchestrator's prompt.

Output: 1 new SQL migration file + 1 new Playwright spec + supabase db push outcome captured in the SUMMARY.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/13-discovery-v2-polish/13-CONTEXT.md
@.planning/phases/13-discovery-v2-polish/13-RESEARCH.md
@.planning/phases/13-discovery-v2-polish/13-VALIDATION.md
@.planning/phases/13-discovery-v2-polish/TODOS.md
@.planning/phases/13-discovery-v2-polish/13-02-PLAN.md
@./CLAUDE.md
@./AGENTS.md

@scripts/seed-demo-data.ts
@supabase/migrations/089_claim_failed_retry.sql
@e2e/full-flow.spec.ts
@e2e/helpers/seed-test-project.ts

<interfaces>
<!-- Patterns the executor needs to honor verbatim. -->

From scripts/seed-demo-data.ts (lines 44-53 — the canonical seed UUID list):
```typescript
export const STRATEGY_UUIDS = [
  "cccccccc-0001-4000-8000-000000000001",
  "cccccccc-0001-4000-8000-000000000002",
  "cccccccc-0001-4000-8000-000000000003",
  "cccccccc-0001-4000-8000-000000000004",
  "cccccccc-0001-4000-8000-000000000005",
  "cccccccc-0001-4000-8000-000000000006",
  "cccccccc-0001-4000-8000-000000000007",
  "cccccccc-0001-4000-8000-000000000008",
] as const;
```
All 8 are inserted with `is_example: true` by the seeder at line 904 — this migration is a defensive backfill against pre-existing rows that may have been seeded with the column missing or false.

From `supabase/migrations/089_claim_failed_retry.sql` — confirms the highest migration number on disk is 089. Phase 13's only DML migration takes the next free number = **090** (089 is `089_claim_failed_retry.sql` from PR #82).

From src/lib/discovery-prefs.ts:DEFAULTS (shipped in Plan 13-02):
```typescript
export const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,        // ← locked
};
```

Existing schema (already shipped):
- `migration 001_initial_schema.sql:64` declares `is_example BOOLEAN NOT NULL DEFAULT false` on `strategies`
- `migration 001:64` is the column declaration; no DDL needed in Phase 13.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author migration 090 — idempotent is_example=true backfill on seed UUIDs</name>
  <files>supabase/migrations/090_seed_is_example_backfill.sql</files>
  <read_first>
    - scripts/seed-demo-data.ts:44-53 (STRATEGY_UUIDS array — 8 entries)
    - scripts/seed-demo-data.ts:890-910 (seeder insert site — confirms all 8 get is_example=true)
    - supabase/migrations/089_claim_failed_retry.sql (highest existing migration number; main now has 089_claim_failed_retry — confirms 090 is next free for Phase 13)
    - 13-CONTEXT.md "Audit Gate, Seed Backfill" section (data-only migration mandate)
    - 13-RESEARCH.md "Don't Hand-Roll" → Seed UUID extraction (hard-coded list, not query-based)
    - TODOS.md Seed UUIDs section
  </read_first>
  <behavior>
    Plain SQL DML migration. Idempotent. No DDL. Hard-coded UUID list. Self-documenting comment header. Validates row count post-update (raises notice if not 8).
  </behavior>
  <action>
Create `supabase/migrations/090_seed_is_example_backfill.sql` with the following content (use the Write tool — never heredoc cat):

```sql
-- 090_seed_is_example_backfill.sql
--
-- DISCO-05 (Phase 13 / v0.17.0.0) — Data-only backfill of `is_example=true`
-- on the 8 canonical seed strategy UUIDs.
--
-- Why a migration: production audit on 2026-04-28 returned
--   SELECT COUNT(*) FROM strategies WHERE is_example=true AND status='published'
--   = 0
-- meaning the seed strategies in production were inserted before the seeder
-- started writing is_example=true consistently (or with the column missing).
-- The default Customize "Hide examples = ON" lock in Plan 13-02
-- (src/lib/discovery-prefs.ts:DEFAULTS.hide_examples=true) only filters rows
-- whose is_example=true — so without this backfill a fresh allocator's first
-- /discovery/[slug] visit would still show all 8 demo strategies.
--
-- Source of truth for the UUID list: scripts/seed-demo-data.ts:STRATEGY_UUIDS
-- (lines 44-53 — 8 elements `cccccccc-0001-4000-8000-000000000001` through
-- `..-000000000008`). All 8 are inserted with is_example=true by the seeder
-- at line 904; this migration is a defensive backfill, idempotent (set-to-true
-- twice is the same as once), no DDL.
--
-- Reference: 13-CONTEXT.md Audit Gate decision; 13-RESEARCH.md Don't Hand-Roll.

UPDATE public.strategies
SET is_example = true
WHERE id IN (
  'cccccccc-0001-4000-8000-000000000001',
  'cccccccc-0001-4000-8000-000000000002',
  'cccccccc-0001-4000-8000-000000000003',
  'cccccccc-0001-4000-8000-000000000004',
  'cccccccc-0001-4000-8000-000000000005',
  'cccccccc-0001-4000-8000-000000000006',
  'cccccccc-0001-4000-8000-000000000007',
  'cccccccc-0001-4000-8000-000000000008'
);

-- Post-update sanity probe — emit a NOTICE with the resulting count so
-- the supabase db push log carries observable evidence of effect.
DO $$
DECLARE
  flagged_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO flagged_count
  FROM public.strategies
  WHERE id IN (
    'cccccccc-0001-4000-8000-000000000001',
    'cccccccc-0001-4000-8000-000000000002',
    'cccccccc-0001-4000-8000-000000000003',
    'cccccccc-0001-4000-8000-000000000004',
    'cccccccc-0001-4000-8000-000000000005',
    'cccccccc-0001-4000-8000-000000000006',
    'cccccccc-0001-4000-8000-000000000007',
    'cccccccc-0001-4000-8000-000000000008'
  )
  AND is_example = true;

  RAISE NOTICE '[090_seed_is_example_backfill] flagged % seed rows with is_example=true (expected 8 if all seeds present in this DB; lower in fresh test DBs where some seeds may not exist)', flagged_count;
END $$;
```

After writing, do NOT push yet — Task 2 handles the push under the `autonomous: false` checkpoint pattern.
  </action>
  <verify>
    <automated>test -f supabase/migrations/090_seed_is_example_backfill.sql && grep -c "cccccccc-0001-4000-8000-00000000000" supabase/migrations/090_seed_is_example_backfill.sql</automated>
  </verify>
  <acceptance_criteria>
    - File `supabase/migrations/090_seed_is_example_backfill.sql` exists
    - Filename uses the next-free number — `ls supabase/migrations/ | grep -c "^090_"` == 1 (only the new file at 090)
    - `grep -c "UPDATE.*strategies\\|UPDATE public.strategies" supabase/migrations/090_seed_is_example_backfill.sql` >= 1
    - `grep -c "SET is_example = true" supabase/migrations/090_seed_is_example_backfill.sql` >= 1
    - `grep -c "cccccccc-0001-4000-8000-00000000000" supabase/migrations/090_seed_is_example_backfill.sql` == 16 (8 UUIDs × 2 occurrences — once in UPDATE, once in DO probe)
    - Inverted: `! grep -E "ALTER TABLE|CREATE TABLE|DROP TABLE|ALTER COLUMN|ADD COLUMN" supabase/migrations/090_seed_is_example_backfill.sql` (data-only — no DDL)
    - Inverted: `! grep "ON CONFLICT" supabase/migrations/090_seed_is_example_backfill.sql` (UPDATE not UPSERT — rows already exist by definition)
    - `grep -c "DO \\$\\$" supabase/migrations/090_seed_is_example_backfill.sql` >= 1 (post-update probe)
    - `grep -c "RAISE NOTICE" supabase/migrations/090_seed_is_example_backfill.sql` >= 1
  </acceptance_criteria>
  <done>Migration file authored at the correct path with the correct number; data-only DML; 8 UUIDs hard-coded; post-update RAISE NOTICE probe present.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: [BLOCKING] supabase db push — apply migration 090 to remote</name>
  <files>supabase/migrations/090_seed_is_example_backfill.sql (read-only — applied to remote DB; no source edits in this task), .planning/phases/13-discovery-v2-polish/TODOS.md (append "DISCO-05 backfill" section)</files>
  <read_first>
    - supabase/migrations/090_seed_is_example_backfill.sql (the migration to push)
    - .planning/phases/13-discovery-v2-polish/TODOS.md (Migration numbering section — confirms 090 is next free for Phase 13; 089 is 089_claim_failed_retry from PR #82)
    - .planning/phases/12-backend-metric-contracts/TODOS.md (existing supabase db push pattern with SUPABASE_ACCESS_TOKEN env)
    - 13-CONTEXT.md "Audit Gate, Seed Backfill" section
  </read_first>
  <action>
    Run the supabase db push + post-push audit query documented in <how-to-verify> below. Record the audit count integer (0..8) in TODOS.md under a new "## DISCO-05 backfill (Plan 13-05)" section. This is a checkpoint:human-action because supabase CLI may emit interactive confirmation prompts and the audit query must be run against the remote DB and the integer recorded by the operator. Tasks 1 and 3 are autonomous; Task 2 is the blocking gate.
  </action>
  <verify>
    <automated>echo "BLOCKING checkpoint — operator must run 'supabase db push' and record audit_count in TODOS.md. Resume only after operator types 'applied — count=N'."</automated>
  </verify>
  <done>Operator typed "applied — count=N" (N is an integer 0..8) AND TODOS.md contains a new "## DISCO-05 backfill" section with the audit count recorded.</done>
  <what-built>
    Migration `supabase/migrations/090_seed_is_example_backfill.sql` is authored and committed. The remote Supabase project (`khslejtfbuezsmvmtsdn`) does NOT have this migration applied yet — it must be pushed before any verification or e2e test can prove DISCO-05's success criterion ("after data backfill, all 8 seed UUIDs have is_example=true").

    Per the orchestrator's `<schema_push_requirement>` block:
    > Plans must include a `[BLOCKING]` task that runs `supabase db push` AFTER the migration file is created and BEFORE verification. Acceptance criterion: query returns `audit_count=8` for `SELECT COUNT(*) FROM strategies WHERE id IN (<seed_uuids>) AND is_example=true`.

    The push is `autonomous: false` because:
    1. `supabase db push` may emit interactive confirmation prompts ("Do you want to apply 1 new migration?")
    2. Service-role credentials may need to be confirmed against the remote project ref
    3. The post-push audit query needs to be executed against the remote and recorded
  </what-built>
  <how-to-verify>
**Pre-flight:**
1. Verify you are in the project root: `pwd` ⇒ `/Users/helios-mammut/claude-projects/quantalyze`
2. Verify the migration file exists: `ls supabase/migrations/090_seed_is_example_backfill.sql`
3. Verify the supabase CLI is installed: `supabase --version`
4. Verify the project link points at the remote project: `cat supabase/.temp/project-ref 2>/dev/null` ⇒ should be `khslejtfbuezsmvmtsdn` (or use `supabase link --project-ref khslejtfbuezsmvmtsdn` if not linked)
5. Verify `SUPABASE_ACCESS_TOKEN` is set if running in non-TTY mode: `echo "${SUPABASE_ACCESS_TOKEN:+set}"` ⇒ `set`. If not set, run `export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "supabase-access-token" -w)` (or per project conventions).

**Push step:**
```bash
supabase db push --include-all
```

If interactive prompt asks "Do you want to apply 1 new migration?" — answer **yes** (Y / Enter).

If the push reports "no new migrations to apply", the migration is already shipped (idempotent set-to-true is fine). Proceed to verification.

**Verification (post-push):**
Run the audit query against the remote DB. Multiple options — pick the one that works in this environment:

**Option A — Supabase MCP execute_sql** (preferred, if available in this session):
```
mcp__supabase__execute_sql with query:
  SELECT COUNT(*) AS audit_count
  FROM strategies
  WHERE id IN (
    'cccccccc-0001-4000-8000-000000000001',
    'cccccccc-0001-4000-8000-000000000002',
    'cccccccc-0001-4000-8000-000000000003',
    'cccccccc-0001-4000-8000-000000000004',
    'cccccccc-0001-4000-8000-000000000005',
    'cccccccc-0001-4000-8000-000000000006',
    'cccccccc-0001-4000-8000-000000000007',
    'cccccccc-0001-4000-8000-000000000008'
  )
  AND is_example = true;
```

**Option B — supabase db remote query** (CLI fallback per Phase 12 TODOS.md pattern):
```bash
supabase db remote query "$(cat <<'EOF'
SELECT COUNT(*) AS audit_count
FROM strategies
WHERE id IN (
  'cccccccc-0001-4000-8000-000000000001',
  'cccccccc-0001-4000-8000-000000000002',
  'cccccccc-0001-4000-8000-000000000003',
  'cccccccc-0001-4000-8000-000000000004',
  'cccccccc-0001-4000-8000-000000000005',
  'cccccccc-0001-4000-8000-000000000006',
  'cccccccc-0001-4000-8000-000000000007',
  'cccccccc-0001-4000-8000-000000000008'
)
AND is_example = true;
EOF
)"
```

**Option C — psql against DATABASE_URL/SUPABASE_DB_URL:**
```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS audit_count FROM strategies WHERE id IN ('cccccccc-0001-4000-8000-000000000001','cccccccc-0001-4000-8000-000000000002','cccccccc-0001-4000-8000-000000000003','cccccccc-0001-4000-8000-000000000004','cccccccc-0001-4000-8000-000000000005','cccccccc-0001-4000-8000-000000000006','cccccccc-0001-4000-8000-000000000007','cccccccc-0001-4000-8000-000000000008') AND is_example=true;"
```

**Pass criterion:** `audit_count = 8` (all 8 canonical seed UUIDs present in production AND flagged is_example=true).

**Acceptable degraded outcome:** `audit_count` between `1` and `8` if production was only ever seeded with a subset (e.g., earlier seeders shipped 6, the latest seeder ships 8). Document the exact integer in the SUMMARY. The DISCO-05 success criterion is satisfied as long as the rows that DO exist have `is_example=true`.

**Failure outcome:** `audit_count = 0`. Either:
- The migration didn't apply (re-run `supabase db push`)
- The seed UUIDs do not exist in production at all (check via `SELECT COUNT(*) FROM strategies WHERE id IN (...)` without the is_example filter — if 0, escalate: there are NO seed rows in production, so DISCO-05 has nothing to backfill, and the e2e Task 3 spec needs the seeder to run first).

**Record in TODOS.md:** Append a new section:
```markdown
## DISCO-05 backfill (Plan 13-05) — applied 2026-04-XX

- Migration: 090_seed_is_example_backfill.sql
- Push outcome: <success | already-applied | error>
- Audit count post-push: <integer 0..8>
- Notes: <any caveats — e.g., subset seeded, RLS visible to service role only>
```
  </how-to-verify>
  <resume-signal>Type "applied — count=N" where N is the integer from the audit query, or describe the error.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Author and run e2e/discovery-hide-examples-default.spec.ts (fresh-allocator E2E)</name>
  <files>e2e/discovery-hide-examples-default.spec.ts</files>
  <read_first>
    - e2e/full-flow.spec.ts (login fixture template)
    - e2e/helpers/seed-test-project.ts (programmatic test-user creation via admin.createUser — for cases where matratzentester24 has prior session prefs)
    - src/lib/discovery-prefs.ts (DEFAULTS.hide_examples=true contract from Plan 13-02)
    - 13-CONTEXT.md DISCO-05 success criterion 5 ("a fresh allocator's first Discovery visit shows zero example strategies")
    - scripts/seed-demo-data.ts:STRATEGY_UUIDS (the canonical 8 UUIDs)
  </read_first>
  <behavior>
    Playwright spec that:
    1. Creates a brand-new test user with NO prior localStorage entries on this domain (or clears localStorage explicitly before the first navigation)
    2. Logs in as that user
    3. Navigates to `/discovery/crypto-sma`
    4. Asserts ZERO strategy rows are visible (because all 8 seeded strategies have is_example=true after Task 2's push, and DEFAULTS.hide_examples=true is the locked default)
    5. Toggles the "Hide examples" checkbox OFF (either inline checkbox or via Customize drawer)
    6. Asserts >= 1 strategy row appears (proves the toggle actually controls visibility)
    7. Cleans up via the existing teardown helper
  </behavior>
  <action>
Create `e2e/discovery-hide-examples-default.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { seedAllocator } from "./helpers/seed-test-project";
import { cleanupTestAllocator } from "./helpers/cleanup-test-project";

const SEED_UUIDS = [
  "cccccccc-0001-4000-8000-000000000001",
  "cccccccc-0001-4000-8000-000000000002",
  "cccccccc-0001-4000-8000-000000000003",
  "cccccccc-0001-4000-8000-000000000004",
  "cccccccc-0001-4000-8000-000000000005",
  "cccccccc-0001-4000-8000-000000000006",
  "cccccccc-0001-4000-8000-000000000007",
  "cccccccc-0001-4000-8000-000000000008",
];

test.describe("DISCO-05 fresh allocator hides examples by default", () => {
  // Skip the spec if seed-helper env vars are not wired (CI-friendly fallback)
  test.skip(
    !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    "Test allocator seeder env vars not set — see e2e/helpers/seed-test-project.ts; spec authored but skipped pending env wiring",
  );

  let userId: string;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    const seed = await seedAllocator();
    userId = seed.userId;
    email = seed.email;
    password = seed.password;
  });

  test.afterAll(async () => {
    if (userId) await cleanupTestAllocator(userId);
  });

  test("first /discovery/[slug] visit shows zero example strategies", async ({ page, context }) => {
    // Belt-and-braces: ensure no prior localStorage entries from another spec
    await context.clearCookies();

    await page.goto("/login");
    await page.fill('input[name="email"], input[placeholder*="email" i]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 15000 });

    // Explicitly clear localStorage for the dashboard origin to ensure DEFAULTS apply
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("discovery_view_preferences:"))
        .forEach((k) => localStorage.removeItem(k));
    });

    await page.goto("/discovery/crypto-sma");
    await page.waitForLoadState("networkidle");

    // Either the empty-state row OR zero rows under the table body — both are acceptable
    // proofs of "no example strategies visible".
    const rowCount = await page.locator("table tbody tr").count();

    // Allow for a 1-row "no strategies match your filters" empty-state row
    if (rowCount > 0) {
      // Read each row's text and assert NONE matches a seed-strategy name
      const rowsText = await page.locator("table tbody tr").allTextContents();
      const hasNoStrategies = rowsText.some((t) => /no strategies/i.test(t));
      if (!hasNoStrategies) {
        // We have rows but none should be one of the 8 seed example strategies.
        // Seed names per scripts/seed-demo-data.ts: Stellar Neutral Alpha, Nebula Momentum,
        // Aurora Basis Trade, Vega Volatility Harvester, Helios L/S Stat Arb,
        // Orion Grid Bot, Pulsar Trend Follow, Quasar Mean Reversion.
        const seedNamesRegex = /Stellar Neutral|Nebula Momentum|Aurora Basis|Vega Volatility|Helios L\/S|Orion Grid|Pulsar Trend|Quasar Mean Reversion/;
        for (const text of rowsText) {
          expect(text).not.toMatch(seedNamesRegex);
        }
      }
    }

    // Toggle Hide examples OFF — find the inline checkbox in StrategyFilters
    // (per UI-SPEC: filter row carries a "Hide examples" checkbox)
    const hideExamplesToggle = page.locator('label:has-text("Hide examples"), input[type="checkbox"][aria-label*="example" i]').first();
    if (await hideExamplesToggle.count()) {
      await hideExamplesToggle.click();
      // After uncheck, expect strategies to appear
      await page.waitForTimeout(300);
      const newRowCount = await page.locator("table tbody tr").count();
      expect(newRowCount).toBeGreaterThan(0);
    }
  });
});
```

After authoring, attempt to run the spec:

```bash
npm run test:e2e -- --grep "fresh allocator hides examples"
```

If the seeder env vars are not wired, the spec will skip per `test.skip(...)` and the build remains green. Document the outcome in the SUMMARY:
- `seeder_env_set: <true|false>`
- `spec_status: <ran-green | ran-failed | skipped>`
- `audit_count_observed: <int from Task 2>`

If the spec runs and fails, root-cause:
- Failure mode A: rows visible despite is_example=true → check that `showExamples` state in StrategyTable.tsx properly inverts the prefs.hide_examples value (Plan 13-02 contract: `setShowExamples(!prefs.hide_examples)`)
- Failure mode B: zero rows but the empty-state copy is wrong → not a regression, document copy mismatch
- Failure mode C: the seed UUIDs aren't in production at all → escalate; the Task 2 audit will have shown count=0
  </action>
  <verify>
    <automated>npx playwright test --list -g "fresh allocator hides examples"</automated>
  </verify>
  <acceptance_criteria>
    - File `e2e/discovery-hide-examples-default.spec.ts` exists in `e2e/` directory (NOT `tests/e2e/`)
    - `grep -c "test.skip" e2e/discovery-hide-examples-default.spec.ts` >= 1 (env-skip safeguard)
    - `grep -c "Stellar Neutral\\|Nebula Momentum\\|Aurora Basis\\|Vega Volatility" e2e/discovery-hide-examples-default.spec.ts` >= 1 (seed-name regex)
    - `grep -c "discovery_view_preferences:" e2e/discovery-hide-examples-default.spec.ts` >= 1 (clears prior prefs to ensure DEFAULTS apply)
    - `grep -c "seedAllocator\\|cleanupTestAllocator" e2e/discovery-hide-examples-default.spec.ts` >= 2 (uses existing test-helper infra)
    - `npx playwright test --list -g "fresh allocator hides examples"` lists exactly 1 test
    - When seeder env vars are set: the spec runs and exits 0
    - When seeder env vars are NOT set: the spec is reported as `skipped` (NOT `failed`) — `npm run test:e2e -- --grep "fresh allocator" 2>&1 | grep -E "skipped|0 failed"` matches
    - `npm test && npm run build` exits 0 (no unit-test or build regression from the spec authoring)
  </acceptance_criteria>
  <done>e2e spec authored with proper env-skip safeguard; runs GREEN when env wired; lists in playwright catalog; no build/unit regressions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| supabase db push → remote Postgres | Service-role / admin credentials cross this boundary. Standard supabase CLI auth flow with `SUPABASE_ACCESS_TOKEN`. |
| Migration content → production data | The UPDATE statement runs unguarded against production rows; bug in WHERE clause could mass-flag non-seed strategies as is_example. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-13-05-01 | Tampering (mass-flag of non-seed strategies as is_example) | Migration 090 UPDATE statement | mitigate | The WHERE clause uses `id IN (<8 hard-coded UUIDs>)` — no wildcards, no joins, no subqueries. The literal UUID list is verifiable against `scripts/seed-demo-data.ts:STRATEGY_UUIDS` via grep. The post-update DO block emits a NOTICE with the row count for observability. |
| T-13-05-02 | Information Disclosure (`is_example=true` flagging leaks something) | strategies.is_example column | accept | `is_example` is already a public column (declared in migration 001:64) read by the existing UI. The flag's only effect is filtering on /discovery/[slug] — it carries no PII or commercial sensitivity. |
| T-13-05-03 | Denial of Service (UPDATE locks production tables) | Migration 090 UPDATE | accept | The UPDATE touches at most 8 rows (PK lookup); standard PostgreSQL row-level locks are released within milliseconds. No table scan, no FK cascades. |
| T-13-05-04 | Repudiation (push runs without audit trail) | supabase db push | accept | Supabase CLI logs to the project's migration history table (`schema_migrations`); the migration file itself is committed to git. The post-update RAISE NOTICE provides log evidence. |
</threat_model>

<verification>
**Task 1:** Migration file authored with 8 UUIDs, idempotent UPDATE, post-update probe.

**Task 2 [BLOCKING checkpoint]:** `supabase db push` applied; audit query returns `audit_count` between 0 and 8 (8 ideal, 1+ acceptable). Result recorded in TODOS.md.

**Task 3:** Playwright spec authored; runs GREEN when seeder env vars are set; lists in catalog regardless.

**Goal-backward grep checks:**
- `grep -c "is_example = true" supabase/migrations/090_seed_is_example_backfill.sql` >= 1
- `grep -c "cccccccc-0001-4000-8000-00000000000" supabase/migrations/090_seed_is_example_backfill.sql` == 16 (8 UUIDs × 2 occurrences)
- `grep -c "test.skip" e2e/discovery-hide-examples-default.spec.ts` >= 1

**Negative checks:**
- `! grep -E "ALTER TABLE|CREATE TABLE|DROP TABLE" supabase/migrations/090_seed_is_example_backfill.sql` (data-only)
- `! grep "tests/e2e/" e2e/discovery-hide-examples-default.spec.ts` (correct dir)

**Cross-plan invariant (depends_on Plan 13-02):**
- `grep -c "hide_examples: true" src/lib/discovery-prefs.ts` >= 1 (Plan 13-02 default lock — must be present for DISCO-05 success criterion 5 to mechanically work)
</verification>

<success_criteria>
1. **DISCO-05 acceptance criterion 5 (REQUIREMENTS.md line 21 + ROADMAP.md SC#5):** Seed-fixture strategies have `is_example=true` after data-only UPDATE migration; default Customize "Hide examples = ON"; a fresh allocator's first Discovery visit shows zero example strategies. Verified by Task 2 audit query + Task 3 e2e spec.
2. **CONTEXT.md DISCO-05 locked decisions:**
   - Hard-coded UUID list (no `created_by` query, no `name ILIKE` fallback)
   - Data-only DML migration (no DDL)
   - Idempotent
3. **Migration numbering:** 090 is the next-free number (089 is `089_claim_failed_retry.sql` from PR #82 — the highest existing per TODOS.md and `ls supabase/migrations/`).
4. **No regression:** `npm test && npm run build` exits 0.
5. **Schema push verified:** Task 2 audit query confirms `is_example=true` on the seed UUIDs in the remote DB.
6. **Cross-plan dependency:** Plan 13-02's `DEFAULTS.hide_examples=true` is the necessary other half — without it, the e2e spec in Task 3 cannot pass.
</success_criteria>

<output>
After completion, create `.planning/phases/13-discovery-v2-polish/13-05-SUMMARY.md` summarizing:
- Migration 090 file authored (cite line count + UUID grep count)
- supabase db push outcome (Task 2): success | already-applied | error
- Audit query result (`audit_count` integer 0..8)
- TODOS.md updated with the new "DISCO-05 backfill" section
- e2e spec status: ran-green | skipped | failed (with reason)
- UUID-count discrepancy resolution (orchestrator's prompt said 6 values; codebase has 8 — documented as Rule 1 deviation)
- Any deviations + Rule 1/2/3 categorization
- Phase 13 closure notes — DISCO-03 deferred per audit-count=0 (TODOS.md), DISCO-01/02/04/05 all shipped
</output>

