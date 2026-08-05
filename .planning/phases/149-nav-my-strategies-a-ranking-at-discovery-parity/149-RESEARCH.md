# Phase 149: NAV — "My strategies": a ranking at discovery parity - Research

**Researched:** 2026-08-05
**Domain:** In-repo Next.js 16.2.11 App Router surface reuse — visibility-predicate parameterization of an existing client ranking component + a new owner-scoped server query
**Confidence:** HIGH (every finding is a code citation in this repo; zero external-library research was needed)

---

## Summary

This phase is **not a build, it is a parameterization**. Every asset the UI-SPEC names already
exists and was read line-by-line for this document: `StrategyTable.tsx` (915 lines, the ranking),
`getStrategiesByCategory` / `getPercentiles` (the queries), `withPublishedOnly` /
`withPublishedOrOwner` (the predicates), `Sidebar.tsx` (the nav), `Badge.tsx` (the status chip),
the 147/148 structural-gate architecture (the assertion machinery), and `requireRolePage` (the
role gate). The work is: add a third `StrategyTable` consumer, thread ONE closed-union visibility
prop, add ONE owner-scoped query, add ONE `Badge` mapping, add ONE sidebar entry, and pin all of
it with a 147/148-style CI invariant.

**Three findings materially change the plan the UI-SPEC implies**, and the planner must
absorb them before writing tasks:

1. **`StrategyTable` carries its OWN published-only filter in memory**
   (`StrategyTable.tsx:331` — `strategies.filter((s) => s.status === "published")`). The UI-SPEC's
   props recipe ("pass the own set") renders an **EMPTY TABLE** for every private/draft row. This
   is the single blocking defect of the phase. It is invisible to the `no-raw-published-predicate`
   lint rule (which is AST-scoped to `.eq("status","published")` on a query builder), invisible to
   `withPublishedOnly`, and unpinned by any test (`StrategyTable.test.tsx` fixtures are all
   `status: "published"`). It dates to the table's first commit (`2eef614a`), i.e. it is
   incidental, not defence-in-depth.
2. **`withPublishedOrOwner` is the WRONG predicate for this page.** It resolves to
   `status.eq.published,user_id.eq.<uid>` — published **OR** own. On a "My Strategies" page that
   renders the ENTIRE published universe plus the owner's rows. The correct predicate is
   own-only at every status: `.eq("user_id", user.id)`, which `strategies_read` RLS already
   permits and which `visibility.ts`'s own docstring explicitly sanctions as an inline scope
   filter. This contradicts the literal wording of ROADMAP SC-3 and CONTEXT — see
   **Open Question 1**; recommendation is prescriptive and evidence-backed (Rule 7: surface the
   conflict, do not average it).
3. **Grid view is a `notFound()` dead-end for own unpublished rows.** The table's name cell links
   to `/factsheet/{id}` (`StrategyTable.tsx:728`, safe — 148's owner lane resolves it), but
   `StrategyGrid.tsx:52-53` links to `` `${basePath}/${categorySlug}/${s.id}` `` →
   `/discovery/{slug}/{id}` → `getStrategyDetail` → `withPublishedOnly` (`queries.ts:530`) →
   `notFound()`. Grid is reachable from the in-page view toggle on any surface. Shipping without
   addressing this violates **SC-5** and re-opens the exact dead-end class Phase 142.2 existed
   to delete.

**Primary recommendation:** Thread a single closed-union `visibility` prop
(`"published-only" | "owner-all-statuses"`, defaulting to `"published-only"`) through
`StrategyTable`, add `rowLinkMode` (`"category-detail" | "factsheet"`, defaulting to
`"category-detail"`) for the grid href, add `getMyStrategies(userId)` alongside (not instead of)
`getStrategiesByCategory` sharing one internal row-shaper, and pin all four invariants in a
`src/__tests__/phase-149-my-strategies-parity.test.ts` clone of the 147/148 gate architecture.

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Implication for this phase |
|-----------|--------|----------------------------|
| **Next.js is NOT the one you know — read `node_modules/next/dist/docs/` before writing code** | `AGENTS.md` | Version verified: **next 16.2.11** [VERIFIED: `node -e require('next/package.json').version`]. Bundled docs present at `node_modules/next/dist/docs/{01-app,02-pages,03-architecture,04-community}`. The new route is a plain RSC page under `(dashboard)/` — same shape as `discovery/[slug]/page.tsx`; no new Next API is introduced. |
| Rule 2 Simplicity / Rule 3 Surgical | `~/.claude/CLAUDE.md` | Two new props with safe defaults + one new query + one Badge map entry. Do NOT refactor `StrategyTable`'s filter chain, sort, or paging. |
| Rule 7 Surface conflicts, don't average | `~/.claude/CLAUDE.md` | The `withPublishedOrOwner` conflict (Open Q1) must be RESOLVED in the plan with a stated reason, not blended. |
| Rule 9 Tests verify intent | `~/.claude/CLAUDE.md` | Every new gate needs a recorded RED mutation (147/148 precedent — both files carry a `Rule-9 NON-VACUITY` ledger in their header). |
| Rule 11 Match conventions | `~/.claude/CLAUDE.md` | Structural gates go in `src/__tests__/phase-<n>-<topic>.test.ts`; comment-stripping before matching is mandatory (both prior gates do it and both document WHY). |
| Rule 12 Fail loud | `~/.claude/CLAUDE.md` | A missing allowlisted file in the gate is a FAILURE, not a skip (verbatim precedent in both prior gates). |
| Read `DESIGN.md` before any visual decision | project `CLAUDE.md` | Already discharged — 149-UI-SPEC.md is `status: approved`, checker-signed 2026-08-05. Do not re-derive. |
| Coverage gate is BLOCKING: lines 82 / stmts 80 / funcs 74 / branches 72 | project `CLAUDE.md` | Phase-final gate must be `npm run test:coverage`, not bare `npm test` (148-VALIDATION.md corrected this mid-execution). |
| Repo is PUBLIC and `.planning/` is TRACKED | MEMORY | No credentials, no PROD row dumps in plan artifacts. |
| CI = Node 22, local = Node 25 | MEMORY | A CI-only red is skew, not flake: reproduce with `PATH=/opt/homebrew/opt/node@22/bin`. |

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Percentile population (founder decision 2026-08-05)**
- Own rows (incl. private/draft) get percentiles against the PUBLISHED UNIVERSE — the same
  population every ranking surface uses. Semantics: "if published, this would sit at #n /
  Pth percentile."
- `getPercentiles()` is reused UNCHANGED — no second percentile mechanism.
- The comparison set is LABELED on the surface ("ranked against N published strategies") —
  the honest-set requirement from the roadmap trap.
- Own unpublished rows NEVER enter the percentile population — a draft must not shift public
  ranks nor leak unpublished data into numbers any other viewer sees.
- "Both via toggle" explicitly deferred — can be a follow-up once the ranking exists.

**Locked by ROADMAP success criteria (not re-decided)**
- Structural reuse, ASSERTED: the surface is the EXISTING ranking component/query; the
  visibility predicate (own-including-unpublished via 148's `withPublishedOrOwner`) is the
  only genuine difference. No second ranking implementation.
- Parameterize the predicate — do NOT globally widen the shared query; published-only on
  discovery/public surfaces must be PROVABLY unchanged (assert it, don't observe it).
- Metrics for private/draft rows come from the same analytics the factsheet renders; a row
  whose analytics have not computed shows an honest pending state, never zeros (Phase 147's
  series_state/pending idioms are the precedent).
- Every row — including private/draft — opens its factsheet via OWN-02's owner lane, never
  `notFound()`.
- Proof case: the founder's account (8 active keys — bybit, okx, deribit ×3, mt5 ×3), none
  visible on any ranking today, all present here.

### Claude's Discretion
- Route path and sidebar wiring (MY WORKSPACE section per DESIGN.md nav conventions),
  page-level file layout, how the visibility-predicate parameterization is threaded, test
  placement — provided the structural-reuse assertion and the provably-unchanged public
  predicate both hold.

### Deferred Ideas (OUT OF SCOPE)
- Percentile re-rank toggle (among-own-rows view) — deferred at discuss; follow-up candidate
  once the ranking ships.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | A sidebar way-in to an overview of all my strategies, at RANKING PARITY with the external/discovery ranking (same columns, sort affordances, `#n` + percentile), covering every uploaded key + derived strategies incl. `private`/`draft`; clicking one opens its factsheet. Reuse the existing ranking component/query — the visibility predicate is the only genuine difference. Honest pending state, never zeros. | §Architecture Patterns (the exact 3-consumer reuse shape + the two threaded props), §Standard Stack (every file:line the surface is assembled from), §Don't Hand-Roll (the four "do not rebuild" items), §Common Pitfalls 1–8 (the in-component published filter, the wrong predicate, the grid dead-end, the category-join trap, the trust_tier degradation, the prefs key, the mobile-nav cap, the N-derivation), §Validation Architecture (per-SC test map). |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Own-row visibility predicate (`user_id` eq, all statuses) | **API/Backend (RSC server query)** | Database (RLS `strategies_read` backstop) | Predicate must be applied server-side on the user-scoped Supabase client. Client-side filtering of an over-fetched set would ship unpublished rows into the RSC flight payload. RLS is the backstop, the query builder is the isolation layer (`visibility.ts` header states this contract). |
| Published-only predicate on discovery/browse | **API/Backend** | Database | Unchanged. `withPublishedOnly` at `queries.ts:221` (list) and `queries.ts:125/131` (percentiles). |
| Percentile computation | **API/Backend** | — | `getPercentiles()` runs on the server, returns a plain map. `StrategyTable` NEVER recomputes (its own comment at `StrategyTable.tsx:32-36` pins this). |
| Ranking presentation (`#n`, sort, columns, paging, chips) | **Browser/Client** | — | `StrategyTable` is `"use client"`. `#n` is positional within the active sort (`StrategyTable.tsx:689`), NOT re-derived. |
| Row → factsheet resolution for an owner | **Frontend Server (RSC route)** | — | Phase 148's Lane B in `factsheet/[id]/v2/page.tsx:455-517` — probe-first, uncached, session-keyed. Already landed on main (`515c028f`). |
| Role gate (allocator workspace) | **Frontend Server (RSC page body)** | — | `requireRolePage(supabase, user, "allocator")` — the Phase-109 ROLE-04 pattern, 7 existing call sites, wiring-pinned by `(dashboard)/requireRolePage-wiring.test.tsx`. |
| Nav entry visibility | **Browser/Client** | — | `Sidebar.tsx` is `"use client"`; the entry must live INSIDE `showsAllocatorWorkspace` (`Sidebar.tsx:103-142`) — T-110-16 role-leak class. |

---

## Standard Stack

### Core — every asset already exists in-repo

| Asset | file:line | Purpose | Why standard |
|-------|-----------|---------|--------------|
| `StrategyTable` | `src/components/strategy/StrategyTable.tsx` (915 ln) | THE ranking component | Exactly 2 production consumers today (`discovery/[slug]`, `browse/[slug]`); this phase adds the 3rd. No competing table exists. [VERIFIED: repo grep] |
| `getStrategiesByCategory` | `src/lib/queries.ts:204` | published + category-scoped rows + analytics splat + trust signals | The discovery/browse loader. `withPublishedOnly` at :221; `discovery_categories!inner(slug)` at :225. |
| `getPercentiles(categorySlug?)` | `src/lib/queries.ts:119` | published-only percentile map, min-5, lower-is-better inversion | CONTEXT-locked as REUSED UNCHANGED. **Call it with NO argument** on this surface (see Pattern 4). |
| `withPublishedOnly` / `withPublishedOrOwner` | `src/lib/visibility.ts:76` / `:115` | the ONE place each predicate lives | B10 boundary. Note `withPublishedOrOwner` is `published OR own` — see Pitfall 2. |
| Owner-lane factsheet | `src/app/factsheet/[id]/v2/page.tsx:410-545` | row link target, resolves private/draft for the owner | Landed on main `515c028f` (Phase 148). `/factsheet/[id]/page.tsx` re-exports `./v2/page`. |
| `requireRolePage` | `src/lib/auth/requireRolePage.ts` | allocator page gate | 7 call sites; `compare/page.tsx:33`, `recommendations/page.tsx:45` are the reference shape. |
| `Badge` | `src/components/ui/Badge.tsx` | the status chip | `statusMap` :13-23, `statusLabelMap` :25-35, fallback `?? statusMap.draft` :46 and `?? label` :49. |
| `SyncBadge` | `src/components/strategy/SyncBadge.tsx:28` | `if (!computedAt) return null` | The empty slot the Delta-4 pending chip occupies. VERIFIED — degrades exactly as UI-SPEC assumes. |
| `PageHeader` | `src/components/layout/PageHeader.tsx` | `{ title, description?, actions?, meta?, breadcrumb? }` | Instrument Serif `text-fixed-32` h1. Pass `title` only (UI-SPEC: no breadcrumb). |
| `Sidebar` / `buildNavSections` | `src/components/layout/Sidebar.tsx:59`, allocator branch `:103-142` | nav construction | `MobileSidebarDrawer` mounts the SAME `Sidebar` (`:184`) → the entry reaches mobile for free. |
| `deriveEmptySeriesState` | `src/lib/closed-sets.ts:491` | 147's two-state pending mapping | Cited by UI-SPEC Delta 4 as the mapping helper. Planner must confirm its exact signature at plan time (not re-read here). |
| `ContributionWizardOverlay` | `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` | the empty-state CTA target | Trigger-agnostic; already mounted at 3 sites with LOCAL `useState` (`DashboardChrome.tsx:66`, `AllocationsTabs.tsx:1014`, `ScenarioComposer.tsx:155`). See Pitfall 9. |

### Supporting

| Asset | file:line | When to use |
|-------|-----------|-------------|
| `readPublicVerificationSignals` | `src/lib/queries.ts:331` | trust_tier projection — **published-gated by construction** (`get_published_trust_signals` RPC filters `strategies.status='published'`). Own unpublished rows get `trust_tier: null`. Table view does not read trust_tier (it gates the check on `s.api_key_id`, `StrategyTable.tsx:733`) → no table impact. Grid's `VerifiedBadge` does → honest absence. |
| `extractAnalytics` / `EMPTY_ANALYTICS` | re-exported `src/lib/queries.ts:202` | the `?? { ...EMPTY_ANALYTICS, strategy_id }` fallback at `queries.ts:252` — this is what makes an analytics-less row render em-dashes rather than crash. |
| `route-contract-manifest.ts` | `src/lib/routing/route-contract-manifest.ts` | **MANDATORY**: a new page route with no entry FAILS `npm run lint` (`scripts/check-route-contract.ts`, chained at `package.json:11`). Class = `private`. |
| `(dashboard)/requireRolePage-wiring.test.tsx` | same | **MANDATORY EDIT**: pins the `need` literal of every guarded surface; add the new page as an 8th `SURFACES` entry. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Threading a `visibility` prop into `StrategyTable` | Pre-filtering server-side and deleting `StrategyTable.tsx:331` outright | Deleting the filter globally widens the shared component — the exact roadmap trap. A discovery loader bug would then leak drafts into the public table with nothing to catch it. **Rejected.** |
| Closed string union `visibility?: "published-only" \| "owner-all-statuses"` | `rowFilter?: (s) => boolean` callback prop | A function prop cannot cross the RSC→client boundary in App Router (non-serializable) AND it is an open hole any caller could widen arbitrarily. **Rejected on both counts.** |
| `getMyStrategies(userId)` as a sibling function sharing an internal row-shaper | Overloading `getStrategiesByCategory` with a visibility param | Own rows are not category-scoped and `strategies.category_id` is nullable (`initial_schema.sql:50`), so the `discovery_categories!inner(slug)` join at `queries.ts:225` would silently DROP them. The two queries have genuinely different SHAPES; forcing one signature produces a branchy function nobody can reason about. Shared row-shaper preserves the real reuse (select list + trust signals + analytics extraction). |
| `rowLinkMode` prop for the grid href | Suppressing grid view on this surface | Suppression breaks the UI-SPEC's "view modes inherited unchanged" and needs a spec amendment. The prop is 3 lines and closes an inherited table/grid inconsistency. |
| Adding to `buildPrimaryMobileNav` | Leaving mobile primary nav untouched | The primary nav is CAPPED at 5 (`Sidebar.tsx:298-301`); adding displaces an existing destination. The hamburger drawer renders the full `Sidebar` (`MobileSidebarDrawer.tsx:184`) so the entry is already mobile-reachable. **Do not touch `buildPrimaryMobileNav`.** |

**Installation:** none — **this phase installs ZERO external packages.** No new dependency, no
registry, no shadcn (`components.json` absent by design, UI-SPEC §Design System).

---

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** Every asset is in-repo. No
`npm install`, no `pip install`, no registry read is required by any plan derived from this
research. The Package Legitimacy Gate is therefore vacuous, not skipped.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
  ┌─ Sidebar (client) ──────────────────────────────────────┐
  │  buildNavSections → showsAllocatorWorkspace branch      │
  │  { label:"My Strategies", href:"/my-strategies", icon }  │  ← Delta 1
  └───────────────────────┬─────────────────────────────────┘
                          │ Link
                          ▼
  ┌─ /my-strategies/page.tsx  (RSC, (dashboard) segment) ───────────────┐
  │  createClient() → auth.getUser()                                    │
  │       │ no user → redirect("/login")                                │
  │       ▼                                                             │
  │  requireRolePage(supabase, user, "allocator")   ← throws NEXT_REDIRECT
  │       │                                                             │
  │       ├──────────────┬──────────────────┬───────────────────┐       │
  │       ▼              ▼                  ▼                   ▼       │
  │  getMyStrategies  getRealPortfolio  getPercentiles()   (Promise.all)│
  │  (.eq user_id,     (portfolioId)    NO ARG → GLOBAL                 │
  │   ALL statuses,                      published universe             │
  │   no category join)                  min-5 → null                   │
  │       │                                    │                        │
  │       │  rows.length === 0 ?               │                        │
  │       ├── YES → <MyStrategiesEmptyState/>  │ (page-level, CTA opens  │
  │       │          (comparison-set line OMITTED)  ContributionWizard) │
  │       ▼ NO                                 ▼                        │
  │  <p data-testid="comparison-set-note">  N = Object.keys(map).length │
  │  <StrategyTable                                                     │
  │      strategies={own rows}                                          │
  │      categorySlug="my-strategies"      ← prefs-scope key only        │
  │      portfolioId={portfolio?.id ?? null}                            │
  │      percentiles={map ?? undefined}                                 │
  │      visibility="owner-all-statuses"   ← NEW, default published-only │
  │      rowLinkMode="factsheet"           ← NEW, default category-detail│
  │      (userId + initialWatchedSet OMITTED → /browse variant)          │
  │  />                                                                 │
  └───────────────────────┬─────────────────────────────────────────────┘
                          │ client hydrate
                          ▼
  ┌─ StrategyTable (client) ────────────────────────────────────────────┐
  │  filtered = strategies                                              │
  │     .filter(visibility === "published-only"                         │
  │             ? s => s.status === "published"                         │
  │             : () => true)              ← line 331, PARAMETERIZED    │
  │     → watchlist scope → examples → search → advanced → sort         │
  │  paged = slice(page*20, …)  ;  rank = page*20 + i + 1               │
  │                                                                     │
  │  table mode → name cell <Link href={`/factsheet/${s.id}`}>          │
  │              + Badge(status) when status!=='published'  ← Delta 3   │
  │              + Syncing/No-data chip in the null-SyncBadge slot ← D4 │
  │  grid  mode → StrategyGrid, href = rowLinkMode==="factsheet"        │
  │               ? `/factsheet/${s.id}`                                │
  │               : `${basePath}/${categorySlug}/${s.id}`  ← FIX SC-5   │
  └───────────────────────┬─────────────────────────────────────────────┘
                          │ row click (ANY status)
                          ▼
  ┌─ /factsheet/[id] → re-export ./v2/page (RSC, force-dynamic) ────────┐
  │  Lane A: unstable_cache( withPublishedOnly ) — public, untouched    │
  │  Lane A miss + session → Lane B: withPublishedOrOwner probe,        │
  │     UNCACHED build, viewerNotice banner. Owner ⇒ 200, never 404.    │
  └─────────────────────────────────────────────────────────────────────┘

  INVARIANT (asserted by the CI gate, not observed):
    /discovery/[slug] and /browse/[slug] pass NEITHER new prop
    ⇒ both defaults fire ⇒ published-only + category-detail hrefs
    ⇒ byte-identical to today for every anon / non-owner viewer.
```

### Recommended Project Structure

```
src/app/(dashboard)/my-strategies/
├── page.tsx                      # RSC: auth → role gate → 3 parallel fetches → render
├── MyStrategiesEmptyState.tsx    # "use client": local useState + ContributionWizardOverlay
└── page.test.tsx                 # RSC-level wiring spec (predicate, props, N, empty branch)

src/lib/queries.ts                # + getMyStrategies(userId) sharing the row-shaper
src/components/strategy/StrategyTable.tsx   # + visibility, + rowLinkMode
src/components/strategy/StrategyGrid.tsx    # + rowLinkMode passthrough
src/components/ui/Badge.tsx                 # + 'private' in both maps
src/components/layout/Sidebar.tsx           # + nav entry in the allocator branch
src/lib/routing/route-contract-manifest.ts  # + { route:"/my-strategies", class:"private" }
src/__tests__/phase-149-my-strategies-parity.test.ts   # the structural CI invariant
```

### Pattern 1 — Closed-union visibility prop, default-safe

**What:** One optional prop with a two-member string union and a literal default in the
destructuring.
**When to use:** Whenever a shared component carries an implicit policy that one new consumer
must invert. The default preserves every existing consumer byte-for-byte; the union stops the
prop becoming an arbitrary widening hole.

```tsx
// Source: proposed — mirrors StrategyTable.tsx's own `userId?:` / `percentiles?:` prop idiom
/**
 * Client-side visibility predicate. DEFAULT `"published-only"` reproduces the
 * behaviour /discovery/[slug] and /browse/[slug] have had since 2eef614a: a row
 * that is not `status === "published"` never renders. `"owner-all-statuses"` is
 * passed ONLY by the owner-scoped /my-strategies surface, whose SERVER query has
 * already narrowed the set to `user_id = <session id>` — this prop does not widen
 * anything, it stops the component re-filtering an already-owner-scoped set.
 * Pinned by src/__tests__/phase-149-my-strategies-parity.test.ts.
 */
visibility?: "published-only" | "owner-all-statuses";

// …in the signature:
visibility = "published-only",

// …at line 331:
let result =
  visibility === "published-only"
    ? strategies.filter((s) => s.status === "published")
    : strategies.slice();
```

⚠️ `.slice()` (not the raw array): the existing code mutates `result` in place with `result.sort(...)`
at `StrategyTable.tsx:418`. Handing back the prop array unsliced would sort the caller's array —
a real hazard in a `useMemo` whose dep array includes `strategies`.

### Pattern 2 — Owner-scoped query beside the published one, sharing the row-shaper

**What:** Two exported fetchers, one internal shaper. Not one fetcher with a mode flag.
**When to use:** When two callers need the SAME row projection but genuinely different
predicates and joins.

```ts
// Source: proposed — derived from queries.ts:204-255 (getStrategiesByCategory)
const RANKING_SELECT = "*, strategy_analytics (*)";

/** Shared projection: trust signals + analytics extraction. The ONE row-shaper. */
async function shapeRankingRows(rows: unknown[]): Promise<StrategyWithAnalytics[]> { /* …the
   existing queries.ts:243-254 body, extracted verbatim… */ }

export async function getMyStrategies(userId: string): Promise<StrategyWithAnalytics[]> {
  const supabase = await createClient();
  // NAV-01 own-only visibility predicate. NOT withPublishedOrOwner — that helper is
  // `published OR own` and would render the entire published universe on a page titled
  // "My Strategies". `.eq("user_id", …)` at every status is exactly what strategies_read
  // RLS (`status='published' OR user_id = auth.uid()`, 20260405061912_rls_policies.sql:28)
  // already permits for the session user, and visibility.ts's own header sanctions an
  // inline user_id scope filter as "a transparent scope filter, not an ownership ASSERTION".
  // NO discovery_categories!inner join — strategies.category_id is nullable, an inner join
  // would silently drop contributed rows (initial_schema.sql:50).
  const { data, error } = await supabase
    .from("strategies")
    .select(RANKING_SELECT)
    .eq("user_id", userId);
  if (error) { /* console.error + captureToSentry, mirroring queries.ts:228 / :142-145 */ return []; }
  return shapeRankingRows(data ?? []);
}
```

`getStrategiesByCategory` keeps its `withPublishedOnly(...)` wrapper untouched and calls the
same shaper. The lint rule `quantalyze/no-owner-or-on-admin-client` bans a raw
`.or(...user_id.eq...)` outside `visibility.ts` — it does **not** touch `.eq("user_id", …)`
[VERIFIED: `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs`], so this shape
is lint-clean by construction.

### Pattern 3 — 147/148 structural CI invariant (the SC-3 machinery)

**What:** A `src/__tests__/phase-N-*.test.ts` that walks production source, STRIPS COMMENTS,
and asserts literals + repo-wide absences. Carries a `Rule-9 NON-VACUITY` ledger in its header
recording the mutations that were observed RED.
**When to use:** Whenever a success criterion says "asserted, not merely observed."

Both precedents (`phase-147-series-resolution-guards.test.ts`,
`phase-148-owner-lane-cache-isolation.test.ts`) use the identical two-layer shape:

- **Layer A — repo-wide walk.** Catches a brand-new offender file an allowlist structurally
  cannot. 147 bans a bare `daily_returns` select; 148 bans any other file mentioning the
  cached builder.
- **Layer B — per-file allowlist pins, one `it()` per file** so a failure names the offender.
  A missing allowlisted file is a FAILURE, not a skip (Rule 12).
- **Anti-vacuity assertion:** prove the extractor actually found something, so an empty
  offender list means "clean", not "blind" (148 assertion 7).
- **Comment stripping is load-bearing**, not hygiene: both files document that their own
  guarded source contains prose naming the banned tokens, so a bare grep would self-invalidate.

**Literals Phase 149's gate should pin** (see Validation Architecture for the SC map):

| # | Assertion | Why this literal |
|---|-----------|------------------|
| 1 | `StrategyTable.tsx` contains `visibility = "published-only"` (the destructuring default) | The default IS the public invariant. A dropped default silently widens both public surfaces. |
| 2 | `discovery/[slug]/page.tsx` and `browse/[slug]/page.tsx` contain NO `visibility=` token (comments stripped) | Absence-as-assertion — formatting-independent, and it is what "provably unchanged" means. 148 used the same negative-assertion technique for its signature pin. |
| 3 | Repo-wide: exactly ONE production file contains `visibility="owner-all-statuses"`, and it is the my-strategies page | The "no second widening consumer" clause. |
| 4 | `queries.ts` `getStrategiesByCategory` body still contains `withPublishedOnly(` | The server-side public predicate, restated structurally. |
| 5 | `getMyStrategies` body contains `.eq("user_id"` and NEITHER `withPublishedOrOwner` NOR `discovery_categories!inner` | Pins the own-only predicate AND the no-inner-join finding in one place. |
| 6 | Repo-wide: exactly ONE `export function StrategyTable` — no second ranking component | SC-3's literal wording. |
| 7 | `StrategyGrid.tsx` href expression is branched on `rowLinkMode`, and the two public pages pass no `rowLinkMode` | SC-5 for grid view + the public-invariance clause. |
| 8 | Anti-vacuity: the stripped `StrategyTable.tsx` source really does still contain `owner-all-statuses` somewhere | Empty offender list ⇒ clean, not blind. |

### Pattern 4 — Global (un-scoped) percentile call, N derived from the map

**What:** Call `getPercentiles()` with NO argument.
**Why:** Own rows span multiple categories, or none (`category_id` is nullable). A
category-scoped call would (a) pick an arbitrary category and (b) rank cross-category rows
against the wrong peer set. `getPercentiles()` un-scoped takes the `withPublishedOnly` branch at
`queries.ts:131` → the GLOBAL published population. This is exactly the UI-SPEC's copy ("ranked
against N published strategies" — no category qualifier) and exactly CONTEXT's lock ("the same
population every ranking surface uses"). Signature unchanged ⇒ "getPercentiles reused UNCHANGED"
holds.

```tsx
// N for the comparison-set line. getPercentiles returns ONLY the map (queries.ts:196) — it
// does NOT return a population count, and CONTEXT forbids changing its signature. Derive N
// from the map: an id is present iff it contributed ≥1 non-null metric to the ranking, so
// Object.keys().length IS the ranked population. Never a second COUNT query (a second
// mechanism), never a hardcoded number.
const n = percentiles ? Object.keys(percentiles).length : 0;
```
⚠️ Honest nuance to carry in a code comment: `getPercentiles` computes per-metric `n`
(`queries.ts:178`), so the per-metric population can be smaller than `Object.keys(map).length`
when some rows have a null metric. `Object.keys(...).length` is the number of strategies that
entered the ranking at all — that is what "ranked against N published strategies" claims, so
the copy is honest. Do not over-engineer a per-metric N.

### Anti-Patterns to Avoid

- **Deleting `StrategyTable.tsx:331` instead of parameterizing it.** Globally widens the shared
  component; the roadmap trap verbatim.
- **Using `withPublishedOrOwner` on the my-strategies query.** Renders the whole published
  universe. See Pitfall 2 / Open Q1.
- **Adding `discovery_categories!inner(slug)` to the own query.** Silently drops every row with
  a null `category_id`.
- **A function prop (`rowHref`, `rowFilter`) on `StrategyTable`.** Non-serializable across the
  RSC→client boundary in App Router; will throw at render.
- **Re-deriving `#n` as "rank within the published universe".** UI-SPEC explicitly forbids it;
  `#n` is positional (`StrategyTable.tsx:686-689`). The published-universe comparison is carried
  by `Pnn` + the labeled line.
- **A "Published" chip on published own rows.** UI-SPEC Delta 3: absence of a marker means
  published.
- **Red or amber on the `Private`/`Draft` marker.** Publication is admin-gated; the owner has no
  one-click remedy. Muted only.
- **Adding the entry to `buildPrimaryMobileNav`.** Cap is 5; the drawer already carries it.
- **Rendering `0` / `0.00` / `+0.0%` for an uncomputed metric.** The em-dash rule is
  load-bearing; `formatPercent`/`formatNumber` already emit `—` for null/non-finite
  (`StrategyTable.tsx:64-84` never tints a `—` cell).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ranking table (columns, sort, `#n`, paging, density, scroll cue, `<details>` collapse, `@container` priority collapse) | A "MyStrategiesTable" | `StrategyTable` + 2 props | 915 lines of accumulated behavior + 4 test files pinning it (`StrategyTable.test.tsx` 912 ln, `discovery-selectors.contract.test.tsx`, `phase-52-container-tabular-nums.test.tsx`, `phase-32-frozen-spine-guards.test.tsx`). Two implementations WILL drift — SC-3 exists to forbid it. |
| Percentile ranks for own rows | A second percentile computation, or an "among-own-rows" variant | `getPercentiles()` un-scoped | CONTEXT-locked. Lower-is-better inversion, `Math.abs` on max_drawdown (`queries.ts:168-174`), and the min-5 rule are all subtle and already right. The toggle variant is DEFERRED. |
| Owner-visible factsheet | A `/my-strategies/[id]` detail route | `/factsheet/{id}` → Phase 148 Lane B | Landed on main. A second detail route re-opens the cache-disclosure surface 148 spent 5 plans closing. |
| Status chip | A new pill component | `Badge type="status"` + one map entry | UI-SPEC Delta 3 is explicit: "Do NOT invent a new chip." |
| Pending/no-data chip | A new state machine | 147's `deriveEmptySeriesState` (`closed-sets.ts:491`) + the 147 chip classes verbatim | UI-SPEC Delta 4 names the exact classes. A third state mapping is the drift class. |
| Empty-state CTA overlay | A new wizard entry point | Mount `ContributionWizardOverlay` with local `useState` | Explicitly "trigger-agnostic" (`DashboardChrome.tsx:60-66`); 3 mount sites already exist. |
| Role gate | An inline `profile.role` check | `requireRolePage(supabase, user, "allocator")` | 7 call sites, wiring-pinned. An inline check is the ROLE-02 mis-classification bug class that already bit `/portfolios`. |

**Key insight:** every "new thing" in this phase is a PROP or a MAP ENTRY. If a plan task
creates a new component that renders rows, columns, ranks, or percentiles, it has violated SC-3
before it compiles.

---

## Runtime State Inventory

Included because this phase adds a route + a nav entry and touches a cached public surface.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** The phase is READ-ONLY: no `.insert(`/`.update(`/`.upsert(` is required by any finding here. No migration. No new column. | none — a reviewer should assert `git diff <phase-range>` contains zero write calls, exactly as 148-VALIDATION did |
| Live service config | **None.** No n8n workflow, Datadog service, Tailscale ACL, or Cloudflare tunnel references this surface. | none |
| OS-registered state | **None.** No cron, no Task Scheduler entry, no pm2 process. `pg_cron` jobid 9 (derive-dailies fan-out) is untouched. | none |
| Secrets / env vars | **None.** No new env var, no feature flag. (Contrast: MT5/sFOX phases needed Vercel + worker env flips.) | none |
| Build artifacts / caches | **`unstable_cache` entries on `/factsheet/[id]/v2`** — Phase 148's Lane A cache is keyed id-only and survives deploys. This phase does not populate it (Lane B is uncached), but any manual UAT of "own draft row → factsheet" must use a FRESH draft id or `revalidateTag`, per 148's own Manual-Only note. Also: **`localStorage` `discovery_view_preferences:*`** — see Pitfall 6. | UAT instruction only; no code action |

---

## Common Pitfalls

### Pitfall 1 — ⛔ `StrategyTable` filters to published IN THE COMPONENT (the blocking defect)
**What goes wrong:** The UI-SPEC's props recipe is followed exactly, the server query correctly
returns 8 own rows, and the page renders "No strategies match your filters." Every private/draft
row is dropped client-side.
**Root cause:** `StrategyTable.tsx:331` — `let result = strategies.filter((s) => s.status === "published");`
It is the FIRST line of the `filtered` `useMemo`, before watchlist scope, examples, search, and
sort. [VERIFIED: read in full]
**Why it hid:** it is invisible to `withPublishedOnly` (a query-builder helper), invisible to the
`quantalyze/no-raw-published-predicate` lint rule (AST-matched on
`.eq("status","published")` call expressions only — an in-memory `.filter` is not a match)
[VERIFIED: `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs:52-60`], and
unpinned by any test — `StrategyTable.test.tsx`'s single row factory hardcodes
`status: "published"` at line 89, so no existing test can go red either way. It dates to commit
`2eef614a` ("add discovery strategy table with sparklines, filters, and mock data") — i.e. it is
incidental to the mock-data era, not a deliberate gate.
**How to avoid:** Pattern 1. Parameterize with a default; never delete.
**Warning signs:** the table renders 0 rows for a user you know has rows; the in-table message
"No strategies match your filters." appears with no filters applied.

### Pitfall 2 — ⛔ `withPublishedOrOwner` renders the ENTIRE published universe
**What goes wrong:** Following CONTEXT/SC-3's literal wording, the plan wires
`withPublishedOrOwner(query, user.id)` into the my-strategies loader. The page titled
"My Strategies" then lists every published strategy on the platform plus the owner's rows.
**Root cause:** the helper appends `.or("status.eq.published,user_id.eq.<uid>")`
(`visibility.ts:130-133`) — published **OR** own, by design, because its only consumer is
`GET /api/strategies/browse`, a genuine owner-inclusive **discovery** surface. "My Strategies"
is not a discovery surface. [VERIFIED: `visibility.ts:115-134`, `browse/route.ts:1-120`]
**How to avoid:** `.eq("user_id", user.id)` with NO status predicate. `strategies_read` RLS is
`status = 'published' OR user_id = auth.uid()` (`20260405061912_rls_policies.sql:28`) and
`analytics_read` is the EXISTS-mirror of the same shape (:36-42). Neither policy is ever dropped
or replaced by a later migration [VERIFIED: `grep "DROP POLICY.*strategies_read\|analytics_read"`
→ zero matches], so the owner can read every own strategy AND its analytics at any status.
`.eq("user_id", …)` is strictly NARROWER than `withPublishedOrOwner` and therefore cannot leak.
**Warning signs:** row count on the page ≫ the user's key count; strategies with someone else's
name appear.

### Pitfall 3 — ⛔ Grid view dead-ends on `notFound()` (SC-5 violation)
**What goes wrong:** The user toggles to Grid view, clicks a private row, and lands on a 404 —
the exact dead-end class SC-5 forbids.
**Root cause:** the table's name cell links to `/factsheet/{id}` (`StrategyTable.tsx:728`), but
`StrategyGrid.tsx:52-53` links to `` `${basePath}/${categorySlug}/${s.id}` ``. That route
(`discovery/[slug]/[strategyId]/page.tsx:40`) calls `getStrategyDetail`, which wraps
`withPublishedOnly` (`queries.ts:530`) → `null` → `notFound()`. Compounding it: this surface's
`categorySlug` is a prefs-scope key, not a real category, so the URL is bogus for published own
rows too — and even with a real slug, the `discovery_categories!inner(slug)` guard (`queries.ts:541`)
would reject a cross-category row. [VERIFIED: all four files read]
**How to avoid:** add `rowLinkMode?: "category-detail" | "factsheet"` (default
`"category-detail"`) to `StrategyTable`, pass through to `StrategyGrid`, branch the `href`.
Pass `"factsheet"` on this surface only.
**Warning signs:** any plan that treats grid view as "inherited, zero work."

### Pitfall 4 — The category inner-join silently drops own rows
**What goes wrong:** the own query is copy-pasted from `getStrategiesByCategory` and keeps
`discovery_categories!inner(slug)`. Every contributed strategy with `category_id IS NULL`
vanishes — probably ALL of them, since the contribution wizard is not a category-picking flow.
**Root cause:** `strategies.category_id UUID REFERENCES discovery_categories ON DELETE SET NULL`
— nullable (`20260405061911_initial_schema.sql:50`). PostgREST drops the row entirely on an
`!inner` miss (documented at `queries.ts:517-519`).
**How to avoid:** the own query selects `"*, strategy_analytics (*)"` with NO category embed.
Pin it in the structural gate (assertion 5).

### Pitfall 5 — `trust_tier` is published-gated; unpublished own rows lose the verified pill in GRID view
**What goes wrong:** an own private row that IS api-verified shows no verified affordance in
grid view.
**Root cause:** `readPublicVerificationSignals` calls the `get_published_trust_signals` SECURITY
DEFINER RPC whose `WHERE strategies.status = 'published'` is the column-scoped published gate by
construction (`queries.ts:298-330`). Own unpublished rows are absent from the map →
`trust_tier: null`.
**Blast radius:** TABLE view is UNAFFECTED — its verified check gates on `s.api_key_id`, not
trust_tier (`StrategyTable.tsx:733`), so the api-verified check DOES render on own private rows.
Only `StrategyGrid`'s `VerifiedBadge trustTier={s.trust_tier}` degrades to null.
**How to avoid:** ACCEPT it — this is honest absence, and widening the RPC would be a
public-disclosure change this phase's own trap forbids. Document it; do not "fix" it. Flag to
the planner as an accepted, recorded degradation, not a defect.

### Pitfall 6 — `discovery_view_preferences` key collision / surprising defaults
**What goes wrong:** the page passes a real category slug as `categorySlug`, and the user's
saved discovery prefs (grid view, a sort key) apply to this surface — or worse, this surface
writes prefs that then change /discovery.
**Root cause:** `useDiscoveryPrefs(userId, categorySlug)` keys localStorage as
`discovery_view_preferences:${uid}:${slug}` (`discovery-prefs.ts:40`).
**Mitigations already in place:** the UI-SPEC omits `userId` → `useDiscoveryPrefs(undefined, …)`
is documented as a persistence NO-OP (`discovery-prefs.ts:115-125`) so this page can never WRITE
a pref. Reads fall to `DEFAULTS` (`view: "table"`, `sort: sharpe/desc`, `hide_examples: true`,
:22-26).
**How to avoid:** still pass a DISTINCT non-category `categorySlug` (e.g. `"my-strategies"`) so
the read key cannot collide either. `DISCOVERY_CATEGORIES` is not consulted by the table, so a
non-category value is safe — but it is exactly why Pitfall 3's grid href must not use it.

### Pitfall 7 — Adding the entry to the mobile primary nav breaks the ≤5 cap
**Root cause:** `buildPrimaryMobileNav` reserves one slot for Profile and slices to
`CAP - 1 = 4` (`Sidebar.tsx:298-301`). A pure allocator's set is already
`My Allocation / Risk / Bridge` + ONE filler slot contested by `Add a Strategy` and `Discovery`.
**How to avoid:** do not touch it. `MobileSidebarDrawer` mounts the full `Sidebar`
(`MobileSidebarDrawer.tsx:184`), so the entry reaches mobile via the hamburger for free.

### Pitfall 8 — The Badge `private` fix changes THREE other surfaces
**What goes wrong:** the fix is treated as cosmetic and shipped unreviewed; a reviewer later
finds `/strategies` rendering differently.
**Root cause:** `Badge type="status"` has 5 consumers [VERIFIED: repo grep]:
`(dashboard)/strategies/page.tsx:177`, `components/strategy/StrategyHeader.tsx:24`,
`components/admin/AdminTabs.tsx:274`, `components/strategy/RequestIntroButton.tsx:129`,
`components/strategy/PendingIntros.tsx:170`. The last three pass `contact_requests` statuses
(`pending`/`intro_made`/`completed`/`declined`) — **unaffected**, `private` is not in that
domain. The first two pass `strategies.status`, whose union INCLUDES `"private"`
(`types.ts:175`), and `/strategies` renders own rows filtered only by
`.or("source.neq.wizard,status.neq.draft")` (`strategies/page.tsx:27`) — a `private` row passes
that filter. **So the defect is LIVE on `/strategies` and on `StrategyHeader` today**: an
unmapped `private` falls to `statusMap.draft` styling with the raw lowercase label `private`
(`Badge.tsx:46,49`).
**How to avoid:** ship the mapping as a genuine (small) fix with its own test, and state in the
plan that two existing surfaces improve as a side effect. That is correct, not scope creep —
but it must be DECLARED, not discovered in review.

### Pitfall 9 — The empty-state CTA cannot reach `openContribute`
**What goes wrong:** the plan wires the empty-state button to the sidebar's `add-strategy`
action and finds no way to call it.
**Root cause:** `contributeOpen` is LOCAL `useState` inside `DashboardChrome`
(`DashboardChrome.tsx:66-77`), handed DOWN only as `onNavAction` to `Sidebar` / `MobileNav` /
`MobileSidebarDrawer`. A page rendered as `{children}` has no access. There is no context, no
store (the only cross-tree bridge, `useFlaggedCountStore`, is for the flagged-count badge only).
**How to avoid:** follow the established precedent — mount a second `ContributionWizardOverlay`
with local state in a small client component. `AllocationsTabs.tsx:1014` and
`ScenarioComposer.tsx:155` already do exactly this; the overlay's own header calls itself
"trigger-agnostic" (`DashboardChrome.tsx:60-63`).
**Note:** a `Link` to `/strategies/...` is FORBIDDEN — the wizard route sits under the
Phase-109 manager-guarded `/strategies` subtree and would redirect-bounce an allocator
(`Sidebar.tsx:129-136`).

### Pitfall 10 — Title collision with the existing manager page
**What:** `(dashboard)/strategies/page.tsx:73` already renders `<PageHeader title="My Strategies" />`.
Two pages will carry the identical `h1`.
**Impact:** benign at runtime (the manager page is role-gated the other way), but it BREAKS any
test or e2e locator of the form `h1:has-text("My Strategies")` if such a selector is ever
introduced, and it will confuse a role='both' account (the founder). The UI-SPEC locks the title
copy, so do not change it — instead, every test/e2e selector for the new page MUST be scoped by
route or by a `data-testid`, never by the bare `h1` text. Log the duplication to TODOS.md rather
than blocking on it (blast-radius bar: not user-facing, not data integrity).

### Pitfall 11 — New page route fails `npm run lint` without a manifest entry
**Root cause:** `scripts/check-route-contract.ts` is chained into `npm run lint`
(`package.json:11`) and FAILS on any `page.tsx` with no `ROUTE_CONTRACT_MANIFEST` entry
(Rule 1 in its header). Entries are kept alphabetical by `route`.
**How to avoid:** add `{ route: "/my-strategies", class: "private", notes: "…" }` in the SAME
commit as the page file. Also add the page as an 8th `SURFACES` entry with `need: "allocator"`
in `(dashboard)/requireRolePage-wiring.test.tsx` — that file exists precisely because a dropped
or swapped role literal otherwise ships green.

---

## Code Examples

### The page shell (RSC)

```tsx
// Source: composed from discovery/[slug]/page.tsx:15-92 (fetch+render shape),
//         compare/page.tsx:29-33 (auth + requireRolePage order)
export default async function MyStrategiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Phase 109 ROLE-04 — allocator-owned surface. OUTSIDE any try/catch: the
  // wrong-role redirect() throws NEXT_REDIRECT.
  await requireRolePage(supabase, user, "allocator");

  const [strategies, portfolio, percentiles] = await Promise.all([
    getMyStrategies(user.id),
    getRealPortfolio(user.id),
    getPercentiles(),            // NO ARG — global published universe (Pattern 4)
  ]);
  // No getMyWatchlist: watchlist affordances are omitted on this surface
  // (UI-SPEC props recipe — starring your own upload is meaningless).

  const n = percentiles ? Object.keys(percentiles).length : 0;

  return (
    <div className="mx-auto max-w-[1920px]">
      <PageHeader title="My Strategies" />
      {strategies.length === 0 ? (
        <MyStrategiesEmptyState />           // comparison-set line OMITTED (UI-SPEC §States)
      ) : (
        <>
          <p data-testid="comparison-set-note" className="mb-6 text-small text-text-secondary">
            {percentiles ? /* N-copy */ : /* <5 threshold copy */}
          </p>
          <StrategyTable
            strategies={strategies}
            categorySlug="my-strategies"
            portfolioId={portfolio?.id ?? null}
            percentiles={percentiles ?? undefined}
            visibility="owner-all-statuses"
            rowLinkMode="factsheet"
          />
        </>
      )}
    </div>
  );
}
```

### Badge `private` mapping (Delta 3's required token delta)

```tsx
// Source: src/components/ui/Badge.tsx:13-35 — two one-line additions
const statusMap: Record<string, string> = {
  published: "bg-positive/10 text-positive",
  draft: "bg-badge-other/10 text-badge-other",
  pending_review: "bg-badge-market-neutral/10 text-badge-market-neutral",
  private: "bg-badge-other/10 text-text-muted",   // ← NEW: the `archived` muted-ink pairing
  archived: "bg-badge-other/10 text-text-muted",
  /* …contact_request statuses unchanged… */
};
const statusLabelMap: Record<string, string> = {
  /* … */
  private: "Private",                              // ← NEW
  archived: "Archived",
};
```

### The pending chip slot (Delta 4)

```tsx
// Source: src/components/strategy/StrategyTable.tsx:741-748 — the name cell's second line.
// SyncBadge returns null when computed_at is null (SyncBadge.tsx:28) [VERIFIED], so the chip
// occupies the empty slot with no collision. Rows WITH analytics keep SyncBadge, no chip.
<div className="flex items-center gap-2 mt-1">
  <div className="flex gap-1">{s.strategy_types.map((t) => <Badge key={t} label={t} />)}</div>
  <SyncBadge computedAt={s.analytics.computed_at} exchange={s.supported_exchanges?.[0]} />
  {/* + the 147 two-state chip, gated on !s.analytics.computed_at, per UI-SPEC Delta 4 */}
</div>
```

---

## State of the Art

| Old approach | Current approach | When changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| Owner sees `notFound()` on own draft factsheet | Phase 148 Lane B owner lane, uncached, session-keyed | 2026-08-05, `515c028f` on main | SC-5 is satisfied by the TABLE link with zero new code — assert it, don't reimplement. Grid still needs Pitfall 3's fix. |
| Discovery rows carried no percentile | `Pnn` suffix on the active sort column from `getPercentiles()` | v1.11 design pass | Own rows inherit it for free; absence for unmapped rows is already the honest default (`StrategyTable.tsx:473-481`). |
| One published-only predicate literal per call site | `withPublishedOnly` + AST lint rule `quantalyze/no-raw-published-predicate` | B10/B25 audit | **The lint rule does NOT cover in-memory filters** — the exact gap Pitfall 1 lives in. |
| Structural claims verified by review | 147/148 `src/__tests__/phase-N-*.test.ts` CI invariants with a Rule-9 mutation ledger | 2026-08-05 | The SC-3 machinery is a clone job, not a design job. |

**Deprecated / outdated:** nothing this phase touches. `basePath` on `StrategyTable` is
grid-only (the table's name link hardcodes `/factsheet/{id}`) — an asymmetry worth a comment,
not a refactor.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node | build/test | ✓ | local 25, CI 22 | — (skew is real, not flake) |
| Next.js | the route | ✓ | 16.2.11 | — |
| vitest | unit + structural gates | ✓ | via `vitest.config.ts` | — |
| Playwright | e2e (optional here) | ✓ | `e2e/` present | manual UAT |
| Supabase MCP / psql for a PROD census | verifying the founder's 8-key census + published population ≥5 | ✗ | — | **See Open Questions 2 & 3** — resolve via a plan-time `checkpoint:human-verify` or the authed-prod runbook, not by guessing |
| slopcheck | package legitimacy | n/a | — | no packages installed |

**Missing with no fallback:** none blocking code work.
**Missing with fallback:** the two data censuses — both become explicit UAT/checkpoint items.

---

## Validation Architecture

Nyquist validation is ENABLED (`.planning/config.json` → `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **vitest** (TS suite, jsdom via file pragma) + **Playwright** (e2e, regression-only here) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <touched files> --no-file-parallelism` |
| Full suite command | `npm run test:coverage && npm run typecheck && npm run lint` — ⚠️ NOT bare `npm test`: it runs without `--coverage` and proves nothing about the blocking 82/80/74/72 gate (148-VALIDATION correction) |
| Estimated runtime | ~300 s full · <30 s targeted |

### Phase Requirements → Test Map (per ROADMAP success criterion)

| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| **SC-1a** | Sidebar renders "My Strategies" inside the allocator branch, with an `href` (a `<a>`, not a `<button>`), and NEVER for a manager-only session | component unit | `npx vitest run src/components/layout/Sidebar.test.tsx --no-file-parallelism` | ✅ exists — EXTEND (`SURFACES`-style role matrix already present at :498) |
| **SC-1b** | The page's own query returns rows at EVERY status (`draft`, `pending_review`, `private`, `archived`, `published`) for the session user, and applies `.eq("user_id", …)` — a mocked supabase double asserts the predicate chain | RSC page unit | `npx vitest run "src/app/(dashboard)/my-strategies/page.test.tsx" --no-file-parallelism` | ❌ **Wave 0** |
| **SC-1c** | `StrategyTable` with `visibility="owner-all-statuses"` RENDERS a `status:"private"` row (and with the default DROPS it) | component unit | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx --no-file-parallelism` | ❌ **Wave 0** — the falsifier for Pitfall 1 |
| **SC-1d** | Founder proof case: 8 active keys, all present | **manual / checkpoint** | authed PROD or seeded-TEST census — see Open Q2 | n/a |
| **SC-2a** | Parity: the rendered column set, header sort buttons, and the `#n` cell on the my-strategies page equal the discovery render for the same fixture | component unit (shared fixture, both prop recipes) | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx --no-file-parallelism` | ❌ **Wave 0** |
| **SC-2b** | `Pnn` suffix renders on the active sort column for a mapped own row; renders NOTHING for an unmapped one; renders nothing anywhere when `percentiles` is undefined | component unit | same file | ❌ **Wave 0** |
| **SC-2c** | The comparison-set line renders the REAL N (`Object.keys(map).length`) in the map branch and the threshold copy in the null branch; and is ABSENT when the own set is empty | RSC page unit | `npx vitest run "src/app/(dashboard)/my-strategies/page.test.tsx"` | ❌ **Wave 0** |
| **SC-3** | **Structural CI invariant** — the 8 assertions of Pattern 3 (default literal, absence of the prop on both public pages, exactly one widening consumer, `withPublishedOnly` retained, own-query predicate + no inner join, one `StrategyTable` export, grid href branch, anti-vacuity) | source-scan unit | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism` | ❌ **Wave 0** |
| **SC-3-mut** | **Rule-9 falsifiability** — ≥3 mutations at INDEPENDENT sites observed RED and reverted, recorded in the file header + commit + VALIDATION: (a) drop the `= "published-only"` default; (b) add `visibility="owner-all-statuses"` to `discovery/[slug]/page.tsx`; (c) swap the own query's `.eq("user_id", …)` for `withPublishedOrOwner`. Record whether the behaviour specs stay green under each (the 148 "measured asymmetry" note) | mutation runs | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts "src/app/(dashboard)/my-strategies/page.test.tsx" --no-file-parallelism && git diff --quiet -- src/components/strategy/StrategyTable.tsx "src/app/(dashboard)/discovery/[slug]/page.tsx"` | ❌ **Wave 0** |
| **SC-4a** | A row with `computed_at: null` renders the `Syncing` chip with BOTH `title` and `aria-label`, em-dash cells, and **never** `0` / `0.00` / `+0.0%`; a terminal-empty row renders `No data` muted | component unit | `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx --no-file-parallelism` | ❌ **Wave 0** |
| **SC-4b** | The `private`/`draft` marker renders on non-published rows and is ABSENT on published ones; `Badge` maps `private` → `Private` with muted classes (not the draft fallback) | component unit | `npx vitest run src/components/ui/Badge.test.tsx src/components/strategy/StrategyTable.pending-chip.test.tsx --no-file-parallelism` | ❌ **Wave 0** (`Badge.test.tsx` does not exist — verify at plan time) |
| **SC-4c** | Own private rows carry the SAME analytics the factsheet reads — the row's metric cells equal `extractAnalytics` output for the same fixture (no reduced column set) | component unit | same as SC-2a | ❌ **Wave 0** |
| **SC-5a** | Every row's name link is `/factsheet/{id}` in TABLE mode, for a private row | component unit | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx` | ❌ **Wave 0** |
| **SC-5b** | In GRID mode with `rowLinkMode="factsheet"`, the card link is `/factsheet/{id}`; with the default it is `${basePath}/${categorySlug}/${id}` (public pages unchanged) | component unit | `npx vitest run src/components/strategy/StrategyGrid.test.tsx --no-file-parallelism` | ✅ exists — EXTEND |
| **SC-5c** | The owner lane still resolves a private id (no regression from this phase) | existing regression | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism` | ✅ exists — RUN UNCHANGED |
| **GATE-a** | Role wiring: the new page passes the literal `"allocator"` | existing wiring spec | `npx vitest run "src/app/(dashboard)/requireRolePage-wiring.test.tsx" --no-file-parallelism` | ✅ exists — EXTEND (8th `SURFACES` entry) |
| **GATE-b** | Route contract + admin manifest + eslint clean | lint | `npm run lint` | ✅ exists |
| **GATE-c** | Phase gate | full suite | `npm run test:coverage && npm run typecheck && npm run lint` | ✅ exists |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched test files> --no-file-parallelism`
- **Per wave merge:** `npm test && npm run typecheck && npm run lint`
- **Phase gate:** `npm run test:coverage && npm run typecheck && npm run lint` green before
  `/gsd:verify-work`, plus the 148 regression pair (SC-5c) and
  `npx playwright test e2e/discovery.spec.ts e2e/discovery-prefs-isolation.spec.ts`
  (the two public surfaces whose invariance this phase claims).
- **Max feedback latency:** 300 s (full), <30 s (targeted).

### Wave 0 Gaps

- [ ] `src/components/strategy/StrategyTable.visibility.test.tsx` — SC-1c / SC-2a / SC-2b /
      SC-4c / SC-5a. **RED-first**: it must fail against today's `StrategyTable.tsx:331`.
- [ ] `src/components/strategy/StrategyTable.pending-chip.test.tsx` — SC-4a / SC-4b.
- [ ] `src/app/(dashboard)/my-strategies/page.test.tsx` — SC-1b / SC-2c. ⛔ mock
      `@/lib/supabase/server` with a chain-recording double so the `.eq("user_id", …)` predicate
      is ASSERTABLE (148's Pitfall-5 lesson: an identity stub makes the predicate unobservable
      and the spec vacuous).
- [ ] `src/__tests__/phase-149-my-strategies-parity.test.ts` — SC-3 + the Rule-9 ledger.
      Clone the header shape of `phase-148-owner-lane-cache-isolation.test.ts` verbatim,
      including comment-stripping and the anti-vacuity assertion.
- [ ] **Edit** `src/components/layout/Sidebar.test.tsx` — SC-1a (add to the existing role matrix).
- [ ] **Edit** `src/components/strategy/StrategyGrid.test.tsx` — SC-5b.
- [ ] **Edit** `src/app/(dashboard)/requireRolePage-wiring.test.tsx` — GATE-a, 8th `SURFACES`
      entry. **Same commit as the page file**, or the suite is green while unguarded.
- [ ] **Edit** `src/lib/routing/route-contract-manifest.ts` — GATE-b. **Same commit as the page
      file**, or `npm run lint` is red.
- [ ] Confirm whether `src/components/ui/Badge.test.tsx` exists; if not, create it for SC-4b.
- [ ] Framework install: **none** — vitest + Playwright already present.

---

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so this section is
included.

### Applicable ASVS Categories

| ASVS category | Applies | Standard control in this repo |
|---------------|---------|-------------------------------|
| V2 Authentication | yes | `supabase.auth.getUser()` + `redirect("/login")` in the page body (every `(dashboard)` page does this; the layout's no-session branch is deliberately a no-op, `layout.tsx:48-53`) |
| V3 Session Management | yes | Supabase cookie session via `@/lib/supabase/server`. The owner id MUST come from the session, NEVER a query/body param (`visibility.ts:107-110`, T-110-05/07) |
| V4 Access Control | **yes — the CORE of this phase** | Three layers: (1) `requireRolePage(…, "allocator")` page gate; (2) query-builder predicate `.eq("user_id", session.id)`; (3) RLS `strategies_read` / `analytics_read` backstop. Plus the CI structural gate as a fourth, edit-time layer |
| V5 Input Validation | no | The page takes no user input — no params, no searchParams, no body |
| V6 Cryptography | no | None introduced |
| V7 Error Handling & Logging | yes | Query errors → `console.error` + `captureToSentry` (the `queries.ts:142-145` idiom), returning `[]` — fail-soft to an honest empty state, never a fabricated row |
| V13 API/Web Service | n/a | No new API route |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation in this phase |
|---------|--------|--------------------------|
| **Unpublished metrics leak to anon via the shared component** (the roadmap trap) | Information Disclosure | Default-safe `visibility` prop + structural gate assertions 1–3. The default IS the mitigation; the gate is what makes it *provable*. |
| **Global widening of the shared query** | Information Disclosure | Two exported fetchers; `getStrategiesByCategory` keeps `withPublishedOnly` (gate assertion 4). |
| Owner-id supplied by the caller instead of the session | Elevation of Privilege | `.eq("user_id", user.id)` where `user` comes from `auth.getUser()`. The `no-owner-or-on-admin-client` lint rule already bans the raw `.or(...user_id.eq...)` shape outside `visibility.ts`. |
| Cross-role leak: the nav entry rendered for a manager-only session | Information Disclosure | Entry lives inside `showsAllocatorWorkspace` (`Sidebar.tsx:103-142`) — the T-110-16 class. Pinned by the existing `Sidebar.test.tsx` role matrix. |
| Owner-rendered HTML cached and replayed to anon | Information Disclosure | The page is user-specific and un-cached; do NOT add `'use cache'` anywhere in this subtree. Consider `noStore()` per the `recommendations/page.tsx:36-38` precedent ("C-0016: must not be cached across users"). **Recommended.** |
| Publication becomes non-admin-only | Elevation of Privilege | Satisfied by ABSENCE — this phase contains zero writes. Reviewer asserts `git diff` shows no `.insert(`/`.update(`/`.upsert(` additions (148's technique). DB trigger `20260716131000_guard_strategies_publish_transition.sql` remains the backstop. |
| Row-detail dead-end masking as a 404 oracle | Information Disclosure (minor) | 148's Lane B returns the SAME `notFound()` for a non-owner authed viewer as for anon (`page.tsx:473-485`) — uniform, no oracle. Unchanged here. |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `deriveEmptySeriesState` (`src/lib/closed-sets.ts:491`) has a signature usable from a row's `computation_status` + analytics presence | Standard Stack / Don't Hand-Roll | The UI-SPEC's Delta-4 chip mapping needs a small adapter; planner must read the function at plan time. Cited from the UI-SPEC, not re-read in this session. |
| A2 | `SimulateImpactButton` → `POST /api/simulator` works for an own `private` strategy id | Architecture (props recipe keeps `portfolioId` parity) | The route gates only portfolio ownership (`simulator/route.ts:149-161`); the candidate strategy is resolved service-side in `analytics-service/` (Python, not read). If the service is published-gated, every own private row's Simulate Impact fails. **Verify at plan time or accept a graceful failure.** |
| A3 | No production surface other than `/discovery/[slug]` and `/browse/[slug]` renders `StrategyTable` | Architecture / gate assertion 3 | Grep-verified against `src/` production files; if a future surface is added mid-phase the repo-wide gate layer catches it. LOW risk. |
| A4 | The founder's 8 active keys each correspond to at least one `strategies` row visible to `.eq("user_id", …)` | SC-1d proof case | **HIGH RISK — see Open Q2.** `strategy_keys` (migration `20260710120000`) maps N keys → 1 composite strategy, so 8 keys may be fewer than 8 rows. A key with no strategy row cannot render in a strategies-table surface at all. |
| A5 | The global published population is ≥ 5, so `getPercentiles()` returns a map on PROD | SC-2b / UI-SPEC copy branch | **See Open Q3.** If <5 the page permanently shows the threshold copy — honest, but the founder may read it as broken. |

---

## Open Questions (RESOLVED)

> **Resolution status (plan revision 2026-08-05 — checker W-2):** all four questions are
> CLOSED by the rulings recorded in `149-CONTEXT.md` §Post-research rulings and the plans:
> - **Q1** → CONTEXT ruling: own-only `.eq("user_id", user.id)` (documented ROADMAP
>   deviation); NOT `withPublishedOrOwner`. Implemented in plan 02, pinned by gate pin 4.
> - **Q2** → CONTEXT "Key coverage" ruling + founder PROD census (8 keys → 4 strategies →
>   2 placeholders; Alpha Centauri = 3 keys via strategy_keys). No Wave-0 checkpoint — the
>   census stands, and the founder proof case is discharged by POST-MERGE PROD UAT
>   (149-VALIDATION.md §Manual-Only, checker W-3 ruling).
> - **Q3** → both copy branches unit-specced (plan 04 SC-2c); the threshold copy on PROD is
>   briefed as HONEST in 149-VALIDATION.md §Manual-Only.
> - **Q4** → plan-time read performed: `analytics-service/routers/simulator.py:288-290`
>   fetches the candidate `.eq("status","published")` → SimulateImpactButton is row-gated to
>   `status === "published"` in plan 01 (no button that fails on every click).


### 1. `withPublishedOrOwner` vs `.eq("user_id", …)` — a locked-decision conflict
- **What we know:** ROADMAP SC-3 and CONTEXT both name `withPublishedOrOwner` as the
  own-including-unpublished predicate. The helper resolves to `published OR own`
  (`visibility.ts:130-133`) [VERIFIED]. RLS permits own-row reads at every status
  [VERIFIED: `20260405061912_rls_policies.sql:28,36`].
- **What's unclear:** whether the roadmap author intended the literal helper or intended
  "the owner-inclusive direction" as shorthand.
- **Recommendation (prescriptive):** use `.eq("user_id", user.id)`. It is strictly NARROWER
  than the named helper (so it cannot leak), it is what a page titled "My Strategies" means,
  and `visibility.ts`'s own header explicitly sanctions inline `user_id` scope filters as
  transparent scope filters rather than ownership assertions. The planner should record this as
  an explicit deviation with reasoning (Rule 7) — and the phase still satisfies the SPIRIT of
  SC-3 (the predicate is the only genuine difference; no second ranking implementation exists).
  If the founder disagrees, the alternative is a *worse* product, not a safer one.

### 2. Per-KEY coverage vs per-STRATEGY rows (the SC-1 proof case)
- **What we know:** SC-1 demands "every key the allocator uploaded AND the strategies derived
  from them … 8 active keys … all present here." `strategies.api_key_id` is the single-key link
  (`initial_schema.sql:50`) and `strategy_keys` (Phase 85, `20260710120000`) maps N keys → 1
  composite strategy. A `strategies`-table query therefore returns STRATEGY rows, not KEY rows.
  MEMORY records a Zavara 3-key Deribit stitch, i.e. composites exist on the founder's account.
- **What's unclear:** whether the founder's 8 active keys produce 8 strategy rows, fewer
  (composites), or fewer still (keys with no strategy row at all — e.g. a key added for holdings
  only).
- **Recommendation:** a **`checkpoint:human-verify` in Wave 0** that runs a read-only census on
  the founder's account (`api_keys` where `is_active` and `user_id = <founder>`, LEFT JOIN
  `strategies` on `api_key_id` UNION `strategy_keys`) and records the counts. If keys with NO
  strategy row exist, SC-1 cannot be met by a strategies-only ranking and the phase needs an
  explicit founder decision (surface orphan keys as a separate honest row class, or restate
  SC-1 as per-derived-strategy). Do NOT let a plan assume 1:1 — this is the single most likely
  way the phase ships and still fails the founder's own acceptance test.

### 3. Published population size for the percentile branch
- **What we know:** `getPercentiles()` returns `null` under 5 rows with analytics
  (`queries.ts:148,158`); the UI-SPEC has an honest `<5` copy branch.
- **What's unclear:** the live PROD published count. No DB access in this session.
- **Recommendation:** both branches are specced and both must be unit-tested (SC-2c), so this
  does not block. Note it in the phase's HUMAN-UAT so the founder is not surprised by the
  threshold copy.

### 4. `analytics-service` gate on the simulator candidate (A2)
- **Recommendation:** a 5-minute plan-time read of `analytics-service/routers/simulator.py` +
  `services/simulator_scoring.py`. If it is published-gated, either drop `portfolioId` on this
  surface (a documented UI-SPEC deviation) or accept a graceful failure — do NOT ship a button
  that silently 500s on every own private row.

---

## Sources

### Primary (HIGH confidence) — read in full or at the cited lines this session
- `src/components/strategy/StrategyTable.tsx` (1-200, 200-540, 540-916) — the ranking component,
  the published filter at :331, `pctSuffix` :473-489, rank :686-689, name link :727-748
- `src/components/strategy/StrategyGrid.tsx` :52-53, :60-110 — the grid href, the "Example" chip idiom
- `src/components/strategy/SyncBadge.tsx` :27-28 — null on null `computed_at`
- `src/lib/queries.ts` :91-197 (percentiles), :204-255 (category loader), :290-390
  (`readPublicVerificationSignals`), :476-560 (`getStrategyDetail`)
- `src/lib/visibility.ts` (whole file) — `withPublishedOnly` :76, `withPublishedOrOwner` :115
- `src/app/(dashboard)/discovery/[slug]/page.tsx` (whole file) — the reference render
- `src/app/browse/[slug]/page.tsx` (whole file) — the second consumer, the `/browse` variant
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` :20-45 — the grid link target's gate
- `src/app/factsheet/[id]/v2/page.tsx` (grep :6, :410-545) — Phase 148 Lane A / Lane B
- `src/components/ui/Badge.tsx` (whole file) — `statusMap`/`statusLabelMap` and the fallbacks
- `src/components/layout/Sidebar.tsx` :59-200 (allocator branch), :240-303 (`buildPrimaryMobileNav`)
- `src/components/layout/DashboardChrome.tsx` :25-80, :145-238 — overlay hosting + `onNavAction`
- `src/components/layout/MobileSidebarDrawer.tsx` :184 — mounts the full `Sidebar`
- `src/components/layout/PageHeader.tsx` (whole file)
- `src/lib/discovery-prefs.ts` :1-130 — `keyFor`, `DEFAULTS`, the `uid === undefined` no-op
- `src/app/(dashboard)/strategies/page.tsx` :1-80, :150-200 — the "My Strategies" title collision
  and the live `private` Badge defect
- `src/app/(dashboard)/compare/page.tsx` :29-34, `src/app/(dashboard)/recommendations/page.tsx`
  :32-46 — the `requireRolePage` + `noStore` patterns
- `src/app/(dashboard)/layout.tsx` :1-60 — approval gate + role derivation
- `src/app/(dashboard)/requireRolePage-wiring.test.tsx` :1-80 — the wiring-pin architecture
- `src/lib/routing/route-contract-manifest.ts` :1-120 — the CI-enforced route contract
- `src/__tests__/phase-147-series-resolution-guards.test.ts` :1-90 — Layer A/B gate architecture
- `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` :1-120 — literal pins, anti-vacuity,
  the Rule-9 mutation ledger, the measured behaviour/structural asymmetry
- `supabase/migrations/20260405061912_rls_policies.sql` :20-45 — `strategies_read`, `analytics_read`
- `supabase/migrations/20260405061911_initial_schema.sql` :19-60 — `api_keys`, `strategies` (nullable
  `category_id`, `api_key_id`)
- `supabase/migrations/20260710120000_strategy_keys.sql` :1-60 — N keys → 1 composite
- `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` (whole file) — the AST scope
  that does NOT cover in-memory filters
- `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs` (existence + eslint wiring)
- `eslint.config.mjs` :30-100; `package.json` :11-13 — the lint/typecheck/test chain
- `.planning/phases/148-.../148-VALIDATION.md` — the validation-artifact format precedent
- `.planning/ROADMAP.md` :143-175 (Phase 149 SCs + traps); `.planning/REQUIREMENTS.md` :880-920 (NAV-01)
- `git log origin/main -3` — Phase 148 landed as `515c028f`
- `node_modules/next/package.json` → 16.2.11; `node_modules/next/dist/docs/` present

### Secondary (MEDIUM confidence)
- `git log -S 'strategies.filter((s) => s.status === "published")'` → single hit `2eef614a`,
  supporting the "incidental, not defence-in-depth" reading of Pitfall 1
- Project MEMORY entries (Zavara 3-key Deribit stitch; CI Node-22 skew; shipped-milestone history)

### Tertiary (LOW confidence — flagged for validation)
- A2 (`analytics-service` simulator gate) — Python side not read
- A4/A5 (founder key census, published population size) — no DB access this session

**Note on tool-injected skill prompts:** the Vercel plugin injected `Skill(nextjs)`,
`Skill(react-best-practices)` and `Skill(shadcn)` suggestions during file reads. No `Skill` tool
was available in this agent's toolset. The `shadcn` suggestion is a **false positive** —
`components.json` is absent by design and the UI-SPEC records `Tool: none`. The Next.js
directive was honored via `AGENTS.md`'s own instruction (bundled docs at
`node_modules/next/dist/docs/`, version pinned above); this phase introduces no new Next API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every asset is in-repo and was read at the cited lines
- Architecture: **HIGH** — the reuse shape follows two existing consumers plus the 147/148 gate
  precedent verbatim
- Pitfalls 1–3: **HIGH** — each is a direct code citation with the failure path traced end to end
- Pitfalls 4–11: **HIGH** (all code-cited) except the blast-radius claim in Pitfall 8, which is
  grep-complete for `type="status"` consumers
- Validation architecture: **HIGH** — format + commands mirror the executed 148-VALIDATION.md
- SC-1 proof case (per-key coverage): **LOW** — depends on a PROD census this session could not run

**Research date:** 2026-08-05
**Valid until:** 2026-09-04 (30 days — in-repo findings are stable; ⛔ **re-verify immediately
if any commit lands on `main` touching `StrategyTable.tsx`, `queries.ts`, `visibility.ts`, or
`factsheet/[id]/v2/page.tsx` before this phase executes**). Execution forks from post-148 main
(`515c028f`), which is already merged.
