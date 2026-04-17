import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userActionLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEvent } from "@/lib/audit";

const ATTESTATION_VERSION = "2026-04-07";

/**
 * POST /api/attestation
 * Records the current user's accredited-investor attestation. Idempotent —
 * if a row already exists for the user, the existing row is returned.
 *
 * Invoked by `AccreditedInvestorGate.tsx` on form submission.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF defense-in-depth: reject before any auth/Upstash work so a bad
  // origin never costs us a Supabase round-trip or rate-limit token.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cross-lambda rate limit on sensitive identity-write actions. Falls open
  // when Upstash env vars are missing (local dev). See src/lib/ratelimit.ts.
  const rl = await checkLimit(userActionLimiter, `attestation:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
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

  // Reuse the ratelimit module's header parser so there's one source of
  // truth for client-IP extraction across attestation, deletion-request,
  // and the PDF routes. `getClientIp` returns `"unknown"` for a missing
  // header; we coerce that to null because `investor_attestations.ip_address`
  // is nullable and `"unknown"` would be a misleading audit row.
  const extractedIp = getClientIp(req.headers);
  const ipAddress = extractedIp === "unknown" ? null : extractedIp;

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

  // Sprint 6 Task 7.1b — audit the attestation. entity_id is the user's
  // own id (investor_attestations keys on user_id). Forensic trail for
  // "when did this user accept the accredited-investor attestation?"
  logAuditEvent(supabase, {
    action: "attestation.accept",
    entity_type: "investor_attestation",
    entity_id: user.id,
    metadata: { version: ATTESTATION_VERSION, has_ip: ipAddress !== null },
  });

  return NextResponse.json({ ok: true, attestation });
}
