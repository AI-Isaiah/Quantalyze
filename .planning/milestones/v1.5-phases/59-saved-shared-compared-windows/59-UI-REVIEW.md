---
phase: 59
slug: saved-shared-compared-windows
reviewed_at: 2026-07-02
baseline: 59-UI-SPEC.md (approved) + 58-UI-SPEC.md (inherited) + DESIGN.md
screenshots: not captured (no dev server at localhost:3000 or :5173) — code-only audit
---

# Phase 59 — UI Review

**Audited:** 2026-07-02
**Baseline:** 59-UI-SPEC.md (approved) — two new UI contracts only; everything else inherited from 58-UI-SPEC.md and DESIGN.md
**Screenshots:** not captured (no dev server detected) — code-only audit

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | All locked strings verbatim; correct em-dash/en-dash; suppression logic correct |
| 2. Visuals | 3/4 | Visual shell exact; `font-metric` bleeds Geist Mono onto day-count label text |
| 3. Color | 4/4 | Zero raw hex; accent used only on "Show full range"; label strictly `text-text-muted` |
| 4. Typography | 3/4 | Window label uses `text-xs` (12px) instead of spec-required `text-fixed-11` (11px) |
| 5. Spacing | 4/4 | All from 4px ladder; ProvenanceNote matches DefaultChangeNote shell exactly |
| 6. Experience Design | 4/4 | role="status"/aria-live="polite"/aria-label="Dismiss" all correct; focus rings; reduced-motion; key-remount for ephemeral reset |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **Window label size: `text-xs` (12px) instead of `text-fixed-11` (11px)** — ScenarioCompareTable.tsx:278 — The tfoot "Window" row header cell uses `text-fixed-11` (line 249) but the data cells use `text-xs`. Creates a 1px intra-row size inconsistency and makes the label slightly over-weighted versus the spec's tertiary-caption intent. Fix: replace `text-xs` with `text-fixed-11` on the outer `<span>` at line 278.

2. **`font-metric` overreach on day-count text** — ScenarioCompareTable.tsx:278 — The `font-metric` class on the outer `<span>` wrapping `{methodologyLine(c.metrics.n)}` applies Geist Mono + tabular-nums to the prose text "overlapping days" in addition to the date bounds. Spec says DM Sans for the label body (`text-fixed-11 text-text-muted`) and `font-mono tabular-nums` for the dates only. The date `<span>`s at lines 283 and 287 already carry explicit `font-mono tabular-nums`, so `font-metric` on the outer wrapper is both redundant and leaks Geist Mono onto non-numeric text. Fix: remove `font-metric` from the outer `<span>` at line 278; the inner date spans already handle the monospace requirement.

3. **`py-3` vs spec `py-2` — no issue (WARNING-clear)** — ProvenanceNote.tsx:49 uses `py-3` (12px vertical padding). The DefaultChangeNote shell at DefaultChangeNote.tsx:77 also uses `py-3`. The spec says the note reuses the DefaultChangeNote shell verbatim, so this is correct — the spec's `md` = 12px = `py-3` confirms it. Noting explicitly because the spec table lists `py-3` as 12px (`gap-3 internal spacing`) and some readers may conflate `py-3` with `py-2`. No action needed.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

**ProvenanceNote locked copy — PASS**

ProvenanceNote.tsx:52 renders:
```
This saved scenario predates coverage windows — showing the common period · Show full range
```
- Separator between "windows" and "showing": `—` (EM-DASH U+2014) — matches spec exactly.
- Separator between "common period" and "Show full range": `·` (MIDDLE-DOT U+00B7) — matches spec exactly.
- "Show full range" button text: verbatim.

**Per-column compare window label — PASS**

ScenarioCompareTable.tsx:280-291: renders `· {start}–{end}` where the separator is `–` (EN-DASH U+2013, confirmed at line 286 col 30 via character scan). Matches the BlendHeader en-dash convention from 58-UI-SPEC.

**Suppression logic — PASS**

- `undecodable` columns: render `OLDER_FORMAT_STAMP` ("Saved in an older format — can't be compared") with no date range (lines 261-265). Correct.
- `!verdict.ok` columns: render sample-floor copy (lines 293-299) with no date range. Correct.
- Date range label appears only when `verdict.ok` AND both bounds are non-null (lines 280-291). Correct.
- Neither bound null: conditional `c.metrics.effective_start && c.metrics.effective_end` guards the label (line 280) — degenerate cases gracefully degrade to day-count-only stamp. Correct.

**No copy authored beyond locked strings — PASS**

Under-selection empty state ("Select 2 or more scenarios (or the live book) to compare.", line 165) and the undecodable stamp are both pre-existing or spec-locked. No new strings were introduced.

---

### Pillar 2: Visuals (3/4)

**ProvenanceNote visual shell — PASS**

ProvenanceNote.tsx:49's className is byte-identical to DefaultChangeNote.tsx:77:
```
mt-6 flex items-start justify-between gap-3 rounded-md border border-border bg-surface-subtle px-4 py-3
```
Same `role="status"` informational-note treatment. No warning-tier styling (no `bg-warning-bg`, no `text-warning`). `×` is a text glyph per spec ("No icons"). ✓

**Hierarchy — PASS**

In ScenarioComposer.tsx:3029 the ProvenanceNote renders above DefaultChangeNote (line 3042) which renders above BlendHeader (line 3057). The note is correctly subordinate to the primary BlendHeader anchor. The compare table's window label is in `<tfoot>` — subordinate to metric cells.

**WARNING: `font-metric` bleeds Geist Mono onto label prose text**

ScenarioCompareTable.tsx:278 applies `font-metric` (= `font-family: var(--font-mono); font-variant-numeric: tabular-nums` per globals.css:323-326) to the outer `<span>`. This means `methodologyLine(c.metrics.n)` — which produces text like "252 overlapping days" — renders in Geist Mono. The spec intends DM Sans for the label body with Geist Mono reserved for the date bounds. The date spans at lines 283 and 287 already explicitly carry `font-mono tabular-nums`, so `font-metric` on the wrapper is redundant for the dates and incorrect for the surrounding prose. Visual impact is subtle (Geist Mono vs DM Sans at 12px in a `<tfoot>` caption), but it diverges from the spec's "DM Sans everywhere, Geist Mono for numbers" discipline from DESIGN.md.

---

### Pillar 3: Color (4/4)

**Token compliance — PASS**

Full scan of both files finds zero raw hex literals. All color references are DESIGN.md tokens:

| Element | Class | Token |
|---------|-------|-------|
| Note background | `bg-surface-subtle` | `#FBFCFD` |
| Note border | `border-border` | `#E2E8F0` |
| Note body text | `text-text-secondary` | `#4A5568` |
| "Show full range" action | `text-accent` → hover `text-accent-hover` | `#1B6B5A` → `#155A4B` |
| Dismiss `×` | `text-text-muted` → hover `text-text-primary` | `#64748B` → `#1A1A2E` |
| Focus ring | `ring-accent/50` | 50% alpha accent |
| Window label | `text-text-muted` | `#64748B` |

**Accent budget — PASS**

Accent used on exactly one new element in Phase 59: the "Show full range" inline text action — the only interactive affordance added. The per-column window label is `text-text-muted` only (never accent, never warning, never a winner color). The compare table's winner `✓` accent is pre-existing behavior.

**Color is never the sole signal — PASS**

Provenance note: literal sentence explains the provenance situation. Window label: literal date bounds `YYYY-MM-DD` carry the meaning. `×` has `aria-label="Dismiss"`. No color-only meaning at any site.

**60/30/10 discipline — PASS**

Phase 59 spends almost no color budget: one neutral surface note and one muted caption. The sole accent addition (the "Show full range" text-button) is a single inline action, comfortably within the 10% accent allocation.

---

### Pillar 4: Typography (3/4)

**ProvenanceNote typography — PASS**

| Element | Spec | Actual | Result |
|---------|------|--------|--------|
| Note body | `text-fixed-13 leading-relaxed text-text-secondary` | ProvenanceNote.tsx:51 exactly | ✓ |
| "Show full range" action | `font-medium text-accent` at 13px | ProvenanceNote.tsx:56 exactly (inherits `text-fixed-13` from parent `<p>`) | ✓ |
| `×` dismiss | `text-fixed-13 text-text-muted` | ProvenanceNote.tsx:65 exactly | ✓ |

Weight ladder: only 400 regular (body, `×`) and 500 medium ("Show full range"). No third weight introduced. ✓

**WARNING: Window label uses `text-xs` (12px) instead of `text-fixed-11` (11px)**

ScenarioCompareTable.tsx:278:
- Spec: `text-fixed-11 text-text-muted` (11px = 0.6875rem per globals.css:165)
- Actual: `text-xs font-metric text-text-muted` (`text-xs` = 0.75rem = 12px in Tailwind v4)

The tfoot row label cell (line 249) correctly uses `text-fixed-11 text-text-muted`. The data cells are 1px larger, creating an intra-row inconsistency and over-weighting the caption vs the spec's tertiary intent. This is a measurable deviation — `text-fixed-11` and `text-xs` map to different CSS values (0.6875rem vs 0.75rem).

**WARNING: `font-metric` on outer window label span**

ScenarioCompareTable.tsx:278: `font-metric` applies `font-family: var(--font-mono)` to the entire stamp span, including `methodologyLine(n)` text ("252 overlapping days"). Spec specifies `text-fixed-11 text-text-muted` (DM Sans implied) for the label body and `font-mono tabular-nums` for dates only. The inner `<span className="font-mono tabular-nums">` at lines 283 and 287 already cover the date requirement — `font-metric` on the outer span is both redundant and incorrect for the prose text.

---

### Pillar 5: Spacing (4/4)

**ProvenanceNote spacing — PASS**

All values from the DESIGN.md 4px ladder (2/4/8/12/16/24):

| Site | Class | Value | Spec |
|------|-------|-------|------|
| Top margin (above window control) | `mt-6` | 24px | lg = 24px ✓ |
| Internal gap (body ↔ dismiss) | `gap-3` | 12px | md = 12px ✓ |
| Horizontal padding | `px-4` | 16px | md+ = 16px ✓ |
| Vertical padding | `py-3` | 12px | md = 12px ✓ |
| `×` horizontal pad | `px-1` | 4px | xs = 4px ✓ |

**Per-column window label spacing — PASS**

Inherits existing `<td>` padding `px-4 py-2` (lines 258-259: the tfoot row already sets this). No new spacing site. The label text appends inline to `methodologyLine(n)` — no margin/gap added.

**No arbitrary values — PASS**

Neither file contains `[Npx]`, `[Nrem]`, or any non-ladder spacing value.

---

### Pillar 6: Experience Design (4/4)

**A11y live regions — PASS**

ProvenanceNote.tsx:46-47: `role="status"` + `aria-live="polite"` exactly per spec. Notably NOT `role="alert"` (which DESIGN.md reserves for blocking errors). ✓

**Accessible name on `×` — PASS**

ProvenanceNote.tsx:63: `aria-label="Dismiss"` present. The `×` text glyph alone is insufficient for screen readers (no semantic meaning as a button label); the explicit aria-label resolves this. ✓

**Focus states — PASS**

Both buttons carry `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` (ProvenanceNote.tsx:56, 65). Matches the DefaultChangeNote pattern and the existing composer button ring style. ✓

**Reduced-motion — PASS**

Both buttons carry `motion-reduce:transition-none` (ProvenanceNote.tsx:56, 65). ✓

**Ephemeral dismissal — PASS (KEY DIVERGENCE, CORRECTLY IMPLEMENTED)**

ProvenanceNote.tsx:40: `const [dismissed, setDismissed] = useState(false)` — component-local state only. Does NOT import or use `useCrossTabStorage`. Does NOT touch the `composer.coverageDefaultChangeNoteDismissed` localStorage key. This is the correct implementation per the spec's "KEY DIVERGENCE from POLISH-03" section: the provenance note is a per-scenario data-provenance signal, not a one-time global education artifact.

**`key` remount for per-scenario reset — PASS**

ScenarioComposer.tsx:3031: `key={loadedScenarioId ?? "provenance"}`. When a new saved draft is opened (`loadedScenarioId` changes), React remounts `ProvenanceNote` → fresh `useState(false)` → note re-shows for the new old draft. Correctly ensures each reopened v2 draft triggers its own provenance signal.

**Trigger specificity — PASS**

ScenarioComposer.tsx:1204: `setShowProvenanceNote(decoded.reason === "upgraded_v2_windowless")`. The note fires only on the exact codec reason string for a v2-windowless draft that was defaulted to intersection. It is NOT tied to the general `intersectionTruncatesUnion` condition that DefaultChangeNote uses. A v3 draft (window present) correctly never shows it (line 1201: `setShowProvenanceNote(false)` on fresh/new scenarios). ✓

**Label suppression on non-ok columns — PASS**

ScenarioCompareTable.tsx:260-291: suppression chain is:
1. `c.undecodable` → OLDER_FORMAT_STAMP (no window label)
2. `!verdict.ok` → sample-floor copy (no window label)
3. `verdict.ok` AND both bounds non-null → shows `· {start}–{end}`
4. `verdict.ok` but a bound is null → shows day-count stamp only (graceful degrade)

All four paths are correct per spec. ✓

**No new spurious tab stops — PASS**

The per-column window label is static `<span>` text inside a `<td>` — no interactive element, no `tabIndex`, no role change. The existing tfoot "Window" row is already in the table's reading order. ✓

---

## Registry Safety

Not applicable. `components.json` is absent; the project uses no shadcn or third-party registry blocks. No third-party dependencies added in Phase 59 per the spec's "zero new runtime dependencies" requirement.

---

## Files Audited

| File | Role |
|------|------|
| `src/app/(dashboard)/allocations/components/ProvenanceNote.tsx` | Contract 1 implementation (PERSIST-01) — primary audit target |
| `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` | Shell source — verified ProvenanceNote reuse fidelity |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | Contract 2 implementation (PERSIST-03) — primary audit target |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (lines 833, 1067, 1162–1204, 3020–3048) | ProvenanceNote wiring — trigger logic and render guard |
| `src/app/globals.css` (lines 163–173, 323–326) | `text-fixed-*` token values; `font-metric` class definition |
| `.planning/phases/59-saved-shared-compared-windows/59-UI-SPEC.md` | Design contract — primary reference |
| `.planning/phases/58-coverage-legibility-disclosure/58-UI-SPEC.md` | Inherited contract |
| `DESIGN.md` | Design system token source of truth |
