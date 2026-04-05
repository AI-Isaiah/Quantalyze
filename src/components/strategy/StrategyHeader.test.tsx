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
  strategy_types: ["Directional"],
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
    const { container } = render(
      <StrategyHeader strategy={makeStrategy()} computedAt={recentDate} />,
    );
    expect(screen.queryByText(/stale/i)).toBeNull();
    expect(screen.queryByText(/last synced/i)).toBeNull();
  });

  it("shows yellow indicator for 24-48h old data", () => {
    const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    render(<StrategyHeader strategy={makeStrategy()} computedAt={oldDate} />);
    expect(screen.getByText(/last synced 30h ago/i)).toBeDefined();
  });

  it("shows red indicator for >48h old data", () => {
    const veryOldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72h = 3 days
    render(<StrategyHeader strategy={makeStrategy()} computedAt={veryOldDate} />);
    expect(screen.getByText(/data stale.*3d ago/i)).toBeDefined();
  });

  it("shows no indicator when computedAt is undefined", () => {
    const { container } = render(<StrategyHeader strategy={makeStrategy()} />);
    expect(container.textContent).not.toContain("stale");
    expect(container.textContent).not.toContain("synced");
  });
});
