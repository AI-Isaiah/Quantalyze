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
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co",
          },
        ],
      },
      {
        // CDN-cache the public /demo pages for 60 seconds with 5-minute
        // stale-while-revalidate. The page is `force-dynamic` (ISR prerenders
        // at build time, which crashes CI without SUPABASE_SERVICE_ROLE_KEY),
        // but response-level Cache-Control still lets Vercel's edge CDN
        // absorb viral traffic without hitting Supabase on every request.
        // /demo/founder-view inherits the same policy since it's the
        // founder-side read-only twin of /demo.
        source: "/demo/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
