# Phase 112: WEIGHTS (leverage rows) — per-constituent weights + leverage - Research

**Researched:** 2026-07-17
**Domain:** Scenario Composer client UI + client-state wiring (React + pure TS state machine) onto the frozen blend engine
**Confidence:** HIGH (all findings traced to file:line in the working tree; engine is byte-frozen and read-only)

## Summary

Phase 112 is **almost entirely a UI + writer-wiring phase, not an engine phase**. The frozen engine (`src/lib/scenario.ts`, SC-3 byte-frozen) *already* applies both a per-unit weight (`state.weights[id]`) and a per-unit leverage multiplier (`state.leverage[id]`) as `wᵢ·Lᵢ·rᵢ / Σwᵢ` over its unit set (`scenario.ts:314-431`). The composer's `projectionState` *already* wires `draft.weightOverrides[id]` and `leverageByRef[id]` straight through for **every** engine unit — including per-key (`api_key_id`) units (`ScenarioComposer.tsx:2255-2261`). The only thing missing is the **UI input** on the per-key/strategy-level rows and the **writer + weight-sum-basis wiring** behind it. The added-strategy rows are the reference implementation: they already render a weight input and a leverage input (`ScenarioComposer.tsx:4969-4995`).

The single non-trivial design problem is the **weight-sum basis**. CONSTIT-03 (Phase 111) deliberately kept per-key refs OUT of `weightOverrides` and OUT of `enabledIdsOf` — they ride the raw equity-share path and the engine renormalizes (`scenario-state.ts:411-413,424-426`; `ScenarioComposer.tsx:2252-2254`). WEIGHTS-01 *reverses* that: per-key rows become weightable, so their `api_key_id` refs must now participate in the sum-to-1 weight basis. The correct, already-proven mechanism is `applyWeightOverrides(weights, basisIds)` with `basisIds = selected engine unit ids` (the WR-01 pattern, `ScenarioComposer.tsx:4048-4051`) — **not** the default `enabledIdsOf` basis, which excludes per-key units.

**Primary recommendation:** Extend the per-key constituent row (`CompositionList`, `ScenarioComposer.tsx:4851-4905`) to render the SAME weight + leverage inputs the added rows already render, keyed by `api_key_id` (the engine unit id). Route weight edits through an engine-unit basis (`applyWeightOverrides` / an explicitly-basised `setWeightOverride`), reuse `leverageByRef` + `handleLeverageChange` verbatim for leverage, and extend `pruneLeverageToDraftRefs` so a per-key leverage-only edit is not dropped at Save. Touch NO engine code. Keep leverage sanitize-on-read (no zod refine). No `schema_version` bump.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-row weight input UI | Browser / Client (`CompositionList`) | — | Presentation of a draft-state field; no server round-trip |
| Weight-sum invariant + renormalize | Client state (`scenario-state.ts`) | — | Pure transform on the immutable draft |
| Per-row leverage input UI | Browser / Client (`CompositionList`) | — | Overlay on `leverageByRef` useState |
| Leverage sanitize-on-read | Client shared contract (`@/lib/leverage`) | — | Fail-safe clamp; never a schema refine |
| `wᵢ·Lᵢ·rᵢ` blend re-derivation | Blend engine (`scenario.ts`) | — | **BYTE-FROZEN — already implemented, do not edit** |
| Draft persistence (weight/leverage) | API save routes (`saved/route.ts` PUT/POST) | Client codec | jsonb `scenarios.draft`; shape already supports both maps |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**WEIGHTS-01 — per-strategy weights on the strategy-level rows**
- Weights sit on the STRATEGY-level constituent rows (a strategy's multiple keys collapse to one strategy-level row per CONSTIT-03; the weight is per strategy-level row).
- Weight-sum validation preserved THROUGH the strategy-level collapse (the existing `sum(weightOverrides[ref] for included refs) === 1.0` invariant — `scenario-state.ts:10`).
- Reuse the EXISTING `weightOverrides` map + `clampAllWeights` defense — do not invent a new weight store.

**WEIGHTS-02 — per-row leverage**
- Per-constituent leverage input on the unified rows; the blend re-derives from the levered daily series via the EXISTING Phase-107 `r→L·r` transform + the engine's R4 `leverage` multiplier (`scenario.ts:120,321-436`). No symbol-keyed engine path may be reintroduced.
- Leverage is SANITIZED ON READ (never zod `.min/.max`-refined) via `sanitizeLeverageMap` / `MAX_LEVERAGE` (`@/lib/leverage`).
- Reuse the EXISTING `leverageOverrides` map (LEV-02, Phase 90.5) + the shared `@/lib/leverage` contract.

**Honesty**
- Levered KPIs recompute from the levered series. Sharpe/Sortino/Calmar are LEVERAGE-INVARIANT (`scenario.ts:110-117`). Any levered KPI panel must flag this honestly. DESIGN.md/Numbers-Contract honesty point.

**Reuse over reinvention**
- Added strategies ALREADY have weight/leverage controls + `WeightOptimizerSection`. Phase 112 extends these UNIFORMLY to the strategy-level constituent rows (incl. the per-key sources unified in 111), not just added strategies.

**Regression tests (MANDATORY)** — weight-sum through collapse; per-row leverage re-derives the blend (engine R4); sanitize-on-read proves a bad leverage value cannot delete the draft; scenario.ts freeze gate stays green.

### Claude's Discretion
- The exact existing-infra-vs-gap map is the research deliverable (this document).
- The precise columns/layout of any levered-KPI panel (subject to the honesty flag).

### Deferred Ideas (OUT OF SCOPE)
- max-DD→leverage solver + bidirectional coupling → Phase 113 (WEIGHTS-03/04).
- E1/E2 backbone absorption → 114/115.
- True multi-key-per-strategy stitching (windowed `strategy_keys`) → Phase 115 STITCH.
- "+ Allocation" wizard → Phase 116.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WEIGHTS-01 | per-strategy weights on strategy-level rows; weight-sum validation through the collapse | Per-key row = engine unit keyed by `api_key_id`; weights already consumed by `projectionState` (`ScenarioComposer.tsx:2255-2259`); sum-to-1 basis via `applyWeightOverrides(weights, engineUnitIds)` (WR-01, `:4048-4051`). Gap = the input + the basised writer. |
| WEIGHTS-02 | per-row leverage; blend re-derives from levered series; no symbol-keyed path; leverage sanitized on read | Engine applies `wᵢ·Lᵢ·rᵢ` per unit (`scenario.ts:427`); `projectionState` wires `leverageByRef[api_key_id]` (`:2260-2261`); `handleLeverageChange` clamps [0,MAX_LEVERAGE] with visible message (`:1077-1098`); `sanitizeLeverageMap` on read (`leverage.ts:105-118`). Gap = the input + `pruneLeverageToDraftRefs` extension. |
</phase_requirements>

## Existing infra → gap → wiring (per constituent row type)

| Row type | Engine unit id | Weight input today? | Leverage input today? | Engine/projection already consumes it? | Gap for Phase 112 |
|----------|----------------|---------------------|------------------------|----------------------------------------|-------------------|
| **Per-key exchange source** (api-verified) | `api_key_id` (`ScenarioComposer.tsx:2065`) | **NO** — explicit "Phase 112 fence" (`:4847-4850`); rides RAW equity-share, no `weightOverrides` entry | **NO** — no input rendered | **YES** — `projectionState` reads `weightOverrides[api_key_id]` (`:2255-2259`) and `leverageByRef[api_key_id]` (`:2260-2261`); engine blends it (`scenario.ts:427`) | Add weight + leverage inputs to the per-key `<li>`; wire `onSetWeight`/`onSetLeverage`; use ENGINE-UNIT weight basis; extend `pruneLeverageToDraftRefs` |
| **Added strategy** (browse/bridge) | strategy UUID | **YES** (`:4969-4979` → `handleWeightChange` → `setWeightOverride`) | **YES** (`:4983-4995` → `handleLeverageChange` → `leverageByRef`) | YES | **None** — this is the reference implementation to mirror |
| **Composite** (added via drawer) | strategy UUID (lands in `addedStrategies`) | YES (renders as an added row) | YES (renders as an added row) | YES | None — composites are added rows; provenance badge = `composite` |
| **Per-coin holding** | (removed) | N/A — deleted from composer (CONSTIT-03, moved to Holdings tab, `111-03-SUMMARY`) | N/A | No holdings units reach the engine (`ScenarioComposer.tsx:2276-2280`) | **Do NOT reintroduce** — the removed symbol-keyed builder + alias collapse must stay gone |

**Bottom line:** the engine and `projectionState` are already leverage- and weight-complete for per-key units. Phase 112 is the **input surface + the writer + the weight-sum basis + the save-prune fix**. No new maps, no engine edit.

## Strategy-level collapse + weight-sum recipe

### What "collapse" means here (and what it does NOT)
- The per-COIN collapse already happened in Phase 111: many holdings → ONE per-key row; per-coin detail moved to the Holdings tab (CONSTIT-03, `111-03-SUMMARY`). The per-key row IS the strategy-level constituent, keyed by `api_key_id` — **one exchange key = one weightable row** (`ScenarioComposer.tsx:2064-2066`, `id === api_key_id`).
- **TRUE multi-key-per-strategy collapse** (one strategy spanning several keys via a windowed `strategy_keys` stitch) is **Phase 115 STITCH, not 112** (ROADMAP `STITCH-01`; MEMORY `project_v1_11_allocator_is_a_strategy_unified_pipeline`). ⚠️ The CONTEXT phrase "a strategy's multiple keys collapse to one strategy-level row" is satisfied **today at one-key-per-row granularity**; do not attempt real stitching in 112.

### The weight-sum recipe (the load-bearing detail)
1. **Weights key by the engine unit id** — `api_key_id` for per-key rows, strategy UUID for added rows. NOT a `holding:` scopeRef, NOT a symbol.
2. **The sum-to-1 basis is the SELECTED ENGINE UNIT SET, not `enabledIdsOf(draft)`.**
   - `enabledIdsOf` filters `toggleByScopeRef === true` (`scenario-state.ts:306-310`). Included per-key refs are ABSENT (not `true`) because `togglePerKeySource` DELETES the ref on re-include to keep per-key units out of the added-weight rescale (`scenario-state.ts:434-440`). So `enabledIdsOf` **excludes per-key units**.
   - Using `setWeightOverride` (basis `enabledIdsOf`, `scenario-state.ts:589`) for a per-key weight would renormalize only over added+holding refs → the invariant would NOT hold across per-key + added.
   - **Use the WR-01 pattern:** `applyWeightOverrides(weights, basisIds)` where `basisIds = engineSet.strategies.filter(selected).map(s => s.id)` (`ScenarioComposer.tsx:4048-4051`). This renormalizes exactly over the mixed per-key + added universe. For a single-row edit, either build a one-entry vector and pass the engine-unit basis, or add a basis parameter to `setWeightOverride`.
3. **The invariant to preserve** (`scenario-state.ts:10`): `sum(weights[ref] for ref in SELECTED ENGINE UNITS) === 1.0` (within 1e-9). Redefine "included refs" for the per-key era as "selected engine units" (per-key `api_key_id` where `toggleByScopeRef[id] !== false`, plus enabled added ids).
4. **Exclusion interaction (CF-05 / CONSTIT-03):** excluding a per-key row writes `toggleByScopeRef[api_key_id]=false`, which drops it from the selected engine set → the denominator shrinks and the engine renormalizes the survivors to 1 (`scenario.ts:314-319`, ephemeral renorm; typed weights stay source of truth). Exclusions persist with the draft and count toward `diffCount` (111-03/111-05). Excluding a key does change the weight-sum denominator — that is correct and honest.
5. **Composer↔compare parity:** `projectionState.selected` is byte-identical to `scenario-compare.ts`'s selected derivation (`ScenarioComposer.tsx:2240-2242`). As long as Phase 112 writes weights into `weightOverrides` (which compare already reads) and does not fork the selection channel, parity holds under weighting.

### Design tension to reconcile (flag for the planner)
CONSTIT-03's `togglePerKeySource` intentionally keeps per-key refs weightless and out of `enabledIdsOf` ("weightless refs, never rescales weights"). WEIGHTS-01 makes per-key rows weightable. The two must be reconciled: once a per-key row carries a `weightOverrides[api_key_id]`, a subsequent include/exclude toggle must renormalize the engine-unit basis (not the added-only basis). Recommend: keep `togglePerKeySource` as the include/exclude channel but drive all weight renormalization through the explicit engine-unit basis, so the toggle's DELETE-on-re-include semantics no longer govern the weight math.

## Honest levered-KPI treatment

**What the frozen engine does with leverage (verified):**
- Applies `wᵢ·Lᵢ·rᵢ` in the numerator, renormalizes by the UN-levered weight mass `Σwᵢ` (`scenario.ts:424-430`). So a 2× leg genuinely contributes 2× its return; net portfolio notional exposure `Σwᵢ·Lᵢ` can exceed 1× — this is real portfolio leverage, correctly modeled as return-on-equity.
- Leverage scales **exposure / return / volatility / max-drawdown** (`scenario.ts:109-114`).
- Leverage is **NOT** applied to the correlation matrix (built from UNLEVERED `strategyReturns`, `scenario.ts:403-407,583,597`) — a scale transform leaves Pearson correlation unchanged.
- Sharpe / Sortino / Calmar are **LEVERAGE-INVARIANT** (`scenario.ts:110-115`) — v1 models leverage as costless daily-return scaling (no borrow/funding), so risk-adjusted ratios cancel the multiplier.

**What any levered-KPI surface MUST flag honestly:**
| Quantity | Behavior under leverage L | Honest label requirement |
|----------|---------------------------|--------------------------|
| Notional = equity × L | Scales linearly with L | Show as a DERIVED column; not a mandate |
| Return / CAGR / TWR | Scales with L | May display levered |
| Volatility / Max drawdown | Scales with L | May display levered |
| Sharpe / Sortino / Calmar | **Unchanged by L** | Must caveat: "risk-adjusted ratios do not shift with leverage (no borrow cost modeled)" |
| Correlation matrix / avg ρ | **Unchanged by L** | Subtitle already reads "Correlation does not shift with per-strategy leverage" (`ScenarioComposer.tsx:4074`) — reuse this pattern |

**Numbers Contract (DESIGN.md:148-164):** ratios 2dp; percentages 1dp **signed**; tail-risk 2dp; **null/non-finite → em-dash `—`, never `0`, never a fabricated value.** A leverage that produces a degenerate metric shows a dash, not a made-up number. Reuse the factsheet formatter family (one formatter module per surface).

## The weight / leverage / notional / equity semantic model (founder point)

The founder raised: "equity × leverage = notional, and notional is the weight." This is a genuine either/or the planner must lock, because the **engine is byte-frozen and already commits to one model**:

- **Current frozen-engine model (Option A):** `weight` = the **equity capital share** (sums to 1 over the selected units), `leverage` = a **separate per-constituent multiplier**. Portfolio daily return = `Σ wᵢ·Lᵢ·rᵢ / Σwᵢ` = return on total equity. `Notional = equityᵢ × Lᵢ = weightᵢ × Lᵢ × totalEquity` is a **derived DISPLAY quantity**, not the weight input. Net portfolio leverage `Σwᵢ·Lᵢ` can exceed 1×. This matches the WEIGHTS memory ("Notional=equity×L" as a COLUMN) and the frozen engine.
- **"Notional-as-weight" model (Option B):** the user inputs notional shares directly and leverage is folded into the weight. This **cannot drive the frozen engine's separate leverage path** and loses the return-on-equity semantics — it would require an engine change, which SC-3 forbids.

**Recommendation (HIGH confidence):** Phase 112 MUST use Option A — separate `equity-share weight` input + `leverage` input, with `notional = equity × L` as a **read-only derived column**. Confirm with the founder that the columns are `{equity-share weight (editable)} × {leverage (editable)} → {notional (derived, read-only)}`, not a notional-weight input. This is the WEIGHTS-memory spec ("editable MaxDD + Leverage + equity cols") read against the frozen engine. See Assumptions Log A1.

**On "is leverage per-coin today?":** No. Per-coin holding rows were REMOVED from the composer in Phase 111 (CONSTIT-03) and live on the Holdings tab with no weight/leverage. No holdings units reach the engine (`ScenarioComposer.tsx:2276-2280`). Today the leverage input exists ONLY on ADDED-strategy rows (`CompositionList` `:4983-4995`) and applies to that strategy's whole daily-return series. The engine ALSO already supports leverage on per-key (`api_key_id`) units — `projectionState` wires it through — but no UI renders that input yet. Per-key/strategy-level leverage is exactly what Phase 112 adds. Leverage is per **engine unit** (a per-key exchange source or an added strategy), never per individual coin.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sum-to-1 across mixed per-key + added | A new renormalize loop | `applyWeightOverrides(weights, engineUnitBasisIds)` (`scenario-state.ts:643`; WR-01 wiring `:4048-4051`) | Single-pass renorm over the exact engine basis; looping `setWeightOverride` lands a different allocation (`scenario-state.ts:625-641`) |
| Leverage bounds/validation | A zod `.min/.max` refine on `leverageOverrides` | `sanitizeLeverageMap` on read + `handleLeverageChange` clamp on input | A refine failure routes the codec to RESET → deletes the whole draft (`leverage.ts:19-21`, `scenario-state.ts:849-853`) |
| Leverage state store | A new per-key leverage map | Reuse `leverageByRef` useState + `setLeverageOverrides` stamp-at-save (`ScenarioComposer.tsx:872`, `scenario-state.ts:762-767`) | One overlay, one save-fold; keeps leverage out of autosave/diffCount |
| Weight clamp | Inline `Math.min/max` | `clampAllWeights` / `clampWeight` (`scenario-state.ts:191-204`) | Already the defense-in-depth exit gate every mutator uses |
| Per-key weight source | Re-derive equity from `value_usd` | `holdingEquityContributionLocal` grouped by `api_key_id` (`ScenarioComposer.tsx:2054-2062`) | Derivative notional ≠ equity; the D2 helper is the canonical weight source |

**Key insight:** every primitive Phase 112 needs already exists and is battle-tested; the phase is composition + input rendering, not new machinery.

## Common Pitfalls

### Pitfall 1: Per-key leverage silently pruned at Save
**What goes wrong:** A user sets leverage on a per-key row but never sets its weight or toggles it. At Save, `pruneLeverageToDraftRefs` keeps only refs in `addedStrategies ∪ toggleByScopeRef-keys ∪ weightOverrides-keys` (`ScenarioComposer.tsx:724-728`). An INCLUDED per-key ref is absent from all three (raw equity-share, no toggle entry, no weight entry) → its leverage is DROPPED.
**How to avoid:** Extend the `current` set in `pruneLeverageToDraftRefs` to include the eligible per-key `api_key_id`s (`dataSourceKeys` / `eligibleApiKeyIds`), OR ensure a per-key weight is always written into `weightOverrides` when the row is weight-edited. Add a regression test: set per-key leverage only → Save → reopen → leverage survives.
**Warning signs:** Reopened saved scenario shows per-key leverage reset to 1×.

### Pitfall 2: Weight edit renormalizes the wrong basis
**What goes wrong:** Using `setWeightOverride(api_key_id, w)` renormalizes over `enabledIdsOf` (added + holding refs), which excludes per-key units → the blend no longer reflects the typed weight, and sum-to-1 breaks across the mixed set (the #528 apply-back drift class).
**How to avoid:** Route per-key (and mixed) weight edits through the explicit engine-unit basis (WR-01). Cross-check `member_ids` vs `coverageEligible` (the existing dev cross-check) after an edit.
**Warning signs:** Typed 30% renders as a different blend share; weights don't sum to 100%.

### Pitfall 3: Accidentally reintroducing a symbol-keyed engine path
**What goes wrong:** Attaching weight to a coin/symbol instead of the `api_key_id` engine unit re-creates the removed symbol-keyed builder + alias collapse (`ScenarioComposer.tsx:37,2276-2280`), which the CONSTIT-04 grep gate + SC-3 freeze forbid.
**How to avoid:** Key every weight/leverage strictly by engine unit id (`api_key_id` or strategy UUID). Never touch `scenario.ts`.
**Warning signs:** `scenario-backbone-gates.test.ts` red; `git diff --exit-code src/lib/scenario.ts` dirty.

### Pitfall 4: A schema_version bump that deletes drafts
**What goes wrong:** Treating per-key `api_key_id` entries in `weightOverrides` as a new SHAPE and bumping `SCENARIO_SCHEMA_VERSION` (`scenario-state.ts:79`) would drop older drafts on load.
**How to avoid:** No bump. `weightOverrides` is an existing required field; `leverageOverrides` is existing optional+additive. New per-key entries are new VALUES in existing maps, not new shape. Follows the 111-05 accepted-transient reasoning (per-key `toggleByScopeRef` entries did not bump version; localStorage-only, self-healing).

## Runtime State Inventory

> Phase 112 is client UI + client-state wiring. Runtime state surfaces:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `scenarios.draft` jsonb holds `weightOverrides` (required) + `leverageOverrides` (optional). Per-key `api_key_id` weight entries are NEW VALUES in the existing `weightOverrides` map. | Code edit only — no data migration; no `schema_version` bump. Old drafts (no per-key weights) load unchanged and default per-key to raw equity-share. |
| Live service config | None — no external service embeds this state. | None |
| OS-registered state | None. | None — verified (pure browser/client + Next.js route). |
| Secrets/env vars | None. | None |
| Build artifacts / migrations | No DDL. No Supabase migration. No test-project migration (`qmnijlgmdhviwzwfyzlc`) needed — the jsonb shape is unchanged. | None — verified (no `.sql` in scope). |

## Code Examples

### The reference implementation to mirror onto per-key rows (added-row weight + leverage inputs)
```tsx
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:4969-4995
<input id={`weight-${a.id}`} type="number" step="0.001" min="0" max="1"
  value={weight.toFixed(3)} disabled={!enabled}
  onChange={(e) => onSetWeight(a.id, Number(e.target.value))} /* → handleWeightChange → setWeightOverride */ />
<input id={`leverage-${a.id}`} type="number" step="0.1" min="0" max={MAX_LEVERAGE}
  value={(leverageByRef[a.id] ?? 1).toString()} disabled={!enabled}
  title="Leverage multiplier (1× = unlevered; excludes borrow cost)"
  onChange={(e) => onSetLeverage(a.id, Number(e.target.value))} /* → handleLeverageChange */ />
```

### The engine-unit weight basis (WR-01) — the correct sum-to-1 renormalization
```tsx
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:4048-4051
const basisIds = engineSet.strategies
  .filter((s) => engineSet.state.selected[s.id])
  .map((s) => s.id);            // per-key api_key_ids + enabled added ids
scenario.applyWeightOverrides(weights, basisIds); // single-pass renorm over the mixed universe
```

### Leverage sanitize-on-read (never a zod refine)
```ts
// Source: src/lib/leverage.ts:79-97 — mirrors engine lev(); adds MAX_LEVERAGE ceiling
const out = Number.isFinite(v) && v >= 0 ? Math.min(MAX_LEVERAGE, v) : 1;
// GUARD: NEVER a zod .min/.max refine — a refine failure resets → deletes the draft.
```

### Engine leverage application (frozen — read-only, for reference)
```ts
// Source: src/lib/scenario.ts:424-430 — leverage amplifies numerator, renorm by UN-levered mass
r += w * lev(s.id) * strategyReturns[s.id][i];
activeWeightSum += w;
// portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (+ `@vitest/coverage-v8` 4.1.10) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations --no-file-parallelism` |
| Full suite command | `npm test` (sharded in CI with `--coverage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WEIGHTS-01 | Per-key + added weights renormalize to sum-1 over the engine-unit basis; per-key exclusion shrinks the denominator | unit | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-state.test.ts` | ✅ (extend) |
| WEIGHTS-01 | Per-key row renders a weight input; typed weight reaches `projectionState`/blend | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend) |
| WEIGHTS-02 | Per-row leverage re-derives the blend (`wᵢ·Lᵢ·rᵢ`) | unit | `npx vitest run src/lib/scenario.test.ts` (behavior pin, engine unchanged) | ✅ |
| WEIGHTS-02 | Bad leverage value cannot delete the draft (sanitize-on-read) | unit | `npx vitest run src/lib/leverage.test.ts` + codec round-trip in `scenario-state.test.ts` | ✅ (extend) |
| WEIGHTS-02 | Per-key leverage survives Save→reopen (prune fix) | component | `ScenarioComposer.test.tsx` (new) | ❌ Wave 0 |
| SC-3 freeze | `scenario.ts` byte-frozen | gate | `git diff --exit-code src/lib/scenario.ts` + `npx vitest run src/lib/scenario-backbone-gates.test.ts` | ✅ |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file> --no-file-parallelism`
- **Per wave merge:** `npx vitest run src/app/\(dashboard\)/allocations src/lib/scenario.test.ts src/lib/leverage.test.ts`
- **Phase gate:** full suite green + `git diff --exit-code src/lib/scenario.ts` clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `ScenarioComposer.test.tsx` — per-key row renders weight + leverage inputs; per-key weight reaches the blend; per-key leverage survives Save→reopen (prune fix).
- [ ] `scenario-state.test.ts` — sum-to-1 across mixed per-key + added via the engine-unit basis; RED-proof the invariant fails without the basis fix.
- [ ] No new framework install — Vitest already present.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ✅ **RESOLVED 2026-07-17 — Option A LOCKED (founder).** The founder confirmed **Route 1** in their own terms: `equity × (leverage × dailies)` — leverage amplifies each constituent's *return series* (levered legs show genuinely higher return AND drawdown), while the blend weight stays the **equity-capital share**. This is exactly what the frozen engine does today (`scenario.ts:426` `w·L·r`, `w` = equity share). **Notional = equity × L is a pure read-only readout** ("only informative — helps understand whether we clear minimum-invest"), NOT a weight basis. Route 2 (`notional × dailies`, notional-as-weight) is explicitly rejected — the founder does not want leverage to silently re-weight the book, and it would need an engine change (SC-3 forbids). Columns: `{equity-share weight (editable)} × {leverage (editable)} → {notional (derived, read-only, informative)}`. | Semantic model | RESOLVED — no engine change; SC-3 stays frozen. |
| A2 | "Strategy-level row" in 112 = one `api_key_id` per row (per-key granularity); true multi-key stitching is deferred to 115. | Collapse recipe | MEDIUM — if 112 is expected to stitch multi-key strategies, scope expands into STITCH territory. |
| A3 | No `schema_version` bump is needed (per-key weight entries are new values in the existing `weightOverrides` map). | Pitfall 4 | LOW — if a reviewer insists on a bump, the non-destructive upgrade branch pattern exists (`scenario-state.ts:1002-1046`). |

## Open Questions (RESOLVED)

1. **Where does the levered-KPI / notional panel live, and does 112 add one at all?** — ✅ **RESOLVED (founder, 2026-07-17).** 112 ships the per-row weight + leverage inputs **PLUS** a derived read-only notional (equity × L) column with the honest Sharpe/Sortino/Calmar leverage-invariance caveat. Notional is purely informative (clears-minimum-invest readout — A1). The editable-MaxDD column + two-way max-DD↔leverage coupling are Phase 113 (WEIGHTS-03/04), explicitly OUT of scope here. Ties to Assumptions-Log A1 (Option A locked).

2. **Include/exclude semantics for a WEIGHTED per-key row.** — ✅ **RESOLVED.** Preserve the typed per-key weight on exclude and restore on re-include (mirror `toggleHolding`'s preserve-and-restore, `scenario-state.ts:347-395`), renormalizing over the engine-unit basis. Implemented + tested in the plans (00·T1(d)/T2(d) RED, 01 restore path); `togglePerKeySource` stays the include/exclude channel with weight math moved off its DELETE-on-re-include semantics.

## Project Constraints (from CLAUDE.md / AGENTS.md)
- Coverage is a BLOCKING CI gate (lines 82 / stmts 80 / funcs 74 / branches 72). New UI + state must carry tests or coverage regresses.
- DESIGN.md governs all visual/UI decisions — read before adding the weight/leverage inputs (Numbers Contract, sign rule, em-dash null rule). Reuse the existing input styling from the added rows.
- AGENTS.md: this is a customized Next.js — read `node_modules/next/dist/docs/` before writing any Next.js-specific code (this phase is a client component, minimal Next surface).
- Feature-branch + PR; `/ship` to commit; never commit from main.
- Regression-first: every found/guarded behavior gets a test that fails without the fix (RED-proof the weight-basis and prune fixes).

## Sources

### Primary (HIGH confidence)
- `src/lib/scenario.ts:100-138,300-444,583-623` — frozen engine: `state.leverage`, `wᵢ·Lᵢ·rᵢ` blend, correlation from unlevered series, leverage-invariance.
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — `weightOverrides`, `leverageOverrides`, `clampAllWeights`, `enabledIdsOf`, `togglePerKeySource`, `setWeightOverride`, `applyWeightOverrides`, `setLeverageOverrides`, codec/schema.
- `src/lib/leverage.ts` — `MAX_LEVERAGE`, `sanitizeLeverage`/`sanitizeLeverageMap`, no-refine guard.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:720-734,872,1037-1098,2054-2095,2229-2286,4031-4053,4446-4457,4785-5011` — per-key/engine-unit build, projectionState wiring, CompositionList render (per-key fence + added inputs), prune-at-save, optimizer basis.
- `src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx` — atomic apply-back contract.
- `DESIGN.md:148-164` — Numbers Contract.
- `.planning/phases/111-.../111-03-SUMMARY.md`, `111-05-SUMMARY.md` — CONSTIT-03 collapse, CF-05 supersession, honest Commit gate, accepted schema-version transient.
- `.planning/ROADMAP.md:119-146`, `.planning/REQUIREMENTS.md:34-38` — 112 success criteria + WEIGHTS-01/02 scope.

### Secondary (MEDIUM confidence)
- MEMORY `project_v1_11_weights_leverage_maxdd_spec`, `project_v1_11_allocator_is_a_strategy_unified_pipeline` — Notional=equity×L, leverage-invariance, multi-key = Phase 115.

## Metadata

**Confidence breakdown:**
- Existing-infra map: HIGH — every claim traced to file:line in the working tree.
- Weight-sum basis recipe: HIGH — the WR-01 pattern is already implemented and tested.
- Semantic model (Option A): HIGH on what the engine does; the founder-confirmation is a product decision (A1), not a code uncertainty.
- Levered-KPI honesty: HIGH — engine leverage-invariance is explicit in code + comments.

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (stable — no external deps; engine frozen).

## RESEARCH COMPLETE
