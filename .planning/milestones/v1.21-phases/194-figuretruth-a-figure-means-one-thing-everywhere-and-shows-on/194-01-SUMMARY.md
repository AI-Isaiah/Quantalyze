---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 01
subsystem: records
tags: [sc-1, prod-reading, read-only, trust-04, trust-05, d-05]

requires:
  - phase: 193-quietview
    provides: the orchestrator-read plan shape reused here
provides:
  - "194-SC1-READING.md: the read-only PROD reading of what each page shows per TRUST-04 figure, with causes"
  - "D-05 override recorded in ROADMAP Phase 194 (AMENDED line) and REQUIREMENTS TRUST-05"
  - "TODOS [194-ENGINE-CONSTANTS]: the engine-constant residual booked"
affects: [194-02, 194-03, 194-04, 194-05, 194-06, 194-07, 194-08]

actuals:
  tokens: 4203
  tasks: 2
  commits: 2

plan_head_before: 43ede2e4f47bfe55d77752aa9e0508804b335bc8
plan_head_after: 4ad9494173a0854b5082d88d06954a6efaf8054b

tech-stack:
  added: []
  patterns: ["S1 / book labels, money as relations, percentages to 2 dp in a public repo"]

key-files:
  created:
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-SC1-READING.md
  modified:
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - TODOS.md

key-decisions:
  - "D-05 (founder, Show don't flag) overrides the plausibility wording of SC-4 and TRUST-05; recorded in ROADMAP and REQUIREMENTS."
  - "Engine-constant alignment (365 vs 365.25, ddof 0 vs 1) is booked as 194-ENGINE-CONSTANTS, not decided by any D-0x."

requirements-completed: []  # plan 01 records SC-1 and D-05 only; TRUST-04 and TRUST-05 close with the code plans (02-24)

coverage:
  - id: D1
    description: "SC-1 read-only PROD reading recorded before any code of the phase changes"
    requirement: "TRUST-04"
    verification:
      - kind: other
        ref: "Task 2 automated verify in 194-01-PLAN.md (closed lines, no uuid / home path / dollar figure, committed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-05 override recorded in ROADMAP Phase 194 and REQUIREMENTS TRUST-05"
    requirement: "TRUST-05"
    verification:
      - kind: other
        ref: "npx tsx scripts/check-planning-hygiene.ts"
        status: pass
    human_judgment: false

duration: 1 session (two commits, one orchestrator checkpoint)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 01: SC-1 reading and D-05 records Summary

**A read-only PROD reading shows the factsheet disagreeing with the stored row on four named figures (6 Month, 3 Month, VaR 95%, CVaR 95%) for S1, with the D-05 "show, don't flag" override recorded in ROADMAP and REQUIREMENTS before any code changes.**

## Performance

- **Tasks:** 2 (Task 1 executor, Task 2 orchestrator checkpoint)
- **Reading taken:** 2026-11-07T16:54Z, mcp+browser, marker PRODUCTION
- **Files modified:** 4

## Accomplishments

- Wrote the exact read-only statements (Q0 marker, Q1 stored figures, Q2 fleet counts) and the page-reading table.
- Recorded D-05 in ROADMAP Phase 194 (dated AMENDED line above the D-14 / D-15 lines) and REQUIREMENTS TRUST-05; booked `[194-ENGINE-CONSTANTS]` in TODOS.
- The orchestrator took the PROD reading read-only and filled the file; every closed line is present.

Closed lines quoted from `194-SC1-READING.md`:

```
marker: PRODUCTION
sc1-head: ac3fa8c89affb75e7d1866a1271024f514572bf2
sc1-read-at: 2026-11-07T16:54Z
sc1-source: mcp+browser
```

14 `sc1-metric:` lines (6 Month, 3 Month, VaR 95%, CVaR 95%, book equity, book exposure = `differ`; CAGR, Sharpe, Sortino, Calmar, Volatility, Return %, Max DD, tearsheet AUM row = `agree`).

### Key findings (the file's `## Reading` section)

- S1 factsheet vs stored row differ on four figures: 6 Month 15.30% vs 16.60%, 3 Month 21.24% vs 1.89%, VaR 95% -0.86% vs -2.13%, CVaR 95% -2.03% vs -3.40%. The list and tearsheet print the stored values, so one name shows two numbers by page.
- Causes (RESEARCH split): row-count windows in the producer vs calendar windows in the factsheet engine; parametric VaR/CVaR in the producer vs a historical quantile in the factsheet.
- The 3 Month gap is far larger than the 63-row vs 90-day or the 90 vs 91 day difference would explain, so plan 02 must confirm its cause before locking D-03.
- CAGR, Sharpe, Sortino, Calmar, Volatility, Return % and Max DD agree on every page that shows them (factsheet overlays stored scalars at full history). Only the factsheet warns about the short record (256 observations, 0.70y); list and tearsheet print Sharpe, Sortino and Calmar ungated.
- The tearsheet's Minimum Allocation is the list's AUM field (ratio 1.000): one field, two names.
- Book: Overview shows no equity figure (history held back after a failed rebuild); Holdings Gross and Net carry no quantity label; Scenario AUM matches neither Gross (0.815) nor Net (1.022).
- Fleet (Q2): 19 of 27 complete rows span under 365 days and 2 under 90 days (crypto 11 rows, 8 / 1 / 1 under 365d / 90d / 60 obs; traditional 16 rows, 11 / 1 / 1), so the D-14 and D-15 gates will withhold figures on most strategies.

## Task Commits

1. **Task 1: reading statements, D-05 override records, engine-constants entry** - `ac3fa8c89` (docs)
2. **Task 2: record the SC-1 PROD reading** - `4ad949417` (docs)

## Files Created/Modified

- `.planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-SC1-READING.md` - statements, page readings, closed lines, reading
- `.planning/ROADMAP.md` - Phase 194 SC-4 D-05 AMENDED line
- `.planning/REQUIREMENTS.md` - TRUST-05 amendment sentence
- `TODOS.md` - `[194-ENGINE-CONSTANTS]` under a new Phase 194 routed-items section

## Decisions Made

None beyond the plan; D-05 was already a founder decision and is now recorded in both places the deviation policy names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Q1 / Q2 statements tightened for what PROD holds**
- **Found during:** Task 1
- **Issue:** The statements as the plan described them would select example strategies and would miss rows whose status is `complete_with_warnings`; Q2 lacked the observation bound D-15 needs for non-crypto.
- **Fix:** Added `NOT s.is_example` to Q1; accepted `complete_with_warnings` alongside `complete` in Q1 and Q2; added an `under_60_obs` column to Q2.
- **Files modified:** 194-SC1-READING.md
- **Committed in:** `ac3fa8c89`

### Process note (not a rule deviation)

Task 2 was a `checkpoint:human-action`: the ORCHESTRATOR, not a dispatched executor, took the PROD reading (MCP and browser are unavailable to executors) and filled the file, committed in `4ad949417`. This is the plan's own design.

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** statements stay read-only SELECTs; no scope change.

## Issues Encountered

None.

## Verification

- Task 2 automated verify: exit 0 (one each of marker / head / read-at / source, 14 metric lines, no `to fill`, no uuid, home path or dollar figure, file committed).
- `npx tsx scripts/check-planning-hygiene.ts`: exit 0.

## Known Stubs

None. No code was written.

## Self-Check: PASSED

- FOUND: 194-SC1-READING.md
- FOUND: ac3fa8c89, 4ad949417 (ancestors of HEAD)
