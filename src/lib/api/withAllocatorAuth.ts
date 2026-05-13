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
 *   (The original round-2 plan text referenced a `profiles.user_type` column;
 *   no such column exists in this schema. The plan's intent is "block non-
 *   allocators", which this `role`-based check delivers — see CLAUDE Rule 11:
 *   match the codebase's conventions.)
 *
 * Response shape:
 *   - 403 + `Cache-Control: private, no-store` when the profile is missing OR
 *     when role is not allocator/both. The cache header keeps a stale role
 *     change from being served from any intermediary cache.
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

const FORBIDDEN_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function withAllocatorAuth(handler: AllocatorHandler) {
  return withAuth(async (req, user) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error || !data || (data.role !== "allocator" && data.role !== "both")) {
      return NextResponse.json(
        { error: "Forbidden — allocator role required" },
        {
          status: 403,
          headers: FORBIDDEN_HEADERS,
        },
      );
    }

    return handler(req, user);
  });
}
