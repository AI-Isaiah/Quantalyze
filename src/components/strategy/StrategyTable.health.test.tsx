/**
 * Phase 199 plan 12 (D-03, SC-3, CD-04) - the Health column of the merged list.
 *
 * The server decides each row's Health (`strategyHealthOf`, the page passes the
 * result through `managerRows[id].health`); the table only RENDERS it. These
 * cases pin what a reader is hurt by if it drifts:
 *   1. PLACEMENT. Health is a plain header directly after Status and before
 *      Created, not sortable, and every cell lines up under it.
 *   2. THE WORD AND ITS TONE. The cell prints the word `healthWord` yields in
 *      the tone `HEALTH_TONE` names, so a stale row is amber and a healthy row
 *      is not.
 *   3. NO WRAP. `Stale (no data since Oct 31, 2026)` stays on one line (the
 *      table scrolls instead).
 *   4. HONEST ABSENCE. A placeholder row, and a row the page passed no health
 *      for, print the em dash; they never invent a word.
 *   5. COLUMN COUNT. td count equals th count in every row kind.
 *
 * The expected words and tones are READ from `healthWord` / `HEALTH_TONE`, never
 * typed, so a copy recase follows without an edit here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import {
  healthWord,
  HEALTH_TONE,
  type StrategyHealth,
} from "@/lib/strategy-health";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & { analytics: StrategyAnalytics };
type ManagerRows = Record<
  string,
  {
    editHref?: string;
    actions?: ReactNode;
    note?: ReactNode;
    health?: { word: string; tone: string };
  }
>;

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => <span data-testid="simulate-probe" />,
}));

function makeAnalytics(strategyId: string): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: strategyId,
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    trades_fetched_at: null,
  };
}

function makeStrategy(id: string, name: string): Row {
  return {
    id,
    name,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    analytics: makeAnalytics(id),
  };
}

const ID_STALE = "66666666-0000-4000-8000-000000000001";
const ID_HEALTHY = "66666666-0000-4000-8000-000000000002";
const ID_NONE = "66666666-0000-4000-8000-000000000003";

const STALE: StrategyHealth = { kind: "stale", staleSince: "2026-10-31" };
const HEALTHY: StrategyHealth = { kind: "healthy", staleSince: null };

function cellOf(h: StrategyHealth): { word: string; tone: string } {
  return { word: healthWord(h), tone: HEALTH_TONE[h.kind] };
}

const ROWS: Row[] = [
  makeStrategy(ID_STALE, "Health Stale"),
  makeStrategy(ID_HEALTHY, "Health Healthy"),
  makeStrategy(ID_NONE, "Health Absent"),
];

const MANAGER_ROWS: ManagerRows = {
  [ID_STALE]: { editHref: `/strategies/${ID_STALE}/edit`, health: cellOf(STALE) },
  [ID_HEALTHY]: { editHref: `/strategies/${ID_HEALTHY}/edit`, health: cellOf(HEALTHY) },
  // No `health`: the page passed none for this row.
  [ID_NONE]: { editHref: `/strategies/${ID_NONE}/edit` },
};

function renderList(extra: Record<string, unknown> = {}) {
  return render(
    <StrategyTable
      strategies={ROWS}
      categorySlug="health-spec"
      visibility="owner-all-statuses"
      managerRows={MANAGER_ROWS}
      {...extra}
    />,
  );
}

function headers(): HTMLElement[] {
  return screen.getAllByRole("columnheader");
}

function dataRow(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) throw new Error(`no row for "${name}"`);
  return row;
}

function cells(row: HTMLElement): HTMLTableCellElement[] {
  return Array.from(row.querySelectorAll<HTMLTableCellElement>(":scope > td"));
}

function colSpanTotal(row: HTMLElement): number {
  return cells(row).reduce((n, td) => n + (td.colSpan || 1), 0);
}

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

describe("StrategyTable Health column (199-12, D-03)", () => {
  it("the Health header sits directly after Status and before Created, and is not sortable", () => {
    renderList();
    const labels = headers().map((h) => (h.textContent ?? "").trim());
    const status = labels.indexOf("Status");
    expect(status).toBeGreaterThan(-1);
    expect(labels[status + 1]).toBe("Health");
    expect(labels[status + 2]).toBe("Created");

    const health = headers()[status + 1];
    expect(health.querySelector("button")).toBeNull();
    expect(health.getAttribute("aria-sort")).toBeNull();
  });

  it("each row's cell prints the server's word in the server's tone, under the Health header", () => {
    renderList();
    const labels = headers().map((h) => (h.textContent ?? "").trim());
    const col = labels.indexOf("Health");

    const stale = cells(dataRow("Health Stale"))[col];
    expect(stale.textContent?.trim()).toBe(healthWord(STALE));
    const staleSpan = stale.querySelector("span") as HTMLElement;
    expect(staleSpan.className).toContain(HEALTH_TONE.stale);
    expect(staleSpan.className).toContain("whitespace-nowrap");

    const healthy = cells(dataRow("Health Healthy"))[col];
    expect(healthy.textContent?.trim()).toBe("Healthy");
    expect((healthy.querySelector("span") as HTMLElement).className).toContain(
      HEALTH_TONE.healthy,
    );
    // The stale word is amber and the healthy word is not: the tone is the
    // server's, not a constant of the cell.
    expect(HEALTH_TONE.stale).not.toBe(HEALTH_TONE.healthy);
  });

  it("long text stays on one line: a stale word carries whitespace-nowrap on the cell too", () => {
    renderList();
    const col = headers().findIndex((h) => (h.textContent ?? "").trim() === "Health");
    const td = cells(dataRow("Health Stale"))[col];
    expect(td.className).toContain("whitespace-nowrap");
    expect(td.textContent).toMatch(/^Stale \(no data since [A-Z][a-z]{2} \d{1,2}, \d{4}\)$/);
  });

  it("a row the page passed no health for prints the em dash, never a word", () => {
    renderList();
    const col = headers().findIndex((h) => (h.textContent ?? "").trim() === "Health");
    const td = cells(dataRow("Health Absent"))[col];
    expect(td.textContent?.trim()).toBe("—");
    expect(td.querySelector("span")?.className).toContain("text-text-muted");
  });

  it("a placeholder row prints the em dash in Health and every row kind spans the header count", () => {
    renderList({
      placeholderKeys: [{ id: "pk-1", exchangeLabel: "Binance", keyLabel: "Main" }],
      onFinishSetup: () => {},
    });
    const thCount = headers().length;
    const col = headers().findIndex((h) => (h.textContent ?? "").trim() === "Health");
    const placeholder = screen.getByText("Finish setup →").closest("tr") as HTMLElement;
    expect(cells(placeholder)[col].textContent?.trim()).toBe("—");
    expect(colSpanTotal(placeholder)).toBe(thCount);
    for (const name of ["Health Stale", "Health Healthy", "Health Absent"]) {
      expect(colSpanTotal(dataRow(name))).toBe(thCount);
    }
  });

  it("the empty-state row spans the header count including Health", () => {
    render(
      <StrategyTable
        strategies={[]}
        categorySlug="health-spec"
        visibility="owner-all-statuses"
        managerRows={{}}
      />,
    );
    const empty = document.querySelector("tbody td[colspan]") as HTMLTableCellElement;
    expect(empty).not.toBeNull();
    expect(empty.colSpan).toBe(headers().length);
  });
});
