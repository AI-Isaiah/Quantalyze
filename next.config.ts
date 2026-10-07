import type { NextConfig } from "next";

// Every server-PDF route boots headless Chromium via src/lib/puppeteer.ts →
// @sparticuz/chromium. The package itself is externalized by Next's default
// serverExternalPackages list, but its `bin/**` brotli payload is ASSETS, not
// traced imports — the Vercel function bundle shipped without them and every
// PDF route 500'd at launch with "input directory .../bin does not exist"
// (found 2026-07-03 via the /demo "Download IC Report" button; affects the
// demo + authed portfolio PDFs and both factsheet PDFs alike). Keys are
// picomatch route globs with dynamic segments escaped; scoped per-route
// because the payload is ~70MB — a broad glob would bloat every function.
const CHROMIUM_BIN = ["./node_modules/@sparticuz/chromium/bin/**/*"];

// Phase 164.9.4 (D-14): the host of a derived CSP source may carry only these
// characters. `new URL()` accepts `;` and `,` in a host and decodes `%27` to
// `'`, so without this guard an env value could inject a directive or a
// keyword into the header. `*` fails it too, so no wildcard is ever derived.
const DERIVED_CSP_HOST = /^[a-z0-9.-]+$/;

/**
 * Does the CSP source expression `source` already allow the origin
 * `scheme://hostname[:port]`? Only the two host-source shapes the global
 * `connect-src` uses are recognised: `scheme://*.domain` (a non-empty label
 * before `.domain`, and no explicit port) and `scheme://host[:port]` (an exact
 * match). Keyword sources such as `'self'` never match here.
 */
function cspSourceAllows(
  source: string,
  scheme: string,
  hostname: string,
  port: string,
): boolean {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+))?$/.exec(source);
  if (!m) return false;
  const [, srcScheme, srcHost, srcPort = ""] = m;
  if (srcScheme !== scheme) return false;
  if (srcHost.startsWith("*.")) {
    const domain = srcHost.slice(2);
    return (
      srcPort === "" &&
      port === "" &&
      hostname.length > domain.length + 1 &&
      hostname.endsWith(`.${domain}`)
    );
  }
  return srcHost === hostname && srcPort === port;
}

/**
 * Phase 164.9.4 (D-14): append the origin of the configured
 * `NEXT_PUBLIC_SUPABASE_URL`, and its `ws:`/`wss:` twin, to the `connect-src`
 * directive of `csp`, but ONLY for a candidate no existing source matches.
 * A production build (`https://<ref>.supabase.co`) and the placeholder build
 * are matched by the `*.supabase.co` sources, so they get `csp` back unchanged,
 * byte for byte. A loopback lane build gains exactly its origin and ws twin.
 *
 * Reads the env WHEN CALLED, never at module scope. On any failed check (unset,
 * empty, unparseable, a scheme other than http/https, a host outside
 * `DERIVED_CSP_HOST`) it returns `csp` unchanged. It never throws.
 */
function withConfiguredSupabaseOrigin(csp: string): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return csp;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return csp;
  }
  const twinScheme =
    url.protocol === "http:" ? "ws" : url.protocol === "https:" ? "wss" : null;
  if (twinScheme === null) return csp;
  if (!DERIVED_CSP_HOST.test(url.hostname) && url.hostname !== "[::1]") {
    return csp;
  }

  const directive = /(^|;)(\s*connect-src\b[^;]*?)(\s*)(?=;|$)/.exec(csp);
  if (!directive) return csp;
  const sources = directive[2].trim().split(/\s+/).slice(1);

  const scheme = url.protocol.slice(0, -1);
  const candidates = [
    { text: url.origin, scheme },
    { text: `${twinScheme}://${url.host}`, scheme: twinScheme },
  ];
  const unmatched = candidates
    .filter(
      (c) =>
        !sources.some((s) =>
          cspSourceAllows(s, c.scheme, url.hostname, url.port),
        ),
    )
    .map((c) => c.text);
  if (unmatched.length === 0) return csp;

  const [whole, lead, body, trailing] = directive;
  const start = directive.index;
  return (
    csp.slice(0, start) +
    lead +
    body +
    " " +
    unmatched.join(" ") +
    trailing +
    csp.slice(start + whole.length)
  );
}


/**
 * Refuse a Vercel Production build whose `NEXT_PUBLIC_APP_URL` is not a
 * canonical public origin. Every absolute link the app mints (share links,
 * emails, PDFs, alert acks) prefers this variable, so a wrong value becomes a
 * dead or wrong-host link already sent to someone. Measured 2026-09-27: the
 * Production value pointed at the vercel.app alias, so factsheet share links
 * minted from the canonical host came back on the alias.
 *
 * Only `vercelEnv === "production"` is checked: preview builds legitimately
 * live on vercel.app hosts, and local/dev builds on localhost. This refuses;
 * it never substitutes a host.
 */
export function assertCanonicalAppUrl(
  appUrl: string | undefined,
  vercelEnv: string | undefined,
): void {
  if (vercelEnv !== "production") return;
  const expected =
    "an https origin on the canonical domain (not a *.vercel.app host, not localhost)";
  let url: URL;
  try {
    url = new URL(appUrl ?? "");
  } catch {
    throw new Error(
      `NEXT_PUBLIC_APP_URL is unset or not a URL on a VERCEL_ENV=production build; expected ${expected}.`,
    );
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    host === "vercel.app" ||
    host.endsWith(".vercel.app") ||
    host === "localhost" ||
    host === "127.0.0.1"
  ) {
    throw new Error(
      `NEXT_PUBLIC_APP_URL (${url.origin}) is not the canonical origin on a VERCEL_ENV=production build; expected ${expected}.`,
    );
  }
}

assertCanonicalAppUrl(process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_ENV);

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/demo/portfolio-pdf/\\[id\\]": CHROMIUM_BIN,
    "/api/portfolio-pdf/\\[id\\]": CHROMIUM_BIN,
    "/api/factsheet/\\[id\\]/pdf": CHROMIUM_BIN,
    "/api/factsheet/\\[id\\]/tearsheet.pdf": CHROMIUM_BIN,
  },
  async redirects() {
    return [
      // Phase 164.6.6.3.5 DOMAINONE D-05: one canonical address. The ROADMAP
      // founder decision of 2026-10-06 retires the Vercel alias
      // `quantalyze-rho.vercel.app` in favour of `https://quantalyze.xyz`, so
      // every request on the alias 308s to the same path (query kept) on the
      // canonical origin.
      // The `host` value is a regex-like string, so BOTH dots are escaped:
      // unescaped, a look-alike host such as `quantalyze-rhoXvercelXapp` would
      // match and be sent to our origin. Only the exact alias may match.
      // Preview and per-deployment hosts
      // (`quantalyze-<hash>-<team>-projects.vercel.app`) must NEVER match:
      // Vercel's preview checks run against them. The `missing` clause keeps
      // cron requests out as belt and braces: Vercel cron arrives on the
      // per-deployment host and does not follow redirects.
      // A 308 is cached by browsers, so reverting this rule does not reach
      // visitors who already followed it. Accepted: the destination is the
      // same site (RESEARCH Pitfall 7).
      {
        source: "/:path*",
        has: [{ type: "host", value: "quantalyze-rho\\.vercel\\.app" }],
        missing: [{ type: "header", key: "x-vercel-cron-schedule" }],
        destination: "https://quantalyze.xyz/:path*",
        permanent: true,
      },
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
    const blocks = [
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
            // Phase 164.9.4 (D-14, orchestrator decision 2026-09-26, ratified
            // by the founder 2026-09-27): `headers()` passes this value through
            // `withConfiguredSupabaseOrigin`, which appends the origin of the
            // configured NEXT_PUBLIC_SUPABASE_URL and its ws:/wss: twin to
            // `connect-src` ONLY when no source below already matches it. A
            // production `https://<ref>.supabase.co` build and the placeholder
            // build are matched by `*.supabase.co`, so their header stays
            // byte-identical to this literal; only a loopback lane build (the
            // seeded e2e run on a private local stack) gains an entry. An env
            // value with a scheme other than http/https, or a host carrying a
            // character outside [a-z0-9.-] (`;`, `'`, `,`, `*`), is refused,
            // so the env can never inject a directive or derive a wildcard.
            // Pinned by csp-connect-src-supabase-origin.contract.test.ts.
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; worker-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io",
          },
        ],
      },
      {
        // Phase 164 / SHARE-01 — the recipient share lane carries a capability
        // token in its PATH (ruling D-01), so this route gets `no-referrer`
        // while the global `strict-origin-when-cross-origin` above stays
        // untouched for everything else. Route-scoped headers are merged with
        // the `/(.*)` block and the more specific source wins on a key
        // collision, so this overrides Referrer-Policy here and nothing else.
        //
        // WHAT THE GLOBAL POLICY ACTUALLY LEAVES OPEN — stated precisely,
        // because an earlier draft of this rationale had the mechanism wrong.
        // Under `strict-origin-when-cross-origin` a CROSS-origin request sends
        // only the ORIGIN: neither path nor query survives, so the global
        // policy is already sufficient there. (The earlier claim that it
        // "strips query strings but never the path" is FALSE and must not be
        // repeated — it would have justified this header for a reason that
        // does not exist.) The real gap is SAME-ORIGIN navigation, where the
        // policy sends the FULL URL as `Referer` — path, token and all. Any
        // same-origin subresource or link click from the recipient page would
        // put the live token in a request header, and in this app's own server
        // logs. `no-referrer` closes that, and costs nothing: there is no
        // referrer-based analytics or attribution on this lane.
        //
        // ⚠️ It does NOT close third-party subresources loaded BY the page —
        // those are cross-origin and were already origin-only. The remaining
        // path-token channels are handled elsewhere: Plausible in
        // `src/app/PlausibleScript.tsx`, Sentry in `src/instrumentation.ts`.
        source: "/factsheet-share/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
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
    // Phase 164.9.4 (D-14): derive the configured Supabase origin into the
    // global CSP at return time, so the literal above stays the string after
    // `value:` and `NEXT_PUBLIC_SUPABASE_URL` is read when headers() is called.
    return blocks.map((block) =>
      block.source !== "/(.*)"
        ? block
        : {
            ...block,
            headers: block.headers.map((h) =>
              h.key === "Content-Security-Policy"
                ? { ...h, value: withConfiguredSupabaseOrigin(h.value) }
                : h,
            ),
          },
    );
  },
};

export default nextConfig;
