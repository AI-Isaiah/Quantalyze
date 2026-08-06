/**
 * Phase 150 / Plan 150-02 / OWN-03 — the ownership mark tag.
 *
 * Why this is a SEPARATE component and not a `Badge` variant: `Badge.tsx:55`
 * resolves status ink as `statusMap[label] ?? statusMap.draft`, so an ownership
 * value routed through it would render a trusted-looking DRAFT badge for any
 * unrecognised mark (threat T-150-08 — UI spoofing). This component has no
 * fallback: it renders exactly three outcomes, one of which is nothing.
 *
 * The class strings below are typed in as LITERALS, matching the 150-UI-SPEC
 * family table byte-for-byte — the anatomy is deliberately shared with the
 * Badge family (`rounded-md`, persistent owner-declared attribute) and identity
 * is carried by INK alone, so a drift in either half must redden here.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OwnershipTag } from "./OwnershipTag";

const ANATOMY =
  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium";

describe("OwnershipTag", () => {
  it("renders the ACCENT tag for own_capital — the mark that unlocks allocation", () => {
    const { container } = render(<OwnershipTag mark="own_capital" />);
    const tag = screen.getByText("Own capital");
    expect(tag).toBeInTheDocument();
    for (const cls of ANATOMY.split(" ")) {
      expect(tag).toHaveClass(cls);
    }
    expect(tag).toHaveClass("bg-accent/10");
    expect(tag).toHaveClass("text-accent");
    expect(container.textContent).toBe("Own capital");
  });

  it("renders the MUTED tag for team_review — a neutral fact, never an error", () => {
    const { container } = render(<OwnershipTag mark="team_review" />);
    const tag = screen.getByText("Team review");
    expect(tag).toBeInTheDocument();
    for (const cls of ANATOMY.split(" ")) {
      expect(tag).toHaveClass(cls);
    }
    expect(tag).toHaveClass("bg-badge-other/10");
    expect(tag).toHaveClass("text-text-muted");
    // Semantic-color gate: absence of allocatability is not an error state.
    expect(tag.className).not.toMatch(/negative|warning|amber/);
  });

  it("renders NOTHING for null — an unmarked legacy row gets no tag", () => {
    const { container } = render(<OwnershipTag mark={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Own capital")).toBeNull();
    expect(screen.queryByText("Team review")).toBeNull();
    // Specifically NOT the Badge draft-fallback (threat T-150-08).
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("renders NOTHING for undefined — an absent field is not a default mark", () => {
    const { container } = render(<OwnershipTag mark={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("never renders a fallback badge for an unknown mark value", () => {
    // The DB column is `text`; a future/garbled value must render as absence,
    // not as a trusted-looking badge.
    const { container } = render(
      <OwnershipTag mark={"house_capital" as never} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText("house_capital")).toBeNull();
  });

  it("does not reach for Badge's statusMap (negative source pin)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/strategy/OwnershipTag.tsx"),
      "utf8",
    );
    expect(source).not.toContain("statusMap");
    expect(source).not.toContain("DATA_STATE_CHIP");
  });
});
