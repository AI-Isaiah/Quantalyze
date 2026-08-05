# Phase 149: NAV — "My strategies": a ranking at discovery parity - Pattern Map

**Mapped:** 2026-08-05
**Files analyzed:** 16 (7 new · 9 modified)
**Analogs found:** 14 / 16 exact-or-role-match · 2 partial (Delta-5 placeholder rows)

> **Read this before planning.** Every "new thing" in this phase is a PROP, a MAP ENTRY,
> or a CLONE of an existing gate. If a plan task creates a component that renders rows,
> columns, ranks, or percentiles, it has violated SC-3 before it compiles
> (149-RESEARCH §Don't Hand-Roll). The excerpts below are the code to copy from — file
> and line, not description.

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `src/app/(dashboard)/my-strategies/page.tsx` | NEW | route (RSC page) | request-response | `src/app/(dashboard)/discovery/[slug]/page.tsx` (render) + `src/app/(dashboard)/recommendations/page.tsx:33-47` (auth+role+noStore) | exact |
| `src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx` | NEW | component (client) | event-driven | `src/app/(dashboard)/allocations/AllocationsTabs.tsx:1014-1018` | exact |
| `src/lib/queries.ts` → `getMyStrategies(userId)` | MOD | service (server query) | CRUD-read | `getStrategiesByCategory` `queries.ts:204-255` | exact |
| `src/lib/queries.ts` → strategy-less active keys | MOD | service (server query) | CRUD-read | `getUserApiKeys` `queries.ts:2044-2103` | role-match (see §No Analog) |
| `src/components/strategy/StrategyTable.tsx` → `visibility` prop | MOD | component (client) | transform (in-memory filter) | its own `percentiles?:` / `userId?:` optional-prop idiom, `StrategyTable.tsx:110-137,174-183` | exact |
| `src/components/strategy/StrategyTable.tsx` → `rowLinkMode` prop | MOD | component (client) | request-response (href) | `basePath = "/discovery"` default, `StrategyTable.tsx:113,178` | exact |
| `src/components/strategy/StrategyTable.tsx` → status marker | MOD | component (client) | presentation | `StrategyGrid.tsx:84-88` "Example" chip slot + `Badge` `StrategyTable.tsx:743-745` | exact |
| `src/components/strategy/StrategyTable.tsx` → pending chip | MOD | component (client) | presentation | `CoverageStateChip.tsx` (147 chip family, whole file) | exact |
| `src/components/strategy/StrategyTable.tsx` → placeholder rows (Delta 5) | MOD | component (client) | presentation | `StrategyTable.tsx:839-845` (the only non-strategy `<tr>`) | partial |
| `src/components/strategy/StrategyGrid.tsx` | MOD | component (client) | request-response (href) | its own `basePath = "/discovery"` default, `StrategyGrid.tsx:21,35,52-53` | exact |
| `src/components/ui/Badge.tsx` | MOD | component (presentational) | presentation | its own `archived` entry, `Badge.tsx:17,29` | exact |
| `src/components/layout/Sidebar.tsx` | MOD | config (nav construction) | presentation | `Sidebar.tsx:124-128` (`Recommendations`/`Compare`/`Decks` push) | exact |
| `src/lib/routing/route-contract-manifest.ts` | MOD | config (data-only) | — | any `class: "private"` entry in the same file | exact |
| `src/__tests__/phase-149-my-strategies-parity.test.ts` | NEW | test (source-scan gate) | batch | `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | exact (clone) |
| `src/app/(dashboard)/requireRolePage-wiring.test.tsx` | MOD | test (wiring pin) | — | its own `SURFACES` array, `:80-110` | exact |
| `src/components/layout/Sidebar.test.tsx` | MOD | test (component) | — | its own allocator block, `:41-95` | exact |
| `src/components/strategy/StrategyGrid.test.tsx` | MOD | test (component) | — | its own fixture factory, `:20-50` | exact |
| `src/components/strategy/StrategyTable.visibility.test.tsx` | NEW | test (component) | — | `StrategyTable.test.tsx:72-102` (`makeStrategy` factory) | exact |
| `src/components/strategy/StrategyTable.pending-chip.test.tsx` | NEW | test (component) | — | same factory + `CoverageStateChip.test.tsx:45-56` (class assertions) | exact |
| `src/app/(dashboard)/my-strategies/page.test.tsx` | NEW | test (RSC unit) | — | `requireRolePage-wiring.test.tsx:25-69` (chain-recording supabase double) | role-match |
| `src/components/ui/Badge.test.tsx` | NEW | test (component) | — | none — **file does not exist** [VERIFIED: `ls`] | see §No Analog |

---

## Pattern Assignments

### 1. `src/app/(dashboard)/my-strategies/page.tsx` (route, request-response)

**Primary analog:** `src/app/(dashboard)/discovery/[slug]/page.tsx` — read in full.
**Secondary analog (auth + role gate order):** `src/app/(dashboard)/recommendations/page.tsx:33-47`.

**Imports pattern** — `discovery/[slug]/page.tsx:1-13`:
```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import {
  getRealPortfolio,
  getStrategiesByCategory,
  getPercentiles,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
```
Path alias is `@/`; server client comes from `@/lib/supabase/server`; **no `Breadcrumb`,
no `InfoBanner`** on this surface (UI-SPEC Delta 2: top-level workspace page).

**Auth + role-gate pattern** — `recommendations/page.tsx:33-47` (COPY THIS ORDER):
```tsx
export default async function RecommendationsPage() {
  // C-0016: per-user recommendations — must not be cached across users. The
  // explicit noStore() call ensures that any future `'use cache'` directive
  // introduced anywhere in this subtree fails loudly instead of silently
  // leaking one allocator's matches to another.
  noStore();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/recommendations");
  // Phase 109 ROLE-04 — allocator-owned surface. OUTSIDE the attestation
  // try/catch below: the wrong-role redirect() throws NEXT_REDIRECT.
  await requireRolePage(supabase, user, "allocator");
```
Imports for that block, `recommendations/page.tsx:2-5`:
```tsx
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";
```
`noStore()` is **recommended** by RESEARCH §Security (owner-rendered HTML must not be
cached across users) — copy the C-0016 comment shape and re-target it.

**Parallel-fetch + shell pattern** — `discovery/[slug]/page.tsx:38-53,60,81-89`:
```tsx
  const [strategies, portfolio, watchedSet, percentiles] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
    getMyWatchlist(user.id),
    getPercentiles(slug),
  ]);
  ...
    <div className="mx-auto max-w-[1920px]">
      <PageHeader title={meta.name} />
      ...
      <StrategyTable
        key={`${user.id}:${slug}`}
        strategies={strategies}
        categorySlug={slug}
        portfolioId={portfolio?.id ?? null}
        userId={user.id}
        initialWatchedSet={initialWatchedSet}
        percentiles={percentiles ?? undefined}
      />
    </div>
```
Deltas the planner applies to this shape (all from RESEARCH §Code Examples / UI-SPEC):
- `getPercentiles()` with **NO argument** (global published universe, Pattern 4).
- **OMIT** `getMyWatchlist` / `userId` / `initialWatchedSet` → the `/browse` variant of the
  table (no star column, no watchlist tabs — `StrategyTable.tsx:465,517-527`).
- `categorySlug="my-strategies"` — a prefs-scope key, **not** a real category (Pitfall 6).
- `visibility="owner-all-statuses"` + `rowLinkMode="factsheet"` (the two new props).
- The `key={...}` remount guard at `:82` exists only because `/discovery/[slug]` is a
  dynamic segment; this route is static — **do not copy the `key` prop** (and do not copy
  the M-0475/M-0476 comment with it).

**Also copy** the `mx-auto max-w-[1920px]` fluid-fill comment at `discovery/[slug]/page.tsx:49-52`
(re-targeted): it explains WHY the cap lives on the page shell rather than the layout.

---

### 2. `src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx` (component, event-driven)

**Analog:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:1010-1018` — the
local-`useState` overlay mount. This is the ONLY way the CTA can reach the wizard
(Pitfall 9: `contributeOpen` is local state inside `DashboardChrome`, unreachable from
`{children}`).

**Mount pattern** — `AllocationsTabs.tsx:1010-1018`:
```tsx
      {/* Phase 116 / ADDALLOC-02 — tab-agnostic host for the "+ Allocation"
          onboarding wizard. Rendered unconditionally (null while closed) so the
          header button can open it on Holdings / Overview where ScenarioComposer
          is not mounted. Focus returns to the header trigger on close/success. */}
      <ContributionWizardOverlay
        isOpen={contributeOpen}
        onClose={handleContributeClose}
        onSuccess={handleContributeSuccess}
      />
```

**Contract to code against** — `ContributionWizardOverlay.tsx:33-44`:
```tsx
export interface ContributionWizardOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** Receives the finalized (private) strategy id when the wizard completes. */
  onSuccess?: (strategyId: string) => void;
}
```
It renders `null` while closed (`:80`), owns its own Esc handler and focus-into-panel
(`:56-78`), and portals to `document.body` (`:83`). **There is no `preselectedKeyId` prop**
— see §No Analog for the Delta-5 "Finish setup →" link.

**Why a `Link` is forbidden** — `Sidebar.tsx:129-136` (quote this in the plan):
```
    // Phase 110 CONTRIB-01 (ROLE-02 scoped exception) — the allocator brings a
    // strategy to track/compose. A CLIENT ACTION (opens the
    // ContributionWizardOverlay hosted at the DashboardChrome level), NOT an
    // href: the wizard route sits under the Phase-109 manager-guarded
    // /strategies subtree, so a Link would redirect-bounce the allocator.
```

---

### 3. `src/lib/queries.ts` — `getMyStrategies(userId)` (service, CRUD-read)

**Analog:** `getStrategiesByCategory` — `queries.ts:204-255`. Copy the row-shaper VERBATIM;
change only the predicate and the select.

**The row-shaper to extract and share** — `queries.ts:243-254`:
```ts
  const signals = await readPublicVerificationSignals(
    strategies.map((s) => (s as unknown as Strategy).id),
  );

  return strategies.map((s) => {
    const strat = s as unknown as Strategy;
    return {
      ...strat,
      trust_tier: (signals.get(strat.id)?.trust_tier ?? null) as Strategy["trust_tier"],
      analytics: extractAnalytics(s.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: s.id },
    };
  });
```
The `?? { ...EMPTY_ANALYTICS, strategy_id: s.id }` fallback at `:252` is what makes an
analytics-less row render em-dashes instead of crashing — **it is load-bearing for Delta 4.**

**The predicate to REPLACE** — `queries.ts:221-226` (this stays untouched in the published
fetcher; the own fetcher does NOT use it):
```ts
  const { data: strategies, error } = await withPublishedOnly(
    supabase
      .from("strategies")
      .select(`*, discovery_categories!inner(slug), strategy_analytics (*)`)
      .eq("discovery_categories.slug", categorySlug),
  );
```
Own query: `.select("*, strategy_analytics (*)")` + `.eq("user_id", userId)` and **NO
`discovery_categories!inner`** (Pitfall 4 — `strategies.category_id` is nullable, PostgREST
drops the row on an `!inner` miss).

**Error-handling pattern — two variants in this file, pick the FAIL-SOFT one.**
Fail-soft (`getStrategiesByCategory`, `queries.ts:228-231`) — matches RESEARCH §Security V7:
```ts
  if (error) {
    console.error("Strategy query failed:", error.message);
    return [];
  }
```
With Sentry (`getPercentiles`, `queries.ts:142-146`) — the richer idiom, preferred for a new
fetcher:
```ts
  if (error) {
    console.error("[queries.getPercentiles] supabase error:", error.message ?? error);
    captureToSentry(error, { tags: { op: "getPercentiles" }, level: "error" });
    return null;
  }
```
Fail-LOUD (`getUserApiKeys`, `queries.ts:2059-2067`) throws instead — that choice is
documented there as deliberate for a money-display path. **Do not blend**: pick fail-soft +
`captureToSentry` for `getMyStrategies` (an honest empty state, never a fabricated row), and
state the reason in a comment (Rule 7).

**Why `withPublishedOrOwner` is NOT used here** — `visibility.ts:115-125`, the code that
makes the deviation provable:
```ts
export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}
```
`published OR own` → the entire published universe on a page titled "My Strategies".
The lint rule `quantalyze/no-owner-or-on-admin-client` bans that raw `.or(...)` shape outside
`visibility.ts`; `.eq("user_id", …)` is untouched by it. And
`no-raw-published-predicate.mjs:52-60` matches ONLY `.eq("status","published")` two-arg
call expressions — so `.eq("user_id", …)` is lint-clean by construction:
```js
      "CallExpression[callee.property.name='eq']"(node) {
        const args = node.arguments;
        if (
          args.length === 2 &&
          isStringLiteral(args[0], "status") &&
          isStringLiteral(args[1], "published")
        ) {
          context.report({ node, messageId: "raw" });
        }
      },
```

---

### 4. `src/components/strategy/StrategyTable.tsx` — `visibility` prop (component, transform)

**Analog for the prop shape:** the file's own optional-prop idiom, `StrategyTable.tsx:129-137`:
```tsx
  /**
   * Category-scoped percentile ranks from getPercentiles() in lib/queries.ts,
   * keyed by strategy id then metric. When provided, the ACTIVE sort column
   * appends a quiet `Pnn` suffix (e.g. `P82`) per row. Undefined — or a missing
   * entry, or a peer set too small to rank (getPercentiles returns null under 5
   * strategies) — renders no suffix at all (honest absence, no fabricated rank).
   */
  percentiles?: PercentileMap;
```
Every prop in this interface carries a WHY-comment naming its non-default consumer. Match it.

**Analog for the literal default:** `StrategyTable.tsx:174-183` (the destructuring — this is
the exact line the gate pins):
```tsx
export function StrategyTable({
  strategies,
  categorySlug,
  basePath = "/discovery",
  portfolioId = null,
  userId,
  initialWatchedSet,
  percentiles,
}: StrategyTableProps) {
```

**The site to parameterize — `StrategyTable.tsx:330-331`** (Pitfall 1, the blocking defect):
```tsx
  const filtered = useMemo(() => {
    let result = strategies.filter((s) => s.status === "published");
```
It is the FIRST line of the `filtered` memo, ahead of watchlist scope (`:336`), examples
(`:340`), search (`:345`), advanced filters (`:351-412`) and the **in-place** sort at `:418`:
```tsx
    result.sort((a, b) => {
```
⚠️ Because `result` is sorted in place and `strategies` is in the memo's dep array
(`:428`), the `owner-all-statuses` arm must produce a COPY (`strategies.slice()`), never the
prop array.

---

### 5. `src/components/strategy/StrategyTable.tsx` + `StrategyGrid.tsx` — `rowLinkMode` (Pitfall 3)

**The asymmetry to close.** Table name cell — `StrategyTable.tsx:727-732` (already correct,
resolves via 148's owner lane):
```tsx
                            <Link
                              href={`/factsheet/${s.id}`}
                              className="font-medium text-text-primary hover:text-accent transition-colors"
                            >
                              {s.name}
                            </Link>
```
Grid card — `StrategyGrid.tsx:52-55` (the dead end):
```tsx
          <Link
            href={`${basePath}/${categorySlug}/${s.id}`}
            className="block group"
          >
```
`/discovery/{slug}/{id}` → `getStrategyDetail` → `withPublishedOnly` (`queries.ts:530`) →
`notFound()`.

**Analog for the fix:** `StrategyGrid`'s own defaulted-string-prop idiom,
`StrategyGrid.tsx:18-39`:
```tsx
interface StrategyGridProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
  basePath?: string;
  /**
   * When present (allocator on /discovery) each card renders a top-right
   * <StarToggle> wired to the parent's watchedSet + onToggleStar. Undefined
   * on /browse (public, unauth) — cards render unchanged.
   */
  userId?: string;
  ...
}

export function StrategyGrid({
  strategies,
  categorySlug,
  basePath = "/discovery",
  ...
}: StrategyGridProps) {
```

**Passthrough site** — `StrategyTable.tsx:865-874`:
```tsx
        ) : (
          <StrategyGrid
            strategies={paged}
            categorySlug={categorySlug}
            basePath={basePath}
            userId={userId}
            watchedSet={watchedSet}
            onToggleStar={onToggleStar}
          />
        )}
```

**⛔ THE OPTION SURFACE THE PLANNER MUST DECIDE (Pitfall 3, unresolved in CONTEXT).**
Grid view is reachable from the in-page view toggle on every surface. Two live options:

| Option | Cost | Consequence |
|---|---|---|
| **A — `rowLinkMode` prop (RESEARCH recommendation)** | ~3 lines in `StrategyTable` + ~3 in `StrategyGrid`; adds gate assertion 7; needs `StrategyGrid.test.tsx` extension (SC-5b) | Closes an inherited table/grid inconsistency for good. Public pages pass nothing → default `"category-detail"` → byte-identical. Preserves UI-SPEC's "view modes inherited unchanged" |
| **B — hide the grid toggle on this surface** | A conditional in `StrategyFilters`' `viewMode` control (`StrategyTable.tsx:513-514` `onViewModeChange={setViewMode}`) | **Requires a UI-SPEC amendment** — the spec's Inherited-anatomy table locks "view modes (table/grid)" as inherited. Also leaves the grid dead-end alive for any future owner-scoped consumer |

Recommendation carried forward from RESEARCH: **Option A.** Note that grid view degrades
honestly on own unpublished rows regardless (Pitfall 5): `StrategyGrid.tsx:78-83` gates
`VerifiedBadge trustTier={s.trust_tier}`, and `trust_tier` is null for unpublished rows by
construction — ACCEPT and document, do not "fix". The TABLE is unaffected because its
verified check gates on `s.api_key_id` (`StrategyTable.tsx:733`).

---

### 6. `src/components/ui/Badge.tsx` — `private` mapping (Delta 3)

**Analog:** the `archived` entry in the same two maps — `Badge.tsx:13-35`:
```tsx
const statusMap: Record<string, string> = {
  published: "bg-positive/10 text-positive",
  draft: "bg-badge-other/10 text-badge-other",
  pending_review: "bg-badge-market-neutral/10 text-badge-market-neutral",
  archived: "bg-badge-other/10 text-text-muted",
  // contact_request statuses
  pending: "bg-badge-market-neutral/10 text-badge-market-neutral",
  ...
};

const statusLabelMap: Record<string, string> = {
  published: "Published",
  draft: "Draft",
  pending_review: "Pending Review",
  archived: "Archived",
  ...
};
```
Add `private: "bg-badge-other/10 text-text-muted"` and `private: "Private"` — the exact
`archived` muted-ink pairing (UI-SPEC Delta 3). Note the file interleaves `strategies.status`
and `contact_requests.status` keys in ONE map with a comment divider; keep the divider.

**The live defect being fixed** — `Badge.tsx:43-49`:
```tsx
export function Badge({ label, type = "strategy", className = "" }: BadgeProps) {
  const styles =
    type === "status"
      ? statusMap[label] ?? statusMap.draft
      : colorMap[label] ?? colorMap.Other;

  const displayLabel = type === "status" ? (statusLabelMap[label] ?? label) : label;
```
Unmapped `private` → **draft styling + the raw lowercase string `private`**.

**Declared blast radius (Pitfall 8 — this is a scope DECLARATION, not creep):**
- `src/app/(dashboard)/strategies/page.tsx:177` — improves (a `private` row passes that
  page's `.or("source.neq.wizard,status.neq.draft")` filter at `:27`, so the defect is LIVE)
- `src/components/strategy/StrategyHeader.tsx:24` — improves
- `AdminTabs.tsx:274`, `RequestIntroButton.tsx:129`, `PendingIntros.tsx:170` — **unaffected**
  (they pass `contact_requests` statuses; `private` is not in that domain)

**Chip base to preserve** — `Badge.tsx:53`:
```tsx
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium", styles, className)}
```

**Placement in the row** — copy `StrategyGrid.tsx:84-88`'s "Example" chip idiom (the exact
slot UI-SPEC Delta 3 names) and the existing `Badge` render at `StrategyTable.tsx:743-745`:
```tsx
                              {s.strategy_types.map((t) => (
                                <Badge key={t} label={t} />
                              ))}
```

---

### 7. `src/components/strategy/StrategyTable.tsx` — the pending chip (Delta 4)

**Analog: `src/components/strategy/../allocations/components/CoverageStateChip.tsx` — the
147 chip family, read in full.** This is the state→label→token mapping UI-SPEC Delta 4
names "147 BASE VERBATIM". Copy the tokens, not a new component.

```tsx
const CHIP: Record<CoverageState, { label: string; cls: string }> = {
  "in-blend": { label: "In blend", cls: "text-accent bg-accent/10" },
  "manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" },
  "auto-excluded": {
    label: "Outside window",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
  syncing: {
    label: "Syncing",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
  "no-series": { label: "No data", cls: "text-text-muted bg-track" },
};

// Badge ladder base (Badge.tsx:53, tightened to the 58-UI-SPEC chip tier):
// 4px radius, px-2 py-0.5, 11px uppercase medium tracking.
const BASE =
  "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide";
```
`Syncing` and `No data` are already in this map with exactly the UI-SPEC's classes. Its
header comment (`:17-33`) also carries the "amber = transient-recoverable, muted = honest
steady-state absence, NEVER red" rationale — reuse that reasoning verbatim in the new code.

**State derivation analog** — `src/lib/closed-sets.ts:491-509` (`deriveEmptySeriesState`;
A1 in RESEARCH is hereby CLOSED — signature confirmed):
```ts
export function deriveEmptySeriesState(
  status: string | null,
  strategyCreatedAt: string | null,
  nowMs: number = Date.now(),
): SeriesState {
  // A live job is authoritative — age is the reaper's problem, not ours.
  if (status === "pending" || status === "computing") return "computing";
  if (status === null) {
    const created = strategyCreatedAt ? Date.parse(strategyCreatedAt) : NaN;
    if (!Number.isFinite(created)) return "empty"; // unknown age → honest absence
    return nowMs - created < MISSING_ROW_COMPUTING_WINDOW_MS
      ? "computing"
      : "empty";
  }
  return "empty";
}
```
Returns `"available" | "computing" | "empty"` (`SERIES_STATES`, `closed-sets.ts:455-456`).
⚠️ It is a **server-side** discriminator ("share it, do not inline this ladder at a second
read site", `:470`) and it needs `strategies.created_at` — which the own query's `select("*")`
already projects, and which the `StrategyTable.test.tsx` fixture carries
(`created_at: "2024-01-01T00:00:00Z"`, `:92`). Derive on the RSC page and pass down, or
call it in the client from `s.created_at` + `s.analytics.computation_status`; the planner
picks one and the gate should pin that there is exactly ONE derivation site.

**The empty slot the chip occupies** — `StrategyTable.tsx:741-748`:
```tsx
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex gap-1">
                              {s.strategy_types.map((t) => (
                                <Badge key={t} label={t} />
                              ))}
                            </div>
                            <SyncBadge computedAt={s.analytics.computed_at} exchange={s.supported_exchanges?.[0]} />
                          </div>
```
`SyncBadge` returns `null` when `computedAt` is null (`SyncBadge.tsx:28`) → no collision.

**Honest-absence formatters already in place** (nothing to build) — `StrategyTable.tsx:64-84`:
```tsx
function signColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-text-muted";
  return value >= 0 ? "text-positive" : "text-negative";
}
```
plus `magnitudeColor` `:73-77` and `drawdownColor` `:81-84`. A `—` cell is never tinted.
The percentile suffix is already absent for an unmapped row — `StrategyTable.tsx:473-478`:
```tsx
  const pctSuffix = (s: StrategyWithAnalytics, colKey: TableSortKey) => {
    if (!percentiles || tableSortKey !== colKey) return null;
    const metric = PERCENTILE_BY_SORT_KEY[colKey];
    if (!metric) return null;
    const p = percentiles[s.id]?.[metric];
    if (p == null || !Number.isFinite(p)) return null;
```
**Assert this, do not reimplement it** (UI-SPEC Delta 4, last bullet).

---

### 8. `src/components/layout/Sidebar.tsx` — the nav entry (Delta 1)

**Analog:** the Phase-51 push inside the same branch — `Sidebar.tsx:103-142`:
```tsx
  const workspaceItems: NavItem[] = [];
  if (showsAllocatorWorkspace) {
    workspaceItems.push({
      label: "My Allocation",
      href: "/allocations",
      icon: PortfolioIcon,
      badge: flaggedCount,
    });
    // Phase 51 NAV-01 — surface the genuine allocator orphans that had no nav
    // entry (direct-link only today): /compare, /decks, and /recommendations are
    // allocator-owned dashboard surfaces. They live INSIDE the
    // showsAllocatorWorkspace branch so they never leak to a manager (T-45-01 /
    // T-51-02 info-disclosure). ...
    workspaceItems.push(
      { label: "Recommendations", href: "/recommendations", icon: RecommendIcon },
      { label: "Compare", href: "/compare", icon: CompareIcon },
      { label: "Decks", href: "/decks", icon: DeckIcon },
    );
    ...
    workspaceItems.push({
      label: "Add a Strategy",
      icon: PlusIcon,
      action: "add-strategy",
    });
  }
```
- Item shape: `{ label, href, icon }` — an `href`, NOT an `action` (UI-SPEC Delta 1).
- Position: the new push goes **between** the Recommendations/Compare/Decks block and the
  `Add a Strategy` push (UI-SPEC: directly above "Add a Strategy"; that item stays last).
- Icon: `BarChartIcon`, already imported (used at `:159` and `:186`).
- Every push in this branch carries a comment naming the phase + the role-leak threat class.
  Match that (T-110-16).
- Section heading `"MY WORKSPACE"` at `:165` — untouched.
- ⛔ **Do NOT touch `buildPrimaryMobileNav`** (`Sidebar.tsx:298-301`, cap of 5 — Pitfall 7).
  `MobileSidebarDrawer.tsx:184` mounts the full `Sidebar`, so mobile is free.

---

### 9. `src/__tests__/phase-149-my-strategies-parity.test.ts` (test, source-scan gate)

**Analog: `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — CLONE THE
ARCHITECTURE.** This is a clone job, not a design job.

**Header shape** (`phase-148:6-144`): WHY THIS EXISTS → WHY A STRUCTURAL LAYER AT ALL (the
load-bearing argument, incl. the MEASURED behaviour/structural asymmetry) → WHAT IS PINNED
(numbered list matching the `it()`s) → Comment-hygiene note → **`Rule-9 NON-VACUITY` ledger**
recording each mutation's exact assertion output and the revert method:
```
 *   Both mutations were reverted by RE-EDITING the mutated lines (never a
 *   file-level `git checkout --`), and `git diff --quiet -- page.tsx` exits 0.
 *   The gate is 9/9 green on the fixed tree.
```

**Fail-loud reader** (`phase-148:151-163`) — a missing pinned source is a FAILURE, not a skip:
```ts
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `OWN-02 pinned source is missing: ${relPath}. A rename or move must ` +
        `carry this guard with it — a missing pinned source is a FAILURE, ` +
        `not a skip ...`,
    );
  }
  return readFileSync(abs, "utf8");
}
```

**Comment stripping** (`phase-148:173-179`) — load-bearing, because the guarded sources'
own prose will name the banned tokens:
```ts
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}
```

**Layer A repo walk** (`phase-148:182-196`) — catches a brand-new offender file an allowlist
structurally cannot:
```ts
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(abs, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(abs);
  }
  return acc;
}
```

**Extractors** to copy as-is: `countOccurrences` (`:286-295`), `declarationHead`
(`:260-265`), `functionBody` (`:272-283`), `bodyBraceIndex` (`:240-253`), `callArgs`
(`:202-214`), `firstArgument` (`:222-231`). Assertion 5 ("`getMyStrategies` body contains
`.eq("user_id"` and NEITHER `withPublishedOrOwner` NOR `discovery_categories!inner`") is
exactly `functionBody(src, "getMyStrategies")` + three `toContain`/`not.toContain`.

**Assertion voice** (`phase-148:307-315`) — every `it()` name states the PROPERTY, and the
body carries the "what this forbids is not hypothetical" note:
```ts
  it("the cached callback names withPublishedOnly as a LITERAL and never the owner-inclusive predicate", () => {
    const src = stripComments(readSource(PAGE));
    const callback = firstArgument(callArgs(src, "unstable_cache"));
    expect(callback).toContain("withPublishedOnly");
    // The failure this forbids is not hypothetical: the cache key is id-only,
    // so an owner-inclusive predicate here serves one owner's draft to every
    // later reader of that id, anonymous included, for the full TTL.
    expect(callback).not.toContain("withPublishedOrOwner");
  });
```

**Anti-vacuity** — the 147 form (`phase-147:207-227`) is the clearer template for a repo walk:
```ts
  it("the scan is non-vacuous: it DOES see the phase's own two-column selects (so an empty offender list means clean, not blind)", () => {
    ...
    expect(twoColumn.length).toBeGreaterThanOrEqual(4);
    expect(twoColumn).toContain("src/app/api/strategies/[id]/returns/route.ts");
```
Phase 149's equivalent: the stripped `StrategyTable.tsx` really does still contain
`owner-all-statuses`, and the repo walk really does find exactly ONE production file passing
`visibility="owner-all-statuses"`.

**Also available: `phase-32-frozen-spine-guards.test.ts:294-311`** — the *self-pin* idiom for
a regex-based assertion (prove the matcher matches what it should and rejects what it
shouldn't, before applying it to the source):
```ts
    // Non-vacuity self-pins.
    expect(LISTING_RE.test('href="/discovery/crypto-sma"')).toBe(true);
    expect(LISTING_RE.test('href="/portfolios"')).toBe(false);
```

The 8 literals to pin are enumerated in 149-RESEARCH §Pattern 3 — do not re-derive them.

---

### 10. `src/app/(dashboard)/requireRolePage-wiring.test.tsx` (test, MANDATORY EDIT)

**Analog: the file itself, `:71-110`** — add an 8th `SURFACES` entry with
`need: "allocator"`, in the **same commit** as the page file:
```tsx
type Surface = {
  label: string;
  need: "manager" | "allocator";
  invoke: () => Promise<unknown>;
};

const SURFACES: Surface[] = [
  {
    label: "strategies/layout",
    need: "manager",
    invoke: async () => {
      const mod = await import("./strategies/layout");
      return (mod.default as (p: { children: React.ReactNode }) => unknown)({
        children: null,
      });
    },
  },
```
Pages take no args: `invoke: async () => (await import("./my-strategies/page")).default()`.
The header comment says "the 7 surfaces" (`:6`) — **update that count to 8** or the prose
drifts.

**Bonus: this file is also the analog for `my-strategies/page.test.tsx`'s supabase double**
(`:37-69`) — the mock-that-throws-a-sentinel + `createClient` stub. RESEARCH's Wave-0 note
is the important delta: the page spec's double must be **chain-recording** (record
`.from().select().eq()` args), not an identity stub, or the `.eq("user_id", …)` assertion is
vacuous (148 Pitfall-5 lesson).

---

### 11. Component test files (NEW + EDIT)

**Fixture-factory analog** — `StrategyTable.test.tsx:72-102`:
```tsx
function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): StrategyWithAnalytics {
  return {
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    ...
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}
```
⚠️ `status: "published"` at `:89` is exactly why no existing test can see Pitfall 1. The new
`StrategyTable.visibility.test.tsx` must build rows with `status: "private"` / `"draft"` via
`overrides` and be **RED-first** against today's `:331`.

**Leaf stubs to copy** — `StrategyTable.test.tsx:104-121`:
```tsx
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));
```
and `installFetchMock()` in `beforeEach` (`:120-121`). Note the CI-flake comment at `:122-124`
about `discovery_view_preferences:u-1:crypto-sma` persistence — the new specs should use a
distinct `categorySlug` to avoid inheriting it.

**Class-assertion idiom for the chips** — `CoverageStateChip.test.tsx:45-56`:
```tsx
    expect(chip.className).toContain("bg-warning-bg");
```

**Sidebar role-matrix idiom** — `Sidebar.test.tsx:41-47,76-81`:
```tsx
describe("Sidebar workspace — allocator view", () => {
  it("renders 'My Allocation' as the first workspace entry", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
    const link = screen.getByText("My Allocation").closest("a");
    expect(link).toHaveAttribute("href", "/allocations");
  });
  ...
  it("does NOT render 'Strategies' in the allocator workspace", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByText("Strategies")).toBeNull();
  });
```
SC-1a needs BOTH shapes: the positive (`href` on an `<a>`, allocator) and the negative
(`queryByText(...)` is null for `isAllocator={false} isManager={true}` — see `:115` and
`:141-160` for the manager-view block). ⚠️ Pitfall 10 + the manager entry labelled
`"Strategies"` at `Sidebar.tsx:159`: a bare `getByText("My Strategies")` collides with
`(dashboard)/strategies/page.tsx:73`'s `<PageHeader title="My Strategies" />` for a
`role='both'` account. Scope every new selector by `href`/route/`data-testid`.

---

### 12. `src/lib/routing/route-contract-manifest.ts` (config, MANDATORY EDIT)

**Analog: the entry type + any `private` entry in the same file** — `:56-91`:
```ts
export type RouteEntry = {
  /** URL path (NOT file path) — e.g. "/legal/privacy", "/allocations". */
  route: string;
  /** The contracted class of this route. */
  class: RouteClass;
  redirectFrom?: string;
  notes: string;
};

export const ROUTE_CONTRACT_MANIFEST: readonly RouteEntry[] = [
```
Rules from the file header (`:18-26`) that bite here: **Rule 1** — a page route with no class
FAILS `npm run lint` (`scripts/check-route-contract.ts`, chained at `package.json:11`);
**Rule 4** — a non-`exception` entry with no real page file is STALE and also fails. Keep the
list **alphabetical by `route`** (`:79`). Add in the SAME commit as `page.tsx`.

---

## Shared Patterns

### A. Auth → role gate → parallel fetch (every guarded `(dashboard)` page)
**Source:** `src/app/(dashboard)/recommendations/page.tsx:33-47` (+ `compare/page.tsx:29-34`)
**Apply to:** `my-strategies/page.tsx`
Order is load-bearing: `noStore()` → `createClient()` → `auth.getUser()` → `redirect("/login")`
→ `requireRolePage(supabase, user, "allocator")` **outside any try/catch** (the redirect
throws `NEXT_REDIRECT`). 7 existing call sites, wiring-pinned.

### B. Honest absence, never a fabricated number
**Source:** `StrategyTable.tsx:64-84` (colors) + `queries.ts:252` (`?? { ...EMPTY_ANALYTICS }`)
+ `StrategyTable.tsx:473-478` (`pctSuffix` early returns)
**Apply to:** every new metric cell, the Delta-4 chips, and every Delta-5 placeholder cell.
`formatPercent`/`formatNumber` already emit `—` for null/non-finite and a `—` cell is never
tinted. **Never render `0` / `0.00` / `+0.0%` for an uncomputed metric.**

### C. Optional prop with a literal default = the public invariant
**Source:** `StrategyTable.tsx:113,178` (`basePath`), `:120,179` (`portfolioId`)
**Apply to:** `visibility`, `rowLinkMode` (both components).
Closed string unions only — a function prop (`rowFilter`, `rowHref`) is non-serializable
across the RSC→client boundary and will throw at render (RESEARCH §Anti-Patterns).

### D. Query-builder predicate as the isolation layer, RLS as the backstop
**Source:** `src/lib/visibility.ts:60-86` (header) and `:98-114`
**Apply to:** `getMyStrategies`, and the plan's justification prose.
The owner id MUST come from `auth.getUser()`, never a param (T-110-05/07). `strategies_read`
is `status = 'published' OR user_id = auth.uid()`
(`20260405061912_rls_policies.sql:28`); `.eq("user_id", …)` is strictly narrower than
`withPublishedOrOwner` and therefore cannot leak.

### E. Structural CI invariant with a Rule-9 mutation ledger
**Source:** `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (whole file);
secondary `phase-147-series-resolution-guards.test.ts` (Layer A/B split)
**Apply to:** `phase-149-my-strategies-parity.test.ts`.
Two layers + comment stripping + fail-loud reader + anti-vacuity + ≥3 mutations at
INDEPENDENT sites observed RED, reverted by re-editing (never `git checkout --`).

### F. Comment density is a convention here, not decoration
**Source:** every file read for this map.
**Apply to:** all touched files. Each nav push, each prop, each predicate in this codebase
carries a WHY-comment naming the phase, the requirement id, and the threat/bug class it
forecloses. A new prop with a bare one-line doc will read as foreign in review (Rule 11).

---

## Pinned Literals — CI breaks if these change

Every row is a literal that some CI gate matches on. Editing the left column without
updating the right one turns a green tree red (or, worse, silently un-enforces a guard).

| Literal / token | Lives in | Pinned by | Break condition |
|---|---|---|---|
| `strategies.filter((s) => s.status === "published")` | `StrategyTable.tsx:331` | **nothing today** — this is the gap (Pitfall 1); the new `StrategyTable.visibility.test.tsx` + gate assertion 1 become its first pin | Deleting it globally widens the shared component (the roadmap trap). Parameterize, never delete |
| `visibility = "published-only"` (destructuring default) | `StrategyTable.tsx` signature (`:174-183` block) | phase-149 gate assertion 1 | Dropping the default silently widens `/discovery` **and** `/browse` |
| absence of `visibility=` / `rowLinkMode=` | `discovery/[slug]/page.tsx`, `browse/[slug]/page.tsx` | phase-149 gate assertions 2 + 7 | Adding either prop to a public page = the disclosure regression, asserted not observed |
| `withPublishedOnly(` inside `getStrategiesByCategory` | `queries.ts:221` | phase-149 gate assertion 4; eslint `quantalyze/no-raw-published-predicate`; `visibility.test.ts` grep sweep | The server-side public predicate |
| `.eq("status","published")` (2-arg call expression) | anywhere outside `visibility.ts` / `notes/ownership.ts` | `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs:52-60` (chained into `npm run lint`) | Any raw published predicate. ⚠️ AST-scoped — it does **not** see an in-memory `.filter` |
| raw `.or(...user_id.eq...)` | anywhere outside `visibility.ts` (`B10 visibility:` marker) | `no-owner-or-on-admin-client.mjs` | `.eq("user_id", …)` is NOT matched — the own query is lint-clean by construction |
| `strategy:strategies!inner (` … `asset_class` … `strategy_analytics (` | `queries.ts` dashboard join | `phase-84-asset-class-flow.test.ts:23-32` (slices the block between those two literals) | **Reordering or renaming that join block breaks the slice.** Add `getMyStrategies` as a NEW function; do not reorder the dashboard join |
| `daily_returns` selects must co-name `returns_series`; `resolveDailyReturnSeries(` allowlist incl. `src/lib/queries.ts` | `queries.ts` + 7 other readers | `phase-147-series-resolution-guards.test.ts:204,225,266-273` (Layer A repo walk + Layer B allowlist) | Any new `queries.ts` select naming `daily_returns` without `returns_series` reddens Layer A. `getMyStrategies` uses `strategy_analytics (*)` — a splat, not a bare `daily_returns` — so it is clean; **verify after writing it** |
| banned holdings-engine identifiers | `src/lib/queries.ts` | `phase-63-series-space-guards.test.ts:95,111-121` (`QUERIES_FILE` scan) | Re-introducing a holdings-fallback identifier into `queries.ts` |
| `"/scenarios"` must NOT appear | `src/components/layout/Sidebar.tsx` | `phase-32-frozen-spine-guards.test.ts:175,265-273` (whole-file `not.toContain`) | ⚠️ **Substring match on the WHOLE file.** A new nav entry, href, or even a code comment containing `/scenarios` reddens it. `/my-strategies` is safe |
| `useSearchParams` / `get("portfolio")` absent | `AddToPortfolio.tsx` | `phase-32-frozen-spine-guards.test.ts:313-336` | Untouched by this phase — listed because its rationale cites the `StrategyTable`→`/factsheet` link (`:314-317`), which this phase preserves |
| — | `supabase/migrations/**` | `phase-29-frozen-spine-guards.test.ts` | **No overlap** [VERIFIED: the file scans migrations only; zero `src/` paths]. Listed for completeness |
| `status: "published"` in the row factory | `StrategyTable.test.tsx:89` | the existing 912-line suite | Flipping the shared default would ripple through every existing `StrategyTable` spec. **New statuses go through `overrides` in a NEW spec file**, never by editing this default |
| `basePath = "/discovery"` | `StrategyTable.tsx:178`, `StrategyGrid.tsx:35` | `StrategyGrid.test.tsx` + discovery e2e | The grid href base for both public surfaces |
| `need: "allocator" \| "manager"` literal per surface | `requireRolePage-wiring.test.tsx:71-110` | itself (`call[2]` pin) | A dropped/swapped `need` on the new page ships green without the 8th entry |
| route present in `ROUTE_CONTRACT_MANIFEST` | `route-contract-manifest.ts` | `scripts/check-route-contract.ts` via `npm run lint` (`package.json:11`) | A new `page.tsx` with no entry FAILS lint (Rule 1); an entry with no page file FAILS as STALE (Rule 4) |
| coverage thresholds 82 / 80 / 74 / 72 | `vitest.config.ts` | `frontend-coverage` CI job | Phase gate must be `npm run test:coverage`, not bare `npm test` |

---

## No Analog Found

Files/pieces with no close match — the planner uses RESEARCH.md + first principles, and
should expect these to carry the most review risk.

| Piece | Role | Data Flow | Why no analog |
|---|---|---|---|
| **Delta-5 placeholder rows: the QUERY** ("active keys with no derived strategy") | service (server query) | CRUD-read | `getUserApiKeys` (`queries.ts:2044-2103`) is the right shape for the `api_keys` read — including the `SUPPORTED_EXCHANGE_SET` trust-boundary guard and the drop-and-escalate idiom at `:2078-2101` — but it does NOT filter to active keys and does NOT join strategies. The active-key predicate exists as an **in-memory** helper, `isPerKeyDailiesEligibleKey` (`queries.ts:2436-2443`): `key.is_active && key.sync_status !== "revoked" && key.disconnected_at == null`, with the PostgREST equivalent documented at `:2417-2426`. The `strategy_keys` N:1 mapping has **no server-lib reader at all** — every existing read is in an API route (`finalize-wizard/route.ts:783`, `composite/members/route.ts:100`, `keys/sync/route.ts:552`, `admin/strategy-review/route.ts:406`). ⚠️ The derivation must cover BOTH links: `strategies.api_key_id` (direct) AND `strategy_keys` (composite — the founder's Alpha Centauri carries 3 keys). A `api_key_id`-only anti-join would fabricate 2 extra placeholder rows on the founder's account |
| **Delta-5 placeholder rows: the RENDER** (unranked `<tr>` below ranked rows, `—` rank, `bg-surface-subtle`) | component (client) | presentation | The only non-strategy `<tr>` in `StrategyTable` is the filter-empty row (`:839-845`, `colSpan={emptyRowColSpan}`). Nothing renders a second row CLASS. Constraints to respect: `emptyRowColSpan` is hand-counted (`:460-466`) and must not drift; `paged` (`:431`) and `rank` (`:689`) are derived from `filtered` — placeholders must live **outside** both so `#n` numbering of ranked rows is unaffected; `totalPages` (`:430`) drives pagination. Chip tokens come from `CoverageStateChip`'s `no-series` entry (muted); the label is new copy (`No strategy yet`) |
| **Delta-5 "Finish setup →" with the key preselected** | component (client) | event-driven | `ContributionWizardOverlay` has **no** preselect prop — its interface is exactly `{ isOpen, onClose, onSuccess? }` (`:33-38`) and it hard-resets `source` to `"api"` on close (`:56-63`). Preselecting a key means either a new optional prop threaded into `WizardClient`, or shipping the link WITHOUT preselection (honest, smaller). ⛔ A `Link` into `/strategies/...` is forbidden (`Sidebar.tsx:130-136`). Surface both options to the founder rather than assuming |
| `src/components/ui/Badge.test.tsx` | test | — | **Does not exist** [VERIFIED: `ls` → No such file]. RESEARCH flagged this to confirm at plan time — CONFIRMED. Create it; nearest structural sibling is `CoverageStateChip.test.tsx` (props → label + class assertions) |
| Comparison-set line (`data-testid="comparison-set-note"`) | component (presentational) | presentation | No existing `<p>` on any page carries a ranked-population label. Nearest precedents are the `role="status"` notice at `discovery/[slug]/page.tsx:64-73` (different semantics — that one is a failure notice) and `InfoBanner` (a bordered panel, wrong weight per UI-SPEC "subordinate to the table"). Build from the UI-SPEC anatomy literally: `<p data-testid="comparison-set-note" className="mb-6 text-small text-text-secondary">` |

---

## Open Items the Planner Must Resolve (carried from RESEARCH, not resolved here)

1. **Grid view (Pitfall 3)** — Option A (`rowLinkMode`) vs Option B (hide the toggle).
   Option surface with costs is in §5 above. RESEARCH recommends A.
2. **A2 — simulator gate on own `private` rows.** `portfolioId` parity means every row gets
   a `SimulateImpactButton` (`StrategyTable.tsx:829-835`). `POST /api/simulator` gates
   portfolio ownership only (`simulator/route.ts:149-161`); the candidate is resolved in
   `analytics-service/` (Python, not read). 5-minute plan-time read, or drop `portfolioId`
   on this surface as a documented UI-SPEC deviation. **Do not ship a button that 500s on
   every own private row.**
3. **Delta-5 key census** — the anti-join must cover `strategy_keys`, not just
   `strategies.api_key_id`. Confirm against the founder's account at the Wave-0
   `checkpoint:human-verify` (RESEARCH Open Q2).
4. **A1 NOT closed — CORRECTED at plan revision 2026-08-05 (checker B-1; the prior
   "A1 CLOSED" claim here was WRONG).** The `deriveEmptySeriesState(status,
   strategyCreatedAt, nowMs?)` signature IS verified (`closed-sets.ts:491-495`), but "no
   adapter needed beyond passing `s.analytics.computation_status`" was false: the shared
   row-shaper substitutes `EMPTY_ANALYTICS` (`utils.ts:178` — hardcoded
   `computation_status: "pending"`, `computed_at: ""`) for an ABSENT `strategy_analytics`
   row, so passing `s.analytics.computation_status` raw makes every never-enqueued strategy
   read as a LIVE pending job → a PERMANENT "Syncing" chip that never reaches the 16h
   "No data" arm (the exact forever-spinner `MISSING_ROW_COMPUTING_WINDOW_MS` exists to
   kill). The adapter IS needed: the shaper must preserve the absent-row signal
   (`analyticsPresent: boolean`, plan 02) and the chip derivation must coerce it away first —
   `deriveEmptySeriesState(analyticsPresent ? s.analytics.computation_status : null,
   s.created_at)` — the `returns/route.ts:310-341` and `queries.ts:3604-3615` coercion
   precedents. The chip's render gate is `!isComputedAnalytics(chipStatus)`, never
   `!computed_at` (live jobs carry a computed_at default; EMPTY_ANALYTICS carries `""`).

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/`, `src/app/browse/`, `src/app/factsheet/`,
`src/components/strategy/`, `src/components/layout/`, `src/components/ui/`, `src/lib/`,
`src/__tests__/`, `tools/eslint-plugin-quantalyze/rules/`
**Files read this session:** 21 (13 production, 8 test/config)
**Analogs read at cited lines:** `discovery/[slug]/page.tsx` (full),
`recommendations/page.tsx:1-70`, `Badge.tsx` (full), `queries.ts:110-259` +
`:2044-2148`, `visibility.ts:60-126`, `StrategyTable.tsx:1-140,300-430,430-550,660-916`,
`StrategyGrid.tsx:1-110`, `Sidebar.tsx:55-205`, `CoverageStateChip.tsx` (full),
`closed-sets.ts:440-530`, `ContributionWizardOverlay.tsx:1-90`,
`AllocationsTabs.tsx:1000-1045`, `route-contract-manifest.ts:1-95`,
`requireRolePage-wiring.test.tsx:1-110`, `phase-148-…test.ts:1-325`,
`phase-147/63/84/32 gates` (targeted), `Sidebar.test.tsx:30-100`,
`StrategyTable.test.tsx:55-125`, `StrategyGrid.test.tsx:1-45`,
`no-raw-published-predicate.mjs` (full)
**Pattern extraction date:** 2026-08-05
**Upstream:** 149-CONTEXT.md · 149-RESEARCH.md · 149-UI-SPEC.md (incl. post-approval Delta 5)
