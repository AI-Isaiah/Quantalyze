// Phase 16 / OBSERV-01 + OBSERV-04 — meta carries correlation_id to client
// error boundaries (Plan 3 src/app/error.tsx + global-error.tsx consumers).
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { DM_Sans, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCorrelationId, CORRELATION_HEADER } from "@/lib/correlation-id";

// Phase-16 IN-06: drift guard at module scope — fails the type-check if
// CORRELATION_HEADER ever drifts from the literal string inlined into the
// <meta name="x-correlation-id"> below. Replaces the prior
// `(CORRELATION_HEADER satisfies "x-correlation-id") && null` JSX which had
// a pointless runtime half (`false && null` → `false` → React renders nothing).
const _CORRELATION_HEADER_DRIFT_GUARD: "x-correlation-id" = CORRELATION_HEADER;
void _CORRELATION_HEADER_DRIFT_GUARD;

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quantalyze",
  description: "Verified quantitative strategy marketplace",
};

// A11Y-02 / SC#2 — WCAG 1.4.4 Resize Text. Explicit zoom-permissive viewport.
// Emits <meta name="viewport" content="width=device-width, initial-scale=1">.
// maximumScale and userScalable are deliberately OMITTED: setting them would
// disable pinch-zoom (a WCAG 1.4.4 failure) and trip the zoom-meta guard at
// tests/visual/viewport-zoom-meta.test.ts. The typed export is the single
// source of truth — do NOT hand-write a <meta name="viewport"> in <head>.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

// Phase 16 / OBSERV-01 — defense-in-depth.
//
// The layout MUST render per-request so the <meta name="x-correlation-id">
// is fresh on every page load. Today this is forced by `await headers()`
// inside getCorrelationId() — Next.js 16 auto-detects routes that touch
// runtime APIs and renders them dynamically.
//
// `force-dynamic` here is belt-and-braces: if a future config enables
// `cacheComponents: true` (Next.js 16 PPR), the migration guide says to
// REMOVE this line and refactor the meta tag into a Suspense-wrapped
// per-request component (see https://nextjs.org/docs/app/getting-started/cache-components).
// Until then this guarantees the cid is never cached across requests.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Phase 16 / OBSERV-01 + OBSERV-04 — surface the request-scope
  // correlation_id to the client so the error boundaries (src/app/error.tsx,
  // src/app/global-error.tsx) and Plan 3's Sentry tag wiring can read it
  // without round-tripping the server. Header name is the lowercase form
  // exported by src/lib/correlation-id.ts (HTTP normalization for headers.get()).
  const correlationId = await getCorrelationId();
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full`}
    >
      <head>
        {/* Phase 16 / OBSERV-01: name="x-correlation-id" inlined as a literal
            so the OBSERV acceptance grep can confirm presence without resolving
            the imported `CORRELATION_HEADER` constant. The constant from
            @/lib/correlation-id IS the source of truth — drift is enforced by
            the module-scope `_CORRELATION_HEADER_DRIFT_GUARD` above (Phase-16
            IN-06; the prior in-JSX `&& null` half was runtime dead weight). */}
        <meta name="x-correlation-id" content={correlationId} />
      </head>
      <body className="h-full font-sans antialiased">
        {children}
        {plausibleDomain && (
          <Script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.tagged-events.js"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
