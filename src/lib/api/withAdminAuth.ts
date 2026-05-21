import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEventAsUser } from "@/lib/audit";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminHandler = (
  body: Record<string, unknown>,
  admin: SupabaseClient
) => Promise<NextResponse>;

/**
 * Admin route wrapper. Combines CSRF check, auth/role gate, and JSON
 * body parsing into a single composable so every /api/admin/* route
 * uses the same hardened entry path.
 *
 * audit-2026-05-07 (admin-auth cluster) — three fixes folded into this
 * wrapper in one pass:
 *
 *   1. 401 vs 403 distinction. Pre-fix the wrapper returned 403 for
 *      BOTH the "no session" case and the "session but not admin" case.
 *      That conflation breaks the HTTP semantics monitoring + WAF rules
 *      lean on: 401 means "no credentials, please present some" while
 *      403 means "credentials present and recognized, but not allowed".
 *      Anomaly detectors and rate limiters treat the two very differently
 *      (a burst of 401s is a brute-force attempt; a burst of 403s is a
 *      privilege-escalation probe). Now: no user → 401, user but not
 *      admin → 403.
 *
 *   2. Silent admin-bypass attempt. The non-admin reject path used to
 *      return the 403 with no forensic trace. A compromised non-admin
 *      account probing /api/admin/* endpoints would generate identical
 *      403s with no observable signal beyond raw HTTP logs. We now emit
 *      an `admin.access.denied` audit_log row on EVERY denial that has
 *      an attributable user — the unauthenticated case (no user_id to
 *      attribute) deliberately does NOT write an audit row (the request
 *      is rejected at the auth layer with nothing to anchor; flood-
 *      logging there is a DoS surface). The audit emission is fire-and-
 *      forget via `logAuditEventAsUser` so a logging hiccup cannot fail
 *      the rejection.
 *
 *   3. Body guard. (Already in place pre-this-pass — kept intact.)
 *      Non-object JSON payloads (null, arrays, primitives) get a clean
 *      400 instead of crashing the handler with `const { id } = body`
 *      against a primitive.
 */
export function withAdminAuth(handler: AdminHandler) {
  return async (request: Request): Promise<NextResponse> => {
    // CSRF defense-in-depth: admin routes are always mutating (POST).
    const csrfError = assertSameOrigin(request as NextRequest);
    if (csrfError) return csrfError;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Audit-2026-05-07 C-0146: split unauthenticated (401) from
    // forbidden (403). The unauthenticated path intentionally does NOT
    // write audit_log — the request has no attributable user_id, and
    // flooding audit_log from the unauth path is a DoS surface.
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdminUser(supabase, user))) {
      // Forensic anchor on every admin-route denial that has an
      // attributable user. Service-role client because user-scoped
      // would be RLS-rejected on audit_log. Fire-and-forget.
      const adminClient = createAdminClient();
      logAuditEventAsUser(adminClient, user.id, {
        action: "admin.access.denied",
        entity_type: "user",
        entity_id: user.id,
        metadata: {
          path: new URL(request.url).pathname,
          method: request.method,
          email: user.email ?? null,
        },
      });
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
