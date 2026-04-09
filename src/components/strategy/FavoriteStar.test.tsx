import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FavoriteStar } from "./FavoriteStar";

/**
 * Optimistic-toggle star button. Flips state instantly on click, fires
 * POST or DELETE in the background, reverts + surfaces an error on
 * failure. Router refresh on success is mocked out.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("FavoriteStar", () => {
  it("renders aria-pressed=false when initialFavorited=false", () => {
    render(<FavoriteStar strategyId="s1" initialFavorited={false} />);
    const btn = screen.getByRole("button", { name: /Add to favorites/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("renders aria-pressed=true when initialFavorited=true", () => {
    render(<FavoriteStar strategyId="s1" initialFavorited={true} />);
    const btn = screen.getByRole("button", {
      name: /Remove from favorites/i,
    });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("POSTs on click when currently unfavorited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<FavoriteStar strategyId="s1" initialFavorited={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Add to favorites/i }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { method: string }).method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({ strategy_id: "s1" });
  });

  it("DELETEs on click when currently favorited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<FavoriteStar strategyId="s1" initialFavorited={true} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Remove from favorites/i }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { method: string }).method).toBe("DELETE");
  });

  it("reverts the state and surfaces an error on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server down" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FavoriteStar strategyId="s1" initialFavorited={false} />);
    const btn = screen.getByRole("button", { name: /Add to favorites/i });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByText(/server down/)).toBeInTheDocument(),
    );
    // Reverted back to "Add to favorites" (aria-pressed=false).
    expect(
      screen.getByRole("button", { name: /Add to favorites/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
