/**
 * Phase 199 MANAGERHOME plan 01 (CD-02, CD-13) - where LoginForm sends a user
 * after a successful sign-in.
 *
 * CD-02: a safe redirectTo wins over the shared home constant.
 * CD-13: LoginForm re-checks its prop; a hostile redirectTo pushes the
 * constant, never the attacker's URL. A sign-in error pushes nothing.
 *
 * Fails when: the deep link is ignored, a hostile value is pushed, the push
 * target is hand-typed instead of the shared constant, or an error navigates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

let signInError: { message: string } | null = null;
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(async () => ({ error: signInError })),
    },
  }),
}));

import { LoginForm } from "./LoginForm";

async function submit(props: { redirectTo?: string | null } = {}) {
  render(<LoginForm {...props} />);
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
    target: { value: "a@b.co" },
  });
  fireEvent.change(screen.getByPlaceholderText("Your password"), {
    target: { value: "pw" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  signInError = null;
});

describe("LoginForm post-sign-in navigation", () => {
  it("pushes a safe redirectTo", async () => {
    await submit({ redirectTo: "/compare" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/compare"));
  });

  it("pushes the role-home route when there is no redirectTo", async () => {
    await submit();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/home"),
    );
  });

  it("pushes the role-home route when redirectTo is null", async () => {
    await submit({ redirectTo: null });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/home"),
    );
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil", "/Compare"])(
    "pushes the role-home route, not the hostile redirectTo %s",
    async (value) => {
      await submit({ redirectTo: value });
      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/home"),
      );
      expect(push).not.toHaveBeenCalledWith(value);
    },
  );

  it("pushes nothing and shows the error when sign-in fails", async () => {
    signInError = { message: "Invalid login credentials" };
    await submit({ redirectTo: "/compare" });
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
