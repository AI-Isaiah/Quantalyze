import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * ResetPasswordForm — client validation + success/error path contract.
 */

const updateUserMock = vi.fn();
const reauthenticateMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      updateUser: updateUserMock,
      reauthenticate: reauthenticateMock,
    },
  }),
}));

import { ResetPasswordForm } from "./ResetPasswordForm";

function getInputs(container: HTMLElement) {
  return {
    pw: container.querySelector('input[name="password"]') as HTMLInputElement,
    confirm: container.querySelector(
      'input[name="confirm_password"]',
    ) as HTMLInputElement,
  };
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    updateUserMock.mockReset();
    reauthenticateMock.mockReset();
    pushMock.mockReset();
  });

  it("rejects mismatched passwords client-side without calling updateUser", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "abcdef" } });
    fireEvent.change(confirm, { target: { value: "abcdeg" } });
    fireEvent.click(getByText("Update password"));

    await new Promise((r) => setTimeout(r, 0));
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/passwords do not match/i);
  });

  it("calls updateUser with the new password and navigates a signed-in user to the Account tab on success", async () => {
    updateUserMock.mockResolvedValueOnce({ data: { user: {} }, error: null });
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledOnce());
    expect(updateUserMock.mock.calls[0][0]).toEqual({ password: "supersecret" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/profile?tab=account&password_set=1"));
    // R3 (GD-07): the recovery-link happy path never meets the reauth prompt.
    expect(reauthenticateMock).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="reauth_code"]')).toBeNull();
  });

  it("surfaces a non-session Supabase error.message into the form", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "New password should be different from the old password.",
        name: "AuthApiError",
        status: 422,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /new password should be different from the old password/i,
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
  // GD-07: with "Secure password change" ON, a session older than 24 h is
  // refused until a nonce from reauthenticate() rides along with the password.
  const REAUTH_NEEDED = {
    data: null,
    error: {
      name: "AuthApiError",
      status: 401,
      code: "reauthentication_needed",
      message: "Step-up required",
    },
  };
  const SENT_OK = { data: { user: null, session: null }, error: null };

  function fillPasswords(container: HTMLElement, value = "supersecret") {
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value } });
    fireEvent.change(confirm, { target: { value } });
  }

  function codeInput(container: HTMLElement) {
    return container.querySelector(
      'input[name="reauth_code"]',
    ) as HTMLInputElement | null;
  }

  async function reachCodeStep(container: HTMLElement, getByText: (t: string) => HTMLElement) {
    updateUserMock.mockResolvedValueOnce(REAUTH_NEEDED);
    reauthenticateMock.mockResolvedValueOnce(SENT_OK);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));
    await waitFor(() => expect(codeInput(container)).not.toBeNull());
  }

  it("R1: a reauthentication refusal sends a code and shows the code input", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);

    expect(reauthenticateMock).toHaveBeenCalledOnce();
    const input = codeInput(container)!;
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(container.textContent).toContain(
      "For your security, we sent a code to your email. Enter it below to set your password.",
    );
    expect(container.textContent).not.toContain("Step-up required");
    expect(pushMock).not.toHaveBeenCalled();
    const { pw, confirm } = getInputs(container);
    expect(pw.value).toBe("supersecret");
    expect(confirm.value).toBe("supersecret");
  });

  // GR1-MD-02: no user in the updateUser answer means nobody is signed in, so
  // the login page (and its reset note) is reachable and stays the destination.
  it("GR1-MD-02: a signed-out success still goes to /login?reset=1", async () => {
    updateUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login?reset=1"));
  });

  it("R2: the code is trimmed and retried as the nonce, then navigates on success", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);

    updateUserMock.mockResolvedValueOnce({ data: { user: {} }, error: null });
    fireEvent.change(codeInput(container)!, { target: { value: " 123456 " } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(2));
    expect(updateUserMock.mock.calls[1][0]).toEqual({
      password: "supersecret",
      nonce: "123456",
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/profile?tab=account&password_set=1"));
    expect(reauthenticateMock).toHaveBeenCalledOnce();
  });

  // CHARACTERIZATION: green at HEAD before the change and after it, by design.
  it("R4: an error with no code that matches /session/i still shows the no-session panel", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Auth session missing!",
        name: "AuthSessionMissingError",
        status: 400,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain(
        "Open the password-reset link from your email to continue.",
      );
    });
    expect(getByText("Request a new link")).toBeTruthy();
    expect(reauthenticateMock).not.toHaveBeenCalled();
  });

  const RATE_LIMIT_MSG =
    "For security purposes, you can only request this after 60 seconds.";

  async function submitCode(
    container: HTMLElement,
    getByText: (t: string) => HTMLElement,
    value = "123456",
  ) {
    fireEvent.change(codeInput(container)!, { target: { value } });
    fireEvent.click(getByText("Update password"));
  }

  it("R5: a not-valid code shows its own message, keeps an emptied code input and offers a resend", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);

    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "reauthentication_not_valid",
        message: "Step-up failed",
        status: 401,
        name: "AuthApiError",
      },
    });
    await submitCode(container, getByText);

    await waitFor(() => {
      expect(container.textContent).toContain(
        "That code is not right or has expired. Send a new code and try again.",
      );
    });
    expect(container.textContent).not.toContain("Step-up failed");
    expect(codeInput(container)).not.toBeNull();
    expect(codeInput(container)!.value).toBe("");
    expect(pushMock).not.toHaveBeenCalled();
    expect(reauthenticateMock).toHaveBeenCalledOnce();
    expect(getByText("Send a new code")).toBeTruthy();
  });

  it("R6: Send a new code resends without calling updateUser, and shows a send error as-is", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);
    const updateCallsBefore = updateUserMock.mock.calls.length;

    reauthenticateMock.mockResolvedValueOnce(SENT_OK);
    fireEvent.click(getByText("Send a new code"));
    await waitFor(() => {
      expect(container.textContent).toContain("We sent a new code to your email.");
    });
    expect(reauthenticateMock).toHaveBeenCalledTimes(2);
    expect(updateUserMock.mock.calls.length).toBe(updateCallsBefore);

    reauthenticateMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: RATE_LIMIT_MSG, status: 429, name: "AuthApiError" },
    });
    fireEvent.click(getByText("Send a new code"));
    await waitFor(() => {
      expect(container.textContent).toContain(RATE_LIMIT_MSG);
    });
    expect(codeInput(container)).not.toBeNull();
    expect(updateUserMock.mock.calls.length).toBe(updateCallsBefore);
  });

  it("R7: any other nonce-retry error shows its message, empties the code and never re-sends", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);

    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "weak_password",
        message: "Password is too weak",
        status: 422,
        name: "AuthWeakPasswordError",
      },
    });
    await submitCode(container, getByText);

    await waitFor(() => {
      expect(container.textContent).toContain("Password is too weak");
    });
    expect(codeInput(container)).not.toBeNull();
    expect(codeInput(container)!.value).toBe("");
    expect(reauthenticateMock).toHaveBeenCalledOnce();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("R8: a failed first send stays on the password step and a resubmit retries the whole step", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    updateUserMock.mockResolvedValueOnce(REAUTH_NEEDED);
    reauthenticateMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: RATE_LIMIT_MSG, status: 429, name: "AuthApiError" },
    });
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain(RATE_LIMIT_MSG);
    });
    expect(codeInput(container)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();

    updateUserMock.mockResolvedValueOnce(REAUTH_NEEDED);
    reauthenticateMock.mockResolvedValueOnce(SENT_OK);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => expect(codeInput(container)).not.toBeNull());
    expect(updateUserMock).toHaveBeenCalledTimes(2);
    expect(updateUserMock.mock.calls[1][0]).toEqual({ password: "supersecret" });
    expect(reauthenticateMock).toHaveBeenCalledTimes(2);
  });

  it("R8b: a send error with a blank message shows the fallback copy", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    updateUserMock.mockResolvedValueOnce(REAUTH_NEEDED);
    reauthenticateMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "  ", status: 500, name: "AuthApiError" },
    });
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain("Could not send a code. Please try again.");
    });
    expect(codeInput(container)).toBeNull();
  });

  // REGRESSION GUARD: no console call exists today, so this may pass before Task 2.
  it("R9: neither the password nor the code reaches any console method", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const { container, getByText } = render(<ResetPasswordForm />);
      await reachCodeStep(container, getByText);
      updateUserMock.mockResolvedValueOnce({ data: { user: {} }, error: null });
      await submitCode(container, getByText);
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/profile?tab=account&password_set=1"));

      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain("supersecret");
      expect(logged).not.toContain("123456");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  // REGRESSION GUARD: the Task 1 /session/i branch already runs in the code step.
  it("R10: a session loss in the code step shows the no-session panel, never a bad-code message", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    await reachCodeStep(container, getByText);

    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Auth session missing!",
        name: "AuthSessionMissingError",
        status: 400,
      },
    });
    await submitCode(container, getByText);

    await waitFor(() => {
      expect(container.textContent).toContain(
        "Open the password-reset link from your email to continue.",
      );
    });
    expect(container.textContent).not.toContain("not right or has expired");
    expect(reauthenticateMock).toHaveBeenCalledOnce();
  });
  // PROD 2026-11-26 follow-up (F3): the no-session card used to be chosen by
  // /session/i on the message, so any Auth error that merely mentioned
  // "session" hid its real text behind "open the link from your email". The
  // card is now chosen by AuthSessionMissingError's name or the
  // session_not_found code only; every other error reaches the form.
  it("F3: an error that only mentions 'session' in its message shows that message, not the no-session card", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Could not update the password for this session",
        name: "AuthApiError",
        code: "unexpected_failure",
        status: 500,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain(
        "Could not update the password for this session",
      );
    });
    expect(container.textContent).not.toContain(
      "Open the password-reset link from your email to continue.",
    );
  });

  it("F3: session_expired from the token refresh (a timed-out recovery session) shows the no-session card", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Invalid Refresh Token: Session Expired",
        name: "AuthApiError",
        code: "session_expired",
        status: 400,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain(
        "Open the password-reset link from your email to continue.",
      );
    });
    expect(container.textContent).not.toContain("Invalid Refresh Token");
  });

  it("F3: Auth's session_not_found code (a revoked session) shows the no-session card", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Session from session_id claim in JWT does not exist",
        name: "AuthApiError",
        code: "session_not_found",
        status: 403,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toContain(
        "Open the password-reset link from your email to continue.",
      );
    });
  });

  // F1: /auth/callback sends a recovery link it could not verify to
  // /reset-password?link=expired; the page passes linkExpired, and the form
  // must open on a card that says why and offers a new link.
  it("F1: linkExpired opens on the expired-link card with a new-link affordance", () => {
    const { container, getByText } = render(<ResetPasswordForm linkExpired />);
    expect(container.textContent).toContain(
      "This password-reset link has expired, was already used, or was opened in a different browser.",
    );
    expect(getByText("Request a new link").getAttribute("href")).toBe("/forgot-password");
    expect(container.querySelector('input[name="password"]')).toBeNull();
  });
  // SFH round 2: a transient callback failure gets its own card, and every
  // updateUser failure is logged (code and status) before either branch.
  it("linkError opens on the try-again card", () => {
    const { container } = render(<ResetPasswordForm linkError />);
    expect(container.textContent).toContain("We could not check your reset link just now.");
  });

  it.each([
    [{ message: "Auth session missing!", name: "AuthSessionMissingError", status: 400 }, "unknown", 400],
    [{ message: "boom", name: "AuthApiError", code: "unexpected_failure", status: 500 }, "unexpected_failure", 500],
  ])("logs the updateUser failure before branching (%#)", async (error, code, status) => {
    updateUserMock.mockResolvedValueOnce({ data: null, error });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, getByText } = render(<ResetPasswordForm />);
    fillPasswords(container);
    fireEvent.click(getByText("Update password"));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("[reset-password] updateUser failed:", code, status),
    );
    spy.mockRestore();
  });
});
