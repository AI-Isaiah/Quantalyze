import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";

const VALID_STATUSES = ["pending", "intro_made", "completed", "declined"] as const;

export const POST = withAdminAuth(async (body, admin) => {
  const { id, status, admin_note } = body;
  if (!id || !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    responded_at: new Date().toISOString(),
  };

  if (typeof admin_note === "string") {
    update.admin_note = admin_note;
  }

  const { error } = await admin
    .from("contact_requests")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
