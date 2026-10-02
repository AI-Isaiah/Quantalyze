# Phase 109: ROLE — predicate unification + page guards - Research

**Researched:** 2026-07-16
**Domain:** Next.js 16 App Router server-side authorization (role-based page guards) + Supabase RLS/migration + nav derivation refactor
**Confidence:** HIGH (all findings verified against in-repo source; Next.js redirect API verified against bundled `node_modules/next/dist/docs/`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**Nav predicate unification**
- Drop `|| isAdmin` from all three `shows*` derivations in `Sidebar.tsx:49-51` (`showsAllocatorWorkspace`, `showsManagerWorkspace`, `showsDiscovery`) so they become pure `isAllocator` / `isManager` (role-derived). Apply the identical drop anywhere `MobileNav`/other nav surfaces duplicate the OR-in (planner to enumerate — the two navs must not drift; `formatBadgeCount` is already shared for this reason).
- `is_admin` gates ONLY the Admin section. An `is_admin`+`manager` account sees the manager workspace + Admin, NOT the allocator workspace (ROLE-03).
- At 109 close: an allocator-role account shows ZERO sell-side surfaces (Strategies, Portfolios). The scoped "Add a Strategy" entry is a Phase-110 future exception, not built here (ROLE-02).

**Server-side page guards (three-branch failure model)**
- Add ONE shared server helper (`requireRolePage` / analogous), mirroring `withAllocatorAuth.ts`'s three-branch discipline, called in each role-owned route group's server layout/page:
  - **DB-error branch** → do NOT redirect; surface as an error/503-equivalent and report to Sentry, matching `withAllocatorAuth`.
  - **Missing-profile branch** → handled explicitly (Sentry soft signal), not a silent redirect loop.
  - **Wrong-role branch** → server-side `redirect()` to the caller's role home surface (never a 403 page, never a half-rendered page) (ROLE-04).
- Redirect target = the role's home surface (planner to confirm exact routes). The full `role × is_admin` matrix MUST be enumerated and proven redirect-loop-free (a `both` user owns both surfaces → never redirected off either).

**Atomic staff backfill [GATE — hard]**
- SQL migration in the SAME PR/deploy as the `|| isAdmin` drop: `UPDATE profiles SET role='both' WHERE is_admin = true AND role <> 'both';` (idempotent; timestamped per convention).
- Pre-merge SQL assertion (in `supabase/tests/test_*.sql`) proving `is_admin = true AND role NOT IN ('both')` returns the empty set.
- The migration MUST be MCP-applied to the test project (qmnijlgmdhviwzwfyzlc) BEFORE merge so the RED-guarded SQL assertion passes in CI.

**Honest denied-action copy**
- Any role-denied action names the role requirement and never offers a retry that cannot succeed (ROLE-06). Reuse the existing `withAllocatorAuth` "Forbidden — allocator role required" style.

### Claude's Discretion
- Exact helper name/signature and file location; exact home-route redirect targets (derived from existing routing); whether a signup/creation-time default is added for new `is_admin` accounts (backfill covers existing; a forward-guard is optional polish, not required).

### Deferred Ideas (OUT OF SCOPE)
- Allocator-scoped "Add a Strategy" nav entry → Phase 110 (CONTRIB-01).
- Any composer/constituent role interplay → Phase 111+.
- Optional creation-time `role='both'` default for newly-flagged `is_admin` accounts — not required by 109; note for a future hardening pass.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROLE-01 | Manager never sees allocator workspace (My Allocation, Scenario, Recommendations, Compare, Decks) or Discovery in nav | `Sidebar.tsx:49,51` drop `|| isAdmin` → `showsAllocatorWorkspace`/`showsDiscovery` become pure `isAllocator`. Manager's `isManager` is derived independently (`layout.tsx:46`), so it survives. |
| ROLE-02 | Allocator never sees sell-side surfaces (Strategies, Portfolios) in nav | `Sidebar.tsx:50` drop `|| isAdmin` → `showsManagerWorkspace` becomes pure `isManager`. Allocator (`role='allocator'`) has `isManager=false`. |
| ROLE-03 | `is_admin` adds only Admin section; grants no marketplace surface | Admin section already gated on `isAdmin` alone (`Sidebar.tsx:131`). After the OR-in drop, `is_admin` no longer feeds `shows*`. Page guards must key on `role` only, NOT `is_admin`. |
| ROLE-04 | Direct URL to unowned route → server-side redirect to home surface (not 403/half-render) | NEW shared server helper mirroring `withAllocatorAuth`'s three branches, using `redirect()` (Next 16, verified). No page-level role guard exists today — genuinely new. |
| ROLE-05 | Staff retain full access after OR-in drop (via `role='both'`) | Atomic backfill migration + empty-set pgTAP assertion. `both` == manager AND allocator (established). |
| ROLE-06 | Role-denied action names the requirement, no impossible retry | Reuse `withAllocatorAuth`'s specific-cause copy pattern. For pages, ROLE-04's redirect means the denied user never sees a dead-end; any residual denied *action* copy names the role. |
</phase_requirements>

## Summary

Phase 109 unifies the marketplace-persona predicate (`profiles.role`) so it — not `is_admin` — drives nav, page access, and (already-done) APIs. Three things ship as one atomic unit: (1) drop `|| isAdmin` from the nav derivations, (2) add a NEW server-side page guard, and (3) backfill `role='both'` for every `is_admin` account so staff keep access. The backfill and the OR-in drop are inseparable (the hard GATE): shipping the drop without the backfill locks every staff account out of the allocator workspace.

Two findings reshape the plan. **First, the OR-in lives in exactly two functions in one file** — `Sidebar.tsx::buildNavSections` (lines 49-51) and `Sidebar.tsx::buildPrimaryMobileNav` (lines 198-199). `MobileNav.tsx` has NO independent OR-in; it delegates to `buildPrimaryMobileNav`. So there is one file to change and no cross-file drift risk beyond those two functions. **Second, no page-level role guard exists today** — every owned page gates only `if (!user) redirect("/login")`. The wrong-role guard is genuinely new. There is a strong in-repo precedent to mirror: `withAllocatorAuth.ts` (the three-branch API gate) for the *branch logic*, and `discovery/layout.tsx` (a route-group server layout that gates on every request and renders/redirects) for the *attachment mechanism*.

Critical distinction the planner must not miss: **there are two separate role systems.** `profiles.role` (`allocator`|`manager`|`both`) + `is_admin` boolean is the marketplace persona this phase targets — used by `withAllocatorAuth` and `(dashboard)/layout.tsx`. `user_app_roles` (`admin`|`allocator`|`quant_manager`|`analyst`) is a *different* RBAC join table used by `requireRole`/`withRole` in `lib/auth.ts`. **Mirror `withAllocatorAuth` (profiles.role), NOT `requireRole` (user_app_roles).**

**Primary recommendation:** Build one shared server helper (e.g. `src/lib/auth/requireRolePage.ts`) that fetches `profiles.role`, mirrors `withAllocatorAuth`'s three branches (DB-error → `throw` to `error.tsx` + Sentry, never redirect; missing-profile → Sentry soft signal + `throw`; wrong-role → `redirect(homeSurface)`), and call it at the top of each owned page (or a per-role route-group layout). Land it in the same PR as the `Sidebar.tsx` OR-in drop and the `role='both'` backfill migration + empty-set pgTAP assertion. Do NOT put role gating in `proxy.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Nav item visibility | Frontend Server (SSR `(dashboard)/layout.tsx` derives flags) | Browser (`Sidebar`/`MobileNav` render) | Flags computed server-side from `profiles.role`; components are pure renderers. UX hint, not a security boundary. |
| Page access enforcement | Frontend Server (RSC page/layout) | API/Backend (RLS on data) | ROLE-04 is a server-render decision (`redirect()`); the real data boundary stays RLS + `withAllocatorAuth`. Defense-in-depth: nav-hide + page-guard + RLS. |
| Staff access preservation | Database (backfill migration on `profiles.role`) | — | One-time data migration; `role='both'` is the durable predicate. |
| Denied-action copy | Frontend (component) | API (`withAllocatorAuth` 403 body) | Honest specific-cause messaging. |
| Session presence (authn) | Frontend Server (`proxy.ts` cookie check + page `getUser()`) | — | Already exists; role gating is explicitly NOT added here (see Pitfall 4). |

## Standard Stack

No new dependencies. This is a wiring/refactor phase against the existing stack.

### Core (existing, in-repo)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.10 | App Router RSC + `redirect()` | Already the framework. `redirect()` in Server Components verified. `[VERIFIED: node_modules/next package.json + bundled docs]` |
| @supabase/ssr | in-repo | Server client for `profiles` read | Pattern used by `withAllocatorAuth`, `(dashboard)/layout.tsx`, `discovery/layout.tsx`. `[VERIFIED: codebase]` |
| pgTAP (Supabase tests) | in-repo | SQL empty-set assertion | `supabase/tests/test_*.sql` convention; runs in CI. `[VERIFIED: codebase]` |

**Installation:** none.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All work uses in-repo modules and the existing Next.js/Supabase stack. No `npm install` step.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
  Request  ───────► │ proxy.ts (Next 16 middleware, renamed)       │
  (bookmark/URL)    │  • getSession() cookie-only, NO network      │
                    │  • !session && !public → redirect /login     │
                    │  • DOES NOT enforce role/admin (by design)   │
                    └───────────────┬─────────────────────────────┘
                                    │ session present
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │ (dashboard)/layout.tsx  [SSR]                │
                    │  • getUser() (authoritative)                 │
                    │  • SELECT role, statuses, is_admin           │
                    │  • isProfileApproved → redirect /pending     │
                    │  • derive isAllocator / isManager / isAdmin  │──► DashboardChrome
                    └───────────────┬─────────────────────────────┘       │
                                    │                                       ▼
                                    │                          Sidebar / MobileNav
                                    │                          (pure renderers; flags in)
                                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ Owned page / route-group layout  [SSR]                         │
        │   NEW: requireRolePage(supabase, user, 'allocator'|'manager')  │
        │     ├─ DB error   → throw → error.tsx  (503-equiv) + Sentry    │  ◄── never redirect
        │     ├─ no profile → throw + Sentry soft signal                 │  ◄── never redirect
        │     └─ wrong role → redirect(roleHomeSurface)                  │  ◄── the only redirect
        └───────────────────────────────────────────────────────────────┘
                                    │ owns route
                                    ▼
                    Data reads (RLS + withAllocatorAuth on APIs) — unchanged
```

### Recommended Project Structure
```
src/
├── lib/auth/
│   └── requireRolePage.ts       # NEW shared server guard (mirrors withAllocatorAuth branches)
├── components/layout/
│   └── Sidebar.tsx              # EDIT: drop || isAdmin in buildNavSections (49-51) + buildPrimaryMobileNav (198-199)
├── app/(dashboard)/
│   ├── allocations/page.tsx     # allocator-owned  → guard call
│   ├── recommendations/page.tsx # allocator-owned  → guard call
│   ├── compare/page.tsx         # allocator-owned  → guard call
│   ├── decks/page.tsx           # allocator-owned  → guard call
│   ├── discovery/layout.tsx     # allocator-owned  → add role branch to existing layout gate
│   ├── strategies/page.tsx      # manager-owned    → guard call
│   └── portfolios/page.tsx      # manager-owned    → guard call
supabase/
├── migrations/20260716HHMMSS_backfill_staff_role_both.sql  # NEW atomic backfill
└── tests/test_staff_role_both_backfill.sql                 # NEW empty-set assertion
```

### Pattern 1: Three-branch server-side page guard
**What:** A server helper that fetches `profiles.role` and branches identically to `withAllocatorAuth`, except the wrong-role branch calls `redirect()` instead of returning a 403 `NextResponse`.
**When to use:** At the top of each role-owned RSC page/layout, after `getUser()`.
**Reference (branch logic to mirror — `src/lib/api/withAllocatorAuth.ts:61-127`):**
```typescript
// Source: src/lib/api/withAllocatorAuth.ts (three-branch discipline)
// DB error  → 503 + Sentry (NOT 403 — a Postgres hiccup is not a demotion)
// no profile → 403 + Sentry soft signal
// wrong role → 403 "Forbidden — allocator role required"
```
**Page-guard adaptation (new helper, illustrative shape):**
```typescript
// requireRolePage(supabase, user, need: 'allocator' | 'manager', homeHref)
// 1. const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
// 2. if (error)  { captureToSentry(...); throw error; }         // → error.tsx, NEVER redirect
// 3. if (!data)  { captureToSentry(soft); throw new Error(...);} // → error.tsx, NEVER redirect
// 4. const owns = need === 'allocator'
//        ? (data.role === 'allocator' || data.role === 'both')
//        : (data.role === 'manager'   || data.role === 'both');
// 5. if (!owns) redirect(homeHref);   // MUST be OUTSIDE any try/catch — see Pitfall 2
```

**CRITICAL — `redirect()` throws:** Per bundled Next 16 docs (`redirect.md:50-52`), `redirect()` throws `NEXT_REDIRECT` and MUST be called *outside* a `try/catch`, or the catch swallows the redirect. So structure the guard: DB read + error/missing handling inside try/catch (or handle the returned `error` object without throwing into a catch that also wraps the redirect); the `redirect()` call in step 5 sits on the outside. In a Server Component `redirect()` serves a 307 and terminates the segment. `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md]`

### Pattern 2: Route-group layout gate (attachment precedent)
**What:** `discovery/layout.tsx` is a server layout that runs on every request, redirects unauthenticated users, and *renders a gate component* (does not redirect) on the fail-closed/error branch.
**Reference (`src/app/(dashboard)/discovery/layout.tsx`):** `export const dynamic = "force-dynamic"` (prevents a caching PR from fail-open), `if (!user) redirect(...)`, `if (error) return <Gate/>`, `return <>{children}</>`. This is the model for attaching a guard at a layout. For role, the error branch throws (→ `error.tsx`) rather than rendering a gate, and the wrong-role branch redirects.

### Attachment decision (Claude's Discretion — recommend)
Two viable attachment strategies; recommend **per-page helper calls** for surgical minimalism (project Rule 3), OR **role route-group layouts** if the planner prefers DRY:
- **(A) Per-page helper call (recommended):** add one `await requireRolePage(...)` line at the top of each of the 7 owned pages (allocations, recommendations, compare, decks, strategies, portfolios) + a role branch in `discovery/layout.tsx`. Minimal diff, no directory moves, no risk to the FLOW-03 phase-32 frozen-spine guard.
- **(B) Role route-group layouts:** create `(dashboard)/(allocator)/layout.tsx` + `(dashboard)/(manager)/layout.tsx` and move route dirs in. Route groups `(name)` do NOT change URLs, so `/allocations` still resolves. DRYer but a large move-diff. Only if the planner judges the move low-risk.

### Anti-Patterns to Avoid
- **Gating role in `proxy.ts`:** the proxy deliberately does NOT enforce role/admin (comment at `proxy.ts:146-160`) — it uses cookie-only `getSession()` (no network) and page-level checks are authoritative. Adding a `profiles` read to the proxy re-introduces the exact Supabase coupling that decision removed. Keep role gating page-level.
- **Keying the page guard on `is_admin`:** ROLE-03 requires `is_admin` grant NO marketplace surface. The guard must branch on `role` only. Staff access comes from the `role='both'` backfill, not from an `is_admin` bypass.
- **Collapsing infra failure into a redirect:** a transient DB error must NOT redirect (it would masquerade as "wrong role" and bounce a valid allocator off their own surface). Mirror `withAllocatorAuth`'s 503-not-403 discipline.
- **Blending the two role systems:** do not import `requireRole`/`withRole` (they read `user_app_roles`). Use `profiles.role`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Three-branch role check | A fresh inline `if role !== x` per page | The new shared `requireRolePage` helper mirroring `withAllocatorAuth` | Inlining the profile lookup per-site is the exact bug pattern `withAllocatorAuth` was created to retire (`withAllocatorAuth.ts:41-46`). |
| Nav role OR-logic | A second hardcoded item list in MobileNav | `buildPrimaryMobileNav` (already the single source) | `MobileNav.tsx` already delegates; the two navs share one source so they can't drift. |
| Sentry reporting shape | A bespoke capture call | `captureToSentry` (`@/lib/sentry-capture`) with tags like `withAllocatorAuth` uses | Consistent telemetry; SRE dashboards already key on the gate-failure tags. |
| Empty-set SQL proof | Application-level assertion | pgTAP test in `supabase/tests/` | Runs in CI as a RED-guarded gate; the established convention. |

**Key insight:** Every piece of this phase has a canonical in-repo pattern to copy. The risk is not "how to build it" but "coupling the three changes atomically and enumerating the redirect matrix."

## Runtime State Inventory

This phase edits code (nav + guards) AND performs a **data migration** on stored `profiles.role`. Both must appear in the plan.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `profiles.role` rows where `is_admin=true AND role <> 'both'` — these staff accounts currently rely on the `|| isAdmin` nav OR-in for allocator access. When the OR-in drops, they lose it unless `role` is updated. | **Data migration** (`UPDATE profiles SET role='both' WHERE is_admin=true AND role<>'both'`) — the hard GATE, same PR as the code edit. |
| Live service config | None — nav flags are derived at render time from `profiles.role`; no external service (n8n/Datadog/etc.) stores the persona string. Verified: no config file or dashboard holds the OR-in logic. | None. |
| OS-registered state | None — no cron/scheduler/task references the role predicate. Verified by grep of `supabase/migrations` cron defs — retention crons key on data age, not role. | None. |
| Secrets/env vars | `DEFAULT_AUTHENTICATED_ROUTE` in `proxy.ts` is `/discovery/crypto-sma` (an allocator surface) — NOT a secret, but a **code constant** that post-login-bounces every role to an allocator route. A manager landing there post-109 gets redirected by the discovery guard. | **Code review** — confirm the manager redirect from `/discovery/*` is loop-free (→ `/strategies`); consider a role-aware default (optional). See Open Question 1. |
| Build artifacts | None — no compiled/installed artifact embeds the role predicate. | None. |

**The canonical question — after every file is updated, what runtime state still has the old assumption?** The `profiles` table: staff rows with `is_admin=true, role!='both'`. The backfill is the only durable fix; the code edit alone would lock them out. This is why the GATE is hard.

## Common Pitfalls

### Pitfall 1: Splitting the backfill from the OR-in drop
**What goes wrong:** OR-in drop ships in one PR, backfill in another. Between them, every staff account (`is_admin=true`, `role` still `manager`/`allocator`) loses the workspace the OR-in used to grant.
**Why it happens:** They feel like separate concerns (frontend vs DB).
**How to avoid:** ONE PR/deploy. The pgTAP empty-set assertion in the same PR is the CI-enforced proof, per STATE.md's "hard gate for 109."
**Warning signs:** A plan that puts the migration and the `Sidebar.tsx` edit in different waves/PRs.

### Pitfall 2: `redirect()` swallowed by try/catch
**What goes wrong:** The guard wraps its DB read AND the `redirect()` in one `try/catch`; the catch swallows `NEXT_REDIRECT` and the wrong-role user renders the page anyway (fail-open).
**Why it happens:** `redirect()` signals via a thrown control-flow exception.
**How to avoid:** Call `redirect()` OUTSIDE the try/catch (`redirect.md:50-52`). If you must catch, re-throw `NEXT_REDIRECT` (or use `unstable_rethrow`). Structure: read+validate inside try, compute `owns`, then `redirect()` on the outside.
**Warning signs:** A `try { ...; if (!owns) redirect(home); } catch {}` shape.

### Pitfall 3: Redirect loop off a valid owner's own surface
**What goes wrong:** The home target for a role is a route that role doesn't own, or a DB blip redirects a valid owner, causing a bounce/loop.
**How to avoid:** Enumerate the full `role × is_admin` matrix (below); home target is ALWAYS a route the role owns; DB-error/missing-profile branches NEVER redirect. A `both` user owns both surfaces → never redirected.
**Warning signs:** Manager home set to an allocator route (or vice-versa); redirect on the error branch.

### Pitfall 4: Putting role gating in the proxy
**What goes wrong:** Planner adds a role check to `proxy.ts`. It uses cookie-only `getSession()` (no fresh `profiles` read), re-couples the proxy to Supabase, and duplicates the deliberately-page-level admin decision (`proxy.ts:146-160`).
**How to avoid:** Keep role gating at page/layout level, matching how admin gating is page-level (`isAdminUser`).

### Pitfall 5: Grepping `src/` only when deleting nav strings
**What goes wrong:** A removed nav path or role string lingers in `e2e/` specs (v1.10 lesson: SC-3 grep-gates scan `src/` only). Not deleting UI strings here, but nav-visibility e2e specs may assert the old admin-sees-everything behavior.
**How to avoid:** grep the WHOLE repo (incl. `e2e/`, `src/**/*.test.tsx`) for tests asserting `isAdmin` shows allocator/manager workspaces — `Sidebar.test.tsx:173,445-446` and `MobileNav.test.tsx:12` already document the OR-logic and WILL need updating.

## Code Examples

### Nav OR-in drop (the two sites, one file)
```typescript
// Source: src/components/layout/Sidebar.tsx:49-51 (buildNavSections)
// BEFORE:
const showsAllocatorWorkspace = isAllocator || isAdmin;
const showsManagerWorkspace   = isManager   || isAdmin;
const showsDiscovery          = isAllocator || isAdmin;
// AFTER (pure role):
const showsAllocatorWorkspace = isAllocator;
const showsManagerWorkspace   = isManager;
const showsDiscovery          = isAllocator;

// Source: src/components/layout/Sidebar.tsx:198-199 (buildPrimaryMobileNav)
// BEFORE:
const showsAllocatorWorkspace = p.isAllocator || p.isAdmin;
const showsManagerWorkspace   = p.isManager   || p.isAdmin;
// AFTER:
const showsAllocatorWorkspace = p.isAllocator;
const showsManagerWorkspace   = p.isManager;
```
Note: the Admin section (`Sidebar.tsx:131`) stays gated on `isAdmin` alone — unchanged. `MobileNav.tsx` needs NO edit (delegates to `buildPrimaryMobileNav`).

### Backfill migration (idempotent, timestamped)
```sql
-- Source: pattern from supabase/migrations/20260521150000_universal_signup_approval_gate.sql
-- File: supabase/migrations/20260716HHMMSS_backfill_staff_role_both.sql  (HHMMSS > 090000; latest is 20260716090000)
-- Header block explains WHY (staff kept via role='both' as the || isAdmin nav OR-in drops).
UPDATE profiles
SET role = 'both'
WHERE is_admin = true
  AND role <> 'both';
-- Idempotent: re-running is a no-op once all staff are 'both'.
-- NB: prevent_profile_role_change (migration 20260520222848) is SECURITY INVOKER
-- and blocks role change for non-privileged sessions; a migration runs as the
-- table owner / postgres, so this UPDATE is NOT blocked. Verify in test-project apply.
```

### Empty-set pgTAP assertion
```sql
-- Source: convention from supabase/tests/test_handle_new_user_role_allowlist.sql
-- File: supabase/tests/test_staff_role_both_backfill.sql
-- Asserts the GATE invariant: no staff account is left without 'both' after backfill.
BEGIN;
DO $$
DECLARE v_leaked int;
BEGIN
  SELECT count(*) INTO v_leaked
  FROM profiles
  WHERE is_admin = true AND role NOT IN ('both');
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'GATE FAILED: % staff rows have is_admin=true but role NOT IN (both)', v_leaked;
  END IF;
END $$;
ROLLBACK;
```
This is RED-guarded: it only passes once the backfill migration is applied to the test project (qmnijlgmdhviwzwfyzlc) via MCP BEFORE merge (test-project catch-up rule). Match the exact pgTAP/DO-block style of the sibling tests; confirm whether the suite uses `plan()`/`finish()` or bare `DO` blocks (both appear in-repo — `test_handle_new_user_role_allowlist.sql` uses a bare `DO` block).

## role × is_admin redirect-loop matrix

Home targets (recommended, Claude's Discretion — planner confirms): **allocator home = `/allocations`**, **manager home = `/strategies`**. `both` owns everything.

| role | is_admin | Owns allocator routes? | Owns manager routes? | Sees Admin? | Visiting `/strategies` | Visiting `/allocations` | Loop-free? |
|------|----------|------------------------|----------------------|-------------|------------------------|--------------------------|-----------|
| allocator | false | ✅ | ❌ | ❌ | redirect → `/allocations` (owned) | render | ✅ |
| allocator | true  | ✅ | ❌ | ✅ | redirect → `/allocations` | render | ✅ (is_admin adds only /admin) |
| manager | false | ❌ | ✅ | ❌ | render | redirect → `/strategies` (owned) | ✅ |
| manager | true  | ❌ | ✅ | ✅ | render | redirect → `/strategies` | ✅ |
| both | false | ✅ | ✅ | ❌ | render | render | ✅ (never redirected) |
| both | true  | ✅ | ✅ | ✅ | render | render | ✅ |
| (missing profile) | — | — | — | — | **throw → error.tsx (NEVER redirect)** | throw → error.tsx | ✅ (no loop) |

Key: home target is always a route the role owns → no bounce. The missing-profile/DB-error branches throw (not redirect) → structurally loop-immune. After the backfill, the "staff = is_admin+manager loses allocator" cell disappears because staff become `role='both'`.

**Cross-cutting loop check (Open Question 1):** `proxy.ts` `DEFAULT_AUTHENTICATED_ROUTE = '/discovery/crypto-sma'` (allocator surface) is the post-login + auth-bounce target for ALL roles. A manager post-login lands on `/discovery/*` → the discovery guard redirects → `/strategies`. That is a single hop to an owned route (loop-free), but it's a UX wrinkle. Planner should verify this hop and decide whether to make the default role-aware.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `is_admin` OR-in grants marketplace surfaces (triage/demo) | `role` is the sole persona predicate; `is_admin` is Admin-only; staff use `role='both'` | Phase 109 | Removes the "half-broken empty-payload surface" for admins; staff preserved via backfill |
| No page-level role guard (only `if (!user) redirect('/login')`) | Server-side three-branch role guard on owned routes | Phase 109 | Direct-URL access to unowned routes redirects to home surface |
| Next.js `middleware.ts` | `proxy.ts` (renamed in Next 16) | Next 16 | Already migrated in-repo; do NOT add role gating here |

**Deprecated/outdated:** the Sidebar comment block (`Sidebar.tsx:41-48`) "Admins see BOTH allocator AND manager surfaces (triage/demo)" becomes stale after this phase — update it to reflect role-only derivation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Allocator home = `/allocations`, manager home = `/strategies` | redirect matrix | Low — Claude's Discretion; planner confirms. Wrong target could bounce, but any owned route avoids a loop. |
| A2 | `prevent_profile_role_change` trigger does NOT block the migration's UPDATE (migration runs as postgres/owner, trigger is SECURITY INVOKER) | Backfill migration | MEDIUM — if the trigger DOES fire under the migration runner, the UPDATE silently no-ops and the GATE assertion fails. **Verify during test-project MCP apply** (the assertion catches it). |
| A3 | pgTAP suite accepts a bare `DO`-block assertion (no `plan()`/`finish()` required) | Empty-set assertion | Low — `test_handle_new_user_role_allowlist.sql` uses a bare `DO` block; confirm the runner config. |
| A4 | No `e2e/` or `.test.tsx` spec beyond the three identified asserts admin-sees-all nav | Pitfall 5 | Low-MEDIUM — grep the whole repo before finalizing; missed specs turn red in CI. |

## Open Questions

1. **`DEFAULT_AUTHENTICATED_ROUTE` is allocator-centric (`/discovery/crypto-sma`).**
   - What we know: it's the post-login + auth-bounce target for all roles (`proxy.ts:25,139`). A manager will hit it and be redirected by the discovery role guard to `/strategies`.
   - What's unclear: whether to accept the one-hop redirect or make the default role-aware (needs a `profiles.role` read the proxy deliberately avoids — so likely handled by the login-callback or discovery guard, not the proxy).
   - Recommendation: accept the single-hop redirect for 109 (loop-free, honest); note a role-aware default as optional polish. Verify the hop in the redirect-loop e2e.

2. **Guard attachment: per-page helper vs role route-group layout.**
   - What we know: no per-role route groups exist; all owned routes sit directly under `(dashboard)`. `discovery/` is the only one with a layout.
   - Recommendation: per-page helper calls (surgical, no directory move, no FLOW-03 frozen-spine-guard risk). Planner decides.

3. **Does the `prevent_profile_role_change` trigger interfere with the backfill?**
   - Recommendation: apply the migration to the test project via MCP first (required anyway) and confirm the empty-set assertion passes — that end-to-end apply is the definitive check (see A2).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Next.js runtime | page guards, redirect | ✓ | 16.2.10 | — |
| Supabase test project (qmnijlgmdhviwzwfyzlc) | pre-merge SQL assertion (RED-guarded) | ✓ (MCP) | — | none — migration MUST be MCP-applied before merge |
| pgTAP / supabase test runner in CI | empty-set assertion | ✓ | — | — |

**Missing dependencies with no fallback:** none. **With fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS/TSX) + pgTAP-style SQL tests (`supabase/tests/*.sql`) |
| Config file | `vitest.config.ts` (sharded in CI, `--coverage`) |
| Quick run command | `npx vitest run src/components/layout/Sidebar.test.tsx --no-file-parallelism` |
| Full suite command | `npm run test` (TS) + SQL tests via the supabase test job in `ci.yml` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROLE-01 | Manager sees no allocator/discovery nav | unit | `npx vitest run src/components/layout/Sidebar.test.tsx` | ✅ exists — UPDATE (currently asserts admin-sees-all) |
| ROLE-02 | Allocator sees no manager nav | unit | `npx vitest run src/components/layout/Sidebar.test.tsx` | ✅ exists — UPDATE |
| ROLE-03 | `is_admin` adds only Admin | unit | `npx vitest run src/components/layout/Sidebar.test.tsx` + MobileNav.test.tsx | ✅ exists — UPDATE |
| ROLE-04 | Wrong-role page → redirect; DB-error → no redirect | unit/integration | `npx vitest run src/lib/auth/requireRolePage.test.ts` | ❌ Wave 0 (new helper + test) |
| ROLE-05 | Staff kept via `role='both'`; empty-set holds | SQL | supabase test job (`test_staff_role_both_backfill.sql`) | ❌ Wave 0 |
| ROLE-06 | Denied-action copy names role | unit | reuse `withAllocatorAuth.test.ts` copy assertion | ✅ pattern exists |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched Sidebar/guard test> --no-file-parallelism`
- **Per wave merge:** `npm run test` + supabase SQL test job
- **Phase gate:** full suite green + coverage thresholds (lines 82/stmts 80/fns 74/branches 72) + empty-set SQL assertion green in CI before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/auth/requireRolePage.ts` + `requireRolePage.test.ts` — covers ROLE-04 (three branches: DB-error no-redirect, missing-profile no-redirect, wrong-role redirect; enumerate the role×is_admin matrix)
- [ ] `supabase/tests/test_staff_role_both_backfill.sql` — covers ROLE-05 (empty-set)
- [ ] Update `Sidebar.test.tsx` (lines 173, 445-446) + `MobileNav.test.tsx` (line 12) — flip the admin-sees-all assertions to role-only (ROLE-01/02/03)
- [ ] Redirect-loop integration/e2e over the role×is_admin matrix (incl. the `/discovery/*` manager hop, Open Question 1)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | `getUser()` in page bodies, `proxy.ts` session gate |
| V3 Session Management | no | existing |
| V4 Access Control | **yes** | Server-side role guard (RSC `redirect()`); defense-in-depth = nav-hide + page-guard + existing RLS + `withAllocatorAuth`. Guard keys on `role`, deny-by-default on unknown role (mirror `approval.ts` default→false). |
| V5 Input Validation | no new inputs | — |
| V6 Cryptography | no | — |

### Known Threat Patterns for Next.js RSC role gating
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct-URL access to unowned surface (info disclosure — the "half-broken empty-payload" surface) | Information Disclosure | Server-side `redirect()` page guard (ROLE-04) — the core deliverable |
| Fail-open via swallowed `redirect()` in try/catch | Elevation of Privilege | Call `redirect()` outside try/catch (Pitfall 2) |
| Infra error mis-read as authz denial → deny valid owner (or, if inverted, grant) | Denial of Service / EoP | Three-branch model: DB error → throw (503-equiv), never redirect/allow |
| Staff lockout on OR-in drop | Denial of Service | Atomic `role='both'` backfill + empty-set SQL gate (ROLE-05) |
| `is_admin` treated as marketplace grant | Elevation of Privilege | Guard branches on `role` only; `is_admin` gates only `/admin` (ROLE-03) |
| Unknown/malformed role bypasses guard | Elevation of Privilege | Deny-by-default (owns=false) on any role outside {allocator, manager, both}, matching `approval.ts` |

## Sources

### Primary (HIGH confidence)
- `src/lib/api/withAllocatorAuth.ts` — three-branch gate to mirror (branch semantics, Sentry tags, copy)
- `src/components/layout/Sidebar.tsx` — the two OR-in sites (49-51, 198-199); Admin gating; MobileNav delegation
- `src/components/layout/MobileNav.tsx` — confirms no independent OR-in
- `src/app/(dashboard)/layout.tsx` — SSR flag derivation source of truth (44-46)
- `src/app/(dashboard)/discovery/layout.tsx` — route-group layout gate precedent (force-dynamic, fail-closed)
- `src/lib/auth.ts` — the OTHER role system (`user_app_roles`/`requireRole`); documents why NOT to use it here
- `src/lib/approval.ts` — deny-by-default role switch pattern
- `src/proxy.ts` — Next 16 middleware; deliberately no role/admin enforcement (146-160)
- `supabase/migrations/20260521150000_universal_signup_approval_gate.sql` + `20260520222848_lock_profile_role_at_signup.sql` — backfill + role-trigger precedent
- `supabase/tests/test_handle_new_user_role_allowlist.sql`, `test_profiles_privileged_columns_locked.sql` — pgTAP convention + test-DB lag discipline
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` — `redirect()` API (307, throws NEXT_REDIRECT, outside try/catch) `[CITED]`

### Secondary (MEDIUM confidence)
- STATE.md / CONTEXT.md / REQUIREMENTS.md — phase scope, GATE, non-goals

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all in-repo, verified.
- Architecture (guard + nav): HIGH — mirrors two verified in-repo patterns; Next 16 `redirect()` verified against bundled docs.
- Pitfalls: HIGH — each grounded in a specific in-repo source line or the Next docs.
- Redirect matrix: HIGH — enumerated and loop-checked; home targets are the one Claude's-Discretion item (A1, low risk).
- Backfill/migration: MEDIUM on the trigger-interference question (A2) — resolved by the mandatory test-project MCP apply.

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (stable; in-repo patterns unlikely to shift within the milestone)
