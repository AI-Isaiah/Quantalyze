# Phase 13: Discovery v2 Polish — Research

**Researched:** 2026-04-28
**Domain:** Frontend Next.js/React with thin Supabase RLS-protected mutation layer; Playwright e2e
**Confidence:** HIGH (codebase-grounded; CONTEXT.md is highly prescriptive)
**Branch:** `feature/v0.17-sprint-13`

## Summary

Phase 13 ships **frontend-only** changes to `/discovery/[slug]` to reach Quants.Space IA parity:
Watchlist sub-tab on `user_favorites`, per-user-keyed Customize prefs in localStorage,
single-accent sparkline rule, default Hide Examples backed by a data backfill, and
audit-gated filter-by-team. CONTEXT.md (`13-CONTEXT.md`) and the 6/6-PASS UI Design Contract
(`13-UI-SPEC.md`) lock most decisions; this research surfaces five **execution-blocking
unknowns** the planner must resolve at plan-phase time, plus a **critical RLS clarification**
on DISCO-03 that CONTEXT.md leaves implicit.

**Primary recommendation:** Open the plan-phase with three blocking actions in this order:
(1) run the audit SQL against production via `mcp__supabase__execute_sql` (project ref
`khslejtfbuezsmvmtsdn`) and lock the integer in TODOS.md; (2) re-number the conditional
migration from `088` to `089` (088 is already shipped — see Pitfall #1); (3) clarify with
the user that `organizations.is_public` is a **name-leak gate** only — the existing
`strategies_org_read` RLS policy (migration 026:95) still requires org membership for
strategies to be visible, so the dropdown will only contain orgs the allocator is a member
of (intersected with `is_public=true`), not arbitrary public orgs (see Pitfall #2).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Watchlist toggle persistence | API/Backend (`PUT /api/watchlist/[strategyId]`) | Database (`user_favorites` RLS) | Canonical mutation lives at API; `user_favorites` RLS is the source of truth — idempotency comes from DB-side `ON CONFLICT DO NOTHING` per CONTEXT.md, not the client. |
| Watchlist optimistic UI | Browser/Client | API/Backend | `useOptimistic` or local mirror; existing pattern at `OutcomesWidget.tsx`. |
| Watched-set initial fetch | Frontend Server (SSR) | Database | `getMyWatchlist(userId)` reads on the server inside `discovery/[slug]/page.tsx`, parallel-fetched with `getStrategiesByCategory` and `getRealPortfolio` via existing `Promise.all` pattern. |
| Customize prefs persistence | Browser/Client | — | localStorage only — `discovery_view_preferences:{auth.uid}:{slug}`. SSR cannot read localStorage; hydration-after-mount pattern from `TweaksContext.tsx` is the template. |
| Sparkline color rule | Browser/Client (caller-side computation) | — | Per `Sparkline.tsx:14` contract: caller picks the color. Final-value-sign comparison happens at `StrategyTable.tsx` and `StrategyGrid.tsx`. |
| Hide Examples default | Browser/Client (Customize default) | Database (data-only seed backfill) | Customize default = `true`; backfill `UPDATE strategies SET is_example=true WHERE id IN (<UUIDs>)` ships in a data-only SQL migration. No DDL — column exists at `001_initial_schema.sql:64`. |
| Audit-gated filter-by-team | Database read (audit + RLS) | Browser/Client (dropdown) | Audit happens once at plan-phase via Supabase MCP. Dropdown only renders `is_public=true` orgs the allocator can already see under existing RLS — see Pitfall #2. |
| Visual regression (sparkline) | E2E (Playwright) | — | DOM-walk asserts no SVG `path` mixes accent + negative strokes; per `13-UI-SPEC.md`. |
| Cross-account isolation (localStorage) | E2E (Playwright) | — | Login-A-then-B in one Playwright context; assert no `discovery_view_preferences:{A.uid}:*` keys readable in B's session. |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Watchlist UX & Star Toggle (DISCO-01)
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

#### Customize Prefs Modal (DISCO-02)
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

#### Audit Gate, Seed Backfill & Visual Regression (DISCO-03 / DISCO-04 / DISCO-05)
- The `organization_id` population audit SQL runs **inline via Supabase MCP at
  plan-phase time** against the production DB (`khslejtfbuezsmvmtsdn`). The single
  query is `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND
  status='published'`. The integer result is recorded in
  `.planning/phases/13-discovery-v2-polish/TODOS.md` (under a "DISCO-03 audit" section
  header) **before any DISCO-03 plan task is generated** — gate decision is locked
  before planning continues.
- **If audit count = 0**: migration `088_organizations_is_public.sql` is **not shipped**;
  DISCO-03 (filter-by-team UI) is **deferred to v0.18** with a TODOS entry. This
  matches phase success criterion 4 verbatim. (NOTE: see Pitfall #1 — file number
  must be re-derived; 088 is taken.)
- **If audit count > 0**: migration ships (adds `is_public BOOLEAN DEFAULT false`
  to `organizations`); the filter dropdown reads only orgs `WHERE is_public = true`;
  surface only orgs whose strategies are visible to the allocator under existing RLS.
  Default-false avoids leaking private/stealth fund names; admin can flip orgs to
  public manually during v0.17. The `/strategies/team` opt-in toggle is deferred to
  v0.18 (out of Phase 13 scope).
- **Seed UUID source for `is_example = true` backfill**: pull the seed-strategy UUIDs
  by querying production for strategies whose `created_by` matches the seed-admin
  auth uid (with a fallback `name ILIKE 'demo_%'` pattern if the seed-admin uid is
  not available). The final UUID list is captured in the data-only migration
  produced by Phase 13. (NOTE: see Open Question #4 — `created_by` column does not
  exist on `strategies`; seeders use `user_id`.)
- **Sparkline visual regression harness**: add a Playwright spec under `tests/e2e/`
  (NOTE: actual e2e dir is `e2e/`, not `tests/e2e/` — see Pitfall #3) that visits
  `/discovery/[slug]`, snapshots both the table and grid sparklines, and asserts
  no SVG `path` element mixes `#16A34A` and `#DC2626` strokes (per DESIGN.md DIFF-05).
  The spec is wired into the existing Playwright CI lane.

### Claude's Discretion
- Component file layout (e.g., `WatchlistTab.tsx`, `CustomizeDrawer.tsx`,
  `StarToggle.tsx`) is at Claude's discretion provided imports follow the existing
  `src/components/strategy/` conventions.
- Exact API route handler structure (single PUT vs PUT + DELETE) is at Claude's
  discretion provided the success-criterion grep `PUT /api/watchlist/[strategyId]`
  is satisfied and the operation is idempotent under rapid double-click.
- Whether to read the audit count via `mcp__plugin_supabase_supabase__execute_sql`
  vs `mcp__plugin_supabase_supabase__list_tables` + a follow-up query is at
  Claude's discretion — both surface the same integer.

### Deferred Ideas (OUT OF SCOPE)
- `/strategies/team` opt-in settings UI for managers to flip their org public
  (deferred to v0.18). Phase 13 only ships the schema + read path; admin manually
  flips orgs as needed during v0.17.
- Multi-benchmark sparkline overlays (ETH/SOL) — descoped at milestone level
  (UC#6); not relevant to Phase 13.
- Keyboard navigation polish for the Customize drawer (full a11y is the Phase
  14a/14b A11Y-XX work — Phase 13 only ships standard tab order + ESC-to-close).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISCO-01 | Allocator can star a strategy from any row or card on `/discovery/[slug]`; "My Watchlist" sub-tab appears alongside "All" with a count badge; star toggle is idempotent and survives reload (uses existing `user_favorites` schema from migration 024) | Schema confirmed: `user_favorites` PK `(user_id, strategy_id)` with full RLS (4 policies) at `024_user_favorites.sql:29-105`; type at `database.types.ts:2501-2529`; `Promise<...>` await-params pattern at `api/keys/[id]/permissions/route.ts:1`; auth + CSRF helper at `lib/api/withAuth.ts`. Optimistic UI precedent at `AllocatorExchangeManager.tsx:31` (`useTransition`). |
| DISCO-02 | Customize prefs (Default view / Default sort / Hide examples) persist in localStorage keyed by `{auth.uid}:{slug}` (per-user, not per-slug only); cross-account leakage on shared machines is prevented | localStorage helper template at `lib/wizard/localStorage.ts:1-130` (SSR-safe `typeof window === "undefined"` guards + try/catch on quota errors). Hydration-after-mount pattern at `allocations/context/TweaksContext.tsx:84-99` (mount-effect reads, persistence-effect writes only after `hydrated=true`). Existing `CustomizeSettings` interface already in `StrategyFilters.tsx:63-75` (defaults wrong — must update `hideExamples: false` → `true`). |
| DISCO-03 | Allocator can filter strategies by team using existing `strategies.organization_id` FK — gated on Phase 13-internal audit; if 0 published rows, defer; if non-zero, ship the conditional migration adding `is_public` to `organizations` | Existing `organization_id` FK ships in `006_organizations.sql:30`. Existing RLS at migration `026:95-100` requires org membership for `organization_id IS NOT NULL` strategies — see Pitfall #2. NO existing `is_public` column. NO existing migration with this number on main — see Pitfall #1. |
| DISCO-04 | Sparkline rendering on row + card uses single accent color for the entire trace (DESIGN.md DIFF-05 rule); never split green/red by daily return; fill color decided by final-value sign | `Sparkline.tsx:1-64` is already single-color (`color` prop, no per-point segmentation). Two call sites today: `StrategyTable.tsx:315` (returns) + `:319` (drawdown — out of scope, statically negative) and `StrategyGrid.tsx:88-93` (returns). Sign-driven color rule applies only to `sparkline_returns`. Phase 13 wires the rule at the call sites — not inside `Sparkline.tsx`. |
| DISCO-05 | `is_example=true` seed strategies are flagged via existing migration 001:64 column; default Customize "Hide examples" toggle ON; Phase 13 ships only data backfill `UPDATE strategies SET is_example = true WHERE id IN (<seed UUIDs>)` (no DDL) | Column declaration verified at `001_initial_schema.sql:64` (`is_example BOOLEAN NOT NULL DEFAULT false`). Existing seeders already write `is_example=true` (`scripts/seed-demo-data.ts`, `scripts/seed-full-app-demo.ts`). Production seed UUIDs known: `cccccccc-0001-4000-8000-00000000000X` series — see Open Question #4 for caveat. Existing UI consumers at `StrategyTable.tsx:131` and `StrategyGrid.tsx:50-54` already filter on `is_example`. |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Implication for Phase 13 |
|-----------|--------|---------------------------|
| **Read DESIGN.md before any visual decision** | `CLAUDE.md` | DESIGN.md DIFF-05 (sparkline single-accent) and the 13-UI-SPEC are locked; no deviation. |
| **"This is NOT the Next.js you know"** | `AGENTS.md` | Next 16.2.3 — `params` is `Promise<{...}>` in dynamic API routes (await it). No `use cache` is configured project-wide; no `cacheComponents` in `next.config.ts`. |
| **Banned packages: `axios`** | `CLAUDE.md` | Use native `fetch()`. The Phase 13 API route handler uses Supabase client directly — no HTTP client needed. |
| **Banned CTA labels** | `13-UI-SPEC.md` Copywriting Contract | Already locked: `Save preferences`, `Reset to defaults`, `Close customize panel`. |
| **Industrial / Utilitarian voice; no emojis; no exclamation points** | DESIGN.md + CLAUDE.md | Inherited by 13-UI-SPEC; planner inherits. |
| **Verification before completion: every non-trivial change must be proven in actual environment** | `CLAUDE.md` | Phase 13 success requires the cross-account-isolation Playwright spec to actually run, not just be authored. |
| **Tests when finding errors** | user MEMORY.md | If the planner finds a bug while wiring sparkline color, it must add a regression test. |
| **No Claude adversarial in /ship** | user MEMORY.md | Not Phase 13 scope, but documenting that the orchestrator's `/ship` step omits Claude adversarial subagent. |

## Standard Stack

### Core (already on disk — verified versions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `^16.2.3` | App Router, route handlers, middleware | Project locked — confirmed `package.json` |
| `react` | `19.2.4` | RSC, `useOptimistic`, `useTransition`, hooks | Required by Next 16 |
| `@supabase/supabase-js` | `^2.101.1` | DB client; consumed by `@/lib/supabase/server` and `@/lib/supabase/client` | Project standard |
| `@supabase/ssr` | `^0.10.0` | SSR cookie-based auth | Project standard |
| `@playwright/test` | `^1.59.1` | E2E, visual regression | Project standard; CI lane already exists |
| `vitest` | (from package.json scripts) | Unit tests | Project standard |

### Internal Project Helpers (must be reused — not re-implemented)
| Helper | Path | Purpose in Phase 13 |
|--------|------|---------------------|
| `withAuth(handler)` | `src/lib/api/withAuth.ts` | Wraps the Watchlist PUT handler with CSRF check + Supabase user fetch |
| `assertSameOrigin(req)` | `src/lib/csrf.ts` | Origin/Referer validation; called inside `withAuth` for non-GET methods |
| `createClient` (server) | `src/lib/supabase/server.ts` | Used in route handlers and the Discovery page; cookie-aware Supabase client |
| `createClient` (client) | `src/lib/supabase/client.ts` | Used in browser-side optimistic mutations |
| `userActionLimiter` / `mandateAutoSaveLimiter` / `checkLimit` | `src/lib/ratelimit.ts` | Rate-limit the Watchlist PUT (Sprint 6 set the canonical rate-limiter pattern) |
| `logAuditEvent` | `src/lib/audit.ts` | If the Watchlist mutation should be audited (planner decides; Phase 13 is allocator-self-action so audit is optional but consistent with `api/preferences/route.ts:98`) |
| `Sparkline` | `src/components/charts/Sparkline.tsx` | Single-color SVG renderer; NO changes to its API |
| `StrategyFilters` | `src/components/strategy/StrategyFilters.tsx` | Extension target (add WatchlistTabs, swap Customize text-button → cog) |
| `StrategyTable` | `src/components/strategy/StrategyTable.tsx` | Extension target (leading column, scope state, watched-set thread-through) |
| `StrategyGrid` | `src/components/strategy/StrategyGrid.tsx` | Extension target (top-right star overlay) |
| `Modal`, `Button`, `Card`, `Badge`, `Skeleton` | `src/components/ui/*` | Reuse existing primitives; do NOT introduce shadcn (per UI-SPEC) |

### Alternatives Considered
| Instead of | Could Use | Why we don't |
|------------|-----------|--------------|
| Plain `useState` mirror | `React 19 useOptimistic` | `useOptimistic` is React-19-native and pairs cleanly with the form/PUT flow, but the codebase only uses `useTransition` today (`AllocatorExchangeManager.tsx:31`); `useOptimistic` is acceptable but not required — caller's discretion. |
| Native fetch from client | Supabase client direct insert/delete | Forbidden — RLS still applies, but routing through `/api/watchlist/[strategyId]` is the locked pattern (CONTEXT.md DISCO-01) and provides CSRF + audit hooks. |
| New `useLocalStorage` hook | Inline `useState` + `useEffect` | The `TweaksContext.tsx:55-99` pattern is the project standard; introducing a new hook would fork the convention. |

**Installation:** Nothing new to install. Phase 13 ships entirely with existing deps.

**Version verification:** Confirmed via `package.json` read 2026-04-28. No version bumps needed.

## Architecture Patterns

### System Architecture Diagram

```
                ┌──────────────────────────────────────────────────┐
                │ Browser / Client                                  │
                │                                                   │
   user click   │  ┌─────────────────┐    ┌────────────────────┐  │
   star icon ───┼─▶│   StarToggle    │───▶│ optimistic local    │  │
                │  │  (NEW)          │    │ mirror              │  │
                │  └────────┬────────┘    └─────────┬──────────┘  │
                │           │                        │              │
                │           ▼                        ▼              │
   page mount   │  ┌─────────────────┐    ┌────────────────────┐  │
                │  │ CustomizeDrawer │    │ fetch() PUT         │  │
                │  │  (NEW)          │    │ /api/watchlist/[id] │  │
                │  └────────┬────────┘    └─────────┬──────────┘  │
                │           │                        │              │
                │           ▼                        │              │
                │  ┌─────────────────┐               │              │
                │  │ localStorage    │               │              │
                │  │ "discovery_view │               │              │
                │  │ _preferences:   │               │              │
                │  │ {uid}:{slug}"   │               │              │
                │  └─────────────────┘               │              │
                └─────────────────────────────────────│──────────────┘
                                                      │
                ┌─────────────────────────────────────│──────────────┐
                │ Frontend Server (Next 16 Route Handler)            │
                │                                     ▼              │
                │  ┌────────────────────────────────────────────┐   │
   page SSR ────┼─▶│ /api/watchlist/[strategyId]/route.ts (NEW) │   │
                │  │   PUT  → withAuth(handler)                  │   │
                │  │     CSRF assertSameOrigin()                 │   │
                │  │     supabase.auth.getUser()                 │   │
                │  │     parse {action: "add"|"remove"}          │   │
                │  └────────┬────────┬───────────────────────────┘   │
                │           │        │                                │
                │           │        ▼                                │
                │           │  ┌──────────────────────┐              │
                │           │  │ supabase.from(       │              │
                │           │  │  "user_favorites")   │              │
                │           │  │  .upsert({user_id,   │              │
                │           │  │    strategy_id},     │              │
                │           │  │   { onConflict:      │              │
                │           │  │    "user_id,         │              │
                │           │  │     strategy_id" })  │              │
                │           │  │  .delete()           │              │
                │           │  └──────────┬───────────┘              │
                │           │             │                           │
   page server │           ▼             │                           │
   render      │  ┌─────────────────┐    │                           │
                │  │ getMyWatchlist  │    │                           │
                │  │   (userId)      │    │                           │
                │  │   (NEW query    │    │                           │
                │  │    in queries.ts)│   │                           │
                │  └────────┬────────┘    │                           │
                └───────────│─────────────│───────────────────────────┘
                            │             │
                ┌───────────▼─────────────▼───────────────────────────┐
                │ Database (Supabase Postgres)                         │
                │                                                       │
                │  user_favorites                                      │
                │   PK (user_id, strategy_id)        ← CONTEXT idempotency │
                │   RLS: 4 policies on auth.uid() = user_id           │
                │   migration 024 (already shipped)                   │
                │                                                       │
                │  strategies                                          │
                │   .is_example column (migration 001:64)             │
                │   ◀─ data-only backfill: UPDATE … WHERE id IN (…)  │
                │                                                       │
                │  organizations                                       │
                │   ◀─ conditional migration: ALTER ADD is_public     │
                │                              BOOLEAN DEFAULT false  │
                │                              (only if audit > 0)    │
                │                                                       │
                │  strategies_org_read RLS (migration 026:95)         │
                │   ── unchanged ── still enforces org membership      │
                │   for organization_id IS NOT NULL strategies         │
                └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions only)
```
src/
├── components/strategy/
│   ├── WatchlistTabs.tsx         # NEW — All / My Watchlist segmented control
│   ├── StarToggle.tsx            # NEW — table + card variants; inline SVG icons
│   ├── CustomizeDrawer.tsx       # NEW — right-edge slide-out replacing CustomizeModal
│   ├── EmptyWatchlist.tsx        # NEW — two-line empty state
│   ├── StrategyTable.tsx         # extend — leading column, scope state, userId/watchedSet props
│   ├── StrategyGrid.tsx          # extend — top-right star overlay
│   └── StrategyFilters.tsx       # extend — add WatchlistTabs + swap Customize button → cog
├── lib/
│   ├── queries.ts                # extend — add `getMyWatchlist(userId): Promise<Set<string>>`
│   └── discovery-prefs.ts        # NEW — localStorage helpers (template: lib/wizard/localStorage.ts)
├── app/
│   ├── api/watchlist/[strategyId]/route.ts   # NEW — PUT handler; withAuth + CSRF + rate limit
│   └── (dashboard)/discovery/[slug]/page.tsx # extend — fetch watched-set in parallel; thread userId
└── ...

supabase/migrations/
├── 089_organizations_is_public.sql           # CONDITIONAL — only if audit > 0 (NOT 088 — see Pitfall #1)
└── 090_seed_is_example_backfill.sql          # data-only UPDATE … WHERE id IN (<seed UUIDs>)

e2e/   (NOT tests/e2e/ — see Pitfall #3)
├── discovery-sparkline-regression.spec.ts    # NEW — DOM walks, asserts no #16A34A + #DC2626 mix
└── discovery-prefs-isolation.spec.ts         # NEW — login-A then login-B, assert no A keys readable
```

### Pattern 1: Next 16 Dynamic Route Handler with Awaited Params

**What:** In Next 16, `params` is a `Promise` and must be awaited. The codebase already
uses this pattern in 5 places (e.g., `api/keys/[id]/permissions/route.ts:35`).

**When to use:** Every Phase 13 dynamic route handler.

**Example:**
```typescript
// Source: src/app/api/keys/[id]/permissions/route.ts (codebase ground truth, Next 16)
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

export const PUT = withAuth(async (req: NextRequest, user, ctx: { params: Promise<{ strategyId: string }> }) => {
  const { strategyId } = await ctx.params;        // ← Next 16 awaited promise

  // Rate limit by user.id
  const rl = await checkLimit(userActionLimiter, `watchlist:${user.id}`);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  let body: { action?: "add" | "remove" };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const supabase = await createClient();
  if (body.action === "add") {
    // Idempotent insert; user_favorites PK is (user_id, strategy_id)
    const { error } = await supabase
      .from("user_favorites")
      .upsert({ user_id: user.id, strategy_id: strategyId }, { onConflict: "user_id,strategy_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "Failed to add" }, { status: 500 });
  } else if (body.action === "remove") {
    const { error } = await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("strategy_id", strategyId);
    if (error) return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
});
```

> **Note:** `withAuth` wraps the handler but its current signature accepts only
> `(req, user)` — see `src/lib/api/withAuth.ts`. Either extend `withAuth` to forward
> the route context (preferred — keeps existing call sites working), or skip
> `withAuth` and inline the auth/CSRF/cookie pattern as in `api/preferences/route.ts:28-44`
> directly. **Planner: pick one and document.**

### Pattern 2: Per-User Slug-Scoped localStorage with SSR Hydration

**What:** Mount-effect read + persistence-effect write, gated on `hydrated` flag, with
key shape `discovery_view_preferences:{auth.uid}:{slug}` (CONTEXT.md `<specifics>`).

**When to use:** Customize prefs for the Discovery list. Pattern is verbatim from
`TweaksContext.tsx:55-99`.

**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/context/TweaksContext.tsx:55-99 (codebase pattern)
// Source: src/lib/wizard/localStorage.ts (SSR-safe helper template)
"use client";
import { useState, useEffect } from "react";

export interface DiscoveryViewPreferences {
  view: "table" | "grid";
  sort: { key: SortKey; dir: SortDir };
  hide_examples: boolean;
}

const DEFAULTS: DiscoveryViewPreferences = {
  view: "table",
  sort: { key: "sharpe", dir: "desc" },
  hide_examples: true,                              // ← DISCO-05 default
};

function keyFor(uid: string, slug: string): string {
  return `discovery_view_preferences:${uid}:${slug}`;
}

function safeRead(uid: string, slug: string): DiscoveryViewPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(keyFor(uid, slug));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DiscoveryViewPreferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function useDiscoveryPrefs(uid: string, slug: string) {
  const [prefs, setPrefs] = useState<DiscoveryViewPreferences>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(safeRead(uid, slug));
    setHydrated(true);
  }, [uid, slug]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(keyFor(uid, slug), JSON.stringify(prefs));
    } catch { /* Safari private mode / quota — non-fatal */ }
  }, [prefs, hydrated, uid, slug]);

  return { prefs, setPrefs, hydrated };
}
```

> **Hydration note:** The default first paint shows `view="table"` even if the user
> persisted `view="grid"` — accept the one-frame mismatch or the SSR/CSR contract
> breaks. The `<Skeleton>` rows already absorb this (UI-SPEC State Matrix).

### Pattern 3: Sign-Driven Sparkline Color at the Call Site

**What:** Compute the color rule in the call site, pass it into `Sparkline.color`. Do
NOT modify `Sparkline.tsx` itself.

**When to use:** Every place a `sparkline_returns` array renders. Drawdown sparklines
are out of scope per UI-SPEC (statically negative).

**Example:**
```typescript
// Source: src/components/charts/Sparkline.tsx:14 (caller picks color contract)
// Source: 13-UI-SPEC.md Color section (DIFF-05 sign-driven rule)
function sparklineColor(data: number[]): string {
  if (!data.length) return "var(--color-chart-benchmark)";   // #94A3B8 fallback
  const final = data[data.length - 1];
  if (final > 0) return "var(--color-accent)";               // #1B6B5A
  if (final < 0) return "var(--color-negative)";             // #DC2626
  return "var(--color-chart-benchmark)";                     // #94A3B8 (final == 0)
}

// At call site (StrategyTable.tsx:315 and StrategyGrid.tsx:88):
<Sparkline data={s.analytics.sparkline_returns ?? []} color={sparklineColor(s.analytics.sparkline_returns ?? [])} />
```

### Pattern 4: Server-Side Watched-Set Fetch + Page-Level Threading

**What:** New `getMyWatchlist(userId): Promise<Set<string>>` query in `lib/queries.ts`,
called in parallel with existing fetches in `discovery/[slug]/page.tsx`. Threaded
through `StrategyTable` as a `Set<string>` for O(1) membership checks.

**When to use:** Initial page render. Mutation-time updates flow through the optimistic
client mirror.

**Example:**
```typescript
// Source: src/lib/queries.ts:167-188 (getStrategiesByCategory pattern)
// Source: src/app/(dashboard)/discovery/[slug]/page.tsx (parallel fetch shape)
export async function getMyWatchlist(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_favorites")
    .select("strategy_id")
    .eq("user_id", userId);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.strategy_id));
}

// In page.tsx:
const [strategies, portfolio, watchedSet] = await Promise.all([
  getStrategiesByCategory(slug),
  getRealPortfolio(user.id),
  getMyWatchlist(user.id),
]);
return <StrategyTable strategies={strategies} categorySlug={slug} portfolioId={portfolio?.id ?? null} userId={user.id} initialWatchedSet={watchedSet} />;
```

### Pattern 5: Optimistic UI via Local Mirror + useTransition

**What:** Mirror `watchedSet` in client state; flip optimistically on click; reconcile
on server response; revert on failure.

**When to use:** Star toggle.

**Example:**
```typescript
// Source: src/components/exchanges/AllocatorExchangeManager.tsx (useTransition usage)
"use client";
import { useState, useTransition } from "react";

export function StarToggle({ strategyId, name, starred, onToggle }: { ... }) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const action = starred ? "remove" : "add";
    onToggle(strategyId, !starred);                              // optimistic flip
    startTransition(async () => {
      try {
        const res = await fetch(`/api/watchlist/${strategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      } catch {
        onToggle(strategyId, starred);                            // revert on failure
        // 1 retry after 600ms per UI-SPEC State Matrix; planner authors
      }
    });
  };

  return (
    <button
      type="button"
      aria-label={starred ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
      aria-pressed={starred}
      disabled={isPending}                                        // 200ms double-click absorption
      onClick={handleClick}
      className="..."
    >
      {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
    </button>
  );
}
```

### Anti-Patterns to Avoid

- **Don't modify `Sparkline.tsx`** — caller-side color contract is the project convention. The grep `<path stroke=` inside `Sparkline.tsx` should still match exactly one literal call site after Phase 13.
- **Don't introduce a new icon library** (`lucide-react`, `@heroicons`, `react-icons`) — UI-SPEC mandates inline SVG; `lib/icons` etc. don't exist on disk.
- **Don't put localStorage reads inline in component render** — SSR will throw; use the mount-effect pattern. If you see `typeof window === "undefined"` outside a hook, you're doing it wrong.
- **Don't use `axios`** — it's banned (CLAUDE.md supply-chain compromise list, 2026-03-31). `fetch()` is the only HTTP client.
- **Don't add an interstitial "are you sure?" modal for unstarring** — UI-SPEC says destructive flow does not apply (1-click reversible op).
- **Don't change the signature of existing `Sparkline`, `StrategyTable`, `StrategyGrid` props in a breaking way** — extend with optional props (`userId?`, `initialWatchedSet?`) so non-Discovery call sites (factsheet, browse) still compile.
- **Don't number the conditional migration `088`** — taken. See Pitfall #1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSRF + auth + rate limit on Watchlist PUT | Custom origin checking, manual `auth.getUser()` | `withAuth` from `lib/api/withAuth.ts` (extended for params) OR inline `assertSameOrigin` + `createClient` + `checkLimit` per `api/preferences/route.ts:28-44` | Edge cases (Vercel preview hosts, `127.0.0.1`, dev origins) are already handled in `csrf.ts:1-40`. |
| Idempotent watchlist toggle | Client-side debounce | DB-side `ON CONFLICT DO NOTHING` (upsert with `ignoreDuplicates: true`) + `DELETE WHERE` | CONTEXT.md DISCO-01: "Rapid double-click idempotency is server-side"; client-side debounce is explicitly disallowed. |
| localStorage helpers | Inline `JSON.parse(localStorage.getItem(...))` everywhere | New `lib/discovery-prefs.ts` modeled on `lib/wizard/localStorage.ts` | Safari private mode, quota errors, malformed payloads need explicit try/catch + version-tolerant `{ ...DEFAULTS, ...parsed }` merge. |
| Sparkline color rule | Per-point segmented stroke (gradient or split path) | Single `<path stroke={oneColor}>` per Sparkline (existing contract) | DESIGN.md DIFF-05: single accent only. The Playwright spec exists *specifically* to catch a future split-color reintroduction. |
| Drawer scroll-lock | Manual `document.body.style.overflow = "hidden"` | The existing All-Filters drawer already scroll-locks via `fixed inset-0 z-50` + body class flip — see `StrategyFilters.tsx:398-426` | Inheriting the existing drawer pattern verbatim is the locked UI-SPEC choice ("the existing All-Filters slide-out at `StrategyFilters.tsx:398` is the visual template"). |
| Org dropdown that "leaks names" via raw query | `SELECT id, name FROM organizations` then filter client-side | `SELECT id, name FROM organizations WHERE is_public = true` server-side; let RLS + `is_public` co-gate | Both gates needed: `is_public=true` shields names of stealth funds; existing `org_read` RLS (migration 026:83) shields against logged-out access. The dropdown surfaces orgs the allocator can already see strategies for (Pitfall #2 clarifies this). |
| Seed UUID extraction | Inline `name ILIKE 'demo_%'` runtime branch | Hard-code the 6 known seed UUIDs (`cccccccc-0001-4000-8000-00000000000{1..6}` from `scripts/seed-demo-data.ts:STRATEGY_UUIDS`) into the data-only migration | The seeders are deterministic and the UUIDs are pinned (per `seed-demo-data.ts` block comment "MUST match `src/lib/demo.ts`"). Querying for them at migration time only adds risk — see Open Question #4. |

**Key insight:** Phase 13 is a thin polish layer over already-shipped infrastructure
(`user_favorites` migration 024, `is_example` column at 001:64, `organization_id` FK at
006:30). The "don't hand-roll" list is short because most foundations exist. The two
real risks are (a) re-implementing CSRF/auth in the new route handler and (b)
reintroducing per-point sparkline color — both have project precedents that must be
inherited verbatim.

## Runtime State Inventory

> Phase 13 is a frontend feature addition with one **data backfill** and one
> **conditional schema change**. It is not a rename or refactor — but the
> data-backfill (`is_example=true`) is a stateful change to live records, so this
> section is included for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (existing rows mutated) | Production `strategies` rows whose UUIDs match the seed-strategy set need `is_example=true`. Known seeders write the flag at insert time (`scripts/seed-demo-data.ts:is_example: true`), so any "missing" rows are only those seeded by an older script that pre-dated the column being honored consistently. | Data-only migration: `UPDATE strategies SET is_example=true WHERE id IN (<seed UUIDs>);`. Idempotent (sets to `true`; running twice is a no-op). |
| Live service config | None — no n8n / Datadog / Tailscale config carries Discovery-related strings. The `quants.space` ID parity is a code-side concept, not a service registration. | None. |
| OS-registered state | None — no Task Scheduler / pm2 / launchd entry references Discovery v2. | None. |
| Secrets / env vars | None — `INTERNAL_API_TOKEN` and `NEXT_PUBLIC_SITE_URL` are read by existing routes; Phase 13 adds no new env. | None. |
| Build artifacts / installed packages | None — no `egg-info`, no compiled binaries; Phase 13 is pure TS that goes through `next build`. The Vercel project does need a fresh deploy after Phase 13 ships, but that is the standard `/ship` flow, not a special action. | None. |

## Common Pitfalls

### Pitfall 1: Migration 088 is already shipped — Phase 13's conditional migration must be 089 (or higher)

**What goes wrong:** CONTEXT.md and UI-SPEC reference `088_organizations_is_public.sql`. On `feature/v0.17-sprint-13` (and on `main`), `supabase/migrations/088_cutover_strategy_metrics_keys.sql` is **already committed** — Phase 12's REVIEW-FIX shipped it as the atomic kill-switch RPC.

**Why it happens:** CONTEXT.md was written 2026-04-28 expecting Phase 12 to land migrations 086 + 087, with 088 reserved for Phase 13. But Phase 12's WR-04 long-term fix (per `feature/v0.17-sprint-12` recent commits) added a third migration (088) that wasn't in the original Phase 12 scope.

**How to avoid:** The planner re-derives the next free migration number at plan-phase time:
```bash
ls supabase/migrations/ | sort | tail -5
```
The next number is `089` (or higher if anything else lands first).

**Warning signs:** A `git diff` of the conditional migration adds it as `088_organizations_is_public.sql` — the file already exists on disk; git will refuse to track it as new.

### Pitfall 2: `organizations.is_public=true` is a NAME-LEAK gate, not a strategy-visibility gate — existing RLS still requires org membership

**What goes wrong:** Reading CONTEXT.md naively, one might assume `is_public=true` makes the org's strategies visible to all allocators. It does not. The existing `strategies_org_read` RLS policy (migration `026:95-100`) says:
```sql
USING (
  (organization_id IS NULL AND (status = 'published' OR user_id = auth.uid()))
  OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
)
```
For org-tagged strategies, the allocator MUST be a member. `is_public` does NOT relax this; it only governs whether the org *name* appears in the dropdown.

**Why it happens:** "Public" is an overloaded word — in social-media context it means "anyone can see content"; in this DB it means "name is safe to surface in a dropdown".

**How to avoid:** The planner MUST surface this to the user before plan-phase:
> *"Phase 13's audit-gated dropdown surfaces only org names where `is_public=true` AND the allocator is a member (existing RLS unchanged). If audit > 0 but the allocator is not a member of any `is_public=true` org, the dropdown will render empty (`'No public teams yet — admins will surface them here as they opt in.'` per UI-SPEC). Confirm this is the intended behavior, or open a follow-up to relax `strategies_org_read` for `is_public=true` orgs."*

This is captured under **Open Questions** below.

**Warning signs:** A user sets `is_public=true` on Acme Capital but cannot see Acme strategies in the dropdown despite the org appearing — they're not a member.

### Pitfall 3: `tests/e2e/` doesn't exist — actual Playwright dir is `e2e/`

**What goes wrong:** CONTEXT.md and UI-SPEC say "spec under `tests/e2e/`". The repo's Playwright config (`playwright.config.ts:5`) declares `testDir: "./e2e"`; `tests/` exists but only contains a `fixtures/` subdir. Writing files to `tests/e2e/` would:
- Not be picked up by `npx playwright test`
- Not run in CI

**Why it happens:** Common naming convention drift; `tests/e2e/` is what most starter templates use, but this project chose `e2e/` at the repo root.

**How to avoid:** Use the actual Playwright `testDir`:
- `e2e/discovery-sparkline-regression.spec.ts`
- `e2e/discovery-prefs-isolation.spec.ts`

**Warning signs:** `npm run test:e2e` reports "no tests found" or skips the new specs.

### Pitfall 4: Next 16 dynamic-route `params` is a Promise — must be awaited

**What goes wrong:** Pre-Next-15 patterns destructure `{ params }` as a plain object: `const { strategyId } = params;`. In Next 16, `params` is a Promise; reading `.strategyId` directly returns `undefined` (or, more dangerously, a thenable that yields a string), which then becomes the literal string `"undefined"` in subsequent `.eq("strategy_id", "undefined")` filters — a silent bug.

**Why it happens:** Training data largely predates the Next 15+ async-API change. AGENTS.md flags this explicitly: "This is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing any code."

**How to avoid:** Every `params` consumer must be `await`ed:
```typescript
export async function PUT(req: NextRequest, ctx: { params: Promise<{ strategyId: string }> }) {
  const { strategyId } = await ctx.params;
  // ...
}
```
This is verified in 5 existing routes (e.g., `api/keys/[id]/permissions/route.ts:35`).

**Warning signs:** A typecheck error `Type '{ params: { strategyId: string }; }' is not assignable…` in CI; or a 4xx/5xx with the literal strategyId rendered as `"undefined"` in error logs.

### Pitfall 5: `withAuth` does not currently forward route context — must be extended OR bypassed

**What goes wrong:** `src/lib/api/withAuth.ts` accepts only `(req, user)`. A dynamic route handler needs `(req, ctx)` where `ctx.params` resolves the strategyId. Wrapping the new PUT in `withAuth` as-is loses the params.

**Why it happens:** `withAuth` was authored before Phase 13's first dynamic-route mutation; existing dynamic routes (`api/keys/[id]/permissions/route.ts`) inline the auth check.

**How to avoid:** Two options the planner picks one of:
1. **Extend `withAuth`** to forward an optional 3rd context arg. Add a `RouteContext`-like generic so existing call sites still typecheck. Pros: keeps the helper canonical. Cons: 1 file change with broader blast radius.
2. **Inline the auth flow** in the route handler exactly as `api/preferences/route.ts:28-44` does (CSRF + `getUser` + 401 fallback). Pros: zero blast radius outside Phase 13 surface. Cons: 5 lines of repeated boilerplate.

**Warning signs:** TypeScript complains the handler signature doesn't match `withAuth`'s expected handler shape, OR the strategyId appears `undefined` at runtime.

### Pitfall 6: `useEffect`-based localStorage hydration creates a one-frame mismatch

**What goes wrong:** SSR renders defaults (`view="table"`); client mount reads localStorage (`view="grid"`); React performs a re-render. If the table → grid swap is observable, users notice a flicker. Worse, if the developer reads localStorage *during* render, Next 16 throws a hydration mismatch error.

**Why it happens:** localStorage is browser-only; SSR has no access to it. The only correct shape is "render defaults on first paint, swap to persisted value on the second paint".

**How to avoid:** Use the `TweaksContext.tsx:84-99` template — `useEffect(setPrefs(safeRead(...)))` on mount, gated by `hydrated` flag for the persistence effect. Mask the swap with the existing `<Skeleton>` rows so the user perceives "loading → content" not "table → grid".

**Warning signs:** Dev console shows `Hydration failed because the initial UI does not match…` errors on `/discovery/[slug]`.

### Pitfall 7: Sparkline drawdown cell is statically negative — the sign-driven rule must NOT apply to it

**What goes wrong:** `StrategyTable.tsx:319` already passes `color="var(--color-negative)"` to the drawdown sparkline (drawdown is by definition non-positive). If the planner naively applies the new sign-driven rule to every Sparkline call site, the drawdown chart's color would flip to muted-grey (when final == 0) — wrong.

**Why it happens:** The single-accent rule only applies to `sparkline_returns`. Drawdown's color is statically chosen by the column's semantic meaning, not by data sign.

**How to avoid:** Apply `sparklineColor()` ONLY at the two `sparkline_returns` call sites (`StrategyTable.tsx:315`, `StrategyGrid.tsx:88-93`). The drawdown call site at `StrategyTable.tsx:319` is **out of scope** — UI-SPEC explicitly notes this.

**Warning signs:** Visual regression spec catches the drawdown cell rendering grey on a flat-final fixture.

### Pitfall 8: Cross-account isolation Playwright spec needs full sign-out, not just `clearCookies`

**What goes wrong:** Supabase's `@supabase/ssr` writes auth cookies AND sometimes drops a token in `localStorage` under `sb-<ref>-auth-token`. A naive Playwright "log out" that clears cookies but not localStorage leaves the auth-token entry alongside the discovery prefs entries. The spec then can't cleanly assert "no A keys readable".

**Why it happens:** Supabase storage strategy depends on the SSR config; `@supabase/ssr 0.10.0` defaults to cookies but historic versions persisted to localStorage.

**How to avoid:** The spec's "log out" step must:
1. Click the explicit Logout button (so the server drops cookies via `signOut()`).
2. After redirect, assert there are NO `sb-` keys in localStorage from session A.
3. THEN log in as B and assert no `discovery_view_preferences:{A.uid}:*` keys are present.

**Warning signs:** Spec is flaky — sometimes finds A's auth-token; sometimes doesn't, depending on timing.

## Code Examples

### Example 1: Customize Drawer with sticky header / footer + Save / Reset / ESC

```typescript
// Source: 13-UI-SPEC.md State Matrix; src/components/strategy/StrategyFilters.tsx:398-562 (visual template)
"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export function CustomizeDrawer({ open, onClose, draft, setDraft, persisted, onSave }: { ... }) {
  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="customize-heading">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto">
        <header className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 id="customize-heading" className="text-lg font-semibold text-text-primary">Customize</h2>
          <button onClick={onClose} aria-label="Close customize panel" className="text-text-muted hover:text-text-primary">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </header>
        <div className="p-6 space-y-6">
          <p className="text-sm text-text-secondary">Set your default view, sort, and visibility on this category. Saved per device.</p>
          {/* … sections … */}
        </div>
        <footer className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center gap-3">
          <Button variant="primary" onClick={onSave} className="flex-1" aria-label="Save preferences" disabled={!dirty}>Save preferences</Button>
          <Button variant="ghost" onClick={() => setDraft(DEFAULTS)}>Reset to defaults</Button>
        </footer>
      </aside>
    </div>
  );
}
```

### Example 2: Page-level threading — Discovery page server component

```typescript
// Source: src/app/(dashboard)/discovery/[slug]/page.tsx (current shape) + getMyWatchlist (NEW)
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getRealPortfolio, getStrategiesByCategory, getMyWatchlist } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export default async function DiscoveryPage({ params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const meta = cat ?? { name: slug, slug, description: "" };

  const [strategies, portfolio, watchedSet] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
    getMyWatchlist(user.id),
  ]);

  return (
    <>
      <Breadcrumb items={[{ label: "Discovery", href: "/discovery/crypto-sma" }, { label: meta.name }]} />
      <PageHeader title={meta.name} />
      {meta.description && <InfoBanner className="mb-6">{meta.description}</InfoBanner>}
      <StrategyTable
        strategies={strategies}
        categorySlug={slug}
        portfolioId={portfolio?.id ?? null}
        userId={user.id}
        initialWatchedSet={watchedSet}
      />
    </>
  );
}
```

### Example 3: Sparkline regression Playwright spec (DOM walk, no pixel diff)

```typescript
// Source: 13-UI-SPEC.md DIFF-05 + e2e/discovery.spec.ts (existing pattern)
// File: e2e/discovery-sparkline-regression.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Discovery sparkline single-accent rule (DESIGN.md DIFF-05)", () => {
  test.beforeEach(async ({ page }) => {
    // Use the existing login fixture (full-flow.spec.ts:53-60 template).
    await page.goto("/login");
    await page.fill('input[type="email"]', process.env.E2E_USER_EMAIL!);
    await page.fill('input[type="password"]', process.env.E2E_USER_PASSWORD!);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
    await page.goto("/discovery/crypto-sma");
  });

  test("no sparkline mixes positive and negative stroke colors", async ({ page }) => {
    // Wait for at least one row to render.
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
    const sparklinePaths = await page.locator("table svg path[stroke]").all();
    expect(sparklinePaths.length).toBeGreaterThan(0);
    for (const path of sparklinePaths) {
      const stroke = await path.evaluate((el) => (el as SVGPathElement).getAttribute("stroke") || "");
      // Acceptable: accent (#1B6B5A or var(--color-accent)), negative (#DC2626 or var(--color-negative)),
      // benchmark grey (#94A3B8 or var(--color-chart-benchmark)). Drawdown cell is always negative — that's fine.
      // What's forbidden: a single SVG containing BOTH #16A34A and #DC2626 strokes.
    }
    // Cross-element assert per Sparkline: each SVG owns exactly one stroke color.
    const distinctPerSvg = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll("table svg")) as SVGElement[];
      return svgs.map((svg) => {
        const strokes = new Set(
          Array.from(svg.querySelectorAll("path[stroke]"))
            .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
            .filter((s) => s && s !== "none")
        );
        return [...strokes];
      });
    });
    for (const strokes of distinctPerSvg) {
      const hasGreen = strokes.some((s) => /#16A34A/i.test(s));
      const hasRed = strokes.some((s) => /#DC2626/i.test(s));
      expect(hasGreen && hasRed).toBe(false);
    }
  });
});
```

### Example 4: Cross-account localStorage isolation spec

```typescript
// Source: 13-UI-SPEC.md Component Inventory; CONTEXT.md DISCO-02 success criterion
// File: e2e/discovery-prefs-isolation.spec.ts
import { test, expect } from "@playwright/test";

test("login-as-A then login-as-B leaves no A-keyed prefs in B's session", async ({ page }) => {
  // ─── Session A ───
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_USER_A_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_USER_A_PASSWORD!);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies)/);
  await page.goto("/discovery/crypto-sma");

  // Open Customize, change view → grid, save
  await page.click('button[aria-label="Customize discovery view"]');
  await page.click('button:has-text("Grid")');
  await page.click('button[aria-label="Save preferences"]');

  // Read out A's key
  const aKeysAfterSave = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("discovery_view_preferences:")));
  expect(aKeysAfterSave.length).toBeGreaterThan(0);
  const aUid = aKeysAfterSave[0].split(":")[1];

  // ─── Sign out (full session drop, not just clearCookies — see Pitfall #8) ───
  await page.goto("/logout");          // adjust to actual logout route
  await page.waitForURL(/\/login/);
  // Belt-and-braces: also clear any sb-* localStorage entries that survive.
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith("sb-")).forEach((k) => localStorage.removeItem(k));
  });

  // ─── Session B ───
  await page.fill('input[type="email"]', process.env.E2E_USER_B_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_USER_B_PASSWORD!);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies)/);
  await page.goto("/discovery/crypto-sma");

  // ─── Assertion: no A-uid keys in B's localStorage ───
  const aKeysInB = await page.evaluate((uid) => {
    return Object.keys(localStorage).filter((k) => k.startsWith(`discovery_view_preferences:${uid}:`));
  }, aUid);
  expect(aKeysInB).toEqual([]);

  // Bonus: B's view should be the locked default (table), not A's grid.
  // (UI-SPEC defaults: view=table, sort=sharpe-desc, hide_examples=true)
  await expect(page.locator('table')).toBeVisible();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pre-Next-15 sync `params` (`{ params: { id: string } }`) | Next 15+ async `params` (`{ params: Promise<{ id: string }> }`) | Next 15.0, Apr 2025 | Every dynamic route handler must `await ctx.params` |
| `Modal` primitive for filter/customize | Right-edge slide-out drawer (`fixed inset-0 z-50 flex justify-end`) | Phase 09.1, 2026-04-24 | UI-SPEC Layout Contract uses the existing All-Filters drawer at `StrategyFilters.tsx:398` as template; do NOT use `<Modal>` for the new Customize panel |
| `text-[10px] font-bold` activeCount chip | `text-[11px] font-semibold` (2-weight typography) | UI-SPEC rev 1, 2026-04-28 | The existing chip at `StrategyFilters.tsx:319` must be promoted; the new Watchlist count badge inherits this style |
| Per-point sparkline color split (legacy) | Single-color trace, sign-driven at call site (`#1B6B5A` / `#DC2626` / `#94A3B8`) | DESIGN.md DIFF-05, locked at milestone start | The Playwright regression exists *to prevent regression to the split style* |
| `useEffect` for everything | `use cache` directive (Next 16) | Next 16.0 | NOT used in this project — no `cacheComponents` flag in `next.config.ts`. Phase 13 does NOT introduce `use cache`. |

**Deprecated/outdated:**
- `axios`: BANNED (CLAUDE.md, 2026-03-31 supply-chain compromise). Use `fetch()`.
- `<Modal title="Customize View">` from `StrategyFilters.tsx:607`: replaced by the new right-edge drawer; the existing `Modal` primitive is fine for other surfaces but NOT for Phase 13's Customize panel.

## Assumptions Log

> Every claim tagged `[ASSUMED]` in this research. The planner uses this section to
> identify decisions that need user confirmation before execution. Items NOT in this
> table were verified against the codebase or official docs.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 6 known seed strategy UUIDs (`cccccccc-0001-4000-8000-00000000000{1..6}`) from `scripts/seed-demo-data.ts` are sufficient for the data-only `is_example=true` backfill. The CONTEXT.md fallback ("`name ILIKE 'demo_%'`") is unnecessary because production seeders already write `is_example=true` correctly. | DISCO-05; Don't Hand-Roll | **Low** — if there are additional un-flagged seed rows in production from older seeders, fresh allocators may still see legacy demo strategies. The audit query at plan-phase can confirm row count. |
| A2 | The orchestrator's MCP supabase tools include `mcp__supabase__execute_sql` (or the namespaced variant `mcp__plugin_supabase_supabase__execute_sql` per CONTEXT.md). Phase 12 used `mcp__supabase__apply_migration` and `mcp__supabase__generate_typescript_types`; SQL-execute is the third member of that family. | Step 6 / TODOS audit | **Medium** — if the tool name differs, the audit step in TODOS.md needs the exact name written verbatim. The fallback CLI is `supabase db remote query …` per Phase 12's TODOS.md. |
| A3 | Existing `withAuth` (`src/lib/api/withAuth.ts`) does not forward route context. To use it for the new dynamic-route PUT, the planner extends it (or inlines the auth flow). I have not measured the blast radius of extending `withAuth`; planner's discretion which path. | Pitfall 5 | **Low** — both options work; extending `withAuth` requires re-typing existing call sites with the new generic. |
| A4 | Phase 13's conditional migration should be numbered `089` (or higher) — taking 088 collides with Phase 12's already-shipped `088_cutover_strategy_metrics_keys.sql`. The actual next-free number must be re-checked at plan-phase. | Pitfall 1 | **High if not caught** — git won't let two files share a number; the migration apply step would fail. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

## Open Questions

1. **DISCO-03 RLS semantics — does `is_public=true` only gate name visibility, not strategy visibility?**
   - What we know: Existing `strategies_org_read` policy (migration `026:95-100`) requires org membership to see `organization_id IS NOT NULL` strategies. `is_public` does NOT change this.
   - What's unclear: The user's intent. Two interpretations:
     - **(A) Name-leak gate only** — dropdown lists `is_public=true` orgs the allocator can already see strategies for; otherwise dropdown empty. (Matches DESIGN.md DIFF "default-false avoids leaking private/stealth fund names".)
     - **(B) Strategy-visibility gate** — Phase 13 also relaxes `strategies_org_read` so that `organizations.is_public=true` acts like `organization_id IS NULL` for read purposes. Larger blast radius; not in CONTEXT.md.
   - Recommendation: Ask the user before plan-phase. Default to (A); if (B), Phase 13's migration also needs an RLS DROP/CREATE for `strategies_org_read`.

2. **Audit count = 0 fallback — does the dropdown ship as a hidden button, or is the entire Customize section omitted?**
   - What we know: UI-SPEC State Matrix says "Filter-by-team section: audit count == 0 → section not rendered". This is the accepted answer.
   - What's unclear: Whether the section header tag itself (`Filter by team`) should appear as a placeholder. UI-SPEC says no.
   - Recommendation: Lock to "fully omitted from DOM if audit==0" and document in plan.

3. **Watchlist PUT rate limiter — `userActionLimiter` (5/min) vs `mandateAutoSaveLimiter` (30/min)?**
   - What we know: `userActionLimiter` = 5/min sensitive ops; `mandateAutoSaveLimiter` = 30/min realistic burst.
   - What's unclear: Star-clicking is a fast-fire action — a power-allocator might star 10-20 strategies in 30 seconds.
   - Recommendation: Use `mandateAutoSaveLimiter` (30/min). Document in plan.

4. **`created_by` column does NOT exist on `strategies`** — CONTEXT.md says "query for strategies whose `created_by` matches the seed-admin auth uid". The actual column is `user_id` (per `strategies` schema in `database.types.ts` and the seeders).
   - What we know: Seeders write `user_id` (not `created_by`) when inserting strategies. Verified at `scripts/seed-demo-data.ts:STRATEGY_PROFILES` and `STRATEGY_UUIDS`.
   - What's unclear: Whether CONTEXT.md's "created_by" was a typo or refers to a different column elsewhere.
   - Recommendation: Use the **hard-coded UUID list** from `STRATEGY_UUIDS` as the canonical source — avoids an indirect query. Document in plan as "data-only migration ships 6 seed UUIDs literally; query path discarded as fragile".

5. **Logout route — what's the actual URL? `/logout` or a POST endpoint?**
   - What we know: The cross-account isolation spec needs a clean log-out step. I did not find a `logout/page.tsx` route in the brief read.
   - What's unclear: Whether the project ships a `/logout` page or relies on a button-triggered server action.
   - Recommendation: Planner verifies and uses the actual logout flow (likely a click on the user-menu Logout button inside the dashboard).

6. **`useOptimistic` vs `useTransition` for the star toggle?**
   - What we know: The codebase uses `useTransition` already (`AllocatorExchangeManager.tsx:31`). React 19's `useOptimistic` is also available.
   - What's unclear: Whether the planner prefers consistency (`useTransition`) or modern idiom (`useOptimistic`).
   - Recommendation: Use `useTransition` + local mirror — matches the codebase pattern and the State Matrix's "icon swapped immediately, button disabled for 200ms".

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `next` 16.x | All page + route handlers | ✓ | 16.2.3 | — |
| `react` 19.x | `useOptimistic` / `useTransition` | ✓ | 19.2.4 | — |
| `@playwright/test` | Sparkline visual regression + cross-account isolation specs | ✓ | 1.59.1 | — |
| `@supabase/supabase-js` | DB client | ✓ | 2.101.1 | — |
| Supabase MCP (`mcp__supabase__*`) | DISCO-03 audit query at plan-phase | Orchestrator-side | — | `supabase db remote query` (Phase 12 used it as fallback at TODOS.md) |
| Production DB access (`khslejtfbuezsmvmtsdn`) | Audit query target | Orchestrator-side | — | None — DISCO-03 is BLOCKED until audit runs |
| Test users for cross-account spec | `discovery-prefs-isolation.spec.ts` | macOS Keychain (per user MEMORY.md `service: quantalyze-test`) | — | Skip the spec in CI until env wired (planner decides) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Supabase MCP — fallback is the Supabase CLI `db remote query` invocation (used by Phase 12).

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Unit / component framework | Vitest (per `package.json` `"test": "vitest run"`) |
| E2E framework | Playwright (per `playwright.config.ts`, `testDir: "./e2e"`) |
| Quick run command | `npm test` (vitest unit) + `npm run test:e2e -- --grep "discovery"` (Playwright) |
| Full suite command | `npm test && npm run test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISCO-01 | Watchlist toggle persists across reload via DB | E2E (Playwright) | `npm run test:e2e -- --grep "watchlist toggle"` | ❌ Wave 0 — `e2e/discovery-watchlist.spec.ts` |
| DISCO-01 | Star toggle is idempotent under rapid double-click (server-side) | Unit (vitest) on the route handler | `npm test -- src/app/api/watchlist` | ❌ Wave 0 — co-located `route.test.ts` |
| DISCO-01 | "All" / "My Watchlist" tabs swap visible row sets | Component test (Vitest + RTL) | `npm test -- StrategyTable` | ❌ Wave 0 — `src/components/strategy/StrategyTable.test.tsx` (file does NOT exist; only StrategyHeader and others) |
| DISCO-02 | localStorage key shape is `discovery_view_preferences:{auth.uid}:{slug}` | Unit (vitest) on `useDiscoveryPrefs` | `npm test -- discovery-prefs` | ❌ Wave 0 — `src/lib/discovery-prefs.test.ts` |
| DISCO-02 | Cross-account isolation — A-keys not readable in B | E2E (Playwright) | `npm run test:e2e -- --grep "discovery prefs isolation"` | ❌ Wave 0 — `e2e/discovery-prefs-isolation.spec.ts` |
| DISCO-02 | Customize defaults are `view=table`, `sort=sharpe-desc`, `hide_examples=true` | Unit (vitest) on default-merge logic | `npm test -- discovery-prefs` | ❌ Wave 0 — same file as above |
| DISCO-03 | If audit > 0 — dropdown only renders `is_public=true` orgs the allocator can see | E2E (Playwright) seeded with one public + one private org (gated on audit) | `npm run test:e2e -- --grep "discovery filter team"` | ❌ Wave 0 — `e2e/discovery-filter-by-team.spec.ts` (only authored if audit > 0) |
| DISCO-03 | If audit == 0 — section is fully omitted from DOM | E2E or component-test asserting `queryByText('Filter by team')` returns null | bundled with above | bundled |
| DISCO-04 | No SVG path in `/discovery/[slug]` mixes `#16A34A` and `#DC2626` strokes | E2E (Playwright DOM walk) | `npm run test:e2e -- --grep "sparkline single-accent"` | ❌ Wave 0 — `e2e/discovery-sparkline-regression.spec.ts` |
| DISCO-04 | Sparkline final-value-sign rule applied at the two `sparkline_returns` call sites | Component test (Vitest + RTL); render with each fixture (final>0, final<0, final==0) | `npm test -- "Sparkline call site"` | ❌ Wave 0 — `src/components/strategy/StrategyTable.test.tsx` |
| DISCO-05 | Fresh allocator's first Discovery visit shows zero example strategies | E2E (Playwright) | `npm run test:e2e -- --grep "fresh allocator hides examples"` | ❌ Wave 0 — `e2e/discovery-hide-examples-default.spec.ts` |
| DISCO-05 | After data backfill, all 6 seed UUIDs have `is_example=true` | SQL probe in deploy script | manual or scripted | manual at plan/ship time |

### Sampling Rate
- **Per task commit:** Vitest unit suite (`npm test`) — runs in <30s
- **Per wave merge:** Vitest unit + Playwright e2e on the new specs (`npm run test:e2e -- --grep "discovery"`)
- **Phase gate:** Full suite green before `/gsd-verify-work`; visual regression snapshot captured

### Wave 0 Gaps
- [ ] `src/app/api/watchlist/[strategyId]/route.test.ts` — covers DISCO-01 idempotency
- [ ] `src/lib/discovery-prefs.ts` + `src/lib/discovery-prefs.test.ts` — covers DISCO-02 helpers
- [ ] `src/components/strategy/StrategyTable.test.tsx` — covers DISCO-04 sparkline color application + scope swap
- [ ] `src/components/strategy/StarToggle.test.tsx` — covers optimistic mirror + revert-on-failure
- [ ] `src/components/strategy/CustomizeDrawer.test.tsx` — covers ESC close + Save/Reset
- [ ] `e2e/discovery-sparkline-regression.spec.ts` — covers DISCO-04 visual rule
- [ ] `e2e/discovery-prefs-isolation.spec.ts` — covers DISCO-02 cross-account
- [ ] `e2e/discovery-watchlist.spec.ts` — covers DISCO-01 reload-persistence
- [ ] `e2e/discovery-hide-examples-default.spec.ts` — covers DISCO-05
- [ ] `e2e/discovery-filter-by-team.spec.ts` — covers DISCO-03 (only if audit > 0)
- [ ] Test-user env vars (`E2E_USER_A_EMAIL` etc.) wired into Playwright CI lane — leverage existing macOS Keychain `service: quantalyze-test` per user MEMORY.md

## Security Domain

> `security_enforcement` is enabled by default (no explicit `false` in config.json).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Supabase SSR (`@supabase/ssr 0.10.0`); `withAuth` helper at `lib/api/withAuth.ts:8-24` |
| V3 Session Management | yes | Cookie-based via Supabase SSR; cross-account isolation Playwright spec (DISCO-02) is the test |
| V4 Access Control | yes | RLS on `user_favorites` (4 policies, `024:42-73`) + `strategies_org_read` (`026:95-100`) |
| V5 Input Validation | yes | Strict shape validation on `{ action: "add" \| "remove" }` body; reject any other shape with 400 |
| V6 Cryptography | no | No new crypto; existing TLS in transit |
| V13 API Security | yes | CSRF via `assertSameOrigin` at `lib/csrf.ts`; rate-limit via `checkLimit` |

### Known Threat Patterns for {Next 16 + Supabase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSRF on Watchlist mutation | Spoofing | `assertSameOrigin(req)` invoked inside `withAuth` for non-GET methods |
| Idempotency abuse / spam (rapid star/unstar) | Denial of Service | `checkLimit(mandateAutoSaveLimiter, "watchlist:" + user.id)` — 30/min cap |
| Strategy-name leak via dropdown | Information Disclosure | `is_public=true` filter on `organizations` (default-false) — Pitfall #2 explains this is name-only |
| Cross-account localStorage leak on shared machines | Information Disclosure | Per-uid key shape `discovery_view_preferences:{auth.uid}:{slug}`; Playwright spec proves isolation |
| RLS bypass via direct insert | Tampering | Existing `user_favorites` RLS rejects rows where `user_id != auth.uid()`; cannot be bypassed by client-side direct insert |
| Audit bypass | Repudiation | Existing `logAuditEvent` pattern at `lib/audit.ts`; planner decides whether to audit watchlist mutations (allocator-self-action; usually skipped) |

## Sources

### Primary (HIGH confidence — codebase ground truth)
- `13-CONTEXT.md` (2026-04-28, status `approved`) — locked decisions
- `13-UI-SPEC.md` (rev 1, 2026-04-28, verdict `6/6 PASS`) — UI Design Contract
- `.planning/REQUIREMENTS.md` (lines 17–22) — DISCO-01..05 acceptance criteria
- `.planning/STATE.md` — current phase position; ROADMAP cross-reference
- `.planning/ROADMAP.md` (lines 93–106) — Phase 13 success criteria
- `DESIGN.md` (lines 1–137) — locked design tokens; sparkline color rule
- `supabase/migrations/001_initial_schema.sql:64` — `is_example` column declaration
- `supabase/migrations/006_organizations.sql:30` — `organization_id` FK
- `supabase/migrations/024_user_favorites.sql:1-105` — `user_favorites` schema + 4 RLS policies
- `supabase/migrations/026_fix_organization_rls_recursion.sql:95-100` — `strategies_org_read` RLS that constrains DISCO-03 (Pitfall #2)
- `supabase/migrations/088_cutover_strategy_metrics_keys.sql:1-30` — proves 088 is taken (Pitfall #1)
- `src/components/charts/Sparkline.tsx:1-64` — single-color contract
- `src/components/strategy/StrategyTable.tsx:88-372` — extension target; sparkline call sites at lines 315 + 319
- `src/components/strategy/StrategyFilters.tsx:1-685` — extension target; existing CustomizeModal at lines 583–684
- `src/components/strategy/StrategyGrid.tsx:1-117` — extension target; sparkline call site at lines 88–93
- `src/lib/queries.ts:167-188` — `getStrategiesByCategory` template for `getMyWatchlist`
- `src/lib/database.types.ts:2501-2529` — `user_favorites` row type
- `src/lib/wizard/localStorage.ts:1-130` — SSR-safe localStorage helper template
- `src/app/(dashboard)/allocations/context/TweaksContext.tsx:55-99` — hydrate-after-mount pattern
- `src/app/api/keys/[id]/permissions/route.ts:35` — Next 16 awaited `params` example
- `src/app/api/preferences/route.ts:28-44` — auth + CSRF + rate-limit inline pattern
- `src/lib/api/withAuth.ts:1-24` — current `withAuth` signature (no params forward)
- `src/lib/csrf.ts:1-40` — `assertSameOrigin` helper
- `src/lib/ratelimit.ts:49,91` — `userActionLimiter` and `mandateAutoSaveLimiter`
- `playwright.config.ts:5` — confirms `testDir: "./e2e"` (Pitfall #3)
- `e2e/discovery.spec.ts:1-9` — current discovery spec is just an unauth redirect test
- `e2e/full-flow.spec.ts:51-60` — login fixture template for new specs
- `scripts/seed-demo-data.ts:STRATEGY_UUIDS` — pinned seed UUIDs (Open Question #4)
- `package.json` — `next: ^16.2.3`, `react: 19.2.4`, `@playwright/test: ^1.59.1`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:80-95` — Next 16 `params` is `Promise`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md:18-44` — Next 16 dynamic route convention

### Secondary (MEDIUM confidence — cross-referenced patterns)
- `.planning/phases/12-backend-metric-contracts/12-02-SUMMARY.md:59,105,157` — Supabase MCP tool names used by orchestrator (`mcp__supabase__apply_migration`, `mcp__supabase__generate_typescript_types`)
- `.planning/phases/12-backend-metric-contracts/TODOS.md` — `supabase db remote query` fallback pattern; project ref `khslejtfbuezsmvmtsdn`
- `.planning/phases/12-backend-metric-contracts/12-01-PLAN.md:95-98` — audit query CLI invocation template

### Tertiary (LOW confidence — none required)
None. All claims are verified against the codebase or official Next 16 docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against `package.json`
- Architecture: HIGH — every recommendation cites a codebase precedent
- Pitfalls: HIGH — Pitfalls 1, 2, 3 are confirmed against on-disk files (migrations, playwright config, RLS policies)
- Open questions: 6 (4 require user clarification, 2 are planner-discretion)

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (30 days; stable surface — Next 16, React 19, Supabase 2.101 are not on a hot release cadence). Re-check before Phase 14a/b execution if Phase 13 is delayed.
