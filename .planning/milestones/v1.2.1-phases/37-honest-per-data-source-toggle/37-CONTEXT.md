# Phase 37: Honest per-data-source toggle - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas proposed in batch tables, all three areas accepted as recommended.

<domain>
## Phase Boundary

The scenario composer can include/exclude **each connected exchange `api_key`** as a
data source, and exclusion **truly recomputes** the equity curve + all KPIs from the
remaining per-key series — never a cosmetic hide over an unchanged blended number.

Delivers DSRC-01/02/03:
- **DSRC-01** — `scenario-adapter.ts` keys its projection units per `api_key` (per data
  source), not per blended book.
- **DSRC-02** — the composer surfaces a per-data-source toggle UI to include/exclude each
  API key from the projection.
- **DSRC-03** — excluding a key honestly recomputes the curve and KPIs from the remaining
  per-key series (now possible because the per-key series exist from Phase 35/36).

**In scope:**
1. Expose the per-`api_key` daily-return series (Phase 36's `perKeyReturnsByApiKeyId`) +
   the per-key eligibility/gate result to the composer via the dashboard payload — today
   it is computed internally in `getMyAllocationDashboard` for the Overview KPIs only and
   never reaches the client.
2. Re-key the scenario adapter to build one projection unit per `api_key` from those
   series (mirroring Phase 36's Overview blend), behind the same D3 eligibility gate.
3. A per-data-source toggle UI (include/exclude each key) wired into the projection state,
   alongside the existing weight/leverage what-if overlays.
4. Honest instant recompute of curve + KPIs from the remaining keys on every toggle.

**Out of scope:**
- Composer factsheet-parity chart + blank-mode equity fix — **Phase 38**.
- Overview dashboard stats — already repointed in Phase 36 (this phase only touches the
  composer/adapter, reusing Phase 36's per-key helpers).
- Per-key factsheet surface — v2 (UNIFY-V2-01).
- The snapshot-basis fallback path keeps its current behavior (no per-source toggle when
  per-key dailies don't cover all eligible keys — see Decisions).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Data-source toggle model & scope
- **Unit = one toggle per connected exchange `api_key`** (the same blend unit Phase 36's
  Overview uses). Not per venue, not per holding.
- **Book mode only.** Blank mode has no live book / no live keys, so the data-source toggle
  is a book-mode affordance. The existing `entryMode` switch already gates the live book;
  the toggle lives behind the same gate.
- **Default state = all sources included** (identical to today's full-book projection — a
  no-op until the user actually excludes a key).
- **Fallback (Phase 36 D3): when per-key dailies do NOT cover all eligible keys, HIDE the
  toggle** and show a short honest note that per-source modeling needs per-key history; the
  composer stays on the existing blended baseline (no degraded/dishonest per-source mode).
  This mirrors the Overview's all-or-nothing per-key gate — never mix two bases in one curve.

### Area 2 — Recompute semantics & honesty
- **Instant recompute** on every toggle, via the SAME client-side adapter + frozen
  `computeScenario` path that weight/leverage overlays already use (no debounce in v1).
- **Both the equity curve AND every KPI** (Sharpe / volatility / max-drawdown / return /
  avg-ρ) recompute from the remaining per-key series. This is the DSRC-03 honesty core —
  exclusion changes the underlying blend, not just what is shown.
- **When ALL sources are excluded → honest empty/zeroed projection state** with a "select at
  least one data source" message. Never a stale or last-known blended number. (Do not hard-
  block the last toggle-off; show the honest empty instead.)
- **Re-normalize remaining keys' weights to sum to 1** when a source is excluded (drop the
  excluded key's weight share); the curve is anchored to the remaining keys' AUM share. The
  per-key weight source is each key's current equity share (Phase 36 D2), grouped by
  `api_key_id` — no new weight source.

### Area 3 — Toggle UI placement & labeling (exact visuals → UI-SPEC)
- **A compact "Data sources" control near the top of the composer**, one row per key. Exact
  placement/visual deferred to the UI-SPEC (next step).
- **Label = exchange display name + key nickname** (e.g. "Binance — Main"); fall back to a
  masked key identifier when no nickname exists.
- **Minimal v1**: name + include/exclude only. No per-source sparkline/contribution-% in v1.
- **Toggle state is ephemeral** (like the R4 leverage overlay): held in component state, NOT
  persisted to the saved-scenario draft, and NOT part of any commit diff. Resets on reload.

### Claude's Discretion (planner's call)
- The exact payload seam for exposing the per-key series + eligibility: add
  `perKeyReturnsByApiKeyId` (and the gate boolean / eligible-key ids) to
  `MyAllocationDashboardPayload`, OR a narrower composer-specific projection. Keep the
  smallest diff that does not disturb the existing `liveBaselineMetrics` /
  `holdingReturnsByScopeRef` contract (Phase 36 pinned those byte-identical).
- The adapter seam: a new per-key code path in `buildStrategyForBuilderSet` vs a sibling
  builder selected by the D3 gate. Prefer the smallest diff; the frozen `scenario.ts` engine
  (SCENARIO-05) must NOT be forked.
- How the toggle state threads into `projectionState` (the existing memo that overlays
  weight/leverage/selected onto the adapter output already has a `selected` channel —
  per-key exclusion likely rides that same channel keyed by api_key unit).
- Whether per-key weights re-normalize inside the adapter or in the composer's
  `projectionState` overlay.
</decisions>

<code_context>
## Existing Code Insights (terrain map, 2026-06-25)

- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — `buildStrategyForBuilderSet`
  (positional, B4-pinned) currently builds projection units **per holding** (id =
  `holding:{venue}:{symbol}:{holding_type}`) + per added strategy, reading
  `holdingReturnsByScopeRef`. It already supports a `disabledHoldingRefs` set that marks
  `state.selected[ref] = false`. DSRC-01 re-keys these units to `api_key`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — feeds
  `holdingsSummary` (per-symbol, **carries `api_key_id`** — payload type line ~1625) through
  the adapter. The `disabledHoldingRefs` it passes is currently the EMPTY set (read-only-
  tokens model; holdings are fixed context). The `projectionState` memo (~line 1238) already
  overlays draft `selected` / weight / leverage onto the adapter output before the
  collapse + `computeScenario` — the natural seam for per-key exclusion. Weight + leverage
  change handlers are fail-loud (clamp + visible message); mirror that posture.
- `src/lib/queries.ts` — `getMyAllocationDashboard` (~3050+) already computes
  `perKeyReturnsByApiKeyId = buildPerKeyReturnsByApiKeyId(...)` (~3075), the eligible-key set,
  and `allActiveKeysHavePerKeyDailies(...)` gate (~3089) to pick the per-key vs snapshot
  baseline — but **does NOT return `perKeyReturnsByApiKeyId` in the payload** (only
  `holdingReturnsByScopeRef` + `liveBaselineMetrics` go out, ~3437). Phase 37 must expose it.
  Reusable Phase-36 helpers: `buildPerKeyReturnsByApiKeyId`, `allActiveKeysHavePerKeyDailies`,
  `isPerKeyDailiesEligibleKey`, `liveBaselineMetricsFromPerKeyDailies`.
- `payload.apiKeys: Array<{...}>` (type ~line 1558) + `holdingsSummary[].api_key_id` give the
  composer the key→label mapping (exchange + nickname) for the toggle rows.
- `computeScenario` (`src/lib/scenario.ts`) — FROZEN engine (SCENARIO-05). Reuse, never fork.
- `collapseAliasedHoldingStrategies` (`@/lib/scenario-dealias`) — multi-venue de-alias runs
  before `computeScenario`; per-key units must stay compatible with the collapse + avg-ρ
  honesty (a per-key unit is already a single blended series, so aliasing concerns differ).

## Tests that will need updating / adding
- `scenario-adapter.test.ts` — add per-key-unit keying + exclusion cases (a pinned test
  proves an excluded key drops out of the projection, not a cosmetic hide).
- `ScenarioComposer.test.tsx` — toggle UI present in book mode, absent in blank mode + in
  fallback population; all-excluded honest empty state; instant recompute on toggle.
- `queries.my-allocation.test.ts` / `getMyAllocationDashboard.scenario.test.ts` — assert the
  per-key series + eligibility now appear in the payload without disturbing existing fields.
</code_context>

<specifics>
## Specific Ideas
- Honesty is the load-bearing requirement: a regression test must prove excluding a key
  changes the blended curve + KPIs (compare metrics before/after), never just hides a row.
- The fallback (no per-source toggle when per-key dailies are incomplete) must be honest and
  silent-degrade-free: a short note, not a red error — mirrors Phase 36's all-or-nothing gate.
- Keep `liveBaselineMetrics` + `holdingReturnsByScopeRef` byte-identical (Phase 36 pinned the
  composer baseline on them) — Phase 37 ADDS a per-key channel, it does not repoint the
  existing one.
</specifics>

<deferred>
## Deferred Ideas
- Per-source contribution-% / sparkline in the toggle rows — v2 (kept minimal per Area 3 Q3).
- Persisting toggle state to the saved-scenario draft — deferred (ephemeral in v1, Area 3 Q4).
- Composer factsheet-parity chart + blank-mode equity fix — Phase 38.
- Debounced recompute — only if instant recompute proves janky at scale (not expected;
  weight/leverage already recompute instantly).
</deferred>
