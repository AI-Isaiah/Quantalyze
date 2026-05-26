import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { isUuid } from "@/lib/utils";
import {
  adminActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

// H-0212 (audit-2026-05-07): the holdings payload is per-user portfolio
// composition. Forbid shared/intermediary caching so a stale or
// cross-user copy can never be served from a proxy/CDN. Mirrors the
// NO_STORE_HEADERS contract on the GDPR-export latest route.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// GET /api/admin/allocators/[id]/holdings
//
// Returns the allocator's current holdings (from portfolio_strategies on their
// real portfolio) as `{ id, name }[]` — used by the SendIntroPanel holdings
// dropdown to let the admin pick the underperformer being replaced.
//
// Phase 5 D-20c Option A (2026-04-19): the allocator's current holdings are the
// only legitimate v1 source for `original_strategy_id` on match_decisions.
// Admin-only route — never exposed to allocators.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: allocator_id } = await params;
  if (!allocator_id || typeof allocator_id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  // M-0261 / H-0212 (audit-2026-05-07): validate UUID shape BEFORE it
  // reaches `.eq("user_id", allocator_id)`. A non-UUID string otherwise
  // hits Postgres as a `22P02` invalid-uuid cast and surfaces as an opaque
  // 500; worse, it widens the enumeration surface flagged in the H-0212
  // chain. Mirror the `isUuid` guard the sibling
  // /api/admin/for-quants-leads/process route already applies.
  if (!isUuid(allocator_id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  // audit-2026-05-07 C-0041 follow-up — same-origin guard on admin
  // GETs that return PII / sensitive operational data. Mirror the
  // sibling admin/match/{allocators,eval} routes.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // H-0211 / H-0212 / H-0213 (audit-2026-05-07): this privacy-sensitive
  // admin read discloses an arbitrary allocator's holdings keyed by
  // user_id. Without a limiter a compromised/stolen admin session can walk
  // every allocator UUID at request rate and exfiltrate the full holdings
  // graph (each row drives a send-intro decision). Apply the same
  // adminActionLimiter the sibling GET /api/admin/users/[id]/roles read
  // path uses, keyed on the acting admin with a `:get` suffix so the read
  // cadence does not interfere with mutating-route limiter accounting.
  // Runs AFTER the admin gate so a non-admin can neither consume nor probe
  // the admin bucket. The read path is deliberately NOT audited (matches
  // the roles GET and the audit-coverage gate, which only requires
  // emission on mutations).
  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:allocator-holdings:get`,
  );
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable", code: "ratelimit_misconfigured" },
        { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const admin = createAdminClient();

  // Step 1 — resolve the allocator's real portfolio (is_test=false).
  const { data: portfolio, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", allocator_id)
    .eq("is_test", false)
    .maybeSingle();

  if (portfolioErr) {
    console.error(
      "[api/admin/allocators/[id]/holdings] portfolio lookup error:",
      portfolioErr,
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!portfolio) {
    // No real portfolio yet — allocator has no holdings to point at.
    return NextResponse.json({ holdings: [] }, { headers: NO_STORE_HEADERS });
  }

  const portfolioId = (portfolio as { id: string }).id;

  // Step 2 — fetch portfolio_strategies + joined strategy names.
  const { data: rows, error: rowsErr } = await admin
    .from("portfolio_strategies")
    .select(
      `
      strategy_id,
      strategy:strategies!inner (
        id,
        name
      )
      `,
    )
    .eq("portfolio_id", portfolioId)
    .order("current_weight", { ascending: false });

  if (rowsErr) {
    console.error(
      "[api/admin/allocators/[id]/holdings] rows lookup error:",
      rowsErr,
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Normalize the embedded join (Supabase returns object or array).
  type RawStrategy = { id: string; name: string | null };
  const holdings = ((rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const raw = row.strategy;
    const strat = (Array.isArray(raw) ? raw[0] : raw) as RawStrategy | null;
    return {
      id: (row.strategy_id as string) ?? strat?.id ?? "",
      name: strat?.name ?? "Unnamed strategy",
    };
  });

  return NextResponse.json({ holdings }, { headers: NO_STORE_HEADERS });
}
