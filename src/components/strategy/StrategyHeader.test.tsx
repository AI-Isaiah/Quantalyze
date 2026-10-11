import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyHeader } from "./StrategyHeader";
import type { Strategy } from "@/lib/types";

const makeStrategy = (overrides?: Partial<Strategy>): Strategy => ({
  id: "1",
  user_id: "u1",
  category_id: "c1",
  api_key_id: null,
  name: "Test Strategy",
  description: null,
  strategy_types: ["Long-Only"],
  subtypes: ["Trend Following"],
  markets: ["Futures"],
  supported_exchanges: ["Binance"],
  leverage_range: "1x - 2x",
  avg_daily_turnover: null,
  aum: null,
  max_capacity: null,
  start_date: "2023-01-15",
  status: "published",
  is_example: false,
  benchmark: "BTC",
  created_at: new Date().toISOString(),
  disclosure_tier: "institutional",
  codename: null,
  ...overrides,
});

describe("StrategyHeader", () => {
  it("renders strategy name", () => {
    render(<StrategyHeader strategy={makeStrategy()} />);
    expect(screen.getByText("Test Strategy")).toBeDefined();
  });

  it("renders start date when present", () => {
    const { container } = render(<StrategyHeader strategy={makeStrategy()} />);
    expect(container.textContent).toContain("Live since 2023-01-15");
  });

  it("hides start date when null", () => {
    const { container } = render(<StrategyHeader strategy={makeStrategy({ start_date: null })} />);
    expect(container.textContent).not.toContain("Live since");
  });

  it("shows no stale indicator for fresh data", () => {
    const recentDate = new Date().toISOString();
    render(<StrategyHeader strategy={makeStrategy()} computedAt={recentDate} />);
    expect(screen.queryByText(/stale/i)).toBeNull();
    expect(screen.queryByText(/last synced/i)).toBeNull();
  });

  // Phase 167.1.2.2.2 / D-07 — a bare `computedAt` is the ANALYTICS JOB's
  // clock and the badge no longer claims anything from it. This header takes no
  // analytics row, so it has neither a trade fetch nor a series end to state
  // (it passes an explicit null for both) and therefore renders NO badge,
  // however old `computedAt` is. REPLACES the two cases that pinned
  // "Synced 1d ago" / "Synced 3d ago". The "Live since" line is the control
  // that something did render beside the (absent) badge.
  it.each([
    ["30h (1d)", 30 * 60 * 60 * 1000],
    ["72h (3d)", 72 * 60 * 60 * 1000],
  ])("makes no freshness claim from a %s old computedAt", (_label, ageMs) => {
    const oldDate = new Date(Date.now() - ageMs).toISOString();
    const { container } = render(<StrategyHeader strategy={makeStrategy()} computedAt={oldDate} />);
    expect(container.textContent).toContain("Live since 2023-01-15");
    expect(container.textContent).not.toMatch(/Synced|Trades fetched|No trade fetch|Track record/);
    expect(container.querySelector("span.rounded-full")).toBeNull();
  });

  it("shows no indicator when computedAt is undefined", () => {
    const { container } = render(<StrategyHeader strategy={makeStrategy()} />);
    expect(container.textContent).not.toContain("stale");
    expect(container.textContent).not.toContain("synced");
  });
});
