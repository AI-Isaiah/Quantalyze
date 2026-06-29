/**
 * STATE-05 (Phase 53 Plan 01) — wizard `loading.tsx` Suspense-fallback contract.
 *
 * The wizard route does server-prep (draft load + auth) in `page.tsx` before
 * `WizardClient` hydrates. Without a route-level `loading.tsx`, the segment
 * flashes blank during that gap. This fallback renders a `WizardChrome`-shaped
 * skeleton (stepper-rail placeholder + first-step field block) so the layout is
 * stable and a screen reader is told the route is loading.
 *
 * Skeleton has no logic, so a smoke render + the liveness/anchor assertions are
 * sufficient for the coverage gate.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import WizardLoading from "./loading";

describe("wizard loading.tsx — STATE-05 fallback contract", () => {
  it("renders an sr-only role=status liveness node", () => {
    render(<WizardLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/loading/i);
  });

  it("renders the WizardChrome-shaped skeleton at the wizard measure", () => {
    const { container } = render(<WizardLoading />);
    // The shell wrapper carries the WizardChrome measure (mx-auto max-w-3xl).
    const shell = container.querySelector(".max-w-3xl");
    expect(shell).toBeTruthy();
    // A single shell-level animate-pulse is the sanctioned idiom.
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders the stepper-rail anchor with one cell per DEFAULT_STEPS step (5)", () => {
    const { container } = render(<WizardLoading />);
    const rail = container.querySelector('[data-testid="wizard-skeleton-rail"]');
    expect(rail).toBeTruthy();
    // IN-05: the skeleton must mirror the now-5-step DEFAULT_STEPS exactly, so
    // the rail does not shift by a column when WizardClient mounts. Pin the
    // count to 5 (not >= 4) so a future step-count change re-fails this test.
    expect(rail!.children.length).toBe(5);
  });
});
