# Phase 100: Optimizer Sleeve + Favorites UX + Notes + KPI Panel — Research

**Researched:** 2026-07-12
**Domain:** Next.js dashboard UX + Supabase RLS storage (reuse-heavy; almost entirely internal codebase)
**Confidence:** HIGH on infra locations; MEDIUM on the exact PI-05 target site (the TODOS-named site is stale — see Open Questions)

## Summary

This phase is overwhelmingly a **reuse + wiring** phase, not a build phase. Three of the four load-bearing assets already exist in the codebase and were located with file:line precision:

- **PI-04 (Notes):** `user_notes` **already exists as a shipped, multi-scope, RLS-hardened table** (migrations `20260412094453_user_notes.sql` + `20260421060316_user_notes_multiscope.sql`), with a full `/api/notes` GET/PATCH endpoint, ownership layer, autosave hook, and RLS tests. The CONTEXT.md "locked decision" that PI-04 needs **a NEW `user_notes` table** is **factually contradicted by the codebase** — the table is live with 4 scopes (`portfolio | holding | bridge_outcome | strategy`). PI-04 is a **new consumer** (an allocator-dashboard Notes widget) wired to existing infra, and a migration is needed **only if** a new `scope_kind` is required (the CHECK constraint currently rejects anything outside the 4 kinds).
- **PI-05 (optimizer sleeve + favorites):** The optimizer exists end-to-end (`/api/portfolio-optimizer` → `runPortfolioOptimizer` → Python analytics → `suggestions[]`), rendered by `PortfolioOptimizer.tsx`. **BUT** the TODOS-named target — the "hardcoded 10% favorites sleeve" in `computeFavoritesOverlayCurve` — **does not exist under that name in the current tree** (removed/refactored during v1.6 series-space purification). Favorites data exists (`user_favorites` table + `/api/watchlist/[strategyId]`) but is **not rendered anywhere in `/allocations`**. This is the phase's biggest planning risk.
- **PI-06 (PortfolioKPIRow fold):** `PortfolioKPIRow` renders 4 centered `Card`s in a grid (the DESIGN.md "3+ cards in a row" anti-pattern), used in exactly **one** place (`portfolios/[id]/page.tsx:291`). The current shared-panel reference is **`KpiStrip.tsx`** (not `FundKPIStrip`, which no longer exists). Low blast radius.

**Primary recommendation:** Treat this phase as "wire 3 existing systems into the demo surface + one CSS-grade KPI refactor." Before planning PI-05, **Fable/planner must resolve which surface is the demo-hero target** — the optimizer/favorites/`PortfolioKPIRow` all live on the older `/portfolios/[id]` detail page, while Phase 98/99 built the exposure widgets on `/allocations`. These are two different pages. The plan changes materially depending on the answer.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **PI-04 storage:** a NEW `user_notes` table — owner-scoped RLS (`user_id = auth.uid()`), secretless, SECDEF-free reads (user client). Migration discipline (timestamp > latest, hardened, migration-reviewer + rls-auditor, test-project MCP catch-up before merge). **⚠️ RESEARCH CONTRADICTION: `user_notes` already exists (see PI-04 findings). This locked decision must be revised — the table is NOT new. Flagged for user/Fable confirmation.**
- **PI-05 optimizer:** use the EXISTING optimizer (do NOT build a new one) — replace the hardcoded 10% sleeve with its real output. Research must LOCATE the optimizer + the hardcoded-10% site. **Optimizer LOCATED; hardcoded-10% site NOT FOUND under the TODOS name — see Open Questions Q1.**
- **PI-06:** fold `PortfolioKPIRow` into the existing shared-panel pattern (removes the divergent bespoke surface) — additive/no-regress to existing KPI rendering.
- **Invariants:** no-invented-data (honest-empty), SC-4 additive (existing dashboard byte-identical), worker-only decryption (notes carry no secrets), DESIGN.md conformance.

### Claude's Discretion (DELEGATED to Fable UI-SPEC + planner)
- Notes widget UX (edit/save/autosave, markdown vs plain, per-strategy vs per-dashboard scope, empty state).
- Favorites sorting/grouping/bulk-toggle interaction model + KPI narrative tooltip copy.
- Optimizer-sleeve presentation (how the real allocation renders vs the old 10% placeholder).
- Reuse-vs-build for each; DESIGN.md tokens.

### Deferred Ideas (OUT OF SCOPE)
- Options-MTM (Phases 101/102); any new optimizer algorithm.
- No exposure widgets (Phase 99, done).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PI-04 | Notes widget persists per-allocator `user_notes` (new storage, owner-scoped RLS, no secret surface) | Existing `user_notes` table + `/api/notes` + `useNoteAutoSave` + ownership layer fully located (see PI-04). New work = new widget consumer + possible `scope_kind` addition. |
| PI-05 | Hardcoded 10% favorites sleeve → real optimizer output; favorites sort/group + bulk toggle + KPI narrative tooltips | Optimizer path + `OptimizerSuggestion` shape + `user_favorites`/watchlist located. Target render site is stale — see Open Questions Q1. |
| PI-06 | `PortfolioKPIRow` folds into the shared-panel pattern | `PortfolioKPIRow.tsx` + sole consumer + `KpiStrip.tsx` fold-target located. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Notes persistence + RLS | Database (`user_notes`) | API (`/api/notes` owner gate) | Owner-only rows; RLS is the DB-layer defense, app-layer per-scope ownership is defense-in-depth |
| Notes widget (edit/autosave) | Browser (client component) | Frontend Server (RSC initial fetch) | Autosave is client-interactive; initial content can hydrate from an RSC read |
| Optimizer computation | API/Backend (Python analytics) | Frontend Server (route proxy) | Optimizer is a 3–8s Python round-trip — never client-side |
| Favorites toggle/store | Database (`user_favorites`) | API (`/api/watchlist`) | Owner-scoped PK `(user_id, strategy_id)`; idempotent upsert |
| Favorites sort/group/bulk UX | Browser (client component) | — | Pure client interaction over already-fetched favorites |
| KPI strip render | Frontend Server (RSC) | Browser (tooltips) | KPI values are server-computed; tooltips are client chrome |

## Standard Stack

This phase adds **no new external packages.** Everything is internal or already-installed.

### Core (existing internal assets — reuse, do not rebuild)
| Asset | Location | Purpose |
|-------|----------|---------|
| `user_notes` table (multi-scope) | `supabase/migrations/20260421060316_user_notes_multiscope.sql` | Owner-scoped notes; columns `(id, user_id, scope_kind, scope_ref, content, updated_at, created_at)` |
| `/api/notes` GET+PATCH | `src/app/api/notes/route.ts` | Sole notes consumer; body `{scope_kind, scope_ref, content}`; 100KB cap; `notesUpsertLimiter` |
| Notes autosave hook | `src/components/notes/useNoteAutoSave.ts` | Debounced save + save-state indicator (reuse for the widget) |
| Notes render/status | `src/components/notes/NoteRender.tsx`, `NoteSaveStatus.tsx` | Existing plain-text render + "Saved Ns ago" |
| Scope-ref helpers | `src/lib/notes/scope-ref.ts`, `src/lib/notes/ownership.ts` | `checkScopeOwnership` + holding-ref parse/build |
| Optimizer route | `src/app/api/portfolio-optimizer/route.ts` | POST `{portfolio_id}` → `{status, suggestions[]}`; CSRF+approval+ownership+5/min limiter |
| Optimizer client | `src/lib/analytics-client.ts:235` `runPortfolioOptimizer(portfolioId, userId, timeoutMs)` | 15s timeout; token-refund on 5xx |
| Optimizer response schema | `src/lib/analytics-schemas.ts:93` `PortfolioOptimizerResponseSchema` | `.passthrough()` wrapper; `suggestions` open-shaped |
| Optimizer UI + suggestion type | `src/components/portfolio/PortfolioOptimizer.tsx:11` `OptimizerSuggestion` | `{strategy_id, strategy_name, corr_with_portfolio, sharpe_lift, dd_improvement, score}` |
| Favorites table + RLS | `supabase/migrations/20260409202757_user_favorites.sql` | PK `(user_id, strategy_id)`; owner-only SELECT/INSERT/UPDATE/DELETE |
| Favorites API | `src/app/api/watchlist/[strategyId]/route.ts` | PUT `{action: add\|remove}`; idempotent upsert |
| `PortfolioKPIRow` (fold source) | `src/components/portfolio/PortfolioKPIRow.tsx` | 4 centered `Card`s: AUM / MTD TWR / Avg Correlation / Portfolio Sharpe |
| `KpiStrip` (fold target) | `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | Shared-panel KPI strip: YTD TWR / Sharpe / Max DD 12m / Avg \|ρ\|; honest-empty + warm-up copy |
| Demo-hero dashboard | `src/app/(dashboard)/allocations/page.tsx` + `AllocationsTabs.tsx` + `HoldingsTabPanel.tsx` | Phase-99 threaded `exposure` prop via `Promise.all` (page.tsx:56–97) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reuse `user_notes` scopes | New `dashboard` scope_kind | Only needed if per-dashboard note ≠ per-portfolio/per-strategy; adds a migration (CHECK constraint change) |
| Reuse `KpiStrip` | New shared panel | `KpiStrip` already IS the DESIGN.md-aligned pattern; building a new one re-introduces the anti-pattern |

**Installation:** None. No `npm install`. No new external dependencies.

## Package Legitimacy Audit

**N/A — this phase installs zero external packages.** All assets are internal (existing tables, routes, components) or already-installed (Next.js, zod, Supabase client). No registry lookups required.

## Architecture Patterns

### System Data Flow (Notes widget — PI-04)

```
Allocator on /allocations dashboard
        │
        ▼
  [Notes widget]  ──GET /api/notes?scope_kind=&scope_ref=──▶ RLS(user_id=auth.uid) ──▶ user_notes row
        │                                                                                    │
   type + debounce (useNoteAutoSave)                                                         │
        │                                                                                    ▼
        └──PATCH /api/notes {scope_kind,scope_ref,content}──▶ checkScopeOwnership ──▶ upsert ON CONFLICT
                                                                (app-layer)          (user_id,scope_kind,scope_ref)
                                                                                              │
                                                              trigger user_notes_set_updated_at ──▶ "Saved Ns ago"
```

### System Data Flow (Optimizer sleeve — PI-05)

```
Dashboard ──POST /api/portfolio-optimizer {portfolio_id}──▶ CSRF ▶ approval-gate ▶ ownership(TS RLS-bypass)
                                                                                         │
                                                              5/min limiter (refund on 5xx)
                                                                                         ▼
                                          runPortfolioOptimizer(portfolioId, user.id, 15s) ──▶ Python analytics
                                                                                         │
                                          PortfolioOptimizerResponseSchema.parse ◀── {status, suggestions[]}
                                                                                         │
                                          PortfolioOptimizer.tsx renders OptimizerSuggestion[]
```

### Anti-Patterns to Avoid
- **Re-creating `user_notes`.** It exists. A new table/migration for the base notes store is wasted work and a schema-drift risk.
- **`PortfolioKPIRow`'s 4-cards-in-a-row.** DESIGN.md rejects it (TODOS.md:461–466). The fold's entire point is to remove it — do not port the grid-of-Cards visual into the new surface.
- **Spreading `suggestions` into a write.** The schema is `.passthrough()` and open-shaped (`analytics-schemas.ts:97`) by design — read specific fields, never persist the raw object (lint rule `quantalyze/no-passthrough-on-ipc` is sanctioned-excepted only for the read wrapper).
- **Client-side optimizer.** It's a 3–8s Python round-trip behind a 15s timeout — always server-proxied, rate-limited.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Notes persistence | New table + RLS + endpoint | `user_notes` + `/api/notes` + `useNoteAutoSave` | Fully shipped, RLS-hardened, autosave + save-state solved |
| Notes owner check | Inline `.eq('user_id',...)` | `checkScopeOwnership` (`src/lib/notes/ownership.ts`) | Per-scope validity predicates already encoded |
| Favorites toggle | New endpoint | `/api/watchlist/[strategyId]` | Idempotent upsert + CSRF + rate-limit already solved |
| Optimizer invocation | New Python call | `runPortfolioOptimizer` (`analytics-client.ts:235`) | Timeout, token-refund, schema-parse all handled |
| KPI honest-empty / warm-up copy | New null handling | `KpiStrip` cells | `formatPercent`/`formatNumber` render `—`; warm-up + stale precedence encoded |

**Key insight:** The demo-hero framing makes this feel like greenfield UX; it is not. The scarce work is (a) resolving the target-surface ambiguity, (b) locating the actual current favorites-sleeve render site, and (c) a CSS-grade KPI refactor. The storage and compute tiers are done.

## Runtime State Inventory

> This phase touches storage + a possible migration, so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `user_notes` rows exist in prod schema (production had **0 rows** as of 2026-04-20 per migration 071 header comment; may have grown since). Scopes: `portfolio\|holding\|bridge_outcome\|strategy`. `user_favorites` rows keyed `(user_id, strategy_id)`. | If PI-04 adds a new `scope_kind`, existing rows are untouched (additive CHECK change). No data migration for reuse of existing scopes. |
| Live service config | None — no external service embeds phase strings. | None (verified: no Railway/n8n/OS config references `user_notes`/favorites). |
| OS-registered state | None. | None. |
| Secrets/env vars | None — notes/favorites carry no secrets; worker-only-decryption invariant untouched (these reads return metadata only). | None. |
| Build artifacts | `src/lib/database.types.ts` (generated) already contains `user_notes` (line 2790) with the **multi-scope shape**. If a migration adds a `scope_kind`, regenerate types. | Regenerate `database.types.ts` only if the migration changes the table. |

**Migration timestamp note:** The latest migration on this branch is `20260714090000_portfolio_recompute_inflight_unique.sql` (verified via `ls -t supabase/migrations/`). Any NEW PI-04 migration (only if a scope_kind is added) must exceed that. Migrations auto-apply to prod on merge — route through migration-reviewer + rls-policy-auditor + test-project MCP catch-up per the standing invariant.

## Common Pitfalls

### Pitfall 1: Planning a "new `user_notes` table" that already exists
**What goes wrong:** CONTEXT.md locks "a NEW `user_notes` table"; a plan following it verbatim writes a `CREATE TABLE user_notes` migration that collides with the shipped table (or, worse, a differently-named parallel table fragmenting notes storage).
**Why it happens:** The requirement predates the Phase-08 multi-scope notes work; TODOS.md:509–511 still lists NotesWidget as needing storage "(Supabase table or localStorage)".
**How to avoid:** Reuse `user_notes`. Decide only the `scope_kind`/`scope_ref` for the dashboard widget. Add a migration **only** to extend the `scope_kind` CHECK constraint if a genuinely new scope is required.
**Warning signs:** A plan task named "create user_notes table."

### Pitfall 2: PI-05 targeting a render site that no longer exists
**What goes wrong:** A plan task says "edit `computeFavoritesOverlayCurve`" — that symbol is absent from the current tree (grep returns nothing in non-test source). Task fails at execution or silently edits the wrong thing.
**Why it happens:** The v1.6 series-space purification + ScenarioComposer refactor removed/renamed the old favorites-overlay path; the "sleeve" concept now appears as the ScenarioComposer "added sleeve" (`scenario-state.ts:617`, #528), a different mechanism.
**How to avoid:** Re-locate the **actual current** favorites-sleeve render before planning PI-05 (see Open Questions Q1). Note that `user_favorites` is **not currently rendered in `/allocations` at all**.
**Warning signs:** Any file:line citation for the sleeve that comes from TODOS.md rather than a live grep.

### Pitfall 3: Folding `PortfolioKPIRow` breaks the `/portfolios/[id]` detail page
**What goes wrong:** `PortfolioKPIRow` consumes `PortfolioAnalytics` (`total_aum`, `return_mtd`, `avg_pairwise_correlation`, `portfolio_sharpe`); `KpiStrip` consumes a **different** shape (`ytd_twr`, `sharpe`, `max_drawdown_12m`, `avg_correlation` — `KpiStrip.tsx` `KpiStripAnalytics`). A naive fold silently maps MTD→YTD or drops AUM (KpiStrip intentionally dropped the AUM cell per Phase-64 PRESENT-01).
**Why it happens:** The two strips were designed for different pages with different metric sets.
**How to avoid:** Treat the fold as an adapter, not a swap. Map fields explicitly, decide AUM's fate (KpiStrip has 4 return-form cells, no AUM), get design sign-off on the `/portfolios/[id]` visual change (TODOS.md:465).
**Warning signs:** Byte-identity regression on `/portfolios/[id]` KPI values.

### Pitfall 4: SC-4 byte-identity on the existing dashboard
**What goes wrong:** Adding a Notes widget / favorites section perturbs the Phase-99 exposure section or the polled payload, breaking SC-4 additive.
**How to avoid:** Additions must be new sections/props, not edits to the `Promise.all` payload in `page.tsx:56` or the `exposure` prop threading (`AllocationsTabs {...payload} exposure={exposure}` at page.tsx:97). Notes/favorites read via their own endpoints, not the polled dashboard payload.

## Code Examples

### Existing owner-scoped RLS (the model to preserve for PI-04)
```sql
-- Source: supabase/migrations/20260421060316_user_notes_multiscope.sql:103
CREATE POLICY user_notes_select_own ON user_notes FOR SELECT
  USING (user_id = auth.uid());
-- INSERT/UPDATE/DELETE mirror the same predicate. This ALREADY matches the
-- allocator_holdings_owner_select model the CONTEXT asked to emulate.
```

### Existing multi-scope contract (the API the widget calls)
```
// Source: src/app/api/notes/route.ts:16
// PATCH body: { scope_kind, scope_ref, content }
// GET query:  ?scope_kind=<kind>&scope_ref=<ref>
// scope_kind: portfolio | holding | bridge_outcome | strategy
// Ownership enforced per-scope via checkScopeOwnership (app) + RLS (db).
```

### Optimizer suggestion shape (what PI-05 renders)
```typescript
// Source: src/components/portfolio/PortfolioOptimizer.tsx:11
export type OptimizerSuggestion = {
  strategy_id: string;
  strategy_name: string;
  corr_with_portfolio: number | null;
  sharpe_lift: number | null;
  dd_improvement: number | null;
  score: number | null;
};
```
Note: the optimizer returns **strategy suggestions with correlation/Sharpe-lift/DD-improvement scores**, NOT a normalized weight vector. If PI-05's "real optimizer output replacing a 10% sleeve" expects **weights**, the weight-producing path is a *different* endpoint (`/api/optimize-weights`, Phase 28 OPT-01/02 — see `analytics-schemas.ts` "weight-optimizer contract" ~line 100, `weights` strict/null). Fable must confirm which optimizer output the sleeve should show (suggestions vs weights).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `computeFavoritesOverlayCurve` hardcoded 10% sleeve | Absent — refactored away | v1.6 series-space purification (~2026-07-04) | PI-05 target site must be re-discovered |
| `FundKPIStrip` reference (per TODOS.md:464) | `KpiStrip.tsx` (Phase 09.1/64) | Phase 64 PRESENT-01 (AUM cell dropped) | PI-06 folds into `KpiStrip`, not `FundKPIStrip` |
| `user_notes` portfolio-only (migration 037) | multi-scope `(scope_kind, scope_ref)` (migration 071) | Phase 08 (2026-04-21) | PI-04 reuses existing multiscope store |

**Deprecated/outdated (in TODOS.md, do not trust as file:line):**
- `computeFavoritesOverlayCurve` — symbol absent from current source.
- `FundKPIStrip` — absent; superseded by `KpiStrip`.
- "user_notes storage (Supabase table or localStorage)" (TODOS.md:510) — storage already shipped.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS) + pytest (Python analytics); RLS via `supabase/tests/test_*.sql` |
| Config file | `vitest.config.ts` (coverage gate: lines 82/stmts 80/fns 74/branches 72) |
| Quick run | `npm run test -- <path>` (use `--no-file-parallelism` for live-DB contention flakes) |
| Full suite | `npm run test:coverage` (blocking CI gate) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | Exists? |
|-----|----------|-----------|---------|---------|
| PI-04 | Owner-scope RLS: user A cannot read user B's note | SQL RLS | `supabase/tests/test_user_notes_*.sql` | ⚠️ Extend — `src/__tests__/user-notes-multiscope-rls.test.ts` exists (vitest live-DB, SKIPs in CI per MEMORY); the **CI-authoritative** gate must be a `supabase/tests/test_*.sql` file. If a new `scope_kind` is added, add an RLS SQL test for it. |
| PI-04 | Notes widget renders + autosaves | render (vitest) | `npm run test -- src/.../NotesWidget.test.tsx` | ❌ Wave 0 (new widget) |
| PI-05 | Sleeve renders real optimizer suggestions, honest-empty on none | render | `npm run test -- <sleeve>.test.tsx` | ❌ Wave 0 |
| PI-05 | Favorites sort/group/bulk-toggle interaction | render | `npm run test -- <favorites>.test.tsx` | ❌ Wave 0 |
| PI-06 | `PortfolioKPIRow` fold preserves values on `/portfolios/[id]` | render/regression | `npm run test -- src/components/portfolio/*KpiStrip*.test.tsx` | ❌ Wave 0 — assert field mapping (MTD vs YTD, AUM fate) |

### Sampling Rate
- **Per task commit:** `npm run test -- <touched test>` (+ `npm run lint` — react-hooks errors escape tsc+vitest per MEMORY).
- **Per wave merge:** `npm run test:coverage`.
- **Phase gate:** full suite green + `supabase/tests/` RLS green (CI-authoritative, NOT the SKIP-in-CI vitest live-DB test) before verify-work.

### Wave 0 Gaps
- [ ] `supabase/tests/test_user_notes_<scope>.sql` — CI-authoritative RLS owner-scope proof (only if a new scope_kind lands; existing scopes already covered by migration DO-block + the SKIP-in-CI vitest test).
- [ ] `NotesWidget.test.tsx` (or reuse existing notes component tests) — dashboard consumer.
- [ ] Favorites-sleeve + favorites-UX render tests.
- [ ] `PortfolioKPIRow`→`KpiStrip` fold field-mapping regression test.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `user_notes`/`user_favorites` owner-only RLS (`user_id = auth.uid()`) + app-layer `checkScopeOwnership`; optimizer route `assertPortfolioOwnership` (explicit `.eq`, RLS-bypass-proof) |
| V5 Input Validation | yes | `/api/notes` 100KB byte-cap + 200KB request cap + `scope_kind` CHECK; zod schema on optimizer response |
| V6 Cryptography | no | Notes/favorites carry no secrets; worker-only-decryption invariant untouched |
| V2/V3 Auth/Session | reuse | Supabase auth cookie + `assertSameOrigin` CSRF on all mutating routes |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR on notes/favorites | Elevation | RLS owner-gate + per-scope ownership; never trust client scope_ref (holding refs parsed by strict regex, 403 on malformed) |
| Notes content abuse (huge payloads) | DoS | 200KB request cap before parse + 100KB content cap + `notesUpsertLimiter` |
| Optimizer hammering | DoS | 5/min/user limiter with 5xx token-refund (`portfolio-optimizer/route.ts:66`) |
| Info leak via optimizer error | Info disclosure | Opaque error envelope; internal URLs/tracebacks logged not returned (route.ts:143) |

## Project Constraints (from CLAUDE.md / AGENTS.md)
- **Next.js is NON-STANDARD** (AGENTS.md): breaking changes vs training data — read `node_modules/next/dist/docs/` before writing App Router / RSC / async-API code. Heed the injected cache-components skill.
- **Coverage is a blocking CI gate** (lines 82/stmts 80/fns 74/branches 72) — new widgets need tests to not regress the ratchet.
- **DESIGN.md governs all visual decisions** — read before the KpiStrip fold and Notes/favorites UX; the 4-cards-in-a-row is an explicit anti-pattern.
- **Migrations auto-apply to prod on merge** — hardened + migration-reviewer + rls-policy-auditor + test-project MCP catch-up.
- **RLS/SQL gates must be `supabase/tests/test_*.sql`** — `*_live.py` and `skipIf(!HAS_LIVE_DB)` vitest tests SKIP in CI (MEMORY).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The demo-hero surface for PI-05/06 is `/allocations` (not `/portfolios/[id]` where the optimizer/favorites/`PortfolioKPIRow` currently live) | Open Questions Q2 | Wrong surface → entire PI-05/06 plan mis-targeted |
| A2 | The "10% sleeve" the CONTEXT means is a favorites-driven equity-curve overlay, now removed | PI-05 / Q1 | If it means something else (e.g. a ScenarioComposer added-sleeve), the edit site differs |
| A3 | Existing `user_notes` scopes suffice for the dashboard note (no new `scope_kind` → no migration) | PI-04 | If a `dashboard` scope is required, a CHECK-constraint migration is needed |
| A4 | "Real optimizer output" = `OptimizerSuggestion[]` (correlation/Sharpe-lift), not a weight vector | Code Examples / Q3 | If weights are wanted, the target is `/api/optimize-weights`, a different contract |
| A5 | Production `user_notes` may now hold rows (was 0 on 2026-04-20) — additive changes are safe regardless | Runtime State | Low — additive CHECK change is safe either way |

## Open Questions

1. **Where is the current favorites-sleeve render site?** `computeFavoritesOverlayCurve` (TODOS.md:467) is absent from source. `user_favorites` exists but is not rendered in `/allocations`. **Recommendation:** Before PI-05 planning, do a fresh grep for the live favorites overlay (candidates: `PortfolioEquityCurve.tsx` `overlayCurve` prop on `/portfolios/[id]`; ScenarioComposer). Do not cite TODOS line numbers as file:line in the plan.
2. **Which page is the demo-hero target — `/allocations` or `/portfolios/[id]`?** The optimizer (`PortfolioOptimizer.tsx`), favorites overlay, and `PortfolioKPIRow` all live on `/portfolios/[id]`; Phase 98/99 built exposure on `/allocations`. **Recommendation:** Confirm with user/Fable. If the answer is "migrate the portfolio-detail intelligence onto `/allocations`," the phase is substantially larger than a wiring phase.
3. **Suggestions vs weights for the sleeve?** `/api/portfolio-optimizer` returns scored *suggestions*; `/api/optimize-weights` returns a *weight vector*. **Recommendation:** Fable picks based on what "replace the 10% sleeve" should visually show.
4. **Does the dashboard note need a new `scope_kind`?** Reusing `portfolio`/`strategy` scope avoids a migration; a `dashboard`/global scope requires one. **Recommendation:** Prefer reusing `portfolio` scope keyed to the allocator's default portfolio, or add one `dashboard` scope in a single additive migration if a truly page-global note is wanted.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python analytics service | Optimizer round-trip | ✓ (prod + Railway worker) | — | Route already degrades: 504 timeout / 503 unreachable with token-refund |
| Supabase (Postgres + RLS) | Notes/favorites storage | ✓ | — | — |
| Test Supabase project (`qmnijlgmdhviwzwfyzlc`) | RLS SQL tests | ✓ | — | MCP catch-up before merge |

No missing blocking dependencies. The optimizer's Python dependency already has honest-degradation paths.

## Sources

### Primary (HIGH confidence — direct codebase reads)
- `supabase/migrations/20260412094453_user_notes.sql` + `20260421060316_user_notes_multiscope.sql` — notes schema/RLS/scopes
- `src/app/api/notes/route.ts` — notes API contract
- `src/lib/notes/scope-ref.ts`, `src/lib/notes/ownership.ts` — scope model
- `src/app/api/portfolio-optimizer/route.ts`, `src/lib/analytics-client.ts:235`, `src/lib/analytics-schemas.ts:93` — optimizer path + schema
- `src/components/portfolio/PortfolioOptimizer.tsx:11` — `OptimizerSuggestion` shape
- `src/components/portfolio/PortfolioKPIRow.tsx` + `src/app/(dashboard)/portfolios/[id]/page.tsx:291` — fold source + sole consumer
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx` — fold target
- `src/app/(dashboard)/allocations/page.tsx:56–97` — Phase-99 exposure threading
- `supabase/migrations/20260409202757_user_favorites.sql`, `src/app/api/watchlist/[strategyId]/route.ts` — favorites store + API
- `ls -t supabase/migrations/` → latest `20260714090000_portfolio_recompute_inflight_unique.sql`

### Secondary (MEDIUM — stale, cross-checked against source)
- `TODOS.md:461–511` — described the intent but names (`computeFavoritesOverlayCurve`, `FundKPIStrip`) are stale vs current source

## Metadata

**Confidence breakdown:**
- Notes infra (PI-04): HIGH — table/API/hook/RLS read directly.
- Optimizer infra (PI-05): HIGH for the compute path; MEDIUM for the render target (site stale).
- KPI fold (PI-06): HIGH — source, consumer, and target all located.
- Target-surface ambiguity: flagged as the top open question, MEDIUM.

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (stable internal code; re-verify the PI-05 render site at plan time — it is the one moving part)

## RESEARCH COMPLETE
Phase 100 is a reuse/wiring phase: `user_notes` (PI-04) and the optimizer (PI-05) and `KpiStrip` (PI-06) all already exist — the two must-resolve risks before planning are (1) the CONTEXT's "new user_notes table" is factually already-built, and (2) the demo-hero surface + the actual favorites-sleeve render site are ambiguous/stale and must be pinned by Fable/planner.
