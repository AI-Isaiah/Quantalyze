import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Disclaimer } from "./Disclaimer";

describe("Disclaimer", () => {
  it("renders footer variant by default", () => {
    render(<Disclaimer />);
    expect(screen.getByText(/not financial advice/i)).toBeDefined();
  });

  it("renders strategy variant", () => {
    render(<Disclaimer variant="strategy" />);
    expect(screen.getByText(/data verified from exchange api/i)).toBeDefined();
  });

  it("renders factsheet variant", () => {
    render(<Disclaimer variant="factsheet" />);
    expect(screen.getByText(/informational purposes only/i)).toBeDefined();
  });

  it("applies footer-specific styles", () => {
    const { container } = render(<Disclaimer variant="footer" />);
    const el = container.querySelector("p");
    expect(el?.className).toContain("text-center");
    expect(el?.className).toContain("border-t");
  });

  it("applies custom className", () => {
    const { container } = render(<Disclaimer className="custom-class" />);
    const el = container.querySelector("p");
    expect(el?.className).toContain("custom-class");
  });
});
