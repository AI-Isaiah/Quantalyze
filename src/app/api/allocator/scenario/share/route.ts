/**
 * Phase 25 / Plan 03 / SHARE-01 — allocator scenario share-link GENERATE.
 *
 *   POST /api/allocator/scenario/share  → mint a revocable read-only share link
 *
 * Single-row owner write under RLS — no SECURITY DEFINER RPC. The
 * `scenario_shares` table (migration 20260622120000) carries the
 * `scenario_shares_owner` policy `FOR ALL USING (created_by = auth.uid())
 * WITH CHECK (created_by = auth.uid())`, so the user-scoped supabase client
 * binds every read/write to the caller. `created_by` is ALWAYS `user.id` from
 * `withAllocatorAuth` — a client-forged body `created_by` is dropped (the body
 * schema does not carry the field, and the insert sources it from auth). The
 * RLS WITH CHECK is defense-in-depth (T-25-08).
 *
 * Token discipline (T-25-12): the route mints a 256-bit token via
 * `mintShareToken()` and persists ONLY its sha256 hash (`token_hash`). The RAW
 * token is externalised exactly once — in the returned `{ url }` — and is never
 * logged, never re-fetched, and never stored.
 *
 * One active share per scenario: a pre-revoke UPDATE clears any prior active
 * row (`revoked_at IS NULL`) before the insert, so the partial unique index
 * from migration 25-01 (`UNIQUE (scenario_id) WHERE revoked_at IS NULL`) never
 * trips. The index is the structural backstop; the pre-revoke is the happy
 * path.
 *
 * Conventions copied verbatim from
 * `src/app/api/allocator/scenario/saved/route.ts`:
 *   - B15 ordering: auth (wrapper) → body read/parse → zod validate (400, no
 *     token burned) → rate-limit AFTER validation → user-scoped write.
 *   - Redacted DB-error envelope (F5a/F5b, T-25-09): console.error +
 *     captureToSentry server-side, a stable UI-facing message — NEVER echo
 *     error.message (leaks schema/column names).
 *   - NO_STORE_HEADERS on EVERY response (success + error).
 *   - Rate-limit-misconfig → 503 (not a misleading 429), T-25-10.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { isUuid } from "@/lib/utils";
import { mintShareToken } from "@/lib/scenario-share-token";

export const runtime = "nodejs";

// The origin the share URL is built from. Sourced from NEXT_PUBLIC_APP_URL
// (the demo-pdf precedent, portfolio-pdf/[id]/route.ts:17) — NEVER a hardcoded
// host. Read per-request (not captured at module load) so the resolved origin
// always reflects the running environment. Falls back to localhost only in dev
// where the env var is unset.
function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// The body carries ONLY the scenario_id (uuid). `created_by` is NEVER read from
// the body — it is sourced from auth (T-25-08). The uuid is validated with the
// codebase-canonical `isUuid` (UUID_RE) used by every other allocator route
// that takes a client id (saved/[id]/route.ts), NOT zod v4's `.uuid()`: this
// Next.js ships zod 4, whose `.uuid()` enforces RFC-4122 version/variant bits
// and would reject Postgres-shaped ids that `gen_random_uuid()` and the test
// fixtures legitimately produce. A malformed / absent scenario_id → 400 before
// any token is minted or any rate-limit token is burned.
const ShareBodySchema = z.object({
  scenario_id: z.string().refine(isUuid, { message: "Invalid scenario id" }),
});

export const POST = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch (err) {
      console.error("[scenario-share] body read failed:", err);
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

    const parsed = ShareBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const scenarioId = parsed.data.scenario_id;

    // B15 limiter-ordering — consume the token only AFTER validation. A 400
    // does NOT burn one of the caller's own tokens, and no token is minted
    // before this point.
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

    // Pre-revoke any prior active share for this scenario so the
    // "one active share per scenario" invariant holds and the partial unique
    // index (migration 25-01) never trips. RLS scopes this to the caller
    // (created_by = auth.uid()); a scenario the caller does not own matches 0
    // rows and is a no-op.
    //
    // @audit-skip: internal step of generate, not an independent event. The
    // meaningful action — a (new) share link now exists — is emitted as the
    // single scenario.share audit event after the insert below. A pre-revoke of
    // the prior link is implicit in re-sharing; emitting a separate
    // scenario.share.revoke here would double-log one user gesture.
    const { error: revokeError } = await supabase
      .from("scenario_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("scenario_id", scenarioId)
      .is("revoked_at", null);

    if (revokeError) {
      console.error("scenario_share pre-revoke error", {
        user: user.id,
        message: revokeError.message,
      });
      captureToSentry(revokeError, { tags: { area: "scenario-share" } });
      return NextResponse.json(
        { error: "Share failed", message: "Couldn't create a share link. Try again." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Mint AFTER the limiter + pre-revoke. The raw token lives only in the URL
    // below; only its hash is persisted (T-25-12).
    const { raw, hash } = mintShareToken();

    // created_by is ALWAYS sourced from auth (T-25-08); a body-supplied
    // created_by never reaches here (the body schema strips it). RLS
    // WITH CHECK (created_by = auth.uid()) is defense-in-depth.
    const { data, error } = await supabase
      .from("scenario_shares")
      .insert({
        scenario_id: scenarioId,
        created_by: user.id,
        token_hash: hash,
      })
      .select("id")
      .single();

    if (error) {
      // F5a/F5b / T-25-09 — redact. Log + Sentry server-side; stable UI-facing
      // message to the client. NEVER echo error.message.
      console.error("scenario_share error", { user: user.id, message: error.message });
      captureToSentry(error, { tags: { area: "scenario-share" } });
      return NextResponse.json(
        { error: "Share failed", message: "Couldn't create a share link. Try again." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Fire-and-forget audit (the scenario.* family). Self-owned, RLS-scoped.
    // entity = the shared scenario. Metadata carries NO token / draft content —
    // only the new share row id, mirroring the saved-route privacy posture.
    logAuditEvent(supabase, {
      action: "scenario.share",
      entity_type: "scenario",
      entity_id: scenarioId,
      metadata: { share_id: data.id },
    });

    // The raw token appears ONLY here. No audit log carries the token or any
    // draft content (mirrors the saved-route privacy posture).
    return NextResponse.json(
      { url: `${resolveAppUrl()}/scenario-share/${raw}` },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  },
);
