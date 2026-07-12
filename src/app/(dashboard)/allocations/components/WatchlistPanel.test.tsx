/**
 * Phase 100 / Plan 02 / Task 2 — WatchlistPanel (PI-05, favorites half).
 *
 * Pins the UI-SPEC W2 contract:
 *   - Honest-empty: heading kept + verbatim body copy + "Browse strategies →"
 *     link to /discovery; ZERO ghost/skeleton rows.
 *   - Dense table rows: name link + TrustTierLabel + favorited date + a
 *     "Suggested" chip iff the id is in the current optimizer suggestions.
 *   - Sort recency (default) / Name A–Z; NO score sort.
 *   - Group None (default) / Verification tier (real trust_tier only).
 *   - Bulk remove issues ONE idempotent PUT {action:'remove'} PER selected id
 *     (call-site wiring proof), with per-row ROLLBACK on a partial failure and
 *     a role="status" announcement.
 *   - Per-row star toggle: aria-pressed + issues the same PUT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WatchlistPanel } from "./WatchlistPanel";
import type { FavoriteRow } from "../lib/watchlist-read";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const FAVORITES: FavoriteRow[] = [
  {
    strategy_id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Zephyr Momentum",
    slug: "zephyr-momentum",
    trust_tier: "api_verified",
    created_at: "2026-06-10T00:00:00Z",
  },
  {
    strategy_id: "bbbbbbbb-0000-0000-0000-000000000002",
    name: "Aurora Carry",
    slug: "aurora-carry",
    trust_tier: "self_reported",
    created_at: "2026-06-05T00:00:00Z",
  },
  {
    strategy_id: "cccccccc-0000-0000-0000-000000000003",
    name: "Meridian Vol",
    slug: "meridian-vol",
    trust_tier: null,
    created_at: "2026-06-01T00:00:00Z",
  },
];

function okResponse() {
  return { ok: true, json: async () => ({ success: true }) } as Response;
}
function errResponse() {
  return { ok: false, json: async () => ({ error: "Failed to remove" }) } as Response;
}

describe("WatchlistPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse());
  });

  it("honest-empty: heading + verbatim copy + Browse link, no rows", () => {
    render(<WatchlistPanel favorites={[]} suggestedIds={[]} />);
    expect(
      screen.getByText(
        "No favorites yet. Star strategies in Discovery to build your watchlist.",
      ),
    ).toBeInTheDocument();
    const browse = screen.getByRole("link", { name: /Browse strategies/i });
    expect(browse).toHaveAttribute("href", "/discovery");
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });

  it("renders each favorite: name link, trust tier, favorited date", () => {
    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    const link = screen.getByRole("link", { name: "Zephyr Momentum" });
    expect(link).toHaveAttribute(
      "href",
      "/factsheet/aaaaaaaa-0000-0000-0000-000000000001",
    );
    // TrustTierLabel renders a data-trust-tier attribute per variant.
    expect(screen.getAllByTestId("trust-tier-label").length).toBe(2); // null tier renders nothing
    expect(screen.getByText("2026-06-10")).toBeInTheDocument();
  });

  it("Suggested chip renders ONLY for ids in suggestedIds", () => {
    render(
      <WatchlistPanel
        favorites={FAVORITES}
        suggestedIds={["aaaaaaaa-0000-0000-0000-000000000001"]}
      />,
    );
    const chips = screen.getAllByTestId("suggested-chip");
    expect(chips).toHaveLength(1);
  });

  it("default sort is recency; Name A–Z re-sorts alphabetically", () => {
    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    const namesBefore = screen
      .getAllByTestId("watchlist-name")
      .map((el) => el.textContent);
    expect(namesBefore).toEqual(["Zephyr Momentum", "Aurora Carry", "Meridian Vol"]);

    fireEvent.click(screen.getByRole("button", { name: /Name A–Z/i }));
    const namesAfter = screen
      .getAllByTestId("watchlist-name")
      .map((el) => el.textContent);
    expect(namesAfter).toEqual(["Aurora Carry", "Meridian Vol", "Zephyr Momentum"]);
  });

  it("Verification tier grouping shows real trust-tier group headers", () => {
    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Verification tier/i }));
    // At least the api_verified + self_reported group headers appear.
    expect(screen.getByRole("rowgroup", { name: /API verified/i })).toBeInTheDocument();
  });

  it("bulk remove issues ONE PUT per selected id and announces success", async () => {
    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Zephyr Momentum/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Aurora Carry/i }));

    const removeBtn = screen.getByRole("button", {
      name: /Remove 2 from watchlist/i,
    });
    fireEvent.click(removeBtn);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain(
      "/api/watchlist/aaaaaaaa-0000-0000-0000-000000000001",
    );
    expect(urls).toContain(
      "/api/watchlist/bbbbbbbb-0000-0000-0000-000000000002",
    );
    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toMatchObject({ method: "PUT" });
      expect(JSON.parse(call[1].body)).toEqual({ action: "remove" });
    }
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Removed 2 strategies from watchlist",
      ),
    );
    // Both removed rows are gone; the untouched one remains.
    expect(screen.queryByTestId("watchlist-name")).toHaveTextContent(
      "Meridian Vol",
    );
  });

  it("rolls back only the FAILED id on a partial failure", async () => {
    // First PUT succeeds, second fails.
    mockFetch.mockResolvedValueOnce(okResponse());
    mockFetch.mockResolvedValueOnce(errResponse());

    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Zephyr Momentum/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Aurora Carry/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Remove 2 from watchlist/i }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    // The succeeded row (Zephyr) is gone; the failed row (Aurora) is restored.
    await waitFor(() => {
      const names = screen
        .getAllByTestId("watchlist-name")
        .map((el) => el.textContent);
      expect(names).toContain("Aurora Carry");
      expect(names).not.toContain("Zephyr Momentum");
    });
  });

  it("per-row star is aria-pressed and issues a remove PUT", async () => {
    render(<WatchlistPanel favorites={FAVORITES} suggestedIds={[]} />);
    const star = screen.getByRole("button", {
      name: /Remove Zephyr Momentum from watchlist/i,
    });
    expect(star).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star);
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/watchlist/aaaaaaaa-0000-0000-0000-000000000001",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
