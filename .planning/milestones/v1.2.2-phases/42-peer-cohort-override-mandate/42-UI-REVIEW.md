---
phase: 42
slug: peer-cohort-override-mandate
type: advisory-ui-review
audited: 2026-06-26
baseline: 42-UI-SPEC.md
screenshots: not captured (no dev server; code-only audit)
scope: new/changed elements only — PeerPercentilePanel disclosure, ConstituentMandatePanel chips, OwnBookDeltaPanel
---

# Phase 42 — Advisory UI Review

Scope is the three new/changed elements on the scenario blend's MetricsColumn. Existing
primitives (percentile bars, editorial shell, TermsPanel, StyleDriftPanel) are out of
scope unless they directly affect the audited elements.

---

## Pillar Scores (scoped to new/changed elements)

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Disclosure copy verbatim-correct; basis note deviates from UI-SPEC template but is more honest (WR-02); |
| 2. Visuals | 4/4 | No badge leak on scenario path; disclosure below bars; chips correctly neutral-outline; delta panel structure clean |
| 3. Color | 4/4 | All tokens are `--color-*` prefixed; positive/negative semantics correct; `var(--color-warning, #B45309)` fallback pattern is pre-existing convention |
| 4. Typography | 3/4 | h3 at `text-[13px]` deviates from UI-SPEC's `text-[12px]` spec — pre-existing file convention, not a Phase 42 regression |
| 5. Spacing | 4/4 | Chip gap `gap-1` (4px), constituent hairlines `border-border/40 py-2`, basis note `mt-2` all conform to spec |
| 6. Experience Design | 4/4 | Null-guards correct on all three paths; honest-empty states implemented per spec; zero-delta edge handled (no sign, no color) |

**Overall: 22/24**

---

## Priority Fixes

1. **Leverage chip renders unconditionally when any type/market is present** — a constituent with types/markets but leverage=1.0 (unlevered) renders a "1×" chip that adds no information. Severity: WARNING. UI-SPEC §2 says "if leverage_range is present" as a conditional. Fix: guard the leverage chip row on `c.leverage > 1` (or `c.leverage !== 1.0`) so it only appears when there is actual leverage metadata to communicate. File: `src/app/factsheet/[id]/v2/MandatePanels.tsx` line 191.

2. **Basis note copy deviates from UI-SPEC verbatim contract** — UI-SPEC Copywriting Contract specifies: `"Delta = blend minus your live book · sample/252 basis · {N} book observations"`. Implemented copy is: `"Delta = blend minus your live book · sample/252 basis · over each series' own window ({blend_n} obs blend · {book_n} obs book)"`. This is longer and more honest (WR-02 window-mismatch disclosure), but it deviates from the spec template and is verbose at 10px italic. Severity: WARNING (advisory). The content is correct; the deviation should be ratified in UI-SPEC or the copy shortened to match. File: `src/app/factsheet/[id]/v2/BatchDPanels.tsx` line 171-172.

3. **h3 panel headings at `text-[13px]` vs UI-SPEC `text-[12px] tracking-[0.18em]`** — all three new panel h3 headers (`Peer Percentile`, `vs Your Book`, `Mandate`) use the pre-existing file convention `text-[13px] tracking-wider` rather than the UI-SPEC's specified `text-[12px] tracking-[0.18em]`. This is a file-wide pattern predating Phase 42 (all panels in `BatchDPanels.tsx` and `MandatePanels.tsx` follow it). Severity: WARNING for Phase 43 polish (not a Phase 42 regression — the new panels correctly match the existing file convention). File: `BatchDPanels.tsx` lines 95, 159; `MandatePanels.tsx` line 166.

---

## Detailed Findings

### 1. Peer Disclosure — Copywriting + Honesty (3/4)

**PASS — badge suppression correct.** The `!isScenario` guard at line 96 of `BatchDPanels.tsx` correctly gates `<DemoBadge>Demo cohort</DemoBadge>` to the api/demo path only. On the scenario path (`ingestSource === "csv"`), the badge never renders. No "Demo cohort" leak on the scenario path. Verified.

**PASS — disclosure copy verbatim.** Line 114 reads exactly:
```
hypothetical blend · ranked vs verified strategies · sample/252 basis
```
This matches the UI-SPEC Copywriting Contract verbatim. Middle-dot separator (U+00B7) confirmed in source. Typography is `text-[10px] text-text-muted` (plain, not italic) per spec.

**PASS — dual-path disclosure.** The ternary at line 112-120 correctly serves the plain disclosure (`isScenario`) vs the italic synthesized-cohort footnote (api path). The api path footnote is byte-identical to its pre-Phase-42 form.

**PASS — n < 252 and cohortSize < 20 suppression.** `if (!p) return null` at line 91 handles both: `scenarioPeer` is null when either gate fires. No partial render.

### 2. ConstituentMandatePanel Chips — Color + Honesty (4/4, 1 advisory)

**PASS — chip token conformance.** `Chip` component at line 216-218:
```tsx
<span className="inline-flex items-center rounded-sm border border-border px-2 py-0.5
  text-[10px] font-medium uppercase tracking-wider text-text-secondary">
```
Maps exactly to UI-SPEC §2 neutral-outline chip spec. `rounded-sm` = 4px, `border-border` = `--color-border` (#E2E8F0), `text-text-secondary` = #4A5568. No hardcoded hex. DESIGN.md badge ladder: PASS.

**PASS — no red/green misuse.** Chips use `text-text-secondary` throughout. No semantic color (positive/negative/warning) applied to strategy_types, markets, or leverage chips. Correct — these are metadata, not status signals.

**PASS — per-constituent honest-empty.** `hasMeta` check at line 171 gates on `strategy_types.length > 0 || c.markets.length > 0`. When false, line 196 renders `"no mandate metadata"` in `text-[11px] italic text-text-muted`. Conforms to UI-SPEC §2 honest-empty-per-constituent rule.

**PASS — whole-panel honest-empty.** `anyMetadata` check at line 159-161; when all constituents fail, line 203-205 renders the full-panel empty copy. Panel title "Mandate" still renders. Conforms to spec.

**PASS — null guard on non-scenario path.** `payload.ingestSource === "csv"` narrow at line 154-155; returns null on api path. Byte-identical to real route.

**ADVISORY — leverage chip unconditional in hasMeta branch.** When a constituent has types/markets but leverage=1.0, the chip row at line 191-193 always renders, producing a "1×" chip. The UI-SPEC spec says "if leverage_range is present" (implying conditional presence), and the comment at line 140 says "the leverage chip alone is not 'metadata'". This means a constituent with types/markets + leverage=1.0 renders "1×" as a chip — but 1× is the absence of leverage, not a meaningful disclosure. Recommended guard: `{c.leverage > 1 && <div className="flex flex-wrap gap-1"><Chip>{formatLeverage(c.leverage)}×</Chip></div>}`. Impact: low (most constituents running leverage will be > 1×, and the chip content is truthful if redundant for 1×).

### 3. OwnBookDeltaPanel — Delta Color + Dual-Count Disclosure (4/4, 1 advisory)

**PASS — non-color-only sign.** `signGlyph` at lines 225-229 prepends `"+"` or `"−"` (U+2212) in text. `DeltaRow` applies color as inline style only after confirming sign in display string. Color AND sign character both present for all non-zero, non-null values. WCAG 1.4.1: PASS.

**PASS — null/zero handling.** Null and non-finite values render `"—"` with no color (line 194, 207). Zero values render the numeric display with no sign and no color — a rare edge case not addressed by the spec, handled gracefully (no crash, no misleading color).

**PASS — maxdd color inversion.** `DeltaRow` at line 200-205: both `ratio` and `maxdd` kinds map `value > 0` to `--color-positive`. The comment at lines 199-205 correctly explains that for `max_dd` a positive delta (blend's max_dd is less negative = shallower) is favorable, so the same `value > 0 → positive` logic is correct for both kinds without needing a separate inversion branch. The UI-SPEC §Delta Color Rule describes this as "inverted" relative to naive reading, but the implementation is mathematically correct for signed drawdown values. PASS.

**PASS — silent absent when no book.** `payload.ingestSource === "csv" ? (payload.scenarioOwnBookDelta ?? null) : null` at line 153-154 means any non-scenario factsheet or a scenario with no live book returns null immediately. No zeroed deltas rendered.

**PASS — basis note dual-count.** Lines 171-172 disclose both `blend_n` and `book_n` observation counts, surfacing the window-mismatch risk (WR-02). Both are typed as `number` (non-optional) on `OwnBookDeltaPayload` (types.ts line 224/226), so no crash risk.

**ADVISORY — basis note deviates from UI-SPEC template.** The UI-SPEC Copywriting Contract specifies the simple template `"Delta = blend minus your live book · sample/252 basis · {N} book observations"`. The implementation uses the longer WR-02 variant: `"Delta = blend minus your live book · sample/252 basis · over each series' own window ({blend_n} obs blend · {book_n} obs book)"`. This is the correct and more honest form (it was fixed post-spec in code-review), but the spec should be updated to ratify it. At 10px italic in a narrow MetricsColumn rail, the line runs long — worth monitoring for wrapping behavior on 320px containers, though the factsheet shell is not expected to render below 768px per DESIGN.md.

### 4. A11y (no blockers)

**PASS — non-color-only delta.** Covered in §3 above.

**PASS — chip legibility.** `Chip` span contains the label as text content. No role needed for static display chips (not interactive). Screen reader reads constituent name then chip labels in natural DOM order.

**PASS — section + h3 landmark pattern.** All three panels use `<section>` with an `<h3>` heading, consistent with every other MetricsColumn panel. No aria-label added — matches the pre-existing no-aria convention on inner sections that are children of named `EditorialSection` blocks. Screen reader navigation by heading landmarks will surface "Peer Percentile", "vs Your Book", "Mandate".

**PASS — no landmark duplication.** The three panels are `<section>` elements without `role="region"` — they do not create duplicate named landmark regions (the a11y-axe e2e CI already enforces no-duplicate-main from Phase 33). The `<aside>` MetricsColumn wrapper provides the region landmark for the column.

**PASS — disclosure in reading order.** The `<p>` disclosure below the peer bars is in DOM order after the bars; screen readers will encounter it naturally after reading the percentile values.

**NOTE for Phase 43 polish — h3 size discrepancy.** All panel h3 headings across `BatchDPanels.tsx` and `MandatePanels.tsx` use `text-[13px] tracking-wider` rather than the UI-SPEC's `text-[12px] tracking-[0.18em]`. This is a file-wide pre-existing pattern. The v2 factsheet type contract (DESIGN.md 2026-04-29 entry) specifies panel H2 = 16px and everything else at 12px caption tier. The 13px h3 sits between the two tiers and is not in the strict 4-size contract. This is not a Phase 42 regression but should be addressed in Phase 43.

---

## Token Drift Notes (Phase 43 carry-forward)

| Token | Usage | Status |
|-------|-------|--------|
| `border-text` | Panel header hairlines throughout `BatchDPanels.tsx` and `MandatePanels.tsx` | Pre-existing convention with dark-mode override at globals.css:476. No `--color-text` declaration in `@theme inline` means it resolves to `currentColor` or `transparent` in Tailwind v4 light mode — this is an existing open issue in the factsheet shell, NOT introduced by Phase 42. Note for tech-debt: the dark-mode override at line 476 confirms the class is intentional; a `--color-text` declaration in `@theme inline` should be added to formalize it (e.g. `--color-text: #E2E8F0` — the standard border color). |
| `text-text-2` | Row labels in `DeltaRow` and `PercentileBar` | Same pre-existing situation: dark-mode override at globals.css:466, no `@theme inline` declaration. Light-mode resolution depends on Tailwind v4 fallback behavior. Pre-Phase-42 issue; not introduced here. |
| `var(--color-warning, #B45309)` fallback | `StyleDriftPanel` line 70; `TermsPanel` line 88 | Pre-existing pattern. The `#B45309` fallback matches the canonical `--color-warning` value in `@theme inline`, so it is a safe belt-and-suspenders fallback, not a divergence. New Phase 42 panels do NOT use this pattern — they were not needed to. |

Registry audit: `shadcn_initialized: false` per UI-SPEC header. No third-party registries. Skipped.

---

## Files Audited

- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` — PeerPercentilePanel, OwnBookDeltaPanel, DeltaRow, signGlyph
- `src/app/factsheet/[id]/v2/MandatePanels.tsx` — ConstituentMandatePanel, Chip, formatLeverage
- `src/app/globals.css` — token declarations, factsheet-v2-shell dark overrides
- `src/lib/factsheet/types.ts` — OwnBookDeltaPayload type (lines 211-227)
- `.planning/phases/42-peer-cohort-override-mandate/42-UI-SPEC.md` — design contract baseline
- `DESIGN.md` — palette, type, spacing, badge ladder
