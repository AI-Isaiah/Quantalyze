"use client";

import { deriveOutcomeLabel } from "@/lib/bridge-outcome-label";
import {
  REJECTION_REASON_LABELS,
  type BridgeOutcome,
} from "@/lib/bridge-outcome-schema";

export type OutcomeRecordedRowProps = {
  outcome: BridgeOutcome;
};

export function OutcomeRecordedRow({ outcome }: OutcomeRecordedRowProps) {
  if (outcome.kind === "rejected") {
    const reasonLabel = outcome.rejection_reason
      ? REJECTION_REASON_LABELS[outcome.rejection_reason]
      : "Other";
    return (
      <div
        data-testid="outcome-recorded-row"
        className="flex items-center gap-2 border-t border-border bg-page px-4 py-3 text-sm font-sans text-text-primary"
      >
        <span className="text-accent" aria-hidden="true">{"\u2713"}</span>
        <span>
          {"Recorded: Rejected \u2014 "}
          {reasonLabel}
        </span>
      </div>
    );
  }

  const label = deriveOutcomeLabel({
    kind: outcome.kind,
    allocated_at: outcome.allocated_at,
    delta_30d: outcome.delta_30d,
    delta_90d: outcome.delta_90d,
    delta_180d: outcome.delta_180d,
    estimated_delta_bps: outcome.estimated_delta_bps,
    estimated_days: outcome.estimated_days,
    needs_recompute: outcome.needs_recompute,
    created_at: outcome.created_at,
  });

  const toneClass =
    label.tone === "positive"
      ? "text-positive"
      : label.tone === "negative"
        ? "text-negative"
        : "text-text-primary";

  return (
    <div
      data-testid="outcome-recorded-row"
      className="flex items-center gap-2 border-t border-border bg-page px-4 py-3 text-sm font-sans text-text-primary"
    >
      <span className="text-accent" aria-hidden="true">{"\u2713"}</span>
      <span>
        {"Recorded: Allocated "}
        <span className="font-metric tabular-nums">{outcome.percent_allocated}%</span>
        {" on "}
        <span className="font-metric tabular-nums">{outcome.allocated_at}</span>
        {" \u2022 "}
        <span className={`font-metric tabular-nums ${toneClass}`}>
          {label.value}
        </span>
      </span>
    </div>
  );
}
