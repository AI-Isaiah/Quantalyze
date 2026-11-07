import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Disclaimer, ANALYTICS_ONLY_TEXT } from "./Disclaimer";

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

  // Phase 195 / D-09 — the one combined block on /browse/<cat>/<id>. Sentences
  // are pinned as LITERALS (not imported constants): a test that reads the
  // constants cannot fail when a legally required sentence is dropped from them.
  describe("strategy-page variant (D-09, T-195-09)", () => {
    const MONITORING = "Strategy monitored via read-only exchange API.";
    const CUSTODY_CORE =
      "Manager retains asset custody. Quantalyze provides analytics only — no pooling, no fund administration, no custody of client assets.";
    const CUSTODY = `${MONITORING} ${CUSTODY_CORE}`;
    const GENERAL =
      "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.";
    const PROVENANCE = {
      api_verified:
        "Data verified from exchange API. Quantalyze does not independently audit trading strategies.",
      csv_uploaded:
        "Performance data uploaded by the manager as a daily-return series and not independently verified by Quantalyze or by an exchange API.",
      self_reported:
        "Performance data is self-reported by the manager and not independently verified by Quantalyze.",
    } as const;

    it("api_verified renders the UI-SPEC S-5 paragraph verbatim", () => {
      const { container } = render(
        <Disclaimer variant="strategy-page" trustTier="api_verified" />,
      );
      expect(container.querySelector("p")?.textContent).toBe(
        `${CUSTODY} ${PROVENANCE.api_verified} ${GENERAL}`,
      );
      expect(container.textContent).toContain("Data verified from exchange API.");
    });

    it("csv_uploaded does NOT claim exchange-API monitoring, and keeps custody + its own provenance (WR-01)", () => {
      const { container } = render(
        <Disclaimer variant="strategy-page" trustTier="csv_uploaded" />,
      );
      const text = container.querySelector("p")?.textContent;
      expect(text).toBe(`${CUSTODY_CORE} ${PROVENANCE.csv_uploaded} ${GENERAL}`);
      expect(text).not.toContain("monitored via read-only exchange API");
      expect(text).toContain("Manager retains asset custody.");
      expect(text).toContain(PROVENANCE.csv_uploaded);
    });

    it("self_reported and a missing tier do NOT claim exchange-API monitoring either (WR-01)", () => {
      for (const tier of ["self_reported", undefined, null] as const) {
        const { container, unmount } = render(
          <Disclaimer variant="strategy-page" trustTier={tier} />,
        );
        const text = container.querySelector("p")?.textContent;
        expect(text).toBe(`${CUSTODY_CORE} ${PROVENANCE.self_reported} ${GENERAL}`);
        expect(text).not.toContain("monitored via read-only exchange API");
        expect(text).toContain("Manager retains asset custody.");
        unmount();
      }
    });

    it("carries every legally required sentence exactly once for its tier", () => {
      const sentences = [
        "Manager retains asset custody.",
        "Quantalyze provides analytics only — no pooling, no fund administration, no custody of client assets.",
        "Not financial advice.",
        "Past performance does not guarantee future results.",
        "Cryptocurrency trading involves substantial risk of loss.",
      ];
      for (const tier of ["api_verified", "csv_uploaded", "self_reported"] as const) {
        const { container, unmount } = render(
          <Disclaimer variant="strategy-page" trustTier={tier} />,
        );
        const text = container.textContent ?? "";
        // The monitoring sentence is true of api_verified only (WR-01).
        const required =
          tier === "api_verified" ? [MONITORING, ...sentences] : sentences;
        for (const sentence of [...required, PROVENANCE[tier]]) {
          expect(text.split(sentence).length - 1, `${tier}: ${sentence}`).toBe(1);
        }
        unmount();
      }
    });

    it("drops only the duplicate 'is not indicative of' sentence", () => {
      const { container } = render(
        <Disclaimer variant="strategy-page" trustTier="api_verified" />,
      );
      expect(container.textContent).not.toContain("is not indicative of future results");
    });

    it("uses the footer frame classes", () => {
      const { container } = render(
        <Disclaimer variant="strategy-page" trustTier="api_verified" />,
      );
      const cls = container.querySelector("p")?.className ?? "";
      for (const c of ["text-center", "py-6", "border-t", "border-border", "mt-12"]) {
        expect(cls).toContain(c);
      }
    });
  });

  it("exports the analytics-only sentence, which the custody variant still contains verbatim", () => {
    expect(ANALYTICS_ONLY_TEXT).toBe(
      "Quantalyze provides analytics only — no pooling, no fund administration, no custody of client assets.",
    );
    const { container } = render(<Disclaimer variant="custody" />);
    expect(container.querySelector("p")?.textContent).toBe(
      `Strategy monitored via read-only exchange API. Manager retains asset custody. ${ANALYTICS_ONLY_TEXT}`,
    );
  });
});
