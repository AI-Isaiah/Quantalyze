import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MandateAdvancedSection } from "./MandateAdvancedSection";

describe("MandateAdvancedSection", () => {
  it("collapsed by default — body content hidden", () => {
    render(
      <MandateAdvancedSection trigger="Advanced constraints">
        <p>inside</p>
      </MandateAdvancedSection>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced constraints" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Panel div carries `hidden` attribute when collapsed.
    const body = document.getElementById("mandate-advanced-panel");
    expect(body).not.toBeNull();
    expect(body?.hasAttribute("hidden")).toBe(true);
  });

  it("clicking trigger expands the panel — aria-expanded=true and body visible", () => {
    render(
      <MandateAdvancedSection trigger="Advanced constraints">
        <p>inside</p>
      </MandateAdvancedSection>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced constraints" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const body = document.getElementById("mandate-advanced-panel");
    expect(body?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("second click collapses the panel again", () => {
    render(
      <MandateAdvancedSection trigger="Advanced constraints">
        <p>inside</p>
      </MandateAdvancedSection>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced constraints" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById("mandate-advanced-panel");
    expect(body?.hasAttribute("hidden")).toBe(true);
  });
});
