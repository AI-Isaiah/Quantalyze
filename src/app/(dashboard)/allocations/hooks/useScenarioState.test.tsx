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

  // T_USE4-8 — persistence is now debounced (B7a-2 / H-0125), so a mutation no
  // longer writes localStorage synchronously. The in-memory draft updates
  // immediately; the (coalesced) write lands on the guaranteed unmount flush.
  // Each asserts both: the immediate in-memory update AND the flushed blob.
  it("T_USE4 toggleHolding → draft updates immediately; the (debounced) write flushes to the allocator-scoped key", () => {
    const { result, unmount } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.toggleHolding(REF_BTC);
    });
    // In-memory draft updates synchronously.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);

    // Flush the debounced write (unmount cleanup flushes the pending value).
    act(() => {
      unmount();
    });

    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    const setCalls = localStorageMock.setItem.mock.calls.filter(
      (c) => c[0] === scopedKey,
    );
    expect(setCalls.length).toBeGreaterThan(0);
    const stored = JSON.parse(store.get(scopedKey)!);
    expect(stored.toggleByScopeRef[REF_BTC]).toBe(false);
  });

  it("T_USE5 addStrategyBrowse → draft updates + localStorage updated (post-flush)", () => {
    const { result, unmount } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.addStrategyBrowse(STRAT_A);
    });
    expect(result.current.draft.addedStrategies.map((s) => s.id)).toContain(
      STRAT_A.id,
    );

    act(() => {
      unmount();
    });
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(
      stored.addedStrategies.some((s: { id: string }) => s.id === STRAT_A.id),
    ).toBe(true);
  });

  it("T_USE6 addStrategyBridge → draft updates + localStorage updated (post-flush)", () => {
    const { result, unmount } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.addStrategyBridge(REF_BTC, STRAT_A);
    });
    expect(result.current.draft.addedStrategies.map((s) => s.id)).toContain(
      STRAT_A.id,
    );

    act(() => {
      unmount();
    });
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(
      stored.addedStrategies.some((s: { id: string }) => s.id === STRAT_A.id),
    ).toBe(true);
  });

  it("T_USE7 removeAddedStrategy → draft updates + localStorage updated (post-flush)", () => {
    const { result, unmount } = renderHook(() =>
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

    act(() => {
      unmount();
    });
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(stored.addedStrategies.length).toBe(0);
  });

  it("T_USE8 setWeightOverride → draft updates + localStorage updated (post-flush)", () => {
    const { result, unmount } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.setWeightOverride(REF_BTC, 0.8);
    });
    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.8, 9);

    act(() => {
      unmount();
    });
    const stored = JSON.parse(store.get(scenarioStorageKey(ALLOCATOR_A))!);
    expect(stored.weightOverrides[REF_BTC]).toBeCloseTo(0.8, 9);
  });

  it("H-0125 — a mutation does NOT write localStorage synchronously; the debounce coalesces a burst into ONE flushed write", () => {
    const { result, unmount } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    const writesToKey = () =>
      localStorageMock.setItem.mock.calls.filter((c) => c[0] === scopedKey)
        .length;

    // Deferred hydration does not persist — baseline is zero writes.
    expect(writesToKey()).toBe(0);

    // A burst of weight edits (pre-B7: one synchronous setItem PER edit).
    act(() => {
      result.current.setWeightOverride(REF_BTC, 0.7);
      result.current.setWeightOverride(REF_BTC, 0.8);
      result.current.setWeightOverride(REF_BTC, 0.9);
    });
    // Debounced — NOT written synchronously.
    expect(writesToKey()).toBe(0);

    // The guaranteed flush coalesces the burst into exactly ONE write of the
    // last value.
    act(() => {
      unmount();
    });
    expect(writesToKey()).toBe(1);
    const stored = JSON.parse(store.get(scopedKey)!);
    expect(stored.weightOverrides[REF_BTC]).toBeCloseTo(0.9, 9);
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

  // H-0126 (was H-0124, FLIPPED by B7a-2) — `setWeightOverride` now records the
  // user-touched ref in `userWeightOverrides` (the only writer of that map), so
  // a PURE-REBALANCE (weight edits with no toggle/add) increments diffCount and
  // un-blocks the Commit button. The prior "conservative zero" silently locked
  // out the documented voluntary_modify workflow (CONTEXT D-17). Toggle-off
  // renormalization rewrites `weightOverrides` but NOT `userWeightOverrides`, so
  // T_USE13's "1 toggle = 1 change" contract still holds (no double-count).
  it("H-0126 — setWeightOverride alone DOES increment diffCount now (records a user-explicit override; un-blocks pure-rebalance Commit)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.diffCount).toBe(0);

    act(() => {
      // User explicitly drags BTC's weight to 0.9.
      result.current.setWeightOverride(REF_BTC, 0.9);
    });

    expect(result.current.draft.weightOverrides[REF_BTC]).toBeCloseTo(0.9, 9);
    // userWeightOverrides[BTC]=0.9 diverges from the default 0.6 → diffCount 1.
    expect(result.current.diffCount).toBe(1);
    // And the touched ref is recorded for forensic/round-trip clarity.
    expect(result.current.draft.userWeightOverrides?.[REF_BTC]).toBeCloseTo(0.9, 9);
  });

  // H-0126 (review fix, silent-failure-hunter conf 8) — a user-weighted holding
  // that is then toggled OFF must count as ONE change, not two. The stale
  // userWeightOverrides entry for a now-disabled ref is not part of the
  // committed allocation (the commit path skips toggled-off refs), so diffCount
  // must skip it. Pre-fix this double-counted (toggle change + stale override).
  it("H-0126 — weight-edit then toggle-OFF of the SAME ref counts as 1 change, not 2 (disabled ref's override is excluded)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.diffCount).toBe(0);

    act(() => {
      result.current.setWeightOverride(REF_BTC, 0.8);
    });
    expect(result.current.diffCount).toBe(1); // one user weight override

    act(() => {
      result.current.toggleHolding(REF_BTC); // BTC → OFF
    });
    // One net change (BTC toggled off). The stale userWeightOverrides[BTC] for
    // the now-disabled row must NOT add a second count.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    expect(result.current.diffCount).toBe(1);

    // Toggling BTC back ON re-counts its still-divergent override (BTC enabled
    // again, override 0.8 ≠ default 0.6) → 1.
    act(() => {
      result.current.toggleHolding(REF_BTC);
    });
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.diffCount).toBe(1);
  });

  it("B7a-2 — editing while the fingerprint-mismatch banner is up rebases onto the default draft and clears the mismatch", () => {
    // Stored draft is a valid v1 blob but for a DIFFERENT holdings set.
    const persisted: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale-different-holdings",
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: false },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    store.set(scenarioStorageKey(ALLOCATOR_A), JSON.stringify(persisted));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // Mismatch surfaces; the WORKING draft is the default (both holdings ON),
    // NOT the stale stored draft (which had BTC off).
    expect(result.current.fingerprintMismatch).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);

    // Editing operates on the default the user actually sees, and the resulting
    // write carries the current fingerprint → the mismatch clears.
    act(() => {
      result.current.toggleHolding(REF_ETH);
    });
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(false);
    expect(result.current.fingerprintMismatch).toBe(false);
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

  // M-0136 (pr-test-analyzer) — the prior suite covers single mutators but
  // not (a) rapid concurrent edits within one render pass nor (b) the
  // documented cross-tab limitation.

  // (a) Every mutator uses a FUNCTIONAL setDraft updater (setDraft((d) => …)),
  // so a burst of edits queued in a single act() must all compose — none
  // dropped by a stale closure over `draft`. A regression that switched any
  // mutator to a value-form setState (setDraft(fn(draft))) would lose all but
  // the last edit of the burst; this pins that they accumulate.
  it("M-0136: rapid concurrent edits in one render pass all compose (no stale-closure drop)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // Burst: toggle BTC off, add two strategies, override ETH weight — all
    // before React flushes a re-render.
    act(() => {
      result.current.toggleHolding(REF_BTC);
      result.current.addStrategyBrowse(STRAT_A);
      result.current.addStrategyBrowse(STRAT_B_FIXTURE);
      result.current.setWeightOverride(REF_ETH, 0.5);
    });

    // All four edits survived the burst.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    const addedIds = result.current.draft.addedStrategies.map((s) => s.id);
    expect(addedIds).toContain(STRAT_A.id);
    expect(addedIds).toContain(STRAT_B_FIXTURE.id);
    // setWeightOverride is the last edit in the burst — its value persists.
    expect(result.current.draft.weightOverrides[REF_ETH]).toBeCloseTo(0.5, 9);
    // The two adds are not deduped into one (distinct ids).
    expect(addedIds.length).toBe(2);
  });

  // (b) FLIPPED by B7a-2 — the hook now routes through `useCrossTabStorage`,
  // which installs a `storage` event listener with flush-before-adopt + no-op
  // detection. A second tab editing the SAME allocator's draft (same holdings
  // fingerprint) now propagates to tab A's in-memory draft with no reload and
  // no clobber. This closes the two-tab race the pre-B7 contract pinned as a
  // known limitation.
  it("M-0136: a cross-tab write to the SAME allocator key DOES propagate (B7 storage-event sync)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // Baseline: BTC enabled.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);

    // ANOTHER tab persists an edited draft for the SAME allocator (same
    // fingerprint) and the browser fires the cross-tab `storage` event.
    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    const otherTabDraft: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2, computeHoldingsFingerprint(HOLDINGS_2)),
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: true },
    };
    act(() => {
      store.set(scopedKey, JSON.stringify(otherTabDraft));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: scopedKey,
          newValue: JSON.stringify(otherTabDraft),
        }),
      );
    });

    // The primitive's storage listener adopted the foreign write — tab A's
    // draft now reflects BTC toggled off.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
  });

  // B7a-2 review-hardening (pr-test-analyzer) — a cross-tab write carrying a
  // DIFFERENT fingerprint (the other tab is on a stale holdings set) is adopted
  // into the primitive's value, and the derived state then surfaces the
  // mismatch banner + falls back to the default draft (not the stale foreign
  // toggles).
  it("M-0136 — a cross-tab write with a DIFFERENT fingerprint adopts then surfaces fingerprintMismatch (draft falls back to default)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );
    expect(result.current.fingerprintMismatch).toBe(false);
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);

    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    const staleForeign: ScenarioDraft = {
      schema_version: 1,
      init_holdings_fingerprint: "stale-other-tab-holdings",
      toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: false },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.5, [REF_ETH]: 0.5 },
      lastEditedAt: "2026-01-01T00:00:00.000Z",
    };
    act(() => {
      store.set(scopedKey, JSON.stringify(staleForeign));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: scopedKey,
          newValue: JSON.stringify(staleForeign),
        }),
      );
    });

    // Adopted (value is the foreign draft) → mismatch surfaces, working draft is
    // the default (both holdings ON), not the foreign all-off toggles.
    expect(result.current.fingerprintMismatch).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
  });

  // B7a-2 review-hardening — the in-place allocator key-flip (a single mounted
  // hook whose allocatorId prop changes) must not surface a SPURIOUS mismatch
  // for a new allocator whose stored draft matches their holdings, and MUST
  // surface a real one for a stale new allocator. Pins the deferred-hydration
  // key-flip race the hook claims immunity to (storedMismatch derives from the
  // freshly hydrated `value`, never a stale prior-allocator value).
  it("M1 — in-place A→B key-flip: B's matching-fingerprint draft does NOT surface a spurious mismatch", () => {
    const fpB = computeHoldingsFingerprint(HOLDINGS_B);
    store.set(
      scenarioStorageKey(ALLOCATOR_B),
      JSON.stringify(defaultDraftFromHoldings(HOLDINGS_B, fpB)),
    );

    const { result, rerender } = renderHook(
      ({ allocatorId, holdings }: { allocatorId: string; holdings: HoldingForDefault[] }) =>
        useScenarioState({ holdingsSummary: holdings, allocatorId }),
      { initialProps: { allocatorId: ALLOCATOR_A, holdings: HOLDINGS_2 } },
    );
    expect(result.current.fingerprintMismatch).toBe(false);

    rerender({ allocatorId: ALLOCATOR_B, holdings: HOLDINGS_B });
    // B's stored draft matches B's holdings → no spurious banner from the flip.
    expect(result.current.fingerprintMismatch).toBe(false);
    expect(
      result.current.draft.toggleByScopeRef["holding:kraken:DOGE:spot"],
    ).toBe(true);
  });

  it("M1 — in-place A→B key-flip: B's STALE-fingerprint draft surfaces fingerprintMismatch", () => {
    store.set(
      scenarioStorageKey(ALLOCATOR_B),
      JSON.stringify({
        schema_version: 1,
        init_holdings_fingerprint: "stale-not-matching-B",
        toggleByScopeRef: { "holding:kraken:DOGE:spot": true },
        addedStrategies: [],
        weightOverrides: { "holding:kraken:DOGE:spot": 1.0 },
        lastEditedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { result, rerender } = renderHook(
      ({ allocatorId, holdings }: { allocatorId: string; holdings: HoldingForDefault[] }) =>
        useScenarioState({ holdingsSummary: holdings, allocatorId }),
      { initialProps: { allocatorId: ALLOCATOR_A, holdings: HOLDINGS_2 } },
    );
    expect(result.current.fingerprintMismatch).toBe(false);

    rerender({ allocatorId: ALLOCATOR_B, holdings: HOLDINGS_B });
    expect(result.current.fingerprintMismatch).toBe(true);
    // Default-init from B's holdings (DOGE on).
    expect(
      result.current.draft.toggleByScopeRef["holding:kraken:DOGE:spot"],
    ).toBe(true);
  });

  it("B7a-2 — reset() before the debounce flush does NOT let a pending write resurrect the removed key", () => {
    vi.useFakeTimers();
    try {
      const scopedKey = scenarioStorageKey(ALLOCATOR_A);
      const { result } = renderHook(() =>
        useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
      );

      // Arm the debounce with a mutation, then reset BEFORE the 150ms window.
      act(() => {
        result.current.setWeightOverride(REF_BTC, 0.7);
      });
      act(() => {
        result.current.reset();
      });
      // Advance well past the debounce window — no resurrected write.
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(store.has(scopedKey)).toBe(false);
      const setCallsAfterReset = localStorageMock.setItem.mock.calls.filter(
        (c) => c[0] === scopedKey,
      );
      expect(setCallsAfterReset.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
