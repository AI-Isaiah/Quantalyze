// Translates a bridge_outcomes row into the D-12 label progression. Most-mature
// realized window wins. A needs_recompute=true row at day 30+ stays Pending
// (D-14) because the cron failed or the delta column is still null.

import { formatPercent } from "./utils";

export type OutcomeLabelInput = {
  kind: "allocated" | "rejected";
  allocated_at: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  /** basis points (210 = +2.1%) */
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
  /** YYYY-MM-DD override for deterministic tests */
  today?: string;
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

function toneOf(ratio: number): "positive" | "negative" | "neutral" {
  if (ratio > 0) return "positive";
  if (ratio < 0) return "negative";
  return "neutral";
}

export function deriveOutcomeLabel(input: OutcomeLabelInput): OutcomeLabel {
  if (input.kind !== "allocated" || !input.allocated_at) return PENDING;

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const days = diffInDays(today, input.allocated_at);

  if (days >= 180 && input.delta_180d !== null) {
    return {
      label: "180-day",
      value: `180-day: ${formatPercent(input.delta_180d, 1)}`,
      tone: toneOf(input.delta_180d),
    };
  }
  if (days >= 90 && input.delta_90d !== null) {
    return {
      label: "90-day",
      value: `90-day: ${formatPercent(input.delta_90d, 1)}`,
      tone: toneOf(input.delta_90d),
    };
  }
  if (days >= 30 && input.delta_30d !== null) {
    return {
      label: "30-day",
      value: `30-day: ${formatPercent(input.delta_30d, 1)}`,
      tone: toneOf(input.delta_30d),
    };
  }

  if (
    input.estimated_delta_bps !== null &&
    input.estimated_days !== null &&
    input.estimated_days >= 1 &&
    input.estimated_days <= 29
  ) {
    return {
      label: "Estimated",
      value: `Estimated: ${formatPercent(input.estimated_delta_bps / 10000, 1)} (${input.estimated_days}d)`,
      tone: "neutral",
    };
  }

  return PENDING;
}
