/**
 * Phase 95 / Plan 95-03 / PROG-02 + PROG-03 —
 * GET /api/strategies/[id]/sync-progress
 *
 * The single owner-scoped, SECRETLESS read the composite wizard polls (95-04)
 * to render per-member stitch progress and a stall banner.
 *
 * Phase 154 / plan 154-04 — STALE-01a: the job selection is widened from
 * "latest stitch_composite" to "latest stitch_composite, else latest job of ANY
 * kind". Purely additive — the fallback is reached only where the route used to
 * answer IDLE — and it makes `jobStatus` available to SINGLE-KEY strategies,
 * which produce no stitch job and were therefore told nothing was in flight
 * while their `process_key_long` was running. `stalled` and `memberProgress`
 * stay stitch-derived (see the stall block for the false-positive hazard).
 *
 * Phase 167.2 / KCS-20 — the fallback is narrowed from "latest job of ANY kind"
 * to "latest FACTSHEET-CHAIN job" (`FACTSHEET_CHAIN_KINDS` in
 * `@/lib/compute-state`, which now owns the selection for this route and every
 * compute-state surface). A deliberate behaviour change on an internal route: a
 * newer recurring cron row (`reconcile_strategy`, `sync_funding`) can no longer
 * answer for the factsheet and hide a failed chain job. `jobStatus: null` now
 * means "no factsheet-chain job is visible for this strategy" (rows of other
 * kinds may exist). The wizard's SyncPreviewStep reads the same field; a new
 * strategy only has chain rows, so for it null still reads as nothing enqueued.
 *
 * Why a projection route, not a direct table read (95-VALIDATION decision 1,
 * LOCKED as Option A):
 *   `compute_jobs` is RLS deny-all + REVOKE FROM authenticated. The sanctioned
 *   owner-scoped read is the SECURITY DEFINER RPC `get_user_compute_jobs`
 *   (auth.uid()-scoped; `last_error` redacted). This route calls that RPC with
 *   the user-scoped session client, then PROJECTS field-by-field into
 *   `SyncProgressResponse` — the raw `metadata` blob (which carries `source`,
 *   `correlation_id`, and — belt-and-suspenders — any ciphertext a future writer
 *   might mistakenly stow) NEVER reaches the browser (T-95-07). The route emits
 *   exactly `{ jobStatus, stalled, memberProgress:[{seq,exchange,label,status}] }`
 *   and nothing else; it never spreads an RPC row or a metadata entry.
 *
 * PROG-03 stall (Option B — distinct stall surfacing, server clock only): a
 * `running` job whose heartbeat (`metadata.member_progress_at ?? claimed_at`) is
 * older than STALL_THRESHOLD_MS (12 min — see the contract module for the
 * 12-vs-10 rationale) is flagged `stalled:true`. The stall derives EXCLUSIVELY
 * from the JOB — this route NEVER reads the analytics table, so an RT-1
 * pending-after-complete analytics row (which is re-stitching, not a stall)
 * cannot influence the flag (RT-1 critical; structurally pinned by the route
 * test's never-touches-the-analytics-table assertion). `failed_retry` is NOT stalled (the
 * queue is retrying — that is progress). A false positive is low-harm: the 95-04
 * retry CTA re-POSTs /api/keys/sync, which the partial-unique index
 * `compute_jobs_one_inflight_per_kind_strategy` makes a no-op while the job is
 * genuinely inflight — i.e. `pending`/`running` (T-95-09: accept). NB (F-3): that
 * index EXCLUDES `failed_retry`, so a re-POST during a retry backoff would INSERT
 * A SECOND stitch, not no-op. The client therefore SUPPRESSES the manual Retry
 * whenever it observes `jobStatus === "failed_retry"` (the job auto-retries) — so
 * this route's projected `jobStatus` is what closes that gap, not the index.
 *
 * AGENTS.md / Next.js 16 async dynamic params: `ctx.params` is a Promise — it
 * MUST be awaited. `withAuth` does NOT forward the route context (it calls the
 * handler with `(req, user)` only — withAuth.ts:72), so this handler awaits
 * `ctx.params` itself, validates the uuid FIRST (B15: a structurally-bad id
 * never burns a limiter token), then delegates to a `withAuth`-wrapped inner
 * handler closing over the validated id. Mirrors returns/route.ts.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { syncProgressLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import {
  type MemberProgressEntry,
  type StitchJobStatus,
  type SyncProgressResponse,
} from "@/lib/sync-progress";
import {
  isComputeJobStatus,
  isStitchStalled,
  memberProgressOf,
  selectFactsheetJob,
} from "@/lib/compute-state";
import { readOwnerComputeJobs } from "@/lib/compute-jobs-read";
import {
  compositeHistoryOf,
  countCompositeMembers,
  shouldPreferStitch,
} from "@/lib/strategy-shape";
import { captureToSentry } from "@/lib/sentry-capture";
import type { SupabaseClient } from "@supabase/supabase-js";

// AGENTS.md: pin the Node.js runtime — the route touches the supabase server
// client (cookie store), which the Edge runtime would break.
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * The idle response — no factsheet-chain job (stitch_composite or a
 * FACTSHEET_CHAIN_KINDS row) is visible for this strategy (167.2 KCS-20). Rows of
 * other kinds (recurring cron jobs) may exist; they do not describe the
 * factsheet. Before 154-04 this also covered "has jobs, none of them a stitch",
 * which is every single-key strategy that ever ran.
 */
const IDLE: SyncProgressResponse = {
  jobStatus: null,
  stalled: false,
  memberProgress: [],
};

/**
 * SF-3 — the DEGRADE response for the `if (rpcError)` branch. Shape-identical to
 * IDLE but carries `degraded: true` so the client can tell "couldn't read" apart
 * from a real idle and keep its last-known progress rather than wiping the live
 * panel / flipping `stalled` to false on a transient RPC blip. A REAL idle
 * (no stitch_composite job) still returns IDLE (degraded absent).
 */
const DEGRADED: SyncProgressResponse = {
  jobStatus: null,
  stalled: false,
  memberProgress: [],
  degraded: true,
};

export async function GET(
  req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  // uuid validated FIRST — maps a would-be 22P02 to a clean 400 and, running
  // BEFORE the limiter, keeps the per-(user, strategy) bucket keyspace bounded
  // to real UUIDs so a caller can't mint throwaway buckets (B15 ordering).
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Invalid strategy id" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return withAuth(
    async (_req: NextRequest, user: User): Promise<NextResponse> => {
      // Per-(user, strategy) rate limit. The wizard polls ~20/min; 60/min gives
      // 2-tab headroom. Keyed on both so a foreign id only burns its own bucket.
      const rl = await checkLimit(
        syncProgressLimiter,
        `sync-progress:${user.id}:${id}`,
      );
      if (!rl.success) {
        return NextResponse.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
          },
        );
      }

      const supabase = await createClient();

      // Ownership fence via the user-scoped client. A row that is non-existent
      // or cross-tenant resolves to null → uniform 404 (P458: never reveal the
      // unowned-vs-missing distinction — no existence oracle, T-95-06). The RPC
      // below is ALSO auth.uid()-scoped, so this is defense-in-depth.
      const { data: strategy } = await supabase
        .from("strategies")
        .select("id, user_id, api_key_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (!strategy) {
        return NextResponse.json(
          { error: "Not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      // Sanctioned owner-scoped read (Don't-Hand-Roll table): the SECURITY
      // DEFINER RPC resolves auth.uid() server-side from the session JWT
      // (`withAuth` has resolved the user, the precondition
      // `readOwnerComputeJobs` documents). 167.2-REVIEW-SFH M-5: a full first
      // window with no chain row is re-asked once at the RPC cap there.
      // 167.2-REVIEW-SFH M-4 — every "could not tell" answer is DEGRADED,
      // never IDLE. The key card reads IDLE's `jobStatus: null` as "no chain
      // job in flight" (its KCS-18 success gate and its pre-attempt gate), so
      // an IDLE here for a read that answered nothing would admit a mid-chain
      // success or start a second job. Three cases, each logged and captured
      // (no raw error is forwarded to the client):
      //   - the RPC errored, answered no rows array, or threw (SF-3's branch,
      //     widened: the non-array answer used to fall through to IDLE);
      //   - the window is still full at the RPC cap with no chain row
      //     (`deriveComputeState` calls that `unreadable`; this route used to
      //     call it IDLE, breaking its own module's rule);
      //   - the selected job's status is outside the six-value domain.
      const degrade = (stage: string, message: string): NextResponse => {
        console.error(
          `[api/strategies/sync-progress] ${stage} for ${id}: ${message}`,
        );
        captureToSentry(new Error(message), {
          tags: { route: "api/strategies/sync-progress", stage },
        });
        // SF-3: a 200 the poll never hard-fails on, flagged `degraded:true` so
        // the client keeps its last-known progress rather than treating a
        // couldn't-read as a real idle (empty panel / stalled:false).
        return NextResponse.json(DEGRADED, {
          status: 200,
          headers: NO_STORE_HEADERS,
        });
      };

      let read: Awaited<ReturnType<typeof readOwnerComputeJobs>>;
      // 167.2-REVIEW IN-03: stitch preference only while the strategy HAS
      // members. A strategy converted from a composite to a single key before
      // KCS-23 keeps its old stitch rows, and a stale `done` stitch answered for
      // the single-key chain running now, so the key card's KCS-18 gate read it
      // as settled mid-chain. A count that cannot be read keeps the old rule
      // (never fail toward dropping a live composite's member progress).
      let memberCount: Awaited<ReturnType<typeof countCompositeMembers>>;
      try {
        [read, memberCount] = await Promise.all([
          readOwnerComputeJobs(supabase as unknown as SupabaseClient, id),
          countCompositeMembers(supabase as unknown as SupabaseClient, id),
        ]);
      } catch (err) {
        return degrade(
          "compute-jobs-read",
          err instanceof Error ? err.message : String(err),
        );
      }

      if (!read.ok) return degrade("compute-jobs-read", read.message);
      if (read.windowFull) {
        return degrade(
          "compute-jobs-window-full",
          "the compute job window is full at the RPC cap with no factsheet-chain job in it",
        );
      }

      // KCS-07 / KCS-20 (167.2) — the selection, the member projection and the
      // stall rule live in `@/lib/compute-state`, written once and shared with
      // every surface that states a strategy's compute state. The selection is
      // stitch-PREFERRING, as since 154-04 (the stitch row is the only row that
      // can carry member progress or a heartbeat, so composite responses stay
      // byte-identical: PIN-COMPOSITE-BYTES / PIN-COMPOSITE-WINS). The fallback
      // is the latest FACTSHEET-CHAIN job, no longer the latest of any kind: a
      // newer recurring cron row (`reconcile_strategy`, `sync_funding`) must not
      // hide a failed chain job behind its own `done`.
      // 167.2-REVIEW-R2 IN-05: a zero count drops stitch preference only for
      // a PROVEN single-key strategy (a linked key, or no stitch in the rows
      // at hand); a regressed `strategy_keys_owner` policy that counts a live
      // composite as 0 must not let a member chain row answer for it. The
      // history here is the rows this route already read (no extra RPC on the
      // poll path): with no stitch in them, the preference changes nothing.
      const latest = selectFactsheetJob(read.rows, {
        preferStitch: shouldPreferStitch({
          apiKeyId: (strategy as { api_key_id?: string | null }).api_key_id,
          memberCount,
          compositeHistory: compositeHistoryOf(read),
        }),
      });

      if (latest === null) {
        return NextResponse.json(IDLE, { status: 200, headers: NO_STORE_HEADERS });
      }

      // Member progress and the stall flag are stitch-derived inside the helpers
      // (only the stitch worker writes member_progress / member_progress_at), so
      // a non-stitch fallback row projects [] and is never stalled. See the
      // "STALL IS STITCH-ONLY" note on `isStitchStalled` for why a non-stitch
      // job must never read as stalled.
      if (!isComputeJobStatus(latest.status)) {
        return degrade(
          "compute-jobs-bad-status",
          "the selected compute job's status is outside the compute_jobs status domain",
        );
      }
      const memberProgress: MemberProgressEntry[] = memberProgressOf(latest);
      const jobStatus: StitchJobStatus = latest.status;
      const stalled = isStitchStalled(latest, Date.now());

      const body: SyncProgressResponse = { jobStatus, stalled, memberProgress };
      return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
