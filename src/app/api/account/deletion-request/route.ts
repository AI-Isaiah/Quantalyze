import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { escapeHtml, notifyFounderGeneric } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";

/**
 * POST /api/account/deletion-request
 *
 * GDPR Art. 17 intake surface. Inserts a row into `data_deletion_requests`
 * and emails the founder. Deletion is then handled manually within the
 * 30-day SLA documented in the privacy policy. This route does NOT destroy
 * any user data on its own.
 */
export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: inserted, error } = await supabase
    .from("data_deletion_requests")
    .insert({ user_id: user.id })
    .select("id, requested_at")
    .single();

  if (error) {
    console.error("[api/account/deletion-request] Insert failed:", error);
    return NextResponse.json(
      { error: "Failed to record deletion request" },
      { status: 500 },
    );
  }

  // Fire-and-forget founder notification so the founder can begin manual
  // processing. Email failure is not fatal — the row is already persisted.
  // user.email and user.id come from auth.getUser() but escape defensively.
  const safeUserLabel = escapeHtml(user.email ?? user.id);
  const safeRequestedAt = escapeHtml(inserted?.requested_at ?? "(unknown)");
  const safeRequestId = escapeHtml(inserted?.id ?? "(unknown)");
  void notifyFounderGeneric(
    `Account deletion requested: ${user.email ?? user.id}`,
    `<p>A user has requested account deletion.</p>
     <p><strong>User:</strong> ${safeUserLabel}<br/>
     <strong>Requested:</strong> ${safeRequestedAt}<br/>
     <strong>Request id:</strong> ${safeRequestId}</p>
     <p><a href="${APP_URL}/admin">Open admin dashboard</a></p>
     <p style="color:#666;font-size:12px;">Complete deletion within 30 days per GDPR Art. 17. Update the completed_at column when done.</p>`,
  );

  return NextResponse.json({
    ok: true,
    request_id: inserted?.id,
    requested_at: inserted?.requested_at,
  });
}
