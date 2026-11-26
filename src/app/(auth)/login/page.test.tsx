/**
 * Phase 199 MANAGERHOME plan 01 (CD-02, CD-13) - the login page hands the form
 * a SANITISED deep link and its email-confirm code branch no longer redirects
 * to an unchecked value.
 *
 * CD-02: /login?redirect=/compare reaches the form as redirectTo "/compare";
 * ?next=... is honoured when redirect is absent.
 * CD-13: a hostile redirect/next gives redirectTo null. The page no longer
 * exchanges ?code= at all (2026-11-26), so it never calls redirect().
 *
 * Fails when: the deep link is dropped, a hostile value reaches the form, or
 * the page exchanges a ?code= again.
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

// 2026-11-26 (password reset fix): the code branch is gone. A Server Component
// cannot set cookies, so its exchange spent the one-time code and dropped the
// session. The CD-13 open redirect it carried went with it.
describe("login page does not exchange ?code= (CD-13 branch removed)", () => {
  it("renders the form with the sanitised deep link and never exchanges or redirects", async () => {
    const to = await renderLogin({ code: "abc", redirect: "https://evil.example" });
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(to).toBe("null");
  });

  it("keeps a safe deep link when a ?code= rides along", async () => {
    expect(await renderLogin({ code: "abc", redirect: "/compare" })).toBe("/compare");
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});

// SFH round 2: /auth/callback sends a failed email link (an expired signup
// confirmation, say) to /login?error=...; the page shows fixed copy, never the
// reflected text, so the user is told the link failed.
describe("login page ?error= notice", () => {
  it("shows the fixed notice and never the reflected error text", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ error: "<b>injected</b>" }) }));
    expect(screen.getByRole("alert").textContent).toContain("That email link could not be used.");
    expect(document.body.textContent).not.toContain("injected");
  });

  it("shows no notice without ?error=", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
