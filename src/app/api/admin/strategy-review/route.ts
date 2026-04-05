import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, action, review_note } = await request.json();
  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (action === "approve") {
    const { error } = await admin
      .from("strategies")
      .update({ status: "published", review_note: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } else {
    const { error } = await admin
      .from("strategies")
      .update({ status: "draft", review_note: review_note || "Needs changes before approval." })
      .eq("id", id);
    if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
