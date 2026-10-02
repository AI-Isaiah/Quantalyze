---
phase: 38
slug: composer-factsheet-parity-blank-mode-fix
audited: 2026-06-25
baseline: 38-UI-SPEC.md (approved design contract)
screenshots: not captured (no dev server running — code-only audit)
advisory: true
---

# Phase 38 — UI Review

**Audited:** 2026-06-25
**Baseline:** 38-UI-SPEC.md + DESIGN.md
**Screenshots:** not captured (no dev server at localhost:3000 or :5173 — code-only audit)
**Governing principle:** factsheet is the source of truth; parity with it is the goal.
Phase 38 additions are the new `ScenarioFactsheetChart.tsx` component and the
composer chrome around it (PROJECTED pill, BTC toggle swatch, width containers).

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | All contract strings verbatim; honesty pill unconditional |
| 2. Visuals | 3/4 | Color contract correct; PeriodControl lacks active-state visual (intentional per spec, but screen-reader state missing) |
| 3. Color | 4/4 | All tokens via `var(--color-*)`, zero new colors, swatch uses `--color-chart-benchmark` |
| 4. Typography | 3/4 | PeriodControl: `text-[12px]` and `tracking-[0.04em]` diverge from FactsheetView period button template (`text-[10px]` / `uppercase tracking-wider`) |
| 5. Spacing | 3/4 | `gap-0.5` / `mt-4` / `py-1` on ladder; `px-2.5` (10px) off-ladder but consistent with FactsheetView precedent; `gap-1.5` (6px) in BTC toggle row off-ladder but codebase-prevalent |
| 6. Experience Design | 3/4 | `role="tablist"` + `role="tab"` present but no `aria-selected` on period buttons; BTC checkbox has valid implicit label; PROJECTED pill has no `role="alert"` (correct) |

**Overall: 20/24**

---

## Top 3 Priority Fixes

1. **PeriodControl `aria-selected` missing on `role="tab"` buttons** — keyboard and screen-reader users in the `role="tablist"` cannot determine the currently-selected period; `aria-selected` is required by ARIA spec for tabs. Fix: add `aria-selected={false}` to every button unconditionally (since no period is "sticky" — the window is the truth), or if any button reflects the current period, add `aria-selected={isActive}`. This is a WARNING-level a11y gap; the project has a zero-axe-violation CI gate. File: `ScenarioFactsheetChart.tsx:103`.

2. **PeriodControl typography diverges from FactsheetView period button template** — `text-[12px] tracking-[0.04em]` does not match the established factsheet period-button style of `text-[10px] font-mono uppercase tracking-wider` used at `FactsheetView.tsx:818,848,858,879`. The governing principle is "look indistinguishably from the factsheet"; the composer's period buttons are visually larger and lack the uppercase treatment. Fix: align to `text-[10px] font-mono uppercase tracking-wider` and add `border bg-surface-subtle text-text-2 border-border hover:bg-surface min-h-[28px]` to match the FactsheetView template exactly. File: `ScenarioFactsheetChart.tsx:105`.

3. **`px-2.5` (10px) on PeriodControl button is consistent with FactsheetView but off the 4px spacing ladder** — 10px is the designer-bundle `--space-grid-gap` exception token, not a general button-padding value. The FactsheetView period buttons at lines 818/848 also use `px-2.5`, so this is a codebase precedent, not a novel deviation. Fix: leave unchanged (it mirrors FactsheetView exactly — changing it would break the parity goal), but document it as an inherited off-ladder value in a comment. This is informational only; no code change required.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

All contract strings are present verbatim and unconditional:

- `ScenarioComposer.tsx:1849` — `"PROJECTED — hypothetical, not your live book"` rendered in the main return branch (line 1832), not inside any conditional. Unconditional as required.
- `ScenarioComposer.tsx:2226` — `"BTC Benchmark"` on the toggle label, verbatim.
- `ScenarioComposer.tsx:2238` — `"Illustrative shape only — no live capital connected"` shown only when `scenarioAum <= 0`. Correctly conditional; not part of the static contract.
- The "Equity data warming up" warm-up copy does NOT appear in the new `ScenarioFactsheetChart` path (the synth payload is always non-degenerate when a scenario exists — PARITY-03 verified).
- No generic "Submit", "OK", "Cancel" labels were introduced.
- No empty/error state copy was altered.

No findings.

---

### Pillar 2: Visuals (3/4)

**WARNING — PeriodControl has no active/selected visual state.**

Per 38-UI-SPEC.md §Interaction Contract: "The SegmentedControl carries no active-highlight because the shared xRange is the single source of truth for the window; a sticky button state could desync from a brush pan." This is a deliberate design decision (documented in 38-03-SUMMARY.md key-decisions). The VISUAL omission is therefore spec-compliant.

However, the lack of any selected-state indicator — combined with the missing `aria-selected` (see Pillar 6) — means the current period is not conveyed to any user, sighted or not. The spec's rationale (desync risk) applies to a sticky persisted state; it is compatible with a read-derived active state computed from the current `xRange` window bounds. This is not a blocker but weakens the interaction affordance relative to the factsheet's own log/linear scale tabs which do show `aria-selected` and an active border.

**Positive:** The PROJECTED pill styling correctly follows the UI-SPEC: `border border-text-muted text-text-muted text-[10px] uppercase tracking-wide font-semibold rounded-sm` (ScenarioComposer.tsx:1847). It is NOT `bg-accent`, NOT warning-amber, NOT `role="alert"`. The pill is visually neutral — a metadata label, not an alarm.

**Positive:** The BTC swatch is a 2px-high 16px-wide hairline rendered via `inline-block h-0.5 w-4` with `backgroundColor: var(--color-chart-benchmark)`. This matches the muted-benchmark identity exactly and is `aria-hidden="true"` (decorative).

**Positive:** The composer max-width is 1440px at both the empty-state container (`ScenarioComposer.tsx:1785`) and the main body (`ScenarioComposer.tsx:1835`). `AllocationsTabs.tsx:127` also carries `max-w-[1440px]`, meaning the outer binding constraint is relaxed. `AllocationDashboardV2.tsx:157` retains `max-w-[1100px]` (out-of-scope tab unchanged). PARITY-02 fully satisfied.

---

### Pillar 3: Color (4/4)

All color usage in Phase 38 additions is via `var(--color-*)` tokens:

- `ScenarioFactsheetChart.tsx` — zero inline `stroke=`, `color:`, or hex literals (confirmed by grep; the component delegates all series coloring to `resolveSeries` via the two Plan-01 `ChartConfig` constants).
- `ScenarioComposer.tsx:2224` — `style={{ backgroundColor: "var(--color-chart-benchmark)" }}` on the BTC swatch. Correct token (`#94A3B8` per DESIGN.md `Chart benchmark`).
- The only hex that appears in Phase 38 lines is in a JSX comment (`/* muted #94A3B8 */`) — not a live style value.
- Accent (`--color-chart-strategy`) used only for the scenario equity line (via `resolveSeries`). Not applied to any decorative element.
- PROJECTED pill uses `border-text-muted text-text-muted` — not accent, not warning, correct.

No findings.

---

### Pillar 4: Typography (3/4)

**WARNING — PeriodControl button type style diverges from FactsheetView period button template.**

`ScenarioFactsheetChart.tsx:105` (PeriodControl button):
```
text-[12px] font-mono tracking-[0.04em] tabular-nums text-text-secondary
```

`FactsheetView.tsx:818` (canonical factsheet period/export button template):
```
text-[10px] font-mono uppercase tracking-wider text-text-2 bg-surface-subtle border border-border
```

Three divergences:
1. `text-[12px]` vs `text-[10px]` — 2px larger than the factsheet micro-label scale. The UI-SPEC §Typography declares 10px for "PROJECTED badge" and the factsheet period buttons. 12px is "Caption" tier in DESIGN.md, appropriate for body labels. For period buttons that appear alongside chart chrome, 10px is the established visual register.
2. `tracking-[0.04em]` vs `tracking-wider` — arbitrary value instead of the Tailwind token. `tracking-wider` is ~0.05em and is used consistently across the factsheet UI label pattern.
3. No `uppercase` — the factsheet period-button convention is uppercase mono labels (e.g. `3M`, `6M` are already uppercase strings, but the transform is declared in CSS as a convention, not assumed from the content).

**Positive:** `font-mono` is used (Geist Mono, correct for period labels as data-adjacent UI). The `tabular-nums` class is correct. The focus ring `focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent` matches the contract (`focus-visible:outline-accent`).

**Minor:** `tracking-[0.04em]` is an arbitrary tracking value not in the project's established token set. The factsheet uses `tracking-[0.18em]`, `tracking-[0.22em]`, `tracking-[0.14em]`, and Tailwind tokens `tracking-wider` / `tracking-wide`. This arbitrary value should use the nearest Tailwind token (`tracking-wider`) to avoid drift.

---

### Pillar 5: Spacing (3/4)

Spacing classes used in `ScenarioFactsheetChart.tsx`:

| Class | Computed | Ladder | Assessment |
|-------|----------|--------|------------|
| `gap-0.5` | 2px | Yes (documented 2px minimum) | Pass |
| `mb-1` | 4px | Yes | Pass |
| `py-1` | 4px | Yes | Pass |
| `px-2.5` | 10px | No — `--space-grid-gap` exception | See below |
| `mt-4` | 16px | Yes | Pass |

Spacing classes in the new composer chrome (ScenarioComposer.tsx:2213–2241):

| Class | Computed | Ladder | Assessment |
|-------|----------|--------|------------|
| `mt-2` | 8px | Yes | Pass |
| `gap-1.5` | 6px | No | See below |
| `mt-6` (enclosing div) | 24px | Yes | Pass |

**`px-2.5` (10px):** Off the 4px ladder, but this is the exact value used in FactsheetView.tsx period buttons (lines 818, 848, 858, 879) and is the same 10px that resolves `--space-grid-gap`. Treating as an inherited pattern rather than a novel violation — it achieves spacing parity with the factsheet button chrome.

**`gap-1.5` (6px):** Off the 4px ladder. However, `gap-1.5` appears 5+ times in factsheet components (`TimeSeriesChart.tsx:548`, `FactsheetView.tsx:491`, `FactsheetView.tsx:523`) and across `CardShell.tsx`, `Input.tsx`, `Breadcrumb.tsx` as a codebase-normalized convention for inline icon+label gaps. This is a systemic deviation in the codebase, not a Phase 38 introduction.

No new off-ladder spacing values were invented in Phase 38. Score reduced to 3/4 due to the two off-ladder values present, even though both have codebase precedent.

---

### Pillar 6: Experience Design (3/4)

**WARNING — `aria-selected` missing on `role="tab"` buttons inside `role="tablist"`.**

`ScenarioFactsheetChart.tsx:95–111`: The `PeriodControl` renders a `role="tablist"` container with four `role="tab"` buttons. ARIA authoring practices require tabs to carry `aria-selected="true"` or `aria-selected="false"`. The implementation has neither.

The factsheet's own `TimeSeriesChart.tsx:516` sets `aria-selected={scale === s}` on its scale-toggle tabs. The `ScenarioFactsheetChart` PeriodControl does not track the active period in state (by design — the spec says no sticky state to avoid xRange desync), so `aria-selected={false}` on every button unconditionally is the minimal compliant fix. Alternatively, the current window bounds could be read from `useXRange()` to derive which button best matches, but that adds complexity. `aria-selected={false}` unconditionally is the correct minimal path: it satisfies ARIA without implying sticky selection.

This will likely fail an axe-core run under `wcag2a` (`aria-required-attr`). The project has a zero-axe-violation CI gate (`tests/a11y/`).

**Positive — BTC toggle checkbox accessibility:** The `<input type="checkbox">` at `ScenarioComposer.tsx:2215` is wrapped inside a `<label>` element (line 2214), providing valid implicit label association. The text content "BTC Benchmark" is the accessible name. The `aria-hidden="true"` swatch span correctly removes the decorative hairline from the accessibility tree. No `id`/`htmlFor` needed because the input is a descendant of the label.

**Positive — PROJECTED pill:** `role="alert"` is correctly absent (per UI-SPEC: "NEVER `role='alert'`"). `aria-live="polite"` is used on the conditional "Illustrative shape only" disclosure (line 2235), which is appropriate — it announces when a scenario transitions to zero-AUM mode without interrupting screen-reader flow.

**Positive — persist={false}:** The `FactsheetProvider` is mounted with `persist={false}` (`ScenarioFactsheetChart.tsx:138`), preventing the composer's pan/zoom from writing to the URL or localStorage. No history pollution.

**Positive — Blank-slate honesty:** The `buildScenarioFactsheetPayload` adapter is non-degenerate when a scenario exists and the baseline is empty. The PARITY-03 blank-slate path renders the scenario overlay only, with no synthetic baseline, confirmed by mutation-falsifiable tests.

**Positive — Keyboard nav:** Inherited verbatim from `TimeSeriesChart` (arrows, +/-, Home/Esc). No new keyboard nav was introduced that could break these affordances. The chart SVGs carry `tabIndex=0`, `role="img"`, `aria-label`, `aria-describedby` from the factsheet engine.

---

## Registry Safety

Not applicable — project does not use shadcn or any third-party component registry. All charts are first-party (`TimeSeriesChart`, `MasterBrush`, `EquityChart`, `DrawdownChart`). Registry audit skipped per 38-UI-SPEC.md §Registry Safety.

---

## Files Audited

| File | Role |
|------|------|
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | New component — primary audit target |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (lines 1785–2241) | Composer chrome around the new component |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (line 127) | Outer width constraint (PARITY-02) |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (line 157) | Confirmed unchanged (1100px) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | Source-of-truth reference for period button style |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | Source-of-truth reference for aria-selected pattern |
| `DESIGN.md` | Token source of truth |
| `.planning/phases/38-composer-factsheet-parity-blank-mode-fix/38-UI-SPEC.md` | Design contract |
| `.planning/phases/38-composer-factsheet-parity-blank-mode-fix/38-03-SUMMARY.md` | What was built (Plan 03) |
| `.planning/phases/38-composer-factsheet-parity-blank-mode-fix/38-05-SUMMARY.md` | What was built (Plan 05) |
