import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function StrategiesLoading() {
  return (
    <div>
      <div className="flex justify-between mb-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
