import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveRegion } from "./LiveRegion";

/**
 * `<LiveRegion>` — two-polarity unit test, following the discipline of
 * `src/lib/seam-ssr-exposure.pin.test.ts:237-246`: assert BOTH polarities, not
 * just the one the caller happens to want. A test that only checked
 * `role="alert"` would pass on a component that hard-codes it and ignores its
 * `assertive` prop — which is precisely the component a future "simplification"
 * produces.
 *
 * The third case is the load-bearing NEGATIVE. This primitive is adopted at
 * three surfaces *because* it is visually inert; the whole reason it needs no
 * `DESIGN.md` decision is that it renders nothing a sighted user can see. That
 * property is not self-evident from the source and nothing else in the tree
 * enforces it, so it is pinned by name here.
 */
describe("<LiveRegion>", () => {
  it("assertive ⇒ role=alert + aria-live=assertive, carrying the message", () => {
    render(<LiveRegion message="Optimizer failed" assertive />);

    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveTextContent("Optimizer failed");
    // The polite polarity must be ABSENT, or the component is announcing twice.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("non-assertive ⇒ role=status + aria-live=polite, carrying the message", () => {
    render(<LiveRegion message="Weights applied to your draft" />);

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Weights applied to your draft");
    // The assertive polarity must be ABSENT. Without this the two cases above
    // are both satisfied by a component that renders one node of each role.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is VISUALLY INERT — className is exactly `sr-only`, in both polarities", () => {
    // The named inertness case (Falsifiability Ledger row M107).
    //
    // ⚠️ Asserting EQUALITY, not `toContain("sr-only")`. A containment check
    // passes on `class="sr-only text-negative"` — i.e. on a primitive that has
    // silently acquired a visual contract across all three of its adoption
    // surfaces at once, with no DESIGN.md decision behind it. So does a
    // `grep -c 'className="sr-only"' → 1` receipt. Equality is the only form
    // that reddens.
    const { unmount } = render(<LiveRegion message="x" assertive />);
    expect(screen.getByRole("alert").getAttribute("class")).toBe("sr-only");
    unmount();

    render(<LiveRegion message="x" />);
    expect(screen.getByRole("status").getAttribute("class")).toBe("sr-only");
  });

  it("renders the region even when the message is null", () => {
    // An empty live region that is PRESENT before its text arrives is what
    // makes assistive tech announce the *change*. A region mounted at the same
    // moment as its content is frequently missed entirely, which would make the
    // whole primitive a no-op on the very surfaces it exists to serve.
    render(<LiveRegion message={null} assertive />);

    const region = screen.getByRole("alert");
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("");
  });
});
