import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * POST /api/allocator/holdings/sync — Phase 06 / D-14 / INGEST-06.
 *
 * Allocator-initiated trigger to enqueue a `poll_allocator_positions`
 * compute job for a specific api_key. The thin route:
 *
 *   1. Validates body `{ api_key_id: uuid }` via zod.
 *   2. Invokes the SECURITY DEFINER wrapper RPC (see migration 066 Step 7)
 *      via the **user-scoped** Supabase client. The RPC is GRANTed to
 *      `authenticated` and runs its own `auth.uid()` ownership check +
 *      idempotent enqueue + `api_keys.sync_status='syncing'` update +
 *      (on 23505 unique_violation) returns the already-inflight shape
 *      carrying `next_attempt_at`. No separate ownership SELECT from the
 *      route — the RPC owns it (defense in depth alongside owner-RLS +
 *      the f5 coherence trigger).
 *   3. Emits the sync-requested audit event fire-and-forget on the
 *      success path (D-18).
 *   4. Passes the RPC JSONB body through to the client verbatim so both
 *      `{ ok, job_id }` and `{ already_inflight: true, next_attempt_at }`
 *      are preserved. f8: Plan 04's sync-status pill discriminates on
 *      the already-inflight key and consumes `next_attempt_at` to render
 *      "Queued — retry in {N}s" during rate-limit contagion windows.
 *
 * Architectural delta from `src/app/api/keys/sync/route.ts`: that route
 * uses a service-role client for `enqueue_compute_job` (REVOKEd from
 * authenticated). THIS route uses `createClient()` because the wrapper
 * RPC is GRANTed to authenticated and gates on `auth.uid()` internally —
 * a service-role caller would see `auth.uid() IS NULL` and trip the
 * `'not_authenticated'` branch (SQLSTATE 42501).
 */

const BodySchema = z.object({
  api_key_id: z.string().uuid(),
});

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // Body validation (D-14). `req.json()` can throw on malformed JSON; the
  // `.catch(() => null)` collapses that into a clean 400 via safeParse.
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body: api_key_id must be a UUID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const { api_key_id } = parsed.data;

  // User-scoped client — the RPC is GRANTed to `authenticated` and runs
  // its own auth.uid() ownership check + idempotent enqueue via the
  // `compute_jobs_one_inflight_per_kind_api_key` partial unique index
  // (23505 → { already_inflight, next_attempt_at } per f8).
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "request_allocator_holdings_sync",
    { p_api_key_id: api_key_id },
  );

  if (error) {
    // SQLSTATE '42501' covers both branches the RPC raises explicitly:
    //   - 'not_authenticated' (auth.uid() IS NULL — shouldn't happen under
    //     withAuth, but belt-and-suspenders)
    //   - 'api_key_not_found_or_not_owned' (ownership mismatch)
    // Both map to 403 from the allocator's perspective.
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "API key not found or not owned by you" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    console.error(
      `[allocator/holdings/sync] RPC failed for user ${user.id} key ${api_key_id}:`,
      error,
    );
    return NextResponse.json(
      { error: "Could not start sync. Try again in a moment." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // D-18: audit the user-intent "start an allocator holdings sync" action
  // on the success path only. logAuditEvent is fire-and-forget via after()
  // and never throws to the caller. User-scoped client here so the audit
  // row's user_id resolves to auth.uid() inside log_audit_event.
  logAuditEvent(supabase, {
    action: "allocator.holdings.sync_requested",
    entity_type: "api_key",
    entity_id: api_key_id,
  });

  // D-10 + f8: RPC returns either { ok: true, job_id } on fresh enqueue
  // OR { already_inflight: true, next_attempt_at } on dup. Pass the JSONB
  // body through VERBATIM so Plan 04's AllocatorSyncStatus pill can
  // discriminate on `already_inflight` AND consume `next_attempt_at` to
  // render the "Queued — retry in {N}s" helper during rate-limit
  // contagion windows. Do NOT rebuild the object here — any field-level
  // reconstruction would strip `next_attempt_at`.
  return NextResponse.json(data, { status: 200, headers: NO_STORE_HEADERS });
});
