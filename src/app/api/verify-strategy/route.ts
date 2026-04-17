import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { verifyStrategy } from "@/lib/analytics-client";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";

const MAX_REQUESTS_PER_DAY = 5;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;
  // IP rate limit before any DB or Railway work
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `verify-strategy:${ip}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, exchange, api_key, api_secret, passphrase } = body as {
    email?: string;
    exchange?: string;
    api_key?: string;
    api_secret?: string;
    passphrase?: string;
  };

  if (!email || !exchange || !api_key || !api_secret) {
    return NextResponse.json(
      { error: "Missing required fields: email, exchange, api_key, api_secret" },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange as (typeof SUPPORTED_EXCHANGES)[number])) {
    return NextResponse.json(
      { error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` },
      { status: 400 },
    );
  }

  // Rate limit: max 5 requests per email per 24h
  const admin = createAdminClient();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await admin
    .from("verification_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", twentyFourHoursAgo);

  if (countError) {
    console.error("[verify-strategy] Rate limit check failed:", countError);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 verification requests per 24 hours." },
      { status: 429 },
    );
  }

  let analyticsResult: { verification_id?: string };
  try {
    analyticsResult = await verifyStrategy({
      email,
      exchange,
      api_key,
      api_secret,
      ...(passphrase ? { passphrase } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification service error";
    console.error("[verify-strategy] Analytics service error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const verificationId = analyticsResult.verification_id;
  if (!verificationId) {
    return NextResponse.json(
      { error: "Verification service returned an invalid response" },
      { status: 502 },
    );
  }

  const publicToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // @audit-skip: unauthenticated public endpoint (no user session). The
  // `verification_requests` row is internal-state plumbing for the
  // landing-page "verify my track record" flow; audit_log requires a
  // user_id and this caller has none. Follow-up landing-page-lead audit
  // would land in PostHog, not audit_log, per ADR-0023 §3.
  const { error: updateError } = await admin
    .from("verification_requests")
    .update({ public_token: publicToken, expires_at: expiresAt })
    .eq("id", verificationId);

  if (updateError) {
    console.error("[verify-strategy] Failed to set public token:", updateError);
    return NextResponse.json({ error: "Failed to finalize verification" }, { status: 500 });
  }

  return NextResponse.json({ verification_id: verificationId, public_token: publicToken });
}
