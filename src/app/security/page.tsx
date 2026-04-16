import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/legal/LegalFooter";

/**
 * `/security` — public security practices page.
 *
 * Structure:
 *   1. Editorial 3-block hero (Data Handling / Key Handling / Compliance
 *      Posture) + security-packet PDF CTA. Meeting-hero layout per
 *      DESIGN.md: hairline dividers, no cards, left-aligned prose,
 *      ~640px max reading width.
 *   2. Operational Reference — the Binance/OKX/Bybit walkthroughs plus
 *      sync-timing / draft-resume / thresholds sections. Wizard error
 *      `docsHref` values and `ConnectKeyStep` deep-link here; the
 *      anchors must stay stable (#readonly-key, #binance-readonly,
 *      #okx-readonly, #bybit-readonly, #regenerate-key, #egress-ips,
 *      #sync-timing, #draft-resume, #thresholds).
 *   3. Security contact + RFC 9116 pointer.
 *
 * Plain Server Component — no auth state, no PostHog, no client JS.
 * Must render for scrapers and researchers following /.well-known/security.txt.
 */

export const metadata: Metadata = {
  title: "Security — Quantalyze",
  description:
    "How Quantalyze handles your exchange API keys, portfolio data, and compliance posture.",
  alternates: {
    canonical: "/security",
  },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Security — Quantalyze",
    description:
      "How Quantalyze handles your exchange API keys, portfolio data, and compliance posture.",
    url: "/security",
    type: "article",
  },
};

export default function SecurityPage() {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex items-center py-2 font-display text-lg tracking-tight text-text-primary"
          >
            Quantalyze
          </Link>
          <Link
            href="/for-quants"
            className="text-sm text-text-muted underline-offset-4 transition-colors hover:text-text-primary hover:underline"
          >
            For Quants →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-16 md:py-20">
        {/* --- 1. Editorial hero: 3-block credibility document --- */}
        <article className="max-w-[640px]">
          <h1 className="font-display text-[32px] leading-tight tracking-tight text-text-primary">
            Security practices
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-text-secondary">
            Quantalyze is a data-analytics platform, not a custodian. We read
            your trade history from your exchange via a read-only API key and
            compute verified performance metrics. We never hold funds, never
            place trades, and never move tokens.
          </p>

          <section
            aria-labelledby="data-handling"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="data-handling"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Data handling
            </h2>
            <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-text-primary">
              <p>
                The data we persist is: read-only exchange API credentials
                (encrypted), raw trade fills for the last 30 days, and
                aggregate analytics (Sharpe, Sortino, drawdown, daily
                returns) kept indefinitely. Raw fills older than 30 days are
                hard-deleted by a daily job; aggregates remain because the
                factsheet needs them.
              </p>
              <p>
                Tenant isolation is enforced at the database. Row-Level
                Security policies gate every read path, and a BEFORE INSERT
                trigger on{" "}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[13px]">
                  strategies
                </code>{" "}
                refuses any attempt to link an{" "}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[13px]">
                  api_key_id
                </code>{" "}
                owned by a different user. The check runs with SECURITY
                DEFINER, so even a client bypassing application-layer RLS
                cannot cross tenants.
              </p>
              <p>
                You can revoke a key and delete its strategy from your
                dashboard in one click. The encrypted credential row and the
                listing reference are removed in the same transaction; the
                analytics service loses its decryption path immediately.
              </p>
              <p>
                All traffic between your browser, our web tier, the analytics
                service, and the exchanges is encrypted in transit with TLS
                1.3. We disable TLS 1.0, 1.1, and 1.2 at the edge; internal
                service-to-service calls use the same profile. Certificates
                are issued by a public CA and rotated automatically before
                expiry. HSTS is enabled for{" "}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[13px]">
                  quantalyze.com
                </code>{" "}
                with a one-year max-age.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="key-handling"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="key-handling"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Key handling
            </h2>
            <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-text-primary">
              <p>
                API keys are stored read-only, enforced at submission. Every
                key is validated against the exchange the moment you paste it
                — if it carries any trading or withdrawal permission, the
                submission is rejected before the ciphertext is written. The
                check and the encrypt are a single atomic round-trip.
              </p>
              <p>
                Credential payloads are encrypted at rest with AES-256-GCM
                envelope encryption. Each row has its own data encryption key
                (DEK) generated at encrypt time; the DEK is wrapped by a
                platform key encryption key (KEK) stored in Supabase Vault.
                Only the Python analytics service, running under the
                service-role client, can unwrap the DEK. The Next.js web tier
                cannot, and neither can your own dashboard — the encrypted
                columns are revoked at the column-grant level from the{" "}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[13px]">
                  anon
                </code>{" "}
                and{" "}
                <code className="rounded bg-page px-1 py-0.5 font-mono text-[13px]">
                  authenticated
                </code>{" "}
                Postgres roles.
              </p>
              <p>
                We list detected scopes back to you in the wizard — Read,
                Trade, Withdraw — so you can see what the exchange actually
                granted. Any key with Trade or Withdraw is refused; no
                exceptions, no admin override.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="compliance-posture"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="compliance-posture"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Compliance posture
            </h2>
            <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-text-primary">
              <p>
                We are a pre-audit company. Preparing for SOC 2 Type 1;
                internal controls — access reviews, change management,
                vendor management, incident response — are documented and
                followed today, with the formal attestation to follow.
                Allocators evaluating us under diligence should engage our
                security contact for a current posture letter under NDA.
              </p>
              <p>
                The downloadable security packet below restates the
                encryption spec, retention windows, exchange scopes, and
                incident-response contact on one page — suitable for
                forwarding to a risk team.
              </p>
              <p>
                For coordinated vulnerability disclosure, our{" "}
                <a
                  href="/.well-known/security.txt"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  security.txt
                </a>{" "}
                follows RFC 9116.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="data-handling-summary"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="data-handling-summary"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Data handling at a glance
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-text-secondary">
              The three control surfaces a risk team checks first — transport,
              storage, and authorization — summarized on one line each.
            </p>
            <table className="mt-6 w-full border-collapse text-left text-[14px]">
              <caption className="sr-only">
                Quantalyze data-handling matrix — transport, storage, and
                access controls.
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="py-2 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-muted"
                  >
                    Surface
                  </th>
                  <th
                    scope="col"
                    className="py-2 pr-4 text-[11px] font-medium uppercase tracking-wider text-text-muted"
                  >
                    Control
                  </th>
                  <th
                    scope="col"
                    className="py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted"
                  >
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px] tabular-nums text-text-primary">
                <tr className="border-b border-border">
                  <th
                    scope="row"
                    className="py-3 pr-4 font-medium text-text-primary"
                  >
                    In Transit
                  </th>
                  <td className="py-3 pr-4">TLS 1.3</td>
                  <td className="py-3 text-text-secondary">
                    Edge and service-to-service; HSTS enabled
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <th
                    scope="row"
                    className="py-3 pr-4 font-medium text-text-primary"
                  >
                    At Rest
                  </th>
                  <td className="py-3 pr-4">AES-256-GCM</td>
                  <td className="py-3 text-text-secondary">
                    Per-row DEK wrapped by Vault-held KEK
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="py-3 pr-4 font-medium text-text-primary"
                  >
                    Access
                  </th>
                  <td className="py-3 pr-4">RBAC + RLS</td>
                  <td className="py-3 text-text-secondary">
                    Postgres role grants; tenant-scoped policies
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section
            aria-labelledby="breach-notification"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="breach-notification"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Breach notification
            </h2>
            <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-text-primary">
              <p>
                In the event of a personal-data breach affecting your account,
                we notify you within 72 hours of becoming aware of it, in line
                with GDPR Article 33. Notification is sent to the account
                email on file and, for institutional customers, to the
                security contact named in the onboarding record.
              </p>
              <p>
                The notice states what data was affected, the scope of the
                incident, the remediation actions taken, and the contact
                point for follow-up. If the 72-hour window cannot be met,
                the notice is sent without undue further delay with a
                written justification for the delay, per the same Article.
              </p>
            </div>
          </section>

          {/* --- PDF CTA --- */}
          <div className="mt-12 border-t border-border pt-12">
            <a
              href="/security-packet.pdf"
              aria-label="Download Quantalyze security packet PDF"
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Download security packet (PDF)
            </a>
            <p className="mt-3 text-[13px] text-text-muted">
              One-page summary — encryption spec, scopes, retention,
              incident-response contact. Updated when policy changes; see
              the last-reviewed date below.
            </p>
          </div>

          {/* --- Security contact --- */}
          <section
            aria-labelledby="security-contact"
            className="mt-12 border-t border-border pt-12"
          >
            <h2
              id="security-contact"
              className="font-display text-2xl tracking-tight text-text-primary"
            >
              Security contact
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-text-primary">
              Allocators asking for a posture letter, researchers reporting
              a vulnerability, and anyone with a concrete security question
              should email{" "}
              <a
                href="mailto:security@quantalyze.com"
                className="text-accent underline-offset-4 hover:underline"
              >
                security@quantalyze.com
              </a>
              . We reply within one business day. Acknowledgments for
              coordinated disclosure are published on this page.
            </p>
            <p className="mt-3 text-[13px] text-text-muted">
              Last reviewed: 2026-04-12.
            </p>
          </section>
        </article>

        {/* --- 2. Operational reference — wizard deep-links target these
                 anchors; do not change without updating wizardErrors.ts. --- */}
        <section
          aria-labelledby="operational-reference"
          className="mt-20 max-w-[720px] border-t border-border pt-12"
        >
          <h2
            id="operational-reference"
            className="font-display text-2xl tracking-tight text-text-primary"
          >
            Operational reference
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">
            Step-by-step guides the Connect wizard links into when a key
            fails validation, sync is slow, or a draft needs resuming. Kept
            on one page so the wizard error surface has a stable landing
            target.
          </p>

          <div className="mt-10 space-y-10">
            <Section id="readonly-key" title="Creating a read-only API key">
              <p>
                A read-only key lets our analytics service fetch your trade
                history without ever being able to place trades or move
                funds. Every supported exchange has a read-only scope. If a
                step fails, the wizard rejects the key with a scripted
                error pointing back here.
              </p>
              <div className="mt-4 space-y-4">
                <SubAnchor id="binance-readonly" title="Binance">
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] text-text-secondary">
                    <li>
                      Go to Binance API Management and click Create API. Pick
                      System-generated.
                    </li>
                    <li>
                      Check only <strong>Enable Reading</strong>. Leave Enable
                      Spot &amp; Margin Trading, Enable Futures, and Enable
                      Withdrawals unchecked.
                    </li>
                    <li>
                      Save the key and copy both the key and secret. Paste
                      them into the wizard.
                    </li>
                  </ol>
                </SubAnchor>

                <SubAnchor id="okx-readonly" title="OKX">
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] text-text-secondary">
                    <li>
                      Go to OKX API Management and click Create API Key V5.
                    </li>
                    <li>
                      Set the permission to <strong>Read</strong> only. Do
                      not enable Trade or Withdraw.
                    </li>
                    <li>
                      Set a passphrase (OKX requires one). Copy the key,
                      secret, and passphrase into the wizard.
                    </li>
                  </ol>
                </SubAnchor>

                <SubAnchor id="bybit-readonly" title="Bybit">
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] text-text-secondary">
                    <li>
                      Go to Bybit API Management and click Create New Key.
                      Pick System-generated.
                    </li>
                    <li>
                      Pick <strong>Read-Only</strong> access. Leave Trade,
                      Derivatives, and Transfer permissions unchecked.
                    </li>
                    <li>Copy the key and secret into the wizard.</li>
                  </ol>
                </SubAnchor>
              </div>
            </Section>

            <Section id="regenerate-key" title="Regenerating an API key">
              <p>
                Some exchanges only show the secret once at creation. If you
                cannot find it, create a fresh read-only key and paste the
                new credentials. The old key can be deleted from your
                exchange dashboard afterwards.
              </p>
            </Section>

            <Section id="egress-ips" title="Egress IPs (IP-allowlist keys)">
              <p>
                If your exchange key is locked to an IP allowlist, allow our
                analytics service egress range. Email{" "}
                <a
                  href="mailto:security@quantalyze.com"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  security@quantalyze.com
                </a>{" "}
                for the current IP set — we rotate infrequently and will
                notify ahead of any change.
              </p>
            </Section>

            <Section id="sync-timing" title="Sync timing and cold starts">
              <p>
                The first sync of the day can take up to 45 seconds while
                the analytics service wakes up. Accounts with multi-year
                history can take up to 3 minutes. Your draft is saved — you
                can leave the wizard tab and come back. If sync fails, the
                wizard error copy tells you exactly what to retry and when
                to contact{" "}
                <a
                  href="mailto:security@quantalyze.com"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  security@quantalyze.com
                </a>
                .
              </p>
            </Section>

            <Section id="draft-resume" title="Resuming a wizard draft">
              <p>
                Wizard drafts are stored server-side and tied to your
                account. If you close the tab, open a new one, sign in, and
                navigate back to the wizard, you will see a Resume banner.
                Secrets are never stored in your browser, so you will need
                to paste the API secret one more time before sync kicks off
                again.
              </p>
            </Section>

            <Section
              id="thresholds"
              title="Trade history thresholds (5 trades, 7 days)"
            >
              <p>
                We require a minimum of 5 filled trades and 7 calendar days
                of activity before we compute a verified factsheet. Sharpe,
                Sortino, and drawdown numbers on smaller samples are noise,
                not signal. The wizard refuses to advance past Step 2 until
                both thresholds are met, and the admin review flow enforces
                the same gate. If your draft does not pass, we save it for
                30 days so you can resume after trading more history.
              </p>
            </Section>

            <Section id="acknowledgments" title="Researcher acknowledgments">
              <p>
                We thank the security researchers who have reported issues
                responsibly. This list is updated after each coordinated
                disclosure.
              </p>
              <ul className="mt-3 list-disc pl-6 text-text-secondary">
                <li>No public acknowledgments yet.</li>
              </ul>
            </Section>
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <h3
        id={`${id}-title`}
        className="font-display text-base font-semibold tracking-tight text-text-primary"
      >
        <a href={`#${id}`} className="transition-colors hover:text-accent">
          {title}
        </a>
      </h3>
      <div className="text-[14px] leading-relaxed text-text-secondary">
        {children}
      </div>
    </section>
  );
}

function SubAnchor({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="border-t border-border pt-3">
      <h4 className="font-display text-base text-text-primary">
        <a href={`#${id}`} className="transition-colors hover:text-accent">
          {title}
        </a>
      </h4>
      <div className="text-[14px] leading-relaxed text-text-secondary">
        {children}
      </div>
    </div>
  );
}
