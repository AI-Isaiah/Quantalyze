import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyManagerIntroRequest,
  notifyFounderIntroRequest,
} from "@/lib/email";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { strategy_id, message } = body;

  if (!strategy_id) {
    return NextResponse.json(
      { error: "strategy_id is required" },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("contact_requests").insert({
    allocator_id: user.id,
    strategy_id,
    message: message || null,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already requested" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 },
    );
  }

  const userEmail = user.email;
  const userId = user.id;
  Promise.resolve().then(async () => {
    try {
      const admin = createAdminClient();
      const [{ data: strategy }, { data: allocatorProfile }] = await Promise.all([
        admin.from("strategies").select("name, user_id").eq("id", strategy_id).single(),
        admin.from("profiles").select("display_name, company").eq("id", userId).single(),
      ]);

      if (!strategy) return;

      const allocatorName =
        allocatorProfile?.display_name ??
        allocatorProfile?.company ??
        userEmail ??
        "An allocator";

      if (strategy.user_id) {
        const { data: managerProfile } = await admin
          .from("profiles")
          .select("email")
          .eq("id", strategy.user_id)
          .single();

        if (managerProfile?.email) {
          notifyManagerIntroRequest(managerProfile.email, allocatorName, strategy.name);
        }
      }

      notifyFounderIntroRequest(allocatorName, strategy.name);
    } catch { /* email failure is non-fatal */ }
  });

  return NextResponse.json({ success: true });
}
