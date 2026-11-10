---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 19
subsystem: ui
tags: [factsheet, landmarks, a11y, seo, robots, axe, reflow]
status: complete

requires: ["196-02", "196-05"]
provides:
  - "the factsheet page renders its own single <main> (published render and owner/public pending render); the viewer bar and visitor header stay sibling <header> banners"
  - "published-only indexing: generateMetadata omits robots only when the published-only probe returns the row"
affects: [196-21]

actuals:
  tokens: 4500    # chars/4 over the realized diff (17870 chars, code commits only)
  tasks: 2
  commits: 2
plan_head_before: 056a4e5ea1283034cbd11a552fc18938044af49f
plan_head_after: 0b74f2eb456bc1ab9aec4afb89a91486f8f6eded

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/not-found.tsx
    - src/app/factsheet/[id]/v2/error.tsx
    - src/app/factsheet/[id]/v2/loading.tsx
    - src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx
    - src/app/factsheet/[id]/v2/page.metadata.test.tsx
    - e2e/axe-app-wide.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
  deleted:
    - src/app/factsheet/[id]/v2/layout.tsx

key-decisions:
  - "The one <main> lives in the page, not a layout: /factsheet/[id] re-exports the v2 page without v2/layout.tsx, so the canonical route never had a main landmark"
  - "robots is dropped on `data && !error`: a probe that errors fails closed to noindex even if a driver hands back a row"
  - "The reflow rows follow the spec's founder-decided supported widths (390/640/960), not 320px (see Deviations)"

requirements-completed: [LEAN-02, ROUTE-04]
---

# Phase 196 Plan 19: One main landmark and published-only indexing Summary

The factsheet page now renders its own single `<main>` around the article beside the chrome banner, `v2/layout.tsx` is deleted, and `generateMetadata` drops `noindex` only when the published-only probe finds the strategy.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: one main landmark beside the chrome, anonymous axe row, reflow rows | 099fff547 |
| 2 | Only a published factsheet is indexable | 0b74f2eb4 |

## What changed

- `page.tsx`: `<main>` wraps `FactsheetView` (published render) and the pending `<article>` (owner pending render, and the public placeholder, which shares that return). `ViewerBar` / `VisitorHeader` stay preceding siblings, so they remain `banner` landmarks (inside `<main>` a `<header>` stops being one). A comment replaces the layout's rationale.
- `v2/layout.tsx` removed with `git rm` (declared in `files_deleted`). `not-found.tsx`, `error.tsx`, `loading.tsx` wrap their root `<article>` in `<main>` so the `/v2` alias still has exactly one main per state. No code or test imported the layout (grep of src, e2e, scripts, docs: no hits).
- `generateMetadata`: `...(data && !error ? {} : { robots: "noindex" as const })`. The share-token route keeps its own noindex (plan 12) and the tearsheet route is untouched; no other `X-Robots-Tag`, robots.txt or sitemap blocks the factsheet (grepped).
- Tests: four one-main arms in `page.viewer-chrome.test.tsx` (signed-in allocator, no session, owner pending page, and the three `/v2` alias states); three metadata arms in `page.metadata.test.tsx`.
- e2e: anonymous strict all-impact axe row (`/factsheet/<id>` with no session, three viewports) in `axe-app-wide.spec.ts`; in `reflow-sweep-authed.spec.ts` a signed-in viewer-bar row (anchored on `nav[aria-label="Back"]`) and a no-session visitor-header describe (anchored on the banner's Sign up link, plus `documentElement.scrollWidth <= viewport width`), at V390/V640/V960.

## Grep gate (HEAD to after)

| Check | HEAD | After |
|---|---|---|
| `grep -a -c "<main" page.tsx` | 0 | 3 (two code elements plus the new comment's mention; the published and the pending render) |
| `test -f v2/layout.tsx` | exits 0 | exits 1 |
| `grep -a -c 'robots: "noindex"' page.tsx` | 1 | 1 (the miss/error lane) |

## RED evidence (neuter, run, RED naming the arm, restore from `cp -p` backup, `cmp`, GREEN)

1. One main landmark (T-196-12 neighbour, ROUTE-04). Neuter: removed the `<main>` wrapper from the published render in `page.tsx` and turned `not-found.tsx`'s `<main>` into a `<div>`. RED, 3 arms: "a signed-in allocator on a published factsheet: one main around the article, the bar outside it", "a reader with no session: one main, the visitor header outside it", "the /v2 alias keeps exactly one main in its not-found, error and loading states". Restored both files from backup, `cmp` exit 0, 31 passed.
2. Published is indexable, T-196-12. Written red-first (the published arm failed against the old `robots: "noindex"` before the change). After the change, neuter A (`robots: "noindex"` unconditionally): RED on "a published strategy (the published-only probe returns the row) is indexable: no robots key". Neuter B (`data ? {} : ...`, ignoring `error`): RED on "a probe error keeps noindex, even when the driver also hands back a row". Restored from backup, `cmp` exit 0, 6 passed.

## Verification

- `npx vitest run "src/app/factsheet"`: 121 files, 1645 tests passed. `src/__tests__/trim-removed-surfaces.test.tsx` and `critical-regressions.test.ts`: 221 passed.
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (2 pre-existing warnings in `MetricsColumn.tsx`, `composite-read-path.ts`) with its trailing checks, including `check-route-contract` (48 page routes OK).
- `npx playwright test --list e2e/axe-app-wide.spec.ts e2e/reflow-sweep-authed.spec.ts`: 94 tests listed, the six new axe/reflow factsheet rows included, no error.
- NOT run: the e2e rows themselves (they are HAS_SEED_ENV-gated and need the seeded test database and a built server; they run in CI). Not measured here: that axe reports zero violations on the signed-out render.

## Deviations from Plan

**1. [Premise changed on main] Reflow rows use the supported viewports, not 320px.**
- **Found during:** Task 1 (re-reading `reflow-sweep-authed.spec.ts` fresh, as the orchestrator instructed).
- **Issue:** the plan asks for a 320px sweep row and a `scrollWidth <= 320` assertion. The spec's header now records a founder decision (2026-09-27): 390px and desktop 200% zoom are the supported widths; 320px is deliberately not required, and its sweep runs V390/V640/V960. A 320px row would demand 320-only fixes nobody asked for across the whole factsheet body, not just the chrome.
- **Fix:** the signed-in row and the new anonymous describe run at V390/V640/V960, and the anonymous row asserts `scrollWidth <= <viewport width>` with the visitor header visible. The two plan truths marked `verification: backstop` (320px two-row wrap, long label wrap) are still backstops: neither has an automated 320px row.
- **Files modified:** `e2e/reflow-sweep-authed.spec.ts`
- **Commit:** 099fff547

**2. [Rule 3 - style] Wrapped roots in not-found/error/loading are not re-indented.** The `<main>` wrapper was added without re-indenting the existing `<article>` blocks, to keep the diff to two lines per file. Cosmetic only.

## Known limits

- No `<link rel="canonical">` (plan's flagged assumption stands): `?share=1` and `?from=` variants of a published URL can be indexed as separate URLs. Recorded for the verifier, not fixed.
- The `/v2` alias's `not-found.tsx` / `error.tsx` / `loading.tsx` only apply to the `/factsheet/[id]/v2` segment; the canonical `/factsheet/[id]` not-found resolves further up the tree and was not touched.
- `generateMetadata` runs on the request client, so a published strategy viewed by its signed-in owner is also indexable metadata-wise; that is correct, since the page is published.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the indexing change is the plan's T-196-12 mitigation.

## Self-Check: PASSED

- `v2/layout.tsx` absent; the six modified src/e2e files present.
- Commits 099fff547 and 0b74f2eb4 are ancestors of HEAD.
