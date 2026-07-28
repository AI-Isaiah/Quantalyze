---
phase: 117-uifix-tooltip-portal-overflow-polish
verified: 2026-07-18T12:12:00Z
status: human_needed
score: 11/12 must-haves verified (code) + browser smoke-checked (changed surfaces load clean); pixel/axe QA still open
re_verification:
  previous_status: human_needed
  note: "Post-verification: code-review found 2 Warnings (WR-01 first-paint mispaint, WR-02 estimated-height clip re-introducing UIFIX-01's own bug) + 1 paired Info (leading-none cramped wrap) — all fixed at root cause (measure-before-paint via SSR-safe layout effect, real-height flip + top clamp, leading-tight) with RED-first tests; clean re-review. Orchestrator browser smoke-check on localhost:3000: the changed allocations/scenario surface loads with ZERO console errors/warnings (no hydration / useLayoutEffect-on-server / createPortal failure from the tooltip portal rewrite). REMAINING human/seeded QA (not code gaps): (1) pixel tooltip placement in an overflow container / viewport edge / open Dialog / mobile drawer; (2) focus-ring visual non-clipping at the 6 sites via keyboard tab; (3) axe route×viewport matrix on the authed/embedded surfaces that fold the changed components (seed-gated; dormant in local/CI axe which only covers the public floor) + an extreme high-leverage CUM RETURN value. Recommend a seeded /qa pass or a seeded-env axe CI run to close."
human_verification:
  - test: "Open a tooltip whose trigger sits inside a KPI strip / table (overflow-x-auto), then one near the right/left viewport edge, then one inside an OPEN Dialog/drawer and the mobile drawer."
    expected: "Bubble renders FULLY (never clipped by the container), stays on-screen at the edges, and paints ABOVE the z-[200] overlay (z-[210]). Unit tests pin the invariants; pixels are unverified."
    why_human: "Rendered placement / stacking / clip behavior is visual — jsdom cannot confirm actual paint geometry."
  - test: "Tab through the six UIFIX-02 sites (factsheet section-nav, allocations tab strip on mobile, ResponsiveTable scroll region incl. MetricsColumn worst-drawdowns + StressWindowsPanel, both heatmap regions, correlation-matrix region, flagged-holdings expand button)."
    expected: "The inset accent focus ring renders FULLY inside the element bounds at every site — not clipped at the scroll-container edge."
    why_human: "Focus-ring clip behavior under overflow ancestors is a rendered-pixel property; className presence is verified, visible non-clipping is not."
  - test: "Run the axe WCAG-AA route×viewport matrix on the CHANGED authed/embedded surfaces with seed env: /strategy/[id]/v2 (folds the factsheet KPI strip + focus-ring sites), /allocations (tab strip), and the embedded composer factsheet (/allocations?tab=scenario) across Desktop 1280×800 + mobile 375×812 + ultrawide."
    expected: "Zero axe violations — in particular no WCAG 1.4.11 (≥3:1) failure from the new full-opacity inset focus ring, and no contrast/aria regression on the reflowed CUM RETURN value."
    why_human: "Per e2e/axe-app-wide.spec.ts's own header, the authed + embedded describes are HAS_SEED_ENV-gated and DORMANT in CI by design (shared MA-8 test DB is not hermetic). The local run only covered the PUBLIC floor (/, /security, /for-quants, /browse, /demo) which does NOT render any Phase-117-changed component. No automated axe run currently covers the changed surfaces."
---

# Phase 117: UIFIX Tooltip / Overflow Polish Verification Report

**Phase Goal:** The tooltip/overflow polish batch — a portaled tooltip that renders fully near the viewport edge (and inside a Dialog/mobile drawer), unclipped focus rings, and a non-truncating CUM RETURN KPI card.
**Verified:** 2026-07-18T12:12:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | UIFIX-01: bubble portals to `document.body`, escaping overflow clips | ✓ VERIFIED | `Tooltip.tsx:142,159` `createPortal(<span/>, document.body)`; Test 1 asserts `parentElement===document.body` and clip container `.contains(bubble)===false` (green) |
| 2 | UIFIX-01: edge-adjacent tooltip stays on-screen (horizontal clamp) | ✓ VERIFIED | `Tooltip.tsx:102-104` `Math.min(Math.max(rawLeft, MARGIN), maxLeft)`; Test 2 spies a near-right-edge rect, asserts `L>=0 && L+224<=innerWidth` (green) |
| 3 | UIFIX-01: tooltip inside open z-[200] Dialog/drawer renders ABOVE it | ✓ VERIFIED | `Tooltip.tsx:146` className `fixed z-[210]`; `z-50`/`absolute`/`bottom-full` grep = NONE; Test 3 nests trigger in a `z-[200]` overlay, asserts body-portal siblinghood + `z-[210]` token (green) |
| 4 | UIFIX-01: hover+focus open after 150ms; role=tooltip + aria-describedby preserved | ✓ VERIFIED | `Tooltip.tsx:132-137,145,74` (`setTimeout(...,150)`, `role="tooltip"`, `aria-describedby={open?id:undefined}`, onMouseEnter/Leave/Focus/Blur); Test 5 + 3 pre-existing timer tests (M-0898/M-0899/L-0044) green |
| 5 | UIFIX-01: scroll/resize listeners add-on-open, remove-on-close AND unmount | ✓ VERIFIED | `Tooltip.tsx:117-126` open-keyed effect, symmetric cleanup, `capture:true`; Test 4 asserts removeEventListener with same refs on close and unmount (green) |
| 6 | UIFIX-01: real vertical flip (not just docstring) | ✓ VERIFIED | `Tooltip.tsx:107-111` room-above branch → `top: rect.bottom+gap` else `bottom:` anchor; docstring at :20-30 rewritten to describe real behavior |
| 7 | UIFIX-02: every focusable control in the enumerated overflow sites carries a clip-proof inset accent ring (full opacity, ≥2px) | ✓ VERIFIED | ring-inset present at all 6 sites (see Artifacts); `ring-accent/20` grep = NONE across all phase files (WCAG 1.4.11 ≥3:1 honored) |
| 8 | UIFIX-02: no site relies on a positive-offset outline / default outline | ✓ VERIFIED | FactsheetView nav anchor `outline-offset-1` absent (grep); AllocationsTabs TAB_BUTTON consts no longer carry `focus-visible:outline`; ResponsiveTable region gained explicit ring |
| 9 | UIFIX-02: shared ResponsiveTable region shows unclipped ring (covers MetricsColumn + StressWindowsPanel centrally) | ✓ VERIFIED | `ResponsiveTable.tsx:64-65` appends the three ring tokens to the `role=region tabIndex=0` scroll wrapper; reflow suites green |
| 10 | UIFIX-03: CUM RETURN value renders extreme magnitudes in full (no truncation trio) | ✓ VERIFIED | `FactsheetView.tsx` value `<p>` = `...text-h2 leading-none break-words` (trio removed); cell wrapper `min-w-0`; kpistrip UIFIX-03 Test 1 asserts absence of all three trio tokens (green) |
| 11 | UIFIX-03: type stays text-h2; sibling cards + eyebrow LABEL clip preserved | ✓ VERIFIED | value `<p>` keeps `font-mono tabular-nums text-h2 leading-none`; LABEL `<p>` keeps `whitespace-nowrap overflow-hidden text-ellipsis`; kpistrip Test 2/3 (label guard + Set-size-1 sibling uniformity + signTone) green |
| 12 | UIFIX-03: axe route×viewport matrix green after the whole batch | ? UNCERTAIN | Public floor (15 cells: /, /security, /for-quants, /browse, /demo × 3 viewports) ran green locally — but those routes render NONE of the changed components. The authed/embedded cells that DO fold the changed factsheet/allocations surfaces are HAS_SEED_ENV-gated and DORMANT in CI by design (axe spec header) → see Human Verification #3 |

**Score:** 11/12 truths verified; truth #12 partially verified (public floor green; changed surfaces need a seeded/browser axe run).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/ui/Tooltip.tsx` | Portaled fixed bubble + clamp + flip | ✓ VERIFIED | createPortal, `fixed z-[210]`, getBoundingClientRect, open-keyed listener effect; a11y/timer/inline-style block preserved |
| `src/components/ui/Tooltip.test.tsx` | RED-first portal/clamp/z/listener/aria suite | ✓ VERIFIED | 5 UIFIX-01 tests + 3 pre-existing timer tests; 8/8 green |
| `src/components/ResponsiveTable.tsx` | Clip-proof ring on shared scroll region | ✓ VERIFIED | `ring-inset` at :65 |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | Nav-anchor ring + KPI value no-truncation | ✓ VERIFIED | nav anchor ring at :1048 (no outline-offset-1); value `<p>` break-words, cell min-w-0 |
| `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` | Ring on both regions | ✓ VERIFIED | ring-inset count = 2 |
| `src/app/factsheet/[id]/v2/DistributionPanels.tsx` | Ring on correlation region | ✓ VERIFIED | ring-inset count = 1 |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | Ring on TAB_BUTTON consts | ✓ VERIFIED | both consts at :332,:334; stale byte-identical comment updated |
| `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` | Ring on expand button | ✓ VERIFIED | :234 ring-inset (was no focus indicator) |
| `src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx` | RED-first ring assertions | ✓ VERIFIED | created; suite green |
| `src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx` | Extreme-value no-ellipsis + label guard + re-pin | ✓ VERIFIED | UIFIX-03 describe added; superseded 52-06 value pin re-pointed to break-words contract, label half preserved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Tooltip.tsx | document.body | SSR-guarded createPortal | ✓ WIRED | `open && typeof document !== "undefined" && createPortal(..., document.body)` :140-159 |
| Tooltip.tsx | trigger rect | getBoundingClientRect → position:fixed | ✓ WIRED | callback ref :63-65 → reposition :96-112 |
| FactsheetView nav | section anchors | inset ring replacing positive-offset outline | ✓ WIRED | :1048, outline-offset-1 removed |
| ResponsiveTable | consumers (MetricsColumn/StressWindows) | shared region className | ✓ WIRED | central ring edit; reflow suites green |
| FactsheetView value `<p>` | items.map cell | single shared className (uniform) | ✓ WIRED | kpistrip Set-size-1 uniformity test green |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All touched suites pass on real HEAD | `vitest run` (7 files) | 108 passed (108) | ✓ PASS |
| Typecheck clean | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| No new dependency | `git diff main -- package.json package-lock.json` | empty | ✓ PASS |
| z-50/absolute/bottom-full purged from Tooltip | grep | NONE | ✓ PASS |
| `ring-accent/20` absent (WCAG 1.4.11) | grep across 6 sites | NONE | ✓ PASS |
| Axe on CHANGED authed/embedded surfaces | seeded playwright matrix | not run (seed-gated, dormant in CI) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UIFIX-01 | 117-01 | Portaled tooltip renders fully in overflow/edge/Dialog/drawer | ✓ SATISFIED | Truths 1-6 verified; 8/8 tests |
| UIFIX-02 | 117-02 | Focus rings not clipped under overflow-x-auto (WCAG 2.4.7) | ✓ SATISFIED | Truths 7-9 verified; 6 sites ringed + ExposureByClass audited |
| UIFIX-03 | 117-03 | CUM RETURN shows extreme values untruncated; axe matrix green | ◑ MOSTLY | Truths 10-11 verified; truth 12 (axe on changed surfaces) → human |

No orphaned requirements: REQUIREMENTS.md maps UIFIX-01/02/03 to this phase; all three claimed by plans. (Note: REQUIREMENTS.md line 62 still shows UIFIX-03 as ⏳ — a ledger-status lag, not a code gap; code is complete.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX in any touched file | ℹ️ Info | Clean |
| ExposureByClass.tsx | 98 | `role="img"` present (summary claimed grep for `role` returned nothing) | ℹ️ Info | Non-focusable role; audit conclusion (no focusable child needing a ring) still holds — not a stub, not a gap |

### Invariants

- **Zero new design tokens:** ✓ `z-[210]` is a stock Tailwind arbitrary z-index (not a DESIGN.md token); `ring-accent`/`ring-2`/`ring-inset`/`break-words`/`min-w-0` are existing/stock utilities. No new color/font/spacing token.
- **scenario.ts untouched:** ✓ not present in the phase diff (`git diff e6f7f533..HEAD`).
- **Diff scope:** ✓ exactly 13 files, all expected (Tooltip, ResponsiveTable, FactsheetView, HeatmapPanels, DistributionPanels, AllocationsTabs, ScenarioFlaggedHoldingsList + colocated tests). No consumer-component collateral.
- **Axe matrix cells that ran locally:** public floor 15/15 green (5 public routes × 3 viewports). Seed-gated authed/embedded cells (the ones that render the changed surfaces) did NOT run — and per the axe spec header are dormant in CI too. → Human Verification #3.

### Human Verification Required

1. **Tooltip rendered placement** — open a tooltip inside an overflow-x-auto container, at a viewport edge, inside an open Dialog/drawer, and in the mobile drawer. Expect full unclipped render, on-screen at edges, above the z-[200] overlay. (Unit tests pin invariants; pixels unverified — the 117-01 summary itself recommends this /qa pass.)
2. **Focus-ring non-clipping** — keyboard-tab through the six UIFIX-02 sites; expect the inset accent ring to render fully inside bounds at every site, unclipped by the scroll container.
3. **Axe on the changed surfaces** — run the seeded axe matrix on /strategy/[id]/v2, /allocations, and the embedded composer factsheet across the three viewports. The local public floor does NOT cover these, and the axe spec's authed/embedded describes self-skip without seed env and are dormant in CI by design. Confirm zero WCAG 1.4.11 (≥3:1) failures from the new full-opacity focus ring and no contrast/aria regression on the reflowed CUM RETURN value.

### Gaps Summary

No FAILED truths and no blockers. All three deliverables (portaled tooltip, clip-proof focus rings, non-truncating CUM RETURN) are implemented, wired, and unit-test-pinned on the real HEAD (108/108 tests, tsc 0, no new deps/tokens, scenario.ts untouched). The one open item is verification COVERAGE, not code: the axe WCAG-AA matrix ran green only on the public floor, whose routes render none of the changed components; the authed/embedded cells that actually fold the changed factsheet/allocations surfaces are seed-gated and — per the spec's own header — dormant in CI. Combined with the inherently visual nature of tooltip placement and focus-ring non-clipping, this routes the phase to `human_needed`. The 117-03 SUMMARY's claim that "the full matrix runs on CI/PR with seed env" is optimistic — the axe spec documents those cells as dormant in CI; a manual seeded run (or browser QA) is the actual closure path.

---

_Verified: 2026-07-18T12:12:00Z_
_Verifier: Claude (gsd-verifier)_
