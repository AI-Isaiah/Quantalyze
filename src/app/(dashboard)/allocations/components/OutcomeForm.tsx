"use client";

/**
 * Phase 09.1 Plan 08 / D-13 — OutcomeForm.
 *
 * Unified Allocated/Rejected outcome form embedded in the Holdings row-expand
 * "Record outcome" sub-tab. Routes through the existing `postBridgeOutcome`
 * flow (Phase 5 / Phase 09) — NO new API surface introduced.
 *
 * Segmented control exposes THREE options per C1 accepted:
 *   - Allocated (real)
 *   - Rejected (real)
 *   - Modified (coming soon) — disabled placeholder so allocators see the
 *     intended capability without a silent gap. The button is `disabled`
 *     + `aria-disabled` and carries an explanatory `title` tooltip.
 *     Clicking it CANNOT change the `action` state (T-09.1-08-06 mitigation).
 */

import { useState } from "react";
import {
  ALLOCATED_FIELDS,
  REJECTED_FIELDS,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  postBridgeOutcome,
  type RejectionReason,
} from "@/lib/bridge-outcome-schema";
import { Button } from "@/components/ui/Button";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

type Action = "allocated" | "rejected";

const MODES: Array<{
  key: Action | "modified";
  label: string;
  disabled: boolean;
  tooltip?: string;
}> = [
  { key: "allocated", label: "Allocated", disabled: false },
  { key: "rejected", label: "Rejected", disabled: false },
  {
    key: "modified",
    label: "Modified (coming soon)",
    disabled: true,
    tooltip: "Schema extension pending — see follow-up phase",
  },
];

export type OutcomeFormProps = {
  strategyId: string;
  row: DesignHoldingRow;
  onRecorded?: (outcomeId: string) => void;
};

export function OutcomeForm({ strategyId, row, onRecorded }: OutcomeFormProps) {
  const [action, setAction] = useState<Action>("allocated");
  const [percent, setPercent] = useState<string>("");
  const [allocatedAt, setAllocatedAt] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recordedId, setRecordedId] = useState<string | null>(null);

  const noteRequired = action === "rejected" && reason === "other";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (action === "allocated") {
      const pctNum = Number(percent);
      const parsed = ALLOCATED_FIELDS.safeParse({
        percent_allocated: pctNum,
        allocated_at: allocatedAt,
        note: note || null,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Invalid input");
        return;
      }
      setSubmitting(true);
      const result = await postBridgeOutcome({
        strategyId,
        kind: "allocated",
        values: parsed.data,
      });
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecordedId(result.outcome.id);
      onRecorded?.(result.outcome.id);
      return;
    }

    // action === "rejected"
    const parsed = REJECTED_FIELDS.safeParse({
      rejection_reason: reason,
      note: note || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    const result = await postBridgeOutcome({
      strategyId,
      kind: "rejected",
      values: parsed.data,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRecordedId(result.outcome.id);
    onRecorded?.(result.outcome.id);
  }

  if (recordedId) {
    return (
      <div
        role="status"
        data-testid="outcome-form-recorded"
        className="rounded-md border border-accent/40 bg-accent/5 p-4"
      >
        <div className="text-sm font-medium text-text-primary">
          Outcome recorded
        </div>
        <div className="mt-1 text-xs text-text-secondary">
          Logged against {row.strategy ?? `${row.venue} · ${row.symbol}`}.
        </div>
      </div>
    );
  }

  return (
    <form
      data-testid="outcome-form"
      onSubmit={handleSubmit}
      className="grid gap-3"
    >
      <div
        role="group"
        aria-label="Outcome action"
        className="flex flex-wrap gap-1"
      >
        {MODES.map((mode) => {
          const isActive = !mode.disabled && action === mode.key;
          const baseClass =
            "px-3 py-1 text-xs rounded transition-colors font-sans";
          const className = mode.disabled
            ? `${baseClass} border border-border text-text-muted cursor-not-allowed opacity-60`
            : isActive
              ? `${baseClass} bg-accent text-white border border-accent`
              : `${baseClass} border border-border text-text-primary hover:bg-page/50`;
          return (
            <button
              key={mode.key}
              type="button"
              aria-pressed={isActive}
              aria-disabled={mode.disabled}
              disabled={mode.disabled}
              title={mode.tooltip}
              onClick={() => {
                if (mode.disabled) return;
                setAction(mode.key as Action);
                setError(null);
              }}
              className={className}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      {action === "allocated" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">Percent allocated</span>
            <input
              type="number"
              min={0.1}
              max={50}
              step={0.1}
              required
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="font-metric rounded border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Percent allocated"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">Allocated on</span>
            <input
              type="date"
              required
              value={allocatedAt}
              onChange={(e) => setAllocatedAt(e.target.value)}
              className="font-metric rounded border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Allocated on"
            />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-text-secondary">Why not?</span>
          <select
            required
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectionReason)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            aria-label="Why not?"
          >
            <option value="" disabled>
              Select…
            </option>
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {REJECTION_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-text-secondary">
          {noteRequired ? "Note (required)" : "Note (optional)"}
        </span>
        <textarea
          rows={2}
          maxLength={2000}
          required={noteRequired}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="resize-none rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
          aria-label={noteRequired ? "Note (required)" : "Note (optional)"}
        />
      </label>

      {error ? (
        <div role="alert" aria-live="polite">
          <p className="text-xs text-negative">{error}</p>
        </div>
      ) : null}

      <div>
        <Button
          type="submit"
          size="sm"
          variant={action === "rejected" ? "danger" : "primary"}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting
            ? "Recording…"
            : action === "rejected"
              ? "Record rejection"
              : "Record allocation"}
        </Button>
      </div>
    </form>
  );
}
