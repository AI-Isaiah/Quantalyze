/**
 * Phase 10 Plan 06a / Task 1 — RED tests for useScenarioState.
 *
 * Pins the contract for the React hook that wraps Plan 01's pure
 * scenario-state.ts module:
 *   - hydration from localStorage on first mount (allocator-scoped key)
 *   - default-init from holdingsSummary when no stored draft
 *   - fingerprintMismatch state when stored fingerprint != current
 *   - mutator wrappers that update draft + persist to scoped key
 *   - reset clears scoped key + reinit + clears mismatch flag
 *   - dismissFingerprintMismatchBanner clears flag without touching draft
 *   - auth-change effect clears OLD allocator's scoped key (T-10-02 + N1)
 *   - cross-tenant safety: two allocators in same browser do NOT collide
 *   - M1 — auth-change stale-NEW allocator path: B's stored draft fingerprint
 *     does not match B's current holdings → fingerprintMismatch === true
 *   - M8 — diffCount does not double-count toggle-off renormalization
 *
 * vi.stubGlobal("localStorage", mock) idiom mirrors Phase 08 Plan 02 +
 * useDashboardConfig.test.ts (jsdom localStorage is unstable on vitest 4.1.2).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScenarioState } from "./useScenarioState";
import {
  scenarioStorageKey,
  computeHoldingsFingerprint,
  defaultDraftFromHoldings,
  type ScenarioDraft,
  type AddedStrategy,
  type HoldingForDefault,
} from "../lib/scenario-state";

// ---------------------------------------------------------------------------
// localStorage mock (vi.stubGlobal — Phase 08 Plan 02 idiom)
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => {
    store.clear();
  }),
  get length() {
    return store.size;
  },
  key: vi.fn(() => null),
};

vi.stubGlobal("localStorage", localStorageMock);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALLOCATOR_A = "allocator-a-uuid";
const ALLOCATOR_B = "allocator-b-uuid";

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

const HOLDINGS_3: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 40000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
  { symbol: "SOL", venue: "binance", holding_type: "spot", value_usd: 20000 },
];

const HOLDINGS_B: HoldingForDefault[] = [
  { symbol: "DOGE", venue: "kraken", holding_type: "spot", value_usd: 10000 },
];

const STRAT_A: AddedStrategy = {
  id: "uuid-strat-a" as AddedStrategy["id"],
  name: "Strat A",
  markets: ["binance"],
  strategy_types: ["momentum"],
};

const STRAT_B_FIXTURE: AddedStrategy = {
  id: "uuid-strat-b" as AddedStrategy["id"],
  name: "Strat B",
  markets: ["binance"],
  strategy_types: ["mean_reversion"],
};

const REF_BTC = "holding:binance:BTC:spot";
const REF_ETH = "holding:binance:ETH:spot";

// ---------------------------------------------------------------------------
// useScenarioState — hook contract tests
// ---------------------------------------------------------------------------

describe("useScenarioState", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("T_USE1 first mount + empty localStorage → default-init from holdings (toggleByScopeRef all true; weights = value_usd / total)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    expect(result.current.draft.toggleByScopeRef).toEqual({
      [REF_BTC]: true,
      [REF_ETH]: true,
    });
    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.6, 9);
    expect(result.current.draft.weightOverrides[REF_ETH]).toBeCloseTo(0.4, 9);
    expect(result.current.draft.addedStrategies).toEqual([]);
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("T_USE2 first mount + localStorage has draft with MATCHING fingerprint at allocator-scoped key → resumes the persisted draft", () => {
    const fp = computeHoldingsFingerprint(HOLDINGS_2);
    const persisted: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: fp,
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.6, [REF_ETH]: 1.0 },
      lastEditedAt: "2026-04-25T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // Resumed: BTC is OFF (persisted state), ETH carries the persisted weight 1.0.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    expect(result.current.draft.weightOverrides[REF_ETH]).toBeCloseTo(1.0, 9);
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("T_USE3 first mount + localStorage has draft with MISMATCHED fingerprint → default-init draft AND fingerprintMismatch=true", () => {
    const persisted: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale-fingerprint-XYZ",
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    expect(result.current.fingerprintMismatch).toBe(true);
    // Default-init: both ON, weights from value_usd.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.6, 9);
  });

  it("T_USE4 toggleHolding → draft updates AND localStorage.setItem called with the allocator-scoped key", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.toggleHolding(REF_BTC);
    });

    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    // setItem called with the allocator-scoped key.
    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    const setCalls = localStorageMock.setItem.mock.calls.filter(
      (c) => c[0] === scopedKey,
    );
    expect(setCalls.length).toBeGreaterThan(0);
    // Stored blob reflects the toggle.
    const stored = JSON.parse(store.get(scopedKey)!);
    expect(stored.toggleByScopeRef[REF_BTC]).toBe(false);
  });

  it("T_USE5 addStrategyBrowse → draft updates + localStorage updated", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.addStrategyBrowse(STRAT_A);
    });

    expect(result.current.draft.addedStrategies.map((s) => s.id)).toContain(
      STRAT_A.id,
    );
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(
      stored.addedStrategies.some(
        (s: { id: string }) => s.id === STRAT_A.id,
      ),
    ).toBe(true);
  });

  it("T_USE6 addStrategyBridge → draft updates + localStorage updated", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.addStrategyBridge(REF_BTC, STRAT_A);
    });

    expect(result.current.draft.addedStrategies.map((s) => s.id)).toContain(
      STRAT_A.id,
    );
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(
      stored.addedStrategies.some(
        (s: { id: string }) => s.id === STRAT_A.id,
      ),
    ).toBe(true);
  });

  it("T_USE7 removeAddedStrategy → draft updates + localStorage updated", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.addStrategyBrowse(STRAT_A);
    });
    expect(result.current.draft.addedStrategies.length).toBe(1);

    act(() => {
      result.current.removeAddedStrategy(STRAT_A.id);
    });

    expect(result.current.draft.addedStrategies.length).toBe(0);
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(stored.addedStrategies.length).toBe(0);
  });

  it("T_USE8 setWeightOverride → draft updates + localStorage updated", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.setWeightOverride(REF_BTC, 0.8);
    });

    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.8, 9);
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(stored.weightOverrides[REF_BTC]).toBeCloseTo(0.8, 9);
  });

  it("T_USE9 reset → removeItem called with allocator-scoped key + draft reinitialized + fingerprintMismatch cleared", () => {
    // Seed a stale-fingerprint draft so reset has an actual mismatch to clear.
    const persisted: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale-fingerprint",
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.0, [REF_ETH]: 1.0 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    store.set(scopedKey, JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.fingerprintMismatch).toBe(true);

    act(() => {
      result.current.reset();
    });

    // removeItem called with the allocator-scoped key.
    const removeCalls = localStorageMock.removeItem.mock.calls.filter(
      (c) => c[0] === scopedKey,
    );
    expect(removeCalls.length).toBeGreaterThan(0);
    // Draft reinitialized from current holdings (both ON).
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("T_USE10 dismissFingerprintMismatchBanner → fingerprintMismatch=false, draft unchanged", () => {
    const persisted: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale",
      toggleByScopeRef: { [REF_BTC]: true, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.fingerprintMismatch).toBe(true);
    const draftBefore = result.current.draft;

    act(() => {
      result.current.dismissFingerprintMismatchBanner();
    });

    expect(result.current.fingerprintMismatch).toBe(false);
    // Draft IDENTITY may change due to persistence effect re-running, but
    // the toggle / weights / added shape stays identical.
    expect(result.current.draft.toggleByScopeRef).toEqual(
      draftBefore.toggleByScopeRef,
    );
    expect(result.current.draft.addedStrategies).toEqual(
      draftBefore.addedStrategies,
    );
  });

  it("T_USE11 auth-change effect — when allocatorId prop changes, hook clears the OLD allocator's scoped key (NOT the new one) and reinits", () => {
    // Seed BOTH allocators' keys so we can prove only OLD is cleared.
    const fpA = computeHoldingsFingerprint(HOLDINGS_2);
    const draftA: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2, fpA),
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(draftA));

    const fpB = computeHoldingsFingerprint(HOLDINGS_B);
    const draftB: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_B, fpB),
    };
    store.set(scenarioStorageKey(ALLOCATOR_B), JSON.stringify(draftB));

    const { result, rerender } = renderHook(
      ({ allocatorId, holdings }: { allocatorId: string; holdings: HoldingForDefault[] }) =>
        useScenarioState({ holdingsSummary: holdings, allocatorId }),
      {
        initialProps: {
          allocatorId: ALLOCATOR_A,
          holdings: HOLDINGS_2,
        },
      },
    );

    // First mount uses ALLOCATOR_A's draft.
    expect(result.current.draft.init_holdings_fingerprint).toBe(fpA);

    // Now log in as ALLOCATOR_B with B's holdings.
    rerender({ allocatorId: ALLOCATOR_B, holdings: HOLDINGS_B });

    // removeItem MUST have been called with the OLD allocator's scoped key.
    const removeCalls = localStorageMock.removeItem.mock.calls;
    const oldKey = scenarioStorageKey(ALLOCATOR_A);
    const newKey = scenarioStorageKey(ALLOCATOR_B);
    expect(removeCalls.some((c) => c[0] === oldKey)).toBe(true);
    // The NEW allocator's key MUST NOT have been removed.
    expect(removeCalls.every((c) => c[0] !== newKey)).toBe(true);

    // Hook reinits — draft now reflects B's holdings.
    expect(result.current.draft.toggleByScopeRef["holding:kraken:DOGE:spot"]).toBe(
      true,
    );
  });

  it("T_USE12 — two allocators in same browser do NOT collide (cross-tenant isolation via per-allocator scoped key)", () => {
    // Allocator A persists their own draft.
    const fpA = computeHoldingsFingerprint(HOLDINGS_2);
    const draftA: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2, fpA),
      // Mutate so we can identify it on read-back.
      addedStrategies: [STRAT_A],
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(draftA));

    // Allocator B persists a DIFFERENT draft at THEIR own scoped key.
    const fpB = computeHoldingsFingerprint(HOLDINGS_B);
    const draftB: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_B, fpB),
      addedStrategies: [STRAT_B_FIXTURE],
    };
    store.set(scenarioStorageKey(ALLOCATOR_B), JSON.stringify(draftB));

    // Mounting as A reads A's draft, NOT B's.
    const { result: resultA, unmount: unmountA } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(
      resultA.current.draft.addedStrategies.map((s) => s.id),
    ).toContain(STRAT_A.id);
    expect(
      resultA.current.draft.addedStrategies.map((s) => s.id),
    ).not.toContain(STRAT_B_FIXTURE.id);
    unmountA();

    // Mounting as B reads B's draft, NOT A's.
    const { result: resultB } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_B, allocatorId: ALLOCATOR_B }),
    );
    expect(
      resultB.current.draft.addedStrategies.map((s) => s.id),
    ).toContain(STRAT_B_FIXTURE.id);
    expect(
      resultB.current.draft.addedStrategies.map((s) => s.id),
    ).not.toContain(STRAT_A.id);
  });

  it("T_USE12_auth_change_stale_new_allocator — B's stale fingerprint surfaces fingerprintMismatch on auth-change to B (M1)", () => {
    // Allocator A persists a default draft (matching fingerprint).
    const fpA = computeHoldingsFingerprint(HOLDINGS_2);
    const draftA: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2, fpA),
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(draftA));

    // Allocator B persists a draft whose fingerprint does NOT match B's
    // current holdings (M1 — the stale-NEW allocator path).
    const draftB_stale: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale-not-matching-current-B-holdings",
      toggleByScopeRef: {
        "holding:kraken:DOGE:spot": true,
      },
      addedStrategies: [],
      weightOverrides: { "holding:kraken:DOGE:spot": 1.0 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_B), JSON.stringify(draftB_stale));

    // Allocator A mounts first.
    const { result: resultA, unmount: unmountA } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    // A reads A's matching-fingerprint draft (no mismatch).
    expect(resultA.current.fingerprintMismatch).toBe(false);
    expect(resultA.current.draft.init_holdings_fingerprint).toBe(fpA);
    unmountA();

    // Allocator B mounts in the same browser (different render pass).
    const { result: resultB } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_B, allocatorId: ALLOCATOR_B }),
    );

    // B's stored draft was at B's scoped key (NOT cross-tenant collision).
    // Its fingerprint mismatches B's current holdings → mismatch surfaces.
    expect(resultB.current.fingerprintMismatch).toBe(true);
    // B's draft is the default-init from B's current holdings (the hook
    // chose default over the stale stored draft because of the mismatch).
    expect(
      resultB.current.draft.toggleByScopeRef["holding:kraken:DOGE:spot"],
    ).toBe(true);
  });

  it("T_USE13 — diffCount === 1 after a single toggle-off (M8: toggle-off renormalization is NOT user-explicit, so it does not double-count)", () => {
    // 3 enabled holdings, default weights 0.4/0.4/0.2.
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_3, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.diffCount).toBe(0);

    act(() => {
      // Toggle off one of the 0.4 rows.
      result.current.toggleHolding(REF_BTC);
    });

    // The chip should show "1 change", NOT "3 changes".
    // The two remaining rows' weights renormalize from 0.4/0.2 to 0.667/0.333,
    // but those changes are NOT user-explicit weight overrides — they are
    // toggle-off renormalization side-effects, so they MUST NOT count.
    expect(result.current.diffCount).toBe(1);
  });

  // H-0124 — pins the CONSERVATIVE M8 contract the source documents
  // (useScenarioState.ts:174-189): diffCount counts toggle changes + added
  // strategies + ONLY user-explicit weight overrides tracked via the optional
  // `userWeightOverrides` field. The `setWeightOverride` mutator writes to
  // `weightOverrides` (the renormalizable map), NOT `userWeightOverrides`, so
  // by design a direct weight drag does NOT increment diffCount under Plan 01's
  // current draft shape. This is intended behavior — the footer chip showing
  // "No changes yet" after a manual weight edit is the documented conservative
  // stance, since toggle-off renormalization also writes the entire weights map
  // and the two cannot be distinguished at this layer. T_USE13 only covers the
  // toggle path; this pins the weight-override path that the hook reads but the
  // existing suite never wrote.
  it("H-0124 — setWeightOverride alone does NOT increment diffCount (conservative M8 contract; userWeightOverrides absent in Plan 01 shape)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.diffCount).toBe(0);

    act(() => {
      // User explicitly drags BTC's weight to 0.9. weightOverrides updates,
      // but the draft carries no `userWeightOverrides` field (Plan 01 shape),
      // so diffCount stays 0 by design.
      result.current.setWeightOverride(REF_BTC, 0.9);
    });

    // The weight DID change in the draft...
    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.9, 9);
    // ...but diffCount stays 0 (no toggle change, no added strategy, and the
    // weight change is not a tracked user-explicit override).
    expect(result.current.diffCount).toBe(0);
  });

  // H-0124 (companion) — prove the diffCount math DOES read userWeightOverrides
  // when the field is present, so the conservative-zero above is genuinely
  // "field absent" and not "diffCount ignores weights entirely". A persisted
  // draft carrying userWeightOverrides that differs from the default weight by
  // > 1e-9 contributes exactly one to diffCount (source lines 200-207).
  it("H-0124 — diffCount counts a user-explicit weight override when userWeightOverrides IS present on the persisted draft", () => {
    const fp = computeHoldingsFingerprint(HOLDINGS_2);
    // Default weights for HOLDINGS_2 are BTC 0.6 / ETH 0.4. Persist a draft
    // whose userWeightOverrides[BTC] diverges from the default 0.6.
    const persisted = {
      schema_version: 1,
      init_holdings_fingerprint: fp,
      toggleByScopeRef: { [REF_BTC]: true, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.9, [REF_ETH]: 0.1 },
      userWeightOverrides: { [REF_BTC]: 0.9 },
      lastEditedAt: "2026-04-25T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // BTC's 0.9 user override differs from the default 0.6 → counts as 1.
    expect(result.current.diffCount).toBe(1);
  });
});
