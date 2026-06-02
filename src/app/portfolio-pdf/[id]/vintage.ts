import { computeFreshness, freshnessLabel } from "@/lib/freshness";

/**
 * B14 — the printed PDF footer's data-vintage line.
 *
 * The "Generated …" date is the RENDER time, not the data vintage. This builds
 * the companion "Data as of …" line from the portfolio analytics `computed_at`
 * so a report rendered today off week-old analytics does not read as current.
 *
 * Three outcomes:
 *   - no/unparseable computed_at        → "Data freshness unavailable"
 *   - fresh data (< 12h)                → "Data as of {date}"            (no suffix)
 *   - warm/stale data (≥ 12h / unknown) → "Data as of {date} (Warm|Stale)"
 *
 * The staleness word is appended ONLY when the data is not fresh, so a current
 * report stays uncluttered while a stale one is flagged in print. Routed through
 * the computeFreshness SoT (12h/48h thresholds) — the same one every other
 * freshness surface uses.
 */
export function formatDataVintage(
  computedAt: string | null,
  now: Date = new Date(),
): string {
  if (!computedAt) return "Data freshness unavailable";

  // An unparseable value must not print "Data as of Invalid Date" — that is a
  // misleading vintage. Fall through to the same "unavailable" copy as a null.
  const parsed = new Date(computedAt);
  if (!Number.isFinite(parsed.getTime())) return "Data freshness unavailable";

  const asOf = parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const label = freshnessLabel(computeFreshness(computedAt, now));
  return label === "Fresh" ? `Data as of ${asOf}` : `Data as of ${asOf} (${label})`;
}
