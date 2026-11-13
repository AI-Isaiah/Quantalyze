# Phase 196: ONESTRATEGYPAGE - Pattern Map

**Mapped:** 2026-11-08
**Files analyzed:** 24 (new + modified + test)
**Analogs found:** 22 / 24

Citation rule: files shared with Phase 194.1 (executing in parallel) are cited BY SYMBOL. Line numbers below are given only for files 194.1 does not touch, and they are anchors at worktree HEAD; re-resolve with `grep -n` at plan time.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `next.config.ts` (4 new `redirects()` rows, D-03) | config | request-response | the Phase 195 `/portfolios/:path*` rule in the same array | exact |
| `src/lib/routing/route-contract-manifest.ts` (4 rows to `exception`) | config | static manifest | the `/portfolios` and `/scenarios` exception rows | exact |
| `src/__tests__/strategy-route-redirects.test.ts` (new) | test | config read | `src/__tests__/legacy-host-redirect.test.ts` + `hasRedirectRule` in `trim-removed-surfaces.test.tsx` | exact |
| `e2e/route-redirects.spec.ts` (extend) | test (e2e) | request-response | its own Phase 195 `/portfolios` block | exact |
| `src/__tests__/one-strategy-page-links.test.ts` (new) | test | source scan | `src/__tests__/trim-removed-surfaces.test.tsx` (`RETIRED_LINKS`, `findRetiredLinks`, self-tests) | exact |
| `src/lib/factsheet/origin.ts` (new) + `origin.test.ts` | utility | transform (closed set) | `src/lib/closed-sets.ts` closed-set idiom; constants from `src/lib/constants.ts` `DISCOVERY_CATEGORIES`, `src/lib/routing/default-route.ts` | role-match |
| `src/lib/factsheet/viewer.ts` (new, server-only) | service | request-response | `src/lib/factsheet/viewer-aum.ts` (`canViewAum`) + `src/lib/auth/requireRolePage.ts` allocator predicate + `src/lib/approval.ts` `isProfileApproved` | role-match |
| `src/app/factsheet/[id]/v2/page.tsx` (viewer chrome, searchParams, robots per lane, print-all) | route/page | request-response | itself: `generateMetadata`, the `showAum` block, the Lane A/B order in `FactsheetV2Page` | self (shared with 194.1: by symbol) |
| `src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx` (new) + rewrite of owner-lane test "published id … ZERO getUser" arm | test | request-response | `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx`, `page.public-cache-key.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/page.metadata.test.tsx` (extend, D-07) | test | request-response | itself | exact |
| `src/app/factsheet/[id]/layout.tsx` (new, `<main>`) / delete `v2/layout.tsx` | layout | render | `src/app/factsheet/[id]/v2/layout.tsx` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`FactsheetBody layout` prop, `FactsheetShell` beforeprint selector, slots) | component | render | itself (`FactsheetShell` beforeprint handler) | self (shared with 194.1: by symbol) |
| `AdvancedDisclosure.tsx` (new, client) | component | event-driven (storage) | `src/components/ui/CollapsibleSection.tsx` | exact |
| `ViewerChrome.tsx`, `ViewerBar.tsx`, `VisitorHeader.tsx`, `SignUpLine.tsx` (new) | component | render | `src/app/browse/layout.tsx` (visitor header / sign-up CTA), `src/components/strategy/RequestIntroButton.tsx` | role-match |
| `BackLink.tsx` (new, client) | component | event-driven | none exact (history fallback) | no analog |
| `src/app/factsheet-share/[token]/page.tsx` (slim header, `<main>`, session boolean) | route/page | request-response | itself | self |
| `src/app/api/factsheet/[id]/pdf/route.ts` (server-only print-all, D-08) | route (API) | request-response / file-I/O | itself: `x-internal-token` gate + `PDF_RENDERER_USER_AGENT` stamping | self |
| `src/app/factsheet/[id]/tearsheet/page.tsx` (print view, uncached builder) | route/page | request-response | `src/app/factsheet-share/[token]/page.tsx` (calls `fetchAndBuildPayload` uncached) | role-match |
| `src/lib/storage-namespaces.ts` / `SignOutButton.test.tsx` `KNOWN_APP_KEYS` | config / test | static | the existing `factsheet-collapse:` prefix entry | exact (no new prefix needed) |
| Link sites gaining `?from=` (`StrategyTable.tsx`, `StrategyGrid.tsx`, `recommendations/page.tsx`, `AdminTabs.tsx`, `PortfolioOptimizer.tsx`, browse pages) | component | render | each file's existing `/factsheet/${id}` href | self |
| e2e selectors (`discovery-watchlist.spec.ts`, `layout-narrow.spec.ts`) | test (e2e) | — | — | change exact `a[href="…"]` to prefix `a[href^="…"]` |
| Deletions: `src/app/strategy/[id]/page.tsx`, `strategy/[id]/v2`, `browse/[slug]/[strategyId]`, `(dashboard)/discovery/[slug]/[strategyId]` + test fallout (RESEARCH Pitfall 8) | — | — | Phase 195 deletions of `/portfolios` pages | role-match |
| `StrategyNoteCard` mount on the factsheet (OQ-6) | component | CRUD | current mount in `src/app/strategy/[id]/page.tsx` | exact |
| `AddToPortfolio` href to `/allocations?add=<id>` (D-02) | component | render | none beyond its own link | self |

## Pattern Assignments

### `next.config.ts` (config, request-response)

**Analog:** the last entry of `async redirects()` (Phase 195 TRIM D-01):
```ts
      // Phase 195 TRIM (D-01), 2026-11-07: the portfolios surface is retired;
      // every sub-route, including the bare path and the dead strategies/<id>
      // target, lands on My allocation. Stored rows kept. Lockstep with the
      // manifest redirectFrom (#512).
      {
        source: "/portfolios/:path*",
        destination: "/allocations",
        permanent: true,
      },
```
Copy: one dated comment naming the phase + decision (D-03) and "Lockstep with the manifest redirectFrom (#512)", then the four rows from RESEARCH Pattern 1. Keep the literal key order `source`, `destination`, `permanent` on separate lines: `hasRedirectRule` (below) regex-matches exactly `source:\s*"…",\s*destination:\s*"…",\s*permanent:\s*true`. Re-read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md` before editing (AGENTS.md).

### `src/lib/routing/route-contract-manifest.ts` (config)

**Analog:** the `/portfolios` row:
```ts
  {
    route: "/portfolios",
    class: "exception",
    redirectFrom: "/portfolios/:path*",
    notes:
      "RETIRED 2026-11-07 (Phase 195 D-01): config-level 308 to /allocations for every sub-route; no backing page; stored portfolios and portfolio_strategies rows kept",
  },
```
`redirectFrom` must be byte-identical to the config `source` (`scripts/check-route-contract.ts` Rule 3: `redirectSourceSet.has(entry.redirectFrom)`); Rule 4 skips `exception` rows. Notes say "RETIRED 2026-11-08 (Phase 196 D-03): config-level 308 to /factsheet/[id]; no backing page".

### `src/__tests__/strategy-route-redirects.test.ts` (test, new)

**Analog A:** `src/__tests__/legacy-host-redirect.test.ts` lines 1-40 (import of config and the rule type):
```ts
import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";
type RedirectRule = { source: string; destination: string; permanent?: boolean;
  has?: Array<{ type: string; key?: string; value?: string }>; missing?: Array<…> };
const rules = (await nextConfig.redirects!()) as RedirectRule[];
```
Open with a WHY doc comment as that file does (what the test proves, what it does NOT prove: the live 308 is the e2e canary's job).

**Analog B (source-level lockstep):** `hasRedirectRule` in `src/__tests__/trim-removed-surfaces.test.tsx`:
```ts
function hasRedirectRule(stripped: string, source: string, destination: string, permanent: boolean): boolean {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `source:\\s*"${esc(source)}",\\s*destination:\\s*"${esc(destination)}",\\s*permanent:\\s*${permanent}\\b`,
  ).test(stripped);
}
```
Also assert each manifest row is `exception` with matching `redirectFrom`.

### `e2e/route-redirects.spec.ts` (e2e, extend)

**Analog:** its own Phase 195 block (search `Phase 195 TRIM (D-01)` in the file; it iterates `"/portfolios"`, `"/portfolios/x"`). Copy the `request.get(path, { maxRedirects: 0 })` + `status() === 308` + `location` assertions; add the RESEARCH "First-hop e2e canary" (`from=`, `cat=`, passthrough `share=1`, `not.toContain("/login")`). This probe falsifies the destination-query mapping claim.

### `src/__tests__/one-strategy-page-links.test.ts` (test, source scan, new)

**Analog:** `src/__tests__/trim-removed-surfaces.test.tsx`. Copy wholesale:
- import `stripCommentsPreserveLines` from `@/lib/source-scan`; helpers `read`, `code`, `isTestPath`, `listSourceFiles`.
- `RETIRED_LINKS` table of `{ re, label, d }` with the boundary idiom `/(?:["'`]|\})\/decks(?![\w-])/`. New rows: `/strategy/` + id template, `/browse/${…}/${…}`, `/discovery/${…}/${…}` detail shapes (careful: `/discovery/${slug}` category links stay legal — anchor on the second segment).
- `findRetiredLinks`:
```ts
function findRetiredLinks(source: string, file: string): Array<Hit & { d: string; label: string }> {
  const stripped = stripCommentsPreserveLines(source, "ts");
  const hits: Array<Hit & { d: string; label: string }> = [];
  stripped.split("\n").forEach((text, i) => {
    for (const r of RETIRED_LINKS) {
      if (r.re.test(text)) hits.push({ file, line: i + 1, text: text.trim(), d: r.d, label: r.label });
    }
  });
  return hits;
}
```
- red/green self-tests first (`expect(findRetiredLinks('<a href="/portfolios/x" />\n', "s.tsx").map(h => h.d)).toEqual(["D-01"])` shape), then the corpus scan. Add a `from=` presence check on the named link sites with `findNeedles`.
- ⚠️ `trim-removed-surfaces.test.tsx` itself must be edited: its `COUNTS` row for `src/app/browse/[slug]/[strategyId]/page.tsx` and `exists(file)` assertion break on deletion (RESEARCH Pitfall 8).

### `src/lib/factsheet/origin.ts` (utility, closed set, new)

Use RESEARCH Pattern 4 verbatim. Constants by symbol: `DEFAULT_AUTHENTICATED_ROUTE` (`src/lib/routing/default-route.ts`), `DISCOVERY_CATEGORIES` slugs (`src/lib/constants.ts`). Closed-set style follows `src/lib/closed-sets.ts` (`as const` tuple, e.g. `SIGNUP_ROLES = ["manager", "allocator", "both"] as const`). Hrefs are literals; the raw param never reaches an href; `cat` accepted only if in `DISCOVERY_CATEGORIES`. Test: unknown `from`, `from` array, hostile `cat` (`//evil`, `../`) all yield null.

### `src/lib/factsheet/viewer.ts` (service, server-only, new)

**Analogs:** `canViewAum` / `withViewerAum` in `src/lib/factsheet/viewer-aum.ts`; allocator predicate `role === "allocator" || role === "both"` in `src/lib/auth/requireRolePage.ts`; `isProfileApproved({ role, allocator_status, manager_status, is_admin })` in `src/lib/approval.ts` (the same check `/api/intro` enforces via `assertProfileApproved`). Start with `import "server-only";`. Return a discriminated union (RESEARCH Pattern 2). Do NOT merge with `user_app_roles` (Pitfall 4; Rule 7 note in plan).

### `src/app/factsheet/[id]/v2/page.tsx` (page; SHARED WITH 194.1 — by symbol)

- **Lane order:** keep the published probe (`signRes`, Lane A) first in `FactsheetV2Page`; resolve the viewer AFTER `payloadWithTrust` is built; reuse the one `getUser()` for the `showAum` block. Never put viewer fields on `FactsheetPayload` (id-keyed `unstable_cache`, 3600 s).
- **Robots per lane (D-07):** `generateMetadata` currently returns `{ title: \`${name} factsheet\`, robots: "noindex", openGraph… }`. Change to `robots` conditional on the published lane only (drop the key, or `{ index: true }`), keep `"noindex"` for owner/unpublished. 194.1 plan 02 adds one `ogImage` line in the same function — rebase-merge, don't rewrite the function. Extend `page.metadata.test.tsx` with one arm per lane.
- **Share route keeps** `export const metadata: Metadata = { title: "Factsheet", description: "A privately shared strategy factsheet.", robots: "noindex" };` in `src/app/factsheet-share/[token]/page.tsx` — unchanged.
- **Print-all (D-08):** see PDF section; the page reads the server-only signal via `headers()`, never `searchParams`.

### Viewer-chrome test (`page.viewer-chrome.test.tsx`, new) and owner-lane rewrite

**Analog:** `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` mock harness:
```ts
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({ … }));
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),   // SPY, not identity
}));
vi.mock("@/lib/visibility", async () => { … real withPublishedOnly … });
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const getUserSpy = vi.fn();   // auth: { getUser: getUserSpy }
```
Its arms are numbered (`it("4. owner render invokes unstable_cache 0 times; a public render invokes it exactly 1 time"`, …). Rewrite the arm encoding "zero getUser on a published render" (Pitfall 1) to: probe ran before any `getUser`, `.or` filters `[]`, `unstable_cache` called once, viewer absent from payload. Keep the neuter (hoist `getUser` above `Promise.all` → RED). Also re-run `page.public-cache-key.test.tsx` and `phase-148-owner-lane-cache-isolation.test.ts` unchanged.

### `src/app/factsheet/[id]/layout.tsx` (new) / delete `v2/layout.tsx`

**Analog:** `src/app/factsheet/[id]/v2/layout.tsx` (its `<main>` wrapper) — move it up one level (Pitfall 9). Header/banner renders as a sibling before `<main>` (axe `landmark-banner-is-top-level`). Add axe rows to the e2e spec analog `composite-factsheet-render.spec.ts`.

### `FactsheetView.tsx` (SHARED WITH 194.1 — by symbol)

- `FactsheetBody` gains `layout: "document" | "full"` (OQ-4); allocator mounts pass `"full"`.
- `FactsheetShell` beforeprint handler today:
```ts
    // beforeprint forces every detail open; afterprint restores prior state.
    const beforeprint = () => {
      document.querySelectorAll<HTMLDetailsElement>("details").forEach(el => { … });
```
Change the selector to exclude `#factsheet-advanced` and its descendants (afterprint mirror too). In print-all mode Advanced is server-rendered open, so no handler is involved.

### `AdvancedDisclosure.tsx` (component, storage, new)

**Analog:** `src/components/ui/CollapsibleSection.tsx`:
```ts
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";
…
  const codec = useMemo(
    () =>
      rawStringCodec<OpenState>({
        parse: (raw) =>
          raw === "closed" ? "closed" : raw === "open" ? "open" : defaultOpen ? "open" : "closed",
        serialize: (v) => v,
      }),
    [defaultOpen],
  );
  const { value: persistedOpen, setValue: setPersistedOpen, isHydrated: hydrated } =
    useCrossTabStorage<OpenState>({ … });
```
Key `factsheet-collapse:advanced` — under the already registered `"factsheet-collapse:"` entry of `APP_NAMESPACED_PREFIXES` (`src/lib/storage-namespaces.ts`), so the sign-out purge covers it with no new prefix. Add the key to `KNOWN_APP_KEYS` in `SignOutButton.test.tsx` (that test asserts every listed key matches a prefix). Do not listen to `COLLAPSIBLE_OPEN_ALL_EVENT`. Children only after first open (`everOpened`, Pitfall 3); accept a `forceOpen` prop for print-all. `useCrossTabStorage` already owns try/catch (D-04).

### `ViewerBar` / `VisitorHeader` / `SignUpLine` (components, new)

**Analogs:** the visitor CTA in `src/app/browse/layout.tsx` and `src/app/browse/page.tsx` ("Get Started Free" → `/signup`) for copy/styling; `src/components/strategy/RequestIntroButton.tsx` for the intro action (reuse, don't re-implement). Read DESIGN.md + 196-UI-SPEC.md for layout. The browse layout/[slug]/root CTAs must also hide with a session (OQ-11).

### `src/app/factsheet-share/[token]/page.tsx` (page)

Keep header doc invariants ("a PUBLIC, sessionless route … THE CONSTANT-TIME HMAC MATCH IS THE AUTHORIZATION"). After the token match only: `createClient()` from `@/lib/supabase/server`, `auth.getUser()` → one boolean; never into `fetchAndBuildPayload`; keep `force-dynamic`; no import of `next/cache` or `v2/page.tsx` (`page.no-cache-reach.test.ts` guards this). Wrap render in `<main>`. Flag in threat model (OQ-3).

### `src/app/api/factsheet/[id]/pdf/route.ts` (API, server-only print-all, D-08)

Existing pieces to compose from:
- Self-recursion fence at top of `GET`: `if (req.headers.get("user-agent") === PDF_RENDERER_USER_AGENT) return NextResponse.json({ error: "Loop Detected" }, { status: 508 });`
- Internal caller gate: `const internalToken = req.headers.get("x-internal-token");` (cron founder-lp-report sends it; preview deploys refuse it).
- Render step:
```ts
    await page.setUserAgent(PDF_RENDERER_USER_AGENT);
    await page.goto(`${targetOrigin}/factsheet/${id}`, { waitUntil: "networkidle0", timeout: 25000 });
```
Recommended print-all signal: `page.setExtraHTTPHeaders({ "x-factsheet-print-all": <server secret or HMAC> })` before `goto`; the page reads it with `headers()` and compares constant-time to a server env secret. Do NOT use the UA (spoofable, viewer-controlled) or a query param (D-08: not viewer-reachable). The print-all render must still bypass/not populate the anon `unstable_cache` entry with an open-Advanced variant (Advanced open state is client-only today; keep the payload identical, only the render prop differs). Test: viewer request with `?printAll=1` or the header without the secret renders closed.

### `src/app/factsheet/[id]/tearsheet/page.tsx` (print view)

**Analog:** the share page's uncached `fetchAndBuildPayload` / `fetchAndBuildPayloadWithReason` call (`src/lib/factsheet/fetch-and-build-payload.ts`). Pitfall 10: it has its own disclosure gate; `figure-parity-pages.test.tsx` pins its labels and moves with the rebuild.

### `StrategyNoteCard` mount (OQ-6)

**Analog:** its only current mount in `src/app/strategy/[id]/page.tsx` (grep `StrategyNoteCard`). Copy the props, gate on signed-in viewer, wrap `print:hidden`.

## Shared Patterns

### Redirect lockstep (#512)
**Source:** `next.config.ts` `redirects()` + `route-contract-manifest.ts` exception rows + `scripts/check-route-contract.ts` Rule 3. **Apply to:** all four D-03 routes. Verify with `npx tsx scripts/check-route-contract.ts`.

### Comment-stripped source scans
**Source:** `stripCommentsPreserveLines` (`@/lib/source-scan`), used by `trim-removed-surfaces.test.tsx`. **Apply to:** all new guard tests, with red/green self-tests before the corpus scan (Rule 9).

### Public-cache isolation
**Source:** `page.owner-lane.test.tsx`, `page.public-cache-key.test.tsx`. **Apply to:** every change to `FactsheetV2Page`. Viewer state goes in render props, never in the payload.

### Storage under a purged prefix
**Source:** `APP_NAMESPACED_PREFIXES` + `CollapsibleSection` codec. **Apply to:** Advanced state (`factsheet-collapse:advanced`).

### Robots per lane
**Source:** `generateMetadata` in `v2/page.tsx` (`robots: "noindex"`) and the share route's static `metadata`. **Apply to:** D-07: published lane indexable, owner/unpublished and share token `noindex`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `BackLink.tsx` | component | event-driven | No history-fallback back link exists; `document.referrer` is stale on soft navigation (Pitfall 7). Use RESEARCH + UI-SPEC. |
| print-all header signal in the factsheet page | route | request-response | No page currently reads a server-to-server render header; compose from the PDF route's `x-internal-token` idiom. |

## Metadata

**Analog search scope:** `next.config.ts`, `src/lib/routing`, `src/__tests__`, `e2e/`, `src/app/factsheet`, `src/app/factsheet-share`, `src/app/api/factsheet`, `src/components/ui`, `src/lib/storage-namespaces.ts`, `src/components/*/SignOutButton.test.tsx`
**Files scanned:** ~20
**Pattern extraction date:** 2026-11-08
