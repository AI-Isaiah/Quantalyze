import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "./withAuth";
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

export type AllocatorHandler = (
  req: NextRequest,
  user: User,
) => Promise<NextResponse>;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * Lazy-import Sentry to capture profile-lookup failures and missing-profile
 * states without pulling Sentry into routes that don't otherwise need it.
 * Mirrors the pattern in `src/lib/admin.ts` / `src/lib/audit.ts`.
 */
function reportProfileGateError(
  err: unknown,
  options: {
    kind: "lookup_error" | "missing_profile";
    userId: string;
    code: string | null;
    message: string;
  },
): void {
  try {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(err, {
            tags: {
              allocator_gate_failure: "true",
              allocator_gate_kind: options.kind,
              allocator_gate_code: options.code ?? "unknown",
            },
            extra: {
              user_id: options.userId,
              code: options.code,
              message: options.message,
            },
            level: options.kind === "lookup_error" ? "error" : "warning",
          });
        } catch {
          // Swallow — caller already logged via console.error.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow.
  }
}

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
      reportProfileGateError(error, {
        kind: "lookup_error",
        userId: user.id,
        code: error.code ?? null,
        message: error.message ?? "",
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
      console.error("[withAllocatorAuth] profile row missing for auth user:", {
        user_id: user.id,
      });
      reportProfileGateError(new Error("Profile row missing for auth user"), {
        kind: "missing_profile",
        userId: user.id,
        code: null,
        message: "Profile row missing for auth user",
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

    return handler(req, user);
  });
}
