import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllocatorMatchPayload } from "@/lib/admin/match";
import { ALLOCATOR_ACTIVE_ID } from "@/lib/demo";

// GET /api/demo/match/[allocator_id]
//
// PUBLIC demo endpoint — no auth. This mirrors /api/admin/match/[allocator_id]
// but is HARD-LOCKED to the ALLOCATOR_ACTIVE seed UUID so a forwarded demo
// link cannot be pointed at a real allocator's match queue.
//
// Used by /demo/founder-view which renders AllocatorMatchQueue with
// forceReadOnly=true and sourceApiPath="/api/demo/match".
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const { allocator_id } = await params;

  // Hard assert: only the seeded Active Allocator is readable from this route.
  // Any other UUID (including admin-visible ones) gets a 403 to avoid exposing
  // real allocator state through the public demo lane.
  if (allocator_id !== ALLOCATOR_ACTIVE_ID) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  try {
    const payload = await getAllocatorMatchPayload(admin, allocator_id);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/demo/match/[allocator_id]] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
