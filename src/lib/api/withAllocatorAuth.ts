import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "./withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { createClient } from "@/lib/supabase/server";

/**
 * audit-2026-05-07 round-2 Block D (P1946) — allocator role gate.
 *
 * Composes `withAuth`. After the underlying `withAuth` confirms the caller has
 * an auth session (else 401), this wrapper additionally requires the caller's
 * profile to carry an allocator role before invoking the wrapped handler.
 *
 * Role model:
 *   `profiles.role` is the canonical column (migration 001). Values:
 *     'manager' | 'allocator' | 'both' (latter == manager AND allocator).
 *   "Is allocator" is therefore `role IN ('allocator', 'both')`. This matches
 *   the defense-in-depth check already used by `/api/intro` and the SSR
 *   dashboard layout.
 *
 * Response shape — the three failure modes are NOT collapsed into one
 * "Forbidden" response, because doing so makes a real allocator believe they
 * have been demoted whenever Postgres has a hiccup:
 *
 *   - 503 + Cache-Control on profile-lookup DB error. A transient PostgREST
 *     5xx / statement_timeout / RLS misconfig is an infra failure, not a
 *     policy decision. Surfacing it as 403 produces wrong-cause incidents and
 *     misleading "spike in 403s" telemetry. We also report it to Sentry so
 *     SRE notices the underlying outage.
 *   - 403 + Cache-Control with "Profile not provisioned" when the auth user
 *     has no row in `profiles`. Should be impossible for a valid session, so
 *     we report it to Sentry as a soft data-integrity signal.
 *   - 403 + Cache-Control with "Forbidden — allocator role required" when the
 *     profile exists but `role NOT IN ('allocator','both')`. This is the only
 *     branch that legitimately means "you lack the role" and is the only
 *     branch a real user-facing error message should claim that.
 *
 * Why a separate helper:
 *   Three routes (`/api/allocator/scenario/commit`, `/api/strategies/browse`,
 *   and any future allocator-only handler) all need the same gate. Inlining
 *   the profile lookup at each site is the bug pattern audit-2026-05-07 is
 *   designed to retire.
 */

/**
 * Branded user type signalling the allocator-role gate has run. Routes
 * accepting `AllocatorUser` (rather than the bare `User`) cannot be
 * downgraded back to `withAuth` by accident — TypeScript will reject the
 * type narrowing.
 */
export type AllocatorUser = User & { readonly __allocatorRoleVerified: true };

export type AllocatorHandler = (
  req: NextRequest,
  user: AllocatorUser,
) => Promise<NextResponse>;

export function withAllocatorAuth(handler: AllocatorHandler) {
  return withAuth(async (req, user) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      // DB-error branch — fail closed with 503 so SRE sees infra signal and
      // the client knows to retry, NOT with a lying 403 that suggests the
      // caller lost their allocator role.
      console.error("[withAllocatorAuth] profile lookup failed:", {
        user_id: user.id,
        code: error.code,
        message: error.message,
      });
      captureToSentry(error, {
        tags: {
          allocator_gate_failure: "true",
          allocator_gate_kind: "lookup_error",
          allocator_gate_code: error.code ?? "unknown",
        },
        extra: { user_id: user.id, message: error.message ?? "" },
        level: "error",
      });
      return NextResponse.json(
        { error: "Profile lookup failed" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (!data) {
      // Missing profile for an authenticated user — should be impossible
      // under normal provisioning, but if it happens the message must be
      // specific so triage doesn't waste time on the role-assignment runbook.
      const missingErr = new Error("Profile row missing for auth user");
      console.error("[withAllocatorAuth] profile row missing for auth user:", {
        user_id: user.id,
      });
      captureToSentry(missingErr, {
        tags: {
          allocator_gate_failure: "true",
          allocator_gate_kind: "missing_profile",
        },
        extra: { user_id: user.id },
        level: "warning",
      });
      return NextResponse.json(
        { error: "Profile not provisioned" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (data.role !== "allocator" && data.role !== "both") {
      return NextResponse.json(
        { error: "Forbidden — allocator role required" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    // The brand is a phantom property — no runtime effect, but the
    // handler signature `(req, user: AllocatorUser)` now statically
    // requires the gate to have run.
    return handler(req, user as AllocatorUser);
  });
}
