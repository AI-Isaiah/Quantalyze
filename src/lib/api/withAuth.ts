import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import type { User } from "@supabase/supabase-js";

type AuthenticatedHandler = (req: NextRequest, user: User) => Promise<NextResponse>;

export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest) => {
    // CSRF defense-in-depth on mutating requests (POST/PUT/PATCH/DELETE).
    // GET/HEAD/OPTIONS are safe methods and don't need origin checks.
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const csrfError = assertSameOrigin(req);
      if (csrfError) return csrfError;
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, user);
  };
}
