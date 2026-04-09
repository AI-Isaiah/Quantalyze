import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScopedBanner } from "./ScopedBanner";

describe("ScopedBanner", () => {
  it("renders title", () => {
    render(<ScopedBanner tone="accent" title="Filtered view" />);
    expect(screen.getByText("Filtered view")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<ScopedBanner tone="neutral" title="All allocators" subtitle="No filter" />);
    expect(screen.getByText("No filter")).toBeInTheDocument();
  });

  it("renders cta when provided", () => {
    render(
      <ScopedBanner
        tone="accent"
        title="Test"
        cta={<button type="button">Go</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("applies tone-specific classes", () => {
    const { container } = render(<ScopedBanner tone="warning" title="x" />);
    expect(container.firstChild).toHaveClass("border-negative");
  });
});
