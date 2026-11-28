import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UnitSwitchChip } from "./UnitSwitchChip";
import { ReturnsUnitChip } from "./ReturnsUnitChip";
import { formatCloseDay as d } from "@/lib/factsheet/returns-unit";

/**
 * Phase 256 plan 08 (D-05, UI-SPEC D, T-256-24) - the list chip is a pure render of three closed
 * scalars. WHY these arms: the chip is the only list-row statement that a record changed unit, so
 * its sentence must come from the stored days (never a literal), and a missing or malformed scalar
 * must render nothing rather than a sentence with a guessed day.
 */
const BTC = { coin: "BTC", lastUsdDay: "2026-11-14", firstCoinDay: "2026-11-15" };

describe("UnitSwitchChip", () => {
  it("renders the compact visible text, the sr-only sentence, the title and the attribute", () => {
    const { container } = render(<UnitSwitchChip {...BTC} />);
    const chips = container.querySelectorAll("[data-unit-switch]");
    expect(chips).toHaveLength(1);
    const chip = chips[0] as HTMLElement;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.getAttribute("data-unit-switch")).toBe("BTC");
    expect(chip.textContent).toContain("USD, then BTC");
    const sr = chip.querySelector(".sr-only") as HTMLElement;
    expect(sr.textContent).toBe(`In USD to ${d("2026-11-14")}, in BTC from ${d("2026-11-15")}. `);
    expect(chip.getAttribute("title")).toBe(
      `In USD to ${d("2026-11-14")}, in BTC from ${d("2026-11-15")}. Figures on this row are in USD, with the BTC part converted at the stored daily BTC close.`,
    );
  });

  it("copies the compact ReturnsUnitChip classes byte for byte", () => {
    const unit = render(<ReturnsUnitChip unit="BTC" variant="compact" />).container.firstElementChild as HTMLElement;
    const sw = render(<UnitSwitchChip {...BTC} />).container.firstElementChild as HTMLElement;
    expect(sw.className).toBe(unit.className);
  });

  it("is neutral: no accent, amber or warning class and no inline style", () => {
    const chip = render(<UnitSwitchChip {...BTC} />).container.firstElementChild as HTMLElement;
    expect(chip.className).not.toMatch(/warning|amber|negative|accent/);
    expect(chip.getAttribute("style")).toBeNull();
  });

  it("takes the coin and the days as data: a second fixture renders its own, with no literal BTC or date", () => {
    const chip = render(
      <UnitSwitchChip coin="ETH" lastUsdDay="2026-10-02" firstCoinDay="2026-10-03" />,
    ).container.firstElementChild as HTMLElement;
    expect(chip.textContent).toContain("USD, then ETH");
    expect(chip.getAttribute("data-unit-switch")).toBe("ETH");
    expect(chip.getAttribute("title")).toContain(`In USD to ${d("2026-10-02")}, in ETH from ${d("2026-10-03")}.`);
    expect(chip.getAttribute("title")).not.toContain("BTC");
    expect(chip.getAttribute("title")).not.toContain("Nov");
  });

  it("the day order is last USD day first, first coin day second (a swap would be a false sentence)", () => {
    const chip = render(<UnitSwitchChip {...BTC} />).container.firstElementChild as HTMLElement;
    const title = chip.getAttribute("title") as string;
    expect(title.indexOf(d("2026-11-14"))).toBeLessThan(title.indexOf(d("2026-11-15")));
    expect(title).toContain(`to ${d("2026-11-14")}`);
    expect(title).toContain(`from ${d("2026-11-15")}`);
  });

  it("appends an optional className after the contract classes", () => {
    const chip = render(<UnitSwitchChip {...BTC} className="shrink-0" />).container
      .firstElementChild as HTMLElement;
    expect(chip.className.endsWith("shrink-0")).toBe(true);
  });

  it.each([
    ["no coin", { ...BTC, coin: null }],
    ["a lower-case coin", { ...BTC, coin: "btc" }],
    ["USD as the coin", { ...BTC, coin: "USD" }],
    ["no last day", { ...BTC, lastUsdDay: undefined }],
    ["no first day", { ...BTC, firstCoinDay: null }],
    ["a day that is not a day", { ...BTC, lastUsdDay: "2026-13-40" }],
    ["days that are not adjacent", { ...BTC, firstCoinDay: "2026-11-17" }],
    ["days in the wrong order", { coin: "BTC", lastUsdDay: "2026-11-15", firstCoinDay: "2026-11-14" }],
    ["markup as the coin", { ...BTC, coin: "<b>X</b>" }],
  ])("%s: zero nodes, never a sentence with a guessed day", (_label, props) => {
    const { container } = render(<UnitSwitchChip {...props} />);
    expect(container.childNodes.length).toBe(0);
  });
});
