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

  // Phase 164.6.6.2.1 plan 05: the masthead DOM is a recorded literal, captured
  // BEFORE the `variant` prop existed, so adding the compact variant cannot
  // move a byte of what the factsheet masthead / tear sheet / composer render.
  it("masthead DOM is byte-identical to the pre-variant build (default and explicit)", () => {
    const recorded =
      '<span class="inline-flex items-center rounded-sm bg-track px-2 py-0.5 text-micro font-mono uppercase tracking-[0.14em] text-text-secondary whitespace-nowrap" data-returns-unit="BTC" title="This account is denominated in BTC. Its returns, drawdowns and balances are measured in BTC, not USD.">Returns in BTC</span>';
    expect(render(<ReturnsUnitChip unit="BTC" />).container.innerHTML).toBe(recorded);
    expect(render(<ReturnsUnitChip unit="BTC" variant="masthead" />).container.innerHTML).toBe(recorded);
  });

  describe("variant compact", () => {
    it("renders the UI-SPEC D chip: visible `in BTC`, accessible `Returns in BTC`, title, classes", () => {
      const { container } = render(<ReturnsUnitChip unit="BTC" variant="compact" />);
      const chips = container.querySelectorAll("[data-returns-unit]");
      expect(chips.length).toBe(1);
      const chip = chips[0] as HTMLElement;
      expect(chip.tagName).toBe("SPAN");
      expect(chip.getAttribute("data-returns-unit")).toBe("BTC");
      expect(chip.getAttribute("title")).toBe("Returns on this row are in BTC, not USD.");
      expect(chip.className).toBe(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide whitespace-nowrap text-text-secondary bg-track",
      );
      expect(container.innerHTML).toBe(
        '<span class="inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide whitespace-nowrap text-text-secondary bg-track" data-returns-unit="BTC" title="Returns on this row are in BTC, not USD."><span class="sr-only">Returns </span>in BTC</span>',
      );
      // Accessible name is `Returns in BTC`; the sr-only prefix is the only hidden part.
      expect(chip.textContent).toBe("Returns in BTC");
      expect(chip.querySelector(".sr-only")?.textContent).toBe("Returns ");
    });

    it("renders nothing for a null unit", () => {
      const { container } = render(<ReturnsUnitChip unit={null} variant="compact" />);
      expect(container.childNodes.length).toBe(0);
    });

    it("takes the unit as a parameter and has no icon, border or shadow", () => {
      const { container } = render(<ReturnsUnitChip unit="ETH" variant="compact" />);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.textContent).toBe("Returns in ETH");
      expect(chip.getAttribute("title")).toBe("Returns on this row are in ETH, not USD.");
      expect(chip.className).not.toMatch(/border|shadow/);
      expect(chip.querySelector("svg")).toBeNull();
    });

    it("appends an optional className after the contract classes", () => {
      const { container } = render(<ReturnsUnitChip unit="BTC" variant="compact" className="shrink-0" />);
      expect((container.firstElementChild as HTMLElement).className.endsWith(" shrink-0")).toBe(true);
    });
  });
});
