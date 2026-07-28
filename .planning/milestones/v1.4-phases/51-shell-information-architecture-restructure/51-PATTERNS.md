# Phase 51: Shell + Information-Architecture Restructure - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 14 (5 NEW, 9 MODIFIED)
**Analogs found:** 14 / 14 (every file has a proven in-repo analog — this phase *completes/guards* existing patterns, it does not invent)

> This phase is a routing/IA phase, not a feature phase. Per RESEARCH the durable
> win (the route-contract guard) is a near-clone of `scripts/check-admin-route-manifest.ts`,
> the redirect mechanism is `next.config.ts` `redirects()`, and every shell evolution
> is additive onto live `src/components/layout/**`. Every excerpt below cites file + line so
> the planner references it directly in each PLAN.md action.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/check-route-contract.ts` *(NEW)* | config / CI-gate | batch (fs-walk + cross-check) | `scripts/check-admin-route-manifest.ts` | exact |
| `src/lib/routing/route-contract-manifest.ts` *(NEW)* | model (data-only manifest) | transform | `src/lib/auth/rbac-manifest.ts` | exact |
| `src/__tests__/check-route-contract.test.ts` *(NEW)* | test (guard unit) | batch | `src/__tests__/check-admin-route-manifest.test.ts` | exact |
| `next.config.ts` (add `redirects()`) | config | request-response | `next.config.ts` own `rewrites()`/`headers()` | exact (self-precedent) |
| `src/proxy.ts` (`PUBLIC_ROUTES` lockstep) | middleware | request-response | `src/proxy.ts` own `PUBLIC_ROUTES` array | exact (self-precedent) |
| `src/app/(marketing)/layout.tsx` *(NEW)* | route (group layout) | request-response | `src/app/(auth)/layout.tsx` + landing `<header>` (`src/app/page.tsx` L49-72) + `LegalFooter` | exact |
| `src/app/(marketing)/{legal,demo}/layout.tsx` *(NEW, nested)* | route (nested layout) | request-response | `src/app/legal/layout.tsx` + `src/app/demo/layout.tsx` | exact (move-in-place) |
| moved marketing `page.tsx` (landing/for-quants/security/demo/legal) | route | request-response | their current `page.tsx` (preserve metadata + `<main>`/`<h1>`) | exact (folder move) |
| `src/components/layout/Sidebar.tsx` (nav completeness + a11y) | component | event-driven (nav) | `MobileNav.tsx` (already has `aria-current`/focus-visible) | role-match (mirror) |
| `src/components/layout/Breadcrumb.tsx` (aria-current + focus) | component | transform (pathname→crumbs) | `MobileNav.tsx` aria-current pattern + own structure | role-match |
| `src/components/layout/PageHeader.tsx` (optional `breadcrumb` prop) | component | request-response | own structure (additive prop) | exact (self) |
| `src/__tests__/contracts/contracts-registry.test.ts` (register guard) | test (registry) | transform | own `CONTRACT_GUARDS` array (L76-107) | exact (self) |
| `e2e/route-redirects.spec.ts` *(NEW, per-move)* | test (e2e canary) | request-response | `e2e/security-page.spec.ts` (status<400 + anon-reachable) | role-match |
| `e2e/marketing-shell.spec.ts` *(NEW)* + axe matrix extend | test (e2e) | request-response | `e2e/axe-app-wide.spec.ts` PUBLIC_ROUTES matrix (L82-88) | exact (extend) |

---

## Pattern Assignments

### `scripts/check-route-contract.ts` (config / CI-gate, batch) — NEW

**Analog:** `scripts/check-admin-route-manifest.ts` — clone its exact shape. This is the single highest-leverage reuse in the phase.

**Shebang + module imports** (`check-admin-route-manifest.ts` L1, L54-65):
```ts
#!/usr/bin/env -S npx tsx
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";
import { ROUTE_CONTRACT_MANIFEST, type RouteEntry } from "../src/lib/routing/route-contract-manifest";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
```

**REUSE VERBATIM — `stripComments` tokenizer** (L107-220): the hardened single-pass char tokenizer that erases comment + string + template-literal contents. The guard needs it to parse `PUBLIC_ROUTES` out of `proxy.ts` without a `"/legal"` *inside a string in a comment* producing a false match. Do NOT re-hand-roll — import or copy this exact function. (RESEARCH "Parsing PUBLIC_ROUTES" example L429-439 relies on it.)

**Filesystem walk** (L328-351) — adapt `findRouteFiles` to walk `page.tsx` (not `route.ts`):
```ts
export function findRouteFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return out; }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...findRouteFiles(full));
    else if (st.isFile() && name === "page.tsx") out.push(full); // was "route.ts"
  }
  return out;
}
```
> NEW DERIVATION STEP the admin guard does NOT have: each `page.tsx` path must be mapped to its URL — strip `src/app`, DROP `(group)` parens segments (route groups are folder-only), convert `[seg]` → `:seg`. RESEARCH Pattern 4 step 2 (L326).

**Pure testable entry point** (L363-412) — `runCheck(rootDir, manifest)` returns `string[]` violations, empty = pass. Mirror the 4 rules from RESEARCH Pattern 4 (L327-332):
```ts
export function runCheck(rootDir: string, manifest = ROUTE_CONTRACT_MANIFEST): string[] {
  const violations: string[] = [];
  // Rule 1: every page route is classified (public|private|admin|exception) — else MISSING
  // Rule 2: every manifest "public" route ∈ PUBLIC_ROUTES (the #512 lockstep) — else MISSING-FROM-PUBLIC
  // Rule 3: every manifest "redirectFrom" has a matching next.config.ts redirects() entry
  // Rule 4: every manifest entry points at a real file (no STALE) — mirror L402-409
  return violations;
}
```

**CLI exit-code + import-guard** (L414-444): copy `main()` verbatim (exit 1 with the violation list to `console.error`) AND the `import.meta.url === file://${process.argv[1]}` dormant-under-test guard at the bottom — without it the script runs on `import` in the vitest suite.

**Lint wiring** (`package.json` L11) — append a second `tsx` invocation:
```json
"lint": "eslint --cache ... src/ && tsx scripts/check-admin-route-manifest.ts && tsx scripts/check-route-contract.ts"
```
Add a `"check:route-contract": "tsx scripts/check-route-contract.ts"` script too (mirrors L19).

---

### `src/lib/routing/route-contract-manifest.ts` (model, data-only) — NEW

**Analog:** `src/lib/auth/rbac-manifest.ts` — a pure data-only module (imports nothing, runs no logic) so any context (tests, CI, docs) can load it without pulling `server-only`/Supabase. Keep that property.

**Type union + entry shape** (`rbac-manifest.ts` L48-70):
```ts
export type RouteClass = "public" | "private" | "admin" | "exception";
export type RouteEntry = {
  /** URL path (NOT file path) — e.g. "/legal", "/allocations". */
  route: string;
  class: RouteClass;
  /** Old path this route was moved FROM (drives Rule 3: must have a redirects() entry). */
  redirectFrom?: string;
  /** Free-text note: why this class, or why it's an exception (e.g. /api/health probe). */
  notes: string;
};
```

**Manifest const** (L82-213) — alphabetical-by-route, one entry per page route from the RESEARCH inventory (57 page routes). Carry the inventory's `exception` carve-outs verbatim: `/api/health` (unauthenticated probe, NOT in PUBLIC_ROUTES — RESEARCH L139), `/auth/callback` (OAuth flow — L140). The doc-comment must name the guard (`scripts/check-route-contract.ts`) as enforcement, mirroring `rbac-manifest.ts` L22-32.

---

### `src/__tests__/check-route-contract.test.ts` (test, guard unit) — NEW

**Analog:** `src/__tests__/check-admin-route-manifest.test.ts` — drive `runCheck(tmpTree, fixtureManifest)` against a hand-built tmp fixture tree, assert the returned violations array (no process-exit, no console capture).

**Imports + tmp-tree harness** (L1-41):
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck, stripComments } from "../../scripts/check-route-contract";
import type { RouteEntry } from "../lib/routing/route-contract-manifest";

let fixtureRoot: string;
function writeRoute(relativePath: string, contents: string): void {
  const abs = join(fixtureRoot, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
}
```

**Per-violation-class fixtures** — mirror the admin test's one-fixture-per-class design (L43-90). Cover: a public route present in `PUBLIC_ROUTES` (pass), a manifest-public route ABSENT from PUBLIC_ROUTES (Rule 2 / #512 violation), an unclassified route (Rule 1), a `redirectFrom` with no `redirects()` entry (Rule 3), a stale manifest entry (Rule 4), and the comment/string-bypass carve-out (a `"/legal"` literal inside a comment in `proxy.ts` fixture must NOT satisfy the lockstep — this is the `stripComments` regression the admin test pins at L81-90).

---

### `next.config.ts` — ADD `async redirects()` (config, request-response) — MODIFY

**Analog:** the file's OWN existing `async rewrites()` (L4-11) and `async headers()` (L12-84) — add `redirects()` as a sibling async fn. RESEARCH Don't-Hand-Roll: a static URL move belongs in `redirects()` (runs before proxy + filesystem, SEO-cacheable 308), NOT a proxy branch.

**Existing sibling shape to match** (L3-11):
```ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/security.txt", destination: "/.well-known/security.txt" },
    ];
  },
  // ADD redirects() here as a sibling — permanent:true → 308, query auto-preserved
  async headers() { /* existing CSP + /demo cache headers — UNCHANGED */ },
};
```

**New block (RESEARCH Code Examples L417-426):**
```ts
async redirects() {
  return [
    { source: "/old-path", destination: "/new-path", permanent: true }, // 308
  ];
},
```
> PRESERVE: the `/demo/:path*` `Cache-Control` + `Vary: Cookie` headers (L71-82) — since `(marketing)` is folder-only the `/demo` URL is unchanged, so this header source still matches (RESEARCH A3 / Runtime State). Do not touch the `headers()` block.

---

### `src/proxy.ts` — `PUBLIC_ROUTES` lockstep (middleware, request-response) — MODIFY

**Analog:** the file's OWN `PUBLIC_ROUTES` const (L7) and the battle-tested matcher (L53-55). The guard's Rule 2 reads this exact array literal. Any NAV-01 move that relocates a public route updates this array IN THE SAME CHANGE (the #512 lockstep).

**The array literal the guard parses** (L7):
```ts
const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/scenario-share", "/api/benchmark/btc", "/legal", "/demo", "/api/demo", "/for-quants", "/api/for-quants-lead", "/security"];
```

**The matcher that makes a wrong entry a 307→login** (L52-55) — substring-safe, do NOT change:
```ts
const path = request.nextUrl.pathname;
const isPublicRoute =
  path === "/" ||
  PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
```

**Bounce-exempt set** (L87-111): every marketing route moving into `(marketing)` MUST stay in `isAuthBounceExempt` (`isDemoRoute`/`isForQuantsRoute`/`isSecurityRoute`/`isLegalRoute`) so an authed user STAYS on the page instead of bouncing to dashboard. Since `(marketing)` is folder-only, the URLs are unchanged — these branches keep matching with NO edit. Verify, don't rewrite.

> CRITICAL (RESEARCH Pitfall 1 / #512): a moved public route absent from this array → anonymous recipient hits L57 → 307 `/login`. The guard Rule 2 + an anon e2e canary are the two enforcement points.

---

### `src/app/(marketing)/layout.tsx` (route, group layout) — NEW

**Analog (group mechanism):** `src/app/(auth)/layout.tsx` — a route-group layout is a plain server component wrapping `{children}`; the `(parens)` segment is folder-only, ZERO URL change. (`(auth)/layout.tsx` is the whole file — 11 lines.)

**Analog (header to hoist):** the live landing `<header>` in `src/app/page.tsx` (L49-72) — this is the SoT marketing header to lift into the shared layout:
```tsx
<header className="border-b border-border bg-white">
  <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
    <Link href="/" className="inline-flex items-center py-2 font-display text-lg tracking-tight text-text-primary">
      Quantalyze
    </Link>
    <div className="flex items-center gap-2">
      <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:bg-page hover:text-text-primary transition-colors">
        Log in
      </Link>
      <Link href="/signup" className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
        Get Started
      </Link>
    </div>
  </div>
</header>
```
> UI-SPEC §Marketing Shell renames the CTAs to "Sign in"/"Sign up" and adds `focus-visible:ring-2 ring-accent` to each link. The `min-h-[44px]` tap targets are already present — preserve.

**Analog (footer):** `LegalFooter` (`src/components/legal/LegalFooter.tsx`, whole file) — mount it ONCE in the marketing layout (it's already imported per-page in `legal`/`for-quants` layouts). The 4 legal links + copyright are the verbatim contract (UI-SPEC §Marketing footer links).

**Hard rules (RESEARCH Pitfall 2 + UI-SPEC §SEO):** the layout owns header/footer chrome ONLY. Each wrapped page keeps its OWN `export const metadata`, its single `<main>`, its single `<h1>`. Do NOT hoist `<h1>`/`metadata`. The shell is SERVER-rendered (no `"use client"`) so `<h1>`/metadata are never deferred. The landing page's `redirect("/discovery/crypto-sma")` for authed users (`page.tsx` L40-42) STAYS in the page, not the layout.

---

### `src/app/(marketing)/{legal,demo}/layout.tsx` (route, nested layout) — NEW (move-in-place)

**Analogs:** the EXISTING `src/app/legal/layout.tsx` and `src/app/demo/layout.tsx` — these are the distinct per-route chrome that the consolidation must PRESERVE as nested layouts under the group (RESEARCH Pitfall 3 — the collision the nested layouts exist to preserve).

**`legal/layout.tsx` — the tab-nav to keep** (L10-14, L27-37):
```tsx
const TABS = [
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/disclaimer", label: "Risk Disclaimer" },
];
// ...rendered as a <nav> of min-h-[44px] tabbed Links
```
> Keep `export const metadata` (L6-8). Its hand-rolled `<header>` (L19-39) DUPLICATES the new shared marketing header — when nested under `(marketing)/layout.tsx`, DROP the legal `<header>` and keep ONLY the tab-nav (the shared header now provides the masthead). The `<main className="mx-auto max-w-3xl ...">` (L40) stays — single `<main>` per page.

**`demo/layout.tsx` — the `DemoBanner` to keep** (L30-55): the sticky `<header>` masthead with the "Live demo — simulated allocator data" copy + "Sign up →" CTA. RESEARCH Pitfall 3: this banner is distinct chrome — keep it as the nested `(marketing)/demo/layout.tsx`. NOTE its A11Y-01 comment (L31-37): exactly ONE `<main>` (the page body owns it, the banner is `<header>`) — preserve that single-landmark discipline so the JOURNEY-03 axe class does not recur.

---

### `src/components/layout/Sidebar.tsx` (component, nav) — MODIFY (completeness + a11y)

**Analog (the OR-logic SoT — DO NOT REGRESS):** `buildNavSections` (L19-114) — `showsAllocatorWorkspace = isAllocator || isAdmin` (L34), `showsManagerWorkspace = isManager || isAdmin` (L35), `showsDiscovery = isAllocator || isAdmin` (L36). T-45-01 info-disclosure mitigation. Add orphan nav entries INSIDE the correct role-gated section; NEVER alter the `||` derivations (RESEARCH Pitfall 5).

**Nav completeness target** — the genuine orphans (RESEARCH NAV-01 / A1): `/compare`, `/decks`, `/referral`, `/recommendations` are allocator-owned with no nav entry. Add inside the allocator/`showsAllocatorWorkspace` branch (alongside `workspaceItems.push` L59-66) OR confirm parent-reachable + breadcrumb. The `NavItem` shape (L9-15) + an inline 16×16 stroke-1.5 SVG icon (L336-425 house style) is the pattern — reuse an existing glyph, do NOT add an icon dep (UI-SPEC §Icon library).

**Analog (the a11y pattern to MIRROR):** `MobileNav.tsx` L67-78 already has BOTH gaps closed — copy its shape onto the desktop `NavItemLink`:
```tsx
// MobileNav.tsx (the pattern to mirror onto Sidebar NavItemLink):
<Link
  aria-current={active ? "page" : undefined}
  className={cn(
    "... transition-colors",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
    active ? "text-accent" : "text-text-muted",
  )}
>
```

**The `NavItemLink` to extend** (`Sidebar.tsx` L301-334) — currently has NO `aria-current` and NO focus-visible affordance:
```tsx
const active = pathname === item.href || pathname.startsWith(item.href + "/"); // KEEP (SSR-safe, no useSearchParams)
<Link
  href={item.href}
  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
    active ? "bg-sidebar-active text-sidebar-text-active"
           : "hover:bg-sidebar-hover hover:text-sidebar-text-active"
  }`}
>
```
> ADD additively (RESEARCH L446-453 + UI-SPEC §Item state contract): `aria-current={active ? "page" : undefined}` AND `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent` in the className. Accent ring on the dark rail; the active *background* stays `bg-sidebar-active` slate (accent on navy fails contrast — UI-SPEC §Color). Keep the active rule exactly (L308) — no `useSearchParams` CSR-bailout.

> `buildPrimaryMobileNav` (L145-195) is the mobile twin — if any new orphan becomes a mobile primary cell it must mirror the SAME OR-logic (L154-155) and keep distinct hrefs (the `<=5` cap, L190-193). LOCKED v1.3 — do not restructure.

---

### `src/components/layout/Breadcrumb.tsx` (component, transform) — MODIFY (aria-current + focus)

**Analog:** its OWN structure (whole file, 47 lines) + the `MobileNav` aria-current pattern. The existing `<nav aria-label="Breadcrumb">` wrapper (L14) and the curated `items` prop (L3-10) are the contract — RESEARCH Pattern 3a recommends KEEPING explicit `items` (curated chains via `PageHeader`), NOT auto-segment-derivation (avoids raw-UUID crumbs on `[id]`/`[token]`).

**The two gaps to close** (L32-41) — additive:
```tsx
{item.href ? (
  <Link
    href={item.href}
    className="hover:text-text-primary transition-colors"
    // ADD: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
  >
    {item.label}
  </Link>
) : (
  // ADD aria-current="page" to the leaf span:
  <span className="text-text-primary font-medium" /* aria-current="page" */>{item.label}</span>
)}
```
> UI-SPEC §Breadcrumb Contract: leaf gets `aria-current="page"`; linked crumbs get `focus-visible:ring-2 ring-accent` (keyboard-only, never bare `focus:`). Truncation of long leaf labels uses `truncate max-w-[…]` + `title={fullLabel}` (UI-SPEC §Truncation) — never clip the leaf so the page identity is unreadable.

**Hierarchy derivation** (RESEARCH Pattern 3a / UI-SPEC §Hierarchy): root crumb → role workspace landing (allocator→`/allocations`, manager→`/strategies`, admin→`/admin`); depth 2-3; collapse non-navigable segments. Existing curated-`items` usage at `browse/[slug]`, `discovery/[slug]`, `strategies/[id]/edit`, `compare` (grep-confirmed call sites) is the proven invocation shape.

---

### `src/components/layout/PageHeader.tsx` (component) — MODIFY (optional `breadcrumb` prop)

**Analog:** its OWN `PageHeaderProps` (L3-9) — RESEARCH Pattern 3a single-sources breadcrumbs THROUGH `PageHeader` via a new optional prop:
```tsx
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumb?: BreadcrumbItem[]; // ADD — renders <Breadcrumb items={breadcrumb}/> above the <h1>
}
```
> Additive, optional — surfaces that don't pass it render exactly as today. Keep `text-[32px]` (UI-SPEC: no type churn this phase). The single `<h1>` (L15-17) stays.

---

### `src/__tests__/contracts/contracts-registry.test.ts` (test, registry) — MODIFY (register guard)

**Analog:** its OWN `CONTRACT_GUARDS` array (L76-107) — add a row for the new route-contract guard, mirroring the existing `check-admin-route-manifest.ts` row (L105):
```ts
{ path: "scripts/check-route-contract.ts", batch: "NAV-03", invariant: "ROUTE_CONTRACT_MANIFEST ↔ PUBLIC_ROUTES + redirects() lockstep (the #512 class, lint gate)" },
```
> The existence test (L117-124) then pins it (delete/rename → red CI). Also add a `REGISTRY.md` row in the same human-readable table. The `>= 20` floor (L114) keeps holding. The `contracts.yml` wiring test (L178-184) needs no change (it asserts the surface runs lint, and lint now invokes the new gate).

---

### `e2e/route-redirects.spec.ts` (test, e2e canary) — NEW (per-move, only if moves taken)

**Analog:** `e2e/security-page.spec.ts` L29-40 — the anon-reachable status<400 canary shape:
```ts
test("renders unauthenticated", async ({ page }) => {
  const res = await page.goto("/security");
  expect(res?.status()).toBeLessThan(400); // NOT a 307→login (the #512 assertion)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // real content, not a redirect shell
});
```
> Per CONTEXT hard-constraint (c): every selective move needs a canary proving the OLD path resolves to real content (200, not 307→login). For the authed half there is no automatable e2e (headless can't auth — MEMORY [[browse-no-hydrate-authed]]); use the passwordless SSR-prop recipe post-deploy (RESEARCH VALIDATION L527). If A4 lands as "zero net-new moves", this spec is unneeded.

---

### `e2e/marketing-shell.spec.ts` (test, e2e) + axe matrix extend — NEW + MODIFY

**Analog:** `e2e/axe-app-wide.spec.ts` PUBLIC_ROUTES matrix (L82-88) — already scans `/`, `/security`, `/for-quants`, `/browse`, `/demo` at desktop+mobile with the anti-false-green status<400 + visible-anchor gate (L79-88, header comment L29-47):
```ts
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/", anchor: "h1" },
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/browse", anchor: "main h1" },
  { path: "/demo", anchor: "#editorial-hero-headline" },
];
```
> NAV-04 obligation: after the `(marketing)` move, each route still resolves at its SAME URL + stays public (anon 200) + keeps single `<main>` + single `<h1>` (no duplicate landmark — the JOURNEY-03 class). The existing `main h1` anchors already assert single-`<h1>`; the marketing-shell spec adds the same-URL + still-public assertions. CRITICAL CI WIRING (header comment L31-47 + MEMORY FLOW-01): a new seeded e2e must be added to BOTH the `HAS_SEED_ENV` const AND ci.yml's playwright list, else it never runs. This spec is PUBLIC (unseeded) → wire into the UNSEEDED ci.yml list.

---

## Shared Patterns

### CI-gate guard scaffolding (the by-construction enforcement ethos)
**Source:** `scripts/check-admin-route-manifest.ts` (fs-walk + `runCheck(rootDir, manifest)` + exit-code + `stripComments` hardening) + `src/lib/auth/rbac-manifest.ts` (data-only manifest) + `contracts-registry.test.ts` (registration) + `package.json` L11 (`&& tsx scripts/check-*.ts` lint chain).
**Apply to:** the entire NAV-03 guard triple (`check-route-contract.ts` + `route-contract-manifest.ts` + `check-route-contract.test.ts` + registry row + lint wiring). This is a 4-part proven recipe — clone all four parts, do not invent.

### Route-group layout (folder-only, zero URL change)
**Source:** `src/app/(auth)/layout.tsx` (plain server component wrapping `{children}`) + `src/app/(dashboard)/layout.tsx` (server-side role derivation → props, the role-truth source).
**Apply to:** `(marketing)/layout.tsx` and its nested `(marketing)/{legal,demo}/layout.tsx`. The marketing shell is the SIMPLE case (no auth gate, no role props) — closer to `(auth)/layout.tsx`. Nested layouts compose under the group layout (RESEARCH Pitfall 3).

### Active-route detection (SSR-safe, no CSR-bailout)
**Source:** `Sidebar.tsx` L308 + `MobileNav.tsx` L63 — `pathname === href || pathname.startsWith(href + "/")` via `usePathname()`.
**Apply to:** every nav/breadcrumb active-state. NEVER reach for `useSearchParams` (forces a Next-16 Suspense boundary the shell doesn't have — documented tradeoff `MobileNav.tsx` L17-29).

### focus-visible + aria-current (the 3 a11y gaps)
**Source:** `MobileNav.tsx` L70 (`aria-current`) + L76 (`focus-visible:outline-2 outline-accent`) — the ONLY shell component that already closes both gaps.
**Apply to:** `Sidebar.tsx` `NavItemLink` (L301-334) + `Breadcrumb.tsx` (L32-41). Use `focus-visible:` (keyboard), never bare `focus:` (UI-SPEC §Hard rules). Ring token `ring-2 ring-accent` on light surfaces; `outline-2 outline-accent` where the element already uses outline.

### Shared marketing footer
**Source:** `LegalFooter.tsx` (whole file) — already mounted per-page in `legal`/`for-quants` layouts.
**Apply to:** mount ONCE in `(marketing)/layout.tsx` (remove the per-page mounts under the group). The 4 legal links + copyright are the verbatim copy contract.

### Per-page metadata preservation (SEO non-regression)
**Source:** each marketing page's `export const metadata` — `security/page.tsx` L25-43 (full `Metadata` with `alternates.canonical`, `robots`, `openGraph`), `legal/layout.tsx` L6-8, `demo/layout.tsx` L4-8.
**Apply to:** every page moved into `(marketing)` — the metadata export stays ON THE PAGE/its nested layout, NEVER hoisted to the group layout (RESEARCH Pitfall 2 / UI-SPEC §SEO).

---

## No Analog Found

None. Every file in this phase has a proven in-repo analog — the phase *completes* and *guards* existing patterns rather than building new ones (RESEARCH "Key insight" L357). The closest thing to a net-new shape is the page-path→URL derivation (strip `(group)`, `[seg]`→`:seg`) inside `check-route-contract.ts`, which is a ~10-line addition to the otherwise-cloned admin-guard walk — not a no-analog file.

---

## Metadata

**Analog search scope:** `scripts/`, `src/lib/{auth,routing}/`, `src/__tests__/{,contracts/}`, `src/components/layout/`, `src/components/legal/`, `src/app/{(auth),(dashboard),legal,demo,for-quants,security}/`, `src/app/page.tsx`, `next.config.ts`, `src/proxy.ts`, `e2e/`, `package.json`.
**Files scanned:** 19 read in full or in targeted ranges; ~12 more located via grep/find.
**Pattern extraction date:** 2026-06-29
