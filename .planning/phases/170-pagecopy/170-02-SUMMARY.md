---
phase: 170-pagecopy
plan: 02
subsystem: testing
tags: [playwright, e2e, geometry, layout, FLOW-01]

requires:
  - phase: 170-pagecopy
    provides: main-aware assertNoReflow with an unchanged signature (plan 170-01)
provides:
  - Seeded geometry spec at V390/V640/V960 for every criterion-2 item this plan owns
  - Shared geometry helpers (intersect, inside viewport, not covered, scrolls inside, children inside)
  - e2e-seeded list entry so the spec runs in CI
affects: [170-03, 170-04, 170-05, 170-06, 170-07, 170-08]

actuals:
  tokens: 8841
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "elementFromPoint centre-hit for 'not covered'"
    - "per-viewport test titles so --list proves the contracted widths"

key-files:
  created:
    - e2e/helpers/geometry.ts
    - e2e/layout-narrow.spec.ts
  modified:
    - .github/workflows/ci.yml
    - e2e/helpers/seed-test-project.ts

key-decisions:
  - "Contract-first: assertions describe the fixed UI and stay RED at HEAD. They are not weakened to pass today."
  - "N-STRAT name and tag update goes through getAdmin() via setSeededStrategyNameAndTags, never a second admin client."
  - "N-MATCH has no match-batch seed. The positive control is the header action bar (Recompute now, Edit preferences). Send intro, KEEP and SKIP are asserted absent at V390 and recorded as not renderable by this seed."

patterns-established:
  - "Pattern: a locator that resolves to zero elements fails loud (W-02)."
  - "Pattern: /strategies and /my-strategies are anchored by testid or href, never by the shared h1."

requirements-completed: ["T0", "SC2-NOSCROLL", "SC2-(a)", "SC2-TWEAKS", "SC2-(d)", "(f)", "(g)", "SC2-PROFILE", "SC1-PRIVLINK", "(k)", "(l)", "SC2-MATCH", "SC2-COMPARE"]

coverage:
  - id: D1
    description: "geometry.ts exports rectsIntersect, assertInsideViewport, assertNotCovered, assertScrollsInside and assertChildrenInside, and a zero-element locator fails loud."
    requirement: T0
    verification:
      - kind: other
        ref: "npx tsc --noEmit -p ."
        status: pass
      - kind: other
        ref: "grep -c elementFromPoint e2e/helpers/geometry.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "layout-narrow.spec.ts is wired in both FLOW-01 places and enumerates every criterion-2 row at its contracted viewports."
    requirement: T0
    verification:
      - kind: e2e
        ref: "CI=1 npx playwright test --list e2e/layout-narrow.spec.ts"
        status: pass
      - kind: other
        ref: "grep -c e2e/layout-narrow.spec.ts .github/workflows/ci.yml"
        status: pass
    human_judgment: true
    rationale: "The list proves the spec is wired and names every row. Whether each assertion is RED for the right defect is a CI e2e-seeded run, which this plan must not execute against shared TEST."

duration: 8min
completed: 2026-09-27
status: complete
plan_head_before: fbc190179b055f6ec4bbab86a7e4c5ea0a53d30b
plan_head_after: 5129dd6d9a047c65d6e7c5c954c18dd3ba5513e0
---

# Phase 170 Plan 02: Seeded Narrow-Layout Geometry Summary

**Seeded Playwright geometry spec for every criterion-2 item at V390, V640 and V960, wired into the e2e-seeded list, written against the fixed UI so open defects stay RED.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-27T20:39:17Z
- **Completed:** 2026-09-27T20:47:20Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Shared geometry helpers, including the elementFromPoint "not covered" probe this repo did not have.
- One spec covering the composed footer, the allocations tab strip, Tweaks, the constituent region, profile Disconnect, the strategies row, the my-strategies Sort selects, admin match write controls, and compare copy.
- Both FLOW-01 places: `HAS_SEED_ENV` skip in the spec, and `e2e/layout-narrow.spec.ts` in the e2e-seeded list directly after the authed reflow sweep.

## Task Commits

Each task was committed atomically:

1. **Task 1: geometry helpers plus the N-FOOT V390 row, wired through both FLOW-01 places** - `288fe79a2` (test)
2. **Task 2: allocations, scenario and profile rows at V390 / V640 / V960** - `0ae3cadca` (test)
3. **Task 3: /strategies, /my-strategies, /admin/match and /compare rows** - `91c5a63db` (test)
4. **Rule 2: route the name/tag update through the guarded seed helper** - `5129dd6d9` (fix)

**Plan metadata:** committed in the docs commit that adds this file.

## Files Created/Modified

- `e2e/helpers/geometry.ts` - rect intersection, viewport, covered, scroll-inside and children-inside probes.
- `e2e/layout-narrow.spec.ts` - seeded per-item geometry spec. 24 tests enumerated.
- `.github/workflows/ci.yml` - e2e-seeded list entry plus a dated FLOW-01 comment.
- `e2e/helpers/seed-test-project.ts` - `setSeededStrategyNameAndTags`, by id, through `getAdmin()`.

## Decisions Made

- Assertions describe the fixed UI. A row that would pass today by asserting the broken copy was rewritten to assert the contract, so it can fail.
- N-MATCH cannot seed a batch. The V960 positive control is the header action bar. Send intro, KEEP and SKIP are not renderable by this seed.
- N-SCN at V960 records whether the region scrolls and does not assert it. The natural row width may fit.

## Expected RED at HEAD

The spec was not run against shared TEST. RED is predicted from the current UI, not measured. The phase PR is green only when every owning plan has landed.

| Row | Viewport | Expected at HEAD | Owning plan |
|-----|----------|------------------|-------------|
| N-FOOT children inside the footer | V390 V640 V960 | RED — footer is a fixed 56px row; wrapped children spill | 170-04 |
| N-FOOT footer bottom ≤ nav top | V390 V640 | RED — footer is `bottom: 0`, so it sits on the nav | 170-04 |
| N-FOOT Commit inside the viewport, height ≥ 44, not covered | V390 V640 | RED — Commit is outside the viewport at a narrow height and is 32px tall (`py-1.5`) | 170-04 |
| N-FOOT text inside the footer after scroll | V640 | RED — same fixed-height footer | 170-04 |
| SC2-(a) tablist scrolls inside itself | V390 V640 | RED — the strip has no `min-w-0`, so the page overflows instead of the strip | 170-03 |
| SC2-(a) last tab fully inside the strip after End | V390 V640 | RED — same strip | 170-03 |
| SC2-(a) tablist on the action row, not scrolling | V960 | expected GREEN — `sm` wrap already puts the tabs on the action row | 170-03 |
| N-TWEAKS toggle not fixed, intersects neither nav nor footer | V390 V640 V960 | RED — toggle is `position: fixed` at bottom-right and intersects the nav | 170-03 |
| N-TWEAKS panel does not intersect the nav | V390 V640 | RED — panel is `bottom: 20` and overlaps the nav | 170-03 |
| N-SCN Strategies and weights scrolls inside itself, page does not | V390 V640 | RED — the list is not wrapped in ResponsiveTable, so the page overflows | 170-04 |
| N-SCN record-only | V960 | not an assertion | 170-04 |
| SC2-PROFILE tab list scrolls inside itself | V390 V640 | RED — TabsList underline has no overflow-x-auto | 170-08 |
| SC2-PROFILE Disconnect inside and not covered | V390 V640 | RED — the key row is nowrap, so Disconnect can sit past the viewport | 170-08 |
| SC2-PROFILE other tabs, no page overflow | V390 V640 V960 | expected GREEN unless a tab's own content overflows | 170-08 |
| N-STRAT name and control group do not intersect | V390 | RED — the row is one nowrap flex line | 170-05 |
| N-STRAT name text equals the seeded name | V390 V640 V960 | expected GREEN — the link already renders `s.name` | 170-05 |
| N-STRAT each tag chip is one line | V390 | expected GREEN — a chip is already one line; the defect is the nowrap row, which the intersection assertion covers | 170-05 |
| N-STRAT name block ≥ 160px, no intersection | V640 V960 | expected GREEN at these widths | 170-05 |
| N-TABLE Sort select is the hit target after the header passes the filter bar | V390 V640 V960 | RED — sticky header paints over the filter bar's selects | 170-05 |
| N-MATCH no write control visible | V390 | RED — Recompute now and Edit preferences are visible; there is no `md` hide | 170-06 |
| N-MATCH banner contains `768px or wider` | V390 | RED — the banner says `1024px+` | 170-06 |
| N-MATCH at least one write control visible | V960 | expected GREEN — the header bar renders Recompute now and Edit preferences. Send intro, KEEP and SKIP are not renderable: no match-batch seed exists | 170-06 |
| N-CMP no text containing checkboxes | V390 | RED — the empty state says "compare checkboxes" | 170-07 |
| N-CMP one-strategy note | V390 | RED — the note is not rendered | 170-07 |
| populated backstop (composed scenario, no page overflow, no footer/Tweaks intersection) | V390 V640 V960 | RED — covered by the N-FOOT and N-TWEAKS rows above | 170-03, 170-04 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Name and tag update goes through getAdmin()**
- **Found during:** Task 3 (strategies row)
- **Issue:** The first draft built a second Supabase client in the spec. That client never calls `assertNotProductionSupabaseUrl`, so a mis-set `TEST_SUPABASE_URL` would write a production row. The plan's threat register says the admin path is acceptable only because `getAdmin()` guards it.
- **Fix:** `setSeededStrategyNameAndTags` in `e2e/helpers/seed-test-project.ts` updates one row by id through `getAdmin()`. The spec calls that.
- **Files modified:** `e2e/helpers/seed-test-project.ts`, `e2e/layout-narrow.spec.ts`
- **Verification:** `npx tsc --noEmit -p .` exit 0; the spec still lists 24 tests.
- **Committed in:** `5129dd6d9`

**2. [Rule 3 - Blocking] Viewport id in every test title**
- **Found during:** Task 2 verify
- **Issue:** A loop inside one test does not put `V390` / `V640` / `V960` in the title. The plan's verify fails when `--list` shows fewer than 12 of those tokens.
- **Fix:** Each contracted viewport is its own titled test. The body is unchanged.
- **Files modified:** `e2e/layout-narrow.spec.ts`
- **Verification:** `--list` names 24 tests and 24 viewport tokens.
- **Committed in:** `0ae3cadca` (part of the Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both keep the spec able to fail and keep a write off production. No assertion was weakened.

## Issues Encountered

None. Seeded execution is CI-only by the plan, so RED-at-HEAD is predicted, not measured.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 170-03. That plan turns the tab-strip and Tweaks rows GREEN. 170-04 owns the footer and constituent rows, 170-05 the strategies and table rows, 170-06 admin match, 170-07 compare, 170-08 profile.

## Self-Check: PASSED

- FOUND: e2e/helpers/geometry.ts
- FOUND: e2e/layout-narrow.spec.ts
- FOUND: e2e/helpers/seed-test-project.ts
- FOUND: 288fe79a2
- FOUND: 0ae3cadca
- FOUND: 91c5a63db
- FOUND: 5129dd6d9

## Known Stubs

None. The N-SCN V960 test records and does not assert, which the plan requires. The N-MATCH seed cannot render Send intro, KEEP or SKIP; that limit is in the expected-RED table, not a skipped test.

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
