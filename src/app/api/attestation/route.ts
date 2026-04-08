import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ATTESTATION_VERSION = "2026-04-07";

/**
 * POST /api/attestation
 * Records the current user's accredited-investor attestation. Idempotent —
 * if a row already exists for the user, the existing row is returned.
 *
 * Invoked by `AccreditedInvestorGate.tsx` on form submission.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { accepted?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.accepted !== true) {
    return NextResponse.json(
      { error: "Attestation must be explicitly accepted" },
      { status: 400 },
    );
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  // Upsert without ignoreDuplicates so Supabase reliably returns a row. On a
  // first-time attestation this writes the new row; on a repeat attestation
  // it overwrites `attested_at` to "now" which we want anyway (the user has
  // re-affirmed). `.select().single()` is safe here because the upsert
  // always produces exactly one row — before the fix, ignoreDuplicates:true
  // meant the duplicate-skip path returned no rows, which would crash any
  // caller that added `.select().single()` naively.
  const { data: attestation, error } = await supabase
    .from("investor_attestations")
    .upsert(
      {
        user_id: user.id,
        attested_at: new Date().toISOString(),
        version: ATTESTATION_VERSION,
        ip_address: ipAddress,
      },
      { onConflict: "user_id" },
    )
    .select("user_id, attested_at, version")
    .single();

  if (error) {
    console.error("[api/attestation] Insert failed:", error);
    return NextResponse.json(
      { error: "Failed to record attestation" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, attestation });
}
