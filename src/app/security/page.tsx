import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/legal/LegalFooter";

/**
 * `/security` — public security practices page linked from the
 * /for-quants Trust block and from `public/security.txt` (RFC 9116).
 *
 * Plain Server Component with zero interactivity — no auth state, no
 * PostHog, no client JS. It needs to render for scrapers and
 * vulnerability researchers following security.txt → /security.
 */

export const metadata: Metadata = {
  title: "Security Practices | Quantalyze",
  description:
    "How Quantalyze handles exchange API keys, envelope encryption, accredited-investor gating, and security disclosures.",
  alternates: {
    canonical: "/security",
  },
  robots: { index: true, follow: true },
};

export default function SecurityPage() {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
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

      <main className="mx-auto max-w-4xl px-6 py-16 md:py-20">
        <h1 className="font-display text-4xl tracking-tight text-text-primary md:text-5xl">
          Security practices
        </h1>
        <p className="mt-4 max-w-2xl text-text-secondary">
          How Quantalyze handles exchange API keys, allocator gating, and
          security disclosures. Every mechanism below is enforced at the
          database or service-role layer, not only in the UI.
        </p>

        <div className="mt-12 space-y-12">
          <Section id="read-only-keys" title="Read-only keys, enforced at submission">
            <p>
              Every API key is validated against its exchange the moment you
              submit it. If the key has any trading or withdrawal permission,
              the submission is rejected with the exact error:
            </p>
            <pre className="mt-3 rounded-md border border-border bg-page px-3 py-2 text-xs text-text-primary">
              This key has trading or withdrawal permissions. Only read-only
              keys are accepted.
            </pre>
            <p className="mt-3">
              The check runs inside an atomic validate-and-encrypt round-trip
              so there is no window where a key with broader permissions
              could be persisted before the check completes.
            </p>
          </Section>

          <Section id="envelope-encryption" title="Envelope encryption at rest">
            <p>
              Credential payloads are encrypted twice. Each row in the{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">api_keys</code>{" "}
              table has its own per-row data encryption key (DEK) generated at
              encrypt time. The DEK is wrapped by a platform-wide key
              encryption key (KEK) stored in Supabase Vault.
            </p>
            <p className="mt-3">
              Only the Python analytics service, running under the
              service-role client, can unwrap the DEK and decrypt a key. The
              Next.js web tier cannot. Neither can your own dashboard — the
              encrypted columns are <em>revoked</em> at the column-grant level
              from the{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">anon</code>{" "}
              and{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">authenticated</code>{" "}
              Postgres roles (see migration 027).
            </p>
          </Section>

          <Section id="tenant-isolation" title="Tenant isolation at the database">
            <p>
              A BEFORE INSERT OR UPDATE trigger on the{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">strategies</code>{" "}
              table refuses any attempt to link an{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">api_key_id</code>{" "}
              owned by a different user (migration 028). Even if a misbehaving
              client bypassed the application-layer RLS policy, the trigger
              runs with SECURITY DEFINER and sees the ground-truth ownership.
            </p>
          </Section>

          <Section id="codename-anonymization" title="Codename anonymization">
            <p>
              Your firm name, manager display name, bio, and LinkedIn are
              never public. At listing time you pick a codename from a fixed
              pool and allocators see only the codename until you explicitly
              accept an intro.
            </p>
          </Section>

          <Section id="allocator-gating" title="Allocator gating">
            <p>
              Allocators attest to accredited-investor status at sign-up. The
              accredited attestation is persisted in the{" "}
              <code className="rounded bg-page px-1 py-0.5 text-xs">allocator_attestations</code>{" "}
              table (migration 008) and checked at every discovery query.
              Retail users never see the factsheet.
            </p>
          </Section>

          <Section id="deletion" title="Delete anytime">
            <p>
              You can revoke an API key from your dashboard with one click.
              The encrypted credential row is deleted in the same transaction
              that removes the listing reference. The Python analytics
              service loses its decryption path immediately.
            </p>
          </Section>

          <Section id="disclosures" title="Security disclosures">
            <p>
              If you found a vulnerability, please email{" "}
              <a
                href="mailto:security@quantalyze.com"
                className="underline hover:text-text-primary"
              >
                security@quantalyze.com
              </a>
              . We reply within 1 business day and acknowledge researchers
              who coordinate responsible disclosure at this page.
            </p>
            <p className="mt-3">
              Our{" "}
              <a
                href="/security.txt"
                className="underline hover:text-text-primary"
              >
                security.txt
              </a>{" "}
              follows RFC 9116.
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

        <div className="mt-16 border-t border-border pt-8 text-sm text-text-muted">
          Last reviewed: 2026-04-10. Questions?{" "}
          <a
            href="mailto:security@quantalyze.com"
            className="underline hover:text-text-primary"
          >
            security@quantalyze.com
          </a>
        </div>
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
    <section id={id} className="space-y-3">
      <h2 className="font-display text-2xl tracking-tight text-text-primary">
        <a
          href={`#${id}`}
          className="transition-colors hover:text-accent"
        >
          {title}
        </a>
      </h2>
      <div className="leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}
