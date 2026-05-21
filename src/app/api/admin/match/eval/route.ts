import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { evalMatch } from "@/lib/analytics-client";
import { assertSameOrigin } from "@/lib/csrf";

// Audit-2026-05-07 C-0041: same-origin guard runs before auth so a
// cross-origin probe with a replayed session cookie hits the CSRF wall
// before any DB/RPC work. Sibling /api/admin/match/{decisions,kill-switch,
// send-intro,recompute} POST/DELETE handlers follow the same pattern.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const lookback = url.searchParams.get("lookback_days") || "28";
  const partnerTag = url.searchParams.get("partner_tag") ?? undefined;

  try {
    const data = await evalMatch({
      lookback_days: lookback,
      partner_tag: partnerTag,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/admin/match/eval] upstream error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
