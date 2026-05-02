/**
 * Phase 15 / Plan 15-03 / CSV-03 — TrustTierLabel component tests.
 *
 * Behaviour contract (per 15-03-PLAN.md Task 1 + 15-UI-SPEC.md §3 / §6 / §8.8):
 *   1. csv_uploaded variant renders the locked literal text
 *      "CSV uploaded — verification pending" inside a span. (UI-SPEC §8.8)
 *   2. api_verified / self_reported / null / undefined render NOTHING.
 *      Phase 17 / DESIGN-01 fills these in; Phase 15 ships only csv_uploaded.
 *   3. Exported `CSV_UPLOADED_LABEL` constant is the single source of truth
 *      for the literal string — Phase 17 will promote this to design tokens.
 *   4. Caller-provided className appends to the locked typography classes
 *      (text-xs text-text-muted per UI-SPEC §3).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TrustTierLabel, CSV_UPLOADED_LABEL } from "./TrustTierLabel";

describe("TrustTierLabel", () => {
  it("renders csv_uploaded variant with locked label text", () => {
    const { getByTestId } = render(<TrustTierLabel trustTier="csv_uploaded" />);
    const el = getByTestId("trust-tier-label");
    expect(el.textContent).toBe("CSV uploaded — verification pending");
    expect(el.getAttribute("data-trust-tier")).toBe("csv_uploaded");
  });

  it("renders nothing for api_verified (Phase 17 fills it)", () => {
    const { container } = render(<TrustTierLabel trustTier="api_verified" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for self_reported (Phase 17 fills it)", () => {
    const { container } = render(<TrustTierLabel trustTier="self_reported" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for null", () => {
    const { container } = render(<TrustTierLabel trustTier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for undefined", () => {
    const { container } = render(<TrustTierLabel trustTier={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("exports the CSV_UPLOADED_LABEL single-source-of-truth constant", () => {
    expect(CSV_UPLOADED_LABEL).toBe("CSV uploaded — verification pending");
  });

  it("appends caller-provided className to the locked typography classes", () => {
    const { getByTestId } = render(
      <TrustTierLabel trustTier="csv_uploaded" className="mb-1" />,
    );
    const cls = getByTestId("trust-tier-label").className;
    // UI-SPEC §3 typography lock — text-xs text-text-muted (12px / 400 / #64748B).
    expect(cls).toContain("text-xs");
    expect(cls).toContain("text-text-muted");
    expect(cls).toContain("mb-1");
  });
});
