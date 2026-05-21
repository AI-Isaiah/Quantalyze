import { describe, it, expect } from "vitest";
import { isProfileApproved, type ApprovalProfile } from "./approval";

// task #14 regression suite (2026-05-21). Pins the universal-approval
// gate truth table so a future status-name drift can't silently let
// pending profiles into the dashboard.

function profile(p: Partial<ApprovalProfile>): ApprovalProfile {
  return {
    role: p.role ?? null,
    allocator_status: p.allocator_status ?? null,
    manager_status: p.manager_status ?? null,
    is_admin: p.is_admin ?? false,
  };
}

describe("isProfileApproved (task #14 universal approval gate)", () => {
  it("returns false for null/undefined", () => {
    expect(isProfileApproved(null)).toBe(false);
    expect(isProfileApproved(undefined)).toBe(false);
  });

  it("returns true for is_admin regardless of statuses (admin override)", () => {
    expect(
      isProfileApproved(
        profile({ role: "manager", manager_status: "newbie", is_admin: true }),
      ),
    ).toBe(true);
    // Without the override, an admin who freshly signed up could not
    // reach the very admin queue used to approve themselves and other
    // users. This is the load-bearing escape hatch.
  });

  it("allocator: verified passes, newbie fails", () => {
    expect(
      isProfileApproved(
        profile({ role: "allocator", allocator_status: "verified" }),
      ),
    ).toBe(true);
    expect(
      isProfileApproved(
        profile({ role: "allocator", allocator_status: "newbie" }),
      ),
    ).toBe(false);
    expect(
      isProfileApproved(
        profile({ role: "allocator", allocator_status: "pending" }),
      ),
    ).toBe(false);
  });

  it("manager: verified passes, newbie fails", () => {
    expect(
      isProfileApproved(
        profile({ role: "manager", manager_status: "verified" }),
      ),
    ).toBe(true);
    expect(
      isProfileApproved(
        profile({ role: "manager", manager_status: "newbie" }),
      ),
    ).toBe(false);
  });

  it("manager: allocator_status is irrelevant — only manager_status gates", () => {
    expect(
      isProfileApproved(
        profile({
          role: "manager",
          manager_status: "verified",
          allocator_status: "newbie",
        }),
      ),
    ).toBe(true);
  });

  it("allocator: manager_status is irrelevant — only allocator_status gates", () => {
    expect(
      isProfileApproved(
        profile({
          role: "allocator",
          allocator_status: "verified",
          manager_status: "newbie",
        }),
      ),
    ).toBe(true);
  });

  it("both: requires BOTH allocator_status AND manager_status verified", () => {
    expect(
      isProfileApproved(
        profile({
          role: "both",
          allocator_status: "verified",
          manager_status: "verified",
        }),
      ),
    ).toBe(true);
    expect(
      isProfileApproved(
        profile({
          role: "both",
          allocator_status: "verified",
          manager_status: "newbie",
        }),
      ),
    ).toBe(false);
    expect(
      isProfileApproved(
        profile({
          role: "both",
          allocator_status: "newbie",
          manager_status: "verified",
        }),
      ),
    ).toBe(false);
  });

  it("unknown role: fails closed", () => {
    // Defense against future role values appearing in the column without
    // the switch being updated. A permissive default would silently let
    // unknown-role profiles into the dashboard.
    expect(
      isProfileApproved(
        profile({
          role: "something_new",
          allocator_status: "verified",
          manager_status: "verified",
        }),
      ),
    ).toBe(false);
    expect(
      isProfileApproved(
        profile({ role: null, allocator_status: "verified" }),
      ),
    ).toBe(false);
  });

  it("only 'verified' is the magic string — 'approved' or other values do NOT count", () => {
    // The existing /api/admin/allocator-approve route writes exactly
    // 'verified'. If a future migration drifts to 'approved', this test
    // catches it before users get locked out (or pre-approved users get
    // re-pending'd).
    expect(
      isProfileApproved(
        profile({ role: "allocator", allocator_status: "approved" }),
      ),
    ).toBe(false);
    expect(
      isProfileApproved(
        profile({ role: "allocator", allocator_status: "active" }),
      ),
    ).toBe(false);
  });
});
