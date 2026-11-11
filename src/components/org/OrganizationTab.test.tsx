import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrganizationTab } from "./OrganizationTab";

/**
 * Phase 170.1.2 / plan 08 (D-01) — the member role under each organisation
 * reads as a word from orgMemberRoleLabel, not the stored value shaped by CSS
 * `capitalize`. Expected strings are hand-typed.
 *
 * Neuter to redden: render `{o.role}` again and the "Unknown role" case fails
 * (the raw value would show), as would the class assertion if `capitalize`
 * came back.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

let memberRows: unknown[] = [];
let inviteRows: unknown[] = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === "organization_invites"
          ? { eq: () => ({ eq: () => Promise.resolve({ data: inviteRows }) }) }
          : Promise.resolve({ data: memberRows }),
    }),
    auth: {
      // No email unless the case holds invites: the component then skips the invite query.
      getUser: () =>
        Promise.resolve({
          data: { user: inviteRows.length ? { email: "allocator@example.test" } : null },
        }),
    },
  }),
}));

function member(id: string, name: string, role: string) {
  return {
    organization_id: id,
    role,
    organizations: { id, name, slug: name.toLowerCase(), description: null },
  };
}

beforeEach(() => {
  memberRows = [];
  inviteRows = [];
});

describe("OrganizationTab — member role label (170.1.2-08)", () => {
  it("owner reads Owner and the role element carries no capitalize class", async () => {
    memberRows = [member("o1", "Acme Fund", "owner")];
    render(<OrganizationTab />);
    const role = await screen.findByText("Owner");
    expect(role.className).not.toContain("capitalize");
  });

  it("member reads Member", async () => {
    memberRows = [member("o2", "Beta Desk", "member")];
    render(<OrganizationTab />);
    expect(await screen.findByText("Member")).toBeTruthy();
  });

  it("a role outside the set reads Unknown role, never the raw value", async () => {
    memberRows = [member("o3", "Gamma Pool", "superuser")];
    render(<OrganizationTab />);
    expect(await screen.findByText("Unknown role")).toBeTruthy();
    expect(screen.queryByText("superuser")).toBeNull();
  });
});

describe("OrganizationTab: invitation date (Phase 201 D-11)", () => {
  it("prints the invite date through formatDay, not the browser locale", async () => {
    inviteRows = [
      { id: "i1", status: "pending", created_at: "2026-10-09T08:00:00Z", organizations: { name: "Acme Fund" } },
    ];
    render(<OrganizationTab />);
    expect(await screen.findByText("Invited Oct 9, 2026")).toBeTruthy();
  });
});
