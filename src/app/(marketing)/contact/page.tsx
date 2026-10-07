import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact/ContactForm";
import { parseContactPrefill } from "@/lib/contact";

/**
 * `/contact` — the one contact form (Phase 164.6.6.3.5 DOMAINONE, D-01 / AD-01).
 *
 * Every pointer in the product ("use the contact form"), the `/security` and
 * `/legal/privacy` pages and `security.txt`'s `Contact:` land here, so it must
 * render for an anonymous visitor and for a scraper: it is in `PUBLIC_ROUTES`,
 * bounce-exempt, and `class: "public"` in `ROUTE_CONTRACT_MANIFEST`.
 *
 * The page is a Server Component so the prefill is validated on the server:
 * `parseContactPrefill` drops any `ref` / `draft` / `strategy` that fails the
 * id fence and any unknown `topic`, and nothing from the query string is echoed
 * as prose (T-164.6.6.3.5-15 / -16). The accepted values reach the client form
 * only as the initial value of a controlled input.
 *
 * Shell copied from `/security` (UI-SPEC S1): one `<main>`, one `<h1>`, a
 * left-aligned 640px article, hairlines, no card. The marketing layout supplies
 * the header and `LegalFooter`.
 */

export const metadata: Metadata = {
  title: "Contact — Quantalyze",
  alternates: {
    canonical: "/contact",
  },
  robots: { index: true, follow: true },
};

type RawParam = string | string[] | undefined;

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{
    topic?: RawParam;
    ref?: RawParam;
    draft?: RawParam;
    strategy?: RawParam;
  }>;
}) {
  const prefill = parseContactPrefill(await searchParams);

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-16 md:py-20">
      <article className="max-w-[640px]">
        <h1 className="font-display text-page-title leading-tight tracking-tight text-text-primary">
          Contact
        </h1>
        <p className="mt-4 text-body leading-relaxed text-text-secondary">
          Support questions, security reports and privacy requests all come
          here. The founder reads every message and replies to the email
          address you give, within one business day.
        </p>

        <div className="mt-8 border-t border-border pt-8">
          <ContactForm
            initialTopic={prefill.topic}
            initialReference={prefill.reference}
          />
        </div>

        <section
          aria-labelledby="security-reports"
          className="mt-12 border-t border-border pt-12"
        >
          <h2
            id="security-reports"
            className="font-display text-h2 tracking-tight text-text-primary"
          >
            Security reports
          </h2>
          <p className="mt-4 text-body leading-relaxed text-text-secondary">
            Choose Security report above. Our disclosure policy is on the{" "}
            <Link
              href="/security#security-contact"
              className="text-accent underline underline-offset-4"
            >
              security page
            </Link>
            , and{" "}
            <code className="rounded bg-page px-1 py-0.5 font-mono text-caption">
              /.well-known/security.txt
            </code>{" "}
            lists this form as the contact.
          </p>
        </section>
      </article>
    </main>
  );
}
