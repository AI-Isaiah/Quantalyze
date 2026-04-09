import Link from "next/link";
import { LegalFooter } from "@/components/legal/LegalFooter";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

export const metadata = {
  title: `Legal — ${PLATFORM_NAME}`,
};

const TABS = [
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/disclaimer", label: "Risk Disclaimer" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex items-center py-2 font-display text-xl text-text-primary"
          >
            {PLATFORM_NAME}
          </Link>
          <nav className="flex items-center gap-1 text-xs text-text-secondary">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className="inline-flex min-h-[44px] items-center rounded-md px-3 hover:text-text-primary"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="legal-article text-sm text-text-secondary leading-relaxed">
          {children}
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}
