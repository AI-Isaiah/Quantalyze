import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFounderNewStrategy } from "@/lib/email";

export async function POST(req: NextRequest) {
  // Verify the caller is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { strategy_id } = await req.json();
  if (!strategy_id) {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  const [{ data: strategy }, { data: profile }] = await Promise.all([
    admin.from("strategies").select("name").eq("id", strategy_id).single(),
    admin.from("profiles").select("display_name, company").eq("id", user.id).single(),
  ]);

  const managerName =
    profile?.display_name ?? profile?.company ?? user.email ?? "Unknown";
  const strategyName = strategy?.name ?? "Unknown strategy";

  await notifyFounderNewStrategy(strategyName, managerName);

  return NextResponse.json({ success: true });
}
