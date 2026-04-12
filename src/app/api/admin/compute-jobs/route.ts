import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import type { ComputeJobAdminRow } from "@/lib/types";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = request.nextUrl;
  const p_limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 200));
  const p_offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const p_status = url.searchParams.get("status") || null;
  const p_kind = url.searchParams.get("kind") || null;
  const p_exchange = url.searchParams.get("exchange") || null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_admin_compute_jobs", {
    p_limit,
    p_offset,
    p_status,
    p_kind,
    p_exchange,
  });

  if (error) {
    console.error("get_admin_compute_jobs RPC failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch compute jobs" },
      { status: 500 },
    );
  }

  return NextResponse.json((data ?? []) as ComputeJobAdminRow[]);
}
