import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Disclaimer } from "./Disclaimer";

describe("Disclaimer", () => {
  it("renders footer variant by default", () => {
    render(<Disclaimer />);
    expect(screen.getByText(/not financial advice/i)).toBeDefined();
  });

  it("strategy variant: api_verified claims exchange-API verification", () => {
    render(<Disclaimer variant="strategy" trustTier="api_verified" />);
    expect(screen.getByText(/data verified from exchange api/i)).toBeDefined();
  });

  it("strategy variant: csv_uploaded never claims exchange-API verification", () => {
    render(<Disclaimer variant="strategy" trustTier="csv_uploaded" />);
    expect(
      screen.getByText(/uploaded by the manager as a daily-return series/i),
    ).toBeDefined();
    expect(screen.queryByText(/data verified from exchange api/i)).toBeNull();
  });

  it("strategy variant: self_reported is honest about provenance", () => {
    render(<Disclaimer variant="strategy" trustTier="self_reported" />);
    expect(screen.getByText(/self-reported by the manager/i)).toBeDefined();
    expect(screen.queryByText(/data verified from exchange api/i)).toBeNull();
  });

  it("strategy variant: missing trustTier defaults to self_reported (no invented claim)", () => {
    render(<Disclaimer variant="strategy" />);
    expect(screen.getByText(/self-reported by the manager/i)).toBeDefined();
    expect(screen.queryByText(/data verified from exchange api/i)).toBeNull();
  });

  it("factsheet variant: keeps preamble + adds tier-aware provenance for csv_uploaded", () => {
    render(<Disclaimer variant="factsheet" trustTier="csv_uploaded" />);
    expect(screen.getByText(/informational purposes only/i)).toBeDefined();
    expect(
      screen.getByText(/uploaded by the manager as a daily-return series/i),
    ).toBeDefined();
  });

  it("factsheet variant: api_verified keeps the exchange-API claim", () => {
    render(<Disclaimer variant="factsheet" trustTier="api_verified" />);
    expect(screen.getByText(/data verified from exchange api/i)).toBeDefined();
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
