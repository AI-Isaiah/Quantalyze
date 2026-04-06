import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token parameter" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: verification, error } = await admin
    .from("verification_requests")
    .select("id, status, public_token, expires_at, results")
    .eq("id", id)
    .single();

  if (error || !verification) {
    return NextResponse.json({ error: "Verification not found" }, { status: 404 });
  }

  // --- Validate capability token ---
  if (verification.public_token !== token) {
    return NextResponse.json({ error: "Verification not found" }, { status: 404 });
  }

  // --- Check expiry ---
  if (verification.expires_at && new Date(verification.expires_at) < new Date()) {
    return NextResponse.json({ error: "Verification has expired" }, { status: 410 });
  }

  // --- Return status + results ---
  const response: Record<string, unknown> = {
    status: verification.status,
  };

  if (verification.status === "complete" && verification.results) {
    response.results = verification.results;
  }

  return NextResponse.json(response);
}
