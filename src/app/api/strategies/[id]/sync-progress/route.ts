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
 * stay stitch-derived (see the stall block for the false-positive hazard);
 * `jobStatus: null` now means "zero compute_jobs rows for this strategy".
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
  coerceMemberProgressStatus,
  STALL_THRESHOLD_MS,
  type MemberProgressEntry,
  type StitchJobStatus,
  type SyncProgressResponse,
} from "@/lib/sync-progress";

// AGENTS.md: pin the Node.js runtime — the route touches the supabase server
// client (cookie store), which the Edge runtime would break.
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * The idle response — NO visible compute_jobs row of ANY kind for this
 * strategy. Narrower than it used to be (154-04): before the kind widening this
 * also covered "has jobs, none of them a stitch", which is every single-key
 * strategy that ever ran.
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

/** Minimal shape we read off a `get_user_compute_jobs` row. */
interface ComputeJobRow {
  kind?: string;
  status?: string;
  claimed_at?: string | null;
  created_at?: string;
  metadata?: {
    member_progress?: unknown;
    member_progress_at?: string | null;
  } | null;
}

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
        .select("id, user_id")
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
      // DEFINER RPC resolves auth.uid() server-side from the session JWT.
      const { data: rows, error: rpcError } = await supabase.rpc(
        "get_user_compute_jobs",
        { p_strategy_id: id, p_limit: 20 },
      );

      if (rpcError) {
        // A progress read must NEVER hard-fail the wizard poll — it is cosmetic
        // (the analytics poll remains the authoritative one). Degrade to an
        // idle 200 and log server-side (never forward the raw error).
        console.error(
          `[api/strategies/sync-progress] get_user_compute_jobs failed for ${id}:`,
          rpcError,
        );
        // SF-3: degrade to a 200 the poll never hard-fails on, but flag it
        // `degraded:true` so the client keeps its last-known progress rather
        // than treating a couldn't-read blip as a real idle (empty panel /
        // stalled:false). Distinct from the real-idle IDLE below.
        return NextResponse.json(DEGRADED, {
          status: 200,
          headers: NO_STORE_HEADERS,
        });
      }

      // Pick the LATEST job by created_at. The RPC already orders created_at
      // DESC, but reduce explicitly so the contract does not silently depend on
      // RPC ordering.
      //
      // 154-04 — TWO passes, stitch-PREFERRING, because the two arms want
      // different things and only one of them existed before:
      //
      //   1. `latestStitch` — the composite arm's answer, unchanged. The stitch
      //      row is the ONLY row that can carry member progress or a heartbeat,
      //      so whenever one exists it remains the source of this response even
      //      if some other kind ran afterwards. Composite behaviour is therefore
      //      byte-identical (pinned by PIN-COMPOSITE-BYTES / PIN-COMPOSITE-WINS,
      //      written and observed green BEFORE this widening).
      //
      //   2. `latestAny` — the fallback, and the whole point of the widening. A
      //      SINGLE-KEY strategy never produces a stitch_composite job, so the
      //      old kind filter discarded every row it had and answered IDLE while
      //      `process_key_long` was running. That hid the one piece of
      //      owner-readable evidence the wizard needed (STALE-01a / M1): with
      //      nothing to distinguish "still working" from "nothing running", a
      //      single-key user had no exit from the in-flight claim.
      //
      // ⭐ The widening is ADDITIVE by construction: the fallback is reached
      // ONLY where the old code returned IDLE. `jobStatus: null` now means
      // "this strategy has ZERO compute_jobs rows" — a stronger, and far more
      // useful, statement than "no stitch job".
      const jobRows: ComputeJobRow[] = Array.isArray(rows)
        ? (rows as unknown as ComputeJobRow[])
        : [];
      const isNewer = (row: ComputeJobRow, current: ComputeJobRow | null) =>
        current === null ||
        Date.parse(row.created_at ?? "") > Date.parse(current.created_at ?? "");
      let latestStitch: ComputeJobRow | null = null;
      let latestAny: ComputeJobRow | null = null;
      for (const row of jobRows) {
        if (!row) continue;
        if (isNewer(row, latestAny)) latestAny = row;
        if (row.kind === "stitch_composite" && isNewer(row, latestStitch)) {
          latestStitch = row;
        }
      }
      const latest: ComputeJobRow | null = latestStitch ?? latestAny;

      if (latest === null) {
        return NextResponse.json(IDLE, { status: 200, headers: NO_STORE_HEADERS });
      }

      // Only the stitch worker writes member_progress / member_progress_at, so
      // both derivations below are gated on the selected row actually BEING a
      // stitch. (`latest` is the stitch whenever one exists, so this is true
      // for every composite response — the flag exists to make the non-stitch
      // fallback's silence explicit rather than incidental.)
      const isStitch = latest.kind === "stitch_composite";

      // Field-by-field member projection — NEVER spread the worker's entry, and
      // touch ONLY member_progress (never last_error / user_message / source /
      // correlation_id / ciphertext).
      const rawEntries =
        isStitch && Array.isArray(latest.metadata?.member_progress)
          ? (latest.metadata!.member_progress as unknown[])
          : [];
      const memberProgress: MemberProgressEntry[] = rawEntries.map((e) => {
        const entry = (e ?? {}) as Record<string, unknown>;
        return {
          seq: Number(entry.seq),
          // Security L1 — harden exchange/label symmetrically with seq/status: a
          // non-string value (object, number) in these positions projects to
          // null rather than passing through verbatim. Only the trusted worker
          // writes member_progress, so this is defense-in-depth, but the
          // projection must be UNIFORMLY defensive (never a bare ?? coalesce
          // that lets a truthy non-string through).
          exchange: typeof entry.exchange === "string" ? entry.exchange : null,
          label: typeof entry.label === "string" ? entry.label : null,
          status: coerceMemberProgressStatus(entry.status),
        };
      });

      // PROG-03 stall (server clock only): heartbeat = member_progress_at ??
      // claimed_at; stalled only when running AND the heartbeat is older than
      // the threshold. Date.parse of a missing/garbage value → NaN, and
      // `NaN > threshold` is false, so an unparseable heartbeat never cries
      // stall. RT-1: NO analytics-table read anywhere in this route.
      //
      // ⛔ STALL IS STITCH-ONLY, AND MUST STAY THAT WAY (154-04). The heartbeat
      // is written by the stitch worker at member boundaries; no other job kind
      // refreshes anything. For a non-stitch job the fallback would be
      // `claimed_at`, which is stamped ONCE at claim time and never moves — so a
      // long, perfectly healthy single-key crawl would cross the 12-minute
      // threshold and be reported `stalled: true` purely for taking a while.
      // That false positive is not cosmetic: the client's stall affordance
      // invites a retry, i.e. it would push users to abort healthy work. A
      // non-stitch job therefore reports `stalled: false` ALWAYS — this route
      // has no evidence about it either way, and "no evidence" is not "stalled".
      const jobStatus = (latest.status ?? null) as StitchJobStatus | null;
      const heartbeat = isStitch
        ? (latest.metadata?.member_progress_at ?? latest.claimed_at ?? null)
        : null;
      const stalled =
        isStitch &&
        jobStatus === "running" &&
        heartbeat != null &&
        Date.now() - Date.parse(heartbeat) > STALL_THRESHOLD_MS;

      const body: SyncProgressResponse = { jobStatus, stalled, memberProgress };
      return NextResponse.json(body, { status: 200, headers: NO_STORE_HEADERS });
    },
  )(req);
}
