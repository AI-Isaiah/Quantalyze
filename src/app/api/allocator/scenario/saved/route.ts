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
import { logAuditEvent } from "@/lib/audit";
import { scenarioDraftSaveSchema } from "@/app/(dashboard)/allocations/lib/scenario-state";

export const runtime = "nodejs";

// FIX A (HIGH, DoS / storage-poison) — hard byte cap on the raw request body,
// enforced BEFORE JSON.parse so an oversized payload is rejected (413) without
// parsing unbounded input. 256 KB is generous vs a real draft (a fully-loaded
// portfolio draft serialises to a few KB) yet tiny vs a DoS payload. This is
// the route-layer twin of the schema-level `.max()` caps in
// scenarioDraftSchema (defense-in-depth): the schema bounds entry counts, this
// bounds total bytes before any work happens. We chose an inline guard over
// routing through withAuthLimited/readJsonBounded because withAuthLimited
// composes withAuth (NOT withAllocatorAuth) — adopting it would drop the
// allocator-role gate, a security regression and a large refactor. The inline
// guard preserves the existing withAllocatorAuth wrapper + B15 limiter ordering.
export const MAX_DRAFT_BODY_BYTES = 256_000;

// Reuse the canonical draft contract (scenario-state.ts) for the `draft`
// field — do NOT author a second validator. v1.6 MEMBER-01: use the SAVE
// variant (`scenarioDraftSaveSchema`) so a v4 draft POSTed without
// `memberKeyIds` is rejected fail-loud at the save boundary (the codec-decode
// path stays tolerant so upgraded localStorage round-trips are never dropped).
// `name` mirrors the SQL CHECK `length(btrim(name)) between 1 and 120`.
const SaveScenarioBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  draft: scenarioDraftSaveSchema,
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

    // FIX A — reject an oversized body BEFORE JSON.parse (DoS / storage-poison).
    // Measure UTF-8 bytes (Buffer.byteLength), not UTF-16 code units, so a
    // multibyte payload is bounded accurately. No rate-limit token is consumed
    // (the limiter fires AFTER validation, per B15 ordering) and nothing is
    // written.
    if (Buffer.byteLength(rawBody, "utf8") > MAX_DRAFT_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body too large" },
        { status: 413, headers: NO_STORE_HEADERS },
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

    // Self-owned, RLS-scoped scenario create. Fire-and-forget audit (the
    // user_note.* pattern): actor = the allocator (auth.uid() inside the RPC),
    // entity = the new scenario id. Metadata carries no draft contents — only
    // the schema_version + name length, mirroring the notes route's
    // content_length-not-content privacy posture.
    logAuditEvent(supabase, {
      action: "scenario.save",
      entity_type: "scenario",
      entity_id: data.id,
      metadata: {
        schema_version: parsed.data.draft.schema_version,
        name_length: parsed.data.name.length,
      },
    });

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
    // `draft` is included so the saved-scenarios list (Plan 23-05) can Open or
    // Compare a row without a second per-row round-trip — the planner's
    // discretion default in the Plan 23-05 interfaces note. Open decodes the
    // draft through the codec trichotomy at the composer; Compare runs it
    // through computeMetricsForDraft. RLS already scopes the rows to the caller.
    const { data, error } = await supabase
      .from("scenarios")
      .select("id, name, schema_version, created_at, updated_at, draft")
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

    // WR-01 — populate has_active_share per row so the Share/Copy/Revoke
    // affordance (SavedScenariosList, Plan 25-03) survives a reload/refetch.
    // The component reads `row.has_active_share`, but the SELECT above never
    // returned it, so the Share state silently reset to "no active share" on
    // every reload (the comment claiming it was "derived from the saved-
    // scenarios payload" was a false claim). One extra read against
    // scenario_shares (active = revoked_at IS NULL); RLS scopes BOTH reads to
    // the caller (scenario_shares_owner created_by = auth.uid()), so no .eq is
    // needed. A failure to load the share set is NON-FATAL — the rows still
    // render (every row simply defaults to no active share, the prior
    // behaviour) rather than failing the whole list.
    const scenarios = data ?? [];
    const { data: activeShares, error: shareError } = await supabase
      .from("scenario_shares")
      .select("scenario_id")
      .is("revoked_at", null);

    if (shareError) {
      // Non-fatal: log + Sentry, but still return the scenarios (without the
      // active-share flag) rather than 500ing the whole list on a share-lookup
      // hiccup. The list is the primary payload; the share badge is enrichment.
      console.error("scenario_list share-lookup error", {
        user: user.id,
        message: shareError.message,
      });
      captureToSentry(shareError, { tags: { area: "scenario-list" } });
    }

    const activeShareScenarioIds = new Set(
      (activeShares ?? []).map((s) => s.scenario_id),
    );
    const rows = scenarios.map((s) => ({
      ...s,
      has_active_share: activeShareScenarioIds.has(s.id),
    }));

    return NextResponse.json(rows, { status: 200, headers: NO_STORE_HEADERS });
  },
);
