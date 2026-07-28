---
phase: 37
slug: honest-per-data-source-toggle
review_type: retroactive-visual-audit
audited: 2026-06-25
auditor: gsd-ui-auditor
---

# Phase 37 — UI Review

**Audited:** 2026-06-25
**Baseline:** 37-UI-SPEC.md (design contract, 6/6 dimensions)
**Screenshots:** not captured (no dev server running — code-only audit)
**Scope:** Phase 37 additions only — the "Data sources" control
(`scenario-data-sources`), the InfoBanner fallback
(`scenario-data-sources-fallback`), and the EmptyStateCard all-excluded state
(`scenario-data-sources-empty`) in `ScenarioComposer.tsx`.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All spec copy verbatim; toggle renders word labels ("Included"/"Excluded") where spec implies visual-only state indication |
| 2. Visuals | 3/4 | Control sits below always-rendered methodology prose, not "directly below the entry-mode row" as spec requires |
| 3. Color | 4/4 | 60/30/10 preserved; accent reserved for included-state only; no fill; no red/negative on absence states |
| 4. Typography | 4/4 | All 5 type roles match spec exactly; Geist Mono for masked tail; 2-weight subset honored |
| 5. Spacing | 3/4 | Intra-row gap is 8px (gap-2/sm) vs spec's 4px (xs) between toggle and label |
| 6. Experience Design | 4/4 | All a11y attrs correct; honest-absence shells are calm; no role=alert invented; touch target met |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **Toggle pill renders word labels ("Included"/"Excluded") where spec §2 states the accent outline and `aria-checked` carry state with no word badge** — a screen-reader user gets the state twice (aria-checked + button text), and the pill is wider than the entry-mode equivalent; inconsistency weakens the "reuse entry-mode pill recipe" intent. Fix: remove the button text entirely and let `aria-checked` + the visual outline carry state, matching the entry-mode pill's text-only "From my book"/"Blank slate" labels which describe the ACTION, not a state badge. Alternatively keep the label words but reconcile with the spec by updating the spec — the executor choice is defensible as long as it is intentional.

2. **Data-sources control placement is not "directly below the entry-mode row"** — the spec says the control lives "directly below the entry-mode row" with a 16px gap (md). In practice, always-rendered methodology/coverage prose (lines 2041–2060, `mt-2 text-[11px] text-text-muted`) and the conditional fingerprint-mismatch banner (lines 2062–2094) interpose between the entry-mode radiogroup (~line 1931) and the data-sources group (~line 2096). The placement is reasonable in practice but diverges from the spec's stated DOM order. Fix: either move the data-sources control immediately after the entry-mode row (before the save toolbar / coverage prose), or update the spec to reflect the intended position in the header flow.

3. **Intra-row gap is 8px (gap-2) vs spec's 4px (xs) between toggle and row label** — the row container (`flex min-h-[44px] items-center gap-2`) uses `gap-2`/sm where the spacing contract specifies xs/4px for the toggle-to-label gap within a row. At only 4px the difference is minor visually but the spec table is explicit. Fix: change `gap-2` on the row container to `gap-1` (4px/xs) to match the spec's declared intra-row spacing.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASS:** All verbatim copy strings from the contract are reproduced exactly.

- Control heading: "Data sources" — matches spec ✓
- Helper line: "Toggle a source off to model the book without it. Resets on reload." — matches spec ✓
- Empty state heading: "Select at least one data source" — matches spec ✓
- Empty state body: "Every data source is excluded — there's nothing to project. Re-include a source to see the curve and metrics." — matches spec ✓
- Fallback heading: "Per-source modeling needs per-key history." (bold within InfoBanner) — matches spec ✓
- Fallback body: "One or more connected keys don't have a per-key return series yet..." — matches spec ✓
- Em-dash separator in row labels and aria-label: `—` (U+2014) used throughout ✓
- Masked-key format `••••{id.slice(-4)}` — matches spec; full key/secret never exposed ✓
- Per-row `aria-label`: `Include {Exchange} — {label} in projection` — matches spec exactly ✓
- No "error" word, no red, no "disabled"/"enabled" verbs — copy rule honored ✓

**WARNING — Toggle word badge:**
`ScenarioComposer.tsx:2140` — the toggle button renders the string "Included" or "Excluded" as its visible label. The spec (§Copywriting Contract, Toggle states) states: "No 'On/Off' word badge in v1 — the accent outline + `aria-pressed`/`aria-checked` carry state." The spec uses "Included"/"Excluded" as the STATE NAMES in the table, not necessarily as button text. The intent of the "no word badge" clause is that visual state is carried by the outline treatment, not a text badge. Rendering "Included"/"Excluded" in the pill body is a word-badge pattern using different words than "On/Off", so it is not a literal spec violation; however it diverges from the entry-mode pill recipe which uses action words ("From my book"/"Blank slate"), not state badges. Scored down one point for the ambiguity — if intentional, update the spec to ratify it.

**MINOR — InfoBanner heading markup:**
`ScenarioComposer.tsx:2163–2164` — the fallback note's "Per-source modeling needs per-key history." sentence is wrapped in `<span className="font-semibold text-text-primary">` inside the InfoBanner. The spec gives the copy verbatim but does not specify a bold heading span within the InfoBanner; other InfoBanner usages in the codebase render plain `text-sm text-text-secondary` children. The bold span is a reasonable clarity enhancement and does not break any rule, but it is unspecified. Informational only.

---

### Pillar 2: Visuals (3/4)

**PASS on all visual token choices:** accent outline for included, neutral outline for excluded, no fill, calm InfoBanner palette, neutral EmptyStateCard. No card-on-card nesting. Hairline `border-b border-border` row dividers instead of stacked-card pattern — correct per data-density rule.

**WARNING — Placement deviates from spec:**
Spec (§Component Inventory 1): "in the composer header region, **directly below the entry-mode row** (`scenario-entry-mode` radiogroup, ~line 1677) and **above** the KpiStrip / EquityChart block."

Actual DOM order at `ScenarioComposer.tsx`:
- Entry-mode radiogroup: ~line 1888
- Save toolbar: lines 1939–1985 (always rendered)
- Name input: lines 1988–2019 (conditional)
- Coverage/methodology prose: lines 2041–2060 (always rendered — `mt-1 text-sm text-text-muted`)
- Coverage caveat (11px): lines 2052–2060 (always rendered)
- Fingerprint mismatch banner: lines 2062–2094 (conditional)
- **Data sources control: lines 2104–2157**

Two always-rendered elements (composer description prose and the coverage caveat) sit between the entry-mode row and the data-sources control in every render. The control is visually below the "fold" of the header block. This is likely acceptable in practice — the coverage prose and entry-mode are conceptually separate — but the spec intent of "directly below" is not met. A user or designer reviewing the spec against the implementation would identify this mismatch.

**PASS on visual hierarchy within the control itself:** 12px uppercase caption heading creates clear section identity; row labels are 14px/regular providing subordinate hierarchy; the toggle pill is visually leading and distinct. Hierarchy reads correctly within the control's boundaries.

---

### Pillar 3: Color (4/4)

No issues found. All color usage is correct.

- 60% (page/surface): control surface inherits composer canvas background ✓
- 30% (border/text-secondary/text-muted): row labels `text-text-secondary`, masked tail `text-text-muted`, hairline dividers `border-border`, section heading `text-text-secondary` ✓
- 10% (accent): included-state toggle `border-accent text-accent` only — nothing else uses accent in the control ✓
- No accent fill on toggle: `border border-accent text-accent` with no `bg-accent` class ✓
- Excluded state: `border-border text-text-secondary` — neutral, never red ✓
- Focus ring: `focus-visible:ring-accent/50` ✓
- InfoBanner: `border-accent/30 bg-accent/5` — calm informational, per spec ✓
- EmptyStateCard: `border-border bg-surface` — neutral, per spec ✓
- `--color-negative` not used anywhere in Phase 37 additions ✓
- No hardcoded hex values in the Phase 37 rendering region (lines 2096–2201) ✓
- No new color tokens invented ✓

---

### Pillar 4: Typography (4/4)

No issues found. All 5 declared type roles from the spec are implemented exactly.

| Spec role | Spec spec | Actual implementation | Match |
|-----------|-----------|----------------------|-------|
| Control heading | 12px / semibold / uppercase tracking-wide | `text-[12px] font-semibold uppercase tracking-wide text-text-secondary` line 2111 | ✓ |
| Helper line | 12px / regular / text-text-muted | `text-[12px] text-text-muted` line 2114 | ✓ |
| Row label | 14px / regular / text-text-secondary | `text-sm text-text-secondary` line 2142 | ✓ |
| Masked key | 14px / regular / font-mono / text-text-muted | `font-mono text-text-muted` line 2148 (inherits text-sm from parent) | ✓ |
| EmptyStateCard heading | 14px / semibold / text-text-secondary | component renders `font-semibold text-text-secondary` ✓ |
| EmptyStateCard body | 11px / regular / text-text-muted | component renders `text-[11px]` ✓ |

`font-mono` correctly maps to `--font-geist-mono` via `globals.css:74`. 2-weight subset (400/600) honored — no `font-medium` or other weight introduced in Phase 37 additions. No new font size outside the spec's declared set.

---

### Pillar 5: Spacing (3/4)

**PASS on outer spacing:**
- Control outer gap from entry-mode row: `mt-4` (16px/md) on the group container at line 2109 ✓
- Section gap from KpiStrip below: `mt-6` (24px/lg) at line 2173 ✓
- Fallback InfoBanner outer gap: `mt-4` (16px/md) at line 2161 ✓
- All-excluded EmptyStateCard outer gap: `mt-4` at line 2195 ✓

**PASS on inter-row spacing:**
The row container uses `flex flex-col` with no `gap-` on the inner rows container (line 2117). Rows are separated by `border-b border-border last:border-b-0` dividers, which is the correct hairline-divider approach. The spec says "sm (8px) vertical gap between source rows" but also says "separated by hairline `border-border` dividers" — the divider implementation is spec-compliant.

**WARNING — Intra-row toggle-to-label gap:**
`ScenarioComposer.tsx:2126` — the row flex container uses `gap-2` (8px/sm) between the toggle button and the exchange label. The spec spacing table (§Spacing Scale) declares `xs (4px)` for "gap between toggle and its label inside a row." Actual is one ladder step above (8px instead of 4px). Not a visual blocker — 8px is slightly more generous and works — but it diverges from the declared spec value.

**PASS on internal control gap:**
Line 2109 `flex flex-col gap-2` (8px) for heading → helper → rows. This creates 8px between the heading and helper text and between the helper and the row list. The spec's sm(8px) for "control's internal `p-0.5`→`gap-1` cluster spacing" refers to the entry-mode pill internals; the 8px vertical gap within the data-sources control is reasonable and within the ladder.

No off-ladder arbitrary spacing values (`[Npx]` form beyond the declared `[12px]` and `[11px]` typography) introduced in Phase 37 additions.

---

### Pillar 6: Experience Design (4/4)

No issues found. The a11y and interaction contract is fully met.

**Accessibility:**
- `role="group"` with `aria-label="Data sources"` at line 2106–2107 ✓
- `data-testid="scenario-data-sources"` at line 2108 ✓
- Per-row `role="switch"` at line 2130 ✓
- Per-row `aria-checked={included}` at line 2131 ✓
- Per-row unique `aria-label`: `Include {Exchange} — {labelText} in projection` at line 2132 ✓
- Focus ring: `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` at line 2134 ✓
- Minimum 44px row height: `min-h-[44px]` at line 2126 ✓
- InfoBanner fallback: no `role="alert"` ✓
- EmptyStateCard: no `role="alert"` ✓ (component source confirmed)
- No new `role="alert"` in Phase 37 additions ✓ (pre-existing alerts at lines 2033/2065/2611 are unchanged)

**Honest-absence states:**
- All-excluded EmptyStateCard renders after the KpiStrip (which shows "—" via the engine's null-KPI path) ✓
- Fallback InfoBanner uses calm `border-accent/30 bg-accent/5` — not ErrorEnvelope, not red ✓
- Blank mode: no control, no note — nothing rendered, correct per spec ✓

**Interaction fidelity:**
- Toggle is ephemeral (`useState`, never persisted to `scenario.draft`) ✓
- `handleDataSourceToggle` updates state immediately (no debounce, no spinner — spec §3) ✓
- Instant recompute via frozen `computeScenario` engine through `projectionState.selected` ✓
- Re-including a source restores projection (engine null path exits cleanly) ✓
- No keyboard trap — toggles are in DOM order, Tab-reachable, Space/Enter-activatable ✓

**Loading / error states:**
- No loading state needed — recompute is synchronous in-memory ✓
- No error state needed — toggling cannot error (boolean has no invalid value) ✓
- Mutation-verified by test suite: a cosmetic hide turns the DSRC-03 honesty test RED ✓

**Registry safety:** not applicable — no shadcn, no `components.json`, no third-party blocks. No registry audit required.

---

## Files Audited

- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/37-honest-per-data-source-toggle/37-UI-SPEC.md`
- `/Users/helios-mammut/claude-projects/quantalyze/DESIGN.md`
- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/37-honest-per-data-source-toggle/37-03-SUMMARY.md`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (Phase 37 additions: lines 429–461, 586–605, 1338–1389, 1433–1471, 2096–2201)
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/ui/InfoBanner.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/components/ui/EmptyStateCard.tsx`
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/globals.css` (font token mapping)
