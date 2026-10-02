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

import { describe, it, expect, vi, afterEach } from "vitest";
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

// SC2-PROFILE — the underline strip scrolls inside itself. These strings are
// the segmented arm as rendered at HEAD, before the underline scroll change.
// The segmented variant (WatchlistTabs) must stay byte-identical.
const SEGMENTED_LIST_CLASS =
  "inline-flex overflow-hidden rounded border border-border";
const SEGMENTED_TRIGGER_CLASS =
  "text-small font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 h-9 px-3 text-text-secondary hover:bg-page data-[state=active]:bg-accent/10 data-[state=active]:text-accent";

const SIX = ["One", "Two", "Three", "Four", "Five", "Six"] as const;

function renderSix(variant: "underline" | "segmented", defaultValue = "One") {
  return render(
    <Tabs defaultValue={defaultValue}>
      <TabsList variant={variant} aria-label="Example tabs">
        {SIX.map((label) => (
          <TabsTrigger key={label} value={label} variant={variant}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>,
  );
}

function stubStrip(
  list: HTMLElement,
  tabs: HTMLElement[],
  metrics: {
    scrollLeft: number;
    clientWidth: number;
    offsetLeft: number[];
    offsetWidth: number;
  },
) {
  Object.defineProperty(list, "scrollLeft", {
    configurable: true,
    get: () => metrics.scrollLeft,
  });
  Object.defineProperty(list, "clientWidth", {
    configurable: true,
    get: () => metrics.clientWidth,
  });
  tabs.forEach((tab, i) => {
    Object.defineProperty(tab, "offsetLeft", {
      configurable: true,
      get: () => metrics.offsetLeft[i] ?? 0,
    });
    Object.defineProperty(tab, "offsetWidth", {
      configurable: true,
      get: () => metrics.offsetWidth,
    });
  });
  const scrollTo = vi.fn();
  Object.defineProperty(list, "scrollTo", {
    configurable: true,
    writable: true,
    value: scrollTo,
  });
  return scrollTo;
}

describe("<Tabs> underline strip (SC2-PROFILE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls inside itself with an inset hairline and no border-b", () => {
    renderSix("underline");
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("[scrollbar-width:none]");
    expect(list.className).toContain(
      "shadow-[inset_0_-1px_0_var(--color-border)]",
    );
    expect(list.className).not.toContain("border-b border-border");
  });

  it("gives underline triggers shrink-0, nowrap and an inset ring, and drops -mb-px", () => {
    renderSix("underline");
    const trigger = screen.getByRole("tab", { name: "One" });
    expect(trigger.className).toContain("shrink-0");
    expect(trigger.className).toContain("whitespace-nowrap");
    expect(trigger.className).toContain("focus-visible:ring-inset");
    expect(trigger.className).toContain("border-b-2");
    expect(trigger.className).not.toContain("-mb-px");
  });

  it("keeps the segmented list and trigger class strings byte-identical", () => {
    renderSix("segmented");
    expect(screen.getByRole("tablist").className).toBe(SEGMENTED_LIST_CLASS);
    expect(screen.getByRole("tab", { name: "One" }).className).toBe(
      SEGMENTED_TRIGGER_CLASS,
    );
  });

  it("scrolls the last of six underline tabs horizontally only, and not when it is already in view", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSix("underline");
    const list = screen.getByRole("tablist");
    const tabs = SIX.map((name) => screen.getByRole("tab", { name }));
    const scrollTo = stubStrip(list, tabs, {
      scrollLeft: 0,
      clientWidth: 200,
      offsetLeft: [0, 80, 160, 240, 320, 480],
      offsetWidth: 80,
    });

    await user.click(screen.getByRole("tab", { name: "Six" }));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    const arg = scrollTo.mock.calls[0][0] as Record<string, unknown>;
    // 480 + 80 sits past the 200px window → left = 560 - 200.
    expect(arg).toEqual({ left: 360, behavior: "smooth" });
    expect(arg).not.toHaveProperty("top");
    unmount();

    renderSix("underline");
    const listInView = screen.getByRole("tablist");
    const tabsInView = SIX.map((name) => screen.getByRole("tab", { name }));
    const scrollToInView = stubStrip(listInView, tabsInView, {
      scrollLeft: 0,
      clientWidth: 400,
      offsetLeft: [0, 40, 80, 120, 160, 40],
      offsetWidth: 80,
    });
    await user.click(screen.getByRole("tab", { name: "Six" }));
    expect(scrollToInView).not.toHaveBeenCalled();
  });

  it("uses an instant horizontal scroll when prefers-reduced-motion is set", async () => {
    const user = userEvent.setup();
    const prev = window.matchMedia;
    window.matchMedia = ((query: string) => {
      const base = prev(query);
      return {
        ...base,
        matches: query.includes("prefers-reduced-motion"),
      };
    }) as typeof window.matchMedia;
    try {
      renderSix("underline");
      const list = screen.getByRole("tablist");
      const tabs = SIX.map((name) => screen.getByRole("tab", { name }));
      const scrollTo = stubStrip(list, tabs, {
        scrollLeft: 0,
        clientWidth: 200,
        offsetLeft: [0, 80, 160, 240, 320, 480],
        offsetWidth: 80,
      });
      await user.click(screen.getByRole("tab", { name: "Six" }));
      expect(scrollTo).toHaveBeenCalledWith({ left: 360, behavior: "auto" });
    } finally {
      window.matchMedia = prev;
    }
  });

  it("does not scroll a segmented list", async () => {
    const user = userEvent.setup();
    renderSix("segmented");
    const list = screen.getByRole("tablist");
    const tabs = SIX.map((name) => screen.getByRole("tab", { name }));
    const scrollTo = stubStrip(list, tabs, {
      scrollLeft: 0,
      clientWidth: 200,
      offsetLeft: [0, 80, 160, 240, 320, 480],
      offsetWidth: 80,
    });
    await user.click(screen.getByRole("tab", { name: "Six" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
