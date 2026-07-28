# Phase 21: Surfacing, Correlation & Honest Projection - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 8 modified + 1 possible new helper + 4 test files
**Analogs found:** 13 / 13 (every surface has a verified in-repo analog — this is a brownfield wiring phase)

> RESEARCH.md already carried verified file:line analogs. This map consolidates them, confirms each by direct read, and attaches the concrete code-to-copy excerpts the planner pastes into plan actions. **Zero new packages. The engine (`scenario.ts`, `scenario-dealias.ts`) is FROZEN — read-only.**

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | component (tablist) | request-response (URL-as-state) | self (in-file: `VISIBLE_TAB_KEYS` already typed, `scenario` already a `TabKey`) | exact (in-file) |
| `src/components/layout/Sidebar.tsx` | component (nav) | event-driven (role booleans → render) | self (`workspaceItems` push pattern :58-72; icon factory :247-316) | exact (in-file) |
| `src/components/portfolio/CorrelationHeatmap.tsx` | component (presentational) | transform (matrix → grid) | self (already shared; remove truncation, extend empty-state) | exact (in-file) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | component (host) | transform (holdings → engine → render) | `ScenarioBuilder.tsx` (sibling host that already mounts heatmap) | exact (sibling) |
| `src/components/scenarios/ScenarioBuilder.tsx` | component (host) | transform (universe → engine → render) | `ScenarioComposer.tsx` (badge/caveat slot pattern) | exact (sibling) |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | component (KPI cell) | transform (metrics → cells) | self (in-file: "Avg ρ" cell :416, `avgRhoValue` :331) | exact (in-file) |
| `shortestHistoryName` (possible NEW pure helper, `src/lib/scenario.ts` sibling or `scenario-dealias.ts`) | utility | transform (strategies → name) | `pickTopTenByAvgCorr` (the reduce-over-strategies pure-fn shape being removed) + `collapseAliasedHoldingStrategies` | role-match |
| `src/app/(dashboard)/scenarios/page.tsx` | route (RSC) | request-response (role gate) | self — NO CHANGE NEEDED (gate :50-52 already enforces `isAllocator`) | exact (read-only confirm) |
| **TESTS** | | | | |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (extend) | test (neuter guard) | — | self — the "R3 guard" :2163-2186 | exact (in-file) |
| `src/components/portfolio/CorrelationHeatmap.test.tsx` (replace truncation tests) | test (component) | — | self — truncation tests :100-165 (REPLACE with show-all) | exact (in-file) |
| `src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx` (update literal) | test (component) | — | self — asserts "Avg ρ" literal | exact (in-file) |
| `src/components/layout/Sidebar.sandbox-link.test.tsx` (NEW — Wave 0 gap) | test (component) | — | `scenarios/page.role-gate.test.ts` (role-gating assertion model) | role-match |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` (NEW — Wave 0 gap) | test (component + neuter guard) | — | `ScenarioComposer.test.tsx` R3 guard :2163-2186 (replicate for Sandbox) | exact (cross-surface model) |

---

## Pattern Assignments

### `AllocationsTabs.tsx` (component, request-response) — SURF-01

**Analog:** self (in-file). `scenario` is already a full `TabKey` with label, parse-case, panel, ARIA. It is excluded from exactly TWO arrays: `VISIBLE_TAB_KEYS` and the keyboard-nav walk (which derives from `VISIBLE_TAB_KEYS`).

**Core pattern — the visible strip to extend** (lines 246-252):
```typescript
const VISIBLE_TAB_KEYS: readonly TabKey[] = [
  "overview",
  "holdings",
  "outcomes",
  "mandate",
  "risk",
  // ADD: "scenario"
] as const;
```

**Why this single edit suffices (read-only confirmations):**
- `TabKey` already includes `"scenario"` (:233-239), `TAB_LABELS.scenario = "Scenario"` (:304), `parseTab` already returns `"scenario"` (:288-289), `KNOWN_TAB_RAW_ENTRIES` spreads `VISIBLE_TAB_KEYS + "scenario"` (:270-274) so adding it to the strip keeps the dedup set valid.
- Button styling auto-applies: `TAB_BUTTON_ACTIVE` / `TAB_BUTTON_INACTIVE` (:312-315) use `border-accent text-accent` active — PINNED, no new style.
- The render loop maps over `VISIBLE_TAB_KEYS`, so the button appears automatically.

**Keyboard-nav pattern** (lines 440-446) — `keyboardKeys` derives from `VISIBLE_TAB_KEYS`, so adding `scenario` to the strip ALSO fixes arrow-nav reach with no second edit:
```typescript
const outcomesHidden =
  typeof document !== "undefined" &&
  document.body.getAttribute("data-show-outcomes") === "false";
const keyboardKeys = outcomesHidden
  ? VISIBLE_TAB_KEYS.filter((k) => k !== "outcomes")
  : VISIBLE_TAB_KEYS;
```
> ⚠️ The `:427-429` comment ("keyboard nav only walks VISIBLE_TAB_KEYS … excluding scenario") becomes stale once scenario is in the strip — update that comment to avoid contradicting the new behavior (Rule 3: clean up your own mess). Do NOT regress the "+ Allocation" `changeTab("scenario")` deep-link.

---

### `Sidebar.tsx` (component, event-driven role gate) — SURF-02 / SURF-03

**Analog:** self (in-file). Nav items push onto `workspaceItems` inside role-keyed conditionals.

**Core pattern — workspaceItems push** (lines 58-72):
```typescript
const workspaceItems: NavItem[] = [];
if (showsAllocatorWorkspace) {            // = isAllocator || isAdmin
  workspaceItems.push({
    label: "My Allocation",
    href: "/allocations",
    icon: PortfolioIcon,
    badge: flaggedCount,
  });
}
if (showsManagerWorkspace) {
  workspaceItems.push(
    { label: "Strategies", href: "/strategies", icon: BarChartIcon },
    { label: "Portfolios", href: "/portfolios", icon: PieChartIcon },
  );
}
```

**Apply (SURF-03 critical gate):** push the Sandbox item directly under "My Allocation", gated on **`isAllocator` ONLY** — NOT `showsAllocatorWorkspace` (which is `isAllocator || isAdmin`). CONTEXT: "managers AND admins see no Sandbox entry." `buildNavSections` already receives `isAllocator` as a param (:22). Per UI-SPEC §2: position directly under "My Allocation" in `MY WORKSPACE`.
```typescript
// ADD — note the DISTINCT gate (isAllocator, excludes admin-only):
if (isAllocator) {
  workspaceItems.push({ label: "Strategy Sandbox", href: "/scenarios", icon: BeakerIcon });
}
```

**Icon factory pattern** (lines 247-316) — all icons are 16px-viewBox inline SVG, 1.5px stroke, `currentColor`, `className` prop. Model the new `BeakerIcon` exactly on this shape (e.g. `BarChartIcon` :247-253):
```typescript
function BarChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 12V7M8 12V4M12 12V9" />
    </svg>
  );
}
```
Per UI-SPEC §2 the new icon is a lab-flask/beaker outline. No icon dependency.

**Security note (read-only):** the sidebar hide is **defense-in-depth, NOT the boundary**. The real gate is `scenarios/page.tsx:50-52` (already in place, test-pinned).

---

### `CorrelationHeatmap.tsx` (component, presentational transform) — CORR-01 / CORR-02 / CORR-04-superseded

**Analog:** self. Already shared (consumed by `ScenarioBuilder.tsx:435` AND `portfolios/[id]/page.tsx`). This phase promotes it to the new ScenarioComposer consumer + removes truncation + extends empty state.

**KEEP — correlation-SIGN palette** (lines 51-72) — teal (diversifying / negative ρ) → `#F1F5F9` neutral → burnt orange (concentration / positive ρ). **Do NOT swap in `factsheet/v2/palette.ts`** (return-magnitude scale; would render diversifying ρ as alarming red — semantically inverted). CI contrast sweep locks ≥~3.75:1. This is the ratified Rule-7 divergence from CONTEXT's literal "reuse palette.ts" wording (UI-SPEC §Color).

**REMOVE — truncation** (lines 128-149):
```typescript
function pickTopTenByAvgCorr(matrix: Record<string, Record<string, number>>): string[] {
  const all = Object.keys(matrix);
  if (all.length <= 10) return all;
  // ... sorts by avg |corr|, slices top 10 ...
}
// and the useMemo at :146-149:
const ids = useMemo(
  () => (correlationMatrix ? pickTopTenByAvgCorr(correlationMatrix) : []),
  [correlationMatrix],
);
```
**Replace with show-ALL:** `ids = correlationMatrix ? Object.keys(correlationMatrix) : []`. Per UI-SPEC §3, keep `overflow-x-auto` on the figure wrapper AND add a `max-h`-bounded (~70vh) vertical scroll container so a large-N grid scrolls both axes. Cells stay ≥48px wide. **Do NOT render a "showing top 10" disclosure** (CORR-04 satisfied by removal, not a caption).

**EXTEND — empty-state gate** (lines 151-157, current):
```typescript
if (!correlationMatrix || ids.length === 0) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      No correlation data available.
    </div>
  );
}
```
**Change to:** trigger on `< 2` active strategies (the `ids.length < 2` case — a 1×1 grid is forbidden) as well as null. Replace the generic copy with reason-naming copy per UI-SPEC §Copywriting ("Not enough overlap to correlate" + the `<2 strategies` / `<10 days` / combined body). The `<10 overlapping days` case already arrives as `correlationMatrix === null` from the engine (`scenario.ts:192`), so it hits the null branch — but the heatmap can't tell WHICH null reason without help (Pitfall 3). **Prop-shape decision for the planner (A2/Open-Q1):** add an optional `overlappingDays?: number` (or `emptyReason` discriminator) prop so the host (which has `scenarioMetrics.n`) routes the correct named copy while the component stays presentational. Keep the existing empty-state shell shape verbatim.

**KEEP — render contract** (lines 164-227): `role="figure"` + `aria-label`; grid `gap-px bg-border`, `gridTemplateColumns: "80px repeat(N, minmax(48px,1fr))"`; axis labels `text-[10px] uppercase tracking-wider text-text-muted text-center truncate`; cells `font-metric text-xs`, `v.toFixed(2)`, `correlationBg(v)` bg + `textColor(v)` fg; diagonal `#F1F5F9`, missing `#F8F9FA` + `—`; per-cell `role="img"` + `aria-label`.

**Tests that break with truncation removal** (CorrelationHeatmap.test.tsx:100-165) — two tests assert "10 strategies" survives + a low-corr strategy is truncated out:
```typescript
// :100  it("truncates beyond 10 strategies by picking the top 10 by avg |corr|", ...)
// :117  expect.stringContaining("10 strategies")
// :163  // The low-corr strategy was truncated out — its label must NOT render.
```
**REPLACE** these two with show-all assertions (a 12-strategy matrix renders all 12 labels) + reason-named empty-state tests. This is the "test verifies intent" rule — new intent is show-all.

---

### `ScenarioComposer.tsx` (component, host) — CORR-01 (NEW mount) / IMPACT-01 / CORR-03 single-source

**Analog:** `ScenarioBuilder.tsx` (the sibling host that ALREADY mounts the heatmap). ⚠️ **The composer renders NO heatmap today** — this is a NET-NEW mount (Pitfall 2; `grep CorrelationHeatmap ScenarioComposer.tsx` → nothing).

**Inputs already present in the composer** (read-only):
```typescript
// :575-591 — deAliased + scenarioMetrics already computed here
const deAliased = useMemo(() => collapseAliasedHoldingStrategies(
  adapterOutput.strategies, projectionState, symbolByHoldingId), [...]);
const scenarioMetrics = useMemo(
  () => computeScenario(deAliased.strategies, deAliased.state, dateMapCache), [...]);
// scenarioMetrics.correlation_matrix, .avg_pairwise_correlation, .n are ready to pass.
```

**Heatmap mount pattern — copy from `ScenarioBuilder.tsx:206-210 + 435-438`:**
```typescript
// strategyNames map (ScenarioBuilder.tsx:206-210, adapt to deAliased.strategies):
const strategyNames = useMemo(() => {
  const out: Record<string, string> = {};
  for (const s of deAliased.strategies) out[s.id] = s.name; // de-aliased name = CORR-01 label
  return out;
}, [deAliased.strategies]);

// consumer (ScenarioBuilder.tsx:435-438):
<CorrelationHeatmap
  correlationMatrix={scenarioMetrics.correlation_matrix}
  strategyNames={strategyNames}
/>
```
`correlation_matrix` is keyed by the SAME de-aliased ids the engine consumed, so labels and cells align by construction. Mount it in the `lg:grid-cols-2` region near `:1063` (or a new full-width row), wrapped in a `<Card>` like the builder's "Pairwise correlation" card (`ScenarioBuilder.tsx:425-439`).

**IMPACT-01 PROJECTED badge + coverage caveat — slot to reuse** (header :995 + leverage-caveat slot :1050-1061):
```tsx
// :995 header anchor:
<h2 className="text-2xl font-semibold text-text-primary">Scenario</h2>

// :1050-1061 — the EXISTING caveat slot pattern (text-[11px] text-text-muted in this region):
{leverageApplied && (
  <p data-testid="scenario-leverage-caveat" className="mt-2 text-[11px] text-text-muted">
    Leverage modeled as daily-return scaling; ...
  </p>
)}
```
**Apply (per UI-SPEC §4 — neutral-outline pill, NOT `bg-accent`, NOT warning-amber):**
```tsx
{/* PROJECTED badge — next to/under the "Scenario" title */}
<span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted">
  PROJECTED — hypothetical, not your live book
</span>
{/* coverage caveat — reuse the :1053 typography. Copy per UI-SPEC §Copywriting: */}
<p className="mt-2 text-[11px] text-text-muted">
  Projected from {n} overlapping days. Shortest history: {shortestName}. Not a forecast.
</p>
```
`n` = `scenarioMetrics.n`. `shortestName` = the shortest-history de-aliased strategy (see helper below). Badge is informative — plain text, NO `role="alert"` (UI-SPEC §4).

**CORR-03 single-source:** pass `scenarioMetrics.avg_pairwise_correlation` to BOTH the KpiStrip cell (already wired via `mode="scenario"` at :1036-1047) and the heatmap "Avg |ρ|" caption — compute ONCE, do not let the heatmap derive its own average.

---

### `ScenarioBuilder.tsx` (component, host) — SURF-02 badge / IMPACT-01 / CORR-03 relabel

**Analog:** `ScenarioComposer.tsx` (sibling badge/caveat slot pattern, above). ScenarioBuilder ALREADY mounts the heatmap (`:435`) and computes `strategyNames` (`:206-210`) and `metrics` (`:201-204`).

**Relabel the "Avg |corr|" MetricCard** (lines 283-286) → reconcile to "|ρ|" wording (CORR-03 wants ONE definition across the surface):
```tsx
<MetricCard
  label="Avg |corr|"   // → reconcile label to "Avg |ρ|"
  value={formatNumber(metrics.avg_pairwise_correlation)}
/>
```

**Existing heatmap card to place the PROJECTED badge near** (lines 425-439): the `<Card>` with `<h2>Pairwise correlation</h2>` + "Teal = diversifying, orange = concentrated." caption. Add the SAME PROJECTED neutral-outline pill + coverage caveat as the composer (copy the badge/caveat JSX from the ScenarioComposer assignment), plus the "Example universe" badge (SURF-02 — neutral-outline pill, copy `Example universe`) near the title block (`:266`).

> ⚠️ No `ScenarioBuilder.test.tsx` exists today (Wave 0 gap). The honesty surfaces + neuter guard for this surface need a NEW test file (see test section).

---

### `KpiStrip.tsx` (component, KPI cell) — CORR-03 relabel + single-source

**Analog:** self. The "Avg ρ" cell already sources `avg_pairwise_correlation` (the off-diagonal absolute mean).

**Core pattern — the cell to relabel** (lines 415-421):
```typescript
{
  label: "Avg ρ",                              // → CHANGE to "Avg |ρ|"
  raw: allKeysStale ? null : avgRhoValue,
  formatted: formatNumber(allKeysStale ? null : avgRhoValue, 2),
  sub: resolveAvgRhoSub(avgRhoValue),
  metricKey: "avg_pairwise_correlation",
}
```
**Change LABEL ONLY.** `avgRhoValue` (:331) already flows from `avg_pairwise_correlation` — no value change, no pending-semantics change (`AVG_RHO_PENDING_SUB` / stale → null preserved per UI-SPEC §5).

> ⚠️ `KpiStrip.scenario.test.tsx` (and possibly `KpiStrip.test.tsx`) assert the literal "Avg ρ" — update the expectation to "Avg |ρ|" in the SAME change (the failing test is the correct signal, not a regression). Grep before editing: `grep -rn "Avg ρ" src/app/\(dashboard\)/allocations/components/KpiStrip*.test.tsx`.

---

### `shortestHistoryName` helper (possible NEW pure utility) — IMPACT-01 supporting

**Analog:** `pickTopTenByAvgCorr` (`CorrelationHeatmap.tsx:128-143`, the reduce-over-strategies pure fn being removed) for the SHAPE; `collapseAliasedHoldingStrategies` (`scenario-dealias.ts`) for the location/export convention.

**Pattern shape to follow** (the removed truncation fn — a pure reduce returning a derived value from the strategy set):
```typescript
function pickTopTenByAvgCorr(matrix: Record<string, Record<string, number>>): string[] {
  const all = Object.keys(matrix);
  // ... pure reduce, no side effects, unit-testable ...
}
```

**Apply:** a tiny pure `shortestHistoryName(strategies)` reducing over each de-aliased strategy's `daily_returns` window (length / earliest date) to return the name with the shortest common history. `StrategyForBuilder.daily_returns[]` is present client-side (`scenario.ts:57`, per Assumption A1) so it is computable with NO new server field. Call it adjacent to `scenarioMetrics` in BOTH the composer and the builder so the caveat name is consistent. **This is the only net-new logic in the phase** (Open-Q2) and is unit-testable — give it a dedicated small test.

---

### `scenarios/page.tsx` (route, role gate) — SURF-03 — NO CHANGE

**Analog:** self — read-only confirmation. The security boundary already exists and is test-pinned.

**Core gate** (lines 45-52):
```typescript
const { data: profile } = await supabase
  .from("profiles").select("role").eq("id", user.id).maybeSingle();
const isAllocator = profile?.role === "allocator" || profile?.role === "both";
if (!isAllocator) redirect("/");
// THEN createAdminClient() — the gate fires BEFORE the RLS-bypassed read.
```
Admin-only roles do NOT pass (`allocator`/`both` only) — consistent with the strict `isAllocator` sidebar gate. SURF-03 must NOT weaken this. `page.role-gate.test.ts` already proves the gate fires before the admin-client read.

---

## Shared Patterns

### PROJECTED honesty badge (IMPACT-01)
**Source token:** UI-SPEC §4 neutral-outline pill — mirrors the `csv_uploaded` trust-tier "outline, no fill" DESIGN.md pattern. **Note:** `src/components/ui/Badge.tsx` is a FILLED type/status badge (`bg-*/10 text-*`) — it is the WRONG token for honesty framing (filled reads as a category tag). Use the inline neutral-outline span, NOT `<Badge>`.
**Apply to:** ScenarioComposer header (:995) AND ScenarioBuilder title block.
```tsx
<span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted">
  PROJECTED — hypothetical, not your live book
</span>
```

### Coverage caveat slot (IMPACT-01)
**Source:** `ScenarioComposer.tsx:1050-1061` (the `scenario-leverage-caveat` slot — `mt-2 text-[11px] text-text-muted`).
**Apply to:** composer + builder. Copy: `Projected from {N} overlapping days. Shortest history: {strategyName}. Not a forecast.`

### Correlation-sign palette (CORR-01)
**Source:** `CorrelationHeatmap.tsx:51-72` (`PALETTE` + `correlationBg`) + `:112-116` (`pickTextColor`).
**Apply to:** every heatmap consumer. Teal=diversifying, orange=concentration. NEVER import `factsheet/v2/palette.ts`.

### Single-sourced "Avg |ρ|" (CORR-03)
**Source:** `scenarioMetrics.avg_pairwise_correlation` (engine `scenario.ts:399-400`, off-diagonal absolute mean).
**Apply to:** KpiStrip cell (`KpiStrip.tsx:416`) + heatmap caption — ONE computed value passed to both.

### Role-gated render (SURF-02/03)
**Source:** `Sidebar.tsx:58-72` (push-on-boolean) + `scenarios/page.tsx:50-52` (server boundary).
**Apply to:** Sidebar Sandbox link — gate on `isAllocator` ONLY (NOT `showsAllocatorWorkspace`).

### Neuter-check / ABSENT guard (IMPACT-02)
**Source:** `ScenarioComposer.test.tsx:2163-2186` (the "R3 guard").
**Apply to:** strengthen the composer guard (add `PercentileRankBadge` ABSENT) + REPLICATE for the Sandbox (ScenarioBuilder).
```typescript
it("R3 guard — the projection renders NO peer/allocator/comparator factsheet panels", () => {
  render(<ScenarioComposer payload={payload} allocatorId={ALLOCATOR_A} allocatorMandate={null} />);
  expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument();   // positive control
  expect(document.getElementById("factsheet-allocator")).toBeNull();
  expect(document.getElementById("factsheet-signatures")).toBeNull();
  expect(screen.queryByText(/percentile/i)).toBeNull();
  expect(screen.queryByText(/ranked against peers/i)).toBeNull();
});
// Phase 21 EXTENSION: also assert PercentileRankBadge is ABSENT
// (src/components/strategy/PercentileRankBadge.tsx — CONFIRMED EXISTS — is the
// concrete peer panel), and REPLICATE the whole guard for ScenarioBuilder.
```
The structure is a **positive control** (`kpi-strip-mock` present) + **ABSENT assertions** (`queryBy*` → `null` / `getElementById` → `null`). Any future wiring of a peer panel trips it. Model new role-gating tests (Sidebar) on `scenarios/page.role-gate.test.ts`.

---

## No Analog Found

None. Every Phase 21 surface has a verified in-repo analog (this is a brownfield wiring phase). The two NEW test files reuse existing test models:

| File | Role | Reason it's "new" | Model to copy |
|------|------|-------------------|---------------|
| `src/components/layout/Sidebar.sandbox-link.test.tsx` | test | No Sidebar component test exists yet (Wave 0 gap) | `scenarios/page.role-gate.test.ts` (role-show/hide assertions) |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` | test | No ScenarioBuilder test file exists yet (Wave 0 gap) | `ScenarioComposer.test.tsx` R3 guard :2163-2186 + badge/caveat presence assertions |

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/`, `src/app/(dashboard)/scenarios/`, `src/components/layout/`, `src/components/portfolio/`, `src/components/scenarios/`, `src/components/ui/`, `src/components/strategy/`, `src/lib/` (engine read-only).
**Files scanned (direct reads):** AllocationsTabs.tsx, Sidebar.tsx, CorrelationHeatmap.tsx (full), ScenarioBuilder.tsx, ScenarioComposer.tsx (header/inputs regions), KpiStrip.tsx (cell region), ScenarioComposer.test.tsx (R3 guard), scenarios/page.tsx (gate), Badge.tsx (full) + grep confirms (avgRhoValue source, truncation tests, PercentileRankBadge existence).
**Key cross-cutting fact:** engine (`scenario.ts`, `scenario-dealias.ts`) is FROZEN — ZERO engine tasks. Every capability is realized; the work is surfacing/mounting/relabeling/guarding.
**Pattern extraction date:** 2026-06-21
