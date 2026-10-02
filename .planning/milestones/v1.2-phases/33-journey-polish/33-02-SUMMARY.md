---
phase: 33-journey-polish
plan: 02
subsystem: ui
tags: [design-system, focus-ring, accessibility, scenario-composer, blank-slate, journey-02, surgical, tailwind-v4]

# Dependency graph
requires:
  - phase: 29-unified-composer-spine
    provides: ScenarioComposer.tsx isEmptyState blank-slate front door (serif "Start a portfolio" + dual CTA, already shipped)
  - phase: 29-32-allocator-cohesion
    provides: SCENARIO-05 frozen-spine zero-diff guards; entry-mode segment focus-ring analog at :1684/:1700
provides:
  - "Blank-slate front door with a consistent DESIGN.md accent focus-visible ring on both CTAs (Connect Exchange / Browse strategies) — closes the one residual JOURNEY-02 drift"
  - "Verified-compliant verdict for the 3 other inventoried entry/empty-state surfaces (EmptyState, OnboardingBanner, discovery/[slug]) — confirmed, not assumed; byte-unchanged"
affects: [journey-polish, scenario-composer, allocations-entry-points, a11y]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Focus-ring consistency via the existing DESIGN.md token `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` — reused verbatim from the same-surface entry-mode segments (:1684/:1700), no new token/width/opacity invented"
    - "Surgical Rule-3 polish: touch ONLY the two CTA className strings; the 3 already-compliant surfaces verified and left byte-identical"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"

key-decisions:
  - "Used the same-surface entry-mode analog (`focus-visible:ring-2 focus-visible:ring-accent/50`, :1684/:1700) rather than OnboardingBanner.tsx:65's `focus:ring-2 focus:ring-accent/50` form. The plan frontmatter (`contains: focus-visible:ring-accent/50`), key_links (`via: focus-visible:ring-2 focus-visible:ring-accent/50`), and the acceptance criterion (`grep -c 'focus-visible:ring-accent/50'` must increase by exactly 2) all pin the `focus-visible:ring-` variant. Matching the same component's segments is the correct visual-consistency choice and is the token UI-SPEC §Color reserved-for #4 blesses."
  - "VERIFY-ONLY verdict recorded for surfaces 1/2/4 — each confirmed DESIGN.md-compliant against the contract and left byte-unchanged (git diff --exit-code clean). See verify-only section below."

patterns-established:
  - "DESIGN.md token-reuse for a residual focus-ring gap: copy the focus-visible ring verbatim from the nearest same-surface analog; never invent a new ring width/color/opacity."

requirements-completed: [JOURNEY-02]

# Metrics
duration: ~6min
completed: 2026-06-23
tasks: 1
files-changed: 1
---

# Phase 33 Plan 02: DESIGN.md Consistency Sweep Summary

Closed the one genuine JOURNEY-02 drift — the ScenarioComposer blank-slate CTAs now carry the DESIGN.md accent `focus-visible` ring matching the rest of the surface — and verified the other 3 inventoried entry/empty-state surfaces are DESIGN.md-compliant and byte-unchanged.

## What Was Built

A two-line surgical edit to `ScenarioComposer.tsx`: appended the existing DESIGN.md focus-ring token `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` to the `className` of BOTH blank-slate CTAs in the `isEmptyState` branch:

- The "Connect Exchange →" `<Link>` (~:1604) — previously `hover:bg-accent/90` only, now also carries the accent focus ring.
- The "Browse strategies" `<button>` (~:1611) — previously `hover:border-accent` only, now also carries the accent focus ring.

Both rings are token-identical to the entry-mode segments at :1684/:1700 in the same component and to the focus-ring recipe blessed in UI-SPEC §Color reserved-for #4 and DESIGN.md ("Border focus: #1B6B5A — accent color for focused inputs"). Keyboard users now get a visible accent focus ring on the blank-slate front door, matching every other CTA in the composer — one visual language into the surface.

No copy changed (CTA labels, the serif "Start a portfolio" heading, body, and card shell are all byte-identical). No new component, no new token, no new spacing, no new element. `src/lib/scenario.ts` is zero-diff (SCENARIO-05). The IMPACT-02 / PROJECTED honesty pill and all Phase-30 disclosures are untouched (frozen-spine guards green).

## Verify-Only Verdicts (surfaces 1/2/4 — confirmed compliant, no edit)

| # | Surface | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `allocations/EmptyState.tsx:34-59` | COMPLIANT — no edit | `Card` shell + serif 24px heading + DM-Sans 14px sub-line + single `bg-accent` "Connect Exchange →" CTA; minimalism gate (one headline / one sub-line / one button) intact; locked copy. `git diff --exit-code` clean. |
| 2 | `allocations/components/OnboardingBanner.tsx:28-80` | COMPLIANT — no edit | `WarningBanner` shell (`border-l-4 border-warning bg-warning/5`), deliberate `<h2>` level (1.3.1), accent CTA carrying the focus ring at :65, dismiss `aria-label="Dismiss for this session"`. Not promoted to accent or a `Card`. `git diff --exit-code` clean. |
| 4 | `discovery/[slug]/page.tsx:41-77` | COMPLIANT — no edit | `Breadcrumb` / `PageHeader` / `InfoBanner` / `StrategyTable`; watchlist-failure `role="status"` notice. `git diff --exit-code` clean. |

All three were confirmed against the JOURNEY-02 DESIGN.md primitive contract (Card 8px/white/1px #E2E8F0, KpiStrip Geist-Mono tabular-nums, Instrument-Serif headings / DM-Sans body, accent reserved for action/verified, focus ring = `focus-visible:ring-2 focus-visible:ring-accent/50`). Per Rule 3 (surgical) they were left untouched — no "improving" compliant surfaces.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Focus-ring count +2 | `grep -c "focus-visible:ring-accent/50" ScenarioComposer.tsx` | 2 → 4 (+2) ✅ |
| Diff scope | `git diff ScenarioComposer.tsx` | ONLY the two CTA `className` strings changed; no copy/heading/card-shell/element touched ✅ |
| Verify-only surfaces unchanged | `git diff --exit-code EmptyState.tsx OnboardingBanner.tsx discovery/[slug]/page.tsx` | clean ✅ |
| Frozen engine (SCENARIO-05) | `git diff --exit-code src/lib/scenario.ts src/lib/scenario.test.ts` | clean ✅ |
| Lint | `npx eslint ScenarioComposer.tsx` | clean (valid Tailwind v4 class, no token typo) ✅ |
| Tests | composer suite + EmptyState + OnboardingBanner + phase-31/32 frozen-spine guards | 137/137 passed (no snapshot/locked-copy break, honesty invariants green) ✅ |

## Deviations from Plan

None — plan executed exactly as written. The one token-form judgment (entry-mode `focus-visible:ring-` analog over the OnboardingBanner `focus:ring-` form) is the plan's own pinned token, not a deviation; recorded under key-decisions.

## Known Stubs

None.

## Threat Flags

None. The edit introduces no new endpoint, no schema/RLS change, no new dependency, no auth path, no copy change — it appends an existing focus-ring utility to two `className` strings. Accent is added ONLY as a focus ring (UI-SPEC §Color reserved-for #4 explicitly blesses accent for focus rings); no accent fill on a non-action element. Threat register dispositions T-33-03/04/05/SC all satisfied (honesty invariants + frozen engine + locked copy proven unchanged by the scoped `git diff`; zero new dependency).

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND (modified, present)
- `.planning/phases/33-journey-polish/33-02-SUMMARY.md` — FOUND (on disk, gitignored)
- Commit `87506c9a` — FOUND in git log (1 file, +2/-2)
- Committed tree ring count = 4 (+2 vs baseline 2) — verified via `git show HEAD:...`
- Zero `.planning` files in the commit — verified (code-only convention honored)
- No file deletions in the commit — verified (`git diff --diff-filter=D` empty)
