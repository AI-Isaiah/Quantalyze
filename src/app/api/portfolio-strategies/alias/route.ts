import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * PATCH /api/portfolio-strategies/alias
 *
 * Allocator-provided display name override for a single investment row.
 * Part of the v0.4.0 My Allocation pivot: each row on the dashboard is
 * an investment the allocator made by connecting a team to their
 * exchange account, and they want to label it in their own words
 * ("Helios alpha sleeve", "Atlas momentum book", etc.) without
 * changing the canonical strategy name that other viewers see.
 *
 * Body: { portfolio_id: string, strategy_id: string, alias: string | null }
 *
 * Defenses (mirrors /api/watchlist/[strategyId] verbatim — see
 * audit-2026-05-07 G8.B.7 / FIX-LIST P268 for the divergence rationale):
 *   1. assertSameOrigin (CSRF — same as watchlist).
 *   2. mandateAutoSaveLimiter (30/min per user — same as watchlist).
 *   3. Auth: 401 if not logged in.
 *   4. Ownership: 404 if the portfolio isn't owned by the authed user.
 *   5. RLS on portfolio_strategies as the second gate.
 *   6. Mass-assignment guard (G8.B.6): UPDATE returns the affected
 *      strategy_ids via .select() — zero rows → 404, NOT a silent
 *      success oracle.
 */

interface AliasBody {
  portfolio_id?: unknown;
  strategy_id?: unknown;
  alias?: unknown;
}

export async function PATCH(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: AliasBody;
  try {
    body = (await req.json()) as AliasBody;
  } catch (err) {
    // audit-2026-05-07 G8.B.3 / FIX-LIST P264 — bare empty catch
    // hides any error type from req.json (parse failure, AbortError,
    // request body too large, DOMException). Bind + log so abusive
    // bodies and unexpected request-stream issues are visible in
    // observability without leaking the message body to the client.
    console.error("[api/portfolio-strategies/alias] body parse failed:", {
      message: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const portfolioId =
    typeof body.portfolio_id === "string" ? body.portfolio_id.trim() : "";
  const strategyId =
    typeof body.strategy_id === "string" ? body.strategy_id.trim() : "";
  if (!portfolioId || !strategyId) {
    return NextResponse.json(
      { error: "portfolio_id and strategy_id are required" },
      { status: 400 },
    );
  }

  // Alias: trim + empty-string to null. Max 120 chars to match the
  // column's reasonable display-name budget and to keep a single-line
  // table row readable.
  let alias: string | null;
  if (body.alias === null || body.alias === undefined) {
    alias = null;
  } else if (typeof body.alias === "string") {
    const trimmed = body.alias.trim();
    alias = trimmed.length > 0 ? trimmed.slice(0, 120) : null;
  } else {
    return NextResponse.json(
      { error: "alias must be a string or null" },
      { status: 400 },
    );
  }

  // 30/min per user — matches the watchlist toggle rate (the closest
  // sibling allocator-write surface). Aligns the alias rename surface
  // with the convention the rest of the dashboard's mutating self-
  // actions follow (audit-2026-05-07 G8.B.7). Consumed AFTER input
  // validation so a malformed/invalid request rejected with 400 does
  // not burn one of the caller's own rate-limit tokens (B15).
  const rl = await checkLimit(mandateAutoSaveLimiter, `alias:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Ownership check: the portfolio must belong to the authed user. RLS
  // would catch this too, but an explicit check gives a cleaner 404
  // than a silent no-op UPDATE.
  const { data: portfolio, error: pfErr } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pfErr) {
    console.error("[api/portfolio-strategies/alias] portfolio lookup failed:", pfErr.message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!portfolio) {
    return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  }

  // audit-2026-05-07 G8.B.6 / FIX-LIST P267 — count-check the UPDATE.
  // Without `.select()`, .update().eq().eq() returns ok-on-zero-rows
  // when the (portfolio_id, strategy_id) tuple does not exist in
  // portfolio_strategies. That's a confused-deputy oracle: the route
  // returned `{ok:true}`, the audit log recorded a write attempt, but
  // no row was touched. Asking PostgREST to return the affected
  // strategy_ids gives us a deterministic 404 path for "investment
  // row not found" without leaking row-existence via timing.
  const { data: updatedRows, error: updateErr } = await supabase
    .from("portfolio_strategies")
    .update({ alias })
    .eq("portfolio_id", portfolioId)
    .eq("strategy_id", strategyId)
    .select("strategy_id");

  if (updateErr) {
    console.error("[api/portfolio-strategies/alias] update failed:", updateErr.message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "investment row not found" },
      { status: 404 },
    );
  }

  // Sprint 6 Task 7.1b — audit the alias rename. entity_id pins to the
  // portfolio row (the top-level ownership anchor) since portfolio_strategies
  // has a (portfolio_id, strategy_id) composite PK with no standalone UUID.
  logAuditEvent(supabase, {
    action: "allocation.update",
    entity_type: "allocation",
    entity_id: portfolioId,
    metadata: { strategy_id: strategyId, alias },
  });

  return NextResponse.json({ ok: true, alias });
}
