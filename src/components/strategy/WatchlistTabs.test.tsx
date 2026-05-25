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
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toBe("Strategy list scope");
  });

  it("renders exactly two tabs", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
  });

  it("marks the All tab aria-selected when scope='all'", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(watchTab.getAttribute("aria-selected")).toBe("false");
  });

  it("marks the My Watchlist tab aria-selected when scope='watchlist'", () => {
    render(<WatchlistTabs scope="watchlist" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("aria-selected")).toBe("false");
    expect(watchTab.getAttribute("aria-selected")).toBe("true");
  });

  it("renders the count badge with the numeric value when count > 0", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={3} idBase="t" panelId="p" />);
    // The badge is the only place '3' appears in the rendered output.
    expect(screen.getByText("3")).toBeDefined();
  });

  // audit-2026-05-21 e2e-spec-chains: e2e/discovery-watchlist.spec.ts now
  // targets the badge via `data-testid="watchlist-count-badge"` instead of
  // the loose `tab.toContainText("1")` substring match (which would
  // false-pass on counts of 11, 100, etc. — PR #236 anchor-element
  // principle). Pin the testid here so a future rename silently breaks
  // unit + e2e together in CI rather than only when the nightly fires.
  it("badge is queryable by data-testid='watchlist-count-badge' (e2e selector contract)", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={1} idBase="t" panelId="p" />);
    const badge = screen.getByTestId("watchlist-count-badge");
    expect(badge.textContent).toBe("1");
  });

  it("does not render a count badge when count === 0", () => {
    render(
      <WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />,
    );
    // C-0143 (audit-2026-05-07): refactor-safe assertion via data-testid.
    //
    // Pre-fix this asserted `container.textContent.not.toMatch(/\b0\b/)`
    // (a global text-content regex) plus `querySelector(".bg-accent.text-white")`
    // (Tailwind utility selector). Both were brittle anti-assertions:
    //   - The regex passes today because nothing else in the render
    //     contains a '0', but a future tooltip "Showing 0 of 8" or
    //     aria-label "0 starred" would silently false-fail without a
    //     real behavior regression.
    //   - The class selector matches CSS utilities, not behavior — a
    //     theme refactor that swaps `.bg-accent.text-white` for a
    //     design-token variant would falsely pass even if the badge
    //     re-appeared with the new class.
    //   - Inverse direction: a regression rendering '00' or 'O' (capital
    //     letter) would slip past `\b0\b` and ship.
    //
    // Behavioral assertion: the badge element carries
    // `data-testid="watchlist-count-badge"` (WatchlistTabs.tsx:88). When
    // count===0 the component must not render that element at all.
    expect(screen.queryByTestId("watchlist-count-badge")).toBeNull();
  });

  // M-0880 (audit-2026-05-07 / reverify-2026-05-25): the ArrowRight/Left
  // focus-traversal tests above prove the handler imperatively calls
  // `.focus()` on the ref (JSDOM does not synthesize native arrow-key focus
  // traversal). They do NOT pin the roving-tabindex contract that lets a
  // real keyboard user Tab INTO the tablist and land on the active tab:
  // the active tab carries tabIndex=0, the inactive tab tabIndex=-1
  // (WatchlistTabs.tsx:58, :76). A regression that hardcoded both to 0 (two
  // tab stops) or both to -1 (tablist unreachable by Tab) would slip past
  // every focus/onScopeChange assertion — those only fire after the tab is
  // already focused. tabIndex is driven by the `scope` prop, so it is pinned
  // statically per scope state, independent of any keydown handler.
  it("roving tabindex: active tab is tabIndex=0, inactive tab is tabIndex=-1 (scope='all')", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("tabindex")).toBe("0");
    expect(watchTab.getAttribute("tabindex")).toBe("-1");
  });

  it("roving tabindex: active tab is tabIndex=0, inactive tab is tabIndex=-1 (scope='watchlist')", () => {
    render(<WatchlistTabs scope="watchlist" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("tabindex")).toBe("-1");
    expect(watchTab.getAttribute("tabindex")).toBe("0");
  });

  it("ArrowRight on focused All tab moves focus to My Watchlist AND activates the scope (automatic activation)", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("ArrowLeft on focused My Watchlist tab moves focus to All AND activates the scope (automatic activation)", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    fireEvent.keyDown(watchTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("ArrowLeft on focused All tab is a no-op (no focus change, no scope change)", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("ArrowRight on focused My Watchlist tab is a no-op (no wrap-around, no scope change)", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    fireEvent.keyDown(watchTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("clicking My Watchlist calls onScopeChange('watchlist')", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    fireEvent.click(screen.getByRole("tab", { name: /My Watchlist/ }));
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("clicking All calls onScopeChange('all')", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    fireEvent.click(screen.getByRole("tab", { name: /^All$/ }));
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("Home key jumps focus to All tab and activates 'all' scope", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={2} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    fireEvent.keyDown(watchTab, { key: "Home" });
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("End key jumps focus to My Watchlist tab and activates 'watchlist' scope", () => {
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={2} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "End" });
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("tab DOM ids derive from idBase prop, not hardcoded strings (multi-instance safety)", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="abc123" panelId="panel-x" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.id).toBe("abc123-tab-all");
    expect(watchTab.id).toBe("abc123-tab-watchlist");
  });

  it("aria-controls on each tab points at the panelId prop", () => {
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="my-custom-panel" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(allTab.getAttribute("aria-controls")).toBe("my-custom-panel");
    expect(watchTab.getAttribute("aria-controls")).toBe("my-custom-panel");
  });
});
