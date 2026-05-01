/**
 * Phase 17 / Plan 17-05 / DESIGN-01 — TrustTierLabel tests (v1).
 *
 * Behaviour contract (per 17-05-PLAN.md Task 1 + 17-CONTEXT.md DESIGN-01
 * + 17-UI-SPEC.md §6 + DESIGN.md "Trust-Tier Badges" sub-section):
 *
 *   1. All three variants (api_verified / csv_uploaded / self_reported)
 *      render a token-driven outline pill with the locked structural
 *      classes from DESIGN.md (`inline-flex items-center rounded-sm
 *      border px-2 py-0.5 text-xs font-medium`) plus inline styles for
 *      `color`, `backgroundColor`, and `borderColor` sourced verbatim
 *      from `TRUST_TIER_TOKENS[variant]`.
 *   2. Each rendered span carries `data-testid="trust-tier-label"` and
 *      `data-trust-tier="<variant>"` for VR / E2E selectors.
 *   3. `null` and `undefined` still return `null` (Phase 15 v0 contract).
 *   4. Caller-provided `className` is appended via the existing `cn()`
 *      utility — call signature byte-identical to the v0 (Phase 15
 *      callers do NOT refactor — see 15-CONTEXT.md "Trust-Tier
 *      Placeholder Display").
 *   5. Named export `CSV_UPLOADED_LABEL` survives and equals the
 *      verbatim Phase 15 string "CSV uploaded — verification pending".
 *   6. Named export `TrustTier` type still importable.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  TrustTierLabel,
  CSV_UPLOADED_LABEL,
  type TrustTier,
} from "./TrustTierLabel";
import { TRUST_TIER_TOKENS } from "@/lib/design-tokens/trust-tier";

// jsdom serialises CSS hex colours as `rgb(...)`. Convert the canonical
// token hexes to that form so test assertions stay readable while still
// pinning the value to the token file.
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe("TrustTierLabel (Phase 17 / DESIGN-01 outline pill)", () => {
  const variants: ReadonlyArray<TrustTier> = [
    "api_verified",
    "csv_uploaded",
    "self_reported",
  ];

  it.each(variants)(
    "renders %s variant with token-driven colors, label, and locked classes",
    (variant) => {
      const { getByTestId } = render(
        <TrustTierLabel trustTier={variant} />,
      );
      const el = getByTestId("trust-tier-label");
      const token = TRUST_TIER_TOKENS[variant];

      // identity / DOM hooks
      expect(el.tagName).toBe("SPAN");
      expect(el.getAttribute("data-trust-tier")).toBe(variant);

      // verbatim label from the token file
      expect(el.textContent).toBe(token.label);

      // structural classes per DESIGN.md "Trust-Tier Badges" sub-section
      expect(el.className).toContain("inline-flex");
      expect(el.className).toContain("items-center");
      expect(el.className).toContain("rounded-sm");
      expect(el.className).toContain("border");
      expect(el.className).toContain("px-2");
      expect(el.className).toContain("py-0.5");
      expect(el.className).toContain("text-xs");
      expect(el.className).toContain("font-medium");

      // inline styles sourced from TRUST_TIER_TOKENS
      expect(el.style.color).toBe(hexToRgb(token.text));
      expect(el.style.backgroundColor).toBe(hexToRgb(token.fill));
      expect(el.style.borderColor).toBe(hexToRgb(token.border));
    },
  );

  it("renders the api_verified filled accent pill (#1B6B5A bg, white text)", () => {
    const { getByTestId } = render(
      <TrustTierLabel trustTier="api_verified" />,
    );
    const el = getByTestId("trust-tier-label");
    expect(el.textContent).toBe("API verified");
    expect(el.style.backgroundColor).toBe("rgb(27, 107, 90)");
    expect(el.style.color).toBe("rgb(255, 255, 255)");
    expect(el.style.borderColor).toBe("rgb(27, 107, 90)");
  });

  it("renders the csv_uploaded neutral grey outline pill (#4A5568 on white)", () => {
    const { getByTestId } = render(
      <TrustTierLabel trustTier="csv_uploaded" />,
    );
    const el = getByTestId("trust-tier-label");
    expect(el.textContent).toBe("CSV uploaded — verification pending");
    expect(el.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(el.style.color).toBe("rgb(74, 85, 104)");
    expect(el.style.borderColor).toBe("rgb(74, 85, 104)");
  });

  it("renders the self_reported warning amber outline pill (#B45309 on white)", () => {
    const { getByTestId } = render(
      <TrustTierLabel trustTier="self_reported" />,
    );
    const el = getByTestId("trust-tier-label");
    expect(el.textContent).toBe("Self-reported");
    expect(el.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(el.style.color).toBe("rgb(180, 83, 9)");
    expect(el.style.borderColor).toBe("rgb(180, 83, 9)");
  });

  it("returns null when trustTier is null (Phase 15 v0 contract preserved)", () => {
    const { container } = render(<TrustTierLabel trustTier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when trustTier is undefined (Phase 15 v0 contract preserved)", () => {
    const { container } = render(<TrustTierLabel trustTier={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("appends caller-provided className via cn() (call signature unchanged)", () => {
    const { getByTestId } = render(
      <TrustTierLabel trustTier="csv_uploaded" className="extra-class" />,
    );
    const cls = getByTestId("trust-tier-label").className;
    expect(cls).toContain("extra-class");
    // structural classes still present alongside the caller class
    expect(cls).toContain("rounded-sm");
    expect(cls).toContain("text-xs");
  });

  it("preserves CSV_UPLOADED_LABEL named export equal to the Phase 15 verbatim string", () => {
    expect(CSV_UPLOADED_LABEL).toBe("CSV uploaded — verification pending");
  });

  it("CSV_UPLOADED_LABEL stays in sync with TRUST_TIER_TOKENS.csv_uploaded.label", () => {
    expect(CSV_UPLOADED_LABEL).toBe(TRUST_TIER_TOKENS.csv_uploaded.label);
  });
});
