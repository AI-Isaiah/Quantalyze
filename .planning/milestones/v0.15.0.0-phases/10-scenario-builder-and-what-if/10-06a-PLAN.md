---
phase: 10
plan: 06a
type: execute
wave: 4
depends_on: [10-01, 10-03, 10-04, 10-05]
files_modified:
  - src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
  - src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx
  - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
  - src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx
autonomous: true
requirements: [SCENARIO-01, SCENARIO-02, SCENARIO-08, SCENARIO-09]
must_haves:
  truths:
    - "useScenarioState hook hydrates draft from localStorage if fingerprint matches; otherwise default-inits from holdingsSummary"
    - "Hook uses per-allocator scoped storage key (scenarioStorageKey(allocatorId)) so cross-tenant collision is impossible at the persistence layer (N1 defense-in-depth)"
    - "Hook exposes reset, dismiss-banner, fingerprintMismatch state, and diffCount in addition to mutator wrappers"
    - "Sticky ScenarioFooter shows diff count + delta summary + Reset (ghost destructive on hover) + Commit (accent, disabled when diff_count=0); footer is position:sticky; bottom:0 within tab content"
    - "Auth-change effect — when allocatorId prop changes, hook clears that allocator's scoped storage and reinits from current holdings (T-10-02 + N1 mitigation)"
  artifacts:
    - path: src/app/(dashboard)/allocations/hooks/useScenarioState.ts
      provides: "React hook wrapping scenario-state.ts pure module + localStorage hydration + persistence on every change + per-allocator scoped storage key"
      exports: [useScenarioState, UseScenarioStateOptions, UseScenarioStateReturn]
    - path: src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
      provides: "Sticky bottom bar — diff count chip + delta summary + Reset + Commit"
      exports: [ScenarioFooter, ScenarioFooterProps]
  key_links:
    - from: "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
      to: "src/app/(dashboard)/allocations/lib/scenario-state.ts (Plan 01)"
      via: "load/save/clear with allocatorId-scoped key"
      pattern: "scenarioStorageKey\\(allocatorId\\)"
    - from: "ScenarioFooter.tsx"
      to: "ScenarioComposer.tsx (Plan 06b)"
      via: "props: diffCount + deltaSummary + onResetRequested + onCommitRequested"
      pattern: "onResetRequested\\|onCommitRequested"
---

<objective>
Build the **state + footer foundation** for the Scenario composer split off from the original Plan 06. Ships: (a) `useScenarioState` React hook wrapping the Plan 01 pure module with localStorage hydration + persistence + per-allocator scoped storage key (N1 defense-in-depth); (b) `ScenarioFooter.tsx` sticky bottom bar with diff count + delta summary + Reset + Commit. Both surfaces are ready to be assembled by Plan 06b's composer (next wave).

Purpose: Splitting Plan 06 into 06a (state + footer) and 06b (composer + tabs wiring) keeps each plan within the 50% context budget per checker W1. The hook + footer have a focused contract that plays cleanly with Plan 06b's downstream assembly.
Output: 2 new modules + 2 vitest files. Zero new npm deps. No existing files modified in this plan.
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

# Wave 1 output (consumed)
@src/app/(dashboard)/allocations/lib/scenario-state.ts

# Existing hook idiom
@src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: useScenarioState hook + ScenarioFooter — wraps Plan 01 module + per-allocator scoped localStorage hydration + sticky footer (RED then GREEN)</name>
  <files>src/app/(dashboard)/allocations/hooks/useScenarioState.ts, src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx, src/app/(dashboard)/allocations/components/ScenarioFooter.tsx, src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx</files>
  <read_first>
    - src/app/(dashboard)/allocations/lib/scenario-state.ts (Plan 01 output — every export this hook wraps; note that Plan 01 was updated per N1 to expose `scenarioStorageKey(allocatorId)` and to accept `allocatorId` on load/save/clear)
    - src/app/(dashboard)/allocations/lib/scenario-state.test.ts (Plan 01 — invariants the hook must preserve)
    - src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts (Phase 09.1 hook idiom — useState + useEffect persistence pattern)
    - .planning/phases/10-scenario-builder-and-what-if/10-RESEARCH.md (Architecture diagram — useScenarioState lifecycle: hydration → fingerprint check → resume or default-init)
    - .planning/phases/10-scenario-builder-and-what-if/10-CONTEXT.md (D-08 / "localStorage shape + invalidation rules" — fingerprint-mismatch flow; "Reset confirmation modal copy"; "Sticky footer collision with HoldingNoteRow / OutcomesWidget"; D-12 — sticky footer shape)
    - .planning/phases/10-scenario-builder-and-what-if/10-UI-SPEC.md (Component Inventory ScenarioFooter row + Interaction Contracts "Sticky footer (D-12)" + Copywriting "Sticky footer" entries)
    - .planning/phases/10-scenario-builder-and-what-if/10-PATTERNS.md ("ScenarioFooter.tsx" section — design tokens; sticky positioning idiom)
  </read_first>
  <behavior>
    RED commit:
    Create useScenarioState.test.tsx with these failing cases (renders a tiny test component using renderHook from @testing-library/react where appropriate, or a wrapper component if renderHook is not available). Use the vi.stubGlobal("localStorage", Map-backed mock) idiom from Plan 01.

    - T_USE1 First mount + empty localStorage + holdings fixture → hook returns draft default-init'd from holdings (toggleByScopeRef all true; weights derived from value_usd)
    - T_USE2 First mount + localStorage has draft with MATCHING fingerprint AT THE allocator-scoped key → hook returns the persisted draft (resumes)
    - T_USE3 First mount + localStorage has draft with MISMATCHED fingerprint → hook returns default-init draft AND fingerprintMismatch state is true
    - T_USE4 toggleHolding action → returned draft updates AND localStorage.setItem is called with the new draft AT THE allocator-scoped key
    - T_USE5 addStrategyBrowse action → returned draft + localStorage updated
    - T_USE6 addStrategyBridge action → returned draft + localStorage updated
    - T_USE7 removeAddedStrategy action → returned draft + localStorage updated
    - T_USE8 setWeightOverride action → returned draft + localStorage updated
    - T_USE9 reset action → localStorage.removeItem called with the allocator-scoped key + draft reinitialized from current holdings + fingerprintMismatch cleared
    - T_USE10 dismissFingerprintMismatchBanner action → fingerprintMismatch state goes to false but draft stays the same
    - T_USE11 Auth-change effect — when allocatorId prop changes (different allocator logs in), hook clears the OLD allocator's scoped key (NOT the new one) and reinits — verify by spying setItem/removeItem and asserting the key argument matches the OLD allocatorId on removeItem (T-10-02 + N1 mitigation)
    - T_USE12 Two hooks for two different allocatorIds in the same browser do NOT collide — set per-allocator drafts via two render passes; reading either back returns the correct one (cross-tenant attack-surface elimination — N1 defense-in-depth). **M1 EXTENSION**: ALSO seed allocator B's storage with a draft whose `init_holdings_fingerprint` does NOT match B's current holdings; on the auth-change render where allocatorId becomes B, the hook reads B's stored draft, detects the fingerprint mismatch, and exposes `fingerprintMismatch === true` for B's session (so the composer banner forces the choice). Test name `T_USE12_auth_change_stale_new_allocator` per cross-review M1.
    - **T_USE13 (M8 — diffCount no double-count)**: start with 3 enabled holdings (default weights 0.4/0.4/0.2), call `toggleHolding` on the 0.4 row → assert `diffCount === 1`, NOT 1 + 2 (the chip should show "1 change", not "3 changes"). The two remaining rows' weights renormalize from 0.4/0.2 to 0.667/0.333 — those changes are NOT user-explicit, so they don't count. Plan 01 must extend ScenarioDraft (or scenario-state.ts internal state) to carry `userWeightOverrides` separately so this hook can distinguish.

    Create ScenarioFooter.test.tsx with:
    - T_F1 diff_count=0 → "No changes yet" text + Commit button has disabled state (aria-disabled or HTML disabled attribute)
    - T_F2 diff_count=3 → "3 changes" chip + Commit button enabled
    - T_F3 diff_count=1 → "1 change" (singular)
    - T_F4 deltaSummary=[{label:"Sharpe", value:"+0.3"},{label:"Max DD",value:"-4%"}] → renders "+0.3 Sharpe · −4% Max DD" (dot-separated, Geist Mono / font-mono class present)
    - T_F5 No deltas above noise floor → "No material change yet."
    - T_F6 Click Reset → onResetRequested callback fires
    - T_F7 Click Commit → onCommitRequested callback fires (assert NOT fired when disabled)
    - T_F8 footer has role="region" aria-label="Scenario draft summary and actions" + position:sticky; bottom:0 in inline style or class
    - T_F9 Reset button has class indicating ghost style + hover-destructive (just check the className contains expected tokens like "text-text-secondary" base and "hover:text-negative")

    Run: `npm test -- useScenarioState ScenarioFooter` — MUST FAIL. Commit RED.

    GREEN commit:

    Create src/app/(dashboard)/allocations/hooks/useScenarioState.ts:
    ```typescript
    "use client";

    import { useEffect, useMemo, useState, useCallback, useRef } from "react";
    import {
      computeHoldingsFingerprint,
      defaultDraftFromHoldings,
      loadScenarioDraft,
      saveScenarioDraft,
      clearScenarioDraft,
      toggleHolding as toggleHoldingPure,
      addStrategyBrowse as addBrowsePure,
      addStrategyBridge as addBridgePure,
      removeAddedStrategy as removePure,
      setWeightOverride as setWeightPure,
      type ScenarioDraft,
      type AddedStrategy,
      type HoldingForDefault,
    } from "../lib/scenario-state";

    export interface UseScenarioStateOptions {
      holdingsSummary: HoldingForDefault[];
      allocatorId: string;  // T-10-02 + N1 — scopes the localStorage key per allocator
    }

    export interface UseScenarioStateReturn {
      draft: ScenarioDraft;
      fingerprintMismatch: boolean;
      toggleHolding: (scopeRef: string) => void;
      addStrategyBrowse: (s: AddedStrategy) => void;
      addStrategyBridge: (holdingScopeRef: string, s: AddedStrategy) => void;
      removeAddedStrategy: (id: string) => void;
      setWeightOverride: (scopeRef: string, weight: number) => void;
      reset: () => void;
      dismissFingerprintMismatchBanner: () => void;
      diffCount: number;
    }

    export function useScenarioState(opts: UseScenarioStateOptions): UseScenarioStateReturn {
      const { holdingsSummary, allocatorId } = opts;
      const fingerprint = useMemo(() => computeHoldingsFingerprint(holdingsSummary), [holdingsSummary]);
      const lastAllocatorId = useRef(allocatorId);

      const [draft, setDraft] = useState<ScenarioDraft>(() => {
        const stored = loadScenarioDraft(allocatorId);
        if (stored && stored.init_holdings_fingerprint === fingerprint) return stored;
        return defaultDraftFromHoldings(holdingsSummary, fingerprint);
      });
      const [fingerprintMismatch, setFingerprintMismatch] = useState<boolean>(() => {
        const stored = loadScenarioDraft(allocatorId);
        return !!stored && stored.init_holdings_fingerprint !== fingerprint;
      });

      // Auth-change clear (T-10-02 + N1 — clear the OLD allocator's key, NOT the new one)
      useEffect(() => {
        if (lastAllocatorId.current !== allocatorId) {
          clearScenarioDraft(lastAllocatorId.current);
          const fresh = defaultDraftFromHoldings(holdingsSummary, fingerprint);
          setDraft(fresh);
          setFingerprintMismatch(false);
          lastAllocatorId.current = allocatorId;
        }
      }, [allocatorId, holdingsSummary, fingerprint]);

      // Persist on every draft change (per-allocator key)
      useEffect(() => {
        saveScenarioDraft(allocatorId, draft);
      }, [allocatorId, draft]);

      const toggleHolding = useCallback((scopeRef: string) => {
        setDraft(d => toggleHoldingPure(d, scopeRef));
      }, []);
      const addStrategyBrowse = useCallback((s: AddedStrategy) => {
        setDraft(d => addBrowsePure(d, s));
      }, []);
      const addStrategyBridge = useCallback((holdingScopeRef: string, s: AddedStrategy) => {
        setDraft(d => addBridgePure(d, holdingScopeRef, s));
      }, []);
      const removeAddedStrategy = useCallback((id: string) => {
        setDraft(d => removePure(d, id));
      }, []);
      const setWeightOverride = useCallback((scopeRef: string, weight: number) => {
        setDraft(d => setWeightPure(d, scopeRef, weight));
      }, []);
      const reset = useCallback(() => {
        clearScenarioDraft(allocatorId);
        setDraft(defaultDraftFromHoldings(holdingsSummary, fingerprint));
        setFingerprintMismatch(false);
      }, [allocatorId, holdingsSummary, fingerprint]);
      const dismissFingerprintMismatchBanner = useCallback(() => {
        setFingerprintMismatch(false);
      }, []);

      // M8 — diffCount must NOT double-count weight overrides that are caused by toggle-off
      // renormalization (which writes new weights to ALL remaining enabled rows). To avoid
      // the "1 toggle = N changes" bug, the draft tracks user-EXPLICIT weight overrides
      // separately from auto-renormalized weights. Implementation choice (a) per cross-review:
      //   - scenario-state.ts (Plan 01) is extended to ALSO carry a `userWeightOverrides:
      //     Record<string, number>` set that ONLY includes weights set via setWeightOverride
      //     (NOT weights written by renormalize-on-toggle/add). The diffCount weight branch
      //     reads from this set, not from the rendered weightOverrides.
      //   - If implementing choice (b) instead, gate the diff loop on a per-row "explicit"
      //     flag — same effect, different storage shape.
      // Either way, the test T_USE13 below proves a single toggle-off produces diffCount=1
      // (not N).
      const diffCount = useMemo(() => {
        const defaultDraft = defaultDraftFromHoldings(holdingsSummary, fingerprint);
        let count = 0;
        for (const [k, v] of Object.entries(draft.toggleByScopeRef)) {
          if (defaultDraft.toggleByScopeRef[k] !== v) count++;
        }
        count += draft.addedStrategies.length;
        // M8 — count only EXPLICIT user weight overrides (not renormalization side-effects).
        const userExplicit = (draft as { userWeightOverrides?: Record<string, number> }).userWeightOverrides ?? {};
        for (const [k, v] of Object.entries(userExplicit)) {
          const defaultWeight = defaultDraft.weightOverrides[k];
          if (defaultWeight == null) continue;
          if (Math.abs(v - defaultWeight) > 1e-9) count++;
        }
        return count;
      }, [draft, holdingsSummary, fingerprint]);

      return {
        draft, fingerprintMismatch, diffCount,
        toggleHolding, addStrategyBrowse, addStrategyBridge,
        removeAddedStrategy, setWeightOverride, reset, dismissFingerprintMismatchBanner,
      };
    }
    ```

    NOTE: Plan 01 (per checker N1) ships `loadScenarioDraft(allocatorId)`, `saveScenarioDraft(allocatorId, draft)`, `clearScenarioDraft(allocatorId)`, and a `scenarioStorageKey(allocatorId)` helper. The hook does NOT compute the storage key directly — it delegates to the pure module so the key shape stays in one place.

    NOTE: defaultDraftFromHoldings in scenario-state.ts (Plan 01) accepts a 2nd arg `fingerprint?: string` — if not present, the hook computes it locally and passes via the ScenarioDraft.init_holdings_fingerprint field. Adjust per Plan 01's actually-shipped signature.

    Create src/app/(dashboard)/allocations/components/ScenarioFooter.tsx:
    ```typescript
    "use client";

    export interface ScenarioFooterDeltaItem {
      label: string;
      value: string;
      tier: "positive" | "negative" | "muted";
    }

    export interface ScenarioFooterProps {
      diffCount: number;
      deltaSummary: ScenarioFooterDeltaItem[];
      onResetRequested: () => void;
      onCommitRequested: () => void;
    }

    export function ScenarioFooter({ diffCount, deltaSummary, onResetRequested, onCommitRequested }: ScenarioFooterProps) {
      const hasDiffs = diffCount > 0;
      const significant = deltaSummary.filter(d => d.tier !== "muted");
      const summaryText = !hasDiffs
        ? "No changes yet"
        : significant.length === 0
          ? "No material change yet."
          : significant.slice(0, 3).map(d => `${d.value} ${d.label}`).join(" · ");
      const countLabel = diffCount === 0 ? "No changes yet" : (diffCount === 1 ? "1 change" : `${diffCount} changes`);

      return (
        <footer
          role="region"
          aria-label="Scenario draft summary and actions"
          style={{
            position: "sticky",
            bottom: 0,
            height: 56,
            background: "var(--color-surface, #FFFFFF)",
            borderTop: "1px solid var(--color-border, #E2E8F0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            zIndex: 10,
          }}
        >
          <span className="rounded-md px-2 py-1 text-xs font-medium text-text-muted">{countLabel}</span>
          <span className="font-mono text-[13px] font-medium tabular-nums text-text-secondary">
            {summaryText}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Reset scenario draft"
              onClick={onResetRequested}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-negative hover:text-negative"
              data-testid="scenario-footer-reset"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={hasDiffs ? onCommitRequested : undefined}
              disabled={!hasDiffs}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="scenario-footer-commit"
            >
              Commit scenario
            </button>
          </div>
        </footer>
      );
    }
    ```

    Run: `npm test -- useScenarioState ScenarioFooter` — all GREEN. Commit GREEN.
  </behavior>
  <action>
    Per D-12 (sticky footer per UI-SPEC), D-08 / Claude's Discretion (localStorage shape, fingerprint invalidation prompt, default keep), Phase 09.1 D-17 (allocations.ui_v2 cohort gate — already in place; this hook does NOT re-check the flag, the AllocationsTabs branch in Plan 06b does), and checker N1 defense-in-depth (per-allocator scoped storage key — eliminates cross-tenant attack surface entirely).

    Two atomic commits per TDD cadence:
    1. RED: `test(10-06a): add failing tests for useScenarioState + ScenarioFooter`
    2. GREEN: `feat(10-06a): useScenarioState hook (per-allocator scoped) + ScenarioFooter sticky bar`

    The hook ENCAPSULATES all React state lifecycle for scenario draft: hydration, persistence, mutation, fingerprint detection, allocator-scope guard. Plan 01's pure module remains pure; this hook is the integration layer between pure functions and React's render cycle.

    Auth-change clear is the T-10-02 mitigation, made redundant-but-defended-in-depth by N1's per-allocator scoped key. The hook clears the OLD allocator's key on auth change (NOT the new one — the new allocator may already have a draft they want to resume).

    The sticky footer uses `position: sticky` (NOT fixed) so it stays inside the tab content area per D-12 — switching tabs hides it naturally.
  </action>
  <verify>
    <automated>npm test -- useScenarioState ScenarioFooter 2>&1 | tail -25</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts`
    - File exists: `test -f src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx`
    - `grep -c "export function useScenarioState\|export const useScenarioState" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 1
    - `grep -c "saveScenarioDraft\|loadScenarioDraft\|clearScenarioDraft" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 4 or more
    - `grep -c "saveScenarioDraft(allocatorId" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 1 or more (per-allocator scoped — N1)
    - `grep -c "loadScenarioDraft(allocatorId" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 2 or more (init + state derivation)
    - `grep -c "clearScenarioDraft(" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 2 or more (auth-change effect + reset)
    - `grep -c "computeHoldingsFingerprint" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 2 or more
    - `grep -c "allocatorId" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 5 or more (prop + auth-change effect + ref tracking + scoped storage calls)
    - `grep -c "fingerprintMismatch" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 4 or more
    - **M1 — auth-change stale-banner**: `grep -cE "T_USE12_auth_change_stale_new_allocator|stale_new_allocator|allocator B.*fingerprintMismatch" src/app/\(dashboard\)/allocations/hooks/useScenarioState.test.tsx` returns 1 or more
    - **M8 — diffCount no double-count**: `grep -c "userWeightOverrides\|user-explicit\|toggle-off renormaliz" src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts` returns 1 or more (the diffCount memo distinguishes user-explicit overrides from auto-renormalized weights)
    - **M8 — diffCount test**: `grep -c "T_USE13\|1 toggle.*1 diff\|diffCount === 1" src/app/\(dashboard\)/allocations/hooks/useScenarioState.test.tsx` returns 1 or more
    - `grep -c "export function ScenarioFooter\|export const ScenarioFooter" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "position: \"sticky\"\|position: 'sticky'" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "Commit scenario" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "No changes yet" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "role=\"region\"" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "aria-label=\"Scenario draft summary and actions\"" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1
    - `grep -c "font-mono\|Geist Mono" src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` returns 1 or more
    - `npm test -- useScenarioState ScenarioFooter` exits 0 with at least 23 passing tests (13 hook incl. M1 + M8 + 9 footer + 1 carry-over)
    - `git log --oneline -2 | grep -c "10-06a"` returns 2
  </acceptance_criteria>
  <done>useScenarioState hook + ScenarioFooter both work; per-allocator localStorage scope eliminates cross-tenant attack surface (N1); fingerprint mismatch detected (incl. stale-NEW allocator path per M1); diffCount no longer double-counts toggle-off renormalization (M8); auth-change clears OLD key; sticky footer renders at correct position; 23+ tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser ↔ localStorage (per-allocator key) | Allocator-scoped storage key (`allocations.scenario_v0_15.{allocatorId}`) eliminates cross-tenant collision at the persistence layer (N1 defense-in-depth + T-10-02 mitigation) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-02 | Information Disclosure | localStorage cross-allocator leak on shared machine | mitigate | Two layers: (1) per-allocator scoped storage key from Plan 01 (N1 — eliminates collision at the persistence layer); (2) useScenarioState clears the OLD allocator's key when allocatorId prop changes. Verified by T_USE11 + T_USE12 in this plan. |
| T-10-XX | Tampering | Reset bypass | accept | Reset is a client-only action; the user can clear localStorage manually anyway. The destructive confirmation modal lives in Plan 06b (composer). |
</threat_model>

<verification>
- `npm test -- useScenarioState ScenarioFooter` exits 0
- `npx tsc --noEmit` exits 0
- `npm run lint -- --quiet src/app/\(dashboard\)/allocations/hooks/useScenarioState.ts src/app/\(dashboard\)/allocations/components/ScenarioFooter.tsx` exits 0
- 2 commits per project TDD cadence (1 task × RED+GREEN)
</verification>

<success_criteria>
1. useScenarioState hook hydrates draft from localStorage with fingerprint check + auth-change clear
2. Per-allocator scoped storage key via Plan 01's `scenarioStorageKey(allocatorId)` helper (N1 defense-in-depth)
3. ScenarioFooter renders sticky bottom bar with diff count + delta summary + Reset + Commit buttons
4. Two allocators on the same browser do NOT collide (T_USE12 proves this)
5. No new npm deps; uses existing project primitives only
</success_criteria>

<output>
After completion, create `.planning/phases/10-scenario-builder-and-what-if/10-06a-SUMMARY.md` documenting:
- useScenarioState hook signature and per-allocator key scoping
- ScenarioFooter prop signature
- Test counts per file
- Confirmation that the hook delegates the storage-key shape to Plan 01's `scenarioStorageKey(allocatorId)` helper
- Note: ScenarioComposer assembly + AllocationsTabs branch wiring land in Plan 06b
</output>
</content>
</invoke>