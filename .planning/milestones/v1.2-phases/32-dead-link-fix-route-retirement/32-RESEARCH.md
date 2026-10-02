# Phase 32: Dead-Link Fix & Route Retirement - Research

**Researched:** 2026-06-23
**Domain:** Next.js 16 App Router routing/nav retirement (no DDL, no new deps) + honesty-test coverage migration
**Confidence:** HIGH (every claim is `[VERIFIED: codebase grep/read]` against current `main` or `[CITED: node_modules/next/dist/docs]`)

## Summary

Phase 32 is **routing + nav + a coverage migration + two file deletions** — zero schema, zero new deps, zero `src/lib/scenario.ts` diff. Every finding below is verified against current `main` (Next.js `16.2.9`, knip `^6.3.1`).

The phase is dominated by **silent-failure landmines** that all ship GREEN unless a content-inspecting test catches them. The four that matter:
1. Touching one of the **~28 intentional `/discovery/crypto-sma` default-landing redirects** instead of the **exactly 2** portfolio-context dead links. (#1 risk; fully enumerated below.)
2. A **self-referential dead link inside the composer's own empty state** (`ScenarioComposer.tsx:1621` → `/scenarios`) that would loop a new allocator back into the composer they're standing in. This is NOT in the CONTEXT.md site list and is easy to miss.
3. Deleting `ScenarioBuilder.tsx` before confirming the composer's honesty test already covers its IMPACT-02 + PROJECTED + caveat assertions (it does — verified line-by-line).
4. Converting `/scenarios/page.tsx` to a redirect while leaving `page.role-gate.test.ts` in place — that test imports `./page` and asserts the admin-client gate, so it will FAIL after conversion. It must be deleted in the same change.

**Primary recommendation per FLOW requirement:**
- **FLOW-01**: Replace the 2 portfolio-context `/discovery/crypto-sma` links with **portfolio-scoped links into the existing structural add flow** — `<Link href={`/portfolios/${id}/manage?add=…`}>` is NOT viable as-is because **nothing consumes `?add=`** (verified: the param is dead even at `PortfolioOptimizer.tsx:101`). The cleanest verified fix is **option (b): route to discovery carrying portfolio context, OR — simpler and lower-risk — wire the manage page's "+ Add Strategy" to a portfolio-scoped browse that reuses `AddToPortfolio`'s `portfolio_strategies.insert` path.** Recommend a thin `AddToPortfolio`-style attach scoped to `id`, since `AddToPortfolio` already does the exact insert this needs.
- **FLOW-02**: Convert `/scenarios/page.tsx` to a **thin server-component `redirect("/allocations?tab=scenario")`** (Next.js 16 `redirect()` from `next/navigation`), keeping the existing role gate; delete `ScenarioBuilder.tsx` + its honesty test + `page.role-gate.test.ts` after the coverage check. No allocator-scoped `/portfolios` redirect is needed — `/portfolios` has **no route-level role gate** and no allocator-only inbound link beyond the 2 FLOW-01 ones.
- **FLOW-03**: Remove the `/scenarios` nav item (`Sidebar.tsx:74-80`); update `Sidebar.test.tsx` (6 assertions); keep `/portfolios` nav item gated to managers (unchanged). Fix the composer's self-referential `/scenarios` link (landmine #2).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/scenarios` retirement redirect | Frontend Server (RSC) | — | Server `redirect()` preserves the existing role gate; runs before render. Not a `next.config` redirect (loses the role check). |
| FLOW-01 attach-back | Frontend Server (link target) + Client (`AddToPortfolio` insert) | Database (`portfolio_strategies` RLS) | The attach is a client-side `supabase.from('portfolio_strategies').insert` under user RLS — already implemented in `AddToPortfolio`. |
| Nav consolidation | Client (`Sidebar.tsx` `"use client"`) | — | Pure nav-item array edit gated on role flags from the layout. |
| `/portfolios` coexistence | unchanged (Database + 25 consumer files) | — | No DDL. Routing boundary only. |

## Standard Stack

No new packages. Everything uses what is already installed and verified on `main`.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.9` | `redirect()` from `next/navigation`; App Router | Already the project's framework; `[VERIFIED: node -p require('next/package.json').version]` |
| `knip` | `^6.3.1` | dead-code / orphan gate after deletes | Already in `package.json:61`; `knip.json` present |
| `vitest` + `@testing-library/react` | per repo | honesty-test migration + nav assertions | Existing test framework |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RSC `redirect()` in `/scenarios/page.tsx` | `next.config.ts` `redirects()` | **REJECTED** — `next.config` redirects run before the page renders and **cannot run the `profiles.role` gate**. The current page leaks the institutional strategy universe to non-allocators if the gate is dropped (the whole point of `page.role-gate.test.ts`). A thin RSC keeps the gate runnable if ever needed, and `redirect()` to the composer is a one-liner. CITED: `node_modules/next/dist/docs/01-app/02-guides/redirecting.md` table — `redirect` runs in Server Components; `redirects` in next.config "Redirect an incoming request based on a path" with no auth context. |
| RSC `redirect()` | `proxy.ts` `NextResponse.redirect` | **REJECTED** — proxy is the wrong layer for a single static path; the repo's `proxy.ts` is auth-only (DEFAULT_AUTHENTICATED_ROUTE lives there but is a redirect *target*, not a route rule). |

**Installation:** none.

## Package Legitimacy Audit

> Not applicable — Phase 32 installs **zero** external packages (routing/nav/test-only). No registry verification needed.

## FLOW-01 — The Portfolio-Context Dead Link (Structural Fix)

### What is actually broken (verified)
- `/discovery/crypto-sma` is a **LIVE route** (it is `DEFAULT_AUTHENTICATED_ROUTE` in `proxy.ts:9`). It is NOT a 404. `[VERIFIED: src/proxy.ts:9]`
- The bug is **semantic**: the 2 portfolio-context "+ Add Strategy" controls link to the generic discovery home and **lose the portfolio you came from**, so the added strategy never attaches back to *that* portfolio.

### The two sites to fix (and ONLY these two)
| File:Line | Current | Context |
|-----------|---------|---------|
| `src/app/(dashboard)/portfolios/[id]/manage/page.tsx:56` | `<Link href="/discovery/crypto-sma">+ Add Strategy</Link>` | Manage page header, beside `MigrationWizardButton`. `id` is in scope (awaited at L20). |
| `src/app/(dashboard)/portfolios/[id]/page.tsx:90` | `<Link href="/discovery/crypto-sma">Add your first strategy</Link>` | `EmptyState()` sub-component, rendered when `strategies.length === 0`. `id` is in scope at the page level (L370), but `EmptyState` currently takes no props. |

### CRITICAL verified fact: the `?add=` flow does NOT exist
The CONTEXT.md hint to "reuse the manage `?add=<strategyId>` flow (`PortfolioOptimizer.tsx:101`)" is **based on a false premise**. Verified:
- `PortfolioOptimizer.tsx:101` does emit `href={`/portfolios/${portfolioId}/manage?add=${suggestion.strategy_id}`}`. `[VERIFIED]`
- **BUT `manage/page.tsx` never reads `searchParams`** — `grep searchParams` in that file returns nothing. `[VERIFIED: grep]`
- **No file in `src/app/(dashboard)/portfolios/` consumes a `?add=` param** at all. `[VERIFIED: grep "get(\"add\")|searchParams" returns nothing in the portfolios tree]`

So `PortfolioOptimizer.tsx:101`'s `?add=` is itself a **dead/no-op param today** — it lands the user on the manage page with a query string nothing reads. Building FLOW-01 on top of `?add=` would mean **first implementing the `?add=` handler** (a search-param → auto-attach effect), which is more surface than the locked-decision "surgical, reuse existing mechanisms."

### Recommended structural fix (cleanest, lowest-risk)
**Reuse `@/components/portfolio/AddToPortfolio`'s exact attach path, scoped to the portfolio.** `AddToPortfolio` (`src/components/portfolio/AddToPortfolio.tsx:52-73`) already does precisely the needed write:
```ts
await supabase.from("portfolio_strategies").insert({ portfolio_id, strategy_id });
// 23505 → "Already in portfolio"; else "Added!"
```
Two viable wirings (planner picks; both preserve portfolio context, neither adds a fixed slug):

- **(b) Route to discovery carrying portfolio context** (matches CONTEXT.md option b): change the 2 links to `/discovery/crypto-sma?portfolio=${id}`, and have the discovery strategy-detail page's `AddToPortfolio` **default-select that portfolio**. `AddToPortfolio` is already mounted at `discovery/[slug]/[strategyId]/page.tsx:122`. This is the lighter-touch option but requires `AddToPortfolio` to read a `portfolio` search param and pre-resolve the target (small client change).
- **(a) Portfolio-scoped browse on the manage page**: mount a portfolio-scoped browse/attach control inline on the manage page (using `AddToPortfolio`'s insert, with `portfolio_id` already known = `id`). Heavier UI, but keeps the user in the portfolio context with no navigation.

**Recommendation: option (b)** — minimal new surface, reuses the already-mounted `AddToPortfolio`, preserves portfolio context via a query param the existing component reads. It is the only option that is genuinely "reuse existing mechanisms" (the `?add=` path is not an existing mechanism — it's a dead param).

**Note for `EmptyState` at `[id]/page.tsx:90`:** `EmptyState()` takes no props today. To carry `id`, either pass `portfolioId` into `EmptyState` (one-line prop add) or inline the link in the page body where `id` is already in scope. Surgical: add the prop.

## FLOW-02 — `/scenarios` Retirement + the `/portfolios` Coexistence

### `/scenarios` → composer redirect (Next.js 16, verified)
**Mechanism: thin server-component `redirect()`.** `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md]`
- `redirect(path)` from `next/navigation`, callable in Server Components, returns **307** by default. It throws `NEXT_REDIRECT` to unwind render — no `return` needed (TypeScript `never`).
- The redirect target `"/allocations?tab=scenario"` is a **fully-wired, tested deep-link**: `AllocationsTabs.tsx:219` documents `/allocations?tab=scenario → Scenario (visible tab)`, `activeTab` is derived from `searchParams` (L222-226), and `AllocationsTabs.test.tsx:272-283` asserts `setSearchParams("tab=scenario")` → Scenario panel visible + tab selected. `[VERIFIED]`
- It is also the existing deep-link convention — `InsightStrip.tsx:163` already links to `/allocations?tab=scenario`. `[VERIFIED]`

**Role-gate question — answer:** The current `/scenarios/page.tsx` runs a `profiles.role IN ('allocator','both')` gate (L45-52) because it uses `createAdminClient()` to leak the institutional universe. **After retirement, the page renders nothing and reads nothing** — it just redirects. So the gate is **no longer load-bearing for data leakage** (the composer at `/allocations` has its own auth + the data path is gone). Recommended shape:

```tsx
// src/app/(dashboard)/scenarios/page.tsx  (REPLACES the whole file)
import { redirect } from "next/navigation";

export default function ScenariosPage() {
  redirect("/allocations?tab=scenario");
}
```
- A bare unconditional redirect is correct: any authenticated user reaching `/scenarios` belongs on the composer; a logged-out user hitting `/allocations` is bounced to `/login` by the existing dashboard/page guards. Preserving the old `redirect("/login?next=/scenarios")` is pointless (we no longer want to send anyone back to `/scenarios`). If the planner prefers belt-and-suspenders, an unauth `redirect("/login")` is harmless, but not required.

**MUST delete in the same change:** `src/app/(dashboard)/scenarios/page.role-gate.test.ts`. It does `await import("./page")` and asserts the page invokes `createAdminClient().from(...)` for allocators and rejects managers BEFORE the admin read (L120-159). Once `page.tsx` is a 3-line redirect, those assertions are false and the test FAILS. **This is a silent-failure landmine in reverse** — leaving the test in place fails CI. `[VERIFIED: read of page.role-gate.test.ts]`

### The `/portfolios` coexistence — VERIFIED there is no allocator route to redirect
The CONTEXT.md frames "the allocator Portfolios path resolves into the composer" as if an allocator-scoped `/portfolios` entry exists. **Verified reality:**
- **`/portfolios` has NO route-level role gate.** `portfolios/page.tsx:19-24` only does `if (!user) redirect("/login")`. `[VERIFIED]`
- **The dashboard layout does NOT gate `/portfolios` by role** — it computes `isAllocator`/`isManager` (L45-46) but only passes them to `<DashboardChrome>` for **sidebar visibility**; no redirect on role. `[VERIFIED: src/app/(dashboard)/layout.tsx]`
- So `/portfolios` is a manager surface **by nav convention only**. Allocators don't see it in the sidebar (`Sidebar.tsx:81-86` gates the Portfolios item on `showsManagerWorkspace`), but any user can deep-link.

**Conclusion:** there is **no allocator-scoped `/portfolios` inbound link to redirect.** The only allocator-facing `/portfolios` references are the **2 FLOW-01 dead links** (fixed structurally) and `AddToPortfolio.tsx:106` "Create one" (allocator-facing in discovery — KEEP, it's the legitimate create-portfolio path). FLOW-02's "route allocator-scoped Portfolios path to composer" therefore reduces to: **fix the 2 FLOW-01 links; change nothing else about `/portfolios`.** Do NOT add a role-redirect to `/portfolios` — that would strand managers and break the 25 consumer files' assumption that the route is reachable.

### The 7 inbound `/portfolios*` sites (full enumeration)
`[VERIFIED: grep '"/portfolios | `/portfolios' non-test]`

| # | Site | Link/Redirect | Scope | Action |
|---|------|---------------|-------|--------|
| 1 | `portfolios/[id]/manage/page.tsx:26` | `redirect("/portfolios")` (portfolio not found) | manager/error | KEEP (fallback) |
| 2 | `portfolios/[id]/documents/page.tsx:21` | `redirect("/portfolios")` (not found) | manager/error | KEEP |
| 3 | `portfolios/[id]/page.tsx:378` | `redirect("/portfolios")` (not found) | manager/error | KEEP |
| 4 | `Sidebar.tsx:84` | nav item `href="/portfolios"` | manager (gated) | KEEP (FLOW-03 keeps manager nav) |
| 5 | `AddToPortfolio.tsx:106` | `href="/portfolios"` ("Create one") | allocator (discovery) | KEEP — legitimate create path |
| 6 | `portfolios/page.tsx:42` | `href={`/portfolios/${p.id}`}` (list → detail) | manager | KEEP |
| 7 | `portfolios/[id]/page.tsx:427` | `href={`/portfolios/${id}/manage`}` | manager | KEEP |
| + | `portfolios/[id]/manage/page.tsx:45` | `href={`/portfolios/${id}`}` (Back) | manager | KEEP |
| + | `ExchangesTabContent.tsx:34,46` | `href={`/portfolios/${activePortfolio.id}`}` | manager | KEEP |
| + | `StrategyBreakdownTable.tsx:157` | `href={`/portfolios/${portfolioId}/strategies/${row.strategy_id}`}` | manager | KEEP |
| + | `PortfolioOptimizer.tsx:101` | `href={`/portfolios/${portfolioId}/manage?add=…`}` | manager | KEEP (but `?add=` is a dead param — see FLOW-01; out of scope to fix here unless touched) |

**Net: every `/portfolios` inbound link is manager-scoped or a legitimate allocator create-path. None needs redirecting to the composer.** The only edits are the 2 FLOW-01 links (#... `/discovery/crypto-sma`, not in this table).

## The `/discovery/crypto-sma` Reference Map (the #1 landmine — exhaustive)

`[VERIFIED: grep 'discovery/crypto-sma' non-test, full enumeration below — 30 references in 28 files]`

### (a) FLOW-01 portfolio-context dead links — **FIX these 2 ONLY**
| File:Line | Reason |
|-----------|--------|
| `portfolios/[id]/manage/page.tsx:56` | Portfolio-context "+ Add Strategy" — loses portfolio |
| `portfolios/[id]/page.tsx:90` | Portfolio empty-state "Add your first strategy" — loses portfolio |

### (b) Intentional default-landing / admin / auth / error / breadcrumb — **DO NOT TOUCH (28 refs)**
| File:Line | Kind |
|-----------|------|
| `src/proxy.ts:9` | `DEFAULT_AUTHENTICATED_ROUTE` constant — the canonical home |
| `src/proxy.ts:79` | comment referencing the above |
| `src/app/error.tsx:57` | global error-boundary "go home" link |
| `src/app/page.tsx:41` | root `redirect("/discovery/crypto-sma")` — post-login landing |
| `src/app/not-found.tsx:16` | 404 "go home" link |
| `src/app/(dashboard)/error.tsx:40` | dashboard error-boundary link |
| `src/app/(auth)/pending-approval/page.tsx:66` | post-approval landing |
| `src/app/(dashboard)/discovery/layout.tsx:37` | `redirect("/login?redirect=/discovery/crypto-sma")` |
| `discovery/[slug]/[strategyId]/page.tsx:106` | Discovery breadcrumb root |
| `discovery/[slug]/page.tsx:45` | Discovery breadcrumb root |
| `compare/page.tsx:119` | Discovery breadcrumb root |
| `admin/match/page.tsx:13` | admin non-admin bounce |
| `admin/match/eval/page.tsx:18` | admin bounce |
| `admin/intros/page.tsx:78` | admin bounce |
| `admin/users/[id]/page.tsx:32` | admin bounce |
| `admin/csv-status/page.tsx:29` | admin bounce |
| `admin/usage/page.tsx:42` | admin bounce |
| `admin/match/[allocator_id]/page.tsx:16` | admin bounce |
| `admin/compute-jobs/page.tsx:11` | admin bounce |
| `admin/users/page.tsx:25` | admin bounce |
| `admin/partner-pilot/[partner_tag]/page.tsx:50` | admin bounce |
| `admin/page.tsx:18` | admin bounce |
| `admin/deletion-requests/page.tsx:48` | admin bounce |
| `admin/for-quants-leads/page.tsx:22` | admin bounce |
| `components/auth/LoginForm.tsx:34` | post-login `router.push` |
| `components/auth/OnboardingWizard.tsx:14,92` | post-onboarding routing (allocator landing) |
| `components/layout/MobileNav.tsx:8` | mobile nav "Discovery" item |
| `components/strategy/StrategyTable.tsx:164` | comment (client-side category nav example) |

**Tests referencing it (do not edit):** `src/proxy.test.ts`, `src/components/strategy/StrategyTable.test.tsx`.

## FLOW-03 — One Discoverable Entry Point

### Nav change (`Sidebar.tsx`)
`[VERIFIED: src/components/layout/Sidebar.tsx]`
- **REMOVE** the Strategy Sandbox nav item — `Sidebar.tsx:74-80` (the `if (isAllocator) { workspaceItems.push({ label: "Strategy Sandbox", href: "/scenarios", icon: BeakerIcon }); }` block). The `BeakerIcon` (L273-281) becomes unused and should be deleted with it (or knip flags it — actually knip only flags unused **exports/files**, not file-private functions; a file-private unused `BeakerIcon` triggers the lint `no-unused-vars`, so delete it).
- **KEEP** `/allocations` (L60-65, "My Allocation") — the single allocator entry point (the composer host). A new allocator lands here; the Phase-29 blank-slate empty state IS the front door (verified: `ScenarioComposer.tsx:1592-1639` renders the "Start a portfolio" blank slate).
- **KEEP** `/portfolios` (L81-86) — manager-gated, unchanged.

### Composer self-referential dead link — **LANDMINE #2, not in CONTEXT.md**
`ScenarioComposer.tsx:1621` (inside the blank-slate empty state) renders:
```tsx
<Link href="/scenarios" className="text-accent underline">Try the Strategy Sandbox →</Link>
```
After retirement this **redirects the user from the composer back into the composer** (`/scenarios` → `/allocations?tab=scenario`) — a confusing no-op loop on the exact "front door" FLOW-03 is meant to make clean. **Recommend deleting the entire "Want to compare strategies without your portfolio?" paragraph (`ScenarioComposer.tsx:1619-1624`)** — the Sandbox it points to is gone, and the blank-slate already offers "Browse strategies" + "Connect Exchange" for the same intent. `[VERIFIED]`

### Nav tests to update
| Test | Assertion | Action |
|------|-----------|--------|
| `Sidebar.test.tsx:96-137` | Whole `describe("Sidebar Strategy Sandbox link RBAC gate")` block — 6 `it`s asserting the `/scenarios` link presence/absence/order/RBAC (L97-100 asserts `href="/scenarios"`) | **DELETE the whole describe block** — the link no longer exists. Do NOT just flip assertions; the surface is retired. |
| `Sidebar.test.tsx:49` | comment "at /scenarios, but the actual surface is a tab" | cosmetic; update or leave |
| `DashboardChrome.test.tsx` | **does NOT assert the Sandbox/`/scenarios` nav item** | **NO CHANGE** — verified `grep -i sandbox\|/scenarios` returns nothing. CONTEXT.md lists it as needing an update; that is **not required** (it only sets `navState.pathname = "/allocations"` etc.). `[VERIFIED]` |

## IMPACT-02 Coverage Migration (don't let coverage evaporate)

### What `ScenarioBuilder.honesty.test.tsx` asserts (4 `it`s)
`[VERIFIED: full read of src/components/scenarios/ScenarioBuilder.honesty.test.tsx]`
1. **IMPACT-01** (L95-121): `sandbox-example-universe-badge` ("Example universe"), `scenario-projected-badge` ("PROJECTED — hypothetical, not your live book"), `scenario-coverage-caveat` matching `/^Historical realized · \d+ overlapping days · not a forecast/` + "Shortest history: Short Leg."
2. **IMPACT-01 badge styling** (L123-141): both badges are neutral-outline `<span>` pills (border-text-muted/text-text-muted, NOT bg-accent/warning/role=alert/`<Badge>`).
3. **CORR-03** (L143-150): correlation MetricCard label reads `"Avg |ρ|"`, not `"Avg |corr|"`.
4. **IMPACT-02** (L152-178): NO `data-testid="percentile-rank-badge"` on the blend; non-vacuous via positive-control isolation render of a real `PercentileRankBadge`.

### What the composer's existing guard ALREADY covers (`ScenarioComposer.test.tsx`)
`[VERIFIED: full read of the relevant blocks]`

| ScenarioBuilder assertion | Composer test equivalent | Covered? |
|---------------------------|--------------------------|----------|
| IMPACT-02 `percentile-rank-badge` absent + non-vacuous positive control | `ScenarioComposer.test.tsx:2978-2993` (R3 guard) — **identical pattern, STRONGER** (runs WITH the Phase-30 blend panels mounted; also asserts no `factsheet-allocator`/`factsheet-signatures`) | ✅ YES (superset) |
| `scenario-projected-badge` "PROJECTED — hypothetical, not your live book" | `ScenarioComposer.test.tsx:3388-3404` | ✅ YES |
| PROJECTED badge neutral-outline pill (not bg-accent/warning/alert/Badge) | `ScenarioComposer.test.tsx:3408-3417` | ✅ YES |
| `scenario-coverage-caveat` "Historical realized · N overlapping days · not a forecast" + "Shortest history: …" | `ScenarioComposer.test.tsx:3440-3454` | ✅ YES |
| CORR-03 `"Avg |ρ|"` single-sourced (no `"Avg |corr|"`) | `ScenarioComposer.test.tsx:3360-3378` | ✅ YES |
| `sandbox-example-universe-badge` ("Example universe") | **No composer equivalent** | ❌ UNIQUE to ScenarioBuilder |

### The ONE unique assertion + recommendation
The **only** assertion with no composer analog is the **`sandbox-example-universe-badge` ("Example universe")** — the SURF-03 label that marked the entire `/scenarios` surface as the *example universe*. This is **intrinsic to the retired example-universe Sandbox**, not a transferable honesty invariant for the own-book composer (the composer is the allocator's *own book*, not an example universe). Phase 29 moved example-universe strategies into the **merged Browse catalog**, where they are tagged per-row via `is_example` (verified: `StrategyBrowseDrawer.tsx:50-55,497-503` renders example-universe provenance per row).

**Recommendation:** The IMPACT-02 *peer-rank-suppression* coverage (the load-bearing honesty invariant) is **already fully covered** by `ScenarioComposer.test.tsx:2978-2993` — **no port needed for IMPACT-02**. The `sandbox-example-universe-badge` assertion does **not** need porting onto a composer honesty test because it asserts a label for a surface that no longer exists; the equivalent honesty signal (example-strategy provenance) now lives as the per-row `is_example` tag in the Browse drawer, which has its own Phase-29 coverage. **Verify the Browse-drawer `is_example` tag has a test** before deleting; if it does (Phase 29 exit gate), the delete is safe with zero coverage loss. If the planner wants belt-and-suspenders, add a one-line composer-test assertion that the Browse drawer renders the example-universe provenance tag — but this is optional, not a coverage gap.

**Sequencing gate (hard):** confirm the above parity table green on the composer test, THEN delete `ScenarioBuilder.tsx` + `ScenarioBuilder.honesty.test.tsx` + `page.role-gate.test.ts`.

## knip Orphans After Delete (the hard exit gate)

`[VERIFIED: grep importers for every symbol]`

### What gets deleted
- `src/app/(dashboard)/scenarios/page.tsx` → replaced by 3-line redirect (NOT deleted; the route must still 307).
- `src/app/(dashboard)/scenarios/page.role-gate.test.ts` → DELETE.
- `src/components/scenarios/ScenarioBuilder.tsx` → DELETE.
- `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` → DELETE.

### What knip would flag — **NOTHING. Verified.**
**Correction to CONTEXT.md's stated assumption:** `EquityCurveChart` and `MetricCard` are **NOT separate components** — they are **file-private functions defined inside `ScenarioBuilder.tsx`** (`EquityCurveChart` at L57, `MetricCard` at L486). They are never exported and never imported elsewhere. When `ScenarioBuilder.tsx` is deleted, they vanish with the file — **there is nothing for knip to orphan**, and knip (which flags unused *files/exports*, not file-private functions) will not flag them. `[VERIFIED: grep "function EquityCurveChart|function MetricCard" + importer grep]`

- `MetricCard` ALSO exists as **independent file-private functions** in `strategy/[id]/page.tsx:64` and `landing/VerificationResults.tsx:22` — three unrelated same-named locals. Deleting ScenarioBuilder's does not touch them. `[VERIFIED]`

### Every ScenarioBuilder import stays alive (no orphan)
`ScenarioBuilder.tsx` imports: `CorrelationHeatmap` (`@/components/portfolio/...`), `Card`, `methodologyLine`/`shortestHistoryName` (`@/lib/scenario-history`), `formatPercent`/`formatNumber` (`@/lib/utils`), `computeScenario`/`buildDateMapCache`/types (`@/lib/scenario`). All have OTHER importers:
- `@/lib/scenario` — imported by the composer + StrategyBrowseDrawer; **frozen (SCENARIO-05), zero-diff.** `[VERIFIED]`
- `@/lib/scenario-history` — 8 importers incl. composer, MonteCarloSection, StressVarSection, ScenarioCompareTable, ScenarioBenchmarkSection, sample-floor, scenario-share. `[VERIFIED]`
- `CorrelationHeatmap` (portfolio) — imported by scenario-share, `portfolios/[id]/page.tsx`, composer. `[VERIFIED]`
- `PercentileRankBadge` (used by the honesty test only among scenarios) — still imported by `factsheet/[id]/tearsheet/page.tsx`; survives. `[VERIFIED]`

**`src/components/scenarios/` directory is NOT removed** — it still holds `SampleFloorEmptyState.tsx` (+ test), which is consumed elsewhere (`@/lib/sample-floor` family). Only the two ScenarioBuilder files leave the dir. `[VERIFIED: ls src/components/scenarios/]`

**Net: `knip` should be clean immediately after the deletes with no extra cleanup beyond removing the now-unused `BeakerIcon` from `Sidebar.tsx`.**

## Runtime State Inventory

> Rename/refactor/retirement phase — required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None affecting routing.** `portfolios`/`portfolio_strategies` tables stay UNCHANGED (no DDL); `scenarios` table untouched. No stored string keys on `/scenarios` or `/portfolios` route paths. | None — verified no migration in scope (CONTEXT.md hard constraint + STATE.md Pitfall 6). |
| Live service config | **None.** No external service (n8n/Datadog/Cloudflare) references these route paths. The redirect is in-app code. | None. |
| OS-registered state | **None.** No cron/task references `/scenarios`. | None. |
| Secrets/env vars | **None.** No env var references `/scenarios` or `/portfolios`. `DEFAULT_AUTHENTICATED_ROUTE` (`proxy.ts:9`) is `/discovery/crypto-sma` (UNTOUCHED). | None. |
| Build artifacts | **None.** Pure source deletes; no compiled package carries these. Vercel rebuild picks up the redirect + removed files automatically. | None. |
| **Caching / 307 semantics** | `redirect()` emits **307 (temporary)**, not 308. Browsers/CDN will NOT permanently cache the redirect. | Intentional — keep 307 (the route may be repurposed; permanent 308 would be hard to undo via CDN cache). Do NOT use `permanentRedirect`. |

**The canonical question — after every file is updated, what still references `/scenarios`?** Verified: only `api/strategies/[id]/returns/route.ts:29` (a JSDoc comment describing the legacy `/scenarios` data path — cosmetic, leave or update) and the composer self-link (landmine #2, fix). No runtime state caches the route.

## Common Pitfalls

### Pitfall 1: Touching an intentional `/discovery/crypto-sma` redirect
**What goes wrong:** Editing any of the 28 (b)-class references breaks the app's default landing / admin bounce / error recovery.
**How to avoid:** Fix EXACTLY `manage/page.tsx:56` and `[id]/page.tsx:90`. Encode an exit-gate test/grep: after the change, `grep -c 'discovery/crypto-sma' src/` should drop by exactly 2 (from 30 to 28 references, both in the portfolios tree).
**Warning sign:** A diff that touches `proxy.ts`, `page.tsx` (root), any `admin/*`, `error.tsx`, `not-found.tsx`, `LoginForm`, `OnboardingWizard`, `MobileNav`, or a breadcrumb.

### Pitfall 2: The composer's self-referential `/scenarios` link
**What goes wrong:** `ScenarioComposer.tsx:1621` loops the user back into the composer.
**How to avoid:** Delete the paragraph `1619-1624`.
**Warning sign:** A new allocator on the blank slate sees "Try the Strategy Sandbox →" that goes nowhere new.

### Pitfall 3: Leaving `page.role-gate.test.ts` after converting `/scenarios` to a redirect
**What goes wrong:** CI goes RED — the test asserts an admin-client read that no longer happens.
**How to avoid:** Delete it in the same change as the page conversion.

### Pitfall 4: Building FLOW-01 on the `?add=` param
**What goes wrong:** `?add=` is consumed by NOTHING; building on it means implementing a new handler (scope creep) and the dead link "works" only after that handler exists.
**How to avoid:** Use `AddToPortfolio`'s existing insert path (option b), not `?add=`.

### Pitfall 5: Adding a role-redirect to `/portfolios`
**What goes wrong:** Strands managers / breaks the 25 consumer files' reachability assumption.
**How to avoid:** `/portfolios` is unchanged. There is NO allocator-scoped `/portfolios` route to redirect — only the 2 FLOW-01 links.

## `/portfolios` Consumer Inventory (no-DDL gate — confirm NONE break)

`[VERIFIED: grep table refs — 51 reference lines across 25 files. Retirement is routing/nav ONLY; none of these touch route paths or are affected by the redirect/nav edits.]`

| Category | Representative file:line | Consumes |
|----------|--------------------------|----------|
| Core queries (TS) | `src/lib/queries.ts:1078,1150,1204,1354,1434,2900` | `from("portfolios")` / `from("portfolio_strategies")` |
| Manager PDF (page + admin client) | `src/app/portfolio-pdf/[id]/page.tsx:26,67,76` | `from("portfolios")`, `from("portfolio_strategies")` |
| Demo PDF | `src/app/api/demo/portfolio-pdf/[id]/route.ts` | tables |
| Bridge | `src/app/api/bridge/route.ts:99` | `from("portfolios")` |
| Alerts | `src/app/api/portfolio-alerts/route.ts:58,102`; `alerts/{ack,critical,[id]/acknowledge}` | tables |
| GDPR export manifest | `src/lib/gdpr-export-manifest.ts` | tables |
| Notes ownership | `src/lib/notes/ownership.ts:47` | `from("portfolios")` |
| Simulator (TS + Py) | `src/app/api/simulator/route.ts:128`; `analytics-service/routers/simulator.py:270,286` | tables |
| Intro snapshot | `src/lib/intro/snapshot.ts:77,118` | tables |
| Admin | `src/app/api/admin/{allocators/[id]/holdings,match/send-intro}/route.ts`; `profile/page.tsx`; `demo/page.tsx` | tables |
| Portfolio mutations (client) | `AddToPortfolio.tsx`, `CreatePortfolioForm.tsx`, `MigrationWizard.tsx`, `RemoveStrategyButton.tsx` | `portfolio_strategies` insert/delete |
| DB types | `src/lib/database.types.ts` | typed surface |
| Python analytics | `analytics-service/routers/{portfolio,cron,match}.py`, `services/job_worker.py` | `supabase.table("portfolios"/"portfolio_strategies")` |

**No table DDL is needed (verified):** retirement is routing + nav only. None of these 25 files reference a route path; they all read/write the tables, which are untouched.

## Validation Architecture

> nyquist_validation: not explicitly false in config → included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react (TS); pytest (Python — not touched this phase) |
| Quick run | `npx vitest run <file>` |
| Full suite | `npm test` (+ `npm run test:coverage` for the CI gate) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | Exists? |
|-----|----------|-----------|---------|---------|
| FLOW-01 | manage/empty-state "+ Add Strategy" attaches back to *this* portfolio | unit | new test on the chosen wiring (AddToPortfolio scoped / discovery `?portfolio=` default) | ❌ Wave 0 (write before fix) |
| FLOW-02 | `/scenarios` 307→`/allocations?tab=scenario` | unit | new `scenarios/page.test.ts` asserting `redirect("/allocations?tab=scenario")` (mirror the redirectMock pattern from the deleted role-gate test) | ❌ Wave 0 |
| FLOW-02 | composer self-link removed | unit | assert `ScenarioComposer` blank slate has no `href="/scenarios"` | ❌ Wave 0 |
| FLOW-02 | IMPACT-02 coverage preserved | unit | `ScenarioComposer.test.tsx:2978-2993` (existing, green) | ✅ |
| FLOW-03 | no Sandbox nav item; manager `/portfolios` kept; allocator single entry | unit | UPDATE `Sidebar.test.tsx` (delete Sandbox describe; keep/assert `/allocations` + manager `/portfolios`) | ⚠️ exists, must edit |
| guard | exactly 2 `/discovery/crypto-sma` refs removed | grep gate | `grep -rc 'discovery/crypto-sma' src/` = 28 after | ❌ Wave 0 (encode as a content-inspecting test or a CI grep) |
| guard | knip clean | knip | `npx knip` | ✅ tool exists |
| guard | `scenario.ts` zero-diff | git | `git diff --exit-code src/lib/scenario.ts` | n/a |

### Wave 0 Gaps
- [ ] `scenarios/page.test.ts` — replaces `page.role-gate.test.ts`; asserts the 307 redirect target.
- [ ] FLOW-01 attach-back test for the chosen wiring.
- [ ] Composer self-link-removed assertion.
- [ ] `Sidebar.test.tsx` edit (delete the 6-`it` Sandbox describe block).
- [ ] A `/discovery/crypto-sma` reference-count guard (grep or test) so a future edit can't silently break a default-landing redirect.

## Security Domain

> security_enforcement not false in config → included (lightweight — this is a routing/nav phase).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `/scenarios` retirement REMOVES a `createAdminClient()` (RLS-bypass) read surface — **net security improvement**. The institutional-universe leak that `page.role-gate.test.ts` guarded is eliminated entirely (the admin read is gone). Confirm the redirect target `/allocations` keeps its own auth (it does — dashboard layout + page guards). |
| V5 Input Validation | n/a | No new user input. The redirect target is a static string. |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Open redirect | Tampering | N/A — redirect target is a hardcoded internal path, not user-controlled. |
| Privilege leak via retired route | Info disclosure | ELIMINATED — removing the admin-client read closes the C-0017 leak vector; verify the new page reads nothing. |
| Stranding a manager | Availability | `/portfolios` + 25 consumers UNCHANGED; no role-redirect added (Pitfall 5). |

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Three fractured allocator surfaces (`/scenarios` Sandbox, `/portfolios`, own-book Scenario tab) | One composer at `/allocations?tab=scenario` (Phase 29 spine) | v1.2 | `/scenarios` redirect + nav consolidation are now safe because Phase 29 absorbed the example universe |
| `redirect()` 302 | `redirect()` 307 (preserves method) | Next 13+ | Use the default 307; do not reach for `permanentRedirect`/308 |

**Deprecated/outdated in this codebase:**
- The `portfolios/page.tsx:14-16` JSDoc claims allocator what-if "lives on /scenarios" — **stale after this phase**; update the comment to point at `/allocations?tab=scenario`.
- `api/strategies/[id]/returns/route.ts:29` JSDoc references the legacy `/scenarios` admin-client path — cosmetic.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Phase-29 exit gate added a test that the Browse drawer renders `is_example` provenance | IMPACT-02 migration | LOW — if absent, add a one-line composer-test assertion. The load-bearing IMPACT-02 peer-suppression is independently covered (verified) regardless. |
| A2 | Option (b) — discovery `?portfolio=` — is the planner's choice over option (a) | FLOW-01 | LOW — both options reuse `AddToPortfolio`'s insert; (a) is also valid. Either avoids the dead `?add=` param. Planner decides UX. |

**All other claims are `[VERIFIED]` against current `main` or `[CITED]` from the bundled Next.js 16 docs.**

## Open Questions (RESOLVED)

1. **FLOW-01 wiring (a) vs (b)** — RESOLVED: planner chose option (b) (`AddToPortfolio` reads the `?portfolio=` param and pre-selects the owned portfolio). 32-01 implements this; no live unknown remains.
2. **Optional belt-and-suspenders composer assertion for example-universe provenance** — RESOLVED (deferred): explicitly NOT a coverage gap (`ScenarioComposer.test.tsx:2978-2993` is a verified superset of the ScenarioBuilder honesty IMPACT-02 coverage; the only unique `sandbox-example-universe-badge` assertion is intrinsic to the retired surface). 32-02 asserts the parity rather than porting a redundant test.

## Environment Availability

> Skipped — pure source-edit phase (routing/nav/test). No external tools/services/runtimes required beyond the existing Node/Vitest toolchain already in CI.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md mandate honored:** read `node_modules/next/dist/docs/` for the canonical Next.js 16 `redirect()` API before recommending the pattern. Verified `redirect()` returns 307, throws `NEXT_REDIRECT`, no `return` needed.
- **Surgical changes (Rule 3):** touch only the 2 FLOW-01 links, `/scenarios/page.tsx` (→ redirect), `Sidebar.tsx` (remove item + icon), composer self-link, and the 4 deletes. Do NOT refactor `/portfolios` internals.
- **Root-cause (Rule 6):** FLOW-01 fix is structural (attach-back), not another fixed slug.
- **Tests verify intent (Rule 9):** the IMPACT-02 + redirect + reference-count guards must FAIL when the behavior regresses (non-vacuous).
- **VERSION bump:** CONTEXT.md says NO VERSION/package.json bump and no `.planning` commits (commit_docs=false; handled by /ship). NOTE this contradicts the global memory "Version bump both files" — defer to the phase CONTEXT.md (locked decision) for this phase.
- **Coverage gate:** `frontend-coverage` CI job is blocking (lines 82 / functions 74 / branches 72). Deleting ScenarioBuilder + its test should be coverage-neutral-to-positive (both numerator and denominator drop); the new redirect/FLOW-01 tests add covered lines.

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` — `redirect()` API, 307 default, Server Component usage, `never` return.
- `node_modules/next/dist/docs/01-app/02-guides/redirecting.md` — redirect mechanism comparison table (redirect vs next.config vs proxy).
- Codebase reads/greps on `main` (all `[VERIFIED]` claims) — `Sidebar.tsx`, `ScenarioComposer.tsx`, `ScenarioBuilder.tsx`, `ScenarioBuilder.honesty.test.tsx`, `ScenarioComposer.test.tsx`, `scenarios/page.tsx`, `page.role-gate.test.ts`, `AllocationsTabs.tsx`, `AddToPortfolio.tsx`, `PortfolioOptimizer.tsx`, `portfolios/{page,[id]/page,[id]/manage/page}.tsx`, `(dashboard)/layout.tsx`, `knip.json`, full `/discovery/crypto-sma` + `/portfolios` + `/scenarios` reference greps.

## Metadata

**Confidence breakdown:**
- `/discovery/crypto-sma` reference map: HIGH — exhaustive grep, every ref classified.
- FLOW-01 `?add=` is a dead param: HIGH — grep proves no consumer.
- `/portfolios` has no route-level role gate: HIGH — read page + layout.
- IMPACT-02 coverage parity: HIGH — line-by-line comparison of both test files.
- knip orphans = none (EquityCurveChart/MetricCard are file-private): HIGH — corrects CONTEXT.md's stated assumption.
- Composer self-link landmine: HIGH — direct read of `ScenarioComposer.tsx:1621`.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable; codebase-internal, low churn)
