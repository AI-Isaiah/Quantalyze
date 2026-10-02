# Phase 32: Dead-Link Fix & Route Retirement - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Smart-discuss (autonomous — decisions by Claude per the standing "no clients, decide autonomously" directive). This is the highest-landmine phase of v1.2 (route retirement without breaking 30+ `/portfolios` consumers); RESEARCH is warranted (Next.js 16 redirect mechanics + exact deep-link/consumer inventory).

<domain>
## Phase Boundary

Close every end-to-end allocator flow with no dead links, retire the legacy allocator entry points into the unified composer, and give a new allocator ONE discoverable entry point — all as **routing + nav only**, with ZERO table DDL and ZERO breakage to managers' `/portfolios` flow or its 30+ non-route consumers (PDF / Bridge / alerts / GDPR / notes / simulator / intro / admin / demo / queries.ts).

Scope = FLOW-01, FLOW-02, FLOW-03. The unified composer lives at `/allocations` (`AllocationsTabs`, scenario tab); its deep-link is `/allocations?tab=scenario`.
</domain>

<decisions>
## Implementation Decisions

### FLOW-01 — portfolio-context "Add Strategy" (the real dead link)
- The "dead link" is **semantic, not a 404**: `/discovery/crypto-sma` is a LIVE default-landing slug (admin/auth/error/not-found redirects use it intentionally — DO NOT touch those). The bug is that the **portfolio-context** "+ Add Strategy" controls point at that generic slug and lose the portfolio you came from, so the added strategy never attaches back.
- Sites to fix (the portfolio-context ones ONLY): `src/app/(dashboard)/portfolios/[id]/manage/page.tsx:56` and `src/app/(dashboard)/portfolios/[id]/page.tsx:90`.
- Fix STRUCTURALLY (not another fixed slug): attach back to *that* portfolio. The manage page already supports an `?add=<strategyId>` flow (`PortfolioOptimizer.tsx:101` uses `/portfolios/${id}/manage?add=…`), and `@/components/portfolio/AddToPortfolio` already attaches a strategy to a portfolio. Reuse the existing structural add (portfolio-scoped Browse/AddToPortfolio), preserving portfolio context. Research must pick the cleanest of: (a) wire the composer Browse drawer scoped to the portfolio, or (b) route to discovery carrying portfolio context so `AddToPortfolio` attaches back. NO new fixed slug.
- Leave ALL non-portfolio `/discovery/crypto-sma` references untouched (they are the app's discovery home / default landing — intentional).

### FLOW-02 — retire legacy allocator entry points into the composer
- `/scenarios` → server-side `redirect()` to `/allocations?tab=scenario` (the unified composer). Pick the Next.js 16 mechanism in research: prefer a thin `redirect()` in the route (if any role-gating is needed — note `/scenarios/page.role-gate.test.ts` exists) over a `next.config` redirect; READ `node_modules/next/dist/docs/` for the canonical Next.js 16 redirect pattern before coding (AGENTS.md mandate).
- Delete `src/components/scenarios/ScenarioBuilder.tsx` and the `/scenarios` page **AFTER** the IMPACT-02 coverage migration (below). Phase 29 already absorbed the example universe, so the HARD-dependency entry gate is satisfied — redirecting now does not strand the feature.
- "Legacy allocator Portfolios path": **role-decide**. Managers keep `/portfolios` (and its 30+ consumers) UNCHANGED. Allocators reaching the allocator Portfolios path resolve into the composer. Research must map how `/portfolios` is currently role-gated and which inbound links are manager-scoped (kept) vs allocator-scoped (routed to composer). `AddToPortfolio`'s target is decided by role.
- Deep-link sweep over all 7 inbound `/portfolios` sites: keep manager-scoped ones; route allocator-scoped ones to the composer; fix the 2 portfolio-context dead links (FLOW-01).

### FLOW-03 — one discoverable entry point
- `Sidebar.tsx` currently has THREE nav items pointing at the fractured surfaces: `/allocations` (L62), `/scenarios` (L77), `/portfolios` (L84). Consolidate to ONE allocator entry point: keep `/allocations` (the composer) as the single allocator nav item, REMOVE the `/scenarios` nav item (route retired). Keep `/portfolios` in nav only where managers need it (role-gated) — do not orphan managers.
- The blank-slate empty state built in Phase 29 IS the front door for a new allocator (no separate landing). Confirm the single nav item lands a new allocator on that blank-slate composer.

### IMPACT-02 coverage migration (the don't-let-coverage-evaporate gate)
- BEFORE deleting `ScenarioBuilder`, migrate its `ScenarioBuilder.honesty.test.tsx` IMPACT-02 (peer/percentile-rank suppression on a what-if) coverage onto the composer. Phase 29/30 already extended the composer's IMPACT-02 `percentile-rank-badge` guard to every panel — research must CONFIRM the composer's existing guard fully covers what `ScenarioBuilder.honesty.test.tsx` asserted; if any assertion is unique to the ScenarioBuilder test, port it onto a composer-level honesty test FIRST. Only then delete ScenarioBuilder + its honesty test.
- After the delete, `knip` must be clean: remove now-orphaned components (`EquityCurveChart` / `MetricCard` if only `ScenarioBuilder` consumed them — verify with knip/grep, don't assume).

### Hard constraints
- NO table DDL: no migration DROPs `portfolios`/`portfolio_strategies` or any column. Retirement is routing + nav ONLY.
- Frozen `src/lib/scenario.ts` zero-diff (SCENARIO-05). No VERSION/package.json bump, no `.planning` commits (handled by /ship; commit_docs=false).
- Surgical: touch only the routing/nav/dead-link sites + the IMPACT-02 migration + the deletions. Do not refactor `/portfolios` internals.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Composer host: `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (scenario tab); deep-link `/allocations?tab=scenario` (used by `InsightStrip.tsx:163`).
- `@/components/portfolio/AddToPortfolio` — existing attach-strategy-to-portfolio component (used at `discovery/[slug]/[strategyId]/page.tsx:122`).
- Manage `?add=<strategyId>` flow already exists (`PortfolioOptimizer.tsx:101` → `/portfolios/${id}/manage?add=…`).
- `src/components/layout/Sidebar.tsx` — nav (L62 `/allocations`, L77 `/scenarios`, L84 `/portfolios`) + `Sidebar.test.tsx` (asserts the `/scenarios` link at L100 — update when retiring).

### Established Patterns
- Next.js 16 App Router server `redirect()` — READ `node_modules/next/dist/docs/` for the current API before coding (AGENTS.md: this is NOT the Next.js you know).
- Role-gating precedent exists (`/scenarios/page.role-gate.test.ts`) — mirror for any composer/portfolios role routing.

### Integration Points
- `/portfolios` + its 30+ consumers (managers, PDF, Bridge, alerts, GDPR, notes, simulator, intro, admin, demo, queries.ts) — MUST stay working. Routing/nav change only.
- `Sidebar.test.tsx`, `DashboardChrome.test.tsx` — update nav assertions when the `/scenarios` item is removed.
</code_context>

<specifics>
## Specific Ideas

- The single most dangerous mistake here would be touching the intentional `/discovery/crypto-sma` default-landing redirects (admin/auth/error) — only the 2 portfolio-context links are FLOW-01.
- Migrate IMPACT-02 coverage BEFORE the ScenarioBuilder delete; a deleted-file's peer-rank suppression test must not silently evaporate.
- `knip` clean is a hard exit gate after the delete.
</specifics>

<deferred>
## Deferred Ideas

- Bridge → composer continuity, DESIGN.md empty-state polish, WCAG-AA sweep — Phase 33 (JOURNEY-01..03), not here.
- Any `portfolios` table schema change / data migration — explicitly OUT (managers + 30+ consumers depend on it).
</deferred>
