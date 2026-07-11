/**
 * Phase 23 / Plan 04 / Task 2 — RED tests for the Save/Update toolbar +
 * loadedScenarioId + codec-trichotomy Open handling on ScenarioComposer.
 *
 * PERSIST-02. The composer gains:
 *   - a Save/Update toolbar in the existing header row (NO modal):
 *       · no scenario open (loadedScenarioId null) → primary "Save portfolio"
 *         → reveals an inline "Name this portfolio" input + confirm → POST →
 *         on success set loadedScenarioId to the returned id;
 *       · a saved scenario open (loadedScenarioId set) → primary "Update
 *         scenario" (PUT that row) + secondary "Save as new portfolio" (POST a
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
  MAX_MEMBER_KEY_IDS,
  scenarioStorageKey,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "../lib/scenario-state";
import { MAX_LEVERAGE } from "@/lib/leverage";

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
// SFH-2 — a corrupt persisted leverage (T_LEV_LOAD3's 999) now emits a Sentry
// warning on rehydrate-sanitize. Stub the helper so the suite stays hermetic
// (no real @sentry import) — the coercion signal itself is asserted in
// src/lib/leverage.test.ts.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
// ENGINE-01 (Phase 63): the composer builds its series-space engine set from the
// REAL per-key + added constructions, so this suite keeps them genuine via
// importOriginal. The windowed-save (review-CR-01) tests drive their two-strategy
// unequal-span book through the real per-key path (book+gate payload fixtures).
vi.mock("../lib/scenario-adapter", async (importOriginal) => {
  const actualAdapter =
    await importOriginal<typeof import("../lib/scenario-adapter")>();
  // ENGINE-01 (Phase 63): the composer builds its series-space engine set from
  // the REAL per-key + added constructions, so keep them genuine. The former
  // holdings-snapshot builder was removed from the composer — nothing to stub.
  return { ...actualAdapter };
});

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
    memberKeyIds: [],
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
    // Phase 37 / DSRC-01 — per-key channel additive fields (no per-key coverage
    // here; the per-source control stays hidden — gate false).
    perKeyReturnsByApiKeyId: {},
    perKeyDailiesGateSatisfied: false,
    eligibleApiKeyIds: [],
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
  // T_SAVE1 — no scenario open → "Save portfolio"; inline name input (no modal)
  // -------------------------------------------------------------------------
  it("T_SAVE1 no scenario open → primary 'Save portfolio'; click reveals an inline name input (no modal)", () => {
    renderComposer();

    const saveBtn = screen.getByRole("button", { name: /^Save portfolio$/i });
    expect(saveBtn).toBeInTheDocument();
    // Update / Save-as-new are NOT present yet (no scenario open).
    expect(
      screen.queryByRole("button", { name: /Update portfolio/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Save as new portfolio/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(saveBtn);
    // Inline input appears (NOT a modal — no dialog role).
    expect(
      screen.getByPlaceholderText(/Name this portfolio/i),
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
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));

    const input = screen.getByPlaceholderText(/Name this portfolio/i);
    const confirm = screen.getByRole("button", { name: /^Save$/i });

    // Empty submit.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(confirm);
    expect(
      screen.getByText(/Enter a name to save this portfolio\./i),
    ).toBeInTheDocument();
    // No SAVE request fired (the benchmark GET is unrelated transport).
    expect(saveCalls(fetchMock)).toHaveLength(0);

    // Over-length submit.
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    fireEvent.click(confirm);
    expect(
      screen.getByText(/Portfolio names are limited to 120 characters\./i),
    ).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T_SAVE3 — valid name → POST → on success loadedScenarioId set → toolbar
  //           flips to Update + Save-as-new
  // -------------------------------------------------------------------------
  it("T_SAVE3 valid name → POST /api/allocator/scenario/saved → on success toolbar flips to 'Update portfolio' + 'Save as new portfolio'", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "My scenario" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
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
        screen.getByRole("button", { name: /Update portfolio/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Save as new portfolio/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE4 — Open(ok row) → hydrate + loadedScenarioId set → Update visible;
  //           then Update → PUT that row's id
  // -------------------------------------------------------------------------
  it("T_SAVE4 Open(ok row) → toolbar shows 'Update portfolio'; Update → PUT /api/allocator/scenario/saved/{id}", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: SAVED_ID, name: "Saved" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Saved", draft: okDraft() });

    const updateBtn = await screen.findByRole("button", { name: /Update portfolio/i });
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
  it("T_SAVE5 with a scenario open, 'Save as new portfolio' → POST (new row) and adopts the new id", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Copy" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Saved", draft: okDraft() });

    const saveAsNew = await screen.findByRole("button", { name: /Save as new portfolio/i });
    fireEvent.click(saveAsNew);
    // Inline name input for the new copy.
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
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
  it("T_SAVE6 Open(reset row, older incompatible schema) → renders the relabeled 'older format' notice and does NOT hydrate (codec trichotomy non-regression; never a silent empty composer)", () => {
    renderComposer();

    // A schema_version BELOW the non-destructive-upgrade window is a
    // genuinely-incompatible legacy shape → codec returns "reset". v1.6
    // MEMBER-01's DOUBLE bump (SCENARIO_SCHEMA_VERSION 3→4, PREV 2→3) added a
    // SECOND non-destructive branch keyed on the LITERAL version 2 (the v2-chain
    // branch), so BOTH v2 and v3 (=PREV) now upgrade to "ok". The floor of the
    // upgrade window is therefore the literal 2; a truly-old shape must be < 2
    // (i.e. v1, the original destructive-reset version) to still reset. Pinned
    // to the literal 1 (was PREV - 1, which now equals 2 and would upgrade — the
    // Pitfall-2 rebase). A "reset" must NEVER silently load the saved draft (no
    // hydrate). We plant a DISTINCTIVE added strategy in the reset draft: if the
    // reset branch wrongly hydrated, that strategy's name would render in the
    // composition list. Its ABSENCE is the non-vacuous proof that
    // hydrateFromSaved was NOT called on the reset branch (Task 3 acceptance:
    // trichotomy preserved, reset does not hydrate).
    const olderRow: SavedScenarioRow = {
      id: SAVED_ID,
      name: "Ancient",
      draft: {
        ...okDraft(),
        schema_version: 1,
        addedStrategies: [
          {
            id: "reset-marker-strat",
            name: "RESET_MARKER_STRATEGY",
            markets: ["binance"],
            strategy_types: ["momentum"],
          },
        ],
      } as unknown as ScenarioDraft,
    };
    openRow(olderRow);

    // The relabeled 'older format' notice is shown.
    expect(
      screen.getByText(
        /This saved portfolio uses an older format and can't be reopened\./i,
      ),
    ).toBeInTheDocument();
    // NON-VACUOUS no-hydrate proof: the reset draft's distinctive added strategy
    // is NOT in the composer (a hydrate would have rendered it).
    expect(screen.queryByText(/RESET_MARKER_STRATEGY/i)).not.toBeInTheDocument();
    // NOT hydrated → loadedScenarioId stays null → still "Save portfolio", NOT
    // "Update portfolio" (an empty composer silently adopting the id would be a
    // dishonest default).
    expect(
      screen.getByRole("button", { name: /^Save portfolio$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Update portfolio/i }),
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
        /This portfolio was saved by a newer version and is read-only here\./i,
      ),
    ).toBeInTheDocument();
    // Hydrated read-only → loadedScenarioId IS set (the row is open), but edits
    // are blocked: the Update primary is not offered as an editable save (the
    // read-only notice is shown instead). "Save as new portfolio" remains so the
    // user can fork it into an editable copy.
    expect(
      screen.getByRole("button", { name: /Save as new portfolio/i }),
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
  it("T_SAVE9 a hard save failure (500) routes the canonical 'Couldn't save this portfolio' copy", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Save failed",
        message: "Couldn't save this portfolio. Check your connection and try again.",
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Doomed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't save this portfolio\./i),
      ).toBeInTheDocument();
    });
    // Failure → loadedScenarioId NOT adopted (still "Save portfolio").
    expect(
      screen.getByRole("button", { name: /^Save portfolio$/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE9b (CF-02) — an OVER-CAP save (400 with a memberKeyIds/too_big issue)
  //                    renders the HONEST ceiling copy naming MAX_MEMBER_KEY_IDS,
  //                    NOT the misleading connection message. Fails-without-fix:
  //                    the pre-change code showed the generic copy for all !res.ok.
  // -------------------------------------------------------------------------
  it("T_SAVE9b an over-cap save (400 memberKeyIds/too_big) shows the honest ceiling copy naming MAX_MEMBER_KEY_IDS, never 'Check your connection'", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Invalid request body",
        issues: [
          { code: "too_big", path: ["draft", "memberKeyIds"], maximum: MAX_MEMBER_KEY_IDS },
        ],
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Too many books" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      // Honest copy names the real ceiling (interpolated from the const) and
      // the correct remediation — disconnecting an exchange connection, since
      // memberKeyIds is gate-derived, not user-selected in the composer (IN-9).
      expect(
        screen.getByText(
          new RegExp(
            `more than ${String(MAX_MEMBER_KEY_IDS)} connected exchange keys`,
            "i",
          ),
        ),
      ).toBeInTheDocument();
    });
    // The misleading connection copy is NOT shown for this over-cap 400.
    expect(
      screen.queryByText(/Check your connection/i),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE9c (CF-02 scope) — a 400 whose issues do NOT touch memberKeyIds still
  //                    renders the generic copy (the helper only special-cases the
  //                    over-cap shape — no scope creep to other validation errors).
  // -------------------------------------------------------------------------
  it("T_SAVE9c a 400 whose issues do NOT touch memberKeyIds still shows the generic copy (no scope creep)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Invalid request body",
        issues: [{ code: "invalid_type", path: ["name"] }],
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Bad name shape" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't save this portfolio\./i),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/connected exchange keys/i),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE9d (IN-5) — a 400 whose res.json() THROWS (non-JSON body: proxy error
  //                    page, truncated stream) must fall back to the generic
  //                    copy via readSaveIssues' catch — never the ceiling copy,
  //                    and never an unhandled rejection that crashes the save.
  // -------------------------------------------------------------------------
  it("T_SAVE9d a 400 whose res.json() throws (SyntaxError) renders the generic copy, never the ceiling copy, and does not crash", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Non-JSON 400 body" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't save this portfolio\./i),
      ).toBeInTheDocument();
    });
    // The over-cap ceiling copy must NOT appear — we could not parse issues, so
    // the honest fallback is the generic copy, not a fabricated cap message.
    expect(
      screen.queryByText(/connected exchange keys/i),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SAVE10 — hard Update(PUT) failure → canonical error copy (the Update path
  //            is a distinct branch from the POST tested in T_SAVE9), and the
  //            open scenario is NOT silently dropped on failure.
  // -------------------------------------------------------------------------
  it("T_SAVE10 a hard Update(PUT) failure (500) routes the canonical error and keeps the scenario open", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Update failed",
        message:
          "Couldn't save this portfolio. Check your connection and try again.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Saved", draft: okDraft() });

    const updateBtn = await screen.findByRole("button", {
      name: /Update portfolio/i,
    });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't save this portfolio\./i),
      ).toBeInTheDocument();
    });
    // It was the PUT (Update) path, not a POST.
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe(`/api/allocator/scenario/saved/${SAVED_ID}`);
    expect((init as RequestInit).method).toBe("PUT");
    // The row stays open — a failed update must not silently drop back to the
    // unopened "Save portfolio" state (that would imply the update succeeded).
    expect(
      screen.getByRole("button", { name: /Update portfolio/i }),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// Phase 59 review CR-01 (PERSIST-01 write path) — the composer's APPLIED
// coverage window must be persisted inside the SAVED draft.
//
// Every pre-existing Phase-59 test exercised externally-crafted windowed
// fixtures and stopped at the route boundary; none drove "apply a window →
// Save → the POSTed draft carries it". These tests drive the REAL gesture →
// save path:
//   • a preset click (applyWindow write-through) → POST body draft.window
//     equals EXACTLY the applied window;
//   • a never-touched window (only the WINDOW-01 intersection auto-default
//     seeded) → the POSTed draft carries NO window key (the default is
//     re-derived on reopen, never force-persisted);
//   • Update (PUT) of a reopened v3-with-window row round-trips the saved
//     window verbatim.
//
// The adapter mock is pointed at a two-strategy unequal-span book (A:
// 2026-01-01…01-12, B: 2026-01-01…01-06) so windowBounds is non-null (the
// control mounts), the auto-default intersection is [01-01, 01-06], and the
// Full-range preset target is the DISTINCT union [01-01, 01-12] — proving the
// saved value is the applied window, not the default.
// ===========================================================================
describe("ScenarioComposer — review CR-01: the applied coverage window is persisted in the save payload", () => {
  const WIN_DATES = Array.from({ length: 12 }, (_, i) =>
    `2026-01-${String(i + 1).padStart(2, "0")}`,
  );

  function mkWinStrat(id: string, dates: string[]) {
    return {
      id,
      name: id,
      codename: null,
      disclosure_tier: "public",
      strategy_types: [],
      markets: [],
      start_date: dates[0],
      daily_returns: dates.map((date, i) => ({
        date,
        value: [0.01, -0.008, 0.012, -0.005, 0.006][i % 5],
      })),
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    };
  }

  /** ENGINE-01 (Phase 63) repoint: deliver the unequal-span two-strategy book as
   *  REAL book+gate per-key sources (unit id === api_key_id, series verbatim from
   *  mkWinStrat) so the coverage-window control mounts on the genuine series-space
   *  engine. The former holdings-snapshot mock injection is gone. */
  function unequalSpanBook(): Partial<MyAllocationDashboardPayload> {
    return {
      holdingsSummary: [
        { ...HOLDING_BTC, symbol: "BTC", api_key_id: "strat-window-A", value_usd: 50_000 },
        { ...HOLDING_BTC, symbol: "ETH", api_key_id: "strat-window-B", value_usd: 50_000 },
      ],
      perKeyReturnsByApiKeyId: {
        "strat-window-A": mkWinStrat("strat-window-A", WIN_DATES).daily_returns,
        "strat-window-B": mkWinStrat("strat-window-B", WIN_DATES.slice(0, 6))
          .daily_returns,
      },
      perKeyDailiesGateSatisfied: true,
      eligibleApiKeyIds: ["strat-window-A", "strat-window-B"],
    };
  }

  // WINDOW-06 flake lesson (72dc23a4): the 150ms draft-autosave debounce can
  // leak a pending write across tests sharing an allocator key — every test in
  // this describe renders with its OWN allocator id.
  function renderWindowedComposer(allocatorId: string) {
    return render(
      <ScenarioComposer
        payload={makePayload(unequalSpanBook())}
        allocatorId={allocatorId}
        allocatorMandate={null}
        onRegisterOpen={(open) => {
          registeredOpen = open;
        }}
      />,
    );
  }

  it("T_WIN_SAVE1 applying a window (Full-range preset) then Save → the POSTed draft carries EXACTLY the applied window", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Windowed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderWindowedComposer(`${ALLOCATOR_A}-cr01-post-window`);

    // Sanity: the control mounted and the auto-default seeded the intersection.
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");

    // REAL gesture: the Full-range preset applies the union [01-01, 01-12] — a
    // value the intersection default can never produce.
    fireEvent.click(
      screen.getByRole("button", { name: /Full range \(some drop out\)/i }),
    );
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-12");

    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Windowed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe("/api/allocator/scenario/saved");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    // THE CR-01 pin: the persisted draft carries the applied window verbatim.
    expect(body.draft.window).toEqual({
      start: "2026-01-01",
      end: "2026-01-12",
    });
  });

  it("T_WIN_SAVE2 a never-touched window saves a WINDOWLESS draft — the intersection auto-default is NOT force-persisted", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Untouched" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderWindowedComposer(`${ALLOCATOR_A}-cr01-post-windowless`);

    // The auto-default IS showing (the user sees the intersection) …
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");

    fireEvent.click(screen.getByRole("button", { name: /^Save portfolio$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Untouched" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [, init] = saveCalls(fetchMock)[0];
    const body = JSON.parse((init as RequestInit).body as string);
    // … but the DRAFT stays windowless: reopen re-derives the default, so a
    // windowless save never freezes today's intersection against future
    // coverage growth.
    expect("window" in body.draft).toBe(false);
  });

  it("T_WIN_SAVE3 Update (PUT) of a reopened v3-with-window row round-trips the saved window verbatim", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: SAVED_ID, name: "Saved windowed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderWindowedComposer(`${ALLOCATOR_A}-cr01-put-window`);
    const savedWindow = { start: "2026-01-02", end: "2026-01-05" };
    openRow({
      id: SAVED_ID,
      name: "Saved windowed",
      draft: { ...okDraft(), window: savedWindow },
    });

    // The reopened window is applied to the view …
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-02 → 2026-01-05");

    const updateBtn = await screen.findByRole("button", {
      name: /Update portfolio/i,
    });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe(`/api/allocator/scenario/saved/${SAVED_ID}`);
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    // … and the PUT body's draft still carries it (no silent window drop on
    // the update boundary).
    expect(body.draft.window).toEqual(savedWindow);
  });

  // ---------------------------------------------------------------------------
  // Re-review WR-01 — displayed window must never diverge from the window a
  // save would persist. Two reachable divergence states are pinned:
  //   • T_WIN_SAVE4: a DRIFTED (fingerprint-mismatched) reopen must NOT seed
  //     the owner's saved window — the working draft is the windowless default
  //     (the saved draft is not applied), so displaying/computing at the
  //     owner's window while "Update portfolio" PUTs the windowless default
  //     would save something other than what is shown.
  //   • T_WIN_SAVE5: adopting a cross-tab WINDOWLESS draft (tab B reset +
  //     edit) must invalidate this tab's stale local window seed — otherwise
  //     coverageWindow falls back to a window no save would persist.
  // ---------------------------------------------------------------------------

  it("T_WIN_SAVE4 (re-review WR-01) a DRIFTED reopen of a v3-with-window row does NOT display the owner's window — the working draft is the default, the display stays on the intersection default, and Update persists exactly what is shown (windowless)", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: SAVED_ID, name: "Drifted windowed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderWindowedComposer(`${ALLOCATOR_A}-wr01-drifted-window`);

    // Mount sanity: the auto-default seeded the intersection.
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-06");

    // Reopen a v3 row that carries a window ONLY the saved draft can produce
    // ([01-02, 01-05], strictly inside the intersection) but whose fingerprint
    // drifted — the hook's working draft falls back to the windowless default.
    openRow({
      id: SAVED_ID,
      name: "Drifted windowed",
      draft: {
        ...driftedDraft(),
        window: { start: "2026-01-02", end: "2026-01-05" },
      },
    });

    // The drift banner is up (the saved draft was NOT applied) …
    expect(
      document.getElementById("scenario-fingerprint-mismatch-banner"),
    ).toBeInTheDocument();
    // … so the owner's window must NOT be displayed/computed: the readout
    // stays on the working draft's intersection default. (Pre-fix, the seed
    // showed 01-02 → 01-05 while the draft was windowless — the divergence.)
    const readout = screen.getByTestId(
      "scenario-coverage-window-value",
    ).textContent;
    expect(readout).toContain("2026-01-01 → 2026-01-06");
    expect(readout).not.toContain("2026-01-02 → 2026-01-05");

    // "Update portfolio" (deliberately ungated on drift) persists EXACTLY what
    // is shown: the windowless default draft. The intersection default is
    // never force-persisted (T_WIN_SAVE2 contract) — reopen re-derives it.
    const updateBtn = await screen.findByRole("button", {
      name: /Update portfolio/i,
    });
    fireEvent.click(updateBtn);
    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe(`/api/allocator/scenario/saved/${SAVED_ID}`);
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect("window" in body.draft).toBe(false);
  });

  it("T_WIN_SAVE5 (re-review WR-01) adopting a cross-tab WINDOWLESS draft invalidates the stale local window seed — the display falls back to the intersection default, never a window no save would persist", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const allocatorId = `${ALLOCATOR_A}-wr01-crosstab-window`;
    renderWindowedComposer(allocatorId);

    // Apply the union window via the REAL preset gesture (seed + draft
    // write-through) — a value the intersection default can never produce.
    fireEvent.click(
      screen.getByRole("button", { name: /Full range \(some drop out\)/i }),
    );
    expect(
      screen.getByTestId("scenario-coverage-window-value").textContent,
    ).toContain("2026-01-01 → 2026-01-12");

    // Let the 150ms autosave debounce settle BEFORE dispatching the foreign
    // event: the primitive's flush-before-adopt would otherwise cement OUR
    // pending write and ignore the foreign value (that race is its own tested
    // contract; this test targets the adoption path).
    const key = scenarioStorageKey(allocatorId);
    await waitFor(() => {
      expect(lsStore.get(key) ?? "").toContain("2026-01-12");
    });

    // Tab B reset + edited: its autosave persisted a WINDOWLESS
    // fingerprint-current draft; the storage event syncs it into this tab.
    // (A bare reset's removeItem is a null-newValue clear the primitive
    // ignores — the divergence arises on the follow-up windowless write.)
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify(okDraft()),
        }),
      );
    });

    // The adopted draft carries NO window → the stale union seed must not
    // survive as the displayed window (a save here would persist windowless).
    // The invalidation hands the window back to the WINDOW-01 auto-default,
    // which re-seeds the intersection in the same commit — like a reset.
    await waitFor(() => {
      expect(
        screen.getByTestId("scenario-coverage-window-value").textContent,
      ).toContain("2026-01-01 → 2026-01-06");
    });
  });
});

// ===========================================================================
// LEV-02 (Phase 90.5 Plan 04, D3/D4/D5) — per-strategy leverage survives a
// Save/load round-trip on a saved scenario. Leverage is a what-if OVERLAY:
// stamped into the saved draft at POST/PUT (the setMemberKeyIds fold twin),
// rehydrated-REPLACE on every open (closing the latent session-bleed bug),
// sanitize-on-read clamped (D3, no schema refine), and NEVER a commit-diff
// input. These mirror the T_SAVE / T_WIN_SAVE round-trip harness.
//
// Read-only-tokens model (Phase 63): weight + leverage inputs live ONLY on
// ADDED-STRATEGY rows, and a row's leverage input is enabled purely by its
// toggle state (`toggleByScopeRef[a.id] !== false`), NOT by loaded returns —
// so a draft-hydrated added strategy yields an editable leverage input with no
// lazy-fetch dance. Every case opens a saved row carrying one added strategy.
// ===========================================================================
describe("ScenarioComposer — LEV-02: per-strategy leverage round-trips through Save/load", () => {
  const STRAT_LEV = "strat-lev-a";

  /** One added strategy so its leverage input (`leverage-${id}`) renders. */
  function stratLevRow() {
    return {
      id: STRAT_LEV,
      name: "Lev Strat",
      markets: ["binance"],
      strategy_types: ["momentum"],
    };
  }

  /** okDraft + one added strategy; `over` seeds leverageOverrides etc. The
   *  added-strategy `id` is a branded StrategyForBuilderId at compile time but a
   *  plain string at runtime (the codec re-parses row.draft), so the cast is the
   *  same `as unknown as` convention scenario-state's codec + T_SAVE6 use. */
  function okDraftWithStrat(over: Partial<ScenarioDraft> = {}): ScenarioDraft {
    return {
      ...okDraft(),
      addedStrategies: [stratLevRow()] as unknown as ScenarioDraft["addedStrategies"],
      ...over,
    };
  }

  function leverageInput(): HTMLInputElement {
    const el = document.getElementById(`leverage-${STRAT_LEV}`);
    expect(el).not.toBeNull();
    return el as HTMLInputElement;
  }

  /** The footer's diff-count chip (the FIRST span in the summary region) —
   *  the mandate diff count, distinct from the projection delta summary. */
  function diffCountLabel(): string {
    const region = screen.getByRole("region", {
      name: /Scenario draft summary and actions/i,
    });
    return region.querySelector("span")?.textContent ?? "";
  }

  it("T_LEV_SAVE1 (POST round-trip) a leverage edit stamps draft.leverageOverrides into the POSTed body (Save as new)", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Levered copy" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Base", draft: okDraftWithStrat() });

    // The added-strategy leverage input is enabled (toggle-derived) → set 2×.
    act(() => {
      fireEvent.change(leverageInput(), { target: { value: "2" } });
    });
    expect(leverageInput().value).toBe("2");

    fireEvent.click(
      await screen.findByRole("button", { name: /Save as new portfolio/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Levered copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe("/api/allocator/scenario/saved");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    // The POST fold (setLeverageOverrides(setMemberKeyIds(...))) stamped it.
    expect(body.draft.leverageOverrides).toEqual({ [STRAT_LEV]: 2 });
  });

  it("T_LEV_SAVE2 (PUT round-trip) a leverage edit stamps draft.leverageOverrides into the Update (PUT) body", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: SAVED_ID, name: "Base" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    openRow({ id: SAVED_ID, name: "Base", draft: okDraftWithStrat() });

    act(() => {
      fireEvent.change(leverageInput(), { target: { value: "2" } });
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /Update portfolio/i }),
    );
    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe(`/api/allocator/scenario/saved/${SAVED_ID}`);
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.draft.leverageOverrides).toEqual({ [STRAT_LEV]: 2 });
  });

  it("T_LEV_LOAD1 (rehydrate) opening a saved draft carrying leverageOverrides seeds the leverage input", () => {
    renderComposer();
    openRow({
      id: SAVED_ID,
      name: "Saved levered",
      draft: okDraftWithStrat({ leverageOverrides: { [STRAT_LEV]: 2.5 } }),
    });
    // Rehydrate-REPLACE seeded leverageByRef from the saved draft.
    expect(leverageInput().value).toBe("2.5");
  });

  it("T_LEV_LOAD2 (session-bleed fix) opening a saved draft with NO leverageOverrides RESETS a prior session's leverage — replace, not merge", () => {
    renderComposer();

    // First open + a live leverage edit sets session state {STRAT_LEV: 3}.
    openRow({ id: SAVED_ID, name: "First", draft: okDraftWithStrat() });
    act(() => {
      fireEvent.change(leverageInput(), { target: { value: "3" } });
    });
    expect(leverageInput().value).toBe("3");

    // Open a DIFFERENT saved scenario whose draft carries NO leverageOverrides.
    openRow({ id: NEW_ID, name: "Second", draft: okDraftWithStrat() });

    // The pre-existing bleed: leverageByRef was never reset on open, so it
    // retained {STRAT_LEV: 3}. Rehydrate-REPLACE clears it → default 1×.
    expect(leverageInput().value).toBe("1");
  });

  it("T_LEV_LOAD3 (clamp-on-read) an out-of-range persisted leverage rehydrates CLAMPED to MAX (999 → 10) — sanitizeLeverageMap, D3 sanitize-on-read", () => {
    renderComposer();
    openRow({
      id: SAVED_ID,
      name: "Tampered",
      draft: okDraftWithStrat({ leverageOverrides: { [STRAT_LEV]: 999 } }),
    });
    // Garbage jsonb clamps to the ceiling on read — never reaches the input raw.
    expect(leverageInput().value).toBe(String(MAX_LEVERAGE));
  });

  it("T_LEV_COMMIT1 (mandate untouched) changing leverage does NOT change the commit diff count — leverage is a what-if overlay, never a mandate input", () => {
    renderComposer();
    openRow({ id: SAVED_ID, name: "Base", draft: okDraftWithStrat() });

    // Non-vacuous baseline: the one added strategy is a real diff ("1 change").
    const before = diffCountLabel();
    expect(before).toMatch(/change/i);

    act(() => {
      fireEvent.change(leverageInput(), { target: { value: "4" } });
    });

    // Leverage never enters diffCount/handleCommit — the chip is unchanged.
    expect(diffCountLabel()).toBe(before);
  });

  // HIGH-1 (Phase 90.5 review) — handleReset MUST drop the leverage overlay.
  // leverageByRef was reset at the two scenario-OPEN seams but NOT in handleReset
  // (banner Reset / reset-modal confirm / commit-success). A stale multiplier
  // surviving a reset both (a) re-levers any matching leg in the fresh draft's
  // projection — projectionState.leverage[id] = leverageByRef[id] ?? 1, so an
  // empty map ⇒ every leg at 1× — AND (b) folds into a BRAND-NEW scenario at the
  // next Save, a leverage the user never set on it. The POST body is the
  // load-bearing observable: it reads the SAME leverageByRef map the projection
  // consumes, and it distinguishes the fix (the projection needs loaded series
  // the fixture omits, and the reset removes the added row regardless of the fix).
  it("T_LEV_RESET1 (HIGH-1) reset drops the leverage overlay → the fresh draft's next Save POSTs leverageOverrides {} (no bleed)", async () => {
    const fetchMock = makeFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({ id: NEW_ID, name: "Fresh book" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderComposer();
    // Open a saved scenario carrying a live 3× overlay on its added strategy.
    openRow({
      id: SAVED_ID,
      name: "Levered book",
      draft: okDraftWithStrat({ leverageOverrides: { [STRAT_LEV]: 3 } }),
    });
    // Precondition (non-vacuous): the overlay is genuinely live — the input reads 3×.
    expect(leverageInput().value).toBe("3");

    // Invoke the reset path: footer "Reset scenario draft" → confirm "Discard
    // draft" (both route through handleReset).
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Reset scenario draft/i }),
      );
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Discard draft/i }));
    });

    // A subsequent Save (no scenario open → "Save portfolio") POSTs an EMPTY
    // leverage map — the projection input is back to 1× on every leg AND the 3×
    // never bleeds into the brand-new scenario's persisted draft. Without the fix
    // leverageByRef retains {STRAT_LEV:3} and this POSTs {STRAT_LEV:3}.
    fireEvent.click(
      await screen.findByRole("button", { name: /Save portfolio/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/Name this portfolio/i), {
      target: { value: "Fresh book" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(saveCalls(fetchMock)).toHaveLength(1);
    });
    const [url, init] = saveCalls(fetchMock)[0];
    expect(url).toBe("/api/allocator/scenario/saved");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.draft.leverageOverrides).toEqual({});
  });
});
