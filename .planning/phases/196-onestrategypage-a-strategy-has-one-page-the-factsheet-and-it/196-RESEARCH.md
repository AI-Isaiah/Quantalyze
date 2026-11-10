# Phase 196: ONESTRATEGYPAGE - Research

**Researched:** 2026-11-08
**Domain:** Next.js 16 App Router routing (config redirects), per-viewer chrome on a cache-isolated public page, factsheet layout restructure, print/tearsheet, test-suite migration
**Confidence:** HIGH on routing mechanics, cache-isolation constraints, link-site and test inventories (every file named was opened at worktree HEAD `bdae8527c`); MEDIUM on the tearsheet/PDF rebuild cost and the census method; LOW only where tagged `[ASSUMED]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Back and next step (discussed with the founder)
- **D-01 Back link:** a visible named link, "Back to Discovery" / "Back to My allocation" / etc., built from the origin the link into the factsheet carries. When the origin is unknown (bookmark, pasted URL), fall back to browser history. Founder pick: "Named link + fallback".
- **D-02 Next steps:** two actions in the factsheet header for a signed-in allocator: "Request intro" and "Add to my allocation". "Add to my allocation" opens the existing add flow on My allocation and replaces `AddToPortfolio`'s link to the removed `/portfolios`. Owners see neither action; they see "Edit strategy" instead. Founder pick: "Request intro + Add to allocation". Compare/shortlist is NOT added here (Phase 197).

#### Settled on the recommendation (founder left these to me, 2026-11-08)
- **D-03 Old routes:** `/strategy/[id]`, `/strategy/[id]/v2`, `/browse/[slug]/[strategyId]` and `/discovery/[slug]/[strategyId]` permanently redirect (308) to `/factsheet/[id]`, carrying the origin for D-01. Existing links and shared URLs keep working. `/factsheet/[id]/tearsheet` stays and becomes the factsheet's print view (same layout as D-04). `/factsheet-share/[token]` stays as its own route.
- **D-04 Opening view:** summary line, the equity curve (with drawdown beneath), and the main metrics table. Everything else (distribution, heatmaps, rolling, stress, signatures, mandate, comparator panels) sits behind one "Advanced" disclosure below, collapsed by default, its open state remembered per viewer in browser storage (wrapped in try/catch; renders correctly without it). No metric appears twice, the chart hint appears once, one small-sample warning, empty sections and "— on request" rows hidden.
- **D-05 Shared factsheet:** `/factsheet-share/[token]` gets a slim Quantalyze header (logo, "What is Quantalyze?", "Sign up") and a sign-up line under the factsheet; no navigation into the app; same layout as the main factsheet including "Advanced". Phase 194 D-22 (no AUM for a viewer who may not see it) still applies.

#### Carried forward (do not re-decide)
- Phase 194 D-04/D-11/D-20/D-21: the figure gate (short-track withholding, covered-day counting, 1y warm-up). The new layout shows withheld figures as withheld, never re-derives them.
- Phase 194 D-22: AUM and max capacity only for viewers allowed to see them (`canViewAum`/`withViewerAum`).
- Phase 193: viewing a strategy changes nothing and shows only its own content.
- Phase 195: `/portfolios` and the Tweaks panel are gone.

### Claude's Discretion
- How the origin is carried (query param vs. other), redirect implementation (middleware vs. route-level), exact header layout per DESIGN.md, the before/after census method for SC-5 (three named strategies; names must not be PROD ids in tracked text).

### Deferred Ideas (OUT OF SCOPE)
- Shortlist/compare action from the factsheet: Phase 197 scope.

### Locked design input
`196-UI-SPEC.md` (status `approved`) is the visual and interaction contract. Its OQ-1..OQ-7 carry defaults; this research supplies the facts each default depends on (see "Open Questions") and flags two places where a UI-SPEC literal conflicts with the code (`factsheet:advanced-open` storage key; "role `allocator` or `both`" vocabulary).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEAN-02 | A strategy has one page, the factsheet. The tearsheet is its print view and `/strategy/<id>` leads to it. | Config-level `redirects()` verified in Next 16.4.2 docs (308, runs before proxy, path params usable in destination query). Route-contract manifest lockstep (Rule 3 exact-string `redirectFrom`, Rule 4 `exception` carve-out). Link-site inventory of every in-app href to an old route. Tearsheet rebuild path (`fetchAndBuildPayload` + `FactsheetBody` print layout) and the PDF routes that screenshot it. |
| ROUTE-02 | A signed-in user is never shown visitor prompts ("Sign up") on `/browse` or `/strategy/<id>`, and an owner can open their own unpublished strategy. | Full inventory of "Sign up" prompts: `browse/layout.tsx`, `browse/page.tsx` ("Get Started Free", missing from UI-SPEC), `browse/[slug]/page.tsx`, the two detail pages (removed by redirect). Owner lane already exists on `/factsheet/[id]` (Lane B) and is pinned by `page.owner-lane.test.tsx` test 5 (owner view, then anon still 404). |
| ROUTE-04 | From a factsheet, a signed-in user can go back to where they came from and take a next step (request an intro, add to their allocation). A shared factsheet carries a header and a sign-up link. | Origin via `from`/`cat` query on in-app links (closed set; never reflected as href). Viewer resolution must use `profiles.role` (`allocator`/`manager`/`both`) + approval, matching `/api/intro` and `/allocations`' `requireRolePage`. Cross-phase contract `/allocations?add=<id>` (198 D-03). Share route is sessionless today (OQ-3 facts). |
| LEAN-05 | The factsheet opens as a summary, one chart and one metrics table, with the rest under "Advanced". No metric is shown twice, the keyboard hint appears once, there is one small-sample warning, and empty sections and "— on request" rows are hidden. | `FactsheetBody` structure mapped (sections, `PerformanceCharts` chart keys `cumulative` / `underwaterAcc`, `MetricsColumn` panels, `SectionNav`, `beforeprint` handler). Storage must go through `useCrossTabStorage` under a registered prefix. Four `FactsheetBody` mounts and their test fan-out (OQ-4). |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md / user CLAUDE.md)

Directives the planner must verify each plan against:

- **AGENTS.md:** "This is NOT the Next.js you know … Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." The worktree has no `node_modules`; this research read the docs from the main checkout's `node_modules/next` (version `16.4.2`, identical to the worktree's `package-lock.json` resolved version). Executors run `npm ci` in the worktree as a pre-step and re-read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md` before editing `next.config.ts`.
- **Public repo, `.planning/` tracked:** no PROD ids, amounts, home paths or account numbers in tracked text. The SC-5 census names strategies by public display name and profile only; ids go in an env var, never a committed file.
- **CHANGELOG discipline:** every ship writes a unified CHANGELOG entry in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- **CI gate integrity:** never write the CI skip trailer tokens in a commit message or PR body, not even to deny them.
- **Completion is historical:** verifications use `verified_at_sha` + `drift_subjects`, never `covered_files`/`covered_digest`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never in `drift_subjects`.
- **Design System:** read `DESIGN.md` before any visual decision; UI-SPEC is the approved contract.
- **Testing (memory + Rule 9/12):** data-integrity and user-facing gates must be able to fail: neuter, see RED, restore from a byte backup (`cp -p` + `cmp`; never `git checkout`/`restore`/`stash` on uncommitted work). Always `grep -a`.
- **Database:** this phase needs no migration and no PROD write. Any PROD read is via MCP, marker query first.
- **Rule 3 (surgical) / Rule 7 (surface conflicts):** two role systems exist (`profiles.role` and `user_app_roles`); this phase must not merge them (see Pitfall 4).
- **Banned packages:** none involved; this phase installs no package.

## Summary

The routing half is mechanically simple and well-precedented: Phase 51 (`/scenarios`) and Phase 195 (`/portfolios/:path*`, `/api/portfolio-pdf/:id`) already use config-level `redirects()` with `permanent: true`, a matching manifest `redirectFrom` row (exact-string lockstep, Rule 3), an `exception` class so Rule 4 skips the missing page file, and an `e2e/route-redirects.spec.ts` first-hop canary. Next 16.4.2's own docs confirm the three facts the UI-SPEC asked about: `permanent: true` returns 308, config redirects run before the proxy (step 2 vs step 3 of the execution order), and path parameters can be placed in the destination query when written explicitly (`/factsheet/:strategyId?from=discovery&cat=:slug`); the request's own query string is passed through. The real work in routing is the blast radius: four route trees with their route-local tests, ~13 e2e specs that visit the old URLs, and a set of library modules (`StrategyV2Shell` and its panel tree, `getStrategyDetailV2`, `getPublicStrategyDetail`, `v2-joint`, `composite-joint`) that become orphaned. Phase 194.1 has three plans (12, 13, 14) that edit exactly those files and are explicitly marked "196-conditional, skip if 196 merged"; whichever phase merges second must resolve that.

The viewer-chrome half collides with the factsheet's most defended invariant. `/factsheet/[id]` is engineered so that a published render pays **zero** session probes: `page.owner-lane.test.tsx` "lane order lock" asserts `getUserSpy` was called 0 times on a published authed render. Every viewer-dependent chrome element (viewer bar, visitor header, sign-up line, back link label) needs the session on every render. The safe shape is: keep Lane A first and the `unstable_cache` key viewer-free, then resolve the viewer **after** the lane decision (one `auth.getUser()` + one `profiles` read), pass it as a per-request render prop outside the payload (the T-150-27 rule), and rewrite the lane-order test deliberately from "0 calls" to "no session call before the published probe, no `.or` filter, cache invoked once". The roles that gate the actions are `profiles.role` (`allocator`/`manager`/`both`) plus approval, the same predicate `/api/intro` and `/allocations` enforce, not the `user_app_roles` RBAC set that `canViewAum` reads.

The layout half (D-04) is a restructure of `FactsheetBody` (a 3,092-line `FactsheetView.tsx`) plus `MetricsColumn.tsx` (1,409 lines), pinned by roughly 60 colocated test files. The opening grid already has the right geometry (`lg:grid-cols-[1fr_380px]`); the equity figure is two existing chart configs (`cumulative`, `underwaterAcc`) pulled out of `PerformanceCharts`. "Advanced" must be built on `useCrossTabStorage` under an **existing registered prefix** (the UI-SPEC's `factsheet:advanced-open` is under no registered prefix and would survive the sign-out purge), must mount its contents only on first open (a closed `<details>` still mounts and renders its children), and must be excluded from both the `beforeprint` force-open handler and `COLLAPSIBLE_OPEN_ALL_EVENT`. The tearsheet today is an entirely separate data path (stored `strategy_analytics` scalars via `getFactsheetDetail`, its own `HeroMetric`/`DetailMetric`, its own attestation gate) and turning it into "the factsheet's print view" is a rebuild, not a restyle.

**Primary recommendation:** Split by topic into file-disjoint plans: (1) census-before + Wave 0 scaffolds, (2) redirects + manifest + route-tree deletion + link repointing + e2e retargeting, (3) origin map + back link + `from` on every link site, (4) server viewer resolution + viewer bar / visitor header / sign-up line on both factsheet routes, (5) `/browse` session-awareness, (6) opening view + Advanced in `FactsheetBody`/`MetricsColumn`, (7) tearsheet as print view, (8) note card (if OQ-6 accepted), (9) orphan sweep + census-after. Plans 4 and 6 both touch `FactsheetView.tsx`; keep the chrome **outside** `FactsheetBody` (rendered by the page around `<FactsheetView>`) and give `FactsheetBody` only a `beforeFooterSlot` so 4 and 6 do not collide.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Old-route → factsheet redirects (308) | Frontend Server (Next config `redirects()`) | — | Runs before the proxy and the filesystem; DB-free, so it reveals nothing about id existence. |
| Visibility of an unpublished strategy | Frontend Server (SSR, `factsheet/[id]/v2/page.tsx` lanes) | Database (RLS `strategies_read`) | Existing Lane A / Lane B; unchanged by this phase. |
| Viewer resolution (session, role, approval, owner) | Frontend Server (SSR page) | Database (`profiles` under RLS) | Must be server-validated (`getUser()`), per request, and never enter the cached payload. |
| Viewer bar / visitor header / sign-up line | Frontend Server (server component around `FactsheetView`) | Browser (back-link history fallback) | Chrome is chosen by session; only the "no origin" branch needs `document.referrer`/`history.back()`. |
| Origin (`from`/`cat`) parsing | Frontend Server (page reads `searchParams`) | Browser (link sites emit it) | Closed-set lookup on the server; raw value never used as an href. |
| Request intro | Browser (`RequestIntroButton`) | API (`/api/intro`, allocator + approval gate) | Existing flow; copy edits only. |
| Add to my allocation | Browser (link) | Frontend Server (`/allocations` page, Phase 198 honours `?add=`) | 196 ships the link; 198 owns the flow. |
| Opening view + Advanced | Browser (client `FactsheetBody`) | — | Pure presentation over the payload; storage via `useCrossTabStorage`. |
| Tearsheet print view | Frontend Server (SSR) | API (`tearsheet.pdf` Puppeteer screenshot) | PDF route renders the HTML page cookieless. |
| `/browse` session-aware header | Frontend Server (layout/page) | — | Browse pages are already dynamic (they read cookies via `createClient`). |

## Standard Stack

No new package. Everything this phase needs is in the repo.

### Core (in-repo, verified this session)
| Library / module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.4.2 [VERIFIED: package-lock.json `node_modules/next` version] | `redirects()` in `next.config.ts`, App Router pages, `searchParams` | The established redirect mechanism here (Phases 51, 195). |
| `@supabase/ssr` 0.12.7 / `@supabase/supabase-js` 2.118.0 [VERIFIED: package-lock.json] | — | `createClient()` (request-scoped, cookies), `auth.getUser()` | The project's only server auth path; `getUser()` is the validated call (`canViewAum` docblock forbids `getSession()` for decisions). |
| `useCrossTabStorage` (`src/lib/storage/cross-tab.ts`) | in-repo | SSR-safe deferred localStorage with fail-loud read/write and cross-tab sync | `CollapsibleSection` and the factsheet context already use it; it owns the try/catch D-04 asks for. |
| `CollapsibleSection` (`src/components/ui/CollapsibleSection.tsx`) | in-repo | Sections inside Advanced | Existing idiom; keeps per-strategy keys. |
| `LazyMount` (`src/app/factsheet/[id]/v2/LazyMount.tsx`) | in-repo | Defers heavy panels | Existing; reuse inside Advanced. |
| `fetchAndBuildPayload` / `fetchAndBuildPayloadWithReason` (`src/lib/factsheet/fetch-and-build-payload.ts`) | in-repo | The one payload builder | Discovery detail and the share route already call it uncached; the tearsheet should too. |
| `knip` ^6.42.1 [VERIFIED: package.json] | — | Dead-file report after the route deletions | Already wired as a non-blocking CI report (`ci.yml` job `knip`). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Config `redirects()` | `redirect()`/`permanentRedirect()` in each old `page.tsx` | Page-level redirects run after the proxy, so an anonymous visitor on an old `/discovery/...` link would be bounced to `/login` before reaching the page (the #512 class). Also needs the page file kept. Rejected. |
| Config `redirects()` | Redirect inside `src/proxy.ts` | Possible, but splits redirect sources across two files and the route-contract guard's Rule 3 only reads `next.config.ts`. Rejected. |
| Query params for origin | `document.referrer` only / `sessionStorage` breadcrumb | Referrer is not updated on App Router soft navigation and is stripped cross-origin; sessionStorage is invisible to the server render. Query params are server-readable and survive the 308 (request query is passed through). |
| `fetchAndBuildPayload` in tearsheet | Export `buildFactsheetPayloadCached` from `v2/page.tsx` | The wrapper's safety lives in that file's lane decision ("deliberately did NOT move", page.tsx import comment); moving it widens the cache-poisoning surface. Use the uncached builder (precedent: discovery detail, Phase 169.1 D-23). |

**Installation:** none.

## Package Legitimacy Audit

Not applicable: this phase installs no external package. `knip` is an existing devDependency already used by CI.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Old URL (bookmark, shared link, email, in-app stale link)
   /strategy/:id ──────────┐
   /strategy/:id/v2 ───────┤  next.config.ts redirects()  (step 2, before proxy, DB-free)
   /browse/:slug/:sid ─────┤  308  →  /factsheet/:id[?from=browse&cat=:slug][&<original query>]
   /discovery/:slug/:sid ──┘  308  →  /factsheet/:id?from=discovery&cat=:slug[&<original query>]
                                          │
 In-app link (already /factsheet/:id?from=<origin>[&cat=]) ─┤
                                          ▼
                        src/proxy.ts  (/factsheet is PUBLIC + bounce-exempt → pass)
                                          ▼
                 factsheet/[id]/v2/page.tsx  (force-dynamic)
                   1. Lane A: published probe + trust signal (Promise.all)   ← unchanged, FIRST
                   2. miss → getUser → Lane B owner probe → owner | notFound ← unchanged
                   3. payload: Lane A → unstable_cache (viewer-free key) | Lane B → direct build
                   4. NEW: viewer = resolveViewer(getUser [reused], profiles row, signature.user_id)
                   5. NEW: origin = parseOrigin(searchParams)  (closed set; unknown → null)
                   6. showAum (194 D-22, unchanged rule; reuse the same getUser result)
                                          ▼
          render:  <ViewerChrome viewer origin strategyId/>   (outside the cached payload)
                     ├─ anon   → VisitorHeader (wordmark, What is Quantalyze?, Sign up)
                     ├─ signed → ViewerBar: BackLink + actions by role/approval/owner
                     │            allocator(approved, not owner): [Add to my allocation][Request intro]
                     │            owner: [Edit strategy]   manager-only / unapproved: none
                   <FactsheetView payload=withViewerAum(...) beforeFooterSlot={anon ? <SignUpLine/> : null}/>
                     └─ FactsheetBody: masthead → KpiStrip(summary) → ControlBar
                                       → grid[ equity(cumulative + underwaterAcc + one hint) | Main metrics ]
                                       → <details id="factsheet-advanced"> (closed SSR; mounts on first open)
                                       → beforeFooterSlot → FactsheetFooter

 /factsheet-share/:token  (sessionless today; HMAC match is the authorization)
   → same FactsheetView, visitor header + sign-up line (OQ-3 decides whether it reads a session)

 /factsheet/:id/tearsheet  → print layout of the same body (opening view only) + ManagerIdentityPanel (attestation gate)
   ← /api/factsheet/:id/tearsheet.pdf  (Puppeteer goto, cookieless, networkidle0)
 /factsheet/:id            ← /api/factsheet/:id/pdf  (Puppeteer goto, cookieless; used by founder-lp-report cron)
```

### Recommended file layout (new files only)
```
src/lib/factsheet/
├── origin.ts               # closed map from→{label, href}; parseOrigin(searchParams); buildFactsheetHref(id, origin)
├── viewer.ts               # server-only resolveFactsheetViewer(supabase, user, ownerId) → discriminated union
src/app/factsheet/[id]/
├── layout.tsx              # (see Pitfall 9) one <main> for /factsheet/[id] AND /v2 if v2/layout.tsx is removed
src/components/factsheet/   # or colocated under v2/
├── ViewerChrome.tsx        # server: chooses VisitorHeader | ViewerBar
├── ViewerBar.tsx           # header landmark, nav "Back", group "Actions for this strategy"
├── BackLink.tsx            # "use client": named href, or history.back()/"Go to Discovery" fallback
├── VisitorHeader.tsx
└── SignUpLine.tsx
```

### Pattern 1: Config redirect with origin in the destination query
**What:** One `redirects()` entry per old route; manifest row converted to `exception` with an exact-string `redirectFrom`.
**When to use:** All four D-03 routes.
**Example:**
```ts
// Source: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md
//         (permanent → 308; request query passed through) and .../rewrites.md "Rewrite parameters"
//         (params may be placed in the destination query explicitly).
// next.config.ts — append inside the existing `async redirects()` array.
{ source: "/strategy/:id",               destination: "/factsheet/:id",                                 permanent: true },
{ source: "/strategy/:id/v2",            destination: "/factsheet/:id",                                 permanent: true },
{ source: "/browse/:slug/:strategyId",    destination: "/factsheet/:strategyId?from=browse&cat=:slug",    permanent: true },
{ source: "/discovery/:slug/:strategyId", destination: "/factsheet/:strategyId?from=discovery&cat=:slug", permanent: true },
```
The manifest `redirectFrom` values must be byte-identical to these `source` strings: Rule 3 is `redirectSourceSet.has(entry.redirectFrom)` over `source\s*:\s*["']([^"']+)["']` [VERIFIED: scripts/check-route-contract.ts:345 and :427-433, quoted: `return [...body.matchAll(/source\s*:\s*["']([^"']+)["']/g)].map((mm) => mm[1]);` and `if (!redirectSourceSet.has(entry.redirectFrom)) {`]. Precedent rows to copy: the `/scenarios` and `/portfolios` entries [VERIFIED: src/lib/routing/route-contract-manifest.ts:227-233, 252-258: `route: "/portfolios", class: "exception", redirectFrom: "/portfolios/:path*"`]. Rule 4 skips `exception` entries [VERIFIED: scripts/check-route-contract.ts:442 `if (entry.class === "exception") continue;`].

### Pattern 2: Viewer resolved after the lane decision, threaded as a render prop
**What:** Keep `signRes` (Lane A) first; after the payload is known, resolve the viewer once and reuse the `getUser()` result for `showAum`.
**Example:**
```ts
// Source: pattern of factsheet/[id]/v2/page.tsx `showAum` block + requireRolePage/approval predicates.
// AFTER `payloadWithTrust` is built (both lanes):
const viewerUser = lane === "owner" ? { id: ownerUid! } : await getUserOrNull(supabase); // one getUser per request
const viewer = await resolveFactsheetViewer(supabase, viewerUser, signature.user_id);
// viewer: { kind: "anon" } | { kind: "signed_in", isOwner, canAllocate /* role ∈ {allocator,both} && approved */ }
// showAum keeps its own rule (canViewAum, user_app_roles) but takes viewerUser?.id instead of a second getUser.
return (<>
  <ViewerChrome viewer={viewer} origin={parseOrigin(await searchParams)} strategyId={id} />
  <FactsheetView payload={withViewerAum(payloadWithTrust, showAum)} … beforeFooterSlot={viewer.kind === "anon" ? <SignUpLine/> : null} />
</>);
```
The role values: `profiles.role` is the signup set `["manager", "allocator", "both"]` [VERIFIED: src/lib/closed-sets.ts:1152 `export const SIGNUP_ROLES = ["manager", "allocator", "both"] as const;`]; the allocator predicate is `role === "allocator" || role === "both"` [VERIFIED: src/lib/auth/requireRolePage.ts:102-105]. Approval: `isProfileApproved({ role, allocator_status, manager_status, is_admin })` in `src/lib/approval.ts` (read via shell this session; `/api/intro` calls `assertProfileApproved` before its role check) [VERIFIED: codebase read of src/app/api/intro/route.ts and src/lib/api/approval-gate.ts].

### Pattern 3: "Advanced" disclosure
**What:** Native `<details id="factsheet-advanced">`, state via `useCrossTabStorage` with a key under a registered prefix, children rendered only after first open, not subscribed to `COLLAPSIBLE_OPEN_ALL_EVENT`.
**Example:**
```tsx
// Source: idiom of src/components/ui/CollapsibleSection.tsx (useCrossTabStorage + rawStringCodec).
const { value, setValue, isHydrated } = useCrossTabStorage<"open" | "closed">({
  key: "factsheet-collapse:advanced",          // under the registered "factsheet-collapse:" prefix (see Pitfall 6)
  initial: "closed", codec, enabled: true, sentryArea: "factsheet.advanced",
});
const [open, setOpen] = useState(false);       // SSR + first paint: closed
const [everOpened, setEverOpened] = useState(false);
useEffect(() => { if (isHydrated) setOpen(value === "open"); }, [isHydrated, value]);
useEffect(() => { if (open) setEverOpened(true); }, [open]);
return (
  <details id="factsheet-advanced" open={open} onToggle={…persist when hydrated…}>
    <summary …>Advanced · {contentsLine} · {open ? "Hide" : "Show"}</summary>
    {everOpened && <AdvancedContents/>}        {/* closed Advanced renders no chart */}
  </details>
);
```
The `beforeprint` handler in `FactsheetShell` forces every `<details>` open via `document.querySelectorAll<HTMLDetailsElement>("details")` [VERIFIED: codebase read of FactsheetView.tsx `FactsheetShell`]; change the selector to skip `#factsheet-advanced` and, when Advanced is closed, also skip its descendants (they are not mounted anyway). `COLLAPSIBLE_OPEN_ALL_EVENT = "collapsible-section:open-all"` [VERIFIED: src/components/ui/CollapsibleSection.tsx:16].

### Pattern 4: Origin closed set
```ts
// src/lib/factsheet/origin.ts (new). Labels mirror Sidebar.tsx; hrefs are literals, never the raw param.
const ORIGINS = {
  discovery:       { label: "Back to Discovery",       href: (cat?: string) => cat ? `/discovery/${cat}` : DEFAULT_AUTHENTICATED_ROUTE },
  browse:          { label: "Back to Browse",          href: (cat?: string) => cat ? `/browse/${cat}` : "/browse" },
  allocations:     { label: "Back to My allocation",   href: () => "/allocations" },
  "my-strategies": { label: "Back to My Strategies",   href: () => "/my-strategies" },
  strategies:      { label: "Back to Strategies",      href: () => "/strategies" },
  recommendations: { label: "Back to Recommendations", href: () => "/recommendations" },
  admin:           { label: "Back to Admin",           href: () => "/admin" },
} as const;
// `cat` is accepted only if it is a DISCOVERY_CATEGORIES slug.
```
Values used above, verbatim from source: `DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma"` [VERIFIED: src/lib/routing/default-route.ts:8]; slugs `"crypto-sma"`, `"cfd"`, `"emerging-crypto"`, `"crypto-decks"`, `"tradfi-decks"` [VERIFIED: src/lib/constants.ts:359-364]; sidebar labels `"My allocation"` → `"/allocations"`, `"Recommendations"` → `"/recommendations"`, `"My Strategies"` → `"/my-strategies"`, `"Strategies"` → `"/strategies"` [VERIFIED: src/components/layout/Sidebar.tsx:119-120, 140, 155-156, 189]. "Discovery", "Browse", "Admin" labels are UI-SPEC copy, not sidebar items (the sidebar lists discovery categories by name; `/admin` is "Dashboard" in the admin group) [VERIFIED: Sidebar.tsx:110-113, and admin group `{ label: "Dashboard", href: "/admin" }` read via shell].

### Anti-Patterns to Avoid
- **Hoisting `auth.getUser()` above the published probe.** The page comment calls this forbidden; the lane order is what keeps a public render cheap. Resolve the viewer after the lane decision.
- **Putting viewer state into `FactsheetPayload`.** The payload is what the id-keyed `unstable_cache` serves to anonymous readers for 3600 s; any viewer field there is published (T-150-27, `page.public-cache-key.test.tsx`, `phase-148-owner-lane-cache-isolation.test.ts`).
- **Importing `factsheet/[id]/v2/page.tsx` from the share route** (or anything that reaches `buildFactsheetPayloadCached`): `page.no-cache-reach.test.ts` pins SL-1.
- **A `redirect()` inside the old page files.** Runs after the proxy; anon `/discovery/...` would bounce to `/login`.
- **Reflecting `from`/`cat` into an href or into visible text.** Closed-set lookup only.
- **Raw `localStorage` for Advanced.** Use `useCrossTabStorage`; a raw key outside the registered prefixes survives sign-out.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redirects | Middleware/proxy branches or page `redirect()` | `next.config.ts` `redirects()` | Ordering before proxy; Rule 3 lockstep reads only `next.config.ts`. |
| Browser-storage with try/catch | `try { localStorage.getItem… }` | `useCrossTabStorage` | Hydration-safe, fail-loud, cross-tab, Sentry-tagged; registered-prefix purge on sign-out. |
| Role/approval check | New role query semantics | `requireRolePage` predicate (`allocator`/`both`) + `isProfileApproved` | Same truth table `/api/intro` and `/allocations` enforce; a different rule shows a button that 403s. |
| AUM gate | Anything new | `canViewAum` / `withViewerAum` (194 D-22) | Carried decision; reuse the request's `getUser` result. |
| Payload for the tearsheet | Re-derive figures from `strategy_analytics` scalars | `fetchAndBuildPayload(id, withPublishedOnly)` + `FactsheetBody` | One source of truth; the 194 gate lives in the payload path. |
| Dead-code discovery | Manual grep of importers | `npx knip --include files` | Already CI-wired, catches transitive orphans. |
| Retired-link guard | Ad-hoc test | Mirror `src/__tests__/trim-removed-surfaces.test.tsx` (`findRetiredLinks`, comment-stripped source scan) | Proven matcher with red/green self-tests. |

**Key insight:** every hard part of this phase already has a guard in the repo (route-contract, owner-lane cache tests, no-cache-reach, sign-out purge inventory, trim-removed-surfaces). The plans should move those guards deliberately, never route around them.

## Runtime State Inventory

This is a route-retirement phase, so the five categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None keyed on the retired paths. `user_notes` rows with `scope_kind = 'strategy'` are keyed by strategy id, not route, but their ONLY read/write UI is `/strategy/[id]` (`StrategyNoteCard`) [VERIFIED: grep `StrategyNoteCard` → only `src/app/strategy/[id]/page.tsx`]. | No data migration. OQ-6 decides whether the note card moves to the factsheet; otherwise those rows become unreachable (not deleted). |
| Live service config | Emails link to `${APP_URL}/factsheet/${strategyId}` already (`src/lib/email.ts` three sites), not to old routes [VERIFIED: grep]. The founder LP report cron fetches `/api/factsheet/${id}/pdf`, which screenshots `/factsheet/${id}` [VERIFIED: src/app/api/cron/founder-lp-report/route.ts:322, src/app/api/factsheet/[id]/pdf/route.ts:322]. | No external config to change. The cron PDF will now show the opening view only (see Open Question 8). |
| OS-registered state | None: no task scheduler, pm2 or systemd entry references these routes. | None. |
| Secrets/env vars | None reference route paths. | None. |
| Build artifacts / caches | Browsers cache 308s permanently (doc: "instructs clients/search engines to cache the redirect forever"). The Vercel CDN may hold old HTML for the old routes only if they were cached; all four are dynamic today. Search engines indexed `/browse/[slug]/[strategyId]` and `/strategy/[id]` (no `robots: noindex` on either) while `/factsheet/[id]` declares `robots: "noindex"` [VERIFIED: generateMetadata in all three files]. | Accept 308 permanence (same acceptance Phase 164.6.6.3.5 recorded). SEO consequence is Open Question 7. |

## Common Pitfalls

### Pitfall 1: The lane-order lock test asserts zero `getUser` calls on a published render
**What goes wrong:** Any viewer chrome on the public lane needs the session; `page.owner-lane.test.tsx` "10. published id rendered WITH an authed session → ZERO auth.getUser calls" goes red.
**Why it happens:** The test was written to catch a hoist above the published probe, but it encodes "zero" rather than "not first".
**How to avoid:** Rewrite that test in the same plan that adds viewer resolution: assert the published probe ran before any `getUser`, `requestOrFilters` stays `[]`, `unstable_cache` called once, and the viewer prop is absent from the payload. Keep the neuter step (hoist `getUser` above `Promise.all` → RED).
**Warning signs:** A plan that adds `getUser()` near the top of `FactsheetV2Page`.

### Pitfall 2: Exact-href e2e selectors break when links gain `?from=`
**What goes wrong:** `e2e/discovery-watchlist.spec.ts` and `e2e/layout-narrow.spec.ts` select rows with `a[href="/factsheet/${id}"]` (exact) [VERIFIED: grep, e.g. discovery-watchlist.spec.ts:184, 228, 255; layout-narrow.spec.ts:468, 508, 590-592, 616]. `layout-narrow.spec.ts:592` even asserts `toHaveAttribute("href", `/factsheet/${s.id}`)`.
**How to avoid:** Change to prefix selectors `a[href^="/factsheet/${id}"]` and assert the origin explicitly. Phase 197's research flags the same file (its Pitfall 8), so whichever merges second rebases.

### Pitfall 3: A closed `<details>` still mounts its children
**What goes wrong:** Wrapping existing sections in `<details>` does not stop React from rendering every chart; "closed Advanced costs no chart render" is false.
**How to avoid:** Render Advanced children only after first open (`everOpened`), and keep `LazyMount` inside for the heaviest panels.

### Pitfall 4: Two role systems
**What goes wrong:** `canViewAum` decides with `user_app_roles` (`AppRole = "admin" | "allocator" | "quant_manager" | "analyst"`) [VERIFIED: src/lib/auth-types.ts:42], while `/api/intro`, `withAllocatorAuth` and `/allocations` decide with `profiles.role` (`allocator`/`manager`/`both`). The UI-SPEC's "role `allocator` or `both`" is the `profiles.role` vocabulary.
**How to avoid:** Gate the two actions on `profiles.role ∈ {allocator, both}` AND `isProfileApproved`, because that is what the destination endpoints enforce. Leave `canViewAum` unchanged (194 D-22 is carried). Do not merge the two systems here; note the divergence in the plan (Rule 7).
**Warning signs:** "Request intro" visible to a user whose click returns 403 ("Only allocators can request introductions" or the pending-approval error).

### Pitfall 5: The share route is designed sessionless
**What goes wrong:** OQ-3's default (hide "Sign up" for a signed-in token recipient) needs the token page to read cookies. Its header calls it "a PUBLIC, sessionless route" where "THE CONSTANT-TIME HMAC MATCH IS THE AUTHORIZATION" [VERIFIED: src/app/factsheet-share/[token]/page.tsx header].
**How to avoid:** If OQ-3's default is kept: read only `auth.getUser()` (no profile, no owner check) through `createClient()` from `@/lib/supabase/server`, after the token match, use the result for one boolean, never pass it to `fetchAndBuildPayload`, keep `force-dynamic`, and keep the imports free of `next/cache` and of `v2/page.tsx` (`page.no-cache-reach.test.ts`). The security review must accept the change; record it in the plan's threat model.

### Pitfall 6: The UI-SPEC storage key is outside the sign-out purge
**What goes wrong:** `factsheet:advanced-open` matches none of `APP_NAMESPACED_PREFIXES` [VERIFIED: src/lib/storage-namespaces.ts:20-32, quoted: `"quantalyze-"`, `"quantalyze_"`, `"allocations."`, `"widget_state_"`, `"discovery_"`, `"discovery."`, `"admin-compute-"`, `"factsheet-v2:"`, `"factsheet-collapse:"`, `"composer-collapse:"`, `"composer."`], so it survives a shared-device sign-out, and `SignOutButton.test.tsx`'s `KNOWN_APP_KEYS` inventory would not cover it.
**How to avoid:** Use `factsheet-collapse:advanced` (one global key, `"open"`/`"closed"` raw values, same codec family as `CollapsibleSection`). This is a literal deviation from the UI-SPEC; the behaviour (global per viewer, collapsed default) is unchanged. Add the key to `KNOWN_APP_KEYS` if that inventory lists representative keys per prefix.

### Pitfall 7: Back-link "no origin" detection on soft navigation
**What goes wrong:** `document.referrer` is set by the hard load only; App Router `<Link>` navigation does not update it. A factsheet reached by soft navigation without `from` would read a stale referrer.
**How to avoid:** Make "no `from`" impossible from in-app links: every `/factsheet/${…}` href in `src/` carries `from` (enforced by a comment-stripped source scan, allow-listing the tearsheet "Back to factsheet", the share-link builder and emails). The referrer fallback then applies only to hard loads (bookmarks, external links, the two `/strategy` redirects), where it is reliable under the site's `Referrer-Policy: strict-origin-when-cross-origin` [VERIFIED: next.config.ts:264].

### Pitfall 8: Deleting the old routes breaks tests outside their folders
Files outside the route trees that reference them [VERIFIED: grep this session]:
- `src/__tests__/trim-removed-surfaces.test.tsx` — `COUNTS` includes `["src/app/browse/[slug]/[strategyId]/page.tsx", 1]` and an `exists(file)` assertion, plus "the public strategy page's one block is the strategy-page variant".
- `src/lib/complete-status-scan.test.ts` — `"app/strategy/[id]/page.tsx": 1`.
- `src/__tests__/phase-147-series-resolution-guards.test.ts` — reads `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`.
- `src/lib/factsheet/build-payload.headline-source.test.ts` — imports `StrategyDetailPage` from the discovery detail page.
- `src/lib/queries.stale-analytics-detail.test.ts` — groups for `getPublicStrategyDetail` / `getStrategyDetail` (queries may stay; tests move with the orphan sweep).
- `tests/visual/strategy-v2-panel-count.test.tsx`, `tests/visual/strategy-v2-type-scale.test.ts` (also pins `SectionNav` voice).
- `src/__tests__/figure-parity-pages.test.tsx` — renders `TearSheetPage` and pins its `HeroMetric`/`DetailMetric` labels (moves with the tearsheet rebuild).
- e2e that `goto` an old URL: `strategy-v2-axe`, `strategy-v2-chart-parity`, `strategy-v2-keyboard`, `strategy-v2-partial-data`, `axe-app-wide` (`/strategy/[id]/v2` row), `mt5-badge` and `sfox-badge` (`/strategy/${id}` and `/browse/crypto-sma/${id}`), `composite-onboarding` (`/strategy/${id}`). `strategy-detail-tabs` clicks the first discovery row and expects detail tabs; check whether it is already stale before moving it.
Phase 194.1 will add `src/__tests__/figure-gate-census.test.ts` with an allow-list of annualised-figure files; deleting `src/app/strategy/[id]/page.tsx` or `HeadlineMetricsPanel.tsx` may require removing allow-list entries after rebase.

### Pitfall 9: `/factsheet/[id]` has no `<main>` landmark today
**What goes wrong:** `src/app/factsheet/[id]/v2/layout.tsx` adds `<main>` for `/factsheet/[id]/v2` only; `/factsheet/[id]` re-exports the page without that layout, the root layout has no `<main>`, and the share route renders `FactsheetView` without one [VERIFIED: file reads; `src/app/factsheet/[id]/` contains no `layout.tsx`]. The UI-SPEC assumes "the article stays inside the route's `<main>`", and no axe spec scans `/factsheet/[id]` or `/factsheet-share/[token]` (only `/factsheet/[id]/v2` via `composite-factsheet-render.spec.ts`) [VERIFIED: grep e2e].
**How to avoid:** Move the `<main>` to `src/app/factsheet/[id]/layout.tsx` (covers `/factsheet/[id]`, `/v2`; delete `v2/layout.tsx` so `/v2` is not double-wrapped; the tearsheet then also sits inside it, which is fine for a one-landmark page) and wrap the share route's render in `<main>`. Put the viewer bar / visitor header as a `<header>` sibling **before** `<main>` or inside it; axe's `landmark-banner-is-top-level` requires a top-level banner, so render it outside `<main>`. Add axe rows for `/factsheet/[id]` (anon + signed-in) and the share route.

### Pitfall 10: The tearsheet is a different data path with its own disclosure gate
**What goes wrong:** Treating "the tearsheet becomes the print view" as a restyle. Today `TearSheetPage` reads `getFactsheetDetail` (stored scalars), renders `HeroMetric`/`DetailMetric`, gates `ManagerIdentityPanel` on `investor_attestations` (C-0189), reads `readRecordSpan`, `readReturnsUnit`, percentiles, trade facts, and returns a text "Strategy not found." instead of `notFound()` [VERIFIED: tearsheet/page.tsx read]. Five colocated test files and `figure-parity-pages.test.tsx` pin it.
**How to avoid:** Rebuild it as: published-only `fetchAndBuildPayload` → `FactsheetProvider persist={false}` → `FactsheetBody` in a print layout (no ControlBar, no MasterBrush, no Advanced) → keep `ManagerIdentityPanel` and its attestation gate verbatim → keep the Risk Disclosure. The PDF route waits `networkidle0` with a 25 s timeout, which client-rendered charts must meet; test the PDF route on a preview.

### Pitfall 11: Phase 194.1 and 197 edit the same files
See "Cross-phase file overlap" below. The orchestrator note says 196 executes after 194.1 merges, rebased on main.

## Cross-phase file overlap (cite by symbol; re-resolve at plan time)

| File | 196 change | 194.1 (feat/194.1-d04sweep, RESEARCH "Plan split") | 197 (feat/197-screen) | 198 |
|------|-----------|------|-----|-----|
| `src/app/factsheet/[id]/v2/page.tsx` | viewer resolution, chrome, searchParams | plan 02: one `ogImage` line in `generateMetadata` | — | — |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` | Bootstrap panel: drop Point column + "Bootstrap resamples are drawn…" line | named as "not 194.1's" in its research; orchestrator says 194.1 touches it | — | — |
| `src/app/strategy/[id]/page.tsx` | deleted | plan 14 (B1), 196-conditional | — | — |
| `src/components/strategy-v2/HeadlineMetricsPanel.tsx`, `RollingMetricsPanel.tsx`, `ExposureAndGreeksPanel.tsx`, `BenchmarkGreeksTable.tsx`, `StrategyV2Shell.tsx`, `queries.ts` `getStrategyDetailV2` | orphaned → orphan sweep | plans 12-13 (B2, D-11), 196-conditional | — | — |
| `src/app/(dashboard)/recommendations/page.tsx` | `viewHref` gains `from=recommendations` | plan 04 (B5) | — | — |
| `.../wizard/steps/SyncPreviewStep.tsx`, `CsvSubmitStep.tsx` | factsheet links `/factsheet/${id}/v2` → `/factsheet/${id}?from=my-strategies` | plan 05 (B6) edits SyncPreviewStep | — | — |
| `src/components/admin/AdminTabs.tsx` | link gains `from=admin` | plan 10 (B12a) | — | — |
| `ScenarioComposer.tsx` | link gains `from=allocations` (+ OQ-4 if Advanced applies) | plan 07 (B8), one hunk | — | edits it |
| `src/components/portfolio/PortfolioOptimizer.tsx` | link gains `from=allocations` | in its patterns list | — | — |
| `src/components/landing/VerificationResults.tsx` | `/strategy/${id}` → factsheet | B13 marked DEAD (no mount) | — | — |
| `src/components/strategy/StrategyTable.tsx`, `StrategyGrid.tsx` | origin prop; grid link `${basePath}/${categorySlug}/${id}` → factsheet | none | edits Strategy cell, headers | — |
| `src/app/browse/[slug]/page.tsx` | hide sign-up box with session; pass origin | — | edits | — |
| `e2e/layout-narrow.spec.ts` | prefix selectors | — | edits | — |
| `AllocationDashboardV2.tsx`, `ScenarioFactsheetChart.tsx` | only if OQ-4 default kept | — | — | reshapes Overview |

**Recommendation for 194.1:** its plans 12, 13, 14 should skip (record the skip in 194.1's CONTEXT and ROADMAP per its own sequencing note), because 196 removes the only route that renders those files. If 194.1 executes them anyway, 196's orphan sweep deletes them.

## Code Examples

### Redirect unit test (vitest, mirrors `src/__tests__/legacy-host-redirect.test.ts`)
```ts
// Source: src/__tests__/legacy-host-redirect.test.ts pattern (imports next.config and calls redirects()).
import nextConfig from "../../next.config";
it("each retired strategy route 308s to the factsheet with its origin", async () => {
  const rules = (await nextConfig.redirects!()) as Array<{ source: string; destination: string; permanent?: boolean }>;
  const by = Object.fromEntries(rules.map((r) => [r.source, r]));
  expect(by["/discovery/:slug/:strategyId"]).toMatchObject({ destination: "/factsheet/:strategyId?from=discovery&cat=:slug", permanent: true });
  // … the other three
});
```

### First-hop e2e canary (extends `e2e/route-redirects.spec.ts`)
```ts
// Source: e2e/route-redirects.spec.ts existing tests.
const res = await request.get("/discovery/crypto-sma/x?share=1", { maxRedirects: 0 });
expect(res.status()).toBe(308);
const loc = res.headers()["location"] ?? "";
expect(loc).toContain("/factsheet/x");
expect(loc).toContain("from=discovery");
expect(loc).toContain("cat=crypto-sma");
expect(loc).toContain("share=1");           // request query passed through (doc claim, probe it)
expect(loc).not.toContain("/login");         // #512 class
```
This e2e probe is the falsification step for the destination-query mapping, which the docs state for rewrites and show for redirects only via a `has` capture (`/home?authorized=:authorized`).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Proxy file named `middleware.ts` | `src/proxy.ts` exporting `proxy` (Next 16) | Next 16 | The UI-SPEC's "runs before `src/proxy.ts`" is the doc's execution order step 2 (`redirects`) before step 3 (Proxy) [CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md "Execution order"]. |
| In-page `redirect()` stub for a moved route | Config `redirects()` + manifest `exception` + `redirectFrom` | Phase 51 NAV-01 | Use for all four routes. |

**Deprecated/outdated in this phase:**
- `SectionNav`: removed (its anchors would point into a collapsed disclosure).
- `/strategy/[id]/v2` 7-panel shell (`StrategyV2Shell`): its unique panels (Trades & positions, Exposure & greeks) have no factsheet equivalent; they become unreachable (Open Question 9).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `supabase.auth.getUser()` with no session cookie returns `{ user: null }` without a network call, so the anonymous public render stays cheap. | Pattern 2 | Every anonymous factsheet render pays one Auth round trip; perf only, not correctness. Measure in the plan. |
| A2 | Puppeteer `page.pdf()` renders with print media, so `factsheet-v2-no-print` chrome is hidden in both PDF routes. | Pitfall 10, Open Q 8 | Visitor header / sign-up line appear in the PDFs. Verify on a preview PDF. |
| A3 | Puppeteer `page.pdf()` does not fire `beforeprint`, so Advanced's state in the PDF is simply its SSR/storage state (closed for a cookieless render). | Open Q 8 | If it fires, the current handler would open every section; the 196 handler skips Advanced either way. |
| A4 | Destination-query interpolation (`?cat=:slug`) works for `redirects()` the same way the rewrites doc describes. | Pattern 1 | Redirect lands without `cat`; back link falls back to `/discovery/crypto-sma`. The e2e canary falsifies it. |
| A5 | Vercel preview deployments of the PR can be used for the after-census and PDF check. Which database a preview reads is unknown. | Census | After-census waits for PROD deploy. |
| A6 | A slug with an encoded `&` in an old URL could inject an extra query key into the destination; harmless because `from`/`cat` are closed-set validated. | Security | None beyond a wrong back label; validated server-side. |

## Open Questions

1. **OQ-1 (summary line = KPI strip).** Fact: the KPI strip already sits under the masthead and above the grid in `FactsheetBody` and carries the shared figure-gate note slot (`data-testid="strip-figure-gate-note"`). Default is cheap. Recommendation: keep the default.
2. **OQ-2 (comparator figure under each strip cell).** Fact: the rail's Main Metrics bench column today reads `hb` from `headlineBenchSource(...)` in `MetricsColumn.tsx`; the strip would need the same source. `FactsheetView.kpistrip.test.tsx` (1,125 lines) and `MetricsColumn.headline-bench.test.tsx` pin current placement. Recommendation: keep the default; export `headlineBenchSource` (or a hook over it) rather than re-deriving, so the comparator value passes the same 194 gate.
3. **OQ-3 (signed-in token recipient).** Facts in Pitfall 5. Cost of the default: one `createClient()` + `getUser()` on the token lane, a security-review acceptance, no cache implication (the lane is `force-dynamic` and has no cache reach). Recommendation: keep the default, scoped to one boolean.
4. **OQ-4 (Advanced on allocator mounts).** Facts: `FactsheetBody` is mounted by `FactsheetView` (factsheet + share route + discovery detail, the last removed by this phase), `AllocationDashboardV2` (My allocation Overview, `hideHeader hideFooter topSlot`) and `ScenarioFactsheetChart` (composer, `scenarioMode`). 62 test files mention `FactsheetBody`; 23 test files under `allocations/` reference `AllocationDashboardV2` or `ScenarioFactsheetChart` (grep count; not every one asserts on factsheet panels); `e2e/composer-axe.spec.ts` gates on `#factsheet-main` (still present either way). Phase 198 is reshaping the Overview tab. Recommendation: put the opening view + Advanced behind a `layout?: "document" | "full"` prop on `FactsheetBody`, `"document"` for `FactsheetView`, and decide the allocator default with the founder; if the UI-SPEC default stands, sequence that plan after 198 merges.
5. **OQ-5 (Add before 198).** Fact: `/allocations` reads only `?tab=`; an unknown `add` is ignored; `/allocations` requires `profiles.role ∈ {allocator, both}` via `requireRolePage(…, "allocator")`, so the link must be shown only to that role. Recommendation: ship the link; it degrades to "lands on My allocation".
6. **OQ-6 (strategy notes).** Facts: `StrategyNoteCard` is a client component with props `{ strategyId, initialContent, initialLastSavedAt }`, writes through `/api/notes` (`scope_kind: "strategy"`), and its initial content is a per-viewer `user_notes` read by `(user_id, scope_kind, scope_ref)`. Its docblock says the ownership predicate is "strategies.status = 'published'". Mount point: a server-built `ReactNode` slot on `FactsheetBody` after the Advanced row, published lane, signed-in viewers only, `factsheet-v2-no-print`; the read joins the viewer resolution (same `getUser`). Recommendation: keep the default (do not silently drop a write surface).
7. **SEO (new).** `/browse/[slug]/[strategyId]` and `/strategy/[id]` are indexable; `/factsheet/[id]` is `robots: "noindex"`. The 308s move search traffic onto a noindex page, which drops published strategy pages from search over time. Needs a founder call: accept, or drop `noindex` on the published lane only (owner/unpublished and token lanes stay noindex).
8. **Founder LP report PDF (new).** `/api/factsheet/[id]/pdf` screenshots `/factsheet/[id]` cookieless; after D-04 it prints the opening view only. If the LP report should stay full-length, the route needs a print-all mode (e.g. a server-only flag that renders Advanced open), which is new scope.
9. **Lost `/strategy/[id]/v2` panels (new).** Trades & positions and Exposure & greeks render only in `StrategyV2Shell`. D-03 retires the route; nothing in D-04 brings them to the factsheet. Recommendation: record the loss in the plan and the CHANGELOG; route any revival to a later phase.
10. **Discovery detail extras (OQ-7).** Facts: the discovery page renders `ShareableLink`, a disclosure-gated "Tear Sheet" link, `BookIntroCall` and two `RequestIntroButton`s (header + sticky footer). The factsheet ControlBar already has its own share control. Recommendation: keep the default (Print view link replaces Tear Sheet; Book Intro Call dropped) and say so in the CHANGELOG.
11. **`/browse` root CTA (new).** `src/app/browse/page.tsx` renders "Want full analytics and introductions?" / "Get Started Free" → `/signup`; the UI-SPEC lists only the layout and `[slug]` prompts. ROUTE-02 says "never … on `/browse`", so it must also hide with a session.
12. **"Go to Discovery" for a manager-only user.** `/discovery/*` requires `profiles.role ∈ {allocator, both}` (layout `requireRolePage`), so a manager is bounced to `/strategies`. Harmless but indirect; the planner may point the fallback at the role home instead.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build, vitest, tsx | ✓ | v25.8.1 (engines `>=22`, `.nvmrc` 22) | — |
| npm | install | ✓ | 11.11.0 | — |
| `node_modules` in this worktree | every test/lint/build command | ✗ | — | `npm ci` in the worktree (executor pre-step) |
| Next docs (`node_modules/next/dist/docs`) | AGENTS.md rule | ✓ in main checkout only (16.4.2, matches lockfile) | 16.4.2 | read after `npm ci` in the worktree |
| Playwright browsers | e2e redirect canary, census script | not probed | — | run in CI `e2e` job |
| PROD read (census "before") | SC-5 | via MCP / anonymous HTTP to the public site | — | jsdom render of `FactsheetView` over fixture payloads (weaker: not "named strategies") |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `node_modules` (`npm ci`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (two projects: jsdom default, node for `NODE_ENV_TEST_FILES`), Playwright for e2e |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run "src/app/factsheet" "src/app/factsheet-share" src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx && npm run check:route-contract` |
| Full suite command | `npm run lint && npm test` (coverage thresholds are enforced in CI's merged `frontend-coverage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEAN-02 | Four `redirects()` rules, 308, destination with origin | unit | `npx vitest run src/__tests__/strategy-route-redirects.test.ts` | ❌ Wave 0 |
| LEAN-02 | Manifest lockstep (Rule 3/4) | lint | `npm run check:route-contract` | ✅ |
| LEAN-02 | First hop 308, `Location` has origin + passed-through query, never `/login` | e2e | `npx playwright test e2e/route-redirects.spec.ts` | ✅ extend |
| LEAN-02 | No in-app href targets a retired route; every factsheet link carries `from` | source scan | `npx vitest run src/__tests__/one-strategy-page-links.test.ts` | ❌ Wave 0 |
| LEAN-02 | Tearsheet renders the opening view from the payload; attestation gate kept | component | `npx vitest run "src/app/factsheet/[id]/tearsheet"` | ✅ rewrite |
| ROUTE-02 | `/browse` layout, root page and `[slug]` render no "Sign up"/"Get Started Free" with a session; unchanged without | component | `npx vitest run src/app/browse` | ✅ extend (`page.test.tsx`, `breadcrumb-root.test.tsx`) |
| ROUTE-02 | Owner opens own unpublished; anon after still 404; cache invoked 0× on owner | integration | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"` | ✅ (lane-order test rewritten, Pitfall 1) |
| ROUTE-04 | Viewer matrix: anon → visitor header + sign-up line; allocator → 2 actions; owner → Edit only; manager/unapproved → none; never "Sign up" with a session | integration | `npx vitest run "src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx"` | ❌ Wave 0 |
| ROUTE-04 | Viewer data never enters the payload / cache | integration | same file + `page.public-cache-key.test.tsx` | ❌ / ✅ |
| ROUTE-04 | Back link: closed set, unknown `from`/`cat` → no origin, never off-site | unit | `npx vitest run src/lib/factsheet/origin.test.ts` | ❌ Wave 0 |
| ROUTE-04 | Share route: visitor header + sign-up line; no outbound app links; AUM stripped; no cache reach | integration | `npx vitest run "src/app/factsheet-share/[token]"` | ✅ extend |
| LEAN-05 | Opening view = strip + equity (2 charts) + Main metrics + Advanced row; Advanced closed by default, not opened by Reset view, state stored under `factsheet-collapse:` | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx"` | ❌ Wave 0 |
| LEAN-05 | Zero repeated metrics (closed and open), one visible hint, ≤1 small-sample warning, no "— on request" row, empty sections absent | component census | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx"` | ❌ Wave 0 |
| LEAN-05 | Print: Advanced prints as left; `beforeprint` skips `#factsheet-advanced` | component | same advanced test file | ❌ Wave 0 |
| SC-5 | Before/after counts on three named strategies, print + share | scripted census | committed script (Playwright or jsdom), output in `196-CENSUS.md` | ❌ Wave 0 |

Every new gate needs its neuter → RED → restore evidence (e.g. drop one redirect rule → unit + e2e RED; put `viewer` on the payload → cache-isolation RED; remove the `everOpened` guard → "no chart when closed" RED).

### Sampling Rate
- **Per task commit:** the quick run command plus the specific new test file.
- **Per wave merge:** `npm run lint && npm test`.
- **Phase gate:** full suite green and the e2e redirect canary green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `196-CENSUS.md` "before" counts, measured BEFORE any layout change merges (the before state disappears on deploy).
- [ ] `src/__tests__/strategy-route-redirects.test.ts` — LEAN-02 rules.
- [ ] `src/__tests__/one-strategy-page-links.test.ts` — retired-link + `from` source scan (mirror `trim-removed-surfaces.test.tsx`'s matcher and its red/green self-tests).
- [ ] `src/lib/factsheet/origin.test.ts`.
- [ ] `src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx` — reuse the owner-lane harness (spy `unstable_cache`, real `withPublishedOnly`).
- [ ] `FactsheetBody.advanced.test.tsx`, `FactsheetBody.census.test.tsx`.
- [ ] `npm ci` in the worktree.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (read-only) | `auth.getUser()` (server-validated), never `getSession()` for decisions |
| V3 Session Management | no change | existing Supabase SSR cookies |
| V4 Access Control | yes | Owner chrome and owner lane keyed on the SESSION user id, never params/searchParams (T-148-02); action visibility mirrors `/api/intro` + `requireRolePage` predicates; endpoints keep their own gates |
| V5 Input Validation | yes | `from`/`cat` closed-set lookup; `cat` ∈ `DISCOVERY_CATEGORIES`; `?add=` built from the server strategy id |
| V6 Cryptography | no | share-token HMAC untouched |
| V8 Data Protection | yes | Viewer state, note content, AUM are per-request render props; never in `FactsheetPayload` (T-150-27); share route keeps `withViewerAum(payload, false)` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cache poisoning of the id-keyed payload with viewer data | Information disclosure | Viewer resolution after lane decision; render props only; extend `page.public-cache-key.test.tsx` |
| Existence oracle via redirects | Information disclosure | Redirects are DB-free; destination decides (published render / owner lane / identical not-found) |
| Open redirect via origin param | Spoofing | Closed map; raw value never an href; history fallback same-origin only |
| Unapproved user sees allocator actions | Elevation (UI) | Gate on role + `isProfileApproved`; APIs re-check |
| Token lane reading a session (OQ-3) | Information disclosure | One boolean; no profile read; never passed to the builder; no `next/cache` import; security review sign-off |
| Disclosure-tier bypass via tearsheet rebuild | Information disclosure | Keep the `investor_attestations` gate for `ManagerIdentityPanel` verbatim; PDF stays cookieless |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md` (Next 16.4.2, main checkout, version matches worktree lockfile) — 308 for `permanent: true`, query pass-through, path matching, `has`-capture in destination query.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` "Execution order" — `redirects` (2) before Proxy (3).
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md` "Rewrite parameters" — explicit params in destination query.
- Codebase at worktree HEAD `bdae8527c`: `next.config.ts`, `src/proxy.ts`, `src/lib/routing/route-contract-manifest.ts`, `scripts/check-route-contract.ts`, `src/app/factsheet/[id]/v2/{page,FactsheetView,MetricsColumn,chart-configs,LazyMount,layout}.tsx`, `src/app/factsheet-share/[token]/page.tsx`, `src/app/factsheet/[id]/tearsheet/page.tsx`, `src/app/api/factsheet/[id]/{pdf,tearsheet.pdf}/route.ts`, `src/app/strategy/[id]/{page,v2/page}.tsx`, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/app/(dashboard)/discovery/layout.tsx`, `src/app/browse/{layout,page,[slug]/page}.tsx`, `src/components/strategy/{StrategyTable,StrategyGrid,RequestIntroButton}.tsx`, `src/components/notes/StrategyNoteCard.tsx`, `src/components/ui/CollapsibleSection.tsx`, `src/lib/{storage-namespaces,constants,closed-sets,auth-types,approval}.ts`, `src/lib/auth/requireRolePage.ts`, `src/lib/factsheet/viewer-aum.ts`, `src/app/api/intro/route.ts`, `src/components/layout/Sidebar.tsx`, `e2e/route-redirects.spec.ts`, `src/__tests__/legacy-host-redirect.test.ts`, `src/__tests__/trim-removed-surfaces.test.tsx`, `page.owner-lane.test.tsx`.
- Sibling branches read via `git show`: `feat/194.1-d04sweep` (194.1-RESEARCH.md, 194.1-PATTERNS.md), `feat/197-screen` (197-CONTEXT.md, 197-RESEARCH.md), `feat/198-mybook` (198-CONTEXT.md).

### Secondary (MEDIUM confidence)
- None external; no web search was needed (all facts are in-repo or in the installed Next docs).

### Tertiary (LOW confidence)
- Supabase `getUser()` no-network behaviour without a session; Puppeteer `page.pdf()` print media / `beforeprint` behaviour (Assumptions A1-A3).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every module read in the repo.
- Architecture: HIGH for routing and cache isolation (guards and precedents read); MEDIUM for the tearsheet rebuild cost.
- Pitfalls: HIGH — each tied to a named file or test read this session.

**Research date:** 2026-11-08
**Valid until:** 2026-11-15 (three sibling phases are editing overlapping files; re-resolve anchors by symbol at plan time)
