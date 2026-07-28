---
phase: 58
slug: coverage-legibility-disclosure
review_type: retroactive-advisory
audited: 2026-07-02
baseline: 58-UI-SPEC.md (approved) + DESIGN.md
screenshots: not captured (no dev server at localhost:3000)
verdict: ADVISORY — non-blocking; 2 WARNINGs require follow-on, no BLOCKERs
---

# Phase 58 — UI Review

**Audited:** 2026-07-02
**Baseline:** `58-UI-SPEC.md` (approved design contract) + `DESIGN.md`
**Screenshots:** not captured — no dev server running; code-only audit
**Registry audit:** skipped — `components.json` absent, no shadcn, no third-party blocks

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | `start`-bound include label deviates from locked string; localStorage key uses `composer.` instead of spec-suggested `scenario.` prefix |
| 2. Visuals | 4/4 | Focal-point hierarchy correct; blend header primary, chips secondary, timeline tertiary (collapsed); color-not-sole-signal satisfied everywhere |
| 3. Color | 4/4 | Three-state chip tokens match spec exactly; accent/muted/amber semantics locked; no raw hex in Phase 58 code |
| 4. Typography | 3/4 | N=1 degrade inherits `font-medium` from parent div (spec requires 400 regular); `CollapsibleSection` title renders `text-sm font-semibold text-text-primary`, not the spec's `text-fixed-11 font-medium text-text-muted`; `AutoExcludedRow` name uses `text-sm` (unmigrated) |
| 5. Spacing | 4/4 | All spacing values on the 4px ladder; `gap-1.5` (6px) in timeline rows is off-ladder but negligible and within the bar-height exception window |
| 6. Experience Design | 4/4 | All required states handled; WCAG-AA a11y correct; motion and reduced-motion correct; SSR-safe hydration; `composer.` namespace registered in `storage-namespaces.ts` |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **`start`-bound include-cost label deviates from locked copy** — `AutoExcludedRow` renders `"Include → moves window start to {date}"` for head-ragged strategies, but the spec's locked Copywriting Contract specifies a single verbatim string: `"Include → shortens window to {date} (−{N} mo)"` with no branch for `movedBound === "start"`. The three-branch approach is architecturally sound (and better UX), but it was added without a spec amendment. In the absence of an explicit spec change, the `start` branch copy is an unapproved deviation. Fix: either backport to the single locked string (losing the head-ragged verb distinction) or amend the spec/CONTEXT.md to lock all three variants verbatim. The `both` and `end` branches are verbatim-correct.

2. **N=1 degrade inherits `font-medium` weight — spec requires 400 regular** — `BlendHeader`'s outer `<div>` carries `font-medium`. The N=1 `<span className="text-fixed-11 text-text-muted">` adds no `font-normal` override, so the browser inherits `font-medium` (500). Spec §Typography: the degrade note is `400 regular`. Fix: add `font-normal` to the N=1 span. One-character addition, zero visual risk for N≥2 paths.

3. **`CollapsibleSection` title typography does not match the spec's timeline toggle label** — `CollapsibleSection.tsx:148` hardcodes `text-sm font-semibold uppercase tracking-wider text-text-primary` for its `<h2>`. The spec §Typography requires the "Coverage timeline" toggle label to be `text-fixed-11 font-medium uppercase tracking-wide text-text-muted`. Because `CoverageTimeline` is consumed via the shared `CollapsibleSection` primitive, it cannot control these classes without a prop. The rendered label will be 14px DM Sans semibold primary (Tailwind `text-sm`), not 11px medium muted. Fix: add a `titleClassName` or `labelSize` prop to `CollapsibleSection` (or pass a `ReactNode` for the title slot) so this surface can apply the correct tier. This is a pre-existing constraint of the shared primitive — not a Phase 58 regression, but it causes a visible typography mismatch on this surface.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**WARNING — unapproved copy branch in include-cost button (`ScenarioComposer.tsx:3946–3951`).**

The locked spec string is: `Include → shortens window to {date} (−{N} mo)`.

The implementation introduces a three-branch conditional:
- `movedBound === "end"` → `"Include → shortens window to {end} (−{N} mo)"` — verbatim-correct.
- `movedBound === "both"` → `"Include → shortens window to {start}–{end} (−{N} mo)"` — verbatim-correct and well-motivated (WR-02).
- `movedBound === "start"` → `"Include → moves window start to {start} (−{N} mo)"` — **not in the locked spec**. The verb "moves" and the phrase "window start to" do not appear anywhere in `58-UI-SPEC.md` or `58-CONTEXT.md`. The executor documented this as WR-01 in a code comment, but WR-01 was never surfaced back into the approved contract. This is an executor-discretion decision on LOCKED copy — it should have been flagged and approved.

**Verdict:** The deviation is benign from a UX standpoint (it is arguably more precise), but it broke the contract without an amendment. Classification: WARNING.

**PASS — POLISH-03 note copy is verbatim.** `DefaultChangeNote.tsx:80–87`: `"Now showing the common period where all {N} overlap · Show full range"` matches the locked string exactly. The member count is rendered in `font-mono tabular-nums` as required.

**PASS — Blend header copy is verbatim.** All four header variants (N=0 empty, N=1 degrade, N≥2 normal, truncated append) match the locked strings in `BlendHeader.tsx:56–76`.

**PASS — Chip labels.** "In blend" / "Excluded" / "Outside window" — verbatim at `CoverageStateChip.tsx:27–32`.

**MINOR — localStorage key uses `composer.` prefix, spec suggests `scenario.`.** Spec §Interaction: `"suggest scenario.coverageDefaultChangeNoteDismissed"`. Actual key: `"composer.coverageDefaultChangeNoteDismissed"` (`DefaultChangeNote.tsx:62`). The spec explicitly marks the key name as "Claude's-discretion", so this is not a violation. The `composer.` prefix is registered in `storage-namespaces.ts:31` for sign-out purge. No flag.

**PASS — Inline drop reasons reuse `coverageDropReason()` verbatim.** No new copy strings authored. The `reason` prop is threaded from `ScenarioComposer` which calls `coverageDropReason()` at line 1908–1914.

---

### Pillar 2: Visuals (4/4)

**PASS — Focal point hierarchy.** The spec mandates: BlendHeader (primary) → row chips (secondary) → CoverageTimeline (tertiary, collapsed). This is implemented correctly. In `ScenarioComposer.tsx:2987–3091`, the DefaultChangeNote renders first (above), then the BlendHeader in its own `mt-6` wrapper, then the window control, then the CoverageTimeline in another `mt-6` wrapper. The timeline is `defaultOpen={false}` at `CoverageTimeline.tsx:98`. The blend header is always-visible when `windowBounds` is set; the timeline requires user action. Hierarchy is preserved.

**PASS — Color is never the sole signal.** Every gantt bar carries `aria-label` (`CoverageTimeline.tsx:146`) with strategy name, coverage dates, and membership word. Every chip carries a text label. The `AutoExcludedRow` shows both a chip and a text reason (`CoverageStateChip` + the `reason` span). Row names truncate with `title=` recovery on both the timeline (`CoverageTimeline.tsx:129`) and the AutoExcludedRow.

**PASS — No icon-only buttons.** The spec mandates no icons. The dismiss button has `aria-label="Dismiss"` and uses the `×` text glyph, not an icon. All other buttons have visible text labels.

**PASS — Active-window band overlay.** The gantt band is decorative (`aria-hidden`) and uses `border-accent bg-accent/5` to frame the active window without competing with the bar fills. Membership information is on the bar `aria-label`, not the band.

**PASS — Empty/null guard.** `CoverageTimeline.tsx:62`: returns `null` when `rows.length === 0 || !unionWindow`. No empty shell rendered.

---

### Pillar 3: Color (4/4)

**PASS — Three-state chip token mapping.** Matches spec exactly:

| State | Impl classes | Spec classes |
|-------|-------------|-------------|
| in-blend | `text-accent bg-accent/10` | `text-accent bg-accent/10` |
| manually-excluded | `text-text-muted bg-track` | `text-text-muted bg-track` |
| auto-excluded | `text-warning bg-warning-bg border border-warning-border` | `text-warning bg-warning-bg border-warning-border` |

(`CoverageStateChip.tsx:27–32`)

**PASS — Accent used only on reserved elements.** Accent (`text-accent`, `bg-accent`, `border-accent`) appears on: (1) in-blend chip, (2) in-window gantt bar (`bg-accent`), (3) active-window band border (`border-accent`), (4) "Show full range" and include-cost text-buttons (`text-accent`, `hover:text-accent-hover`). No unauthorized accent usage found in Phase 58 code.

**PASS — Auto-excluded is never red.** No `text-negative`, `bg-negative`, or `#DC2626` in any Phase 58 component. The one raw hex found in `ScenarioComposer.tsx:4274` — `style={{ background: "var(--color-negative, #DC2626)" }}` — is a pre-existing commit error banner, not Phase 58 code. (The raw hex is a CSS var fallback, which is technically a code-quality nit inherited from before Phase 58 but outside this audit's scope.)

**PASS — Gantt bar encoding.** In-blend bars: `bg-accent`. Auto-excluded bars: `bg-warning-bg border border-warning-border`. Track background: `bg-track`. The active window is `border-accent bg-accent/5` (decorative overlay, `aria-hidden`). All match spec.

**PASS — No raw hex in Phase 58 components.** Zero raw `#RRGGBB` or `rgb(` values found in `BlendHeader.tsx`, `CoverageStateChip.tsx`, `CoverageTimeline.tsx`, or `DefaultChangeNote.tsx`.

---

### Pillar 4: Typography (3/4)

**WARNING — N=1 degrade span inherits `font-medium` from parent (`BlendHeader.tsx:54,61`).**

The outer `<div>` at line 54 carries `font-medium`. The N=1 path at line 61 renders `<span className="text-fixed-11 text-text-muted">`. The span does not include `font-normal`, so CSS inheritance delivers 500 weight. Spec §Typography: the N=1 degrade is `400 regular`. The effect is subtle visually (DM Sans medium vs regular at 11px) but is a measurable deviation from the locked contract.

Fix: `<span className="text-fixed-11 font-normal text-text-muted">`.

**WARNING — CollapsibleSection title renders wrong tier for "Coverage timeline" toggle.**

`CollapsibleSection.tsx:148` hardcodes `<h2 className="text-sm font-semibold uppercase tracking-wider text-text-primary">`. This is the shared primitive's title style. When `CoverageTimeline` passes `title="Coverage timeline"` to it, the rendered toggle label will be:
- Actual: ~14px (Tailwind `text-sm`), 600 semibold, `text-text-primary`
- Spec required: 11px (`text-fixed-11`), 500 medium, `text-text-muted`

This is a pre-existing primitive constraint — not something Phase 58 could fix without modifying `CollapsibleSection`. The deviation exists and is visible: the timeline toggle label is a heavier, larger, darker label than the spec intended, which partially undermines its "tertiary" visual weight relative to the blend header.

**MINOR — `AutoExcludedRow` name span uses `text-sm` (`ScenarioComposer.tsx:3919`).**

`<span className="mt-0.5 truncate text-sm text-text-primary">` — `text-sm` is an unmigrated Tailwind utility (Tailwind `text-sm` = 14px, but the token is not a `text-fixed-*` or `--text-*` tier). This pre-dates Phase 58 (it was in the POLISH-02 implementation). The `no-raw-font-px` lint only gates raw `text-[Npx]`, not `text-sm`, so CI does not catch it. It is a pre-existing drift, not introduced in Phase 58, but it sits inside the `AutoExcludedRow` that Phase 58 extends.

**PASS — All Phase 58 new components use token-compliant sizes.** `BlendHeader`, `CoverageStateChip`, `CoverageTimeline`, and `DefaultChangeNote` consistently use `text-fixed-11`, `text-fixed-12`, `text-fixed-13` throughout. No `text-[Npx]` raw sizes.

**PASS — Geist Mono for numbers.** `font-mono tabular-nums` applied to: strategy count, effective start/end dates in BlendHeader; include-cost dates and month delta; member count in DefaultChangeNote; axis endpoint dates in CoverageTimeline. Matches DESIGN.md "all numbers use Geist Mono".

**PASS — Weight ladder.** Phase 58 new components use only 400 regular and 500 medium (plus `font-mono` for data). The `font-semibold` (600) weight does not appear in any new component. The two-weight constraint is met for Phase 58's own code.

---

### Pillar 5: Spacing (4/4)

**PASS — Spacing values on the 4px ladder.**

Observed values in Phase 58 components:
- `px-2 py-0.5` (8px / 2px) — chip padding — matches spec badge ladder (2px vertical is the DESIGN.md `py-0.5` badge convention).
- `px-4 py-3` (16px / 12px) — DefaultChangeNote panel padding — matches spec `md+ (16px)` / `md (12px)`.
- `mt-6` (24px) — vertical rhythm between header and window control — matches spec `lg (24px)`.
- `gap-2` (8px) — row inner spacing — matches spec `sm (8px)`.
- `gap-3` (12px) — DefaultChangeNote inner — matches spec `md (12px)`.
- `mt-2` (8px) — timeline axis label spacing — matches spec `sm (8px)`.
- `w-32` (128px) — timeline name column — not a spacing token but a layout width, not governed by the spacing ladder.

**MINOR — `gap-1.5` (6px) in `CoverageTimeline.tsx:101`.**

`<ul className="grid gap-1.5">` — 6px falls between the 4px and 8px rungs. The spec §Spacing notes "gantt bar vertical gap = xs (4px)" for the chip-related gap, but for the gantt row-to-row gap there is no explicit spec value. `gap-1.5` is technically off the ladder (neither 4px nor 8px). In practice, 6px between gantt rows is a reasonable visual density for a compact mini-chart. The bar height is `h-2` (8px) and the row gap is `gap-1.5` (6px), producing a compact readable grid. No ladder value fits better here (gap-1=4px is too tight; gap-2=8px makes the gantt visually loose). Given the spec's explicit note that "bar heights are a fixed small px authored as Tailwind height utilities, not raw font-px", this follows the same spirit. Flagged as a minor note but not scored down.

**PASS — No raw `px` spacing.** Zero `[Npx]` or `[Nrem]` arbitrary spacing values in Phase 58 components.

---

### Pillar 6: Experience Design (4/4)

**PASS — WCAG-AA: `role="status"` not `role="alert"` on non-blocking regions.** Both `BlendHeader` and `DefaultChangeNote` correctly use `role="status" aria-live="polite"`. The spec is explicit: "non-blocking → also polite, never `role="alert"`". No false-alarm assertive regions found.

**PASS — Keyboard / focus on all interactive elements.** All three new interactive elements carry `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` — matching the pattern the spec declares and the existing composer buttons at ~2862. All are real `<button type="button">` elements, not div-clicks. Enter/Space activate by default.

**PASS — Gantt bars carry `aria-label`.** `CoverageTimeline.tsx:146`: `aria-label={ariaLabel}` where `ariaLabel = "{name}: covers {first}–{last}, {membershipWord}"` (`{membershipWord}` = "in blend" or "auto-excluded"). This satisfies the spec's required format: `"{name}: covers {first}–{last}, {in-blend | auto-excluded — {reason}}"`. The reason is not appended in the auto-excluded case (only "auto-excluded" is appended), which is a minor omission versus the spec's suggested format — but the name + coverage + membership is sufficient for screen readers. No BLOCKER.

**PASS — Motion: `duration-300 ease-out motion-reduce:transition-none`.** `AutoExcludedRow` transition at `ScenarioComposer.tsx:3915`: `transition-all duration-300 ease-out motion-reduce:transition-none`. This is the correct Tailwind v4 token (`duration-300`, not the invalid `duration-250`). The spec explicitly calls out this substitution: "Tailwind `duration-300` — `duration-250` is not a valid v4 token and silently drops the animation". DESIGN.md Motion section confirms: "use `duration-300` — `duration-250` is not a valid Tailwind v4 token". DefaultChangeNote buttons use `duration-150` (hover micro-transitions) — correct per DESIGN.md "Hover states: 150ms ease-out".

**PASS — CoverageTimeline: no transition in JSX, correct.** The comment at line 30 mentions "Tailwind v4 250ms duration tier + `motion-reduce:transition-none`" but no transition class is actually applied in the JSX (the timeline body div at line 100 has no transition classes). The `CollapsibleSection` itself uses `<details>` native show/hide (the `transition-transform` at line 141 is only on the chevron indicator). Native `<details>` expand has no CSS transition — this is consistent with the spec's note about the `CollapsibleSection` wrapping the timeline body. The comment in the JSDoc is slightly misleading (it implies a transition would exist in CoverageTimeline that doesn't), but the rendered behavior is correct.

**PASS — SSR-safe hydration.** `DefaultChangeNote.tsx:70`: gates render on `isHydrated` before exposing the dismissed state. The `useCrossTabStorage` primitive used is the project-standard SSR-safe two-pass mount. No flash risk.

**PASS — `composer.` namespace registered.** `src/lib/storage-namespaces.ts:31` explicitly registers `"composer."` with a comment tying it to Phase 58. Sign-out purge covers `composer.coverageDefaultChangeNoteDismissed`.

**PASS — Include-cost apply never reselects manually-excluded strategies.** `ScenarioComposer.tsx:3742`: `onInclude` calls only `applyWindow(row.includeCost!.target)` — no `selected` mutation. The spec contract "Does NOT auto-reselect a manually-excluded strategy" is satisfied.

**PASS — No destructive confirmation.** Phase 58 adds no destructive action. The include-cost apply is reversible via existing presets. Correct.

---

## Registry Safety

Not applicable. `components.json` is absent. No shadcn. No third-party blocks. Zero new runtime dependencies introduced.

---

## Files Audited

| File | Lines Read | Role |
|------|------------|------|
| `.planning/phases/58-coverage-legibility-disclosure/58-UI-SPEC.md` | full | Design contract (PRIMARY) |
| `DESIGN.md` | full | Project design system / tokens |
| `src/app/(dashboard)/allocations/components/BlendHeader.tsx` | full (81 lines) | COVERAGE-03 |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` | full (48 lines) | COVERAGE-02 |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx` | full (174 lines) | COVERAGE-01 |
| `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` | full (100 lines) | POLISH-03 |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | targeted sections (lines 145–149, 495–544, 1802–1985, 2960–3092, 3695–3975, 4060–4210) | Wiring + AutoExcludedRow + CompositionList |
| `src/components/ui/CollapsibleSection.tsx` | full (164 lines) | CoverageTimeline host primitive |
| `src/lib/storage-namespaces.ts` | targeted grep | composer. prefix registration |

---

## Verdict

This is a strong implementation. 22/24 reflects two genuine deviations from the approved contract (N=1 weight inheritance, CollapsibleSection title typography) plus one copy branch that was added outside the locked spec. No BLOCKERs. Two WARNINGs require a follow-on patch; one is a one-line fix (`font-normal` on the N=1 span). The `CollapsibleSection` title typography issue is a pre-existing primitive constraint that requires a small API extension to resolve.

The three pillars that scored 4/4 (Color, Spacing, Experience Design) are clean without qualification — token fidelity, WCAG-AA semantics, motion, and state coverage all meet or exceed the contract.
