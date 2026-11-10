import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { roleHomeFor } from "@/lib/routing/role-home";

/**
 * Phase 199 MANAGERHOME (CD-01, CD-07, CD-08) - the one server role-home
 * redirect.
 *
 * The proxy is cookie-only (no DB read), and error boundaries, the marketing
 * header and the client LoginForm have no profile in hand, so each of them
 * links here and this page redirects by `roleHomeFor`: allocator to
 * /allocations, manager to /strategies, admin (role both included) to /admin,
 * an unapproved profile to /pending-approval, a signed-out visit to /.
 *
 * Admin is decided by the one call the admin page guards make, `isAdminUser`,
 * with no separate `profiles.is_admin` short-circuit, so /home and a refused
 * admin page ask the same question (T-199-08). They differ on a database
 * error only: the admin pages keep the fail-closed default (false, and a
 * Sentry report), while /home passes `{ strict: true }` and throws to the
 * error boundary. It never reads an error as "not admin", because that would
 * override a true `profiles.is_admin` and land an admin on a non-admin home
 * or /pending-approval. A sustained failure therefore ends at the error
 * boundary, and only a read that flaps between two requests can still bounce
 * a user between /home and a refused admin page, one wrong landing at a time.
 *
 * A failed profile read throws to the error boundary. It never redirects: a
 * Postgres hiccup must not send a valid user to a guessed home (T-199-09). A
 * missing profile row is impossible for a valid session, so it throws too
 * (never /pending-approval), as `requireRolePage` and /strategies do.
 *
 * `redirect()` throws NEXT_REDIRECT and sits outside every try/catch, or the
 * catch would swallow it and the page would render nothing.
 */
export const dynamic = "force-dynamic";

export default async function RoleHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, allocator_status, manager_status, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[home] profile lookup failed:", {
      user_id: user.id,
      code: error.code,
      message: error.message,
    });
    captureToSentry(error, {
      tags: { route: "home", stage: "profile" },
      extra: { user_id: user.id, message: error.message ?? "" },
      level: "error",
    });
    throw error;
  }

  if (!profile) {
    const missing = new Error("Profile row missing for auth user");
    console.error("[home] profile row missing for auth user:", {
      user_id: user.id,
    });
    captureToSentry(missing, {
      tags: { route: "home", stage: "profile-missing" },
      extra: { user_id: user.id },
      level: "warning",
    });
    throw missing;
  }

  let isAdmin: boolean;
  try {
    isAdmin = await isAdminUser(supabase, user, { strict: true });
  } catch (err) {
    // A failed admin read must not land an admin on a non-admin home.
    console.error("[home] isAdminUser failed:", err);
    captureToSentry(err, {
      tags: { route: "home", stage: "admin" },
      extra: { user_id: user.id },
      level: "error",
    });
    throw err;
  }

  // `is_admin` is overridden so the one `isAdminUser` answer decides both the
  // approval short-circuit and the /admin destination in `roleHomeFor`.
  redirect(roleHomeFor({ ...profile, is_admin: isAdmin }, { isAdmin }));
}
