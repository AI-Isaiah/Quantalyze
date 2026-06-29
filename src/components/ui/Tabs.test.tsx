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
 * Query/keyboard pattern borrowed from WatchlistTabs.test.tsx (role/aria/
 * tabIndex + fireEvent.keyDown + document.activeElement) and the RTL render
 * convention from CardShell.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("clicking the second trigger flips aria-selected to it", () => {
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    fireEvent.click(two);
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(one.getAttribute("aria-selected")).toBe("false");
  });

  it("roving tabindex: active trigger is tabIndex=0, inactive is tabIndex=-1", () => {
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    expect(one.getAttribute("tabindex")).toBe("0");
    expect(two.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowRight moves selection to the next trigger (automatic activation)", () => {
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(document.activeElement).toBe(two);
    expect(two.getAttribute("aria-selected")).toBe("true");
  });

  it("Home jumps to the first trigger and End jumps to the last", () => {
    renderTwoTab();
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    one.focus();
    fireEvent.keyDown(one, { key: "End" });
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(two, { key: "Home" });
    expect(document.activeElement).toBe(one);
  });
});
