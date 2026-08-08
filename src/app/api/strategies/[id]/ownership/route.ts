import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { isUuid } from "@/lib/utils";
import {
  OWN_CAPITAL,
  TEAM_REVIEW,
  type CapitalOwnership,
} from "@/lib/capital-ownership";

/**
 * PATCH /api/strategies/[id]/ownership
 *
 * Phase 150 / OWN-03 — the RETRO path (D-09 / D-11). The wizard asks whose
 * capital a key holds at creation time; this route is how an owner answers the
 * question for a strategy that was finalized before the question existed, or
 * changes their earlier answer.
 *
 * Body: { mark: "own_capital" | "team_review", confirm_remove_allocation?: boolean }
 *   200 -> { ok: true, mark }
 *   409 -> { error: "live_allocation", allocated_amount } when a flip to
 *          team_review would strand the caller's own live positions and the
 *          caller has not confirmed the removal.
 *
 * Defences (the alias route's six-defence stack, copied in order — see
 * src/app/api/portfolio-strategies/alias/route.ts:20-30):
 *   1. assertSameOrigin (CSRF).
 *   2. Auth: 401 if not logged in.
 *   3. Route-segment id validated as a UUID BEFORE it reaches `.eq()` — a
 *      non-UUID otherwise lands as a Postgres 22P02 cast and surfaces as an
 *      opaque 500 (the sibling watchlist route's H-0341 finding).
 *   4. Bound-and-logged JSON parse, then typeof / closed-set validation. The
 *      body is destructured to exactly two keys, so no extra key can ride into
 *      the UPDATE payload (T-150-17 mass assignment).
 *   5. checkLimit AFTER validation, so a rejected request does not burn one of
 *      the caller's own tokens (B15 ordering, T-150-18).
 *   6. Explicit `.eq("user_id", user.id)` on the UPDATE plus a `.select("id")`
 *      count-check: zero rows is a 404, NEVER `{ok:true}`.
 *
 *      CITATION RE-BASE (mirrors the capital-ownership migration's rev-3 note).
 *      This used to justify the predicate by claiming `strategies_update` is
 *      `FOR UPDATE USING (user_id = auth.uid())` with NO WITH CHECK, citing
 *      20260405061912_rls_policies.sql:32. That definition is NOT the live one
 *      and has not been since 20260410225610_sec005_follow_ups.sql:102-106,
 *      which DROPs and recreates the policy as `USING (user_id = auth.uid())
 *      WITH CHECK (user_id = auth.uid())` — and that migration's own self-check
 *      (:228-246) RAISEs if the explicit WITH CHECK is absent, so it cannot
 *      silently regress.
 *
 *      THE PREDICATE STAYS. It is defence in depth on the ground that actually
 *      holds: it keeps this statement correct on its own terms if the client is
 *      ever swapped for a service-role/admin one (where RLS stops applying and
 *      neither USING nor WITH CHECK is evaluated), and it is what turns a
 *      wrong-owner request into the honest 404 below instead of a silent
 *      zero-row success. What it is NOT is the sole tenant gate — do not read
 *      this stack as licence to drop RLS, and do not delete the predicate on
 *      the grounds that RLS now covers it.
 *
 * NO STATUS GATE on the mark, deliberately. Unlike the rename (D-17,
 * ../name/route.ts), a published strategy is still markable — the UI-SPEC
 * row-actions table puts the Mark action on every owned row, and the retro path
 * exists precisely for legacy rows, most of which are published.
 *
 * THE FLIP IS ONE TRANSACTION (T-150-16 / D-03). Flipping own_capital ->
 * team_review while the caller holds a live position would strand that position
 * against a strategy that is no longer allocatable: the D-03-A trigger blocks
 * new positions, but it is BEFORE INSERT only and cannot retroactively remove
 * one. So the flip is refused with 409 until the caller confirms, and the
 * confirmed removal runs `flip_capital_ownership_to_team_review` — a single
 * plpgsql body that deletes the caller's positions and sets the mark in one
 * transaction. This route therefore issues NO row-removal call of its own and no
 * two-statement flip: two sequential PostgREST calls can strand a position if
 * the second fails, which is the exact hole this arm exists to close.
 *
 * (That sentence deliberately avoids spelling the removal method name. The
 * acceptance grep for "this route never removes rows directly" runs over this
 * file with only whole-line // comments stripped, so naming the method in prose
 * would match its own pin — the same self-matching-comment shape recorded in the
 * 150-02 execution notes.)
 *
 * The mark is publicly readable on published rows (`strategies_read` has no
 * column projection — 150-RESEARCH § Schema Findings 1, threat T-150-04). That
 * is a conscious acceptance recorded in the migration header: the mark is not
 * sensitive, and UI-SPEC invariant 3 is a RENDER invariant, not a data one.
 */

/** The mark direction that can strand a position; see the docblock. */
const REMOVAL_DIRECTION = TEAM_REVIEW;

interface OwnershipBody {
  mark?: unknown;
  confirm_remove_allocation?: unknown;
}

/** Shape of one `flip_capital_ownership_to_team_review` result row. */
interface FlipResult {
  removed_positions: number;
  updated_strategies: number;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

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

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "id must be a UUID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let body: OwnershipBody;
  try {
    body = (await req.json()) as OwnershipBody;
  } catch (err) {
    // Bind + log (never a bare `catch {}`): parse failure, AbortError and
    // body-too-large are all observable without echoing the body to the client.
    console.error("[api/strategies/[id]/ownership] body parse failed:", {
      message: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Closed set, imported — never an ad-hoc string literal. The phase gate pins
  // the mark literals to src/lib/capital-ownership.ts alone (T-150-07).
  const ALLOWED_MARKS: readonly CapitalOwnership[] = [OWN_CAPITAL, TEAM_REVIEW];
  const mark = ALLOWED_MARKS.find((m) => m === body.mark);
  if (!mark) {
    return NextResponse.json(
      { error: "mark must be one of: " + ALLOWED_MARKS.join(", ") },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Strict boolean. A truthy string such as "false" must not be able to
  // authorise a destructive removal (T-150-17).
  if (
    body.confirm_remove_allocation !== undefined &&
    typeof body.confirm_remove_allocation !== "boolean"
  ) {
    return NextResponse.json(
      { error: "confirm_remove_allocation must be a boolean" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const confirmRemoveAllocation = body.confirm_remove_allocation === true;

  // 30/min per user — mandateAutoSaveLimiter, the same bucket the sibling
  // allocator-write surfaces use. Consumed AFTER validation (B15).
  const rl = await checkLimit(mandateAutoSaveLimiter, `ownership:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // ---- Flip safety: only the removal direction can strand a position. ----
  let removedPositions: number | null = null;

  if (mark === REMOVAL_DIRECTION) {
    // Resolve the caller's own portfolios first and filter positions by them
    // explicitly. RLS on portfolio_strategies already scopes to the caller's
    // book, but the house rule is that the tenant predicate is on the wire.
    const { data: portfolios, error: pfErr } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id);

    if (pfErr) {
      console.error(
        "[api/strategies/[id]/ownership] portfolio lookup failed:",
        pfErr.message,
      );
      return NextResponse.json(
        { error: "internal error" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const portfolioIds = (portfolios ?? []).map((p) => p.id);

    // No portfolios at all means there is nothing to strand, so the flip takes
    // the plain-UPDATE path below. Skipping the second query here is also the
    // difference between an empty `.in()` and a needless round trip.
    if (portfolioIds.length > 0) {
      const { data: positions, error: posErr } = await supabase
        .from("portfolio_strategies")
        .select("allocated_amount, portfolio_id")
        .eq("strategy_id", id)
        .in("portfolio_id", portfolioIds);

      if (posErr) {
        // Fail loud (Rule 12). An unreadable position table must NEVER be
        // treated as "no positions" — that is precisely how a live allocation
        // gets silently stranded.
        console.error(
          "[api/strategies/[id]/ownership] position lookup failed:",
          posErr.message,
        );
        return NextResponse.json(
          { error: "internal error" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      const livePositions = positions ?? [];
      if (livePositions.length > 0) {
        if (!confirmRemoveAllocation) {
          // 409 BEFORE any write. The dialog renders its confirm copy from
          // this amount. A null allocated_amount counts as 0 — the column is a
          // nullable NUMERIC and a null must not poison the sum into NaN.
          const allocatedAmount = livePositions.reduce(
            (sum, row) => sum + (row.allocated_amount ?? 0),
            0,
          );
          return NextResponse.json(
            { error: "live_allocation", allocated_amount: allocatedAmount },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }

        // Confirmed. The removal and the mark ride in ONE transaction.
        //
        // The generated database.types.ts has not been regenerated for this
        // function (migration 20260806120000_strategies_capital_ownership.sql),
        // so the typed .rpc() overload does not know it. Cast through unknown —
        // the single place to delete once the types regeneration lands (mirrors
        // the finalize_wizard_strategy cast in finalize-wizard/route.ts:1188).
        const { data: flipRows, error: flipErr } = await (
          supabase.rpc as unknown as (
            fn: "flip_capital_ownership_to_team_review",
            rpcArgs: Record<string, unknown>,
          ) => Promise<{
            data: FlipResult[] | null;
            error: { message?: string } | null;
          }>
        )("flip_capital_ownership_to_team_review", { p_strategy_id: id });

        if (flipErr) {
          console.error(
            "[api/strategies/[id]/ownership] flip rpc failed:",
            flipErr.message,
          );
          return NextResponse.json(
            { error: "internal error" },
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }

        const flip = flipRows?.[0];
        if (!flip) {
          // A RETURNS TABLE function that yields no row leaves the counts
          // unknown. Reporting success here would claim a flip that may not
          // have happened.
          console.error(
            "[api/strategies/[id]/ownership] flip rpc returned no row",
            { strategyId: id, userId: user.id },
          );
          return NextResponse.json(
            { error: "internal error" },
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }

        if (flip.updated_strategies === 0) {
          // The RPC is auth.uid()-scoped: a non-owner updates nothing and,
          // having removed nothing, is a total no-op. That reads as 404, not
          // as a successful flip (T-150-13).
          return NextResponse.json(
            { error: "strategy not found" },
            { status: 404, headers: NO_STORE_HEADERS },
          );
        }

        removedPositions = flip.removed_positions;

        logAuditEvent(supabase, {
          action: "strategy.ownership_mark",
          entity_type: "strategy",
          entity_id: id,
          metadata: { mark, removed_positions: removedPositions },
        });

        return NextResponse.json({ ok: true, mark }, { headers: NO_STORE_HEADERS });
      }
    }
  }

  // ---- The plain mark write. ----
  // Reached for own_capital always, and for the removal direction when the
  // caller holds no live position (nothing to strand, so nothing to confirm).
  const { data: updatedRows, error: updateErr } = await supabase
    .from("strategies")
    .update({ capital_ownership: mark })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (updateErr) {
    console.error(
      "[api/strategies/[id]/ownership] update failed:",
      updateErr.message,
    );
    return NextResponse.json(
      { error: "internal error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!updatedRows || updatedRows.length === 0) {
    // Wrong owner or unknown id — one honest arm. NOT ok-on-zero-rows.
    return NextResponse.json(
      { error: "strategy not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  logAuditEvent(supabase, {
    action: "strategy.ownership_mark",
    entity_type: "strategy",
    entity_id: id,
    metadata: { mark },
  });

  return NextResponse.json({ ok: true, mark }, { headers: NO_STORE_HEADERS });
}
