---
phase: 46-surface-by-surface-reflow
plan: 03
subsystem: strategies/new/wizard (onboarding wizard — presentation)
tags: [responsive, wizard, de-block, reflow, css-first, coverage-ratchet, a11y]
requires:
  - "src/app/(dashboard)/strategies/new/wizard/WizardClient via Suspense (the client island, unchanged)"
provides:
  - "Wizard renders the real flow at ALL widths (no <640px hard-block / email-capture)"
  - "Wizard stepper rail stacks single-column at <sm (no horizontal page overflow at 320px)"
  - "Coverage ratchet MEASURED green after DesktopGate + DesktopGate.test.tsx deletion"
affects:
  - "/strategies/new/wizard (API branch)"
  - "/strategies/new/wizard?source=csv (CSV branch)"
tech-stack:
  added: []
  patterns:
    - "Viewport-branch REMOVAL (delete DesktopGate wrapper; render Suspense subtree directly)"
    - "CSS-first single-column collapse (grid-cols-1 sm:grid-cols-N), no new matchMedia"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/page.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx"
  deleted:
    - "src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/DesktopGate.test.tsx"
decisions:
  - "Removed the DesktopGate viewport branch entirely (delete > pass-through stub, per CONTEXT Area 2); the de-block REMOVES a viewport branch so it cannot add a hydration warning (SC#5)"
  - "Server auth gate (supabase.auth.getUser → redirect /login) + <Suspense key={source}> CSR-bailout boundary + the load-bearing 93-118 comment preserved verbatim (T-46-03-EoP must-not-regress); only the wrapper element changed"
  - "Stepper rail bare grid-cols-3/4 → grid-cols-1 sm:grid-cols-3/4 (stack at <640px, horizontal rail ≥640px); step grids already grid-cols-1 md:grid-cols-3 and the Back/Continue footer Buttons already min-h-[44px] — left untouched (Rule 3, no overflow)"
  - "Net-zero new matchMedia/useMediaQuery/useBreakpoint sites — the phase REMOVES one matchMedia site and adds none"
  - "Coverage ratchet measured (not assumed) per RESEARCH A3: all four metrics clear AFTER the DesktopGate test deletion; no threshold lowered, no snapshot blanket-updated"
metrics:
  duration_min: 6
  completed: 2026-06-27
  tasks: 3
  files_changed: 5
  tests_added: 0
  tests_deleted: 1
  tests_passing: 82
requirements: [WIZARD-01]
---

# Phase 46 Plan 03: Wizard De-Block + CSS-First Reflow + Coverage Ratchet Summary

De-blocked the onboarding / API-key wizard below 640px: deleted `DesktopGate.tsx`
(the desktop-only hard-block + email-capture fallback) and its test, rendered the
`<Suspense key={source}>` subtree directly from `page.tsx`, reflowed the wizard's
own stepper rail CSS-first so it stacks at 320px, and MEASURED the coverage
ratchet green after the test deletion — all without touching the server auth gate,
the Suspense CSR-bailout boundary, or adding any new JS viewport branch.

## What Was Built

### Task 1 — De-block the wizard (commit `9510810d`)
- **page.tsx**: removed `import { DesktopGate } from "./DesktopGate"`; replaced the
  `return (<DesktopGate>…</DesktopGate>)` block with the `<Suspense key={source}
  fallback={null}><WizardClient key={source} initialDraft={initialDraft} /></Suspense>`
  subtree rendered directly. The load-bearing 93-118 CSR-bailout comment was
  re-anchored verbatim (as a JS block comment) directly above the now-top-level
  `<Suspense>`. The server auth gate (`supabase.auth.getUser()` +
  `redirect("/login?next=/strategies/new/wizard")`) was NOT touched — it sits above
  the boundary and stays (T-46-03-EoP). Updated the route docstring (point 3) to
  describe the direct render instead of the DesktopGate wrap.
- **DELETED** `DesktopGate.tsx` (115 lines — dead after de-block: matchMedia
  `(max-width:639px)`, two-pass `isNarrow`, the email-capture branch, the
  `wizard_session_id:"desktop-gate"` POST) and `DesktopGate.test.tsx` (153 lines —
  subject gone). The `/api/for-quants-lead` route was kept (other callers); only the
  wizard's outbound `desktop-gate` POST value goes away — no copy strings relocated.
- **ConnectKeyStep.tsx**: dropped the now-stale "Same wizard chrome, same DesktopGate"
  phrase from the CSV-bridge comment (Rule 1 — documentation accuracy; the named
  symbol no longer exists). No behavior change.

### Task 2 — CSS-first stepper reflow (commit `339811d7`)
- **WizardChrome.tsx**: the stepper `gridColsClass` was `grid-cols-3`/`grid-cols-4`
  with NO responsive prefix → the N step cells (each holding `03 / 04` + a label like
  "Strategy profile") forced horizontal page overflow at 320px. Changed to
  `grid-cols-1 sm:grid-cols-3` / `grid-cols-1 sm:grid-cols-4` so the cells stack
  single-column below 640px and keep the horizontal rail at ≥640px. `aria-current="step"`,
  the step labels, and the hairline top/bottom borders are preserved.
- Step grids (`ConnectKeyStep:224`, `MetadataStep:243`, `CsvUploadStep:405`) already
  carry `grid-cols-1 md:grid-cols-3` (collapse to one column below md) and the
  Back/Continue footer `Button`s are already `min-h-[44px]` (default `md` size) — all
  fluid by construction, left untouched (Rule 3, no overflow).

### Task 3 — Coverage ratchet measured (no file edited)
- Ran `npm run test:coverage` (== `npx vitest run --coverage`) — exit code **0**.
- All four ratchet metrics clear their thresholds AFTER the DesktopGate + its test
  deletion (the deletion shifts both numerator and denominator; the net was measured,
  not assumed — RESEARCH Assumption A3).

## Coverage Ratchet — MEASURED (Task 3, the gate is the exit code)

| Metric | Threshold (vitest.config.ts) | Measured AFTER de-block | Margin | Result |
|--------|------------------------------|-------------------------|--------|--------|
| Lines | 82 | **84.27%** (17627/20917) | +2.27 | ✓ |
| Statements | 80 | **82.15%** (19259/23441) | +2.15 | ✓ |
| Functions | 74 | **77.92%** (3201/4108) | +3.92 | ✓ |
| Branches | 72 | **74.73%** (12831/17169) | +2.73 | ✓ |

- **`npm run test:coverage` exit code = 0** — all four metrics ≥ threshold.
- **No threshold lowered**: `git diff vitest.config.ts` empty; thresholds remain
  lines 82 / fns 74 / branches 72 / stmts 80. No snapshot blanket-updated.
- Reference baseline (CLAUDE.md, 2026-06-20, pre-deletion): lines 85.2 / stmts 83.3 /
  fns 77.4 / branches 75.5. The deletion of a `"use client"` component + its dense
  matchMedia/state-branch test moved the percentages down by ~1 point each (removed
  both well-covered lines and their covering test) but every metric stays comfortably
  above its ratchet — the net is measured-and-held, exactly as RESEARCH A3 required.

## Acceptance Criteria — verified

| Criterion | Result |
|-----------|--------|
| `DesktopGate.tsx` deleted | ✓ `test ! -f` PASS |
| `DesktopGate.test.tsx` deleted | ✓ `test ! -f` PASS |
| `grep -c DesktopGate page.tsx` === 0 | ✓ 0 |
| `grep -c "Suspense key={source}" page.tsx` ≥ 1 | ✓ 1 |
| `grep 'redirect("/login' page.tsx` present (auth gate intact) | ✓ line 72 |
| `npx tsc --noEmit` clean (no dangling import) | ✓ exit 0 |
| Remaining wizard tests pass | ✓ 82/82 (13 files) |
| Stepper grid carries responsive collapse (no bare grid-cols-3/4) | ✓ `grid-cols-1 sm:grid-cols-3/4` |
| Net-zero new matchMedia/useMediaQuery/useBreakpoint in wizard | ✓ 0 sites (none added; one removed) |
| `npm run test:coverage` exits 0 (all four ratchet metrics ≥ threshold) | ✓ exit 0 |
| No threshold lowered (`git diff vitest.config.ts` no change) | ✓ empty diff |
| SUMMARY records the four measured coverage numbers | ✓ table above |

## Threat Model — verified (no regression)

- **T-46-03-EoP (Elevation of Privilege)** — `mitigate`: the server auth gate
  (`supabase.auth.getUser()` + `redirect("/login?next=…")`, page.tsx:67-72) is
  preserved verbatim; only the `DesktopGate` wrapper element was removed. The
  acceptance gate greps for the redirect (PASS). The `(dashboard)` layout auth still
  applies.
- **T-46-03-V5 (reduced input surface)** — `accept (improvement)`: deleting the
  email-capture form removes one input surface; `/api/for-quants-lead` stays for its
  other callers (`for-quants/RequestCallModal.tsx`); no new endpoint or data path.
- **T-46-03-SC (npm/pip/cargo installs)** — `n/a`: zero packages installed.

## Deviations from Plan

None — plan executed exactly as written. The only un-listed touch was the
single-phrase stale-comment fix in `ConnectKeyStep.tsx` (Rule 1, documentation
accuracy: the comment named the now-deleted `DesktopGate` symbol). No bugs, missing
functionality, or blocking issues (Rules 1–3 otherwise not triggered); no
architectural decision needed (Rule 4 not triggered).

## Authentication Gates

None.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources
introduced. This was a viewport-branch REMOVAL + a CSS-first responsive prefix +
a coverage measurement.

## Notes / Constraints honored

- **No new hydration warning (SC#5)**: the de-block REMOVES a viewport branch —
  `DesktopGate` already returned `children` on the SSR pass (`isNarrow === null`) and
  on desktop; removing the narrow branch makes SSR and the first client paint render
  the same tree at every width. The existing `e2e/wizard-hydration-probe.spec.ts`
  stays the runtime gate (run in the seeded e2e context per the plan verification
  block; 320px overflow + a11y proven by the Wave-2 sweep in 46-04).
- **Suspense boundary preserved verbatim**: the `<Suspense key={source}>` +
  `key={source}` on `WizardClient` (the Next-16/React-19 CSR-bailout anchor for
  `useSearchParams()`) is byte-identical; the 93-118 doc comment was re-anchored, not
  rewritten.
- **CSS-first, no new JS viewport branch**: zero new matchMedia/useMediaQuery/
  useBreakpoint; only a Tailwind responsive prefix added.
- **Frozen math boundary untouchable**: zero changes to `scenario.ts` / `compute.ts` /
  any engine path.
- **No packages installed** (RESEARCH audit N/A).
- The 320px-page-overflow + ≥44px-control + a11y e2e confirmation for the wizard route
  is the Wave-2 reflow sweep's job (46-04 adds the wizard route to the authed sweep),
  per the plan's Task 2 acceptance note.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/strategies/new/wizard/page.tsx (modified)
- FOUND: src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx (modified)
- FOUND: src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx (modified)
- CONFIRMED DELETED: src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx
- CONFIRMED DELETED: src/app/(dashboard)/strategies/new/wizard/DesktopGate.test.tsx
- FOUND: .planning/phases/46-surface-by-surface-reflow/46-03-SUMMARY.md
- FOUND commit 9510810d (feat — de-block)
- FOUND commit 339811d7 (feat — stepper reflow)
