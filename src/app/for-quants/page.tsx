import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import { ForQuantsCtas } from "./ForQuantsCtas";

/**
 * `/for-quants` — public landing page targeting institutional crypto
 * quant teams.
 *
 * Section order: Hero → Trust → How It Works → Factsheet Sample → CTA.
 *
 * Server Component for SEO (hero + trust in initial HTML) and to read
 * auth state without a client round-trip. Interactivity lives in
 * `<ForQuantsCtas>`.
 *
 * PostHog `for_quants_view` fires from the client, not the server.
 * Server-side tracking with an IP-hash distinctId would:
 *   - collide with the client-generated anonymous ID (funnel can't join
 *     view → click → submit across three IDs),
 *   - collapse all visitors behind a corporate NAT into one person,
 *   - be reversible over low-entropy IPv4 space,
 *   - run as a render side effect (RSC purity violation).
 * PostHog's cookie-based anonymous ID on the client handles all of this.
 */

// Per-request rendering for the session check + to prevent any future
// cache wrapper from serving a stale logged-in/logged-out CTA variant.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "For Crypto Quant Teams | Quantalyze",
  description:
    "List a verified track record without exposing trading permissions. Read-only exchange API keys, codename anonymization, founder-routed allocator intros.",
  alternates: {
    canonical: "/for-quants",
  },
  robots: { index: true, follow: true },
  openGraph: {
    title: "For Crypto Quant Teams | Quantalyze",
    description:
      "List a verified track record without exposing trading permissions.",
    url: "/for-quants",
    type: "website",
  },
};

// Seeded demo data for the Factsheet Sample block. Synthetic equity
// path: ~68% total return over 30 buckets with one shallow drawdown —
// keep the shape recognizable if a future editor tunes it.
const SAMPLE_METRICS: FactsheetPreviewMetric[] = [
  { label: "CAGR", value: "+24.3%", qualifier: "Strong" },
  { label: "Sharpe", value: "1.82", qualifier: "Strong" },
  { label: "Sortino", value: "2.46", qualifier: "Strong" },
  { label: "Max Drawdown", value: "-14.2%", qualifier: "Moderate" },
  { label: "Volatility", value: "12.8%" },
  { label: "Cumulative Return", value: "+158.4%" },
];

const SAMPLE_SPARKLINE = [
  1.0, 1.02, 1.01, 1.04, 1.07, 1.05, 1.09, 1.12, 1.11, 1.16, 1.19, 1.22, 1.18,
  1.24, 1.28, 1.31, 1.27, 1.33, 1.38, 1.42, 1.39, 1.45, 1.49, 1.53, 1.5, 1.56,
  1.61, 1.58, 1.63, 1.68,
];

export default async function ForQuantsPage() {
  // Session check — determines whether the primary CTA goes to the signup
  // handoff (/signup?role=manager) or an in-app route. The Server
  // Component can do this without a client bundle bump.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);

  return (
    <>
      {/* 1. Hero */}
      <section className="border-b border-border bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-page px-3 py-1 text-xs font-medium text-text-secondary">
              For Crypto Quant Teams
            </span>

            <h1 className="mt-6 font-display text-4xl leading-tight tracking-tight text-text-primary md:text-5xl">
              List a verified track record without exposing trading permissions.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Read-only exchange API keys, codename anonymization, founder-routed
              allocator intros. Free to list.
            </p>

            <ForQuantsCtas location="hero" isLoggedIn={isLoggedIn} />

            {/* Trust badge row (3 inline facts, no vanity counts) */}
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-text-muted">
              <span className="flex items-center gap-1.5">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-4 w-4 text-text-muted"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                </svg>
                Read-only keys only
              </span>
              <span className="flex items-center gap-1.5">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-4 w-4 text-text-muted"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 1.5l6 2.5v4c0 3-2.5 5.5-6 6.5-3.5-1-6-3.5-6-6.5v-4z" />
                </svg>
                Envelope encryption
              </span>
              <span className="flex items-center gap-1.5">
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="h-4 w-4 text-text-muted"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8" cy="6" r="3" />
                  <path d="M2.5 14c.75-2.5 3-4 5.5-4s4.75 1.5 5.5 4" />
                </svg>
                Listed under codename
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Trust block */}
      <section className="border-b border-border bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <h2 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
            Read-only keys only. You control visibility and intro approvals.
          </h2>
          <p className="mt-3 max-w-2xl text-text-secondary">
            Every control exists at the database level, not just the UI.
          </p>

          <dl className="mt-10 divide-y divide-border border-t border-b border-border">
            {TRUST_ATOMS.map((atom) => (
              <div
                key={atom.title}
                className="grid gap-1 py-5 md:grid-cols-[240px_1fr] md:gap-8"
              >
                <dt className="font-medium text-text-primary">{atom.title}</dt>
                <dd className="text-text-secondary">{atom.body}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-sm text-text-muted">
            <Link
              href="/security"
              className="underline hover:text-text-primary"
            >
              Read our security practices →
            </Link>
          </p>
        </div>
      </section>

      {/* 3. How It Works — single panel with hairline-divided steps */}
      <section className="border-b border-border bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <h2 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
            How it works
          </h2>
          <p className="mt-3 max-w-2xl text-text-secondary">
            From read-only key to verified listing in one session. Founder
            reviews within 24 hours.
          </p>

          <dl className="mt-10 divide-y divide-border border-t border-b border-border">
            {HOW_STEPS.map((step) => (
              <div
                key={step.n}
                className="grid gap-2 py-5 md:grid-cols-[72px_280px_1fr] md:items-baseline md:gap-8"
              >
                <span className="font-metric text-xs tracking-wider text-text-muted">
                  {step.n}
                </span>
                <dt className="font-medium text-text-primary">{step.title}</dt>
                <dd className="text-text-secondary">{step.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 4. Factsheet Sample */}
      <section className="border-b border-border bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <h2 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
            Allocator view: your codename factsheet and verified risk metrics.
          </h2>
          <p className="mt-3 max-w-2xl text-text-secondary">
            Allocators see a single-page report generated from your real
            exchange trades. Your firm name stays hidden until you accept an
            intro.
          </p>

          <div className="mt-10">
            <FactsheetPreview
              strategyName="Alpha Codename"
              subtitle="SMA crossover · BTC, ETH"
              metrics={SAMPLE_METRICS}
              sparklineReturns={SAMPLE_SPARKLINE}
              computedAt={null}
              sampleLabel="Sample Strategy (Demo Data) — yours replaces this when you connect your API key."
            />
          </div>
        </div>
      </section>

      {/* 5. CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
              Ready to publish a verified strategy profile?
            </h2>
            <p className="mt-4 max-w-xl text-text-secondary">
              Your first listing walks through verification, codename
              selection, and founder review in a single session.
            </p>

            <ForQuantsCtas location="footer" isLoggedIn={isLoggedIn} />

            <p className="mt-8 text-sm text-text-muted">
              Already have an account?{" "}
              <Link href="/login" className="underline hover:text-text-primary">
                Sign in →
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

// --- static content ---

const TRUST_ATOMS: { title: string; body: string }[] = [
  {
    title: "Read-only keys verified at submission",
    body: "Trading and withdraw permissions are rejected with the exact error: \"This key has trading or withdrawal permissions. Only read-only keys are accepted.\" You cannot bypass this check.",
  },
  {
    title: "Envelope encryption at rest",
    body: "Every credential is encrypted with a per-row Fernet data key, itself wrapped by a KEK stored in Supabase Vault. Only the Python analytics service running under the service role can decrypt — not the web tier, not your own dashboard.",
  },
  {
    title: "Codename anonymization",
    body: "Your firm name is never public. You pick a codename at listing time and allocators see only the codename until you explicitly accept an intro.",
  },
  {
    title: "Listed to qualified allocators only",
    body: "Allocators attest to accredited-investor status at sign-up and the listing is gated by role. Retail discovery never sees your factsheet.",
  },
  {
    title: "Delete anytime",
    body: "One click removes the key and the listing. The encrypted credential row is deleted in the same transaction.",
  },
  {
    title: "Named security contact",
    body: "Security issues go directly to security@quantalyze.com. We reply within 1 business day and publish acknowledgments at /security.",
  },
];

const HOW_STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Paste your read-only exchange API key",
    body: "Binance, OKX, or Bybit. We validate the key has no trading or withdrawal permissions before it is encrypted and stored.",
  },
  {
    n: "02",
    title: "We compute verified performance",
    body: "Sharpe, Sortino, drawdowns, and up to 4+ years of daily returns. All metrics come from your real exchange trade history.",
  },
  {
    n: "03",
    title: "Your strategy is listed under a codename",
    body: "Qualified allocators browse the factsheet under your codename. Intro requests are routed through the founder for quality.",
  },
];
