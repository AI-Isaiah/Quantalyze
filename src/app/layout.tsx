// Phase 16 / OBSERV-01 + OBSERV-04 — meta carries correlation_id to client
// error boundaries (Plan 3 src/app/error.tsx + global-error.tsx consumers).
import type { Metadata } from "next";
import Script from "next/script";
import { DM_Sans, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCorrelationId, CORRELATION_HEADER } from "@/lib/correlation-id";

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

const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

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
            @/lib/correlation-id IS the source of truth — see assertion below. */}
        <meta name="x-correlation-id" content={correlationId} />
        {/* Sanity assertion — fails the type-check if the constant ever drifts
            from the inlined string above. */}
        {(CORRELATION_HEADER satisfies "x-correlation-id") && null}
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
