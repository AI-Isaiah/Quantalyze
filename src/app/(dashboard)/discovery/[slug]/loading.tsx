import { Skeleton } from "@/components/ui/Skeleton";

export default function DiscoveryLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-48 mb-4" />
      <Skeleton className="h-10 w-64 mb-4" />
      <Skeleton className="h-12 w-full mb-6 rounded-lg" />
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="p-4 space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-16 ml-auto" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-8 w-[120px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
