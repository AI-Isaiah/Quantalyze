import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { isUuid } from "@/lib/utils";

/**
 * PATCH /api/strategies/[id]/name
 *
 * Phase 150 / OWN-05 — the owner relabels their OWN private or draft strategy
 * in their own words ("Helios alpha sleeve"), replacing the allow-listed name
 * the wizard assigned.
 *
 * Body: { name: string }   // trimmed, 1..80 chars
 *   200 -> { ok: true, name }
 *   400 -> { error: "invalid name" } (empty after trim) | { error: "name too long" }
 *   404 -> wrong owner, unknown id, OR a published row (the D-17 gate)
 *
 * Defences: the alias route's six-defence stack
 * (src/app/api/portfolio-strategies/alias/route.ts:20-30), copied in order.
 * Two deliberate divergences from that analog:
 *
 *   1. REJECT, NEVER TRUNCATE. The alias route silently caps its input at 120
 *      characters. That is acceptable for an allocator's private row label; it
 *      is NOT acceptable for a proper name the owner will see rendered back.
 *      Silently dropping the tail of a name is a fail-quiet, so an over-long
 *      name is a 400 and no write happens. `strategies.name` is bare TEXT with
 *      no database cap (20260405061911_initial_schema.sql:52), so the 80-char
 *      bound is a PRODUCT rule this route is the sole enforcer of.
 *
 *   2. A SERVER-SIDE STATUS GATE (D-17, T-150-14). `.in("status", ["private",
 *      "draft"])` rides in the UPDATE chain, so an attempt to rename a
 *      published row matches zero rows and answers 404. Hiding the button is
 *      not enforcement. The predicate is spelled as an `in` over the two
 *      allowed statuses rather than as a negated equality against the
 *      published status, on purpose: any raw equality filter on that status
 *      is swept repo-wide by src/lib/visibility.test.ts:87-134 and must route
 *      through withPublishedOnly() instead. (That sweep reads RAW file text
 *      with no comment stripping, so this paragraph deliberately describes the
 *      forbidden filter without spelling it — naming it here would make this
 *      file its own offender.)
 *
 * The explicit `.eq("user_id", user.id)` is load-bearing, not belt-and-braces:
 * `strategies_update` RLS is `FOR UPDATE USING (user_id = auth.uid())` with NO
 * WITH CHECK (20260405061912_rls_policies.sql:32), so this predicate is the
 * real tenant gate (T-150-13). The `.select("id")` count-check then turns every
 * refusal — wrong owner, unknown id, published row — into one honest 404 rather
 * than a silent `{ok:true}` that touched nothing.
 *
 * PITFALL-3 CONSCIOUS ACCEPTANCE (150-RESEARCH.md § Pitfall 3), recorded here
 * so it does not read as an oversight: this route is the FIRST path putting
 * free text into `strategies.name`, which until now was constrained to the
 * STRATEGY_NAMES allow-list by the wizard (finalize-wizard/route.ts:365). The
 * public pseudonymity contract (C-0112) is nevertheless byte-untouched — public
 * surfaces render the codename per the disclosure rules in browse/route.ts and
 * displayStrategyName regardless of what `name` holds, and the proper name is
 * the OWNER's own label. D-17 restricts the rename to private/draft rows, and
 * publication is admin-gated by guard_strategies_publish_transition
 * (20260716131000), so an admin reviews the name before it can ever become
 * public. That is the accepted residual risk (T-150-15), not an unnoticed hole.
 *
 * D-18: this route writes `strategies.name` and nothing else. The codename /
 * disclosure redaction contract is not read, not written, and not widened here.
 */

/** Product cap from the UI-SPEC. `strategies.name` itself is uncapped TEXT. */
const MAX_NAME_LENGTH = 80;

interface NameBody {
  name?: unknown;
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

  let body: NameBody;
  try {
    body = (await req.json()) as NameBody;
  } catch (err) {
    console.error("[api/strategies/[id]/name] body parse failed:", {
      message: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Normalisation is trim ONLY. Everything else is validated and rejected —
  // the route never silently reshapes the owner's chosen name.
  if (typeof body.name !== "string") {
    return NextResponse.json(
      { error: "invalid name" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const name = body.name.trim();
  if (name.length === 0) {
    return NextResponse.json(
      { error: "invalid name" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // Measured AFTER trimming, so surrounding padding never pushes an otherwise
  // legal name over the cap.
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: "name too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Consumed AFTER validation so a rejected name does not burn one of the
  // caller's own tokens (B15 ordering, T-150-18).
  const rl = await checkLimit(mandateAutoSaveLimiter, `rename:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  const { data: updatedRows, error: updateErr } = await supabase
    .from("strategies")
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id)
    .in("status", ["private", "draft"])
    .select("id");

  if (updateErr) {
    console.error("[api/strategies/[id]/name] update failed:", updateErr.message);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!updatedRows || updatedRows.length === 0) {
    // ONE honest arm for three causes: wrong owner, unknown id, or a published
    // row refused by the D-17 predicate above. Distinguishing them would leak
    // row existence to a caller probing ids.
    return NextResponse.json(
      { error: "strategy not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  logAuditEvent(supabase, {
    action: "strategy.rename",
    entity_type: "strategy",
    entity_id: id,
    metadata: { name },
  });

  return NextResponse.json({ ok: true, name }, { headers: NO_STORE_HEADERS });
}
