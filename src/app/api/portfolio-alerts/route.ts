import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";
import { logAuditEvent } from "@/lib/audit";
import type { User } from "@supabase/supabase-js";

/**
 * Pagination defaults — audit 2026-05-12 Lane E P464.
 *
 * The legacy GET returned EVERY unack'd alert for the user with no
 * upper bound, which (a) is a wall-time DoS vector once a portfolio
 * has thousands of alerts, and (b) lets a single response exceed the
 * Vercel edge response-size budget. We adopt the same `limit`/`offset`
 * idiom that `src/app/api/admin/compute-jobs/route.ts` already uses:
 *   - default `limit = 50`
 *   - hard ceiling `limit = 200` (clamped server-side)
 *   - `offset >= 0`
 *
 * The response carries `{ alerts, page_size, offset, has_more }` so
 * the client can drive a "load more" affordance without re-counting.
 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export const GET = withAuth(async (req: NextRequest, user: User) => {
  const url = new URL(req.url);
  const portfolioId = url.searchParams.get("portfolio_id");

  // P464 — clamp limit/offset. `Math.min(... || DEFAULT, MAX)` mirrors
  // the pattern in compute-jobs/route.ts; the explicit `Math.max(1,
  // ...)` floor protects against `?limit=0` / negative-number trolling.
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit")) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const supabase = await createClient();

  let query = supabase
    .from("portfolio_alerts")
    .select("*")
    .is("acknowledged_at", null)
    .order("triggered_at", { ascending: false })
    // Fetch one extra so we can return `has_more` without a COUNT(*)
    // round-trip. Trim it back to `limit` before responding.
    .range(offset, offset + limit);

  if (portfolioId) {
    if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }
    query = query.eq("portfolio_id", portfolioId);
  } else {
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id);
    const portfolioIds = (portfolios ?? []).map((p) => p.id);
    if (portfolioIds.length === 0) {
      return NextResponse.json({
        alerts: [],
        page_size: limit,
        offset,
        has_more: false,
      });
    }
    query = query.in("portfolio_id", portfolioIds);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = data ?? [];
  // We asked for `limit + 1` rows via `.range(offset, offset + limit)`
  // (inclusive). If we got more than `limit` back, there's another
  // page — slice off the probe row and signal `has_more = true`.
  const hasMore = rows.length > limit;
  const alerts = hasMore ? rows.slice(0, limit) : rows;
  return NextResponse.json({
    alerts,
    page_size: limit,
    offset,
    has_more: hasMore,
  });
});

export const PATCH = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { alert_id } = body as { alert_id?: string };

  if (!alert_id) {
    return NextResponse.json({ error: "Missing alert_id" }, { status: 400 });
  }

  // Single UPDATE with subquery for ownership check (no TOCTOU window)
  const supabase = await createClient();
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id);
  const portfolioIds = (portfolios ?? []).map((p) => p.id);

  if (portfolioIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("portfolio_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", alert_id)
    .in("portfolio_id", portfolioIds)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Alert not found or forbidden" }, { status: 404 });
  }

  // Sprint 6 Task 7.1b — audit the in-app ack. The email-ack path in
  // /api/alerts/ack emits the same action via logAuditEventAsUser
  // (resolved owner id via the HMAC token, no JWT on the wire).
  logAuditEvent(supabase, {
    action: "alert.acknowledge",
    entity_type: "alert",
    entity_id: alert_id,
    metadata: { source: "in_app_list" },
  });

  return NextResponse.json({ success: true });
});
