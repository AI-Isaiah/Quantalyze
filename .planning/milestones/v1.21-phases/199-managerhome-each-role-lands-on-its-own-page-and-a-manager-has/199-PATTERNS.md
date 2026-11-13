# Phase 199: MANAGERHOME - Pattern Map

**Mapped:** 2026-11-09
**Files analyzed:** 30 (new + modified, grouped where they share one pattern)
**Analogs found:** 27 / 30
**Citation rule:** code is cited by file and symbol, never by line number.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/routing/default-route.ts` (MOD: `ROLE_HOME_ROUTE = "/home"`) | config (data-only) | n/a | itself (`DEFAULT_AUTHENTICATED_ROUTE`) | exact |
| `src/lib/routing/role-home.ts` (NEW: `roleSurfaceHome`, `roleHomeFor`, `safeRedirectPath`) | utility (pure) | transform | `src/lib/auth/requireRolePage.ts` `homeHref` ternary + `src/lib/approval.ts` `isProfileApproved` | exact (logic copied) |
| `src/lib/routing/role-home.test.ts` (NEW) | test | unit | `src/lib/auth/requireRolePage.test.ts` | role-match |
| `src/app/home/page.tsx` (NEW) | page (RSC redirect) | request-response | `src/lib/auth/requireRolePage.ts` error discipline + `src/app/(dashboard)/layout.tsx` admin computation | role-match |
| `src/app/home/page.test.tsx` (NEW) | test | unit (mocked client) | `src/app/(auth)/pending-approval/page.test.tsx` (`NEXT_REDIRECT:` asserts) | role-match |
| `src/proxy.ts` (MOD) | middleware | request-response | itself (`PUBLIC_ROUTES`, `isAuthBounceExempt`, signed-in bounce) | exact |
| `src/app/(auth)/login/page.tsx`, `src/components/auth/LoginForm.tsx` (MOD) | page + client component | request-response | itself; `redirectTo` prop replaces `router.push("/discovery/crypto-sma")` in `handleSubmit` | exact |
| `src/app/(auth)/pending-approval/page.tsx`, `src/components/auth/OnboardingWizard.tsx`, `src/app/(marketing)/page.tsx`, `src/components/marketing/MarketingHeaderActions.tsx` (MOD) | page/component | request-response | the `DEFAULT_AUTHENTICATED_ROUTE` importers | exact |
| Error/not-found boundaries: `src/app/error.tsx`, `src/app/not-found.tsx`, `(dashboard)/error.tsx`, `admin/error.tsx`, `allocations/error.tsx`, `compare/error.tsx`, `strategy/[id]/error.tsx` (MOD) | component | static link | `(dashboard)/error.tsx` `<Link href="/discovery/crypto-sma">` | exact (swap literal for `ROLE_HOME_ROUTE`) |
| 13 admin page guards `src/app/(dashboard)/admin/**/page.tsx` (MOD) | page guard | request-response | `src/app/(dashboard)/admin/page.tsx` `isAdminUser` guard | exact |
| `src/lib/auth/requireRolePage.ts` (MOD: use `roleSurfaceHome`) | utility (guard) | request-response | itself | exact |
| `src/app/(dashboard)/strategies/layout.tsx` (MOD: drop role guard) | layout | request-response | itself (`StrategiesLayout`) | exact |
| `src/app/(dashboard)/strategies/new/layout.tsx`, `strategies/[id]/layout.tsx` (NEW) | layout guard | request-response | `StrategiesLayout` current body | exact |
| `src/__tests__/strategies-guard-coverage.test.ts` (NEW) | test | structural (source scan) | `src/__tests__/phase-149-my-strategies-parity.test.ts` (`stripComments`, `productionSources`) | role-match |
| `src/app/(dashboard)/requireRolePage-wiring.test.tsx` (MOD) | test | structural | itself | exact |
| `next.config.ts` (MOD: `/my-strategies` 308) | config | n/a | `redirects()` `/scenarios` rule | exact |
| `src/lib/routing/route-contract-manifest.ts` (MOD: `/my-strategies` exception, `/home` public) | config | n/a | `/scenarios` manifest row | exact |
| `src/app/(dashboard)/strategies/page.tsx` (MOD: merge, role read, Health) | page (RSC) | CRUD read | itself + `src/app/(dashboard)/my-strategies/page.tsx` (allocator reads) | exact |
| `src/app/(dashboard)/strategies/StrategiesSection.tsx`, `StrategiesEmptyState.tsx` (MOVED from `my-strategies/`) | client component host | request-response | `my-strategies/MyStrategiesSection.tsx`, `MyStrategiesEmptyState.tsx` | exact (move) |
| `src/app/(dashboard)/my-strategies/**` (DELETE) | — | — | precedent: `/scenarios` retirement | exact |
| `src/components/strategy/StrategyTable.tsx` (MOD: decouple `managerRows`, Health column) | component | transform/render | itself | exact |
| `src/lib/freshness.ts` (MOD: export `seriesVerdictOf`) | utility | transform | `bucketSeriesAge` (private) | exact |
| `src/lib/strategy-health.ts` (+test) (NEW) | utility (pure) | transform | `src/lib/closed-sets.ts` `deriveEmptySeriesState`, `isComputedAnalytics`; `src/lib/status-surface-copy.ts` totality idiom | role-match |
| `src/app/(dashboard)/strategies/StrategiesLegend.tsx` (+test) (NEW) | component | static render | `src/components/strategy/OwnershipTag.tsx` `LABELS`, `src/components/ui/Badge.tsx` `statusLabelMap` | partial |
| `src/lib/degrade-warnings.ts` (+test) (NEW) | utility (copy registry) | transform | `src/lib/status-surface-copy.ts` | role-match |
| `src/__tests__/degrade-warning-scan.test.ts` (NEW) | test | structural | `phase-149-my-strategies-parity.test.ts` scan helpers | role-match |
| `src/__tests__/role-home-call-sites.test.ts` (NEW) | test | structural | same; plus `trim-removed-surfaces.test.tsx` `hasRedirectRule` | role-match |
| `src/components/layout/Sidebar.tsx` (`buildNavSections`, `buildMobileNav`), `DashboardChrome.tsx` `isWide` (MOD) | component | config | itself | exact |
| `e2e/role-home.spec.ts` (NEW) + `e2e/helpers/login.ts` predicate | e2e test | request-response | `e2e/helpers/login.ts` `loginAs`, `e2e/route-redirects.spec.ts` | role-match |
| `analytics-service/services/job_worker.py` departed key ids (CONDITIONAL, Open Question 3) | service | batch | — | none (see No Analog) |

## Pattern Assignments

### `src/lib/routing/default-route.ts` (config, data-only)
Keep the file data-only (imported by `src/proxy.ts`). Current content to replace:
```typescript
/**
 * Default route for an authenticated user.
 *
 * This file is data-only — it imports nothing and runs no logic — so the
 * proxy, the landing page and the marketing header share one literal
 * without importing `src/proxy.ts`. (Mirrors `route-contract-manifest.ts`.)
 */
export const DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma";
```
Becomes `export const ROLE_HOME_ROUTE = "/home";`; rename every importer (proxy, `(marketing)/page.tsx`, `MarketingHeaderActions.tsx`, `MarketingHeaderActions.test.tsx`).

### `src/lib/routing/role-home.ts` (utility, pure)
**Analog:** `src/lib/auth/requireRolePage.ts`, symbol `requireRolePage`, the internal home derivation:
```typescript
  const homeHref =
    role === "manager"
      ? "/strategies"
      : role === "allocator"
        ? "/allocations"
        : "/pending-approval";
```
Lift into `roleSurfaceHome(role)` (adding `both -> /allocations`), then replace the ternary in `requireRolePage` with a call (outputs unchanged for the guard because `both` never reaches the redirect). No `import "server-only"` (client `LoginForm` tests import it). `roleHomeFor` composes `isProfileApproved` (`src/lib/approval.ts`) then admin then `roleSurfaceHome`. `safeRedirectPath` must be the proxy's exact rule, which today is inline in `proxy`:
```typescript
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safePath = redirect && /^\/[a-z]/.test(redirect) ? redirect : DEFAULT_AUTHENTICATED_ROUTE;
```
Replace with `safeRedirectPath(redirect) ?? ROLE_HOME_ROUTE` so the rule has one home. RESEARCH.md Pattern 1 carries the full sketch.

### `src/app/home/page.tsx` (RSC redirect page)
**Analog:** `requireRolePage` failure discipline (DB error: console.error + `captureToSentry(..., level: "error")` + throw, never redirect; `redirect()` OUTSIDE any try/catch):
```typescript
  if (error) {
    console.error("[requireRolePage] profile lookup failed:", { user_id: user.id, code: error.code, message: error.message });
    captureToSentry(error, { tags: { role_gate_failure: "true", role_gate_kind: "lookup_error", role_gate_code: error.code ?? "unknown" }, extra: { user_id: user.id, message: error.message ?? "" }, level: "error" });
    throw error;
  }
  ...
  // OUTSIDE any try/catch (Pitfall 2): redirect() throws NEXT_REDIRECT.
  if (!owns) redirect(homeHref);
```
Admin flag: copy the `(dashboard)/layout.tsx` computation (`profile.is_admin === true`, else `isAdminUser(supabase, user)`), so `/home` and the admin page guards share one predicate (loop-freedom). `export const dynamic = "force-dynamic"` as in `StrategiesLayout`. Full sketch in RESEARCH.md "The role-home page".

### `src/proxy.ts` (middleware)
**Analog:** itself. Add `"/home"` to `PUBLIC_ROUTES` AND an `isHomeRoute` term to `isAuthBounceExempt` (both, or loop):
```typescript
  const isAuthBounceExempt =
    isForQuantsRoute ||
    isSecurityRoute ||
    ...
    isFactsheetShareRoute ||
    isResetPasswordRoute;
  if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
```
Each existing exempt term has a named `const isXRoute = path === "/x" || path.startsWith("/x/")` above it plus a comment; follow that.

### Admin page guards (13 files) and error boundaries
**Analog:** `src/app/(dashboard)/admin/page.tsx`:
```typescript
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");
```
-> `redirect(ROLE_HOME_ROUTE)`. Enumerate with `grep -a -rln 'redirect("/discovery/crypto-sma")' "src/app/(dashboard)/admin"`. Error boundaries: `(dashboard)/error.tsx` `<Link href="/discovery/crypto-sma">` -> `<Link href={ROLE_HOME_ROUTE}>`; label from UI-SPEC.

### `LoginForm` / login page
`LoginForm` `handleSubmit` today: `router.push("/discovery/crypto-sma");`. Add prop `redirectTo: string | null`; push `redirectTo ?? ROLE_HOME_ROUTE`. Login page (already awaits `searchParams` with `redirect`) computes `safeRedirectPath(params.redirect ?? params.next)` and also routes the `params.code` branch's raw `redirect(params.redirect || "/onboarding")` through it (open-redirect fix).

### `strategies/new/layout.tsx`, `strategies/[id]/layout.tsx` (NEW) and `strategies/layout.tsx` (MOD)
**Analog:** `StrategiesLayout` in `src/app/(dashboard)/strategies/layout.tsx`, whole body:
```typescript
export const dynamic = "force-dynamic";

export default async function StrategiesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/strategies");
  }
  await requireRolePage(supabase, user, "manager");
  return <>{children}</>;
}
```
Copy verbatim into the two new layouts (adjust the login `redirect=` path and docblock). The parent keeps `force-dynamic` + session check, drops `requireRolePage`, and its docblock ("single guard site for the sell-side subtree") must be rewritten to point at the new layouts.

### `src/__tests__/strategies-guard-coverage.test.ts`, `role-home-call-sites.test.ts`, `degrade-warning-scan.test.ts` (structural)
**Analog:** `src/__tests__/phase-149-my-strategies-parity.test.ts` helpers `stripComments` and `productionSources`:
```typescript
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Walk src/ for production sources (no tests, no __tests__, no .d.ts). */
function productionSources(dir: string, acc: string[] = []): string[] { ... readdirSync / statSync recursion ... }
```
House rule from the same file: a missing pinned source is a FAILURE, not a skip. Allowlists are count-pinned with a reason per entry. For `next.config.ts` assertions use `hasRedirectRule` from `src/__tests__/trim-removed-surfaces.test.tsx`:
```typescript
function hasRedirectRule(stripped: string, source: string, destination: string, permanent: boolean): boolean {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `source:\\s*"${esc(source)}",\\s*destination:\\s*"${esc(destination)}",\\s*permanent:\\s*${permanent}\\b`,
  ).test(stripped);
}
```

### `next.config.ts` + `route-contract-manifest.ts` (config)
**Analog:** the `/scenarios` rule in `redirects()`:
```typescript
        source: "/scenarios",
        destination: "/allocations?tab=scenario",
        permanent: true,
```
and its manifest row (`route: "/scenarios", class: "exception", redirectFrom: "/scenarios", notes: "EXCEPTION: MOVED route ..."`). Add `{ source: "/my-strategies", destination: "/strategies", permanent: true }` with a Phase 199 D-01 comment, flip the `/my-strategies` row to `exception` + `redirectFrom`, add `/home` as `public`, keep alphabetical. Same task deletes `my-strategies/` (Rule 3/Rule 4 lockstep). The `/strategies` row's notes ("Manager/admin strategies list") need updating to "every strategy owner".

### `src/app/(dashboard)/strategies/page.tsx` (RSC, CRUD read) + moved section host
**Analogs:** itself (manager list read pinned by parity pin 10's regex on `.select(\`*, strategy_analytics (${CATEGORY_RANKING_ANALYTICS_COLUMNS})\`).eq("user_id", user.id)`; keep that chain intact, put the role-conditional `.or("source.neq.wizard,status.neq.draft")` after it) and `my-strategies/page.tsx` for the allocator reads (`getStrategylessActiveKeys`, `getRealPortfolio`, `getOwnRowPercentiles`, and its null-is-read-failure handling, 149 WR-01). Role read uses `requireRolePage`'s error discipline. Mount the moved `StrategiesSection` (from `MyStrategiesSection.tsx`) for every role; callbacks only when `isAllocator`. Update `ContributionWizardOverlay.preselect.test.tsx` import path.

### `src/components/strategy/StrategyTable.tsx`
**Analog:** itself. The six `managerRows`-keyed switches listed in RESEARCH.md Pattern 5 (columns + `emptyRowColSpan`, in-name badge, `OwnershipTag`, actions cell, Simulate Impact, note row). Keep literal `const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;` and the `s.status === "published"` guard near `<SimulateImpactButton` (parity pin 7). Hoist the private `rowChipStatus` to a non-client lib (a server page cannot call a function exported from a `"use client"` module).

### `src/lib/freshness.ts` (export `seriesVerdictOf`)
Wrap, do not copy, the private ladder:
```typescript
function bucketSeriesAge(seriesEndMs: number, now: Date): SeriesVerdict {
  const days = Math.floor((now.getTime() - seriesEndMs) / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(days)) return "stale";
  if (days < 0) {
    const daysAhead = -days;
    return daysAhead <= SERIES_END_FUTURE_ALLOWANCE_DAYS ? "fresh" : "future";
  }
  if (days <= SERIES_FRESH_DAYS) return "fresh";
  if (days <= SERIES_STALE_DAYS) return "warm";
  return "stale";
}
```

### `src/lib/strategy-health.ts` and `src/lib/degrade-warnings.ts` (pure libs with closed copy)
**Analog:** `src/lib/status-surface-copy.ts`. Copy its conventions: header docblock stating copy is verbatim from the UI-SPEC and pinned by a test; special characters as named constants (`const EM_DASH = "—"; // U+2014`, `MIDDLE_DOT`); numbers rendered from constants, never typed (`const STALL_MINUTES = STALL_THRESHOLD_MS / 60_000;`); tables `satisfies Record<Union, ...>` with exhaustive switches so a missing state is a compile error; "No client directive: server pages call these functions." Imports use relative `./closed-sets` style within `src/lib`. Inputs: `isComputedAnalytics`, `isUntrustedKeySyncStatus`, `deriveEmptySeriesState` (`src/lib/closed-sets.ts`), `seriesVerdictOf`, `apiKeyLabelById` (`src/lib/api-key-label.ts`), `formatCloseDay`/`formatUnpricedDays` (`src/lib/factsheet/returns-unit.ts`).

### `StrategiesLegend.tsx`
**Partial analogs:** `OwnershipTag.tsx` `LABELS` (export it), `Badge.tsx` `statusLabelMap`, `StrategyTable.tsx` `DATA_STATE_CHIP`. Render the real chip components, not re-typed classes (UI-SPEC). Add a runtime `STRATEGY_STATUSES` tuple checked against `Strategy["status"]` (`src/lib/types.ts`).

### Sidebar / DashboardChrome
`buildNavSections` drops the allocator "My Strategies" entry and gives every role one "Strategies" `href="/strategies"`; `buildMobileNav` per UI-SPEC (OQ-5: allocator bottom bar unchanged). Remove `my-strategies` from `DashboardChrome` `isWide` and its test rows/`SCANNED_TREES` entry.

### e2e
`e2e/helpers/login.ts` `loginAs` waits `^\/(discovery|strategies|dashboard)(\/|$)`; export one pathname-anchored predicate that adds `allocations` and `admin`, reuse at the sites in RESEARCH.md Pitfall 3. New seeded spec must also be listed in `.github/workflows/ci.yml` `e2e-seeded` (two-place rule). 308 canary goes into `e2e/route-redirects.spec.ts` beside the `/scenarios` canary.

## Shared Patterns

### Redirect discipline
**Source:** `src/lib/auth/requireRolePage.ts`. **Apply to:** `/home` page, new layouts, merged page role read, admin guards. DB error throws (never redirects); `redirect()` at top level outside try/catch; `export const dynamic = "force-dynamic"` on guard layouts.

### One rule, one home
**Apply to:** home route, redirect sanitizing, series ladder, chip status. Hoist/export the existing function (`homeHref` -> `roleSurfaceHome`, proxy regex -> `safeRedirectPath`, `bucketSeriesAge` -> `seriesVerdictOf`, `rowChipStatus` -> lib) rather than copy it.

### Structural tests
**Source:** `phase-149-my-strategies-parity.test.ts` (`stripComments`, `productionSources`, missing-source = failure) and `trim-removed-surfaces.test.tsx` (`hasRedirectRule`). **Apply to:** guard coverage, call-site, degrade scan, 308 assertions. Every new gate needs Rule 9 neuter/RED/restore evidence (byte backup with `cp -p`, `cmp`).

### Copy modules
**Source:** `src/lib/status-surface-copy.ts`. **Apply to:** `strategy-health.ts`, `degrade-warnings.ts`, legend copy.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/degrade-warnings.ts` render-sample registry test semantics | test | unit | No existing registry tests rendered samples against a scope; use RESEARCH.md Pattern 8 (`status-surface-copy.test.ts` is only a character-pin analog). |
| `analytics-service/services/job_worker.py` departed key ids | service | batch | Conditional on Open Question 3; no existing per-key departed field. If taken, brief must include pytest (run from `analytics-service/`) and mypy strict. |
| `data-degrade-id` marker convention | convention | — | No marker attribute exists yet; introduced by this phase. |

## Sequencing notes for the planner
Files shared with Phase 196 (StrategyTable, strategies page, section host, wizard steps, `next.config.ts`, manifest, DashboardChrome test, factsheet files): plan after 196 merges per RESEARCH.md "Phase 196 overlap". `src/app/strategy/[id]/error.tsx` drops from the home-site list if 196 plan 18 deletes it first.

## Metadata
**Analog search scope:** `src/lib/routing`, `src/lib/auth`, `src/lib` (freshness, status-surface-copy, closed-sets), `src/proxy.ts`, `src/app/(dashboard)/{strategies,my-strategies,admin}`, `src/__tests__`, `next.config.ts`, `e2e/helpers`.
**Files scanned:** about 15 read directly, plus RESEARCH.md citations verified at worktree HEAD.
**Pattern extraction date:** 2026-11-09
