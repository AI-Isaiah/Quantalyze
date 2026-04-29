---
phase: 13
plan: 04
subsystem: discovery-v2-polish
tags:
  - sparkline
  - design-system
  - DIFF-05
  - visual-regression
  - design-fidelity
requirements:
  - DISCO-04
dependency_graph:
  requires:
    - 13-01
    - 13-02
  provides:
    - sparklineColor helper for single-accent sparkline rendering
    - Playwright regression gate against split-color sparkline anti-pattern
  affects:
    - src/components/strategy/StrategyTable.tsx (returns sparkline only)
    - src/components/strategy/StrategyGrid.tsx (card sparkline)
tech_stack:
  added: []
  patterns:
    - "Sign-driven color at the call site — Sparkline component stays single-color, caller picks color (DESIGN.md DIFF-05)"
    - "CSS-variable return strings — sparkline-color.ts returns var(--*) tokens so design-token swaps propagate without code changes"
key_files:
  created:
    - src/lib/sparkline-color.ts
    - src/lib/sparkline-color.test.ts
    - src/components/strategy/StrategyGrid.test.tsx
    - e2e/discovery-sparkline-regression.spec.ts
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.test.tsx
    - src/components/strategy/StrategyGrid.tsx
decisions:
  - "Helper returns CSS-variable strings (var(--color-accent)/var(--color-negative)/var(--color-chart-benchmark)) instead of hex literals — design tokens stay the single source of truth"
  - "Color rule lives at the call site, not inside Sparkline.tsx — preserves the 'Sparkline is single-color, caller picks color' contract per CONTEXT.md DISCO-04 lock"
  - "Drawdown sparkline at StrategyTable.tsx:464 keeps its static color=\"var(--color-negative)\" — drawdown is non-positive by definition, so the sign-driven rule does NOT apply (Pitfall 7 invariant)"
  - "Empty/nullish input maps to chart-benchmark grey, matching the final==0 case — single sentinel for 'no signal'"
metrics:
  duration_seconds: ~340
  completed_at: "2026-04-29T00:30:00Z"
  commits: 2
  tasks_completed: 2
  unit_tests_added: 13
  e2e_tests_added: 3
  full_suite_pass_count: 2369
  baseline_pass_count: 2356
---

# Phase 13 Plan 04: DISCO-04 Sparkline Single-Accent Summary

Single-line: Wired DESIGN.md DIFF-05 single-accent sparkline rule on /discovery via a 9-line `sparklineColor` helper and 1-prop edits at the two `sparkline_returns` call sites; Sparkline.tsx is untouched; e2e regression gate now blocks any future split-color regression.

## Shipped Artifacts

### New files
- `src/lib/sparkline-color.ts` (9 LOC) — pure helper. Returns `var(--color-accent)` when final value is positive, `var(--color-negative)` when negative, `var(--color-chart-benchmark)` when zero/empty/nullish.
- `src/lib/sparkline-color.test.ts` (6 vitest cases) — covers positive, negative, zero, empty, single-element, and intermediate-ignoring inputs.
- `src/components/strategy/StrategyGrid.test.tsx` (3 vitest cases) — covers the 3 branches on the grid card sparkline.
- `e2e/discovery-sparkline-regression.spec.ts` (3 Playwright tests) — DOM-walks `/discovery/crypto-sma`:
  1. No SVG mixes `#16A34A` and `#DC2626` strokes.
  2. Each sparkline owns at most one stroke color.
  3. Drawdown SVGs use the negative color — proves the negative-color render path executes on live data even when seed data trends positive (BLOCKER 1 fix).

### Modified files
- `src/components/strategy/StrategyTable.tsx` — added `import { sparklineColor } from "@/lib/sparkline-color"` and passed `color={sparklineColor(s.analytics.sparkline_returns ?? [])}` on the returns Sparkline (line ~462). Drawdown call site untouched.
- `src/components/strategy/StrategyTable.test.tsx` — appended a `describe("StrategyTable — DISCO-04 sparkline color rule")` block with 4 cases (3 sign branches + Pitfall 7 invariant proving drawdown color stays static when the new rule is wired).
- `src/components/strategy/StrategyGrid.tsx` — added the same import and `color` prop to the card Sparkline.

## Validation Evidence

### Sparkline.tsx invariant
```
$ git diff --quiet src/components/charts/Sparkline.tsx; echo $?
0
$ git diff --stat src/components/charts/Sparkline.tsx
(empty — file is byte-identical to pre-plan state)
```

### Pitfall 7 invariant
```
$ grep -c 'color="var(--color-negative)"' src/components/strategy/StrategyTable.tsx
1
$ grep -c "sparklineColor(s.analytics.sparkline_drawdown" src/components/strategy/StrategyTable.tsx
0
```
Drawdown call site at line 466 is byte-identical to pre-plan state. The new helper is applied to the returns column only.

### Test counts
- 6 helper unit tests (sparkline-color.test.ts) — all GREEN
- 4 component cases on StrategyTable (DISCO-04 describe) — all GREEN
- 3 component cases on StrategyGrid — all GREEN
- 3 Playwright tests registered (`npx playwright test --list -g "sparkline single-accent"` → 3 tests in 1 file)

### Full suite
```
Test Files  238 passed | 12 skipped (250)
Tests       2369 passed | 148 skipped (2517)
```
Baseline before plan: 2356 passed. After plan: 2369 passed (delta = +13 unit tests added by this plan). No regressions to Wave 0 / 1 / 2 work.

### Build
```
✓ Compiled successfully in 4.8s
✓ Generating static pages using 9 workers (73/73) in 168ms
```

### e2e spec status
**Listed only.** No dev server running for this autonomous executor session, so the spec was not executed against the live page. The spec is registered with Playwright (3 tests under the `sparkline single-accent` describe block). Manual or CI-triggered execution is the next gate.

## Acceptance Criteria — Per Task

### Task 1 (Wave 0 RED)
| # | Criterion | Result |
|---|-----------|--------|
| 1 | sparkline-color.test.ts with ≥6 it/test | 6 |
| 2 | StrategyGrid.test.tsx exists | YES |
| 3 | discovery-sparkline-regression.spec.ts in e2e/ | YES |
| 4 | All 3 color tokens in helper test (≥3) | 17 |
| 5 | drawdown sparkline / sparkline_drawdown count (≥1) | 5 |
| 6a | e2e #16A34A count (≥1) | 4 |
| 6b | e2e #DC2626 count (≥1) | 7 |
| 7 | e2e hasGreen && hasRed (≥1) | 1 |
| 8 | e2e drawdown / drawdownStrokes (≥1) | 6 |
| 9 | e2e does NOT contain "tests/e2e/" | PASS (clean) |
| RED | sparkline-color test exits non-zero | YES (import unresolved) |

### Task 2 (Wave 1 GREEN)
| # | Criterion | Result |
|---|-----------|--------|
| 1 | export function sparklineColor (==1) | 1 |
| 2 | All 3 color tokens in helper (≥3) | 5 |
| 3 | Final-value + empty guard (≥2) | 2 |
| 4 | StrategyTable returns call site (==1) | 1 |
| 5 | StrategyGrid returns call site (==1) | 1 |
| 6 | StrategyTable import (≥1) | 1 |
| 7 | StrategyGrid import (≥1) | 1 |
| 8a | Drawdown static var(--color-negative) (≥1) | 1 |
| 8b | sparkline_drawdown still referenced (≥1) | 1 |
| 9 | Pitfall 7 — drawdown ≠ sparklineColor (==0) | 0 |
| 10 | Sparkline.tsx unchanged | clean (quiet exit 0) |
| 11 | Playwright spec lists ≥1 test | 3 |
| Build | npm run build exits 0 | YES |
| Suite | npm test exits 0, 2369 passed | YES |

## Deviations from Plan

**None — plan executed exactly as written.**

No Rule 1 / 2 / 3 / 4 deviations were required. The plan's tests and helper signature aligned with the existing component contract. No bugs surfaced during implementation; the helper passed its 6 unit cases on first run, both call-site edits were single-line surgical changes, and the full suite advanced from 2356 → 2369 with zero failures.

## Authentication Gates

None — this plan touches only client-side rendering. No auth or external services involved.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 (RED tests) | `3273382` | src/lib/sparkline-color.test.ts (new), src/components/strategy/StrategyTable.test.tsx (modified), src/components/strategy/StrategyGrid.test.tsx (new), e2e/discovery-sparkline-regression.spec.ts (new) |
| 2 (GREEN impl) | `56e2b53` | src/lib/sparkline-color.ts (new), src/components/strategy/StrategyTable.tsx (modified, +1 import +1 prop), src/components/strategy/StrategyGrid.tsx (modified, +1 import +1 prop) |

## Open Follow-ups

- **Plan 13-05** (data-only `is_example` backfill) — independent surface, unblocked by this plan.
- **e2e execution** — when a dev server with the matratzentester24 fixture is up, run `npx playwright test e2e/discovery-sparkline-regression.spec.ts` to capture a green run on the live page. The 3 tests are listed and the assertions are deterministic; expected to be GREEN given the static-color implementation (no per-point split is reachable from the helper).

## Self-Check: PASSED

Verified:
- src/lib/sparkline-color.ts FOUND
- src/lib/sparkline-color.test.ts FOUND
- src/components/strategy/StrategyGrid.test.tsx FOUND
- e2e/discovery-sparkline-regression.spec.ts FOUND
- src/components/strategy/StrategyTable.tsx modified (returns sparkline now passes color prop derived from sparklineColor)
- src/components/strategy/StrategyGrid.tsx modified (card sparkline now passes color prop)
- src/components/strategy/StrategyTable.test.tsx modified (DISCO-04 describe block appended)
- Commit 3273382 FOUND
- Commit 56e2b53 FOUND
- Sparkline.tsx untouched (git diff --quiet exits 0)
- Drawdown call site invariant preserved (no sparklineColor on sparkline_drawdown — grep returns 0 matches)
