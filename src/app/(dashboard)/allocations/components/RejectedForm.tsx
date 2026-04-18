"use client";

import { useState } from "react";
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  REJECTED_FIELDS,
  postBridgeOutcome,
  type BridgeOutcome,
  type RejectionReason,
} from "@/lib/bridge-outcome-schema";
import { Button } from "@/components/ui/Button";

export type RejectedFormProps = {
  strategyId: string;
  onRecorded: (outcome: BridgeOutcome) => void;
  onCancel: () => void;
};

export function RejectedForm({
  strategyId,
  onRecorded,
  onCancel,
}: RejectedFormProps) {
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const noteRequired = reason === "other";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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
    onRecorded(result.outcome);
  }

  return (
    <form
      data-testid="rejected-form"
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 border-t border-border bg-surface px-4 py-3 text-sm font-sans"
    >
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary text-xs">Why not?</span>
        <select
          required
          value={reason}
          onChange={(e) => setReason(e.target.value as RejectionReason)}
          className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:border-border-focus"
          aria-label="Why not?"
        >
          <option value="" disabled>
            Select&hellip;
          </option>
          {REJECTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {REJECTION_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1 min-w-[180px]">
        <span className="text-text-secondary text-xs">
          {noteRequired ? "Note (required)" : "Note (optional)"}
        </span>
        <textarea
          rows={1}
          maxLength={2000}
          required={noteRequired}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:border-border-focus resize-none"
          aria-label={noteRequired ? "Note (required)" : "Note (optional)"}
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="danger"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Recording\u2026" : "Record rejection"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <div role="alert" aria-live="polite" className="w-full">
          <p className="text-negative text-xs">{error}</p>
        </div>
      )}
    </form>
  );
}
