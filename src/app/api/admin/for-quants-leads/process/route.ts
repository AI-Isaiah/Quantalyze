import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { createClient } from "@/lib/supabase/server";
import {
  markLeadProcessed,
  unmarkLeadProcessed,
  type SetLeadProcessedResult,
} from "@/lib/for-quants-leads-admin";
import { isUuid } from "@/lib/utils";
import { logAuditEvent } from "@/lib/audit";

// POST — toggle a lead's processed state. Body: { id, unprocess?: boolean }
export const POST = withAdminAuth(async (body) => {
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
  // blind spot — emission goes here, at the user-intent site. We use a
  // user-scoped client so `auth.uid()` inside `log_audit_event` resolves
  // to the acting admin.
  const auditSupabase = await createClient();
  logAuditEvent(auditSupabase, {
    action: unprocess ? "lead.unprocess" : "lead.process",
    entity_type: "for_quants_lead",
    entity_id: id as string,
  });

  return NextResponse.json({ ok: true, unprocessed: unprocess === true });
});
