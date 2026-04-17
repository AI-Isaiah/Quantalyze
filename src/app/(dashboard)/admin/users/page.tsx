import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

/**
 * /admin/users — admin-only list of all users with their current role
 * assignments. Drill-in to /admin/users/[id] to grant/revoke roles.
 *
 * Sprint 6 closeout Task 7.2. Uses `isAdminUser` (legacy gate) because
 * this page predates the Sprint 7 `withRole` rollout. The underlying
 * grant/revoke route DOES use `withRole("admin")` — the pilot site
 * referenced in ADR-0005.
 */
export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  const [{ data: profiles }, { data: roleRows }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, company, email, is_admin, role, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("user_app_roles").select("user_id, role"),
  ]);

  // Build a lookup map so the template doesn't need a per-row DB trip.
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  const rows = profiles ?? [];

  return (
    <>
      <PageHeader
        title="Users"
        description="Grant or revoke app roles. Changes are audited."
      />

      <Card padding="sm">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-text-muted text-sm">
            No users found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Profile role</th>
                  <th className="px-4 py-3 font-medium">App roles</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const appRoles = rolesByUser.get(p.id) ?? [];
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0 hover:bg-page transition-colors"
                    >
                      <td className="px-4 py-3 text-text-primary font-medium">
                        {p.display_name}
                        {p.company && (
                          <span className="ml-2 text-text-muted text-xs">
                            ({p.company})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs font-mono">
                        {p.email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {p.role}
                        {p.is_admin && (
                          <Badge label="legacy admin" className="ml-2" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {appRoles.length === 0 ? (
                          <span className="text-text-muted text-xs italic">
                            none
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {appRoles.map((r) => (
                              <Badge key={r} label={r} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/users/${p.id}`}
                          className="text-xs text-accent hover:underline underline-offset-4"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
