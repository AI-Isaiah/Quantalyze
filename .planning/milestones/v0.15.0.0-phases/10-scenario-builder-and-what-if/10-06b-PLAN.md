---
phase: 10
plan: 06b
type: execute
wave: 5
depends_on: [10-01, 10-03, 10-04, 10-05, 10-06a]
files_modified:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
autonomous: true
requirements: [SCENARIO-01, SCENARIO-03, SCENARIO-04, SCENARIO-05, SCENARIO-06, SCENARIO-08, SCENARIO-09]
must_haves:
  truths:
    - "ScenarioComposer body renders top-to-bottom: KpiStrip mode='scenario', EquityChart + DrawdownChart with overlays, Bridge inline card (when flagged), Composition list, Browse strategies CTA row, sticky footer"
    - "Composition list shows toggle switch + symbol + weight input + per-row delta + Compare/Remove actions; toggled-OFF rows render at opacity 0.5 with strikethrough + disabled weight input"
    - "computeScenario is called with adapter output; equity_curve is converted +1 wealth before passing to EquityChart and ×scenarioAUM before passing to DrawdownChart (Pitfall 1)"
    - "Adapter is called with addedStrategies as AddedStrategy[] (NOT pre-cast StrategyForBuilder[]) along with addedStrategyReturnsLookup + addedStrategyMetadataLookup maps built from payload.strategies (B4 — pinned signature)"
    - "Reset opens destructive confirmation modal; on confirm: clears localStorage + reinitializes draft from current live holdings"
    - "Empty-portfolio path: holdingsSummary.length===0 → renders EmptyState with dual CTA (Connect Exchange + Browse strategies)"
    - "Fingerprint-mismatch banner renders inline when stored fingerprint != current; default-focus on 'Keep my draft'; dismissible"
    - "AllocationsTabs branches scenario panel: under allocations.ui_v2 flag → ScenarioComposer; legacy v1 → existing ScenarioStub UNCHANGED"
    - "Performance tab + all other 5 tabs UNCHANGED (Phase 09.1 invariants intact); only the Scenario panel branches under the v2 flag"
  artifacts:
    - path: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
      provides: "Full scenario tab body — KpiStrip + charts + composition list + drawers integration + sticky footer (consumes Plan 06a hook + footer)"
      exports: [ScenarioComposer, ScenarioComposerProps, ScenarioCommitDiff]
    - path: src/app/(dashboard)/allocations/AllocationsTabs.tsx
      provides: "Existing tab shell + new v2-branch wiring for ScenarioComposer"
      contains: "ScenarioComposer"
  key_links:
    - from: "ScenarioComposer.tsx"
      to: "scenario-state.ts + scenario-adapter.ts (Plan 01) + computeScenario (frozen)"
      via: "useScenarioState (Plan 06a) → buildStrategyForBuilderSet → computeScenario"
      pattern: "buildStrategyForBuilderSet"
    - from: "ScenarioComposer.tsx → buildStrategyForBuilderSet"
      to: "addedStrategyReturnsLookup + addedStrategyMetadataLookup"
      via: "Maps built from payload.strategies, NO pre-casting (B4 pinned)"
      pattern: "addedStrategyReturnsLookup\\|addedStrategyMetadataLookup"
    - from: "ScenarioComposer.tsx → EquityChart"
      to: "scenarioMetrics.equity_curve with +1 wealth conversion"
      via: "scenarioMetrics.equity_curve.map(p => ({date: p.date, value: p.value + 1}))"
      pattern: "value: .*\\.value \\+ 1"
    - from: "ScenarioComposer.tsx → DrawdownChart"
      to: "scenarioMetrics.equity_curve scaled by scenario AUM"
      via: "wealth-multiplier × scenarioAum"
      pattern: "scenarioAum\\|totalScenarioAum"
    - from: "AllocationsTabs.tsx scenario panel"
      to: "isUiV2 flag (Phase 09.1 D-17)"
      via: "isUiV2 ? <ScenarioComposer /> : <ScenarioStub />"
      pattern: "isUiV2.*ScenarioComposer"
    - from: "ScenarioComposer.tsx Browse strategies CTA"
      to: "StrategyBrowseDrawer (Plan 05) onAdd → addStrategyBrowse"
      via: "useScenarioState mutator (Plan 06a)"
      pattern: "addStrategyBrowse"
    - from: "ScenarioComposer.tsx Bridge inline card"
      to: "BridgeDrawer onAddToScenario → addStrategyBridge"
      via: "useScenarioState mutator (Plan 06a)"
      pattern: "addStrategyBridge"
---

<objective>
Assemble the full Scenario tab body (split off from the original Plan 06 per checker W1). Build (a) `ScenarioComposer.tsx` orchestrating KpiStrip + EquityChart + DrawdownChart + composition list + Bridge inline card + Browse drawer using the Plan 06a `useScenarioState` hook + `ScenarioFooter`; (b) wire the v2 branch in `AllocationsTabs.tsx` so the Scenario panel renders `ScenarioComposer` when `allocations.ui_v2` is on, and the legacy `ScenarioStub` otherwise.

The composer adapter call uses the **B4-pinned signature**: `buildStrategyForBuilderSet` is called with `addedStrategies: AddedStrategy[]` (lightweight, NOT pre-cast to StrategyForBuilder), plus two new lookup maps `addedStrategyReturnsLookup` and `addedStrategyMetadataLookup` constructed from `payload.strategies`. This keeps the type contract honest across Plan 01, Plan 06b, and RESEARCH Pattern 2.

Purpose: The composer is where SCENARIO-01 + SCENARIO-03/04/05/06/08/09 manifest as a working UI. The Commit drawer (the path through Bridge outcome recording — SCENARIO-07) lands in Plan 07; this plan ships the Commit BUTTON (sticky-footer right CTA) but routes the click to a stub callback Plan 07 will replace with the real drawer.
Output: 2 new components/wiring + 2 vitest files + AllocationsTabs extension. Existing AllocationsTabs.test.tsx + AllocationsTabs.feature-flag.test.tsx + ScenarioStub.test.tsx + Performance-tab tests stay GREEN. Frozen scenario.ts untouched.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md
@.planning/phases/10-scenario-builder-and-what-if/10-RESEARCH.md
@.planning/phases/10-scenario-builder-and-what-if/10-PATTERNS.md
@.planning/phases/10-scenario-builder-and-what-if/10-UI-SPEC.md

# Wave 1–4 outputs (already shipped — these are the contracts the composer consumes)
@src/app/(dashboard)/allocations/lib/scenario-state.ts
@src/app/(dashboard)/allocations/lib/scenario-adapter.ts
@src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts
@src/app/(dashboard)/allocations/lib/mandate-fit.ts
@src/app/(dashboard)/allocations/hooks/useScenarioState.ts
@src/app/(dashboard)/allocations/components/ScenarioFooter.tsx

# Frozen engine
@src/lib/scenario.ts

# Wave 2–3 component outputs
@src/app/(dashboard)/allocations/components/KpiStrip.tsx
@src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
@src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx
@src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
@src/app/(dashboard)/allocations/components/BridgeDrawer.tsx

# Wiring point
@src/app/(dashboard)/allocations/AllocationsTabs.tsx
@src/app/(dashboard)/allocations/ScenarioStub.tsx
@src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
@src/app/(dashboard)/allocations/EmptyState.tsx
@src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
@src/app/(dashboard)/allocations/AllocationContext.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: ScenarioComposer — full body assembly with B4-pinned adapter signature: KpiStrip + charts + composition list + Bridge inline + Browse drawer + footer + reset modal + fingerprint banner (RED then GREEN)</name>
  <files>src/app/(dashboard)/allocations/components/ScenarioComposer.tsx, src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx</files>
  <read_first>
    - All Plan 04 outputs (KpiStrip.tsx + EquityChart.tsx + DrawdownChart.tsx — confirm prop signatures)
    - All Plan 05 outputs (StrategyBrowseDrawer.tsx + BridgeDrawer.tsx new prop)
    - Plans 01 + 03 + 06a outputs (scenario-state, scenario-adapter, holding-outcome-adapter, mandate-fit, queries.ts new field, useScenarioState, ScenarioFooter)
    - src/app/(dashboard)/allocations/EmptyState.tsx (Phase 07 D-08 — composer reuses for zero-holdings empty state)
    - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx (Phase 09 — composer EMBEDS this as the Bridge inline card section per RESEARCH §Architecture decision)
    - src/lib/scenario.ts (computeScenario signature, ComputedMetrics shape, equity_curve return-form contract)
    - .planning/phases/10-scenario-builder-and-what-if/10-PATTERNS.md ("ScenarioComposer.tsx" section + DON'T-copy caveats — equity_curve +1 conversion + scenario AUM scaling)
    - .planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md (D-01 unified state via adapter; D-02 toggle-off renormalize; D-03 add-default semantics; D-12/13/14/15/16 footer + KpiStrip + chart + commit drawer + delta tokens; "Reset confirmation modal copy"; "Empty-portfolio path"; mixed-portfolios discretion)
    - .planning/phases/10-scenario-builder-and-what-if/10-UI-SPEC.md (Component Inventory ScenarioComposer + ScenarioCompositionList; Interaction Contracts (composition-row toggle, /compare deep-link, weight input, reset confirmation modal, fingerprint-mismatch banner, equity overlay toggle); Copywriting (full table — every visible string is locked); States Matrix; Accessibility Contract; Destructive Actions)
    - .planning/phases/10-scenario-builder-and-what-if/10-RESEARCH.md (Pitfall 1 — equity_curve return vs wealth; Architecture Patterns diagram; Pitfall 7 — mandate-fit; Pitfall 8 — weight-norm; Pattern 2 (UPDATED per B4) — buildStrategyForBuilderSet signature with lookup maps)
  </read_first>
  <action>
    RED commit:
    Create ScenarioComposer.test.tsx with these failing cases. Use fixtures: 3 holdings (BTC/ETH/SOL on binance@spot), 1 flagged holding (BTC underperforming) with one top candidate, holdingReturnsByScopeRef populated for all 3, mandate provided.

    - T_C1 holdingsSummary=[] → renders EmptyState with "Scenario builder needs holdings" headline + "Connect Exchange" + "Browse strategies" dual CTA; clicking Browse opens StrategyBrowseDrawer
    - T_C2 holdingsSummary present → renders KpiStrip (mode="scenario"), EquityChart, DrawdownChart, composition list of 3 rows, Browse strategies CTA row, ScenarioFooter
    - T_C3 KpiStrip receives mode="scenario" + scenarioMetrics + liveMetrics props (assert via prop-spy or rendered output containing delta pill text)
    - T_C4 EquityChart receives scenarioSeries (assert it has POINTS, not just same as live; use vi.spyOn on EquityChart import or check rendered SVG path count)
    - T_C5 DrawdownChart receives scenarioDailyPoints
    - T_C6 Composition list renders 3 toggle switches (role="switch") with aria-label="Toggle BTC on/off in scenario" etc.
    - T_C7 Toggle off ETH → row renders with strikethrough on symbol + opacity 0.5 + weight input disabled; KpiStrip and charts re-derive (assert rerender — props change)
    - T_C8 flaggedHoldings.length>0 → Bridge inline card section visible with "Bridge flagged 1 holding" headline + Open Bridge button (CTA opens BridgeDrawer with onAddToScenario wired)
    - T_C9 flaggedHoldings.length=0 → Bridge inline card section is HIDDEN
    - T_C10 Browse strategies CTA opens drawer; clicking Add in drawer adds the strategy to composition list (assert new row appears + footer diff_count increments)
    - T_C11 Sticky footer "Commit scenario" disabled when diff_count=0; after toggling one holding off, button enabled
    - T_C12 Click Reset → destructive confirmation modal opens with title "Discard your scenario draft?" + body matching UI-SPEC + buttons "Discard draft" + "Cancel"
    - T_C13 Confirm Reset → onReset called → composer re-renders with default state + footer back to "No changes yet"
    - T_C14 Cancel Reset → modal closes, draft unchanged
    - T_C15 fingerprintMismatch=true (mock the hook return) → fingerprint-mismatch banner visible at top of composer body with copy "Your live holdings have changed since you last edited the scenario." + 2 buttons; default focus on "Keep my draft"
    - T_C16 Composition row for a flagged holding (where top candidate exists) renders a Compare → button that routes to `/compare?ids={holding_scope_ref},{candidate_uuid}`
    - T_C17 Composition row for an added strategy renders a Remove × button (aria-label="Remove from scenario") + 5s undo toast pattern (CONTEXT D-15 + UI-SPEC Destructive Actions)
    - T_C18 Click Commit (with diff_count>0) → onCommitRequested callback fires (Plan 07 wires this to the actual commit drawer; this plan ships a stub modal-style placeholder OR delegates to a callback prop — use the callback prop pattern so Plan 07 wires it cleanly without modifying the composer)
    - T_C19 Equity_curve +1 wealth conversion is applied — use the N4-pinned mocking technique:
      ```typescript
      vi.mock("../widgets/performance/EquityChart", () => ({
        EquityChart: vi.fn(() => null),
      }));
      // ... render composer ...
      expect(vi.mocked(EquityChart).mock.calls[0][0].scenarioSeries[0].value).toBeGreaterThanOrEqual(0.95);
      ```
      (Pinned per N4 — vi.spyOn on default-exported components is brittle; explicit vi.mock + vi.mocked is the project convention)
    - T_C20 The composer sets a `data-widget-id="scenario-composer"` attribute on its outer container so PostHog widget_viewed analytics in Phase 11 can hook it (CONTEXT integration points)
    - **T_C_empty_to_composer (M3 — empty-state dynamic transition)**: holdingsSummary=[] → EmptyState renders → click "Browse strategies" → drawer opens → click Add on a strategy → drawer closes (or stays open per Plan 05's multi-add session) → composer body now renders (KpiStrip + charts visible). The composer should NOT crash, freeze, or stay in EmptyState; instead it transitions to the "all-added, no-baseline" path. payload.liveBaselineMetrics is the {aum:0, equity:[]} default; scenario projection runs purely off the added strategy.
    - **T_C_M5_multi_venue_tooltip (M5 — multi-venue caveat tooltip)**: holdingsSummary=[BTC@binance, BTC@okx, ETH@binance] → composition list renders 3 rows; the BTC@binance row AND the BTC@okx row each show a tooltip / info icon with copy like "Returns merged with {other-venue} (symbol shared across venues)" — surfaces the M5 caveat. Test name maps to RESEARCH-spec'd `T03_multi_venue_correlation` and asserts the tooltip text is present in the DOM for both BTC rows but NOT for the ETH row.
    - **T_C_M4_live_ssr_lifted (M4 — live baseline from payload)**: render composer with `payload.liveBaselineMetrics` mocked to a known value; assert KpiStrip's `liveMetrics` prop === payload.liveBaselineMetrics (NOT a re-derived value). Spy `buildStrategyForBuilderSet` and assert it is called ONCE per render (the scenario-side call), never twice (no per-render live-baseline rebuild).

    **B4 — adapter signature pin (test cases):**
    - T_C_ADAPT1 buildStrategyForBuilderSet is called with `addedStrategies` of type `AddedStrategy[]` (lightweight) — NOT StrategyForBuilder[]. Spy on the adapter import; assert the first arg's `addedStrategies` field has elements with shape `{id, name, markets, strategy_types}` ONLY, no `daily_returns` or `disclosure_tier` fields present.
    - T_C_ADAPT2 buildStrategyForBuilderSet is called with `addedStrategyReturnsLookup` arg constructed from `payload.strategies` — for each added-strategy id present in payload.strategies, the lookup contains its daily_returns array; for added-strategy ids NOT in payload.strategies, the lookup either omits or returns [].
    - T_C_ADAPT3 buildStrategyForBuilderSet is called with `addedStrategyMetadataLookup` arg containing `disclosure_tier`, `cagr`, `sharpe` from payload.strategies for each added-strategy id present.
    - T_C_ADAPT4 No pre-casting in composer source — `grep -c "as const\|disclosure_tier:.*public" src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` returns 0 (no inline construction of StrategyForBuilder shapes).

    Run: `npm test -- ScenarioComposer` — MUST FAIL. Commit RED.

    GREEN commit:
    Create src/app/(dashboard)/allocations/components/ScenarioComposer.tsx. The full file is significant — assemble per UI-SPEC §Component Inventory. Key skeleton (B4-pinned adapter call):

    ```typescript
    "use client";

    import { useEffect, useMemo, useState } from "react";
    import { useRouter } from "next/navigation";
    import { computeScenario, type DailyPoint, type StrategyForBuilder } from "@/lib/scenario";
    import { useScenarioState } from "../hooks/useScenarioState";
    import { buildStrategyForBuilderSet } from "../lib/scenario-adapter";
    import { buildHoldingRef, type FlaggedHolding } from "../lib/holding-outcome-adapter";
    import { KpiStrip } from "./KpiStrip";
    import { EquityChart } from "../widgets/performance/EquityChart";
    import { DrawdownChart } from "../widgets/performance/DrawdownChart";
    import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
    import { BridgeDrawer } from "./BridgeDrawer";
    import { ScenarioFooter } from "./ScenarioFooter";
    import { EmptyState } from "../EmptyState";
    import { ScenarioFlaggedHoldingsList } from "../ScenarioFlaggedHoldingsList";
    import type { MyAllocationDashboardPayload } from "@/lib/queries";
    import type { AllocatorMandateForFit } from "../lib/mandate-fit";
    import type { AddedStrategy } from "../lib/scenario-state";

    export interface ScenarioCommitDiff {
      kind: "voluntary_remove" | "voluntary_add" | "voluntary_modify" | "bridge_recommended";
      holding_ref?: string;
      strategy_id?: string;
      new_weight?: number;
      size_at_decision_usd: number;
    }

    export interface ScenarioComposerProps {
      payload: MyAllocationDashboardPayload;       // already typed-extended in Plan 03 with holdingReturnsByScopeRef
      allocatorId: string;
      allocatorMandate: AllocatorMandateForFit | null;
      /** Plan 07 wires this to ScenarioCommitDrawer; in this plan it can be a stub. */
      onCommitRequested?: (diffs: ScenarioCommitDiff[]) => void;
    }

    export function ScenarioComposer({ payload, allocatorId, allocatorMandate, onCommitRequested }: ScenarioComposerProps) {
      const { holdingsSummary, flaggedHoldings, matchDecisionsByHoldingRef, existingOutcomesByHoldingRef,
              strategies, equityDailyPoints, holdingReturnsByScopeRef,
              snapshotCount, allKeysStale, minHistoryDepthMonths, activeVenues } = payload;
      const router = useRouter();

      const scenario = useScenarioState({ holdingsSummary, allocatorId });
      const [browseOpen, setBrowseOpen] = useState(false);
      const [bridgeOpen, setBridgeOpen] = useState(false);
      const [resetModalOpen, setResetModalOpen] = useState(false);

      // EMPTY STATE (M3 — dynamic transition to composer once a strategy is added)
      // Per cross-review M3: empty-portfolio allocators can use the EmptyState's "Browse
      // strategies" CTA → drawer → addStrategyBrowse → scenario.draft.addedStrategies grows.
      // Once that happens, the composer body renders with an "all-added, no-baseline" path
      // (live baseline = empty wealth curve; scenario projection = added strategies only).
      // The early-return is gated on BOTH holdingsSummary.length === 0 AND
      // scenario.draft.addedStrategies.length === 0 — once the user adds a strategy via
      // the empty-state Browse drawer, the gate falls through to the full composer.
      if (holdingsSummary.length === 0 && scenario.draft.addedStrategies.length === 0) {
        return (
          <div data-widget-id="scenario-composer" className="mx-auto max-w-[1100px] py-12">
            <EmptyState
              headline="Scenario builder needs holdings"
              body="Connect a read-only exchange API key to project portfolio scenarios — or browse strategies to start a hypothetical scenario from scratch."
              primaryCta={{ label: "Connect Exchange", href: "/profile?tab=exchanges" }}
              secondaryCta={{ label: "Browse strategies", onClick: () => setBrowseOpen(true) }}
              helperText="Want to compare strategies without your portfolio? Try the Strategy Sandbox →"
              helperHref="/scenarios"
            />
            <StrategyBrowseDrawer
              isOpen={browseOpen}
              onClose={() => setBrowseOpen(false)}
              onAdd={scenario.addStrategyBrowse}
              allocatorMandate={allocatorMandate}
            />
          </div>
        );
      }
      // NOTE: When holdingsSummary.length === 0 BUT addedStrategies.length > 0, the rest of
      // the composer renders with an empty live baseline. payload.liveBaselineMetrics
      // already returns the {aum:0, equity:[], drawdown:[]} default for that case. The
      // adapter's holdings → StrategyForBuilder pass produces an empty array; the scenario
      // projection runs purely off addedStrategies via their lookup-map data. computeScenario
      // handles a 1+ strategy input fine.

      // B4 — Build lookup maps from payload.strategies (NO pre-casting at the call site)
      const addedStrategyReturnsLookup = useMemo<Record<string, DailyPoint[]>>(() => {
        const map: Record<string, DailyPoint[]> = {};
        for (const a of scenario.draft.addedStrategies) {
          const found = strategies.find(s => s.id === a.id);
          map[a.id] = found?.daily_returns ?? [];
        }
        return map;
      }, [scenario.draft.addedStrategies, strategies]);

      const addedStrategyMetadataLookup = useMemo<Record<string, Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">>>(() => {
        const map: Record<string, Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">> = {};
        for (const a of scenario.draft.addedStrategies) {
          const found = strategies.find(s => s.id === a.id);
          if (found) {
            map[a.id] = {
              disclosure_tier: found.disclosure_tier,
              cagr: found.cagr,
              sharpe: found.sharpe,
            };
          }
        }
        return map;
      }, [scenario.draft.addedStrategies, strategies]);

      // BUILD SCENARIO PROJECTION via adapter + frozen scenario.ts (B4-pinned signature)
      const disabledHoldingRefs = useMemo(() => {
        const set = new Set<string>();
        for (const [k, v] of Object.entries(scenario.draft.toggleByScopeRef)) {
          if (!v) set.add(k);
        }
        return set;
      }, [scenario.draft.toggleByScopeRef]);

      const { strategies: strategiesForBuilder, state } = useMemo(() => buildStrategyForBuilderSet(
        holdingsSummary,
        disabledHoldingRefs,
        scenario.draft.addedStrategies,
        holdingReturnsByScopeRef,
        addedStrategyReturnsLookup,
        addedStrategyMetadataLookup,
      ), [
        holdingsSummary, disabledHoldingRefs, scenario.draft.addedStrategies,
        holdingReturnsByScopeRef, addedStrategyReturnsLookup, addedStrategyMetadataLookup,
      ]);

      const scenarioMetrics = useMemo(() => computeScenario(strategiesForBuilder, state), [strategiesForBuilder, state]);

      // LIVE BASELINE (M4): SSR-lifted to queries.ts. The composer no longer recomputes
      // computeScenario on the live set per render — it consumes payload.liveBaselineMetrics
      // directly. This is the cross-review M4 fix: at >=30 holdings × >=365 days, the
      // per-render compute was a real perf regression. The scenario projection still runs
      // client-side because it depends on toggle state.
      const liveMetrics = payload.liveBaselineMetrics;

      // PITFALL 1 — convert equity_curve cumulative RETURN → cumulative WEALTH (start at 1.0)
      const scenarioWealthSeries: DailyPoint[] = useMemo(
        () => scenarioMetrics.equity_curve.map(p => ({ date: p.date, value: p.value + 1 })),
        [scenarioMetrics.equity_curve],
      );
      const scenarioAum = useMemo(
        () => Object.entries(scenario.draft.toggleByScopeRef)
          .filter(([_, on]) => on)
          .reduce((sum, [scopeRef]) => {
            const h = holdingsSummary.find(x => buildHoldingRef(x) === scopeRef);
            return sum + (h?.value_usd ?? 0);
          }, 0),
        [scenario.draft.toggleByScopeRef, holdingsSummary],
      );
      const scenarioDailyPointsForDrawdown: DailyPoint[] = useMemo(
        () => scenarioWealthSeries.map(p => ({ date: p.date, value: p.value * scenarioAum })),
        [scenarioWealthSeries, scenarioAum],
      );

      // BUILD DELTA SUMMARY for footer (top 3 above noise floor) — implementer fills inline
      const deltaSummary = useMemo(() => {
        return [];
      }, [scenarioMetrics, liveMetrics]);

      // BUILD COMMIT DIFFS
      const handleCommit = () => {
        const diffs: ScenarioCommitDiff[] = [];
        for (const [scopeRef, on] of Object.entries(scenario.draft.toggleByScopeRef)) {
          if (on) continue;
          const h = holdingsSummary.find(x => buildHoldingRef(x) === scopeRef);
          if (!h) continue;
          diffs.push({ kind: "voluntary_remove", holding_ref: scopeRef, size_at_decision_usd: h.value_usd });
        }
        for (const a of scenario.draft.addedStrategies) {
          diffs.push({ kind: "voluntary_add", strategy_id: a.id, size_at_decision_usd: (scenario.draft.weightOverrides[a.id] ?? 0) * scenarioAum });
        }
        // weight changes → voluntary_modify (D-17 ship per CONTEXT)
        // ... iterate weightOverrides vs default-derived weights
        onCommitRequested?.(diffs);
      };

      return (
        <div data-widget-id="scenario-composer" className="mx-auto max-w-[1100px] flex flex-col">
          {/* Header */}
          <h2 className="text-2xl font-semibold text-text-primary">Scenario</h2>
          <p className="text-sm text-text-muted">Compose a draft portfolio and project KPI / equity / drawdown impact vs your live baseline.</p>

          {/* Fingerprint mismatch banner */}
          {scenario.fingerprintMismatch && (
            <div role="alert" className="mt-4 rounded-md border border-warning bg-[rgba(217,119,6,0.08)] p-3 text-sm text-text-primary">
              <div className="font-medium">Your live holdings have changed since you last edited the scenario.</div>
              <div className="mt-1 text-xs text-text-secondary">Reset and start from current holdings, or keep your draft for now.</div>
              <div className="mt-3 flex gap-3">
                <button type="button" onClick={() => { scenario.reset(); }} className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:border-negative hover:text-negative">
                  Reset and start over
                </button>
                <button type="button" autoFocus onClick={scenario.dismissFingerprintMismatchBanner} className="rounded-md border border-border px-3 py-1 text-xs">
                  Keep my draft
                </button>
              </div>
            </div>
          )}

          {/* KpiStrip mode=scenario */}
          <div className="mt-6">
            <KpiStrip
              mode="scenario"
              scenarioMetrics={scenarioMetrics}
              liveMetrics={liveMetrics}
              metrics={liveMetrics}
              analytics={{}}
              aum={scenarioAum}
              snapshotCount={snapshotCount}
              allKeysStale={allKeysStale}
              minHistoryDepthMonths={minHistoryDepthMonths}
              activeVenues={activeVenues}
            />
          </div>

          {/* Charts row */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <EquityChart equityDailyPoints={equityDailyPoints} scenarioSeries={scenarioWealthSeries} />
            <DrawdownChart equityDailyPoints={equityDailyPoints} scenarioDailyPoints={scenarioDailyPointsForDrawdown} />
          </div>

          {/* Bridge inline card (when flagged) — embeds existing ScenarioFlaggedHoldingsList */}
          {flaggedHoldings.length > 0 && (
            <div className="mt-8 rounded-lg border border-border bg-surface p-4">
              <div className="text-base font-semibold text-text-primary">
                Bridge flagged {flaggedHoldings.length} holding{flaggedHoldings.length === 1 ? "" : "s"}
              </div>
              <p className="mt-1 text-xs text-text-muted">Review the recommended replacement{flaggedHoldings.length === 1 ? "" : "s"} below — add any to the scenario at a swap-in weight.</p>
              <button type="button" onClick={() => setBridgeOpen(true)} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90">
                Open Bridge
              </button>
              <div className="mt-4">
                <ScenarioFlaggedHoldingsList
                  flaggedHoldings={flaggedHoldings}
                  matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
                  existingOutcomesByHoldingRef={existingOutcomesByHoldingRef}
                  allocatorPreferences={null}
                />
              </div>
            </div>
          )}

          {/* Composition list */}
          <CompositionList
            draft={scenario.draft}
            holdingsSummary={holdingsSummary}
            flaggedHoldings={flaggedHoldings}
            matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
            onToggle={scenario.toggleHolding}
            onSetWeight={scenario.setWeightOverride}
            onRemoveAdded={scenario.removeAddedStrategy}
            onCompare={(scopeRef, candidateId) => router.push(`/compare?ids=${encodeURIComponent(scopeRef)},${candidateId}`)}
          />

          {/* Browse strategies CTA row */}
          <div className="mt-8 rounded-lg border border-border bg-surface p-4">
            <div className="text-base font-semibold text-text-primary">Add more strategies</div>
            <p className="mt-1 text-xs text-text-muted">Browse the verified-strategies catalog to add candidates outside the Bridge recommendations.</p>
            <button type="button" onClick={() => setBrowseOpen(true)} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90">
              Browse strategies
            </button>
          </div>

          {/* Sticky footer */}
          <ScenarioFooter
            diffCount={scenario.diffCount}
            deltaSummary={deltaSummary}
            onResetRequested={() => setResetModalOpen(true)}
            onCommitRequested={handleCommit}
          />

          {/* Drawers + Reset modal */}
          <StrategyBrowseDrawer
            isOpen={browseOpen}
            onClose={() => setBrowseOpen(false)}
            onAdd={scenario.addStrategyBrowse}
            allocatorMandate={allocatorMandate}
          />
          <BridgeDrawer
            isOpen={bridgeOpen}
            onClose={() => setBridgeOpen(false)}
            flaggedHoldings={flaggedHoldings}
            matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
            onAddToScenario={(holdingScopeRef, candidate) => {
              scenario.addStrategyBridge(holdingScopeRef, {
                id: candidate.id, name: candidate.name,
                markets: candidate.markets, strategy_types: candidate.strategy_types,
              });
            }}
          />
          {resetModalOpen && (
            <ResetConfirmationModal
              onConfirm={() => { scenario.reset(); setResetModalOpen(false); }}
              onCancel={() => setResetModalOpen(false)}
            />
          )}
        </div>
      );
    }

    // CompositionList sub-component — toggle/weight/delta/Compare/Remove per row.
    // ResetConfirmationModal — centered 480px modal per UI-SPEC Destructive Actions.
    // (Both implemented below in the same file.)
    ```

    Implement `CompositionList` and `ResetConfirmationModal` as inline components within the same file (per UI-SPEC §Component Inventory: "Composition list" is a sub-component of ScenarioComposer; the Reset modal is too small for a dedicated file).

    Run: `npm test -- ScenarioComposer` — all GREEN. Commit GREEN.

    Verify zero new npm deps via `git diff main -- package.json` shows no changes.

    ALSO run `npm test -- ScenarioStub ScenarioFlaggedHoldingsList AllocationDashboardV2` to prove no downstream breakage.
  </action>
  <verify>
    <automated>npm test -- ScenarioComposer ScenarioStub ScenarioFlaggedHoldingsList AllocationDashboardV2 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx`
    - File exists: `test -f src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx`
    - `grep -c "export function ScenarioComposer\|export const ScenarioComposer" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1
    - `grep -c "export interface ScenarioComposerProps" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1
    - `grep -c "useScenarioState" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (import + call)
    - `grep -c "buildStrategyForBuilderSet" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (import + scenario call) — **M4**: live-baseline call REMOVED, baseline read from payload
    - `grep -c "computeScenario" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (import + scenario call) — **M4**: live-baseline call REMOVED, baseline read from payload
    - **M4 — live baseline from SSR**: `grep -c "payload.liveBaselineMetrics\|liveBaselineMetrics" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 or more (composer consumes the SSR-lifted live baseline directly)
    - `grep -c "addedStrategyReturnsLookup" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (declaration + scenario adapter call site)
    - `grep -c "addedStrategyMetadataLookup" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (B4 pinned)
    - `grep -c "data-widget-id=\"scenario-composer\"" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (empty state branch + main branch)
    - `grep -cE "p\.value \+ 1\|value: \w+\.value \+ 1" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 or more (Pitfall 1 conversion)
    - `grep -c "scenarioAum" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 3 or more (Pitfall 1 — drawdown scaling)
    - `grep -c "Bridge flagged" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1
    - `grep -c "Browse strategies" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (CTA row + drawer onClick)
    - `grep -c "Discard your scenario draft" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 (Reset modal title)
    - `grep -c "Your live holdings have changed" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 (fingerprint banner)
    - `grep -c "ScenarioFlaggedHoldingsList" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more (import + render)
    - `grep -c "EmptyState" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 2 or more
    - `grep -c "/compare?ids=" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 or more (Compare deep-link)
    - **B4 anti-pre-cast guard**: `grep -cE "disclosure_tier:.*\"public\"" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 0 (no inline StrategyForBuilder construction; lookup maps only)
    - **B4 anti-pre-cast guard**: `grep -cE "daily_returns:.*\\?\\?.*\\[\\]" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 0 (no inline daily_returns assignment in addedStrategies cast)
    - **M3 — empty-state transition**: `grep -c "T_C_empty_to_composer\|empty_to_composer\|holdingsSummary.length === 0 && scenario.draft.addedStrategies.length === 0" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` returns 1 or more
    - **M5 — multi-venue tooltip**: `grep -ci "merged with\|symbol shared across venues\|multi-venue" src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx` returns 1 or more (composition list tooltip copy)
    - **M5 — test**: `grep -c "T_C_M5_multi_venue_tooltip\|T03_multi_venue_correlation" src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` returns 1 or more
    - **M4 — test**: `grep -c "T_C_M4_live_ssr_lifted\|payload.liveBaselineMetrics" src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` returns 1 or more
    - `grep -c "vi.mock.*EquityChart\|vi.mocked(EquityChart)" src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` returns 1 or more (N4-pinned mocking technique)
    - `npm test -- ScenarioComposer` exits 0 with at least 25 passing tests (T_C1-T_C20 + B4 adapter + M3 + M4 + M5)
    - `npm test -- ScenarioStub ScenarioFlaggedHoldingsList AllocationDashboardV2` exits 0 (downstream untouched)
    - `git diff main -- package.json` shows no changes (zero new deps)
    - `git log --oneline -2 | grep -c "10-06b"` returns 2 (Task 1 RED+GREEN)
  </acceptance_criteria>
  <done>ScenarioComposer assembles full body; empty state + dynamic transition (M3) + composition + charts + Bridge inline + Browse drawer + sticky footer + reset modal + fingerprint banner all wired; B4-pinned adapter signature; live baseline read from payload (M4); multi-venue tooltip (M5); 25+ tests GREEN; no downstream breakage.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: AllocationsTabs scenario-panel branch — wire ScenarioComposer under allocations.ui_v2 flag (RED then GREEN)</name>
  <files>src/app/(dashboard)/allocations/AllocationsTabs.tsx, src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx</files>
  <read_first>
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx (entire 380 lines — locate isUiV2 derivation + scenario panel render at lines ~365–377)
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx (existing baseline tests)
    - src/app/(dashboard)/allocations/AllocationsTabs.feature-flag.test.tsx (Phase 09.1 D-17 invariant — flag-gating must stay GREEN)
    - src/app/(dashboard)/allocations/ScenarioStub.tsx (entire file — must NOT be modified; v1 path consumes this verbatim)
    - .planning/phases/10-scenario-builder-and-what-if/10-PATTERNS.md ("AllocationsTabs.tsx (EXTENDED — wiring point)" section — exact replace block)
    - .planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md ("Existing surfaces to modify" — AllocationsTabs.tsx UNCHANGED in tab structure; only the panel body branches)
  </read_first>
  <action>
    RED commit:
    Create AllocationsTabs.scenario-composer.test.tsx with these failing cases:

    Setup: render AllocationsTabs with `activeTab="scenario"` + the standard MyAllocationDashboardPayload mock + a stub ScenarioComposer (vi.mock the import to assert the prop wiring without exercising the full composer in this test).

    - T_AT1 isUiV2=false (default; no localStorage flag) → scenario panel renders existing ScenarioStub component (NOT ScenarioComposer)
    - T_AT2 isUiV2=true (localStorage["allocations.ui_v2"]="true") → scenario panel renders ScenarioComposer (NOT ScenarioStub)
    - T_AT3 ScenarioComposer receives the FULL payload prop including holdingReturnsByScopeRef
    - T_AT4 ScenarioComposer receives allocatorId prop
    - T_AT5 ScenarioComposer receives allocatorMandate prop (read from payload.mandate or wherever the mandate ships in MyAllocationDashboardPayload)
    - T_AT6 Performance tab still renders correctly with isUiV2=true (no regression to other tabs)
    - T_AT7 Switching tabs Performance → Scenario → Performance shows correct content each time (isUiV2 flag persists)

    Run: `npm test -- AllocationsTabs.scenario-composer` — MUST FAIL. Commit RED.

    GREEN commit:
    Modify src/app/(dashboard)/allocations/AllocationsTabs.tsx:

    1. Locate the existing scenario panel render block (search for `id="panel-scenario"` or `<ScenarioStub`):
    ```tsx
    <div role="tabpanel" id="panel-scenario" aria-labelledby="tab-scenario" hidden={activeTab !== "scenario"}>
      {activeTab === "scenario" && (
        <ScenarioStub
          flaggedHoldings={props.flaggedHoldings}
          matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
        />
      )}
    </div>
    ```

    2. Replace the panel body with the v2 branch:
    ```tsx
    <div role="tabpanel" id="panel-scenario" aria-labelledby="tab-scenario" hidden={activeTab !== "scenario"}>
      {activeTab === "scenario" && (
        isUiV2 ? (
          <ScenarioComposer
            payload={props}
            allocatorId={props.allocatorId /* or whatever the existing field is */}
            allocatorMandate={props.mandate /* or whatever shape MyAllocationDashboardPayload uses */}
          />
        ) : (
          <ScenarioStub
            flaggedHoldings={props.flaggedHoldings}
            matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
          />
        )
      )}
    </div>
    ```

    3. Add the dynamic import for ScenarioComposer at the top alongside other dynamic imports (search for `dynamic(` in the file). **L4 — hydration-flash skeleton + memoized import**:
    ```typescript
    // L4 — memoize the dynamic() call at module scope (top-level const, NOT inside the
    // component) so re-renders don't re-create the dynamic component. The loading skeleton
    // matches the KpiStrip + chart skeleton states from UI-SPEC States Matrix to avoid
    // a "blank → composer" flash on tab activation.
    const ScenarioComposer = dynamic(
      () => import("./components/ScenarioComposer").then(m => ({ default: m.ScenarioComposer })),
      {
        ssr: false,
        loading: () => (
          <div className="mx-auto max-w-[1100px] py-6">
            {/* KpiStrip skeleton — 5 cells × ~40px tall */}
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[40px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse" />
              ))}
            </div>
            {/* Charts row skeleton — 2 charts × ~280px tall */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-[280px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse" />
              <div className="h-[280px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse" />
            </div>
          </div>
        ),
      },
    );
    ```
    The dynamic import keeps the composer's heavy chart + drawer dependencies out of the Performance-tab bundle when allocators stay on Performance.

    4. **H3 — allocatorId source pinned**: read `props.allocator_id` directly from `MyAllocationDashboardPayload` (Plan 03 added this field in Wave 1 — H3 cross-review fix). The allocatorMandate is read from the existing `props.mandate` field. NO server-side context provider lookup needed; NO new prop on AllocationsTabs needed:
    ```tsx
    <ScenarioComposer
      payload={props}
      allocatorId={props.allocator_id}
      allocatorMandate={props.mandate}
    />
    ```

    Run: `npm test -- AllocationsTabs.scenario-composer AllocationsTabs.test AllocationsTabs.feature-flag ScenarioStub` — all GREEN. Commit GREEN.

    Performance tab + the other 5 tabs MUST continue to pass their existing tests. Run a broad regression: `npm test -- AllocationsTabs AllocationDashboardV2 ScenarioStub`.
  </action>
  <verify>
    <automated>npm test -- AllocationsTabs.scenario-composer AllocationsTabs ScenarioStub AllocationDashboardV2 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "ScenarioComposer" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 2 or more (dynamic import + render)
    - `grep -c "ScenarioStub" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 or more (v1 path preserved)
    - **H3 — allocator_id propagated**: `grep -c "props.allocator_id" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 (composer receives allocator_id from payload directly — Plan 03 H3 fix)
    - **L4 — loading skeleton**: `grep -ci "loading: () =>\|animate-pulse\|skeleton" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 or more (dynamic import has a non-trivial loading skeleton matching UI-SPEC States Matrix)
    - **L4 — module-scope memoization**: `grep -cE "^const ScenarioComposer = dynamic\\(" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 (dynamic call lives at module scope, NOT inside the component body)
    - `grep -cE "isUiV2 \?" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 or more (branch wiring)
    - `grep -c "dynamic(\|dynamic(()" src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` returns 1 or more (composer is dynamic-imported)
    - `npm test -- AllocationsTabs.scenario-composer` exits 0 with at least 7 passing tests
    - `npm test -- AllocationsTabs.test AllocationsTabs.feature-flag ScenarioStub` exits 0 (existing invariants intact)
    - `npm test -- AllocationDashboardV2` exits 0 (Phase 09.1 invariant intact)
    - `git log --oneline -4 | grep -c "10-06b"` returns >= 4 (Tasks 1 + 2 RED+GREEN)
  </acceptance_criteria>
  <done>AllocationsTabs scenario panel branches under v2 flag → ScenarioComposer; legacy v1 path → ScenarioStub UNCHANGED; existing AllocationsTabs tests + Performance tab + other 5 tabs all GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ScenarioComposer ↔ frozen scenario.ts | Same engine for live + scenario projections — no methodology drift (T-10-03 mitigation) |
| ScenarioComposer.handleCommit → onCommitRequested callback | Plan 07 wires this to the commit drawer + API route which re-validate ownership server-side |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-03 | Tampering | scenario projection diverges from server methodology | mitigate | computeScenario engine is the SAME function used by /scenarios sandbox + frozen by scenario.test.ts. Both live + scenario branches in the composer call computeScenario with identical math; no drift possible. |
| T-10-04 | Tampering | stale strategy reference (Manual-Only Verification 3 from VALIDATION.md) | mitigate | Composition list does not crash if a previously-added strategy is missing from payload.strategies — the addedStrategyReturnsLookup returns [] for unknown ids, the warm-up gate in scenario-adapter excludes the row from projection. UI-SPEC State Matrix line for composition list error covers this with "Excluded from projection — return data unavailable" caption. |
| T-10-XX | Information Disclosure | EquityChart Pitfall 1 (return vs wealth confusion) | mitigate | The +1 conversion is applied INSIDE the composer (Pitfall 1 mitigation per acceptance_criteria grep). Manual visual verification (chart starts at ~1.0, not 0.0) is in 10-VALIDATION.md. |
</threat_model>

<verification>
- `npm test -- ScenarioComposer AllocationsTabs.scenario-composer AllocationsTabs.test AllocationsTabs.feature-flag ScenarioStub AllocationDashboardV2` exits 0
- `npm test -- KpiStrip.warmup equity-curve.equitydailypoints scenario.test` exits 0 (frozen invariants — Phase 07 + scenario.ts)
- `npx tsc --noEmit` exits 0
- `npm run lint -- --quiet src/app/\(dashboard\)/allocations/components/ScenarioComposer.tsx src/app/\(dashboard\)/allocations/AllocationsTabs.tsx` exits 0
- `git diff main -- src/lib/scenario.ts` shows ZERO lines (frozen invariant)
- `git diff main -- package.json` shows ZERO lines (no new deps)
- 4 commits per project TDD cadence (2 tasks × RED+GREEN)
</verification>

<success_criteria>
1. ScenarioComposer assembles the full Scenario tab body: KpiStrip mode=scenario + EquityChart + DrawdownChart with overlays + Bridge inline card + composition list + Browse drawer + sticky footer + reset modal + fingerprint banner
2. Adapter call uses B4-pinned signature: lookup maps built from payload.strategies, NO pre-casting at call site
3. AllocationsTabs branches scenario panel under allocations.ui_v2 → ScenarioComposer (NEW); legacy v1 → ScenarioStub UNCHANGED
4. equity_curve +1 wealth conversion applied; scenario AUM scaling for drawdown
5. EmptyState rendered when holdingsSummary.length === 0; dual CTA opens browse drawer
6. Phase 09 ScenarioFlaggedHoldingsList embedded as Bridge inline card (RESEARCH §Architecture decision)
7. Frozen scenario.ts UNTOUCHED; zero new npm deps; Phase 07 + Phase 09.1 + Phase 09 invariants intact
</success_criteria>

<output>
After completion, create `.planning/phases/10-scenario-builder-and-what-if/10-06b-SUMMARY.md` documenting:
- ScenarioComposer + AllocationsTabs branch — exact lines added
- B4-pinned adapter call signature: addedStrategyReturnsLookup + addedStrategyMetadataLookup construction
- Decisions made: deltaSummary computation; CompositionList sub-component shape; ResetConfirmationModal placement
- Test counts per file
- Confirmation that ScenarioFlaggedHoldingsList is embedded (not duplicated)
- The handleCommit stub-callback pattern that Plan 07 will refine
- Note: Plan 07 wires onCommitRequested to the actual ScenarioCommitDrawer + POST /api/allocator/scenario/commit
</output>
</content>
</invoke>