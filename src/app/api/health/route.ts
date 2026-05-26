import { NextResponse } from "next/server";
import { getAuditEmitTransientFailures } from "@/lib/audit";

/**
 * GET /api/health
 *
 * Lightweight health endpoint. Returns process-lifetime counters for
 * observability; primarily surfaces the `auditEmitTransientFailures`
 * counter so ops dashboards / alert rules can detect a stream of silent
 * transient audit drops without waiting for a full deploy log review.
 *
 * NEW-C10-02 (audit-2026-05-26 silent-failure): the audit module docs
 * stated "/api/health surfaces the [transient failure] metric" but no
 * such route existed — `getAuditEmitTransientFailures()` was imported
 * ONLY by tests, making every transient audit drop fully invisible to
 * production observability. This route closes that gap.
 *
 * The counter is process-lifetime (resets on cold start). Alert if
 * `audit_emit_transient_failures > 0` on a fresh cold-start frame, or
 * if it grows monotonically between health checks.
 *
 * No authentication required — this is a public liveness endpoint.
 * It surfaces no PII or secret state; only counters are returned.
 */
export function GET(): NextResponse {
  const auditEmitTransientFailures = getAuditEmitTransientFailures();
  return NextResponse.json(
    {
      ok: true,
      audit_emit_transient_failures: auditEmitTransientFailures,
    },
    {
      status: auditEmitTransientFailures > 0 ? 207 : 200,
      headers: {
        // No caching — this must always reflect the live counter.
        "Cache-Control": "no-store",
      },
    },
  );
}
