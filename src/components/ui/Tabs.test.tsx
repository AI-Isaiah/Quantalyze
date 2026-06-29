/**
 * Phase 50 / Plan 50-01 / UI-02 — Tabs primitive RED contract.
 *
 * RED (Wave 0): `src/components/ui/Tabs.tsx` does NOT exist yet — this spec
 * fails on the import (module-not-found / unresolved import) until Wave-1
 * Plan 03 builds the Radix-backed wrapper. The contract precedes the
 * implementation by design (BP-03 — the new primitive ships with its test
 * in the same PR that creates it).
 *
 * Behaviour contract (50-UI-SPEC.md §Tabs + 50-RESEARCH.md Pattern 2):
 *   1. Triggers expose role="tab"; panels expose role="tabpanel" (Radix anatomy).
 *   2. Exactly ONE trigger is aria-selected="true" at a time; clicking the
 *      second flips selection (and aria-selected) to it.
 *   3. Roving tabindex — the active trigger is tabIndex=0, inactive tabIndex=-1.
 *   4. Keyboard (activationMode="automatic", the default + the locked choice for
 *      all 3 consumers): ArrowRight moves selection to the next trigger;
 *      Home/End jump to the first/last trigger.
 *
 * Driver (Option A — orchestrator-authorized): Radix Tabs activates on real
 * pointerdown/focus + a roving tabindex that does NOT settle synchronously under
 * bare `fireEvent` in jsdom, so the activation/keyboard assertions are driven with
 * `@testing-library/user-event` (`user.click` / `user.keyboard`), which dispatches
 * the full pointer + key event sequence Radix listens for. The pointer-capture and
 * `scrollIntoView` jsdom shims live in `src/test-setup.ts`. The two structural
 * asserts (role anatomy + the initial single-`aria-selected` snapshot) need no
 * driver and stay as plain render assertions. The keyboard INTENT is unchanged —
 * real ArrowRight/Home/End roving-focus a11y is exercised, not softened.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";

function renderTwoTab() {
  return render(
    <Tabs defaultValue="one">
      <TabsList aria-label="Example tabs">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Panel one</TabsContent>
      <TabsContent value="two">Panel two</TabsContent>
    </Tabs>,
  );
}

describe("<Tabs> (Radix-backed primitive)", () => {
  it("renders triggers as role=tab and a panel as role=tabpanel", () => {
    renderTwoTab();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // Radix renders only the active panel by default.
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("marks exactly one trigger aria-selected=true at a time", () => {
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    expect(one.getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking the second trigger flips aria-selected to it", async () => {
    const user = userEvent.setup();
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    await user.click(two);
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(one.getAttribute("aria-selected")).toBe("false");
  });

  it("roving tabindex: the active trigger is tabIndex=0, inactive is tabIndex=-1", async () => {
    const user = userEvent.setup();
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    // The roving-tabindex contract: exactly the active trigger is reachable by
    // Tab (tabIndex=0); the rest are -1 and reached via the arrow keys. Drive a
    // real focus into the tablist (user-event) so Radix's roving state settles,
    // then assert the 0/-1 split follows the active trigger.
    await user.tab();
    expect(one).toHaveFocus();
    expect(one.getAttribute("tabindex")).toBe("0");
    expect(two.getAttribute("tabindex")).toBe("-1");
    // After ArrowRight activation the roving 0/-1 split moves to the new active
    // trigger — the inactive one becomes unreachable by Tab.
    await user.keyboard("{ArrowRight}");
    expect(two.getAttribute("tabindex")).toBe("0");
    expect(one.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowRight moves selection to the next trigger (automatic activation)", async () => {
    const user = userEvent.setup();
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    one.focus();
    await user.keyboard("{ArrowRight}");
    expect(two).toHaveFocus();
    // activationMode="automatic": arrow-key focus also flips selection.
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(one.getAttribute("aria-selected")).toBe("false");
  });

  it("Home jumps to the first trigger and End jumps to the last", async () => {
    const user = userEvent.setup();
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    one.focus();
    await user.keyboard("{End}");
    expect(two).toHaveFocus();
    await user.keyboard("{Home}");
    expect(one).toHaveFocus();
  });
});
