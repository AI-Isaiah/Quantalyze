import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FavoritesPanel } from "./FavoritesPanel";
import type { StrategyForBuilder } from "@/lib/scenario";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeFavorite(id: string, name: string): StrategyForBuilder {
  return {
    id,
    name,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["BTC"],
    start_date: "2023-01-03",
    daily_returns: [{ date: "2024-01-02", value: 0.001 }],
    cagr: 0.15,
    sharpe: 1.4,
    volatility: 0.12,
    max_drawdown: -0.05,
  };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof FavoritesPanel>> = {},
) {
  const onClose = vi.fn();
  const onSelectionChange = vi.fn();
  const defaultProps: React.ComponentProps<typeof FavoritesPanel> = {
    open: true,
    onClose,
    favorites: [makeFavorite("f1", "Orion L/S"), makeFavorite("f2", "Helios")],
    realStrategyIds: ["r1", "r2"],
    realPortfolioName: "Active Allocation",
    onSelectionChange,
  };
  const result = render(<FavoritesPanel {...defaultProps} {...overrides} />);
  return { ...result, onClose, onSelectionChange };
}

describe("FavoritesPanel", () => {
  it("renders the favorites list with all names", () => {
    renderPanel();
    expect(screen.getByText("Orion L/S")).toBeInTheDocument();
    expect(screen.getByText("Helios")).toBeInTheDocument();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <FavoritesPanel
        open={false}
        onClose={vi.fn()}
        favorites={[makeFavorite("f1", "Orion")]}
        realStrategyIds={["r1"]}
        realPortfolioName="Active Allocation"
        onSelectionChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fires onSelectionChange when a favorite is toggled", async () => {
    const { onSelectionChange } = renderPanel();
    fireEvent.click(screen.getByLabelText("Toggle Orion L/S"));
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled());
    const lastCall =
      onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(["f1"]);
  });

  it("fires onSelectionChange with an empty array when the last toggle is turned off", async () => {
    const { onSelectionChange } = renderPanel();
    // Toggle on then off.
    fireEvent.click(screen.getByLabelText("Toggle Orion L/S"));
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("Toggle Orion L/S"));
    await waitFor(() => {
      const lastCall =
        onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1];
      expect(lastCall[0]).toEqual([]);
    });
  });

  it("renders an empty state when there are no favorites", () => {
    renderPanel({ favorites: [] });
    expect(screen.getByText(/No favorites yet/i)).toBeInTheDocument();
  });

  it("gates the Save button until at least one favorite is toggled", async () => {
    renderPanel();
    const saveBtn = screen.getByRole("button", {
      name: /Save as Test Portfolio/i,
    });
    expect(saveBtn).toBeDisabled();
    // Toggle one on.
    fireEvent.click(screen.getByLabelText("Toggle Orion L/S"));
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
  });

  it("closes on the close button", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByLabelText("Close favorites panel"));
    expect(onClose).toHaveBeenCalled();
  });
});
