# Phase 112: WEIGHTS (leverage rows) — per-constituent weights + leverage - Context

**Gathered:** 2026-07-16
**Status:** Ready for research → planning
**Mode:** Autonomous. Founder requested a research pass before planning. Decisions locked from ROADMAP Success Criteria + the WEIGHTS memory; the exact existing-infra-vs-gap map is the research deliverable.

<domain>
## Phase Boundary

An allocator sets per-strategy WEIGHTS and per-row LEVERAGE directly on the unified constituent rows (the single list Phase 111 built), and the blend re-derives from the levered daily series. This is UI + wiring onto the post-111 unified rows — the engine already applies per-constituent leverage (R4) and consumes `weightOverrides`/`leverageOverrides`.

**Out of scope (fenced):**
- `scenario.ts` stays BYTE-FROZEN (SC-3 gate). The engine's R4 leverage + weight application already exist; do NOT edit the engine.
- No max-DD→leverage SOLVER (that is Phase 113 — WEIGHTS-03/04).
- No E1/E2 backbone absorption (114/115), no "+ Allocation" (116).
</domain>

<decisions>
## Implementation Decisions

### WEIGHTS-01 — per-strategy weights on the strategy-level rows
- Weights sit on the STRATEGY-level constituent rows (a strategy's multiple keys collapse to one strategy-level row per CONSTIT-03; the weight is per strategy-level row).
- Weight-sum validation preserved THROUGH the strategy-level collapse (the existing `sum(weightOverrides[ref] for included refs) === 1.0` invariant — see `scenario-state.ts:10`). Research must confirm how the collapse interacts with the existing weight-sum check.
- Reuse the EXISTING `weightOverrides` map + `clampAllWeights` defense (`scenario-state.ts:114,187`) — do not invent a new weight store.

### WEIGHTS-02 — per-row leverage
- Per-constituent leverage input on the unified rows; the blend re-derives from the levered daily series via the EXISTING Phase-107 `r→L·r` transform + the engine's R4 `leverage` multiplier (`scenario.ts:120,321-436`). No symbol-keyed engine path may be reintroduced.
- Leverage is SANITIZED ON READ (never zod `.min/.max`-refined), so a bad value can never delete the saved draft — the existing `sanitizeLeverageMap` / `MAX_LEVERAGE` contract (`@/lib/leverage`, `ScenarioComposer.tsx:120,177`) already provides this. Confirm it covers the unified-row path.
- Reuse the EXISTING `leverageOverrides` map (LEV-02, Phase 90.5, `scenario-state.ts:135`) + the shared `@/lib/leverage` contract.

### WEIGHTS-00 — semantic model (A1 LOCKED, founder 2026-07-17)
- **Route 1 / Option A is LOCKED.** Weight = **equity-capital share** (sums to 1 over selected engine units); leverage = a **separate per-constituent multiplier** that amplifies that constituent's daily-return series (`w·L·r`, exactly the frozen engine). A levered-up leg shows genuinely higher return AND drawdown; its blend weight stays the equity share.
- **Notional = equity × L is a DERIVED, read-only, informative column** — it exists to tell the allocator whether a constituent clears its minimum investment size. It is NEVER a weight input. Notional-as-weight (Route 2) is rejected (would re-weight the book on leverage + require an SC-3-forbidden engine change).
- Columns per row: `{equity-share weight — editable} × {leverage — editable} → {notional — derived read-only}`.

### Honesty (from the WEIGHTS memory)
- Levered KPIs recompute from the levered series. ⚠️ Sharpe/Sortino/Calmar are LEVERAGE-INVARIANT (the engine deliberately does not apply leverage to the risk-adjusted / correlation path — `scenario.ts:110-117`). Any levered KPI panel must flag this honestly (do not imply leverage improves Sharpe). This is a DESIGN.md/Numbers-Contract honesty point.

### Reuse over reinvention
- Added strategies ALREADY have weight/leverage controls + `WeightOptimizerSection` (`ScenarioComposer.tsx:24,168`). Phase 112 extends these UNIFORMLY to the strategy-level constituent rows (incl. the per-key sources unified in 111), not just added strategies. The research must map exactly what is added-strategy-only today vs. what must extend.

### Regression tests (MANDATORY)
- Weight-sum validation through the collapse; per-row leverage re-derives the blend (engine R4); sanitize-on-read proves a bad leverage value cannot delete the draft; scenario.ts freeze gate stays green.
</decisions>

<code_context>
## Existing Code Insights (confirmed by grounding grep)
- `src/lib/scenario.ts:107-120,321-436` — R4 per-strategy `leverage?: Record<string,number>` multiplier; leverage scales exposure/return/vol/maxDD but NOT the correlation/risk-adjusted path (Sharpe leverage-invariant). BYTE-FROZEN — read only.
- `src/app/(dashboard)/allocations/lib/scenario-state.ts:114,135,187` — `weightOverrides`, `leverageOverrides?` (LEV-02), `clampAllWeights`, the weight-sum invariant (`:10`).
- `src/lib/leverage.ts` — `MAX_LEVERAGE`, `sanitizeLeverageMap` (sanitize-on-read contract, D5 Phase 90.5).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:24,120,168,177` — existing weight/leverage controls (added strategies today), `WeightOptimizerSection`, the `@/lib/leverage` bounds.
- The unified constituent list + `togglePerKeySource` (Phase 111) is the surface these controls extend onto.
</code_context>

<specifics>
## Specific Ideas
- WEIGHTS memory (`project_v1_11_weights_leverage_maxdd_spec`): Notional = equity × L; levered KPIs below; Sharpe/Calmar leverage-INVARIANT (flag honestly). Two-way MaxDD↔L coupling is Phase 113, not 112.
- Founder requested research — the researcher must produce the existing-infra-vs-gap map + the strategy-level-collapse weight-sum design + the honest-KPI treatment.
</specifics>

<deferred>
## Deferred Ideas
- max-DD→leverage solver + bidirectional coupling → Phase 113 (WEIGHTS-03/04).
- E1/E2 backbone absorption → 114/115.
</deferred>
