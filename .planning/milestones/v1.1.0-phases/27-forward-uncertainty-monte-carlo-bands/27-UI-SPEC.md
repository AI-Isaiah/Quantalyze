---
phase: 27
slug: forward-uncertainty-monte-carlo-bands
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-22
---

# Phase 27 — UI Design Contract: Forward Uncertainty (Monte-Carlo Bands)

> Visual and interaction contract for the new **"Forward uncertainty"** section mounted in the own-book `ScenarioComposer` after `StressVarSection`. Authored in autonomous smart-discuss mode from the Phase-26 UI-SPEC template + DESIGN.md; self-checked against DESIGN.md (no clients yet, decisions taken autonomously).
>
> **This is a heavy-reuse, conformance-only contract — NOT net-new visual design.** The section copies the visual language of the already-shipped `StressVarSection.tsx` / `ScenarioBenchmarkSection.tsx` (heading + methodology caption + `EmptyStateCard` + `SampleFloorEmptyState`) and the `EquityChart` SVG token set (chart-strategy stroke `#1B6B5A`, muted axis). The ONE net-new visual element is a **shaded confidence band** (a low-opacity solid fill between quantile bounds + a median line) — a *data* element, not decoration. DESIGN.md owns every token; this file does NOT re-declare tokens — it pins which existing tokens the band chart uses and the states/copy it must render. No new visual language beyond the band fill; ≤ 4 font sizes; ≤ 2 weights; no gradient (solid low-opacity fill only).

---

## Section Focal Point (declared)

The section's single focal point is the **forward confidence-band chart (the fan)** — the projected median path with the p5–p95 (and inner p25–p75) interval widening into the horizon. The chart's stroke uses the established `--color-chart-strategy` (`#1B6B5A`) for the median line; the band is the SAME hue at low opacity (outer ~0.12, inner ~0.20) — the only "fill" in the section and the visual carrier of *uncertainty*, which is the whole point of the phase. The accent is NOT used to paint any number; every numeric value (terminal median / interval bounds) is neutral Geist Mono data (`text-text-secondary`). A wide band is honest data, never an error — `#DC2626` is NOT used anywhere in this section.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (custom design system — DESIGN.md is the SoT; no shadcn) |
| Preset | not applicable |
| Component library | none (hand-rolled primitives in `src/components/ui/`) |
| Icon library | none used in this section (DESIGN.md "no decorative elements"; identity carried by border + text + the band fill) |
| Font | DM Sans (labels/body), Geist Mono `tabular-nums` (all numbers, via `.font-metric`) |
| Charting | dedicated lightweight SVG band chart (`MonteCarloBandChart`) — NOT a Recharts mount and NOT an edit to the 1500-line `EquityChart`; mirrors EquityChart's stroke/axis tokens so it reads as the same chart family |

**Reused components (do NOT re-style — import and mirror verbatim):**

| Component | Path | Role in this section |
|-----------|------|---------------------|
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | scenario-side absence + worker-error honest states (neutral muted card, no role=alert) |
| `SampleFloorEmptyState` | `src/components/scenarios/SampleFloorEmptyState.tsx` | below-floor / no-usable-n / few-strategies state; pass `feature="Monte-Carlo"` + `strategyCount` |
| `Skeleton` | `src/components/ui/Skeleton.tsx` | the **computing…** state while the Web Worker runs (no spinner — DESIGN.md has no spinner primitive; the skeleton is the established loading affordance) |
| `methodologyLine(n)` | `src/lib/scenario-history.ts` | mandatory disclosure caption base |
| `formatPercent` / `formatNumber` | `src/lib/utils.ts` | every value flows through these → null/non-finite renders "—" |
| `evaluateSampleFloor` | `src/lib/sample-floor.ts` | floor gate (floor = `SAMPLE_FLOOR_OVERLAPPING_DAYS` = 60); never a second primitive |

**Affordance decision (locked, autonomous):** the section ships with **fixed sensible defaults** (horizon 252d, 1000 paths, auto block length) and **no user control** in v1 — the band IS the output, there is no submit/interaction. A horizon/path-count `SegmentedControl` is planner discretion (deferred per CONTEXT §Area 1) and, if added, must reuse the existing `SegmentedControl` token contract exactly as Phase 26's shock control did.

---

## Spacing Scale

DESIGN.md 4px ladder. This section uses only:

| Token | Value | Usage |
|-------|-------|-------|
| sm | 8px | `mt-2` methodology caption below the chart |
| md | 12px | `mt-3` between heading and chart |
| md | 16px | `px-4` `EmptyStateCard` / chart card padding |
| lg | 24px | Section gap from `StressVarSection` above (DESIGN.md "24-32px between content sections") |

Caption tier uses the `text-[11px]` size already shipped in the sibling sections (the live token of the section above it — not a new value), per the Phase-26 SCOPED arbitrary-pixel exception.

---

## Typography

Conforms to the strategy-family **4-size / 2-weight** contract. Exactly 4 sizes, exactly 2 weights (400 regular, 600 semibold).

| Role | Size | Weight | Font | Token (verbatim) |
|------|------|--------|------|------------------|
| Section heading (H3) | 16px | 600 semibold | DM Sans | `text-base font-semibold text-text-primary` |
| Terminal median + interval-bound values | 12px | 600 (headline) / 400 (bounds) | Geist Mono `tabular-nums` | `text-xs font-metric` |
| Metric / axis labels | 12px | 400 regular | DM Sans / Geist Mono ticks | `text-xs text-text-muted` / `CHART_TICK_STYLE` |
| Methodology + empty-state body caption | 11px | 400 regular | DM Sans | `text-[11px] text-text-muted` |

Chart axis ticks reuse `CHART_TICK_STYLE` (12px Geist Mono `#64748B` on white = 4.85:1, AA-pass) exactly as EquityChart does. No 5th size, no `font-medium` (500).

---

## Color

DESIGN.md 60 / 30 / 10. Zero new named colors (the band fill is the existing `--color-chart-strategy` at reduced opacity).

| Role | Value | Usage in this section |
|------|-------|----------------------|
| Dominant (60%) | `#F8F9FA` page / `#FFFFFF` surface | section + chart card background |
| Secondary (30%) | `#E2E8F0` border / `#64748B` text-muted / `#4A5568` text-secondary | hairline dividers, axis, labels, numeric values |
| Accent (10%) | `#1B6B5A` (`--color-chart-strategy`) | median line stroke + the band fill (same hue, ~0.12 outer / ~0.20 inner opacity) — the section's single use of the chart hue |
| Destructive | `#DC2626` | **NOT used.** A wide / downside band is honest data, not an error. |

**Accent allowlist for this section (explicit):**
1. The **median path** stroke (`var(--color-chart-strategy)`).
2. The **confidence-band fill** (same hue, low opacity) — outer p5–p95 lighter, inner p25–p75 slightly stronger.
3. The keyboard **focus ring** on any control if a horizon/path control is added (planner discretion).

The accent is NOT used to color any number, heading, or the methodology caption. The band fill is a **solid low-opacity fill, NOT a gradient** (DESIGN.md "no gradients" — the EquityChart gradient is its own blessed exception; this section stays solid-opacity to stay strictly within the rule).

**Number discipline (load-bearing):** terminal median + interval bounds render as neutral Geist Mono numbers (`text-text-secondary`); a negative bound carries meaning by sign + percent format, never by color. Numbers are monochrome data here (the Phase-26 loss-color discipline carried forward).

---

## States (the contract the executor/red-team verify)

The section runs an async Web Worker, so it has a **computing** state the Phase-26 sections did not. It renders exactly one of:

| # | Condition (checked in this order) | Render | Copy source |
|---|-----------------------------------|--------|-------------|
| 1 | `portfolioDaily.length === 0` (scenario produced no returns — degenerate active set) | `EmptyStateCard` | scenario-side heading + body |
| 2 | `evaluateSampleFloor(n, 60)` is not `ok` (no-usable-n FIRST, then below-floor) | `SampleFloorEmptyState feature="Monte-Carlo" strategyCount={…}` | `@/lib/sample-floor` builders (never re-authored) |
| 3 | worker running (sim in flight) | `Skeleton` block sized to the chart + a "Simulating forward paths…" caption | below |
| 4 | worker errored / posted no usable bands | `EmptyStateCard` | worker-error heading + body |
| 5 | ok | `MonteCarloBandChart` (median + p5–p95 / p25–p75 band) + terminal-interval summary + mandatory disclosure line | below |

**Guard order is non-negotiable:** the synchronous, cheap gates (scenario-side absence → floor) run BEFORE the worker is spawned — never compute (or show "computing…" for) bands we already know we won't render. Only after both gates pass do we spawn the worker and enter the computing state. The empty-state **heading must match its body** (#509): a degenerate scenario is never blamed on a worker error, and vice-versa.

**Degenerate → empty state, never fabricated bands and never a 0.** Terminal-summary values flow through `formatPercent`; a null bound renders "—". Never fabricate a `0%` band.

**Worker lifecycle (load-bearing, owned by this section):**
- Spawn the worker only after gates 1–2 pass; show state 3 while in flight.
- **Debounce** recompute on draft changes (the inputs `portfolioDaily` / `n` change as the allocator scrubs weights) so a rapid edit doesn't spawn a worker per keystroke; cancel/ignore a superseded worker's late result (guard against a stale post overwriting a newer run).
- **Terminate** the worker on unmount and on input change before re-spawning — no leaked worker.
- A `worker.onerror` or a malformed/empty message → state 4 (honest empty state), never a thrown section and never a fabricated band.

**Mandatory inline disclosure line (state 5 — never a bare band):**
`Block bootstrap of realized daily returns · {paths} paths · block {L}d · {N} overlapping days · not a Normal model · not a forecast.`
Built on `methodologyLine(n)` extended with the path count + block length + the no-Normal-model framing. Rendered once, `text-[11px] text-text-muted`, immediately below the chart. The N is the floor-gated overlap N actually used, not a union window.

**Honest-to-N copy:** when `n` is just above the floor (a short common history), render an additional `text-[11px] text-text-muted` note that the wide interval reflects limited history (the bands widen naturally; the copy makes the cause explicit rather than letting a user read a wide fan as model noise).

**Visual layout (ok state):**
- `<h3 className="text-base font-semibold text-text-primary">` — heading naming the horizon + window (e.g. "Forward uncertainty over the next {horizon} trading days").
- `MonteCarloBandChart` (full-width within the card): x = forward trading days, y = cumulative return (or wealth) form consistent with the projection; shaded p5–p95 (outer) + p25–p75 (inner) band + median line; axis ticks via `CHART_TICK_STYLE`; `accessibilityLayer`-equivalent opt-out (no empty focus stop — the chart data is also surfaced in the terminal summary).
- Terminal-interval summary: a short `MetricRow`-shaped line — median terminal return + the p5–p95 interval — all Geist Mono, em-dash on null.
- Disclosure caption `<p className="mt-2 text-[11px] text-text-muted">`.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Section heading (ok) | `Forward uncertainty over the next {horizon} trading days` |
| Terminal summary | `Median terminal return {x} · 5–95% interval {lo} to {hi}` |
| Disclosure line | `Block bootstrap of realized daily returns · {paths} paths · block {L}d · {N} overlapping days · not a Normal model · not a forecast.` |
| Honest-to-N note (short history) | `This interval is wide because the strategies share only {N} overlapping days — more common history would tighten it.` |
| Computing caption (state 3) | `Simulating forward paths…` |
| Empty heading (scenario-side, state 1) | `Forward uncertainty unavailable` |
| Empty body (scenario-side, state 1) | `This scenario has no projected return history yet, so there's nothing to simulate. Add strategies with enough history to the scenario first.` |
| Empty heading (worker error, state 4) | `Couldn't run the simulation` |
| Empty body (worker error, state 4) | `The forward simulation didn't complete. Try adjusting the scenario or reloading.` |
| Below-floor state (state 2) | Heading + body from `@/lib/sample-floor` (`SAMPLE_FLOOR_HEADING` + `sampleFloorBody`); pass `feature="Monte-Carlo"` + `strategyCount`. **Never re-author this copy.** |
| Primary CTA | None. The band IS the output; there is no submit. No destructive action exists in this section. |

**Heading-matches-body rule (#509):** state-1 heading/body must both be about the scenario having no returns; state-4 heading/body must both be about the simulation failing. Do not blend them.

**Destructive actions:** none in this phase section.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| n/a (no shadcn / no external registry) | none | not applicable — all components hand-rolled in-repo; no third-party block enters this section |

No third-party registry is declared for Phase 27.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS (self-checked — all 5 states have heading-matches-body copy; disclosure never a bare band)
- [x] Dimension 2 Visuals: PASS (band fill is the only net-new element; solid low-opacity, not gradient; mirrors EquityChart tokens)
- [x] Dimension 3 Color: PASS (zero new named colors; accent allowlist explicit; no destructive color; numbers monochrome)
- [x] Dimension 4 Typography: PASS (4-size / 2-weight; CHART_TICK_STYLE reused)
- [x] Dimension 5 Spacing: PASS (4px ladder; 24px section gap; caption tier matches sibling)
- [x] Dimension 6 Registry Safety: PASS (no registry)

**Approval:** self-approved (autonomous mode)
