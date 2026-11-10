import { cn } from "@/lib/utils";
import { labelOf } from "@/lib/display-labels";

// Phase 199 CONTRAST: tone TEXT is picked so it reaches >= 4.5:1 on its own
// token tint over white. The hue is carried by the tint, not the ink: the raw
// badge tokens (indigo, violet, pink, grey, amber) are 1.99-4.27:1 on their own
// /10 tint, so those tones read text-text-secondary (or text-warning for the
// amber ones). Pinned by tests/a11y/badge-contrast.test.ts.
const colorMap: Record<string, string> = {
  "Long-Only": "bg-badge-directional/10 text-badge-directional",
  "Short-Only": "bg-badge-bidirectional/10 text-text-secondary",
  "Long-Short": "bg-badge-directional/10 text-badge-directional",
  "Market Neutral": "bg-badge-market-neutral/10 text-warning",
  "Delta Neutral": "bg-badge-delta-neutral/10 text-text-secondary",
  Arbitrage: "bg-badge-arbitrage/10 text-text-secondary",
  Other: "bg-badge-other/10 text-text-secondary",
};

const statusMap: Record<string, string> = {
  published: "bg-positive/5 text-positive",
  draft: "bg-badge-other/10 text-text-secondary",
  pending_review: "bg-badge-market-neutral/10 text-warning",
  archived: "bg-badge-other/10 text-text-secondary",
  // Phase 149 Delta 3: `private` is a real strategy status that was missing
  // from both maps, so it fell through to `?? statusMap.draft` / `?? label` and
  // shipped as a DRAFT-inked badge reading raw lowercase "private" on
  // (dashboard)/strategies/page.tsx:177. StrategyHeader.tsx:24 spells it too but
  // is NOT a mounted surface (see that file's header), so it is not live use. Neutral
  // owner-chosen state → the same neutral ink `archived` uses (DESIGN.md
  // semantic-color gate: never red/amber for a non-error status).
  private: "bg-badge-other/10 text-text-secondary",
  // contact_request statuses
  pending: "bg-badge-market-neutral/10 text-warning",
  intro_made: "bg-accent/10 text-accent",
  completed: "bg-positive/5 text-positive",
  declined: "bg-negative/4 text-negative",
};

// Exported so display-labels.test.ts can check its key set against the
// strategies_status_check and contact_requests_status_check CHECK sets.
export const statusLabelMap: Record<string, string> = {
  published: "Published",
  draft: "Draft",
  pending_review: "Pending review",
  archived: "Archived",
  // Phase 149 Delta 3 — see statusMap above.
  private: "Private",
  // contact_request statuses
  pending: "Pending",
  intro_made: "Intro made",
  completed: "Completed",
  declined: "Declined",
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

  // A status outside the map reads "Unknown status", never the raw key.
  const displayLabel =
    type === "status" ? labelOf(statusLabelMap, label, "Unknown status") : label;

  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium", styles, className)}
    >
      {displayLabel}
    </span>
  );
}
