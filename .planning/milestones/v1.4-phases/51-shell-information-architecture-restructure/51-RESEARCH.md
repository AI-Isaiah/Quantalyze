# Phase 51: Shell + Information-Architecture Restructure - Research

**Researched:** 2026-06-29
**Domain:** Next.js 16 App Router routing/IA — route groups, redirects, role-scoped nav, breadcrumbs, by-construction route-contract CI guard
**Confidence:** HIGH (the routing facts are all verified against the local Next-16 docs + the live source tree; the IA/orphan decisions are grounded in actual route inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Route-move policy — Selective moves + redirects (user-accepted).** Phase 51 MAY move/consolidate a few routes. HARD CONSTRAINTS on every move (no exceptions): (a) a redirect (301/308) from old→new so existing deep/share links resolve; (b) the `proxy.ts` `PUBLIC_ROUTES` allowlist + the redirect map updated in the SAME change; (c) an authed (or public) canary proving the old link resolves to real content, not a 307→login (the #512 class). A move missing any of the three is a defect. **Which routes move is Claude's discretion**, grounded in the route-contract inventory (a HARD PREDECESSOR). Bias toward FEW, high-value consolidations. NEVER move engine-adjacent or share-token routes (`/scenario-share/[token]`, `/factsheet/[id]`, `/strategy/[id]`, `/portfolio-pdf/[id]`). Surface the proposed move list in the plan for review before executing.

**Marketing shared shell — All public marketing routes (user-accepted).** A `(marketing)` Next route group (parens → **no URL change**) wraps the public marketing/info routes — landing (`/`) + `/legal` + `/for-quants` + `/security` + `/demo` — in ONE shared public shell. SEO must NOT regress (metadata/sitemap/robots preserved); each wrapped route MUST still resolve at its current URL and stay in `PUBLIC_ROUTES`.

**Route-contract enforcement — By-construction CI guard (user-accepted).** A by-construction guard (a test or `eslint-plugin-quantalyze` rule, matching the `contracts-registry` ethos) FAILS CI when a route is added/moved without a matching `PUBLIC_ROUTES` (or explicit private) classification AND a redirect-map entry where applicable. Permanently closes the #512 (307→login) drift class. Registered in the contracts registry.

### Claude's Discretion

- **Role-scoped nav** is already implemented in `Sidebar.buildNavSections` (allocator/manager/admin/both OR-logic, T-45-01 info-disclosure mitigation) — bring it to COMPLETENESS (audit orphan/dead-end surfaces: `/scenarios`, `/preferences`, `/referral`, `/recommendations`, `/security`, `/compare`, `/decks`). Do NOT regress the role OR-logic security property.
- **Breadcrumbs** build on the existing `Breadcrumb.tsx` + `PageHeader`; app-wide on dashboard surfaces with a consistent back-path convention. Active/hover/focus states use Phase-50 primitive tokens.
- Exact nav grouping, breadcrumb hierarchy/depth, the redirect mechanism (proxy.ts vs `next.config`/route-level), and the guard's implementation are at Claude's discretion within the above + ROADMAP success criteria.

### Deferred Ideas (OUT OF SCOPE)

- Command palette (⌘K) global search/navigate (NAV-F1) — needs an RLS-scoped strategy-search backend spike; a later milestone.
- Per-surface fluid-type/no-clip realization (TYPE-02/03/04) — phase 52.
- Broad route reorganization beyond the few high-value selective moves — keep moves few and reversible.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | Route/menu hierarchy restructured with role-scoped nav so each role finds any surface quickly ("where am I / how do I get back" always answered) | Orphan-surface audit (below) — 4 of 7 candidates are NOT orphans (2 are redirect-stubs, `/security` is public, `/recommendations` reachable via mandate-CTA). Completeness = add nav entries for the genuine orphans + a breadcrumb back-path everywhere. `buildNavSections`/`buildPrimaryMobileNav` are the SoT to complete (not rebuild). |
| NAV-02 | Breadcrumbs, consistent active/hover/focus states, consistent back-paths app-wide | `Breadcrumb.tsx` exists (manual `items` prop, used by 6 surfaces today). Segment-derivation approach + the 3 a11y gaps (focus-visible + aria-current on both nav and breadcrumb) + back-path convention all specified below. |
| NAV-03 | Route-contract inventory + `PUBLIC_ROUTES` + redirect-map in lockstep — share/deep links never break | Full inventory table below (57 page routes + 86 api routes). The by-construction guard mirrors the proven `check-admin-route-manifest.ts` pattern (filesystem walk + manifest cross-check + `npm run lint` + contracts-registry registration). |
| NAV-04 | Shared shells (`(marketing)` route group) without changing public URLs or regressing SEO | Route-group mechanics verified against local Next-16 docs (folder-only, zero URL change). Per-route `metadata` exports stay on the pages; the shared layout owns chrome only. Landmark/single-`<h1>` discipline specified. |
</phase_requirements>

---

## Summary

This is a **routing/IA phase**, not a feature phase — the entire risk surface is "does every existing link still resolve, and is the auth-gating classification still correct?" The codebase is already well-instrumented for this: `proxy.ts` has a flat `PUBLIC_ROUTES` allowlist with a battle-tested matcher (`path === route || path.startsWith(route + "/")`), `proxy.test.ts` already pins anon-vs-authed gating for every public route, and there is a **proven precedent for the route-contract guard** in `scripts/check-admin-route-manifest.ts` (a filesystem-walk-vs-manifest CI gate wired into `npm run lint` and registered in `contracts-registry.test.ts`). The phase's durable win — the by-construction guard — should be built as a near-clone of that script, not invented from scratch. `[VERIFIED: codebase grep + Read]`

The route inventory reveals two findings that materially shape the plan. First, **two of the seven "orphan candidates" are already redirect stubs**: `/scenarios` 307-redirects to `/allocations?tab=scenario` and `/preferences` 307-redirects to `/profile?tab=mandate` — they are not orphans, they are legacy in-app redirects that already work. `/security` is a *public marketing* route (not a dashboard surface), and `/recommendations` is reachable via a mandate CTA. So the genuine nav-completeness gap is narrow: `/compare`, `/decks`, `/referral`, `/recommendations` are allocator-owned dashboard surfaces with NO nav entry today. `[VERIFIED: Read of each page.tsx]` Second, **the redirect mechanism choice is clear**: `next.config.ts` already uses `async rewrites()` and `async headers()` but has **no** `async redirects()` yet — adding a `redirects()` block is the clean, Next-16-native, SEO-correct mechanism for any selective move, and it runs *before* the proxy so a moved old-path never even reaches the auth gate. `[VERIFIED: Read next.config.ts + local redirects doc]`

The `(marketing)` group (NAV-04) is the highest-care item: `/legal`, `/demo`, `/for-quants`, and `/browse` each already have **their own distinct `layout.tsx`** with hand-rolled headers (different max-widths, different copy, a demo banner). Consolidating landing + `/legal` + `/for-quants` + `/security` + `/demo` under one `(marketing)/layout.tsx` is a folder MOVE that must preserve each page's own `metadata` export and single `<h1>`/`<main>` — the exact landmark-duplication class axe caught on `/allocations` (JOURNEY-03). The route group is folder-only and changes **zero URLs** (verified against the local Next-16 route-groups doc). `[VERIFIED: Read of all 4 marketing layouts + route-groups.md]`

**Primary recommendation:** Produce the route-contract inventory + the by-construction guard FIRST (clone `check-admin-route-manifest.ts`), then do at most 2-3 selective moves via `next.config.ts` `redirects()` (308 permanent) each with a `proxy.ts` + manifest + canary triple, then introduce `(marketing)` as a folder move preserving per-page metadata, then complete the nav (add ~4 missing allocator entries) + ship the breadcrumb/focus-visible/aria-current a11y additions additively. Sequence the guard before the moves so the guard *proves* each move's lockstep.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth/redirect gating (public vs private) | Frontend Server (proxy.ts) | — | `proxy.ts` runs on every request before render; `PUBLIC_ROUTES` is the gating SoT. Page-level `getUser()` is the authoritative backstop (defense-in-depth). |
| Old→new route redirects (selective moves) | Frontend Server (`next.config.ts` redirects) | — | `redirects()` runs *before* proxy and before the filesystem — the SEO-correct, search-engine-cacheable layer for permanent URL changes. Proxy-level `NextResponse.redirect` is for *conditional* (auth) redirects only. |
| Route-contract enforcement (the guard) | Build/CI (Node script) | — | Filesystem walk + manifest cross-check at lint time. Pure static analysis; mirrors `check-admin-route-manifest.ts`. No runtime tier. |
| Marketing shared shell (header/footer chrome) | Frontend Server (`(marketing)/layout.tsx`) | — | Server-rendered layout (no auth gate, no client boundary) so `<h1>`/metadata are never deferred. |
| Role-scoped nav (which role sees which section) | Browser/Client (`Sidebar` `"use client"`) | Frontend Server (role props from `(dashboard)/layout.tsx`) | Role booleans (`isAdmin`/`isAllocator`/`isManager`) are computed server-side in the layout from `getUser()` + `profiles`, then passed as props; the OR-logic + `usePathname()` active-state live client-side. The server is the role-truth source — the client never decides roles. |
| Breadcrumb derivation | Browser/Client (`usePathname()`) | — | Breadcrumbs derive from the pathname + static route metadata; no fetch, SSR-safe (no `useSearchParams` CSR-bailout). |
| Per-page metadata/SEO | Frontend Server (page `metadata` export) | — | Each page keeps its own `metadata`/`generateMetadata`; the marketing layout MUST NOT hoist or suppress them. |

---

## Route-Contract Inventory (NAV-03 — the hard predecessor)

> This is the basis for every selective move and the manifest the guard cross-checks. Classification cross-checked against `proxy.ts` `PUBLIC_ROUTES` (line 7) and the `isAuthBounceExempt` set (proxy.ts lines 87-111). `[VERIFIED: Read proxy.ts + find of every page.tsx/route.ts]`

**Legend:**
- **Class:** PUBLIC (anon-reachable, in `PUBLIC_ROUTES`) · PRIVATE (auth-gated, falls through proxy to page-level `getUser()`) · ADMIN (auth + admin-gated)
- **Bounce-exempt:** authed user STAYS on the page (in `isAuthBounceExempt`) vs bounces to dashboard
- **Share-token / in-the-wild:** link exists outside the app — **NEVER MOVE** (CONTEXT lock)
- **Redirect-stub:** the page itself is already a `redirect()` to a canonical target

### Public page routes (in PUBLIC_ROUTES)

| Route | Class | proxy.ts status | Share-token? | Notes / proposed action |
|-------|-------|-----------------|-------------|------------------------|
| `/` (landing) | PUBLIC | `path === "/"` special-case (line 54) | no | authed users `redirect("/discovery/crypto-sma")` *in the page* (line 41). → `(marketing)` group, keep redirect in page not layout |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | PUBLIC | `/login`,`/signup` in list; NOT bounce-exempt (correct — authed bounces away) | no | `(auth)` group — leave as-is |
| `/legal`, `/legal/privacy`, `/legal/terms`, `/legal/disclaimer` | PUBLIC | `/legal` in list + bounce-exempt | **YES** (footer links in the wild) | → `(marketing)` group. Has own `layout.tsx` today |
| `/for-quants` | PUBLIC | `/for-quants` in list + bounce-exempt | no | → `(marketing)`. Has own `layout.tsx` |
| `/security` | PUBLIC | `/security` in list + bounce-exempt | **YES** (security.txt / SOC2 packet point here) | → `(marketing)`. Hand-rolled header in page |
| `/demo`, `/demo/founder-view` | PUBLIC | `/demo` in list + bounce-exempt | **YES** (Telegram links in incognito) | → `(marketing)`. Has own `layout.tsx` + demo banner + `/demo/:path*` cache headers in next.config |
| `/browse`, `/browse/[slug]`, `/browse/[slug]/[strategyId]` | PUBLIC | `/browse` in list + bounce-exempt | **YES** (SEO marketing surface) | Has own `layout.tsx`. NOT in CONTEXT's `(marketing)` set — leave OUT (it is the un-gated SEO mirror of `/discovery`, kept separate by design) |
| `/factsheet/[id]`, `/factsheet/[id]/tearsheet`, `/factsheet/[id]/v2` | PUBLIC | `/factsheet` in list + bounce-exempt | **YES — NEVER MOVE** | share-token / in-the-wild |
| `/strategy/[id]`, `/strategy/[id]/v2` | PUBLIC | `/strategy` in list + bounce-exempt | **YES — NEVER MOVE** | in-the-wild deep link |
| `/scenario-share/[token]` | PUBLIC | `/scenario-share` in list + bounce-exempt | **YES — NEVER MOVE** | the #512 route — recipient links in the wild |
| `/portfolio-pdf/[id]` | PUBLIC | `/portfolio-pdf` in list + bounce-exempt | **YES — NEVER MOVE** | PDF deep link |

### Private (dashboard) page routes — auth-gated, role-scoped

| Route | Class | Role owner | In nav today? | Notes / proposed action |
|-------|-------|-----------|---------------|------------------------|
| `/allocations` | PRIVATE | allocator/admin | ✅ "My Allocation" | nav SoT |
| `/discovery/[slug]`, `/discovery/[slug]/[strategyId]` | PRIVATE | allocator/admin | ✅ DISCOVERY sub-groups | bare `/discovery` 404s (no page.tsx — only `layout.tsx`+`[slug]`); nav MUST target a concrete slug (`/discovery/crypto-sma`) |
| `/strategies`, `/strategies/[id]/edit`, `/strategies/new`, `/strategies/new/wizard` | PRIVATE | manager/admin | ✅ "Strategies" | leaf surfaces use Breadcrumb already |
| `/portfolios`, `/portfolios/[id]`, `/portfolios/[id]/manage`, `/portfolios/[id]/documents` | PRIVATE | manager/admin | ✅ "Portfolios" | deep leaves need back-path |
| `/profile` | PRIVATE | all | ✅ "Profile" (ACCOUNT) | hosts `?tab=mandate` (preferences) + other tabs |
| `/compare` | PRIVATE | allocator | ❌ **GENUINE ORPHAN** | uses Breadcrumb; reachable only by direct link today → add nav entry OR confirm parent-reachable |
| `/decks` | PRIVATE | allocator | ❌ **GENUINE ORPHAN** | no nav entry; direct-link only → resolve |
| `/referral` | PRIVATE | allocator/manager | ❌ **GENUINE ORPHAN** | "Earn rewards by referring…" → likely an ACCOUNT nav entry |
| `/recommendations` | PRIVATE | allocator | ❌ **soft-orphan** | reachable via `/preferences`→mandate CTA per page docstring; decide nav entry vs parent-reachable |
| `/scenarios` | PRIVATE | allocator | n/a — **REDIRECT-STUB** | already `redirect("/allocations?tab=scenario")` (307). NOT an orphan. Candidate to retire-or-keep (see moves) |
| `/preferences` | PRIVATE | allocator | n/a — **REDIRECT-STUB** | already `redirect("/profile?tab=mandate")` (307, preserves query). NOT an orphan |
| `/onboarding`, `/pending-approval` | PRIVATE (`(auth)` group) | all | n/a (flow) | gate flow — not nav surfaces |

### Admin page routes — auth + admin-gated

| Route | Class | In nav today? | Notes |
|-------|-------|---------------|-------|
| `/admin` | ADMIN | ✅ "Dashboard" | |
| `/admin/users`, `/admin/users/[id]` | ADMIN | ✅ "Users" (parent) | `[id]` reachable via list → back-path |
| `/admin/deletion-requests` | ADMIN | ✅ | |
| `/admin/match`, `/admin/match/[allocator_id]`, `/admin/match/eval` | ADMIN | ✅ "Match queue" | `[allocator_id]` is the full-bleed route (DashboardChrome line 61) |
| `/admin/for-quants-leads` | ADMIN | ✅ | |
| `/admin/compute-jobs`, `/admin/csv-status`, `/admin/intros`, `/admin/partner-import`, `/admin/partner-pilot/[partner_tag]`, `/admin/partner-roi`, `/admin/usage` | ADMIN | ❌ NOT in nav | admin secondary surfaces — reachable via `/admin` dashboard links (acceptable: parent + back-path, NOT a top-level nav orphan per UI-SPEC §completeness) |

### API routes (86) — classification summary

| Group | Class | proxy.ts status | Notes |
|-------|-------|-----------------|-------|
| `/api/cron/*` (8) | bypass | `startsWith("/api/cron/")` → `next()` (proxy.ts line 19) | self-authenticate via `Authorization: Bearer CRON_SECRET` |
| `/api/admin/*` (23) | ADMIN | not in PUBLIC_ROUTES → gated; each declared in `ADMIN_ROUTE_MANIFEST` (existing guard) | the `check-admin-route-manifest.ts` precedent already governs these |
| `/api/factsheet`, `/api/keys`, `/api/trades`, `/api/verify-strategy`, `/api/alert-digest`, `/api/benchmark/btc`, `/api/demo`, `/api/for-quants-lead` | PUBLIC | in PUBLIC_ROUTES (line 7) | self-gate internally (X-Service-Key / token) |
| `/api/health` | effectively public | not in list but unauthenticated probe | health endpoint |
| `/api/auth/callback` (`/auth/callback`) | flow | OAuth callback | |
| all other `/api/*` (~50) | PRIVATE | not in PUBLIC_ROUTES → session-gated | session cookie required |

**Inventory drift findings (cross-check PUBLIC_ROUTES vs page tree):**
- **No drift detected** — every PUBLIC_ROUTES prefix maps to a real route, and every share-token/marketing page route is covered. `[VERIFIED: manual cross-check]`
- `/api/health` is reachable unauthenticated but is NOT in PUBLIC_ROUTES (it returns before the session gate matters / is a GET probe) — the guard's manifest should classify it as an **explicit exception** so it doesn't read as drift.
- `/auth/callback` (note: `/auth/` not `/api/`) is the Supabase OAuth callback `route.ts` — classify as a flow exception in the manifest.

---

## Standard Stack

This phase introduces **no new runtime dependencies** — it is built entirely on Next.js 16.2.9 App Router primitives already in the repo + the existing `eslint-plugin-quantalyze` + `vitest` + Playwright e2e harness. `[VERIFIED: Read next.config.ts, package.json check scripts, contracts-registry.test.ts]`

### Core (already installed — versions verified)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.9 | App Router: route groups `(folder)`, `redirects()` config, layouts, `usePathname()` | the framework; route groups + config-redirects are the Next-16-native mechanisms `[VERIFIED: node_modules/next/package.json + local docs]` |
| `react` | 19.2.7 | client nav components, `useMemo`, native `inert` boolean prop | already powers the shell `[CITED: CLAUDE.md stack_facts]` |
| `vitest` | (repo) | contracts-registry test + proxy.test + guard unit test | the contracts-registry guard lives here `[VERIFIED: contracts-registry.test.ts]` |
| `tsx` | (repo) | runs `scripts/check-*.ts` CI gates via `npm run lint` | the route-contract guard runs the same way `[VERIFIED: package.json line 11]` |

### Supporting (existing project tooling)

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `eslint-plugin-quantalyze` (local) | AST lint rules wired at "error" in `eslint.config.mjs` | ONLY if the route-contract guard is best expressed as an AST rule (it is NOT — a filesystem-walk script is the right shape; see Don't-Hand-Roll) |
| `scripts/check-admin-route-manifest.ts` | **the template** for the route-contract guard | clone its structure: `findRouteFiles` walk + manifest cross-check + violation list + exit-code + pure `runCheck(rootDir, manifest)` testable entry point |
| Playwright e2e (`e2e/`) | redirect-resolves canary per moved route | every selective move needs a canary (CONTEXT hard constraint) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `next.config.ts` `redirects()` (308) for moves | proxy.ts `NextResponse.redirect` | proxy redirect is for *conditional* (auth) redirects; a static URL move belongs in `redirects()` which runs first, is SEO-cacheable, and keeps the proxy focused on auth. Use `redirects()` for moves. `[CITED: local redirecting.md table]` |
| `next.config.ts` `redirects()` | in-page `redirect()` (like `/scenarios` does today) | in-page `redirect()` requires the old `page.tsx` to KEEP existing as a stub (extra file, still hits proxy auth). `redirects()` deletes the old file cleanly and never reaches render. Prefer `redirects()` for genuine moves; in-page stub is fine for already-existing legacy stubs. `[VERIFIED: /scenarios/page.tsx pattern]` |
| route-contract guard as a vitest test | as a `check-*.ts` lint-gate script | a `check-*.ts` script (like `check-admin-route-manifest.ts`) runs in `npm run lint` AND is registered in the contracts registry, giving two enforcement points. A pure vitest test runs only in the test job. The proven pattern is the script + registry entry. `[VERIFIED: contracts-registry.test.ts lines 105-106]` |

**Installation:** none — no package installs this phase.

## Package Legitimacy Audit

**Not applicable.** Phase 51 installs **zero external packages** — it uses only Next.js 16.2.9 App Router primitives, React 19, and the existing repo tooling (vitest, tsx, eslint-plugin-quantalyze, Playwright). `[VERIFIED: Read of next.config.ts, package.json scripts, contracts-registry.test.ts — no new deps]` No slopcheck/registry verification required.

---

## Architecture Patterns

### System Architecture Diagram

```
                          INCOMING REQUEST (any URL)
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │  next.config.ts  async redirects()        │   ← NAV-01 moves land here (308 permanent)
              │  (runs BEFORE proxy + BEFORE filesystem)  │      old-path → new-path, never reaches auth
              └─────────────────────────────────────────┘
                                    │ (no redirect match)
                                    ▼
              ┌─────────────────────────────────────────┐
              │  proxy.ts  (auth gate)                     │   ← NAV-03 PUBLIC_ROUTES allowlist
              │  /api/cron/* → bypass                      │      the guard keeps this in lockstep
              │  isPublicRoute? ── no ─→ 307 /login        │      (the #512 class lives here)
              │       │ yes                                 │
              │  authed + public + !bounce-exempt → bounce │
              └─────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │  App Router filesystem resolution          │
              │                                            │
              │  src/app/(marketing)/   ← NAV-04 group     │   /, /legal, /for-quants, /security, /demo
              │     layout.tsx (shared header/footer)      │      folder-only — ZERO URL change
              │     each page keeps its OWN metadata + h1  │
              │                                            │
              │  src/app/(dashboard)/  ← role-scoped       │   DashboardChrome → Sidebar (role props
              │     layout.tsx → getUser() → role props    │      from server) → buildNavSections OR-logic
              │       └─ DashboardChrome (client)          │
              │            ├─ Sidebar (usePathname active) │   ← NAV-01 nav completeness
              │            ├─ PageHeader → Breadcrumb       │   ← NAV-02 breadcrumb + back-path
              │            └─ MobileNav (buildPrimaryMobileNav)
              │                                            │
              │  src/app/(auth)/       ← login/signup flow │
              └─────────────────────────────────────────┘
                                    │
                                    ▼
                          RENDERED PAGE  (single <main>, single <h1>)
                                    
   ──────────────────────────────────────────────────────────────────────
   CI / BUILD TIER (no runtime):
   scripts/check-route-contract.ts  ← NAV-03 GUARD (clone of check-admin-route-manifest.ts)
     walk src/app/**/page.tsx  →  cross-check ROUTE_CONTRACT_MANIFEST
       · every public-classified route ∈ PUBLIC_ROUTES (parsed from proxy.ts)
       · every moved route has a redirects() entry
       · every route classified (public | private | admin | exception)
     wired into `npm run lint` + registered in contracts-registry.test.ts
```

### Recommended Project Structure (the delta this phase introduces)

```
src/app/
├── (marketing)/              # NEW route group (parens → no URL change) — NAV-04
│   ├── layout.tsx            # shared header (hoisted from landing) + LegalFooter
│   ├── page.tsx              # landing (moved from src/app/page.tsx; keeps in-page authed redirect)
│   ├── for-quants/page.tsx   # moved; keeps its own metadata
│   ├── security/page.tsx     # moved; keeps its own metadata + single <h1>
│   ├── demo/                 # moved; demo banner + /demo/:path* cache headers UNCHANGED
│   │   ├── layout.tsx        # OPTIONAL nested layout if demo banner ≠ shared header
│   │   ├── page.tsx
│   │   └── founder-view/page.tsx
│   └── legal/                # moved; legal nav tabs as nested layout
│       ├── layout.tsx        # OPTIONAL nested layout for the legal tab-nav
│       ├── privacy/page.tsx
│       ├── terms/page.tsx
│       └── disclaimer/page.tsx
├── (dashboard)/              # unchanged group — nav completeness only
├── (auth)/                   # unchanged
├── browse/                   # stays UNGROUPED (CONTEXT excludes it from (marketing))
├── factsheet/ strategy/ scenario-share/ portfolio-pdf/   # NEVER MOVE (share-token)
└── api/                      # unchanged

src/lib/routing/              # NEW — NAV-03 manifest home (mirrors src/lib/auth/rbac-manifest.ts)
└── route-contract-manifest.ts   # ROUTE_CONTRACT_MANIFEST: route → {class, redirectFrom?}

scripts/
└── check-route-contract.ts   # NEW — clone of check-admin-route-manifest.ts (NAV-03 guard)

next.config.ts                # ADD async redirects() block for selective moves
src/proxy.ts                  # PUBLIC_ROUTES delta per move (lockstep)
src/__tests__/contracts/contracts-registry.test.ts  # register the new guard + REGISTRY.md row
```

### Pattern 1: Route group `(folder)` — folder-only, zero URL change (NAV-04)

**What:** Wrapping a folder name in parens organizes routes WITHOUT including the folder in the URL.
**When to use:** Sharing a layout across sibling public routes without changing any URL.
**Critical caveat:** Routes in different groups must not resolve to the same path; with multiple root layouts, navigating between them triggers a full page reload (not applicable here — `(marketing)` shares the existing root `app/layout.tsx`, it is NOT a second root layout).

```
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md
// app/(marketing)/security/page.tsx  →  resolves at  /security   (the "(marketing)" segment is NOT in the URL)
// app/(marketing)/page.tsx           →  resolves at  /
```

### Pattern 2: `next.config.ts` `redirects()` for selective moves (NAV-01)

**What:** Static, SEO-cacheable old→new redirect that runs before the proxy and before the filesystem.
**When to use:** A genuine route move where the old URL is in the wild (but NOT a share-token route).
**308 vs 301/307:** Next.js uses **308 (permanent)** when `permanent: true` and **307 (temporary)** when `permanent: false` — both preserve the request method (unlike legacy 301/302 which browsers may rewrite to GET). For a permanent IA move, use `permanent: true` → 308. CONTEXT says "301/308" — in Next-16 the permanent code IS 308 (method-preserving); that satisfies the "301-class permanent redirect" intent.

```ts
// Source: node_modules/next/dist/docs/01-app/02-guides/redirecting.md + redirects.md
// next.config.ts — ADD alongside the existing rewrites()/headers()
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/old-path", destination: "/new-path", permanent: true }, // → 308, query preserved
    ];
  },
  async rewrites() { /* existing — unchanged */ },
  async headers() { /* existing — unchanged */ },
};
```

### Pattern 3: Breadcrumb hierarchy derivation in App Router (NAV-02)

**What:** The existing `Breadcrumb.tsx` takes a manual `items` prop (6 surfaces pass items today). The phase brings breadcrumbs app-wide. Two viable derivation approaches:

- **(a) Keep the explicit `items` prop, render via `PageHeader`** (lowest-risk, recommended). Each surface already knows its own crumb chain; `PageHeader` gains an optional `breadcrumb?: BreadcrumbItem[]` prop. Leaf labels (strategy names, etc.) are already in scope on those pages. No `useSelectedLayoutSegments` needed, no CSR-bailout risk.
- **(b) Auto-derive from `usePathname()` segments** in a client wrapper. Possible (App Router exposes `useSelectedLayoutSegments()` and `usePathname()`), but segment→label mapping for dynamic segments (`[id]`, `[slug]`, `[token]`) requires a label registry and risks showing a raw UUID as a crumb. UI-SPEC §Hierarchy derivation explicitly says "collapse intermediate non-navigable segments" and "do NOT mirror every URL segment" — which favors **(a)** (curated chains) over naive segment-mirroring.

**Recommendation: (a)** — explicit curated `items`, single-sourced through `PageHeader`, with the root crumb pointing at the role's workspace landing (allocator→`/allocations`, manager→`/strategies`, admin→`/admin`). This matches UI-SPEC §Hierarchy derivation verbatim and avoids the dynamic-segment label problem.

```tsx
// Source: existing Breadcrumb.tsx + UI-SPEC contract. The 3 a11y gaps to close (additively):
// 1. linked crumbs:  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
// 2. current crumb:  add aria-current="page" to the leaf <span>
// 3. sidebar nav:    add the SAME focus-visible ring + aria-current (NavItemLink, Sidebar.tsx)
<span className="text-text-primary font-medium" aria-current="page">{leafLabel}</span>
```

### Pattern 4: Route-contract guard — clone `check-admin-route-manifest.ts` (NAV-03)

**What:** A `scripts/check-route-contract.ts` that walks `src/app/**/page.tsx`, parses `PUBLIC_ROUTES` out of `proxy.ts`, and cross-checks both against a `ROUTE_CONTRACT_MANIFEST`. Mirrors the proven admin-route guard exactly.

```ts
// Source: scripts/check-admin-route-manifest.ts (the template — same shape)
// 1. findRouteFiles(src/app) — recursive walk for page.tsx (admin guard walks route.ts)
// 2. derive each file's URL path: strip src/app, drop (group) segments, [seg]→:seg
// 3. parse PUBLIC_ROUTES from proxy.ts source (it's a single const array literal, line 7)
// 4. runCheck(rootDir, manifest) → string[] violations (pure, testable against a tmp tree)
//    Rule 1: every page route is classified in the manifest (public|private|admin|exception)
//    Rule 2: every manifest "public" route ∈ PUBLIC_ROUTES (the #512 lockstep) — else MISSING
//    Rule 3: every manifest "redirectFrom" has a matching next.config.ts redirects() entry
//    Rule 4: every manifest entry points at a real file (no STALE entries)
// 5. main() → exit(1) on violations; wire into npm run lint; register in contracts-registry
```

### Anti-Patterns to Avoid

- **Moving a route without the PUBLIC_ROUTES update (the #512 class):** a moved public route whose new path isn't in `PUBLIC_ROUTES` → anonymous recipient gets 307→login. The guard's Rule 2 makes this fail CI by construction.
- **Hoisting a page's `<h1>` or `metadata` into `(marketing)/layout.tsx`:** duplicates landmarks / loses per-page SEO. Layout owns chrome ONLY; pages keep their own `<main>`, single `<h1>`, and `metadata` export.
- **Introducing a client boundary in `(marketing)/layout.tsx`:** would defer `<h1>`/metadata and risk hydration shift. The marketing shell is server-rendered (UI-SPEC §SEO).
- **Naive breadcrumb segment-mirroring on dynamic routes:** shows raw `[id]`/UUID crumbs. Use curated `items`.
- **Using bare `focus:` instead of `focus-visible:` on nav/breadcrumb links:** paints a ring on mouse click. UI-SPEC: nav/links use `focus-visible:`, only field controls keep `focus:`.
- **Nav-linking bare `/discovery`:** it 404s (no page.tsx). Always target a concrete slug (`/discovery/crypto-sma`).
- **Adding a top-level nav entry that duplicates an existing reachable path:** the mobile `buildPrimaryMobileNav` already proves the "distinct hrefs" discipline; keep it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Static old→new URL move | Custom proxy.ts branch / in-page redirect stub | `next.config.ts` `redirects({permanent:true})` | runs before proxy + filesystem, SEO-cacheable 308, query auto-preserved `[CITED: redirecting.md]` |
| Route-contract guard scaffolding | Brand-new AST/walk logic | clone `scripts/check-admin-route-manifest.ts` | proven `findRouteFiles`+`runCheck(rootDir,manifest)`+exit-code shape with a tested-against-tmp-tree design + comment/string stripping already hardened |
| Marketing shared header/footer | New header component per page | `(marketing)/layout.tsx` + existing `LegalFooter` | route group is the Next-native dedup; `LegalFooter` already on every page |
| Breadcrumb a11y (focus ring, aria-current) | New breadcrumb component | extend existing `Breadcrumb.tsx` additively | UI-SPEC: evolve not rebuild; the 3 gaps are 2-line additions |
| Role-scoped nav logic | New nav builder | complete `buildNavSections`/`buildPrimaryMobileNav` | T-45-01 OR-logic is the security SoT — adding items, not rebuilding |
| Active-route detection | `useSearchParams` (CSR-bailout) | existing `pathname === href || pathname.startsWith(href+"/")` | SSR-safe, no Suspense boundary needed (documented tradeoff in MobileNav) |
| Mobile drawer / focus-trap | Anything new | LOCKED v1.3 shell (TouchTooltip/useTapPin/mobile-drawer-keyboard e2e) | do not regress |

**Key insight:** Every capability this phase needs already exists in the codebase in a proven form — the work is *completing* and *guarding* existing patterns, not building new ones. The single highest-leverage reuse is cloning `check-admin-route-manifest.ts` for the route-contract guard: it already solves filesystem-walk, manifest-cross-check, comment/string-stripping bypass-hardening, a pure testable `runCheck` entry point, exit-codes, and `npm run lint` wiring.

## Runtime State Inventory

> This phase moves routes (rename class). The grep finds files; this finds what else references the old paths.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — routes are not stored as keys/IDs in any datastore. Share tokens (`scenario_shares`, factsheet IDs) reference DB rows, NOT URL *paths* — and those routes are NEVER moved. Verified: the moved candidates (landing/legal/for-quants/security/demo + any dashboard consolidation) have no path persisted in DB. | none |
| Live service config | **`next.config.ts` `/demo/:path*` cache headers** (lines 71-82, `Cache-Control` + `Vary: Cookie`) are keyed on the `/demo` path — if `/demo` moves into `(marketing)`, the URL is UNCHANGED (route group is folder-only) so the header source `/demo/:path*` still matches. Verify after the move. **`security.txt` rewrite** (`/security.txt`→`/.well-known/security.txt`) and the `/security` page point at each other (date-drift guard exists) — `/security` URL unchanged under `(marketing)`. | verify (no change expected — URLs are stable) |
| OS-registered state | **None** — no Task Scheduler / cron / pm2 registers a URL path. Vercel Cron pings `/api/cron/*` (NOT moved). | none |
| Secrets/env vars | **None** reference a moved route path. `NEXT_PUBLIC_PLATFORM_NAME` (used in legal/for-quants layouts) is a label, not a path. | none |
| Build artifacts | **`proxy.test.ts`** hardcodes public-route paths in its pin tables (lines 226-247) — if a public route MOVES, update the test's path list in the same change (it's a guard, that's intended). **e2e specs** referencing old paths must update. **In-code `<Link href>` / `redirect()` callers** of any moved path must update to the new canonical path (the redirect catches external links; in-app links should point at the new path directly). | grep `href="/oldpath"` + `redirect("/oldpath")` per move; update in lockstep |

**Critical:** Because the `(marketing)` group is **folder-only (zero URL change)**, NONE of the NAV-04 work triggers any runtime-state migration — only genuine NAV-01 *moves* (different old→new URL) do. Keep moves few precisely to keep this inventory near-empty.

## Common Pitfalls

### Pitfall 1: The #512 class — moved route missing from PUBLIC_ROUTES
**What goes wrong:** A public route moves to a new path; the new path isn't added to `PUBLIC_ROUTES`; anonymous recipients following the (redirected) link hit `proxy.ts` line 57 → 307→login instead of the page.
**Why it happens:** PUBLIC_ROUTES is a flat hand-maintained array; a move touches 3 places (file, proxy, redirect map) and one gets forgotten. This is exactly the #512 regression (`fix(proxy): make scenario-share recipient page reachable for anonymous recipients`).
**How to avoid:** The route-contract guard Rule 2 fails CI when a manifest-"public" route isn't in PUBLIC_ROUTES. Plus an anon e2e canary per moved public route asserting 200 (not 307).
**Warning signs:** `proxy.test.ts` red; canary returns 307 with `location: /login`.

### Pitfall 2: Metadata/SEO loss under the `(marketing)` group
**What goes wrong:** Consolidating headers into `(marketing)/layout.tsx`, a dev moves the page's `metadata` export or `<h1>` into the layout → every wrapped route shares one title, or duplicate/zero `<h1>`.
**Why it happens:** The instinct to "share everything" in a shared layout. But metadata is per-page; `metadata` in a layout is a *default*, not a replacement.
**How to avoid:** Layout owns header/footer ONLY. Each page keeps its `export const metadata`/`generateMetadata`, its single `<main>`, its single `<h1>`. `/for-quants`, `/security`, `/legal`, `/demo` each have their own metadata today (verified) — preserve verbatim.
**Warning signs:** axe `region`/duplicate-landmark finding (the JOURNEY-03 class on `/allocations`); identical `<title>` across marketing pages; Lighthouse SEO regression.

### Pitfall 3: `(marketing)` consolidation collides with existing per-route layouts
**What goes wrong:** `/legal`, `/demo`, `/for-quants` each ALREADY have a `layout.tsx` with distinct chrome (legal tab-nav, demo banner + copy, different max-widths). Naively replacing all with one shared header drops the demo banner / legal tabs.
**Why it happens:** Those layouts aren't visible from the top of the tree.
**How to avoid:** The shared `(marketing)/layout.tsx` provides the COMMON header/footer; route-specific chrome (legal tab-nav, demo banner) stays in a NESTED layout (`(marketing)/legal/layout.tsx`, `(marketing)/demo/layout.tsx`). Nested layouts compose under the group layout. Preserve the `/demo` cache headers (next.config) since the URL is unchanged.
**Warning signs:** demo banner gone; legal tab-nav gone; `/demo` losing its `Vary: Cookie` cache behavior.

### Pitfall 4: Breadcrumb on dynamic segments shows a raw UUID/token
**What goes wrong:** Auto-derived breadcrumbs render `[id]`/`[token]`/`[slug]` literally or as a UUID.
**Why it happens:** Segment-mirroring derivation without a label registry.
**How to avoid:** Use curated `items` (Pattern 3a); collapse non-navigable segments; never crumb a share-token. Truncate long leaf labels with `title={full}` recovery (UI-SPEC §Truncation), never the leaf so aggressively the page identity is unreadable.
**Warning signs:** a crumb reading `a1b2c3d4-...`; horizontal scroll at 320px.

### Pitfall 5: Regressing the role OR-logic (T-45-01 security property)
**What goes wrong:** While "completing" nav, a refactor changes `showsAllocatorWorkspace = isAllocator || isAdmin` semantics, leaking a manager/admin-only destination to the wrong role.
**Why it happens:** Touching `buildNavSections` to add orphan entries.
**How to avoid:** ADD items inside the EXISTING role-gated sections; never alter the `||` derivations. `buildNavSections` and `buildPrimaryMobileNav` must keep identical OR-logic (they already document this). Any new orphan entry is placed inside the correct role's section.
**Warning signs:** a `both`/manager user seeing an allocator-only entry; the existing role tests red.

### Pitfall 6: Treating redirect-stubs as orphans
**What goes wrong:** `/scenarios` and `/preferences` are flagged as "orphans" and given nav entries → but they are already `redirect()` stubs to `/allocations?tab=scenario` and `/profile?tab=mandate`. Adding nav entries that 307-bounce is confusing.
**Why it happens:** The orphan-candidate list in CONTEXT was a starting hypothesis; the inventory disproves 2 of 7.
**How to avoid:** Per the inventory: `/scenarios`,`/preferences` = redirect-stubs (leave or retire-with-redirects() — your discretion); `/security` = public marketing (reachable via marketing nav); `/recommendations` = soft-orphan (mandate-CTA reachable). The GENUINE nav gaps are `/compare`, `/decks`, `/referral`, `/recommendations`.
**Warning signs:** a nav item that immediately 307-redirects on click.

## Code Examples

### Adding `redirects()` to the existing next.config.ts (a selective move)
```ts
// Source: node_modules/next/dist/docs/01-app/02-guides/redirecting.md (App Router, Next 16.2.9)
// The config already has rewrites() + headers() — add redirects() as a sibling async fn.
const nextConfig: NextConfig = {
  async redirects() {
    return [
      // permanent:true → 308 (method-preserving permanent). Query string auto-preserved.
      { source: "/old-route", destination: "/new-route", permanent: true },
    ];
  },
  async rewrites() { return [/* existing security.txt rewrite — unchanged */]; },
  async headers()  { return [/* existing CSP + /demo cache headers — unchanged */]; },
};
```

### Parsing PUBLIC_ROUTES from proxy.ts for the guard
```ts
// Source: pattern from scripts/check-admin-route-manifest.ts (stripComments + regex)
// PUBLIC_ROUTES is a single const array literal on proxy.ts line 7. Read the file,
// strip comments (reuse the hardened stripComments tokenizer), match the array,
// and compare against manifest "public" entries. A "public" manifest route absent
// from PUBLIC_ROUTES → MISSING violation (the #512 lockstep).
const src = stripComments(readFileSync("src/proxy.ts", "utf8"));
const m = src.match(/const PUBLIC_ROUTES\s*=\s*\[([^\]]*)\]/);
const publicRoutes = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
```

### Sidebar focus-visible + aria-current (the 3 a11y gaps, additive)
```tsx
// Source: UI-SPEC §Item state contract + existing Sidebar.tsx NavItemLink.
// Add to the existing <Link> className (currently has NO focus-visible affordance)
// and add aria-current. Keyboard-only ring via focus-visible (never bare focus:).
<Link
  href={item.href}
  aria-current={active ? "page" : undefined}
  className={`... transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active ? "bg-sidebar-active text-sidebar-text-active" : "hover:bg-sidebar-hover hover:text-sidebar-text-active"
  }`}
>
```

## State of the Art

| Old Approach | Current Approach (Next 16.2.9) | When Changed | Impact |
|--------------|--------------------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` (rename) | Next 16 | this repo already uses `proxy.ts` — no migration needed `[VERIFIED: src/proxy.ts]` |
| 301/302 redirects (browser may rewrite method to GET) | 307 (temp) / 308 (permanent) — method-preserving | Next 13+ | use `permanent:true`→308 for moves; "301-class" intent satisfied `[CITED: redirects.md "Why 307/308"]` |
| Pages Router `next/router` | App Router `next/navigation` (`usePathname`, `redirect`, `permanentRedirect`) | Next 13+ | already used throughout the shell |
| Hand-rolled per-page marketing headers | shared `(marketing)/layout.tsx` route group | this phase | the NAV-04 consolidation win |

**Deprecated/outdated:**
- `middleware` filename → `proxy` (already adopted here). Any training-data reference to `middleware.ts` is stale for THIS repo.
- Don't reach for `next.config` `i18n`/`basePath` redirect features — not used here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/compare`, `/decks`, `/referral`, `/recommendations` are the genuine nav orphans (no top-level nav entry today). | Inventory / NAV-01 | LOW — verified each has no Sidebar `href` and inspected its page; if a surface is intentionally reachable only via a parent control + breadcrumb, that's acceptable per UI-SPEC (the planner picks per-surface). |
| A2 | Browse SHOULD stay OUT of `(marketing)` (it's the un-gated SEO mirror of discovery, kept separate by design). | NAV-04 | LOW — CONTEXT's `(marketing)` set explicitly lists landing+legal+for-quants+security+demo and excludes browse; discovery/layout.tsx docstring confirms browse is the separate un-gated SEO surface. |
| A3 | The `/demo` `Cache-Control`/`Vary:Cookie` headers (next.config `/demo/:path*`) still match after the `(marketing)` move because the URL is unchanged. | Runtime State | LOW — route groups are folder-only; verify with a header check post-move. |
| A4 | The selective moves (NAV-01) should be ≤2-3 and the planner surfaces the list for review before executing. | Moves | LOW — CONTEXT mandates "FEW" + "surface for review"; the inventory shows few genuinely-valuable consolidation candidates (e.g. retiring the `/scenarios`,`/preferences` page-stubs into `redirects()`), so a near-empty move list is acceptable and SAFEST. |
| A5 | Breadcrumb approach (a) curated `items` via PageHeader beats (b) auto-segment-derivation. | NAV-02 | LOW — UI-SPEC §Hierarchy derivation explicitly says collapse non-navigable segments + don't mirror every URL segment, which curated items satisfies directly. |

**If you confirm A4 as "zero moves this phase":** that is a *valid and safe* outcome — NAV-01 is satisfiable by nav-completeness + breadcrumbs alone, and NAV-03's guard + inventory stand on their own. The moves are an *option*, not a requirement.

## Open Questions (RESOLVED)

1. **How many selective moves (if any)?**
   - What we know: CONTEXT mandates FEW + reversible + share-token-excluded + surface-for-review. The two existing redirect-stubs (`/scenarios`,`/preferences`) are the most natural consolidation candidates (move them from in-page `redirect()` stubs to `next.config` `redirects()` and delete the stub files), and that's a near-zero-risk move because the targets already work.
   - What's unclear: whether the planner/user wants ANY net-new move beyond formalizing the existing stubs.
   - Recommendation: propose the move list in the plan (likely: formalize the 2 existing stubs into `redirects()`, possibly 0 net-new moves). Bias to fewest.
   - **RESOLVED (51-05):** exactly 1 net-new move — `/scenarios` → `/allocations?tab=scenario` formalized as a `next.config` `redirects()` 308 (stub file deleted, manifest `redirectFrom`, guard Rule 3 green). `/preferences` is NOT moved this phase (left as-is). Zero PUBLIC_ROUTES delta.

2. **Demo banner vs shared marketing header — nested layout or merge?**
   - What we know: `/demo` has a distinct banner ("Live demo — simulated data") + `Vary:Cookie` cache; `/legal` has a tab-nav. These differ from the landing header.
   - What's unclear: whether to keep them as nested layouts under `(marketing)` or merge the demo banner into the shared header conditionally.
   - Recommendation: nested layouts (`(marketing)/demo/layout.tsx`, `(marketing)/legal/layout.tsx`) — composes cleanly, preserves distinct chrome, zero conditional logic in the shared header.
   - **RESOLVED (51-04):** nested layouts under `(marketing)` for `/demo` and `/legal` (each keeps its own metadata/`<h1>`/`<main>` + distinct chrome); zero URL change, `/browse` excluded per CONTEXT.

## Environment Availability

> Phase is code/config-only (route files, next.config, proxy.ts, a CI script). The only external dependency is the test/CI harness, which already exists.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `next` | route groups, redirects(), layouts | ✓ | 16.2.9 | — |
| `tsx` | `check-route-contract.ts` CI gate | ✓ | (repo `npm run lint` uses it) | — |
| `vitest` | contracts-registry + guard unit test | ✓ | (repo) | — |
| Playwright + e2e harness | redirect-resolves canary | ✓ | (repo `e2e/`) | — for authed canary, the passwordless SSR-prop recipe exists (MEMORY) |
| `eslint-plugin-quantalyze` | (only if guard is an AST rule — it is NOT) | ✓ | local | n/a |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — everything needed is in-repo.

## Validation Architecture

> Seeds the Nyquist VALIDATION.md. `workflow.nyquist_validation` is `true` in config.json — section REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit/contract) + Playwright (`e2e/`, canaries) |
| Config file | `vitest.config.ts` (coverage gate 82/80/74/72) + `playwright.config.ts` |
| Quick run command | `npx vitest run src/proxy.test.ts src/__tests__/contracts/contracts-registry.test.ts` |
| Full suite command | `npm run test` then `npm run lint` (lint runs the route-contract CI gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-03 | route-contract guard fails CI on an unclassified/missing-from-PUBLIC_ROUTES route | unit (guard) | `npx vitest run src/__tests__/check-route-contract.test.ts` | ❌ Wave 0 (clone `check-admin-route-manifest.test.ts`) |
| NAV-03 | guard is registered + wired (existence + plugin/CI integrity) | contract | `npx vitest run src/__tests__/contracts/contracts-registry.test.ts` | ✅ extend (add CONTRACT_GUARDS row) |
| NAV-03 | `npm run lint` runs the route-contract gate (exit 1 on drift) | CI gate | `npm run lint` | ✅ extend (append `tsx scripts/check-route-contract.ts`) |
| NAV-03 / #512 | every public route stays anon-reachable (no 307→login) | unit (proxy) | `npx vitest run src/proxy.test.ts` | ✅ extend pin tables on any move |
| NAV-01 (move) | each moved old-path 308→new and resolves to real content (anon) | e2e canary | `npx playwright test e2e/route-redirects.spec.ts` | ❌ Wave 0 (per move) |
| NAV-01 (move) | each moved old-path resolves for an AUTHED user (no #512 bounce) | manual-only / SSR-prop | passwordless authed-fetch recipe (MEMORY) — grep RSC flight for real content | n/a (manual canary post-deploy) |
| NAV-04 | `(marketing)` routes resolve at SAME URL + stay public (anon 200) | e2e | `npx playwright test e2e/marketing-shell.spec.ts` | ❌ Wave 0 |
| NAV-04 | each marketing page keeps single `<main>` + single `<h1>` + own metadata (no dup landmark) | e2e (axe) | extend the existing app-wide axe matrix (public rows) | ✅ extend axe spec |
| NAV-02 | breadcrumb leaf has `aria-current="page"`; linked crumbs have focus-visible ring | unit | `npx vitest run src/components/layout/Breadcrumb.test.tsx` | ✅ extend (assert aria-current + focus-visible class) |
| NAV-02 | sidebar active item has `aria-current="page"` + focus-visible ring; role OR-logic unchanged | unit | `npx vitest run src/components/layout/Sidebar.test.tsx` | ✅ extend (assert + pin OR-logic) |
| NAV-02 | mobile nav aria-current/focus-visible unchanged (no v1.3 regression) | unit/e2e | existing MobileNav test + mobile-drawer-keyboard e2e | ✅ no change (LOCKED) |
| NAV-01 | nav completeness — each genuine orphan reachable from its role's nav OR via parent+breadcrumb | unit | extend `Sidebar.test.tsx` (assert new entries appear for the owning role only) | ✅ extend |

### Sampling Rate
- **Per task commit:** `npx vitest run src/proxy.test.ts src/components/layout/*.test.tsx` + the guard test
- **Per wave merge:** `npm run test && npm run lint` (lint = the route-contract gate)
- **Phase gate:** full suite + `npm run lint` green; per-move anon e2e canary green; authed SSR-prop canary per moved route post-deploy (manual)

### Wave 0 Gaps
- [ ] `scripts/check-route-contract.ts` — clone of `check-admin-route-manifest.ts` (NAV-03 guard)
- [ ] `src/lib/routing/route-contract-manifest.ts` — `ROUTE_CONTRACT_MANIFEST` (the classification SoT)
- [ ] `src/__tests__/check-route-contract.test.ts` — drives `runCheck(tmpTree, manifest)` (clone `check-admin-route-manifest.test.ts`)
- [ ] `e2e/route-redirects.spec.ts` — per-move anon redirect-resolves canary (only if moves are taken)
- [ ] `e2e/marketing-shell.spec.ts` — `(marketing)` same-URL + public + single-landmark assertions
- [ ] Extend `contracts-registry.test.ts` CONTRACT_GUARDS + `REGISTRY.md` row + `eslint`/`npm run lint` wiring
- [ ] Extend `Breadcrumb.test.tsx` / `Sidebar.test.tsx` for the aria-current + focus-visible additions

## Security Domain

> `security_enforcement` not set to false → included. This phase touches the auth-gating boundary (`proxy.ts` PUBLIC_ROUTES) — security-relevant.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | route-contract guard = documented, enforced trust boundary (public vs private classification in lockstep) |
| V2 Authentication | indirect | proxy session gate unchanged; page-level `getUser()` remains authoritative (defense-in-depth) — do NOT weaken |
| V3 Session Management | no | no session/cookie logic changes |
| V4 Access Control | **yes** | (a) role OR-logic (T-45-01 info-disclosure) MUST NOT regress — a leaked nav entry discloses a surface's existence; (b) PUBLIC_ROUTES is an access-control allowlist — a wrong classification either over-exposes (private→public) or breaks (public→private 307); (c) admin routes stay admin-gated (existing `check-admin-route-manifest` guard) |
| V5 Input Validation | minimal | redirect `source`/`destination` are static config literals (no user input); the proxy's existing `redirect` param sanitizer (`/^\/[a-z]/`) is unchanged |
| V6 Cryptography | no | none |

### Known Threat Patterns for Next.js routing/proxy

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Over-exposure: a private route mis-classified public in PUBLIC_ROUTES | Information Disclosure / Elevation | guard Rule: a route is "public" ONLY if intentionally in the manifest AND PUBLIC_ROUTES; page-level `getUser()` is the backstop (a mis-classification still hits the page's own auth) |
| #512 regression: public route NOT in PUBLIC_ROUTES → 307→login | Denial of Service (broken share link) | guard Rule 2 (manifest-public ⊆ PUBLIC_ROUTES) + anon e2e canary |
| Nav info-disclosure: wrong role sees a surface's existence | Information Disclosure | preserve `buildNavSections` OR-logic (T-45-01); add orphan entries inside the correct role section only; role tests pin it |
| Open-redirect via `redirects()` destination | Tampering | destinations are static internal paths (no user input, no `:param` to an external host); never build a destination from request data |
| Substring-attack on route matching (`/demo` vs `/demonstration`) | Tampering | proxy's `path === route || startsWith(route + "/")` already prevents this (proxy.test.ts RT4 pins it) — unchanged |
| Admin route added without a gate | Elevation | existing `check-admin-route-manifest.ts` guard (untouched) + the new route-contract guard classifies it ADMIN |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md` — route-group folder-only / zero-URL-change semantics, caveats (conflicting paths, multiple root layouts)
- `node_modules/next/dist/docs/01-app/05-config/01-next-config-js/redirects.md` + `02-guides/redirecting.md` — `redirects()` API, 307/308 method-preserving, query preservation, redirects-run-before-proxy ordering
- `node_modules/next/package.json` — Next 16.2.9 confirmed
- `src/proxy.ts` — PUBLIC_ROUTES (line 7), the matcher, isAuthBounceExempt set, /api/cron bypass
- `src/proxy.test.ts` — existing anon/authed gating pins + RT4 substring guards
- `scripts/check-admin-route-manifest.ts` + `src/lib/auth/rbac-manifest.ts` — THE template for the route-contract guard (walk + manifest + runCheck + exit-code + lint wiring)
- `src/__tests__/contracts/contracts-registry.test.ts` + `REGISTRY.md` — guard registration ethos
- `src/components/layout/{Sidebar,DashboardChrome,MobileNav,PageHeader,Breadcrumb}.tsx` — the shell to evolve; role OR-logic; existing focus/aria gaps
- `src/app/{page,for-quants,security,demo,legal}` + their `layout.tsx` — current marketing chrome + per-page metadata
- Each orphan-candidate `page.tsx` (`/scenarios`,`/preferences`,`/compare`,`/decks`,`/referral`,`/recommendations`) — ownership + redirect-stub findings
- `next.config.ts` — existing rewrites()/headers(), no redirects() yet, /demo cache headers
- `.planning/phases/51-{CONTEXT,UI-SPEC}.md` — locked decisions + visual contract

### Secondary (MEDIUM confidence)
- `git log -- src/proxy.ts` — #512 provenance (`fix(proxy): make scenario-share recipient page reachable for anonymous recipients`)

### Tertiary (LOW confidence)
- none — every claim is grounded in the local docs or the live source tree.

## Metadata

**Confidence breakdown:**
- Route inventory: HIGH — enumerated from the filesystem + cross-checked against proxy.ts line-by-line; redirect-stub findings read directly from the page sources.
- Redirect mechanism: HIGH — verified against local Next-16 redirects docs + confirmed next.config.ts shape (rewrites/headers present, redirects absent).
- Route-group / `(marketing)`: HIGH — verified against local route-groups doc + read of all 4 existing marketing layouts (the per-route-layout collision is a real, inspected finding).
- Route-contract guard: HIGH — a near-exact proven precedent exists (`check-admin-route-manifest.ts`); the design is a clone, not an invention.
- Nav/breadcrumb a11y: HIGH — the 3 gaps and the OR-logic SoT are read directly from the source; the additions are 2-line and additive.

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable — local Next-16 docs + in-repo patterns; routing facts don't drift on a 30-day horizon)

---

## RESEARCH COMPLETE

**Phase:** 51 - shell-information-architecture-restructure
**Confidence:** HIGH

### Key Findings
- **Two "orphan candidates" are already redirect-stubs** (`/scenarios`→`/allocations?tab=scenario`, `/preferences`→`/profile?tab=mandate`); `/security` is a public marketing route; `/recommendations` is mandate-CTA-reachable. The GENUINE nav gaps are just `/compare`, `/decks`, `/referral`, `/recommendations`.
- **The redirect mechanism is decided by the codebase:** `next.config.ts` already has `rewrites()`+`headers()` but NO `redirects()` — adding a `redirects({permanent:true})` block (→308, method-preserving, runs before proxy) is the clean Next-16-native, SEO-correct mechanism for any selective move.
- **The route-contract guard has a proven template:** `scripts/check-admin-route-manifest.ts` already does filesystem-walk + manifest-cross-check + hardened comment/string-stripping + a pure testable `runCheck(rootDir, manifest)` + `npm run lint` wiring + contracts-registry registration. Clone it — don't invent.
- **`(marketing)` is folder-only (zero URL change)** but collides with FOUR existing per-route layouts (`/legal`,`/demo`,`/for-quants`,`/browse` each hand-roll chrome) — use nested layouts under the group, keep each page's own `metadata`/`<h1>`/`<main>`, exclude `/browse` per CONTEXT.
- **Because the group is URL-stable, NAV-04 triggers zero runtime-state migration** — only genuine NAV-01 moves do. Keep moves few (likely 0 net-new; formalize the 2 existing stubs at most) to keep the blast radius near-zero.

### File Created
`.planning/phases/51-shell-information-architecture-restructure/51-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | no new deps; all primitives verified in-repo at exact versions |
| Architecture | HIGH | route-group + redirect mechanics verified against local Next-16 docs; guard has a proven precedent |
| Pitfalls | HIGH | #512 provenance in git log; the per-route-layout collision + redirect-stub findings read directly from source |

### Open Questions (RESOLVED)
- How many selective moves (recommendation: fewest — likely formalize the 2 existing redirect-stubs into `next.config` `redirects()`, possibly 0 net-new; surface the list for review). **RESOLVED (51-05):** 1 net-new move — `/scenarios` → `/allocations?tab=scenario` 308 via `next.config` `redirects()`; `/preferences` left as-is; zero PUBLIC_ROUTES delta.
- Demo banner / legal tab-nav under `(marketing)`: nested layouts vs merged header (recommendation: nested layouts). **RESOLVED (51-04):** nested layouts under `(marketing)` for `/demo` and `/legal` — zero URL change, distinct chrome preserved, `/browse` excluded.

### Ready for Planning
Research complete. The inventory (the NAV-03 hard predecessor) is produced, the guard design is a clone of an existing proven script, the redirect mechanism is decided, and the `(marketing)` consolidation path + its pitfalls are mapped. Planner can now create PLAN.md files.
