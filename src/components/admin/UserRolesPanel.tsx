"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

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
 */

// Keep the literal list in sync with `AppRole` in src/lib/auth.ts.
// Client components can't import from a "server-only" module so we
// duplicate the runtime array here. The server-side Zod schema in the
// API route is the authoritative gate — this client list is UX only.
const ROLE_DEFINITIONS: Array<{ role: AppRole; label: string; description: string }> = [
  {
    role: "admin",
    label: "Admin",
    description: "Full back-office access. Can grant and revoke roles.",
  },
  {
    role: "allocator",
    label: "Allocator",
    description:
      "LP-side user. Can request intros, own portfolios, and see factsheets.",
  },
  {
    role: "quant_manager",
    label: "Quant manager",
    description:
      "Publishes strategies. Manages their own API keys and analytics.",
  },
  {
    role: "analyst",
    label: "Analyst",
    description:
      "Read-only analyst seat. No mutation surface; views discovery + factsheets.",
  },
];

type AppRole = "admin" | "allocator" | "quant_manager" | "analyst";

interface UserRolesPanelProps {
  targetUserId: string;
  currentRoles: AppRole[];
  /** true when the admin is viewing their own page — prevents self-revoke of admin. */
  isSelf: boolean;
}

export function UserRolesPanel({
  targetUserId,
  currentRoles,
  isSelf,
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
