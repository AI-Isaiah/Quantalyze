---
phase: 40
slug: mount-the-real-factsheet-body
audited: 2026-06-26
baseline: 40-UI-SPEC.md (approved design contract)
screenshots: not captured (no dev server)
---

# Phase 40 — UI Review

**Audited:** 2026-06-26
**Baseline:** 40-UI-SPEC.md
**Screenshots:** not captured (code-only audit — no dev server detected)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All spec copy present; "Page 1 / 1" footer stamp renders visibly on screen in the composer |
| 2. Visuals | 3/4 | FactsheetBody article shell carries `py-6 sm:py-10 lg:py-12` padding inside the composer's zero-padding wrapper — creates a top/bottom gap seam |
| 3. Color | 4/4 | All tokens inherited via `var(--color-*)` from existing body; no new color introduced; 60/30/10 distribution preserved |
| 4. Typography | 4/4 | No new type tokens; spec 4-size / 2-weight contract inherited correctly |
| 5. Spacing | 3/4 | `py-6 sm:py-10 lg:py-12` adds up to 48px vertical padding inside the composer wrapper; the `mt-16` footer top-margin (64px) amplifies the gap at the bottom of the body |
| 6. Experience Design | 3/4 | Blank-slate overlay is a React early-return before the body renders — no double empty state; degenerate states handled; "Page 1 / 1" screen-visible in composer is the one unresolved UX friction |

**Overall: 20/24**

---

## Top 3 Priority Fixes

1. **"Page 1 / 1" stamp renders visibly on screen inside the composer** — An allocator reading the scenario blend sees a print-pagination artefact ("Page 1 / 1") in the footer of the factsheet body, which has no meaning in the on-screen interactive context. The disclaimer text is valuable and correct; only the stamp line is the problem. The `FactsheetFooter` has no `factsheet-v2-no-print` class; the existing `@media print` CSS comment at `globals.css:420` says "hide the in-page footer stamp so it doesn't double-print" but does not actually hide it on screen. **Fix:** add a `factsheet-v2-no-print` class to the `<p>Page 1 / 1</p>` element at `FactsheetView.tsx:981-983`, or conditionally suppress it when `scenarioMode={true}`.

2. **Article shell `py-6/py-10/py-12` padding adds a visual gap seam at the composer mount boundary** — `FactsheetBody` renders an `<article>` with `px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12` (`FactsheetView.tsx:192`). When mounted inside the composer's bare `<div class="relative mt-6">` wrapper (`ScenarioComposer.tsx:2219`), the `py-*` vertical padding creates a top-gap (24–48px) between the composer chrome above (the PROJECTED badge, entry-mode control) and the start of the KPI strip. Below, `mt-16` (64px) on `FactsheetFooter` + the article's `py-12` bottom padding compound to ~112px of whitespace before the BTC Benchmark checkbox and the benchmark section card. DESIGN.md spacing scale stops at 64px (`3xl`); 112px compound-gap is off-scale. **Fix:** wrap the `<FactsheetBody>` mount in `ScenarioFactsheetChart` with a negative-margin compensator (`-mt-6 sm:-mt-10 lg:-mt-12`) on the outer wrapper, or pass a `compact` option to suppress the article's top padding when mounted in a composer context.

3. **ControlBar "justify-start lg:justify-end" leaves a left-flush 3-button row in composer that misaligns with the full-width factsheet expectation** — With `scenarioMode=true`, the ControlBar drops "Copy share link" and "Compare strategies", leaving only Display + Reset view + ComparatorPicker. The row uses `justify-start lg:justify-end` (`FactsheetView.tsx:850`). On `lg` viewports the 3 remaining controls align right. This is acceptable per spec. On `sm/md` viewports they are left-flush, which reads as unbalanced against the article's responsive horizontal padding (`px-4 sm:px-6 lg:px-10`). The gap is a WARNING-level cosmetic; not a blocking defect, but note it as an advisory for Phase 43 axe / layout pass.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASS items:**
- "PROJECTED — hypothetical, not your live book" pill present at `ScenarioComposer.tsx:1869` in composer chrome, not in body. Contract met.
- "Illustrative shape only — no live capital connected" present at `ScenarioComposer.tsx:2260` inside the `scenarioAum <= 0` guard. Contract met.
- "BTC Benchmark" label at `ScenarioComposer.tsx:2248`. Contract met.
- Period control copy ("3M", "6M", "12M", "ALL") at `ScenarioFactsheetChart.tsx:54`. Contract met.
- Low-N KPI caveat copy at `FactsheetView.tsx:680` exactly matches spec. Contract met.
- `NotEnoughDataPanel` copy at `FactsheetView.tsx:367-368` matches spec verbatim. Contract met.
- Footer disclaimer at `FactsheetView.tsx:972-978` matches spec verbatim. Contract met.

**WARNING — "Page 1 / 1" stamp:**
- `FactsheetView.tsx:981-983`: `<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Page 1 / 1</p>` renders visibly on screen inside the composer.
- `globals.css:420` comment: "Footer pagination is browser-driven; hide the in-page footer stamp so it doesn't double-print at the bottom" — but this is the `@media print` block comment; there is NO `display:none` rule targeting the stamp element on screen. The `a[href]::after { content: "" !important; }` rule on line 422 suppresses anchor hrefs from appearing in print, unrelated to the stamp paragraph.
- The `FactsheetFooter` element (`FactsheetView.tsx:971-986`) has no `factsheet-v2-no-print` class and no `scenarioMode` awareness. It always renders both the disclaimer AND "Page 1 / 1".
- The QSF stamp (`FactsheetView.tsx:980`) — `QSF · {strategyId[0..8]} · {YYYY.MM.DD}` — is institutional branding for the real factsheet; in the composer context it references a synthetic `strategyId` (the scenario blend's UUID), which is technically accurate but may confuse allocators expecting the stamp to reference a real verified strategy.
- Severity: **WARNING** (degrades composer UX; not a task-completion blocker)

---

### Pillar 2: Visuals (3/4)

**PASS items:**
- `hideHeader={true}` is correctly passed (`ScenarioFactsheetChart.tsx:188`). The composer owns the "Portfolio" H2 + "PROJECTED" badge at `ScenarioComposer.tsx:1864-1870`. No duplicate title.
- `hideAllocatorSection={true}` passed at `ScenarioFactsheetChart.tsx:189`. Belt-and-suspenders correct; AllocatorSection already has `ingestSource === "api"` guard at `FactsheetView.tsx:283`.
- `scenarioMode` correctly suppresses ShareLinkButton and Compare strategies link (`FactsheetView.tsx:860-869`) — no dead gap from hidden items because both conditional blocks produce zero DOM when false.
- The `topSlot` wrapper at `ScenarioFactsheetChart.tsx:199-205` uses `className="mb-1 flex items-center justify-end"` — right-aligned PeriodControl above KpiStrip. This aligns with the article's right-alignment convention. Acceptable.
- Blank-slate: `isEmptyState` at `ScenarioComposer.tsx:1801` triggers a full React early-return before any `<FactsheetBody>` renders. No double empty-state, no conflict. Correct.
- "PROJECTED — hypothetical" badge is always rendered at the top of composer (not inside the body). Visible and coherent.

**WARNING — Article shell vertical padding seam:**
- `FactsheetBody` article shell at `FactsheetView.tsx:192`: `py-6 sm:py-10 lg:py-12` (24/40/48px top and bottom).
- Composer wrapper at `ScenarioComposer.tsx:2219`: `<div class="relative mt-6">` — no padding, no clip.
- Result: the KPI strip's visible top edge is 24–48px below the composer chrome elements (PROJECTED badge / benchmark checkbox). This is noticeably more gap than the 24px `lg` section gap specified in DESIGN.md. At `lg` breakpoint the gap is 48px (DESIGN.md `2xl` = 48px, acceptable but pushing the upper bound of section-gap intent); at `md/sm` it is 40px. The bottom: `mt-16` on `FactsheetFooter` + `py-12` bottom of article = 64+48 = 112px below the last panel to the footer, then the BTC Benchmark checkbox appears after. This compound gap is visually off-scale per DESIGN.md (max documented value is 64px / `3xl`).
- Severity: **WARNING** (visual rhythm concern, not a blocker)

**INFO — ControlBar gap on suppression:**
- With `scenarioMode=true`, ControlBar has 3 items: Display + Reset view + ComparatorPicker. The `justify-start lg:justify-end` layout means the row is left-flush on mobile/tablet. On a full-width composer the 3 controls look sparse but not broken. No awkward horizontal gap because the suppressed items produce no DOM (they are conditional renders, not `display:none`).
- Severity: **NIT** (cosmetic, advisory only)

---

### Pillar 3: Color (4/4)

All color usage in Phase 40 is inherited from the existing `FactsheetBody` component family via `var(--color-*)` tokens. No new color tokens are introduced in `ScenarioFactsheetChart.tsx`.

- `var(--color-page)` (`#F8F9FA`) — article shell background (`FactsheetView.tsx:194`). Correct.
- `var(--color-surface)` — KpiStrip, panel cards. Correct.
- `var(--color-accent)` (`#1B6B5A`) — SectionNav active underline, DisplayMenu active badge, focus rings. Used only on declared elements per spec.
- `var(--color-positive)` / `var(--color-negative)` / `var(--color-warning)` — KPI tone cells, FreshnessChip, CapacityChip. All token-referenced, no hardcoded hex in Phase 40 diff.
- PeriodControl button in `ScenarioFactsheetChart.tsx:141` uses `text-text-secondary` (not `text-text-2`) — the comment at lines 132-140 correctly explains `--color-text-2` is injected only on `.factsheet-v2-shell` palette; using the global token is the right fallback.
- 60/30/10 distribution: page-bg (60%) / surface cards (30%) / accent (10%) — unchanged from existing factsheet body, consistent with DESIGN.md.
- Registry audit: `shadcn_initialized: false` per UI-SPEC.md. No third-party registries. Skip.

No color findings.

---

### Pillar 4: Typography (4/4)

No new type tokens introduced in Phase 40. The v2 4-size / 2-weight contract (`FactsheetView.tsx` and DESIGN.md decisions-log 2026-04-29) is inherited unchanged:

- Instrument Serif display: used only in `FactsheetHeader` (suppressed via `hideHeader=true`)
- 12px Geist Mono uppercase tracking: SectionNav, KpiStrip labels, ControlBar buttons, footer stamp — all correct via existing classes
- 15–22px Geist Mono tabular-nums: KPI values
- 11px italic DM Sans: footer disclaimer

The `PeriodControl` in `ScenarioFactsheetChart.tsx:141` uses `text-[10px] font-mono uppercase tracking-wider` — 10px Geist Mono, matching the factsheet TimeSeriesChart tab recipe verbatim per the inline comment. This is within the documented micro tier (10–11px) from DESIGN.md.

No typography findings.

---

### Pillar 5: Spacing (3/4)

**PASS items:**
- `topSlot` wrapper: `mb-1` (`4px`) between PeriodControl and KpiStrip — within the `xs` scale slot. Tight but intentional (the KpiStrip's own `mt-6` provides the primary gap).
- `KpiStrip` at `FactsheetView.tsx:632`: `mt-6` (24px) below topSlot — correct `lg` scale.
- Main grid at `FactsheetView.tsx:201`: `gap-x-12 gap-y-10` (48px/40px) — within spec `2xl`/`xl` range.
- `ControlBar` at `FactsheetView.tsx:850`: `mt-6 pb-3 gap-x-3 sm:gap-x-6` — within scale.
- Section collapsibles: `gap-10` (40px) between sections — within `xl` scale.
- `AllocatorSection` wrapper: `mt-12` (48px) — within `2xl` scale.

**WARNING — Article shell `py-*` in composer context:**
- `FactsheetView.tsx:192`: `py-6 sm:py-10 lg:py-12` (24/40/48px top + bottom padding on the article).
- When the factsheet is mounted as a standalone route, this padding creates breathing room from the page chrome above. In the composer context the padding is additive with the composer's own `mt-6` (`24px`) wrapper gap at `ScenarioComposer.tsx:2219`, producing a 48–72px total vertical gap at the seam (composer chrome → KPI strip visible top). DESIGN.md section gap scale tops out at 32px between content sections; a 72px gap at `lg` is off-scale.
- The bottom compound: `mt-16` (64px, `FactsheetView.tsx:971`) on `FactsheetFooter` + `py-12` (48px) article bottom padding = 112px from the last panel to the footer edge. The BTC Benchmark checkbox then appears below in the composer chrome, separated from the footer by no additional visual break. This creates an asymmetric rhythm: the footer appears to "float" far below the body panels.
- Neither spacing value is wrong in isolation; the issue is composition — the article shell was designed for standalone route mounting and carries its own page-level padding.
- Severity: **WARNING**

**ARBITRARY VALUES — none introduced in Phase 40:** `ScenarioFactsheetChart.tsx` uses only Tailwind scale classes and no `[Npx]` or `[Nrem]` arbitrary values in the new code.

---

### Pillar 6: Experience Design (3/4)

**PASS items:**

**Blank / degenerate state — no double empty-state:**
- `ScenarioComposer.tsx:1801` — `isEmptyState` triggers a full React `return` before the composer main body renders. `ScenarioFactsheetChart` (and therefore `FactsheetBody`) only renders in the main-body path. So the "no blend" case shows the blank-slate card (centered "Start a portfolio" with two CTAs) without any factsheet body underneath. No conflict, no double empty-state. Correct.

**Safe-empty payload:**
- Phase 39's `buildScenarioFactsheetPayload` is called with `portfolioDaily=[]` by default (`ScenarioFactsheetChart.tsx:155`). The resulting `synthPayload` feeds `FactsheetBody` which renders without crashing per the existing `BODY-03` test matrix (empty arrays, zero scalars).

**scenarioMode suppression:**
- `ControlBar` at `FactsheetView.tsx:860-869` conditionally hides `ShareLinkButton` and the Compare anchor with `!scenarioMode`. The absent items produce no DOM — no `aria-hidden`, no `disabled` elements. This is the correct treatment per the A11y contract in UI-SPEC.md.

**Landmark safety:**
- `FactsheetBody` article root is `<article id="factsheet-main" tabIndex={-1}>` (`FactsheetView.tsx:187-188`) — NOT `role="main"`. The allocations page's existing `<main>` landmark in the chrome is not duplicated. JOURNEY-03 class bug is not reproduced.

**tablist nesting:**
- `PeriodControl` at `ScenarioFactsheetChart.tsx:117-148` renders `role="tablist" aria-label="Period"` as a descendant of the `<article>` body (via `topSlot`), outside any `role="tablist"` from the composer's tab bar. No nested tablist. Each `<button role="tab">` carries `aria-selected={false}` at line 130. WCAG 2.1 APG compliance maintained.

**Loading states:**
- `MonthlyReturnsHeatmap` / `DailyReturnsHeatmap` are `next/dynamic` with `loading: () => <PanelSkeleton h={N} />` (`FactsheetView.tsx:37-43`). `PanelSkeleton` carries `aria-hidden` (`FactsheetView.tsx:58`). Correct.
- `LazyMount` wraps the heavy panels for viewport-deferred mount.

**WARNING — "Page 1 / 1" on screen:**
- `FactsheetView.tsx:981-983`: the "Page 1 / 1" stamp renders unconditionally on screen. There is no `scenarioMode` awareness in `FactsheetFooter` and no `factsheet-v2-no-print` class on that element. A scenario blend allocator sees a print-pagination artefact that has no semantic meaning in the on-screen interactive dashboard. The disclaimer above it is valid and should stay.
- Severity: **WARNING**

**INFO — `border-text` token in `FactsheetHeader` and `FactsheetFooter`:**
- `FactsheetView.tsx:420` and `FactsheetView.tsx:971` both use `border-text` for the header's bottom border and footer's top border. In `globals.css`, `border-text` only has a dark-mode override (`globals.css:476`). In Tailwind v4, `border-text` resolves to the Tailwind `text` color slot — which in light mode is `--color-text-primary` (`#1A1A2E`), a near-black. This means the header and footer horizontal rules render as near-black (`#1A1A2E`) hairlines, not the standard `--color-border` (`#E2E8F0`) that every other panel divider uses. This is pre-existing (not introduced by Phase 40) but is visible at the footer seam in the composer. Noted for GUARD-01 pass in Phase 43.
- Severity: **NIT** (pre-existing, not Phase 40 scope)

---

## Registry Safety

`shadcn_initialized: false` (confirmed in UI-SPEC.md). No third-party registry blocks used. Audit skipped per protocol.

Registry audit: 0 third-party blocks checked, not applicable.

---

## Files Audited

- `DESIGN.md`
- `.planning/phases/40-mount-the-real-factsheet-body/40-UI-SPEC.md`
- `.planning/phases/40-mount-the-real-factsheet-body/40-CONTEXT.md`
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx`
- `src/app/factsheet/[id]/v2/FactsheetView.tsx`
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (mount context, framing elements, blank-slate branch)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (tab panel wrapper, padding context)
- `src/app/globals.css` (@theme tokens, print stylesheet, factsheet-v2-no-print rule, border-text dark override)
