import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF defense via Origin/Referer header validation.
 *
 * The app relies on Supabase's SameSite=Lax cookie as primary CSRF defense.
 * This helper adds defense-in-depth: mutating POST requests must present an
 * Origin (or Referer fallback) header whose host matches an allowlist.
 *
 * Allowlist sources:
 *   - NEXT_PUBLIC_SITE_URL env var (production host)
 *   - localhost:3000 / localhost:3001 in development
 *
 * Returns null on success (caller proceeds), or a NextResponse with 403 on
 * failure.
 */
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      hosts.add(new URL(siteUrl).host);
    } catch {
      console.warn("[csrf] NEXT_PUBLIC_SITE_URL is not a valid URL:", siteUrl);
    }
  }
  // Vercel preview deployments get unique URLs. Allow them for QA.
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercelUrl) {
    try {
      hosts.add(new URL(`https://${vercelUrl}`).host);
    } catch { /* malformed — skip */ }
  }
  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("localhost:3001");
    hosts.add("127.0.0.1:3000");
  }
  return hosts;
}

// Cache the allowed hosts at module load. Changes to env vars require a redeploy.
const ALLOWED_HOSTS = buildAllowedHosts();

// audit-2026-05-07 round-2 Block D / P1947 — the 403 rejection paths returned
// from authenticated mutating routes must not be cached cross-tenant. The
// header is cheap defense-in-depth even though 403s are already rarely
// cached.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function assertSameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const source = origin ?? referer;

  if (!source) {
    return NextResponse.json(
      { error: "Missing Origin or Referer header" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    return NextResponse.json(
      { error: "Invalid Origin header" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  return null;
}

/**
 * Test helper — allows tests to reset the ALLOWED_HOSTS cache after mutating
 * NODE_ENV or NEXT_PUBLIC_SITE_URL. DO NOT call this from production code.
 */
export function __resetAllowedHostsForTest(): void {
  const fresh = buildAllowedHosts();
  ALLOWED_HOSTS.clear();
  fresh.forEach((host) => ALLOWED_HOSTS.add(host));
}
