/**
 * Phase 199 MANAGERHOME plan 01 (CD-01, CD-13) - the one role-home decision and
 * the one redirect sanitiser.
 *
 * CD-01: every caller that asks "where does this role live" gets the same answer
 * from roleHomeFor / roleSurfaceHome, so the sign-in, the pending-approval hop
 * and the role guard cannot drift apart.
 * CD-13: `redirect` / `next` are attacker-controlled query values. Anything that
 * is not a same-origin path starting slash-then-lowercase must never navigate;
 * the open redirect (CWE-601) is the failure these tests exist to catch.
 *
 * Fails when: a hostile value is returned unchecked, an approved role maps to
 * the wrong home, or the admin arm is dropped.
 */
import { describe, it, expect } from "vitest";
import {
  roleHomeFor,
  roleSurfaceHome,
  safeRedirectPath,
} from "./role-home";

describe("safeRedirectPath (CD-13: one rule, copied from the proxy)", () => {
  it.each(["/compare", "/strategies/new/wizard?x=1", "/allocations"])(
    "passes the same-origin path %s through",
    (value) => {
      expect(safeRedirectPath(value)).toBe(value);
    },
  );

  it.each([
    ["protocol-relative host", "//evil.example"],
    ["absolute URL", "https://evil.example"],
    ["backslash host", "/\\evil"],
    ["uppercase start", "/Compare"],
    ["empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["array", ["/compare"]],
    ["number", 7],
  ])("returns null for %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });
});

describe("roleSurfaceHome (CD-01)", () => {
  it.each([
    ["manager", "/strategies"],
    ["allocator", "/allocations"],
    ["both", "/allocations"],
    ["stranger", "/pending-approval"],
    [null, "/pending-approval"],
    [undefined, "/pending-approval"],
  ])("maps role %s to %s", (role, home) => {
    expect(roleSurfaceHome(role)).toBe(home);
  });
});

describe("roleHomeFor (CD-01)", () => {
  const base = {
    role: "allocator",
    allocator_status: "verified",
    manager_status: null,
    is_admin: false,
  };

  it("sends a missing profile to /pending-approval", () => {
    expect(roleHomeFor(null)).toBe("/pending-approval");
  });

  it("sends an unapproved profile to /pending-approval", () => {
    expect(roleHomeFor({ ...base, allocator_status: "newbie" })).toBe(
      "/pending-approval",
    );
  });

  it("sends an approved allocator to /allocations", () => {
    expect(roleHomeFor(base)).toBe("/allocations");
  });

  it("sends an approved manager to /strategies", () => {
    expect(
      roleHomeFor({
        ...base,
        role: "manager",
        allocator_status: null,
        manager_status: "verified",
      }),
    ).toBe("/strategies");
  });

  it("sends an approved both-role user to /allocations", () => {
    expect(
      roleHomeFor({ ...base, role: "both", manager_status: "verified" }),
    ).toBe("/allocations");
  });

  it("sends a profile flagged is_admin to /admin", () => {
    expect(
      roleHomeFor({
        role: null,
        allocator_status: null,
        manager_status: null,
        is_admin: true,
      }),
    ).toBe("/admin");
  });

  it("honours opts.isAdmin for an approved profile", () => {
    expect(roleHomeFor(base, { isAdmin: true })).toBe("/admin");
  });

  it("does not let opts.isAdmin rescue an unapproved profile", () => {
    expect(
      roleHomeFor({ ...base, allocator_status: "newbie" }, { isAdmin: true }),
    ).toBe("/pending-approval");
  });
});
