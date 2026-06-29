import { Skeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";

/**
 * Loading skeleton for the portfolio manage route
 * (`/portfolios/[id]/manage`). Shown while the page body fetches portfolio
 * detail + strategies + allocation events. Anchors on the "Manage {name}"
 * header, then strategy rows and the allocation-history block.
 */
export default function ManagePortfolioLoading() {
  return (
    <div>
      {/* Manage {name} header */}
      <div className="flex items-end justify-between gap-4 mb-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Strategy rows */}
      <section className="mb-8">
        <Skeleton className="h-5 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="sm">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Allocation history */}
      <section>
        <Skeleton className="h-5 w-40 mb-4" />
        <Card>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        Loading portfolio.
      </p>
    </div>
  );
}
