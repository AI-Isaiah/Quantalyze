/**
 * Phase 23 / Plan 04 / Task 1 — RED tests for the `hydrateFromSaved` one-shot
 * reopen seam on `useScenarioState`.
 *
 * PERSIST-02. Opening a saved scenario routes its draft into the composer via
 * the hook's OWN `setValue` (the same path the mutators use) so the existing
 * fingerprint-mismatch banner DERIVES automatically — no `loadedFromDb` bypass
 * branch, no `removeStored` (which would destructively wipe the localStorage
 * key). The codec trichotomy runs in the COMPOSER layer (Task 2) before calling
 * this seam; this hook test pins the seam's contract:
 *
 *   - hydrating a draft whose `init_holdings_fingerprint` MATCHES the current
 *     holdings sets the working draft to it WITHOUT firing fingerprintMismatch,
 *   - hydrating a draft whose fingerprint is MISMATCHED fires fingerprintMismatch
 *     with NO special-casing (it derives from value.init_holdings_fingerprint),
 *   - hydrate routes through setValue (NOT removeStored) — it does NOT
 *     destructively `removeItem` the allocator-scoped localStorage key,
 *   - a fresh open un-dismisses the banner (mismatchDismissed → false).
 *
 * vi.stubGlobal("localStorage", mock) idiom mirrors useScenarioState.test.tsx.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScenarioState } from "./useScenarioState";
import {
  scenarioStorageKey,
  computeHoldingsFingerprint,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
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

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

const REF_BTC = "holding:binance:BTC:spot";
const REF_ETH = "holding:binance:ETH:spot";

/** A saved draft as it would arrive from the DB row, fingerprint-MATCHING the
 *  current holdings. The codec (composer layer) returns this verbatim on `ok`. */
function matchingSavedDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: computeHoldingsFingerprint(HOLDINGS_2),
    toggleByScopeRef: { [REF_BTC]: false, [REF_ETH]: true },
    addedStrategies: [],
    weightOverrides: { [REF_BTC]: 0.6, [REF_ETH]: 1.0 },
    lastEditedAt: "2026-06-01T00:00:00.000Z",
  };
}

/** A saved draft built against a DIFFERENT holdings set — its fingerprint does
 *  not match the current holdings, so reopening it must surface the banner. */
function mismatchedSavedDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "stale-fingerprint-from-another-book",
    toggleByScopeRef: { [REF_BTC]: true },
    addedStrategies: [],
    weightOverrides: { [REF_BTC]: 1.0 },
    lastEditedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// hydrateFromSaved — reopen seam contract
// ---------------------------------------------------------------------------

describe("useScenarioState — hydrateFromSaved reopen seam (Phase 23 Plan 04)", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("T_HYD1 hydrating a MATCHING-fingerprint saved draft adopts it as the working draft WITHOUT firing fingerprintMismatch", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    // Sanity: default-init, no banner.
    expect(result.current.fingerprintMismatch).toBe(false);

    act(() => {
      result.current.hydrateFromSaved(matchingSavedDraft());
    });

    // The saved draft is now the working draft (BTC toggled OFF, ETH weight 1.0).
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    expect(result.current.draft.weightOverrides[REF_ETH]).toBeCloseTo(1.0, 9);
    // Matching fingerprint → no banner.
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("T_HYD2 hydrating a MISMATCHED-fingerprint saved draft fires fingerprintMismatch automatically (no loadedFromDb special-case)", () => {
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    expect(result.current.fingerprintMismatch).toBe(false);

    act(() => {
      result.current.hydrateFromSaved(mismatchedSavedDraft());
    });

    // The banner DERIVES from value.init_holdings_fingerprint !== current
    // fingerprint — the seam writes the saved draft (carrying the stale
    // fingerprint) into `value`, so the existing storedMismatch derivation
    // fires with no special-casing.
    expect(result.current.fingerprintMismatch).toBe(true);
  });

  it("T_HYD3 hydrate routes through setValue, NOT removeStored — it does NOT destructively wipe the allocator-scoped localStorage key", () => {
    // Pre-seed an existing persisted draft at the scoped key (a real session
    // would have one). hydrate must NOT removeItem it (Pitfall 6).
    const fp = computeHoldingsFingerprint(HOLDINGS_2);
    const preExisting: ScenarioDraft = {
      schema_version: SCENARIO_SCHEMA_VERSION,
      init_holdings_fingerprint: fp,
      toggleByScopeRef: { [REF_BTC]: true, [REF_ETH]: true },
      addedStrategies: [],
      weightOverrides: { [REF_BTC]: 0.6, [REF_ETH]: 0.4 },
      lastEditedAt: "2026-05-01T00:00:00.000Z",
    };
    const scopedKey = scenarioStorageKey(ALLOCATOR_A);
    store.set(scopedKey, JSON.stringify(preExisting));

    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.hydrateFromSaved(matchingSavedDraft());
    });

    // removeItem must NOT have been called on the scoped key (reset() would —
    // hydrate must not). The key remains present.
    const removeCallsForKey = localStorageMock.removeItem.mock.calls.filter(
      (c) => c[0] === scopedKey,
    );
    expect(removeCallsForKey.length).toBe(0);
    expect(store.has(scopedKey)).toBe(true);
  });

  it("T_HYD4 a freshly-opened scenario un-dismisses the mismatch banner (mismatchDismissed → false)", () => {
    // Seed a mismatched stored draft so the banner shows on mount.
    store.set(
      scenarioStorageKey(ALLOCATOR_A),
      JSON.stringify(mismatchedSavedDraft()),
    );
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    expect(result.current.fingerprintMismatch).toBe(true);

    // User dismisses the banner ("Keep my draft").
    act(() => {
      result.current.dismissFingerprintMismatchBanner();
    });
    expect(result.current.fingerprintMismatch).toBe(false);

    // Now open another saved scenario that is ALSO drifted — the banner must
    // come back (a fresh open gets a fresh banner), proving hydrate resets
    // mismatchDismissed rather than inheriting the prior dismissal.
    act(() => {
      result.current.hydrateFromSaved(mismatchedSavedDraft());
    });
    expect(result.current.fingerprintMismatch).toBe(true);
  });
});
