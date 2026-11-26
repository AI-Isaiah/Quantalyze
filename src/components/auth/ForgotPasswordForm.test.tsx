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
  // PROD 2026-11-26 follow-up (F4): the form dropped resetPasswordForEmail's
  // error, so a network failure still said "we sent a reset link" and nothing
  // was logged. Only failures that happen BEFORE Auth looks the email up may
  // show a retry message: a network failure (status 0) and the per-IP
  // over_request_rate_limit. Auth answers an unknown email with 200, so a
  // per-user email limit or a send failure (5xx) only reaches a real account;
  // a retry message there would reveal the account exists, so those keep the
  // neutral copy. Every failure is logged with code and status, never the email.
  async function submitWithError(status: number, code: string | undefined) {
    resetPasswordForEmailMock.mockResolvedValueOnce({
      data: null,
      error: { message: "raw auth text", name: "AuthApiError", status, code },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<ForgotPasswordForm />);
    const email = view.container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: "someone@example.test" } });
    fireEvent.click(view.getByText("Send reset link"));
    return { ...view, spy };
  }

  it.each([
    [0, undefined],
    [429, "over_request_rate_limit"],
  ])("F4: status %s (%s) shows the retry message and logs code and status", async (status, code) => {
    const { container, spy } = await submitWithError(status, code);
    await waitFor(() => {
      expect(container.textContent).toContain(
        "We could not send a reset link right now. Please try again in a few minutes.",
      );
    });
    expect(container.textContent).not.toMatch(/we sent a reset link/i);
    expect(container.textContent).not.toContain("raw auth text");
    expect(spy).toHaveBeenCalledWith("[forgot-password] reset request failed:", code ?? "unknown", status);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("someone@example.test");
    spy.mockRestore();
  });

  it.each([
    [429, "over_email_send_rate_limit"],
    [500, "unexpected_failure"],
  ])("F4: status %s (%s) only reaches a real account, so it keeps the neutral copy but is logged", async (status, code) => {
    const { container, spy } = await submitWithError(status, code);
    await waitFor(() => {
      expect(container.textContent).toMatch(/if an account exists for that email, we sent a reset link/i);
    });
    expect(container.textContent).not.toContain("We could not send a reset link right now");
    expect(spy).toHaveBeenCalledWith("[forgot-password] reset request failed:", code, status);
    spy.mockRestore();
  });
  // SFH round 2: a failure that reached Auth is sent to Sentry (code and
  // status only) so an operator sees it; a network failure is not.
  it("F4: a 500 is captured to Sentry with code and status and no email; status 0 is not", async () => {
    const a = await submitWithError(500, "unexpected_failure");
    await waitFor(() => expect(captureMessageMock).toHaveBeenCalledTimes(1));
    expect(captureMessageMock).toHaveBeenCalledWith("ForgotPasswordForm: resetPasswordForEmail failed", {
      level: "warning",
      tags: { reset_request_code: "unexpected_failure", reset_request_status: "500" },
    });
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain("someone@example.test");
    a.spy.mockRestore();
    a.unmount();
    captureMessageMock.mockClear();
    const b = await submitWithError(0, undefined);
    await waitFor(() => expect(b.container.textContent).toContain("We could not send a reset link right now"));
    await new Promise((r) => setTimeout(r, 20));
    expect(captureMessageMock).not.toHaveBeenCalled();
    b.spy.mockRestore();
  });
});

const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: captureMessageMock }));
