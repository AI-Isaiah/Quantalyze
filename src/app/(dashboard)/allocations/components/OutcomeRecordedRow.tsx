"use client";

import { deriveOutcomeLabel } from "@/lib/bridge-outcome-label";
import {
  REJECTION_REASON_LABELS,
  type RejectionReason,
} from "@/lib/bridge-outcome-schema";
import type { RecordedOutcome } from "./AllocatedForm";

export type OutcomeRecordedRowProps = {
  outcome: RecordedOutcome;
};

/**
 * Status line shown after a successful outcome record.
 *
 * D-11 exact copy:
 *   Allocated: "Recorded: Allocated {N}% on {date} • {label.value}"
 *   Rejected:  "Recorded: Rejected — {reasonLabel}"
 *
 * D-13 tone: text-positive / text-negative only on realized windows (30d/90d/180d).
 * DESIGN.md tokens: bg-page, border-border, font-sans, font-metric, text-text-primary,
 * text-positive, text-negative, text-accent.
 *
 * Sprint 8 Phase 1 — Plan 01-03
 */
export function OutcomeRecordedRow({ outcome }: OutcomeRecordedRowProps) {
  if (outcome.kind === "rejected") {
    const reasonKey = (outcome.rejection_reason ?? "other") as RejectionReason;
    const reasonLabel = REJECTION_REASON_LABELS[reasonKey] ?? "Other";
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

  // Allocated outcome — derive the D-12 label progression
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
