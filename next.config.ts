import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Phase 51 NAV-01 (FLOW-02 follow-through): the legacy Strategy-Sandbox
      // surface `/scenarios` is consolidated into the unified composer at
      // `/allocations?tab=scenario`. This formalizes the former in-page
      // `redirect()` stub into a config-level redirect: `redirects()` runs
      // BEFORE the filesystem and BEFORE the proxy, so the old `page.tsx` is
      // retired (deleted) and there is exactly ONE redirect source, not two.
      // `permanent: true` → a 308 (method-preserving, CDN/SEO-cacheable) move;
      // the query string is auto-preserved. The route-contract guard's Rule 3
      // (`scripts/check-route-contract.ts`) requires this `source` to match the
      // manifest's `redirectFrom: "/scenarios"` — the #512 lockstep. The
      // destination `/allocations` keeps its own auth via the (dashboard)
      // layout + page guards; an anon hit on `/scenarios` 308s here and the
      // proxy then gates `/allocations` to /login (correct AUTHED behavior,
      // NOT the #512 public-route-bounces-to-login defect — see
      // e2e/route-redirects.spec.ts, which asserts the redirect lands on the
      // composer, never on /login).
      {
        source: "/scenarios",
        destination: "/allocations?tab=scenario",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // RFC 9116 canonical path is /.well-known/security.txt — also serve
      // it at /security.txt for scanners/researchers that hit the root
      // path first. One physical file, two URL paths.
      { source: "/security.txt", destination: "/.well-known/security.txt" },
    ];
  },
  async headers() {
    return [
      {
        // Security headers — applied to every response. Next.js needs
        // 'unsafe-inline' for its script injection and 'unsafe-eval' in dev.
        // In production a nonce-based CSP would be stronger, but any CSP
        // is a significant improvement over none.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            // Audit-2026-05-07 M-0987: the /security page (and the
            // downloadable SOC2 packet) advertise "HSTS is enabled … with a
            // one-year max-age", but no Strict-Transport-Security header was
            // actually emitted — a diligence/MITM-downgrade gap. Emit the
            // one-year header so the live response matches the claim.
            // `preload` is intentionally omitted: it is an irreversible
            // HSTS-preload-list commitment we have not submitted to, and
            // advertising it unbacked would re-introduce this finding's
            // exact "claim ≠ reality" problem. Browsers honour HSTS only
            // over HTTPS, which Vercel serves exclusively.
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Audit-2026-05-07 #53: pre-emptively whitelist Plausible
            // analytics (`script-src` + `connect-src`) so a future
            // integration does not silently fail under CSP. Adding the
            // directive now is safer than discovering at deploy time
            // that telemetry is blocked.
            // Phase 27 (SIM-01): the Monte-Carlo forward simulation runs in a
            // Web Worker. Next 16/Turbopack emits it as a same-origin
            // `/_next/static/media/*.worker` chunk, which `default-src 'self'`
            // already covers — but we declare `worker-src 'self' blob:`
            // explicitly so a blob-instantiated worker (HMR in `next dev`, or a
            // future bundler change to a blob bootstrap) can never silently fail
            // CSP in only one environment. This is the Phase-25-class prod-only
            // CSP failure mode, closed pre-emptively. Adding `worker-src` only
            // relaxes the worker source list; it cannot weaken script execution.
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; worker-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io",
          },
        ],
      },
      {
        // Audit-2026-05-07 P334: tightened from s-maxage=60 to s-maxage=10
        // and added `Vary: Cookie` so per-session demo state (sb-* auth
        // cookies that gate the founder-view route) is keyed correctly
        // at the CDN. With s-maxage=60 a logged-in founder's response
        // could be served to a logged-out visitor for up to a minute,
        // since Vercel keys on URL only by default. 10 seconds is a tight
        // burst-absorber — enough to catch the 100 RPS thunder you get
        // when a /demo link is shared on Twitter, not so long that a
        // stale snapshot misleads the next reviewer. /demo/founder-view
        // inherits the same policy since it's the founder-side
        // read-only twin of /demo.
        source: "/demo/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=10, stale-while-revalidate=300",
          },
          {
            key: "Vary",
            value: "Cookie",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
