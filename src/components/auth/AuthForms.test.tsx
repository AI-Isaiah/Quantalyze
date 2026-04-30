import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

/**
 * Lock the input `name` attributes on the auth forms.
 *
 * 8+ Playwright specs select login fields with
 * `input[name="email"], input[placeholder*="email" i]`. The placeholder
 * fallback never matched (`you@example.com` has no "email" substring),
 * so dropping `name` from the inputs silently broke every spec at
 * `page.fill` with a 60s timeout. Pin the name attributes here so a
 * refactor that removes them surfaces in unit tests, not only after
 * a full e2e CI run.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  }),
}));

describe("LoginForm input name attributes (e2e selector contract)", () => {
  it("email input has name='email'", () => {
    const { container } = render(<LoginForm />);
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
  });

  it("password input has name='password'", () => {
    const { container } = render(<LoginForm />);
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
  });

  it("matches the e2e composite selector input[name='email']", () => {
    const { container } = render(<LoginForm />);
    expect(
      container.querySelector('input[name="email"], input[placeholder*="email" i]'),
    ).not.toBeNull();
  });
});

describe("SignupForm input name attributes (e2e selector contract)", () => {
  it("email input has name='email'", () => {
    const { container } = render(<SignupForm />);
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
  });

  it("password input has name='password'", () => {
    const { container } = render(<SignupForm />);
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
  });

  it("display_name input has name='display_name'", () => {
    const { container } = render(<SignupForm />);
    expect(container.querySelector('input[name="display_name"]')).not.toBeNull();
  });
});
