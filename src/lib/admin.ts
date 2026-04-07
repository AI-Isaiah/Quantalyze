// Admin gate. As of migration 011, we check BOTH the legacy email-based gate AND the new
// profiles.is_admin column. This OR pattern allows zero-downtime rollout — once is_admin
// is fully populated and verified across all admin pages, the email check can be dropped.
// See TODOS.md (P2) and the perfect-match plan Task 1.5 for the deprecation path.

import type { SupabaseClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

/**
 * Email-only check (legacy). Use isAdminUser() for the full check.
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL || !email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/**
 * Full admin check: passes if EITHER the legacy email matches OR the user has
 * profiles.is_admin = true. Hits the DB once for the is_admin lookup.
 *
 * Use this in any new code path. The legacy isAdmin() is kept for callers that
 * already have an email but no Supabase client.
 */
export async function isAdminUser(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!user) return false;

  // Cheap check first: legacy email match
  if (isAdmin(user.email)) return true;

  // DB check: is_admin column on profiles
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (error || !data) return false;
  return data.is_admin === true;
}
