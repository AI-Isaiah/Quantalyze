import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * ForgotPasswordForm — enumeration-safety contract.
 *
 * The form MUST show the same neutral copy whether Supabase succeeds or
 * errors. Any branching of UI on the success/failure result leaks which
 * emails are registered.
 */

const resetPasswordForEmailMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  }),
}));

import { ForgotPasswordForm } from "./ForgotPasswordForm";

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    resetPasswordForEmailMock.mockReset();
  });

  it("calls resetPasswordForEmail with redirectTo pointing at /auth/callback?next=/reset-password", async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ data: {}, error: null });
    const { container, getByText } = render(<ForgotPasswordForm />);
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: "user@example.test" } });
    fireEvent.click(getByText("Send reset link"));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalledOnce());
    const [calledEmail, opts] = resetPasswordForEmailMock.mock.calls[0];
    expect(calledEmail).toBe("user@example.test");
    expect(opts.redirectTo).toMatch(/\/auth\/callback\?next=\/reset-password$/);
  });

  it("shows the neutral success message after a successful submit", async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ data: {}, error: null });
    const { container, getByText } = render(<ForgotPasswordForm />);
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: "user@example.test" } });
    fireEvent.click(getByText("Send reset link"));

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /if an account exists for that email, we sent a reset link/i,
      );
    });
  });

  it("shows the SAME neutral copy when Supabase returns an error (enumeration safety)", async () => {
    // Even if Supabase surfaced "User not found" or rate-limit errors, the
    // form MUST NOT reveal that to the caller — same copy as success.
    resetPasswordForEmailMock.mockResolvedValueOnce({
      data: null,
      error: { message: "User not found", name: "AuthApiError", status: 404 },
    });
    const { container, getByText } = render(<ForgotPasswordForm />);
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: "unknown@example.test" } });
    fireEvent.click(getByText("Send reset link"));

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /if an account exists for that email, we sent a reset link/i,
      );
    });
    // Critically: the raw Supabase error message must NOT appear in the DOM.
    expect(container.textContent).not.toMatch(/user not found/i);
  });
});
