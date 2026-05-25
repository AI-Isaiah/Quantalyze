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

  // H-0134 — the header comment (scenario-state.ts:20-21) describes the
  // schema_version-mismatch path as "schema_version mismatch → clear", but
  // loadScenarioDraft (lines 445-457) only RETURNS null on mismatch — it does
  // NOT removeItem the stale blob. This test pins the ACTUAL contract: a
  // version-mismatch read is non-destructive. The stale value stays in
  // localStorage until a subsequent saveScenarioDraft overwrites it. This is
  // the documented-correct behavior (load is a pure read with no side effect),
  // so it is asserted positively. If a future fix wires the comment's
  // clear-on-mismatch semantics, this is the canonical place to flip the
  // assertion to `expect(store.has(...)).toBe(false)` and assert removeItem.
  it("H-0134 — schema_version mismatch load does NOT clear the stale blob (load is non-destructive; comment says 'clear' but code only returns null)", () => {
    const scopedKey = scenarioStorageKey("alloc-A");
    const stale = {
      ...defaultDraftFromHoldings(HOLDINGS_2),
      schema_version: SCENARIO_SCHEMA_VERSION + 1,
    };
    const serialized = JSON.stringify(stale);
    store.set(scopedKey, serialized);

    // First read: mismatch → null.
    expect(loadScenarioDraft("alloc-A")).toBeNull();

    // The stale value is STILL in localStorage — load did not removeItem.
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    expect(store.get(scopedKey)).toBe(serialized);

    // A SECOND read sees the same stale blob and again returns null (the
    // value is never auto-evicted; only a save overwrites it).
    expect(loadScenarioDraft("alloc-A")).toBeNull();
    expect(store.get(scopedKey)).toBe(serialized);
  });

  // H-0134 (migration path) — "old client wrote v(N), new client reads v(N+1)
  // schema". A save AFTER a mismatched read overwrites the stale blob with the
  // current schema_version, so a subsequent load succeeds. Pins that recovery
  // is save-driven (the only thing that evicts a stale blob), not load-driven.
  it("H-0134 — a save after a version-mismatch read overwrites the stale blob; the next load then succeeds at the current schema_version", () => {
    const scopedKey = scenarioStorageKey("alloc-A");
    const stale = {
      ...defaultDraftFromHoldings(HOLDINGS_2),
      schema_version: SCENARIO_SCHEMA_VERSION + 1,
    };
    store.set(scopedKey, JSON.stringify(stale));
    expect(loadScenarioDraft("alloc-A")).toBeNull();

    // New client writes a current-schema draft over the stale key.
    const fresh = defaultDraftFromHoldings(HOLDINGS_2);
    expect(fresh.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
    saveScenarioDraft("alloc-A", fresh);

    // Now the load succeeds — the stale blob was overwritten by the save.
    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).not.toBeNull();
    expect(loaded?.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
    expect(loaded?.init_holdings_fingerprint).toBe(fresh.init_holdings_fingerprint);
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

  // M-0150 (pr-test-analyzer) — T2.5 only covers ONE malformation (syntactic
  // garbage). loadScenarioDraft (scenario-state.ts:445-457) validates ONLY
  // `schema_version`; there is no field-shape validation. These pin the
  // remaining realistic corruption paths so a future refactor that (e.g.)
  // tightens or loosens the validation surfaces here instead of in prod.

  it("M-0150: valid JSON missing schema_version ({}) → null (undefined !== SCENARIO_SCHEMA_VERSION)", () => {
    // Parses cleanly, but `parsed.schema_version` is undefined; the strict
    // `!== SCENARIO_SCHEMA_VERSION` check rejects it. T2.3 only covers
    // version+1 — the absent-field case is a distinct branch.
    store.set(scenarioStorageKey("alloc-A"), JSON.stringify({}));
    expect(loadScenarioDraft("alloc-A")).toBeNull();
  });

  it("M-0150: valid JSON with schema_version present but wrong-typed fields flows through UNVALIDATED (current contract)", () => {
    // The load path does NOT shape-validate beyond schema_version. A blob with
    // toggleByScopeRef as an ARRAY (wrong type) and weightOverrides absent is
    // returned verbatim. This pins the KNOWN limitation: callers must not
    // assume loadScenarioDraft sanitizes shape. If a future change adds zod
    // validation, flip this to assert null + update the comment.
    const malformed = {
      schema_version: SCENARIO_SCHEMA_VERSION,
      init_holdings_fingerprint: "fp-x",
      toggleByScopeRef: ["not", "an", "object"], // wrong type
      // weightOverrides + addedStrategies + lastEditedAt absent
    };
    store.set(scenarioStorageKey("alloc-A"), JSON.stringify(malformed));
    const loaded = loadScenarioDraft("alloc-A");
    expect(loaded).not.toBeNull();
    // Returned AS-IS — the array survived because there is no field validation.
    expect(loaded?.toggleByScopeRef).toEqual(["not", "an", "object"]);
  });

  it("M-0150: valid blob carrying extra unknown keys flows through unchanged (no allowlist)", () => {
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    const withExtras = {
      ...draft,
      __injected: "from-a-browser-extension",
      nested: { evil: true },
    };
    store.set(scenarioStorageKey("alloc-A"), JSON.stringify(withExtras));
    const loaded = loadScenarioDraft("alloc-A") as
      | (ScenarioDraft & { __injected?: string })
      | null;
    expect(loaded).not.toBeNull();
    // Known fields preserved.
    expect(loaded?.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
    // Extra keys are NOT stripped — there is no allowlist on the read path.
    expect(loaded?.__injected).toBe("from-a-browser-extension");
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
