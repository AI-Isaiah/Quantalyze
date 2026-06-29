import Link from "next/link";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

export const metadata = {
  title: `Legal — ${PLATFORM_NAME}`,
};

const TABS = [
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/disclaimer", label: "Risk Disclaimer" },
];

/**
 * Nested layout for `/legal/*` under the `(marketing)` route group. The shared
 * (marketing)/layout.tsx supplies the masthead header + the LegalFooter once
 * (NAV-04 consolidation), so this nested layout keeps ONLY the distinct chrome
 * the legal section needs on top of that: the Privacy/Terms/Disclaimer tab-nav.
 * It still owns the single `<main>` and keeps its own `metadata` title; each
 * legal page supplies the single `<h1>` inside the article. No second header,
 * no second footer (the duplicate-landmark trap the shared shell removes).
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-page">
      <nav
        aria-label="Legal sections"
        className="border-b border-border bg-surface"
      >
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-1 px-6 text-xs text-text-secondary">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="legal-article text-sm text-text-secondary leading-relaxed">
          {children}
        </article>
      </main>
    </div>
  );
}
