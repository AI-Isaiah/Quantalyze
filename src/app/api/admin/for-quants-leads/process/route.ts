import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import {
  markLeadProcessed,
  unmarkLeadProcessed,
  type SetLeadProcessedResult,
} from "@/lib/for-quants-leads-admin";
import { isUuid } from "@/lib/utils";

// POST — toggle a lead's processed state. Body: { id, unprocess?: boolean }
export const POST = withAdminAuth(async (body) => {
  const { id, unprocess } = body;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  const result: SetLeadProcessedResult = unprocess
    ? await unmarkLeadProcessed(id)
    : await markLeadProcessed(id);

  if (!result.ok && result.reason === "not_found") {
    return NextResponse.json(
      { error: "Lead not found or already in the requested state" },
      { status: 404 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, unprocessed: unprocess === true });
});
