import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { redirect, notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { UserRolesPanel } from "@/components/admin/UserRolesPanel";
import type { AppRole } from "@/lib/auth";

/**
 * /admin/users/[id] — role-provisioning detail page for a single user.
 *
 * Sprint 6 closeout Task 7.2. The page is admin-gated via `isAdminUser`
 * (legacy gate for the page itself; the grant/revoke API it calls uses
 * the new `withRole("admin")` wrapper — see ADR-0005).
 *
 * Next.js 16 async params: `params` is a Promise and must be awaited.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, display_name, company, email, role, is_admin, allocator_status, manager_status, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("user_app_roles")
      .select("role, granted_at, granted_by")
      .eq("user_id", id)
      .order("granted_at", { ascending: true }),
  ]);

  if (!profile) {
    notFound();
  }

  const currentRoles: AppRole[] = (roleRows ?? [])
    .map((r) => r.role as AppRole)
    .filter((r): r is AppRole =>
      ["admin", "allocator", "quant_manager", "analyst"].includes(r),
    );

  // Resolve granter emails so the panel can render "Granted YYYY-MM-DD
  // by <email>" under each active role chip. One SELECT IN(...) — the
  // distinct granter set is small (typically 1-3 admins in the pilot).
  // NULL granted_by rows (backfilled historical rows) are skipped.
  const granterIds = Array.from(
    new Set(
      (roleRows ?? [])
        .map((r) => r.granted_by)
        .filter((gid): gid is string => typeof gid === "string" && gid.length > 0),
    ),
  );
  const granterEmailById = new Map<string, string>();
  if (granterIds.length > 0) {
    const { data: granterRows } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", granterIds);
    for (const row of granterRows ?? []) {
      if (row.email) granterEmailById.set(row.id, row.email);
    }
  }

  const roleMetadata: Partial<
    Record<AppRole, { granted_at: string | null; granter_email: string | null }>
  > = {};
  for (const r of roleRows ?? []) {
    const role = r.role as AppRole;
    if (!currentRoles.includes(role)) continue;
    roleMetadata[role] = {
      granted_at: (r.granted_at as string | null) ?? null,
      granter_email: r.granted_by
        ? (granterEmailById.get(r.granted_by as string) ?? null)
        : null,
    };
  }

  const isSelf = profile.id === user.id;

  return (
    <>
      <PageHeader
        title={profile.display_name ?? "User"}
        description={profile.email ?? undefined}
        meta={
          <>
            {profile.company && (
              <span className="text-xs text-text-muted">
                {profile.company}
              </span>
            )}
            {profile.is_admin && <Badge label="legacy admin" />}
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
        <Card>
          <h2 className="font-display text-xl text-text-primary mb-4">
            Profile
          </h2>
          <dl className="space-y-3 text-sm">
            <Row
              label="Profile role"
              value={profile.role}
            />
            <Row
              label="Allocator status"
              value={profile.allocator_status}
            />
            <Row
              label="Manager status"
              value={profile.manager_status}
            />
            <Row
              label="Legacy is_admin"
              value={profile.is_admin ? "true" : "false"}
            />
            <Row
              label="Created"
              value={new Date(profile.created_at).toLocaleString()}
            />
            <Row
              label="User ID"
              value={profile.id}
              mono
            />
          </dl>
        </Card>

        <Card>
          <h2 className="font-display text-xl text-text-primary mb-2">
            App roles
          </h2>
          <p className="text-xs text-text-muted mb-4">
            Grant or revoke roles. Each change is audited and immediately
            visible to the user on their next login.
          </p>
          <UserRolesPanel
            targetUserId={profile.id}
            currentRoles={currentRoles}
            isSelf={isSelf}
            roleMetadata={roleMetadata}
          />
        </Card>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-[11px] uppercase tracking-wider text-text-muted shrink-0">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "font-mono text-xs text-text-secondary text-right break-all"
            : "text-sm text-text-primary text-right"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
