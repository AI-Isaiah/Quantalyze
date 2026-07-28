# Phase 29: Unified Composer Spine - Research

**Researched:** 2026-06-23
**Domain:** Next.js 16 App Router RSC/SSR data plumbing + React client-state reuse; capability absorption into an existing 2093-line composer; RLS-scoped catalog merge
**Confidence:** HIGH (every claim verified against live code, the production DB, or the project's own migrations/tests)

## Summary

Phase 29 is a **wiring / capability-absorption phase with zero new dependencies and zero schema change**. The existing own-book `ScenarioComposer` (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`) already owns every hard part: it builds `StrategyForBuilder[]` via a frozen adapter, calls the frozen `computeScenario` engine, overlays draft weights/leverage into the projection (the H-0133 fix is already landed), persists/reopens/renames/deletes named rows against the v1.1.0 `scenarios` table through RLS-scoped routes, and hosts the `StrategyBrowseDrawer`. Phase 29 adds three things on top: (1) a blank-slate entry mode + segmented control, (2) example-universe rows in the merged Browse drawer, and (3) the **example-universe `daily_returns` plumbing** that makes an added example strategy actually move the projection.

The single genuine data-plumbing decision — **SSR-lift vs lazy-fetch-on-add of the example-universe `daily_returns`** — resolves cleanly on measured production data. There are **15 published example-universe strategies** (`is_example=true AND status='published'`), each with an average **925-point `daily_returns` series (range 636–1108)**, totalling **~588 KB raw / ~87 KB gzipped**. SSR-lifting that whole set onto *every* composer load (the drawer is opened on a minority of loads, and example-add is rarer still) is wasteful bandwidth+memory for a payload most allocators never touch. **Lazy-fetch-on-add** costs ~46 KB raw / ~7 KB gzipped for the one strategy actually added, exactly mirrors the existing drawer's proven "lazy on open" contract, and — critically — the verified-strategy add path ALREADY suffers the same "no series in payload" gap (a known H-0133 limitation), so a single scoped lazy-fetch route closes the gap for BOTH catalog halves at once.

**Primary recommendation:** **Lazy-fetch-on-add via a new scoped GET route** (e.g. `GET /api/strategies/[id]/returns` or a `?include=returns` extension), reading `strategy_analytics.daily_returns` through the **RLS-scoped server client** (`createClient()`, NOT `createAdminClient()`) gated by `withPublishedOnly` — verified-feasible because the `analytics_read` RLS policy already permits any caller to read analytics for `status='published'` strategies (confirmed live: anon read of a published example strategy's analytics returns 200 + the row). The Browse `/api/strategies/browse` route is extended to *also* surface `is_example=true AND status='published'` rows (lightweight metadata only — no series), keeping the existing RLS-scoped client + `withPublishedOnly` + `displayStrategyName` guards. The composer's `addedStrategyReturnsLookup` is populated from the lazy fetch keyed by strategy id, then flows through the **unchanged** adapter + frozen engine.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Surface & Routing**
- The unified composer is the existing `ScenarioComposer` at `/allocations?tab=scenario` (canonical host). It already has the full v1.1.0 feature set wired (save/compare/share/stress/MC/optimizer) — extend it, do not fork a new route.
- Phase 29 makes the composer *support* both entry modes; the `/scenarios` `redirect()` and `ScenarioBuilder` delete are explicitly Phase 32 (hard-gated on this phase). Do NOT redirect or delete `/scenarios` in this phase.
- Entry mode is chosen via a segmented control at the top of the composer: "From my book" (default when a live book exists) / "Blank slate". A blank composer is the front door when the allocator has no book.

**Merged Catalog (Browse drawer)**
- Extend the existing `/api/strategies/browse` route to additionally surface `is_example = true AND status = 'published'` rows in the SAME response as verified strategies. One Browse drawer in the composer lists both.
- Example rows carry a clearly-distinct "Example" badge/pill (DESIGN.md token). Verified strategies keep their existing treatment.
- **RLS (LOCKED — exit gate):** the browse route keeps the RLS-scoped client + `withPublishedOnly` + `displayStrategyName` pseudonymity. It MUST NOT switch to `createAdminClient()`. A test asserts an unpublished AND a cross-tenant strategy do NOT appear even with `is_example` included, and that example rows carry the pseudonymity-safe label.

**Add Gesture & Projection**
- Clicking "Add" on a catalog row appends the strategy to the working composition and recomputes the projection immediately through the existing frozen `computeScenario` engine — no separate confirm step, no second annualization convention.
- **Example-universe `daily_returns` plumbing — DEFERRED TO RESEARCH** (this document): SSR-lift the bounded `is_example AND published` series into the composer payload vs lazy-fetch the series on add. Measure the row count, bound the set, lazy the series only if it bloats the SSR payload. Whichever path: the fetch is scoped to `is_example = true AND status = 'published'`, never an unbounded admin pull (exit gate).

**Save / Reopen Named Portfolio**
- **Persistence (LOCKED — exit gate):** reuse the v1.1.0 `scenarios` table (JSONB draft + RLS + `schema_version`). NO migration touching `scenarios` / `scenario_shares` / `get_shared_scenario` / `create_scenario_share` ships in this phase; `test_scenarios_rls.sql` + `test_scenario_shares_rls.sql` stay green; the share-RPC body-shape DO-block is untouched.
- Reuse the existing scenario save / list / rename / delete affordances already in `ScenarioComposer`. A "named portfolio" IS a saved scenario row. Surface the term "portfolio" in the unified-composer UI while persisting to `scenarios`.
- **Reopen codec trichotomy (LOCKED — success criterion 3):** reopen honors the existing decode trichotomy (ok / readonly / reset) so a drifted draft never silently empties. Reuse the existing decode logic; do not weaken it.

### Claude's Discretion
- The exact segmented-control component, badge token, and Browse-drawer layout are at the planner/implementer's discretion within DESIGN.md.
- The SSR-lift-vs-lazy-fetch data-plumbing decision is research-driven (resolved in this document — recommendation: lazy-fetch-on-add).

### Deferred Ideas (OUT OF SCOPE)
- `/scenarios` `redirect()` + `ScenarioBuilder` delete + IMPACT-02 guard migration onto the composer → **Phase 32** (hard-gated on this phase).
- Factsheet-grade graphs on the blend → **Phase 30**.
- Collapsible / graphs-lead layout → **Phase 31**.
- Bridge → composer continuity + onboarding polish + WCAG-AA audit → **Phase 33**.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UNIFY-01 | An allocator reaches a single portfolio composer — no separate Scenario tab vs Strategy Sandbox vs Portfolios pages to choose between | The composer is already a routable tab (`/allocations?tab=scenario`, `AllocationsTabs.tsx`). Phase 29 makes it the one composing surface by adding the blank-slate mode; `/scenarios` retirement is Phase 32. The empty-state branch is the blank-slate front door (relabel the existing `isEmptyState` card). |
| UNIFY-02 | Compose from a blank slate OR seeded from the live book, in the same surface | The composer already seeds from the live book (`defaultDraftFromHoldings(holdingsSummary)`). Blank slate = an empty working composition (no holdings seeded). The segmented control toggles which initial draft the composer renders; mode-switch routes through the existing reset/confirm discipline (see Pattern 1). |
| UNIFY-03 | Browse verified and example-universe strategies in one catalog, example tagged | Extend `/api/strategies/browse/route.ts` to additionally select `is_example=true AND status='published'` rows under the SAME RLS scope + `withPublishedOnly` + `displayStrategyName`. The drawer (`StrategyBrowseDrawer.tsx`) interleaves both; example rows carry the neutral-outline "Example" pill (recipe verbatim from `ScenarioBuilder.tsx:286`). |
| UNIFY-04 | Add a strategy in one gesture and see it in the projection immediately | The add gesture (`scenario.addStrategyBrowse`) + projection-overlay (`projectionState` memo) is already wired. The MISSING link is the added strategy's `daily_returns` in `addedStrategyReturnsLookup` — supplied by the recommended lazy-fetch route. With the series present, the existing engine path recomputes instantly. |
| UNIFY-05 | Save, reopen, rename, delete a named portfolio (existing `scenarios`, no schema change) | Fully built: POST/GET `/api/allocator/scenario/saved`, PATCH(rename)/PUT(update)/DELETE `/api/allocator/scenario/saved/[id]`, `SavedScenariosList.tsx`, and the composer's save toolbar + `openSavedScenario` codec-trichotomy reopen. Phase 29 only relabels copy ("scenario"→"portfolio") in the UI — zero schema/route change. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Merged catalog read (verified + example metadata) | API / Backend (`/api/strategies/browse`) | Database (RLS `strategies_read`) | A tenant-facing catalog read; RLS enforces `status='published'`; `displayStrategyName` enforces pseudonymity. Must NOT bypass to admin. |
| Example `daily_returns` on add (recommended lazy) | API / Backend (new scoped GET) | Database (RLS `analytics_read`) | Heavy series; only fetched when actually added. RLS `analytics_read` already permits published-strategy analytics reads (verified live), so no admin client. |
| Working composition state (weights/toggles/leverage/added) | Browser / Client (`useScenarioState` + localStorage) | — | Ephemeral what-if state; per-allocator-scoped localStorage; never server-persisted until "Save portfolio". |
| Projection compute (TWR/Sharpe/curve/correlation) | Browser / Client (frozen `computeScenario`) | — | Pure client-side math off raw `daily_returns`; 252-day annualization; engine is zero-diff (SCENARIO-05). |
| Named-portfolio persistence (save/list/rename/delete) | API / Backend (`/api/allocator/scenario/saved*`) | Database (`scenarios` table, RLS `scenarios_owner`) | Single-row writes under RLS; `allocator_id` always from auth; no schema change. |
| Reopen decode (ok/readonly/reset trichotomy) | Browser / Client (`scenarioDraftCodec`) | — | The drifted-draft honesty guard; runs in the composer before hydrate. |
| Entry-mode selection (book vs blank) | Browser / Client (composer + AllocationsTabs) | — | Pure UI state; chooses which initial draft renders; mode-switch routes through existing reset discipline. |

## Standard Stack

This phase installs **nothing**. Every library it touches is already a project dependency. Verified against `package.json`:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.9 | App Router RSC/SSR + route handlers | Project framework. `node_modules/next/dist/docs/` is the authoritative API source (AGENTS.md — breaking changes from training data). [VERIFIED: node_modules/next/package.json] |
| react | 19.2.4 | Client component state (`useScenarioState`, composer) | Project framework. [VERIFIED: package.json] |
| zod | 4.3.6 | Draft + request-body validation (`scenarioDraftSchema`) | Already the validator for the scenario draft + save routes. [VERIFIED: package.json] |
| @supabase/supabase-js (server client) | (project-pinned) | RLS-scoped reads via `createClient()` from `@/lib/supabase/server` | The locked client for tenant-facing reads. [VERIFIED: src/app/api/strategies/browse/route.ts:3] |

### Supporting (in-repo modules to reuse — NOT npm packages)
| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `withPublishedOnly` | `src/lib/visibility.ts` | Appends `status='published'` predicate (defense-in-depth over RLS) | On EVERY `strategies` read in this phase. [VERIFIED] |
| `displayStrategyName` | `src/lib/strategy-display.ts` | Pseudonymity-safe label (codename / institutional name / `Strategy #<id>`) | On every browse row, including example rows. [VERIFIED] |
| `computeScenario` / `buildDateMapCache` / `StrategyForBuilder` | `src/lib/scenario.ts` | The FROZEN projection engine (252-day annualization, SCENARIO-05 pins) | Reuse verbatim; zero-diff. [VERIFIED] |
| `buildStrategyForBuilderSet` | `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` | Pure projection of (holdings, addedStrategies, lookup maps) → `StrategyForBuilder[]` + `ScenarioState` | The composer already calls it; the example lookup flows through it unchanged. [VERIFIED] |
| `useScenarioState` | `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` | Draft state machine + cross-tab localStorage + `addStrategyBrowse`/`hydrateFromSaved`/`reset` | Reuse; no new mutator needed for the example-add (it is still `addStrategyBrowse`). [VERIFIED] |
| `scenarioDraftCodec` | `src/app/(dashboard)/allocations/lib/scenario-state.ts` | Decode trichotomy (ok/readonly/reset) | Reuse verbatim in the reopen path (already wired in `openSavedScenario`). [VERIFIED] |
| `StrategyBrowseDrawer` | `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | 620px slide-over, lazy-fetch on open, multi-add session | Extend (add example rows + tag); do not fork. [VERIFIED] |
| `SavedScenariosList` | `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | Open/Rename/Delete/Share/Compare list | Reuse; relabel copy. [VERIFIED] |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | Honest neutral empty/degenerate state | Reuse for below-sample-floor / degenerate states. [VERIFIED: file exists] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lazy-fetch-on-add (recommended) | SSR-lift the bounded example set into the composer payload | SSR-lift adds ~588 KB raw / ~87 KB gzipped to EVERY composer load whether or not the drawer is ever opened; lazy costs ~46 KB raw / ~7 KB gzipped only on actual add. See decision matrix below. |
| New scoped lazy route under RLS client | Extend `/api/strategies/browse` to also return `daily_returns` | Would bloat the catalog response with ~588 KB on every drawer open even when the allocator browses but adds nothing — same waste as SSR-lift, just deferred one step. Keep browse metadata-only. |
| RLS-scoped `createClient()` (LOCKED) | `createAdminClient()` (what `/scenarios` does today) | Admin bypass is the exact anti-pattern the exit gate forbids — it would leak unpublished/cross-tenant analytics and defeat `displayStrategyName`. RLS read is verified-feasible (see Pattern 3); admin is NOT needed. |

**Installation:** None. `npm install` adds nothing this phase.

## THE SSR-LIFT vs LAZY-FETCH DECISION (the flagged research question)

### Measured production evidence (live DB `khslejtfbuezsmvmtsdn`, 2026-06-23)

**Row count** — `is_example=true AND status='published'`: **15 strategies** [VERIFIED: PostgREST `content-range: 0-14/15`]. (Note: the `20260429063138_seed_is_example_backfill.sql` migration backfilled 8 *canonical* UUIDs `cccccccc-...`; production today carries 15 example rows under the `51a111ed-...` prefix — the live count, not the migration's 8, is what bounds the payload.)

**`daily_returns` series length per strategy** [VERIFIED: live `strategy_analytics` read]:
- Lengths: `[1108, 1092, 1062, 853, 636, 940, 811, 1006, 1072, 1103, 1049, 963, 679, 758, 745]`
- min **636**, max **1108**, avg **~925** points
- Shape is `DailyPoint[]` = `{date: string, value: number}` (e.g. `{"date":"2022-01-10","value":-0.007462}`) — **exactly** what the frozen engine consumes; no normalization needed. [VERIFIED: `src/lib/portfolio-math-utils.ts:11` `DailyPoint`]

**Payload weight** [VERIFIED: measured]:
| Path | Raw JSON | Gzipped | Fired when |
|------|----------|---------|-----------|
| SSR-lift ALL 15 | ~588 KB | ~87 KB (6.7× ratio) | EVERY composer SSR load |
| Lazy-fetch ONE on add | ~46 KB | ~7 KB | Only when an allocator actually adds that example strategy |

### Decision: LAZY-FETCH-ON-ADD (HIGH confidence)

Reasons, in priority order:
1. **The drawer is opened on a minority of composer loads, and example-add is rarer still.** The existing `/api/strategies/browse` route's own JSDoc states the lazy contract verbatim: *"The drawer is opened on demand (most allocators never open it on most loads). Pinning ~tens of strategy rows on every dashboard SSR is unnecessary bandwidth + latency."* SSR-lifting ~87 KB gzipped of series onto every load — for data most allocators never touch — directly contradicts a contract the codebase already chose and tested. [CITED: src/app/api/strategies/browse/route.ts:18-24]
2. **The verified-strategy add path has the IDENTICAL gap today.** `payload.strategies` is built ONLY from the allocator's `portfolio_strategies` join (their book) — it does NOT include the verified catalog or example strategies. So a browse-added strategy that is not already in the book has NO `daily_returns` in `addedStrategyReturnsLookup` and currently contributes `[]` (the warm-up gate drops it). A single scoped lazy route closes this for BOTH catalog halves at once — strictly better than an example-only SSR lift that leaves the verified-add gap open. [VERIFIED: src/lib/queries.ts:2900 `from("portfolio_strategies")`; composer lookup at ScenarioComposer.tsx:777-790]
3. **RLS read is feasible — no admin client.** The `analytics_read` policy is `EXISTS(... AND (s.status='published' OR s.user_id=auth.uid()))`. Verified LIVE: an anon (RLS) read of a published example strategy's `strategy_analytics` returns HTTP 200 + the row. So a `createClient()`-based lazy route can read example/verified series under RLS, honoring the locked "never `createAdminClient()`" gate. [VERIFIED: supabase/migrations/20260405061912_rls_policies.sql:36-42 + live anon read 200]
4. **It scales.** The example universe could grow (the seed comment anticipates the v0.16 onboarding push multiplying the catalog). Lazy is O(adds), SSR-lift is O(catalog) on every load.

### Implementation shape (for the planner)
- **New route:** `GET /api/strategies/[id]/returns` (or `/api/strategies/returns?id=`), `runtime="nodejs"`, `withAllocatorAuth`, RLS `createClient()`, `withPublishedOnly(...).eq("id", id)` existence/publish probe, then `strategy_analytics.daily_returns` for that id. Return `{ daily_returns: DailyPoint[] }` with `NO_STORE_HEADERS`. Scope = `status='published'` (covers both verified and `is_example` published rows — `is_example` is a flag, not a separate RLS gate). NEVER an unbounded pull; one id per call. Mirror the existing browse-route error redaction (no raw Postgres error) + rate-limit ordering.
- **Composer wiring:** on `addStrategyBrowse`, fire the lazy fetch for `s.id`, store the result in a client-side map (`addedReturnsById`), and feed `addedStrategyReturnsLookup` from BOTH `payload.strategies` (book strategies already present) AND the lazy map. The adapter + engine path is unchanged.
- **Honesty while loading:** before the series arrives, the added strategy contributes `[]` (warm-up-gated out) — the projection shows the strategy added but not yet contributing; surface a brief "loading returns…" affordance and recompute on arrival. Do NOT fabricate a flat/zero series.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │  Allocator browser  /allocations?tab=scenario │
                         └─────────────────────────────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────────┐
                  │                        │                           │
        [Entry-mode segmented control]     │                  [Save toolbar +
         "From my book" │ "Blank slate"     │                   SavedScenariosList]
                  │                        │                           │
                  ▼                        ▼                           ▼
   ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────────────┐
   │ useScenarioState      │   │ StrategyBrowseDrawer  │   │ POST/GET/PATCH/PUT/DEL  │
   │ (draft, addStrategy*, │   │ (merged catalog list, │   │ /api/allocator/         │
   │  hydrateFromSaved,    │◄──┤  verified + Example,  │   │   scenario/saved*       │
   │  reset, weights)      │   │  Add gesture)         │   │   (RLS scenarios table) │
   └──────────┬───────────┘   └──────────┬───────────┘   └───────────┬────────────┘
              │                          │ on Add(id)                 │
              │              ┌───────────▼────────────┐               │
              │              │ GET /api/strategies/    │               │
              │              │   browse  (metadata)    │──RLS─►strategies (published,
              │              │ GET .../[id]/returns    │       is_example or verified)
              │              │   (lazy daily_returns)  │──RLS─►strategy_analytics
              │              └───────────┬────────────┘
              │                          │ {daily_returns}
              ▼                          ▼
   ┌─────────────────────────────────────────────────────┐
   │ addedStrategyReturnsLookup  (book + lazy-fetched)     │
   │            │                                          │
   │            ▼                                          │
   │ buildStrategyForBuilderSet (pure adapter, UNCHANGED)  │
   │            │  StrategyForBuilder[] + ScenarioState    │
   │            ▼                                          │
   │ projectionState overlay (draft weights/leverage)      │
   │            ▼                                          │
   │ collapseAliasedHoldingStrategies → buildDateMapCache  │
   │            ▼                                          │
   │ computeScenario  (FROZEN — 252d, SCENARIO-05)         │
   │            │  ComputedMetrics + portfolio_daily_returns│
   │            ▼                                          │
   │ KpiStrip · EquityChart · DrawdownChart · Corr · etc.  │
   └─────────────────────────────────────────────────────┘
```

A reader can trace the primary use case (add an example strategy → see projection): drawer Add → lazy `/[id]/returns` → lookup map → unchanged adapter → frozen engine → KPI/chart refresh.

### Recommended Project Structure (files this phase touches)
```
src/app/api/strategies/
├── browse/route.ts                 # EXTEND: also select is_example=true AND published rows
├── browse/route.test.ts            # EXTEND: cross-tenant + unpublished leak test WITH is_example; example-row pseudonymity
└── [id]/returns/route.ts           # NEW: scoped lazy daily_returns under RLS client (recommended path)
src/app/(dashboard)/allocations/
├── components/ScenarioComposer.tsx # EDIT: entry-mode control, blank-slate empty state, lazy-returns wiring, "portfolio" copy
├── components/StrategyBrowseDrawer.tsx # EDIT: render example rows + "Example" pill; relabel title; client-side filter over both
├── components/SavedScenariosList.tsx   # EDIT: "Saved portfolios" / "Save portfolio" copy only
└── AllocationsTabs.tsx             # (likely) EDIT: surface the segmented control / blank-slate front door for no-book allocators
```
No new file is mandatory except the recommended lazy route. (`scenario-blend-panels.ts` belongs to Phase 30, NOT here.)

### Pattern 1: Entry-mode toggle routed through the existing reset discipline
**What:** "From my book" renders the default draft seeded from `defaultDraftFromHoldings(holdingsSummary)`; "Blank slate" renders an empty working composition (no holdings seeded) into which catalog adds accumulate.
**When to use:** the segmented control at the top of the composer body.
**Critical reuse:** a mode switch that would discard in-progress edits MUST route through the existing reset/confirm path (`handleReset` → `scenario.reset()` + the `ResetConfirmationModal`), not a silent wipe. The composer already centralizes reset so `loadedScenarioId` never goes stale.
```typescript
// Source: VERIFIED — src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:517-528
// Every reset path routes through handleReset so loadedScenarioId can never go stale.
const handleReset = useCallback(() => {
  scenario.reset();            // removeStored + re-init to default; clears banner
  setLoadedScenarioId(null);
  // ...clear notices/readonly flags
}, [scenario.reset]);
```

### Pattern 2: Add-gesture → unchanged adapter → frozen engine (the projection already moves)
**What:** the H-0133 fix is landed: `projectionState` overlays `scenario.draft.weightOverrides` (and `leverageByRef`) onto the adapter's strategies BEFORE `computeScenario`, so a re-weighted/added strategy actually changes the projection.
**When to use:** the example-add path reuses this verbatim — the ONLY new input is the added strategy's `daily_returns` in the lookup.
```typescript
// Source: VERIFIED — src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:891-942
const projectionState = useMemo(() => { /* selected/weights/leverage from draft */ }, [...]);
const deAliased = useMemo(() => collapseAliasedHoldingStrategies(adapterOutput.strategies, projectionState, symbolByHoldingId), [...]);
const dateMapCache = useMemo(() => buildDateMapCache(deAliased.strategies), [deAliased]);
const scenarioMetrics = useMemo(() => computeScenario(deAliased.strategies, deAliased.state, dateMapCache), [deAliased, dateMapCache]);
```

### Pattern 3: RLS-scoped catalog read with pseudonymity (the LOCKED browse contract)
**What:** the browse route reads `strategies` via `createClient()` (RLS-scoped) + `withPublishedOnly(...)`, then maps each row's display label through `displayStrategyName`. Extending it for `is_example` adds rows of the SAME shape under the SAME guards — `is_example` is just a column to co-fetch and tag, NOT a reason to bypass RLS.
**When to use:** the `/api/strategies/browse` extension AND the new lazy-returns route.
```typescript
// Source: VERIFIED — src/app/api/strategies/browse/route.ts:98-119,157-182
const supabase = await createClient();                 // RLS-scoped (NOT createAdminClient)
const { data } = await withPublishedOnly(
  supabase.from("strategies").select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"),
).order("name").limit(STRATEGY_BROWSE_LIMIT + 1);
// ...map: name = displayStrategyName({ id, name, codename, disclosure_tier }) — pseudonymity preserved on example rows too
```
**RLS feasibility proof:** `analytics_read` = `EXISTS(SELECT 1 FROM strategies s WHERE s.id = strategy_analytics.strategy_id AND (s.status='published' OR s.user_id=auth.uid()))`. A live anon read of a published example strategy's analytics returned HTTP 200 + the row. [VERIFIED: supabase/migrations/20260405061912_rls_policies.sql:36-42 + live]

### Pattern 4: Reopen decode trichotomy (already wired — reuse, do not weaken)
**What:** `openSavedScenario` decodes `row.draft` through `scenarioDraftCodec(defaultDraft).decode(...)` and branches: `reset` → honest "older format" notice, NO hydrate; `readonly` → hydrate + adopt id + block Update; `ok` → hydrate + adopt id (editable).
```typescript
// Source: VERIFIED — src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:545-573
const decoded = scenarioDraftCodec(defaultDraft).decode(JSON.stringify(row.draft));
if (decoded.outcome === "reset")   { /* notice; refuse open; never hydrate */ }
if (decoded.outcome === "readonly"){ scenario.hydrateFromSaved(decoded.value); /* adopt id + block Update + notice */ }
/* ok */                            scenario.hydrateFromSaved(decoded.value); /* adopt id, editable */
```

### Anti-Patterns to Avoid
- **`createAdminClient()` on the catalog / returns read** — the `/scenarios` page does this today (`page.tsx:58`) and it is the exact anti-pattern the exit gate forbids. RLS read is feasible (Pattern 3); never carry the admin pattern into the composer. The phase is NOT migrating `/scenarios` (that's Phase 32), so leave `page.tsx` untouched — just do not copy its admin-client approach.
- **SSR-lifting the example series into the composer payload** — ~87 KB gzipped on every load for rarely-used data; contradicts the codebase's own lazy-on-open contract.
- **A second annualization convention** — the engine uses √252 / ×252 throughout; any new series feeds the SAME `computeScenario`. Never add a √365 path.
- **Editing `src/lib/scenario.ts`** — frozen (SCENARIO-05). The example-add path needs ZERO engine change; the series flows through the unchanged adapter.
- **A fabricated zero/flat series while the lazy fetch is in flight** — leave it `[]` (warm-up-gated out) and surface an honest loading affordance; do not invent data.
- **A `scenarios` schema migration** — forbidden this phase. Save/list/rename/delete already work on the existing table; "portfolio" is a UI relabel only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Projection math (TWR/Sharpe/Sortino/curve/correlation) | A new compute path for blended example strategies | `computeScenario` (frozen) via the unchanged adapter | 252-day convention, sample-std, leverage `wᵢ·Lᵢ·rᵢ`, include-from windowing are all SCENARIO-05-pinned. A second path = a second convention. |
| Draft state + persistence | A new add/weight/toggle state machine | `useScenarioState` + `scenario-state.ts` pure mutators | Dedupe-guard, renormalize-to-1, cross-tab sync, fingerprint-mismatch, codec trichotomy are all built + tested. |
| Named-portfolio CRUD | A new table / RPC / route | `/api/allocator/scenario/saved*` + `scenarios` table | RLS-scoped, body-validated, rate-limited, audit-logged, error-redacted. Schema change is a forbidden red flag. |
| Pseudonymity on catalog rows | Custom name redaction for example rows | `displayStrategyName` | The exact guard tested in browse `route.test.ts` (T12a-e); example rows must pass it too. |
| Published-only predicate | A raw `.eq("status","published")` | `withPublishedOnly` | The B25 lint rule bans raw published predicates and points offenders here; defense-in-depth over RLS. |
| Lazy series transport / drawer behavior | A new drawer / fetch lifecycle | Extend `StrategyBrowseDrawer` (lazy-on-open, AbortController, multi-add) | The drawer's fetch lifecycle (abort on close, error-vs-empty, dim-after-add) is already hardened (H-0117 / H-0082b / review-P2). |
| Reopen decode safety | A bare `JSON.parse(row.draft) as ScenarioDraft` | `scenarioDraftCodec` | M-0153: an unchecked cast flows a drifted blob into the running draft; the trichotomy is the success-criterion-3 guard. |

**Key insight:** Phase 29 is ~90% wiring of already-built, already-tested primitives. The only genuinely new server code is one scoped lazy-returns route; the only genuinely new client code is the entry-mode control + lazy-returns plumbing + copy relabels. Building anything custom for compute/state/persistence is a regression risk against a frozen, test-pinned core.

## Runtime State Inventory

> This is a wiring phase, not a rename/migration phase — but it touches data-access scoping, so the relevant runtime-state question is "what stores/serves the example-universe series, and does the new path reach it under RLS?"

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.daily_returns` (JSONB) for 15 published example strategies; avg 925 points; shape `{date,value}` = `DailyPoint`. `scenarios` table (migration `20260621120000`) stores named portfolios as JSONB drafts. | None — reuse both. Lazy route reads `strategy_analytics`; save routes write `scenarios`. No data migration. |
| Live service config | None — no external service config embeds anything Phase-29-specific. | None. |
| OS-registered state | None — no cron/worker/scheduler change (the Railway analytics worker is untouched; this is a frontend+route phase). | None. |
| Secrets/env vars | Reads `NEXT_PUBLIC_SUPABASE_URL` + RLS via the standard server client. NO new secret. (Service-role key is NOT used by any new code — RLS read only.) | None. |
| Build artifacts / installed packages | Zero new deps; no egg-info / binary / image-tag change. | None — `npm install` adds nothing. |

**RLS reachability (the load-bearing inventory fact):** the `analytics_read` policy permits the RLS-scoped client to read `strategy_analytics` for any `status='published'` strategy (example or verified). Verified live (anon read 200). The new lazy route therefore needs NO admin client.

## Common Pitfalls

### Pitfall 1: Carrying the `/scenarios` admin-client pattern into the composer
**What goes wrong:** the implementer copies `/scenarios/page.tsx`'s `createAdminClient()` (RLS-bypassed) to fetch example `daily_returns`, defeating `withPublishedOnly` + `displayStrategyName` and risking unpublished/cross-tenant leak.
**Why it happens:** `/scenarios` is the obvious reference for "how example strategies are fetched today" and it uses admin.
**How to avoid:** use `createClient()` (RLS). Verified-feasible: `analytics_read` permits published reads. The `/scenarios` admin approach exists because that page predates the tightened contract; do NOT replicate it (and do NOT edit `/scenarios` — that's Phase 32).
**Warning signs:** any `createAdminClient` import in a Phase-29 diff; the browse/returns route NOT calling `withPublishedOnly`.

### Pitfall 2: The catalog-merge RLS leak test goes vacuous
**What goes wrong:** the test asserts example rows appear but does NOT assert that an unpublished AND a cross-tenant strategy stay ABSENT *with `is_example` included* — so a future RLS widening or a stray `.or(is_example.eq.true)` leaks them silently and the test still passes.
**Why it happens:** `is_example` feels like an additive "include more" filter; the implementer adds rows without proving the exclusions still hold.
**How to avoid:** extend `route.test.ts` (which mocks rows via `STATE.strategyRows` + observes `STATE.observedFilters.status`) with a case that includes an unpublished example row and a cross-tenant row in the source set and asserts neither reaches the response, AND that an example row's `name` === its pseudonymity-safe label (codename / `Strategy #<id>`), never the raw name. [VERIFIED: route.test.ts T3 observes status filter; T12a-e pin displayStrategyName]
**Warning signs:** the new test only checks presence, never absence; no positive-control proving the exclusion is real.

### Pitfall 3: Touching the `scenarios` schema or share RPC
**What goes wrong:** the implementer thinks "named portfolio" needs a new column/table/RPC and ships a migration — breaking `test_scenarios_rls.sql` / `test_scenario_shares_rls.sql` or the share-RPC body-shape DO-block.
**Why it happens:** "portfolio" sounds like a new entity.
**How to avoid:** a named portfolio IS a `scenarios` row. Save/list/rename/delete already exist (`/api/allocator/scenario/saved*`). "Portfolio" is a UI copy relabel only. ANY migration touching `scenarios`/`scenario_shares`/`get_shared_scenario`/`create_scenario_share` is a red flag this phase. [CITED: ROADMAP Phase 29 Exit Gates]
**Warning signs:** a new file under `supabase/migrations/` in a Phase-29 diff.

### Pitfall 4: Example-add silently contributes nothing (the data gap)
**What goes wrong:** an example strategy is added but the projection doesn't change, because `addedStrategyReturnsLookup` has no series for it (it's not in `payload.strategies`, which is book-only) — the warm-up gate drops the empty series and the allocator sees a no-op add.
**Why it happens:** the existing browse-add for verified strategies works ONLY when the strategy is already in the book; the example universe never is.
**How to avoid:** the lazy-returns route + a client-side `addedReturnsById` map feeding the lookup is the fix. Verify with a test: add an example strategy, resolve the lazy fetch, assert `scenarioMetrics.n > 0` and the curve changed. Until the fetch resolves, show an honest "loading returns…" state, not a flat curve.
**Warning signs:** added example strategy with `daily_returns: []` reaching the adapter and being warm-up-gated out with no UI signal.

### Pitfall 5: Mode-switch silently wipes an in-progress draft
**What goes wrong:** toggling "From my book" ↔ "Blank slate" discards weight/leverage/added edits without the reset confirmation.
**Why it happens:** the naive implementation re-initializes the draft on segment change.
**How to avoid:** route a discarding mode-switch through the existing `handleReset` + `ResetConfirmationModal` discipline (the same path commit-success / banner-reset use). [VERIFIED: ScenarioComposer.tsx:517-528 + resetModalOpen state]
**Warning signs:** a segment `onClick` that calls `scenario.reset()` (or re-seeds) without the confirmation gate when `diffCount > 0`.

## Code Examples

### Extending the browse SELECT for example rows (under the SAME RLS scope)
```typescript
// Source: VERIFIED pattern from src/app/api/strategies/browse/route.ts:109-119
// Co-fetch is_example so the response can TAG example rows; status='published'
// stays enforced by withPublishedOnly + RLS. NO createAdminClient. NO is_example
// filter that would bypass published. Example rows are just published rows that
// ALSO carry is_example=true; they flow through displayStrategyName like any other.
const { data, error } = await withPublishedOnly(
  supabase
    .from("strategies")
    .select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"),
)
  .order("name", { ascending: true })
  .limit(STRATEGY_BROWSE_LIMIT + 1);
// row.is_example drives the "Example" tag client-side; row.name → displayStrategyName(...)
```

### Lazy returns route (recommended new file, RLS-scoped)
```typescript
// Source: composed from VERIFIED conventions in browse/route.ts + saved/route.ts
// GET /api/strategies/[id]/returns — scoped, published-only, RLS client, no admin.
export const runtime = "nodejs";
export const GET = withAllocatorAuth(async (req, user) => {
  const id = /* await ctx.params.id, isUuid-validate → 400 if bad */;
  // rate-limit AFTER validation (B15 ordering), per-user key
  const supabase = await createClient();                // RLS — NOT createAdminClient
  // existence + published probe (defense-in-depth over RLS):
  const { data: strat } = await withPublishedOnly(
    supabase.from("strategies").select("id").eq("id", id),
  ).maybeSingle();
  if (!strat) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
  const { data, error } = await supabase
    .from("strategy_analytics").select("daily_returns").eq("strategy_id", id).maybeSingle();
  if (error) { /* console.error + captureToSentry + static 500 envelope (no raw error) */ }
  const daily_returns = Array.isArray(data?.daily_returns) ? data!.daily_returns : [];
  return NextResponse.json({ daily_returns }, { status: 200, headers: NO_STORE_HEADERS });
});
```

### The "Example" pill (verbatim recipe from ScenarioBuilder)
```tsx
// Source: VERIFIED — src/components/scenarios/ScenarioBuilder.tsx:286 (the Example-universe pill recipe)
// Neutral outline, NOT accent (accent = verified/action), NOT a filled Badge.
<span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted">
  Example
</span>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Example strategies fetched via `createAdminClient()` (RLS-bypassed) on `/scenarios` | RLS-scoped `createClient()` + `withPublishedOnly` for the merged composer catalog/returns | Phase 29 (this phase) | Closes the admin-bypass surface for the unified path; `/scenarios` legacy admin path retired in Phase 32. |
| Added-strategy weights reached only the COMMIT diff (slider didn't move projection) | `projectionState` overlays draft weights/leverage before `computeScenario` (H-0133 fix) | Already landed (pre-29) | Phase 29 inherits a working add→projection path; only the example `daily_returns` supply is new. |
| Two separate surfaces: own-book `ScenarioComposer` + example-universe `ScenarioBuilder` | One composer supports both entry modes + a merged catalog | Phase 29 | The unification spine; `ScenarioBuilder`/`/scenarios` not deleted until Phase 32. |

**Deprecated/outdated:**
- The `20260429063138_seed_is_example_backfill.sql` migration's "8 canonical UUIDs" is stale relative to production (15 example rows under a different prefix today). Bound the payload from the LIVE count (15), not the migration's 8.
- `/scenarios/page.tsx` `createAdminClient()` is the legacy pattern; do not propagate it. (Leave the file itself for Phase 32.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The recommended lazy route shape is `GET /api/strategies/[id]/returns`; exact path/name is planner discretion within the RLS+scope constraints. | SSR-vs-Lazy / Code Examples | Low — any scoped, RLS, published-only single-id route satisfies the gate; path is cosmetic. |
| A2 | `AllocationsTabs.tsx` is the integration point for surfacing the blank-slate front door to no-book allocators (segmented control lives in the composer body, but the no-book entry may need a tab-level nudge). | Project Structure / UNIFY-01 | Low — composer-internal empty-state already handles the no-book branch; the tab edit may prove unnecessary. Verify during planning. |
| A3 | A brief "loading returns…" affordance is acceptable UX while the lazy fetch is in flight (vs. blocking the Add). | Pitfall 4 / Implementation shape | Low — matches the drawer's existing async posture; if product wants instant, SSR-lift is the fallback (measured, still feasible at 87 KB gzip). |

**Note:** The two load-bearing measurements (15 rows; ~925-pt series; 588 KB raw / 87 KB gzip) are VERIFIED against the live production DB, not assumed.

## Open Questions (RESOLVED)

1. **Does any allocator already hold an example-universe strategy in their book?**
   - What we know: `payload.strategies` is book-only; if an example strategy is in a book, its series IS already in the payload and the lazy fetch would be redundant for that id.
   - What's unclear: whether this overlap occurs in practice (example strategies are demo data; real books may never contain them).
   - Recommendation: feed `addedStrategyReturnsLookup` from BOTH `payload.strategies` AND the lazy map (payload wins when present). Costs nothing; handles the overlap for free. No need to resolve before planning.

2. **Should the lazy fetch be batched if an allocator multi-adds quickly?**
   - What we know: the drawer supports multi-add in one session; each add could fire one `/[id]/returns`.
   - What's unclear: whether N rapid adds warrant a batch endpoint.
   - Recommendation: ship per-id (simplest, matches the one-id-per-call scope gate); a batch endpoint is a later optimization only if rapid multi-add proves painful. Per-id keeps the "never an unbounded pull" gate trivially satisfied.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase production DB (`khslejtfbuezsmvmtsdn`) | Measuring example-universe row count + series (research) | ✓ | — | — |
| RLS `analytics_read` policy permits published reads | Lazy-returns route under RLS client | ✓ (verified live: anon read 200) | — | If RLS ever tightened to deny published analytics reads, fall back to a SECURITY DEFINER RPC scoped to `status='published'` (NOT admin client) — but this is not needed today. |
| Next.js 16 App Router route handlers | New scoped GET route | ✓ | 16.2.9 | — |
| Existing `scenarios` table (migration 20260621120000) | Save/reopen named portfolio | ✓ | — | — |
| `@vitest/coverage-v8` gate (lines 82 / fns 74 / branches 72) | CI blocking gate (CLAUDE.md tech-debt #11) | ✓ | — | New routes/components must carry tests or coverage may regress below the ratchet. |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** RLS-policy dependence (above) — fallback is a published-scoped SECDEF RPC, not currently needed.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react (frontend); pgTAP-style `.sql` tests for RLS (`supabase/tests/`) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72) |
| Quick run command | `npx vitest run <file>` (single file, fast) |
| Full suite command | `npm test` / `npm run test:coverage` (blocking CI gate `frontend-coverage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UNIFY-03 | Browse merges example rows; unpublished + cross-tenant stay ABSENT with `is_example` included; example rows pseudonymity-safe | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ✅ extend existing |
| UNIFY-04 | Add example strategy → lazy returns resolve → projection `n>0` and curve changes | unit | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.*.test.tsx` | ⚠️ Wave 0 (add example-add projection test) |
| UNIFY-04 | Lazy `/[id]/returns` route: RLS client, published-only, 404 on unpublished, no raw error, no admin client | unit | `npx vitest run src/app/api/strategies/[id]/returns/route.test.ts` | ❌ Wave 0 (new route + test) |
| UNIFY-02 | Mode-switch with dirty draft routes through reset confirmation (no silent wipe) | unit | `npx vitest run` (composer test) | ❌ Wave 0 |
| UNIFY-05 | Save/reopen/rename/delete named portfolio; reopen honors ok/readonly/reset | unit | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx` + `SavedScenariosList.test.tsx` | ✅ extend (copy relabel assertions) |
| Exit gate | No `scenarios`/share migration; `test_scenarios_rls.sql` + `test_scenario_shares_rls.sql` green | sql/CI | run the supabase test suite + `git diff --stat supabase/migrations/` (must be empty) | ✅ exists |
| Exit gate | Frozen engine zero-diff (SCENARIO-05) | CI diff | `git diff --exit-code src/lib/scenario.ts` + `npx vitest run src/lib/scenario.test.ts` | ✅ exists |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` (the route or component just edited).
- **Per wave merge:** `npm test` (full vitest) + the supabase `.sql` RLS tests.
- **Phase gate:** full suite green + `git diff` clean on `src/lib/scenario.ts` and `supabase/migrations/` before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/app/api/strategies/[id]/returns/route.test.ts` — new lazy-returns route (RLS, published-only, 404, redaction, no admin) — covers UNIFY-04 server side
- [ ] Example-add projection test in the composer suite (add → resolve lazy → `n>0`, curve changed) — covers UNIFY-04 client side
- [ ] Mode-switch-with-dirty-draft reset-confirmation test — covers UNIFY-02
- [ ] Extend `browse/route.test.ts`: unpublished + cross-tenant ABSENT with `is_example` included; example row name === pseudonymity-safe label — covers UNIFY-03 exit gate
- [ ] Framework install: none — Vitest + pgTAP already present.

## Security Domain

> `security_enforcement` is not explicitly `false` in config — section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAllocatorAuth` wraps every new/edited route (role gate IN ('allocator','both')). [VERIFIED pattern] |
| V3 Session Management | yes (indirect) | Supabase auth cookies via the server client; `NO_STORE_HEADERS` on every response so allocator payloads never hit a shared cache. |
| V4 Access Control | yes | RLS `strategies_read` (`status='published' OR owner`), `analytics_read` (published-or-owned), `scenarios_owner` (`allocator_id=auth.uid()`). `withPublishedOnly` is defense-in-depth. NEVER `createAdminClient()` on these tenant reads. |
| V5 Input Validation | yes | `zod` (`scenarioDraftSchema`, save body schema with byte caps + entry caps); `isUuid` validation on `[id]` route params (→ 400). |
| V6 Cryptography | no | No new crypto. (Share-token HMAC/sha256 is Phase 25 and untouched here.) |

### Known Threat Patterns for {Next.js 16 RSC + Supabase RLS}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Pseudonymity leak (real strategy name on exploratory rows) | Information Disclosure | `displayStrategyName` on every browse row, including example rows; tested (browse T12a-e). |
| RLS bypass via admin client on a tenant read | Elevation / Info Disclosure | Use `createClient()` (RLS); `withPublishedOnly` defense-in-depth; the exact exit-gate the phase enforces. |
| Cross-tenant / unpublished strategy in the merged catalog | Info Disclosure | RLS + `withPublishedOnly`; non-vacuous absence test with `is_example` included. |
| Unbounded analytics pull (enumeration / DoS) | DoS / Info Disclosure | One-id-per-call lazy route, `withAllocatorAuth` + per-user rate-limit; browse keeps the `LIMIT 200+1 has_more` cap. |
| Storage-poison via oversized draft on save | DoS | Existing `MAX_DRAFT_BODY_BYTES` (256 KB) + zod entry caps on the save route — unchanged, reused. |
| Raw Postgres error leakage | Info Disclosure | console.error + `captureToSentry` + static UI envelope on every error path (existing browse/saved pattern). |

## Sources

### Primary (HIGH confidence)
- Live production Supabase DB `khslejtfbuezsmvmtsdn` (REST/PostgREST via service-role for count + anon for RLS feasibility) — example-universe count (15), series lengths, payload bytes, RLS read feasibility (anon 200). 2026-06-23.
- `src/app/api/strategies/browse/route.ts` + `route.test.ts` — RLS-scoped client, `withPublishedOnly`, `displayStrategyName`, lazy-on-open JSDoc, LIMIT cap, test structure.
- `src/lib/scenario.ts` — frozen engine signature, 252-day annualization, `StrategyForBuilder`/`ComputedMetrics`/`portfolio_daily_returns`.
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` + `scenario-state.ts` + `hooks/useScenarioState.ts` — adapter signature, `AddedStrategy` shape (no `daily_returns`), mutators, codec trichotomy.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `addedStrategyReturnsLookup` build (777-790), `projectionState` overlay (891-918), engine call (939-942), reopen trichotomy (545-573), empty-state (1236-1291), save toolbar (1313+), `handleReset` (517-528).
- `src/app/api/allocator/scenario/saved/route.ts` + `[id]/route.ts` — `scenarios` CRUD on the existing table, RLS-scoped, no migration.
- `src/lib/queries.ts` — `MyAllocationDashboardPayload.strategies` is book-only (`portfolio_strategies` join, 2900+); does NOT include example/verified catalog.
- `supabase/migrations/20260405061912_rls_policies.sql` — `strategies_read` / `analytics_read` policies (published-or-owned).
- `supabase/migrations/20260429063138_seed_is_example_backfill.sql` — example-universe origin (8 canonical UUIDs; live count now 15).
- `src/components/scenarios/ScenarioBuilder.tsx:286` — the neutral-outline "Example universe" pill recipe to mirror.
- `node_modules/next/package.json` (16.2.9), `package.json` (react 19.2.4, zod 4.3.6) — version verification.

### Secondary (MEDIUM confidence)
- `node_modules/next/dist/docs/` — Next 16 route-handler / caching guides (consulted for the lazy-route shape; AGENTS.md mandates reading these before route code).

### Tertiary (LOW confidence)
- None — every claim is grounded in code, the live DB, or the project's own migrations/tests.

## Metadata

**Confidence breakdown:**
- SSR-vs-lazy recommendation: HIGH — measured against the live production DB (15 rows, 925-pt avg, 588 KB / 87 KB gzip) + the codebase's own lazy contract + RLS feasibility verified live.
- Reuse map (engine/state/persistence/codec/drawer): HIGH — every primitive read directly in the current source; all are landed + test-pinned.
- RLS-scoped lazy-returns feasibility: HIGH — policy text + a live anon-read 200 confirm it.
- Pitfalls: HIGH — derived from the locked exit gates + the actual data-flow gaps observed in code (book-only payload, H-0133 history).

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable — the example-universe count may grow with onboarding; re-measure the row count before SSR-vs-lazy is reconsidered, but the recommendation is robust to growth since lazy scales O(adds)).
