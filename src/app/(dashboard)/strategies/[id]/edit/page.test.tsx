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

const { getUserMock, strategyDataMock } = vi.hoisted(() => ({
  getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
  strategyDataMock: vi.fn<() => Promise<{ data: unknown }>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => strategyDataMock(),
          }),
        }),
      }),
    }),
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
  ApiKeyManager: () =>
    React.createElement("div", { "data-testid": "api-key-manager" }),
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
