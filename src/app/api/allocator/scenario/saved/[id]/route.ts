/**
 * Phase 23 / Plan 02 / PERSIST-03 — per-scenario CRUD by id.
 *
 *   PATCH  /api/allocator/scenario/saved/[id]  → rename
 *   PUT    /api/allocator/scenario/saved/[id]  → update draft (the "Update
 *                                                scenario" gesture)
 *   DELETE /api/allocator/scenario/saved/[id]  → delete
 *
 * AGENTS.md / Next.js async dynamic params: in this Next.js the `[id]` route
 * param is a Promise on the route context — `ctx.params` must be awaited
 * (verified against node_modules/next/dist/docs/.../route.md:82-90). The
 * `withAuth`/`withAllocatorAuth` wrappers do NOT forward the route context
 * (they call the handler with `(req, user)` only — see withAuth.ts:37,72), so
 * each exported handler awaits `ctx.params` itself, validates the uuid, then
 * delegates to a `withAllocatorAuth`-wrapped inner handler invoked with `req`
 * while closing over the validated id. This mirrors the watchlist [strategyId]
 * route's "params is a Promise; validate before the DB call" pattern while
 * keeping the allocator-role gate.
 *
 * Conventions copied from saved/route.ts + commit/route.ts:
 *   - uuid id validated FIRST (400 on malformed — maps a would-be 22P02 to a
 *     clean non-retryable 400, no schema leak; runs before auth/rate-limit so
 *     structurally bad input never burns a token).
 *   - B15 ordering: validate body → rate-limit AFTER validation → write.
 *   - RLS (scenarios_owner) scopes every write to the owner. A row the caller
 *     does NOT own matches 0 rows → 404 (T-23-10: NOT 403 — do not reveal
 *     existence).
 *   - PUT touches updated_at = now() in the route payload (no set_updated_at
 *     trigger — avoids the dump-sql-functions snapshot gate; 23-01 decision).
 *   - Redacted DB-error envelope (F5a/F5b) + NO_STORE_HEADERS on every
 *     response.
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
import { isUuid } from "@/lib/utils";
import { scenarioDraftSchema } from "@/app/(dashboard)/allocations/lib/scenario-state";
import { MAX_DRAFT_BODY_BYTES } from "../route";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// FIX A (HIGH, DoS / storage-poison) — sentinel returned by readBody when the
// raw body exceeds MAX_DRAFT_BODY_BYTES. Distinct from `undefined` (body read
// failure → 400) and `null` (empty body) so PATCH/PUT can map it to 413.
const BODY_TOO_LARGE = Symbol("body_too_large");

// PostgREST "no rows returned" from a .single() on an update that matched 0
// rows. Under RLS a non-owned (or non-existent) id is filtered out of the
// caller's view, so the update matches nothing → PGRST116 → surface as 404
// (T-23-10: not 403, so the response does not reveal whether the id exists
// for another tenant).
const PGRST_NO_ROWS = "PGRST116";

// Shared by PATCH and PUT — name mirrors the SQL CHECK length(btrim(name))
// between 1 and 120. The UI-SPEC copy is surfaced on the over-length path.
const NameSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter a name for this scenario." })
  .max(120, { message: "Scenario names are limited to 120 characters." });

const RenameBodySchema = z.object({ name: NameSchema });
const UpdateBodySchema = z.object({ name: NameSchema, draft: scenarioDraftSchema });

function badId(): NextResponse {
  return NextResponse.json(
    { error: "Invalid scenario id" },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

async function readBody(req: NextRequest): Promise<unknown> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return undefined; // signals a 400 to the caller (distinct from null body)
  }
  // FIX A — reject an oversized body BEFORE JSON.parse (DoS / storage-poison).
  // UTF-8 bytes, not UTF-16 code units. The caller maps BODY_TOO_LARGE → 413
  // before consuming a rate-limit token or writing anything.
  if (Buffer.byteLength(rawBody, "utf8") > MAX_DRAFT_BODY_BYTES) {
    return BODY_TOO_LARGE;
  }
  if (rawBody === "") return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function bodyTooLarge(): NextResponse {
  return NextResponse.json(
    { error: "Request body too large" },
    { status: 413, headers: NO_STORE_HEADERS },
  );
}

async function denyRateLimit(userId: string): Promise<NextResponse | null> {
  const rl = await checkLimit(userActionLimiter, `scenario_save:${userId}`);
  if (rl.success) return null;
  if (isRateLimitMisconfigured(rl)) {
    return NextResponse.json(
      { error: "Rate limiter unavailable" },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
  );
}

// ---------------------------------------------------------------------------
// PATCH — rename
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return badId();

  return withAllocatorAuth(
    async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
      const body = await readBody(req);
      if (body === BODY_TOO_LARGE) return bodyTooLarge();
      if (body === undefined) {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      const parsed = RenameBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request body", issues: parsed.error.issues },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      const denied = await denyRateLimit(user.id);
      if (denied) return denied;

      const supabase = await createClient();
      const { data, error } = await supabase
        .from("scenarios")
        .update({ name: parsed.data.name })
        .eq("id", id)
        .select("id, name, schema_version, created_at, updated_at")
        .single();

      if (error) {
        if (error.code === PGRST_NO_ROWS) {
          return NextResponse.json(
            { error: "Scenario not found" },
            { status: 404, headers: NO_STORE_HEADERS },
          );
        }
        console.error("scenario_rename error", { user: user.id, message: error.message });
        captureToSentry(error, { tags: { area: "scenario-rename" } });
        return NextResponse.json(
          {
            error: "Rename failed",
            message: "Couldn't rename this scenario. Check your connection and try again.",
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}

// ---------------------------------------------------------------------------
// PUT — update draft (touch updated_at in the route payload)
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return badId();

  return withAllocatorAuth(
    async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
      const body = await readBody(req);
      if (body === BODY_TOO_LARGE) return bodyTooLarge();
      if (body === undefined) {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      const parsed = UpdateBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request body", issues: parsed.error.issues },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      const denied = await denyRateLimit(user.id);
      if (denied) return denied;

      const supabase = await createClient();
      // Touch updated_at = now() in the payload — there is no set_updated_at
      // trigger (23-01 decision: a trigger fn trips the dump-sql-functions
      // snapshot gate). schema_version follows the new draft.
      const { data, error } = await supabase
        .from("scenarios")
        .update({
          name: parsed.data.name,
          draft: parsed.data.draft as unknown as Json,
          schema_version: parsed.data.draft.schema_version,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, name, schema_version, created_at, updated_at")
        .single();

      if (error) {
        if (error.code === PGRST_NO_ROWS) {
          return NextResponse.json(
            { error: "Scenario not found" },
            { status: 404, headers: NO_STORE_HEADERS },
          );
        }
        console.error("scenario_update error", { user: user.id, message: error.message });
        captureToSentry(error, { tags: { area: "scenario-update" } });
        return NextResponse.json(
          {
            error: "Update failed",
            message: "Couldn't update this scenario. Check your connection and try again.",
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return badId();

  return withAllocatorAuth(
    async (_req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
      const denied = await denyRateLimit(user.id);
      if (denied) return denied;

      const supabase = await createClient();
      // .select() returns the deleted rows; under RLS a non-owned id matches
      // 0 rows → 404 (T-23-10: existence-oracle mitigation — not 403).
      const { data, error } = await supabase
        .from("scenarios")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) {
        console.error("scenario_delete error", { user: user.id, message: error.message });
        captureToSentry(error, { tags: { area: "scenario-delete" } });
        return NextResponse.json(
          {
            error: "Delete failed",
            message: "Couldn't delete this scenario. Check your connection and try again.",
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "Scenario not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json({ success: true }, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
