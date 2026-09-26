import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import type { ComputeJobAdminRow } from "@/lib/types";

export async function GET(request: NextRequest) {
  // audit-2026-05-07 C-0041 follow-up — same-origin guard on admin
  // GETs that return PII / sensitive operational data. Mirror the
  // sibling admin/match/{allocators,eval} routes.
  const csrfError = assertSameOrigin(request);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const url = request.nextUrl;
  const p_limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 200));
  const p_offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const p_status = url.searchParams.get("status") || null;
  const p_kind = url.searchParams.get("kind") || null;
  const p_exchange = url.searchParams.get("exchange") || null;

  // Phase 169.3 (D-15): read the `compute_jobs_admin` view directly, with the
  // service-role client, only AFTER the `isAdminUser` gate above. The
  // `get_admin_compute_jobs` database function is NOT used: it fails on every
  // call ("column reference id is ambiguous": its `id` OUT column collides with
  // `profiles.id` in its admin check), and behind that the check reads `auth.uid()`, which is
  // NULL under the service role, so it would return no rows (169 RESEARCH root
  // cause A). The function is left in the catalogue, unused; dropping it is a
  // migration, tracked as TODOS.md [169-DEAD-ADMIN-JOBS-RPC] (D-01).
  //
  // Explicit projection: exactly the 21 columns the client row type
  // (`ComputeJobAdminRow`) consumes. Never a star select, never `claim_token`
  // (the view does not expose it; see compute-jobs-claim-token-not-leaked),
  // and not the view's `strategy_user_id` / `portfolio_user_id`.
  const admin = createAdminClient();
  let query = admin
    .from("compute_jobs_admin")
    .select(
      "id, strategy_id, portfolio_id, kind, status, attempts, max_attempts, next_attempt_at, claimed_at, claimed_by, last_error, error_kind, idempotency_key, exchange, trade_count, created_at, updated_at, metadata, strategy_name, portfolio_name, user_email",
    );
  if (p_status) query = query.eq("status", p_status);
  if (p_kind) query = query.eq("kind", p_kind);
  if (p_exchange) query = query.eq("exchange", p_exchange);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(p_offset, p_offset + p_limit - 1);

  if (error) {
    console.error("compute_jobs_admin view read failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch compute jobs" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json((data ?? []) as ComputeJobAdminRow[], { headers: NO_STORE_HEADERS });
}
