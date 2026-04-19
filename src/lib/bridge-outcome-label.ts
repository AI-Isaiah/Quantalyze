// Translates a bridge_outcomes row into the D-12 label progression. Most-mature
// realized window wins. A needs_recompute=true row at day 30+ stays Pending
// (D-14) because the cron failed or the delta column is still null.

import { formatPercent } from "./utils";
import {
  REJECTION_REASON_LABELS,
  type BridgeOutcome,
} from "./bridge-outcome-schema";

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

// ---------------------------------------------------------------------------
// Phase 5 D-02 revised (Voice-D6, 2026-04-19) — deriveOutcomeStatusPill
// ---------------------------------------------------------------------------

export type OutcomeStatusPill = {
  state: "allocated-win" | "allocated-loss" | "allocated-pending" | "rejected";
  text: string;
  tone: "positive" | "negative" | "neutral";
};

/**
 * Phase 5 D-02 revised (Voice-D6, 2026-04-19): derive the 4-state status
 * pill for a bridge_outcomes row.
 *
 * - Rejected rows: `Rejected \u2014 {REJECTION_REASON_LABELS[reason] || "Other"}`.
 * - Allocated rows: `Allocated {percent}% \u2014 {win|loss|pending}` with
 *   win/loss/pending determined by the sign of the most-mature non-NULL
 *   delta (D-12 revised: delta_180d -> delta_90d -> delta_30d).
 *   Strict > 0 for win (matches Phase 4 _success_value); <= 0 INCLUDING
 *   EXACTLY ZERO -> loss. This INTENTIONALLY overrides Phase 1 D-13
 *   (D-13 = neutral-on-zero) for the status pill only. Best Available
 *   Delta cell continues to honor D-13 (neutral on zero). Divergence is
 *   intentional: pill binary-classifies success/failure for RL parity;
 *   delta cell displays raw magnitude without classification.
 *   All-NULL deltas -> pending.
 */
export function deriveOutcomeStatusPill(
  outcome: BridgeOutcome,
): OutcomeStatusPill {
  if (outcome.kind === "rejected") {
    const label = outcome.rejection_reason
      ? REJECTION_REASON_LABELS[outcome.rejection_reason]
      : "Other";
    return {
      state: "rejected",
      text: `Rejected \u2014 ${label}`,
      tone: "neutral",
    };
  }

  const pct = outcome.percent_allocated ?? 0;
  const prefix = `Allocated ${pct}%`;

  const mostMature =
    outcome.delta_180d !== null
      ? outcome.delta_180d
      : outcome.delta_90d !== null
        ? outcome.delta_90d
        : outcome.delta_30d;

  if (mostMature === null) {
    return {
      state: "allocated-pending",
      text: `${prefix} \u2014 pending`,
      tone: "neutral",
    };
  }
  // Voice-D6: strict > 0 for win; zero OR negative = loss.
  // This is the Phase-4 _success_value parity rule and INTENTIONALLY
  // overrides Phase 1 D-13 (neutral on zero) for the pill only.
  if (mostMature > 0) {
    return {
      state: "allocated-win",
      text: `${prefix} \u2014 win`,
      tone: "positive",
    };
  }
  return {
    state: "allocated-loss",
    text: `${prefix} \u2014 loss`,
    tone: "negative",
  };
}
