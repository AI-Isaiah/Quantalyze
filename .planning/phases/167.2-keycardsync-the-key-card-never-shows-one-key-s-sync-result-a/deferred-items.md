# Phase 167.2 — deferred items (out of scope for the plan that found them)

## Found during 167.2-07 (2026-09-24)

- **The discovery-detail fallback still says "still computing".**
  `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` renders
  "The detailed factsheet for this strategy is still computing." on its own
  payload-pending fallback. That is the same claim KCS-10 removed from the
  factsheet v2 placeholder, and it is false for a failed or never-started
  strategy. It is outside plan 07's `files_modified` and outside the UI-SPEC
  surface map (S1 to S9), so it was not touched. Whoever owns it next should
  decide whether it is a user-facing defect that earns a phase or a fix inside
  a later 167.2 plan.
