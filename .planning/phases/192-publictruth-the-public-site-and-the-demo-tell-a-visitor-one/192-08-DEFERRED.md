# Plan 192-08: superseded, its retire branch moved to 192-14 (public demo retired, D-11)

**Decided:** 2026-11-07, by the founder. He retired the public demo (`192-CONTEXT.md` **D-11**) and answered this plan's Task 2 with "Retire it (Recommended)".
**Requirement:** ROUTE-03. Phase 192 PUBLICTRUTH still delivers it through plans 192-11 to 192-17 and the ship gate in 192-10.
**Owning phase for the work:** **Phase 192** (plan 192-14 absorbs Task 3's retire branch).

## Why this file exists

Plan 08 will never run again, so it will never get a SUMMARY. Without this marker, `scripts/verify-plan-anchors.mjs --pending` would keep scanning its `@` references, and plan 192-14 deletes those files (`e2e/demo-public.spec.ts`, `e2e/demo-screenshot.spec.ts`). A SUMMARY for work nobody did would be a fabrication. Like `164.3-07-DEFERRED.md`, this marker is the honest way out.

## What happened to each task

- Task 1 ran. Commit `b9507cf59` added the unseeded-lane "fails loud" describe to `e2e/demo-public.spec.ts`. Plan 192-14 deletes that spec whole.
- Task 2 was answered "Retire it (Recommended)". `192-EVIDENCE.md`, section `## D-08-SCREENSHOT decision (plan 192-08 Task 2)`, records it.
- Task 3's retire branch belongs to plan 192-14: the pixel spec, its three PNGs, the bake plumbing in `ci.yml`, and the critical-regressions comment. The seeded truth checks it would also have added have nothing to check once the demo is gone. No seeded-render baseline is booked.

The frontmatter carries `status: superseded`, so the phase-plan index leaves this plan out of waves and counts. 192-14 owns every file this plan listed, and this plan never executes, so nothing overlaps.
