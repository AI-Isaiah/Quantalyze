import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const lookback = url.searchParams.get("lookback_days") || "28";
  const partnerTag = url.searchParams.get("partner_tag");

  // Build the upstream query string. partner_tag is optional — only forward
  // when present so unscoped callers stay on the existing code path.
  const upstreamParams = new URLSearchParams({ lookback_days: lookback });
  if (partnerTag) {
    upstreamParams.set("partner_tag", partnerTag);
  }

  try {
    const upstream = await fetch(
      `${ANALYTICS_URL}/api/match/eval?${upstreamParams.toString()}`,
      {
        headers: {
          ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
        },
      },
    );
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json({ error: text || "Eval failed" }, { status: upstream.status });
    }
    return NextResponse.json(await upstream.json());
  } catch (err) {
    console.error("[api/admin/match/eval] upstream error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
