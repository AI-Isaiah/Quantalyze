import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";

/**
 * Loading skeleton for the portfolio documents route
 * (`/portfolios/[id]/documents`). Shown while the page body fetches portfolio
 * detail + the relationship_documents query. A leaner two-column anchor: the
 * upload panel + the document list, matching the live
 * `lg:grid-cols-[2fr_3fr]` layout.
 */
export default function PortfolioDocumentsLoading() {
  return (
    <div>
      {/* Documents header */}
      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
        {/* Upload panel */}
        <Card>
          <Skeleton className="h-5 w-1/3 mb-4" />
          <SkeletonText lines={3} />
          <Skeleton className="mt-4 h-9 w-32 rounded-lg" />
        </Card>

        {/* Document list */}
        <Card padding="sm">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading documents.
      </p>
    </div>
  );
}
