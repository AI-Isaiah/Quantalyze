import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  userActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { isUuid } from "@/lib/utils";

/**
 * Phase 164 / Plan 164-03 / SHARE-03 — the owner REVOKES the share link for one
 * of their own strategies.
 *
 *   POST /api/strategies/{id}/share/revoke  ->  200 { revoked: true }
 *                                           ->  404 when nothing was active
 *
 * ⛔ REVOCATION IS THE GENERATION BUMP, not merely a `revoked_at` stamp, and
 * that is why this route calls an RPC where the sibling
 * `allocator/scenario/share/revoke/route.ts` gets away with a direct UPDATE.
 * The token re-derives from `(strategy_id, nonce, generation)`, so incrementing
 * the counter is what kills every previously-copied link — and no client library
 * can express `SET generation = generation + 1` atomically. Split into a
 * read-then-write the counter could go short under concurrency; folded into
 * `revoke_strategy_share` it is ONE statement that stamps and increments
 * together.
 *
 * ⛔ SOFT-REVOKE ONLY. The row is never DELETEd — the audit trail needs it, and
 * (migration 20260827120000 STEP 1b) a destroyed-and-recreated row would draw a
 * fresh `nonce` and land at `generation = 1`, which is the resurrection family
 * the nonce exists to kill.
 *
 * ⛔ DO NOT ADD `SELECT … FOR UPDATE`, A RETRY LOOP, OR AN ADVISORY LOCK HERE.
 * N2 was raised against this route and CLOSED BY FOUNDER RULING on measured
 * evidence: the RPC is a single `UPDATE … WHERE … AND revoked_at IS NULL`, and
 * under READ COMMITTED the loser of a concurrent double-revoke re-evaluates
 * that predicate against the updated row and matches nothing, so it returns
 * `rows = 0` and converges. Three interleavings across two concurrent sessions
 * were measured; all three converge. The remedy the corpus originally
 * prescribed would have taken the `revoked_at IS NULL` guard out of the
 * convergence path and CREATED a counter-inflation bug — two callers each
 * bumping the generation for one user gesture. `revoked_at IS NULL` IS the
 * convergence contract.
 *
 * ⭐ 404 IS CONVERGENCE, NOT FAILURE, and the client (plan 164-04) reads it as
 * success. `rows = 0` means "already revoked, or never shared" — in both cases
 * the END STATE the caller asked for is the state the system is in, which is
 * exactly what a 200 would have claimed. The status is 404 rather than 200
 * because nothing was found to act on, and because it keeps this arm identical
 * to the non-owner arm below.
 *
 * ⛔ OWNERSHIP NEEDS NO SEPARATE PROBE, AND ADDING ONE WOULD MAKE THINGS WORSE.
 * The RPC is SECURITY INVOKER: its UPDATE is RLS-scoped AND carries its own
 * `created_by = auth.uid()` predicate, so a non-owner's call affects zero rows
 * and falls into the SAME 404 as a double-revoke — byte for byte, since both
 * come from the one branch below (T-164-03). A separate probe would give the
 * two cases distinguishable answers and turn this route into an existence
 * oracle for strategy ids. The identical-bodies property is pinned in
 * `route.test.ts`.
 *
 * B15 ORDERING (T-164-14): csrf -> auth -> validate -> limiter -> write. A
 * malformed id is a 400 that burns no token; a limiter MISCONFIGURATION is a
 * 503, never a lying 429.
 *
 * Redacted envelope (T-164-13): log and Sentry-capture server-side, return a
 * stable sentence, never echo `error.message`.
 */

export const runtime = "nodejs";

/**
 * `revoke_strategy_share(p_strategy_id UUID) RETURNS INTEGER` — the affected
 * row count. 1 = just revoked; 0 = already revoked, never shared, or not the
 * caller's row.
 *
 * The cast-through-unknown pattern (csv-finalize / scenario-share precedent):
 * `database.types.ts` has not been regenerated for this function. Delete the
 * cast when the types regeneration lands.
 *
 * ⭐ THE CAST IS ON THE CLIENT, NOT ON `.rpc`, AND THE CALL BELOW IS ON ONE
 * LINE. Both are load-bearing for the audit law rather than stylistic — see the
 * comment at the call site.
 */
type RevokeShareRpcClient = {
  rpc: (
    fn: "revoke_strategy_share",
    args: { p_strategy_id: string },
  ) => Promise<{
    data: number | string | null;
    error: { code?: string; message?: string } | null;
  }>;
};

/** The one client-facing failure sentence. Never a DB message. */
const REVOKE_FAILED = {
  error: "Revoke failed",
  message: "Couldn't revoke this link. Try again.",
} as const;

/**
 * ⛔ THE 404 BODY IS A SINGLE FROZEN CONSTANT, used by exactly one branch.
 * "Already revoked" and "not your strategy" must be indistinguishable to the
 * caller, and the cheapest way to guarantee that is for there to be only one
 * object to serialize (T-164-03).
 */
const NOTHING_TO_REVOKE = { error: "share not found" } as const;

/**
 * `RETURNS INTEGER` is int4, which PostgREST renders as a JSON number. A
 * numeric string is accepted anyway so a transport/serializer change cannot
 * turn a successful revoke into a 500; anything else is `null`, which the
 * caller treats as INDETERMINATE and answers 500.
 *
 * ⚠️ Anything-else must NOT fall through to the 0 branch. 0 answers 404, which
 * the client reads as success — so coercing an unreadable answer to 0 would
 * claim the link is dead without having established it. Unknown is louder than
 * a comfortable default.
 */
function coerceCount(data: number | string | null): number | null {
  if (typeof data === "number" && Number.isFinite(data)) return data;
  if (typeof data === "string" && data.trim() !== "") {
    const parsed = Number(data);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // (1) CSRF, as on the mint sibling and on every owner write under
  //     `strategies/[id]`.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // (2) Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // (3) Validate FIRST — the codebase-canonical `isUuid`, never zod v4's
  //     `.uuid()`. Maps a would-be 22P02 to a clean non-retryable 400 with no
  //     schema leak, and burns no rate-limit token (B15).
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "id must be a UUID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // (4) Limiter, AFTER validation. Misconfiguration is a 503, not a 429.
  const rl = await checkLimit(
    userActionLimiter,
    `strategy-share-revoke:${user.id}`,
  );
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

  // (5) THE REVOKE. One statement inside the RPC: `revoked_at = now()` AND
  //     `generation = generation + 1`, guarded by `revoked_at IS NULL`.
  //
  //     ⛔ THE CALL IS ON ONE LINE ON PURPOSE. `findRpcMutations` in
  //     `src/__tests__/audit-coverage.test.ts` tests `MUTATING_RPC_RE` against
  //     ONE LINE AT A TIME, so a Prettier-style wrap between `.rpc(` and the
  //     function name hides this mutation from the audit law exactly as
  //     completely as casting the method instead of the client would. MEASURED
  //     2026-08-28 on the mint sibling: with either in place, deleting the
  //     `logAuditEvent` below left audit-coverage GREEN. Do not reflow.
  const shareRpc = supabase as unknown as RevokeShareRpcClient;
  const revokeArgs = { p_strategy_id: id };
  const { data, error } = await shareRpc.rpc("revoke_strategy_share", revokeArgs);

  if (error) {
    // Redacted. NEVER echo error.message.
    console.error(
      "[api/strategies/[id]/share/revoke] revoke_strategy_share failed",
      { user: user.id, message: error.message },
    );
    captureToSentry(error, { tags: { area: "strategy-share-revoke" } });
    return NextResponse.json(REVOKE_FAILED, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }

  const revokedCount = coerceCount(data);
  if (revokedCount === null) {
    // INDETERMINATE, and said so. The statement WAS sent; we simply cannot read
    // how many rows it touched, so we must not answer 404 (which the client
    // treats as "the link is dead") on a state we have not established.
    console.error(
      "[api/strategies/[id]/share/revoke] unreadable affected-row count",
      { user: user.id, typeofData: typeof data },
    );
    captureToSentry(
      new Error("revoke_strategy_share returned an unreadable row count"),
      { tags: { area: "strategy-share-revoke" } },
    );
    return NextResponse.json(REVOKE_FAILED, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }

  if (revokedCount < 1) {
    // ONE branch, three causes: already revoked, never shared, or not the
    // caller's strategy. See the header — this is convergence for the first
    // two and no-oracle for the third, and they must be byte-identical.
    return NextResponse.json(NOTHING_TO_REVOKE, {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }

  // (6) Audit the kill — emitted ONLY on the arm that actually revoked a row.
  //     Mint and revoke are the two halves of one repudiation surface
  //     (T-164-11); auditing only the mint would leave "who killed this link,
  //     and when" unanswerable. No token, here or anywhere.
  logAuditEvent(supabase, {
    action: "strategy.share.revoke",
    entity_type: "strategy",
    entity_id: id,
    metadata: { revoked_count: revokedCount },
  });

  return NextResponse.json(
    { revoked: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
