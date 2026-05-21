import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminHandler = (
  body: Record<string, unknown>,
  admin: SupabaseClient
) => Promise<NextResponse>;

export function withAdminAuth(handler: AdminHandler) {
  return async (request: Request): Promise<NextResponse> => {
    // CSRF defense-in-depth: admin routes are always mutating (POST).
    const csrfError = assertSameOrigin(request as NextRequest);
    if (csrfError) return csrfError;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Audit-2026-05-07 C-0146 (api-contract c9): split unauthenticated
    // (RFC 7235 → 401) from forbidden (RFC 7231 → 403). The pre-fix gate
    // unified both into a single 403 "Unauthorized" envelope, conflating
    // "missing JWT" with "JWT present but caller is not admin". Every
    // route built on this wrapper (allocator-approve, strategy-review,
    // intro-request, for-quants-leads/process, etc.) inherited the
    // contract bug. Mirror withAuth.ts and requireRole() in src/lib/auth.ts
    // which both already get this right.
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdminUser(supabase, user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const admin = createAdminClient();
    return handler(body, admin);
  };
}
