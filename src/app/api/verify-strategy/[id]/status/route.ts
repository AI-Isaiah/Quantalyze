import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Phase 19 / BACKBONE-04 step (a) / H-1 — status read repoint.
 *
 * The teaser status route reads the verification row that the POST handler
 * (verify-strategy/route.ts:115) wrote. Now that PR-A repoints the write to
 * `strategy_verifications`, the read MUST also be repointed in the same PR
 * — otherwise teaser status URLs return 404 for the entire PR-A → PR-D
 * stability window.
 *
 * H-1 read order:
 *   1. Try `strategy_verifications` first (new canonical target post-PR-A).
 *      `metrics_snapshot` is the column that maps to legacy `results`.
 *   2. Fall back to legacy `verification_requests` for any historical row
 *      whose POST happened before PR-A landed (no strategy_verifications
 *      row yet) OR for a row that PR-A's upsert skipped because no
 *      strategies anchor was available.
 *
 * After migration 107 ships (PR-D), the legacy table becomes
 * `verification_requests_legacy` + a VIEW with the same name backed by
 * `strategy_verifications`. The fallback below continues to resolve the
 * 90-day public-token retention window (M-6) by hitting the renamed legacy
 * table directly.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token parameter" }, { status: 400 });
  }

  const admin = createAdminClient();

  // H-1: query strategy_verifications first.
  const { data: sv } = await admin
    .from("strategy_verifications")
    .select("id, status, public_token, expires_at, metrics_snapshot")
    .eq("id", id)
    .maybeSingle();

  let resolved: {
    id: string;
    status: string;
    public_token: string | null;
    expires_at: string | null;
    results: unknown;
  } | null = null;

  if (sv && sv.public_token) {
    resolved = {
      id: sv.id,
      status: sv.status,
      public_token: sv.public_token,
      expires_at: sv.expires_at,
      results: sv.metrics_snapshot,
    };
  } else {
    // Fall back to the legacy verification_requests table for rows that
    // haven't been mirrored into strategy_verifications yet.
    const { data: legacy } = await admin
      .from("verification_requests")
      .select("id, status, public_token, expires_at, results")
      .eq("id", id)
      .maybeSingle();
    if (legacy) {
      resolved = {
        id: legacy.id,
        status: legacy.status,
        public_token: legacy.public_token,
        expires_at: legacy.expires_at,
        results: legacy.results,
      };
    }
  }

  if (!resolved) {
    return NextResponse.json({ error: "Verification not found" }, { status: 404 });
  }

  // --- Validate capability token (constant-time to prevent timing attacks) ---
  if (!resolved.public_token || !safeCompare(resolved.public_token, token)) {
    return NextResponse.json({ error: "Verification not found" }, { status: 404 });
  }

  // --- Check expiry ---
  if (resolved.expires_at && new Date(resolved.expires_at) < new Date()) {
    return NextResponse.json({ error: "Verification has expired" }, { status: 410 });
  }

  // --- Return status + results ---
  const response: Record<string, unknown> = {
    status: resolved.status,
  };

  // Phase 19 / API-4: legacy strategy_verifications uses 'complete'; the
  // unified backbone (strategy_verifications.status post-PR-A) uses
  // 'published' as the terminal success state. Accept both so teaser status
  // pages keep rendering results across the migration.
  if (
    (resolved.status === "complete" || resolved.status === "published") &&
    resolved.results
  ) {
    response.results = resolved.results;
  }

  return NextResponse.json(response);
}
