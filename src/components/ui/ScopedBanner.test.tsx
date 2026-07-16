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

  it("applies tone-specific classes (full-border envelope, no left stripe)", () => {
    const { container } = render(<ScopedBanner tone="warning" title="x" />);
    expect(container.firstChild).toHaveClass("border-negative/30");
    expect(container.firstChild).toHaveClass("rounded-md");
    expect(container.firstChild).not.toHaveClass("border-l-4");
  });

  it("H-0408: does not truncate the title — trust-critical scope tags must be shown in full", () => {
    // A long partner scope tag must never be silently ellipsed: the banner
    // promises full scope identification. The title element must not carry the
    // `truncate` utility (overflow-hidden + nowrap + ellipsis); it should wrap.
    const longTag = "acme-capital-management-pilot-program-2026-cohort-3";
    render(<ScopedBanner tone="accent" title={longTag} />);
    const titleEl = screen.getByText(longTag);
    expect(titleEl).not.toHaveClass("truncate");
    expect(titleEl).toHaveClass("break-words");
  });
});
