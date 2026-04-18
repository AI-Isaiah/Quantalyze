"use client";

import { useState } from "react";
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  REJECTED_FIELDS,
  type RejectionReason,
} from "@/lib/bridge-outcome-schema";
import { Button } from "@/components/ui/Button";
import type { RecordedOutcome } from "./AllocatedForm";

export type RejectedFormProps = {
  strategyId: string;
  onRecorded: (outcome: RecordedOutcome) => void;
  onCancel: () => void;
};

/**
 * Inline rejected-outcome form.
 *
 * Fields: rejection_reason (enum select, 5 options), note (optional; required when reason=other).
 * Client-side Zod symmetrical with route (D-10).
 * POSTs to /api/bridge/outcome with kind="rejected".
 * On success, calls onRecorded(outcome).
 *
 * DESIGN.md tokens: bg-surface, border-border, font-sans, text-text-secondary, text-negative.
 *
 * Sprint 8 Phase 1 — Plan 01-03
 */
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
    try {
      const res = await fetch("/api/bridge/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategyId,
          kind: "rejected",
          ...parsed.data,
        }),
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setError("Too many submissions — try again in a moment");
        } else {
          setError(body.error ?? "Couldn't record outcome — try again");
        }
        return;
      }
      onRecorded(body.outcome as RecordedOutcome);
    } catch {
      setError("Couldn't record outcome — try again");
    } finally {
      setSubmitting(false);
    }
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
