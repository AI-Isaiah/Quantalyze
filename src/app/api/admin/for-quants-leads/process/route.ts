import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import {
  markLeadProcessed,
  unmarkLeadProcessed,
  type SetLeadProcessedResult,
} from "@/lib/for-quants-leads-admin";
import { isUuid } from "@/lib/utils";
import { logAuditEventAsUser } from "@/lib/audit";

// POST — toggle a lead's processed state. Body: { id, unprocess?: boolean }
//
// audit-2026-05-07 (PR-2 2026-05-28): per-admin rate limit on the toggle
// surface. The opt-in is plumbed through the withAdminAuth wrapper so the
// auth + audit-on-deny + body parse stay centralised.
export const POST = withAdminAuth(async (body, admin, user) => {
  const { id, unprocess } = body;
  if (!isUuid(id as string)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  const result: SetLeadProcessedResult = unprocess
    ? await unmarkLeadProcessed(id as string)
    : await markLeadProcessed(id as string);

  if (!result.ok && result.reason === "not_found") {
    return NextResponse.json(
      { error: "Lead not found or already in the requested state" },
      { status: 404 },
    );
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
    entity_id: id as string,
  });

  return NextResponse.json({ ok: true, unprocessed: unprocess === true });
}, { rateLimitKey: (user) => `admin-fql-process:${user.id}` });
