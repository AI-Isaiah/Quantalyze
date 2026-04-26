import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  serializeAuditLogCsv,
  type AuditLogRow,
} from "@/lib/audit-log-csv";
import { auditLogExportLimiter, checkLimit } from "@/lib/ratelimit";

/**
 * GET /api/me/audit-log/export — Phase 11 / D-05 self-serve audit-log CSV.
 *
 * Returns the caller's last 90 days of `audit_log` rows as a downloadable
 * CSV. The response is bounded at 10,000 rows (BLOCK-1 mitigation: caps
 * the in-memory `rows.map(...).join("\n")` build at roughly 2 MB so a
 * pathological caller cannot OOM the serverless function).
 *
 * Authority chain:
 *   - Per-user isolation is enforced by the existing `audit_log_owner_read`
 *     RLS policy (migration 010_portfolio_intelligence.sql:179):
 *       USING (user_id = auth.uid())
 *     We use the user-scoped Supabase client (cookies-bridged) rather
 *     than the service-role admin client so RLS does the gating at the
 *     DB layer.
 *   - The 90-day window is enforced TS-side via the `.gte('created_at', …)`
 *     filter on the SELECT chain.
 *   - The 10K row cap is enforced TS-side via the SELECT chain's `.limit`
 *     call below.
 *
 * No CSRF check: this is a GET; CSRF defense is for state-mutating verbs.
 *
 * Rate limit (Phase 11 review fix IN-03): the 10K row cap bounds a
 * SINGLE response at ~2 MB, but does not bound the request rate. A
 * malicious authenticated user could script N-per-second hits to inflate
 * Supabase egress without bound. `auditLogExportLimiter` caps a user at
 * 10 exports per hour — well above any legitimate compliance/forensic
 * review cadence and well below abuse thresholds. Distinct from
 * `exportLimiter` (1/day for the GDPR full-account bundle).
 *
 * @audit-skip: read-only export of caller's own audit_log rows. The
 *   download itself does not mutate state; emitting an audit event for
 *   a read of audit_log would create an audit-log-of-audit-logs feedback
 *   loop. Out of scope per D-05 ("download a CSV of the last 90 days").
 *   audit-coverage.test.ts scans for .insert/.update/.delete/.upsert; the
 *   chain below uses only .select, so this pragma is defense-in-depth in
 *   case the regex is widened.
 *
 * Streaming via ReadableStream is a deliberate Phase 11+1+ deferral.
 * Today's bounded-rows approach is simpler, has zero new dependencies,
 * and gives the same 10K-cap memory ceiling as a streamed implementation
 * with rate limiting.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phase 11 review fix IN-03: per-user rate limit on the CSV export.
  // 10/hour bounds Supabase egress on this endpoint without gating
  // legitimate compliance review.
  const rl = await checkLimit(
    auditLogExportLimiter,
    `audit_log_export:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // RLS policy `audit_log_owner_read` (USING user_id = auth.uid()) does the
  // per-user gating; this client is user-scoped so the policy applies.
  // BLOCK-1: the hard row ceiling on the next chain — do not remove without
  // replacing with a streaming implementation.
  const { data: rows, error } = await supabase
    .from("audit_log")
    .select("created_at, action, entity_type, entity_id, metadata")
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) {
    console.error("[api/me/audit-log/export] query failed:", error);
    return NextResponse.json(
      { error: "Failed to read audit log" },
      { status: 500 },
    );
  }

  const csv = serializeAuditLogCsv((rows ?? []) as AuditLogRow[]);
  const filename = `quantalyze-audit-log-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
