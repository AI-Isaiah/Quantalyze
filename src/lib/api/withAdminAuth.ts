import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ZodType } from "zod";

type AdminHandler<T> = (
  body: T,
  admin: SupabaseClient,
  // B4b: the verified acting admin. Handlers that mutate via the `admin`
  // (service-role) client must audit via logAuditEventAsUser(admin, user.id, …)
  // — JWT-immune — not a user-JWT logAuditEvent that drops in the after() window.
  user: User,
) => Promise<NextResponse>;

export interface WithAdminAuthOptions<T> {
  /**
   * audit-2026-05-07 (PR-2 2026-05-28) — opt-in per-surface rate limit.
   *
   * When supplied, the wrapper calls `checkLimit(adminActionLimiter, key)`
   * after the body is parsed AND validated (B15b ordering — see below). The
   * key MUST already include the surface name (e.g. `admin-fql-process:`) —
   * only the trailing user id is appended here. Returning `null` from this
   * callback opts the call out of rate limiting for one specific request
   * (currently unused; kept for forward-compat with conditional opt-outs).
   *
   * The per-route inline limiters (preferences, kill-switch, decisions)
   * deliberately do NOT use this hook — they need bespoke per-target-user
   * key shapes that depend on URL params unavailable here.
   */
  rateLimitKey?: (user: { id: string }) => string | null;
  /**
   * B15b (audit-2026-05-07) — optional Zod schema for the request body. When
   * supplied, the parsed body is validated BEFORE the `rateLimitKey` limiter
   * consumes a token, so a schema-invalid admin request returns 400 without
   * burning the admin's bucket (the canonical auth → validate → limit order,
   * mirroring `withAuthLimited` for the authenticated user surface). The typed
   * result is passed to the handler. Omit for routes that do their own
   * in-handler validation — the handler then receives the raw object
   * (`Record<string, unknown>`), which is the backward-compatible default.
   */
  schema?: ZodType<T>;
}

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
export function withAdminAuth<T = Record<string, unknown>>(
  handler: AdminHandler<T>,
  options: WithAdminAuthOptions<T> = {},
) {
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

    // B15b (audit-2026-05-07): parse AND validate the body BEFORE the
    // limiter. Pre-B15b the wrapper consumed a rate-limit token before
    // parsing, so a malformed/schema-invalid admin request burned one of the
    // caller's own adminActionLimiter tokens (20/min) and then got a 400 — a
    // buggy client retrying on 400 could 429 the admin's next legitimate
    // action. Validating first makes "invalid input cannot consume a token"
    // hold by construction for any route that adopts this wrapper, mirroring
    // `withAuthLimited` on the authenticated user surface.
    let parsedBody: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      }
      parsedBody = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Schema validation (when supplied) runs before the limiter too, so a
    // well-formed-object-but-schema-invalid body (e.g. a non-UUID id) is also
    // rejected 400 without a token. Schema-less routes get the raw object.
    let body = parsedBody as unknown as T;
    if (options.schema) {
      const result = options.schema.safeParse(parsedBody);
      if (!result.success) {
        return NextResponse.json(
          { error: "Invalid request body", issues: result.error.issues },
          { status: 400 },
        );
      }
      body = result.data;
    }

    // audit-2026-05-07 (PR-2 2026-05-28): opt-in rate limit on admin
    // mutators routed through this wrapper. The key shape is per-route;
    // the wrapper just consumes whatever the caller provides. B15b: this
    // now fires only AFTER the body parses + validates above.
    //
    // Red-team C1 (2026-05-28): tighten the truthy check so an empty
    // string (e.g. a buggy caller `(u) => process.env.X ?? ""`) does
    // NOT silently bypass the limiter. Only the documented `null` opt-out
    // is honored; everything else must be a non-empty string.
    if (options.rateLimitKey) {
      const surfaceKey = options.rateLimitKey({ id: user.id });
      if (surfaceKey !== null && surfaceKey !== undefined) {
        if (typeof surfaceKey !== "string" || surfaceKey.length < 1) {
          console.error(
            "[withAdminAuth] rateLimitKey returned non-string or empty value — failing closed",
            { surfaceKey: typeof surfaceKey },
          );
          return NextResponse.json(
            { error: "Rate limiter misconfigured" },
            { status: 503 },
          );
        }
        const rl = await checkLimit(adminActionLimiter, surfaceKey);
        if (!rl.success) return rateLimitDenyJson(rl);
      }
    }

    const admin = createAdminClient();
    return handler(body, admin, user);
  };
}
