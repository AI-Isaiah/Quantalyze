import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "./Breadcrumb";

/**
 * Phase 51 NAV-02 / UI-SPEC §Breadcrumb Contract — the two breadcrumb a11y gaps.
 *
 * RED CONTRACT (plan 51-01): these assertions FAIL against today's
 * Breadcrumb.tsx — the leaf crumb is a plain styled <span> with NO
 * `aria-current`, and the linked crumbs carry NO focus-visible affordance. Plan
 * 51-03 closes both gaps additively (mirroring MobileNav.tsx's aria-current +
 * focus-visible:outline-accent pattern), turning these GREEN. Until then they
 * pin the target so the 51-03 implementation lands against a fixed contract.
 *
 * Style anchor: the colocated Sidebar.test.tsx / MobileNav.test.tsx render /
 * screen harness. Breadcrumb takes a curated `items` prop (RESEARCH Pattern 3a
 * — KEEP explicit items, never auto-derive from segments), so no
 * next/navigation mock is needed here.
 */

const ITEMS = [
  { label: "My Allocation", href: "/allocations" },
  { label: "Scenario", href: "/allocations?tab=scenario" },
  { label: "Bridge candidate" }, // leaf — no href
];

describe("Breadcrumb a11y — current crumb (NAV-02, RED until 51-03)", () => {
  it("marks the LEAF crumb with aria-current=page", () => {
    render(<Breadcrumb items={ITEMS} />);
    // The leaf is the last item, rendered as a non-link element. It must
    // advertise itself as the current page to assistive tech.
    const leaf = screen.getByText("Bridge candidate");
    expect(leaf).toHaveAttribute("aria-current", "page");
  });

  it("does NOT mark a linked (non-leaf) crumb as aria-current", () => {
    render(<Breadcrumb items={ITEMS} />);
    // Only the leaf is current — an intermediate linked crumb must not claim it.
    const linked = screen.getByText("My Allocation").closest("a");
    expect(linked).not.toHaveAttribute("aria-current");
  });
});

describe("Breadcrumb a11y — keyboard focus ring (NAV-02, RED until 51-03)", () => {
  it("gives a linked crumb a focus-visible ring in the accent token", () => {
    render(<Breadcrumb items={ITEMS} />);
    const linked = screen.getByText("My Allocation").closest("a");
    expect(linked).not.toBeNull();
    const className = linked?.getAttribute("class") ?? "";
    // Keyboard-only ring via focus-visible (never bare focus:), in the accent
    // token — matches the MobileNav pattern (focus-visible:outline-accent) and
    // UI-SPEC §Unified Active/Hover/Focus. Accept either the ring or the
    // outline form the implementation may use, but require the focus-visible
    // keyword AND the accent token.
    expect(className).toMatch(/focus-visible:/);
    expect(className).toMatch(/accent/);
  });
});

describe("Breadcrumb a11y — unlinked non-leaf crumb (Phase 195 WR-01)", () => {
  it("gives aria-current to the last item only when a non-last item has no href", () => {
    const { container } = render(
      <Breadcrumb
        items={[{ label: "Browse" }, { label: "Crypto SMA" }]}
      />,
    );
    // Exactly one element in the nav is the current page, and it is the leaf.
    const current = container.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(screen.getByText("Crypto SMA")).toHaveAttribute("aria-current", "page");
    // The unlinked non-leaf is plain muted text: no aria-current, and not drawn
    // in the current-page style.
    const root = screen.getByText("Browse");
    expect(root).not.toHaveAttribute("aria-current");
    expect(root.className).not.toContain("font-medium");
    expect(root.className).not.toContain("text-text-primary");
  });

  it("leaf behaviour is unchanged: the last item still carries aria-current and its style", () => {
    const { container } = render(<Breadcrumb items={ITEMS} />);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
    const leaf = screen.getByText("Bridge candidate");
    expect(leaf).toHaveAttribute("aria-current", "page");
    expect(leaf.className).toContain("font-medium");
  });
});
