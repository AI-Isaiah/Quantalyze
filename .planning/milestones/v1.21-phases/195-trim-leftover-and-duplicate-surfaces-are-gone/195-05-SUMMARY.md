---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 05
subsystem: ui
tags: [next-app-router, redirect, disclaimer, legal-copy, browse, tearsheet, vitest]

requires:
  - phase: 195-trim
    provides: CONTEXT D-08 and D-09, UI-SPEC S-5 and S-9
provides:
  - "/browse server redirect to the single populated category (non-empty read only)"
  - "Disclaimer variant strategy-page, composed from existing constants, and exported ANALYTICS_ONLY_TEXT"
  - "One disclaimer block per /browse page; browse layout no longer mounts a footer"
  - "Tearsheet: one Risk Disclosure block below the contact CTA, carrying the analytics-only sentence"
affects: [195-trim, 196, 201]

plan_head_before: 0c68e9f87c9ed04823713a1b616236ed6053272c
plan_head_after: fef4cf2186ad838a9c6a9118fd082e0daeea1d6d

actuals:
  tokens: 7500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Legal-copy tests pin sentences as literals, never by importing the constants the copy is built from"
    - "redirect() called outside the try/catch, gated on a non-empty read"

key-files:
  created:
    - src/app/browse/page.test.tsx
    - src/app/browse/disclaimer-once.test.tsx
  modified:
    - src/app/browse/page.tsx
    - src/app/browse/layout.tsx
    - src/app/browse/[slug]/page.tsx
    - src/app/browse/[slug]/[strategyId]/page.tsx
    - src/components/ui/Disclaimer.tsx
    - src/components/ui/Disclaimer.test.tsx
    - src/app/factsheet/[id]/tearsheet/page.tsx
    - src/app/factsheet/[id]/tearsheet/page.test.tsx
    - src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx
    - e2e/full-flow.spec.ts

key-decisions:
  - "Redirect only when populatedSlugs.length > 0 && categories.length === 1: getPopulatedCategorySlugs returns [] for both empty and failed reads, so a redirect on that path would be a claim from no data"
  - "CUSTODY_TEXT rebuilt from the exported ANALYTICS_ONLY_TEXT; rendered string byte-identical (pinned by test)"
  - "Legal-sentence tests use literal strings so a dropped sentence cannot be hidden by editing the constant too"
  - "Browse layout footer moved into the two pages that need only the general wording rather than conditionally hidden"

patterns-established:
  - "Per-page disclaimer census test (src/app/browse/disclaimer-once.test.tsx) with positive controls: each page must carry its sentences exactly once, not merely lack a duplicate"

requirements-completed: [LEAN-07]

coverage:
  - id: D1
    description: "/browse with exactly one populated category server-redirects to /browse/<slug>"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/browse/page.test.tsx#redirects to the category page when exactly one category is populated"
        status: pass
      - kind: e2e
        ref: "e2e/full-flow.spec.ts#browse page with one populated category goes straight to it"
        status: unknown
    human_judgment: false
  - id: D2
    description: "/browse with two or more categories renders cards; empty or failed read renders fallback cards and never redirects"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/browse/page.test.tsx#renders the category cards, heading and sign-up block when two are populated"
        status: pass
      - kind: unit
        ref: "src/app/browse/page.test.tsx#renders the fallback cards and never redirects when the read rejects"
        status: pass
    human_judgment: false
  - id: D3
    description: "/browse/<cat>/<id> renders exactly one combined disclaimer after the sign-up CTA card with custody, provenance and general wording"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/components/ui/Disclaimer.test.tsx#strategy-page variant"
        status: pass
      - kind: unit
        ref: "src/app/browse/disclaimer-once.test.tsx#/browse/<cat>/<id> renders one combined block, after the sign-up CTA card"
        status: pass
    human_judgment: false
  - id: D4
    description: "/browse and /browse/<cat> each render exactly one general footer disclaimer, mounted by the page; the layout mounts none"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/browse/disclaimer-once.test.tsx#/browse disclaimer once (D-09)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tearsheet renders one Risk Disclosure block below the contact CTA, every prior sentence once plus the analytics-only custody sentence"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/tearsheet/page.test.tsx#TearSheet page - one Risk Disclosure block"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual rhythm of the tearsheet tail after the section move (CTA mb-6, disclosure mb-2) and of the browse strategy page after removing the custody box"
    verification: []
    human_judgment: true
    rationale: "Spacing and print-order appearance are not asserted by any test; a human glance at the printed tearsheet and /browse/<cat>/<id> confirms it reads well"

duration: 25min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 05: Leftover and duplicate surfaces are gone (browse redirect and one-disclaimer-per-page) Summary

**`/browse` redirects server-side to its single populated category (never on an empty or failed read), `/browse/<cat>/<id>` and the tearsheet each carry one disclaimer block composed only from existing legal constants, and a literal-sentence test fails if any required sentence goes missing.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-11-07
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 12 (2 new test files)

## Accomplishments

- D-08: `/browse` calls `redirect("/browse/<slug>")` outside the try/catch only when the read is non-empty and exactly one category survives the filter. Two or more, zero and a rejected read render as before. The destination slug comes from the fixed `DISCOVERY_CATEGORIES` list.
- UC-13: the sign-up line now ends "and model an allocation." instead of promising portfolios.
- D-09 reference case: `/browse/<cat>/<id>` went from three blocks (custody box, bottom strategy paragraph, layout footer) to one `strategy-page` block after the sign-up CTA, text = `CUSTODY_TEXT` + the tier's `PROVENANCE` + `FOOTER_TEXT`. Only the duplicate "Past performance is not indicative of future results." goes.
- D-09 browse layout: the layout footer mount is gone; `/browse` and `/browse/<cat>` mount `<Disclaimer variant="footer" />` themselves, so each still shows exactly one general block.
- D-09 tearsheet: custody section deleted, `ANALYTICS_ONLY_TEXT` added to the Risk Disclosure paragraph (no sentence lost), section moved below the contact CTA so it is the last printed block.

## Task Commits

1. **Task 1: Tracer, /browse redirect (query to page to e2e)** - `6ecfd2851` (feat)
2. **Task 2: One combined disclaimer; browse footer moves into the two general pages** - `81e968753` (feat)
3. **Task 3: Tearsheet one Risk Disclosure block** - `fef4cf218` (feat)

**Plan metadata:** the docs commit carrying this SUMMARY.

Tracer gate: Task 1 `<verify>` (`npx vitest run src/app/browse/page.test.tsx`, 5/5) re-run after the commit, passed end to end, expanded to Tasks 2 and 3.

## RED / GREEN evidence (Task 1 and Task 2 were test-first)

- Task 1 RED: before the edit the redirect case and the UC-13 copy case failed (2 failed, 3 passed); GREEN 5/5.
- Task 2 RED: Disclaimer test file failed 6 cases (variant did not exist, `ANALYTICS_ONLY_TEXT` undefined); GREEN 16/16.
- Task 3 RED: the new Risk Disclosure cases failed 2 (custody box still present, section still above the CTA); GREEN 56/56.

## Neuter, RED, restore proofs

Every neuter used `cp -p` to a scratchpad backup, edited, ran the targeted tests, `cp -p` back and `cmp` proved byte equality (all "restored byte-equal").

| Neuter | Result |
|---|---|
| `/browse` redirect condition replaced by `if (false)` | 1 failed: the one-category redirect test |
| redirect condition replaced by `categories.length >= 1` | 4 failed: two-category, empty, rejected, copy cases |
| `strategy-page` drops `FOOTER_TEXT` | 5 failed (4 Disclaimer cases incl. every-sentence-once, plus the page census) |
| `strategy-page` drops `CUSTODY_TEXT` | 5 failed (same set) |
| custody box mount re-added on `/browse/<cat>/<id>` | 1 failed: the combined-block census |
| layout footer text re-added to `browse/layout.tsx` | 1 failed: layout-mounts-none |
| `/browse` footer mount removed | 1 failed: exactly-one-general-footer |
| `/browse/<cat>` footer mount removed | 1 failed: exactly-one-general-footer |
| `ANALYTICS_ONLY_TEXT` dropped from the tearsheet paragraph | 1 failed: every-sentence-once |
| tearsheet "tax advice" sentence reworded | 1 failed: every-sentence-once |
| tearsheet custody box re-added | 1 failed: every-sentence-once |
| tearsheet Risk Disclosure moved back above the CTA | 1 failed: below-the-CTA position test |
| no-op control (identical replacement) | 56/56 pass, proving the harness does not fail spuriously |

D-09 guard: `Disclaimer.test.tsx` pins the api_verified, csv_uploaded and self_reported compositions as string literals and counts each of the six legal sentences plus the tier's provenance sentence exactly once per tier; the tearsheet test does the same for its five sentences. Dropping or rewording any one fails a test (shown above).

## Gates

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, 0 errors, 2 warnings, both pre-existing in untouched files (`factsheet/[id]/v2/MetricsColumn.tsx`, `lib/factsheet/composite-read-path.ts`).
- `npx vitest run src/app/browse src/components/ui/Disclaimer.test.tsx "src/app/factsheet/[id]/tearsheet" src/__tests__/dashboard-disclaimer-once.test.ts`: 9 files, 99 tests passed, 0 failed.
- `next build`: not run (not a local gate per orchestrator rules).

## Files Created/Modified

- `src/app/browse/page.tsx` - redirect, copy fix, footer mount
- `src/app/browse/page.test.tsx` - 0/1/2+/rejected and copy tests
- `src/app/browse/disclaimer-once.test.tsx` - per-page disclaimer census with positive controls
- `src/app/browse/layout.tsx` - footer mount removed
- `src/app/browse/[slug]/page.tsx` - footer mount added
- `src/app/browse/[slug]/[strategyId]/page.tsx` - custody box and bottom paragraph replaced by one `strategy-page` block
- `src/components/ui/Disclaimer.tsx` / `.test.tsx` - `strategy-page` variant, `ANALYTICS_ONLY_TEXT`
- `src/app/factsheet/[id]/tearsheet/page.tsx` (+ two tests) - one Risk Disclosure block, moved below the CTA
- `e2e/full-flow.spec.ts` - the `/browse` step expects `/browse/crypto-sma`

## Decisions Made

See `key-decisions`. Additionally: spacing on the tearsheet tail was kept equal to HEAD's by swapping the `mb` values (CTA `mb-2` to `mb-6`, disclosure `mb-6` to `mb-2`), so the gap above the print-hidden row is unchanged.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing critical] Added `src/app/browse/disclaimer-once.test.tsx` (not in `files_modified`)**
- **Found during:** Task 2
- **Issue:** The plan's tests covered the Disclaimer variant but nothing proved each browse page actually mounts exactly one block, so removing a page-level mount (a legal sentence silently gone, T-195-09) or re-adding the layout footer would pass every test.
- **Fix:** One census file asserting the layout mounts none, `/browse` and `/browse/<cat>` mount exactly one general block, and `/browse/<cat>/<id>` renders one combined block after the sign-up card.
- **Verification:** six neuter-RED proofs above.
- **Committed in:** `81e968753`

**2. [Rule 1 - Test hygiene] Tearsheet tests added in `page.test.tsx` beyond the single assertion the plan named**
- The plan asked for one analytics-sentence-once assertion and a zero-count for the custody phrase. Added every-sentence-once, verbatim paragraph and position-below-CTA cases so the D-09 "no sentence dropped" and UC-19 "below the contact CTA" claims can fail.
- **Committed in:** `fef4cf218`

**Total deviations:** 2 (test coverage only). **Impact:** no production behavior beyond the plan.

## Issues Encountered

None blocking. One neuter attempt (re-adding a `<Disclaimer>` tag after the import was swapped) crashed the whole page rather than failing the targeted test; it was discarded and replaced by a clean neuter with a literal paragraph. The page file was restored byte-equal.

## Routing notes for the orchestrator to book

- **UC-10 (Phase 201 PLAINWORDS):** `CUSTODY_TEXT` ("Strategy monitored via read-only exchange API...") renders verbatim for every trust tier on `/browse/<cat>/<id>`, including `csv_uploaded` and `self_reported` where it sits beside "not independently verified ... by an exchange API". D-09 allows no new legal copy, so it ships verbatim. A tier-aware custody sentence is for Phase 201. Pinned by the csv_uploaded literal case in `Disclaimer.test.tsx`, so a later change has to touch that test deliberately.
- **UC-11 (Phase 196):** `FactsheetFooter`'s methodology note inside `FactsheetView` (on `/discovery/<slug>/<id>` and `/allocations`) carries "Past performance is not indicative of future results." while the chrome footer carries "Past performance does not guarantee future results." Treated as methodology and left untouched. On `/factsheet/<id>/v2` and `/factsheet-share/<token>` that note is the only risk statement, so any dedupe there must keep a sentence.
- **RESEARCH open question 1 (founder report item):** `getPopulatedCategorySlugs()` returns `[]` for both a DB error and an empty result, and `/browse` then renders all five categories, so the "No strategies published yet" line is unreachable. This plan left that path exactly as at HEAD and redirects only on a non-empty single result.
- **UC-8:** breadcrumb "Browse" on the category page still links to `/browse`, which now lands on the single category page. Accepted.

## E2E and goldens expected to change in CI

- `e2e/full-flow.spec.ts`: "browse page with one populated category goes straight to it" (renamed from "browse page loads strategy categories"); seeded DB has one populated category so `/browse` redirects. Not run locally (needs the seeded stack); CI is the first run.
- Unseeded `reflow-sweep`, `axe-app-wide`, `no-clip-sweep` `/browse` rows read no DB and do not redirect: expected unchanged.
- Screenshot goldens: none expected to change (no golden renders `/browse` or the tearsheet). Not re-baked.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, auth paths or schema changes. The redirect destination is a fixed-list slug (T-195-10 mitigated); legal text is composed only from existing constants and pinned verbatim (T-195-09 mitigated).

## Self-Check: PASSED

- Created files exist: `src/app/browse/page.test.tsx`, `src/app/browse/disclaimer-once.test.tsx`.
- Commits present on the branch: `6ecfd2851`, `81e968753`, `fef4cf218` (`git rev-list --count 0c68e9f87..HEAD` = 3 before this SUMMARY commit).
- Acceptance greps: browse page imports `next/navigation` once; "build portfolios" 0 in `browse/page.tsx`; `<Disclaimer` count 0 in layout, 1 each in `/browse`, `/browse/<cat>`, and `/browse/<cat>/<id>` (`variant="strategy-page"`); tearsheet `variant="custody"` 0, `ANALYTICS_ONLY_TEXT` 2, `vi.mock("@/components/ui/Disclaimer"` 0 in `page.test.tsx`; `Disclaimer.test.tsx` contains "Data verified from exchange API.".

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*
