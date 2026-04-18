/**
 * Pure utility: translates a bridge_outcomes row into the D-12 label progression.
 *
 * Progression (most-mature wins — day 90 with all three deltas shows 90-day;
 * at day 180 shows 180-day):
 *   - kind !== "allocated" or no allocated_at → Pending (defensive no-op)
 *   - days >= 180 && delta_180d !== null → 180-day: +X.X%
 *   - days >= 90  && delta_90d !== null  → 90-day: +X.X%
 *   - days >= 30  && delta_30d !== null  → 30-day: +X.X%
 *   - estimated_days in [1,29] && bps present → Estimated: +X.X% (Nd)
 *   - everything else → Pending
 *
 * D-13: tone is positive/negative only on realized windows (30d/90d/180d).
 * D-14: cron-failed (needs_recompute=true with null delta at day 30+) → Pending.
 */

export type OutcomeLabelInput = {
  kind: "allocated" | "rejected";
  allocated_at: string | null;          // YYYY-MM-DD
  delta_30d: number | null;             // ratio: 0.043 = +4.3%
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;   // basis points: 210 = +2.1%
  estimated_days: number | null;        // days in [1,29]
  needs_recompute: boolean;
  created_at: string;                   // ISO
  today?: string;                       // YYYY-MM-DD override (testing)
};

export type OutcomeLabel = {
  label: "Pending" | "Estimated" | "30-day" | "90-day" | "180-day";
  value: string;
  tone: "neutral" | "positive" | "negative";
};

const PENDING: OutcomeLabel = {
  label: "Pending",
  value: "Pending",
  tone: "neutral",
};

function diffInDays(todayIso: string, anchorIso: string): number {
  const t = new Date(todayIso + "T00:00:00Z").getTime();
  const a = new Date(anchorIso + "T00:00:00Z").getTime();
  return Math.max(0, Math.floor((t - a) / (24 * 60 * 60 * 1000)));
}

function formatDelta(ratio: number): string {
  const pct = ratio * 100;
  const sign = pct >= 0 ? "+" : "-";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function formatBps(bps: number): string {
  // bps / 100 converts to percent, then divide by 100 again for ratio
  return formatDelta(bps / 10000);
}

function toneOf(ratio: number): "positive" | "negative" | "neutral" {
  if (ratio > 0) return "positive";
  if (ratio < 0) return "negative";
  return "neutral";
}

export function deriveOutcomeLabel(input: OutcomeLabelInput): OutcomeLabel {
  // Defensive no-op: rejected outcomes or missing allocated_at don't use this util
  if (input.kind !== "allocated" || !input.allocated_at) return PENDING;

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const days = diffInDays(today, input.allocated_at);

  // Most-mature realized window wins
  if (days >= 180 && input.delta_180d !== null) {
    return {
      label: "180-day",
      value: `180-day: ${formatDelta(input.delta_180d)}`,
      tone: toneOf(input.delta_180d),
    };
  }
  if (days >= 90 && input.delta_90d !== null) {
    return {
      label: "90-day",
      value: `90-day: ${formatDelta(input.delta_90d)}`,
      tone: toneOf(input.delta_90d),
    };
  }
  if (days >= 30 && input.delta_30d !== null) {
    return {
      label: "30-day",
      value: `30-day: ${formatDelta(input.delta_30d)}`,
      tone: toneOf(input.delta_30d),
    };
  }

  // Estimated window (days 1-29 with partial returns)
  if (
    input.estimated_delta_bps !== null &&
    input.estimated_days !== null &&
    input.estimated_days >= 1 &&
    input.estimated_days <= 29
  ) {
    return {
      label: "Estimated",
      value: `Estimated: ${formatBps(input.estimated_delta_bps)} (${input.estimated_days}d)`,
      tone: "neutral",
    };
  }

  // Fallback: Pending (day 0, cron-failed D-14, estimate not yet computed)
  return PENDING;
}
