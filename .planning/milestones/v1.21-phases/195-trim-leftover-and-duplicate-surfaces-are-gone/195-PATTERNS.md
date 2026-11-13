# Phase 195: TRIM - Pattern Map

**Mapped:** 2026-11-07
**Files analyzed:** 9 pattern-bearing files (the deletion list is in 195-RESEARCH.md section 2)
**Analogs found:** 8 / 9

All paths are repo-relative and git-tracked (verified with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `next.config.ts` (add 3 redirects) | config | request-response | its own `/scenarios` entry, lines 186-205 | exact |
| `src/lib/routing/route-contract-manifest.ts` (edit entries) | config | n/a | `/scenarios` entry, lines 263-269 | exact |
| `e2e/route-redirects.spec.ts` (add cases) | test (e2e) | request-response | its own `/scenarios` case, lines 43-73 | exact |
| `src/app/portfolio-pdf/[id]/page.tsx` (rewrite as retired page) | component (server page) | request-response, no data | `src/app/factsheet/[id]/v2/not-found.tsx` | role-match (tokens differ; use UI-SPEC S-4) |
| `src/app/portfolio-pdf/[id]/page.test.tsx` (new) | test | request-response | `src/app/factsheet-share/[token]/page.test.tsx` | role-match (not read) |
| `src/__tests__/trim-removed-surfaces.test.ts` (new, D-10 guard) | test (census) | file-I/O, disk walk | `src/__tests__/dashboard-disclaimer-once.test.ts` | exact |
| `src/app/browse/page.tsx` (single-category `redirect()`) | page | request-response | no in-repo single-category analog; use the Next `redirect` import | none |
| Disclaimer composition (D-09) in `src/components/ui/Disclaimer.tsx` and browse pages | component | transform | `Disclaimer.tsx` variants, lines 8-80 | exact |
| Neuter proof (D-10 manual) | procedure | n/a | none; no in-repo byte-backup test | none |

## Pattern Assignments

### `next.config.ts` redirects (config)

**Analog:** `/scenarios` rule, `next.config.ts:186-205`. Add the three rules after it.
```ts
      {
        source: "/scenarios",
        destination: "/allocations?tab=scenario",
        permanent: true,
      },
    ];
```
Rules to add (from RESEARCH section 3): `/portfolios/:path*` -> `/allocations` (permanent), `/decks` -> `/discovery/crypto-sma` (`permanent: false`), `/api/portfolio-pdf/:id` -> `/portfolio-pdf/:id` (permanent). Keep the dated comment style used above the `/scenarios` rule (Phase tag, why, lockstep with manifest `redirectFrom`).

### `src/lib/routing/route-contract-manifest.ts` (config)

**Analog:** `:263-269`.
```ts
  {
    route: "/scenarios",
    class: "exception",
    redirectFrom: "/scenarios",
    notes: "EXCEPTION: MOVED route ... config-level 308 ... there is NO backing page.tsx ...",
  },
```
`redirectFrom` must equal the `source` string byte for byte (Rule 3, `scripts/check-route-contract.ts`). Notes carry reason and date.

The "NEVER MOVE" entry to rewrite (`:359-364`):
```ts
  {
    route: "/portfolio-pdf/:id",
    class: "public",
    notes:
      "Share-token PDF deep link — covered by the /portfolio-pdf PUBLIC_ROUTES prefix + bounce-exempt. NEVER MOVE.",
  },
```
Keep `class: "public"`; replace the notes with the D-03 reason and date. Run `npm run check:route-contract` after (a non-exception entry carrying `redirectFrom`, as planned for `/decks`, is untested).

### `e2e/route-redirects.spec.ts` (test, request-response)

**Analog:** `:43-73`. Unseeded, no auth, first hop only.
```ts
const res = await request.get("/scenarios", { maxRedirects: 0 });
expect(res.status(), `...expected a 308...`).toBe(308);
const location = res.headers()["location"] ?? "";
expect(location, `...`).toContain("/allocations");
expect(location, `...`).not.toContain("/login");
```
Copy per new rule: `/portfolios`, `/portfolios/x/manage`, `/portfolios/x/strategies/y` expect 308 to `/allocations`; `/decks` expects 307 to `/discovery/crypto-sma`; `/api/portfolio-pdf/x` expects 308 to `/portfolio-pdf/x`. Include a bare `/portfolios` case (the `:path*` zero-segment match is not yet exercised in this repo).

### `src/app/portfolio-pdf/[id]/page.tsx` (retired page)

**Analog:** `src/app/factsheet/[id]/v2/not-found.tsx` (whole file, 28 lines). Structure to copy: `<article className="mx-auto max-w-2xl px-6 py-16">`, mono eyebrow `text-micro font-mono uppercase tracking-[0.22em] text-text-muted`, `<h1 className="mt-2 ...">`, paragraphs `mt-4` / `mt-2`, CTA row `mt-6 flex gap-3` using `next/link`.
```tsx
<p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
<h1 className="mt-2 font-serif text-3xl text-text-primary">
<div className="mt-6 flex gap-3"><Link href="/discovery" ...>
```
Deviations (per RESEARCH and UI-SPEC S-4): use `font-display text-page-title` not `font-serif text-3xl`; use `Button size="md"` inside `Link` not hand-rolled classes; wrap in `<main>` and add `LegalFooter` (root-level route, no chrome); `export const metadata = { title: "Portfolio report retired", robots: "noindex" }`; no `searchParams`, no `createAdminClient`, no data read. Import the Disclaimer from nothing here; the current page's `<Disclaimer variant="factsheet" trustTier={null} />` at `:406` goes away with the renderer. Keep `/portfolio-pdf` in `PUBLIC_ROUTES` and `isPortfolioPdfRoute` bounce-exempt in `src/proxy.ts` (`:18`, `:123-124`); update only the comment near `:97`.

### `src/__tests__/trim-removed-surfaces.test.ts` (D-10 guard)

**Analog:** `src/__tests__/dashboard-disclaimer-once.test.ts`. Reuse its skeleton: disk-derived population, comment stripping, self-tests, positive control.

Imports and walker (`:30-77`):
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
function listScannedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) { listScannedFiles(abs, out); continue; }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
  return out;
}
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
```
Matcher over comment-stripped source (`:55-65`):
```ts
function findDisclaimerTags(source: string, file: string): Hit[] {
  const code = stripCommentsPreserveLines(source, "ts");
  ...
}
```
Self-tests that the matcher fires and ignores comments (`:80-107`), a "real population" check (`expect(files.length).toBeGreaterThan(100)`, `toContain(<known file>)`), a positive control, and the assertion with a report message ending "Delete it; do not add a second one." (`:128-140`).

Adapt: matchers for `href="/portfolios`, `"/portfolios/`, `Tweaks` mount, `density` state in `StrategyTable.tsx`, the factsheet dark-mode option, `/decks` href in `Sidebar.tsx`, `AddToPortfolio`. Positive control: the `next.config.ts` redirects must contain the three sources (so deleting the redirect also fails). Also assert the `/portfolios` page tree and `src/app/api/portfolio-pdf` no longer exist on disk.

### Disclaimer composition (D-09)

**Analog:** `src/components/ui/Disclaimer.tsx`. Variants and texts are module constants (`FOOTER_TEXT`, `CUSTODY_TEXT`, provenance via `provenanceFor(trustTier)`), selected by a `switch (variant)` (`:44-60`), styled per variant with `cn(...)` (`:62-70`).
```ts
case "strategy":
  text = `${provenanceFor(trustTier)} Past performance is not indicative of future results.`;
```
A combined custody + strategy block is one new switch arm (or a `custody+strategy` composition) built from `CUSTODY_TEXT` and the strategy text, so no legal sentence is retyped. Layout-level footer to suppress on self-disclaiming pages: `src/app/browse/layout.tsx:2,40` (`<Disclaimer variant="footer" />`). Existing census to extend, not duplicate: `dashboard-disclaimer-once.test.ts` (dashboard routes: one footer from `DashboardChrome`, asserted exactly twice, once per layout arm). Note it lists `src/app/(dashboard)/portfolios/[id]/page.tsx` in its population check (`:~125`); that row must change when the page is deleted.

### Neuter proof (D-10)

No in-repo test performs a byte-backup neuter. `src/__tests__/mutation-runner-neuter.test.ts` tests the SQL mutation runner's `neuterArm` function and is not a model. Use the founder rule procedure as a plan step: copy the file bytes to the scratchpad, reinstate one removed surface (for example the Sidebar Decks link), run the guard and see RED, then restore from the byte copy (never `git checkout`, `restore` or `stash`) and see GREEN. Record the RED output in the SUMMARY.

## Shared Patterns

- **Comment-stripped scans:** `stripCommentsPreserveLines` from `@/lib/source-scan` so prose naming a removed surface does not trip a guard.
- **Dated retirement notes:** manifest notes and `next.config.ts` comments state the phase, decision id, and date.
- **Keep data:** no migration, no row deletion (192 D-11). `src/lib/queries.ts` helpers stay.
- **Census fan-out on removal:** `src/__tests__/display-sign-single-source.test.ts` (`SCAN_FILES`/`CENSUS_FILES` rows for `portfolio-pdf/[id]/page.tsx`, deleted components), `src/lib/anon-strategies-projection.test.ts:52`, `dashboard-disclaimer-once.test.ts`. Grep all censuses with `grep -a`.
- **Correction carried from RESEARCH:** Phase 192 deleted `/demo` outright (it did not redirect it), so the redirect precedent is `/scenarios`, not `/demo`.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `src/app/browse/page.tsx` single-category redirect | page | No page-level data-driven `redirect()` stub is the established pattern (RESEARCH calls page `redirect()` an anti-pattern for static moves, but D-08 depends on data, so it must be page-level); read the file and add `redirect` from `next/navigation` after the category query. |
| Byte-backup neuter test | procedure | Manual only; see above. |

## Metadata

**Analog search scope:** `next.config.ts`, `src/lib/routing`, `e2e`, `src/__tests__`, `src/components/ui`, `src/app/factsheet`, `src/proxy.ts`
**Pattern extraction date:** 2026-11-07
