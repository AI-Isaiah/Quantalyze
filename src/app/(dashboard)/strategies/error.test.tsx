/**
 * STATE-05 / T-53-01 (Phase 53 Plan 01) — strategies-list `error.tsx` contract.
 *
 * The strategies list route had a `loading.tsx` but no `error.tsx`. This
 * route-level boundary catches a throw from the list page's server-fetch and
 * renders the standard digest-only fallback. A Server-Component throw's
 * `error.message` is the original server-side error string, so surfacing it to
 * the client is Information Disclosure (ASVS V7 / T-53-01) — render the `digest`
 * hash ONLY.
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

import StrategiesError from "./error";

describe("strategies error.tsx — STATE-05 / T-53-01 boundary contract", () => {
  it("renders heading + body copy + a Try again CTA", () => {
    const err = Object.assign(new Error("list fetch boom"), { digest: "d-1" });
    render(<StrategiesError error={err} unstable_retry={vi.fn()} />);

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
    render(<StrategiesError error={err} unstable_retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the digest as Error ID when present", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc-123" });
    render(<StrategiesError error={err} unstable_retry={vi.fn()} />);

    expect(screen.getByText(/error id: abc-123/i)).toBeTruthy();
  });

  it("never renders error.message in the DOM (Information Disclosure)", () => {
    const secret = "INTERNAL-PG-ERROR-leaked-secret";
    const err = Object.assign(new Error(secret), { digest: "d-3" });
    const { container } = render(
      <StrategiesError error={err} unstable_retry={vi.fn()} />,
    );

    expect(container.textContent).not.toContain(secret);
  });

  it("logs to console.error with the [strategies-error] tag on mount", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("list fetch boom"), { digest: "d-4" });
    render(<StrategiesError error={err} unstable_retry={vi.fn()} />);
    expect(spy).toHaveBeenCalledWith("[strategies-error]", err);
    spy.mockRestore();
  });
});
