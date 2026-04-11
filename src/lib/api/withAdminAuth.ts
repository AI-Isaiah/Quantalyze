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

    if (!(await isAdminUser(supabase, user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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
