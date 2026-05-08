import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { verifyStrategy } from "@/lib/analytics-client";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { getCorrelationId } from "@/lib/correlation-id";

const MAX_REQUESTS_PER_DAY = 5;

const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

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

  // Phase 19 / BACKBONE-10 — gate behind unified-backbone flag.
  // Public-route protections (CSRF + IP rate-limit + payload validation)
  // run BEFORE the flag check so unified delegation cannot bypass them.
  if (await isUnifiedBackboneActive()) {
    return await unifiedVerifyStrategyHandler(body);
  }

  return await legacyVerifyStrategyHandler({
    email,
    exchange,
    api_key,
    api_secret,
    passphrase,
  });
}

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=teaser`. Source is the user-supplied exchange (already validated
 * against SUPPORTED_EXCHANGES above).
 */
async function unifiedVerifyStrategyHandler(
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    console.error("[verify-strategy] INTERNAL_API_TOKEN not configured");
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const correlationId = await getCorrelationId();
  const exchange = (body.exchange as string) ?? "okx";
  const res = await fetch(`${ANALYTICS_URL}/process-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalToken}`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      flow_type: "teaser",
      source: exchange,
      context: body,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }
  return NextResponse.json(await res.json());
}

/**
 * Legacy path preserved verbatim from the pre-Phase-19 implementation.
 * Runs when `isUnifiedBackboneActive()` returns false. Will be removed in a
 * follow-up cleanup PR after the 7-day stability window passes.
 */
async function legacyVerifyStrategyHandler(args: {
  email: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}): Promise<NextResponse> {
  const { email, exchange, api_key, api_secret, passphrase } = args;

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
