import { isProfileApproved, type ApprovalProfile } from "@/lib/approval";

/**
 * Phase 199 MANAGERHOME (CD-01, CD-13) - the one role-home decision and the one
 * redirect sanitiser.
 *
 * Pure: no "use client", no server-only import, so the proxy, server pages,
 * client forms and their tests all import the same file.
 *
 * - `roleSurfaceHome(role)`: the role's own surface. Mirrors the map
 *   `requireRolePage` used inline. An unknown role is denied-by-default and
 *   sent to `/pending-approval`, a terminal unguarded route that cannot loop
 *   between the two surface homes.
 * - `roleHomeFor(profile, opts)`: not approved -> `/pending-approval`, admin ->
 *   `/admin`, otherwise `roleSurfaceHome(role)`. Reads no `display_name`:
 *   onboarding stays the caller's job.
 * - `safeRedirectPath(raw)`: the rule `src/proxy.ts` has always applied to the
 *   `redirect` query value (a string, a slash, then a lowercase letter),
 *   extracted so the proxy, the login page and LoginForm share one copy. An
 *   absolute URL, `//host`, `/\host`, an uppercase start, an array or any
 *   non-string returns null and never navigates (CWE-601).
 */

export function roleSurfaceHome(role: string | null | undefined): string {
  switch (role) {
    case "manager":
      return "/strategies";
    case "allocator":
    case "both":
      return "/allocations";
    default:
      return "/pending-approval";
  }
}

export function roleHomeFor(
  profile: ApprovalProfile | null | undefined,
  opts?: { isAdmin?: boolean },
): string {
  if (!isProfileApproved(profile)) return "/pending-approval";
  if (profile?.is_admin || opts?.isAdmin) return "/admin";
  return roleSurfaceHome(profile?.role);
}

export function safeRedirectPath(raw: unknown): string | null {
  return typeof raw === "string" && /^\/[a-z]/.test(raw) ? raw : null;
}
