/**
 * Phase 23 / Plan 02 / PERSIST-01 + PERSIST-03 — allocator scenario CRUD.
 *
 *   GET  /api/allocator/scenario/saved  → list the caller's saved scenarios
 *   POST /api/allocator/scenario/saved  → create a named scenario
 *
 * Single-row writes under RLS — no SECURITY DEFINER RPC. The `scenarios`
 * table (migration 20260621120000) carries the `scenarios_owner` policy
 * `FOR ALL USING (allocator_id = auth.uid()) WITH CHECK (allocator_id =
 * auth.uid())`, so the user-scoped supabase client binds every read/write to
 * the caller. `allocator_id` is ALWAYS `user.id` from `withAllocatorAuth` —
 * a client-forged body `allocator_id` is dropped (the body schema does not
 * carry the field, and the insert sources it from auth). The RLS WITH CHECK
 * is defense-in-depth.
 *
 * Conventions copied verbatim from
 * `src/app/api/allocator/scenario/commit/route.ts`:
 *   - B15 ordering: auth (wrapper) → body read/parse → zod validate (400, no
 *     token burned) → rate-limit AFTER validation → user-scoped write.
 *   - Redacted DB-error envelope (F5a/F5b): console.error + captureToSentry
 *     server-side, a stable UI-facing message — NEVER echo error.message
 *     (leaks schema/column names).
 *   - NO_STORE_HEADERS on EVERY response (success + error) so allocator
 *     payloads never hit a shared cache.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { scenarioDraftSchema } from "@/app/(dashboard)/allocations/lib/scenario-state";

export const runtime = "nodejs";

// Reuse the canonical draft contract (scenario-state.ts) for the `draft`
// field — do NOT author a second validator. `name` mirrors the SQL CHECK
// `length(btrim(name)) between 1 and 120`.
const SaveScenarioBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  draft: scenarioDraftSchema,
});

// ---------------------------------------------------------------------------
// POST — create a named scenario
// ---------------------------------------------------------------------------

export const POST = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch (err) {
      console.error("[scenario-save] body read failed:", err);
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

    const parsed = SaveScenarioBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // B15 limiter-ordering — consume the token only AFTER validation. A 400
    // does NOT burn one of the caller's own tokens.
    const rl = await checkLimit(userActionLimiter, `scenario_save:${user.id}`);
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
    // allocator_id is ALWAYS sourced from auth (T-23-05); a body-supplied
    // allocator_id never reaches here (the body schema strips it). RLS
    // WITH CHECK (allocator_id = auth.uid()) is defense-in-depth.
    const { data, error } = await supabase
      .from("scenarios")
      .insert({
        allocator_id: user.id,
        name: parsed.data.name,
        draft: parsed.data.draft as unknown as Json,
        schema_version: parsed.data.draft.schema_version,
      })
      .select("id, name, created_at, updated_at, schema_version")
      .single();

    if (error) {
      // F5a/F5b — redact. Log + Sentry server-side; stable UI-SPEC message
      // to the client. NEVER echo error.message.
      console.error("scenario_save error", { user: user.id, message: error.message });
      captureToSentry(error, { tags: { area: "scenario-save" } });
      return NextResponse.json(
        {
          error: "Save failed",
          message: "Couldn't save this scenario. Check your connection and try again.",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
  },
);

// ---------------------------------------------------------------------------
// GET — list the caller's saved scenarios (RLS-scoped, newest first)
// ---------------------------------------------------------------------------

export const GET = withAllocatorAuth(
  async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    const supabase = await createClient();
    // RLS scopes the SELECT to the caller (allocator_id = auth.uid()); no
    // explicit .eq needed, but the policy is the gate. Ordered by recency.
    const { data, error } = await supabase
      .from("scenarios")
      .select("id, name, schema_version, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("scenario_list error", { user: user.id, message: error.message });
      captureToSentry(error, { tags: { area: "scenario-list" } });
      return NextResponse.json(
        {
          error: "Load failed",
          message: "Couldn't load your saved scenarios. Check your connection and try again.",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(data ?? [], { status: 200, headers: NO_STORE_HEADERS });
  },
);
