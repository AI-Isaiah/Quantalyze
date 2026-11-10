/**
 * Phase 199 MANAGERHOME plan 01 (CD-02, CD-13) - the login page hands the form
 * a SANITISED deep link and its email-confirm code branch no longer redirects
 * to an unchecked value.
 *
 * CD-02: /login?redirect=/compare reaches the form as redirectTo "/compare";
 * ?next=... is honoured when redirect is absent.
 * CD-13: a hostile redirect/next gives redirectTo null; the code branch with a
 * successful exchange and https://evil.example falls back to /onboarding (the
 * open redirect this test exists to catch).
 *
 * Fails when: the deep link is dropped, a hostile value reaches the form or
 * redirect(), or the code branch stops falling back to /onboarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

let exchangeError: unknown = null;
const exchangeMock = vi.fn(async () => ({ error: exchangeError }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeMock },
  }),
}));

// Capture the prop the page computes; the form itself is under its own test.
vi.mock("@/components/auth/LoginForm", () => ({
  LoginForm: ({ redirectTo }: { redirectTo?: string | null }) => (
    <div data-testid="login-form" data-redirect-to={String(redirectTo)} />
  ),
}));

import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

async function renderLogin(params: Record<string, string | string[]>) {
  render(await LoginPage({ searchParams: Promise.resolve(params) }));
  return screen.getByTestId("login-form").getAttribute("data-redirect-to");
}

beforeEach(() => {
  redirectMock.mockClear();
  exchangeMock.mockClear();
  exchangeError = null;
});

describe("login page redirectTo (CD-02, CD-13)", () => {
  it("passes ?redirect=/compare to the form", async () => {
    expect(await renderLogin({ redirect: "/compare" })).toBe("/compare");
  });

  it("honours ?next=/strategies/new/wizard when redirect is absent", async () => {
    expect(await renderLogin({ next: "/strategies/new/wizard" })).toBe(
      "/strategies/new/wizard",
    );
  });

  it("prefers redirect over next", async () => {
    expect(
      await renderLogin({ redirect: "/compare", next: "/allocations" }),
    ).toBe("/compare");
  });

  it("falls through to a safe next when redirect is hostile", async () => {
    expect(
      await renderLogin({ redirect: "//evil.example", next: "/compare" }),
    ).toBe("/compare");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil", "/Compare"])(
    "gives the form null for the hostile value %s",
    async (value) => {
      expect(await renderLogin({ redirect: value })).toBe("null");
    },
  );

  it("gives the form null for an array value", async () => {
    expect(await renderLogin({ redirect: ["/compare"] })).toBe("null");
  });
});

describe("login page code branch (CD-13: open redirect closed)", () => {
  it("redirects to /onboarding when the redirect is off-origin", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          code: "abc",
          redirect: "https://evil.example",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("redirects to a safe redirect after a successful exchange", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({ code: "abc", redirect: "/compare" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/compare");
  });

  it("falls through to the form when the exchange fails", async () => {
    exchangeError = new Error("bad code");
    render(
      await LoginPage({
        searchParams: Promise.resolve({ code: "abc", redirect: "/compare" }),
      }),
    );
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });
});
