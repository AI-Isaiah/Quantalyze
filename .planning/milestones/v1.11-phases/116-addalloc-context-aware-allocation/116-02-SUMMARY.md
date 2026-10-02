---
phase: 116-addalloc-context-aware-allocation
plan: 02
subsystem: allocations-ui
tags: [ADDALLOC-04, optimizer-panel, dead-end-remedy, connect-exchange, role-02]
requires:
  - "OptimizerPanel 0-portfolio gate (Phase 100)"
  - "Canonical /profile?tab=exchanges route (existing: EmptyState/OnboardingBanner/ScenarioComposer)"
provides:
  - "Honest zero-portfolio Simulate-Impact remedy deep-linking the allocator connect-exchange path"
  - "Rule-9 intent test pinning href + honest copy + secondary (non-accent) treatment"
affects:
  - "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx"
tech-stack:
  added: []
  patterns:
    - "No disabled dead-ends: a blocked affordance offers one clickable remedy (generalizes ROLE-06)"
    - "Secondary (non-accent) button treatment reserved for a remedy that must not compete with the primary CTA"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx"
    - "src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx"
decisions:
  - "Kept the pre-existing secondary className byte-identical (border-border bg-white, NOT bg-accent) per UI-SPEC §Color — the remedy must not compete with the primary header CTA."
  - "Copy rendered as two neutral-voice lines (heading + body), no semantic red/amber (DESIGN.md: a zero is not bad)."
metrics:
  tasks: 1
  files_changed: 2
  completed: "2026-07-18"
---

# Phase 116 Plan 02: ADDALLOC-04 zero-portfolio Simulate-Impact remedy Summary

Swapped the manager-only `/portfolios` dead-end in the OptimizerPanel 0-portfolio gate for the canonical allocator connect-exchange deep-link (`/profile?tab=exchanges`) with honest copy naming why the affordance is inert — proven by a lockstep Rule-9 regression test that fails without the fix.

## What Was Built

Task 1 (TDD, `23b1f4e2`): the zero-portfolio gate in `OptimizerPanel.tsx` (:95-111) previously rendered `href="/portfolios"` + "Create portfolio →" — a route an allocator gets server-side `redirect()`-bounced from (ROLE-02), i.e. a dead-end. It now renders:
- Heading (neutral, `text-small font-medium text-text-primary`): "Simulate Impact needs a live portfolio"
- Body (`text-small text-text-secondary`): "Connect a read-only exchange API key to build your allocation, then Simulate Impact models new strategies against it."
- Remedy link: "Connect Exchange →" → `href="/profile?tab=exchanges"`, with the pre-existing secondary className kept byte-identical (`border border-border bg-white … text-text-primary`, deliberately NOT `bg-accent`).

The shared "Diversification Optimizer" heading const, the non-empty branch, the footer disclaimer, and the glossary were untouched. Zero new design tokens introduced.

The regression test (`OptimizerPanel.test.tsx`) was rewritten first (RED against the current tree — assertion mismatch, not a crash) to pin: the two locked copy strings verbatim, `getByRole("link", {name:/Connect Exchange/})` → `/profile?tab=exchanges`, `queryByRole` for /Create portfolio/ is null, className contains `border-border` and NOT `bg-accent`, and the kept "no optimizer mount" assertion.

## Verification

- `npx vitest run OptimizerPanel.test.tsx --no-file-parallelism` → RED before the .tsx edit (1 failed / 7 passed), GREEN after (8/8 passed). All other OptimizerPanel tests passed unmodified.
- grep gate: `href="/portfolios"` count 0; `profile?tab=exchanges` count 1.
- `npx tsc --noEmit` exit 0.
- `npx eslint` on both touched files exit 0.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/components/OptimizerPanel.tsx (modified, contains `/profile?tab=exchanges`)
- FOUND: src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx (modified, contains "Connect Exchange")
- FOUND: commit 23b1f4e2
