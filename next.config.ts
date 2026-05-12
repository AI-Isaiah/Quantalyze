import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Audit-2026-05-07 #53: pre-emptively whitelist Plausible
            // analytics (`script-src` + `connect-src`) so a future
            // integration does not silently fail under CSP. Adding the
            // directive now is safer than discovering at deploy time
            // that telemetry is blocked.
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io",
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
