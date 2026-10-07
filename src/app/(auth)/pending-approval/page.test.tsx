/**
 * Phase 164.6.6.3.5 DOMAINONE (D-01, D-04, UI-SPEC S8 / AD-10) — /pending-approval
 * tells the truth.
 *
 * D-04: no Resend, so `notifyUserSignupApproved` is skipped and NO approval
 * email is sent. The page used to promise one ("We'll email you as soon as it's
 * approved", "You receive an email when your account is approved"), which sends
 * a waiting applicant to watch an inbox that will stay empty. It now says what
 * is true: sign back in to check, because the page already redirects an
 * approved profile into the platform.
 *
 * Fails when: any wording promising mail comes back, a mailbox address or
 * mail-scheme link returns, the footer stops linking the general contact form,
 * or the list drifts from the UI-SPEC rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { contactHref } from "@/lib/contact";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

let profileRow: Record<string, unknown> | null = null;
let sessionUser: { id: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
      }),
    }),
  }),
}));

// Client component with its own router and supabase client: not under test.
vi.mock("@/components/auth/SignOutButton", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

import PendingApprovalPage from "./page";

async function renderPending() {
  render(await PendingApprovalPage());
}

beforeEach(() => {
  redirectMock.mockClear();
  sessionUser = { id: "user-1" };
  profileRow = {
    role: "allocator",
    allocator_status: "newbie",
    manager_status: null,
    is_admin: false,
    display_name: null,
  };
});

describe("/pending-approval copy (D-04: no approval email is sent)", () => {
  it("reads the UI-SPEC intro and says to sign back in to check", async () => {
    await renderPending();
    expect(
      screen.getByText(
        "Your application is being reviewed, usually within one business day. Sign back in to check: once it is approved, signing in takes you into the platform.",
      ),
    ).toBeInTheDocument();
  });

  it("lists the three UI-SPEC steps verbatim", async () => {
    await renderPending();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "1. A Quantalyze admin reviews your application.",
      "2. Sign back in to check whether it has been approved.",
      "3. Once it is approved, signing in takes you into the platform.",
    ]);
  });

  it("promises no email anywhere on the page", async () => {
    await renderPending();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/email you/i);
    expect(text).not.toMatch(/receive an email/i);
    expect(text).not.toMatch(/we.ll email/i);
  });
});

describe("/pending-approval names no address (D-01)", () => {
  it("links 'contact form' to the general topic and shows no mailbox", async () => {
    await renderPending();
    const footer = screen.getByText(/^Questions\?/);
    expect(footer.textContent).toBe("Questions? Use the contact form.");
    const link = within(footer).getByRole("link", { name: "contact form" });
    expect(link).toHaveAttribute("href", contactHref({ topic: "general" }));
    expect(link.className).toContain("text-accent underline");

    const scheme = ["mail", "to:"].join("");
    expect(document.querySelector(`a[href^="${scheme}"]`)).toBeNull();
    expect(document.body.textContent).not.toContain("@");
  });
});

describe("/pending-approval routing is unchanged", () => {
  it("still redirects an approved profile into the platform (the copy's claim)", async () => {
    profileRow = {
      role: "allocator",
      allocator_status: "verified",
      manager_status: null,
      is_admin: false,
      display_name: "Jane",
    };
    await expect(PendingApprovalPage()).rejects.toThrow(
      "NEXT_REDIRECT:/discovery/crypto-sma",
    );
  });

  it("sends a signed-out visitor to /login", async () => {
    sessionUser = null;
    await expect(PendingApprovalPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
