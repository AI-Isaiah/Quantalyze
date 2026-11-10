# Phase 199: MANAGERHOME - Research

**Researched:** 2026-11-09
**Domain:** Next.js 16 App Router routing (role home, redirects, route-group guards), a shared client table (`StrategyTable`) serving two owner surfaces, server-derived row health, and a copy registry with source-scan tests (vitest).
**Confidence:** HIGH for the code facts (every one was read at worktree HEAD `e66e173eb`); MEDIUM for the degrade-warning inventory (a seed, the plan's first task re-measures it); LOW only where marked `[ASSUMED]`.

Code is cited by file and symbol, never by line number (orchestrator rule). No package is installed by this phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
#### Founder decisions (2026-11-09)
- **D-01 One list at `/strategies`, for every strategy owner.** Founder pick (2026-11-09): "/strategies for all owners (Recommended)". Allocators, managers and `both` all reach `/strategies`; `/my-strategies` permanently redirects (308) to it; the sidebar (desktop and mobile) has one "Strategies" entry. Only the index page's guard widens to admit allocators; `/strategies/new`, `/strategies/new/wizard` and `/strategies/[id]/edit` keep their current guards (the Phase 110 allocator wizard exception is unchanged).
- **D-02 The merged list keeps everything from both.** Founder pick (2026-11-09): "Everything from both (Recommended)". It keeps the Phase 149 `#`/`Pnn` ranking and its note, the placeholder row per key with no strategy, and every manager row action, row note, banner (wizard draft, just-submitted) and pending intros. Manager-only actions show by role; nothing is dropped silently. The `phase-149-my-strategies-parity` contract moves to the merged page and stays green.
- **D-03 Health is one word per row plus a legend.** Founder pick (2026-11-09): "One word + legend (Recommended)". Values: Healthy / Key problem / Analytics failed / Updating / Stale (no data since <date>), derived only from existing signals (key sync status, analytics computation status, `SERIES_STALE_DAYS`). The row note carries the detail. One legend explains the Health words and every status chip ("Team review", "Own capital", "Private", the pipeline chips and the rest).
- **D-04 App-wide degrade-warning sweep, factsheet after 196.** Founder pick (2026-11-09): "App-wide, factsheet after 196 (Recommended)". One registry and a RED test cover My allocation, the strategies list, Scenario and the factsheet. Plans that edit factsheet files (`src/app/factsheet/**`, tearsheet, share route) execute only after Phase 196 merges, rebased on main.

### Claude's Discretion
(decided, not founder picks)
- **CD-01 One role-home function.** A pure `roleHomeFor(profile)` in `src/lib/routing/` replaces the role-blind literal at every "home" and post-sign-in site above: admin (`is_admin`) -> `/admin`; allocator -> `/allocations`; manager -> the merged list; `both` without admin -> `/allocations` (allocator workspace leads the sidebar). Not approved -> `/pending-approval`; not onboarded -> `/onboarding` (unchanged). Static error/not-found pages that cannot read a profile link to one server route (e.g. `/home`) that redirects by role, so every site reads one choice. A test enumerates the call sites and fails on a new hard-coded `/discovery/crypto-sma` used as home.
- **CD-02 Deep links win.** A safe same-origin `?redirect=` (the proxy's existing `^/[a-z]` rule) is honoured by `LoginForm` before the role home; today it is dropped.
- **CD-03 Wrong-role bounces** (`requireRolePage`, admin page guards) send the user to their own role home, not to Discovery.
- **CD-04 Health thresholds** reuse existing constants (`SERIES_STALE_DAYS`, `isUntrustedKeySyncStatus`, `isComputedAnalytics`); no new threshold is invented.
- **CD-05 Degrade-warning test.** One registry of degrade warnings; a test fails when a registered warning names neither a day range nor a key, or has no action sentence, and a scan fails on an unregistered warning in a scanned surface. A dead key's warning names only that key (founder rule: a revoked key affects only itself).
- **CD-06 Old URL.** The retired list route permanently redirects (308) to the kept one, query string preserved.

### Carried forward
- Phase 198 D-01: My allocation's missing-data message already names key + days + action; this phase registers it, does not rewrite it.
- Phase 198 deferred: sidebar "Add a Strategy" still opens the manager `WizardClient` for allocators (198 FD-3). Not this phase; Phase 200 owns the one add-a-strategy entry point.
- Phase 196 D-03: `/strategy/[id]` and friends 308 to `/factsheet/[id]`; row links on the merged list point at `/factsheet/[id]`.
- Phase 194 D-04/D-15/D-22: figure gate and AUM visibility apply to the list columns unchanged.

### Deferred Ideas (OUT OF SCOPE)
CONTEXT.md carries no `## Deferred Ideas` section. Out of scope by the carried-forward items: the one add-a-strategy entry point (Phase 200, 198 FD-3). Factsheet-file edits are not out of scope but are sequenced after Phase 196 (D-04).

### UI-SPEC (approved) — binding visual contract
`199-UI-SPEC.md` is approved and binding for copy, Health words and tones, legend content, role matrix, nav and error-page labels. Its open questions OQ-1..OQ-6 carry recommended defaults; see "UI-SPEC open questions: verdicts" below for which defaults code confirms and which it proves wrong.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTE-01 | After sign-in, an allocator, a manager and an admin each land on a page made for their role, not on a discovery category. | Pattern 1 (one `roleHomeFor` + one `/home` server route + `ROLE_HOME_ROUTE` constant), Pattern 2 (`LoginForm` deep link, proxy bounce), call-site inventory, e2e login-wait census (Pitfall 3). |
| LEAN-01 | A manager has one strategies list (`/strategies` and `/my-strategies` merged). | Pattern 3 (guard split by nested layouts), Pattern 4 (one mount, role-gated furniture), Pattern 5 (`StrategyTable` mode decoupling), 308 redirect + route-contract lockstep, nav changes, test census. |
| ROUTE-11 | Every degrade warning names the affected days or key and says what the user can do. My Strategies shows each strategy's health, and its status chips have a legend. | Pattern 6 (`strategyHealthOf` server-side), Pattern 7 (legend from closed sets), Pattern 8 (degrade registry + render-sample test + marker scan), seed inventory, Phase 196 sequencing. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the planner must honour (CLAUDE.md, AGENTS.md, global CLAUDE.md, auto-memory). Treated as locked.

- **This is NOT the Next.js you know** (AGENTS.md): read the local Next docs before writing routing code. The worktree has **no `node_modules`** (measured), so `node_modules/next/dist/docs/` is absent here; this research used the official docs (`redirect`, `next.config redirects`, both fetched this session). The executor must `npm ci` in the worktree before reading local docs or running any test.
- Rules 1-12 (global CLAUDE.md): surgical changes, root cause, match conventions, fail loud, tests encode intent (Rule 9: a gate must be able to fail; neuter, see RED, restore from a byte backup, never `git checkout`/`stash` on uncommitted work).
- **CHANGELOG discipline**: every ship writes a CHANGELOG entry in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- **CI gate integrity**: never write a skip-CI token in a commit message or PR body, not even to deny it.
- **Design System**: read `DESIGN.md` before UI decisions (the UI-SPEC already binds it).
- **Cite by symbol, not line number** in tracked prose (the `[164.7-CITATION-DRIFT-01]` class).
- **Public repo**: no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence.
- **Test discipline (memory)**: always `grep -a`; data-integrity and user-facing gates must be able to fail; a new test file can move several censuses, grep them all.
- **Ship planning guard (memory)**: a ship branch changes nothing under `.planning`.
- **GSD**: phases run via skills, never hand-dispatched; `git diff` after every gsd-tools handler run.
- **Before `CREATE OR REPLACE`** re-base on the latest definition (not expected in this phase: no migration is needed; see Architecture).
- **Agent gates include mypy** (memory): only if a plan touches `analytics-service/` (see Open Question 3: `DepartedHistoryNote` needs the derive to emit key ids).

## Summary

The phase has three independent strands that meet only in tests and in `src/app/(dashboard)/strategies/page.tsx`.

**Role home (ROUTE-01).** Today one data-only literal, `DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma"` (`src/lib/routing/default-route.ts`), feeds the proxy's signed-in bounce, the marketing page and the marketing header, and nine other sites hard-code the same path as "home". The proxy cannot read a profile (it is deliberately cookie-only, `getSession()`, no DB call). So the right shape is: one pure `roleHomeFor(profile)` in `src/lib/routing/`, one server page `src/app/home/page.tsx` that reads the profile and `redirect()`s to `roleHomeFor(...)`, and the data-only constant re-pointed to `"/home"` so every site that cannot read a profile (proxy, error boundaries, not-found, marketing header, client `LoginForm`, client `OnboardingWizard`) reads one choice through one hop. Sites that already hold a profile (`PendingApprovalPage`) call `roleHomeFor` directly.

**One list (LEAN-01).** `/strategies` is guarded `manager` by `StrategiesLayout`, which wraps the whole subtree. Widening only the index is done by moving the guard into two NEW nested layouts (`strategies/new/layout.tsx`, `strategies/[id]/layout.tsx`) and leaving `strategies/layout.tsx` with the session check only; no file moves. The merged page keeps the manager read (it is the only read that includes archived rows, wizard-draft filtering and the KCS key/share reads) and adds the allocator reads (`getStrategylessActiveKeys`, `getRealPortfolio`, `getOwnRowPercentiles(rows)`, `readPublicVerificationSignals`). The allocator furniture needs client callbacks, so one client host (today `MyStrategiesSection`, moved next to the page) mounts `StrategyTable` for every role. `StrategyTable` currently ties six behaviours to the presence of `managerRows`; they must be decoupled so a row can carry manager furniture, allocator furniture or both.

**Health and warnings (ROUTE-11).** Every Health input already exists server-side on the page (`feedingKeyIdsByStrategy`, `keysById`, shaped analytics with `series_end` and `analytics_updating`, `created_at`, `status`). The series verdict function in `src/lib/freshness.ts` (`bucketSeriesAge`) is not exported, and the chip-status coercion (`rowChipStatus`) is private to the client table; both must be hoisted so the server derivation reuses them rather than copying them. Degrade warnings are inline JSX sentences across `AllocationDashboardV2.tsx`, `MissingDataMessage.tsx`, `ScenarioComposer.tsx`, `status-surface-copy.ts` and the factsheet; the registry should hold render functions plus a fixture-rendered sample per entry, and the scan should key on a `data-degrade-id` marker rather than on visual class names (half the real warnings, including the whole 198 message, carry no `role="status"`).

**Primary recommendation:** Build in three waves: (A) `roleHomeFor` + `/home` + every home/bounce site + proxy + e2e login-wait fixes; (B) Health lib + registry + allocations/list warnings; (C) the list merge, 308, nav and censuses, sequenced after Phase 196's plans 02, 06, 15, 18 and 20 merge (they edit the same files), and factsheet warnings after 196 merges (D-04).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide a signed-in user's home | Frontend Server (SSR page `/home`) | — | Needs the profile row (role, statuses, `is_admin`); the proxy is cookie-only by design and error boundaries are client components. |
| Bounce signed-in users off `/login`, `/signup`, `/` | Frontend Server (proxy) | SSR page `/home` | Proxy can only name a path; it names `/home`, the page decides. |
| Honour `?redirect=` after sign-in | Browser (`LoginForm`) | SSR (login page passes the sanitized value as a prop) | Sign-in is client-side (`signInWithPassword`); sanitize once on the server page, pass a prop, avoid `useSearchParams` Suspense requirements. |
| Retire `/my-strategies` | CDN/Edge config (`next.config.ts` `redirects()`) | — | Config redirects run before the filesystem and the proxy; matches the `/scenarios` and `/portfolios` precedents. |
| Who may open the list index vs. sub-routes | Frontend Server (segment layouts) | Database (RLS `strategies_read`) | Layout guards are the repo's pattern; RLS is the backstop. |
| Row set, keys, compute state, share notes | Frontend Server (RSC page) | Database (owner-scoped reads under RLS) | Existing manager read; owner-scoped `.eq("user_id", user.id)`. |
| Health word per row | Frontend Server (pure lib called by the page) | Browser (renders the given word) | UI-SPEC: never a client clock; the derivation needs `Date.now()` and key status. |
| Legend | Browser/RSC render | — | Static, generated from closed sets. |
| Degrade-warning copy | Shared lib (registry) | Browser/RSC render sites | One registry, many render sites. |
| Departed-key identity for `DepartedHistoryNote` | API/Backend (analytics-service derive) | Frontend Server (reader) | The derive is the only place that knows which departed key was left out (see Open Question 3). |

## Standard Stack

No new library. Everything below is already in `package.json` (read this session).

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.4.2 (lockfile `node_modules/next`) | App Router, `redirect()`, `next.config` `redirects()`, segment layouts | The app's framework. `[VERIFIED: package-lock.json]` |
| react | 19.3.1 | Rendering | `[VERIFIED: package.json]` |
| @supabase/ssr | ^0.12.7 | Server client for the profile read in `/home` | Used by every server page. `[VERIFIED: package.json]` |
| vitest | ^5.0.3 | Unit, structural (source-scan) and component tests | Repo standard; jsdom default project. `[VERIFIED: package.json, vitest.config.ts]` |
| @playwright/test | ^1.64.1 | e2e: role landing, 308 canary, reflow sweep | Repo standard. `[VERIFIED: package.json]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `src/app/home/page.tsx` calling `redirect()` | A route handler `src/app/home/route.ts` returning `NextResponse.redirect` | A page is the documented server-component redirect and works for client `router.push` and `<Link>`; a route handler is a hard request and its behaviour under the client router's RSC fetch is not documented. Use the page. |
| A client-side profile read in `LoginForm` (as `OnboardingWizard` does today) | — | Duplicates the role decision in the browser; two copies drift. Use `/home`. |
| A route group `strategies/(manager)/` | Two nested `layout.tsx` files | A route group moves `new/` and `[id]/` (dozens of files, imports like `@/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep` used by `MyStrategiesSection`) and collides with Phase 196 plan 06's wizard-step edits. Nested layouts move nothing. |

**Installation:** none.

## Package Legitimacy Audit

No external package is installed or added by this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none. No banned package (global CLAUDE.md table) is touched.

## Architecture Patterns

### System Architecture Diagram

```
                 sign-in form submit                     any "home" click / signed-in bounce
 Browser ──► LoginForm.signInWithPassword ──► router.push( safeRedirect ?? ROLE_HOME_ROUTE )
                                                   │                         ▲
 /login?redirect=/x ── login page (RSC) ──sanitize─┘                         │
                                                                             │
 GET /login | /signup | /forgot-password | /  (session cookie) ──► proxy ──► 307 → (redirect param ?? ROLE_HOME_ROUTE)
 error.tsx / not-found.tsx / MarketingHeaderActions / OnboardingWizard ──► <Link|push> ROLE_HOME_ROUTE
 admin page guard (isAdminUser false) ──► redirect(ROLE_HOME_ROUTE)
                                                                             │
                                                    ROLE_HOME_ROUTE = "/home"│
                                                                             ▼
                          src/app/home/page.tsx (RSC, force-dynamic)
                             no user ─────────────────────────► redirect("/")
                             profile read error ──────────────► throw (error boundary), never a guess
                             profile ──► roleHomeFor(profile, isAdmin)
                                           ├ not approved ────► /pending-approval
                                           ├ admin ───────────► /admin
                                           ├ manager ─────────► /strategies
                                           └ allocator|both ──► /allocations

 GET /my-strategies?q ──► next.config redirects() 308 ──► /strategies?q
 GET /strategies ──► (dashboard)/layout approval gate ──► strategies/layout (session only)
                    ──► page.tsx: role read → manager read (+ wizard-draft rule by role)
                         → allocator reads (placeholder keys, portfolio, own percentiles, trust tier) when allocator|both
                         → key/member reads → compute-state/share-note reads
                         → strategyHealthOf(row, now) per row (server clock)
                         → client host <StrategiesSection> → StrategyTable(owner list mode, role flags)
                         → Legend panel (closed sets)
 GET /strategies/new/** | /strategies/[id]/** ──► new/layout or [id]/layout ──► requireRolePage("manager")
```

### Recommended Project Structure (new and moved files only)
```
src/lib/routing/
├── default-route.ts          # data-only: ROLE_HOME_ROUTE = "/home" (replaces DEFAULT_AUTHENTICATED_ROUTE)
├── role-home.ts              # pure roleHomeFor(), roleSurfaceHome(), safeRedirectPath()
└── role-home.test.ts
src/app/home/page.tsx         # the one server role-home redirect
src/app/(dashboard)/strategies/
├── layout.tsx                # session check + force-dynamic only (no role guard)
├── new/layout.tsx            # NEW: requireRolePage("manager")
├── [id]/layout.tsx           # NEW: requireRolePage("manager")
├── StrategiesSection.tsx     # moved from my-strategies/MyStrategiesSection.tsx (client host)
├── StrategiesEmptyState.tsx  # moved from my-strategies/MyStrategiesEmptyState.tsx
└── StrategiesLegend.tsx      # NEW (server-renderable)
src/lib/strategy-health.ts    # pure strategyHealthOf()
src/lib/degrade-warnings.ts   # the registry
src/__tests__/degrade-warning-scan.test.ts
src/__tests__/role-home-call-sites.test.ts
```
`src/app/(dashboard)/my-strategies/` is deleted (route served by the 308). File names above are recommendations; match neighbouring naming.

### Pattern 1: One role-home decision, one server hop

**What:** a pure function plus one redirect page; every other site names the page.

Facts it rests on (all read this session):
- `DEFAULT_AUTHENTICATED_ROUTE` is used by exactly three importers: `src/proxy.ts` (signed-in bounce `safePath`), `src/app/(marketing)/page.tsx` (`redirect(DEFAULT_AUTHENTICATED_ROUTE)` when `user`), `src/components/marketing/MarketingHeaderActions.tsx` ("Go to app" link); plus its test `MarketingHeaderActions.test.tsx`, which pins `expect(DEFAULT_AUTHENTICATED_ROUTE).toBe("/discovery/crypto-sma")`. `[VERIFIED: grep -a + Read of each file]`
- The proxy's file comment says the proxy does "Optimistic session check (cookie-only, no network call)" and the admin block says page-level `isAdminUser` is authoritative. `[VERIFIED: src/proxy.ts]` So the proxy cannot decide by role.
- `/` is public via `path === "/"` and is NOT in `isAuthBounceExempt`, so a signed-in GET `/` is bounced by the proxy before `(marketing)/page.tsx` runs; that page's `redirect` is a backstop. `[VERIFIED: src/proxy.ts]`
- `requireRolePage` already derives an internal home: `role === "manager" ? "/strategies" : role === "allocator" ? "/allocations" : "/pending-approval"`, and `both` is never redirected. `[VERIFIED: src/lib/auth/requireRolePage.ts, symbol requireRolePage]`
- `isProfileApproved` fails closed on unknown role and short-circuits `is_admin`. `[VERIFIED: src/lib/approval.ts]`
- The `(dashboard)` layout computes admin as `profile.is_admin === true`, falling back to `isAdminUser(supabase, user)` only when the flag is false. `[VERIFIED: src/app/(dashboard)/layout.tsx]`
- `SIGNUP_ROLES = ["manager", "allocator", "both"] as const` `[VERIFIED: src/lib/closed-sets.ts, symbol SIGNUP_ROLES]`

**Prescription:**
1. `src/lib/routing/default-route.ts`: replace the export with `export const ROLE_HOME_ROUTE = "/home";` (keep the file data-only; it is imported by the proxy). Rename every importer. The marketing header links `ROLE_HOME_ROUTE` (it reads only the session, so no extra profile read in the marketing layout).
2. `src/lib/routing/role-home.ts` (pure, no `server-only`, so client tests can import it):
   - `roleSurfaceHome(role)`: `manager → "/strategies"`, `allocator | both → "/allocations"`, anything else `→ "/pending-approval"`.
   - `roleHomeFor(profile | null, opts?: { isAdmin?: boolean })`: `!isProfileApproved(profile) → "/pending-approval"`; `isAdmin ?? profile.is_admin → "/admin"`; else `roleSurfaceHome(profile.role)`.
   - `safeRedirectPath(raw)`: returns `raw` when `typeof raw === "string" && /^\/[a-z]/.test(raw)`, else `null` (the proxy's rule, CD-02). The proxy imports it too, so there is one rule.
3. `requireRolePage`: replace its inline `homeHref` ternary with `roleSurfaceHome(role)` (identical outputs for the three roles and the unknown branch; `both` still never redirects). This keeps ROLE-03 ("the admin flag grants no marketplace surface") and removes the second copy. Recommendation, not `/admin` for admins here: the guard selects `role` only, and every PROD admin is `both` (CONTEXT evidence), who is never redirected.
4. `src/app/home/page.tsx`: `export const dynamic = "force-dynamic"`; `getUser()`; no user → `redirect("/")`; profile read `select("role, allocator_status, manager_status, is_admin")`; on read error throw (mirror `requireRolePage`'s DB-error branch: log + Sentry + throw, never redirect); compute `isAdmin` exactly as the `(dashboard)` layout does; `redirect(roleHomeFor(profile, { isAdmin }))` OUTSIDE any try/catch.
5. Proxy: add `"/home"` to `PUBLIC_ROUTES` AND to `isAuthBounceExempt` (both, or a signed-in GET `/home` is bounced to `/home` forever). Bounce fallback becomes `ROLE_HOME_ROUTE`. Route-contract manifest row `/home` class `public` (Rule 2 lockstep).
6. Admin guards (13 files, measured: `grep -a -rln 'redirect("/discovery/crypto-sma")' "src/app/(dashboard)/admin"` → 13): `redirect(ROLE_HOME_ROUTE)`. Loop-free: `/home` sends to `/admin` only when the same `isAdminUser` fallback says admin, and the admin page bounces only when `isAdminUser` says not admin. Pin this with a test. (`admin/partner-import` and `admin/partner-roi` are client pages with no server guard; out of scope, not "home".)

**Onboarding (CD-01 "not onboarded → /onboarding, unchanged"):** keep it where it is. The only reader of "onboarded" is `PendingApprovalPage` (`const onboarded = Boolean(profile?.display_name)`), and the signup trigger always populates `display_name` (`COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))` in `supabase/migrations/20260529150000_lock_profile_privileged_columns.sql`) `[VERIFIED: grep of the migration]`. `OnboardingWizard` does not write `display_name`. Putting a `display_name` check inside `roleHomeFor` would change nothing for new users and could trap a legacy null-name user in onboarding on every sign-in, so `roleHomeFor` does not check it. `PendingApprovalPage` keeps `redirect(onboarded ? roleHomeFor(profile) : "/onboarding")`.

**Example:**
```typescript
// src/lib/routing/role-home.ts — pure; values quoted from requireRolePage and approval.ts
import { isProfileApproved, type ApprovalProfile } from "@/lib/approval";

export function roleSurfaceHome(role: string | null | undefined): string {
  if (role === "manager") return "/strategies";
  if (role === "allocator" || role === "both") return "/allocations";
  return "/pending-approval";
}

export function roleHomeFor(
  profile: ApprovalProfile | null | undefined,
  opts: { isAdmin?: boolean } = {},
): string {
  if (!isProfileApproved(profile)) return "/pending-approval";
  if (opts.isAdmin ?? profile!.is_admin) return "/admin";
  return roleSurfaceHome(profile!.role);
}

export function safeRedirectPath(raw: unknown): string | null {
  return typeof raw === "string" && /^\/[a-z]/.test(raw) ? raw : null;
}
```
Note: `requireRolePage` today maps `both` to `/pending-approval` as its *redirect target* only because `both` never reaches the redirect (it owns both surfaces). `roleSurfaceHome("both")` returning `/allocations` is therefore a behaviour-neutral change for the guard and the CD-01 value for `/home`.

### Pattern 2: Deep link wins at sign-in (CD-02)

- `LoginForm` today ends `router.push("/discovery/crypto-sma"); router.refresh();` and reads no query. `[VERIFIED: src/components/auth/LoginForm.tsx]`
- `LoginPage` already awaits `searchParams: Promise<{ code?: string; redirect?: string }>`. `[VERIFIED: src/app/(auth)/login/page.tsx]`
- Producers of `?redirect=`: `strategies/layout.tsx` (`/login?redirect=/strategies`), `discovery/layout.tsx`, `my-strategies/page.tsx` (retires), `recommendations/page.tsx`. Producers of `?next=`: `strategies/new/wizard/page.tsx` and a `WizardClient` link (`/login?next=/strategies/new/wizard`). `[VERIFIED: grep -a]`
- The proxy's unauthenticated bounce sets `url.pathname = "/login"` and keeps the original query, adding no `redirect` param. `[VERIFIED: src/proxy.ts]` So a deep link only survives when a server page's own `redirect("/login?redirect=…")` fires (session cookie present, `getUser()` failed).

**Prescription:** the login page computes `safeRedirectPath(params.redirect ?? params.next)` and passes it as a prop (`<LoginForm redirectTo={...} />`); `LoginForm` does `router.push(redirectTo ?? ROLE_HOME_ROUTE)`. Passing a prop avoids `useSearchParams` in a client component (which needs a Suspense boundary). Reading `next` too is a recommendation (two shipped producers emit it); if the planner prefers, convert the two `?next=` producers to `?redirect=` instead. **Also fix, same file, same param:** the `params.code` branch does `redirect(params.redirect || "/onboarding")` with no sanitizing; `redirect()` accepts absolute URLs (Next docs: "`redirect` also accepts absolute URLs and can be used to redirect to external links") `[CITED: nextjs.org/docs/app/api-reference/functions/redirect]`, so an email-confirm link with `&redirect=https://…` is an open redirect. Route it through `safeRedirectPath`.

### Pattern 3: Widen only the index guard (D-01)

- `StrategiesLayout` does `getUser()`, `redirect("/login?redirect=/strategies")` when no user, then `await requireRolePage(supabase, user, "manager")`; `export const dynamic = "force-dynamic"`. Its docblock: "this layout — not a per-index-page guard — is the single guard site for the sell-side subtree: strategies (index) + new + new/wizard + [id]/edit". `[VERIFIED: src/app/(dashboard)/strategies/layout.tsx]`
- Sub-routes on disk: `strategies/new/page.tsx`, `strategies/new/wizard/page.tsx`, `strategies/[id]/edit/page.tsx`. `[VERIFIED: ls]`
- The Phase 110 allocator exception is NOT the route: the sidebar comment says "the wizard route sits under the Phase-109 manager-guarded /strategies subtree, so a Link would redirect-bounce the allocator", and allocators use `ContributionWizardOverlay` (a client action). `[VERIFIED: src/components/layout/Sidebar.tsx, buildNavSections]`

**Prescription:**
1. Create `strategies/new/layout.tsx` and `strategies/[id]/layout.tsx`, each the current guard body (`force-dynamic`, session check, `requireRolePage(..., "manager")` outside any try/catch). A layout wraps every descendant segment, so `new/wizard` is covered by `new/layout.tsx`.
2. `strategies/layout.tsx` keeps `force-dynamic` and the session check, drops `requireRolePage`. Its docblock is rewritten to say where the guard went.
3. The index needs no role guard: the `(dashboard)` layout's `isProfileApproved` gate already sends unknown roles to `/pending-approval`.
4. Structural test (the failure mode a split guard introduces): walk every `page.tsx` under `src/app/(dashboard)/strategies/`; every page except the index must sit under a directory whose `layout.tsx` calls `requireRolePage(` with `"manager"`. A future `strategies/foo/page.tsx` without a guarded layout goes RED.
5. `requireRolePage-wiring.test.tsx`: replace the `strategies/layout` surface (need `manager`) with `strategies/new/layout` and `strategies/[id]/layout` (both `manager`); delete the `my-strategies/page` surface; add a negative case that `strategies/layout` and `strategies/page` do not call the guard. The file's header says "the 7 surfaces"; it becomes 7 again (−2 +2) but say so explicitly.

### Pattern 4: One read, one client host, furniture by role (D-02)

What each page reads today `[VERIFIED: both page files]`:

| Read | `/strategies` (manager) | `/my-strategies` (allocator) |
|------|------------------------|------------------------------|
| List | `supabase.from("strategies").select(\`*, strategy_analytics (${CATEGORY_RANKING_ANALYTICS_COLUMNS})\`).eq("user_id", user.id).or("source.neq.wizard,status.neq.draft").order("created_at", { ascending: false })` (archived INCLUDED, wizard drafts HIDDEN) | `getMyStrategies(user.id)`: `select(\`*, strategy_analytics (*)\`).eq("user_id", userId).neq("status", "archived")` then `shapeRankingRows` (archived EXCLUDED, wizard drafts INCLUDED, adds `trust_tier` via `readPublicVerificationSignals`) |
| Shaping | `shapeRowAnalytics(extractAnalytics(...), s.id)` + `analyticsPresent: a !== null` | same shaper via `shapeRankingRows`, plus `trust_tier` |
| Wizard draft | separate `maybeSingle()` read → resume banner → `/strategies/new/wizard` | row in the list |
| Extra | shares, intros, `strategy_keys`, `api_keys` (`KEY_STATUS_COLUMNS = "id, exchange, sync_status, sync_error, last_sync_at"`), compute-state RPC per unpublished row, buildability probe per computed row | `getStrategylessActiveKeys`, `getRealPortfolio`, `getOwnRowPercentiles(strategyRows)` |

**Prescription:**
- Keep the manager list read as the one row set (it is pinned by parity pin 10's regex `\.select\(\`\*, strategy_analytics \(\$\{CATEGORY_RANKING_ANALYTICS_COLUMNS\}\)\`\)\s*\.eq\("user_id", user\.id\)` and by `page.table.test.tsx`). `getMyStrategies` stays for its other callers but the merged page does not call it (it drops archived rows and does not hide wizard drafts, the reason the 170.7 page refused it).
- Read the viewer's role on the page (`profiles.role`, with `requireRolePage`'s error discipline: DB error throws, never guesses). `isManager = role === "manager" || role === "both"`, `isAllocator = role === "allocator" || role === "both"`.
- `getOwnRowPercentiles(rows)` accepts `{ id, analytics, asset_class? }[]` `[VERIFIED: src/lib/queries.ts, symbol getOwnRowPercentiles]`, so the shaped manager rows feed it directly. Compute it for every role (UI-SPEC note 2). Recommendation: pass non-archived rows only, matching the W-4 rule that archived is not coverage (Open Question 5).
- Attach `trust_tier` with the exported `readPublicVerificationSignals(ids)` (`[VERIFIED: export async function readPublicVerificationSignals in src/lib/queries.ts]`). Without it a published composite (no `api_key_id`) loses its verified check, because `StrategyTable` renders the check on `s.trust_tier === "api_verified" || s.api_key_id`. That is an allocator-visible loss D-02 forbids.
- Allocator reads (`getStrategylessActiveKeys`, `getRealPortfolio`) run only when `isAllocator`; intros (`contact_requests`) only when `isManager`. A `null` from either allocator fetcher is a read failure, never "empty" (149 WR-01): render the UI-SPEC placeholder-key read-failure line.
- **Wizard drafts by role (code proves UI-SPEC UD-2 / OQ-6 default wrong for allocator-only viewers):** the resume target `/strategies/new/wizard` stays manager-guarded, so an allocator who clicks "Resume draft" is bounced to `/allocations`. Therefore: for `manager`/`both` keep `.or("source.neq.wizard,status.neq.draft")` plus the banner; for allocator-only drop that filter (their wizard drafts stay rows with Status `Draft`, as on `/my-strategies` today) and render no banner. This is the UI-SPEC's own fallback ("the allocator keeps that draft as a row with Status `Draft` instead"). Pin 10's regex anchors on the `.select(...).eq("user_id", user.id)` chain, so a conditional `.or(...)` after it keeps the pin green; verify.
- One client host: move `MyStrategiesSection.tsx` to `strategies/` (rename to fit the page) and mount it for every role with the server-built `managerRows` (React nodes pass from RSC to a client component as props), `placeholderKeys`, `portfolioId`, `percentiles`, and the role flags. Callbacks (`onMarkOwnership`, `onRename`, `onFinishSetup`) are minted only when `isAllocator`. `ContributionWizardOverlay.preselect.test.tsx` imports `MyStrategiesSection` by path; move the import.
- Empty state: `isAllocator && !isManager` → the moved `MyStrategiesEmptyState` (its CTA opens the overlay, never an href); otherwise the shipped manager card.

### Pattern 5: Decouple `StrategyTable`'s manager mode

`managerRows` presence currently switches, all in `src/components/strategy/StrategyTable.tsx` `[VERIFIED: Read]`:
1. Status and Created columns (headers emitted `i === 0 && managerRows`), and `emptyRowColSpan = (showStarColumn ? 13 : 12) + (managerRows ? 2 : 0)`.
2. Suppresses the in-name status badge (`!managerRows && s.status !== "published"`).
3. Suppresses `OwnershipTag` (`visibility === "owner-all-statuses" && !managerRows`).
4. Actions cell: `managerRows ? <Edit + actions> : ownerRowActions`.
5. Suppresses Simulate Impact (`s.status === "published" && !managerRows`).
6. The full-width note row (`managerRows?.[s.id]?.note`) and `showExamples` forced on.

**Prescription (minimum change):** keep `managerRows` as the "owner list" switch for 1, 2, 6 (every merged mount passes it), make the entry fields optional (`editHref?`, `actions?`, `note?`, plus a new `health?`), and add one boolean prop for the allocator furniture (e.g. `allocatorFurniture`) that re-enables 3 and 5 inside owner-list mode. Render 4 as the concatenation: Edit (when `editHref`), `actions`, then `ownerRowActions` (already gated on the callbacks being passed), then Simulate, all in the one `flex-nowrap` cell (UI-SPEC note 4 order). Keep the `s.status === "published"` guard within 300 comment-stripped characters before `<SimulateImpactButton` (parity pin 7) and the literal `const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;`.
- Health column: header after Status, same `HEADER_LABEL`, not sortable; `emptyRowColSpan` grows by one in owner-list mode; placeholder rows get a `—` Health cell next to their existing `managerRows &&` Status/Created dashes.
- `StrategyTable.default-mounts.test.tsx` pins the `/discovery`, `/browse` and `/my-strategies` mounts to captured HTML. The `/discovery` and `/browse` pins must stay byte-identical (proof the public surfaces did not change). The `/my-strategies` pin is retired with the mount and replaced by owner-list pins per role (allocator, manager, both).
- Phase 196 plan 06 edits this file (origin prop, row links through `buildFactsheetHref`). Sequence after it (see Overlap).

### Pattern 6: Health derived on the server from existing signals (D-03, CD-04)

Inputs, all already on the page `[VERIFIED: strategies/page.tsx]`: `s.status`; `feedingKeyIdsByStrategy.get(s.id)` and `keysById`; `keyStatusUnreadable`; shaped `analytics.computation_status`, `analytics.analytics_updating`, `analytics.series_end` (the ranking allowlist projects `series_end:returns_series->-1->>date`); `analyticsPresent`; `s.created_at`.

Shared predicates and constants (quoted verbatim):
- `export function isComputedAnalytics(status) { return status === "complete" || status === "complete_with_warnings"; }` `[VERIFIED: src/lib/closed-sets.ts, symbol isComputedAnalytics]`
- `export const UNTRUSTED_KEY_SYNC_STATUSES = ["revoked", "sign_in_failed"] as const;` and `isUntrustedKeySyncStatus` `[VERIFIED: src/lib/closed-sets.ts]`
- `deriveEmptySeriesState(status, strategyCreatedAt, nowMs = Date.now())`: `pending`/`computing` → `"computing"`; `null` within `MISSING_ROW_COMPUTING_WINDOW_MS = 16 * 60 * 60 * 1000` of creation → `"computing"`; else `"empty"` `[VERIFIED: src/lib/closed-sets.ts]`
- `export const SERIES_FRESH_DAYS = 3; export const SERIES_STALE_DAYS = 7;` `export const SERIES_END_FUTURE_ALLOWANCE_DAYS = 1;` `[VERIFIED: src/lib/freshness.ts]`
- `bucketSeriesAge` (NOT exported): `days = Math.floor((now - seriesEndMs) / 86_400_000)`; `days < 0` → `"fresh"` if `-days <= SERIES_END_FUTURE_ALLOWANCE_DAYS` else `"future"`; `days <= SERIES_FRESH_DAYS` → `"fresh"`; `days <= SERIES_STALE_DAYS` → `"warm"`; else `"stale"` `[VERIFIED: src/lib/freshness.ts]`. So "stale" means strictly older than 7 days, and the legend's "older than {SERIES_STALE_DAYS} days" / "at most {SERIES_STALE_DAYS} days old" match the operator.
- `rowChipStatus(s)` (private to the client table): `s.analyticsPresent === false ? null : s.analytics.computation_status ?? null` `[VERIFIED: StrategyTable.tsx]`

**Prescription:**
- Export a thin `seriesVerdictOf(seriesEnd, now): "fresh" | "warm" | "stale" | "future" | "unknown"` from `freshness.ts` that wraps the existing `toFiniteMs` + `bucketSeriesAge` (one ladder; do not copy it).
- Move `rowChipStatus` into a non-client lib module and import it in both `StrategyTable.tsx` and the health lib (its hoist comment: "a second inline copy is the drift"). A server component cannot call a function exported from a `"use client"` module (the page's own comment: importing a predicate from a client module "compiles but throws at request time").
- `src/lib/strategy-health.ts` `strategyHealthOf(...)` returns a closed union (`healthy | key_problem | analytics_failed | updating | stale | stale_no_data | not_judged`, plus `staleSince` day), first match wins in the UI-SPEC order, with `keyStatusUnreadable` turning `healthy` into `not_judged`. The page calls it once per row with `Date.now()` and passes the result through `managerRows[id].health`; the client renders the word. Copy (words, tones) lives beside it, not in the table.
- Analytics-failed detail day: `ComputeState`'s `failed` arm carries no timestamp (`{ state: "failed"; errorKind: JobErrorKind | null }`), and job rows carry `created_at` / `claimed_at` only `[VERIFIED: src/lib/compute-state.ts, ComputeState and ComputeJobRow]`. The page also skips the compute-state read for published rows (`armOf` returns early for `"public-url"`). So the UI-SPEC's `{day}` needs (a) the selected job's `claimed_at ?? created_at` exposed beside the derived state, and (b) the read made for every row whose Health is `analytics_failed`, published included (one RPC per failed row only). Without (b) every published failed row would print the read-failure sentence for a read that was never attempted, which is false.
- Allocator-only remedies: `ownerRemedy`'s shape remedies link `/strategies/<id>/edit` (`shapeRemedy`), which stays manager-guarded. The UI-SPEC switches the Stale action by role but routes Analytics failed through `ownerRemedy` unchanged; for an allocator-only viewer that names a page that bounces them. Use the role switch for both (Open Question 4).
- Key caption with the key named: add `label` to `KEY_STATUS_COLUMNS` (it is in `API_KEY_USER_COLUMNS`, the user-granted set `[VERIFIED: src/lib/constants.ts, API_KEY_USER_COLUMNS]`) and build labels with `apiKeyLabelById` (`${exchange} — ${nickname ?? maskedTail}`) `[VERIFIED: src/lib/api-key-label.ts]`.

### Pattern 7: Legend generated from closed sets

- `statusLabelMap` mixes strategy and contact-request statuses: `published: "Published", draft: "Draft", pending_review: "Pending review", archived: "Archived", private: "Private", pending: "Pending", intro_made: "Intro made", completed: "Completed", declined: "Declined"` `[VERIFIED: src/components/ui/Badge.tsx]`. The strategy statuses exist only as a type: `status: "draft" | "pending_review" | "published" | "archived" | "private";` `[VERIFIED: src/lib/types.ts, interface Strategy]`. Add a runtime `STRATEGY_STATUSES` tuple with a `satisfies` / exhaustiveness check against `Strategy["status"]` so a new status without a legend entry fails to compile or fails the legend test.
- Ownership labels: `LABELS = { [OWN_CAPITAL]: "Own capital", [TEAM_REVIEW]: "Team review" }` `[VERIFIED: src/components/strategy/OwnershipTag.tsx]` (not exported; export it or read via a test of the rendered tag).
- Pipeline chips rendered by the table: `Syncing`, `No data`, `No strategy yet` (DATA_STATE_CHIP, uppercase via class) `[VERIFIED: StrategyTable.tsx]`.
- Key pills: the two `UNTRUSTED_KEY_SYNC_STATUSES`. `AllocatorSyncStatus` renders a `role="status"` helper; the legend must render the pill without it (UI-SPEC a11y).
- Contract test: render the merged list for each role with one row per Health word and per chip, collect every chip/word label in the table, assert each has a legend entry.

### Pattern 8: Degrade-warning registry and scan (D-04, CD-05)

**Registry shape (recommended):** `src/lib/degrade-warnings.ts` exports entries `{ id, surface, class, scope, action, render(args) }` where `class ∈ degrade | read_failure | in_progress | composition | share_status | provenance | empty | recipient`, `scope ∈ key | day | key_day | whole_history | recipient | none`, `action` is an id from the UI-SPEC's closed action vocabulary (A-RECONNECT … A-DESELECT), and `render` returns the sentence (string or ReactNode). Plus a `sample` fixture per entry (fixture key label such as `"Fixture — key-A"`, fixture ISO day).

**Registry test (the RED-on-a-warning-that-names-neither gate):** for every entry, render its `sample`; then
- `class === "degrade"`: the rendered text contains the fixture key label, or the fixture day formatted by `formatCloseDay`/`formatUnpricedDays`, per its declared scope; AND it contains its action sentence verbatim from the vocabulary.
- `scope === "whole_history"`: id is on a count-pinned allowlist and the text contains `whole history`.
- `read_failure` and `recipient`: an action is present; a `recipient` entry whose sample contains the fixture key label fails (privacy).
- A dead key's entry, rendered with two keys where one is dead, names only the dead key.
Testing the rendered output (not a declared flag) is what lets the test fail when a template loses its key slot (Rule 9).

**Scan test (the unregistered-warning gate):** every render site of a registered warning carries `data-degrade-id="<id>"`. `src/__tests__/degrade-warning-scan.test.ts` walks the scanned files and asserts (1) every `data-degrade-id` literal exists in the registry, (2) every registry entry for a scanned surface has at least one render site (no orphan copy), (3) every hit of the trip pattern (`role="status"`, `WarningBanner`, `ScopedBanner`, `InfoBanner`, `text-warning`, `border-warning-border`, `warning-bg`) is either inside an element carrying `data-degrade-id` or listed in a count-pinned `NOT_A_DEGRADE_WARNING` allowlist with a reason (loading skeletons, the just-submitted line, form status, chip classes). Strip comments before scanning (the parity test's `stripComments` idiom). A visual-class trip pattern alone is not enough: `MissingDataMessage` (the whole 198 message) and `EquityHistoryRebuilding` carry no `role="status"`.

**Scanned surfaces:** `src/app/(dashboard)/allocations/**` (My allocation and Scenario), `src/app/(dashboard)/strategies/page.tsx` plus the files it renders for the list (the section host, `StrategyTable.tsx`, the legend), `src/lib/status-surface-copy.ts`, `src/lib/degrade-warnings.ts`; after Phase 196 merges, `src/app/factsheet/**`, the tearsheet and `src/app/factsheet-share/**`. Do NOT scan `strategies/new/**` (the wizard) or `strategies/[id]/**`: they are not D-04 surfaces and carry form warnings (`WithdrawalWarningStrip`, `WizardIpAllowlistHint`).

**Reproducible enumeration command (seed, measured at HEAD: 66 hits):**
```bash
grep -a -rnE 'role="status"|WarningBanner|ScopedBanner|InfoBanner|text-warning|border-warning-border|warning-bg' \
  "src/app/(dashboard)/allocations" "src/app/(dashboard)/strategies/page.tsx" \
  src/components/strategy/StrategyTable.tsx src/lib/status-surface-copy.ts \
  --include='*.tsx' --include='*.ts' | grep -v '\.test\.'
```
Plus the sentence sources the pattern misses (measured by Read): `MissingDataMessage.tsx` (`BOOK_LINE`, `UNKNOWN_REASON_LINE`, `GapLine`, `NotSyncingLine`, `NeedsActionLine`), `EquityHistoryRebuilding.tsx`, `AllocationDashboardV2.tsx` (`StalenessBanner`, `DepartedHistoryNote`, `UnpricedAccountNote`, `FailingKeyExitNote`), `ScenarioComposer.tsx` (20 trip hits, incl. the per-source fallback), `status-surface-copy.ts` (`STATE_LINES`, `ownerRemedy`, `MINT_TOKEN_NOTES`, `PUBLIC_URL_NOTE`, `SHARE_CARD_COPY`, `KCS10_PUBLIC_SENTENCE`, `ANALYTICS_UPDATING_LINE`, `STRATEGIES_LIST_UNREADABLE`, `KEY_STATUS_UNREADABLE_NOTE`). Factsheet seed (gated until 196): `FactsheetView.tsx` (8 trip hits), `HeatmapPanels.tsx` (1), `v2/page.tsx` (1).

Seed inventory with gaps is in the UI-SPEC ("Inventory seed and target copy"); code checks below.

| Warning | Code fact this session | Plan consequence |
|---------|------------------------|------------------|
| `DepartedHistoryNote` | Renders a fixed sentence; payload has only `departedHistoryUnavailable?: boolean`; `queries.ts` says "the derived payload does not say which departed account it left out"; the derive counts them (`departed_history_unavailable_keys: len(departed_unavailable)`) in `analytics-service/services/job_worker.py`. | Naming the key needs the derive to emit the departed key ids (Python + payload type + reader). See Open Question 3. |
| `StalenessBanner` | Receives `lastSyncAt` and prints a relative age via `formatRelativeAge` (uses `Date.now()` in a client render). | Pass the newest `last_sync_at` as a server-formatted day; drop the relative age (UI-SPEC target). |
| `FailingKeyExitNote`, `UnpricedAccountNote` | Name key labels and days; no action sentence. | Append the vocabulary action per clause. |
| 198 `BOOK_LINE` | `awaiting_derivation`, `derivation_rejected`, `shared_account_history_truncated` name no scope; `history_read_failed` is a read failure; `account_identity_pending` names no key. | `whole_history` allowlist (count-pinned) per UI-SPEC OQ-2. |

### Anti-Patterns to Avoid
- **Reading a profile in the proxy:** breaks its cookie-only contract and adds a DB call to every request. Name `/home` instead.
- **A per-index-page role check that admits allocators while the layout still guards `manager`:** the layout runs first and bounces them. The guard must leave the layout.
- **Deriving Health in `StrategyTable`:** it is a client component; the derivation needs the server clock and key reads.
- **Copying `bucketSeriesAge` or `rowChipStatus`:** export/hoist; both files say a second copy is how surfaces came to disagree.
- **A legend that re-types chip classes:** render the real components (UI-SPEC).
- **Scanning by class name only:** misses the 198 message and over-matches chips.
- **`git rm` of `my-strategies/` without the manifest + `next.config.ts` change in the same task:** `check:route-contract` Rule 4 / Rule 3 go red.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retiring a route with query preserved | An in-page `redirect()` stub or proxy rule | `next.config.ts` `redirects()` `{ source: "/my-strategies", destination: "/strategies", permanent: true }` | Docs: "Redirects are checked before the filesystem", "any query values provided in the request will be passed through", `permanent: true` → 308 `[CITED: nextjs.org/docs/app/api-reference/config/next-config-js/redirects]`; repo precedents `/scenarios`, `/portfolios/:path*`. |
| Series age verdict | A new day comparison | `seriesVerdictOf` wrapping `bucketSeriesAge` | The shared 3d/7d ladder with the future allowance. |
| Key label | String concatenation | `apiKeyLabelById` | The one key-label rule. |
| Day formatting | `toLocaleDateString` | `formatCloseDay`, `formatUnpricedDays` (`src/lib/factsheet/returns-unit.ts`) | UTC, no client clock. |
| Redirect sanitizing | A new regex per site | `safeRedirectPath` shared by proxy and login page | One rule, CD-02. |
| Approval truth table | Re-deriving status checks | `isProfileApproved` | `both` needs both statuses; fails closed. |
| Admin decision | `profile.is_admin` alone | the layout's `is_admin` then `isAdminUser` fallback | A `user_app_roles`-only admin would otherwise be sent to an allocator home while admin pages admit them. |
| Next.config redirect assertion | A new parser | `hasRedirectRule` idiom in `src/__tests__/trim-removed-surfaces.test.tsx`, and `check-route-contract` Rule 3 | Existing, comment-stripped. |

## Runtime State Inventory

The `/my-strategies` retirement and the home-literal change are a route rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None in the database: no table stores a route path (verified by reading the reads; routes are code). Client `localStorage` prefs are scoped by `(userId, categorySlug)` via `useDiscoveryPrefs`; `MyStrategiesSection` passes `categorySlug="my-strategies"` but no `userId`, and the manager mount says "No `userId` is passed, so the table persists no sort or density here". Nothing persisted. | None. |
| Live service config | Plausible page analytics (`PlausibleScript` exists) may have goals/dashboards keyed on `/my-strategies` or `/discovery/crypto-sma` as a landing page. Not in git; not checked (no access). `[ASSUMED]` | Founder to check Plausible goals after ship; no code change. |
| OS-registered state | None: no cron, task or service registers a page route. | None. |
| Secrets/env vars | None reference either route. | None. |
| Build artifacts / caches | A 308 is cached by browsers permanently (next.config comment on the alias rule: "A 308 is cached by browsers, so reverting this rule does not reach visitors who already followed it"). Bookmarks and emailed links to `/my-strategies` are served by the 308. | Accept (D-01 chose 308). Note in CHANGELOG. |

## Common Pitfalls

### Pitfall 1: `/home` bounce loop
**What goes wrong:** `/home` added to `PUBLIC_ROUTES` but not to `isAuthBounceExempt`; a signed-in GET `/home` is redirected to `ROLE_HOME_ROUTE` = `/home` forever.
**How to avoid:** add to both; proxy test: signed-in GET `/home` → 200, no `location`; anon GET `/home` → 200 (the page then redirects to `/`).
**Warning signs:** `ERR_TOO_MANY_REDIRECTS` in e2e.

### Pitfall 2: redirect inside try/catch
**What goes wrong:** `redirect()` throws `NEXT_REDIRECT`; a wrapping catch swallows it.
**How to avoid:** profile read returns `{ error }`, handle it, call `redirect` at top level (the `requireRolePage` and docs rule: "`redirect` throws an error so it should be called outside the `try` block") `[CITED: nextjs.org/docs/app/api-reference/functions/redirect]`.

### Pitfall 3: e2e post-login waits that do not include the new landings
**What goes wrong:** allocators now land on `/allocations` (via `/home`), admins on `/admin`. Waits that only accept discovery/strategies time out.
**Measured sites that WILL break** (`grep -a -rn "waitForURL" e2e`):
- `e2e/helpers/login.ts` `loginAs` waits `^\/(discovery|strategies|dashboard)(\/|$)`; used by `discovery-hide-examples-default`, `discovery-prefs-isolation`, `discovery-sparkline-regression`, `wizard-hydration-probe` with seeded allocators (`seedTestAllocator()` default role `allocator`).
- `e2e/discovery-watchlist.spec.ts` waits `(discovery|strategies|dashboard)` with `seedTestAllocator()`.
- `e2e/layout-narrow.spec.ts` `loginViaForm` waits `(discovery|strategies|allocations|dashboard)` and is called with `seedTestAllocator({ role: "both", isAdmin: true })` in two admin legs → lands `/admin`.
- Env-gated (skip in CI unless creds set): `e2e/match-queue.spec.ts` (admin creds, waits `(discovery|strategies)`), `e2e/full-flow.spec.ts` (skipped-by-design), `e2e/strategy-detail-tabs.spec.ts` and `e2e/for-quants-onboarding.spec.ts` (`E2E_TEST_EMAIL`, role unknown).
- Already safe: specs whose regex includes `allocations` for allocator accounts and `admin` for admin accounts (`admin-compute-jobs-axe`, `admin-csv-status-axe`, `sfox-badge`, `mt5-badge`, `csv-upload-flow` with `both`).
**How to avoid:** export one predicate from `e2e/helpers/login.ts` (pathname-anchored, includes `allocations` and `admin`) and use it at the breaking sites; a seeded per-role landing spec pins the exact landing (allocator → `/allocations`, manager → `/strategies`, admin → `/admin`, `?redirect=/compare` wins). A new seeded spec must also be added to the `e2e-seeded` list in `.github/workflows/ci.yml` (MA-8 two-place rule) or it runs nowhere.

### Pitfall 4: the admin-landing change hits the founder
All `both` owners in PROD are admins (CONTEXT evidence), so the founder's own sign-in now lands on `/admin`, not the allocator workspace. That is CD-01 as written; call it out in the CHANGELOG.

### Pitfall 5: allocator wizard drafts vanish
Covered in Pattern 4: the resume target bounces allocators; keep their wizard drafts as rows.

### Pitfall 6: published failed rows have no compute-state read
Covered in Pattern 6: the page skips the RPC for published rows, so the Analytics-failed day must trigger its own read.

### Pitfall 7: five strategies-page tests mock the Supabase client by table
`page.key-pill`, `page.share-affordance`, `page.table`, `page.wizard-draft-banner`, `page.wizard-submitted` (plus `my-strategies/page.test.tsx`, 635 lines, retired). Adding a `profiles` read and the allocator reads changes every mock. Budget a task; Phase 196 plan 15 also edits `page.share-affordance.test.tsx`.

### Pitfall 8: the parity test reads the retired page path
`phase-149-my-strategies-parity.test.ts` pins `MY_STRATEGIES_PAGE = "src/app/(dashboard)/my-strategies/page.tsx"` and fails loud on a missing pinned source ("a missing pinned source is a FAILURE, not a skip"). Pins 6, 10 and 12 must be re-pointed at the merged page and the moved section in the same task that deletes the route; pin 10 becomes "exactly ONE production file passes `visibility=\"owner-all-statuses\"`" (the section), with the page's list-read regex kept. Pin 12 asserts the page's raw source contains the word `getPercentiles` in a comment and not `getPercentiles(` in code; keep the single-fetch comment on the merged page or rewrite that arm.

### Pitfall 9: the `isWide` arm and its sweep
`DashboardChrome`'s `isWide` regex carries `my-strategies` and `DashboardChrome.test.tsx` has three `/my-strategies` rows plus `SCANNED_TREES` entry `src/app/(dashboard)/my-strategies`. Remove them with the route (UI-SPEC says so). Phase 196 plans 14 and 15 also edit `DashboardChrome.test.tsx`.

## Code Examples

### The role-home page
```typescript
// src/app/home/page.tsx — pattern from requireRolePage + (dashboard)/layout (both read this session)
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { roleHomeFor } from "@/lib/routing/role-home";

export const dynamic = "force-dynamic";

export default async function RoleHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, allocator_status, manager_status, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    captureToSentry(error, { tags: { route: "home", stage: "profile" }, level: "error" });
    throw error; // never guess a home on a failed read
  }
  let isAdmin = profile?.is_admin === true;
  if (!isAdmin) {
    try { isAdmin = await isAdminUser(supabase, user); }
    catch (err) { console.error("[home] isAdminUser failed:", err); }
  }
  redirect(roleHomeFor(profile, { isAdmin })); // outside any try/catch
}
```

### The 308
```typescript
// next.config.ts redirects() — beside the /scenarios and /portfolios rules
{ source: "/my-strategies", destination: "/strategies", permanent: true },
```
Manifest: change the `/my-strategies` row to `class: "exception"`, `redirectFrom: "/my-strategies"`, notes naming Phase 199 D-01 (the `/scenarios` precedent: an `exception` row skips Rule 4's page-existence check because the page is gone). Add `/home` as `public`. Keep the manifest alphabetical.

### Call-site enumeration test (CD-01)
```typescript
// src/__tests__/role-home-call-sites.test.ts — sketch
// Walk src/ (production files, comments stripped). Every occurrence of the literal
// "/discovery/crypto-sma" must be in a count-pinned NAVIGATION allowlist:
//   breadcrumbs: discovery/[slug]/page.tsx, decks/page.tsx, compare/page.tsx (x2),
//   discovery/layout.tsx (login ?redirect= target), Sidebar.tsx buildPrimaryMobileNav "Discovery" filler.
// Any other occurrence (redirect(, router.push(, a "Go to" link) fails.
// Positive arm: each of the home sites imports ROLE_HOME_ROUTE or roleHomeFor.
```
Re-measure the allowlist at plan time with `grep -a -rn '"/discovery/crypto-sma"' src | grep -v '\.test\.'` (Phase 196 plans 15/17/18 delete some of these files).

## UI-SPEC open questions: verdicts

| OQ | Recommended default | Verdict from code |
|----|---------------------|-------------------|
| OQ-1 Dateless Stale → `Stale (no data yet)` | Adopted. `deriveEmptySeriesState` returns `"empty"` for a never-computed row past 16 h; no date exists. |
| OQ-2 Book-wide warnings → count-pinned `whole_history` | Adopted. `BOOK_LINE` reasons have no key cause in the payload. |
| OQ-3 Read failures carry an action, recipient notices never name a key | Adopted. |
| OQ-4 `DepartedHistoryNote` and degraded members → A-CONTACT-CHECK | Adopted for the action. The SCOPE half (name the key) is blocked on data the payload lacks (Open Question 3). |
| OQ-5 Allocator bottom bar unchanged | Adopted. `MobileNav.test.tsx` already asserts the allocator mobile set does not contain `/strategies`; nothing to change there. |
| OQ-6 Allocator wizard drafts | **Default proved wrong.** The resume target is manager-guarded (Sidebar comment; `StrategiesLayout`), and D-01 keeps that guard. Apply the UI-SPEC fallback: allocator-only viewers keep wizard drafts as `Draft` rows and see no resume banner. |

Additional code findings against the UI-SPEC:
- UI-SPEC "Component Inventory" names `/strategies/new/wizard` as admitting allocators ("Phase 110 exception, unchanged guard"). It does not; the Phase 110 exception is the overlay.
- UI-SPEC Health detail for `Analytics failed` uses `ownerRemedy` for every role; for allocator-only viewers its shape remedies link the manager-guarded edit page (Open Question 4).
- CONTEXT counts "15 pages" of admin bounces; measured 13 (15 admin pages exist; `partner-import` and `partner-roi` are client pages without the bounce).

## Phase 196 overlap (sibling worktree, branch `feat/196-onestrategypage`, 21 plans, not merged at research time)

Files in 196 plans' `files_modified` (read from each plan's frontmatter) that this phase will likely also touch:

| File | 196 plan(s) (wave) | What 196 does | What 199 does | Sequencing |
|------|--------------------|---------------|---------------|------------|
| `next.config.ts` | 02 (w1) | four strategy-route 308s | `/my-strategies` 308 | Additive; land after 02 or rebase. |
| `src/lib/routing/route-contract-manifest.ts` | 02 (w1) | four rows | `/my-strategies` row, `/home` row | Additive; after 02. |
| `src/components/strategy/StrategyTable.tsx` | 06 (w2) | origin prop, `buildFactsheetHref` row links | owner-list decoupling, Health column | After 06. |
| `src/components/strategy/StrategyTable.default-mounts.test.tsx` | 06 | golden HTML | retire `/my-strategies` pin, add owner-list pins | After 06. |
| `src/app/(dashboard)/strategies/page.tsx` | 06 | origin for the mount | the merge, Health, role reads | After 06. |
| `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx` | 06 | origin `my-strategies` | moved/renamed into `strategies/` | After 06. |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`, `CsvSubmitStep.tsx` | 06 | factsheet links `?from=my-strategies` | re-point origin to `strategies` | After 06. |
| `src/lib/factsheet/origin.ts` (+ test) | 03 (w1), 10 (w3) | `FACTSHEET_ORIGINS` includes `my-strategies` → "Back to My Strategies", href `/my-strategies` | collapse `my-strategies` into `strategies`; parse a legacy `from=my-strategies` as `strategies` | After 196 merges (factsheet-adjacent lib, D-04 spirit). |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (+ `strategy-rows` test) | 20 (w2) | factsheet link via builder | the `href="/my-strategies"` link → `/strategies` | Different hunk; after 20. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | 20 (w2) | one factsheet link hunk | degrade-warning registry hunks | Different hunks; after 20. |
| `src/components/layout/DashboardChrome.test.tsx` | 14 (w6), 15 (w2) | test edits | remove `/my-strategies` rows | After 196 merges. |
| `src/app/(dashboard)/strategies/page.share-affordance.test.tsx` | 15 (w2) | test edit | mock changes for role reads | After 15. |
| `src/lib/queries.ts` | 14 (w6) | type/query edits | possibly none (reuse exports) | If touched, after 196. |
| `src/app/strategy/[id]/error.tsx` | 18 (w2) deletes it | — | home-link edit | If 196-18 lands first, drop this site from 199's list. |
| `src/app/factsheet/[id]/v2/error.tsx`, `not-found.tsx` | 19 (w3) | wrap in `<main>` | none (UI-SPEC: factsheet Discovery links stay) | No 199 edit. |
| `e2e/layout-narrow.spec.ts` | 06, 10 | selectors | `/my-strategies` N-TABLE describe → `/strategies`; admin-leg login wait | After 196 merges. |
| `e2e/reflow-sweep-authed.spec.ts` | 19 (w3) | factsheet rows | add `/strategies` index row | After 19. |
| `e2e/axe-app-wide.spec.ts` | 02, 19 | retarget rows | `/strategies` per-role axe rows | After 19. |
| `e2e/route-redirects.spec.ts` | 02 | strategy-route canaries | `/my-strategies` 308 canary | After 02. |
| `e2e/mt5-badge.spec.ts`, `e2e/sfox-badge.spec.ts`, `e2e/composite-onboarding.spec.ts` | 02 | retarget | only if their login waits break (they include `admin`/`allocations`: they do not) | No 199 edit expected. |
| `e2e/target-size.spec.ts`, `e2e/full-flow.spec.ts` | 10 | edits | full-flow login waits (env-gated) | After 196 merges. |
| `src/__tests__/trim-removed-surfaces.test.tsx` | 17 (w5) | edits | none expected | — |
| `.github/workflows/ci.yml` | 02 | removes four e2e specs from the seeded list | adds a role-landing spec to the seeded list; keeps or renames `e2e/my-strategies.spec.ts` | After 02. |

**Recommendation:** Wave A (role home) and Wave B (Health lib, registry, allocations/list copy that avoids `ScenarioComposer`/`HoldingsTable`) can execute now. The list merge (Wave C) and every row above marked "after" should execute after Phase 196 merges and be rebased on main, the same rule D-04 sets for factsheet files; the overlap with 196 plan 06 alone (table, page, section, two wizard steps) makes parallel edits a guaranteed conflict.

## Test censuses that move

| Census / test | Today | Change |
|---------------|-------|--------|
| `src/lib/routing/route-contract-manifest.ts` + `npm run check:route-contract` | `/my-strategies` private | `exception` + `redirectFrom`; `/home` public; Rule 2 needs `/home` in `PUBLIC_ROUTES`. |
| `src/__tests__/check-route-contract.test.ts` | fixtures | none expected (fixtures are self-contained); run it. |
| `src/proxy.test.ts` | two asserts expect `/discovery/crypto-sma` as the signed-in bounce from `/login` and `/forgot-password`; anon public list | expect `/home`; add `/home` anon pass-through and signed-in no-redirect cases. |
| `src/components/marketing/MarketingHeaderActions.test.tsx` | pins `DEFAULT_AUTHENTICATED_ROUTE` = `/discovery/crypto-sma` | pin `ROLE_HOME_ROUTE` = `/home`. |
| `src/app/(auth)/pending-approval/page.test.tsx` | expects `NEXT_REDIRECT:/discovery/crypto-sma` | expects the role home per role. |
| `src/app/strategy/[id]/error.test.tsx` | "Go to Discovery" | role-home link (unless 196-18 deleted it). |
| `src/app/(dashboard)/requireRolePage-wiring.test.tsx` | 7 surfaces incl. `strategies/layout` and `my-strategies/page` | Pattern 3 item 5. |
| `src/lib/auth/requireRolePage.test.ts` | redirect matrix | unchanged outputs; run it after the `roleSurfaceHome` swap. |
| `src/__tests__/phase-149-my-strategies-parity.test.ts` | pins 6, 10, 12 on the my-strategies files | Pitfall 8. |
| `src/components/strategy/StrategyTable.default-mounts.test.tsx` | 3 pinned mounts | Pattern 5. |
| `src/components/strategy/StrategyTable.visibility.test.tsx`, `.pending-chip`, `.stale-analytics` | owner mounts | re-run; adjust only for the new column. |
| `src/components/layout/Sidebar.test.tsx` | 3 tests on `a[href="/my-strategies"]` | one `href="/strategies"` per role (allocator, manager, both), none to `/my-strategies`. |
| `src/components/layout/MobileNav.test.tsx` | allocator set excludes `/strategies` | unchanged (OQ-5). |
| `src/components/layout/DashboardChrome.test.tsx` | `/my-strategies` wide rows + sweep tree | remove. |
| `src/__tests__/page-titles.test.ts` test 4 | "/strategies and /my-strategies carry different PageHeader titles" | rewrite: `/my-strategies` has no page (308). |
| `src/app/(dashboard)/my-strategies/page.test.tsx` | 635 lines | delete with the route; port the behaviours D-02 keeps (empty vs failed read, note copy, placeholders) to the merged page tests. |
| `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx` | imports `MyStrategiesSection` by path | new path. |
| `src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx` | `toHaveAttribute("href", "/my-strategies")` | `/strategies`. |
| strategies page tests (5 files) | table mocks | add `profiles` and allocator-read mocks. |
| `e2e/my-strategies.spec.ts` (+ ci.yml seeded list) | navigates via `a[href="/my-strategies"]` | retarget to `/strategies` (keep the ownership-boundary assertions; consider renaming the file and the ci.yml entry together). |
| `e2e/layout-narrow.spec.ts` `/my-strategies — N-TABLE` | `page.goto("/my-strategies")` | `/strategies`. |
| `e2e/reflow-sweep-authed.spec.ts` | no `/strategies` index row | add one, anchored on the legend heading (UI-SPEC). |
| `e2e/route-redirects.spec.ts` | `/scenarios`, `/portfolios`, `/decks` canaries | add `/my-strategies?x=1` → 308, `location` contains `/strategies` and `x=1`, not `/login`. |
| e2e login waits | see Pitfall 3 | shared predicate. |
| `strategies/loading.tsx` | skeleton columns | add a Health header cell. |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `src/proxy.ts` exporting `proxy` (Next 16 naming) | Next 16 | The proxy file and its `config.matcher` are where bounce logic lives; there is no `middleware.ts`. `[VERIFIED: src/proxy.ts]` |
| In-page redirect stubs for moved routes | `next.config.ts` `redirects()` + manifest `redirectFrom` | Phase 51 | Use for `/my-strategies`. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plausible has goals or dashboards keyed on `/my-strategies` or the old landing path. | Runtime State Inventory | Low: an analytics dashboard shows a drop; no user impact. |
| A2 | A client `router.push` to a page that calls `redirect()` lands on the final URL without a flash; the docs describe the server-component redirect but this exact client-nav path was not exercised this session. | Pattern 1 | Low: if not, the per-role e2e catches it; fallback is `window.location.assign`. |
| A3 | Reading `?next=` as well as `?redirect=` is wanted (two producers emit `next`). | Pattern 2 | Low: either honour both or convert producers. |
| A4 | Excluding archived rows from `getOwnRowPercentiles` subjects matches founder intent. | Pattern 4 | Low: an archived row shows or hides a `Pnn` suffix. |
| A5 | The `E2E_TEST_EMAIL` account's role (used by `strategy-detail-tabs`, `for-quants-onboarding`, `wizard-hydration-probe`) is unknown; those specs are env-gated. | Pitfall 3 | Medium if CI sets the creds: a wait times out. Widen their waits to the shared predicate. |

## Open Questions (RESOLVED)

1. **Signed-out `/home` target.** UI-SPEC says signed out → `/`. That needs `/home` public and bounce-exempt in the proxy. Recommendation: do it (two list entries, two proxy tests); the alternative (`/home` private, signed-out → `/login`) is simpler but contradicts the approved contract. RESOLVED: CD-07 in 199-CONTEXT.md (2026-11-09).
2. **Admin landing for the founder.** All `both` owners are admins, so the founder lands on `/admin` after this phase. Recommendation: ship as CD-01 says; name it in the CHANGELOG. RESOLVED: CD-08 in 199-CONTEXT.md (2026-11-09).
3. **`DepartedHistoryNote` cannot name a key with today's payload.** What we know: the derive computes the departed-unavailable set and writes only a boolean flag plus a count; the TS side lacks the anchor input to recompute it. Recommendation: a plan adds the departed key ids to the derive's flags (`analytics-service/services/job_worker.py`, pytest + mypy strict in the brief), the payload type in `src/lib/queries.ts`, and the reader; until a payload carries ids, the line uses the `whole_history` fallback (allowlisted) with A-CONTACT-CHECK. Alternative if the founder wants no backend change in this phase: book it, and register the current sentence as an allowlisted `whole_history` entry. RESOLVED: CD-09 in 199-CONTEXT.md (2026-11-09).
4. **Allocator-only remedies.** `ownerRemedy` shape remedies link the manager-only edit page. Recommendation: for allocator-only viewers use the Exchanges-page action (A-RECONNECT) for API/composite shapes and the CSV action for CSV, for both Stale and Analytics failed; manager and `both` keep `ownerRemedy`. RESOLVED: CD-11 in 199-CONTEXT.md (2026-11-09).
5. **Archived rows on the merged list.** Allocators now see archived rows (manager read). Recommendation: keep them (UI-SPEC accepted it), Health `—`, and no `Pnn` (exclude from percentile subjects). RESOLVED: CD-12 in 199-CONTEXT.md (2026-11-09).
6. **`both` users lose the inline wizard-draft row** they saw on `/my-strategies` but keep the working resume banner. Recommendation: accept (no data lost, one path to resume). RESOLVED: CD-10 in 199-CONTEXT.md (2026-11-09).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v25.8.1 (repo requires `>=22`) | — |
| npm | install, scripts | ✓ | 11.11.0 | — |
| `node_modules` in the worktree | vitest, tsc, lint, local Next docs | ✗ | — | `npm ci` in the worktree first (blocking for every automated check). |
| Playwright browsers | e2e | not probed (no `node_modules`) | — | e2e runs in CI (`e2e-seeded`, unseeded lists). |
| TEST Supabase creds (`TEST_SUPABASE_URL`, service role) | seeded e2e | CI secrets only | — | Seeded specs self-skip locally; CI runs them. |
| Python analytics-service toolchain (pytest, mypy) | only if Open Question 3 is taken in-phase | not probed | — | Book the derive change instead. |

**Missing dependencies with no fallback:** none (install is a step, not a blocker).
**Missing dependencies with fallback:** `node_modules` (run `npm ci`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^5.0.3 (two projects: jsdom default, node for `NODE_ENV_TEST_FILES`); Playwright ^1.64.1 for e2e |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run <file>` (after `npm ci`) |
| Full suite command | `npm run test && npm run typecheck && npm run lint` (lint chains `check-route-contract` and `check-admin-route-manifest`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-01 | `roleHomeFor` truth table: unapproved → `/pending-approval`, admin → `/admin`, manager → `/strategies`, allocator and `both` → `/allocations`, unknown role → `/pending-approval`; `safeRedirectPath` accepts `/compare`, rejects `//evil`, `https://…`, `/\evil`, `/A` | unit | `npx vitest run src/lib/routing/role-home.test.ts` | ❌ Wave 0 |
| ROUTE-01 | `/home` page: no user → `/`; profile error throws; each role redirects to its home; admin via `isAdminUser` fallback | unit (mocked client) | `npx vitest run src/app/home/page.test.tsx` | ❌ Wave 0 |
| ROUTE-01 | proxy: signed-in `/login`, `/signup`, `/forgot-password` bounce to `/home`; `?redirect=/x` wins; anon `/home` passes; signed-in `/home` not redirected | unit | `npx vitest run src/proxy.test.ts` | ✅ (edit) |
| ROUTE-01 | `LoginForm` pushes the sanitized `redirectTo`, else `/home`; login page sanitizes `redirect`/`next` and the `code` branch | component | `npx vitest run src/components/auth/LoginForm.test.tsx "src/app/(auth)/login/page.test.tsx"` | ❌ Wave 0 |
| ROUTE-01 | every "home" site reads `ROLE_HOME_ROUTE`/`roleHomeFor`; a new hard-coded `/discovery/crypto-sma` outside the navigation allowlist fails | structural | `npx vitest run src/__tests__/role-home-call-sites.test.ts` | ❌ Wave 0 |
| ROUTE-01 | admin guards and `/home` cannot loop (same admin predicate) | unit | `npx vitest run src/lib/routing/role-home.test.ts` | ❌ Wave 0 |
| ROUTE-01 | pending-approval and marketing header use the role home | unit | `npx vitest run "src/app/(auth)/pending-approval/page.test.tsx" src/components/marketing/MarketingHeaderActions.test.tsx` | ✅ (edit) |
| ROUTE-01 | real sign-in lands per role; deep link wins | e2e (seeded) | `npx playwright test e2e/role-home.spec.ts` (CI `e2e-seeded`) | ❌ Wave 0 |
| LEAN-01 | `/my-strategies?x=1` → 308 to `/strategies?x=1`, never `/login` | e2e (unseeded) + config unit | `npx playwright test e2e/route-redirects.spec.ts` and `npm run check:route-contract` | ✅ (edit) |
| LEAN-01 | index admits allocator, manager, both; `new/**` and `[id]/**` stay `manager`; every non-index page under `strategies/` sits under a guarded layout | structural | `npx vitest run "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/__tests__/strategies-guard-coverage.test.ts` | ✅ edit / ❌ Wave 0 |
| LEAN-01 | one `href="/strategies"` per role on desktop and drawer; no `/my-strategies` link anywhere in nav | component | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx` | ✅ (edit) |
| LEAN-01 | merged page per role: allocator sees placeholders, ownership tag, mark/rename, Simulate, no Edit/share/intros; manager the inverse; both the union; allocator wizard draft is a row; empty vs failed read | component (mocked client) | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | ❌ Wave 0 |
| LEAN-01 | Phase 149 parity contract on the merged files | structural | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts` | ✅ (edit) |
| LEAN-01 | public table mounts byte-identical; owner-list pins per role | component golden | `npx vitest run src/components/strategy/StrategyTable.default-mounts.test.tsx` | ✅ (edit) |
| ROUTE-11 | `strategyHealthOf` order and every word incl. `—` cases, key-status-unreadable demotion, future/unknown series end, uses `SERIES_STALE_DAYS` boundary (7 days → Healthy, 8 → Stale) | unit | `npx vitest run src/lib/strategy-health.test.ts` | ❌ Wave 0 |
| ROUTE-11 | Health column renders the server word with its tone; placeholder `—` | component | `npx vitest run src/components/strategy/StrategyTable.health.test.tsx` | ❌ Wave 0 |
| ROUTE-11 | legend has an entry for every strategy status, ownership tag, pipeline chip, key pill and Health word; legend operator text matches the ladder | component | `npx vitest run "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx"` | ❌ Wave 0 |
| ROUTE-11 | registry: every `degrade` entry's rendered sample names its key or day AND carries its vocabulary action; `whole_history` allowlist count-pinned; `recipient` never names a key; dead key names only itself | unit | `npx vitest run src/lib/degrade-warnings.test.ts` | ❌ Wave 0 |
| ROUTE-11 | scan: unregistered warning in a scanned surface fails; orphan registry entry fails | structural | `npx vitest run src/__tests__/degrade-warning-scan.test.ts` | ❌ Wave 0 |
| ROUTE-11 | reflow at 320px and axe per role on `/strategies` | e2e (seeded) | `npx playwright test e2e/reflow-sweep-authed.spec.ts e2e/axe-app-wide.spec.ts` (CI) | ✅ (edit) |

Rule 9 evidence each new gate must carry in its SUMMARY: back up the source with `cp -p`, neuter (e.g. delete the key slot from `DepartedHistoryNote`'s template; re-add the `/discovery/crypto-sma` literal to `LoginForm`; drop `requireRolePage` from `new/layout.tsx`; remove `/home` from `isAuthBounceExempt`), run the test, see RED naming the cause, restore from the backup, `cmp` exits 0, GREEN.

### Sampling Rate
- **Per task commit:** the task's own `npx vitest run <files>` plus `npm run typecheck`.
- **Per wave merge:** `npm run test && npm run lint` (route contract included).
- **Phase gate:** full suite green, plus the CI e2e lists, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `npm ci` in the worktree (no `node_modules` today).
- [ ] `src/lib/routing/role-home.test.ts`
- [ ] `src/app/home/page.test.tsx`
- [ ] `src/components/auth/LoginForm.test.tsx` (none exists today; check with `ls src/components/auth/`), login page test
- [ ] `src/__tests__/role-home-call-sites.test.ts`
- [ ] `src/__tests__/strategies-guard-coverage.test.ts`
- [ ] `src/app/(dashboard)/strategies/page.merged.test.tsx`
- [ ] `src/lib/strategy-health.test.ts`, `StrategyTable.health.test.tsx`, `StrategiesLegend.test.tsx`
- [ ] `src/lib/degrade-warnings.test.ts`, `src/__tests__/degrade-warning-scan.test.ts`
- [ ] `e2e/role-home.spec.ts` + its `ci.yml` seeded-list entry

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (absent = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (sign-in mechanism unchanged) | Supabase `signInWithPassword` |
| V3 Session Management | no | unchanged |
| V4 Access Control | yes | `requireRolePage` in segment layouts (moved, not weakened) + structural coverage test; owner-scoped reads `.eq("user_id", user.id)` with RLS `strategies_read` as backstop; manager-only furniture (share links, intros, `StrategyActions`) rendered only for `manager`/`both`; `isAdminUser` unchanged on admin pages. |
| V5 Input Validation | yes | `safeRedirectPath` (`^/[a-z]`) for `?redirect=`/`?next=`, applied to the login page's `code` branch too (currently unsanitized). |
| V6 Cryptography | no | — |
| V8 Data Protection | yes | `KEY_STATUS_COLUMNS` stays an explicit allowlist (`label` added; never an encrypted column); recipient-class warnings never name an owner's key. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open redirect via `?redirect=` / `?next=` (CWE-601) | Spoofing | One `safeRedirectPath`; fix the `exchangeCodeForSession` branch's raw `redirect(params.redirect || ...)`. |
| Redirect loop between `/home` and a guard | Denial of service | Same admin predicate on both sides; `/home` bounce-exempt; tests. |
| Allocator reaching manager write routes after the index widens | Elevation of privilege | Guards move to `new/layout.tsx` and `[id]/layout.tsx`; structural test; API routes keep their own auth. |
| Cross-user row leak on the widened index | Information disclosure | Owner-scoped list read (pinned by parity pin 10's regex), `noStore()` kept, `force-dynamic` layout. |
| Manager furniture leaking to allocator-only accounts | Information disclosure | Role read on the page; furniture props built only for `manager`/`both`; per-role component test. |

## Sources

### Primary (HIGH confidence)
- Worktree source read this session: `src/proxy.ts`, `src/lib/routing/default-route.ts`, `src/lib/routing/route-contract-manifest.ts`, `src/components/auth/LoginForm.tsx`, `src/components/auth/OnboardingWizard.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/pending-approval/page.tsx`, `src/app/(auth)/onboarding/page.tsx`, `src/lib/approval.ts`, `src/lib/auth/requireRolePage.ts`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/strategies/layout.tsx`, `src/app/(dashboard)/strategies/page.tsx`, `src/app/(dashboard)/my-strategies/page.tsx`, `MyStrategiesSection.tsx`, `src/components/strategy/StrategyTable.tsx` (props, chip derivation, manager branches), `src/components/layout/Sidebar.tsx`, `src/lib/queries.ts` (`getMyStrategies`, `getOwnRowPercentiles`, `getStrategylessActiveKeys`, `shapeRowAnalytics`, `shapeRankingRows`, `CATEGORY_RANKING_ANALYTICS_COLUMNS`), `src/lib/closed-sets.ts`, `src/lib/freshness.ts`, `src/lib/status-surface-copy.ts`, `src/lib/compute-state.ts`, `src/lib/api-key-label.ts`, `src/components/ui/Badge.tsx`, `src/components/strategy/OwnershipTag.tsx`, `src/lib/types.ts`, `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`, `MissingDataMessage.tsx`, `src/lib/departed-history.ts`, `next.config.ts` `redirects()`, `src/app/(dashboard)/requireRolePage-wiring.test.tsx`, `src/__tests__/phase-149-my-strategies-parity.test.ts`, `e2e/helpers/login.ts`, `e2e/route-redirects.spec.ts`, `package.json`, `package-lock.json`.
- Phase 196 plans 01-21 frontmatter (`files_modified`, `files_deleted`, waves), `196-03-PLAN.md`, `196-06-PLAN.md`, `196-20-PLAN.md`, `196-UI-SPEC.md` origin table, `196-CONTEXT.md` decisions (sibling worktree, read-only).
- Next.js docs: `redirect` (lastUpdated 2026-07-28) and `next.config.js redirects` (lastUpdated 2026-06-30).

### Secondary (MEDIUM confidence)
- The degrade-warning seed counts (enumeration command output at HEAD); the plan's first task re-measures.

### Tertiary (LOW confidence)
- Assumptions A1-A5.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependency; versions read from the lockfile.
- Architecture: HIGH for role home, guard split and the 308 (code + docs); MEDIUM for the `StrategyTable` decoupling (the shape is clear, the golden-test churn is large and overlaps Phase 196 plan 06).
- Pitfalls: HIGH, each measured by grep or Read.
- Degrade-warning inventory: MEDIUM (seed; the enumeration is the authority).

**Research date:** 2026-11-09
**Valid until:** until Phase 196 merges (then re-measure every "after 196" row and the call-site allowlist), at most 2026-12-09.
