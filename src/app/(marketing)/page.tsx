import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
import { EXCHANGES } from "@/lib/constants";
import { VerificationSection } from "@/components/landing/VerificationSection";

async function getSocialProofStats() {
  try {
    const supabase = await createClient();
    const [{ count: strategyCount }, { count: introCount }, { data: aumData }] = await Promise.all([
      withPublishedOnly(supabase.from("strategies").select("*", { count: "exact", head: true })),
      supabase.from("contact_requests").select("*", { count: "exact", head: true }),
      withPublishedOnly(supabase.from("strategies").select("aum")).not("aum", "is", null),
    ]);
    const totalAum = aumData?.reduce((sum, s) => sum + (s.aum ?? 0), 0) ?? 0;
    return {
      strategies: strategyCount ?? 0,
      intros: introCount ?? 0,
      aum: totalAum,
    };
  } catch {
    return { strategies: 0, intros: 0, aum: 0 };
  }
}

function formatAum(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return value > 0 ? `$${value}` : "—";
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/discovery/crypto-sma");
  }

  const stats = await getSocialProofStats();

  return (
    <>
      {/* A11Y-01 (Phase 48): the landing body lives in a <main> landmark so
          axe's landmark-one-main + page-has-main + region rules pass. The
          shared (marketing)/layout.tsx supplies the header + LegalFooter chrome
          (NAV-04 consolidation) and renders NO <main> of its own, so the
          landing page owns the single <main> here — exactly one <main> and one
          <h1> per rendered page. */}
      <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-24 md:py-32 text-center">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-sm border border-border bg-page px-3 py-1 text-caption font-medium text-text-secondary">
            <svg className="h-3.5 w-3.5 text-positive" viewBox="0 0 16 16" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z"
                clipRule="evenodd"
              />
            </svg>
            Exchange-verified performance data
          </div>

          <h1 className="text-hero tracking-tight text-text-primary font-display">
            Exchange-Verified
            <br />
            <span className="text-accent italic">Quant Strategies</span>
          </h1>

          <p className="mt-6 text-body text-text-secondary leading-relaxed">
            The only platform where performance data comes directly from exchange
            APIs. No self-reporting. No guessing.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/browse"
              className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-6 py-3 text-body font-medium text-white hover:bg-accent-hover transition-colors sm:w-auto"
            >
              Browse Strategies
            </Link>
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-white px-6 py-3 text-body font-medium text-text-primary hover:bg-page transition-colors sm:w-auto"
            >
              List Your Strategy
            </Link>
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-caption text-text-muted">
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-accent" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 1.5l1.85 3.75 4.15.6-3 2.93.71 4.12L8 10.77 4.29 12.9l.71-4.12-3-2.93 4.15-.6z" strokeLinejoin="round" />
              </svg>
              Exchange-verified data
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-accent" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="10" height="7" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
              </svg>
              Read-only API keys
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-accent" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M2.5 8h11M8 2.5a10.5 10.5 0 012.8 5.5A10.5 10.5 0 018 13.5 10.5 10.5 0 015.2 8 10.5 10.5 0 018 2.5z" />
              </svg>
              {EXCHANGES.length} exchanges supported
            </span>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <h2 className="font-display text-h2 tracking-tight text-text-primary">
            How It Works
          </h2>
          <p className="mt-3 text-text-secondary">
            For allocators seeking verified quant performance
          </p>

          <div className="mt-12 grid gap-px border-t border-border bg-border md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Browse verified strategies",
                description:
                  "Explore strategies with performance data pulled directly from exchange APIs. Every metric is independently verifiable.",
              },
              {
                step: "02",
                title: "Request an introduction",
                description:
                  "Connect with strategy managers through our platform. Review track records, risk metrics, and trading history.",
              },
              {
                step: "03",
                title: "Allocate with confidence",
                description:
                  "Make allocation decisions backed by exchange-verified data. No more relying on self-reported performance.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-page pt-8 md:pr-8"
              >
                <p className="font-metric text-caption tracking-wider text-text-muted">
                  {item.step}
                </p>
                <h3 className="mt-3 text-body font-semibold text-text-primary">
                  {item.title}
                </h3>
                <p className="mt-2 text-body leading-relaxed text-text-secondary">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verify Your Strategy */}
      <section className="mx-auto max-w-6xl px-6 py-20" id="verify">
        <div className="mx-auto max-w-2xl text-center mb-12">
          <h2 className="font-display text-h2 tracking-tight text-text-primary">
            Verify Your Performance
          </h2>
          <p className="mt-4 text-text-secondary">
            Connect your exchange API key (read-only) and get an instant performance report.
            See how your strategy stacks up.
          </p>
        </div>
        <VerificationSection />
      </section>

      {/* Social Proof */}
      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="grid gap-8 text-center md:grid-cols-4">
            <div>
              <p className="text-page-title font-semibold text-text-primary font-metric">
                {stats.strategies > 0 ? `${stats.strategies}+` : "—"}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                Verified strategies
              </p>
            </div>
            <div>
              <p className="text-page-title font-semibold text-text-primary font-metric">
                {formatAum(stats.aum)}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                AUM tracked
              </p>
            </div>
            <div>
              <p className="text-page-title font-semibold text-text-primary font-metric">
                {stats.intros > 0 ? `${stats.intros}+` : "—"}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                Introductions made
              </p>
            </div>
            <div>
              <p className="text-page-title font-semibold text-text-primary font-metric">
                {EXCHANGES.length}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                Exchanges supported
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-h2 tracking-tight text-text-primary">
                Ready to see verified performance?
              </h2>
              <p className="mt-3 text-text-secondary">
                Join the marketplace where every number is backed by exchange data.
              </p>
            </div>
            <Link
              href="/signup"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-6 py-3 text-body font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>
      </main>
    </>
  );
}
