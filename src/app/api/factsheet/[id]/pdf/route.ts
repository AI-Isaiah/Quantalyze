import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractAnalytics } from "@/lib/queries";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { safeCompare } from "@/lib/timing-safe-compare";

export const maxDuration = 30;

/**
 * audit-2026-05-07 C-0090 — self-recursion fence.
 *
 * The PDF route launches a headless Chromium and `page.goto(...)`s the
 * SAME deployment's `/factsheet/[id]` HTML page to render its visual
 * output. That HTML page is canonically a leaf (it does not embed
 * `<img src="/api/factsheet/.../pdf">` or trigger another PDF render),
 * but the architecture has two latent recursion hazards:
 *
 *   1. If a future component on `/factsheet/[id]` ever fetches the PDF
 *      endpoint (e.g. a "download PDF" iframe preview), the inner
 *      puppeteer would launch another puppeteer, ad infinitum — under
 *      cold-start that doubles every level and exhausts the lambda's
 *      acquirePdfSlot semaphore.
 *   2. Inlining the render via renderToStaticMarkup (the canonical fix)
 *      is a significant refactor: the HTML page is a Server Component
 *      with disclosure-tier-aware data fetching, async params, and a
 *      full layout tree. The PDF route would need to either duplicate
 *      that logic or import + render it directly — neither is small.
 *
 * Pragmatic closure (per audit brief): set a recognizable User-Agent
 * on the puppeteer page, and have THIS route refuse any request that
 * carries it. Re-entry is then provably impossible: even if someone
 * spoofs the UA externally, the worst they can do is get a 508 back.
 *
 * The User-Agent value is versioned so a future refactor that switches
 * to inline render can leave the fence in place (defense in depth)
 * without colliding with downstream User-Agent telemetry / WAF rules.
 */
export const PDF_RENDERER_USER_AGENT = "Quantalyze-PDF-Renderer/1.0";

// Phase-4 red-team / audit-2026-05-07 — explicit allow-list for the
// puppeteer goto host. Pre-fix, `appUrl(req)` blindly trusted
// `req.nextUrl.origin` (derived from the inbound Host header), so any
// caller able to spoof Host (custom proxy, `curl --resolve`, self-hosted
// deploy, `vercel dev`) could drive the production puppeteer instance
// to fetch attacker-controlled content with full network privileges.
// Defense-in-depth: even with Vercel's edge host-validation, the route
// MUST validate locally so the security contract holds on every
// deployment shape (preview, prod, self-hosted, dev).
const APP_URL_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "quantalyze-rho.vercel.app",
  "quantalyze.com",
  "www.quantalyze.com",
]);

/** Validates `host` against the production allowlist OR the current
 *  deployment URL (`VERCEL_URL`) so preview deployments still work without
 *  being open-ended. Returns false on production VERCEL_ENV when host is
 *  outside the allowlist + VERCEL_URL pair. */
function isHostAllowed(host: string): boolean {
  if (APP_URL_ALLOWED_HOSTS.has(host)) return true;
  // Vercel injects `VERCEL_URL` per deployment (e.g.
  // `quantalyze-abc123-team.vercel.app`). Accepting the current
  // deployment's own host lets preview branches render their own
  // factsheets without manual allowlist edits.
  const vercelUrl = process.env.VERCEL_URL;
  if (typeof vercelUrl === "string" && vercelUrl.length > 0 && host === vercelUrl) {
    return true;
  }
  return false;
}

// Cluster L / Fix C-0086 — resolve the inner factsheet URL from the request
// origin first, falling back to NEXT_PUBLIC_APP_URL only when origin is
// unavailable (e.g. unit tests that bypass NextRequest plumbing). The legacy
// behavior — env fallback to `http://localhost:3000` — silently caused
// production puppeteer to navigate to localhost (15s timeout → 500) if the
// public env var was misconfigured. Preferring origin guarantees the inner
// page render hits the SAME deployment serving this request, which is also
// the only correct behavior for preview deployments.
//
// Why the `origin !== "null"` guard: per the WHATWG URL spec, opaque-origin
// URLs (e.g. `file://`, sandboxed iframes, certain SSR contexts that
// construct a NextRequest without a real host) serialize their origin as
// the LITERAL string `"null"` — not the JS `null` value. Without this
// guard, those callers would produce `page.goto("null/factsheet/<id>")`
// and silently 500. The string-compare is deliberate (and load-bearing);
// DO NOT remove or simplify to a truthy-check during refactors — fall
// through to the env/localhost branch in that case instead.
//
// Audit-2026-05-07 red-team — origin is host-header-derived, so we MUST
// validate it against an allowlist in production. The env fallback is
// gated on non-production VERCEL_ENV: in production VERCEL_ENV the
// fallback is unreachable by contract, and we return null so the caller
// hard-fails (no fingerprintable side-channel via deleted env).
//
// Function-form (vs module-load const) preserved so vi.resetModules() in
// tests can drop a stale value, mirroring the cron route's appUrl() pattern.
function appUrl(req: NextRequest): string | null {
  const origin = req.nextUrl.origin;
  // origin !== "null" — literal string from opaque-origin URLs, see comment block above.
  if (origin && origin !== "null") {
    // Production: only accept origins whose host is in the allowlist
    // (or matches the current deployment's VERCEL_URL). Other envs
    // accept whatever the request brought in — preserving dev/test
    // ergonomics (localhost:3000, custom test ports, etc.).
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
  // Origin opaque/missing. In production this is a contract violation —
  // returning null causes the handler to 500 rather than silently
  // falling through to env (which exposes a fingerprintable side-channel
  // when NEXT_PUBLIC_APP_URL is varied). Non-production preserves the
  // historical localhost fallback for `next dev` + unit tests.
  if (process.env.VERCEL_ENV === "production") return null;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // audit-2026-05-07 C-0090 — self-recursion fence. Refuse any request
  // whose User-Agent matches the renderer fingerprint we set on the
  // puppeteer page below. This is structurally impossible under the
  // current call graph (the inner page.goto targets /factsheet/[id],
  // not /api/factsheet/[id]/pdf), but the fence catches any future
  // regression that introduces recursion — and any external caller
  // spoofing the UA — before we touch the rate limiter or DB.
  if (req.headers.get("user-agent") === PDF_RENDERER_USER_AGENT) {
    console.error(
      "[pdf] Refused self-recursive call: User-Agent matches PDF renderer fingerprint",
    );
    return new NextResponse("Loop Detected", { status: 508 });
  }

  // Adversarial revision 2026-05-06 (Phase 18 Plan 03 / B4) — internal cron
  // callers (e.g. /api/cron/founder-lp-report) pass `x-internal-token:
  // ${INTERNAL_API_TOKEN}` to bypass `publicIpLimiter`. This prevents the
  // monthly LP cron from contending with alert-digest fan-out on the same
  // public IP pool. Token validated via safeCompare (constant time); empty
  // or missing token falls through to the existing public rate limiter so
  // unauthenticated callers see no behavior change.
  //
  // Phase 18 / R1 — additionally gate the bypass on VERCEL_ENV='production'.
  // A preview deploy with a leaked token would otherwise let any caller skip
  // the public limiter via `x-internal-token`. Local dev (VERCEL_ENV unset)
  // still honors the bypass so the cron's smoke test works.
  const vercelEnv = process.env.VERCEL_ENV;
  const isProductionOrLocal = vercelEnv === undefined || vercelEnv === "production";
  const internalToken = req.headers.get("x-internal-token");
  const internalEnv = process.env.INTERNAL_API_TOKEN;
  const isInternalCall =
    isProductionOrLocal &&
    internalToken !== null &&
    typeof internalEnv === "string" &&
    internalEnv.length > 0 &&
    safeCompare(internalToken, internalEnv);
  // Phase 18 / R13 — the cron's `x-correlation-id` arrives on this
  // request automatically (Vercel routes it through to next/headers).
  // Downstream callers using `getCorrelationId()` from `@/lib/correlation-id`
  // will read it directly from the request-scoped store; no copy needed.
  // (An earlier fix attempted `req.headers.set(...)` here; that was a
  // no-op against `next/headers` and has been removed — the contract
  // is honored by Next.js itself.)

  if (!isInternalCall) {
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
  }

  const { id } = await params;

  // Verify strategy exists and is published
  const admin = createAdminClient();
  const { data: strategy, error } = await admin
    .from("strategies")
    // audit-2026-05-07 red-team HIGH#3 — `computed_at` is required for the
    // ETag binding (id:computed_at). Pre-fix only `computation_status` was
    // selected, so analytics.computed_at was always undefined and the ETag
    // collapsed to `"<id>:"` — useless for revalidation.
    .select(
      "id, name, status, strategy_analytics (computation_status, computed_at)",
    )
    .eq("id", id)
    .eq("status", "published")
    .single();

  if (error || !strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const analytics = extractAnalytics(strategy.strategy_analytics);
  if (!analytics || analytics.computation_status !== "complete") {
    return NextResponse.json(
      { error: "Analytics not computed" },
      { status: 400 },
    );
  }

  // Audit-2026-05-07 red-team — resolve the puppeteer goto target BEFORE
  // grabbing the queue slot / launching Chromium. A null return means the
  // request origin failed allowlist validation (production) OR was opaque
  // in production. Hard-fail with 500 so we never silently fall through
  // to a localhost or attacker-controlled host.
  const targetOrigin = appUrl(req);
  if (targetOrigin === null) {
    console.error(
      "[pdf] Refused to render: request origin not allow-listed in production",
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  // Audit-2026-05-07 red-team (HIGH#3) — ETag bound to analytics.computed_at
  // is the only safe cache-revalidation contract for this surface. The CDN
  // s-maxage=3600 + stale-while-revalidate=86400 directives pin a PDF for
  // up to 25h after generation. If a strategy gets re-imported / recomputed
  // mid-window, the stale PDF (with old metrics) keeps serving. The
  // computed_at timestamp moves on every recomputation, so it's the
  // strongest cache key tied to actual content state.
  //
  // ETag is quoted strong-validator per RFC 7232. Format: id:computed_at
  // — id alone is not enough (different strategies could share computed_at
  // by coincidence, though unlikely), and computed_at alone collides
  // across strategies.
  const etag = `"${id}:${analytics.computed_at ?? ""}"`;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        // Vary: Host — see CDN cache-key comment in the 200 branch.
        Vary: "Host",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  let browser: Browser | null = null;
  let release: (() => void) | null = null;

  try {
    release = await acquirePdfSlot();
    browser = await launchBrowser();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15_000);
    page.setDefaultTimeout(15_000);
    await page.setViewport({ width: 800, height: 1100 });

    // audit-2026-05-07 C-0090 — stamp the renderer fingerprint on every
    // outbound request from this puppeteer instance. The fence at the
    // top of GET() rejects any inbound request that carries this UA, so
    // self-recursion is provably impossible from this point forward.
    // setUserAgent applies to the navigation AND every sub-resource the
    // page fetches, which is exactly the scope we want.
    await page.setUserAgent(PDF_RENDERER_USER_AGENT);

    await page.goto(`${targetOrigin}/factsheet/${id}`, {
      waitUntil: "networkidle0",
      timeout: 25000,
    });

    // Hide the print button before generating PDF
    await page.evaluate(() => {
      const printSection = document.querySelector(".print\\:hidden");
      if (printSection) (printSection as HTMLElement).style.display = "none";
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(strategy.name, "Strategy")}-factsheet.pdf"`,
        // Cluster L / Fix M-0311 — `/api/factsheet` is in PUBLIC_ROUTES
        // (src/proxy.ts) and this handler has no `auth.getUser()` gate; it
        // only checks `status='published'` + IP rate-limit. The previous
        // `private, max-age=86400` directive misrepresented the auth
        // contract to caches and prevented Vercel's shared CDN from
        // absorbing duplicate hits (e.g. social-card scrapers / a
        // newsletter blast). Match the sibling tearsheet.pdf route which
        // is also public and uses CDN s-maxage.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        // Audit-2026-05-07 red-team (HIGH#2) — PDF bytes are a function of
        // the Host header at generation time (via `appUrl(req)` → puppeteer
        // goto). Vercel routes preview deployments under multiple aliases
        // (`*-git-<branch>-<team>.vercel.app`, the deployment URL, the
        // production domain). Without `Vary: Host`, the shared CDN can serve
        // a preview-aliased PDF in response to a production-aliased request
        // (and vice-versa). Adding Vary forces the CDN to key per-host.
        Vary: "Host",
        // Audit-2026-05-07 red-team (HIGH#3) — ETag tied to
        // analytics.computed_at lets clients (and the CDN's revalidation
        // path) detect when the underlying analytics row has been
        // recomputed, avoiding stale-PDF poisoning on the s-maxage window.
        ETag: etag,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return new NextResponse("PDF generation queue full, retry in 10 seconds", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
    console.error("[pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
