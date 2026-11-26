/**
 * F1 (2026-11-26): /auth/callback sends a recovery link it could not verify to
 * /reset-password?link=expired. The page must open the form on the card that
 * says the link failed and offers a new one; any other value keeps the form.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

import ResetPasswordPage from "./page";

const EXPIRED =
  "This password-reset link has expired, was already used, or was opened in a different browser.";

describe("reset-password page ?link=", () => {
  it("link=expired opens on the expired-link card", async () => {
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ link: "expired" }) }));
    expect(screen.getByText(EXPIRED)).toBeInTheDocument();
  });

  it("no link param shows the password form", async () => {
    render(await ResetPasswordPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText(EXPIRED)).toBeNull();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });
  it("link=error opens on the try-again card", async () => {
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ link: "error" }) }));
    expect(screen.getByText(/We could not check your reset link just now/)).toBeInTheDocument();
  });
});
