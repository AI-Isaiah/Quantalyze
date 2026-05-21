import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { isProfileApproved } from "@/lib/approval";
import type { SupabaseClient } from "@supabase/supabase-js";

const FORBIDDEN_PENDING_APPROVAL = "Account pending approval";

/**
 * API-level approval gate (PR #266 red-team follow-up).
 *
 * Returns a 403 NextResponse when the caller's profile is not approved,
 * otherwise `null` (caller proceeds). Always pair with `auth.getUser()`
 * upstream — this helper takes the resolved `userId` so a route handler
 * doesn't pay for a duplicate `getUser()` round-trip.
 *
 * Lives in its own module (rather than sharing the `withAuth.ts` file)
 * for two reasons:
 *
 *   1. Inline-auth routes (`/api/portfolio-optimizer`, `/api/preferences`,
 *      `/api/intro`, ...) need to call the helper directly without
 *      adopting the full `withAuth` wrapper, so the import surface stays
 *      narrow.
 *   2. The vitest setup file (`src/test-setup.ts`) `vi.mock`s this module
 *      so existing route tests don't have to extend their Supabase mock
 *      with the `profiles.maybeSingle()` chain. Tests that specifically
 *      assert the gate behaviour (see
 *      `src/lib/api/withAuth.approval-gate.test.ts`) override the mock.
 */
export async function assertProfileApproved(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allocator_status, manager_status, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!isProfileApproved(profile)) {
    return NextResponse.json(
      { error: FORBIDDEN_PENDING_APPROVAL },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  return null;
}
