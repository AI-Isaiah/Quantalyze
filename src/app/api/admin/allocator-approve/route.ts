import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";

export const POST = withAdminAuth(async (body, admin) => {
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await admin
    .from("profiles")
    .update({ allocator_status: "verified" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
