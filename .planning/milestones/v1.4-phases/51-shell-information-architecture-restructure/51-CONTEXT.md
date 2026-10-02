# Phase 51: Shell + Information-Architecture Restructure - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make "where am I / how do I get back" answerable on every surface, for every
role — WITHOUT breaking a single share/deep link. Deliver: (1) role-scoped nav
brought to completeness (no orphan/dead-end surfaces) on the existing
`Sidebar`/`DashboardChrome`/`MobileNav` shell; (2) app-wide **breadcrumbs** +
consistent active/hover/focus states (now on the Phase-50 primitives) +
consistent back-paths; (3) a **route-contract inventory** + a **by-construction
CI guard** that keeps every route's `proxy.ts` `PUBLIC_ROUTES` (or explicit
private) status + redirect-map entry in lockstep; (4) a `(marketing)` Next route
**group** (parens — zero URL change) that gives the public/marketing routes one
shared shell; (5) **selective** route moves/consolidations into cleaner paths,
each with a redirect so old links 301 and an authed canary proving it still
resolves (the #512 307→login class must NOT recur).

This is the highest-blast-radius phase (routing) and main auto-deploys to prod
with no branch protection — so the route-contract guard + per-move redirect +
authed canary are non-negotiable. FROZEN: `scenario.ts` (SCENARIO-05),
`compute.ts` parity, FactsheetBody (BODY-02), no-invented-data, no-peer-rank,
the v1.3 WCAG-AA floor, `next/font`, fonts, accent `#1B6B5A`, light mode only.
Command palette (⌘K) is DEFERRED to NAV-F1 — not this phase.
</domain>

<decisions>
## Implementation Decisions

### Route-move policy (user-accepted: Selective moves + redirects)
- **Selective moves allowed** — Phase 51 MAY move/consolidate a few routes into
  cleaner paths. HARD CONSTRAINTS on every move (no exceptions): (a) a redirect
  (301/308) from the old path to the new so existing deep/share links resolve;
  (b) the `proxy.ts` `PUBLIC_ROUTES` allowlist + the redirect map updated in the
  SAME change; (c) an authed (or public, as applicable) canary that proves the
  old link still resolves to real content, not a 307→login (the #512 regression
  class). A move without all three is a defect.
- **Which routes move is Claude's discretion**, grounded in the route-contract
  inventory (produced first — it is a hard predecessor). Bias toward FEW,
  high-value consolidations; do NOT move engine-adjacent or share-token routes
  (`/scenario-share/[token]`, `/factsheet/[id]`, `/strategy/[id]`,
  `/portfolio-pdf/[id]`) — their links are in the wild. Surface the proposed move
  list in the plan for review before executing.

### Marketing shared shell (user-accepted: All public marketing routes)
- A `(marketing)` Next route group (parens → **no URL change**) wraps the public
  marketing/info routes — the landing page + `/legal` + `/for-quants` +
  `/security` + `/demo` — in ONE shared public shell (header/footer/chrome). SEO
  must NOT regress (metadata/sitemap/robots preserved); each wrapped route MUST
  still resolve at its current URL and stay in `PUBLIC_ROUTES`.

### Route-contract enforcement (user-accepted: By-construction CI guard)
- A by-construction guard (a test or `eslint-plugin-quantalyze` rule, matching
  the existing `contracts-registry` ethos) FAILS CI when a route is added or
  moved without a matching `PUBLIC_ROUTES` (or explicit private) classification
  AND a redirect-map entry where applicable. This permanently closes the
  #512 (307→login) drift class. Registered in the contracts registry.

### Claude's Discretion (grounded in existing patterns)
- **Role-scoped nav** is already implemented in `Sidebar.buildNavSections`
  (allocator/manager/admin/both OR-logic, T-45-01 info-disclosure mitigation) —
  this phase brings it to COMPLETENESS (audit for orphan/dead-end surfaces:
  `/scenarios`, `/preferences`, `/referral`, `/recommendations`, `/security`,
  etc. — ensure each owned surface is reachable from its role's nav) rather than
  rebuilding it. Do not regress the role OR-logic security property.
- **Breadcrumbs** build on the existing `src/components/layout/Breadcrumb.tsx` +
  `PageHeader`; app-wide on dashboard surfaces with a consistent back-path
  convention. Active/hover/focus states use the Phase-50 primitive tokens
  (focus-visible rings, `--color-*`).
- Exact nav grouping, breadcrumb hierarchy/depth, the redirect mechanism
  (proxy.ts vs `next.config`/route-level), and the guard's implementation are at
  Claude's discretion within the above + ROADMAP success criteria.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/layout/Sidebar.tsx` — role-scoped `buildNavSections` (the nav
  source of truth; allocator/manager/admin/both OR-logic; the place to complete
  orphan-surface coverage). Co-located primary-nav item set (Option A / D-NAV01).
- `src/components/layout/DashboardChrome.tsx`, `MobileNav.tsx`,
  `MobileSidebarDrawer.tsx`, `PageHeader.tsx`, `Breadcrumb.tsx` — the existing
  shell to evolve (do not rebuild). All have colocated `.test.tsx`.
- `src/proxy.ts` — `PUBLIC_ROUTES` flat allowlist (~19 prefixes) matched by
  `path === route || path.startsWith(route + "/")`; the lockstep target for the
  route-contract guard. (Recall #512: a missing allowlist entry → recipient
  307→login.)
- `src/app/(auth)/` + `src/app/(dashboard)/` — existing route groups; the
  `(marketing)` group is a sibling. Ungrouped public roots today: `browse`,
  `demo`, `for-quants`, `legal`, `security`, `factsheet`, `scenario-share`,
  `portfolio-pdf`, `strategy`.
- `src/__tests__/contracts/contracts-registry.test.ts` + REGISTRY.md — register
  the new route-contract guard here.
- `tools/eslint-plugin-quantalyze/` — if the guard is an AST rule, it extends
  this local plugin.

### Established Patterns
- `(group)` Next route groups change the FOLDER tree, not the URL — the
  mechanism NAV-04 relies on.
- By-construction guards (eslint-plugin-quantalyze rules + the contracts
  registry) are the project's preferred enforcement (preferred over docs).
- The v1.3 mobile shell (TouchTooltip/useTapPin, mobile-drawer-keyboard e2e) is
  the locked mobile baseline — do not regress it.
- Authed prod canary recipes exist (passwordless SSR-prop verification) for
  proving a route resolves post-move.

### Integration Points
- `src/components/layout/**` (nav/breadcrumb/shell evolution).
- `src/app/**` (route groups: `(marketing)`; any selective moves + their
  redirects).
- `src/proxy.ts` (`PUBLIC_ROUTES` + the lockstep guard's read target).
- redirect map (mechanism TBD: `next.config` redirects vs proxy.ts).
- `src/__tests__/contracts/` + possibly `tools/eslint-plugin-quantalyze/`
  (the route-contract guard).
- `e2e/` (authed/public canaries proving moved routes still resolve).
</code_context>

<specifics>
## Specific Ideas

- The route-contract INVENTORY is a hard predecessor to any move — produce it
  first (every route → public/private + proxy status + redirect status), then
  decide the FEW selective moves from it.
- The guard is the durable win: it makes the #512 class impossible by
  construction, not just fixed once.
- Never move a share-token / in-the-wild-link route (scenario-share, factsheet,
  strategy, portfolio-pdf).
</specifics>

<deferred>
## Deferred Ideas

- Command palette (⌘K) global search/navigate (NAV-F1) — needs an RLS-scoped
  strategy-search backend spike; a later milestone.
- Per-surface fluid-type/no-clip realization (TYPE-02/03/04) — phase 52.
- Broad route reorganization beyond the few high-value selective moves — keep
  this phase's moves few and reversible.
</deferred>
