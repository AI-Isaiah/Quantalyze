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
  defaultDraftFromHoldings,
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
    memberKeyIds: [],
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
    memberKeyIds: [],
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

    // HONESTY CONTRACT (FIX 9): the WORKING draft must be the DEFAULT (current
    // holdings, all-on) — NOT the mismatched saved draft's toggles. The saved
    // draft was built for a DIFFERENT book; exposing its toggles would silently
    // edit a draft the user never composed for THIS book.
    const def = defaultDraftFromHoldings(HOLDINGS_2);
    expect(result.current.draft.toggleByScopeRef).toEqual(def.toggleByScopeRef);
    // Concretely: the default has BOTH holdings on; the mismatched saved draft
    // has only BTC (no ETH key at all). The exposed draft must show the default.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    // And it must NOT be the stale saved draft (which omits ETH entirely).
    expect(result.current.draft.toggleByScopeRef).not.toEqual(
      mismatchedSavedDraft().toggleByScopeRef,
    );
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
      memberKeyIds: [],
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

  it("T_HYD5 (PERSIST-01) hydrating a v3 draft that CARRIES a coverage window adopts window verbatim on the working draft — the reopen seam surfaces draft.window to the composer", () => {
    // The window is Phase-57 composer-LOCAL state, seeded FROM draft.window on
    // reopen (ScenarioComposer.openSavedScenario). The hook's contract here is
    // narrow but load-bearing: hydrateFromSaved must pass the saved draft
    // THROUGH verbatim (setValue), so `draft.window` is present on the working
    // draft for the composer to read and applyWindow() from. A hook that
    // stripped unknown/new fields would break the reopen-at-saved-window path.
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    const windowedDraft: ScenarioDraft = {
      ...matchingSavedDraft(),
      window: { start: "2024-02-01", end: "2024-11-30" },
    };

    act(() => {
      result.current.hydrateFromSaved(windowedDraft);
    });

    // The saved window rides through onto the working draft VERBATIM (no
    // re-derivation, no strip) so the composer can seed winStart/winEnd from it.
    expect(result.current.draft.window).toEqual({
      start: "2024-02-01",
      end: "2024-11-30",
    });
    // Fingerprint matches → no banner, and the rest of the draft is adopted.
    expect(result.current.fingerprintMismatch).toBe(false);
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
  });

  it("T_HYD6 (PERSIST-01) hydrating a windowless draft leaves draft.window undefined — the composer defaults it via the intersection on open", () => {
    // A v2 (upgraded) or a fresh windowless v3 draft carries no window. The hook
    // adopts it as-is; the composer's auto-default effect (defaultWindowFor)
    // supplies the intersection default. The seam must NOT invent a window here.
    const { result } = renderHook(() =>
      useScenarioState({ holdingsSummary: HOLDINGS_2, allocatorId: ALLOCATOR_A }),
    );

    act(() => {
      result.current.hydrateFromSaved(matchingSavedDraft());
    });

    expect(result.current.draft.window).toBeUndefined();
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

// ---------------------------------------------------------------------------
// CR-01 (Phase 63 review) — driftReferenceHoldings: the shared drift predicate.
//
// In forced-blank mode the composer gates holdingsSummary to [] but passes the
// LIVE book as driftReferenceHoldings. `storedMismatch` (and `baseOf`) must
// then treat a draft as drifted ONLY when it matches NEITHER the gated default
// NOR the live book — so the hook's apply/discard decision agrees with
// openSavedScenario's drift check. Pre-fix (single gated fingerprint) a book
// draft reopened in forced-blank looked mismatched and fell back to the blank
// default (false banner + saved-draft overwrite).
// ---------------------------------------------------------------------------

describe("useScenarioState — CR-01 driftReferenceHoldings shared drift predicate", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("case (a): blank-gated hook with a live-book drift reference APPLIES a book-fingerprint draft and does NOT fire the banner", () => {
    // Forced-blank: gated holdingsSummary=[], drift reference = the live book.
    const { result } = renderHook(() =>
      useScenarioState({
        holdingsSummary: [],
        driftReferenceHoldings: HOLDINGS_2,
        allocatorId: ALLOCATOR_A,
      }),
    );

    act(() => {
      // matchingSavedDraft carries fp(HOLDINGS_2) — matches the LIVE book.
      result.current.hydrateFromSaved(matchingSavedDraft());
    });

    // Applied (the saved book toggles/weights are the working draft), NOT the
    // blank default the pre-fix gated-only predicate fell back to.
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    expect(result.current.draft.toggleByScopeRef[REF_ETH]).toBe(true);
    expect(result.current.draft.weightOverrides[REF_ETH]).toBeCloseTo(1.0, 9);
    // Matches the live book → no false "holdings changed" banner.
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("case (a) cont.: an edit after the applied book draft does NOT rebase to the blank default (baseOf honors the live book)", () => {
    const { result } = renderHook(() =>
      useScenarioState({
        holdingsSummary: [],
        driftReferenceHoldings: HOLDINGS_2,
        allocatorId: ALLOCATOR_A,
      }),
    );
    act(() => {
      result.current.hydrateFromSaved(matchingSavedDraft());
    });
    // Editing must operate on the APPLIED book draft, not a blank rebase — the
    // BTC toggle-off survives the edit (a blank default has no such entry).
    act(() => {
      result.current.addStrategyBrowse({
        id: "added-x",
        name: "Added X",
        markets: [],
        strategy_types: [],
      } as unknown as Parameters<typeof result.current.addStrategyBrowse>[0]);
    });
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBe(false);
    expect(
      result.current.draft.addedStrategies.some((a) => a.id === "added-x"),
    ).toBe(true);
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("case (b) / fresh blank: a blank-authored draft (fp of []) matches the gated default → applied, no banner", () => {
    const { result } = renderHook(() =>
      useScenarioState({
        holdingsSummary: [],
        driftReferenceHoldings: HOLDINGS_2,
        allocatorId: ALLOCATOR_A,
      }),
    );
    const blankAuthored: ScenarioDraft = {
      ...defaultDraftFromHoldings([]),
      addedStrategies: [
        { id: "added-y", name: "Added Y", markets: [], strategy_types: [] },
      ] as unknown as ScenarioDraft["addedStrategies"],
    };
    act(() => {
      result.current.hydrateFromSaved(blankAuthored);
    });
    // Matches the gated ([]) default → applied, NOT flagged as drifted just
    // because the live book is non-empty.
    expect(
      result.current.draft.addedStrategies.some((a) => a.id === "added-y"),
    ).toBe(true);
    expect(result.current.fingerprintMismatch).toBe(false);
  });

  it("stale: a draft matching NEITHER the gated default NOR the live book fires the banner and falls back to the default", () => {
    const { result } = renderHook(() =>
      useScenarioState({
        holdingsSummary: [],
        driftReferenceHoldings: HOLDINGS_2,
        allocatorId: ALLOCATOR_A,
      }),
    );
    act(() => {
      result.current.hydrateFromSaved(mismatchedSavedDraft());
    });
    // Matches neither → drifted → banner + working draft is the (blank) default.
    expect(result.current.fingerprintMismatch).toBe(true);
    expect(result.current.draft.toggleByScopeRef[REF_BTC]).toBeUndefined();
  });
});
