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
    const res = NextResponse.json(payload);
    // Audit-2026-05-07 P335: CDN-cache for 10s with 60s SWR. The route is
    // hard-locked to ALLOCATOR_ACTIVE_ID, so the response is a constant
    // function of (route, seed UUID, db state). Caching at the edge for
    // 10 seconds absorbs viral / burst traffic without keeping a stale
    // snapshot around long enough to mislead the next reviewer. `Vary:
    // Cookie` is defensive — the route doesn't currently personalize on
    // cookies, but if a future PR threads any session state through, the
    // CDN must key on it instead of serving the same response to all
    // visitors.
    res.headers.set("Cache-Control", "public, s-maxage=10, stale-while-revalidate=60");
    res.headers.set("Vary", "Cookie");
    return res;
  } catch (err) {
    console.error("[api/demo/match/[allocator_id]] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
