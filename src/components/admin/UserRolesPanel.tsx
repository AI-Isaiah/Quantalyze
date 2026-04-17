"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { APP_ROLES, type AppRole } from "@/lib/auth-types";

/**
 * Role-provisioning panel. Client component rendered inside
 * /admin/users/[id].
 *
 * Sprint 6 closeout Task 7.2. Calls POST /api/admin/users/[id]/roles
 * (which runs under `withRole("admin")`). Emits an audit event per
 * grant/revoke on the server side.
 *
 * UI: one row per role with a checkbox-style toggle. Revoking the
 * current admin's own admin role is blocked on both client (disabled
 * button) and server (400 response). Design system: DM Sans body, navy
 * text, accent teal for the action button.
 *
 * Role source-of-truth: `APP_ROLES` + `AppRole` are imported from
 * `@/lib/auth-types` (server-only-free) so this client component reads
 * the same list as the server-side guard. The labels + descriptions
 * below are UX copy; they're keyed on the `AppRole` literals so adding
 * a new role will fail TypeScript here until a matching `ROLE_META`
 * entry is added.
 */

// UX copy per role. Keyed by `AppRole` so `satisfies Record<AppRole, …>`
// catches any role added to the union without a corresponding entry.
const ROLE_META = {
  admin: {
    label: "Admin",
    description: "Full back-office access. Can grant and revoke roles.",
  },
  allocator: {
    label: "Allocator",
    description:
      "LP-side user. Can request intros, own portfolios, and see factsheets.",
  },
  quant_manager: {
    label: "Quant manager",
    description:
      "Publishes strategies. Manages their own API keys and analytics.",
  },
  analyst: {
    label: "Analyst",
    description:
      "Read-only analyst seat. No mutation surface; views discovery + factsheets.",
  },
} as const satisfies Record<AppRole, { label: string; description: string }>;

// Derive the rendered list from `APP_ROLES` so the display order
// matches the server-side ordering exactly (admin first, analyst last).
const ROLE_DEFINITIONS: ReadonlyArray<{
  role: AppRole;
  label: string;
  description: string;
}> = APP_ROLES.map((role) => ({
  role,
  label: ROLE_META[role].label,
  description: ROLE_META[role].description,
}));

/** Render a `granted_at` ISO timestamp as YYYY-MM-DD in UTC. Using UTC
 * avoids the timezone-jitter that would make "Granted 2026-04-16" on
 * the west coast display as "Granted 2026-04-15" — the grant date is a
 * server-side fact, not a local-time event. */
function formatGrantDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

interface UserRolesPanelProps {
  targetUserId: string;
  currentRoles: AppRole[];
  /** true when the admin is viewing their own page — prevents self-revoke of admin. */
  isSelf: boolean;
  /** Per-role grant metadata for currently-held roles. Undefined or empty
   * when no active roles exist. Keyed by the role literal. */
  roleMetadata?: Partial<
    Record<
      AppRole,
      {
        granted_at: string | null;
        granter_email: string | null;
      }
    >
  >;
}

export function UserRolesPanel({
  targetUserId,
  currentRoles,
  isSelf,
  roleMetadata,
}: UserRolesPanelProps) {
  const router = useRouter();
  const [pendingRole, setPendingRole] = useState<AppRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggle(role: AppRole, currentlyHas: boolean) {
    setError(null);
    setNotice(null);
    setPendingRole(role);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(targetUserId)}/roles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: currentlyHas ? "revoke" : "grant",
            role,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Request failed");
        return;
      }
      setNotice(
        currentlyHas
          ? `Revoked '${role}'`
          : `Granted '${role}'`,
      );
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPendingRole(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-negative" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-positive" role="status">
          {notice}
        </p>
      )}

      <ul className="space-y-2">
        {ROLE_DEFINITIONS.map(({ role, label, description }) => {
          const has = currentRoles.includes(role);
          const selfAdminBlock = isSelf && role === "admin" && has;
          const disabled = pendingRole !== null || selfAdminBlock;
          const grantInfo = has ? roleMetadata?.[role] : undefined;
          return (
            <li
              key={role}
              className="flex items-start justify-between gap-4 border border-border rounded-lg p-4 bg-page"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    {role}
                  </span>
                  {has && (
                    <span className="inline-flex items-center rounded-md bg-accent/10 text-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-1">{description}</p>
                {has && grantInfo && (grantInfo.granted_at || grantInfo.granter_email) && (
                  <p className="text-[11px] text-text-muted mt-1.5">
                    Granted
                    {grantInfo.granted_at
                      ? ` ${formatGrantDate(grantInfo.granted_at)}`
                      : ""}
                    {grantInfo.granter_email
                      ? ` by ${grantInfo.granter_email}`
                      : ""}
                  </p>
                )}
                {selfAdminBlock && (
                  <p className="text-[11px] text-text-muted mt-2 italic">
                    You cannot revoke your own admin role. Ask another admin.
                  </p>
                )}
              </div>
              <div className="shrink-0">
                <Button
                  size="sm"
                  variant={has ? "ghost" : "primary"}
                  disabled={disabled}
                  onClick={() => toggle(role, has)}
                >
                  {pendingRole === role
                    ? "…"
                    : has
                      ? "Revoke"
                      : "Grant"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
