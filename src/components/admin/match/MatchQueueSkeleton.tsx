"use client";

import { Card } from "@/components/ui/Card";

/**
 * Shimmer skeleton shown while the queue data is loading. Matches the rough
 * shape of the real layout (header strip + shortlist strip + two-pane list
 * + sticky detail) so there's no jarring reflow when data arrives.
 */
export function MatchQueueSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-48 bg-border rounded" />
      <Card>
        <div className="h-6 w-64 bg-border rounded" />
        <div className="mt-2 h-3 w-40 bg-border/60 rounded" />
        <div className="mt-4 flex gap-2">
          <div className="h-8 w-32 bg-border rounded" />
          <div className="h-8 w-32 bg-border/60 rounded" />
        </div>
      </Card>
      <div>
        <div className="mb-2 h-3 w-20 bg-border/60 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="h-4 w-3/4 bg-border rounded" />
              <div className="h-3 w-full bg-border/60 rounded" />
              <div className="h-2 w-full bg-border/40 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        <Card className="p-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="border-b border-border px-4 py-3 space-y-2 last:border-b-0"
            >
              <div className="h-3 w-2/3 bg-border rounded" />
              <div className="h-2 w-1/2 bg-border/60 rounded" />
            </div>
          ))}
        </Card>
        <Card className="min-h-[320px] space-y-3">
          <div className="h-5 w-48 bg-border rounded" />
          <div className="h-3 w-full bg-border/60 rounded" />
          <div className="h-3 w-5/6 bg-border/60 rounded" />
          <div className="h-3 w-4/6 bg-border/60 rounded" />
        </Card>
      </div>
    </div>
  );
}
