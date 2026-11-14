import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/ui/Button";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { getBrowseCategories } from "./browse-categories";
import { hasBrowseSession } from "./session";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse Verified Strategies",
  description:
    "Explore exchange-verified quant strategies. Performance data sourced directly from exchange APIs.",
};

export default async function BrowsePage() {
  const { state, categories, onlySlug } = await getBrowseCategories();

  // D-08: one populated category makes the card grid a one-card menu, so go
  // straight to it (rule: ./browse-categories). redirect() throws, so there is
  // no try/catch around it.
  if (onlySlug) {
    redirect(`/browse/${onlySlug}`);
  }

  // ROUTE-02: a signed-in reader is never asked to sign up on /browse.
  const signedIn = await hasBrowseSession();

  return (
    <>
      <div className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-text-primary md:text-fixed-32">
          Browse Verified Strategies
        </h1>
        <p className="mt-2 text-text-secondary">
          Every metric below is sourced directly from exchange APIs. No
          self-reporting.
        </p>
      </div>

      {state === "ok" && (
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
      )}

      {state === "empty" && (
        <div className="py-16 text-center text-text-muted">
          No strategies published yet. Check back soon.
        </div>
      )}

      {state === "error" && (
        <div
          role="alert"
          className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
        >
          <p className="text-base font-semibold text-text-primary">
            We couldn&apos;t load the strategy categories.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            No categories are listed because the read failed, not because
            nothing is published.
          </p>
          <Link
            href="/browse"
            prefetch={false}
            className={buttonClassName({
              size: "sm",
              className: "mt-3 pointer-coarse:min-h-[44px]",
            })}
          >
            Try again
          </Link>
        </div>
      )}

      {!signedIn && (
        <div className="mt-12 border-t border-border pt-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl text-text-primary">
                Want full analytics and introductions?
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                Sign up to access detailed performance reports, request
                introductions to managers, and model an allocation.
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
      )}

      <Disclaimer variant="footer" />
    </>
  );
}
