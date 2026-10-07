import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReturnsUnitChip } from "./ReturnsUnitChip";

/**
 * Phase 164.6.6.2 plan 05 (D-09, UI-SPEC "The unit chip") — the chip is a pure
 * render keyed on ONE value. `null` is the USD family: zero nodes, so a USD
 * surface cannot differ from the pre-phase build by even a comment node.
 */
describe("ReturnsUnitChip", () => {
  it("renders zero nodes for a null unit", () => {
    const { container } = render(<ReturnsUnitChip unit={null} />);
    expect(container.childNodes.length).toBe(0);
  });

  it("renders one neutral span carrying the UI-SPEC copy, attribute, title and classes", () => {
    const { container } = render(<ReturnsUnitChip unit="BTC" />);
    const chips = container.querySelectorAll("[data-returns-unit]");
    expect(chips.length).toBe(1);
    const chip = chips[0] as HTMLElement;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.getAttribute("data-returns-unit")).toBe("BTC");
    // DOM text, not the CSS-uppercased form.
    expect(chip.textContent).toBe("Returns in BTC");
    expect(chip.getAttribute("title")).toBe(
      "This account is denominated in BTC. Its returns, drawdowns and balances are measured in BTC, not USD.",
    );
    expect(chip.className).toBe(
      "inline-flex items-center rounded-sm bg-track px-2 py-0.5 text-micro font-mono uppercase tracking-[0.14em] text-text-secondary whitespace-nowrap",
    );
  });

  it("is neutral, never amber: no warning colour class or inline style", () => {
    const { container } = render(<ReturnsUnitChip unit="BTC" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).not.toMatch(/warning|amber|negative|accent/);
    expect(chip.getAttribute("style")).toBeNull();
  });

  it("takes the unit as a parameter: ETH reads Returns in ETH, with no hard-coded BTC", () => {
    const { container } = render(<ReturnsUnitChip unit="ETH" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe("Returns in ETH");
    expect(chip.getAttribute("data-returns-unit")).toBe("ETH");
    expect(chip.getAttribute("title")).toContain("denominated in ETH");
    expect(chip.getAttribute("title")).not.toContain("BTC");
  });

  it("appends an optional className through cn() after the contract classes", () => {
    const { container } = render(<ReturnsUnitChip unit="BTC" className="shrink-0" />);
    expect((container.firstElementChild as HTMLElement).className.endsWith(" shrink-0")).toBe(true);
  });
});
