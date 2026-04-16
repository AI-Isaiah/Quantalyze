import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Vercel Cron — weekly (Sundays 03:00 UTC), deletes `used_ack_tokens`
 * rows whose `used_at` is older than 30 days.
 *
 * Why 30 days: the minted ack tokens themselves TTL at 48h
 * (src/lib/alert-ack-token.ts), so a replay of a token older than that
 * already fails the HMAC `exp` check. The `used_ack_tokens` table exists
 * purely to block re-use within the 48h live window. A 30-day retention
 * gives us plenty of forensic runway (audit "did this token ever land?")
 * without letting the table grow unbounded.
 *
 * Auth: Bearer ${CRON_SECRET}, timing-safe — mirrors sync-funding cron.
 * Vercel Cron dispatches GET; POST accepted for manual incident response.
 *
 * Schedule + secret: see `vercel.json` (`/api/cron/cleanup-ack-tokens`).
 */

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 30 days ago in ISO. Using a computed string keeps the query planner's
  // cost model honest vs. pushing `now() - interval '30 days'` through a
  // PostgREST filter.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("used_ack_tokens")
    .delete()
    .lt("used_at", cutoff)
    .select("token_hash");

  if (error) {
    console.error("[cron/cleanup-ack-tokens] delete failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data?.length ?? 0 });
}

export const GET = handle;
export const POST = handle;
