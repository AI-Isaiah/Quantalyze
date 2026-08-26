# Phase 41 — UI Review: Constituent Correlation & Diversification

**Audited:** 2026-06-26
**Baseline:** 41-UI-SPEC.md + DESIGN.md
**Screenshots:** Not captured (code-only audit — no dev server required per scope)
**Scope:** New elements only — DR/ENB headline, PCR list/bars, too-similar badge, empty states, section framing, a11y. CorrelationHeatmap renderer not re-audited.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All contracted copy landed verbatim; spec/implementation delta on storageKey undocumented in UI-SPEC |
| 2. Visuals | 3/4 | Hierarchy, badge position, and bar treatment are correct; risk-reducing tag uses positive-green semantic (intentional but undisclosed in spec) |
| 3. Color | 3/4 | Badge bg/border use hardcoded hex instead of `var(--color-warning-bg/border)` CSS token; inconsistent with every other warning chip in the codebase |
| 4. Typography | 4/4 | All sizes and weights match the spec contract exactly |
| 5. Spacing | 4/4 | Spacing tokens match spec; gap-10 inherited correctly; no arbitrary deviations |
| 6. Experience Design | 4/4 | All empty/null/finite guards correct; ENB<1 disclosure present; PCR overflow-clamp + overflow-hidden confirmed; negative-PCR treatment honest and annotated |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **Badge bg/border use hardcoded hex instead of CSS tokens** — If `--color-warning-bg` or `--color-warning-border` ever need to shift (they already shifted once for WCAG, and the dark-mode override targets them by token), the badge is the only warning chip in the product that will NOT pick up the change. Fix: replace `bg-[#FEF3C7] border-[#FDE68A]` with `bg-warning-bg border-warning-border` (or `style={{ background: "var(--color-warning-bg)", borderColor: "var(--color-warning-border)" }}` matching the HoldingsTable/AllocationDashboardV2 pattern).

2. **UI-SPEC spec/implementation delta on storageKey is not documented** — The UI-SPEC (line 109) declares `storageKey: "composer-collapse:diversification"` as a required prop. The implementation intentionally omits it (correct, per the Phase-38 RT2 cross-tab-bleed fix documented in the code comment at line 2418). The UI-SPEC was never updated. If a future implementer reads the spec to add analytics or a "Reset view" toggle, they will wire the storageKey and re-introduce RT2. Fix: update 41-UI-SPEC.md line 109 to read `storageKey — OMITTED intentionally (Phase-38 RT2: shared /allocations URL causes cross-tab state bleed; CollapsibleSection without a storageKey still supports the COLLAPSIBLE_OPEN_ALL_EVENT broadcast for "Reset view")`.

3. **"Risk-reducing" tag uses `bg-positive/10 text-positive` (green) with no spec grounding** — The UI-SPEC's PCR list spec (§4) does not define this tag at all. The implementation adds it (WR-03, logged in a code comment) but the spec was never updated to cover it. The green token on a risk element, even with the "risk-reducing" label, is a semantic stretch: DESIGN.md reserves positive/green exclusively for "gains, verified status, success." A hedge contribution reducing total portfolio risk is mathematically real but calling it "positive" (green) may mislead allocators who associate green with returns/profit. The DESIGN.md muted-teal accent (`bg-accent/10 text-accent`) is less semantically loaded and already used for "verified" and "action" signals. Fix: either (a) switch to `bg-accent/10 text-accent` to stay fully DESIGN.md-compliant, or (b) add the WR-03 treatment to 41-UI-SPEC.md with explicit justification for the positive/green choice so the next reviewer can audit against it.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

All UI-SPEC Copywriting Contract strings land verbatim in the implementation:

- Section title: `"Diversification"` — PASS (line 2426)
- Subtitle: `"Correlation does not shift with per-strategy leverage"` — PASS (line 2427). The subtitle is honest post-DR-leverage fix: the code comment at line 1574–1576 confirms leverage feeds into DR computation on the same levered basis as the engine, and `correlation_matrix` itself is leverage-invariant. The subtitle makes a narrower claim (about correlation, not DR), which is always true. No contradiction.
- PCR list header: `"Risk contribution per constituent (% of total)"` — PASS (line 2540)
- ENB formula disclosure: `"ENB = 1 / Σ PCRᵢ²"` — PASS (line 2496)
- ENB interpretation: `"{N} effective {bet/bets} across {M} {constituent/constituents}"` — PASS (lines 2499–2507). Singular/plural handled for both bets and constituents.
- "Too similar" badge: `"{count} {pair/pairs} above the 0.85 similarity threshold"` — PASS (lines 2444–2448). Singular handled.
- Heatmap palette legend: `"Burnt orange = positive correlation (concentration risk). Pairs ≥ 0.85 are flagged above."` — PASS (lines 2466–2468). Conditionally rendered when `correlation_matrix` is non-null (line 2464) — does not show in empty states.
- Empty state 0/1-constituent heading: `"Add a second strategy to see diversification"` — PASS (line 2432)
- Empty state body: `"Select at least 2 strategies to compare their pairwise correlation and see how diversified the blend is."` — PASS (line 2433)
- ENB<1 disclosure: `"Below 1 — a hedge offsets risk, so the blend behaves like less than one independent bet."` — Present (lines 2519–2520), conditional on `effectiveNumberOfBets < 1` (line 2514). Not in the UI-SPEC copywriting table but present in the spec prose (§3 "Non-finite DR / ENB" + IN-01 comment). PASS.

**WARNING — spec/implementation delta:** UI-SPEC line 109 declares `storageKey: "composer-collapse:diversification"`. Implementation intentionally omits it (line 2418 comment: "locked decision: avoid the Phase-38 RT2 cross-tab-bleed class"). The spec was never updated. Not a runtime defect but creates a future re-introduction risk.

**NIT:** The ENB interpretation line uses `diversification.clusterOrderIds.length` as the constituent count N (line 2504). This is the total strategy count, which correctly counts hedges too — a hedge is still a constituent in the blend. No issue.

---

### Pillar 2: Visuals (3/4)

**Badge placement — PASS:** The "too similar" badge renders before the heatmap div (line 2441 before line 2457) — correct "ABOVE the heatmap" placement per spec. Absence when no pairs exceed the threshold is enforced via the conditional (line 2441).

**No "all clear" affirmative badge — PASS:** Absence of the badge is correctly the signal. No "0 pairs flagged" message rendered.

**DR + ENB headline hierarchy — PASS:** `flex flex-wrap gap-8 items-start` (line 2476) matches the spec's two-cell flat KPI row. No card borders. "Data density > card density" rule respected.

**PCR bar direction — PASS:** The bar fill is `width: barWidth%` where barWidth is clamped to [0,100] and the track has `overflow-hidden` (line 2572). Overflow-clamp and hidden confirmed landed.

**Risk-reducing tag visual semantics — WARNING:** `bg-positive/10 text-positive` (line 2566) applies the positive/green semantic to a hedge constituent. DESIGN.md §Color defines positive/green as "gains, verified status, success" — none of which apply to a risk-reducing hedge leg. The label "risk-reducing" is accurate copy, but the green wash signals "good / profit" to finance readers. `bg-positive/10` is an established pattern across Badge.tsx, ReplacementCard.tsx, and AllocationTimeline.tsx (all for genuinely positive outcomes), so using it here is the only instance where the green semantic is stretched to mean "reduces something bad" rather than "something good." This is a design judgment call; it is not unambiguous.

**Children stack order — PASS:** Badge → Heatmap → Heatmap legend → DR/ENB headline → PCR list. The spec calls for: badge (above heatmap) → heatmap → headline → PCR list. Implementation matches.

**Empty state visual — PASS:** `EmptyStateCard` renders with `rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm` — neutral muted, no red/warning color, no `role="alert"`. Correct per spec and DESIGN.md honest-absence principle.

---

### Pillar 3: Color (3/4)

**Token conformance matrix:**

| Element | Implementation | Token Correct? |
|---------|----------------|----------------|
| DR/ENB values | `text-text-primary` | PASS |
| DR/ENB labels | `text-text-muted` | PASS |
| ENB formula caption | `text-text-muted` | PASS |
| ENB interpretation | `text-text-secondary` | PASS |
| ENB<1 disclosure | `text-text-muted` | PASS |
| PCR constituent name | `text-text-primary` | PASS |
| PCR value | `text-text-primary` | PASS |
| PCR bar fill (normal) | `bg-accent` | PASS |
| PCR bar fill (hedge) | `bg-positive` | PASS (established pattern, see Pillar 2 note) |
| PCR track | `bg-border overflow-hidden` | PASS |
| Badge text | `text-warning` | PASS — resolves via `--color-warning: #B45309` in @theme inline |
| Badge bg | `bg-[#FEF3C7]` | **FAIL — hardcoded hex, not `bg-warning-bg`** |
| Badge border | `border-[#FDE68A]` | **FAIL — hardcoded hex, not `border-warning-border`** |
| Heatmap legend | `text-text-muted` | PASS |

**MEDIUM — Badge bg/border hardcode:** The "too similar" badge at line 2443 uses `bg-[#FEF3C7] border-[#FDE68A]` (Tailwind arbitrary values). Every other warning-chip surface in the codebase uses `var(--color-warning-bg)` and `var(--color-warning-border)` — specifically HoldingsTable.tsx (lines 57–58 inline style), AllocationDashboardV2.tsx (lines 202–203 inline style). The hardcoded hex values happen to match the token values today (#FEF3C7 = `--color-warning-bg`, #FDE68A = `--color-warning-border`) so there is no visual defect right now. But:
1. The dark-mode override in globals.css line 453 targets `.bg-warning-bg` (the token class), not the arbitrary hex — the badge will NOT pick up the dark-mode override.
2. If the token shifts for WCAG reasons (as `--color-warning` already did in 2026-04-30), the badge is the only chip that won't follow.

Fix: `bg-warning-bg border-warning-border` if Tailwind v4 @theme exposes these as utilities, OR `style={{ background: "var(--color-warning-bg)", borderColor: "var(--color-warning-border)" }}` matching the HoldingsTable pattern.

**Note:** `--color-warning-bg` and `--color-warning-border` are defined in globals.css @theme inline (lines 56–57), so `bg-warning-bg` and `border-warning-border` should resolve as Tailwind utilities. The fix is a one-line class substitution.

**Red token absent — PASS:** No `text-negative`, `bg-negative`, or `#DC2626` anywhere in the new elements. High correlation is correctly treated as concentration-risk (amber warning), not an error.

---

### Pillar 4: Typography (4/4)

All sizes and weights match the UI-SPEC contract exactly:

| Element | Spec | Implementation | Match |
|---------|------|----------------|-------|
| DR/ENB labels | `text-[12px] text-text-muted` | `text-[12px] text-text-muted` (lines 2479, 2489) | PASS |
| DR/ENB values | `text-[18px] font-metric font-semibold tabular-nums text-text-primary` | exact (lines 2482, 2492) | PASS |
| ENB formula caption | `text-[11px] text-text-muted` | exact (line 2495) | PASS |
| ENB interpretation | `text-[12px] text-text-secondary` | exact (line 2498) | PASS |
| ENB<1 disclosure | `text-[11px] text-text-muted` | exact (line 2517) | PASS |
| PCR constituent name | `text-[12px] text-text-primary truncate` | exact (line 2560) | PASS |
| PCR value | `text-[12px] font-metric tabular-nums text-text-primary w-[48px] text-right` | exact (line 2582) | PASS |
| Badge label | `text-[10px] font-medium uppercase tracking-wider` | exact (line 2443) | PASS |
| Subtitle | `text-[11px] text-text-muted normal-case tracking-normal` | owned by CollapsibleSection line 152 | PASS |
| Section title | `text-sm font-semibold uppercase tracking-wider` | owned by CollapsibleSection line 148 | PASS |

`font-metric` resolves to Geist Mono with `font-variant-numeric: tabular-nums` (globals.css line 224–227). The `tabular-nums` class on the span AND the `font-variant-numeric` in `.font-metric` are redundant but not harmful.

No violations of the v2 factsheet 4-size / 2-weight type contract (sizes used: 10px, 11px, 12px, 18px; weights: regular and semibold — exactly 4 sizes and 2 weights).

---

### Pillar 5: Spacing (4/4)

| Element | Spec | Implementation | Match |
|---------|------|----------------|-------|
| CollapsibleSection children gap | `gap-10` (40px) inherited | `flex flex-col gap-10` in CollapsibleSection line 161 | PASS |
| DR/ENB headline | `flex flex-wrap gap-8 items-start` | exact (line 2476) | PASS |
| DR cell internal | `flex flex-col gap-1` | exact (line 2478) | PASS |
| ENB cell internal | `flex flex-col gap-1` | exact (line 2488) | PASS |
| PCR list header | `mb-2` | exact (line 2540) | PASS |
| PCR row | `flex items-center gap-2 py-2` | exact (line 2558) | PASS |
| PCR bar container | `flex-1 min-w-[60px] h-1.5 rounded-full` | exact (line 2572) | PASS |
| PCR value column | `w-[48px] text-right` | exact (line 2582) | PASS |
| Badge container | `px-2 py-0.5` | exact (line 2443) | PASS |
| Heatmap legend | `mt-2` | exact (line 2465) | PASS |

All values fall on the DESIGN.md 4px base scale or its multiples. `min-w-[60px]` and `max-w-[160px]` and `w-[48px]` are dimensional constraints (not spacing), appropriate as Tailwind arbitrary values. No off-ladder spacing values found.

---

### Pillar 6: Experience Design (4/4)

**Empty state gates — PASS:**
- 0/1-constituent: `diversification.clusterOrderIds.length < 2` (line 2430) renders `EmptyStateCard` with correct copy. The guard is correct: `clusterOrderIds` is initialized to `[...input.ids]` even on the all-null early-exit path in the lib (diversification.ts line 468), so the length check is reliable.
- n<10 / engine-null: delegated to `CorrelationHeatmap` (not duplicated). The DR/ENB/PCR blocks are gated on `diversification.*RatioValue != null` / `diversification.pcr != null`, which the lib returns as null when the correlation matrix is null. No double empty state.

**Non-finite guard — PASS:** `diversification.diversificationRatio != null` and `diversification.effectiveNumberOfBets != null` individually gate each KPI (lines 2474–2487). The `computeDiversification` lib documents that all outputs return null (not NaN or 0) on degenerate input, so "0.00" / "NaN" can never be rendered.

**PCR null guard — PASS:** `diversification.pcr != null` (line 2538) gates the entire list.

**ENB<1 disclosure — PASS:** `data-testid="enb-below-one-disclosure"` at line 2516, conditional on `effectiveNumberOfBets < 1` (line 2514). The disclosure text is factually accurate ("a hedge offsets risk, so the blend behaves like less than one independent bet").

**PCR signed % preserved — PASS:** Negative PCR values render as e.g. `"-12.3%"` (line 2583 uses `(pcr * 100).toFixed(1)%` on the signed value). The text carries the true value; the bar magnitude is clamped to |PCR| so a negative bar doesn't render as zero-width (which would read as broken).

**PCR sort with hedges — PASS:** `.sort(([, a], [, b]) => b - a)` (line 2545) sorts descending by raw signed PCR. This places the largest positive contributors first and hedges (negative PCR) last. This is the correct allocator UX — the top risk driver is the highest positive contributor.

**storageKey omission — PASS at runtime:** `CollapsibleSection` with no `storageKey` prop uses `enabled: Boolean(storageKey)` which disables the `useCrossTabStorage` hook entirely (CollapsibleSection.tsx line 88). No localStorage read or write; no RT2 bleed. The `COLLAPSIBLE_OPEN_ALL_EVENT` broadcast is still handled (line 113), so "Reset view" still opens the section. `defaultOpen` (line 2428) is the correct fallback. No runtime defect.

**`aria-hidden` on bar — PASS:** Line 2573. The PCR percentage text on line 2582 carries the accessible value.

**`role="list"` / `role="listitem"` — PASS:** Lines 2543, 2557. Screen readers will announce constituent count.

**No duplicate landmark — PASS:** The CollapsibleSection renders `<details>` (not `<section role="region">`) per the Phase 33 a11y lesson documented in the spec.

---

## Spec Delta Log

| Delta | Severity | Note |
|-------|----------|------|
| `storageKey` present in UI-SPEC §1, absent in implementation | MEDIUM | Intentional post-spec decision (RT2 fix). Spec not updated. |
| "risk-reducing" tag (WR-03) not in UI-SPEC §4 | LOW | Added in implementation with code comment; spec §4 never amended. |
| Badge bg/border use arbitrary hex, not token | MEDIUM | Visual match today; token-drift risk on next palette shift. |

---

## Registry Safety

No shadcn initialization. No third-party component registries. All new elements use existing Tailwind utilities and project primitives. Registry audit: not applicable.

---

## Files Audited

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — lines 1541–1607 (diversification memo + reorder), 2409–2594 (Diversification CollapsibleSection render)
- `src/components/ui/CollapsibleSection.tsx` — full (subtitle slot, storageKey handling, gap-10 children wrapper)
- `src/components/ui/EmptyStateCard.tsx` — full (prop names, typography, color)
- `src/app/globals.css` — @theme inline block (token definitions for warning, positive, accent, text-*, border)
- `src/lib/diversification.ts` — output shape (diversificationRatio, effectiveNumberOfBets, pcr, clusterOrderIds, tooSimilarPairs)
- `src/lib/storage/storage-namespaces.ts` — `composer-collapse:` namespace registration confirmed
- `DESIGN.md` — conformance reference (color, typography, spacing, component patterns)
- `.planning/phases/41-constituent-correlation-diversification/41-UI-SPEC.md` — design contract
- `.planning/phases/41-constituent-correlation-diversification/41-CONTEXT.md` — implementation decisions
