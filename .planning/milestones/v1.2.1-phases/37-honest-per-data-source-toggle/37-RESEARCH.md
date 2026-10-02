# Phase 37: Honest per-data-source toggle - Research

**Researched:** 2026-06-25
**Domain:** Client-side scenario-blend recompute over a frozen TS engine (Next.js + TypeScript). No new libraries, no network, no DB schema change.
**Confidence:** HIGH — this is a focused refactor over well-understood, heavily-pinned in-repo code. Every seam below was read directly in this session (file + line), not assumed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Data-source toggle model & scope**
- Unit = one toggle per connected exchange `api_key` (the same blend unit Phase 36's Overview uses). Not per venue, not per holding.
- Book mode only. Blank mode has no live book / no live keys. The existing `entryMode` switch already gates the live book; the toggle lives behind the same gate.
- Default state = all sources included (identical to today's full-book projection — a no-op until the user actually excludes a key).
- Fallback (Phase 36 D3): when per-key dailies do NOT cover all eligible keys, HIDE the toggle and show a short honest note that per-source modeling needs per-key history; the composer stays on the existing blended baseline. Mirrors the Overview's all-or-nothing per-key gate — never mix two bases in one curve.

**Area 2 — Recompute semantics & honesty**
- Instant recompute on every toggle, via the SAME client-side adapter + frozen `computeScenario` path that weight/leverage overlays already use (no debounce in v1).
- Both the equity curve AND every KPI (Sharpe / volatility / max-drawdown / return / avg-ρ) recompute from the remaining per-key series. This is the DSRC-03 honesty core.
- When ALL sources are excluded → honest empty/zeroed projection state with a "select at least one data source" message. Never a stale or last-known blended number. Do not hard-block the last toggle-off; show the honest empty instead.
- Re-normalize remaining keys' weights to sum to 1 when a source is excluded (drop the excluded key's weight share); the curve is anchored to the remaining keys' AUM share. Per-key weight source is each key's current equity share (Phase 36 D2), grouped by `api_key_id` — no new weight source.

**Area 3 — Toggle UI placement & labeling**
- A compact "Data sources" control near the top of the composer, one row per key. (Exact visuals → 37-UI-SPEC.md.)
- Label = exchange display name + key nickname (e.g. "Binance — Main"); fall back to a masked key identifier when no nickname exists.
- Minimal v1: name + include/exclude only. No per-source sparkline/contribution-% in v1.
- Toggle state is ephemeral (like the R4 leverage overlay): held in component state, NOT persisted to the saved-scenario draft, NOT part of any commit diff. Resets on reload.

### Claude's Discretion
- Exact payload seam for exposing the per-key series + eligibility: add `perKeyReturnsByApiKeyId` (and the gate boolean / eligible-key ids) to `MyAllocationDashboardPayload`, OR a narrower composer-specific projection. Keep the smallest diff that does not disturb the existing `liveBaselineMetrics` / `holdingReturnsByScopeRef` contract (Phase 36 pinned those byte-identical).
- Adapter seam: a new per-key code path in `buildStrategyForBuilderSet` vs a sibling builder selected by the D3 gate. Prefer smallest diff; frozen `scenario.ts` engine (SCENARIO-05) must NOT be forked.
- How the toggle state threads into `projectionState` (the existing memo that overlays weight/leverage/selected already has a `selected` channel — per-key exclusion likely rides that same channel keyed by api_key unit).
- Whether per-key weights re-normalize inside the adapter or in the composer's `projectionState` overlay.

### Deferred Ideas (OUT OF SCOPE)
- Per-source contribution-% / sparkline in toggle rows — v2.
- Persisting toggle state to the saved-scenario draft — deferred (ephemeral in v1).
- Composer factsheet-parity chart + blank-mode equity fix — Phase 38.
- Debounced recompute — only if instant recompute proves janky at scale (not expected).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support |
|----|-----------------------------------|------------------|
| DSRC-01 | The scenario adapter (`scenario-adapter.ts`) keys its projection units per `api_key` (per data source) rather than per blended book. | A new sibling per-key path in `buildStrategyForBuilderSet` (or a sibling builder) that emits one `StrategyForBuilder` whose `id = api_key_id`, mirroring the verified `liveBaselineMetricsFromPerKeyDailies` (queries.ts:2248–2353). Keeps the B4 positional signature. See §Architecture Pattern 2. |
| DSRC-02 | The composer surfaces a per-data-source toggle UI letting an allocator include/exclude each API key from the projection. | Render a "Data sources" group (per 37-UI-SPEC) gated on `entryMode === "book"` AND the D3 gate. Toggle writes to an ephemeral `useState<Record<api_key_id, boolean>>` (mirror of the R4 `leverageByRef` pattern, ScenarioComposer.tsx:515). Labels from `payload.apiKeys[].exchange + .label` (queries.ts:1558–1573). See §Architecture Pattern 3. |
| DSRC-03 | Excluding a key honestly recomputes the curve and KPIs from the remaining per-key series — never a cosmetic hide over an unchanged blended number. | The frozen engine ALREADY does honest recompute: `selected[id]=false` removes the strategy from `activeStrategies` (scenario.ts:154–176), and the portfolio loop renormalizes per-day by `r / activeWeightSum` over the SELECTED set only (scenario.ts:240–255). So threading `selected[api_key_id]=false` through `projectionState` → collapse → `computeScenario` is a TRUE recompute with no manual renormalization. See §Pattern 3 + §Pitfall 1. |
</phase_requirements>

## Summary

Phase 37 is a **client-side blend re-key**, not a new feature integration. Phase 36 already built and pinned every hard part: the per-`api_key` blend helper (`liveBaselineMetricsFromPerKeyDailies`), the D3 all-or-nothing eligibility gate (`allActiveKeysHavePerKeyDailies` + `isPerKeyDailiesEligibleKey`), and the row grouper (`buildPerKeyReturnsByApiKeyId`) — all in `src/lib/queries.ts:2248–2427`, all exported for testing. Phase 36 computes `perKeyReturnsByApiKeyId` inside `getMyAllocationDashboard` but **never returns it in the payload** (it only flows the derived `liveBaselineMetrics` out). Phase 37's job: (1) expose the per-key series + the D3 gate result + eligible-key ids on the payload, (2) re-key the client adapter to build one projection unit per `api_key` from that series, (3) wire an ephemeral per-key include/exclude toggle into the existing `projectionState` memo's `selected` channel, and (4) let the frozen engine do the honest recompute.

The honesty requirement (DSRC-03) is **already structurally guaranteed by the frozen engine**: `computeScenario` filters to `state.selected[id]===true` strategies and renormalizes the weighted-return sum per day over only the selected set (`portDaily[i] = r / activeWeightSum`, scenario.ts:254). Excluding a key by setting `selected[api_key_id]=false` therefore produces a genuinely different curve, Sharpe, vol, maxDD, return, AND avg-ρ — never a cosmetic hide. **No manual weight re-normalization is needed** in the adapter or overlay; the engine's `normWeight` (scenario.ts:181) divides by the selected-set weight mass. The all-excluded case is also already handled: `computeScenario` returns all-null KPIs + empty curve when `activeIds.length === 0` (scenario.ts:157–174).

**Primary recommendation:** Add three payload fields (`perKeyReturnsByApiKeyId`, `perKeyDailiesGateSatisfied`, `eligibleApiKeyIds`) to `MyAllocationDashboardPayload` at BOTH return sites (queries.ts:3122 `!portfolio` branch and :3437 main branch); add a sibling per-key builder beside `buildStrategyForBuilderSet` (smallest diff, keeps B4 signature untouched and the H-0132 commit round-trip tests green); render the gated "Data sources" control with an ephemeral toggle map; thread it into `projectionState`'s `selected` channel keyed by `api_key_id`. Re-normalization rides the engine — do not duplicate it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-key `(date, daily_return)` series fetch + group | API/SSR (`getMyAllocationDashboard`) | — | Already fetched at SSR (`csv_daily_returns` parallel read, queries.ts:2727); grouped by `buildPerKeyReturnsByApiKeyId` (:3075). Only the payload exposure is new. |
| D3 eligibility gate (all-or-nothing) | API/SSR | — | Computed at SSR (:3086–3090). Phase 37 exposes the boolean + eligible ids; the client only READS it (never re-derives the predicate — the Python backfill is SoT). |
| Per-`api_key` projection unit keying (DSRC-01) | Browser/Client (`scenario-adapter.ts`) | — | The adapter is the pure client projection layer; toggle state is client-only, so the per-key unit set must be built client-side. |
| Per-source toggle UI + ephemeral state (DSRC-02) | Browser/Client (`ScenarioComposer.tsx`) | — | Ephemeral what-if overlay (mirrors R4 leverage `useState`); never persisted, never SSR. |
| Honest recompute of curve + KPIs (DSRC-03) | Browser/Client (frozen `computeScenario`) | — | The frozen engine renormalizes over the selected set per-day; client invokes it after the de-alias collapse, identical to weight/leverage overlays. |
| Curve USD scale anchor (AUM) | API/SSR | — | AUM stays `Σ holdingEquityContribution` (D2, unchanged). The client recompute is shape+KPI only; the USD anchor remains the live book value. |

## Standard Stack

**No new packages.** This phase is a pure refactor over existing in-repo modules + existing UI primitives. Every dependency below is already installed and load-bearing in the composer today.

### Core (existing, reused verbatim)
| Module | Location | Purpose | Why standard |
|--------|----------|---------|--------------|
| `computeScenario` | `src/lib/scenario.ts:149` | FROZEN blend engine (SCENARIO-05). Renormalizes over selected set; returns null KPIs on degenerate/empty. | The single compute path; forking it is forbidden. |
| `buildStrategyForBuilderSet` | `src/app/(dashboard)/allocations/lib/scenario-adapter.ts:87` | Pure projection: holdings/added → `StrategyForBuilder[]` + `ScenarioState`. B4-pinned positional signature. | The existing adapter seam; DSRC-01 re-keys its units. |
| `liveBaselineMetricsFromPerKeyDailies` | `src/lib/queries.ts:2248` | Phase-36 SSR per-key blend. The exact template for the client per-key builder. | Already proves one-`StrategyForBuilder`-per-`api_key_id`, weight = equity-share, no alias collapse needed. |
| `buildPerKeyReturnsByApiKeyId` | `src/lib/queries.ts:2413` | Groups raw `csv_daily_returns` rows → `Record<api_key_id, DailyPoint[]>`. | Reuse verbatim to shape the payload field. |
| `allActiveKeysHavePerKeyDailies` | `src/lib/queries.ts:2362` | D3 all-or-nothing gate. | Already selects per-key vs snapshot baseline; gate result is what the toggle visibility keys on. |
| `isPerKeyDailiesEligibleKey` | `src/lib/queries.ts:2397` | Active-key predicate mirroring the Python backfill. | Defines `eligibleApiKeyIds`; must NOT be re-derived client-side. |
| `collapseAliasedHoldingStrategies` | `src/lib/scenario-dealias.ts:60` | Multi-venue symbol-alias collapse before the engine. | Per-key units are NOT symbol-keyed → they pass through untouched (see §Pitfall 3). Keep it in the pipeline unchanged. |

### Supporting (existing UI primitives, per 37-UI-SPEC)
| Primitive | Location | Use case |
|-----------|----------|----------|
| `InfoBanner` | `src/components/ui/InfoBanner.tsx` | The D3-fallback honest note (`border-accent/30 bg-accent/5`, calm, no `role="alert"`). |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | The all-excluded honest empty state (heading + body, neutral muted, no red). |
| Entry-mode segmented/pill recipe | `ScenarioComposer.tsx:~1686–1714` | The toggle visual recipe (`border-accent text-accent`, no fill) reused per UI-SPEC §2. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New sibling per-key builder | A new per-key code path INSIDE `buildStrategyForBuilderSet` | A new branch inside the B4 function risks the H-0132 commit round-trip oracle tests (scenario-adapter.test.ts:415–588) which pin `state.weights`/`state.selected` keyed on `buildHoldingRef(h)`. A SIBLING function (e.g. `buildPerKeyStrategyForBuilderSet`) keeps the holdings signature byte-identical and isolates per-key keying — **recommended, smallest blast radius**. |
| Ephemeral `useState` toggle map | Persisting toggle to `scenario.draft.toggleByScopeRef` | CONTEXT Area 3 LOCKS ephemeral. Reusing `toggleByScopeRef` would leak the toggle into the persisted draft + commit diff (`getEnabledRefs`, scenario-state.ts:213) — violates the lock. Use a fresh `useState` mirroring `leverageByRef` (ScenarioComposer.tsx:515). |
| Engine-native renormalization | Manual weight renorm in the overlay | The engine already divides by `activeWeightSum` over the selected set (scenario.ts:254). Manual renorm would DOUBLE-normalize. Do nothing; let the engine renormalize. |

**Installation:** none.

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** It is a refactor over existing in-repo TypeScript modules and existing UI primitives (`InfoBanner`, `EmptyStateCard`). No `npm install`, no registry fetch, no new dependency. The Package Legitimacy Gate is not triggered.

## Architecture Patterns

### System Architecture Diagram

```
                                getMyAllocationDashboard (SSR, queries.ts)
                                            |
        ┌───────────────────────────────────┼──────────────────────────────────────┐
        │ parallel fetch fan-out (~2650)                                             │
        │   csv_daily_returns per-key rows ──► buildPerKeyReturnsByApiKeyId (:3075)  │
        │                                       └─► perKeyReturnsByApiKeyId          │
        │   apiKeys ──► filter(isPerKeyDailiesEligibleKey) ─► eligibleApiKeyIds(:3086)│
        │   allActiveKeysHavePerKeyDailies(...) ─► gateSatisfied (:3090)             │
        │                                                                            │
        │   liveBaselineMetrics (UNCHANGED — Phase 36 pinned byte-identical)         │
        │   holdingReturnsByScopeRef (UNCHANGED)                                     │
        └───────────────────────────────────┬──────────────────────────────────────┘
                                             │  PHASE 37 ADDS 3 fields to BOTH returns
                                             ▼  (:3122 !portfolio  AND  :3437 main)
                     MyAllocationDashboardPayload {
                        + perKeyReturnsByApiKeyId: Record<api_key_id, DailyPoint[]>
                        + perKeyDailiesGateSatisfied: boolean
                        + eligibleApiKeyIds: string[]
                        apiKeys, holdingsSummary(api_key_id), liveBaselineMetrics, ...
                     }
                                             │
                                             ▼  (client, ScenarioComposer.tsx)
   entryMode==="book" && gateSatisfied ?  RENDER "Data sources" control (per key row)
                                        :  HIDE (InfoBanner honest note OR nothing in blank)
                                             │
                          ephemeral useState<Record<api_key_id, bool>>  (toggle)
                                             │
                                             ▼
   buildPerKeyStrategyForBuilderSet(perKeyReturnsByApiKeyId, equityByApiKeyId)  ◄─ DSRC-01
        └─► strategies[] (id = api_key_id), state{selected,weights,startDates}
                                             │
                                             ▼  projectionState memo (~1238)
        selected[api_key_id] = toggleMap[id] ?? true   ◄─ DSRC-02 (rides selected channel)
                                             │
                                             ▼
        collapseAliasedHoldingStrategies (per-key units pass through untouched)
                                             │
                                             ▼
        computeScenario(...)  ─► filters to selected; renorm r/activeWeightSum  ◄─ DSRC-03
                                             │
                        ┌────────────────────┴─────────────────────┐
                        ▼                                           ▼
            equity_curve + KPIs (recomputed)        all-excluded → null KPIs + []
            → KpiStrip / EquityChart / Drawdown      → EmptyStateCard honest empty
```

### Component Responsibilities
| File | Responsibility in Phase 37 |
|------|---------------------------|
| `src/lib/queries.ts` | Expose `perKeyReturnsByApiKeyId` + `perKeyDailiesGateSatisfied` + `eligibleApiKeyIds` on `MyAllocationDashboardPayload` (type ~1493) and BOTH return sites (:3122, :3437). NO change to `liveBaselineMetrics` / `holdingReturnsByScopeRef` derivation. |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` | Add a sibling per-key builder (DSRC-01). Do not touch `buildStrategyForBuilderSet`. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Render gated "Data sources" control (DSRC-02); ephemeral toggle `useState`; thread into `projectionState.selected` (DSRC-03); all-excluded → EmptyStateCard; fallback → InfoBanner. |

### Pattern 1: Additive payload exposure (smallest diff, keeps Phase 36 pins)
**What:** Add new payload fields; never repoint existing ones.
**When to use:** Always for this phase — the lock requires `liveBaselineMetrics` + `holdingReturnsByScopeRef` byte-identical.
**Example:**
```typescript
// Source: queries.ts:2413 (buildPerKeyReturnsByApiKeyId already exists)
// In getMyAllocationDashboard, perKeyReturnsByApiKeyId + eligibleKeyIds are
// ALREADY computed (:3075–3088). Phase 37 only adds them (plus the gate bool)
// to the return objects. Both the !portfolio branch (:3122) and the main
// branch (:3437) must carry them — the payload is an additive contract.
const perKeyDailiesGateSatisfied = allActiveKeysHavePerKeyDailies(
  eligibleKeyIds, perKeyReturnsByApiKeyId,
);
return {
  ...existingFields,
  perKeyReturnsByApiKeyId,        // Record<api_key_id, DailyPoint[]>
  perKeyDailiesGateSatisfied,     // boolean (D3 gate)
  eligibleApiKeyIds: eligibleKeyIds,
};
```
**Note:** The gate boolean is currently inline (`allActiveKeysHavePerKeyDailies(...)` is called once at :3090 in a ternary). Hoist it into a `const` so it can be both selected on AND returned — a one-line refactor, no behavior change.

### Pattern 2: Sibling per-key builder (DSRC-01)
**What:** A new pure function beside `buildStrategyForBuilderSet`, NOT a branch inside it.
**When to use:** The per-key unit set is structurally different (id = api_key_id, no warm-up holding flatMap, no added-strategy lookup, weight = equity-share). A sibling avoids touching the B4 signature and the H-0132 commit oracle tests.
**Example:**
```typescript
// Source: mirrors queries.ts:2248–2353 (liveBaselineMetricsFromPerKeyDailies),
// but client-side and returning { strategies, state } for the composer to
// overlay + collapse + computeScenario (NOT the metrics directly).
export function buildPerKeyStrategyForBuilderSet(
  perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>,
  equityByApiKeyId: Record<string, number>,   // Σ holdingEquityContribution per key
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const strategies: StrategyForBuilder[] = [];
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  for (const [apiKeyId, returns] of Object.entries(perKeyReturnsByApiKeyId)) {
    if (!returns || returns.length === 0) continue;
    strategies.push({
      id: apiKeyId, name: `key ${apiKeyId}`, codename: null,
      disclosure_tier: "exploratory", strategy_types: [], markets: [],
      start_date: returns[0]?.date ?? null, daily_returns: returns,
      cagr: null, sharpe: null, volatility: null, max_drawdown: null,
    });
    selected[apiKeyId] = true;                     // default included (Area 1)
    weights[apiKeyId] = Math.max(0, equityByApiKeyId[apiKeyId] ?? 0); // D2 equity share
    startDates[apiKeyId] = returns[0]?.date ?? "2022-01-01";
  }
  return { strategies, state: { selected, weights, startDates } };
}
```
**Key parallels to verify against the SSR helper:** clamp negative equity to 0 (queries.ts:2315); `disclosure_tier: "exploratory"`; the engine renormalizes weights so they need NOT sum to 1 here (raw equity-share USD is fine — `normWeight` divides by `totalWeight`, scenario.ts:181).

### Pattern 3: Ephemeral toggle → `projectionState.selected` (DSRC-02 + DSRC-03)
**What:** An ephemeral `useState<Record<string, boolean>>` keyed by `api_key_id`, overlaid onto the per-key strategies' `selected` in the existing `projectionState` memo.
**When to use:** The composer already overlays draft `selected`/`weight`/`leverage` in `projectionState` (ScenarioComposer.tsx:1238–1265). Per-key exclusion rides the SAME `selected` channel — exactly the planner's hypothesis.
**Example:**
```typescript
// Source: ScenarioComposer.tsx:515 (leverageByRef ephemeral pattern) + :1238
const [includeByApiKeyId, setIncludeByApiKeyId] =
  useState<Record<string, boolean>>({});   // default {} = all included

// inside projectionState memo, for the per-key strategy set:
selected[s.id] = includeByApiKeyId[s.id] ?? true;   // s.id === api_key_id
// weights[s.id] = adapterOutput.state.weights[s.id];  (engine renormalizes)
// → collapse (per-key units pass through) → computeScenario renormalizes the
//   SELECTED set per day → honest recompute. Excluding drops the key from
//   activeStrategies (scenario.ts:176) and from the weight mass (scenario.ts:254).
```
**Why this is honest, not cosmetic (DSRC-03):** `computeScenario` builds `activeStrategies = strategies.filter(s => state.selected[s.id])` (scenario.ts:176), then for each day sums `w·L·r` over active strategies and divides by `activeWeightSum` (scenario.ts:240–254). An excluded key contributes ZERO to both numerator and denominator — the remaining keys' weights are renormalized automatically. The curve, Sharpe, vol, maxDD, return, and avg-ρ (over the remaining selected keys, scenario.ts:431) all change. This is a real blend recompute.

### Anti-Patterns to Avoid
- **Forking `computeScenario` or `collapseAliasedHoldingStrategies`** to "filter excluded keys" — the engine already filters on `selected`. Forking violates SCENARIO-05.
- **Manual weight renormalization** in the adapter/overlay after exclusion — the engine's `r / activeWeightSum` already renormalizes. Doubling it skews the curve.
- **Reusing `scenario.draft.toggleByScopeRef`** for the per-key toggle — it is persisted + feeds the commit diff. Use a fresh ephemeral `useState`.
- **Re-deriving the D3 predicate client-side** — `isPerKeyDailiesEligibleKey` mirrors the Python backfill (SoT). Read `perKeyDailiesGateSatisfied` from the payload; never recompute eligibility in the browser.
- **Hard-blocking the last toggle-off** — Area 2 LOCKS: fall through to the honest empty (`computeScenario` returns null KPIs + `[]` when `activeIds.length===0`, scenario.ts:157), render `EmptyStateCard`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Weight renormalization on exclusion | A renorm pass over remaining keys | `computeScenario`'s `r / activeWeightSum` (scenario.ts:254) | Engine already does per-day renorm over the selected set; hand-rolling double-normalizes. |
| Empty/zeroed projection when all excluded | A custom "if all off, zero KPIs" branch | `computeScenario`'s `activeIds.length===0` early-return (scenario.ts:157–174) | Engine already returns all-null + empty curve; the composer's existing degenerate-blend "—" convention handles display. |
| Per-key series grouping | A new `groupBy(api_key_id)` | `buildPerKeyReturnsByApiKeyId` (queries.ts:2413) | Already handles null api_key_id + non-finite daily_return drops. |
| D3 eligibility predicate | A client-side `is_active && ...` filter | `eligibleApiKeyIds` + `perKeyDailiesGateSatisfied` from payload | The predicate is the Python backfill's SoT mirror; drift = silent fallback-forever bug. |
| avg-ρ across keys | A custom correlation fold | `computeScenario`'s `avg_pairwise_correlation` (scenario.ts:431) | Engine computes it over the selected set; excluding a key changes it honestly. |
| Honest-absence note/empty UI | New banner/card components | `InfoBanner` + `EmptyStateCard` (src/components/ui/) | Already the pinned honest-absence shells (no `role="alert"`, no red). |

**Key insight:** Nearly every "hard part" of an honest per-source recompute was already solved by the frozen engine (renormalization, degenerate handling, correlation) and by Phase 36's helpers (grouping, gate, per-key blend). Phase 37 is wiring, not algorithm-building. The single biggest correctness win is *resisting the urge to renormalize* — the engine owns it.

## Common Pitfalls

### Pitfall 1: Double-normalizing weights after exclusion
**What goes wrong:** Excluding a key and ALSO renormalizing remaining weights to sum to 1 in the overlay yields a curve scaled wrong (the engine then renormalizes again over the already-renormalized set).
**Why it happens:** Area 2 says "re-normalize remaining keys' weights to sum to 1" — read as an instruction to the engine, not to the overlay.
**How to avoid:** Pass raw equity-share weights; set `selected[id]=false` for excluded keys; let `computeScenario` (scenario.ts:254) renormalize. Verify with the DSRC-03 honesty test (below): excluding the larger-equity key must shift the blend toward the remaining key's return profile.
**Warning signs:** Curve level/shape changes by a factor unrelated to the excluded key's return; KPIs that don't match a hand-computed two-key blend.

### Pitfall 2: Forgetting the `!portfolio` return branch
**What goes wrong:** Adding the new payload fields only at the main return (:3437) leaves `MyAllocationDashboardPayload` requiring fields the `!portfolio` branch (:3122) doesn't supply → TS error or runtime `undefined` for fresh allocators.
**Why it happens:** Two return sites in one function; easy to patch only the obvious one.
**How to avoid:** Patch BOTH return objects (queries.ts:3122 and :3437). The `!portfolio` branch already carries `liveBaselineMetrics` + `holdingReturnsByScopeRef` — add the three new fields there too (with `perKeyReturnsByApiKeyId` likely `{}` / gate `false` when no portfolio/holdings).
**Warning signs:** `getMyAllocationDashboard.scenario.test.ts` payload-shape assertions go red for the fresh-allocator fixture.

### Pitfall 3: Running the symbol-alias collapse over per-key units
**What goes wrong:** `collapseAliasedHoldingStrategies` groups by bare SYMBOL via `symbolByHoldingId` (scenario-dealias.ts:73–83). Per-key unit ids are `api_key_id` UUIDs, NOT in `symbolByHoldingId`, so they fall to `passthrough` (line 76–78) — correct. But if a future change maps api_key_id → symbol, identical-symbol keys would be wrongly merged.
**Why it happens:** The composer pipeline always runs the collapse before the engine (ScenarioComposer.tsx:1273).
**How to avoid:** Keep per-key unit ids OUT of `symbolByHoldingId` (only holdings populate it, ScenarioComposer.tsx:1208–1218). A per-key unit is ALREADY a single blended series per key (queries.ts:2234 documents this) — no symbol-alias risk. Add a test asserting two per-key units with the same underlying symbol exposure are NOT collapsed.
**Warning signs:** avg-ρ across keys reports a fabricated 1.0; the per-key strategy count drops after collapse.

### Pitfall 4: avg-ρ honesty when a per-key unit is itself a blended series
**What goes wrong:** Each per-key unit's `daily_returns` is the key's whole-account realized+funding daily series — itself a blend across that key's symbols. avg-ρ across keys is a correlation of *account-level* series, which is honest BUT semantically different from per-symbol ρ. Presenting it without that framing could mislead.
**Why it happens:** The KPI label "avg pairwise correlation" is reused from the per-holding path where units were per-symbol.
**How to avoid:** This is a *labeling/disclosure* concern, not a math bug — the number is honest for what it measures (cross-key correlation). Flag for the planner: confirm the existing KPI caveat copy still reads correctly for per-key units, or whether a one-line "across data sources" qualifier is warranted. `[ASSUMED]` that the existing label is acceptable; surface in discuss if not. The Overview already ships this exact avg-ρ basis (Phase 36), so it is consistent with the rest of the product.
**Warning signs:** User confusion that "correlation" means symbol-level when it's key-level.

### Pitfall 5: Toggle state surviving into the commit diff or saved draft
**What goes wrong:** If the toggle writes to `scenario.draft.toggleByScopeRef`, the excluded key leaks into `getEnabledRefs` (scenario-state.ts:213) and the commit payload — violating the ephemeral lock and potentially committing a "remove this data source" decision.
**Why it happens:** `toggleByScopeRef` is the obvious existing toggle channel.
**How to avoid:** Use a separate ephemeral `useState` (mirror `leverageByRef`, ScenarioComposer.tsx:515). Add a test asserting toggling a source off produces NO change in `scenario.diffCount` / commit diffs.
**Warning signs:** `diffCount` increments on a data-source toggle; a `voluntary_remove` diff appears for a key.

### Pitfall 6: Per-key fetch window cap vs the composer's expectation
**What goes wrong:** The SSR `csv_daily_returns` fetch is bounded (queries.ts:2723 notes the payload "cannot grow unbounded as csv_daily_returns accumulates"). If the cap truncates a key's series below the engine's `n < 10` floor (scenario.ts:210) or the `< 30`-day warm-up the holdings path uses, the per-key blend could degrade unexpectedly.
**Why it happens:** Window caps are invisible until a key has a long history.
**How to avoid:** Confirm the fetch window cap (read queries.ts:2723–2730 at plan time) and ensure the per-key builder/engine handle short series with the same honest "—" degradation. The engine already returns null KPIs when `n < 10` (scenario.ts:210–226).
**Warning signs:** A key with real history shows "—" KPIs after exclusion of another key.

## Runtime State Inventory

> This is a code + payload-shape change. No rename, no migration, no stored-state rewrite.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 37 reads `csv_daily_returns` (already written by Phase 35/36 derive job) and `allocator_holdings`. No write, no schema change, no key rename. | None |
| Live service config | None — no external service, cron, or worker touched. The toggle is client-only ephemeral state. | None |
| OS-registered state | None — no scheduled task, pm2 process, or OS registration involved. | None |
| Secrets/env vars | None — no new secret, no env var referenced. | None |
| Build artifacts | None — no package rename, no egg-info/binary. TS type addition to `MyAllocationDashboardPayload` recompiles normally. | None |

**Nothing found in any category — verified by reading the in-scope files (queries.ts, scenario-adapter.ts, ScenarioComposer.tsx, scenario.ts, scenario-dealias.ts) and confirming the change is additive payload fields + client wiring only.**

## Code Examples

### Deriving `equityByApiKeyId` for the per-key builder weights (client)
```typescript
// Source: mirrors queries.ts:2271–2279 (SSR per-key equity grouping), but the
// client groups holdingsSummary (which carries api_key_id, queries.ts:1625).
const equityByApiKeyId: Record<string, number> = {};
for (const h of payload.holdingsSummary) {
  if (!h.api_key_id) continue;
  equityByApiKeyId[h.api_key_id] =
    (equityByApiKeyId[h.api_key_id] ?? 0) + holdingEquityContribution(h);
}
// holdingEquityContribution is exported from queries.ts:2081 (uses
// unrealized_pnl_usd for derivatives, value_usd for spot). Reuse it — do not
// re-derive equity from value_usd alone (derivative notional ≠ equity).
```

### Gating the "Data sources" control (per UI-SPEC §1)
```typescript
// Source: ScenarioComposer.tsx entryMode (:435) + payload gate field (new).
const showDataSources =
  entryMode === "book" && payload.perKeyDailiesGateSatisfied;
// showDataSources === false in book mode → render <InfoBanner> honest note.
// blank mode → render nothing (UI-SPEC §6).
```

### Label resolution (exchange + nickname, masked fallback)
```typescript
// Source: payload.apiKeys[] (queries.ts:1558–1573): { id, exchange, label, ... }.
// `label` is the nickname; when empty, mask the id tail (UI-SPEC Copywriting).
function dataSourceLabel(k: { exchange: string; label: string; id: string }) {
  const display = displayExchange(k.exchange); // existing helper (activeVenues uses one)
  const nick = k.label?.trim();
  return nick ? `${display} — ${nick}` : `${display} — ••••${k.id.slice(-4)}`;
}
```

## State of the Art

| Old Approach (per-holding composer) | Current Approach (Phase 37 per-key) | When Changed | Impact |
|-------------------------------------|-------------------------------------|--------------|--------|
| Projection units per holding (`holding:{venue}:{symbol}:{type}`) reading `holdingReturnsByScopeRef` (snapshot breakdown) | Projection units per `api_key` reading `perKeyReturnsByApiKeyId` (realized+funding / unified-252) | Phase 37 (this) | Composer blend matches the Overview's honest per-key basis (Phase 36) and the factsheet/CSV basis. |
| Read-only-tokens model: `disabledHoldingRefs = ∅`, holdings never toggle (ScenarioComposer.tsx:1172) | Per-key include/exclude toggle (ephemeral) | Phase 37 | First user-facing exclusion control in the composer's live book. |
| Overview-only per-key blend (computed at SSR, never reaches client) | Per-key series exposed on payload for client recompute | Phase 37 | Client can recompute the blend on toggle without a server round-trip. |

**Deprecated/outdated for this phase:** nothing removed. The holdings/added-strategy path stays for the snapshot-fallback population (gate not satisfied) — both paths coexist. The per-key path is additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The existing avg-ρ KPI label reads acceptably for per-key (account-level) units without a new "across data sources" qualifier. | Pitfall 4 | Low — number is honest; only a clarity nuance. The Overview already ships this basis. Confirm at plan/discuss. |
| A2 | The `!portfolio` branch should carry `perKeyReturnsByApiKeyId: {}` and `perKeyDailiesGateSatisfied: false` (fresh allocators have no per-key blend). | Pitfall 2 | Low — fresh allocators have no holdings/keys; the toggle is hidden anyway. Verify the fixture in `getMyAllocationDashboard.scenario.test.ts`. |
| A3 | The per-key series fetch window (queries.ts:2723) is wide enough that real-history keys clear the engine's `n < 10` floor after exclusion. | Pitfall 6 | Medium — a too-tight cap could surface "—" KPIs. Planner must read the exact cap at :2723–2730 and confirm. |
| A4 | A sibling builder (not a branch in `buildStrategyForBuilderSet`) is the smallest-diff seam that keeps the H-0132 commit oracle tests green. | Alternatives / Pattern 2 | Low — both work; sibling is strictly safer for the B4 pins. Planner's call per CONTEXT discretion. |

**If this table feels short:** it is — this phase is a refactor over verified, in-repo code, so most claims are `[VERIFIED]` by direct file reads (cited inline by file:line), not assumed.

## Open Questions

1. **Per-key series fetch window cap (queries.ts:2723–2730).**
   - What we know: the SSR fetch is intentionally bounded so the payload can't grow unbounded.
   - What's unclear: the exact cap (rows? days? per key?) and whether it can truncate a key below the engine's usable floor.
   - Recommendation: planner reads :2723–2730 at plan time; if the cap is row-based and shared across keys, confirm it doesn't starve a many-key allocator. Likely fine (the same fetch feeds the Overview today), but pin it.

2. **avg-ρ label/disclosure for per-key units (A1 / Pitfall 4).**
   - What we know: the engine computes honest cross-key correlation; the Overview already ships it.
   - What's unclear: whether the composer KPI caveat copy needs a one-line "across data sources" qualifier.
   - Recommendation: defer to discuss-phase only if the planner finds the existing copy ambiguous; otherwise ship as-is (consistent with Overview).

## Environment Availability

> Skipped — this phase has no external dependencies. It is a code + payload-shape change over existing in-repo TypeScript. No CLI tool, service, runtime, or database access beyond the already-wired Supabase read the dashboard query performs. (Step 2.6: SKIPPED — no external dependencies identified.)

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (`vitest run`) + @testing-library/react 16.3.2 + jsdom |
| Config file | `vitest.config.ts` (coverage gate: lines 82 / statements 80 / functions 74 / branches 72) |
| Quick run command | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` |
| Full suite command | `npm test` (i.e. `vitest run`) — full TS suite + coverage gate in CI |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DSRC-01 | Per-key builder emits one `StrategyForBuilder` per `api_key_id` (id === api_key_id, daily_returns from series, weight = equity share, default selected=true). | unit | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts -t "per-key"` | ✅ (add cases) |
| DSRC-01 | The B4 `buildStrategyForBuilderSet` signature + H-0132 commit oracle tests stay GREEN (sibling builder doesn't disturb them). | unit (regression) | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` | ✅ existing |
| DSRC-02 | "Data sources" control renders in book mode + gate satisfied; absent in blank mode; absent + InfoBanner note when gate NOT satisfied. | component | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx -t "data sources"` | ✅ (add cases) |
| DSRC-02 | Toggle has correct `aria-label` per row + `aria-checked`/`aria-pressed`; group has accessible name "Data sources". | component (a11y) | same file | ✅ (add cases) |
| DSRC-03 | **Honesty core:** excluding a key MEASURABLY changes the blended curve AND KPIs (Sharpe/vol/maxDD/return/avg-ρ) — compare KpiStrip props before/after, assert ≠. Never a cosmetic hide. | component | same file (model on T_C7, :728) | ✅ (add cases) |
| DSRC-03 | All-excluded → `EmptyStateCard` honest empty + null/"—" KPIs (never stale blended number); re-include restores. | component | same file | ✅ (add cases) |
| DSRC-03 | Per-key units with same underlying symbol are NOT collapsed by `collapseAliasedHoldingStrategies` (Pitfall 3); avg-ρ honest. | unit/component | scenario-dealias passthrough assertion | ✅ (add case) |
| DSRC-03 | Toggle is ephemeral: toggling off does NOT change `diffCount` / produce a commit diff (Pitfall 5). | component | same file | ✅ (add case) |
| Payload | New fields present on BOTH return branches; `liveBaselineMetrics` + `holdingReturnsByScopeRef` byte-identical (Pitfall 2). | integration | `npx vitest run src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts src/lib/queries.my-allocation.test.ts` | ✅ (add cases) |

### Minimum sampling that catches a regression
- **Per task commit:** the touched file's suite — `npx vitest run <file>` for whichever of {scenario-adapter, ScenarioComposer, queries.my-allocation} the task edits.
- **Per wave merge:** the three suites above together (adapter + composer + queries), since the payload→adapter→composer chain spans all three.
- **Phase gate:** full `npm test` green (incl. the coverage ratchet) before `/gsd:verify-work`.

### The DSRC-03 honesty test (load-bearing — design it to FAIL on a cosmetic hide)
The single most important test: render the composer with TWO per-key sources whose return series differ materially (e.g. key A flat/positive, key B volatile/negative). Capture `KpiStrip` props (or `scenarioMetrics`) with both included. Toggle key B off. Assert the recomputed Sharpe / maxDD / return / equity-curve endpoint are DIFFERENT — and specifically match an independent two-key→one-key recompute (not just "changed"). Model on T_C7 (ScenarioComposer.test.tsx:728) which already captures `KpiStrip.mock.calls` before/after a toggle. **A test that only asserts the row's visual state (strikethrough/opacity) would pass for a cosmetic hide — it MUST assert the KPI/curve numbers move.** This is the test the CONTEXT Specifics call out as load-bearing.

### Wave 0 Gaps
- [ ] `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` — add per-key builder cases (id keying, equity-share weights, default-included, empty-series skip).
- [ ] `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — add: control gating (book/blank/fallback), honest-recompute (DSRC-03 core), all-excluded empty, ephemerality (no diff), per-key no-collapse.
- [ ] `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` + `src/lib/queries.my-allocation.test.ts` — assert the three new payload fields on both branches + `liveBaselineMetrics`/`holdingReturnsByScopeRef` unchanged.
- [ ] No framework install needed — Vitest + RTL already configured.

## Security Domain

> `security_enforcement` not set to `false` in config — section included, but this phase's attack surface is minimal.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth path; the dashboard query is already RLS/ownership-gated (`.eq("allocator_id", userId)`). |
| V3 Session Management | no | No session change. |
| V4 Access Control | yes (indirect) | The per-key series is already fetched under the allocator's ownership gate in `getMyAllocationDashboard`. Phase 37 only EXPOSES already-owned data to the same allocator's own client. No cross-tenant surface. **Verify:** the new payload fields carry ONLY this allocator's own `api_key_id` series (no other party's keys) — the SSR fetch already filters by allocator (queries.ts ~2727). |
| V5 Input Validation | yes (light) | The toggle is a boolean per known `api_key_id`; no free-text input. `buildPerKeyReturnsByApiKeyId` already drops null/non-finite rows (queries.ts:2422–2423). |
| V6 Cryptography | no | No crypto. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant key series leak via the new payload field | Information Disclosure | The SSR fetch is allocator-scoped (existing gate); the field carries only own-keys. Pin with a test that the payload's `perKeyReturnsByApiKeyId` keys ⊆ the allocator's own `apiKeys[].id`. |
| Toggle state leaking into a persisted/committed decision | Tampering / Repudiation | Ephemeral `useState` only; test asserts no `diffCount`/commit-diff change (Pitfall 5). |
| Stale/dishonest number on all-excluded | (honesty, not security) | Engine returns null KPIs; EmptyStateCard renders honest absence. |

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/lib/scenario.ts:149–431` — frozen `computeScenario`: `selected` filter (154–176), per-day renorm `r/activeWeightSum` (240–255), empty/degenerate returns (157–174, 210–226, 312–329), avg-ρ (431).
- `src/lib/queries.ts:2228–2427` — Phase 36 per-key helpers: `liveBaselineMetricsFromPerKeyDailies`, `allActiveKeysHavePerKeyDailies`, `isPerKeyDailiesEligibleKey`, `buildPerKeyReturnsByApiKeyId`, `holdingEquityContribution` (2081).
- `src/lib/queries.ts:1493–1758` — `MyAllocationDashboardPayload` shape (apiKeys 1558, holdingsSummary+api_key_id 1618/1625, holdingReturnsByScopeRef 1731, liveBaselineMetrics 1750).
- `src/lib/queries.ts:3057–3140, 3430–3445` — the two return sites + the inline D3 gate selection.
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts:87–190` — `buildStrategyForBuilderSet` (B4 positional, holdings flatMap, disabledHoldingRefs → selected).
- `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts:1–653` — B4 signature pins + H-0132 commit oracle (415–588).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:261–293, 398–520, 1172–1343, 1684–1714` — props (full payload), entryMode, ephemeral leverageByRef, projectionState memo, collapse→engine pipeline, entry-mode pill recipe.
- `src/lib/scenario-dealias.ts:60–167` — `collapseAliasedHoldingStrategies` (symbol grouping, passthrough for non-holding ids).
- `src/components/ui/InfoBanner.tsx`, `src/components/ui/EmptyStateCard.tsx` — honest-absence primitives.
- `.planning/phases/37-honest-per-data-source-toggle/37-CONTEXT.md`, `37-UI-SPEC.md` — locked decisions + UI contract.
- `.planning/phases/36-repoint-stats-reads/36-CONTEXT.md` — upstream D1/D2/D3 basis.
- `package.json`, `vitest.config.ts` (via CLAUDE.md) — Vitest 4.1.2, coverage gate.

### Secondary / Tertiary
- None — no external/web source was needed; this is an internal-code refactor.

## Metadata

**Confidence breakdown:**
- Standard stack (reused modules): HIGH — every module read at file:line; no new packages.
- Architecture (payload seam, sibling builder, projectionState thread): HIGH — the SSR per-key helper is an exact template; the engine's renorm-on-selected is verified.
- Pitfalls: HIGH for 1/2/3/5 (verified in code), MEDIUM for 4/6 (labeling nuance + fetch-window cap need a plan-time confirm).
- Honesty guarantee (DSRC-03): HIGH — the frozen engine's `activeStrategies` filter + per-day renormalization is the mechanism; the test is designed to fail on a cosmetic hide.

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable internal code; only invalidated if Phase 36's helpers or `scenario.ts` change before 37 lands).
