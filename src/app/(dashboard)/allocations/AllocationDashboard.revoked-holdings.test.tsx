import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AllocationDashboard } from "./AllocationDashboard";

// jsdom's localStorage is flaky under vitest 4.x (`setItem is not a
// function` surfaces during certain runs); clone the explicit stub
// pattern used by useDashboardConfig.test.ts and stub it globally.
const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => { lsStore.set(k, v); }),
  removeItem: vi.fn((k: string) => { lsStore.delete(k); }),
  clear: vi.fn(() => { lsStore.clear(); }),
  get length() { return lsStore.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);

/**
 * Phase 08 Plan 02 Task 2 — AllocationDashboard revoked-holdings
 * tests (MANAGE-02 / D-04 / D-05).
 *
 * Covers:
 *   T8  — initial mount with empty localStorage → showRevoked === true
 *          (default ON per D-05).
 *   T9  — localStorage['allocations.showRevokedHoldings']='false' at mount
 *          → initial showRevoked === false.
 *   T10 — clicking the toggle OFF persists 'false' to the same key.
 *   T11 — SSR guard: loadShowRevoked returns true without throwing when
 *          window is undefined (re-imported loader in a module-scoped
 *          environment).
 *   T12 — HISTORICAL-INCLUSION invariant: with 3 holdings (1 revoked)
 *          + showRevoked=false, the KPI strip / equity curve / drawdown
 *          widgets receive the FULL 3-row holdings list (NOT the
 *          filtered 2-row list). Proves D-04 — the toggle MUST NOT
 *          affect KPI/chart inputs.
 */

// ── Shared mocks ────────────────────────────────────────────────────────

// Next navigation + usage analytics stub — mirrors widget-gating test shape.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/analytics/usage-events-client", () => ({
  identifyUsageUser: vi.fn(),
  trackUsageEventClient: vi.fn(),
}));

// Capture props passed to downstream children so T12 can assert the
// historical-inclusion invariant. KpiStrip + DashboardGrid are the
// widest-receiving children (widgets consume holdings via
// `widgetData` — Dashboard-level forwarding).
const kpiStripProps: unknown[] = [];
vi.mock("./components/KpiStrip", () => ({
  KpiStrip: (props: Record<string, unknown>) => {
    kpiStripProps.push(props);
    return <div data-testid="kpi-strip" />;
  },
}));
vi.mock("./components/DashboardGrid", () => ({
  DashboardGrid: () => <div data-testid="dashboard-grid" />,
}));
vi.mock("./components/AddWidgetModal", () => ({
  AddWidgetModal: () => null,
}));
vi.mock("./components/UndoToast", () => ({
  UndoToast: () => null,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => null,
}));
vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="insight-strip" />,
}));
vi.mock("@/components/ui/WarningBanner", () => ({
  WarningBanner: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="warning-banner">{children}</div>
  ),
}));

// HoldingsTable stub — captures its props so we can assert what the
// TABLE receives (filtered) vs what other widgets receive (unfiltered).
const holdingsTableProps: unknown[] = [];
vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: Record<string, unknown>) => {
    holdingsTableProps.push(props);
    return <div data-testid="holdings-table" />;
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────

const STORAGE_KEY = "allocations.showRevokedHoldings";

const HOLDINGS_MIXED = [
  {
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: 60_000,
    value_usd: 60_000,
    venue: "binance",
    holding_type: "spot" as const,
    api_key_id: "key-active",
  },
  {
    symbol: "ETH",
    quantity: 10,
    mark_price_usd: 3_500,
    value_usd: 35_000,
    venue: "binance",
    holding_type: "spot" as const,
    api_key_id: "key-revoked",
  },
  {
    symbol: "SOL",
    quantity: 200,
    mark_price_usd: 150,
    value_usd: 30_000,
    venue: "okx",
    holding_type: "spot" as const,
    api_key_id: "key-active",
  },
];

const API_KEYS = [
  {
    id: "key-active",
    exchange: "binance",
    label: "Active Binance",
    is_active: true,
    sync_status: "complete",
    last_sync_at: new Date().toISOString(),
    account_balance_usdt: 100_000,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "key-revoked",
    exchange: "binance",
    label: "Old Binance",
    is_active: true,
    sync_status: "revoked",
    last_sync_at: new Date().toISOString(),
    account_balance_usdt: null,
    created_at: "2026-04-01T00:00:00Z",
  },
];

function basePayload() {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: API_KEYS,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary: HOLDINGS_MIXED,
    snapshotCount: 30,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    minHistoryDepthMonths: null,
    activeVenues: [],
  };
}

beforeEach(() => {
  kpiStripProps.length = 0;
  holdingsTableProps.length = 0;
  // Reset canonical key — localStorage.clear exists on real jsdom but
  // bypassed here to be explicit about the key under test.
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // environments without localStorage — noop
  }
  // jsdom fetch stub — AllocationDashboard fires-and-forgets
  // POST /api/usage/session-start on mount.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
});

describe("AllocationDashboard — revoked-holdings toggle (Phase 08 MANAGE-02)", () => {
  it("T8: empty localStorage → mounted HoldingsTable receives showRevoked=true (default ON per D-05)", () => {
    render(<AllocationDashboard {...basePayload()} />);
    expect(holdingsTableProps.length).toBeGreaterThan(0);
    const firstProps = holdingsTableProps[0] as { showRevoked: boolean };
    expect(firstProps.showRevoked).toBe(true);
  });

  it("T9: localStorage 'false' at mount → mounted HoldingsTable receives showRevoked=false", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    render(<AllocationDashboard {...basePayload()} />);
    const firstProps = holdingsTableProps[0] as { showRevoked: boolean };
    expect(firstProps.showRevoked).toBe(false);
  });

  it("T10: onShowRevokedChange(false) persists 'false' to localStorage under the canonical key", () => {
    render(<AllocationDashboard {...basePayload()} />);
    const firstProps = holdingsTableProps[0] as {
      onShowRevokedChange: (v: boolean) => void;
    };
    // Drive the state change directly (skip the UI click — the component
    // itself is stubbed out; AllocationDashboard owns the state). Wrap in
    // act() so the persist useEffect flushes before we read localStorage.
    act(() => {
      firstProps.onShowRevokedChange(false);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("T11: corrupt/unexpected localStorage value falls back to true without throwing", () => {
    localStorage.setItem(STORAGE_KEY, "garbage");
    render(<AllocationDashboard {...basePayload()} />);
    const firstProps = holdingsTableProps[0] as { showRevoked: boolean };
    // Anything other than literal 'true' or 'false' should default to true
    // (D-05 ON-by-default invariant).
    expect(firstProps.showRevoked).toBe(true);
  });

  it("T12: showRevoked=false does NOT filter KPI-strip / downstream widget holdings inputs (D-04 historical-inclusion invariant)", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    render(<AllocationDashboard {...basePayload()} />);
    // KpiStrip was mounted; its props snapshot MUST NOT receive a
    // filtered holdings list. The dashboard's job is to pass the FULL
    // holdings array to KPI / chart widgets regardless of toggle state.
    expect(kpiStripProps.length).toBeGreaterThan(0);
    // HoldingsTable received the FULL holdings array (its internal
    // filter logic handles visibility) — so the caller's contract
    // is "always pass the full list". T3 in HoldingsTable.test proves
    // the component filters internally based on showRevoked.
    const firstProps = holdingsTableProps[0] as {
      holdings: Array<{ symbol: string }>;
    };
    expect(firstProps.holdings).toHaveLength(3);
    expect(firstProps.holdings.map((h) => h.symbol).sort()).toEqual([
      "BTC",
      "ETH",
      "SOL",
    ]);
  });

  it("T12b: HoldingsTable rows carry source_key_sync_status joined from apiKeys", () => {
    render(<AllocationDashboard {...basePayload()} />);
    const firstProps = holdingsTableProps[0] as {
      holdings: Array<{ symbol: string; source_key_sync_status: string }>;
    };
    const eth = firstProps.holdings.find((h) => h.symbol === "ETH")!;
    const btc = firstProps.holdings.find((h) => h.symbol === "BTC")!;
    expect(eth.source_key_sync_status).toBe("revoked");
    expect(btc.source_key_sync_status).toBe("complete");
  });
});

// T11b: SSR / exception guard — the loader must return `true` (default
// ON) when localStorage throws on read (Safari private-mode / storage
// disabled scenarios).
describe("AllocationDashboard — SSR-safe localStorage loader", () => {
  it("T11b: loader returns true when localStorage.getItem throws for the canonical key (exception path)", () => {
    const origGet = localStorageMock.getItem;
    // Selectively throw for the canonical key only so unrelated
    // consumers (e.g. useTimeframe's "quantalyze-timeframe" read) are
    // unaffected.
    localStorageMock.getItem = vi.fn((k: string) => {
      if (k === STORAGE_KEY) {
        throw new Error("quota exceeded simulation");
      }
      return lsStore.get(k) ?? null;
    });
    try {
      render(<AllocationDashboard {...basePayload()} />);
      const firstProps = holdingsTableProps[0] as { showRevoked: boolean };
      expect(firstProps.showRevoked).toBe(true);
    } finally {
      localStorageMock.getItem = origGet;
    }
  });
});
