import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { notifyAllocatorIntroStatus } from "@/lib/email";

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

  // Send email to allocator on status change (fire-and-forget)
  if (status !== "pending") {
    const { data: request } = await admin
      .from("contact_requests")
      .select("allocator_id, strategy_id")
      .eq("id", id)
      .single();

    if (request) {
      const [{ data: allocator }, { data: strategy }] = await Promise.all([
        admin.from("profiles").select("email").eq("id", request.allocator_id).single(),
        admin.from("strategies").select("name").eq("id", request.strategy_id).single(),
      ]);

      if (allocator?.email && strategy?.name) {
        notifyAllocatorIntroStatus(allocator.email, strategy.name, status as string).catch(() => {});
      }
    }
  }

  return NextResponse.json({ success: true });
});
