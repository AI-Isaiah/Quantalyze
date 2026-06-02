import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import {
  markLeadProcessed,
  unmarkLeadProcessed,
  leadExists,
  type SetLeadProcessedResult,
} from "@/lib/for-quants-leads-admin";
import { logAuditEventAsUser } from "@/lib/audit";

// POST — toggle a lead's processed state. Body: { id, unprocess?: boolean }
//
// audit-2026-05-07 (PR-2 2026-05-28): per-admin rate limit on the toggle
// surface. The opt-in is plumbed through the withAdminAuth wrapper so the
// auth + audit-on-deny + body parse stay centralised.
//
// B15b (audit-2026-05-07): the body is schema-validated INSIDE withAdminAuth
// BEFORE the rate-limit token is consumed, so a non-UUID `id` returns 400
// without burning the admin's adminActionLimiter bucket. The wrapper passes
// the validated, typed body to the handler — the prior in-handler isUuid
// guard is now redundant and was removed.
const BODY_SCHEMA = z.object({
  id: z.string().uuid(),
  unprocess: z.boolean().optional(),
});
type ProcessBody = z.infer<typeof BODY_SCHEMA>;

export const POST = withAdminAuth(
  async (body: ProcessBody, admin, user) => {
    const { id, unprocess } = body;

    const result: SetLeadProcessedResult = unprocess
      ? await unmarkLeadProcessed(id)
      : await markLeadProcessed(id);

    if (!result.ok && result.reason === "not_found") {
      // M-0269 (audit-2026-05-07 F5b): the conditional UPDATE in
      // mark/unmarkLeadProcessed filters on `processed_at`, so a row ALREADY
      // in the requested state matches 0 rows == "not_found",
      // indistinguishable from a row that genuinely does not exist. A retried
      // / double-submitted POST that lands after the first succeeded must not
      // surface a hard error for an operation that already took effect.
      // Disambiguate via the for_quants_leads service-role chokepoint:
      //   row exists  -> already in target state -> 200 idempotent no-op
      //   row missing -> genuinely not found     -> 404
      if (await leadExists(id)) {
        return NextResponse.json({ ok: true, noop: true });
      }
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // /review follow-up (T4-C1): the audit-coverage grep test only
    // inspects route files for inline mutations; the mutation lives in
    // `markLeadProcessed` / `unmarkLeadProcessed` (helpers in
    // `@/lib/for-quants-leads-admin`), so the grep scan can't see it. The
    // hardened grep-coverage test now flags this as a helper-indirection
    // blind spot — emission goes here, at the user-intent site.
    //
    // B4b: those helpers UPDATE for_quants_leads via the service-role
    // (createAdminClient) client, so the audit emits via the service path with
    // the explicit acting-admin id (log_audit_event_service) — JWT-immune, not
    // a user-JWT auth.uid() emit that drops in the post-response after() window.
    logAuditEventAsUser(admin, user.id, {
      action: unprocess ? "lead.unprocess" : "lead.process",
      entity_type: "for_quants_lead",
      entity_id: id,
    });

    return NextResponse.json({ ok: true, unprocessed: unprocess === true });
  },
  {
    schema: BODY_SCHEMA,
    rateLimitKey: (user) => `admin-fql-process:${user.id}`,
  },
);
