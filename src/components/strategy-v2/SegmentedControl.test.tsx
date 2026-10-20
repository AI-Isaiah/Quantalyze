import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

/**
 * SegmentedControl disabled-option tooltip (Phase 170.1.1 SC-2).
 *
 * The control used to invent a "Coming soon" tooltip for any disabled option
 * that did not say why it was disabled. That text claimed a roadmap promise
 * nobody made. The tooltip now exists only when a caller supplies a reason.
 */
describe("SegmentedControl — disabled option tooltip", () => {
  it("renders no title attribute for a disabled option without a disabledReason", () => {
    render(
      <SegmentedControl
        ariaLabel="Basis"
        activeId="a"
        onChange={() => {}}
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta", disabled: true },
        ]}
      />,
    );
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(beta).toHaveAttribute("aria-disabled", "true");
    expect(beta).not.toHaveAttribute("title");
  });

  it("uses the supplied disabledReason as the title", () => {
    render(
      <SegmentedControl
        ariaLabel="Basis"
        activeId="a"
        onChange={() => {}}
        options={[
          { id: "a", label: "Alpha" },
          {
            id: "b",
            label: "Beta",
            disabled: true,
            disabledReason: "Needs a mark-to-market series",
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute(
      "title",
      "Needs a mark-to-market series",
    );
  });

  it("does not call onChange when a disabled option is clicked", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Basis"
        activeId="a"
        onChange={onChange}
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta", disabled: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
