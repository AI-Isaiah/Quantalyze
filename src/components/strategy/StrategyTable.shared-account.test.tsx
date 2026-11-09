/**
 * Phase 197 / CLAR-05 (D-01, D-02) - the admin-only "shares an exchange account" line.
 *
 * WHY ADMIN-ONLY. One exchange account under several logins is intended (founder), so the line is
 * not a warning and is not shown to allocators, managers or anonymous readers. It is an
 * informational aid for the admin who curates the catalogue. The page passes `sharedAccountPartners`
 * to the table ONLY for an admin (see the page test for the payload-absence cases); with the prop
 * ABSENT the table renders no line, no placeholder and no title for any row.
 *
 * WHY UNPUBLISHED PARTNERS ARE NEVER NAMED lives in the reader's own test
 * (`src/lib/discovery/shared-account-partners.test.ts`): the reader only ever sees published
 * strategies, so this file only has to render the names it is handed.
 *
 * ANTI-VACUITY. Every present-case has its absent twin beside it (another row, an empty array, no
 * prop), so no assertion can pass by rendering nothing. The clock is frozen and every fixture has a
 * current `series_end`, so the stale partition does not reorder or restyle the rows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyTable } from "./StrategyTable";
import { sharedAccountSentence } from "./SharedAccountNote";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

const NOW_ISO = "2026-11-08T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(Date.parse(NOW_ISO) - n * DAY_MS).toISOString().slice(0, 10);
}

beforeEach(() => {
  installFetchMock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage
  }
});

afterEach(() => {
  vi.useRealTimers();
  restoreFetchMock();
});

const S1 = "5a000001-0000-4000-8000-000000000001";
const S2 = "5a000001-0000-4000-8000-000000000002";
const S3 = "5a000001-0000-4000-8000-000000000003";

function analyticsFor(strategyId: string, sharpe: number): StrategyAnalytics {
  return {
    id: `an-${strategyId}`,
    strategy_id: strategyId,
    computed_at: NOW_ISO,
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.2,
    cagr: 0.1,
    volatility: 0.2,
    sharpe,
    sortino: 1.1,
    calmar: 0.9,
    max_drawdown: -0.1,
    max_drawdown_duration_days: 20,
    six_month_return: 0.05,
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
    trades_fetched_at: NOW_ISO,
    series_start: "2024-06-01",
    series_end: daysAgo(1),
  };
}

function makeRow(id: string, name: string, sharpe: number): StrategyWithAnalytics {
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
    asset_class: "crypto",
    analytics: analyticsFor(id, sharpe),
  };
}

function fixtures(): StrategyWithAnalytics[] {
  return [makeRow(S1, "Alpha Core", 2.5), makeRow(S2, "Beta Carry", 2.0), makeRow(S3, "Gamma Basis", 1.5)];
}

function mount(props: Record<string, unknown> = {}) {
  return render(
    <StrategyTable
      key="shared-account"
      strategies={fixtures()}
      categorySlug="crypto-sma"
      userId="user-1"
      {...props}
    />,
  );
}

const lineMatcher = /^Shares an exchange account with /;

describe("sharedAccountSentence (D-01 copy)", () => {
  it("one partner: 'with A.'", () => {
    expect(sharedAccountSentence(["A"])).toBe("Shares an exchange account with A.");
  });
  it("two partners: 'with A and B.'", () => {
    expect(sharedAccountSentence(["A", "B"])).toBe("Shares an exchange account with A and B.");
  });
  it("three partners: 'with A, B and 1 more.'", () => {
    expect(sharedAccountSentence(["A", "B", "C"])).toBe(
      "Shares an exchange account with A, B and 1 more.",
    );
  });
  it("four partners: 'with A, B and 2 more.'", () => {
    expect(sharedAccountSentence(["A", "B", "C", "D"])).toBe(
      "Shares an exchange account with A, B and 2 more.",
    );
  });
  it("no partners: null (no line, no placeholder)", () => {
    expect(sharedAccountSentence([])).toBeNull();
  });
});

describe("StrategyTable shared-account line, table view (CLAR-05)", () => {
  it("shows the one-partner sentence with the admin title on the row that has partners, and on no other", () => {
    mount({ sharedAccountPartners: { [S1]: ["Beta Carry"] } });
    const line = screen.getByText("Shares an exchange account with Beta Carry.");
    expect(line.getAttribute("title")).toBe(
      "Shown to admins only. Shares an exchange account with Beta Carry.",
    );
    expect(line.className).toContain("text-micro");
    expect(line.className).toContain("text-text-muted");
    // Only the one row carries a line.
    expect(screen.getAllByText(lineMatcher)).toHaveLength(1);
  });

  it("names two partners, and for three or more counts the rest while the title keeps every name", () => {
    mount({
      sharedAccountPartners: {
        [S1]: ["Beta Carry", "Gamma Basis"],
        [S2]: ["Alpha Core", "Gamma Basis", "Delta", "Echo"],
      },
    });
    expect(screen.getByText("Shares an exchange account with Beta Carry and Gamma Basis.")).toBeTruthy();
    const many = screen.getByText("Shares an exchange account with Alpha Core, Gamma Basis and 2 more.");
    expect(many.getAttribute("title")).toBe(
      "Shown to admins only. Shares an exchange account with Alpha Core, Gamma Basis, Delta, Echo.",
    );
  });

  it("renders no line for an entry with an empty array", () => {
    mount({ sharedAccountPartners: { [S1]: [] } });
    expect(screen.queryAllByText(lineMatcher)).toHaveLength(0);
  });

  it("renders no line and no title when the prop is absent (the non-admin, anonymous and owner mounts)", () => {
    const { container } = mount();
    expect(screen.queryAllByText(lineMatcher)).toHaveLength(0);
    expect(container.innerHTML).not.toContain("Shown to admins only");
  });

  it("prints partner names as plain text, never as links (U-11)", () => {
    mount({ sharedAccountPartners: { [S1]: ["Beta Carry"] } });
    const line = screen.getByText("Shares an exchange account with Beta Carry.");
    expect(line.closest("a")).toBeNull();
    expect(line.querySelector("a")).toBeNull();
  });

  it("uses none of the banned wrongdoing words", () => {
    const { container } = mount({ sharedAccountPartners: { [S1]: ["Beta Carry"] } });
    const line = screen.getByText("Shares an exchange account with Beta Carry.");
    expect(line.textContent ?? "").not.toMatch(/suspicious|duplicate|warning|conflict/i);
    expect(container.contains(line)).toBe(true);
  });
});

describe("StrategyTable shared-account line, grid view (CLAR-05)", () => {
  async function toGrid() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Grid view" }));
  }

  it("renders the same sentence once for a card with partners, and none for the others", async () => {
    mount({ sharedAccountPartners: { [S1]: ["Beta Carry"], [S3]: [] } });
    await toGrid();
    const line = screen.getByText("Shares an exchange account with Beta Carry.");
    expect(line.getAttribute("title")).toBe(
      "Shown to admins only. Shares an exchange account with Beta Carry.",
    );
    expect(screen.getAllByText(lineMatcher)).toHaveLength(1);
  });

  it("renders no line in the grid when the prop is absent", async () => {
    mount();
    await toGrid();
    expect(screen.queryAllByText(lineMatcher)).toHaveLength(0);
  });
});
