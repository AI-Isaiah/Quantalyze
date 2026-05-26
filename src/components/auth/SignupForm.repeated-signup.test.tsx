import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * Regression — repeated-signup UX guard.
 *
 * Bug shape (pre-fix): when an email is already registered, Supabase's
 * enumeration-safe response is a 200 with `data.user.identities = []`
 * (no error, no session). The form fell through to "Check your email
 * to confirm your account" — but no email is ever sent for an existing
 * confirmed user, so the user waited forever and reported the signup
 * email as broken.
 *
 * Fix: detect `data.user.identities.length === 0` explicitly and steer
 * the user toward sign-in instead.
 */

const signUpMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: signUpMock,
    },
  }),
}));

import { SignupForm } from "./SignupForm";

function fillForm(container: HTMLElement, role: "allocator" | "manager" = "manager") {
  const display = container.querySelector('input[name="display_name"]') as HTMLInputElement;
  const email = container.querySelector('input[name="email"]') as HTMLInputElement;
  const password = container.querySelector('input[name="password"]') as HTMLInputElement;
  fireEvent.change(display, { target: { value: "Test User" } });
  fireEvent.change(email, { target: { value: "existing@example.test" } });
  fireEvent.change(password, { target: { value: "supersecret" } });
  const roleBtn = container.querySelector(
    `[data-testid="signup-role-${role}"]`,
  ) as HTMLButtonElement;
  fireEvent.click(roleBtn);
}

describe("SignupForm — repeated-signup UX guard", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    pushMock.mockReset();
  });

  it("shows the 'already exists' message when Supabase returns identities=[]", async () => {
    // Supabase's documented enumeration-safe payload for "email already
    // registered". Note: no error, no session, user is populated but
    // identities is an empty array.
    signUpMock.mockResolvedValueOnce({
      data: {
        user: { id: "existing-uid", identities: [] },
        session: null,
      },
      error: null,
    });

    const { container, getByText } = render(<SignupForm />);
    fillForm(container);
    fireEvent.click(getByText("Create account"));

    await waitFor(() => {
      expect(container.textContent).toMatch(/already exists/i);
    });
    // Must NOT show the "check your email" message that misled users
    // before the fix.
    expect(container.textContent).not.toMatch(/check your email/i);
    // Must NOT route to /onboarding — they need to sign in instead.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("still shows 'check your email' for genuine first-time signup with identities populated", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "new-uid",
          identities: [{ id: "id-1", provider: "email" }],
        },
        session: null,
      },
      error: null,
    });

    const { container, getByText } = render(<SignupForm />);
    fillForm(container);
    fireEvent.click(getByText("Create account"));

    await waitFor(() => {
      expect(container.textContent).toMatch(/check your email/i);
    });
    expect(container.textContent).not.toMatch(/already exists/i);
  });

  it("NEW-C15-02: shows 'already exists' when Supabase returns user with identities ABSENT (undefined)", async () => {
    // Pre-fix guard was `data.user.identities && data.user.identities.length === 0`.
    // When identities is undefined, the truthiness check evaluates to false, the
    // branch is skipped, and execution falls to "Check your email" — but no email
    // is sent. Post-fix: absent identities is treated as duplicate-email signal.
    signUpMock.mockResolvedValueOnce({
      data: {
        // identities field is absent (GoTrue config variant)
        user: { id: "existing-uid" },
        session: null,
      },
      error: null,
    });

    const { container, getByText } = render(<SignupForm />);
    fillForm(container);
    fireEvent.click(getByText("Create account"));

    await waitFor(() => {
      expect(container.textContent).toMatch(/already exists/i);
    });
    expect(container.textContent).not.toMatch(/check your email/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("NEW-C15-02: shows generic error (not 'check your email') when Supabase returns no user, no session, no error", async () => {
    // The server-side no-op state: Supabase returns {user:null, session:null}
    // with no error. Pre-fix the form fell through to "Check your email" —
    // but no email was sent (account limbo state). Post-fix: a distinct
    // generic error message is shown and the anomaly is logged.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    signUpMock.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: null,
    });

    const { container, getByText } = render(<SignupForm />);
    fillForm(container);
    fireEvent.click(getByText("Create account"));

    await waitFor(() => {
      expect(container.textContent).toMatch(/something went wrong/i);
    });
    expect(container.textContent).not.toMatch(/check your email/i);
    expect(pushMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[SignupForm] signUp returned no user, session, or error",
    );
    consoleSpy.mockRestore();
  });

  it("routes to /pending-approval when session is returned immediately (auto-confirm path)", async () => {
    // Updated 2026-05-21 (v0.24.5.18): SignupForm now routes to
    // /pending-approval instead of /onboarding so the universal-approval
    // gate (src/lib/approval.ts) can show "your application is being
    // reviewed" before any dashboard tease. The (dashboard)/layout +
    // /onboarding gates also redirect un-verified profiles to the same
    // page, so the redirect here is mostly cosmetic (avoids a flash of
    // the dashboard shell) but still asserted to lock the behavior.
    signUpMock.mockResolvedValueOnce({
      data: {
        user: { id: "new-uid", identities: [{ id: "id-1", provider: "email" }] },
        session: { access_token: "tok" },
      },
      error: null,
    });

    const { container, getByText } = render(<SignupForm />);
    fillForm(container);
    fireEvent.click(getByText("Create account"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/pending-approval");
    });
  });
});
