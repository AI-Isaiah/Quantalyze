import { cn } from "@/lib/utils";
import type { Strategy } from "@/lib/types";

/**
 * Trust-tier dispatch for the green "Verified" chip.
 *
 * QA report 2026-05-21 ISSUE-011: the badge was rendering unconditionally
 * on csv_uploaded strategies, contradicting the csv_uploaded disclaimer
 * copy below it. Now the badge only renders when the strategy is
 * api_verified — every other value (csv_uploaded / self_reported / null
 * / undefined) renders nothing.
 *
 * /ship specialist review hardening: `undefined` is treated as
 * not-verified rather than falling through to the old back-compat
 * "render anyway" branch. A future caller that forgets to pass the prop
 * (or a query helper that doesn't project trust_tier — the
 * StrategyV2Shell case the security review found) fails closed instead
 * of silently re-introducing ISSUE-011 on a new surface.
 */
interface VerifiedBadgeProps {
  trustTier?: Strategy["trust_tier"];
  className?: string;
}

export function VerifiedBadge({ trustTier, className }: VerifiedBadgeProps) {
  if (trustTier !== "api_verified") {
    return null;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-positive", className)}>
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd" />
      </svg>
      Verified
    </span>
  );
}
