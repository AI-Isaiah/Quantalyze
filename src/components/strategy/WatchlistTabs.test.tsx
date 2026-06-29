/**
 * Phase 13 / Plan 13-01 / DISCO-01 — WatchlistTabs component tests.
 * Phase 50 / Plan 50-05 — ported onto the canonical Radix-backed `Tabs`
 * segmented primitive (UI-03 strangler dedup). The behavioral contract is
 * UNCHANGED; the port is mechanical:
 *   - Radix Trigger activates on the real pointer/keyboard event sequence, which
 *     `@testing-library/user-event` dispatches but bare `fireEvent` does not. The
 *     click / arrow / Home / End cases are therefore driven with user-event (same
 *     driver the Tabs primitive spec and AdminTabs/ProfileTabs ports use). The
 *     pointer-capture + scrollIntoView jsdom shims live in src/test-setup.ts.
 *   - The structural assertions (aria-label, role, aria-selected snapshot, roving
 *     tabindex 0/-1, idBase-derived ids, aria-controls=panelId, count badge) need
 *     no driver and stay plain render assertions — they are the 50-RESEARCH
 *     Pitfall-1 acceptance gate that proves the external StrategyTable role=tabpanel
 *     wiring survives the Radix port.
 *
 * Behaviour contract (per 13-01-PLAN.md Task 1 + 13-UI-SPEC.md State Matrix):
 *   1. Renders <div role="tablist" aria-label="Strategy list scope">.
 *   2. Both tabs have role="tab"; aria-selected="true" only on the active one.
 *   3. Watchlist tab carries a count badge when count > 0; hidden when count === 0.
 *   4. Arrow-Right on All → focus moves to My Watchlist (and activates it).
 *   5. Arrow-Left on My Watchlist → focus moves to All (and activates it).
 *   6. Click "My Watchlist" → calls onScopeChange("watchlist").
 *   7. No wrap-around: ArrowLeft on All / ArrowRight on Watchlist are no-ops.
 *   8. idBase-derived trigger ids + aria-controls=panelId preserved (Pitfall 1).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // `data-testid="watchlist-count-badge"`. When count===0 the component
    // must not render that element at all.
    expect(screen.queryByTestId("watchlist-count-badge")).toBeNull();
  });

  // M-0880 (audit-2026-05-07 / reverify-2026-05-25): the roving-tabindex contract
  // that lets a real keyboard user Tab INTO the tablist and land on the active
  // tab — exactly the active tab is the single Tab-reachable stop (tabIndex=0),
  // the inactive tab is unreachable by Tab (tabIndex=-1). A regression that made
  // both 0 (two tab stops) or both -1 (tablist unreachable) would slip past every
  // focus/onScopeChange assertion — those only fire after the tab is focused.
  //
  // 50-05 port note: Radix's roving-focus commits the 0/-1 split when focus
  // ENTERS the tablist (WAI-ARIA-correct) rather than eagerly on render, so the
  // settled contract is asserted after a real `user.tab()` (same pattern as the
  // Tabs primitive spec). The end-state — active tab is the lone Tab stop, driven
  // off the controlled `scope` value — is byte-faithful to the prior behavior.
  it("roving tabindex: active tab is the sole Tab stop, inactive is -1 (scope='all')", async () => {
    const user = userEvent.setup();
    render(<WatchlistTabs scope="all" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    await user.tab();
    expect(allTab).toHaveFocus();
    expect(allTab.getAttribute("tabindex")).toBe("0");
    expect(watchTab.getAttribute("tabindex")).toBe("-1");
  });

  it("roving tabindex: active tab is the sole Tab stop, inactive is -1 (scope='watchlist')", async () => {
    const user = userEvent.setup();
    render(<WatchlistTabs scope="watchlist" onScopeChange={() => {}} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    await user.tab();
    expect(watchTab).toHaveFocus();
    expect(allTab.getAttribute("tabindex")).toBe("-1");
    expect(watchTab.getAttribute("tabindex")).toBe("0");
  });

  it("ArrowRight on focused All tab moves focus to My Watchlist AND activates the scope (automatic activation)", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    allTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("ArrowLeft on focused My Watchlist tab moves focus to All AND activates the scope (automatic activation)", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("ArrowLeft on focused All tab is a no-op (no focus change, no scope change)", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    allTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("ArrowRight on focused My Watchlist tab is a no-op (no wrap-around, no scope change)", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("clicking My Watchlist calls onScopeChange('watchlist')", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    await user.click(screen.getByRole("tab", { name: /My Watchlist/ }));
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  it("clicking All calls onScopeChange('all')", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={0} idBase="t" panelId="p" />);
    await user.click(screen.getByRole("tab", { name: /^All$/ }));
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("Home key jumps focus to All tab and activates 'all' scope", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="watchlist" onScopeChange={onScopeChange} count={2} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    watchTab.focus();
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(allTab);
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("End key jumps focus to My Watchlist tab and activates 'watchlist' scope", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    render(<WatchlistTabs scope="all" onScopeChange={onScopeChange} count={2} idBase="t" panelId="p" />);
    const allTab = screen.getByRole("tab", { name: /^All$/ });
    const watchTab = screen.getByRole("tab", { name: /My Watchlist/ });
    allTab.focus();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(watchTab);
    expect(onScopeChange).toHaveBeenCalledWith("watchlist");
  });

  // 50-RESEARCH Pitfall 1 acceptance gate — the imperative id contract the
  // external StrategyTable role="tabpanel" resolves against MUST survive the
  // Radix port (Radix would otherwise auto-generate its own ids). An explicit id
  // passed to TabsTrigger wins over Radix's auto id.
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
