# Phase 113: WEIGHTS (max-DD→leverage solver) — Context

**Gathered:** 2026-07-17
**Status:** Ready for research → planning
**Mode:** Autonomous. Decisions locked from ROADMAP Success Criteria + the WEIGHTS memory + the Phase-112 A1 lock; the solver's monotonicity/convergence method is the research deliverable.

<domain>
## Phase Boundary

Extends the Phase-112 per-constituent LEVERAGE row with a per-row MODE TOGGLE (Leverage | Target max-DD). In Target-max-DD mode the allocator types a max-drawdown target and the system BACK-SOLVES the implied leverage numerically, keeping the derived leverage visible (read-only) and showing honest failure states. This is UI + a client-side solver over the BYTE-FROZEN engine's real `r→L·r` transform.

**Out of scope (fenced):**
- `scenario.ts` stays BYTE-FROZEN (SC-3 gate). The solver CALLS the engine's transform + metrics per trial L; it does NOT edit the engine.
- No E1/E2 backbone absorption (114/115), no "+ Allocation" (116), no tooltip/overflow polish (117).
- Does NOT change the Phase-112 weight/leverage/notional semantics (A1/Route-1 stays: weight=equity share, L amplifies the return series, notional=equity×L derived read-only).
</domain>

<decisions>
## Implementation Decisions (locked)

### WEIGHTS-03 — per-row max-DD target back-solves leverage

### ⭐ FOUNDER DECISION LOCK (2026-07-17) — the target is the SLEEVE's own max-DD, NOT the portfolio's
This OVERRIDES the researcher's A1/A5 portfolio-level assumption. Confirmed by the founder:
- **Target = the row/sleeve's OWN standalone levered max-DD** (that ONE constituent's return series scaled by L), not the portfolio's max-DD. Example (founder): sleeve unlevered max-DD = 5%, allocator wants the sleeve at 20% → **L ≈ 4×**. The numerical solve refines the exact L near 4× for compounding (ROADMAP: "not a closed-form approximation").
- A single sleeve's standalone max-DD is **MONOTONE non-decreasing in L** (amplifying one return series only deepens its own drawdown, until ruin) → a **UNIQUE root** → a clean ruin-clamped **monotone bisect**. The portfolio-DD non-monotonicity the research found does NOT affect the solve (it only afflicts the *portfolio* aggregate, which we DISPLAY, never solve against).
- **Smallest L** (founder-confirmed) = trivially the unique root; on any flat interval, pick the lower end.
- **One-shot calculator** (founder-confirmed): type target → get L; the derived L then behaves like any normal Phase-112 leverage the allocator can hand-tweak. Mode + target are transient UI state; only the solved L persists (no `SCENARIO_SCHEMA_VERSION` bump).
- **ALSO SHOW the resulting PORTFOLIO-level max-DD** (founder-required): after solving L from the sleeve target, display the full-book portfolio max-DD that the levered sleeve produces (a computed display value via the full-book `computeScenario`, NOT solved). This is the honest "what does 4× on this sleeve do to my whole book" readout.
- **Sleeve standalone metric source:** `computeScenario({that one constituent, weight 1, leverage L}).max_drawdown` — the engine reduces to `portDaily = L·rᵢ` for a single weight-1 constituent, so its max_drawdown IS the sleeve's standalone levered max-DD. No engine change (SC-3 frozen); confirm in planning.

### WEIGHTS-03 mechanics (locked, per founder + ROADMAP)
- Per-row MODE TOGGLE `Leverage | Target max-DD`, **DEFAULTING to Leverage** (Target-max-DD is opt-in per row).
- The solve is NUMERICAL over a **ruin-clamped domain** on the REAL `r→L·r` transform + the engine's SLEEVE max_drawdown per trial L — **NOT a closed-form approximation**. Because the sleeve solve is monotone, the ROADMAP's "grid-scan-then-bisect" degenerates to a clean monotone bisect (a grid pre-scan still validly brackets; keep it if it de-risks the bracket, but the function is monotone so a plain bisect on `[L_lo, min(MAX_LEVERAGE, L_ruin)]` converges).
- Domain: solving a target ABOVE the unlevered (L=1) sleeve max-DD → L>1 (lever up). A target BELOW the unlevered sleeve max-DD is reachable only by DELEVERAGING (L<1) — the engine + leverage input already allow `[0, MAX_LEVERAGE]`, so allow `L ∈ [0, min(MAX_LEVERAGE, L_ruin)]` (deleveraging is honest). If the founder later wants leverage-only (L≥1), a below-base target becomes an honest "already below target at 1×" state instead — planning may flag this, but default to allowing deleverage.
- The derived leverage stays VISIBLE (read-only) — never hidden. The row still feeds the same engine leverage path (`leverageByRef[ref]`) that Phase 112 wired.

### ⚠️ CONFLICT SURFACED (Rule 7) — numerical solver SUPERSEDES the naive closed-form
- The WEIGHTS memory (`project_v1_11_weights_leverage_maxdd_spec`) framed leverage as `L = target_MaxDD / base_MaxDD` (a two-way closed-form that assumes MaxDD scales LINEARLY with L).
- The ROADMAP Success Criteria (more recent, more specific) explicitly REJECT the closed-form ("not a closed-form approximation") and mandate the numerical grid-scan-then-bisect on the real transform — precisely because MaxDD does NOT scale exactly linearly with L under compounding (an equity curve of `∏(1 + Σwᵢ·Lᵢ·rᵢ)` is not a simple scale of the L=1 curve). **The numerical approach is LOCKED; the closed-form is retired.** The memory's `target/base` is at best a seed for the grid, never the answer.

### WEIGHTS-04 — round-trip + honest failure states
- A round-trip test: the solved L, re-applied through the engine, reproduces the target max-DD within tolerance.
- Honest states (never a fabricated leverage or drawdown): target UNREACHABLE at max leverage (`MAX_LEVERAGE`), degenerate series (flat / all-negative / insufficient observations), non-monotonic/ill-posed domain → em-dash / explicit "unreachable" message per DESIGN.md Numbers Contract. Reuse the Phase-112 honesty patterns (sanitize-on-read, em-dash on null/non-finite, visible message on refusal).

### Reuse over reinvention (Phase-112 surface)
- Extend the EXISTING per-row leverage control (Phase 112, `ScenarioComposer.tsx handleLeverageChange` / `leverageByRef`) with the mode toggle + the solver; do NOT fork a new leverage store.
- The solver writes into the SAME `leverageByRef[ref]` the engine consumes — a solved L is just a leverage value with a derived provenance.
- Honor the Phase-112 weight-basis landmines (mixed-book detection, sole-unit refuse, per-key diffCount) — the mode toggle must not reintroduce them.

### Regression tests (MANDATORY)
- Round-trip: solved L reproduces target max-DD within tolerance (WEIGHTS-04).
- Monotonicity/convergence: the bisect converges on the ruin-clamped domain (research must confirm MaxDD is monotone in L there, or the plan handles non-monotonicity).
- Honest failure: infeasible/degenerate → no fabricated value (RED-proof).
- scenario.ts freeze gate stays green (SC-3).
</decisions>

<code_context>
## Existing Code Insights (to confirm in research)
- `src/lib/scenario.ts` (FROZEN) — the `r→L·r` transform + max_drawdown metric the solver drives per trial L (read-only reference).
- `src/lib/leverage.ts` — `MAX_LEVERAGE`, `sanitizeLeverageMap` (the ruin/domain ceiling + sanitize-on-read).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — Phase-112 per-row leverage input + `handleLeverageChange` + `leverageByRef` (the control to extend with the mode toggle + solver); notional column + invariance caveat.
- The Phase-112 weight-basis landmines: `project_v1_11_weight_basis_mixing_condition_landmines` (mixed-book detection, sole-unit refuse, per-key diffCount).
</code_context>

<specifics>
## Specific Ideas
- The solver runs CLIENT-SIDE per row against the engine's real metrics — a per-row max-DD → L bisect over `[1, MAX_LEVERAGE]` (or a ruin-clamped subdomain), seeded by a grid scan.
- The Sharpe/Sortino/Calmar leverage-invariance honesty (Phase 112) still holds — a max-DD target changes L and thus return/vol/DD, but NOT the risk-adjusted ratios; the panel must stay honest.
</specifics>

<deferred>
## Deferred Ideas
- E1/E2 backbone absorption (Sharpe/TWR/equity) → 114/115.
- "+ Allocation" wizard → 116; tooltip/overflow polish → 117.
</deferred>
