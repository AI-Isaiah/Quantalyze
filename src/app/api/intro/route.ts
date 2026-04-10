import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyManagerIntroRequest,
  notifyFounderIntroRequest,
  notifyAllocatorOfIntroRequest,
} from "@/lib/email";
import { loadManagerIdentity } from "@/lib/manager-identity";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { DisclosureTier, ManagerIdentity } from "@/lib/types";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `intro:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Defense-in-depth: verify the user has an allocator role before allowing
  // intro requests. RLS on contact_requests is the DB-layer gate, but a broken
  // policy would silently let any authenticated user insert rows.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "allocator" && profile.role !== "both")) {
    return NextResponse.json(
      { error: "Only allocators can request introductions" },
      { status: 403 },
    );
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
        admin
          .from("strategies")
          .select("id, name, user_id, disclosure_tier")
          .eq("id", strategy_id)
          .single(),
        admin.from("profiles").select("display_name, company").eq("id", userId).single(),
      ]);

      if (!strategy) return;

      const allocatorName =
        allocatorProfile?.display_name ??
        allocatorProfile?.company ??
        userEmail ??
        "An allocator";

      const disclosureTier: DisclosureTier =
        (strategy as { disclosure_tier?: DisclosureTier }).disclosure_tier ??
        "exploratory";

      // Manager identity block is only assembled for institutional-tier strategies.
      // Exploratory-tier allocator emails get a redacted "disclosed on acceptance" copy.
      let managerBlock: ManagerIdentity | null = null;
      if (strategy.user_id) {
        // Fetch email separately so the identity helper doesn't need to
        // widen its SELECT column list — email isn't part of ManagerIdentity.
        const { data: managerEmailRow } = await admin
          .from("profiles")
          .select("email")
          .eq("id", strategy.user_id)
          .single();

        if (managerEmailRow?.email) {
          notifyManagerIntroRequest(managerEmailRow.email, allocatorName, strategy.name);
        }

        if (disclosureTier === "institutional") {
          managerBlock = await loadManagerIdentity(admin, strategy.user_id);
        }
      }

      if (userEmail) {
        notifyAllocatorOfIntroRequest(
          userEmail,
          strategy.name,
          strategy.id,
          managerBlock,
        );
      }

      notifyFounderIntroRequest(allocatorName, strategy.name);
    } catch { /* email failure is non-fatal */ }
  });

  return NextResponse.json({ success: true });
}
