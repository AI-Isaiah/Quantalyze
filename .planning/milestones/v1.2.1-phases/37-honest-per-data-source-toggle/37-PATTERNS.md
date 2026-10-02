# Phase 37: Honest per-data-source toggle - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 6 (3 source modified + 3 test modified) + 2 read-only UI primitives reused
**Analogs found:** 6 / 6 (every file has an exact in-repo template)

This phase is a **client-side blend re-key over a frozen engine**, not a new
integration. Every "hard part" already exists in-repo. The job is wiring, and
the analogs below are the EXACT templates to copy from — not loose inspiration.
Where the research cites a line range, this map confirms it by direct read.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/queries.ts` (payload type + 2 return sites) | model/payload (SSR) | request-response | `liveBaselineMetrics` additive field already on the same payload (queries.ts:1750) | exact (same file, additive sibling) |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` (new sibling builder) | utility (pure adapter) | transform | `liveBaselineMetricsFromPerKeyDailies` (queries.ts:2248) for per-key keying; `buildStrategyForBuilderSet` (scenario-adapter.ts:87) for the return shape | exact (two complementary templates) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (toggle UI + state + projection thread) | component | event-driven → request-response (in-memory recompute) | R4 `leverageByRef` ephemeral state (ScenarioComposer.tsx:515) + `projectionState` memo (:1238) + entry-mode pill (:1677) | exact (same file, R4 is the literal precedent) |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` (per-key builder cases) | test (unit) | transform | T1/T2/T3 happy-path cases (:44–82) + H-0132 oracle (:415–494) | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (toggle/honesty/empty/ephemeral cases) | test (component) | event-driven | T_C7 KpiStrip before/after toggle (:728) + mock harness (:88, :175–270) | exact (T_C7 is the named model) |
| `src/lib/queries.my-allocation.test.ts` + `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` (payload-shape) | test (integration) | request-response | Phase 36 per-key repoint block (queries.my-allocation.test.ts:1551) + payload `toHaveProperty` block (:881–901) | exact |

---

## Pattern Assignments

### `src/lib/queries.ts` — expose per-key channel on the payload (model, request-response)

**Analog:** the existing `liveBaselineMetrics` field — an additive SSR-lifted
payload field on the SAME payload type, with the SAME two-return-site pattern.

The values are already computed at SSR (queries.ts:3075–3098); Phase 37 only
ADDS them to the type + both returns. Do **not** repoint `liveBaselineMetrics`
or `holdingReturnsByScopeRef` — Phase 36 pinned those byte-identical.

**Payload type additive-field pattern** (queries.ts:1731, :1750-1758 — copy this JSDoc + shape style):
```typescript
holdingReturnsByScopeRef: Record<string, DailyPoint[]>;   // line 1731 — DO NOT CHANGE
// ...
liveBaselineMetrics: {                                     // line 1750 — DO NOT CHANGE
  aum: number;
  ytdTwr: number | null;
  // ...
  equity: DailyPoint[];
  drawdown: DailyPoint[];
};
// PHASE 37 ADDS (mirror this style — a documented additive field):
// perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>;
// perKeyDailiesGateSatisfied: boolean;
// eligibleApiKeyIds: string[];
```

**Hoist the gate boolean** (queries.ts:3086-3098) — today it is inline in a
ternary; lift to a `const` so it can be both selected on AND returned:
```typescript
// EXISTING (queries.ts:3086-3098):
const eligibleKeyIds = apiKeys
  .filter(isPerKeyDailiesEligibleKey)        // SoT-mirror predicate — DO NOT re-derive client-side
  .map((k) => k.id);
const liveBaselineMetrics =
  allActiveKeysHavePerKeyDailies(eligibleKeyIds, perKeyReturnsByApiKeyId)  // gate called inline
    ? liveBaselineMetricsFromPerKeyDailies(phase07.holdingsSummary, perKeyReturnsByApiKeyId)
    : liveBaselineMetricsFromHoldings(phase07.holdingsSummary, holdingReturnsByScopeRef);
// PHASE 37: hoist the gate into `const perKeyDailiesGateSatisfied = allActiveKeysHavePerKeyDailies(...)`
// then use it in BOTH the ternary above AND the two return objects below.
```

**Both return sites** (Pitfall 2 — patch BOTH or the type goes red):
- `!portfolio` branch return (queries.ts:3122-3139) — carries `liveBaselineMetrics` + `holdingReturnsByScopeRef` today; add the 3 fields here too (likely `{}` / `false` / `[]` for a fresh allocator — note `perKeyReturnsByApiKeyId` is computed BEFORE the `if (!portfolio)` at :3075, so the real value is available on both branches).
- main branch return (queries.ts:3425-3444) — same 3 fields.

```typescript
// EXISTING shape at BOTH return sites (:3132-3134 and :3437-3439):
holdingReturnsByScopeRef,
allocator_id: allocator_id,
liveBaselineMetrics,
// PHASE 37 ADDS (identical 3 lines at BOTH sites):
// perKeyReturnsByApiKeyId,
// perKeyDailiesGateSatisfied,
// eligibleApiKeyIds: eligibleKeyIds,
```

**Reusable helpers already exported (DO NOT rebuild — `## Don't Hand-Roll`):**
- `buildPerKeyReturnsByApiKeyId` (queries.ts:2413) — groups raw rows → `Record<api_key_id, DailyPoint[]>`, drops null id / non-finite.
- `allActiveKeysHavePerKeyDailies` (queries.ts:2362) — the D3 all-or-nothing gate.
- `isPerKeyDailiesEligibleKey` (queries.ts:2397) — the SoT-mirror active-key predicate (Python backfill is authoritative; never re-derive in the browser).
- `holdingEquityContribution` (queries.ts:2081) — derivative→`unrealized_pnl_usd`, spot→`value_usd`, non-finite→0. The per-key WEIGHT source (D2).

---

### `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — sibling per-key builder (utility, transform)

**Analog A (per-key keying + weight + skip logic):** `liveBaselineMetricsFromPerKeyDailies` (queries.ts:2248-2353).
**Analog B (return shape `{ strategies, state }`):** `buildStrategyForBuilderSet` (scenario-adapter.ts:87-190).

Add a SIBLING function (NOT a branch inside `buildStrategyForBuilderSet`) — a
new branch risks the H-0132 oracle tests that pin `state.weights`/`state.selected`
keyed on `buildHoldingRef(h)` (scenario-adapter.test.ts:415-449). The sibling
keeps the B4 positional signature byte-identical.

**Per-key unit construction** (copy the loop body from queries.ts:2285-2316):
```typescript
// Source: queries.ts:2285-2316 (the StrategyForBuilder-per-api_key_id loop).
// Lift it client-side, returning { strategies, state } instead of metrics.
const strategies: StrategyForBuilder[] = [];
const selected: Record<string, boolean> = {};
const weights: Record<string, number> = {};
const startDates: Record<string, string> = {};
for (const [apiKeyId, returns] of Object.entries(perKeyReturnsByApiKeyId)) {
  if (!returns || returns.length === 0) continue;        // skip empty (queries.ts:2290)
  strategies.push({
    id: apiKeyId,                                        // id === api_key_id (DSRC-01)
    name: `key ${apiKeyId}`, codename: null,
    disclosure_tier: "exploratory",                      // queries.ts:2295
    strategy_types: [], markets: [],
    start_date: returns[0]?.date ?? null,
    daily_returns: returns,
    cagr: null, sharpe: null, volatility: null, max_drawdown: null,
  });
  selected[apiKeyId] = true;                             // default included (Area 1)
  weights[apiKeyId] = Math.max(0, equityByApiKeyId[apiKeyId] ?? 0);  // clamp neg (queries.ts:2315) — raw equity-share USD; engine renormalizes
  startDates[apiKeyId] = returns[0]?.date ?? "2022-01-01";
}
return { strategies, state: { selected, weights, startDates } };
```

**Return-shape contract to match** (scenario-adapter.ts:98, :186-189):
```typescript
// buildStrategyForBuilderSet returns exactly this — the sibling mirrors it:
): { strategies: StrategyForBuilder[]; state: ScenarioState } { ... }
return { strategies: allStrategies, state: { selected, weights, startDates } };
```

**Pitfall 1 (load-bearing):** pass RAW equity-share weights; do NOT renormalize
to sum-to-1 here. The frozen engine divides by `activeWeightSum` over the
selected set (scenario.ts:254) — `normWeight` (scenario.ts:181) divides by
`totalWeight`. Renormalizing here double-normalizes.

**`equityByApiKeyId` derivation (client side)** — mirror queries.ts:2271-2279 but
group `payload.holdingsSummary` (carries `api_key_id`, queries.ts:1625) with
`holdingEquityContribution` (queries.ts:2081 — exported; import it, do not
re-derive from `value_usd` which is derivative notional, not equity):
```typescript
// Source: queries.ts:2271-2279.
const equityByApiKeyId: Record<string, number> = {};
for (const h of payload.holdingsSummary) {
  if (!h.api_key_id) continue;
  equityByApiKeyId[h.api_key_id] =
    (equityByApiKeyId[h.api_key_id] ?? 0) + holdingEquityContribution(h);
}
```

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — toggle UI + state + projection thread (component, event-driven)

**Analog (ephemeral state):** R4 `leverageByRef` — the LITERAL precedent the
CONTEXT names. It is ephemeral, NOT persisted to the draft, NOT in the commit
diff, resets on reload — exactly the Area 3 lock.

**Ephemeral toggle state** (mirror ScenarioComposer.tsx:515):
```typescript
// Source: ScenarioComposer.tsx:509-515 (R4 leverageByRef). Same posture.
// "Ephemeral exploration state: NOT persisted to the draft and NOT part of the
//  commit diff ... resets on reload."
const [includeByApiKeyId, setIncludeByApiKeyId] =
  useState<Record<string, boolean>>({});   // default {} = all included
```
**Pitfall 5:** do NOT route through `scenario.draft.toggleByScopeRef` — that
persists + feeds the commit diff (`getEnabledRefs`). Use this fresh `useState`.

**Fail-loud change handler** (model on `handleLeverageChange`, ScenarioComposer.tsx:625-647):
the toggle is a boolean so it never clamps, but match the visible-state posture:
```typescript
// Source: ScenarioComposer.tsx:620-647 (handleLeverageChange fail-loud contract).
// A toggle has no invalid value, so it is simpler — just set the map. Keep the
// "visible state, never silent" posture: the row's aria-pressed/aria-checked
// reflects the change immediately.
function handleDataSourceToggle(apiKeyId: string, include: boolean) {
  setIncludeByApiKeyId((prev) => ({ ...prev, [apiKeyId]: include }));
}
```

**Thread into `projectionState.selected`** (the existing memo, ScenarioComposer.tsx:1238-1265).
The memo already overlays draft `selected`/`weight`/`leverage` per `s.id`.
Per-key exclusion rides the SAME `selected` channel keyed by `api_key_id`:
```typescript
// Source: ScenarioComposer.tsx:1242-1245 (the selected overlay loop). For the
// per-key strategy set, s.id === api_key_id, so:
selected[s.id] = includeByApiKeyId[s.id] ?? true;   // absent → included (default)
// weights[s.id] = adapterOutput.state.weights[s.id];  // raw equity-share; engine renormalizes
```
The pipeline AFTER the memo is unchanged and already honest:
`collapseAliasedHoldingStrategies` (per-key UUIDs pass through, NOT in
`symbolByHoldingId` — ScenarioComposer.tsx:1208-1218; Pitfall 3) →
`buildDateMapCache` (:1282) → `computeScenario` (:1286). DO NOT fork either
(SCENARIO-05).

**Adapter wiring memo** to copy (ScenarioComposer.tsx:1174-1203) — wrap the new
sibling builder in a `useMemo` keyed on its inputs, exactly like `adapterOutput`.

**Gate the control** (research §Code Examples; entry-mode at ScenarioComposer.tsx:419/:1677):
```typescript
const showDataSources = entryMode === "book" && payload.perKeyDailiesGateSatisfied;
// true  → render the "Data sources" control (per-key rows)
// false in book mode → render <InfoBanner> honest note (UI-SPEC §5)
// blank mode → render nothing (UI-SPEC §6)
```

**Toggle visual recipe** — reuse the entry-mode pill EXACTLY (ScenarioComposer.tsx:1697-1701):
```typescript
// Source: ScenarioComposer.tsx:1697-1701 (entry-mode radio pill). Per UI-SPEC §2:
//   included: "border border-accent text-accent"          (NO accent fill)
//   excluded: "border border-transparent text-text-secondary"
//   focus:    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
```

**Label resolution** (exchange + nickname, masked fallback) — the exchange-label
map is NOT shared-exported; it is duplicated locally in two files. Copy the
`SyncBadge.tsx:21-35` recipe (lower-cased lookup with `?? exchange` fallback):
```typescript
// Source: src/components/strategy/SyncBadge.tsx:21-35 (the EXCHANGE_LABELS recipe).
const EXCHANGE_LABELS: Record<string, string> = { binance: "Binance", okx: "OKX", bybit: "Bybit" };
function dataSourceLabel(k: { exchange: string; label: string; id: string }) {
  const display = EXCHANGE_LABELS[k.exchange.toLowerCase()] ?? k.exchange;
  const nick = k.label?.trim();
  return nick ? `${display} — ${nick}` : `${display} — ••••${k.id.slice(-4)}`;  // masked tail, Geist Mono per UI-SPEC
}
// Labels come from payload.apiKeys[] (queries.ts:1558-1573): { id, exchange, label, ... }.
```

**Honest-absence shells** (reuse verbatim, do NOT build new — `## Don't Hand-Roll`):
- All-excluded → `EmptyStateCard` (src/components/ui/EmptyStateCard.tsx) — `heading`+`body` props; neutral muted, no `role="alert"`. The engine already returns null KPIs + `[]` curve when `activeIds.length === 0` (scenario.ts:157-168), so the composer's existing degenerate "—" path covers KPIs.
- Gate-not-satisfied → `InfoBanner` (src/components/ui/InfoBanner.tsx) — `border-accent/30 bg-accent/5`, calm, no red.

---

### `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` — per-key builder cases (test, transform)

**Analog A (happy-path structure):** T1/T2/T3 (scenario-adapter.test.ts:44-99) — empty→empty, two-units→weights, skip logic.
**Analog B (regression guard the sibling must NOT disturb):** H-0132 oracle (:415-494) — pins `buildStrategyForBuilderSet` keys; running it GREEN proves the sibling is isolated.

**Pin to add** (model on T2, :58-81): one `StrategyForBuilder` per `api_key_id`
(`id === api_key_id`), `daily_returns` from the series, weight = clamped
equity-share, `selected[id] === true` by default, empty-series keys skipped.

```typescript
// Model: scenario-adapter.test.ts:58-81 (T2). Assert per-key keying:
//   expect(result.strategies.map(s => s.id).sort()).toEqual(["key-A","key-B"]);
//   expect(result.state.selected["key-A"]).toBe(true);   // default included
//   expect(result.state.weights["key-A"]).toBe(<clamped equity share>);
// And a key with [] series is skipped entirely (mirror T3's warm-up exclusion at :83).
```

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — toggle/honesty/empty cases (test, event-driven)

**Analog (THE model for the DSRC-03 honesty test):** T_C7 (ScenarioComposer.test.tsx:724-757) —
captures `vi.mocked(KpiStrip).mock.calls` BEFORE a toggle, fires the toggle,
asserts KpiStrip re-rendered. The mock harness (`vi.mock("./KpiStrip")` at :88,
`vi.mocked(KpiStrip).mock.calls[0][0]` prop capture at :471) + `makePayload`
fixture (:199-270) + localStorage stub (:178-197) are the reusable scaffold.

**The DSRC-03 honesty test (load-bearing — must FAIL on a cosmetic hide):**
```typescript
// Model: T_C7 (:728) for the before/after KpiStrip capture, but assert NUMBERS,
// not visual state. T_C3 (:461-486) shows how to read the props:
//   const props = vi.mocked(KpiStrip).mock.calls.at(-1)?.[0];   // (cf. :719)
// Render with TWO per-key sources whose series differ MATERIALLY (key A flat-ish,
// key B volatile/negative). Capture scenarioMetrics/KpiStrip props with both
// included. Toggle key B off. Assert Sharpe/maxDD/return/equity-endpoint are
// DIFFERENT and match an independent two-key→one-key recompute. A test that only
// asserts strikethrough/opacity (like T_C7's :752-754) PASSES for a cosmetic hide
// — it MUST assert the KPI/curve numbers move.
```

Other cases to add (all on this harness):
- Control gating: present in book mode + gate satisfied; absent in blank mode (model T_C3b, :486); InfoBanner note when gate not satisfied.
- All-excluded → `EmptyStateCard` + "—"/null KPIs (never a stale blended number); re-include restores. (Model the empty-state assertion on T_C1, :396.)
- Ephemerality (Pitfall 5): toggling off does NOT change `diffCount` / produce a commit diff.
- Per-key no-collapse (Pitfall 3): two per-key units with same underlying symbol NOT collapsed (cf. H-0487 collapse test at :523).
- a11y: per-row `aria-label` + `aria-checked`/`aria-pressed`; group accessible name "Data sources" (cf. T_C7's `getByRole("switch", { name: ... })` at :744).

---

### `src/lib/queries.my-allocation.test.ts` + `getMyAllocationDashboard.scenario.test.ts` — payload-shape (test, request-response)

**Analog A (per-key SSR fixture + falsifiable assertion):** the Phase 36 per-key
repoint block (queries.my-allocation.test.ts:1551-1650) — its
`seedPerKeyDailiesA` / `activeKeyA` / `seedHoldingsKeyA` fixtures + the
`getMyAllocationDashboard("user-1")` → assert pattern are the exact scaffold for
asserting the new payload fields appear.
**Analog B (payload `toHaveProperty` shape pins):** getMyAllocationDashboard.scenario.test.ts:881-901 (`expect(result).toHaveProperty("equitySnapshots")` …) + the `liveBaselineMetrics` empty-default pin (queries.my-allocation.test.ts:486-491).

**Pins to add:**
```typescript
// Model: queries.my-allocation.test.ts:1629-1648. Reuse seedPerKeyDailiesA/activeKeyA.
//   expect(result).toHaveProperty("perKeyReturnsByApiKeyId");
//   expect(result.perKeyDailiesGateSatisfied).toBe(true);   // both branches
//   expect(result.eligibleApiKeyIds).toContain("key-A");
//   // byte-identity guard (Pitfall 2): liveBaselineMetrics + holdingReturnsByScopeRef UNCHANGED
//   expect(result.liveBaselineMetrics).toEqual(expectedPerKey);   // (already pinned at :1645-1648)
// Fresh-allocator (!portfolio) branch: assert the 3 fields present with empty/false defaults.
// Security pin (research §Security): payload.perKeyReturnsByApiKeyId keys ⊆ apiKeys[].id.
```

---

## Shared Patterns

### Frozen engine — honest recompute (NEVER fork)
**Source:** `src/lib/scenario.ts:156-254`
**Apply to:** adapter sibling, projection thread, all honesty tests.
The engine filters to `state.selected[id]` and renormalizes per-day over only
the selected set — so `selected[api_key_id]=false` is a TRUE recompute with no
manual renorm needed:
```typescript
// scenario.ts:156-176 — selected filter + empty early-return:
const activeIds = ids.filter((id) => state.selected[id]);
if (activeIds.length === 0) { /* returns all-null KPIs + [] curve (157-168) */ }
const activeStrategies = strategies.filter((s) => state.selected[s.id]);  // :176
// scenario.ts:243-254 — per-day renorm over the SELECTED set:
let activeWeightSum = 0;
for (const s of activeStrategies) { /* sum w·L·r and w into activeWeightSum */ }
portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;              // :254
```
**Anti-pattern:** any manual sum-to-1 renorm in the adapter/overlay (double-normalizes, Pitfall 1).

### Ephemeral what-if overlay (NOT persisted)
**Source:** `ScenarioComposer.tsx:509-515` (R4 `leverageByRef`)
**Apply to:** the per-key toggle state. Fresh `useState`, never
`scenario.draft.toggleByScopeRef` (Pitfall 5).

### Additive payload field (NEVER repoint Phase-36 pins)
**Source:** `queries.ts:1750` (`liveBaselineMetrics`) + both return sites (:3122, :3437)
**Apply to:** the 3 new payload fields. Both branches or the type goes red (Pitfall 2).

### SoT-mirror eligibility (NEVER re-derive client-side)
**Source:** `isPerKeyDailiesEligibleKey` (queries.ts:2397) — mirrors the Python backfill.
**Apply to:** the gate. The client READS `perKeyDailiesGateSatisfied` / `eligibleApiKeyIds`; it never recomputes the predicate (drift = silent-fallback-forever bug).

### Honest-absence UI shells (reuse, do NOT build)
**Source:** `InfoBanner` (src/components/ui/InfoBanner.tsx), `EmptyStateCard` (src/components/ui/EmptyStateCard.tsx)
**Apply to:** gate-not-satisfied note (InfoBanner) + all-excluded empty (EmptyStateCard). Neutral/calm, no `role="alert"`, no red.

### Fail-loud, visible-state change handler
**Source:** `handleLeverageChange` (ScenarioComposer.tsx:625-647) + `handleWeightChange` clamp (:597-617)
**Apply to:** the toggle handler. A toggle never clamps, but keep the "state visible immediately, never silent" posture (CONTEXT code_context: "mirror that posture").

---

## No Analog Found

None. Every file to create/modify has an exact in-repo template — this phase is
wiring over verified code, not algorithm-building.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All 6 files map to exact analogs (Phase 36 helpers + R4 leverage + entry-mode pill + T_C7 + H-0132). |

**One minor seam without a shared export:** the exchange-display label map is
duplicated locally (`SyncBadge.tsx:21`, `VerificationForm.tsx:13`) — there is no
shared `EXCHANGE_LABELS` export. The planner copies the SyncBadge recipe locally
(consistent with the existing duplication) rather than introducing a new shared
module (out of scope, surgical-change rule).

---

## Metadata

**Analog search scope:** `src/lib/` (queries, scenario, scenario-dealias),
`src/app/(dashboard)/allocations/lib/` + `/components/`, `src/components/ui/`,
`src/components/strategy/`.
**Files scanned:** 9 source + 3 test + 2 UI primitive (all read at file:line, no re-reads).
**Pattern extraction date:** 2026-06-25
