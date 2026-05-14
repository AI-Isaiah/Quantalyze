import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import type { User } from "@supabase/supabase-js";

type AuthenticatedHandler = (req: NextRequest, user: User) => Promise<NextResponse>;

export function withAuth(handler: AuthenticatedHandler) {
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
    return handler(req, user);
  };
}
