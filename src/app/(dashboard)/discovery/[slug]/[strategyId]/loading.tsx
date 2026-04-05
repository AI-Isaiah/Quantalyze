import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function StrategyDetailLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-64 mb-4" />
      <Skeleton className="h-10 w-80 mb-2" />
      <Skeleton className="h-4 w-32 mb-6" />

      {/* Metadata cards skeleton */}
      <div className="grid grid-cols-6 gap-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Chart skeleton */}
      <Skeleton className="h-[350px] w-full rounded-xl mb-6" />

      {/* Tabs + content */}
      <div className="flex gap-4 mb-6">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex gap-6">
        <Skeleton className="h-[300px] flex-[65] rounded-xl" />
        <Skeleton className="h-[400px] flex-[35] rounded-xl" />
      </div>
    </div>
  );
}
