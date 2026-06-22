/**
 * Phase 23 / Plan 04 / Task 2 — RED tests for the Save/Update toolbar +
 * loadedScenarioId + codec-trichotomy Open handling on ScenarioComposer.
 *
 * PERSIST-02. The composer gains:
 *   - a Save/Update toolbar in the existing header row (NO modal):
 *       · no scenario open (loadedScenarioId null) → primary "Save scenario"
 *         → reveals an inline "Name this scenario" input + confirm → POST →
 *         on success set loadedScenarioId to the returned id;
 *       · a saved scenario open (loadedScenarioId set) → primary "Update
 *         scenario" (PUT that row) + secondary "Save as new scenario" (POST a
 *         new row → set the new id);
 *   - Open(savedRow): decode row.draft through scenarioDraftCodec —
 *       · ok → hydrateFromSaved + set loadedScenarioId;
 *       · readonly (newer version) → hydrate + set loadedScenarioId + render
 *         the read-only notice + block edits;
 *       · reset (older/invalid) → do NOT hydrate, render the honest "older
 *         format" notice (NEVER a silent empty composer);
 *   - reset() clears loadedScenarioId;
 *   - a drifted (fingerprint-mismatch) reopen surfaces the EXISTING banner;
 *   - a hard save/open failure routes the canonical error copy.
 *
 * The Open path is driven via the `onRegisterOpen` prop — the composer hands the
 * parent (the saved-scenarios list, a later plan) its imperative Open handler.
 * The test grabs it the same way.
 *
 * Mock + fixture conventions mirror ScenarioComposer.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  computeHoldingsFingerprint,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "../lib/scenario-state";

// --- next/navigation mock -------------------------------------------------

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// --- Component / module mocks (inert spies; prop wiring is the UUT) --------

vi.mock("../widgets/performance/EquityChart", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../widgets/performance/EquityChart")
  >();
  return { ...actual, EquityChart: vi.fn(() => <div data-testid="equity-chart-mock" />) };
});
vi.mock("../widgets/performance/DrawdownChart", () => {
  const Mock = vi.fn(() => <div data-testid="drawdown-chart-mock" />);
  return { default: Mock, deriveSnapshotDrawdowns: vi.fn(() => []) };
});
vi.mock("./KpiStrip", () => ({ KpiStrip: vi.fn(() => <div data-testid="kpi-strip-mock" />) }));
vi.mock("./StrategyBrowseDrawer", () => ({
  StrategyBrowseDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="browse-drawer-mock" /> : null),
  ),
}));
vi.mock("./BridgeDrawer", () => ({
  BridgeDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="bridge-drawer-mock" /> : null),
  ),
}));
vi.mock("./ScenarioCommitDrawer", () => ({
  ScenarioCommitDrawer: vi.fn(
    ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="commit-drawer-mock" /> : null),
  ),
}));
vi.mock("../ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: vi.fn(() => <div data-testid="flagged-list-mock" />),
}));
vi.mock("../lib/scenario-adapter", () => ({
  buildStrategyForBuilderSet: vi.fn(() => ({
    strategies: [],
    state: { selected: {}, weights: {}, startDates: {} },
  })),
}));

// --- Imports after mocks --------------------------------------------------

import { ScenarioComposer, type SavedScenarioRow } from "./ScenarioComposer";

// --- localStorage mock ----------------------------------------------------

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  get length() {
    return lsStore.size;
  },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);

// --- Fixtures -------------------------------------------------------------

const ALLOCATOR_A = "allocator-a-uuid";
const SAVED_ID = "11111111-1111-1111-1111-111111111111";
const NEW_ID = "22222222-2222-2222-2222-222222222222";

const HOLDING_BTC = {
  symbol: "BTC",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 60_000,
  quantity: 1,
  mark_price_usd: 60_000,
  api_key_id: "key-binance",
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};
const HOLDING_ETH = {
  symbol: "ETH",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 40_000,
  quantity: 10,
  mark_price_usd: 4_000,
  api_key_id: "key-binance",
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};

const REF_BTC = "holding:binance:BTC:spot";
const REF_ETH = "holding:binance:ETH:spot";

const HOLDINGS = [HOLDING_BTC, HOLDING_ETH];
const CURRENT_FP = computeHoldingsFingerprint(HOLDINGS);

/** A saved draft that matches the current holdings (codec → "ok"). */
function okDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: CURRENT_FP,
    toggleByScopeRef: { [REF_BTC]: true, [REF_ETH]: true },
    addedStrategies: [],
    weightOverrides: { [REF_BTC]: 0.6, [REF_ETH]: 0.4 },
    lastEditedAt: "2026-06-01T00:00:00.000Z",
  };
}

/** Matches the holdings shape but drifted fingerprint (codec → "ok", banner). */
function driftedDraft(): ScenarioDraft {
  return { ...okDraft(), init_holdings_fingerprint: "stale-fingerprint-other-book" };
}

let registeredOpen: ((row: SavedScenarioRow) => void) | null = null;

function makePayload(
  overrides: Partial<MyAllocationDashboardPayload> = {},
): MyAllocationDashboardPayload {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: [],
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary: HOLDINGS,
    snapshotCount: 60,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [
      { date: "2026-01-01", value: 100_000 },
      { date: "2026-01-02", value: 101_000 },
    ],
    minHistoryDepthMonths: 12,
    equityBaselineUnknown: false,
    activeVenues: ["Binance"],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    mandate: null,
    holdingReturnsByScopeRef: {
      [REF_BTC]: [
        { date: "2026-01-01", value: 0.001 },
        { date: "2026-01-02", value: 0.002 },
      ],
      [REF_ETH]: [
        { date: "2026-01-01", value: 0.0015 },
        { date: "2026-01-02", value: 0.001 },
      ],
    },
    allocator_id: ALLOCATOR_A,
    liveBaselineMetrics: {
      aum: 100_000,
      ytdTwr: 0.05,
      sharpe: 1.2,
      maxDd: -0.08,
      avgRho: 0.4,
      equity: [
        { date: "2026-01-01", value: 1.0 },
        { date: "2026-01-02", value: 1.01 },
      ],
      drawdown: [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 0 },
      ],
    },
    apiKeysCount: 1,
    mandateIsSet: false,
    ...overrides,
  } as MyAllocationDashboardPayload;
}

function renderComposer() {
  return render(
    <ScenarioComposer
      payload={makePayload()}
      allocatorId={ALLOCATOR_A}
      allocatorMandate={null}
      onRegisterOpen={(open) => {
        registeredOpen = open;
      }}
    />,
  );
}

function openRow(row: SavedScenarioRow) {
  expect(registeredOpen).not.toBeNull();
  act(() => {
    registeredOpen!(row);
  });
}

// BENCH-01 — the composer now fires a benign GET /api/benchmark/btc on mount.
// These tests assert the SAVE/UPDATE request specifically, so filter the global
// fetch mock to the scenario-save endpoint (the benchmark fetch is unrelated
// transport and must not pollute the save-request assertions).
const SAVE_URL_RE = /\/api\/allocator\/scenario\/saved/;
function saveCalls(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter((c) =>
    SAVE_URL_RE.test(String(c[0])),
  ) as Array<[string, RequestInit | undefined]>;
}

// A fetch mock that answers the benchmark series with an empty array (so
// btcAvailable stays false — irrelevant to the save flow) and routes every
// other URL to `saveResponse`.
function makeFetchMock(
  saveResponse: () => { ok: boolean; status: number; json: () => Promise<unknown> },
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/benchmark/btc")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return saveResponse();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ScenarioComposer — Save/Update toolbar + codec Open (Phase 23 Plan 04)", () => {
  beforeEach(() => {
    lsStore.clear();
    vi.clearAllMocks();
    registeredOpen = null;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  // -------------------------------------------------------------------------
  // T_SAVE1 — no scenario open → "Save scenario"; inline name input (no modal)
  // -------------------------------------------------------------------------
  it("T_SAVE1 no scenario open → primary 'Save scenario'; click reveals an inline name input (no modal)", () => {
    renderComposer();

    const saveBtn = screen.getByRole("button", { name: /^Save scenario$/i });
    expect(saveBtn).toBeInTheDocument();
    // Update / Save-as-new are NOT present yet (no scenario open).
    expect(
      screen.queryByRole("button", { name: /Update scenario/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save as new scenario/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(saveBtn);
    // Inline input appears (NOT a modal — no dialog role).
    expect(
      screen.getByPlaceholderText(/Name this scenario/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE2 — name validation: empty → copy; >120 → copy
  // -------------------------------------------------------------------------
  it("T_SAVE2 inline name validation: empty → 'Enter a name…'; over 120 chars → limit copy; no POST fired", () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "x" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save scenario$/i }));

    const input = screen.getByPlaceholderText(/Name this scenario/i);
    const confirm = screen.getByRole("button", { name: /^Save$/i });

    // Empty submit.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(confirm);
    expect(
      screen.getByText(/Enter a name to save this scenario\./i),
    ).toBeInTheDocument();
    // No SAVE request fired (the benchmark GET is unrelated transport).
    expect(saveCalls(fetchMock)).toHaveLength(0);

    // Over-length submit.
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    fireEvent.click(confirm);
    expect(
      screen.getByText(/Scenario names are limited to 120 characters\./i),
    ).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T_SAVE3 — valid name → POST → on success loadedScenarioId set → toolbar
  //           flips to Update + Save-as-new
  // -------------------------------------------------------------------------
  it("T_SAVE3 valid name → POST /api/allocator/scenario/saved → on success toolbar flips to 'Update scenario' + 'Save as new scenario'", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "My scenario" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save scenario$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this scenario/i), {
      target: { value: "My scenario" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe("/api/allocator/scenario/saved");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.name).toBe("My scenario");
    expect(body.draft).toBeDefined();
    expect(body.draft.schema_version).toBe(SCENARIO_SCHEMA_VERSION);

    // After success, loadedScenarioId is set → toolbar flips.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Update scenario/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Save as new scenario/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE4 — Open(ok row) → hydrate + loadedScenarioId set → Update visible;
  //           then Update → PUT that row's id
  // -------------------------------------------------------------------------
  it("T_SAVE4 Open(ok row) → toolbar shows 'Update scenario'; Update → PUT /api/allocator/scenario/saved/{id}", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: SAVED_ID, name: "Saved" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Saved", draft: okDraft() });

    const updateBtn = await screen.findByRole("button", { name: /Update scenario/i });
    expect(updateBtn).toBeInTheDocument();

    fireEvent.click(updateBtn);
    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe(`/api/allocator/scenario/saved/${SAVED_ID}`);
    expect((init as RequestInit).method).toBe("PUT");
  });

  // -------------------------------------------------------------------------
  // T_SAVE5 — Save as new (a scenario is open) → POST a NEW row → new id
  // -------------------------------------------------------------------------
  it("T_SAVE5 with a scenario open, 'Save as new scenario' → POST (new row) and adopts the new id", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Copy" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Saved", draft: okDraft() });

    const saveAsNew = await screen.findByRole("button", { name: /Save as new scenario/i });
    fireEvent.click(saveAsNew);
    // Inline name input for the new copy.
    fireEvent.change(screen.getByPlaceholderText(/Name this scenario/i), {
      target: { value: "Copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe("/api/allocator/scenario/saved");
    expect((init as RequestInit).method).toBe("POST");
  });

  // -------------------------------------------------------------------------
  // T_SAVE6 — Open(reset/older row) → honest notice + NO hydrate (NOT empty)
  // -------------------------------------------------------------------------
  it("T_SAVE6 Open(reset row, older incompatible schema) → renders the honest 'older format' notice and does NOT hydrate (never a silent empty composer)", () => {
    renderComposer();

    // schema_version below the current → codec returns "reset". A "reset" must
    // NEVER silently load an empty composer.
    const olderRow: SavedScenarioRow = {
      id: SAVED_ID,
      name: "Ancient",
      draft: {
        ...okDraft(),
        schema_version: SCENARIO_SCHEMA_VERSION - 1,
      } as unknown as ScenarioDraft,
    };
    openRow(olderRow);

    expect(
      screen.getByText(
        /This saved scenario uses an older format and can't be reopened\./i,
      ),
    ).toBeInTheDocument();
    // NOT hydrated → loadedScenarioId stays null → still "Save scenario", NOT
    // "Update scenario" (an empty composer silently adopting the id would be a
    // dishonest default).
    expect(
      screen.getByRole("button", { name: /^Save scenario$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Update scenario/i }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE7 — Open(readonly/newer row) → read-only notice + hydrate + block
  // -------------------------------------------------------------------------
  it("T_SAVE7 Open(readonly row, newer schema_version) → renders the read-only notice, sets loadedScenarioId, blocks edits", () => {
    renderComposer();

    const newerRow: SavedScenarioRow = {
      id: SAVED_ID,
      name: "From the future",
      draft: {
        ...okDraft(),
        schema_version: SCENARIO_SCHEMA_VERSION + 1,
      } as unknown as ScenarioDraft,
    };
    openRow(newerRow);

    expect(
      screen.getByText(
        /This scenario was saved by a newer version and is read-only here\./i,
      ),
    ).toBeInTheDocument();
    // Hydrated read-only → loadedScenarioId IS set (the row is open), but edits
    // are blocked: the Update primary is not offered as an editable save (the
    // read-only notice is shown instead). "Save as new scenario" remains so the
    // user can fork it into an editable copy.
    expect(
      screen.getByRole("button", { name: /Save as new scenario/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE8 — Open(drifted ok row) → EXISTING fingerprint-mismatch banner
  // -------------------------------------------------------------------------
  it("T_SAVE8 Open(ok row whose fingerprint drifted from current holdings) → surfaces the EXISTING fingerprint-mismatch banner verbatim", () => {
    renderComposer();
    openRow({ id: SAVED_ID, name: "Drifted", draft: driftedDraft() });

    expect(
      screen.getByText(
        /Your live holdings have changed since you last edited the scenario/i,
      ),
    ).toBeInTheDocument();
    // It's the existing banner element (reused verbatim, not re-styled).
    expect(
      document.getElementById("scenario-fingerprint-mismatch-banner"),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE9 — hard save failure → canonical error copy
  // -------------------------------------------------------------------------
  it("T_SAVE9 a hard save failure (500) routes the canonical 'Couldn't save this scenario' copy", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Save failed",
        message: "Couldn't save this scenario. Check your connection and try again.",
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save scenario$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this scenario/i), {
      target: { value: "Doomed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't save this scenario\./i),
      ).toBeInTheDocument();
    });
    // Failure → loadedScenarioId NOT adopted (still "Save scenario").
    expect(
      screen.getByRole("button", { name: /^Save scenario$/i }),
    ).toBeInTheDocument();
  });
});
