import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { retryOnceOnSerializationFailure } from "@/lib/supabase/retry-serialization-failure";

/**
 * POST /api/allocator/holdings/sync — Phase 06 / D-14 / INGEST-06.
 *
 * Allocator-initiated trigger to enqueue a `poll_allocator_positions`
 * compute job for a specific api_key. The thin route:
 *
 *   1. Validates body `{ api_key_id: uuid }` via zod.
 *   2. Invokes the SECURITY DEFINER wrapper RPC (see migration 066 Step 7)
 *      via the **user-scoped** Supabase client. The RPC is GRANTed to
 *      `authenticated` and runs its own `auth.uid()` ownership check, then
 *      refuses a soft-disconnected key, then looks for a live
 *      `poll_allocator_positions` job for the key BEFORE enqueueing
 *      (Phase 164.9.1 M2, migration 20260924233749, restoring 067's
 *      look-up and 075's refusal). A live job returns
 *      `{ already_inflight: true, next_attempt_at }` without enqueueing;
 *      otherwise it enqueues, sets `api_keys.sync_status='syncing'` and
 *      returns `{ ok: true, job_id }`. No separate ownership SELECT from
 *      the route — the RPC owns it (defense in depth alongside owner-RLS +
 *      the f5 coherence trigger).
 *
 *      Error mapping: SQLSTATE 42501 (unauthenticated / not owned) → 403;
 *      SQLSTATE P0001 with message exactly `api_key_disconnected` → 409
 *      with a fixed "reconnect the key" sentence (D-23; keyed on code AND
 *      message, because P0001 is the generic RAISE class); anything else
 *      → the generic 500.
 *   3. Emits the sync-requested audit event fire-and-forget on the
 *      success path (D-18).
 *   4. Passes the RPC JSONB body through to the client verbatim so both
 *      `{ ok, job_id }` and `{ already_inflight: true, next_attempt_at }`
 *      are preserved. f8: Plan 04's sync-status pill discriminates on
 *      the already-inflight key and consumes `next_attempt_at` to render
 *      "Queued — retry in {N}s" during rate-limit contagion windows.
 *   5. Phase 164.6 (OPS-08-TS): a `40001` (`serialization_failure`, the
 *      lost-enqueue-race code `_enqueue_compute_job_internal` raises since
 *      mig 20260826150000) is retried exactly ONCE, with no sleep, through
 *      `retryOnceOnSerializationFailure`. The whole RPC is re-issued, which
 *      is retry-safe: the RPC's one exception handler (around its
 *      reconstruct enqueue) traps only the unique-index collision, so a 40001
 *      aborts its own transaction (the `api_keys` UPDATE included) and the
 *      re-issue starts clean. The retried attempt is a `console.warn`; a
 *      40001 that survives the retry takes the existing 500 branch, and
 *      every other error is never retried.
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
  // its own auth.uid() ownership check, refuses a disconnected key (P0001
  // api_key_disconnected), then prefetches the key's live poll job: a hit
  // returns { already_inflight, next_attempt_at } (f8) with no enqueue, a
  // miss enqueues and returns { ok, job_id } (Phase 164.9.1 M2).
  const supabase = await createClient();
  // LOW-2 (164.6 review fix): whether the single retry happened, so the final
  // error line says so instead of reading like a first-attempt failure.
  let retried = false;
  const { data, error } = await retryOnceOnSerializationFailure(
    () =>
      supabase.rpc("request_allocator_holdings_sync", {
        p_api_key_id: api_key_id,
      }),
    (first) => {
      retried = true;
      console.warn(
        `[allocator/holdings/sync] 40001 lost enqueue race for user ${user.id} key ${api_key_id}, retrying once: ${first.error?.message ?? "(no message)"}`,
      );
    },
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
    // D-23 (Phase 164.9.1): the RPC refuses a soft-disconnected key with
    // RAISE 'api_key_disconnected' USING ERRCODE 'P0001'. That is a user
    // state, not a server fault, so it is a 409 with no error log. Key on
    // code AND message: P0001 is the generic RAISE class, and any other
    // P0001 must still reach the logged 500 below.
    if (error.code === "P0001" && error.message === "api_key_disconnected") {
      // Round-1 review (silent-failure-hunter M4): no ERROR log, but not
      // nothing either. One info line gives the refusal a count, so a user
      // stuck on a stale tab leaves a trace. It carries no user or key id.
      console.info("[allocator/holdings/sync] refused: api key disconnected (409)");
      return NextResponse.json(
        {
          error:
            "This API key is disconnected. Reconnect it before syncing holdings.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    console.error(
      `[allocator/holdings/sync] RPC failed${retried ? " after 1 retry" : ""} for user ${user.id} key ${api_key_id} (code=${error.code ?? "none"}):`,
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
