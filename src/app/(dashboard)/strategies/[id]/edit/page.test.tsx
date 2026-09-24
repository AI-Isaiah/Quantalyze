/**
 * Regression test for UAT 2026-05-17 — "UC244 FXDaily (CSV-provided)
 * strategy shows Exchange API Keys panel".
 *
 * Pre-fix, the edit page rendered `<ApiKeyManager>` AND `<CsvUpload>`
 * unconditionally. A CSV-uploaded strategy (source = 'csv') therefore
 * saw an Exchange API Keys side panel with an "Add Key" button — the
 * manager had never connected an exchange. Confusing for managers,
 * and an invitation to mis-connect a key to a CSV strategy.
 *
 * Post-fix, the page branches on `strategy.source`:
 *   - source === 'csv' → render <CsvUpload>; hide <ApiKeyManager> + <KeyPermissionBadge>
 *   - anything else    → render <ApiKeyManager> + <KeyPermissionBadge>; hide <CsvUpload>
 *
 * A regression that drops the source branch (or flips the conditional)
 * would surface ApiKeyManager on a CSV strategy and fail
 * the "CSV strategy does NOT show ApiKeyManager" assertion below.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
// 167.2-REVIEW-SFH H-2: an unreadable shape is captured, not only logged.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

const { getUserMock, strategyDataMock, memberCountMock, memberCountReadMock, apiKeyManagerPropsMock } =
  vi.hoisted(() => ({
    getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
    strategyDataMock: vi.fn<() => Promise<{ data: unknown }>>(),
    // Phase 167.2 / KCS-23: the `strategy_keys` head-count answer the page's
    // `countCompositeMembers` read receives. Default (set in beforeEach) is
    // zero members, a single-key strategy.
    memberCountMock: vi.fn<() => { count: number | null; error: { message: string } | null }>(),
    // Records every `strategy_keys` read with the strategy id it was scoped to.
    memberCountReadMock: vi.fn<(strategyId: unknown) => void>(),
    // The props the page handed to <ApiKeyManager>, one call per render.
    apiKeyManagerPropsMock: vi.fn<(props: Record<string, unknown>) => void>(),
  }));

// Extended DELIBERATELY for KCS-23 (dispatch on the table name): `strategies`
// keeps its original chain, `strategy_keys` answers the queued head count, and
// any other table throws so a read the page was never meant to make fails loud.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "strategies") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => strategyDataMock(),
              }),
            }),
          }),
        };
      }
      if (table === "strategy_keys") {
        // 167.2-REVIEW CR-02 (lineage): this double used to REFUSE anything but
        // a head count ("must be head-counted, never read"). The composite
        // card now lists only its members, so the page reads the member KEY
        // IDS (one column, RLS `strategy_keys_owner`) and derives the count
        // from them. `memberCountMock` still names the count; the double turns
        // it into that many synthetic member ids. Any other projection throws.
        return {
          select: (cols: string) => {
            if (cols !== "api_key_id") {
              throw new Error(`strategy_keys must be read as api_key_id only, got: ${cols}`);
            }
            return {
              eq: (_col: string, strategyId: unknown) => {
                memberCountReadMock(strategyId);
                const { count, error } = memberCountMock();
                return Promise.resolve(
                  error
                    ? { data: null, error }
                    : {
                        data:
                          count === null
                            ? null
                            : Array.from({ length: count }, (_, i) => ({
                                api_key_id: `key-member-${i + 1}`,
                              })),
                        error: null,
                      },
                );
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

// Stub all sub-components with data-testid-bearing divs so we can assert
// which were rendered without dragging in their full implementations.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", { "data-testid": "page-header" }, title),
}));
vi.mock("@/components/layout/Breadcrumb", () => ({
  Breadcrumb: () => React.createElement("nav", { "data-testid": "breadcrumb" }),
}));
vi.mock("@/components/strategy/StrategyForm", () => ({
  StrategyForm: () =>
    React.createElement("form", { "data-testid": "strategy-form" }),
}));
vi.mock("@/components/strategy/ApiKeyManager", () => ({
  ApiKeyManager: (props: Record<string, unknown>) => {
    apiKeyManagerPropsMock(props);
    return React.createElement("div", { "data-testid": "api-key-manager" });
  },
}));
// Issue #12 (v0.24.5.22): the legacy `CsvUpload` component was deleted —
// it mislabeled `daily_return` as "PnL" and wrote synthetic trade rows
// with enum values (`exchange='csv_import'`, `order_type='daily_pnl'`)
// that don't exist in the trades schema, causing a PostgREST
// schema-cache error on every upload attempt. CSV-source strategies now
// render an informational `<CsvStrategyEditNote>` instead. The page's
// source-branch contract (CSV → no `<ApiKeyManager>` / no
// `<KeyPermissionBadge>`) is unchanged.
vi.mock("@/components/strategy/CsvStrategyEditNote", () => ({
  CsvStrategyEditNote: () =>
    React.createElement("div", { "data-testid": "csv-edit-note" }),
}));
vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () =>
    React.createElement("div", { "data-testid": "key-permission-badge" }),
}));

import EditStrategyPage from "./page";

const STRATEGY_ID = "13f7b07f-1234-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({
    data: { user: { id: "u-owner-1" } },
  });
  memberCountMock.mockReturnValue({ count: 0, error: null });
});

async function renderEditPage() {
  // Server component: render returns a Promise<JSX>, render it as a child
  // by awaiting the function and then handing the returned JSX to RTL.
  const page = await EditStrategyPage({
    params: Promise.resolve({ id: STRATEGY_ID }),
  });
  return render(page as React.ReactElement);
}

describe("EditStrategyPage source-conditional panels (UAT 2026-05-17)", () => {
  it("CSV-sourced strategy renders <CsvStrategyEditNote> and HIDES <ApiKeyManager> + <KeyPermissionBadge>", async () => {
    strategyDataMock.mockResolvedValue({
      data: {
        id: STRATEGY_ID,
        name: "UC244 FXDaily (UAT)",
        source: "csv",
        api_key_id: null,
        supported_exchanges: [],
      },
    });
    await renderEditPage();

    expect(screen.getByTestId("csv-edit-note")).toBeInTheDocument();
    expect(screen.queryByTestId("api-key-manager")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("key-permission-badge"),
    ).not.toBeInTheDocument();
  });

  it.each([
    "legacy",
    "wizard",
    "admin_import",
    "allocator_connected",
    "okx",
    "binance",
    "bybit",
  ])(
    "non-CSV source '%s' renders <ApiKeyManager> and HIDES <CsvUpload>",
    async (source) => {
      strategyDataMock.mockResolvedValue({
        data: {
          id: STRATEGY_ID,
          name: "Alpha Centauri",
          source,
          api_key_id: null,
          supported_exchanges: ["OKX"],
        },
      });
      await renderEditPage();

      expect(screen.getByTestId("api-key-manager")).toBeInTheDocument();
      expect(screen.queryByTestId("csv-edit-note")).not.toBeInTheDocument();
    },
  );

  it("non-CSV source with an api_key_id ALSO renders <KeyPermissionBadge>", async () => {
    strategyDataMock.mockResolvedValue({
      data: {
        id: STRATEGY_ID,
        name: "Alpha Centauri",
        source: "okx",
        api_key_id: "key-abc-1",
        supported_exchanges: ["OKX"],
      },
    });
    await renderEditPage();

    expect(screen.getByTestId("api-key-manager")).toBeInTheDocument();
    expect(screen.getByTestId("key-permission-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("csv-edit-note")).not.toBeInTheDocument();
  });

  it("CSV-sourced strategy with a lingering api_key_id STILL hides ApiKeyManager + KeyPermissionBadge", async () => {
    // Defensive: if a strategy was migrated from API → CSV and the old
    // api_key_id wasn't cleared, we still want the CSV-only UI.
    strategyDataMock.mockResolvedValue({
      data: {
        id: STRATEGY_ID,
        name: "UC244 FXDaily (UAT)",
        source: "csv",
        api_key_id: "stale-key-id",
        supported_exchanges: [],
      },
    });
    await renderEditPage();

    expect(screen.getByTestId("csv-edit-note")).toBeInTheDocument();
    expect(screen.queryByTestId("api-key-manager")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("key-permission-badge"),
    ).not.toBeInTheDocument();
  });
});

/**
 * Phase 167.2 / KCS-23: the page tells the key card whether the strategy is a
 * composite. On a composite the card offers no control that rewrites
 * `strategies.api_key_id` (that write would silently make it a single-key
 * strategy); when the member count cannot be read the card gets "unknown" and
 * fails closed on those controls, while the PAGE still renders, because the
 * card's `Update password` and `Delete` are the remedy the /strategies
 * "Sign-in failed" pill sends the owner here for.
 */
describe("EditStrategyPage composite shape (KCS-23)", () => {
  const apiStrategy = {
    id: STRATEGY_ID,
    name: "Synthetic Composite",
    source: "wizard",
    api_key_id: null,
    supported_exchanges: ["OKX"],
  };

  function lastKeyShape() {
    const calls = apiKeyManagerPropsMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0].keyShape;
  }

  it("COMPOSITE-PROP: two strategy_keys members pass keyShape \"composite\" to the key card", async () => {
    strategyDataMock.mockResolvedValue({ data: apiStrategy });
    memberCountMock.mockReturnValue({ count: 2, error: null });
    await renderEditPage();

    expect(memberCountReadMock).toHaveBeenCalledWith(STRATEGY_ID);
    expect(screen.getByTestId("api-key-manager")).toBeInTheDocument();
    expect(lastKeyShape()).toBe("composite");
    // 167.2-REVIEW CR-02: the card is told WHICH keys are members, so it can
    // list only those beneath KCS23-COMPOSITE.
    expect(apiKeyManagerPropsMock.mock.calls.at(-1)![0].compositeMemberKeyIds).toEqual([
      "key-member-1",
      "key-member-2",
    ]);
  });

  it("SINGLE-PROP: zero strategy_keys members pass keyShape \"single\"", async () => {
    strategyDataMock.mockResolvedValue({
      data: { ...apiStrategy, api_key_id: "key-synthetic-1" },
    });
    memberCountMock.mockReturnValue({ count: 0, error: null });
    await renderEditPage();

    expect(memberCountReadMock).toHaveBeenCalledWith(STRATEGY_ID);
    expect(lastKeyShape()).toBe("single");
  });

  it("COUNT-FAILS: an unreadable member count renders the page with keyShape \"unknown\" and logs the strategy id server-side", async () => {
    strategyDataMock.mockResolvedValue({ data: apiStrategy });
    memberCountMock.mockReturnValue({
      count: null,
      error: { message: "synthetic permission denied" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderEditPage();

      expect(screen.getByTestId("api-key-manager")).toBeInTheDocument();
      expect(lastKeyShape()).toBe("unknown");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("composite member count failed"),
        expect.objectContaining({
          id: STRATEGY_ID,
          message: expect.stringContaining("synthetic permission denied"),
        }),
      );
      // 167.2-REVIEW-SFH H-2: captured like the owner factsheet's identical
      // read (`stage: "strategy-shape"`), not only logged.
      expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
        tags: { route: "strategies/edit/page", stage: "strategy-shape" },
      });
      // The error text reaches the server log only, never the card's props.
      const props = apiKeyManagerPropsMock.mock.calls.at(-1)![0];
      expect(JSON.stringify(props)).not.toContain("synthetic permission denied");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("CSV-NO-COUNT: a CSV strategy performs no strategy_keys read", async () => {
    strategyDataMock.mockResolvedValue({
      data: {
        id: STRATEGY_ID,
        name: "Synthetic CSV",
        source: "csv",
        api_key_id: null,
        supported_exchanges: [],
      },
    });
    await renderEditPage();

    expect(screen.getByTestId("csv-edit-note")).toBeInTheDocument();
    expect(memberCountReadMock).not.toHaveBeenCalled();
    expect(apiKeyManagerPropsMock).not.toHaveBeenCalled();
  });
});
