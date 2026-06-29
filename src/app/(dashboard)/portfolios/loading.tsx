import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/**
 * Loading skeleton for the /portfolios list route. Shown while the page body
 * runs `getUserPortfolios()` (the fetch lives in the page after the auth gate,
 * so this fallback renders during that gap). Matches the live card grid
 * (`sm:grid-cols-2 lg:grid-cols-3`) so the page doesn't jump when content
 * arrives.
 */
export default function PortfoliosLoading() {
  return (
    <div>
      <div className="flex justify-between mb-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Loading portfolios.
      </p>
    </div>
  );
}
