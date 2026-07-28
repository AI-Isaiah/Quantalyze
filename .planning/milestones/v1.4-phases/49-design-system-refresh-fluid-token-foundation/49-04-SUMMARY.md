---
phase: 49-design-system-refresh-fluid-token-foundation
plan: 04
subsystem: ui
tags: [truncation, ellipsis, line-clamp, accessibility, audit, fluid-type, design-system]

# Dependency graph
requires: []
provides:
  - ".planning/audits/truncation-audit.md — TYPE-01 census classifying all 48 clip/ellipsis sites in src/ as legitimate (16) vs accidental-clip (32), plus 1 documented deliberate no-clip"
  - "Accidental-clip shortlist (32 sites, file:line) so phases 52/53 add a recovery affordance instead of relocating the clip when fluid type lands"
affects: [52, 53, fluid-type-per-surface, truncation, accidental-clip]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only classification audit under .planning/audits/ (net-new dir): file:line | pattern | classification | recovery affordance — informs, does not gate"
    - "legitimate = title/aria-label/tooltip recovery OR non-meaningful bounded affordance; accidental-clip = meaningful content clipped with no recovery"

key-files:
  created:
    - ".planning/audits/truncation-audit.md"
  modified: []

key-decisions:
  - "Excluded non-CSS 'truncate' (gdpr-export.ts / audit.ts data-cap code) and decorative ellipsis ('Syncing…' / 'Recording…' button labels, the ${days}… ongoing-episode marker) — only CSS clip/ellipsis affordances are in scope for TYPE-01"
  - "Classified each site by reading the owning component, not the grep line — several truncate cells carry a sibling title={…} (legitimate) the class string does not reveal (e.g. both correlation matrices, ComputeJobsTable, compute-jobs error cells)"
  - "Fixed KPI labels/values (FactsheetView), short id slices, and the hard-coded demo-banner subtitle are legitimate single-line affordances (no meaningful prose to recover), not accidental clips"
  - "Recorded ScopedBanner's deliberate NO-truncate (H-0408 trust-scope slug must show in full) as the reference wrap pattern phases 52/53 should adopt"

patterns-established:
  - "Accidental-clip shortlist grouped by content kind (names / identity / free-text / line-clamp prose) with a per-group recommended fix for 52/53"

requirements-completed: [TYPE-01]

# Metrics
duration: 18min
completed: 2026-06-29
---

# Phase 49 Plan 04: Truncation Classification Audit (TYPE-01) Summary

**Live-grep census of all 48 clip/ellipsis sites in `src/`, each tagged legitimate (16, recovers via title/aria/tooltip or is a non-meaningful bounded affordance) vs accidental-clip (32, meaningful content clipped with no recovery), with a 32-site shortlist + per-group fix guidance feeding phases 52/53.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 1
- **Files modified:** 1 created (`.planning/audits/truncation-audit.md`); 0 `src/` files touched

## Accomplishments
- Created the `.planning/audits/` directory (net-new) and the TYPE-01 audit doc.
- Ran the full census (`rg` over `src/`, excluding tests): 37 `truncate`, 7 `line-clamp-N`, 2 `text-ellipsis` (the only `overflow-hidden`+`whitespace-nowrap` idiom, both in `FactsheetView.tsx`), 2 manual `…` idioms = 48 clip sites + 1 deliberate no-clip.
- Read each owning component to determine the real recovery affordance (title / aria-label / tooltip), not just the grep line — this flipped several `truncate` cells to **legitimate** that the class string alone would have mis-tagged.
- Classified all 49 table rows: 16 legitimate clips + 1 deliberate no-clip (`ScopedBanner`) + 32 accidental-clip.
- Wrote a grouped Accidental-clip shortlist (names / API-key+identity / free-text reasons-notes-messages / line-clamp prose) with a per-group recommended handling so phases 52/53 fix the clip rather than relocate it.

## Task Commits

This plan's sole deliverable lives under `.planning/`, which is **gitignored by design** (the live planning ledger is local-only — see PROJECT.md Key Decisions / PR #530). There is therefore **no code commit** — `git status --porcelain src/` is empty and `git check-ignore` confirms the audit path is ignored. This is the expected outcome per the plan objective, not a failure.

1. **Task 1: Generate the truncation census and classify every site** — no commit (gitignored `.planning/` artifact; verified via `test -f` + `grep`)

**Plan metadata:** the SUMMARY / STATE / ROADMAP updates are likewise under gitignored `.planning/` — local-only.

## Files Created/Modified
- `.planning/audits/truncation-audit.md` — TYPE-01 truncation classification: header (informs 52/53, not a gate, dated), census summary table (per-pattern counts), full 49-row `file:line | pattern | element/context | classification | recovery affordance | note` table, a 32-entry Accidental-clip shortlist, and per-group fix recommendations.

## Decisions Made
- **Scope of "truncation":** only CSS clip/ellipsis affordances. Excluded the word "truncate" in `gdpr-export.ts` / `audit.ts` (data-size caps), decorative loading ellipsis (`"Syncing…"`, `"Recording…"`), and `WorstDrawdowns.tsx`'s `${durationDays}…` ongoing-episode marker.
- **Classification from source, not grep:** both correlation matrices (`CompareCorrelationMatrix`, risk `CorrelationMatrix`), `ComputeJobsTable`, and the compute-jobs error cells carry a sibling `title={…}` → legitimate; `CorrelationHeatmap` headers recover via per-cell `aria-label`.
- **Bounded non-meaningful affordances = legitimate:** the `FactsheetView` KPI labels/values, short id slices (`compute-jobs` id, `PortfolioOptimizer` strategy_id), and the hard-coded `demo/layout` subtitle clip nothing recoverable.
- **`ScopedBanner` no-clip recorded as the reference pattern** (`break-words` + `min-w-0`) for 52/53.

## Deviations from Plan

None - plan executed exactly as written. No code modified, no dependency added, no CI gate introduced (the optional census-count guard was deferred per 49-RESEARCH, as the plan specified).

## Issues Encountered
- The raw `rg "truncate" src/` census was heavily polluted by non-CSS uses (the `gdpr-export.ts` data-truncation domain, `audit.ts`, test files). Resolved by scoping the search to `className="…truncate…"` matches in non-test source and reading each hit — yielding 37 genuine CSS `truncate` sites.
- Internal count reconciliation: an early draft summary line under-counted; corrected the tally to match the table exactly (49 rows = 16 legitimate clips + 1 deliberate no-clip + 32 accidental-clip; shortlist verified at 32 bullets).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TYPE-01 is satisfied: the audit is ready to feed phases 52/53. The 32-site accidental-clip shortlist is the actionable input — each entry names the surface and the missing recovery affordance, so 52/53 can add a `title`/tooltip or adopt the `ScopedBanner` wrap pattern as they introduce fluid `--text-*` (never re-clip at the new size).
- No blockers. This plan is independent of the token/lint spine (49-01/02/03) and added no code surface.

## Self-Check: PASSED

- `.planning/audits/truncation-audit.md` — FOUND
- `.planning/phases/49-design-system-refresh-fluid-token-foundation/49-04-SUMMARY.md` — FOUND
- Plan verify `AUDIT-OK` (file exists + contains `accidental-clip` + `legitimate`) — PASSED
- `git status --porcelain src/` empty (read-only, no `src/` modification) — PASSED
- Both deliverables are gitignored under `.planning/` (no code commit expected — per plan objective) — confirmed

---
*Phase: 49-design-system-refresh-fluid-token-foundation*
*Completed: 2026-06-29*
