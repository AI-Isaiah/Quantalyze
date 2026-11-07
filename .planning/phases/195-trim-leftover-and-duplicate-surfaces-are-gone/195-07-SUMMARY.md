---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 07
subsystem: testing
tags: [vitest, guard, comment-stripped-scan, route-contract, neuter-restore]
requires:
  - phase: 195-trim
    provides: "plans 01-06: the removals this guard pins"
provides:
  - "src/__tests__/trim-removed-surfaces.test.tsx: D-10 guard, 38 tests, one file listing every removed route and control"
affects: [195 ship, 196 tearsheet, 201 plainwords]
plan_head_before: 46c5ab785a8fbbcc73f69f6ed0d786793beb1155
plan_head_after: e0ebb78638d9ae462b63892ebab68f9817e9b404
actuals:
  tokens: 5800
  tasks: 2
  commits: 1
tech-stack:
  added: []
  patterns:
    - "comment-stripped disk scan (stripCommentsPreserveLines) with a vacuity floor, matchers each carrying a fires-on / ignores-comment self-test"
    - "redirect positive controls read through the repo's own parseRedirectSources / parsePublicRoutes"
key-files:
  created:
    - "src/__tests__/trim-removed-surfaces.test.tsx"
  modified: []
key-decisions:
  - "Allowlist is fixed at four named files (proxy.ts, route-contract-manifest.ts, the retired page, next.config.ts which is outside src and never scanned); a test pins that list"
  - "The retired-link matcher keys on a quote, backtick or the } closing a template interpolation immediately before the route, ending at a non-word, non-hyphen character, so crypto-decks, tradfi-decks, /portfolio-strategies and /portfolio-alerts cannot match"
requirements-completed: [LEAN-03, LEAN-07]
coverage:
  - id: D1
    description: "One test lists every removed route and control (portfolios tree, portfolio-pdf renderer and API route, Decks nav, Tweaks, factsheet dark mode, table density, Add to portfolio, repeated disclaimers) and is green on the finished tree"
    requirement: "LEAN-03"
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/trim-removed-surfaces.test.tsx (38 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The guard goes RED for each assertion class when a removed surface is reinstated, and the tree is byte-identical after restore"
    requirement: "LEAN-07"
    verification:
      - kind: other
        ref: "ten neuter -> RED -> restore runs N1-N10 recorded below"
        status: pass
    human_judgment: false
duration: 17min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 07: Removed-Surface Guard Summary

**One 38-test vitest guard, with comment-stripped scans and self-tests, that fails if any Phase 195 removed route or control renders or is linked again, proven able to fail by ten neuter-restore runs.**

## Performance

- **Duration:** about 17 min
- **Completed:** 2026-11-07
- **Tasks:** 2 (Task 1 tracer then full guard in one commit; Task 2 neuter proofs and gates, no file change)
- **Files modified:** 1 created, 0 edited

## Accomplishments

- `src/__tests__/trim-removed-surfaces.test.tsx` (545 lines, jsdom) covers: routes on disk (portfolios tree, `/api/portfolio-pdf`, Tweaks files absent; retired report page present, noindex, reads no admin client, token verifier or search param), redirect positive controls (`/portfolios/:path*` to `/allocations`, `/decks` to `/discovery/crypto-sma`, `/api/portfolio-pdf/:id` to `/portfolio-pdf/:id`, `/portfolio-pdf` public), no in-app link to a retired route across non-test `src`, controls gone (Tweaks literals, density, Decks nav, Dark mode, AddToPortfolio), render probes (Sidebar as allocator, manager and both in desktop and drawer, `buildPrimaryMobileNav` for four roles, StrategyTable), and the disclaimer counts (browse layout 0, browse page 1, category page 1, strategy page 1 and it is the `strategy-page` variant, tearsheet 0, plus the `Disclaimer.tsx` variant positive control).
- Seven self-tests prove each matcher fires on a synthetic reinstatement and ignores the same text in a line, block or JSX comment, and that the slugs `crypto-decks` / `tradfi-decks` and the `/portfolio-strategies`, `/portfolio-alerts` API paths are not flagged.
- Vacuity fences: population floor above 500 non-test files with named members, a probe that fails if the Sidebar renders no anchors or the table does not render.
- The guard needed no fix during the neuter runs: every neuter reddened the arm for its class.

## Task Commits

1. **Task 1: tracer then full guard** - `e0ebb7863` (test). The tracer slice (disk walk, link matcher, self-test, positive control) was run first and went RED on the manifest, which is exactly the allowlist case; the full file adds the allowlist and every other case in the same commit.
2. **Task 2: neuter proofs and phase gates** - no file changed (the tree is byte-identical to the Task 1 commit after all ten restores).

**Plan metadata:** the commit that adds this SUMMARY.

## Neuter evidence (D-10)

Every run: `npx vitest run src/__tests__/trim-removed-surfaces.test.tsx`; backup taken with `cp -p`, restored with `cp -p`, `cmp` printed nothing; a GREEN re-run (38 passed) followed each. In every edited-file row the sha256 before the neuter equals the sha256 after the restore and equals the backup's.

| N | Decision | Neuter | Exit | RED test(s) (class arm in bold) | sha256 before = after | cmp |
|---|----------|--------|------|-----------------------|-----------------------|-----|
| N1 | D-04 | Decks entry re-added to `Sidebar.tsx` | 1 | **Sidebar has no Decks nav entry**; no non-test source links to a retired route; Sidebar (allocator, desktop), (allocator, drawer), (both, desktop), (both, drawer) probes (6 failed) | `be3b20a0d2abeb5ab8b6bb502594f74fcdda0fe68173ae41754cf27a826eb298` | exit 0 |
| N2 | D-04 | decks rule deleted from `next.config.ts` redirects() | 1 | **next.config.ts redirects() carries the three retired sources**; each retired source lands on its named destination (2 failed) | `2c81edb2127aae978d46909200174e92619b3f7a9a6af6e7611b3c3451d81802` | exit 0 |
| N3 | D-01 | `email.ts` alert link set back to the portfolios route | 1 | **no non-test source links to a retired route**; positive control: the portfolio-alert email links My allocation (2 failed) | `d2b2e177292046fb2433cb26e6ca1a5440cf121f1ce3860e3820ed3588e79d83` | exit 0 |
| N4 | D-09 | footer `Disclaimer` mount re-added to `browse/layout.tsx` | 1 | **src/app/browse/layout.tsx renders exactly 0 <Disclaimer** (1 failed) | `9932e8a659ae5c687fd66bca988683401daa1cd0594a962f9d054fc457c3e5b4` | exit 0 |
| N5 | D-07 | `role="group"` named "Table density" re-added to `StrategyTable.tsx` | 1 | **StrategyTable has no 'Table density' group and no data-density**; StrategyTable's default render has no group named 'Table density' (2 failed) | `b47f4af43515ae87134fe4941fdd28f43bdae71315c6a57205a2432e88ab54c1` | exit 0 |
| N6 | D-06 | "Dark mode" item re-added to the DisplayMenu in `FactsheetView.tsx` | 1 | **no source offers a 'Dark mode' item (D-06), and FactsheetView in particular** (1 failed) | `c0981750bd8bc012c4d5558cd8515b007b3057926c66b07cc4cef99c95d3c51d` | exit 0 |
| N8 | D-02 | AddToPortfolio import and mount added to the discovery strategy page (no tsc run during the neuter; component file does not exist) | 1 | **no source imports or mounts AddToPortfolio, and PortfolioOptimizer has no 'Add to portfolio' link (D-02)** (1 failed) | `478a2f9c0978454330832cfe95c391cc6c00c1e2f787f46ae652a799ac062728` | exit 0 |
| N10 | D-03 | admin client import and call added to `portfolio-pdf/[id]/page.tsx` | 1 | **the retired-report page reads nothing: no admin client, no render-token verifier, no search-param read (D-03)** (1 failed) | `8206e8fcf4275ca839c7ffa6d315f49236e566735ba75a0b40b6f04bd871bcc1` | exit 0 |

Created-file neuters (precondition `test -e` exited 1 for both paths before the neuter):

| N | Decision | Neuter | Exit | RED test(s) | After undo |
|---|----------|--------|------|-------------|------------|
| N7 | D-01 | `src/app/(dashboard)/portfolios/page.tsx` stub created | 1 | **the /portfolios route tree does not exist (D-01)** (1 failed) | `rm -r` of the directory; `test -e` exit 1; `git status --porcelain -- "src/app/(dashboard)/portfolios"` empty |
| N9 | D-05 | `src/app/(dashboard)/allocations/components/Tweaks.tsx` stub carrying the toggle name, panel id and heading | 1 | **the Tweaks panel and toggle files do not exist (D-05)**; **no source carries the Tweaks toggle name, the 'Design variations' heading or the tweaks panel id (D-05)** (2 failed) | `rm` of the file; `test -e` exit 1; `git status --porcelain -- "src/app/(dashboard)/allocations/components"` empty |

After all ten: `git status --porcelain` printed nothing (no neuter target file, neither created path, no other change).

## Phase gates

- `npx vitest run src/__tests__/trim-removed-surfaces.test.tsx`: 1 file, 38 passed.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: exit 0, 0 errors, 2 warnings (`nativeUnitReason` unused in `MetricsColumn.tsx`, `isRankableAnalyticsRow` unused in `composite-read-path.ts`; neither file is touched by this plan). Route contract reads `OK - 52 page routes`.
- Full `npx vitest run`: Test Files 1 failed | 1155 passed | 20 skipped (1176); Tests 2 failed | 23490 passed | 309 skipped (23801). The two failures are the known pre-existing ones, both in `src/lib/factsheet/compute.conventions.test.ts` (fixture B: a series with zero-return days; fixture C: a series with interior calendar gaps). No other failure.
- `python3 -m pytest tests/test_computing_started_at_stamp.py -q` (from `analytics-service/`; `python` is not on PATH here): 7 passed.
- No census moved from adding the test file (`vitest.node-env.ts` count of `trim-removed-surfaces` is 0; the full run shows no census failure).

## Decisions Made

- Allowlist pinned at four named files with its own test, so widening it is a visible diff in a test, not a silent edit.
- The guard is a `.tsx` file running under jsdom (not in `vitest.node-env.ts`) so the Sidebar and StrategyTable render probes live in the same single file D-10 asks for.

## Deviations from Plan

None - plan executed exactly as written. Two notes that are not deviations:

- The failure message wording the plan mandates ("Remove it again; do not widen the allowlist.") reads oddly on the positive-control arms (a lost redirect, a lost `Disclaimer` variant), where the remedy is to restore, not remove. Kept verbatim per the plan; worth a follow-up wording split if the founder wants it.
- Task 1's tracer and full guard were committed together as one commit rather than two; the tracer was run and observed before expanding.

## Issues Encountered

None. A zsh word-splitting slip in the first neuter driver call exited before touching any file (the backup copy failed), so no neuter was applied or needed restoring.

## Known Stubs

None. The neuter stubs existed only for the length of their run and were removed.

## Threat Flags

None. The change adds one test file; no new endpoint, auth path or schema.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 195 plans 01-07 are complete. For the orchestrator (not executor work): CHANGELOG entry and the VERSION and package.json bump per CLAUDE.md "CHANGELOG discipline", then verify and ship. Expected golden changes for the phase: none. e2e is CI-only.

## Self-Check: PASSED

- `src/__tests__/trim-removed-surfaces.test.tsx` FOUND
- commit `e0ebb7863` is an ancestor of HEAD

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*
