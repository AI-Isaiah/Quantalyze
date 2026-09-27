/**
 * N-H (Phase 170, plan 07): masthead actions follow the session.
 * Signed out, today's Sign in / Sign up links. Signed in, one "Go to app"
 * link and no identity. An auth failure stays on the public header.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { createClient } from "@/lib/supabase/server";
import { MarketingHeaderActions } from "./MarketingHeaderActions";

// The literal `src/proxy.ts` names today. Task 1's module owns it; the
// signed-in assertion below is updated to import that constant once it exists.

const SIGN_IN_CLASS =
  "inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-page hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const SIGN_UP_CLASS =
  "inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const HIDDEN_USER_ID = "usr_should_not_leak_9f3a";
const HIDDEN_EMAIL = "hidden-session@example.test";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: auth.getUser },
  })),
}));

async function renderActions() {
  const ui = await MarketingHeaderActions();
  return render(ui as React.ReactElement);
}

function expectSignedOutLinks() {
  const signIn = screen.getByRole("link", { name: "Sign in" });
  const signUp = screen.getByRole("link", { name: "Sign up" });
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(signIn).toHaveAttribute("href", "/login");
  expect(signUp).toHaveAttribute("href", "/signup");
  expect(signIn.getAttribute("class")).toBe(SIGN_IN_CLASS);
  expect(signUp.getAttribute("class")).toBe(SIGN_UP_CLASS);
  expect(screen.queryByRole("link", { name: "Go to app" })).toBeNull();
}

beforeEach(() => {
  auth.getUser.mockReset();
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockImplementation(async () => ({
    auth: { getUser: auth.getUser },
  }) as never);
});

describe("MarketingHeaderActions", () => {
  it("renders Sign in and Sign up, and no Go to app, when getUser resolves no user", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    await renderActions();
    expectSignedOutLinks();
  });

  it("renders one Go to app link and no identity when getUser resolves a user", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { id: HIDDEN_USER_ID, email: HIDDEN_EMAIL } },
      error: null,
    });
    const { container } = await renderActions();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Go to app");
    expect(links[0]).toHaveAttribute("href", "/discovery/crypto-sma");
    expect(links[0].getAttribute("class")).toBe(SIGN_UP_CLASS);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
    expect(container.innerHTML).not.toContain(HIDDEN_EMAIL);
    expect(container.innerHTML).not.toContain(HIDDEN_USER_ID);
  });

  it("renders the signed-out links when getUser returns an error", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { id: HIDDEN_USER_ID, email: HIDDEN_EMAIL } },
      error: { message: "invalid session" },
    });
    const { container } = await renderActions();
    expectSignedOutLinks();
    expect(container.innerHTML).not.toContain(HIDDEN_EMAIL);
    expect(container.innerHTML).not.toContain(HIDDEN_USER_ID);
  });

  it("renders the signed-out links when getUser rejects", async () => {
    auth.getUser.mockRejectedValue(new Error("auth down"));
    await renderActions();
    expectSignedOutLinks();
  });

  it("renders the signed-out links when createClient rejects", async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error("cookies unavailable"));
    await renderActions();
    expectSignedOutLinks();
  });
});
