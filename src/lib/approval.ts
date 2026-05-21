/**
 * Universal signup-approval gate (task #14, dogfood report 2026-05-21).
 *
 * Every new signup defaults to `{allocator,manager}_status = 'newbie'`
 * via the profiles schema default. Admin approval flips the matching
 * status to `'verified'` (see /api/admin/allocator-approve and the
 * sibling /api/admin/manager-approve route). The dashboard layout +
 * onboarding page call `isProfileApproved` and redirect pending users to
 * `/pending-approval`.
 *
 * Why one helper instead of inlining the check at each call site: the
 * `role='both'` branch needs BOTH statuses to be 'verified' — a future
 * caller that checks only the manager side would silently let a `both`
 * user with verified manager + unverified allocator through. One helper
 * keeps the role/status truth table in one file.
 */

export interface ApprovalProfile {
  role: string | null;
  allocator_status: string | null;
  manager_status: string | null;
  is_admin: boolean;
}

export function isProfileApproved(
  profile: ApprovalProfile | null | undefined,
): boolean {
  if (!profile) return false;
  // Admin override: admins are always approved regardless of status fields.
  // Mirrors the existing isAdminUser() escape hatch used by every admin
  // route — applying the new gate to admins would lock the operator out
  // of the very screen used to approve other users.
  if (profile.is_admin) return true;
  const allocatorOk = profile.allocator_status === "verified";
  const managerOk = profile.manager_status === "verified";
  switch (profile.role) {
    case "allocator":
      return allocatorOk;
    case "manager":
      return managerOk;
    case "both":
      return allocatorOk && managerOk;
    default:
      // Unknown role → fail-closed. A malformed profile should not bypass
      // the gate. If a legitimate new role lands later, this switch must
      // be updated explicitly rather than relying on a permissive default.
      return false;
  }
}
