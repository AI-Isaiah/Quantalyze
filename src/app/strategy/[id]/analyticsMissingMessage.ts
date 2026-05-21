import type { Strategy } from "@/lib/types";

/**
 * QA report 2026-05-21 ISSUE-009: the analytics-missing placeholder on
 * /strategy/[id] previously read "Analytics are being computed. Check
 * back soon." for every strategy without a strategy_analytics row. That
 * was honest for api_verified strategies waiting on the worker, but a
 * forever-stuck lie for csv_uploaded strategies — the CSV ingestion path
 * does NOT enqueue any compute job, and no worker handler synthesizes
 * analytics from a raw daily-return series at the moment.
 *
 * This helper lives in its own file (not `page.tsx`) so unit tests can
 * import it without dragging the server-only Next.js page module
 * (createClient, generateMetadata, etc.) into the JS-DOM test runtime.
 *
 * /ship maintainability fix: type the trustTier argument against the
 * canonical `Strategy['trust_tier']` union so any future tier addition
 * propagates automatically.
 */
export function analyticsMissingMessage(
  trustTier: Strategy["trust_tier"],
): string {
  if (trustTier === "csv_uploaded") {
    return "This strategy was uploaded as a daily-return CSV. Platform-computed analytics (CAGR, Sharpe, drawdown) are not generated for CSV-uploaded strategies in this release — contact the manager for the full track record.";
  }
  return "Analytics are being computed. Check back soon.";
}
