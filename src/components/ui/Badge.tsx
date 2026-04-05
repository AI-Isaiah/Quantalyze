import { cn } from "@/lib/utils";

const colorMap: Record<string, string> = {
  "Long-Only": "bg-badge-directional/10 text-badge-directional",
  "Short-Only": "bg-badge-bidirectional/10 text-badge-bidirectional",
  "Long-Short": "bg-badge-directional/10 text-badge-directional",
  "Market Neutral": "bg-badge-market-neutral/10 text-badge-market-neutral",
  "Delta Neutral": "bg-badge-delta-neutral/10 text-badge-delta-neutral",
  Arbitrage: "bg-badge-arbitrage/10 text-badge-arbitrage",
  Other: "bg-badge-other/10 text-badge-other",
};

const statusMap: Record<string, string> = {
  published: "bg-positive/10 text-positive",
  draft: "bg-badge-other/10 text-badge-other",
  pending_review: "bg-badge-market-neutral/10 text-badge-market-neutral",
  archived: "bg-badge-other/10 text-text-muted",
};

interface BadgeProps {
  label: string;
  type?: "strategy" | "status";
  className?: string;
}

export function Badge({ label, type = "strategy", className = "" }: BadgeProps) {
  const styles =
    type === "status"
      ? statusMap[label] ?? statusMap.draft
      : colorMap[label] ?? colorMap.Other;

  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", styles, className)}
    >
      {label}
    </span>
  );
}
