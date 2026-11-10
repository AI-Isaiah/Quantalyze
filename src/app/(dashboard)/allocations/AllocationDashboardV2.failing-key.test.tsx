import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 186 plan 08 (D-03, D-05, D-07, SC-4). When the compose stopped counting
// a key, or holds the book at its last complete read, the Overview names the
// key (the owner's own label) and the day the total counts it through, in the
// founder-approved sentences. Muted, never a warning.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
vi.mock("./widgets/performance/EquityChart", () => ({
  default: () => <div data-testid="mock-equity-chart" />,
}));
vi.mock("@/app/factsheet/[id]/v2/factsheet-context", () => ({
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: () => <div data-testid="mock-factsheet-body" />,
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => null,
}));

const baseProps = {
  portfolio: {
    id: "p1",
    user_id: "u1",
    name: "Test Portfolio",
    description: null,
    created_at: "2023-01-01T00:00:00Z",
    is_test: false,
  },
  strategies: [],
  analytics: {
    total_aum: 100_000,
    return_ytd: 0.1,
    return_mtd: 0.01,
    portfolio_sharpe: 1.2,
    portfolio_max_drawdown: -0.05,
    portfolio_volatility: 0.15,
    avg_pairwise_correlation: 0.25,
    attribution_breakdown: null,
  } as never,
  apiKeys: [
    {
      id: "k1",
      exchange: "okx",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "OKX Key",
    },
  ] as never,
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1,
      mark_price_usd: 50_000,
      value_usd: 50_000,
      venue: "okx",
      holding_type: "spot",
      api_key_id: "k1",
      side: null,
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ] as never,
  flaggedHoldings: [],
  equityDailyPoints: [],
  activeVenues: [],
  snapshotCount: 0,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: "2026-05-28T11:00:00Z",
  hasSyncing: false,
} as unknown as MyAllocationDashboardPayload;

type Exit = NonNullable<MyAllocationDashboardPayload["failingKeyExits"]>[number];
const E = (
  label: string,
  reason: Exit["reason"] = "sync_failing",
  day: string | null = "2026-06-03",
): Exit => ({ apiKeyId: `id-${label}`, label, reason, day });

const TID = "dashboard-failing-key-note";

// Phase 199 plan 03 (CD-05): each clause ends with its one action, per clause kind.
const ACT_FAILING = "Reconnect the key on the Exchanges page.";
const ACT_INCOMPLETE =
  "Wait for the next sync, or reconnect the key on the Exchanges page if this persists.";
const ACT_UNDATED = "Reconnect the key on the Exchanges page or wait for the next sync.";

function renderWith(
  exits: Exit[] | undefined,
  state: "ready" | "rebuilding" = "ready",
) {
  return render(
    <AllocationDashboardV2
      {...baseProps}
      equityHistoryState={state}
      failingKeyExits={exits}
    />,
  );
}

describe("AllocationDashboardV2: the key the total stopped counting is named (186 SC-4)", () => {
  afterEach(() => cleanup());

  it("one sync-failing key: the approved sentence with the label and the formatted day", () => {
    renderWith([E("Main")]);
    const note = screen.getByTestId(TID);
    expect(note.textContent).toBe(
      "The total counts Main through Jun 3, 2026: its exchange key is failing to sync, so its capital is no longer counted after that day. " + ACT_FAILING,
    );
    expect(note.getAttribute("role")).toBe("status");
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("mb-3 px-1 text-sm text-text-secondary");
  });

  it("a read that came back incomplete: the total holds the last complete day", () => {
    renderWith([E("Main", "read_incomplete")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      "The total counts Main through Jun 3, 2026: the latest read of its exchange history came back incomplete, so the total holds its last complete day. " + ACT_INCOMPLETE,
    );
  });

  it("no day (the key never counted): the total leaves it out, for either reason", () => {
    renderWith([E("Main", "sync_failing", null)]);
    expect(screen.getByTestId(TID).textContent).toBe(
      "The total leaves out Main: its exchange key has not returned a complete history yet. " + ACT_UNDATED,
    );
    cleanup();
    renderWith([E("Main", "read_incomplete", null)]);
    expect(screen.getByTestId(TID).textContent).toBe(
      "The total leaves out Main: its exchange key has not returned a complete history yet. " + ACT_UNDATED,
    );
  });

  it("keys sharing a reason and a day are one clause and take 'their'", () => {
    renderWith([E("Main"), E("Alpha"), E("Zed")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      "The total counts Alpha, Main and Zed through Jun 3, 2026: their exchange key is failing to sync, so their capital is no longer counted after that day. " + ACT_FAILING,
    );
  });

  it("keys that differ in day or reason get their own sentence, each tied to its own day", () => {
    renderWith([
      E("Main", "sync_failing", "2026-06-03"),
      E("Alpha", "sync_failing", "2026-06-01"),
      E("Zed", "read_incomplete", "2026-06-03"),
      E("Beta", "sync_failing", null),
      E("Gamma", "read_incomplete", null),
    ]);
    expect(screen.getByTestId(TID).textContent).toBe(
      [
        "The total counts Alpha through Jun 1, 2026: its exchange key is failing to sync, so its capital is no longer counted after that day. " + ACT_FAILING,
        "The total counts Main through Jun 3, 2026: its exchange key is failing to sync, so its capital is no longer counted after that day. " + ACT_FAILING,
        "The total counts Zed through Jun 3, 2026: the latest read of its exchange history came back incomplete, so the total holds its last complete day. " + ACT_INCOMPLETE,
        "The total leaves out Beta and Gamma: their exchange key has not returned a complete history yet. " + ACT_UNDATED,
      ].join(" "),
    );
  });

  it("each clause kind carries its own registry id, and each clause its own action link", () => {
    renderWith([
      E("Main", "sync_failing", "2026-06-03"),
      E("Zed", "read_incomplete", "2026-06-03"),
      E("Beta", "sync_failing", null),
    ]);
    const note = screen.getByTestId(TID);
    const ids = Array.from(note.querySelectorAll("[data-degrade-id]")).map((n) =>
      n.getAttribute("data-degrade-id"),
    );
    expect(ids).toEqual([
      "allocation.failing-key-sync-failing",
      "allocation.failing-key-read-incomplete",
      "allocation.failing-key-undated",
    ]);
    // One reconnect link per clause: the action is a link, not just words.
    expect(note.querySelectorAll('a[href="/profile?tab=exchanges"]')).toHaveLength(3);
  });

  // Founder rule (CD-05): a revoked key affects only itself. With two keys on the
  // book and only K1 failing, the note names K1 and never K2, and says nothing
  // about "your keys" or "your book".
  it("dead key: with two keys and one failing, the note names only the failing key", () => {
    const keyRow = (id: string, label: string) => ({
      id,
      exchange: "okx",
      label,
      is_active: true,
      sync_status: "error",
      last_sync_at: null,
      sync_error: null,
      disconnected_at: null,
    });
    render(
      <AllocationDashboardV2
        {...baseProps}
        apiKeys={[keyRow("id-K1", "K1"), keyRow("id-K2", "K2")] as never}
        equityHistoryState="ready"
        failingKeyExits={[E("K1")]}
      />,
    );
    const text = screen.getByTestId(TID).textContent ?? "";
    expect(text).toContain("K1");
    expect(text).not.toContain("K2");
    expect(text).not.toMatch(/your keys|your book/i);
  });

  it("renders nothing while the book is rebuilding, whatever the list holds", () => {
    renderWith([E("Main")], "rebuilding");
    expect(screen.queryByTestId(TID)).toBeNull();
  });

  // Phase 198 plan 09 (D-01, one fact one sentence). The missing-data message
  // names a key for its range, so the exit note must not name it again; an exit
  // the message does not name keeps its sentence. Without the filter the same
  // key would be named twice, in two phrasings, one line apart.
  describe("a key the missing-data message names is not named again by the exit note", () => {
    const keyRow = (id: string, label: string) => ({
      id,
      exchange: "okx",
      label,
      is_active: true,
      sync_status: "error",
      last_sync_at: null,
      sync_error: null,
      disconnected_at: null,
    });
    const gapFor = (id: string) => ({
      apiKeyIds: [id],
      cause: "sync_failing" as const,
      firstMissingDay: "2026-06-04",
      ranges: [{ from: "2026-06-04", to: "2026-06-10" }],
    });
    const GAP_LINE =
      "OKX — Main: no data for Jun 4, 2026 – Jun 10, 2026. Reconnect the key on the Exchanges page or wait for the next sync.";

    function renderGaps(exits: Exit[], gaps: ReturnType<typeof gapFor>[] | undefined) {
      return render(
        <AllocationDashboardV2
          {...baseProps}
          apiKeys={[keyRow("id-Main", "Main"), keyRow("id-Zed", "Zed")] as never}
          equityHistoryState="ready"
          failingKeyExits={exits}
          keyDataGaps={gaps}
        />,
      );
    }

    it("K1 named by a gap: the message names K1 and the exit note does not render", () => {
      renderGaps([E("Main")], [gapFor("id-Main")]);
      expect(screen.getByTestId("overview-missing-data").textContent).toContain(GAP_LINE);
      expect(screen.queryByTestId(TID)).toBeNull();
    });

    it("a second exit with no gap entry: the exit note renders and names that key only", () => {
      renderGaps([E("Main"), E("Zed")], [gapFor("id-Main")]);
      expect(screen.getByTestId("overview-missing-data").textContent).toContain(GAP_LINE);
      const note = screen.getByTestId(TID);
      expect(note.textContent).toBe(
        "The total counts Zed through Jun 3, 2026: its exchange key is failing to sync, so its capital is no longer counted after that day. " + ACT_FAILING,
      );
      expect(note.textContent).not.toContain("Main");
    });

    it("a gap whose key the owner's list does not label names nothing, so the exit note keeps that key", () => {
      renderGaps([E("Ghost")], [gapFor("id-Ghost")]);
      expect(screen.queryByTestId("overview-missing-data")).toBeNull();
      expect(screen.getByTestId(TID).textContent).toContain("Ghost");
    });

    it("no gaps at all (a legacy payload): the exit note renders exactly as it did", () => {
      renderGaps([E("Main")], undefined);
      expect(screen.queryByTestId("overview-missing-data")).toBeNull();
      expect(screen.getByTestId(TID).textContent).toBe(
        "The total counts Main through Jun 3, 2026: its exchange key is failing to sync, so its capital is no longer counted after that day. " + ACT_FAILING,
      );
    });
  });

  it("renders nothing when the list is empty or absent", () => {
    renderWith([]);
    expect(screen.queryByTestId(TID)).toBeNull();
    cleanup();
    renderWith(undefined);
    expect(screen.queryByTestId(TID)).toBeNull();
  });
});
