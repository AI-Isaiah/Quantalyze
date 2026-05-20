import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * Regression — 2026-05-20 role-lock at profile page.
 *
 * Pre-fix: ProfileForm exposed a role-switcher card and included the
 * `role` field in every UPDATE payload to `profiles`. A user could
 * toggle between allocator and manager freely, which broke role-
 * conditioned product surfaces and analytics.
 *
 * Post-fix: ProfileForm renders the role as a read-only badge (no
 * role-changing buttons), and the UPDATE call to `profiles` omits
 * the `role` field. The DB trigger `prevent_profile_role_change`
 * blocks the mutation server-side too, but the client-side omission
 * is defense-in-depth — and it stops well-meaning callers from
 * surfacing confusing trigger errors to themselves.
 *
 * This file pins both invariants.
 */

const updateMock = vi.fn();
const eqMock = vi.fn(() => Promise.resolve({ error: null }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: fromMock,
  }),
}));

import { ProfileForm } from "./ProfileForm";
import type { Profile } from "@/lib/types";

const BASE_PROFILE: Profile = {
  id: "user-1",
  email: "test@example.test",
  display_name: "Test User",
  company: null,
  description: null,
  telegram: null,
  website: null,
  linkedin: null,
  avatar_url: null,
  role: "allocator",
  manager_status: "newbie",
  allocator_status: "newbie",
  created_at: "2026-05-20T00:00:00Z",
};

describe("ProfileForm — role lock (2026-05-20 regression)", () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateMock.mockReturnValue({ eq: eqMock });
    eqMock.mockClear();
    fromMock.mockClear();
  });

  it("renders the role as a read-only badge, not buttons", () => {
    const { container, queryByText } = render(<ProfileForm profile={BASE_PROFILE} />);
    expect(container.querySelector('[data-testid="profile-role-readonly"]')).not.toBeNull();
    // Buttons that the old role-switcher emitted: button labelled
    // "Asset Manager", "Allocator", "Both". The read-only treatment
    // renders the chosen label as text, but should NOT emit clickable
    // role buttons. We assert by tag — there must be no <button>
    // whose accessible name equals one of the legacy switcher labels.
    const buttons = Array.from(container.querySelectorAll("button"));
    for (const b of buttons) {
      expect(b.textContent).not.toMatch(/^(Asset Manager|Allocator|Both)$/);
    }
    expect(queryByText(/set at signup/i)).not.toBeNull();
  });

  it("omits `role` from the UPDATE payload when the form submits", async () => {
    const { container, getByText } = render(<ProfileForm profile={BASE_PROFILE} />);
    fireEvent.click(getByText("Save changes"));
    await new Promise((r) => setTimeout(r, 0));
    expect(updateMock).toHaveBeenCalledOnce();
    const payload = updateMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty("role");
    // Sanity: other editable fields ARE still in the payload.
    expect(payload).toHaveProperty("display_name");
    expect(payload).toHaveProperty("company");
  });

  it("displays the correct role label for each role value", () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      const { container, unmount } = render(
        <ProfileForm profile={{ ...BASE_PROFILE, role }} />,
      );
      const badge = container.querySelector('[data-testid="profile-role-readonly"]');
      expect(badge).not.toBeNull();
      const expectedLabel =
        role === "allocator"
          ? "Allocator"
          : role === "manager"
            ? "Asset Manager"
            : "Both";
      expect(badge!.textContent).toContain(expectedLabel);
      unmount();
    }
  });
});
