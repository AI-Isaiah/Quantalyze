---
status: partial
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
source: [47-VERIFICATION.md]
started: 2026-06-28
updated: 2026-06-28
---

## Current Test

[awaiting human / seeded-CI / real-device testing — both items are designed deferrals, not gaps]

## Tests

### 1. Bake the `svg-chart-parity.spec.ts` golden snapshots in the seeded CI environment
expected: After one `npx playwright test e2e/svg-chart-parity.spec.ts --update-snapshots` run in an environment with `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` (the seeded MA-8 job), commit the generated desktop + 320px-portrait golden PNGs. The spec currently self-skips loudly ("PENDING GOLDEN BAKE") when seed env is present but goldens are absent (WR-02 guard), so it does NOT false-red CI; once goldens land the pixel-diff parity gate goes live automatically. This is the only path to a real DESKTOP byte-identity proof for the SVG charts (it could not be baked locally — no seed DB).
result: [pending]

### 2. Real-device touch sign-off for the 3 tap-reveal charts at 320px
expected: On a physical phone (iOS + Android), tapping a StreakDistribution bar / a DailyReturnsHeatmap cell / a DailyHeatmap cell reveals AND pins the same value desktop hover shows; re-tap toggles off; ≥44px hit ergonomics feel right. Automated coverage proves the contract (15/15 useTapPin tests, 54/54 viewport tests, the extended target-size ≥44px gate); this item is the ergonomic confirmation that headless cannot replicate. Per the v1.3 roadmap this real-device authed walkthrough is formally Phase 48 SC#5 (the milestone's final acceptance gate) — carried forward to the Phase 48 sign-off.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

None — both items are deliberate, designed deferrals (seeded-CI golden bake + Phase-48 real-device sign-off). The Phase-47 automated contract (target-size measurement, byte-identity unit assertions, frozen-spine guards, coverage ratchet) is fully in place and green.
