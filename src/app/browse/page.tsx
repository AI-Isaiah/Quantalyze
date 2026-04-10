import Link from "next/link";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getPopulatedCategorySlugs } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse Verified Strategies — Quantalyze",
  description:
    "Explore exchange-verified quant strategies. Performance data sourced directly from exchange APIs.",
};

export default async function BrowsePage() {
  let populatedSlugs: string[] = [];
  try {
    populatedSlugs = await getPopulatedCategorySlugs();
  } catch {
    // Show all categories if query fails
  }

  const categories =
    populatedSlugs.length > 0
      ? DISCOVERY_CATEGORIES.filter((c) => populatedSlugs.includes(c.slug))
      : DISCOVERY_CATEGORIES;

  return (
    <>
      <div className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
          Browse Verified Strategies
        </h1>
        <p className="mt-2 text-text-secondary">
          Every metric below is sourced directly from exchange APIs. No
          self-reporting.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            href={`/browse/${cat.slug}`}
            className="rounded-xl border border-border bg-surface p-5 shadow-card hover:border-accent/30 hover:shadow-md transition-all"
          >
            <h2 className="text-base font-semibold text-text-primary">
              {cat.name}
            </h2>
            <p className="mt-1 text-sm text-text-secondary leading-relaxed">
              {cat.description}
            </p>
          </Link>
        ))}
      </div>

      {categories.length === 0 && (
        <div className="py-16 text-center text-text-muted">
          No strategies published yet. Check back soon.
        </div>
      )}

      <div className="mt-12 border-t border-border pt-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-2xl text-text-primary">
              Want full analytics and introductions?
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              Sign up to access detailed performance reports, request
              introductions to managers, and build portfolios.
            </p>
          </div>
          <Link
            href="/signup"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Get Started Free
          </Link>
        </div>
      </div>
    </>
  );
}
