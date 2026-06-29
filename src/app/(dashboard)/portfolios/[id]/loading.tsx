import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";

/**
 * Loading skeleton for the portfolio detail route (`/portfolios/[id]`). Shown
 * while the page body fetches portfolio detail + analytics. Anchors on the
 * portfolio-name header + a headline-metric (KPI) block, with secondary
 * holdings rows below — matching the live detail layout so it doesn't jump.
 */
export default function PortfolioDetailLoading() {
  return (
    <div>
      {/* Name header */}
      <div className="flex items-end justify-between gap-4 mb-8">
        <div className="space-y-3">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Headline-metric (KPI) block */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-7 w-24" />
          </Card>
        ))}
      </div>

      {/* Secondary holdings / strategy rows */}
      <Card>
        <Skeleton className="h-5 w-1/4 mb-4" />
        <SkeletonText lines={5} />
      </Card>

      <p className="sr-only" role="status" aria-live="polite">
        Loading portfolio.
      </p>
    </div>
  );
}
