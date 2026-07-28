---
phase: 29
slug: unified-composer-spine
review_date: 2026-06-23
auditor: gsd-ui-auditor
baseline: 29-UI-SPEC.md (approved design contract)
screenshots: not captured (no dev server; code-only audit)
overall_score: 20/24
---

# Phase 29 — UI Review

**Audited:** 2026-06-23
**Baseline:** 29-UI-SPEC.md (approved design contract + DESIGN.md LOCKED tokens)
**Screenshots:** not captured (no dev server detected; code-only audit)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every spec'd label, empty/error state, and validation message matches the contract verbatim |
| 2. Visuals | 3/4 | Entry-mode control visually correct; "Scenario" H2 lives in the header row alongside the control and toolbar, preventing the KPI strip from anchoring visually when the header row gets crowded |
| 3. Color | 3/4 | 60/30/10 discipline respected; one bare `var(--surface, white)` (without `--color-` prefix) in StrategyBrowseDrawer inline style silently breaks under Tailwind v4 token resolution |
| 4. Typography | 3/4 | New chrome correctly uses the 4-size / 2-weight contract; drawer title uses `text-lg` (18px), which is outside the contracted 4-size scale |
| 5. Spacing | 4/4 | All new Phase-29 chrome lands on the 4px ladder; `max-w-[1100px]`, `min-w-[220px]`, `h-[300px]` are layout constraints, not spacing values — all legitimate |
| 6. Experience Design | 3/4 | Loading/error/empty state coverage is exemplary; delete mutation error copy ("Couldn't delete this portfolio") diverges from the spec (no delete-failure copy was specified — but the rendered copy is acceptable and benign) |

**Overall: 20/24**

---

## Top 3 Priority Fixes

1. **`var(--surface, white)` bare token in `StrategyBrowseDrawer.tsx:389`** — Under Tailwind v4 `@theme inline`, the canonical token is `--color-surface`. The bare `--surface` resolves to `currentColor`/black (the 2026-05-06 DESIGN.md decision, and the exact bug class fixed in EquityChart/KpiStripWidget/MandateSnapshotWidget/AllocationByStyleWidget). Concrete fix: change the inline `background` style to `"var(--color-surface, white)"` matching the `ResetConfirmationModal` at ScenarioComposer.tsx:2482 (which already uses the correct prefix).

2. **Drawer title `text-lg` (18px) deviates from the 4-size scale** — `StrategyBrowseDrawer.tsx:398` renders the drawer title at `text-lg` (18px). The contracted 4-size scale for new Phase-29 chrome is `32 / 16 / 14 / 12`. The section-heading tier is `text-base` (16px semibold). `text-lg` is not a member of the contracted set and is not an inherited pre-existing component. Concrete fix: change `text-lg font-semibold` to `text-base font-semibold` at line 398.

3. **`Scenario` H2 heading copy not relabeled to `Portfolio`** — UI-SPEC §Copywriting mandates the noun "portfolio" throughout the unified-composer UI. The main body H2 at ScenarioComposer.tsx:1647 still renders `Scenario` (`<h2 className="text-2xl font-semibold text-text-primary">Scenario</h2>`). The spec prescribes "portfolio" as the user-facing term (with "scenario" remaining only in code/route names). The section heading and composer title row should read "Portfolio" (or "Compose a portfolio" to distinguish it from a section label). This is a WARNING-tier deviation — users see the word "Scenario" in the H2 while all CTAs say "portfolio" — the terminology is split.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

All Phase-29 mandated copy verified present and verbatim:

- Save toolbar CTAs: "Save portfolio" (ScenarioComposer.tsx:1733), "Update portfolio" (line 1746), "Save as new portfolio" (line 1759) — all match spec exactly.
- Inline name input placeholder `"Name this portfolio"` with matching `aria-label` at line 1774 — correct.
- Entry-mode segments: "From my book" (line 1690) and "Blank slate" (line 1707) — match spec.
- Empty-state heading "Start a portfolio" at line 1588 — correct, Instrument Serif via `var(--font-serif)`.
- Empty-state body at lines 1591–1595 — matches spec verbatim.
- Empty-state CTAs: "Connect Exchange →" (line 1599) and "Browse strategies" (line 1607) — correct.
- Catalog drawer title "Browse strategies" at StrategyBrowseDrawer.tsx:399 — correctly drops "verified" per spec.
- "Example" tag copy at StrategyBrowseDrawer.tsx:507 — correct, uppercase "Example".
- Saved list heading "Saved portfolios" at SavedScenariosList.tsx:398 — correct.
- Empty list heading "No saved portfolios yet" at SavedScenariosList.tsx:415 — correct.
- Empty list body (SavedScenariosList.tsx:416–419) — matches spec verbatim including the "Save portfolio" internal quote.
- Reopen notices: "older format" at ScenarioComposer.tsx:815 and "read-only here" at line 837 — both match spec.
- Catalog error: "Couldn't load strategies — close and reopen the drawer." at StrategyBrowseDrawer.tsx:454 — matches spec and has `role="alert"`.
- Save failure copy at line 953: "Couldn't save this portfolio. Check your connection and try again." — matches spec.
- Rename failure at SavedScenariosList.tsx:339,349: "Couldn't rename this portfolio. Try again." — matches spec.
- List load failure at SavedScenariosList.tsx:409–411: "Couldn't load your saved portfolios. Try again." with `role="alert"` — matches spec.
- Name validation: "Enter a name to save this portfolio." (ScenarioComposer.tsx:930, SavedScenariosList.tsx:118) and "Portfolio names are limited to 120 characters." (lines 932, 121) — both match spec.
- Delete confirm renders inline as `Delete "{row.name}"?` at SavedScenariosList.tsx:515–516 — matches the destructive-confirm pattern.
- PROJECTED honesty pill text "PROJECTED — hypothetical, not your live book" at line 1652 — matches locked invariant.

**WARNING (non-blocking):** The H2 heading at line 1647 renders `Scenario` — see Priority Fix #3. This is a copywriting deviation but isolated to the title word, not a label or CTA.

---

### Pillar 2: Visuals (3/4)

**Entry-mode segmented control — correct implementation:**
- `role="radiogroup"` with `aria-label="Composition entry mode"` at line 1667.
- Each button: `role="radio"` + `aria-checked` + `tabIndex` roving. Keyboard `ArrowLeft`/`ArrowRight` handler at lines 1671–1675.
- Active state: `border border-accent text-accent` on `--color-surface` background — no accent fill, matching the FilterPill recipe. Correct.
- Inactive state: `border border-transparent text-text-secondary`. The transparent border preserves the layout dimension so the control doesn't shift width on toggle. Good.
- Container: `rounded-md border border-border p-0.5` — matches `--radius-md` (6px) and 1px border spec.
- When `!hasLiveBook`: "From my book" segment is not rendered at all (line 1677 gate `{hasLiveBook && ...}`). The spec allows "disable or default to Blank slate"; the implementation chooses to hide the dead segment — acceptable.

**"Example" pill — correct:**
- At StrategyBrowseDrawer.tsx:503–509: `inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted` — verbatim match to the spec's locked recipe. Neutral-outline, muted, no fill, no accent. `data-testid` present.

**WARNING — header row crowding:**
- The flex row at ScenarioComposer.tsx:1646 (`flex flex-wrap items-center gap-3`) places the H2 "Scenario", the PROJECTED pill, the entry-mode radiogroup, AND the save toolbar (ml-auto) all in one row. On viewports narrower than the full 1100px, `flex-wrap` causes the toolbar to wrap below the controls, which is fine; but the H2 anchor and the PROJECTED pill are not visually separated from the entry-mode control by any spacing tier above `gap-3` (12px). The spec says entry-mode chrome should "stay calmer" so the KPI strip remains the focal point. The current layout places three distinct affordances at the same visual weight in the same row before the KPI strip, which risks fragmenting the entry-point scan path. Not a blocker (the KPI strip is below at `mt-6`), but the visual hierarchy could be cleaner with a dedicated sub-row for the entry-mode control below the H2+PROJECTED row.

**Visual hierarchy of focal point:**
- The KPI strip renders at `mt-6` below the combined header row. In the non-empty state, a user scanning from the top encounters H2 + PROJECTED pill + entry-mode control + save toolbar, then a subtitle (`mt-1 text-sm`), then the coverage caveat (`mt-2 text-[11px]`), then optionally a fingerprint-mismatch banner (`mt-4`), then the KPI strip (`mt-6`). This is a 5-element scan before reaching the primary anchor, slightly more than the spec envisions. No individual element is wrong; the cumulative depth is a mild hierarchy dilution.

---

### Pillar 3: Color (3/4)

**60/30/10 discipline:**
- Dominant (60%): `bg-surface`, `bg-page` via Tailwind tokens throughout. Correct.
- Secondary (30%): `border-border`, `text-text-muted`, `text-text-secondary` — used correctly for dividers, muted copy, timestamps.
- Accent (10%): 27 accent references across three files. Audit of each:
  - `bg-accent` primary CTAs: Connect Exchange (line 1599), Open Bridge (line 2080), Browse strategies in "Add more strategies" block (line 2146), "Add" button in StrategyBrowseDrawer (line 528) — all are primary CTAs, correct.
  - `border-accent text-accent` active segment (lines 1687, 1703) and active filter pills (StrategyBrowseDrawer line 117) — mode toggle + filter pills, correct per spec.
  - `text-accent underline` links: "Try the Strategy Sandbox" (line 1613), "Clear filters" (StrategyBrowseDrawer line 474) — inline text links, correct per spec.
  - `focus:border-accent` / `focus:ring-accent` on inputs — focus rings, correct.
  - `hover:border-accent` on secondary border buttons — hover only, not a persistent accent usage. Acceptable.
  - `bg-accent` on the add-strategy toggle switch (CompositionList line 2390) — accent fill on an interactive state toggle. The spec lists primary CTAs for accent fill; a toggle switch active state was not explicitly listed. However toggle active state is a canonical "action/verified" signal. Borderline acceptable; not a blocker.

**BLOCKER — `var(--surface, white)` bare token:**
- StrategyBrowseDrawer.tsx:389: `background: "var(--surface, white)"` — the Tailwind v4 `@theme inline` convention requires `--color-surface`. Without the `--color-` prefix, this resolves to `currentColor` or `black` in Tailwind v4 (the exact failure mode described in DESIGN.md 2026-05-06 entry). The drawer panel background would render black instead of white in production. The `ResetConfirmationModal` in the same file correctly uses `var(--color-surface, white)` at line 2482 — the fix is a one-character token prefix correction.

**One hardcoded color that is policy-compliant:**
- ScenarioComposer.tsx:1935: `style={{ backgroundColor: "#94A3B8" }}` — this is the BTC Benchmark chart legend swatch. `#94A3B8` is `--color-chart-benchmark` per DESIGN.md. The swatch renders 1px × 4 pixels as a visual legend key; an inline style is standard for chart swatches. Acceptable; this is a display element not a semantic UI color.
- ScenarioComposer.tsx:2511: `style={{ background: "var(--color-negative, #DC2626)" }}` on the ResetConfirmationModal "Discard draft" button — uses the correct `--color-*` prefix with a safe fallback. Clean.

**TIER_BG hardcoded rgba values in StrategyBrowseDrawer.tsx:93–96:**
- The mandate-fit chip backgrounds use `rgba(21,128,61,0.10)`, `rgba(217,119,6,0.10)`, `rgba(220,38,38,0.10)`. These are `--color-positive/10`, `--color-warning/10` (using the OLD amber value `#D97706` = 217,119,6 — note DESIGN.md shifted warning to `#B45309` on 2026-04-30), and `--color-negative/10`. The warning rgba is stale: it encodes `#D97706` (the pre-shift value), not `#B45309`. This is a pre-existing component behavior (the mandate-fit chip predates Phase 29), but Phase 29 touches this file. **WARNING-tier** — visually subtle but semantically incorrect, and the chip was not introduced by Phase 29 so it is outside this phase's strict audit scope.

---

### Pillar 4: Typography (3/4)

**New Phase-29 chrome size compliance:**
- Entry-mode segment labels: `text-sm` (14px) at lines 1685, 1701 — correct, body tier.
- "Example" tag: `text-[10px]` at StrategyBrowseDrawer.tsx:506 — correct, inherits the existing neutral-outline pill recipe (explicitly called out as inherited in UI-SPEC §2 Typography note).
- "Saved portfolios" heading: `text-base font-semibold` at SavedScenariosList.tsx:396 — 16px semibold, correct section-heading tier.
- Save toolbar CTAs: rendered via `Button size="sm"` — inherits the existing Button component size, not a new size token.
- Empty-state H2 "Start a portfolio": `text-2xl` (24px) via Instrument Serif — within the heading range. Note: the spec says "32px (page titles)" and the existing composer header uses `text-2xl`; the empty-state uses `text-2xl` consistently with the main header. Minor: the spec table maps "Display/page title" to 32px Instrument Serif but notes "keep as-is" for the existing 24px composer header. Compliant.

**FIND — Drawer title `text-lg` (18px) deviates from scale:**
- StrategyBrowseDrawer.tsx:398: `<div className="text-lg font-semibold text-text-primary">Browse strategies</div>` — 18px is not a member of the contracted 4-size scale (32/16/14/12). The drawer title is new Phase-29 chrome (relabeled from "Browse verified strategies"). The correct tier is section-heading: `text-base font-semibold` (16px). This is the only typography deviation in new chrome.

**Weight compliance:**
- New chrome uses: `font-semibold` (600) on headings/labels, `font-medium` (500) on the mandate-fit chip and row names (pre-existing behavior), and implicitly 400 regular on body copy. The spec allows `font-medium` on inherited reused components (DESIGN.md "DESIGN.md also blesses 500 medium"). No new third weight introduced by Phase-29 surfaces.

**Inherited micro-labels (pre-existing, not new):**
- Coverage caveat `text-[11px]` at lines 1832, 1892, 1961 — inherited from existing IMPACT-01 pattern, not new.
- Multi-venue caveat `text-[11px]` at line 2339 — inherited.
- PROJECTED pill `text-[10px]` at line 1650 — inherited.
All are correctly characterized as inherited per the spec's Typography note.

---

### Pillar 5: Spacing (4/4)

**Phase-29 new controls are on the 4px ladder:**
- Entry-mode control container: `p-0.5` (2px inset) — on scale (0.5 tier, badge-inset size).
- Segment buttons: `px-3 py-1` (12px/4px) — on scale.
- Gap between header row elements: `gap-3` (12px) — on scale.
- Save toolbar: `gap-2` (8px) — on scale.
- Drawer inner padding: `padding: 24` inline style — on scale (6 tier).
- Browse drawer filter gaps: `gap-2` (8px) — on scale.
- Row padding `p-3` (12px) on strategy rows — on scale.
- Saved portfolio rows `p-3` (12px) — on scale.
- Empty state card `p-12` (48px) at line 1584 — matches spec "empty-state card padding p-12".
- "Add more strategies" block at `mt-8` (32px) — matches spec "mt-8 on 'Add more strategies'".

**Arbitrary values are justified layout constraints:**
- `max-w-[1100px]`: DESIGN.md max content width 1100px. Correct.
- `min-w-[220px]`: name input minimum width. Layout constraint, not a spacing value.
- `h-[300px]`: DrawdownChart container fixed height. Layout constraint, not spacing.
- `text-[10px]`, `text-[11px]`: font-size tokens, covered under Typography.

No off-ladder `margin`/`padding`/`gap` values found in new Phase-29 chrome. Score: 4/4.

---

### Pillar 6: Experience Design (3/4)

**State coverage — excellent:**
- Loading: StrategyBrowseDrawer shows `Loading…` spinner text (line 447–449) while fetching. ScenarioComposer shows `Loading returns…` banner (lines 2106–2116) with `role="status" aria-live="polite"` while lazy-fetching added strategy returns. Both honest; neither fabricates a flat series.
- Error (blocking): Catalog load failure at StrategyBrowseDrawer:453 uses `role="alert"` + `text-negative` + canonical copy. List load failure at SavedScenariosList:401–411 — honest ERROR state vs. empty state distinction correctly implemented per the #509 lesson.
- Error (mutation): Save failure, rename failure, delete failure all handled with `role="alert"` and canonical copy. Revoke convergence-to-revoked (404 treated as success) correctly handled at SavedScenariosList:289.
- Empty: `isEmptyState` renders the spec'd empty-state card with dual CTA. `localRows.length === 0` (no saved portfolios) renders `EmptyStateCard` with heading/body match. No-filter-match state at StrategyBrowseDrawer:468–479 with inline "Clear filters" link. "No strategies are live yet." catalog empty state at line 457–463. All covered.
- Disabled states: "Add" button disabled (`disabled={justAdded}`) during the 2s "Added ✓" window. Save/Update buttons `disabled={savePending}` during in-flight POST/PUT. Weight input `disabled={!enabled}` on toggled-off strategies.
- Destructive confirm: Inline delete confirm (`Delete "{name}"? → [Delete] [Cancel]`) at SavedScenariosList:513–530 — matches spec, no modal.
- Reopen codec trichotomy: `ok` / `readonly` / `reset` outcomes all handled at lines 820–850 with honest notices. The `WR-04` guard wraps `JSON.stringify` to prevent the `TypeError`/`undefined` silent-empty failure. Correct.
- Mode-switch dirty-draft guard: A non-zero `diffCount` parks the target mode and opens the reset confirmation (line 760–764) — never a silent wipe.

**WARNING — delete mutation error copy differs from spec:**
- The spec does not define a "delete failure" error string (the copywriting contract only covers rename and list-load failures). `SavedScenariosList.tsx:363,375` renders `"Couldn't delete this portfolio. Try again."` — this is a reasonable pattern-extension of the specified rename-failure string, and it uses `role="alert"`. Not a correctness failure, but it was not specified. No impact on user task completion.

**WARNING — drawer `aria-label` vs. `aria-labelledby`:**
- StrategyBrowseDrawer.tsx:380: `role="dialog" aria-label="Browse strategies"` — uses `aria-label` directly. The spec doesn't mandate `aria-labelledby` specifically; `aria-label` is valid. However the visible `div` heading "Browse strategies" at line 399 is not a heading element (`<h2>`/`<h3>`) — it is a `<div>`. Screen-reader users won't get that text as a heading within the dialog. A `<h2>` + `aria-labelledby` would be more robust. Minor, deferred to Phase 33 WCAG-AA axe audit.

**Focus management:**
- `ResetConfirmationModal`: no explicit `autoFocus` on the cancel/confirm buttons. The "Revoke" confirm at SavedScenariosList:541 uses `autoFocus` correctly. The reset modal's confirm button (ScenarioComposer.tsx:2507) is the destructive action; the safer default would auto-focus Cancel. No `autoFocus` is set on either — defaults to first focusable element which would be the Cancel button (DOM order, line 2501 before line 2507). Acceptable by convention.

---

## Registry Safety

Registry audit: no third-party component registries in use. Project uses hand-rolled `src/components/ui/*` on Tailwind v4 `@theme inline`. No `components.json`, no `npx shadcn` blocks. No registry checks required.

---

## Files Audited

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (2520 lines — full read)
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (561 lines — full read)
- `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (701 lines — full read)
- `.planning/phases/29-unified-composer-spine/29-UI-SPEC.md` (design contract)
- `DESIGN.md` (token authority)
