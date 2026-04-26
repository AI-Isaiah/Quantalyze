/**
 * Phase 10 Plan 01 / Task 1 — RED tests for scenario-state.ts localStorage helpers.
 *
 * Pins the contract for SSR-safe + Safari-private-mode-safe persistence:
 *   - load/save/clear round-trip with per-allocator scoped key (N1 defense-in-depth)
 *   - schema_version mismatch → clear (load returns null)
 *   - QuotaExceededError swallowed silently
 *   - JSON.parse error swallowed silently (corrupted localStorage)
 *   - SSR guard: typeof window === "undefined" → load returns null, save/clear no-op
 *   - Cross-tenant isolation: alloc-A and alloc-B drafts never collide
 *   - scenarioStorageKey shape pinned: "allocations.scenario_v0_15.{allocatorId}"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadScenarioDraft,
  saveScenarioDraft,
  clearScenarioDraft,
  scenarioStorageKey,
  SCENARIO_STORAGE_KEY_BASE,
  SCENARIO_SCHEMA_VERSION,
  defaultDraftFromHoldings,
  type HoldingForDefault,
  type ScenarioDraft,
} from "./scenario-state";

// Module-level Map-backed mock matching the project idiom (Phase 08 Plan 02).
const store = new Map<string, string>();
let throwOnSetItem = false;

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    if (throwOnSetItem) throw new Error("QuotaExceeded");
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

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

beforeEach(() => {
  store.clear();
  throwOnSetItem = false;
  vi.clearAllMocks();
});

describe("scenarioStorageKey (N1 — per-allocator scoped key)", () => {
  it("T2.9 — exact shape: allocations.scenario_v0_15.{allocatorId}", () => {
    expect(scenarioStorageKey("alloc-A")).toBe("allocations.scenario_v0_15.alloc-A");
  });

  it("base constant equals 'allocations.scenario_v0_15'", () => {
    expect(SCENARIO_STORAGE_KEY_BASE).toBe("allocations.scenario_v0_15");
  });
});

describe("save/load round-trip", () => {
  it("T2.1 — saveScenarioDraft + loadScenarioDraft preserves all fields", () => {
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    saveScenarioDraft("alloc-A", draft);
    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).not.toBeNull();
    expect(loaded?.schema_version).toBe(draft.schema_version);
    expect(loaded?.init_holdings_fingerprint).toBe(draft.init_holdings_fingerprint);
    expect(loaded?.toggleByScopeRef).toEqual(draft.toggleByScopeRef);
    expect(loaded?.weightOverrides).toEqual(draft.weightOverrides);
    expect(loaded?.lastEditedAt).toBe(draft.lastEditedAt);
  });

  it("T2.2 — loadScenarioDraft returns null when localStorage is empty", () => {
    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).toBeNull();
  });

  it("T2.3 — loadScenarioDraft returns null when stored schema_version !== SCENARIO_SCHEMA_VERSION", () => {
    const stale = {
      ...defaultDraftFromHoldings(HOLDINGS_2),
      schema_version: SCENARIO_SCHEMA_VERSION + 1,
    };
    store.set(scenarioStorageKey("alloc-A"), JSON.stringify(stale));
    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).toBeNull();
  });
});

describe("error handling", () => {
  it("T2.4 — saveScenarioDraft swallows QuotaExceededError silently and returns undefined", () => {
    throwOnSetItem = true;
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    let threw = false;
    let returned: unknown;
    try {
      returned = saveScenarioDraft("alloc-A", draft);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(returned).toBeUndefined();
  });

  it("T2.5 — loadScenarioDraft returns null and does NOT throw on JSON.parse error", () => {
    store.set(scenarioStorageKey("alloc-A"), "{not valid json}}}");
    let threw = false;
    let loaded: ScenarioDraft | null = null;
    try {
      loaded = loadScenarioDraft("alloc-A");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(loaded).toBeNull();
  });
});

describe("clear", () => {
  it("T2.6 — clearScenarioDraft calls removeItem with scenarioStorageKey(allocatorId), NOT the bare base key", () => {
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    saveScenarioDraft("alloc-A", draft);
    expect(store.has(scenarioStorageKey("alloc-A"))).toBe(true);
    clearScenarioDraft("alloc-A");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      scenarioStorageKey("alloc-A"),
    );
    expect(store.has(scenarioStorageKey("alloc-A"))).toBe(false);
    // Bare base key should NEVER be touched directly by clearScenarioDraft
    expect(localStorageMock.removeItem).not.toHaveBeenCalledWith(
      SCENARIO_STORAGE_KEY_BASE,
    );
  });
});

describe("SSR guard", () => {
  // We only stub window for ONE describe block — restore after.
  let savedWindow: unknown;
  beforeEach(() => {
    savedWindow = (globalThis as { window?: unknown }).window;
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = savedWindow;
  });

  it("T2.7 — typeof window === 'undefined' → load returns null, save no-ops, clear no-ops", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(typeof window).toBe("undefined");

    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).toBeNull();

    const draft: ScenarioDraft = {
      schema_version: SCENARIO_SCHEMA_VERSION,
      init_holdings_fingerprint: "fp-x",
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
      lastEditedAt: new Date().toISOString(),
    };
    let threw = false;
    try {
      saveScenarioDraft("alloc-A", draft);
      clearScenarioDraft("alloc-A");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("cross-tenant isolation (N1 — defense-in-depth)", () => {
  it("T2.8 — saveScenarioDraft for alloc-A and alloc-B never collide", () => {
    const draftA: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2),
      init_holdings_fingerprint: "fp-A",
    };
    const draftB: ScenarioDraft = {
      ...defaultDraftFromHoldings(HOLDINGS_2),
      init_holdings_fingerprint: "fp-B",
    };
    saveScenarioDraft("alloc-A", draftA);
    saveScenarioDraft("alloc-B", draftB);

    const loadedA = loadScenarioDraft("alloc-A");
    const loadedB = loadScenarioDraft("alloc-B");

    expect(loadedA?.init_holdings_fingerprint).toBe("fp-A");
    expect(loadedB?.init_holdings_fingerprint).toBe("fp-B");
    expect(loadedA?.init_holdings_fingerprint).not.toBe(
      loadedB?.init_holdings_fingerprint,
    );
  });
});
