import { NextRequest, NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * CSRF defense via Origin/Referer header validation.
 *
 * The app relies on Supabase's SameSite=Lax cookie as primary CSRF defense.
 * This helper adds defense-in-depth: mutating POST requests must present an
 * Origin (or Referer fallback) header whose host matches an allowlist.
 *
 * Allowlist sources:
 *   - NEXT_PUBLIC_SITE_URL env var (production host)
 *   - NEXT_PUBLIC_ALLOWED_ORIGINS env var (comma-separated extra hosts,
 *     for custom-domain deployments alongside NEXT_PUBLIC_SITE_URL)
 *   - NEXT_PUBLIC_VERCEL_URL (Vercel preview deployment URL)
 *   - localhost:3000 / localhost:3001 in development
 *
 * Returns null on success (caller proceeds), or a NextResponse with 403 on
 * failure.
 *
 * Red-team 2026-05-17 (red-team:custom-domain-frozen-allowlist, MED conf
 * 8): added NEXT_PUBLIC_ALLOWED_ORIGINS so a future custom-domain rollout
 * (e.g. quantalyze.com alongside quantalyze-rho.vercel.app) doesn't 403
 * every cross-domain manager request with a misleading permission-style
 * error in the UI. Set it as a comma-separated URL list.
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
  // Red-team 2026-05-17: extra allowed origins for multi-domain deploys.
  // Comma-separated URLs (with or without scheme). Each entry is parsed
  // into a host; malformed entries are warned and skipped without
  // breaking the rest of the list.
  const extraOrigins = process.env.NEXT_PUBLIC_ALLOWED_ORIGINS;
  if (extraOrigins) {
    for (const raw of extraOrigins.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const withScheme = trimmed.includes("://")
        ? trimmed
        : `https://${trimmed}`;
      try {
        hosts.add(new URL(withScheme).host);
      } catch {
        console.warn(
          "[csrf] NEXT_PUBLIC_ALLOWED_ORIGINS entry is not a valid URL:",
          trimmed,
        );
      }
    }
  }
  // Vercel preview deployments get unique URLs. Allow them for QA.
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercelUrl) {
    try {
      hosts.add(new URL(`https://${vercelUrl}`).host);
    } catch {
      // M-0901: surface a malformed value the same way the
      // NEXT_PUBLIC_SITE_URL (L34) and NEXT_PUBLIC_ALLOWED_ORIGINS (L52)
      // branches do, instead of dropping it silently. A silent skip here
      // would 403 every preview-deployment POST with no operator-visible
      // reason — the exact misconfig this warn makes greppable.
      console.warn(
        "[csrf] NEXT_PUBLIC_VERCEL_URL is not a valid host:",
        vercelUrl,
      );
    }
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
