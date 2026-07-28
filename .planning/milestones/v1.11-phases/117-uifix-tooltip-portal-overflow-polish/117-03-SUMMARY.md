---
phase: 117-uifix-tooltip-portal-overflow-polish
plan: 03
subsystem: ui
tags: [factsheet, kpi, numbers-contract, truncation, tailwind, break-words, min-w-0, axe, wcag]

# Dependency graph
requires:
  - phase: 117-uifix (plan 01)
    provides: RED-first rendered-className regression precedent on the factsheet UI surface
  - phase: 117-uifix (plan 02)
    provides: the ring-inset focus className already on the FactsheetView section-nav anchors (left byte-untouched here)
provides:
  - The CUM RETURN KPI value renders extreme/high-leverage magnitudes IN FULL — the truncation trio removed from the value <p> and replaced with a break-words wrap allowance + min-w-0 grid-cell shrink so a long value wraps within its track instead of ellipsizing (Numbers-Contract integrity)
  - RED-first extreme-value no-ellipsis regression + the label-clip guard + the sibling-uniformity/signTone guard in FactsheetView.kpistrip.test.tsx
  - Phase-close acceptance: the axe route x viewport public floor re-run GREEN (15 cells), authed/embedded/strategy-v2 cells recorded as seed-env-gated (run on CI/PR)
affects: [117-uifix phase close, any factsheet viewer under high leverage where CUM RETURN formats to a long string]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "break-words on a KPI value <p> + min-w-0 on its grid cell — the grid-item min-width:auto default otherwise pins the track to the number's min-content width, so min-w-0 is what lets an extreme value WRAP within the track instead of overflowing the overflow-hidden panel (removing the truncation trio alone would clip, not wrap)"
    - "type never shrunk below the DESIGN.md text-h2 minimum — the fix is layout (wrap/fit), not a smaller type token"

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx

key-decisions:
  - "Removed all three truncation tokens (whitespace-nowrap overflow-hidden text-ellipsis) from the VALUE <p> and added break-words, plus min-w-0 on the cell wrapper. min-w-0 is load-bearing: break-words does not reduce a word's min-content size, so without min-w-0 the grid item stays pinned to the full number width and the section (overflow-hidden) would clip the extreme value rather than wrap it (Rule 6 root-cause, not a bandaid)"
  - "Updated the superseded 52-06 value pin (kpistrip Test 2, line ~140: 'VALUE cell keeps whitespace-nowrap / no wrap mid-number') to the UIFIX-03 contract (break-words present, whitespace-nowrap absent). The old 'no wrap mid-number' intent directly contradicts the newer Numbers-Contract requirement that an extreme value must render in full — Rule 7: surface the conflict, pick the more-recent/tested option, don't blend"
  - "The LABEL <p> kept its bounded-label clip (whitespace-nowrap overflow-hidden text-ellipsis) byte-untouched — a pinned legitimate affordance (kpistrip Test 2 label half); the 117-02 ring-inset focus className on the section-nav anchors was left byte-untouched"
  - "Sibling-uniformity holds by construction: all value cells render from ONE items.map with a single shared className, so the single-class change can never visually diverge CAGR/Sharpe/Sortino — asserted (Set of value classNames size === 1)"

requirements-completed: [UIFIX-03]

# Metrics
duration: 14min
completed: 2026-07-18
---

# Phase 117 Plan 03: UIFIX-03 CUM RETURN No-Truncation Summary

**Replaced the CUM RETURN KPI value `<p>`'s truncation trio (`whitespace-nowrap overflow-hidden text-ellipsis`) with a `break-words` wrap allowance and added `min-w-0` on the grid cell, so extreme high-leverage magnitudes render IN FULL (wrapping within their track) instead of being ellipsis-truncated — a truncated number reads as a different number (Numbers-Contract integrity) — while the label bounded-label clip, every sibling KPI card, the `text-h2` type minimum, and the signTone gate stay identical, and the axe public route x viewport floor re-runs green.**

## Performance

- Duration: ~14 min across 3 tasks (2 commits: RED test, then the layout fix; Task 3 was a verification-only axe re-run with nothing to commit).

## What Was Built

**Task 1 (`ad829203`, test — RED):** New `describe("UIFIX-03 (117-03): CUM RETURN extreme value renders untruncated")` in `FactsheetView.kpistrip.test.tsx`, reusing the existing FactsheetBody harness (override `strategyMetrics.cum_ret = 12345.678` under cash → the view returns the payload by reference; also `sharpe = NaN` to exercise the colorless "—" gate):
- **Test 1 (RED):** the extreme value derived through the REAL `pctSigned` formatter (`"+1234567.8%"`, no hand-fabricated string) renders as full textContent; the VALUE `<p>` className contains NONE of `whitespace-nowrap` / `overflow-hidden` / `text-ellipsis` (the trio IS the clip mechanism — its absence is the checkable no-ellipsis contract in jsdom); and it still carries `font-mono tabular-nums text-h2 leading-none` with NO smaller type token (type never shrunk).
- **Test 2 (guard):** the CUM RETURN LABEL `<p>` STILL contains all three truncation tokens — the pinned bounded-label clip is preserved.
- **Test 3 (guard):** every value cell shares ONE className (Set size === 1, sibling uniformity by items.map construction) and the signTone gate is unchanged — a positive cum_ret is `var(--color-positive)`, a non-finite "—" stays `var(--color-text-primary)` (colorless).

Test 1 failed by ASSERTION on the unfixed tree (trio present); Tests 2-3 + all 17 pre-existing kpistrip tests stayed green.

**Task 2 (`bd360846`, fix — GREEN):** surgical className edits in `FactsheetView.tsx` (`git diff` touched ONLY the value `<p>` className, a `min-w-0` on the cell wrapper, and one explanatory comment — label `<p>`, panel wrapper, grid classes, and hairlines byte-identical):
1. VALUE `<p>` (`:884`): `…text-h2 leading-none whitespace-nowrap overflow-hidden text-ellipsis` → `…text-h2 leading-none break-words`.
2. Cell wrapper (`:874`): `px-3 py-3 sm:px-4 sm:py-4` → `+ min-w-0` (load-bearing — lets the grid track shrink so `break-words` wraps the long value instead of the section clipping it).
3. Updated the superseded 52-06 value pin in the same test file (the "no wrap mid-number" assertion) to the UIFIX-03 contract (see Deviations).

**Task 3 (verification-only, axe acceptance):** re-ran `e2e/axe-app-wide.spec.ts e2e/strategy-v2-axe.spec.ts` against the running dev server (Playwright `reuseExistingServer`). See the matrix table below. Exit 0, zero failures, zero new axe exclusions (`git status --short e2e/` empty). Nothing to commit.

## Verification

- Task 1: Test 1 RED by className assertion; Tests 2-3 + 17 pre-existing kpistrip tests green.
- Task 2: Task-1 Test 1 GREEN; label + sibling guards green; kpistrip + `FactsheetView.leverage.test.tsx` + `FactsheetView.leverage-honesty.test.tsx` = **46/46 green**; whole `src/app/factsheet/[id]/v2/` sweep = **29 files / 241 tests green**; `npx tsc --noEmit` exit 0; `eslint` on both touched files clean.
- Scope checks: value `<p>` retains `text-h2` (grep-checkable) with no smaller type token; label `<p>` byte-identical; the 117-02 ring-inset focus className on nav anchors byte-untouched; no `e2e/` diff.

### Axe route x viewport matrix (Task 3)

Local env has NO seed vars (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` unset), so the authed/embedded rows self-skip by design (the shared MA-8 test DB is not hermetic for a broad authed matrix — the spec's own header documents this). The hermetic PUBLIC floor is the local deliverable; the full matrix runs on CI/PR with seed env.

**RAN GREEN (15 cells) — public routes x 3 viewports (Desktop 1280x800, mobile 375x812, ultrawide):**

| Route | Desktop | mobile | ultrawide |
|-------|---------|--------|-----------|
| `/` | ✅ | ✅ | ✅ |
| `/security` | ✅ | ✅ | ✅ |
| `/for-quants` | ✅ | ✅ | ✅ |
| `/browse` | ✅ | ✅ | ✅ |
| `/demo` | ✅ | ✅ | ✅ |

**SEED-ENV-GATED, DID NOT RUN LOCALLY (16 cells, self-skipped — fail-loud recorded, run on CI/PR):**
- authed standalone x 3 viewports: `/allocations`, `/strategy/[id]/v2`, `/discovery/[slug]`, `/strategies/new/wizard` (12 cells)
- embedded factsheet (composer, serious+critical) `/allocations?tab=scenario` x 3 viewports (3 cells)
- `strategy-v2-axe` `/strategy/{id}/v2` full-7-panel scan (1 cell)

The seed-gated cells include the exact surfaces that FOLD the factsheet KPI strip changed here (`/strategy/[id]/v2`, `/factsheet/[id]/v2` via the focused specs, the embedded composer factsheet). The change is className-only (no color/contrast/aria surface), so it introduces no new axe risk; the full matrix confirms on the PR run.

## Deviations from Plan

### Test maintenance forced by a superseded pin (Rule 7 conflict)

**1. [Rule 7 - conflict] Updated the 52-06 value `whitespace-nowrap` pin to the UIFIX-03 contract**
- **Found during:** Task 1 planning survey / Task 2 execution.
- **Issue:** the pre-existing 52-06 kpistrip Test 2 pinned `expect(valueEl.className).toContain("whitespace-nowrap")` on the VALUE cell ("no wrap mid-number"). This DIRECTLY contradicts UIFIX-03's requirement to remove the truncation trio from the value — the two cannot both hold. The plan's Task-1 note "no pre-existing kpistrip assertion is edited or weakened" is inconsistent with its own Task-1 Test-1(b) (value must contain NONE of the trio) and Task-2 action (remove the trio); the planner did not flag this specific line.
- **Fix:** in Task 2, changed the value assertion from `toContain("whitespace-nowrap")` to `toContain("break-words")` + `not.toContain("whitespace-nowrap")`, with a comment recording that UIFIX-03 supersedes the old "no wrap mid-number" intent. The LABEL half of that same test (label keeps the trio) was left untouched. This is not a weakening — it re-pins the value cell to the newer, more-tested Numbers-Contract contract (Rule 7: pick the more-recent option, surface the conflict).
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx`.
- **Commit:** `bd360846`.

### Layout-fix discretion (plan-sanctioned)

**2. [plan discretion] Added `min-w-0` on the cell wrapper**
- **Found during:** Task 2.
- **Rationale:** the plan left `min-w-0` to implementer discretion ("ONLY if the grid track otherwise refuses to shrink"). `break-words` (overflow-wrap: break-word) does NOT reduce a word's min-content size, so a grid item with default `min-width:auto` stays pinned to the full number width → the track expands and the `overflow-hidden` panel clips the extreme value instead of wrapping it. `min-w-0` is therefore required for the value to actually render in full (Rule 6 root-cause). It is visually inert for short sibling values.
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.tsx`.
- **Commit:** `bd360846`.

No other deviations — the value `<p>` and cell wrapper were the only production edits; the axe re-run added no exclusions.

## Known Stubs

None. The change is an additive/removal className edit on a live rendered number; no placeholder or empty-data path introduced. The existing em-dash null rule (Numbers Contract) is preserved.

## Threat Flags

None. Per the plan `<threat_model>` this is a className-only change to a rendered formatted number — no data flow, input surface, endpoint, auth path, or schema touched. T-117-03 (truncation misrepresents the metric) is the threat this fix mitigates.

## Self-Check: PASSED

- Modified file exists: `src/app/factsheet/[id]/v2/FactsheetView.tsx` — FOUND (value `<p>` now `break-words`, no truncation trio; cell wrapper has `min-w-0`).
- Modified file exists: `src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx` — FOUND (UIFIX-03 describe added; 52-06 value pin updated).
- Commits exist: `ad829203` (test, RED) FOUND; `bd360846` (fix, GREEN) FOUND.
