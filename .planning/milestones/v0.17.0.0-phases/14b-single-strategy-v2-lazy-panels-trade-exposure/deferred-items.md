# Phase 14b Deferred Items

Items discovered during 14b execution that are out of scope for the current
plan. Logged here per executor SCOPE BOUNDARY policy.

## From 14b-02 (DESIGN-01 audit on Panel 4 sub-charts)

### 1. MonthlyReturnsBar.tsx — legacy `#059669` positive bar fill

- **File:** `src/components/charts/MonthlyReturnsBar.tsx:39`
- **Line:** `<Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />`
- **Why deferred:** Component is consumed by `src/components/strategy/PerformanceReport.tsx` (v1 strategy detail page); NOT part of Panel 4 in `/strategy/[id]/v2`. The plan's `files_modified` list scopes the DESIGN-01 audit to the four reused-by-Panel-4 chart components only. Touching MonthlyReturnsBar would expand the change surface beyond the plan boundary.
- **Recommended follow-up:** Sweep all v1 chart components in a dedicated DESIGN-01 closeout plan after the v2 cutover lands (post 14b-06).
