/**
 * STATE-05 / T-53-09 — `(dashboard)/admin/error.tsx` boundary contract.
 *
 * Admin is the highest-sensitivity in-scope surface. The boundary must surface
 * the digest ONLY and NEVER the thrown `error.message` (RSC Information
 * Disclosure, ASVS V7). The coverage ratchet is a blocking CI gate, so this
 * render test ships in the same change as the boundary.
 *
 * Tests:
 *  1. heading + body copy render
 *  2. "Try again" invokes unstable_retry() exactly once
 *  3. digest renders only when present
 *  4. the thrown error.message is NEVER rendered (info-leak guard)
 *  5. console.error fires with the per-surface tag on mount
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import AdminError from "./error";

afterEach(() => cleanup());

describe("(dashboard)/admin/error.tsx — digest-only boundary", () => {
  it("renders heading + body copy", () => {
    const err = Object.assign(new Error("boom"), { digest: "d-1" });
    render(<AdminError error={err} unstable_retry={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/this section encountered an error/i),
    ).toBeTruthy();
  });

  it("retry button invokes unstable_retry() exactly once", () => {
    const retry = vi.fn();
    render(<AdminError error={new Error("boom")} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the digest when present", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc-123" });
    render(<AdminError error={err} unstable_retry={vi.fn()} />);
    expect(screen.getByText(/error id: abc-123/i)).toBeTruthy();
  });

  it("omits the Error ID line when no digest exists", () => {
    render(<AdminError error={new Error("boom")} unstable_retry={vi.fn()} />);
    expect(screen.queryByText(/error id:/i)).toBeNull();
  });

  it("NEVER renders the thrown error.message (info-leak guard, T-53-09)", () => {
    const secret = "DB connection string leaked at host db.internal:5432";
    const err = Object.assign(new Error(secret), { digest: "d-leak" });
    const { container } = render(
      <AdminError error={err} unstable_retry={vi.fn()} />,
    );
    expect(container.textContent).not.toContain(secret);
    expect(screen.queryByText(secret)).toBeNull();
  });

  it("logs to console.error with the [admin-error] tag on mount", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("paint failed"), { digest: "d-5" });
    render(<AdminError error={err} unstable_retry={vi.fn()} />);
    expect(spy).toHaveBeenCalledWith("[admin-error]", err);
    spy.mockRestore();
  });
});
