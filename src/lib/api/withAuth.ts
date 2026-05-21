import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import * as approvalGate from "@/lib/api/approval-gate";
import type { User } from "@supabase/supabase-js";

// Re-export so existing imports keep working without per-route churn.
export const assertProfileApproved = approvalGate.assertProfileApproved;

type AuthenticatedHandler = (req: NextRequest, user: User) => Promise<NextResponse>;

interface WithAuthOptions {
  /**
   * When `true` (default), the handler refuses requests from authenticated
   * users whose profile has not been approved (the universal-approval gate
   * landed in v0.24.5.18 / PR #266).
   *
   * Without this gate the approval gate was UI-only: a pending-approval
   * user could `curl -b <cookie>` any `/api/*` route and the handler ran
   * because every check stopped at `auth.getUser()`. Opt-out only for
   * routes that LEGITIMATELY serve pending-approval users (e.g. an
   * account-deletion request initiated from the pending-approval page).
   */
  requireApproval?: boolean;
}

const DEFAULT_OPTIONS: Required<WithAuthOptions> = {
  requireApproval: true,
};

export function withAuth(
  handler: AuthenticatedHandler,
  options: WithAuthOptions = {},
) {
  const { requireApproval } = { ...DEFAULT_OPTIONS, ...options };
  return async (req: NextRequest) => {
    // CSRF defense-in-depth on mutating requests (POST/PUT/PATCH/DELETE).
    // GET/HEAD/OPTIONS are safe methods and don't need origin checks.
    //
    // GET routes returning authenticated data (e.g., /api/allocator/*
    // catalogs) rely on:
    //   1. Same-Origin Policy in browsers — a cross-origin <script> or
    //      `fetch()` from evil.com receives the response opaque under
    //      CORS, so the response body is unreadable. The victim's cookies
    //      are sent but the attacker can't see the result.
    //   2. The deliberate absence of `Access-Control-Allow-Origin: *`
    //      on this app's responses. If a future middleware ever adds
    //      permissive CORS to authenticated routes, allocator-scoped
    //      GET data would leak cross-origin even with valid cookies.
    //      Any such middleware MUST opt-out allocator routes.
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const csrfError = assertSameOrigin(req);
      if (csrfError) return csrfError;
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (requireApproval) {
      // Call through the module namespace so `vi.mock("@/lib/api/approval-gate")`
      // in `src/test-setup.ts` can stub the gate for the broad route-test
      // surface without touching each test file. See approval-gate.ts.
      const denied = await approvalGate.assertProfileApproved(supabase, user.id);
      if (denied) return denied;
    }
    return handler(req, user);
  };
}
