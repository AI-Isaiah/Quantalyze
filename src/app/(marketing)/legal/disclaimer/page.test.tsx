/**
 * Phase 201 PLAINWORDS plan 05 (D-14) — the Risk Disclaimer page's rendered text.
 *
 * THE DEFECT. The "Custody and platform scope" paragraph once ended a line on
 * `does <strong>not</strong>` and began the next on `operate a fund`. JSX trims a
 * text line that starts after a newline against the preceding element, so the
 * page rendered "notoperate": a legal sentence that read as one malformed word.
 * A source-level check cannot see this, because the join exists only after JSX
 * whitespace rules run, so this test reads the RENDERED text.
 *
 * Plan 201-35 (F-11, D-11, review R3-01 item 7): the "Last updated" line prints through the one
 * date helper ("Apr 7, 2026"), and the page text carries no YYYY-MM-DD day.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import RiskDisclaimerPage from "./page";

describe("Risk Disclaimer page (D-14)", () => {
  it("renders the custody sentence with a space between 'not' and 'operate'", () => {
    const { container } = render(<RiskDisclaimerPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(
      "does not operate a fund, act as a broker-dealer, or execute trades on your behalf.",
    );
    expect(text).not.toContain("notoperate");
  });

  it("keeps the first custody sentence intact", () => {
    const { container } = render(<RiskDisclaimerPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("does not hold client assets.");
    expect(text).toContain("via read-only exchange APIs.");
  });

  it("prints its Last updated day in the helper's form, never an ISO day (F-11)", () => {
    const { container } = render(<RiskDisclaimerPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Last updated: Apr 7, 2026");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
