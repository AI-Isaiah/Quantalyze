/**
 * Phase 25 / Plan 03 / SHARE-03 — allocator scenario share-link REVOKE.
 *
 *   POST /api/allocator/scenario/share/revoke  → revoke the active share for a
 *                                                scenario (set revoked_at = now())
 *
 * Owner-scoped single-row UPDATE under RLS — no SECURITY DEFINER RPC. The
 * `scenario_shares_owner` policy scopes every write to `created_by =
 * auth.uid()`, so a scenario the caller does NOT own (or one with no active
 * share) matches 0 rows → 404 (T-25-11 / T-23-10: NOT 403 — the response does
 * not reveal whether the row exists for another tenant; no existence oracle).
 *
 * Revoke sets `revoked_at = now()`; it NEVER hard-deletes (CONTEXT Area 1 — the
 * row is preserved for the audit trail). The `get_shared_scenario` RPC's
 * `revoked_at IS NULL` predicate makes the revoke immediate; the public page's
 * `force-dynamic` + `no-store` means no edge cache outlives it.
 *
 * Conventions copied from saved/[id]/route.ts + share/route.ts:
 *   - scenario_id (uuid) validated FIRST (400 on malformed — maps a would-be
 *     22P02 to a clean non-retryable 400, no schema leak).
 *   - B15 ordering: validate body → rate-limit AFTER validation → write.
 *   - Redacted DB-error envelope (F5a/F5b, T-25-09) + NO_STORE_HEADERS on every
 *     response; rate-limit-misconfig → 503 (T-25-10).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

// The uuid is validated with the codebase-canonical `isUuid` (UUID_RE), NOT
// zod v4's `.uuid()` (which enforces RFC-4122 version/variant bits and would
// reject legitimate Postgres-shaped ids). Matches saved/[id]/route.ts.
const RevokeBodySchema = z.object({
  scenario_id: z.string().refine(isUuid, { message: "Invalid scenario id" }),
});

export const POST = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch (err) {
      console.error("[scenario-share-revoke] body read failed:", err);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let json: unknown;
    try {
      json = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      json = null;
    }

    // Validate the scenario_id FIRST — a malformed uuid is a clean 400 (maps a
    // would-be 22P02 to a non-retryable error, no schema leak) and never burns
    // a rate-limit token.
    const parsed = RevokeBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scenario id" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const scenarioId = parsed.data.scenario_id;

    // B15 limiter-ordering — consume the token only AFTER validation.
    const rl = await checkLimit(userActionLimiter, `scenario_share:${user.id}`);
    if (!rl.success) {
      if (isRateLimitMisconfigured(rl)) {
        return NextResponse.json(
          { error: "Rate limiter unavailable" },
          {
            status: 503,
            headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
          },
        );
      }
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
        },
      );
    }

    const supabase = await createClient();
    // Owner-scoped UPDATE — set revoked_at, NEVER delete (audit trail). RLS
    // already scopes to created_by = auth.uid(); `.is("revoked_at", null)`
    // targets only the currently-active share. `.select("id")` returns the
    // affected rows so a 0-rows match (non-owned / no active share) → 404.
    const { data, error } = await supabase
      .from("scenario_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("scenario_id", scenarioId)
      .is("revoked_at", null)
      .select("id");

    if (error) {
      // F5a/F5b / T-25-09 — redact. NEVER echo error.message.
      console.error("scenario_share_revoke error", { user: user.id, message: error.message });
      captureToSentry(error, { tags: { area: "scenario-share-revoke" } });
      return NextResponse.json(
        { error: "Revoke failed", message: "Couldn't revoke this link. Try again." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // 0 rows → the caller does not own an active share for this scenario → 404
    // (T-25-11: NOT 403, so the response does not reveal existence).
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Share not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json({ success: true }, { status: 200, headers: NO_STORE_HEADERS });
  },
);
