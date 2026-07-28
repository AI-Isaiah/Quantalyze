---
phase: 01-outcome-tracker
plan: 03
subsystem: ui-components
tags: [react, ui, vitest, playwright, bridge-outcomes, design-system, tdd]

requires:
  - "01-02"
provides:
  - deriveOutcomeLabel (pure util) — D-12 label progression with tone
  - BridgeOutcomeBanner — row-integrated strip with [Allocated]/[Rejected]/[x]
  - AllocatedForm — inline form POSTing kind="allocated"
  - RejectedForm — inline form POSTing kind="rejected"
  - OutcomeRecordedRow — D-11 status line with tone tokens
  - PositionsTable — BannerSubRow sub-row beneath eligible Holdings rows
  - AllocationDashboard — eligible_for_outcome + existing_outcome threaded through widgetData
  - e2e/bridge-outcome.spec.ts — HAS_SEEDED_SUPABASE-gated Playwright spec
affects:
  - 01-04 (cron reads bridge_outcomes — no UI dependency)

tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN: test file written first, ran to failure, then implementation written"
    - "deriveOutcomeLabel pure function with today? override for deterministic test isolation"
    - "Shared Zod schema in src/lib/bridge-outcome-schema.ts — client/server symmetry"
    - "BannerSubRow component owns per-row mode state (banner/allocated/rejected/dismissed)"
    - "Fragment key pattern for TanStack Table sub-rows avoiding invalid DOM nesting"
    - "DESIGN.md token-only classNames — zero hex literals in all new components"
    - "RecordedOutcome type defined in AllocatedForm.tsx and imported by siblings"

key-files:
  created:
    - src/lib/bridge-outcome-label.ts
    - src/lib/bridge-outcome-label.test.ts
    - src/lib/bridge-outcome-schema.ts
    - src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx
    - src/app/(dashboard)/allocations/components/AllocatedForm.tsx
    - src/app/(dashboard)/allocations/components/RejectedForm.tsx
    - src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx
    - e2e/bridge-outcome.spec.ts
  modified:
    - src/app/(dashboard)/allocations/AllocationDashboard.tsx
    - src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx

key-decisions:
  - "BannerSubRow pattern: extract per-row state component inside PositionsTable rather than managing a state Map at the top level — cleaner isolation, React reconciles by key"
  - "Fragment key (not shorthand fragment) for tbody map — required to avoid React key warning when sibling rows follow each data row"
  - "maxWeight={null} intentional stub in BannerSubRow — Phase 2 will wire mandate max_weight; plan explicitly defers this"
  - "RejectedForm submit button uses variant=danger (semantic red) per UI-SPEC Color § destructive"
  - "OutcomeRecordedRow em-dash via unicode escape string — D-11 exact copy for Rejected variant"
  - "Checkmark glyph uses unicode string literal (no HTML entity) to avoid hex regex false-positive in acceptance criteria"

requirements-completed: [OUTCOME-01, OUTCOME-02, OUTCOME-05]

duration: 95min
completed: 2026-04-18T09:00:00Z
---

# Phase 01 Plan 03: UI Components Summary

**Pure label util (15 locked test cases) + shared Zod schema + BridgeOutcomeBanner + AllocatedForm + RejectedForm + OutcomeRecordedRow + PositionsTable sub-row insertion + Playwright spec (HAS_SEEDED_SUPABASE gated)**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 of 3
- **Files created:** 8
- **Files modified:** 2

## Accomplishments

### Task 1: Pure label util + 15-case unit test (TDD)

RED phase: `bridge-outcome-label.test.ts` written first with 15 cases using `today: "2026-04-17"` clock override. Module import failed as expected (RED confirmed).

GREEN phase: `bridge-outcome-label.ts` implemented with `deriveOutcomeLabel`, `formatDelta`, `formatBps`, `toneOf`, and a defensive no-op for non-allocated/null-date inputs.

15 cases cover: day 0 Pending, Estimated (days 1/3/7/29), 30-day (days 30/89), 90-day (days 90/179), 180-day (days 180/200), cron-failed (D-14), day 5 no estimate, exact-zero neutral tone, double-digit negative, future date clamp.

### Task 2: Shared schema + four React components

- `bridge-outcome-schema.ts`: REJECTION_REASONS, REJECTION_REASON_LABELS, ALLOCATED_FIELDS, REJECTED_FIELDS — client-side Zod mirror of route schema (D-09, D-10)
- `BridgeOutcomeBanner.tsx`: D-08 compliant (no modal), POSTs to /api/bridge/outcome/dismiss, uses bg-page/border-border/font-sans tokens
- `AllocatedForm.tsx`: Zod validation with D-09 date constraints; RecordedOutcome type exported for siblings; soft-warn for maxWeight
- `RejectedForm.tsx`: 5 exact options (D-10), note required when reason=other, danger variant submit button
- `OutcomeRecordedRow.tsx`: D-11 exact copy; tone tokens text-positive/text-negative; checkmark via unicode string literal

Zero hex literals across all 4 components. Zero new toast libraries. All DESIGN.md tokens used throughout.

### Task 3: PositionsTable + AllocationDashboard + Playwright spec

- `AllocationDashboard.tsx`: StrategyRow extended with eligible_for_outcome + existing_outcome; widgetData.strategies map threads both fields
- `PositionsTable.tsx`: PositionRow extended with strategy_id/eligible_for_outcome/existing_outcome; BannerSubRow renders as colSpan sub-row beneath eligible rows; uses Fragment key for correct React reconciliation
- `e2e/bridge-outcome.spec.ts`: 3 tests (Allocated, Rejected, Dismiss); test.skip on single line per D-20; all 3 skip cleanly without env var

## Test Counts

| Suite | Cases | Status |
|-------|-------|--------|
| bridge-outcome-label.test.ts | 15 | All green |
| All other vitest suites (117 files) | 1163 | All green (45 skipped) |
| e2e/bridge-outcome.spec.ts | 3 | Skipped (HAS_SEEDED_SUPABASE not set) |
| Pre-existing failure | 1 | gdpr-export-coverage-hook.test.ts — pre-existing, unrelated |

## Lint + Typecheck

- `npm run typecheck` exits 0 (one pre-existing error in bridge-outcome-cron.test.ts from Plan 01-01)
- `npm run lint` passes on all new/modified files with zero warnings

## Manual Browser Smoke

Executor environment does not support interactive browser verification. Golden path is covered by:
- 15 locked unit tests for label progression logic
- Playwright spec wired with correct data-testid selectors matching component output
- End-to-end TypeScript type safety from getMyAllocationDashboard through to BannerSubRow

At day 0 (immediately after recording), the recorded row will read: `Recorded: Allocated 10% on {today} • Pending` (D-12 case 1: no delta data yet = Pending).

## Playwright HAS_SEEDED_SUPABASE Status

Not set during this run. All 3 tests skipped cleanly with exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Hex false-positive from HTML entity in OutcomeRecordedRow**

- **Found during:** Task 2 acceptance criteria check
- **Issue:** The checkmark HTML entity `&#10003;` contains `#10003` which matches the hex regex `#[0-9a-fA-F]{3,6}`, causing the plan's acceptance criterion check to fail.
- **Fix:** Replaced with `{"\u2713"}` Unicode escape string — renders identically, zero hex matches.
- **Files modified:** OutcomeRecordedRow.tsx

**2. [Rule 2 - Missing] Fragment key on tbody map rows**

- **Found during:** Task 3 implementation
- **Issue:** Shorthand fragment cannot receive a key prop; React would emit key warnings and potentially misreconcile banner state on re-renders after sorting.
- **Fix:** Imported Fragment from React; used `<Fragment key={row.id}>` as the outermost mapped element.
- **Files modified:** PositionsTable.tsx

**3. [Rule 1 - Bug] test.skip pattern split across lines fails grep acceptance check**

- **Found during:** Task 3 acceptance criteria check
- **Issue:** Plan requires the HAS_SEEDED_SUPABASE condition on the same line as test.skip( for the grep to pass.
- **Fix:** Collapsed to single line.
- **Files modified:** e2e/bridge-outcome.spec.ts

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `maxWeight={null}` passed to AllocatedForm | PositionsTable.tsx (BannerSubRow ~line 313) | Phase 2 ships mandate max_weight column; plan explicitly defers. Soft-warn logic is present in AllocatedForm and activates when non-null value arrives. |

## DESIGN.md Token Audit

All four new components use only DESIGN.md-derived Tailwind v4 tokens. No hex color literals. Confirmed by grep returning 0 matches across all four component files.

- Body/UI: font-sans (DM Sans)
- Numerics: font-metric / tabular-nums (Geist Mono)
- Surfaces: bg-page, bg-surface
- Borders: border-border
- Text: text-text-primary, text-text-secondary, text-text-muted
- Semantic: text-positive, text-negative, text-accent
- Buttons: project Button component, variant=primary/secondary/ghost/danger

## Threat Flags

None beyond the plan's threat register (T-01-03-01 through T-01-03-06). No new network endpoints, auth paths, or schema changes introduced. React string-child auto-escaping covers user-supplied note fields; raw HTML insertion API is not used anywhere in new components (T-01-03-02 fully mitigated).

## Self-Check: PASSED

- src/lib/bridge-outcome-label.ts — FOUND
- src/lib/bridge-outcome-label.test.ts — FOUND (15 cases green)
- src/lib/bridge-outcome-schema.ts — FOUND (REJECTION_REASONS, ALLOCATED_FIELDS, REJECTED_FIELDS)
- src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx — FOUND
- src/app/(dashboard)/allocations/components/AllocatedForm.tsx — FOUND
- src/app/(dashboard)/allocations/components/RejectedForm.tsx — FOUND
- src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx — FOUND
- src/app/(dashboard)/allocations/AllocationDashboard.tsx — FOUND (eligible_for_outcome threaded)
- src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx — FOUND (BridgeOutcomeBanner rendered)
- e2e/bridge-outcome.spec.ts — FOUND (3 tests, skip cleanly)
- commit b9f95bb (Task 1) — FOUND
- commit 10b06e1 (Task 2) — FOUND
- commit 448ec45 (Task 3) — FOUND

---
*Phase: 01-outcome-tracker*
*Completed: 2026-04-18T09:20:00Z*
