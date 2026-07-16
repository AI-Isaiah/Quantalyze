import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { captureToSentry } from "@/lib/sentry-capture";
import type { createClient } from "@/lib/supabase/server";

/**
 * Phase 109 ROLE-04 — shared server-side page guard on `profiles.role`.
 *
 * Mirrors `src/lib/api/withAllocatorAuth.ts`'s three-branch failure discipline,
 * except the wrong-role branch substitutes a server `redirect()` (307) for the
 * API's 403 response — a denied user is bounced to their OWN role home surface,
 * never shown a 403 or a half-rendered page.
 *
 * The three branches are deliberately NOT collapsed:
 *   - DB-error branch    → console.error + Sentry (level "error") + THROW to
 *     error.tsx (503-equivalent). NEVER redirects: a transient Postgres hiccup
 *     must not masquerade as "wrong role" and bounce a valid owner off their
 *     own surface.
 *   - missing-profile    → console.error + Sentry soft signal (level "warning")
 *     + THROW. Should be impossible for a valid session; NEVER redirects.
 *   - wrong-role         → `redirect(homeHref)` to the visitor's ACTUAL role
 *     home. This is the ONLY branch that redirects.
 *
 * Role model — this guard targets `profiles.role` (`allocator`|`manager`|`both`),
 * the marketplace persona used by withAllocatorAuth and (dashboard)/layout.tsx.
 * It deliberately does NOT touch the unrelated RBAC join-table system in
 * src/lib/auth.ts.
 *
 * ROLE-03: the guard selects and branches on `role` ONLY. The admin flag grants
 * no marketplace surface here; staff retain access via the `role='both'`
 * backfill.
 *
 * Loop-freedom (RESEARCH.md redirect matrix): `homeHref` is derived INTERNALLY
 * from the user's actual role (never a caller-passed target that could point at
 * an unowned route). `both` owns both surfaces and is never redirected. Any
 * unknown/malformed role is denied-by-default (owns=false, mirroring
 * approval.ts) and sent to `/pending-approval` — a terminal, unguarded route
 * that structurally cannot loop between the two surface homes.
 *
 * CRITICAL — `redirect()` throws NEXT_REDIRECT (Next 16, redirect.md:50-52) and
 * MUST be called OUTSIDE any try/catch, or a wrapping catch swallows it and the
 * wrong-role user renders the page anyway (fail-open). The DB read's error is
 * handled via the returned `error` object (no throw into a catch that also
 * wraps the redirect); the `redirect()` call sits at the top level of the body.
 */
export async function requireRolePage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
  need: "allocator" | "manager",
): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // DB-error branch — surface as an error (→ error.tsx, 503-equivalent) and
    // report to Sentry so SRE sees the infra signal. NEVER redirect: a Postgres
    // hiccup is not a demotion.
    console.error("[requireRolePage] profile lookup failed:", {
      user_id: user.id,
      code: error.code,
      message: error.message,
    });
    captureToSentry(error, {
      tags: {
        role_gate_failure: "true",
        role_gate_kind: "lookup_error",
        role_gate_code: error.code ?? "unknown",
      },
      extra: { user_id: user.id, message: error.message ?? "" },
      level: "error",
    });
    throw error;
  }

  if (!data) {
    // Missing profile for an authenticated user — should be impossible under
    // normal provisioning. Report as a soft data-integrity signal and throw.
    // NEVER redirect.
    const missingErr = new Error("Profile row missing for auth user");
    console.error("[requireRolePage] profile row missing for auth user:", {
      user_id: user.id,
    });
    captureToSentry(missingErr, {
      tags: {
        role_gate_failure: "true",
        role_gate_kind: "missing_profile",
      },
      extra: { user_id: user.id },
      level: "warning",
    });
    throw missingErr;
  }

  const role = data.role;

  // Deny-by-default: any role outside {allocator, manager, both} yields
  // owns=false (mirroring approval.ts's exhaustive-switch default → false).
  const owns =
    need === "allocator"
      ? role === "allocator" || role === "both"
      : role === "manager" || role === "both";

  // Home target derived from the ACTUAL role, never the `need` — internal
  // derivation makes loop-freedom provable in this one file. Unknown/malformed
  // role → terminal /pending-approval (cannot loop between the surface homes).
  const homeHref =
    role === "manager"
      ? "/strategies"
      : role === "allocator"
        ? "/allocations"
        : "/pending-approval";

  // OUTSIDE any try/catch (Pitfall 2): redirect() throws NEXT_REDIRECT.
  if (!owns) redirect(homeHref);
}
