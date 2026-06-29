/**
 * STATE-05 / T-53-01 (Phase 53 Plan 01) — wizard `error.tsx` boundary contract.
 *
 * This route-level error boundary covers the server-prep gap BEFORE
 * `WizardClient` mounts (draft load / auth throw). A Server-Component throw's
 * `error.message` is the original server-side error string, so surfacing it to
 * the client is Information Disclosure (ASVS V7 / T-53-01). The boundary renders
 * the generated `digest` hash ONLY — never `error.message`.
 *
 * Mirrors the `src/app/strategy/[id]/v2/error.test.tsx` precedent.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} data-testid="next-link">
      {children}
    </a>
  ),
}));

import WizardError from "./error";

describe("wizard error.tsx — STATE-05 / T-53-01 boundary contract", () => {
  it("renders heading + body copy + a Try again CTA", () => {
    const err = Object.assign(new Error("server-prep boom"), { digest: "d-1" });
    render(<WizardError error={err} unstable_retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeTruthy();
  });

  it("Try again button invokes unstable_retry() once", async () => {
    const retry = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "d-2" });
    render(<WizardError error={err} unstable_retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the digest as Error ID when present", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc-123" });
    render(<WizardError error={err} unstable_retry={vi.fn()} />);

    expect(screen.getByText(/error id: abc-123/i)).toBeTruthy();
  });

  it("never renders error.message in the DOM (Information Disclosure)", () => {
    const secret = "INTERNAL-PG-ERROR-leaked-secret";
    const err = Object.assign(new Error(secret), { digest: "d-3" });
    const { container } = render(
      <WizardError error={err} unstable_retry={vi.fn()} />,
    );

    expect(container.textContent).not.toContain(secret);
  });

  it("links the fallback to the strategies list", () => {
    const err = new Error("boom");
    render(<WizardError error={err} unstable_retry={vi.fn()} />);

    const link = screen.getByTestId("next-link");
    expect(link.getAttribute("href")).toBe("/strategies");
  });
});
