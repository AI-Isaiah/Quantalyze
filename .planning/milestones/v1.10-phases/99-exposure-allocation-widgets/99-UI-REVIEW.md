# Phase 99 — UI Review

**Audited:** 2026-07-12
**Baseline:** `99-UI-SPEC.md` (approved design contract) + `DESIGN.md` (token source of truth)
**Screenshots:** not captured (retroactive code-only audit; no dev server; recharts SVG is runtime-only, so gap-band geometry assessed from code + shared-lib math, not pixels)
**Scope:** `ExposureByClass.tsx`, `NetExposureChart.tsx`, `AllocationOverTime.tsx`, `lib/chart-gaps.tsx`, `HoldingsTabPanel` Exposure wiring (`be215b15..HEAD`)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every verbatim string in the contract (3 empty states, gap label, `<title>`, net-direction caption, absent-class `· —`, `as of {date}`) matches byte-for-byte; read errors correctly NOT rendered as empty copy. |
| 2. Visuals | 4/4 | Single-class book renders one full-width segment + labeled absent-class legend (no misleading full circle); KPI strip + legend-always-both + role="img". One demo-surface flag: `STRATEGY_PALETTE` contains #DC2626/#059669. |
| 3. Color | 4/4 | Accent reserved to spot/net/gross only; NO red/green on long/short direction (test-pinned); sanctioned navy #0F172A + `STRATEGY_PALETTE`; hatch texture byte-identical to factsheet. |
| 4. Typography | 4/4 | Named tiers only, 2 weights (400/600), `font-metric` on all numbers, zero raw `text-[Npx]` in the new files, chart-tick contract via `CHART_TICK_STYLE`. |
| 5. Spacing | 3/4 | Ladder-conformant, but a redundant `grid gap-4` (section) + `mt-3` (inner grid) stacks 28px where the spec intends 12px between the "Exposure" heading and the widget grid. |
| 6. Experience Design | 4/4 | Honest gap/zero/empty handling is airtight: real zero days are non-null rows, gaps are null sentinels + hatched `ReferenceArea`; F-2 boundary domain; `accessibilityLayer={false}`; real `<table>`. |

**Overall: 23/24**

**Verdict: PASS** (1 WARNING — spacing redundancy; design-review band-adaptation flag → **APPROVE**)

---

## Design-Review Flag: Proportional Hatched Gap-Band Adaptation — CALL: ACCEPTABLE (APPROVE)

The one documented deviation from the factsheet gap convention is an **honest equivalent, not a concern.** Ship it.

Evidence:
- **Texture/color/opacity byte-match confirmed.** The widget `<pattern>` (`chart-gaps.tsx:141-149`) is character-identical to the factsheet seam (`TimeSeriesChart.tsx:302-312`): `patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"` with `<line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-muted)" strokeOpacity="0.15" strokeWidth="3" />`. Not "similar" — identical.
- **Label copy byte-match confirmed.** Widget `{band.days}d — no data` (`chart-gaps.tsx:125`) vs factsheet `{g.days}d — no data` (`TimeSeriesChart.tsx:321`), same em-dash; `<title>` `No data {start} → {end} ({days} days)` identical on both.
- **Only geometry adapts, and the adaptation is the MORE honest choice.** The factsheet x-axis is index-based (gap days absent from the axis → zero-width seam is the truthful width there). These widgets use a calendar-linear epoch-ms axis where a gap has *true temporal duration*; a proportional band is the faithful projection of "how much time is missing." Forcing a zero-width seam on a linear axis — or an index axis here — would compress a 90-day outage to the width of a 1-day hole, which understates missing coverage: the opposite of the honesty invariant. The rejection rationale in `chart-gaps.tsx:9-25` is sound.
- **Cross-surface semantic consistency holds.** An allocator who sees both the public factsheet and this dashboard reads the same hatch = "no data." The convention's *language* is preserved; only its projection onto a different axis model changes. That is exactly the bar for an acceptable adaptation.

No change requested. Keep the deviation explicitly documented in the file header (it already is) so a future design-review re-derives the reasoning rather than "fixing" the band back to a seam.

---

## Top 3 Priority Fixes

1. **WARNING — Redundant heading→grid spacing (28px vs spec 12px)** — `HoldingsTabPanel.tsx:151-155`. The `<section>` is `grid gap-4` (16px between the `<h3>` and the widget `<div>`) AND the inner `<div>` also carries `mt-3` (12px), so grid-gap + margin stack to 28px. The spec anatomy (`99-UI-SPEC.md:88-95`) intends a single `mt-3` (12px) under a gap-less section. Impact: cosmetic vertical drift only, not dishonest. Fix: drop `mt-3` from the inner `<div>` (let `gap-4` own the 16px) OR change the section to a non-grid wrapper and keep `mt-3`. Pick one; don't keep both.
2. **NOTE — Section gap is 32px, not the spec's stated 24px** — the Exposure `<section>` sits inside the pre-existing `grid gap-8` panel wrapper (`HoldingsTabPanel.tsx:144`), so above/below the section is 32px, whereas `99-UI-SPEC.md:348` names 24px (space-6). 32px is within DESIGN.md's "24-32px between content sections" range and is the *existing* HoldingsTabPanel idiom (Rule 11 conformance), so this is informational — no change needed, but the spec's 24px line is not literally met.
3. **FLAG (demo-surface, low severity) — `STRATEGY_PALETTE` can paint a venue band in semantic red/green** — `AllocationOverTime.tsx:174` assigns `STRATEGY_PALETTE[i]`, which includes #DC2626 (the product's negative/loss red) and #059669 (a positive-adjacent green). On a book with ≥5 venues a band could render red and, on the demo-hero surface, momentarily read as "loss" to an institutional allocator despite being a pure venue identity. The task explicitly sanctions `STRATEGY_PALETTE` on venues (categorical), and legend labels + position disambiguate (WCAG 1.4.1 satisfied), so this is not a block — but worth a design-review eye if a live demo book happens to surface a red venue band beside the P&L-colored tables directly below it.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
- Empty-state copy verbatim across all three widgets: PI-01 `ExposureByClass.tsx:52-55`, PI-02 `NetExposureChart.tsx:107-110`, PI-03 `AllocationOverTime.tsx:123-126` — each matches `99-UI-SPEC.md:399-401` word-for-word including the W4 stale-cap second line.
- Titles verbatim: "Exposure by asset class" / "Net exposure over time" / "Allocation over time"; section heading "Exposure" (`HoldingsTabPanel.tsx:153`).
- Net-direction caption `net long`/`net short`/`flat` (`ExposureByClass.tsx:66`), absent-class legend `· —` (`ExposureByClass.tsx:117-118`), gap label + `<title>` (`chart-gaps.tsx:113,125`), `as of {YYYY-MM-DD}` stamps (`ExposureByClass.tsx:77`, `NetExposureChart.tsx:123`, `AllocationOverTime.tsx:139`) — all match the copy contract.
- **Errors-are-not-empty invariant honored:** no widget catches; each renders only the data handed to it. Read errors propagate to `allocations/error.tsx` (contract in file headers, `exposure-props.ts:8-16`). Correct.

### Pillar 2: Visuals (4/4)
- **Single-class honesty (PI-01, the headline hazard):** `present = CLASS_ORDER.filter(classGross>0)` (`ExposureByClass.tsx:71`) renders one full-width segment — no radial geometry, no misleading full circle. The absent class stays in the legend as muted `· —` (`:114-133`), so "100% spot" reads as a declared fact. Exactly the D-P1 requirement.
- Hedged-book surfacing: LONG = Σ positive signed, SHORT = Σ|negative| derived from slices (`ExposureByClass.tsx:64-65`) — D-P2 long 300 / short 100 → net 200 / gross 400 is visible, no invented data.
- Clear hierarchy: KPI strip (text-h3) → composition bar → legend → dense drilldown, top-to-bottom per spec anatomy.
- Bar container `role="img"` + descriptive `aria-label` (`:98-99`) — the role-less-div-ignored-by-AT precedent honored.
- Flag (see Priority #3): venue-band palette can include semantic reds/greens on the demo surface.

### Pillar 3: Color (4/4)
- Accent #1B6B5A reserved to spot segment, gross Area (0.2), net Line — nothing else (`ExposureByClass.tsx:40`, `NetExposureChart.tsx:151,159`).
- **No red/green on direction — verified and test-pinned:** `ExposureByClass.test.tsx:177-178` asserts the rendered HTML contains neither `#15803D` nor `#DC2626`; Side/Net cells use `text-text-secondary`/`text-text-primary` (`ExposureByClass.tsx:174-176`), net caption is `text-text-muted`. Semantic P&L colors stay reserved.
- Sanctioned categoricals only: derivative navy #0F172A (`ExposureByClass.tsx:27`, the DESIGN.md sidebar neutral, non-semantic, local const to avoid polluting the frozen `chart-tokens.ts`) and `STRATEGY_PALETTE` for venues (`utils.ts:118-121`, "design system approved, no purples").
- Track rail `bg-track` #F1F5F9, white seams (`border-white` / `stroke="#FFFFFF"`) per spec.
- Hatch uses `var(--color-text-muted)` @ 0.15 — byte-matched to the factsheet.

### Pillar 4: Typography (4/4)
- Named tiers only: `text-h3` KPI values, `text-micro uppercase tracking-wider` KPI labels, `text-small font-semibold` titles, `text-caption` stamps/legend, `text-sm font-semibold uppercase tracking-wider` section heading (matches the HoldingsTabPanel:141 idiom the spec cites verbatim).
- Exactly two weights (400/600); sub-labels differentiate via `uppercase tracking-wider`, not a third weight (v2 type-contract precedent).
- `font-metric` (Geist Mono tabular-nums) on every number — KPI values, table numerics, as-of stamps.
- **Zero raw `text-[Npx]` in the four new files** (grep confirmed; the raw-px hits in the tree are all pre-existing out-of-scope widgets). The in-SVG gap label uses numeric `fontSize={10}` — an SVG prop, not a class, lint-clean under `no-raw-font-px` per the chart idiom.

### Pillar 5: Spacing (3/4)
- Ladder-conformant tokens throughout: `gap-4`/`mt-4` (16px), `mt-2`/`gap-2` (8px), `gap-1` (4px), `max-h-64` scroll past 12 rows.
- **Deduction:** the redundant `grid gap-4` + `mt-3` double-spacing at `HoldingsTabPanel.tsx:151,155` (28px vs the spec's 12px intent) — Priority Fix #1.
- Informational: outer section gap is `gap-8` (32px) vs the spec's stated 24px — within DESIGN.md range and the pre-existing idiom (Priority Fix #2). No token is off-ladder; nothing dishonest.

### Pillar 6: Experience Design (4/4)
- **Gap honesty (the demo-critical invariant):** one all-null sentinel per gap at the band midpoint + `connectNulls={false}` on every Area/Line (`NetExposureChart.tsx:154,163`, `AllocationOverTime.tsx:178`) → recharts visibly breaks the path; a gap can never masquerade as a bridged/zero-filled flat line. Marked by a hatched `ReferenceArea` (`chart-gaps.tsx:151-160`). Verified distinct from data.
- **Genuine-zero vs marked-gap are visually distinct (PI-02 vs PI-03 task check):** observed `{net:0,gross:0}` days pass through as REAL non-null 0 rows (`NetExposureChart.tsx:56-60`) — a continuous line touching the zero reference line, no hatch; a gap is a null sentinel + hatched band with a broken path. The two can never be confused by construction. `buildNetChartData`'s comment and math confirm the honest-zero contract.
- **F-2 boundary gap:** `gapXDomain` spans `min(points ∪ band.x1) … max(points ∪ band.x2)` (`chart-gaps.tsx:88-92`) so a leading/trailing zero-gross gap band renders at the edge instead of clipping — the whole point of F-2.
- Accessibility: `accessibilityLayer={false}` on both recharts charts (`NetExposureChart.tsx:137`, `AllocationOverTime.tsx:163`) per the 2026-04-30 codebase decision (test-pinned globally); `role="img"` + aria-label on all three chart/bar wrappers; drilldown is a real `<table>` with a caption-tier header row; `TouchTooltip` gives touch parity; per-widget `useId` pattern ids (`:`-stripped) prevent `<defs>` collisions across instances.
- Tap targets: no interactive controls in these widgets beyond the scroll region + tooltip hover; the "drilldown" is a static dense table (the spec never required row links), so no tap-target risk.

---

## Trust-boundary note (positive)
`ExposureByClass` imports the data-contract types TYPE-ONLY (`import type`, `ExposureByClass.tsx:3`) and no widget imports a Supabase client or queries `allocator_holdings` — the T-99-01 client/server split holds, keeping the server client out of the client bundle. Verification intent #6 is satisfied in the source.

## Files Audited
- `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx`
- `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx`
- `src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx`
- `src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx`
- `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` (Exposure section wiring)
- `src/app/(dashboard)/allocations/lib/exposure-props.ts`
- Cross-referenced: `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (byte-match), `src/lib/utils.ts` (STRATEGY_PALETTE, formatCurrency), `src/components/charts/chart-tokens.ts`, `DESIGN.md`, `99-UI-SPEC.md`

## Registry Safety
shadcn not initialized (`shadcn_initialized: false`, no `components.json`); UI-SPEC declares no third-party registries. Registry audit skipped — not applicable.
