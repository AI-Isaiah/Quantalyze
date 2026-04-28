/**
 * Phase 13 / Plan 13-01 / DISCO-01 — WatchlistTabs component tests.
 *
 * Behaviour contract (per 13-01-PLAN.md Task 1 + 13-UI-SPEC.md State Matrix):
 *   1. Renders <div role="tablist" aria-label="Strategy list scope">.
 *   2. Both tabs have role="tab"; aria-selected="true" only on the active one.
 *   3. Watchlist tab carries a count badge when count > 0; hidden when count === 0.
 *   4. Arrow-Right on All → focus moves to My Watchlist.
 *   5. Arrow-Left on My Watchlist → focus moves to All.
 *   6. Click "My Watchlist" → calls onScopeChange("watchlist").
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WatchlistTabs } from "./WatchlistTabs";

describe("WatchlistTabs", () => {
  it("renders a tablist with the locked aria-label 'Strategy list scope'", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toBe("Strategy list scope");
  });

  it("renders exactly two tabs", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
  });

  it("marks the All tab aria-selected when scope='all'", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(watchTab.getAttribute("aria-selected")).toBe("false");
  });

  it("marks the My Watchlist tab aria-selected when scope='watchlist'", () => {
    render(<WatchlistTabs scope="watchlist" onScopeChange={() => {}} count={0} />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("aria-selected")).toBe("false");
    expect(watchTab.getAttribute("aria-selected")).toBe("true");
  });

  it("renders the count badge with the numeric value when count > 0", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={3} />);
    // The badge is the only place '3' appears in the rendered output.
    expect(screen.getByText("3")).toBeDefined();
  });

  it("does not render a count badge when count === 0", () => {
    const { container } = render(
      <WatchlistTabs scope="all" onScopeChange={() => {}} count={0} />,
    );
    // No '0' digit anywhere AND no element with the badge fill class. The
    // text-content check is the strict assertion; the class check is a
    // belt-and-braces guard against a renderer that happens to print 0.
    expect(container.textContent).not.toMatch(/\b0\b/);
    const badge = container.querySelector(".bg-accent.text-white");
    expect(badge).toBeNull();
  });

  it("ArrowRight on focused All tab moves focus to My Watchlist", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(watchTab);
  });

  it("ArrowLeft on focused My Watchlist tab moves focus to All", () => {
    render(<WatchlistTabs scope="watchlist" onScopeChange={() => {}} count={0} />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    fireEvent.keyDown(watchTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(allTab);
  });

  it("clicking My Watchlist calls onScopeChange('watchlist')", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} />);
    fireEvent.click(screen.getByRole("tab", { name: /My Watchlist/ }));
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("clicking All calls onScopeChange('all')", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} />);
    fireEvent.click(screen.getByRole("tab", { name: /^All$/ }));
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });
});
