import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";

// GET — returns { enabled: boolean }
// POST — body { enabled: boolean }, flips the flag. Admin only.
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_flags")
    .select("enabled, updated_at, updated_by")
    .eq("key", "match_engine_enabled")
    .maybeSingle();

  // Surface infrastructure errors instead of silently defaulting to enabled=true.
  // If system_flags doesn't exist (migration 011 not applied) the founder needs to
  // know that the engine isn't actually deployed — not see a misleading green pill.
  if (error) {
    console.error("[api/admin/match/kill-switch] read error:", error);
    return NextResponse.json(
      { error: "Match engine schema not found. Apply migration 011 to your Supabase project." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    enabled: data?.enabled ?? true,
    updated_at: data?.updated_at,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("system_flags")
    .update({
      enabled: body.enabled,
      updated_at: new Date().toISOString(),
      updated_by: user!.id,
    })
    .eq("key", "match_engine_enabled");

  if (error) {
    console.error("[api/admin/match/kill-switch] error:", error);
    return NextResponse.json({ error: "Failed to update flag" }, { status: 500 });
  }

  return NextResponse.json({ success: true, enabled: body.enabled });
}
