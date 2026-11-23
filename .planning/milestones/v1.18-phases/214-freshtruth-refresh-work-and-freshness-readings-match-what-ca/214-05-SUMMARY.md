---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 05
subsystem: ui
tags: [freshness-chip, layout, playwright, seeded-e2e, local-stack, sc-5, plan-stop]
requires: []
provides:
  - "e2e/freshness-chip-width.spec.ts: seeded 1485px measurement of the FreshnessChip label, its masthead column and SyncBadge's future text"
affects: [214-07]
tech-stack:
  added: []
  patterns: ["narrow-column condition asserted so an unsqueezed GREEN fails instead of passing", "per-worker seed prefix so one worker's afterAll cannot delete another worker's rows"]
key-files:
  created:
    - e2e/freshness-chip-width.spec.ts
  modified: []
key-decisions:
  - "STOPPED after Task 1 under the plan's own rule: the overflow does not reproduce and the narrow-column condition cannot be exercised, so no class changed and SC-5 is handed back"
  - "The ci.yml list line was NOT added (the not-exercised case fails by design, and the plan says not to wire it)"
  - "SyncBadge.tsx untouched: its future text wraps inside its badge and fits (GREEN)"
metrics:
  duration: "about 50 minutes"
  completed: 2026-11-14
status: partial
actuals:
  tokens: 3000
  tasks: 1
  commits: 1
plan_head_before: 49aa623ff570fa0fd5cddbb7ee41d8a1e25734be
plan_head_after: b03488c7388ef8b6af654d2c210302b06500217b
---

# Phase 214 Plan 05: FreshnessChip label at 1485px Summary

**The chip label overflow from TODOS `0.12` does not reproduce at 1485px, or at any width from 360px to 1485px, on the unchanged classes. The plan's STOP rule applies: no class was changed, the ci.yml line was not added, and SC-5 goes back to the orchestrator.**

## Outcome

Task 1 (tracer) ran to completion on the local-stack lane. Tasks 2 and 3 were not run, by the plan's own rule (Execution rules: "If (a) is GREEN but the column was NOT constrained, report 'not exercised', change no class, and hand back"; "In the not-exercised case do NOT add the ci.yml line").

`status: partial` is deliberate: SC-5 is NOT closed and SC-7 for SC-5 is NOT met (there is no RED to pin). TODOS `0.12` must not be deleted at ship on this plan's evidence.

## Task 1: measurement (commit `b03488c73`)

Environment: local-stack lane (`scripts/local-stack/run.sh up`, 32 s, `--assert-local-handoff` passed: loopback API_URL and DB_URL, values not printed), the Playwright config's own `npm run dev`, 1485 x 900 viewport, headless chromium. The stack was torn down at the end (`run.sh down`, no containers left, port 3000 free).

Spec, three tests, run with `--retries 0` on the unchanged `FactsheetView.tsx`:

| Test | Result | Measured |
|---|---|---|
| a. future tone `Track record · future — check data` | RED by design: `narrow-column condition not exercised: column 295.3px` | label row scrollWidth 295, clientWidth 295, rect 295.3px; chip column 295.3px |
| b. baseline `Computed · fresh` | GREEN | label row 199 / 199, rect 199.3px; chip column 199.3px (<= 230, exercised) |
| c. SyncBadge `Trades fetched · future — check data` | GREEN | rect 188.7px, height 30px, scrollWidth 189 / clientWidth 189; text inside its badge |

Seed pressure on (a): a 76-character strategy name (the `e2e-p214-` prefix plus `Systematic Multi-Venue Basis Carry and Volatility Overlay Programme`, which wraps to two lines in the left column) and a 300-character description, series end five days ahead so the tone reads `future`. The screenshot shows the left column at its `max-w-3xl` (768 px) cap.

### Why the column cannot be squeezed (structure, then measurement)

The masthead is `flex flex-col sm:flex-row sm:flex-wrap sm:justify-between` (FactsheetView.tsx 1548). The chip column is its second child. Because the row wraps, a child that does not fit moves to its own line; it is never shrunk below its max-content. The left child is capped at 768 px. At 1485 px the article is 1360 px wide (`max-w-[1440px]` less padding), so 768 + 16 + 295 = 1079 fits on one line and the chip column takes exactly its max-content: the label's own width. The chip column is therefore only ever as wide as its widest line, never narrower than the label.

Measured, not assumed: a viewport sweep of the unchanged classes (future-tone strategy, same pressure), `vw: column / chip / label row / scrollWidth / row height`:

```
1485: 295.3 / 295.3 / 295.3 / 295 / 16
1280: 292.1 / 292.1 / 292.1 / 292 / 16
1100: 288.9 / 288.9 / 288.9 / 289 / 16   (column wraps to its own line from here down)
1000: 287.3 / 287.3 / 287.3 / 287 / 16
 900: 285.7 / 285.7 / 285.7 / 286 / 15
 800: 284.1 / 284.1 / 284.1 / 284 / 15
 700: 282.3 / 282.3 / 282.3 / 282 / 15
 641: 281.5 / 281.5 / 281.5 / 281 / 15
 600: 568.0 / 280.7 / 280.7 / 281 / 15   (below sm: column is full width)
 420: 388.0 / 277.8 / 277.8 / 278 / 15
 360: 328.0 / 277.2 / 277.2 / 277 / 15
```

At every width the label stays on one line (row height 15 to 16 px, one line of `text-micro`), scrollWidth equals clientWidth, and the document has no horizontal overflow (`documentElement.scrollWidth` equals the viewport at every width). There is no width at which the label wraps, overflows or is clipped. All three routes that render `FactsheetHeader` (`/factsheet/[id]/v2`, `/factsheet-share/[token]`, the tearsheet) use the same full-width article; the only other `FactsheetView` embedders either hide the header or are the print view.

The `297.9px in 204.2px` figure (2026-08-26, commit `cb8b0708c`) predates the Phase 164.6.6.2 masthead changes; RESEARCH A10 flagged it as unreliable and the markup alone does not explain it. I could not construct a state that reproduces it.

### SyncBadge reading (c)

`future — check data` in `SyncBadge` is the trade-fetch arm (`Trades fetched · future — check data`, SyncBadge.tsx 329-338), not a freshness chip. `StrategyHeader`, the other mount, is mounted nowhere (its own header says so), so the only reachable surface is the discovery table's pinned name cell (also StrategyGrid and `/recommendations`). The spec seeds a strategy into `crypto-sma` with a codename (un-coded rows are hidden by "Hide examples"), writes `strategy_analytics.trades_fetched_at` five days ahead through the guarded service-role client, logs in as a seeded allocator, and measures the badge at 1485 px. In that column the badge text does wrap (the sentence breaks over several lines inside the badge, which is the shape the founder chose for the chip), and it fits: `assertChildrenInside` passes and scrollWidth equals clientWidth. SyncBadge is therefore unchanged, as the plan requires when (c) is GREEN.

### Step 0 ancestor table (Task 2)

Not produced: Task 2 did not run, so there is no overflowing element to name. The walk from the label row is: label row, chip root `<div>`, the `<div>` pairing the chip with the recency and trade-fetch lines, the `sm:flex-col` wrapper, the `flex-wrap` masthead row. Reading the markup (FactsheetView.tsx 1548-1601, 1898), none of them sets `whitespace-nowrap`, a `min-width` or an `overflow` class; this is from the source, not from a computed-style walk.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The first spec passed vacuously**
- **Found during:** Task 1, first green run
- **Issue:** Next streams Suspense content into a hidden template and swaps it in. `toHaveText` matched the hidden copy, so `getBoundingClientRect()` returned 0 x 0 and every "fits" assertion passed on a zero-width row (measured `rect=0.0px column=0.0px`, 2 passed).
- **Fix:** the spec now waits for `toBeVisible()` and a polled bounding box width greater than 0 before measuring, and asserts the column carries `sm:flex-col`.
- **Files modified:** e2e/freshness-chip-width.spec.ts
- **Commit:** b03488c73 (the spec was committed once, after this fix)

**2. [Rule 1 - Bug] Shared prefix let one worker's afterAll delete another worker's seed**
- **Found during:** Task 1, test (c)
- **Issue:** the three tests run on three workers; the first worker to finish ran `cleanupStrategiesByNamePrefix("e2e-p214-")` and deleted the strategy test (c) was about to read, so (c) saw "No strategies match your filters".
- **Fix:** per-worker prefix `e2e-p214-w<TEST_PARALLEL_INDEX>-` (the `layout-narrow.spec.ts` precedent). Still starts with `e2e-p214-`.
- **Files modified:** e2e/freshness-chip-width.spec.ts
- **Commit:** b03488c73

### Plan-defined stops (not deviations)

- Tasks 2 and 3 not executed: STOP rule for an unexercised GREEN. No class changed, `ci.yml` untouched, `SyncBadge.tsx` untouched.
- Neuter N1 (SC-7) not run: it needs the Task 2 fix to exist.

## Acceptance check for Task 1

- `node scripts/verify-plan-anchors.mjs` exit 0 before any edit (15 claims, no stale).
- `--list` shows 3 tests; `npx tsc --noEmit -p tsconfig.json` exit 0.
- `grep -a -c HAS_SEED_ENV` = 4, `grep -a -c 'width: 1485'` = 1 (the `VIEWPORT` constant, spread into `setViewportSize`; every test uses it), `grep -a -c 'e2e-p214-'` = 3.
- The SUMMARY carries branch (ii)/(iii) of the criterion in its "not exercised" form: the measured (a) and (b) widths, and (c)'s reading.

## Needs the orchestrator

1. **SC-5 decision.** The defect does not reproduce, so either amend SC-5 to "recorded as not reproducible at HEAD, with the measurement above" or point it at a different surface. The founder decision (wrap, keep the sentence, no copy change) stays untouched; nothing contradicts it.
2. **Do not delete TODOS `0.12` on this evidence as "fixed".** If the founder accepts "does not reproduce" it may be deleted with that wording in the CHANGELOG.
3. **The committed spec fails by design** on test (a) when the seed env is set (it names `narrow-column condition not exercised`), so it is NOT in the `e2e-seeded` list; adding it would redden CI. If SC-5 is closed as not reproducible, delete the spec or drop test (a); if a squeezed state is ever found, the spec is the ready-made RED/GREEN measurement and the ci.yml list line goes in then.
4. `npm run dev` rewrote `AGENTS.md` (the `next dev` agent-rules block). I restored it with `git checkout -- AGENTS.md` after the dev server stopped; expect it to reappear on any dev-server run.

## Known Stubs

None.

## Threat Flags

None. The spec writes through the guarded service-role client (`assertNotProductionSupabaseUrl` and `assertSupabaseServiceRoleKey`), only to the loopback lane, scoped by id or by the `e2e-p214-w<n>-` prefix; the handoff values were never printed.

## Self-Check: PASSED

- FOUND: e2e/freshness-chip-width.spec.ts
- FOUND: commit b03488c73 (ancestor of HEAD)
- STATE.md and ROADMAP.md not modified; ci.yml, FactsheetView.tsx, SyncBadge.tsx not modified.
