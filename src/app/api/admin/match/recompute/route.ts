import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { recomputeMatch } from "@/lib/analytics-client";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = await checkLimit(adminActionLimiter, `match-recompute:${user!.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: { allocator_id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.allocator_id || typeof body.allocator_id !== "string") {
    return NextResponse.json({ error: "allocator_id is required" }, { status: 400 });
  }

  try {
    const result = await recomputeMatch(body.allocator_id, body.force ?? false);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/match/recompute] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
