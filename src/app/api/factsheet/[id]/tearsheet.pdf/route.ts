import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { extractAnalytics } from "@/lib/queries";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { isUuid } from "@/lib/utils";

export const maxDuration = 30;

// audit-2026-05-07 C-0092 — drop the module-level NEXT_PUBLIC_APP_URL
// constant. Mirrors the sibling pdf/route.ts C-0086 fix: a misconfigured
// env var (or one influenced via the deployment env surface) would
// otherwise drive the puppeteer instance to fetch an attacker-controlled
// URL via the `${APP_URL}/factsheet/${id}/tearsheet` interpolation. The
// per-request `appUrl(req)` resolver below pulls origin from the request
// and enforces a production allowlist + VERCEL_URL fallback for previews.
const APP_URL_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "quantalyze-rho.vercel.app",
  "quantalyze.com",
  "www.quantalyze.com",
]);

function isHostAllowed(host: string): boolean {
  if (APP_URL_ALLOWED_HOSTS.has(host)) return true;
  const vercelUrl = process.env.VERCEL_URL;
  if (typeof vercelUrl === "string" && vercelUrl.length > 0 && host === vercelUrl) {
    return true;
  }
  return false;
}

/**
 * Resolves the puppeteer goto origin from the inbound request. Mirrors
 * the C-0086 fix in pdf/route.ts:
 *   - Prefer `req.nextUrl.origin` (the deployment serving this request).
 *   - In production VERCEL_ENV, require the host to be in the allowlist
 *     or equal to VERCEL_URL — otherwise return null and let the caller
 *     hard-fail. This closes the SSRF attack surface where a spoofed Host
 *     header (or misconfigured proxy) could redirect puppeteer to an
 *     attacker-controlled origin.
 *   - Outside production, fall back to NEXT_PUBLIC_APP_URL / localhost
 *     so `next dev` and unit tests work unchanged.
 *
 * The `origin !== "null"` literal-string guard is load-bearing — opaque-
 * origin URLs (sandboxed iframes, certain SSR contexts) serialize as the
 * string "null" per WHATWG URL.
 */
function appUrl(req: NextRequest): string | null {
  const origin = req.nextUrl.origin;
  if (origin && origin !== "null") {
    if (process.env.VERCEL_ENV === "production") {
      try {
        const host = new URL(origin).host;
        if (!isHostAllowed(host)) return null;
      } catch {
        return null;
      }
    }
    return origin;
  }
  // Opaque/missing origin: production hard-fails (no fingerprintable
  // env-driven fallback); other envs preserve the legacy localhost path.
  if (process.env.VERCEL_ENV === "production") return null;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * GET /api/factsheet/[id]/tearsheet.pdf
 *
 * Optional PDF wrapper around the HTML tear sheet at /factsheet/[id]/tearsheet.
 * The HTML page is the canonical surface — the founder can always
 * `window.print()` on it if the PDF generation fails. Uses the shared
 * `launchBrowser()` helper so it works on both Vercel and local dev.
 *
 * Listed in `PUBLIC_ROUTES` via /api/factsheet in src/proxy.ts so a cap-intro
 * partner can open a tear sheet URL without a login redirect.
 *
 * SECURITY INVARIANT (audit-2026-05-07 C-0189 closure, red-team
 * 2026-05-17 MED conf 8 hardening):
 *
 *   This route MUST NOT forward session cookies to the Puppeteer-launched
 *   browser. The downstream HTML page redacts institutional manager
 *   identity for unattested callers; a stateless Puppeteer (no cookies)
 *   keeps every PDF in the unattested-redacted lane, which is the
 *   invariant that lets us cache the response via `s-maxage=3600` below
 *   without per-user cache keys.
 *
 *   The invariant is "stateless render", not just "no setCookie call".
 *   Statelessness here has TWO load-bearing pieces — both must hold:
 *
 *     (a) DO NOT add `page.setCookie(...)` or `Cookie` in
 *         `page.setExtraHTTPHeaders(...)`. Either would inject session
 *         state into the rendered HTML directly.
 *
 *     (b) The `browser.close()` in the `finally` block IS load-bearing.
 *         Puppeteer's cookie jar is BROWSER-scoped, not page-scoped.
 *         If a deployer points NEXT_PUBLIC_APP_URL at a Vercel preview /
 *         protected origin, the upstream HTML server (Next.js on the
 *         same project) issues `Set-Cookie` via the supabase
 *         `cookieStore.setAll` call inside getFactsheetDetail. Puppeteer
 *         silently stores those cookies in the browser's jar. The first
 *         render is anonymous and the PDF gets cached, but if a future
 *         optimization hoists the `browser` instance to module scope or
 *         to Vercel Fluid Compute warm-instance reuse, the jar leaks
 *         across requests — the next render reuses the prior session's
 *         cookies and the cached PDF goes institutional.
 *
 *         If you need to hoist the browser for cold-start cost, switch
 *         to a per-request `BrowserContext`:
 *             const context = await browser.createBrowserContext();
 *             const page = await context.newPage();
 *             ... finally { await context.close(); }
 *         so the cookie jar is provably scoped to one render. Don't drop
 *         the per-request close without that.
 *
 *   If you need per-user PDFs (you almost certainly don't), ALSO remove
 *   the `s-maxage` Cache-Control header below or the CDN will serve one
 *   user's PDF to the next.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Cross-lambda IP rate limit. Returns 429 BEFORE we touch the
  // acquirePdfSlot semaphore or any DB query — so a scraper hammering this
  // surface can't burn the in-memory queue or generate Supabase load.
  // Cache hits served from Vercel's CDN bypass this entirely, which is the
  // correct behavior for a public IP-based limiter.
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `pdf:${ip}`);
  if (!rl.success) {
    return new NextResponse("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    });
  }

  const { id } = await params;

  // audit-2026-05-07 C-0092 — validate `id` is a UUID before any string
  // interpolation. Pre-fix the un-validated id flowed straight into the
  // puppeteer goto URL — combined with the APP_URL constant this was a
  // bare SSRF primitive. Reject with 400 (NOT 404) so the contract maps
  // 1:1 to the validation failure rather than masquerading as a missing
  // strategy lookup.
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid strategy id" }, { status: 400 });
  }

  // audit-2026-05-07 C-0092 — resolve the puppeteer goto target BEFORE
  // grabbing the queue slot / launching Chromium. A null return means
  // production allowlist rejected the request origin or the origin was
  // opaque; hard-fail so we never silently fall back to a localhost or
  // attacker-controlled host.
  const targetOrigin = appUrl(req);
  if (targetOrigin === null) {
    console.error(
      "[tearsheet-pdf] Refused to render: request origin not allow-listed in production",
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const { data: strategy, error } = await admin
    .from("strategies")
    .select("id, name, status, strategy_analytics (computation_status)")
    .eq("id", id)
    .eq("status", "published")
    .single();

  if (error || !strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const analytics = extractAnalytics(strategy.strategy_analytics);
  // B3 (Phase 19.1): admit `complete_with_warnings` — CSV strategies with an
  // unavailable benchmark still compute valid metrics under this terminal
  // status. Parity with the /strategy/[id] factsheet render gate; without it a
  // complete_with_warnings strategy renders metrics on the page but 400s here.
  if (
    !analytics ||
    (analytics.computation_status !== "complete" &&
      analytics.computation_status !== "complete_with_warnings")
  ) {
    return NextResponse.json(
      { error: "Analytics not computed" },
      { status: 400 },
    );
  }

  let browser: Browser | null = null;
  let release: (() => void) | null = null;

  try {
    release = await acquirePdfSlot();
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15_000);
    page.setDefaultTimeout(15_000);
    await page.setViewport({ width: 816, height: 1056 }); // 8.5 × 11 @ 96 DPI

    await page.goto(`${targetOrigin}/factsheet/${id}/tearsheet`, {
      waitUntil: "networkidle0",
      timeout: 25000,
    });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
    });

    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(strategy.name, "Strategy")}-tearsheet.pdf"`,
        // audit-2026-05-07 C-0093 — Cache-Control + Vary contract.
        //
        // Pre-fix: `s-maxage=3600, stale-while-revalidate=86400` (public)
        // with NO Vary header. Two failure modes:
        //   1. CDN cross-alias bleed — Vercel routes preview deployments
        //      under multiple aliases; without Vary, the shared CDN can
        //      serve a preview-aliased PDF to a production-aliased
        //      request. The PDF bytes are a function of the Host header
        //      at generation time (via appUrl(req) → puppeteer goto), so
        //      the CDN MUST key per-host.
        //   2. Disclosure-tier staleness — when an admin moves a
        //      strategy from institutional → exploratory, the
        //      previously-rendered PDF (still showing institutional
        //      identity) keeps serving from the CDN for up to 25 hours
        //      (s-maxage 3600 + stale-while-revalidate 86400). Tighten
        //      max-age to 5 minutes so disclosure-tier downgrades flush
        //      within an acceptable window.
        //
        // FOLLOW-UP: a disclosure_tier change should ALSO trigger
        // CDN invalidation explicitly (e.g. via revalidateTag once we
        // adopt cache tags here). Tracked as a separate item in the
        // tech-debt backlog — the conservative max-age=300 above bounds
        // the worst-case staleness in the meantime.
        //
        // Vary: Cookie, Authorization — even though the route is
        // currently stateless (no cookies forwarded to puppeteer; see
        // the SECURITY INVARIANT block at module top), declaring Vary
        // on auth-bearing headers prevents the CDN from serving a
        // cached anonymous render to a future authenticated request if
        // statelessness ever regresses.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300",
        Vary: "Cookie, Authorization, Host",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return new NextResponse("PDF generation queue full, retry in 10 seconds", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
    console.error("[tearsheet-pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[tearsheet-pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
