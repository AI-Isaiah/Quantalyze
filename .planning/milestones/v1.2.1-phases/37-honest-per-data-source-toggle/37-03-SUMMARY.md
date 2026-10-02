---
phase: 37-honest-per-data-source-toggle
plan: 03
subsystem: allocations / scenario composer (client UI + projection)
tags: [scenario, composer, ui, per-key-dailies, allocations, dsrc-02, dsrc-03]
requirements: [DSRC-02, DSRC-03]
dependency_graph:
  requires:
    - "37-01 payload channel (perKeyReturnsByApiKeyId, perKeyDailiesGateSatisfied, eligibleApiKeyIds on MyAllocationDashboardPayload)"
    - "37-02 sibling builder buildPerKeyStrategyForBuilderSet (one StrategyForBuilder per api_key_id, raw equity-share weights, default selected=true)"
    - "Frozen computeScenario engine (scenario.ts) — renormalizes per-day over the selected set; returns null KPIs + [] curve when activeIds.length===0; SCENARIO-05 never forked"
  provides:
    - "Gated 'Data sources' control in the own-book composer (DSRC-02): one include/exclude switch per connected exchange api_key, book mode + D3 gate only"
    - "Engine-native honest recompute on exclusion (DSRC-03): the ephemeral toggle threads into projectionState.selected[api_key_id], so the frozen engine re-blends the curve + every KPI from the remaining per-key series — never a cosmetic hide"
    - "Honest-absence shells: InfoBanner on the D3 fallback, EmptyStateCard on all-excluded (KPIs fall to '—'); both calm, no role=alert"
  affects:
    - "Phase 38 (composer factsheet-parity chart + blank-mode equity fix) builds on this surface"
tech_stack:
  added: []
  patterns:
    - "Ephemeral what-if overlay via fresh useState (mirror R4 leverageByRef) — NOT persisted to scenario.draft, NOT toggleByScopeRef, never in the commit diff (Pitfall 5)"
    - "Engine-native renormalization — raw equity-share weights, selected[id]=false; the engine divides r/activeWeightSum over the selected set (Pitfall 1: NO manual sum-to-1)"
    - "Per-key UUID units pass collapseAliasedHoldingStrategies untouched (not in symbolByHoldingId) — avg-ρ across data sources stays honest (Pitfall 3)"
    - "Local duplication of the server-only holdingEquityContribution + the SyncBadge EXCHANGE_LABELS recipe (client/server boundary + no shared export)"
    - "Independent two→one recompute oracle in the test (real builder + real collapse + real engine) — the load-bearing DSRC-03 honesty assertion"
key_files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx"
decisions:
  - "holdingEquityContribution is duplicated LOCALLY (holdingEquityContributionLocal) rather than imported from @/lib/queries — queries.ts is `server-only`, so importing its export into this 'use client' module crosses the client/server boundary and crashes the bundle (Rule 3). The local mirror is byte-identical in logic (derivative→unrealized_pnl_usd, spot→value_usd, non-finite→0), consistent with the per-key sibling's own local duplication (PATTERNS §No Analog Found)."
  - "The per-key honesty tests keep buildPerKeyStrategyForBuilderSet REAL via importOriginal in the adapter mock (only buildStrategyForBuilderSet stays spied), and @/lib/scenario is never mocked — so the DSRC-03 oracle drives the genuine builder + frozen engine. A spied builder would defeat the load-bearing 'numbers move' assertion. Mutation-verified: a cosmetic hide (selected not threaded) turns the honesty test RED."
  - "Toggle semantics = role=switch + aria-checked (consistent across all rows). Included = accent outline (no fill), excluded = neutral outline, never red (UI-SPEC §2 honesty-color rule). The control renders directly below the entry-mode row and above the KpiStrip; the all-excluded EmptyStateCard renders in the projection region after the KpiStrip (which itself shows '—' via the engine's null path)."
  - "showDataSources = entryMode==='book' && payload.perKeyDailiesGateSatisfied (=== usePerKeySources, the same gate that selects the per-key strategy set into the engine pipeline). Book mode + !gate → InfoBanner fallback; blank mode → nothing. Both honest-absence surfaces carry no role=alert."
metrics:
  duration: "~28 min"
  completed: "2026-06-25"
  tasks: 3
  files_changed: 4
  commits: 5
---

# Phase 37 Plan 03: Honest per-data-source toggle Summary

The own-book ScenarioComposer now renders a gated **"Data sources"** control
(one include/exclude switch per connected exchange `api_key`, book mode + D3 gate
only) whose every toggle threads an **ephemeral** include map into the existing
`projectionState.selected` channel keyed by `api_key_id` — so the **frozen
`computeScenario` engine honestly re-blends the curve and every KPI**
(Sharpe / vol / maxDD / return / avg-ρ) from the remaining per-key series on
exclusion (DSRC-03), never a cosmetic hide. The recompute is engine-native (no
manual renorm, no engine fork), the toggle is never persisted or in the commit
diff, and the honest-absence states (D3 fallback → InfoBanner; all-excluded →
EmptyStateCard + "—" KPIs) are calm, not errors.

## What Was Built

**Task 1 — per-key wiring + ephemeral toggle + projectionState thread (feat, `3c1d8cdd`):**
- Added `const [includeByApiKeyId, setIncludeByApiKeyId] = useState<Record<string, boolean>>({})`
  (default `{}` = all included), modeled EXACTLY on R4 `leverageByRef`: not
  persisted to `scenario.draft`, not routed through `toggleByScopeRef`, never in
  the commit diff, resets on reload (Pitfall 5).
- Added `handleDataSourceToggle(apiKeyId, include)` (fail-loud, visible-state; a
  boolean never clamps).
- Derived `equityByApiKeyId` (Σ per-key equity share, D2) via a LOCAL
  `holdingEquityContributionLocal` mirror of the server-only
  `holdingEquityContribution` (derivative→`unrealized_pnl_usd`, spot→`value_usd`,
  non-finite→0) — `@/lib/queries` is `server-only` and cannot be imported here.
- Memoized `perKeyAdapterOutput = buildPerKeyStrategyForBuilderSet(payload.perKeyReturnsByApiKeyId ?? {}, equityByApiKeyId)`.
- `usePerKeySources = entryMode==='book' && payload.perKeyDailiesGateSatisfied`;
  `activeAdapterOutput` switches the engine pipeline between the per-key set and
  the existing holdings `adapterOutput` set (snapshot fallback — both paths
  coexist).
- In `projectionState`, for the per-key path `selected[s.id] = includeByApiKeyId[s.id] ?? true`
  (s.id === api_key_id), weights stay RAW (engine renormalizes — Pitfall 1); the
  holdings path keeps its `toggleByScopeRef` semantics. `deAliased` now collapses
  `activeAdapterOutput.strategies` → single `computeScenario` call site (no fork,
  SCENARIO-05). Per-key UUIDs are NOT in `symbolByHoldingId` → pass collapse
  untouched (Pitfall 3).

**Task 2 — gated "Data sources" control + honest-absence shells (feat, `1c96967d`):**
- `role="group"` aria-label "Data sources" (`data-testid="scenario-data-sources"`)
  with a 12px uppercase caption heading + the ephemerality helper, then one
  `role="switch"` row per eligible key (`payload.apiKeys` ∩ `eligibleApiKeyIds`).
- Row label `{Exchange} — {nickname}` or `{Exchange} — ••••{id.slice(-4)}` (masked
  tail in `font-mono`/`text-text-muted`, never the full id/secret); per-row
  `aria-label` `Include {Exchange} — {label} in projection`; included = accent
  outline (no fill), excluded = neutral outline, never red; ≥44px row, focus-ring.
- Local `EXCHANGE_LABELS` + `dataSourceLabel` (SyncBadge recipe).
- Book mode + !gate → `<InfoBanner>` fallback note (`scenario-data-sources-fallback`,
  no role=alert). Blank mode → nothing. All-excluded → `<EmptyStateCard>` in the
  projection region (`scenario-data-sources-empty`) + KpiStrip falls to the
  engine's null-KPI "—" path; re-include restores. No new design token.

**Task 3 — DSRC-03 honesty oracle + a11y + ephemerality + no-collapse + gating (test, `a1f7cf43`):**
- `makePerKeyPayload` fixture: two materially-different per-key series (key-A
  steady-positive low-vol, key-B volatile net-negative), 70k/30k equity shares,
  book mode + D3 gate satisfied, two eligible keys.
- **Load-bearing DSRC-03 test:** capture KpiStrip `scenarioMetrics` with both
  included (equals an independent two-key recompute), toggle key B off, assert
  Sharpe/maxDD/twr + equity-curve endpoint (a) MOVE and (b) MATCH an independent
  two→one recompute built from the REAL `buildPerKeyStrategyForBuilderSet` + REAL
  `collapseAliasedHoldingStrategies` + REAL `computeScenario`. An oracle, not a
  "changed" check.
- All-excluded → EmptyStateCard + null KPIs (never stale) + re-include restores;
  ephemerality (Pitfall 5: a toggle never changes diffCount / commit-disabled);
  per-key no-collapse (Pitfall 3: two same-symbol per-key units → 2×2 corr
  matrix); gating (book/blank/fallback); a11y (per-row aria-label + aria-checked
  flip + group name).
- Adapter mock switched to `importOriginal` so the per-key builder is REAL.

## Verification

- `npx vitest run "…/ScenarioComposer.test.tsx"` → **86 tests passed** (78 prior +
  8 new data-sources cases); `-t "data sources"` selects and passes the 8 new.
- `npx vitest run …/ScenarioComposer.save.test.tsx …/scenario-state-preservation.test.tsx …/ScenarioComposer.test.tsx`
  → **98 passed** (the two integration suites repaired).
- `npx vitest run scenario-adapter.test.ts queries.my-allocation.test.ts getMyAllocationDashboard.scenario.test.ts`
  → **116 passed** (upstream wave-1/2 suites: no regression).
- `npm test` (full TS suite) → **6606 passed | 284 skipped, 0 failed**.
- `npx tsc --noEmit` → **0 errors**.
- **Mutation-verified falsifiable:** rewiring the per-key `selected` thread to a
  constant `true` (a cosmetic hide) turns the DSRC-03 honesty test AND the
  all-excluded test RED; restoring the real thread returns them green.
- Acceptance greps: `includeByApiKeyId` × 7 (useState + handler + thread + deps);
  `buildPerKeyStrategyForBuilderSet(` × 1 (one builder call site);
  `computeScenario(` — one engine call site (unchanged from baseline);
  `toggleByScopeRef` — read only on the holdings path (per-key toggle never
  writes it); `scenario-data-sources` × 3; no NEW `role="alert"` (the only match
  is inside a comment); no new color/spacing token in the diff.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Client/server boundary] Local mirror of `holdingEquityContribution` instead of import**
- **Found during:** Task 1 (first test run after wiring).
- **Issue:** The plan/PATTERNS said "import `holdingEquityContribution` from
  `@/lib/queries`, do NOT re-derive from value_usd". But `@/lib/queries` is
  `server-only`; importing its export into this `"use client"` module threw
  *"This module cannot be imported from a Client Component module"* and broke the
  entire composer suite (78 → "no tests").
- **Fix:** Added a module-scoped `holdingEquityContributionLocal` that mirrors the
  SSR helper's logic byte-for-byte (derivative→`unrealized_pnl_usd`,
  spot→`value_usd`, non-finite→0), kept in lockstep via a doc comment. This is the
  same local-duplication seam the 37-02 sibling builder used for the same reason
  (PATTERNS §"No Analog Found"). The plan's intent ("do not re-derive from
  value_usd alone, which is derivative notional") is fully honored.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `3c1d8cdd`

**2. [Rule 1/3 — Sibling-mock crash] Repaired two integration suites + a fixture**
- **Found during:** the full `npm test` phase gate (Task 3 verify).
- **Issue:** `AllocationsTabs.scenario-state-preservation.test.tsx` and
  `ScenarioComposer.save.test.tsx` module-mocked `scenario-adapter` exporting only
  `buildStrategyForBuilderSet`. The new `buildPerKeyStrategyForBuilderSet` import
  in the composer resolved to `undefined` in those mocks → 12 render crashes.
  `save.test`'s fixture also omitted the three Plan-01 per-key fields, so
  `payload.perKeyReturnsByApiKeyId` was `undefined` at runtime.
- **Fix:** Switched both mocks to `importOriginal` (keep the sibling REAL; the
  per-key path is inactive there with gate=false). Backfilled the `save.test`
  fixture with the three per-key fields. Also hardened the composer (Rule 2):
  `buildPerKeyStrategyForBuilderSet(payload.perKeyReturnsByApiKeyId ?? {}, …)` and
  `dataSourceKeys` with `?? []`, so a partial/legacy payload never crashes the
  composer.
- **Files modified:** `ScenarioComposer.tsx`,
  `AllocationsTabs.scenario-state-preservation.test.tsx`,
  `ScenarioComposer.save.test.tsx`
- **Commit:** `0ecd30b5`

No authentication gates occurred.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. All four
STRIDE mitigations are pinned:
- **T-37-03-01** (row labels): labels come only from the allocator's OWN
  `payload.apiKeys` filtered to `eligibleApiKeyIds`; the no-nickname fallback
  masks all but the last 4 of the api_key_id (never the full key, never a secret).
- **T-37-03-02** (toggle leaking into commit): ephemeral `useState`; the
  ephemerality test asserts `diffCount` / commit-disabled unchanged on toggle.
- **T-37-03-03** (cosmetic hide): the DSRC-03 honesty oracle asserts the numbers
  move and match an independent two→one recompute; mutation-verified RED on a hide.
- **T-37-03-04** (stale number on all-excluded): the engine's null-KPI/empty-curve
  path + EmptyStateCard; the test asserts null KPIs (never a prior number).

No package install (T-37-SC accept).

## Known Stubs

None. The control renders real per-key data from Plan 01's payload, recomputes
through the real frozen engine, and the honest-absence shells are the intended
terminal states (not placeholders). The holdings/snapshot fallback path is
preserved unchanged for the gate-not-satisfied case.

## Self-Check: PASSED

- FOUND: `.planning/phases/37-honest-per-data-source-toggle/37-03-SUMMARY.md`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- FOUND commit: `3c1d8cdd` (Task 1, feat — wiring + ephemeral toggle)
- FOUND commit: `1c96967d` (Task 2, feat — gated control + shells)
- FOUND commit: `a1f7cf43` (Task 3, test — honesty oracle + a11y + ephemerality)
- FOUND commit: `0ecd30b5` (deviation fix — fail-safe wiring + sibling-mock repair)
