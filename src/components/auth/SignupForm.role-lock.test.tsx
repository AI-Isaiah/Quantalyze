import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * Regression — 2026-05-20 role-lock at signup.
 *
 * Bug shape (pre-fix): role was picked AFTER signup in the
 * OnboardingWizard, and the /profile page exposed a role-switcher
 * card that let users toggle freely between allocator and manager.
 * That made no sense for downstream analytics, bridge attribution,
 * or notification preferences.
 *
 * Fix: role is chosen on the signup form, passed via
 * `options.data: { role }` so the `handle_new_user` DB trigger seeds
 * the profile with it, and then locked by the
 * `prevent_profile_role_change` BEFORE UPDATE OF role trigger.
 *
 * This file asserts the CLIENT-SIDE half of that contract:
 *   - SignupForm refuses to submit without a role pick.
 *   - When a role IS picked, it's threaded into `supabase.auth.signUp`
 *     options.data so the DB trigger has something to read.
 */

const signUpMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: signUpMock,
    },
  }),
}));

import { SignupForm } from "./SignupForm";

function fillNonRoleFields(container: HTMLElement) {
  const display = container.querySelector('input[name="display_name"]') as HTMLInputElement;
  const email = container.querySelector('input[name="email"]') as HTMLInputElement;
  const password = container.querySelector('input[name="password"]') as HTMLInputElement;
  fireEvent.change(display, { target: { value: "Test User" } });
  fireEvent.change(email, { target: { value: "test@example.test" } });
  fireEvent.change(password, { target: { value: "supersecret" } });
}

describe("SignupForm — role lock at signup (2026-05-20 regression)", () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it("renders both signup role options", () => {
    const { container } = render(<SignupForm />);
    expect(container.querySelector('[data-testid="signup-role-allocator"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="signup-role-manager"]')).not.toBeNull();
  });

  it("does NOT expose 'both' as a signup role option", () => {
    // Schema still allows 'both' for legacy / admin-set rows, but
    // signup intentionally omits it — first-time identity is one or
    // the other; admin support handles the 'both' case.
    const { container } = render(<SignupForm />);
    expect(container.querySelector('[data-testid="signup-role-both"]')).toBeNull();
  });

  it("submit refuses to call supabase.signUp when no role is picked", () => {
    const { container, getByText } = render(<SignupForm />);
    fillNonRoleFields(container);
    fireEvent.click(getByText("Create account"));
    expect(signUpMock).not.toHaveBeenCalled();
    // Inline error must appear so the user knows why nothing happened.
    expect(container.textContent).toMatch(/allocator or a quant team/i);
  });

  it("threads the picked role into auth.signUp options.data", async () => {
    signUpMock.mockResolvedValueOnce({ data: { session: {} }, error: null });
    const { container, getByText } = render(<SignupForm />);
    fillNonRoleFields(container);
    fireEvent.click(container.querySelector('[data-testid="signup-role-allocator"]') as HTMLElement);
    fireEvent.click(getByText("Create account"));
    // Yield one microtask so the async submit handler runs.
    await new Promise((r) => setTimeout(r, 0));
    expect(signUpMock).toHaveBeenCalledOnce();
    const call = signUpMock.mock.calls[0][0];
    expect(call.options.data).toEqual({ display_name: "Test User", role: "allocator" });
  });

  it("threads role=manager when manager is picked", async () => {
    signUpMock.mockResolvedValueOnce({ data: { session: {} }, error: null });
    const { container, getByText } = render(<SignupForm />);
    fillNonRoleFields(container);
    fireEvent.click(container.querySelector('[data-testid="signup-role-manager"]') as HTMLElement);
    fireEvent.click(getByText("Create account"));
    await new Promise((r) => setTimeout(r, 0));
    expect(signUpMock.mock.calls[0][0].options.data.role).toBe("manager");
  });
});
