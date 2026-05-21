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

  it("routes to /onboarding when session is returned immediately (auto-confirm path)", async () => {
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
      expect(pushMock).toHaveBeenCalledWith("/onboarding");
    });
  });
});
