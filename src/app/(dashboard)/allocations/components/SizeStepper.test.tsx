import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SizeStepper } from "./SizeStepper";

/**
 * M-0104 — SizeStepper shipped (S13a) without a dedicated test. It's the
 * 4-button width stepper (1/2/3/4 columns) embedded in WidgetChrome on every
 * grid tile. Contract (SizeStepper.tsx / D-01):
 *   - renders 4 buttons labelled 1..4 with aria-label "Width N of 4"
 *   - the `current` width gets aria-pressed=true (and the accent background);
 *     the others get aria-pressed=false
 *   - clicking a button fires onChange with that exact width
 *   - the group is exposed via role="group" aria-label="Widget width"
 */

describe("SizeStepper (M-0104)", () => {
  it("renders exactly 4 width buttons inside a labelled group", () => {
    render(<SizeStepper current={2} onChange={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Widget width" });
    expect(group).toBeInTheDocument();
    for (const w of [1, 2, 3, 4]) {
      expect(
        screen.getByRole("button", { name: `Width ${w} of 4` }),
      ).toBeInTheDocument();
    }
  });

  it("marks ONLY the current width as aria-pressed", () => {
    render(<SizeStepper current={3} onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Width 3 of 4" }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const w of [1, 2, 4]) {
      expect(
        screen.getByRole("button", { name: `Width ${w} of 4` }),
      ).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("the active button carries the accent background; others are transparent", () => {
    render(<SizeStepper current={1} onChange={vi.fn()} />);
    const active = screen.getByRole("button", { name: "Width 1 of 4" });
    const inactive = screen.getByRole("button", { name: "Width 4 of 4" });
    // The active background resolves to the --accent token (with fallback).
    expect(active.getAttribute("style") ?? "").toMatch(/var\(--accent/);
    expect(inactive.getAttribute("style") ?? "").toMatch(/transparent/);
  });

  it.each([1, 2, 3, 4] as const)(
    "clicking width %i fires onChange with exactly that width",
    (w) => {
      const onChange = vi.fn();
      render(<SizeStepper current={2} onChange={onChange} />);
      fireEvent.click(screen.getByRole("button", { name: `Width ${w} of 4` }));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(w);
    },
  );

  it("clicking the already-current width still fires onChange (no dedupe guard)", () => {
    const onChange = vi.fn();
    render(<SizeStepper current={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Width 2 of 4" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
