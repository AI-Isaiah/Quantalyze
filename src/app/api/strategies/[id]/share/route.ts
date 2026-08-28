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
import { deriveShareToken } from "@/lib/strategy-share-token";

/**
 * Phase 164 / Plan 164-03 / SHARE-01 — the owner MINTS (or REUSES) the share
 * link for one of their own strategies.
 *
 *   POST /api/strategies/{id}/share  ->  200 { url }
 *
 * ⛔ MINT IS IDEMPOTENT WHILE THE SHARE IS LIVE, AND THAT IS THE WHOLE POINT OF
 * THE ROUTE. The sibling `allocator/scenario/share/route.ts` — the skeleton this
 * file copies for B15 ordering, envelope discipline and the cast pattern — does
 * the OPPOSITE in its core: it revokes any prior share and inserts a fresh
 * random token on every call. Ported verbatim, that behaviour IS the
 * founder-hit defect (164-CONTEXT success criterion 2): the owner clicks Copy
 * Link a second time to re-send a link they already sent, and silently kills
 * the recipient's existing URL. Here the RPC is an atomic `INSERT … ON CONFLICT
 * (strategy_id) DO UPDATE SET revoked_at = NULL`, which touches NEITHER
 * `generation` NOR `nonce`, and the token re-derives from those two stored
 * values — so a second mint returns a BYTE-IDENTICAL url. Pinned in
 * `route.test.ts`.
 *
 * ⛔ THE TOKEN TAKES THREE INPUTS: `(strategyId, nonce, generation)`. The
 * pre-image is `qz.strategy-share.v1.${strategyId}.${nonce}.${generation}`
 * (`src/lib/strategy-share-token.ts`). 164-03-PLAN.md as originally written
 * specified a TWO-argument `deriveShareToken(strategyId, generation)` — it
 * predates the nonce, which joined the pre-image in 164-02's fix rounds — and a
 * route built to that spec mints links that FAIL VERIFICATION on
 * `/factsheet-share/[token]`, surfacing to the recipient as "this link was
 * revoked" rather than as a bug (T-164-21). The route test therefore
 * round-trips a minted url through `verifyShareToken` rather than merely
 * asserting a 43-character token: shape is exactly what the stale two-argument
 * form would still have passed.
 *
 * ⛔ THE ROUTE NEVER NAMES `generation` OR `nonce` IN A WRITE, and does not pass
 * either INTO the RPC. Migration 20260827120000 STEP 2 grants `authenticated`
 * INSERT on (strategy_id, created_by) and UPDATE on (revoked_at, generation)
 * only — there is no grant on `nonce` at ALL — and a BEFORE INSERT trigger
 * forces `generation = 1` plus a fresh `nonce` regardless of what any caller
 * names. Those two controls are what make a revoked link unresurrectable. The
 * route's job is to READ the pair back, never to choose it.
 *
 * ⛔ 404, NEVER 403, on every miss arm (T-164-03). A non-owner and an unknown id
 * get the identical response, so the route is not an existence oracle for
 * strategy ids.
 *
 * B15 ORDERING (T-164-14): csrf -> auth -> validate -> limiter -> ownership
 * probe -> write. Validation precedes the limiter so a malformed id burns none
 * of the caller's own tokens; a limiter MISCONFIGURATION is a 503, never a lying
 * 429 that tells the caller they are being throttled during our own outage.
 *
 * ⚠️ `checkLimit` fails OPEN outside production (`src/lib/ratelimit.ts` gates the
 * fail-closed arm on `VERCEL_ENV === 'production'`), so a preview deployment can
 * mint without limit (T-164-20, accepted). Per-environment `SHARE_TOKEN_SECRET`
 * bounds the consequence: a preview-minted token cannot open a production
 * factsheet, because the two environments hold different secrets.
 *
 * ⛔ NO TOKEN IN THE AUDIT ROW. `metadata` carries the `generation` only. The
 * token is a bearer credential; an audit table is not a secret store, and a
 * support query or a GDPR export that returned one would hand out a working
 * link (T-164-13). The redacted 500 envelope is the same rule for DB errors:
 * log and Sentry-capture server-side, return a stable sentence, never echo
 * `error.message` (which is database-author-controlled and carries relation and
 * function names).
 */

export const runtime = "nodejs";

/**
 * The origin the share URL is built from — `NEXT_PUBLIC_APP_URL`, read
 * PER-REQUEST rather than captured at module load so the resolved origin always
 * reflects the running environment (the scenario mint route's `resolveAppUrl`
 * shape; never a hardcoded host).
 */
function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** The recipient lane this token opens. */
const SHARE_PATH_PREFIX = "/factsheet-share/";

/**
 * The single row `create_strategy_share` returns.
 *
 * ⚠️ `generation` is a BIGINT in Postgres. PostgREST may hand it back as a JS
 * number or as a string depending on configuration, and the cast below means
 * `tsc` cannot catch a string here. It does not matter for correctness:
 * `serialize()` inside the token module template-literals the value, so both
 * render the same pre-image and the token is stable either way. What WOULD
 * matter is arithmetic — so the route does none. There is nothing to compute:
 * the RPC owns the counter, and migration 20260827120000 STEP 1b caps every
 * UPDATE at +1, so the bigint ceiling is unreachable by construction and this
 * route needs no overflow guard (N1).
 */
type CreateShareRow = {
  generation: number;
  nonce: string;
};

/**
 * The cast-through-unknown pattern (csv-finalize / scenario-share precedent):
 * `database.types.ts` has NOT been regenerated for `create_strategy_share`, so a
 * typed `.rpc()` literal would fail compilation. Delete this when the types
 * regeneration lands.
 *
 * ⭐ THE CAST IS ON THE CLIENT, NOT ON `.rpc` ITSELF, AND THAT IS DELIBERATE.
 * The scenario route casts the METHOD —
 * `(supabase.rpc as unknown as …)("create_scenario_share", …)` — which leaves no
 * literal `.rpc("create_scenario_share"` in the source, and
 * `src/__tests__/audit-coverage.test.ts` anchors its mutating-RPC detector on
 * exactly that literal (`MUTATING_RPC_RE`). `create_strategy_share` IS listed in
 * that file's `MUTATING_RPC_NAMES`, and the listing is what is supposed to bring
 * this route under the audit law — the SEC-03 lesson recorded beside the entry:
 * with the call invisible to the detector, neither an audit emission nor an
 * `@audit-skip` pragma is ever required of it, and the listing is decorative.
 * Casting the client keeps the literal call shape and makes the law actually
 * bind. (The `finalize_csv_strategy_with_returns` note in that same file records
 * the identical gap, left open there as deferred-items #3.)
 *
 * ⛔ `p_strategy_id` IS THE ONLY ARGUMENT THE RPC TAKES. It does not accept
 * `generation` or `nonce`, and must not be given a way to.
 */
type CreateShareRpcClient = {
  rpc: (
    fn: "create_strategy_share",
    args: { p_strategy_id: string },
  ) => Promise<{
    data: CreateShareRow[] | null;
    error: { code?: string; message?: string } | null;
  }>;
};

/** The one client-facing failure sentence. Never a DB message. */
const MINT_FAILED = {
  error: "Share failed",
  message: "Couldn't create a share link. Try again.",
} as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // (1) CSRF. Both sibling owner-writes under `strategies/[id]` (`name`,
  //     `ownership`) open with this; a state-changing POST driven from the
  //     dashboard is exactly the shape `assertSameOrigin` exists for.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // (2) Auth — the strategies-owner shape (createClient + getUser), not the
  //     allocator wrapper the scenario route uses.
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

  // (3) Validate the path id with the codebase-canonical `isUuid` (UUID_RE),
  //     NEVER zod v4's `.uuid()`, which enforces RFC-4122 version/variant bits
  //     and rejects legitimate Postgres-shaped ids. A malformed id is a clean
  //     400 (it also maps a would-be 22P02 to a non-retryable answer with no
  //     schema leak) and — B15 — burns no rate-limit token.
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
    `strategy-share-mint:${user.id}`,
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

  // (5) OWNERSHIP PROBE on the RLS-scoped client. The explicit
  //     `.eq("user_id", user.id)` rides alongside RLS for the same reason the
  //     `name` route keeps its own: it keeps the statement correct on its own
  //     terms if the client is ever swapped for a service-role one, and it is
  //     what makes the 0-rows answer meaningful.
  //
  //     ⛔ NO STATUS BRANCH, and its absence is a decision (D-09). The route
  //     mints for ANY owned row, published or not — which URL the UI offers is
  //     the UI's predicate, and a token for a published strategy grants nothing
  //     the public factsheet does not already give away.
  const { data: owned, error: probeError } = await supabase
    .from("strategies")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (probeError) {
    console.error("[api/strategies/[id]/share] ownership probe failed", {
      user: user.id,
      message: probeError.message,
    });
    captureToSentry(probeError, { tags: { area: "strategy-share-mint" } });
    return NextResponse.json(MINT_FAILED, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }

  if (!owned) {
    // ONE honest arm for two causes: unknown id, or a row owned by somebody
    // else. 404 and NOT 403 — distinguishing them would leak row existence to a
    // caller probing ids (T-164-03). No share is created.
    return NextResponse.json(
      { error: "strategy not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // (6) MINT-OR-REUSE. Atomic reactivate-or-insert inside the SECURITY INVOKER
  //     RPC; RLS `WITH CHECK` is the cross-tenant wall (T-164-08).
  //
  //     ⛔ `RETURNS TABLE (generation BIGINT, nonce UUID)` — one row, TWO
  //     columns, resolved by PostgREST to a row ARRAY (the
  //     `get_verified_cohort_rank` precedent,
  //     `src/app/api/scenario/peer-rank/route.ts:167`). Destructure BOTH: a
  //     token derived from `(strategyId, generation)` alone does not validate.
  //
  //     ⛔ THE CALL IS ON ONE LINE, AND THAT IS LOAD-BEARING RATHER THAN
  //     COSMETIC. `findRpcMutations` in `src/__tests__/audit-coverage.test.ts`
  //     tests its `MUTATING_RPC_RE` against ONE LINE AT A TIME, so a Prettier
  //     wrap between `.rpc(` and the function name hides this mutation from the
  //     audit law as completely as the method-cast does. MEASURED 2026-08-28:
  //     with the call wrapped, deleting the `logAuditEvent` below left
  //     audit-coverage GREEN; on one line the same deletion turns it RED. The
  //     args bag is hoisted purely to keep the call inside the line budget.
  const shareRpc = supabase as unknown as CreateShareRpcClient;
  const mintArgs = { p_strategy_id: id };
  const { data: mintedRows, error: mintError } = await shareRpc.rpc("create_strategy_share", mintArgs);

  if (mintError) {
    // Redacted envelope. NEVER echo error.message.
    console.error("[api/strategies/[id]/share] create_strategy_share failed", {
      user: user.id,
      message: mintError.message,
    });
    captureToSentry(mintError, { tags: { area: "strategy-share-mint" } });
    return NextResponse.json(MINT_FAILED, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }

  const minted = mintedRows?.[0];
  if (!minted || minted.nonce == null || minted.generation == null) {
    // FAIL LOUD rather than mint from a half-read row. The RPC always
    // `RETURN NEXT`s exactly one row, so reaching here means the shape changed
    // underneath us — and a token derived from `undefined` would still be a
    // well-formed 43-character string that verifies against nothing, i.e. a
    // Copy Link handing the owner a dead URL with no error anywhere.
    console.error(
      "[api/strategies/[id]/share] create_strategy_share returned no row",
      { user: user.id, rows: mintedRows?.length ?? 0 },
    );
    captureToSentry(
      new Error("create_strategy_share returned no (generation, nonce) row"),
      { tags: { area: "strategy-share-mint" } },
    );
    return NextResponse.json(MINT_FAILED, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }

  // (7) Derive. THREE arguments, in this order — see the header.
  const token = deriveShareToken(id, minted.nonce, minted.generation);

  // (8) The audit row. `generation` only — never the token (T-164-13).
  logAuditEvent(supabase, {
    action: "strategy.share.mint",
    entity_type: "strategy",
    entity_id: id,
    metadata: { generation: minted.generation },
  });

  // (9) The token is externalised exactly HERE and nowhere else.
  return NextResponse.json(
    { url: `${resolveAppUrl()}${SHARE_PATH_PREFIX}${token}` },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
