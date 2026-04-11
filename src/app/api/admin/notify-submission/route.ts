import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

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

  // Verify the caller owns this strategy
  const { data: owned } = await supabase
    .from("strategies")
    .select("id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();

  const [{ data: strategy }, managerName] = await Promise.all([
    admin.from("strategies").select("name").eq("id", strategy_id).single(),
    resolveManagerName(admin, user),
  ]);

  await notifyFounderNewStrategy(strategy?.name ?? "Unknown strategy", managerName);

  return NextResponse.json({ success: true });
}
