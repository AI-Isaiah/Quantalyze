---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 07
subsystem: frontend-factsheet
tags: [tiny-base, factsheet, headline-basis, muted-note, d-02, d-04, d-06, sc-2, sc-5]
requires: ["188-02", "188-06"]
provides:
  - "GUARD_FLAGS row [tiny_base_guard, dust_nav] and once-only reasons in readHeadlineBasis"
  - "payload.dataQuality.tinyBaseDays (validated ascending distinct days) from singleKeyDataQuality"
  - "data-testid=factsheet-tiny-base-note: the muted note counting and naming the left-out days"
affects: ["188-08"]
tech-stack:
  added: []
  patterns: ["present-only dataQuality spread", "muted data-quality paragraph reusing the sibling classes", "day list through formatUnpricedDays unchanged"]
key-files:
  created:
    - src/app/factsheet/[id]/v2/FactsheetView.tiny-base.test.tsx
  modified:
    - src/lib/factsheet/headline-basis.ts
    - src/lib/factsheet/headline-basis.test.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
key-decisions:
  - "D-06 built as decided: a note only. TimeSeriesChart.tsx, build-payload.ts, returns-unit.ts and every seam kind and label are untouched."
  - "The tiny_base_guard row sits directly after dust_nav_guard, not last (see Deviations): the plan's own behavior list needs [negative_nav, dust_nav, pnl_dominated] when all three fire."
status: complete
commits: 4
plan_head_before: a25ce200cc6d8cc24044e7b592905f2da56cede0
plan_head_after: 640c012dc758869e156d80b6c33f479ef354f952
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-03
---

# Phase 188 Plan 07: the strategy factsheet explains a tiny-base break with the existing phrase and names the days left out

**A realized-era tiny-day chain break now reads "a near-zero account balance" once, and a strategy with stored `tiny_base_days` shows one muted line under the chart: `We leave out 2 days on which an account was nearly empty (under 5% of its highest balance over the previous 30 days): Oct 27, 2026 – Oct 28, 2026.`**

## What was built

- `headline-basis.ts`: one `GUARD_FLAGS` row `["tiny_base_guard", "dust_nav"]` (no new `GuardReason`, no new phrase) and `readHeadlineBasis` keeps each reason once, in table order of first occurrence (a `Set` over the mapped reasons), because two flags now map to one reason.
- `types.ts`: `dataQuality.tinyBaseDays?: string[]` with a doc comment (days only, never an amount, present only when non-empty).
- `composite-read-path.ts`: `singleKeyDataQuality` accepts `tiny_base_days?: unknown`, reads it through `readTinyBaseDays` and spreads `tinyBaseDays` present-only, so a clean row's object is byte-unchanged and a malformed list leaves the key out (T-188-12).
- `FactsheetView.tsx`: directly after the flow-timing note, one paragraph with `data-testid="factsheet-tiny-base-note"`, the sibling paragraph's classes and border and the muted token, copy built from the list length, `TINY_BASE_PERCENT`, `TINY_BASE_WINDOW_DAYS` (imported, never restated) and `formatUnpricedDays` (unchanged, now called twice in the file).
- Flow check: the production callers (`fetch-and-build-payload.ts`, two `singleKeyDataQuality(dqf)` call sites, and `readSingleKeyBasisOpts`) pass the whole `data_quality_flags` object, so the key reaches the reader at runtime without editing that file.

## TDD record

### Task 1 (headline reason)

- RED (commit d720d206a), `/tmp/tinybase-07/red1.log`: 2 failed, 63 passed (the lone-flag arm and the three-guard order arm). The "exactly once" arm cannot fail before the row exists (nothing maps yet); it is proven by the neuter drill below.
- GREEN (commit a8c916824): 65 passed.
- Neuter drill (`/tmp/tinybase-07/neuter1.log`): byte backup `hb.bak`, de-duplication removed, the "dust_nav_guard and tiny_base_guard together name that reason exactly once" arm FAILED (1 failed, 64 passed); restored with `cp`, `cmp` clean, 65 passed again.
- The pin arm reads `analytics-service/services/nav_twr.py` raw and asserts `"tiny_base_guard"` is inside the `NAV_TWR_GUARD_KEYS` tuple (plan 02 already put it there).

### Task 2 (the note)

- RED (commit df75c3681), `/tmp/tinybase-07/red2.log`: 6 failed, 127 passed (the `singleKeyDataQuality` lift arm; the three copy arms, the muted/no-glyph arm and the no-amount arm of the new view test, which cannot find the element). The no-note and malformed-list arms pass before the change by construction.
- GREEN (commit 640c012dc): the two target files, 133 passed.
- Neuter drills against byte backup `fv.bak`, each restored with `cp` and `cmp` clean:
  - condition replaced by `false`: 5 failed, 2 passed (`neuter2.log`: all copy/muted/no-amount arms).
  - condition widened to `>= 0` (note always rendered): both "shows no note" arms FAILED (empty list and absent).
- Verify set (`FactsheetView.tiny-base`, `composite-read-path`, `returns-unit`, `tests/visual/strategy-v2-type-scale`, `FactsheetView.kpistrip`, `fetch-and-build-payload`, `headline-basis`): 7 files, 402 tests passed.

## Gates

- `npx tsc --noEmit`: exit 0, no `error TS`.
- `npx eslint` on every changed src file: 0 errors; 1 warning, pre-existing and not mine (`isRankableAnalyticsRow` unused import, `composite-read-path.ts:12`, at the fork point too).
- `npm run lint`: exit 0 (2 pre-existing warnings: that one and `nativeUnitReason` in `MetricsColumn.tsx`), then the admin-route, route-contract, planning-hygiene and canonical-domain checks all OK.
- Full `npx vitest run`: 1186 files passed, 1 failed, 20 skipped (1207); 23402 tests passed, 2 failed, 309 skipped (23713). The only failures are the KNOWN PRE-EXISTING `src/lib/factsheet/compute.conventions.test.ts` fixtures B ("zero-return days") and C ("interior calendar gaps"), frozen inline snapshots whose last-digit `skew` differs (`0.036844507138639` vs `0.036844507138638946`). They fail identically at the fork point and in the main checkout; the file was not touched.
- Acceptance greps: `factsheet-tiny-base-note` 1 in `FactsheetView.tsx`; `formatUnpricedDays(` 2 (baseline 1); `grep -aE 'under (5|30)\b|previous 30'` prints nothing; `"tiny_base"` as a reason member 0, the row `["tiny_base_guard", "dust_nav"]` 1; `git diff --stat` of `TimeSeriesChart.tsx`, `build-payload.ts`, `returns-unit.ts` against the plan base prints nothing.

## DESIGN.md re-read (agreement record)

Re-read at execution: "Voice / microcopy" (declarative sentence-case, state the limitation with its threshold, no adjective where a number exists, active voice), the colour semantics (muted = steady-state, honest-empty; `--color-text-muted` #64748B for captions), and the 2026-04-29 v2 4-size / 2-weight contract. **Agreement with the plan's check, no conflict.** The note is a `<p>` with the flow-timing sibling's exact classes (`px-3 sm:px-4 py-2 text-micro font-mono`), the same `borderTop` and `var(--color-text-muted, #64748B)`; no new colour, no new size, no glyph; "We leave out" is active voice; 5% and 30 days are attached; the count and dates are the figures. `tests/visual/strategy-v2-type-scale.test.ts` passes unchanged, so the sibling classes hold against the v2 contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's instruction] `tiny_base_guard` row placed after `dust_nav_guard`, not last**
- **Found during:** Task 1 GREEN.
- **Issue:** the plan says to append the row as the LAST row of `GUARD_FLAGS`, and its own behavior list says that with `negative_nav_guard`, `tiny_base_guard` and `pnl_dominated_guard` all true the reasons are `["negative_nav", "dust_nav", "pnl_dominated"]` (the UI-SPEC section 1.2 order). With the row last and first-occurrence de-duplication the result is `["negative_nav", "pnl_dominated", "dust_nav"]`, which fails the behavior and the order the phrases are joined in.
- **Fix:** the row sits directly after `dust_nav_guard` (the row it shares a reason with); a comment says why. The acceptance greps still hold.
- **Files modified:** `src/lib/factsheet/headline-basis.ts`.
- **Commit:** a8c916824.

No existing test newly failed; no STOP rule fired.

## Recorded consequences and carried limits

- **D-06 as built:** note only, naming the days. No chart seam kind, no seam label, the chart line is unchanged. The My Allocation book and a single-key strategy get the note only, not a chart gap.
- **D-06 consequence (T-188-13, accepted):** a published strategy's factsheet is public, so it now tells any viewer on which days the account held under 5% of its highest balance over the previous 30 days. The note carries dates and the fixed threshold only, never a balance, an amount or the peak (an arm pins no currency symbol, unit or thousands-separated number in the text).
- **T-188-12 (mitigated):** the count is the length of the list `readTinyBaseDays` accepted whole, and the dates come from that same list; malformed arms (string, impossible date, mixed good and bad, number, null) leave the key out and show no note.
- **KL-2 (carried limit):** a composite factsheet whose member had a tiny day that no other member covers keeps its existing "no data" seam (from `gap_spans`); this plan adds nothing to the composite arm beyond the note when its flags carry the list. This plan does not edit the composite arm's own `dataQuality` build.
- Plan 08 only has to feed `dataQuality.tinyBaseDays` for the allocator book; the note and its tests already cover that field.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change; the one new public surface (the note naming days) is T-188-13, already in the plan's register.

## Self-Check: PASSED

- Files: `FactsheetView.tiny-base.test.tsx`, `headline-basis.ts`, `types.ts`, `composite-read-path.ts`, `FactsheetView.tsx` present.
- Commits d720d206a, a8c916824, df75c3681, 640c012dc are ancestors of HEAD on `wt/188-p07`; `git rev-list --count a25ce200c..640c012dc` is 4.
- STATE.md and ROADMAP.md untouched.
