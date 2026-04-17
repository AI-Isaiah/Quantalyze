import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
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
 * Auth: 401 if not logged in. 403 if the portfolio isn't owned by the
 * authed user (checked by the portfolios row matching user_id). RLS on
 * portfolio_strategies is the second gate and is keyed on the parent
 * portfolio's ownership.
 */

interface AliasBody {
  portfolio_id?: unknown;
  strategy_id?: unknown;
  alias?: unknown;
}

export async function PATCH(req: Request) {
  const csrfError = assertSameOrigin(req as NextRequest);
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
  } catch {
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

  // Ownership check: the portfolio must belong to the authed user. RLS
  // would catch this too, but an explicit check gives a cleaner 403
  // than a silent no-op UPDATE.
  const { data: portfolio, error: pfErr } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pfErr) {
    return NextResponse.json({ error: pfErr.message }, { status: 500 });
  }
  if (!portfolio) {
    return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  }

  const { error: updateErr } = await supabase
    .from("portfolio_strategies")
    .update({ alias })
    .eq("portfolio_id", portfolioId)
    .eq("strategy_id", strategyId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
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
